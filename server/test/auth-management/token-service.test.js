//@ts-check
'use strict';

/**
 * Feature: auth-user-management — Token_Service (design/02 · REQ-2). Tasks 5.2 (issue/verify +
 * expiry policy) and 5.6 (D-021/D-027/D-028/D-029 hardening). Owns P-007 and P-008.
 *
 * REAL CRYPTO. Unlike the earlier shim sanity of the adapter (5.1), these tests exercise the actual
 * `jsonwebtoken` HS256 sign/verify round-trip through an injected seam, closing the N-022 "real JWT
 * cryptographic round-trip pending" gap. The seam stand-in is faithful: it is literally
 * `jwt.sign/verify(payload, SECRET, options)` — the same calls the production `TokenAdapter` makes,
 * but with a test-controlled secret so P-007's wrong-secret quadrant is drivable.
 *
 * Toolchain (N-023/N-025): `node:assert/strict` + `fast-check@3` + real `jsonwebtoken`. No FUXA
 * `runtime` init is required (the seam is pure crypto over an injected secret).
 */

const assert = require('node:assert/strict');
const fc = require('fast-check');
const jwt = require('jsonwebtoken');

const { TokenService } = require('../../auth-management/services/token.service');

const SECRET = 'test-secret-configured-0123456789';
const OTHER_SECRET = 'test-secret-OTHER-9876543210';

/** A faithful seam stand-in over real `jsonwebtoken`, keyed on a chosen secret. */
function makeAdapter(secret) {
    return {
        sign: (payload, options) => jwt.sign(payload, secret, options),
        verify: (token, options) => jwt.verify(token, secret, options),
        decode: (token) => jwt.decode(token),
    };
}

/** Corrupt the signature segment so the token fails verification (deterministic tamper). */
function tamperSignature(token) {
    const parts = token.split('.');
    const sig = parts[2] || '';
    const first = sig.charAt(0);
    const replacement = first === 'A' ? 'B' : 'A';
    parts[2] = replacement + sig.slice(1);
    return parts.join('.');
}

// --- generators --------------------------------------------------------------
const identityArb = fc.record({
    username: fc.string({ minLength: 1 }),
    groups: fc.oneof(fc.integer(), fc.array(fc.integer(), { maxLength: 4 })),
    roles: fc.array(fc.string(), { maxLength: 6 }),
    tokenVersion: fc.nat({ max: 1000 }),
});

describe('Feature: auth-user-management — Token_Service (design/02 · REQ-2)', () => {

    // -------------------------------------------------------------------------
    // Task 5.3 — Property 7: authenticated ⟺ signature valid ∧ unexpired
    // -------------------------------------------------------------------------
    it('Property 7: a token is authenticated iff its signature is valid and it is unexpired (real HS256, 4 quadrants)', () => {
        const service = new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: {} });
        fc.assert(
            fc.property(
                identityArb,
                fc.integer({ min: -100000, max: 100000 }).filter((o) => Math.abs(o) > 5), // avoid the ~0 boundary (timing)
                fc.boolean(), // tamper
                fc.boolean(), // wrongSecret
                (identity, expiryOffset, tamper, wrongSecret) => {
                    const nowSec = Math.floor(Date.now() / 1000);
                    // Control `exp` directly (no expiresIn option) so past/future is deterministic.
                    const payload = {
                        id: identity.username,
                        sub: identity.username,
                        groups: identity.groups,
                        roles: identity.roles,
                        tokenVersion: identity.tokenVersion,
                        type: 'access',
                        jti: 'fixed-jti',
                        iat: nowSec,
                        exp: nowSec + expiryOffset,
                    };
                    const secret = wrongSecret ? OTHER_SECRET : SECRET;
                    let token = jwt.sign(payload, secret, { algorithm: 'HS256' });
                    if (tamper) token = tamperSignature(token);

                    const res = service.verify(token);
                    const sigValid = !tamper && !wrongSecret;
                    const unexpired = expiryOffset > 0;
                    const expected = sigValid && unexpired;
                    assert.equal(res.authenticated, expected,
                        `sigValid=${sigValid} unexpired=${unexpired} offset=${expiryOffset}`);
                    if (expected) {
                        assert.equal(res.id, identity.username, 'id exposed = issuance');
                        assert.deepEqual(res.roles, identity.roles, 'roles exposed = issuance');
                        assert.equal(res.tokenVersion, identity.tokenVersion, 'tokenVersion exposed = issuance');
                    }
                }
            ),
            { numRuns: 200 }
        );
    });

    // -------------------------------------------------------------------------
    // Task 5.4 — Property 8: unconfigured ⇒ finite 1h; non-expiry is dev-only
    // -------------------------------------------------------------------------
    it('Property 8: unconfigured deployments issue finite 1-hour tokens; non-expiry is dev-only', () => {
        fc.assert(
            fc.property(
                identityArb,
                fc.option(fc.integer({ min: 1, max: 86400 }), { nil: undefined }), // configuredExpiry
                fc.boolean(), // devNonExpiringTokens
                fc.boolean(), // production
                (identity, configuredExpiry, devNonExpiring, production) => {
                    const service = new TokenService({
                        tokenAdapter: makeAdapter(SECRET),
                        settings: { tokenExpiresIn: configuredExpiry, devNonExpiringTokens: devNonExpiring, production },
                    });
                    const decoded = /** @type {any} */ (jwt.decode(service.issueAccessToken(identity)));
                    const devMode = devNonExpiring === true && production !== true;

                    if (configuredExpiry) {
                        assert.notEqual(decoded.exp, undefined, 'configured ⇒ has exp');
                        assert.equal(decoded.exp - decoded.iat, configuredExpiry, 'Row 1 (AC-2.6): exact configured TTL');
                    } else if (devMode) {
                        assert.equal(decoded.exp, undefined, 'Row 3 (AC-2.8): dev-only ⇒ no exp');
                    } else {
                        assert.equal(decoded.exp - decoded.iat, 3600, 'Row 2 (AC-2.7/P-008): finite 1h default');
                    }
                    // Safety invariants (§4.1): non-expiry is NEVER the default, and the dev flag is
                    // ignored in production.
                    if (devNonExpiring !== true) {
                        assert.notEqual(decoded.exp, undefined, 'flag off ⇒ never a missing exp');
                    }
                    if (production === true && devNonExpiring === true && !configuredExpiry) {
                        assert.equal(decoded.exp - decoded.iat, 3600, 'production ignores the dev flag ⇒ finite 1h');
                    }
                }
            ),
            { numRuns: 200 }
        );
    });

    // -------------------------------------------------------------------------
    // Task 5.6 — hardened claim set (D-021/D-027/D-028) — example assertions
    // -------------------------------------------------------------------------
    it('issueAccessToken stamps the hardened claim set: type=access, sub, jti, tokenVersion, roles (D-021/D-027/D-028)', () => {
        const service = new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: {} });
        const token = service.issueAccessToken({ username: 'alice', groups: -1, roles: ['admin'], tokenVersion: 3 });
        const decoded = /** @type {any} */ (jwt.decode(token));
        assert.equal(decoded.type, 'access', 'single `type` claim (D-028), not `typ`');
        assert.equal(decoded.typ, undefined, 'no parallel `typ` payload claim (D-028)');
        assert.equal(decoded.id, 'alice');
        assert.equal(decoded.sub, 'alice');
        assert.equal(decoded.tokenVersion, 3);
        assert.deepEqual(decoded.roles, ['admin']);
        assert.equal(typeof decoded.jti, 'string');
        assert.ok(decoded.jti.length > 0, 'jti present for audit correlation');
    });

    it('issueAccessToken defaults tokenVersion to 0 and roles to [] when absent (D-027)', () => {
        const service = new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: {} });
        const decoded = /** @type {any} */ (jwt.decode(service.issueAccessToken({ username: 'bob' })));
        assert.equal(decoded.tokenVersion, 0);
        assert.deepEqual(decoded.roles, []);
    });

    it('emits a `kid` header naming the single active key when configured (TO-012, Option A)', () => {
        const service = new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: { kid: 'key-2026' } });
        const token = service.issueAccessToken({ username: 'alice' });
        const header = /** @type {any} */ (jwt.decode(token, { complete: true })).header;
        assert.equal(header.kid, 'key-2026');
    });

    // -------------------------------------------------------------------------
    // Task 5.6 — algorithm pinning (D-021): reject alg:none / alg-confusion
    // -------------------------------------------------------------------------
    it('rejects a token signed with alg:none (algorithm pinning, D-021)', () => {
        const service = new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: {} });
        // Craft an unsigned alg:none token; a pinned HS256 verify MUST reject it.
        const noneToken = jwt.sign({ id: 'attacker', type: 'access' }, '', { algorithm: 'none' });
        const res = service.verify(noneToken);
        assert.equal(res.authenticated, false);
        assert.equal(res.reason, 'bad_signature');
    });

    // -------------------------------------------------------------------------
    // Task 5.6 — verify reason mapping (P-007 support) + type discriminator (D-028)
    // -------------------------------------------------------------------------
    it('verify maps missing/expired/bad_signature/wrong_type correctly', () => {
        const service = new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: {} });
        assert.deepEqual(service.verify(''), { authenticated: false, reason: 'missing' });
        assert.deepEqual(service.verify(null), { authenticated: false, reason: 'missing' });

        const nowSec = Math.floor(Date.now() / 1000);
        const expired = jwt.sign({ id: 'a', type: 'access', iat: nowSec - 100, exp: nowSec - 10 }, SECRET, { algorithm: 'HS256' });
        assert.equal(service.verify(expired).reason, 'expired');

        const valid = service.issueAccessToken({ username: 'a' });
        assert.equal(service.verify(tamperSignature(valid)).reason, 'bad_signature');

        // A refresh-type token presented to the access verify path → wrong_type (D-028).
        const refresh = jwt.sign({ id: 'a', type: 'refresh' }, SECRET, { algorithm: 'HS256', expiresIn: 3600 });
        assert.equal(service.verify(refresh).reason, 'wrong_type');
    });

    // -------------------------------------------------------------------------
    // Task 5.6 — iss/aud validated ONLY when configured (D-029)
    // -------------------------------------------------------------------------
    it('validates iss/aud only when configured; unconfigured deployment does not self-reject (D-029)', () => {
        // Configured: issued + validated. A token minted for a different audience is rejected.
        const configured = new TokenService({
            tokenAdapter: makeAdapter(SECRET),
            settings: { jwtIssuer: 'fuxa-auth', jwtAudience: 'fuxa-clients' },
        });
        const good = configured.issueAccessToken({ username: 'alice' });
        const goodRes = configured.verify(good);
        assert.equal(goodRes.authenticated, true, 'correct iss/aud verifies');
        const decoded = /** @type {any} */ (jwt.decode(good));
        assert.equal(decoded.iss, 'fuxa-auth');
        assert.equal(decoded.aud, 'fuxa-clients');

        const wrongAud = jwt.sign({ id: 'x', type: 'access' }, SECRET, { algorithm: 'HS256', issuer: 'fuxa-auth', audience: 'someone-else', expiresIn: 3600 });
        assert.equal(configured.verify(wrongAud).authenticated, false, 'wrong aud rejected');

        // Unconfigured: no iss/aud issued, and a plain token still verifies (no self-reject).
        const unconfigured = new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: {} });
        const plain = unconfigured.issueAccessToken({ username: 'bob' });
        const plainDecoded = /** @type {any} */ (jwt.decode(plain));
        assert.equal(plainDecoded.iss, undefined, 'no iss issued when unset');
        assert.equal(plainDecoded.aud, undefined, 'no aud issued when unset');
        assert.equal(unconfigured.verify(plain).authenticated, true, 'unconfigured deployment verifies its own tokens');
    });

    // -------------------------------------------------------------------------
    // Task 5.7 boundary — refresh() is an honest not_implemented stub (not faked)
    // -------------------------------------------------------------------------
    it('refresh() requires refreshStore + userStore to be injected (fails loud, never silently)', async () => {
        const service = new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: {} });
        await assert.rejects(() => service.refresh('any'), /requires refreshStore \+ userStore/);
    });

    it('issueRefreshToken mints a FUXA-compatible refresh token with rotation ids (type=refresh, jti, family_id)', () => {
        const service = new TokenService({ tokenAdapter: makeAdapter(SECRET), settings: {} });
        const { token, jti, familyId } = service.issueRefreshToken({ username: 'alice', tokenVersion: 2 });
        const decoded = /** @type {any} */ (jwt.decode(token));
        assert.equal(decoded.type, 'refresh');
        assert.equal(decoded.id, 'alice');
        assert.equal(decoded.jti, jti);
        assert.equal(decoded.family_id, familyId);
        assert.equal(decoded.tokenVersion, 2);
        assert.notEqual(decoded.exp, undefined, 'refresh token has a finite TTL');
    });
});
