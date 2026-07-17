//@ts-check
'use strict';

/**
 * User_Service — user account CRUD (design/04-user-management.md · REQ-5/6/7/8).
 *
 * Service-layer owner of `create`/`list`/`get`/`update`/`delete` over the injected `User_Store` +
 * `Password_Hasher` + `Authorization_Service` (admin predicate, §05) + `Audit_Logger`
 * (AC-16.2/16.5, D-003 — no FUXA row-shape knowledge here). Each operation returns a closed
 * outcome the API layer maps to HTTP (§8.2). Decisions are pure over the injected seams: no SQL, no
 * clock beyond the injected audit timestamp, no HTTP knowledge (AC-16.3).
 *
 * Key design points (validated against §04 before coding, N-037):
 *   - Hashing happens HERE, upstream of the store (AC-5.4/AC-7.2); the adapter receives an
 *     already-hashed value and never sees plaintext (§3.3). Plaintext is never forwarded to the
 *     store nor placed in any returned `UserView` (AC-6.2) or audit event (AC-14.5).
 *   - **Password policy (AC-4.6/AC-4.7, D-017/DV-007, D-034):** on create and on password-bearing
 *     update the plaintext is validated BEFORE hashing — reject >72 UTF-8 bytes (AC-4.6, so bcrypt's
 *     72-byte truncation cannot equate two distinct passwords, N-012), shorter than the configured
 *     minimum (default 12 characters), or on the configured common-password blocklist (AC-4.7).
 *     Malformed UTF-16 (lone surrogate) is also rejected at this boundary (D-025 defense-in-depth;
 *     the hasher is the backstop). These rejections make NO store mutation (AC-5.3/AC-7.5 spirit).
 *   - **Create outcome set (DEF-U2, N-037):** `create` returns `invalid`/`validation_error` for a
 *     password-policy failure or an omitted/blank password (§2.3/§8.1), in addition to
 *     `created`/`missing_field`/`duplicate`.
 *   - **Delete last-admin guard (AC-8.5, D-020/D-033):** `delete` delegates the WHOLE
 *     existence→classify→count→conditional-remove critical section to the ATOMIC
 *     `User_Store.deleteGuarded(username, isAdministratorFn)` (one `BEGIN IMMEDIATE` transaction on
 *     the adapter's connection), passing the §05 `isAdministrator` predicate as a pure callback. The
 *     service performs no SQL/transaction itself (AC-16.3); the transaction — not a service-level
 *     pre-check — is the authority (closes the N-016 TOCTOU; P-016).
 */

const {
    validatePasswordPolicy,
    resolvePasswordPolicy,
    DEFAULT_PASSWORD_MIN_LENGTH,
    DEFAULT_PASSWORD_BLOCKLIST,
    BCRYPT_MAX_UTF8_BYTES,
} = require('./password-policy');

class UserService {
    /**
     * @param {{
     *   userStore: {
     *     get(u: string): Promise<any|undefined>,
     *     readAll(): Promise<{records:any[],errors:any[]}>,
     *     create(record: any): Promise<void>,
     *     update(u: string, patch: any): Promise<void>,
     *     delete(u: string): Promise<void>,
     *     deleteGuarded(u: string, isAdminFn: (rec:any)=>Promise<boolean>): Promise<{kind:string}>
     *   },
     *   passwordHasher: { hash(plaintext: string): string },
     *   authorization: { isAdministrator(subject: any): Promise<boolean> },
     *   auditLogger: { record(event: object): void },
     *   settings?: { auth?: { passwordMinLength?: number, passwordBlocklist?: string[] } },
     *   clock?: () => number
     * }} deps
     */
    constructor(deps) {
        const d = deps || {};
        for (const m of ['get', 'readAll', 'create', 'update', 'delete', 'deleteGuarded']) {
            if (!d.userStore || typeof d.userStore[m] !== 'function') {
                throw new Error('UserService requires a userStore with ' + m + '()');
            }
        }
        if (!d.passwordHasher || typeof d.passwordHasher.hash !== 'function') {
            throw new Error('UserService requires a passwordHasher with hash()');
        }
        if (!d.authorization || typeof d.authorization.isAdministrator !== 'function') {
            throw new Error('UserService requires an authorization service with isAdministrator()');
        }
        if (!d.auditLogger || typeof d.auditLogger.record !== 'function') {
            throw new Error('UserService requires an auditLogger');
        }
        this.userStore = d.userStore;
        this.passwordHasher = d.passwordHasher;
        this.authorization = d.authorization;
        this.auditLogger = d.auditLogger;
        // Single-source password policy (D-034), shared with Account_Service via password-policy.js.
        this.passwordPolicy = resolvePasswordPolicy(d.settings);
        this.clock = typeof d.clock === 'function' ? d.clock : Date.now;
    }

    /**
     * Replace the effective password policy at runtime (D-049). Accepts an already-resolved
     * `{ minLength, blocklist:Set }` (produced by `resolvePasswordPolicy`) so both enforcement sites
     * (User_Service + Account_Service) stay single-source. Ignored if not a valid resolved policy.
     * Takes effect on the NEXT create/update; existing users are unaffected (non-retroactive).
     * @param {{ minLength: number, blocklist: Set<string> }} policy
     * @returns {void}
     */
    setPasswordPolicy(policy) {
        if (policy && typeof policy.minLength === 'number' && policy.blocklist instanceof Set) {
            this.passwordPolicy = policy;
        }
    }

    /**
     * @param {string} operation @param {string} subject @param {string} outcome @private
     */
    _audit(operation, subject, outcome) {
        try {
            this.auditLogger.record({
                category: 'user',
                operation,
                subject: String(subject),
                outcome,
                timestamp: new Date(this.clock()).toISOString(),
            });
        } catch (_e) { /* audit never affects the outcome (§8.1 / §09) */ }
    }

    /**
     * Validate a plaintext password against the policy (AC-4.6/AC-4.7 + D-025). Returns an error
     * detail string, or null when acceptable. Never hashes; never mutates.
     * @param {any} plaintext
     * @returns {string|null}
     * @private
     */
    _validatePassword(plaintext) {
        return validatePasswordPolicy(plaintext, this.passwordPolicy); // single-source (D-034)
    }

    /**
     * Validate submitted `roles`/`metadata` shape (used by create + update). Returns an error detail
     * or null. `roles` must be an array of strings; `metadata` an object without a top-level `roles`
     * key (the reserved-key invariant INV-1, kept first-class by D-007).
     * @param {{ roles?: any, metadata?: any }} fields
     * @returns {string|null}
     * @private
     */
    _validateFields(fields) {
        if (fields.roles !== undefined) {
            if (!Array.isArray(fields.roles) || fields.roles.some((r) => typeof r !== 'string')) {
                return 'roles must be an array of role-id strings';
            }
        }
        if (fields.metadata !== undefined) {
            const m = fields.metadata;
            if (m === null || typeof m !== 'object' || Array.isArray(m)) {
                return 'metadata must be an object';
            }
            if (Object.prototype.hasOwnProperty.call(m, 'roles')) {
                return 'metadata must not carry a top-level `roles` key (roles are first-class)';
            }
        }
        return null;
    }

    /**
     * Build a hash-free `UserView` (AC-6.2) from a domain record's fields.
     * @param {{ username: string, fullname?: string, roles?: string[], metadata?: object }} r
     * @returns {{ username: string, fullname: string, roles: string[], metadata: object }}
     * @private
     */
    _view(r) {
        return {
            username: r.username,
            fullname: typeof r.fullname === 'string' ? r.fullname : '',
            roles: Array.isArray(r.roles) ? r.roles : [],
            metadata: r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? r.metadata : {},
        };
    }

    /**
     * Create a user (AC-5.1). Order: shape (username) → password policy → field shape → duplicate
     * pre-check → hash → persist (atomic dup at the store). No plaintext reaches the store.
     * @param {{ username?: string, fullname?: string, password?: string, roles?: string[], metadata?: object }} req
     * @returns {Promise<{kind:'created',user:any}|{kind:'missing_field',error:'missing_field',field:'username'}|{kind:'duplicate',error:'duplicate_username',username:string}|{kind:'invalid',error:'validation_error',detail:string}>}
     */
    async create(req) {
        const r = req || {};
        const username = typeof r.username === 'string' ? r.username.trim() : '';
        if (!username) {
            return { kind: 'missing_field', error: 'missing_field', field: 'username' };
        }
        const pwDetail = this._validatePassword(r.password); // AC-4.6/4.7 + omitted password (§8.1)
        if (pwDetail) {
            return { kind: 'invalid', error: 'validation_error', detail: pwDetail };
        }
        const fieldDetail = this._validateFields(r);
        if (fieldDetail) {
            return { kind: 'invalid', error: 'validation_error', detail: fieldDetail };
        }

        // Non-authoritative friendly fast-path (the store's plain INSERT is the real guard, §3.2).
        const existing = await this.userStore.get(username);
        if (existing) {
            return { kind: 'duplicate', error: 'duplicate_username', username };
        }

        const passwordHash = this.passwordHasher.hash(/** @type {string} */(r.password));
        const roles = Array.isArray(r.roles) ? r.roles.slice() : [];
        const metadata = r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? r.metadata : {};
        const record = { username, fullname: typeof r.fullname === 'string' ? r.fullname : '', passwordHash, roles, metadata };
        try {
            await this.userStore.create(record); // plain INSERT → atomic duplicate rejection (D-020)
        } catch (e) {
            if (e && e.code === 'duplicate_key') {
                return { kind: 'duplicate', error: 'duplicate_username', username };
            }
            throw e; // unexpected store error → surfaced to the API (5xx)
        }
        this._audit('user.create', username, 'success');
        return { kind: 'created', user: this._view(record) };
    }

    /**
     * List every stored user as a hash-free `UserView` (AC-6.1/6.2). Corrupt rows are isolated by the
     * store's resilient `readAll` and excluded (AC-13.4).
     * @returns {Promise<{kind:'ok',users:any[]}>}
     */
    async list() {
        const { records } = await this.userStore.readAll();
        return { kind: 'ok', users: records.map((r) => this._view(r)) };
    }

    /**
     * Get one user (AC-6.3); a missing username is an EMPTY result, not an error (AC-6.4).
     * @param {string} username
     * @returns {Promise<{kind:'found',user:any}|{kind:'empty'}>}
     */
    async get(username) {
        const u = typeof username === 'string' ? username.trim() : '';
        if (!u) return { kind: 'empty' };
        const rec = await this.userStore.get(u);
        if (!rec) return { kind: 'empty' };
        return { kind: 'found', user: this._view(rec) };
    }

    /**
     * Update a user (AC-7.1/7.2/7.3). Existence check → validate → (re-hash | retain) → apply. No
     * write on a missing target (AC-7.4) or a failed validation (AC-7.5).
     * @param {string} username
     * @param {{ fullname?: string, roles?: string[], metadata?: object, password?: string }} req
     * @returns {Promise<{kind:'updated',user:any}|{kind:'unknown_user',error:'user_not_found',username:string}|{kind:'invalid',error:'validation_error',detail:string}>}
     */
    async update(username, req) {
        const u = typeof username === 'string' ? username.trim() : '';
        const r = req || {};
        if (!u) {
            return { kind: 'unknown_user', error: 'user_not_found', username: u };
        }
        const existing = await this.userStore.get(u);
        if (!existing) {
            return { kind: 'unknown_user', error: 'user_not_found', username: u };
        }
        const fieldDetail = this._validateFields(r);
        if (fieldDetail) {
            return { kind: 'invalid', error: 'validation_error', detail: fieldDetail };
        }
        const hasPassword = r.password !== undefined;
        if (hasPassword) {
            const pwDetail = this._validatePassword(r.password); // AC-4.6/4.7 + D-025
            if (pwDetail) {
                return { kind: 'invalid', error: 'validation_error', detail: pwDetail };
            }
        }

        /** @type {any} */
        const patch = {};
        if (r.fullname !== undefined) patch.fullname = r.fullname;
        if (r.roles !== undefined) patch.roles = r.roles.slice();
        if (r.metadata !== undefined) patch.metadata = r.metadata;
        if (hasPassword) patch.passwordHash = this.passwordHasher.hash(/** @type {string} */(r.password));

        await this.userStore.update(u, patch); // retain-on-omit when passwordHash absent (AC-7.3)
        this._audit('user.update', u, 'success');
        const view = this._view({
            username: u,
            fullname: patch.fullname !== undefined ? patch.fullname : existing.fullname,
            roles: patch.roles !== undefined ? patch.roles : existing.roles,
            metadata: patch.metadata !== undefined ? patch.metadata : existing.metadata,
        });
        return { kind: 'updated', user: view };
    }

    /**
     * Delete a user (AC-8.1/8.2/8.3/8.5). Delegates the whole existence→last-admin-guard→remove
     * critical section to the ATOMIC `User_Store.deleteGuarded` (D-020/D-033), passing the §05
     * `isAdministrator` predicate. The transaction — not a service pre-check — is the authority.
     * @param {string} username
     * @returns {Promise<{kind:'deleted'}|{kind:'unknown_user',error:'user_not_found',username:string}|{kind:'last_admin',error:'last_admin',username:string}>}
     */
    async delete(username) {
        const u = typeof username === 'string' ? username.trim() : '';
        if (!u) {
            return { kind: 'unknown_user', error: 'user_not_found', username: u };
        }
        const outcome = await this.userStore.deleteGuarded(u, (rec) => this.authorization.isAdministrator(rec));
        if (outcome.kind === 'deleted') {
            this._audit('user.delete', u, 'success');
            return { kind: 'deleted' };
        }
        if (outcome.kind === 'last_admin') {
            return { kind: 'last_admin', error: 'last_admin', username: u };
        }
        return { kind: 'unknown_user', error: 'user_not_found', username: u };
    }
}

module.exports = { UserService, DEFAULT_PASSWORD_MIN_LENGTH, DEFAULT_PASSWORD_BLOCKLIST, BCRYPT_MAX_UTF8_BYTES };
