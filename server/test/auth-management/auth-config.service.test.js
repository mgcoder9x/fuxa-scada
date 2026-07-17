//@ts-check
'use strict';

/**
 * Feature: auth-user-management — runtime auth configuration (D-049, design/13-runtime-config.md).
 * Phase 1 (server): AuthConfigStore + AuthConfigService + live-apply seams.
 *
 * Covers the new correctness properties:
 *   - P-017 (hot-swap, non-retroactive): an applied change is observed by the NEXT operation without
 *     restart; already-issued artifacts are unaffected (old bcrypt hash still verifies after a cost
 *     change; an already-issued token keeps its TTL).
 *   - P-018 (atomic validation): an invalid patch is rejected whole — nothing persisted or applied.
 *   - P-019 (fail-safe load): a corrupt/absent persisted override loads as baseline/defaults; never throws.
 *
 * REAL sqlite (in-memory FuxaAuthDb) for the store; REAL services (Password_Hasher/BcryptHasherAdapter,
 * BruteForceGuard, TokenService, UserService) for the hot-swap integration; spy services for the pure
 * orchestration assertions. Toolchain (N-023/N-025): `node:assert/strict` + `fast-check@3` + real deps.
 */

const assert = require('node:assert/strict');
const fc = require('fast-check');
const jwt = require('jsonwebtoken');

const { FuxaAuthDb } = require('../../auth-management/store/fuxa-auth-db');
const { AuthConfigStore } = require('../../auth-management/store/auth-config-store');
const { AuthConfigService } = require('../../auth-management/services/auth-config.service');
const { BruteForceGuard } = require('../../auth-management/services/brute-force');
const { TokenService } = require('../../auth-management/services/token.service');
const { Password_Hasher } = require('../../auth-management/services/password-hasher');
const { BcryptHasherAdapter } = require('../../auth-management/adapters/fuxa-bcrypt.adapter');
const { UserService } = require('../../auth-management/services/user.service');

const BASELINE = { auth: { passwordMinLength: 12, bcryptCost: 12, bruteForce: { threshold: 5, baseThrottleMs: 30000 } }, tokenExpiresIn: '1h', refreshTokenExpiresIn: '7d' };

/** @type {FuxaAuthDb} */ let db;
/** @type {AuthConfigStore} */ let store;

function spyServices() {
    const calls = { setCost: [], bruteForce: [], userPolicy: [], acctPolicy: [], token: [] };
    return {
        calls,
        tokenService: { reconfigure: (p) => calls.token.push(p) },
        bruteForceGuard: { reconfigure: (c) => calls.bruteForce.push(c) },
        passwordHasher: { setCost: (n) => calls.setCost.push(n) },
        userService: { setPasswordPolicy: (p) => calls.userPolicy.push(p) },
        accountService: { setPasswordPolicy: (p) => calls.acctPolicy.push(p) },
    };
}

function makeService(services, baseline = BASELINE) {
    return new AuthConfigService({ store, baseline, auditLogger: { record: () => {} }, services });
}

before(async function () {
    this.timeout(15000);
    db = new FuxaAuthDb({ dbFile: ':memory:' });
    store = new AuthConfigStore({ db });
    await store.ensureSchema();
});
after(async function () { if (db) await db.close(); });
beforeEach(async function () { await store.clear(); });

describe('AuthConfigService.validate (P-018 matrix)', function () {
    const svc = () => makeService(spyServices());
    it('accepts a well-formed full patch', function () {
        const r = svc().validate({ passwordMinLength: 16, passwordBlocklist: ['abc'], bcryptCost: 11, tokenExpiresIn: '30m', refreshTokenExpiresIn: 3600, bruteForce: { threshold: 3, baseThrottleMs: 1000, backoffFactor: 2, maxThrottleMs: 60000, failureWindowMs: 0 } });
        assert.equal(r.ok, true, r.errors.join('; '));
    });
    it('rejects passwordMinLength out of [8,128]', function () {
        assert.equal(svc().validate({ passwordMinLength: 7 }).ok, false);
        assert.equal(svc().validate({ passwordMinLength: 129 }).ok, false);
        assert.equal(svc().validate({ passwordMinLength: 12.5 }).ok, false);
    });
    it('rejects bcryptCost out of [10,15]', function () {
        assert.equal(svc().validate({ bcryptCost: 9 }).ok, false);
        assert.equal(svc().validate({ bcryptCost: 16 }).ok, false);
    });
    it('rejects bad durations and accepts valid ones', function () {
        assert.equal(svc().validate({ tokenExpiresIn: 0 }).ok, false);
        assert.equal(svc().validate({ tokenExpiresIn: -5 }).ok, false);
        assert.equal(svc().validate({ tokenExpiresIn: 'soon' }).ok, false);
        assert.equal(svc().validate({ tokenExpiresIn: '1h' }).ok, true);
        assert.equal(svc().validate({ tokenExpiresIn: 900 }).ok, true);
        assert.equal(svc().validate({ refreshTokenExpiresIn: '7d' }).ok, true);
    });
    it('rejects unknown fields and bad bruteForce', function () {
        assert.equal(svc().validate({ nope: 1 }).ok, false);
        assert.equal(svc().validate({ bruteForce: { threshold: -1 } }).ok, false);
        assert.equal(svc().validate({ bruteForce: { backoffFactor: 0.5 } }).ok, false);
        assert.equal(svc().validate({ bruteForce: { bogus: 1 } }).ok, false);
        assert.equal(svc().validate('nope').ok, false);
    });
    it('P-018 property: any passwordMinLength outside [8,128] is rejected', function () {
        fc.assert(fc.property(fc.integer(), (n) => {
            const inRange = Number.isInteger(n) && n >= 8 && n <= 128;
            return svc().validate({ passwordMinLength: n }).ok === inRange;
        }), { numRuns: 200 });
    });
});

describe('AuthConfigService merge/precedence + persistence', function () {
    it('no override ⇒ effective = baseline (layered over defaults)', async function () {
        const eff = await makeService(spyServices()).getEffective();
        assert.equal(eff.passwordMinLength, 12);
        assert.equal(eff.bcryptCost, 12);
        assert.equal(eff.bruteForce.threshold, 5);
        assert.equal(eff.bruteForce.backoffFactor, 2); // from defaults (baseline omitted it)
        assert.equal(eff.tokenExpiresIn, '1h');
    });
    it('override wins per-field; bruteForce merges per-key; partial applies accumulate', async function () {
        const s = makeService(spyServices());
        await s.apply({ passwordMinLength: 20 });
        await s.apply({ bruteForce: { threshold: 9 } });
        const eff = await s.getEffective();
        assert.equal(eff.passwordMinLength, 20);       // first override retained
        assert.equal(eff.bruteForce.threshold, 9);     // second override
        assert.equal(eff.bruteForce.baseThrottleMs, 30000); // baseline kept (not clobbered)
    });
    it('invalid apply persists nothing and applies nothing (P-018)', async function () {
        const services = spyServices();
        const s = makeService(services);
        const r = await s.apply({ bcryptCost: 99 });
        assert.equal(r.kind, 'invalid');
        assert.equal((await store.get()), null);       // nothing persisted
        assert.equal(services.calls.setCost.length, 0); // nothing applied
    });
    it('resetToDefaults drops the override', async function () {
        const s = makeService(spyServices());
        await s.apply({ passwordMinLength: 30 });
        await s.resetToDefaults('admin');
        const eff = await s.getEffective();
        assert.equal(eff.passwordMinLength, 12);
    });
});

describe('AuthConfigService fail-safe load (P-019)', function () {
    it('corrupt persisted blob ⇒ effective falls back to baseline; init never throws', async function () {
        await db.run('INSERT OR REPLACE INTO auth_config (id, config, version, updated_at) VALUES (1, ?, 1, 0)', ['not-json{']);
        const services = spyServices();
        const s = makeService(services);
        const eff = await s.init(); // must not throw
        assert.equal(eff.passwordMinLength, 12);
        assert.equal(services.calls.setCost[0], 12); // applied baseline safely
    });
    it('P-019 property: arbitrary blob never throws and yields a defined effective config', async function () {
        await fc.assert(fc.asyncProperty(fc.string(), async (blob) => {
            await db.run('INSERT OR REPLACE INTO auth_config (id, config, version, updated_at) VALUES (1, ?, 1, 0)', [blob]);
            const eff = await makeService(spyServices()).getEffective();
            return typeof eff === 'object' && typeof eff.passwordMinLength === 'number';
        }), { numRuns: 100 });
        await store.clear();
    });
});

describe('AuthConfigService live-apply pushes effective to services', function () {
    it('apply calls every service seam with the effective values', async function () {
        const services = spyServices();
        const s = makeService(services);
        await s.apply({ bcryptCost: 11, passwordMinLength: 16, bruteForce: { threshold: 2 }, tokenExpiresIn: '15m' });
        assert.equal(services.calls.setCost.at(-1), 11);
        assert.equal(services.calls.bruteForce.at(-1).threshold, 2);
        assert.equal(services.calls.userPolicy.at(-1).minLength, 16);
        assert.equal(services.calls.acctPolicy.at(-1).minLength, 16);
        assert.equal(services.calls.token.at(-1).tokenExpiresIn, '15m');
    });
});

describe('P-017 hot-swap on REAL services (non-retroactive)', function () {
    it('bcryptCost change affects new hashes only; old hash still verifies', async function () {
        this.timeout(20000);
        const adapter = new BcryptHasherAdapter({ cost: 10 });
        const hasher = new Password_Hasher(adapter);
        const oldHash = hasher.hash('correct horse battery');   // cost 10
        assert.equal(oldHash.slice(0, 7), '$2a$10$');
        const services = spyServices();
        services.passwordHasher = hasher; // real hasher
        const s = makeService(services);
        await s.apply({ bcryptCost: 12 });
        const newHash = hasher.hash('another password here');    // cost 12 now
        assert.equal(newHash.slice(0, 7), '$2a$12$');
        assert.equal(hasher.verify('correct horse battery', oldHash), true); // non-retroactive
    });

    it('bruteForce.threshold change takes effect on the next checkAllowed', function () {
        const guard = new BruteForceGuard({ threshold: 5 });
        const services = spyServices();
        services.bruteForceGuard = guard;
        const s = makeService(services);
        // synchronous apply of the reconfigure (validate+reconfigure are sync paths; store IO awaited)
        return s.apply({ bruteForce: { threshold: 0 } }).then(() => {
            // threshold 0 ⇒ fail-closed: every checkAllowed blocked immediately (AC-15.3)
            assert.equal(guard.checkAllowed('x').allowed, false);
        });
    });

    it('tokenExpiresIn change affects newly-issued tokens only', async function () {
        const SECRET = 'hotswap-secret-0123456789';
        const adapter = { sign: (p, o) => jwt.sign(p, SECRET, o), verify: (t, o) => jwt.verify(t, SECRET, o), decode: (t) => jwt.decode(t) };
        const ts = new TokenService({ tokenAdapter: adapter, settings: { tokenExpiresIn: '1h' } });
        const before = jwt.decode(ts.issueAccessToken({ username: 'a' }));
        const ttlBefore = before.exp - before.iat;
        assert.equal(ttlBefore, 3600);
        const services = spyServices();
        services.tokenService = ts;
        await makeService(services).apply({ tokenExpiresIn: 900 });
        const after = jwt.decode(ts.issueAccessToken({ username: 'a' }));
        assert.equal(after.exp - after.iat, 900); // next token reflects the new TTL
    });
});
