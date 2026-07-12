# 00 — Chuẩn bị môi trường & quy ước

> Đọc hết trang này **trước khi** làm Task 1. Mất khoảng 10 phút. Làm đúng phần này thì các task sau rất trơn.

## A. Kiểm tra công cụ đã có

Mở PowerShell trong thư mục dự án và chạy từng lệnh, đối chiếu kết quả:

```powershell
node --version    # cần >= 18 (máy bạn đang v25 — chạy được)
npm --version     # bất kỳ bản nào đi kèm node
```

Nếu `node` báo lỗi "not recognized" → bạn chưa cài Node.js. Cài từ trang chủ Node rồi mở lại PowerShell.

## B. Hiểu cấu trúc thư mục ta sẽ tạo

Toàn bộ code MỚI nằm trong 2 vùng (không đụng chỗ khác của FUXA):

```
server/auth-management/          <- code phía máy chủ (Node.js)
  api/                           <- tầng API (router Express, middleware)
  services/                      <- tầng nghiệp vụ (logic thuần, dễ test)
  store/                         <- tầng lưu trữ (interface + serialization)
  adapters/                      <- 3 "adapter" nối vào FUXA lõi
  models/                        <- mô hình dữ liệu
  index.js                       <- "composition root": ráp mọi thứ lại

client/src/app/auth-management/  <- code phía trình duyệt (Angular)
  login/                         <- trang đăng nhập
  user-management/               <- trang quản lý người dùng
  services/                      <- gọi API
  guards/                        <- bảo vệ route
```

Vì sao tách riêng `auth-management/`? Để khi FUXA ra bản mới, bạn cập nhật mà **gần như không xung đột** — code của bạn nằm gọn một chỗ. (Xem `../decisions/01-ai-decisions.md` mục D-003.)

## C. Cài thư viện test property-based (fast-check)

Ta dùng `fast-check` để viết "property test" (kiểm thử theo tính chất — chạy hàng trăm input ngẫu nhiên). FUXA đã có sẵn `mocha`/`chai`/`sinon`; chỉ cần thêm fast-check cho phần server:

```powershell
npm install --save-dev fast-check
```

Chạy lệnh này trong thư mục `server` (nơi có `package.json` của server):

```powershell
# đứng ở gốc dự án, trỏ vào server:
npm install --save-dev fast-check --prefix server
```

> Nếu chưa cài dependencies cho server, chạy `npm install --prefix server` trước.

## D. Cách chạy test (nhớ kỹ — dùng suốt)

FUXA server đã cấu hình sẵn mocha. Xem `server/package.json` mục `scripts.test`:
`"test": "mocha --recursive --timeout 10000"`.

- **Chạy toàn bộ test server:**
  ```powershell
  npm test --prefix server
  ```
- **Chạy một file test cụ thể** (nhanh hơn khi đang làm 1 task):
  ```powershell
  npx mocha server/auth-management/services/password-hasher.test.js --timeout 10000
  ```
  (đổi đường dẫn theo file bạn đang làm)

Quy ước đặt tên file test trong hướng dẫn này: đặt file test **cạnh** file nguồn, đuôi `.test.js`.
Ví dụ: `services/password-hasher.js` ↔ `services/password-hasher.test.js`.

## E. Quy ước viết property test (bắt buộc theo)

Mỗi property test PHẢI:
1. Dùng `fast-check` (không tự chế khung test).
2. Chạy **tối thiểu 100 vòng**: `fc.assert(fc.property(...), { numRuns: 100 })`.
3. Có **tag** ở tên test theo đúng mẫu:
   `Feature: auth-user-management, Property {n}: {mô tả}`.
   Ví dụ: `Feature: auth-user-management, Property 1: Password hash verifies its own plaintext`.

Mẫu khung một property test:

```javascript
const fc = require('fast-check');
const { expect } = require('chai');

describe('Password_Hasher', () => {
  it('Feature: auth-user-management, Property 1: Password hash verifies its own plaintext', () => {
    fc.assert(
      fc.property(fc.string(), (p) => {
        // ... phần kiểm tra tính chất ...
      }),
      { numRuns: 100 }
    );
  });
});
```

## F. Quy ước chung khi viết code service (rất quan trọng)

- **Tiêm phụ thuộc (dependency injection):** service KHÔNG tự `require` adapter/thư viện nặng bên trong; nhận chúng qua tham số constructor. Nhờ vậy test thay được bằng "đồ giả" (fake/spy).
  ```javascript
  // ĐÚNG:
  class Authentication_Service {
    constructor({ userStore, passwordHasher, tokenService, bruteForce, auditLogger }) { ... }
  }
  // SAI: bên trong lại require('bcryptjs') hay require('../adapters/...') trực tiếp
  ```
- **Trả về "kết quả dạng tập đóng" thay vì ném lỗi để điều khiển luồng.** Ví dụ `signIn` trả
  `{ kind: 'success' | 'unknown_user' | 'bad_password' | ... }`. Tầng API mới dịch sang mã HTTP.
  (Xem lý do trong `../design/01-authentication.md`.)
- **Không log mật khẩu / hash / token** ở bất kỳ đâu.

## G. Kiểm tra bạn đã sẵn sàng

Tick hết là qua được phần chuẩn bị:

- [ ] `node --version` và `npm --version` chạy ra số.
- [ ] Đã `npm install --prefix server` (thư mục `server/node_modules` tồn tại).
- [ ] Đã `npm install --save-dev fast-check --prefix server`.
- [ ] Chạy thử `npm test --prefix server` (kể cả chưa có test của mình, lệnh phải chạy được, không lỗi cấu hình).
- [ ] Hiểu 3 quy tắc: code mới nằm trong `auth-management/`; mật khẩu chỉ dạng hash; làm xong bước nào test bước đó.

Xong phần này → sang `01-task-1-khung-module.md`.
