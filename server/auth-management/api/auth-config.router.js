//@ts-check
'use strict';

/**
 * Auth-config router (D-049, design/13-runtime-config.md §3). Task D-049.3.
 *
 * MODULE-OWNED runtime configuration surface — mounted inside the module router (which is already
 * mounted at the SUPERSEDE point), so this adds NO new FUXA-core wiring. Gated by the FUNCTIONAL
 * permissions `settings.read` (GET) / `settings.manage` (PUT/DELETE) via the existing
 * `requirePermission` middleware (§05). Handlers map the `AuthConfigService` outcome to HTTP; the
 * router holds no policy logic (AC-16.3).
 *
 *   GET    /api/auth/config  → 200 { status:'success', data: <effective config> }        (settings.read)
 *   PUT    /api/auth/config  → 200 { status:'success', data: <effective>, version }       (settings.manage)
 *                              400 { error:'validation_error', errors:[...] } on invalid
 *   DELETE /api/auth/config  → 200 { status:'success', data: <effective after reset> }     (settings.manage)
 */

const express = require('express');

/**
 * @param {{ authConfigService: any, requirePermission: (p: string) => Function }} deps
 * @returns {import('express').Router}
 */
function createAuthConfigRouter(deps) {
    const d = deps || {};
    if (!d.authConfigService || typeof d.requirePermission !== 'function') {
        throw new Error('createAuthConfigRouter requires { authConfigService, requirePermission }');
    }
    const { authConfigService, requirePermission } = d;
    const router = express.Router();

    const actorOf = (req) => (req && req.authIdentity && req.authIdentity.username) || undefined;

    // GET /api/auth/config — read the effective config (settings.read)
    router.get('/api/auth/config', requirePermission('settings.read'), async (req, res) => {
        try {
            const effective = await authConfigService.getEffective();
            return res.status(200).json({ status: 'success', data: effective });
        } catch (_e) {
            return res.status(503).json({ error: 'service_unavailable', message: 'Auth config unavailable' });
        }
    });

    // PUT /api/auth/config — validate + persist + live-apply a partial patch (settings.manage)
    router.put('/api/auth/config', requirePermission('settings.manage'), async (req, res) => {
        let outcome;
        try {
            outcome = await authConfigService.apply(req.body || {}, actorOf(req));
        } catch (_e) {
            return res.status(503).json({ error: 'service_unavailable', message: 'Auth config unavailable' });
        }
        if (outcome.kind === 'applied') {
            return res.status(200).json({ status: 'success', data: outcome.effective, version: outcome.version });
        }
        return res.status(400).json({ error: 'validation_error', errors: outcome.errors });
    });

    // DELETE /api/auth/config — reset to baseline/defaults (settings.manage)
    router.delete('/api/auth/config', requirePermission('settings.manage'), async (req, res) => {
        try {
            const outcome = await authConfigService.resetToDefaults(actorOf(req));
            return res.status(200).json({ status: 'success', data: outcome.effective });
        } catch (_e) {
            return res.status(503).json({ error: 'service_unavailable', message: 'Auth config unavailable' });
        }
    });

    return router;
}

module.exports = { createAuthConfigRouter };
