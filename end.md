# HANDOFF — FUXA auth-user-management (cập nhật 2026-07-28)

> Bàn giao để CHUYỂN MÁY. Giữ NGẮN, chỉ ghi thứ máy mới cần để tiếp tục CHÍNH XÁC.
> Module IAM (Authentication + RBAC + User-Management) SUPERSEDE auth built-in của FUXA. Repo:
> Node.js server + Angular 18 client. Nhánh: `auth-user-management-spec`.

## 0. VÀO MÁY MỚI — LÀM ĐÚNG THỨ TỰ NÀY

```bash
git pull                                                          # nhánh auth-user-management-spec
node .kiro/specs/auth-user-management/tools/anti-drift-check.js   # PHẢI exit 0
git add --renormalize .                                           # 1 lần: nếu có diff LF (do .gitattributes mới), commit nó rồi thôi
```

1. **KHÔNG tin bản tóm tắt hội thoại** (bài học N-060/N-081). Luôn đọc lại `git log --oneline -8` +
   `.kiro/specs/auth-user-management/decisions/00-INDEX.md` §2 (high-water) TRƯỚC khi ghi ledger.
2. Trình kiểm tra ở trên là **lớp chống drift số 6** (N-095): exit ≠ 0 nếu ledger/traceability sai. Chạy trước & sau mỗi lần sửa spec.
3. Steering tự nạp: `.kiro/steering/auth-user-management-antidrift.md` + `thinking-and-answering.md` (trả lời tiếng Việt, kết luận trước, không bịa, fix tận gốc).

## 1. TRẠNG THÁI (đã kiểm chứng 2026-07-28)

- HEAD mới nhất trên `auth-user-management-spec`, push cả 2 remote **`origin` VÀ `orgin`** (cùng URL
  `https://github.com/mgcoder9x/fuxa-scada.git`). Lấy HEAD thực bằng `git log`.
- **High-water: D→054, DV→014, TO→016, N→103, P→020.** ID mới phải > các số này, không tái dùng.
- Test: **server 216 passing**, **client jest 136 passing / 11 suites**, `ng build --configuration production` exit 0, anti-drift exit 0.
- **Boot server ~2.8s** (trước ~63s; fix N-102). `.gitattributes` đã có (N-103) → LF nhất quán mọi máy.
- Module auth **đang LIVE** trên instance thật (stage-4 flip, N-074). 5 trụ cột xong; Task 1–18 xong.
  **Phase 2 (task 19–24): 19,20,21,22,23 + 24.1,24.2,24.3,24.6 XONG. Chỉ còn 24.4 + 24.5** (đều cần input ngoài, §5).
- **Module IAM feature-complete cho phạm vi thương mại lõi.** Còn lại chỉ hardening/hygiene.

## 2. LỆNH BẮT BUỘC (sai là mất thời gian)

```bash
# CLIENT — luôn production. `npm run build` trơn = JIT = TRANG TRẮNG (N-048/D-038).
cd client && npx ng build --configuration production
cd client && npx jest --runInBand          # parallel OOM trên máy cũ, KHÔNG phải lỗi test

# SERVER
cd server && node .\node_modules\mocha\bin\mocha.js "test/auth-management/**/*.test.js" --timeout 40000 --reporter dot
cd server && node main.js                  # listen sau ~3s giờ (đã fix N-102); log boot ở server/_logs/fuxa.log
```

## 3. RUNTIME + CREDENTIAL (⚠️ `server/_appdata/**` KHÔNG track git → máy mới KHÔNG có → sẽ seed admin mới)

- `_appdata/settings.js` (local, gitignored) đang bật: `secureEnabled:true`, `authModuleEnabled:true`,
  `userRole:true`, `tokenExpiresIn:'1h'`, `secretCode:'b544028b…d1eb'`, `nodeRedAuthMode:"secure"`.
- DB `users.fuxap.db` (local): user `admin` + `operator1`; role `viewer_test[user.read]`.
  - `admin` / `Fx-vbE8cHlVIfRpdr6lPc-9` (bcrypt cost 12, `mustRotate:false`, tokenVersion 3)
  - `operator1` / `Oper4tor-Test-2026` — **user TEST, xoá trước production**
- Máy mới KHÔNG có `_appdata` → bootstrap **seed admin mới + in one-time secret ra console**. Đặt lại mật khẩu:
  ghi bcrypt cost-12 verbatim vào cột `password`, giữ `mustRotate:false`, bump `tokenVersion`.
  **KHÔNG đặt `123456`** (bootstrap `_remediateKnownDefaultAdmins` force-rotate lại).

## 4. VỪA LÀM XONG 2026-07-28 (đọc N-097…N-103 nếu cần chi tiết)

- **24.2 / D-052 / DV-013 / N-097**: SUPERSEDE redirect URL trực tiếp `/users`→`/auth/users`,
  `/userRoles`→`/auth/roles` (guard `LegacyUserAdminRedirectGuard` chạy TRƯỚC `AuthGuard`; chờ
  `SettingsService.loaded$` tránh race cờ default-false). Cờ OFF = byte-identical.
- **24.3 / D-053 / DV-014 / N-098**: `AuthGuard` — non-admin ĐÃ đăng nhập (non-guest) vào route admin nhận
  "Unauthorized!" ngay, KHÔNG mở dialog login; chưa-đăng-nhập/guest vẫn có dialog; admin không đổi. Deny-preserving.
- **20.3 / D-054 Option B / N-099-101**: runtime `jwtIssuer`/`jwtAudience`/`jwtAlgorithm` ở `/auth/settings`
  (mục "Advanced — Token signing"). N-099 (kiểm chứng jsonwebtoken thật): overlap-window §12 phải hand-roll
  iss/aud trong `verify` cho ca unset→set ⇒ user chọn **Option B**: `verify` GIỮ strict + thư viện enforce;
  đổi iss/aud/alg = sự kiện CÓ XÁC NHẬN kết thúc mọi phiên (token cũ fail verify ⇒ re-login). alg HS-only.
- **24.6 / N-102**: boot 63.6s→2.8s. Gốc: deferred-mount của ta `once('init-users-ok',build)` làm phồng
  `listenerCount` mà FUXA `runtime/index.js checkInit` dùng làm proxy "users init xong" → gate không bao giờ
  fire sớm → rơi fallback 60s. Fix: `prependOnceListener` (build chạy+gỡ trước checkInit). Fix ở seam D-014 của ta.
- **24.1 / N-103**: `.gitattributes` (`* text=auto eol=lf` + `binary` cho png/gif/jpg/ico/icns/eot/ttf/otf/woff/woff2/pdf/zip).
  Gốc N-089: font không đánh dấu binary bị CRLF-convert (678KB LF vs 688KB CRLF) → hash `client/dist` lệch theo máy.
  `git add --renormalize .` ra 0 thay đổi (repo vốn LF sạch) ⇒ đây là fix PHÒNG NGỪA bền vững.

> Trước đó (2026-07-27, N-092…N-096): D-050 permissions server-authoritative, D-051 rejection codes + affordances,
> N-094/095 anti-drift layer 6 + `tools/anti-drift-check.js`, D-049 Phase 2 trang `/auth/settings`.

## 5. CÒN LẠI — chỉ 2 mục, cả 2 CẦN INPUT NGOÀI (chi tiết `tasks.md` task 24)

1. **24.4 — i18n native review:** ~91 key là **máy dịch** (13 locale) → cần **người bản ngữ** soát. AI không tự
   "hoàn thành" được. An toàn: soạn "review packet" (key + bản gốc EN + bản dịch từng locale) — nhưng là tạo file
   markdown, chỉ làm khi user yêu cầu rõ.
2. **24.5 — nâng Angular + CSP thật:** **lớn, rủi ro hồi quy framework cao**, đã có bằng chứng defer (N-079 FUXA
   không SSR nên ~3 advisory N/A; N-080 CSP thật đòi bỏ inline script + `eval` của tính năng script). Cần pass
   thiết kế riêng + user go-ahead trước khi động vào.

## 6. GOTCHA (đã trả giá rồi)

- **Mở browser thật để test** (Playwright MCP hoạt động). jest + build xanh vẫn có thể vỡ trên browser
  (N-096: `[(ngModel)]` trên `type="number"` trả **number** làm `.trim()` nổ).
- **Sửa code SERVER phải RESTART `node main.js`** (module cache RAM) mới có hiệu lực; client static tự cập nhật từ
  disk. Bỏ qua = thấy hành vi server CŨ dù file đã đúng (N-101, mất thời gian thật).
- `client/dist` **được git track** → rebuild production trước khi commit thay đổi client.
- Restart server khi tab đang mở → flood `ERR_CONNECTION_REFUSED` trong console: **artifact, không phải bug**.
- FUXA-core chỉ sửa qua adapter + 1 dòng mount (D-003); mọi sửa in-place phải log `DV-*`
  (đang có DV-011 `home.component.ts`, DV-012 `auth.service.ts`, DV-013 `app.routing.ts`, DV-014 `auth.guard.ts`).
- Ledger **append-only**: không sửa/xoá entry cũ, không tái dùng ID, `TO-003` bị quarantine.
- Push 2 remote: `git -c credential.helper=manager push origin auth-user-management-spec` rồi lặp lại với `orgin`.

## 7. FILE QUAN TRỌNG

- Ledger: `.kiro/specs/auth-user-management/decisions/{00-INDEX,01-ai-decisions,02-deviations,03-tradeoffs,04-notes,traceability,GATES}.md`
- Gate: `.kiro/specs/auth-user-management/tools/anti-drift-check.js`
- Kế hoạch: `.kiro/specs/auth-user-management/tasks.md` (§Phase 2)
- Design runtime-config: `.kiro/specs/auth-user-management/design/13-runtime-config.md` (§12 = D-054/Option B)
- Server module: `server/auth-management/**` · Client module: `client/src/app/auth-management/**`
- SUPERSEDE seam (deferred mount): `server/api/index.js` · FUXA readiness gate: `server/runtime/index.js`
- Runtime local (KHÔNG push): `server/_appdata/settings.js`, `server/_appdata/users.fuxap.db`
