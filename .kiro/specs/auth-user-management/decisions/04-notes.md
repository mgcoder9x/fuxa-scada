# 04 — Notes the future AI/human should know

> Facts, environment details, risks, and gotchas. Facts only. Anything not directly
> verified is marked `UNVERIFIED`. Schema in `README.md` §3.

### N-001: Runtime environment (verified 2026-07-12)
- Status: Active
- Statement:
  - OS: Windows, shell used by the agent: PowerShell (note: repeated multi-line console output was observed being truncated in this environment — prefer writing results to a file and reading them back).
  - Node.js: **v25.2.1**; npm **11.6.2** (verified via `node --version`).
  - FUXA version: **1.3.4-2860** (verified in `server/package.json`).
  - The workspace is **NOT a git repository** (verified: `git` reported "not a git repository"). It was obtained as a ZIP, not `git clone`.
- Impact / Risk: FUXA's Dockerfile targets **Node 18**; running on Node 25 is unverified for long-term native-module stability (`sqlite3`, `serialport`). Installed and ran successfully on 2026-07-12, but this is a version mismatch to watch.

### N-002: How the app is currently run (verified 2026-07-12)
- Status: Active
- Statement: FUXA runs directly via Node — `node main.js` in `server/` — serving the prebuilt Angular client from `client/dist`. Server logged "WebServer is running http://127.0.0.1:1881/" and returned HTTP 200. Docker was intentionally removed (disk pressure); see N-004.
- Impact / Risk: Server is bound to `127.0.0.1` (localhost only) — fine for building UI, NOT reachable from other machines until reconfigured.

### N-003: Where user-created data lives vs. code (verified 2026-07-12)
- Status: Active
- Statement: Runtime data (projects/views, users, DAQ) is stored outside source code — `dbDir: '_db'`, `logDir: '_logs'` (verified in `server/settings.default.js`), under an appdata path resolved via `FUXA_APPDATA`/`APPDATA` (verified in `server/paths.js`). Source-code edits are separate and are the part that needs version control to survive FUXA upgrades.
- Impact / Risk: This distinction is central to the user's upgrade concern: data survives upgrades; custom code needs git-based merge.

### N-004: Disk pressure on C: (verified 2026-07-12)
- Status: Active
- Statement: C: had ~14 GB free of ~237 GB. A 14.88 GB WSL **Ubuntu** distro (the user's own, NOT Docker) is a major consumer (verified via Lxss registry). Docker Desktop was fully removed; its footprint was negligible and was not the cause of low disk.
- Impact / Risk: If a Docker-based path is revisited later, ~2–4 GB must be freed first.

### N-005: FUXA existing auth code to reuse (verified by design subagent 2026-07-12)
- Status: Active
- Statement: Relevant existing files — `server/api/auth/index.js` (JWT sign-in/refresh/sign-out), `server/api/jwt-helper.js` (verify, guest & admin groups using group codes such as -1 and 255), `server/runtime/users/index.js` (user/role storage; roles held in the user `info` object).
- Impact / Risk: The module wraps these behind interfaces (D-001/D-002). The group-code scheme (-1/255) is a FUXA convention to reconcile with the new RBAC model — flag for design.

### N-006: User's working principles (contract for every session)
- Status: Active
- Statement: (1) Design clearly, re-validate, then implement. (2) Every recommendation needs a precise, factual reason. (3) Fix root causes, not symptoms. (4) No fabrication/speculation; validate repeatedly. (5) Do not economize tokens at the cost of correctness. (6) Maintain this ledger throughout.
- Impact / Risk: Violating these is itself drift. Re-read at session start.

### N-007: FUXA seeds a default admin with a known weak password and NO forced rotation (verified 2026-07-12)
- Status: Active — CRITICAL SECURITY FINDING; drives REQ-17
- Links: REQ-17, D-005/DV-004, section 12 (admin bootstrap), section 03
- Statement: VERIFIED in `server/runtime/users/usrstorage.js` — `setDefault` seeds the first administrator with `bcrypt.hashSync('123456', 10)`, i.e. the well-known password "123456", and FUXA does NOT force a password change on first login.
- Impact / Risk: A fresh FUXA instance ships with a guessable admin credential that stays valid indefinitely — a real, exploitable weakness for any exposed deployment. This is exactly the root cause REQ-17 (auto-seed + MANDATORY rotation, P-009) is designed to eliminate. Section 12 must ensure the seeded admin cannot perform any protected action until rotation (AC-17.2).
- Verification: section 12 design + P-009 test; also cross-check the module's bootstrap does not reuse the literal '123456'.

### D-008: bcrypt cost factor = 12 (configurable), with optional upgrade-on-verify rehash
- Date: 2026-07-12
- Phase: Design (section 03)
- Status: Active
- Links: REQ-4, D-002, N-007
- Context: VERIFIED — FUXA hard-codes bcrypt cost 10 (`bcrypt.hashSync(pwd, 10)`), not configurable.
- Statement: The Password_Hasher uses a configurable cost (`settings.auth.bcryptCost`) defaulting to 12 (>= FUXA's 10). Because bcrypt embeds cost in the digest, legacy cost-10 hashes still verify; an optional upgrade-on-verify re-hashes to 12 on successful sign-in. Property tests run at cost 4 for speed.
- Rationale: 12 is a contemporary recommended work factor (tens of ms/hash), strictly >= existing hashes so nothing is weakened; embedded-cost means no bulk migration needed.
- Alternatives considered: Keep 10 (rejected: weaker than current best practice); force immediate bulk re-hash (rejected: cannot re-hash without plaintext — upgrade-on-verify is the only plaintext-free path).
- Impact / Risk: Slightly higher sign-in CPU; negligible at 12. Test-cost 4 must never leak into production config.
- Verification: §3.3; example test asserts unconfigured seam produces cost-12 digests and that a cost-10 digest still verifies.

### N-008: Verified FUXA group-code semantics — corrects a loose phrasing in the master map
- Status: RESOLVED 2026-07-12 — master map (design.md) corrected to match section 05 §5; both now state -1/255 = admin, 'guest'/absent = guest.
- Links: REQ-10, section 05 §5.1, design.md reconciliation section
- Statement: VERIFIED in `server/api/jwt-helper.js` and `usrstorage.js` — numeric group codes `-1` AND `255` are BOTH admin (`adminGroups = [-1, 255]`); the seeded default admin uses `groups = -1` (integer). A GUEST is the string `'guest'` (or an absent token: `getGuestToken` signs `{ id:'guest', groups:['guest'] }`, `isGuestUser` checks `'guest'`), NOT numeric `-1`.
- Impact / Risk: The master map (design.md) reconciliation bullets list `-1` under BOTH admin and guest — contradictory and incorrect. Section 05 uses the verified meaning (`-1`/`255` = admin; `'guest'`/absent = guest). The master map must be corrected so source-of-truth documents agree (anti-drift).
- Verification: after correction, design.md and section 05 §5 must state identical group-code semantics.

---

## Deep design-review findings (2026-07-13) — verified defects in the DESIGN (pre-implementation)

> These entries record defects found by re-reading the design against the actual FUXA source
> **before any implementation**. Each is a verified fact (file + section cited), not speculation.
> The proposed root-cause resolutions are logged as OPEN decisions D-014…D-023 (`01-ai-decisions.md`)
> and their trade-offs as TO-007…TO-011 (`03-tradeoffs.md`). Nothing here has been fixed yet —
> these gate implementation via `GATES.md`.

### N-010: Persistence atomicity is self-contradictory and infeasible as specified (CRITICAL)
- Date: 2026-07-13
- Phase: Design (§06)
- Status: **RESOLVED 2026-07-13** — fixed by D-016 option (a); `design/06` §5.2/§5.3/§5.4 rewritten so the full row (incl. verbatim password) is one transaction on the adapter's own connection, and the cache refresh via `setUsers(password omitted)` is an idempotent best-effort step outside that transaction. The unsatisfiable "two-connection single transaction" requirement is retired.
- Links: REQ-13, AC-13.1, D-010, §06 §5.2, §06 §5.4
- Statement: VERIFIED contradiction inside design §06. §5.2 chooses to persist a user in **two writes on two different SQLite connections** — non-secret columns via FUXA's `runtime.users.setUsers` (FUXA's own connection) and the `password` column verbatim via the adapter's **own** `sqlite3.Database` connection. §5.4 then requires "The two writes SHALL execute within a single transaction ... `BEGIN…COMMIT`". **Two separate SQLite connections cannot share one transaction**, so §5.4 is unsatisfiable by the §5.2 mechanism. The guide (`02-task-2-luu-tru.md`) honestly admits this ("không gói chung 1 transaction được") — confirming the root cause is the design, not the guide.
- Impact / Risk: A crash between the two writes can leave a user row with a NULL/stale password, fresh metadata but old password, or a cache updated while the DB password is not — none of which is acceptable for IAM. "Rare and self-healing" (guide) is not a sufficient guarantee for credentials.
- Root cause: the "verbatim password write via a second connection" (chosen to dodge FUXA `setUser`'s re-hash, D-010) is fundamentally incompatible with single-transaction atomicity.
- Verification: read §06 §5.2 vs §5.4; confirm the two-connection mechanism; a resolution must show a single transactional write path (D-016).

### N-011: Request authority is derived from token claims, not the live account (CRITICAL)
- Date: 2026-07-13
- Phase: Design (§05, §02, §12)
- Status: **RESOLVED 2026-07-13** — fixed by D-015 option (1); `design/05` §4.1 now builds Identity from the live `getUserCache(username)` record (reject if missing; roles/groups/mustRotate from the record) and checks `tokenVersion`; `design/02` §3 marks token `roles`/`groups` as compat-only (not authority) and adds `tokenVersion`. The §05↔§12 contradiction is removed. Residual: active-revocation of the *access* token between version bumps still relies on the (short) TTL; full logout/disable bump points are follow-ups noted in D-015.
- Links: REQ-2, REQ-10, D-007, §05 §4.1, §02 §3, §12 §2.1
- Statement: VERIFIED — §05 §4.1 builds the request `Identity.roles` from the token `roles` claim and `groups` from the token; only `mustRotate` is read fresh from the store (§12 §2.1 / §05 middleware). Consequences: a **deleted** user (`userStore.get()` empty) still has token-carried `groups=-1`/roles honored; a **disabled**, **role-removed**, or **group-downgraded** user keeps prior authority **until the access token expires** (and refresh can extend it). This directly contradicts §12 §2.1's own claim that the module "resolves roles/permissions from stored state rather than trusting a long-lived token snapshot" — that claim is only true for role→permission mapping, NOT for role assignment, group code, or account existence.
- Impact / Risk: Revocation (delete/disable/downgrade) does not take effect until token expiry — unacceptable for a commercial IAM. Also an internal design inconsistency (self-contradiction between §05 and §12).
- Root cause: JWT treated as an authority snapshot instead of an identity/session reference.
- Verification: read §05 §4.1; confirm roles/groups sourced from `verify().claims`; resolution must re-resolve from the live account each request + support active revocation (D-015).

### N-012: Property P-002 is mathematically false for bcrypt >72-byte inputs; §03 asserts the opposite
- Date: 2026-07-13
- Phase: Design (§03)
- Status: **RESOLVED 2026-07-13** — fixed by D-017 option (1) + DV-007. `design/03` §2.2 retracts the false "unaffected" claim and bounds the domain to ≤72 UTF-8 bytes; §7 restates P-002 over that domain; the >72-byte case is now a validation-rejection (AC-4.6), tested separately; `requirements.md` gained AC-4.6/AC-4.7; a `hashScheme` version marker is reserved for a future Argon2id migration. Enforcement site: `User_Service` validation (`design/04` §2.3).
- Links: REQ-4 (AC-4.5), P-002, §03 §2.2, §03 §7
- Statement: VERIFIED — bcrypt truncates input at 72 bytes. P-002 states "for any two distinct plaintexts A≠B, `verify(B, hash(A))` is false." For A,B that share their first 72 bytes but differ afterward, bcrypt sees identical input ⇒ `verify(B, hash(A)) = true`, violating P-002. §03 §2.2 explicitly (and incorrectly) claims "Both hash and verify see the same truncation, so the round-trip (P-001) and rejection (P-002) properties are unaffected." The rejection property IS affected. The guide's P-002 test (`03-task-3` task 3.4) even biases "near-duplicates", so it could surface this failure.
- Impact / Risk: A stated correctness property is false; a PBT built to it can fail or, worse, be weakened to pass. No password length policy, no blocklist/compromised-password check exists either.
- Root cause: bcrypt's documented 72-byte truncation not reflected in the property's domain.
- Verification: reproduce with `a`×72+`X` vs `a`×72+`Y`; resolution bounds the domain and/or changes the KDF (D-017/TO-007).

### N-013: The bootstrap gate's sole-allowed operation (`account.rotatePassword`) has no API route in the design
- Date: 2026-07-13
- Phase: Design (§12, §13, master map physical layout)
- Status: **RESOLVED 2026-07-13** — D-018: `POST /api/account/rotate-password` added in `design.md` (API Composition section) + `design/12` §4.1; composition root instantiates + mounts `Account_Service`. The bootstrap deadlock is removed.
- Links: REQ-17 (AC-17.2, AC-17.3), §12 §4, §05 §2.2
- Statement: VERIFIED — §12 §4 fully specifies the `rotatePassword` service operation and §05 §2.2 lists the `account.rotatePassword` permission, but **no router exposes it**: the master-map physical layout lists only `authentication.router.js`, `users.router.js`, `roles.router.js`; the Error-Handling table and §13 define no rotate endpoint. A seeded/migrated admin is set `mustRotate=true` and is therefore denied every protected operation except a rotation it has **no way to invoke over HTTP** ⇒ functional deadlock designed-in, not merely a guide omission.
- Impact / Risk: First-run and post-migration admins cannot become usable; REQ-17's whole purpose is defeated.
- Root cause: the gate exception was specified at the service layer but never given an API surface.
- Verification: search routers/error-table for a rotate endpoint (absent); resolution adds and wires it (D-018).

### N-014: Router cutover is unspecified; the module reuses FUXA's URLs and would be shadowed
- Date: 2026-07-13
- Phase: Design (composition root / §13)
- Status: **RESOLVED 2026-07-13** — D-014 option 1 (SUPERSEDE): `design.md` "API Composition Root & Cutover Strategy" specifies not mounting FUXA `usersApi`/`authApi` for the overlapping paths and mounting the module router after `authLimiter`; P-014 asserts the module (not a residual FUXA handler) serves those URLs. Client cutover (D-011) must land together.
- Links: REQ-16, D-003, D-011, `server/api/index.js`
- Statement: VERIFIED — FUXA registers `/api/signin`, `/api/refresh`, `/api/signout` (in `server/api/auth/index.js`) and `/api/users`, `/api/roles` (in `server/api/users/index.js`), all mounted in `server/api/index.js` BEFORE any module router would mount. The module reuses the SAME URLs. The design says "SUPERSEDE" (D-011) and "one-line mount" but never specifies **removing/gating FUXA's overlapping routers or choosing a new namespace**. With the guide's mount-after approach, Express ends the response in FUXA's handler ⇒ the module's RBAC middleware/services never execute for signin, list/create users, list/create roles. (Param routes like `PUT /api/users/:username` are not shadowed, but the primary operations are.)
- Impact / Risk: Login runs old FUXA logic; RBAC/audit/mustRotate do not protect the endpoints; the module can "pass unit tests" while the running system is unchanged.
- Root cause: design under-specified the cutover/precedence at the single composition-root mount point.
- Verification: read `server/api/index.js` mount order; resolution fixes precedence or namespace (D-014).

### N-015: "Refresh-token rotation" is stateless — the old refresh token is never invalidated
- Date: 2026-07-13
- Phase: Design (§02)
- Status: **RESOLVED 2026-07-13** — fixed by D-019: `design/02` §6 now uses a server-side `Refresh_Token_Store` (hashed-at-rest, family/jti/parent_jti/state), atomic consume-and-rotate, RFC 9700 reuse detection with full-family revocation, and family revocation on sign-out/password-change/disable + `tokenVersion` check. Property P-015 added. A leaked refresh token is now single-use and its replay kills the family.
- Links: REQ-3 (AC-3.2, AC-3.3), §02 §6.2, §02 §7, RFC 9700
- Statement: VERIFIED — §02 reuses FUXA's stateless refresh "verbatim". On a "rotation", a new access + new refresh token are issued, but the OLD refresh JWT remains valid until its (default 7-day) expiry: there is no server-side store of `jti`/family/used-state and no revocation. §02 §7 claims "rotation limits refresh-token replay", which overstates the protection — a stolen refresh token replays for up to 7 days, and sign-out only clears the browser cookie (does not invalidate a stolen token).
- Impact / Risk: The long-lived credential cannot be revoked; logout and compromise response are ineffective; no replay/reuse detection (RFC 9700 unmet).
- Root cause: refresh treated as stateless JWT with no server-side family/used tracking.
- Verification: §02 §6.2 shows no token store; resolution adds a refresh-token store with reuse detection (D-019).

### N-016: Concurrency — last-admin guard and duplicate-create are non-atomic (TOCTOU), even single-process
- Date: 2026-07-13
- Phase: Design (§04, §05)
- Status: **RESOLVED 2026-07-13** — fixed by D-020 at the DB layer: create uses plain `INSERT` (PK conflict = atomic duplicate rejection), last-admin guard runs in a `BEGIN IMMEDIATE` transaction (SQLite write-lock serialization). Property P-016 added over interleaved histories. Residual: true multi-process HA needs D-016(b) (flagged).
- Links: AC-8.5, AC-5.2, AC-9.5, P-010, §04 §3.2, §04 §6.5, §05 §3.3
- Statement: VERIFIED design pattern — both invariants use read-then-act with `await` boundaries and no lock/transaction/DB-constraint:
  - Last-admin (§04 §6.5): `await get` → `await readAll`+count → `await delete`. Two concurrent DELETEs of the two last admins can BOTH pass the count guard before either deletes ⇒ zero admins. This interleaving is possible **even in a single Node process** because each `await` yields the event loop. P-010 only tests **sequential** deletion sequences, so it cannot catch this.
  - Duplicate-create (§04 §3.2 / §05 §3.3): `await get`(=none) → `INSERT OR REPLACE`. Two concurrent creates of the same username both pass the pre-check, then overwrite each other (FUXA uses `INSERT OR REPLACE`, not atomic `INSERT`).
- Impact / Risk: Zero-admin lockout; create overwrite. The design never states a single-writer assumption nor provides atomicity.
- Root cause: invariants enforced by an application-level pre-check instead of an atomic persistence command / unique constraint / advisory lock; property only covers sequential histories.
- Verification: model an interleaved two-request scenario; resolution enforces the invariant atomically + adds a concurrency property (D-020).

### N-017: JWT profile is not hardened; access tokens are not actively revocable
- Date: 2026-07-13
- Phase: Design (§02, §03)
- Status: **RESOLVED 2026-07-13** — D-021: `design/02` pins `algorithms` on verify, adds+validates `iss/aud/sub/jti/typ`, adds `kid` for key rotation (§3/§5/§7). Active access-token revocation is provided by D-015's `tokenVersion` (re-checked each request) + `jti` for point revocation/audit. The alg-confusion and missing-registered-claims gaps are closed.
- Links: REQ-2, §02 §3, §02 §5, RFC 8725
- Statement: VERIFIED — the design/adapter uses `jwt.sign`/`jwt.verify` without pinning `algorithms` (alg-confusion risk), and the token carries only `{ id, groups, roles, iat, exp }` — no `iss`, `aud`, `sub`, `jti`, explicit `typ`, or key id for rotation (RFC 8725 controls). Sign-out clears only the cookie; a minted access token stays valid until `exp` (no revocation list / version check).
- Impact / Risk: Weaker token verification; no way to invalidate an issued access token on logout/compromise before expiry.
- Root cause: minimal FUXA-compatible claim set kept without adding modern JWT hardening.
- Verification: §02 §3 claim table; resolution pins alg + adds registered claims + revocation hook (D-021 + D-015).

### N-018: The one-time bootstrap secret is disclosed to the server console/log by design
- Date: 2026-07-13
- Phase: Design (§12)
- Status: **RESOLVED 2026-07-13** — fixed by D-022 (option (b)+(a)): `design/12` §3.2 no longer emits the secret to console/log; the initial/rotated secret is delivered via a dedicated secure enrollment channel (interactive first-run CLI default; one-time short-TTL hashed-at-rest single-use enrollment token for automated provisioning). §3.4 diagram + §8 migration + a new §10.4 security test (no plaintext/token reaches `runtime.logger`/console; token single-use + TTL) updated. Ledger synced.
- Links: REQ-17, §12 §3.2, guide `11-task-13-api.md`
- Statement: VERIFIED — §12 §3.2 prescribes disclosing the seeded one-time secret "written to a permission-restricted file under the FUXA appdata/`logDir` boundary **and emitted a single time to the server console/log** at startup". Writing a live credential to the console/log is credential disclosure (logs are backed up, shipped, read by support/operators). The guide is worse (logs plaintext via `runtime.logger.info`), but the design itself already sanctions console/log disclosure — inconsistent with the "no plaintext logging" posture stated elsewhere.
- Impact / Risk: Credential leakage via logs; the exact out-of-band-secure-channel claim is not met by a log line.
- Root cause: no secure enrollment channel designed; log/console used as the disclosure path.
- Verification: §12 §3.2 wording; resolution replaces with a secure enrollment mechanism (D-022).

### N-019: Brute-force state is per-process and uses a hard lock — weak for HA and DoS-prone
- Date: 2026-07-13
- Phase: Design (§10)
- Status: **RESOLVED 2026-07-13** — fixed by DV-008 + the D-023 grouping in `design/10`: (1) pluggable `BruteForceStore` seam (in-memory default; shared store e.g. Redis for horizontal scaling with atomic read-modify-write) so the effective threshold is not multiplied per node (AC-15.6); (2) adaptive throttling (exponential backoff, bounded by `maxThrottleMs`) replaces the hard fixed lock, resisting attacker-induced lockout of a legitimate operator (AC-15.2/15.6); (3) monotonic injected clock replaces `Date.now()` so a forward wall-clock/NTP jump cannot end a throttle early (§6 clock-drift policy). Ledger + P-012 synced.
- Links: REQ-15 (AC-15.1–15.5), §10, P-012
- Statement: VERIFIED design intent — the brute-force guard is an **in-memory per-username state machine** with an injected clock. Two consequences: (1) with multiple server instances the counter is per-process, so the effective threshold is multiplied by the number of nodes; (2) a hard lockout for the configured duration lets an attacker who knows a username **lock out the legitimate user** (targeted DoS). Lockout timing uses `Date.now()` with no clock/NTP-drift policy (a forward clock jump can end a lockout early).
- Impact / Risk: Ineffective throttling under horizontal scaling; user-targeted DoS; clock-drift edge.
- Root cause: local in-memory state + hard lock instead of shared store + adaptive throttling (NIST SP 800-63B rate-limiting guidance).
- Verification: §10 state model; resolution: shared/pluggable store + adaptive delay option (tracked with D-023 grouping).

### N-020: INTEGRITY INCIDENT — `03-tradeoffs.md` was overwritten with a chat transcript
- Date: 2026-07-13
- Phase: (ledger maintenance)
- Status: Active — remediated (file rebuilt) + prevention added
- Links: `decisions/03-tradeoffs.md`, `decisions/00-INDEX.md`, `decisions/GATES.md`
- Statement: VERIFIED — on 2026-07-13 the trade-offs ledger file was found to contain an unrelated chat transcript instead of TO-* entries; the original content was destroyed and (workspace is not git, N-001) unrecoverable from VCS. TO-001/002/004/005/006 were reconstructed from surviving cross-references; TO-003 was unrecoverable and is quarantined.
- Impact / Risk: Loss of decision provenance is itself drift. This is the concrete failure the anti-drift kit must prevent going forward.
- Root cause: no integrity manifest / no protection against whole-file overwrite of ledger files.
- Verification: `00-INDEX.md` now declares each file's required purpose/markers; `GATES.md` requires an integrity check every phase transition; the steering file forbids overwriting ledger files (append-only).

### N-021: traceability §D (Design→Task→Test) is still empty although tasks.md exists
- Date: 2026-07-13
- Phase: Tasks
- Status: Active — OPEN gap
- Links: `traceability.md` §D, tasks.md
- Statement: VERIFIED — `traceability.md` §D is still the placeholder "_pending — populated when tasks.md is generated_" even though `tasks.md` exists with tasks and a dependency graph. The bidirectional map is therefore not closed on the Task→Test side, and P-010/P-011/P-012 (confirmed 2026-07-12) have no test-mapping row.
- Impact / Risk: The anti-drift engine's core artifact is incomplete; drift between design, tasks, and tests is not detectable until §D is filled.
- Root cause: §D not populated at the Design→Tasks transition (the protocol step was skipped).
- Verification: §D must list every DES-* → its TASK-* → its test/property; resolution is part of the pre-implementation gate (GATES.md G3).

### N-022: Node dependencies are NOT installed in the current workspace — audit dedicated-file path verified only via its fallback (verified 2026-07-13)
- Date: 2026-07-13
- Status: **RESOLVED (superseded for verification purposes by N-023)** — `server/node_modules` is now
  PRESENT (verified 2026-07-13: `winston`, `bcryptjs`, `jsonwebtoken`, `mocha`, `sinon`,
  `fast-check@3.23.2`, `sqlite3` all resolve). The "deps absent → runtime verification deferred"
  limitation below no longer holds. The deferred runtime checks it lists (task 11.4 dedicated-file
  separation + async transport-`error` health path; and the cost-4 hash / real-crypto round-trip
  checks deferred by tasks 3.1/5.1) are now RUNNABLE and MUST be run to close the corresponding
  G5 DoD rows in traceability §D. Kept (not deleted) as the provenance of why those rows were
  initially marked "verified via node sanity only".
- Phase: Implementation (task 11.1)
- Original status: Active — verification limitation (not a code defect)
- Links: task 11.1, D-023, `design/09` §6.2/§10.3/§10.4, N-004 (disk pressure), N-001, N-023
- Statement: VERIFIED — there is no `server/node_modules` and `winston` does not resolve anywhere in the workspace (`require.resolve('winston')` throws; a recursive search found no `winston` package dir). FUXA had been installed on 2026-07-12 (N-001/N-002) but the dependency tree is currently absent (consistent with the N-004 disk-pressure cleanup). Consequence for task 11.1: `createFuxaAuditSink` could not construct the real module-owned winston `File` transport at `${logDir}/fuxa-audit.log`, so its D-023 **fallback** path engaged — audit is routed through the shared `fuxaLogger.info(line, true)` and `health()` reports `{ ok:true, degraded:true, fallback:true, lastError:'dedicated_transport_unavailable: Cannot find module winston' }`. All 20 `node` sanity checks passed, including: valid event → one `AUDIT `+JSON line with only supplied keys; richer optional fields (actor/target/sourceIp/device/sessionId/correlationId/changes[]) copied while secret/unknown keys (password/passwordHash/token/injected) are dropped; malformed event (missing subject) writes an internal diagnostic and emits no normal line without throwing; a sink whose `write` throws does not propagate out of `record()`; and a dedicated sink whose transport write throws flips `health().ok=false` with `lastError` and writes a FUXA error-channel diagnostic without throwing.
- Impact / Risk: The **dedicated-file separation** assertions (§10.4 item 1: audit lines land in `fuxa-audit.log` and NOT `fuxa.log`; independent rotation) and the real winston async transport-`error` health path cannot be exercised until `npm install` is run under `server/`. The implemented behavior for that path is code-reviewed and structurally correct (own `File` transport, own `maxsize`/`maxFiles`, `dedicated.on('error', …)` health hook), but is UNVERIFIED at runtime in this environment. Task 11.4 (the dedicated-sink/health/hash-chain test task) MUST be run after dependencies are installed to close this.
- Verification: after `npm install` under `server/`, re-run task 11.4 and confirm two `AUDIT ` lines appear in `${logDir}/fuxa-audit.log` (and none in `fuxa.log`) and that `health().fallback` is falsy on the dedicated path.


### N-023: Test toolchain reality — chai@5 is ESM-only; module tests use `node:assert`; fast-check added
- Date: 2026-07-13
- Phase: Implementation
- Status: Active
- Links: design.md Testing Strategy, N-022
- Statement: VERIFIED after `npm install` under `server/` (659 packages, Node v24.15.0): `mocha@10.8.2`, `chai@5.1.2`, `sinon@19.0.2`, `bcryptjs`, `jsonwebtoken`, `winston`, `sqlite3` are present, but (a) **`fast-check` was NOT installed** — the design's Testing Strategy mandates it for PBT, so it was added as a **devDependency pinned to `fast-check@3.23.2`** (`npm install -D`); and (b) **`chai@5` is ESM-only**, so the guide's `const { expect } = require('chai')` pattern fails under CommonJS mocha. Decision: the module's server-side tests use Node's built-in **`node:assert`** (CommonJS, zero-dep) for assertions plus `sinon` for doubles and `fast-check` for properties, instead of chai. This is a test-implementation choice only; it does not change any production code or design contract.
- Impact / Risk: Guide test snippets that import chai must be adapted to `node:assert` when implemented (the guide is non-normative). Editing `server/package.json` to add a pinned devDependency is a build-config change (not FUXA business logic), consistent with the D-003 boundary and the design's explicit fast-check choice. Node is v24.15.0 here (earlier N-001 recorded v25.2.1 on a different check) — native modules (`sqlite3`) installed cleanly.
- Verification: `node -e "require('fast-check')"` resolves 3.23.2; property tests run under mocha with `node:assert`.


### N-024: Independent on-disk verification pass (G4 re-validated) + anti-drift hardening
- Date: 2026-07-13
- Phase: Verification / ledger maintenance
- Status: Active
- Links: GATES.md (G4/G5), 00-INDEX §2/§3, N-020, N-022, N-023, traceability §D/§F
- Statement: VERIFIED — an independent verification pass re-validated the "G4 PASSED" state by
  reading the actual artifacts on disk (not trusting the ledger's self-report), per README §4.4
  ("verify, don't assume"):
  - **Design edits physically present:** D-022 secure enrollment (`design/12` §3.2/§8/§10.4),
    D-023 dedicated append-only audit sink + `health()` (`design/09` §6.2/§7/§10.4), DV-008+N-019
    adaptive backoff + pluggable `BruteForceStore` + monotonic clock (`design/10` §2.1/§3/§5/§6),
    DV-006 uniform-401 + dummy-hash timing (`design/01` §2.2/§3/§7/§8).
  - **Requirements edits present:** AC-1.2/1.3/8.4 (DV-006), AC-4.6/4.7 (DV-007), AC-15.2/15.6 (DV-008).
  - **Tasks present:** 2.8/2.9/2.10, 5.6/5.7/5.8, 8.6, 11.4, 12.7, 13.7/13.8. **Guide banners present**
    ("⚠️ ĐỐI CHIẾU") in every affected guide + `guide/README.md` table.
  - **Implemented code matches the CORRECTED design** (not the pre-review defective version):
    `services/brute-force.js` (adaptive exp-backoff `base·factor^k` capped by `maxThrottleMs`,
    pluggable `InMemoryBruteForceStore` seam, `performance.now()` monotonic clock via `perf_hooks`,
    `threshold===0` fail-closed, lazy eviction) and `services/audit-logger.js` (module-owned winston
    `File` at `${logDir}/fuxa-audit.log` with independent rotation, observable `health()`, async
    transport-`error` handler, fallback-with-degraded-health, optional hash-chain, secret-free
    allow-list copy, non-throwing `record`). All files the ledger marks implemented exist on disk
    (no phantom implementation).
- Drifts found and corrected this pass (root-cause: ON-EXIT §2/status updates skipped earlier):
  1. `00-INDEX.md` §2 high-water notes still labelled D-014…D-023 / DV-006…DV-008 as "OPEN" →
     corrected to **Active (CONFIRMED)** (they are all enacted; no OPEN decision/deviation remains).
  2. `N-022` ("deps absent → runtime verification deferred") was stale — `server/node_modules` is
     **PRESENT** (verified: `winston`, `bcryptjs`, `jsonwebtoken`, `mocha`, `sinon`,
     `fast-check@3.23.2`, `sqlite3` all resolve). N-022 marked RESOLVED (superseded by N-023); its
     deferred runtime checks (tasks 3.1/5.1/11.1 runtime, 11.4 dedicated-sink/health) are now RUNNABLE.
- Anti-drift hardening added this pass: an **automatic, read-only `fileEdited` integrity guard**
  ("Auth Module — Save-Time Integrity Guard") that runs the fast Integrity Check whenever a
  `decisions/**`, `design/**`, `requirements.md`, or `tasks.md` file is saved — closing the exact
  gap that let N-020 (a silent ledger overwrite) go undetected. The steering file was updated from
  the G4-blocked state to the current G5 state (a stale steering file is itself a drift vector).
- Impact / Risk: the "G4 PASSED / implementation unblocked under G5" state is now independently
  verified, not merely asserted. Residual: the now-runnable deferred runtime tests should be
  executed to flip the corresponding traceability §D rows to `tested`.
- Verification: re-run the `userTriggered` "Auth Module — Anti-Drift Audit" hook; re-read the cited
  files; `Test-Path server/node_modules/<pkg>` for each dependency above.

### N-025: On this machine `fast-check` was absent at session start (re-added @3.23.2); test-runner gotcha
- Date: 2026-07-13
- Phase: Implementation (test baseline / G5)
- Status: Active
- Links: N-022, N-023, N-024, N-001, traceability §D (P-005), design.md Testing Strategy
- Statement: VERIFIED on disk at the start of this session — although N-023/N-024 assert
  `fast-check@3.23.2` is an installed devDependency, `Test-Path server/node_modules/fast-check`
  returned **False** on this machine (base `server/node_modules` present with `mocha@10.8.2`,
  `sinon`, `bcryptjs`, `jsonwebtoken`, `winston`, `sqlite3`; Node **v25.2.1**, `node.exe` from
  `C:\nvm4w\nodejs`). Root cause: `node_modules` is gitignored (end.md §7), so a checkout carries
  the base install but not necessarily the separately-added `fast-check` devDep. Remediation:
  re-ran `npm install --save-dev fast-check@3.23.2` under `server/` (added 2 packages; version
  re-verified = 3.23.2 — matches the N-023 pin, no drift in the pinned version).
- Test-runner gotcha (VERIFIED, extends N-001): running `npx mocha` from the repo root prompts to
  install `mocha@11.7.6` (npx ignores the server-local `mocha@10.8.2`) and, once launched
  interactively, held/locked the output file so subsequent `>` redirections to the SAME filename
  returned stale content + exit -1 — which masqueraded as a systemic failure. Reliable method:
  run tests from `server/` via Mocha's programmatic API (`new Mocha().addFile(...).run(...)`) or
  `npm test`, and always capture to a FRESH output filename. Plain `node` and file redirection work
  correctly (confirmed: `node -e` prints `v25.2.1`).
- Result: with `fast-check@3.23.2` present, `server/test/auth-management/serialization.test.js`
  runs GREEN — **5 passing** incl. `Property 5 (P-005)` at ≥100 iters (structural-identity
  round-trip) + serialize/deserialize resilience units. P-005 is thus independently re-verified on
  this machine (traceability §D P-005 row already marked TESTED remains valid).
- Impact / Risk: None to the design; this is an environment-provisioning + test-invocation note.
  Future sessions on a fresh checkout MUST `npm install` under `server/` AND confirm
  `fast-check@3.23.2` before running property tests (do not trust the ledger's "present" claim).
- Verification: `Test-Path server/node_modules/fast-check` = True; its `package.json` version =
  3.23.2; re-run the serialization suite via the programmatic runner → 5 passing.

### N-026: `User_Store.get` fails CLOSED on a corrupt `info` (returns the record with empty roles/metadata, does not throw)
- Date: 2026-07-13
- Phase: Implementation (Task 2 — §06)
- Status: Active
- Links: REQ-13 (AC-13.4), §06 §7 (fail-closed error handling), D-015 (store is authority), D-024
- Statement: The design fixes `readAll` resilience explicitly (AC-13.4 — a corrupt row becomes an
  `errors` entry, healthy rows still returned) but does NOT specify the single-lookup `get`'s
  behavior when a row's `info` is unparseable. Implementation decision (`FuxaUserStoreAdapter.get`):
  a corrupt `info` fails **closed** — `get` returns the record with `roles: []` and `metadata: {}`
  (least privilege) rather than (a) throwing or (b) returning `undefined`. Rationale: the user's
  credential columns (`username`/`password`) are still valid, so returning `undefined` would make a
  valid credential spuriously "unknown" (an availability/lockout risk during sign-in); throwing
  would break the sign-in path for one bad metadata blob. Returning the record with **no roles** is
  the safe authorization posture (the account can authenticate but carries zero elevated authority
  until its metadata is repaired), consistent with §06 §7's fail-closed intent and D-015 (authority
  is re-resolved from the store each request, so zero roles = zero privilege).
- Impact / Risk: A user whose stored `info` is corrupted silently loses their role assignments until
  the metadata is fixed (they can still sign in). This is intentional (fail-closed). The corruption
  is still SURFACED via `readAll().errors` (List Users), so an admin can detect and remediate it.
- Verification: `store-adapters.test.js` "resilient readAll … get fails closed" — a directly-inserted
  corrupt `info` row is reported in `readAll().errors` AND `get()` returns it with `roles:[]`/`metadata:{}`;
  no exception propagates.

### N-027: VERIFIED SECURITY DEFECT — bcryptjs burns ~9.6s then throws on a lone-surrogate password (unauthenticated CPU-DoS)
- Date: 2026-07-13
- Phase: Implementation (Task 3.2 — §03), surfaced by the P-002 property test
- Status: **RESOLVED 2026-07-13 by D-025** (Password_Hasher malformed-UTF-16 guard); boundary
  defense-in-depth (User_Service 9.1 / Authentication_Service 7.1) is a follow-up recorded in D-025.
- Links: REQ-4, P-002, D-025, DV-006 (dummy-hash path amplifies it), N-012 (same "bound the bcrypt input domain" class), design/03 §2.2
- Statement: VERIFIED empirically against the vendored `bcryptjs` on this machine (Node v25.2.1,
  `server/node_modules/bcryptjs`). When the input string contains a **lone (unpaired) UTF-16
  surrogate** (a 0xD800–0xDFFF code unit not part of a valid pair — malformed UTF-16), bcryptjs's
  pure-JS UTF-16→UTF-8 encoder takes a pathological path: measured `bcrypt.compareSync(String.fromCharCode(0xD83D), hash)`
  = **9578 ms**, then throws `RangeError: Invalid array length` from `utfx.encodeUTF8`→`out.push(b)`
  (stack: `stringToBytes` → `utfx.UTF16toUTF8` → `encodeUTF8`, `bcrypt.js` lines ~364/524/594/629).
  The slowness is in the ENCODER (before the cost rounds), so it is **cost-independent** (~9.6s at
  cost 4). Reproduction (guarded): a temp probe timing `compareSync(loneHi, hash)` printed
  `9578ms RangeError: Invalid array length`. A single lone surrogate suffices; well-formed astral
  characters (e.g. U+1F600, and even planes-5–16 code points) hash in a few ms — so the trigger is
  *malformedness*, not size or plane.
- Attack surface (verified reachable): a lone surrogate arrives over the login API via
  `JSON.parse('{"password":"\\uD83D"}')` — `JSON.parse` produces a JS string with a lone surrogate.
  The Authentication_Service (Task 7) verifies the submitted password with `Password_Hasher.verify`,
  AND — per DV-006 — runs a **dummy-hash `verify` for UNKNOWN users** to equalize timing. So an
  **unauthenticated** attacker can send `{"username":"nobody","password":"\uD83D"}` and force ~9.6s
  of single-threaded server CPU per request → asymmetric DoS (cheap request, huge server cost),
  trivially amplified by concurrency. The ≤72-byte length check (AC-4.6) does NOT protect:
  `Buffer.byteLength(loneSurrogate,'utf8')` reports 3 (Node substitutes U+FFFD), so the length gate
  passes and bcrypt is still reached.
- Root cause: `bcryptjs`'s encoder mishandles malformed UTF-16; the module fed it a raw JS string
  without a well-formedness guard. We do not edit the vendored `bcryptjs` (D-003), so the fix belongs
  at the module's Hash seam (the single site feeding bcryptjs) + boundary input validation.
- Verification: `test/auth-management/password-hasher.test.js` "malformed UTF-16 … rejected CHEAPLY"
  — three lone-surrogate variants (incl. the `JSON.parse('"\\uD83D"')` form) all return `verify→false`
  in <1000ms total (was ~9.6s each), and `hash` throws `invalid_password_encoding` fast. Also: the
  P-002 property generator was corrected to drop the last CODE POINT (not code unit) so it never
  fabricates a lone surrogate (that mutation bug is what first exposed N-027 as a 30s test timeout).
