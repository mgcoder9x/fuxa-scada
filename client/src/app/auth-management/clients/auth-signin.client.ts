import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { EndPointApi } from '../../_helpers/endpointapi';
import {
    SignInResult, SignInError,
    mapSignInSuccess, normalizeSignInError,
} from './auth-protocol';

/**
 * Thin Angular shell over the pure sign-in protocol (design/07 §2.3 · REQ-11, D-011/D-036).
 *
 * This is the UI layer's ONLY seam to `POST /api/signin`; the component depends on this interface,
 * not on `HttpClient` (AC-16.2). All mapping / error-normalization lives in the framework-free
 * `auth-protocol` core (unit-tested headlessly); this shell only wires rxjs to that core.
 *
 * `Skip-Error` opts this request out of FUXA's global 401/403 interceptor (verified in
 * `_helpers/auth-interceptor.ts`) so a `401 invalid_credentials` surfaces to the Login Page as a
 * form error instead of triggering a global sign-out/reload (§07 §5.2). The base URL is resolved by
 * the existing `EndPointApi.getURL()` so host/proxy resolution matches the rest of the app.
 */
@Injectable({ providedIn: 'root' })
export class AuthSignInClient {

    private readonly baseUrl: string = EndPointApi.getURL();

    constructor(private http: HttpClient) { }

    /**
     * POST /api/signin { username, password }. Emits a `SignInResult` on 2xx; errors with a stable,
     * normalized `SignInError` (never the raw `HttpErrorResponse`) so the component branches on
     * `errorId`, never on transport/message text.
     */
    signIn(username: string, password: string): Observable<SignInResult> {
        const headers = new HttpHeaders({ 'Content-Type': 'application/json', 'Skip-Error': 'true' });
        return this.http
            .post(`${this.baseUrl}/api/signin`, { username, password }, { headers })
            .pipe(
                map((body) => mapSignInSuccess(body)),
                catchError((err: HttpErrorResponse) => {
                    const status = typeof err?.status === 'number' ? err.status : 0;
                    const normalized: SignInError = normalizeSignInError(status, err?.error);
                    return throwError(() => normalized);
                }),
            );
    }
}
