//@ts-check
'use strict';

/**
 * FuxaUserStoreAdapter — the `User_Store` implementation over FUXA's `users` table
 * (design/06-persistence-and-serialization.md §2/§3/§5; D-016, D-020, D-024).
 *
 * This adapter is the SOLE component that knows FUXA's `{ username, fullname, password, groups,
 * info }` row shape, that `info` is a JSON string, and that role ids live in `info.roles`
 * (AC-16.5 / D-003). Services depend only on the `User_Store` interface.
 *
 * WRITE PATH (§5.2, D-016 — root fix for N-010). Passwords are hashed in the Service layer and
 * handed here ALREADY hashed. FUXA's `usrstorage.setUser` re-hashes any truthy `pwd` (the
 * double-hash hazard, §5.1), so the adapter NEVER routes a credential through it. Instead it writes
 * ALL columns — including the verbatim bcrypt hash — in ONE `BEGIN IMMEDIATE … COMMIT` transaction
 * on its OWN connection ({@link FuxaAuthDb}). A crash therefore leaves either the whole prior row or
 * the whole new row, never fresh metadata paired with a stale/NULL password. After the COMMIT it
 * performs a BEST-EFFORT cache refresh via `runtime.users.setUsers({..., password omitted})` — the
 * only public FUXA API that refreshes the in-memory `usersMap` for one user without re-hashing
 * (verified pwd-falsy branch of `setUser`). If that refresh fails, the DB row is already correct and
 * the cache self-heals on the next `_loadUsers` (restart); module authority reads from the store,
 * not the cache (D-015).
 *
 * READ PATH (D-024). `get`/`readAll` read through the adapter's OWN connection with the byte-for-byte
 * SELECT that FUXA's `usrstorage.getUsers` runs, then parse `info` resiliently
 * (`deserialize`) and split it into `{ roles, metadata }`. This is a deliberate refinement of the
 * §2.3 "delegate reads to runtime.users.getUsers" mapping: the SELECT is identical (same table, same
 * columns), and reading the store directly realizes D-015's "re-resolve authority from the store"
 * more faithfully than reading FUXA's cache, while removing an init-order dependency and making the
 * Store layer independently testable (P-003/P-004). `runtime.users` is retained ONLY as the
 * best-effort cache-coherence collaborator (see D-024 in decisions/01-ai-decisions.md).
 *
 * CREATE atomicity (§5.4a, D-020). `create` uses a PLAIN `INSERT` on the `username` PRIMARY KEY (never
 * `INSERT OR REPLACE`), so a concurrent duplicate fails with a PK conflict surfaced as
 * `duplicate_username` — no read-then-write TOCTOU (AC-5.2).
 */

const { serialize, deserialize } = require('../store/serialization');
const { FuxaAuthDb } = require('../store/fuxa-auth-db');

const USER_COLUMNS = 'username, fullname, password, groups, info';

/** Thrown when an update/delete targets a username that does not exist. */
class UserNotFoundError extends Error {
    /** @param {string} username */
    constructor(username) {
        super('user_not_found:' + username);
        this.name = 'UserNotFoundError';
        this.code = 'user_not_found';
    }
}

class FuxaUserStoreAdapter {
    /**
     * @param {{ db?: FuxaAuthDb, dbFile?: string, workDir?: string, sqlite3?: any, runtimeUsers?: any }} deps
     *   Provide either a ready `db` (a {@link FuxaAuthDb}) or the parameters to build one
     *   (`dbFile`/`workDir` + optional `sqlite3`). `runtimeUsers` is the FUXA `runtime/users`
     *   module used ONLY for best-effort in-memory `usersMap` coherence; omit it in unit tests.
     */
    constructor(deps) {
        const d = deps || {};
        this.db = d.db || new FuxaAuthDb({ dbFile: d.dbFile, workDir: d.workDir, sqlite3: d.sqlite3 });
        this.runtimeUsers = d.runtimeUsers || null;
    }

    /**
     * Compose the FUXA `info` JSON string from a domain record's `{ metadata, roles }`. `roles` is
     * authoritative and re-attached at the top level (§3.2 reserved-key rule).
     * @param {object} metadata
     * @param {string[]} roles
     * @returns {string}
     * @private
     */
    _composeInfo(metadata, roles) {
        const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
        // Spread (define-semantics) rather than Object.assign ([[Set]]) so a caller-supplied
        // `__proto__` key cannot reassign the composed object's prototype (D-026/N-029); `roles`
        // is re-attached last so it stays authoritative (§3.2).
        return serialize({ ...base, roles: Array.isArray(roles) ? roles : [] });
    }

    /**
     * Map a raw FUXA row + already-parsed `info` object to a domain `User_Record`. Splits the
     * top-level `roles` out of `info`; the remainder is `metadata` (§3.2).
     * @param {any} row
     * @param {any} infoValue parsed `info` (any JSON value; non-object treated as empty)
     * @returns {{ username: string, fullname: string, passwordHash: string, roles: string[], metadata: object, groups: any }}
     * @private
     */
    _compose(row, infoValue) {
        const obj = infoValue && typeof infoValue === 'object' && !Array.isArray(infoValue) ? infoValue : {};
        const roles = Array.isArray(obj.roles) ? obj.roles : [];
        // Spread uses define-semantics (CreateDataProperty), NOT `[[Set]]`, so no key can invoke the
        // `__proto__` accessor even if one slipped past deserialize's strip (D-026/N-029).
        const metadata = { ...obj };
        delete metadata.roles;
        return {
            username: row.username,
            fullname: row.fullname,
            passwordHash: row.password,
            roles,
            metadata,
            groups: row.groups,
        };
    }

    /**
     * Fetch one user by username, or `undefined` if absent (matches FUXA `getUsers`→undefined).
     * A corrupt `info` fails CLOSED: the record is returned with `roles: []` / `metadata: {}` (least
     * privilege) rather than throwing, so a malformed metadata blob cannot make a valid credential
     * "unknown" nor grant authority (§7 fail-closed; see N-026).
     * @param {string} username
     * @returns {Promise<any|undefined>}
     */
    async get(username) {
        const rows = await this.db.all(
            'SELECT ' + USER_COLUMNS + ' FROM users WHERE username = ?', [username]);
        if (!rows || rows.length === 0) {
            return undefined;
        }
        const row = rows[0];
        const parsed = deserialize(row.info);
        return this._compose(row, parsed.ok ? parsed.value : {});
    }

    /**
     * Read all users, isolating per-record parse failures (AC-13.4). One corrupt `info` becomes an
     * `errors` entry; every healthy row is still returned in `records`.
     * @returns {Promise<{ records: any[], errors: Array<{ key: string, error: string, detail?: string }> }>}
     */
    async readAll() {
        const rows = await this.db.all('SELECT ' + USER_COLUMNS + ' FROM users');
        const records = [];
        const errors = [];
        for (const row of rows) {
            const parsed = deserialize(row.info);
            if (parsed.ok) {
                records.push(this._compose(row, parsed.value));
            } else {
                errors.push({ key: row.username, error: 'invalid_metadata', detail: parsed.detail });
            }
        }
        return { records, errors };
    }

    /**
     * Create a new user in ONE transaction (plain INSERT → atomic duplicate rejection, D-020/§5.4a).
     * The already-hashed `passwordHash` is written verbatim (no re-hash). A duplicate username
     * rejects with `DuplicateKeyError` (code `duplicate_username`).
     * @param {any} record a validated User_Record (passwordHash already hashed)
     * @returns {Promise<void>}
     */
    async create(record) {
        const groups = record.groups === undefined ? null : record.groups;
        const fullname = typeof record.fullname === 'string' ? record.fullname : '';
        const info = this._composeInfo(record.metadata, record.roles);
        await this.db.transaction(async (db) => {
            await db.run(
                'INSERT INTO users (username, fullname, password, groups, info) VALUES (?, ?, ?, ?, ?)',
                [record.username, fullname, record.passwordHash || '', groups, info]
            );
        });
        await this._refreshCache(record.username, fullname, groups, info);
    }

    /**
     * Apply a partial update in ONE transaction. Reads the existing row, merges the patch (an omitted
     * field is retained), re-composes `info`, and writes the full row. An omitted/empty
     * `passwordHash` retains the existing hash (AC-7.3 retain-on-omit) by writing the UPDATE without
     * the `password` column. Throws {@link UserNotFoundError} if the row is absent (the Service layer
     * normally checks existence first).
     * @param {string} username
     * @param {any} patch UserPatch (fullname?/roles?/metadata?/groups?/passwordHash?)
     * @returns {Promise<void>}
     */
    async update(username, patch) {
        const p = patch || {};
        let composed;
        await this.db.transaction(async (db) => {
            const rows = await db.all(
                'SELECT ' + USER_COLUMNS + ' FROM users WHERE username = ?', [username]);
            if (!rows || rows.length === 0) {
                throw new UserNotFoundError(username);
            }
            const parsed = deserialize(rows[0].info);
            const existing = this._compose(rows[0], parsed.ok ? parsed.value : {});

            const fullname = p.fullname !== undefined ? p.fullname : existing.fullname;
            const roles = p.roles !== undefined ? p.roles : existing.roles;
            const metadata = p.metadata !== undefined ? p.metadata : existing.metadata;
            const groupsVal = p.groups !== undefined ? p.groups : existing.groups;
            const groups = groupsVal === undefined ? null : groupsVal;
            const info = this._composeInfo(metadata, roles);

            const hasNewHash = typeof p.passwordHash === 'string' && p.passwordHash !== '';
            if (hasNewHash) {
                await db.run(
                    'UPDATE users SET fullname = ?, groups = ?, info = ?, password = ? WHERE username = ?',
                    [fullname, groups, info, p.passwordHash, username]);
            } else {
                // retain-on-omit (AC-7.3): the password column is left untouched.
                await db.run(
                    'UPDATE users SET fullname = ?, groups = ?, info = ? WHERE username = ?',
                    [fullname, groups, info, username]);
            }
            composed = { fullname, groups, info };
        });
        if (composed) {
            await this._refreshCache(username, composed.fullname, composed.groups, composed.info);
        }
    }

    /**
     * Remove a user (row + best-effort in-memory cache eviction, AC-8.2). The DB delete runs on the
     * adapter's own connection; the FUXA `usersMap` is then evicted best-effort via `removeUsers`.
     * @param {string} username
     * @returns {Promise<void>}
     */
    async delete(username) {
        await this.db.run('DELETE FROM users WHERE username = ?', [username]);
        if (this.runtimeUsers && typeof this.runtimeUsers.removeUsers === 'function') {
            try {
                await this.runtimeUsers.removeUsers(username);
            } catch (_e) {
                // best-effort cache eviction; the row is already deleted from the DB.
            }
        }
    }

    /**
     * ATOMIC last-administrator-guarded delete (AC-8.3/AC-8.5, D-020/D-033, closes the N-016 TOCTOU).
     * The existence check, admin classification of the target, the remaining-admin count, and the
     * conditional row removal all run inside ONE `BEGIN IMMEDIATE` transaction on this adapter's own
     * connection. `BEGIN IMMEDIATE` takes SQLite's write lock, so two concurrent last-admin deletes
     * are serialized: the second transaction observes the first's committed delete, recounts, and
     * refuses to remove the now-last administrator (P-016). No mutation occurs on
     * `unknown_user`/`last_admin`. The best-effort `usersMap` cache eviction happens AFTER COMMIT and
     * only when a row was actually deleted.
     *
     * The admin-determination predicate is INJECTED (`isAdministratorFn`, §05) so this adapter gains
     * no RBAC knowledge. For a legacy group-code admin (`groups` ∈ {-1,255}) the §05 predicate decides
     * without any role lookup; when it does read roles, those reads run on this same connection and
     * therefore observe the transaction's consistent snapshot.
     *
     * @param {string} username
     * @param {(record: any) => Promise<boolean>} isAdministratorFn
     * @returns {Promise<{ kind: 'deleted' } | { kind: 'unknown_user' } | { kind: 'last_admin' }>}
     */
    async deleteGuarded(username, isAdministratorFn) {
        const classify = typeof isAdministratorFn === 'function' ? isAdministratorFn : async () => false;
        /** @type {{ kind: 'deleted' } | { kind: 'unknown_user' } | { kind: 'last_admin' }} */
        let outcome = { kind: 'unknown_user' };
        await this.db.transaction(async (db) => {
            const rows = await db.all(
                'SELECT ' + USER_COLUMNS + ' FROM users WHERE username = ?', [username]);
            if (!rows || rows.length === 0) {
                outcome = { kind: 'unknown_user' };
                return; // no mutation
            }
            const parsed = deserialize(rows[0].info);
            const target = this._compose(rows[0], parsed.ok ? parsed.value : {});

            if (await classify(target)) {
                // Target is an administrator — is there ANOTHER administrator left? One is enough.
                const all = await db.all('SELECT ' + USER_COLUMNS + ' FROM users');
                let anotherAdminExists = false;
                for (const r of all) {
                    if (r.username === username) continue;
                    const pr = deserialize(r.info);
                    const rec = this._compose(r, pr.ok ? pr.value : {});
                    if (await classify(rec)) { anotherAdminExists = true; break; }
                }
                if (!anotherAdminExists) {
                    outcome = { kind: 'last_admin' };
                    return; // no mutation — the last administrator is protected (AC-8.5)
                }
            }
            await db.run('DELETE FROM users WHERE username = ?', [username]);
            outcome = { kind: 'deleted' };
        });
        // Best-effort cache eviction AFTER commit, only when a row was removed (AC-8.2).
        if (outcome.kind === 'deleted' && this.runtimeUsers && typeof this.runtimeUsers.removeUsers === 'function') {
            try {
                await this.runtimeUsers.removeUsers(username);
            } catch (_e) {
                // best-effort; the row is already deleted from the DB.
            }
        }
        return outcome;
    }

    /**
     * Best-effort in-memory `usersMap` cache refresh via FUXA's pwd-falsy `setUsers` branch (§5.2
     * step 2). Never throws: the DB row is already committed and authority reads from the store.
     * @param {string} username
     * @param {string} fullname
     * @param {any} groups
     * @param {string} info the serialized `info` JSON string
     * @returns {Promise<void>}
     * @private
     */
    async _refreshCache(username, fullname, groups, info) {
        if (!this.runtimeUsers || typeof this.runtimeUsers.setUsers !== 'function') {
            return;
        }
        try {
            // password omitted → setUser's pwd-falsy branch: idempotent non-secret re-write +
            // usersMap.set(username, { info: JSON.parse(info), groups }). The verbatim hash from the
            // committed transaction is preserved (the password column is not in that UPDATE).
            await this.runtimeUsers.setUsers({ username, fullname, groups, info });
        } catch (_e) {
            // best-effort; cache self-heals on next _loadUsers (restart). See §5.2.
        }
    }
}

module.exports = { FuxaUserStoreAdapter, UserNotFoundError };
