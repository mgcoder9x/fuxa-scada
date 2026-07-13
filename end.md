# SESSION HANDOFF — auth-user-management (FUXA) — updated 2026-07-13 (session 3)

> **Purpose of this file.** You are continuing this work on a different machine. Read this file
> first, in full, then follow "§0 DO THIS FIRST". This project runs under a **strict anti-drift
> protocol** — there is a persistent decision ledger you MUST obey. Do not improvise, do not
> re-decide silently, do not fabricate. Every claim about FUXA source must be backed by a file read.

---

## 0. DO THIS FIRST (on the new machine, before touching anything)

1. **Pull the branch** (see §7 for git). Confirm the working tree matches the remote.
2. **Read the anti-drift steering**: `.kiro/steering/auth-user-management-antidrift.md` (auto-loads
   when you open any `auth-user-management/**` file, but read it consciously).
3. **Run the Integrity Check**: open `.kiro/specs/auth-user-management/decisions/00-INDEX.md` and
   execute its §4 procedure (verify every file's markers + ID high-water marks + no cross-domain
   corruption). Then read the WHOLE `decisions/` folder.
4. **Obey `decisions/GATES.md`.** Current gate state: **G0–G4 PASSED; implementation is UNBLOCKED,
   under G5 (per-task Definition of Done).**
5. **Install server deps if missing**: `cd server && npm install`, THEN confirm
   `Test-Path server/node_modules/fast-check` = True and its version = **3.23.2** (a fresh checkout
   carries the base install but not always the separately-added `fast-check` devDep — see N-025).
   `node_modules` is gitignored.
6. **Recreate the temp test runner** (deleted at each session end — see §5 "test-runner method").
7. Only then continue implementation (§4 "WHAT REMAINS"). Next up: **Task 5 — Token_Service**.

**Working principles the user requires (non-negotiable):**
- Prepare a clear, verifiable design → re-read and validate it → only then implement.
- Fix the **root cause**, never the leaf. A symptom-only patch must be logged as a risk.
- **No fabrication, no speculation.** Verify every FUXA/library claim against source or a run; else
  mark `UNVERIFIED`.
- **One step at a time**, each with a precise factual reason; the user approves per step (the user
  repeatedly says "cực sâu để tiếp tục chính xác nhất" = continue deeply/accurately — standing
  approval to proceed carefully).
- Do **not** economize tokens at the cost of correctness. Commercial-grade, long-term-safe.
- Respond in **Vietnamese**.

---

## 1. WHAT THIS PROJECT IS

FUXA (open-source SCADA/HMI, version **1.3.4-2860**) is the host app in this workspace. We are
adding a commercial-grade **Authentication + User Management + RBAC** capability as a
**self-contained module**, NOT by editing FUXA's core in place.

- **Architecture (D-003, CONFIRMED):** a bounded, layered subsystem (UI / API / Service / Store)
  inside the FUXA workspace, touching FUXA core **only** through thin adapters (JWT helper, bcrypt,
  user/role store) + a **single** router-mount line. New server code under `server/auth-management/`;
  new client code under `client/src/app/auth-management/`.
- Scope = 17 requirements (REQ-1…REQ-17).

---

## 2. THE LEDGER — your source of truth ("the 4 things")

Folder: `.kiro/specs/auth-user-management/decisions/`

| File | Holds | High-water mark (CURRENT) |
|------|-------|---------------------------|
| `01-ai-decisions.md` | AI decisions the spec didn't state (D-001…**D-025**) | **D-025** |
| `02-deviations.md`   | Where AI changed vs. the original request (DV-001…**DV-008**) | **DV-008** |
| `03-tradeoffs.md`    | Trade-offs weighed (TO-001…**TO-011**; **TO-003 QUARANTINED**, never reuse) | **TO-011** |
| `04-notes.md`        | Facts/risks/gotchas (N-001…**N-027**) | **N-027** |
| `traceability.md`    | Anti-drift engine: REQ⇄DES⇄TASK⇄TEST (§A–§G); §D is the live Design→Task→Test status | — |
| `00-INDEX.md`        | Integrity manifest + §4 Integrity Check + §2 ID high-water + §3 incident log | — |
| `GATES.md`           | Phase gates G0–G5 + roadmap + current position | — |
| `README.md`          | Ledger rules + ID scheme + anti-drift protocol §4 | — |
| Properties `P-`      | P-001…**P-016** | **P-016** |

**Hard rules:** ledger files are **append-only** (never overwrite; mark superseded, never
delete/reuse an ID). Respect the high-water marks above. `TO-003` is a quarantined tombstone.
ON EXIT of any turn that changed anything: update the relevant ledger entry + traceability §D/§F +
`00-INDEX §2` high-water; log new defects/decisions BEFORE finishing; re-run the Integrity Check if
a ledger file was touched.

---

## 3. WHAT HAS BEEN DONE (verified on disk 2026-07-13)

### 3a. Design defect resolution — COMPLETE (unchanged)
All 11 latent design defects (N-010…N-019, N-021) + 3 requirement refinements (DV-006/007/008) are
RESOLVED and enacted. Decisions D-014…D-023 are all `Active (CONFIRMED)`. Gates **G0–G4 PASSED**.

### 3b. Implementation progress under G5 — code + REAL tests GREEN

**Test toolchain (N-023/N-025):** `mocha@10.8.2` + Node's built-in **`node:assert/strict`** (chai@5
is ESM-only, do NOT use it) + `sinon` + **`fast-check@3.23.2`** for PBT. Run via a **temp
programmatic Mocha runner** (see §5). **Full auth-management suite currently: 42 passing.**

Completed + verified this session (in bottom-up order):

- **Task 1 (models/scaffolding)** — done earlier (`models/`, interfaces, `store/serialization.js`).
- **Task 2 — Store layer (§06) — DONE + TESTED.**
  - `store/fuxa-auth-db.js` — module-owned `sqlite3` connection to `users.fuxap.db` (WAL +
    busy_timeout, `BEGIN IMMEDIATE` transaction helper, generic `DuplicateKeyError` code
    `duplicate_key`). Required because FUXA exposes no raw-SQL/db-handle (verified) and `setUser`
    re-hashes any truthy pwd (the double-hash hazard).
  - `adapters/fuxa-user-store.adapter.js` (2.3/2.8) — `get`/`readAll`/`create`/`update`/`delete`;
    **D-016** single-transaction full-row verbatim-hash write on its own connection + best-effort
    `setUsers(pwd-omitted)` cache refresh; retain-on-omit (AC-7.3); `info↔{roles,metadata}`
    split/compose; resilient `readAll`; `get` fails **closed** on corrupt `info` (**N-026**).
  - `adapters/fuxa-role-store.adapter.js` (2.4) — `Role↔roles(name=id,value=JSON)`; resilient
    `readAll` closes the FUXA `getRoles` no-try/catch gap (N-009); plain-INSERT create = atomic
    dup rejection (AC-9.5); delete prunes `info.roles` via `runtime.users.removeRoles` or an
    own-connection fallback.
  - `test/auth-management/store-adapters.test.js` — **11 passing**: **P-003** user round-trip +
    **P-004** role round-trip @150 iters (real temp sqlite), double-hash regression, retain-on-omit,
    atomic dup reject (user+role, no mutation), resilient readAll (user+role gap), get fail-closed,
    role-delete prune, delete-removes-row.
  - **D-024** logged: store adapters read via their OWN connection (identical SELECT to FUXA;
    faithful to D-015 "authority from the store"), `runtime.users` used only for best-effort cache
    coherence; role `create` uses plain INSERT (AC-9.5). Active (CONFIRMED, test-verified).
  - **PARTIAL 2.9 / DEFERRED 2.10:** the atomic-create half of D-020 is done+tested; the last-admin
    `BEGIN IMMEDIATE` guard + **P-016** concurrency property are DEFERRED to **Task 9**
    (`User_Service.delete` is the transaction site). `FuxaAuthDb.transaction()` provides the
    `BEGIN IMMEDIATE` primitive it will use.
- **Task 3 — Password_Hasher (§03) — DONE + TESTED.**
  - `adapters/fuxa-bcrypt.adapter.js` (3.1, pre-existing) — SOLE `bcryptjs` importer; cost default
    12 (D-008), tests pass 4.
  - `services/password-hasher.js` (3.2) — injects the Hash-seam adapter (NO bcrypt import); `hash`
    total/salted; `verify` defensive→false (never throws).
  - **D-025 / N-027 — VERIFIED SECURITY FIX (important):** a **lone UTF-16 surrogate** makes
    `bcryptjs` burn **~9.6s then throw** `RangeError` in its UTF-8 encoder (measured 9578ms,
    cost-independent). It is reachable UNAUTHENTICATED via the login API
    (`JSON.parse('{"password":"\uD83D"}')`) + the DV-006 dummy-hash path → asymmetric CPU-DoS; the
    ≤72-byte check does NOT protect (Node counts a lone surrogate as 3 bytes). FIX at the single
    Hash seam: `verify` rejects a lone-surrogate plaintext with an immediate `false` (a malformed
    string can never equal a well-formed stored password); `hash` throws
    `invalid_password_encoding` fast. **Follow-up REQUIRED (D-025):** User_Service (9.1) +
    Authentication_Service (7.1) must ALSO reject malformed UTF-16 at the boundary
    (defense-in-depth); the hasher guard is the backstop.
  - `test/auth-management/password-hasher.test.js` — **7 passing**: **P-001** @150 iters (own-plaintext
    verify + two-hashes-differ random-salt witness); **P-002** @150 iters over the ≤72-byte
    **well-formed** domain (generator is rejection-free + code-point-safe — mode-1 drops the last
    CODE POINT, never fabricating a lone surrogate); empty-string base; defensive verify;
    malformed-UTF-16 fast-reject regression guard (<1000ms); FUXA cost-10 interop; unconfigured
    seam = cost 12.

Earlier "node sanity only" foundational code that now has REAL green tests:
`serialization.test.js` (P-005, 5 passing), `brute-force.test.js` (P-012 @200 iters + edges,
9 passing), `audit-logger.test.js` (11.3/11.4, 10 passing — closes the N-022 dedicated-file residual
via a real winston File transport). `adapters/fuxa-jwt.adapter.js` (5.1) exists but its real crypto
round-trip is still only shim-verified (run it under Task 5).

### 3c. Anti-drift infrastructure — unchanged (5 layers)
(1) auto-loaded steering, (2) `00-INDEX` manifest + §4 check, (3) `GATES` phase gates, (4) save-time
integrity guard hook, (5) on-demand deep-audit hook.

---

## 4. WHAT REMAINS (under G5) — the plan

Full task list + wave graph in `tasks.md`; live status in `traceability.md` §D. Markers: `[x]` done,
`[~]` in-progress, `[ ]` not started, `*` = optional test sub-task.

**Done:** Task 1, **Task 2** (store; 2.9 last-admin half + 2.10 deferred to Task 9), **Task 3**
(hasher), Task 6 (brute-force), Task 11.1/11.3/11.4 (audit), Task 15.1 (client session plumbing).

**RECOMMENDED NEXT STEP — Task 5 (Token_Service, §02):**
1. **5.2** `services/token.service.js` — `issueAccessToken({username,groups,roles})` encoding
   `{id,groups,roles}` (D-007); `issueRefreshToken`; `verify(token)→VerifyResult` (authenticated iff
   signature valid AND unexpired; expose id/groups/roles); `refresh(refreshToken)→RefreshOutcome`.
   Implement the §4 expiry decision table (configured → default finite 1h → dev-only non-expiring,
   guarded/loud; never a silent non-expiry).
2. **5.6** JWT hardening (**D-021**): pin `algorithms` on verify, add+validate `iss/aud/sub/jti/typ`,
   `kid` for rotation, stamp `tokenVersion` (so D-015 can revoke).
3. **5.7** stateful `Refresh_Token_Store` (**D-019**, RFC 9700): hashed-at-rest,
   `family/jti/parent_jti/state`, atomic consume-and-rotate, reuse detection revokes the family,
   `tokenVersion` check.
4. Tests **5.3\* (P-007)**, **5.4\* (P-008)**, 5.5\* (refresh/sign-out units), **5.8\* (P-015)**.
   `adapters/fuxa-jwt.adapter.js` (5.1) already exists — verify its real crypto round-trip here.

**THEN (bottom-up):** Task 7 (Authentication_Service — incl. DV-006 uniform-401 + dummy-hash timing,
AND the D-025 malformed-UTF-16 boundary reject); Task 8 (RBAC — Role_Service + Authorization_Service,
D-015 live authority, P-013); **Task 9** (User_Service CRUD — incl. AC-4.6/4.7 password policy, the
D-025 boundary reject, the last-admin `BEGIN IMMEDIATE` guard + **P-016** deferred from Task 2, and
**P-010**); Task 11.2 (audit emission wiring); Task 12 (bootstrap + D-022 secure enrollment +
rotate + migration); Task 13 (API routers + authz middleware D-015 + **SUPERSEDE cutover D-014** +
account router D-018 + P-014); Tasks 15–17 (client Login + User-Management pages + client cutover).
Checkpoints: tasks 4, 10, 14, 18.

**G5 Definition of Done per task:** code matches the corrected design section it cites; touches FUXA
core only via the D-003 seams; tests green incl. ≥100-iter property tests + concurrency/security
tests; flip the `traceability §D` row to `implemented`/`tested`; log any newly-found deviation
(`N-*`/`D-*`/`DV-*`) BEFORE merging.

---

## 5. ENVIRONMENT FACTS (verified this session)

- OS: **Windows**; shell: PowerShell / cmd. Console multi-line output truncates and complex
  `node -e` escaping breaks (N-001) — **write results to a file and read back**; for tricky probes
  write a temp `.js` file and run `node file.js` (delete after).
- Node: **v25.2.1** on this machine (FUXA's Dockerfile targets Node 18 — mismatch to watch for
  native modules `sqlite3`/`serialport`, but everything runs).
- **Server deps present** under `server/node_modules`: `winston`, `bcryptjs`, `jsonwebtoken`,
  `mocha@10.8.2`, `sinon`, `sqlite3`, `fast-check@3.23.2`. `node_modules` is gitignored — always
  `npm install` after a fresh checkout AND re-confirm `fast-check@3.23.2` (N-025).
- Runtime data (`_db`, `_logs`) lives outside source under FUXA_APPDATA — survives upgrades; code
  needs git to survive upgrades.
- **Test-runner method (N-025) — RELIABLE, recreate each session:** `npx mocha` / `.bin/mocha.cmd`
  triggers an interactive `mocha@11` install and locks output files. Instead, create a temp
  `server/_run.js`:
  ```js
  'use strict';
  const Mocha = require('mocha'); const path = require('path');
  const files = process.argv.slice(2);
  const mocha = new Mocha({ timeout: 40000, reporter: 'spec' });
  for (const f of files) mocha.addFile(path.resolve(process.cwd(), f));
  mocha.run((failures) => { process.on('exit', () => process.exit(failures ? 1 : 0)); });
  ```
  Run from `server/`:
  `node _run.js test/auth-management/<file>.test.js *> ..\out.txt` then read `out.txt`. Use a FRESH
  output filename each run. **Delete `server/_run.js` and the `*.txt` outputs at session end**
  (they are temp, not committed).

---

## 6. KEY GOTCHAS / DO-NOT-REPEAT

- **Ledger append-only (N-020).** Never overwrite a ledger file wholesale.
- **Router shadowing (N-014/D-014).** FUXA registers `/api/signin`, `/api/refresh`, `/api/signout`,
  `/api/users`, `/api/roles` first; the module must SUPERSEDE (stop mounting FUXA's overlapping
  routers) at the composition root (Task 13.5) or it becomes dead code.
- **Double-hash hazard (D-010/D-016).** FUXA `setUser` re-hashes any truthy `pwd`. The store adapter
  writes the hash verbatim on its OWN connection and only calls `setUsers` with password omitted
  (cache refresh). Never pass a hash to `setUser`.
- **bcrypt 72-byte truncation (N-012/D-017).** P-002 holds only over ≤72 UTF-8 bytes; User_Service
  (9.1) rejects >72-byte passwords before hashing (AC-4.6).
- **bcryptjs lone-surrogate DoS (N-027/D-025) — NEW.** Malformed UTF-16 (a lone surrogate) makes
  bcryptjs burn ~9.6s then throw; reachable unauthenticated via login JSON + DV-006 dummy-hash.
  Fixed at the Password_Hasher seam (verify→false fast, hash→throws); User_Service 9.1 +
  Authentication_Service 7.1 MUST also reject malformed UTF-16 at the boundary.
- **Live authority (N-011/D-015).** Build `Identity` from the live `User_Record` each request, not
  from token claims; check `tokenVersion` for active revocation.
- **Store reads via own connection (D-024).** The adapters read through their own sqlite connection
  (identical SELECT to FUXA); `runtime.users` is only the best-effort cache-coherence collaborator.

---

## 7. GIT — how to sync (for the new machine)

- Remote name is **`origin`** (verified 2026-07-13 via `git remote -v`) →
  `github.com/mgcoder9x/fuxa-scada.git`. Work branch: **`auth-user-management-spec`**. (A prior push
  had a PAT embedded in the URL; it was removed from `.git/config` and the user was told to revoke
  it — use your own credentials/token.)
- On the new machine:
  ```
  git fetch origin
  git checkout auth-user-management-spec
  git pull origin auth-user-management-spec
  cd server && npm install
  ```
- `node_modules` is gitignored — always `npm install` after checkout; re-confirm `fast-check@3.23.2`.
- This session added: `server/auth-management/store/fuxa-auth-db.js`,
  `server/auth-management/adapters/fuxa-user-store.adapter.js`,
  `server/auth-management/adapters/fuxa-role-store.adapter.js`,
  `server/auth-management/services/password-hasher.js`,
  `server/test/auth-management/store-adapters.test.js`,
  `server/test/auth-management/password-hasher.test.js`, plus ledger updates (D-024/D-025,
  N-025/N-026/N-027, traceability §D, 00-INDEX high-water, tasks.md 2.x/3.x) and this `end.md`.

---

## 8. ONE-PARAGRAPH SUMMARY

FUXA auth module: design fully corrected (G0–G4 passed). Implementation under G5 is progressing
bottom-up with REAL green property tests (42 passing): models + serialization + **store layer
(Task 2)** + **Password_Hasher (Task 3)** + brute-force + audit + client session plumbing are done
and tested. Two implementation-time decisions were logged (D-024 store own-connection reads; D-025
malformed-UTF-16 guard) and one VERIFIED security defect found via PBT and fixed at root (N-027:
bcryptjs ~9.6s lone-surrogate DoS). Next is **Task 5 (Token_Service)**, then Authentication → RBAC →
User_Service (which also owns the deferred last-admin P-016 + the D-025 boundary reject) → audit
wiring → bootstrap → API cutover → client UI. Obey the append-only ledger, fix root causes, verify
everything, one step at a time. Start at §0.
