//@ts-check
'use strict';

/**
 * Feature: auth-user-management — Refresh_Token_Store + Token_Service.refresh (design/02 §6, REQ-3;
 * D-019 fixes N-015; D-030 hashing/CAS). Tasks 5.7 (store + rotation/reuse) and 5.8 (P-015).
 *
 * REAL crypto + REAL sqlite: the store runs against a temp-directory `users.fuxap.db` via
 * {@link FuxaAuthDb}, and refresh tokens are signed/verified with real `jsonwebtoken` through an
 * injected seam (same calls the production `TokenAdapter` makes). This exercises the full
 * verify → store lookup → reuse-detection → live-account → atomic consume-and-rotate path end-to-end,
 * closing the N-022 refresh-path real-crypto gap. Toolchain (N-023/N-025): `node:assert/strict` +
 * `fast-check@3` + real `jsonwebtoken` + real `sqlite3`.
 */

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const fc = require('fast-check');
const jwt = require('jsonwebtoken');

const { FuxaAuthDb } = require('../../auth-management/store/fuxa-auth-db');
const { RefreshTokenStore } = require('../../auth-management/store/refresh-token-store');
const { TokenService } = require('../../auth-management/services/token.service');

const SECRET = 'refresh-test-secret-0123456789';

function makeAdapter(secret) {
    return {
        sign: (payload, options) => jwt.sign(payload, secret, options),
        verify: (token, options) => jwt.verify(token, secret, options),
        decode: (token) => jwt.decode(token),
    };
}

function tamperSignature(token) {
    const parts = token.split('.');
    const sig = parts[2] || '';
    parts[2] = (sig.charAt(0) === 'A' ? 'B' : 'A') + sig.slice(1);
    return parts.join('.');
}

/** @type {FuxaAuthDb} */ let db;
/** @type {RefreshTokenStore} */ let store;
let tmpDir;
/** Mutable fake User_Store; `accountVersion` lets tests drive the D-027 version check. */
let accountVersion = 0;
let accountExists = true;
const userStore = {
    get: async (username) => {
        if (!accountExists || username !== 'alice') return undefined;
        return { username: 'alice', fullname: 'Alice', passwordHash: '', roles: ['admin'], metadata: { tokenVersion: accountVersion }, groups: -1 };
    },
};

/** Seed one initial `active` refresh token for a fresh family; returns the raw token + ids. */
async function seedFamily(service, username, tokenVersion) {
    const minted = service.issueRefreshToken({ username, tokenVersion });
    const claims = /** @type {any} */ (jwt.decode(minted.token));
    await store.insert(minted.token, {
        jti: minted.jti, familyId: minted.familyId, parentJti: null,
        username, issuedAt: claims.iat, expiresAt: claims.exp,
    });
    return minted;
}

/** Count `active` tokens in a family (the ≤1 invariant witness for P-015). */
async function activeCount(familyId) {
    const rows = await db.all("SELECT jti FROM auth_refresh_tokens WHERE family_id = ? AND state = 'active'", [familyId]);
    return rows.length;
}

function newService() {
    return new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: {}, refreshStore: store, userStore });
}

before(async function () {
    this.timeout(15000);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-refresh-'));
    db = new FuxaAuthDb({ dbFile: path.join(tmpDir, 'users.fuxap.db') });
    store = new RefreshTokenStore({ db });
    await store.ensureSchema();
});

after(async function () {
    if (db) await db.close();
});

beforeEach(() => { accountVersion = 0; accountExists = true; });

describe('Feature: auth-user-management — RefreshTokenStore (design/02 §6 · D-019/D-030)', () => {

    it('at-rest hashing is SHA-256 hex and matches constant-time (D-030)', () => {
        const h = RefreshTokenStore.hashToken('abc.def.ghi');
        assert.match(h, /^[0-9a-f]{64}$/, 'sha256 hex');
        assert.equal(RefreshTokenStore.hashesMatch('abc.def.ghi', h), true);
        assert.equal(RefreshTokenStore.hashesMatch('other', h), false);
        assert.equal(RefreshTokenStore.hashesMatch('abc.def.ghi', 'deadbeef'), false, 'length mismatch → false, no throw');
    });

    it('consumeAndRotate is single-use under a concurrent double-consume (CAS, D-030)', async () => {
        const svc = newService();
        const seed = await seedFamily(svc, 'alice', 0);
        // Two concurrent consumes of the SAME active jti — exactly one must win.
        const childA = svc.issueRefreshToken({ username: 'alice', tokenVersion: 0, familyId: seed.familyId });
        const childB = svc.issueRefreshToken({ username: 'alice', tokenVersion: 0, familyId: seed.familyId });
        const [ra, rb] = await Promise.all([
            store.consumeAndRotate(seed.jti, childA.token, { jti: childA.jti, familyId: seed.familyId, parentJti: seed.jti, username: 'alice', issuedAt: 1, expiresAt: 9999999999 }),
            store.consumeAndRotate(seed.jti, childB.token, { jti: childB.jti, familyId: seed.familyId, parentJti: seed.jti, username: 'alice', issuedAt: 1, expiresAt: 9999999999 }),
        ]);
        const wins = [ra.consumed, rb.consumed].filter(Boolean).length;
        assert.equal(wins, 1, 'exactly one consume wins the CAS');
        assert.equal(await activeCount(seed.familyId), 1, 'exactly one active child after the race');
    });

    it('revokeFamily transitions every family token to revoked', async () => {
        const svc = newService();
        const seed = await seedFamily(svc, 'alice', 0);
        assert.equal(await activeCount(seed.familyId), 1);
        await store.revokeFamily(seed.familyId);
        assert.equal(await activeCount(seed.familyId), 0);
    });
});

describe('Feature: auth-user-management — Token_Service.refresh (design/02 §6.2 · REQ-3)', () => {

    it('AC-3.2 happy path: a valid refresh rotates both tokens; parent becomes used, one active child', async () => {
        const svc = newService();
        const seed = await seedFamily(svc, 'alice', 0);
        const res = await svc.refresh(seed.token);
        assert.equal(res.kind, 'rotated');
        assert.ok(res.accessToken && res.refreshToken, 'both tokens issued');
        assert.notEqual(res.refreshToken, seed.token, 'refresh token rotated (differs)');
        // The new access token verifies (leans on P-007) and carries the live identity.
        const v = svc.verify(res.accessToken);
        assert.equal(v.authenticated, true);
        assert.equal(v.id, 'alice');
        assert.deepEqual(v.roles, ['admin']);
        // Parent consumed, exactly one active child.
        const parent = await store.getByJti(seed.jti);
        assert.equal(parent.state, 'used');
        assert.equal(await activeCount(seed.familyId), 1);
    });

    it('AC-3.3 reuse detection: replaying a consumed refresh token revokes the whole family (RFC 9700)', async () => {
        const svc = newService();
        const seed = await seedFamily(svc, 'alice', 0);
        const first = await svc.refresh(seed.token);
        assert.equal(first.kind, 'rotated');
        // Replay the ORIGINAL (now 'used') token → reuse detected, family revoked.
        const replay = await svc.refresh(seed.token);
        assert.equal(replay.kind, 'rejected');
        assert.equal(replay.reason, 'reuse_detected');
        assert.equal(await activeCount(seed.familyId), 0, 'family fully revoked after reuse');
        // The child that WAS active is now revoked too → using it fails.
        const afterChild = await svc.refresh(first.refreshToken);
        assert.equal(afterChild.kind, 'rejected');
        assert.equal(afterChild.reason, 'revoked');
    });

    it('missing token → rejected/missing', async () => {
        const svc = newService();
        assert.deepEqual(await svc.refresh(null), { kind: 'rejected', reason: 'missing' });
        assert.deepEqual(await svc.refresh(''), { kind: 'rejected', reason: 'missing' });
    });

    it('an access-type token presented to refresh → rejected/wrong_type', async () => {
        const svc = newService();
        const access = svc.issueAccessToken({ username: 'alice' });
        const res = await svc.refresh(access);
        assert.equal(res.reason, 'wrong_type');
    });

    it('expired refresh → rejected/expired', async () => {
        const svc = newService();
        const nowSec = Math.floor(Date.now() / 1000);
        const expired = jwt.sign({ id: 'alice', type: 'refresh', jti: 'x', family_id: 'f', tokenVersion: 0, iat: nowSec - 100, exp: nowSec - 10 }, SECRET, { algorithm: 'HS256' });
        assert.equal((await svc.refresh(expired)).reason, 'expired');
    });

    it('tampered/invalid signature → rejected/invalid', async () => {
        const svc = newService();
        const seed = await seedFamily(svc, 'alice', 0);
        assert.equal((await svc.refresh(tamperSignature(seed.token))).reason, 'invalid');
    });

    it('valid signature but no store row (unknown jti) → rejected/invalid', async () => {
        const svc = newService();
        // Mint a valid refresh token but DO NOT insert it into the store.
        const minted = svc.issueRefreshToken({ username: 'alice', tokenVersion: 0 });
        assert.equal((await svc.refresh(minted.token)).reason, 'invalid');
    });

    it('valid signature + known jti but hash mismatch → rejected/invalid + family revoked', async () => {
        const svc = newService();
        const seed = await seedFamily(svc, 'alice', 0);
        // A DIFFERENT validly-signed token reusing the same jti+family. A distinct `mark` claim makes
        // it byte-different from the seed (so its SHA-256 differs) even if signed in the same second.
        const forged = jwt.sign({ id: 'alice', type: 'refresh', jti: seed.jti, family_id: seed.familyId, tokenVersion: 0, mark: 'forged' }, SECRET, { algorithm: 'HS256', expiresIn: '7d' });
        const res = await svc.refresh(forged);
        assert.equal(res.reason, 'invalid');
        assert.equal(await activeCount(seed.familyId), 0, 'family revoked defensively on hash mismatch');
    });

    it('deleted account → rejected/unknown_user + family revoked (D-015 live check)', async () => {
        const svc = newService();
        const seed = await seedFamily(svc, 'alice', 0);
        accountExists = false; // simulate account deletion between issuance and refresh
        const res = await svc.refresh(seed.token);
        assert.equal(res.reason, 'unknown_user');
        assert.equal(await activeCount(seed.familyId), 0);
    });

    it('token below account tokenVersion → rejected/revoked + family revoked (D-027 active revocation)', async () => {
        const svc = newService();
        const seed = await seedFamily(svc, 'alice', 0); // token stamped tokenVersion 0
        accountVersion = 1;                              // account bumped ⇒ old token revoked
        const res = await svc.refresh(seed.token);
        assert.equal(res.reason, 'revoked');
        assert.equal(await activeCount(seed.familyId), 0);
    });

    // -------------------------------------------------------------------------
    // Task 5.8 — Property 15: refresh rotation is single-use with family reuse-detection
    // -------------------------------------------------------------------------
    it('Property 15: single-use rotation; ≤1 active per family; a reuse revokes the family (model-based, real crypto)', async function () {
        this.timeout(30000);
        // Run the STATE-MACHINE property against an IN-MEMORY sqlite DB. The logic (CAS single-use,
        // family revoke) is identical to the file-backed store, but removing per-transaction WAL fsync
        // makes 120 iterations reliably fast and free of disk-I/O timing flakiness (the file-backed
        // persistence path is covered by the deterministic integration tests above). Uses its own
        // connection/service so it does not perturb the shared file DB.
        const memDb = new FuxaAuthDb({ dbFile: ':memory:' });
        const memStore = new RefreshTokenStore({ db: memDb });
        await memStore.ensureSchema();
        const memService = new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: {}, refreshStore: memStore, userStore });

        const memActiveCount = async (familyId) => {
            const rows = await memDb.all("SELECT jti FROM auth_refresh_tokens WHERE family_id = ? AND state = 'active'", [familyId]);
            return rows.length;
        };
        const seedMemFamily = async () => {
            const minted = memService.issueRefreshToken({ username: 'alice', tokenVersion: 0 });
            const claims = /** @type {any} */ (jwt.decode(minted.token));
            await memStore.insert(minted.token, { jti: minted.jti, familyId: minted.familyId, parentJti: null, username: 'alice', issuedAt: claims.iat, expiresAt: claims.exp });
            return minted;
        };

        try {
            await fc.assert(
                fc.asyncProperty(
                    // A sequence of operations: true = rotate forward (use current), false = replay a past token.
                    fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
                    async (ops) => {
                        const seed = await seedMemFamily();
                        let current = seed.token;
                        const consumed = []; // tokens we have already rotated away from
                        let poisoned = false; // a reuse has revoked the family

                        for (const rotateForward of ops) {
                            // Invariant BEFORE each op: at most one active token in the family.
                            assert.ok((await memActiveCount(seed.familyId)) <= 1, '≤1 active per family (invariant)');

                            if (!poisoned && rotateForward) {
                                const r = await memService.refresh(current);
                                assert.equal(r.kind, 'rotated', 'active token rotates exactly once');
                                consumed.push(current);
                                current = r.refreshToken;
                                assert.equal(await memActiveCount(seed.familyId), 1, 'exactly one active child after rotate');
                            } else if (!poisoned && !rotateForward && consumed.length > 0) {
                                // Replay a previously-consumed token → reuse detection revokes the family.
                                const old = consumed[consumed.length - 1];
                                const r = await memService.refresh(old);
                                assert.equal(r.reason, 'reuse_detected', 'replay of a used token is detected');
                                assert.equal(await memActiveCount(seed.familyId), 0, 'family revoked on reuse');
                                poisoned = true;
                            } else if (poisoned) {
                                // After poisoning, NOTHING in the family can be rotated again.
                                const r = await memService.refresh(current);
                                assert.equal(r.kind, 'rejected', 'no rotate succeeds after family revoke');
                                assert.ok(['revoked', 'reuse_detected'].includes(r.reason), 'rejected as revoked/reuse');
                                assert.equal(await memActiveCount(seed.familyId), 0, 'family stays fully revoked');
                            }
                        }
                    }
                ),
                { numRuns: 120 }
            );
        } finally {
            await memDb.close();
        }
    });
});
