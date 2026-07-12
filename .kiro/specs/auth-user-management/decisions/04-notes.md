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
