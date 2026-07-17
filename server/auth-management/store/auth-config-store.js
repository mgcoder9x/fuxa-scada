//@ts-check
'use strict';

/**
 * AuthConfigStore — module-owned persistence of the RUNTIME auth configuration override (D-049,
 * design/13-runtime-config.md §4). Task D-049.1.
 *
 * WHY IT EXISTS. The auth module's operational policy (`settings.auth.*` + token TTLs + bcryptCost)
 * is normally set in `settings.js` (engineer-only, restart-required). This store holds the RUNTIME
 * OVERRIDE that an admin writes via `PUT /api/auth/config`, so a change takes effect without a
 * restart and WITHOUT editing FUXA's `settings.js`. It is a NEW single-row table (`auth_config`) in
 * the module-owned connection to FUXA's `users.fuxap.db` (via {@link FuxaAuthDb}, D-016) — it edits
 * NO FUXA core file (D-003).
 *
 * PRECEDENCE (resolved by AuthConfigService, not here): effective = defaults ◁ settings.js baseline
 * ◁ THIS override. This store persists ONLY the override patch (the admin's explicit changes), as an
 * opaque JSON blob, plus a monotonic `version` and `updated_at` for audit/optimistic display.
 *
 * FAIL-SAFE (P-019). `get()` NEVER throws for a corrupt/absent row: a missing row ⇒ `null` (no
 * override → baseline/defaults win); a row whose JSON does not parse ⇒ `null` (treated as no
 * override) so a corrupted blob can never crash the module build or brick auth. Validation of the
 * override CONTENT is the service's job (before it is ever persisted here).
 */

const { FuxaAuthDb } = require('./fuxa-auth-db');

const CREATE_TABLE_SQL =
    'CREATE TABLE IF NOT EXISTS auth_config (' +
    'id INTEGER PRIMARY KEY CHECK (id = 1), ' +
    'config TEXT NOT NULL, ' +
    'version INTEGER NOT NULL DEFAULT 1, ' +
    'updated_at INTEGER NOT NULL' +
    ');';

class AuthConfigStore {
    /**
     * @param {{ db?: FuxaAuthDb, dbFile?: string, workDir?: string, sqlite3?: any }} deps
     *   Provide the module's ready {@link FuxaAuthDb} (`db`) — same connection the other stores use —
     *   or the params to build one.
     */
    constructor(deps) {
        const d = deps || {};
        this.db = d.db || new FuxaAuthDb({ dbFile: d.dbFile, workDir: d.workDir, sqlite3: d.sqlite3 });
        /** @type {Promise<void>|null} */
        this._schemaPromise = null;
    }

    /**
     * Create the single-row table once (idempotent). Safe to call on every operation.
     * @returns {Promise<void>}
     */
    ensureSchema() {
        if (!this._schemaPromise) {
            this._schemaPromise = this.db.exec(CREATE_TABLE_SQL);
        }
        return this._schemaPromise;
    }

    /**
     * Read the persisted override. Fail-safe (P-019): returns `null` for an absent row OR a row whose
     * JSON does not parse (corrupt blob is treated as "no override"). Never throws on content.
     * @returns {Promise<{ config: object, version: number, updatedAt: number }|null>}
     */
    async get() {
        await this.ensureSchema();
        const rows = await this.db.all('SELECT config, version, updated_at FROM auth_config WHERE id = 1', []);
        if (!rows || rows.length === 0) {
            return null;
        }
        const row = rows[0];
        let parsed;
        try {
            parsed = JSON.parse(row.config);
        } catch (_e) {
            return null; // corrupt blob → no override (fail-safe); do not throw
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return { config: parsed, version: Number(row.version) || 1, updatedAt: Number(row.updated_at) || 0 };
    }

    /**
     * Upsert the override blob (single row id=1). Serializes `config` to JSON and bumps `version`.
     * The CONTENT is validated by AuthConfigService BEFORE this is called — the store persists as-is.
     * @param {object} config the full override object to persist
     * @param {number} [now] epoch ms (default Date.now())
     * @returns {Promise<{ version: number, updatedAt: number }>}
     */
    async put(config, now = Date.now()) {
        await this.ensureSchema();
        const current = await this.get();
        const version = (current ? current.version : 0) + 1;
        const json = JSON.stringify(config);
        await this.db.run(
            'INSERT OR REPLACE INTO auth_config (id, config, version, updated_at) VALUES (1, ?, ?, ?)',
            [json, version, now]);
        return { version, updatedAt: now };
    }

    /**
     * Delete the override row ("reset to defaults" → next resolve falls back to baseline/defaults).
     * @returns {Promise<number>} rows deleted (0 or 1)
     */
    async clear() {
        await this.ensureSchema();
        const res = await this.db.run('DELETE FROM auth_config WHERE id = 1', []);
        return res.changes;
    }
}

module.exports = { AuthConfigStore };
