//@ts-check
'use strict';

/**
 * RefreshTokenStore — the server-side refresh-token family store (design/02-token-and-session.md
 * §6.1/§6.2; D-019 fixes N-015; implementation decisions D-030).
 *
 * WHY IT EXISTS. FUXA's refresh is STATELESS: a "rotated" refresh JWT stays valid until its 7-day
 * expiry and can be replayed, and sign-out cannot invalidate a leaked token (defect N-015). This
 * store makes refresh STATEFUL so rotation is single-use, replay of a consumed token is DETECTED
 * (RFC 9700) and revokes the whole token family, and sign-out/password-change/disable can revoke a
 * family server-side. It is a NEW table (`auth_refresh_tokens`) in the module-owned connection to
 * FUXA's `users.fuxap.db` (via {@link FuxaAuthDb}, D-016) — it edits NO FUXA core file (D-003).
 *
 * STATE MACHINE (per family_id): a token is `active` → (consumed once) → `used`, minting a new
 * `active` child in the same family. Presenting an already-`used` (or `revoked`) token is a REUSE
 * event and transitions EVERY token in the family to `revoked`. Invariant (P-015): at most one
 * `active` token exists per family at any time, and a detected reuse leaves the whole family unusable.
 *
 * IMPLEMENTATION DECISIONS (D-030, reasons in decisions/01):
 *  - **At-rest hashing = SHA-256 (hex) + `crypto.timingSafeEqual`**, NOT bcrypt. Refresh tokens are
 *    high-entropy random JWTs (not low-entropy passwords), so a slow password-KDF adds latency with
 *    no benefit; a preimage/collision-resistant fast hash is the standard at-rest choice. Only the
 *    hash is stored, so a DB read cannot replay a token.
 *  - **Atomic single-use via conditional compare-and-swap** (`UPDATE … SET state='used' WHERE jti=?
 *    AND state='active'`, requiring `changes===1`) inside `BEGIN IMMEDIATE` — NOT read-then-write.
 *    This guarantees exactly-once consumption even under a concurrent double-refresh (the loser sees
 *    `changes===0` and takes the reuse path), the property-relevant invariant for P-015. Read-then-
 *    write would be the TOCTOU class of N-016.
 */

const crypto = require('node:crypto');
const { FuxaAuthDb } = require('./fuxa-auth-db');

const CREATE_TABLE_SQL =
    'CREATE TABLE IF NOT EXISTS auth_refresh_tokens (' +
    'jti TEXT PRIMARY KEY, ' +
    'family_id TEXT NOT NULL, ' +
    'parent_jti TEXT, ' +
    'username TEXT NOT NULL, ' +
    'token_hash TEXT NOT NULL, ' +
    'issued_at INTEGER NOT NULL, ' +
    'expires_at INTEGER NOT NULL, ' +
    "state TEXT NOT NULL DEFAULT 'active'" +
    ');';
const CREATE_INDEX_SQL =
    'CREATE INDEX IF NOT EXISTS idx_auth_refresh_family ON auth_refresh_tokens(family_id);';

class RefreshTokenStore {
    /**
     * @param {{ db?: FuxaAuthDb, dbFile?: string, workDir?: string, sqlite3?: any }} deps
     *   Provide a ready {@link FuxaAuthDb} (`db`) — the same module-owned connection the user/role
     *   adapters use — or the params to build one.
     */
    constructor(deps) {
        const d = deps || {};
        this.db = d.db || new FuxaAuthDb({ dbFile: d.dbFile, workDir: d.workDir, sqlite3: d.sqlite3 });
        /** @type {Promise<void>|null} */
        this._schemaPromise = null;
    }

    /**
     * SHA-256 (hex) of a refresh-token string — the at-rest form (D-030). High-entropy token ⇒ a fast
     * preimage-resistant hash is the correct at-rest choice; bcrypt is for low-entropy passwords.
     * @param {string} token
     * @returns {string} lowercase hex digest
     */
    static hashToken(token) {
        return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
    }

    /**
     * Instance helper: does `rawToken` match the stored `row.token_hash`? Keeps the hashing detail
     * inside the store so callers (the Token_Service) never touch the algorithm.
     * @param {string} rawToken
     * @param {{ token_hash: string }} row
     * @returns {boolean}
     */
    matches(rawToken, row) {
        return !!row && RefreshTokenStore.hashesMatch(rawToken, row.token_hash);
    }

    /**
     * Constant-time comparison of a presented token against a stored hash (avoids a timing oracle on
     * the hash bytes; the jti lookup already narrows to one row, this confirms the token matches).
     * @param {string} token the presented refresh-token string
     * @param {string} storedHash the stored `token_hash`
     * @returns {boolean}
     */
    static hashesMatch(token, storedHash) {
        if (typeof storedHash !== 'string' || storedHash.length === 0) {
            return false;
        }
        const a = Buffer.from(RefreshTokenStore.hashToken(token), 'hex');
        const b = Buffer.from(storedHash, 'hex');
        if (a.length !== b.length) {
            return false;
        }
        return crypto.timingSafeEqual(a, b);
    }

    /**
     * Create the table + index once (idempotent). Safe to call on every operation.
     * @returns {Promise<void>}
     */
    ensureSchema() {
        if (!this._schemaPromise) {
            this._schemaPromise = this.db.exec(CREATE_TABLE_SQL + ' ' + CREATE_INDEX_SQL);
        }
        return this._schemaPromise;
    }

    /**
     * Persist a new `active` refresh-token family record. `tokenHash` is computed from `rawToken`
     * here so the plaintext never leaves the caller; a duplicate `jti` rejects (PK conflict).
     * @param {string} rawToken the signed refresh-token string (hashed here, not stored raw)
     * @param {{ jti: string, familyId: string, parentJti?: string|null, username: string, issuedAt: number, expiresAt: number }} meta
     * @returns {Promise<void>}
     */
    async insert(rawToken, meta) {
        await this.ensureSchema();
        await this.db.run(
            'INSERT INTO auth_refresh_tokens (jti, family_id, parent_jti, username, token_hash, issued_at, expires_at, state) ' +
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
            [meta.jti, meta.familyId, meta.parentJti || null, meta.username,
                RefreshTokenStore.hashToken(rawToken), meta.issuedAt, meta.expiresAt]
        );
    }

    /**
     * Look up one refresh-token record by its `jti`.
     * @param {string} jti
     * @returns {Promise<{ jti: string, family_id: string, parent_jti: string|null, username: string, token_hash: string, issued_at: number, expires_at: number, state: string }|undefined>}
     */
    async getByJti(jti) {
        await this.ensureSchema();
        const rows = await this.db.all(
            'SELECT jti, family_id, parent_jti, username, token_hash, issued_at, expires_at, state ' +
            'FROM auth_refresh_tokens WHERE jti = ?', [jti]);
        return rows && rows.length ? rows[0] : undefined;
    }

    /**
     * Revoke an entire token family (all tokens → `revoked`). Idempotent. Used on reuse detection,
     * sign-out, password-change, and account disable (D-019).
     * @param {string} familyId
     * @returns {Promise<number>} number of rows transitioned
     */
    async revokeFamily(familyId) {
        await this.ensureSchema();
        const res = await this.db.run(
            "UPDATE auth_refresh_tokens SET state='revoked' WHERE family_id = ? AND state != 'revoked'",
            [familyId]);
        return res.changes;
    }

    /**
     * Atomically consume an `active` token and mint its `active` child in ONE transaction (D-030
     * compare-and-swap). The CAS `UPDATE … WHERE jti=? AND state='active'` is the single-use guard:
     * if it changes exactly one row we won the consume and insert the child; if it changes zero rows
     * the token was NOT active (already used/revoked or a concurrent refresh won), so we DO NOT rotate
     * and report `consumed:false` — the caller then triggers reuse handling.
     * @param {string} oldJti the jti being consumed
     * @param {string} childRawToken the newly-minted child refresh-token string
     * @param {{ jti: string, familyId: string, parentJti: string, username: string, issuedAt: number, expiresAt: number }} childMeta
     * @returns {Promise<{ consumed: boolean }>}
     */
    async consumeAndRotate(oldJti, childRawToken, childMeta) {
        await this.ensureSchema();
        return this.db.transaction(async (db) => {
            const upd = await db.run(
                "UPDATE auth_refresh_tokens SET state='used' WHERE jti = ? AND state = 'active'",
                [oldJti]);
            if (upd.changes !== 1) {
                return { consumed: false }; // lost the race / not active — caller handles reuse
            }
            await db.run(
                'INSERT INTO auth_refresh_tokens (jti, family_id, parent_jti, username, token_hash, issued_at, expires_at, state) ' +
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
                [childMeta.jti, childMeta.familyId, childMeta.parentJti, childMeta.username,
                    RefreshTokenStore.hashToken(childRawToken), childMeta.issuedAt, childMeta.expiresAt]);
            return { consumed: true };
        });
    }

    /**
     * Delete expired records (housekeeping; correctness does not depend on it — an expired refresh
     * JWT is already rejected by signature/expiry verification before any store lookup).
     * @param {number} nowSec current epoch seconds
     * @returns {Promise<number>} rows deleted
     */
    async pruneExpired(nowSec) {
        await this.ensureSchema();
        const res = await this.db.run('DELETE FROM auth_refresh_tokens WHERE expires_at < ?', [nowSec]);
        return res.changes;
    }
}

module.exports = { RefreshTokenStore };
