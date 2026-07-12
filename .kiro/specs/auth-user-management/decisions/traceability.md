# Traceability Matrix — the anti-drift engine

> Bidirectional map: every requirement must flow forward to design → task → test, and every
> design section must map back to a requirement. **Orphans on either side are drift** and must
> be resolved before advancing a phase (see `README.md` §4).
>
> Status legend: `planned` = section named but not yet written; `drafted` = written, not
> validated; `validated` = reviewed & self-consistent; `implemented`; `tested`.

## A. Planned design sections (to be created under `design/`)

| Design ID | Section file (planned) | Covers requirements |
|-----------|------------------------|---------------------|
| `DES-ARCH`      | `design.md` (master map — architecture overview + TOC) | REQ-16 |
| `DES-AUTH`      | `design/01-authentication.md`        | REQ-1 |
| `DES-TOKEN`     | `design/02-token-and-session.md`     | REQ-2, REQ-3 |
| `DES-PWD`       | `design/03-password-security.md`     | REQ-4 |
| `DES-USER`      | `design/04-user-management.md`       | REQ-5, REQ-6, REQ-7, REQ-8 |
| `DES-RBAC`      | `design/05-rbac-authorization.md`    | REQ-9, REQ-10 |
| `DES-STORE`     | `design/06-persistence-and-serialization.md` | REQ-13 |
| `DES-UI-LOGIN`  | `design/07-ui-login-page.md`         | REQ-11 |
| `DES-UI-USERS`  | `design/08-ui-user-management-page.md` | REQ-12 |
| `DES-AUDIT`     | `design/09-audit-logging.md`         | REQ-14 |
| `DES-BRUTE`     | `design/10-brute-force-protection.md`| REQ-15 |
| `DES-DATA`      | `design/11-data-models.md`           | REQ-13, cross-cutting |
| `DES-BOOT`      | `design/12-admin-bootstrap.md`       | REQ-17 (new) |

## B. Requirement → Design coverage

| REQ | Title | Design section(s) | Status |
|-----|-------|-------------------|--------|
| REQ-1  | User Authentication (Login)        | DES-AUTH | **drafted** |
| REQ-2  | Session Token Issuance & Validation| DES-TOKEN | **drafted** |
| REQ-3  | Token Refresh & Sign-Out           | DES-TOKEN | **drafted** |
| REQ-4  | Password Security                  | DES-PWD | **drafted** |
| REQ-5  | Create User                        | DES-USER | **drafted** |
| REQ-6  | List and View Users                | DES-USER | **drafted** |
| REQ-7  | Update User                        | DES-USER | **drafted** |
| REQ-8  | Delete User                        | DES-USER | **drafted** |
| REQ-9  | Role Management (RBAC)             | DES-RBAC | **drafted** |
| REQ-10 | Authorization Enforcement          | DES-RBAC | **drafted** |
| REQ-11 | Login Page                         | DES-UI-LOGIN | **drafted** |
| REQ-12 | User Management Page               | DES-UI-USERS | **drafted** |
| REQ-13 | User/Role Serialization Round-Trip | DES-STORE, DES-DATA | **drafted (DES-STORE + DES-DATA)** |
| REQ-14 | Security Audit Logging             | DES-AUDIT | **drafted** |
| REQ-15 | Brute-Force Protection             | DES-BRUTE | **drafted** |
| REQ-16 | Modular Architecture               | DES-ARCH (design.md) | **drafted** |
| REQ-17 | Administrator Bootstrap (new, DV-004) | DES-BOOT | **drafted** |

## C. Correctness properties (PBT) — to be defined during design

| Prop ID | Property (informal) | Anchored to | Status |
|---------|---------------------|-------------|--------|
| `P-001` | Password hash verifies against its own plaintext; two hashes of same plaintext both verify | AC-4.3, AC-4.4 | **drafted (owned by §03)** |
| `P-002` | Password hash of plaintext A never verifies plaintext B (A≠B) | AC-4.5 | **drafted (owned by §03)** |
| `P-003` | User_Record write→read round-trips username/fullname/roles/metadata unchanged | AC-13.1 | **drafted (owned by §06)** |
| `P-004` | Role write→read round-trips name/permissions unchanged | AC-13.2 | **drafted (owned by §06)** |
| `P-005` | Metadata serialize→deserialize is identity (round-trip) | AC-13.3 | **drafted (owned by §06)** |
| `P-006` | Authorization decision is deterministic for unchanged identity+operation | AC-10.5 | **drafted (owned by §05)** |
| `P-007` | A token verifies as authenticated iff signature valid AND not expired | AC-2.3, AC-2.4, AC-2.5 | **drafted (owned by §02)** |
| `P-008` | With no expiry configured, issued tokens still carry a finite default TTL (DV-003) | AC-2.7 (revised) | **drafted (owned by §02)** |
| `P-009` | A freshly seeded default admin cannot perform any protected action before password rotation (DV-004) | REQ-17 | **drafted (owned by §12)** |
| `P-010` | For any sequence of deletions on a store starting with ≥1 admin, ≥1 admin always remains (DV-005) | AC-8.5 + REQ-17 | **CONFIRMED 2026-07-12 — owned jointly §04 + §12** |
| `P-011` | After role deletion, no surviving user references a deleted role id and no deleted role remains | AC-9.4 | **CONFIRMED 2026-07-12 — owned by §05** |
| `P-012` | Lockout lifecycle matches reference state machine (threshold/lock/reset/expiry/isolation) | AC-15.1–15.5 | **CONFIRMED 2026-07-12 — owned by §10** |

## D. Design → Task → Test (filled during Tasks phase)

| Design ID | Task(s) | Test(s)/Property(ies) | Status |
|-----------|---------|-----------------------|--------|
| _pending — populated when tasks.md is generated_ | | | |

## E. Orphan check (run at each phase transition)

- Requirements with no design mapping: **none** (all REQ-1..17 mapped above).
- Design sections with no requirement: **none** (all DES-* map back).
- Open items blocking progress: **none currently.**
  - RESOLVED: scope (D-003, module-in-FUXA), token expiry policy (TO-002/DV-003, default TTL),
    admin bootstrap (D-005/TO-005/DV-004, auto-seed + forced rotation).
  - Pending action: sync `requirements.md` to reflect DV-003 (revise AC-2.7) and DV-004 (add REQ-17)
    before design begins.
