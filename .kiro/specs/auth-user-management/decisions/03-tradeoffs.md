# 03 — Trade-offs weighed (options + why rejected)

> Trade-offs the agent weighed, the alternatives, and the precise reason the winner won.
> Schema in `README.md` §3. Log the **alternatives**, not just the winner.

> ⚠️ **INTEGRITY INCIDENT — 2026-07-13 (see N-020).** This file was found **overwritten with an
> unrelated chat transcript**; the original TO-* entries had been destroyed. The workspace is not
> a git repo (N-001), so there is no VCS history to restore from. The entries below were
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

## New trade-offs raised by the 2026-07-13 deep design review (OPEN — need user decision)

> These are the trade-offs behind the design-defect resolutions proposed as OPEN decisions
> D-014…D-023 in `01-ai-decisions.md`. They are logged here so the reasoning is preserved even
> before a winner is chosen.

### TO-007: Password hashing under bcrypt's 72-byte truncation (root fix for the P-002 defect, N-012)
- Date: 2026-07-13
- Phase: Design (§03) — OPEN
- Status: OPEN (needs user decision) — see D-017
- Links: REQ-4 (AC-4.5), P-002, N-012, D-002, D-008
- Context: VERIFIED root cause — bcrypt hashes only the first 72 bytes of input. Therefore two DISTINCT passwords sharing their first 72 bytes cross-verify, making P-002 ("for any A≠B, verify(B,hash(A)) is false") mathematically false as stated. §03 §2.2 currently asserts, incorrectly, that truncation leaves P-002 "unaffected".
- Options:
  1. **Bound the domain**: validate/reject passwords whose UTF-8 length > 72 bytes (or a lower policy max), and restate P-002 over the bounded domain. Cheapest; keeps bcryptjs (TO-001/D-002). Con: an operator-visible length cap; still bcrypt.
  2. **Pre-hash then bcrypt**: `bcrypt(base64(sha256(pw)))` so full-length inputs map to a fixed 44-byte digest before bcrypt. Removes the 72-byte cliff without a length cap. Con: bespoke scheme, needs domain-separation + a migration/version marker for existing cost-10 hashes; base64(sha256) is 44 bytes so no truncation.
  3. **Migrate to Argon2id** with a scheme/version field. Strongest modern KDF; memory-hard. Con: new dependency (violates the spirit of TO-001/D-002 reuse), migration-on-verify needed for legacy bcrypt hashes.
- Recommendation: **Option 1 now + design for Option 3 later** (scheme-version field from day one so Argon2id migration is non-breaking). Reason: Option 1 is a correct, verifiable, minimal root fix that unblocks P-002 immediately; adding a `hashScheme` version field now avoids a future breaking migration. Full justification in D-017.
- Verification: corrected P-002 statement + a test proving two >72-byte near-duplicates are rejected at validation (Option 1) or do not cross-verify (Options 2/3).

### TO-008: Session authority — stateless JWT vs. live-account re-resolution + revocation (root fix for N-011)
- Date: 2026-07-13
- Phase: Design (§05/§02) — OPEN
- Status: OPEN (needs user decision) — see D-015
- Links: REQ-2, REQ-10, N-011, D-007
- Context: VERIFIED — §05 §4.1 builds the request `Identity.roles`/`groups` from the **token claims**, and only `mustRotate` is read from the live store. So a deleted / disabled / role-downgraded user keeps full authority until the token expires (up to the access-token TTL, extendable by refresh). This contradicts §12 §2.1's own claim that authority is resolved "from stored state rather than a long-lived token snapshot".
- Options:
  1. **Live re-resolution every request**: verify token (identity only) → load the current `User_Record` → reject if missing/disabled → derive roles/groups/permissions from the store → check a `tokenVersion`/`sessionVersion` for active revocation. Strong; costs one store read per request (already cached in `usersMap`, verified).
  2. **Short access-TTL + accept the window**: keep token-derived authority but shrink the TTL (e.g. 5 min) so stale authority self-heals quickly. Cheaper; leaves a residual window and no active revocation.
  3. **Token blacklist** on logout/delete/role-change. Partial; needs a shared store and still trusts token claims for roles.
- Recommendation: **Option 1**. Reason: it is the only option that makes deletion/disable/downgrade take effect on the very next request (the behavior §12 §2.1 already claims to have), and the read is nearly free because `usersMap` is an in-memory cache FUXA already maintains. Full justification in D-015.
- Verification: a test where a deleted/disabled/downgraded user presents a still-valid token and is denied on the next protected request.

### TO-009: Refresh-token model — stateless reuse (current) vs. rotation with reuse-detection (root fix for N-015)
- Date: 2026-07-13
- Phase: Design (§02) — OPEN
- Status: OPEN (needs user decision) — see D-019
- Links: REQ-3 (AC-3.2, AC-3.3), N-015, RFC 9700
- Context: VERIFIED — §02 reuses FUXA's stateless refresh verbatim; a "rotated" refresh issues new tokens but the OLD refresh JWT stays valid until its 7-day expiry (no server-side invalidation, no jti/family). §02 §7's "rotation limits replay" overstates the protection: a stolen refresh token replays for up to 7 days.
- Options:
  1. **Stateful rotation + reuse detection (RFC 9700)**: persist `family_id, jti, parent_jti, used/revoked/expired`, hash the refresh token at rest, atomic consume-and-rotate, revoke the whole family on replay detection, and revoke on logout/password-change/disable. Strong; needs a small refresh-token store.
  2. **Keep stateless, shorten refresh TTL** to minutes/hours. Cheap; still no reuse detection, weaker.
- Recommendation: **Option 1**, backed by the SQLite store FUXA already uses (TO-009 → D-019). Reason: refresh tokens are the long-lived credential; without server-side invalidation, logout and compromise-response are ineffective — a hard requirement for a commercial product.
- Verification: a replay test — using a rotated (old) refresh token twice must fail the second time AND revoke the family.

### TO-010: Login response for unknown user — uniform 401 vs. FUXA-compatible 404 (root fix for the enumeration oracle, N-011-adjacent)
- Date: 2026-07-13
- Phase: Requirements (AC-1.2/AC-1.3) — OPEN
- Status: OPEN (needs user decision) — see DV-006
- Links: REQ-1 (AC-1.2, AC-1.3)
- Context: AC-1.2 returns **404** for an unknown username and AC-1.3 returns **401** for a wrong password. The status difference lets an attacker enumerate valid usernames (a username-enumeration oracle).
- Options:
  1. **Uniform 401** (+ constant-time compare against a dummy hash for unknown users) so unknown-user and bad-password are indistinguishable. Standard hardening.
  2. **Keep 404/401** — matches current FUXA behavior; leaks username existence.
- Recommendation: **Option 1**, which requires editing AC-1.2 (a deviation, DV-006). Reason: username enumeration is a well-known pre-attack step; for a commercial security product the enumeration oracle should be closed at the requirement level, not left as an implementation detail.
- Verification: a test asserting identical status + body + comparable timing for unknown-user vs bad-password.

### TO-011: Router cutover — replace FUXA routers at the composition root vs. new `/api/v2/identity/*` namespace (root fix for N-014)
- Date: 2026-07-13
- Phase: Design (§13 / composition root) — OPEN
- Status: OPEN (needs user decision) — see D-014
- Links: REQ-16, D-003, D-011, N-014
- Context: VERIFIED — FUXA registers `/api/signin`, `/api/refresh`, `/api/signout`, `/api/users`, `/api/roles` in `server/api/index.js` before the module would mount. The module reuses the SAME URLs, so mounting AFTER FUXA (as the guide shows) means Express ends the response in FUXA's handler and the module's RBAC/service never runs. The design never resolved this precedence.
- Options:
  1. **Replace at the composition root**: mount the module router BEFORE FUXA's `usersApi`/`authApi` for these paths AND stop mounting FUXA's overlapping routers (or gate them off), so the module is authoritative. Preserves existing client URLs; one clear cutover point.
  2. **New namespace `/api/v2/identity/*`**: mount alongside FUXA, migrate the client, then retire FUXA routes atomically. No collision; but requires client URL changes and a dual-stack period.
- Recommendation: **Option 1** if the module fully supersedes FUXA auth (matches D-011 SUPERSEDE intent); Option 2 only if a gradual dual-run is required. Reason: the module was explicitly designed to SUPERSEDE (D-011), so a clean replacement at the single mount point is the honest realization of that intent and avoids permanently shadowed code. Full justification in D-014.
- Verification: an integration test that a request to `/api/users` without a valid RBAC permission is denied by the module (403), proving the module — not FUXA's admin-group gate — handled it.
