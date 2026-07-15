//@ts-check
'use strict';

/**
 * Feature: auth-user-management — Administrator bootstrap, migration, enrollment (design/12 · REQ-17).
 * Tasks 12.1 (seed/idempotent/retain), 12.3 (mandatory known-default remediation), 12.6 (bootstrap +
 * migration + security + D-022 log-safety), 12.7 (enrollment token store), 12.5 (Property 10).
 *
 * Real in-memory `FuxaAuthDb` + real adapters + real bcrypt (cost 4). The enrollment channel is a
 * SPY (captures the delivered one-time secret); a separate logger spy proves the secret never reaches
 * a log (D-022 / N-018). Toolchain (N-023/N-025): `node:assert/strict` + `fast-check@3` + real sqlite/bcrypt.
 */

const assert = require('node:assert/strict');
const fc = require('fast-check');
const bcrypt = require('bcryptjs');

const { FuxaAuthDb } = require('../../auth-management/store/fuxa-auth-db');
const { FuxaUserStoreAdapter } = require('../../auth-management/adapters/fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('../../auth-management/adapters/fuxa-role-store.adapter');
const { AuthorizationService } = require('../../auth-management/services/authorization.service');
const { Password_Hasher } = require('../../auth-management/services/password-hasher');
const { BcryptHasherAdapter } = require('../../auth-management/adapters/fuxa-bcrypt.adapter');
const { UserService } = require('../../auth-management/services/user.service');
const { Bootstrap, KNOWN_DEFAULT_PASSWORD } = require('../../auth-management/services/bootstrap');
const { OneTimeEnrollmentTokenStore, TokenEnrollmentChannel } = require('../../auth-management/services/enrollment');

/** @type {FuxaAuthDb} */ let db;
/** @type {FuxaUserStoreAdapter} */ let userStore;
/** @type {FuxaRoleStoreAdapter} */ let roleStore;
/** @type {AuthorizationService} */ let authorization;
/** @type {Password_Hasher} */ let hasher;

function makeEnrollSpy() {
    const deliveries = [];
    return { deliveries, channel: { deliver: async (info) => { deliveries.push(info); } } };
}

async function resetTables() {
    await db.run('DELETE FROM users', []);
    await db.run('DELETE FROM roles', []);
}
async function adminCount() {
    const { records } = await userStore.readAll();
    let n = 0;
    for (const r of records) { if (await authorization.isAdministrator(r)) n++; }
    return n;
}
/** Build an authenticated identity from a live record (as the Task-13 middleware will, D-032). */
function identityFrom(rec) {
    return authorization.resolveIdentity({ id: rec.username, tokenVersion: (rec.metadata && rec.metadata.tokenVersion) || 0 }, rec);
}

before(async function () {
    this.timeout(15000);
    db = new FuxaAuthDb({ dbFile: ':memory:' });
    await db.exec('CREATE TABLE if not exists users (username TEXT PRIMARY KEY, fullname TEXT, password TEXT, groups INTEGER, info TEXT);');
    await db.exec('CREATE TABLE if not exists roles (name TEXT PRIMARY KEY, value TEXT);');
    userStore = new FuxaUserStoreAdapter({ db });
    roleStore = new FuxaRoleStoreAdapter({ db });
    authorization = new AuthorizationService({ roleStore });
    hasher = new Password_Hasher(new BcryptHasherAdapter({ cost: 4 }));
});
after(async function () { if (db) await db.close(); });
beforeEach(async () => { await resetTables(); });

function newBootstrap(enrollChannel, auditSink) {
    return new Bootstrap({
        userStore, authorization, passwordHasher: hasher,
        auditLogger: { record: auditSink || (() => {}) },
        enrollmentChannel: enrollChannel,
    });
}

describe('Feature: auth-user-management — Bootstrap seeding & idempotency (design/12 · REQ-17.1/17.4/17.5)', () => {

    it('AC-17.1: an empty store seeds EXACTLY one gated admin with a random secret (never verifies 123456); AC-17.5 audited', async () => {
        const enroll = makeEnrollSpy();
        const audit = [];
        const res = await newBootstrap(enroll.channel, (e) => audit.push(e)).run();
        assert.equal(res.kind, 'seeded');
        assert.equal(res.username, 'admin');

        const { records } = await userStore.readAll();
        assert.equal(records.length, 1, 'exactly one record seeded');
        const admin = records[0];
        assert.equal(await authorization.isAdministrator(admin), true, 'seeded record is an administrator');
        assert.equal(admin.metadata.mustRotate, true, 'gate armed (AC-17.2 precondition)');
        assert.equal(bcrypt.compareSync(KNOWN_DEFAULT_PASSWORD, admin.passwordHash), false, "seed never uses '123456' (N-007 eliminated)");

        // AC-17.5: exactly one bootstrap.seed audit with the username + a timestamp; secret-free.
        const seedEvents = audit.filter((e) => e.category === 'bootstrap.seed');
        assert.equal(seedEvents.length, 1);
        assert.equal(seedEvents[0].subject, 'admin');
        assert.ok(seedEvents[0].timestamp && seedEvents[0].timestamp.length > 0);

        // The one-time secret was delivered ONCE via the enrollment channel and actually works.
        assert.equal(enroll.deliveries.length, 1);
        assert.equal(enroll.deliveries[0].reason, 'seed');
        assert.ok(bcrypt.compareSync(enroll.deliveries[0].secret, admin.passwordHash), 'the delivered secret verifies the stored hash');
    });

    it('AC-17.1/17.4 idempotent: a second run seeds no additional admin and leaves the seeded record unchanged', async () => {
        const first = await newBootstrap(makeEnrollSpy().channel).run();
        assert.equal(first.kind, 'seeded');
        const before = await userStore.get('admin');

        const enroll2 = makeEnrollSpy();
        const second = await newBootstrap(enroll2.channel).run();
        assert.equal(second.kind, 'retained');
        assert.deepEqual(second.remediated, [], 'the gated seed admin is not re-remediated');
        assert.deepEqual(await userStore.get('admin'), before, 'seeded record byte-for-byte unchanged');
        assert.equal(enroll2.deliveries.length, 0, 'no enrollment delivery on the idempotent retain path');
    });

    it('AC-17.4 retain existing (already-rotated admin, not a known default): no new admin, no remediation, unchanged', async () => {
        await userStore.create({ username: 'root', fullname: 'Root', passwordHash: bcrypt.hashSync('a-strong-passphrase', 4), groups: -1, roles: [], metadata: { mustRotate: false } });
        const before = await userStore.get('root');
        const enroll = makeEnrollSpy();
        const res = await newBootstrap(enroll.channel).run();
        assert.equal(res.kind, 'retained');
        assert.deepEqual(res.remediated, []);
        const { records } = await userStore.readAll();
        assert.equal(records.length, 1, 'no default seeded when an admin already exists');
        assert.deepEqual(await userStore.get('root'), before, 'existing admin unchanged');
        assert.equal(enroll.deliveries.length, 0);
    });
});

describe('Feature: auth-user-management — Migration remediation & no-usable-known-default (design/12 §8/§10.3 · DEF-B1)', () => {

    it('MANDATORY remediation: a FUXA-style 123456 admin is re-hashed to a fresh secret + gated; 123456 no longer works (DEF-B1)', async () => {
        // Seed exactly as FUXA's setDefault would: admin / bcrypt('123456') / groups -1 / no info.
        await userStore.create({ username: 'admin', fullname: 'Administrator Account', passwordHash: bcrypt.hashSync(KNOWN_DEFAULT_PASSWORD, 4), groups: -1, roles: [], metadata: {} });
        const enroll = makeEnrollSpy();
        const audit = [];
        const res = await newBootstrap(enroll.channel, (e) => audit.push(e)).run();
        assert.equal(res.kind, 'retained');
        assert.deepEqual(res.remediated, ['admin'], 'the known-default admin was remediated');

        const admin = await userStore.get('admin');
        assert.equal(admin.metadata.mustRotate, true, 'gate armed on the migrated admin');
        assert.equal(bcrypt.compareSync(KNOWN_DEFAULT_PASSWORD, admin.passwordHash), false,
            "'123456' no longer verifies — re-hashed to a fresh unknown secret (DEF-B1: gate alone is insufficient)");
        // The fresh secret was delivered via the secure channel (reason: migration).
        assert.equal(enroll.deliveries.length, 1);
        assert.equal(enroll.deliveries[0].reason, 'migration');
        assert.ok(bcrypt.compareSync(enroll.deliveries[0].secret, admin.passwordHash));
        assert.ok(audit.some((e) => e.operation === 'user.update' && e.subject === 'admin'), 'remediation audited as user.update');
    });

    it('§10.3 security: after seed AND after migration, the admin has NO usable authority except account.rotatePassword', async () => {
        // (a) fresh seed
        await newBootstrap(makeEnrollSpy().channel).run();
        let admin = await userStore.get('admin');
        let id = identityFrom(admin);
        assert.deepEqual(await authorization.isAllowed(id, { id: 'user.create', requiredPermission: 'user.create' }), { allow: false, status: 403, error: 'forbidden' }, 'seeded admin cannot create users pre-rotation');
        assert.deepEqual(await authorization.isAllowed(id, { id: 'rot', requiredPermission: 'account.rotatePassword' }), { allow: true }, 'seeded admin CAN rotate (the sole exception)');

        // (b) migration of a legacy 123456 admin
        await resetTables();
        await userStore.create({ username: 'admin', fullname: 'Administrator Account', passwordHash: bcrypt.hashSync(KNOWN_DEFAULT_PASSWORD, 4), groups: -1, roles: [], metadata: {} });
        await newBootstrap(makeEnrollSpy().channel).run();
        admin = await userStore.get('admin');
        id = identityFrom(admin);
        for (const p of ['user.create', 'user.delete', 'role.create']) {
            assert.deepEqual(await authorization.isAllowed(id, { id: p, requiredPermission: p }), { allow: false, status: 403, error: 'forbidden' }, 'migrated admin denied ' + p + ' pre-rotation');
        }
        assert.deepEqual(await authorization.isAllowed(id, { id: 'rot', requiredPermission: 'account.rotatePassword' }), { allow: true });
    });

    it('§10.4 D-022: no seed/migration path places the one-time secret in the AUDIT trail (secret-free events)', async () => {
        // Seed
        const enrollA = makeEnrollSpy();
        const auditA = [];
        await newBootstrap(enrollA.channel, (e) => auditA.push(e)).run();
        const seedSecret = enrollA.deliveries[0].secret;
        // Migration
        await resetTables();
        await userStore.create({ username: 'admin', fullname: 'Administrator Account', passwordHash: bcrypt.hashSync(KNOWN_DEFAULT_PASSWORD, 4), groups: -1, roles: [], metadata: {} });
        const enrollB = makeEnrollSpy();
        const auditB = [];
        await newBootstrap(enrollB.channel, (e) => auditB.push(e)).run();
        const migSecret = enrollB.deliveries[0].secret;

        for (const ev of [...auditA, ...auditB]) {
            const blob = JSON.stringify(ev);
            assert.equal(blob.includes(seedSecret), false, 'seed secret must not appear in any audit event');
            assert.equal(blob.includes(migSecret), false, 'migration secret must not appear in any audit event');
            for (const k of ['password', 'passwordHash', 'secret', 'token']) {
                assert.equal(Object.prototype.hasOwnProperty.call(ev, k), false, 'no ' + k + ' key in an audit event');
            }
        }
    });
});

describe('Feature: auth-user-management — OneTimeEnrollmentTokenStore (design/12 §3.2 · D-022/D-035, task 12.7)', () => {

    it('token is single-use and TTL-bounded; hashed-at-rest; unknown token rejected', () => {
        let now = 1_000_000;
        const store = new OneTimeEnrollmentTokenStore({ clock: () => now, ttlMs: 1000 });
        const { token } = store.issue('admin', 'the-one-time-secret');

        // The RAW token is not stored (only its sha256 hash) — an internal scan finds no raw token.
        const rawStored = [...store._byHash.keys()].includes(token);
        assert.equal(rawStored, false, 'raw token is not persisted (hashed-at-rest)');

        // First redemption returns the secret.
        const first = store.redeem(token);
        assert.deepEqual(first, { ok: true, username: 'admin', secret: 'the-one-time-secret' });
        // Second redemption fails (single-use).
        assert.deepEqual(store.redeem(token), { ok: false, reason: 'used' });
        // Unknown token fails.
        assert.deepEqual(store.redeem('some-other-token'), { ok: false, reason: 'unknown' });

        // TTL: a token not redeemed before expiry is rejected.
        const { token: t2 } = store.issue('bob', 's2');
        now += 5000; // past the 1000ms TTL
        assert.deepEqual(store.redeem(t2), { ok: false, reason: 'expired' });
    });

    it('TokenEnrollmentChannel.deliver surfaces ONLY the token to the operator sink (never the secret)', async () => {
        let now = 0;
        const store = new OneTimeEnrollmentTokenStore({ clock: () => now });
        const surfaced = [];
        const channel = new TokenEnrollmentChannel({ store, operatorSink: (info) => surfaced.push(info) });
        await channel.deliver({ username: 'admin', secret: 'seed-secret-xyz', reason: 'seed' });
        assert.equal(surfaced.length, 1);
        assert.equal(Object.prototype.hasOwnProperty.call(surfaced[0], 'secret'), false, 'the operator sink receives a token, NOT the plaintext secret');
        assert.ok(surfaced[0].token, 'a token was surfaced');
        // The operator redeems the token to obtain the secret exactly once.
        assert.deepEqual(store.redeem(surfaced[0].token), { ok: true, username: 'admin', secret: 'seed-secret-xyz' });
    });
});

describe('Feature: auth-user-management — Property 10: ≥1 administrator always remains (design/12 §9.2 · P-010, §04+§12)', () => {

    it('Property 10: across any sequence of User_Service.delete, an admin count that starts ≥1 never reaches 0', async function () {
        this.timeout(30000);
        await fc.assert(fc.asyncProperty(
            fc.integer({ min: 1, max: 4 }),  // extra admins beyond the seeded one
            fc.integer({ min: 0, max: 3 }),  // plain users
            fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 14 }), // delete-target indices
            async (extraAdmins, plains, deleteIdx) => {
                await resetTables();
                // Base case (AC-17.1): bootstrap guarantees ≥1 admin.
                await newBootstrap(makeEnrollSpy().channel).run();
                const names = ['admin'];
                for (let i = 0; i < extraAdmins; i++) { const u = 'adm' + i; names.push(u); await userStore.create({ username: u, fullname: u, passwordHash: 'x', roles: [], metadata: {}, groups: -1 }); }
                for (let i = 0; i < plains; i++) { const u = 'usr' + i; names.push(u); await userStore.create({ username: u, fullname: u, passwordHash: 'x', roles: [], metadata: {}, groups: 3 }); }

                const svc = new UserService({ userStore, passwordHasher: hasher, authorization, auditLogger: { record: () => {} } });

                assert.ok((await adminCount()) >= 1, 'base case: ≥1 admin after bootstrap');
                for (const idx of deleteIdx) {
                    const target = names[idx % names.length];
                    await svc.delete(target); // last-admin guard (AC-8.5) refuses the final admin
                    assert.ok((await adminCount()) >= 1, '≥1 administrator remains after deleting ' + target + ' (P-010)');
                }
            }
        ), { numRuns: 100 });
    });
});
