//@ts-check
'use strict';

/**
 * Authentication_Service — the sign-in decision (design/01-authentication.md · REQ-1).
 *
 * The Service-layer owner of `signIn(credentials) → SignInOutcome`. It is a PURE decision over
 * injected seams — it imports NO `bcryptjs`, NO `jsonwebtoken`, and knows NOTHING of the FUXA row
 * shape (AC-16.2/16.5, D-003). Everything it collaborates with is injected:
 *   - `User_Store.get(username)`        — normalized username-only lookup (D-006; §06 canonical `get`)
 *   - `Password_Hasher.verify(pw, hash)`— the SOLE comparison site (AC-1.5, §03); never `===` on a password
 *   - `Token_Service.issueAccessToken`  — mints the access token on success (REQ-2, §02)
 *   - `BruteForceGuard`                 — checkAllowed / recordFailure / reset (REQ-15, §10)
 *   - `Audit_Logger.record(event)`      — best-effort, non-throwing attempt recording (REQ-14, §09)
 *
 * Decision order (design/01 §3/§7): (1) field-presence FIRST — a malformed request is NOT a
 * credential guess and is not counted; (2) brute-force pre-check → `rate_limited`; (3) store lookup;
 * (4) password compare; (5) success → issue token, reset the guard. Every outcome is a closed value
 * (never throws for control flow) so the decision is deterministic and testable.
 *
 * DV-006 (uniform 401 + no enumeration oracle): an unknown username returns the SAME client-facing
 * outcome as a bad password (`error:'invalid_credentials'`, no token) AND performs a comparable-cost
 * `Password_Hasher.verify` against a dummy hash so the response latency does not reveal whether the
 * account exists. Server-side audit still records the finer `unknown_user` vs `bad_password` — that
 * granularity never reaches the client.
 *
 * D-031 (dummy-hash mechanism): the dummy hash is produced ONCE by the SAME injected
 * `Password_Hasher` (so it carries the same bcrypt cost as real stored hashes) from a random secret,
 * giving true timing parity with the record-found `verify`. See decisions/01-ai-decisions.md D-031.
 *
 * D-027 (active revocation): on success the identity handed to `issueAccessToken` carries
 * `tokenVersion` read from the LIVE record (`metadata.tokenVersion`, default 0) so §05 can revoke.
 */

const crypto = require('node:crypto');
const { serialize } = require('../store/serialization'); // D-044: FUXA-compatible `info` projection

class AuthenticationService {
    /**
     * @param {{
     *   userStore: { get(username: string): Promise<any|undefined> },
     *   passwordHasher: { hash(pw: string): string, verify(pw: string, hash: string): boolean },
     *   tokenService: { issueAccessToken(identity: object): string },
     *   bruteForceGuard: { checkAllowed(username: string): ({allowed:true}|{allowed:false,retryAfterMs:number}), recordFailure(username: string): void, reset(username: string): void },
     *   auditLogger: { record(event: object): void },
     *   authorization?: { isAdministrator(subject: any): Promise<boolean> },
     *   clock?: () => number
     * }} deps
     */
    constructor(deps) {
        const d = deps || {};
        for (const [name, obj, methods] of [
            ['userStore', d.userStore, ['get']],
            ['passwordHasher', d.passwordHasher, ['hash', 'verify']],
            ['tokenService', d.tokenService, ['issueAccessToken']],
            ['bruteForceGuard', d.bruteForceGuard, ['checkAllowed', 'recordFailure', 'reset']],
            ['auditLogger', d.auditLogger, ['record']],
        ]) {
            if (!obj || methods.some((m) => typeof obj[m] !== 'function')) {
                throw new Error('AuthenticationService requires a valid ' + name + ' (' + methods.join('/') + ')');
            }
        }
        this.userStore = d.userStore;
        this.passwordHasher = d.passwordHasher;
        this.tokenService = d.tokenService;
        this.bruteForceGuard = d.bruteForceGuard;
        this.auditLogger = d.auditLogger;
        // OPTIONAL (D-044): the RBAC admin predicate used to project a FUXA-compatible `groups` into
        // the sign-in success body (the SUPERSEDE client bridge). When absent (isolated unit tests)
        // the projection falls back to the record's own `groups`; the composition root injects it.
        this.authorization = d.authorization && typeof d.authorization.isAdministrator === 'function' ? d.authorization : null;
        this.clock = typeof d.clock === 'function' ? d.clock : Date.now;
        /** @type {string|null} cached dummy hash for the DV-006 timing-parity verify (D-031) */
        this._dummyHash = null;
    }

    /**
     * The DV-006 dummy hash: a real `Password_Hasher.hash` of a random secret, computed once and
     * cached, so the unknown-user `verify` costs the same as a record-found `verify` (D-031). Never
     * throws — if hashing is unavailable, returns a non-empty placeholder (the verify result is
     * discarded either way; the parity is best-effort).
     * @returns {string}
     * @private
     */
    _getDummyHash() {
        if (this._dummyHash === null) {
            try {
                this._dummyHash = this.passwordHasher.hash(crypto.randomBytes(24).toString('hex'));
            } catch (_e) {
                this._dummyHash = '$2a$12$0000000000000000000000000000000000000000000000000000';
            }
        }
        return this._dummyHash;
    }

    /**
     * Build + record a secret-free audit event for a sign-in attempt (REQ-14). Best-effort and
     * non-throwing (the logger guarantees this; wrapped defensively regardless). No password/hash is
     * ever passed (AC-14.5 — only the username as `subject` and the outcome).
     * @param {string} username
     * @param {string} outcome
     * @private
     */
    _audit(username, outcome) {
        try {
            this.auditLogger.record({
                category: 'authentication',
                operation: 'signin',
                subject: username,
                outcome,
                timestamp: new Date(this.clock()).toISOString(),
            });
        } catch (_e) {
            // Audit must never affect the sign-in result (§7).
        }
    }

    /**
     * Attempt a sign-in. Resolves to exactly one closed `SignInOutcome`.
     * @param {{ username?: any, password?: any }} credentials
     * @returns {Promise<
     *     { kind:'success', session: { token: string, username: string, fullname: string, roles: string[], groups: number, info: string, mustRotate: boolean } }
     *   | { kind:'missing_field', error:'missing_field', field:'username'|'password' }
     *   | { kind:'unknown_user', error:'invalid_credentials' }
     *   | { kind:'bad_password', error:'invalid_credentials' }
     *   | { kind:'rate_limited', error:'too_many_attempts', retryAfterMs: number }>}
     */
    async signIn(credentials) {
        const req = credentials || {};
        const username = typeof req.username === 'string' ? req.username.trim() : '';
        const password = typeof req.password === 'string' ? req.password : '';

        // (1) Field presence FIRST (AC-1.4, §7): a malformed request is not a credential guess and
        // must NOT be counted by the brute-force guard nor reach the store. Empty/whitespace ⇒ missing.
        if (username === '') {
            return { kind: 'missing_field', error: 'missing_field', field: 'username' };
        }
        if (password.trim() === '') {
            return { kind: 'missing_field', error: 'missing_field', field: 'password' };
        }

        // (2) Brute-force pre-check (AC-15.2/15.3): a throttled username short-circuits to 429
        // WITHOUT touching credentials.
        const decision = this.bruteForceGuard.checkAllowed(username);
        if (!decision.allowed) {
            this._audit(username, 'rate_limited');
            return { kind: 'rate_limited', error: 'too_many_attempts', retryAfterMs: decision.retryAfterMs };
        }

        // (3) Store lookup — ONLY the username reaches the store (D-006; no extra body fields).
        const record = await this.userStore.get(username);

        // (4a) Unknown user (AC-1.2 / DV-006): dummy-hash verify for timing parity (result discarded),
        // count the failure, audit the finer outcome, return the SAME client-facing result as a bad
        // password.
        if (!record) {
            this.passwordHasher.verify(password, this._getDummyHash());
            this.bruteForceGuard.recordFailure(username);
            this._audit(username, 'unknown_user');
            return { kind: 'unknown_user', error: 'invalid_credentials' };
        }

        // (4b) Password compare via the Hash seam (AC-1.5 — the ONLY comparison site). A record with
        // an absent/blank hash cannot authenticate (§7) and is treated as a bad password.
        const storedHash = record.passwordHash;
        const ok = (typeof storedHash === 'string' && storedHash !== '')
            ? this.passwordHasher.verify(password, storedHash)
            : false;
        if (!ok) {
            this.bruteForceGuard.recordFailure(username);
            this._audit(username, 'bad_password');
            return { kind: 'bad_password', error: 'invalid_credentials' };
        }

        // (5) Success (AC-1.1): mint the access token with the LIVE identity incl. tokenVersion
        // (D-027). If issuance fails, the credentials WERE valid but there is no session — do NOT
        // report success; audit the error and rethrow so the API returns 5xx (§7). Do not count it
        // as a credential failure and do not reset the guard (no session was established).
        const roles = Array.isArray(record.roles) ? record.roles : [];
        const identity = {
            username: record.username,
            groups: record.groups,
            roles,
            tokenVersion: Number(record.metadata && record.metadata.tokenVersion) || 0,
        };
        let token;
        try {
            token = this.tokenService.issueAccessToken(identity);
        } catch (e) {
            this._audit(username, 'error');
            throw e;
        }

        this.bruteForceGuard.reset(username); // AC-15.4
        this._audit(username, 'success');
        const session = await this._buildSession(record, token);
        return { kind: 'success', session };
    }

    /**
     * Build the client-facing session shape from a live record + a freshly minted access token
     * (D-044/D-045 projection — SINGLE SOURCE, reused by `signIn` success AND `issueSessionFor` so the
     * two can never diverge, D-047). Projects a FUXA-compatible `groups` (admin ⇒ -1 via the
     * authoritative predicate, else the record's own; D-044), `info=serialize({roles})` (roles only,
     * no metadata leak), the first-class `roles`, and the actionable `mustRotate` flag (D-045).
     * @param {any} record the live User_Record
     * @param {string} token a freshly issued module access token
     * @returns {Promise<{ token: string, username: string, fullname: string, roles: string[], groups: number, info: string, mustRotate: boolean }>}
     * @private
     */
    async _buildSession(record, token) {
        const roles = Array.isArray(record.roles) ? record.roles : [];
        const groups = await this._projectGroups(record);
        const info = serialize({ roles });
        const mustRotate = !!(record.metadata && record.metadata.mustRotate);
        return { token, username: record.username, fullname: record.fullname, roles, groups, info, mustRotate };
    }

    /**
     * Re-issue a session for an ALREADY-authenticated identity (D-047) — used by `/api/heartbeat`'s
     * SUPERSEDE token refresh, NOT a login (there is NO password check here; the caller has already
     * proven identity via a valid token). Reads the LIVE record, mints a fresh module access token
     * stamped with the account's current `tokenVersion` (so the module's D-027 revocation ACCEPTS it,
     * fixing N-082), and returns the same projected session as sign-in via `_buildSession`. Returns
     * `null` when the account no longer exists (caller maps to 401).
     * @param {string} username
     * @returns {Promise<{ token: string, username: string, fullname: string, roles: string[], groups: number, info: string, mustRotate: boolean } | null>}
     */
    async issueSessionFor(username) {
        const name = typeof username === 'string' ? username.trim() : '';
        if (name === '') return null;
        const record = await this.userStore.get(name);
        if (!record) return null;
        const roles = Array.isArray(record.roles) ? record.roles : [];
        const identity = {
            username: record.username,
            groups: record.groups,
            roles,
            tokenVersion: Number(record.metadata && record.metadata.tokenVersion) || 0,
        };
        const token = this.tokenService.issueAccessToken(identity);
        return this._buildSession(record, token);
    }

    /**
     * Project a FUXA-compatible `groups` code for the sign-in success body (D-044). Returns `-1`
     * (FUXA admin group — `jwt-helper.adminGroups`/`ADMINMASK`) when the account is an administrator
     * per the injected `Authorization_Service.isAdministrator` predicate; otherwise the record's own
     * numeric `groups` (or `0`). When no authorization service is injected (isolated unit tests) it
     * falls back to the record's own `groups`. Never throws — a predicate failure degrades to the
     * non-admin/own projection so a valid sign-in is never lost (the bootstrap admin still resolves
     * to `-1` via its own stored `groups`).
     * @param {any} record
     * @returns {Promise<number>}
     * @private
     */
    async _projectGroups(record) {
        const own = typeof record.groups === 'number' ? record.groups : 0;
        if (!this.authorization) {
            return own;
        }
        try {
            if (await this.authorization.isAdministrator(record)) {
                return -1;
            }
        } catch (_e) {
            // fail to the record's own groups; the sign-in itself stays successful.
        }
        return own;
    }
}

module.exports = { AuthenticationService };
