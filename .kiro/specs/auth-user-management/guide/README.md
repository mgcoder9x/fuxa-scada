# Hướng dẫn tự triển khai — Module Xác thực & Quản lý người dùng (RBAC)

> Thư mục này hướng dẫn **bạn tự tay làm** module, từng bước nhỏ nhất, bằng tiếng Việt.
> Mỗi file hướng dẫn bám đúng một task trong `../tasks.md`. Đọc theo đúng thứ tự số.

## Cách dùng thư mục này

1. Đọc `00-chuan-bi.md` trước — cài đặt, quy ước, cách chạy test. **Bắt buộc đọc.**
2. Làm lần lượt từng file `NN-task-...md` theo số tăng dần. Không nhảy cóc: task sau phụ thuộc task trước.
3. Mỗi file có cấu trúc giống nhau:
   - **Mục tiêu** — task này làm xong thì có gì.
   - **Phụ thuộc** — cần task nào xong trước.
   - **File sẽ tạo** — đường dẫn cụ thể.
   - **Các bước** — đánh số, mỗi bước một việc nhỏ, kèm code mẫu và giải thích.
   - **Cách kiểm chứng** — lệnh chạy + kết quả mong đợi để biết đã đúng.
   - **Đối chiếu** — task/requirement/property tương ứng để tra ngược.

## Bản đồ tài liệu (đọc kèm khi cần chi tiết kỹ thuật)

| Bạn cần hiểu | Đọc file |
|--------------|----------|
| Phải làm gì (yêu cầu) | `../requirements.md` |
| Kiến trúc tổng | `../design.md` |
| Chi tiết từng phần | `../design/01..12-*.md` |
| Vì sao quyết định thế | `../decisions/01-ai-decisions.md`, `03-tradeoffs.md` |
| Bản đồ REQ ⇄ thiết kế ⇄ property | `../decisions/traceability.md` |
| Danh sách task gốc | `../tasks.md` |

## Nguyên tắc vàng khi làm (để không sai lệch thiết kế)

1. **Chỉ chạm FUXA lõi qua 3 adapter + 1 dòng mount.** Mọi code mới nằm trong
   `server/auth-management/` và `client/src/app/auth-management/`. Không sửa trực tiếp file lõi FUXA.
2. **Mật khẩu chỉ tồn tại dạng hash.** Không log, không lưu, không so sánh plaintext ở đâu ngoài `Password_Hasher`.
3. **Làm xong bước nào, chạy test bước đó ngay.** Đừng dồn. Đỏ thì sửa trước khi đi tiếp.
4. **Khi bí, đọc file thiết kế của mục tương ứng** (cột "Đối chiếu" cuối mỗi guide chỉ rõ).
5. **Nếu phải lệch khỏi hướng dẫn**, ghi lại lý do vào `../decisions/` (giữ thói quen chống drift).

## Danh sách các bước (sẽ được tạo dần)

- [x] `00-chuan-bi.md` — Chuẩn bị môi trường & quy ước ✅
- [x] `01-task-1-khung-module.md` — Khung module + mô hình dữ liệu + interface ✅
- [x] `02-task-2-luu-tru.md` — Serialization + Store adapter ✅
- [x] `03-task-3-password-hasher.md` — Băm mật khẩu ✅
- [x] `04-task-5-token-service.md` — Token & phiên ✅
- [x] `05-task-6-brute-force.md` — Chống dò mật khẩu ✅
- [x] `06-task-7-authentication.md` — Đăng nhập / đăng xuất ✅
- [x] `07-task-8-rbac.md` — Vai trò & phân quyền ✅
- [x] `08-task-9-user-crud.md` — CRUD người dùng ✅
- [x] `09-task-11-audit.md` — Ghi nhật ký audit ✅
- [x] `10-task-12-bootstrap.md` — Admin đầu tiên + đổi mật khẩu + di trú ✅
- [x] `11-task-13-api.md` — Router + middleware + mount ✅
- [x] `12-task-15-client.md` — HTTP client phía trình duyệt ✅
- [x] `13-task-16-ui-login.md` — Trang đăng nhập ✅
- [x] `14-task-17-ui-users.md` — Trang quản lý người dùng ✅

> Trạng thái: **HOÀN TẤT** — đã tạo đủ toàn bộ hướng dẫn (00–14).

---

## ⚠️ ĐỐI CHIẾU LẠI THEO THIẾT KẾ ĐÃ SỬA (RECONCILIATION — 2026-07-13)

> **Bắt buộc đọc trước khi code.** Đợt rà soát sâu 2026-07-13 đã phát hiện & sửa **11 defect thiết kế**
> (N-010…N-019, N-021) và tinh chỉnh 3 requirement (DV-006/007/008). **Thiết kế (`../design/*` +
> `../requirements.md`) là chuẩn tắc; guide là phi-chuẩn-tắc.** Ở đâu guide mâu thuẫn với thiết kế đã
> sửa, **làm theo thiết kế**. Các file guide dưới đây có banner "⚠️ ĐỐI CHIẾU" ở đầu ghi rõ chỗ bị ghi đè.

| Guide bị ảnh hưởng | Quyết định sửa | Tóm tắt thay đổi so với guide cũ |
|--------------------|----------------|----------------------------------|
| `02-task-2-luu-tru.md` | D-016, D-020 | Ghi user trong **1 transaction 1 connection** (không còn "2 connection không atomic"); `create` dùng `INSERT` (PK conflict = trùng), last-admin dùng `BEGIN IMMEDIATE` |
| `03-task-3-password-hasher.md` | D-017 / DV-007 | Giới hạn domain ≤72 byte UTF-8; P-002 phát biểu trên domain bị chặn; test không dùng near-dup >72 byte để "ép pass" |
| `04-task-5-token-service.md` | D-019, D-021, D-015 | Refresh **có state** (store hash-at-rest, reuse-detection RFC 9700); pin `alg` + thêm `iss/aud/sub/jti/typ/kid`; thêm `tokenVersion` để thu hồi |
| `05-task-6-brute-force.md` | DV-008, N-019 | **Adaptive throttling** (backoff mũ, có cap) thay hard lock; store **pluggable/shared**; đồng hồ **monotonic** |
| `06-task-7-authentication.md` | DV-006 | Unknown-user trả **401 giống hệt** bad-password (không còn 404) + dummy-hash để đồng bộ timing |
| `07-task-8-rbac.md` | D-015 | `Identity` lấy từ **bản ghi sống** (roles/groups/tồn tại/mustRotate), **không** tin claim trong token; kiểm `tokenVersion` |
| `08-task-9-user-crud.md` | D-017, D-020 | Validate từ chối mật khẩu >72 byte (AC-4.6) + min-length/blocklist (AC-4.7); create/last-admin atomic |
| `09-task-11-audit.md` | D-023 | Sink audit **chuyên dụng** `fuxa-audit.log` (rotation riêng), thêm field forensic, lỗi ghi = **tín hiệu health**, tùy chọn hash-chain |
| `10-task-12-bootstrap.md` | D-022, D-018 | Secret seed đi qua **kênh enrollment an toàn** (CLI/one-time token), **KHÔNG log ra console**; có endpoint `POST /api/account/rotate-password` |
| `11-task-13-api.md` | D-014, D-018, D-015, N-018 | **SUPERSEDE**: bỏ mount router FUXA cho URL trùng, module là authority; thêm account router; middleware dựng identity từ bản ghi sống; **tuyệt đối không** `runtime.logger` in secret |

**Trạng thái cổng:** G2 (CRITICAL) ✅, Wave B (HIGH) ✅, Wave C (MEDIUM) ✅, traceability §D ✅.
Sau khi guide được đối chiếu xong (mục này), **G4 mở** và mới được viết code theo `../tasks.md`.
