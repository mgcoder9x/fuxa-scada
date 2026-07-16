/**
 * Thin standalone forced-rotation page shell (design/12 §4 · REQ-17 AC-17.2/17.3, D-045/D-039/DV-010).
 *
 * Owns NO acceptance-criteria logic: it builds a reactive form, wires the seams into the
 * framework-free `RotatePasswordPresenter`, keeps the presenter fields in sync with the form, and
 * exposes `pending`/`errorKey`/`canSubmit()` for the template. All branch logic (submit-gating,
 * confirm-match, success→session-clear+navigate, error mapping) lives in and is unit-tested through
 * the presenter (DV-010).
 *
 * Reached from the Login flow when the signed-in account is `mustRotate` (D-045): the login page
 * routes here IN-APP (no full reload) so the gated token stays and no protected call fires. On
 * success the server bumps `tokenVersion` (the gated token is revoked), so the presenter's
 * `onRotated` seam clears the session and returns to `/auth/login` to re-authenticate with the new
 * secret. No FUXA-core file is edited; the change is confined to this module component + its route.
 */

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { RotatePasswordClient } from '../clients/account.client';
import { SessionStore } from '../services/session.store';
import { RotatePasswordPresenter } from './rotate-password-presenter';

@Component({
    selector: 'app-auth-rotate-password',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, TranslateModule],
    templateUrl: './rotate-password.component.html',
    styleUrls: ['./rotate-password.component.scss'],
})
export class RotatePasswordComponent implements OnInit, OnDestroy {

    readonly form: FormGroup<{
        currentPassword: FormControl<string>;
        newPassword: FormControl<string>;
        confirmPassword: FormControl<string>;
    }>;

    private readonly presenter: RotatePasswordPresenter;
    private readonly formSub: Subscription;

    constructor(
        fb: FormBuilder,
        private readonly router: Router,
        private readonly session: SessionStore,
        rotateClient: RotatePasswordClient,
    ) {
        this.form = fb.nonNullable.group({
            currentPassword: fb.nonNullable.control('', Validators.required),
            newPassword: fb.nonNullable.control('', Validators.required),
            confirmPassword: fb.nonNullable.control('', Validators.required),
        });

        this.presenter = new RotatePasswordPresenter({
            rotate: (current: string, next: string) => rotateClient.rotate(current, next),
            onRotated: () => {
                // The rotation revoked the gated token (tokenVersion bump) — clear the session and
                // return to login so the operator re-authenticates with the NEW password.
                this.session.clear();
                this.router.navigateByUrl('/auth/login');
            },
        });

        this.formSub = this.form.valueChanges.subscribe((v) => {
            this.presenter.currentPassword = v.currentPassword ?? '';
            this.presenter.newPassword = v.newPassword ?? '';
            this.presenter.confirmPassword = v.confirmPassword ?? '';
        });
    }

    ngOnInit(): void {
        // This page requires an authenticated (gated) session; without one, go to login.
        if (!this.session.token()) {
            this.router.navigateByUrl('/auth/login');
        }
    }

    get pending(): boolean {
        return this.presenter.pending;
    }

    get errorKey(): string | null {
        return this.presenter.errorKey;
    }

    canSubmit(): boolean {
        return this.form.valid && this.presenter.canSubmit();
    }

    onSubmit(): void {
        this.presenter.currentPassword = this.form.controls.currentPassword.value ?? '';
        this.presenter.newPassword = this.form.controls.newPassword.value ?? '';
        this.presenter.confirmPassword = this.form.controls.confirmPassword.value ?? '';
        this.presenter.submit();
    }

    ngOnDestroy(): void {
        this.formSub.unsubscribe();
    }
}
