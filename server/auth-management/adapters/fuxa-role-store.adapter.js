//@ts-check
'use strict';

/**
 * FuxaRoleStoreAdapter — the `Role_Store` implementation over FUXA's `roles` table
 * (design/06-persistence-and-serialization.md §2.2/§3.4/§4.3; D-024).
 *
 * Mapping (verified in `usrstorage.setRoles`): `Role{ id, name, permissions } ↔ roles(name = role.id,
 * value = JSON(role))` — the PK column literally named `name` stores `role.id`, and the WHOLE role
 * object is serialized into `value`. This adapter is the sole owner of that shape (AC-16.5 / D-003).
 *
 * RESILIENT readAll (AC-13.4, closes N-009). FUXA's `runtime/users/index.js` `getRoles` does
 * `JSON.parse(drows[id].value)` with NO try/catch — one corrupt role `value` throws and rejects the
 * ENTIRE listing. This adapter instead reads raw rows through the module's own connection and parses
 * each with the resilient `deserialize`, so a corrupt role is isolated exactly as a corrupt user
 * `info` already is (§4.3).
 *
 * CREATE atomicity (AC-9.5). `create` uses a PLAIN `INSERT` on the `roles.name` PRIMARY KEY, so a
 * duplicate role id is rejected atomically WITHOUT mutating the existing role (contrast FUXA's
 * `INSERT OR REPLACE`, which would silently overwrite). `update` intentionally uses `INSERT OR
 * REPLACE` for the wholesale value replace (AC-9.3). This mirrors the D-020 atomic-create philosophy;
 * see D-024.
 *
 * DELETE (§3.4 / AC-9.4). Delegates to `runtime.users.removeRoles` when injected — it prunes the
 * deleted ids from every user's `info.roles`, deletes the role rows, AND updates the in-memory cache
 * (verified). When `runtimeUsers` is absent (unit tests / standalone), an equivalent prune+delete is
 * performed on the module's own connection.
 */

const { serialize, deserialize } = require('../store/serialization');
const { FuxaAuthDb } = require('../store/fuxa-auth-db');

class FuxaRoleStoreAdapter {
    /**
     * @param {{ db?: FuxaAuthDb, dbFile?: string, workDir?: string, sqlite3?: any, runtimeUsers?: any }} deps
     *   Provide a ready `db` ({@link FuxaAuthDb}) or the params to build one. `runtimeUsers` is the
     *   FUXA `runtime/users` module; when present, `delete` delegates to its `removeRoles`
     *   (prune + delete + cache). Omit it in unit tests to use the own-connection fallback.
     */
    constructor(deps) {
        const d = deps || {};
        this.db = d.db || new FuxaAuthDb({ dbFile: d.dbFile, workDir: d.workDir, sqlite3: d.sqlite3 });
        this.runtimeUsers = d.runtimeUsers || null;
    }

    /**
     * Fetch one role by its id (the `roles.name` PK). `undefined` if absent or if the stored `value`
     * is unparseable (a corrupt single role reads as not-found rather than throwing).
     * @param {string} id
     * @returns {Promise<any|undefined>}
     */
    async get(id) {
        const rows = await this.db.all('SELECT name, value FROM roles WHERE name = ?', [id]);
        if (!rows || rows.length === 0) {
            return undefined;
        }
        const parsed = deserialize(rows[0].value);
        return parsed.ok ? parsed.value : undefined;
    }

    /**
     * Read all roles, isolating per-role parse failures (AC-13.4, N-009). One corrupt `value` becomes
     * an `errors` entry keyed by the role id (the `name` column); every healthy role is still
     * returned.
     * @returns {Promise<{ records: any[], errors: Array<{ key: string, error: string, detail?: string }> }>}
     */
    async readAll() {
        const rows = await this.db.all('SELECT name, value FROM roles');
        const records = [];
        const errors = [];
        for (const row of rows) {
            const parsed = deserialize(row.value);
            if (parsed.ok) {
                records.push(parsed.value);
            } else {
                errors.push({ key: row.name, error: 'invalid_metadata', detail: parsed.detail });
            }
        }
        return { records, errors };
    }

    /**
     * Create a new role (plain INSERT → atomic duplicate-id rejection, AC-9.5). The whole role object
     * is serialized into `value`. A duplicate id rejects with `DuplicateKeyError` (code
     * `duplicate_key`) and does NOT mutate the existing role.
     * @param {any} role a validated Role { id, name, permissions }
     * @returns {Promise<void>}
     */
    async create(role) {
        await this.db.run(
            'INSERT INTO roles (name, value) VALUES (?, ?)',
            [role.id, serialize(role)]);
    }

    /**
     * Replace a role's value wholesale (permission set replaced entirely, AC-9.3).
     * @param {any} role
     * @returns {Promise<void>}
     */
    async update(role) {
        await this.db.run(
            'INSERT OR REPLACE INTO roles (name, value) VALUES (?, ?)',
            [role.id, serialize(role)]);
    }

    /**
     * Delete roles by id and prune those ids from every referencing user's `info.roles` (AC-9.4).
     * Delegates to `runtime.users.removeRoles` when injected (prune + delete + cache); otherwise
     * performs the equivalent prune+delete on the module's own connection.
     * @param {string[]} ids
     * @returns {Promise<void>}
     */
    async delete(ids) {
        if (!Array.isArray(ids) || ids.length === 0) {
            return;
        }
        if (this.runtimeUsers && typeof this.runtimeUsers.removeRoles === 'function') {
            // removeRoles expects role objects and keys on role.id (verified).
            await this.runtimeUsers.removeRoles(ids.map((id) => ({ id })));
            return;
        }
        // Own-connection fallback: prune each user's info.roles, then delete the role rows — the same
        // effect as usrstorage.removeRoles, but self-contained for tests.
        const idSet = new Set(ids);
        await this.db.transaction(async (db) => {
            const users = await db.all('SELECT username, info FROM users');
            for (const user of users) {
                if (!user.info) continue;
                const parsed = deserialize(user.info);
                if (!parsed.ok || !parsed.value || !Array.isArray(parsed.value.roles)) continue;
                const filtered = parsed.value.roles.filter((rid) => !idSet.has(rid));
                if (filtered.length !== parsed.value.roles.length) {
                    // Spread (define-semantics) not Object.assign ([[Set]]) — no `__proto__` accessor
                    // hazard on the parsed row (D-026/N-029); `roles` re-attached authoritatively.
                    const nextInfo = { ...parsed.value, roles: filtered };
                    await db.run('UPDATE users SET info = ? WHERE username = ?',
                        [serialize(nextInfo), user.username]);
                }
            }
            for (const id of ids) {
                await db.run('DELETE FROM roles WHERE name = ?', [id]);
            }
        });
    }
}

module.exports = { FuxaRoleStoreAdapter };
