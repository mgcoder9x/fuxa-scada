//@ts-check
'use strict';

/**
 * FuxaAuthDb — the module-owned sqlite3 connection to FUXA's `users.fuxap.db`
 * (design/06-persistence-and-serialization.md §5.2, D-016).
 *
 * WHY THIS EXISTS. FUXA's `server/runtime/users/index.js` exports only high-level wrappers
 * (`getUsers`/`setUsers`/`removeUsers`/`getRoles`/`setRoles`/`removeRoles`/…) and `usrstorage.js`
 * exposes NO raw-SQL or db-handle API (verified 2026-07-13). `usrstorage.setUser` also re-hashes
 * any truthy password (the double-hash hazard, §5.1). To write an already-hashed credential
 * verbatim — and to write ALL columns in ONE transaction so a crash can never persist fresh
 * metadata paired with a stale/NULL password (root fix for N-010) — the module MUST own its own
 * connection to the SAME database file. This helper is that connection.
 *
 * It edits NO FUXA core file: it opens the existing `users.fuxap.db` (created by `usrstorage._bind`)
 * with `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout` so it coexists with FUXA's own connection
 * (§5.2 residual-concurrency note). All coupling to the FUXA row shape stays inside the two store
 * adapters that use this handle (AC-16.5 / D-003 boundary).
 *
 * The handle is storage-detail, hidden behind the `User_Store`/`Role_Store` interfaces; services
 * never see it. It is injectable so tests can point it at a temp-directory `users.fuxap.db` and
 * exercise the full serialize → §5 write → SQL read → parse/split path end-to-end (§9.1).
 */

const path = require('node:path');

/**
 * Thrown when a write hits a PRIMARY KEY / UNIQUE constraint (atomic duplicate rejection,
 * D-020/§5.4a). Generic across tables (`users.username`, `roles.name`); the calling adapter/service
 * maps it to a domain-specific outcome (`duplicate_username` for users, duplicate role id for roles,
 * AC-5.2/AC-9.5). Carries `code === 'duplicate_key'`.
 */
class DuplicateKeyError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'DuplicateKeyError';
        this.code = 'duplicate_key';
    }
}

class FuxaAuthDb {
    /**
     * @param {{ dbFile?: string, workDir?: string, sqlite3?: any, busyTimeoutMs?: number, filename?: string }} options
     *   `dbFile` — full path to the sqlite file (wins if given). Otherwise `workDir` + `filename`
     *   (default `users.fuxap.db`, matching `usrstorage._bind`). `sqlite3` — the driver module
     *   (defaults to `require('sqlite3')`, the SAME dependency FUXA uses). `busyTimeoutMs` — the
     *   write-lock wait so the adapter coexists with FUXA's connection (default 5000).
     */
    constructor(options) {
        const opts = options || {};
        const filename = opts.filename || 'users.fuxap.db';
        if (opts.dbFile) {
            this.dbFile = opts.dbFile;
        } else if (opts.workDir) {
            this.dbFile = path.join(opts.workDir, filename);
        } else {
            throw new Error('FuxaAuthDb requires dbFile or workDir');
        }
        // Lazily require the driver so the module can be loaded (for its interface) without sqlite3
        // present; the driver is only needed once a real connection is opened.
        this._sqlite3 = opts.sqlite3 || null;
        this.busyTimeoutMs = typeof opts.busyTimeoutMs === 'number' ? opts.busyTimeoutMs : 5000;
        /** @type {any} */
        this._db = null;
        /** @type {Promise<void>|null} */
        this._openPromise = null;
        // In-process transaction serializer (N-032). A single sqlite3 connection cannot hold two
        // overlapping transactions — a second `BEGIN IMMEDIATE` while one is open throws
        // "cannot start a transaction within a transaction". Node's async interleaving lets two
        // `transaction()` calls overlap, so we chain them through this promise gate: each waits for
        // the previous to COMMIT/ROLLBACK before it BEGINs. `BEGIN IMMEDIATE` still serializes writers
        // across other connections (e.g. FUXA's own), so intra- + inter-process serialization hold.
        /** @type {Promise<void>} */
        this._txQueue = Promise.resolve();
    }

    /**
     * Open the connection once (idempotent) and apply WAL + busy_timeout so writes coexist with
     * FUXA's own connection to the same file. Concurrent callers share one open promise.
     * @returns {Promise<void>}
     */
    open() {
        if (this._openPromise) {
            return this._openPromise;
        }
        this._openPromise = new Promise((resolve, reject) => {
            const sqlite3 = this._sqlite3 || (this._sqlite3 = require('sqlite3'));
            const driver = sqlite3.verbose ? sqlite3.verbose() : sqlite3;
            const db = new driver.Database(this.dbFile, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this._db = db;
                // WAL lets the adapter and FUXA read/write the same file concurrently; busy_timeout
                // makes a writer wait for the lock instead of failing fast with SQLITE_BUSY.
                db.exec(
                    'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=' + this.busyTimeoutMs + ';',
                    (pragmaErr) => {
                        if (pragmaErr) {
                            reject(pragmaErr);
                        } else {
                            resolve();
                        }
                    }
                );
            });
        });
        return this._openPromise;
    }

    /**
     * Run a write statement. Resolves with `{ changes, lastID }`. A PK conflict is normalized to a
     * {@link DuplicateKeyError}.
     * @param {string} sql
     * @param {any[]} [params]
     * @returns {Promise<{ changes: number, lastID: number }>}
     */
    run(sql, params = []) {
        return this.open().then(() => new Promise((resolve, reject) => {
            this._db.run(sql, params, function (err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT' && /UNIQUE constraint failed/i.test(String(err.message))) {
                        reject(new DuplicateKeyError(String(err.message)));
                    } else {
                        reject(err);
                    }
                } else {
                    // `this` is the sqlite3 statement context carrying changes/lastID.
                    resolve({ changes: this.changes, lastID: this.lastID });
                }
            });
        }));
    }

    /**
     * Run a read query. Resolves with the row array.
     * @param {string} sql
     * @param {any[]} [params]
     * @returns {Promise<any[]>}
     */
    all(sql, params = []) {
        return this.open().then(() => new Promise((resolve, reject) => {
            this._db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        }));
    }

    /**
     * Run one or more statements with no result rows (e.g. PRAGMA/BEGIN/COMMIT).
     * @param {string} sql
     * @returns {Promise<void>}
     */
    exec(sql) {
        return this.open().then(() => new Promise((resolve, reject) => {
            this._db.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        }));
    }

    /**
     * Run `fn` inside a single `BEGIN IMMEDIATE … COMMIT` write transaction (acquires the SQLite
     * write lock up front so concurrent writers serialize — the enforcement point for the D-020
     * atomic invariants and the D-016 single-transaction full-row write). Rolls back and rethrows
     * on any error. `fn` receives `this` for statement execution.
     * @template T
     * @param {(db: FuxaAuthDb) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    transaction(fn) {
        // Serialize on the in-process queue (N-032): the next transaction cannot BEGIN until the
        // previous one has COMMITted/ROLLed BACK, so a single connection never holds two overlapping
        // transactions. The gate is released in `finally` regardless of success/failure so one
        // failing transaction cannot deadlock the queue.
        const prior = this._txQueue;
        let release;
        this._txQueue = new Promise((res) => { release = res; });
        const run = async () => {
            await this.exec('BEGIN IMMEDIATE;');
            try {
                const result = await fn(this);
                await this.exec('COMMIT;');
                return result;
            } catch (e) {
                try { await this.exec('ROLLBACK;'); } catch (_rollbackErr) { /* surface the original */ }
                throw e;
            } finally {
                release();
            }
        };
        // Wait for the prior transaction to settle (either outcome) before starting this one.
        return prior.then(run, run);
    }

    /**
     * Close the connection (used by tests / shutdown). Idempotent.
     * @returns {Promise<void>}
     */
    close() {
        return new Promise((resolve) => {
            if (!this._db) { resolve(); return; }
            this._db.close(() => { this._db = null; this._openPromise = null; resolve(); });
        });
    }
}

module.exports = { FuxaAuthDb, DuplicateKeyError };
