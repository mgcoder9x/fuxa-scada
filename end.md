# HANDOFF — FUXA auth-user-management (deep state, for switching machines)

> Standing instructions (the user's contract — keep obeying every turn):
> Hãy xử lý để hệ thống cực tốt và an toàn; duyệt theo khuyến nghị từng bước chắc chắn, hướng tới lâu dài,
> sản phẩm thương mại chất lượng cao — "một lỗi sai hủy hoại cả công ty". Không bịa, không suy đoán, valid
> nhiều lần. Design rõ → đọc lại valid → chính xác kiểm chứng được rồi mới triển khai. Fix tận gốc, không fix
> ngọn. Không tiết kiệm token. Duy trì thư mục ledger 4 mục (quyết định AI / deviation / trade-off / notes)
> xuyên suốt + cơ chế chống drift cực mạnh. Ưu tiên MỞ WEB BẰNG BROWSER (Playwright MCP) để phát hiện lỗi
> thật mà test headless không thấy.

---

## 0. ĐỌC ĐẦU TIÊN KHI VÀO MÁY MỚI (anti-drift, bắt buộc)
1. `git pull` nhánh **`auth-user-management-spec`** (mọi thứ đã push tại đây).
2. Đọc `.kiro/specs/auth-user-management/decisions/00-INDEX.md` §2 (high-water) + §3 (drift log) + chạy §4 Integrity Check.
3. **QUY TẮC RESUME (bài học N-060):** ĐỪNG tin high-water trong bản tóm tắt hội thoại — luôn đọc lại `00-INDEX §2` + `git log`/`git status` THẬT trước khi append ledger (session này đã suýt tạo trùng ID N-048 vì tin summary cũ N-044; đã bắt + hoàn nguyên).
4. Steering `.kiro/steering/auth-user-management-antidrift.md` auto-load các luật này.
5. **High-water hiện tại: D→042, DV→011, TO→015, N→065, P→016.** ID kế tiếp phải > các số này, không tái dùng.

## 1. TOÀN CẢNH — ĐANG Ở ĐÂU
- **Server auth module (Tasks 1–13): XONG + tested** — `server/auth-management/**` (services/adapters/api/store/models). Mocha suite: **164 passing** (chạy từ `server/`: `node .\node_modules\mocha\bin\mocha.js "test/auth-management/**/*.test.js" --timeout 40000 --reporter dot`). KHÔNG sửa FUXA core ngoài 3 adapter + (chưa) 1 dòng mount.
- **Client auth module (Tasks 15, 16, 17.1–17.3): XONG + tested headless** — `client/src/app/auth-management/**` (clients/login/user-management/services/guards). jest (ts-jest, headless): ~65 tests pass.
- **Web BUILD + RENDER được** (production). N-044 (dependabot làm vỡ build) đã fix (D-037).
- **CÒN LẠI: Task 17.4 (SUPERSEDE cutover)** — xem §3. Đây là việc lớn cuối cùng.

## 2. VIỆC SESSION NÀY LÀM (đã/sắp push) — tất cả có trong git
- **D-037/N-047 — fix build client (N-044):** khôi phục bộ dep known-good (commit Initial `be8d1e7`) + giữ jest devdeps. ⚠️ **BUILD PHẢI LÀ PRODUCTION:** `cd client && npx ng build --configuration production`. `npm run build` trơn = JIT/blank (N-048 — trang trắng). FUXA serve `client/dist` (git-tracked).
- **DV-011/N-064 — fix FUXA-core crash (browser-verified):** `client/src/app/home/home.component.ts` — `this.hmi.layout.loginonstart` + `onLogin()` `loginoverlaycolor` thiếu null-guard → `?.` (crash khi security ON + project rỗng). Đã verify browser 0 lỗi.
- **N-061 — additive routes + i18n:** thêm route `auth/login`→LoginComponent, `auth/users`→UserManagementComponent trong `client/src/app/app.routing.ts` (KHÔNG dùng `loadComponent`/dynamic import — tsconfig `module:es2015` cấm; dùng `component:` trực tiếp). Thêm ~30 i18n key thiếu vào `client/src/assets/i18n/en.json` (là fallback lang `setDefaultLang('en')` → phủ cả 13 locale). Đã verify browser: login hiển thị "Username/Password/Sign In".
- **N-062/N-063 — verify browser (trước khi MCP hỏng):** login sai mật khẩu → 401 → thông báo generic, ở lại trang (đúng AC-11.4/11.5). Legacy `/api/signin` body không có field `error` id → client fallback `unexpected_error` (đúng thiết kế). Admin DB thật = **`admin`/`123456`** (verify bằng bcrypt trên `server/_appdata/users.fuxap.db`, đúng N-007).
- **D-042/N-065 — Task 17.4 Option-2 (BUILD-VERIFIED, BROWSER-VERIFY PENDING):** sửa `client/src/app/auth-management/login/login.component.ts` để seam `signIn` thiết lập session qua **`AuthService.signIn` của FUXA** (lưu `currentUser` kèm `groups`, publish token, emit `currentUser$`) → guard/isAdmin groups-based nhận login. `saveSession`=no-op, `navigateToApp`=reload `/`. CHỈ 1 file module, KHÔNG đụng FUXA-core/AuthGuard/server. `ng build --configuration production` exit 0, diagnostics 0.

## 3. VIỆC CÒN LẠI + ĐIỂM DỪNG CHÍNH XÁC (ưu tiên #1)
### 3.1 XÁC MINH BROWSER Option-2 (BLOCKER duy nhất để đóng 17.4)
Session này **KHÔNG verify được** vì **Playwright MCP bị wedged** (Chrome launch fail/đóng ngay, MCP trả lỗi cached pid cũ; đã dọn chrome về 0 nhưng MCP không hồi — cần **restart MCP server / IDE session mới**, ngoài tầm agent). Ở MÁY MỚI, Playwright thường sống lại → làm ngay:
1. `cd client && npx ng build --configuration production` (nếu chưa có dist mới).
2. Bật security: `server/_appdata/settings.js` bỏ comment `secureEnabled:true` + `secretCode:'<chuỗi mạnh>'` + `tokenExpiresIn:'1h'`. (⚠️ `_appdata/**` là runtime data **KHÔNG track git** → không có ở máy mới; DB `users.fuxap.db` cũng vậy → máy mới sẽ seed admin mới hoặc cần tạo. Kiểm tra lại admin bằng bcrypt.)
3. `cd server && node main.js` → mở `http://127.0.0.1:1881/auth/login`.
4. Test theo kịch bản (đã gửi user): render i18n → sai-pass → **đúng admin/123456 → phải reload về `/` + FUXA nhận admin (account menu) + `/editor` vào được + `/auth/users` liệt kê user** → F12 Console 0 lỗi đỏ.
5. Nếu ✅ hết: đóng 17.4 Option-2 (flip traceability §D + tasks 17.4), log N-066. Nếu ❌: fix tận gốc theo console/network.
### 3.2 Sau khi Option-2 verified (tùy chọn, cùng cutover)
- Trỏ `AuthGuard` sang module Login_Page sau **cờ `legacy`** đảo ngược (retire dialog FUXA cũ). Chưa làm.
### 3.3 Option 1 (migration đầy đủ groups→roles) — GIAI ĐOẠN SAU, rủi ro cao
- Viết lại `AuthService.isAdmin`/`checkPermission` + `AuthGuard` + interceptor sang roles-based + supersede `server/api/index.js` (D-014). **Blast radius toàn app** — cần duyệt riêng, làm cực kỹ. Đã phân tích ở D-042.

## 4. FOLLOW-UPS ĐÃ GHI (không được bỏ quên)
- **Bảo mật (TO-014):** `npm audit` client ~72 findings trên bộ dep cũ (đánh đổi khi revert dependabot). Vá chọn lọc ở phiên bản tương thích Angular 18 (ngx-translate 14.x, ng2-charts 4.x/5.x, gridster 18.x…).
- **i18n:** 30 key mới mới chỉ có tiếng Anh (fallback). Cần dịch 12 locale còn lại.
- **Node:** app build trên Node 24 dù FUXA nhắm Node 18 (EBADENGINE warning) — nên pin Node 18/20/22 cho reproducible.

## 5. GOTCHAS (kiểm chứng thật, không suy đoán)
- **`npm run build` = JIT dev = trang TRẮNG.** Luôn `--configuration production`.
- **Restart server khi tab browser đang mở → flood `ERR_CONNECTION_REFUSED`** ở console (socket.io/heartbeat poll) — **KHÔNG phải bug**, chỉ là artifact. Đừng nhầm là "cực nhiều lỗi".
- **"HTTP 200 ≠ render".** Phải xem render thật bằng browser (N-048).
- `client/dist` **được git track** (`.gitignore` có `!dist/`) → rebuild production trước khi push để dist khớp source.
- Đổi login.component sang Option-2 → `AuthSignInClient`/`SessionStore` tạm không dùng cho LOGIN (vẫn dùng cho User-Management). Đúng chủ ý Option-2 (server chưa cutover).

## 6. FILE PATHS CHÍNH
- Ledger: `.kiro/specs/auth-user-management/decisions/{00-INDEX,01-ai-decisions,02-deviations,03-tradeoffs,04-notes,traceability,GATES}.md`
- tasks: `.kiro/specs/auth-user-management/tasks.md` (17.4 = PARTIAL/PENDING)
- Client module: `client/src/app/auth-management/**` (login.component.ts = Option-2 mới)
- FUXA-core đã chạm (log rõ): `client/src/app/app.routing.ts` (routes), `client/src/app/home/home.component.ts` (null-guard DV-011), `client/src/assets/i18n/en.json` (i18n), `server/main.js` (D-040 SPA fallback + D-041 Node-RED, phiên trước)
- Server module: `server/auth-management/**`

## 7. TRẠNG THÁI KHI DỪNG
- Security **đã revert về OFF** trong `_appdata/settings.js` (nhưng file này không track git). Server local có thể còn chạy — không quan trọng khi đổi máy.
- Tất cả thay đổi source + ledger + dist đã **commit + push** lên `auth-user-management-spec`.
- Task 17.4 Option-2: **NOT-done tới khi verify browser** (§3.1).
