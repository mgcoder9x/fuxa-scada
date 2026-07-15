/**
 * Pure, framework-free Login presenter (design/07 §2.2/§3/§4 · REQ-11, AC-11.1..11.5).
 *
 * DV-010: ALL acceptance-criteria logic for the Login Page lives HERE, in a plain class with NO
 * Angular decorator/import, so it is unit-testable headlessly with jest (no TestBed, no DOM, no
 * browser). The thin `@Component` shell (`login.component.ts`) only binds a reactive form template
 * to this presenter. This mirrors the shipped `auth-protocol` pure-core + thin-`@Injectable`-shell
 * pattern (D-036/DV-009).
 *
 * The presenter depends only on injected SEAMS (plain functions), never on Angular:
 *  - `signIn`        → `AuthSignInClient.signIn` (the module's only path to POST /api/signin)
 *  - `saveSession`   → `SessionStore.save` (reused FUXA session plumbing, D-011/D-002)
 *  - `navigateToApp` → wraps `Router.navigateByUrl('/')`
 *
 * Security posture (design/07 §8): no credential/token/username is ever logged; error surfaces use a
 * GENERIC, enumeration-safe i18n KEY (never server-provided text), and `invalid_credentials` and
 * `user_not_found` deliberately map to the SAME key so the UI reveals nothing about which usernames
 * exist (DV-006 uniform-failure posture on the client).
 */

import type { Observable } from 'rxjs';
import type { SignInResult, SignInError, SignInErrorId } from '../clients/auth-protocol';
import type { ModuleSession } from '../services/session.store';

/** POST /api/signin seam (from `AuthSignInClient.signIn`). Errors a normalized `SignInError`. */
export type SignInFn = (username: string, password: string) => Observable<SignInResult>;
/** Persist-session seam (from `SessionStore.save`). */
export type SaveSessionFn = (session: ModuleSession) => void;
/** Navigate-to-authenticated-area seam (wraps `Router.navigateByUrl('/')`). */
export type NavigateFn = () => void;

/** The three seams the presenter needs; injected as plain functions/objects (DV-010). */
export interface LoginPresenterSeams {
    signIn: SignInFn;
    saveSession: SaveSessionFn;
    navigateToApp: NavigateFn;
}

/**
 * Generic, enumeration-safe i18n keys (design/07 §4.3). `invalid_credentials` AND `user_not_found`
 * share ONE key (no username-enumeration oracle); everything unknown falls back to the generic
 * "sign-in failed" key. These are translation KEYS, never rendered server text.
 */
export const SIGNIN_ERROR_KEYS = {
    invalidCredentials: 'msg.signin-invalid-credentials',
    tooMany: 'msg.signin-too-many',
    missingField: 'msg.signin-missing-field',
    failed: 'msg.signin-failed',
} as const;

export class LoginPresenter {
    /** Bound to the username field (design/07 §2.1). */
    username = '';
    /** Bound to the password field (masked in the view). */
    password = '';
    /** True from submit until the response settles — the single source of truth for AC-11.5. */
    pending = false;
    /** Generic i18n key for the current error, or `null` when there is none (AC-11.4). */
    errorKey: string | null = null;

    constructor(private readonly seams: LoginPresenterSeams) { }

    /**
     * AC-11.2 / AC-11.5: submit is permitted only when BOTH fields are non-empty after trimming
     * AND no request is in flight. This is the single derived predicate the view binds `disabled` to.
     */
    canSubmit(): boolean {
        return this.username.trim() !== '' && this.password.trim() !== '' && !this.pending;
    }

    /**
     * AC-11.2/11.3/11.4/11.5 — the whole submit orchestration:
     *  - defensive no-op if `canSubmit()` is false (the control is already disabled);
     *  - set `pending=true`, clear `errorKey` (disables submit — AC-11.5);
     *  - call `signIn` EXACTLY once with TRIMMED credentials (AC-11.2);
     *  - success `{token,username,fullname,roles}` → `saveSession(...)` then `navigateToApp()`
     *    then `pending=false` (AC-11.3);
     *  - error (normalized `SignInError`) → `pending=false` and map `errorId` to a generic key,
     *    STAY on the page (AC-11.4);
     *  - `pending` is reset in EVERY terminal branch, incl. transport failure (AC-11.5).
     */
    submit(): void {
        if (!this.canSubmit()) {
            return;
        }
        this.pending = true;
        this.errorKey = null;

        const username = this.username.trim();
        const password = this.password.trim();

        this.seams.signIn(username, password).subscribe({
            next: (result: SignInResult) => {
                this.seams.saveSession({
                    token: result.token,
                    username: result.username,
                    fullname: result.fullname,
                    roles: result.roles,
                });
                this.seams.navigateToApp();
                this.pending = false;
            },
            error: (err: unknown) => {
                this.pending = false;
                this.errorKey = LoginPresenter.mapErrorKey(readErrorId(err));
            },
        });
    }

    /**
     * Map a stable `SignInError.errorId` (the §01 contract) to a GENERIC i18n key (design/07 §4.3).
     * `invalid_credentials` and `user_not_found` share one key (enumeration-safe); anything unknown
     * or absent falls back to the generic "sign-in failed" key. Never returns server text.
     */
    static mapErrorKey(errorId: SignInErrorId | string | null | undefined): string {
        switch (errorId) {
            case 'invalid_credentials':
            case 'user_not_found':
                return SIGNIN_ERROR_KEYS.invalidCredentials;
            case 'too_many_attempts':
                return SIGNIN_ERROR_KEYS.tooMany;
            case 'missing_field':
                return SIGNIN_ERROR_KEYS.missingField;
            case 'unexpected_error':
            default:
                return SIGNIN_ERROR_KEYS.failed;
        }
    }
}

/**
 * Safely read a stable `errorId` off a normalized error. `AuthSignInClient` always errors a
 * `SignInError` (even a transport failure is normalized to `unexpected_error`), but this stays
 * defensive: any shape without a string `errorId` yields `undefined` → the generic "failed" key.
 * Never touches message/transport text.
 */
function readErrorId(err: unknown): SignInErrorId | undefined {
    if (err && typeof err === 'object' && typeof (err as SignInError).errorId === 'string') {
        return (err as SignInError).errorId;
    }
    return undefined;
}
