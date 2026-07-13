//@ts-check
'use strict';

/**
 * TokenAdapter — the FUXA JWT seam (design/02-token-and-session.md §1/§3/§5; D-003, N-001).
 *
 * This is the SOLE component in the module that imports FUXA's `server/api/jwt-helper.js` and the
 * `jsonwebtoken` library. Everything above it (the `Token_Service`, task 5.2) talks only to this
 * adapter, so a future FUXA JWT upgrade stays confined to this one file (low-conflict, N-001) and
 * no other module code reaches into FUXA core.
 *
 * Why wrap `jsonwebtoken` directly rather than call jwt-helper's own sign path: jwt-helper only
 * signs with its fixed expiry and never adds the RBAC `roles` claim, whereas the module needs to
 * control expiry per the §4 policy table and add `roles`. BUT the signing/verifying SECRET is
 * always sourced from `authJwt.secretCode` (the shared FUXA secret) so tokens minted by the module
 * verify inside FUXA and vice-versa — there is exactly one signing-key path (AC-2.2, §7).
 *
 * Scope of THIS task (5.1): a thin, faithful wrapper only. It forwards `options` through on both
 * `sign` and `verify` so a later task (5.6, D-021) can pin `algorithms` / validate `iss`/`aud`/`typ`
 * without changing this seam. The expiry-policy resolution, claim hardening, and the stateful
 * refresh-token store (5.2 / 5.6 / 5.7) are SEPARATE later tasks and are NOT implemented here.
 */

const jwt = require('jsonwebtoken');
const authJwt = require('../../api/jwt-helper'); // reuse FUXA's secret — one shared secret

/**
 * Thin wrapper over `jsonwebtoken`, keyed on FUXA's shared JWT secret.
 * @see design/02-token-and-session.md §1 (Adapter seam) / §2.2 / §5
 */
class TokenAdapter {
    /**
     * The signing/verifying secret. ALWAYS sourced live from FUXA's `jwt-helper.secretCode` (a
     * persistent configured secret when `init(...)` received one, else the per-process random
     * fallback — verified in `server/api/jwt-helper.js`). Read through a getter (not cached) so a
     * later `authJwt.init(...)` that sets the persistent secret is picked up transparently.
     * @returns {string}
     */
    get secret() {
        return authJwt.secretCode;
    }

    /**
     * Sign a payload into a JWT string using the shared FUXA secret.
     * @param {object} payload the claim set (e.g. `{ id, groups, roles }`)
     * @param {import('jsonwebtoken').SignOptions} [options] e.g. `{ expiresIn: 3600 }`; `{}` (or
     *   omitting `expiresIn`) mints a token with no `exp` claim.
     * @returns {string} the signed JWT
     */
    sign(payload, options = {}) {
        return jwt.sign(payload, this.secret, options);
    }

    /**
     * Verify a JWT's signature and expiry against the shared FUXA secret and return its decoded
     * claims. THROWS on failure exactly as `jsonwebtoken` does: `JsonWebTokenError` for a bad
     * signature/malformed token, `TokenExpiredError` for a past `exp`. `options` is forwarded
     * unchanged so a later task can pin `algorithms` / validate `issuer`/`audience` (D-021).
     * @param {string} token the JWT to verify
     * @param {import('jsonwebtoken').VerifyOptions} [options] e.g. `{ algorithms: ['HS256'] }`
     * @returns {string | import('jsonwebtoken').JwtPayload} the decoded payload
     */
    verify(token, options = {}) {
        return jwt.verify(token, this.secret, options);
    }

    /**
     * Decode a JWT WITHOUT verifying its signature. Use only for reading claims such as
     * `iat`/`exp` in tests/diagnostics — never for an authentication decision.
     * @param {string} token the JWT to decode
     * @returns {null | string | import('jsonwebtoken').JwtPayload} the decoded payload, or `null`
     *   if the token is not a well-formed JWT
     */
    decode(token) {
        return jwt.decode(token);
    }
}

module.exports = { TokenAdapter };
