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
 * Stable, MACHINE-READABLE rejection codes (D-051, fixes the N-091 L2 defect).
 *
 * WHY. The API used to report only an English sentence (`message`). The client's §9 rule forbids
 * rendering server text, so the UI could only show a generic "Invalid input" and the operator never
 * learned WHICH rule failed or what the threshold is (observed live, N-091 L2). A human sentence is
 * also un-localizable and un-testable. These codes + `params` let the client pick a translated message
 * with the real numbers interpolated, WITHOUT ever displaying server-authored text.
 *
 * The codes are part of the API contract: never rename one (add a new code instead).
 */
const PASSWORD_REJECTION_CODES = Object.freeze({
    required: 'password_required',
    malformed: 'password_malformed',
    tooLong: 'password_too_long',
    tooShort: 'password_too_short',
    blocklisted: 'password_blocklisted',
});

/**
 * Validate a plaintext password against the resolved policy, returning a STRUCTURED rejection
 * (`{ code, message, params }`) or `null` when acceptable. Never hashes; never mutates.
 *
 * `message` keeps the exact wording the API already returned (so the HTTP contract and existing tests
 * are unchanged); `code` + `params` are the additive machine-readable half (D-051).
 * @param {any} plaintext
 * @param {{ minLength: number, blocklist: Set<string> }} policy
 * @returns {{ code: string, message: string, params: Record<string, any> }|null}
 */
function validatePasswordPolicyDetailed(plaintext, policy) {
    if (typeof plaintext !== 'string' || plaintext === '') {
        return { code: PASSWORD_REJECTION_CODES.required, message: 'password is required', params: {} };
    }
    if (hasLoneSurrogate(plaintext)) {
        return {
            code: PASSWORD_REJECTION_CODES.malformed,
            message: 'password contains malformed UTF-16 (lone surrogate)',
            params: {},
        };
    }
    if (Buffer.byteLength(plaintext, 'utf8') > BCRYPT_MAX_UTF8_BYTES) {
        return {
            code: PASSWORD_REJECTION_CODES.tooLong,
            message: 'password exceeds the ' + BCRYPT_MAX_UTF8_BYTES + '-byte limit',
            params: { max: BCRYPT_MAX_UTF8_BYTES },
        };
    }
    if ([...plaintext].length < policy.minLength) {
        return {
            code: PASSWORD_REJECTION_CODES.tooShort,
            message: 'password shorter than the ' + policy.minLength + '-character minimum',
            params: { min: policy.minLength },
        };
    }
    if (policy.blocklist.has(plaintext.toLowerCase())) {
        return {
            code: PASSWORD_REJECTION_CODES.blocklisted,
            message: 'password is on the common-password blocklist',
            params: {},
        };
    }
    return null;
}

/**
 * Back-compatible wrapper: the original string-or-null contract, expressed in terms of the structured
 * validator so the two can never drift (D-034 single-source discipline).
 * @param {any} plaintext
 * @param {{ minLength: number, blocklist: Set<string> }} policy
 * @returns {string|null}
 */
function validatePasswordPolicy(plaintext, policy) {
    const rejection = validatePasswordPolicyDetailed(plaintext, policy);
    return rejection ? rejection.message : null;
}

module.exports = {
    validatePasswordPolicy,
    validatePasswordPolicyDetailed,
    PASSWORD_REJECTION_CODES,
    resolvePasswordPolicy,
    DEFAULT_PASSWORD_MIN_LENGTH,
    DEFAULT_PASSWORD_BLOCKLIST,
    BCRYPT_MAX_UTF8_BYTES,
};
