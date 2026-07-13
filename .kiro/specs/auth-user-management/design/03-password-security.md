# Design Section 03 — Password Security · `DES-PWD`

> **Section role: DETAILED DESIGN.** This file details the `Password_Hasher` component —
> salted one-way password hashing and verification behind the module's **Hash seam** (REQ-4).
> Read [`../design.md`](../design.md) (the **master map**) first — it owns the layered
> architecture, the adapter seams, the Error Handling status/shape table, the Security
> Posture, and the module-boundary rules (D-003, AC-16.*). This section refines those
> decisions for REQ-4 only; it does not restate or override them.
>
> **Covers:** REQ-4 (Password Security), acceptance criteria AC-4.1 … AC-4.5.
> **Owns properties:** **P-001** and **P-002** (formalized in full in
> [§7](#7-correctness-properties)). It is *referenced by*
> [`01-authentication.md`](./01-authentication.md) for the sole password-compare site
> (AC-1.5) and by [`04-user-management.md`](./04-user-management.md) for the create/update
> hashing flow (AC-5.4, AC-7.2); it *cross-references* [`06-persistence-and-serialization.md`](./06-persistence-and-serialization.md)
> for the persistence invariant (AC-4.2) and its read-path counterpart (REQ-6 AC-6.2).
>
> **Grounding.** Every FUXA claim below was verified by reading the actual source:
> `server/runtime/users/usrstorage.js` and `server/api/auth/index.js`. Exact calls are cited
> inline. Decisions/trade-offs/notes referenced as `D-***` / `TO-***` / `N-***` live in
> [`../decisions/`](../decisions/) and
> [`../decisions/traceability.md`](../decisions/traceability.md).

---

## 1. Purpose & Scope

This section specifies **how a plaintext password is converted into a salted, one-way hash and
how a plaintext is verified against a stored hash** — the design of the module's
`Password_Hasher` component and its `bcryptjs` adapter (the **Hash seam**).

Scope, precisely:

- **AC-4.1** — hashing is salted and one-way and happens *before* the `User_Store` persists a
  created or password-changed record.
- **AC-4.2** — only the hash is persisted; the plaintext is never persisted (cross-referenced
  to the read-path exclusion in REQ-6 AC-6.2).
- **AC-4.3 / AC-4.4** — the hasher's positive correctness: a hash verifies its own plaintext,
  and two independently produced hashes of the same plaintext each verify (⇒ **P-001**).
- **AC-4.5** — the hasher's negative correctness: a hash of one plaintext never verifies a
  different plaintext (⇒ **P-002**).

What this section **delegates** and only references (see [§5](#5-collaborators--boundaries)):

- the *sign-in* password-compare call site and its outcome→HTTP mapping →
  [`01-authentication.md`](./01-authentication.md) (REQ-1, AC-1.5);
- the *create/update* flows that call `hash(...)` before writing →
  [`04-user-management.md`](./04-user-management.md) (REQ-5 AC-5.4, REQ-7 AC-7.2/7.3);
- the *persistence* invariant and read-path hash exclusion →
  [`06-persistence-and-serialization.md`](./06-persistence-and-serialization.md) (AC-4.2, REQ-6 AC-6.2).

### Where it sits in the layered architecture

Per the master map's four layers (AC-16.1, **D-001**), `Password_Hasher` is a **Service-layer
component** reached by the `Authentication_Service` (verification during sign-in) and the
`User_Service` (hashing during create/update). It reaches FUXA only through the **Hash seam**
adapter (**D-003**):

- **Service layer** — `server/auth-management/services/password-hasher.js` exposes the
  `Password_Hasher` interface (`hash`, `verify`). It contains no FUXA coupling and no direct
  `bcryptjs` import; it depends only on the Hash-seam adapter injected at construction.
- **Adapter seam** — `server/auth-management/adapters/fuxa-bcrypt.adapter.js`
  (`BcryptHasherAdapter`) is the *only* component that imports `bcryptjs`. It wraps
  `bcrypt.hashSync` / `bcrypt.compareSync`, confining the hashing library to one file so future
  FUXA upgrades stay low-conflict (**N-001**) and so the algorithm can be swapped without
  changing the `Password_Hasher` interface (AC-16.5).

> **Boundary note (D-003).** FUXA today performs hashing and comparison in **two different
> places, inline, with no shared abstraction**: it hashes in the store
> (`server/runtime/users/usrstorage.js` — `bcrypt.hashSync(pwd, 10)` in `setUser`, and
> `bcrypt.hashSync('123456', 10)` in `setDefault`) and compares in the auth route
> (`server/api/auth/index.js` — `bcrypt.compareSync(req.body.password, userInfo[0].password)`).
> This module **does not edit those files in place**; it re-expresses both operations behind a
> single `Password_Hasher` boundary so there is exactly one hashing site and exactly one
> comparison site, both PBT-testable.

---

## 2. `Password_Hasher` Interface & Contract

The master map lists the capability as `hash(plaintext)`, `verify(plaintext, hash)` (AC-16.2).
This section fixes the precise, testable shapes.

### 2.1 Operations

```
hash(plaintext: string): string
  // Produces a salted, one-way bcrypt hash string of `plaintext` (AC-4.1).
  // A fresh random salt is generated per call, so two calls with the same input
  // return two DIFFERENT hash strings that each verify (AC-4.3).
  // Total function over all string inputs (including empty, unicode, and long strings).

verify(plaintext: string, hash: string): boolean
  // Returns true iff `hash` was produced from `plaintext` (AC-4.4);
  // returns false when `hash` was produced from any different plaintext (AC-4.5).
  // Never throws for a well-formed bcrypt hash string; a malformed/empty hash returns false.
```

### 2.2 Contract details

- **Salted & one-way (AC-4.1).** `hash` returns a bcrypt digest of the form
  `$2<variant>$<cost>$<22-char-salt><31-char-checksum>`. The salt is embedded in the output, so
  no separate salt storage is needed, and the plaintext cannot be recovered from the hash
  (one-way).
- **Per-hash random salt (AC-4.3).** Each `hash` call draws a fresh random salt. Consequently
  `hash(p) !== hash(p)` for the string form, yet `verify(p, hash(p))` is true in both cases —
  because `verify` re-derives the checksum using the salt *embedded in the candidate hash*, not
  a globally fixed salt. This is precisely what makes AC-4.3 hold and what **P-001** asserts.
- **Total, non-throwing `hash`.** `hash` accepts any string, including the empty string,
  all-whitespace strings, very long strings, and arbitrary Unicode. (Input *policy* — e.g. a
  minimum password length — is a `User_Service` validation concern, not the hasher's; the
  hasher must faithfully hash whatever plaintext it is given.)
- **Defensive `verify`.** `verify` returns `false` (never throws) when handed a `null`, empty,
  or structurally malformed hash string, so a corrupt stored value degrades to a failed match
  rather than crashing the sign-in path. This mirrors FUXA's guard
  `userInfo && userInfo.length && userInfo[0].password` before it calls `compareSync`
  (verified in `server/api/auth/index.js`).
- **Bounded input domain (bcrypt 72-byte truncation) — corrected 2026-07-13 (D-017, fixes N-012).**
  bcrypt hashes only the **first 72 bytes** of its input. This is **not** harmless for the rejection
  property: two *distinct* plaintexts that share their first 72 UTF-8 bytes hash identically, so
  `verify(B, hash(A))` would be **true** for such a pair — which would violate a naive P-002. (The
  earlier claim here that truncation left P-002 "unaffected" was **wrong** and is retracted.) The
  module therefore **bounds the password domain**: `User_Service` **rejects** any password whose
  UTF-8 length exceeds **72 bytes** with a validation error (AC-4.6) *before* `hash` is called, so no
  two accepted passwords can collide under truncation, and P-002 is stated and proven **over that
  bounded domain** ([§7](#7-correctness-properties)). 72 bytes ≈ 72 ASCII characters, comfortably
  above the NIST SP 800-63B minimum. `hash` itself stays total (never throws); the length rule is a
  **service-layer validation policy**, not a hasher behavior.
- **Hash-scheme versioning (future-proofing, D-017).** bcrypt digests are self-describing
  (`$2b$<cost>$…`); the design reserves a `hashScheme` concept so a later migration to Argon2id
  (TO-007 option 3) can be introduced **without breaking verification** of existing bcrypt hashes —
  `verify` dispatches on the stored scheme. No migration is performed now; this only keeps the door
  open non-breakingly.

---

## 3. Hashing Design

### 3.1 Salted one-way hashing via bcrypt

The Hash seam uses `bcryptjs` — the exact library FUXA already ships and uses (verified imports
in both `server/runtime/users/usrstorage.js` and `server/api/auth/index.js`), reused rather than
replaced per **D-002 / TO-001**. bcrypt is an adaptive, salted password hash: each digest embeds
a random 128-bit salt and a cost factor, and verification re-runs the key-derivation using the
salt embedded in the candidate digest.

- **`hash(plaintext)`** → `BcryptHasherAdapter.hashSync(plaintext, cost)` → a self-describing
  digest string. The random salt is generated internally by `bcryptjs` for each call (the
  numeric-rounds form `bcrypt.hashSync(pwd, cost)` generates a fresh salt every invocation —
  the same form FUXA uses today).
- **`verify(plaintext, hash)`** → `BcryptHasherAdapter.compareSync(plaintext, hash)` → boolean.
  This is the single relocation of the comparison FUXA performs inline at
  `bcrypt.compareSync(req.body.password, userInfo[0].password)` (verified,
  `server/api/auth/index.js`).

### 3.2 Why AC-4.3 requires two different-but-both-valid hashes (per-hash random salt)

AC-4.3 mandates that hashing the *same* plaintext twice yields two hashes that **each** verify.
This is only possible with a **per-hash random salt**:

- If the hasher used a *fixed* salt, `hash(p)` would be deterministic and the two hashes would
  be identical — which would trivially satisfy "each verifies" but would defeat the security
  purpose of salting (identical stored hashes reveal identical passwords across users, and
  enable precomputation/rainbow attacks).
- With a *random per-call* salt, the two digests differ in their salt segment (`h1 !== h2`),
  yet both verify against `p` because each digest carries the salt needed to re-derive its own
  checksum. AC-4.3 therefore encodes a **security invariant** (salts are random per hash), not
  merely a correctness convenience. **P-001** captures both halves: both hashes verify, and (as
  a random-salt witness) the two hash strings differ.

### 3.3 Cost / work factor decision

**FUXA's current approach (verified).** FUXA hard-codes a bcrypt cost of **10** everywhere it
hashes: `bcrypt.hashSync(pwd, 10)` in `usrstorage.setUser` and `bcrypt.hashSync('123456', 10)`
in `usrstorage.setDefault`. (Cost 10 ⇒ 2¹⁰ = 1024 key-derivation rounds.)

**Decision (D-002 continuation).** The `Password_Hasher` adopts a **configurable cost factor
with a secure default that is ≥ FUXA's current 10**, resolved once at seam construction:

- **Default cost = 12** for the module's own hashing. Rationale: 12 (2¹² = 4096 rounds) is a
  widely recommended contemporary bcrypt work factor that keeps a single hash in the tens of
  milliseconds on server hardware — a meaningful brute-force cost increase over 10 while
  remaining well within acceptable sign-in latency. Choosing ≥ FUXA's 10 guarantees that hashes
  the module produces are no weaker than existing FUXA hashes.
- **Configurable** via a single setting (proposed `settings.auth.bcryptCost`) so operators can
  tune cost to their hardware without code changes; an unset value resolves to the default 12.
- **Interoperable with existing FUXA hashes.** Because the cost is embedded in every bcrypt
  digest, `verify` reads the cost from the *stored* hash and validates correctly regardless of
  the cost that produced it. Existing FUXA-created hashes (cost 10) continue to verify unchanged
  after this module is introduced — no migration is required for verification to work.

> **Test-time cost.** Property tests ([§8](#8-testing-notes-fast-check-strategy)) run the hasher
> at a **reduced cost factor** (e.g. 4, bcrypt's minimum) so 100+ iterations stay fast. The
> reduced cost is a test-harness parameter only; it does not change the properties being proven
> (P-001/P-002 hold at every valid cost because cost is embedded in the digest).

### 3.4 Where hashing occurs in the create/update flows (AC-4.1)

AC-4.1 requires hashing to happen **before** the store persists a created or password-changed
record. In this module the ordering is enforced in the **Service layer**, upstream of the store:

- **Create (REQ-5, AC-5.4)** and **Update-with-new-password (REQ-7, AC-7.2)** — the
  `User_Service` calls `Password_Hasher.hash(plaintext)` and forwards **only** the resulting
  hash to `User_Store`; the plaintext is never handed to the store. When an update omits the
  password (AC-7.3), the service retains the existing stored hash and does not call `hash`.
- These flows and their tests are **owned by** [`04-user-management.md`](./04-user-management.md);
  this section supplies the `hash()` contract they depend on. This ordering supersedes FUXA's
  current arrangement, where hashing lives *inside* the store (`usrstorage.setUser` hashes with
  `bcrypt.hashSync(pwd, 10)`); the module lifts hashing up into the service so the store adapter
  receives an already-hashed value and never sees plaintext (AC-16.5 boundary discipline).

---

## 4. Persistence Rule (AC-4.2)

**Only the hash is persisted; the plaintext is never persisted.** Because hashing occurs in the
service layer *before* the store write ([§3.4](#34-where-hashing-occurs-in-the-createupdate-flows-ac-41)),
the value that reaches `User_Store` is already a one-way bcrypt digest. The store therefore has
no plaintext to persist and no code path that would write one.

- **Write path.** The `User_Record` persisted via the FUXA store shape
  `{ username, fullname, password, groups, info }` (verified in `usrstorage.js`) carries a
  bcrypt digest in its `password` column — never a plaintext. This is the store-side counterpart
  of the service-side ordering guarantee.
- **Read path (cross-reference, REQ-6 AC-6.2).** The `User_Service` **excludes** the password
  hash from any returned `User_Record` (AC-6.2). So the hash is written but never returned to
  callers, and the plaintext is neither written nor returned. The read-path exclusion is
  **owned by** [`06-persistence-and-serialization.md`](./06-persistence-and-serialization.md) /
  REQ-6; it is referenced here only to complete the "no plaintext, no exposed hash" picture.
- **Ownership.** The persist-only-hash invariant and its verification are **owned by**
  [`06-persistence-and-serialization.md`](./06-persistence-and-serialization.md). This section
  guarantees the *precondition* (the store receives a hash, not a plaintext); section 06
  guarantees the *store behavior* (it writes exactly that, and read excludes it).

---

## 5. Supporting AC-1.5 — the sole comparison site

AC-1.5 requires the `Authentication_Service` to **delegate password comparison to
`Password_Hasher` and never compare plaintext directly.** This section provides the single
`verify(plaintext, hash)` capability that makes that possible; the *structural enforcement* in
the sign-in path (service holds no compare capability of its own, plaintext discarded after one
`verify` call) is **owned by** [`01-authentication.md`](./01-authentication.md) §5 and is not
duplicated here.

The key facts this section is responsible for:

- `Password_Hasher.verify` is the **only** function in the module that calls
  `bcrypt.compareSync` (via the Hash seam). It relocates FUXA's inline
  `bcrypt.compareSync(req.body.password, userInfo[0].password)` (verified,
  `server/api/auth/index.js`) behind the seam.
- Its correctness — that `verify` accepts the right plaintext and rejects wrong ones — is
  exactly **P-001** and **P-002**. The sign-in path in section 01 *relies on* these properties
  for the correctness of its `success` vs `bad_password` decision but does not re-assert them.

---

## 6. Security Posture (passwords-specific)

Refines the master map's **Security Posture** for the `Password_Hasher`:

- **No plaintext logging.** Neither the `Password_Hasher` nor the Hash seam logs the plaintext,
  and the plaintext is not included in any thrown error. Callers sanitize plaintext and hash out
  of audit events before logging (AC-14.5, master-map Security Posture). The hasher holds no
  reference to the plaintext after the single `hash`/`verify` call returns.
- **Cost factor vs latency.** The cost factor
  ([§3.3](#33-cost--work-factor-decision)) is the deliberate CPU-cost knob: higher cost slows an
  offline brute-force attack proportionally but also raises sign-in latency. The default of 12
  targets tens of milliseconds per hash on server hardware — a security improvement over FUXA's
  current 10 without a perceptible sign-in delay. Operators may raise it as hardware improves.
- **Upgrade-on-verify (rehash) consideration.** Because the cost is embedded in each stored
  digest, the module can detect a stored hash whose cost is **below** the current configured
  cost during a *successful* `verify` and opportunistically re-hash the plaintext at the new
  cost while it is legitimately in hand, then persist the upgraded hash via the normal update
  flow. This lets legacy FUXA hashes (cost 10) migrate to the module default (cost 12) without a
  bulk migration and without ever storing plaintext. This is an **optional enhancement**; it is
  noted here as a design affordance and, if adopted, its trigger lives in the `User_Service`
  update flow (section 04), never in the store. It does not affect P-001/P-002.
- **Timing considerations of compare.** bcrypt's `compareSync` compares the derived checksum in
  constant time with respect to the checksum bytes, so `verify` does not leak how many leading
  characters matched. Since DV-006, the sign-in path no longer distinguishes unknown-user from
  bad-password (both return an identical 401, AC-1.2/AC-1.3, handled in section 01) and the
  unknown-user path performs a dummy-hash `verify` to equalize timing — so the hasher must offer a
  usable comparison cost even against a fixed dummy hash; the hasher itself contributes no
  additional timing side channel beyond bcrypt's own cost.
- **Library confinement (N-001).** `bcryptjs` is imported in exactly one module-owned file (the
  Hash seam), so a future change of hashing library or a FUXA upgrade touches one file.

---

## 7. Correctness Properties

> *A property is a characteristic or behavior that should hold true across all valid
> executions of a system — a formal statement about what the system should do. Properties are
> the bridge between human-readable specifications and machine-verifiable correctness.*

This section is the **single owner** of **P-001** and **P-002** (per the master-map Table of
Contents and [`../decisions/traceability.md`](../decisions/traceability.md) §C). The prework
consolidation established that:

- **AC-4.4** (a hash verifies its own plaintext) is the single-hash base case of **AC-4.3**
  (two independent hashes of the same plaintext each verify). These are **combined** into one
  comprehensive property, **P-001**, with `hash(p) !== hash(p)` retained as the *random-salt
  witness* required by AC-4.3.
- **AC-4.5** (a hash of one plaintext rejects a different plaintext) asserts *rejection* and is
  **not implied** by P-001 (which asserts acceptance); it remains a distinct property, **P-002**.
- **AC-4.1** (hash-before-persist flow) and **AC-4.2** (persist-only-hash invariant) are
  wiring/persistence behaviors, not universal input/output properties; they are verified by
  example/integration tests owned by sections 04 and 06 and are only *referenced* here.

### Property 1: Password hash verifies its own plaintext

*For any* plaintext password `p`, `verify(p, hash(p))` is true; and for any two independently
produced hashes `h1 = hash(p)` and `h2 = hash(p)` of the same `p`, both `verify(p, h1)` and
`verify(p, h2)` are true while `h1 ≠ h2` (the per-hash random-salt witness).

**Validates: Requirements 4.3, 4.4** — (P-001)

### Property 2: Password hash rejects a different plaintext

*For any* two distinct plaintext passwords `A` and `B` with `A ≠ B` **and both within the enforced
valid-password domain (UTF-8 byte length ≤ 72, AC-4.6)**, `verify(B, hash(A))` is false.

> The 72-byte bound is **required**, not cosmetic: without it, two distinct passwords sharing their
> first 72 bytes would cross-verify under bcrypt truncation (see [§2.2](#2-password_hasher-interface--contract)).
> Passwords exceeding 72 bytes are rejected at validation (AC-4.6) and never hashed, so they are
> outside this property's domain. (Corrected 2026-07-13 per D-017 / N-012 — the prior unbounded
> statement was false for bcrypt.)

**Validates: Requirements 4.5, 4.6** — (P-002)

---

## 8. Testing Notes (fast-check strategy)

**PBT applicability for this section: applicable.** `Password_Hasher` is a pure input/output
component with universal round-trip/rejection properties over an infinite string input space —
an ideal PBT target. Tests use **`fast-check`** on the server-side `mocha`/`chai` runner (both
verified available in the master-map Testing Strategy). Per the master-map rules: use the
ecosystem PBT library (do not hand-roll), **minimum 100 iterations** per property, and tag each
test.

**Tag format (master-map rule):**
`Feature: auth-user-management, Property {n}: {property text}`

### 8.1 Generators / strategy

A single password-string generator feeds both properties, deliberately biased toward the inputs
that stress a hasher:

- **Base**: `fc.string()` for arbitrary-length ASCII.
- **Unicode**: `fc.fullUnicodeString()` to exercise multi-byte characters and combining marks.
- **Empty**: include the empty string `''` (the hasher must be total — [§2.2](#22-contract-details)).
- **Long (within bound)**: strings up to **exactly 72 UTF-8 bytes** to exercise the boundary of the
  accepted domain. Strings **beyond** 72 bytes are NOT fed to P-001/P-002 — they are rejected at
  validation (AC-4.6). A **separate example test** asserts a >72-byte password is rejected with a
  validation error and never reaches `hash` (this is the direct guard against the N-012 truncation
  collision).
- **Near-duplicates** (critical for P-002's rejection boundary): from a base string `s`, derive
  candidates such as `s + ' '` (trailing space), a case-flipped variant, and a
  single-character-different variant, so distinct-but-similar pairs are tested, not just
  obviously different ones.

Combine via `fc.oneof(...)` so each run samples across all categories.

- **P-001** — `fc.property(passwordArb, p => { const h1 = hash(p), h2 = hash(p); return verify(p,h1) && verify(p,h2) && h1 !== h2; })`.
- **P-002** — generate an unordered pair on `fc.tuple(passwordArb, passwordArb)` with **both members
  constrained to ≤ 72 UTF-8 bytes** (the accepted domain, AC-4.6) and **enforce `A ≠ B` with a
  `.filter(([a,b]) => a !== b)`** (drop equal pairs rather than assume inequality), then assert
  `verify(B, hash(A)) === false`. Bias the pair generator to include near-duplicate pairs (e.g.
  differing only in the last byte, still within 72 bytes) so the rejection boundary is exercised,
  not only far-apart strings. **Do not** generate >72-byte members here (that collision is expected
  and is handled by the AC-4.6 validation-rejection test above, not by P-002).

### 8.2 Cost factor for tests

Construct the Hash seam at bcrypt's **minimum cost (4)** in property tests so 100+ iterations
run quickly; the properties are cost-independent because the cost is embedded in each digest
([§3.3](#33-cost--work-factor-decision)). One example-based test asserts the *production default*
cost (12) is what the seam produces when unconfigured, by reading the cost field of a produced
digest.

### 8.3 Example / edge tests (complementary)

- Empty-string plaintext hashes and verifies (P-001 base case at an explicit value).
- `verify` returns `false` (does not throw) for `null`, `''`, and a structurally malformed hash
  string ([§2.2](#22-contract-details) defensive `verify`).
- A digest produced at cost 10 (FUXA's current factor) still verifies — guards the
  interoperability claim in [§3.3](#33-cost--work-factor-decision).

---

## 9. Traceability (this section)

| AC | Behavior | Verified FUXA anchor | Test type |
|----|----------|----------------------|-----------|
| AC-4.1 | Plaintext hashed (salted, one-way) *before* the store persists a created/changed record | `bcrypt.hashSync(pwd, 10)` in `usrstorage.setUser`; module lifts hashing to the service layer | example/integration (owned by §04); relies on `hash()` contract here |
| AC-4.2 | Store persists only the hash, never the plaintext (read path also excludes the hash, REQ-6 AC-6.2) | store shape `{…, password, …}` in `usrstorage.js`; hash produced upstream | example/integration (owned by §06); referenced here |
| AC-4.3 | Same plaintext hashed twice → two hashes that each verify (per-hash random salt) | `bcrypt.hashSync(pwd, 10)` (numeric-rounds form generates a fresh salt per call) | **property — P-001** |
| AC-4.4 | `verify(p, hash(p))` reports a match | relocates inline `bcrypt.compareSync(...)` behind the Hash seam | **property — P-001** (combined) |
| AC-4.5 | `verify(B, hash(A))` reports no match for `A ≠ B` (over the ≤72-byte accepted domain) | `bcrypt.compareSync(...)` in `auth/index.js`; bounded per D-017 | **property — P-002** |
| AC-4.6 | Reject a password whose UTF-8 length > 72 bytes before hashing (root fix for the truncation collision, N-012) | bcrypt 72-byte truncation (documented) | example/validation test |
| AC-4.7 | Reject a password below the configured minimum length or on the common-password blocklist | — (new policy, NIST SP 800-63B-4) | example/validation test |

No orphan criteria: AC-4.1 … AC-4.7 each map to at least one test above (AC-4.1/AC-4.2 to
example/integration owned by sections 04/06 and referenced here; AC-4.3/4.4 to P-001; AC-4.5 to
P-002 over the bounded domain; AC-4.6/AC-4.7 to example/validation tests in the service layer,
§04). This section maps back to REQ-4 only, matching
[`../decisions/traceability.md`](../decisions/traceability.md) §A/§B (`DES-PWD → REQ-4`) and the
master map's Table of Contents (`DES-PWD` owns P-001, P-002).
