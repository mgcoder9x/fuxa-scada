/**
 * Thin standalone Login_Page shell (design/07 §2 · REQ-11, D-039/DV-010).
 *
 * This `@Component` owns NO acceptance-criteria logic: it builds a reactive `FormGroup`, wires the
 * real seams (`AuthSignInClient` / `SessionStore` / `Router`) into a framework-free `LoginPresenter`,
 * keeps the presenter's `username`/`password` in sync with the form, and exposes `pending`/`errorKey`
 * /`canSubmit()` for the template to bind. All the branch logic (submit-gating, success store+navigate,
 * error mapping, disable-while-pending) lives in and is unit-tested through `LoginPresenter` (DV-010).
 *
 * D-039: this is a NEW standalone component under `auth-management/login/`. It registers NO route and
 * edits NO FUXA-core file (`app.module.ts` / `app.routing.ts` / `auth.guard.ts`) — the route + guard
 * cutover is Task 17.4. It reuses FUXA's session plumbing only through the module-owned `SessionStore`.
 *
 * Security (design/07 §8): nothing here logs the username, password, or token — there is no
 * `console.*` of any credential/token anywhere in this component or the presenter it drives.
 */

import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { AuthSignInClient } from '../clients/auth-signin.client';
import { SessionStore, ModuleSession } from '../services/session.store';
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
        signInClient: AuthSignInClient,
        sessionStore: SessionStore,
        router: Router,
    ) {
        this.loginForm = fb.nonNullable.group({
            username: fb.nonNullable.control('', Validators.required),
            password: fb.nonNullable.control('', Validators.required),
        });

        // Wire the REAL seams into the pure presenter (DV-010). navigateToApp targets the app's
        // authenticated landing route ('' / home, design/07 §4.2); the Promise result is ignored.
        this.presenter = new LoginPresenter({
            signIn: (username, password) => signInClient.signIn(username, password),
            saveSession: (session: ModuleSession) => sessionStore.save(session),
            navigateToApp: () => { void router.navigateByUrl('/'); },
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
