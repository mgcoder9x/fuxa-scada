/**
 * Headless jest specs for the pure `LoginPresenter` (DV-010 · REQ-11, AC-11.2..11.5).
 *
 * The presenter is framework-free, so it is exercised by DIRECT instantiation with plain stub seams
 * (mirroring `auth-clients.spec.ts`): `signIn` returns an rxjs `of(...)` / `throwError(...)` or a
 * controllable `Subject` (to observe the in-flight `pending` window); `saveSession`/`navigateToApp`
 * are jest spies. No TestBed, no DOM. AC-11.1 (which controls exist) is markup-only and is covered by
 * `ng build` compiling the template + inspection (DV-010), not here.
 */

import { of, throwError, Subject } from 'rxjs';

import { LoginPresenter, SIGNIN_ERROR_KEYS, LoginPresenterSeams } from './login-presenter';
import type { SignInResult, SignInError, SignInErrorId } from '../clients/auth-protocol';

const OK: SignInResult = { token: 'T', username: 'admin', fullname: 'Admin', roles: ['admin'] };

/** Build a presenter with jest-spy seams; `signIn` defaults to a success emission. */
function makePresenter(signInImpl?: LoginPresenterSeams['signIn']) {
    const signIn = jest.fn(signInImpl ?? (() => of(OK)));
    const saveSession = jest.fn();
    const navigateToApp = jest.fn();
    const presenter = new LoginPresenter({ signIn, saveSession, navigateToApp });
    return { presenter, signIn, saveSession, navigateToApp };
}

describe('LoginPresenter.canSubmit (AC-11.2, AC-11.5)', () => {
    it('is true only when BOTH fields are non-empty after trim and not pending', () => {
        const { presenter } = makePresenter();
        expect(presenter.canSubmit()).toBe(false);          // both empty

        presenter.username = 'admin';
        expect(presenter.canSubmit()).toBe(false);          // password empty

        presenter.password = 'pw';
        expect(presenter.canSubmit()).toBe(true);           // both populated

        presenter.username = '   ';
        expect(presenter.canSubmit()).toBe(false);          // whitespace-only trims to empty

        presenter.username = 'admin';
        presenter.pending = true;
        expect(presenter.canSubmit()).toBe(false);          // in-flight disables submit
    });
});

describe('LoginPresenter.submit request dispatch (AC-11.2)', () => {
    it('sends exactly one request with TRIMMED credentials when both fields are populated', () => {
        const { presenter, signIn } = makePresenter();
        presenter.username = '  admin  ';
        presenter.password = '  secret  ';

        presenter.submit();

        expect(signIn).toHaveBeenCalledTimes(1);
        expect(signIn).toHaveBeenCalledWith('admin', 'secret');
    });

    it('does NOT send a request when a field is empty (defensive; button already disabled)', () => {
        const { presenter, signIn } = makePresenter();
        presenter.username = 'admin';
        presenter.password = '';

        presenter.submit();

        expect(signIn).not.toHaveBeenCalled();
        expect(presenter.pending).toBe(false);
    });

    it('does NOT dispatch a second request while one is already pending', () => {
        const gate = new Subject<SignInResult>();
        const { presenter, signIn } = makePresenter(() => gate.asObservable());
        presenter.username = 'admin';
        presenter.password = 'pw';

        presenter.submit();      // starts the in-flight request
        presenter.submit();      // no-op: canSubmit() is false while pending

        expect(signIn).toHaveBeenCalledTimes(1);
    });
});

describe('LoginPresenter.submit success (AC-11.3)', () => {
    it('saves the session payload, then navigates, and resets pending', () => {
        const { presenter, saveSession, navigateToApp } = makePresenter(() => of(OK));
        presenter.username = 'admin';
        presenter.password = 'pw';

        presenter.submit();

        expect(saveSession).toHaveBeenCalledTimes(1);
        expect(saveSession).toHaveBeenCalledWith({ token: 'T', username: 'admin', fullname: 'Admin', roles: ['admin'] });
        expect(navigateToApp).toHaveBeenCalledTimes(1);
        // ordering: session stored before navigation (AC-11.3)
        expect(saveSession.mock.invocationCallOrder[0]).toBeLessThan(navigateToApp.mock.invocationCallOrder[0]);
        expect(presenter.pending).toBe(false);
        expect(presenter.errorKey).toBeNull();
    });
});

describe('LoginPresenter.submit error mapping (AC-11.4)', () => {
    const cases: Array<{ errorId: SignInErrorId; status: number; key: string }> = [
        { errorId: 'invalid_credentials', status: 401, key: SIGNIN_ERROR_KEYS.invalidCredentials },
        { errorId: 'user_not_found', status: 404, key: SIGNIN_ERROR_KEYS.invalidCredentials },
        { errorId: 'too_many_attempts', status: 429, key: SIGNIN_ERROR_KEYS.tooMany },
        { errorId: 'missing_field', status: 400, key: SIGNIN_ERROR_KEYS.missingField },
        { errorId: 'unexpected_error', status: 500, key: SIGNIN_ERROR_KEYS.failed },
    ];

    it.each(cases)('maps $errorId to the generic key and stays on the page', ({ errorId, status, key }) => {
        const err: SignInError = { errorId, status };
        const { presenter, saveSession, navigateToApp } = makePresenter(() => throwError(() => err));
        presenter.username = 'admin';
        presenter.password = 'pw';

        presenter.submit();

        expect(presenter.errorKey).toBe(key);
        expect(presenter.pending).toBe(false);
        expect(saveSession).not.toHaveBeenCalled();     // no session on error
        expect(navigateToApp).not.toHaveBeenCalled();   // stays on the Login Page
    });

    it('invalid_credentials and user_not_found map to the SAME key (enumeration-safe, §4.3)', () => {
        expect(LoginPresenter.mapErrorKey('user_not_found')).toBe(LoginPresenter.mapErrorKey('invalid_credentials'));
    });

    it('an unknown/absent errorId falls back to the generic "failed" key', () => {
        expect(LoginPresenter.mapErrorKey(undefined)).toBe(SIGNIN_ERROR_KEYS.failed);
        expect(LoginPresenter.mapErrorKey('something_else')).toBe(SIGNIN_ERROR_KEYS.failed);
    });
});

describe('LoginPresenter pending lifecycle (AC-11.5)', () => {
    it('is true WHILE the request is in flight and clears+errors are unset until it settles', () => {
        const gate = new Subject<SignInResult>();
        const { presenter } = makePresenter(() => gate.asObservable());
        presenter.username = 'admin';
        presenter.password = 'pw';

        presenter.submit();
        expect(presenter.pending).toBe(true);            // in-flight → disabled
        expect(presenter.errorKey).toBeNull();

        gate.next(OK);
        gate.complete();
        expect(presenter.pending).toBe(false);           // reset on success
    });

    it('resets pending on a mapped error response', () => {
        const err: SignInError = { errorId: 'invalid_credentials', status: 401 };
        const { presenter } = makePresenter(() => throwError(() => err));
        presenter.username = 'admin';
        presenter.password = 'pw';

        presenter.submit();

        expect(presenter.pending).toBe(false);
    });

    it('resets pending on a transport failure (non-normalized error) and shows the generic key', () => {
        const { presenter } = makePresenter(() => throwError(() => new Error('network down')));
        presenter.username = 'admin';
        presenter.password = 'pw';

        presenter.submit();

        expect(presenter.pending).toBe(false);
        expect(presenter.errorKey).toBe(SIGNIN_ERROR_KEYS.failed);
    });
});
