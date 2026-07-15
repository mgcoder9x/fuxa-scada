//@ts-check
'use strict';

/**
 * Authorization middleware seam (design/05 §1.1/§4.1 · REQ-10, REQ-16 AC-16.3/16.4). Task 13.1.
 *
 * The API-layer enforcement point for every protected route. For each request it:
 *   1. extracts the access token (FUXA convention: the `x-access-token` header; also accepts
 *      `Authorization: Bearer <t>`),
 *   2. verifies it via `Token_Service.verify` (identity/session reference only — §02),
 *   3. builds the request `Identity` from the **LIVE `User_Record`** (`User_Store.get`, NOT the token
 *      claims — D-015/N-011) via the pure `Authorization_Service.resolveIdentity(claims, record)`
 *      (D-032), which also applies the `tokenVersion` active-revocation check (D-027), and
 *   4. asks `Authorization_Service.isAllowed(identity, { requiredPermission })` for the decision,
 *      short-circuiting **401** (unauthenticated) / **403** (unpermitted or bootstrap-gated), or
 *      calling `next()` with `req.authIdentity` set for the route handler.
 *
 * It never touches the store beyond the single identity read (AC-16.3), and FAILS FAST with **503**
 * if a dependency throws (store/service unavailable — AC-16.4) rather than leaking a 500 or, worse,
 * proceeding unauthenticated.
 *
 * D-032/N-036 fix (flag #1): the identity record is read through `User_Store.get(username)` — which
 * returns the domain `User_Record` shape `{ username, roles, groups, metadata }` the resolver needs —
 * NOT FUXA's raw `getUserCache` entry `{ info:{roles}, groups }`. This is the correct wiring the
 * bootstrap/RBAC live-authority contract requires.
 */

/**
 * Extract the bearer/access token from a request. Returns the raw JWT string or null.
 * @param {any} req
 * @returns {string|null}
 */
function extractToken(req) {
    const headers = (req && req.headers) || {};
    const x = headers['x-access-token'];
    if (typeof x === 'string' && x.trim() !== '') {
        return x.trim();
    }
    const auth = headers['authorization'];
    if (typeof auth === 'string') {
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (m) return m[1].trim();
    }
    return null;
}

/**
 * @param {{
 *   tokenService: { verify(token: string|null): any },
 *   userStore: { get(username: string): Promise<any|undefined> },
 *   authorizationService: { resolveIdentity(claims: any, record: any): any, isAllowed(identity: any, operation: any): Promise<any> }
 * }} deps
 * @returns {{ requirePermission(permissionId: string): Function, buildIdentity(req: any): Promise<any> }}
 */
function createAuthorizationMiddleware(deps) {
    const d = deps || {};
    if (!d.tokenService || typeof d.tokenService.verify !== 'function') {
        throw new Error('authorization middleware requires a tokenService with verify()');
    }
    if (!d.userStore || typeof d.userStore.get !== 'function') {
        throw new Error('authorization middleware requires a userStore with get()');
    }
    if (!d.authorizationService || typeof d.authorizationService.resolveIdentity !== 'function' || typeof d.authorizationService.isAllowed !== 'function') {
        throw new Error('authorization middleware requires an authorizationService with resolveIdentity()/isAllowed()');
    }
    const { tokenService, userStore, authorizationService } = d;

    /**
     * Build the request Identity from the verified token + the LIVE account record (D-015/D-032).
     * Returns `{ authenticated:false }` for a missing/invalid/expired token or an absent account.
     * @param {any} req
     * @returns {Promise<any>}
     */
    async function buildIdentity(req) {
        const claims = tokenService.verify(extractToken(req));
        if (!claims || claims.authenticated !== true) {
            return { authenticated: false };
        }
        // Live-authority read (adapter shape: { username, roles, groups, metadata }) — NOT getUserCache.
        const record = await userStore.get(claims.id);
        return authorizationService.resolveIdentity(claims, record);
    }

    /**
     * Express middleware factory: guard a route behind `permissionId`. On allow, sets
     * `req.authIdentity` and calls `next()`; otherwise responds 401/403 (or 503 on a dependency error).
     * @param {string} permissionId
     * @returns {Function}
     */
    function requirePermission(permissionId) {
        return async function (req, res, next) {
            let identity;
            try {
                identity = await buildIdentity(req);
            } catch (_e) {
                // AC-16.4: the API fails fast if the identity/service layer is unavailable.
                return res.status(503).json({ error: 'service_unavailable', message: 'Authorization service unavailable' });
            }
            let decision;
            try {
                decision = await authorizationService.isAllowed(identity, { id: permissionId, requiredPermission: permissionId });
            } catch (_e) {
                return res.status(503).json({ error: 'service_unavailable', message: 'Authorization service unavailable' });
            }
            if (decision && decision.allow === true) {
                req.authIdentity = identity;
                return next();
            }
            const status = (decision && decision.status) || 403;
            const error = (decision && decision.error) || 'forbidden';
            const message = status === 401 ? 'Unauthorized!' : 'Forbidden';
            return res.status(status).json({ error, message });
        };
    }

    return { requirePermission, buildIdentity };
}

module.exports = { createAuthorizationMiddleware, extractToken };
