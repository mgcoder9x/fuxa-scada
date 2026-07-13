//@ts-check
'use strict';

/**
 * Password_Hasher service (design/03-password-security.md §2/§3; REQ-4).
 *
 * The module's SINGLE hashing site and SINGLE comparison site, expressed behind the Service-layer
 * `Password_Hasher` contract (services/interfaces.js). It contains NO FUXA coupling and NO direct
 * `bcryptjs` import — it depends only on the injected Hash-seam adapter
 * (`adapters/fuxa-bcrypt.adapter.js`, the sole `bcryptjs` importer, §1). This confines the hashing
 * library to one file so a future algorithm swap (e.g. Argon2id, TO-007) or FUXA upgrade touches
 * only the adapter, never this service (AC-16.5 / N-001 / D-003).
 *
 * Contract (§2.1/§2.2):
 *   - `hash(plaintext)` — a salted, one-way bcrypt digest with a FRESH random salt per call, so two
 *     calls on the same input return two DIFFERENT digests that each verify (AC-4.3 → P-001). TOTAL
 *     over all string inputs (empty/whitespace/Unicode/long); it faithfully hashes whatever plaintext
 *     it is given and never throws for a string.
 *   - `verify(plaintext, hash)` — true iff `hash` was produced from `plaintext` (AC-4.4 → P-001),
 *     false for any different plaintext over the accepted domain (AC-4.5 → P-002). DEFENSIVE: returns
 *     `false` (never throws) for a null/empty/structurally-malformed hash, or a non-string plaintext,
 *     so a corrupt stored value degrades to a failed match instead of crashing sign-in (§2.2; mirrors
 *     FUXA's `userInfo[0].password` guard before `compareSync`).
 *
 * SCOPE BOUNDARY (D-017/N-012). The bcrypt 72-byte truncation means P-002 holds only over the
 * ≤72-UTF-8-byte domain. Enforcing that bound (rejecting >72-byte passwords, AC-4.6) and the
 * min-length/blocklist policy (AC-4.7) are `User_Service` VALIDATION concerns (Task 9.1, §04 §2.3),
 * performed BEFORE `hash` is called — NOT this hasher's job. The hasher stays total by design so the
 * validation policy can live in exactly one place (the service that owns input policy).
 *
 * MALFORMED-UTF-16 GUARD (D-025 / N-027, verified 2026-07-13). `bcryptjs`'s pure-JS UTF-16→UTF-8
 * encoder (`utfx.encodeUTF8` / `stringToBytes`) enters a pathological path that burns ~9.6 SECONDS
 * and then throws `RangeError: Invalid array length` when its input string contains a LONE SURROGATE
 * (an unpaired 0xD800–0xDFFF code unit — malformed UTF-16). Such a string can reach the module via
 * `JSON.parse('{"password":"\\uD83D"}')` on the login path; combined with the DV-006 dummy-hash
 * verify for unknown users, an UNAUTHENTICATED attacker could burn ~9.6s of server CPU per request
 * (asymmetric DoS). The ≤72-byte check does NOT protect (Node reports a lone surrogate as 3 UTF-8
 * bytes). Since we do not edit the vendored `bcryptjs` (D-003), this seam — the SINGLE site that
 * feeds bcryptjs — rejects malformed UTF-16 CHEAPLY before bcrypt sees it: `verify` returns `false`
 * fast (a lone-surrogate plaintext can never equal a well-formed stored password — squarely the §2.2
 * defensive-verify contract), and `hash` throws a fast, defined error instead of hanging. Boundary
 * input validation (User_Service 9.1 / Authentication_Service 7.1) should also reject malformed
 * UTF-16 for defense-in-depth, but THIS guard is the guaranteed backstop against the DoS.
 */

/**
 * True iff `s` contains a lone (unpaired) UTF-16 surrogate — i.e. `s` is NOT well-formed Unicode.
 * O(n) over code units; the cheap guard that prevents feeding bcryptjs its pathological input
 * (D-025 / N-027).
 * @param {string} s
 * @returns {boolean}
 */
function hasLoneSurrogate(s) {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF) {
            // high surrogate: must be immediately followed by a low surrogate
            const next = s.charCodeAt(i + 1);
            if (!(next >= 0xDC00 && next <= 0xDFFF)) {
                return true;
            }
            i++; // valid pair — skip the low surrogate
        } else if (c >= 0xDC00 && c <= 0xDFFF) {
            // low surrogate with no preceding high surrogate
            return true;
        }
    }
    return false;
}

/** Thrown by {@link Password_Hasher#hash} for a plaintext that is not well-formed Unicode (D-025). */
class InvalidPasswordEncodingError extends Error {
    constructor() {
        super('invalid_password_encoding');
        this.name = 'InvalidPasswordEncodingError';
        this.code = 'invalid_password_encoding';
    }
}

class Password_Hasher {
    /**
     * @param {{ hashSync(plaintext: string): string, compareSync(plaintext: string, hash: string): boolean }} hashAdapter
     *   the injected Hash-seam adapter (a `BcryptHasherAdapter`). Its cost/work factor is resolved at
     *   the adapter's construction (default 12; tests pass 4).
     */
    constructor(hashAdapter) {
        if (!hashAdapter || typeof hashAdapter.hashSync !== 'function' || typeof hashAdapter.compareSync !== 'function') {
            throw new Error('Password_Hasher requires a Hash-seam adapter with hashSync/compareSync');
        }
        this.adapter = hashAdapter;
    }

    /**
     * Produce a salted, one-way bcrypt digest of `plaintext` (fresh random salt per call). Total over
     * all string inputs; the plaintext is not retained after the call returns (§6 no-plaintext-logging).
     * @param {string} plaintext
     * @returns {string} the bcrypt hash string
     */
    hash(plaintext) {
        // Fast-fail on malformed UTF-16 rather than letting bcryptjs hang ~9.6s then throw
        // (D-025 / N-027). Normal create/update flows validate input first (User_Service 9.1); this
        // is the defense-in-depth backstop so `hash` can never be turned into a CPU sink.
        if (typeof plaintext === 'string' && hasLoneSurrogate(plaintext)) {
            throw new InvalidPasswordEncodingError();
        }
        return this.adapter.hashSync(plaintext);
    }

    /**
     * Verify `plaintext` against a stored bcrypt `hash`. Returns `false` (never throws) for a
     * non-string plaintext, a null/empty/malformed hash, or any adapter error — a corrupt stored value
     * must degrade to a failed match, not crash the sign-in path (§2.2 defensive verify).
     * @param {string} plaintext
     * @param {string} hash
     * @returns {boolean}
     */
    verify(plaintext, hash) {
        // Defensive input guards: bcryptjs throws "Illegal arguments" on a non-string operand, so we
        // reject those shapes up front and treat them as a non-match (never a throw).
        if (typeof plaintext !== 'string') {
            return false;
        }
        if (typeof hash !== 'string' || hash.length === 0) {
            return false;
        }
        // Malformed-UTF-16 guard (D-025 / N-027): a lone surrogate makes bcryptjs burn ~9.6s then
        // throw. It can never equal a well-formed stored password, so it is a definite non-match —
        // return false CHEAPLY before bcrypt sees it (closes the unauthenticated DoS via the login /
        // DV-006 dummy-hash path). This extends the §2.2 defensive-verify contract to the plaintext.
        if (hasLoneSurrogate(plaintext)) {
            return false;
        }
        try {
            return this.adapter.compareSync(plaintext, hash) === true;
        } catch (_e) {
            // A structurally-malformed hash that slips past the shape guard degrades to a failed match.
            return false;
        }
    }
}

module.exports = { Password_Hasher, InvalidPasswordEncodingError, hasLoneSurrogate };
