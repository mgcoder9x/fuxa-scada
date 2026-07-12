# Decision & Anti-Drift Ledger — auth-user-management

> **Purpose.** This folder is the *single source of truth* for every decision, deviation,
> trade-off, and fact that is NOT already captured verbatim in `requirements.md` /
> `design/` / `tasks.md`. It exists to prevent **drift** — the slow divergence between
> what was asked, what was designed, what was built, and what was tested.
>
> This ledger is **persistent and append-only**. It is written primarily for an AI agent
> to re-read at the start of every future session, and secondarily for a human to audit.
> Language: **English** (kept consistent with `requirements.md` so IDs and terms match
> exactly and are machine-greppable). The human-facing step-by-step guide lives in
> `../guide/` and is written in Vietnamese.

---

## 1. Files in this folder

| File | Answers the question | Rule |
|------|----------------------|------|
| `01-ai-decisions.md` | Decisions the AI made that the spec/user did **not** explicitly state | Every non-obvious choice must be logged here with a rationale |
| `02-deviations.md` | Where the AI **changed / expanded / narrowed** something vs. the user's original words | Any gap between literal request and delivered artifact is logged here |
| `03-tradeoffs.md` | Trade-offs weighed, options rejected, and **why** | Log the alternatives, not just the winner |
| `04-notes.md` | Anything the future AI/human *should know* (environment facts, risks, gotchas) | Facts only; mark anything unverified as `UNVERIFIED` |
| `traceability.md` | The **anti-drift engine**: bidirectional map REQ ⇄ DESIGN ⇄ TASK ⇄ TEST | Must be updated at every phase transition |

---

## 2. Stable ID scheme (the backbone of anti-drift)

Every artifact carries a **stable, immutable ID**. IDs are never reused or renumbered.
If something is dropped, its ID is marked `SUPERSEDED` or `RETIRED` — never deleted.

| Prefix | Meaning | Source of truth |
|--------|---------|-----------------|
| `REQ-<n>` | Requirement (matches `### Requirement n` in requirements.md) | requirements.md |
| `AC-<n>.<m>` | Acceptance criterion m of requirement n | requirements.md |
| `DES-<AREA>` | Design section (e.g. `DES-AUTH`, `DES-RBAC`) | design/ |
| `D-<nnn>` | AI decision | 01-ai-decisions.md |
| `DV-<nnn>` | Deviation | 02-deviations.md |
| `TO-<nnn>` | Trade-off | 03-tradeoffs.md |
| `N-<nnn>` | Note | 04-notes.md |
| `P-<nnn>` | Correctness property (PBT) | design/ + tests |
| `TASK-<n>` | Implementation task | tasks.md |

---

## 3. Entry schema (copy for every new entry)

```
### <ID>: <short title>
- Date: YYYY-MM-DD
- Phase: Requirements | Design | Tasks | Implementation
- Status: Active | Superseded by <ID> | Retired | OPEN (needs user confirmation)
- Links: REQ-x, AC-x.y, DES-x, TASK-x   (whatever applies)
- Context: <what situation forced this entry>
- Statement: <the decision / deviation / trade-off / note itself>
- Rationale: <the precise, factual reason — no speculation>
- Alternatives considered: <options + why rejected>  (required for TO-*, recommended for D-*)
- Impact / Risk: <consequence, and residual risk if any>
- Verification: <how a reviewer can later confirm this is still honored>
```

## 4. The anti-drift protocol (MUST run at every phase transition)

Before moving Requirements → Design → Tasks → Implementation, the agent MUST:

1. **Re-read this whole folder.** No design/coding decision may contradict an `Active` entry
   without first logging a `SUPERSEDED` transition and stating why.
2. **Reconcile `traceability.md`.** Every `REQ-*`/`AC-*` must map forward to at least one
   `DES-*`; every `DES-*` must map back to at least one `REQ-*`. Orphans on either side are
   drift and must be resolved (either add the missing artifact, or log a deviation).
3. **Resolve all `OPEN` entries** or explicitly carry them forward with the user's awareness.
4. **Verify, don't assume.** Any statement about the FUXA codebase or environment must be
   backed by a file read or command output, cited in the entry. Otherwise mark `UNVERIFIED`.
5. **Root-cause rule.** When fixing a defect, add/adjust the entry that explains the *root
   cause*; a fix that only addresses a symptom is itself logged as a risk in `04-notes.md`.

## 5. How to use with an AI in a future session

Start the session by instructing the agent: *"Read
`.kiro/specs/auth-user-management/decisions/` in full before doing anything, then run the
anti-drift protocol in section 4."* This reloads all prior reasoning and prevents the agent
from silently re-deciding things differently (the most common source of drift).
