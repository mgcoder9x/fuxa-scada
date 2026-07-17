/**
 * Thin standalone User-Management page container (design/08 §2/§6 · REQ-12, D-039/DV-010).
 *
 * Task 17.1: the routed page CONTAINER + list view + access gate. This `@Component` owns NO
 * acceptance-criteria logic — it wires the real seams (`UserAdminClient` / `RoleAdminClient` /
 * `ModulePermissionService`) into the framework-free `UserManagementPresenter` and binds the
 * template to it. All gate/load/role-resolution logic lives in and is unit-tested through the
 * presenter (DV-010). The create/edit forms (17.2) and delete flow (17.3) are added as child
 * presenters/components; the route + `AuthGuard` cutover is 17.4 (D-014/TO-013).
 *
 * D-039: NEW standalone component under `auth-management/user-management/`; registers NO route and
 * edits NO FUXA-core file. Security (design/08 §9): renders only the hash-free `UserView`; the
 * client access gate is UX-only — the server (§05) is the authoritative boundary; errors render a
 * translated i18n KEY, never server text.
 */

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

import { UserAdminClient } from '../clients/user-admin.client';
import { RoleAdminClient } from '../clients/role-admin.client';
import { ModulePermissionService } from '../services/module-permission.service';
import { UserView, RoleOption } from '../clients/auth-protocol';
import { UserManagementPresenter, AccessState } from './user-management-presenter';
import { UserFormComponent } from './user-form.component';
import { UserFormMode, UserFormInitial } from './user-form-presenter';
import { DeleteUserConfirmDialogComponent } from './delete-user-confirm-dialog.component';
import { AuthNavComponent } from '../nav/auth-nav.component';

@Component({
    selector: 'app-auth-user-management',
    standalone: true,
    imports: [CommonModule, TranslateModule, UserFormComponent, DeleteUserConfirmDialogComponent, AuthNavComponent],
    templateUrl: './user-management.component.html',
    styleUrls: ['./user-management.component.scss'],
})
export class UserManagementComponent implements OnInit {

    private readonly presenter: UserManagementPresenter;

    /** Create/edit form host state: null = closed. */
    formMode: UserFormMode | null = null;
    formInitial?: UserFormInitial;
    /** Delete-confirm dialog target: null = closed. */
    deleteTarget: string | null = null;

    constructor(
        users: UserAdminClient,
        roles: RoleAdminClient,
        permissions: ModulePermissionService,
    ) {
        // Wire the REAL seams into the pure presenter (DV-010). `onRolesLoaded` feeds the loaded
        // role defs into the RBAC permission resolver so role-based checks are consistent (Task 15).
        this.presenter = new UserManagementPresenter({
            canReadUsers: () => permissions.canReadUsers(),
            listUsers: () => users.list(),
            listRoles: () => roles.list(),
            deleteUser: (username) => users.delete(username),
            onRolesLoaded: (loaded) => permissions.setRoleDefinitions(loaded),
        });
    }

    ngOnInit(): void {
        this.presenter.init();
    }

    /** Role options for the create/edit form's assignment control. */
    get roles(): RoleOption[] {
        return this.presenter.roles;
    }

    /** True while a confirmed delete is in flight. */
    get deletePending(): boolean {
        return this.presenter.deletePending;
    }

    /** Existing usernames for the create-form client uniqueness check. */
    existingUsernames(): string[] {
        return this.presenter.users.map((u) => u.username);
    }

    // --- Create/edit form host (AC-12.2/12.3) -------------------------------

    openCreate(): void {
        this.formInitial = undefined;
        this.formMode = 'create';
    }

    openEdit(user: UserView): void {
        this.formInitial = { username: user.username, fullname: user.fullname, roles: user.roles, metadata: user.metadata };
        this.formMode = 'edit';
    }

    closeForm(): void {
        this.formMode = null;
        this.formInitial = undefined;
    }

    /** On a successful create/update the form emits `saved` → close + refresh the list (AC-12.2/12.3). */
    onFormSaved(_user: UserView): void {
        this.closeForm();
        this.presenter.refresh();
    }

    // --- Delete host (AC-12.5) ----------------------------------------------

    openDelete(user: UserView): void {
        this.deleteTarget = user.username;
    }

    onDeleteConfirmed(username: string): void {
        this.presenter.deleteUser(username);
        this.deleteTarget = null;
    }

    onDeleteCancelled(): void {
        this.deleteTarget = null;
    }

    /** Access-gate result (AC-12.6): `checking` | `granted` | `denied`. */
    get access(): AccessState {
        return this.presenter.access;
    }

    /** The displayed hash-free user list (AC-12.1). */
    get users(): UserView[] {
        return this.presenter.users;
    }

    /** True while the user-list fetch is in flight. */
    get loading(): boolean {
        return this.presenter.loading;
    }

    /** Generic i18n error key, or null. */
    get errorKey(): string | null {
        return this.presenter.errorKey;
    }

    /** Comma-joined role NAMES for a row (ids resolved via loaded role options; §2.3). */
    roleLabel(user: UserView): string {
        return this.presenter.roleLabel(user);
    }

    /** Re-fetch the user list (AC-12.1). */
    refresh(): void {
        this.presenter.refresh();
    }

    /** ngFor trackBy — username is the stable identity. */
    trackByUsername(_index: number, user: UserView): string {
        return user.username;
    }
}
