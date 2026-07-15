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

### N-036: Task 8 increment — Role_Service + Authorization_Service implemented + verified; DEF-R1/DEF-R2 reconciled at the root
- Date: 2026-07-14
- Phase: Implementation (Task 8 — §05) + design reconciliation (DEF-R1/DEF-R2)
- Status: **DONE for the §05 service layer** (`Role_Service` REQ-9 + `Authorization_Service` REQ-10 + the admin-determination predicate + the pure live-identity resolver). The API-layer authorization **middleware** (token verify → live-record load → `resolveIdentity` → `isAllowed`) and the router mount are Task 13 — NOT done here.
- Links: REQ-9, REQ-10, REQ-17 (AC-17.2/17.3), D-015, D-024, D-027, D-032, P-006, P-011, P-013, P-009 (§12 §9), N-011, N-013 (same deadlock class), `design/05` §4.2/§6/§8.4/§9, `server/auth-management/services/role.service.js`, `server/auth-management/services/authorization.service.js`, `server/test/auth-management/role.service.test.js`, `server/test/auth-management/authorization.service.test.js`
- Design-validation findings (validate-before/at-code, per N-006 rule 1 & 3):
  - **DEF-R1 (design gap — reconciled by the prior session, confirmed present on disk this session):** `traceability.md` §C and D-015 declare **P-013 "owned by §05"**, but §05 §9 (Correctness Properties) originally claimed only P-006 — the owned property had no formal *home* in the section body. Reconciled: `design/05` §9 now carries **"Property 13 (owned by §05) — live account authority + active revocation"** (§9.1b), stating the property the §4.1 mechanism must satisfy (verified on disk: the heading exists and is referenced from the §9 intro and §4.1).
  - **DEF-R2 (VERIFIED root defect — found + fixed this session):** `isAllowed` returned **403** for a freshly-seeded admin (`groups:-1`, `mustRotate:true`) invoking `account.rotatePassword`, because after the bootstrap gate it **fell through to permission membership** and `account.rotatePassword ∉ ADMIN_PERMISSION_SET` (the seeded admin's only authority is the `-1` group code). This **violates the normative P-009** (`design/12` §9: *"isAllowed(a, op) … PERMITS op when op.requiredPermission = 'account.rotatePassword'"* for the seeded admin) and `design/05` §10.3 (*"403 on every op except account.rotatePassword"*), and reproduces the **N-013 bootstrap-deadlock class** at the decision layer. **Root cause:** `design/05` §4.2 step 2 + §6 + the §8.4 mermaid wrote only the **deny half** of the gate ("deny everything whose permission ≠ rotate"); the **allow half** (rotation is a self-authorized operation that needs no RBAC grant) lived only in `design/12`/§10.3 and was never encoded in §05's decision procedure, and the code implemented §05's incomplete procedure literally. **Root fix (design + code, this session):** `design/05` §4.2 step 2 now states that when `mustRotate` is true the gate decides ENTIRELY — `account.rotatePassword` → **allow** (membership NOT consulted), everything else → **403**; §6 and the §8.4 mermaid updated to show the allow branch; `authorization.service.js` `isAllowed` allows `account.rotatePassword` under `mustRotate` before the membership check. This is fixed at the contract (design) not merely the leaf (code).
- Implementation:
  - **`services/role.service.js`** (REQ-9): closed outcomes for `create`/`list`/`update`/`delete`; canonical id = `role.id`; audit on create/update/delete via the injected `Audit_Logger`; no FUXA row-shape knowledge (D-003/AC-16.5).
  - **AC-9.5 realization refinement (the "see N-036" reference in `role.service.js`):** duplicate rejection uses the store's **ATOMIC plain-INSERT create** (D-024/D-020 → `DuplicateKeyError` code `duplicate_key`), NOT §3.3's read-then-write pre-check. This is **TOCTOU-free** and still leaves the existing role unmodified (a failed `INSERT` does not `REPLACE`), which is exactly AC-9.5 — a faithful, *stronger* realization of §3.3's stated intent. `prunedUsers` (AC-9.4) is computed from a pre-delete `User_Store.readAll` scan (accurate, not fabricated) while the actual prune is delegated to `Role_Store.delete` (adapter → verified FUXA `removeRoles` semantics; own-connection fallback in tests).
  - **`services/authorization.service.js`** (REQ-10 + REQ-17 gate + §5.3 predicate): pure over the injected `Role_Store.get` (no clock/random/HTTP — AC-16.5/D-003). `resolveIdentity(claims, record)` (D-032) builds the request identity from the LIVE record (D-015) with the `tokenVersion` absent→0 revocation check (D-027); `effective(identity)` = ⋃ role perms ∪ group-code admin compat (255/-1); `isAllowed` = ordered total decision (401 → bootstrap gate → membership, fail-closed); `isAdministrator` = the single admin predicate consumed by §04/§12.
- Task-13 integration FLAGS (things the next session MUST know — recorded so they are not lost, NOT fixed here):
  1. **`getUserCache` shape mismatch.** D-032/§4.1 say the middleware calls `runtime.users.getUserCache(username)` then `resolveIdentity(claims, record)`. FUXA's `getUserCache` returns the RAW cache entry `{ info:{ roles,… }, groups }` (verified in `server/runtime/users/index.js`), which has **no top-level `.roles`/`.metadata`** — but `resolveIdentity` reads `record.roles`/`record.metadata`. The Task-13 middleware MUST map the raw cache record into the `User_Record` shape `{ username, roles, groups, metadata }` (e.g. via the same `info`-split `FuxaUserStoreAdapter.get` performs, or by calling `userStore.get`) BEFORE `resolveIdentity`, otherwise live authority silently degrades to `roles:[]`/`mustRotate:false`. This is an integration correctness risk for Task 13, flagged now.
  2. **Post-rotation self-service password change is unspecified.** After `mustRotate` clears, `account.rotatePassword` is membership-governed (§4.2 step 3) and is NOT in `ADMIN_PERMISSION_SET`, so post-bootstrap NO identity can rotate via this permission unless a role explicitly grants `account.rotatePassword`. **P-009 only requires the bootstrap behavior**; a general "any authenticated user may change their own password" is NOT a current requirement and was NOT invented here. If desired it needs a new requirement/decision (grant `account.rotatePassword` broadly, or a dedicated self-service route). Flagged as a follow-up.
- Impact / Risk: REQ-9 + REQ-10 + the REQ-17 gate enforcement (§05's half) are code-complete and verified with real sqlite (P-011) and pure-decision property tests (P-006/P-013). The DEF-R2 fix removes a designed-in bootstrap deadlock before it could ship. Not reachable over HTTP yet (no middleware/router — Task 13). P-009's full lifecycle proof (seed → gate → rotate → clear) is owned by §12/Task 12 and remains PENDING; this section's tests cover the gate's allow/deny decision surface directly.
- Verification: `role.service.test.js` (9 tests: AC-9.1/9.2/9.3/9.5 + shape guard + delete-prune integration + **Property 11 @120**, real in-memory sqlite through both adapters) and `authorization.service.test.js` (17 tests: 401/403/allow truth table, AC-10.4 role + group-code compat, fail-closed, dangling role, **AC-17.2 bootstrap gate incl. the DEF-R2 allow-rotate regression**, AC-17.3 regain, `isAdministrator`, **Property 6 @200**, live-authority anchors + **Property 13 @200**). Full auth-management suite: **107 passing, exit 0, stable across 2 runs**.

### N-037: Task 9 increment — User_Service (CRUD + password policy + atomic last-admin guard) implemented + verified; DEF-U1/DEF-U2 reconciled at the root
- Date: 2026-07-14
- Phase: Implementation (Task 9 — §04) + design reconciliation (DEF-U1/DEF-U2) + closes deferred Task 2.9/2.10
- Status: **DONE for the §04 service layer** (REQ-5/6/7/8: create/list/get/update/delete + password policy + last-admin guard). The API-layer router (`users.router.js`) + authorization middleware wiring + the outcome→HTTP mapping are Task 13.
- Links: REQ-5, REQ-6, REQ-7, REQ-8, REQ-4 (AC-4.6/4.7), D-006, D-007, D-017, D-020, D-025, D-033, D-034, P-003, P-016, N-012, N-016, `design/04` §2.2/§6.1/§6.5/§8.2, `server/auth-management/services/user.service.js`, `server/auth-management/adapters/fuxa-user-store.adapter.js`, `server/auth-management/store/user-store.interface.js`, `server/test/auth-management/user.service.test.js`
- Design-validation findings (validate-before-code, N-006 rule 1 & 3):
  - **DEF-U1 (VERIFIED layering/atomicity defect):** `design/04` §6.5 mandated the last-admin count→guard→delete run in one `BEGIN IMMEDIATE` transaction "on the adapter's own connection", but the `User_Store` interface exposed only separate `readAll`/`delete`, and §1.1 + AC-16.3 forbid the pure service from running SQL/transactions — while Task-2.9's note ("User_Service.delete is the transaction site") implied the service orchestrates it. A service-level `readAll`+`delete` across `await`s IS the N-016 TOCTOU (two concurrent last-admin deletes → zero admins). **Root fix (D-033):** added the atomic `User_Store.deleteGuarded(username, isAdministratorFn)` (adapter transaction, service injects the §05 predicate); reconciled `design/04` §6.1 (delete flow delegates to it) + §6.5 (names the mechanism). This CLOSES the previously-deferred Task 2.9 last-admin-`BEGIN IMMEDIATE` half and Task 2.10 P-016.
  - **DEF-U2 (VERIFIED incomplete outcome set):** §2.3/§8.1 require `create` to reject password-policy (AC-4.6/4.7) and omitted/blank passwords with a `validation_error`, but the `CreateOutcome` type (§2.2) enumerated only `created|missing_field|duplicate` (no `invalid`), and §8.2 had no create→invalid row. **Root fix:** added `{ kind:'invalid', error:'validation_error', detail }` to `CreateOutcome` (§2.2) + the create→invalid **400** row (§8.2).
- Implementation (`services/user.service.js`, pure over injected seams — no SQL/clock/HTTP, AC-16.3):
  - `create` (order: username shape → password policy → field shape → duplicate fast-path → hash → atomic-INSERT persist); `list`/`get` (hash-free `UserView`, empty≠error AC-6.4); `update` (existence → validate → re-hash|retain → apply, no write on failure AC-7.4/7.5, retain-on-omit AC-7.3); `delete` (delegates to the atomic `deleteGuarded` with the §05 `isAdministrator` predicate). Hashing happens upstream of the store (AC-5.4/7.2); no plaintext reaches the store, any `UserView` (AC-6.2), or any audit event (AC-14.5).
  - **Password policy (D-034):** `settings.auth.passwordMinLength` (default 12 chars, code-point counted) + `settings.auth.passwordBlocklist` (case-insensitive; small built-in default). Validation order: required → malformed-UTF-16 (D-025 boundary, via the shared `hasLoneSurrogate`) → >72 UTF-8 bytes (AC-4.6) → min length (AC-4.7) → blocklist (AC-4.7). All → `validation_error`, no hash, no write.
  - **Atomic last-admin guard (D-020/D-033):** `FuxaUserStoreAdapter.deleteGuarded` runs existence→classify→count-others→conditional-delete inside one `BEGIN IMMEDIATE` transaction; group-code admins (`-1`/`255`) are classified with no role read; best-effort cache eviction after COMMIT.
- Task-13 integration FLAGS (recorded, not fixed — out of scope):
  1. The router must map every closed outcome to the §8.2 HTTP table (incl. the new create→`invalid`→400 row) and apply the §05 authorization middleware (user.create/read/update/delete) BEFORE `User_Service` (§7). Unauthenticated→401 / unpermitted→403 are produced at the seam, not in these outcomes.
  2. In production the composition root must give the `User_Store` and `Role_Store` adapters the SAME `FuxaAuthDb` connection so `deleteGuarded`'s in-transaction role reads (for role-based admin classification) observe the consistent snapshot. (Group-code admins need no role read.)
  3. `create` intentionally sets no `groups` (new users get RBAC roles, not the legacy admin group code) — the seeded/legacy `-1`/`255` admins come from §12 bootstrap / migration, not from `User_Service.create`.
- Impact / Risk: REQ-5…8 are code-complete and verified (example/edge with doubles + real-sqlite/bcrypt integration + P-016 concurrency). The DEF-U1 fix removes a real zero-admin-lockout TOCTOU; DEF-U2 completes the create contract. Not reachable over HTTP yet (Task 13). The built-in default blocklist is intentionally small (min-length does most of the work) — operators of exposed deployments should supply a fuller `passwordBlocklist` (D-034).
- Verification: `user.service.test.js` — **20 passing**: (A) example/edge with doubles (AC-5.1..5.4 incl. hash-only + trim, AC-5.2 fast-path + atomic PK, AC-5.3, **DEF-U2** policy set, configurable policy, AC-6.1/6.2 list, AC-6.3/6.4 get, AC-7.1/7.2/7.3 update, AC-7.4/7.5 + password-policy-on-update, INV-1 reserved-key, AC-8.1/8.2/8.3/8.5 delete mapping, ctor guard); (B) real-adapter integration (create→get round-trip incl. single-hash verify, retain-hash end-to-end, last-admin single/non-last, plain-user delete) + **Property 16 @100** (concurrent deletes of all admins → exactly one survives, ≥1-admin invariant). Full auth-management suite: **127 passing, exit 0, stable across 2 runs**.

### N-038: Task 12 increment — Admin bootstrap + rotate + migration + enrollment implemented + verified; DEF-B1/DEF-B2 reconciled; password policy made single-source
- Date: 2026-07-14
- Phase: Implementation (Task 12 — §12) + design reconciliation (DEF-B1/DEF-B2) + anti-drift refactor
- Status: **DONE for the §12 service layer** (REQ-17.1..17.5: seed / idempotent-retain / mandatory known-default remediation / `account.rotatePassword` / secure enrollment). The HTTP wiring — `POST /api/account/rotate-password` (Task 13.7), running `runBootstrap` at the composition root (Task 13.5), and the interactive-console/token-redemption operator glue — is Task 13/14.
- Links: REQ-17, D-005, D-008, D-012, D-013(1), D-015, D-022, D-034, D-035, DV-004, DV-005, N-007, N-018, P-009, P-010, `design/12` §3.1/§3.2/§8, `server/auth-management/services/bootstrap.js`, `services/account.service.js`, `services/enrollment.js`, `services/password-policy.js`, `server/test/auth-management/bootstrap.test.js`, `server/test/auth-management/account.service.test.js`
- Design-validation findings (validate-before-code, N-006 rule 1 & 3):
  - **DEF-B1 (VERIFIED security defect):** `design/12` §8 made the migration re-hash "recommended" while only `mustRotate=true` was mandatory. But leaving the KNOWN `'123456'` hash reproduces the exact **hostile-rotation takeover** §3.2 argues must be closed (an attacker who knows `'123456'` signs in — sign-in is not gated — and, though the gate limits them to `account.rotatePassword`, rotates and seizes the sole admin). §10.3's own assertion ("the `'123456'` credential yields **no** usable authority") is unsatisfiable without the re-hash. **Root fix:** §8 corrected — the migration re-hash to a fresh CSPRNG unknown secret is **NECESSARY** (not recommended); `bootstrap.js` `_remediateKnownDefaultAdmins` re-hashes + arms the gate + delivers the fresh secret via the enrollment channel.
  - **DEF-B2 (naming drift):** §3.1/§3.4 wrote `User_Store.list()`, but the canonical store method is `readAll()` (`list()` is the `User_Service` verb, §04 §2.2). **Root fix:** §3.1 reconciled to `readAll()` (substance unchanged — same content-based empty-admin check).
  - **Enrollment ambiguity (§3.2)** resolved by **D-035** (the CSPRNG one-time secret is delivered via an injected `EnrollmentChannel`; a one-time token store is the automated channel).
- Implementation:
  - **`services/bootstrap.js`** — content-based empty-admin check (`readAll` + §05 `isAdministrator`); on empty → seed EXACTLY one admin (CSPRNG secret, `Password_Hasher.hash` cost via the injected adapter/D-008, `groups:-1`, `roles:[]`, `metadata.mustRotate:true`, `bootstrap.seed` audit AC-17.5); on non-empty → retain (AC-17.4) + MANDATORY `remediateKnownDefaultAdmins` (verify `'123456'` on un-gated admins → re-hash fresh + `mustRotate:true` + bump tokenVersion + deliver via enrollment; audited as `user.update`). Idempotent (a gated seed admin is skipped on re-run). The one-time secret goes ONLY to `enrollmentChannel.deliver` — never a logger/return (D-022).
  - **`services/account.service.js`** — `rotatePassword(identity, req)`: verify current via `Password_Hasher` (mismatch → `bad_current`, gate NOT cleared), reject reuse (new === current) / weak-or-oversized new via the shared policy → `invalid_new`, else re-hash + clear `mustRotate` + **bump `metadata.tokenVersion`** (D-015/D-027 active revocation) + audit `user.update`.
  - **`services/enrollment.js`** — `OneTimeEnrollmentTokenStore` (SHA-256 hashed-at-rest, TTL, single-use, `redeem` → `{username,secret}` once) + `TokenEnrollmentChannel` (surfaces only the token to an injected operator sink, never the secret) (D-022/D-035).
  - **`services/password-policy.js` (anti-drift refactor, realizes D-034):** the AC-4.6/4.7 + D-025 validation is now a SINGLE module used by BOTH `User_Service` and `Account_Service` (previously inline in `user.service.js`). `user.service.js` refactored to import `validatePasswordPolicy`/`resolvePasswordPolicy` (re-exports the constants for compatibility); behavior unchanged (full suite still green). This removes a policy-duplication drift vector.
- Task-13/14 integration FLAGS (recorded, not fixed):
  1. Composition root (13.5) runs `runBootstrap(deps)` at startup with the SAME `FuxaAuthDb` shared by both stores, and MUST inject a real secure `EnrollmentChannel` `operatorSink` (never `runtime.logger`/`console`). The interactive-console collector + the HTTP token-redemption endpoint are Task 13/14.
  2. `POST /api/account/rotate-password` (13.7) wires `Account_Service.rotatePassword`; on success the middleware/token layer must honor the bumped `tokenVersion` (already enforced by `resolveIdentity`, §05/Task 8).
  3. The seeded/migrated admin uses `groups:-1` for admin determination on an empty store (no RBAC role needed); a first admin ROLE may optionally be provisioned later.
- Impact / Risk: REQ-17 is code-complete and verified (seed/idempotent/retain/migration + rotate + enrollment + P-009 gate + P-010 invariant + N-007 elimination + D-022 log-safety). The DEF-B1 fix closes a real migrated-install takeover. Not reachable over HTTP yet (Task 13). `OneTimeEnrollmentTokenStore` buffers the plaintext until redeem/expiry (documented; follow-up (b) in D-035 removes it).
- Verification: `bootstrap.test.js` (10 tests: AC-17.1 seed + AC-17.5 audit, idempotency, AC-17.4 retain, DEF-B1 migration re-hash, §10.3 no-usable-known-default after seed+migration, §10.4 secret-free audit, enrollment token single-use/TTL/hashed-at-rest, channel token-only, **Property 10 @100**) + `account.service.test.js` (5 rotate outcome/edge tests + **Property 9 @200**). Full auth-management suite: **142 passing, exit 0, stable across 2 runs**.

### N-039: Task 13 increment (part 1/3) — authorization middleware + users/roles/account routers implemented + verified over real HTTP
- Date: 2026-07-14
- Phase: Implementation (Task 13.1/13.3/13.4/13.7 — API layer) + integration verification (13.6/13.8 partial)
- Status: **DONE for the guarded resource surface** (authorization middleware + users/roles/account routers). **DEFERRED to the next steps (with reason):** 13.2 the auth/session router (`/api/signin`, `/api/refresh`, `/api/signout` + refresh-cookie orchestration); 13.5 the composition-root factory AND the single FUXA-core SUPERSEDE edit in `server/api/index.js`; the client cutover (D-011).
- Links: REQ-5..10, REQ-16 (AC-16.3/16.4), REQ-17, D-011, D-014, D-015, D-018, D-027, D-032, P-014, `design.md` "API Composition Root & Cutover", `design/04` §8.2, `design/05` §8.1/§1.1, `design/12` §4, `server/auth-management/api/authorization.middleware.js`, `api/users.router.js`, `api/roles.router.js`, `api/account.router.js`, `server/test/auth-management/api.routers.test.js`
- Implementation (all under `server/auth-management/api/`, D-003 boundary — no FUXA-core edit this turn):
  - **`authorization.middleware.js` (13.1):** `createAuthorizationMiddleware({ tokenService, userStore, authorizationService }) → { requirePermission(permId), buildIdentity(req) }`. Extracts the token from `x-access-token` (verified FUXA client convention) or `Authorization: Bearer`; `Token_Service.verify` → live-authority record via **`User_Store.get`** (the domain shape the resolver needs — the D-032/N-036 flag #1 fix, NOT `getUserCache`) → `Authorization_Service.resolveIdentity` (D-015/D-027 tokenVersion revocation) → `isAllowed` → 401/403 or `next()` with `req.authIdentity`. **AC-16.4 fail-fast:** a dependency throw ⇒ **503 `service_unavailable`** (never proceed unauthenticated, never a bare 500).
  - **`users.router.js` (13.3):** guarded `GET/POST/PUT/DELETE /api/users[/:username]` (`user.read/create/update/delete`) → §04 §8.2 mapping (created/missing_field/duplicate/**invalid** DEF-U2 200/400; get empty=200 data:null; update 200/404/400; delete 200/404 `user_not_found`/400 `last_admin`).
  - **`roles.router.js` (13.4):** guarded `GET/POST/PUT/DELETE /api/roles[/:id]` (`role.*`) → §05 §8.1 mapping (created/ok/updated 200; deleted 200 `{removed,prunedUsers}`; duplicate 400 `duplicate_role`; unknown_role 404 `role_not_found`; invalid 400).
  - **`account.router.js` (13.7):** `POST /api/account/rotate-password` guarded by `account.rotatePassword` (the bootstrap-gate exception, DEF-R2 allow-half) → `Account_Service.rotatePassword(req.authIdentity, ...)` → rotated 200 / bad_current 400 / invalid_new 400.
- Verification (REAL end-to-end HTTP — standalone Express app + real services + in-memory sqlite + real bcrypt/jsonwebtoken, driven by global `fetch`; tokens issued directly via `Token_Service` since signin is 13.2): `api.routers.test.js` — **9 passing**, including: AC-10.3 no-token→401; admin lists (hash-free); viewer read-ok/create-403 (AC-10.1 vs 10.2); create duplicate/missing-field/policy→400; get/update/delete status mapping; **live authority (D-015) — a DELETED account's token is denied 401 on the next request**; role CRUD statuses + role.* guarding; **AC-17.2 bootstrap gate — a `mustRotate` admin is 403 on protected ops but reaches rotate-password; after a correct rotate the pre-rotation token is revoked (401, tokenVersion bump D-027) and a fresh token regains full admin (AC-17.3)**; AC-16.4 store-failure→503 fail-fast. Full auth-management suite: **151 passing, exit 0, stable across 2 runs**.
- Why the FUXA-core cutover (13.5) is deferred, not skipped (precise reason): D-014 states the `server/api/index.js` SUPERSEDE edit (stop mounting `authApi`/`usersApi` for the overlapping paths, mount the module) **MUST land together with the client cutover (D-011)** — because the module's signin payload is `{ token, username, fullname, roles }` while the FUXA built client in `client/dist` reads `{ groups, info }`; editing `api/index.js` now (without the client change) would break the running UI. So the safe, root-correct sequence is: finish the module's HTTP surface (this turn: guarded routers; next: auth/session router + composition-root factory, both fully testable standalone), THEN perform the coordinated single-commit cutover (`api/index.js` mount + client Login/User-Management pages) as the final step. This is the D-014 "land together" discipline, not a shortcut.
- Impact / Risk: The module is now a real, mountable, RBAC-enforcing HTTP surface for users/roles/account, verified end-to-end incl. live-authority revocation and the bootstrap gate. It is NOT yet wired into FUXA's running app (still shadowed), so the web still shows FUXA's legacy auth — by design until the coordinated cutover. No FUXA-core file was touched this turn.

### N-040: Task 13 increment (part 2/3) — authentication/session router (signin/refresh/signout) implemented + verified over real HTTP
- Date: 2026-07-14
- Phase: Implementation (Task 13.2 — API layer) + integration verification (13.6 partial)
- Status: **DONE for the session surface** (`POST /api/signin`, `/api/refresh`, `/api/signout`). **STILL PENDING (part 3/3):** 13.5 composition-root factory + the single FUXA-core `server/api/index.js` SUPERSEDE edit + the client cutover (D-011/D-014, land together).
- Links: REQ-1, REQ-3 (AC-3.1..3.4), DV-006, D-019, D-015/D-027, `design/01` §4, `design/02` §6.1/§6.2/§6.3, `server/auth-management/api/authentication.router.js`, `server/auth-management/services/token.service.js` (2 additive methods), `server/test/auth-management/api.authentication.test.js`
- Implementation:
  - **`api/authentication.router.js` (13.2):** delegates to services only, no bcrypt/jwt import (D-003); cookie name/path unchanged (`fuxa_refresh`, `/api/refresh`).
    - `POST /api/signin` → `Authentication_Service.signIn` → §01 §4 mapping: success 200 `{status:'success',data:{token,username,fullname,roles}}` (+ refresh cookie WHEN `secureEnabled && enableRefreshCookieAuth`, §6.1); unknown_user/bad_password → **byte-identical** 401 `{status:'error',error:'invalid_credentials'}` (DV-006); missing_field → 400; rate_limited → 429 `too_many_attempts`. A service throw (token-issuance failure, §01 §7) → 500 (never a faked success).
    - `POST /api/refresh` → disabled (`!secureEnabled || !enableRefreshCookieAuth`) → 204; else `Token_Service.refresh(cookie)` → rotated 200 + new cookie; **every** rejection (incl. missing) → 401 + **clear cookie** (AC-3.3 hardening on all paths); reuse/revoked/unknown also revoke the family (inside `Token_Service.refresh`).
    - `POST /api/signout` → revoke the server-side family via `Token_Service.revokeRefreshByToken` (verifies the token then `revokeFamily` — a forged/foreign token cannot revoke an arbitrary family) + clear cookie + 204 (AC-3.4 — sign-out invalidates the server-side token, not just the cookie).
  - **`token.service.js` (2 additive methods, composition helpers — keep JWT/decode in the Token layer so the router imports no jwt, D-003):** `issueRefreshForSignIn(identity)` (mint + return `{token,jti,familyId,issuedAt,expiresAt}` for `Refresh_Token_Store.insert` on signin) and `revokeRefreshByToken(token)` (verify → `revokeFamily` for signout). Additive only; the 160-test suite (incl. all prior token/refresh tests) stays green.
- Verification: `api.authentication.test.js` — **9 passing** over REAL HTTP (Express + real services + in-memory sqlite + real bcrypt/jwt via `fetch`): signin missing/success (token verifies + cookie set)/DV-006 byte-identical 401/rate-limited 429; refresh disabled→204, missing→401+clear, rotation (new access verifies + rotated cookie), **RFC 9700 reuse → 401 + family revoked (child also dead)**, **sign-out → 204 + server-side family revoked (refresh dead after logout)**. Full auth-management suite: **160 passing, exit 0, stable across 2 runs**.
- Remaining for part 3/3 (unchanged reasoning from N-039): the composition-root factory wires adapters→services→routers + runs `runBootstrap`, and the ONE FUXA-core edit in `server/api/index.js` (stop mounting `authApi`/`usersApi` for the overlapping paths, mount the module after `authLimiter`) MUST land together with the client cutover (D-011) — else the running built client breaks on the `{roles}` vs `{groups,info}` payload. This is the final coordinated step.

### N-041: Task 13 increment (part 3a/3) — composition-root factory implemented + verified end-to-end; FUXA-core cutover is the remaining 3b
- Date: 2026-07-14
- Phase: Implementation (Task 13.5 — composition root, the non-core-edit half) + integration verification
- Status: **DONE for the composition-root FACTORY** (`createAuthManagementModule`) — the module now assembles, boots (runBootstrap), and serves its whole HTTP surface as a single mountable Express router, verified end-to-end. **REMAINING (part 3b, the final coordinated step):** the single FUXA-core edit in `server/api/index.js` (un-mount FUXA `authApi`/`usersApi` for the overlapping paths, mount `mod.router` after `authLimiter`) + the client cutover (D-011). These land TOGETHER (D-014) and touch FUXA core, so they are held for an explicit, validated, user-confirmed step.
- Links: REQ-16, REQ-17, D-014, D-011, D-018, D-003, `design.md` "API Composition Root & Cutover", `server/auth-management/index.js`, `server/test/auth-management/composition-root.test.js`
- Implementation (`server/auth-management/index.js` — replaced the `not_implemented` placeholder):
  - `async createAuthManagementModule(deps)` wires bottom-up: `FuxaAuthDb` (injected/built) → stores (`FuxaUserStoreAdapter`/`FuxaRoleStoreAdapter` sharing the ONE connection — the N-037 flag #2 wiring; `RefreshTokenStore.ensureSchema()` for the module-owned refresh table) → seams/services (`Password_Hasher` at `settings.auth.bcryptCost`||12; `Token_Service` with the mapped hardening settings + refreshStore + userStore; `BruteForceGuard`; `Authorization`/`Authentication`/`User`/`Role`/`Account` services) → **`runBootstrap` once at startup** (REQ-17) → authorization middleware + the four routers mounted on one `express.Router`. Returns `{ router, db, bootstrapResult, services, stores }`.
  - Every dependency is injectable (in-memory DB, spy enrollment, test JWT seam) and defaults to the real FUXA collaborators (TokenAdapter over `jwt-helper` lazy-required only in prod; `runtime.users` for cache coherence). `enrollmentChannel` is REQUIRED (D-022 — no silent secret logging). `auditLogger` defaults to a no-op with the explicit contract that production MUST inject the real `Audit_Logger` (§09). NO FUXA-core file edited.
  - Settings mapping: the factory takes one module `settings` object and slices it correctly per component (TokenService flat settings; router `{secureEnabled,enableRefreshCookieAuth,https,refreshTokenExpiresIn}`; User/Account services `settings.auth.*` policy) — one config surface, no duplication.
- Verification: `composition-root.test.js` — **4 passing** end-to-end through the factory over real HTTP: bootstrap seeded exactly one gated admin + delivered the one-time secret via the enrollment channel (never returned/logged); **full lifecycle** — sign in with the seeded secret → GET /api/users 403 (gate) → bad rotate 400 → correct rotate 200 → pre-rotation token revoked 401 (tokenVersion) → re-sign-in → full admin can list/create users + roles (AC-17.3); idempotent second module → retained (no new admin, no enrollment); factory rejects a missing enrollment channel (D-022). Full auth-management suite: **164 passing, exit 0, stable across 2 runs**.
- The final part 3b (FUXA-core `api/index.js` SUPERSEDE + client cutover) — precise reasoning unchanged (N-039/N-040): editing `api/index.js` now (without the client change) breaks the running built client on the `{roles}` vs `{groups,info}` signin payload, so it must be a single coordinated commit with the client Login/User-Management cutover (D-011). This is the "make it live on the web" step; it will be validated (read `api/index.js` mount block + client `auth.service`/guard/interceptor) and user-confirmed before touching FUXA core.

### N-042: Cutover pre-validation (Task 13 part 3b) — VERIFIED client is numeric-`groups`-based ⇒ the FUXA-core SUPERSEDE is hard-coupled to the client migration
- Date: 2026-07-14
- Phase: Implementation planning (Task 13 part 3b — the FUXA-core `server/api/index.js` SUPERSEDE cutover). **NO code changed this turn — validation/planning only (per the user's prepare→validate→then-implement rule).**
- Links: D-014, D-011, D-007, TO-011, TO-013, `server/api/index.js`, `client/src/app/_services/auth.service.ts`, `client/src/app/_helpers/auth-interceptor.ts`, `client/src/app/auth.guard.ts`, `client/src/app/_models/user.ts`
- VERIFIED facts (read from the client source this turn — not assumed):
  1. `AuthService.signIn` casts the signin `result.data` to `UserProfile` and reads `currentUser.info` → `infoRoles = JSON.parse(info).roles`; persists `currentUser` (incl. `groups`, `info`, `token`) to `sessionStorage['currentUser']`.
  2. Client authorization/UI-gating is **numeric-`groups`-based**: `isAdmin()` = `UserGroups.ADMINMASK([-1,255]).indexOf(currentUser.groups) !== -1`; `checkPermission()` uses `currentUser.groups` (bitmask) OR `currentUser.infoRoles` (when `settings.userRole`); `AuthGuard.canActivate` calls `isAdmin()`; the interceptor sends header `x-auth-user:{user,groups}`. (`client/src/app/_models/user.ts`: `User.groups:number`, `UserGroups.ADMINMASK=[-1,255]`.)
  3. The module `/api/signin` success payload (D-007) is `{token,username,fullname,roles}` — NO `groups`, NO `info`.
  4. `User_Service.create` sets NO `groups` (RBAC roles only, N-037 flag #3); only the seeded/legacy admin has `groups:-1`.
- Consequence (the verified blocker): a bare `server/api/index.js` SUPERSEDE with the client unchanged makes `currentUser.groups`/`info` `undefined` ⇒ `isAdmin()` false, `checkPermission()` degrades, `AuthGuard` blocks admins, userRole-mode gating breaks — across the whole app. Even re-adding `groups`+`info` to the payload only helps group-code users; module-created (roles-only) users still can't be gated by the legacy client. **⇒ The FUXA-core cutover cannot be done safely before the client is migrated to the roles-based model.** This is the concrete proof of D-014's "land together" and shows the coupling is deep (Tasks 15–17), not a one-line client tweak.
- Recommendation (TO-013): **Option 1 — client-first.** Do NOT edit `server/api/index.js` now. Proceed with the client work (Task 15: `AuthSignInClient` + `UserAdminClient`/`RoleAdminClient` consuming `{…,roles}`, roles-based permission model; then Tasks 16/17 new Login + User-Management UI), rebuild `client/dist`, THEN the single coordinated commit does the `api/index.js` SUPERSEDE + client cutover and the module goes live on the web. Options 2 (transitional payload-compat shim) and 3 (parallel `/api/v2`, TO-011 fallback) are recorded in TO-013 but not chosen (Option 2 is a leaf-patch that grows debt; Option 3 is a heavier dual-stack).
- Status: The server module (Tasks 1–13 service + API surface) is complete + verified (164 tests). The remaining path to "live on web" is the client migration + the coordinated cutover. Next step is user's choice per TO-013; recommended = start Task 15.

### N-043: Task 15 pre-validation — VERIFIED the client is not provisioned/testable in this environment (blocks verifiable client implementation)
- Date: 2026-07-14
- Phase: Implementation planning (Task 15 — client HTTP clients, Angular). **NO code changed this turn — validation only (verify-before-implement).**
- Links: REQ-11, REQ-12, D-011, D-007, `design/07-ui-login-page.md` §9, `design/08-ui-user-management-page.md`, `client/package.json`, `client/angular.json`, N-006 (user principle: verify before implement, no fabrication)
- VERIFIED facts (checked this turn — not assumed):
  1. `client/node_modules/@angular/core/package.json` is ABSENT ⇒ the client's npm dependencies are NOT installed (consistent with the session-start note that only `server/` deps were installed). Angular/TypeScript type resolution, `ng build`, and `ng test` are therefore all unavailable.
  2. `client/package.json` has NO `test` script and NO karma/jasmine/jest in devDependencies (scripts: ng/start/build/lint/e2e only).
  3. `client/angular.json` DOES declare a `test` target (`@angular-devkit/build-angular:karma`, `src/karma.conf.js`, `src/tsconfig.spec.json`), but the karma builder is NOT installed (nor jasmine).
  4. NO `*.spec.ts` exists anywhere under `client/src/app` ⇒ the upstream FUXA client ships zero unit tests.
- Consequence (the blocker): Task 15 is Angular/TypeScript client code. With the client not installed and no test runner present, newly-written client code could NOT be type-checked (`tsc`/language-service can't resolve `@angular/*`), built (`ng build`), or unit-tested (`ng test`) in this environment. Writing it now would be UNVERIFIABLE — exactly the fabrication/speculation the user's contract (N-006) forbids ("chính xác kiểm chứng được rồi mới triển khai", "tuyệt đối không bịa"). So client implementation is deliberately NOT started until the environment is provisioned to make it verifiable. The §07 design was read + validated (no new design defect); the sole blocker is environment/tooling, not design.
- Options (pending user decision):
  1. **Provision the client env (RECOMMENDED).** Run `npm install` in `client/` (Angular 18 toolchain), then add a HEADLESS unit-test runner as a devDependency. Recommend **jest + jsdom** (via `@angular-builders/jest`/`jest-preset-angular`) over karma because karma needs a real browser (Chrome-headless availability here is unverified), whereas jest+jsdom runs in Node — matching the server's node:assert choice (N-023) and making client tests reliably runnable/verifiable here. After provisioning: implement 15.1/15.2/15.3 + 15.4 tests, verified by `tsc --noEmit` (type-check) + jest (unit). This is a build-config/devDep change (analogous to N-023's fast-check add), not FUXA business logic.
  2. **Write client code now as design-faithful but UNVERIFIED-in-env** (type-check/tests deferred until (1) is done). Progresses but violates verify-before-implement; lower confidence. Not recommended.
  3. **Pause client; keep the server module as the verified deliverable** and revisit the cutover (TO-013) once (1) is agreed.
- Status: server module (Tasks 1–13, 164 tests) complete + verified. The path to "live on web" needs the client (Tasks 15–17) which needs option (1) first. Awaiting the user's go-ahead to provision `client/` (npm install + jest test runner) before writing any client code.

### N-044: Client env provisioned — but VERIFIED the FUXA client does NOT build against its own committed dependencies (upstream API drift); blocks the client rebuild/cutover
- Date: 2026-07-15
- Phase: Implementation (Task 15 provisioning — Option 1 of N-043)
- Links: N-043, D-003, D-011, TO-013, `client/package.json`, `client/package-lock.json`, `client/src/app/app.module.ts`, `client/src/app/_services/settings.service.ts`, `client/src/app/cards-view/cards-view.component.ts`
- What was done (provisioning): `npm install` in `client/` first FAILED with `ERESOLVE` — a PRE-EXISTING peer conflict in the committed `package.json`: `@angular-eslint/builder@22.1.0` needs peer `@angular/cli >=22 <23` but the project pins `@angular/cli@18.2.21` (eslint tooling bumped to v22 against Angular 18). Reinstalled with `--legacy-peer-deps` (installs the exact-pinned versions, only bypasses the peer resolver) → **1229 packages added; @angular/core@18.2.14 present**.
- VERIFIED blocker (the reason Task 15 client build/cutover is stuck, independent of the auth work):
  - Type-check baseline `npx tsc -p src/tsconfig.app.json --noEmit --skipLibCheck` = **27 errors, ALL in `src/`, ALL pre-existing source-vs-dependency API mismatches** (NOT auth-related): `ngx-color-picker@20.1.1` has no `ColorPickerModule`; `@ngx-translate/core@18.0.0` has no `TranslateModule` and no `setDefaultLang`; `angular-gridster2@22.0.0` has no `GridsterModule`/`GridsterItemComponentInterface`; `ng2-charts@10.0.0` has no `NgChartsModule` — surfaced in `app.module.ts`, `settings.service.ts`, `cards-view.component.ts`. The committed source (FUXA 1.3.4-2860) references APIs REMOVED in these pinned major versions.
  - The COMMITTED `package-lock.json` (git HEAD) pins the SAME majors (verified: ngx-color-picker 20.1.1, @ngx-translate/core 18.0.0, angular-gridster2 22.0.0, ng2-charts 10.0.0) ⇒ `npm ci` yields the identical broken state. **The committed client therefore does NOT compile against its own committed dependencies**; the shipped `client/dist` is STALE (built from older, source-compatible dep versions before the range/lock bump).
  - (Separately, `--skipLibCheck`-suppressed node_modules `.d.ts` noise: `@types/node@26` is too new for TS 5.4 [Iterator/BuiltinIteratorReturn], `@ctrl/ngx-codemirror`/`xgplayer` typing mismatches — benign for the build, distinct from the src errors.)
- Consequence: `ng build` of the whole client cannot succeed while `app.module.ts` (the root module) fails to compile against the pinned deps. So **rebuilding `client/dist` — required for the cutover to make the module "live on the web" — is BLOCKED by a pre-existing, upstream FUXA-client dependency-migration debt that is entirely outside the auth-management spec and outside the D-003 auth-module boundary.** Auth-management client code (Task 15) can be written and TYPE-CHECKED IN ISOLATION against Angular 18, but cannot be integrated/run until the app builds.
- Cleanup of my own footprint: `npm install` modified `client/package-lock.json`; I RESTORED it (`git checkout -- client/package-lock.json`; `git status` clean). `client/node_modules` (gitignored) is left installed (re-resolved, not lock-exact) purely to enable isolated type-checking; it introduces no git drift.
- Options (decision needed — this is a scope/architecture fork, not an auth-design choice):
  - **A. Client dependency/build remediation (out of auth scope, touches FUXA client platform):** either downgrade the 4 drifted deps to source-compatible versions (edit `package.json` + relock) OR migrate the FUXA client source to the pinned majors (ngx-translate 18 / gridster 22 / ng2-charts 10 / ngx-color-picker 20 APIs). Large; edits FUXA client core (against D-003); it is FUXA-platform maintenance, not auth-management.
  - **B. Deliver Task 15 auth clients with ISOLATED type-check verification (RECOMMENDED for the auth scope):** implement the module-owned `AuthSignInClient`/`UserAdminClient`/`RoleAdminClient` under `client/src/app/auth-management/`, verified by a scoped `tsc --noEmit --skipLibCheck` over ONLY those files (type-correct against real Angular 18) + extract pure mapping/normalization logic into a Node-testable function. Honest partial verification; runtime/TestBed tests + the cutover remain blocked on (A).
  - **C. Pause the client; the verified deliverable is the server module (Tasks 1–13, 164 tests) + composition-root factory.** The cutover awaits (A) as a separate platform effort.
- Recommendation: **B or C.** The build breakage is upstream and outside auth/D-003; fixing it (A) is a FUXA-platform decision, not something to fold silently into the auth spec. I lean **B** (deliver + isolated-verify the auth-scoped client clients) so the auth module's client contract is complete and type-correct, while clearly flagging that "live on web" needs the separate (A) dep remediation. **No auth code written this turn — provisioning + validation only.**


### N-045: Task 15.2/15.3/15.4 — client HTTP clients implemented + verified headlessly (D-036, DV-009)
- Date: 2026-07-15
- Phase: Implementation (Task 15, §07/§08)
- Status: Active
- Links: Task 15.2/15.3/15.4, D-011, D-036, DV-009, N-043, N-044, REQ-11, REQ-12, AC-16.2
- Statement: The module-owned Angular client layer is implemented and verified. Files created under `client/src/app/auth-management/`:
  - `clients/auth-protocol.ts` — PURE, framework-free core: types (`SignInResult`/`UserView`/`RoleOption`/`SignInError`/`AdminError`) + mappers/normalizers (`mapSignInSuccess`, `normalizeSignInError`, `mapUserView`, `mapUsersResponse`, `mapUserResponse`, `mapRolesResponse`, `normalizeAdminError`). NO Angular import.
  - `clients/auth-signin.client.ts` — `AuthSignInClient` (`POST /api/signin`, `Skip-Error` header verified against `_helpers/auth-interceptor.ts`, `map(mapSignInSuccess)`/`catchError(→SignInError)`).
  - `clients/user-admin.client.ts` — `UserAdminClient` (list/get/create/update/delete `/api/users`; hash-free `UserView`; single get null on empty per AC-6.4; `:username` URL-encoded; whitelisted body matching `users.router.js`; `AdminError` normalization).
  - `clients/role-admin.client.ts` — `RoleAdminClient` (list/create/update(PUT `{permissions}`)/delete `/api/roles`; id-based §05 §3.1; delete → `{removed,prunedUsers}`; `AdminError` normalization).
  - `testing/{angular-core,angular-http,endpointapi}.stub.ts` — runtime-only jest stubs (see D-036); `clients/{auth-protocol,auth-clients}.spec.ts` — the two spec suites.
  - `client/jest.config.js` (ts-jest, node env, scoped roots, `moduleNameMapper`) + `client/src/app/auth-management/tsconfig.verify.json` (isolated `tsc` type-check).
- Contract grounding (verified against the server routers I built in Task 13): signin success `{status:'success',data:{token,username,fullname,roles}}`; signin errors 400 `missing_field` / 401 `invalid_credentials` (DV-006 identical for unknown-user+bad-password) / 429 `too_many_attempts`+`retryAfterMs`; users `{status:'success',data:UserView[]|UserView|null}` + admin errors (`duplicate_username`/`validation_error`/`user_not_found`/`last_admin`/`forbidden`/`unauthorized_error`); roles `{status:'success',data:Role[]}` + delete `{removed,prunedUsers}`.
- Verification (run twice, stable): `npx jest` → **2 suites, 22 tests, exit 0** (`auth-protocol.spec.ts` 10 pure-core; `auth-clients.spec.ts` 12 shell-wiring via direct-instantiation stub HttpClient). `npx tsc -p src/app/auth-management/tsconfig.verify.json` → **0 errors** against Angular 18. `git diff client/package.json` = only 3 devDeps added (`jest`,`ts-jest`,`@types/jest`); `package-lock.json` updated accordingly.
- Impact / Risk: Task 15.1 (session-plumbing reuse: guard/interceptor `roles` adaptation) and the FUXA-core `api/index.js` SUPERSEDE cutover (D-014, N-042) remain deferred — hard-coupled to the still-blocked platform rebuild (N-044) and the Login/User-Management components (Tasks 16/17). The client *clients* are nonetheless fully verified and ready to be consumed by those components. NO FUXA core file edited (D-003 preserved).
- Test-mechanism deviation logged as DV-009 (direct-instantiation instead of `HttpClientTestingModule`); test-runner/architecture decision logged as D-036.


### N-046: VERIFIED root cause of N-044 — dependabot bumped the client Angular-ecosystem libs to Angular-21/22-targeting majors on an Angular-18 app
- Date: 2026-07-15
- Phase: Implementation (platform diagnosis; prerequisite for Tasks 15.1/16/17 + D-014 cutover)
- Status: Active — root cause CONFIRMED with converging evidence; remediation is TO-014 / D-037 (proposed, pending confirmation)
- Links: N-044, N-042, N-043, TO-014, D-037, dependabot commit `0c488d5`, initial commit `be8d1e7`
- Statement: N-044 recorded that the committed FUXA client does not build against its own committed deps. The ROOT CAUSE is now verified (not inferred): the automated dependabot commit **`0c488d5`** ("Bump the client-dependencies group across 1 directory with 33 updates") — confirmed an **ancestor of the working branch `auth-user-management-spec`** (`git merge-base --is-ancestor 0c488d5 HEAD` → exit 0) — raised the third-party Angular libraries to majors whose peer requirements target **Angular 21/22**, while the app's own `@angular/*` stayed pinned at **18.2.14** and the source was NOT migrated.
- Evidence (all directly verified, no speculation):
  1. **Installed peer-deps prove forward-targeting:** `client/node_modules/ng2-charts@10.0.0` → `peerDependencies.@angular/core ">=21.0.0"`; `angular-gridster2@22.0.0` → `"^22.0.0"`; `@ngx-translate/core@18.0.0` → `">=18"` and ships ESM-only with the classic `TranslateModule.forRoot` API removed.
  2. **git history** (`git log -- client/package.json`): only two commits touch it — `be8d1e7` "Initial: FUXA + spec…" then `0c488d5` the dependabot bump; the bump is in HEAD's history.
  3. **Initial (`be8d1e7`) = the Angular-18-compatible ground truth** (what the source was written against): `@ngx-translate/core ^14.0.0`, `@ngx-translate/http-loader ^7.0.0`, `angular-gridster2 ^18.0.1`, `ng2-charts ^4.1.1`, `ngx-color-picker ^13.0.0`, `ngx-toastr ^16.2.0`, `@ctrl/ngx-codemirror ^5.1.1`, `codemirror ^5.65.12` (vs current bumped `^18/^18/^22/^10/^20.1.1/^20.0.5/^7/^6`). `@angular/core` unchanged at 18.2.14; `zone.js`/`typescript` unchanged.
  4. **Source uses the removed APIs:** `client/src/app/app.module.ts` imports `{ TranslateModule, TranslateLoader }` and calls `TranslateModule.forRoot({ loader:{…} })`, and imports `NgChartsModule` from `ng2-charts` — both removed in the bumped majors (ngx-translate v16+ → `provideTranslateService`; ng2-charts v6+ → standalone `BaseChartDirective`).
- Impact / Risk: This is a PLATFORM (non-auth) defect, but it BLOCKS the auth module's client verification/rebuild and the D-014 SUPERSEDE cutover (it gates Tasks 15.1 UNVERIFIED, 16, 17). It also confirms `client/dist` is a stale prebuild. It is out of the auth module's D-003 boundary, so its fix (restore the known-good dep set, TO-014/D-037) requires user confirmation before editing `client/package.json` + reinstalling.
- Verification: the converging evidence above; the fix will be verified by an actual `ng build` (0 errors + fresh `client/dist`) once approved.


### N-047: EXECUTED the N-044 remediation (D-037/TO-014) — client build UNBLOCKED, web-view restored
- Date: 2026-07-15
- Phase: Implementation (platform remediation; unblocks Tasks 15.1/16/17 + D-014 cutover)
- Status: Active — DONE + verified
- Links: N-044, N-046, D-037, TO-014, N-045, dependabot `0c488d5`, initial `be8d1e7`
- Statement: With user approval to proceed with the recommendation, executed D-037 (restore the Initial known-good client dependency set, preserving the Task-15 jest devDeps). Steps + verified results:
  1. `git checkout be8d1e7 -- client/package.json client/package-lock.json` → exit 0 (restored the Angular-18-compatible set: ngx-translate ^14 / http-loader ^7 / ng2-charts ^4.1.1 / angular-gridster2 ^18.0.1 / ngx-color-picker ^13 / ngx-toastr ^16.2 / @ctrl/ngx-codemirror ^5.1.1 / codemirror ^5.65.12; also reverted eslint 10→8, typescript-eslint 8→7, @types/node ^26→^18, @angular-eslint 22→18.4.3, etc.).
  2. Re-added additive test devDeps `jest@^29.7.0`, `ts-jest@^29.4.11`, `@types/jest@^29.5.14`.
  3. `npm install` (under `client/`) → exit 0 (removed 113 / added 52 / changed 67 packages; EBADENGINE warnings for Node 24 vs some eslint tooling's Node-18 requirement are non-fatal).
  4. `npm run build` (`ng build`) → **exit 0, 0 compile errors**; fresh `client/dist` produced (verified `client/dist/index.html` exists; initial total 24.01 MB, build hash recorded).
  5. Auth jest suite re-run → **22/22 passing, exit 0** (the dependency downgrade did not regress the Task-15 client tests).
  6. Hygiene edit: added `"app/auth-management/testing/**"` to `client/src/tsconfig.app.json` `exclude` so the jest-only runtime stubs (D-036) are not part of the production compilation; rebuild → exit 0 and the stub "unused" warnings are gone.
- Files changed (all reversible via git): `client/package.json`, `client/package-lock.json` (restored+jest), `client/src/tsconfig.app.json` (exclude test stubs). `client/dist` regenerated (gitignored build output). NO FUXA server-core or runtime logic edited; the only FUXA-core touches are build config (dependency versions + one tsconfig exclude), which is the whole point of the remediation.
- Residuals (recorded, NOT silently dropped):
  1. **Security follow-up (TO-014 mitigation):** `npm audit` reports 72 findings (8 low / 25 moderate / 38 high / 1 critical) on the restored (older) set — expected, because reverting the dependabot bump re-introduces the pre-bump versions. These must be re-patched SELECTIVELY at versions compatible with Angular 18 (e.g. latest 14.x ngx-translate, 4.x/5.x ng2-charts, 18.x gridster) rather than the Angular-21/22 majors. This is a platform follow-up, tracked here; it does NOT block the auth module.
  2. **Node version:** the app builds under Node v24.15.0 despite FUXA's Node-18 target (N-001) and the EBADENGINE warnings; long-term, pin the build to a supported Node (18/20/22) for reproducibility.
  3. **Auth-management UI files still "unused":** `clients/*.ts`, `guards/user-read.guard.ts`, `services/{session.store,module-permission.service}.ts` warn "unused" in the app build until Tasks 16/17 wire them into the routed Login/User-Management pages — expected, not a defect.
- Impact: N-044 RESOLVED. The web-view is buildable again and Tasks 16/17 (Login_Page + User-Management page components) and the D-014 SUPERSEDE cutover (TO-013 Option 1) are no longer dependency-blocked.
- Verification: the exit codes + `client/dist/index.html` existence above. **LIVE-VERIFIED 2026-07-15:** started the FUXA server (`node main.js` in `server/`) — it logged `WebServer is running http://127.0.0.1:1881/` (init 16.5s) — and served the freshly built client over HTTP: `GET /` → **200** (4053-byte Angular `index.html`), and every `ng build` chunk returns 200 (`/index.html`, `/runtime.js`, `/polyfills.js`, `/main.js`, `/vendor.js`, `/styles.css`). This confirms the web-view is not merely buildable but actually served/renderable from the new `client/dist` (verified via `curl.exe -w %{http_code}`, no fabrication). Server confirmed reachable through `server/main.js`'s `www = path.resolve(__dirname,'../client/dist')` static mount.
