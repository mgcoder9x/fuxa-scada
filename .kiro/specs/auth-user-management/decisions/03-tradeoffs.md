# 03 — Trade-offs weighed

> Options considered and the reasoning behind the chosen path. Schema in `README.md` §3.

### TO-001: Reuse FUXA credential store vs. dedicated auth database
- Date: 2026-07-12
- Phase: Requirements
- Status: Active (decision recorded in D-002)
- Links: REQ-13, REQ-16
- Context: Where should users/roles live?
- Options:
  - **A. Reuse FUXA's existing user/role store (chosen).** Pros: one credential source, no migration, less new surface. Cons: couples to FUXA schema; roles currently live inside a user `info` object (verified in FUXA runtime users), which is less normalized.
  - B. New normalized auth DB. Pros: clean schema, independent scaling. Cons: dual stores, migration/sync burden, more attack surface — unjustified now.
- Decision: A, behind a Store interface so B remains possible later without changing services (AC-16.5).
- Impact / Risk: If commercial scale later demands normalized RBAC, a migration will be needed; the Store interface is the seam that makes it feasible.

### TO-002: Non-expiring tokens when no expiry is configured (AC-2.7)
- Date: 2026-07-12
- Phase: Requirements
- Status: DECIDED 2026-07-12 (user chose safe default TTL) — supersedes the D-004(a) auto-resolution
- Links: REQ-2 (AC-2.7), DV-003
- Context: Analysis had resolved "no expiry configured" to "issue non-expiring tokens" to match FUXA's current behavior.
- Options: (a) non-expiring (matches existing FUXA behavior) vs (b) enforce a safe default TTL even when unconfigured.
- Decision: **(b)** — enforce a safe default TTL (target: 1h) plus refresh tokens for commercial-grade security. "No expiry" is demoted to an explicit dev-only mode, never the silent default.
- Rationale: Non-expiring access tokens cannot be revoked by expiry — an unacceptable risk for a commercial product. Chosen behavior fixes the root cause (missing revocation window) rather than papering over it.
- Impact / Risk: Requires updating AC-2.7 in requirements.md (tracked as DV-003) so the source of truth matches this decision.
- Verification: AC-2.7 reworded to mandate a default TTL; a test proves an unconfigured deployment still issues expiring tokens.

### TO-004: API "fail fast" when service layer unavailable (AC-16.4)
- Date: 2026-07-12
- Phase: Requirements
- Status: Active
- Links: REQ-16 (AC-16.4)
- Context: How should the API behave if the service layer is down?
- Options: fail fast with an error (chosen) vs. queue/retry vs. degrade.
- Decision: Fail fast — simplest correct behavior; avoids masking outages.
- Impact / Risk: No automatic resilience; acceptable for a first cut. Revisit with health-checks/circuit-breaker if uptime SLAs are introduced.

### TO-005: First-administrator bootstrap strategy (OPEN)
- Date: 2026-07-12
- Phase: Requirements→Design
- Status: DECIDED 2026-07-12 — option (a) chosen, (b) kept as ops fallback
- Links: D-005, DV-004, REQ-5, REQ-9
- Context: Someone must be able to create the first users/roles.
- Options: (a) auto-seed default admin + forced password rotation; (b) CLI `create-admin` command; (c) environment-variable seeded credentials.
- Decision: **(a)** as the default out-of-box flow, with **(b)** documented as an ops fallback. (c) rejected as default.
- Impact / Risk: (a) has a default-credential window; (c) risks secrets in env/logs; (b) is safest but least convenient.
- Verification: Whatever is chosen, a test must prove no usable known-default credential survives first boot.
