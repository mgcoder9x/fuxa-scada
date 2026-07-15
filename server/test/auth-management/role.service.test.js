//@ts-check
'use strict';

/**
 * Feature: auth-user-management — Role_Service (design/05-rbac-authorization.md · REQ-9). Task 8.
 *
 * Covers task 8.5 (role-CRUD unit/edge) and task 8.4 (Property 11 — role-deletion prune invariant,
 * P-011, owner §05 §9.3). The service runs over the REAL `FuxaRoleStoreAdapter` +
 * `FuxaUserStoreAdapter` on a REAL in-memory sqlite `FuxaAuthDb`, so the full outcome → adapter →
 * SQL → resilient-parse path is exercised end-to-end (no store mocks); the audit sink is a
 * call-recording double. The role-delete prune uses the adapter's own-connection fallback (no
 * `runtimeUsers` injected) — the same prune-then-delete effect FUXA's verified `removeRoles` has.
 *
 * Toolchain (N-023/N-025): `node:assert/strict` + `fast-check@3` + real `sqlite3`. In-memory DB
 * (`:memory:`) keeps the 100+ iteration Property 11 fast and fsync-free (the N-033 stability lesson).
 */

const assert = require('node:assert/strict');
const fc = require('fast-check');

const { FuxaAuthDb } = require('../../auth-management/store/fuxa-auth-db');
const { FuxaUserStoreAdapter } = require('../../auth-management/adapters/fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('../../auth-management/adapters/fuxa-role-store.adapter');
const { RoleService } = require('../../auth-management/services/role.service');

/** @type {FuxaAuthDb} */ let db;
/** @type {FuxaUserStoreAdapter} */ let userStore;
/** @type {FuxaRoleStoreAdapter} */ let roleStore;
/** @type {any[]} */ let auditEvents;
/** @type {RoleService} */ let svc;

async function resetTables() {
    await db.run('DELETE FROM users', []);
    await db.run('DELETE FROM roles', []);
}

before(async function () {
    this.timeout(15000);
    // A single shared in-memory connection: FuxaAuthDb keeps ONE connection, so `:memory:` persists
    // across calls within this file (and both adapters share it, which the own-connection role-delete
    // prune requires — it reads the `users` table the user adapter wrote).
    db = new FuxaAuthDb({ dbFile: ':memory:' });
    await db.exec('CREATE TABLE if not exists users (username TEXT PRIMARY KEY, fullname TEXT, password TEXT, groups INTEGER, info TEXT);');
    await db.exec('CREATE TABLE if not exists roles (name TEXT PRIMARY KEY, value TEXT);');
    userStore = new FuxaUserStoreAdapter({ db });   // no runtimeUsers → own-connection reads/writes
    roleStore = new FuxaRoleStoreAdapter({ db });   // no runtimeUsers → own-connection prune fallback
    auditEvents = [];
    svc = new RoleService({ roleStore, userStore, auditLogger: { record: (e) => auditEvents.push(e) } });
});

after(async function () {
    if (db) await db.close();
});

beforeEach(async () => {
    auditEvents.length = 0;
    await resetTables();
});

describe('Feature: auth-user-management — Role_Service (design/05 · REQ-9)', () => {

    // -------------------------------------------------------------------------
    // Task 8.5 — create (AC-9.1) / duplicate reject (AC-9.5) / shape guard
    // -------------------------------------------------------------------------
    it('AC-9.1 create: a valid role is persisted and returned; a role.create audit event is emitted', async () => {
        const res = await svc.create({ id: 'ops', name: 'Operations', permissions: ['user.read', 'role.read'] });
        assert.equal(res.kind, 'created');
        assert.deepEqual(res.role, { id: 'ops', name: 'Operations', permissions: ['user.read', 'role.read'] });
        const back = await roleStore.get('ops');
        assert.equal(back.name, 'Operations');
        assert.deepEqual(new Set(back.permissions), new Set(['user.read', 'role.read']));
        const ev = auditEvents.find((e) => e.operation === 'role.create');
        assert.ok(ev, 'role.create audited');
        assert.equal(ev.category, 'role');
        assert.equal(ev.subject, 'ops');
        assert.equal(ev.outcome, 'success');
    });

    it('AC-9.5 duplicate: a second create of the same id is rejected atomically WITHOUT overwriting; no audit', async () => {
        await svc.create({ id: 'dup', name: 'First', permissions: ['user.read'] });
        auditEvents.length = 0;
        const res = await svc.create({ id: 'dup', name: 'Second', permissions: ['user.delete'] });
        assert.equal(res.kind, 'duplicate');
        assert.equal(res.error, 'duplicate_role');
        assert.equal(res.name, 'dup');
        const back = await roleStore.get('dup');
        assert.equal(back.name, 'First', 'existing role left unmodified (no INSERT OR REPLACE)');
        assert.deepEqual(new Set(back.permissions), new Set(['user.read']));
        assert.equal(auditEvents.some((e) => e.operation === 'role.create'), false, 'a rejected create is not audited as success');
    });

    it('shape guard: missing name / non-string permissions → validation_error, no store write', async () => {
        for (const bad of [
            null,
            { id: 'x', permissions: [] },                       // missing name
            { id: '  ', name: 'n', permissions: [] },            // blank id
            { id: 'x', name: 'n', permissions: 'notarray' },     // permissions not an array
            { id: 'x', name: 'n', permissions: [1, 2] },         // permissions not strings
        ]) {
            const res = await svc.create(/** @type {any} */(bad));
            assert.equal(res.kind, 'invalid');
            assert.equal(res.error, 'validation_error');
            assert.ok(res.detail && res.detail.length > 0);
        }
        const { records } = await roleStore.readAll();
        assert.equal(records.length, 0, 'no invalid role was written');
    });

    // -------------------------------------------------------------------------
    // Task 8.5 — list (AC-9.2)
    // -------------------------------------------------------------------------
    it('AC-9.2 list: returns every stored role with name + permissions', async () => {
        await svc.create({ id: 'a', name: 'A', permissions: ['user.read'] });
        await svc.create({ id: 'b', name: 'B', permissions: ['role.read', 'role.update'] });
        const res = await svc.list();
        assert.equal(res.kind, 'ok');
        const byId = Object.fromEntries(res.roles.map((r) => [r.id, r]));
        assert.equal(byId.a.name, 'A');
        assert.deepEqual(new Set(byId.b.permissions), new Set(['role.read', 'role.update']));
    });

    // -------------------------------------------------------------------------
    // Task 8.5 — update replaces wholesale (AC-9.3)
    // -------------------------------------------------------------------------
    it('AC-9.3 update: replaces the permission set wholesale (not a merge); empty set demotes', async () => {
        await svc.create({ id: 'r', name: 'R', permissions: ['user.read', 'user.update'] });
        const res = await svc.update('r', ['role.read']);
        assert.equal(res.kind, 'updated');
        const back = await roleStore.get('r');
        assert.deepEqual(new Set(back.permissions), new Set(['role.read']), 'old perms removed, only the submitted set remains');
        assert.equal(back.name, 'R', 'display name preserved');

        const demote = await svc.update('r', []);
        assert.equal(demote.kind, 'updated');
        assert.deepEqual((await roleStore.get('r')).permissions, [], 'empty submitted set = demotion, not a validation error');
    });

    it('update of an unknown role → role_not_found, no write; invalid permissions → validation_error', async () => {
        const unknown = await svc.update('ghost', ['user.read']);
        assert.equal(unknown.kind, 'unknown_role');
        assert.equal(unknown.error, 'role_not_found');

        await svc.create({ id: 'r', name: 'R', permissions: ['user.read'] });
        const invalid = await svc.update('r', /** @type {any} */('notarray'));
        assert.equal(invalid.kind, 'invalid');
        assert.equal(invalid.error, 'validation_error');
        assert.deepEqual((await roleStore.get('r')).permissions, ['user.read'], 'no write on invalid update');
    });

    // -------------------------------------------------------------------------
    // Task 8.5 — delete + prune (AC-9.4) integration
    // -------------------------------------------------------------------------
    it('AC-9.4 delete: removes the role rows AND prunes the ids from every referencing user; reports prunedUsers', async () => {
        await svc.create({ id: 'gone', name: 'Gone', permissions: [] });
        await svc.create({ id: 'keep', name: 'Keep', permissions: [] });
        await userStore.create({ username: 'u1', fullname: 'U1', passwordHash: 'h', roles: ['gone', 'keep'], metadata: {} });
        await userStore.create({ username: 'u2', fullname: 'U2', passwordHash: 'h', roles: ['keep'], metadata: {} });

        const res = await svc.delete(['gone']);
        assert.equal(res.kind, 'deleted');
        assert.deepEqual(res.removed, ['gone']);
        assert.deepEqual(res.prunedUsers, ['u1'], 'only the user that referenced the deleted id is reported pruned');
        assert.equal(await roleStore.get('gone'), undefined, 'role row deleted');
        assert.deepEqual(new Set((await userStore.get('u1')).roles), new Set(['keep']), 'deleted id pruned from u1, keep retained');
        assert.deepEqual((await userStore.get('u2')).roles, ['keep'], 'unaffected user unchanged');
        assert.ok(auditEvents.some((e) => e.operation === 'role.delete'), 'role.delete audited');
    });

    it('delete is idempotent for an unknown id and a no-op for an empty list', async () => {
        const empty = await svc.delete([]);
        assert.deepEqual(empty, { kind: 'deleted', removed: [], prunedUsers: [] });
        const unknown = await svc.delete(['does-not-exist']);
        assert.equal(unknown.kind, 'deleted');
        assert.deepEqual(unknown.prunedUsers, [], 'no user referenced the unknown id');
    });

    // -------------------------------------------------------------------------
    // Task 8.4 — Property 11: role deletion prunes all references (P-011, owner §05 §9.3)
    // -------------------------------------------------------------------------
    it('Property 11: after Role_Service.delete, no surviving user references a deleted role id and no deleted role remains', async function () {
        this.timeout(30000);
        const ALL_ROLES = ['role_a', 'role_b', 'role_c', 'role_d'];
        await fc.assert(fc.asyncProperty(
            // A user population: each entry is a role-id list; the username is its index (unique PKs).
            fc.array(fc.array(fc.constantFrom(...ALL_ROLES), { maxLength: 4 }), { maxLength: 6 }),
            // The subset of roles to delete.
            fc.subarray(ALL_ROLES),
            async (population, toDelete) => {
                await resetTables();
                // Seed the four roles and the user population.
                for (const id of ALL_ROLES) {
                    await svc.create({ id, name: id.toUpperCase(), permissions: [] });
                }
                for (let i = 0; i < population.length; i++) {
                    await userStore.create({ username: 'u' + i, fullname: 'U' + i, passwordHash: 'h', roles: population[i], metadata: {} });
                }

                const res = await svc.delete(toDelete);
                assert.equal(res.kind, 'deleted');

                const deleted = new Set(toDelete);
                // (1) No deleted role remains in the store.
                for (const id of toDelete) {
                    assert.equal(await roleStore.get(id), undefined, 'deleted role ' + id + ' removed from store');
                }
                // (2) No surviving user references any deleted role id.
                const { records } = await userStore.readAll();
                for (const u of records) {
                    for (const rid of u.roles) {
                        assert.equal(deleted.has(rid), false, 'user ' + u.username + ' still references deleted role ' + rid);
                    }
                }
                // (3) prunedUsers = exactly the users that referenced a deleted id (accurate, not fabricated).
                const expectedPruned = new Set();
                for (let i = 0; i < population.length; i++) {
                    if (population[i].some((r) => deleted.has(r))) expectedPruned.add('u' + i);
                }
                assert.deepEqual(new Set(res.prunedUsers), expectedPruned);
            }
        ), { numRuns: 120 });
    });
});
