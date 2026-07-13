# Design Section 06 — Persistence & Serialization · `DES-STORE`

> **Section role: DETAILED DESIGN.** This file details the Store layer — the `User_Store`
> and `Role_Store` interfaces, their FUXA adapters (`FuxaUserStoreAdapter` /
> `FuxaRoleStoreAdapter`), and the shared serialization module — that together satisfy the
> User/Role serialization round-trip (REQ-13). Read [`../design.md`](../design.md) (the
> **master map**) first — it owns the layered architecture, the adapter seams, the Error
> Handling status/shape table, the Security Posture, and the module-boundary rules (D-003,
> AC-16.*). This section refines those decisions for REQ-13 only; it does not restate or
> override them.
>
> **Covers:** REQ-13 (User and Role Serialization Round-Trip, AC-13.1 … AC-13.4).
> **Owns properties:** **P-003** (User_Record round-trip), **P-004** (Role round-trip), and
> **P-005** (metadata serialize→deserialize identity) — all three formalized in full in
> [§8](#8-correctness-properties). This section is also the **single owner of the
> double-hash-hazard resolution** referenced (but not resolved) by
> [`04-user-management.md`](./04-user-management.md) §3.3 / §5.2: how the adapter persists an
> already-hashed password verbatim without routing it through FUXA `setUser`'s re-hash path.
> It *references* the `UserView` read shape and the persist-only-hash / hash-exclusion
> invariants owned by [`03-password-security.md`](./03-password-security.md) (AC-4.2) and
> [`04-user-management.md`](./04-user-management.md) (AC-6.2), the `Role` entity owned by
> [`05-rbac-authorization.md`](./05-rbac-authorization.md), and the entity field catalogue in
> [`11-data-models.md`](./11-data-models.md).
>
> **Grounding.** Every FUXA claim below was verified by reading the actual source:
> `server/runtime/users/usrstorage.js` and `server/runtime/users/index.js`. Exact function
> names, SQL statements, and `JSON.parse`/`JSON.stringify` sites are cited inline. Decisions,
> trade-offs, notes, deviations (`D-***` / `TO-***` / `N-***` / `DV-***`) and properties
> (`P-***`) live in [`../decisions/`](../decisions/) and
> [`../decisions/traceability.md`](../decisions/traceability.md).

---

## 1. Purpose & Scope

This section specifies **how user and role records survive the persistence boundary without
loss**, and how a single corrupt stored record is isolated rather than allowed to fail an
entire batch. It is the design of the Store layer named in the master map's *Components and
Interfaces* table — `User_Store` / `Role_Store` (`read` / `write` / `remove`) and their
FUXA adapters — plus the module-owned **serialization module** that both adapters share.

Scope, precisely:

- **AC-13.1 (User_Record round-trip → P-003).** Writing a `User_Record` to the `User_Store`
  and reading it back returns a record whose `username`, `fullname`, `roles`, and `metadata`
  equal the written values.
- **AC-13.2 (Role round-trip → P-004).** Writing a `Role` to the `Role_Store` and reading it
  back returns a role whose `name` and permission **set** equal the written values.
- **AC-13.3 (metadata identity round-trip → P-005).** Serializing a `User_Record`'s metadata
  object to its stored string form and deserializing that form again produces a metadata
  object equal to the original.
- **AC-13.4 (resilient per-record parse).** Attempting to deserialize a stored metadata
  string that is not valid serialized form reports a **descriptive error** and does **not**
  terminate the containing operation for unrelated records.

What this section **delegates** and only references (see [§7.4](#74-collaborators--boundaries)):

- the CRUD flows that *call* the store (create/list/update/delete ordering, duplicate and
  existence checks) → [`04-user-management.md`](./04-user-management.md) (REQ-5…8) and
  [`05-rbac-authorization.md`](./05-rbac-authorization.md) (REQ-9);
- the password-hash *contract* (`hash` / `verify`) and the persist-only-hash invariant
  (AC-4.2) → [`03-password-security.md`](./03-password-security.md) (REQ-4);
- the read-path `UserView` shape that excludes the hash (AC-6.2) →
  [`04-user-management.md`](./04-user-management.md) §4.2;
- the `Role` entity and the role→permission resolution → [`05-rbac-authorization.md`](./05-rbac-authorization.md) (REQ-9, REQ-10);
- the full entity field catalogue → [`11-data-models.md`](./11-data-models.md) (REQ-13).

### 1.1 Where it sits in the layered architecture

Per the master map's four layers (AC-16.1, **D-001**), this section is the **Store layer** —
the lowest module tier, reached only by the Service layer and never by the API layer directly
(AC-16.3):

- **Store interfaces** — `server/auth-management/store/user-store.interface.js` and
  `role-store.interface.js` define the storage-agnostic contracts (`read` / `write` /
  `remove`) that the services depend on. Changing the backing store must not change these
  interfaces (AC-16.5).
- **Serialization module** — `server/auth-management/store/serialization.js` owns the
  metadata/role `serialize` / `deserialize` primitives and the **resilient per-record parse**
  (AC-13.4). It is pure and PBT-testable; it is the single home of P-005.
- **FUXA adapters** — `server/auth-management/adapters/fuxa-user-store.adapter.js` and
  `fuxa-role-store.adapter.js` implement the interfaces over FUXA's `server/runtime/users`
  (**D-002**). They are the **only** components that know FUXA's `{ username, fullname,
  password, groups, info }` row shape, that `info` is a JSON string, that role identifiers
  live in `info.roles`, and that the roles table stores `role.id` in its `name` primary-key
  column (AC-16.5). This is the seam that hides the FUXA shape (the master-map boundary rule).

> **Boundary note (D-003).** The workspace is not a git repo and must absorb future FUXA
> upgrades with minimal `git merge` conflict (**N-001**). This section therefore **does not
> edit** `server/runtime/users/*` in place; all FUXA coupling is concentrated in the two
> module-owned adapters and the serialization module. The single subtle exception — writing
> an already-hashed password verbatim — is resolved **inside the adapter** ([§5](#5-the-double-hash-hazard-resolution-owned-here))
> without modifying FUXA core, precisely to preserve this boundary.

---

## 2. Store Interface Contracts (AC-16.2, AC-16.5)

The master map lists the store capability as `read` / `write` / `remove` over records, hiding
the FUXA `info.roles` shape (AC-16.5). This section fixes the precise, storage-agnostic
signatures. The interfaces name **no** FUXA type; the FUXA row shape appears only in the
adapter ([§3](#3-data-mapping-user_record--fuxa-row)).

### 2.1 `User_Store`

```
interface User_Store {
  // Read
  get(username: string): Promise<User_Record | undefined>   // single lookup; undefined if absent
  readAll(): Promise<ReadAllResult<User_Record>>             // batch read; resilient (AC-13.4)

  // Write
  create(record: User_Record): Promise<void>                // new row; password persisted verbatim
  update(username: string, patch: UserPatch): Promise<void>  // partial update; hash retained if omitted

  // Remove
  delete(username: string): Promise<void>                    // row + permission-cache eviction
}

User_Record = {
  username:     string,          // PK
  fullname:     string,
  passwordHash: string,          // an ALREADY-hashed bcrypt string (never plaintext) — §5
  roles:        string[],        // role ids surfaced from info.roles (D-007)
  metadata:     object,          // the non-role remainder of info (§3.2)
  groups?:      number | number[] // FUXA compat code; preserved but outside the AC-13.1 assertion
}

UserPatch = { fullname?: string, roles?: string[], metadata?: object, passwordHash?: string }
```

`readAll` returns a `ReadAllResult` ([§4.3](#43-resilient-batch-read-ac-134)) rather than a bare
array, so one corrupt row yields a per-record error instead of throwing for the whole batch
(AC-13.4). `get` is the normalized single lookup used by the Service layer's duplicate/existence
checks (§04); it maps to FUXA's `getUsers({username})`.

### 2.2 `Role_Store`

```
interface Role_Store {
  get(id: string): Promise<Role | undefined>                 // lookup by canonical id (roles PK)
  readAll(): Promise<ReadAllResult<Role>>                    // batch read; resilient (AC-13.4)
  create(role: Role): Promise<void>
  update(role: Role): Promise<void>                          // whole-value replace (AC-9.3)
  delete(ids: string[]): Promise<{ removed: string[]; prunedUsers: string[] }>
}

Role = { id: string, name: string, permissions: string[] }  // owned by §05
```

### 2.3 Mapping interface calls to FUXA `runtime.users` (verified)

The adapters delegate to FUXA's exported `runtime/users` functions (`server/runtime/users/index.js`),
except for the one verbatim-hash write ([§5](#5-the-double-hash-hazard-resolution-owned-here)):

| Interface method | FUXA delegate (verified in `runtime/users/index.js`) | Underlying SQL (verified in `usrstorage.js`) |
|------------------|------------------------------------------------------|----------------------------------------------|
| `User_Store.get(username)` | `getUsers({ username })` / `findOne({ username })` | `SELECT username, fullname, password, groups, info FROM users WHERE username = ?` |
| `User_Store.readAll()` | `getUsers()` | `SELECT username, fullname, password, groups, info FROM users` |
| `User_Store.create/update` (**all columns, atomic**) | **adapter-owned single transaction** (§5, D-016) | `INSERT`/`UPDATE … password` verbatim, one `BEGIN…COMMIT` on the adapter's own connection |
| `User_Store.create/update` (**cache refresh only**) | `setUsers({ username, fullname, groups, info })` with `password` omitted | idempotent non-secret re-write (pwd-falsy branch) + `usersMap.set(username,{info,groups})` |
| `User_Store.delete(username)` | `removeUsers(username)` | `DELETE FROM users WHERE username = ?` + `usersMap.delete(username)` |
| `Role_Store.get(id)` | filter of `getRoles()` | `SELECT value FROM roles` |
| `Role_Store.readAll()` | `getRoles()` | `SELECT value FROM roles` |
| `Role_Store.create/update` | `setRoles([role])` | `INSERT OR REPLACE INTO roles (name, value) VALUES(?, ?)` with `[role.id, JSON.stringify(role)]` |
| `Role_Store.delete(ids)` | `removeRoles(roles)` | prune `info.roles` per user, then `DELETE FROM roles WHERE name = ?` |

> **Verified anchor (read shape).** Both `usrstorage.getUsers` and `usrstorage.getRoles` return
> **raw rows** — `getUsers` selects the five columns with `info` still a JSON *string*, and
> `getRoles` selects the `value` column as a JSON *string*. FUXA's `runtime/users/index.js`
> then parses roles (`getRoles` does `JSON.parse(drows[id].value)`) but returns user rows with
> `info` **unparsed**. The adapter therefore owns the `info` parse for users. See
> [§4](#4-serialization-design-ac-133--ac-134).

---

## 3. Data Mapping: `User_Record` ↔ FUXA Row

### 3.1 The FUXA row (verified)

`usrstorage._bind()` creates `users (username TEXT PRIMARY KEY, fullname TEXT, password TEXT,
groups INTEGER, info TEXT)` (verified). A stored user is therefore the row
`{ username, fullname, password, groups, info }`, where **`info` is a JSON string** and role
identifiers live in the parsed `info.roles` array (verified: `usrstorage.removeRoles` does
`JSON.parse(user.info)` and filters `info.roles`).

### 3.2 The split/compose rule (`info` ↔ `roles` + `metadata`)

The adapter is the single owner of the `info` ↔ `{ roles, metadata }` translation (D-007). Let
`info` denote the parsed object.

```
// READ  (row.info: string)  →  User_Record.{ roles, metadata }
parsed   = deserialize(row.info)            // resilient parse (§4); {} when info is null/empty
roles    = Array.isArray(parsed.roles) ? parsed.roles : []
metadata = parsed without its own 'roles' key      // the remainder (shallow key omission)

// WRITE (User_Record.{ roles, metadata })  →  row.info: string
infoObject = Object.assign({}, metadata, { roles })   // 'roles' is authoritative
row.info   = serialize(infoObject)                    // JSON string persisted verbatim
```

**Reserved key `roles`.** The top-level `roles` key of `info` is **reserved** for role storage.
`metadata` is defined as the info object with its `roles` key omitted, and on write `roles` is
re-attached authoritatively (`Object.assign({}, metadata, { roles })`). Consequently a metadata
object must not carry its own top-level `roles` key — if it did, the stored role list would
shadow it. This is a documented invariant of the mapping (and a **generator constraint** for
P-003 / P-005, [§9](#9-testing-notes)). `metadata` may freely contain a `roles` key at any
*nested* depth; only the top level is reserved.

### 3.3 Field-by-field mapping

| `User_Record` field | FUXA row location | Direction & notes |
|---------------------|-------------------|-------------------|
| `username` | `users.username` (PK) | verbatim both ways; normalization (trim) owned by §04 |
| `fullname` | `users.fullname` | verbatim both ways |
| `passwordHash` | `users.password` | **write verbatim via adapter (§5)**; **excluded on read** (mapped to `UserView` without a hash field, AC-6.2 — §04) |
| `roles[]` | `info.roles` (inside JSON string) | split out on read / composed on write (§3.2) |
| `metadata` | `info` minus top-level `roles` | serialized into / parsed out of the `info` JSON string (§4) |
| `groups` | `users.groups` (INTEGER) | preserved verbatim; a compat field, **outside** the AC-13.1 round-trip assertion (§6.1) |

### 3.4 Role mapping (verified)

`usrstorage.setRoles(roles)` runs `INSERT OR REPLACE INTO roles (name, value) VALUES(?, ?)` with
parameters **`[role.id, JSON.stringify(role)]`** (verified) — i.e. the primary-key column named
`name` stores `role.id`, and the **entire** role object (`id`, display `name`, `permissions`) is
serialized into `value`. On read, `runtime/users/index.js` `getRoles` does
`JSON.parse(drows[id].value)` per row (verified), reconstructing the whole role object.

```
// WRITE   Role{ id, name, permissions }  →  roles row
roles.name  = role.id                       // PK column literally named 'name' holds the id
roles.value = serialize(role)               // JSON of the WHOLE object (id + name + permissions)

// READ    roles row  →  Role
role = deserialize(row.value)               // resilient parse (§4); whole object reconstructed
```

The canonical identity/uniqueness key is `role.id` (the PK, per §05 §3.1); the display `name`
and the `permissions` set are carried inside `value` and reconstructed intact on read — this is
exactly the P-004 round-trip.

---

## 4. Serialization Design (AC-13.3 / AC-13.4)

The serialization module (`store/serialization.js`) is the single home of the string↔object
translation and the resilient parse. It is pure (no I/O, no clock, no ambient state), which is
what makes P-005 a clean property.

### 4.1 Primitives

```
serialize(obj: object): string
  // Deterministic JSON encoding of a JSON-safe object.
  // Implementation: JSON.stringify(obj). Throws SerializationError only on a structurally
  // non-encodable input (cyclic reference) — a programming error, guarded before persist.

deserialize(str: string): ParseResult
ParseResult =
  | { ok: true,  value: object }
  | { ok: false, error: 'invalid_metadata', detail: string, raw: string }
  // JSON.parse wrapped so a malformed string yields a DESCRIPTIVE failure result rather than
  // throwing. 'detail' carries the parser message; 'raw' is the offending string (never a
  // secret — info/value rows carry no password). null/empty input deserializes to {} (ok).
```

**Why JSON (verified alignment).** FUXA already persists `info` and role `value` as JSON
strings (`JSON.stringify` in `setUser`'s caller / `setRoles`; `JSON.parse` in `getRoles`,
`removeRoles`, `_loadUsers`). The module reuses JSON so that records written by the module
remain readable by unmodified FUXA code and vice-versa (the AC-16.5 replaceable-store spirit and
the D-003 low-conflict goal). No bespoke encoding is introduced.

### 4.2 What round-trips, and the JSON-safe domain (P-005)

`deserialize(serialize(m))` is a **structural identity** for every metadata object drawn from
the **JSON-safe domain**: strings (including arbitrary Unicode, per JSON's UTF-8/escaping),
finite numbers, booleans, `null`, arrays, and nested plain objects — to arbitrary depth,
including empty objects `{}` and empty arrays `[]`, and Unicode in both keys and values. Within
this domain JSON encoding loses nothing structural: value types, nesting, array order, and key
sets are all preserved. Object **key order** is *not* a structural property (two objects with
the same keys/values in different insertion order are deep-equal), so equality is defined as
**deep structural equality**, not string equality ([§6.3](#63-equality-semantics)).

**Outside the JSON-safe domain (documented non-goals / generator exclusions).** JSON cannot
represent `undefined` (dropped), functions (dropped), `NaN`/`±Infinity` (become `null`), or
`-0` (becomes `0`), and it stringifies `Date` (asymmetric). These are **excluded from the
metadata domain** and from the P-003/P-005 generators ([§9](#9-testing-notes)); a metadata
object is defined to be JSON-safe by construction. This keeps P-005 a true identity rather than
a partial one.

### 4.3 Resilient batch read (AC-13.4)

AC-13.4 requires that a single unparseable stored string produce a **descriptive error** and
**not** terminate the operation for unrelated records. Both adapters implement `readAll` over
the resilient `deserialize`:

```
readAll(): Promise<ReadAllResult<T>>
ReadAllResult<T> = {
  records: T[],                                   // every successfully parsed record
  errors:  { key: string, error: 'invalid_metadata', detail: string }[]  // one per bad row
}

// Per-row loop (never throws for the batch):
for (row of rawRows) {
  const r = deserialize(row.info /* or row.value */)
  if (r.ok) records.push(map(row, r.value))
  else      errors.push({ key: row.username /* or row.name */, detail: r.detail, error: 'invalid_metadata' })
}
```

A caller (List Users / List Roles) receives every healthy record plus a greppable per-record
error list; it logs/audits the errors and returns the healthy set. One corrupt `info`/`value`
never denies the whole listing.

> **Verified precedent + the gap this closes.** FUXA is *already* resilient on two of the three
> read paths: `usrstorage.removeRoles` wraps `JSON.parse(user.info)` in `try/catch` and, on
> failure, logs `usrstorage.remove role skipped invalid user info for <username>` and
> `continue`s to the next user (verified); `runtime/users/index.js` `_loadUsers` likewise wraps
> the per-user `JSON.parse(users[id].info)` in `try/catch` and continues on error (verified).
> **However**, `runtime/users/index.js` `getRoles` does `JSON.parse(drows[id].value)` with **no
> `try/catch`** (verified) — a single corrupt role `value` throws and rejects the *entire*
> `getRoles` batch. The module's `Role_Store.readAll` closes this gap by routing every row
> through the resilient `deserialize`, so a corrupt role is isolated exactly as a corrupt user
> `info` already is. This is the AC-13.4 anchor for roles.

---

## 5. The Double-Hash Hazard Resolution (owned here)

This is the persistence concern that [`04-user-management.md`](./04-user-management.md) §3.3 and
§5.2 flag and explicitly delegate here. This section **owns and resolves it**.

### 5.1 The hazard (verified)

The module hashes passwords in the Service layer (`Password_Hasher.hash`, §03) and hands the
Store layer an **already-hashed** bcrypt string. But FUXA's `usrstorage.setUser(usr, fullname,
pwd, groups, info)` **re-hashes any truthy `pwd`**:

```
// verified — server/runtime/users/usrstorage.js, setUser(...)
if (pwd) {
  const hashedPwd = bcrypt.hashSync(pwd, 10);      // <-- re-hash: bcrypt of whatever it is given
  if (exist) sql = "UPDATE users SET password = ?, info = ?, groups = ?, fullname = ? WHERE username = ?";
  else       sql = "INSERT OR REPLACE INTO users (username, fullname, password, groups, info) VALUES(?, ?, ?, ?, ?)";
} else if (exist) {
  sql = "UPDATE users SET groups = ?, info = ?, fullname = ? WHERE username = ?";   // password NOT set
} else {
  sql = "INSERT OR REPLACE INTO users (username, fullname, groups, info) VALUES(?, ?, ?, ?)"; // no password
}
```

If the adapter passed the module's hash as `pwd`, the stored value would be
`bcrypt(bcrypt(plaintext))`. Then `Password_Hasher.verify(plaintext, storedHash)` (a single
`bcrypt.compare`) would **never** match — breaking sign-in (AC-1.5) and the hashing properties
P-001/P-002. This is the double-hash hazard.

### 5.2 Chosen resolution (D-016, revised 2026-07-13) — one atomic full-row write, then a best-effort cache refresh

> **Supersedes the original two-connection scheme (defect N-010).** The original design split the
> write across FUXA's connection (non-secret columns) and the adapter's connection (password) and
> then claimed §5.4 wrapped both in **one** transaction — which is **impossible across two
> connections**. D-016 (user-approved 2026-07-13, option (a)) replaces it with a single-connection,
> single-transaction full-row write so the **credential-bearing** state is genuinely atomic.

**Verified constraint (why the adapter owns its own connection).** `server/runtime/users/index.js`
exports only `getUsers / setUsers / removeUsers / getRoles / setRoles / removeRoles / findOne /
getUserCache`, and `usrstorage.js` exposes **no raw-SQL or db-handle API** (verified 2026-07-13).
There is therefore **no public path to run a custom `UPDATE … password` inside FUXA's own
connection/transaction**. The adapter MUST own a dedicated `sqlite3` connection to
`users.fuxap.db` (opened once; `PRAGMA journal_mode=WAL` and a `PRAGMA busy_timeout` set so it
coexists with FUXA's own connection) for the write it needs to control.

**Decision.** `FuxaUserStoreAdapter.create/update` performs:

1. **One atomic full-row write (adapter's own connection, one transaction).** `BEGIN` → for a new
   user `INSERT INTO users (username, fullname, password, groups, info) VALUES(?,?,?,?,?)`; for an
   existing user `UPDATE users SET fullname=?, groups=?, info=?, password=? WHERE username=?` — or
   the **same `UPDATE` without the `password` column** when `passwordHash` is omitted (retain-on-omit,
   AC-7.3) → `COMMIT`. The bcrypt hash is bound **verbatim**; because this is the adapter's own SQL
   and never routes through `usrstorage.setUser`, it is **not re-hashed** (the double-hash hazard is
   avoided). All columns are written in the **same transaction**, so a crash leaves either the whole
   prior row or the whole new row — never fresh metadata paired with a stale/NULL password.
2. **Best-effort cache refresh (FUXA public API).** After the COMMIT, the adapter calls
   `runtime.users.setUsers({ username, fullname, groups, info })` **with `password` omitted**. This
   drives `setUser`'s verified **pwd-falsy** branch — an **idempotent** re-write of the non-secret
   columns to the values just committed (the `password` column is not in that SET list, so the
   verbatim hash from step 1 is preserved) — and, crucially, updates the in-memory permission cache
   `usersMap.set(username, { info, groups })` (verified). This is the **only** public FUXA API that
   refreshes `usersMap` for a single user without re-hashing a password.

**Why the ordering is now safe (inverse of the old design).** The credential-bearing persistent
state is complete and consistent after step 1's COMMIT. Step 2 is a **cache refresh only**: it
writes identical non-secret values (idempotent) and updates `usersMap`. If step 2 fails, or the
process crashes between the two steps, the **database row is already correct**; only the in-memory
cache is momentarily stale, which self-heals on the next `_loadUsers` (restart) and does **not**
affect module authorization under **D-015** (the module re-resolves authority from the store via
`User_Store.get()`, not the cache). Contrast the old design, where the *credential* write was the
non-atomic one — the exact failure N-010 describes.

> **Residual concurrency note (multi-process).** Two connections write the same file (FUXA at
> seed/startup, the adapter at module writes); WAL + `busy_timeout` make this safe **within a single
> process**. Cross-process/HA write coordination is out of scope here and is owned by **D-020**
> (atomic invariants / serialized writer) — this section does not claim multi-node atomicity.

### 5.3 Why this option (justification vs. a dedicated IAM datastore)

Two candidate resolutions were weighed under **TO-001 / D-016**: **(a)** the adapter owns the full
users-row write in one transaction on its own connection (chosen), or **(b)** move IAM persistence
to a dedicated datastore with real transactions and unique constraints. Option (a) is chosen for
now because:

- **True atomicity of the credential write.** All five columns — including the verbatim password —
  are committed in a single `BEGIN…COMMIT`, so no crash can persist a half-written credential
  (root fix for N-010). This is the property §5.4 requires and the old two-connection scheme could
  not deliver.
- **It keeps a single credential store (TO-001 / D-002).** No new datastore, no migration of
  existing FUXA users, and no divergence for FUXA endpoints that still read `runtime/users`
  directly.
- **It respects the D-003 boundary.** It edits **no** FUXA core file: the adapter uses its own
  connection against FUXA's existing schema, and `runtime.users.setUsers` is called **only** for
  its cache-update side-effect (via the shipped pwd-falsy path). Future FUXA `runtime/users`
  upgrades still merge cleanly (N-001).
- **The added cost is bounded and testable.** The adapter now owns the write SQL and triggers one
  idempotent cache-refresh call; the cache-coherence behavior is asserted directly by a test (§9).

**Cost / residual accepted (honest).** The adapter must know FUXA's `users` column set (a schema
coupling: if FUXA later adds a NOT-NULL column without a default, the adapter's `INSERT` needs
updating — flagged as a maintenance note). The cache refresh is best-effort; a stale cache after a
step-2 failure is tolerated because it self-heals (`_loadUsers` on restart) and the module reads
authority from the store (D-015). Option (b) remains the **escalation path** if the cache-coherence
replication proves fragile, or if D-019 (refresh-token store) / D-020 (cross-cutting concurrency)
make a dedicated transactional IAM database clearly worthwhile — at which point TO-001 is formally
revisited.

### 5.4 Ordering, atomicity, and read-back

- **Ordering.** Step 1 (the atomic full-row write) precedes step 2 (cache refresh) so the row is
  fully committed before `usersMap` is refreshed. Both steps key on the same normalized `username`.
- **Atomicity (root fix for N-010).** The full-row write — all columns **including** the verbatim
  `password` — SHALL execute within **one transaction on the adapter's single connection**
  (`BEGIN … COMMIT`; on error the adapter rolls back and rejects, surfacing a store error per the
  master-map Error Handling table). This guarantees no crash can persist fresh non-secret columns
  paired with a NULL/stale password. The step-2 `setUsers(password omitted)` cache refresh is
  **outside** this transaction by design: it is idempotent and touches no credential state, so its
  failure cannot corrupt the persisted row (only the in-memory cache, which self-heals). The old
  requirement of "wrap the two writes in one transaction" is **retired** — it was unsatisfiable
  across two connections (N-010); atomicity is now achieved by making the single credential-bearing
  write itself transactional.
- **Concurrency invariants at the DB (D-020, fixes N-016).** The adapter's own transactional
  connection is also the enforcement point for two invariants that a read-then-act service check
  cannot hold under interleaving: **(a) unique create** — `create` uses a **plain `INSERT`** on the
  `username` PRIMARY KEY (never `INSERT OR REPLACE`), so a concurrent duplicate fails with a
  PK-conflict the adapter maps to `duplicate_username` (atomic; §04 §3.2); **(b) last-admin guard**
  — the `User_Service`'s count → guard → delete runs inside a single **`BEGIN IMMEDIATE`**
  transaction (SQLite write-lock), serializing concurrent deletes so the store can never reach zero
  admins (§04 §6.5). Both are quantified by property **P-016** over interleaved histories. (Multi-
  process HA still requires D-016 option (b).)
- **Read-back excludes the hash.** On read, `User_Store` returns the `passwordHash` field to the
  Service layer only where a hash comparison is needed (sign-in, §01); the **`UserView`** the
  User_Service returns to API callers has no hash field at all (AC-6.2, owned by §04 §4.2). The
  P-003 round-trip therefore asserts equality of `username`/`fullname`/`roles`/`metadata`
  **only** — the hash is deliberately outside the read projection ([§6.1](#61-user_record-round-trip-p-003)).

---

## 6. Round-Trip Design

### 6.1 `User_Record` round-trip (P-003)

**What must survive.** Per AC-13.1: `username`, `fullname`, `roles`, and `metadata`. The
write→read path is: compose `info = serialize(Object.assign({}, metadata, { roles }))` →
persist via §5 → read raw row → `parsed = deserialize(row.info)` → surface `roles =
parsed.roles`, `metadata = parsed \ {roles}`, `username`/`fullname` verbatim. Because every hop
is lossless over the JSON-safe domain ([§4.2](#42-what-round-trips-and-the-json-safe-domain-p-005)),
the read-back equals the written values on those four fields.

**Out of scope of the assertion.** `passwordHash` is excluded from the read projection (AC-6.2),
and `groups` is a compat field not named by AC-13.1; both are preserved by the mapping but P-003
does not assert them. This keeps P-003 aligned exactly with AC-13.1's four fields.

### 6.2 `Role` round-trip (P-004)

**What must survive.** Per AC-13.2: `name` and the permission **set**. The whole `Role` object
is JSON-encoded into the roles `value` column and JSON-decoded on read ([§3.4](#34-role-mapping-verified)),
so `id`, `name`, and `permissions` all reconstruct; P-004 asserts `name` equality and permission
**set** equality (see §6.3).

### 6.3 Equality semantics

- **`metadata` (P-003, P-005):** **deep structural equality** over the JSON-safe domain — value
  types, nesting, array order, and key sets all match; object key *insertion order* is not
  significant (deep-equal ignores it). This is `fast-check`/`chai` deep equality, not string
  equality.
- **`roles` (P-003):** treated as a **set** of role ids, per the glossary ("a set of assigned
  roles") — equality is order- and duplicate-insensitive. Note that because JSON preserves array
  order, the stronger element-wise ordered equality also holds in practice; the property asserts
  set equality to match the domain semantics and to avoid over-specifying storage order.
- **`permissions` (P-004):** **set** equality per AC-13.2's wording "permission **set**" —
  order- and duplicate-insensitive.
- **`username` / `fullname` / role `name`:** exact string equality.

### 6.4 Normalization

The store performs **no** lossy normalization on the round-tripped fields: it does not
lower-case, re-order, or coerce metadata values, and it does not trim `fullname`/`metadata`
strings. (`username` trimming is a Service-layer input normalization owned by §04 and is applied
*before* the record reaches the store, so it is idempotent across a round-trip.) Empty `metadata`
serializes to `{}` and reads back as `{}`; absent/null `info` reads back as an empty metadata
object with `roles = []`.

---

## 7. Error Handling & Boundary Rules

### 7.1 Resilient parse (AC-13.4)

A malformed `info`/`value` string never throws out of `readAll`; it becomes a
`{ error: 'invalid_metadata', detail, key }` entry in `ReadAllResult.errors` while every healthy
record is still returned ([§4.3](#43-resilient-batch-read-ac-134)). The `error` identifier is
stable and greppable (master-map Error Handling table) and is what the calling service audits
(REQ-14). This satisfies AC-13.4's "descriptive error … does not terminate the containing
operation for unrelated records."

### 7.2 Other store error conditions

| Situation | Handling |
|-----------|----------|
| Single corrupt `info`/role `value` on read | isolated per-record error; batch continues (AC-13.4) |
| Cyclic / non-encodable object on **write** | `serialize` throws `SerializationError`; the write is rejected before any SQL runs (programming-error guard, surfaced as a store error) |
| `info` column NULL/empty on read | `deserialize` yields `{}` (ok); `roles = []`, `metadata = {}` |
| Missing optional `info` column on legacy row | treated as null/empty (above); `_checkUpdate` in `usrstorage` already back-fills the `info` column on older DBs (verified) |
| Password `UPDATE` fails mid-write | transaction rollback (§5.4); store error returned, no partial row |
| Unknown `username`/role `id` on `get` | resolves to `undefined` (not an error) — matches FUXA `getUsers`→`undefined` (verified); Service layer decides the outcome |

### 7.3 Boundary rules (AC-16.5, D-003)

- The adapters and the serialization module are the **only** components aware of the FUXA row
  shape, that `info` is a JSON string, that `info.roles` holds role ids, and that the roles PK
  column `name` stores `role.id`. Services depend solely on the `User_Store` / `Role_Store`
  interfaces (§2), so a different backing store may replace the adapters without changing any
  service interface (AC-16.5).
- No FUXA core file is edited in place; the only adapter-owned SQL is the parameterized,
  single-column verbatim password `UPDATE` (§5) — a deliberate, minimal, boundary-preserving
  exception (D-003, N-001).

### 7.4 Collaborators & boundaries

| Concern | Owner |
|---------|-------|
| CRUD ordering, duplicate/existence checks, `UserView` shape, hash-exclusion on read (AC-6.2) | [`04-user-management.md`](./04-user-management.md) (REQ-5…8) |
| `Password_Hasher.hash`/`verify` contract, persist-only-hash (AC-4.2), P-001/P-002 | [`03-password-security.md`](./03-password-security.md) (REQ-4) |
| `Role` entity, role→permission resolution, role delete-prune outcome (AC-9.4) | [`05-rbac-authorization.md`](./05-rbac-authorization.md) (REQ-9, REQ-10) |
| Full entity field catalogue | [`11-data-models.md`](./11-data-models.md) (REQ-13) |
| **This section owns:** Store interfaces, FUXA adapters, serialization module, double-hash resolution, **P-003 / P-004 / P-005** | `DES-STORE` (this file) |

---

## 8. Correctness Properties

> *A property is a characteristic or behavior that should hold true across all valid
> executions of a system — a formal statement about what the system should do. Properties are
> the bridge between human-readable specifications and machine-verifiable correctness
> guarantees.*

This section formalizes the three properties this section **owns** (P-003, P-004, P-005),
derived from the prework classification of REQ-13. Each is universally quantified and traces
back to the acceptance criterion it validates. AC-13.4 is deliberately **not** a property — the
prework classifies it as a resilience/error-isolation guarantee best pinned by example and edge
tests ([§9.2](#92-example--edge-tests)); it is covered without a `P-00x` id, with no orphan
criterion.

### Property 3 (P-003): `User_Record` write→read round-trip

*For any* valid `User_Record` `u` — with an arbitrary `username`, an arbitrary `fullname`
(arbitrary Unicode strings), an arbitrary `roles` array of role-id strings, and an arbitrary
JSON-safe `metadata` object (nested objects and arrays, Unicode keys and values, empty objects
and arrays; no reserved top-level `roles` key) — writing `u` to the `User_Store` and then
reading it back yields a `User_Record` whose `username` and `fullname` are exactly equal to
`u`'s, whose `roles` are set-equal to `u.roles`, and whose `metadata` is deep-structurally equal
to `u.metadata`.

**Validates: Requirements 13.1**

### Property 4 (P-004): `Role` write→read round-trip

*For any* valid `Role` `r` — with an arbitrary `id`, an arbitrary `name` (arbitrary Unicode
string), and an arbitrary `permissions` array of permission-id strings (including empty and
duplicate-bearing lists) — writing `r` to the `Role_Store` and then reading it back yields a
`Role` whose `name` is exactly equal to `r.name` and whose `permissions` are set-equal to
`r.permissions`.

**Validates: Requirements 13.2**

### Property 5 (P-005): metadata serialize→deserialize is an identity round-trip

*For any* JSON-safe metadata object `m` (strings including arbitrary Unicode, finite numbers,
booleans, `null`, arrays, and nested plain objects to arbitrary depth, including empty objects
and empty arrays), `deserialize(serialize(m))` succeeds and its value is deep-structurally equal
to `m`.

**Validates: Requirements 13.3**

---

## 9. Testing Notes

Per the master-map Testing Strategy: server-side tests run under FUXA's shipped
`mocha`/`chai`/`sinon`; property-based tests use **`fast-check`** (TypeScript/JS), never a
hand-rolled framework; every property test runs a **minimum of 100 iterations** and carries the
tag `Feature: auth-user-management, Property {n}: {property text}` referencing this section's
property id.

### 9.1 Property-based tests (P-003, P-004, P-005)

**Shared `fast-check` generators.**

- `jsonSafeValue` — recursive arbitrary over the JSON-safe domain: `fc.oneof(fc.string()`
  (Unicode, incl. `fc.unicodeString()` / `fc.fullUnicodeString()`), `fc.double({ noNaN: true,
  noDefaultInfinity: true })` and `fc.integer()`, `fc.boolean()`, `fc.constant(null)`, arrays
  `fc.array(jsonSafeValue)`, and objects `fc.dictionary(fc.fullUnicodeString(), jsonSafeValue)`)
  with a bounded `maxDepth` so nested objects/arrays, Unicode keys/values, and empty `{}` / `[]`
  all occur. **Excludes** `undefined`, functions, `NaN`, `±Infinity`, `-0`, and `Date`
  (documented non-JSON-safe values, [§4.2](#42-what-round-trips-and-the-json-safe-domain-p-005)).
- `metadataArb` = `jsonSafeValue` restricted to an **object root** with the top-level `roles`
  key **omitted** (the reserved-key invariant, [§3.2](#32-the-splitcompose-rule-info--roles--metadata)).
- `rolesArb` = `fc.array(fc.string())` (role-id strings; allow empty and duplicates to exercise
  set semantics).
- `userRecordArb` = `fc.record({ username: fc.fullUnicodeString({ minLength: 1 }), fullname:
  fc.fullUnicodeString(), passwordHash: fc.string(), roles: rolesArb, metadata: metadataArb })`.
- `roleArb` = `fc.record({ id: fc.string({ minLength: 1 }), name: fc.fullUnicodeString(),
  permissions: fc.array(fc.string()) })`.

**P-003 test.** `fc.assert(fc.asyncProperty(userRecordArb, async u => { await store.create(u);
const back = await store.get(u.username); expect(back.username).to.equal(u.username);
expect(back.fullname).to.equal(u.fullname); expect(new Set(back.roles)).to.deep.equal(new
Set(u.roles)); expect(back.metadata).to.deep.equal(u.metadata); }), { numRuns: 100 })`. Run
against the `FuxaUserStoreAdapter` backed by a temp/in-memory SQLite `users.fuxap.db` so the full
serialize → §5 write → SQL read → parse/split path is exercised end-to-end. Tag: `Feature:
auth-user-management, Property 3: User_Record write→read round-trip`.

**P-004 test.** Same shape with `roleArb` against `FuxaRoleStoreAdapter`; assert `name` equal and
`new Set(back.permissions)` deep-equal `new Set(r.permissions)`. Tag references Property 4.

**P-005 test.** `fc.assert(fc.property(metadataArb, m =>
{ const r = deserialize(serialize(m)); expect(r.ok).to.be.true;
expect(r.value).to.deep.equal(m); }), { numRuns: 100 })`. Pure, no I/O. Tag references Property 5.

### 9.2 Example & edge tests (AC-13.4 resilient parse)

A single **example test** pins the resilience guarantee, with edge variants:

- **Batch isolation.** Seed the store with N healthy rows and exactly one row whose `info`
  (resp. role `value`) is a corrupt string (e.g. `'{ not json'`). Call `readAll()`. Assert
  (1) `records` contains all N healthy records mapped correctly, (2) `errors` contains exactly
  one entry `{ key: <corrupt row key>, error: 'invalid_metadata', detail: <non-empty> }`, and
  (3) no exception propagates out of `readAll`.
- **Edge inputs to `deserialize`:** empty string, whitespace-only, truncated JSON
  (`'{"a":'`), a JSON scalar/array root where an object is expected, and a `null`/absent column
  — assert `deserialize` returns a descriptive `{ ok:false, error:'invalid_metadata', detail }`
  (never throws) except `null`/empty which returns `{ ok:true, value:{} }`
  ([§4.1](#41-primitives)).
- **Roles gap regression.** A dedicated test seeds one corrupt role `value` among valid roles
  and asserts `Role_Store.readAll()` still returns the valid roles — the explicit closure of the
  verified `runtime/users/index.js` `getRoles` no-`try/catch` gap
  ([§4.3](#43-resilient-batch-read-ac-134)).

### 9.3 Integration / example tests (mapping & double-hash)

- **Double-hash regression (§5).** Create a user through the Service→Store path with a known
  plaintext `p` hashed once by `Password_Hasher.hash`; read the stored `password` column
  directly and assert `Password_Hasher.verify(p, stored)` is **true** (i.e. the column holds the
  single hash, not `bcrypt(bcrypt(p))`). A second assertion confirms an update that **omits**
  the password leaves the stored hash byte-identical (AC-7.3 retain-on-omit).
- **Reserved-key mapping.** Example verifying that `roles` composed into `info` and split back
  out yields `metadata` without a top-level `roles` key, and that a nested `roles` key inside
  metadata survives untouched ([§3.2](#32-the-splitcompose-rule-info--roles--metadata)).

---

## 10. Per-Section Traceability (AC → behavior → verified FUXA anchor → test)

| AC | Behavior (this section) | Verified FUXA anchor | Test type |
|----|-------------------------|----------------------|-----------|
| **13.1** | `User_Record` write→read preserves `username`/`fullname`/`roles`/`metadata` (§3.2–3.3, §6.1) | `usrstorage.getUsers` `SELECT username, fullname, password, groups, info FROM users`; `info` JSON string; `info.roles` (verified in `removeRoles`) | **Property** P-003 (≥100 iters) |
| **13.2** | `Role` write→read preserves `name` + permission **set** (§3.4, §6.2) | `usrstorage.setRoles` `INSERT OR REPLACE INTO roles (name, value) VALUES([role.id, JSON.stringify(role)])`; `index.js getRoles` `JSON.parse(value)` | **Property** P-004 (≥100 iters) |
| **13.3** | `deserialize(serialize(m))` deep-equals `m` over JSON-safe domain (§4.1–4.2) | JSON used throughout FUXA (`JSON.stringify`/`JSON.parse` in `setRoles`/`getRoles`/`removeRoles`/`_loadUsers`) | **Property** P-005 (≥100 iters) |
| **13.4** | Malformed stored string → descriptive `invalid_metadata` error; batch isolates the bad record (§4.3, §7.1) | resilient precedent: `usrstorage.removeRoles` + `index.js _loadUsers` per-record `try/catch`+`continue`; **gap closed:** `index.js getRoles` `JSON.parse` has no `try/catch` | **Example + edge** (readAll isolation, malformed-string variants, roles-gap regression) |
| (mapping) | `passwordHash` persisted **verbatim** (no re-hash), retained on omit (§5) | `usrstorage.setUser` `bcrypt.hashSync(pwd,10)` on truthy `pwd`; pwd-falsy `UPDATE` omits `password`; `usersMap` holds only `{info,groups}` | **Integration/example** (double-hash regression, retain-on-omit) |
| (boundary) | Adapter is sole owner of FUXA row shape; no core edits except 1-column verbatim `UPDATE` (§7.3) | `runtime/users/index.js` `setUsers` cache update `usersMap.set(username,{info,groups})`; `removeUsers`→`usersMap.delete` | covered by AC-16.5 boundary discipline (master map) |

**Orphan check.** Every REQ-13 criterion (13.1–13.4) maps to a behavior, a verified FUXA anchor,
and a test above; every property owned here (P-003, P-004, P-005) traces to exactly one criterion
(13.1, 13.2, 13.3). AC-13.4 is covered by example/edge tests by design (prework classification).
No orphan criteria, no orphan properties.
