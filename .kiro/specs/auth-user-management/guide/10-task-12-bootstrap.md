# 10 — Task 12: Admin Bootstrap (admin đầu tiên + đổi mật khẩu + di trú)

> Tương ứng **Task 12** trong `../tasks.md`. Requirement: 17.1–17.5, 8.5 (P-010).
> Thiết kế: `../design/12-admin-bootstrap.md`. Sở hữu **P-009**, đồng sở hữu **P-010**.

## Mục tiêu

Khi khởi động: nếu **chưa có admin nào**, gieo **đúng một** admin với **mật khẩu ngẫu nhiên một lần**
(KHÔNG bao giờ '123456') và cờ `mustRotate=true`. Admin này chỉ được **đổi mật khẩu** cho tới khi đổi
xong. Với install FUXA cũ (đang có admin '123456'), **ép đổi**. Diệt tận gốc lỗ hổng N-007.

## Phụ thuộc

Task 2 (User_Store), Task 3 (Password_Hasher), Task 8 (Authorization.isAdministrator), Task 11 (Audit_Logger).

## Kiến thức nền (đã kiểm chứng, N-007)

- FUXA `usrstorage.setDefault` gieo `admin` với `bcrypt.hashSync('123456',10)`, `groups=-1`, **không**
  bắt đổi. Ta KHÔNG dùng lại '123456'.
- **Vì sao cần cả 2 lớp:** đăng nhập KHÔNG bị cổng phân quyền chặn. Nếu mật khẩu là '123456' quen thuộc
  + chỉ có cổng, kẻ tấn công vẫn đăng nhập được rồi **tự đổi mật khẩu** để chiếm admin. Dùng mật khẩu
  ngẫu nhiên chặn đường đó; cổng `mustRotate` chặn mọi thao tác khác trước khi đổi.

---

## Bước 1 (12.1) — Bootstrap routine

Tạo `server/auth-management/services/bootstrap.js`:

```javascript
//@ts-check
'use strict';
const crypto = require('crypto');

/** Sinh mật khẩu ngẫu nhiên mạnh, một lần (KHÔNG bao giờ '123456'). */
function generateOneTimeSecret() {
  return crypto.randomBytes(24).toString('base64url'); // ~32 ký tự ngẫu nhiên
}

/**
 * Chạy MỘT LẦN lúc khởi động.
 * @param {{ userStore:any, passwordHasher:any, authorization:any, auditLogger:any,
 *           adminUsername?:string, discloseSecret?:(u:string,s:string)=>void }} deps
 */
async function runBootstrap(deps) {
  const { userStore, passwordHasher, authorization, auditLogger } = deps;
  const adminUsername = deps.adminUsername || 'admin';
  const disclose = deps.discloseSecret || ((u, s) => { /* mặc định: ghi ra log server 1 lần */ });

  const { records } = await userStore.readAll();
  // Kiểm tra theo NỘI DUNG: có admin nào không (khác FUXA kiểm theo file tồn tại)
  let admins = [];
  for (const r of records) if (await authorization.isAdministrator(r)) admins.push(r);

  if (admins.length === 0) {
    // AC-17.1: gieo đúng 1 admin, mật khẩu ngẫu nhiên, mustRotate=true
    const secret = generateOneTimeSecret();
    const passwordHash = passwordHasher.hash(secret);
    await userStore.create({
      username: adminUsername, fullname: 'Administrator Account',
      passwordHash, groups: -1, roles: [], metadata: { mustRotate: true },
    });
    try { auditLogger.record({ category: 'bootstrap.seed', subject: adminUsername, operation: 'seed', outcome: 'seeded', timestamp: new Date().toISOString() }); } catch (_e) {}
    disclose(adminUsername, secret); // lộ MỘT LẦN qua kênh an toàn
    return { seeded: true, username: adminUsername };
  }

  // AC-17.4: đã có admin ⇒ KHÔNG gieo. Nhưng di trú admin '123456' nếu phát hiện (D-013(1), bắt buộc)
  await remediateKnownDefaultAdmins(deps, admins);
  return { seeded: false };
}

/** Di trú: admin nào chưa có mustRotate và hash verify '123456' ⇒ ép đổi. */
async function remediateKnownDefaultAdmins(deps, admins) {
  const { userStore, passwordHasher } = deps;
  for (const a of admins) {
    const alreadyGated = a.metadata && a.metadata.mustRotate;
    if (alreadyGated) continue;
    if (passwordHasher.verify('123456', a.passwordHash)) {
      // đặt mật khẩu ngẫu nhiên mới + bật cờ đổi
      const newHash = passwordHasher.hash(generateOneTimeSecret());
      await userStore.update(a.username, { passwordHash: newHash, metadata: Object.assign({}, a.metadata, { mustRotate: true }) });
    }
  }
}

module.exports = { runBootstrap, remediateKnownDefaultAdmins, generateOneTimeSecret };
```

## Bước 2 (12.2) — Đổi mật khẩu (thao tác DUY NHẤT được phép khi bị cổng)

Tạo `server/auth-management/services/account.service.js`:

```javascript
//@ts-check
'use strict';

class Account_Service {
  /** @param {{ userStore:any, passwordHasher:any, auditLogger:any }} deps */
  constructor({ userStore, passwordHasher, auditLogger }) {
    this.store = userStore; this.hasher = passwordHasher; this.audit = auditLogger;
  }

  /** AC-17.3: đổi mật khẩu, xác minh mật khẩu hiện tại, chặn dùng lại, xóa cờ mustRotate. */
  async rotatePassword(username, { currentPassword, newPassword }) {
    const u = await this.store.get(username);
    if (!u) return { kind: 'unknown_user', error: 'user_not_found' };
    if (!this.hasher.verify(currentPassword, u.passwordHash)) return { kind: 'bad_current', error: 'bad_current_password' };
    if (!newPassword || newPassword === currentPassword) return { kind: 'invalid_new', error: 'weak_or_reused_password' };

    const passwordHash = this.hasher.hash(newPassword);
    const metadata = Object.assign({}, u.metadata, { mustRotate: false }); // xóa cổng
    await this.store.update(username, { passwordHash, metadata });
    try { this.audit.record({ category: 'user.update', subject: username, operation: 'rotatePassword', outcome: 'ok', timestamp: new Date().toISOString() }); } catch (_e) {}
    return { kind: 'rotated' };
  }
}

module.exports = { Account_Service };
```

> Cổng `mustRotate` được **thực thi** ở `Authorization_Service` (Task 8, đã có): khi `identity.mustRotate`
> true thì chỉ cho `account.rotatePassword`. Task 13 sẽ nạp `mustRotate` vào identity từ store.

---

## Bước 3 (12.4) — Property test P-009 (admin gieo không làm được gì trước khi đổi)

Tạo `server/auth-management/services/bootstrap.test.js`:

```javascript
//@ts-check
'use strict';
const fc = require('fast-check');
const { expect } = require('chai');
const { Authorization_Service } = require('./authorization.service');

const PERM_POOL = ['user.create', 'user.read', 'user.update', 'user.delete', 'role.read', 'account.rotatePassword', 'x.y'];

describe('Bootstrap gate — P-009', () => {
  it('Feature: auth-user-management, Property 9: A seeded admin cannot act before password rotation', async () => {
    const svc = new Authorization_Service({ roleStore: { readAll: async () => ({ records: [] }) } });
    await fc.assert(fc.asyncProperty(fc.constantFrom(...PERM_POOL), async (perm) => {
      // admin gieo: groups=-1 (admin), mustRotate=true
      const gated = { authenticated: true, groups: -1, roles: [], mustRotate: true };
      const d = await svc.isAllowed(gated, { requiredPermission: perm });
      if (perm === 'account.rotatePassword') expect(d.allow).to.equal(true);
      else expect(d.allow).to.equal(false);   // mọi thao tác khác bị chặn, dù là admin

      // sau khi đổi (mustRotate=false): admin làm được mọi thao tác admin
      const rotated = { authenticated: true, groups: -1, roles: [], mustRotate: false };
      const d2 = await svc.isAllowed(rotated, { requiredPermission: perm });
      if (perm === 'x.y') expect(d2.allow).to.equal(false); // quyền không thuộc admin set
      else expect(d2.allow).to.equal(true);
    }), { numRuns: 100 });
  });
});
```

## Bước 4 (12.5) — Property test P-010 (luôn còn ≥1 admin qua mọi chuỗi xóa)

Chạy trên store thật + User_Service. Tạo `server/auth-management/services/last-admin.test.js`:

```javascript
//@ts-check
'use strict';
const fc = require('fast-check');
const { expect } = require('chai');
const path = require('path'); const os = require('os'); const fs = require('fs');
const runtimeUsers = require('../../../runtime/users');
const { FuxaUserStoreAdapter } = require('../adapters/fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('../adapters/fuxa-role-store.adapter');
const { Authorization_Service } = require('./authorization.service');
const { User_Service } = require('./user.service');

describe('Always >=1 admin — P-010', function () {
  this.timeout(30000);
  it('Feature: auth-user-management, Property 10: For any sequence of deletions on a store starting with >=1 admin, >=1 admin always remains', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.constantFrom('admin1', 'admin2', 'user1'), { maxLength: 8 }),
      async (deletions) => {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-test-'));
        await runtimeUsers.init({ workDir }, { info(){}, warn(){}, error(){} });
        const dbPath = path.join(workDir, 'users.fuxap.db');
        const userStore = new FuxaUserStoreAdapter({ runtimeUsers, usersDbPath: dbPath });
        const roleStore = new FuxaRoleStoreAdapter({ runtimeUsers, usersDbPath: dbPath });
        const authz = new Authorization_Service({ roleStore });
        const hasher = { hash: () => 'H', verify: () => true };
        const audit = { record() {} };
        const users = new User_Service({ userStore, passwordHasher: hasher, authorization: authz, auditLogger: audit });

        // Bắt đầu: 2 admin (groups=-1) + 1 user thường
        await userStore.create({ username: 'admin1', fullname: 'A1', passwordHash: 'H', roles: [], groups: -1, metadata: {} });
        await userStore.create({ username: 'admin2', fullname: 'A2', passwordHash: 'H', roles: [], groups: -1, metadata: {} });
        await userStore.create({ username: 'user1', fullname: 'U1', passwordHash: 'H', roles: [], groups: 1, metadata: {} });

        for (const target of deletions) {
          await users.delete(target); // last_admin sẽ bị từ chối bên trong
          const { records } = await userStore.readAll();
          let admins = 0;
          for (const r of records) if (await authz.isAdministrator(r)) admins++;
          expect(admins).to.be.greaterThan(0); // BẤT BIẾN: luôn còn ≥1 admin
        }
      }
    ), { numRuns: 30 });
  });
});
```

## Bước 5 (12.6) — Test gieo/di trú & bảo mật

Thêm test (dùng store thật, workDir tạm):
- Store rỗng ⇒ `runBootstrap` tạo đúng 1 admin, `metadata.mustRotate===true`, và hash **không** verify '123456'.
- Chạy `runBootstrap` lần 2 ⇒ không tạo thêm admin (idempotent, AC-17.4).
- Gieo admin kiểu FUXA (`passwordHasher.hash('123456')`) rồi `runBootstrap` ⇒ admin đó bị bật `mustRotate`
  và hash mới không còn verify '123456' (di trú, D-013(1)).

---

## Cách kiểm chứng

```powershell
npx mocha "server/auth-management/services/bootstrap.test.js" "server/auth-management/services/last-admin.test.js" --timeout 30000
```

Mong đợi: **P-009, P-010 PASS**; test gieo/di trú PASS.

## Đã xong task khi

- [ ] Gieo admin dùng mật khẩu ngẫu nhiên (không '123456'), `mustRotate=true`, ghi `bootstrap.seed`.
- [ ] `rotatePassword` xác minh mật khẩu cũ, chặn dùng lại, xóa cờ.
- [ ] Di trú ép đổi admin '123456' của FUXA cũ.
- [ ] P-009, P-010 PASS.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 12 (12.1–12.6) |
| Requirement | 17.1–17.5, 8.5 |
| Thiết kế | `../design/12-admin-bootstrap.md` |
| Property | P-009 (§12), P-010 (§04+§12) |
| Quyết định | D-005/D-012/D-013 (gieo an toàn + di trú), N-007 (gốc rễ) |

➡️ Xong Task 12 → sang `11-task-13-api.md` (sẽ tạo tiếp).
