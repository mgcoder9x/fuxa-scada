# Implementation Plan: Authentication & User Management (RBAC)

## Overview

This plan converts the sectioned design (master map `design.md` + `design/01…12`) into
incremental, dependency-ordered coding tasks against the FUXA workspace. It is **bottom-up**:
data models + serialization + store adapters first, then the pure service layer
(Password_Hasher → Token_Service → brute-force/Authentication → RBAC → User_Service), then
Audit_Logger wiring and admin bootstrap, then the API routers + one-line FUXA mount, and finally
the client HTTP clients and the superseding Login / User-Management UI.

Boundary rules honored throughout (per **D-003**): all new server code lives under
`server/auth-management/`, all new client code under `client/src/app/auth-management/`, and FUXA
core is touched **only** through the three thin adapters (`fuxa-jwt`, `fuxa-bcrypt`,
`fuxa-user-store`/`fuxa-role-store`) plus a **single** router-mount line — no in-place edits to
FUXA route handlers or `runtime/users`.

**Languages / tooling** (from the design, not pseudocode): server = JavaScript on FUXA's existing
`mocha`/`chai`/`sinon`; client = Angular/TypeScript on `TestBed`; property-based tests use
`fast-check` (min 100 iterations, tag `Feature: auth-user-management, Property {n}: {text}`).

Property ownership (from `decisions/traceability.md` §C): P-001/P-002 §03, P-003/P-004/P-005 §06,
P-006 §05, P-007/P-008 §02, P-009 §12, P-010 jointly §04+§12, P-011 §05, P-012 §10.

## Tasks

- [x] 1. Module scaffolding, data models, and layer interfaces
  - [x] 1.1 Create the module skeleton, data models, and service/store/audit interfaces
    - Create `server/auth-management/` tree: `api/`, `services/`, `store/`, `adapters/`, `models/`, and an empty `index.js` composition-root placeholder
    - Add data-model modules under `models/`: `user-record.js`, `role.js`, `permission.js`, `audit-event.js` with the field shapes and JSON-safe/reserved-key invariants (INV-1…INV-8) from §11
    - Define capability interfaces (JSDoc contracts) for `User_Store`/`Role_Store` (`get`/`readAll`/`create`/`update`/`delete`, `ReadAllResult`) in `store/user-store.interface.js` and `store/role-store.interface.js`, and the `Audit_Logger` (`record(event)`) and `Password_Hasher`/`Token_Service`/`BruteForceGuard` interface stubs the services will depend on (injection seams, storage hidden)
    - _Requirements: 16.1, 16.2, 16.5, 13.1, 13.2_
  - [-]* 1.2 Write unit tests for data-model validation and reserved-key invariants
    - Assert `metadata` rejects a top-level `roles` key (INV-1), password-hash field never plaintext (INV-3), permission id scheme (INV-7)
    - _Requirements: 13.1, 4.2_

- [ ] 2. Serialization module and FUXA-backed Store layer (§06, §11)
  - [x] 2.1 Implement the shared serialization module with resilient parse
    - Create `store/serialization.js`: `serialize(obj)` (JSON), `deserialize(str) → ParseResult` (`{ok:true,value}` | `{ok:false,error:'invalid_metadata',detail,raw}`), null/empty → `{}` ok; `SerializationError` only on non-encodable write input
    - _Requirements: 13.3, 13.4_
  - [x]* 2.2 Write property test for metadata serialize→deserialize identity
    - **Property 5: Metadata serialization is an identity round-trip**
    - **Validates: Requirements 13.3** — (P-005; owner §06); JSON-safe generator per §06 §4.2 (exclude undefined/function/NaN/±Infinity/-0/Date), deep-equal, min 100 iters
    - _DONE 2026-07-13: `server/test/auth-management/serialization.test.js` — P-005 property @200 iters + serialize/deserialize contract & resilience; 5 passing (mocha + node:assert + fast-check, N-023)_
  - [x] 2.3 Implement `FuxaUserStoreAdapter` over `server/runtime/users`
    - Implement `get`/`readAll`/`create`/`update`/`delete` mapping `User_Record ↔ { username, fullname, password, groups, info }`; own the `info ↔ { roles, metadata }` split/compose (§06 §3.2)
    - Implement the **double-hash-hazard resolution** (§06 §5): write non-secret columns via `setUsers` (password omitted, keeps `usersMap` coherent) and write `passwordHash` **verbatim** via a single parameterized `UPDATE users SET password=? WHERE username=?` inside one transaction; omit → retain existing hash; `delete` relies on `removeUsers` (row + `usersMap.delete`)
    - Route `readAll` through resilient `deserialize` (AC-13.4); exclude the hash from read projections feeding `UserView`
    - _Requirements: 13.1, 5.4, 7.3, 8.1, 8.2, 4.2, 6.2, 16.5_
  - [x] 2.4 Implement `FuxaRoleStoreAdapter` over `server/runtime/users`
    - Map `Role{ id, name, permissions } ↔ roles(name=role.id, value=JSON(role))` (§06 §3.4); `get`/`readAll`/`create`/`update` (whole-value replace); `delete(ids)` delegates to `removeRoles` (prune `info.roles` per user + delete role)
    - Route `readAll` through resilient `deserialize` to close the verified `getRoles` no-try/catch gap (AC-13.4, N-009)
    - _Requirements: 13.2, 9.1, 9.2, 9.3, 9.4, 16.5_
  - [x]* 2.5 Write property test for User_Record write→read round-trip
    - **Property 3: User_Record write→read round-trip**
    - **Validates: Requirements 13.1** — (P-003; owner §06); assert username/fullname/roles(set)/metadata(deep) equal, min 100 iters
    - _DONE 2026-07-13: `store-adapters.test.js` — P-003 @150 iters end-to-end through the own-connection read path (D-024), real temp sqlite; passing_
  - [x]* 2.6 Write property test for Role write→read round-trip
    - **Property 4: Role write→read round-trip**
    - **Validates: Requirements 13.2** — (P-004; owner §06); assert name + permission-set equal, min 100 iters
    - _DONE 2026-07-13: `store-adapters.test.js` — P-004 @150 iters end-to-end; passing_
  - [x]* 2.7 Write unit/regression tests for the store adapters
    - Double-hash regression (stored column verifies plaintext with a single `bcrypt.compare`); retain-on-omit (hash byte-identical after password-less update); resilient `readAll` isolates one corrupt `info`/role `value` (AC-13.4); delete evicts `usersMap`
    - _Requirements: 4.2, 7.3, 13.4, 8.2_
    - _DONE 2026-07-13: `store-adapters.test.js` — double-hash regression + retain-on-omit + resilient readAll (user + role gap) + get fail-closed (N-026) + atomic duplicate reject (user AC-5.2 / role AC-9.5) + wholesale role update + role-delete prune + delete-removes-row; 11 passing total_
  - [x] 2.8 Implement the single-transaction atomic write path (D-016, fixes N-010)
    - Replace the two-connection scheme: the adapter writes ALL columns (non-secret + verbatim password hash) in ONE `BEGIN…COMMIT` transaction on its **own** sqlite connection (still bypassing `setUser` re-hash), then calls `setUsers(password omitted)` as a best-effort idempotent `usersMap` cache refresh outside the transaction; a crash can never leave a row with a stale/NULL password (§06 §5.2/§5.3/§5.4)
    - _Requirements: 13.1, 4.2, 7.3_
    - _DONE 2026-07-13: `store/fuxa-auth-db.js` `transaction()` = `BEGIN IMMEDIATE…COMMIT`; `FuxaUserStoreAdapter.create/update` writes the full row (verbatim hash) in one txn + best-effort `_refreshCache` via `setUsers(pwd-omitted)`; double-hash regression + retain-on-omit tests green_
  - [~] 2.9 Implement atomic create + last-admin concurrency serialization (D-020, fixes N-016)
    - `create` uses a plain `INSERT` so a duplicate username is rejected atomically by the primary-key conflict (no read-then-write TOCTOU, AC-5.2/AC-9.5); the last-admin guard delete runs inside a `BEGIN IMMEDIATE` transaction so two concurrent last-admin deletes cannot both pass the count check (§04 §3.2/§6.5, §06 §5.4)
    - _Requirements: 5.2, 8.5, 9.5, 13.1_
    - _PARTIAL 2026-07-13: the **atomic create** half is DONE — `FuxaUserStoreAdapter.create` / `FuxaRoleStoreAdapter.create` use plain `INSERT` → `DuplicateKeyError` (code `duplicate_key`), tested for both users (AC-5.2) and roles (AC-9.5) with no-mutation assertions. The **last-admin `BEGIN IMMEDIATE` guard** is deferred to Task 9 (`User_Service.delete` is the transaction site); `FuxaAuthDb.transaction()` provides the `BEGIN IMMEDIATE` primitive it will use. P-016 (2.10) tested there._
  - [ ]* 2.10 Write property test for concurrency invariants
    - **Property 16: Under any interleaving, admin count never reaches zero and concurrent same-username creates yield exactly one record**
    - **Validates: D-020, N-016, AC-8.5, AC-5.2** — (P-016; owner §04, mechanism §06); model interleaved create/delete histories; min 100 iters

- [x] 3. Password_Hasher and the bcrypt seam (§03)
  - [x] 3.1 Implement the `BcryptHasherAdapter` (Hash seam)
    - Create `adapters/fuxa-bcrypt.adapter.js`: the sole importer of `bcryptjs`, wrapping `hashSync`/`compareSync`; configurable cost resolved at construction
    - _Requirements: 4.1_
  - [x] 3.2 Implement `Password_Hasher` service
    - Create `services/password-hasher.js`: `hash(plaintext)` (salted, one-way, default cost 12, total over all strings) and `verify(plaintext, hash)` (defensive false on null/malformed, never throws); no `bcryptjs` import here
    - _Requirements: 4.1, 4.2_
    - _DONE 2026-07-13: `services/password-hasher.js` injects the bcrypt Hash-seam adapter (no bcrypt import); defensive `verify`; **malformed-UTF-16 guard (D-025)** — `verify`→false fast / `hash`→throws `invalid_password_encoding`, closing the verified N-027 ~9.6s bcryptjs DoS. Follow-up (D-025): User_Service 9.1 + Authentication_Service 7.1 must also reject malformed UTF-16 at the boundary (defense-in-depth)_
  - [x]* 3.3 Write property test: hash verifies its own plaintext
    - **Property 1: Password hash verifies its own plaintext**
    - **Validates: Requirements 4.3, 4.4** — (P-001; owner §03); two hashes each verify and differ (random-salt witness); generator per §03 §8.1 (ASCII/Unicode/empty/long/near-dup); construct seam at cost 4; min 100 iters
    - _DONE 2026-07-13: `password-hasher.test.js` — P-001 @150 iters (verify own plaintext + two-hashes-differ witness); passing_
  - [x]* 3.4 Write property test: hash rejects a different plaintext
    - **Property 2: Password hash rejects a different plaintext**
    - **Validates: Requirements 4.5** — (P-002; owner §03); `fc.tuple` with `.filter(a!==b)`, bias near-duplicates; min 100 iters
    - _DONE 2026-07-13: `password-hasher.test.js` — P-002 @150 iters over the ≤72-byte WELL-FORMED domain; generator rebuilt rejection-free + code-point-safe (mode-1 drops last code point, not code unit) to avoid fabricating lone surrogates; passing_
  - [x]* 3.5 Write unit/edge tests for the hasher
    - Empty-string hashes/verifies; `verify` returns false (no throw) for null/''/malformed; a cost-10 (FUXA) digest still verifies
    - _Requirements: 4.3, 4.4, 4.5_
    - _DONE 2026-07-13: `password-hasher.test.js` — empty-string base case; defensive verify (null/''/malformed hash + non-string plaintext); **malformed-UTF-16 fast-reject (D-025/N-027 regression guard)**; FUXA cost-10 interop; unconfigured seam = cost 12 (D-008)_

- [ ] 4. Checkpoint — foundation and hashing
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Token_Service and the JWT seam (§02)
  - [x] 5.1 Implement the `TokenAdapter` (Token seam)
    - Create `adapters/fuxa-jwt.adapter.js`: the sole importer of `server/api/jwt-helper.js`; wrap `sign`/`verify`/`verifyAndDecode`, `secretCode`, `tokenExpiresIn`; reuse the existing `fuxa_refresh` cookie helpers
    - _Requirements: 2.2_
  - [ ] 5.2 Implement `Token_Service` (issue / verify / refresh + expiry policy)
    - Create `services/token.service.js`: `issueAccessToken({username,groups,roles})` encoding `{id,groups,roles}` (D-007); `issueRefreshToken`; `verify(token) → VerifyResult` (authenticated iff signature valid AND unexpired, expose id/groups/roles); `refresh(refreshToken) → RefreshOutcome` (rotate both; disabled; rejected)
    - Implement the §4 expiry decision table: configured duration → default finite 1h → dev-only non-expiring (guarded, non-prod, loud); never a silent non-expiry
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3_
  - [ ]* 5.3 Write property test: token authenticated iff signature valid and unexpired
    - **Property 7: A token is authenticated iff its signature is valid and it is unexpired**
    - **Validates: Requirements 2.3, 2.4, 2.5** — (P-007; owner §02); four quadrants + exposed id/roles equal issuance; min 100 iters
  - [ ]* 5.4 Write property test: unconfigured deployments issue finite 1-hour tokens
    - **Property 8: Unconfigured deployments issue finite 1-hour tokens; non-expiry is dev-only**
    - **Validates: Requirements 2.7** — (P-008; owner §02); min 100 iters
  - [ ]* 5.5 Write unit tests for refresh/sign-out and expiry rows
    - Refresh rotation (200 both tokens), all failure paths clear cookie → 401 (incl. missing-cookie hardening), sign-out → 204; configured (2.6) and dev-only (2.8) expiry rows
    - _Requirements: 3.2, 3.3, 3.4, 2.6, 2.8_
  - [ ] 5.6 Harden the JWT profile (D-021, fixes N-017)
    - In `TokenAdapter`/`Token_Service`: pin `algorithms` on verify (block alg-confusion), add and validate `iss`/`aud`/`sub`/`jti`/explicit `typ`, and add a `kid` header for key rotation; stamp `tokenVersion` into the access token so D-015 can revoke it (§02 §3/§5/§7)
    - _Requirements: 2.2, 2.3, 2.4_
  - [ ] 5.7 Implement the stateful Refresh_Token_Store with rotation + reuse detection (D-019, fixes N-015)
    - Server-side `Refresh_Token_Store` (hashed-at-rest, `family`/`jti`/`parent_jti`/`state`); atomic consume-and-rotate; RFC 9700 reuse detection revokes the whole family on replay of a used/revoked token; family revocation on sign-out/password-change/disable + `tokenVersion` check (§02 §6)
    - _Requirements: 3.2, 3.3, 3.4_
  - [ ]* 5.8 Write property test for refresh rotation single-use + family reuse detection
    - **Property 15: Refresh rotation is single-use with family reuse-detection (≤1 active token per family)**
    - **Validates: D-019, N-015, AC-3.2, AC-3.3** — (P-015; owner §02, RFC 9700); model-based; min 100 iters

- [x] 6. Brute-force protection guard (§10)
  - [x] 6.1 Implement the per-username brute-force guard (adaptive throttling + pluggable store, DV-008/N-019)
    - Create `services/brute-force.js`: state machine `{failCount, throttleLevel, lockedUntil}` keyed by submitted username behind a **pluggable `BruteForceStore` seam** (in-memory default; shared-store e.g. Redis with atomic read-modify-write for horizontal scaling, AC-15.6); `checkAllowed`/`recordFailure`/`reset`; **adaptive exponential backoff** (`baseThrottleMs * backoffFactor^k`, optional `maxThrottleMs` cap) instead of a fixed hard lock (AC-15.2); `threshold=0` ⇒ fail-closed (always 429, AC-15.3); **monotonic injected clock** (not `Date.now()`) to resist NTP/clock-drift; lazy eviction of stale entries
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
  - [ ]* 6.2 Write property test for the lockout lifecycle
    - **Property 12: Adaptive-throttle lifecycle matches the reference state machine**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6** — (P-012, refined by DV-008; owner §10); model-based adaptive-backoff reference model, generator domain includes `threshold=0`, multiple usernames (isolation), and the `maxThrottleMs` cap; min 100 iters
  - [ ]* 6.3 Write unit/edge tests for the guard
    - Below-threshold allowed, Nth failure throttles + retryAfterMs, **adaptive backoff grows and is bounded by `maxThrottleMs`** (AC-15.6), threshold-zero blocks two distinct users, success reset (clears throttleLevel), interval-elapse recovery, per-username isolation, eviction shrinks the map, **shared-store impl enforces one global threshold** (no per-node multiplication, AC-15.6)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

- [ ] 7. Authentication_Service — sign-in and sign-out (§01)
  - [ ] 7.1 Implement `Authentication_Service`
    - Create `services/authentication.service.js`: `signIn({username,password})` returning the closed `SignInOutcome` set (success/missing_field/unknown_user/bad_password/rate_limited); normalize input to `findUser(username)` only (D-006, no body passthrough); delegate compare to `Password_Hasher.verify` (AC-1.5, no plaintext compare); issue token via `Token_Service`; brute-force checkpoints (checkAllowed pre-check, recordFailure on fail, reset on success); `signOut(session)` clears refresh cookie; emit audit via injected `Audit_Logger`
    - **Enumeration hardening (DV-006):** `unknown_user` and `bad_password` return an **identical** generic `401 { error:'invalid_credentials' }` (client-facing), and the `unknown_user` path performs a dummy-hash `verify` so timing matches bad-password; the finer outcome is kept only for server-side audit (AC-1.2/AC-1.3)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 15.1, 15.2, 15.4, 3.4_
  - [ ]* 7.2 Write unit tests for sign-in outcomes and delegation
    - success→session; unknown→no token + recordFailure; bad_password→no token + recordFailure; missing_field validated before store/guard; assert single `verify(submitted, storedHash)` call and no direct equality on password; **assert unknown-user and bad-password responses are byte-identical (status+body) and the unknown-user path still calls `verify` (dummy hash) for timing parity (DV-006)**
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ]* 7.3 Write an integration test for the sign-in wiring
    - Seeded user signs in → 200 token that `Token_Service.verify` accepts; wrong password → 401 no token; unknown username → the **same generic 401** (identical status+body) no token (DV-006) (real service→store/hasher/token, no mocks)
    - _Requirements: 1.1, 1.2, 1.3_

- [ ] 8. RBAC — Role_Service and Authorization_Service (§05)
  - [ ] 8.1 Implement `Role_Service`
    - Create `services/role.service.js`: `create`/`list`/`update`/`delete` outcomes; canonical id = `role.id`; duplicate-id rejected without mutation (AC-9.5); update replaces permission set wholesale (AC-9.3); delete prunes ids from every referencing user via the adapter (AC-9.4); emit audit
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [ ] 8.2 Implement `Authorization_Service` and the admin-determination predicate
    - Create `services/authorization.service.js`: `isAllowed(identity, operation) → Decision`; ordered procedure (unauthenticated→401, `mustRotate` bootstrap gate→403 except `account.rotatePassword`, permission-set membership→allow/403), fail-closed default deny; `effective(identity)` = union of role perms + `groupCodeAdmin` (255/-1); single-owner `isAdministrator(subject)` predicate consumed by §04 and §12; pure function (no clock/random)
    - **Live session authority (D-015, fixes N-011):** `Identity` is built from the **live** `User_Record` (roles/groups/existence/`mustRotate` from the store, NOT the token claims), and a `tokenVersion` check denies tokens minted before a logout/password-change/role-change/disable (§05 §4.1); token `roles`/`groups` are compat-only
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 17.2_
  - [ ]* 8.3 Write property test: authorization decisions are deterministic
    - **Property 6: Authorization decisions are deterministic**
    - **Validates: Requirements 10.5** — (P-006; owner §05); same identity+operation, unchanged roles/perms ⇒ same decision; min 100 iters
  - [ ]* 8.4 Write property test: role deletion prunes all references
    - **Property 11: After role deletion, no surviving user references a deleted role id and no deleted role remains**
    - **Validates: Requirements 9.4** — (P-011; owner §05); min 100 iters
  - [ ]* 8.5 Write unit tests for role CRUD and authorization decisions
    - Duplicate-role reject; wholesale permission replace; 401 unauthenticated vs 403 unpermitted; admin-role/group-code (`255`/`-1`) allows user.*/role.*; unknown permission → deny
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 10.1, 10.2, 10.3, 10.4_
  - [ ]* 8.6 Write property test for live session authority + active revocation
    - **Property 13: A deleted/downgraded account, or a token below the account's current `tokenVersion`, is denied on the next protected request; the live account (not token claims) governs the decision**
    - **Validates: D-015, N-011** — (P-013; owner §05); min 100 iters

- [~] 9. User_Service — CRUD (§04)
  - [ ] 9.1 Implement `User_Service`
    - Create `services/user.service.js`: `create` (validate→duplicate check without mutation→hash→persist), `list`/`get` (UserView, no hash, empty≠error), `update` (existence check→validate→hash-or-retain→apply fullname/roles/metadata, no write on failure), `delete` (existence check→**last-admin guard using §05 predicate**→remove+cache evict); emit audit on create/update/delete
    - **Password policy enforcement (D-017/DV-007):** the create/update validation step rejects a password whose UTF-8 length exceeds bcrypt's 72-byte bound (AC-4.6) and enforces the min-length + common-password blocklist policy (AC-4.7) before hashing (§04 §2.3)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.5, 4.6, 4.7_
  - [ ]* 9.2 Write unit tests for CRUD outcomes
    - Create duplicate/missing-field; list excludes hash; get empty for missing; update retain-hash-on-omit and no-mutation-on-failure and missing→error; delete missing→error, cache eviction, and **last-admin refused with no mutation** (AC-8.5); **password >72 UTF-8 bytes rejected (AC-4.6) and min-length/blocklist policy enforced (AC-4.7)**
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.4, 7.3, 7.4, 7.5, 8.3, 8.5, 4.6, 4.7_

- [ ] 10. Checkpoint — service layer complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Audit_Logger and emission wiring (§09)
  - [x] 11.1 Implement `Audit_Logger` and the dedicated append-only `Audit_Sink` (D-023)
    - Create `services/audit-logger.js`: `record(event)` void/total/non-throwing; shape check; emit one `AUDIT `-marked JSON line; caller-supplied ISO `timestamp`; support the richer OPTIONAL secret-free fields (actor/target/sourceIp/device/sessionId/correlationId/changes[])
    - **Dedicated sink (D-023):** default `Audit_Sink` is a module-owned winston `File` transport at `${logDir}/fuxa-audit.log` with its **own** rotation/retention (independent of `fuxa.log`); expose `health()` so a write failure is an **observable health signal** (still non-blocking by default); optional hash-chain/WORM + SIEM implementations behind the same interface; fallback to `runtime/logger` if the dedicated transport can't construct (surfaced via `health()`); no FUXA core edit
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
  - [ ] 11.2 Wire emission points into the services
    - Have Authentication (all sign-in outcomes), User (create/update/delete), Role (create/update/delete), and Authorization (denials) build sanitized `Audit_Event`s from safe scalars and call `record(...)` fire-and-forget after the outcome is decided (no secret in subject/detail)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
  - [~]* 11.3 Write unit tests for recording and secret exclusion
    - Per-category record with required fields + timestamp; denial records identity/op/reason (guest for unauthenticated); logger injects nothing (5a); plaintext and hash never appear in the captured line (5b); failing sink does not change the caller's outcome
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
  - [~]* 11.4 Write tests for the dedicated sink and health signal (D-023)
    - Audit lines land in `fuxa-audit.log` and NOT `fuxa.log` (separation + independent rotation); a failing `write` flips `health().ok=false` with `lastError` while the domain outcome is unchanged; richer fields round-trip and stay secret-free (incl. `changes[].from/to`); optional hash-chain links lines and detects tampering; startup transport-failure falls back and reports degraded `health()`
    - _Requirements: 14.1, 14.5_

- [ ] 12. Administrator bootstrap, rotation, and migration (§12)
  - [ ] 12.1 Implement the startup bootstrap routine
    - Create `services/bootstrap.js` `runBootstrap(deps)`: content-based empty-admin check via `isAdministrator` (§05); when none, seed **exactly one** admin with a CSPRNG one-time secret (never `'123456'`, cost 12), `groups=-1`, `metadata.mustRotate=true`, hash written verbatim via the adapter; emit `bootstrap.seed` audit (AC-17.5); idempotent + retain-existing on non-empty (AC-17.4)
    - _Requirements: 17.1, 17.4, 17.5_
  - [ ] 12.7 Implement the secure enrollment channel for the seed/rotated secret (D-022, fixes N-018)
    - The initial/rotated secret is delivered via a dedicated secure channel and is **never** written to `fuxa.log`/`runtime.logger`/console: (default) an interactive first-run CLI enrollment collaborator that sets the initial secret at a controlled console; (automated provisioning) a one-time enrollment token — short TTL, hashed-at-rest, single-use (invalidated on redemption or expiry) — surfaced once to an operator-only channel and redeemed to set the real secret (§12 §3.2)
    - _Requirements: 17.1_
  - [ ] 12.2 Implement the `account.rotatePassword` operation (the gate exception)
    - Create `services/account.service.js` `rotatePassword(identity, req)`: verify current secret via `Password_Hasher`, reject reuse/weak new secret, re-hash + persist verbatim, then clear `metadata.mustRotate=false` (AC-17.3); audited as `user.update`; the sole operation permitted while gated
    - _Requirements: 17.2, 17.3_
  - [ ] 12.3 Implement mandatory migration remediation of a known-default admin
    - In the retain-existing branch, `remediateKnownDefaultAdmins`: for each admin lacking a rotation marker whose stored hash verifies `'123456'`, set `metadata.mustRotate=true` (and re-hash to a fresh one-time secret) via `User_Store.update`; create no new admin (D-013(1), mandatory)
    - _Requirements: 17.2, 17.4_
  - [ ]* 12.4 Write property test: a seeded admin cannot act before rotation
    - **Property 9: A seeded admin cannot act before password rotation**
    - **Validates: Requirements 17.2, 17.3** — (P-009; owner §12); every protected op denied pre-rotation (even held admin perms), allowed after; min 100 iters
  - [~]* 12.5 Write property test: at least one administrator always remains
    - **Property 10: For any sequence of deletions on a store starting with ≥1 admin, ≥1 admin always remains**
    - **Validates: Requirements 8.5, 17.1** — (P-010; jointly owned §04 + §12); drive `User_Service.delete` sequences against the last-admin guard; min 100 iters
  - [~]* 12.6 Write unit/integration tests for bootstrap and migration
    - Seed-once + idempotent restart (AC-17.1/17.4); `bootstrap.seed` audited (AC-17.5); seeded/legacy `'123456'` yields no usable authority pre-rotation and the module seed never verifies `'123456'`; migration flips `mustRotate` on a detected known-default admin; **no code path writes the seed/rotated plaintext (or a redeemable token) to `runtime.logger`/console; the enrollment token is single-use + TTL-bounded (D-022, §12 §10.4)**
    - _Requirements: 17.1, 17.4, 17.5, 17.2_

- [ ] 13. API layer — routers, authorization middleware, and mount
  - [ ] 13.1 Implement the authorization middleware seam
    - Create `api/authorization.middleware.js`: verify token (identity/session reference only) then build `Identity` from the **live `User_Record`** (roles/groups/existence/`mustRotate` from the store, D-015) and check `tokenVersion` for active revocation; call `Authorization_Service.isAllowed`, short-circuit 401/403, never touch the store directly beyond the identity read; fail fast if the service is unavailable
    - _Requirements: 10.2, 10.3, 16.3, 16.4_
  - [ ] 13.2 Implement the authentication router
    - Create `api/authentication.router.js`: `POST /api/signin` (up-front field-presence 400, outcome→HTTP per §01 §4), `POST /api/refresh`, `POST /api/signout` (204); delegate to services only
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.2, 3.3, 3.4, 16.3_
  - [~] 13.3 Implement the users router (CRUD backend for REQ-12)
    - Create `api/users.router.js`: guarded CRUD endpoints requiring `user.create`/`user.read`/`user.update`/`user.delete`; outcome→HTTP per §04 §8.2 (incl. `duplicate_username`, `last_admin`, `user_not_found`)
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 7.1, 7.4, 8.1, 8.3, 8.5, 16.3_
  - [ ] 13.4 Implement the roles router
    - Create `api/roles.router.js`: guarded role endpoints requiring `role.*`; outcome→HTTP per §05
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 16.3_
  - [ ] 13.5 Implement the composition root and the SUPERSEDE cutover (D-014, fixes N-014)
    - Create `server/auth-management/index.js`: instantiate adapters → services (inject Password_Hasher, Token_Service, brute-force, Audit_Logger, Refresh_Token_Store, stores), run `runBootstrap` at startup, and export the mounted router; in the FUXA API bootstrap, **stop mounting** FUXA's `usersApi`/`authApi` for the overlapping paths (`/api/signin`, `/api/refresh`, `/api/signout`, `/api/users`, `/api/roles`) and mount the module router (after `authLimiter`) so the module is the **sole** authority for those URLs — not shadowed by a residual FUXA handler; keep the touch within the D-003 wiring boundary; client cutover (D-011) lands together
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 17.1_
  - [ ] 13.7 Implement the account-rotation router (D-018, fixes N-013)
    - Create `api/account.router.js` exposing `POST /api/account/rotate-password`, wired in the composition root (instantiating `Account_Service`, task 12.2); it is the sole operation reachable while `mustRotate` is true, so a seeded/migrated admin can become usable; on success bump `tokenVersion` (D-015)
    - _Requirements: 17.2, 17.3, 16.3_
  - [ ]* 13.6 Write API integration tests
    - End-to-end auth + CRUD + role endpoints incl. 401/403 gate, `last_admin`, and fail-fast (AC-16.4) when a service is unavailable
    - _Requirements: 16.3, 16.4, 10.2, 10.3, 8.5_
  - [ ]* 13.8 Write property/integration test for the SUPERSEDE cutover and bootstrap gate reachability
    - **Property 14: Every superseded identity URL is served by the module (its RBAC/authn decision applied), never a residual FUXA handler; a `mustRotate` identity can reach `POST /api/account/rotate-password` but no other protected operation**
    - **Validates: D-014, D-018, N-013, N-014** — (P-014; owner composition/API layer); e.g. `/api/users` without the module permission returns 403 from the module; min 100 iters where model-applicable + integration assertions

- [ ] 14. Checkpoint — server module complete and mounted
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Client session plumbing reuse and HTTP clients (§07, §08)
  - [x] 15.1 Reuse and extend the client session plumbing
    - Under `client/src/app/auth-management/`, reuse (unchanged) the `sessionStorage`/`window.fuxaAccessToken` token store, the `x-access-token` `AuthInterceptor`, and `AuthGuard`; add a `user.read` permission-aware check for the management route (D-011); adapt storage to the first-class `roles` field (D-007), not `info.roles`
    - _Requirements: 11.3, 12.6_
  - [ ] 15.2 Implement `AuthSignInClient`
    - Create the module-owned Angular service issuing `POST /api/signin` via `EndPointApi.getURL()`, resolving `{ token, username, fullname, roles }`, normalizing errors to stable ids (`invalid_credentials`/`too_many_attempts`/`missing_field`/`unexpected_error` — note: unknown-user is folded into `invalid_credentials`, no `user_not_found` at sign-in per DV-006); uses `Skip-Error` so 401 does not trigger global sign-out
    - _Requirements: 11.2, 11.4_
  - [ ] 15.3 Implement `UserAdminClient` and `RoleAdminClient`
    - Create module-owned Angular services for `GET/POST/PUT/DELETE /api/users` and `GET /api/roles`, mapping `UserView[]`/`RoleOption[]` and normalizing errors (`duplicate_username`/`validation_error`/`user_not_found`/`last_admin`/`forbidden`/`unauthorized_error`); consume first-class `roles`, never parse `info`
    - _Requirements: 12.1, 12.2, 12.3, 12.5_
  - [ ]* 15.4 Write unit tests for the client HTTP services
    - `HttpClientTestingModule` request shape + success mapping + error-id normalization for sign-in and user/role clients
    - _Requirements: 11.2, 11.4, 12.2, 12.3_

- [ ] 16. Login_Page UI — supersede (§07)
  - [ ] 16.1 Implement the routed `Login_Page` component
    - Create the module-owned routed component under `auth-management/login/`: reactive `FormGroup` (username/password required, trimmed), `pending` flag gating the submit control (disable-on-submit, no double submit), `role="alert"` error region with generic (enumeration-safe) messages, `autocomplete=username/current-password`, no plaintext logging; on success store the token via the reused session store and `Router`-navigate to the authenticated area
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [ ]* 16.2 Write component tests for the Login Page
    - AC-11.1 controls present; AC-11.2 submit sends once when both populated (and not when empty); AC-11.3 stores token + navigates; AC-11.4 each error id keeps user on page with a message; AC-11.5 submit disabled while pending
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 17. User_Management_Page UI — supersede (§08)
  - [ ] 17.1 Implement the page container, list view, and access gate
    - Create `auth-management/user-management/` routed `UserManagementPage` + `UserListView`: load users + roles, resolve role ids→names, render username/fullname/roles columns; `access` gate (`checking`/`granted`/`denied`) via the reused guard + `user.read` check (AC-12.6, defense-in-depth — server remains the boundary)
    - _Requirements: 12.1, 12.6_
  - [ ] 17.2 Implement the create and edit forms
    - `UserCreateForm` (username required+unique, password required, roles multi-select from role options) and `UserEditForm` (username immutable, password optional→omit retains hash, role assignment); client-side validation blocks send on invalid input (AC-12.4); on success refresh the list (AC-12.2/12.3); `pending`-gated submit
    - _Requirements: 12.2, 12.3, 12.4_
  - [ ] 17.3 Implement the delete confirmation and wiring
    - `DeleteUserConfirmDialog` gates the destructive action; on confirm call `remove` and drop the row on success (AC-12.5); handle `last_admin` (keep row, specific message) and `user_not_found` (refresh) outcomes
    - _Requirements: 12.5_
  - [ ] 17.4 Wire the routes and perform the SUPERSEDE cutover
    - Register the module routes and point `AuthGuard` at the new routed pages; retire/deprecate the FUXA `app/login` dialog and `app/users` route usage without editing them in place (D-011 cutover)
    - _Requirements: 11.3, 12.1_
  - [ ]* 17.5 Write component/example tests for the User Management Page
    - AC-12.1 list renders; AC-12.2 valid create sends + refresh; AC-12.3 valid edit sends + refresh; AC-12.4 invalid inputs blocked; AC-12.5 confirmed delete removes row; AC-12.6 non-admin denied with authorization error
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [ ] 18. Final checkpoint — full stack verified
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation sub-tasks are never optional.
- Each task references specific requirement/AC clauses (and, for PBT tasks, the property id P-00x) for traceability against `decisions/traceability.md`.
- All 16 confirmed properties have a dedicated fast-check task (min 100 iterations, tagged): P-001 (3.3), P-002 (3.4), P-003 (2.5), P-004 (2.6), P-005 (2.2), P-006 (8.3), P-007 (5.3), P-008 (5.4), P-009 (12.4), P-010 (12.5), P-011 (8.4), P-012 (6.2), P-013 (8.6), P-014 (13.8), P-015 (5.8), P-016 (2.10). P-013…P-016 were added by the 2026-07-13 deep review (D-015/D-014+D-018/D-019/D-020).
- Deep-review resolution tasks added 2026-07-13 (close G3/G4): 2.8 (D-016 atomic write), 2.9/2.10 (D-020 concurrency + P-016), 5.6 (D-021 JWT hardening), 5.7/5.8 (D-019 refresh store + P-015), 6.1/6.2/6.3 refined (DV-008 adaptive throttling + N-019 shared store), 7.1/7.2 refined (DV-006 uniform 401), 8.2/8.6 (D-015 live authority + P-013), 9.1/9.2 refined (D-017 AC-4.6/4.7 policy), 11.1/11.4 (D-023 dedicated audit sink), 12.1/12.7 (D-022 enrollment channel), 13.1 (D-015 middleware), 13.5 (D-014 SUPERSEDE), 13.7/13.8 (D-018 rotate router + P-014).
- Per D-013(3), there is intentionally **no** self-deletion-ban task; AC-8.5 (last-admin guard) is the only deletion invariant.
- FUXA core is edited only via the three adapters (2.3/2.4, 3.1, 5.1) and the single router-mount line (13.5); the migration remediation (12.3) is mandatory per D-013(1).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "5.1", "6.1", "11.1", "15.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.2", "5.2", "6.2", "6.3", "15.2", "15.3"] },
    { "id": 3, "tasks": ["2.5", "2.6", "2.7", "2.8", "2.9", "3.3", "3.4", "3.5", "5.3", "5.4", "5.5", "5.6", "5.7", "8.1", "8.2", "15.4"] },
    { "id": 4, "tasks": ["5.8", "7.1", "8.3", "8.4", "8.5", "9.1", "13.1"] },
    { "id": 5, "tasks": ["2.10", "7.2", "7.3", "8.6", "9.2", "12.1", "12.2", "13.2", "13.4"] },
    { "id": 6, "tasks": ["11.2", "12.3", "12.4", "12.5", "12.7", "13.3", "13.7"] },
    { "id": 7, "tasks": ["11.3", "11.4", "12.6", "13.5", "16.1", "17.1"] },
    { "id": 8, "tasks": ["13.6", "13.8", "16.2", "17.2", "17.3"] },
    { "id": 9, "tasks": ["17.4"] },
    { "id": 10, "tasks": ["17.5"] }
  ]
}
```
