# SESSION HANDOFF — auth-user-management (FUXA) — 2026-07-13

> **Purpose of this file.** You are continuing this work on a different machine. Read this file
> first, in full, then follow "§0 DO THIS FIRST". This project runs under a **strict anti-drift
> protocol** — there is a persistent decision ledger you MUST obey. Do not improvise, do not
> re-decide silently, do not fabricate. Every claim about FUXA source must be backed by a file read.

---

## 0. DO THIS FIRST (on the new machine, before touching anything)

1. **Pull the branch** (see §7 for git). Confirm the working tree matches the remote.
2. **Read the anti-drift steering**: `.kiro/steering/auth-user-management-antidrift.md` (it auto-loads
   when you open any `auth-user-management/**` file, but read it consciously).
3. **Run the Integrity Check**: open `.kiro/specs/auth-user-management/decisions/00-INDEX.md` and
   execute its §4 procedure (verify every file's markers + ID high-water marks + no cross-domain
   corruption). Then read the WHOLE `decisions/` folder.
4. **Obey `decisions/GATES.md`.** Current gate state: **G0–G4 PASSED; implementation is UNBLOCKED,
   under G5 (per-task Definition of Done).**
5. **Install server deps if missing**: `cd server && npm install` (they were installed on the old
   machine — see §5; a fresh clone will need this because `node_modules` is gitignored).
6. Only then continue implementation (§4 "WHAT REMAINS").

**Working principles the user requires (non-negotiable):**
- Prepare a clear, verifiable design → re-read and validate it → only then implement.
- Fix the **root cause**, never the leaf. A symptom-only patch must be logged as a risk.
- **No fabrication, no speculation.** Verify every FUXA claim against source; else mark `UNVERIFIED`.
- **One step at a time**, each with a precise factual reason; the user approves per step.
- Do **not** economize tokens at the cost of correctness. Aim for commercial-grade, long-term-safe.

---

## 1. WHAT THIS PROJECT IS

FUXA (an open-source SCADA/HMI, version 1.3.4-2860) is the host application in this workspace. We
are adding a commercial-grade **Authentication + User Management + RBAC** capability as a
**self-contained module**, NOT by editing FUXA's core in place.

- **Architecture decision (D-003, CONFIRMED):** the module is a bounded, layered subsystem
  (UI / API / Service / Store) living inside the FUXA workspace. It touches FUXA core **only**
  through thin adapters (JWT helper, bcrypt, user/role store) + a **single** router-mount line.
  Rationale: FUXA will receive upstream upgrades; a bounded module minimizes merge conflicts and is
  independently testable. New server code lives under `server/auth-management/`; new client code
  under `client/src/app/auth-management/`.
- Scope covers 17 requirements (REQ-1…REQ-17): login, token issue/verify, refresh/sign-out, password
  security, user CRUD, RBAC, authorization enforcement, login page, user-management page,
  serialization round-trip, audit logging, brute-force protection, modular architecture, and
  administrator bootstrap.

---

## 2. THE LEDGER — your source of truth (the "4 things" the user asked for)

Folder: `.kiro/specs/auth-user-management/decisions/`

| File | Holds | High-water mark |
|------|-------|-----------------|
| `01-ai-decisions.md` | AI decisions the spec didn't state (D-001…**D-023**) | D-023 |
| `02-deviations.md`   | Where AI changed vs. the original request (DV-001…**DV-008**) | DV-008 |
| `03-tradeoffs.md`    | Trade-offs weighed (TO-001…**TO-011**; **TO-003 QUARANTINED**, never reuse) | TO-011 |
| `04-notes.md`        | Facts/risks/gotchas you should know (N-001…**N-024**) | N-024 |
| `traceability.md`    | Anti-drift engine: REQ⇄DES⇄TASK⇄TEST (§A–§G) | — |
| `00-INDEX.md`        | Integrity manifest + §4 Integrity Check + §2 ID high-water + §3 incident log | — |
| `GATES.md`           | Phase gates G0–G5 + the resolution roadmap + current position | — |
| `README.md`          | Ledger rules + ID scheme + anti-drift protocol §4 | — |

**Hard rules:** ledger files are **append-only** (never overwrite; mark superseded, never delete/reuse
an ID). Respect the high-water marks above. `TO-003` is a quarantined tombstone.

---

## 3. WHAT HAS BEEN DONE (verified on disk 2026-07-13, note N-024)

### 3a. Design defect resolution — COMPLETE
A deep review found 11 latent design defects (N-010…N-019, N-021) and 3 requirement refinements
(DV-006/007/008). ALL are now RESOLVED and enacted in the design/requirements. Decisions D-014…D-023
are all `Active (CONFIRMED)`. Summary:

- **Wave A (CRITICAL, gate G2 — PASSED):** N-010 persistence atomicity (D-016), N-011 live session
  authority (D-015 + P-013), N-012 bcrypt-72-byte / false P-002 (D-017 + DV-007), N-014 router
  cutover SUPERSEDE (D-014 + P-014), N-013 rotate-password endpoint (D-018).
- **Wave B (HIGH, gate G4 — PASSED):** N-015 refresh rotation + reuse detection RFC 9700 (D-019 +
  P-015), N-016 concurrency TOCTOU (D-020 + P-016), N-017 JWT hardening (D-021), N-018 bootstrap
  secret to log (D-022 secure enrollment channel).
- **Wave C (MEDIUM):** N-019 brute-force shared store + adaptive throttle (DV-008), D-023 dedicated
  audit sink, DV-006 uniform-401 enumeration hardening, N-021 traceability §D populated (G3).

### 3b. Gates — G0…G4 PASSED
Implementation is UNBLOCKED under **G5** (per-task DoD). See `GATES.md` for the exact checklist.

### 3c. Foundational code implemented (matches the CORRECTED design)
Under `server/auth-management/`:
- `models/` — `user-record.js`, `role.js`, `permission.js`, `audit-event.js` (INV-1…INV-8) — task 1.1
- `store/serialization.js` — resilient JSON parse — task 2.1 (+ `store/*.interface.js`, `services/interfaces.js`)
- `adapters/fuxa-bcrypt.adapter.js` — sole `bcryptjs` importer — task 3.1
- `adapters/fuxa-jwt.adapter.js` — sole `jsonwebtoken`/`jwt-helper` importer — task 5.1
- `services/brute-force.js` — adaptive backoff + pluggable `BruteForceStore` + monotonic clock — task 6.1
- `services/audit-logger.js` — dedicated `fuxa-audit.log` winston sink + `health()` + fallback + hash-chain — task 11.1
- `index.js` — composition-root placeholder

Under `client/src/app/auth-management/`:
- `services/session.store.ts` — reuses FUXA session plumbing, first-class `roles` (D-007) — task 15.1
- `services/module-permission.service.ts`, `guards/user-read.guard.ts` — management-route gate

Tests: `server/test/auth-management/serialization.test.js` (task 2.2 P-005 area). **Note:** most
implemented code was verified only via inline "node sanity" checks while deps were absent; the real
`mocha`/`fast-check` suites still need to run (see §4).

### 3d. Anti-drift infrastructure — hardened this session (N-024)
Five layers now: (1) auto-loaded steering, (2) `00-INDEX` integrity manifest + check, (3) `GATES`
phase gates, (4) **NEW automatic save-time guard hook** `.kiro/hooks/auth-um-save-time-integrity-guard.kiro.hook`
(fires a read-only Integrity Check whenever a `decisions/**`, `design/**`, `requirements.md`, or
`tasks.md` file is saved — closes the N-020 silent-overwrite gap), (5) on-demand deep-audit hook
`.kiro/hooks/auth-um-antidrift-audit.kiro.hook` (`userTriggered`).

Two stale-annotation drifts were found and corrected this session (recorded in `00-INDEX §3` +
N-024): `00-INDEX §2` still said D-014…D-023/DV-006…DV-008 were "OPEN" (→ CONFIRMED); `N-022`
claimed deps absent (→ RESOLVED, deps now present).

---

## 4. WHAT REMAINS (under G5) — the plan

The full task list + dependency wave graph is in `.kiro/specs/auth-user-management/tasks.md`, and the
Design→Task→Test map is `traceability.md` §D. Task status markers there: `[x]` done, `[~]`
in-progress, `[ ]` not started, `*` = optional test sub-task.

**RECOMMENDED NEXT STEP (do this first) — establish a verified-green test baseline.**
Reason: adapters/services in §3c are marked implemented but their real test suites have never
executed (deps were absent → only "node sanity"). Deps are now installed. Building the store layer
and everything above on an un-run foundation is "building on sand" — against the user's root-cause
principle. Run/author the foundational tests first: 3.3/3.4/3.5 (Password_Hasher props P-001/P-002),
6.2/6.3 (brute-force P-012 + edges), 11.3/11.4 (audit + dedicated-sink/health), 2.2 (serialization
P-005, test file already exists). Convert those `traceability §D` rows to `tested`.

**THEN, bottom-up implementation order (per tasks.md waves):**
1. **Task 2 — Store layer:** finish 2.3 `FuxaUserStoreAdapter` + 2.4 `FuxaRoleStoreAdapter`; then
   **2.8** (D-016 single-transaction atomic write, fixes N-010), **2.9** (D-020 atomic create +
   last-admin `BEGIN IMMEDIATE`, fixes N-016); tests 2.5/2.6/2.7/**2.10** (P-016 concurrency).
2. **Task 3 — Password_Hasher:** 3.2 service (D-017 bounded ≤72-byte domain policy site is §04).
3. **Task 5 — Token_Service:** 5.2 issue/verify/refresh + expiry table; **5.6** (D-021 JWT
   hardening + `tokenVersion` stamp), **5.7** (D-019 `Refresh_Token_Store` + reuse detection).
4. **Task 7 — Authentication_Service:** 7.1 (incl. DV-006 uniform-401 + dummy-hash timing).
5. **Task 8 — RBAC:** 8.1 Role_Service, 8.2 Authorization_Service + `isAdministrator` (D-015 live
   authority); prop 8.6 (P-013).
6. **Task 9 — User_Service:** 9.1 CRUD + AC-4.6/4.7 password policy + last-admin guard.
7. **Task 11 — Audit:** 11.2 emission wiring into services.
8. **Task 12 — Bootstrap:** 12.1 runBootstrap, **12.7** (D-022 secure enrollment channel), 12.2
   rotatePassword/Account_Service, 12.3 migration remediation.
9. **Task 13 — API layer:** 13.1 authz middleware (D-015), 13.2 auth router, 13.3 users router,
   13.4 roles router, **13.5** composition root + **SUPERSEDE cutover** (D-014), **13.7** account
   router `POST /api/account/rotate-password` (D-018); prop 13.8 (P-014).
10. **Tasks 15–17 — Client:** 15.2 AuthSignInClient, 15.3 admin clients; 16.x routed Login_Page;
    17.x User-Management page + SUPERSEDE cutover.
- Checkpoints: tasks 4, 10, 14, 18 (review gates, no design mapping).

**G5 Definition of Done per task:** code matches the corrected design section it cites; touches FUXA
core only via the D-003 seams; tests green incl. ≥100-iter property tests + concurrency/security
tests; flip the `traceability §D` row to `implemented`/`tested`; log any newly-found deviation
(`N-*`/`DV-*`) BEFORE merging.

---

## 5. ENVIRONMENT FACTS (verified)

- OS: **Windows**; shell: PowerShell / cmd. (Console multi-line output can truncate — prefer writing
  results to a file and reading back, per N-001.)
- Node/npm: recorded as **v25.2.1 / 11.6.2** (N-001, 2026-07-13) and **v24.15.0** on a later check
  (N-023). FUXA's Dockerfile targets Node 18 — a version mismatch to keep in mind for native modules
  (`sqlite3`, `serialport`).
- **Server deps INSTALLED** under `server/node_modules` (verified 2026-07-13, N-024):
  `winston`, `bcryptjs`, `jsonwebtoken`, `mocha@10.8.2`, `sinon@19.0.2`, `sqlite3`, and
  **`fast-check@3.23.2`** (added as a devDependency for PBT — N-023). `chai@5` is ESM-only, so
  module tests use Node's built-in **`node:assert`** (CommonJS) + `sinon` + `fast-check`, NOT chai.
- Runtime data lives outside source (`_db`, `_logs` under FUXA_APPDATA) — survives upgrades; code
  needs git to survive upgrades (N-003).
- The `server/package.json` + `package-lock.json` were modified only to add the pinned `fast-check`
  devDependency (within the D-003 build-config boundary).

---

## 6. KEY GOTCHAS / DO-NOT-REPEAT

- **N-020 incident:** a ledger file was once overwritten with a chat transcript. Never overwrite a
  ledger file wholesale. The new save-time guard hook now watches for this.
- **Router shadowing (N-014):** FUXA registers `/api/signin`, `/api/refresh`, `/api/signout`,
  `/api/users`, `/api/roles` before any module router. The module SUPERSEDES them (D-014) — you must
  STOP mounting FUXA's overlapping routers and mount the module router, or it becomes dead code.
- **Double-hash hazard (D-010/D-016):** FUXA's `setUser` re-hashes any truthy `pwd`. The adapter
  writes the password hash verbatim via its own transaction and calls `setUsers` with password
  omitted (cache refresh only) — never pass the hash to `setUser`.
- **bcrypt 72-byte truncation (N-012):** P-002 is only true over the ≤72-byte domain; the User_Service
  must reject >72-byte passwords (AC-4.6) before hashing.
- **Live authority (N-011/D-015):** build `Identity` from the live `User_Record` each request, not
  from token claims; check `tokenVersion` for active revocation.

---

## 7. GIT — how the code was pushed (for the new machine)

- Repo remote is named **`orgin`** (note: misspelled, not `origin`) →
  `github.com/mgcoder9x/fuxa-scada.git`. The remote URL has an embedded access token in git config on
  the old machine; the new machine will need its own credentials/token to push.
- All this session's work was committed and pushed to a dedicated branch:
  **`auth-user-management-spec`** (see the commit for the exact scope).
- On the new machine:
  ```
  git fetch orgin
  git checkout auth-user-management-spec
  cd server && npm install
  ```
- `node_modules` is gitignored — always `npm install` after a fresh checkout.
- Untracked-then-added in this push: `.kiro/hooks/`, `.kiro/steering/`, `.kiro/specs/.../decisions/00-INDEX.md`,
  `.../GATES.md`, `server/auth-management/`, `server/test/auth-management/`, `client/src/app/auth-management/`,
  and this `end.md`.

---

## 8. ONE-PARAGRAPH SUMMARY (if you read nothing else)

FUXA auth module: design is fully corrected and defect-free (G0–G4 passed, all of N-010…N-021 +
DV-006/007/008 resolved, decisions D-014…D-023 confirmed). Foundational code (models, serialization,
bcrypt/JWT adapters, brute-force guard, audit logger, client session plumbing) is implemented and
matches the corrected design, but its real test suites have not been run yet. You are under **G5**:
first run/author the foundational tests to get a verified-green baseline, then continue bottom-up
from **Task 2 (store layer)** per `tasks.md`. Obey the ledger in `.kiro/specs/auth-user-management/decisions/`
— append-only, root-cause fixes, verify everything, one step at a time. Start with §0 above.
