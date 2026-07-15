# 02 — Deviations from the user's original request

> Where the delivered artifacts changed / expanded / narrowed the user's literal words.
> Schema in `README.md` §3.

### DV-001: Scope expanded beyond "login + user management + permissions"
- Date: 2026-07-12
- Phase: Requirements
- Status: Active
- Links: REQ-3, REQ-14, REQ-15, REQ-13
- Context: The user's literal first ask was: a login page, then a user-management page, with permissions. The requirements added token refresh & sign-out (REQ-3), audit logging (REQ-14), brute-force protection (REQ-15), and serialization round-trip guarantees (REQ-13).
- Statement: These four areas were added even though not named in the original sentence.
- Rationale: The user explicitly framed this as "một hệ thống cực lớn", "cực tốt và an toàn", "sản phẩm thương mại", and "luôn valid nhiều lần". Refresh/sign-out, audit, and brute-force protection are baseline requirements for a commercial-grade secure auth system; the round-trip properties directly serve the user's emphasis on verifiability. The additions are justified expansions, not scope creep for its own sake.
- Alternatives considered: Deliver only the literal three items — rejected: would not meet the stated "an toàn / thương mại" bar and would require insecure rework later (a "fix the leaf, not the root" outcome the user explicitly forbade).
- Impact / Risk: Larger initial surface and more tasks. Acceptable given stated goals; each added area is independently toggle-able where feasible.
- Verification: If the user wants a leaner first cut, mark the relevant REQs `deferred` here rather than deleting them.

### DV-002: Design will be authored as a FOLDER of sections, not a single design.md
- Date: 2026-07-12
- Phase: Requirements→Design
- Status: Active
- Links: REQ-16
- Context: The standard workflow produces one `design.md`. The user explicitly requested "design cũng nên là 1 folder ta sẽ làm theo từng mục" (design as a folder, done section by section).
- Statement: Design will live under `design/` as multiple section files, produced and validated one module at a time.
- Rationale: Directly honors the user's stated preference and their "prepare → validate each part → then proceed" method. Sectioning also improves anti-drift: each section maps to specific REQs in `traceability.md`.
- Alternatives considered: Single design.md — rejected: contradicts explicit user instruction and is harder to validate incrementally.
- Impact / Risk: Diverges from the default tool expectation of a single design.md; noted so future tooling/agents are not surprised.
- Verification: `design/` exists with an index; every section file maps to REQ IDs in traceability.md.
- REFINEMENT 2026-07-12: Reconciled with Kiro tooling (which reads `design.md` as the entry point) by keeping `design.md` as the MASTER MAP (architecture overview + table of contents, = DES-ARCH/REQ-16) and placing the 12 detailed module sections under `design/`. Satisfies both the folder preference and tooling. `design.md` master map: DONE & drafted 2026-07-12.

### DV-003: AC-2.7 changed — mandate a safe default token TTL instead of non-expiring
- Date: 2026-07-12
- Phase: Requirements
- Status: Active (user-approved 2026-07-12)
- Links: REQ-2 (AC-2.7), TO-002, D-004
- Context: The original AC-2.7 issued non-expiring tokens when no expiry was configured. The user approved a commercial-grade security posture.
- Statement: AC-2.7 is being reworded so that, when no expiry is configured, the Token_Service still applies a safe default TTL (target 1h); truly non-expiring tokens become an explicit, opt-in dev-only mode.
- Rationale: Root-cause fix for token revocability (see TO-002). Keeping requirements.md aligned with the decision prevents drift between source-of-truth and intent.
- Impact / Risk: A requirements.md edit is required; downstream design/tests must reflect the default TTL.
- Verification: requirements.md AC-2.7 reflects the default TTL; traceability P-007 covers expiry behavior.

### DV-004: New requirement added — Administrator bootstrap (first-run seeding)
- Date: 2026-07-12
- Phase: Requirements
- Status: Active (user-approved 2026-07-12)
- Links: D-005, TO-005, REQ-5, REQ-9, REQ-10
- Context: No requirement existed for how the first administrator comes to exist, yet RBAC/user-CRUD depend on it.
- Statement: A new requirement is being added specifying first-run auto-seed of one administrator with mandatory password rotation before any other action is allowed.
- Rationale: Closes a real bootstrap gap with a security guarantee; making it a requirement (not just a design note) keeps it visible and testable.
- Impact / Risk: Adds one requirement + associated tests.
- Verification: requirements.md contains the new bootstrap requirement; a test proves the default credential is unusable pre-rotation.

### DV-005: New criterion AC-8.5 added — reject deleting the last administrator
- Date: 2026-07-12
- Phase: Design (section 04) → Requirements
- Status: Active (user-approved 2026-07-12)
- Links: REQ-8 (AC-8.5), REQ-17, D-009, candidate P-010
- Context: Section 04 design surfaced that REQ-8 had no protection against deleting the last administrator, risking an irrecoverable zero-admin lockout.
- Statement: Added AC-8.5 to REQ-8: "IF the User_Service receives a delete request for the last remaining administrator account, THEN THE User_Service SHALL reject the request ... and SHALL NOT remove the account." Section 04 §6.5 specifies the guard (before store mutation), the `last_admin` outcome (HTTP 400 with stable id), and tests.
- Rationale: Delete-path inverse of the REQ-17 bootstrap guarantee; prevents a no-admin lockout.
- Impact / Risk: Admin-counting depends on the RBAC admin-determination predicate (owned by section 05); must reconcile FUXA group code 255/-1.
- Verification: requirements.md AC-8.5 present; section 04 §6.5 + test item 14 + integration example; candidate P-010.

---

## Deep-review deviations confirmed and enacted (2026-07-13)

> DV-006…DV-008 preserve the original proposal context and wording, but all three were approved
> and enacted in `requirements.md` and the cited design sections. Their current Status is Active
> (CONFIRMED); no requirement-level OPEN deviation remains.

### DV-006: Change AC-1.2 — uniform 401 for unknown user (remove the username-enumeration oracle)
- Date: 2026-07-13
- Phase: Requirements (REQ-1)
- Status: **Active (CONFIRMED by user 2026-07-13)** — `requirements.md`: AC-1.2 now returns the same 401 + generic body as bad-password (was 404); AC-1.3 adds the dummy-hash comparable-cost compare (timing parity); **AC-8.4** updated in lockstep (post-delete sign-in → generic 401, not 404). `design/01` synced (§2.2 outcome id, §3 sequence with dummy-hash verify, §4 mapping table, §7 uniform-failure + timing note, §8 identical-response test, §9 traceability). `design.md` Error-Handling table split into "sign-in bad credentials/unknown user → 401" vs "authenticated admin CRUD lookup unknown username → 404" (AC-7.4/AC-8.3 remain 404 — not an enumeration oracle). `design/03` timing note + `design/04` (§summary, §6.4, cross-refs, test, traceability AC-8.4) synced.
- Links: TO-010, REQ-1 (AC-1.2, AC-1.3), REQ-8 (AC-8.4), N-011 (adjacent)
- Context: AC-1.2 mandates **404** for an unknown username while AC-1.3 mandates **401** for a wrong password. The status/shape difference is a username-enumeration oracle (an attacker learns which usernames exist).
- Statement (proposed): Change AC-1.2 so an unknown username returns the **same 401 + body** as a bad password (indistinguishable), with a constant-time compare against a dummy hash for unknown users to avoid a timing oracle. Post-delete sign-in (AC-8.4) would then also return 401, not 404 — AC-8.4 must be updated in lockstep.
- Rationale: For a commercial security product, closing enumeration at the requirement level is a root fix; leaving 404/401 bakes the oracle into the contract.
- Impact / Risk: Diverges from FUXA's current 404 behavior and changes AC-1.2/AC-8.4 wording + their tests. This is a genuine requirement change, hence a deviation needing explicit approval.
- Verification: a test asserting identical status + body (and comparable timing) for unknown-user vs bad-password.

### DV-007: Refine AC-4.5 / P-002 — bound the password domain to bcrypt's 72-byte limit (+ password policy)
- Date: 2026-07-13
- Phase: Requirements (REQ-4)
- Status: **Active (user-approved 2026-07-13, option 1)** — `requirements.md` REQ-4: AC-4.5 refined to the ≤72-byte accepted domain; **AC-4.6** added (reject >72 UTF-8 bytes); **AC-4.7** added (min length default 12, NIST-63B-4 ≥15 recommended, + common-password blocklist). Design synced in `design/03` (§2.2/§7/§8.1/§9), `design.md` master-map Property 2, and `design/04` §2.3 (enforcement site).
- Links: N-012, TO-007, D-017, REQ-4 (AC-4.5), P-002
- Context: P-002 (from AC-4.5) is false for inputs >72 bytes due to bcrypt truncation (N-012).
- Statement (proposed): Refine AC-4.5 so the rejection guarantee is stated over a **bounded input domain** (UTF-8 length ≤ 72 bytes, or a stricter policy max that is validated and enforced), and add acceptance criteria for a minimum password length and a common-password blocklist (NIST SP 800-63B). Add a `hashScheme` version marker to enable a future Argon2id migration without breaking verification.
- Rationale: Makes a currently-false property true and verifiable, and raises the credential policy to a commercial baseline. Root fix, not a leaf patch.
- Impact / Risk: Introduces an operator-visible password length cap and policy; edits REQ-4 wording + tests.
- Verification: corrected P-002 test; policy tests for length/blocklist.

### DV-008: Refine AC-15.2 — adaptive throttling instead of a hard fixed-duration lockout (OT DoS resistance)
- Date: 2026-07-13
- Phase: Requirements (REQ-15)
- Status: **Active (CONFIRMED by user 2026-07-13)** — `requirements.md` REQ-15 edited: AC-15.2 now mandates **adaptive throttling** (exponential backoff with optional max interval) instead of a fixed-duration hard lockout; AC-15.4/15.5 reworded for the adaptive interval; **new AC-15.6** added (multi-instance shared-store consistency + bounded interval for targeted-DoS resistance). `design/10` updated: `BruteForceStore` pluggable seam (in-memory default / shared e.g. Redis), adaptive `baseThrottleMs`/`backoffFactor`/`maxThrottleMs` config, monotonic clock (N-019), and P-012 reference model + generator refined to the adaptive machine (now validates AC-15.1–15.6). Fail-closed threshold-zero (AC-15.3) preserved.
- Links: N-019, REQ-15 (AC-15.2, AC-15.4, AC-15.5, AC-15.6), P-012, §10 §2.1/§2.2/§3/§5/§6/§8/§9/§10
- Context: AC-15.2 mandates a hard lockout for a fixed duration once the threshold is reached. For an OT/SCADA operator, an attacker who knows a username can weaponize this to lock out the legitimate operator (targeted DoS); per-process state also multiplies the threshold across nodes.
- Statement (proposed): Refine AC-15.2 toward **adaptive throttling** (increasing delay/backoff) with an optional hard cap, and make the counter state **pluggable to a shared store** so the threshold holds across instances. Keep the fail-closed threshold-zero behavior (AC-15.3).
- Rationale: NIST SP 800-63B recommends rate-limiting/adaptive delays over hard account locks precisely to avoid attacker-induced lockout of valid users; shared state is required for correct throttling under horizontal scaling.
- Impact / Risk: Changes AC-15.2 semantics and P-012's reference state machine; edits REQ-15 + its property/tests.
- Verification: an updated P-012 covering adaptive delay + a multi-instance test that the effective threshold is not multiplied by node count.


---

## Task-phase deviations (implementation)

### DV-009: Client HTTP-client tests use headless direct-instantiation, NOT `HttpClientTestingModule`
- Date: 2026-07-15
- Phase: Implementation (Task 15.4)
- Status: Active (CONFIRMED by necessity — verified blocker, N-044)
- Links: Task 15.4, D-036, N-043, N-044, REQ-11, REQ-12
- Context: Task 15.4 literally says to verify the client HTTP services with Angular's `HttpClientTestingModule` (i.e. `TestBed` + the Angular test harness). That harness requires the Angular compiler/runtime and a browser-like environment, and — critically — `TestBed` compiles the reachable module graph, which includes the **broken** FUXA app modules (N-044: `app.module`/gridster/charts/ngx-translate dep drift, 27 pre-existing src errors that are out of auth scope and un-editable under D-003).
- Statement: The client clients are instead verified **headlessly** with jest/ts-jest: (1) `auth-protocol.spec.ts` unit-tests the framework-free pure core (mapping + stable error normalization), and (2) `auth-clients.spec.ts` tests the thin `@Injectable` shells by **direct instantiation** with a stub `HttpClient` object (plain get/post/put/delete returning rxjs observables), asserting the exact URL/method, the `Skip-Error` opt-out header, success-mapping delegation, and stable-error normalization on every HTTP failure. `@angular/core`, `@angular/common/http`, and FUXA-core `EndPointApi` are mapped to tiny runtime stubs (jest `moduleNameMapper`) so no browser/Angular runtime and no broken FUXA graph are pulled in; ts-jest still type-checks the shells against the REAL Angular declarations, and a separate `tsc -p tsconfig.verify.json` type-checks them against Angular 18 (0 errors).
- Rationale: This is the SAME verification content the task intends (request shape + success mapping + error-id normalization) achieved with a mechanism that actually runs in this environment. The pure-core + thin-shell split makes direct instantiation strictly equivalent to a `TestBed`-mocked `HttpClient` for the logic under test, while avoiding a dependency on code the module does not own and cannot fix. Root-cause honest: the deviation exists because of the verified upstream build regression (N-044), not a shortcut.
- Impact / Risk: When the FUXA platform dep drift is remediated (the separate Option A track), a `TestBed`/`HttpClientTestingModule` layer MAY be added on top for the eventual Login/User-Management **components** (Tasks 16/17), which do need DOM/TestBed. The client *clients* remain fully verified by the headless suite regardless. No production code depends on the stubs (they live only under `auth-management/testing/`, used solely by jest via `moduleNameMapper`).
- Verification: `npx jest` → 2 suites / 22 tests, exit 0 (green on two consecutive runs); `npx tsc -p src/app/auth-management/tsconfig.verify.json` → 0 errors.
