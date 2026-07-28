import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { EndPointApi } from '../../_helpers/endpointapi';
import {
    AuthConfigView, AdminError,
    mapAuthConfigResponse, normalizeAdminError,
} from './auth-protocol';

/** A partial runtime-config patch: only the keys the operator actually changed are sent. */
export interface AuthConfigPatch {
    passwordMinLength?: number;
    passwordBlocklist?: string[];
    tokenExpiresIn?: string | number;
    refreshTokenExpiresIn?: string | number;
    bcryptCost?: number;
    // D-054 Option B — token-signing trio. iss/aud accept `null` to unset (D-029); a change is a
    // confirmed, session-ending edit (existing tokens then fail the unchanged strict verify ⇒ re-login).
    jwtIssuer?: string | null;
    jwtAudience?: string | null;
    jwtAlgorithm?: string;
    bruteForce?: Partial<{
        threshold: number;
        baseThrottleMs: number;
        backoffFactor: number;
        maxThrottleMs: number;
        failureWindowMs: number;
    }>;
}

/**
 * Thin Angular shell over the runtime auth-config endpoints (D-049 Phase 2, D-036 pattern).
 *
 * The ONLY seam to `/api/auth/config`. `get()` also returns the server's validation bounds so the page
 * never hand-copies policy limits (N-091 L3 lesson). `Skip-Error` keeps a 401/403 an in-page condition
 * instead of triggering the global sign-out interceptor.
 *
 * Contract (verified in `api/auth-config.router.js`):
 *   GET    → 200 `{ status, data: <effective>, bounds }`                       (settings.read)
 *   PUT    → 200 `{ status, data: <effective>, version }` · 400 `{ error:'validation_error', errors[] }` (settings.manage)
 *   DELETE → 200 `{ status, data: <effective after reset> }`                    (settings.manage)
 */
@Injectable({ providedIn: 'root' })
export class AuthConfigClient {

    private readonly baseUrl: string = EndPointApi.getURL();
    private readonly headers = new HttpHeaders({ 'Content-Type': 'application/json', 'Skip-Error': 'true' });

    constructor(private http: HttpClient) { }

    /** GET the effective config + validation bounds. */
    get(): Observable<AuthConfigView> {
        return this.http.get(`${this.baseUrl}/api/auth/config`, { headers: this.headers })
            .pipe(map((body) => mapAuthConfigResponse(body)), catchError((e) => this.fail(e)));
    }

    /** PUT a partial patch; resolves with the new effective config. */
    update(patch: AuthConfigPatch): Observable<AuthConfigView> {
        return this.http.put(`${this.baseUrl}/api/auth/config`, patch, { headers: this.headers })
            .pipe(map((body) => mapAuthConfigResponse(body)), catchError((e) => this.fail(e)));
    }

    /** DELETE the persisted override → back to the settings.js baseline / built-in defaults. */
    reset(): Observable<AuthConfigView> {
        return this.http.delete(`${this.baseUrl}/api/auth/config`, { headers: this.headers })
            .pipe(map((body) => mapAuthConfigResponse(body)), catchError((e) => this.fail(e)));
    }

    /** Normalize any transport/HTTP error to a stable `AdminError` (never the raw response). */
    private fail(err: HttpErrorResponse): Observable<never> {
        const status = typeof err?.status === 'number' ? err.status : 0;
        const normalized: AdminError = normalizeAdminError(status, err?.error);
        return throwError(() => normalized);
    }
}
