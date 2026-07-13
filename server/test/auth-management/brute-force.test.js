//@ts-check
'use strict';

/**
 * Tests for the per-username brute-force guard — design/10-brute-force-protection.md (REQ-15).
 *
 * Toolchain (N-023): chai@5 is ESM-only under CommonJS mocha, so assertions use Node's built-in
 * `node:assert/strict`; property tests use `fast-check@3.23.2` (N-025). All time is driven by an
 * explicit injected `now` argument (no real timers), matching the guard's monotonic-clock contract.
 *
 * Covers task 6.2 (P-012 model-based lifecycle property, ≥100 iters) and task 6.3 (AC-15.1…15.6 edges).
 * The reference model below transcribes the DESIGN's adaptive-throttle semantics (§10 §2.2/§3, DV-008):
 *   blocked ⇔ (threshold === 0)  ∨  (consecutive failCount ≥ threshold ∧ now < lockedUntil),
 *   where lockedUntil = armAt + min(maxThrottleMs ?? ∞, baseThrottleMs · backoffFactor^k), k = failCount − threshold,
 *   retryAfterMs = max(0, lockedUntil − now); success reset zeroes failCount & level; per-username isolation.
 */

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { BruteForceGuard } = require('../../auth-management/services/brute-force');

// ---------------------------------------------------------------------------
// Reference model (independent transcription of design §10 §2.2/§3; window disabled).
// ---------------------------------------------------------------------------
function makeModel(cfg) {
  const threshold = cfg.threshold;
  const base = cfg.baseThrottleMs;
  const factor = cfg.backoffFactor;
  const cap = cfg.maxThrottleMs != null ? cfg.maxThrottleMs : Infinity;
  const interval = (k) => Math.min(cap, base * Math.pow(factor, k));
  /** @type {Map<string, {failCount:number,throttleLevel:number,lockedUntil:number|null}>} */
  const state = new Map();

  return {
    check(u, now) {
      if (threshold === 0) return { allowed: false, retryAfterMs: interval(0) };
      const s = state.get(u);
      if (!s) return { allowed: true };
      if (s.lockedUntil != null && now < s.lockedUntil) {
        return { allowed: false, retryAfterMs: Math.max(0, s.lockedUntil - now) };
      }
      return { allowed: true };
    },
    fail(u, now) {
      if (threshold === 0) return;
      const prev = state.get(u) || { failCount: 0, throttleLevel: 0, lockedUntil: null };
      const failCount = prev.failCount + 1;
      let throttleLevel = prev.throttleLevel;
      let lockedUntil = prev.lockedUntil;
      if (failCount >= threshold) {
        throttleLevel = failCount - threshold;
        lockedUntil = now + interval(throttleLevel);
      }
      state.set(u, { failCount, throttleLevel, lockedUntil });
    },
    reset(u) { state.delete(u); },
  };
}

describe('Feature: auth-user-management — brute-force guard (design/10 · REQ-15)', () => {

  // -------------------------------------------------------------------------
  // Task 6.2 — P-012 (model-based adaptive-throttle lifecycle) — ≥100 iters
  // -------------------------------------------------------------------------
  it('Property 12: Lockout lifecycle matches the reference state machine (P-012, AC-15.1–15.6)', () => {
    const configArb = fc.record({
      threshold: fc.integer({ min: 0, max: 3 }),
      baseThrottleMs: fc.integer({ min: 1, max: 1000 }),
      backoffFactor: fc.integer({ min: 1, max: 3 }),
      maxThrottleMs: fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 20000 })),
    });
    const stepArb = fc.record({
      kind: fc.constantFrom('fail', 'success', 'check'),
      username: fc.constantFrom('a', 'b'),   // two usernames → per-username isolation exercised
      dt: fc.integer({ min: 0, max: 5000 }),  // non-negative time advance ⇒ non-decreasing clock
    });

    fc.assert(fc.property(configArb, fc.array(stepArb, { maxLength: 40 }), (cfg, steps) => {
      // failureWindowMs omitted (0/disabled) so "consecutive" never expires — core lifecycle focus.
      const guard = new BruteForceGuard(cfg);
      const model = makeModel(cfg);
      let now = 0;

      for (const step of steps) {
        now += step.dt;
        if (step.kind === 'fail') {
          guard.recordFailure(step.username, now);
          model.fail(step.username, now);
        } else if (step.kind === 'success') {
          guard.reset(step.username);
          model.reset(step.username);
        } else {
          const got = guard.checkAllowed(step.username, now);
          const want = model.check(step.username, now);
          assert.equal(got.allowed, want.allowed, `allowed mismatch @${now} for ${step.username}`);
          if (!got.allowed) {
            assert.equal(got.retryAfterMs, want.retryAfterMs, `retryAfterMs mismatch @${now}`);
          }
        }
      }
    }), { numRuns: 200 });
  });

  // -------------------------------------------------------------------------
  // Task 6.3 — explicit edge cases, one per acceptance criterion
  // -------------------------------------------------------------------------
  it('AC-15.1: below threshold → allowed', () => {
    const g = new BruteForceGuard({ threshold: 3, baseThrottleMs: 1000 });
    g.recordFailure('u', 0);
    g.recordFailure('u', 1);
    assert.equal(g.checkAllowed('u', 2).allowed, true); // only 2 of 3
  });

  it('AC-15.2: Nth failure throttles (429) with the base interval, then escalates (adaptive backoff)', () => {
    const g = new BruteForceGuard({ threshold: 3, baseThrottleMs: 1000, backoffFactor: 2, maxThrottleMs: 100000 });
    g.recordFailure('u', 0);
    g.recordFailure('u', 0);
    g.recordFailure('u', 0);                       // 3rd = threshold ⇒ k=0 ⇒ interval = base(1000)
    let d = g.checkAllowed('u', 0);
    assert.equal(d.allowed, false);
    assert.equal(d.retryAfterMs, 1000);
    // one more consecutive failure after the interval elapses ⇒ k=1 ⇒ interval = base*factor = 2000
    g.recordFailure('u', 1000);
    d = g.checkAllowed('u', 1000);
    assert.equal(d.allowed, false);
    assert.equal(d.retryAfterMs, 2000);            // escalated
  });

  it('AC-15.3: threshold 0 ⇒ fail-closed, every username blocked', () => {
    const g = new BruteForceGuard({ threshold: 0, baseThrottleMs: 500 });
    assert.equal(g.checkAllowed('anyone', 0).allowed, false);
    assert.equal(g.checkAllowed('another', 999).allowed, false);
  });

  it('AC-15.4: success resets count AND throttle level (backoff restarts from base)', () => {
    const g = new BruteForceGuard({ threshold: 2, baseThrottleMs: 1000, backoffFactor: 2 });
    g.recordFailure('u', 0);
    g.recordFailure('u', 0);            // throttled, k=0
    g.reset('u');                       // success
    g.recordFailure('u', 10);
    assert.equal(g.checkAllowed('u', 10).allowed, true);   // 1 of 2 again
    g.recordFailure('u', 10);           // 2nd ⇒ k=0 again ⇒ base interval, not escalated
    assert.equal(g.checkAllowed('u', 10).retryAfterMs, 1000);
  });

  it('AC-15.5: throttle interval elapses ⇒ allowed again without explicit reset', () => {
    const g = new BruteForceGuard({ threshold: 1, baseThrottleMs: 1000 });
    g.recordFailure('u', 0);                          // k=0 ⇒ locked until 1000
    assert.equal(g.checkAllowed('u', 500).allowed, false);
    assert.equal(g.checkAllowed('u', 1000).allowed, true);  // elapsed (now >= lockedUntil)
  });

  it('AC-15.6: adaptive interval is bounded by maxThrottleMs (targeted-DoS resistance)', () => {
    const g = new BruteForceGuard({ threshold: 1, baseThrottleMs: 1000, backoffFactor: 10, maxThrottleMs: 5000 });
    let now = 0;
    // escalate several times; each interval must never exceed the cap
    for (let i = 0; i < 6; i++) {
      g.recordFailure('u', now);
      const d = g.checkAllowed('u', now);
      assert.equal(d.allowed, false);
      assert.ok(d.retryAfterMs <= 5000, `interval ${d.retryAfterMs} exceeded cap`);
      now += d.retryAfterMs; // wait out the interval, then fail again
    }
  });

  it('per-username isolation: throttling A never blocks B', () => {
    const g = new BruteForceGuard({ threshold: 1, baseThrottleMs: 1000 });
    g.recordFailure('a', 0);
    assert.equal(g.checkAllowed('a', 0).allowed, false);
    assert.equal(g.checkAllowed('b', 0).allowed, true);
  });

  it('lazy eviction: a spent (unlocked, zero-count) entry is dropped on checkAllowed', () => {
    const { InMemoryBruteForceStore } = require('../../auth-management/services/brute-force');
    const store = new InMemoryBruteForceStore();
    const g = new BruteForceGuard({ threshold: 2, baseThrottleMs: 1000, failureWindowMs: 100, store });
    // record at now>0 (a monotonic clock never reads exactly 0 for a real failure; lastFailAt===0
    // is the guard's "never failed" sentinel, so staleness is only meaningful for lastFailAt>0).
    g.recordFailure('u', 10);           // failCount 1, not yet thresholded, lastFailAt=10
    assert.equal(store.size, 1);
    // advance beyond the failure window so the chain is stale ⇒ checkAllowed evicts it
    g.checkAllowed('u', 10 + 200);      // 200 > failureWindowMs(100)
    assert.equal(store.size, 0);
  });
});
