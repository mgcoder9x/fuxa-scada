import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { EndPointApi } from '../../_helpers/endpointapi';
import { RotateError, normalizeRotateError, isRotateSuccess } from './auth-protocol';

/**
 * Thin Angular shell over the account rotate-password endpoint (design/12 §4 · REQ-17, D-045).
 *
 * The UI layer's ONLY seam to `POST /api/account/rotate-password`; the rotate page depends on this
 * interface, not on `HttpClient` (AC-16.2). All error normalization lives in the framework-free
 * `auth-protocol` core (unit-tested headlessly); this shell only wires rxjs to it.
 *
 * Header `Skip-Error` opts this request OUT of FUXA's global 401/403 auto-signout interceptor
 * (verified in `_helpers/auth-interceptor.ts`) so a `400 bad_current_password` / `weak_or_reused_password`
 * surfaces as a FORM error instead of a global sign-out — while STILL sending the `x-access-token`
 * (only `Skip-Auth` strips the token; the gated bootstrap token is authorized for `account.rotatePassword`).
 */
@Injectable({ providedIn: 'root' })
export class RotatePasswordClient {

    private readonly baseUrl: string = EndPointApi.getURL();

    constructor(private http: HttpClient) { }

    /**
     * POST /api/account/rotate-password { currentPassword, newPassword }. Emits `void` on 2xx; errors
     * with a stable, normalized `RotateError` (never the raw `HttpErrorResponse`).
     */
    rotate(currentPassword: string, newPassword: string): Observable<void> {
        const headers = new HttpHeaders({ 'Content-Type': 'application/json', 'Skip-Error': 'true' });
        return this.http
            .post(`${this.baseUrl}/api/account/rotate-password`, { currentPassword, newPassword }, { headers })
            .pipe(
                map((body) => {
                    if (!isRotateSuccess(body)) {
                        // A 2xx without the success marker is treated as an unexpected failure.
                        throw { errorId: 'unexpected_error', status: 200 } as RotateError;
                    }
                    return void 0;
                }),
                catchError((err: HttpErrorResponse | RotateError) => {
                    // Already-normalized RotateError (from the map guard) passes through untouched.
                    if (err && typeof (err as RotateError).errorId === 'string') {
                        return throwError(() => err as RotateError);
                    }
                    const httpErr = err as HttpErrorResponse;
                    const status = typeof httpErr?.status === 'number' ? httpErr.status : 0;
                    return throwError(() => normalizeRotateError(status, httpErr?.error));
                }),
            );
    }
}
