//@ts-check
'use strict';

/**
 * Feature: auth-user-management — Account_Service.rotatePassword + the bootstrap gate property
 * (design/12 §4/§9 · REQ-17.2/17.3). Task 12.2 (rotate) + 12.4 (Property 9).
 *
 * (A) EXAMPLE/EDGE with doubles — the rotate outcome set, the "current secret verified / flag not
 *     cleared on mismatch", the reuse/policy guard, and the on-success mustRotate-clear +
 *     tokenVersion-bump (D-015/D-027).
 * (B) Property 9 (P-009, owner §12) over the REAL `Authorization_Service.isAllowed` — a seeded admin
 *     (`groups:-1`, `mustRotate:true`) is denied EVERY protected op except `account.rotatePassword`,
 *     and after clearing `mustRotate` regains admin authority.
 *
 * Toolchain (N-023/N-025): `node:assert/strict` + `fast-check@3`.
 */

const assert = require('node:assert/strict');
const fc = require('fast-check');

const { AccountService } = require('../../auth-management/services/account.service');
const { AuthorizationService, ADMIN_PERMISSION_SET } = require('../../auth-management/services/authorization.service');

const VALID_NEW = 'brand-new-strong-pass'; // ≥12 chars, ≤72 bytes, not blocklisted

function build(o = {}) {
    const calls = { get: [], update: [], verify: [], hash: [], audit: [] };
    const userStore = {
        get: async (u) => { calls.get.push(u); return Object.prototype.hasOwnProperty.call(o, 'record') ? o.record : { username: u, passwordHash: 'STORED', roles: [], groups: -1, metadata: { mustRotate: true, tokenVersion: 2 } }; },
        update: async (u, patch) => { calls.update.push([u, patch]); },
    };
    const passwordHasher = {
        verify: (pw, h) => { calls.verify.push([pw, h]); return o.verify === true; },
        hash: (pw) => { calls.hash.push(pw); return 'HASH(' + pw + ')'; },
    };
    const auditLogger = { record: (e) => calls.audit.push(e) };
    const svc = new AccountService({ userStore, passwordHasher, auditLogger, settings: o.settings });
    return { svc, calls };
}

describe('Feature: auth-user-management — Account_Service.rotatePassword (design/12 §4 · REQ-17.2/17.3)', () => {

    it('AC-17.3 rotated: correct current + valid new ⇒ new hash persisted, mustRotate cleared, tokenVersion bumped, audited', async () => {
        const { svc, calls } = build({ verify: true });
        const res = await svc.rotatePassword({ username: 'admin' }, { currentPassword: 'one-time-secret', newPassword: VALID_NEW });
        assert.equal(res.kind, 'rotated');
        assert.deepEqual(calls.verify[0], ['one-time-secret', 'STORED'], 'current secret verified against the stored hash');
        const [u, patch] = calls.update[0];
        assert.equal(u, 'admin');
        assert.equal(patch.passwordHash, 'HASH(' + VALID_NEW + ')', 'new secret re-hashed and persisted verbatim');
        assert.equal(patch.metadata.mustRotate, false, 'gate cleared (AC-17.3)');
        assert.equal(patch.metadata.tokenVersion, 3, 'tokenVersion bumped 2→3 (D-015/D-027 active revocation)');
        assert.ok(calls.audit.some((e) => e.operation === 'user.update' && e.outcome === 'rotated' && e.subject === 'admin'));
    });

    it('bad_current: wrong current secret ⇒ bad_current, NO update, gate NOT cleared', async () => {
        const { svc, calls } = build({ verify: false });
        const res = await svc.rotatePassword({ username: 'admin' }, { currentPassword: 'wrong', newPassword: VALID_NEW });
        assert.equal(res.kind, 'bad_current');
        assert.equal(res.error, 'bad_current_password');
        assert.deepEqual(calls.update, [], 'no write on a bad current secret');
        assert.deepEqual(calls.hash, [], 'no new hash computed on a bad current secret');
    });

    it('missing account / blank stored hash ⇒ bad_current (defensive, no update)', async () => {
        const missing = build({ record: undefined });
        assert.equal((await missing.svc.rotatePassword({ username: 'ghost' }, { currentPassword: 'x', newPassword: VALID_NEW })).kind, 'bad_current');
        const blank = build({ record: { username: 'a', passwordHash: '', metadata: {} } });
        assert.equal((await blank.svc.rotatePassword({ username: 'a' }, { currentPassword: 'x', newPassword: VALID_NEW })).kind, 'bad_current');
        assert.deepEqual(missing.calls.update, []);
        assert.deepEqual(blank.calls.update, []);
    });

    it('invalid_new: reuse of the current secret, or a weak/blocklisted/oversized new secret ⇒ invalid_new, no update, no flag clear', async () => {
        const cases = [
            { current: 'same-secret-here', next: 'same-secret-here', why: 'reuse of current' },
            { current: 'one-time-secret', next: 'short', why: 'below 12-char min' },
            { current: 'one-time-secret', next: 'password1234', why: 'blocklisted' },
            { current: 'one-time-secret', next: 'a'.repeat(73), why: '>72 bytes' },
            { current: 'one-time-secret', next: '', why: 'empty new' },
        ];
        for (const c of cases) {
            const { svc, calls } = build({ verify: true });
            const res = await svc.rotatePassword({ username: 'admin' }, { currentPassword: c.current, newPassword: c.next });
            assert.equal(res.kind, 'invalid_new', c.why);
            assert.equal(res.error, 'weak_or_reused_password', c.why);
            assert.deepEqual(calls.update, [], 'no write on invalid new: ' + c.why);
        }
    });

    it('constructor rejects incomplete dependencies', () => {
        assert.throws(() => new AccountService(/** @type {any} */({})), /userStore/);
    });
});

describe('Feature: auth-user-management — Property 9: bootstrap gate (design/12 §9 · P-009)', () => {

    // Seeded admin: groups -1 ⇒ ADMIN_PERMISSION_SET via §05 groupCodeAdmin, no RBAC role needed.
    const authz = new AuthorizationService({ roleStore: { get: async () => undefined } });

    it('Property 9: a mustRotate seeded admin is denied EVERY op except account.rotatePassword; after clearing, regains admin authority', async function () {
        this.timeout(30000);
        const POOL = [...ADMIN_PERMISSION_SET, 'account.rotatePassword', 'project.view', 'alarms.ack'];
        const permArb = fc.oneof(fc.constantFrom(...POOL), fc.constant('unmapped.perm'), fc.string());

        await fc.assert(fc.asyncProperty(permArb, async (requiredPermission) => {
            const op = { id: requiredPermission, requiredPermission };

            // Pre-rotation (mustRotate:true): only account.rotatePassword is allowed — even the admin
            // perms it holds via groups:-1 are denied (the gate precedes membership).
            const gated = { authenticated: true, roles: [], groups: -1, mustRotate: true };
            const gatedDecision = await authz.isAllowed(gated, op);
            if (requiredPermission === 'account.rotatePassword') {
                assert.deepEqual(gatedDecision, { allow: true }, 'rotation permitted while gated');
            } else {
                assert.deepEqual(gatedDecision, { allow: false, status: 403, error: 'forbidden' }, 'everything else denied while gated');
            }

            // Post-rotation (mustRotate:false): governed by membership → admin perms regained.
            const rotated = { authenticated: true, roles: [], groups: -1, mustRotate: false };
            const rotatedDecision = await authz.isAllowed(rotated, op);
            if (ADMIN_PERMISSION_SET.includes(requiredPermission)) {
                assert.deepEqual(rotatedDecision, { allow: true }, 'admin perm allowed after rotation');
            } else if (requiredPermission !== 'account.rotatePassword' && typeof requiredPermission === 'string' && requiredPermission !== '') {
                // A non-admin, non-rotate permission the seeded admin does not hold ⇒ still 403.
                assert.deepEqual(rotatedDecision, { allow: false, status: 403, error: 'forbidden' });
            }
        }), { numRuns: 200 });
    });
});
