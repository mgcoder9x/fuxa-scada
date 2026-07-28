import { ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Injectable } from '@angular/core';
import { AuthService } from './_services/auth.service';
import { ProjectService } from './_services/project.service';
import { ToastrService } from 'ngx-toastr';
import { TranslateService } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { map, mergeMap, switchMap } from 'rxjs/operators';
import { LoginComponent } from './login/login.component';
import { MatDialog as MatDialog } from '@angular/material/dialog';

@Injectable()
export class AuthGuard  {
    constructor(private authService: AuthService,
        private translateService: TranslateService,
        private toastr: ToastrService,
        private projectService: ProjectService,
        private dialog: MatDialog,
        private router: Router) {
        }

    canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> {
        if (!this.projectService.isSecurityEnabled()) {
            return of(true);
        }
        if (this.authService.isAdmin()) {
            return of(true);
        }

        const serverSecureEnabled$ = this.projectService.checkServer().pipe(
            map(response => {
                if (!response?.secureEnabled) {
                    return false;
                }
                return true;
            })
        );
        return serverSecureEnabled$.pipe(
            switchMap(secureEnabled => {
                if (!secureEnabled) {
                    return of(true);
                } else {
                    // 24.3 (D-053/DV-014): if the user is ALREADY signed in as a real (non-guest)
                    // account but simply isn't an admin, re-opening the login dialog is dishonest —
                    // signing in again as the same account cannot grant admin, so it asks for
                    // credentials they already have. Tell the truth ("Unauthorized!") and don't
                    // prompt. Only an unauthenticated (or guest) visitor still gets the login dialog.
                    // Deny-preserving: this branch already returned false for non-admins; it only
                    // changes WHICH denial UX shows, never the access decision. Guest is mirrored
                    // from AuthService.isGuestUser (username 'guest' OR groups includes 'guest') so a
                    // guest-mode visitor is unaffected; username is used (not token) to stay correct
                    // under the refresh-cookie flow where the access token is transiently null.
                    const profile = this.authService.getUserProfile();
                    const isGuest = !!profile && (profile.username === 'guest' ||
                        (Array.isArray(profile.groups) && (profile.groups as any).includes('guest')));
                    const authenticatedRealUser = !!profile && !!profile.username && !isGuest;
                    if (authenticatedRealUser) {
                        this.notifySaveError('msg.signin-unauthorized');
                        this.router.navigateByUrl('/');
                        return of(false);
                    }
                    const dialogRef = this.dialog.open(LoginComponent);
                    return dialogRef.afterClosed().pipe(
                        mergeMap(result => {
                            if (result) {
                                if (this.authService.isAdmin()) {
                                    return of(true);
                                }
                            }
                            this.notifySaveError('msg.signin-unauthorized');
							this.router.navigateByUrl('/');
                            return of(false);
                        })
                    );
                }
            })
        );
    }

    private notifySaveError(textKey: string) {
        let msg = '';
        this.translateService.get(textKey).subscribe((txt: string) => { msg = txt; });
        this.toastr.error(msg, '', {
            timeOut: 3000,
            closeButton: true,
            disableTimeOut: true
        });
    }
}
