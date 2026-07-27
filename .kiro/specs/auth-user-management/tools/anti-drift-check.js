#!/usr/bin/env node
'use strict';

/**
 * anti-drift-check.js — the MECHANICAL half of the anti-drift kit (N-095).
 *
 * WHY THIS EXISTS. Every drift incident in this spec so far was caught by a human/agent re-reading the
 * ledger, i.e. by discipline: the ledger overwrite (N-020), the duplicate-ID re-derivation (N-060), the
 * cross-machine parallel work (N-081), the six decisions that shipped with no plan/traceability row and
 * the `P-` high-water that sat stale for ten days (N-094). The existing hooks ASK AN AGENT to look —
 * useful, but an agent can be busy, mid-context-compaction, or simply not run. This script decides the
 * same questions deterministically and exits NON-ZERO, so the answer no longer depends on remembering.
 *
 * It is intentionally: zero-dependency (plain Node ≥18), read-only (never writes a file, so it can be
 * wired to a save-time hook without the N-034 self-trigger loop), and fast (pure text scans).
 *
 * CHECKS
 *   1. Manifest presence + required markers      — the N-020 failure mode (file overwritten/truncated).
 *   2. Ledger ID hygiene                         — monotonic, no duplicates, no gaps, and the
 *                                                  00-INDEX §2 high-water EQUALS the real maximum
 *                                                  (the N-094 stale-high-water failure mode).
 *   3. `D-*` traceability coverage                — every decision reachable from traceability.md or
 *                                                  tasks.md (the N-094 "shipped but untraced" mode).
 *   4. `P-*` property coverage                    — the highest property id referenced by design or by
 *                                                  the test suite must not exceed the manifest
 *                                                  high-water (catches N-094's exact miss, which a
 *                                                  heading-based ID scan structurally cannot see).
 *   5. Domain-contamination scan                  — chat-transcript markers inside a ledger file (N-020).
 *   6. TO-003 quarantine                          — the unrecoverable id must stay quarantined.
 *
 * USAGE
 *   node .kiro/specs/auth-user-management/tools/anti-drift-check.js            # human-readable report
 *   node ...anti-drift-check.js --quiet                                        # only failures
 * EXIT CODES: 0 = all checks pass · 1 = at least one check FAILED · 2 = the checker itself could not run.
 *
 * DELIBERATE NON-GOALS (so nobody mistakes a pass for proof of correctness):
 *   - It does NOT judge whether a decision is GOOD, nor whether a traced test actually asserts anything.
 *   - It does NOT run the test suites (that is the build's job).
 *   - It cannot detect a semantically wrong ledger entry — only a structurally missing/inconsistent one.
 */

const fs = require('fs');
const path = require('path');

const SPEC_DIR = path.resolve(__dirname, '..');
const DEC = path.join(SPEC_DIR, 'decisions');
const QUIET = process.argv.includes('--quiet');

/** @type {{name: string, ok: boolean, details: string[]}[]} */
const results = [];
let hardError = null;

function read(file) {
    return fs.readFileSync(file, 'utf8');
}
function exists(file) {
    return fs.existsSync(file);
}
function record(name, failures, note) {
    results.push({ name, ok: failures.length === 0, details: failures, note: note || '' });
}

// ---------------------------------------------------------------------------
// 1. Manifest presence + required markers
// ---------------------------------------------------------------------------

/**
 * The structural markers declared by 00-INDEX §1, expressed as literal substrings (kept literal on
 * purpose: a regex here would drift from the manifest's own wording).
 */
const MANIFEST = [
    ['requirements.md', ['### Requirement 1', '### Requirement 17', '#### Acceptance Criteria']],
    ['design.md', ['## Architecture', '## Table of Contents', '## Correctness Properties']],
    ['tasks.md', ['## Tasks', '## Task Dependency Graph', '## Notes']],
    ['decisions/README.md', ['## 2. Stable ID scheme', '## 4. The anti-drift protocol']],
    ['decisions/00-INDEX.md', ['## 1. File manifest', '## 2. ID high-water marks', '## 3. Drift-incident log']],
    ['decisions/01-ai-decisions.md', ['### D-001']],
    ['decisions/02-deviations.md', ['### DV-001']],
    ['decisions/03-tradeoffs.md', ['### TO-001', 'Alternatives considered']],
    ['decisions/04-notes.md', ['### N-001']],
    ['decisions/traceability.md', ['## B. Requirement', '## D. Design', '## F. Design-Defect Register']],
    ['decisions/GATES.md', ['## Gates', '## Roadmap']],
];

function checkManifest() {
    const failures = [];
    for (const [rel, markers] of MANIFEST) {
        const file = path.join(SPEC_DIR, rel);
        if (!exists(file)) {
            failures.push(`MISSING FILE: ${rel}`);
            continue;
        }
        const body = read(file);
        for (const marker of markers) {
            if (!body.includes(marker)) {
                failures.push(`${rel}: required marker absent → "${marker}"`);
            }
        }
    }
    record('manifest presence + markers', failures, `${MANIFEST.length} files declared`);
}

// ---------------------------------------------------------------------------
// 2. Ledger ID hygiene (monotonic, unique, gapless, high-water accurate)
// ---------------------------------------------------------------------------

const LEDGERS = [
    ['D', 'decisions/01-ai-decisions.md'],
    ['DV', 'decisions/02-deviations.md'],
    ['TO', 'decisions/03-tradeoffs.md'],
    ['N', 'decisions/04-notes.md'],
];

function idsOf(prefix, rel) {
    const body = read(path.join(SPEC_DIR, rel));
    const re = new RegExp(`^### ${prefix}-(\\d+)`, 'gm');
    const out = [];
    let m;
    while ((m = re.exec(body)) !== null) {
        out.push(Number(m[1]));
    }
    return out;
}

/** Parse the §2 high-water table: `| \`D-\`   | 051 | …` */
function highWater() {
    const body = read(path.join(DEC, '00-INDEX.md'));
    const map = {};
    const re = /^\|\s*`([A-Z]+)-`\s*\|\s*(\d+)\s*\|/gm;
    let m;
    while ((m = re.exec(body)) !== null) {
        map[m[1]] = Number(m[2]);
    }
    return map;
}

function checkIds() {
    const failures = [];
    const hw = highWater();
    const counts = [];
    for (const [prefix, rel] of LEDGERS) {
        const ids = idsOf(prefix, rel);
        if (ids.length === 0) {
            failures.push(`${rel}: no ${prefix}-* entries found (file emptied or heading style changed?)`);
            continue;
        }
        const seen = new Set();
        for (const id of ids) {
            if (seen.has(id)) {
                failures.push(`${prefix}-${String(id).padStart(3, '0')}: DUPLICATE id (ids are never reused)`);
            }
            seen.add(id);
        }
        const max = Math.max(...ids);
        for (let i = 1; i <= max; i++) {
            if (!seen.has(i)) {
                failures.push(`${prefix}-${String(i).padStart(3, '0')}: MISSING from the sequence (ids are never deleted)`);
            }
        }
        if (hw[prefix] === undefined) {
            failures.push(`00-INDEX §2: no high-water row for \`${prefix}-\``);
        } else if (hw[prefix] !== max) {
            failures.push(`00-INDEX §2 high-water for \`${prefix}-\` is ${hw[prefix]} but the ledger's real maximum is ${max}`);
        }
        counts.push(`${prefix}=${ids.length}/${max}`);
    }
    record('ledger id hygiene + high-water accuracy', failures, counts.join(' '));
    return hw;
}

// ---------------------------------------------------------------------------
// 3. D-* traceability coverage  (the N-094 root fix)
// ---------------------------------------------------------------------------

function checkDecisionCoverage() {
    const failures = [];
    const ids = idsOf('D', 'decisions/01-ai-decisions.md');
    const trace = read(path.join(DEC, 'traceability.md'));
    const tasks = read(path.join(SPEC_DIR, 'tasks.md'));
    for (const n of ids) {
        const id = `D-${String(n).padStart(3, '0')}`;
        if (!trace.includes(id) && !tasks.includes(id)) {
            failures.push(`${id}: reachable from NEITHER traceability.md NOR tasks.md — add a §D.2/§D.3 row (or a task) so the decision's realization is verifiable`);
        }
    }
    record('D-* traceability coverage (no exemption list)', failures, `${ids.length} decisions checked`);
}

// ---------------------------------------------------------------------------
// 4. P-* property coverage  (catches the exact N-094 miss)
// ---------------------------------------------------------------------------

function walk(dir, filter, acc = []) {
    if (!exists(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            walk(full, filter, acc);
        } else if (filter(entry.name)) {
            acc.push(full);
        }
    }
    return acc;
}

function checkPropertyCoverage(hw) {
    const failures = [];
    const REPO = path.resolve(SPEC_DIR, '..', '..', '..');
    const sources = [
        ...walk(path.join(SPEC_DIR, 'design'), (f) => f.endsWith('.md')),
        path.join(SPEC_DIR, 'design.md'),
        path.join(SPEC_DIR, 'tasks.md'),
        ...walk(path.join(REPO, 'server', 'test', 'auth-management'), (f) => f.endsWith('.test.js')),
    ].filter(exists);

    let maxSeen = 0;
    const where = new Map();
    for (const file of sources) {
        const body = read(file);
        const re = /\bP-(\d{3})\b/g;
        let m;
        while ((m = re.exec(body)) !== null) {
            const n = Number(m[1]);
            if (n > maxSeen) {
                maxSeen = n;
            }
            if (!where.has(n)) {
                where.set(n, path.relative(REPO, file));
            }
        }
    }
    if (maxSeen === 0) {
        failures.push('no P-### reference found in design/tasks/tests — the scan is broken or the ids were renamed');
    } else if (hw['P'] === undefined) {
        failures.push('00-INDEX §2: no high-water row for `P-`');
    } else if (maxSeen > hw['P']) {
        failures.push(`P-${String(maxSeen).padStart(3, '0')} is referenced by ${where.get(maxSeen)} but the 00-INDEX §2 \`P-\` high-water is only ${hw['P']} — a property shipped without being recorded (the N-094 failure mode)`);
    }
    record('P-* property high-water vs design/tests', failures, `max referenced P-${String(maxSeen).padStart(3, '0')}, manifest ${hw['P']}`);
}

// ---------------------------------------------------------------------------
// 5. Domain contamination (N-020) + 6. TO-003 quarantine
// ---------------------------------------------------------------------------

/** Markers that only ever appear when a chat transcript was pasted over a ledger file (N-020). */
const TRANSCRIPT_MARKERS = ['Est. Credits Used', 'Elapsed time:', 'Accepted edits to', 'Searched workspace'];

function checkContamination() {
    const failures = [];
    for (const [, rel] of LEDGERS) {
        const body = read(path.join(SPEC_DIR, rel));
        for (const marker of TRANSCRIPT_MARKERS) {
            if (body.includes(marker)) {
                failures.push(`${rel}: contains transcript marker "${marker}" — a ledger file was overwritten with chat output (N-020 failure mode)`);
            }
        }
    }
    record('ledger domain contamination', failures);
}

function checkQuarantine() {
    const failures = [];
    const body = read(path.join(DEC, '00-INDEX.md'));
    if (!/TO-003\s+QUARANTINED/.test(body.replace(/\*/g, ''))) {
        failures.push('00-INDEX §2: the `TO-003 QUARANTINED` declaration is missing — the unrecoverable id must never be reused');
    }
    record('TO-003 quarantine declaration', failures);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

try {
    checkManifest();
    const hw = checkIds();
    checkDecisionCoverage();
    checkPropertyCoverage(hw);
    checkContamination();
    checkQuarantine();
} catch (e) {
    hardError = e;
}

if (hardError) {
    console.error('anti-drift-check: COULD NOT RUN → ' + (hardError && hardError.message));
    process.exit(2);
}

const failed = results.filter((r) => !r.ok);
if (!QUIET) {
    console.log('anti-drift-check — auth-user-management');
    for (const r of results) {
        const tag = r.ok ? 'PASS' : 'FAIL';
        console.log(`  [${tag}] ${r.name}${r.note ? '  (' + r.note + ')' : ''}`);
    }
}
for (const r of failed) {
    console.error(`\nFAILED: ${r.name}`);
    for (const d of r.details) {
        console.error('  - ' + d);
    }
}
if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) FAILED. Fix the ledger/traceability before continuing (see decisions/00-INDEX.md §4 + GATES.md).`);
    process.exit(1);
}
if (!QUIET) {
    console.log('\nAll checks passed.');
}
process.exit(0);
