/**
 * Headless jest specs for the pure `RotatePasswordPresenter` (DV-010 · REQ-17 AC-17.2/17.3, D-045).
 *
 * Framework-free: direct instantiation with plain stub seams (mirrors `login-presenter.spec.ts`).
 * `rotate` returns an rxjs `of(void)` / `throwError(...)` or a controllable `Subject` (to observe the
 * in-flight `pending` window); `onRotated` is a jest spy. No TestBed, no DOM.
 */

import { of, throwError, Subject } from 'rxjs';

import { RotatePasswordPresenter, ROTATE_ERROR_KEYS, RotatePasswordPresenterSeams } from './rotate-password-presenter';
import type { RotateError } from '../clients/auth-protocol';

function makePresenter(rotateImpl?: RotatePasswordPresenterSeams['rotate']) {
    const rotate = jest.fn(rotateImpl ?? (() => of(void 0)));
    const onRotated = jest.fn();
    const presenter = new RotatePasswordPresenter({ rotate, onRotated });
    return { presenter, rotate, onRotated };
}

function fill(p: RotatePasswordPresenter, current: string, next: string, confirm: string) {
    p.currentPassword = current;
    p.newPassword = next;
    p.confirmPassword = confirm;
}

describe('RotatePasswordPresenter.canSubmit', () => {
    it('is true only when all three fields are non-empty (trimmed) and not pending', () => {
        const { presenter } = makePresenter();
        expect(presenter.canSubmit()).toBe(false);
        fill(presenter, 'old', 'newpassword12', 'newpassword12');
        expect(presenter.canSubmit()).toBe(true);
        presenter.confirmPassword = '   ';
        expect(presenter.canSubmit()).toBe(false);
        presenter.confirmPassword = 'newpassword12';
        presenter.pending = true;
        expect(presenter.canSubmit()).toBe(false);
    });
});

describe('RotatePasswordPresenter.submit', () => {
    it('confirm-mismatch blocks the request and shows the mismatch key', () => {
        const { presenter, rotate } = makePresenter();
        fill(presenter, 'old', 'newpassword12', 'different99');
        presenter.submit();
        expect(rotate).not.toHaveBeenCalled();
        expect(presenter.errorKey).toBe(ROTATE_ERROR_KEYS.mismatch);
        expect(presenter.pending).toBe(false);
    });

    it('sends exactly one rotate request with the current+new secrets on a valid submit', () => {
        const { presenter, rotate } = makePresenter();
        fill(presenter, 'one-time-secret', 'BrandNewPass12', 'BrandNewPass12');
        presenter.submit();
        expect(rotate).toHaveBeenCalledTimes(1);
        expect(rotate).toHaveBeenCalledWith('one-time-secret', 'BrandNewPass12');
    });

    it('success → success=true, pending=false, and onRotated() invoked (clear session + go to login)', () => {
        const { presenter, onRotated } = makePresenter(() => of(void 0));
        fill(presenter, 'old', 'BrandNewPass12', 'BrandNewPass12');
        presenter.submit();
        expect(presenter.success).toBe(true);
        expect(presenter.pending).toBe(false);
        expect(onRotated).toHaveBeenCalledTimes(1);
        expect(presenter.errorKey).toBeNull();
    });

    it('bad_current_password → maps to the bad-current key, STAYS on page, does not call onRotated', () => {
        const err: RotateError = { errorId: 'bad_current_password', status: 400 };
        const { presenter, onRotated } = makePresenter(() => throwError(() => err));
        fill(presenter, 'wrong', 'BrandNewPass12', 'BrandNewPass12');
        presenter.submit();
        expect(presenter.errorKey).toBe(ROTATE_ERROR_KEYS.badCurrent);
        expect(presenter.pending).toBe(false);
        expect(presenter.success).toBe(false);
        expect(onRotated).not.toHaveBeenCalled();
    });

    it('weak_or_reused_password → maps to the weak/reused key', () => {
        const err: RotateError = { errorId: 'weak_or_reused_password', status: 400, detail: 'too short' };
        const { presenter } = makePresenter(() => throwError(() => err));
        fill(presenter, 'old', 'short', 'short');
        presenter.submit();
        expect(presenter.errorKey).toBe(ROTATE_ERROR_KEYS.weakOrReused);
    });

    it('unknown/transport error → generic failed key', () => {
        const { presenter } = makePresenter(() => throwError(() => ({ errorId: 'unexpected_error', status: 0 } as RotateError)));
        fill(presenter, 'old', 'BrandNewPass12', 'BrandNewPass12');
        presenter.submit();
        expect(presenter.errorKey).toBe(ROTATE_ERROR_KEYS.failed);
    });

    it('pending is true DURING the in-flight request and false after it settles', () => {
        const subject = new Subject<void>();
        const { presenter } = makePresenter(() => subject.asObservable());
        fill(presenter, 'old', 'BrandNewPass12', 'BrandNewPass12');
        presenter.submit();
        expect(presenter.pending).toBe(true);          // in flight
        expect(presenter.canSubmit()).toBe(false);     // disabled while pending
        subject.next();
        subject.complete();
        expect(presenter.pending).toBe(false);          // settled
    });
});

describe('RotatePasswordPresenter.mapErrorKey', () => {
    it('maps each stable id and falls back to the generic key', () => {
        expect(RotatePasswordPresenter.mapErrorKey('bad_current_password')).toBe(ROTATE_ERROR_KEYS.badCurrent);
        expect(RotatePasswordPresenter.mapErrorKey('weak_or_reused_password')).toBe(ROTATE_ERROR_KEYS.weakOrReused);
        expect(RotatePasswordPresenter.mapErrorKey('unexpected_error')).toBe(ROTATE_ERROR_KEYS.failed);
        expect(RotatePasswordPresenter.mapErrorKey(undefined)).toBe(ROTATE_ERROR_KEYS.failed);
        expect(RotatePasswordPresenter.mapErrorKey('nonsense')).toBe(ROTATE_ERROR_KEYS.failed);
    });
});
