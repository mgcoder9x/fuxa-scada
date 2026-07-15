//@ts-check
'use strict';

/**
 * Secure enrollment channel for the bootstrap/migration one-time secret (design/12 §3.2, D-022,
 * fixes N-018; enrollment model fixed by D-035).
 *
 * THE INVARIANT (D-022): the seeded/rotated one-time secret is delivered to the operator through a
 * dedicated secure channel and is NEVER written to `fuxa.log` / `runtime.logger` / `console`. The
 * bootstrap routine depends only on the injected `EnrollmentChannel.deliver(...)` seam and hands the
 * plaintext to nothing else; it never returns the secret and never logs it.
 *
 * D-035 (resolves the §3.2 ambiguity): the module-generated CSPRNG one-time secret IS the enrollment
 * credential. Delivery is via a channel; the AUTOMATED-provisioning channel is a one-time enrollment
 * TOKEN (this file's `OneTimeEnrollmentTokenStore` + `TokenEnrollmentChannel`): the token is CSPRNG,
 * stored HASHED-AT-REST (SHA-256), short-TTL, and SINGLE-USE (redeemed exactly once to retrieve the
 * one-time secret, then invalidated). The INTERACTIVE first-run channel (operator sets/collects the
 * secret at a controlled console) is a thin operational collaborator supplied at the composition root
 * (Task 13/14); it likewise MUST NOT log the secret. Both satisfy the same `EnrollmentChannel` seam.
 */

const crypto = require('node:crypto');

/** SHA-256 hex of a token — the only form persisted at rest (never the raw token). */
function sha256Hex(s) {
    return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

/** Constant-time compare of two hex digests of equal length (false on any mismatch, never throws). */
function hashesMatch(rawToken, storedHex) {
    if (typeof storedHex !== 'string' || storedHex.length === 0) return false;
    const a = Buffer.from(sha256Hex(rawToken), 'hex');
    const b = Buffer.from(storedHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * One-time enrollment token store (D-022/D-035). Tokens are CSPRNG, persisted HASHED-AT-REST,
 * TTL-bounded, and SINGLE-USE. `redeem` returns the associated one-time secret exactly once.
 *
 * The buffered `secret` is held only until the token is redeemed or expires; it is the module's
 * transient hand-off buffer for the operator, never written to any log. (An alternative that stores
 * NO secret — letting the operator set the credential at redemption — is a documented follow-up; the
 * single-use + TTL + hashed-at-rest token guarantees are identical either way.)
 */
class OneTimeEnrollmentTokenStore {
    /**
     * @param {{ clock?: () => number, ttlMs?: number, tokenBytes?: number }} [opts]
     */
    constructor(opts = {}) {
        this.clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
        this.ttlMs = typeof opts.ttlMs === 'number' && opts.ttlMs > 0 ? opts.ttlMs : 24 * 60 * 60 * 1000; // 24h default
        this.tokenBytes = Number.isInteger(opts.tokenBytes) && opts.tokenBytes >= 16 ? opts.tokenBytes : 32;
        /** @type {Map<string, { username: string, secret: string, expiresAt: number, used: boolean }>} */
        this._byHash = new Map();
    }

    /**
     * Issue a fresh single-use token bound to `username`+`secret`. Returns the RAW token (to be
     * surfaced ONCE to the operator via a secure channel — never logged). Only its hash is stored.
     * @param {string} username
     * @param {string} secret the one-time initial secret to hand off
     * @returns {{ token: string, expiresAt: number }}
     */
    issue(username, secret) {
        const token = crypto.randomBytes(this.tokenBytes).toString('base64url');
        const expiresAt = this.clock() + this.ttlMs;
        this._byHash.set(sha256Hex(token), { username: String(username), secret: String(secret), expiresAt, used: false });
        return { token, expiresAt };
    }

    /**
     * Redeem a token exactly once, before its TTL. Returns the bound `{ username, secret }` on the
     * first valid redemption; every subsequent redemption (used) and any expired/unknown token fails.
     * @param {string} token
     * @returns {{ ok: true, username: string, secret: string } | { ok: false, reason: 'unknown'|'used'|'expired' }}
     */
    redeem(token) {
        const hex = sha256Hex(token);
        const entry = this._byHash.get(hex);
        // Guard against a match on a different key by re-checking with constant-time compare.
        if (!entry || !hashesMatch(token, hex)) {
            return { ok: false, reason: 'unknown' };
        }
        if (entry.used) {
            return { ok: false, reason: 'used' };
        }
        if (this.clock() >= entry.expiresAt) {
            entry.used = true; // burn an expired token so it cannot be reused
            return { ok: false, reason: 'expired' };
        }
        entry.used = true; // single-use: mark BEFORE returning
        return { ok: true, username: entry.username, secret: entry.secret };
    }
}

/**
 * Automated-provisioning `EnrollmentChannel`: delivers the one-time secret by issuing a token via the
 * store and surfacing ONLY the raw token to an injected operator sink (an out-of-band secure channel
 * — e.g. a restricted-perm file, a secrets manager, an ops tool — NEVER `runtime.logger`/`console`).
 */
class TokenEnrollmentChannel {
    /**
     * @param {{ store: OneTimeEnrollmentTokenStore, operatorSink: (info: { username: string, token: string, expiresAt: number, reason: string }) => void }} deps
     */
    constructor(deps) {
        const d = deps || {};
        if (!d.store || typeof d.store.issue !== 'function') {
            throw new Error('TokenEnrollmentChannel requires a token store');
        }
        if (typeof d.operatorSink !== 'function') {
            throw new Error('TokenEnrollmentChannel requires an operatorSink (a secure, non-log channel)');
        }
        this.store = d.store;
        this.operatorSink = d.operatorSink;
    }

    /**
     * Deliver the one-time secret for `username` by issuing a single-use token and handing ONLY the
     * token to the operator sink. The plaintext secret never leaves this method except into the
     * store's buffer (retrievable once via `redeem`); it is never logged and never returned.
     * @param {{ username: string, secret: string, reason?: string }} info
     * @returns {Promise<void>}
     */
    async deliver(info) {
        const { username, secret, reason } = info || /** @type {any} */({});
        const { token, expiresAt } = this.store.issue(username, secret);
        this.operatorSink({ username, token, expiresAt, reason: reason || 'seed' });
    }
}

module.exports = { OneTimeEnrollmentTokenStore, TokenEnrollmentChannel, sha256Hex, hashesMatch };
