# 01 — Task 1: Khung module + mô hình dữ liệu + interface

> Tương ứng **Task 1** trong `../tasks.md`. Requirement: 16.1, 16.2, 16.5, 13.1, 13.2.
> Thiết kế chi tiết: `../design/11-data-models.md` và mục "Design Principles" trong `../design.md`.

## Mục tiêu

Sau task này bạn có: bộ khung thư mục `server/auth-management/`, các **mô hình dữ liệu**
(User_Record, Role, Permission, Audit_Event) kèm hàm kiểm tra bất biến, và các **interface**
(hợp đồng) cho Store/Password_Hasher/Token_Service/Audit_Logger. Chưa có logic thật — chỉ khung
và ràng buộc. Đây là nền để mọi task sau lắp vào.

## Phụ thuộc

Không có (đây là task đầu). Chỉ cần đã làm xong `00-chuan-bi.md`.

## File sẽ tạo

```
server/auth-management/
  models/user-record.js
  models/role.js
  models/permission.js
  models/audit-event.js
  store/user-store.interface.js
  store/role-store.interface.js
  services/interfaces.js
  index.js
  models/models.test.js        (test bất biến — Task 1.2)
```

---

## Bước 1 — Tạo mô hình Permission (đơn giản nhất, làm trước)

Permission (quyền) là một chuỗi dạng `<tài_nguyên>.<hành_động>`, ví dụ `user.create`.
Tạo file `server/auth-management/models/permission.js`:

```javascript
//@ts-check
'use strict';

// Bất biến INV-7: id quyền theo dạng <resource>.<action>, chữ thường, phân tách bằng dấu chấm.
const PERMISSION_ID_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

/** Kiểm tra một chuỗi có phải id quyền hợp lệ không. */
function isValidPermissionId(id) {
  return typeof id === 'string' && PERMISSION_ID_REGEX.test(id);
}

// Tập quyền quản trị (định nghĩa "ai là admin"). Khớp với ../design/05-rbac-authorization.md §2.2.
const ADMIN_PERMISSION_SET = Object.freeze([
  'user.create', 'user.read', 'user.update', 'user.delete',
  'role.create', 'role.read', 'role.update', 'role.delete',
]);

module.exports = { isValidPermissionId, ADMIN_PERMISSION_SET, PERMISSION_ID_REGEX };
```

**Giải thích:** regex bắt đúng dạng `a.b` (ít nhất 2 phần). `ADMIN_PERMISSION_SET` được "đóng băng"
để không ai sửa nhầm lúc chạy. Ta tách ra đây để §04/§05/§12 dùng chung một định nghĩa admin.

---

## Bước 2 — Tạo mô hình Role

Role (vai trò) = `{ id, name, permissions[] }`. Tạo `server/auth-management/models/role.js`:

```javascript
//@ts-check
'use strict';
const { isValidPermissionId } = require('./permission');

/**
 * Chuẩn hóa + kiểm tra một Role.
 * @returns {{ ok: true, role: {id:string,name:string,permissions:string[]} } | { ok:false, error:string }}
 */
function validateRole(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'role_not_object' };
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const name = typeof input.name === 'string' ? input.name : '';
  if (!id) return { ok: false, error: 'role_id_required' };
  const perms = Array.isArray(input.permissions) ? input.permissions : [];
  for (const p of perms) {
    if (!isValidPermissionId(p)) return { ok: false, error: `invalid_permission:${p}` };
  }
  return { ok: true, role: { id, name, permissions: perms } };
}

module.exports = { validateRole };
```

**Giải thích:** `id` là khóa định danh (bắt buộc, đã trim). `permissions` phải toàn id hợp lệ.
Ta trả `{ok:false,error}` thay vì ném lỗi — theo quy ước "kết quả dạng tập đóng".

---

## Bước 3 — Tạo mô hình User_Record (quan trọng: bất biến INV-1 và INV-3)

Tạo `server/auth-management/models/user-record.js`:

```javascript
//@ts-check
'use strict';

// Khóa 'roles' ở CẤP CAO NHẤT của metadata bị CẤM (INV-1): nó dành riêng cho danh sách vai trò
// khi lưu vào cột info của FUXA. Xem ../design/06-persistence-and-serialization.md §3.2.
function metadataHasReservedRolesKey(metadata) {
  return !!metadata && typeof metadata === 'object'
    && Object.prototype.hasOwnProperty.call(metadata, 'roles');
}

/**
 * Kiểm tra một User_Record ở dạng miền (domain), TRƯỚC khi map sang shape của FUXA.
 * Lưu ý: passwordHash phải là HASH (không bao giờ plaintext) — INV-3. Việc băm do
 * Password_Hasher làm ở tầng service, không phải ở đây; đây chỉ kiểm tra hình dạng.
 */
function validateUserRecord(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'user_not_object' };
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (!username) return { ok: false, error: 'username_required' };

  const roles = Array.isArray(input.roles) ? input.roles : [];
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};

  // INV-1: metadata KHÔNG được có khóa 'roles' ở cấp cao nhất.
  if (metadataHasReservedRolesKey(metadata)) return { ok: false, error: 'metadata_reserved_roles_key' };

  return {
    ok: true,
    user: {
      username,
      fullname: typeof input.fullname === 'string' ? input.fullname : '',
      passwordHash: typeof input.passwordHash === 'string' ? input.passwordHash : '',
      roles,
      metadata,
      groups: input.groups, // mã nhóm FUXA (tương thích), có thể là số hoặc mảng
    },
  };
}

module.exports = { validateUserRecord, metadataHasReservedRolesKey };
```

**Giải thích:**
- INV-1 (khóa `roles` dành riêng): nếu metadata tự mang khóa `roles` cấp cao nhất, khi lưu vào
  `info` nó sẽ đè lên danh sách vai trò → sai. Nên ta chặn ngay.
- INV-3 (không plaintext): model chỉ mang `passwordHash`; không có trường `password` plaintext.
  Việc băm là của `Password_Hasher` (Task 3), không làm ở model.

---

## Bước 4 — Tạo mô hình Audit_Event (không có trường bí mật)

Tạo `server/auth-management/models/audit-event.js`:

```javascript
//@ts-check
'use strict';

// Audit_Event KHÔNG có trường password/hash/token — bí mật không thể lọt vào (AC-14.5).
// Xem ../design/09-audit-logging.md §2.2.
const AUDIT_CATEGORIES = Object.freeze([
  'auth.signin',
  'user.create', 'user.update', 'user.delete',
  'role.create', 'role.update', 'role.delete',
  'authz.denied',
  'bootstrap.seed',
]);

/** Tạo một Audit_Event đã chuẩn hóa (chỉ giữ các trường an toàn). */
function makeAuditEvent({ category, subject, operation, outcome, timestamp, detail }) {
  return {
    category, subject,
    operation: operation || undefined,
    outcome,
    timestamp,               // ISO-8601, do bên gọi cung cấp (AC-14.5)
    detail: detail || undefined,
  };
}

module.exports = { AUDIT_CATEGORIES, makeAuditEvent };
```

---

## Bước 5 — Tạo interface cho Store (hợp đồng, dạng JSDoc)

Interface trong JS không "ép" như TypeScript, nhưng ta viết hợp đồng rõ bằng JSDoc + một lớp
cơ sở ném lỗi "chưa cài đặt" để ai quên override sẽ biết ngay.

Tạo `server/auth-management/store/user-store.interface.js`:

```javascript
//@ts-check
'use strict';

/**
 * Hợp đồng User_Store. Adapter thật (Task 2) sẽ implement. Tầng service chỉ phụ thuộc hợp đồng này,
 * KHÔNG biết shape của FUXA (AC-16.5).
 * @typedef {{ records: any[], errors: {key:string,error:string,detail?:string}[] }} ReadAllResult
 */
class User_Store {
  /** @param {string} username @returns {Promise<any|undefined>} */
  async get(username) { throw new Error('not_implemented:User_Store.get'); }
  /** @returns {Promise<ReadAllResult>} */
  async readAll() { throw new Error('not_implemented:User_Store.readAll'); }
  /** @param {any} record @returns {Promise<void>} */
  async create(record) { throw new Error('not_implemented:User_Store.create'); }
  /** @param {string} username @param {any} patch @returns {Promise<void>} */
  async update(username, patch) { throw new Error('not_implemented:User_Store.update'); }
  /** @param {string} username @returns {Promise<void>} */
  async delete(username) { throw new Error('not_implemented:User_Store.delete'); }
}

module.exports = { User_Store };
```

Tạo `server/auth-management/store/role-store.interface.js` tương tự:

```javascript
//@ts-check
'use strict';

class Role_Store {
  /** @param {string} id */
  async get(id) { throw new Error('not_implemented:Role_Store.get'); }
  async readAll() { throw new Error('not_implemented:Role_Store.readAll'); }
  /** @param {any} role */
  async create(role) { throw new Error('not_implemented:Role_Store.create'); }
  /** @param {any} role */
  async update(role) { throw new Error('not_implemented:Role_Store.update'); }
  /** @param {string[]} ids */
  async delete(ids) { throw new Error('not_implemented:Role_Store.delete'); }
}

module.exports = { Role_Store };
```

---

## Bước 6 — Tạo interface cho các service khác (stub)

Tạo `server/auth-management/services/interfaces.js` gom các hợp đồng còn lại:

```javascript
//@ts-check
'use strict';

class Password_Hasher {
  /** @param {string} plaintext @returns {string} */
  hash(plaintext) { throw new Error('not_implemented:Password_Hasher.hash'); }
  /** @param {string} plaintext @param {string} hash @returns {boolean} */
  verify(plaintext, hash) { throw new Error('not_implemented:Password_Hasher.verify'); }
}

class Token_Service {
  issueAccessToken(identity) { throw new Error('not_implemented:Token_Service.issueAccessToken'); }
  issueRefreshToken(identity) { throw new Error('not_implemented:Token_Service.issueRefreshToken'); }
  verify(token) { throw new Error('not_implemented:Token_Service.verify'); }
  refresh(refreshToken) { throw new Error('not_implemented:Token_Service.refresh'); }
}

class Audit_Logger {
  /** @param {any} event @returns {void} */
  record(event) { throw new Error('not_implemented:Audit_Logger.record'); }
}

class BruteForceGuard {
  checkAllowed(username, now) { throw new Error('not_implemented:BruteForceGuard.checkAllowed'); }
  recordFailure(username, now) { throw new Error('not_implemented:BruteForceGuard.recordFailure'); }
  reset(username) { throw new Error('not_implemented:BruteForceGuard.reset'); }
}

module.exports = { Password_Hasher, Token_Service, Audit_Logger, BruteForceGuard };
```

---

## Bước 7 — Tạo composition root rỗng

Tạo `server/auth-management/index.js` (giờ chỉ là chỗ giữ chỗ, Task 13 mới ráp thật):

```javascript
//@ts-check
'use strict';

// Composition root của module auth-management.
// Task 13 sẽ: khởi tạo adapter -> service -> chạy bootstrap -> export router đã mount.
// Hiện tại để rỗng có chủ đích.
function createAuthManagementModule(/* deps */) {
  throw new Error('not_implemented:createAuthManagementModule (sẽ làm ở Task 13)');
}

module.exports = { createAuthManagementModule };
```

---

## Bước 8 (Task 1.2) — Viết test cho bất biến mô hình dữ liệu

Tạo `server/auth-management/models/models.test.js`:

```javascript
//@ts-check
'use strict';
const { expect } = require('chai');
const { validateUserRecord } = require('./user-record');
const { validateRole } = require('./role');
const { isValidPermissionId } = require('./permission');

describe('Data models — invariants', () => {
  it('INV-1: metadata không được có khóa roles cấp cao nhất', () => {
    const r = validateUserRecord({ username: 'alice', metadata: { roles: ['x'] } });
    expect(r.ok).to.equal(false);
    expect(r.error).to.equal('metadata_reserved_roles_key');
  });

  it('INV-3: user hợp lệ chỉ mang passwordHash, không có trường password plaintext', () => {
    const r = validateUserRecord({ username: 'alice', passwordHash: '$2a$...' });
    expect(r.ok).to.equal(true);
    expect(r.user).to.not.have.property('password');
  });

  it('username bắt buộc (trim)', () => {
    expect(validateUserRecord({ username: '   ' }).ok).to.equal(false);
  });

  it('INV-7: id quyền theo dạng <resource>.<action>', () => {
    expect(isValidPermissionId('user.create')).to.equal(true);
    expect(isValidPermissionId('User.Create')).to.equal(false); // hoa
    expect(isValidPermissionId('user')).to.equal(false);        // thiếu action
  });

  it('Role từ chối quyền sai định dạng', () => {
    expect(validateRole({ id: 'admin', permissions: ['user'] }).ok).to.equal(false);
    expect(validateRole({ id: 'admin', permissions: ['user.read'] }).ok).to.equal(true);
  });

  it('Role bắt buộc có id', () => {
    expect(validateRole({ name: 'Admin' }).ok).to.equal(false);
  });
});
```

---

## Cách kiểm chứng (chạy là biết đúng/sai)

```powershell
npx mocha server/auth-management/models/models.test.js --timeout 10000
```

Kết quả mong đợi: **6 test PASS (xanh)**. Nếu đỏ, đọc thông báo lỗi so với code mẫu ở trên.

Kiểm tra thêm: các file interface phải "require" được mà không lỗi cú pháp:

```powershell
node -e "require('./server/auth-management/store/user-store.interface'); require('./server/auth-management/services/interfaces'); console.log('OK: interfaces load duoc')"
```

Mong đợi in ra `OK: interfaces load duoc`.

## Đã xong task này khi

- [ ] Đủ 8 file ở mục "File sẽ tạo".
- [ ] 6 test bất biến PASS.
- [ ] Lệnh `node -e ...` in `OK`.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 1 (1.1, 1.2) |
| Requirement | 16.1, 16.2, 16.5, 13.1, 13.2, 4.2 |
| Thiết kế | `../design/11-data-models.md` (INV-1…INV-8), `../design.md` (Design Principles) |
| Quyết định | D-001 (4 lớp), D-003 (ranh giới module), D-007 (roles first-class) |

➡️ Xong Task 1 → sang `02-task-2-luu-tru.md` (sẽ được tạo tiếp).
