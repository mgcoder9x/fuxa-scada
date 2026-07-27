---
inclusion: fileMatch
fileMatchPattern: '.kiro/specs/auth-user-management/**'
---

# ANTI-DRIFT PROTOCOL — auth-user-management (auto-loaded when working on this spec)

You are working inside the `auth-user-management` spec. This spec has a persistent decision ledger
and a defect gate. **Obey the following before and while editing any spec artifact.** These rules
exist because a real integrity incident (a ledger file was overwritten, N-020) and 11 latent design
defects (N-010…N-021) were found; do not let either recur.

## MANDATORY on entry
1. Read `.kiro/specs/auth-user-management/decisions/00-INDEX.md` and run its §4 Integrity Check.
2. Read the whole `decisions/` folder, then run `decisions/README.md` §4 anti-drift protocol.
3. Obey `decisions/GATES.md`. **Current gate state (updated 2026-07-13, verified on disk — N-024):
   G0–G4 PASSED.** All CRITICAL/HIGH/MEDIUM defects (N-010…N-019, N-021) are RESOLVED; DV-006/007/008
   are Active (CONFIRMED); the guide is reconciled; traceability §D is populated; the Integrity Check
   passes. **Implementation is UNBLOCKED and proceeds under gate G5 (per-task Definition of Done).**
   For each task: (a) code MUST match the *corrected* design section it cites and touch FUXA core
   only through the D-003 seams; (b) tests MUST run green, incl. ≥100-iter property tests and the
   new concurrency/security tests; (c) flip the traceability §D row to `implemented`/`tested`;
   (d) log any newly-discovered deviation (`N-*`/`DV-*`) BEFORE merging — never silently.
   **Do NOT reopen a RESOLVED defect, and do NOT write code that contradicts a corrected design
   section or an `Active (CONFIRMED)` decision.** (Deps are installed — N-022 RESOLVED/N-023 — so the
   previously-deferred runtime tests are runnable and should be run to close §D rows.)

## HARD RULES (never violate silently)
- **Ledger files are append-only.** Never overwrite `decisions/01-ai-decisions.md`,
  `02-deviations.md`, `03-tradeoffs.md`, `04-notes.md`, or `traceability.md` wholesale. Add entries;
  mark superseded ones `SUPERSEDED`/`RETIRED`. Never delete an ID; never reuse one (respect the
  high-water marks in `00-INDEX.md` §2). `TO-003` is QUARANTINED — do not reuse it.
- **No fabrication, no speculation.** Every claim about FUXA source/behavior must be backed by a
  file read or command output, cited. Otherwise mark `UNVERIFIED`. If content is lost, reconstruct
  only from verifiable cross-references and say so; never invent it.
- **Fix the root cause, not the leaf.** When resolving a defect, edit the design/requirement that
  causes it and flip the owning `D-*`/`DV-*` from `OPEN` to `Active (CONFIRMED)` with the user's
  approval. A symptom-only patch must itself be logged as a risk in `04-notes.md`.
- **The guide is non-normative.** `guide/*` must follow the corrected design. If the guide and
  design disagree, the design wins. The guides were **reconciled 2026-07-13** ("⚠️ ĐỐI CHIẾU"
  banners added to every affected guide + `guide/README.md` table, overriding the old
  N-013/N-014/N-015/etc. instructions); still, if any residual conflict is found, follow the design
  and fix the guide.
- **One step at a time.** The user approves resolutions one at a time in the `GATES.md` Roadmap
  order (Wave A → B → C). Do not batch-apply design changes without per-item approval. State the
  precise, factual reason for each recommendation.

## ON EXIT (before ending a turn that changed anything)
- Update the relevant ledger entry + `traceability.md` (§D/§F) + `00-INDEX.md` §2 high-water marks.
- If you discovered a new defect or made a new decision, log it (`N-*`/`D-*`/`DV-*`/`TO-*`) before finishing.
- Re-run the Integrity Check if you touched a ledger file.

## Layered anti-drift defense (how drift is caught, in depth order)

Drift is prevented by five overlapping layers so no single missed step lets it through:

1. **This steering file (auto-loaded).** Injected whenever a `auth-user-management/**` file is in
   context — the rules above are always present.
2. **`00-INDEX.md` integrity manifest + §4 Integrity Check.** Declares the required markers and ID
   high-water marks for every file; the check is runnable by reading files, no tooling needed.
3. **`GATES.md` phase gates G0–G5.** No phase advances until its gate passes; §F defects gate code.
4. **Automatic save-time guard hook — `Auth Module — Save-Time Integrity Guard` (`fileEdited`).**
   Runs a fast, READ-ONLY integrity check whenever any `decisions/**`, `design/**`,
   `requirements.md`, or `tasks.md` file is saved. This closes the exact gap that hid **N-020** (a
   ledger file silently overwritten): the check now fires at the moment of the edit. It is
   read-only (reports only; edits nothing) so it cannot loop; on a FAIL it stops and asks the user.
5. **On-demand deep audit hook — `Auth Module — Anti-Drift Audit` (`userTriggered`).** The full
   manifest + high-water + orphan + defect-register audit, run manually before a phase transition.
6. **MECHANICAL gate — `tools/anti-drift-check.js` + the `Auth Module — Anti-Drift Gate` hook
   (`fileEdited` → `runCommand`), added 2026-07-27 (N-095).** Layers 1–5 all depend on an agent or a
   human *choosing to look*; every drift that actually happened (N-020 ledger overwrite, N-060
   duplicate id, N-081 cross-machine re-derivation, N-094 stale `P-` high-water + six decisions that
   shipped with no plan/traceability row) got through because the looking did not happen at the right
   moment. This layer decides the same questions deterministically and **exits non-zero**, so the
   answer no longer depends on remembering. Run it yourself at any time:
   `node .kiro/specs/auth-user-management/tools/anti-drift-check.js`.
   It enforces: §1 markers per file · §2 high-water EQUALS the ledger's real maximum · ids unique +
   gapless · **every `D-*` reachable from `traceability.md` or `tasks.md` with NO exemption list** ·
   the highest `P-*` referenced by design/tests ≤ the manifest high-water · no chat-transcript markers
   inside a ledger file · `TO-003` still quarantined. It is READ-ONLY (cannot loop, cf. N-034), and it
   was verified to actually FAIL on injected versions of three real drift modes — a checker that
   cannot fail is worthless. **If it reports FAIL, stop and fix the ledger/traceability before
   continuing.** What it deliberately does NOT do: judge whether a decision is *good*, whether a
   traced test asserts anything real, or run the suites — a green gate is not proof of correctness.

**Golden rule restated:** ledger files are append-only; fix the root cause; verify every FUXA claim
against source; one step at a time with a precise, factual reason. When in doubt, STOP and ask —
never silently re-decide.
