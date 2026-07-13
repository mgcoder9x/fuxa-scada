'use strict';

/**
 * Feature: auth-user-management — serialization module (design/06 §4, §8).
 *
 * Property 5 (P-005): metadata serialize→deserialize is a structural identity over the JSON-safe
 * domain (AC-13.3). This is the single, pure home of the string<->object round-trip that the
 * User_Store / Role_Store adapters rely on, so it is verified in isolation first (bottom-up).
 *
 * Toolchain per decision N-023: Node's built-in `node:assert` (chai@5 is ESM-only) + `fast-check`
 * for the property. No production code is touched by this test.
 *
 * JSON-safe domain and exclusions are taken verbatim from design/06 §4.2:
 *   included : strings (arbitrary Unicode), finite numbers, booleans, null, arrays, nested plain
 *              objects to arbitrary depth (incl. empty {} / []).
 *   excluded : undefined, functions, NaN, ±Infinity, -0, Date  (JSON asymmetries).
 *   generator constraint (§3.2/§9): a metadata object carries no TOP-LEVEL `roles` key (reserved
 *              by the info<->{roles,metadata} mapping); nested `roles` keys are allowed.
 *   also excluded from keys: `__proto__` — JSON.parse creates it as an OWN property whereas
 *              object construction via assignment would set the prototype, an asymmetry that is a
 *              JS/JSON footgun, not a serialization defect. Excluding it keeps P-005 a true identity.
 */

const assert = require('node:assert');
const fc = require('fast-check');

const { serialize, deserialize, SerializationError } = require('../../auth-management/store/serialization');

/** A finite JSON-safe number, excluding -0 (JSON.stringify(-0) === '0'). */
const jsonSafeNumber = fc
    .oneof(
        fc.integer(),
        fc.double({ noNaN: true, noDefaultInfinity: true })
    )
    .filter((n) => Number.isFinite(n) && !Object.is(n, -0));

/** Keys: any string except the `__proto__` footgun (see header). */
const safeKey = fc.string().filter((k) => k !== '__proto__');

/** A recursive JSON-safe value: leaf | array | plain object, to bounded depth. */
const jsonSafeValue = fc.letrec((tie) => ({
    leaf: fc.oneof(fc.string(), fc.boolean(), fc.constant(null), jsonSafeNumber),
    node: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        tie('leaf'),
        fc.array(tie('node'), { maxLength: 6 }),
        fc.dictionary(safeKey, tie('node'), { maxKeys: 6 })
    ),
})).node;

/** A metadata object: a plain object whose TOP-LEVEL keys exclude the reserved `roles`. */
const metadataObject = fc.dictionary(
    safeKey.filter((k) => k !== 'roles'),
    jsonSafeValue,
    { maxKeys: 8 }
);

describe('Feature: auth-user-management — serialization (design/06 §4)', () => {
    describe('Property 5: metadata serialize→deserialize is a structural identity (P-005, AC-13.3)', () => {
        it('round-trips any JSON-safe metadata object under deep structural equality (>=100 iters)', () => {
            fc.assert(
                fc.property(metadataObject, (m) => {
                    const encoded = serialize(m);
                    assert.strictEqual(typeof encoded, 'string', 'serialize must return a string');
                    const result = deserialize(encoded);
                    assert.strictEqual(result.ok, true, 'deserialize of a well-formed string must be ok');
                    assert.deepStrictEqual(result.value, m, 'round-trip must be a structural identity');
                }),
                { numRuns: 200 }
            );
        });
    });

    describe('serialize contract (design/06 §4.1)', () => {
        it('encodes undefined as the empty-info default "{}"', () => {
            assert.strictEqual(serialize(undefined), '{}');
        });

        it('throws SerializationError only on a structurally non-encodable input (cyclic ref)', () => {
            const cyclic = {};
            cyclic.self = cyclic;
            assert.throws(() => serialize(cyclic), SerializationError);
        });
    });

    describe('deserialize resilience (design/06 §4.1, AC-13.4)', () => {
        it('treats null / undefined / empty string as "no stored info" → {ok:true, value:{}}', () => {
            for (const empty of [null, undefined, '']) {
                assert.deepStrictEqual(deserialize(empty), { ok: true, value: {} });
            }
        });

        it('never throws on a malformed string — returns a descriptive invalid_metadata result', () => {
            const bad = '{not valid json';
            const r = deserialize(bad);
            assert.strictEqual(r.ok, false);
            assert.strictEqual(r.error, 'invalid_metadata');
            assert.strictEqual(typeof r.detail, 'string');
            assert.strictEqual(r.raw, bad);
        });
    });
});
