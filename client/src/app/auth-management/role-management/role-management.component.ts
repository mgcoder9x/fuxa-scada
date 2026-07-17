/**
 * Thin standalone Role-Management page container (design/05 §8.1 · REQ-9, D-046/D-039/DV-010).
 *
 * Owns NO acceptance-criteria logic: it wires the real seams (`RoleAdminClient` /
 * `ModulePermissionService`) into the framework-free `RoleManagementPresenter` and binds the
 * template. All gate/load/create/update/delete/permission-catalog logic lives in and is unit-tested
 * through the presenter (DV-010). Registers NO route here (added in `app.routing.ts`) and edits NO
 * FUXA-core file. Security (design/05 §9): the client access gate is UX-only; the server (§05) is the
 * authoritative boundary; errors render a translated i18n KEY, never server text.
 */

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { RoleAdminClient } from '../clients/role-admin.client';
import { ModulePermissionService } from '../services/module-permission.service';
import { RoleOption } from '../clients/auth-protocol';
import { AuthNavComponent } from '../nav/auth-nav.component';
import { RoleManagementPresenter, AccessState, RoleFormMode } from './role-management-presenter';

@Component({
    selector: 'app-auth-role-management',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule, AuthNavComponent],
    templateUrl: './role-management.component.html',
    styleUrls: ['./role-management.component.scss'],
})
export class RoleManagementComponent implements OnInit {

    private readonly presenter: RoleManagementPresenter;
    /** Delete-confirm target: null = closed. */
    deleteTarget: string | null = null;

    constructor(roles: RoleAdminClient, permissions: ModulePermissionService) {
        this.presenter = new RoleManagementPresenter({
            canReadRoles: () => permissions.canReadRoles(),
            listRoles: () => roles.list(),
            createRole: (input) => roles.create(input),
            updateRole: (id, perms) => roles.update(id, perms),
            deleteRole: (id) => roles.delete(id),
        });
    }

    ngOnInit(): void {
        this.presenter.init();
    }

    get access(): AccessState { return this.presenter.access; }
    get roles(): RoleOption[] { return this.presenter.roles; }
    get loading(): boolean { return this.presenter.loading; }
    get savePending(): boolean { return this.presenter.savePending; }
    get deletePending(): boolean { return this.presenter.deletePending; }
    get errorKey(): string | null { return this.presenter.errorKey; }
    get formMode(): RoleFormMode | null { return this.presenter.formMode; }

    get formId(): string { return this.presenter.formId; }
    set formId(v: string) { this.presenter.formId = v; }
    get formName(): string { return this.presenter.formName; }
    set formName(v: string) { this.presenter.formName = v; }

    availablePermissions(): string[] { return this.presenter.availablePermissions(); }
    hasPermission(p: string): boolean { return this.presenter.hasPermission(p); }
    togglePermission(p: string, ev: Event): void {
        this.presenter.togglePermission(p, (ev.target as HTMLInputElement).checked);
    }
    canSubmit(): boolean { return this.presenter.canSubmit(); }

    openCreate(): void { this.presenter.openCreate(); }
    openEdit(role: RoleOption): void { this.presenter.openEdit(role); }
    closeForm(): void { this.presenter.closeForm(); }
    submitForm(): void { this.presenter.submitForm(); }
    refresh(): void { this.presenter.refresh(); }

    permissionLabel(role: RoleOption): string { return this.presenter.permissionLabel(role); }

    // Delete confirm host
    openDelete(role: RoleOption): void { this.deleteTarget = role.id; }
    confirmDelete(): void {
        if (this.deleteTarget) { this.presenter.deleteRole(this.deleteTarget); }
        this.deleteTarget = null;
    }
    cancelDelete(): void { this.deleteTarget = null; }

    trackById(_i: number, role: RoleOption): string { return role.id; }
}
