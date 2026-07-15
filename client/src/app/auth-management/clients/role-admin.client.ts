import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { EndPointApi } from '../../_helpers/endpointapi';
import {
    RoleOption, AdminError,
    mapRolesResponse, normalizeAdminError,
} from './auth-protocol';

/** Fields accepted when creating a role (server whitelist, roles.router.js POST /api/roles). */
export interface CreateRoleInput {
    id: string;
    name?: string;
    permissions?: string[];
}

/** Result of DELETE /api/roles/:id (server returns removed + pruned referencing users). */
export interface RoleDeleteResult {
    removed: string[];
    prunedUsers: string[];
}

/**
 * Thin Angular shell over the pure roles protocol (design/05 §8.1 · REQ-9, D-011/D-036).
 *
 * The UI layer's ONLY seam to the guarded `/api/roles` endpoints; the page depends on this
 * interface, not on `HttpClient` (AC-16.2). Role identity is `role.id` (§05 §3.1). Responses are
 * mapped by the framework-free `auth-protocol` core; every non-2xx is normalized to a stable
 * `AdminError`. `Skip-Error` keeps a `403 forbidden` an in-page error rather than a global
 * sign-out. The base URL is resolved by `EndPointApi.getURL()`.
 */
@Injectable({ providedIn: 'root' })
export class RoleAdminClient {

    private readonly baseUrl: string = EndPointApi.getURL();
    private readonly headers = new HttpHeaders({ 'Content-Type': 'application/json', 'Skip-Error': 'true' });

    constructor(private http: HttpClient) { }

    /** GET /api/roles → `RoleOption[]` (AC-9.2). */
    list(): Observable<RoleOption[]> {
        return this.http.get(`${this.baseUrl}/api/roles`, { headers: this.headers })
            .pipe(map((body) => mapRolesResponse(body)), catchError((e) => this.fail(e)));
    }

    /** POST /api/roles → created `RoleOption` (AC-9.1); 400 duplicate_role / invalid normalized. */
    create(input: CreateRoleInput): Observable<RoleOption> {
        return this.http.post(`${this.baseUrl}/api/roles`, input, { headers: this.headers })
            .pipe(map((body) => this.oneRole(body)), catchError((e) => this.fail(e)));
    }

    /** PUT /api/roles/:id → role with the permission set replaced wholesale (AC-9.3); 404/400 normalized. */
    update(id: string, permissions: string[]): Observable<RoleOption> {
        return this.http.put(`${this.baseUrl}/api/roles/${encodeURIComponent(id)}`, { permissions }, { headers: this.headers })
            .pipe(map((body) => this.oneRole(body)), catchError((e) => this.fail(e)));
    }

    /** DELETE /api/roles/:id → removed ids + pruned referencing users (AC-9.4). */
    delete(id: string): Observable<RoleDeleteResult> {
        return this.http.delete(`${this.baseUrl}/api/roles/${encodeURIComponent(id)}`, { headers: this.headers })
            .pipe(map((body) => this.deleteResult(body)), catchError((e) => this.fail(e)));
    }

    /** Map a single-role `{ data: Role }` envelope by reusing the list mapper on a one-element array. */
    private oneRole(body: unknown): RoleOption {
        const data = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)['data'] : null;
        return mapRolesResponse({ data: [data] })[0];
    }

    /** Extract `{ removed, prunedUsers }` from the delete envelope (defensive). */
    private deleteResult(body: unknown): RoleDeleteResult {
        const data = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)['data'] : null;
        const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const asArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        return { removed: asArr(d['removed']), prunedUsers: asArr(d['prunedUsers']) };
    }

    /** Normalize any transport/HTTP error to a stable `AdminError` (never the raw response). */
    private fail(err: HttpErrorResponse): Observable<never> {
        const status = typeof err?.status === 'number' ? err.status : 0;
        const normalized: AdminError = normalizeAdminError(status, err?.error);
        return throwError(() => normalized);
    }
}
