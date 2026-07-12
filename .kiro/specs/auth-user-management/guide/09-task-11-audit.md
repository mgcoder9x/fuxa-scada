# 09 — Task 11: Audit Logging (ghi nhật ký an ninh)

> Tương ứng **Task 11** trong `../tasks.md`. Requirement: 14.1–14.5.
> Thiết kế: `../design/09-audit-logging.md`. Không sở hữu property (test kiểu ví dụ).

## Mục tiêu

Có `Audit_Logger.record(event)`: ghi một dòng nhật ký cho mỗi sự kiện an ninh (đăng nhập, CRUD user,
CRUD role, từ chối phân quyền). Hai bảo đảm: **không chứa bí mật** (AC-14.5) và **không làm sập** thao
tác nghiệp vụ (§09 §7). Tận dụng logger winston sẵn có của FUXA.

## Phụ thuộc

Task 1 (interface Audit_Logger). Task 7/8/9 (nơi phát sự kiện) — bước 11.2 nối vào chúng.

## Kiến thức nền (đã kiểm chứng `server/runtime/logger.js`)

- Logger có `info(str, notConsoleLog=false)` và `error(str, flag)`; ghi ra `${logDir}/fuxa.log`
  (info) và `fuxa-err.log` (error). Định dạng dòng: `<time> [level] <message>`; message không phải
  chuỗi sẽ bị `JSON.stringify`.
- Ta ghi audit thành **một dòng** bắt đầu bằng `AUDIT ` + JSON (dễ `grep`, dễ máy đọc), gọi
  `logger.info(line, true)` (true = không spam console).

---

## Bước 1 (11.1) — Audit_Logger + Audit_Sink

Tạo `server/auth-management/services/audit-logger.js`:

```javascript
//@ts-check
'use strict';

// Sink mặc định: dùng logger winston của FUXA (KHÔNG sửa file lõi).
function createFuxaAuditSink(fuxaLogger) {
  return {
    write(line) { fuxaLogger.info(line, true); },        // true = không in console
    writeError(line) { fuxaLogger.error(line); },
  };
}

class Audit_Logger {
  /** @param {{ write(line:string):void, writeError?(line:string):void }} sink */
  constructor(sink) { this.sink = sink; }

  /**
   * Ghi một sự kiện. void, TOÀN PHẦN, KHÔNG NÉM cho bên gọi (§09 §7).
   * event: { category, subject, operation?, outcome, timestamp, detail? } — KHÔNG có trường bí mật.
   */
  record(event) {
    try {
      // Kiểm hình dạng tối thiểu
      if (!event || typeof event.category !== 'string' || typeof event.subject !== 'string'
          || typeof event.outcome !== 'string' || typeof event.timestamp !== 'string') {
        if (this.sink.writeError) this.sink.writeError('AUDIT_ERROR malformed audit event');
        return;
      }
      const safe = {
        category: event.category, subject: event.subject,
        operation: event.operation, outcome: event.outcome,
        timestamp: event.timestamp, detail: event.detail,
      };
      this.sink.write('AUDIT ' + JSON.stringify(safe));
    } catch (e) {
      // Nuốt lỗi: audit hỏng KHÔNG được làm sập nghiệp vụ
      try { if (this.sink.writeError) this.sink.writeError('AUDIT_ERROR ' + String(e)); } catch (_e) {}
    }
  }
}

module.exports = { Audit_Logger, createFuxaAuditSink };
```

**Điểm cần nhớ:** `record` chỉ chép các trường an toàn được truyền vào (không "thêm mắm" — AC-14.5a);
`Audit_Event` không có trường password/hash/token nên bí mật không thể lọt (AC-14.5 nửa cấu trúc).

---

## Bước 2 (11.2) — Nối điểm phát sự kiện vào các service

Việc gọi `audit.record(...)` đã được nhúng sẵn ở các service bạn viết trước:
- **Đăng nhập** (Task 7): `_audit(username, outcome)` cho mọi kết quả (success/unknown_user/bad_password/rate_limited).
- **User CRUD** (Task 9): `_audit('user.create'|'user.update'|'user.delete', username)`.
- **Role CRUD** (Task 8): `_audit('role.create'|'role.update'|'role.delete', roleId)`.
- **Từ chối phân quyền** (Task 8/13): khi `isAllowed` trả `allow:false`, tầng middleware (Task 13)
  gọi `audit.record({ category:'authz.denied', subject: identity, operation: op, outcome:'denied', detail: '401'|'403', timestamp })`.

> Nếu ở Task 7–9 bạn đã tiêm `auditLogger` giả, giờ chỉ cần tiêm bản thật (Task 13 ráp ở composition root).
> **Quy tắc bất di:** service dựng `Audit_Event` từ **biến an toàn** (username, outcome, thời gian ISO),
> KHÔNG spread cả request/record vào event; KHÔNG đặt mật khẩu/hash vào `subject`/`detail`.

Kiểm nhanh AC-14.4 (ghi từ chối) ở middleware — mẫu (đầy đủ ở Task 13):

```javascript
const decision = await authorization.isAllowed(identity, op);
if (!decision.allow) {
  auditLogger.record({
    category: 'authz.denied',
    subject: identity.username || 'guest',
    operation: op.requiredPermission,
    outcome: 'denied',
    detail: String(decision.status),   // '401' | '403' — KHÔNG chứa bí mật
    timestamp: new Date().toISOString(),
  });
  return res.status(decision.status).json({ error: decision.error });
}
```

---

## Bước 3 (11.3) — Test ghi & loại trừ bí mật

Tạo `server/auth-management/services/audit-logger.test.js`:

```javascript
//@ts-check
'use strict';
const { expect } = require('chai');
const { Audit_Logger } = require('./audit-logger');

function fakeSink() {
  const lines = []; const errors = [];
  return { lines, errors, write(l) { lines.push(l); }, writeError(l) { errors.push(l); } };
}

describe('Audit_Logger', () => {
  it('AC-14.1..14.4: ghi đúng danh mục + trường bắt buộc, dòng bắt đầu AUDIT + JSON', () => {
    const sink = fakeSink();
    const audit = new Audit_Logger(sink);
    audit.record({ category: 'auth.signin', subject: 'alice', outcome: 'success', timestamp: '2020-01-01T00:00:00Z' });
    expect(sink.lines).to.have.length(1);
    expect(sink.lines[0].startsWith('AUDIT ')).to.equal(true);
    const obj = JSON.parse(sink.lines[0].slice('AUDIT '.length));
    expect(obj).to.include({ category: 'auth.signin', subject: 'alice', outcome: 'success' });
    expect(obj.timestamp).to.be.a('string');
  });

  it('AC-14.5a: logger KHÔNG thêm trường ngoài những gì bên gọi đưa', () => {
    const sink = fakeSink();
    new Audit_Logger(sink).record({ category: 'user.create', subject: 'bob', outcome: 'ok', timestamp: 't' });
    const obj = JSON.parse(sink.lines[0].slice(6));
    // chỉ có các khóa cho phép, không có gì lạ (operation/detail undefined bị JSON bỏ)
    expect(Object.keys(obj).sort()).to.deep.equal(['category', 'outcome', 'subject', 'timestamp']);
  });

  it('AC-14.5b: mật khẩu/hash KHÔNG bao giờ xuất hiện trong dòng audit', () => {
    const sink = fakeSink();
    // caller đúng đắn: chỉ đưa username/outcome — event không có chỗ cho bí mật
    new Audit_Logger(sink).record({ category: 'auth.signin', subject: 'alice', outcome: 'bad_password', timestamp: 't' });
    const line = sink.lines[0];
    expect(line).to.not.contain('matkhau');   // ví dụ plaintext
    expect(line).to.not.contain('$2a$');       // tiền tố hash bcrypt
  });

  it('§09 §7: sink lỗi KHÔNG làm record ném lỗi', () => {
    const badSink = { write() { throw new Error('disk full'); }, writeError() {} };
    const audit = new Audit_Logger(badSink);
    expect(() => audit.record({ category: 'x', subject: 's', outcome: 'o', timestamp: 't' })).to.not.throw();
  });

  it('event méo mó ⇒ ghi lỗi nội bộ, không ném', () => {
    const sink = fakeSink();
    new Audit_Logger(sink).record({ category: 'x' }); // thiếu subject/outcome/timestamp
    expect(sink.lines).to.have.length(0);
    expect(sink.errors).to.have.length(1);
  });
});
```

---

## Cách kiểm chứng

```powershell
npx mocha server/auth-management/services/audit-logger.test.js --timeout 20000
```

Mong đợi: **5 test PASS**.

## Đã xong task khi

- [ ] `Audit_Logger.record` void, không ném; dòng `AUDIT ` + JSON.
- [ ] Sink mặc định dùng `logger.info(line, true)` của FUXA.
- [ ] Không lộ bí mật; sink lỗi không làm sập; event méo mó ghi lỗi nội bộ.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 11 (11.1–11.3) |
| Requirement | 14.1–14.5 |
| Thiết kế | `../design/09-audit-logging.md` |
| Quyết định | D-004/D-004c (bên gọi làm sạch bí mật) |

➡️ Xong Task 11 → sang `10-task-12-bootstrap.md` (sẽ tạo tiếp).
