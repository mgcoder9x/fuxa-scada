# 08 — Task 9: User_Service (CRUD người dùng)

> Tương ứng **Task 9** trong `../tasks.md`. Requirement: 5.1–5.4, 6.1–6.4, 7.1–7.5, 8.1–8.5, 4.6, 4.7.
> Thiết kế: `../design/04-user-management.md`. DES-USER không sở hữu property (test kiểu ví dụ; dùng lại P-003, P-016).

> ### ⚠️ ĐỐI CHIẾU (2026-07-13) — GHI ĐÈ theo D-017 & D-020
> - **D-017/DV-007 (task 9.1/9.2):** bước validate của `create`/`update` phải **từ chối mật khẩu >72 byte UTF-8**
>   (**AC-4.6**) và áp min-length + common-password blocklist (**AC-4.7**) **trước khi** băm (`../design/04` §2.3).
> - **D-020 (cơ chế ở store, task 2.9; property P-016 tại 2.10):** `create` dựa trên `INSERT` atomic (trùng
>   username do khóa chính, không đọc-rồi-ghi); guard **admin cuối** chạy trong `BEGIN IMMEDIATE` để 2 lệnh xóa
>   song song không thể cùng đưa số admin về 0. `unknown_user`/**404** cho update/delete user **vẫn giữ** (đây là
>   admin CRUD, không phải oracle đăng nhập — khác với DV-006 ở guide 06).

## Mục tiêu

Có `User_Service` với `create/list/get/update/delete`. Điểm quan trọng: **tách tạo/sửa** (FUXA là
upsert), **băm mật khẩu trước khi ghi**, **trả về không kèm hash** (UserView), và **chống xóa admin
cuối** (AC-8.5) bằng `isAdministrator` của Task 8.

## Phụ thuộc

Task 2 (User_Store), Task 3 (Password_Hasher), Task 8 (Authorization_Service.isAdministrator).

## Kiến thức nền

- FUXA upsert: tạo trùng thì đè, sửa user không tồn tại thì âm thầm tạo, xóa user không tồn tại vẫn
  báo thành công. Module **chặn tất cả** bằng kiểm tra tồn tại trước khi ghi.
- `UserView` = `{ username, fullname, roles, metadata }` — **không có** trường hash (AC-6.2).
- Cập nhật bỏ trống mật khẩu ⇒ giữ hash cũ (AC-7.3) — do adapter Task 2 xử lý (không truyền passwordHash).

---

## Bước 1 (9.1) — Cài đặt User_Service

Tạo `server/auth-management/services/user.service.js`:

```javascript
//@ts-check
'use strict';
const { validateUserRecord } = require('../models/user-record');

/** Bỏ hash khỏi record trước khi trả ra ngoài (AC-6.2). */
function toUserView(u) {
  return { username: u.username, fullname: u.fullname, roles: u.roles || [], metadata: u.metadata || {} };
}

class User_Service {
  /** @param {{ userStore:any, passwordHasher:any, authorization:any, auditLogger:any }} deps */
  constructor({ userStore, passwordHasher, authorization, auditLogger }) {
    this.store = userStore; this.hasher = passwordHasher; this.authz = authorization; this.audit = auditLogger;
  }
  _audit(category, subject) {
    try { this.audit.record({ category, subject, timestamp: new Date().toISOString(), outcome: 'ok' }); } catch (_e) {}
  }

  async create(req) {
    const username = typeof req?.username === 'string' ? req.username.trim() : '';
    if (!username) return { kind: 'missing_field', error: 'missing_field', field: 'username' }; // AC-5.3
    if (!req.password) return { kind: 'invalid', error: 'validation_error', detail: 'password_required' };
    if (await this.store.get(username)) return { kind: 'duplicate', error: 'duplicate_username', username }; // AC-5.2, không đè

    const v = validateUserRecord({ username, fullname: req.fullname, roles: req.roles, metadata: req.metadata });
    if (!v.ok) return { kind: 'invalid', error: 'validation_error', detail: v.error };

    const passwordHash = this.hasher.hash(req.password);                 // AC-5.4: băm trước khi ghi
    await this.store.create({ ...v.user, passwordHash });
    this._audit('user.create', username);
    return { kind: 'created', user: toUserView(v.user) };
  }

  async list() {
    const { records } = await this.store.readAll();
    return { kind: 'ok', users: records.map(toUserView) };              // AC-6.1/6.2 (không hash)
  }

  async get(username) {
    const u = await this.store.get(String(username || '').trim());
    return u ? { kind: 'found', user: toUserView(u) } : { kind: 'empty' }; // AC-6.3/6.4 (empty ≠ lỗi)
  }

  async update(username, req) {
    const u = String(username || '').trim();
    const existing = await this.store.get(u);
    if (!existing) return { kind: 'unknown_user', error: 'user_not_found', username: u }; // AC-7.4

    const patch = {};
    if (req.fullname !== undefined) patch.fullname = req.fullname;
    if (req.roles !== undefined) patch.roles = req.roles;
    if (req.metadata !== undefined) {
      // chặn khóa 'roles' cấp cao nhất trong metadata (INV-1)
      const v = validateUserRecord({ username: u, metadata: req.metadata });
      if (!v.ok) return { kind: 'invalid', error: 'validation_error', detail: v.error }; // AC-7.5, không ghi
      patch.metadata = req.metadata;
    }
    if (req.password) patch.passwordHash = this.hasher.hash(req.password); // AC-7.2; bỏ trống ⇒ giữ (AC-7.3)

    await this.store.update(u, patch);
    this._audit('user.update', u);
    return { kind: 'updated', user: toUserView({ ...existing, ...patch, username: u }) };
  }

  async delete(username) {
    const u = String(username || '').trim();
    const existing = await this.store.get(u);
    if (!existing) return { kind: 'unknown_user', error: 'user_not_found', username: u }; // AC-8.3

    // AC-8.5: chống xóa admin cuối
    if (await this.authz.isAdministrator(existing)) {
      const { records } = await this.store.readAll();
      let otherAdmins = 0;
      for (const r of records) {
        if (r.username !== u && await this.authz.isAdministrator(r)) otherAdmins++;
      }
      if (otherAdmins === 0) return { kind: 'last_admin', error: 'last_admin', username: u }; // không ghi gì
    }

    await this.store.delete(u);   // xóa row + evict cache (AC-8.1/8.2)
    this._audit('user.delete', u);
    return { kind: 'deleted' };
  }
}

module.exports = { User_Service, toUserView };
```

**Điểm cần nhớ:**
- Tạo: kiểm tồn tại → nếu có, `duplicate`, **không** ghi đè.
- Sửa: kiểm tồn tại → validate → chỉ băm khi có mật khẩu mới; bỏ trống thì không truyền passwordHash
  (adapter giữ hash cũ). Lỗi validate ⇒ không ghi gì (AC-7.5).
- Xóa: kiểm tồn tại → nếu là admin, đếm admin khác; nếu là admin cuối ⇒ `last_admin`, **không** xóa.

---

## Bước 2 (9.2) — Test đơn vị

Tạo `server/auth-management/services/user.service.test.js` (dùng `sinon` cho phụ thuộc):

```javascript
//@ts-check
'use strict';
const { expect } = require('chai');
const sinon = require('sinon');
const { User_Service } = require('./user.service');

function deps(over = {}) {
  return {
    userStore: { get: sinon.stub(), readAll: sinon.stub().resolves({ records: [] }), create: sinon.spy(), update: sinon.spy(), delete: sinon.spy() },
    passwordHasher: { hash: sinon.stub().returns('HASH') },
    authorization: { isAdministrator: sinon.stub().resolves(false) },
    auditLogger: { record: sinon.spy() },
    ...over,
  };
}

describe('User_Service', () => {
  it('AC-5.1/5.4: tạo ⇒ created, chỉ lưu hash, UserView không có hash', async () => {
    const d = deps(); d.userStore.get.resolves(undefined);
    const r = await new User_Service(d).create({ username: 'a', password: 'p', roles: ['r1'] });
    expect(r.kind).to.equal('created');
    expect(r.user).to.not.have.property('passwordHash');
    expect(d.userStore.create.firstCall.args[0].passwordHash).to.equal('HASH');
    expect(d.passwordHasher.hash.calledWith('p')).to.equal(true);
  });

  it('AC-5.2: tạo trùng ⇒ duplicate, KHÔNG ghi', async () => {
    const d = deps(); d.userStore.get.resolves({ username: 'a' });
    const r = await new User_Service(d).create({ username: 'a', password: 'p' });
    expect(r.kind).to.equal('duplicate');
    expect(d.userStore.create.called).to.equal(false);
  });

  it('AC-6.2: list không lộ hash', async () => {
    const d = deps(); d.userStore.readAll.resolves({ records: [{ username: 'a', fullname: 'A', passwordHash: 'H', roles: [], metadata: {} }] });
    const r = await new User_Service(d).list();
    expect(r.users[0]).to.not.have.property('passwordHash');
  });

  it('AC-7.3: cập nhật bỏ trống mật khẩu ⇒ không truyền passwordHash (giữ hash cũ)', async () => {
    const d = deps(); d.userStore.get.resolves({ username: 'a', fullname: 'A', roles: [], metadata: {} });
    await new User_Service(d).update('a', { fullname: 'Moi' });
    expect(d.userStore.update.firstCall.args[1]).to.not.have.property('passwordHash');
    expect(d.passwordHasher.hash.called).to.equal(false);
  });

  it('AC-7.4: sửa user không tồn tại ⇒ unknown_user, không ghi', async () => {
    const d = deps(); d.userStore.get.resolves(undefined);
    const r = await new User_Service(d).update('x', { fullname: 'A' });
    expect(r.kind).to.equal('unknown_user');
    expect(d.userStore.update.called).to.equal(false);
  });

  it('AC-8.3: xóa user không tồn tại ⇒ unknown_user', async () => {
    const d = deps(); d.userStore.get.resolves(undefined);
    expect((await new User_Service(d).delete('x')).kind).to.equal('unknown_user');
  });

  it('AC-8.5: xóa admin cuối ⇒ last_admin, KHÔNG xóa', async () => {
    const d = deps();
    d.userStore.get.resolves({ username: 'admin', roles: ['admin'] });
    d.userStore.readAll.resolves({ records: [{ username: 'admin', roles: ['admin'] }] });
    d.authorization.isAdministrator.resolves(true);   // mọi record đều là admin
    const r = await new User_Service(d).delete('admin');
    expect(r.kind).to.equal('last_admin');
    expect(d.userStore.delete.called).to.equal(false);
  });

  it('AC-8.1: xóa admin khi còn admin khác ⇒ deleted', async () => {
    const d = deps();
    d.userStore.get.resolves({ username: 'admin1', roles: ['admin'] });
    d.userStore.readAll.resolves({ records: [{ username: 'admin1', roles: ['admin'] }, { username: 'admin2', roles: ['admin'] }] });
    d.authorization.isAdministrator.resolves(true);
    const r = await new User_Service(d).delete('admin1');
    expect(r.kind).to.equal('deleted');
    expect(d.userStore.delete.calledWith('admin1')).to.equal(true);
  });
});
```

---

## Cách kiểm chứng

```powershell
npx mocha server/auth-management/services/user.service.test.js --timeout 20000
```

Mong đợi: **8 test PASS** (đủ các AC quan trọng, đặc biệt AC-8.5 chống xóa admin cuối).

## Đã xong task khi

- [ ] `create/update/delete` đều kiểm tồn tại trước khi ghi (không upsert ngầm).
- [ ] Trả `UserView` không có hash; băm trước khi ghi; bỏ trống mật khẩu giữ hash cũ.
- [ ] Chống xóa admin cuối (AC-8.5). 8 test PASS.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 9 (9.1–9.2) |
| Requirement | 5.1–5.4, 6.1–6.4, 7.1–7.5, 8.1–8.5 |
| Thiết kế | `../design/04-user-management.md` |
| Property | (dùng lại P-003 của §06) |
| Quyết định | D-009/DV-005 (chống xóa admin cuối) |

➡️ Xong Task 9 → sang `09-task-11-audit.md` (sẽ tạo tiếp).
