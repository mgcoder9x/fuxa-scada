# 00 — INDEX & Integrity Manifest (read this FIRST)

> **Why this file exists.** On 2026-07-13, `03-tradeoffs.md` was found overwritten with an
> unrelated chat transcript (N-020) — decision provenance was destroyed. This manifest is the
> **integrity layer** of the anti-drift kit: it declares what every spec file MUST contain, so a
> future agent (or the audit hook) can detect corruption, truncation, or silent re-decision.
>
> **Session start-up order:** (1) read this manifest, (2) run the Integrity Check below, (3) read
> the rest of `decisions/` in full, (4) run the anti-drift protocol in `README.md` §4, (5) obey
> the gates in `GATES.md`. Only then touch any spec artifact.

---

## 1. File manifest — declared purpose + required structural markers

> A file **fails integrity** if it does not contain its required markers, contains content from a
> different file's domain (e.g. a chat transcript, code unrelated to its role), or has lost its
> ID sequence. On failure: STOP, log a new `N-*` incident in `04-notes.md`, and rebuild from
> cross-references (never fabricate; quarantine unrecoverable IDs like TO-003).

| File | Purpose (one line) | Required markers (must all be present) |
|------|--------------------|----------------------------------------|
| `requirements.md` | 17 EARS requirements + glossary | `### Requirement 1`…`### Requirement 17`; `#### Acceptance Criteria`; EARS keywords (WHEN/IF/WHERE/WHILE/THE/SHALL) |
| `design.md` | Master map (arch + TOC + properties) | `## Architecture`; `## Table of Contents`; `## Correctness Properties`; `Property 1`…`Property 9` |
| `design/01`…`design/12` | Detailed design per area | each starts `# Design Section NN`; has `## Correctness Properties` (where it owns any) and a Traceability table |
| `decisions/README.md` | Ledger rules + ID scheme + anti-drift protocol | `## 2. Stable ID scheme`; `## 4. The anti-drift protocol` |
| `decisions/00-INDEX.md` | THIS manifest | `## 1. File manifest`; `## 3. Drift-incident log` |
| `decisions/01-ai-decisions.md` | `D-*` decisions | `### D-001`; monotonic `D-<nnn>` sequence; each entry has Rationale + Verification |
| `decisions/02-deviations.md` | `DV-*` deviations | `### DV-001`; monotonic `DV-<nnn>` sequence |
| `decisions/03-tradeoffs.md` | `TO-*` trade-offs | `### TO-001`; **must NOT contain chat transcripts or prose unrelated to trade-offs**; `Alternatives considered` per entry |
| `decisions/04-notes.md` | `N-*` facts/risks | `### N-001`; monotonic `N-<nnn>` sequence; unverified facts marked `UNVERIFIED` |
| `decisions/traceability.md` | REQ⇄DES⇄TASK⇄TEST matrix | `## B. Requirement → Design`; `## F. Design-Defect Register`; `## G.` (§D placeholder) |
| `decisions/GATES.md` | Phase gates + roadmap | `## Gates`; `## Roadmap` |
| `tasks.md` | Implementation plan | `## Tasks`; `## Task Dependency Graph` |
| `guide/*` | Vietnamese self-build guide (NON-normative) | each maps to a `tasks.md` task; **guide never overrides design** |

## 2. ID high-water marks (never reuse; increment only)

> Update these numbers whenever a new ID is added. A new ID below the high-water mark = drift.

| Prefix | Highest used | Notes |
|--------|--------------|-------|
| `REQ-` | 17 | |
| `D-`   | 023 | D-014…D-023 are **Active (CONFIRMED)** (2026-07-13) — all deep-review resolutions enacted; no OPEN decision remains |
| `DV-`  | 008 | DV-006…DV-008 are **Active (CONFIRMED)** (2026-07-13) — requirement refinements enacted in `requirements.md`; no OPEN deviation remains |
| `TO-`  | 011 | **TO-003 QUARANTINED (unrecoverable, N-020) — do not reuse** |
| `N-`   | 024 | N-010…N-021 added 2026-07-13; N-022 (deps-not-installed → **RESOLVED**, deps now present) + N-023 (chai@5 ESM → node:assert; fast-check@3.23.2) + N-024 (2026-07-13 independent verification pass + anti-drift hardening) added 2026-07-13 |
| `P-`   | 016 | P-013 (D-015) + P-014 (D-014/018) + P-015 (D-019) + P-016 (D-020 concurrency) added 2026-07-13 |
| `TASK-`| see tasks.md | |

## 3. Drift-incident log (append-only)

| Date | Incident | Root cause | Remediation |
|------|----------|-----------|-------------|
| 2026-07-13 | `03-tradeoffs.md` overwritten with a chat transcript (N-020) | No integrity manifest; whole-file overwrite of a ledger file went undetected | File rebuilt from cross-references; TO-003 quarantined; this manifest + GATES + steering + audit hook added |
| 2026-07-13 | Deep review found 11 design defects (N-010…N-019, N-021) present since design phase | Design/tasks generated without a defect-gate before implementation | Defect register (traceability §F) + gates (GATES.md) added; resolutions D-014…D-023 logged OPEN |
| 2026-07-13 | Two stale ledger annotations after their underlying state changed: 00-INDEX §2 still marked D-014…D-023 / DV-006…DV-008 "OPEN"; N-022 still claimed "deps absent" (N-024) | ON-EXIT protocol (§2/status refresh) not applied when the decisions were confirmed and when `npm install` was run | Corrected both to current state; recorded provenance in N-024; **added an automatic save-time `fileEdited` integrity guard** so a stale/overwritten spec/ledger file is flagged at the moment of save (the gap that hid N-020) |

## 4. Integrity Check (run at session start and before any phase transition)

For each file in §1: confirm it exists, contains all its required markers, and contains **no**
content from another file's domain. For each ID prefix in §2: confirm the sequence is monotonic
with no gaps except explicitly `RETIRED`/`QUARANTINED` tombstones, and that no ID is reused. If
any check fails, STOP and open an incident in §3 + `04-notes.md`.

> This check is intentionally simple enough to run by reading files (no tooling required), and is
> the exact check that would have caught N-020 the moment it happened.
