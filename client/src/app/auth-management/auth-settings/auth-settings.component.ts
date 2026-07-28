/**
 * Auth-Settings page shell (D-049 Phase 2 · design/13-runtime-config.md).
 *
 * Owns NO logic: it wires the real seams (`AuthConfigClient` + the server-authoritative
 * `ModulePermissionService`) into the framework-free `AuthSettingsPresenter` (DV-010) and binds the
 * template. `standalone: true` per D-039, so registering it costs one additive route line and no
 * FUXA-core NgModule edit.
 *
 * It pre-loads the identity's effective permissions before gating (D-050): without that, a non-admin
 * with `settings.read` would be denied locally forever — the N-091 L1 failure mode.
 */

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { AuthConfigClient } from '../clients/auth-config.client';
import { ModulePermissionService } from '../services/module-permission.service';
import { AuthNavComponent } from '../nav/auth-nav.component';
import { AuthSettingsPresenter, AccessState, SettingsForm, FieldError } from './auth-settings-presenter';

@Component({
    selector: 'app-auth-settings',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslateModule, AuthNavComponent],
    templateUrl: './auth-settings.component.html',
    styleUrls: ['./auth-settings.component.scss'],
})
export class AuthSettingsComponent implements OnInit {

    readonly presenter: AuthSettingsPresenter;

    constructor(config: AuthConfigClient, private permissions: ModulePermissionService) {
        this.presenter = new AuthSettingsPresenter({
            canRead: () => permissions.hasPermission('settings.read'),
            canManage: () => permissions.hasPermission('settings.manage'),
            load: () => config.get(),
            save: (patch) => config.update(patch),
            reset: () => config.reset(),
        });
    }

    ngOnInit(): void {
        // D-050: resolve this identity's own authority from the server BEFORE gating.
        this.permissions.ensureLoaded().subscribe(() => this.presenter.init());
    }

    get access(): AccessState { return this.presenter.access; }
    get form(): SettingsForm { return this.presenter.form; }
    get readOnly(): boolean { return this.presenter.readOnly; }

    /** HS-only algorithm choices for the <select>, served by the server (fallback = known HS set). */
    get algorithmChoices(): string[] {
        const fromServer = this.presenter.bounds && this.presenter.bounds.jwtAlgorithms;
        return fromServer && fromServer.length ? fromServer : ['HS256', 'HS384', 'HS512'];
    }

    fieldError(field: keyof SettingsForm): FieldError | null { return this.presenter.fieldError(field); }
}
