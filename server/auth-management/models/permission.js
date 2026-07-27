//@ts-check
'use strict';

/**
 * Permission model.
 *
 * A Permission is a single capability id of the form `<resource>.<action>` (lower-case,
 * dot-separated), e.g. `user.create`. It is treated opaquely by the Authorization_Service
 * (set-membership only) and is never independently persisted — it exists only as a member of
 * a `Role.permissions` array.
 *
 * Design: design/11-data-models.md §3.3 (entity), §6 INV-7 (id scheme);
 *         design/05-rbac-authorization.md §2.2 (scheme + ADMIN_PERMISSION_SET).
 */

// INV-7: permission id is `<resource>.<action>`, lower-case, dot-separated (>= 2 segments).
const PERMISSION_ID_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

/**
 * True iff `id` is a syntactically valid permission id per INV-7.
 * @param {unknown} id
 * @returns {boolean}
 */
function isValidPermissionId(id) {
  return typeof id === 'string' && PERMISSION_ID_REGEX.test(id);
}

// The distinguished set that defines an administrator role (design/05 §2.2). Frozen so it
// cannot be mutated at runtime; consumed by §04 (last-admin), §05 (authorization), §12 (bootstrap).
//
// SINGLE SOURCE OF TRUTH (D-050, fixes the N-091-adjacent duplication): this array is the ONLY
// definition. `services/authorization.service.js` previously kept a second, independent copy which
// D-049 updated while this one was left at 8 entries — a latent misclassification hazard
// (`isAdministrator` would have rejected a genuine admin had any consumer imported the stale copy).
// The service now imports from here (models are the lower layer; services depend on models, never
// the reverse), so any future permission is added in exactly one place.
const ADMIN_PERMISSION_SET = Object.freeze([
  'user.create', 'user.read', 'user.update', 'user.delete',
  'role.create', 'role.read', 'role.update', 'role.delete',
  // D-049: functional permissions for the runtime auth-config surface (single global object, so the
  // function axis only — no data-scoped variant). Administrators inherit both.
  'settings.read', 'settings.manage',
]);

module.exports = { isValidPermissionId, ADMIN_PERMISSION_SET, PERMISSION_ID_REGEX };
