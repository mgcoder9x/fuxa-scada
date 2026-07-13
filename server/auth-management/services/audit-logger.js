//@ts-check
'use strict';

/**
 * Audit_Logger + dedicated append-only Audit_Sink (design/09-audit-logging.md; D-023).
 *
 * Responsibilities split:
 *   - `Audit_Logger.record(event)` — the RECORDING MODEL (§3). void, TOTAL, and NEVER throws to
 *     the caller (§7 non-blocking guarantee). It shape-checks the required fields, copies ONLY
 *     known secret-free keys (no ambient reads — pure function of the event, §5.1 / AC-14.5a),
 *     serializes to a single `AUDIT ` + compact-JSON line (§6.3), and emits it at `info` through
 *     an INJECTED `Audit_Sink`.
 *   - `createFuxaAuditSink(fuxaLogger, options)` — the DEDICATED SINK (D-023 / §6.2). A
 *     module-owned winston `File` transport at `${logDir}/fuxa-audit.log` with its OWN
 *     rotation (independent of fuxa.log's 1 MB × 5). Exposes `health()` so a write failure is an
 *     OBSERVABLE signal (§7). On write failure it writes an internal diagnostic to FUXA's error
 *     channel AND flips `health().ok=false`, but does NOT throw (non-blocking by default). If the
 *     dedicated transport cannot be constructed, it falls back to `fuxaLogger.info` and reports
 *     degraded health (audit is never silently off).
 *
 * NO FUXA core file is edited: the dedicated transport is registered inside this module, and the
 * only FUXA touch-point is the injected `runtime/logger` singleton (D-003).
 *
 * There is NO `password`/`passwordHash`/`token`/`secret`/`credentials` field anywhere in an
 * Audit_Event, and this logger copies only a fixed allow-list of keys, so a secret cannot
 * structurally enter the output (AC-14.5a). Emission wiring into the services is the SEPARATE
 * task 11.2 — out of scope here.
 */

const crypto = require('crypto');

// The complete, fixed allow-list of Audit_Event keys the logger will copy. Anything else the
// caller passes is dropped — the logger adds nothing and forwards nothing outside this set
// (AC-14.5a "no enrichment", and the structural half of AC-14.5: no secret-bearing key exists).
const REQUIRED_STRING_KEYS = Object.freeze(['category', 'subject', 'outcome', 'timestamp']);
const OPTIONAL_STRING_KEYS = Object.freeze([
  'operation', 'detail',
  // richer forensic fields (D-023 / §2.2) — all OPTIONAL, caller-supplied, secret-free:
  'actor', 'target', 'sourceIp', 'device', 'sessionId', 'correlationId',
]);

// Dedicated-sink rotation defaults (D-023 §6.2): generous and INDEPENDENT of fuxa.log (1 MB × 5)
// so security events are never aged out by unrelated `info` volume. Deployment-tunable via options.
const DEFAULT_AUDIT_MAXSIZE = 10 * 1024 * 1024; // 10 MB per audit file
const DEFAULT_AUDIT_MAXFILES = 20;              // keep 20 rotated files by default
const DEFAULT_AUDIT_FILENAME = 'fuxa-audit.log';

/**
 * Copy ONLY the safe, known keys from a change record ({field, from?, to?}). Values are
 * caller-pre-sanitized scalars; AC-14.5 applies to `from`/`to` (never a secret).
 * @param {any} change
 * @returns {{ field: string, from?: string, to?: string } | null}
 */
function sanitizeChange(change) {
    if (!change || typeof change !== 'object') {
        return null;
    }
    if (typeof change.field !== 'string') {
        return null;
    }
    /** @type {{ field: string, from?: string, to?: string }} */
    const out = { field: change.field };
    if (typeof change.from === 'string') {
        out.from = change.from;
    }
    if (typeof change.to === 'string') {
        out.to = change.to;
    }
    return out;
}

/**
 * Build a secret-free record by copying ONLY the allow-listed keys that are present. Returns the
 * normalized object (no ambient data added). Keys that are absent/undefined are omitted so the
 * emitted JSON carries exactly the caller-supplied fields (AC-14.5a).
 * @param {any} event
 * @returns {Record<string, any>}
 */
function copySafeFields(event) {
    /** @type {Record<string, any>} */
    const safe = {};
    for (const k of REQUIRED_STRING_KEYS) {
        safe[k] = event[k];
    }
    for (const k of OPTIONAL_STRING_KEYS) {
        if (typeof event[k] === 'string') {
            safe[k] = event[k];
        }
    }
    if (Array.isArray(event.changes)) {
        const changes = event.changes.map(sanitizeChange).filter((c) => c !== null);
        if (changes.length > 0) {
            safe.changes = changes;
        }
    }
    return safe;
}

/**
 * Audit_Logger — records one security event per `record(event)` call.
 * @see design/09-audit-logging.md §2.1 / §3
 */
class Audit_Logger {
    /**
     * @param {{ write(line: string): void, writeError?(line: string): void, health?(): any }} sink
     *   an Audit_Sink. The default implementation is `createFuxaAuditSink(...)`.
     */
    constructor(sink) {
        this.sink = sink;
    }

    /**
     * Record one audit event. void, TOTAL, and NEVER throws to the caller (§7). For a malformed
     * event it writes an internal diagnostic to the sink's error channel and returns without
     * emitting a normal line. A sink whose `write` throws is caught here so the domain operation
     * is never affected.
     *
     * The emitted line is a PURE function of `event` (plus the fixed `AUDIT ` marker): no clock,
     * store, request context, or environment is read (AC-14.5a).
     *
     * @param {any} event an Audit_Event (see models/audit-event.js) — secret-free by construction
     * @returns {void}
     */
    record(event) {
        try {
            // 1. Shape check (defensive, §3 step 1): required fields present and strings.
            if (!event || typeof event !== 'object') {
                this._diagnostic('AUDIT_ERROR malformed audit event: not an object');
                return;
            }
            for (const k of REQUIRED_STRING_KEYS) {
                if (typeof event[k] !== 'string') {
                    this._diagnostic('AUDIT_ERROR malformed audit event: missing/invalid field "' + k + '"');
                    return;
                }
            }

            // 2. Serialize (§3 step 2 / §6.3): `AUDIT ` marker + compact JSON of the safe fields.
            const safe = copySafeFields(event);
            const line = 'AUDIT ' + JSON.stringify(safe);

            // 3. Emit to the sink at info (§3 step 3). The sink owns WHERE the record lands.
            this.sink.write(line);
        } catch (e) {
            // Non-blocking guarantee (§7): a sink/serialization failure never propagates to the
            // caller. Best-effort internal diagnostic; even that is guarded.
            this._diagnostic('AUDIT_ERROR ' + String((e && e.message) || e));
        }
    }

    /**
     * Best-effort internal diagnostic to the sink's error channel. Never throws.
     * @param {string} line
     * @private
     */
    _diagnostic(line) {
        try {
            if (this.sink && typeof this.sink.writeError === 'function') {
                this.sink.writeError(line);
            }
        } catch (_e) {
            // swallow — diagnostics must never break the caller (§7)
        }
    }
}

/**
 * Create the DEFAULT dedicated, append-only Audit_Sink (D-023 / §6.2).
 *
 * It constructs a module-owned winston logger with a single `File` transport at
 * `${logDir}/fuxa-audit.log` carrying its OWN `maxsize`/`maxFiles` (independent of fuxa.log). If
 * that transport cannot be constructed, it falls back to `fuxaLogger.info` and reports degraded
 * health. Write failures (sync throw or async transport `error` event) flip `health().ok=false`,
 * write a diagnostic to FUXA's error channel, and are NOT rethrown (non-blocking, §7).
 *
 * @param {{ info: Function, error: Function, logDir?: Function }} fuxaLogger the FUXA runtime logger singleton
 * @param {{
 *   logDir?: string,
 *   filename?: string,
 *   maxsize?: number,
 *   maxFiles?: number,
 *   hashChain?: boolean,
 *   transportWrite?: (line: string) => void
 * }} [options] dedicated-sink options. `transportWrite` overrides the raw line emitter (used to
 *   exercise the write-failure/health path without touching the filesystem).
 * @returns {{ write(line: string): void, writeError(line: string): void, health(): { ok: boolean, lastError?: string, lastWriteOk?: string, degraded?: boolean, fallback?: boolean }, filename: string }}
 */
function createFuxaAuditSink(fuxaLogger, options) {
    const opts = options || {};

    // Resolve the audit directory: explicit option → the FUXA logger's logDir() → '_logs' default.
    let logDir = opts.logDir;
    if (!logDir && fuxaLogger && typeof fuxaLogger.logDir === 'function') {
        try { logDir = fuxaLogger.logDir(); } catch (_e) { /* ignore */ }
    }
    if (!logDir) {
        logDir = '_logs';
    }
    const filename = (logDir ? logDir + '/' : '') + (opts.filename || DEFAULT_AUDIT_FILENAME);

    /** @type {{ ok: boolean, lastError?: string, lastWriteOk?: string, degraded?: boolean, fallback?: boolean }} */
    const healthState = { ok: true };

    // Optional tamper-evidence hash-chain (D-023, opt-in). Off by default.
    const hashChain = opts.hashChain === true;
    let prevHash = hashChain ? 'GENESIS' : null;

    /** @type {(line: string) => void} */
    let rawWrite;

    if (typeof opts.transportWrite === 'function') {
        // Test/alternate seam: caller supplies the raw line emitter.
        rawWrite = opts.transportWrite;
    } else {
        // Default: a module-owned winston File transport, independent of fuxa.log.
        try {
            const { createLogger, format, transports } = require('winston');
            const dedicated = createLogger({
                level: 'info',
                format: format.combine(
                    format.timestamp(),
                    format.printf((info) => `${info.timestamp} [${info.level}] ${info.message}`)
                ),
                transports: [
                    new transports.File({
                        level: 'info',
                        filename: filename,
                        maxsize: typeof opts.maxsize === 'number' ? opts.maxsize : DEFAULT_AUDIT_MAXSIZE,
                        maxFiles: typeof opts.maxFiles === 'number' ? opts.maxFiles : DEFAULT_AUDIT_MAXFILES,
                        json: false,
                        tailable: true,
                    }),
                ],
            });
            // Async transport failures (disk full, EACCES) surface as an 'error' event, not a
            // throw — treat them as an observable health signal (§7 / D-023).
            dedicated.on('error', (err) => {
                healthState.ok = false;
                healthState.lastError = String((err && err.message) || err);
                try { fuxaLogger.error('AUDIT_SINK transport error: ' + healthState.lastError); } catch (_e) { /* swallow */ }
            });
            rawWrite = (line) => { dedicated.info(line); };
        } catch (constructErr) {
            // Fallback (§6.2): dedicated transport could not be constructed. Do NOT leave audit
            // silently off — write through the shared FUXA logger and report degraded health.
            healthState.degraded = true;
            healthState.fallback = true;
            healthState.lastError = 'dedicated_transport_unavailable: ' + String((constructErr && constructErr.message) || constructErr);
            try { fuxaLogger.error('AUDIT_SINK ' + healthState.lastError + ' — falling back to shared logger'); } catch (_e) { /* swallow */ }
            rawWrite = (line) => { fuxaLogger.info(line, true); }; // true = do not spam the console
        }
    }

    return {
        filename,

        /**
         * Append one AUDIT line to the dedicated sink. Never throws (§7): on failure it records a
         * diagnostic to FUXA's error channel and flips `health().ok=false`.
         * @param {string} line
         */
        write(line) {
            try {
                let out = line;
                if (hashChain) {
                    // Link each line to the previous one so post-hoc tampering is detectable.
                    const hash = crypto.createHash('sha256').update(String(prevHash) + '\n' + line).digest('hex');
                    out = line + ' ' + JSON.stringify({ prevHash, hash });
                    prevHash = hash;
                }
                rawWrite(out);
                healthState.lastWriteOk = new Date().toISOString();
                // A prior async error may have set ok=false; a subsequent successful synchronous
                // write does not silently clear it. Health only clears on explicit re-init.
            } catch (e) {
                healthState.ok = false;
                healthState.lastError = String((e && e.message) || e);
                try { fuxaLogger.error('AUDIT_SINK write failed: ' + healthState.lastError); } catch (_e) { /* swallow */ }
                // Do NOT rethrow — audit failure must not change the domain outcome (§7).
            }
        },

        /**
         * Write an internal diagnostic to FUXA's error channel (→ fuxa-err.log). Never throws.
         * @param {string} line
         */
        writeError(line) {
            try {
                fuxaLogger.error(line);
            } catch (_e) {
                // swallow — diagnostics must never break the caller (§7)
            }
        },

        /**
         * Observable health of the audit trail (§7 / D-023). `ok=false` means at least one write
         * has failed since construction; `degraded`/`fallback` mean the dedicated transport was
         * unavailable and audit is running through the shared logger.
         * @returns {{ ok: boolean, lastError?: string, lastWriteOk?: string, degraded?: boolean, fallback?: boolean }}
         */
        health() {
            return Object.assign({}, healthState);
        },
    };
}

module.exports = { Audit_Logger, createFuxaAuditSink };
