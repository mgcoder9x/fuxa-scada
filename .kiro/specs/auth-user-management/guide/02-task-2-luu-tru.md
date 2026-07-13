# 02 — Task 2: Serialization + Store adapter (nối vào FUXA)

> Tương ứng **Task 2** trong `../tasks.md`. Requirement: 13.1, 13.2, 13.3, 13.4, 5.4, 7.3, 8.1, 8.2, 4.2, 6.2, 9.1–9.4, 16.5.
> Thiết kế: `../design/06-persistence-and-serialization.md` (đọc kỹ mục §5 về "bẫy băm 2 lần").

> ### ⚠️ ĐỐI CHIẾU (2026-07-13) — GHI ĐÈ hướng dẫn cũ theo D-016 & D-020
> Guide bản đầu mô tả ghi user bằng **2 connection** và tự nhận "không gói chung 1 transaction được"
> (đây chính là defect **N-010**). **KHÔNG làm theo cách đó nữa.** Thiết kế đã sửa (`../design/06` §5.2–§5.4):
> - **D-016:** adapter ghi **tất cả cột** (kể cả `password` verbatim) trong **MỘT** `BEGIN…COMMIT` trên
>   **connection của chính adapter** (vẫn bỏ qua `setUser` để không băm 2 lần), rồi gọi `setUsers(bỏ password)`
>   như bước làm mới cache `usersMap` **best-effort ngoài transaction**. Không bao giờ để row có password NULL/cũ.
> - **D-020:** `create` dùng **`INSERT` thuần** (trùng username bị chặn atomic bởi khóa chính — không đọc-rồi-ghi);
>   guard xóa admin cuối chạy trong **`BEGIN IMMEDIATE`** để 2 lệnh xóa song song không cùng qua được kiểm đếm.
> - Task tương ứng: **2.8** (atomic write), **2.9** (atomic create + last-admin), **2.10\*** (property P-016).
>
> ⚠️ **Đây là task khó nhất.** Đọc chậm, làm từng bước, test từng bước. Nếu rối, dừng và nhắn tôi.

## Mục tiêu

Có tầng lưu trữ: module `serialization.js` (chuyển đổi object ↔ chuỗi JSON, chịu lỗi), và 2 adapter
nối vào FUXA (`FuxaUserStoreAdapter`, `FuxaRoleStoreAdapter`) — nơi DUY NHẤT biết shape dữ liệu của FUXA.
Xong task này thì user/role ghi xuống rồi đọc lên **không mất dữ liệu** (property P-003/P-004/P-005).

## Phụ thuộc

Task 1 (models + interface) đã xong.

## Kiến thức nền (đọc trước khi code — 3 phút)

FUXA lưu (đã kiểm chứng trong `server/runtime/users/usrstorage.js`):
- Bảng `users(username PK, fullname, password, groups INTEGER, info TEXT)` — `info` là **chuỗi JSON**;
  danh sách vai trò nằm trong `info.roles`.
- Bảng `roles(name PK, value TEXT)` — cột PK tên `name` nhưng **chứa `role.id`**; `value` là JSON của cả role.
- `runtime.users.setUsers({username,fullname,password,groups,info})` gọi `setUser`, mà **băm lại**
  bất kỳ `password` khác rỗng bằng `bcrypt.hashSync(pwd,10)`. → Nếu ta đưa hash sẵn vào đây sẽ thành
  **băm-của-băm**, verify vĩnh viễn sai. Đây là "bẫy băm 2 lần".
- `setUsers` khi `password` rỗng/undefined thì **không đụng cột password** (giữ nguyên hash cũ), và
  vẫn cập nhật cache quyền `usersMap` (cần cho AC-8.2). Nó gọi `JSON.parse(query.info)` → **`info` phải
  là chuỗi JSON hợp lệ**, không được `undefined`.

**Cách né bẫy (thiết kế đã chọn, §06 §5):**
1. Ghi các cột KHÔNG bí mật qua `runtime.users.setUsers` với `password` **bỏ trống** (giữ cache đồng bộ).
2. Ghi riêng cột `password` **nguyên văn** bằng một kết nối sqlite của riêng adapter (câu `UPDATE users SET password=? WHERE username=?`), KHÔNG qua `setUser` nên không bị băm lại.

> Lưu ý trung thực: hai bước dùng 2 kết nối sqlite khác nhau nên không gói chung 1 transaction tuyệt đối được.
> Rủi ro: nếu server chết đúng giữa 2 bước, user mới có thể có row mà chưa có password. Với app 1 tiến trình
> điều này hiếm và **tự lành** (lần lưu sau sẽ set lại password). Ta chấp nhận, ghi rõ ở đây.

---

## Bước 1 (2.1) — Module serialization chịu lỗi

Tạo `server/auth-management/store/serialization.js`:

```javascript
//@ts-check
'use strict';

class SerializationError extends Error {}

/** Chuyển object → chuỗi JSON. Ném SerializationError nếu object không mã hóa được (vòng lặp tham chiếu). */
function serialize(obj) {
  try {
    return JSON.stringify(obj === undefined ? {} : obj);
  } catch (e) {
    throw new SerializationError(`cannot_serialize: ${e.message}`);
  }
}

/**
 * Chuyển chuỗi JSON → object, CHỊU LỖI (không ném cho batch).
 * null/rỗng → {} (ok). Chuỗi hỏng → { ok:false, error:'invalid_metadata', detail, raw }.
 * @returns {{ok:true,value:any} | {ok:false,error:'invalid_metadata',detail:string,raw:string}}
 */
function deserialize(str) {
  if (str === null || str === undefined || str === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(str) };
  } catch (e) {
    return { ok: false, error: 'invalid_metadata', detail: e.message, raw: String(str) };
  }
}

module.exports = { serialize, deserialize, SerializationError };
```

---

## Bước 2 (2.2) — Property test P-005 (metadata round-trip)

Tạo `server/auth-management/store/serialization.test.js`:

```javascript
//@ts-check
'use strict';
const fc = require('fast-check');
const { expect } = require('chai');
const { serialize, deserialize } = require('./serialization');

// Sinh object "JSON-safe": chuỗi (unicode), số hữu hạn, bool, null, mảng, object lồng nhau.
const jsonSafeValue = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('value'), { maxLength: 5 }),
    fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 })
  ),
})).value;
const metadataArb = fc.dictionary(fc.string(), jsonSafeValue, { maxKeys: 6 });

describe('serialization', () => {
  it('Feature: auth-user-management, Property 5: Metadata serialization is an identity round-trip', () => {
    fc.assert(fc.property(metadataArb, (m) => {
      const r = deserialize(serialize(m));
      expect(r.ok).to.equal(true);
      expect(r.value).to.deep.equal(m);
    }), { numRuns: 100 });
  });

  it('deserialize chịu lỗi: chuỗi hỏng trả về lỗi, không ném', () => {
    const r = deserialize('{ khong-phai-json');
    expect(r.ok).to.equal(false);
    expect(r.error).to.equal('invalid_metadata');
  });

  it('null/rỗng → {} ok', () => {
    expect(deserialize(null)).to.deep.equal({ ok: true, value: {} });
    expect(deserialize('')).to.deep.equal({ ok: true, value: {} });
  });
});
```

Chạy: `npx mocha server/auth-management/store/serialization.test.js --timeout 10000` → mong đợi PASS.

---

## Bước 3 (2.3) — FuxaUserStoreAdapter

Đây là phần lõi. Adapter nhận vào: `runtimeUsers` (chính là `server/runtime/users`), `usersDbPath`
(đường dẫn file `users.fuxap.db`), và module `serialization`. Tạo
`server/auth-management/adapters/fuxa-user-store.adapter.js`:

```javascript
//@ts-check
'use strict';
const sqlite3 = require('sqlite3');
const { serialize, deserialize } = require('../store/serialization');

// Tách info (chuỗi JSON) -> { roles, metadata }. Khóa 'roles' cấp cao nhất là dành riêng (INV-1).
function splitInfo(infoStr) {
  const parsed = deserialize(infoStr);
  const obj = parsed.ok ? (parsed.value || {}) : {};
  const roles = Array.isArray(obj.roles) ? obj.roles : [];
  const metadata = Object.assign({}, obj);
  delete metadata.roles;
  return { roles, metadata, parseError: parsed.ok ? null : parsed };
}
// Ghép { roles, metadata } -> chuỗi info JSON. roles là quyền uy (ghi đè).
function composeInfo(roles, metadata) {
  return serialize(Object.assign({}, metadata || {}, { roles: roles || [] }));
}

class FuxaUserStoreAdapter {
  /** @param {{ runtimeUsers:any, usersDbPath:string }} deps */
  constructor({ runtimeUsers, usersDbPath }) {
    this.users = runtimeUsers;
    this.dbPath = usersDbPath;
  }

  // Mở kết nối riêng chỉ để ghi cột password nguyên văn (né băm lại của setUser).
  _writePasswordVerbatim(username, passwordHash) {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.dbPath, (err) => { if (err) return reject(err); });
      db.run('UPDATE users SET password = ? WHERE username = ?', [passwordHash, username], (err) => {
        db.close();
        if (err) reject(err); else resolve();
      });
    });
  }

  _rowToRecord(row) {
    const { roles, metadata } = splitInfo(row.info);
    return {
      username: row.username,
      fullname: row.fullname || '',
      passwordHash: row.password || '',   // dùng nội bộ (đăng nhập); tầng service loại bỏ khi trả UserView
      roles, metadata,
      groups: row.groups,
    };
  }

  async get(username) {
    const rows = await this.users.getUsers({ username });
    if (!rows || !rows.length) return undefined;
    return this._rowToRecord(rows[0]);
  }

  async readAll() {
    const rows = (await this.users.getUsers()) || [];
    const records = []; const errors = [];
    for (const row of rows) {
      const info = splitInfo(row.info);
      if (info.parseError) errors.push({ key: row.username, error: 'invalid_metadata', detail: info.parseError.detail });
      records.push(this._rowToRecord(row)); // vẫn trả record (roles/metadata rỗng nếu info hỏng)
    }
    return { records, errors };
  }

  async create(record) {
    const info = composeInfo(record.roles, record.metadata);
    // Bước 1: ghi cột không bí mật (password bỏ trống) — tạo row + cập nhật cache
    await this.users.setUsers({
      username: record.username, fullname: record.fullname,
      password: undefined, groups: record.groups, info,
    });
    // Bước 2: ghi password nguyên văn (không qua setUser)
    if (record.passwordHash) await this._writePasswordVerbatim(record.username, record.passwordHash);
  }

  async update(username, patch) {
    const existing = await this.get(username);
    if (!existing) throw new Error('user_not_found');
    const roles = patch.roles !== undefined ? patch.roles : existing.roles;
    const metadata = patch.metadata !== undefined ? patch.metadata : existing.metadata;
    const fullname = patch.fullname !== undefined ? patch.fullname : existing.fullname;
    const groups = patch.groups !== undefined ? patch.groups : existing.groups;
    const info = composeInfo(roles, metadata);
    // Bước 1: cập nhật cột không bí mật (password bỏ trống ⇒ giữ hash cũ — AC-7.3)
    await this.users.setUsers({ username, fullname, password: undefined, groups, info });
    // Bước 2: chỉ ghi password khi patch có passwordHash mới
    if (patch.passwordHash) await this._writePasswordVerbatim(username, patch.passwordHash);
  }

  async delete(username) {
    await this.users.removeUsers(username); // xóa row + usersMap.delete (AC-8.2)
  }
}

module.exports = { FuxaUserStoreAdapter, splitInfo, composeInfo };
```

**Điểm cần nhớ:**
- `create`/`update` luôn truyền `info` là chuỗi JSON (vì `setUsers` gọi `JSON.parse(info)`).
- `update` đọc bản cũ rồi merge → bỏ trường nào thì giữ nguyên trường đó (AC-7.3 giữ mật khẩu).
- Cột `password` chỉ ghi qua `_writePasswordVerbatim` → không bao giờ bị băm lại.

---

## Bước 4 (2.4) — FuxaRoleStoreAdapter

Tạo `server/auth-management/adapters/fuxa-role-store.adapter.js`:

```javascript
//@ts-check
'use strict';
const sqlite3 = require('sqlite3');
const { deserialize } = require('../store/serialization');

class FuxaRoleStoreAdapter {
  /** @param {{ runtimeUsers:any, usersDbPath:string }} deps */
  constructor({ runtimeUsers, usersDbPath }) {
    this.users = runtimeUsers;
    this.dbPath = usersDbPath;
  }

  async get(id) {
    const roles = await this.readAll();
    return roles.records.find(r => r.id === id);
  }

  // Đọc CHỊU LỖI để vá lỗ hổng getRoles của FUXA (parse không try/catch → 1 role hỏng làm sập cả danh sách).
  // Ta đọc thẳng cột value bằng kết nối riêng rồi tự parse resilient.
  readAll() {
    return new Promise((resolve) => {
      const db = new sqlite3.Database(this.dbPath);
      db.all('SELECT value FROM roles', (err, rows) => {
        db.close();
        if (err) return resolve({ records: [], errors: [{ key: '*', error: 'db_error', detail: String(err) }] });
        const records = []; const errors = [];
        for (const row of (rows || [])) {
          const r = deserialize(row.value);
          if (r.ok) records.push(r.value);
          else errors.push({ key: '?', error: 'invalid_metadata', detail: r.detail });
        }
        resolve({ records, errors });
      });
    });
  }

  async create(role) { await this.users.setRoles([role]); }
  async update(role) { await this.users.setRoles([role]); } // INSERT OR REPLACE ⇒ thay toàn bộ value
  async delete(ids) { await this.users.removeRoles(ids.map(id => ({ id }))); } // prune info.roles + xóa role
}

module.exports = { FuxaRoleStoreAdapter };
```

---

## Bước 5 (2.5, 2.6) — Property test P-003 và P-004

Vì adapter cần DB thật, test dùng file sqlite tạm. Tạo
`server/auth-management/adapters/store-roundtrip.test.js`:

```javascript
//@ts-check
'use strict';
const fc = require('fast-check');
const { expect } = require('chai');
const path = require('path');
const os = require('os');
const fs = require('fs');
// Ta test qua chính runtime/users để đi đúng đường thật:
const runtimeUsers = require('../../../runtime/users');   // đường dẫn tương đối tới server/runtime/users
const { FuxaUserStoreAdapter } = require('./fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('./fuxa-role-store.adapter');

// metadata KHÔNG có khóa 'roles' cấp cao nhất (INV-1)
const metadataArb = fc.dictionary(
  fc.string().filter(k => k !== 'roles'),
  fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
  { maxKeys: 5 }
);

describe('Store adapters — round-trip', function () {
  this.timeout(20000);
  let workDir, userStore, roleStore;

  before(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-test-'));
    const fakeSettings = { workDir };
    const fakeLogger = { info(){}, warn(){}, error(){}, debug(){}, trace(){} };
    await runtimeUsers.init(fakeSettings, fakeLogger);
    const usersDbPath = path.join(workDir, 'users.fuxap.db');
    userStore = new FuxaUserStoreAdapter({ runtimeUsers, usersDbPath });
    roleStore = new FuxaRoleStoreAdapter({ runtimeUsers, usersDbPath });
  });

  it('Feature: auth-user-management, Property 3: User_Record write→read round-trip', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        username: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
        fullname: fc.string(),
        passwordHash: fc.string(),
        roles: fc.array(fc.string(), { maxLength: 5 }),
        metadata: metadataArb,
      }),
      async (u) => {
        await userStore.create(u);
        const back = await userStore.get(u.username);
        expect(back.username).to.equal(u.username);
        expect(back.fullname).to.equal(u.fullname);
        expect(new Set(back.roles)).to.deep.equal(new Set(u.roles));
        expect(back.metadata).to.deep.equal(u.metadata);
        await userStore.delete(u.username);
      }
    ), { numRuns: 100 });
  });

  it('Feature: auth-user-management, Property 4: Role write→read round-trip', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        id: fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
        name: fc.string(),
        permissions: fc.array(fc.string(), { maxLength: 5 }),
      }),
      async (r) => {
        await roleStore.create(r);
        const back = await roleStore.get(r.id);
        expect(back.name).to.equal(r.name);
        expect(new Set(back.permissions)).to.deep.equal(new Set(r.permissions));
        await roleStore.delete([r.id]);
      }
    ), { numRuns: 100 });
  });
});
```

> Nếu `runtimeUsers.init` cần thêm gì đó ở máy bạn, đọc lỗi và bổ sung `fakeSettings`. Cốt lõi là
> `settings.workDir` trỏ tới thư mục tạm để tạo `users.fuxap.db` riêng cho test.

---

## Bước 6 (2.7) — Test hồi quy: bẫy băm 2 lần & giữ mật khẩu khi bỏ trống

Tạo `server/auth-management/adapters/fuxa-user-store.regression.test.js`:

```javascript
//@ts-check
'use strict';
const { expect } = require('chai');
const path = require('path'); const os = require('os'); const fs = require('fs');
const bcrypt = require('bcryptjs');
const runtimeUsers = require('../../../runtime/users');
const { FuxaUserStoreAdapter } = require('./fuxa-user-store.adapter');

describe('FuxaUserStoreAdapter — regression', function () {
  this.timeout(20000);
  let userStore;
  before(async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-test-'));
    await runtimeUsers.init({ workDir }, { info(){}, warn(){}, error(){} });
    userStore = new FuxaUserStoreAdapter({ runtimeUsers, usersDbPath: path.join(workDir, 'users.fuxap.db') });
  });

  it('cột password lưu NGUYÊN VĂN (không băm 2 lần)', async () => {
    const hash = bcrypt.hashSync('matkhau-thuc', 10);      // đã băm sẵn ở "tầng service"
    await userStore.create({ username: 'u1', fullname: 'U1', passwordHash: hash, roles: [], metadata: {} });
    const back = await userStore.get('u1');
    // verify plaintext với hash lấy ra phải ĐÚNG — chứng tỏ không bị băm lại
    expect(bcrypt.compareSync('matkhau-thuc', back.passwordHash)).to.equal(true);
  });

  it('update bỏ trống password ⇒ giữ nguyên hash cũ (AC-7.3)', async () => {
    const before = (await userStore.get('u1')).passwordHash;
    await userStore.update('u1', { fullname: 'U1 doi ten' }); // không có passwordHash
    const after = await userStore.get('u1');
    expect(after.passwordHash).to.equal(before);
    expect(after.fullname).to.equal('U1 doi ten');
  });
});
```

Chạy tất cả test của task này:

```powershell
npx mocha "server/auth-management/**/*.test.js" --timeout 20000
```

---

## Cách kiểm chứng — đã xong task khi

- [ ] `serialization.test.js`: P-005 + 2 test chịu lỗi PASS.
- [ ] `store-roundtrip.test.js`: P-003, P-004 PASS (mỗi cái chạy 100 vòng).
- [ ] `fuxa-user-store.regression.test.js`: 2 test PASS (không băm 2 lần; giữ hash khi bỏ trống).

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 2 (2.1–2.7) |
| Requirement | 13.1–13.4, 5.4, 7.3, 8.1, 8.2, 4.2, 6.2, 9.1–9.4, 16.5 |
| Thiết kế | `../design/06-persistence-and-serialization.md` (đặc biệt §5 bẫy băm 2 lần) |
| Property | P-003 (§06), P-004 (§06), P-005 (§06) |
| Quyết định | D-010 (ghi hash nguyên văn), N-009 (vá lỗ hổng getRoles) |

➡️ Xong Task 2 → sang `03-task-3-password-hasher.md` (sẽ tạo tiếp).
