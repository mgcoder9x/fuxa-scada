//@ts-check
'use strict';

const { isValidPermissionId } = require('./permission');

/**
 * Role model — a named collection of permissions that can be assigned to users.
 *
 * Fields (design/11-data-models.md §3.2; design/05-rbac-authorization.md §2.1):
 *   id          : string   (required; canonical identity/uniqueness key — INV-6; the value stored
 *                           in the `roles` PK column `name`, and the join key in User_Record.roles)
 *   name        : string   (required; human-readable display label; carried INSIDE the serialized
 *                           value, not the PK column)
 *   permissions : string[] (required, may be []; each a valid Permission id — INV-7; replaced
 *                           wholesale on update; compared as a set for the round-trip)
 *
 * Validation returns a closed result set rather than throwing (module convention).
 */

/**
 * Validate + normalize a Role.
 * @param {any} input
 * @returns {{ ok: true, role: { id: string, name: string, permissions: string[] } } | { ok: false, error: string }}
 */
function validateRole(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'role_not_object' };

  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!id) return { ok: false, error: 'role_id_required' }; // INV-6

  const name = typeof input.name === 'string' ? input.name : '';

  const perms = Array.isArray(input.permissions) ? input.permissions : [];
  for (const p of perms) {
    if (!isValidPermissionId(p)) return { ok: false, error: `invalid_permission:${p}` }; // INV-7
  }

  return { ok: true, role: { id, name, permissions: perms.slice() } };
}

module.exports = { validateRole };
