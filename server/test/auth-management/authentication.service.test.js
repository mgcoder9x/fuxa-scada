//@ts-check
'use strict';

/**
 * Feature: auth-user-management — Authentication_Service (design/01 · REQ-1). Task 7.
 *
 * REQ-1's criteria are status/shape behaviors, so this is EXAMPLE/EDGE coverage (design/01 §8 —
 * DES-AUTH owns no property). The universal correctness properties it relies on (P-001/P-002 hash,
 * P-007 token) are owned/tested in §03 and §02. Here we isolate the DECISION logic with test doubles
 * for User_Store / Password_Hasher / Token_Service / BruteForceGuard / Audit_Logger and assert the
 * outcome→shape mapping, the DV-006 enumeration parity, and the AC-1.5 structural delegation.
 *
 * Toolchain (N-023/N-025): `node:assert/strict` + `node:test`-free mocha. No FUXA runtime init.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AuthenticationService } = require('../../auth-management/services/authentication.service');

const ALICE = { username: 'alice', fullname: 'Alice A', passwordHash: '$2a$12$abcdefghijklmnopqrstuv', roles: ['admin'], metadata: { tokenVersion: 5 }, groups: -1 };

/**
 * Build the service with call-recording test doubles. `o` overrides:
 *   record (default undefined = unknown user), verifyResult (default false), guard (default allowed),
 *   tokenThrows (default false).
 */
function build(o = {}) {
    const calls = { get: [], verify: [], issue: [], checkAllowed: [], recordFailure: [], reset: [], audit: [] };
    const userStore = {
        get: async (u) => { calls.get.push(u); return o.record !== undefined ? o.record : undefined; },
    };
    const passwordHasher = {
        hash: (pw) => 'HASH(' + pw + ')',
        verify: (pw, h) => { calls.verify.push([pw, h]); return o.verifyResult === true; },
    };
    const tokenService = {
        issueAccessToken: (identity) => { calls.issue.push(identity); if (o.tokenThrows) throw new Error('token_fail'); return 'TOKEN123'; },
    };
    const bruteForceGuard = {
        checkAllowed: (u) => { calls.checkAllowed.push(u); return o.guard || { allowed: true }; },
        recordFailure: (u) => { calls.recordFailure.push(u); },
        reset: (u) => { calls.reset.push(u); },
    };
    const auditLogger = { record: (e) => { calls.audit.push(e); } };
    const svc = new AuthenticationService({ userStore, passwordHasher, tokenService, bruteForceGuard, auditLogger });
    return { svc, calls };
}

describe('Feature: auth-user-management — Authentication_Service (design/01 · REQ-1)', () => {

    it('AC-1.1 success: returns { token, username, fullname, roles }; issues token with live identity incl. tokenVersion (D-027)', async () => {
        const { svc, calls } = build({ record: ALICE, verifyResult: true });
        const res = await svc.signIn({ username: 'alice', password: 's3cret' });
        assert.equal(res.kind, 'success');
        assert.deepEqual(res.session, { token: 'TOKEN123', username: 'alice', fullname: 'Alice A', roles: ['admin'] });
        // token issued from the LIVE record: groups + roles + tokenVersion (D-027)
        assert.equal(calls.issue.length, 1);
        assert.deepEqual(calls.issue[0], { username: 'alice', groups: -1, roles: ['admin'], tokenVersion: 5 });
        // success resets the brute-force counter (AC-15.4), never records a failure
        assert.deepEqual(calls.reset, ['alice']);
        assert.deepEqual(calls.recordFailure, []);
        // AC-1.5: exactly one delegated compare, with (submittedPassword, storedHash)
        assert.equal(calls.verify.length, 1);
        assert.deepEqual(calls.verify[0], ['s3cret', ALICE.passwordHash]);
    });

    it('AC-1.2 unknown user (DV-006): invalid_credentials, no token, dummy-hash verify for timing parity, failure counted', async () => {
        const { svc, calls } = build({ record: undefined });
        const res = await svc.signIn({ username: 'ghost', password: 's3cret' });
        assert.equal(res.kind, 'unknown_user');
        assert.equal(res.error, 'invalid_credentials');
        assert.equal(res.session, undefined, 'no token/session for unknown user');
        // timing parity: verify was still called (against the dummy hash), result discarded
        assert.equal(calls.verify.length, 1);
        assert.ok(String(calls.verify[0][1]).startsWith('HASH('), 'verified against the dummy hash');
        assert.deepEqual(calls.recordFailure, ['ghost']);
        assert.equal(calls.issue.length, 0);
    });

    it('AC-1.3 bad password: invalid_credentials, no token, failure counted; delegated compare against the stored hash', async () => {
        const { svc, calls } = build({ record: ALICE, verifyResult: false });
        const res = await svc.signIn({ username: 'alice', password: 'wrong' });
        assert.equal(res.kind, 'bad_password');
        assert.equal(res.error, 'invalid_credentials');
        assert.equal(res.session, undefined);
        assert.deepEqual(calls.verify[0], ['wrong', ALICE.passwordHash]);
        assert.deepEqual(calls.recordFailure, ['alice']);
        assert.equal(calls.issue.length, 0);
    });

    it('DV-006 enumeration safety: unknown-user and bad-password expose an IDENTICAL client-facing result', async () => {
        const unknown = await build({ record: undefined }).svc.signIn({ username: 'ghost', password: 'x' });
        const bad = await build({ record: ALICE, verifyResult: false }).svc.signIn({ username: 'alice', password: 'x' });
        // Client sees only { error, no-session } — must be indistinguishable (the `kind` is server-side audit only).
        const clientView = (r) => ({ error: r.error, hasToken: r.session !== undefined });
        assert.deepEqual(clientView(unknown), clientView(bad));
        assert.deepEqual(clientView(unknown), { error: 'invalid_credentials', hasToken: false });
    });

    it('AC-1.4 missing field: rejected up-front (400 id); store + brute-force guard never touched', async () => {
        for (const [creds, field] of [
            [{ password: 'x' }, 'username'],
            [{ username: 'a' }, 'password'],
            [{ username: '   ', password: 'x' }, 'username'],
            [{ username: 'a', password: '   ' }, 'password'],
            [{}, 'username'],
        ]) {
            const { svc, calls } = build({});
            const res = await svc.signIn(creds);
            assert.equal(res.kind, 'missing_field');
            assert.equal(res.error, 'missing_field');
            assert.equal(res.field, field);
            assert.deepEqual(calls.get, [], 'store not queried on a malformed request');
            assert.deepEqual(calls.checkAllowed, [], 'brute-force not consulted on a malformed request');
            assert.deepEqual(calls.recordFailure, [], 'a malformed request is not a counted failure');
        }
    });

    it('rate_limited: a throttled username short-circuits to 429 BEFORE any store lookup / compare', async () => {
        const { svc, calls } = build({ guard: { allowed: false, retryAfterMs: 5000 } });
        const res = await svc.signIn({ username: 'alice', password: 's3cret' });
        assert.equal(res.kind, 'rate_limited');
        assert.equal(res.error, 'too_many_attempts');
        assert.equal(res.retryAfterMs, 5000);
        assert.deepEqual(calls.get, [], 'no store lookup when rate-limited');
        assert.deepEqual(calls.verify, [], 'no password compare when rate-limited');
        assert.ok(calls.audit.some((e) => e.outcome === 'rate_limited'));
    });

    it('record present but blank passwordHash → bad_password without calling verify (§7)', async () => {
        const { svc, calls } = build({ record: { ...ALICE, passwordHash: '' }, verifyResult: true });
        const res = await svc.signIn({ username: 'alice', password: 's3cret' });
        assert.equal(res.kind, 'bad_password');
        assert.deepEqual(calls.verify, [], 'a record with no hash cannot authenticate; no compare attempted');
        assert.deepEqual(calls.recordFailure, ['alice']);
    });

    it('token issuance failure after a valid credential → rethrows (→ 5xx), not success; guard not reset', async () => {
        const { svc, calls } = build({ record: ALICE, verifyResult: true, tokenThrows: true });
        await assert.rejects(() => svc.signIn({ username: 'alice', password: 's3cret' }), /token_fail/);
        assert.deepEqual(calls.reset, [], 'no reset when no session was established');
        assert.ok(calls.audit.some((e) => e.outcome === 'error'), 'the failed attempt is audited');
    });

    it('audit events are secret-free (no password/passwordHash/token keys) and record the outcome + subject', async () => {
        const { svc, calls } = build({ record: ALICE, verifyResult: true });
        await svc.signIn({ username: 'alice', password: 's3cret' });
        const ev = calls.audit.find((e) => e.outcome === 'success');
        assert.ok(ev, 'a success audit event exists');
        assert.equal(ev.subject, 'alice');
        assert.equal(ev.category, 'authentication');
        for (const forbidden of ['password', 'passwordHash', 'token', 'secret']) {
            assert.equal(Object.prototype.hasOwnProperty.call(ev, forbidden), false, 'no ' + forbidden + ' in audit event');
        }
    });

    it('AC-1.5 structural: the service imports NO bcryptjs / jsonwebtoken (comparison delegated to the Hash seam)', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../auth-management/services/authentication.service.js'), 'utf8');
        assert.equal(/require\(['"]bcryptjs['"]\)/.test(src), false, 'must not import bcryptjs');
        assert.equal(/require\(['"]jsonwebtoken['"]\)/.test(src), false, 'must not import jsonwebtoken');
    });
});
