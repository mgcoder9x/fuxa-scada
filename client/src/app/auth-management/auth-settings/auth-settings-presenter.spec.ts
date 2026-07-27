/**
 * D-049 Phase 2 — Auth-Settings presenter specs (DV-010: direct instantiation, no TestBed/DOM).
 *
 * The behaviours pinned here are the ones a review would actually worry about:
 *  - the gate (settings.read to view, settings.manage to change) and that a denied identity issues NO request;
 *  - **only CHANGED keys are submitted** — the endpoint takes a partial patch, and re-sending untouched
 *    values would silently pin config an operator never looked at (and pollute the audit entry);
 *  - validation uses the SERVER-provided bounds and SKIPS range checks when the server sent none, so the
 *    page can never invent a limit (the N-091 L3 lesson: never hand-copy policy);
 *  - the duration grammar is NOT re-implemented client-side (no second source of truth);
 *  - a server rejection keeps the operator on the form with a translated KEY, never server text (§9);
 *  - reset is two-step and adopts whatever the server returns.
 */

import { of, throwError } from 'rxjs';
import {
    AuthSettingsPresenter, AUTH_SETTINGS_KEYS, mapSettingsErrorKey, parseBlocklist,
} from './auth-settings-presenter';
import type { AuthConfigView } from '../clients/auth-protocol';
import type { AuthConfigPatch } from '../clients/auth-config.client';

const VIEW: AuthConfigView = {
    config: {
        passwordMinLength: 12,
        passwordBlocklist: ['password', 'letmein12345'],
        tokenExpiresIn: '1h',
        refreshTokenExpiresIn: '7d',
        bcryptCost: 12,
        bruteForce: { threshold: 5, baseThrottleMs: 30000, backoffFactor: 2, maxThrottleMs: 900000, failureWindowMs: 0 },
    },
    bounds: {
        passwordMinLength: { min: 8, max: 128 },
        bcryptCost: { min: 10, max: 15 },
        blocklistMaxEntries: 5000,
        blocklistMaxEntryLen: 256,
    },
};

function clone(v: AuthConfigView): AuthConfigView {
    return JSON.parse(JSON.stringify(v));
}

function make(overrides: any = {}) {
    const saved: AuthConfigPatch[] = [];
    const load: any = jest.fn(overrides.load ?? (() => of(clone(VIEW))));
    const save: any = jest.fn(overrides.save ?? ((patch: AuthConfigPatch) => { saved.push(patch); return of(clone(VIEW)); }));
    const reset: any = jest.fn(overrides.reset ?? (() => of(clone(VIEW))));
    const presenter = new AuthSettingsPresenter({
        canRead: overrides.canRead ?? (() => true),
        canManage: overrides.canManage ?? (() => true),
        load, save, reset,
    });
    return { presenter, load, save, reset, saved };
}

describe('AuthSettingsPresenter access gate', () => {
    it('denies without settings.read and issues NO request', () => {
        const { presenter, load } = make({ canRead: () => false });
        presenter.init();
        expect(presenter.access).toBe('denied');
        expect(presenter.errorKey).toBe(AUTH_SETTINGS_KEYS.unauthorized);
        expect(load).not.toHaveBeenCalled();
    });

    it('grants + loads with settings.read, and populates the form from the effective config', () => {
        const { presenter, load } = make();
        presenter.init();
        expect(presenter.access).toBe('granted');
        expect(load).toHaveBeenCalledTimes(1);
        expect(presenter.form.passwordMinLength).toBe('12');
        expect(presenter.form.tokenExpiresIn).toBe('1h');
        expect(presenter.form.blocklist).toBe('password\nletmein12345');
        expect(presenter.bounds?.bcryptCost).toEqual({ min: 10, max: 15 });
        expect(presenter.loading).toBe(false);
    });

    it('a server 403 on load flips the page to denied (server is the boundary)', () => {
        const { presenter } = make({ load: () => throwError(() => ({ errorId: 'forbidden', status: 403 })) });
        presenter.init();
        expect(presenter.access).toBe('denied');
        expect(presenter.errorKey).toBe(AUTH_SETTINGS_KEYS.unauthorized);
    });

    it('read-only for settings.read WITHOUT settings.manage: cannot submit or reset', () => {
        const { presenter, save, reset } = make({ canManage: () => false });
        presenter.init();
        expect(presenter.readOnly).toBe(true);
        presenter.form.passwordMinLength = '20';
        expect(presenter.canSubmit()).toBe(false);
        presenter.submit();
        presenter.askReset();
        expect(presenter.confirmingReset).toBe(false);
        presenter.confirmReset();
        expect(save).not.toHaveBeenCalled();
        expect(reset).not.toHaveBeenCalled();
    });
});

describe('AuthSettingsPresenter patch building — ONLY changed keys', () => {
    it('an untouched form is not dirty and submitting does nothing', () => {
        const { presenter, save } = make();
        presenter.init();
        expect(presenter.buildPatch()).toEqual({});
        expect(presenter.isDirty).toBe(false);
        expect(presenter.canSubmit()).toBe(false);
        presenter.submit();
        expect(save).not.toHaveBeenCalled();
    });

    it('sends exactly the changed scalar, nothing else', () => {
        const { presenter, saved } = make();
        presenter.init();
        presenter.form.passwordMinLength = '16';
        presenter.submit();
        expect(saved).toEqual([{ passwordMinLength: 16 }]);
    });

    it('sends only the changed bruteForce sub-keys (not the whole object)', () => {
        const { presenter, saved } = make();
        presenter.init();
        presenter.form.bfThreshold = '3';
        presenter.form.bfMaxThrottleMs = '600000';
        presenter.submit();
        expect(saved).toEqual([{ bruteForce: { threshold: 3, maxThrottleMs: 600000 } }]);
    });

    it('treats the duration as opaque and only submits it when the TEXT changed', () => {
        const { presenter } = make();
        presenter.init();
        presenter.form.tokenExpiresIn = '1h';           // same text
        expect(presenter.buildPatch().tokenExpiresIn).toBeUndefined();
        presenter.form.tokenExpiresIn = '30 minutes';   // server owns the grammar
        expect(presenter.buildPatch().tokenExpiresIn).toBe('30 minutes');
    });

    it('normalizes the blocklist textarea (trim, drop blanks, de-duplicate, keep order)', () => {
        expect(parseBlocklist(' a \n\n b \na\n')).toEqual(['a', 'b']);
        const { presenter } = make();
        presenter.init();
        presenter.form.blocklist = 'password\n\n  letmein12345  \npassword';
        expect(presenter.buildPatch().passwordBlocklist).toBeUndefined(); // same set after normalizing
        presenter.form.blocklist = 'password\nnew-entry';
        expect(presenter.buildPatch().passwordBlocklist).toEqual(['password', 'new-entry']);
    });

    it('adopts the config the SERVER returns after a save (so the form reflects reality, not the request)', () => {
        const returned = clone(VIEW);
        returned.config.passwordMinLength = 20;
        const { presenter } = make({ save: () => of(returned) });
        presenter.init();
        presenter.form.passwordMinLength = '16';
        presenter.submit();
        expect(presenter.form.passwordMinLength).toBe('20');
        expect(presenter.saved).toBe(true);
        expect(presenter.isDirty).toBe(false);
    });
});

describe('AuthSettingsPresenter DOM-type robustness (regression for a BROWSER-found defect)', () => {
    /**
     * Angular's `[(ngModel)]` on an `<input type="number">` writes back a **number**, and a cleared
     * number input writes `null`. The first version of this presenter typed every field as `string` and
     * called `.trim()`; these specs passed (they set strings) while the real page threw
     * `this.form.bcryptCost.trim is not a function` on every change-detection pass — caught only by
     * opening the page in a browser. The presenter now coerces at a single boundary, and these cases
     * lock that in so the defect cannot come back.
     */
    it('accepts NUMBER values from a number input (was: TypeError on .trim)', () => {
        const { presenter, saved } = make();
        presenter.init();
        presenter.form.bcryptCost = 13 as any;
        presenter.form.passwordMinLength = 16 as any;
        presenter.form.bfThreshold = 3 as any;
        expect(() => presenter.isDirty).not.toThrow();
        expect(presenter.validate()).toBe(true);
        presenter.submit();
        expect(saved).toEqual([{ passwordMinLength: 16, bcryptCost: 13, bruteForce: { threshold: 3 } }]);
    });

    it('treats a CLEARED number input (null/undefined) as empty, not as a crash', () => {
        const { presenter, save } = make();
        presenter.init();
        presenter.form.passwordMinLength = null as any;
        expect(() => presenter.validate()).not.toThrow();
        expect(presenter.fieldError('passwordMinLength')?.key).toBe('msg.settings-field-required');
        presenter.submit();
        expect(save).not.toHaveBeenCalled();
    });

    it('a numeric duration (seconds) is accepted and compared as text', () => {
        const { presenter, saved } = make();
        presenter.init();
        presenter.form.tokenExpiresIn = 3600 as any;
        expect(presenter.validate()).toBe(true);
        presenter.submit();
        expect(saved).toEqual([{ tokenExpiresIn: '3600' }]);
    });
});

describe('AuthSettingsPresenter validation against SERVER bounds', () => {
    it('rejects an out-of-range value using the server range, with params for the message', () => {
        const { presenter, save } = make();
        presenter.init();
        presenter.form.bcryptCost = '99';
        presenter.submit();
        expect(save).not.toHaveBeenCalled();
        expect(presenter.fieldError('bcryptCost')).toEqual({ key: 'msg.settings-field-range', params: { min: 10, max: 15 } });
        expect(presenter.errorKey).toBe(AUTH_SETTINGS_KEYS.invalid);
    });

    it('rejects non-integers, empty values and sub-minimum numbers', () => {
        const { presenter } = make();
        presenter.init();
        presenter.form.passwordMinLength = '12.5';
        presenter.form.bfBackoffFactor = '0.5';
        presenter.form.tokenExpiresIn = '   ';
        presenter.validate();
        expect(presenter.fieldError('passwordMinLength')?.key).toBe('msg.settings-field-integer');
        expect(presenter.fieldError('bfBackoffFactor')).toEqual({ key: 'msg.settings-field-min', params: { min: 1 } });
        expect(presenter.fieldError('tokenExpiresIn')?.key).toBe('msg.settings-field-required');
    });

    it('SKIPS range checks when the server sent no bounds (never invents a limit)', () => {
        const noBounds = clone(VIEW);
        noBounds.bounds = null;
        const { presenter, saved } = make({ load: () => of(noBounds) });
        presenter.init();
        expect(presenter.bounds).toBeNull();
        presenter.form.bcryptCost = '99';           // out of the REAL range, but we were not told it
        expect(presenter.validate()).toBe(true);     // → let the server judge
        presenter.submit();
        expect(saved).toEqual([{ bcryptCost: 99 }]);
    });

    it('enforces blocklist size limits from the server bounds', () => {
        const tight = clone(VIEW);
        tight.bounds!.blocklistMaxEntries = 2;
        tight.bounds!.blocklistMaxEntryLen = 8;
        const { presenter } = make({ load: () => of(tight) });
        presenter.init();
        presenter.form.blocklist = 'a\nb\nc';
        presenter.validate();
        expect(presenter.fieldError('blocklist')).toEqual({ key: 'msg.settings-blocklist-too-many', params: { max: 2 } });
        presenter.form.blocklist = 'way-too-long-entry';
        presenter.validate();
        expect(presenter.fieldError('blocklist')).toEqual({ key: 'msg.settings-blocklist-entry-too-long', params: { max: 8 } });
    });
});

describe('AuthSettingsPresenter server rejection, reset and revert', () => {
    it('a 400 keeps the operator on the form with a GENERIC key (server text never rendered)', () => {
        const { presenter } = make({
            save: () => throwError(() => ({ errorId: 'validation_error', status: 400 })),
        });
        presenter.init();
        presenter.form.passwordMinLength = '16';
        presenter.submit();
        expect(presenter.access).toBe('granted');
        expect(presenter.errorKey).toBe(AUTH_SETTINGS_KEYS.invalid);
        expect(presenter.savePending).toBe(false);
        expect(presenter.form.passwordMinLength).toBe('16'); // the operator's input is preserved
    });

    it('reset is TWO-STEP and adopts what the server returns', () => {
        const afterReset = clone(VIEW);
        afterReset.config.passwordMinLength = 12;
        afterReset.config.bruteForce.threshold = 5;
        const { presenter, reset } = make({ reset: () => of(afterReset) });
        presenter.init();
        presenter.form.passwordMinLength = '30';
        presenter.askReset();
        expect(presenter.confirmingReset).toBe(true);
        expect(reset).not.toHaveBeenCalled();     // step 1 must not mutate anything
        presenter.cancelReset();
        expect(presenter.confirmingReset).toBe(false);
        expect(reset).not.toHaveBeenCalled();
        presenter.askReset();
        presenter.confirmReset();
        expect(reset).toHaveBeenCalledTimes(1);
        expect(presenter.confirmingReset).toBe(false);
        expect(presenter.form.passwordMinLength).toBe('12');
        expect(presenter.saved).toBe(true);
    });

    it('revert restores the loaded config locally without any request', () => {
        const { presenter, load } = make();
        presenter.init();
        presenter.form.passwordMinLength = '40';
        presenter.revert();
        expect(presenter.form.passwordMinLength).toBe('12');
        expect(presenter.isDirty).toBe(false);
        expect(load).toHaveBeenCalledTimes(1); // still just the initial load
    });

    it('maps error ids to generic page keys', () => {
        expect(mapSettingsErrorKey('forbidden')).toBe(AUTH_SETTINGS_KEYS.unauthorized);
        expect(mapSettingsErrorKey('validation_error')).toBe(AUTH_SETTINGS_KEYS.invalid);
        expect(mapSettingsErrorKey('unexpected_error')).toBe(AUTH_SETTINGS_KEYS.failed);
        expect(mapSettingsErrorKey(undefined)).toBe(AUTH_SETTINGS_KEYS.failed);
    });
});
