//@ts-check
'use strict';

/**
 * Feature: auth-user-management — API layer: authorization middleware + users/roles/account routers
 * (design/04 §8.2, design/05 §8.1, design.md "API Composition Root" · REQ-5..10, REQ-16, REQ-17).
 * Tasks 13.1/13.3/13.4/13.7 + integration (13.6) + the module-authoritative/gate assertions (P-014
 * flavor, 13.8) for the guarded resource surface.
 *
 * REAL end-to-end over HTTP: a standalone Express app mounts the real routers + real services + real
 * in-memory sqlite + real bcrypt + real `jsonwebtoken`, listens on an ephemeral port, and is driven
 * with the global `fetch`. Tokens are issued directly via `Token_Service` (the auth router / signin is
 * Task 13.2), which lets us prove the middleware's LIVE-AUTHORITY behavior (a stale/deleted/downgraded
 * or below-tokenVersion token is denied on the next request — D-015/D-027).
 *
 * Toolchain (N-023/N-025): `node:assert/strict` + real `express`/`sqlite3`/`bcryptjs`/`jsonwebtoken`.
 */

const assert = require('node:assert/strict');
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { FuxaAuthDb } = require('../../auth-management/store/fuxa-auth-db');
const { FuxaUserStoreAdapter } = require('../../auth-management/adapters/fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('../../auth-management/adapters/fuxa-role-store.adapter');
const { AuthorizationService } = require('../../auth-management/services/authorization.service');
const { Password_Hasher } = require('../../auth-management/services/password-hasher');
const { BcryptHasherAdapter } = require('../../auth-management/adapters/fuxa-bcrypt.adapter');
const { UserService } = require('../../auth-management/services/user.service');
const { RoleService } = require('../../auth-management/services/role.service');
const { AccountService } = require('../../auth-management/services/account.service');
const { TokenService } = require('../../auth-management/services/token.service');
const { createAuthorizationMiddleware } = require('../../auth-management/api/authorization.middleware');
const { createUsersRouter } = require('../../auth-management/api/users.router');
const { createRolesRouter } = require('../../auth-management/api/roles.router');
const { createAccountRouter } = require('../../auth-management/api/account.router');

const SECRET = 'api-routers-test-secret-0123456789';
const tokenAdapter = { sign: (p, o) => jwt.sign(p, SECRET, o), verify: (t, o) => jwt.verify(t, SECRET, o), decode: (t) => jwt.decode(t) };

/** @type {FuxaAuthDb} */ let db;
/** @type {FuxaUserStoreAdapter} */ let userStore;
/** @type {FuxaRoleStoreAdapter} */ let roleStore;
/** @type {AuthorizationService} */ let authorization;
/** @type {TokenService} */ let tokenService;
let hasher, userService, roleService, accountService;
let server, baseUrl;

function accessToken(username, groups, roles, tokenVersion) {
    return tokenService.issueAccessToken({ username, groups, roles: roles || [], tokenVersion: tokenVersion || 0 });
}
/** HTTP helper: returns { status, body }. */
async function call(method, path, opts = {}) {
    const headers = {};
    if (opts.token) headers['x-access-token'] = opts.token;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(baseUrl + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    let body = null;
    try { body = await r.json(); } catch (_e) { body = null; }
    return { status: r.status, body };
}
async function resetTables() {
    await db.run('DELETE FROM users', []);
    await db.run('DELETE FROM roles', []);
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
    tokenService = new TokenService({ tokenAdapter, settings: {} });
    userService = new UserService({ userStore, passwordHasher: hasher, authorization, auditLogger: { record: () => {} } });
    roleService = new RoleService({ roleStore, userStore, auditLogger: { record: () => {} } });
    accountService = new AccountService({ userStore, passwordHasher: hasher, auditLogger: { record: () => {} } });

    const mw = createAuthorizationMiddleware({ tokenService, userStore, authorizationService: authorization });
    const app = express();
    app.use(bodyParser.json());
    app.use(createUsersRouter({ userService, requirePermission: mw.requirePermission }));
    app.use(createRolesRouter({ roleService, requirePermission: mw.requirePermission }));
    app.use(createAccountRouter({ accountService, requirePermission: mw.requirePermission }));

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
});

after(async function () {
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.close();
});

beforeEach(async function () {
    this.timeout(15000);
    await resetTables();
    // A full admin (group-code -1), a viewer (RBAC role: user.read only), and a gated seeded admin.
    await userStore.create({ username: 'admin', fullname: 'Admin', passwordHash: bcrypt.hashSync('adminpw', 4), groups: -1, roles: [], metadata: {} });
    await roleStore.create({ id: 'viewer', name: 'Viewer', permissions: ['user.read'] });
    await userStore.create({ username: 'val', fullname: 'Val', passwordHash: bcrypt.hashSync('valpw12345678', 4), groups: 3, roles: ['viewer'], metadata: {} });
    await userStore.create({ username: 'seed', fullname: 'Seeded', passwordHash: bcrypt.hashSync('onetimesecret1', 4), groups: -1, roles: [], metadata: { mustRotate: true, tokenVersion: 0 } });
});

describe('Feature: auth-user-management — API middleware + users router (design/04 §8.2 · REQ-5..8/10)', () => {

    it('AC-10.3: no token ⇒ 401 unauthorized_error (no store resolution needed)', async () => {
        const r = await call('GET', '/api/users');
        assert.equal(r.status, 401);
        assert.equal(r.body.error, 'unauthorized_error');
    });

    it('AC-10.1/10.4: an admin (group -1) lists users; AC-6.2 the hash is never present', async () => {
        const r = await call('GET', '/api/users', { token: accessToken('admin', -1, []) });
        assert.equal(r.status, 200);
        assert.ok(Array.isArray(r.body.data));
        for (const u of r.body.data) {
            assert.equal(Object.prototype.hasOwnProperty.call(u, 'passwordHash'), false);
            assert.equal(Object.prototype.hasOwnProperty.call(u, 'password'), false);
        }
    });

    it('AC-10.1 vs AC-10.2: a viewer (user.read) may GET but is 403 on create', async () => {
        const vtok = accessToken('val', 3, ['viewer']);
        assert.equal((await call('GET', '/api/users', { token: vtok })).status, 200);
        const c = await call('POST', '/api/users', { token: vtok, body: { username: 'x', password: 'a-valid-pass-12', roles: [] } });
        assert.equal(c.status, 403);
        assert.equal(c.body.error, 'forbidden');
    });

    it('AC-5.1/5.2/5.3 + DEF-U2: admin creates, then duplicate/missing-field/policy failures map to 400', async () => {
        const t = accessToken('admin', -1, []);
        const created = await call('POST', '/api/users', { token: t, body: { username: 'bob', fullname: 'Bob', password: 'bob-strong-pass-1', roles: [] } });
        assert.equal(created.status, 200);
        assert.equal(created.body.data.username, 'bob');
        assert.equal(Object.prototype.hasOwnProperty.call(created.body.data, 'passwordHash'), false);

        assert.equal((await call('POST', '/api/users', { token: t, body: { username: 'bob', password: 'bob-strong-pass-1' } })).body.error, 'duplicate_username');
        assert.equal((await call('POST', '/api/users', { token: t, body: { password: 'x-strong-pass-123' } })).body.error, 'missing_field');
        assert.equal((await call('POST', '/api/users', { token: t, body: { username: 'weak', password: 'short' } })).body.error, 'validation_error');
    });

    it('AC-6.3/6.4 get + AC-7.x update + AC-8.x delete map to the §04 §8.2 statuses', async () => {
        const t = accessToken('admin', -1, []);
        await call('POST', '/api/users', { token: t, body: { username: 'carol', fullname: 'Carol', password: 'carol-strong-1', roles: [] } });
        assert.equal((await call('GET', '/api/users/carol', { token: t })).body.data.username, 'carol');
        assert.equal((await call('GET', '/api/users/ghost', { token: t })).body.data, null); // empty ≠ error
        assert.equal((await call('PUT', '/api/users/carol', { token: t, body: { fullname: 'Carol2' } })).body.data.fullname, 'Carol2');
        assert.equal((await call('PUT', '/api/users/ghost', { token: t, body: { fullname: 'x' } })).status, 404);
        assert.equal((await call('DELETE', '/api/users/carol', { token: t })).status, 200);
        assert.equal((await call('DELETE', '/api/users/ghost', { token: t })).status, 404);
    });

    it('live authority (D-015): a token for a DELETED account is denied 401 on the next request', async () => {
        const t = accessToken('admin', -1, []);
        await call('POST', '/api/users', { token: t, body: { username: 'temp', fullname: 'Temp', password: 'temp-strong-12', roles: ['viewer'] } });
        const tempTok = accessToken('temp', 3, ['viewer']);
        assert.equal((await call('GET', '/api/users', { token: tempTok })).status, 200, 'temp (viewer) can read while it exists');
        await call('DELETE', '/api/users/temp', { token: t });
        assert.equal((await call('GET', '/api/users', { token: tempTok })).status, 401, 'deleted account ⇒ token denied next request');
    });
});

describe('Feature: auth-user-management — roles router (design/05 §8.1 · REQ-9)', () => {

    it('role CRUD maps to §8.1 statuses; role.* permissions guard each route', async () => {
        const t = accessToken('admin', -1, []);
        assert.equal((await call('GET', '/api/roles', { token: t })).status, 200);
        assert.equal((await call('POST', '/api/roles', { token: t, body: { id: 'ops', name: 'Ops', permissions: ['user.read'] } })).status, 200);
        assert.equal((await call('POST', '/api/roles', { token: t, body: { id: 'ops', name: 'Dup', permissions: [] } })).body.error, 'duplicate_role');
        assert.equal((await call('PUT', '/api/roles/ghost', { token: t, body: { permissions: [] } })).status, 404);
        assert.equal((await call('PUT', '/api/roles/ops', { token: t, body: { permissions: ['role.read'] } })).status, 200);
        assert.equal((await call('DELETE', '/api/roles/ops', { token: t })).status, 200);
        // A viewer lacks role.read ⇒ 403.
        assert.equal((await call('GET', '/api/roles', { token: accessToken('val', 3, ['viewer']) })).status, 403);
    });
});

describe('Feature: auth-user-management — account rotate + bootstrap gate (design/12 · REQ-17)', () => {

    it('AC-17.2 gate: a mustRotate admin is 403 on protected ops but CAN reach rotate-password; AC-17.3 clears the gate', async () => {
        const gatedTok = accessToken('seed', -1, [], 0);
        // Gated: every protected op except rotate is denied (even though seed is a group -1 admin).
        assert.equal((await call('GET', '/api/users', { token: gatedTok })).status, 403);

        // Rotate with the wrong current secret ⇒ 400 bad_current, gate NOT cleared.
        const bad = await call('POST', '/api/account/rotate-password', { token: gatedTok, body: { currentPassword: 'wrong', newPassword: 'fresh-strong-pass-1' } });
        assert.equal(bad.status, 400);
        assert.equal(bad.body.error, 'bad_current_password');
        assert.equal((await call('GET', '/api/users', { token: gatedTok })).status, 403, 'still gated after a failed rotate');

        // Rotate correctly ⇒ 200; mustRotate cleared + tokenVersion bumped 0→1.
        const ok = await call('POST', '/api/account/rotate-password', { token: gatedTok, body: { currentPassword: 'onetimesecret1', newPassword: 'fresh-strong-pass-1' } });
        assert.equal(ok.status, 200);

        // D-027 active revocation: the OLD token (tokenVersion 0) is now denied 401 on the next request.
        assert.equal((await call('GET', '/api/users', { token: gatedTok })).status, 401, 'pre-rotation token revoked by tokenVersion bump');
        // A fresh token (tokenVersion 1) now has full admin authority (gate cleared, AC-17.3).
        assert.equal((await call('GET', '/api/users', { token: accessToken('seed', -1, [], 1) })).status, 200);
    });
});

describe('Feature: auth-user-management — middleware fail-fast (AC-16.4)', () => {

    it('a store failure during identity resolution ⇒ 503 service_unavailable (fail fast, never proceed unauthenticated)', async () => {
        const throwingStore = { get: async () => { throw new Error('db down'); } };
        const mw = createAuthorizationMiddleware({ tokenService, userStore: throwingStore, authorizationService: authorization });
        const app = express();
        app.use(bodyParser.json());
        app.get('/api/users', mw.requirePermission('user.read'), (req, res) => res.status(200).json({ status: 'success' }));
        const s = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
        try {
            const port = s.address().port;
            const r = await fetch('http://127.0.0.1:' + port + '/api/users', { headers: { 'x-access-token': accessToken('admin', -1, []) } });
            assert.equal(r.status, 503);
            const b = await r.json();
            assert.equal(b.error, 'service_unavailable');
        } finally {
            await new Promise((r) => s.close(r));
        }
    });
});
