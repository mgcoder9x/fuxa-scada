# 04 — Task 5: Token_Service (token & phiên)

> Tương ứng **Task 5** trong `../tasks.md`. Requirement: 2.1–2.8, 3.1–3.3.
> Thiết kế: `../design/02-token-and-session.md`. Sở hữu property **P-007, P-008**.

## Mục tiêu

Có `Token_Service`: cấp token (`issueAccessToken`/`issueRefreshToken`), kiểm tra token (`verify`),
và làm mới (`refresh`). Điểm cốt lõi: **token luôn có hạn mặc định 1 giờ** (không bao giờ vô hạn ngầm),
và token mang claim `roles` (RBAC) bên cạnh `groups` (tương thích FUXA).

## Phụ thuộc

Task 1 (interface). Không phụ thuộc Task 2/3 về mặt code, nhưng nên làm sau chúng theo thứ tự.

## Kiến thức nền (đã kiểm chứng trong mã FUXA)

- `server/api/jwt-helper.js` giữ **secret** ký token: getter `authJwt.secretCode` (bền nếu được cấu hình,
  hoặc fallback ngẫu nhiên mỗi tiến trình). Mặc định `tokenExpiresIn = 60*60` (1 giờ).
- FUXA ký `jwt.sign({ id: username, groups }, secretCode, { expiresIn })`. **Không có `roles`** → module thêm.
- Refresh: FUXA dùng `{ id, type:'refresh' }`, cookie `fuxa_refresh` (HttpOnly, SameSite=lax, path=/api/refresh),
  bật/tắt bằng cờ `enableRefreshCookieAuth`.
- **Lý do adapter dùng `jsonwebtoken` trực tiếp** (không dùng hàm ký của jwt-helper): jwt-helper chỉ ký với
  hạn cố định của nó và không thêm `roles`; ta cần kiểm soát hạn theo bảng chính sách + thêm `roles`. Nhưng
  ta **lấy đúng `authJwt.secretCode`** để token vẫn verify được ở cả FUXA lẫn module (một secret duy nhất).

---

## Bước 1 (5.1) — TokenAdapter (JWT seam)

Tạo `server/auth-management/adapters/fuxa-jwt.adapter.js`:

```javascript
//@ts-check
'use strict';
const jwt = require('jsonwebtoken');
const authJwt = require('../../api/jwt-helper'); // dùng lại secret của FUXA (một secret duy nhất)

class TokenAdapter {
  /** Secret ký/verify — luôn lấy từ jwt-helper để tương thích FUXA. */
  get secret() { return authJwt.secretCode; }

  /** Ký payload. options ví dụ { expiresIn: 3600 } hoặc {} (không hạn). */
  sign(payload, options = {}) { return jwt.sign(payload, this.secret, options); }

  /** Verify + decode. NÉM lỗi nếu chữ ký sai (JsonWebTokenError) hoặc hết hạn (TokenExpiredError). */
  verify(token, options = {}) { return jwt.verify(token, this.secret, options); }

  /** Chỉ decode (không kiểm chữ ký) — dùng cho test/đọc iat/exp. */
  decode(token) { return jwt.decode(token); }
}

module.exports = { TokenAdapter };
```

---

## Bước 2 (5.2) — Token_Service (cấp / verify / refresh + chính sách hạn)

Tạo `server/auth-management/services/token.service.js`:

```javascript
//@ts-check
'use strict';

class Token_Service {
  /**
   * @param {{ seam: any, config?: {
   *   configuredExpiry?: number|string,  // hạn cấu hình (AC-2.6); undefined = không cấu hình
   *   devNonExpiring?: boolean,          // chế độ dev không hạn (AC-2.8)
   *   isProduction?: boolean,            // production thì BỎ QUA cờ dev
   *   refreshExpiry?: number|string      // hạn refresh token (mặc định '7d')
   * } }} deps
   */
  constructor({ seam, config = {} }) {
    if (!seam) throw new Error('Token_Service requires a jwt seam');
    this.seam = seam;
    this.configuredExpiry = config.configuredExpiry;
    this.devNonExpiring = !!config.devNonExpiring;
    this.isProduction = !!config.isProduction;
    this.refreshExpiry = config.refreshExpiry || '7d';
  }

  // Bảng quyết định hạn (§02 §4): cấu hình → 1h mặc định → dev không hạn (chỉ ngoài production).
  _resolveAccessExpiry() {
    if (this.configuredExpiry) return this.configuredExpiry;             // Hàng 1: AC-2.6
    if (this.devNonExpiring && !this.isProduction) return null;          // Hàng 3: AC-2.8 (không exp)
    return 3600;                                                         // Hàng 2: AC-2.7 mặc định 1h
  }

  /** AC-2.1/2.2: token mã hóa id(username)+groups+roles, ký bằng secret cấu hình. */
  issueAccessToken({ username, groups, roles }) {
    const exp = this._resolveAccessExpiry();
    const payload = { id: username, groups: groups, roles: roles || [] };
    return this.seam.sign(payload, exp === null ? {} : { expiresIn: exp });
  }

  issueRefreshToken({ username }) {
    return this.seam.sign({ id: username, type: 'refresh' }, { expiresIn: this.refreshExpiry });
  }

  /**
   * AC-2.3/2.4/2.5: authenticated ⟺ chữ ký hợp lệ VÀ chưa hết hạn.
   * @param {string} token @param {{nowSeconds?:number}} [opts] nowSeconds chỉ dùng cho test (clockTimestamp)
   */
  verify(token, opts = {}) {
    if (!token) return { authenticated: false, reason: 'missing' };
    try {
      const vopts = opts.nowSeconds !== undefined ? { clockTimestamp: opts.nowSeconds } : {};
      const decoded = this.seam.verify(token, vopts);
      return { authenticated: true, claims: { id: decoded.id, groups: decoded.groups, roles: decoded.roles || [] } };
    } catch (e) {
      const reason = e && e.name === 'TokenExpiredError' ? 'expired' : 'bad_signature';
      return { authenticated: false, reason };
    }
  }

  /**
   * AC-3.2/3.3: xoay vòng cả 2 token nếu refresh hợp lệ và user còn tồn tại.
   * @param {string|null} refreshToken
   * @param {(username:string)=>Promise<any|undefined>} lookupUser tra user (tiêm vào để không phụ thuộc store)
   */
  async refresh(refreshToken, lookupUser) {
    if (!refreshToken) return { kind: 'rejected', reason: 'missing' };
    let decoded;
    try { decoded = this.seam.verify(refreshToken); }
    catch (e) { return { kind: 'rejected', reason: e && e.name === 'TokenExpiredError' ? 'expired' : 'invalid' }; }
    if (!decoded || decoded.type !== 'refresh') return { kind: 'rejected', reason: 'wrong_type' };
    const user = await lookupUser(decoded.id);
    if (!user) return { kind: 'rejected', reason: 'unknown_user' };
    const identity = { username: user.username, groups: user.groups, roles: user.roles || [] };
    return {
      kind: 'rotated',
      accessToken: this.issueAccessToken(identity),
      refreshToken: this.issueRefreshToken(identity),
      identity,
    };
  }
}

module.exports = { Token_Service };
```

> Ghi chú: phần **cookie** `fuxa_refresh` và mã HTTP (204/401) sẽ nằm ở tầng API router (Task 13),
> đúng như FUXA làm. `Token_Service` chỉ lo logic token thuần — nhờ vậy test property được.

---

## Bước 3 (5.3) — Property test P-007 (authenticated ⟺ chữ ký đúng ∧ chưa hết hạn)

Tạo `server/auth-management/services/token.service.test.js`:

```javascript
//@ts-check
'use strict';
const fc = require('fast-check');
const { expect } = require('chai');
const jwt = require('jsonwebtoken');
const authJwt = require('../../api/jwt-helper');
const { TokenAdapter } = require('../adapters/fuxa-jwt.adapter');
const { Token_Service } = require('./token.service');

const SECRET = 'test-secret-abc';
before(() => { authJwt.init(true, SECRET, 3600); }); // ép secret cố định cho test

const seam = new TokenAdapter();
const svc = new Token_Service({ seam, config: {} }); // mặc định 1h

const identityArb = fc.record({
  username: fc.string(),
  groups: fc.oneof(fc.integer(), fc.array(fc.integer(), { maxLength: 3 })),
  roles: fc.array(fc.string(), { maxLength: 5 }),
});

describe('Token_Service', () => {
  it('Feature: auth-user-management, Property 7: A token is authenticated iff its signature is valid and it is unexpired', () => {
    fc.assert(fc.property(
      identityArb,
      fc.boolean(),                                   // wrongSecret?
      fc.integer({ min: -100, max: 100 }).filter(n => n !== 0), // offset giây (≠0 tránh biên)
      (identity, wrongSecret, offset) => {
        const secret = wrongSecret ? 'secret-khac' : SECRET;
        const token = jwt.sign(
          { id: identity.username, groups: identity.groups, roles: identity.roles },
          secret, { expiresIn: offset }
        );
        const now = Math.floor(Date.now() / 1000);
        const r = svc.verify(token, { nowSeconds: now });
        const expected = (!wrongSecret) && (offset > 0);
        expect(r.authenticated).to.equal(expected);
        if (r.authenticated) {
          expect(r.claims.id).to.equal(identity.username);
          expect(r.claims.roles).to.deep.equal(identity.roles);
        }
      }
    ), { numRuns: 100 });
  });
});
```

## Bước 4 (5.4) — Property test P-008 (không cấu hình ⇒ luôn hữu hạn 1 giờ)

Thêm vào cùng file:

```javascript
  it('Feature: auth-user-management, Property 8: Unconfigured deployments issue finite 1-hour tokens; non-expiry is dev-only', () => {
    fc.assert(fc.property(
      identityArb,
      fc.record({
        configuredExpiry: fc.option(fc.integer({ min: 60, max: 86400 }), { nil: undefined }),
        devNonExpiring: fc.boolean(),
        isProduction: fc.boolean(),
      }),
      (identity, cfg) => {
        const s = new Token_Service({ seam, config: cfg });
        const token = s.issueAccessToken(identity);
        const decoded = seam.decode(token);
        const devActive = cfg.devNonExpiring && !cfg.isProduction;
        if (cfg.configuredExpiry !== undefined) {
          expect(decoded.exp - decoded.iat).to.equal(cfg.configuredExpiry);  // Hàng 1
        } else if (devActive) {
          expect(decoded).to.not.have.property('exp');                       // Hàng 3: không hạn
        } else {
          expect(decoded.exp - decoded.iat).to.equal(3600);                  // Hàng 2: mặc định 1h
        }
        // An toàn: dev tắt ⇒ luôn có exp
        if (!cfg.devNonExpiring) expect(decoded).to.have.property('exp');
      }
    ), { numRuns: 100 });
  });
```

## Bước 5 (5.5) — Test refresh & đơn vị

Thêm vào cùng file:

```javascript
  it('refresh hợp lệ ⇒ xoay vòng 2 token', async () => {
    const rt = svc.issueRefreshToken({ username: 'alice' });
    const lookup = async (u) => (u === 'alice' ? { username: 'alice', groups: 1, roles: ['r1'] } : undefined);
    const out = await svc.refresh(rt, lookup);
    expect(out.kind).to.equal('rotated');
    expect(svc.verify(out.accessToken).authenticated).to.equal(true);
  });

  it('refresh thiếu/không phải refresh/user biến mất ⇒ rejected', async () => {
    expect((await svc.refresh(null, async () => ({}))).kind).to.equal('rejected');
    const access = svc.issueAccessToken({ username: 'a', groups: 1, roles: [] }); // không phải refresh
    expect((await svc.refresh(access, async () => ({}))).reason).to.equal('wrong_type');
    const rt = svc.issueRefreshToken({ username: 'ghost' });
    expect((await svc.refresh(rt, async () => undefined)).reason).to.equal('unknown_user');
  });
```

---

## Cách kiểm chứng

```powershell
npx mocha server/auth-management/services/token.service.test.js --timeout 20000
```

Mong đợi: **P-007, P-008 + 2 test refresh PASS**.

## Đã xong task khi

- [ ] `fuxa-jwt.adapter.js` lấy secret từ `authJwt.secretCode`.
- [ ] `token.service.js` có bảng chính sách hạn (cấu hình / 1h / dev-không-hạn).
- [ ] P-007, P-008 PASS; test refresh PASS.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 5 (5.1–5.5) |
| Requirement | 2.1–2.8, 3.1–3.3 |
| Thiết kế | `../design/02-token-and-session.md` |
| Property | P-007, P-008 (§02) |
| Quyết định | D-002 (dùng lại JWT), D-007 (roles trong token), TO-002/DV-003 (TTL mặc định) |

➡️ Xong Task 5 → sang `05-task-6-brute-force.md` (sẽ tạo tiếp).
