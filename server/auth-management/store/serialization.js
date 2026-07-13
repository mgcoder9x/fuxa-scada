//@ts-check
'use strict';

/**
 * Shared serialization module — the single home of the string <-> object translation and the
 * resilient per-record parse used by both FUXA store adapters (design/06-persistence-and-
 * serialization.md §4). It is PURE: no I/O, no clock, no ambient state, which is what makes the
 * metadata round-trip a clean property (P-005, owned by design/06 §8).
 *
 * Contract (design/06 §4.1):
 *   serialize(obj)   -> JSON string. Deterministic JSON encoding of a JSON-safe object.
 *                       Throws SerializationError ONLY on a structurally non-encodable input
 *                       (e.g. a cyclic reference) — a programming error guarded before persist.
 *                       `undefined` input encodes to "{}" (the empty-info default).
 *   deserialize(str) -> ParseResult. JSON.parse wrapped so a malformed string yields a DESCRIPTIVE
 *                       failure result rather than throwing (AC-13.4 batch resilience). A
 *                       null/empty/undefined input deserializes to {} (ok).
 *
 * Why JSON: FUXA already persists `users.info` and `roles.value` as JSON strings, so reusing JSON
 * keeps records written by this module readable by unmodified FUXA code and vice-versa (AC-16.5,
 * D-003). No bespoke encoding is introduced.
 *
 * @typedef {{ ok: true, value: any }} ParseOk
 * @typedef {{ ok: false, error: 'invalid_metadata', detail: string, raw: string }} ParseErr
 * @typedef {ParseOk | ParseErr} ParseResult
 */

/**
 * Raised by {@link serialize} when the write input cannot be encoded to JSON (e.g. a circular
 * reference or a BigInt). This is a programming error that should be guarded before persisting;
 * it is deliberately distinct from the resilient, non-throwing {@link deserialize} read path.
 */
class SerializationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SerializationError';
  }
}

/**
 * Encode a JSON-safe object to its stored string form.
 *
 * @param {any} obj the object to encode; `undefined` is treated as the empty object and yields "{}"
 * @returns {string} the JSON string form
 * @throws {SerializationError} only when `obj` is structurally non-encodable (cyclic ref, BigInt, …)
 */
function serialize(obj) {
  try {
    return JSON.stringify(obj === undefined ? {} : obj);
  } catch (e) {
    // JSON.stringify throws a TypeError on circular references and on BigInt values.
    const detail = e && e.message ? e.message : String(e);
    throw new SerializationError(`cannot_serialize: ${detail}`);
  }
}

/**
 * Decode a stored string form back to an object, RESILIENTLY (never throws), so a single corrupt
 * stored record can be isolated per-row instead of failing an entire batch read (AC-13.4).
 *
 * A `null`, `undefined`, or empty-string input represents "no stored info" and decodes to `{}`.
 * A malformed string produces a descriptive failure result carrying the parser message and the
 * offending raw string (never a secret — `info`/`value` rows carry no password).
 *
 * @param {string|null|undefined} str the stored string form
 * @returns {ParseResult}
 */
function deserialize(str) {
  if (str === null || str === undefined || str === '') {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(str) };
  } catch (e) {
    const detail = e && e.message ? e.message : String(e);
    return { ok: false, error: 'invalid_metadata', detail, raw: String(str) };
  }
}

module.exports = { serialize, deserialize, SerializationError };
