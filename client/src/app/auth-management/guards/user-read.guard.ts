import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ToastrService } from 'ngx-toastr';
import { TranslateService } from '@ngx-translate/core';

import { AuthGuard } from '../../auth.guard';
import { ModulePermissionService, USER_READ } from '../services/module-permission.service';

/**
 * `user.read`-permission-aware guard for the module's management route (D-011).
 *
 * It **builds on the reused FUXA `AuthGuard`** (client/src/app/auth.guard.ts) WITHOUT
 * modifying it: `AuthGuard` still owns authentication (it returns `true` when security is
 * disabled or the user is authorized, otherwise presents the login flow and, on failure,
 * redirects to `/` and returns `false` — verified). This guard delegates authentication to
 * it, then layers the module's authorization (`user.read`) UX check on top
 * (design/08-ui-user-management-page.md §6.2).
 *
 * The gate is UX-only; the server (§05) is the authoritative boundary — a bypass still
 * yields 403 on `GET /api/users` (design/08 §6.1/§6.3). Wiring this guard onto a concrete
 * route (the D-011 SUPERSEDE cutover) lands in later tasks (17.4); this task (15.1) provides
 * the guard itself.
 */
@Injectable({ providedIn: 'root' })
export class UserReadGuard {

    constructor(
        private authGuard: AuthGuard,
        private permissions: ModulePermissionService,
        private router: Router,
        private toastr: ToastrService,
        private translateService: TranslateService
    ) { }

    canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> {
        // 1) Reuse FUXA's AuthGuard for authentication (login redirect on failure).
        return this.authGuard.canActivate(next, state).pipe(
            map(authenticated => {
                if (!authenticated) {
                    // AuthGuard already surfaced the login flow / redirect; nothing more to do.
                    return false;
                }
                // 2) Module authorization: require `user.read` for the management route (AC-12.6).
                if (this.permissions.hasPermission(USER_READ)) {
                    return true;
                }
                this.notifyAuthorizationError('msg.signin-unauthorized');
                this.router.navigateByUrl('/');
                return false;
            })
        );
    }

    private notifyAuthorizationError(textKey: string): void {
        let msg = '';
        this.translateService.get(textKey).subscribe((txt: string) => { msg = txt; });
        this.toastr.error(msg, '', {
            timeOut: 3000,
            closeButton: true,
            disableTimeOut: true
        });
    }
}
