/**
 * Shared in-area navigator for the auth-management pages (D-046). Standalone (D-039); edits no
 * FUXA-core file. Renders tabs Users | Roles via `routerLink` + `routerLinkActive`, so the module
 * pages (`/auth/users`, `/auth/roles`) are reachable from one another without depending on FUXA's
 * editor Setup menu (integrating into that menu is the deferred Phase 2). Presentation-only: no
 * logic, no seams, nothing to unit-test beyond the template (covered by production `ng build` +
 * browser).
 */

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-auth-nav',
    standalone: true,
    imports: [CommonModule, RouterModule, TranslateModule],
    template: `
        <nav class="auth-nav" aria-label="Account management">
            <a class="auth-nav__tab" routerLink="/auth/users" routerLinkActive="auth-nav__tab--active">
                {{ 'nav.users' | translate }}
            </a>
            <a class="auth-nav__tab" routerLink="/auth/roles" routerLinkActive="auth-nav__tab--active">
                {{ 'nav.roles' | translate }}
            </a>
        </nav>
    `,
    styles: [`
        .auth-nav { display: flex; gap: 4px; border-bottom: 1px solid #ddd; margin-bottom: 12px; }
        .auth-nav__tab { padding: 8px 16px; text-decoration: none; color: inherit; border-bottom: 2px solid transparent; cursor: pointer; }
        .auth-nav__tab--active { border-bottom-color: #1976d2; font-weight: 600; }
    `],
})
export class AuthNavComponent { }
