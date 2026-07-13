# 05 — Task 6: Brute-Force guard (chống dò mật khẩu)

> Tương ứng **Task 6** trong `../tasks.md`. Requirement: 15.1–15.6.
> Thiết kế: `../design/10-brute-force-protection.md`. Sở hữu property **P-012**.

> ### ⚠️ ĐỐI CHIẾU (2026-07-13) — GHI ĐÈ theo DV-008 & N-019
> Hard lock thời lượng cố định + state per-process là điểm yếu (defect **N-019**). Sửa:
> - **DV-008:** dùng **adaptive throttling** — backoff mũ `baseThrottleMs * backoffFactor^k`, có cap
>   `maxThrottleMs` (**AC-15.2**) thay vì khóa cứng; mỗi khoảng chặn **hữu hạn** để kẻ biết username
>   không khóa vĩnh viễn operator hợp lệ (**AC-15.6**). Giữ fail-closed threshold=0 (**AC-15.3**).
> - **N-019:** state đếm qua **seam `BruteForceStore`** (mặc định in-memory; **shared store** như Redis,
>   read-modify-write atomic, khi scale ngang — threshold không nhân theo số node, **AC-15.6**).
> - Dùng **đồng hồ monotonic** (không `Date.now()`) để nhảy giờ/NTP không kết thúc khóa sớm.
> - P-012 (task 6.2) nay là **state machine adaptive**, validate AC-15.1–15.6.

## Mục tiêu

Có một "guard" đếm số lần đăng nhập **sai liên tiếp theo từng username**; đủ ngưỡng thì **khóa**
username đó một khoảng thời gian (trả 429 ở tầng trên). Đăng nhập đúng thì reset. Đây là logic
thuần trong bộ nhớ, có **đồng hồ tiêm vào** để test hạn khóa một cách tất định.

## Phụ thuộc

Task 1 (interface `BruteForceGuard`). Độc lập với Task 2–5.

## Kiến thức nền

- Bổ trợ (không thay) cho rate-limit **theo IP** sẵn có của FUXA (`authLimiter` trong
  `server/api/index.js`). Guard này khóa **theo username** → chặn dò mật khẩu một tài khoản dù
  đổi IP.
- **Ngưỡng = 0 ⇒ fail-closed**: khóa MỌI username (an toàn khi cấu hình nhầm), theo AC-15.3.
- Đếm cả username không tồn tại (chống dò tên) — tầng đăng nhập sẽ gọi `recordFailure` cho mọi thất bại.
- State trong bộ nhớ **mỗi tiến trình**. Nếu sau này chạy nhiều tiến trình (scale ngang) cần shared
  store (Redis). Hiện chấp nhận vì FUXA mặc định 1 tiến trình.

---

## Bước 1 (6.1) — Cài đặt guard

Tạo `server/auth-management/services/brute-force.js`:

```javascript
//@ts-check
'use strict';

class BruteForceGuard {
  /**
   * @param {{ threshold?:number, lockoutDurationMs?:number, failureWindowMs?:number, clock?:()=>number }} [cfg]
   * threshold: số lần sai liên tiếp để khóa (mặc định 5; =0 ⇒ fail-closed khóa tất cả)
   * lockoutDurationMs: thời gian khóa (mặc định 15 phút)
   * failureWindowMs: (tùy chọn) chỉ tính là "liên tiếp" nếu trong cửa sổ này
   * clock: hàm trả về mốc thời gian ms (mặc định Date.now) — tiêm để test
   */
  constructor(cfg = {}) {
    this.threshold = Number.isInteger(cfg.threshold) ? cfg.threshold : 5;
    this.lockoutDurationMs = cfg.lockoutDurationMs || 15 * 60 * 1000;
    this.failureWindowMs = cfg.failureWindowMs || 0; // 0 = không dùng cửa sổ
    this.clock = cfg.clock || Date.now;
    /** @type {Map<string,{failCount:number,lockedUntil:number|null,lastFailAt:number}>} */
    this.state = new Map();
  }

  /** @returns {{allowed:true}|{allowed:false,retryAfterMs:number}} */
  checkAllowed(username, now = this.clock()) {
    // Ngưỡng 0 ⇒ fail-closed: khóa mọi username, mọi lúc (AC-15.3)
    if (this.threshold === 0) return { allowed: false, retryAfterMs: this.lockoutDurationMs };

    const e = this.state.get(username);
    if (!e) return { allowed: true };

    // Đang khóa và chưa hết hạn?
    if (e.lockedUntil && now < e.lockedUntil) {
      return { allowed: false, retryAfterMs: e.lockedUntil - now };
    }
    // Hết hạn khóa (AC-15.5): dọn và cho qua
    if (e.lockedUntil && now >= e.lockedUntil) {
      this.state.delete(username);
      return { allowed: true };
    }
    // Có đếm nhưng chưa khóa ⇒ cho qua (AC-15.1); dọn nếu failCount=0
    if (e.failCount === 0) this.state.delete(username);
    return { allowed: true };
  }

  recordFailure(username, now = this.clock()) {
    if (this.threshold === 0) return; // fail-closed: không cần đếm
    const e = this.state.get(username) || { failCount: 0, lockedUntil: null, lastFailAt: 0 };

    // Nếu dùng cửa sổ và lần sai trước quá cũ ⇒ reset chuỗi liên tiếp
    if (this.failureWindowMs && e.lastFailAt && (now - e.lastFailAt) > this.failureWindowMs) {
      e.failCount = 0; e.lockedUntil = null;
    }
    e.failCount += 1;
    e.lastFailAt = now;
    if (e.failCount >= this.threshold) {
      e.lockedUntil = now + this.lockoutDurationMs; // lần sai thứ N ⇒ khóa (AC-15.2)
    }
    this.state.set(username, e);
  }

  reset(username) {
    this.state.delete(username); // đăng nhập đúng ⇒ xóa đếm & khóa (AC-15.4)
  }
}

module.exports = { BruteForceGuard };
```

---

## Bước 2 (6.2) — Property test P-012 (mô hình hóa vòng đời khóa)

Ý tưởng: dựng một **mô hình tham chiếu** đơn giản chạy song song với guard, sinh chuỗi thao tác ngẫu
nhiên (`fail`/`success`/`check`) với thời gian tăng dần, và sau mỗi `check` khẳng định guard khớp mô hình.

Tạo `server/auth-management/services/brute-force.test.js`:

```javascript
//@ts-check
'use strict';
const fc = require('fast-check');
const { expect } = require('chai');
const { BruteForceGuard } = require('./brute-force');

describe('BruteForceGuard', () => {
  it('Feature: auth-user-management, Property 12: Lockout lifecycle matches the reference state machine', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 4 }),          // threshold (gồm 0 để test fail-closed)
      fc.integer({ min: 1, max: 100000 }),     // lockoutDurationMs
      fc.array(fc.record({
        kind: fc.constantFrom('fail', 'success', 'check'),
        username: fc.constantFrom('a', 'b'),   // nhiều user để kiểm tra cô lập
        dt: fc.integer({ min: 0, max: 50000 }), // thời gian trôi thêm
      }), { maxLength: 40 }),
      (threshold, lockMs, steps) => {
        let clockNow = 0;
        const clock = () => clockNow;
        const guard = new BruteForceGuard({ threshold, lockoutDurationMs: lockMs, clock });

        // Mô hình tham chiếu: theo từng username
        const model = new Map(); // username -> {failCount, lockedUntil}
        const refCheck = (u, now) => {
          if (threshold === 0) return false;                  // fail-closed
          const m = model.get(u);
          if (!m) return true;
          if (m.lockedUntil && now < m.lockedUntil) return false;
          return true;                                        // hết hạn hoặc chưa khóa
        };
        const refFail = (u, now) => {
          if (threshold === 0) return;
          let m = model.get(u);
          if (m && m.lockedUntil && now >= m.lockedUntil) m = undefined; // hết hạn ⇒ chuỗi mới
          m = m || { failCount: 0, lockedUntil: null };
          m.failCount += 1;
          if (m.failCount >= threshold) m.lockedUntil = now + lockMs;
          model.set(u, m);
        };

        for (const s of steps) {
          clockNow += s.dt;
          if (s.kind === 'fail') { guard.recordFailure(s.username); refFail(s.username, clockNow); }
          else if (s.kind === 'success') { guard.reset(s.username); model.delete(s.username); }
          else {
            const got = guard.checkAllowed(s.username).allowed;
            const want = refCheck(s.username, clockNow);
            expect(got).to.equal(want);
          }
        }
      }
    ), { numRuns: 100 });
  });
});
```

## Bước 3 (6.3) — Test biên (đọc dễ, khẳng định rõ từng AC)

Thêm vào cùng file:

```javascript
  it('AC-15.1/15.2: dưới ngưỡng cho qua; lần sai thứ N thì khóa', () => {
    let now = 0; const g = new BruteForceGuard({ threshold: 3, lockoutDurationMs: 1000, clock: () => now });
    g.recordFailure('u'); g.recordFailure('u');
    expect(g.checkAllowed('u').allowed).to.equal(true);  // mới 2 lần
    g.recordFailure('u');                                // lần 3 ⇒ khóa
    const r = g.checkAllowed('u');
    expect(r.allowed).to.equal(false);
    expect(r.retryAfterMs).to.be.greaterThan(0);
  });

  it('AC-15.3: threshold=0 ⇒ khóa mọi username', () => {
    const g = new BruteForceGuard({ threshold: 0 });
    expect(g.checkAllowed('bat-ky').allowed).to.equal(false);
    expect(g.checkAllowed('user-khac').allowed).to.equal(false);
  });

  it('AC-15.4: đăng nhập đúng reset đếm', () => {
    let now = 0; const g = new BruteForceGuard({ threshold: 3, lockoutDurationMs: 1000, clock: () => now });
    g.recordFailure('u'); g.recordFailure('u');
    g.reset('u');
    g.recordFailure('u');                                // lại từ 1
    expect(g.checkAllowed('u').allowed).to.equal(true);
  });

  it('AC-15.5: hết hạn khóa thì cho qua lại', () => {
    let now = 0; const g = new BruteForceGuard({ threshold: 1, lockoutDurationMs: 1000, clock: () => now });
    g.recordFailure('u');                                // khóa tới now+1000
    expect(g.checkAllowed('u').allowed).to.equal(false);
    now = 1000;                                          // hết hạn
    expect(g.checkAllowed('u').allowed).to.equal(true);
  });

  it('cô lập theo username: khóa a không ảnh hưởng b', () => {
    const g = new BruteForceGuard({ threshold: 1, lockoutDurationMs: 1000, clock: () => 0 });
    g.recordFailure('a');
    expect(g.checkAllowed('a').allowed).to.equal(false);
    expect(g.checkAllowed('b').allowed).to.equal(true);
  });
```

---

## Cách kiểm chứng

```powershell
npx mocha server/auth-management/services/brute-force.test.js --timeout 20000
```

Mong đợi: **P-012 + 5 test biên PASS**.

## Đã xong task khi

- [ ] `brute-force.js` có đủ `checkAllowed`/`recordFailure`/`reset`, đồng hồ tiêm vào, ngưỡng-0 fail-closed.
- [ ] P-012 PASS (100 vòng, có ngưỡng 0 và nhiều username trong miền sinh).
- [ ] 5 test biên (AC-15.1…15.5 + cô lập) PASS.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 6 (6.1–6.3) |
| Requirement | 15.1–15.5 |
| Thiết kế | `../design/10-brute-force-protection.md` |
| Property | P-012 (§10) |

➡️ Xong Task 6 → sang `06-task-7-authentication.md` (sẽ tạo tiếp).
