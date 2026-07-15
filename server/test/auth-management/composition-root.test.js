//@ts-check
'use strict';

/**
 * Feature: auth-user-management — composition root (design.md "API Composition Root" · D-014). Task 13.5.
 *
 * Proves the whole module assembles + boots + serves end-to-end THROUGH the real
 * `createAuthManagementModule` factory: in-memory sqlite, real services/routers, real bcrypt/jwt, a
 * SPY enrollment channel, driven over real HTTP by `fetch`. This is the standalone-mountable module
 * (the FUXA-core `api/index.js` SUPERSEDE edit + client cutover is the final coordinated step, D-011/
 * D-014, deliberately NOT done here). Toolchain (N-023/N-025): `node:assert/strict` + real express/sqlite/bcrypt/jwt.
 */

const assert = require('node:assert/strict');
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

const { FuxaAuthDb } = require('../../auth-management/store/fuxa-auth-db');
const { createAuthManagementModule } = require('../../auth-management/index');

const SECRET = 'composition-root-test-secret-0123456789';
const tokenAdapter = { sign: (p, o) => jwt.sign(p, SECRET, o), verify: (t, o) => jwt.verify(t, SECRET, o), decode: (t) => jwt.decode(t) };

/** @type {FuxaAuthDb} */ let db;
let mod, server, baseUrl, enrollSpy;

async function req(method, path, opts = {}) {
    const headers = {};
    if (opts.token) headers['x-access-token'] = opts.token;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(baseUrl + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    let body = null;
    try { body = await r.json(); } catch (_e) { body = null; }
    return { status: r.status, body };
}

before(async function () {
    this.timeout(15000);
    db = new FuxaAuthDb({ dbFile: ':memory:' });
    // FUXA owns the users/roles tables (usrstorage._bind); the module does not create them (D-003).
    await db.exec('CREATE TABLE if not exists users (username TEXT PRIMARY KEY, fullname TEXT, password TEXT, groups INTEGER, info TEXT);');
    await db.exec('CREATE TABLE if not exists roles (name TEXT PRIMARY KEY, value TEXT);');

    enrollSpy = { deliveries: [], channel: { deliver: async (info) => { enrollSpy.deliveries.push(info); } } };
    mod = await createAuthManagementModule({
        db,
        tokenAdapter,
        enrollmentChannel: enrollSpy.channel,
        auditLogger: { record: () => {} },
        settings: { secureEnabled: true, enableRefreshCookieAuth: false, https: false, auth: { bcryptCost: 4 } },
    });

    const app = express();
    app.use(bodyParser.json());
    app.use(mod.router);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
});

after(async function () {
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.close();
});

describe('Feature: auth-user-management — composition root end-to-end (design.md · D-014, Task 13.5)', () => {

    it('bootstrap seeded exactly one gated admin and delivered the one-time secret via the enrollment channel (never returned/logged)', async () => {
        assert.equal(mod.bootstrapResult.kind, 'seeded');
        assert.equal(mod.bootstrapResult.username, 'admin');
        assert.equal(enrollSpy.deliveries.length, 1);
        assert.equal(enrollSpy.deliveries[0].reason, 'seed');
        assert.ok(enrollSpy.deliveries[0].secret && enrollSpy.deliveries[0].secret.length > 0);
    });

    it('full lifecycle over HTTP: sign in with the seeded secret → gated (403) → rotate → full admin', async () => {
        const secret = enrollSpy.deliveries[0].secret;

        // Sign in with the one-time seeded secret.
        const signin = await req('POST', '/api/signin', { body: { username: 'admin', password: secret } });
        assert.equal(signin.status, 200);
        assert.equal(signin.body.data.username, 'admin');
        const gatedToken = signin.body.data.token;

        // Gated: the seeded admin is 403 on protected ops until it rotates (AC-17.2).
        assert.equal((await req('GET', '/api/users', { token: gatedToken })).status, 403);

        // Wrong current secret ⇒ 400 bad_current, still gated.
        const badRotate = await req('POST', '/api/account/rotate-password', { token: gatedToken, body: { currentPassword: 'nope', newPassword: 'brand-new-admin-1' } });
        assert.equal(badRotate.status, 400);
        assert.equal(badRotate.body.error, 'bad_current_password');

        // Correct rotation ⇒ 200; clears the gate + bumps tokenVersion.
        const rotate = await req('POST', '/api/account/rotate-password', { token: gatedToken, body: { currentPassword: secret, newPassword: 'brand-new-admin-1' } });
        assert.equal(rotate.status, 200);

        // Pre-rotation token is now revoked (tokenVersion bump, D-027).
        assert.equal((await req('GET', '/api/users', { token: gatedToken })).status, 401);

        // Re-sign-in with the NEW password ⇒ a fresh token with full admin authority (AC-17.3).
        const signin2 = await req('POST', '/api/signin', { body: { username: 'admin', password: 'brand-new-admin-1' } });
        assert.equal(signin2.status, 200);
        const adminToken = signin2.body.data.token;

        const list = await req('GET', '/api/users', { token: adminToken });
        assert.equal(list.status, 200);
        assert.ok(list.body.data.some((u) => u.username === 'admin'), 'admin can now list users');

        // And can manage roles + create users (full RBAC via groups -1).
        assert.equal((await req('POST', '/api/roles', { token: adminToken, body: { id: 'ops', name: 'Ops', permissions: ['user.read'] } })).status, 200);
        assert.equal((await req('POST', '/api/users', { token: adminToken, body: { username: 'bob', fullname: 'Bob', password: 'bob-strong-pass-1', roles: ['ops'] } })).status, 200);
    });

    it('bootstrap is idempotent: a second module over the same store seeds no new admin (retained)', async function () {
        this.timeout(15000);
        const spy2 = { deliveries: [], channel: { deliver: async (i) => spy2.deliveries.push(i) } };
        const mod2 = await createAuthManagementModule({
            db, tokenAdapter, enrollmentChannel: spy2.channel, auditLogger: { record: () => {} },
            settings: { secureEnabled: true, enableRefreshCookieAuth: false, auth: { bcryptCost: 4 } },
        });
        assert.equal(mod2.bootstrapResult.kind, 'retained');
        assert.deepEqual(mod2.bootstrapResult.remediated, [], 'the already-rotated admin is not a known default → not remediated');
        assert.equal(spy2.deliveries.length, 0, 'no enrollment delivery on the idempotent retain path');
    });

    it('the factory requires a secure enrollment channel (D-022)', async () => {
        await assert.rejects(
            () => createAuthManagementModule({ db, tokenAdapter, settings: {} }),
            /enrollmentChannel/);
    });
});
