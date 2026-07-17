//@ts-check
'use strict';

/**
 * AuthConfigService — the runtime auth-configuration brain (D-049, design/13-runtime-config.md).
 * Task D-049.2 (Phase 1: daily-policy surface — password policy, brute-force, token TTLs, bcryptCost).
 *
 * Responsibilities:
 *   - `getEffective()`  — resolve effective config = DEFAULTS ◁ settings.js BASELINE ◁ DB OVERRIDE.
 *   - `validate(patch)` — strict, bounded validation (P-018); returns errors, mutates nothing.
 *   - `apply(patch, actor)` — validate → persist override → LIVE-apply to services → audit. Atomic on
 *     failure (invalid ⇒ nothing persisted/applied). No restart, no router remount.
 *   - `init()` — at composition/startup, overlay the persisted override onto the (baseline-built)
 *     services so a restart honors the runtime override too.
 *   - `resetToDefaults(actor)` — drop the override row → next resolve falls back to baseline/defaults.
 *
 * Boundary: pure orchestration over injected seams — the AuthConfigStore + the live service handles
 * (tokenService/bruteForceGuard/passwordHasher + user/account services). It performs no SQL and no
 * HTTP (AC-16.3). Touches NO FUXA core (D-003). Phase-1 scope EXCLUDES jwt iss/aud/alg (Phase 3) and
 * secretCode/authModuleEnabled (secure/restart path).
 */

const {
    resolvePasswordPolicy,
    DEFAULT_PASSWORD_MIN_LENGTH,
    DEFAULT_PASSWORD_BLOCKLIST,
} = require('./password-policy');

/** Hardcoded safe defaults (mirror the service DEFAULT_* so a bare deployment is well-defined). */
const CONFIG_DEFAULTS = Object.freeze({
    passwordMinLength: DEFAULT_PASSWORD_MIN_LENGTH,        // 12
    passwordBlocklist: DEFAULT_PASSWORD_BLOCKLIST.slice(), // built-in list
    bruteForce: {
        threshold: 5,
        baseThrottleMs: 30 * 1000,
        backoffFactor: 2,
        maxThrottleMs: 15 * 60 * 1000,
        failureWindowMs: 0,
    },
    tokenExpiresIn: '1h',
    refreshTokenExpiresIn: '7d',
    bcryptCost: 12, // D-008
});

/** Validation bounds (design/13 §5). */
const BOUNDS = Object.freeze({
    passwordMinLength: { min: 8, max: 128 },
    bcryptCost: { min: 10, max: 15 }, // >= FUXA's 10 (D-008); capped to avoid a login-CPU DoS
    blocklistMaxEntries: 5000,
    blocklistMaxEntryLen: 256,
});

// Duration = a positive number of seconds, or an `ms`-style string ('1h','7d','60','30 minutes').
const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks|year|years)?$/i;

/**
 * Is `v` a valid positive token-duration (number of seconds, or a duration string)?
 * @param {any} v
 * @returns {boolean}
 */
function isValidDuration(v) {
    if (typeof v === 'number') {
        return Number.isFinite(v) && v > 0;
    }
    if (typeof v === 'string') {
        const s = v.trim();
        if (s === '') return false;
        const m = DURATION_RE.exec(s);
        if (!m) return false;
        return parseFloat(m[1]) > 0;
    }
    return false;
}

/** Deep-ish merge for the flat config shape (bruteForce merged per-key). @private */
function mergeConfig(base, over) {
    const b = base || {};
    const o = over || {};
    const out = {
        passwordMinLength: o.passwordMinLength !== undefined ? o.passwordMinLength : b.passwordMinLength,
        passwordBlocklist: o.passwordBlocklist !== undefined ? o.passwordBlocklist : b.passwordBlocklist,
        tokenExpiresIn: o.tokenExpiresIn !== undefined ? o.tokenExpiresIn : b.tokenExpiresIn,
        refreshTokenExpiresIn: o.refreshTokenExpiresIn !== undefined ? o.refreshTokenExpiresIn : b.refreshTokenExpiresIn,
        bcryptCost: o.bcryptCost !== undefined ? o.bcryptCost : b.bcryptCost,
        bruteForce: Object.assign({}, b.bruteForce || {}, o.bruteForce || {}),
    };
    return out;
}

class AuthConfigService {
    /**
     * @param {{
     *   store: { get(): Promise<any>, put(c: object): Promise<any>, clear(): Promise<number> },
     *   baseline?: object,          // settings.js-derived baseline (auth.* + token TTLs)
     *   auditLogger?: { record(e: object): void },
     *   services: {
     *     tokenService: { reconfigure(patch: object): void },
     *     bruteForceGuard: { reconfigure(cfg: object): void },
     *     passwordHasher: { setCost(n: number): void },
     *     userService: { setPasswordPolicy(p: object): void },
     *     accountService: { setPasswordPolicy(p: object): void }
     *   },
     *   clock?: () => number
     * }} deps
     */
    constructor(deps) {
        const d = deps || {};
        if (!d.store || typeof d.store.get !== 'function' || typeof d.store.put !== 'function') {
            throw new Error('AuthConfigService requires a store with get/put/clear');
        }
        const s = d.services || {};
        for (const [name, m] of [['tokenService', 'reconfigure'], ['bruteForceGuard', 'reconfigure'],
            ['passwordHasher', 'setCost'], ['userService', 'setPasswordPolicy'], ['accountService', 'setPasswordPolicy']]) {
            if (!s[name] || typeof s[name][m] !== 'function') {
                throw new Error('AuthConfigService requires services.' + name + ' with ' + m + '()');
            }
        }
        this.store = d.store;
        this.services = s;
        this.auditLogger = d.auditLogger || { record: () => {} };
        this.clock = typeof d.clock === 'function' ? d.clock : Date.now;
        // Baseline from settings.js, itself layered over defaults (missing baseline keys → defaults).
        this.baseline = mergeConfig(CONFIG_DEFAULTS, this._normalizeBaseline(d.baseline));
    }

    /** Normalize a settings.js-derived baseline into the config shape. @private */
    _normalizeBaseline(baseline) {
        const b = baseline || {};
        const auth = b.auth || {};
        /** @type {any} */
        const out = {};
        if (auth.passwordMinLength !== undefined) out.passwordMinLength = auth.passwordMinLength;
        if (auth.passwordBlocklist !== undefined) out.passwordBlocklist = auth.passwordBlocklist;
        if (auth.bcryptCost !== undefined) out.bcryptCost = auth.bcryptCost;
        if (auth.bruteForce !== undefined) out.bruteForce = auth.bruteForce;
        if (b.tokenExpiresIn !== undefined) out.tokenExpiresIn = b.tokenExpiresIn;
        if (b.refreshTokenExpiresIn !== undefined) out.refreshTokenExpiresIn = b.refreshTokenExpiresIn;
        return out;
    }

    /**
     * Resolve the effective config: defaults ◁ baseline ◁ persisted override.
     * @returns {Promise<object>}
     */
    async getEffective() {
        const stored = await this.store.get();
        const override = stored && stored.config ? stored.config : {};
        return mergeConfig(this.baseline, override);
    }

    /**
     * Strict, bounded validation of a PARTIAL patch (only provided keys checked). Returns
     * `{ ok, errors }`; never mutates, never persists (P-018). Unknown keys are rejected so a typo
     * can't silently no-op.
     * @param {object} patch
     * @returns {{ ok: boolean, errors: string[] }}
     */
    validate(patch) {
        const errors = [];
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            return { ok: false, errors: ['config must be an object'] };
        }
        const allowed = new Set(['passwordMinLength', 'passwordBlocklist', 'bruteForce', 'tokenExpiresIn', 'refreshTokenExpiresIn', 'bcryptCost']);
        for (const k of Object.keys(patch)) {
            if (!allowed.has(k)) errors.push('unknown field: ' + k);
        }
        if (patch.passwordMinLength !== undefined) {
            const v = patch.passwordMinLength;
            if (!Number.isInteger(v) || v < BOUNDS.passwordMinLength.min || v > BOUNDS.passwordMinLength.max) {
                errors.push('passwordMinLength must be an integer in [' + BOUNDS.passwordMinLength.min + ',' + BOUNDS.passwordMinLength.max + ']');
            }
        }
        if (patch.passwordBlocklist !== undefined) {
            const b = patch.passwordBlocklist;
            if (!Array.isArray(b) || b.length > BOUNDS.blocklistMaxEntries ||
                b.some((x) => typeof x !== 'string' || x.length > BOUNDS.blocklistMaxEntryLen)) {
                errors.push('passwordBlocklist must be an array of <=' + BOUNDS.blocklistMaxEntries + ' strings (each <=' + BOUNDS.blocklistMaxEntryLen + ' chars)');
            }
        }
        if (patch.bcryptCost !== undefined) {
            const v = patch.bcryptCost;
            if (!Number.isInteger(v) || v < BOUNDS.bcryptCost.min || v > BOUNDS.bcryptCost.max) {
                errors.push('bcryptCost must be an integer in [' + BOUNDS.bcryptCost.min + ',' + BOUNDS.bcryptCost.max + ']');
            }
        }
        if (patch.tokenExpiresIn !== undefined && !isValidDuration(patch.tokenExpiresIn)) {
            errors.push('tokenExpiresIn must be a positive number (seconds) or a duration string (e.g. "1h")');
        }
        if (patch.refreshTokenExpiresIn !== undefined && !isValidDuration(patch.refreshTokenExpiresIn)) {
            errors.push('refreshTokenExpiresIn must be a positive number (seconds) or a duration string (e.g. "7d")');
        }
        if (patch.bruteForce !== undefined) {
            const bf = patch.bruteForce;
            if (!bf || typeof bf !== 'object' || Array.isArray(bf)) {
                errors.push('bruteForce must be an object');
            } else {
                const bfAllowed = new Set(['threshold', 'baseThrottleMs', 'backoffFactor', 'maxThrottleMs', 'failureWindowMs']);
                for (const k of Object.keys(bf)) if (!bfAllowed.has(k)) errors.push('unknown bruteForce field: ' + k);
                if (bf.threshold !== undefined && (!Number.isInteger(bf.threshold) || bf.threshold < 0)) {
                    errors.push('bruteForce.threshold must be an integer >= 0');
                }
                for (const k of ['baseThrottleMs', 'maxThrottleMs', 'failureWindowMs']) {
                    if (bf[k] !== undefined && (typeof bf[k] !== 'number' || !Number.isFinite(bf[k]) || bf[k] < 0)) {
                        errors.push('bruteForce.' + k + ' must be a finite number >= 0');
                    }
                }
                if (bf.backoffFactor !== undefined && (typeof bf.backoffFactor !== 'number' || !Number.isFinite(bf.backoffFactor) || bf.backoffFactor < 1)) {
                    errors.push('bruteForce.backoffFactor must be a finite number >= 1');
                }
            }
        }
        return { ok: errors.length === 0, errors };
    }

    /**
     * Push an effective config to the LIVE services (D-049 hot-swap). Total: each setter validates/
     * ignores bad values, so this never throws for a resolved-effective object.
     * @param {object} effective
     * @returns {void}
     * @private
     */
    _applyToServices(effective) {
        this.services.passwordHasher.setCost(effective.bcryptCost);
        this.services.bruteForceGuard.reconfigure(effective.bruteForce || {});
        const policy = resolvePasswordPolicy({ auth: { passwordMinLength: effective.passwordMinLength, passwordBlocklist: effective.passwordBlocklist } });
        this.services.userService.setPasswordPolicy(policy);
        this.services.accountService.setPasswordPolicy(policy);
        this.services.tokenService.reconfigure({
            tokenExpiresIn: effective.tokenExpiresIn,
            refreshTokenExpiresIn: effective.refreshTokenExpiresIn,
        });
    }

    /** @param {string} outcome @param {string[]} keys @param {string} [actor] @private */
    _audit(outcome, keys, actor) {
        try {
            this.auditLogger.record({
                category: 'settings',
                operation: 'auth.config.update',
                subject: actor ? String(actor) : 'system',
                outcome,
                changedKeys: keys, // KEYS only — never values (some are policy-sensitive)
                timestamp: new Date(this.clock()).toISOString(),
            });
        } catch (_e) { /* audit never affects the outcome */ }
    }

    /**
     * Validate → persist the accumulated override → live-apply → audit. Atomic on failure: an invalid
     * patch persists/applies nothing (P-018). On success the change is live immediately (no restart).
     * @param {object} patch a partial config
     * @param {string} [actor] the acting username (for audit)
     * @returns {Promise<{kind:'applied',effective:object,version:number}|{kind:'invalid',errors:string[]}>}
     */
    async apply(patch, actor) {
        const v = this.validate(patch);
        if (!v.ok) {
            this._audit('rejected', patch && typeof patch === 'object' ? Object.keys(patch) : [], actor);
            return { kind: 'invalid', errors: v.errors };
        }
        const stored = await this.store.get();
        const currentOverride = stored && stored.config ? stored.config : {};
        const newOverride = mergeConfig(currentOverride, patch); // accumulate partial overrides
        const putRes = await this.store.put(newOverride, this.clock());
        const effective = mergeConfig(this.baseline, newOverride);
        this._applyToServices(effective);
        this._audit('applied', Object.keys(patch), actor);
        return { kind: 'applied', effective, version: putRes.version };
    }

    /**
     * At startup: overlay any persisted override onto the (baseline-built) services so a restart also
     * honors runtime changes. Fail-safe: a corrupt override was already coerced to none by the store.
     * @returns {Promise<object>} the effective config now live
     */
    async init() {
        const effective = await this.getEffective();
        this._applyToServices(effective);
        return effective;
    }

    /**
     * Reset to defaults: drop the override → services revert to baseline/defaults. Audited.
     * @param {string} [actor]
     * @returns {Promise<{kind:'reset',effective:object}>}
     */
    async resetToDefaults(actor) {
        await this.store.clear();
        const effective = mergeConfig(this.baseline, {});
        this._applyToServices(effective);
        this._audit('reset', [], actor);
        return { kind: 'reset', effective };
    }
}

module.exports = { AuthConfigService, CONFIG_DEFAULTS, BOUNDS, isValidDuration, mergeConfig };
