# 03 — Trade-offs weighed (options + why rejected)

> Trade-offs the agent weighed, the alternatives, and the precise reason the winner won.
> Schema in `README.md` §3. Log the **alternatives**, not just the winner.

> ⚠️ **INTEGRITY INCIDENT — 2026-07-13 (see N-020).** This file was found **overwritten with an
> unrelated chat transcript**; the original TO-* entries had been destroyed. The statement that the
> workspace was not a git repo is a **historical fact of the old-machine N-020 session**; the current
> transferred workspace is a git repository. No VCS history was available in that historical session,
> so the entries below were
> **reconstructed from surviving cross-references** in `01-ai-decisions.md`, `02-deviations.md`,
> `design.md`, and `design/02`, `design/03` (each reconstructed statement is traceable to those
> files and is therefore verifiable, not fabricated). `TO-003` could **not** be recovered — no
> surviving reference exists anywhere in the spec — so its ID is **QUARANTINED** below and MUST
> NOT be reused. This incident is exactly why the integrity manifest (`00-INDEX.md`) and the
> anti-drift gates (`GATES.md`) were added.

---

### TO-001: Reuse FUXA's security primitives vs. introduce new ones
- Date: 2026-07-12 (reconstructed 2026-07-13)
- Phase: Requirements
- Status: Active — DECIDED (reuse)
- Links: D-002, REQ-2, REQ-4, REQ-13
- Context: FUXA already ships `jsonwebtoken@^9.0.3` and `bcryptjs@2.4.3` (verified in `server/package.json`) and a user/role store in `server/runtime/users`.
- Decision: Reuse FUXA's existing `jsonwebtoken`, `bcryptjs`, and the user/role persistence, wrapped behind module Service/Store interfaces, rather than adding a new auth library or datastore.
- Alternatives considered: (a) Passport.js / a dedicated auth stack — rejected: adds new attack surface and a second, competing auth path with no requirement demanding it yet. (b) A dedicated IAM database — rejected for the default path: migration cost with no current requirement (revisit under D-016 if the persistence-atomicity root fix requires it).
- Rationale: Primitives are already present, dependency-pinned, and exercised by FUXA; reuse minimizes new attack surface and keeps a single credential store.
- Impact / Risk: Couples the module to FUXA internals; mitigated by the adapter boundary (D-003, AC-16.5) so the backing store can be swapped without changing service interfaces.
- Verification: design shows adapters over FUXA primitives; swapping the store must not change service interfaces.

### TO-002: Non-expiring tokens (original AC-2.7) vs. a safe default TTL
- Date: 2026-07-12 (reconstructed 2026-07-13)
- Phase: Requirements
- Status: Active — DECIDED (default TTL); enacted by DV-003
- Links: D-004, DV-003, REQ-2 (AC-2.7, AC-2.8), P-008
- Context: The original AC-2.7 issued a **non-expiring** access token when no expiry was configured. A non-expiring token cannot be revoked by expiry — a serious security downgrade for a commercial product.
- Decision: When no expiry is configured, force a safe finite default TTL of **1 hour**; truly non-expiring tokens become an explicit, non-production, dev-only opt-in (AC-2.8).
- Alternatives considered: Keep non-expiring default — rejected: no revocation window, unacceptable for "an toàn / thương mại". Require expiry always configured — rejected: a missing config would then hard-fail startup; a safe default is friendlier and still safe.
- Rationale: Root-cause fix for token revocability; aligns with FUXA's own `tokenExpiresIn = 60*60` default while forbidding a silent non-expiry.
- Impact / Risk: Access tokens still cannot be *actively* revoked before expiry — that residual gap is tracked separately under TO-008 / D-015 (session authority) and D-019 (refresh reuse detection).
- Verification: requirements.md AC-2.7 reflects the default TTL; P-007/P-008 cover expiry behavior.

### TO-003: **QUARANTINED — content lost in the 2026-07-13 integrity incident**
- Date: unknown (original), quarantined 2026-07-13
- Phase: unknown
- Status: RETIRED (unrecoverable) — **ID MUST NOT be reused**
- Links: none recoverable
- Context: No surviving reference to `TO-003` exists anywhere in `requirements.md`, `design*`, `tasks.md`, or the other decision files. Its original subject and decision were destroyed when this file was overwritten (N-020).
- Statement: Content is not recoverable and MUST NOT be guessed or reconstructed (doing so would be fabrication, which is forbidden). If a trade-off was genuinely made under this ID and is later remembered/rediscovered, record it under a **new** ID (e.g. TO-012+) and cross-link here — do not resurrect `TO-003`.
- Verification: n/a — this is a tombstone entry preserving ID immutability (README §2).

### TO-004: API behavior when the service layer is unavailable — fail-fast vs. queue/retry
- Date: 2026-07-12 (reconstructed 2026-07-13)
- Phase: Requirements
- Status: Active — DECIDED (fail-fast)
- Links: D-004, REQ-16 (AC-16.4)
- Context: AC-16.4 asks what the API layer does when the service layer is unavailable at request time.
- Decision: **Fail fast** — the API immediately returns an error response; it does not silently queue or retry the request.
- Alternatives considered: Queue-and-retry / buffer — rejected: hides an outage from the caller, risks acting on stale state later, and complicates reasoning about auth (a security-sensitive path must never "eventually" authenticate). 
- Rationale: Predictable, observable failure is safer than silent degradation for an auth boundary.
- Impact / Risk: Callers must handle transient 5xx and retry at their layer; acceptable and standard.
- Verification: AC-16.4 test asserts an immediate error when a service dependency is unavailable.

### TO-005: First-admin bootstrap method — auto-seed(random)+forced-rotation vs. CLI vs. env-var
- Date: 2026-07-12 (reconstructed 2026-07-13)
- Phase: Requirements → Design (§12)
- Status: Active — DECIDED (auto-seed random + mustRotate; CLI kept as ops fallback)
- Links: D-005, D-012, DV-004, REQ-17, N-007, P-009
- Context: RBAC/user-CRUD need an administrator to exist, but nothing specified how the first one is created. FUXA seeds `'123456'` with no rotation (N-007) — the exact weakness to eliminate.
- Decision: On empty-admin first run, auto-seed exactly one admin with a **cryptorandom one-time secret** (never `'123456'`) and set `metadata.mustRotate=true` so only `account.rotatePassword` is permitted until a genuine rotation. Keep an interactive **CLI create-admin as a documented ops fallback**.
- Alternatives considered: (a) Reuse `'123456'` + gate only — rejected: sign-in is not a gated operation, so an attacker who knows the default could sign in and self-rotate to seize the sole admin (hostile-rotation takeover). (b) Env-var seeded credential — rejected as the default: secret-in-env/secret-in-log risk. (c) CLI-only as the sole path — rejected as default: blocks first use until an operator runs it (kept only as fallback).
- Rationale: Two independent axes (random secret + gate) each close a distinct takeover path; guarantees no usable known-default credential survives first boot.
- Impact / Risk: The one-time secret disclosure channel is itself a weakness — see N-018 / D-022 (do not disclose via shared log).
- Verification: P-009; §10.3 security test proves `'123456'` yields no usable authority and the module seed never verifies `'123456'`.

### TO-006: Duplicate-create HTTP status — 400 vs 409
- Date: 2026-07-12 (reconstructed 2026-07-13)
- Phase: Design (§04)
- Status: DECIDED (400) — revisitable
- Links: REQ-5 (AC-5.2)
- Context: A duplicate username on create is semantically a conflict (HTTP 409), but the master-map error table uses 400 for client input errors and FUXA uses 400 for user-write failures (verified).
- Decision: Map duplicate to **400** with the stable identifier `duplicate_username`. The UI branches on the stable `error` id, not the numeric status, so AC-5.2 is unaffected either way.
- Alternatives considered: 409 Conflict (more REST-idiomatic) — deferred; adoptable in review without changing the outcome contract.
- Impact / Risk: Cosmetic status choice only.
- Verification: §04 §8.2 mapping; a create-duplicate test asserts the stable `duplicate_username` identifier regardless of status.

---

## Deep-review trade-offs — DECIDED and enacted (2026-07-13)

> These entries preserve the options and historical reasoning behind D-014…D-023. The winners
> have been chosen and enacted; their current Phase/Status lines and Decision fields below are
> authoritative. No current OPEN trade-off remains.

### TO-007: Password hashing under bcrypt's 72-byte truncation (root fix for the P-002 defect, N-012)
- Date: 2026-07-13
- Phase: Design (§03) — DECIDED / enacted
- Status: DECIDED — **Option 1 now + future Option 3 migration marker** (D-017/DV-007)
- Links: REQ-4 (AC-4.5), P-002, N-012, D-002, D-008
- Context: VERIFIED root cause — bcrypt hashes only the first 72 bytes of input. Therefore two DISTINCT passwords sharing their first 72 bytes cross-verify, making P-002 ("for any A≠B, verify(B,hash(A)) is false") mathematically false as stated. §03 §2.2 currently asserts, incorrectly, that truncation leaves P-002 "unaffected".
- Options:
  1. **Bound the domain**: validate/reject passwords whose UTF-8 length > 72 bytes (or a lower policy max), and restate P-002 over the bounded domain. Cheapest; keeps bcryptjs (TO-001/D-002). Con: an operator-visible length cap; still bcrypt.
  2. **Pre-hash then bcrypt**: `bcrypt(base64(sha256(pw)))` so full-length inputs map to a fixed 44-byte digest before bcrypt. Removes the 72-byte cliff without a length cap. Con: bespoke scheme, needs domain-separation + a migration/version marker for existing cost-10 hashes; base64(sha256) is 44 bytes so no truncation.
  3. **Migrate to Argon2id** with a scheme/version field. Strongest modern KDF; memory-hard. Con: new dependency (violates the spirit of TO-001/D-002 reuse), migration-on-verify needed for legacy bcrypt hashes.
- Decision: **Option 1 now + design for Option 3 later** — enforce the ≤72-byte domain immediately and store a `hashScheme` version marker from day one so a future Argon2id migration is non-breaking (D-017/DV-007). Reason: Option 1 is a correct, verifiable, minimal root fix that unblocks P-002 immediately; the marker avoids a future breaking migration.
- Verification: corrected P-002 statement + a test proving two >72-byte near-duplicates are rejected at validation (Option 1) or do not cross-verify (Options 2/3).

### TO-008: Session authority — stateless JWT vs. live-account re-resolution + revocation (root fix for N-011)
- Date: 2026-07-13
- Phase: Design (§05/§02) — DECIDED / enacted
- Status: DECIDED — **Option 1** (D-015)
- Links: REQ-2, REQ-10, N-011, D-007
- Context: VERIFIED — §05 §4.1 builds the request `Identity.roles`/`groups` from the **token claims**, and only `mustRotate` is read from the live store. So a deleted / disabled / role-downgraded user keeps full authority until the token expires (up to the access-token TTL, extendable by refresh). This contradicts §12 §2.1's own claim that authority is resolved "from stored state rather than a long-lived token snapshot".
- Options:
  1. **Live re-resolution every request**: verify token (identity only) → load the current `User_Record` → reject if missing/disabled → derive roles/groups/permissions from the store → check a `tokenVersion`/`sessionVersion` for active revocation. Strong; costs one store read per request (already cached in `usersMap`, verified).
  2. **Short access-TTL + accept the window**: keep token-derived authority but shrink the TTL (e.g. 5 min) so stale authority self-heals quickly. Cheaper; leaves a residual window and no active revocation.
  3. **Token blacklist** on logout/delete/role-change. Partial; needs a shared store and still trusts token claims for roles.
- Decision: **Option 1** — live re-resolution on every request with `tokenVersion`/session-version revocation (D-015). It is the only option that makes deletion/disable/downgrade take effect on the next request, and the read is nearly free because FUXA already maintains an in-memory user cache.
- Verification: a test where a deleted/disabled/downgraded user presents a still-valid token and is denied on the next protected request.

### TO-009: Refresh-token model — stateless reuse (current) vs. rotation with reuse-detection (root fix for N-015)
- Date: 2026-07-13
- Phase: Design (§02) — DECIDED / enacted
- Status: DECIDED — **Option 1** (D-019)
- Links: REQ-3 (AC-3.2, AC-3.3), N-015, RFC 9700
- Context: VERIFIED — §02 reuses FUXA's stateless refresh verbatim; a "rotated" refresh issues new tokens but the OLD refresh JWT stays valid until its 7-day expiry (no server-side invalidation, no jti/family). §02 §7's "rotation limits replay" overstates the protection: a stolen refresh token replays for up to 7 days.
- Options:
  1. **Stateful rotation + reuse detection (RFC 9700)**: persist `family_id, jti, parent_jti, used/revoked/expired`, hash the refresh token at rest, atomic consume-and-rotate, revoke the whole family on replay detection, and revoke on logout/password-change/disable. Strong; needs a small refresh-token store.
  2. **Keep stateless, shorten refresh TTL** to minutes/hours. Cheap; still no reuse detection, weaker.
- Decision: **Option 1** — stateful refresh-token rotation with reuse detection, backed by the existing SQLite store (D-019). Refresh tokens are long-lived credentials; server-side invalidation is required for effective logout and compromise response.
- Verification: a replay test — using a rotated (old) refresh token twice must fail the second time AND revoke the family.

### TO-010: Login response for unknown user — uniform 401 vs. FUXA-compatible 404 (root fix for the enumeration oracle, N-011-adjacent)
- Date: 2026-07-13
- Phase: Requirements (AC-1.2/AC-1.3) — DECIDED / enacted
- Status: DECIDED — **Option 1** (DV-006)
- Links: REQ-1 (AC-1.2, AC-1.3)
- Context: AC-1.2 returns **404** for an unknown username and AC-1.3 returns **401** for a wrong password. The status difference lets an attacker enumerate valid usernames (a username-enumeration oracle).
- Options:
  1. **Uniform 401** (+ constant-time compare against a dummy hash for unknown users) so unknown-user and bad-password are indistinguishable. Standard hardening.
  2. **Keep 404/401** — matches current FUXA behavior; leaks username existence.
- Decision: **Option 1** — uniform 401 plus a dummy-hash comparison for unknown users (DV-006). This closes the username-enumeration oracle at the requirement boundary.
- Verification: a test asserting identical status + body + comparable timing for unknown-user vs bad-password.

### TO-011: Router cutover — replace FUXA routers at the composition root vs. new `/api/v2/identity/*` namespace (root fix for N-014)
- Date: 2026-07-13
- Phase: Design (§13 / composition root) — DECIDED / enacted
- Status: DECIDED — **Option 1 SUPERSEDE** (D-014)
- Links: REQ-16, D-003, D-011, N-014
- Context: VERIFIED — FUXA registers `/api/signin`, `/api/refresh`, `/api/signout`, `/api/users`, `/api/roles` in `server/api/index.js` before the module would mount. The module reuses the SAME URLs, so mounting AFTER FUXA (as the guide shows) means Express ends the response in FUXA's handler and the module's RBAC/service never runs. The design never resolved this precedence.
- Options:
  1. **Replace at the composition root**: mount the module router BEFORE FUXA's `usersApi`/`authApi` for these paths AND stop mounting FUXA's overlapping routers (or gate them off), so the module is authoritative. Preserves existing client URLs; one clear cutover point.
  2. **New namespace `/api/v2/identity/*`**: mount alongside FUXA, migrate the client, then retire FUXA routes atomically. No collision; but requires client URL changes and a dual-stack period.
- Decision: **Option 1 SUPERSEDE** — replace the overlapping FUXA routers at the composition root so the module is authoritative on the existing URLs (D-014). Option 2 remains only the documented fallback if a future gradual dual-run is required.
- Verification: an integration test that a request to `/api/users` without a valid RBAC permission is denied by the module (403), proving the module — not FUXA's admin-group gate — handled it.

### TO-012: JWT key rotation — forward-compat `kid` with a single active key now vs. a full keyring (DEF-T2, under D-021)
- Date: 2026-07-14
- Phase: Design validation (§02) — DECIDED / enacted
- Status: DECIDED — **Option A** (forward-compat `kid`, single active key today; multi-key rotation is a documented follow-up)
- Links: DEF-T2, N-030, D-021, AC-2.2, D-003, `server/api/jwt-helper.js` (verified single `secretCode`)
- Context (VERIFIED): D-021/§3/§7 promised a `kid` header enabling "secret rotation with an old+new key overlap window." But FUXA's `jwt-helper.js` exposes exactly **one** `secretCode` (verified single `get secretCode()`), and `TokenAdapter.secret` returns that one secret. There is no keyring, and **no requirement** mandates live key rotation. An overlap window needs multiple concurrently-valid keys the seam cannot supply — implementing it faithfully is impossible today, and faking it would make the "overlap" claim false.
- Options:
  1. **Forward-compat `kid`, single active key (Option A).** Emit a `kid` header naming the current key; `verify` maps `kid` to FUXA's single `secretCode`. No keyring, no overlap window yet; multi-key rotation is documented as a follow-up that adds a keyring later WITHOUT changing the token claim/header shape. Keeps AC-2.2's single signing-key path honest and the D-003 boundary minimal.
  2. **Introduce a module-owned keyring now (Option B).** A keyring (current + previous keys) with `kid`-based selection and an overlap window, layered over/around FUXA's `secretCode`. Delivers true rotation but adds a new persisted component and diverges from AC-2.2 "one shared secret" + D-003 (more FUXA-coupling surface) with no current requirement driving it.
- Decision: **Option A.** Reasons (precise): (a) no requirement demands live key rotation, so Option B builds material security-critical surface with no current driver — premature; (b) Option A keeps a single honest signing key (AC-2.2) and the minimal D-003 seam, while making the token shape rotation-ready so Option B can be added later non-breakingly; (c) fabricating an "overlap window" over one secret would be a false capability claim, which the anti-drift rules forbid. The follow-up is recorded, not silently dropped.
- Impact / Risk: no live key rotation until the follow-up is implemented; the residual risk (a compromised signing secret requires a coordinated secret change, not a rolling rotation) is the same as FUXA today and is acceptable for the current baseline. Access-token revocation is independently provided by `tokenVersion` (D-015/D-027).
- Verification (pending Task 5.6): issued tokens carry a `kid` header; `verify` accepts the current `kid` and rejects an unknown `kid`; a test/inspection confirms exactly one active key is configured and no code path claims an overlap window.

### TO-013: Cutover sequencing — client-first migration vs transitional payload-compat shim vs parallel `/api/v2`
- Date: 2026-07-14
- Phase: Implementation (Task 13 part 3b — the FUXA-core SUPERSEDE cutover)
- Status: Active — RECOMMENDED (Option 1, client-first); pending user confirmation of the next step
- Links: D-014, D-011, D-007, TO-011, N-042, `server/api/index.js`, `client/src/app/_services/auth.service.ts`, `client/src/app/auth.guard.ts`, `client/src/app/_helpers/auth-interceptor.ts`, `client/src/app/_models/user.ts`
- Context (VERIFIED from client source, N-042): the running FUXA client's authorization/UI-gating is **numeric-`groups`-based** — `AuthService.isAdmin()` tests `currentUser.groups` against `UserGroups.ADMINMASK=[-1,255]`; `checkPermission()` uses `currentUser.groups` (bitmask) or `currentUser.infoRoles` (from `currentUser.info`, when `settings.userRole`); `AuthGuard` calls `isAdmin()`; the interceptor sends `x-auth-user:{user,groups}`. The module's `/api/signin` payload (D-007) is `{token,username,fullname,roles}` — NO `groups`, NO `info`. Module-created users (User_Service.create) carry NO `groups` (RBAC roles only; only the seeded/legacy admin has `groups:-1`). Therefore a bare `server/api/index.js` SUPERSEDE with the client unchanged breaks `isAdmin()`/`checkPermission()`/guard across the app — confirming D-014's "client cutover MUST land together" is a hard coupling, not a one-line tweak.
- Options weighed:
  - **Option 1 — Client-first migration (RECOMMENDED, root-correct).** Implement Tasks 15–17 (module-owned `AuthSignInClient`/`UserAdminClient`/`RoleAdminClient` consuming `{token,…,roles}`; a roles-based permission model; the new routed Login + User-Management pages under `client/src/app/auth-management/`), rebuild `client/dist`, THEN perform the single coordinated commit: edit `server/api/index.js` (un-mount FUXA `authApi`/`usersApi` for the overlapping paths, mount the module router after `authLimiter`) together with the client cutover (D-011). Pros: matches D-007/D-011/D-014; removes the groups↔roles impedance at the root; clean end state. Cons: larger effort (full client work before the web shows the module).
  - **Option 2 — Transitional payload-compat shim.** Have the module `/api/signin` ALSO return `groups`+`info` so the legacy client keeps working, then do the SUPERSEDE now. Pros: earlier live cutover. Cons: **partial** — module-created (roles-only) users have no `groups`, so the legacy client still can't gate them; it re-surfaces `groups` as a payload field (against D-007's single-source intent) and perpetuates the numeric-groups model, i.e. a leaf-patch that grows tech debt. Rejected as the end state; only a stopgap if a live cutover were urgent.
  - **Option 3 — Parallel `/api/v2/identity/*` (TO-011 option 2, documented fallback).** Mount the module under a NEW namespace WITHOUT superseding FUXA's endpoints. Pros: zero risk to the running app; module reachable for testing/gradual migration. Cons: dual-stack (heavier); not the chosen end state (SUPERSEDE is, TO-011 option 1).
- Decision / rationale: **Option 1.** It is the only path that fixes the root (the client's groups-based authority) rather than patching the leaf (re-adding `groups` to the payload), and it is exactly what D-011 (module-owned client) + D-007 (roles as the single source) + D-014 (cutover land-together) already decided. The server module is complete and verified; the correct next work is the CLIENT (Task 15), after which the FUXA-core `api/index.js` edit + client Login/User-Management land together as one commit and the module goes live on the web.
- Impact / Risk: Until the client is migrated, the module stays mounted-nowhere (web still shows FUXA legacy auth) — acceptable and intended. The FUXA-core edit is deferred to the coordinated commit; no FUXA core is touched before then.


### TO-014: Unblocking the client build (N-044) — restore the known-good dep set vs. migrate source to the bumped majors vs. bump Angular core
- Date: 2026-07-15
- Phase: Implementation (platform prerequisite for Tasks 15.1/16/17 + the D-014 cutover)
- Status: **DECIDED + ENACTED 2026-07-15 (Option 1)** — user approved; executed via D-037 and verified (`ng build` exit 0 + fresh `client/dist`; auth jest 22/22). See D-037 OUTCOME + N-047.
- Links: N-044, N-046 (verified root cause), D-037 (the enacting decision, proposed), D-014, D-011, TO-013, dependabot commit `0c488d5`, initial commit `be8d1e7`
- Context (VERIFIED, N-046): dependabot commit `0c488d5` ("Bump the client-dependencies group … 33 updates"), which is an ancestor of the working branch, bumped the third-party Angular libraries to majors that target **Angular 21/22** (installed peer deps prove it: `ng2-charts@10` needs `@angular/core >=21`; `angular-gridster2@22` needs `^22`; `@ngx-translate/core@18` needs `>=18` with the `TranslateModule.forRoot` API removed), while the app's own `@angular/*` is pinned to **18.2.14** and the source uses the OLD APIs (`app.module.ts` calls `TranslateModule.forRoot({loader})` + imports `NgChartsModule` — both removed in the bumped majors). The committed `client/dist` is a stale prebuild from the pre-bump state. Result: the app does not compile (`ng build` fails; ~27 source errors) — verified.
- Options weighed:
  1. **Restore the Initial (`be8d1e7`) known-good client dependency set** (revert the dependabot client-group bump), preserving the 3 jest devDeps added in Task 15, then `npm install` to regenerate a consistent lock and `ng build` to verify. Pros: single, minimal, root-cause fix; returns to the exact internally-consistent, shipped-and-tested configuration that MATCHES the Angular-18 source and the pinned Angular 18 core; fully reversible via git; unblocks the web-view and Tasks 16/17. Cons: undoes 33 dependency updates, some of which may carry security patches (see Impact/mitigation).
  2. **Migrate the source to the bumped majors** (rewrite `app.module.ts` etc. to `provideTranslateService`, standalone `BaseChartDirective`, gridster22 API, …). Pros: moves onto the latest libs. Cons: those majors REQUIRE Angular 21/22, but the app core is pinned Angular 18.2.14 — so this is infeasible WITHOUT also bumping Angular itself (option 3); it is leaf-fixing a symptom (source) of a version-skew root cause and would be a large, high-risk rewrite with no requirement driving it.
  3. **Bump the Angular core 18→21/22** to match the libs, then migrate the whole app. Pros: modernizes the platform. Cons: an enormous, high-risk migration of the entire FUXA client (breaking changes across 3 Angular majors), far outside the auth-management scope, and unnecessary to deliver the auth module. Rejected as out-of-scope and disproportionate.
- Decision (proposed): **Option 1.** Reasons (precise): (a) it is the *root* fix — the defect is a version SKEW introduced by an automated bump, so restoring version alignment (not rewriting source) is the correct level to fix; (b) it returns to a configuration that is known internally-consistent and matches both the source and the pinned Angular 18 core, i.e. verifiable by an actual `ng build`; (c) it is minimal, reversible, and unblocks exactly what the user is waiting for (web-view + the Login/User-Management UI + the D-014 cutover); (d) options 2/3 are infeasible or disproportionate given the pinned Angular 18 and the absence of any requirement to upgrade Angular.
- Impact / Risk + mitigation: reverting the dependabot bump may re-introduce vulnerabilities that some of the 33 updates were patching. Mitigation: this is acceptable because (i) the bumped state does NOT build, so it is not a deployable alternative regardless; (ii) after restoring the working baseline, security updates can be re-applied SELECTIVELY at versions that are compatible with Angular 18 (e.g. the latest 14.x ngx-translate, 4.x/5.x ng2-charts, 18.x gridster) rather than the Angular-21/22 majors — a follow-up that keeps the app buildable. This selective re-patch is recorded as a follow-up, not silently dropped.
- Verification (to run after approval): `ng build` completes with 0 errors and produces a fresh `client/dist`; the app is loadable in a browser; then the auth Tasks 16/17 + D-014 cutover proceed.
