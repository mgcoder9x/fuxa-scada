import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { EndPointApi } from '../../_helpers/endpointapi';
import {
    IdentityPermissions, AdminError,
    mapPermissionsResponse, normalizeAdminError,
} from './auth-protocol';

/**
 * Thin Angular shell over the pure permissions protocol (D-050, D-036 pattern).
 *
 * The ONLY seam to `GET /api/auth/permissions` — the endpoint that tells the client what the CURRENT
 * identity may do (`effective`) and what permissions exist to grant (`catalog`). It exists because the
 * client previously tried to DERIVE the first quantity from `GET /api/roles`, which a non-admin is
 * 403'd from, producing a permanent local deny (N-091 L1).
 *
 * `Skip-Error: true` keeps a 401/403 an in-page condition instead of triggering the global
 * sign-out interceptor: this call is advisory, so it must never be able to log a user out.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsClient {

    private readonly baseUrl: string = EndPointApi.getURL();
    private readonly headers = new HttpHeaders({ 'Content-Type': 'application/json', 'Skip-Error': 'true' });

    constructor(private http: HttpClient) { }

    /** GET /api/auth/permissions → the caller's own authority + the grantable vocabulary. */
    get(): Observable<IdentityPermissions> {
        return this.http.get(`${this.baseUrl}/api/auth/permissions`, { headers: this.headers })
            .pipe(map((body) => mapPermissionsResponse(body)), catchError((e) => this.fail(e)));
    }

    /** Normalize any transport/HTTP error to a stable `AdminError` (never the raw response). */
    private fail(err: HttpErrorResponse): Observable<never> {
        const status = typeof err?.status === 'number' ? err.status : 0;
        const normalized: AdminError = normalizeAdminError(status, err?.error);
        return throwError(() => normalized);
    }
}
