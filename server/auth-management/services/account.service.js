//@ts-check
'use strict';

/**
 * Account_Service — the self-service `account.rotatePassword` operation (design/12 §4 · REQ-17.2/17.3).
 *
 * This is the SOLE operation a not-yet-rotated seeded/migrated administrator may perform while the
 * `mustRotate` gate is armed (§05 §4.2 step 2 permits only `account.rotatePassword`); completing it
 * clears the gate and restores the account's authority (AC-17.3). The operation is a pure decision
 * over the injected `User_Store` + `Password_Hasher` + `Audit_Logger` seams (no HTTP, no clock beyond
 * the audit timestamp). Authorization (that the caller is allowed to reach this at all) is enforced
 * at the API middleware BEFORE this service runs (Task 13); this service only performs the credential
 * change for the authenticated caller's OWN account.
 *
 * Contract (§4.1):
 *   rotatePassword(identity, { currentPassword, newPassword }) →
 *     | { kind:'rotated' }                                              // AC-17.3 (mustRotate cleared)
 *     | { kind:'bad_current', error:'bad_current_password' }            // current secret mismatch — flag NOT cleared
 *     | { kind:'invalid_new', error:'weak_or_reused_password', detail } // policy / reuse guard
 *
 * Guarantees (§4.1):
 *   - verifies the CURRENT secret via `Password_Hasher.verify` (the module's single comparison site);
 *     a mismatch never clears the flag — forcing the legitimate holder of the one-time secret, not an
 *     anonymous caller, to perform the rotation.
 *   - the new secret must DIFFER from the current one and pass the shared password policy (D-034,
 *     `password-policy.js`) — so "rotation" always yields a genuinely new, non-guessable credential.
 *   - on success it re-hashes the new secret (verbatim persist, no double-hash — §06), clears
 *     `metadata.mustRotate`, and **bumps `metadata.tokenVersion`** (D-015/D-027) so every token minted
 *     before the rotation is actively revoked on its next request.
 *   - audits the credential change as a `user.update` event (secret-free — AC-14.2/14.5).
 */

const { validatePasswordPolicyDetailed, resolvePasswordPolicy, PASSWORD_REJECTION_CODES } = require('./password-policy');

class AccountService {
    /**
     * @param {{
     *   userStore: { get(u: string): Promise<any|undefined>, update(u: string, patch: any): Promise<void> },
     *   passwordHasher: { hash(pw: string): string, verify(pw: string, hash: string): boolean },
     *   auditLogger: { record(event: object): void },
     *   settings?: { auth?: { passwordMinLength?: number, passwordBlocklist?: string[] } },
     *   clock?: () => number
     * }} deps
     */
    constructor(deps) {
        const d = deps || {};
        if (!d.userStore || typeof d.userStore.get !== 'function' || typeof d.userStore.update !== 'function') {
            throw new Error('AccountService requires a userStore with get/update');
        }
        if (!d.passwordHasher || typeof d.passwordHasher.hash !== 'function' || typeof d.passwordHasher.verify !== 'function') {
            throw new Error('AccountService requires a passwordHasher with hash/verify');
        }
        if (!d.auditLogger || typeof d.auditLogger.record !== 'function') {
            throw new Error('AccountService requires an auditLogger');
        }
        this.userStore = d.userStore;
        this.passwordHasher = d.passwordHasher;
        this.auditLogger = d.auditLogger;
        this.passwordPolicy = resolvePasswordPolicy(d.settings); // single-source policy (D-034)
        this.clock = typeof d.clock === 'function' ? d.clock : Date.now;
    }

    /**
     * Replace the effective password policy at runtime (D-049). Accepts an already-resolved
     * `{ minLength, blocklist:Set }` (single-source with User_Service). Ignored if invalid. Takes
     * effect on the NEXT rotatePassword; non-retroactive.
     * @param {{ minLength: number, blocklist: Set<string> }} policy
     * @returns {void}
     */
    setPasswordPolicy(policy) {
        if (policy && typeof policy.minLength === 'number' && policy.blocklist instanceof Set) {
            this.passwordPolicy = policy;
        }
    }

    /** @param {string} operation @param {string} subject @param {string} outcome @private */
    _audit(operation, subject, outcome) {
        try {
            this.auditLogger.record({
                category: 'user',
                operation,
                subject: String(subject),
                outcome,
                timestamp: new Date(this.clock()).toISOString(),
            });
        } catch (_e) { /* audit never affects the outcome (§09) */ }
    }

    /**
     * Rotate the authenticated caller's own password (§4.1). `identity.username` names the account.
     * @param {{ username?: string }} identity the authenticated caller's identity (from the middleware)
     * @param {{ currentPassword?: string, newPassword?: string }} req
     * @returns {Promise<{kind:'rotated'}|{kind:'bad_current',error:'bad_current_password'}|{kind:'invalid_new',error:'weak_or_reused_password',detail:string}>}
     */
    async rotatePassword(identity, req) {
        const username = identity && typeof identity.username === 'string' ? identity.username : '';
        const r = req || {};
        const currentPassword = r.currentPassword;
        const newPassword = r.newPassword;

        // Load the caller's own record. A missing account or blank stored hash cannot authenticate a
        // rotation → treated as a current-secret mismatch (never clears any flag).
        const rec = username ? await this.userStore.get(username) : undefined;
        if (!rec || typeof rec.passwordHash !== 'string' || rec.passwordHash === '') {
            return { kind: 'bad_current', error: 'bad_current_password' };
        }

        // Verify the CURRENT secret (single comparison site). A mismatch does NOT clear the gate.
        if (typeof currentPassword !== 'string' || !this.passwordHasher.verify(currentPassword, rec.passwordHash)) {
            this._audit('user.update', username, 'bad_current');
            return { kind: 'bad_current', error: 'bad_current_password' };
        }

        // The new secret must differ from the current one (no-op "rotation" would leave the one-time
        // secret usable) and pass the shared password policy (D-034).
        if (typeof newPassword !== 'string' || newPassword === '') {
            // D-051: `detail` unchanged; `detailCode`/`detailParams` added for a translatable UI message.
            return {
                kind: 'invalid_new', error: 'weak_or_reused_password', detail: 'new password is required',
                detailCode: PASSWORD_REJECTION_CODES.required, detailParams: {},
            };
        }
        if (newPassword === currentPassword) {
            return {
                kind: 'invalid_new', error: 'weak_or_reused_password',
                detail: 'new password must differ from the current password',
                detailCode: 'password_reused', detailParams: {},
            };
        }
        const rejection = validatePasswordPolicyDetailed(newPassword, this.passwordPolicy);
        if (rejection) {
            return {
                kind: 'invalid_new', error: 'weak_or_reused_password', detail: rejection.message,
                detailCode: rejection.code, detailParams: rejection.params,
            };
        }

        // Persist: new hash (verbatim, no double-hash), clear the gate, and bump tokenVersion so
        // pre-rotation tokens are actively revoked (D-015/D-027).
        const passwordHash = this.passwordHasher.hash(newPassword);
        const baseMeta = rec.metadata && typeof rec.metadata === 'object' && !Array.isArray(rec.metadata) ? rec.metadata : {};
        const nextTokenVersion = (Number(baseMeta.tokenVersion) || 0) + 1;
        const metadata = { ...baseMeta, mustRotate: false, tokenVersion: nextTokenVersion };
        await this.userStore.update(username, { passwordHash, metadata });
        this._audit('user.update', username, 'rotated');
        return { kind: 'rotated' };
    }
}

module.exports = { AccountService };
