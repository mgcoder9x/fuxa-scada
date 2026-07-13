# 07 — Task 8: RBAC (vai trò & phân quyền)

> Tương ứng **Task 8** trong `../tasks.md`. Requirement: 9.1–9.5, 10.1–10.5, 17.2.
> Thiết kế: `../design/05-rbac-authorization.md`. Sở hữu **P-006, P-011, P-013** và **định nghĩa admin** dùng chung.

> ### ⚠️ ĐỐI CHIẾU (2026-07-13) — GHI ĐÈ theo D-015 (thẩm quyền theo bản ghi sống)
> Bản cũ dựng `Identity.roles/groups` từ **claim trong token** — user bị xóa/hạ quyền vẫn giữ quyền tới khi token
> hết hạn (defect **N-011**). Sửa (task 8.2, property **P-013** tại 8.6):
> - `Authorization_Service`/middleware dựng `Identity` từ **bản ghi `User_Record` sống** đọc qua `User_Store`
>   (`getUserCache`): roles/groups/`mustRotate`/**sự tồn tại** đều lấy từ store, **không** từ token.
> - Kiểm **`tokenVersion`**: token đóng dấu phiên bản cũ hơn phiên bản hiện tại của tài khoản ⇒ **từ chối**
>   (thu hồi chủ động khi logout/đổi mật khẩu/đổi vai trò/disable). Token `roles`/`groups` chỉ để tương thích.
> - Xem `../design/05` §4.1 và `../design/02` §3.

## Mục tiêu

Có `Role_Service` (CRUD vai trò) và `Authorization_Service` (quyết định cho phép/từ chối), cùng
hàm `isAdministrator(subject)` — định nghĩa DUY NHẤT "ai là admin" mà Task 9 (xóa admin cuối) và
Task 12 (bootstrap) đều dùng.

## Phụ thuộc

Task 2 (Role_Store), Task 1 (models/permission có `ADMIN_PERMISSION_SET`). Task 5 (verify token) cho
việc dựng Identity ở tầng API (Task 13).

## Kiến thức nền (đã kiểm chứng)

- FUXA: `adminGroups = [-1, 255]`; `haveAdminPermission(groupCode)` trả true nếu group ∈ đó. Admin gieo
  sẵn có `groups = -1`.
- Quy tắc **hướng thẩm quyền**: RBAC (vai trò→quyền) là nguồn sự thật; group-code chỉ là **đầu vào tương
  thích** cộng thêm `ADMIN_PERMISSION_SET`, không ghi đè.
- 401 (chưa xác thực) TÁCH khỏi 403 (đã xác thực nhưng thiếu quyền) — khác FUXA (gộp 401).

---

## Bước 1 (8.1) — Role_Service

Tạo `server/auth-management/services/role.service.js`:

```javascript
//@ts-check
'use strict';
const { validateRole } = require('../models/role');

class Role_Service {
  /** @param {{ roleStore:any, auditLogger:any }} deps */
  constructor({ roleStore, auditLogger }) { this.roles = roleStore; this.audit = auditLogger; }

  _audit(category, name) {
    try { this.audit.record({ category, subject: name, timestamp: new Date().toISOString(), outcome: 'ok' }); }
    catch (_e) {}
  }

  async create(input) {
    const v = validateRole(input);
    if (!v.ok) return { kind: 'invalid', error: 'validation_error', detail: v.error };
    const existing = await this.roles.get(v.role.id);
    if (existing) return { kind: 'duplicate', error: 'duplicate_role', name: v.role.id }; // AC-9.5, không đè
    await this.roles.create(v.role);
    this._audit('role.create', v.role.id);
    return { kind: 'created', role: v.role };
  }

  async list() {
    const { records } = await this.roles.readAll();
    return { kind: 'ok', roles: records };
  }

  async update(id, permissions) {                     // AC-9.3: thay TOÀN BỘ tập quyền
    const existing = await this.roles.get(id);
    if (!existing) return { kind: 'unknown_role', error: 'role_not_found', name: id };
    const role = { id, name: existing.name, permissions: Array.isArray(permissions) ? permissions : [] };
    const v = validateRole(role);
    if (!v.ok) return { kind: 'invalid', error: 'validation_error', detail: v.error };
    await this.roles.update(v.role);
    this._audit('role.update', id);
    return { kind: 'updated', role: v.role };
  }

  async delete(ids) {                                 // AC-9.4: xóa + cắt id khỏi mọi user (adapter lo)
    await this.roles.delete(ids);
    for (const id of ids) this._audit('role.delete', id);
    return { kind: 'deleted', removed: ids };
  }
}

module.exports = { Role_Service };
```

---

## Bước 2 (8.2) — Authorization_Service + hàm isAdministrator

Tạo `server/auth-management/services/authorization.service.js`:

```javascript
//@ts-check
'use strict';
const { ADMIN_PERMISSION_SET } = require('../models/permission');

const ADMIN_GROUP_CODES = [-1, 255]; // khớp FUXA adminGroups

/** group-code có phải admin không (đầu vào tương thích, chỉ CỘNG thêm quyền admin). */
function groupIsAdmin(groups) {
  const arr = Array.isArray(groups) ? groups : [groups];
  return arr.some(g => ADMIN_GROUP_CODES.includes(g));
}

class Authorization_Service {
  /** @param {{ roleStore:any, auditLogger?:any }} deps */
  constructor({ roleStore, auditLogger }) { this.roles = roleStore; this.audit = auditLogger; }

  /** Giải tập quyền hiệu lực của một identity/subject: hợp quyền các vai trò ∪ (admin nếu group admin). */
  async _effectivePermissions(subject) {
    const set = new Set();
    const roleIds = Array.isArray(subject.roles) ? subject.roles : [];
    if (roleIds.length) {
      const { records } = await this.roles.readAll();
      const byId = new Map(records.map(r => [r.id, r]));
      for (const rid of roleIds) {
        const role = byId.get(rid);
        if (role && Array.isArray(role.permissions)) role.permissions.forEach(p => set.add(p));
      }
    }
    if (groupIsAdmin(subject.groups)) ADMIN_PERMISSION_SET.forEach(p => set.add(p)); // cộng thêm
    return set;
  }

  /** Định nghĩa DUY NHẤT "ai là admin" — Task 9 & 12 dùng lại. */
  async isAdministrator(subject) {
    const perms = await this._effectivePermissions(subject);
    return ADMIN_PERMISSION_SET.every(p => perms.has(p));
  }

  /**
   * Quyết định theo thứ tự: chưa xác thực→401; cổng bootstrap (mustRotate)→403 trừ rotate;
   * thành viên tập quyền→cho/403; mặc định fail-closed từ chối.
   * @param {{authenticated?:boolean, roles?:string[], groups?:any, mustRotate?:boolean}} identity
   * @param {{requiredPermission:string}} operation
   */
  async isAllowed(identity, operation) {
    if (!identity || identity.authenticated === false) {          // AC-10.3
      return { allow: false, status: 401, error: 'unauthorized_error' };
    }
    if (identity.mustRotate && operation.requiredPermission !== 'account.rotatePassword') { // AC-17.2
      return { allow: false, status: 403, error: 'forbidden' };
    }
    const perms = await this._effectivePermissions(identity);
    if (operation && operation.requiredPermission && perms.has(operation.requiredPermission)) {
      return { allow: true };                                     // AC-10.1 (admin ⇒ AC-10.4)
    }
    return { allow: false, status: 403, error: 'forbidden' };     // AC-10.2 + fail-closed mặc định
  }
}

module.exports = { Authorization_Service, groupIsAdmin };
```

---

## Bước 3 (8.3) — Property test P-006 (quyết định tất định)

Tạo `server/auth-management/services/authorization.service.test.js`:

```javascript
//@ts-check
'use strict';
const fc = require('fast-check');
const { expect } = require('chai');
const { Authorization_Service } = require('./authorization.service');

// Role store giả với tập vai trò cố định (không đổi giữa 2 lần gọi).
function fakeRoleStore(roles) {
  return { readAll: async () => ({ records: roles, errors: [] }), get: async (id) => roles.find(r => r.id === id) };
}
const PERM_POOL = ['user.create', 'user.read', 'role.read', 'x.y', 'account.rotatePassword'];

describe('Authorization_Service', () => {
  it('Feature: auth-user-management, Property 6: Authorization decisions are deterministic', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        authenticated: fc.boolean(),
        roles: fc.array(fc.constantFrom('admin', 'reader', 'ghost'), { maxLength: 3 }),
        groups: fc.constantFrom(-1, 255, 1, 'guest'),
        mustRotate: fc.boolean(),
      }),
      fc.constantFrom(...PERM_POOL),
      async (identity, requiredPermission) => {
        const store = fakeRoleStore([
          { id: 'admin', name: 'Admin', permissions: ['user.create', 'user.read', 'user.update', 'user.delete', 'role.create', 'role.read', 'role.update', 'role.delete'] },
          { id: 'reader', name: 'Reader', permissions: ['user.read'] },
        ]);
        const svc = new Authorization_Service({ roleStore: store });
        const op = { requiredPermission };
        const d1 = await svc.isAllowed(identity, op);
        const d2 = await svc.isAllowed(identity, op);   // gọi lại, KHÔNG đổi gì
        expect(d2).to.deep.equal(d1);                    // cùng quyết định
      }
    ), { numRuns: 100 });
  });

  it('AC-10.3/10.2/10.4: 401 chưa xác thực; 403 thiếu quyền; admin group ⇒ cho', async () => {
    const store = fakeRoleStore([]);
    const svc = new Authorization_Service({ roleStore: store });
    expect((await svc.isAllowed({ authenticated: false }, { requiredPermission: 'user.read' })).status).to.equal(401);
    expect((await svc.isAllowed({ authenticated: true, roles: [], groups: 1 }, { requiredPermission: 'user.read' })).status).to.equal(403);
    expect((await svc.isAllowed({ authenticated: true, roles: [], groups: -1 }, { requiredPermission: 'user.delete' })).allow).to.equal(true);
  });

  it('AC-17.2: mustRotate ⇒ chỉ cho account.rotatePassword', async () => {
    const svc = new Authorization_Service({ roleStore: fakeRoleStore([]) });
    const id = { authenticated: true, roles: [], groups: -1, mustRotate: true };
    expect((await svc.isAllowed(id, { requiredPermission: 'user.read' })).allow).to.equal(false);
    expect((await svc.isAllowed(id, { requiredPermission: 'account.rotatePassword' })).allow).to.equal(true);
  });
});
```

## Bước 4 (8.4) — Property test P-011 (xóa vai trò cắt sạch tham chiếu)

Test này chạy trên store thật (như Task 2). Tạo
`server/auth-management/services/role.prune.test.js`:

```javascript
//@ts-check
'use strict';
const fc = require('fast-check');
const { expect } = require('chai');
const path = require('path'); const os = require('os'); const fs = require('fs');
const runtimeUsers = require('../../../runtime/users');
const { FuxaUserStoreAdapter } = require('../adapters/fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('../adapters/fuxa-role-store.adapter');

describe('Role deletion prune', function () {
  this.timeout(30000);
  let userStore, roleStore;
  before(async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-test-'));
    await runtimeUsers.init({ workDir }, { info(){}, warn(){}, error(){} });
    const dbPath = path.join(workDir, 'users.fuxap.db');
    userStore = new FuxaUserStoreAdapter({ runtimeUsers, usersDbPath: dbPath });
    roleStore = new FuxaRoleStoreAdapter({ runtimeUsers, usersDbPath: dbPath });
  });

  it('Feature: auth-user-management, Property 11: After role deletion, no surviving user references a deleted role id and no deleted role remains', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.constantFrom('r1', 'r2', 'r3'), { maxLength: 3 }), // vai trò gán cho user
      fc.subarray(['r1', 'r2', 'r3']),                              // vai trò sẽ xóa
      async (userRoles, toDelete) => {
        for (const id of ['r1', 'r2', 'r3']) await roleStore.create({ id, name: id, permissions: [] });
        await userStore.create({ username: 'u', fullname: 'U', passwordHash: 'H', roles: [...new Set(userRoles)], metadata: {} });
        if (toDelete.length) await roleStore.delete(toDelete);
        // Không user nào còn tham chiếu vai trò đã xóa
        const back = await userStore.get('u');
        for (const d of toDelete) expect(back.roles).to.not.include(d);
        // Không vai trò đã xóa nào còn trong store
        const remaining = (await roleStore.readAll()).records.map(r => r.id);
        for (const d of toDelete) expect(remaining).to.not.include(d);
        // dọn
        await userStore.delete('u');
        await roleStore.delete(['r1', 'r2', 'r3']);
      }
    ), { numRuns: 50 }); // 50 đủ và nhanh vì có I/O DB
  });
});
```

> Ghi chú: dùng 50 vòng vì mỗi vòng có ghi/đọc DB (chậm hơn). Vẫn đủ mạnh cho invariant này.

## Bước 5 (8.5) — Test CRUD vai trò

Thêm test đơn vị cho `Role_Service` (dùng roleStore giả bằng `sinon`): tạo trùng id ⇒ `duplicate`
không đè; update thay toàn bộ quyền; delete gọi `roleStore.delete(ids)`.

---

## Cách kiểm chứng

```powershell
npx mocha "server/auth-management/services/authorization.service.test.js" "server/auth-management/services/role.prune.test.js" --timeout 30000
```

Mong đợi: **P-006, P-011 + các test AC PASS**.

## Đã xong task khi

- [ ] `isAllowed` theo đúng thứ tự 401 → cổng mustRotate → membership → fail-closed.
- [ ] `isAdministrator` là định nghĩa dùng chung (Task 9/12 sẽ import).
- [ ] P-006, P-011 PASS; test AC-10.x và AC-17.2 PASS.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 8 (8.1–8.5) |
| Requirement | 9.1–9.5, 10.1–10.5, 17.2 |
| Thiết kế | `../design/05-rbac-authorization.md` |
| Property | P-006, P-011 (§05) |

➡️ Xong Task 8 → sang `08-task-9-user-crud.md` (sẽ tạo tiếp).
