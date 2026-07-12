# 01 — AI Decisions (not explicitly stated by the user/spec)

> Choices the agent made to fill gaps the user did not specify. Schema in `README.md` §3.

### D-001: Organize the module into four layers (UI / API / Service / Store)
- Date: 2026-07-12
- Phase: Requirements
- Status: Active
- Links: REQ-16, AC-16.1..16.5
- Context: User asked for "module mọi thứ rõ ràng" (clearly separated modules) for a very large system, but did not name the layers.
- Statement: The module is decomposed into UI layer, API layer, Service layer, Store layer, with each service (Authentication/User/Role/Authorization) exposing an interface that hides storage details.
- Rationale: Layer separation is the standard mechanism that lets each concern evolve and be tested independently; it is the concrete form of the user's stated modularity goal. It also confines FUXA-coupling to thin adapters (see D-002/D-003).
- Alternatives considered: (a) Single-service auth module — rejected: does not scale to "hệ thống cực lớn" and mixes concerns. (b) Micro-frontend/microservice split now — rejected: premature; adds ops complexity before requirements justify it.
- Impact / Risk: More files/indirection up front; justified by testability and long-term maintainability.
- Verification: design/ must contain distinct sections for each layer; tasks must not let API touch the store directly (AC-16.3).

### D-002: Reuse FUXA's existing security primitives (JWT, bcrypt, user/role store)
- Date: 2026-07-12
- Phase: Requirements
- Status: Active
- Links: REQ-2, REQ-4, REQ-13
- Context: FUXA already ships `server/api/auth`, `server/api/jwt-helper.js`, `server/runtime/users`.
- Statement: The module reuses `jsonwebtoken`, `bcryptjs`, and the existing user/role persistence rather than introducing new libraries or a new datastore.
- Rationale: These primitives are already present, dependency-pinned, and exercised by FUXA. Reusing them reduces new attack surface, avoids duplicate/competing auth stacks, and keeps a single credential store. (Verified: primitives present in `server/package.json` — `jsonwebtoken@^9.0.3`, `bcryptjs@2.4.3`.)
- Alternatives considered: Introduce Passport.js / a dedicated auth DB — rejected for now: adds surface and migration cost without a requirement demanding it. Revisit if SSO/OAuth becomes a requirement.
- Impact / Risk: Couples the module to FUXA internals; mitigated by wrapping them behind the Service/Store interfaces (D-001) so they can be swapped later (AC-16.5).
- Verification: design shows adapters over FUXA primitives; swapping the store must not change service interfaces.

### D-004: Requirements-analysis auto-resolutions adopted as design constraints
- Date: 2026-07-12
- Phase: Requirements
- Status: Active
- Links: REQ-2 (AC-2.7), REQ-11 (AC-11), REQ-14 (AC-14.5), REQ-16 (AC-16.4)
- Context: The requirements analysis pass proposed answers the user did not originally give; these were folded into the acceptance criteria.
- Statement: Adopted — (a) tokens do not expire when no expiry is configured (AC-2.7); (b) the Login Page validates inputs client-side before submitting (AC-11); (c) each calling service sanitizes secrets out of audit events (AC-14.5); (d) the API fails fast when the service layer is unavailable (AC-16.4).
- Rationale: Each makes an otherwise-underspecified behavior concrete and testable. (a) and (d) also carry risk — logged as trade-offs TO-002 / TO-004.
- Alternatives considered: Leave unspecified — rejected: unspecified security behavior is a drift/ambiguity source.
- Impact / Risk: (a) non-expiring tokens is a security concern → TO-002.
- Verification: cross-check each cited AC remains present and unweakened through design and tests.

### D-005: Default administrator bootstrap (needs design detail)
- Date: 2026-07-12
- Phase: Requirements
- Status: OPEN (to be detailed in design; confirm with user)
- Links: REQ-5, REQ-9, REQ-10 (AC-10.4)
- Context: RBAC and user CRUD require an Administrator to exist, but "how the very first admin comes to exist" is unspecified. This is a classic bootstrap gap.
- Statement: Proposed — seed a single default administrator on first run if the user store is empty, forcing a password change on first login.
- Rationale: Without a bootstrap admin, no one can create users or roles (chicken-and-egg). Forcing a password change avoids shipping a known default credential.
- Alternatives considered: CLI-created first admin; env-var seeded credentials. To be weighed in design (TO-005 placeholder).
- Impact / Risk: A default credential window is a security risk if the forced-change step is skipped.
- Verification: design must specify the exact bootstrap + forced-rotation flow; a test must prove the default credential cannot be used without rotation.

### D-003: Architecture scope = self-contained module inside FUXA, via thin adapters
- Date: 2026-07-12
- Phase: Requirements
- Status: Active (CONFIRMED by user 2026-07-12)
- Links: REQ-16, N-005, TO-001
- Context: Fundamental fork — build the auth/user-management logic as a bounded module vs. edit FUXA's existing auth code in place vs. a fully separate project.
- Statement: The module is a self-contained, layered subsystem living inside the FUXA workspace. It touches FUXA core only through thin adapters (over JWT helper, bcrypt, and the user/role store). It is NOT edited into FUXA's route handlers in place, and it is NOT a separate project.
- Rationale (all factual):
  1. The workspace is not a git repo and is intended to receive future FUXA upgrades (N-001). A bounded module touches few FUXA core files → far fewer merge conflicts on `git merge origin/master`.
  2. Logic behind service/store interfaces is directly PBT-testable; logic tangled into FUXA handlers is not (user requirement: "valid nhiều lần").
  3. Independent replaceability/scaling for a commercial system (AC-16.5).
  4. Smaller, self-contained security-audit surface.
- Alternatives considered: In-place edit (rejected: high upgrade-merge cost, poor testability); separate project (rejected by user: FUXA is the real runtime base, not just reference).
- Impact / Risk: Requires disciplined adapter boundaries; enforced by AC-16.2/16.3/16.5 and the traceability matrix.
- Verification: design/00-architecture-overview.md must define the adapter seams; no design task may edit FUXA core logic outside an adapter.

### D-005 (UPDATE): Administrator bootstrap decided — auto-seed + forced rotation
- Date: 2026-07-12
- Phase: Requirements
- Status: Active (CONFIRMED by user 2026-07-12) — supersedes the OPEN state of the original D-005 above
- Links: REQ-5, REQ-9, REQ-10, TO-005; will become a new requirement (see DV-004)
- Statement: On first run, if the user store has no administrator, the system seeds exactly one default administrator and REQUIRES a password change before any other operation is permitted for that account.
- Rationale: Resolves the chicken-and-egg bootstrap while guaranteeing no usable known-default credential persists past first login.
- Alternatives considered: CLI `create-admin` (kept as documented ops fallback); env-var seeding (rejected as default: secret-in-env risk).
- Impact / Risk: The forced-rotation gate is security-critical; must be provably un-bypassable (test required).
- Verification: new requirement (DV-004) + a correctness test proving the seeded credential cannot perform any action before rotation.

### D-006: Normalize sign-in lookup input (harden against query-injection via body)
- Date: 2026-07-12
- Phase: Design (section 01)
- Status: Active
- Links: REQ-1 (AC-1.1..1.4), REQ-16 (AC-16.3)
- Context: VERIFIED — FUXA's `server/api/auth/index.js` passes the ENTIRE request body to `runtime.users.findOne(req.body)`, which forwards it to the store as a query filter. Attacker-controlled extra body fields could influence the lookup.
- Statement: The Authentication_Service extracts ONLY `username` and `password` from the request and calls a normalized `User_Store.findUser(username)`. Extra body fields are ignored and never reach the store as filters.
- Rationale: Root-cause fix for a real injection vector in the reused code path, rather than patching symptoms downstream. Also enforces the layer boundary (service controls what the store sees).
- Alternatives considered: Whitelist-sanitize the body but still pass an object (rejected: weaker, easy to regress). Leave as-is (rejected: known injection surface, unacceptable for commercial security).
- Impact / Risk: The module's login path diverges from FUXA's inline handler behavior — intended and safer. Must ensure the store adapter's `findUser(username)` cannot be widened by callers.
- Verification: §7 edge case "Query-injection via extra body fields"; a test sends extra body fields and asserts the store receives only the username.

### D-007: Sign-in success payload returns `roles`; `groups` kept only inside the token
- Date: 2026-07-12
- Phase: Design (section 01)
- Status: Active
- Links: REQ-1 (AC-1.1), REQ-10 (AC-10.4), REQ-2
- Context: VERIFIED — FUXA's sign-in returns `data: { username, fullname, groups, info, token }`. AC-1.1 mandates returning `roles`.
- Statement: The module's success payload is `{ token, username, fullname, roles }`. The legacy `groups` claim is retained INSIDE the signed token (for FUXA-endpoint compatibility) but is not surfaced as a top-level sign-in field; `info` is not returned raw.
- Rationale: Satisfies AC-1.1 while preserving backward compatibility for existing FUXA endpoints that read `groups` from the token (the group-code↔RBAC reconciliation in the master map). Not leaking raw `info` reduces accidental exposure.
- Alternatives considered: Return both `groups` and `roles` (rejected: dual source of truth, drift risk — RBAC must be the single authority per master map). Drop `groups` entirely (rejected: would break existing FUXA endpoints during migration).
- Impact / Risk: Clients migrating from FUXA's payload must read `roles` not `groups`; documented for the UI sections (07/08) and the human guide.
- Verification: §2.3 and §4; success-payload test asserts shape `{ token, username, fullname, roles }`.

### D-009: Last-administrator / self-deletion protection — GAP, needs a requirement
- Date: 2026-07-12
- Phase: Design (section 04)
- Status: RESOLVED 2026-07-12 — user approved; added as AC-8.5 (see DV-005) and made normative in section 04 §6.5. Candidate property P-010 raised (see traceability §C). Sub-question of non-last self-deletion remains an explicit open item in section 04 §8.3.
- Links: REQ-8, REQ-17 (inverse of bootstrap guarantee)
- Context: REQ-8 (Delete User) does not state whether an admin may delete their own account or the LAST remaining administrator. Deleting the last admin would leave the system with no administrator — the exact inverse of the REQ-17 bootstrap guarantee, and an operational lockout risk.
- Statement (proposed): Add an acceptance criterion — "THE User_Service SHALL reject deletion of the last remaining administrator account" (and optionally reject self-deletion of the last admin).
- Rationale: Prevents an irrecoverable no-admin state; complements REQ-17 which guarantees an admin exists at bootstrap.
- Alternatives considered: Rely on bootstrap re-seeding when zero admins (rejected: bootstrap only seeds when store is empty; deleting the last admin while other users exist would NOT trigger re-seed, leaving a locked-out system). Do nothing (rejected: real lockout risk for a commercial product).
- Impact / Risk: Until decided, section 04 does NOT special-case this. If adopted, it becomes a new/extended requirement and a test.
- Verification: pending user decision; if adopted, add AC to REQ-8 (or a new requirement) + a test proving the last admin cannot be deleted.

### TO-006: Duplicate-create HTTP status — 400 vs 409
- Date: 2026-07-12
- Phase: Design (section 04)
- Status: DECIDED (400) — revisitable
- Links: REQ-5 (AC-5.2)
- Context: A duplicate username on create is semantically a conflict (HTTP 409), but the master-map error table defines 400 for client input errors and FUXA uses 400 for user-write failures (verified).
- Decision: Map duplicate to 400 with stable identifier `duplicate_username` for master-map/FUXA alignment. The UI branches on the stable `error` id, not the status, so AC-5.2 is unaffected.
- Alternatives considered: 409 Conflict (more REST-idiomatic) — deferred; can be adopted in review without changing the outcome contract.
- Impact / Risk: Minor; cosmetic status choice.
- Verification: §8.2 mapping; a create-duplicate test asserts the stable `duplicate_username` identifier regardless of status.

### D-010: Double-hash resolution — adapter writes the password hash verbatim, bypassing setUser re-hash
- Date: 2026-07-12
- Phase: Design (section 06)
- Status: Active
- Links: REQ-13, REQ-4 (AC-4.2), REQ-7 (AC-7.3), D-002, D-008
- Context: VERIFIED — FUXA `usrstorage.setUser` re-hashes any truthy `pwd` with `bcrypt.hashSync(pwd,10)`. Since the module hashes in the service layer (§03) and hands the store an already-hashed value, passing it to `setUser` would store `bcrypt(bcrypt(plaintext))`, breaking verify (AC-1.5, P-001/P-002).
- Statement: The FuxaUserStoreAdapter never passes the password to `setUser`. It (1) writes non-secret columns via `runtime.users.setUsers({username,fullname,groups,info})` with password OMITTED (drives setUser's pwd-falsy branch AND keeps the `usersMap` cache coherent), and (2) when a passwordHash is present, writes it verbatim via a dedicated parameterized `UPDATE users SET password=? WHERE username=?`. Both steps run in one SQLite transaction. Omitting passwordHash skips step 2 (retain-on-omit, AC-7.3).
- Rationale: Preserves cache coherence for free (usersMap holds only {info,groups}, never the password — verified); edits no FUXA core file (D-003, low upgrade-conflict); minimal bespoke surface (exactly one column written outside FUXA).
- Alternatives considered: Re-implement the whole row write in the adapter (rejected: must duplicate the cache update → drift). Modify setUser to accept pre-hashed values (rejected: edits FUXA core, violates D-003).
- Impact / Risk: One adapter-owned single-column SQL statement; must stay parameterized and transactional.
- Verification: §5; double-hash regression test asserts stored column verifies against the plaintext with a single bcrypt.compare; retain-on-omit test asserts the hash is byte-identical after a password-less update.

### N-009: FUXA getRoles has no per-record try/catch — one corrupt role fails the whole batch
- Date: 2026-07-12
- Phase: Design (section 06)
- Status: Active (gap closed by module)
- Links: REQ-13 (AC-13.4)
- Statement: VERIFIED — `server/runtime/users/index.js` getRoles does `JSON.parse(drows[id].value)` with NO try/catch, so a single corrupt role `value` throws and rejects the entire getRoles batch. (By contrast, `removeRoles` and `_loadUsers` DO wrap per-record parse in try/catch — verified.)
- Impact / Risk: In FUXA, one bad role row breaks all role listing. The module's Role_Store.readAll routes every row through the resilient `deserialize`, isolating the bad record (AC-13.4).
- Verification: §4.3 + the roles-gap regression test in §9.2.

### D-011: UI login — SUPERSEDE FUXA's dialog with a module-owned routed Login_Page (reuse session wiring)
- Date: 2026-07-12
- Phase: Design (section 07)
- Status: CONFIRMED by user 2026-07-12 — SUPERSEDE adopted (new routed Login_Page under auth-management/, reuse session plumbing). Migration cutover deferred to Tasks.
- Links: REQ-11, D-003, D-007, N-001
- Context: VERIFIED — FUXA already has a login UI: `client/src/app/login/login.component.ts` (a MatDialog opened by `auth.guard.ts`), signing in via `_services/auth.service.ts` (stores token in sessionStorage `currentUser` + `window.fuxaAccessToken`; `x-access-token` interceptor in `_helpers/auth-interceptor.ts`). REQ-11 must be delivered against this.
- Statement: Introduce a NEW module-owned routed Login_Page + AuthSignInClient under `client/src/app/auth-management/login/`; do NOT edit `app/login` in place. REUSE unchanged the generic session plumbing: sessionStorage token store, `x-access-token` interceptor, and AuthGuard.
- Rationale: (1) D-003 boundary + upgrade safety — editing app/login maximizes merge conflicts on FUXA upgrades; (2) AC-11.3 requires "navigate" which fits a routed page better than closing a dialog; (3) isolates the new payload contract (D-007 roles vs FUXA groups/info); (4) reuse generic session plumbing to avoid a divergent second session mechanism.
- Alternatives considered: EXTEND app/login in place (rejected: high upgrade-conflict, tangles with HMI/touch-keyboard concerns, dialog fits "navigate" poorly).
- Impact / Risk: Two login surfaces coexist during migration; cutover (guard→routed page vs dialog fallback) deferred to Tasks. Also: fixes verified gaps — double-submit (button not disabled on submitLoading), autocomplete="off" on credential fields, console.error logging the error.
- Verification: §7; component tests for AC-11.1..11.5; migration cutover decided at Tasks.

### D-012: Seed credential = random one-time secret + mustRotate gate (eliminates N-007), plus migration remediation
- Date: 2026-07-12
- Phase: Design (section 12)
- Status: Active (implements D-005 CONFIRMED)
- Links: REQ-17, N-007, D-005, TO-005, D-008, P-009
- Context: VERIFIED — FUXA seeds admin with the literal '123456' and no rotation (N-007). Sign-in is NOT a gated protected operation, so a known default + gate alone is insufficient: an attacker who knows '123456' could sign in and self-rotate to seize the sole admin.
- Statement: On empty-admin startup, seed exactly one admin with a CRYPTORANDOM one-time initial secret (never '123456'), hashed at cost 12, disclosed once out-of-band; set metadata.mustRotate=true so the §05 gate allows only account.rotatePassword until a genuine rotation (verifies current secret, rejects reuse) clears the flag. For existing FUXA installs, remediate a detected known-default admin ('123456' verify) by forcing rotation — flagged for Tasks (changes login on upgrade).
- Rationale: Two independent axes each close a distinct takeover path (random secret blocks hostile self-rotation; gate blocks all protected actions pre-rotation). Guarantees no usable known-default credential survives first boot.
- Alternatives considered: reuse '123456' + gate only (rejected: hostile-rotation takeover); env-var seed (rejected default, TO-005); CLI-only (kept as ops fallback).
- Impact / Risk: Migration forces rotation of legacy admins on upgrade — operational, so flagged for Tasks confirmation. mustRotate stored in info metadata; adapter must persist seeded hash verbatim (no double-hash, §06).
- Verification: P-009 (owned §12); §10.3 security test proves '123456' yields no usable authority and the module's own seed never verifies '123456'.

### D-013: Three open items resolved (user-approved 2026-07-12) before task generation
- Date: 2026-07-12
- Phase: Design → Tasks
- Status: Active (CONFIRMED by user)
- Links: D-012, N-007, REQ-17, AC-8.5, P-010, P-011, P-012, section 04 §8.3
- Decisions:
  1. **Migration force-rotation: YES.** On upgrade of an existing FUXA install, a detected known-default admin (hash verifies '123456') is forced to rotate (metadata.mustRotate=true set on the existing record); this becomes a MANDATORY task, not merely "flagged for Tasks" (supersedes the "recommended/flagged" wording in §12 §8 and D-012). Rationale: leaving it defeats REQ-17 for the most-exposed installs.
  2. **Property candidates confirmed: P-010, P-011, P-012 are all adopted** and moved from candidate → confirmed in traceability §C. Owners: P-010 jointly §04+§12, P-011 §05, P-012 §10. Each gets a fast-check test task (min 100 iters).
  3. **Self-deletion of a non-last admin: NOT restricted.** No new rule added. Rationale: AC-8.5 already guarantees ≥1 admin (the critical invariant); a non-last admin self-deleting is recoverable and forbidding it is unneeded complexity. The §04 §8.3 open item is hereby closed as "intentionally allowed". Easy to add later if desired.
- Verification: tasks.md must include (a) a migration/remediation task forcing rotation of a known-default admin, and (b) three property-test tasks for P-010/P-011/P-012; no self-deletion-ban task.
