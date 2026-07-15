//@ts-check
'use strict';

/**
 * Feature: auth-user-management — User_Service (design/04-user-management.md · REQ-5/6/7/8). Task 9.
 *
 * Two layers of coverage:
 *  (A) EXAMPLE/EDGE with test doubles (task 9.2) — isolates the service decision logic for every
 *      CRUD outcome, the password policy (AC-4.6/4.7 + D-025), the DEF-U2 create `invalid` variant,
 *      hash-only persistence (AC-5.4), retain-hash-on-omit (AC-7.3), and the delete outcome mapping.
 *  (B) INTEGRATION + CONCURRENCY with REAL adapters on an in-memory `FuxaAuthDb` — create→get
 *      round-trip and retain-hash with real bcrypt, the last-admin guard (single/non-last), and
 *      **Property 16** (P-016): under concurrent last-admin deletes the admin count never reaches
 *      zero (the atomic `deleteGuarded` critical section, D-020/D-033, closes the N-016 TOCTOU).
 *
 * Toolchain (N-023/N-025): `node:assert/strict` + `fast-check@3` + real `sqlite3`/`bcryptjs`.
 */

const assert = require('node:assert/strict');
const fc = require('fast-check');
const bcrypt = require('bcryptjs');

const { UserService } = require('../../auth-management/services/user.service');
const { FuxaAuthDb } = require('../../auth-management/store/fuxa-auth-db');
const { FuxaUserStoreAdapter } = require('../../auth-management/adapters/fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('../../auth-management/adapters/fuxa-role-store.adapter');
const { AuthorizationService } = require('../../auth-management/services/authorization.service');
const { Password_Hasher } = require('../../auth-management/services/password-hasher');
const { BcryptHasherAdapter } = require('../../auth-management/adapters/fuxa-bcrypt.adapter');

// =============================================================================
// (A) EXAMPLE / EDGE — service logic isolated with test doubles
// =============================================================================

const VALID_PW = 'correct horse battery'; // 22 chars, ≤72 bytes, not blocklisted

/**
 * Build the service with call-recording doubles. `o` overrides: record (get result, default
 * undefined), guardOutcome (deleteGuarded result, default {kind:'deleted'}), isAdmin (default false),
 * readAll (default []).
 */
function build(o = {}) {
    const calls = { get: [], create: [], update: [], delete: [], deleteGuarded: [], hash: [], audit: [], isAdmin: [] };
    const userStore = {
        get: async (u) => { calls.get.push(u); return Object.prototype.hasOwnProperty.call(o, 'record') ? o.record : undefined; },
        readAll: async () => ({ records: o.readAll || [], errors: [] }),
        create: async (rec) => { calls.create.push(rec); if (o.createThrows) throw o.createThrows; },
        update: async (u, patch) => { calls.update.push([u, patch]); },
        delete: async (u) => { calls.delete.push(u); },
        deleteGuarded: async (u, fn) => { calls.deleteGuarded.push([u, fn]); return o.guardOutcome || { kind: 'deleted' }; },
    };
    const passwordHasher = { hash: (pw) => { calls.hash.push(pw); return 'HASH(' + pw + ')'; } };
    const authorization = { isAdministrator: async (rec) => { calls.isAdmin.push(rec); return o.isAdmin === true; } };
    const auditLogger = { record: (e) => calls.audit.push(e) };
    const svc = new UserService({ userStore, passwordHasher, authorization, auditLogger, settings: o.settings });
    return { svc, calls };
}

describe('Feature: auth-user-management — User_Service CRUD (design/04 · REQ-5/6/7/8)', () => {

    it('AC-5.1 create success: created + hash-free UserView; hash called once; store received the hash, never plaintext', async () => {
        const { svc, calls } = build({ record: undefined });
        const res = await svc.create({ username: '  alice  ', fullname: 'Alice', password: VALID_PW, roles: ['viewer'], metadata: { dept: 'ops' } });
        assert.equal(res.kind, 'created');
        assert.deepEqual(res.user, { username: 'alice', fullname: 'Alice', roles: ['viewer'], metadata: { dept: 'ops' } });
        assert.equal(Object.prototype.hasOwnProperty.call(res.user, 'passwordHash'), false, 'view has no hash (AC-6.2)');
        assert.deepEqual(calls.hash, [VALID_PW], 'hash called once with the plaintext (AC-5.4)');
        assert.equal(calls.create.length, 1);
        assert.equal(calls.create[0].passwordHash, 'HASH(' + VALID_PW + ')', 'store got the hash');
        assert.equal(calls.create[0].username, 'alice', 'username trimmed (D-006)');
        assert.equal(Object.prototype.hasOwnProperty.call(calls.create[0], 'password'), false, 'plaintext never forwarded to the store');
        assert.ok(calls.audit.some((e) => e.operation === 'user.create' && e.outcome === 'success' && e.subject === 'alice'));
    });

    it('AC-5.2 duplicate (fast-path): existing record → duplicate; create never called', async () => {
        const { svc, calls } = build({ record: { username: 'alice', passwordHash: 'x', roles: [], metadata: {} } });
        const res = await svc.create({ username: 'alice', fullname: 'A', password: VALID_PW });
        assert.equal(res.kind, 'duplicate');
        assert.equal(res.error, 'duplicate_username');
        assert.deepEqual(calls.create, [], 'no write when a duplicate is detected');
        assert.deepEqual(calls.hash, [], 'no hashing for a duplicate');
    });

    it('AC-5.2 duplicate (atomic): store PK conflict (duplicate_key) → duplicate even if the pre-check missed it', async () => {
        const err = Object.assign(new Error('UNIQUE'), { code: 'duplicate_key' });
        const { svc } = build({ record: undefined, createThrows: err });
        const res = await svc.create({ username: 'racer', fullname: 'R', password: VALID_PW });
        assert.equal(res.kind, 'duplicate');
        assert.equal(res.error, 'duplicate_username');
    });

    it('AC-5.3 missing username: missing_field; no store touch', async () => {
        for (const req of [{ password: VALID_PW }, { username: '   ', password: VALID_PW }, {}]) {
            const { svc, calls } = build({});
            const res = await svc.create(req);
            assert.equal(res.kind, 'missing_field');
            assert.equal(res.field, 'username');
            assert.deepEqual(calls.get, [], 'no store lookup on a missing username');
        }
    });

    it('DEF-U2 create invalid: omitted/blank password + policy failures (AC-4.6/4.7 + D-025) → validation_error, no hash, no write', async () => {
        const cases = [
            { password: undefined, why: 'omitted' },
            { password: '', why: 'blank' },
            { password: 'short', why: 'below 12-char min (AC-4.7)' },
            { password: 'password1234', why: 'blocklisted (AC-4.7)' },
            { password: 'a'.repeat(73), why: '>72 bytes (AC-4.6)' },
            { password: '€'.repeat(25), why: '>72 UTF-8 bytes via multibyte (AC-4.6): 75 bytes' },
            { password: 'valid\uD83Dpad!!', why: 'malformed UTF-16 lone surrogate (D-025)' },
        ];
        for (const c of cases) {
            const { svc, calls } = build({ record: undefined });
            const res = await svc.create({ username: 'u', fullname: 'U', password: c.password });
            assert.equal(res.kind, 'invalid', c.why);
            assert.equal(res.error, 'validation_error', c.why);
            assert.ok(res.detail && res.detail.length > 0, c.why);
            assert.deepEqual(calls.hash, [], 'no hashing on a policy failure: ' + c.why);
            assert.deepEqual(calls.create, [], 'no store write on a policy failure: ' + c.why);
        }
    });

    it('a configurable min length + blocklist is honored (D-034)', async () => {
        const { svc } = build({ record: undefined, settings: { auth: { passwordMinLength: 6, passwordBlocklist: ['letmein'] } } });
        assert.equal((await svc.create({ username: 'u', password: 'abcdef' })).kind, 'created', '6 chars ok under min 6');
        assert.equal((await svc.create({ username: 'u2', password: 'LetMeIn' })).kind, 'invalid', 'blocklist is case-insensitive');
    });

    it('AC-6.1/6.2 list: one hash-free view per record', async () => {
        const { svc } = build({ readAll: [
            { username: 'a', fullname: 'A', passwordHash: 'H1', roles: ['r1'], metadata: { x: 1 } },
            { username: 'b', fullname: 'B', passwordHash: 'H2', roles: [], metadata: {} },
        ] });
        const res = await svc.list();
        assert.equal(res.kind, 'ok');
        assert.equal(res.users.length, 2);
        for (const u of res.users) {
            assert.equal(Object.prototype.hasOwnProperty.call(u, 'passwordHash'), false, 'no hash in list view');
            assert.equal(Object.prototype.hasOwnProperty.call(u, 'password'), false);
        }
        assert.deepEqual(res.users[0], { username: 'a', fullname: 'A', roles: ['r1'], metadata: { x: 1 } });
    });

    it('AC-6.3/6.4 get: found (exact view) vs empty (missing is NOT an error)', async () => {
        const found = build({ record: { username: 'a', fullname: 'A', passwordHash: 'H', roles: ['r1'], metadata: {} } });
        const r1 = await found.svc.get('a');
        assert.equal(r1.kind, 'found');
        assert.equal(Object.prototype.hasOwnProperty.call(r1.user, 'passwordHash'), false);
        const missing = build({ record: undefined });
        assert.deepEqual(await missing.svc.get('ghost'), { kind: 'empty' });
    });

    it('AC-7.1 update applies fields; AC-7.2 re-hashes a supplied password', async () => {
        const { svc, calls } = build({ record: { username: 'a', fullname: 'Old', passwordHash: 'H', roles: ['r1'], metadata: { a: 1 } } });
        const res = await svc.update('a', { fullname: 'New', roles: ['r2'], metadata: { b: 2 }, password: VALID_PW });
        assert.equal(res.kind, 'updated');
        assert.deepEqual(res.user, { username: 'a', fullname: 'New', roles: ['r2'], metadata: { b: 2 } });
        const [u, patch] = calls.update[0];
        assert.equal(u, 'a');
        assert.equal(patch.fullname, 'New');
        assert.deepEqual(patch.roles, ['r2']);
        assert.equal(patch.passwordHash, 'HASH(' + VALID_PW + ')', 're-hashed (AC-7.2)');
        assert.deepEqual(calls.hash, [VALID_PW]);
    });

    it('AC-7.3 retain-hash-on-omit: an update without password produces a patch with NO passwordHash and does not hash', async () => {
        const { svc, calls } = build({ record: { username: 'a', fullname: 'Old', passwordHash: 'H', roles: [], metadata: {} } });
        const res = await svc.update('a', { fullname: 'New' });
        assert.equal(res.kind, 'updated');
        const [, patch] = calls.update[0];
        assert.equal(Object.prototype.hasOwnProperty.call(patch, 'passwordHash'), false, 'no passwordHash in the patch (AC-7.3)');
        assert.deepEqual(calls.hash, [], 'hash not called when password omitted');
    });

    it('AC-7.4 update missing → unknown_user, no write; AC-7.5 invalid → validation_error, no write; password policy on update → invalid, no hash', async () => {
        const missing = build({ record: undefined });
        const r1 = await missing.svc.update('ghost', { fullname: 'X' });
        assert.equal(r1.kind, 'unknown_user');
        assert.equal(r1.error, 'user_not_found');
        assert.deepEqual(missing.calls.update, [], 'no write for a missing target');

        const badRoles = build({ record: { username: 'a', fullname: 'A', passwordHash: 'H', roles: [], metadata: {} } });
        const r2 = await badRoles.svc.update('a', { roles: /** @type {any} */([1, 2]) });
        assert.equal(r2.kind, 'invalid');
        assert.deepEqual(badRoles.calls.update, [], 'no write on invalid fields (AC-7.5)');

        const badPw = build({ record: { username: 'a', fullname: 'A', passwordHash: 'H', roles: [], metadata: {} } });
        const r3 = await badPw.svc.update('a', { password: 'short' });
        assert.equal(r3.kind, 'invalid');
        assert.deepEqual(badPw.calls.hash, [], 'no hash on a rejected password update');
        assert.deepEqual(badPw.calls.update, [], 'no write on a rejected password update');
    });

    it('metadata with a reserved top-level `roles` key is rejected (INV-1) on create and update', async () => {
        const c = build({ record: undefined });
        assert.equal((await c.svc.create({ username: 'u', password: VALID_PW, metadata: /** @type {any} */({ roles: ['x'] }) })).kind, 'invalid');
        const u = build({ record: { username: 'a', fullname: 'A', passwordHash: 'H', roles: [], metadata: {} } });
        assert.equal((await u.svc.update('a', { metadata: /** @type {any} */({ roles: ['x'] }) })).kind, 'invalid');
    });

    it('AC-8.1/8.2 delete: delegates to deleteGuarded with the §05 predicate; deleted → audited', async () => {
        const { svc, calls } = build({ guardOutcome: { kind: 'deleted' } });
        const res = await svc.delete('  bob  ');
        assert.equal(res.kind, 'deleted');
        assert.equal(calls.deleteGuarded.length, 1);
        assert.equal(calls.deleteGuarded[0][0], 'bob', 'username trimmed and passed to the atomic guard');
        assert.equal(typeof calls.deleteGuarded[0][1], 'function', 'the isAdministrator predicate is passed as a callback');
        assert.ok(calls.audit.some((e) => e.operation === 'user.delete' && e.outcome === 'success'));
    });

    it('AC-8.3 delete missing → unknown_user (mapped from the guard); AC-8.5 last_admin → last_admin, not audited as success', async () => {
        const unknown = build({ guardOutcome: { kind: 'unknown_user' } });
        const r1 = await unknown.svc.delete('ghost');
        assert.equal(r1.kind, 'unknown_user');
        assert.equal(r1.error, 'user_not_found');
        assert.equal(unknown.calls.audit.some((e) => e.operation === 'user.delete' && e.outcome === 'success'), false);

        const last = build({ guardOutcome: { kind: 'last_admin' } });
        const r2 = await last.svc.delete('admin');
        assert.equal(r2.kind, 'last_admin');
        assert.equal(r2.error, 'last_admin');
        assert.equal(last.calls.audit.some((e) => e.operation === 'user.delete' && e.outcome === 'success'), false);
    });

    it('constructor rejects incomplete dependencies', () => {
        assert.throws(() => new UserService(/** @type {any} */({})), /userStore/);
    });
});

// =============================================================================
// (B) INTEGRATION + CONCURRENCY — real adapters on an in-memory FuxaAuthDb
// =============================================================================

describe('Feature: auth-user-management — User_Service integration + P-016 (real sqlite/bcrypt)', () => {
    /** @type {FuxaAuthDb} */ let db;
    /** @type {FuxaUserStoreAdapter} */ let userStore;
    /** @type {FuxaRoleStoreAdapter} */ let roleStore;
    /** @type {AuthorizationService} */ let authorization;
    /** @type {UserService} */ let svc;
    /** @type {any[]} */ let auditEvents;

    async function resetTables() {
        await db.run('DELETE FROM users', []);
        await db.run('DELETE FROM roles', []);
    }

    /** Seed an admin directly (group-code -1, no roles → classified admin without any role read). */
    async function seedAdmin(username) {
        await userStore.create({ username, fullname: username, passwordHash: 'x', roles: [], metadata: {}, groups: -1 });
    }
    async function seedPlainUser(username) {
        await userStore.create({ username, fullname: username, passwordHash: 'x', roles: [], metadata: {}, groups: 3 });
    }
    async function adminCount() {
        const { records } = await userStore.readAll();
        let n = 0;
        for (const r of records) { if (await authorization.isAdministrator(r)) n++; }
        return n;
    }

    before(async function () {
        this.timeout(15000);
        db = new FuxaAuthDb({ dbFile: ':memory:' });
        await db.exec('CREATE TABLE if not exists users (username TEXT PRIMARY KEY, fullname TEXT, password TEXT, groups INTEGER, info TEXT);');
        await db.exec('CREATE TABLE if not exists roles (name TEXT PRIMARY KEY, value TEXT);');
        userStore = new FuxaUserStoreAdapter({ db });
        roleStore = new FuxaRoleStoreAdapter({ db }); // shares the connection (in-txn-consistent role reads)
        authorization = new AuthorizationService({ roleStore });
        auditEvents = [];
        svc = new UserService({
            userStore, passwordHasher: new Password_Hasher(new BcryptHasherAdapter({ cost: 4 })),
            authorization, auditLogger: { record: (e) => auditEvents.push(e) },
        });
    });

    after(async function () { if (db) await db.close(); });
    beforeEach(async () => { auditEvents.length = 0; await resetTables(); });

    it('create → get round-trip (references P-003); the stored hash verifies but never appears in any view', async () => {
        const pw = 'integration-pw-1234';
        const created = await svc.create({ username: 'alice', fullname: 'Alice', password: pw, roles: ['viewer'], metadata: { dept: 'ops' } });
        assert.equal(created.kind, 'created');
        const got = await svc.get('alice');
        assert.equal(got.kind, 'found');
        assert.deepEqual(got.user, { username: 'alice', fullname: 'Alice', roles: ['viewer'], metadata: { dept: 'ops' } });
        // The hash is retrievable only through the store record (not any service view) and verifies once.
        const raw = await userStore.get('alice');
        assert.ok(bcrypt.compareSync(pw, raw.passwordHash), 'stored hash verifies the plaintext (single hash)');
    });

    it('AC-7.3 retain-hash-on-omit end-to-end: a password-less update keeps the original hash byte-identical', async () => {
        const pw = 'retain-me-123456';
        await svc.create({ username: 'bob', fullname: 'Bob', password: pw, roles: [], metadata: {} });
        const before = (await userStore.get('bob')).passwordHash;
        const res = await svc.update('bob', { fullname: 'Bobby' });
        assert.equal(res.kind, 'updated');
        const after = (await userStore.get('bob')).passwordHash;
        assert.equal(after, before, 'hash unchanged after a password-less update');
        assert.ok(bcrypt.compareSync(pw, after), 'original password still verifies');
    });

    it('AC-8.5 last administrator cannot be deleted (no mutation); a non-last admin can', async () => {
        await seedAdmin('admin');
        const refused = await svc.delete('admin');
        assert.equal(refused.kind, 'last_admin');
        assert.ok(await userStore.get('admin'), 'the last admin row remains');

        await seedAdmin('admin2');
        const ok = await svc.delete('admin'); // now two admins → deleting one is allowed
        assert.equal(ok.kind, 'deleted');
        assert.equal(await userStore.get('admin'), undefined, 'row removed');
        assert.equal(await adminCount(), 1, 'exactly one admin remains');
    });

    it('a non-admin user deletes freely regardless of admin count', async () => {
        await seedAdmin('admin');
        await seedPlainUser('carol');
        assert.equal((await svc.delete('carol')).kind, 'deleted');
        assert.equal(await adminCount(), 1);
    });

    // -------------------------------------------------------------------------
    // Task 2.10 / 9 — Property 16: concurrent last-admin deletes never reach zero admins (P-016)
    // -------------------------------------------------------------------------
    it('Property 16: under concurrent deletes of ALL administrators, exactly one survives (≥1 admin invariant, D-020/D-033)', async function () {
        this.timeout(30000);
        await fc.assert(fc.asyncProperty(
            fc.integer({ min: 2, max: 5 }), // number of administrators
            fc.integer({ min: 0, max: 3 }), // number of plain users deleted concurrently too
            async (numAdmins, numPlain) => {
                await resetTables();
                const admins = [];
                for (let i = 0; i < numAdmins; i++) { const u = 'adm' + i; admins.push(u); await seedAdmin(u); }
                const plains = [];
                for (let i = 0; i < numPlain; i++) { const u = 'usr' + i; plains.push(u); await seedPlainUser(u); }

                // Fire ALL deletes concurrently (admins + plain users). The atomic guard must serialize.
                const results = await Promise.all([...admins, ...plains].map((u) => svc.delete(u)));

                const adminResults = results.slice(0, numAdmins);
                const deleted = adminResults.filter((r) => r.kind === 'deleted').length;
                const lastAdmin = adminResults.filter((r) => r.kind === 'last_admin').length;

                // Exactly one administrator is protected; the rest are removed. Never zero admins.
                assert.equal(lastAdmin, 1, 'exactly one last_admin refusal');
                assert.equal(deleted, numAdmins - 1, 'all but one admin deleted');
                assert.equal(await adminCount(), 1, '≥1 administrator always remains (P-016)');
                // Plain users are unaffected by the guard.
                assert.ok(results.slice(numAdmins).every((r) => r.kind === 'deleted'), 'plain users deleted freely');
            }
        ), { numRuns: 100 });
    });
});
