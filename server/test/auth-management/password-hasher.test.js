//@ts-check
'use strict';

/**
 * Tests for the Password_Hasher service — design/03-password-security.md (REQ-4, D-008/D-017).
 * Task 3.3 (P-001), 3.4 (P-002 over the ≤72-byte domain), 3.5 (edges + FUXA cost-10 interop).
 *
 * Toolchain (N-023/N-025): `node:assert/strict` + `fast-check@3` + the real `BcryptHasherAdapter`
 * (the sole bcryptjs importer). Property tests construct the Hash seam at bcrypt's MINIMUM cost 4 so
 * ≥100 iterations stay fast; the properties are cost-independent (cost is embedded in each digest).
 */

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { BcryptHasherAdapter } = require('../../auth-management/adapters/fuxa-bcrypt.adapter');
const { Password_Hasher } = require('../../auth-management/services/password-hasher');

// Hash seam at cost 4 for fast property runs (§8.2).
const hasher = new Password_Hasher(new BcryptHasherAdapter({ cost: 4 }));

const utf8Bytes = (s) => Buffer.byteLength(s, 'utf8');

// --- generators (§8.1) -------------------------------------------------------
// P-001 pool: arbitrary ASCII, full Unicode, a "long within/around the bound" ASCII, and the empty
// string. No byte bound needed — hash is total and P-001 holds for any string (same truncation on
// both hash and verify).
const passwordArb = fc.oneof(
    fc.string(),
    fc.fullUnicodeString(),
    fc.string({ minLength: 60, maxLength: 72 }),
    fc.constant('')
);

// Accepted-domain pair generator for P-002: two DISTINCT passwords, both strictly ≤ 72 UTF-8 bytes
// (AC-4.6 — passwords beyond 72 bytes are rejected at validation and are OUTSIDE P-002's domain).
// Built BY CONSTRUCTION (no rejection `.filter`s, which made fast-check resample pathologically) so
// distinctness and the byte bound always hold: a base ≤ ~40 bytes plus a ≥1-char mutation stays well
// under 72 bytes, and the partner is derived to always differ from the base. Covers near-duplicates
// (drop-last / single-char append) and farther-apart pairs (prepend / multi-char append).
const baseArb = fc.oneof(
    fc.string({ maxLength: 40 }),            // printable ASCII ⇒ ≤ 40 bytes
    fc.fullUnicodeString({ maxLength: 9 })   // up to 4 bytes/char ⇒ ≤ 36 bytes
);
const distinctBoundedPair = fc.record({
    a: baseArb,
    suffix: fc.string({ minLength: 1, maxLength: 8 }), // ≥1 printable ASCII char ⇒ ≤ 8 bytes
    mode: fc.integer({ min: 0, max: 2 }),
}).map(({ a, suffix, mode }) => {
    let b;
    if (mode === 0) {
        b = a + suffix;               // append (near-dup when suffix is 1 char; farther otherwise)
    } else if (mode === 1 && a.length > 0) {
        // Drop the last CODE POINT (not code unit) so we never split an astral surrogate pair into a
        // lone surrogate — malformed UTF-16 is a separate, explicitly-tested concern (D-025/N-027).
        b = [...a].slice(0, -1).join('');  // near-duplicate, still well-formed
    } else {
        b = suffix + a;               // prepend
    }
    if (b === a) {
        b = a + 'x';                  // guarantee distinctness in the degenerate case
    }
    return [a, b];
});

describe('Feature: auth-user-management — Password_Hasher (design/03 · REQ-4, P-001/P-002)', () => {

    // -------------------------------------------------------------------------
    // Task 3.3 — Property 1 (P-001): a hash verifies its own plaintext
    // -------------------------------------------------------------------------
    it('Property 1: Password hash verifies its own plaintext; two hashes each verify and differ', function () {
        this.timeout(30000);
        fc.assert(fc.property(passwordArb, (p) => {
            const h1 = hasher.hash(p);
            const h2 = hasher.hash(p);
            // both independently-salted digests verify the plaintext …
            if (!hasher.verify(p, h1)) return false;
            if (!hasher.verify(p, h2)) return false;
            // … and differ (the per-hash random-salt witness required by AC-4.3).
            return h1 !== h2;
        }), { numRuns: 150 });
    });

    // -------------------------------------------------------------------------
    // Task 3.4 — Property 2 (P-002): a hash rejects a different plaintext (≤72-byte domain)
    // -------------------------------------------------------------------------
    it('Property 2: Password hash rejects a different plaintext (over the ≤72-byte accepted domain)', function () {
        this.timeout(30000);
        fc.assert(fc.property(distinctBoundedPair, ([a, b]) => {
            // Domain guard (construction guarantees it): both members are within the ≤72-byte accepted
            // domain, so they cannot collide under bcrypt truncation (>72-byte inputs are excluded —
            // they are rejected at validation, AC-4.6, and are outside P-002's domain, D-017).
            if (utf8Bytes(a) > 72 || utf8Bytes(b) > 72) {
                return true;
            }
            // a ≠ b within the accepted domain ⇒ a hash of A must NOT verify B (AC-4.5 / D-017).
            return hasher.verify(b, hasher.hash(a)) === false;
        }), { numRuns: 150 });
    });

    // -------------------------------------------------------------------------
    // Task 3.5 — edge / defensive / interop
    // -------------------------------------------------------------------------
    it('empty-string plaintext hashes and verifies (P-001 base case); a non-empty plaintext does not', () => {
        const h = hasher.hash('');
        assert.equal(hasher.verify('', h), true);
        assert.equal(hasher.verify('nonempty', h), false);
    });

    it('verify is defensive: returns false (never throws) for null/empty/malformed hash and non-string plaintext', () => {
        const valid = hasher.hash('some-password');
        // malformed / empty / null hash → false, no throw
        assert.equal(hasher.verify('some-password', /** @type {any} */(null)), false);
        assert.equal(hasher.verify('some-password', ''), false);
        assert.equal(hasher.verify('some-password', 'not-a-bcrypt-hash'), false);
        assert.equal(hasher.verify('some-password', '$2a$04$too-short'), false);
        // non-string plaintext → false, no throw
        assert.equal(hasher.verify(/** @type {any} */(null), valid), false);
        assert.equal(hasher.verify(/** @type {any} */(undefined), valid), false);
        assert.equal(hasher.verify(/** @type {any} */(123), valid), false);
        // sanity: the valid pairing still verifies
        assert.equal(hasher.verify('some-password', valid), true);
    });

    it('malformed UTF-16 (lone surrogate) is rejected CHEAPLY — verify→false fast, hash→throws (D-025/N-027)', () => {
        // A lone surrogate makes bcryptjs burn ~9.6s then throw RangeError. It can arrive over the API
        // via JSON.parse('{"password":"\\uD83D"}'); with the DV-006 dummy-hash path that is an
        // unauthenticated CPU-DoS. The Password_Hasher guard must neutralize it at negligible cost.
        const validHash = hasher.hash('legit-password');
        const loneHi = 'abc' + String.fromCharCode(0xD83D);  // unpaired high surrogate
        const loneLo = String.fromCharCode(0xDC00) + 'xyz';  // unpaired low surrogate
        const viaJson = JSON.parse('"\\uD83D"');             // exactly how it would arrive over HTTP

        const t = Date.now();
        assert.equal(hasher.verify(loneHi, validHash), false);
        assert.equal(hasher.verify(loneLo, validHash), false);
        assert.equal(hasher.verify(viaJson, validHash), false);
        const elapsed = Date.now() - t;
        // Without the guard each verify is ~9.6s; with it, all three are effectively instant.
        assert.ok(elapsed < 1000, `verify must be fast for malformed input (was ${elapsed}ms) — no bcrypt DoS`);

        // hash fails fast with a defined error instead of hanging ~9.6s.
        assert.throws(() => hasher.hash(loneHi), (e) => /** @type {any} */(e).code === 'invalid_password_encoding');
    });

    it('interoperability: a digest produced at FUXA\'s cost 10 still verifies (cost read from the digest)', () => {
        const h10 = new BcryptHasherAdapter({ cost: 10 }).hashSync('interop-pw');
        assert.equal(h10.split('$')[2], '10', 'digest carries cost 10');
        assert.equal(hasher.verify('interop-pw', h10), true, 'cost-4 hasher verifies a cost-10 digest');
        assert.equal(hasher.verify('wrong-pw', h10), false);
    });

    it('the unconfigured Hash seam produces the secure default cost 12 (D-008)', function () {
        this.timeout(10000);
        const def = new BcryptHasherAdapter(); // no cost → default 12
        const digest = def.hashSync('x');
        assert.equal(digest.split('$')[2], '12', 'default work factor is 12');
    });
});
