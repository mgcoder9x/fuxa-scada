# 11 — Task 13: API layer (router + middleware + mount)

> Tương ứng **Task 13** trong `../tasks.md`. Requirement: 1.x, 3.x, 5–9.x (backend), 10.2/10.3, 16.3/16.4, 17.1.
> Thiết kế: các mục §01/§02/§04/§05, và §12 (bootstrap chạy lúc khởi động).

> ### ⚠️ ĐỐI CHIẾU (2026-07-13) — GHI ĐÈ theo D-014, D-018, D-015 (+ N-018)
> Bản cũ mount router module **sau** router FUXA và tái dùng cùng URL ⇒ Express kết thúc ở handler FUXA,
> RBAC/audit/mustRotate của module **không chạy** (defect **N-014**). Sửa:
> - **D-014 SUPERSEDE (task 13.5):** trong bootstrap API của FUXA, **ngừng mount** `usersApi`/`authApi` cho các URL
>   trùng (`/api/signin`, `/api/refresh`, `/api/signout`, `/api/users`, `/api/roles`) và mount router module
>   (sau `authLimiter`) — module là **authority duy nhất**. Client cutover (D-011) đi kèm cùng lúc.
> - **D-018 (task 13.7):** thêm `api/account.router.js` phục vụ **`POST /api/account/rotate-password`** (mở khóa
>   deadlock của admin `mustRotate`).
> - **D-015 (task 13.1):** middleware dựng `Identity` từ **bản ghi sống** + kiểm `tokenVersion`, không tin claim.
> - **N-018:** middleware/handler **không được** đưa secret/token vào `runtime.logger`/console.
> - Property **P-014** (task 13.8) chốt: URL bị supersede do module xử lý, không phải handler FUXA còn sót.

## Mục tiêu

Phơi module ra HTTP: router đăng nhập/refresh/signout, router users, router roles, middleware phân
quyền; và **composition root** ráp adapter→service→bootstrap, rồi gắn vào FUXA bằng **đúng 1 dòng**.

## Phụ thuộc

Tất cả service (Task 2–12).

## Kiến thức nền (đã kiểm chứng `server/api/index.js`)

Mẫu FUXA (dòng ~41–77): `apiApp = express()` → `apiApp.use(authLimiter)` → mỗi API con:
`xxxApi.init(runtime, ...)` rồi `apiApp.use(xxxApi.app())`. Ta thêm module theo đúng mẫu này — **1 dòng
mount** là chỗ chạm FUXA lõi duy nhất (D-003). Token đọc từ header `x-access-token`.

---

## Bước 1 (13.1) — Middleware phân quyền

Tạo `server/auth-management/api/authorization.middleware.js`:

```javascript
//@ts-check
'use strict';

/**
 * Tạo middleware yêu cầu 1 quyền. Dựng Identity từ token + nạp mustRotate từ store.
 * @param {{ tokenService:any, userStore:any, authorization:any, auditLogger:any }} deps
 */
function requirePermission(requiredPermission, deps) {
  const { tokenService, userStore, authorization, auditLogger } = deps;
  return async function (req, res, next) {
    try {
      const token = req.headers['x-access-token'];
      const v = tokenService.verify(token);
      const identity = v.authenticated
        ? { authenticated: true, username: v.claims.id, groups: v.claims.groups, roles: v.claims.roles }
        : { authenticated: false };

      // Nạp cờ mustRotate hiện tại từ store (không tin token cũ)
      if (identity.authenticated) {
        const u = await userStore.get(identity.username);
        identity.mustRotate = !!(u && u.metadata && u.metadata.mustRotate);
      }

      const decision = await authorization.isAllowed(identity, { requiredPermission });
      if (!decision.allow) {
        try { auditLogger.record({ category: 'authz.denied', subject: identity.username || 'guest', operation: requiredPermission, outcome: 'denied', detail: String(decision.status), timestamp: new Date().toISOString() }); } catch (_e) {}
        return res.status(decision.status).json({ error: decision.error });
      }
      req.identity = identity;
      next();
    } catch (_e) {
      return res.status(500).json({ error: 'authorization_error' }); // fail fast (AC-16.4)
    }
  };
}

module.exports = { requirePermission };
```

---

## Bước 2 (13.2) — Router đăng nhập / refresh / signout

Tạo `server/auth-management/api/authentication.router.js`:

```javascript
//@ts-check
'use strict';
const express = require('express');

// cookie refresh dùng lại tên của FUXA
const REFRESH_COOKIE = 'fuxa_refresh';

/** @param {{ authentication:any, tokenService:any, userStore:any, settings:any }} deps */
function createAuthenticationRouter(deps) {
  const { authentication, tokenService, userStore, settings } = deps;
  const router = express.Router();

  router.post('/api/signin', async (req, res) => {
    const r = await authentication.signIn(req.body || {});
    switch (r.kind) {
      case 'success': {
        // (tùy chọn) phát refresh cookie nếu bật — xem §02; ở đây tối giản chỉ trả access token
        return res.json({ status: 'success', data: r.session });
      }
      case 'missing_field': return res.status(400).json({ error: 'missing_field', field: r.field });
      case 'unknown_user':  return res.status(404).end();
      case 'bad_password':  return res.status(401).json({ status: 'error', error: 'invalid_credentials' });
      case 'rate_limited':  return res.status(429).json({ error: 'too_many_attempts' });
      default:              return res.status(500).json({ error: r.error || 'unexpected_error' });
    }
  });

  router.post('/api/signout', (req, res) => { res.clearCookie(REFRESH_COOKIE, { path: '/api/refresh' }); res.status(204).end(); });

  return router;
}

module.exports = { createAuthenticationRouter };
```

> Ghi chú: refresh cookie đầy đủ (bật/tắt, HttpOnly, xoay vòng) xem §02; ở guide này tối giản để chạy
> được đăng nhập. Bạn có thể bổ sung `/api/refresh` theo §02 §6 khi cần.

---

## Bước 3 (13.3, 13.4) — Router users & roles (có middleware)

Tạo `server/auth-management/api/users.router.js`:

```javascript
//@ts-check
'use strict';
const express = require('express');
const { requirePermission } = require('./authorization.middleware');

/** @param {{ userService:any, mwDeps:any }} deps */
function createUsersRouter({ userService, mwDeps }) {
  const router = express.Router();
  const need = (p) => requirePermission(p, mwDeps);
  const map = (res, r) => {
    switch (r.kind) {
      case 'created': case 'updated': case 'found': return res.json({ status: 'success', data: r.user });
      case 'ok': return res.json({ status: 'success', data: r.users });
      case 'empty': return res.json({ status: 'success', data: null });
      case 'deleted': return res.json({ status: 'success' });
      case 'missing_field': case 'duplicate': case 'invalid': return res.status(400).json({ error: r.error });
      case 'unknown_user': return res.status(404).json({ error: r.error });
      case 'last_admin': return res.status(400).json({ error: r.error });
      default: return res.status(500).json({ error: 'unexpected_error' });
    }
  };
  router.get('/api/users', need('user.read'), async (req, res) => map(res, await userService.list()));
  router.get('/api/users/:username', need('user.read'), async (req, res) => map(res, await userService.get(req.params.username)));
  router.post('/api/users', need('user.create'), async (req, res) => map(res, await userService.create(req.body || {})));
  router.put('/api/users/:username', need('user.update'), async (req, res) => map(res, await userService.update(req.params.username, req.body || {})));
  router.delete('/api/users/:username', need('user.delete'), async (req, res) => map(res, await userService.delete(req.params.username)));
  return router;
}

module.exports = { createUsersRouter };
```

Tạo `server/auth-management/api/roles.router.js` tương tự (quyền `role.read/create/update/delete`,
map outcome của Role_Service). (Làm theo mẫu users router.)

---

## Bước 4 (13.5) — Composition root + mount 1 dòng vào FUXA

Cập nhật `server/auth-management/index.js`:

```javascript
//@ts-check
'use strict';
const path = require('path');
const express = require('express');
const { FuxaUserStoreAdapter } = require('./adapters/fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('./adapters/fuxa-role-store.adapter');
const { BcryptHasherAdapter } = require('./adapters/fuxa-bcrypt.adapter');
const { TokenAdapter } = require('./adapters/fuxa-jwt.adapter');
const { Password_Hasher } = require('./services/password-hasher');
const { Token_Service } = require('./services/token.service');
const { BruteForceGuard } = require('./services/brute-force');
const { Authentication_Service } = require('./services/authentication.service');
const { Authorization_Service } = require('./services/authorization.service');
const { Role_Service } = require('./services/role.service');
const { User_Service } = require('./services/user.service');
const { Audit_Logger, createFuxaAuditSink } = require('./services/audit-logger');
const { runBootstrap } = require('./services/bootstrap');
const { createAuthenticationRouter } = require('./api/authentication.router');
const { createUsersRouter } = require('./api/users.router');
const { createRolesRouter } = require('./api/roles.router');

/** @param {{ runtime:any }} deps -> trả { router, ready } */
function createAuthManagementModule({ runtime }) {
  const usersDbPath = path.join(runtime.settings.workDir, 'users.fuxap.db');
  const runtimeUsers = runtime.users;

  const audit = new Audit_Logger(createFuxaAuditSink(runtime.logger));
  const hasher = new Password_Hasher(new BcryptHasherAdapter({ cost: 12 }));
  const tokens = new Token_Service({ seam: new TokenAdapter(), config: {
    configuredExpiry: runtime.settings.tokenExpiresIn, isProduction: process.env.NODE_ENV === 'production',
  }});
  const userStore = new FuxaUserStoreAdapter({ runtimeUsers, usersDbPath });
  const roleStore = new FuxaRoleStoreAdapter({ runtimeUsers, usersDbPath });
  const authorization = new Authorization_Service({ roleStore, auditLogger: audit });
  const bruteForce = new BruteForceGuard({});
  const authentication = new Authentication_Service({ userStore, passwordHasher: hasher, tokenService: tokens, bruteForce, auditLogger: audit });
  const userService = new User_Service({ userStore, passwordHasher: hasher, authorization, auditLogger: audit });
  const roleService = new Role_Service({ roleStore, auditLogger: audit });

  const mwDeps = { tokenService: tokens, userStore, authorization, auditLogger: audit };

  // Bootstrap chạy nền lúc khởi động (AC-17.1)
  const ready = runBootstrap({
    userStore, passwordHasher: hasher, authorization, auditLogger: audit,
    discloseSecret: (u, s) => runtime.logger.info(`[AUTH-BOOTSTRAP] admin '${u}' initial one-time password: ${s} (doi ngay!)`),
  }).catch(e => runtime.logger.error(`auth-bootstrap failed: ${e}`));

  const router = express.Router();
  router.use(createAuthenticationRouter({ authentication, tokenService: tokens, userStore, settings: runtime.settings }));
  router.use(createUsersRouter({ userService, mwDeps }));
  router.use(createRolesRouter({ roleService, mwDeps }));
  return { router, ready };
}

module.exports = { createAuthManagementModule };
```

**Gắn vào FUXA (1 dòng chạm lõi duy nhất).** Mở `server/api/index.js`, tìm cụm mount (gần
`apiApp.use(authApi.app());`, khoảng dòng 77). Thêm:

```javascript
// --- auth-management module (mount duy nhất) ---
const authManagement = require('../auth-management');
apiApp.use(authManagement.createAuthManagementModule({ runtime }).router);
```

> Đặt SAU `apiApp.use(authLimiter);` để router mới cũng được rate-limit theo IP. Đây là thay đổi DUY
> NHẤT trong file lõi FUXA — mọi thứ khác nằm trong `auth-management/`.

---

## Bước 5 (13.6) — Test tích hợp API

Dùng `supertest` (hoặc gọi router qua express) kiểm end-to-end: đăng nhập đúng/sai/thiếu field; gọi
`/api/users` không token ⇒ 401; token non-admin ⇒ 403; admin ⇒ 200; xóa admin cuối ⇒ 400 `last_admin`.

```powershell
npm install --save-dev supertest --prefix server
```

(Chi tiết test tích hợp tùy chọn — cốt lõi là các route trả đúng mã trạng thái theo service.)

---

## Cách kiểm chứng

- Chạy toàn bộ test module: `npm test --prefix server` → xanh.
- Khởi động FUXA (`node server/main.js`), xem log có dòng `[AUTH-BOOTSTRAP] admin ... initial one-time password: ...`
  (lần đầu, store chưa có admin). Gọi thử `POST http://localhost:1881/api/signin` với admin + mật khẩu đó.

## Đã xong task khi

- [ ] Middleware dựng Identity + nạp mustRotate + quyết định 401/403.
- [ ] 3 router hoạt động; composition root ráp đủ service + chạy bootstrap.
- [ ] Đúng **1 dòng** thêm vào `server/api/index.js`.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 13 (13.1–13.6) |
| Requirement | 1.x, 3.x, 5–9.x, 10.2/10.3, 16.3/16.4, 17.1 |
| Thiết kế | §01/§02/§04/§05/§12 |
| Quyết định | D-003 (1 dòng mount), D-011 (module riêng) |

➡️ Xong Task 13 → sang `12-task-15-client.md` (client HTTP + UI). Sẽ tạo tiếp.
