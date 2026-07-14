//@ts-check
'use strict';

/**
 * Tests for the FUXA-backed Store layer — design/06-persistence-and-serialization.md (REQ-13,
 * D-016/D-020/D-024). Covers tasks 2.3/2.4 (adapters), 2.5/2.6 (round-trip properties P-003/P-004),
 * 2.7 (double-hash regression + retain-on-omit + resilient readAll + atomic-duplicate + roles-gap),
 * and the mechanism half of 2.8/2.9 (single-transaction verbatim write + plain-INSERT dedup).
 *
 * These run END-TO-END against a real temp-directory `users.fuxap.db` (§9.1) so the full
 * serialize → §5 write → SQL read → parse/split path is exercised. Toolchain (N-023/N-025):
 * `node:assert/strict` + `fast-check@3` + real `sqlite3` + `bcryptjs`; NO `runtime/users` init is
 * required because reads go through the adapter's own connection (D-024).
 */

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const fc = require('fast-check');
const bcrypt = require('bcryptjs');

const { FuxaAuthDb } = require('../../auth-management/store/fuxa-auth-db');
const { FuxaUserStoreAdapter } = require('../../auth-management/adapters/fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('../../auth-management/adapters/fuxa-role-store.adapter');

// --- fast-check generators over the JSON-safe domain (§9.1) ------------------
// A finite number that survives a JSON round-trip: excludes NaN/±Infinity (by option) and -0
// (by filter) per §4.2.
const jsonNumber = fc.oneof(
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0))
);
// Recursive JSON-safe value: strings (incl. full Unicode), finite numbers, booleans, null, arrays,
// and nested plain objects — bounded depth. Excludes undefined/function/NaN/±Infinity/-0/Date.
// `__proto__` is a RESERVED/stripped key at every depth (D-026/N-029, design/06 §3.2/§4.2): it is a
// prototype-pollution accessor, not legitimate metadata, so the store strips it and the round-trip
// domain excludes it. `constructor`/`prototype` are ordinary data keys (no accessor) and stay in.
const safeKey = fc.fullUnicodeString().filter((k) => k !== '__proto__');
const jsonSafeValue = fc.letrec((tie) => ({
    value: fc.oneof(
        { maxDepth: 3, withCrossShrink: true },
        fc.fullUnicodeString(),
        jsonNumber,
        fc.boolean(),
        fc.constant(null),
        fc.array(tie('value'), { maxLength: 4 }),
        fc.dictionary(safeKey, tie('value'), { maxKeys: 4 })
    ),
})).value;
// metadata: an object root with NO top-level `roles` key (the reserved-key invariant, §3.2) and no
// reserved `__proto__` key at any depth (D-026/N-029).
const metadataArb = fc.dictionary(
    fc.fullUnicodeString().filter((k) => k !== 'roles' && k !== '__proto__'),
    jsonSafeValue,
    { maxKeys: 5 }
);
const rolesArb = fc.array(fc.string(), { maxLength: 5 }); // role-id strings; allow empty + duplicates
const userRecordArb = fc.record({
    username: fc.string({ minLength: 1 }),
    fullname: fc.fullUnicodeString(),
    passwordHash: fc.string(),
    roles: rolesArb,
    metadata: metadataArb,
});
const roleArb = fc.record({
    id: fc.string({ minLength: 1 }),
    name: fc.fullUnicodeString(),
    permissions: fc.array(fc.string(), { maxLength: 5 }),
});

// --- shared temp DB ----------------------------------------------------------
/** @type {FuxaAuthDb} */ let db;
/** @type {FuxaUserStoreAdapter} */ let userStore;
/** @type {FuxaRoleStoreAdapter} */ let roleStore;
let tmpDir;

before(async function () {
    this.timeout(15000);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-store-'));
    db = new FuxaAuthDb({ dbFile: path.join(tmpDir, 'users.fuxap.db') });
    // The adapter's own connection does NOT create tables (only usrstorage._bind does); create the
    // identical schema here so the adapter can be tested without a full runtime/users init.
    await db.exec('CREATE TABLE if not exists users (username TEXT PRIMARY KEY, fullname TEXT, password TEXT, groups INTEGER, info TEXT);');
    await db.exec('CREATE TABLE if not exists roles (name TEXT PRIMARY KEY, value TEXT);');
    userStore = new FuxaUserStoreAdapter({ db }); // no runtimeUsers → own-connection reads/writes
    roleStore = new FuxaRoleStoreAdapter({ db });
});

after(async function () {
    if (db) await db.close();
});

describe('Feature: auth-user-management — Store layer (design/06 · REQ-13, D-016/D-020/D-024)', () => {

    // -------------------------------------------------------------------------
    // Task 2.5 — Property 3: User_Record write→read round-trip (P-003)
    // -------------------------------------------------------------------------
    it('Property 3: User_Record write→read round-trip preserves username/fullname/roles(set)/metadata(deep)', async function () {
        this.timeout(30000);
        await fc.assert(fc.asyncProperty(userRecordArb, async (u) => {
            await userStore.create(u);
            try {
                const back = await userStore.get(u.username);
                assert.ok(back, 'record read back');
                assert.equal(back.username, u.username);
                assert.equal(back.fullname, u.fullname);
                assert.deepEqual(new Set(back.roles), new Set(u.roles)); // roles as a set (§6.3)
                assert.deepEqual(back.metadata, u.metadata);             // deep structural equality
            } finally {
                await userStore.delete(u.username); // keep the PK free for the next iteration
            }
        }), { numRuns: 150 });
    });

    // -------------------------------------------------------------------------
    // Task 2.6 — Property 4: Role write→read round-trip (P-004)
    // -------------------------------------------------------------------------
    it('Property 4: Role write→read round-trip preserves name + permission set', async function () {
        this.timeout(30000);
        await fc.assert(fc.asyncProperty(roleArb, async (r) => {
            await roleStore.create(r);
            try {
                const back = await roleStore.get(r.id);
                assert.ok(back, 'role read back');
                assert.equal(back.name, r.name);
                assert.deepEqual(new Set(back.permissions), new Set(r.permissions));
            } finally {
                await roleStore.delete([r.id]);
            }
        }), { numRuns: 150 });
    });

    // -------------------------------------------------------------------------
    // Task 2.7 / 2.8 — double-hash regression + verbatim write (§5)
    // -------------------------------------------------------------------------
    it('double-hash regression: the stored password column holds the SINGLE hash (verifies plaintext once)', async () => {
        const plaintext = 'S3cret-pw!';
        const hash = bcrypt.hashSync(plaintext, 4); // module hashes ONCE (cost 4 for test speed)
        await userStore.create({ username: 'dh_alice', fullname: 'Alice', passwordHash: hash, roles: ['admin'], metadata: {} });
        try {
            const back = await userStore.get('dh_alice');
            assert.equal(back.passwordHash, hash, 'hash stored verbatim (not re-hashed)');
            assert.ok(bcrypt.compareSync(plaintext, back.passwordHash), 'single bcrypt.compare verifies the plaintext');
            // If it had been double-hashed, comparing the plaintext would FAIL:
            assert.ok(!bcrypt.compareSync(hash, back.passwordHash), 'stored value is not bcrypt(hash)');
        } finally {
            await userStore.delete('dh_alice');
        }
    });

    it('retain-on-omit (AC-7.3): an update that omits passwordHash leaves the hash byte-identical and does not clobber metadata', async () => {
        const hash = bcrypt.hashSync('bobpw', 4);
        await userStore.create({ username: 'bob', fullname: 'Bob', passwordHash: hash, roles: ['r1'], metadata: { a: 1 } });
        try {
            await userStore.update('bob', { fullname: 'Bobby' }); // no passwordHash, no roles, no metadata
            const back = await userStore.get('bob');
            assert.equal(back.passwordHash, hash, 'password retained byte-identical');
            assert.equal(back.fullname, 'Bobby', 'fullname updated');
            assert.deepEqual(new Set(back.roles), new Set(['r1']), 'roles retained');
            assert.deepEqual(back.metadata, { a: 1 }, 'metadata retained (not clobbered)');

            // A subsequent update replaces roles + metadata wholesale.
            await userStore.update('bob', { roles: ['x', 'y'], metadata: { b: 2 } });
            const back2 = await userStore.get('bob');
            assert.deepEqual(new Set(back2.roles), new Set(['x', 'y']));
            assert.deepEqual(back2.metadata, { b: 2 });
            assert.equal(back2.passwordHash, hash, 'password still retained across the second update');
        } finally {
            await userStore.delete('bob');
        }
    });

    it('update of an absent user rejects with user_not_found', async () => {
        await assert.rejects(
            () => userStore.update('nobody-here', { fullname: 'X' }),
            (e) => /** @type {any} */(e).code === 'user_not_found'
        );
    });

    // -------------------------------------------------------------------------
    // Task 2.9 — atomic duplicate rejection (plain INSERT, D-020)
    // -------------------------------------------------------------------------
    it('create rejects a duplicate username atomically (plain INSERT → PK conflict), without mutating the existing row', async () => {
        await userStore.create({ username: 'dup', fullname: 'Original', passwordHash: 'h1', roles: [], metadata: {} });
        try {
            await assert.rejects(
                () => userStore.create({ username: 'dup', fullname: 'Overwrite', passwordHash: 'h2', roles: ['z'], metadata: { evil: true } }),
                (e) => /** @type {any} */(e).code === 'duplicate_key'
            );
            const back = await userStore.get('dup');
            assert.equal(back.fullname, 'Original', 'existing row not overwritten');
            assert.deepEqual(back.roles, []);
            assert.deepEqual(back.metadata, {});
        } finally {
            await userStore.delete('dup');
        }
    });

    it('delete removes the row (get → undefined afterwards)', async () => {
        await userStore.create({ username: 'gone', fullname: 'G', passwordHash: 'h', roles: [], metadata: {} });
        assert.ok(await userStore.get('gone'));
        await userStore.delete('gone');
        assert.equal(await userStore.get('gone'), undefined);
    });

    // -------------------------------------------------------------------------
    // Task 2.7 — resilient readAll (AC-13.4): one corrupt row is isolated, batch continues
    // -------------------------------------------------------------------------
    it('resilient readAll: one corrupt user `info` becomes an error entry; healthy rows still returned; get fails closed', async () => {
        // Insert a corrupt info row directly (bypassing the adapter's serialize).
        await db.run('INSERT INTO users (username, fullname, password, groups, info) VALUES (?, ?, ?, ?, ?)',
            ['corrupt_u', 'Corrupt', 'h', 0, '{ not json']);
        await userStore.create({ username: 'healthy_u', fullname: 'Healthy', passwordHash: 'h', roles: ['ok'], metadata: { m: 1 } });
        try {
            const res = await userStore.readAll();
            assert.ok(res.records.some((r) => r.username === 'healthy_u'), 'healthy row present');
            assert.ok(!res.records.some((r) => r.username === 'corrupt_u'), 'corrupt row excluded from records');
            const err = res.errors.find((e) => e.key === 'corrupt_u');
            assert.ok(err, 'corrupt row reported in errors');
            assert.equal(err.error, 'invalid_metadata');
            assert.ok(err.detail && err.detail.length > 0, 'descriptive detail');

            // get() on the corrupt row fails CLOSED: record returned with empty roles/metadata (N-026).
            const c = await userStore.get('corrupt_u');
            assert.ok(c, 'corrupt user still exists as a record');
            assert.deepEqual(c.roles, [], 'least-privilege: no roles from corrupt info');
            assert.deepEqual(c.metadata, {}, 'empty metadata from corrupt info');
        } finally {
            await userStore.delete('corrupt_u');
            await userStore.delete('healthy_u');
        }
    });

    // -------------------------------------------------------------------------
    // D-026 / N-029 — a maliciously stored `__proto__` in `info` is neutralized on read
    // -------------------------------------------------------------------------
    it('prototype-pollution hardening: a stored `info.__proto__` payload is stripped on read (metadata clean, prototype untouched)', async () => {
        // Write a raw row whose info carries a `__proto__` object payload, bypassing the adapter's
        // compose (simulating a hostile or FUXA-written row).
        await db.run('INSERT INTO users (username, fullname, password, groups, info) VALUES (?, ?, ?, ?, ?)',
            ['pp_user', 'PP', 'h', 0, '{"roles":["r1"],"__proto__":{"isAdmin":true},"keep":1}']);
        try {
            const back = await userStore.get('pp_user');
            assert.deepEqual(new Set(back.roles), new Set(['r1']), 'roles intact');
            assert.deepEqual(back.metadata, { keep: 1 }, '__proto__ stripped; only real metadata remains');
            assert.strictEqual(Object.getPrototypeOf(back.metadata), Object.prototype, 'metadata prototype untouched');
            assert.strictEqual(/** @type {any} */(back.metadata).isAdmin, undefined, 'no inherited pollution');
        } finally {
            await userStore.delete('pp_user');
        }
    });

    // -------------------------------------------------------------------------
    // Task 2.7 — roles-gap regression (AC-13.4, N-009): closes getRoles no-try/catch gap
    // -------------------------------------------------------------------------
    it('resilient Role readAll: one corrupt role `value` is isolated (closes the FUXA getRoles no-try/catch gap)', async () => {
        await db.run('INSERT INTO roles (name, value) VALUES (?, ?)', ['bad_role', '{ not json']);
        await roleStore.create({ id: 'good_role', name: 'Good', permissions: ['user.read'] });
        try {
            const res = await roleStore.readAll();
            assert.ok(res.records.some((r) => r.id === 'good_role'), 'healthy role present');
            const err = res.errors.find((e) => e.key === 'bad_role');
            assert.ok(err, 'corrupt role reported');
            assert.equal(err.error, 'invalid_metadata');
        } finally {
            await db.run('DELETE FROM roles WHERE name = ?', ['bad_role']);
            await roleStore.delete(['good_role']);
        }
    });

    it('role create rejects a duplicate id atomically without overwriting (AC-9.5); update replaces wholesale (AC-9.3)', async () => {
        await roleStore.create({ id: 'r_dup', name: 'First', permissions: ['user.read'] });
        try {
            await assert.rejects(
                () => roleStore.create({ id: 'r_dup', name: 'Second', permissions: ['user.delete'] }),
                (e) => /** @type {any} */(e).code === 'duplicate_key'
            );
            let back = await roleStore.get('r_dup');
            assert.equal(back.name, 'First', 'existing role not overwritten by duplicate create');

            await roleStore.update({ id: 'r_dup', name: 'Renamed', permissions: ['role.read', 'role.update'] });
            back = await roleStore.get('r_dup');
            assert.equal(back.name, 'Renamed');
            assert.deepEqual(new Set(back.permissions), new Set(['role.read', 'role.update']));
        } finally {
            await roleStore.delete(['r_dup']);
        }
    });

    it('role delete prunes the id from a referencing user`s info.roles (own-connection fallback, AC-9.4)', async () => {
        await roleStore.create({ id: 'to_prune', name: 'P', permissions: [] });
        await userStore.create({ username: 'member', fullname: 'M', passwordHash: 'h', roles: ['to_prune', 'keep'], metadata: {} });
        try {
            await roleStore.delete(['to_prune']);
            assert.equal(await roleStore.get('to_prune'), undefined, 'role removed');
            const back = await userStore.get('member');
            assert.deepEqual(new Set(back.roles), new Set(['keep']), 'deleted id pruned from user, others kept');
        } finally {
            await userStore.delete('member');
        }
    });
});
