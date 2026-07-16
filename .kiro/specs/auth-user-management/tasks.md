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
  - [ ]* 1.2 Write unit tests for data-model validation and reserved-key invariants
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
  - [x] 2.9 Implement atomic create + last-admin concurrency serialization (D-020, fixes N-016)
    - `create` uses a plain `INSERT` so a duplicate username is rejected atomically by the primary-key conflict (no read-then-write TOCTOU, AC-5.2/AC-9.5); the last-admin guard delete runs inside a `BEGIN IMMEDIATE` transaction so two concurrent last-admin deletes cannot both pass the count check (§04 §3.2/§6.5, §06 §5.4)
    - _Requirements: 5.2, 8.5, 9.5, 13.1_
    - _DONE: (create half) 2026-07-13 — `FuxaUserStoreAdapter.create` / `FuxaRoleStoreAdapter.create` use plain `INSERT` → `DuplicateKeyError` (`duplicate_key`), tested for users (AC-5.2) + roles (AC-9.5) with no-mutation assertions. **(last-admin guard half) 2026-07-14 (N-037/D-033)** — realized as the ATOMIC `FuxaUserStoreAdapter.deleteGuarded(username, isAdministratorFn)` (one `BEGIN IMMEDIATE` txn on the adapter's connection; the §05 predicate injected by `User_Service`; DEF-U1 reconciliation of "who runs the txn"). Verified in `user.service.test.js` (P-016 @100 + last-admin single/non-last)._
  - [x]* 2.10 Write property test for concurrency invariants
    - **Property 16: Under any interleaving, admin count never reaches zero and concurrent same-username creates yield exactly one record**
    - **Validates: D-020, N-016, AC-8.5, AC-5.2** — (P-016; owner §04, mechanism §06); model interleaved create/delete histories; min 100 iters
    - _DONE 2026-07-14 (N-037): `user.service.test.js` **Property 16 @100** — concurrent `delete` of ALL administrators serializes through `deleteGuarded`'s `BEGIN IMMEDIATE` critical section → exactly one `last_admin` refusal, the rest deleted, `adminCount()` always ≥1 (never zero). The concurrent-same-username-create half is covered by the atomic plain-INSERT (`store-adapters.test.js` duplicate-reject) + `user.service.test.js` atomic-`duplicate_key` mapping._

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

- [x] 4. Checkpoint — foundation and hashing
  - Full auth-management suite re-run from `server/` on 2026-07-14 with the required command: `node .\node_modules\mocha\bin\mocha.js "test/auth-management/**/*.test.js" --timeout 40000 --reporter dot`.
  - _DONE: exit code **0**; **42 passing (3s)**. This validates the current foundation baseline only; it does not start or complete Task 5._

- [x] 5. Token_Service and the JWT seam (§02)
  <!-- DONE 2026-07-14: §02 SERVICE LAYER complete (REQ-2 + REQ-3) — 5.1..5.8 all done, verified with real crypto (P-007/P-008/P-015). The API-layer wiring (router mount, cookie I/O, HTTP 401/204 status mapping, `disabled` short-circuit, sign-out endpoint, and calling revokeRefreshFamily on sign-out/password-change) is owned by Task 13. Full auth-management suite: 71 passing, stable. -->
  - [x] 5.1 Implement the `TokenAdapter` (Token seam)
    - Create `adapters/fuxa-jwt.adapter.js`: the sole importer of `server/api/jwt-helper.js`; wrap `sign`/`verify`/`verifyAndDecode`, `secretCode`, `tokenExpiresIn`; reuse the existing `fuxa_refresh` cookie helpers
    - _Requirements: 2.2_
  - [ ] 5.2 Implement `Token_Service` (issue / verify / refresh + expiry policy)
    - Create `services/token.service.js`: `issueAccessToken({username,groups,roles,tokenVersion})` encoding `{id,groups,roles,tokenVersion}` (D-007; `tokenVersion` per **D-027**, default 0); `issueRefreshToken`; `verify(token) → VerifyResult` (authenticated iff signature valid AND unexpired, expose id/groups/roles/tokenVersion); `refresh(refreshToken) → RefreshOutcome` (rotate both; disabled; rejected)
    - Implement the §4 expiry decision table: configured duration → default finite 1h → dev-only non-expiring (guarded, non-prod, loud); never a silent non-expiry
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3_
    - _DONE 2026-07-14: `services/token.service.js` — `issueAccessToken` (hardened claim set), `issueRefreshToken`, `verify`, the §4 expiry decision table (REQ-2, N-031), AND `refresh()` (stateful rotation via the Refresh_Token_Store + User_Store live-account/`tokenVersion` check, N-033) + `revokeRefreshFamily`. All tested with real crypto. `refresh()` returns a closed `RefreshOutcome`; the HTTP/cookie/disabled wiring is the API layer (Task 13)._
  - [x]* 5.3 Write property test: token authenticated iff signature valid and unexpired
    - **Property 7: A token is authenticated iff its signature is valid and it is unexpired**
    - **Validates: Requirements 2.3, 2.4, 2.5** — (P-007; owner §02); four quadrants + exposed id/roles equal issuance; min 100 iters
    - _DONE 2026-07-14: `token-service.test.js` Property 7 @200 iters, REAL HS256 — 4 quadrants (tamper × wrong-secret × past/future exp) + id/roles/tokenVersion exposure = issuance. Closes the N-022 real-crypto access-path gap._
  - [x]* 5.4 Write property test: unconfigured deployments issue finite 1-hour tokens
    - **Property 8: Unconfigured deployments issue finite 1-hour tokens; non-expiry is dev-only**
    - **Validates: Requirements 2.7** — (P-008; owner §02); min 100 iters
    - _DONE 2026-07-14: `token-service.test.js` Property 8 @200 iters — Row 1 exact configured TTL, Row 2 finite 3600s default, Row 3 dev-only no-exp; safety: flag-off ⇒ never missing exp, production ignores the dev flag._
  - [x]* 5.5 Write unit tests for refresh/sign-out and expiry rows
    - Refresh rotation (200 both tokens), all failure paths clear cookie → 401 (incl. missing-cookie hardening), sign-out → 204; configured (2.6) and dev-only (2.8) expiry rows
    - _Requirements: 3.2, 3.3, 3.4, 2.6, 2.8_
    - _DONE 2026-07-14 (service level): expiry rows (2.6/2.8) + verify reason-mapping + hardened-claim + alg:none + iss/aud units in `token-service.test.js` (10 passing); refresh-rotation outcome + all failure branches (missing/expired/invalid/wrong_type/unknown_user/revoked/reuse_detected) in `refresh-token-store.test.js` (14 passing). The COOKIE clear + HTTP 401/204 status mapping and the sign-out endpoint are the API layer's responsibility and are tested there (Task 13, §6.3)._
  - [x] 5.6 Harden the JWT profile (D-021, fixes N-017; reconciled by D-027/D-028/D-029/TO-012)
    - In `TokenAdapter`/`Token_Service`: pin `algorithms` on verify (block alg-confusion); add `sub`/`jti`; add and validate `iss`/`aud` **only when configured** via `settings.auth.jwtIssuer`/`jwtAudience` (**D-029** — unset ⇒ neither issued nor validated); use the **single `type` claim** (`access`/`refresh`), **NOT** a separate `typ` (**D-028**); emit a `kid` naming the **single active key** — multi-key overlap rotation is a documented follow-up, do NOT implement a keyring (**TO-012**, Option A); stamp `tokenVersion` (from the live account, default 0) into the access token so D-015/**D-027** can revoke it (§02 §3/§5/§7)
    - _Requirements: 2.2, 2.3, 2.4_
    - _DONE 2026-07-14: implemented in `services/token.service.js` (baked into issue/verify from the start). `token-service.test.js` proves: alg:none rejected (pinning), single `type` claim + no `typ`, `sub`/`jti`/`tokenVersion` present, `iss`/`aud` issued+validated only when configured (unconfigured deployment does not self-reject), `kid` header emitted when configured. Multi-key rotation NOT implemented (TO-012 Option A follow-up)._
  - [x] 5.7 Implement the stateful Refresh_Token_Store with rotation + reuse detection (D-019, fixes N-015)
    - Server-side `Refresh_Token_Store` (hashed-at-rest, `family`/`jti`/`parent_jti`/`state`); atomic consume-and-rotate; RFC 9700 reuse detection revokes the whole family on replay of a used/revoked token; family revocation on sign-out/password-change/disable + `tokenVersion` check (§02 §6)
    - _Requirements: 3.2, 3.3, 3.4_
    - _DONE 2026-07-14 (N-033/D-030): `store/refresh-token-store.js` — `auth_refresh_tokens` table on the module-owned connection; SHA-256 at-rest + `timingSafeEqual`; CAS single-use consume (`UPDATE … WHERE state='active'`, changes===1) in `BEGIN IMMEDIATE`; `revokeFamily`; `consumeAndRotate`. Wired into `TokenService.refresh` (verify → lookup+hash → reuse-detect → live-account/tokenVersion → consume-and-rotate). Root-fixed a concurrent-transaction crash in `FuxaAuthDb` (N-032). Family revoke on sign-out via `revokeRefreshFamily` (HTTP wiring Task 13)._
  - [x]* 5.8 Write property test for refresh rotation single-use + family reuse detection
    - **Property 15: Refresh rotation is single-use with family reuse-detection (≤1 active token per family)**
    - **Validates: D-019, N-015, AC-3.2, AC-3.3** — (P-015; owner §02, RFC 9700); model-based; min 100 iters
    - _DONE 2026-07-14: `refresh-token-store.test.js` Property 15 @120 iters, model-based over a REAL sqlite store + real crypto — ≤1 active per family invariant, single-use rotation, reuse revokes the whole family, no rotate succeeds after poison._

- [x] 6. Brute-force protection guard (§10)
  - [x] 6.1 Implement the per-username brute-force guard (adaptive throttling + pluggable store, DV-008/N-019)
    - Create `services/brute-force.js`: state machine `{failCount, throttleLevel, lockedUntil}` keyed by submitted username behind a **pluggable `BruteForceStore` seam** (in-memory default; shared-store e.g. Redis with atomic read-modify-write for horizontal scaling, AC-15.6); `checkAllowed`/`recordFailure`/`reset`; **adaptive exponential backoff** (`baseThrottleMs * backoffFactor^k`, optional `maxThrottleMs` cap) instead of a fixed hard lock (AC-15.2); `threshold=0` ⇒ fail-closed (always 429, AC-15.3); **monotonic injected clock** (not `Date.now()`) to resist NTP/clock-drift; lazy eviction of stale entries
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
  - [x]* 6.2 Write property test for the lockout lifecycle
    - **Property 12: Adaptive-throttle lifecycle matches the reference state machine**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6** — (P-012, refined by DV-008; owner §10); model-based adaptive-backoff reference model, generator domain includes `threshold=0`, multiple usernames (isolation), and the `maxThrottleMs` cap; min 100 iters
    - _DONE 2026-07-13: `server/test/auth-management/brute-force.test.js` — P-012 model-based lifecycle @200 iters; fresh full-suite re-validation recorded at Task 4/N-028._
  - [x]* 6.3 Write unit/edge tests for the guard
    - Below-threshold allowed, Nth failure throttles + retryAfterMs, **adaptive backoff grows and is bounded by `maxThrottleMs`** (AC-15.6), threshold-zero blocks two distinct users, success reset (clears throttleLevel), interval-elapse recovery, per-username isolation, eviction shrinks the map, **shared-store impl enforces one global threshold** (no per-node multiplication, AC-15.6)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
    - _DONE 2026-07-13: same `brute-force.test.js` covers adaptive backoff/cap, threshold-zero, reset, elapsed interval, username isolation, shared-store seam behavior, and eviction; included in the fresh Task 4 baseline._

- [ ] 7. Authentication_Service — sign-in and sign-out (§01)
  <!-- 2026-07-14 (N-035): SIGN-IN decision done + tested (7.1 core, 7.2). §01 reconciled to D-027 (tokenVersion in the issued identity) + canonical `get` lookup (DEF-A1/A2). REMAINING: signOut (refresh-cookie clear/204 + TokenService.revokeRefreshFamily) is router-level (Task 13); 7.3 real-router integration is Task 13. -->
  - [x] 7.1 Implement `Authentication_Service`
    - Create `services/authentication.service.js`: `signIn({username,password})` returning the closed `SignInOutcome` set (success/missing_field/unknown_user/bad_password/rate_limited); normalize input to `findUser(username)` only (D-006, no body passthrough); delegate compare to `Password_Hasher.verify` (AC-1.5, no plaintext compare); issue token via `Token_Service`; brute-force checkpoints (checkAllowed pre-check, recordFailure on fail, reset on success); `signOut(session)` clears refresh cookie; emit audit via injected `Audit_Logger`
    - **Enumeration hardening (DV-006):** `unknown_user` and `bad_password` return an **identical** generic `401 { error:'invalid_credentials' }` (client-facing), and the `unknown_user` path performs a dummy-hash `verify` so timing matches bad-password; the finer outcome is kept only for server-side audit (AC-1.2/AC-1.3)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 15.1, 15.2, 15.4, 3.4_
    - _DONE 2026-07-14 (sign-in; N-035): `services/authentication.service.js` — closed `SignInOutcome`, `get(username)`-only lookup (D-006), delegated compare via `Password_Hasher.verify` (AC-1.5, no bcrypt/jwt import), token minted with live identity incl. `tokenVersion` (D-027), brute-force checkpoints, DV-006 uniform-401 + dummy-hash timing parity (D-031), secret-free audit, token-failure rethrow (§7). signOut (cookie clear/204 + `TokenService.revokeRefreshFamily`) is router-level → Task 13._
  - [x]* 7.2 Write unit tests for sign-in outcomes and delegation
    - success→session; unknown→no token + recordFailure; bad_password→no token + recordFailure; missing_field validated before store/guard; assert single `verify(submitted, storedHash)` call and no direct equality on password; **assert unknown-user and bad-password responses are byte-identical (status+body) and the unknown-user path still calls `verify` (dummy hash) for timing parity (DV-006)**
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
    - _DONE 2026-07-14: `authentication.service.test.js` — 10 passing: AC-1.1 success+live identity/tokenVersion, AC-1.2 unknown+dummy-verify, AC-1.3 bad password, DV-006 identical client view, AC-1.4 missing-field precedence (store/guard untouched), rate_limited short-circuit, blank-hash→bad_password, token-failure rethrow, secret-free audit, AC-1.5 no bcrypt/jwt import._
  - [ ]* 7.3 Write an integration test for the sign-in wiring
    - Seeded user signs in → 200 token that `Token_Service.verify` accepts; wrong password → 401 no token; unknown username → the **same generic 401** (identical status+body) no token (DV-006) (real service→store/hasher/token, no mocks)
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 8. RBAC — Role_Service and Authorization_Service (§05)
  <!-- DONE 2026-07-14 (N-036): §05 SERVICE LAYER complete (REQ-9 + REQ-10 + REQ-17 gate half + §5.3 predicate). Two design defects reconciled at the root BEFORE/AT code: DEF-R1 (§05 §9 now formally homes Property 13) and DEF-R2 (VERIFIED — the bootstrap gate returned 403 for the seeded admin's account.rotatePassword, an N-013-class deadlock; §05 §4.2/§6/§8.4 + code fixed to state the gate's ALLOW half per the normative P-009 §12 §9). The API-layer authorization MIDDLEWARE (token verify → live-record load/shape-map → resolveIdentity → isAllowed) + router mount are Task 13; see N-036 for the getUserCache-shape integration flag. Full auth-management suite: 107 passing, stable. -->
  - [x] 8.1 Implement `Role_Service`
    - Create `services/role.service.js`: `create`/`list`/`update`/`delete` outcomes; canonical id = `role.id`; duplicate-id rejected without mutation (AC-9.5); update replaces permission set wholesale (AC-9.3); delete prunes ids from every referencing user via the adapter (AC-9.4); emit audit
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
    - _DONE 2026-07-14: `services/role.service.js` — closed outcomes + audit; AC-9.5 realized via the store's ATOMIC plain-INSERT create (D-024 → `duplicate_key`), TOCTOU-free, existing role unmodified; `prunedUsers` from an accurate pre-delete `User_Store.readAll` scan, prune delegated to `Role_Store.delete` (N-036)._
  - [x] 8.2 Implement `Authorization_Service` and the admin-determination predicate
    - Create `services/authorization.service.js`: `isAllowed(identity, operation) → Decision`; ordered procedure (unauthenticated→401, `mustRotate` bootstrap gate→403 except `account.rotatePassword`, permission-set membership→allow/403), fail-closed default deny; `effective(identity)` = union of role perms + `groupCodeAdmin` (255/-1); single-owner `isAdministrator(subject)` predicate consumed by §04 and §12; pure function (no clock/random)
    - **Live session authority (D-015, fixes N-011):** `Identity` is built from the **live** `User_Record` (roles/groups/existence/`mustRotate` from the store, NOT the token claims), and a `tokenVersion` check denies tokens minted before a logout/password-change/role-change/disable (§05 §4.1); token `roles`/`groups` are compat-only
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 17.2_
    - _DONE 2026-07-14: `services/authorization.service.js` — pure over injected `Role_Store.get`; `resolveIdentity(claims, record)` (D-032) live-authority + D-027 absent→0 `tokenVersion` revocation; `isAllowed` ordered/total, **bootstrap gate ALLOWS `account.rotatePassword` under `mustRotate` (DEF-R2 root fix, membership bypassed) and denies everything else 403**; `isAdministrator` predicate. No clock/random/HTTP (N-036)._
  - [x]* 8.3 Write property test: authorization decisions are deterministic
    - **Property 6: Authorization decisions are deterministic**
    - **Validates: Requirements 10.5** — (P-006; owner §05); same identity+operation, unchanged roles/perms ⇒ same decision; min 100 iters
    - _DONE 2026-07-14: `authorization.service.test.js` Property 6 @200 iters — generators span all four branches (allow / 403 / 401 / bootstrap-gated); asserts `decision1` deep-equals `decision2` and each decision is a member of the closed Decision set._
  - [x]* 8.4 Write property test: role deletion prunes all references
    - **Property 11: After role deletion, no surviving user references a deleted role id and no deleted role remains**
    - **Validates: Requirements 9.4** — (P-011; owner §05); min 100 iters
    - _DONE 2026-07-14: `role.service.test.js` Property 11 @120 iters — real in-memory sqlite through both adapters; asserts (1) every deleted role gone from the store, (2) no surviving user references a deleted id, (3) `prunedUsers` = exactly the referencing users._
  - [x]* 8.5 Write unit tests for role CRUD and authorization decisions
    - Duplicate-role reject; wholesale permission replace; 401 unauthenticated vs 403 unpermitted; admin-role/group-code (`255`/`-1`) allows user.*/role.*; unknown permission → deny
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 10.1, 10.2, 10.3, 10.4_
    - _DONE 2026-07-14: `role.service.test.js` (create/dup/shape-guard/list/update-wholesale/unknown/delete-prune) + `authorization.service.test.js` (401 vs 403, allow-on-grant, AC-10.4 role + 255/-1 compat, fail-closed unknown perm, dangling role, **AC-17.2 bootstrap gate incl. the DEF-R2 allow-rotate regression**, AC-17.3 regain, `isAdministrator`)._
  - [x]* 8.6 Write property test for live session authority + active revocation
    - **Property 13: A deleted/downgraded account, or a token below the account's current `tokenVersion`, is denied on the next protected request; the live account (not token claims) governs the decision**
    - **Validates: D-015, N-011** — (P-013; owner §05); min 100 iters
    - _DONE 2026-07-14: `authorization.service.test.js` Property 13 @200 iters over `resolveIdentity(claims, record)` (D-032) — absent/disabled/version-below ⇒ `authenticated:false`; otherwise carries the LIVE record's roles/groups/mustRotate (token claims ignored). Deterministic anchors added for each branch._

- [x] 9. User_Service — CRUD (§04)
  <!-- DONE 2026-07-14 (N-037): §04 SERVICE LAYER complete (REQ-5/6/7/8 + AC-4.6/4.7 policy + atomic last-admin guard). Two design defects reconciled at the root BEFORE/AT code: DEF-U1 (the atomic last-admin guard is the store-adapter method User_Store.deleteGuarded(username, isAdministratorFn) — one BEGIN IMMEDIATE txn; the service injects the §05 predicate — closing the N-016 TOCTOU and the deferred Task 2.9 guard + Task 2.10 P-016) and DEF-U2 (CreateOutcome §2.2 was missing the invalid/validation_error variant §2.3/§8.1 require). The router (users.router.js) + authorization middleware + outcome→HTTP mapping are Task 13; see N-037 for the composition-root shared-connection flag. Full auth-management suite: 127 passing, stable. -->
  - [x] 9.1 Implement `User_Service`
    - Create `services/user.service.js`: `create` (validate→duplicate check without mutation→hash→persist), `list`/`get` (UserView, no hash, empty≠error), `update` (existence check→validate→hash-or-retain→apply fullname/roles/metadata, no write on failure), `delete` (existence check→**last-admin guard using §05 predicate**→remove+cache evict); emit audit on create/update/delete
    - **Password policy enforcement (D-017/DV-007):** the create/update validation step rejects a password whose UTF-8 length exceeds bcrypt's 72-byte bound (AC-4.6) and enforces the min-length + common-password blocklist policy (AC-4.7) before hashing (§04 §2.3)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.5, 4.6, 4.7_
    - _DONE 2026-07-14: `services/user.service.js` — pure over injected seams (no SQL/clock/HTTP, AC-16.3); hashing upstream (AC-5.4/7.2), hash-free `UserView` (AC-6.2), retain-on-omit (AC-7.3). **Password policy (D-034):** `settings.auth.passwordMinLength` (default 12 code-points) + `passwordBlocklist` (case-insensitive, built-in default); order = required → malformed-UTF-16 (D-025) → >72 bytes (AC-4.6) → min (AC-4.7) → blocklist (AC-4.7), all → `validation_error` no-hash/no-write. **DEF-U2:** create gained the `invalid` outcome. **DEF-U1/D-033:** delete delegates to the ATOMIC `User_Store.deleteGuarded(username, isAdministratorFn)` (§05 predicate injected)._
  - [x]* 9.2 Write unit tests for CRUD outcomes
    - Create duplicate/missing-field; list excludes hash; get empty for missing; update retain-hash-on-omit and no-mutation-on-failure and missing→error; delete missing→error, cache eviction, and **last-admin refused with no mutation** (AC-8.5); **password >72 UTF-8 bytes rejected (AC-4.6) and min-length/blocklist policy enforced (AC-4.7)**
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.4, 7.3, 7.4, 7.5, 8.3, 8.5, 4.6, 4.7_
    - _DONE 2026-07-14: `user.service.test.js` — **20 passing**: (A) example/edge with doubles (AC-5.1..5.4 incl. hash-only + trim, AC-5.2 fast-path + atomic PK, AC-5.3, DEF-U2 policy set, configurable policy, AC-6.1/6.2, AC-6.3/6.4, AC-7.1/7.2/7.3, AC-7.4/7.5 + password-policy-on-update, INV-1, AC-8.1/8.2/8.3/8.5 mapping, ctor guard); (B) real-sqlite/bcrypt integration (create→get single-hash verify, retain-hash end-to-end, last-admin single/non-last, plain-user delete) + **Property 16 @100** (concurrent deletes of all admins → exactly one survives, ≥1-admin invariant, D-020/D-033)._

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
  - [x]* 11.3 Write unit tests for recording and secret exclusion
    - Per-category record with required fields + timestamp; denial records identity/op/reason (guest for unauthenticated); logger injects nothing (5a); plaintext and hash never appear in the captured line (5b); failing sink does not change the caller's outcome
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
    - _DONE 2026-07-13: `server/test/auth-management/audit-logger.test.js` verifies category recording, allow-list/secret exclusion, malformed-event diagnostics, and non-throwing failure behavior; included in the fresh Task 4 baseline._
  - [x]* 11.4 Write tests for the dedicated sink and health signal (D-023)
    - Audit lines land in `fuxa-audit.log` and NOT `fuxa.log` (separation + independent rotation); a failing `write` flips `health().ok=false` with `lastError` while the domain outcome is unchanged; richer fields round-trip and stay secret-free (incl. `changes[].from/to`); optional hash-chain links lines and detects tampering; startup transport-failure falls back and reports degraded `health()`
    - _Requirements: 14.1, 14.5_
    - _DONE 2026-07-13: same `audit-logger.test.js` exercises dedicated `fuxa-audit.log` separation, health degradation on write failure, richer secret-free fields, hash-chain linkage, and startup fallback; included in the fresh Task 4 baseline._

- [x] 12. Administrator bootstrap, rotation, and migration (§12)
  <!-- DONE 2026-07-14 (N-038): §12 SERVICE LAYER complete (REQ-17.1..17.5). Two design defects reconciled at the root BEFORE/AT code: DEF-B1 (the migration re-hash of a known-default '123456' admin is security-NECESSARY, not "recommended" — a gate alone leaves the §3.2 hostile-rotation takeover) and DEF-B2 (User_Store.list()→readAll() naming). Enrollment ambiguity resolved by D-035. Password policy made single-source (password-policy.js, anti-drift; shared with §04). The HTTP surface — POST /api/account/rotate-password (13.7), runBootstrap at the composition root (13.5), and the operator enrollment glue (console collector / token redemption) — is Task 13/14. Full auth-management suite: 142 passing, stable. -->
  - [x] 12.1 Implement the startup bootstrap routine
    - Create `services/bootstrap.js` `runBootstrap(deps)`: content-based empty-admin check via `isAdministrator` (§05); when none, seed **exactly one** admin with a CSPRNG one-time secret (never `'123456'`, cost 12), `groups=-1`, `metadata.mustRotate=true`, hash written verbatim via the adapter; emit `bootstrap.seed` audit (AC-17.5); idempotent + retain-existing on non-empty (AC-17.4)
    - _Requirements: 17.1, 17.4, 17.5_
    - _DONE 2026-07-14: `services/bootstrap.js` `Bootstrap`/`runBootstrap` — `readAll`+§05 classify (DEF-B2 reconcile); seed via `userStore.create` (verbatim hash, groups -1, mustRotate true) + `bootstrap.seed` audit; idempotent (gated seed admin skipped on re-run)._
  - [x] 12.7 Implement the secure enrollment channel for the seed/rotated secret (D-022, fixes N-018)
    - The initial/rotated secret is delivered via a dedicated secure channel and is **never** written to `fuxa.log`/`runtime.logger`/console: (default) an interactive first-run CLI enrollment collaborator that sets the initial secret at a controlled console; (automated provisioning) a one-time enrollment token — short TTL, hashed-at-rest, single-use (invalidated on redemption or expiry) — surfaced once to an operator-only channel and redeemed to set the real secret (§12 §3.2)
    - _Requirements: 17.1_
    - _DONE 2026-07-14 (D-035): `services/enrollment.js` — `OneTimeEnrollmentTokenStore` (SHA-256 hashed-at-rest, TTL, single-use `redeem`) + `TokenEnrollmentChannel` (surfaces only the token to an injected operator sink, never the secret). Bootstrap delivers the one-time secret ONLY via the injected `enrollmentChannel.deliver` (never logged/returned). The interactive-console collector + the HTTP token-redemption endpoint are composition/API glue (Task 13/14)._
  - [x] 12.2 Implement the `account.rotatePassword` operation (the gate exception)
    - Create `services/account.service.js` `rotatePassword(identity, req)`: verify current secret via `Password_Hasher`, reject reuse/weak new secret, re-hash + persist verbatim, then clear `metadata.mustRotate=false` (AC-17.3); audited as `user.update`; the sole operation permitted while gated
    - _Requirements: 17.2, 17.3_
    - _DONE 2026-07-14: `services/account.service.js` — `bad_current` (verify mismatch, gate NOT cleared) / `invalid_new` (reuse or shared-policy failure) / `rotated` (re-hash + clear mustRotate + **bump tokenVersion** D-015/D-027 + audit `user.update`)._
  - [x] 12.3 Implement mandatory migration remediation of a known-default admin
    - In the retain-existing branch, `remediateKnownDefaultAdmins`: for each admin lacking a rotation marker whose stored hash verifies `'123456'`, set `metadata.mustRotate=true` (and re-hash to a fresh one-time secret) via `User_Store.update`; create no new admin (D-013(1), mandatory)
    - _Requirements: 17.2, 17.4_
    - _DONE 2026-07-14 (DEF-B1): re-hash to a fresh CSPRNG secret is NECESSARY (not "recommended") — a gate alone leaves `'123456'` usable for a hostile self-rotation takeover; `bootstrap.js` re-hashes + arms the gate + bumps tokenVersion + delivers the fresh secret via the enrollment channel; audited as `user.update`. §8 corrected._
  - [x]* 12.4 Write property test: a seeded admin cannot act before rotation
    - **Property 9: A seeded admin cannot act before password rotation**
    - **Validates: Requirements 17.2, 17.3** — (P-009; owner §12); every protected op denied pre-rotation (even held admin perms), allowed after; min 100 iters
    - _DONE 2026-07-14: `account.service.test.js` Property 9 @200 — over real `Authorization_Service.isAllowed`: a `mustRotate` seeded admin (`groups:-1`) is denied every op except `account.rotatePassword`; after clearing, admin perms regained._
  - [x]* 12.5 Write property test: at least one administrator always remains
    - **Property 10: For any sequence of deletions on a store starting with ≥1 admin, ≥1 admin always remains**
    - **Validates: Requirements 8.5, 17.1** — (P-010; jointly owned §04 + §12); drive `User_Service.delete` sequences against the last-admin guard; min 100 iters
    - _DONE 2026-07-14: `bootstrap.test.js` Property 10 @100 — base case seeded by `runBootstrap` (AC-17.1); random `User_Service.delete` sequences against the last-admin guard (AC-8.5); after every delete `adminCount() ≥ 1`._
  - [x]* 12.6 Write unit/integration tests for bootstrap and migration
    - Seed-once + idempotent restart (AC-17.1/17.4); `bootstrap.seed` audited (AC-17.5); seeded/legacy `'123456'` yields no usable authority pre-rotation and the module seed never verifies `'123456'`; migration flips `mustRotate` on a detected known-default admin; **no code path writes the seed/rotated plaintext (or a redeemable token) to `runtime.logger`/console; the enrollment token is single-use + TTL-bounded (D-022, §12 §10.4)**
    - _Requirements: 17.1, 17.4, 17.5, 17.2_
    - _DONE 2026-07-14: `bootstrap.test.js` — seed-once + idempotent, retain-existing, AC-17.5 audit, DEF-B1 migration (`'123456'` no longer verifies), §10.3 no-usable-known-default after seed+migration, §10.4 secret-free audit trail, enrollment token single-use/TTL/hashed-at-rest + token-only channel._

- [ ] 13. API layer — routers, authorization middleware, and mount
  - [x] 13.1 Implement the authorization middleware seam
    - Create `api/authorization.middleware.js`: verify token (identity/session reference only) then build `Identity` from the **live `User_Record`** (roles/groups/existence/`mustRotate` from the store, D-015) and check `tokenVersion` for active revocation; call `Authorization_Service.isAllowed`, short-circuit 401/403, never touch the store directly beyond the identity read; fail fast if the service is unavailable
    - _Requirements: 10.2, 10.3, 16.3, 16.4_
    - _DONE 2026-07-14 (N-039): `api/authorization.middleware.js` — token from `x-access-token`/Bearer → `Token_Service.verify` → **`User_Store.get`** live record (D-032/N-036 flag #1) → `resolveIdentity` (D-015/D-027) → `isAllowed` → 401/403 or `req.authIdentity`+next; dependency throw ⇒ **503** fail-fast (AC-16.4). Verified over real HTTP incl. deleted-account + tokenVersion revocation._
  - [x] 13.2 Implement the authentication router
    - Create `api/authentication.router.js`: `POST /api/signin` (up-front field-presence 400, outcome→HTTP per §01 §4), `POST /api/refresh`, `POST /api/signout` (204); delegate to services only
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.2, 3.3, 3.4, 16.3_
    - _DONE 2026-07-14 (N-040): `api/authentication.router.js` — signin §01 §4 mapping (success/missing_field/DV-006 byte-identical 401/429) + refresh §02 §6.3 (disabled 204 / rotated 200+cookie / reject 401+clear / reuse-revoke) + signout AC-3.4 (server-side family revoke + 204). Delegates to services only (no bcrypt/jwt import); +2 additive Token_Service helpers (`issueRefreshForSignIn`, `revokeRefreshByToken`) keep JWT in the Token layer. Verified over real HTTP (`api.authentication.test.js`, 9 passing incl. RFC 9700 reuse + signout family-revoke)._
  - [x] 13.3 Implement the users router (CRUD backend for REQ-12)
    - Create `api/users.router.js`: guarded CRUD endpoints requiring `user.create`/`user.read`/`user.update`/`user.delete`; outcome→HTTP per §04 §8.2 (incl. `duplicate_username`, `last_admin`, `user_not_found`)
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 7.1, 7.4, 8.1, 8.3, 8.5, 16.3_
    - _DONE 2026-07-14 (N-039): `api/users.router.js` — full §04 §8.2 mapping incl. the DEF-U2 `invalid`→400 row; verified over real HTTP (`api.routers.test.js`)._
  - [x] 13.4 Implement the roles router
    - Create `api/roles.router.js`: guarded role endpoints requiring `role.*`; outcome→HTTP per §05
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 16.3_
    - _DONE 2026-07-14 (N-039): `api/roles.router.js` — full §05 §8.1 mapping (duplicate_role/role_not_found/validation_error); role.* guarding verified over real HTTP._
- [ ] 13.5 Implement the composition root and the SUPERSEDE cutover (D-014, fixes N-014)
    - Create `server/auth-management/index.js`: instantiate adapters → services (inject Password_Hasher, Token_Service, brute-force, Audit_Logger, Refresh_Token_Store, stores), run `runBootstrap` at startup, and export the mounted router; in the FUXA API bootstrap, **stop mounting** FUXA's `usersApi`/`authApi` for the overlapping paths (`/api/signin`, `/api/refresh`, `/api/signout`, `/api/users`, `/api/roles`) and mount the module router (after `authLimiter`) so the module is the **sole** authority for those URLs — not shadowed by a residual FUXA handler; keep the touch within the D-003 wiring boundary; client cutover (D-011) lands together
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 17.1_
    - _PARTIAL 2026-07-14 (N-041): **composition-root FACTORY DONE** — `server/auth-management/index.js` `createAuthManagementModule(deps)` assembles adapters→services→routers + runs `runBootstrap` + exports the mounted `router`; verified end-to-end (`composition-root.test.js`, 4 passing: seed→gated→rotate→full-admin lifecycle over real HTTP + idempotent retain + enrollment-required). **REMAINING (part 3b): the single FUXA-core `server/api/index.js` SUPERSEDE edit + client cutover (D-011)** — held for a coordinated, user-confirmed commit because editing `api/index.js` without the client change breaks the running built client on the `{roles}` vs `{groups,info}` signin payload (D-014 "land together")._
  - [x] 13.7 Implement the account-rotation router (D-018, fixes N-013)
    - Create `api/account.router.js` exposing `POST /api/account/rotate-password`, wired in the composition root (instantiating `Account_Service`, task 12.2); it is the sole operation reachable while `mustRotate` is true, so a seeded/migrated admin can become usable; on success bump `tokenVersion` (D-015)
    - _Requirements: 17.2, 17.3, 16.3_
    - _DONE 2026-07-14 (N-039): `api/account.router.js` — `POST /api/account/rotate-password` guarded by `account.rotatePassword`; rotated/bad_current/invalid_new mapping; verified over real HTTP — a gated admin reaches it, pre-rotation token revoked after success (tokenVersion), gate cleared (AC-17.3). The composition-root mount is Task 13.5._
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
  - [x] 15.2 Implement `AuthSignInClient`
    - Create the module-owned Angular service issuing `POST /api/signin` via `EndPointApi.getURL()`, resolving `{ token, username, fullname, roles }`, normalizing errors to stable ids (`invalid_credentials`/`too_many_attempts`/`missing_field`/`unexpected_error` — note: unknown-user is folded into `invalid_credentials`, no `user_not_found` at sign-in per DV-006); uses `Skip-Error` so 401 does not trigger global sign-out
    - _Requirements: 11.2, 11.4_
    - _DONE 2026-07-15 (N-045): `client/src/app/auth-management/clients/auth-signin.client.ts` — thin `@Injectable({providedIn:'root'})` shell over the framework-free `auth-protocol` core; `POST /api/signin` with `Content-Type` + `Skip-Error` (verified against `_helpers/auth-interceptor.ts` — Skip-Error deletes the header and bypasses the global 401/403 sign-out), `map(mapSignInSuccess)`/`catchError(→ normalizeSignInError)` so it emits `SignInResult` / errors a stable `SignInError` (never the raw response). Base URL via `EndPointApi.getURL()`. Type-checked by `tsconfig.verify.json` (0 errors) + wiring-tested in `auth-clients.spec.ts` (jest/ts-jest, D-036)._
  - [x] 15.3 Implement `UserAdminClient` and `RoleAdminClient`
    - Create module-owned Angular services for `GET/POST/PUT/DELETE /api/users` and `GET /api/roles`, mapping `UserView[]`/`RoleOption[]` and normalizing errors (`duplicate_username`/`validation_error`/`user_not_found`/`last_admin`/`forbidden`/`unauthorized_error`); consume first-class `roles`, never parse `info`
    - _Requirements: 12.1, 12.2, 12.3, 12.5_
    - _DONE 2026-07-15 (N-045): `client/src/app/auth-management/clients/{user-admin,role-admin}.client.ts` — thin `@Injectable` shells over the pure core. UserAdminClient: list/get/create/update/delete `/api/users` mapping via `mapUsersResponse`/`mapUserResponse`/`mapUserView` (hash-free UserView, empty single→null per AC-6.4), `:username` URL-encoded, whitelisted body fields matching `users.router.js`. RoleAdminClient: list/create/update(PUT `{permissions}`)/delete `/api/roles` via `mapRolesResponse`, id-based (§05 §3.1), delete returns `{removed,prunedUsers}`. Both normalize every non-2xx to a stable `AdminError` via `normalizeAdminError`; `Skip-Error` keeps a 403 an in-page error (not a forced sign-out). Type-checked (0 errors) + wiring-tested._
  - [x]* 15.4 Write unit tests for the client HTTP services
    - `HttpClientTestingModule` request shape + success mapping + error-id normalization for sign-in and user/role clients
    - _Requirements: 11.2, 11.4, 12.2, 12.3_
    - _DONE 2026-07-15 (N-045, DV-009): headless jest/ts-jest (no browser). `auth-protocol.spec.ts` (10) exercises the pure mapping/normalization core; `auth-clients.spec.ts` (12) exercises the shell WIRING (exact URL/method, `Skip-Error` header, success-mapping delegation, and stable-error normalization on every HTTP failure) by direct-instantiation with a stub `HttpClient`. **DV-009 test-mechanism deviation:** `HttpClientTestingModule` (TestBed/karma/browser) is NOT usable here — it compiles the whole broken FUXA app (N-044) and needs a browser; direct instantiation over the pure core is the equivalent verification headlessly (D-036). Full jest suite: **2 suites, 22 tests, exit 0** (green on two runs). `tsc -p tsconfig.verify.json` = 0 errors against Angular 18._

- [x] 16. Login_Page UI — supersede (§07)
  <!-- DONE 2026-07-15 (N-050): §07 Login_Page delivered as a pure framework-free LoginPresenter + thin standalone @Component (DV-010/D-039), source-only under client/src/app/auth-management/login/ (NO FUXA-core edit; route + AuthGuard cutover deferred to 17.4). Verified: jest 3 suites/37 tests exit 0 (+15 presenter specs), tsc verify 0 errors, ng build --configuration production exit 0 (login AOT-compiles, "unused" until wired). A concurrent working-tree drift (server-test numRuns reduction, empty node_modules, dist rebuild) was caught + remediated — see N-050 + 00-INDEX §3. -->
  - [x] 16.1 Implement the routed `Login_Page` component
    - Create the module-owned routed component under `auth-management/login/`: reactive `FormGroup` (username/password required, trimmed), `pending` flag gating the submit control (disable-on-submit, no double submit), `role="alert"` error region with generic (enumeration-safe) messages, `autocomplete=username/current-password`, no plaintext logging; on success store the token via the reused session store and `Router`-navigate to the authenticated area
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
    - _DONE 2026-07-15 (N-050): `login/login-presenter.ts` (pure, all AC logic, seams injected — DV-010) + `login/login.component.ts` (`standalone:true`, imports CommonModule/ReactiveFormsModule/TranslateModule, wires AuthSignInClient/SessionStore/Router into the presenter — D-039, no FUXA-core edit) + `login.component.html` (labeled inputs, `autocomplete=username/current-password`, `role="alert" aria-live="assertive"`, submit `[disabled]="!canSubmit()"`+`aria-busy`) + `login.component.scss`. Route/guard cutover deferred to 17.4 (component is unrouted → tree-shaken, "unused" build warning expected)._
  - [x]* 16.2 Write component tests for the Login Page
    - AC-11.1 controls present; AC-11.2 submit sends once when both populated (and not when empty); AC-11.3 stores token + navigates; AC-11.4 each error id keeps user on page with a message; AC-11.5 submit disabled while pending
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
    - _DONE 2026-07-15 (N-050, DV-010): `login/login-presenter.spec.ts` — 15 headless jest specs: AC-11.2 (canSubmit both-non-empty-trimmed+not-pending; single dispatch w/ trimmed args; no double-submit via gated Subject), AC-11.3 (saveSession THEN navigate, order-asserted; pending reset), AC-11.4 (each errorId→generic key, stays on page, no session/nav; invalid_credentials≡user_not_found enumeration-safe; unknown→failed), AC-11.5 (pending true in-flight, reset on success/mapped-error/transport-failure). AC-11.1 template presence covered by `ng build --configuration production` compile + inspection (DV-010 — no karma/DOM harness exists here)._

- [ ] 17. User_Management_Page UI — supersede (§08)
  - [x] 17.1 Implement the page container, list view, and access gate
    - Create `auth-management/user-management/` routed `UserManagementPage` + `UserListView`: load users + roles, resolve role ids→names, render username/fullname/roles columns; `access` gate (`checking`/`granted`/`denied`) via the reused guard + `user.read` check (AC-12.6, defense-in-depth — server remains the boundary)
    - _Requirements: 12.1, 12.6_
    - _DONE 2026-07-15 (N-056, DV-010/D-039): `user-management/user-management-presenter.ts` (pure: access gate checking/granted/denied incl. server 401/403→denied, list load, role id→name resolution omitting unmatched, refresh, shared `mapAdminErrorKey`, `onRolesLoaded`→`setRoleDefinitions`) + `user-management.component.ts` (`standalone:true` thin shell wiring UserAdminClient/RoleAdminClient/ModulePermissionService; no FUXA-core edit; route deferred to 17.4) + `.html` (hash-free user table + gate states + `role="alert"`) + `.scss`. Verified: jest 4 suites/49 tests exit 0 (+12), tsc verify 0, `ng build --configuration production` exit 0 (AOT-compiles, "unused" until 17.4). Source-only; dist/lock restored to baseline._
  - [x] 17.2 Implement the create and edit forms
    - `UserCreateForm` (username required+unique, password required, roles multi-select from role options) and `UserEditForm` (username immutable, password optional→omit retains hash, role assignment); client-side validation blocks send on invalid input (AC-12.4); on success refresh the list (AC-12.2/12.3); `pending`-gated submit
    - _Requirements: 12.2, 12.3, 12.4_
    - _DONE 2026-07-15 (N-057, DV-010/D-039): ONE parameterized `user-form-presenter.ts` (create: username required+client-unique, password required; edit: username immutable, password optional→OMIT when empty [retain hash AC-7.3]/send when typed [AC-7.2], metadata preserved; single-sourced validation, submit no-op-when-invalid, onSuccess→refresh, error→key+keep, no double-submit) + `user-form.component.ts` (`standalone` thin shell, FormsModule, role checkboxes, saved/cancelled outputs; no FUXA-core edit) + `.html` + 11 jest specs. Verified: jest 5 suites/60 tests exit 0 (+11), `ng build --configuration production` exit 0 (AOT; "unused" until 17.4). Source-only; dist/lock restored._
  - [x] 17.3 Implement the delete confirmation and wiring
    - `DeleteUserConfirmDialog` gates the destructive action; on confirm call `remove` and drop the row on success (AC-12.5); handle `last_admin` (keep row, specific message) and `user_not_found` (refresh) outcomes
    - _Requirements: 12.5_
    - _DONE 2026-07-15 (N-058, DV-010/D-039): delete logic in `user-management-presenter` (`deleteUser` seam + `deletePending` + `deleteUser()`: remove-exact-row on success AC-12.5, last_admin→keep+message D-009, user_not_found→refresh+key, 401/403→denied, no double-delete) + `delete-user-confirm-dialog.component.ts` (`standalone` `role="dialog"` confirm, confirmed/cancelled outputs, no logic) + FULL page composition wired into `user-management.component` (Create button + row Edit/Delete + hosts UserFormComponent + DeleteUserConfirmDialog) + 5 jest specs. Verified: jest 5 suites/65 tests exit 0 (+5), `ng build --configuration production` exit 0. Source-only; dist/lock restored. Page UI now complete; 17.4 (route+cutover) + 17.5 remain._
  - [ ] 17.4 Wire the routes and perform the SUPERSEDE cutover
    - Register the module routes and point `AuthGuard` at the new routed pages; retire/deprecate the FUXA `app/login` dialog and `app/users` route usage without editing them in place (D-011 cutover)
    - _Requirements: 11.3, 12.1_
    - _PARTIAL 2026-07-16 (N-061): the NON-DESTRUCTIVE half is done + browser-verified — added additive `auth/login`→`LoginComponent` and `auth/users`→`UserManagementComponent` routes in `app.routing.ts` (reversible; FUXA `/login`/`/users` + `api/index.js` untouched, security not enabled). This surfaced + root-fixed a browser-only defect (30 missing i18n keys → added to `en.json`). REMAINING (the DESTRUCTIVE cutover) is BLOCKED on the N-059 user decisions: (i) enrollmentChannel, (ii) enable `secureEnabled=true` for the cutover test, (iii) client groups→roles migration scope (N-042), (iv) `legacy` flag for reversibility, (v) point `AuthGuard` at the routed Login + retire the FUXA dialog._
    - _DESIGN 2026-07-16 (D-042): the cutover design is validated against source (AuthGuard gates on groups-based `isAdmin()`; module login carries roles + doesn't update FUXA's in-memory session — N-063). Options: (1) full groups→roles rewrite of FUXA client auth [big/high-risk]; (2) RECOMMENDED — module Login_Page reuses FUXA's `AuthService` session mechanism (groups preserved, no app-wide-auth rewrite) + reversible `legacy` flag, NO server cutover yet [low-risk]; (3) payload shim [rejected]. Awaiting the user's Option 1-vs-2 choice before the reversible FUXA-core routing edit._
    - _OPTION-2 LOGIN CUTOVER — BROWSER e2e VERIFIED 2026-07-16 (N-066): with `secureEnabled=true`, a headless-Chrome CDP e2e (Playwright MCP down) confirmed `/auth/login` renders the module Login page (i18n), admin/123456 → `AuthService.signIn` establishes the FUXA session (`sessionStorage.currentUser{groups:-1}` + published token) → reload `/` → `/editor` reachable (guard accepts admin) → **0 console errors**. `/auth/users` renders but shows "No data" because FUXA's `GET /api/users` returns a bare array, not the module `{data:[]}` envelope — EXPECTED under Option-2 (server not cutover); full User-Management CRUD needs the Option-1 server SUPERSEDE (D-014/D-042). **Option-2 module-login = DONE; the destructive Option-1 cutover (13.5 server SUPERSEDE + groups→roles) remains, high-risk, user-approval-gated.**_
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
