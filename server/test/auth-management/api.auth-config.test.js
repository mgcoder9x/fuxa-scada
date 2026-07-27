//@ts-check
'use strict';

/**
 * Feature: auth-user-management — auth-config HTTP surface (D-049, design/13-runtime-config.md §3/§5).
 * Real end-to-end over HTTP: a standalone Express app mounts the real `createAuthConfigRouter` + the
 * real authorization middleware + real services + real in-memory sqlite, driven with global `fetch`.
 *
 * Proves P-020 (gated): GET requires `settings.read`, PUT/DELETE require `settings.manage`;
 * unauthenticated → 401, unpermitted → 403; and the validate/persist round-trip over HTTP.
 * Toolchain (N-023/N-025): `node:assert/strict` + real `express`/`sqlite3`/`jsonwebtoken`.
 */

const assert = require('node:assert/strict');
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

const { FuxaAuthDb } = require('../../auth-management/store/fuxa-auth-db');
const { FuxaUserStoreAdapter } = require('../../auth-management/adapters/fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('../../auth-management/adapters/fuxa-role-store.adapter');
const { AuthorizationService } = require('../../auth-management/services/authorization.service');
const { TokenService } = require('../../auth-management/services/token.service');
const { AuthConfigStore } = require('../../auth-management/store/auth-config-store');
const { AuthConfigService } = require('../../auth-management/services/auth-config.service');
const { createAuthorizationMiddleware } = require('../../auth-management/api/authorization.middleware');
const { createAuthConfigRouter } = require('../../auth-management/api/auth-config.router');

const SECRET = 'auth-config-http-secret-0123456789';
const tokenAdapter = { sign: (p, o) => jwt.sign(p, SECRET, o), verify: (t, o) => jwt.verify(t, SECRET, o), decode: (t) => jwt.decode(t) };

/** @type {FuxaAuthDb} */ let db;
let tokenService, server, baseUrl;

function token(username, groups) {
    return tokenService.issueAccessToken({ username, groups, roles: [], tokenVersion: 0 });
}
async function call(method, path, opts = {}) {
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
    await db.exec('CREATE TABLE if not exists users (username TEXT PRIMARY KEY, fullname TEXT, password TEXT, groups INTEGER, info TEXT);');
    await db.exec('CREATE TABLE if not exists roles (name TEXT PRIMARY KEY, value TEXT);');
    // admin (groups -1 ⇒ ADMIN_PERMISSION_SET incl. settings.*) + plain user (no perms).
    await db.run("INSERT INTO users (username, fullname, password, groups, info) VALUES ('admin','Admin','',-1,'{\"roles\":[]}')", []);
    await db.run("INSERT INTO users (username, fullname, password, groups, info) VALUES ('bob','Bob','',0,'{\"roles\":[]}')", []);

    const userStore = new FuxaUserStoreAdapter({ db });
    const roleStore = new FuxaRoleStoreAdapter({ db });
    const authorization = new AuthorizationService({ roleStore });
    tokenService = new TokenService({ tokenAdapter, settings: {} });

    const store = new AuthConfigStore({ db });
    await store.ensureSchema();
    // Spy services satisfy the AuthConfigService constructor; the HTTP layer under test is the gate +
    // validate/persist round-trip (live-apply is covered by auth-config.service.test.js).
    const noop = { reconfigure: () => {}, setCost: () => {}, setPasswordPolicy: () => {} };
    const authConfigService = new AuthConfigService({
        store,
        baseline: { auth: { passwordMinLength: 12, bcryptCost: 12 }, tokenExpiresIn: '1h', refreshTokenExpiresIn: '7d' },
        auditLogger: { record: () => {} },
        services: { tokenService: noop, bruteForceGuard: noop, passwordHasher: noop, userService: noop, accountService: noop },
    });

    const mw = createAuthorizationMiddleware({ tokenService, userStore, authorizationService: authorization });
    const app = express();
    app.use(bodyParser.json());
    app.use(createAuthConfigRouter({ authConfigService, requirePermission: mw.requirePermission }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
});
after(function () { if (server) server.close(); return db && db.close(); });

describe('GET /api/auth/config (settings.read gate — P-020)', function () {
    it('401 without a token', async function () {
        const r = await call('GET', '/api/auth/config');
        assert.equal(r.status, 401);
    });
    it('403 for a non-admin (no settings.read)', async function () {
        const r = await call('GET', '/api/auth/config', { token: token('bob', 0) });
        assert.equal(r.status, 403);
    });
    it('200 for an admin, returns the effective config', async function () {
        const r = await call('GET', '/api/auth/config', { token: token('admin', -1) });
        assert.equal(r.status, 200);
        assert.equal(r.body.status, 'success');
        assert.equal(r.body.data.passwordMinLength, 12);
    });

    /**
     * D-049 Phase 2: the response also carries the VALIDATION BOUNDS so the settings page can validate
     * a patch and phrase field messages with the REAL limits instead of hand-copying them. A hand-copied
     * constant is precisely the drift that made `settings.*` ungrantable in the role editor (N-091 L3),
     * so this assertion exists to keep the client honest — if a bound changes server-side, the UI follows.
     */
    it('200 also returns the validation BOUNDS (so the client never hand-copies limits)', async function () {
        const { BOUNDS } = require('../../auth-management/services/auth-config.service');
        const r = await call('GET', '/api/auth/config', { token: token('admin', -1) });
        assert.ok(r.body.bounds, 'bounds must be present');
        assert.deepEqual(r.body.bounds.passwordMinLength, BOUNDS.passwordMinLength);
        assert.deepEqual(r.body.bounds.bcryptCost, BOUNDS.bcryptCost);
        assert.equal(r.body.bounds.blocklistMaxEntries, BOUNDS.blocklistMaxEntries);
        assert.equal(r.body.bounds.blocklistMaxEntryLen, BOUNDS.blocklistMaxEntryLen);
        // sanity: the bounds are the real policy, not placeholders
        assert.equal(r.body.bounds.bcryptCost.min >= 10, true, 'bcrypt floor must not drop below FUXA baseline (D-008)');
    });
});

describe('PUT /api/auth/config (settings.manage gate + validate/persist — P-018/P-020)', function () {
    it('403 for a non-admin', async function () {
        const r = await call('PUT', '/api/auth/config', { token: token('bob', 0), body: { passwordMinLength: 20 } });
        assert.equal(r.status, 403);
    });
    it('400 for an invalid patch (out-of-bounds)', async function () {
        const r = await call('PUT', '/api/auth/config', { token: token('admin', -1), body: { bcryptCost: 99 } });
        assert.equal(r.status, 400);
        assert.equal(r.body.error, 'validation_error');
        assert.ok(Array.isArray(r.body.errors) && r.body.errors.length > 0);
    });
    it('200 for a valid patch, and the change is persisted (round-trip via GET)', async function () {
        const put = await call('PUT', '/api/auth/config', { token: token('admin', -1), body: { passwordMinLength: 20 } });
        assert.equal(put.status, 200);
        assert.equal(put.body.data.passwordMinLength, 20);
        const get = await call('GET', '/api/auth/config', { token: token('admin', -1) });
        assert.equal(get.body.data.passwordMinLength, 20);
    });
    it('DELETE resets to defaults', async function () {
        await call('PUT', '/api/auth/config', { token: token('admin', -1), body: { passwordMinLength: 40 } });
        const del = await call('DELETE', '/api/auth/config', { token: token('admin', -1) });
        assert.equal(del.status, 200);
        assert.equal(del.body.data.passwordMinLength, 12);
    });
});
