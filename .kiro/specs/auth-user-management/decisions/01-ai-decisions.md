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
