import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { EndPointApi } from '../../_helpers/endpointapi';
import {
    UserView, AdminError,
    mapUsersResponse, mapUserResponse, mapUserView, normalizeAdminError,
} from './auth-protocol';

/** Fields accepted when creating a user (server whitelist, users.router.js POST /api/users). */
export interface CreateUserInput {
    username: string;
    fullname?: string;
    password: string;
    roles?: string[];
    metadata?: Record<string, unknown>;
}

/** Patch fields accepted on update (server whitelist, users.router.js PUT /api/users/:username). */
export interface UpdateUserInput {
    fullname?: string;
    roles?: string[];
    metadata?: Record<string, unknown>;
    password?: string;
}

/**
 * Thin Angular shell over the pure users protocol (design/04 §8.2 · REQ-5/6/7/8/12, D-011/D-036).
 *
 * The UI layer's ONLY seam to the guarded `/api/users` endpoints; the User-Management page depends
 * on this interface, not on `HttpClient` (AC-16.2). Every response is mapped to a hash-free
 * `UserView` by the framework-free `auth-protocol` core; every non-2xx is normalized to a stable
 * `AdminError` so the page branches on `errorId`, never on message text.
 *
 * `Skip-Error` opts these authenticated calls out of FUXA's global 401/403 interceptor so a
 * `403 forbidden` (insufficient permission) surfaces as an in-page error instead of forcing a
 * global sign-out/reload — the access token is attached by the existing `x-access-token`
 * interceptor. The base URL is resolved by `EndPointApi.getURL()`.
 */
@Injectable({ providedIn: 'root' })
export class UserAdminClient {

    private readonly baseUrl: string = EndPointApi.getURL();
    private readonly headers = new HttpHeaders({ 'Content-Type': 'application/json', 'Skip-Error': 'true' });

    constructor(private http: HttpClient) { }

    /** GET /api/users → hash-free `UserView[]` (AC-6.1/6.2). */
    list(): Observable<UserView[]> {
        return this.http.get(`${this.baseUrl}/api/users`, { headers: this.headers })
            .pipe(map((body) => mapUsersResponse(body)), catchError((e) => this.fail(e)));
    }

    /** GET /api/users/:username → `UserView | null` (empty result is null, not an error — AC-6.4). */
    get(username: string): Observable<UserView | null> {
        return this.http.get(`${this.baseUrl}/api/users/${encodeURIComponent(username)}`, { headers: this.headers })
            .pipe(map((body) => mapUserResponse(body)), catchError((e) => this.fail(e)));
    }

    /** POST /api/users → created `UserView` (AC-5.1); 400 duplicate/missing_field/invalid normalized. */
    create(input: CreateUserInput): Observable<UserView> {
        return this.http.post(`${this.baseUrl}/api/users`, input, { headers: this.headers })
            .pipe(map((body) => mapUserView(this.data(body))), catchError((e) => this.fail(e)));
    }

    /** PUT /api/users/:username → updated `UserView` (AC-7.*); 404 user_not_found / 400 invalid normalized. */
    update(username: string, patch: UpdateUserInput): Observable<UserView> {
        return this.http.put(`${this.baseUrl}/api/users/${encodeURIComponent(username)}`, patch, { headers: this.headers })
            .pipe(map((body) => mapUserView(this.data(body))), catchError((e) => this.fail(e)));
    }

    /** DELETE /api/users/:username → void on success (AC-8.*); 400 last_admin / 404 user_not_found normalized. */
    delete(username: string): Observable<void> {
        return this.http.delete(`${this.baseUrl}/api/users/${encodeURIComponent(username)}`, { headers: this.headers })
            .pipe(map(() => undefined as void), catchError((e) => this.fail(e)));
    }

    /** Extract the `data` field from a `{ status, data }` envelope (defensive). */
    private data(body: unknown): unknown {
        return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)['data'] : body;
    }

    /** Normalize any transport/HTTP error to a stable `AdminError` (never the raw response). */
    private fail(err: HttpErrorResponse): Observable<never> {
        const status = typeof err?.status === 'number' ? err.status : 0;
        const normalized: AdminError = normalizeAdminError(status, err?.error);
        return throwError(() => normalized);
    }
}
