/**
 * Pure, framework-free forced-rotation presenter (design/12 §4 · REQ-17 AC-17.2/17.3, D-045).
 *
 * DV-010: ALL logic for the forced password-rotation page lives HERE, in a plain class with NO
 * Angular decorator/import, so it is unit-testable headlessly with jest (no TestBed/DOM/browser).
 * The thin `@Component` shell (`rotate-password.component.ts`) only binds a reactive form to this
 * presenter. Mirrors the shipped `LoginPresenter` + `auth-protocol` pure-core pattern (D-036/DV-010).
 *
 * Seams (injected plain functions, never Angular):
 *  - `rotate`     → `RotatePasswordClient.rotate` (the module's only path to POST /api/account/rotate-password)
 *  - `onRotated`  → clear the session + navigate to `/auth/login` (re-authenticate with the new secret,
 *                   because the server bumps `tokenVersion` on rotation → the gated token is now revoked)
 *
 * Security posture: no password is ever logged; error surfaces use GENERIC i18n KEYS (never
 * server-provided text). The server remains the password-policy authority; the only client-side
 * guard is the confirm-match (a pure UX check).
 */

import type { Observable } from 'rxjs';
import type { RotateError, RotateErrorId } from '../clients/auth-protocol';

/** POST /api/account/rotate-password seam (from `RotatePasswordClient.rotate`). Errors a `RotateError`. */
export type RotateFn = (currentPassword: string, newPassword: string) => Observable<void>;
/** Post-success seam: clear the session + navigate to the login page (re-authenticate). */
export type OnRotatedFn = () => void;

export interface RotatePasswordPresenterSeams {
    rotate: RotateFn;
    onRotated: OnRotatedFn;
}

/** Generic i18n keys (never rendered server text). */
export const ROTATE_ERROR_KEYS = {
    badCurrent: 'msg.rotate-bad-current',
    weakOrReused: 'msg.rotate-weak-or-reused',
    mismatch: 'msg.rotate-mismatch',
    failed: 'msg.rotate-failed',
} as const;

export class RotatePasswordPresenter {
    /** The one-time / current secret the operator received out-of-band (console enrollment). */
    currentPassword = '';
    /** The new password to set. */
    newPassword = '';
    /** Re-typed new password (client-side confirm-match check only). */
    confirmPassword = '';
    /** True from submit until the response settles — single source of truth for the disabled/busy state. */
    pending = false;
    /** Generic i18n key for the current error, or `null` when there is none. */
    errorKey: string | null = null;
    /** True once a rotation has succeeded (drives a brief success state before navigation). */
    success = false;

    constructor(private readonly seams: RotatePasswordPresenterSeams) { }

    /** Submit is permitted only when all three fields are non-empty (trimmed) and no request is in flight. */
    canSubmit(): boolean {
        return this.currentPassword.trim() !== ''
            && this.newPassword.trim() !== ''
            && this.confirmPassword.trim() !== ''
            && !this.pending;
    }

    /**
     * Submit orchestration:
     *  - defensive no-op when `canSubmit()` is false;
     *  - confirm-match guard (pure UX) → `mismatch` key, no request;
     *  - set `pending`, clear `errorKey`, call `rotate` EXACTLY once;
     *  - success → `pending=false`, `success=true`, then `onRotated()` (clear session + go to login);
     *  - error (normalized `RotateError`) → `pending=false`, map `errorId` to a generic key, STAY on page;
     *  - `pending` reset in every terminal branch (incl. transport failure).
     */
    submit(): void {
        if (!this.canSubmit()) {
            return;
        }
        if (this.newPassword !== this.confirmPassword) {
            this.errorKey = ROTATE_ERROR_KEYS.mismatch;
            return;
        }
        this.pending = true;
        this.errorKey = null;

        this.seams.rotate(this.currentPassword, this.newPassword).subscribe({
            next: () => {
                this.pending = false;
                this.success = true;
                this.seams.onRotated();
            },
            error: (err: unknown) => {
                this.pending = false;
                this.errorKey = RotatePasswordPresenter.mapErrorKey(readRotateErrorId(err));
            },
        });
    }

    /** Map a stable `RotateError.errorId` to a GENERIC i18n key; unknown/absent → generic "failed". */
    static mapErrorKey(errorId: RotateErrorId | string | null | undefined): string {
        switch (errorId) {
            case 'bad_current_password':
                return ROTATE_ERROR_KEYS.badCurrent;
            case 'weak_or_reused_password':
                return ROTATE_ERROR_KEYS.weakOrReused;
            case 'unexpected_error':
            default:
                return ROTATE_ERROR_KEYS.failed;
        }
    }
}

/** Safely read a stable `errorId` off a normalized `RotateError`; any other shape → undefined. */
function readRotateErrorId(err: unknown): RotateErrorId | undefined {
    if (err && typeof err === 'object' && typeof (err as RotateError).errorId === 'string') {
        return (err as RotateError).errorId;
    }
    return undefined;
}
