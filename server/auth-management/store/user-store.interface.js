//@ts-check
'use strict';

/**
 * User_Store capability interface (injection seam).
 *
 * The service layer depends ONLY on this contract and never on the concrete FUXA storage shape
 * (AC-16.5). The real adapter (Task 2, `adapters/fuxa-user-store.adapter.js`) implements these
 * methods over `server/runtime/users`; tests may supply an in-memory fake. Storage details
 * (the `info` ↔ `{ roles, metadata }` split, the verbatim-hash write, resilient parse) are hidden
 * behind this seam — see design/06-persistence-and-serialization.md.
 *
 * A `readAll` returns a resilient result: successfully parsed records plus a list of per-key parse
 * errors, so one corrupt row cannot fail the whole read (AC-13.4).
 *
 * @typedef {{ records: any[], errors: Array<{ key: string, error: string, detail?: string }> }} ReadAllResult
 */
class User_Store {
  /**
   * Fetch a single user by username.
   * @param {string} username
   * @returns {Promise<any|undefined>} the User_Record (with passwordHash) or undefined if absent
   */
  async get(username) { throw new Error('not_implemented:User_Store.get'); }

  /**
   * Read all users, isolating per-record parse failures.
   * @returns {Promise<ReadAllResult>}
   */
  async readAll() { throw new Error('not_implemented:User_Store.readAll'); }

  /**
   * Create a new user. Duplicate username is rejected atomically by the store (AC-5.2, D-020).
   * @param {any} record a validated User_Record (passwordHash already hashed)
   * @returns {Promise<void>}
   */
  async create(record) { throw new Error('not_implemented:User_Store.create'); }

  /**
   * Apply a partial update. An omitted `passwordHash` retains the existing hash (AC-7.3).
   * @param {string} username
   * @param {any} patch a UserPatch (fullname?/roles?/metadata?/passwordHash?)
   * @returns {Promise<void>}
   */
  async update(username, patch) { throw new Error('not_implemented:User_Store.update'); }

  /**
   * Remove a user (row + in-memory permission-cache eviction, AC-8.2).
   * @param {string} username
   * @returns {Promise<void>}
   */
  async delete(username) { throw new Error('not_implemented:User_Store.delete'); }
}

module.exports = { User_Store };
