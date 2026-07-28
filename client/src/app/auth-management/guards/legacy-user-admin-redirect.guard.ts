import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';

import { SettingsService } from '../../_services/settings.service';
import { legacyAdminRedirect$ } from './legacy-admin-route';

/**
 * Redirects FUXA's built-in `/users` and `/userRoles` routes to the module-owned `/auth/users`
 * and `/auth/roles` pages WHEN the auth-management SUPERSEDE is active (D-052, task 24.2 — closes
 * the D-048 residual: the Setup menu already re-points, but a DIRECT URL still rendered the legacy
 * FUXA page, a bypass of the module that owns identity).
 *
 * Wiring (app.routing.ts, FUXA-core in-place edit, DV-013): placed BEFORE `AuthGuard` on the two
 * routes. Under SUPERSEDE it returns a `UrlTree` so navigation is redirected and NEITHER the legacy
 * page NOR FUXA's login dialog appears; when SUPERSEDE is OFF it returns `true` and `AuthGuard` runs
 * exactly as before, so non-flipped deployments are byte-identical.
 *
 * The redirect target comes from the route's static `data.supersedeRedirect`, so ONE guard serves
 * both routes without hard-coding the pairing here. The decision waits for `SettingsService.loaded$`
 * (see legacy-admin-route.ts) so `authModuleEnabled` is the server's value, not its default `false`.
 *
 * This is UX/consistency only — the server (§05) stays the authoritative boundary and the module
 * pages carry their own UX gate + server authorization.
 */
@Injectable({ providedIn: 'root' })
export class LegacyUserAdminRedirectGuard {

    constructor(private settings: SettingsService, private router: Router) { }

    canActivate(next: ActivatedRouteSnapshot, _state: RouterStateSnapshot): Observable<boolean | UrlTree> {
        const target = (next.data && (next.data['supersedeRedirect'] as string)) || '/';
        return legacyAdminRedirect$(
            this.settings.loaded$,
            () => !!this.settings.getSettings()?.authModuleEnabled,
            () => this.router.parseUrl(target)
        );
    }
}
