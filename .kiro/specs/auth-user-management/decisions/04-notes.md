# 04 — Notes the future AI/human should know

> Facts, environment details, risks, and gotchas. Facts only. Anything not directly
> verified is marked `UNVERIFIED`. Schema in `README.md` §3.

### N-001: Runtime environment — historical old-machine snapshot + current-machine refinement
- Status: Active fact record; 2026-07-12 values are a **historical old-machine snapshot**, not current workspace state
- Historical statement (verified 2026-07-12 on the old machine):
  - OS: Windows; shell: PowerShell. Repeated multi-line console output was observed being truncated in that environment.
  - Node.js: **v25.2.1**; npm **11.6.2**.
  - FUXA version: **1.3.4-2860** (verified in `server/package.json`).
  - That old workspace was **not a git repository** and had been obtained as a ZIP.
- Current-machine refinement (verified 2026-07-14 by local commands):
  - OS: **Windows**; Node.js **v24.15.0**; npm **11.12.1**.
  - The current workspace **is a git repository** on branch **`auth-user-management-spec`**.
  - Docker server is available at **29.5.2**.
  - No GPU is **USER-REPORTED** and was **not independently verified**; GPU availability is irrelevant to the auth-management test baseline.
- Impact / Risk: FUXA's Dockerfile targets **Node 18**; both historical Node 25 and current Node 24 differ from that target, so long-term native-module stability (`sqlite3`, `serialport`) remains a version-mismatch risk even though the current auth-management suite is runnable.

### N-002: How the app was run — historical old-machine snapshot (verified 2026-07-12)
- Status: Historical old-machine snapshot; current runtime start was not re-verified during N-028 remediation
- Historical statement: FUXA ran directly via Node — `node main.js` in `server/` — serving the prebuilt Angular client from `client/dist`. The server logged "WebServer is running http://127.0.0.1:1881/" and returned HTTP 200. Docker had intentionally been removed on that old machine because of disk pressure; see historical N-004.
- Impact / Risk: The historical server was bound to `127.0.0.1` (localhost only). Do not infer the current machine's bind/runtime state from this snapshot without a fresh runtime check.

### N-003: Where user-created data lives vs. code (verified 2026-07-12)
- Status: Active
- Statement: Runtime data (projects/views, users, DAQ) is stored outside source code — `dbDir: '_db'`, `logDir: '_logs'` (verified in `server/settings.default.js`), under an appdata path resolved via `FUXA_APPDATA`/`APPDATA` (verified in `server/paths.js`). Source-code edits are separate and are the part that needs version control to survive FUXA upgrades.
- Impact / Risk: This distinction is central to the user's upgrade concern: data survives upgrades; custom code needs git-based merge.

### N-004: Disk pressure and Docker state — historical old-machine snapshot + current refinement
- Status: Active fact record; disk figures and Docker removal are a **historical old-machine snapshot**
- Historical statement (verified 2026-07-12 on the old machine): C: had ~14 GB free of ~237 GB. A 14.88 GB WSL **Ubuntu** distro (the user's own, NOT Docker) was a major consumer. Docker Desktop had been fully removed; its footprint was negligible and was not the cause of low disk.
- Current-machine refinement (verified 2026-07-14): Docker server **29.5.2** is available. Current free-disk capacity was not re-measured during N-028 remediation. No GPU is **USER-REPORTED**, not independently verified, and irrelevant to the auth-management tests.
- Impact / Risk: Do not carry the historical disk-pressure or Docker-absent assumptions forward as current facts; re-check capacity before any storage-heavy operation.

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

### N-008: Verified FUXA group-code semantics — corrects a loose phrasing in the master map
- Status: RESOLVED 2026-07-12 — master map (design.md) corrected to match section 05 §5; both now state -1/255 = admin, 'guest'/absent = guest.
- Links: REQ-10, section 05 §5.1, design.md reconciliation section
- Statement: VERIFIED in `server/api/jwt-helper.js` and `usrstorage.js` — numeric group codes `-1` AND `255` are BOTH admin (`adminGroups = [-1, 255]`); the seeded default admin uses `groups = -1` (integer). A GUEST is the string `'guest'` (or an absent token: `getGuestToken` signs `{ id:'guest', groups:['guest'] }`, `isGuestUser` checks `'guest'`), NOT numeric `-1`.
- Impact / Risk: The master map (design.md) reconciliation bullets list `-1` under BOTH admin and guest — contradictory and incorrect. Section 05 uses the verified meaning (`-1`/`255` = admin; `'guest'`/absent = guest). The master map must be corrected so source-of-truth documents agree (anti-drift).
- Verification: after correction, design.md and section 05 §5 must state identical group-code semantics.

### N-009: FUXA getRoles has no per-record try/catch — one corrupt role fails the whole batch
- Date: 2026-07-12
- Phase: Design (section 06)
- Status: Active (gap closed by module)
- Links: REQ-13 (AC-13.4)
- Statement: VERIFIED — `server/runtime/users/index.js` getRoles does `JSON.parse(drows[id].value)` with NO try/catch, so a single corrupt role `value` throws and rejects the entire getRoles batch. (By contrast, `removeRoles` and `_loadUsers` DO wrap per-record parse in try/catch — verified.)
- Impact / Risk: In FUXA, one bad role row breaks all role listing. The module's Role_Store.readAll routes every row through the resilient `deserialize`, isolating the bad record (AC-13.4).
- Verification: §4.3 + the roles-gap regression test in §9.2.

---

## Deep design-review findings (2026-07-13) — historical defects, all resolved

> These entries preserve the verified defects found by re-reading the design against the actual FUXA
> source before implementation. Every finding N-010…N-019 and N-021 is now RESOLVED by the cited
> enacted D/DV/design/traceability change. Their original defect statements remain as provenance;
> none is a current implementation gate.

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
- Statement: VERIFIED — on 2026-07-13 the trade-offs ledger file was found to contain an unrelated chat transcript instead of TO-* entries; the original content was destroyed and was unrecoverable from VCS because the **historical N-020 old-machine workspace** was not a git repository. The current transferred workspace is a git repository. TO-001/002/004/005/006 were reconstructed from surviving cross-references; TO-003 was unrecoverable and is quarantined.
- Impact / Risk: Loss of decision provenance is itself drift. This is the concrete failure the anti-drift kit must prevent going forward.
- Root cause: no integrity manifest / no protection against whole-file overwrite of ledger files.
- Verification: `00-INDEX.md` now declares each file's required purpose/markers; `GATES.md` requires an integrity check every phase transition; the steering file forbids overwriting ledger files (append-only).

### N-021: Historical traceability §D gap — resolved at G3
- Date: 2026-07-13
- Phase: Tasks
- Status: **RESOLVED 2026-07-13** — traceability §D is populated and G3 passed
- Links: `traceability.md` §D, tasks.md, `GATES.md` G3
- Historical statement: At discovery time, `traceability.md` §D still contained the placeholder "_pending — populated when tasks.md is generated_" although `tasks.md` already existed; P-010/P-011/P-012 had no test-mapping row.
- Resolution: §D now maps every DES-* to implementation task(s) and test/property task(s), and P-001…P-016 each has an owner. This historical gap is no longer a current gate.
- Root cause: §D was not populated at the original Design→Tasks transition.
- Verification: traceability §D is populated; §E records no orphans; G3 is marked passed in `GATES.md`.

### N-022: Historical dependency-absence verification limitation — resolved; JWT runtime coverage still belongs to Task 5
- Date: 2026-07-13
- Status: **RESOLVED** — the dependency-absence limitation is historical; server dependencies are present on the current machine. Audit dedicated-file/health behavior was subsequently exercised by Task 11.4. **Real JWT cryptographic round-trip behavior is not claimed verified here and remains pending until Task 5.**
- Phase: Implementation (task 11.1)
- Original status: Active — verification limitation (not a code defect)
- Links: task 11.1, D-023, `design/09` §6.2/§10.3/§10.4, N-004 (disk pressure), N-001, N-023
- Historical statement (verified at discovery time): there was no `server/node_modules` and `winston` did not resolve anywhere in that workspace state (`require.resolve('winston')` threw; a recursive search found no `winston` package dir). FUXA had been installed on 2026-07-12 (N-001/N-002) but the dependency tree was absent, consistent with the historical N-004 cleanup. Consequently, task 11.1's `createFuxaAuditSink` could not construct the real module-owned winston `File` transport at `${logDir}/fuxa-audit.log`, so its D-023 **fallback** path engaged — audit routed through the shared `fuxaLogger.info(line, true)` and `health()` reported `{ ok:true, degraded:true, fallback:true, lastError:'dedicated_transport_unavailable: Cannot find module winston' }`. All 20 historical `node` sanity checks passed, including: valid event → one `AUDIT `+JSON line with only supplied keys; richer optional fields (actor/target/sourceIp/device/sessionId/correlationId/changes[]) copied while secret/unknown keys (password/passwordHash/token/injected) were dropped; malformed event (missing subject) wrote an internal diagnostic and emitted no normal line without throwing; a sink whose `write` threw did not propagate out of `record()`; and a dedicated sink whose transport write threw flipped `health().ok=false` with `lastError` and wrote a FUXA error-channel diagnostic without throwing.
- Historical impact / risk: At discovery time, dedicated-file separation and the real winston async transport-error path could not be exercised. That audit limitation is now closed: `audit-logger.test.js` exercises the dedicated `fuxa-audit.log` transport and health behavior. The separate JWT real-crypto coverage was never established by N-022 and remains pending under Task 5.
- Verification: current full auth-management baseline includes the audit tests. **UPDATE 2026-07-14 (N-031):** Task 5.2/5.6 landed `token-service.test.js` with REAL HS256 crypto — P-007 (@200 iters, 4 quadrants) and P-008 (@200 iters) now exercise the actual `jsonwebtoken` sign/verify round-trip, closing the N-022 real-crypto gap **for the access-token path**. **UPDATE 2026-07-14 (N-033): the refresh-token real-crypto round-trip is now verified too** — Task 5.7 landed `refresh-token-store.test.js` (P-015 @120 model-based + all `refresh()` outcome branches, real sqlite + `jsonwebtoken`). The N-022 real-crypto limitation is fully closed for §02 (access + refresh). The only remaining §02 gap is the API-layer HTTP wiring (Task 13).


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


### N-028: G0 integrity failure on machine transfer — ledger domain/order/status drift and embedded Git credential
- Date: 2026-07-14
- Phase: Ledger maintenance / session entry
- Status: **Local remediation complete; post-repair checks PASSED 2026-07-14.** External PAT revoke/rotate remains **USER ACTION REQUIRED / UNVERIFIED**. Implementation may resume under G5 at Task 5.
- Links: `decisions/00-INDEX.md` §1/§4, `01-ai-decisions.md`, `03-tradeoffs.md`, `04-notes.md`, `traceability.md` §E/§F, `GATES.md` G0/G1, `tasks.md`, `end.md`
- Statement: VERIFIED on the transferred workspace before any module-code edit:
  1. `01-ai-decisions.md` violated its declared file domain by containing `TO-006` and `N-009`; `04-notes.md` contained `D-008`. `TO-006` already has an equivalent canonical entry in `03-tradeoffs.md`, while D-008 and N-009 had no canonical copy in their owning files.
  2. The D sequence was not monotonic (`D-004`/`D-005` appeared before `D-003`) and D-005 appeared under two headings (original OPEN proposal + UPDATE), contradicting the no-reuse/monotonic manifest rule despite the UPDATE explicitly superseding the proposal.
  3. `TO-007…TO-011` and section headings in `01-ai-decisions.md`/`02-deviations.md`/`03-tradeoffs.md` still said OPEN, although D-014/D-015/D-017/D-019 and DV-006 plus their design/requirement changes are already Active (CONFIRMED). N-021 and traceability §E/§F still described pre-G3/pre-G4 state although G3/G4 passed.
  4. `tasks.md` checkboxes lagged the verified test status (`6.2/6.3`, `11.3/11.4`) and marked parent 2/9 inconsistently; Task 4 checkpoint remained open despite the historical 42-passing baseline.
  5. The local Git remote URL still contained an embedded GitHub PAT despite `end.md` claiming it had been removed. The URL was immediately replaced locally with `https://github.com/mgcoder9x/fuxa-scada.git` without printing or transmitting the credential. The exposed PAT must be revoked/rotated by the user in GitHub.
- Root cause: historical phase transitions updated the enacted D/DV entries and designs, but did not atomically reconcile all ledger headings/status summaries/checklists; early entries were appended to the wrong ledger files before the strict manifest existed. The handoff trusted those summaries instead of rerunning the full domain/order check.
- Remediation: COMPLETED locally — stable IDs/substance were preserved while D-008/N-009 were relocated, the redundant wrong-domain TO-006 copy was removed (canonical TO-006 retained), D-005 was consolidated, D order restored, TO-007…TO-011 marked DECIDED with exact winners, and derived G1/traceability/tasks/end status reconciled. No requirement/design decision or production/test code was changed. The local remote named `orgin` is a clean HTTPS URL without embedded credentials; external PAT revoke/rotate remains USER ACTION REQUIRED / UNVERIFIED.
- Impact / Risk: The local G0 integrity failure is repaired and the implementation pause is lifted after successful checks. Residual external risk remains: the PAT that appeared in local config may be compromised; changing the URL does not revoke it, and external revocation/rotation is USER ACTION REQUIRED / UNVERIFIED.
- Verification: post-repair heading/domain/status checks passed; `git remote -v` was inspected without printing secrets and the local `orgin` URLs contain no embedded credential; the required full suite command from `server/` exited **0** with **42 passing (3s)**. Task 5 itself remains unstarted.

### N-029: VERIFIED DEFECT — store metadata round-trip loses/mishandles a `__proto__` key (P-003 property failure + latent prototype-manipulation)
- Date: 2026-07-14
- Phase: Implementation / G5 baseline verification (Task 2 — §06)
- Status: **RESOLVED 2026-07-14** — fixed at the root by D-026 (`deserialize` strips `__proto__`; adapters compose with object-spread define-semantics; the P-003/P-005 metadata generators exclude `__proto__`). Full suite green and stable.
- Links: D-026, REQ-13 (AC-13.1/AC-13.3), P-003, P-005, `store/serialization.js`, `adapters/fuxa-user-store.adapter.js`, `adapters/fuxa-role-store.adapter.js`, `design/06` §3.2/§4.2/§9
- Statement: VERIFIED. On independent re-run of the auth-management baseline (the handoff/`end.md` claimed a stable "42 passing"), the run was **41 passing / 1 FAILING**: `store-adapters.test.js` Property 3 (User_Record write→read round-trip, P-003) failed with fast-check `{ seed: 713723753 }`, counterexample `metadata: {["__proto__"]: ""}` — read-back `metadata` was `{}` (the `__proto__` key was lost). The failure was **seed-dependent** (why the handoff's earlier run passed), so the suite was effectively flaky. Root cause, reproduced with `node -e`: `JSON.parse('{"__proto__":""}')` creates an OWN, enumerable `__proto__` data property (parse is pollution-safe), but the adapter reconstructed `metadata` with `Object.assign({}, parsed)` — `Object.assign` uses `[[Set]]`, which invokes `Object.prototype`'s `__proto__` **accessor** on the fresh target: a primitive value is silently DROPPED (`{}`), and — verified separately — a `{"__proto__":{x:1}}` value REASSIGNS the target object's prototype (`Object.getPrototypeOf(out) !== Object.prototype`, `out.x === 1`). The same `Object.assign`-on-parsed-JSON pattern existed in `_composeInfo` (write) and the role adapter's delete-fallback.
- Impact / Risk: (1) a stated correctness property (P-003) was false for a metadata object with a `__proto__` key, and the suite was non-deterministically red; (2) latent prototype-manipulation reading a hostile or FUXA-written `info`/`value` row (narrow — module authority reads roles/permissions from the store, not `metadata`, per D-015 — but unacceptable for a commercial IAM). This falsifies the handoff's "42 passing" as an unconditional claim.
- Root cause: rebuilding an object from JSON-parsed (untrusted) data with `[[Set]]`-based copying, with no reserved-key hardening for the `__proto__` accessor.
- Verification: after D-026, `deserialize` strips own `__proto__` at every depth and the adapters use object-spread (define-semantics); new deterministic tests pin the guarantee (`serialization.test.js` — top-level/nested strip + no-prototype-reassignment + `constructor`/`prototype` preserved; `store-adapters.test.js` — a stored `info.__proto__` payload reads back clean with untouched prototype). Full auth-management suite: **47 passing, exit 0**, stable across 4 consecutive runs. The `constructor`/`prototype` keys are confirmed NOT stripped (they have no `[[Set]]` accessor and are plausibly legitimate data).

### N-030: Token & Session design-validation pass (pre-Task-5) — 5 latent design defects found and resolved
- Date: 2026-07-14
- Phase: Design validation (§02/§05/§11) — before any Task 5 code
- Status: **RESOLVED 2026-07-14** — all five findings fixed in the design + ledger (D-027, D-028, D-029, TO-012) before implementation; no production/test code changed by this pass. The auth-management test suite is unaffected (still 47 passing) because only design/ledger `.md` files changed.
- Links: DEF-T1..T5, D-027, D-028, D-029, TO-012, D-015, D-021, D-019, `design/02`, `design/05` §4.1, `design/11` §3.1/§3.4/§3.5/§4.3, `server/api/jwt-helper.js`, `server/api/auth/index.js`, `server/auth-management/services/interfaces.js`
- Method: re-read `design/02` line-by-line against `requirements.md` (REQ-2/REQ-3), the governing decisions (D-015/D-019/D-021), and the ACTUAL FUXA source (`jwt-helper.js`, `auth/index.js`) — all FUXA-behavior claims in the design were confirmed accurate. The defects were internal design inconsistencies/gaps, exactly the class the pre-implementation gate exists to catch (cf. the N-010…N-019 deep review).
- Findings (each VERIFIED by the cited location):
  - **DEF-T1 (HIGH):** `design/02` §2.1 `Identity` omitted `tokenVersion` although §3/AC-2.1 require encoding it and `interfaces.js` already declares it → active revocation (D-015) would silently degrade. Fixed by **D-027**.
  - **DEF-T2 (HIGH):** D-021's `kid` "rotation with overlap window" is infeasible over FUXA's single `secretCode` (no keyring); no requirement mandates rotation. Resolved by **TO-012** (Option A: forward-compat `kid`, single active key, rotation documented as follow-up).
  - **DEF-T3 (MEDIUM):** a parallel `typ` payload claim (checked only on the access path) coexisted with FUXA's `type` (checked on the refresh path); §6.1 listed `type` not `typ`, contradicting §3; `typ` also collides with the JWT header parameter. Fixed by **D-028** (single `type` claim).
  - **DEF-T4 (LOW):** `iss`/`aud` validated but their settings keys were unnamed and unset-behavior undefined (self-reject risk). Fixed by **D-029** (`settings.auth.jwtIssuer`/`jwtAudience`; validate only when configured).
  - **DEF-T5 (HIGH):** `metadata.tokenVersion` was undefined in the §11 data model and the §05 comparison had no absent-value default — `undefined < 1` is `false`, so a legacy token would NOT be revoked after a bump (revocation bypass). Fixed by **D-027** (field default 0 + absent→0 coercion on both sides).
- Impact / Risk: had Task 5 been coded against the pre-pass design, DEF-T1/T5 would have shipped a silent revocation bypass and DEF-T2 a false "rotation" capability. The pass prevented leaf-level rework by fixing the contract/data-model/trade-off at the root first.
- Verification: design edits applied and re-read for consistency (`typ` fully replaced by `type` in §02; `tokenVersion` present in §02 §2.1, §11 §3.1/§3.4/§3.5/§4.3, §05 §4.1 with absent→0 coercion). Integrity Check re-run after the ledger appends. The per-property verification of these fixes is owned by Task 5 (P-007) and Task 8 (P-013) and is explicitly still PENDING — no runtime claim is made here.

### N-031: Task 5 REQ-2 increment — Token_Service issue/verify/expiry + hardening implemented and verified (real crypto)
- Date: 2026-07-14
- Phase: Implementation (Task 5.2/5.3/5.4/5.5-partial/5.6 — §02)
- Status: **DONE for REQ-2** (issue/verify/expiry + D-021/D-027/D-028/D-029 hardening). **REQ-3 (refresh rotation, 5.7/5.8) NOT started** — `refresh()` is an honest `not_implemented` stub, not faked.
- Links: D-021, D-027, D-028, D-029, TO-012, N-022, N-030, REQ-2, P-007, P-008, `server/auth-management/services/token.service.js`, `server/test/auth-management/token-service.test.js`
- Statement: Implemented `services/token.service.js` against the corrected `design/02` — `issueAccessToken` (hardened claim set: `id`/`sub`/`groups`/`roles`/`tokenVersion`/single `type:'access'`/`jti`, `kid` header when configured, `iss`/`aud` only when configured), `issueRefreshToken` (FUXA-compatible `{id,type:'refresh',jti,family_id,tokenVersion}` + returns the ids the store will persist), `verify` (algorithm pinning, `type==='access'`, `iss`/`aud` when configured, closed `VerifyResult` reason mapping missing/expired/bad_signature/malformed/wrong_type), and the §4 expiry decision table (Row1 configured / Row2 finite 3600s default / Row3 dev-only-non-prod no-exp). No FUXA core edited; the service depends only on the injected Token seam (D-003).
- Impact / Risk: REQ-2 is code-complete and property-verified with real crypto. REQ-3 refresh (stateful rotation + reuse detection) is deliberately deferred to keep each increment verifiable; `refresh()` throws `not_implemented` so no caller can mistake it for a working rotation. The service is not yet wired into any router/composition root (Task 13).
- Verification: `token-service.test.js` — **10 passing** incl. P-007 (@200, real HS256, 4 quadrants + claim exposure), P-008 (@200, all 3 expiry rows + §4.1 safety invariants), alg:none rejection, single-`type`/no-`typ`, `iss`/`aud`-when-configured, `kid` header, and the `refresh()` not_implemented guard. Full auth-management suite: **57 passing, exit 0, stable across 3 runs**. Real refresh-path crypto (P-015) remains PENDING (Task 5.7).

### N-032: VERIFIED DEFECT — FuxaAuthDb.transaction() crashed on concurrent transactions (single-connection nesting)
- Date: 2026-07-14
- Phase: Implementation (Task 5.7 — §06 store seam), surfaced by the D-030 CAS concurrency test
- Status: **RESOLVED 2026-07-14** — fixed at the root by an in-process transaction serializer in `FuxaAuthDb.transaction()`; verified by the concurrent-double-consume test + full suite (71 passing, stable).
- Links: `server/auth-management/store/fuxa-auth-db.js`, D-016, D-020, D-030, N-016, REQ-13
- Statement: VERIFIED. `FuxaAuthDb` uses ONE shared sqlite3 connection. Two overlapping `transaction()` calls each issue `BEGIN IMMEDIATE` on that single connection; the second throws `SQLITE_ERROR: cannot start a transaction within a transaction`. Reproduced by firing two `consumeAndRotate` (each a `BEGIN IMMEDIATE` transaction) via `Promise.all`. `BEGIN IMMEDIATE` serializes writers across DIFFERENT connections, but a single connection cannot hold two overlapping transactions, and Node's async interleaving lets two `transaction()` calls overlap. This was latent since Task 2 (the store-adapter tests never exercised concurrent transactions) and would also affect the D-020 last-admin `BEGIN IMMEDIATE` guard (Task 9) under real concurrency.
- Impact / Risk: any two concurrent transactional writes on the module connection (concurrent refresh rotations, concurrent creates/deletes) would crash the second with a 500-class error rather than serializing — a real availability/correctness defect for a commercial deployment.
- Root cause: the design's atomicity story assumed `BEGIN IMMEDIATE` serializes writers, which is true across connections but NOT within one shared connection; `transaction()` had no in-process serialization.
- Remediation (root, not leaf): `FuxaAuthDb.transaction()` now chains transactions through an in-process promise queue (`_txQueue`) — each transaction waits for the previous to COMMIT/ROLLBACK before it BEGINs, with the gate released in a `finally` so a failing transaction cannot deadlock the queue. `BEGIN IMMEDIATE` is retained, so serialization holds BOTH in-process (the queue) and across other connections e.g. FUXA's own (the SQLite write lock).
- Residual risk (UNVERIFIED / noted, not yet addressed): non-transactional `run()/all()` submitted on the shared connection WHILE a transaction is open would be executed by sqlite within that open transaction (same connection). The current call paths do not interleave a bare write into an open transaction (e.g. `getByJti` runs before `consumeAndRotate`), but a fully concurrency-safe design would either route every write through the queue or use a per-operation connection. Flagged for the API-layer/Task 13 review; not a defect in the current flows.
- Verification: `refresh-token-store.test.js` "consumeAndRotate is single-use under a concurrent double-consume" (two parallel consumes → exactly one wins, no crash); full auth-management suite 71 passing, stable across runs.

### N-033: Task 5 REQ-3 increment — Refresh_Token_Store + Token_Service.refresh implemented and verified (real crypto)
- Date: 2026-07-14
- Phase: Implementation (Task 5.7/5.8, and the refresh half of 5.2/5.5 — §02 §6)
- Status: **DONE for the §02 service layer.** The API-layer wiring (router mount, cookie I/O, HTTP status mapping, the `disabled` short-circuit, sign-out endpoint) is Task 13 — NOT done here.
- Links: D-019, D-030, N-032, N-015, REQ-3, P-015, RFC 9700, `server/auth-management/store/refresh-token-store.js`, `server/auth-management/services/token.service.js`, `server/test/auth-management/refresh-token-store.test.js`
- Statement: Implemented the stateful `Refresh_Token_Store` (`auth_refresh_tokens` table on the module-owned connection; `active→used→revoked` state machine; SHA-256 at-rest; CAS consume; family revocation) and wired `TokenService.refresh()` to the design/02 §6.2 flow: verify (sig/expiry + `type==='refresh'`) → store lookup + hash match + reuse detection → live-account + `tokenVersion` check (D-015/D-027) → atomic consume-and-rotate. Added `TokenService.revokeRefreshFamily` for sign-out/password-change/disable revocation (wiring in Task 13). `refresh()` returns a closed `RefreshOutcome`, never throws for control flow.
- Impact / Risk: REQ-3 refresh rotation/reuse-detection is code-complete and property-verified with real crypto; this closes the N-022 refresh-path real-crypto gap. Not yet mounted in any router (Task 13), so it is not reachable over HTTP yet.
- Verification: `refresh-token-store.test.js` — 14 passing incl. P-015 (@120, model-based, real crypto) and all `refresh()` outcome branches. Full auth-management suite: **71 passing, exit 0, stable across runs**.
- Test-stability note: P-015 initially ran against the file-backed WAL DB and intermittently exceeded its 30s timeout under full-suite disk contention (120 iters × multiple `BEGIN IMMEDIATE` fsync transactions). Root-fixed by running the P-015 STATE-MACHINE property against an **in-memory** sqlite DB (identical logic, no fsync latency), keeping the full 120 iterations; the file-backed persistence path stays covered by the deterministic integration tests. Suite now runs in ~3–6s, stable across 3 consecutive runs.

### N-034: VERIFIED LOOP HAZARD — the save-time integrity-guard hook could self-trigger (fixed: made strictly read-only)
- Date: 2026-07-14
- Phase: Anti-drift infrastructure / tooling
- Status: **RESOLVED 2026-07-14** — `.kiro/hooks/auth-um-save-time-integrity-guard.kiro.hook` rewritten to version 2: strictly read-only, an explicit ABSOLUTE ANTI-LOOP RULE forbidding any file write, and on failure STOP-and-report to the user (remediation happens in a separate normal turn or via the userTriggered audit hook).
- Links: `.kiro/hooks/auth-um-save-time-integrity-guard.kiro.hook`, `.kiro/steering/auth-user-management-antidrift.md` §"Layered anti-drift defense" item 4, N-020 (the incident this guard defends), N-024 (guard added)
- Statement: VERIFIED circular dependency in the hook as originally written. `when.type = fileEdited` with patterns including `.kiro/specs/auth-user-management/decisions/*.md`; `then.type = askAgent` whose prompt instructed, on failure, to "log a new incident in `00-INDEX.md` §3 + a new `N-*` in `04-notes.md`." Both `00-INDEX.md` and `04-notes.md` MATCH the `decisions/*.md` trigger pattern, so the guard's own remediation write would re-fire the guard → check → write → … an infinite loop. Independently, because an implementation turn saves many decisions/design/tasks files, the fileEdited guard fans out into a burst of agent invocations per turn. (The exact tightness of the loop depends on whether Kiro's `fileEdited` counts agent writes as save events — NOT asserted here without verification — but the circular design is a hazard either way.)
- Impact / Risk: an anti-drift guard that can edit the files it watches is self-defeating: it risks an infinite agent loop and, at minimum, a noisy burst of agent runs on every batch of edits. This also DRIFTED from the steering file, which already described this guard as "read-only (reports only; edits nothing) so it cannot loop" — the implementation contradicted its own documented contract.
- Root cause: the hook's action was given write/remediation responsibilities on the same file domain it triggers on. An automatic `fileEdited` hook must be strictly read-only (report only) to be loop-safe; remediation belongs in a separate, non-automatic turn.
- Remediation (root): rewrote the hook to be strictly read-only with an explicit anti-loop rule; it now reports PASS or STOPS-and-asks and never writes. This reconciles the hook with the steering's stated contract. Editing files under `.kiro/hooks/` does not match the guard's `.kiro/specs/...` patterns, so this fix itself does not trigger the guard.
- Residual (honest): the read-only guard still fires once per matching save. That is bounded and non-looping, but during heavy agent editing it can still fan out; if that noise is undesirable, the alternative is to convert it to `userTriggered` (manual) like the deep-audit hook and rely on the auto-loaded steering + the G0/phase-transition Integrity Check as the automatic layers. Offered as a user choice; NOT changed unilaterally because automatic save-time detection is the "cực mạnh" protection the user asked for.
- Verification: hook file is valid JSON, version 2, `then.prompt` contains the ABSOLUTE ANTI-LOOP RULE and no write instruction. The two other loop candidates were checked and cleared: `FuxaAuthDb._txQueue` (bounded promise chain, gates GC'd, deadlocks only on unused nested-transaction re-entrancy — documented constraint) and `stripProtoKeys` (JSON.parse output is acyclic ⇒ recursion terminates).

### N-035: Task 7 increment — Authentication_Service implemented + verified; §01 reconciled to D-027 and the canonical `get` lookup
- Date: 2026-07-14
- Phase: Implementation (Task 7 — §01) + design reconciliation (DEF-A1/DEF-A2)
- Status: **DONE for the §01 service layer** (sign-in decision). Router-level integration (real HTTP) is Task 13; deferred and noted.
- Links: REQ-1, D-006, D-007, D-027, D-031, DV-006, `server/auth-management/services/authentication.service.js`, `server/test/auth-management/authentication.service.test.js`, `design/01-authentication.md`
- Design-validation findings (fixed in `design/01` BEFORE coding, per the prepare→validate→implement rule):
  - **DEF-A1 (design lag):** §01 §3 showed `issueAccessToken({ username, groups, roles })` — missing `tokenVersion`, which D-027 made mandatory end-to-end for active revocation. Left as-is it would re-open the N-011/DEF-T1 gap. Reconciled: §01 §3 now passes `{ username, groups, roles, tokenVersion }`, sourced from the live record's `metadata.tokenVersion` (default 0).
  - **DEF-A2 (naming drift):** §01 referenced `User_Store.findUser(username)` (the D-006 name), but the implemented interface + adapter and §06 canonicalized the lookup as `get(username)`. Reconciled: §01 §3/§6/§7 now say `get(username)`; D-006's substance (only the username reaches the store — no query-injection via extra body fields) is preserved because `get(username)` takes only a username. (D-006 given a REFINEMENT note.)
- Statement: Implemented `services/authentication.service.js` — a pure decision over injected seams (User_Store.get / Password_Hasher.verify / Token_Service.issueAccessToken / BruteForceGuard / Audit_Logger), imports NO bcryptjs/jsonwebtoken (AC-1.5 structural). Decision order per §3/§7: field-presence FIRST (missing_field, not counted) → brute-force pre-check (rate_limited/429) → `get(username)` → password compare via the Hash seam → success mints the token with the live identity incl. tokenVersion (D-027) and resets the guard. DV-006 enforced: unknown-user and bad-password return an identical client-facing `invalid_credentials`/no-token result, with a dummy-hash verify (D-031) for timing parity; server-side audit keeps the finer outcome. Token-issuance failure after a valid credential rethrows (→ 5xx), never a partial success.
- Impact / Risk: REQ-1 sign-in decision is code-complete and example/edge-verified. Not reachable over HTTP yet (no router — Task 13). Task 7.3 router-level integration is deferred to Task 13.
- Verification: `authentication.service.test.js` — 10 passing (AC-1.1 success + live identity/tokenVersion; AC-1.2 unknown+dummy-verify; AC-1.3 bad password; DV-006 identical client view; AC-1.4 missing-field precedence with store/guard untouched; rate_limited short-circuit; blank-hash → bad_password; token-failure rethrow; secret-free audit; AC-1.5 no bcrypt/jwt import). Full auth-management suite: **81 passing, exit 0, stable across runs**.
