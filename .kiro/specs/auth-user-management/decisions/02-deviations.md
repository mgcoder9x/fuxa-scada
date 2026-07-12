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
