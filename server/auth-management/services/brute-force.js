//@ts-check
'use strict';

/**
 * Per-username brute-force guard (design/10-brute-force-protection.md · REQ-15).
 *
 * A pure, in-memory-by-default state machine that counts *consecutive* failed sign-in attempts
 * per submitted username and, once a configured threshold is reached, throttles further attempts
 * with an ADAPTIVE exponential backoff (DV-008) rather than a fixed hard lock. The
 * `Authentication_Service` owns an instance and drives it at three checkpoints:
 *   - `checkAllowed(username)` BEFORE any store lookup / password compare (pre-check),
 *   - `recordFailure(username)` after a failed sign-in outcome,
 *   - `reset(username)` after a successful sign-in (AC-15.4).
 *
 * Design decisions honored here:
 *   - Pluggable `BruteForceStore` seam (§2.1, N-019/AC-15.6): default in-memory `Map`; a shared
 *     store (e.g. Redis, atomic read-modify-write) may be injected for horizontal scaling so the
 *     threshold is enforced globally rather than per-node. The guard logic is identical for both.
 *   - Adaptive exponential backoff (§2.2/§3, DV-008/AC-15.2): the interval grows with each
 *     consecutive failure at/after the threshold and is bounded by an optional `maxThrottleMs`
 *     cap, so a party who knows a username cannot lock the legitimate operator out indefinitely
 *     (AC-15.6).
 *   - `threshold === 0` ⇒ fail-closed (§3, AC-15.3): every `checkAllowed` is blocked.
 *   - Monotonic injected clock (§6, N-019): defaults to a `performance.now()`-based monotonic
 *     source (NOT `Date.now()`) so an NTP/wall-clock jump cannot end a throttle early/late.
 *   - Lazy eviction of stale entries (§6): entries are dropped as a side effect of servicing
 *     `checkAllowed`, no timer thread required.
 *
 * This module performs NO I/O and holds no HTTP knowledge (pure logic; AC-16.5). The block is
 * surfaced by the caller as the `rate_limited` outcome → HTTP 429.
 *
 * @typedef {{ allowed: true } | { allowed: false, retryAfterMs: number }} GuardDecision
 * @typedef {{ failCount: number, throttleLevel: number, lockedUntil: number|null, lastFailAt: number }} GuardState
 */

const { performance } = require('perf_hooks');

/**
 * Default monotonic clock. `performance.now()` is a high-resolution, monotonic millisecond reading
 * relative to an arbitrary origin — immune to wall-clock/NTP adjustments (N-019). All of the
 * guard's time comparisons are relative (`lockedUntil = now + interval`, `retryAfterMs =
 * lockedUntil - now`), so an arbitrary origin is fine.
 * @returns {number} milliseconds
 */
function monotonicNow() {
  return performance.now();
}

/**
 * Pluggable state backend (§2.1). The default is process-local; a shared implementation (e.g.
 * Redis) can be injected behind the same contract. Shared implementations SHALL make their
 * read-modify-write atomic so concurrent failures across nodes do not lose increments (§6).
 *
 * @typedef {Object} BruteForceStore
 * @property {(username: string) => (GuardState|undefined)} read
 * @property {(username: string, state: GuardState) => void} write   atomic upsert
 * @property {(username: string) => void} delete
 */

/**
 * Default in-memory `BruteForceStore` backed by a `Map` (§2.1, §5). Correct for FUXA's default
 * single-process deployment (N-002), mirroring `express-rate-limit`'s default `MemoryStore`.
 * @implements {BruteForceStore}
 */
class InMemoryBruteForceStore {
  constructor() {
    /** @type {Map<string, GuardState>} */
    this._map = new Map();
  }

  /**
   * @param {string} username
   * @returns {GuardState|undefined}
   */
  read(username) {
    return this._map.get(username);
  }

  /**
   * @param {string} username
   * @param {GuardState} state
   * @returns {void}
   */
  write(username, state) {
    this._map.set(username, state);
  }

  /**
   * @param {string} username
   * @returns {void}
   */
  delete(username) {
    this._map.delete(username);
  }

  /** Test/introspection helper: current number of tracked usernames. @returns {number} */
  get size() {
    return this._map.size;
  }
}

/**
 * @typedef {Object} BruteForceConfig
 * @property {number}  [threshold]        consecutive failures that trip throttling; 0 ⇒ fail-closed (AC-15.3). Default 5.
 * @property {number}  [baseThrottleMs]   first throttle interval once the threshold is reached (AC-15.2). Default 30_000.
 * @property {number}  [backoffFactor]    multiplier per additional consecutive failure (>=1; 2 ⇒ exponential). Default 2.
 * @property {number}  [maxThrottleMs]    optional hard cap on the adaptive interval. Default 900_000 (15 min).
 * @property {number}  [failureWindowMs]  optional rolling window: only failures within it count as "consecutive". Default 0 (disabled).
 * @property {() => number} [clock]       injected monotonic clock (ms). Default `performance.now()`-based (N-019).
 * @property {BruteForceStore} [store]    pluggable state backend. Default in-memory `Map` (N-019/AC-15.6).
 */

/**
 * @implements {import('./interfaces').BruteForceGuard}
 */
class BruteForceGuard {
  /**
   * @param {BruteForceConfig} [cfg]
   */
  constructor(cfg = {}) {
    this.threshold = Number.isInteger(cfg.threshold) ? /** @type {number} */ (cfg.threshold) : 5;
    this.baseThrottleMs = cfg.baseThrottleMs != null ? cfg.baseThrottleMs : 30 * 1000;
    this.backoffFactor = cfg.backoffFactor != null ? cfg.backoffFactor : 2;
    // `maxThrottleMs` is an OPTIONAL cap. Absent ⇒ no cap (Infinity).
    this.maxThrottleMs = cfg.maxThrottleMs != null ? cfg.maxThrottleMs : 15 * 60 * 1000;
    this.failureWindowMs = cfg.failureWindowMs != null ? cfg.failureWindowMs : 0; // 0 = window disabled
    this.clock = typeof cfg.clock === 'function' ? cfg.clock : monotonicNow;
    /** @type {BruteForceStore} */
    this.store = cfg.store || new InMemoryBruteForceStore();
  }

  /**
   * Live-reconfigure the throttling parameters (D-049 runtime config). Only the numeric policy knobs
   * are updatable; the injected `clock`/`store` seams are left intact (swapping them at runtime would
   * strand in-flight counters). Each field is applied only when a valid value is supplied, otherwise
   * the current value is kept — the caller (AuthConfigService) validates bounds before calling. The
   * change takes effect on the NEXT `checkAllowed`/`recordFailure`; already-armed throttles keep
   * counting under the values captured when they were armed (no retroactive change).
   * @param {BruteForceConfig} [cfg]
   * @returns {void}
   */
  reconfigure(cfg = {}) {
    if (Number.isInteger(cfg.threshold) && /** @type {number} */(cfg.threshold) >= 0) {
      this.threshold = /** @type {number} */ (cfg.threshold);
    }
    if (typeof cfg.baseThrottleMs === 'number' && cfg.baseThrottleMs >= 0) {
      this.baseThrottleMs = cfg.baseThrottleMs;
    }
    if (typeof cfg.backoffFactor === 'number' && cfg.backoffFactor >= 1) {
      this.backoffFactor = cfg.backoffFactor;
    }
    if (typeof cfg.maxThrottleMs === 'number' && cfg.maxThrottleMs >= 0) {
      this.maxThrottleMs = cfg.maxThrottleMs;
    }
    if (typeof cfg.failureWindowMs === 'number' && cfg.failureWindowMs >= 0) {
      this.failureWindowMs = cfg.failureWindowMs;
    }
  }

  /**
   * Compute the adaptive backoff interval for a given throttle level `k` (= failCount - threshold).
   * `currentInterval = min(maxThrottleMs ?? Infinity, baseThrottleMs * backoffFactor^k)` (§2.2/§3).
   * @param {number} throttleLevel k, the number of failures past the threshold (>= 0)
   * @returns {number} the throttle interval in ms
   * @private
   */
  _interval(throttleLevel) {
    const cap = this.maxThrottleMs != null ? this.maxThrottleMs : Infinity;
    const raw = this.baseThrottleMs * Math.pow(this.backoffFactor, throttleLevel);
    return Math.min(cap, raw);
  }

  /**
   * Whether the current consecutive-failure chain for `state` is stale relative to `now`
   * (last failure older than the configured `failureWindowMs`). When the window is disabled
   * (0), a chain is never stale. Used for both consecutive-reset and lazy eviction (§6).
   * @param {GuardState} state
   * @param {number} now
   * @returns {boolean}
   * @private
   */
  _isStale(state, now) {
    return this.failureWindowMs > 0 && state.lastFailAt > 0 && (now - state.lastFailAt) > this.failureWindowMs;
  }

  /**
   * Whether a sign-in attempt for `username` is currently allowed (pre-check).
   * @param {string} username
   * @param {number} [now] injected monotonic clock reading (ms)
   * @returns {GuardDecision}
   */
  checkAllowed(username, now = this.clock()) {
    // AC-15.3 fail-closed: a threshold of 0 blocks EVERY username on EVERY call, regardless of
    // any prior state. `retryAfterMs` is a nominal positive hint (the base interval, capped).
    if (this.threshold === 0) {
      return { allowed: false, retryAfterMs: this._interval(0) };
    }

    const state = this.store.read(username);
    if (!state) {
      return { allowed: true };
    }

    // Currently throttled (AC-15.2): block with the remaining interval.
    if (state.lockedUntil != null && now < state.lockedUntil) {
      return { allowed: false, retryAfterMs: Math.max(0, state.lockedUntil - now) };
    }

    // Not currently locked — either never locked, or the interval has elapsed (AC-15.5).
    // Lazy eviction (§6): drop the entry when it carries no live counter (failCount 0) or when
    // its chain has gone stale past the failure window. Otherwise RETAIN it (DV-008: a further
    // failure after the interval elapses escalates from the retained throttleLevel).
    if (state.failCount === 0 || this._isStale(state, now)) {
      this.store.delete(username);
    }
    return { allowed: true };
  }

  /**
   * Record a failed attempt for `username` and, at/after the threshold, arm the adaptive throttle.
   * @param {string} username
   * @param {number} [now]
   * @returns {void}
   */
  recordFailure(username, now = this.clock()) {
    // AC-15.3 fail-closed: nothing to count when the threshold is 0 (checkAllowed already blocks).
    if (this.threshold === 0) {
      return;
    }

    let state = this.store.read(username);
    if (!state) {
      state = { failCount: 0, throttleLevel: 0, lockedUntil: null, lastFailAt: 0 };
    } else if (this._isStale(state, now)) {
      // The previous failure fell outside the rolling window ⇒ start a fresh consecutive chain.
      state = { failCount: 0, throttleLevel: 0, lockedUntil: null, lastFailAt: 0 };
    }

    const failCount = state.failCount + 1;
    const lastFailAt = now;
    let throttleLevel = state.throttleLevel;
    let lockedUntil = state.lockedUntil;

    if (failCount >= this.threshold) {
      // The Nth (and each further consecutive) failure arms/escalates the adaptive throttle.
      // k = failCount - threshold ⇒ k = 0 at the Nth failure (interval == baseThrottleMs).
      throttleLevel = failCount - this.threshold;
      lockedUntil = now + this._interval(throttleLevel);
    }

    // Read-modify-write with a fresh object (parity with shared/atomic stores; no in-place mutation).
    this.store.write(username, { failCount, throttleLevel, lockedUntil, lastFailAt });
  }

  /**
   * Clear all state for `username` — zeroes failCount AND throttleLevel AND lockedUntil (AC-15.4).
   * Called on a successful sign-in. The adaptive backoff restarts from `baseThrottleMs` afterward.
   * @param {string} username
   * @returns {void}
   */
  reset(username) {
    this.store.delete(username);
  }
}

module.exports = { BruteForceGuard, InMemoryBruteForceStore, monotonicNow };
