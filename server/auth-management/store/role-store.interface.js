//@ts-check
'use strict';

/**
 * Role_Store capability interface (injection seam).
 *
 * The service layer depends ONLY on this contract, never on the FUXA `roles(name,value)` shape
 * (AC-16.5). The real adapter (Task 2, `adapters/fuxa-role-store.adapter.js`) implements these
 * methods over `server/runtime/users`, mapping `Role{ id, name, permissions } ↔ roles(name=role.id,
 * value=JSON(role))` — see design/06-persistence-and-serialization.md §3.4. Role identity is
 * `role.id` (INV-6): the PK column literally named `name` stores `role.id`.
 *
 * `readAll` returns the same resilient shape as the user store so one corrupt role `value` cannot
 * fail the whole read (AC-13.4, N-009).
 *
 * @typedef {import('./user-store.interface').ReadAllResult} ReadAllResult
 */
class Role_Store {
  /**
   * Fetch a single role by its id.
   * @param {string} id
   * @returns {Promise<any|undefined>}
   */
  async get(id) { throw new Error('not_implemented:Role_Store.get'); }

  /**
   * Read all roles, isolating per-role parse failures.
   * @returns {Promise<ReadAllResult>}
   */
  async readAll() { throw new Error('not_implemented:Role_Store.readAll'); }

  /**
   * Create a new role. Duplicate id is rejected without mutation (AC-9.5).
   * @param {any} role a validated Role
   * @returns {Promise<void>}
   */
  async create(role) { throw new Error('not_implemented:Role_Store.create'); }

  /**
   * Replace a role's value wholesale (permission set replaced entirely, AC-9.3).
   * @param {any} role
   * @returns {Promise<void>}
   */
  async update(role) { throw new Error('not_implemented:Role_Store.update'); }

  /**
   * Delete roles by id and prune those ids from every referencing user's `info.roles` (AC-9.4).
   * @param {string[]} ids
   * @returns {Promise<void>}
   */
  async delete(ids) { throw new Error('not_implemented:Role_Store.delete'); }
}

module.exports = { Role_Store };
