//@ts-check
'use strict';

/**
 * Roles router (design/05 §8.1 · REQ-9). Task 13.4.
 *
 * Guarded role management over `Role_Service`, protected by `requirePermission('role.<action>')`
 * (§05). Handlers map the closed outcome to the exact §05 §8.1 HTTP status/body. Role identity is
 * `role.id` (§3.1); the router reads it from the path/body and never touches the store (AC-16.3).
 */

const express = require('express');

/**
 * @param {{ roleService: any, requirePermission: (p: string) => Function }} deps
 * @returns {import('express').Router}
 */
function createRolesRouter(deps) {
    const d = deps || {};
    if (!d.roleService || typeof d.requirePermission !== 'function') {
        throw new Error('createRolesRouter requires { roleService, requirePermission }');
    }
    const { roleService, requirePermission } = d;
    const router = express.Router();

    // GET /api/roles — list all — AC-9.2
    router.get('/api/roles', requirePermission('role.read'), async (req, res) => {
        const outcome = await roleService.list();
        return res.status(200).json({ status: 'success', data: outcome.roles });
    });

    // POST /api/roles — create { id, name, permissions } — AC-9.1/9.5
    router.post('/api/roles', requirePermission('role.create'), async (req, res) => {
        const b = req.body || {};
        const outcome = await roleService.create({ id: b.id, name: b.name, permissions: b.permissions });
        switch (outcome.kind) {
            case 'created':
                return res.status(200).json({ status: 'success', data: outcome.role });
            case 'duplicate':
                return res.status(400).json({ error: outcome.error, message: 'Role already exists' });
            case 'invalid':
                return res.status(400).json({ error: outcome.error, message: outcome.detail });
            default:
                return res.status(400).json({ error: 'unexpected_error', message: 'Unexpected create outcome' });
        }
    });

    // PUT /api/roles/:id — replace the permission set wholesale — AC-9.3
    router.put('/api/roles/:id', requirePermission('role.update'), async (req, res) => {
        const b = req.body || {};
        const outcome = await roleService.update(req.params.id, b.permissions);
        switch (outcome.kind) {
            case 'updated':
                return res.status(200).json({ status: 'success', data: outcome.role });
            case 'unknown_role':
                return res.status(404).json({ error: outcome.error, name: outcome.name, message: 'Role not found' });
            case 'invalid':
                return res.status(400).json({ error: outcome.error, message: outcome.detail });
            default:
                return res.status(400).json({ error: 'unexpected_error', message: 'Unexpected update outcome' });
        }
    });

    // DELETE /api/roles/:id — delete + prune referencing users — AC-9.4
    router.delete('/api/roles/:id', requirePermission('role.delete'), async (req, res) => {
        const outcome = await roleService.delete([req.params.id]);
        return res.status(200).json({ status: 'success', data: { removed: outcome.removed, prunedUsers: outcome.prunedUsers } });
    });

    return router;
}

module.exports = { createRolesRouter };
