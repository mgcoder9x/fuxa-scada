# GATES — phase gates, Definition of Done, and the resolution roadmap

> **Purpose.** Turn the anti-drift rules into hard, checkable gates. No phase may advance until its
> gate passes. This is the enforcement companion to `00-INDEX.md` (integrity) and `README.md` §4
> (protocol). Written for an AI agent to obey literally.

---

## Gates

### G0 — Session start (every session, before any edit)
- [ ] Read `00-INDEX.md` and run its §4 Integrity Check.
- [ ] Read all of `decisions/` in full.
- [ ] Run `README.md` §4 anti-drift protocol.
- [ ] Confirm no `OPEN` decision is being silently overridden.

### G1 — Requirements → Design
- [ ] Every `REQ-*`/`AC-*` maps forward to ≥1 `DES-*` (traceability §B). No orphans.
- [ ] All requirement-level `OPEN` deviations (currently **DV-006, DV-007, DV-008**) are either
      approved (then edit `requirements.md`) or explicitly deferred with user awareness.

### G2 — Design → Design-complete (NEW gate added 2026-07-13) — ✅ PASSED
- [x] **All CRITICAL defects in traceability §F are `RESOLVED`**: **N-010, N-011, N-012, N-013,
      N-014** (via D-016, D-015, D-017, D-018, D-014). "Resolved" = the relevant `design/*.md` (and
      `requirements.md` if a DV applies) edited to remove the defect, user-approved, and the
      contradicting text corrected (e.g. §03 §2.2's false P-002 claim; §06 §5.2/§5.4).
- [x] Each resolution's decision entry flipped `OPEN → Active (CONFIRMED)` in `01-ai-decisions.md`.
- [x] No design section contradicts another (re-check §05 §4.1 vs §12 §2.1 after D-015).

### G3 — Design → Tasks (populate the missing map) — ✅ PASSED
- [x] traceability **§D is populated**: every `DES-*` → its `TASK-*` → its test/property (closes N-021).
- [x] Every property `P-001…P-016` (incl. new P-013/P-014/P-015/P-016 from D-015/D-014+D-018/D-019/D-020) has a task.
- [x] `tasks.md` reordered/added so CRITICAL/HIGH resolutions have tasks BEFORE dependent code.

### G4 — Tasks → Implementation (the hard stop) — ✅ PASSED
- [x] **G2 passed** (all CRITICAL resolved) AND all **HIGH** defects (N-015, N-016, N-017, N-018)
      are resolved (D-019/D-020/D-021/D-022).
- [x] The guide (`guide/*`) is reconciled to the corrected design (reconciliation banners added to
      every affected guide + `guide/README.md` table; the defect encodings are explicitly overridden).
- [x] Integrity Check (00-INDEX §4) passes.

### G5 — Implementation → Done (per task)
- [ ] Code matches the (corrected) design section it cites; no FUXA core edit outside the D-003 seams.
- [ ] Tests run green, including the property tests (≥100 iters) and the new concurrency/security tests.
- [ ] traceability §D row for the task flipped to `implemented`/`tested`.
- [ ] Any deviation discovered while coding is logged (`DV-*`/`N-*`) BEFORE merging — never silently.

---

## Definition of Done (commercial-grade, for the whole module)

1. No `OPEN` CRITICAL/HIGH defect remains in traceability §F.
2. No security/integration test marked "optional" for the CRITICAL paths (auth, RBAC, bootstrap,
   persistence). Property + concurrency + revocation tests are mandatory.
3. traceability §A–§G fully populated and self-consistent (no orphans, §D complete).
4. Integrity Check passes; ID high-water marks in `00-INDEX.md` §2 current.
5. Guide reconciled to the corrected design.

---

## Roadmap (the step-by-step order the user approves one item at a time)

> Rationale for ordering: fix **foundational/authority** defects first (they change interfaces the
> rest depends on), then session/credential, then hardening. Fixing a leaf before its root would be
> rework — which the user explicitly forbade ("fix tận gốc").

**Wave A — CRITICAL, must precede any code (G2). Ordered root-first / bottom-up: settle the
lowest-layer *contracts* before the *wiring* that depends on them (matches tasks.md's bottom-up
philosophy and avoids rework):**
1. **D-016** persistence atomicity (N-010) — the store write contract is the lowest layer; every service above it depends on how a user row is written atomically. Settle it first.
2. **D-015** live session authority (N-011) — defines how every protected request builds identity (roles/groups/existence/revocation); the authorization contract the API wiring will call.
3. **D-017 + DV-007** password domain / P-002 (N-012) — corrects a *false* correctness property and the hashing contract before any hashing test or hasher code is written.
4. **D-014** router cutover (N-014) — composition-root *wiring* that makes the module authoritative; depends on the service/store contracts above being settled, so it comes after them.
5. **D-018** rotatePassword endpoint (N-013) — API wiring paired with D-014 (same composition root); unblocks the bootstrap gate.

> Note: D-014 was moved from 1st to 4th on 2026-07-13 to match this file's own stated rationale
> ("fix foundational/interface-defining defects first"); a router mount is wiring, not a contract.

**Wave B — HIGH, before implementing the affected area (G4):**
6. **D-019** refresh rotation + reuse detection (N-015).
7. **D-020** atomic concurrency invariants + concurrency property (N-016).
8. **D-021** JWT hardening (N-017).
9. **D-022** secure bootstrap enrollment (N-018).

**Wave C — MEDIUM, scheduled:**
10. **D-023** dedicated audit sink + **N-019** brute-force shared store / **DV-008** adaptive throttle.
11. **DV-006** enumeration hardening (uniform 401).
12. **G3** populate traceability §D; reconcile the guide (G4).

**Current position (updated 2026-07-13):**
- ✅ **Item 1 — D-016 (persistence atomicity, N-010): RESOLVED.** `design/06` §5.2/§5.3/§5.4 + §2.3 edited (option a); ledger synced.
- ✅ **Item 2 — D-015 (live session authority, N-011): RESOLVED.** `design/05` §4.1 (Identity from live record) + `design/02` §3 (`tokenVersion`, roles=compat-only) edited; P-013 added; ledger synced.
- ✅ **Item 3 — D-017 + DV-007 (password domain / P-002, N-012): RESOLVED.** `design/03` §2.2/§7/§8.1/§9 corrected + bounded; `design.md` Property 2 corrected; `requirements.md` AC-4.5 refined + AC-4.6/AC-4.7 added; `design/04` §2.3 enforcement note; ledger synced.
- ✅ **Item 4 — D-014 (router cutover, N-014): RESOLVED.** `design.md` "API Composition Root & Cutover Strategy" (SUPERSEDE); P-014 added.
- ✅ **Item 5 — D-018 (rotate endpoint, N-013): RESOLVED.** `POST /api/account/rotate-password` documented in `design.md` + `design/12` §4.1.

### 🎉 GATE G2 PASSED — all 5 CRITICAL defects RESOLVED (N-010, N-011, N-012, N-013, N-014)
Wave A complete. Design no longer contains a CRITICAL defect. Implementation is still blocked by
**G4** until the HIGH defects (N-015, N-016, N-017, N-018) are resolved or explicitly scheduled,
and the guide (`guide/*`) is reconciled to the corrected design.

- ✅ **Item 6 — D-019 (refresh-token rotation + reuse detection, N-015): RESOLVED.** `design/02` §6 rewritten (stateful `Refresh_Token_Store`, RFC 9700 reuse detection, family revocation); P-015 added.
- ✅ **Item 7 — D-020 (atomic concurrency invariants, N-016): RESOLVED.** create → plain INSERT (atomic dup), last-admin → BEGIN IMMEDIATE (`design/04` §3.2/§6.5 + `design/06` §5.4); P-016 added.
- ✅ **Item 8 — D-021 (JWT hardening, N-017): RESOLVED.** `design/02` §3/§5/§7 — alg pinning + `iss/aud/sub/jti/typ` + `kid` rotation.
- ✅ **Item 9 — D-022 (secure bootstrap enrollment channel, N-018): RESOLVED.** `design/12` §3.2/§3.4/§8/§10.4/§11 rewritten: secret delivered via secure enrollment channel (interactive CLI default + one-time hashed-at-rest single-use enrollment token), never to `fuxa.log`/console; new §10.4 security test; ledger synced.

### 🎉 WAVE B COMPLETE — all 4 HIGH defects RESOLVED (N-015, N-016, N-017, N-018)
G2 (CRITICAL) + all Wave B HIGH defects are now resolved. **G4's HIGH-defect condition is
satisfied.** G4 still requires the two remaining conditions before implementation may begin:
(i) the guide (`guide/*`) reconciled to the corrected design, and (ii) the Integrity Check passing
(currently passing). These land in Wave C together with G3 (§D population).

- ✅ **Item 10 — D-023 (dedicated audit sink) + N-019 / DV-008 (brute-force): RESOLVED.** `design/09` §2.2/§6.2/§7/§8/§10.4 — dedicated append-only audit sink (own rotation), richer optional fields, audit-write failure as health signal, optional hash-chain/WORM. `requirements.md` REQ-15 — AC-15.2 adaptive throttling, AC-15.4/15.5 reworded, **new AC-15.6** (shared-store consistency + bounded interval). `design/10` — pluggable `BruteForceStore`, adaptive backoff config, monotonic clock, P-012 refined (now validates AC-15.1–15.6). N-019 RESOLVED.
- ✅ **Item 11 — DV-006 (enumeration hardening — uniform 401 for unknown user): RESOLVED.** `requirements.md` AC-1.2/AC-1.3/AC-8.4 + `design/01`/`design.md`/`design/03`/`design/04` synced (unknown-user and bad-password now return an identical 401 with dummy-hash timing parity; authenticated admin-CRUD `user_not_found` stays 404).

### 🎉 ALL DEFECT RESOLUTIONS COMPLETE — every CRITICAL/HIGH/MEDIUM defect + requirement deviation is RESOLVED
Wave A + B + C defect work is done (N-010…N-019 resolved; DV-006/DV-007/DV-008 confirmed; D-014…D-023 all Active).
- ✅ **Item 12 — G3: RESOLVED.** `traceability.md` §D populated (every DES-* → task(s) → test(s); all P-001…P-016 own a task); `tasks.md` extended with the deep-review resolution tasks (2.8/2.9/2.10, 5.6/5.7/5.8, 6.1 refined, 7.1 refined, 8.2/8.6, 9.1 refined, 11.1/11.4, 12.1/12.7, 13.1/13.5/13.7/13.8) and the wave graph updated; **N-021 RESOLVED**.
- ✅ **Guide reconciliation: DONE.** `guide/README.md` gained a reconciliation table; every affected guide (02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13) carries a "⚠️ ĐỐI CHIẾU" banner overriding the defective instructions and pointing at the corrected design.

### ✅✅ GATE G4 PASSED — implementation is UNBLOCKED
All CRITICAL/HIGH/MEDIUM defects RESOLVED; guide reconciled; Integrity Check passes; traceability §D populated. Implementation of `tasks.md` (per the wave graph) may now begin under gate **G5** (per-task DoD). No `OPEN` CRITICAL/HIGH defect remains.
- Remaining discipline for each task: G5 DoD — code matches corrected design, tests green (incl. ≥100-iter properties + concurrency/security tests), flip the §D row to `implemented`/`tested`, log any new deviation before merging.
- Edited so far: `design/06`, `design/05`, `design/02`, `design/03`, `design/04` (§2.3 + §6.4/AC-8.4), `design/12` (§4.1 + §3.2/§3.4/§8/§10.4/§11), `design/09` (§2.2/§6.2/§7/§8/§10.4/§12), `design/10` (§2.1/§2.2/§3/§5/§6/§8/§9/§10), `design/01` (§2.2/§3/§4/§7/§8/§9), `design.md` (Error-Handling table), `requirements.md` (REQ-1, REQ-4, REQ-8, REQ-15).
