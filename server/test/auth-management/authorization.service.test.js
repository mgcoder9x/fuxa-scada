//@ts-check
'use strict';

/**
 * Feature: auth-user-management — Authorization_Service (design/05-rbac-authorization.md · REQ-10,
 * REQ-17 gate). Task 8.
 *
 * Covers task 8.3 (Property 6 — decision determinism, P-006 owned by §05 §9.1), task 8.5 (the
 * decision truth table: 401 unauthenticated / 403 unpermitted / allow-on-grant / admin-role &
 * group-code compat / fail-closed unknown permission / bootstrap gate) and the `isAdministrator`
 * predicate (§5.3), and task 8.6 (Property 13 — live-account authority + active revocation, P-013
 * owned by §05 §9.1b, D-015/D-027, exercised through the pure `resolveIdentity`, D-032).
 *
 * The service is pure over an injected `Role_Store.get`, so these tests use an in-memory role→perm
 * Map (no DB, no clock, no HTTP) — the same seam the middleware (Task 13) will feed. Toolchain
 * (N-023/N-025): `node:assert/strict` + `fast-check@3`.
 *
 * DEF-R2 regression (N-036): a `mustRotate` seeded admin (`groups:-1`, whose effective set is
 * ADMIN_PERMISSION_SET WITHOUT `account.rotatePassword`) MUST be ALLOWED to rotate — the gate's
 * allow-half (P-009 §12 §9), which the deny-only wording had omitted.
 */

const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
    AuthorizationService,
    ADMIN_PERMISSION_SET,
} = require('../../auth-management/services/authorization.service');

/** A fake Role_Store: `get(id)` returns the role from a fixed Map (deterministic, pure). */
function roleStoreFrom(roleMap) {
    return { get: async (id) => roleMap.get(id) };
}

/** Build a service whose roles resolve from a plain `{ id: permissions[] }` object. */
function serviceWith(rolePerms) {
    const roleMap = new Map();
    for (const id of Object.keys(rolePerms)) {
        roleMap.set(id, { id, name: id, permissions: rolePerms[id] });
    }
    return new AuthorizationService({ roleStore: roleStoreFrom(roleMap) });
}

const ADMIN = [...ADMIN_PERMISSION_SET];

describe('Feature: auth-user-management — Authorization_Service decision (design/05 · REQ-10)', () => {

    it('constructor rejects a roleStore without get(id)', () => {
        assert.throws(() => new AuthorizationService({}), /roleStore/);
        assert.throws(() => new AuthorizationService(/** @type {any} */(null)), /roleStore/);
    });

    // -------------------------------------------------------------------------
    // Task 8.5 — AC-10.3: unauthenticated ⇒ 401, no permission resolution
    // -------------------------------------------------------------------------
    it('AC-10.3: an unauthenticated identity (false / guest / missing) ⇒ 401 unauthorized_error, no resolution', async () => {
        let resolved = false;
        const spySvc = new AuthorizationService({ roleStore: { get: async (id) => { resolved = true; return undefined; } } });
        for (const identity of [
            { authenticated: false, roles: ['r_admin'], groups: -1 },
            { authenticated: false, groups: ['guest'] },
            null,
            undefined,
        ]) {
            const d = await spySvc.isAllowed(/** @type {any} */(identity), { id: 'user.create', requiredPermission: 'user.create' });
            assert.deepEqual(d, { allow: false, status: 401, error: 'unauthorized_error' });
        }
        assert.equal(resolved, false, 'no role resolution occurs for an unauthenticated identity');
    });

    // -------------------------------------------------------------------------
    // Task 8.5 — AC-10.1 grant ⇒ allow; AC-10.2 no grant ⇒ 403; fail-closed unknown perm
    // -------------------------------------------------------------------------
    it('AC-10.1 grant ⇒ allow; AC-10.2 no grant ⇒ 403 forbidden', async () => {
        const svc = serviceWith({ r_viewer: ['user.read', 'role.read'] });
        const viewer = { authenticated: true, roles: ['r_viewer'], groups: 3 };
        assert.deepEqual(await svc.isAllowed(viewer, { id: 'user.read', requiredPermission: 'user.read' }), { allow: true });
        assert.deepEqual(
            await svc.isAllowed(viewer, { id: 'user.delete', requiredPermission: 'user.delete' }),
            { allow: false, status: 403, error: 'forbidden' });
    });

    it('fail-closed: an unknown/unmapped or missing requiredPermission ⇒ 403 (never allow on absence)', async () => {
        const svc = serviceWith({ r_admin: ADMIN });
        const admin = { authenticated: true, roles: ['r_admin'], groups: 3 };
        assert.deepEqual(await svc.isAllowed(admin, { id: 'x', requiredPermission: 'not.a.real.perm' }), { allow: false, status: 403, error: 'forbidden' });
        assert.deepEqual(await svc.isAllowed(admin, { id: 'x', requiredPermission: '' }), { allow: false, status: 403, error: 'forbidden' });
        assert.deepEqual(await svc.isAllowed(admin, /** @type {any} */({ id: 'x' })), { allow: false, status: 403, error: 'forbidden' });
    });

    // -------------------------------------------------------------------------
    // Task 8.5 — AC-10.4: admin role & legacy group codes allow user.*/role.*
    // -------------------------------------------------------------------------
    it('AC-10.4: an admin ROLE (superset of ADMIN_PERMISSION_SET) allows every user.*/role.* op', async () => {
        const svc = serviceWith({ r_admin: ADMIN });
        const admin = { authenticated: true, roles: ['r_admin'], groups: 3 };
        for (const p of ADMIN) {
            assert.deepEqual(await svc.isAllowed(admin, { id: p, requiredPermission: p }), { allow: true }, p + ' allowed for admin role');
        }
    });

    it('AC-10.4 compat: legacy group codes 255 and -1 inject the admin set (additive); other numeric codes grant nothing', async () => {
        const svc = serviceWith({}); // no roles at all — authority comes only from the group code
        for (const g of [255, -1]) {
            const gAdmin = { authenticated: true, roles: [], groups: g };
            for (const p of ADMIN) {
                assert.deepEqual(await svc.isAllowed(gAdmin, { id: p, requiredPermission: p }), { allow: true }, 'groups=' + g + ' allows ' + p);
            }
        }
        const plain = { authenticated: true, roles: [], groups: 7 };
        assert.deepEqual(await svc.isAllowed(plain, { id: 'user.read', requiredPermission: 'user.read' }), { allow: false, status: 403, error: 'forbidden' },
            'a non-admin numeric group code contributes no permission');
    });

    it('an unknown role id in identity.roles contributes nothing (dangling reference cannot grant)', async () => {
        const svc = serviceWith({ r_admin: ADMIN });
        const dangling = { authenticated: true, roles: ['r_does_not_exist'], groups: 3 };
        assert.deepEqual(await svc.isAllowed(dangling, { id: 'user.read', requiredPermission: 'user.read' }), { allow: false, status: 403, error: 'forbidden' });
    });

    // -------------------------------------------------------------------------
    // Task 8.5 — Bootstrap gate (AC-17.2) + DEF-R2 regression (N-036)
    // -------------------------------------------------------------------------
    it('AC-17.2 bootstrap gate: a mustRotate admin is 403 on every op EXCEPT account.rotatePassword (which is ALLOWED — DEF-R2/P-009)', async () => {
        const svc = serviceWith({}); // seeded admin authority is the -1 group code, no RBAC role
        const seeded = { authenticated: true, roles: [], groups: -1, mustRotate: true };

        // The allow-half: rotation is permitted even though account.rotatePassword ∉ effective set.
        assert.deepEqual(
            await svc.isAllowed(seeded, { id: 'account.rotatePassword', requiredPermission: 'account.rotatePassword' }),
            { allow: true }, 'seeded admin MUST be able to rotate its own password (no bootstrap deadlock)');

        // The deny-half: every other op — including the admin perms it would otherwise hold — is 403.
        for (const p of [...ADMIN, 'role.read', 'not.a.real.perm']) {
            assert.deepEqual(
                await svc.isAllowed(seeded, { id: p, requiredPermission: p }),
                { allow: false, status: 403, error: 'forbidden' }, 'gate denies ' + p + ' while mustRotate');
        }
    });

    it('after mustRotate clears, the same admin regains full admin authority (AC-17.3)', async () => {
        const svc = serviceWith({});
        const rotated = { authenticated: true, roles: [], groups: -1, mustRotate: false };
        for (const p of ADMIN) {
            assert.deepEqual(await svc.isAllowed(rotated, { id: p, requiredPermission: p }), { allow: true }, p + ' regained after rotation');
        }
    });

    // -------------------------------------------------------------------------
    // Task 8.5 — isAdministrator predicate (§5.3, single owner)
    // -------------------------------------------------------------------------
    it('isAdministrator: true for an admin-role subject and for group codes 255/-1; false otherwise', async () => {
        const svc = serviceWith({ r_admin: ADMIN, r_partial: ['user.create', 'user.read'] });
        assert.equal(await svc.isAdministrator({ roles: ['r_admin'], groups: 3 }), true, 'admin role ⇒ admin');
        assert.equal(await svc.isAdministrator({ roles: [], groups: 255 }), true, 'group 255 ⇒ admin');
        assert.equal(await svc.isAdministrator({ roles: [], groups: -1 }), true, 'group -1 ⇒ admin');
        assert.equal(await svc.isAdministrator({ roles: ['r_partial'], groups: 3 }), false, 'a partial admin permission set is NOT an administrator');
        assert.equal(await svc.isAdministrator({ roles: [], groups: 7 }), false, 'plain user is not an administrator');
    });

    // -------------------------------------------------------------------------
    // Task 8.3 — Property 6: authorization decisions are deterministic (P-006, owner §05 §9.1)
    // -------------------------------------------------------------------------
    it('Property 6: authorization decisions are deterministic for an unchanged identity + operation', async function () {
        this.timeout(30000);
        const PERM_POOL = [...ADMIN, 'account.rotatePassword', 'project.view', 'alarms.ack'];
        const ROLE_IDS = ['r_admin', 'r_viewer', 'r_ops', 'r_empty', 'r_unknown_ref'];

        // Role→permission snapshot spanning admin, partial, empty, and (deliberately) a role id that
        // is referenced by identities but NOT present in the store (dangling → contributes nothing).
        const rolePermsArb = fc.record({
            r_admin: fc.constant([...ADMIN]),
            r_viewer: fc.constant(['user.read', 'role.read']),
            r_ops: fc.array(fc.constantFrom(...PERM_POOL), { maxLength: 4 }),
            r_empty: fc.constant([]),
        });
        const identityArb = fc.record({
            username: fc.string({ minLength: 1 }),
            authenticated: fc.boolean(),
            roles: fc.array(fc.constantFrom(...ROLE_IDS), { maxLength: 3 }),
            groups: fc.oneof(fc.constant(255), fc.constant(-1), fc.constant('guest'), fc.integer()),
            mustRotate: fc.boolean(),
        });
        const operationArb = fc.record({
            id: fc.string(),
            requiredPermission: fc.oneof(fc.constantFrom(...PERM_POOL), fc.constant('unmapped.permission'), fc.string()),
        });

        await fc.assert(fc.asyncProperty(rolePermsArb, identityArb, operationArb, async (rolePerms, identity, op) => {
            const svc = serviceWith(rolePerms);
            const d1 = await svc.isAllowed(identity, op);
            const d2 = await svc.isAllowed(identity, op); // no mutation between calls
            assert.deepEqual(d1, d2, 'same inputs ⇒ identical decision (allow flag + status/error)');
            // Sanity: the decision is always one of the three closed shapes.
            assert.ok(
                (d1.allow === true) ||
                (d1.allow === false && d1.status === 401 && d1.error === 'unauthorized_error') ||
                (d1.allow === false && d1.status === 403 && d1.error === 'forbidden'),
                'decision is a member of the closed Decision set');
        }), { numRuns: 200 });
    });
});

describe('Feature: auth-user-management — live-account authority (design/05 · §4.1/§9.1b · D-015/D-027/D-032)', () => {

    const svc = new AuthorizationService({ roleStore: { get: async () => undefined } });

    // -------------------------------------------------------------------------
    // Task 8.6 deterministic anchors — resolveIdentity uses the LIVE record, not token claims
    // -------------------------------------------------------------------------
    it('null/absent claims ⇒ authenticated:false', () => {
        assert.deepEqual(svc.resolveIdentity(/** @type {any} */(null), { username: 'a', roles: [], groups: 1, metadata: {} }), { authenticated: false });
    });

    it('a deleted (absent) account ⇒ authenticated:false (denied on the next request)', () => {
        assert.deepEqual(svc.resolveIdentity({ id: 'a', tokenVersion: 0 }, undefined), { authenticated: false });
    });

    it('a disabled account ⇒ authenticated:false', () => {
        const rec = { username: 'a', roles: ['admin'], groups: -1, metadata: { disabled: true } };
        assert.deepEqual(svc.resolveIdentity({ id: 'a', tokenVersion: 0 }, rec), { authenticated: false });
    });

    it('authority comes from the LIVE record, NOT the token claims (a role change takes effect next request)', () => {
        // Token still claims superadmin; the live record says viewer → the identity is viewer.
        const claims = { id: 'a', tokenVersion: 2, roles: ['superadmin'], groups: 255 };
        const rec = { username: 'alice', roles: ['viewer'], groups: 3, metadata: { tokenVersion: 2, mustRotate: false } };
        const id = svc.resolveIdentity(claims, rec);
        assert.equal(id.authenticated, true);
        assert.equal(id.username, 'alice');
        assert.deepEqual(id.roles, ['viewer'], 'roles from the record, not the token');
        assert.equal(id.groups, 3, 'groups from the record, not the token');
        assert.equal(id.mustRotate, false);
    });

    it('D-027 active revocation: a token below the account tokenVersion ⇒ authenticated:false; equal/absent-both ⇒ allowed', () => {
        const recV1 = { username: 'a', roles: [], groups: 3, metadata: { tokenVersion: 1 } };
        assert.equal(svc.resolveIdentity({ id: 'a', tokenVersion: 0 }, recV1).authenticated, false, 'legacy tokenVersion 0 < account 1 ⇒ revoked');
        assert.equal(svc.resolveIdentity({ id: 'a' /* absent ⇒ 0 */ }, recV1).authenticated, false, 'absent token version (0) < 1 ⇒ revoked (DEF-T5)');
        assert.equal(svc.resolveIdentity({ id: 'a', tokenVersion: 1 }, recV1).authenticated, true, 'equal version ⇒ allowed');
        const recV0 = { username: 'a', roles: [], groups: 3, metadata: {} };
        assert.equal(svc.resolveIdentity({ id: 'a' }, recV0).authenticated, true, 'both absent ⇒ 0<0 false ⇒ allowed (backward compat)');
    });

    // -------------------------------------------------------------------------
    // Task 8.6 — Property 13: deleted/downgraded/version-revoked account is denied; live governs
    // -------------------------------------------------------------------------
    it('Property 13: the live account (not token claims) governs; absent/disabled/version-below ⇒ authenticated:false', async function () {
        this.timeout(30000);
        const claimsArb = fc.record({
            id: fc.string({ minLength: 1 }),
            tokenVersion: fc.oneof(fc.nat(5), fc.constant(undefined)),
            roles: fc.array(fc.string(), { maxLength: 3 }),   // token roles — MUST be ignored
            groups: fc.oneof(fc.constant(255), fc.integer()), // token groups — MUST be ignored
        });
        const recordArb = fc.oneof(
            fc.constant(undefined), // absent (deleted) account
            fc.record({
                username: fc.string({ minLength: 1 }),
                roles: fc.array(fc.string(), { maxLength: 3 }),
                groups: fc.oneof(fc.constant(-1), fc.constant(3), fc.integer()),
                metadata: fc.record({
                    tokenVersion: fc.oneof(fc.nat(5), fc.constant(undefined)),
                    disabled: fc.boolean(),
                    mustRotate: fc.boolean(),
                }),
            })
        );

        await fc.assert(fc.property(claimsArb, recordArb, (claims, record) => {
            const id = svc.resolveIdentity(claims, record);

            if (!record) { assert.deepEqual(id, { authenticated: false }, 'absent account denied'); return; }
            if (record.metadata.disabled === true) { assert.deepEqual(id, { authenticated: false }, 'disabled account denied'); return; }

            const tokenVer = Number(claims.tokenVersion) || 0;
            const acctVer = Number(record.metadata.tokenVersion) || 0;
            if (tokenVer < acctVer) { assert.deepEqual(id, { authenticated: false }, 'token below account version revoked'); return; }

            // Otherwise authenticated, carrying the LIVE record's authority (never the token's).
            assert.equal(id.authenticated, true);
            assert.equal(id.username, record.username);
            assert.deepEqual(id.roles, record.roles, 'roles from the live record');
            assert.equal(id.groups, record.groups, 'groups from the live record');
            assert.equal(id.mustRotate, !!record.metadata.mustRotate);
        }), { numRuns: 200 });
    });
});
