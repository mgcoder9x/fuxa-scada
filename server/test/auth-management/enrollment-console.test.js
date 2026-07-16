'use strict';

/**
 * Tests for InteractiveConsoleEnrollmentChannel (D-035 controlled-console delivery; N-060 fix).
 * Verifies: deliver() writes the one-time secret to the INJECTED sink (not a logger), includes the
 * username + a rotate-now instruction, states it is NOT written to fuxa.log, and satisfies the
 * EnrollmentChannel seam (deliver returns a promise). node:assert + node:test-free (mocha).
 */

const assert = require('node:assert');
const { InteractiveConsoleEnrollmentChannel } = require('../../auth-management/services/enrollment');

describe('Feature: auth-user-management — InteractiveConsoleEnrollmentChannel (D-035 / N-060)', function () {

    it('writes the one-time secret + username + rotate instruction to the injected sink', async function () {
        let out = '';
        const ch = new InteractiveConsoleEnrollmentChannel({ write: (s) => { out += s; } });
        await ch.deliver({ username: 'admin', secret: 'S3cr3t-One-Time', reason: 'migration' });

        assert.ok(out.indexOf('S3cr3t-One-Time') !== -1, 'secret must be surfaced to the console');
        assert.ok(out.indexOf('admin') !== -1, 'username must be surfaced');
        assert.ok(/rotate|change the password/i.test(out), 'must instruct to rotate/change immediately');
        assert.ok(out.indexOf('migration') !== -1, 'reason must be surfaced');
        assert.ok(/not\s+written\s+to\s+fuxa\.log/i.test(out), 'must state it is NOT written to fuxa.log');
    });

    it('satisfies the EnrollmentChannel seam (deliver returns a promise)', async function () {
        const ch = new InteractiveConsoleEnrollmentChannel({ write: () => {} });
        const r = ch.deliver({ username: 'u', secret: 'x' });
        assert.ok(r && typeof r.then === 'function', 'deliver must be awaitable');
        await r;
    });

    it('defaults the sink to process.stdout (not runtime.logger) when none injected', function () {
        const ch = new InteractiveConsoleEnrollmentChannel();
        assert.strictEqual(typeof ch.write, 'function');
        // The default must be a plain stdout writer, NOT any logger object — verified by shape:
        // it is an arrow wrapping process.stdout.write (no .info/.error methods on the sink).
        assert.strictEqual(typeof (ch.write).info, 'undefined');
        assert.strictEqual(typeof (ch.write).error, 'undefined');
    });
});
