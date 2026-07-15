/**
 * Thin standalone Create/Edit user-form component (design/08 §3/§4 · REQ-12, D-039/DV-010).
 *
 * Task 17.2. This `@Component` owns NO validation/submit logic — it binds a template (ngModel +
 * role checkboxes) to the framework-free `UserFormPresenter` and wires the real `UserAdminClient`.
 * Validation is SINGLE-SOURCED in the presenter (`usernameError`/`passwordError`/`canSubmit`),
 * unit-tested headlessly (DV-010) — deliberately NOT duplicated as Angular `Validators` (the
 * design's "reactive FormGroup" is a structural suggestion; single-sourcing the rules in the pure
 * presenter is cleaner and avoids drift). D-039: standalone, no FUXA-core edit; the host wires it.
 *
 * Security (design/08 §9): password bound to a masked input, never logged; errors render a
 * translated i18n KEY; on edit an empty password is omitted by the presenter (AC-7.3).
 */

import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { UserAdminClient } from '../clients/user-admin.client';
import { UserView, RoleOption } from '../clients/auth-protocol';
import { UserFormPresenter, UserFormMode, UserFormInitial } from './user-form-presenter';

@Component({
    selector: 'app-auth-user-form',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule],
    templateUrl: './user-form.component.html',
    styleUrls: ['./user-management.component.scss'],
})
export class UserFormComponent implements OnInit {

    /** 'create' | 'edit' (design/08 §2.1 parameterized form). */
    @Input() mode: UserFormMode = 'create';
    /** Initial values for edit mode (from the selected UserView). */
    @Input() initial?: UserFormInitial;
    /** Existing usernames for the create-mode client uniqueness check. */
    @Input() existingUsernames: string[] = [];
    /** Role options for the assignment control. */
    @Input() roleOptions: RoleOption[] = [];

    /** Emitted with the created/updated user so the host closes the form + refreshes the list. */
    @Output() saved = new EventEmitter<UserView>();
    /** Emitted when the admin cancels (no request sent). */
    @Output() cancelled = new EventEmitter<void>();

    /** Public so the template can bind ngModel to its fields (DV-010). */
    presenter!: UserFormPresenter;

    constructor(private users: UserAdminClient) { }

    ngOnInit(): void {
        this.presenter = new UserFormPresenter(
            {
                createUser: (input) => this.users.create(input),
                updateUser: (username, patch) => this.users.update(username, patch),
                existingUsernames: () => this.existingUsernames,
                onSuccess: (user) => this.saved.emit(user),
            },
            this.mode,
            this.initial,
        );
    }

    isRoleSelected(id: string): boolean {
        return this.presenter.roles.indexOf(id) !== -1;
    }

    toggleRole(id: string, checked: boolean): void {
        if (checked) {
            if (!this.isRoleSelected(id)) {
                this.presenter.roles = [...this.presenter.roles, id];
            }
        } else {
            this.presenter.roles = this.presenter.roles.filter((r) => r !== id);
        }
    }

    onSubmit(): void {
        this.presenter.submit();
    }

    onCancel(): void {
        this.cancelled.emit();
    }
}
