# Traceability Matrix — the anti-drift engine

> Bidirectional map: every requirement must flow forward to design → task → test, and every
> design section must map back to a requirement. **Orphans on either side are drift** and must
> be resolved before advancing a phase (see `README.md` §4).
>
> Status legend: `planned` = section named but not yet written; `drafted` = written, not
> validated; `validated` = reviewed & self-consistent; `implemented`; `tested`.

## A. Planned design sections (to be created under `design/`)

| Design ID | Section file (planned) | Covers requirements |
|-----------|------------------------|---------------------|
| `DES-ARCH`      | `design.md` (master map — architecture overview + TOC) | REQ-16 |
| `DES-AUTH`      | `design/01-authentication.md`        | REQ-1 |
| `DES-TOKEN`     | `design/02-token-and-session.md`     | REQ-2, REQ-3 |
| `DES-PWD`       | `design/03-password-security.md`     | REQ-4 |
| `DES-USER`      | `design/04-user-management.md`       | REQ-5, REQ-6, REQ-7, REQ-8 |
| `DES-RBAC`      | `design/05-rbac-authorization.md`    | REQ-9, REQ-10 |
| `DES-STORE`     | `design/06-persistence-and-serialization.md` | REQ-13 |
| `DES-UI-LOGIN`  | `design/07-ui-login-page.md`         | REQ-11 |
| `DES-UI-USERS`  | `design/08-ui-user-management-page.md` | REQ-12 |
| `DES-AUDIT`     | `design/09-audit-logging.md`         | REQ-14 |
| `DES-BRUTE`     | `design/10-brute-force-protection.md`| REQ-15 |
| `DES-DATA`      | `design/11-data-models.md`           | REQ-13, cross-cutting |
| `DES-BOOT`      | `design/12-admin-bootstrap.md`       | REQ-17 (new) |

## B. Requirement → Design coverage

| REQ | Title | Design section(s) | Status |
|-----|-------|-------------------|--------|
| REQ-1  | User Authentication (Login)        | DES-AUTH | **drafted** |
| REQ-2  | Session Token Issuance & Validation| DES-TOKEN | **drafted** |
| REQ-3  | Token Refresh & Sign-Out           | DES-TOKEN | **drafted** |
| REQ-4  | Password Security                  | DES-PWD (hashing) + DES-USER (AC-4.6/4.7 validation) | **drafted; AC-4.6/4.7 added 2026-07-13 (DV-007)** |
| REQ-5  | Create User                        | DES-USER | **drafted** |
| REQ-6  | List and View Users                | DES-USER | **drafted** |
| REQ-7  | Update User                        | DES-USER | **drafted** |
| REQ-8  | Delete User                        | DES-USER | **drafted** |
| REQ-9  | Role Management (RBAC)             | DES-RBAC | **drafted** |
| REQ-10 | Authorization Enforcement          | DES-RBAC | **drafted** |
| REQ-11 | Login Page                         | DES-UI-LOGIN | **drafted** |
| REQ-12 | User Management Page               | DES-UI-USERS | **drafted** |
| REQ-13 | User/Role Serialization Round-Trip | DES-STORE, DES-DATA | **drafted (DES-STORE + DES-DATA)** |
| REQ-14 | Security Audit Logging             | DES-AUDIT | **drafted** |
| REQ-15 | Brute-Force Protection             | DES-BRUTE | **drafted** |
| REQ-16 | Modular Architecture               | DES-ARCH (design.md) | **drafted** |
| REQ-17 | Administrator Bootstrap (new, DV-004) | DES-BOOT | **drafted** |

## C. Correctness properties (PBT) — to be defined during design

| Prop ID | Property (informal) | Anchored to | Status |
|---------|---------------------|-------------|--------|
| `P-001` | Password hash verifies against its own plaintext; two hashes of same plaintext both verify | AC-4.3, AC-4.4 | **drafted (owned by §03)** |
| `P-002` | Password hash of plaintext A never verifies plaintext B (A≠B) **over the ≤72-byte accepted domain** | AC-4.5, AC-4.6 | **corrected 2026-07-13 (D-017/N-012) — owned by §03** |
| `P-003` | User_Record write→read round-trips username/fullname/roles/metadata unchanged | AC-13.1 | **drafted (owned by §06)** |
| `P-004` | Role write→read round-trips name/permissions unchanged | AC-13.2 | **drafted (owned by §06)** |
| `P-005` | Metadata serialize→deserialize is identity (round-trip) | AC-13.3 | **drafted (owned by §06)** |
| `P-006` | Authorization decision is deterministic for unchanged identity+operation | AC-10.5 | **drafted (owned by §05)** |
| `P-007` | A token verifies as authenticated iff signature valid AND not expired | AC-2.3, AC-2.4, AC-2.5 | **drafted (owned by §02)** |
| `P-008` | With no expiry configured, issued tokens still carry a finite default TTL (DV-003) | AC-2.7 (revised) | **drafted (owned by §02)** |
| `P-009` | A freshly seeded default admin cannot perform any protected action before password rotation (DV-004) | REQ-17 | **drafted (owned by §12)** |
| `P-010` | For any sequence of deletions on a store starting with ≥1 admin, ≥1 admin always remains (DV-005) | AC-8.5 + REQ-17 | **CONFIRMED 2026-07-12 — owned jointly §04 + §12** |
| `P-011` | After role deletion, no surviving user references a deleted role id and no deleted role remains | AC-9.4 | **CONFIRMED 2026-07-12 — owned by §05** |
| `P-012` | Lockout lifecycle matches reference state machine (threshold/lock/reset/expiry/isolation) | AC-15.1–15.5 | **CONFIRMED 2026-07-12 — owned by §10** |
| `P-013` | A signature-valid token whose account is deleted, or whose `tokenVersion` is below the account's current version, is denied on the next protected request; a live account's current roles/groups govern the decision (not the token's claims) | D-015, N-011 | **ADDED 2026-07-13 — owned by §05; task 8.6 (§D)** |
| `P-014` | Every superseded identity URL is handled by the module (its RBAC/authn decision applied), never by a residual FUXA handler; a `mustRotate` identity can reach `POST /api/account/rotate-password` but no other protected operation | D-014, D-018, N-013, N-014 | **ADDED 2026-07-13 — owned by composition/API layer (design.md); task 13.8 (§D)** |
| `P-015` | Refresh-token rotation is single-use with family reuse-detection: an active token consumes exactly once; replay of a used/revoked token revokes the whole family; ≤1 active token per family | D-019, N-015, AC-3.2/3.3 | **ADDED 2026-07-13 — owned by §02 (RFC 9700); task 5.8 (§D)** |
| `P-016` | Under any interleaving of concurrent operations: no sequence of deletes reduces the admin count to zero (last-admin guard holds), and two concurrent creates of the same username yield exactly one record | D-020, N-016, AC-8.5/AC-5.2 | **ADDED 2026-07-13 — owned by §04 (mechanism §06); task 2.10 (§D)** |

## D. Design → Task → Test (populated 2026-07-13 at gate G3 — closes N-021)

> Every `DES-*` maps forward to its implementation task(s) and its test(s)/property(ies) in
> `tasks.md`. `*`-suffixed tasks are optional test sub-tasks. Deep-review resolution tasks
> (added 2026-07-13) are called out with their owning decision.

| Design ID | Implementation task(s) | Test(s) / Property(ies) | Status |
|-----------|------------------------|-------------------------|--------|
| `DES-ARCH` (design.md, REQ-16) | 1.1 (module skeleton); 13.1 (authz middleware seam, D-015); 13.5 (composition root + **SUPERSEDE** cutover, D-014); 13.7 (account router, D-018) | 13.6* (API integration); **13.8\* → P-014** (cutover/gate reachability) | **1.1 skeleton implemented** (server/auth-management tree: api/, services/, store/, adapters/, models/ + store/service capability interfaces + empty index.js composition-root stub, AC-16.5 storage hidden behind seams); 13.x wiring planned |
| `DES-AUTH` (§01, REQ-1) | 7.1 (Authentication_Service, incl. **DV-006** uniform-401 + dummy-hash timing) | 7.2* (outcomes + identical-response assertion); 7.3* (integration); relies on P-001/P-002 (§03) + P-007 (§02) | **7.1 (sign-in) + 7.2 DONE 2026-07-14 (N-035).** `services/authentication.service.js`: closed `SignInOutcome`; `get(username)`-only lookup (D-006, §01 reconciled from `findUser`); delegated compare via Hash seam (AC-1.5 — no bcrypt/jwt import, asserted structurally); success mints token with live identity incl. `tokenVersion` (**D-027**, §01 reconciled — DEF-A1); DV-006 uniform-401 + dummy-hash timing parity (**D-031**); brute-force checkpoints; secret-free audit; token-failure rethrow. **`authentication.service.test.js` — 10 passing** (AC-1.1..1.5 + DV-006 identical-client-view + rate_limited + blank-hash + token-failure + secret-free audit). **PENDING: signOut (cookie/204 + revokeRefreshFamily) + 7.3 real-router integration → Task 13.** Full suite 81 passing, stable |
| `DES-TOKEN` (§02, REQ-2/3) | 5.1 (JWT adapter); 5.2 (Token_Service + expiry policy); 5.6 (**D-021** JWT hardening + tokenVersion stamp); 5.7 (**D-019** Refresh_Token_Store + reuse detection) | 5.3* → **P-007**; 5.4* → **P-008**; 5.5* (refresh/sign-out units); 5.8* → **P-015** | **5.1 implemented** (`adapters/fuxa-jwt.adapter.js`: `TokenAdapter` thin wrapper — SOLE importer of `jsonwebtoken` + FUXA `api/jwt-helper`; `secret` getter live-reads `authJwt.secretCode`, one shared secret AC-2.2). **5.2 (REQ-2 half) + 5.6 IMPLEMENTED + 5.3/5.4 TESTED (2026-07-14, N-031):** `services/token.service.js` — `issueAccessToken` (hardened claim set: `id`/`sub`/`groups`/`roles`/`tokenVersion`/single `type:'access'`/`jti`; `kid` when configured per **TO-012**; `iss`/`aud` only when configured per **D-029**), `issueRefreshToken` (`{id,type:'refresh',jti,family_id,tokenVersion}`), `verify` (alg-pinning **D-021**, `type==='access'` **D-028**, closed reason mapping), §4 expiry decision table (**P-008**). **`token-service.test.js` — 10 passing, REAL HS256:** P-007 @200 (4 quadrants + id/roles/tokenVersion exposure), P-008 @200 (Rows 1/2/3 + §4.1 safety), alg:none rejected, single-`type`/no-`typ`, iss/aud-when-configured, `kid` header. Closes the N-022 access-path real-crypto gap. **5.7 + 5.8 IMPLEMENTED + TESTED (2026-07-14, N-033/D-030):** `store/refresh-token-store.js` (`auth_refresh_tokens` on the module-owned connection; SHA-256 at-rest + timingSafeEqual; CAS single-use consume in `BEGIN IMMEDIATE`; `revokeFamily`) + `TokenService.refresh` (verify → lookup+hash → reuse-detect → live-account/`tokenVersion` D-015/D-027 → atomic consume-and-rotate) + `revokeRefreshFamily`. **`refresh-token-store.test.js` — 14 passing, REAL crypto+sqlite:** P-015 @120 (model-based: ≤1 active/family, single-use, reuse revokes family) + all `refresh()` branches (rotated/reuse_detected/missing/wrong_type/expired/invalid/unknown-jti/hash-mismatch/unknown_user/version-revoked) + CAS single-use under concurrent double-consume. Root-fixed a concurrent-transaction crash in `FuxaAuthDb` (N-032, in-process transaction queue). Closes the N-022 refresh-path gap. **§02 SERVICE LAYER COMPLETE (REQ-2 + REQ-3).** Remaining: API-layer HTTP wiring — router mount, cookie clear, 401/204 status mapping, `disabled` short-circuit, sign-out endpoint — owned by **Task 13**. Full suite 71 passing, stable) |
| `DES-PWD` (§03, REQ-4) | 3.1 (bcrypt adapter); 3.2 (Password_Hasher, bounded domain **D-017** + malformed-UTF-16 guard **D-025**) | 3.3* → **P-001**; 3.4* → **P-002** (≤72-byte domain); 3.5* (edge units) | **3.1 implemented + 3.2 implemented + 3.3/3.4/3.5 TESTED (2026-07-13)**. `adapters/fuxa-bcrypt.adapter.js` = SOLE `bcryptjs` importer (Hash seam, D-003/N-001), thin `hashSync`/`compareSync`, cost default 12 (D-008, tests pass 4). `services/password-hasher.js` = `Password_Hasher` (injects the adapter, NO bcrypt import): `hash` total/salted (fresh salt/call), `verify` defensive→false (never throws) on null/empty/malformed hash or non-string plaintext (§2.2). **Malformed-UTF-16 guard (D-025, fixes N-027):** cheap `hasLoneSurrogate` scan — `verify` returns `false` FAST for a lone-surrogate plaintext (was ~9.6s bcrypt-DoS reachable unauthenticated via login/JSON + DV-006 dummy-hash) and `hash` throws `invalid_password_encoding` instead of hanging. **`test/auth-management/password-hasher.test.js` (node:assert + fast-check + real bcryptjs, N-025): 7 passing** — **3.3 P-001** (own-plaintext verify + two-hashes-differ random-salt witness) @150 iters; **3.4 P-002** (rejects a different plaintext over the ≤72-byte well-formed domain, near-dup biased, generator built rejection-free & code-point-safe) @150 iters; **3.5**: empty-string base case, defensive verify (null/''/malformed hash + non-string plaintext), malformed-UTF-16 fast-reject (D-025/N-027 regression guard, <1000ms), FUXA cost-10 interop verify, unconfigured seam = cost 12 (D-008). NOTE: the ≤72-byte policy (AC-4.6) + min-length/blocklist (AC-4.7) remain User_Service concerns (Task 9.1); D-025 also requires boundary malformed-UTF-16 rejection in User_Service 9.1 + Authentication_Service 7.1 (defense-in-depth; hasher guard is the backstop). |
| `DES-USER` (§04, REQ-5/6/7/8) | 9.1 (User_Service, incl. **D-017** AC-4.6/4.7 policy + last-admin guard); 2.9 (**D-020** atomic create + last-admin BEGIN IMMEDIATE) | 9.2* (CRUD + policy units); 2.10* → **P-016**; 12.5* → **P-010** (jointly §12) | **planned** |
| `DES-RBAC` (§05, REQ-9/10) | 8.1 (Role_Service); 8.2 (Authorization_Service + `isAdministrator`, **D-015** live authority) | 8.3* → **P-006**; 8.4* → **P-011**; 8.5* (role/authz units); 8.6* → **P-013** | **planned** |
| `DES-STORE` (§06, REQ-13) | 2.1 (serialization); 2.3 (FuxaUserStoreAdapter); 2.4 (FuxaRoleStoreAdapter); 2.8 (**D-016** single-txn atomic write); 2.9 (**D-020** plain-INSERT dedup) | 2.2* → **P-005**; 2.5* → **P-003**; 2.6* → **P-004**; 2.7* (store regression); 2.10* → **P-016** (mechanism) | **2.1/2.3/2.4/2.8 implemented + 2.2/2.5/2.6/2.7 TESTED + 2.9 create-half implemented (2026-07-13)**. Serialization 2.1 + P-005 TESTED (`serialization.test.js`, **9 passing** — incl. the **D-026/N-029** `__proto__`-strip tests: top-level + nested strip, no prototype reassignment, `constructor`/`prototype` preserved; N-025). **Store adapters (D-024):** `store/fuxa-auth-db.js` (module-owned `sqlite3` connection to `users.fuxap.db`, WAL + busy_timeout, `BEGIN IMMEDIATE` transaction helper, generic `DuplicateKeyError` code `duplicate_key`); `adapters/fuxa-user-store.adapter.js` (**2.3/2.8**: `get`/`readAll`/`create`/`update`/`delete`; **§5 double-hash resolution** — verbatim bcrypt hash written in ONE `BEGIN IMMEDIATE…COMMIT` full-row write on its own connection, then best-effort `setUsers(pwd-omitted)` cache refresh; retain-on-omit; `info↔{roles,metadata}` split/compose; resilient `readAll`; `get` fails closed on corrupt info per N-026); `adapters/fuxa-role-store.adapter.js` (**2.4**: `Role↔roles(name=id,value=JSON)`; resilient `readAll` closes the verified `getRoles` no-try/catch gap, N-009; plain-INSERT create for atomic dup per AC-9.5; delete prunes `info.roles` via `runtime.users.removeRoles` or own-connection fallback). **`test/auth-management/store-adapters.test.js` (node:assert + fast-check + real sqlite/bcryptjs, N-025): 12 passing** (incl. the **D-026/N-029** end-to-end test that a stored `info.__proto__` payload reads back with clean metadata + untouched prototype) — **2.5 P-003** user round-trip @150 iters (metadata domain now excludes the reserved `__proto__` key per D-026) + **2.6 P-004** role round-trip @150 iters (own-connection read path, D-024) + **2.7**: double-hash regression (stored column verifies plaintext with ONE `bcrypt.compare`, not `bcrypt(bcrypt(p))`), retain-on-omit (hash byte-identical + metadata not clobbered), resilient `readAll` isolates a corrupt `info`/role `value`, `get` fail-closed (N-026), atomic duplicate-username reject without mutation (AC-5.2), atomic duplicate-role-id reject without mutation + wholesale update (AC-9.5/AC-9.3), role-delete prunes referencing user (AC-9.4), delete removes row. **2.9 last-admin `BEGIN IMMEDIATE` half + 2.10\* (P-016) DEFERRED** to Task 9 (`User_Service.delete` last-admin guard is the transaction site); the create/dedup half of 2.9 is implemented + tested here. |
| `DES-UI-LOGIN` (§07, REQ-11) | 15.1 (session plumbing reuse); 15.2 (AuthSignInClient); 16.1 (routed Login_Page) | 15.4* (client HTTP units); 16.2* (Login Page component) | **15.1 implemented** (`client/src/app/auth-management/services/session.store.ts`: `SessionStore` reuses FUXA's `sessionStorage['currentUser']` key + publishes `window.fuxaAccessToken` unchanged (verified auth.service.ts / auth-interceptor.ts), stores first-class `roles` per **D-007** — never `info.roles`; `save/read/token/roles/username/clear`. No FUXA file edited in place; D-011 SUPERSEDE cutover wiring deferred to 16.1/17.4. **Current disk check (2026-07-14): `client/node_modules` is absent**, so no client build/test was run; TypeScript/build compatibility remains **UNVERIFIED** until dependencies are installed. 15.2/16.1/15.4*/16.2* pending) |
| `DES-UI-USERS` (§08, REQ-12) | 15.3 (UserAdminClient/RoleAdminClient); 17.1 (page + list + access gate); 17.2 (create/edit forms); 17.3 (delete confirm); 17.4 (routes + SUPERSEDE cutover) | 15.4* (client HTTP units); 17.5* (User Management Page components) | **15.1 implemented** (management-route gate: `client/src/app/auth-management/guards/user-read.guard.ts` `UserReadGuard` **builds on the reused `AuthGuard`** (verified auth.guard.ts, returns `Observable<boolean>`) WITHOUT modifying it — delegates authentication, then layers a `user.read` UX check (§08 §6.2, AC-12.6); `client/src/app/auth-management/services/module-permission.service.ts` `ModulePermissionService.hasPermission('user.read')` resolves from first-class `roles` (**D-007**) against loaded role defs, else defers to server (403, §6.3), with security-disabled/`isAdmin()` fast-paths (AC-10.4). Server remains authoritative. Route-mount cutover deferred to 17.4. **Current disk check (2026-07-14): `client/node_modules` is absent**, so no client build/test was run; client compatibility remains **UNVERIFIED** until dependencies are installed. 15.3/17.1–17.5* pending) |
| `DES-AUDIT` (§09, REQ-14) | 11.1 (Audit_Logger + **D-023** dedicated append-only sink + health); 11.2 (emission wiring) | 11.3* (recording + secret-exclusion units); 11.4* (dedicated-sink/health/hash-chain) | **11.1 implemented + 11.3*/11.4* TESTED 2026-07-13** (`services/audit-logger.js`: `Audit_Logger.record` void/total/non-throwing, `AUDIT `+JSON, richer secret-free fields; `createFuxaAuditSink` = module-owned winston `File` at `${logDir}/fuxa-audit.log`, own rotation, `health()`, error-channel diagnostic + `ok=false` on write fail, fallback to shared logger. **`test/auth-management/audit-logger.test.js` (node:assert + real winston, N-023/N-025): 10 passing** — 11.3*: AC-14.1..14.4 one `AUDIT `+JSON line per category, AC-14.5a allow-list-only copy (unknown/secret keys dropped), AC-14.5 no-secret-substring, `changes[]` {field,from?,to?} sanitize, malformed→diagnostic+no-line+no-throw, §7 throwing-sink swallowed; 11.4*: `health()` ok/lastWriteOk via `transportWrite` seam, write-failure flips `ok=false`+lastError+FUXA-error-diagnostic w/o throw, opt-in hash-chain link (prevHash==prev hash), **real winston `File` transport lands both lines in a dedicated `fuxa-audit.log` (own file, tmpdir) with zero routing through the shared logger** — closes the N-022 residual (dedicated-file separation was previously exercised only in fallback). 11.2 (emission wiring into services) pending) |
| `DES-BRUTE` (§10, REQ-15) | 6.1 (guard: **DV-008** adaptive throttling + **N-019** pluggable shared store + monotonic clock) | 6.2* → **P-012** (adaptive lifecycle, AC-15.1–15.6); 6.3* (edge + shared-store units) | **6.1 implemented** (`services/brute-force.js`: `BruteForceGuard` pure state machine — `checkAllowed`/`recordFailure`/`reset`; pluggable `BruteForceStore` seam (§2.1, default `InMemoryBruteForceStore` w/ read/write/delete, shared/Redis injectable, no new dep — N-019/AC-15.6); adaptive exp. backoff `min(maxThrottleMs, baseThrottleMs·backoffFactor^(failCount−threshold))` w/ persisted `throttleLevel` (DV-008/AC-15.2); `threshold===0` fail-closed (AC-15.3); `reset` zeroes failCount+throttleLevel+lockedUntil (AC-15.4); time-elapse recovery + retained-level escalation (AC-15.5); monotonic `performance.now()` clock, NOT `Date.now()` (N-019); `retryAfterMs=max(0,lockedUntil−now)`; lazy stale-entry eviction + per-username isolation (§6); config defaults threshold 5 / base 30 000 / factor 2 / cap 900 000 / optional window. Verified via `node` sanity 13/13 (below-threshold allowed; Nth blocks; larger interval on further fail; cap; threshold-0 blocks any user; reset restarts backoff; clock-past re-allows; A-lock doesn't affect B). **6.2*/6.3* TESTED 2026-07-13** — `test/auth-management/brute-force.test.js` (fast-check@3.23.2 + `node:assert`, injected clock, N-025): **9 passing**, incl. **P-012** model-based adaptive-throttle lifecycle at **200 iters** (blocked ⇔ reference machine; `retryAfterMs` parity; per-username isolation; threshold-0 fail-closed; cap-bounded interval AC-15.6) + AC-15.1…15.6 edges + lazy eviction. Test-authoring note: `_isStale` treats `lastFailAt===0` as the "never-failed" sentinel, so staleness/eviction is only meaningful for a real failure at `now>0` (the monotonic clock never reads 0 for a live failure) — not a defect. |
| `DES-DATA` (§11, REQ-13 cross-cutting) | 1.1 (data-model modules + invariants) | 1.2* (data-model validation + reserved-key invariants) | **1.1 implemented** (models/permission,user-record,role,audit-event encode INV-1/2/3/5/6/7 + AC-14.5 secret-free; verified via `node` sanity checks); 1.2* tests pending |
| `DES-BOOT` (§12, REQ-17) | 12.1 (runBootstrap); 12.2 (rotatePassword/Account_Service, **D-018**); 12.3 (migration remediation); 12.7 (**D-022** secure enrollment channel) | 12.4* → **P-009**; 12.5* → **P-010** (jointly §04); 12.6* (bootstrap/migration + no-secret-to-log) | **planned** |

**Checkpoints** (tasks 4, 10, 14, 18) are gate/review steps with no design mapping.

**Property → owning task (all 16):** P-001→3.3, P-002→3.4, P-003→2.5, P-004→2.6, P-005→2.2,
P-006→8.3, P-007→5.3, P-008→5.4, P-009→12.4, P-010→12.5, P-011→8.4, P-012→6.2, P-013→8.6,
P-014→13.8, P-015→5.8, P-016→2.10. No property is orphaned (closes the P-013…P-016 gap the
deep review opened).

## E. Orphan and phase-gate check (current)

- Requirements with no design mapping: **none** (all REQ-1..17 mapped above).
- Design sections with no requirement: **none** (all DES-* map back).
- **§D is populated; G3 PASSED** — every DES-* maps to task(s)/test(s), and every property P-001…P-016 has an owning task. N-021 is RESOLVED.
- **The historical design-defect register in §F is fully resolved; G4 PASSED** — D-014…D-023 and DV-006…DV-008 are confirmed/enacted, and guide reconciliation is complete.
- There is **no sole remaining guide gate**. N-028's temporary implementation pause was lifted after local ledger repair and integrity checks. An independent baseline re-run then found N-029 (the store metadata `__proto__` round-trip defect — the suite was 41/42, not the handoff's "42 passing"); it was fixed at the root by D-026 and the auth-management suite is now **47 passing (exit 0), stable across 4 runs**. Work resumes under per-task G5 at Task 5.

## F. Design-Defect Register — historical, all resolved; G4 passed

> Opened 2026-07-13 and retained as defect history/provenance. Severity: **C**=Critical,
> **H**=High, **M**=Medium. Every row below is RESOLVED; this table is not a current gate.

| Defect | Sev | Area (design §) | Proposed resolution | Trade-off | Requirement change? | Status |
|--------|-----|-----------------|---------------------|-----------|---------------------|--------|
| N-010 persistence atomicity infeasible | **C** | §06 §5.2/§5.4 | D-016 (a) single-txn full-row write | TO-001 | no | **RESOLVED 2026-07-13** |
| N-011 authority from token not live account | **C** | §05 §4.1 / §12 §2.1 | D-015 (1) live re-resolution + tokenVersion | TO-008 | no | **RESOLVED 2026-07-13** |
| N-012 P-002 false (bcrypt 72-byte) | **C** | §03 §2.2/§7 | D-017 (1) bound domain + scheme version | TO-007 | DV-007 | **RESOLVED 2026-07-13** |
| N-013 rotatePassword has no API route | **C** | §12 §4 / §13 | D-018 add+wire `POST /api/account/rotate-password` | — | no | **RESOLVED 2026-07-13** |
| N-014 router cutover unspecified (shadow) | **C** | §13 / comp-root | D-014 (1) SUPERSEDE at composition root | TO-011 | no | **RESOLVED 2026-07-13** |
| N-015 refresh rotation is stateless | **H** | §02 §6.2/§7 | D-019 stateful rotation + reuse detect (RFC 9700) | TO-009 | no | **RESOLVED 2026-07-13** |
| N-016 concurrency TOCTOU (admin/create) | **H** | §04 §3.2/§6.5 | D-020 atomic INSERT + BEGIN IMMEDIATE + P-016 | — | no | **RESOLVED 2026-07-13** |
| N-017 JWT not hardened / no revocation | **H** | §02 §3/§5 | D-021 alg pin + iss/aud/jti/typ + kid (+ D-015 tokenVersion) | — | no | **RESOLVED 2026-07-13** |
| N-018 bootstrap secret to console/log | **H** | §12 §3.2 | D-022 (secure enrollment channel: interactive CLI + one-time token; §10.4 test) | — | no | **RESOLVED 2026-07-13** |
| N-019 brute-force per-process + hard lock | **M** | §10 | DV-008 + D-023 grouping: pluggable shared `BruteForceStore` + adaptive backoff + monotonic clock (AC-15.6; P-012 refined) | — | DV-008 | **RESOLVED 2026-07-13** |
| enumeration oracle (404 vs 401) | **M** | §01 / AC-1.2 | DV-006 (uniform 401 + dummy-hash timing parity; AC-8.4 lockstep) | TO-010 | DV-006 | **RESOLVED 2026-07-13** |
| N-021 traceability §D empty | **M** | traceability | §D populated 2026-07-13 (all DES→task→test; P-001…P-016 owned) | — | no | **RESOLVED 2026-07-13** |

**Historical gate rule:** implementation could not start until all CRITICAL defects were RESOLVED and §D was populated. **Current status:** every CRITICAL/HIGH/MEDIUM row is RESOLVED, §D is populated, G3 and G4 passed, and guide reconciliation is complete. N-028's separate ledger-integrity pause ended after local remediation, integrity checks, and the fresh 42-passing baseline; Task 5 is the next G5 step.

## G. §D population — DONE (2026-07-13)

§D above is now populated (all CRITICAL/HIGH/MEDIUM resolutions landed, so task IDs are stable,
including the deep-review additions 2.8/2.9/2.10, 5.6/5.7/5.8, 8.6, 11.4, 12.7, 13.7/13.8). This
placeholder is retired; see **§D** for the authoritative Design→Task→Test matrix.
