//@ts-check
'use strict';

/**
 * Feature: auth-user-management — authentication/session router (design/01 §4, design/02 §6 · REQ-1/3).
 * Task 13.2 + integration (13.6 partial).
 *
 * REAL end-to-end HTTP: a standalone Express app mounts the real auth router + real
 * Authentication_Service + Token_Service + Refresh_Token_Store + in-memory sqlite + real bcrypt/jwt,
 * driven by global `fetch`. Proves the §01 §4 signin mapping (incl. DV-006 enumeration parity), the
 * §02 §6.3 refresh mapping (disabled/rotated/reject+clear/reuse-revoke), and AC-3.4 sign-out family
 * revocation. Toolchain (N-023/N-025): `node:assert/strict` + real `express`/`sqlite3`/`bcryptjs`/`jsonwebtoken`.
 */

const assert = require('node:assert/strict');
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { FuxaAuthDb } = require('../../auth-management/store/fuxa-auth-db');
const { FuxaUserStoreAdapter } = require('../../auth-management/adapters/fuxa-user-store.adapter');
const { RefreshTokenStore } = require('../../auth-management/store/refresh-token-store');
const { Password_Hasher } = require('../../auth-management/services/password-hasher');
const { BcryptHasherAdapter } = require('../../auth-management/adapters/fuxa-bcrypt.adapter');
const { TokenService } = require('../../auth-management/services/token.service');
const { AuthenticationService } = require('../../auth-management/services/authentication.service');
const { createAuthenticationRouter } = require('../../auth-management/api/authentication.router');

const SECRET = 'auth-router-test-secret-0123456789';
const tokenAdapter = { sign: (p, o) => jwt.sign(p, SECRET, o), verify: (t, o) => jwt.verify(t, SECRET, o), decode: (t) => jwt.decode(t) };
const ALICE_PW = 'alice-strong-pass-1';

/** @type {FuxaAuthDb} */ let db;
let userStore, refreshStore, hasher, tokenService, authService, server, baseUrl;
/** Mutable settings + brute-force gate so tests can toggle refresh-enabled and rate-limiting. */
const settings = { secureEnabled: true, enableRefreshCookieAuth: true, https: false, refreshTokenExpiresIn: '7d' };
const guardState = { allowed: true };

async function seedAlice() {
    await db.run('DELETE FROM users', []);
    await db.run('DELETE FROM auth_refresh_tokens', []);
    await userStore.create({ username: 'alice', fullname: 'Alice', passwordHash: bcrypt.hashSync(ALICE_PW, 4), groups: -1, roles: ['admin'], metadata: { tokenVersion: 0 } });
}

async function req(method, path, opts = {}) {
    const headers = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.cookie) headers['cookie'] = 'fuxa_refresh=' + encodeURIComponent(opts.cookie);
    const r = await fetch(baseUrl + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    let body = null;
    try { body = await r.json(); } catch (_e) { body = null; }
    let refreshCookie = null;
    const setCookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    for (const c of setCookies) {
        const m = c.match(/^fuxa_refresh=([^;]*)/);
        if (m) refreshCookie = m[1] === '' ? '' : decodeURIComponent(m[1]);
    }
    return { status: r.status, body, refreshCookie };
}

before(async function () {
    this.timeout(15000);
    db = new FuxaAuthDb({ dbFile: ':memory:' });
    await db.exec('CREATE TABLE if not exists users (username TEXT PRIMARY KEY, fullname TEXT, password TEXT, groups INTEGER, info TEXT);');
    userStore = new FuxaUserStoreAdapter({ db });
    refreshStore = new RefreshTokenStore({ db });
    await refreshStore.ensureSchema();
    hasher = new Password_Hasher(new BcryptHasherAdapter({ cost: 4 }));
    tokenService = new TokenService({ tokenAdapter, settings: {}, refreshStore, userStore });
    const bruteForceGuard = {
        checkAllowed: () => (guardState.allowed ? { allowed: true } : { allowed: false, retryAfterMs: 5000 }),
        recordFailure: () => {}, reset: () => {},
    };
    authService = new AuthenticationService({ userStore, passwordHasher: hasher, tokenService, bruteForceGuard, auditLogger: { record: () => {} } });

    const app = express();
    app.use(bodyParser.json());
    app.use(createAuthenticationRouter({ authenticationService: authService, tokenService, userStore, refreshStore, settings }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
});

after(async function () {
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.close();
});

beforeEach(async function () {
    this.timeout(15000);
    settings.secureEnabled = true; settings.enableRefreshCookieAuth = true; guardState.allowed = true;
    await seedAlice();
});

describe('Feature: auth-user-management — POST /api/signin (design/01 §4 · REQ-1)', () => {

    it('AC-1.4 missing field ⇒ 400 missing_field (no token)', async () => {
        const r = await req('POST', '/api/signin', { body: { username: 'alice' } });
        assert.equal(r.status, 400);
        assert.equal(r.body.error, 'missing_field');
        assert.equal(r.body.field, 'password');
    });

    it('AC-1.1 success ⇒ 200 { status, data:{ token, username, fullname, roles } }; token verifies', async () => {
        const r = await req('POST', '/api/signin', { body: { username: 'alice', password: ALICE_PW } });
        assert.equal(r.status, 200);
        assert.equal(r.body.status, 'success');
        assert.deepEqual(Object.keys(r.body.data).sort(), ['fullname', 'roles', 'token', 'username']);
        assert.equal(r.body.data.username, 'alice');
        const v = tokenService.verify(r.body.data.token);
        assert.equal(v.authenticated, true);
        assert.equal(v.id, 'alice');
        // refresh enabled ⇒ a fuxa_refresh cookie was set
        assert.ok(r.refreshCookie && r.refreshCookie.length > 0, 'refresh cookie set when enabled');
    });

    it('DV-006: unknown user and bad password return a BYTE-IDENTICAL 401 invalid_credentials (no token)', async () => {
        const unknown = await req('POST', '/api/signin', { body: { username: 'ghost', password: 'whatever-123456' } });
        const bad = await req('POST', '/api/signin', { body: { username: 'alice', password: 'wrong-password-1' } });
        assert.equal(unknown.status, 401);
        assert.equal(bad.status, 401);
        assert.deepEqual(unknown.body, bad.body, 'identical client-facing body (no enumeration oracle)');
        assert.equal(bad.body.error, 'invalid_credentials');
        assert.equal(Object.prototype.hasOwnProperty.call(bad.body, 'token'), false);
    });

    it('rate_limited ⇒ 429 too_many_attempts', async () => {
        guardState.allowed = false;
        const r = await req('POST', '/api/signin', { body: { username: 'alice', password: ALICE_PW } });
        assert.equal(r.status, 429);
        assert.equal(r.body.error, 'too_many_attempts');
    });
});

describe('Feature: auth-user-management — POST /api/refresh + /api/signout (design/02 §6 · REQ-3)', () => {

    it('refresh disabled (enableRefreshCookieAuth off) ⇒ 204', async () => {
        settings.enableRefreshCookieAuth = false;
        const r = await req('POST', '/api/refresh');
        assert.equal(r.status, 204);
    });

    it('AC-3.3 missing cookie ⇒ 401 + cookie cleared', async () => {
        const r = await req('POST', '/api/refresh');
        assert.equal(r.status, 401);
        assert.equal(r.refreshCookie, '', 'cookie cleared on missing (hardening)');
    });

    it('AC-3.2 rotation: a valid refresh rotates both tokens (new access verifies, new cookie set)', async () => {
        const signin = await req('POST', '/api/signin', { body: { username: 'alice', password: ALICE_PW } });
        const r = await req('POST', '/api/refresh', { cookie: signin.refreshCookie });
        assert.equal(r.status, 200);
        assert.equal(r.body.status, 'success');
        const v = tokenService.verify(r.body.data.token);
        assert.equal(v.authenticated, true);
        assert.equal(v.id, 'alice');
        assert.ok(r.refreshCookie && r.refreshCookie !== signin.refreshCookie, 'refresh token rotated (new cookie differs)');
    });

    it('AC-3.3 + RFC 9700 reuse: replaying a rotated refresh ⇒ 401 and the whole family is revoked', async () => {
        const signin = await req('POST', '/api/signin', { body: { username: 'alice', password: ALICE_PW } });
        const first = await req('POST', '/api/refresh', { cookie: signin.refreshCookie });
        assert.equal(first.status, 200);
        // Replay the ORIGINAL (now used) refresh token → reuse detected → 401 + family revoked.
        const replay = await req('POST', '/api/refresh', { cookie: signin.refreshCookie });
        assert.equal(replay.status, 401);
        // The child that WAS active is now revoked too (family killed).
        const afterChild = await req('POST', '/api/refresh', { cookie: first.refreshCookie });
        assert.equal(afterChild.status, 401);
    });

    it('AC-3.4 sign-out revokes the server-side family (not just the cookie) ⇒ 204, and the refresh no longer works', async () => {
        const signin = await req('POST', '/api/signin', { body: { username: 'alice', password: ALICE_PW } });
        const out = await req('POST', '/api/signout', { cookie: signin.refreshCookie });
        assert.equal(out.status, 204);
        assert.equal(out.refreshCookie, '', 'cookie cleared on sign-out');
        // The server-side family is revoked, so the refresh token is dead even though the client still holds it.
        const afterOut = await req('POST', '/api/refresh', { cookie: signin.refreshCookie });
        assert.equal(afterOut.status, 401, 'refresh rejected after sign-out (server-side revoke, AC-3.4)');
    });
});
