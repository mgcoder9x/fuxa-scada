//@ts-check
'use strict';

/**
 * Feature: auth-user-management — own-authority + vocabulary endpoint (D-050).
 *
 * Real end-to-end over HTTP: a standalone Express app mounts the real `createPermissionsRouter` + the
 * real authorization middleware + real `AuthorizationService` + real in-memory sqlite, driven with
 * global `fetch` (same harness as api.auth-config.test.js — N-023/N-025 toolchain).
 *
 * What these tests pin down (each maps to a defect observed LIVE in N-091):
 *   - L1 REGRESSION (the whole point of D-050): a NON-ADMIN whose only role grants `user.read` must
 *     receive `effective: ['user.read']` from an endpoint it is ALLOWED to call. Before D-050 the
 *     client could only learn this from `GET /api/roles`, which such a user is 403'd from — hence the
 *     permanent client-side deny. The gate here is authentication-only, so the deadlock cannot recur.
 *   - L3 REGRESSION: `catalog` MUST contain `settings.read`/`settings.manage` (D-049), so the role
 *     editor can grant them; the hand-mirrored client list had silently missed them.
 *   - the endpoint must never over-report: unauthenticated → 401, and a `mustRotate` (bootstrap-gated)
 *     identity → `effective: []` per P-009 (it may do nothing but rotate).
 *   - `effective` must agree with ENFORCEMENT: it is produced by the same
 *     `AuthorizationService.effective` that `isAllowed` consults, asserted here against `isAllowed`.
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
const { createAuthorizationMiddleware } = require('../../auth-management/api/authorization.middleware');
const { createPermissionsRouter } = require('../../auth-management/api/permissions.router');
const { ADMIN_PERMISSION_SET } = require('../../auth-management/models/permission');

const SECRET = 'permissions-http-secret-0123456789';
const tokenAdapter = { sign: (p, o) => jwt.sign(p, SECRET, o), verify: (t, o) => jwt.verify(t, SECRET, o), decode: (t) => jwt.decode(t) };

/** @type {FuxaAuthDb} */ let db;
let tokenService, authorization, server, baseUrl;

function token(username, groups, roles) {
    return tokenService.issueAccessToken({ username, groups, roles: roles || [], tokenVersion: 0 });
}
async function call(method, path, opts = {}) {
    const headers = {};
    if (opts.token) headers['x-access-token'] = opts.token;
    const r = await fetch(baseUrl + path, { method, headers });
    let body = null;
    try { body = await r.json(); } catch (_e) { body = null; }
    return { status: r.status, body };
}

before(async function () {
    this.timeout(15000);
    db = new FuxaAuthDb({ dbFile: ':memory:' });
    await db.exec('CREATE TABLE if not exists users (username TEXT PRIMARY KEY, fullname TEXT, password TEXT, groups INTEGER, info TEXT);');
    await db.exec('CREATE TABLE if not exists roles (name TEXT PRIMARY KEY, value TEXT);');
    // The exact live shape from N-091: a role granting ONLY user.read, plus a user bound to it.
    await db.run("INSERT INTO roles (name, value) VALUES ('viewer','{\"id\":\"viewer\",\"name\":\"Viewer\",\"permissions\":[\"user.read\"]}')", []);
    // A second role carrying an operator-defined permission absent from ADMIN_PERMISSION_SET.
    await db.run("INSERT INTO roles (name, value) VALUES ('custom','{\"id\":\"custom\",\"name\":\"Custom\",\"permissions\":[\"project.view\"]}')", []);
    await db.run("INSERT INTO users (username, fullname, password, groups, info) VALUES ('admin','Admin','',-1,'{\"roles\":[]}')", []);
    await db.run("INSERT INTO users (username, fullname, password, groups, info) VALUES ('operator1','Operator','',0,'{\"roles\":[\"viewer\"]}')", []);
    await db.run("INSERT INTO users (username, fullname, password, groups, info) VALUES ('nobody','Nobody','',0,'{\"roles\":[]}')", []);
    // A bootstrap-gated admin (mustRotate) — must report NO authority (P-009).
    await db.run("INSERT INTO users (username, fullname, password, groups, info) VALUES ('gated','Gated','',-1,'{\"roles\":[],\"mustRotate\":true}')", []);

    const userStore = new FuxaUserStoreAdapter({ db });
    const roleStore = new FuxaRoleStoreAdapter({ db });
    authorization = new AuthorizationService({ roleStore });
    tokenService = new TokenService({ tokenAdapter, settings: {} });

    const mw = createAuthorizationMiddleware({ tokenService, userStore, authorizationService: authorization });
    const app = express();
    app.use(bodyParser.json());
    app.use(createPermissionsRouter({ authorizationService: authorization, roleStore, requireAuthenticated: mw.requireAuthenticated }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
});
after(function () { if (server) server.close(); return db && db.close(); });

describe('GET /api/auth/permissions — gate (D-050: authenticated-only, deliberately NOT permission-gated)', function () {
    it('401 without a token', async function () {
        const r = await call('GET', '/api/auth/permissions');
        assert.equal(r.status, 401);
        assert.equal(r.body.error, 'unauthorized_error');
    });

    it('401 for a token whose account no longer exists (live-authority read, D-015)', async function () {
        const r = await call('GET', '/api/auth/permissions', { token: token('ghost', 0) });
        assert.equal(r.status, 401);
    });

    it('L1 REGRESSION: a NON-ADMIN with only user.read gets 200 and its own effective set', async function () {
        const r = await call('GET', '/api/auth/permissions', { token: token('operator1', 0, ['viewer']) });
        assert.equal(r.status, 200, 'a non-admin MUST be able to read its own authority — otherwise the client deadlocks (N-091 L1)');
        assert.equal(r.body.data.username, 'operator1');
        assert.deepEqual(r.body.data.effective, ['user.read']);
        assert.equal(r.body.data.mustRotate, false);
    });

    it('a user with NO roles gets 200 with an empty effective set (not an error)', async function () {
        const r = await call('GET', '/api/auth/permissions', { token: token('nobody', 0) });
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.data.effective, []);
    });
});

describe('GET /api/auth/permissions — payload correctness', function () {
    it('an admin (legacy group code) reports the full ADMIN_PERMISSION_SET', async function () {
        const r = await call('GET', '/api/auth/permissions', { token: token('admin', -1) });
        assert.equal(r.status, 200);
        for (const p of ADMIN_PERMISSION_SET) {
            assert.ok(r.body.data.effective.includes(p), 'admin must hold ' + p);
        }
    });

    it('L3 REGRESSION: the catalog exposes the D-049 settings.* permissions (so roles can be granted them)', async function () {
        const r = await call('GET', '/api/auth/permissions', { token: token('operator1', 0, ['viewer']) });
        assert.ok(r.body.data.catalog.includes('settings.read'), 'catalog must include settings.read (N-091 L3)');
        assert.ok(r.body.data.catalog.includes('settings.manage'), 'catalog must include settings.manage (N-091 L3)');
    });

    it('the catalog is the admin set UNION permissions present on stored roles, sorted + de-duplicated', async function () {
        const r = await call('GET', '/api/auth/permissions', { token: token('admin', -1) });
        const catalog = r.body.data.catalog;
        for (const p of ADMIN_PERMISSION_SET) {
            assert.ok(catalog.includes(p));
        }
        assert.ok(catalog.includes('project.view'), 'an operator-defined role permission must stay visible');
        assert.deepEqual(catalog, Array.from(new Set(catalog)).sort(), 'catalog must be sorted and de-duplicated');
    });

    it('a bootstrap-gated (mustRotate) identity reports NO authority — P-009', async function () {
        const r = await call('GET', '/api/auth/permissions', { token: token('gated', -1) });
        assert.equal(r.status, 200);
        assert.equal(r.body.data.mustRotate, true);
        assert.deepEqual(r.body.data.effective, [], 'a gated account may do nothing but rotate');
    });

    it('effective AGREES with enforcement: every reported permission is allowed by isAllowed, and a withheld one is not', async function () {
        const r = await call('GET', '/api/auth/permissions', { token: token('operator1', 0, ['viewer']) });
        const identity = { authenticated: true, username: 'operator1', roles: ['viewer'], groups: 0, mustRotate: false };
        for (const p of r.body.data.effective) {
            const d = await authorization.isAllowed(identity, { id: p, requiredPermission: p });
            assert.deepEqual(d, { allow: true }, 'reported permission must actually be enforced as allowed: ' + p);
        }
        const withheld = r.body.data.catalog.filter((p) => !r.body.data.effective.includes(p));
        for (const p of withheld) {
            const d = await authorization.isAllowed(identity, { id: p, requiredPermission: p });
            assert.equal(d.allow, false, 'a permission NOT reported must be denied by enforcement: ' + p);
        }
    });
});
