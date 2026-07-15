//@ts-check
'use strict';

/**
 * Users router (design/04 §8.2 · REQ-5/6/7/8, REQ-12 backend). Task 13.3.
 *
 * Guarded CRUD over `User_Service`. Each route is protected by the authorization middleware
 * (`requirePermission('user.<action>')`, §05/§07) BEFORE the handler runs, so unauthenticated→401 and
 * unpermitted→403 are produced at the seam (§04 §7). The handlers map the service's closed outcome to
 * the exact §04 §8.2 HTTP status/body. The router never touches the store directly (AC-16.3) and reads
 * only the whitelisted body fields (D-006 — no query-injection passthrough).
 */

const express = require('express');

/**
 * @param {{ userService: any, requirePermission: (p: string) => Function }} deps
 * @returns {import('express').Router}
 */
function createUsersRouter(deps) {
    const d = deps || {};
    if (!d.userService || typeof d.requirePermission !== 'function') {
        throw new Error('createUsersRouter requires { userService, requirePermission }');
    }
    const { userService, requirePermission } = d;
    const router = express.Router();

    // GET /api/users — list all (hash-free UserView[]) — AC-6.1/6.2
    router.get('/api/users', requirePermission('user.read'), async (req, res) => {
        const outcome = await userService.list();
        return res.status(200).json({ status: 'success', data: outcome.users });
    });

    // GET /api/users/:username — single (empty result is 200 data:null, NOT an error) — AC-6.3/6.4
    router.get('/api/users/:username', requirePermission('user.read'), async (req, res) => {
        const outcome = await userService.get(req.params.username);
        if (outcome.kind === 'found') {
            return res.status(200).json({ status: 'success', data: outcome.user });
        }
        return res.status(200).json({ status: 'success', data: null });
    });

    // POST /api/users — create — AC-5.1/5.2/5.3 + DEF-U2 validation
    router.post('/api/users', requirePermission('user.create'), async (req, res) => {
        const b = req.body || {};
        const outcome = await userService.create({
            username: b.username, fullname: b.fullname, password: b.password, roles: b.roles, metadata: b.metadata,
        });
        switch (outcome.kind) {
            case 'created':
                return res.status(200).json({ status: 'success', data: outcome.user });
            case 'missing_field':
                return res.status(400).json({ error: outcome.error, field: outcome.field, message: 'Missing required field: ' + outcome.field });
            case 'duplicate':
                return res.status(400).json({ error: outcome.error, message: 'Username already exists' });
            case 'invalid':
                return res.status(400).json({ error: outcome.error, message: outcome.detail });
            default:
                return res.status(400).json({ error: 'unexpected_error', message: 'Unexpected create outcome' });
        }
    });

    // PUT /api/users/:username — update — AC-7.1..7.5
    router.put('/api/users/:username', requirePermission('user.update'), async (req, res) => {
        const b = req.body || {};
        const patch = {};
        if (b.fullname !== undefined) patch.fullname = b.fullname;
        if (b.roles !== undefined) patch.roles = b.roles;
        if (b.metadata !== undefined) patch.metadata = b.metadata;
        if (b.password !== undefined) patch.password = b.password;
        const outcome = await userService.update(req.params.username, patch);
        switch (outcome.kind) {
            case 'updated':
                return res.status(200).json({ status: 'success', data: outcome.user });
            case 'unknown_user':
                return res.status(404).json({ error: outcome.error, username: outcome.username, message: 'User not found' });
            case 'invalid':
                return res.status(400).json({ error: outcome.error, message: outcome.detail });
            default:
                return res.status(400).json({ error: 'unexpected_error', message: 'Unexpected update outcome' });
        }
    });

    // DELETE /api/users/:username — delete (last-admin guarded) — AC-8.1/8.3/8.5
    router.delete('/api/users/:username', requirePermission('user.delete'), async (req, res) => {
        const outcome = await userService.delete(req.params.username);
        switch (outcome.kind) {
            case 'deleted':
                return res.status(200).json({ status: 'success' });
            case 'unknown_user':
                return res.status(404).json({ error: outcome.error, username: outcome.username, message: 'User not found' });
            case 'last_admin':
                return res.status(400).json({ error: outcome.error, username: outcome.username, message: 'Cannot delete the last administrator' });
            default:
                return res.status(400).json({ error: 'unexpected_error', message: 'Unexpected delete outcome' });
        }
    });

    return router;
}

module.exports = { createUsersRouter };
