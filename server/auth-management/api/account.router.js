//@ts-check
'use strict';

/**
 * Account router — the bootstrap-gate endpoint `POST /api/account/rotate-password`
 * (design.md "API Composition Root" / design/12 §4 · D-018, closes N-013). Task 13.7.
 *
 * It is guarded by `requirePermission('account.rotatePassword')`; while an identity's `mustRotate`
 * gate is armed, §05 §4.2 step 2 permits ONLY this permission (DEF-R2 allow-half) and denies every
 * other protected operation — so a seeded/migrated admin can always reach here and nothing else until
 * it rotates. The handler delegates to `Account_Service.rotatePassword(identity, req)` and maps the
 * closed outcome to HTTP. On success the service already cleared `mustRotate` and bumped
 * `tokenVersion` (D-015/D-027), so tokens minted before the rotation are revoked on their next request.
 *
 * Note (N-036 flag #2): after `mustRotate` clears, `account.rotatePassword` is membership-governed;
 * a general "authenticated user changes own password" flow is a separate future requirement — this
 * endpoint's contract is the REQ-17 bootstrap-gate rotation.
 */

const express = require('express');

/**
 * @param {{ accountService: any, requirePermission: (p: string) => Function }} deps
 * @returns {import('express').Router}
 */
function createAccountRouter(deps) {
    const d = deps || {};
    if (!d.accountService || typeof d.requirePermission !== 'function') {
        throw new Error('createAccountRouter requires { accountService, requirePermission }');
    }
    const { accountService, requirePermission } = d;
    const router = express.Router();

    router.post('/api/account/rotate-password', requirePermission('account.rotatePassword'), async (req, res) => {
        const b = req.body || {};
        const outcome = await accountService.rotatePassword(req.authIdentity, { currentPassword: b.currentPassword, newPassword: b.newPassword });
        switch (outcome.kind) {
            case 'rotated':
                return res.status(200).json({ status: 'success' });
            case 'bad_current':
                return res.status(400).json({ error: outcome.error, message: 'Current password is incorrect' });
            case 'invalid_new':
                // D-051: additive machine-readable reason (message unchanged) so the rotate page can
                // tell the user WHICH rule failed, translated (N-091 L2).
                return res.status(400).json({
                    error: outcome.error, message: outcome.detail,
                    detailCode: outcome.detailCode, detailParams: outcome.detailParams,
                });
            default:
                return res.status(400).json({ error: 'unexpected_error', message: 'Unexpected rotate outcome' });
        }
    });

    return router;
}

module.exports = { createAccountRouter };
