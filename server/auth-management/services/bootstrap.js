//@ts-check
'use strict';

/**
 * Administrator bootstrap routine (design/12-admin-bootstrap.md · REQ-17). Run ONCE at module
 * startup by the composition root (Task 13). It brings the `User_Store` to a safe resting state:
 * seed exactly one administrator when none exists (AC-17.1), retain existing admins otherwise
 * (AC-17.4), and — MANDATORY (D-013(1)/DEF-B1) — remediate any known-default (`'123456'`) admin so
 * the FUXA weakness (N-007) can never survive an upgrade.
 *
 * It orchestrates injected Service/Store collaborators and holds no persistence logic of its own
 * (§1.1). Two verified divergences from FUXA drive the design: the seed trigger is a CONTENT-based
 * empty-admin check (not FUXA's file-existence check), and the seeded credential is a CSPRNG one-time
 * secret with a `mustRotate` gate (not FUXA's literal `'123456'` with no rotation).
 *
 * SECURITY INVARIANTS:
 *   - The seed/remediation credential is a fresh CSPRNG one-time secret; the store keeps only its
 *     hash (cost per the injected Password_Hasher, D-008). The seeded/migrated record never verifies
 *     `'123456'` (§10.3).
 *   - `metadata.mustRotate = true` arms the §05 gate so the account can do nothing but rotate.
 *   - The one-time secret is delivered EXACTLY ONCE via the injected `EnrollmentChannel.deliver(...)`
 *     seam and is NEVER logged, never returned from `runBootstrap`, never persisted in plaintext
 *     (D-022, fixes N-018). This routine calls no logger with the secret.
 *   - Migration MUST re-hash a detected known-default admin to a fresh unknown secret (DEF-B1): a
 *     gate alone would leave the hostile-rotation takeover path open because `'123456'` is known.
 */

const crypto = require('node:crypto');

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_FULLNAME = 'Administrator Account';
const FUXA_ADMIN_GROUP_CODE = -1;        // §05 §5.3 groupCodeAdmin ⇒ admin without a pre-existing RBAC role
const KNOWN_DEFAULT_PASSWORD = '123456'; // verified FUXA seed (N-007)

/**
 * Generate a CSPRNG one-time secret. base64url is well-formed Unicode (no lone surrogates) and short
 * (32 chars for 24 bytes), so it is well within the ≤72-byte hash domain (AC-4.6).
 * @returns {string}
 */
function generateOneTimeSecret() {
    return crypto.randomBytes(24).toString('base64url');
}

class Bootstrap {
    /**
     * @param {{
     *   userStore: { readAll(): Promise<{records:any[],errors:any[]}>, create(record: any): Promise<void>, update(u: string, patch: any): Promise<void> },
     *   authorization: { isAdministrator(subject: any): Promise<boolean> },
     *   passwordHasher: { hash(pw: string): string, verify(pw: string, hash: string): boolean },
     *   auditLogger: { record(event: object): void },
     *   enrollmentChannel: { deliver(info: { username: string, secret: string, reason: string }): Promise<void>|void },
     *   settings?: { auth?: { bootstrapAdminUsername?: string } },
     *   clock?: () => number,
     *   generateSecret?: () => string
     * }} deps
     */
    constructor(deps) {
        const d = deps || {};
        for (const m of ['readAll', 'create', 'update']) {
            if (!d.userStore || typeof d.userStore[m] !== 'function') {
                throw new Error('Bootstrap requires a userStore with ' + m + '()');
            }
        }
        if (!d.authorization || typeof d.authorization.isAdministrator !== 'function') {
            throw new Error('Bootstrap requires an authorization service with isAdministrator()');
        }
        if (!d.passwordHasher || typeof d.passwordHasher.hash !== 'function' || typeof d.passwordHasher.verify !== 'function') {
            throw new Error('Bootstrap requires a passwordHasher with hash/verify');
        }
        if (!d.auditLogger || typeof d.auditLogger.record !== 'function') {
            throw new Error('Bootstrap requires an auditLogger');
        }
        if (!d.enrollmentChannel || typeof d.enrollmentChannel.deliver !== 'function') {
            throw new Error('Bootstrap requires an enrollmentChannel with deliver() (secure, non-log — D-022)');
        }
        this.userStore = d.userStore;
        this.authorization = d.authorization;
        this.passwordHasher = d.passwordHasher;
        this.auditLogger = d.auditLogger;
        this.enrollmentChannel = d.enrollmentChannel;
        const auth = (d.settings && d.settings.auth) || {};
        this.adminUsername = typeof auth.bootstrapAdminUsername === 'string' && auth.bootstrapAdminUsername.trim() !== ''
            ? auth.bootstrapAdminUsername.trim() : DEFAULT_ADMIN_USERNAME;
        this.clock = typeof d.clock === 'function' ? d.clock : Date.now;
        this.generateSecret = typeof d.generateSecret === 'function' ? d.generateSecret : generateOneTimeSecret;
    }

    /**
     * The startup entry point. Content-based empty-admin check → seed one (AC-17.1) or retain +
     * mandatory known-default remediation (AC-17.4 / §8). Idempotent across restarts.
     * @returns {Promise<{kind:'seeded',username:string}|{kind:'retained',remediated:string[]}>}
     */
    async run() {
        const { records } = await this.userStore.readAll();
        const flags = await Promise.all(records.map((r) => this.authorization.isAdministrator(r)));
        const admins = records.filter((_r, i) => flags[i]);

        if (admins.length === 0) {
            const username = await this._seedDefaultAdministrator();
            return { kind: 'seeded', username };
        }
        const remediated = await this._remediateKnownDefaultAdmins(admins);
        return { kind: 'retained', remediated };
    }

    /**
     * Seed EXACTLY one default administrator with a CSPRNG one-time secret + armed gate (AC-17.1).
     * @returns {Promise<string>} the seeded username
     * @private
     */
    async _seedDefaultAdministrator() {
        const username = this.adminUsername;
        const secret = this.generateSecret();
        const passwordHash = this.passwordHasher.hash(secret); // store keeps only the hash
        await this.userStore.create({
            username,
            fullname: DEFAULT_ADMIN_FULLNAME,
            passwordHash,
            groups: FUXA_ADMIN_GROUP_CODE, // ⇒ isAdministrator via groupCodeAdmin(-1) on an empty store
            roles: [],
            metadata: { mustRotate: true },
        });
        // AC-17.5: record the seeding (secret-free by construction).
        this._audit('bootstrap.seed', 'seed', username, 'seeded');
        // D-022: deliver the one-time secret ONCE via the secure channel — NEVER logged/returned.
        await this.enrollmentChannel.deliver({ username, secret, reason: 'seed' });
        return username;
    }

    /**
     * MANDATORY remediation of a known-default admin (§8, D-013(1)/DEF-B1). For each administrator
     * that is NOT already gated and whose stored hash verifies `'123456'`, re-hash to a fresh unknown
     * secret AND arm the gate — the re-hash is security-NECESSARY (a gate alone leaves the known
     * `'123456'` usable for a hostile self-rotation takeover, §3.2). Creates no new admin (AC-17.4).
     * @param {any[]} admins
     * @returns {Promise<string[]>} the usernames remediated
     * @private
     */
    async _remediateKnownDefaultAdmins(admins) {
        const remediated = [];
        for (const a of admins) {
            const alreadyGated = !!(a.metadata && a.metadata.mustRotate === true);
            if (alreadyGated) {
                continue; // a freshly seeded / already-remediated admin — leave it (idempotent)
            }
            if (!this.passwordHasher.verify(KNOWN_DEFAULT_PASSWORD, a.passwordHash)) {
                continue; // not a known-default credential — retain unchanged (AC-17.4)
            }
            const secret = this.generateSecret();
            const passwordHash = this.passwordHasher.hash(secret);
            const baseMeta = a.metadata && typeof a.metadata === 'object' && !Array.isArray(a.metadata) ? a.metadata : {};
            // Re-hash to an unknown secret + arm the gate (DEF-B1). Bump tokenVersion for good measure
            // (any pre-existing token for this legacy account is invalidated).
            const metadata = { ...baseMeta, mustRotate: true, tokenVersion: (Number(baseMeta.tokenVersion) || 0) + 1 };
            await this.userStore.update(a.username, { passwordHash, metadata });
            // §6/§8: the migration credential-gate change is recorded AS A `user.update` (category
            // 'user', operation 'user.update') — consistent with User_Service/Account_Service audits;
            // `bootstrap.seed` is reserved for the empty-store seed branch only.
            this._audit('user', 'user.update', a.username, 'forced_rotation');
            await this.enrollmentChannel.deliver({ username: a.username, secret, reason: 'migration' });
            remediated.push(a.username);
        }
        return remediated;
    }

    /** @param {string} category @param {string} operation @param {string} subject @param {string} outcome @private */
    _audit(category, operation, subject, outcome) {
        try {
            this.auditLogger.record({
                category,
                operation,
                subject: String(subject),
                outcome,
                timestamp: new Date(this.clock()).toISOString(),
            });
        } catch (_e) { /* audit never blocks the seed/remediation (§6 / §09) */ }
    }
}

/**
 * Functional entry point matching the design's `runBootstrap(deps)` (§1.1/§3.1).
 * @param {ConstructorParameters<typeof Bootstrap>[0]} deps
 * @returns {Promise<{kind:'seeded',username:string}|{kind:'retained',remediated:string[]}>}
 */
async function runBootstrap(deps) {
    return new Bootstrap(deps).run();
}

module.exports = { Bootstrap, runBootstrap, generateOneTimeSecret, KNOWN_DEFAULT_PASSWORD, DEFAULT_ADMIN_USERNAME };
