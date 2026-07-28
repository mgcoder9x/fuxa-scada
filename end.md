# HANDOFF — FUXA auth-user-management (cập nhật 2026-07-27)

> File này được viết lại từ đầu vì bản cũ (831 dòng, 2026-07-16/17) đã lạc hậu: nó không có
> D-046…D-051. Giữ NGẮN và chỉ ghi thứ máy mới cần.

## 0. VÀO MÁY MỚI — LÀM ĐÚNG THỨ TỰ NÀY

```bash
git pull                                  # nhánh auth-user-management-spec
node .kiro/specs/auth-user-management/tools/anti-drift-check.js   # PHẢI exit 0
```

1. **KHÔNG tin bản tóm tắt hội thoại** (bài học N-060/N-081). Luôn đọc lại `git log` +
   `.kiro/specs/auth-user-management/decisions/00-INDEX.md` §2 (high-water) trước khi ghi ledger.
2. Trình kiểm tra ở trên là **lớp chống drift số 6** (N-095) — nó exit ≠ 0 nếu ledger/traceability sai;
   đã được chứng minh bắt được 3 loại drift thật. Chạy nó trước và sau mỗi lần sửa spec.
3. Steering `.kiro/steering/auth-user-management-antidrift.md` + `thinking-and-answering.md` tự nạp.

## 1. TRẠNG THÁI (đã kiểm chứng)

- HEAD: `3eeb72b` trên `auth-user-management-spec`, push cả 2 remote (`origin` **và** `orgin`, cùng URL
  `https://github.com/mgcoder9x/fuxa-scada.git`).
- **High-water: D→054, DV→014, TO→016, N→101, P→020.** ID mới phải > các số này, không tái dùng.
- Test: **server 216 passing**, **client jest 136 passing / 11 suites**, `ng build --configuration production` exit 0.
- Module auth **đang LIVE** trên instance thật (stage-4 flip, N-074). 5 trụ cột xong; Task 1–18 xong;
  Phase 2: **24.2 + 24.3 + 20.3 xong** (2026-07-28); còn 24.1/24.4/24.5/24.6 (xem §5).

## 2. LỆNH BẮT BUỘC (sai là mất thời gian)

```bash
# CLIENT — luôn production, `npm run build` trơn = JIT = TRANG TRẮNG (N-048/D-038)
cd client && npx ng build --configuration production
cd client && npx jest --runInBand          # parallel bị OOM trên máy cũ, không phải lỗi test

# SERVER
cd server && node .\node_modules\mocha\bin\mocha.js "test/auth-management/**/*.test.js" --timeout 40000 --reporter dot
cd server && node main.js                  # listen sau ~12–60s (init dao động, N-096/N-090)
```

## 3. RUNTIME + CREDENTIAL (⚠️ `_appdata/**` KHÔNG track git → máy mới KHÔNG có)

- `server/_appdata/settings.js` (local, gitignored) đang bật: `secureEnabled:true`,
  `authModuleEnabled:true`, `userRole:true`, `tokenExpiresIn:'1h'`, `secretCode:'b544028b…d1eb'`,
  `nodeRedAuthMode:"secure"`.
- DB `users.fuxap.db` (local): user = `admin` + `operator1`; role = `viewer_test[user.read]`.
  - `admin` / `Fx-vbE8cHlVIfRpdr6lPc-9` (đã reset N-078; bcrypt cost 12, `mustRotate:false`, tokenVersion 3)
  - `operator1` / `Oper4tor-Test-2026` — **user TEST, xoá trước khi production**
- Máy mới sẽ **seed admin mới** (bootstrap in one-time secret ra console) vì không có `_appdata`.
  Nếu cần đặt lại mật khẩu: ghi bcrypt cost-12 verbatim vào cột `password`, giữ `mustRotate:false`,
  bump `tokenVersion`. **KHÔNG đặt `123456`** — bootstrap sẽ force-rotate lại (xem `_remediateKnownDefaultAdmins`).

## 4. VỪA LÀM XONG (2026-07-28 — đọc N-097…N-101 nếu cần chi tiết)

- **24.2 / D-052 / DV-013 / N-097**: dưới SUPERSEDE, URL trực tiếp `/users`→`/auth/users`,
  `/userRoles`→`/auth/roles` (guard `LegacyUserAdminRedirectGuard` chạy TRƯỚC `AuthGuard`; chờ
  `SettingsService.loaded$` để tránh race cờ default-false N-096-class). Cờ OFF = byte-identical.
- **24.3 / D-053 / DV-014 / N-098**: `AuthGuard` — non-admin ĐÃ đăng nhập (non-guest) vào route admin
  nhận "Unauthorized!" ngay, KHÔNG mở dialog login; chưa-đăng-nhập/guest vẫn có dialog; admin không đổi.
  Deny-preserving (chỉ đổi UI từ chối), reuse `msg.signin-unauthorized` (0 churn i18n).
- **20.3 / D-054 Option B / N-099-101**: runtime `jwtIssuer`/`jwtAudience`/`jwtAlgorithm` ở
  `/auth/settings` (mục "Advanced — Token signing"). N-099 (kiểm chứng jsonwebtoken thật): overlap-window
  §12 phải hand-roll iss/aud trong `verify` cho ca unset→set ⇒ user chọn **Option B**: `verify` GIỮ
  strict + thư viện enforce; đổi iss/aud/alg = sự kiện CÓ XÁC NHẬN, kết thúc mọi phiên (token cũ fail
  verify ⇒ re-login). alg HS-only (secretCode là shared secret). e2e live đã verify + Reset về HS256.
- **⚠️ GOTCHA (N-101)**: sửa code SERVER phải RESTART `node main.js` mới có hiệu lực (module cache trong
  RAM) — lần save đầu bị `400 unknown field` vì service cũ còn trong bộ nhớ. Client static tự cập nhật từ disk.

> Trước đó (2026-07-27, N-092…N-096): D-050 permissions server-authoritative, D-051 rejection codes +
> affordances, N-094/095 anti-drift layer 6, D-049 Phase 2 `/auth/settings`.

## 5. CÒN LẠI (xếp theo giá trị — chi tiết ở `tasks.md` task 24)

1. **24.1** — `.gitattributes` `* text=auto eol=lf` + `binary` cho ảnh/font. **CHỜ USER DUYỆT**
   (commit renormalize diện rộng). Đo được: cùng 1 font = 678.869 B (LF, repo) vs 688.873 B (CRLF, máy cũ)
   ⇒ mọi hash `client/dist` đổi theo máy (N-089).
2. **24.4** — i18n: ~44 + 4 + 34 + 9 key là **máy dịch**, cần người bản ngữ soát (13 locale).
3. **24.5** — nâng Angular (XSS framework) + CSP thật. Đã có bằng chứng defer: FUXA không dùng SSR nên ~3
   advisory N/A (N-079); CSP thật đòi bỏ inline script + `eval` của tính năng script (N-080).
4. **24.6** — init boot dao động 12–62s, chưa root-cause, không chặn (nhưng làm chậm mỗi lần restart+test).

## 6. GOTCHA (đã trả giá rồi)

- **Mở browser thật để test** — Playwright MCP hoạt động. jest + build xanh vẫn có thể vỡ trên browser:
  N-096 vừa bắt `[(ngModel)]` trên `type="number"` trả **number** làm `.trim()` nổ mỗi vòng change-detection.
- `client/dist` **được git track** → phải rebuild production trước khi commit thay đổi client.
- Restart server khi tab đang mở → flood `ERR_CONNECTION_REFUSED` trong console: **artifact, không phải bug**.
- **Sửa code SERVER phải RESTART `node main.js`** (module cache RAM) mới có hiệu lực — client static thì tự
  cập nhật từ disk. Bỏ qua sẽ thấy hành vi server CŨ dù file đã đúng (N-101, mất thời gian thật).
- FUXA-core chỉ sửa qua adapter + 1 dòng mount (D-003); mọi sửa in-place phải log là `DV-*`
  (đang có DV-011 `home.component.ts`, DV-012 `auth.service.ts`, DV-013 `app.routing.ts`, DV-014 `auth.guard.ts`).
- Ledger **append-only**: không sửa/xoá entry cũ, không tái dùng ID, `TO-003` bị quarantine.

## 7. FILE QUAN TRỌNG

- Ledger: `.kiro/specs/auth-user-management/decisions/{00-INDEX,01-ai-decisions,02-deviations,03-tradeoffs,04-notes,traceability,GATES}.md`
- Gate: `.kiro/specs/auth-user-management/tools/anti-drift-check.js`
- Kế hoạch: `.kiro/specs/auth-user-management/tasks.md` (§Phase 2 = việc đang làm)
- Server module: `server/auth-management/**` · Client module: `client/src/app/auth-management/**`
- Runtime local (không push): `server/_appdata/settings.js`, `server/_appdata/users.fuxap.db`
