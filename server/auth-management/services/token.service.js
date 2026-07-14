//@ts-check
'use strict';

/**
 * Token_Service (design/02-token-and-session.md §2/§3/§4/§5; REQ-2, REQ-3).
 *
 * The Service-layer owner of session-token issuance, validation, and the expiry policy. It is PURE
 * input/output logic over the injected Token seam (`adapters/fuxa-jwt.adapter.js`) — it holds NO
 * secret of its own (the seam sources FUXA's shared `secretCode`, AC-2.2) and imports NO JWT library
 * directly (D-003 boundary). This is the component P-007 (authenticated ⟺ signature valid ∧
 * unexpired) and P-008 (unconfigured ⇒ finite 1h; non-expiry is dev-only) are asserted over.
 *
 * SCOPE OF THIS FILE (Task 5.2 + 5.6): issuance (`issueAccessToken`/`issueRefreshToken`), the §4
 * expiry decision table, `verify`, and the D-021/D-027/D-028/D-029 hardening baked in from the start
 * (the corrected design unifies these, see decisions/01 D-027/D-028/D-029 and decisions/03 TO-012).
 * The stateful `refresh` rotation + `Refresh_Token_Store` (Task 5.7, D-019) is a SEPARATE next
 * increment; `refresh()` here is a defined, honest stub that throws `not_implemented` rather than
 * faking rotation.
 *
 * Hardening actually implemented (per the corrected design):
 *   - **Algorithm pinning (D-021):** `verify` pins `algorithms: [algorithm]` (default `HS256`) so a
 *     token with a different/`none` `alg` is rejected (closes alg-confusion).
 *   - **`type` discriminator (D-028):** access tokens carry `type:'access'`, refresh `type:'refresh'`;
 *     a SINGLE `type` claim (NOT a separate `typ`, which collides with the JWT header parameter).
 *   - **`tokenVersion` (D-015/D-027):** stamped from the identity (sourced from the live account,
 *     default 0) and exposed on verify so §05 can actively revoke.
 *   - **`iss`/`aud` when configured (D-029):** issued and validated ONLY when `jwtIssuer`/`jwtAudience`
 *     are set; unset ⇒ neither issued nor validated (an unconfigured deployment never self-rejects).
 *   - **`sub`/`jti` (D-021):** `sub` mirrors the username; `jti` is a per-token random id for audit
 *     correlation / point revocation.
 *   - **`kid` (TO-012, Option A):** issued tokens carry a `kid` naming the single active key (FUXA's
 *     one `secretCode`). Multi-key overlap rotation is a documented follow-up — NOT implemented; no
 *     keyring is faked. `kid` is emitted forward-compatibly.
 */

const crypto = require('node:crypto');

const DEFAULT_ALGORITHM = 'HS256';
const DEFAULT_ACCESS_TTL_SECONDS = 3600; // §4 Row 2 — the finite 1-hour default (AC-2.7 / P-008)
const DEFAULT_REFRESH_TTL = '7d';        // FUXA `buildRefreshToken` default (verified)

/**
 * Generate a random token id / family id (audit correlation + refresh family, D-019/D-021).
 * @returns {string}
 */
function randomId() {
    return crypto.randomUUID();
}

class TokenService {
    /**
     * @param {{
     *   tokenAdapter: { sign(payload: object, options?: object): string, verify(token: string, options?: object): any, decode(token: string): any },
     *   settings?: {
     *     algorithm?: string,
     *     tokenExpiresIn?: number | string | null,   // configured access TTL (§4 Row 1); falsy ⇒ default path
     *     devNonExpiringTokens?: boolean,             // §4 Row 3 dev-only flag (AC-2.8)
     *     production?: boolean,                       // when true, the dev flag is ignored (§4.1)
     *     jwtIssuer?: string | null,                  // D-029 — validate iss only when set
     *     jwtAudience?: string | null,                // D-029 — validate aud only when set
     *     kid?: string | null,                        // TO-012 — names the single active key
     *     refreshTokenExpiresIn?: number | string     // refresh TTL (default '7d')
     *   },
     *   clock?: () => number,  // ms epoch; injectable for deterministic expiry tests
     *   refreshStore?: any,    // RefreshTokenStore (Task 5.7) — required for refresh() rotation
     *   userStore?: any        // User_Store — required for refresh()'s live-account check (D-015)
     * }} deps
     */
    constructor(deps) {
        const d = deps || {};
        if (!d.tokenAdapter || typeof d.tokenAdapter.sign !== 'function' || typeof d.tokenAdapter.verify !== 'function') {
            throw new Error('TokenService requires a Token seam adapter with sign/verify');
        }
        this.adapter = d.tokenAdapter;
        this.settings = d.settings || {};
        this.clock = typeof d.clock === 'function' ? d.clock : Date.now;
        this.refreshStore = d.refreshStore || null;
        this.userStore = d.userStore || null;
    }

    /** @returns {string} the configured (or default) JWT algorithm. @private */
    _algorithm() {
        return this.settings.algorithm || DEFAULT_ALGORITHM;
    }

    /**
     * Resolve the access-token expiry per the §4 decision table, in precedence order:
     *   Row 1 (AC-2.6): a configured truthy duration → that duration.
     *   Row 3 (AC-2.8): else, dev-only non-expiring mode effectively on (flag AND not production) →
     *                   `null` (caller omits `expiresIn` ⇒ no `exp`).
     *   Row 2 (AC-2.7/P-008): otherwise → the finite 3600s default. NEVER a silent non-expiry.
     * @returns {number | string | null} the value for `expiresIn`, or `null` to omit it entirely
     * @private
     */
    _resolveAccessExpiry() {
        const configured = this.settings.tokenExpiresIn;
        if (configured) {
            return configured; // Row 1
        }
        const devMode = this.settings.devNonExpiringTokens === true && this.settings.production !== true;
        if (devMode) {
            return null; // Row 3 — the ONLY path to a non-expiring token
        }
        return DEFAULT_ACCESS_TTL_SECONDS; // Row 2 — finite 1h default
    }

    /**
     * Build the base `jwt.sign` options shared by both token kinds: pinned algorithm, `kid` header
     * (TO-012), and `issuer`/`audience` ONLY when configured (D-029).
     * @param {number | string | null} expiresIn resolved expiry, or `null` to omit `exp`
     * @returns {object}
     * @private
     */
    _signOptions(expiresIn) {
        /** @type {any} */
        const options = { algorithm: this._algorithm() };
        if (expiresIn !== null && expiresIn !== undefined) {
            options.expiresIn = expiresIn;
        }
        if (this.settings.jwtIssuer) {
            options.issuer = this.settings.jwtIssuer;
        }
        if (this.settings.jwtAudience) {
            options.audience = this.settings.jwtAudience;
        }
        if (this.settings.kid) {
            options.keyid = this.settings.kid; // sets the JWT `kid` header (single active key, TO-012)
        }
        return options;
    }

    /**
     * Issue a signed access token encoding the FUXA-compat + RBAC + hardening claim set (§3).
     * `roles`/`groups` are informational/compat only (NOT authority — D-015); authority is
     * re-resolved live per request by §05. `tokenVersion` is stamped for active revocation (D-027).
     * @param {{ username: string, groups?: any, roles?: string[], tokenVersion?: number }} identity
     * @returns {string} the signed JWT
     */
    issueAccessToken(identity) {
        const id = identity || /** @type {any} */ ({});
        /** @type {any} */
        const payload = {
            id: id.username,
            sub: id.username,
            groups: id.groups,
            roles: Array.isArray(id.roles) ? id.roles : [],
            tokenVersion: Number(id.tokenVersion) || 0,
            type: 'access',
            jti: randomId(),
        };
        return this.adapter.sign(payload, this._signOptions(this._resolveAccessExpiry()));
    }

    /**
     * Issue a signed refresh token (§6.1). Matches FUXA's `{ id, type:'refresh' }` shape and adds the
     * D-019 rotation ids (`jti`, `family_id`) and the `tokenVersion` carried for the refresh-time
     * check. The server-side family record + reuse detection (D-019) is owned by the Refresh_Token_Store
     * (Task 5.7); this method only mints the token and returns the ids the store will persist.
     * @param {{ username: string, tokenVersion?: number, familyId?: string, jti?: string }} identity
     * @returns {{ token: string, jti: string, familyId: string }}
     */
    issueRefreshToken(identity) {
        const id = identity || /** @type {any} */ ({});
        const jti = id.jti || randomId();
        const familyId = id.familyId || randomId();
        /** @type {any} */
        const payload = {
            id: id.username,
            type: 'refresh',
            jti,
            family_id: familyId,
            tokenVersion: Number(id.tokenVersion) || 0,
        };
        const expiresIn = this.settings.refreshTokenExpiresIn || DEFAULT_REFRESH_TTL;
        const token = this.adapter.sign(payload, this._signOptions(expiresIn));
        return { token, jti, familyId };
    }

    /**
     * Validate an access token: authenticated IFF its signature is valid under the shared secret AND
     * it is unexpired AND (when configured) its `iss`/`aud` match AND its `type` is `'access'`
     * (D-028). Never throws — a closed `VerifyResult` makes the decision deterministic (P-007).
     * @param {string} token
     * @returns {{ authenticated: true, id: string, groups: any, roles: string[], tokenVersion: number, jti?: string }
     *          | { authenticated: false, reason: 'missing'|'expired'|'bad_signature'|'malformed'|'wrong_type' }}
     */
    verify(token) {
        if (token === null || token === undefined || token === '') {
            return { authenticated: false, reason: 'missing' };
        }
        /** @type {any} */
        const options = { algorithms: [this._algorithm()] };
        if (this.settings.jwtIssuer) {
            options.issuer = this.settings.jwtIssuer;
        }
        if (this.settings.jwtAudience) {
            options.audience = this.settings.jwtAudience;
        }
        let decoded;
        try {
            decoded = this.adapter.verify(token, options);
        } catch (e) {
            const name = e && e.name;
            if (name === 'TokenExpiredError') {
                return { authenticated: false, reason: 'expired' };
            }
            // JsonWebTokenError covers bad signature, alg mismatch, malformed, and iss/aud mismatch;
            // NotBeforeError (nbf in the future) is also a non-authenticated outcome.
            return { authenticated: false, reason: 'bad_signature' };
        }
        if (!decoded || typeof decoded !== 'object') {
            return { authenticated: false, reason: 'malformed' };
        }
        if (decoded.type !== 'access') {
            return { authenticated: false, reason: 'wrong_type' };
        }
        return {
            authenticated: true,
            id: decoded.id,
            groups: decoded.groups,
            roles: Array.isArray(decoded.roles) ? decoded.roles : [],
            tokenVersion: Number(decoded.tokenVersion) || 0,
            jti: decoded.jti,
        };
    }

    /**
     * Rotate an access+refresh pair from a valid refresh token (AC-3.2/AC-3.3, D-019/RFC 9700). This
     * is the stateful flow of design/02 §6.2 (the router owns §6.2 step 1 "disabled" + cookie I/O +
     * HTTP mapping; this owns steps 2–6). Never throws for a control-flow outcome — returns a closed
     * `RefreshOutcome`.
     *
     * Flow: (2) missing token → `missing`; (3) verify signature/expiry + `type==='refresh'` →
     * `expired`/`invalid`/`wrong_type`; (4) store lookup + hash match + REUSE DETECTION — not-found /
     * hash-mismatch → `invalid` (+ defensive family revoke; safe because step 3 already proved the
     * signature, so `family_id` is legitimate), `revoked` → `revoked`, `used` → **reuse** ⇒ revoke
     * the whole family ⇒ `reuse_detected`; (5) live account (D-015) — missing/disabled →
     * `unknown_user` (+revoke family), `token.tokenVersion < account.tokenVersion` (absent→0, D-027) →
     * `revoked` (+revoke family); (6) **atomic consume-and-rotate** — the store's CAS guarantees
     * single-use; if the CAS loses a concurrent race → `reuse_detected` (+revoke family).
     *
     * @param {string|null} refreshToken the presented refresh-token string (null/'' ⇒ missing)
     * @returns {Promise<
     *     { kind:'rotated', accessToken: string, refreshToken: string, identity: object }
     *   | { kind:'rejected', reason:'missing'|'expired'|'invalid'|'wrong_type'|'unknown_user'|'revoked'|'reuse_detected' }>}
     */
    async refresh(refreshToken) {
        if (!this.refreshStore || !this.userStore) {
            throw new Error('TokenService.refresh requires refreshStore + userStore to be injected');
        }
        // (2) missing
        if (refreshToken === null || refreshToken === undefined || refreshToken === '') {
            return { kind: 'rejected', reason: 'missing' };
        }
        // (3) verify signature/expiry (+ iss/aud when configured); classify the failure kind
        /** @type {any} */
        const options = { algorithms: [this._algorithm()] };
        if (this.settings.jwtIssuer) options.issuer = this.settings.jwtIssuer;
        if (this.settings.jwtAudience) options.audience = this.settings.jwtAudience;
        let decoded;
        try {
            decoded = this.adapter.verify(refreshToken, options);
        } catch (e) {
            if (e && e.name === 'TokenExpiredError') return { kind: 'rejected', reason: 'expired' };
            return { kind: 'rejected', reason: 'invalid' };
        }
        if (!decoded || typeof decoded !== 'object') return { kind: 'rejected', reason: 'invalid' };
        if (decoded.type !== 'refresh') return { kind: 'rejected', reason: 'wrong_type' };

        const jti = decoded.jti;
        const familyId = decoded.family_id;

        // (4) store lookup + hash match + reuse detection
        const row = jti ? await this.refreshStore.getByJti(jti) : undefined;
        if (!row || !this.refreshStore.matches(refreshToken, row)) {
            // Signature already proved authenticity (step 3), so a legitimate but unknown/forged-hash
            // token means the family is compromised or pruned — revoke defensively.
            if (familyId) await this.refreshStore.revokeFamily(familyId);
            return { kind: 'rejected', reason: 'invalid' };
        }
        if (row.state === 'revoked') {
            return { kind: 'rejected', reason: 'revoked' };
        }
        if (row.state === 'used') {
            await this.refreshStore.revokeFamily(row.family_id); // RFC 9700 reuse ⇒ kill the family
            return { kind: 'rejected', reason: 'reuse_detected' };
        }

        // (5) live account + version check (D-015/D-027)
        const account = await this.userStore.get(decoded.id);
        const disabled = !!(account && account.metadata && account.metadata.disabled === true);
        if (!account || disabled) {
            await this.refreshStore.revokeFamily(row.family_id);
            return { kind: 'rejected', reason: 'unknown_user' };
        }
        const accountVersion = Number(account.metadata && account.metadata.tokenVersion) || 0;
        if ((Number(decoded.tokenVersion) || 0) < accountVersion) {
            await this.refreshStore.revokeFamily(row.family_id);
            return { kind: 'rejected', reason: 'revoked' };
        }

        // (6) atomic consume-and-rotate — mint the child first, then CAS-consume the parent
        const identity = {
            username: decoded.id,
            groups: account.groups,
            roles: Array.isArray(account.roles) ? account.roles : [],
            tokenVersion: accountVersion,
        };
        const childJti = randomId();
        const minted = this.issueRefreshToken({
            username: decoded.id, tokenVersion: accountVersion, familyId: row.family_id, jti: childJti,
        });
        const childClaims = this.adapter.decode(minted.token) || {};
        const result = await this.refreshStore.consumeAndRotate(jti, minted.token, {
            jti: childJti,
            familyId: row.family_id,
            parentJti: jti,
            username: decoded.id,
            issuedAt: childClaims.iat,
            expiresAt: childClaims.exp,
        });
        if (!result.consumed) {
            // A concurrent refresh consumed the parent between our read and the CAS ⇒ reuse.
            await this.refreshStore.revokeFamily(row.family_id);
            return { kind: 'rejected', reason: 'reuse_detected' };
        }
        const accessToken = this.issueAccessToken(identity);
        return { kind: 'rotated', accessToken, refreshToken: minted.token, identity };
    }

    /**
     * Revoke a whole refresh-token family (sign-out / password-change / disable, D-019). Best-effort;
     * requires the refresh store. The caller (Authentication_Service/router) invokes this on sign-out.
     * @param {string} familyId
     * @returns {Promise<number>} rows revoked
     */
    async revokeRefreshFamily(familyId) {
        if (!this.refreshStore) return 0;
        return this.refreshStore.revokeFamily(familyId);
    }
}

module.exports = { TokenService, randomId, DEFAULT_ACCESS_TTL_SECONDS, DEFAULT_ALGORITHM };
