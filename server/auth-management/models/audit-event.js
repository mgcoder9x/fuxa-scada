//@ts-check
'use strict';

/**
 * Audit_Event model — secret-free BY CONSTRUCTION.
 *
 * Fields (design/11-data-models.md §3.6; design/09-audit-logging.md §2.2):
 *   category  : AuditCategory (required; stable, greppable discriminator)
 *   subject   : string        (required; who/what the event is about — a pre-sanitized scalar)
 *   operation : string        (optional; operation id / CRUD verb where applicable)
 *   outcome   : string        (required; stable outcome id mirroring the caller's outcome)
 *   timestamp : string        (required; ISO-8601, CALLER-supplied — reconciles "record the time"
 *                              with the no-enrichment rule AC-14.5a)
 *   detail    : string        (optional; pre-sanitized free text — no raw input echoes)
 *
 * Invariant (INV-4 / AC-14.5): there is NO `password`, `passwordHash`, `token`, `secret`, or
 * `credentials` field anywhere in an Audit_Event. `makeAuditEvent` copies only the safe fields, so
 * a secret cannot structurally enter the event even if the caller passes one.
 */

const AUDIT_CATEGORIES = Object.freeze([
  'auth.signin',
  'user.create', 'user.update', 'user.delete',
  'role.create', 'role.update', 'role.delete',
  'authz.denied',
  'bootstrap.seed',
]);

// Keys that must never appear on an Audit_Event (structural half of AC-14.5).
const FORBIDDEN_SECRET_KEYS = Object.freeze([
  'password', 'passwordHash', 'token', 'secret', 'credentials',
]);

/**
 * True iff `category` is one of the stable audit discriminators.
 * @param {unknown} category
 * @returns {boolean}
 */
function isValidAuditCategory(category) {
  return typeof category === 'string' && AUDIT_CATEGORIES.includes(category);
}

/**
 * Build a normalized Audit_Event, copying ONLY the safe fields. No secret-bearing key can enter
 * the returned object regardless of what the caller passes.
 * @param {{ category: string, subject: string, operation?: string, outcome: string, timestamp: string, detail?: string }} input
 * @returns {{ category: string, subject: string, operation?: string, outcome: string, timestamp: string, detail?: string }}
 */
function makeAuditEvent(input) {
  const { category, subject, operation, outcome, timestamp, detail } = input || {};
  return {
    category,
    subject,
    operation: operation || undefined,
    outcome,
    timestamp, // ISO-8601, caller-supplied (AC-14.5)
    detail: detail || undefined,
  };
}

module.exports = { AUDIT_CATEGORIES, FORBIDDEN_SECRET_KEYS, isValidAuditCategory, makeAuditEvent };
