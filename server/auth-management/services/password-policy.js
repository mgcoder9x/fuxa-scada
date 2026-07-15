//@ts-check
'use strict';

/**
 * Password policy — the SINGLE source of the AC-4.6/AC-4.7 (+ D-025) validation used by BOTH
 * `User_Service` (create/update, §04 §2.3) and `Account_Service.rotatePassword` (§12 §4.1). Kept in
 * one module so the two enforcement sites cannot drift (D-034; anti-drift discipline).
 *
 * Rules, in order (all "reject" ⇒ return an error detail string; a valid password ⇒ null):
 *   1. required / non-empty.
 *   2. well-formed UTF-16 — reject a lone surrogate (D-025 defense-in-depth; the hasher is the
 *      backstop). Shares `hasLoneSurrogate` with the Password_Hasher so the definition is single-source.
 *   3. ≤72 UTF-8 bytes (AC-4.6) — beyond bcrypt's truncation two distinct passwords could be equated (N-012).
 *   4. ≥ configured minimum length in characters/code-points (AC-4.7; default 12).
 *   5. not on the configured common-password blocklist (AC-4.7; case-insensitive).
 */

const { hasLoneSurrogate } = require('./password-hasher');

/** Default minimum password length in characters (code points) — AC-4.7 (configurable, D-034). */
const DEFAULT_PASSWORD_MIN_LENGTH = 12;

/** bcrypt's hard input bound — AC-4.6 (a password beyond this is rejected before hashing). */
const BCRYPT_MAX_UTF8_BYTES = 72;

/**
 * Small built-in common-password blocklist (lower-cased). Overridable via
 * `settings.auth.passwordBlocklist`. Intentionally short — the ≥12-char minimum already rejects most
 * weak inputs; this catches common ≥12-char passphrases. (D-034)
 */
const DEFAULT_PASSWORD_BLOCKLIST = Object.freeze([
    'password', 'password1', 'password123', 'passw0rd', 'password1234',
    '123456789012', '1234567890', 'qwertyuiop', 'qwerty123456', 'iloveyou123',
    'administrator', 'changeme123', 'letmein12345', 'welcome12345', 'p@ssw0rd1234',
]);

/**
 * Resolve the effective policy from `settings.auth` (or defaults).
 * @param {{ auth?: { passwordMinLength?: number, passwordBlocklist?: string[] } }} [settings]
 * @returns {{ minLength: number, blocklist: Set<string> }}
 */
function resolvePasswordPolicy(settings) {
    const auth = (settings && settings.auth) || {};
    const minLength = typeof auth.passwordMinLength === 'number' && auth.passwordMinLength > 0
        ? auth.passwordMinLength : DEFAULT_PASSWORD_MIN_LENGTH;
    const blocklist = new Set(
        (Array.isArray(auth.passwordBlocklist) ? auth.passwordBlocklist : DEFAULT_PASSWORD_BLOCKLIST)
            .filter((s) => typeof s === 'string').map((s) => s.toLowerCase()));
    return { minLength, blocklist };
}

/**
 * Validate a plaintext password against the resolved policy. Returns an error detail string, or null
 * when acceptable. Never hashes; never mutates.
 * @param {any} plaintext
 * @param {{ minLength: number, blocklist: Set<string> }} policy
 * @returns {string|null}
 */
function validatePasswordPolicy(plaintext, policy) {
    if (typeof plaintext !== 'string' || plaintext === '') {
        return 'password is required';
    }
    if (hasLoneSurrogate(plaintext)) {
        return 'password contains malformed UTF-16 (lone surrogate)';
    }
    if (Buffer.byteLength(plaintext, 'utf8') > BCRYPT_MAX_UTF8_BYTES) {
        return 'password exceeds the ' + BCRYPT_MAX_UTF8_BYTES + '-byte limit';
    }
    if ([...plaintext].length < policy.minLength) {
        return 'password shorter than the ' + policy.minLength + '-character minimum';
    }
    if (policy.blocklist.has(plaintext.toLowerCase())) {
        return 'password is on the common-password blocklist';
    }
    return null;
}

module.exports = {
    validatePasswordPolicy,
    resolvePasswordPolicy,
    DEFAULT_PASSWORD_MIN_LENGTH,
    DEFAULT_PASSWORD_BLOCKLIST,
    BCRYPT_MAX_UTF8_BYTES,
};
