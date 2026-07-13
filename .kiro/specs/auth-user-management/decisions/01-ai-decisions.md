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
- REFINEMENT 2026-07-13 (superseded-in-part by D-016): the original "two coordinated writes on two connections" mechanism is REPLACED. The adapter now writes ALL columns (incl. the verbatim password) in ONE transaction on its OWN sqlite connection (still bypassing `setUser`, so no double-hash), then calls `setUsers(password omitted)` **only** to refresh the `usersMap` cache. The no-double-hash and retain-on-omit guarantees of D-010 remain valid; only the write/atomicity mechanism changed (see D-016 and §06 §5.2).

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

---

## Proposed root-cause resolutions for the 2026-07-13 deep-review defects (OPEN — approve step by step)

> These are the AI's recommended resolutions to the verified defects N-010…N-019/N-021. They are
> **OPEN** (not yet enacted) so the user approves each direction before any design/requirements edit.
> Each states a precise, factual reason and the rejected alternatives (trade-offs in TO-007…TO-011).
> **No design file has been changed for these yet.** Priority order is given in `GATES.md` §Roadmap.

### D-014: Router cutover — module supersedes FUXA auth/users routers at the composition root (fixes N-014)
- Date: 2026-07-13
- Phase: Design (composition root / §13)
- Status: **Active (CONFIRMED by user 2026-07-13, option 1 SUPERSEDE)** — `design.md` gains the "API Composition Root & Cutover Strategy" section: stop mounting FUXA `usersApi`/`authApi` for the overlapping paths, mount the module router after `authLimiter`, module is sole authority for the identity URLs. Client cutover (D-011) must land in the same change. New property **P-014** added. The `/api/v2` namespace remains the documented fallback (TO-011 option 2).
- Links: N-014, TO-011, D-003, D-011, REQ-16
- Statement (proposed): At the single composition-root mount point, the module router is mounted **before** FUXA's overlapping routers AND FUXA's `usersApi`/`authApi` are **no longer mounted for the overlapping paths** (`/api/signin`, `/api/refresh`, `/api/signout`, `/api/users`, `/api/roles`), so the module is the sole authority for those URLs. (Alternative if a dual-run is required: expose the module under `/api/v2/identity/*` and migrate the client, retiring FUXA routes atomically after cutover.)
- Rationale (precise): D-011 already decided the module **SUPERSEDES** FUXA auth. Express matches the first handler that ends the response; FUXA's routers are registered first in `server/api/index.js` (verified), so any "mount-after" leaves the module dead code for the primary endpoints. The only way the module's RBAC/audit/mustRotate actually run is to make it authoritative at the mount point. Editing the mount block is still within the D-003 "single wiring touch" boundary (it is composition wiring, not FUXA business logic).
- Alternatives considered: mount-after (rejected: shadowed, the N-014 defect); `/api/v2` namespace (viable but requires client URL migration and a dual-stack window — heavier; keep as fallback if gradual migration is needed).
- Impact / Risk: FUXA's built-in login/user pages that call these URLs will now hit the module — intended (SUPERSEDE), but the client cutover (D-011) must land in the same change so the UI keeps working.
- Verification: integration test — `/api/users` without the module's RBAC permission returns 403 from the module (proving the module, not FUXA's admin-group gate, handled it); `/api/signin` exercises the module's Authentication_Service (audit + brute-force observable).

### D-015: Session authority — re-resolve identity from the live account on every request + active revocation (fixes N-011)
- Date: 2026-07-13
- Phase: Design (§05, §02)
- Status: **Active (CONFIRMED by user 2026-07-13, option (1))** — `design/05` §4.1 rewritten to build Identity from the live `getUserCache` record (roles/groups/existence/mustRotate), not token claims; `design/02` §3 adds the `tokenVersion` revocation claim and marks token `roles`/`groups` as compat-only. New property **P-013** added. Follow-ups: (i) the `metadata.disabled` account-disable capability is NOT yet a requirement — it is a no-op placeholder in step 2 until a new requirement/operation adds it; (ii) `tokenVersion` bump points other than rotation (§12 §4) — i.e. force-logout / disable — depend on those future operations; the counter and the compare are specified now so tokens are version-stamped from day one.
- Links: N-011, TO-008, D-007, REQ-2, REQ-10, REQ-8
- Statement (proposed): The authorization middleware builds `Identity` as: verify token (identity/session reference only) → **load the current `User_Record`** → reject if missing/disabled → derive `roles`/`groups`/permissions from the **store** (not the token) → check a `tokenVersion`/`sessionVersion` stamped on the account so logout/password-change/role-change/disable can **actively revoke** outstanding tokens. The JWT carries identity + a session/version reference, not authority.
- Rationale (precise): §12 §2.1 already claims authority is resolved from stored state; §05 §4.1 does not implement that for roles/groups/existence. Making authority live is the only way deletion/disable/downgrade takes effect on the next request. Cost is one store read per request, which is nearly free because FUXA already maintains the `usersMap` in-memory cache (verified) that the read hits.
- Alternatives considered: short access-TTL only (rejected: still a stale-authority window, no active revocation); token blacklist only (rejected: still trusts token roles, needs a store anyway). See TO-008.
- Impact / Risk: One store/cache read per protected request; must keep the token→account mapping and version check cheap and cache-coherent.
- Verification: a deleted/disabled/role-downgraded user presenting a still-valid token is denied on the next protected request; a `tokenVersion` bump invalidates prior tokens.

### D-016: Persistence atomicity — single transactional write path for the verbatim hash (fixes N-010)
- Date: 2026-07-13
- Phase: Design (§06)
- Status: **Active (CONFIRMED by user 2026-07-13)** — option (a) adopted; `design/06` §5.2/§5.3/§5.4 and the §2.3 mapping table edited accordingly; supersedes the two-connection mechanism in D-010
- Links: N-010, D-010, D-002, TO-001, REQ-13
- Statement (proposed): Replace the two-connection scheme with a **single transactional write** that persists non-secret columns AND the verbatim password hash atomically. Options: (a) add a thin, module-owned transactional write **inside one SQLite connection** that performs both the `setUser`-equivalent non-secret write and the `UPDATE ... password` in one `BEGIN…COMMIT` (i.e. the adapter owns the whole row write on its own connection, including the cache update it must then replicate); or (b) introduce a **dedicated IAM datastore** with real transactions, unique constraints, and a formal migration. Recommendation: (a) if the cache-coherence replication is provably correct; otherwise (b).
- Rationale (precise): §06 §5.4 requires a single transaction but §5.2's two-connection design makes that impossible (N-010). The root fix is to write both columns on one connection within one transaction. This does mean the adapter must also replicate FUXA's `usersMap.set(...)` cache update (the reason §5.2 avoided owning the whole write) — an acceptable, testable cost, and strictly better than a non-atomic credential write.
- Alternatives considered: keep two connections + "rare and self-healing" (rejected: not acceptable for credentials, N-010); modify FUXA `setUser` to accept a pre-hashed value (rejected: edits FUXA core, violates D-003).
- Impact / Risk: The adapter owns more of the write (incl. cache coherence) OR a new datastore is introduced (revisits TO-001). Either way, atomicity becomes real.
- Verification: a crash-injection/transaction test proving no partial row (row without password, or metadata-updated-but-password-stale) can persist.

### D-017: Password hashing — bound the input domain now + version the hash scheme for a future Argon2id migration (fixes N-012)
- Date: 2026-07-13
- Phase: Design (§03) + Requirements (AC-4.5)
- Status: **Active (CONFIRMED by user 2026-07-13, option 1)** — `design/03` §2.2 retracts the false "unaffected" claim and bounds the domain to ≤72 UTF-8 bytes + reserves a `hashScheme` version marker; §7 restates P-002 over the bounded domain; §8.1 bounds the P-002 generator and adds a >72-byte rejection test; §9 adds AC-4.6/AC-4.7 rows. `requirements.md` REQ-4 gains AC-4.6 (reject >72 bytes) and AC-4.7 (min length + blocklist) via DV-007. Enforcement of AC-4.6/4.7 lives in the `User_Service` validation step (`design/04` §2.3 / §3.1 / §5.1) — to be honored by the §04 create/update tasks.
- Links: N-012, TO-007, DV-007, REQ-4, D-002, D-008
- Statement (proposed): (1) Validate and reject passwords whose UTF-8 byte length exceeds bcrypt's 72-byte limit (or a stricter policy max), and **restate P-002 over the bounded domain** so it is true. (2) Add a `hashScheme`/version marker to stored hashes from day one so a later migration to **Argon2id** is non-breaking. (3) Add a minimal password policy (min length per NIST SP 800-63B, and a common-password blocklist check) as a separate criterion. Correct §03 §2.2's false claim that truncation leaves P-002 unaffected.
- Rationale (precise): P-002 as written is mathematically false under bcrypt truncation (N-012). Bounding the domain is a correct, minimal, verifiable root fix that keeps the reused bcryptjs (TO-001/D-002); the version marker removes the future migration cliff without cost now.
- Alternatives considered: pre-hash `bcrypt(base64(sha256(pw)))` (viable, removes the length cap, but bespoke + needs migration marker); immediate Argon2id (strongest but new dependency vs TO-001, migration-on-verify needed). See TO-007.
- Impact / Risk: A password length cap becomes operator-visible; requires an AC edit (DV-007).
- Verification: corrected P-002 statement; test that two >72-byte near-duplicates are rejected at validation (or, under pre-hash/Argon2id, do not cross-verify).

### D-018: Add and wire the `account.rotatePassword` HTTP endpoint (fixes N-013)
- Date: 2026-07-13
- Phase: Design (§12, §13)
- Status: **Active (CONFIRMED by user 2026-07-13)** — endpoint `POST /api/account/rotate-password` documented in `design.md` (API Composition section) and cross-referenced in `design/12` §4.1; composition root must instantiate `Account_Service` and mount it; the sole operation permitted while `mustRotate` is true; on success clears `mustRotate` and bumps `tokenVersion` (D-015).
- Links: N-013, REQ-17 (AC-17.2, AC-17.3), §12 §4, §05 §2.2
- Statement (proposed): Add a routed endpoint (e.g. `POST /api/account/rotate-password`) wired in the composition root to `Account_Service.rotatePassword`, gated so it is the **only** operation permitted while `mustRotate` is true. Instantiate `Account_Service` in the composition root (currently absent) and mount its router.
- Rationale (precise): §12 §4 defines the operation and §05 §2.2 defines its permission, but no router/composition wiring exposes it (N-013). Without the endpoint, a seeded/migrated admin (`mustRotate=true`) is permanently deadlocked, defeating REQ-17. This is a root fix (the missing API surface), not a symptom patch.
- Alternatives considered: fold rotation into `/api/signin` (rejected: conflates authentication with an authorized state change, muddies the gate); a CLI-only rotation (rejected as the sole path: blocks normal operators; keep CLI only as the TO-005 ops fallback).
- Impact / Risk: One new endpoint + composition wiring; must be reachable while gated but require the current secret.
- Verification: P-009 test extended end-to-end — a gated admin can call rotate (and nothing else) over HTTP, and after rotation regains admin operations.

### D-019: Refresh-token rotation with server-side reuse detection (fixes N-015)
- Date: 2026-07-13
- Phase: Design (§02)
- Status: **Active (CONFIRMED by user 2026-07-13)** — `design/02` §6 rewritten: new module-owned `Refresh_Token_Store` table (`auth_refresh_tokens`, hashed-at-rest, on the adapter's transactional connection per D-016), `{jti, family_id, parent_jti, state}` records, atomic consume-and-rotate, **reuse detection revokes the whole family** (RFC 9700), family revocation on sign-out/password-rotation/disable, `tokenVersion` (D-015) checked on refresh. `RefreshOutcome` gains `revoked`/`reuse_detected`; §6.3 table + §7 posture updated; new property **P-015** added. Note: revoking the family on sign-out **strengthens** AC-3.4 (no requirement wording change, only stronger). Backing store reuses FUXA's SQLite (TO-001/TO-009); escalate to a dedicated IAM DB only under D-016(b).
- Links: N-015, TO-009, REQ-3, RFC 9700
- Statement (proposed): Persist refresh tokens server-side with `family_id, jti, parent_jti, used/revoked/expired`, store the token **hashed at rest**, perform **atomic consume-and-rotate**, **revoke the whole family** on detected reuse (replay), and revoke on logout, password change, account disable, and role-sensitive events. Back it with the SQLite store FUXA already uses (reuses TO-001) unless D-016 introduces a dedicated IAM DB (then use that).
- Rationale (precise): §02's "rotation" is cosmetic — the old refresh JWT stays valid until expiry with no invalidation (N-015). Refresh tokens are the long-lived credential; without server-side invalidation, logout and compromise-response do not work, and there is no replay detection (RFC 9700). This is a foundational security fix, not a leaf patch.
- Alternatives considered: shorten refresh TTL only (rejected: still no reuse detection, weaker); keep stateless (rejected: cannot revoke). See TO-009.
- Impact / Risk: Adds a small refresh-token store + write on each refresh; standard cost for correct rotation.
- Verification: replay test — a rotated (old) refresh token used a second time fails AND revokes its family; logout invalidates the family.

### D-020: Enforce singleton/uniqueness invariants atomically, not via read-then-act (fixes N-016)
- Date: 2026-07-13
- Phase: Design (§04, §05, §06)
- Status: **Active (CONFIRMED by user 2026-07-13)** — DB-level atomicity on the adapter's own connection (D-016): create uses **plain `INSERT`** (PK conflict ⇒ `duplicate_username`, atomic — `design/04` §3.2 + `design/06` §5.4); last-admin count→guard→delete runs in **one `BEGIN IMMEDIATE`** transaction (SQLite write-lock serializes concurrent deletes — `design/04` §6.5 + `design/06` §5.4). New concurrency property **P-016** (interleaved histories) added alongside the sequential P-010. Multi-process HA flagged to escalate to D-016(b).
- Links: N-016, AC-8.5, AC-5.2, AC-9.5, P-010
- Statement (proposed): Enforce the last-admin invariant and unique-create at a **single atomic persistence command** — e.g. an advisory/row lock or a serialized writer around the "security-critical singleton state", and an atomic `INSERT` (not `INSERT OR REPLACE`) or a UNIQUE constraint for create. Add a **concurrency property** (interleaved histories) alongside the sequential P-010, e.g. "no interleaving of two deletes can reach zero admins" and "two concurrent creates of the same username yield exactly one record".
- Rationale (precise): The current guards are read-then-act across `await` points with no lock/constraint; interleaving is possible even in one Node process (each `await` yields the loop), so two last-admin deletes can both pass and reach zero admins, and two creates can overwrite (N-016). P-010 only covers sequential histories, so it cannot detect this. The root fix is atomicity at the persistence layer + a property that quantifies over interleavings.
- Alternatives considered: assume single-writer (rejected: not stated or guaranteed; refresh/HA break it); serialize all writes in the app (viable simple option — a single async mutex around admin-count-critical and create operations — acceptable for a single node, but must be revisited for multi-node under D-016/HA).
- Impact / Risk: Adds locking/serialization; must not deadlock. Multi-node correctness depends on the store choice (D-016).
- Verification: a concurrency test driving two interleaved deletes and two interleaved creates; the invariants hold.

### D-021: Harden the JWT profile (alg pinning + registered claims + key id) (fixes N-017)
- Date: 2026-07-13
- Phase: Design (§02)
- Status: **Active (CONFIRMED by user 2026-07-13)** — `design/02` §3 adds `iss/aud/sub/jti/typ` claim rows + a JWT-hardening note; §5 `verify` pins `algorithms`, validates `iss/aud/typ`, selects key by `kid`, exposes `tokenVersion`/`jti`; §7 posture adds the alg-pinning bullet and updates the claim list. Additive to the FUXA-compat set (`groups` retained), so existing FUXA tokens keep verifying. Access-token revocation remains the `tokenVersion` mechanism (D-015); `jti` enables audit correlation + point revocation. Tested via example tests (alg/iss/aud/typ rejection) at G3/G4.
- Links: N-017, REQ-2, RFC 8725, D-015
- Statement (proposed): Pin `algorithms: ['HS256']` (or the configured alg) on every `verify`; add `iss`, `aud`, `sub`, `jti`, and an explicit `typ` to issued tokens and validate them on verify; add a key id (`kid`) to enable secret rotation. Access-token revocation is handled by the `tokenVersion` mechanism in D-015.
- Rationale (precise): `jwt.verify` without a pinned algorithm list is susceptible to algorithm-confusion; missing `iss/aud/jti/typ` removes standard defenses and prevents per-token revocation/audit correlation (RFC 8725) (N-017). These are cheap, standard hardening controls expected of a commercial token service.
- Alternatives considered: keep the minimal FUXA-compatible claim set (rejected: below commercial hardening baseline). Compatibility with existing FUXA endpoints is preserved because `groups` remains in the token.
- Impact / Risk: Slightly larger tokens; verify becomes stricter (must not break FUXA tokens carrying `groups` — additive claims only).
- Verification: a test asserting a token signed with a different alg or wrong `aud`/`iss` is rejected; `jti` present and usable for revocation/audit.

### D-022: Replace log/console secret disclosure with a secure enrollment channel (fixes N-018)
- Date: 2026-07-13
- Phase: Design (§12)
- Status: **Active (CONFIRMED by user 2026-07-13, option (b) interactive CLI + (a) one-time enrollment token)** — `design/12` §3.2 rewritten: the initial/rotated secret is delivered via a dedicated secure enrollment channel (interactive first-run CLI as default; one-time, short-TTL, hashed-at-rest, single-use enrollment token for automated provisioning) and is **never** written to `fuxa.log`/`runtime.logger`/console; the §3.4 sequence diagram and §8 migration remediation updated to match; new security test §10.4 (no plaintext/token reaches log/console; token single-use + TTL) and an N-018 traceability row added. Supersedes the prior "permission-restricted file + single console/log emission" disclosure.
- Links: N-018, REQ-17, §12 §3.2, §12 §3.4, §12 §8, §12 §10.4, D-012
- Statement (proposed): Never write the seeded/rotated one-time secret to the shared application log or console. Instead use one of: (a) a **one-time enrollment token** (short TTL, hashed at rest) printed once to an operator-only secured channel; (b) an **interactive CLI** at a controlled console that sets the initial secret; (c) a **recovery ceremony** with dual control. Default recommendation: (b) interactive CLI for first-run, (a) enrollment token for automated provisioning.
- Rationale (precise): §12 §3.2 currently sanctions emitting the secret to the console/log (N-018); logs are backed up/shipped/read by support, so this is credential disclosure and contradicts the "no plaintext logging" posture. The root fix is a purpose-built enrollment channel, not a log line.
- Alternatives considered: permission-restricted file only (partial — files leak via backups too); env-var (rejected earlier, TO-005). 
- Impact / Risk: First-run UX changes (operator interaction or token handling); acceptable for security.
- Verification: a test/inspection proving no code path writes the plaintext secret to `runtime.logger`/console.

### D-023: Dedicated, append-only audit sink separate from the application log (fixes the audit weaknesses; supports N-019 grouping)
- Date: 2026-07-13
- Phase: Design (§09)
- Status: **Active (CONFIRMED by user 2026-07-13)** — `design/09` §6.2 rewritten: the default audit sink is now a **dedicated append-only** module-owned winston `File` transport at `${logDir}/fuxa-audit.log` (DB/SIEM selectable behind the `Audit_Sink` interface), with **independent** rotation/retention (no longer sharing `fuxa.log`'s 1 MB×5); §2.2 adds richer OPTIONAL secret-free fields (actor/target/sourceIp/device/sessionId/correlationId/changes[]); §7 upgrades audit-write failure from a swallowed log line to an **observable health signal** via `Audit_Sink.health()` (still non-blocking by default; fail-closed opt-in); §8 + §1.1 diagram updated; optional hash-chain/WORM tamper-evidence documented; new §10.4 tests + traceability row added. The N-019 brute-force grouping is handled in `design/10` (see N-019 + DV-008).
- Links: REQ-14, §09 §2.2/§6.2/§7/§8/§10.4, N-019 (adjacent, resolved in §10), DV-008
- Statement (proposed): Route audit events to a **dedicated append-only sink** (separate file/stream or external SIEM), independent of `fuxa.log` and its 1 MB×5 rotation, with richer fields (actor, target, source IP/device, session/correlation id, before/after, decision + reason), and treat audit-write failure as an observable health signal (not silently swallowed). Optionally add a hash-chain/WORM option for tamper-evidence. Also address N-019: make brute-force state pluggable (shared store) with an adaptive-throttling option.
- Rationale (precise): §09 acknowledges audit shares `fuxa.log` (1 MB×5), so security events can be rotated away and are not tamper-evident; audit and error logs can fail together on disk-full. For a commercial IAM, audit integrity/retention is a control, not a convenience.
- Alternatives considered: keep shared log (rejected: loss/rotation risk, no tamper-evidence). 
- Impact / Risk: Adds a sink + config; retention/rotation policy needed.
- Verification: audit events land in the dedicated sink, survive app-log rotation, and a write failure is surfaced as a health signal.
