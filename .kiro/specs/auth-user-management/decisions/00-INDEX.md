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
| `D-`   | 026 | D-014…D-023 are **Active (CONFIRMED)** (2026-07-13); **D-024** (store-adapter own-connection reads per D-015; plain-INSERT role create per AC-9.5); **D-025** (2026-07-13) — reject malformed UTF-16 (lone surrogates) at the Password_Hasher seam + boundary validation, fixes the N-027 bcryptjs ~9.6s DoS; **D-026** (2026-07-14) — strip `__proto__` at the `deserialize` seam + object-spread compose in both store adapters, fixes the N-029 metadata round-trip loss / prototype-manipulation hazard; **D-027** (2026-07-14) — `tokenVersion` first-class end-to-end contract (default 0 + absent→0 coercion), fixes DEF-T1/DEF-T5; **D-028** (2026-07-14) — single `type` token-type claim (drop parallel `typ`), fixes DEF-T3; **D-029** (2026-07-14) — name `settings.auth.jwtIssuer`/`jwtAudience`, validate only when configured, fixes DEF-T4; **D-030** (2026-07-14) — Refresh_Token_Store SHA-256 at-rest + compare-and-swap single-use consume (implements D-019); **D-031** (2026-07-14) — DV-006 dummy-hash produced by the same Password_Hasher at the same cost, once, from a random secret (timing parity). D-027..D-031 test-verified. No OPEN decision remains |
| `DV-`  | 008 | DV-006…DV-008 are **Active (CONFIRMED)** (2026-07-13) — requirement refinements enacted in `requirements.md`; no OPEN deviation remains |
| `TO-`  | 012 | **TO-003 QUARANTINED (unrecoverable, N-020) — do not reuse**; **TO-012** (2026-07-14) — JWT key rotation: forward-compat `kid` + single active key now (Option A), multi-key keyring is a documented follow-up (DEF-T2) |
| `N-`   | 034 | N-010…N-021 added 2026-07-13; N-022 (deps-not-installed → **RESOLVED**, deps now present) + N-023 (chai@5 ESM → node:assert; fast-check@3.23.2) + N-024 (independent verification + anti-drift hardening) + N-025 (machine provisioning/test-runner) + N-026 (corrupt-info fail-closed) + N-027 (bcryptjs lone-surrogate DoS, fixed by D-025) + N-028 (2026-07-14 G0 ledger/domain/status + embedded-credential incident; local remediation complete; external PAT revoke/rotate USER ACTION REQUIRED / UNVERIFIED) + **N-029 (2026-07-14 store metadata `__proto__` round-trip loss / prototype-manipulation, found on independent re-run — baseline was 41/42 not "42 passing"; fixed by D-026; suite now 47 passing, stable) + **N-030 (2026-07-14 Token & Session design-validation pass — 5 latent design defects DEF-T1..T5 found and fixed in design+ledger before Task 5 code; resolved by D-027/D-028/D-029/TO-012) + **N-031 (2026-07-14 Task 5 REQ-2 increment: Token_Service issue/verify/expiry + hardening + real-crypto P-007/P-008) + N-032 (2026-07-14 VERIFIED DEFECT + root fix: FuxaAuthDb.transaction crashed on concurrent transactions on one connection — added in-process transaction queue) + **N-033 (2026-07-14 Task 5 REQ-3 increment: Refresh_Token_Store + Token_Service.refresh + P-015, real crypto — closes N-022 refresh-path gap; §02 service layer complete, API wiring is Task 13; suite 71 passing) + **N-034 (2026-07-14 VERIFIED LOOP HAZARD + fix: the save-time integrity-guard hook watched `decisions/*.md` yet its askAgent action was told to write `04-notes.md`/`00-INDEX.md` → self-retrigger loop; rewritten strictly read-only, version 2) + **N-035 (2026-07-14 Task 7: Authentication_Service implemented + verified; §01 reconciled to D-027 tokenVersion + canonical `get` lookup (DEF-A1/A2); suite 81 passing)**|
| `P-`   | 016 | P-013 (D-015) + P-014 (D-014/018) + P-015 (D-019) + P-016 (D-020 concurrency) added 2026-07-13 |
| `TASK-`| see tasks.md | |

## 3. Drift-incident log (append-only)

| Date | Incident | Root cause | Remediation |
|------|----------|-----------|-------------|
| 2026-07-13 | `03-tradeoffs.md` overwritten with a chat transcript (N-020) | No integrity manifest; whole-file overwrite of a ledger file went undetected | File rebuilt from cross-references; TO-003 quarantined; this manifest + GATES + steering + audit hook added |
| 2026-07-13 | Deep review found 11 design defects (N-010…N-019, N-021) present since design phase | Design/tasks generated without a defect-gate before implementation | Defect register (traceability §F) + gates (GATES.md) added; resolutions D-014…D-023 logged OPEN |
| 2026-07-13 | Two stale ledger annotations after their underlying state changed: 00-INDEX §2 still marked D-014…D-023 / DV-006…DV-008 "OPEN"; N-022 still claimed "deps absent" (N-024) | ON-EXIT protocol (§2/status refresh) not applied when the decisions were confirmed and when `npm install` was run | Corrected both to current state; recorded provenance in N-024; added an automatic save-time integrity guard |
| 2026-07-14 | G0 transfer audit found wrong-domain entries, non-monotonic/duplicate D headings, stale OPEN/G4/task summaries, and an embedded PAT in the Git remote (N-028) | Early entries predated the strict manifest; later phase transitions did not reconcile every derived status; handoff summaries were trusted without rerunning the full domain/order check | Local repair complete: remote cleaned, IDs/substance preserved while ledgers were canonicalized, derived status reconciled, Integrity Check passed, and full baseline passed 42 tests. External PAT revoke/rotate remains USER ACTION REQUIRED / UNVERIFIED |
| 2026-07-14 | Independent baseline re-run was 41 passing / 1 FAILING (not the handoff's "42 passing"): store metadata round-trip lost a `__proto__` key (P-003, seed-dependent → flaky suite) and `Object.assign`-on-parsed-JSON could reassign an object's prototype (N-029) | Reconstructing objects from JSON-parsed (untrusted) data with `[[Set]]` semantics triggers the `__proto__` accessor; no reserved-key hardening for `__proto__`; the handoff's baseline claim was not re-verified across seeds | Root fix D-026: `deserialize` strips `__proto__` at every depth + adapters compose with object-spread define-semantics; `__proto__` excluded from P-003/P-005 domain; deterministic strip tests added; suite now 47 passing, exit 0, stable across 4 runs |
| 2026-07-14 | Save-time integrity-guard hook was a self-trigger LOOP hazard (N-034): `fileEdited` on `decisions/*.md` + an `askAgent` action instructed to WRITE `04-notes.md`/`00-INDEX.md` (same pattern) → write re-fires the hook → infinite loop; also a per-turn burst | An automatic `fileEdited` hook was given write/remediation duties on the file domain it triggers on; it also contradicted the steering's "read-only, cannot loop" claim | Rewrote the hook to version 2: strictly READ-ONLY with an ABSOLUTE ANTI-LOOP RULE (never writes; STOP-and-report on failure; remediation in a separate turn). Reconciled with the steering contract |
| 2026-07-14 | `FuxaAuthDb.transaction()` crashed with "cannot start a transaction within a transaction" when two transactions overlapped on the single shared connection (N-032), surfaced by the D-030 concurrent-consume test | The atomicity design assumed `BEGIN IMMEDIATE` serializes writers — true across connections, false within one shared connection; `transaction()` had no in-process serialization | Root fix: in-process transaction queue in `FuxaAuthDb.transaction()` (each waits for the prior COMMIT/ROLLBACK before BEGIN; gate released in finally). `BEGIN IMMEDIATE` retained for cross-connection serialization. Verified by the concurrent-consume test + full suite 71 passing |
| 2026-07-14 | Pre-Task-5 design-validation of `design/02` found 5 latent design defects (DEF-T1..T5): `Identity` missing `tokenVersion`; infeasible `kid` overlap-rotation over FUXA's single secret; parallel `typ`/`type` claims; unnamed `iss`/`aud` settings; `metadata.tokenVersion` undefined + unsafe absent-value compare (legacy-token revocation bypass) (N-030) | Design text lagged its own §3 and the code interface stub; a hardening capability was specified beyond the substrate; cross-section claim/field inconsistencies were never reconciled | Fixed at the root in design + ledger BEFORE code: D-027 (tokenVersion end-to-end, default 0 + absent→0 coercion), D-028 (single `type` claim), D-029 (named iss/aud, validate-when-configured), TO-012 (kid Option A). Runtime verification owned by Task 5/8, PENDING |

## 4. Integrity Check (run at session start and before any phase transition)

For each file in §1: confirm it exists, contains all its required markers, and contains **no**
content from another file's domain. For each ID prefix in §2: confirm the sequence is monotonic
with no gaps except explicitly `RETIRED`/`QUARANTINED` tombstones, and that no ID is reused. If
any check fails, STOP and open an incident in §3 + `04-notes.md`.

> This check is intentionally simple enough to run by reading files (no tooling required), and is
> the exact check that would have caught N-020 the moment it happened.
