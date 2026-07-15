/**
 * Standalone delete-confirmation dialog (design/08 §5/§9 · REQ-12, AC-12.5, D-039).
 *
 * A destructive action must never be a single accidental click: this modal confirms before the host
 * issues any delete request. It holds NO business logic (the delete call + list mutation + error
 * handling live in `UserManagementPresenter.deleteUser`, DV-010, unit-tested) — it only emits
 * `confirmed(username)` / `cancelled`. Accessibility (§9): `role="dialog"`, labelled title naming
 * the user, focus-target confirm button.
 */

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-auth-delete-user-confirm',
    standalone: true,
    imports: [CommonModule, TranslateModule],
    template: `
    <div class="auth-users__confirm" role="dialog" aria-modal="true" aria-labelledby="auf-del-title" *ngIf="username">
        <h2 id="auf-del-title" class="auth-users__confirm-title">{{ 'msg.user-remove' | translate }}</h2>
        <p class="auth-users__confirm-body">
            {{ 'users.username' | translate }}: <strong>{{ username }}</strong>
        </p>
        <div class="auth-users__confirm-actions">
            <button type="button" (click)="cancelled.emit()">{{ 'general.cancel' | translate }}</button>
            <button type="button" class="auth-users__confirm-yes" (click)="confirmed.emit(username)" [disabled]="pending">
                {{ 'general.remove' | translate }}
            </button>
        </div>
    </div>
    `,
    styleUrls: ['./user-management.component.scss'],
})
export class DeleteUserConfirmDialogComponent {
    /** The username targeted for deletion; the dialog renders only when set. */
    @Input() username: string | null = null;
    /** True while the delete request is in flight (disables the confirm button). */
    @Input() pending = false;

    /** Emitted with the username when the admin confirms the deletion. */
    @Output() confirmed = new EventEmitter<string>();
    /** Emitted when the admin cancels (no request sent). */
    @Output() cancelled = new EventEmitter<void>();
}
