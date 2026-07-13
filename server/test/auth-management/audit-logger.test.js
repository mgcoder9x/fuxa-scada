//@ts-check
'use strict';

/**
 * Tests for Audit_Logger + the dedicated append-only Audit_Sink — design/09-audit-logging.md
 * (REQ-14, D-023). Task 11.3 (recording + secret-exclusion + non-throwing) and task 11.4
 * (dedicated-file separation + health + hash-chain).
 *
 * Toolchain (N-023/N-025): `node:assert/strict` (chai@5 is ESM-only); no real timers except the
 * single async winston-flush wait in the dedicated-file test. Grounded against the actual
 * implementation: allow-listed key copy, `AUDIT `+JSON line, void/non-throwing `record`,
 * `transportWrite` seam, `health()` semantics, optional hash-chain.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { Audit_Logger, createFuxaAuditSink } = require('../../auth-management/services/audit-logger');

// --- tiny manual spy sink (captures normal + error lines) -------------------
function fakeSink() {
  const lines = [];
  const errors = [];
  return {
    lines, errors,
    write(l) { lines.push(l); },
    writeError(l) { errors.push(l); },
    parseLast() { return JSON.parse(this.lines[this.lines.length - 1].slice('AUDIT '.length)); },
  };
}
function fakeFuxaLogger() {
  const info = [];
  const error = [];
  return {
    info: (l) => info.push(l),
    error: (l) => error.push(l),
    logDir: () => 'IGNORED', // overridden by explicit opts.logDir in tests
    _info: info, _error: error,
  };
}

describe('Feature: auth-user-management — Audit_Logger (design/09 · REQ-14, D-023)', () => {

  // -------------------------------------------------------------------------
  // Task 11.3 — recording model + secret exclusion + non-blocking
  // -------------------------------------------------------------------------
  it('AC-14.1..14.4: records each category as one `AUDIT `+JSON line with the supplied fields', () => {
    const sink = fakeSink();
    const log = new Audit_Logger(sink);
    const cases = [
      { category: 'auth.signin', subject: 'alice', outcome: 'success', timestamp: '2026-07-13T00:00:00Z' },
      { category: 'user.create', subject: 'bob', operation: 'create', outcome: 'created', timestamp: '2026-07-13T00:00:01Z' },
      { category: 'role.update', subject: 'operators', operation: 'update', outcome: 'updated', timestamp: '2026-07-13T00:00:02Z' },
      { category: 'authz.denied', subject: 'guest', operation: 'user.delete', outcome: 'denied', detail: 'unauthorized_error', timestamp: '2026-07-13T00:00:03Z' },
    ];
    for (const ev of cases) {
      log.record(ev);
      const line = sink.lines[sink.lines.length - 1];
      assert.ok(line.startsWith('AUDIT '), 'line must start with the AUDIT marker');
      const obj = JSON.parse(line.slice('AUDIT '.length));
      assert.equal(obj.category, ev.category);
      assert.equal(obj.subject, ev.subject);
      assert.equal(obj.outcome, ev.outcome);
      assert.equal(obj.timestamp, ev.timestamp);
      if (ev.operation) assert.equal(obj.operation, ev.operation);
      if (ev.detail) assert.equal(obj.detail, ev.detail);
    }
    assert.equal(sink.lines.length, 4);
    assert.equal(sink.errors.length, 0);
  });

  it('AC-14.5a: logger copies ONLY allow-listed keys — no enrichment, unknown keys dropped', () => {
    const sink = fakeSink();
    new Audit_Logger(sink).record({
      category: 'user.update', subject: 'bob', outcome: 'updated', timestamp: 't',
      operation: 'update', actor: 'admin', target: 'bob', sourceIp: '10.0.0.1',
      // hostile / unknown keys that MUST be dropped:
      password: 'p@ss', passwordHash: '$2a$12$abc', token: 'eyJ...', injected: 'x',
    });
    const obj = sink.parseLast();
    // allow-listed present:
    assert.deepEqual(
      Object.keys(obj).sort(),
      ['actor', 'category', 'operation', 'outcome', 'sourceIp', 'subject', 'target', 'timestamp'].sort()
    );
    // secret/unknown keys absent:
    for (const k of ['password', 'passwordHash', 'token', 'injected']) {
      assert.ok(!(k in obj), `key ${k} must not be copied`);
    }
  });

  it('AC-14.5: no secret substring appears in the emitted line', () => {
    const sink = fakeSink();
    new Audit_Logger(sink).record({
      category: 'auth.signin', subject: 'alice', outcome: 'bad_password', timestamp: 't',
      password: 'SuperSecret123', passwordHash: '$2a$12$deadbeef',
    });
    const line = sink.lines[0];
    assert.ok(!line.includes('SuperSecret123'), 'plaintext must not appear');
    assert.ok(!line.includes('$2a$12$deadbeef'), 'hash must not appear');
  });

  it('changes[]: only {field, from?, to?} string values are copied; malformed entries dropped', () => {
    const sink = fakeSink();
    new Audit_Logger(sink).record({
      category: 'user.update', subject: 'bob', outcome: 'updated', timestamp: 't',
      changes: [
        { field: 'fullname', from: 'Bob', to: 'Bobby' },
        { field: 'roles', to: 'operators' },
        { nope: 'no field' },          // dropped (no `field`)
        { field: 'x', from: 42, to: {} }, // non-string from/to dropped, field kept
      ],
    });
    const obj = sink.parseLast();
    assert.deepEqual(obj.changes, [
      { field: 'fullname', from: 'Bob', to: 'Bobby' },
      { field: 'roles', to: 'operators' },
      { field: 'x' },
    ]);
  });

  it('malformed event → internal diagnostic, NO normal line, no throw', () => {
    const sink = fakeSink();
    const log = new Audit_Logger(sink);
    assert.doesNotThrow(() => log.record({ category: 'x' }));          // missing subject/outcome/timestamp
    assert.doesNotThrow(() => log.record(null));                       // not an object
    assert.doesNotThrow(() => log.record({ category: 'x', subject: 1, outcome: 'o', timestamp: 't' })); // non-string subject
    assert.equal(sink.lines.length, 0);
    assert.equal(sink.errors.length, 3);
  });

  it('§7 non-blocking: a sink whose write throws never propagates out of record()', () => {
    const throwingSink = { write() { throw new Error('disk full'); }, writeError() {} };
    const log = new Audit_Logger(throwingSink);
    assert.doesNotThrow(() => log.record({ category: 'auth.signin', subject: 'a', outcome: 'success', timestamp: 't' }));
  });

  // -------------------------------------------------------------------------
  // Task 11.4 — dedicated sink: health, failure signal, hash-chain, separation
  // -------------------------------------------------------------------------
  it('health(): ok=true + lastWriteOk after a successful write (transportWrite seam)', () => {
    const fuxa = fakeFuxaLogger();
    const captured = [];
    const sink = createFuxaAuditSink(fuxa, { logDir: 'X', transportWrite: (l) => captured.push(l) });
    sink.write('AUDIT {"category":"auth.signin"}');
    const h = sink.health();
    assert.equal(h.ok, true);
    assert.ok(h.lastWriteOk, 'lastWriteOk timestamp set');
    assert.equal(captured.length, 1);
    // separation: a successful audit write did NOT go through the shared fuxa logger
    assert.equal(fuxa._info.length, 0);
  });

  it('health(): a transport write failure flips ok=false + records lastError + FUXA error diagnostic, without throwing', () => {
    const fuxa = fakeFuxaLogger();
    const sink = createFuxaAuditSink(fuxa, { logDir: 'X', transportWrite: () => { throw new Error('EACCES'); } });
    assert.doesNotThrow(() => sink.write('AUDIT {"x":1}'));
    const h = sink.health();
    assert.equal(h.ok, false);
    assert.ok(/EACCES/.test(h.lastError), 'lastError carries the cause');
    assert.ok(fuxa._error.some((l) => /AUDIT_SINK write failed/.test(l)), 'diagnostic written to FUXA error channel');
  });

  it('hash-chain (opt-in): each line links to the previous (prevHash == previous line hash)', () => {
    const captured = [];
    const sink = createFuxaAuditSink(fakeFuxaLogger(), { logDir: 'X', hashChain: true, transportWrite: (l) => captured.push(l) });
    sink.write('AUDIT {"n":1}');
    sink.write('AUDIT {"n":2}');
    // Each emitted line is `<AUDIT json> <{"prevHash","hash"}>`; the trailing chain object starts
    // at the LAST '{' (the AUDIT json's braces come before it).
    const chain0 = JSON.parse(captured[0].substring(captured[0].lastIndexOf('{')));
    const chain1 = JSON.parse(captured[1].substring(captured[1].lastIndexOf('{')));
    assert.equal(chain0.prevHash, 'GENESIS');
    assert.equal(chain1.prevHash, chain0.hash, 'line 2 chains onto line 1 hash');
    assert.notEqual(chain1.hash, chain0.hash);
  });

  it('dedicated File transport: audit lines land in fuxa-audit.log (own file), not via the shared logger', async function () {
    this.timeout(15000);
    const fuxa = fakeFuxaLogger();
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-audit-'));
    const sink = createFuxaAuditSink(fuxa, { logDir }); // real winston File transport
    const h0 = sink.health();
    assert.ok(!h0.fallback, 'dedicated winston transport constructed (not fallback)');
    assert.ok(sink.filename.endsWith('fuxa-audit.log'));
    sink.write('AUDIT {"category":"auth.signin","subject":"alice"}');
    sink.write('AUDIT {"category":"user.create","subject":"bob"}');
    await new Promise((r) => setTimeout(r, 600)); // let winston flush to disk
    const content = fs.readFileSync(path.join(logDir, 'fuxa-audit.log'), 'utf8');
    const auditLines = content.split(/\r?\n/).filter((l) => l.includes('AUDIT '));
    assert.equal(auditLines.length, 2, 'both AUDIT lines present in the dedicated file');
    // separation: nothing was routed through the shared fuxa logger's info channel
    assert.equal(fuxa._info.length, 0);
    assert.equal(sink.health().ok, true);
  });
});
