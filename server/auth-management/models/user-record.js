//@ts-check
'use strict';

/**
 * User_Record model — the domain account, in its domain shape (BEFORE it is mapped to the FUXA
 * `{ username, fullname, password, groups, info }` stored row, which is owned by
 * design/06-persistence-and-serialization.md §3).
 *
 * Fields (design/11-data-models.md §3.1):
 *   username     : string  (required, primary key, trimmed, non-empty — INV-5)
 *   fullname     : string  (required; stored verbatim)
 *   passwordHash : string  (required; an already-hashed bcrypt string — NEVER plaintext, INV-3)
 *   roles        : string[] (required, may be []; role ids referencing Role.id; treated as a set)
 *   metadata     : object  (optional, defaults {}; JSON-safe, INV-2; MUST NOT carry a top-level
 *                           `roles` key, INV-1)
 *   groups       : number | number[] (optional; FUXA legacy compat code)
 *
 * Invariants encoded here:
 *   INV-1 — the top-level `roles` key of `metadata` is reserved (roles are first-class, D-007).
 *   INV-2 — `metadata` must be JSON-safe (no undefined/function/NaN/±Infinity/-0/Date).
 *   INV-3 — the record carries only `passwordHash`; plaintext `password` never appears here
 *           (hashing is the Password_Hasher's job at the service layer, not the model's).
 *   INV-5 — `username` is required and trimmed.
 */

/**
 * INV-1: does `metadata` carry a *top-level* `roles` key? (A nested `roles` deeper in the object
 * is allowed; only the top level is reserved for the role-id list on write.)
 * @param {unknown} metadata
 * @returns {boolean}
 */
function metadataHasReservedRolesKey(metadata) {
  return !!metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    && Object.prototype.hasOwnProperty.call(metadata, 'roles');
}

/**
 * INV-2: recursively check that `value` is JSON-safe per design/06 §4.2 — only strings, finite
 * numbers (excluding -0), booleans, null, arrays, and nested plain objects are allowed.
 * `undefined`, functions, `NaN`, `±Infinity`, `-0`, and `Date` (and any other object type) are
 * rejected. Returns true iff every reachable value is JSON-safe.
 * @param {unknown} value
 * @returns {boolean}
 */
function isJsonSafe(value) {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') {
    // Reject NaN, ±Infinity, and -0 (which does not round-trip through JSON).
    if (!Number.isFinite(value)) return false;
    if (Object.is(value, -0)) return false;
    return true;
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') return false;
  if (Array.isArray(value)) {
    return value.every(isJsonSafe);
  }
  if (t === 'object') {
    // Only plain objects are JSON-safe; Date, Map, etc. are not.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(/** @type {Record<string, unknown>} */(value)).every(isJsonSafe);
  }
  return false;
}

/**
 * Validate + normalize a User_Record in its domain shape. Returns a closed result set rather than
 * throwing (module convention). On success, the returned `user` object carries ONLY the domain
 * fields (in particular there is never a plaintext `password` field — INV-3).
 *
 * @param {any} input
 * @returns {{ ok: true, user: { username: string, fullname: string, passwordHash: string, roles: string[], metadata: object, groups: (number|number[]|undefined) } } | { ok: false, error: string }}
 */
function validateUserRecord(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'user_not_object' };

  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (!username) return { ok: false, error: 'username_required' }; // INV-5

  // INV-3: reject a plaintext `password` field outright — this model only ever carries a hash.
  if (Object.prototype.hasOwnProperty.call(input, 'password')) {
    return { ok: false, error: 'plaintext_password_forbidden' };
  }

  const roles = Array.isArray(input.roles) ? input.roles.slice() : [];
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata
    : {};

  // INV-1: metadata must not carry a top-level `roles` key.
  if (metadataHasReservedRolesKey(metadata)) {
    return { ok: false, error: 'metadata_reserved_roles_key' };
  }

  // INV-2: metadata must be JSON-safe.
  if (!isJsonSafe(metadata)) {
    return { ok: false, error: 'metadata_not_json_safe' };
  }

  return {
    ok: true,
    user: {
      username,
      fullname: typeof input.fullname === 'string' ? input.fullname : '',
      passwordHash: typeof input.passwordHash === 'string' ? input.passwordHash : '',
      roles,
      metadata,
      groups: input.groups, // FUXA compat code (number | number[]); preserved verbatim
    },
  };
}

module.exports = { validateUserRecord, metadataHasReservedRolesKey, isJsonSafe };
