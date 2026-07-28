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

### D-003: Architecture scope = self-contained module inside FUXA, via thin adapters
- Date: 2026-07-12
- Phase: Requirements
- Status: Active (CONFIRMED by user 2026-07-12)
- Links: REQ-16, N-005, TO-001
- Context: Fundamental fork — build the auth/user-management logic as a bounded module vs. edit FUXA's existing auth code in place vs. a fully separate project.
- Statement: The module is a self-contained, layered subsystem living inside the FUXA workspace. It touches FUXA core only through thin adapters (over JWT helper, bcrypt, and the user/role store). It is NOT edited into FUXA's route handlers in place, and it is NOT a separate project.
- Rationale (all factual):
  1. On the historical 2026-07-12 old-machine snapshot, the workspace was not a git repo and was intended to receive future FUXA upgrades (N-001). The current transferred workspace is a git repository; the durable rationale remains that a bounded module touches few FUXA core files and therefore minimizes upgrade-merge conflicts.
  2. Logic behind service/store interfaces is directly PBT-testable; logic tangled into FUXA handlers is not (user requirement: "valid nhiều lần").
  3. Independent replaceability/scaling for a commercial system (AC-16.5).
  4. Smaller, self-contained security-audit surface.
- Alternatives considered: In-place edit (rejected: high upgrade-merge cost, poor testability); separate project (rejected by user: FUXA is the real runtime base, not just reference).
- Impact / Risk: Requires disciplined adapter boundaries; enforced by AC-16.2/16.3/16.5 and the traceability matrix.
- Verification: design/00-architecture-overview.md must define the adapter seams; no design task may edit FUXA core logic outside an adapter.

### D-004: Requirements-analysis auto-resolutions adopted as design constraints
- Date: 2026-07-12
- Phase: Requirements
- Status: Active (with clause (a) superseded by DV-003)
- Links: REQ-2 (AC-2.7), REQ-11 (AC-11), REQ-14 (AC-14.5), REQ-16 (AC-16.4), DV-003
- Context: The requirements analysis pass proposed answers the user did not originally give; these were folded into the acceptance criteria.
- Statement: Historically adopted — (a) tokens would not expire when no expiry was configured; (b) the Login Page validates inputs client-side before submitting (AC-11); (c) each calling service sanitizes secrets out of audit events (AC-14.5); (d) the API fails fast when the service layer is unavailable (AC-16.4). **Clause (a) is no longer current:** DV-003 superseded it with a safe finite default TTL (1 hour), with true non-expiry restricted to explicit dev-only opt-in.
- Rationale: Each made an otherwise-underspecified behavior concrete and testable. The security risk in historical clause (a) was resolved through TO-002/DV-003; clause (d)'s trade-off remains TO-004.
- Alternatives considered: Leave unspecified — rejected: unspecified security behavior is a drift/ambiguity source.
- Impact / Risk: The historical non-expiry risk is resolved by DV-003; current token-expiry behavior is governed by REQ-2 AC-2.7/2.8.
- Verification: cross-check each cited AC remains present and unweakened through design and tests; verify no current artifact treats non-expiry as the default.

### D-005: Administrator bootstrap — historical proposal confirmed as auto-seed + forced rotation
- Date: 2026-07-12
- Phase: Requirements
- Status: Active (CONFIRMED by user 2026-07-12)
- Links: REQ-5, REQ-9, REQ-10, TO-005, DV-004
- Context: RBAC and user CRUD require an Administrator to exist, but "how the very first admin comes to exist" was unspecified. This was the bootstrap gap.
- Historical proposal (originally OPEN): Seed a single default administrator on first run if the user store is empty, forcing a password change on first login; exact bootstrap and forced-rotation details required design/user confirmation.
- Confirmation: On first run, if the user store has no administrator, the system seeds exactly one default administrator and REQUIRES a password change before any other operation is permitted for that account. This confirmation superseded only the proposal's OPEN status, not its provenance.
- Rationale: Without a bootstrap admin, no one can create users or roles (chicken-and-egg). Forced rotation prevents a usable known-default credential from persisting past first login.
- Alternatives considered: CLI `create-admin` (kept as documented ops fallback); env-var seeding (rejected as default: secret-in-env risk).
- Impact / Risk: The forced-rotation gate is security-critical and must be provably un-bypassable; a default-credential window exists if the gate is skipped.
- Verification: DV-004/REQ-17 specify the flow; a correctness test must prove the seeded credential cannot perform any action before rotation.

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
- REFINEMENT 2026-07-14 (N-035, DEF-A2): the normalized lookup method was named `findUser(username)` here, but the implemented `User_Store` interface + `FuxaUserStoreAdapter` and `design/06` canonicalized it as **`get(username)`**. The name is `get`; D-006's SUBSTANCE is unchanged — the Authentication_Service extracts only `username` and calls `get(username)`, so no attacker-supplied body field reaches the store as a filter. `design/01` was reconciled to `get`.

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
- REFINEMENT 2026-07-16 (D-044): for the D-014 SUPERSEDE, the client-facing success body is extended to ALSO carry derived compatibility projections `groups` (from the authoritative `isAdministrator` predicate) and a minimal `info={roles}` so FUXA's existing groups/infoRoles client authorization keeps working without rewriting it. This does NOT change D-007's substance — RBAC `roles` remains the single authority and `groups`/`info` are derived views (same principle as the token's compat `groups` claim), with `info` minimized to roles so no internal metadata leaks. See D-044.

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

### D-009: Last-administrator protection adopted; non-last self-deletion intentionally allowed
- Date: 2026-07-12
- Phase: Design (section 04)
- Status: Active (CONFIRMED by user 2026-07-12)
- Links: REQ-8, REQ-17, AC-8.5, DV-005, D-013, P-010
- Context: REQ-8 originally did not state whether an admin could delete their own account or the LAST remaining administrator. Deleting the last admin would create an operational lockout, the inverse of REQ-17's bootstrap guarantee.
- Historical proposal: Add a criterion requiring `User_Service` to reject deletion of the last remaining administrator; optionally also reject self-deletion.
- Resolution: AC-8.5/DV-005 adopted the last-administrator guard. D-013 then resolved the remaining sub-question: self-deletion by a **non-last** administrator is intentionally allowed because the ≥1-admin invariant remains intact and the action is recoverable.
- Rationale: The guard prevents an irrecoverable no-admin state. Relying on bootstrap re-seeding was rejected because bootstrap seeds only when the store is empty; deleting the last admin while other users remain would not trigger it.
- Impact / Risk: Last-admin deletion must fail without mutation. Non-last admin self-deletion remains allowed by design.
- Verification: requirements.md contains AC-8.5; section 04 §6.5 specifies the guard; P-010/Task 12.5 and P-016/Task 2.10 cover the sequential and concurrent invariants when their owning deferred tasks are implemented.

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

## Historical deep-review proposals now enacted (2026-07-13)

> D-014…D-023 below preserve the original proposal wording, alternatives, and rationale as
> historical provenance. Every entry was subsequently approved and enacted in the cited
> design/requirements artifacts; each current Status is Active (CONFIRMED). There is no current
> OPEN decision in this section. The original review order remains documented in `GATES.md` §Roadmap.

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

### D-024: Store adapters read through the module's own connection; role `create` uses a plain INSERT (store-layer implementation refinements of §06 §2.3)
- Date: 2026-07-13
- Phase: Implementation (Task 2 — §06)
- Status: **Active (CONFIRMED)** — enacted in `server/auth-management/adapters/fuxa-user-store.adapter.js` + `fuxa-role-store.adapter.js` + `store/fuxa-auth-db.js`; verified green by `test/auth-management/store-adapters.test.js` (P-003/P-004 @150 iters + 9 regression tests, 11 passing).
- Links: REQ-13, §06 §2.3 (mapping table), §06 §5.2 (D-016 own connection), D-015 (store is authority), D-020 (atomic create), AC-9.5, AC-13.1/13.2/13.4
- Context: §06 §2.3's mapping table specifies `User_Store.get`/`readAll` **delegate to `runtime.users.getUsers`** and `Role_Store.create`/`update` **delegate to `setRoles` (`INSERT OR REPLACE`)**. But D-016 already requires the adapter to own a dedicated `sqlite3` connection to `users.fuxap.db` for the transactional verbatim-hash write, and FUXA's `getRoles` parses role `value` with **no try/catch** (a corrupt role rejects the whole listing — the AC-13.4 gap this layer must close). Two implementation choices were needed that §2.3 did not settle.
- Statement: (1) **Reads go through the adapter's own connection**, running the byte-for-byte SELECT that `usrstorage.getUsers` runs (`SELECT username, fullname, password, groups, info FROM users [WHERE username=?]`) and, for roles, `SELECT name, value FROM roles`, then parsing resiliently (`deserialize`). `runtime.users` is retained ONLY as the best-effort in-memory `usersMap` cache-coherence collaborator (`setUsers` pwd-omitted after a write; `removeUsers` on delete; `removeRoles` on role delete) — never as the read authority. (2) **`Role_Store.create` uses a plain `INSERT`** (not `INSERT OR REPLACE`) so a duplicate role id is rejected atomically **without mutating** the existing role; `Role_Store.update` keeps `INSERT OR REPLACE` for the wholesale value replace (AC-9.3).
- Rationale (precise): (1) The SELECT is identical to FUXA's, so this reads the **same table via a coexisting WAL connection** — not a different data source. Reading the store directly is the faithful realization of **D-015** ("re-resolve authority from the store, not the cache"), removes an init-order dependency (the adapter can read before `runtime/users._loadUsers` completes), and makes the Store layer independently testable end-to-end (P-003/P-004 without a full runtime bootstrap — the user's verifiable-design principle). It also lets `Role_Store.readAll` close the verified `getRoles` no-try/catch gap (AC-13.4/N-009), which delegating to `getRoles` structurally could not. (2) A plain INSERT makes AC-9.5 ("duplicate rejected without mutation") an **atomic** DB invariant rather than a read-then-act TOCTOU, matching the D-020 philosophy already applied to user `create`.
- Alternatives considered: (a) Delegate reads to `runtime.users.getUsers`/`getRoles` verbatim — rejected: forces a full `runtime/users` init to test the store, cannot close the `getRoles` resilience gap, and reads FUXA's cache rather than the store authority (contra D-015). (b) Keep `INSERT OR REPLACE` for role create — rejected: silently overwrites on duplicate id, violating AC-9.5.
- Impact / Risk: The adapter now owns the read SQL too (a slightly wider but same-shape coupling to FUXA's column set — already required for the write by D-016; flagged as the same maintenance note as §5.3). FUXA's in-memory cache is refreshed best-effort; a missed refresh self-heals on restart and does not affect module authority (D-015). No FUXA core file is edited (D-003 boundary preserved).
- Verification: `store-adapters.test.js` — P-003 (user round-trip) + P-004 (role round-trip) @150 iters through the own-connection read path; the resilient-readAll and roles-gap regression tests confirm AC-13.4 closure; the duplicate-create tests confirm atomic no-mutation rejection for both users (AC-5.2) and roles (AC-9.5).

### D-025: Reject malformed UTF-16 (lone surrogates) at the Password_Hasher seam + boundary validation (fixes N-027)
- Date: 2026-07-13
- Phase: Implementation (Task 3.2 — §03)
- Status: **Active (CONFIRMED)** — enacted in `server/auth-management/services/password-hasher.js`; verified green by `test/auth-management/password-hasher.test.js` (7 passing incl. the malformed-UTF-16 guard + P-001/P-002 @150 iters). Boundary defense-in-depth (User_Service 9.1 / Authentication_Service 7.1) is a REQUIRED follow-up noted below.
- Links: N-027 (the verified defect), REQ-4, P-002, DV-006, D-017/N-012 (same "bound the bcrypt input domain" pattern), design/03 §2.2, D-003
- Context: N-027 verified that a lone-surrogate password makes `bcryptjs` burn ~9.6s then throw, and that it is reachable unauthenticated via the login API + the DV-006 dummy-hash path (an asymmetric CPU-DoS). The ≤72-byte gate does not stop it. `bcryptjs` is vendored and must not be edited (D-003).
- Statement: The `Password_Hasher` — the SINGLE site feeding `bcryptjs` — guards against malformed UTF-16 with a cheap O(n) `hasLoneSurrogate` check: (1) `verify(plaintext, hash)` returns `false` IMMEDIATELY (no bcrypt call) when `plaintext` contains a lone surrogate — a malformed string can never equal a well-formed stored password, so `false` is the correct result AND it closes the DoS; this extends the §2.2 defensive-verify contract (already "returns false, never throws, on malformed input") from the hash argument to the plaintext argument. (2) `hash(plaintext)` throws a fast, defined `InvalidPasswordEncodingError` (code `invalid_password_encoding`) instead of hanging ~9.6s. (3) FOLLOW-UP (defense-in-depth, must be honored by the owning tasks): the **User_Service** create/update validation (Task 9.1, the AC-4.6/AC-4.7 policy site) and the **Authentication_Service** input handling (Task 7.1) SHALL reject malformed-UTF-16 passwords at the boundary with a validation error, so the malformed input is turned away before it reaches the service internals; the hasher guard remains the guaranteed backstop.
- Rationale (precise, root-cause): the true cause is bcryptjs's encoder mishandling malformed UTF-16; since we cannot edit the dependency (D-003), the module's Hash seam is the correct and minimal choke point that ALL hashing/verification flows funnel through, so guarding there provably neutralizes the DoS on every path (sign-in, dummy-hash, create/update) in one place. Returning `false` from `verify` (rather than throwing) preserves the sign-in path's non-throwing contract and the DV-006 timing parity (both unknown-user and bad-password take the identical fast-reject path for a malformed input). This mirrors D-017/N-012: the accepted password domain is bounded (there: ≤72 bytes; here: well-formed UTF-16), with the property (P-002) stated over that domain and validation enforcing it before hashing.
- Alternatives considered: (a) rely only on User_Service validation — REJECTED: it would leave the sign-in `verify` path (and the DV-006 dummy-hash for unknown users) exposed to the DoS, since those do not go through create/update validation. (b) sanitize/normalize the lone surrogate (e.g. replace with U+FFFD) then hash — REJECTED: it would let a malformed password silently "work", and two different malformed inputs could normalize to the same value (a P-002-style collision); rejecting is correct. (c) edit/patch bcryptjs — REJECTED: violates D-003 (no dependency edits) and would be lost on upgrade.
- Impact / Risk: `verify` gains one O(n) scan of the plaintext (negligible vs a bcrypt compare). `hash` now has a defined throw path for malformed input (create/update validate first, so normal flows never hit it). No change to the P-001/P-002 guarantees over the well-formed domain. A user genuinely wanting a lone surrogate in a password (not representable as valid Unicode text, effectively impossible from a real keyboard) is refused — acceptable and correct.
- Verification: `password-hasher.test.js` — `verify` returns `false` in <1000ms for three lone-surrogate variants (incl. the `JSON.parse('"\\uD83D"')` API form) where each was previously ~9.6s; `hash` throws `invalid_password_encoding`; P-001/P-002 still green @150 iters over the well-formed ≤72-byte domain.

### D-026: Strip `__proto__` at the serialization seam + object-spread compose (fixes N-029)
- Date: 2026-07-14
- Phase: Implementation (Task 2 — §06)
- Status: **Active (CONFIRMED)** — enacted in `server/auth-management/store/serialization.js` (new `stripProtoKeys`, applied in `deserialize`), `adapters/fuxa-user-store.adapter.js` (`_compose`/`_composeInfo` use object-spread), and `adapters/fuxa-role-store.adapter.js` (delete-fallback uses object-spread); design/06 §3.2/§4.1/§4.2/§9.1 synced; verified by the full auth-management suite (**47 passing, exit 0**, stable across 4 runs) incl. new deterministic strip tests.
- Links: N-029 (the verified defect), REQ-13 (AC-13.1/AC-13.3), P-003, P-005, D-024, D-002, D-015, design/06 §3.2/§4
- Context: N-029 verified that the store metadata round-trip lost a `__proto__` key (P-003 failed, seed-dependent) because the adapters rebuilt metadata from JSON-parsed data with `Object.assign` ([[Set]] semantics), which invokes `Object.prototype`'s `__proto__` accessor — dropping a primitive value or reassigning the object's prototype for an object value. The stored `info`/role `value` are JSON that must interoperate with unmodified FUXA code (D-003/AC-16.5), so a hostile/foreign row could carry `__proto__`.
- Statement: (1) `deserialize` recursively removes any own `__proto__` key from the parsed value at every depth (`stripProtoKeys`), so no consumer of the single translation seam — either module adapter, or any module code reading `info`/`value` — can be affected. (2) The adapters compose/split with object-spread (`{ ...metadata, roles }` on write; `{ ...info }` minus `roles` on read; `{ ...parsed, roles: filtered }` in the role delete-fallback), which uses define-semantics (CreateDataProperty) and therefore cannot trigger the `__proto__` accessor even if one slipped through. (3) `__proto__` is declared a reserved/stripped metadata key at every depth (design/06 §3.2/§4.2) and excluded from the P-003/P-005 generators, alongside the pre-existing reserved `roles`. (4) ONLY `__proto__` is stripped — `constructor`/`prototype` have no `[[Set]]` accessor, round-trip correctly, and are plausibly legitimate data, so they are preserved.
- Rationale (precise, root-cause): the true cause is `[[Set]]`-based reconstruction of untrusted JSON, not the property test. Stripping at the single serialization seam is the lowest, most complete choke point (protects every reader in one place — the file's own docstring names it "the single home of the string↔object translation"), and switching to define-semantics removes the hazard structurally. This is standard prototype-pollution hardening (OWASP) and makes P-003/P-005 true identities over a well-defined domain (the same technique already used for the reserved `roles` key). Preserving `constructor`/`prototype` avoids silent data loss for keys that are safe and possibly meaningful.
- Alternatives considered: (a) only exclude `__proto__` from the test generator (leaf-only) — REJECTED: hides the real latent hazard for externally-written rows; violates "fix tận gốc". (b) also strip `constructor`/`prototype` — REJECTED: they round-trip correctly (no accessor) and could be legitimate metadata; stripping them would be unnecessary data loss. (c) pin a fixed fast-check seed to make the suite green — REJECTED: masks the defect rather than fixing it. (d) use `Object.create(null)` metadata objects — REJECTED: breaks deep-equality/JSON assumptions downstream and FUXA interop.
- Impact / Risk: `deserialize` gains one O(n) recursive walk of the parsed object (negligible; parse already walks it). A stored `__proto__` key is intentionally not surfaced — the desired security behavior. Write-side `_composeInfo` also no longer surfaces a caller `__proto__` (defense-in-depth; the User_Service validation remains the primary policy site).
- Verification: `serialization.test.js` — top-level + nested `__proto__` stripped, `{"__proto__":{...}}` does not reassign the prototype, `constructor`/`prototype` preserved; `store-adapters.test.js` — a raw `info` row with a `__proto__` object payload reads back with clean metadata and untouched prototype; P-003/P-004/P-005 green @150–200 iters with `__proto__` excluded from the domain. Full suite 47 passing, exit 0, stable across 4 runs.

### D-027: `tokenVersion` is a first-class end-to-end contract field (fixes DEF-T1 + DEF-T5)
- Date: 2026-07-14
- Phase: Design validation (§02/§05/§11) — pre-implementation of Task 5
- Status: **Active (CONFIRMED)** — enacted in `design/02` §2.1 (Identity gains `tokenVersion`), `design/11` §3.1 (`metadata.tokenVersion` field, default 0), §3.4 (Access_Token claim), §3.5 (Refresh_Token claim), §4.3 (Identity DTO), and `design/05` §4.1 (absent→0 coercion in the version check). No code yet; unblocks Task 5.2/5.6 and §05/§11 implementation.
- Links: DEF-T1, DEF-T5, N-030, D-015 (the owning revocation decision), N-011, REQ-2, REQ-10, `server/auth-management/services/interfaces.js`
- Context (VERIFIED, two distinct gaps found during the design-validation pass): (T1) `design/02` §2.1 defined `Identity = { username, groups, roles }` with **no `tokenVersion`**, yet §3 and the AC-2.1 note require `issueAccessToken` to encode `identity.tokenVersion`, and `interfaces.js` already declares `tokenVersion?: number` on both `identity` and `VerifyResult` — the design text lagged the code stub and its own §3. (T5) `design/05` §4.1 compares `token.tokenVersion < rec.metadata.tokenVersion`, but `design/11` (the field catalogue) defined **no** `tokenVersion` field and specified **no default**; in JS `undefined < 1` is `false`, so a legacy token (no `tokenVersion`) would **NOT** be revoked after an account bumps to ≥1 — a revocation bypass.
- Statement: `tokenVersion` (non-negative integer) is defined end-to-end: (1) stored as `metadata.tokenVersion` on the account, **default 0 when absent** (§11 §3.1); (2) carried on the Token_Service `Identity` (§02 §2.1), sourced from the live account by the caller building the identity (Authentication_Service at sign-in; refresh path at rotation) per D-015; (3) stamped into the Access_Token and Refresh_Token (§11 §3.4/§3.5); (4) compared per request as `Number(token.tokenVersion || 0) < Number(rec.metadata.tokenVersion || 0)` (§05 §4.1) — **both sides coerced to 0 when absent**. Bump points are owned by §12 §4 (rotation) and future force-logout/disable.
- Rationale (precise, root-cause): D-015's active revocation is only real if the counter exists and is comparable at every hop; a contract that omits it degrades silently to expiry-only (re-opening N-011), and an unsafe comparison lets a pre-bump legacy token survive a bump (a security hole). Coercing absent→0 makes the intended semantics explicit and backward-compatible: never-bumped account + legacy token ⇒ `0<0` false (allowed); bumped account + legacy token ⇒ `0<N` true (revoked). This is a root fix at the contract/data-model, not a leaf patch at one call site.
- Alternatives considered: (a) leave `tokenVersion` optional/undefined and rely on truthiness at the call site — REJECTED: the bug is precisely undefined-handling; making it a defined field with a default removes the ambiguity everywhere. (b) store `tokenVersion` as a dedicated SQL column — REJECTED: `metadata`/`info` already carries account extras (mustRotate) and needs no schema migration (D-003 low-conflict); a column adds FUXA-core coupling with no benefit.
- Impact / Risk: `metadata` now has two reserved keys (`mustRotate`, `tokenVersion`); the serialization `__proto__`/`roles` reserved-key rules (D-026) are unaffected. Existing FUXA accounts (no `tokenVersion`) read as 0 and are unaffected until a bump.
- Verification (pending Task 5/8): P-013 (§05, live authority) must include a case where a legacy token (no `tokenVersion`) is denied after the account bumps to ≥1, and a never-bumped account allows a legacy token; P-007 (§02) asserts `issueAccessToken` stamps and `verify` exposes `tokenVersion`.

### D-028: Single `type` token-type claim; drop the parallel payload `typ` (fixes DEF-T3)
- Date: 2026-07-14
- Phase: Design validation (§02/§11) — pre-implementation of Task 5
- Status: **Active (CONFIRMED)** — enacted in `design/02` §3 (claims table row `type`), §5 (verify checks `decoded.type !== 'access'`), the §3 D-021 note and §7 posture (`typ`→`type`); `design/11` §3.4 documents `type:'access'`. No code yet.
- Links: DEF-T3, N-030, D-021, REQ-2, `server/api/auth/index.js` (verified FUXA `buildRefreshToken`)
- Context (VERIFIED): FUXA's refresh token already carries claim **`type: 'refresh'`** (`buildRefreshToken`, verified). The design had layered a NEW, separate payload claim **`typ`** (`'access'|'refresh'`) that §5's access-verify checked (`decoded.typ`), while §6.2's refresh path checked FUXA's `decoded.type`; §6.1's refresh shape listed `type` but not `typ`, contradicting §3's table. Two parallel type claims checked on different paths is fragile, and `typ` also collides with the conventional JWT **header** parameter `typ`.
- Statement: Use a single authoritative payload claim `type` on both tokens — access tokens carry `type:'access'`, refresh tokens `type:'refresh'` (unchanged from FUXA). `verify` rejects a mismatched `type` (`wrong_type`) on each path. The separate `typ` payload claim is removed from the design.
- Rationale (precise, root-cause): one discriminator, backward-compatible with FUXA, eliminates the cross-path mismatch class of bug and the header-name collision. Fixing the claim scheme (not just the one verify line) is the root fix.
- Alternatives considered: (a) keep both `type` and `typ` and check each on its own path — REJECTED: fragile, duplicative, and `typ`-as-payload collides with the JWT header `typ`. (b) rename FUXA's `type` to `typ` everywhere — REJECTED: breaks FUXA backward compatibility (existing refresh tokens use `type`).
- Impact / Risk: none negative — access tokens simply gain `type:'access'`; refresh tokens are unchanged. Existing FUXA refresh tokens keep verifying.
- Verification (pending Task 5): a wrong-type token (refresh presented to the access-verify path and vice-versa) is rejected as `wrong_type`; the access token carries `type:'access'`.

### D-029: Name the `iss`/`aud` settings and validate them only when configured (fixes DEF-T4)
- Date: 2026-07-14
- Phase: Design validation (§02) — pre-implementation of Task 5
- Status: **Active (CONFIRMED)** — enacted in `design/02` §3 (D-021 note names `settings.auth.jwtIssuer` / `settings.auth.jwtAudience` + unset behavior) and §5/§7. No code yet.
- Links: DEF-T4, N-030, D-021, REQ-2
- Context (VERIFIED): §3/§5 validate `iss`/`aud` from "configured issuer/audience" but named no settings key (unlike `settings.auth.devNonExpiringTokens`, which §4.1 names). An implementer would invent key names (drift) and could validate against `undefined`, making an unconfigured deployment self-reject.
- Statement: The issuer/audience are configured via `settings.auth.jwtIssuer` and `settings.auth.jwtAudience`. When a value is **unset**, that claim is **neither issued nor validated** (skip), so an unconfigured deployment does not self-reject; when set, the claim is both issued and validated on verify.
- Rationale (precise): naming the keys removes an under-specification that would drift across implementers; "validate only when configured" is the safe default that preserves the FUXA-compat path (FUXA tokens carry no `iss`/`aud`) while allowing hardening when an operator opts in.
- Alternatives considered: (a) always validate `iss`/`aud` with hard-coded defaults — REJECTED: breaks FUXA-compat tokens and forces configuration on every deployment. (b) leave unnamed — REJECTED: the DEF-T4 drift risk.
- Impact / Risk: minimal; adds two optional settings. Default (unset) behavior equals today's FUXA behavior (no iss/aud).
- Verification (pending Task 5): with keys set, a token minted for a different `aud`/`iss` fails verify; with keys unset, tokens verify without `iss`/`aud`.

### D-030: Refresh_Token_Store — SHA-256 at-rest hashing + compare-and-swap single-use consume (implements D-019)
- Date: 2026-07-14
- Phase: Implementation (Task 5.7 — §02 §6)
- Status: **Active (CONFIRMED)** — enacted in `server/auth-management/store/refresh-token-store.js` and consumed by `TokenService.refresh`; verified by `refresh-token-store.test.js` (14 passing incl. P-015 model-based @120 iters, real crypto + real sqlite). Full suite 71 passing, stable.
- Links: D-019 (the owning decision), N-015, N-016 (TOCTOU class avoided), REQ-3 (AC-3.2/AC-3.3), P-015, RFC 9700, `store/fuxa-auth-db.js`
- Context: `design/02` §6.1 mandates refresh tokens "hashed at rest" and §6.2 an "atomic consume-and-rotate", but names neither the hash algorithm nor the atomicity mechanism — both are AI implementation decisions the spec left open.
- Statement: (1) **At-rest hashing = SHA-256 (hex) + `crypto.timingSafeEqual`**, NOT bcrypt. (2) **Single-use consume = conditional compare-and-swap** — `UPDATE auth_refresh_tokens SET state='used' WHERE jti=? AND state='active'`, requiring `changes===1`, inside a `BEGIN IMMEDIATE` transaction; if `changes===0` the token was not active (already used/revoked, or a concurrent refresh won) and the caller triggers reuse handling (revoke the family). The store is a NEW `auth_refresh_tokens` table on the module-owned connection (D-016), edits no FUXA core (D-003).
- Rationale (precise, root-cause): (1) refresh tokens are HIGH-ENTROPY random JWTs, not low-entropy human passwords; bcrypt's deliberately-slow salted KDF exists to resist brute-force of guessable secrets and would add ~tens of ms/refresh with NO security gain for a 128-bit-random token. A preimage/collision-resistant fast hash is the standard (OWASP) at-rest choice for high-entropy session/refresh tokens; storing only the hash means a DB read cannot replay a token; `timingSafeEqual` removes a timing oracle on the digest. (2) A CAS `UPDATE … WHERE state='active'` makes "consume exactly once" an atomic database operation — the loser of a concurrent double-refresh observes `changes===0` and is routed to reuse detection — which is exactly P-015's invariant (≤1 active per family, single-use). Read-then-write would be the TOCTOU class of N-016.
- Alternatives considered: (a) bcrypt-hash refresh tokens at rest — REJECTED: needless cost for a high-entropy secret; no brute-force threat model for a random token. (b) plaintext refresh tokens in the DB — REJECTED: a DB read would allow replay (the exact thing D-019 hardens). (c) read-then-write consume (SELECT state then UPDATE) — REJECTED: TOCTOU under concurrent refresh; two racers could both rotate. (d) an application-level mutex only — REJECTED: does not serialize across connections/processes; the CAS is the durable guarantee.
- Impact / Risk: SHA-256 is fast (negligible per refresh). The CAS depends on transactions actually serializing on the connection — which surfaced and is fixed by N-032 (the FuxaAuthDb in-process transaction queue). The `auth_refresh_tokens` table grows until `pruneExpired` runs (housekeeping; correctness independent of it since expired JWTs are rejected at verify).
- Verification: `refresh-token-store.test.js` — SHA-256-hex + constant-time match; CAS single-use under a concurrent double-consume (exactly one wins); revokeFamily; full `TokenService.refresh` outcomes (rotated / reuse_detected+family-revoke / missing / wrong_type / expired / invalid / unknown-jti / hash-mismatch+family-revoke / unknown_user / version-revoked); P-015 model-based @120 iters (≤1 active per family; reuse revokes family; no rotate after poison).

### D-031: DV-006 dummy-hash is produced by the same Password_Hasher at the same cost, once, from a random secret
- Date: 2026-07-14
- Phase: Implementation (Task 7 — §01)
- Status: **Active (CONFIRMED)** — enacted in `server/auth-management/services/authentication.service.js` (`_getDummyHash`); verified by `authentication.service.test.js` (unknown-user path calls `verify` against the dummy hash).
- Links: DV-006, TO-010, REQ-1 (AC-1.2), N-035, `services/authentication.service.js`, `services/password-hasher.js`
- Context: DV-006 removes the username-enumeration oracle by making an unknown-user sign-in return a response IDENTICAL to a bad password AND by adding a "dummy-hash verify" so the response LATENCY does not reveal whether the account exists. The design (§01 §7, DV-006) mandates "a comparable-cost `Password_Hasher.verify` against a fixed dummy hash" but does NOT specify how the dummy hash is produced — an implementation decision.
- Statement: The dummy hash is generated by the SAME injected `Password_Hasher.hash(...)` from a per-process random secret (`crypto.randomBytes`), computed once and cached. Because it is a real bcrypt digest at the module's configured cost, the unknown-user `verify(password, dummyHash)` performs the same cost-N bcrypt comparison as the record-found `verify(password, storedHash)`, giving true timing parity. The verify result is discarded.
- Rationale (precise): timing parity requires the dummy compare to cost the SAME as a real compare; only a hash at the same bcrypt cost achieves that. Producing it via the injected `Password_Hasher` guarantees it tracks whatever cost/scheme the hasher uses (today bcrypt cost 12; a future Argon2id migration per TO-007 would carry over automatically). A per-process random secret (vs a fixed literal) avoids shipping a known dummy digest; correctness does not depend on it since the result is discarded. The D-025 lone-surrogate guard fires identically on both paths (fast-reject before bcrypt), so parity holds for malformed input too.
- Alternatives considered: (a) a hard-coded constant dummy hash string — REJECTED: brittle (its embedded cost could drift from the configured cost, breaking parity) and a known value. (b) skip the dummy verify and only equalize the response body — REJECTED: leaves the timing side-channel open (DV-006 explicitly closes timing). (c) compare against a random string (not a hash) — REJECTED: `verify` would fast-reject a non-bcrypt string, giving NO timing parity.
- Impact / Risk: one extra bcrypt compare on the unknown-user path (intended — that is the parity cost) and one hash generation once per process. Negligible; it is exactly the cost the design intends to equalize.
- Verification: `authentication.service.test.js` — the unknown-user test asserts `verify` is invoked against the dummy hash; the enumeration-safety test asserts unknown-user and bad-password expose an identical client-facing result.

### D-032: The live-identity resolution is a pure `Authorization_Service.resolveIdentity(claims, record)` (the middleware supplies the record)
- Date: 2026-07-14
- Phase: Implementation (Task 8 — §05)
- Status: **Active (CONFIRMED)** — enacted in `server/auth-management/services/authorization.service.js` (`resolveIdentity`); verified by `authorization.service.test.js` (P-013 exercises it directly with injected records).
- Links: D-015, D-027, N-011, REQ-10, P-013, `design/05` §4.1/§9.1b, N-036, `design/05` §1.1 (middleware seam, Task 13)
- Context: `design/05` §4.1 describes the live-identity resolution (verify token → load live record via `getUserCache` → reject missing/disabled → `tokenVersion` check → derive roles/groups/mustRotate from the record) as steps "the middleware performs." Tasks 8.6 (P-013) and 13.1 both reference this resolution, creating ambiguity about WHERE the logic lives and how P-013 (a Task-8 property) can be tested without a running HTTP middleware.
- Statement: The PURE resolution logic is implemented as `Authorization_Service.resolveIdentity(tokenClaims, record)` — a synchronous, side-effect-free function of the verified claims and the live account record: returns `{ authenticated:false }` when `record` is absent or `metadata.disabled`, or when `Number(claims.tokenVersion||0) < Number(record.metadata.tokenVersion||0)` (D-027 coercion); otherwise `{ authenticated:true, username, roles: record.roles, groups: record.groups, mustRotate: !!record.metadata.mustRotate }`. The API-layer middleware (Task 13) performs ONLY the FUXA-specific parts — `Token_Service.verify` and `runtime.users.getUserCache(username)` — then calls `resolveIdentity(claims, record)` and `isAllowed(identity, operation)`.
- Rationale (precise): §4.1's steps are pure given the record; extracting them into a service function makes P-013 unit/property-testable at the service layer (exactly where task 8.6 places it) without spinning up Express, and keeps the middleware (Task 13) a thin adapter over `getUserCache`. This honors the §4.3 purity claim (isAllowed is a pure function of the identity) and the D-003 boundary (the FUXA `usersMap`/`getUserCache` touch stays in the middleware/adapter, not in the pure service).
- Alternatives considered: (a) put the resolution only in the middleware (Task 13) — REJECTED: P-013 (task 8.6) would be untestable until Task 13 and would require HTTP plumbing to test a pure rule; drift from tasks. (b) resolve inside `isAllowed` — REJECTED: conflates identity-building with the decision, and `isAllowed` must stay a pure function of an already-built identity (§4.3/P-006). 
- Impact / Risk: `resolveIdentity` is pure and store-free (the caller supplies the record), so it adds no coupling; the middleware still owns the single `getUserCache` lookup. `isAllowed`/`isAdministrator`/`effective` resolve role→permission via the injected `Role_Store` (async) and are unchanged by this decision.
- Verification: `authorization.service.test.js` — P-013 calls `resolveIdentity` with (a) a deleted account (undefined record) ⇒ authenticated:false ⇒ isAllowed 401; (b) a legacy token (tokenVersion absent ⇒ 0) vs an account bumped to ≥1 ⇒ authenticated:false; (c) a never-bumped account + legacy token ⇒ authenticated:true; (d) a live role change reflected in the resolved identity.

### D-033: The atomic last-admin guard is a store-adapter method `deleteGuarded(username, isAdministratorFn)` (not a service-run transaction)
- Date: 2026-07-14
- Phase: Implementation (Task 9 — §04/§06)
- Status: **Active (CONFIRMED)** — enacted in `server/auth-management/adapters/fuxa-user-store.adapter.js` (`deleteGuarded`) + `store/user-store.interface.js`; consumed by `services/user.service.js`; verified by `user.service.test.js` (P-016 @100 + last-admin single/non-last integration).
- Links: D-020, D-016, N-016, AC-8.3, AC-8.5, P-016, `design/04` §6.1/§6.5, `design/06` §5.4, DEF-U1 (traceability §F), N-037
- Context: DEF-U1 — `design/04` §6.5 mandates the last-admin count→guard→delete run in ONE `BEGIN IMMEDIATE` transaction "on the adapter's own connection", but the `User_Store` interface exposed only separate `readAll`/`delete`, and `design/04` §1.1 + AC-16.3 forbid the pure service from running SQL/transactions. Task-2.9's note ("User_Service.delete is the transaction site") further implied the service orchestrates the transaction — a layering contradiction. A service-level `readAll`-then-`delete` across `await`s is exactly the N-016 TOCTOU (two concurrent last-admin deletes both pass the count → zero admins).
- Statement: The whole existence-check → admin-classify → remaining-admin-count → conditional row-removal + cache-eviction critical section is realized as a single atomic store-adapter method `User_Store.deleteGuarded(username, isAdministratorFn)`, executed inside one `BEGIN IMMEDIATE` transaction on the adapter's own connection (`FuxaAuthDb`). It returns a closed outcome `{ kind:'deleted' | 'unknown_user' | 'last_admin' }` and makes NO mutation on `unknown_user`/`last_admin`. The `User_Service` TRIGGERS it and passes the §05 admin-determination predicate as a PURE injected async callback (`isAdministratorFn(record) → Promise<boolean>`); the service performs no SQL (AC-16.3) and the adapter gains no RBAC knowledge (single-owner classification, §05). The best-effort `usersMap` cache eviction runs AFTER COMMIT and only when a row was removed (AC-8.2).
- Rationale (precise): (1) Only the adapter owns the sqlite connection (§06), so only the adapter can hold the `BEGIN IMMEDIATE` write-lock across the count and the delete — the sole way to serialize concurrent last-admin deletes (P-016) and honor §6.5 literally. (2) Injecting the classifier keeps "what is an administrator" single-owned by §05 and keeps the adapter free of RBAC coupling. (3) A group-code admin (`groups ∈ {-1,255}`) is classified by §05 WITHOUT any role read, so the common seeded-admin case touches no other table; when the predicate does read roles it uses the same connection and observes the transaction's consistent snapshot. (4) Reconciles the imprecise Task-2.9 phrasing: the service is the trigger, the adapter is the transaction site.
- Alternatives considered: (a) service opens the transaction via an injected `FuxaAuthDb` — rejected: violates AC-16.3 (service touches storage/SQL directly) and couples the pure service to sqlite. (b) keep a service-level `readAll`+`delete` sequential guard — rejected: the N-016 TOCTOU (zero-admin lockout) an unacceptable IAM defect. (c) push admin classification INTO the adapter — rejected: duplicates the §05 predicate (dual source of truth / drift).
- Impact / Risk: Adds one method to the `User_Store` seam. The injected classifier runs inside the transaction; it must remain read-only (it is — `isAdministrator` only reads) so it cannot deadlock the `_txQueue` (N-032). Multi-node HA still needs D-016(b) (flagged in §6.5).
- Verification: `user.service.test.js` — Property 16 @100 (concurrent deletes of all admins → exactly one survives, ≥1 admin invariant), plus last-admin single/non-last integration and the delete-outcome-mapping unit tests.

### D-034: Password-policy configuration keys + defaults (min length 12, common-password blocklist)
- Date: 2026-07-14
- Phase: Implementation (Task 9 — §04 §2.3, REQ-4 AC-4.7)
- Status: **Active (CONFIRMED)** — enacted in `server/auth-management/services/user.service.js`; verified by `user.service.test.js` (policy cases + configurable-override test).
- Links: REQ-4 (AC-4.6/AC-4.7), DV-007, D-017, N-012, N-027/D-025, `design/04` §2.3, N-037
- Context: AC-4.7 requires rejecting a password "shorter than the configured minimum length (default 12 characters) OR on the configured common-password blocklist", and `design/04` §2.3 says "configured" without pinning the setting keys, the blocklist source, or comparison semantics. AC-4.6 requires rejecting >72 UTF-8 bytes. These are `User_Service` VALIDATION concerns (the hasher stays total, §03).
- Statement: The `User_Service` reads the policy from `settings.auth`: `passwordMinLength` (default **12** characters, counted as Unicode code points, per AC-4.7) and `passwordBlocklist` (an array; when unset, a small built-in default list of common ≥12-char passwords). Blocklist matching is **case-insensitive** (compare `plaintext.toLowerCase()` against a lower-cased set). Validation order on create + password-bearing update: required/non-empty → malformed-UTF-16 reject (D-025 defense-in-depth via the shared `hasLoneSurrogate`) → >72 UTF-8 bytes reject (AC-4.6, `Buffer.byteLength(pw,'utf8')`) → < min length reject (AC-4.7) → blocklist reject (AC-4.7). All rejections return `{ kind:'invalid', error:'validation_error', detail }` with NO hashing and NO store mutation.
- Rationale (precise): (1) The `settings.auth.*` namespace matches the existing convention (D-008 `bcryptCost`, D-029 `jwtIssuer`/`jwtAudience`), so operators configure auth policy in one place. (2) Default 12 is exactly the requirement's stated default; code-point counting avoids a surrogate-pair character counting as two. (3) Case-insensitive matching is the standard blocklist semantic (an attacker's `Password1234` and `password1234` are the same weak secret). (4) Enforcing malformed-UTF-16 at the service boundary is the D-025 defense-in-depth the design asked for (the hasher guard remains the backstop). (5) A built-in default blocklist means the policy is non-trivial out-of-the-box while remaining fully overridable.
- Alternatives considered: (a) no built-in blocklist (empty default) — rejected: ships a weaker-than-implied default; the requirement says "configured common-password blocklist", implying one exists. (b) counting length in UTF-16 units — rejected: a non-BMP character would miscount. (c) a large bundled blocklist (e.g. rockyou) — deferred: out of scope now; the seam accepts any operator-supplied list, and the ≥12 minimum already blocks most weak inputs.
- Impact / Risk: The built-in default blocklist is intentionally small (the min-length rule does most of the work); operators handling exposed deployments should supply a fuller `passwordBlocklist`. Documented as a note, not a hidden assumption.
- Verification: `user.service.test.js` — the DEF-U2 policy cases (>72 bytes incl. multibyte, <12 chars, blocklisted, omitted/blank, malformed UTF-16) all yield `validation_error` with no hash/no write; a `settings.auth` override test confirms a custom min length + blocklist is honored case-insensitively.

### D-035: Enrollment model — the CSPRNG one-time secret is delivered via an injected `EnrollmentChannel` seam; a one-time token store is the automated channel (resolves the §3.2 ambiguity)
- Date: 2026-07-14
- Phase: Implementation (Task 12 — §12 §3.2)
- Status: **Active (CONFIRMED)** — enacted in `server/auth-management/services/enrollment.js` (`OneTimeEnrollmentTokenStore` + `TokenEnrollmentChannel`) and consumed by `services/bootstrap.js`; verified by `bootstrap.test.js` (§10.4 log-safety + token single-use/TTL/hashed-at-rest).
- Links: REQ-17, D-022, N-018, N-007, `design/12` §3.2/§3.4/§8/§10.4, N-038
- Context: `design/12` §3.2 described the enrollment channel in two shapes that read inconsistently: (a) "the module generates a cryptographically random initial secret … delivered to the operator through a secure enrollment channel", and (b) an interactive CLI where "the operator sets the initial secret directly" / an automated "one-time enrollment token … redeemed to set the real secret". It did not fix the seam signature, whether the module or the operator produces the secret, or how the token relates to the credential — an ambiguity that would drive divergent implementations.
- Statement: The bootstrap/migration routine ALWAYS generates a **CSPRNG one-time secret**, stores only its hash (seed/re-hash), arms `mustRotate`, and hands the plaintext to a single injected seam `EnrollmentChannel.deliver({ username, secret, reason })` — the plaintext is NEVER logged, NEVER returned from `runBootstrap`, NEVER persisted in cleartext (the D-022 invariant). Delivery mechanism (a channel implementation, injected at the composition root):
  - **Automated provisioning:** `TokenEnrollmentChannel` backed by `OneTimeEnrollmentTokenStore` — issues a CSPRNG enrollment **token** (persisted **hashed-at-rest** via SHA-256, **TTL-bounded**, **single-use**) and surfaces ONLY the raw token to an injected operator sink (a secure out-of-band channel — restricted-perm file / secrets manager / ops tool — never `runtime.logger`/`console`). The operator redeems the token exactly once to obtain the one-time secret (`redeem` → `{ username, secret }`), then signs in and rotates.
  - **Interactive first-run:** an operator-supplied `EnrollmentChannel` whose `deliver` collects/sets the secret at a controlled console — thin operational glue finalized at the composition root (Task 13/14); it likewise must not log the secret.
- Rationale (precise): (1) A single seam keeps the bootstrap decoupled from the deployment shape (headless vs interactive) and makes the D-022 no-logging invariant a one-line, testable contract (bootstrap calls only `enrollmentChannel.deliver`, never a logger). (2) Persisting only the token's SHA-256 (never the raw token) + single-use + TTL is the concrete realization §3.2/§10.4 require and is fully unit-testable without I/O. (3) Making the module always generate the secret (rather than sometimes the operator) removes the ambiguity and guarantees the seed/migration credential is high-entropy and unknown even in interactive mode (the interactive channel simply chooses HOW the operator receives it). (4) Injection lets the HTTP token-redemption endpoint + console collector live at the API/composition layer (Task 13/14) without the bootstrap depending on either.
- Alternatives considered: (a) bootstrap emits the secret to a permission-restricted file + a single console/log line (the PRE-D-022 design) — rejected: that is credential disclosure via logs (N-018). (b) store no secret and let the operator set the credential at redemption — viable and marginally stronger (no transient secret at rest); recorded as a documented follow-up, not implemented now (the single-use/TTL/hashed-token guarantees are identical either way). (c) a fixed/derived initial secret — rejected: reintroduces N-007's known-default takeover.
- Impact / Risk: The `OneTimeEnrollmentTokenStore` buffers the plaintext secret in memory until redeemed/expired — acceptable for an enrollment hand-off buffer, documented; the follow-up (b) removes even that. The composition root MUST inject a real, secure `operatorSink` (not a logger) — flagged for Task 13/14.
- Verification: `bootstrap.test.js` — token single-use (second redeem → `used`), TTL (post-expiry → `expired`), hashed-at-rest (raw token absent from the store map), the channel surfaces only the token (no `secret` key) to the sink; and the seed/migration audit trail is secret-free (§10.4).


---

### D-036: Client verification strategy — pure framework-free core + thin @Injectable shells, headless jest/ts-jest (no TestBed/karma/browser)
- Date: 2026-07-15
- Phase: Implementation (Task 15)
- Status: Active (CONFIRMED by necessity — verified blocker N-044)
- Links: Task 15.2/15.3/15.4, D-011, DV-009, N-043, N-044, REQ-11, REQ-12, AC-16.2
- Context: The spec did not name a client test runner. FUXA's `client/` had NO test runner at all (no karma/jasmine/jest, no `test` script, zero `.spec.ts` — N-043) and, once npm-installed, the committed app does NOT build against its own committed deps (N-044, upstream dep drift, 27 pre-existing src errors that are out-of-auth-scope and un-editable under D-003). So neither `ng test` (karma, needs a browser + compiles the whole broken app) nor `jest-preset-angular` (runs the Angular compiler over the reachable — broken — graph) can verify our client code here.
- Statement: The auth-management client code is structured as (1) a PURE, framework-free core `auth-protocol.ts` (all mapping + stable error normalization; ZERO Angular imports) and (2) THIN `@Injectable({providedIn:'root'})` shells (`auth-signin.client.ts`, `user-admin.client.ts`, `role-admin.client.ts`) that only wire rxjs `HttpClient` calls to that core. Verification is headless: `jest@29` + `ts-jest@29` with `testEnvironment:node`, `roots` scoped to `src/app/auth-management/`, an inline strict tsconfig, and `moduleNameMapper` stubs for the three runtime deps the shells touch (`@angular/core` → no-op `Injectable`, `@angular/common/http` → minimal `HttpHeaders`, FUXA-core `_helpers/endpointapi` → deterministic `getURL()`). A separate `tsconfig.verify.json` runs `tsc` over the shells against the REAL Angular 18 types (0 errors). Added client devDeps: `jest`, `ts-jest`, `@types/jest` (verified: only these 3, `git diff client/package.json`).
- Rationale (precise, all verified):
  1. **Testability under a broken host (N-044).** The pure-core/thin-shell split is what makes the logic verifiable WITHOUT the Angular runtime or the broken app graph: the core is plain TS (jest runs it directly), and the shells are thin enough to test by direct instantiation with a stub `HttpClient`. This is the standard "functional core, imperative shell" pattern and it is the only mechanism that actually runs in this environment.
  2. **Type safety is not sacrificed.** `moduleNameMapper` affects RUNTIME resolution only; ts-jest still type-checks every shell against the real `@angular/*` declarations, and `tsconfig.verify.json` independently type-checks against Angular 18. So the shells are proven type-correct against the actual framework, not the stubs.
  3. **AC-16.2 boundary.** The component depends on the client INTERFACE, not on `HttpClient` — the pure core + injectable shell expresses exactly that seam.
  4. **No production contamination.** The stubs live only under `auth-management/testing/` and are referenced solely by jest via `moduleNameMapper`; no production import path touches them.
- Alternatives considered: (a) `HttpClientTestingModule`/`TestBed` — rejected here: needs a browser and compiles the broken app (N-044); deferred to the component tasks (16/17) after the platform dep-remediation (Option A). (b) `jest-preset-angular` — rejected: also invokes the Angular compiler over the broken graph. (c) Wait for the full platform fix before writing any client test — rejected: would leave the client clients unverified indefinitely and blocks REQ-11/12 progress that is independent of the dep drift.
- Impact / Risk: A future contributor must know client logic lives in the pure core (test it there) and that the shells are deliberately thin. If Angular internals change, `tsconfig.verify.json` (real types) is the guard, not the runtime stubs. When the platform builds again, a TestBed layer can be ADDED for components without changing this core/shell split.
- Verification: `npx jest` → 2 suites / 22 tests, exit 0 (green twice); `npx tsc -p src/app/auth-management/tsconfig.verify.json` → 0 errors.


---

### D-037: Remediate N-044 by restoring the Initial known-good client dependency set (revert the dependabot client-group bump), preserving the Task-15 jest devDeps
- Date: 2026-07-15
- Phase: Implementation (platform prerequisite for Tasks 15.1/16/17 + the D-014 cutover)
- Status: **Active (CONFIRMED + EXECUTED 2026-07-15)** — user approved proceeding with the recommendation; executed and VERIFIED (see OUTCOME). Was PROPOSED (edits FUXA core `client/package.json`/`package-lock.json` + reverts the dependabot bump, out of D-003) — approval obtained before execution.
- Links: N-044, N-046 (verified root cause), TO-014 (options weighed), D-014, D-011, TO-013, dependabot `0c488d5`, initial `be8d1e7`
- Context: See N-046 — the client does not build because dependabot `0c488d5` bumped the third-party Angular libs to Angular-21/22-targeting majors while the app is pinned to Angular 18 and the source uses the old APIs. This blocks the web-view and the auth UI tasks.
- Statement (proposed mechanism, precise + reversible):
  1. `git checkout be8d1e7 -- client/package.json client/package-lock.json` — restore the exact known-good, internally-consistent dependency set the source + Angular 18 core were built against (verified present at `be8d1e7`).
  2. Re-add the 3 Task-15 test devDeps on top (`jest@^29.7.0`, `ts-jest@^29.4.11`, `@types/jest@^29.5.14`) — these are additive, Angular-agnostic, and already verified working headlessly (N-045).
  3. `npm install` (under `client/`) to fold jest into the restored lock and materialize `node_modules` at the known-good versions.
  4. `npm run build` (`ng build`) to VERIFY the app compiles (0 errors) and produces a fresh `client/dist`.
  5. Re-run the auth-management jest suite (N-045) to confirm the client dependency change did not regress it (must stay 22/22).
- Rationale (precise): the defect is a dependency VERSION SKEW introduced by an automated bump; the root-level fix is to restore version alignment, NOT to rewrite source (TO-014 option 2, infeasible without also bumping Angular) or bump the Angular core (option 3, disproportionate/out-of-scope). Restoring the Initial set returns to a configuration that is known internally-consistent, matches the source, and is verifiable by an actual build. It is minimal and fully reversible via git.
- Alternatives considered: migrate source to the bumped majors (rejected — the majors need Angular 21/22, infeasible on pinned Angular 18; leaf-fix of a version-skew root); bump Angular core 18→21/22 + full app migration (rejected — enormous, high-risk, out of auth scope, no requirement drives it). Both in TO-014.
- Impact / Risk + mitigation: reverting the bump may re-introduce vulnerabilities some of the 33 updates patched. Mitigation (recorded, not dropped): the bumped state is un-buildable so it is not a deployable alternative anyway; after the baseline builds, security updates can be re-applied SELECTIVELY at Angular-18-compatible versions (e.g. latest 14.x ngx-translate, 4.x/5.x ng2-charts, 18.x gridster) as a follow-up. Because this touches FUXA core and reverts the user's dependabot PR, it will not be executed until the user approves.
- Verification (post-approval): `ng build` → 0 errors + fresh `client/dist`; app loads in a browser; auth jest suite stays 22/22; then Tasks 16/17 + the D-014 cutover proceed. On execution, flip this decision to Active (CONFIRMED) with the build result recorded.
- **OUTCOME 2026-07-15 (EXECUTED, all verified — N-047):** step 1 `git checkout be8d1e7 -- client/package.json client/package-lock.json` (exit 0); step 2 re-added `jest@^29.7.0`/`ts-jest@^29.4.11`/`@types/jest@^29.5.14`; step 3 `npm install` (exit 0 — removed 113 / added 52 / changed 67 pkgs, downgrading to the known-good set; EBADENGINE warnings on Node 24 are non-fatal); step 4 `npm run build` (`ng build`) → **exit 0, 0 compile errors**, produced a fresh `client/dist` (verified `client/dist/index.html` exists; initial total 24.01 MB); step 5 auth jest suite **still 22/22, exit 0** (no regression). Additional hygiene: added `app/auth-management/testing/**` to `src/tsconfig.app.json` `exclude` so the jest-only runtime stubs are not part of the production compilation (rebuild → exit 0, the stub "unused" warnings gone). **The web-view is UNBLOCKED**; N-044 is resolved; Tasks 16/17 + the D-014 cutover are no longer dep-blocked. Residuals recorded in N-047 (72 npm-audit findings to re-patch selectively at Angular-18-compatible versions; the auth-management client/guard/service files still warn "unused" until Tasks 16/17 import them — expected).

### D-038: Canonical client build/verify command is `ng build --configuration production` (do NOT alter FUXA's `angular.json` `defaultConfiguration`)
- Date: 2026-07-15
- Phase: Implementation
- Status: Active (CONFIRMED by evidence — FUXA `Dockerfile` + `README.md`)
- Links: N-048, N-047, D-037, D-003, `Dockerfile`, `README.md`, `client/angular.json`
- Context: The blank-page incident (N-048) was caused by serving a JIT dev build produced by the bare `npm run build`. FUXA's `angular.json` intentionally leaves `defaultConfiguration:""` (so `npm run build` is a DEV build) while its `Dockerfile` builds the shipped artifact with `--configuration production`.
- Statement: The module's client build AND every "verify-by-build" step (Task 16/17 Definition of Done, the D-014 cutover verification, any future client change) MUST use `ng build --configuration production` (matching FUXA's `Dockerfile`), which is the only command that yields a servable AOT/optimized artifact. We MUST NOT modify `angular.json`'s `defaultConfiguration` nor the `build` npm script to make `npm run build` produce production output.
- Rationale (precise): (a) It is the ROOT-correct command — FUXA itself ships this way (`Dockerfile` line `RUN npm run build -- --configuration production`; `README.md` `ng build --configuration=production`), so we align with the upstream contract instead of diverging. (b) Changing `defaultConfiguration`/the `build` script would edit FUXA-core build config with an APP-WIDE blast radius (it changes behaviour for every other FUXA build/serve path, not just ours) for no requirement — outside the D-003 "touch FUXA core minimally, through seams" intent. (c) The production build reproduces the committed shipped `client/dist` byte-for-byte (N-048), which independently proves this command yields the correct, working artifact.
- Alternatives considered: (1) Set `defaultConfiguration:"production"` so `npm run build` becomes production — rejected: modifies FUXA-core config with app-wide effect, diverges from the shipped `Dockerfile` contract, and could surprise other FUXA workflows (dev serve, `demo`/`client` configs). (2) Add a new `build:prod` npm script — rejected as redundant surface: `--configuration production` already exists and is exactly what the `Dockerfile` invokes; an alias adds a second way to say the same thing (drift risk). (3) Serve the JIT dev build — rejected: it renders blank, is unoptimized, and is not commercial-grade.
- Impact / Risk: The AOT production build is slower (~a few minutes vs the faster JIT) — acceptable for a verify/ship step. Residual: a future session must remember to pass `--configuration production` when verifying client changes; this decision + the traceability build-note are the guardrail against re-forgetting.
- Verification: `Dockerfile` (`RUN npm run build -- --configuration production`); `README.md` (`ng build --configuration=production`); N-048's production build (exit 0, byte-identical to the committed `client/dist`, served over HTTP 200 with the production hashed chunks and no JIT `vendor.js`).


### D-039: The module's `Login_Page` is a STANDALONE Angular component (route + guard cutover deferred to Task 17.4), so Task 16.1 touches no FUXA-core file
- Date: 2026-07-15
- Phase: Implementation (Task 16.1)
- Status: Active (CONFIRMED by user 2026-07-15)
- Links: Task 16.1, 17.4, D-003, D-011, design/07 §4.2/§5.3/§7.3, `client/src/app/app.routing.ts`, `client/src/app/app.module.ts`, `client/src/app/auth.guard.ts`
- Context: `design/07` calls the Login_Page a "routed page" but does not specify HOW it is registered under D-003. VERIFIED: FUXA's app is 100% NgModule-based (0 standalone components); `app.routing.ts` maps `''`/`home`/`home/:viewName`→`HomeComponent` with `canActivate:[AuthGuard]` COMMENTED OUT (home is public), and the authenticated areas (`editor`/`users`/…) are gated by `AuthGuard` which presents login as a **MatDialog** (`this.dialog.open(LoginComponent)`) — there is NO `login` route today. A conventional (NgModule-declared) component would require editing FUXA-core `app.module.ts` `declarations` + `app.routing.ts` to exist.
- Statement: Implement `Login_Page` as an Angular **standalone component** (`standalone: true`, importing only `ReactiveFormsModule` + its own module-owned seams) under `client/src/app/auth-management/login/`. Task 16.1 therefore creates ONLY files under `auth-management/` and edits **no FUXA-core file**. The route registration (`loadComponent` in `app.routing.ts`) and the `AuthGuard`→routed-page cutover (retiring the dialog) are the single coordinated change owned by **Task 17.4** (the D-011/D-014 SUPERSEDE cutover), landing with the User-Management page. On success the presenter navigates via the injected Angular `Router` to `'/'` (the verified public landing); the guarded-area interaction is settled at the 17.4 cutover (design/07 §5.3/§7.3).
- Rationale (precise): (a) Standalone is the D-003-minimal registration — it lets 17.4 add the route via `loadComponent` WITHOUT touching `app.module.ts` `declarations`, keeping FUXA-core pristine for upgrade-merge safety (N-001); (b) Angular 18.2 (pinned, verified) fully supports standalone components, so this adds no dependency and no risk; (c) it keeps Task 16.1 a pure additive change (no FUXA-core edit, fully reversible), matching every prior client task; (d) deferring route/guard wiring to 17.4 matches design/07 §7.3's explicit "migration reconciliation is a tasks-phase cutover" and avoids a half-wired login mid-migration.
- Alternatives considered: (1) NgModule-declared component added to `app.module.ts` now — rejected: edits FUXA-core earlier than necessary and the declaration is dead until the 17.4 cutover anyway (the user chose against this option). (2) A lazy-loaded feature `NgModule` for auth-management — rejected: heavier than a standalone component for a single page and still needs a route edit; standalone is the lighter idiomatic Angular-18 form.
- Impact / Risk: Two login surfaces (FUXA dialog + module standalone page) only ever coexist AFTER 17.4 wires the route; until 17.4 the standalone component is not reachable in the running app (built + unit-verified only) — intended and consistent with TO-013 client-first sequencing. No FUXA-core edit in Task 16.1.
- Verification: Task 16.1 diff touches only `client/src/app/auth-management/**`; `git status` shows no FUXA-core client file changed; `ng build --configuration production` (D-038) compiles the standalone component; the route/guard wiring appears only in the Task 17.4 change.


### D-040: Add a top-level SPA `index.html` fallback in `server/main.js` (fixes the N-052 deep-route 404) — a FUXA-core platform fix, explicitly OUTSIDE the auth-management D-003 boundary
- Date: 2026-07-15
- Phase: Implementation (platform fix, user-requested)
- Status: Active (CONFIRMED by user 2026-07-15 — user repeatedly requested fixing the "many errors when opening the web in a browser" and to fix at the root; proceed-by-recommendation directive)
- Links: N-052, `server/main.js`, `server/integrations/node-red/index.js`, D-003 (scope boundary), TO-013
- Context: N-052 VERIFIED that direct-load/refresh of ~13 client routes (`/alarms`, `/messages`, `/notifications`, `/scripts`, `/reports`, `/language`, `/logs`, `/events`, `/mapsLocations`, `/flows`, `/apikeys`, `/userRoles`, `/arMarkers`) returns HTTP 404, because `main.js` serves the client via a stale HARDCODED `express.static` per-route list with NO `app.get('*')` fallback, and the only SPA catch-all lives inside `mountNodeRedIfInstalled()` (not mounted here → `settings.nodeRedEnabled` off / `/nodered` 404).
- Statement: Register ONE SPA catch-all in `main.js` inside the existing `if (settings.disableServer !== false)` block, immediately AFTER `app.use('/', FUXA.httpApi)` and BEFORE `server.listen(...)`, so it is the LAST GET handler: `app.get('*', (req,res,next) => { if path startsWith /api/ , /api-docs, /nodered, /dashboard, or contains '.' → next(); else res.sendFile(httpStatic + '/index.html'); })`. This lifts the exact logic already proven in the node-red integration to run UNCONDITIONALLY, and makes the fragile hardcoded per-route static list a non-issue.
- Rationale (precise): (a) ROOT fix — the defect is "the SPA fallback is only registered as a side-effect of an optional integration"; the correct level is a first-class, always-on fallback, not adding each missing route to the static list (that would be leaf-patching a list that will drift again). (b) Placement after the API mount + static mounts guarantees it never shadows an API route, a static asset (dotted), or an explicit static mount; it only catches unmatched GET navigations. (c) Mirrors FUXA's own node-red catch-all logic, so behavior is consistent with upstream intent. (d) Minimal, reversible (one small block), and directly serves the user's "commercial-grade, no errors on refresh" requirement.
- Alternatives considered: (1) Extend the hardcoded `express.static` list in `main.js` with the 13 missing routes — rejected: leaf patch; the list already drifted once and will drift again as client routes are added; does not fix the root (missing fallback). (2) Force-enable Node-RED so its catch-all registers — rejected: couples SPA serving to an unrelated optional integration, heavier, and changes runtime behavior for no reason. (3) Configure a reverse proxy SPA rewrite — rejected: external to the app, not portable, doesn't fix the bundled server.
- Impact / Risk + scope: This edits FUXA-CORE `server/main.js` and is **OUTSIDE the auth-management module's D-003 boundary** (which confines auth code to adapters + one router-mount line). It is a SEPARATE, pre-existing platform defect fix, authorized by the user's explicit repeated request to fix the web errors, and logged transparently here. Blast radius: app routing (medium) — mitigated by placing the handler LAST and excluding API/asset/integration paths, and by the full re-verification below. Upgrade note: on a future FUXA upgrade this one block may need re-applying/merging (recorded so it is not lost).
- Verification: after the edit, restart the server and re-load ALL 13 previously-404 routes → expect HTTP 200 + the Angular app renders (checked via `curl -w %{http_code}` AND the Playwright MCP navigating + asserting the app shell renders with 0 console errors); confirm `/api/...` GETs and static assets are unaffected (still 200/their own handlers), and that `/` + `/editor` still render.


### D-041: Node-RED auth default hardened to `secure` in `server/main.js` (fail-secure); + runtime-config posture for Node-RED — FUXA-core, outside auth D-003
- Date: 2026-07-15
- Phase: Implementation (platform security hardening, user-directed runtime-config discussion)
- Status: Active (CONFIRMED by user 2026-07-15 — "hướng tới cấu hình khi runtime" + "duyệt theo khuyến nghị từng bước" + "an toàn/thương mại"); enacts TO-015
- Links: N-054, TO-015, N-052/N-053, D-040, `server/main.js` (~203), `server/api/index.js` (~166), `server/settings.default.js`
- Context: FUXA already provides runtime configuration (admin `POST /api/settings` → persist `_appdata/settings.js` + live-merge + `runtime.restart(true)`); `nodeRedEnabled` defaults OFF. N-054 found the startup path defaulted an enabled-without-mode Node-RED to `legacy-open` (no auth) while the API path forced `secure`.
- Statement (this change — enacted now): in `server/main.js`, change the enabled-without-`nodeRedAuthMode` fallback from `'legacy-open'` to **`'secure'`** (fail-secure, matching the API path), so no configuration path can silently expose an unauthenticated `/nodered`. `legacy-open` remains available only as an EXPLICIT opt-in.
- Runtime-config posture (recommendation adopted, no new mechanism built): keep Node-RED **default OFF, toggled at runtime via the EXISTING admin Settings → `POST /api/settings`** flow — this matches the user's "cấu hình khi runtime" using FUXA's own persisted-settings+restart mechanism (avoids a bespoke parallel system → less drift).
- Planned follow-ups (logged so they are not dropped; to be done next, may be split into their own IDs):
  1. **Client `/flows` gating (UX/runtime):** show the `/flows` menu entry + route only when the live `nodeRedEnabled` (from `/api/settings`, which the client already fetches) is true — dynamically removing the N-052/N-053 `/flows`→`/nodered` 404 without hiding a feature the admin enabled. (Client FUXA-core; design-first investigation of the menu structure pending.)
  2. **Verify mount-on-restart (UNVERIFIED, N-054):** test whether enabling Node-RED via the Settings UI actually mounts `/nodered` after `runtime.restart(true)` or requires a full PROCESS restart; make the UI communicate the correct requirement.
- Rationale (precise): (a) security defaults must fail CLOSED — Node-RED is an arbitrary-code-execution surface; a silent unauthenticated default is unacceptable for a commercial-safe product (TO-015). (b) Reusing FUXA's existing runtime-settings+restart mechanism for the enable/disable toggle is the root-correct "runtime config" (the user's direction) without inventing a fragile hot-mount system. (c) Gating `/flows` on the live setting is the runtime-driven UX that removes the residual 404 at its source (the page should not be reachable when its backend isn't mounted).
- Alternatives considered: keep `legacy-open` (rejected — insecure default, TO-015); build a bespoke hot-enable/disable of Node-RED without restart (rejected — Express can't cleanly unmount middleware and hot-managing a code-execution runtime is high-risk/complex for no requirement; FUXA's restart-to-apply model is the pragmatic safe choice); force Node-RED always-on (rejected — unnecessary attack surface, no need).
- Impact / Risk: FUXA-core edit to `server/main.js` (one default value), OUTSIDE the auth-management D-003 boundary, user-authorized; fail-SAFE (more restrictive). A legacy open-Node-RED install now requires auth (TO-015 mitigation). Upgrade note: re-apply on FUXA upgrade. The `/flows` gating (follow-up 1) will touch FUXA-core client files — to be confirmed after the menu-structure investigation.
- Verification: `main.js` grep shows no `'legacy-open'` default remains; server restarts cleanly; `nodeRedSecurity.test.js` still passes; (follow-ups) `/flows` entry hidden when `nodeRedEnabled=false` + reachable when true; a Settings-toggle test confirms the mount/restart requirement.


---

### D-042: Task 17.4 SUPERSEDE-cutover design (groups↔roles integration) — validated options + recommendation, pending user's approach choice before the high-risk FUXA-core edits
- Date: 2026-07-16
- Phase: Implementation design (Task 17.4, the last core task)
- Status: **PROPOSED — design validated against source; awaiting the user's choice of approach** before touching FUXA-core client authorization (high-risk, hard-to-reverse)
- Links: N-042, N-063 (live impedance evidence), TO-013 (cutover sequencing), D-011/D-014/D-007, `auth.guard.ts`, `_services/auth.service.ts`, `login/login.component.ts`, `server/api/index.js`
- Validated integration facts (read from source this turn, not assumed):
  1. `AuthGuard.canActivate` allows a protected route iff `!isSecurityEnabled()` OR **`authService.isAdmin()`**; otherwise it opens FUXA's `LoginComponent` dialog and, on close, re-checks `isAdmin()`. `AuthService.isAdmin()` tests **`currentUser.groups`** against `UserGroups.ADMINMASK=[-1,255]` (numeric groups).
  2. FUXA establishes a session via `AuthService.signIn(u,p)` → POST `/api/signin` → stores `currentUser={username,fullname,groups,info,token}` in `sessionStorage`, publishes `window.fuxaAccessToken`, and emits `currentUser$`. The `x-access-token` interceptor + 401/403 sign-out reuse `currentUser.token`.
  3. The module's `SessionStore.save` writes `{token,username,fullname,roles}` (NO `groups`) and does NOT update `AuthService`'s in-memory `currentUser` (read once at construction). The module server `authentication.router.js` returns `{token,username,fullname,roles}` (D-007, NO `groups`).
  → Therefore, as proven live (N-063): a module login neither updates FUXA's in-memory session nor carries `groups`, so `isAdmin()`/guard/interceptor do not recognize it. This is the crux the cutover must resolve.
- Options weighed:
  1. **Full groups→roles migration of FUXA's client (big).** Rewrite `AuthService.isAdmin()`/`checkPermission()`, `AuthGuard`, and the interceptor to be roles-based, and supersede FUXA's `/api/signin`/`/api/users`/`/api/roles` with the module routers (`api/index.js`). Pros: the module's roles model becomes the single source end-to-end (D-007/D-014 fully realized). Cons: HIGH blast radius — those functions gate the ENTIRE app; a regression breaks all authorization; touches many FUXA-core files; hard to reverse.
  2. **Reuse FUXA's session mechanism from the module Login_Page (pragmatic, low-risk, RECOMMENDED).** Keep FUXA's groups-based `isAdmin()`/guard/interceptor UNCHANGED. The module's routed Login_Page keeps its own form/validation/pending/error-normalization UI, but on submit establishes the session through FUXA's `AuthService` (so `currentUser` incl. `groups` + `currentUser$` are populated exactly as FUXA expects) — i.e. the module owns the LOGIN UX while FUXA's proven session plumbing (D-002) owns session state. The module's roles-first clients continue to drive the User-Management RBAC UI independently. Point `AuthGuard` at the module Login_Page and gate FUXA's legacy `/login` dialog behind a reversible `legacy` flag. Pros: login works end-to-end with MINIMAL FUXA-core change and NO risky rewrite of app-wide authorization; reversible; reuses proven plumbing. Cons: FUXA authorization stays groups-based (roles are the module's User-Management concern, not the app-wide gate) — the "roles as the single app-wide authority" (D-007/D-014) is deferred to option 1 as a later, separately-approved migration.
  3. **Transitional payload-compat shim.** Module `/api/signin` also returns `groups` so the legacy client works, then supersede the server. Pros: quick. Cons: leaf-patch (re-surfaces `groups`, grows tech debt); module-created roles-only users have no `groups` so the legacy gate still can't see them — rejected as an end state (TO-013 option 2).
- Recommendation: **Option 2** for the near-term working cutover (lowest risk, reversible, reuses FUXA's proven session mechanism, makes the module login usable end-to-end), with **Option 1 (full groups→roles) recorded as a later, separately-approved migration** once the module is live and the roles model is exercised. Reason: rewriting app-wide authorization (option 1) is disproportionate risk to do in one step; option 2 delivers the user-visible outcome (module login + user-management on the web) safely and reversibly, and does not preclude option 1 later.
- Impact / Risk + reversibility: option 2 edits `app.routing.ts` (guard → module Login_Page) + a small module Login_Page change (delegate session establishment to `AuthService`) + a `legacy` flag; all reversible via git + the flag. It does NOT touch `server/api/index.js` (server stays FUXA's `/api/signin` which returns `groups`) — so no server cutover risk yet.
- Verification (planned, after the user picks an approach): with `secureEnabled=true`, log in via the module Login_Page in a real browser (Playwright) → `AuthGuard` grants protected routes, the header shows the admin, and `/auth/users` lists users — then revert security.
- Awaiting: user's choice of Option 1 vs 2 (I recommend 2), + confirmation to make the (reversible) FUXA-core routing edit.


### D-043: Option-1 (full server SUPERSEDE + groups→roles) staged execution plan — design-validated, data-affecting, approval-gated
- Date: 2026-07-16
- Phase: Implementation (Task 17.4 Option-1 — the remaining high-risk cutover after Option-2 login DONE, N-066)
- Status: **PROPOSED — plan validated against source; NOT executed (force-rotates the live admin + app-wide client migration → needs explicit user go)**
- Links: D-042, D-014, TO-013, N-042, N-059, N-060, N-066, N-038/DEF-B1, D-013, `server/api/index.js`, `server/auth-management/index.js`, `services/bootstrap.js`, `services/enrollment.js`, `client/src/app/{_services/auth.service.ts,auth.guard.ts,_helpers/auth-interceptor.ts}`
- VERIFIED facts grounding the plan (read this session): (a) `runBootstrap` on the CURRENT DB (has `admin`/`123456`, groups=-1) takes `_remediateKnownDefaultAdmins` → **re-hashes the admin to a fresh CSPRNG secret + `mustRotate=true`, delivered via `enrollmentChannel`** (DEF-B1) → **after cutover `admin`/`123456` NO LONGER works**; (b) `TokenEnrollmentChannel.deliver` buffers the secret behind a single-use token in an IN-MEMORY (per-process) `OneTimeEnrollmentTokenStore` and hands ONLY the token to an `operatorSink`; the secret is retrievable once via `store.redeem(token)` — a store method with NO wired surface (N-060) and, being in-memory, NOT reachable from a separate-process CLI; (c) `createAuthManagementModule` returns the router owning the identity URLs; mounting it (per D-014) means un-mounting FUXA `usersApi`/`authApi`; (d) the client authority is groups-based (N-042) and must migrate to roles.
- Staged plan (each stage reversible/verified; flag DEFAULT-OFF until the coordinated flip):
  1. **Enrollment retrieval flow (unblocks N-060, prerequisite):** an `operatorSink` that (i) writes `{username, token, expiresAt}` to a 0600 file under `_appdata` AND (ii) prints a redeem instruction to the SERVER STARTUP CONSOLE (the operator's controlled terminal running `node main.js` — distinct from the shared `fuxa.log`, permissible per D-035's "controlled console"); + a minimal IN-PROCESS single-use redeem surface (`POST /api/account/enrollment/redeem {token}` on the module router, returns the secret ONCE — gated by the single-use+TTL hashed token) so the admin can obtain the rotated secret, sign in (rotate-gated), and rotate via `POST /api/account/rotate-password`. Additive module code, no FUXA-core, no data impact until mounted.
  2. **Server SUPERSEDE behind `settings.authModuleEnabled` (DEFAULT OFF):** in `server/api/index.js`, when ON: `await createAuthManagementModule(...)` (wired with `TokenEnrollmentChannel` + the operatorSink of stage 1, `runtime.users`, `createFuxaAuditSink`, db→FUXA `users.fuxap.db` workDir, settings) + mount its router after `authLimiter` + SKIP FUXA `usersApi`/`authApi`; when OFF: unchanged. Verify OFF = zero change; ON (in isolation) = module owns the identity URLs (P-014).
  3. **Client `groups`→`roles` migration (N-042 root fix):** `AuthService.isAdmin()`/`checkPermission()`, `AuthGuard`, and the `x-auth-user` interceptor consume the module's first-class `roles` (from `/api/signin` `{roles}`); the module `/api/users` envelope now feeds the User-Management page (fixes the N-066 "No data"). Revert Option-2's login.component seam back to the module `AuthSignInClient` (roles-based).
  4. **Coordinated flip + e2e:** set `authModuleEnabled=true` + `secureEnabled=true`, rebuild `client/dist`, restart; the admin retrieves the rotated secret via stage-1 enrollment → signs in → rotates → full admin; Playwright/CDP verify sign-in + User-Management CRUD (list/create/edit/delete) + non-admin denied + 0 console errors. Then land as ONE commit (TO-013).
- Rationale: this is the ROOT fix for the N-066 "No data" + N-042 groups-impedance (module authoritative on the server + roles-based client), staged so every step is reversible and the highest-risk flip is last + verified. The enrollment retrieval flow (stage 1) closes the N-060 lockout at the root rather than shipping a lockout.
- Alternatives considered: make the module client tolerant of FUXA's bare-array `/api/users` (rejected — leaf-patch; makes the list show FUXA users with empty roles but CRUD still breaks on shape/semantics; perpetuates groups model); stay at Option-2 permanently (rejected — User-Management non-functional, not commercial-grade).
- Impact / Risk: DATA-AFFECTING — the cutover force-rotates `admin`/`123456` to an enrollment-delivered secret (admin/123456 stops working); app-wide client auth model change; FUXA-core `server/api/index.js` edit. Mitigated by the DEFAULT-OFF flag, the reversible stages, and full e2e before the flip. **Requires explicit user approval before stage 2+ (data-affecting).**
- Verification: per-stage as above; final Playwright/CDP e2e with the module authoritative + security ON + the enrollment→rotate admin flow.

### D-044: Sign-in payload PROJECTS RBAC onto FUXA's session shape (SUPERSEDE client-compat bridge)
- Date: 2026-07-16
- Phase: Design (§01) + Implementation (Task 17.4 / D-043 stage 3)
- Status: Active (enacted 2026-07-16; module-only, non-data-affecting; the SUPERSEDE flip that makes it live is D-043 stage 4, approval-gated)
- Links: D-007, D-014, D-042 (Option B chosen), N-042, N-069, REQ-1, REQ-10, `authentication.service.js`, `client/_services/auth.service.ts`
- Context: Under the D-014 SUPERSEDE the module's `/api/signin` becomes the sole authority, but the
  running FUXA client authorizes on `currentUser.groups` (`isAdmin()` via `ADMINMASK`; `checkPermission`
  16-bit bitmask) and `currentUser.info.roles` (`infoRoles`, `checkPermission` role-mode when
  `settings.userRole=true`). The module's designed payload `{token,username,fullname,roles}` (D-007)
  carries neither `groups` nor `info`, so a bare SUPERSEDE breaks the client (N-042). D-042 posed
  Option-1 (full groups→roles rewrite, high-risk) vs Option-2 vs a projection; the user chose the
  projection ("duyệt theo khuyến nghị" → recommended low-risk root fix).
- Statement: The module's sign-in SUCCESS payload is extended to
  `{ token, username, fullname, roles, groups, info }`, where `groups` and `info` are DERIVED
  COMPATIBILITY PROJECTIONS (not new authority):
  - `groups` = **`-1` when the account is an administrator per the authoritative
    `Authorization_Service.isAdministrator(record)` predicate**, else the record's own numeric
    `groups` (or `0`). This is the ROOT-CORRECT derivation — VERIFIED that `UserService.create` never
    sets `groups` (module-created users have `groups=null`; admin is RBAC-role-based), so a raw
    `record.groups` passthrough would only classify the bootstrap admin (seeded `groups:-1`) and would
    misreport a module-created role-admin as non-admin. Deriving from `isAdministrator` fixes that at
    the essence and always reflects CURRENT role/permission state (no denormalized group column to
    drift).
  - `info` = `serialize({ roles })` — ONLY the roles array, so FUXA's `infoRoles` works while internal
    metadata (`mustRotate`/`tokenVersion`) is NOT leaked to the client.
  - `roles` stays first-class for the module's own UI.
  Implementation site: `Authentication_Service.signIn` success branch, with `Authorization_Service`
  injected as an OPTIONAL dependency (when absent — isolated unit tests — it falls back to
  `record.groups` passthrough so the pure sign-in decision stays testable without the role store; the
  composition root always injects it for the accurate derivation). The router returns the session
  verbatim (no router logic change).
- Rationale (precise, factual): reuses FUXA's EXISTING, tested authorization code (client + server
  `verifyGroups`) instead of rewriting the whole client+server authz model (Option-1's blast radius,
  N-069). The module remains the single RBAC authority; `groups`/`info` are derived views computed
  fresh at the session boundary — the SAME projection principle D-007 already applies to the token's
  `groups` claim, now extended to the response body, but hardened (admin derived from the authoritative
  predicate, info minimized to roles).
- Alternatives considered: (1) full groups→roles rewrite of `isAdmin`/`checkPermission`/guard/
  interceptor + FUXA server (rejected: disproportionate/high-risk, D-042 Option-1); (2) raw
  `record.groups` passthrough (rejected: only the bootstrap admin would be recognized — not
  root-correct for module-created role-admins); (3) denormalize `groups=-1` into the store on
  role-admin create/update (rejected: derived state drifts when a role's permissions change without
  touching the user).
- Impact / Risk: refines D-007's "no groups top-level / no raw info" client-facing stance for the
  SUPERSEDE path (documented reconciliation on D-007). DEPLOYMENT NOTE for stage 4: for NON-admin
  users' widget permissions to resolve, run `settings.userRole=true` (FUXA role-name mode → uses
  `infoRoles`); admins work in either mode (isAdmin short-circuits). The projected role IDs must match
  the identifiers the project's `permissionRoles` configs reference (data-alignment, not code).
- Verification: unit tests — (a) success session carries `info` with the record's roles + `groups`
  passthrough when no authorization injected; (b) WITH an authorization stub returning
  `isAdministrator=true`, session `groups===-1`; (c) non-admin stub → passthrough/0. Full server suite
  green. Live end-to-end (admin isAdmin + non-admin infoRoles permissions) is browser-verified at the
  stage-4 flip (both flags on) via CDP/Playwright, landed as one commit with the client + rebuilt dist.

### D-045: Forced first-login password-rotation UI (REQ-17 client) — closes the N-072 gap
- Date: 2026-07-16
- Phase: Implementation (Task 17.x client · REQ-17 AC-17.2/17.3)
- Status: Active (enacted 2026-07-16; module-only client + one additive server field; goes live with the D-043 stage-4 flip)
- Links: N-072, REQ-17, D-012/D-013, D-044, D-036/DV-010/D-039, `account.service.js`, `login.component.ts`
- Context: N-072 (verified in the stage-4 dry-run) — a `mustRotate` admin signs in (200, gated token)
  but every protected op then 403s and FUXA's interceptor logs them out, and NO client UI wires to
  `POST /api/account/rotate-password`. So REQ-17's forced rotation is unusable via the web. The server
  side (gate + rotate endpoint) is verified working (N-071); only the client UI + a detection signal
  are missing.
- Statement: Add a module-owned forced-rotation UI, reusing the established client patterns:
  1. **Detection signal (one additive server field):** the sign-in success payload gains a top-level
     `mustRotate: boolean` (from `record.metadata.mustRotate`) in `Authentication_Service.signIn`.
     This is an ACTIONABLE, non-secret flag (distinct from D-044's "info={roles} only, no metadata
     leak" — `tokenVersion`/other metadata stay hidden; only the boolean the client must act on is
     surfaced, to an already-authenticated caller).
  2. **Login routing:** `login.component`'s `navigateToApp` seam, on success, reads
     `AuthService.getUserProfile().mustRotate` (FUXA's `signIn` casts the whole `data` onto
     `currentUser`) and, when true, `router.navigateByUrl('/auth/rotate-password')` (in-app, NO full
     reload → the gated token stays and no protected call fires prematurely); otherwise the existing
     `window.location.assign('/')`.
  3. **Route:** `/auth/rotate-password` → standalone `RotatePasswordComponent` (D-039), NO AuthGuard
     (like `/auth/login`); the page requires a session and redirects to `/auth/login` if absent.
  4. **Pure presenter (DV-010):** `RotatePasswordPresenter` holds ALL logic (fields
     currentPassword/newPassword/confirmPassword; `canSubmit` = all non-empty + new===confirm +
     new!==current + !pending; submit → `rotate` seam; on success → `onRotated` seam [clear session +
     navigate to `/auth/login` with a "password changed, sign in" key]; error → map stable id to a
     generic i18n key). Jest-tested headlessly.
  5. **Thin client (D-036):** `RotatePasswordClient.rotate(current,new)` → `POST
     /api/account/rotate-password` with header `Skip-Error` (keeps the `x-access-token` the interceptor
     attaches, but opts out of the global 401/403 auto-signout so a 400 surfaces as a form error).
     Mapping/normalization live in the framework-free `auth-protocol` (`normalizeRotateError`: stable
     ids `bad_current_password`, `weak_or_reused_password`, else `unexpected_error` — verified from
     `account.service.js`/`account.router.js`).
  6. **i18n:** add rotate-page keys to `assets/i18n/en.json` (ngx-translate default-lang fallback,
     per N-061).
- Rationale (precise): the server rotate endpoint + gate already exist and are verified; the only
  root gap is the missing client surface + a detection signal. Surfacing `mustRotate` at sign-in is
  the minimal, non-sensitive signal that lets the login flow route deterministically to the rotation
  page BEFORE any protected call triggers the interceptor sign-out. Reuses the exact
  presenter+jest+thin-client patterns (DV-010/D-036/D-039), no FUXA-core authz rewrite.
- Alternatives considered: (a) infer rotation-needed from a post-login 403 (rejected: ambiguous vs a
  plain non-admin 403, and the interceptor already signs out on 403 — too late); (b) decode the JWT
  for a mustRotate claim (rejected: `mustRotate` is deliberately NOT a token claim — it is live
  account state, D-015); (c) a general change-password page now (deferred: N-036 flag #2 — a separate
  future requirement; this is scoped to the REQ-17 forced-rotation flow).
- Verification: jest for the presenter (success→onRotated, bad_current→key, mismatch→key, pending
  gating) + `normalizeRotateError`; production `ng build`; browser e2e on the stage-4 temp instance —
  fresh deploy → read console secret → login → auto-routed to `/auth/rotate-password` → rotate →
  redirected to login → sign in with the new password → full admin `/auth/users`; 0 console errors.

### D-046: Role-Management page + Users|Roles navigator (Phase 1 of the auth-management UI area)
- Date: 2026-07-17
- Phase: Implementation (post-flip UI · REQ-9 client)
- Status: Active (Phase 1 — module-only client, NO server/FUXA-core change; user-approved "proceed")
- Links: REQ-9, D-036/DV-010/D-039, D-044, N-081, `role-admin.client.ts`, `roles.router.js`, `authorization.service.js`
- Context: post-Stage-4, the module owns `/api/roles` (SUPERSEDE) and ships `RoleAdminClient`
  (list/create/update/delete) but has NO Role-Management UI, and the 3 module pages
  (login/rotate/users) have no navigator. FUXA's own `/users`+`/userRoles` (editor Setup menu) use
  the pre-SUPERSEDE bare-array shape and are superseded by the module pages. (Investigation this
  session; N-081.)
- Statement (Phase 1, module-only): add a standalone Role-Management page + a shared in-area
  navigator, reusing the exact patterns (pure presenter + jest [DV-010], thin client [D-036],
  standalone component [D-039]):
  1. **`RoleManagementPresenter`** (pure): access gate `canReadRoles` (`role.read`) →
     checking/granted/denied (UX-only; server §05 is the real boundary); `listRoles`; create
     `{id,name,permissions}`; update `{id, permissions}` (server PUT /api/roles/:id replaces the
     permission set wholesale — id+name are IMMUTABLE via this endpoint, VERIFIED in role.service.js,
     so edit exposes permissions only); delete by id (server prunes referencing users, returns
     `{removed,prunedUsers}`); refresh-on-success; row-remove on delete; generic i18n error keys
     (`duplicate_role`/`role_not_found`/`validation_error`/`forbidden`/`unauthorized_error`).
  2. **Permission catalog** for the editor = the canonical `ADMIN_PERMISSION_SET` (VERIFIED in
     `authorization.service.js`: `user.create/read/update/delete`, `role.create/read/update/delete`)
     **UNION** any permission already present on a loaded role (so a custom/unknown perm is never
     hidden). This is a CLIENT MIRROR of the server set — flagged drift risk; root-correct follow-up
     = a server `GET /api/permissions` catalog endpoint (deferred, would be a small additive server
     task). `account.rotatePassword` is intentionally EXCLUDED from the assignable list in Phase 1
     (it is the self-service/gate permission; assigning it to a role is a Phase-3 "My Account"
     concern).
  3. **`RoleManagementComponent`** (standalone): wires `RoleAdminClient` + `ModulePermissionService`
     (adds `ROLE_READ`+`canReadRoles()` — small mirror of `canReadUsers()`) into the presenter;
     template = list table + create/edit form (permission checkboxes) + delete confirm.
  4. **Navigator** `AuthNavComponent` (standalone): tabs **Users | Roles** via `routerLink`, rendered
     atop `/auth/users` + `/auth/roles`; added to both page templates (module files, not FUXA-core).
  5. **Route** `/auth/roles` (no AuthGuard, like `/auth/users`); **i18n** keys added to `en.json`.
- Rationale: the roles client + server already exist and are verified; the only gap is the UI + a
  navigator. Reuses the proven presenter/jest/standalone pattern → module-only, no server/FUXA-core
  edit, fast to verify (jest + prod build + browser). Editing FUXA's Setup menu to route
  Users/UserRoles → the module pages is DEFERRED to Phase 2 (FUXA-core touch, coordinated); "My
  Account" self-service is Phase 3 (needs a server permission decision — no role grants
  `account.rotatePassword` post-bootstrap, VERIFIED).
- Alternatives considered: (a) reuse FUXA's `/userRoles` page (rejected: bare-array shape superseded
  by the module envelope → broken under SUPERSEDE); (b) hardcode only the 8 perms with no union
  (rejected: would hide custom perms already stored on roles); (c) server permission-catalog endpoint
  now (deferred: additive server scope beyond Phase-1 module-only).
- Verification: jest for the presenter (gate/list/create/update-permissions/delete/error-map/permission-catalog-union);
  production `ng build`; browser e2e on a temp flipped instance (admin → /auth/roles → create role +
  assign perms + edit perms + delete + navigator Users↔Roles; non-admin → denied); 0 console errors.

### D-047: `/api/heartbeat` joins the SUPERSEDE — re-issues a MODULE token (fixes N-082)
- Date: 2026-07-17
- Phase: Implementation (Stage-4 SUPERSEDE completion · fixes N-082)
- Status: Active (enacted 2026-07-17; user-approved Option A)
- Links: N-082, D-014 (SUPERSEDE scope), D-015/D-027 (tokenVersion revocation), D-044 (signin projection), `server/api/index.js`, `server/auth-management/index.js`, `server/auth-management/services/authentication.service.js`
- Context: N-082 (VERIFIED) — FUXA `/api/heartbeat` re-issues a FUXA-shaped token (`{id,groups}`, no
  `tokenVersion`/`type`) via `authJwt.getNewTokenFromRequest`; the client heartbeat (`heartbeat.service.ts`,
  interval **5 min**) adopts it via `setNewToken`, overwriting the module token; the module middleware
  then rejects it (`Token_Service.verify` needs `type==='access'`; `resolveIdentity` coerces absent
  `tokenVersion`→0 < account's ≥1 → revoked) → 401 on all module endpoints after ≤5 min. `/api/heartbeat`
  was an auth/token-minting surface D-014 never covered.
- Statement: under SUPERSEDE (`authModuleEnabled` + module built), `/api/heartbeat`'s authenticated
  token re-issue is DELEGATED to the module so it mints a MODULE access token (carrying the live
  `tokenVersion` + `roles` + `type:'access'`, D-027/D-028) and returns the SAME D-044/D-045 projected
  session shape as sign-in. Concretely:
  1. `AuthenticationService`: extract the sign-in success session build into a shared async
     `_buildSession(record, token)` (groups projection via `_projectGroups` + `info=serialize({roles})`
     + `mustRotate` — the D-044/D-045 shape) and add `issueSessionFor(username)` which reads the LIVE
     record, mints a module access token via `Token_Service.issueAccessToken({username,groups,roles,
     tokenVersion})`, and returns `_buildSession(...)` (or null if the account is gone). This is a
     re-issue for an ALREADY-authenticated identity (heartbeat), NOT a login — no password check — so
     it is exposed as an internal composition-root capability, never as an HTTP login path.
     `signIn` is refactored to reuse `_buildSession` (single source → no projection drift).
  2. `createAuthManagementModule`: expose `issueSessionFor` on the returned module object.
  3. `server/api/index.js`: `mountDeferredAuthModule` captures `m.issueSessionFor`; the `/api/heartbeat`
     handler, when the module is enabled+ready, replies `{message:'tokenRefresh', token: session.token,
     data: session}` from `issueSessionFor(req.userId)` INSTEAD of the `authJwt` path. Flag OFF / module
     not ready → the legacy FUXA path is byte-for-byte unchanged.
- Rationale: root fix — brings `/api/heartbeat` into the D-014 SUPERSEDE so its refreshed token is a
  module token the module accepts, exactly as signin/refresh already are. Reuses the signin projection
  (`_buildSession`) so heartbeat and signin can never diverge. No new token model, no weakening of
  D-027 revocation. FUXA-core edit is confined to the already-superseded `api/index.js` wiring point,
  flag-guarded (OFF = legacy).
- Alternatives considered: (B) module accepts tokenVersion-less tokens (rejected — guts D-027 active
  revocation); (C) client stops adopting the heartbeat token under SUPERSEDE (rejected — leaf fix,
  breaks sliding-session renewal, leaves two token models); (D) seed admin with tokenVersion 0
  (rejected — breaks after any real rotation + defeats revocation).
- Verification: server suite green incl. a new `issueSessionFor` test (returns a module token with
  `type:'access'` + the account's tokenVersion + projected groups/info; unknown user → null; signin
  unchanged); browser e2e on a flipped temp instance — login → trigger `POST /api/heartbeat {params:true}`
  → assert the returned token decodes to a MODULE token (`type:'access'`, `tokenVersion≥1`, `roles`) and
  a subsequent module request (`GET /api/roles`) with it returns 200 (not 401). This is the exact N-082
  repro, now passing.

### D-048: Phase-2 — editor Setup menu routes Users/Roles to the module pages under SUPERSEDE (flag-gated)
- Date: 2026-07-17
- Phase: Implementation (post-flip UI · discoverability)
- Status: Active (Phase 2 — CLIENT-ONLY; user-approved "proceed")
- Links: D-046, D-014, N-081, `client/editor/setup/setup.component.*`, `client/_services/settings.service.ts`, `client/_models/settings.ts`
- Context: the module pages (`/auth/users`, `/auth/roles`) are only reachable by typing the URL — no
  UI entry. FUXA's editor Setup menu (`goTo('/users')`/`goTo('/userRoles')`) points at FUXA's built-in
  Users/UserRoles pages, which under SUPERSEDE read `/api/users`/`/api/roles` in the module `{data:[]}`
  envelope shape → broken. The client bundle is SHARED across deployments (some NOT flipped), so the
  re-point MUST be conditional on the runtime flag (an unconditional re-point would send a non-flipped
  deployment to the module UI, which can't read FUXA's bare-array endpoints — N-066).
- Verified feasibility: `/api/settings` ALREADY returns `authModuleEnabled` (it is a top-level
  `runtime.settings` field; `getSanitizedSettings`/`getPublicSettings` = `JSON.parse(JSON.stringify)`
  serialize it — no server change needed). The client just doesn't STORE it: `AppSettings` copies
  fields selectively and never copies `authModuleEnabled`.
- Statement (CLIENT-ONLY): (1) add `authModuleEnabled = false` to `AppSettings`; (2)
  `SettingsService.setSettings` copies `settings.authModuleEnabled` into `appSettings`; (3)
  `setup.component` injects `SettingsService` and the two menu buttons call `goToUsers()`/
  `goToUserRoles()` which navigate to `/auth/users`/`/auth/roles` WHEN `authModuleEnabled` is true, else
  the legacy `/users`/`/userRoles` (byte-for-byte unchanged for non-flipped deployments). No server
  edit; the `/auth/*` routes already exist (D-046).
- Rationale: root-correct discoverability without breaking the shared client — gate on the SAME flag
  that drives the server SUPERSEDE, sourced from the already-exposed settings. Minimal, additive,
  reversible.
- Alternatives considered: (a) route-level redirect guard on `/users`/`/userRoles` (more comprehensive —
  also catches direct-URL — but adds a guard interacting with the existing AuthGuard; heavier); (b)
  unconditional re-point (rejected — breaks non-flipped deployments); (c) make the module UI clients
  accept BOTH bare-array and `{data:[]}` (rejected — write contracts also differ; leaky).
- Residual (noted, Phase-2b candidate): a direct-URL visit to `/users`/`/userRoles` under SUPERSEDE
  still renders FUXA's (broken) built-in page — the menu re-point covers the primary path; a
  flag-gated route redirect would close the direct-URL edge comprehensively.
- Verification: production `ng build`; browser — FLIPPED temp instance: open editor Setup → Users →
  lands on `/auth/users` (module), User-Roles → `/auth/roles`; NON-flipped (real server, flag off):
  Users → `/users` (FUXA) unchanged. 0 console errors.

### D-049: Runtime configuration of the auth module (module-owned, near-zero FUXA-core) — "Hướng B"
- Date: 2026-07-17
- Phase: Design (new area · design/13-runtime-config.md)
- Status: **Active — Phase 1 (server) IMPLEMENTED + verified (N-088, suite 195); Phase 2 (client page) + Phase 3 (advanced token-signing iss/aud/alg overlap) pending.** §11 open decisions 1/2/3 resolved with the user 2026-07-17 (functional perms; iss/aud overlap + alg confirmed re-login; scope confirmed)
- Links: N-087 (request intake), D-003 (adapter boundary), D-014 (SUPERSEDE mount), D-034 (password policy), D-046 (additive-permission precedent), D-048, design/13-runtime-config.md
- Context: user requirement "mọi cấu hình đều được cấu hình runtime trừ giao diện" (all config runtime-configurable except the UI). Verified current state: FUXA already live-applies `secureEnabled`/`tokenExpiresIn`/`secretCode`/`refresh` via `POST /api/settings`, but the whole `settings.auth.*` policy block + `bcryptCost` are `settings.js`-only (engineer + restart) and not surfaced in any UI.
- Verified read-pattern facts (drives feasibility): `TokenService` reads `this.settings.*` LIVE per issue/verify (mutation hot-swaps); `BruteForceGuard`, `UserService`/`AccountService` password policy, and the bcrypt `BcryptHasherAdapter` cost are SNAPSHOTTED at construction (need small additive `reconfigure`/setter seams); bcrypt cost is embedded per-hash so a change is non-retroactive (old hashes still verify, D-008).
- Statement (Hướng B): expose `settings.auth.*` (password policy, brute-force, token/JWT policy, bcryptCost) at runtime via a MODULE-OWNED admin page `/auth/settings` + module endpoint `GET/PUT /api/auth/config` (gated by new `settings.read`/`settings.manage` perms, additive like D-046), persisted in a module-owned `auth_config` table (single-row JSON, precedence: DB override > settings.js baseline > hardcoded defaults; fail-safe load), applied LIVE via an `AuthConfigService.applyToServices()` orchestrator (mutate `tokenService.settings`; `bruteForceGuard.reconfigure`; `setPasswordPolicy` on user/account; `hasher.setCost`) — NO restart, NO router remount.
- Explicitly restart-/secure-path only (NOT runtime, with reasons): `authModuleEnabled` (SUPERSEDE mount decided once at init; live remount = N-071 crash hazard) and `secretCode` (a secret, D-022 posture; stays in FUXA's secure settings path). `bootstrapAdminUsername`/enrollment = bootstrap-only (read-only at most).
- FUXA-core footprint: server = 0 hot-path edits (route lives in the already-mounted module router; at most +1 line to the existing `AUTH_MODULE_PATHS` seam); client = 1 additive route line in `app.routing.ts` (same kind as the 4 existing `/auth/*`); FUXA's `app-settings` dialog untouched. `authModuleEnabled=false` ⇒ nothing loads ⇒ OFF path byte-for-byte unchanged.
- Rationale: root-correct for the user goal while honoring D-003 — keep the whole feature inside the module so blast radius is the module, not FUXA-core; hot-swap only values that are read per-operation or trivially settable; keep the irreversible/dangerous switches (mount, secret) on the safe restart path.
- Alternatives considered: (A) extend FUXA's built-in Settings dialog + `mergeUserSettings` (rejected as primary — touches 2 FUXA-core files incl. the API hot-path, higher blast radius/upgrade-conflict); (C) write runtime changes back into `settings.js` via FUXA's settings-write path (rejected — couples to FUXA core + mutates the engineer's file; module-owned table is cleaner and reversible); live remount of `authModuleEnabled` (rejected now — N-071 hazard, separate hardened effort).
- New correctness properties: P-017 (hot-swap non-retroactive), P-018 (atomic validation), P-019 (fail-safe load), P-020 (gated). Full test plan in design/13 §9.
- Verification (planned, before merge): unit reconfigure/validation/fail-safe/merge; property P-017..P-020 ≥100 iters; real-HTTP config endpoint; Playwright live-apply-without-restart + OFF regression; full server suite green.


### D-050 — Server-authoritative permission resolution for the client (root fix for the N-091 L1 deadlock + L3 catalog drift)

- Date: 2026-07-27
- Status: **Active (CONFIRMED) — IMPLEMENTED + verified live 2026-07-27 (N-092).** Design was validated against source before any code (server `effective()` already computes the needed set; `req.authIdentity` already populated; `/api/auth` already in `AUTH_MODULE_PATHS`, so FUXA-core needed ZERO further edits). Server suite 204, client jest 93, prod build exit 0, and the exact live scenario that failed in N-091 now passes.
- Links: N-091 (L1 deadlock + L3 drift, both observed live), D-046 (chose the hand-mirrored catalog and flagged this exact follow-up), D-007 (roles first-class), D-049 (`settings.*` perms), AC-12.6.
- Problem (single shared root, two symptoms): the client tries to REPLICATE an authorization decision from data it is **not permitted to read**. `ModulePermissionService.hasPermission()` needs role→permission definitions, which come from `GET /api/roles` (requires `role.read`); and the role dialog needs the permission vocabulary, which is a hand-copied mirror of the server's `ADMIN_PERMISSION_SET`. Consequences observed live: a non-admin with `user.read` is denied locally forever (L1), and `settings.read`/`settings.manage` are ungrantable via UI (L3). Any future server permission will drift again.
- Decision (proposed): make the SERVER the single source of truth for what the caller may do, and reduce the client to rendering it.
  1. **New additive endpoint `GET /api/auth/permissions`** returning, for the authenticated caller: `{ effective: string[] , catalog: string[] }` — `effective` = the permissions this identity actually holds (server-computed via `Authorization_Service`), `catalog` = the full known permission vocabulary (`ADMIN_PERMISSION_SET` ∪ permissions present on stored roles). Gate: authenticated only, NO extra permission (it reveals only the caller's own authority + the vocabulary — no user/role data), so it cannot deadlock the way `role.read` does. This is the D-046 follow-up, now justified by evidence.
  2. `ModulePermissionService` resolves from `effective` (fetched once per session, cached) instead of deriving from `roleDefs`; the `roleDefs.size === 0 → false` branch is DELETED. `setRoleDefinitions` may stay as an optimization but must never be the gate's precondition.
  3. The role dialog renders `catalog` from the server, so `settings.read`/`settings.manage` (and any future permission) appear automatically — the hand-mirror is retired.
- Rationale (precise): (a) it fixes the ROOT — the client no longer needs read access to authorization *data* in order to know its own authority; (b) it removes a whole defect class (mirror drift) rather than patching today's two missing strings; (c) it keeps the server as the only enforcement point (the client gate remains pure UX, matching AC-12.6's intent), so a lying client cannot gain anything; (d) it is additive — the OFF path and every existing endpoint are untouched.
- Alternatives considered: (i) **grant `role.read` to every role** — rejected: it leaks the whole authorization model to every user just to unblock the UI, and it is a privilege change, not a fix; (ii) **let the page attempt the call and render the server's 403 instead of gating locally** — rejected as the primary fix (it would work, and is a decent fallback, but it makes every page do an error round-trip and still leaves the L3 catalog drift and the "is this button allowed?" question unanswerable); worth adopting as the FALLBACK behavior when the new endpoint is unavailable (defense in depth, and it is strictly better than the current permanent local deny); (iii) **hard-code the role→permission map in the client** — rejected: doubles the drift surface.
- Verification plan (before it can be marked Active): server unit tests for the endpoint (effective set for admin / non-admin / unauthenticated 401; catalog includes `settings.*`); client jest for the resolver (effective-based allow/deny, cache, fallback-on-unavailable); then the LIVE regression that just failed — sign in as a non-admin holding only `user.read` and confirm `/auth/users` LISTS users (currently "Unauthorized!") while `/auth/roles` stays denied, and confirm the role dialog now offers `settings.read`/`settings.manage`.
- Not in scope here: the L2 message-propagation defect (separate, smaller change) and the AuthGuard legacy-dialog residual — both tracked in N-091.


### D-051 — Machine-readable rejection codes + permission-gated action affordances (root fix for N-091 L2 + L5)

- Date: 2026-07-27
- Status: **Active (CONFIRMED) — IMPLEMENTED + live-verified (N-093).** Additive on both sides; no FUXA-core edit; the HTTP `message` field is byte-identical to before.
- Links: N-091 (L2/L5 discovery), D-050 (made the client aware of its own authority — the precondition for L5), D-034 (single-source password policy), D-049 (runtime-configurable minimum ⇒ the message cannot hard-code it), design/08 §9 (never render server text), AC-12.4.
- Problem (two symptoms, one theme — the UI could not tell the truth):
  - **L2**: the API explained a rejected password only as an English sentence (`message`). The client's §9 rule forbids rendering server text, so the form could only say "Invalid input" — the operator never learned which rule failed or what the threshold is. A sentence is also un-localizable and un-assertable in tests.
  - **L5**: the page offered Add/Edit/Remove to an identity lacking `user.create`/`update`/`delete`; clicking produced a 403 the user could not anticipate. The UI advertised authority that did not exist.
- Decision:
  1. **Stable rejection codes.** `password-policy.js` gains `validatePasswordPolicyDetailed()` returning `{ code, message, params }` with `PASSWORD_REJECTION_CODES` (`password_required`, `password_malformed`, `password_too_long`, `password_too_short`, `password_blocklisted`); `params` carries what the UI must interpolate (`{min}`, `{max}`). The legacy string API is now a THIN WRAPPER over it (`.message`), so the two representations cannot drift (D-034 discipline). `User_Service.create/update` and `Account_Service.rotatePassword` propagate `detailCode`/`detailParams` alongside the unchanged `detail`; the users/account routers emit them as ADDITIVE JSON fields. Client `normalizeAdminError` carries them; `mapAdminErrorDetailKey` prefers the specific i18n key (`DETAIL_CODE_KEYS`) and falls back to the generic mapping for an unknown/absent code; the form renders `errorKey | translate: errorParams`. New i18n keys added to **all 13 locales**.
  2. **Permission-gated affordances.** Both page presenters take an optional `can(permission)` seam (wired to `ModulePermissionService.hasPermission`, which is now server-authoritative per D-050) and expose `canCreate*/canUpdate*/canDelete*`; the templates `*ngIf` each control on it.
- Rationale (precise): (a) the code — not the text — selects the message, so §9 is preserved intact while the UI becomes specific; (b) `params` is REQUIRED rather than cosmetic, because D-049 makes the minimum length changeable at runtime, so any hard-coded "12" in a translation string would become a lie; (c) everything is additive — `message` unchanged ⇒ no existing consumer or test breaks (proved: the 195-test baseline stayed green before the new tests were added); (d) an unrecognized future code degrades to the generic key, so the server can add codes without a client release; (e) L5 is only honest UI, NOT a security control — the server authorizes every mutation, so hiding a button removes confusion, not protection; a `can` seam that is absent offers everything (pre-D-051 behavior), and a non-boolean seam result is treated as NOT allowed (fail-safe affordance).
- Alternatives considered: (i) **display the server `message` directly** — rejected: violates §9, ships untranslated English to 12 locales, and couples the UI to server prose; (ii) **have the client re-derive the policy from `GET /api/auth/config`** — rejected: that endpoint requires `settings.read`, which a user-admin need not hold ⇒ the N-091 L1 deadlock pattern all over again; (iii) **hard-code "at least 12 characters" in the i18n string** — rejected: D-049 can change the minimum at runtime, so the text would silently lie; (iv) **disable rather than hide the action buttons** — considered and not chosen for the row actions (a disabled button still advertises the operation and invites "why?" tickets); revisit if a future UX spec prefers disabled+tooltip.
- Verification: new server test file `password-rejection-codes.test.js` 6/6 (per-rule codes/params, min tracks a RUNTIME-changed policy, wrapper derived from the structured result, and service outcomes carrying the code with `detail` asserted byte-identical); new client spec `action-permissions.spec.ts` 9/9 (carry/ignore-malformed/mapping/fallback + affordance matrix incl. the non-boolean fail-safe); server suite **210**, client jest **102 / 9 suites**, prod build exit 0, diagnostics 0. LIVE: `POST /api/users` returns `detailCode:"password_too_short" detailParams:{min:12}` and `detailCode:"password_blocklisted"`; in the BROWSER the form shows **"Password must be at least 12 characters"** and **"This password is too common. Choose a different one."**, and `operator1` (only `user.read`) sees the 2-row list with **no "Add User", 0 Edit, 0 Remove** while admin sees all of them.


### D-052 — Legacy `/users` + `/userRoles` route redirect under SUPERSEDE (closes the D-048 residual)

- Date: 2026-07-28. Status: **Active (CONFIRMED)** — implemented + browser-verified this turn (task 24.2).
- Context: D-048 re-pointed the editor Setup menu to the module pages (`/auth/users`, `/auth/roles`) when
  `authModuleEnabled` is on, but explicitly left a residual: a **direct URL** to FUXA's built-in `/users`
  or `/userRoles` still rendered the legacy FUXA page, a way to reach the identity surface the module is
  supposed to own. For a commercial SUPERSEDE this is a consistency/authority gap (two live entry points to
  the same conceptual resource). Grep confirmed the only navigational entry points are: the Setup menu
  (D-048, gated), the direct URL (this), and `header.component.ts editorModeRouteKey` (a detection list, not
  a navigation) — so gating the two routes fully closes it.
- Decision: a module-owned `LegacyUserAdminRedirectGuard` placed **before** `AuthGuard` on the existing
  `/users` and `/userRoles` route definitions. Under SUPERSEDE it returns a `UrlTree` (redirect) to the
  target read from the route's static `data.supersedeRedirect` (`/auth/users`, resp. `/auth/roles`), so ONE
  guard serves both and neither the legacy page NOR FUXA's login dialog appears; when SUPERSEDE is OFF it
  returns `true` and `AuthGuard` runs exactly as before (non-flipped deployments byte-identical, shared-bundle
  safe — same posture as D-048).
- Root-correctness (the important part): `authModuleEnabled` is mirrored client-side ASYNCHRONOUSLY
  (`SettingsService.init()` → `GET /api/settings`) and defaults to `false`. A cold direct-URL load of `/users`
  runs the guard BEFORE `/api/settings` resolves, so reading the flag synchronously would see `false` and
  leak the legacy page even under SUPERSEDE — the exact N-096-class browser-only race (green in jest+build,
  broken live). The guard therefore GATES on `SettingsService.loaded$` (`filter(loaded), take(1)`) so the
  flag is authoritative before it decides. The decision logic is a pure, framework-free `legacyAdminRedirect$`
  helper (rxjs only, no Angular) so the race is jest-verifiable headlessly (D-036); the thin `@Injectable`
  shell wires `SettingsService` + `Router`.
- Alternatives considered: (i) **CanMatch that unmatches the route under SUPERSEDE** — rejected: the `**`
  catch-all would then send `/users` to `''` (home), not to the module page, losing the user's intent;
  (ii) **read the flag synchronously in the guard** — rejected: the loaded$-race above (would render the
  legacy page on a cold load); (iii) **delete the legacy `/users`/`/userRoles` routes outright** — rejected:
  not reversible, breaks non-flipped deployments that share the bundle, and exceeds the flag-gated D-048
  contract; (iv) **redirect in the legacy components' `ngOnInit`** — rejected: the legacy page would still
  briefly construct/flash and it is a heavier edit than a guard.
- Boundary: this touches FUXA-core `app.routing.ts` in place (guard added to 2 existing routes + import +
  `data`), logged as **DV-013**. UX/consistency only — the server (§05) stays the authoritative boundary and
  the module pages carry their own UX gate + server authorization.
- Verification: pure helper spec `legacy-admin-route.spec.ts` 4/4 incl. the RACE test (guard must NOT decide
  while `loaded$` is false, then decides with the post-load flag) and the `take(1)` "no re-decide on settings
  churn" test; full client jest **127 passing / 11 suites** (was 123/10); `ng build --configuration production`
  exit 0 (guard now wired, no "unused" warning). LIVE BROWSER (Playwright MCP, `authModuleEnabled:true`,
  signed in as admin): `GET /users` lands on `/auth/users`, `GET /userRoles` lands on `/auth/roles`, the
  `/auth/roles` page renders the real role table (`viewer_test` → `user.read`) with admin affordances, **0
  console errors**. The flag-OFF path is byte-identical by construction (guard returns `true`, AuthGuard
  unchanged) — verified by code, same basis as D-048/N-086.


### D-053 — Truthful denial for authenticated non-admins in `AuthGuard` (no useless login dialog)

- Date: 2026-07-28. Status: **Active (CONFIRMED)** — implemented + browser-verified this turn (task 24.3).
- Context: FUXA's shared `AuthGuard` (client/src/app/auth.guard.ts, ~15 admin routes) does, when security is
  on and `isAdmin()` is false: **always open the legacy login dialog**, then on close notify
  `msg.signin-unauthorized` ("Unauthorized!") and redirect `/`. For a user who is ALREADY signed in but is
  simply not an admin (the normal case under the module SUPERSEDE — e.g. an operator with `user.read`), the
  dialog asks for credentials they already have and signing in again as the same account cannot grant admin —
  a dishonest, confusing UX (D-042 §3.2 residual).
- Decision: before opening the dialog in the `secureEnabled` branch, detect an already-authenticated REAL
  (non-guest) session; if present, skip the dialog and go straight to the truthful "Unauthorized!" +
  redirect. Only an unauthenticated (or guest) visitor still gets the login dialog.
- Predicate (root-correct, edge cases handled): `authenticatedRealUser = !!profile && !!profile.username &&
  !isGuest`, where `profile = AuthService.getUserProfile()` and `isGuest` MIRRORS `AuthService.isGuestUser`
  (`username === 'guest'` OR `groups` array includes `'guest'`). Reasons: (a) uses `username`, NOT `token`,
  because under the refresh-cookie flow the access token is transiently null while the session is valid —
  a token check would wrongly re-prompt; (b) mirrors FUXA's own guest definition so guest-mode deployments
  are unaffected (guests still get the dialog to sign in); (c) a fully-expired session is already cleared to
  `currentUser=null` by `AuthService` (constructor / refresh-error `removeUser`), so `getUserProfile()` is
  null ⇒ dialog — correct.
- Deny-preserving (why this is a UX change, not a security change): the branch already returned `false` for
  non-admins; this only changes WHICH denial UX shows (immediate message vs dialog-then-message). It NEVER
  grants access it did not grant before, and the successful-login-through-dialog path (unauthenticated →
  dialog → admin creds → allow) is untouched. Server-side authorization is unaffected.
- Message: reuses the EXISTING `msg.signin-unauthorized` = "Unauthorized!" (the exact message the flow already
  showed after the dialog), so ZERO new i18n keys / no 13-locale churn.
- Alternatives considered: (i) **add a distinct "you are signed in but lack permission" key** — deferred:
  correct but adds 13-locale machine-translation debt (24.4) for marginal gain over the existing honest
  "Unauthorized!"; revisit with the native i18n pass; (ii) **redirect silently with no message** — rejected:
  a silent redirect from a deep link is itself confusing; (iii) **check `getUserToken()` instead of
  username** — rejected: the refresh-cookie transient-null token would misclassify a valid session as
  unauthenticated; (iv) **route non-admins to the module `/auth/login`** — rejected: they are already
  authenticated, re-login is the very thing to avoid.
- Boundary: in-place FUXA-core edit of `auth.guard.ts`, logged as **DV-014** (same class as DV-011/DV-012).
- Verification: `get_diagnostics` clean; `ng build --configuration production` exit 0. LIVE BROWSER
  (Playwright MCP, security ON): (1) signed in as `operator1` (non-admin) → `GET /editor` lands on `/` with
  a **"Unauthorized!"** toast and **NO login dialog**; (2) session cleared → `GET /editor` still opens FUXA's
  **"Sign in..."** dialog; (3) admin credentials in that dialog → `/editor` renders the full editor. **0
  console errors** across all three.


### D-054 — Runtime iss/aud/alg (task 20.3): design-validation + approach fork (PROPOSED — pending user choice)

- Date: 2026-07-28. Status: **Active (CONFIRMED) — Option B chosen by the user 2026-07-28; server + client
  implemented + browser-verified end-to-end** (N-100 server, N-101 client). Owner area: D-049 Phase 3 /
  design/13 §12 / task 20.3.
- Context: Phase 2 (D-049, N-096) shipped the zero-side-effect runtime config (password policy, bcrypt cost,
  token TTLs, brute-force). Phase 3 (20.3) is the "careful" trio `jwtIssuer`/`jwtAudience`/`jwtAlgorithm`.
  design/13 §12 RECOMMENDED a zero-logout OVERLAP WINDOW for iss/aud and confirmed re-login for alg, and §11.3
  explicitly left "build the overlap window now vs defer" as an open user decision.
- Design-validation finding (N-099, verified against the installed jsonwebtoken, NOT assumed): the overlap
  window is expressible via the library (`issuer:[old,new]`/`audience:[old,new]`) ONLY for a SET→SET change.
  For UNSET→SET — the FIRST time iss/aud is ever configured, i.e. the primary case — jsonwebtoken REJECTS any
  token lacking the claim, so zero-logout there forces `verify` to abandon the library's iss/aud enforcement and
  hand-roll an accept-set check inside the security kernel. That materially raises the risk profile of the most
  critical function for a field changed ~once in a deployment's life. §12 under-stated this ("accept a small set
  instead of a scalar").
- Options:
  - **Option A — build the §12 overlap window (zero forced logout).** verify() stops passing issuer/audience to
    jsonwebtoken and manually validates iss/aud against {new} ∪ {old-until-windowExpiry} ∪ {absent-until-window},
    with the old value + expiresAt persisted in `auth_config`, dropped lazily after the window (= max access
    TTL). Pro: nobody is logged out on an iss/aud change. Con: hand-rolls claim validation in the security
    kernel; a bounded window during which a no-iss/aud token is accepted; real complexity + test burden for a
    rare operation. (This is design/13 §12's current recommendation — which N-099 now argues against.)
  - **Option B — RECOMMENDED (military-grade): expose iss/aud/alg at runtime as CONFIRMED, session-ending
    changes; keep verify strict + library-enforced.** verify() keeps using jsonwebtoken's issuer/audience
    options (provably strict, zero hand-rolled claim logic). The `/auth/settings` "Advanced — Token signing"
    section shows an explicit confirm ("this signs out all active users"); on apply, existing tokens fail verify
    ⇒ clean 401 ⇒ the honest re-login UX (now correct after D-053). Pro: the security kernel stays minimal and
    provable — the right trade for a rarely-changed hardening field; delivers runtime configurability. Con: a
    one-time mass re-login on change (communicated, not a brick). alg limited to HS256/384/512 (N-099).
  - **Option C — defer iss/aud/alg entirely (keep them settings.js + restart-only, like `secretCode`).** The
    runtime page ships only the zero-side-effect policy (already done in Phase 2). Pro: smallest attack surface,
    verify untouched, consistent with D-049's own carve-out of `secretCode`/`authModuleEnabled` as secure-/
    restart-only security-critical config. Con: iss/aud/alg require an engineer + restart (acceptable — set-once).
- Recommendation: **Option B.** It satisfies the runtime-config requirement while keeping the verify kernel
  strict and library-enforced (no hand-rolled claim validation), and treats a rare, security-critical change as
  an explicit confirmed event. Option C is the acceptable conservative fallback; Option A is NOT recommended
  because N-099 shows it complicates the kernel for marginal convenience.
- No code changed by this decision. On the user's choice: B ⇒ add the confirm-gated iss/aud/alg fields to the
  auth-config validate/apply + page (alg set HS-only) with strict verify unchanged; C ⇒ document iss/aud/alg as
  restart-only and close 20.3 as "deferred by design"; A ⇒ implement §12 with the manual accept-set + P-017a and
  a heavy verify test matrix.
- Traceability: §D.3 row added; supersedes design/13 §12's recommendation pending the choice (a "Validation
  2026-07-28" note appended to §12, not a rewrite).
- **Resolution (2026-07-28, N-100): Option B chosen.** SERVER done + tested: `AuthConfigService` now
  validates + applies `jwtIssuer`/`jwtAudience` (null or a bounded non-empty string) and `jwtAlgorithm`
  (HS256/384/512 only, N-099); `_applyToServices` maps the config key `jwtAlgorithm` → `TokenService`'s
  `algorithm` and pushes iss/aud live; `TokenService.verify` is UNCHANGED (stays strict + library-enforced —
  a change makes already-issued tokens fail verify ⇒ clean 401 ⇒ re-login, the confirmed session-ending
  event). `GET /api/auth/config` now serves `bounds.jwtAlgorithms` + `bounds.jwtClaimMaxLen` so the client
  renders the choices from the server (N-091 L3 discipline). Verified: server suite **216 passing** (+5:
  bounds-carry-HS-only, valid iss/aud/alg round-trip, null-unset, RS256 rejected, empty-issuer rejected).
  **Client done (N-101):** protocol types + `AuthConfigPatch` + presenter form/validate/buildPatch (empty
  iss/aud ⇒ null) + a `patchTouchesTokenSigning` gate that opens a **confirm-before-apply** dialog ("this
  signs out ALL active users") + the "Advanced — Token signing" template section (HS-only `<select>` fed from
  server `bounds.jwtAlgorithms`) + 9 i18n keys × 13 locales + 9 presenter specs. Verified: client jest **136**,
  prod build 0, and a full LIVE browser e2e — change alg → confirm dialog → PUT 200 "saved and applied" → the
  in-flight HS256 token then gets **401 on the next GET** (session-ending, exactly Option B) → Reset to
  defaults (DELETE 200) restored HS256. Task 20.3 COMPLETE.
