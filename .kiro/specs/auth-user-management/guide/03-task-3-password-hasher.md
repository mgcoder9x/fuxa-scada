# 03 — Task 3: Password_Hasher (băm mật khẩu)

> Tương ứng **Task 3** trong `../tasks.md`. Requirement: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7.
> Thiết kế: `../design/03-password-security.md`. Sở hữu property **P-001, P-002**.

> ### ⚠️ ĐỐI CHIẾU (2026-07-13) — GHI ĐÈ theo D-017 / DV-007
> bcrypt **cắt input ở 72 byte**, nên phát biểu P-002 cũ ("mọi A≠B đều reject") là **SAI** cho input >72 byte
> (defect **N-012**). Sửa:
> - **P-002 chỉ phát biểu trên domain ≤72 byte UTF-8.** Generator test **không** được dùng cặp near-duplicate
>   dài >72 byte để "ép" test pass — nếu chung 72 byte đầu, bcrypt coi là giống nhau.
> - Mật khẩu **>72 byte UTF-8 bị từ chối** ở tầng validate `User_Service` (**AC-4.6**); thêm min-length +
>   blocklist (**AC-4.7**). Xem `../design/03` §2.2/§7/§8.1 và `../design/04` §2.3.
> - Lưu **`hashScheme`** version marker để sau này chuyển Argon2id không vỡ verify.

## Mục tiêu

Có `Password_Hasher` với 2 việc: `hash(plaintext)` (băm một chiều có salt) và
`verify(plaintext, hash)` (so khớp). Đây là **nơi DUY NHẤT** trong hệ được phép so sánh mật khẩu.
Việc băm thật do một "adapter" bọc thư viện `bcryptjs` (thư viện FUXA đã có sẵn).

## Phụ thuộc

Task 1 (đã có interface `Password_Hasher` trong `services/interfaces.js`).

## Kiến thức nền (1 phút)

- **bcrypt** tự sinh salt ngẫu nhiên mỗi lần băm → băm cùng một mật khẩu 2 lần ra 2 chuỗi khác nhau,
  nhưng cả hai đều verify đúng (đó chính là P-001). Salt nằm ngay trong chuỗi hash.
- **Cost (độ khó)**: FUXA dùng 10; ta dùng **12** (mạnh hơn), cấu hình được. Vì cost nằm trong chuỗi
  hash nên hash cũ (cost 10) vẫn verify được — không cần migrate.
- Trong test, dùng **cost 4** cho nhanh (chạy 100 vòng mà cost 12 sẽ rất chậm).

---

## Bước 1 (3.1) — Adapter bọc bcryptjs (Hash seam)

Đây là file DUY NHẤT được `require('bcryptjs')`. Tạo
`server/auth-management/adapters/fuxa-bcrypt.adapter.js`:

```javascript
//@ts-check
'use strict';
const bcrypt = require('bcryptjs');

class BcryptHasherAdapter {
  /** @param {{ cost?: number }} [opts] */
  constructor(opts = {}) {
    this.cost = Number.isInteger(opts.cost) ? opts.cost : 12; // mặc định 12
  }
  hashSync(plaintext) { return bcrypt.hashSync(plaintext, this.cost); }
  compareSync(plaintext, hash) { return bcrypt.compareSync(plaintext, hash); }
}

module.exports = { BcryptHasherAdapter };
```

---

## Bước 2 (3.2) — Password_Hasher service

Tạo `server/auth-management/services/password-hasher.js`:

```javascript
//@ts-check
'use strict';

class Password_Hasher {
  /** @param {{ hashSync(p:string):string, compareSync(p:string,h:string):boolean }} seam */
  constructor(seam) {
    if (!seam) throw new Error('Password_Hasher requires a hash seam');
    this.seam = seam;   // BcryptHasherAdapter (tiêm vào, KHÔNG require bcrypt ở đây)
  }

  /** Băm một chiều có salt. Hàm toàn phần: nhận mọi chuỗi (kể cả rỗng). */
  hash(plaintext) {
    return this.seam.hashSync(String(plaintext));
  }

  /** So khớp. Phòng thủ: hash null/rỗng/hỏng → trả false, KHÔNG ném lỗi (không làm sập đăng nhập). */
  verify(plaintext, hash) {
    if (typeof hash !== 'string' || hash.length === 0) return false;
    try {
      return this.seam.compareSync(String(plaintext), hash);
    } catch (_e) {
      return false; // chuỗi hash hỏng cấu trúc → coi như không khớp
    }
  }
}

module.exports = { Password_Hasher };
```

**Điểm cần nhớ:**
- Service KHÔNG `require('bcryptjs')` — chỉ dùng `seam` được tiêm. Nhờ vậy test thay seam giả được,
  và cả hệ chỉ có 1 chỗ import bcrypt (dễ đổi/dễ nâng cấp).
- `verify` không bao giờ ném lỗi → luồng đăng nhập không bị sập vì một hash hỏng.

---

## Bước 3 (3.3) — Property test P-001 (hash verify đúng plaintext của nó)

Tạo `server/auth-management/services/password-hasher.test.js`:

```javascript
//@ts-check
'use strict';
const fc = require('fast-check');
const { expect } = require('chai');
const { BcryptHasherAdapter } = require('../adapters/fuxa-bcrypt.adapter');
const { Password_Hasher } = require('./password-hasher');

// Dùng cost 4 trong test cho nhanh (tính chất không phụ thuộc cost).
const hasher = new Password_Hasher(new BcryptHasherAdapter({ cost: 4 }));

// Sinh mật khẩu đa dạng: ascii, unicode, rỗng, dài.
const passwordArb = fc.oneof(
  fc.string(),
  fc.fullUnicodeString(),
  fc.constant(''),
  fc.string({ minLength: 60, maxLength: 200 })
);

describe('Password_Hasher', () => {
  it('Feature: auth-user-management, Property 1: Password hash verifies its own plaintext', () => {
    fc.assert(fc.property(passwordArb, (p) => {
      const h1 = hasher.hash(p);
      const h2 = hasher.hash(p);
      expect(hasher.verify(p, h1)).to.equal(true);
      expect(hasher.verify(p, h2)).to.equal(true);
      expect(h1).to.not.equal(h2); // salt ngẫu nhiên ⇒ 2 hash khác nhau
    }), { numRuns: 100 });
  });

  it('Feature: auth-user-management, Property 2: Password hash rejects a different plaintext', () => {
    fc.assert(fc.property(
      fc.tuple(passwordArb, passwordArb).filter(([a, b]) => a !== b),
      ([a, b]) => {
        expect(hasher.verify(b, hasher.hash(a))).to.equal(false);
      }
    ), { numRuns: 100 });
  });
});
```

## Bước 4 (3.5) — Test biên

Thêm vào cuối `describe` trên (hoặc file riêng):

```javascript
  it('verify phòng thủ: null/rỗng/hỏng ⇒ false, không ném', () => {
    expect(hasher.verify('x', null)).to.equal(false);
    expect(hasher.verify('x', '')).to.equal(false);
    expect(hasher.verify('x', 'khong-phai-hash-bcrypt')).to.equal(false);
  });

  it('hash chuỗi rỗng vẫn verify được', () => {
    const h = hasher.hash('');
    expect(hasher.verify('', h)).to.equal(true);
  });

  it('hash cost 10 (kiểu FUXA) vẫn verify được bằng hasher cost 12', () => {
    const bcrypt = require('bcryptjs');
    const legacy = bcrypt.hashSync('cu', 10);
    const h12 = new Password_Hasher(new BcryptHasherAdapter({ cost: 12 }));
    expect(h12.verify('cu', legacy)).to.equal(true); // cost nằm trong chuỗi hash
  });
```

---

## Cách kiểm chứng

```powershell
npx mocha server/auth-management/services/password-hasher.test.js --timeout 20000
```

Mong đợi: **P-001, P-002 và 3 test biên PASS**. (Chạy ~vài giây nhờ cost 4.)

## Đã xong task khi

- [ ] `fuxa-bcrypt.adapter.js` là file duy nhất require `bcryptjs`.
- [ ] `password-hasher.js` không require bcrypt, chỉ dùng seam tiêm vào.
- [ ] P-001, P-002 PASS (mỗi cái 100 vòng); 3 test biên PASS.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 3 (3.1–3.5) |
| Requirement | 4.1, 4.2, 4.3, 4.4, 4.5 |
| Thiết kế | `../design/03-password-security.md` |
| Property | P-001, P-002 (§03) |
| Quyết định | D-002 (dùng lại bcryptjs), D-008 (cost 12 cấu hình được) |

➡️ Xong Task 3 → sang `04-task-5-token-service.md` (sẽ tạo tiếp).
