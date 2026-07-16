/**
 * Thin standalone Login_Page shell (design/07 §2 · REQ-11, D-039/DV-010, cutover D-042 Option 2).
 *
 * This `@Component` owns NO acceptance-criteria logic: it builds a reactive `FormGroup`, wires the
 * seams into a framework-free `LoginPresenter`, keeps the presenter's `username`/`password` in sync
 * with the form, and exposes `pending`/`errorKey`/`canSubmit()` for the template. All branch logic
 * (submit-gating, success store+navigate, error mapping, disable-while-pending) lives in and is
 * unit-tested through `LoginPresenter` (DV-010).
 *
 * CUTOVER — D-042 Option 2 (session-wiring reuse, D-011): to make this routed page work END-TO-END
 * with the running FUXA app, the sign-in seam establishes the session through FUXA's PROVEN
 * `AuthService.signIn(...)` (which stores `currentUser` incl. the numeric `groups`, publishes
 * `window.fuxaAccessToken`, and emits `currentUser$`). This is why the reused, UNCHANGED groups-based
 * `AuthGuard`/`isAdmin()`/interceptor recognize the login. We deliberately do NOT rewrite FUXA's
 * app-wide authorization here (that is the higher-risk Option 1, tracked separately) and do NOT
 * touch any FUXA-core file — the change is confined to this module component. The presenter's
 * `saveSession` seam is intentionally a NO-OP: `AuthService.signIn` already persisted the FUXA
 * session under the shared `currentUser` key, and writing the module's (groups-less) shape over it
 * would drop `groups` and break `isAdmin()`.
 *
 * Error handling: `AuthService.signIn` errors the raw `HttpErrorResponse`; we normalize it to the
 * module's stable `SignInError` via `normalizeSignInError` so the presenter maps it to a GENERIC,
 * enumeration-safe i18n key exactly as before (design/07 §4.3, DV-006). No credential/token is logged.
 */

import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subscription, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { AuthService } from '../../_services/auth.service';
import { SignInResult, normalizeSignInError } from '../clients/auth-protocol';
import { LoginPresenter } from './login-presenter';

@Component({
    selector: 'app-auth-login',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, TranslateModule],
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnDestroy {

    /** Reactive credential form (design/07 §2.2): each control is `required`, non-nullable. */
    readonly loginForm: FormGroup<{ username: FormControl<string>; password: FormControl<string> }>;

    private readonly presenter: LoginPresenter;
    private readonly formSub: Subscription;

    constructor(
        fb: FormBuilder,
        authService: AuthService,
        router: Router,
    ) {
        this.loginForm = fb.nonNullable.group({
            username: fb.nonNullable.control('', Validators.required),
            password: fb.nonNullable.control('', Validators.required),
        });

        // Wire the seams into the pure presenter (DV-010). D-042 Option 2: establish the session via
        // FUXA's AuthService.signIn (reuse session wiring) so the groups-based guard/isAdmin recognize
        // the login; map its success to the presenter's SignInResult and normalize its error.
        this.presenter = new LoginPresenter({
            signIn: (username: string, password: string): Observable<SignInResult> =>
                authService.signIn(username, password).pipe(
                    map(() => {
                        const profile = authService.getUserProfile();
                        return {
                            token: profile?.token ?? '',
                            username: profile?.username ?? username,
                            fullname: profile?.fullname ?? '',
                            roles: profile?.infoRoles ?? [],
                        } as SignInResult;
                    }),
                    catchError((err: HttpErrorResponse) =>
                        throwError(() => normalizeSignInError(typeof err?.status === 'number' ? err.status : 0, err?.error))),
                ),
            // NO-OP: AuthService.signIn already persisted the FUXA session (with `groups`) under the
            // shared `currentUser` key; re-writing the module shape here would drop `groups`.
            saveSession: () => { /* intentionally empty — see class doc (D-042 Option 2) */ },
            // Full reload to the authenticated landing route so FUXA re-initializes cleanly from the
            // stored session (mirrors FUXA's own post-login `projectService.reload()` behavior).
            navigateToApp: () => { window.location.assign('/'); },
        });

        // Keep the presenter's credential fields in lockstep with the form.
        this.formSub = this.loginForm.valueChanges.subscribe((value) => {
            this.presenter.username = value.username ?? '';
            this.presenter.password = value.password ?? '';
        });
    }

    /** AC-11.5 pending flag (drives the submit `disabled`/`aria-busy` bindings). */
    get pending(): boolean {
        return this.presenter.pending;
    }

    /** AC-11.4 generic i18n error key, or `null` when there is no error to show. */
    get errorKey(): string | null {
        return this.presenter.errorKey;
    }

    /** AC-11.2/11.5: submit enabled only when the form is valid and no request is in flight. */
    canSubmit(): boolean {
        return this.loginForm.valid && this.presenter.canSubmit();
    }

    /** Submit handler: sync the presenter from the form, then delegate the whole flow to it. */
    onSubmit(): void {
        this.syncPresenter();
        this.presenter.submit();
    }

    ngOnDestroy(): void {
        this.formSub.unsubscribe();
    }

    private syncPresenter(): void {
        this.presenter.username = this.loginForm.controls.username.value ?? '';
        this.presenter.password = this.loginForm.controls.password.value ?? '';
    }
}
