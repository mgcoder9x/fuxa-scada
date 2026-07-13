# 06 — Task 7: Authentication_Service (đăng nhập / đăng xuất)

> Tương ứng **Task 7** trong `../tasks.md`. Requirement: 1.1–1.5, 15.1/15.2/15.4, 3.4.
> Thiết kế: `../design/01-authentication.md`. DES-AUTH không sở hữu property (test kiểu ví dụ).

> ### ⚠️ ĐỐI CHIẾU (2026-07-13) — GHI ĐÈ theo DV-006 (chống dò username)
> Guide/FUXA cũ trả **404** cho username không tồn tại và **401** cho sai mật khẩu — đây là oracle
> enumeration. Sửa (task 7.1/7.2):
> - Unknown-user và bad-password trả **401 GIỐNG HỆT nhau** (cùng status + body `{ error:'invalid_credentials' }`),
>   **không còn 404**. Nhánh unknown-user vẫn gọi `Password_Hasher.verify` với **dummy hash** để **đồng bộ timing**.
> - Outcome mịn (`unknown_user` vs `bad_password`) chỉ dùng cho **audit phía server**, không lộ ra client.
> - Sign-in sau khi user bị xóa cũng trả **401 generic** (AC-8.4, đồng bộ). Xem `../design/01` §3/§4/§7.
> - Lưu ý: `user_not_found`/**404** VẪN đúng cho thao tác **admin CRUD** (sửa/xóa user — AC-7.4/8.3),
>   vì đó là admin đã xác thực, không phải oracle ở màn đăng nhập.

## Mục tiêu

Có `Authentication_Service.signIn(...)` trả **kết quả dạng tập đóng** (success / unknown_user /
bad_password / missing_field / rate_limited) và `signOut(...)`. Đây là nơi ráp lại: tra user (store),
so mật khẩu (hasher), cấp token (token service), chặn dò (brute-force), ghi audit.

## Phụ thuộc

Task 2 (User_Store), Task 3 (Password_Hasher), Task 5 (Token_Service), Task 6 (BruteForceGuard).
Audit_Logger có thể tiêm bản giả tạm (Task 11 làm bản thật).

## Kiến thức nền (đã kiểm chứng trong `server/api/auth/index.js`)

- FUXA hiện đẩy **nguyên `req.body`** vào `findOne(req.body)` → nguy cơ chèn field lạ. Module chỉ lấy
  đúng `username`/`password`, gọi `store.get(username)` đã chuẩn hóa (D-006).
- FUXA so mật khẩu **trực tiếp** bằng `bcrypt.compareSync` trong route. Module **chỉ** so qua
  `Password_Hasher.verify` (AC-1.5), service không hề import bcrypt.
- Mã trạng thái: 200 (đúng) / 404 (không có user) / 401 (sai mật khẩu) / 400 (thiếu field) / 429 (bị khóa).
  (Việc dịch outcome → HTTP nằm ở router Task 13; service chỉ trả outcome.)

---

## Bước 1 (7.1) — Cài đặt Authentication_Service

Tạo `server/auth-management/services/authentication.service.js`:

```javascript
//@ts-check
'use strict';

class Authentication_Service {
  /**
   * @param {{ userStore:any, passwordHasher:any, tokenService:any, bruteForce:any, auditLogger:any }} deps
   */
  constructor({ userStore, passwordHasher, tokenService, bruteForce, auditLogger }) {
    this.userStore = userStore;
    this.hasher = passwordHasher;
    this.tokens = tokenService;
    this.guard = bruteForce;
    this.audit = auditLogger;
  }

  _audit(username, outcome) {
    try {
      this.audit.record({
        category: 'auth.signin',
        subject: username,           // KHÔNG bao giờ đưa mật khẩu/hash vào đây (AC-14.5)
        outcome,
        timestamp: new Date().toISOString(),
      });
    } catch (_e) { /* audit không được làm sập đăng nhập (§09 §7) */ }
  }

  /**
   * @param {{username?:any, password?:any}} body
   * @returns {Promise<object>} SignInOutcome
   */
  async signIn(body) {
    // 1) Kiểm tra thiếu field TRƯỚC (AC-1.4). Request lỗi định dạng KHÔNG tính là dò mật khẩu.
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!username) return { kind: 'missing_field', error: 'missing_field', field: 'username' };
    if (!password) return { kind: 'missing_field', error: 'missing_field', field: 'password' };

    // 2) Cổng chống dò TRƯỚC khi tra store/so mật khẩu (AC-15.2/15.3)
    const gate = this.guard.checkAllowed(username);
    if (!gate.allowed) {
      this._audit(username, 'rate_limited');
      return { kind: 'rate_limited', error: 'too_many_attempts', retryAfterMs: gate.retryAfterMs };
    }

    // 3) Tra user — CHỈ theo username đã chuẩn hóa (D-006)
    const user = await this.userStore.get(username);
    if (!user) {
      this.guard.recordFailure(username);
      this._audit(username, 'unknown_user');
      return { kind: 'unknown_user', error: 'user_not_found' };
    }

    // 4) So mật khẩu QUA hasher (AC-1.5) — service không tự so plaintext
    const ok = this.hasher.verify(password, user.passwordHash);
    if (!ok) {
      this.guard.recordFailure(username);
      this._audit(username, 'bad_password');
      return { kind: 'bad_password', error: 'invalid_credentials' };
    }

    // 5) Đúng: reset đếm, cấp token, trả session (AC-1.1)
    this.guard.reset(username);
    let token;
    try {
      token = this.tokens.issueAccessToken({ username: user.username, groups: user.groups, roles: user.roles });
    } catch (_e) {
      // Mật khẩu đúng nhưng không cấp được token ⇒ KHÔNG "thành công một nửa" (§01 §7)
      this._audit(username, 'token_error');
      return { kind: 'service_error', error: 'token_issue_failed' };
    }
    this._audit(username, 'success');
    return {
      kind: 'success',
      session: { token, username: user.username, fullname: user.fullname, roles: user.roles },
    };
  }

  /** AC-3.4: đăng xuất — việc xóa cookie refresh làm ở router; service chỉ báo thành công. */
  signOut() { return { kind: 'signed_out' }; }
}

module.exports = { Authentication_Service };
```

**Điểm cần nhớ (đọc lại nếu code khác):**
- Thứ tự bắt buộc: **thiếu-field → cổng brute-force → tra store → so mật khẩu → cấp token**.
- Chỉ trích `username`/`password`; không chuyền cả `body` vào store.
- `verify` được gọi **đúng một lần**; service không có phép so sánh chuỗi nào khác trên mật khẩu.
- Audit bọc try/catch, không làm hỏng luồng.

---

## Bước 2 (7.2) — Test đơn vị (dùng đồ giả cho mọi phụ thuộc)

Tạo `server/auth-management/services/authentication.service.test.js`:

```javascript
//@ts-check
'use strict';
const { expect } = require('chai');
const sinon = require('sinon');
const { Authentication_Service } = require('./authentication.service');

function makeDeps(overrides = {}) {
  return {
    userStore: { get: sinon.stub() },
    passwordHasher: { verify: sinon.stub() },
    tokenService: { issueAccessToken: sinon.stub().returns('TOKEN') },
    bruteForce: { checkAllowed: sinon.stub().returns({ allowed: true }), recordFailure: sinon.spy(), reset: sinon.spy() },
    auditLogger: { record: sinon.spy() },
    ...overrides,
  };
}

describe('Authentication_Service', () => {
  it('AC-1.1: đúng ⇒ success + token + roles', async () => {
    const d = makeDeps();
    d.userStore.get.resolves({ username: 'alice', fullname: 'Alice', passwordHash: 'H', roles: ['r1'], groups: 1 });
    d.passwordHasher.verify.returns(true);
    const svc = new Authentication_Service(d);
    const r = await svc.signIn({ username: 'alice', password: 'p' });
    expect(r.kind).to.equal('success');
    expect(r.session).to.deep.include({ token: 'TOKEN', username: 'alice', fullname: 'Alice' });
    expect(r.session.roles).to.deep.equal(['r1']);
    expect(d.bruteForce.reset.calledWith('alice')).to.equal(true);
  });

  it('AC-1.2: không có user ⇒ unknown_user + recordFailure, không token', async () => {
    const d = makeDeps(); d.userStore.get.resolves(undefined);
    const r = await new Authentication_Service(d).signIn({ username: 'x', password: 'p' });
    expect(r.kind).to.equal('unknown_user');
    expect(d.bruteForce.recordFailure.calledWith('x')).to.equal(true);
    expect(d.tokenService.issueAccessToken.called).to.equal(false);
  });

  it('AC-1.3: sai mật khẩu ⇒ bad_password + recordFailure', async () => {
    const d = makeDeps();
    d.userStore.get.resolves({ username: 'a', passwordHash: 'H', roles: [] });
    d.passwordHasher.verify.returns(false);
    const r = await new Authentication_Service(d).signIn({ username: 'a', password: 'sai' });
    expect(r.kind).to.equal('bad_password');
    expect(d.bruteForce.recordFailure.called).to.equal(true);
  });

  it('AC-1.4: thiếu field ⇒ missing_field, KHÔNG gọi store/guard', async () => {
    const d = makeDeps();
    const svc = new Authentication_Service(d);
    expect((await svc.signIn({ password: 'p' })).kind).to.equal('missing_field');
    expect((await svc.signIn({ username: 'a' })).kind).to.equal('missing_field');
    expect(d.userStore.get.called).to.equal(false);
    expect(d.bruteForce.checkAllowed.called).to.equal(false);
  });

  it('AC-1.5: chỉ so mật khẩu QUA hasher.verify đúng 1 lần với (mật khẩu, hash lưu)', async () => {
    const d = makeDeps();
    d.userStore.get.resolves({ username: 'a', passwordHash: 'H', roles: [] });
    d.passwordHasher.verify.returns(true);
    await new Authentication_Service(d).signIn({ username: 'a', password: 'p' });
    expect(d.passwordHasher.verify.calledOnceWithExactly('p', 'H')).to.equal(true);
  });

  it('AC-15.2: đang bị khóa ⇒ rate_limited, không tra store', async () => {
    const d = makeDeps();
    d.bruteForce.checkAllowed.returns({ allowed: false, retryAfterMs: 5000 });
    const r = await new Authentication_Service(d).signIn({ username: 'a', password: 'p' });
    expect(r.kind).to.equal('rate_limited');
    expect(d.userStore.get.called).to.equal(false);
  });

  it('không chuyền cả body vào store (D-006): store.get nhận đúng username chuỗi', async () => {
    const d = makeDeps(); d.userStore.get.resolves(undefined);
    await new Authentication_Service(d).signIn({ username: '  alice  ', password: 'p', admin: true });
    expect(d.userStore.get.calledWith('alice')).to.equal(true); // đã trim, không có field 'admin'
  });
});
```

## Bước 3 (7.3) — Test tích hợp (tùy chọn, dùng service thật)

Nếu muốn, ráp `Authentication_Service` với `FuxaUserStoreAdapter` + `Password_Hasher` + `Token_Service`
thật (như cách dựng ở test Task 2), tạo 1 user (băm mật khẩu bằng hasher rồi `userStore.create`),
rồi kiểm: đúng mật khẩu ⇒ success + token verify được; sai ⇒ bad_password; user lạ ⇒ unknown_user.

---

## Cách kiểm chứng

```powershell
npx mocha server/auth-management/services/authentication.service.test.js --timeout 20000
```

Mong đợi: **7 test PASS**.

## Đã xong task khi

- [ ] `signIn` trả đúng tập đóng outcome theo thứ tự thiếu-field → guard → store → hasher → token.
- [ ] 7 test đơn vị PASS (đặc biệt AC-1.5 verify đúng 1 lần, D-006 không chuyền cả body).

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 7 (7.1–7.3) |
| Requirement | 1.1–1.5, 15.1/15.2/15.4, 3.4 |
| Thiết kế | `../design/01-authentication.md` |
| Quyết định | D-006 (chuẩn hóa input chống injection), D-007 (roles trong session) |

➡️ Xong Task 7 → sang `07-task-8-rbac.md` (sẽ tạo tiếp).
