//@ts-check
'use strict';

/**
 * Authorization_Service — RBAC enforcement (design/05-rbac-authorization.md · REQ-10, + the
 * single-owner admin-determination predicate used by §04/§12).
 *
 * Pure decision layer over the injected `Role_Store` (no clock, no random, no HTTP knowledge —
 * AC-16.5/D-003). Responsibilities:
 *   - `resolveIdentity(claims, record)` — build the request Identity from the LIVE account record,
 *     NOT the token claims (D-015, fixes N-011), applying the `tokenVersion` active-revocation check
 *     with absent→0 coercion (D-027). Pure; the middleware (Task 13) supplies `record` via
 *     `getUserCache` (D-032).
 *   - `effective(identity)` — the identity's effective permission set: union of each role's
 *     permissions (resolved live via `Role_Store.get`) ∪ the legacy group-code admin compat input
 *     (§2.3/§5). This is the single quantity every decision is a function of (P-006).
 *   - `isAllowed(identity, operation)` — the ordered, total decision (§4.2): unauthenticated→401,
 *     bootstrap gate (when `mustRotate`: ALLOW `account.rotatePassword`, else 403 — the gate decides
 *     entirely, membership is not consulted; DEF-R2/P-009), permission membership→allow/403, with a
 *     fail-closed default. Deterministic for unchanged inputs (P-006).
 *   - `isAdministrator(subject)` — the single admin-determination predicate (§5.3) consumed by
 *     §04 last-admin (AC-8.5) and §12 bootstrap (REQ-17).
 *
 * Group code is a COMPATIBILITY INPUT only (§5.2): `255`/`-1` inject ADMIN_PERMISSION_SET; it never
 * overrides RBAC and a non-admin code contributes nothing. RBAC role permissions are the source of
 * truth. This replaces FUXA's coarse `haveAdminPermission(groupCode)` gate with permission-based
 * membership and splits FUXA's single 401 into 401 (unauthenticated) vs 403 (unpermitted).
 */

/** The distinguished permission set that defines an administrator (§2.2). */
const ADMIN_PERMISSION_SET = Object.freeze([
    'user.create', 'user.read', 'user.update', 'user.delete',
    'role.create', 'role.read', 'role.update', 'role.delete',
]);

/** FUXA legacy admin group codes (verified: `jwt-helper.adminGroups = [-1, 255]`). */
const ADMIN_GROUP_CODES = Object.freeze([-1, 255]);

/**
 * True iff any member of `groups` is a legacy admin group code (`-1`/`255`). Accepts a scalar,
 * an array of numbers, or an array of strings (a numeric string like "255" also counts).
 * @param {number|number[]|string[]|null|undefined} groups
 * @returns {boolean}
 */
function isAdminGroupCode(groups) {
    const arr = Array.isArray(groups) ? groups : [groups];
    for (const g of arr) {
        const n = typeof g === 'number' ? g : (typeof g === 'string' && g.trim() !== '' ? Number(g) : NaN);
        if (ADMIN_GROUP_CODES.indexOf(n) !== -1) {
            return true;
        }
    }
    return false;
}

class AuthorizationService {
    /**
     * @param {{ roleStore: { get(id: string): Promise<any|undefined> } }} deps
     */
    constructor(deps) {
        const d = deps || {};
        if (!d.roleStore || typeof d.roleStore.get !== 'function') {
            throw new Error('AuthorizationService requires a roleStore with get(id)');
        }
        this.roleStore = d.roleStore;
    }

    /**
     * Build the request Identity from the LIVE account record (D-015/D-027, §4.1). PURE — no store,
     * no clock; the caller (middleware, Task 13) supplies `record` from `getUserCache` after the
     * token signature/expiry has been verified (§02). A missing/disabled account, or a token whose
     * `tokenVersion` is below the account's current version (absent→0), yields `authenticated:false`
     * so the next protected request is denied (401) — active revocation (P-013).
     *
     * @param {{ id?: string, sub?: string, tokenVersion?: number }|null} claims verified token claims (or null when unverified)
     * @param {any|undefined} record the live `User_Record` from the store/cache, or undefined if absent
     * @returns {{ authenticated: true, username: string, roles: string[], groups: any, mustRotate: boolean }
     *          | { authenticated: false }}
     */
    resolveIdentity(claims, record) {
        if (!claims || typeof claims !== 'object') {
            return { authenticated: false };
        }
        // Account gone or disabled → no authority (the deleted/disabled user is denied next request).
        if (!record || (record.metadata && record.metadata.disabled === true)) {
            return { authenticated: false };
        }
        // Active revocation (D-027): coerce absent tokenVersion on BOTH sides to 0. A legacy token
        // (0) is revoked once the account bumps to ≥1; both absent ⇒ 0<0 false ⇒ allowed.
        const tokenVer = Number(claims.tokenVersion) || 0;
        const acctVer = Number(record.metadata && record.metadata.tokenVersion) || 0;
        if (tokenVer < acctVer) {
            return { authenticated: false };
        }
        return {
            authenticated: true,
            username: record.username,
            roles: Array.isArray(record.roles) ? record.roles : [],
            groups: record.groups,
            mustRotate: !!(record.metadata && record.metadata.mustRotate),
        };
    }

    /**
     * The identity's effective permission set: union of each assigned role's permissions (resolved
     * LIVE from the store; an unknown role id contributes nothing) ∪ the legacy group-code admin
     * compat input (§2.3/§5). Returns a `Set<string>`.
     * @param {{ roles?: string[], groups?: any }} identity
     * @returns {Promise<Set<string>>}
     */
    async effective(identity) {
        const perms = new Set();
        const roleIds = Array.isArray(identity && identity.roles) ? identity.roles : [];
        for (const roleId of roleIds) {
            const role = await this.roleStore.get(roleId);
            if (role && Array.isArray(role.permissions)) {
                for (const p of role.permissions) {
                    perms.add(p);
                }
            }
        }
        // Legacy group-code compat: 255/-1 inject the admin set (additive only, never an override).
        if (isAdminGroupCode(identity && identity.groups)) {
            for (const p of ADMIN_PERMISSION_SET) {
                perms.add(p);
            }
        }
        return perms;
    }

    /**
     * The ordered, total authorization decision (§4.2). Deterministic for unchanged inputs (P-006).
     * @param {{ authenticated?: boolean, roles?: string[], groups?: any, mustRotate?: boolean }} identity
     * @param {{ id?: string, requiredPermission?: string }} operation
     * @returns {Promise<{ allow: true } | { allow: false, status: 401, error: 'unauthorized_error' } | { allow: false, status: 403, error: 'forbidden' }>}
     */
    async isAllowed(identity, operation) {
        // (1) Unauthenticated → 401 (AC-10.3). No permission resolution.
        if (!identity || identity.authenticated !== true) {
            return { allow: false, status: 401, error: 'unauthorized_error' };
        }
        const required = operation && operation.requiredPermission;
        // (2) Bootstrap gate (AC-17.2 / REQ-17, §05 §4.2 step 2). When `mustRotate` is true the
        // decision is made ENTIRELY here — permission membership (step 3) is NOT consulted:
        //   • `account.rotatePassword` → ALLOW. Self-rotation is a self-authorized operation that
        //     needs no RBAC grant; this is the ALLOW half that P-009 (§12 §9) requires and that the
        //     seeded admin (`groups:-1`, whose effective set is ADMIN_PERMISSION_SET WITHOUT
        //     `account.rotatePassword`) could not otherwise satisfy via membership (DEF-R2 root fix).
        //   • anything else → 403. Evaluated BEFORE membership so a not-yet-rotated seeded admin
        //     cannot use its ADMIN_PERMISSION_SET to bypass the gate.
        if (identity.mustRotate === true) {
            if (required === 'account.rotatePassword') {
                return { allow: true };
            }
            return { allow: false, status: 403, error: 'forbidden' };
        }
        // Fail-closed: an operation with no/undefined required permission is never allowed (§4.2).
        if (typeof required !== 'string' || required === '') {
            return { allow: false, status: 403, error: 'forbidden' };
        }
        // (3) Permission membership → allow/deny (AC-10.1/10.2; admin role ⇒ AC-10.4 by superset).
        const perms = await this.effective(identity);
        if (perms.has(required)) {
            return { allow: true };
        }
        return { allow: false, status: 403, error: 'forbidden' };
    }

    /**
     * The single admin-determination predicate (§5.3). A subject (User_Record or resolved Identity)
     * is an administrator iff its resolved permissions cover ADMIN_PERMISSION_SET — RBAC-native,
     * with the legacy `255`/`-1` group code as an additive compat input. Pure over stored roles.
     * @param {{ roles?: string[], groups?: any }} subject
     * @returns {Promise<boolean>}
     */
    async isAdministrator(subject) {
        const perms = await this.effective({
            roles: subject && subject.roles,
            groups: subject && subject.groups,
        });
        return ADMIN_PERMISSION_SET.every((p) => perms.has(p));
    }
}

module.exports = { AuthorizationService, ADMIN_PERMISSION_SET, ADMIN_GROUP_CODES, isAdminGroupCode };
