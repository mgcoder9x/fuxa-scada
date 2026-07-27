//@ts-check
'use strict';

/**
 * Permissions router (D-050 — root fix for the N-091 L1 deadlock + L3 catalog drift).
 *
 * WHY THIS EXISTS. The client used to REPLICATE an authorization decision from data it is not
 * permitted to read: `ModulePermissionService` resolved a non-admin's permissions from the role
 * definitions returned by `GET /api/roles`, which requires `role.read`. A non-admin holding only
 * `user.read` is 403'd there, so the definitions could never load and the client denied the page
 * forever — even though the server answered `GET /api/users` with 200 (verified live, N-091 L1).
 * The same replication caused the role dialog's hand-copied permission vocabulary to miss D-049's
 * `settings.read`/`settings.manage` (N-091 L3).
 *
 * The fix is to make the SERVER authoritative for both quantities and let the client render them:
 *
 *   GET /api/auth/permissions → 200 {
 *     status: 'success',
 *     data: {
 *       username,                 // whose authority this is
 *       effective: string[],      // permissions this identity ACTUALLY holds, server-computed
 *       catalog:  string[],       // the grantable permission vocabulary (for the role editor)
 *       mustRotate: boolean       // bootstrap gate state (D-045) — effective is [] while true
 *     }
 *   }
 *
 * SECURITY REASONING (why an authenticated-only gate is correct, not lax):
 *   - `effective` is the caller's OWN authority. Telling a caller what it may do discloses nothing it
 *     could not discover by trying every endpoint; withholding it only breaks the UI.
 *   - `catalog` is a vocabulary of capability IDs (`<resource>.<action>`), not data: no usernames, no
 *     role→user assignments, no secrets. `ADMIN_PERMISSION_SET` is already public in the source.
 *   - Enforcement is UNCHANGED: every mutating/reading endpoint still goes through
 *     `requirePermission`. This endpoint is advisory for UX only, so a tampered client gains nothing.
 *   - A `mustRotate` identity gets `effective: []` — truthful under P-009 (the gate permits nothing
 *     but `account.rotatePassword`, which is self-authorized rather than granted), and it keeps the
 *     gate's invariant visible to the UI instead of implying authority the server will refuse.
 *   - Requiring a permission here would re-create the deadlock, so the gate is deliberately
 *     authentication-only (`requireAuthenticated`, D-050).
 *
 * The router holds no policy: `effective` comes from `Authorization_Service.effective(identity)` (the
 * SAME function that decides `isAllowed`, so the UI can never disagree with enforcement), and
 * `catalog` is `ADMIN_PERMISSION_SET` ∪ the permissions present on stored roles (so operator-defined
 * permissions remain visible/editable). Resilient: a corrupt role row is skipped by `readAll`, and a
 * store failure degrades to the static admin set rather than failing the whole request.
 */

const express = require('express');

const { ADMIN_PERMISSION_SET } = require('../models/permission');

/**
 * @param {{
 *   authorizationService: { effective(identity: any): Promise<Set<string>> },
 *   roleStore: { readAll(): Promise<{ records: any[], errors: any[] }> },
 *   requireAuthenticated: () => Function
 * }} deps
 * @returns {import('express').Router}
 */
function createPermissionsRouter(deps) {
    const d = deps || {};
    if (!d.authorizationService || typeof d.authorizationService.effective !== 'function') {
        throw new Error('createPermissionsRouter requires an authorizationService with effective()');
    }
    if (!d.roleStore || typeof d.roleStore.readAll !== 'function') {
        throw new Error('createPermissionsRouter requires a roleStore with readAll()');
    }
    if (typeof d.requireAuthenticated !== 'function') {
        throw new Error('createPermissionsRouter requires requireAuthenticated()');
    }
    const { authorizationService, roleStore, requireAuthenticated } = d;

    /**
     * The grantable vocabulary: the admin set ∪ every permission already present on a stored role
     * (so operator-defined permissions stay visible in the editor). Sorted for a stable UI order.
     * A store failure degrades to the static admin set — the editor stays usable.
     * @returns {Promise<string[]>}
     */
    async function buildCatalog() {
        const catalog = new Set(ADMIN_PERMISSION_SET);
        try {
            const { records } = await roleStore.readAll();
            for (const role of records || []) {
                if (role && Array.isArray(role.permissions)) {
                    for (const p of role.permissions) {
                        if (typeof p === 'string' && p !== '') {
                            catalog.add(p);
                        }
                    }
                }
            }
        } catch (_e) {
            // Degrade to the static admin set rather than failing the caller's own-authority read.
        }
        return Array.from(catalog).sort();
    }

    const router = express.Router();

    router.get('/api/auth/permissions', requireAuthenticated(), async (req, res) => {
        const identity = (req && req.authIdentity) || {};
        const gated = identity.mustRotate === true;
        let effective = [];
        try {
            if (!gated) {
                const perms = await authorizationService.effective(identity);
                effective = Array.from(perms).sort();
            }
        } catch (_e) {
            // AC-16.4 spirit: a resolution failure must not report authority it cannot prove.
            return res.status(503).json({ error: 'service_unavailable', message: 'Authorization service unavailable' });
        }
        const catalog = await buildCatalog();
        return res.status(200).json({
            status: 'success',
            data: {
                username: identity.username,
                effective,
                catalog,
                mustRotate: gated,
            },
        });
    });

    return router;
}

module.exports = { createPermissionsRouter };
