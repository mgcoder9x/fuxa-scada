//@ts-check
'use strict';

/**
 * Hash seam adapter (design/03-password-security.md §1, §3.1; D-003, N-001).
 *
 * This is the module's SOLE importer of `bcryptjs`. It confines the hashing library to one file
 * so a future FUXA upgrade or algorithm swap (e.g. Argon2id, TO-007) touches only this adapter and
 * never the `Password_Hasher` service that depends on it. The `Password_Hasher` (Task 3.2) is the
 * only consumer and MUST NOT import bcrypt itself.
 *
 * The adapter is a thin, side-effect-free wrapper over bcrypt's synchronous API:
 *   - hashSync(plaintext)        → bcrypt.hashSync(plaintext, cost)   (fresh random salt per call)
 *   - compareSync(plaintext, h)  → bcrypt.compareSync(plaintext, h)
 *
 * The cost/work factor is resolved once at construction (design/03 §3.3, D-008): default 12, with
 * tests passing a reduced cost (e.g. 4) so property tests stay fast. Because bcrypt embeds the cost
 * in every digest, a hash produced at any valid cost still verifies (interoperable with FUXA's
 * existing cost-10 hashes).
 *
 * NOTE: the 72-byte password policy (AC-4.6) is NOT enforced here — that is a `User_Service`
 * validation concern (Task 9.1). This adapter faithfully wraps bcrypt and stays total.
 */

const bcrypt = require('bcryptjs');

/** bcrypt's default work factor for this module (design/03 §3.3, D-008). */
const DEFAULT_COST = 12;

class BcryptHasherAdapter {
  /**
   * @param {{ cost?: number }} [opts] work factor; defaults to 12. Tests may pass 4 (bcrypt minimum).
   */
  constructor(opts = {}) {
    this.cost = Number.isInteger(opts.cost) ? opts.cost : DEFAULT_COST;
  }

  /**
   * Set the work factor used by subsequent {@link hashSync} calls (D-049 runtime config). Because
   * bcrypt embeds the cost in every digest, changing it is NON-retroactive: existing hashes still
   * verify unchanged; only new hashes use the new cost. A non-integer is ignored (keeps the current
   * cost) — the caller (AuthConfigService) validates the bound [10,15] before calling.
   * @param {number} cost
   * @returns {void}
   */
  setCost(cost) {
    if (Number.isInteger(cost)) {
      this.cost = cost;
    }
  }

  /**
   * Produce a salted, one-way bcrypt digest of `plaintext`. A fresh random salt is generated per
   * call (numeric-rounds form), so two calls with the same input return two different digests that
   * each verify.
   * @param {string} plaintext
   * @returns {string} the bcrypt hash string
   */
  hashSync(plaintext) {
    return bcrypt.hashSync(plaintext, this.cost);
  }

  /**
   * Verify a plaintext against a bcrypt hash by re-deriving the checksum from the salt embedded in
   * `hash`. The cost is read from the stored hash, so digests produced at any valid cost verify.
   * @param {string} plaintext
   * @param {string} hash
   * @returns {boolean}
   */
  compareSync(plaintext, hash) {
    return bcrypt.compareSync(plaintext, hash);
  }
}

module.exports = { BcryptHasherAdapter, DEFAULT_COST };
