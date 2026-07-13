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
| `DES-AUTH` (§01, REQ-1) | 7.1 (Authentication_Service, incl. **DV-006** uniform-401 + dummy-hash timing) | 7.2* (outcomes + identical-response assertion); 7.3* (integration); relies on P-001/P-002 (§03) + P-007 (§02) | **planned** |
| `DES-TOKEN` (§02, REQ-2/3) | 5.1 (JWT adapter); 5.2 (Token_Service + expiry policy); 5.6 (**D-021** JWT hardening + tokenVersion stamp); 5.7 (**D-019** Refresh_Token_Store + reuse detection) | 5.3* → **P-007**; 5.4* → **P-008**; 5.5* (refresh/sign-out units); 5.8* → **P-015** | **5.1 implemented** (`adapters/fuxa-jwt.adapter.js`: `TokenAdapter` thin wrapper — SOLE importer of `jsonwebtoken` + FUXA `api/jwt-helper`; `secret` getter live-reads `authJwt.secretCode` (one shared secret, AC-2.2), `sign`/`verify` forward `options` through (verify pass-through reserved for 5.6 alg-pinning D-021), `decode` no-verify. No refresh-store/expiry-policy here (5.2/5.6/5.7). Verified via shim sanity 9/9 (live secret sourcing, options pass-through, delegation, different-secret fails verify); real-crypto round-trip deferred — server deps not installed, see **N-022**. 5.2/5.6/5.7 + 5.3*/5.4*/5.5*/5.8* pending) |
| `DES-PWD` (§03, REQ-4) | 3.1 (bcrypt adapter); 3.2 (Password_Hasher, bounded domain **D-017**) | 3.3* → **P-001**; 3.4* → **P-002** (≤72-byte domain); 3.5* (edge units) | **3.1 implemented** (`adapters/fuxa-bcrypt.adapter.js`: `BcryptHasherAdapter` — the SOLE `require('bcryptjs')` in the module (N-001/D-003 Hash seam); thin side-effect-free wrapper `hashSync(plaintext)`→`bcrypt.hashSync(plaintext,cost)` (fresh salt/call) + `compareSync(plaintext,hash)`→`bcrypt.compareSync`; cost resolved once at construction via `opts.cost`, default 12 (D-008), tests may pass 4; 72-byte policy AC-4.6 intentionally NOT enforced here — deferred to User_Service task 9.1. Syntax verified (`node --check` OK); runtime sanity (cost-4 hash/verify true+false/two-hashes-differ) DEFERRED — `server/node_modules` absent, `require('bcryptjs')` unresolved, see **N-022**; no deps vendored/added. 3.2/3.3*/3.4*/3.5* pending) |
| `DES-USER` (§04, REQ-5/6/7/8) | 9.1 (User_Service, incl. **D-017** AC-4.6/4.7 policy + last-admin guard); 2.9 (**D-020** atomic create + last-admin BEGIN IMMEDIATE) | 9.2* (CRUD + policy units); 2.10* → **P-016**; 12.5* → **P-010** (jointly §12) | **planned** |
| `DES-RBAC` (§05, REQ-9/10) | 8.1 (Role_Service); 8.2 (Authorization_Service + `isAdministrator`, **D-015** live authority) | 8.3* → **P-006**; 8.4* → **P-011**; 8.5* (role/authz units); 8.6* → **P-013** | **planned** |
| `DES-STORE` (§06, REQ-13) | 2.1 (serialization); 2.3 (FuxaUserStoreAdapter); 2.4 (FuxaRoleStoreAdapter); 2.8 (**D-016** single-txn atomic write) | 2.2* → **P-005**; 2.5* → **P-003**; 2.6* → **P-004**; 2.7* (store regression); 2.10* → **P-016** (mechanism) | **2.1 implemented + 2.2/P-005 TESTED** (`server/test/auth-management/serialization.test.js`: P-005 metadata serialize→deserialize structural-identity property over the JSON-safe domain — §06 §4.2 exclusions honored (undefined/function/NaN/±Infinity/-0/Date + top-level `roles` + `__proto__`), deep-equal, 200 iters — plus serialize `undefined`→`"{}"`/cyclic-throws and deserialize null/empty→`{}` / malformed→`invalid_metadata` resilience; **5 passing** via `mocha` + `node:assert` + `fast-check`, N-023). 2.3/2.4 adapters + 2.8 (D-016) + 2.5*/2.6*/2.7*/2.10* pending |
| `DES-UI-LOGIN` (§07, REQ-11) | 15.1 (session plumbing reuse); 15.2 (AuthSignInClient); 16.1 (routed Login_Page) | 15.4* (client HTTP units); 16.2* (Login Page component) | **15.1 implemented** (`client/src/app/auth-management/services/session.store.ts`: `SessionStore` reuses FUXA's `sessionStorage['currentUser']` key + publishes `window.fuxaAccessToken` unchanged (verified auth.service.ts / auth-interceptor.ts), stores first-class `roles` per **D-007** — never `info.roles`; `save/read/token/roles/username/clear`. No FUXA file edited in place; D-011 SUPERSEDE cutover wiring deferred to 16.1/17.4. Build/tests deferred — `client/node_modules` absent, **N-004/N-022**; type-checked by inspection against verified exports. 15.2/16.1/15.4*/16.2* pending) |
| `DES-UI-USERS` (§08, REQ-12) | 15.3 (UserAdminClient/RoleAdminClient); 17.1 (page + list + access gate); 17.2 (create/edit forms); 17.3 (delete confirm); 17.4 (routes + SUPERSEDE cutover) | 15.4* (client HTTP units); 17.5* (User Management Page components) | **15.1 implemented** (management-route gate: `client/src/app/auth-management/guards/user-read.guard.ts` `UserReadGuard` **builds on the reused `AuthGuard`** (verified auth.guard.ts, returns `Observable<boolean>`) WITHOUT modifying it — delegates authentication, then layers a `user.read` UX check (§08 §6.2, AC-12.6); `client/src/app/auth-management/services/module-permission.service.ts` `ModulePermissionService.hasPermission('user.read')` resolves from first-class `roles` (**D-007**) against loaded role defs, else defers to server (403, §6.3), with security-disabled/`isAdmin()` fast-paths (AC-10.4). Server remains authoritative. Route-mount cutover deferred to 17.4. Build/tests deferred — **N-004/N-022**. 15.3/17.1–17.5* pending) |
| `DES-AUDIT` (§09, REQ-14) | 11.1 (Audit_Logger + **D-023** dedicated append-only sink + health); 11.2 (emission wiring) | 11.3* (recording + secret-exclusion units); 11.4* (dedicated-sink/health/hash-chain) | **11.1 implemented** (`services/audit-logger.js`: `Audit_Logger.record` void/total/non-throwing, `AUDIT `+JSON, richer secret-free fields; `createFuxaAuditSink` = module-owned winston `File` at `${logDir}/fuxa-audit.log`, own rotation, `health()`, error-channel diagnostic + `ok=false` on write fail, fallback to shared logger; verified via `node` sanity 20/20. Dedicated-file separation exercised only in fallback here — winston not installed, see **N-022**. 11.2/11.3*/11.4* pending) |
| `DES-BRUTE` (§10, REQ-15) | 6.1 (guard: **DV-008** adaptive throttling + **N-019** pluggable shared store + monotonic clock) | 6.2* → **P-012** (adaptive lifecycle, AC-15.1–15.6); 6.3* (edge + shared-store units) | **6.1 implemented** (`services/brute-force.js`: `BruteForceGuard` pure state machine — `checkAllowed`/`recordFailure`/`reset`; pluggable `BruteForceStore` seam (§2.1, default `InMemoryBruteForceStore` w/ read/write/delete, shared/Redis injectable, no new dep — N-019/AC-15.6); adaptive exp. backoff `min(maxThrottleMs, baseThrottleMs·backoffFactor^(failCount−threshold))` w/ persisted `throttleLevel` (DV-008/AC-15.2); `threshold===0` fail-closed (AC-15.3); `reset` zeroes failCount+throttleLevel+lockedUntil (AC-15.4); time-elapse recovery + retained-level escalation (AC-15.5); monotonic `performance.now()` clock, NOT `Date.now()` (N-019); `retryAfterMs=max(0,lockedUntil−now)`; lazy stale-entry eviction + per-username isolation (§6); config defaults threshold 5 / base 30 000 / factor 2 / cap 900 000 / optional window. Verified via `node` sanity 13/13 (below-threshold allowed; Nth blocks; larger interval on further fail; cap; threshold-0 blocks any user; reset restarts backoff; clock-past re-allows; A-lock doesn't affect B). 6.2*→P-012 / 6.3* pending) |
| `DES-DATA` (§11, REQ-13 cross-cutting) | 1.1 (data-model modules + invariants) | 1.2* (data-model validation + reserved-key invariants) | **1.1 implemented** (models/permission,user-record,role,audit-event encode INV-1/2/3/5/6/7 + AC-14.5 secret-free; verified via `node` sanity checks); 1.2* tests pending |
| `DES-BOOT` (§12, REQ-17) | 12.1 (runBootstrap); 12.2 (rotatePassword/Account_Service, **D-018**); 12.3 (migration remediation); 12.7 (**D-022** secure enrollment channel) | 12.4* → **P-009**; 12.5* → **P-010** (jointly §04); 12.6* (bootstrap/migration + no-secret-to-log) | **planned** |

**Checkpoints** (tasks 4, 10, 14, 18) are gate/review steps with no design mapping.

**Property → owning task (all 16):** P-001→3.3, P-002→3.4, P-003→2.5, P-004→2.6, P-005→2.2,
P-006→8.3, P-007→5.3, P-008→5.4, P-009→12.4, P-010→12.5, P-011→8.4, P-012→6.2, P-013→8.6,
P-014→13.8, P-015→5.8, P-016→2.10. No property is orphaned (closes the P-013…P-016 gap the
deep review opened).

## E. Orphan check (run at each phase transition)

- Requirements with no design mapping: **none** (all REQ-1..17 mapped above).
- Design sections with no requirement: **none** (all DES-* map back).
- **§D (Design→Task→Test) is now POPULATED** (2026-07-13, gate G3) — every DES-* maps to its
  task(s) and test(s); every property P-001…P-016 has an owning task. **N-021 is RESOLVED.**
- **All design-defect resolutions RESOLVED (2026-07-13 deep review):** the register in **§F**
  below (N-010…N-019, N-021 + deviations DV-006/007/008) is fully resolved; decisions D-014…D-023
  are all `Active (CONFIRMED)`. The only remaining G4 condition is the **guide reconciliation**
  (`guide/*` updated to the corrected design — see `GATES.md` item 12).
  - Previously RESOLVED (still Active): scope (D-003), token expiry policy (TO-002/DV-003),
    admin bootstrap (D-005/TO-005/DV-004).

## F. Design-Defect Register (OPEN — gates implementation; opened 2026-07-13)

> Severity: **C**=Critical (blocks any implementation), **H**=High (blocks the affected area),
> **M**=Medium (must be scheduled). "Root fix" = the resolution addresses the cause, not a symptom.

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

**Rule:** No implementation task in `tasks.md` may start until the CRITICAL defects (N-010, N-011,
N-012, N-013, N-014) are moved to `RESOLVED` (design edited + user-approved) and §D is populated
for the tasks about to run. Enforced by `GATES.md`. **Status 2026-07-13:** all CRITICAL/HIGH/MEDIUM
defects RESOLVED and §D populated; the sole remaining G4 gate is guide reconciliation.

## G. §D population — DONE (2026-07-13)

§D above is now populated (all CRITICAL/HIGH/MEDIUM resolutions landed, so task IDs are stable,
including the deep-review additions 2.8/2.9/2.10, 5.6/5.7/5.8, 8.6, 11.4, 12.7, 13.7/13.8). This
placeholder is retired; see **§D** for the authoritative Design→Task→Test matrix.
