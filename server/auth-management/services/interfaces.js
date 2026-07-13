//@ts-check
'use strict';

/**
 * Service-layer capability interfaces (injection seams) that the higher services depend on.
 *
 * These are contracts only — concrete implementations arrive in later tasks:
 *   Password_Hasher   → services/password-hasher.js  (Task 3), over adapters/fuxa-bcrypt
 *   Token_Service     → services/token.service.js    (Task 5), over adapters/fuxa-jwt
 *   BruteForceGuard   → services/brute-force.js       (Task 6)
 *   Audit_Logger      → services/audit-logger.js      (Task 11)
 *
 * Storage / library details are hidden behind these seams so the services above remain pure and
 * testable (design.md "Design Principles"; AC-16.5).
 */

/**
 * One-way password hashing (design/03-password-security.md). Never imports bcrypt directly.
 */
class Password_Hasher {
  /**
   * Hash a plaintext password (salted, one-way).
   * @param {string} plaintext
   * @returns {string} the bcrypt hash
   */
  hash(plaintext) { throw new Error('not_implemented:Password_Hasher.hash'); }

  /**
   * Verify a plaintext against a stored hash. Defensive: returns false (never throws) on
   * null/malformed input (AC-4.5).
   * @param {string} plaintext
   * @param {string} hash
   * @returns {boolean}
   */
  verify(plaintext, hash) { throw new Error('not_implemented:Password_Hasher.verify'); }
}

/**
 * Access/refresh token issuance and validation (design/02-token-and-session.md).
 *
 * @typedef {{ authenticated: boolean, id?: string, groups?: any, roles?: string[], tokenVersion?: number }} VerifyResult
 * @typedef {{ ok: true, token: string, refreshToken: string } | { ok: false, reason: string }} RefreshOutcome
 */
class Token_Service {
  /**
   * Issue a short-lived access token for an identity.
   * @param {{ username: string, groups?: any, roles?: string[], tokenVersion?: number }} identity
   * @returns {string}
   */
  issueAccessToken(identity) { throw new Error('not_implemented:Token_Service.issueAccessToken'); }

  /**
   * Issue a longer-lived refresh token for an identity.
   * @param {{ username: string }} identity
   * @returns {string}
   */
  issueRefreshToken(identity) { throw new Error('not_implemented:Token_Service.issueRefreshToken'); }

  /**
   * Validate a token: authenticated iff signature valid AND unexpired.
   * @param {string} token
   * @returns {VerifyResult}
   */
  verify(token) { throw new Error('not_implemented:Token_Service.verify'); }

  /**
   * Rotate an access+refresh pair from a valid refresh token.
   * @param {string} refreshToken
   * @returns {RefreshOutcome}
   */
  refresh(refreshToken) { throw new Error('not_implemented:Token_Service.refresh'); }
}

/**
 * Append-only audit sink (design/09-audit-logging.md). `record` is void/total/non-throwing.
 */
class Audit_Logger {
  /**
   * Record one audit event (fire-and-forget; never throws, never changes the caller's outcome).
   * @param {any} event an Audit_Event (see models/audit-event.js)
   * @returns {void}
   */
  record(event) { throw new Error('not_implemented:Audit_Logger.record'); }
}

/**
 * Per-username brute-force guard (design/10-brute-force-protection.md).
 *
 * @typedef {{ allowed: true } | { allowed: false, retryAfterMs: number }} GuardDecision
 */
class BruteForceGuard {
  /**
   * Whether a sign-in attempt for `username` is currently allowed.
   * @param {string} username
   * @param {number} [now] injected monotonic clock reading (ms)
   * @returns {GuardDecision}
   */
  checkAllowed(username, now) { throw new Error('not_implemented:BruteForceGuard.checkAllowed'); }

  /**
   * Record a failed attempt for `username` (advances throttling).
   * @param {string} username
   * @param {number} [now]
   * @returns {void}
   */
  recordFailure(username, now) { throw new Error('not_implemented:BruteForceGuard.recordFailure'); }

  /**
   * Clear all state for `username` (called on a successful sign-in, AC-15.4).
   * @param {string} username
   * @returns {void}
   */
  reset(username) { throw new Error('not_implemented:BruteForceGuard.reset'); }
}

module.exports = { Password_Hasher, Token_Service, Audit_Logger, BruteForceGuard };
