import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';

import { AuthService } from '../../_services/auth.service';
import { ProjectService } from '../../_services/project.service';
import { SessionStore } from './session.store';
import { PermissionsClient } from '../clients/permissions.client';
import { IdentityPermissions } from '../clients/auth-protocol';

/**
 * Permission ids from the RBAC model (design/05-rbac-authorization.md §2/§5).
 * `user.read` is the permission the management route requires (AC-10.4, AC-12.6).
 */
export const USER_READ = 'user.read';

/** Permission the Role-Management route requires (AC-9.2 / D-046). */
export const ROLE_READ = 'role.read';

/**
 * The subset of a Role definition needed to resolve permissions client-side.
 * Full contract: `Role { id, name, permissions[] }` (design/05 §3; §08 §2.4 `RoleAdminClient`).
 */
export interface RolePermissions {
    id: string;
    permissions: string[];
}

/**
 * Module-owned, permission-aware check used by the management-route guard (D-011).
 *
 * IMPORTANT — this is a **UX gate only**, NOT a security boundary. The server (§05
 * authorization middleware) independently authorizes every data-bearing request and is the
 * real boundary (defense in depth): even if this gate is bypassed, `GET /api/users` returns
 * 403 for a non-admin (design/08 §6.1/§6.3). This service only decides whether to show the
 * page or surface an authorization error before any request is issued.
 *
 * Authorization is expressed as a `user.read` **permission** check against the module's
 * first-class `roles` (D-007), consistent with the RBAC model — not a username/group test
 * (contrast FUXA's coarse `isAdmin()`/`username === 'admin'` gate, verified in auth.guard.ts
 * / users.component.ts). It builds on the reused FUXA primitives without modifying them.
 */
@Injectable({ providedIn: 'root' })
export class ModulePermissionService {

    /** role id → permissions[], populated by the page once `GET /api/roles` has loaded (§05). */
    private roleDefs = new Map<string, string[]>();

    /**
     * The identity's SERVER-COMPUTED effective permissions (`GET /api/auth/permissions`, D-050), or
     * `null` when not yet loaded / unavailable. This is the authoritative input for a non-admin.
     */
    private effective: Set<string> | null = null;

    /** The server-owned grantable permission vocabulary (D-050), or `null` when not loaded. */
    private catalog: string[] | null = null;

    /** In-flight/completed load, shared so concurrent pages trigger exactly ONE request per session. */
    private loadOnce: Observable<IdentityPermissions | null> | null = null;

    constructor(
        private authService: AuthService,
        private projectService: ProjectService,
        private session: SessionStore,
        private permissionsClient: PermissionsClient
    ) { }

    /**
     * Load (once per session) the identity's own authority + the permission vocabulary from the
     * server, then complete. Pages MUST call this before gating so the decision is made on real data
     * instead of an empty local cache — the root fix for the N-091 L1 deadlock, where the gate denied
     * a legitimate `user.read` holder because it could only learn permissions from `GET /api/roles`
     * (403 for that very user).
     *
     * NEVER errors out to the caller: a failed/unavailable load resolves `null` and leaves
     * `effective` as `null`, which `hasPermission` treats as "defer to the server" (see there).
     * `shareReplay` makes concurrent callers share one HTTP request and later callers reuse the result.
     */
    ensureLoaded(): Observable<IdentityPermissions | null> {
        if (!this.loadOnce) {
            this.loadOnce = this.permissionsClient.get().pipe(
                tap((p) => {
                    this.effective = new Set<string>(p.effective || []);
                    this.catalog = Array.isArray(p.catalog) ? p.catalog.slice() : [];
                }),
                map((p) => p as IdentityPermissions | null),
                catchError(() => of(null)),
                shareReplay({ bufferSize: 1, refCount: false })
            );
        }
        return this.loadOnce;
    }

    /** Drop the cached authority (call on sign-out / identity change) so the next page reloads it. */
    reset(): void {
        this.effective = null;
        this.catalog = null;
        this.loadOnce = null;
    }

    /**
     * The server-owned grantable permission vocabulary, or `[]` when not loaded. The role editor
     * unions this with the permissions already present on loaded roles; `[]` makes it fall back to its
     * local constant, so the editor always renders something.
     */
    permissionCatalog(): string[] {
        return this.catalog ? this.catalog.slice() : [];
    }

    /**
     * Provide the role→permission definitions (from `RoleAdminClient.list()`, §05) so this
     * service can resolve permissions from the session's first-class role ids. Called by the
     * management page on load (task 17); until then `hasPermission` defers to server enforcement.
     */
    setRoleDefinitions(roles: RolePermissions[]): void {
        this.roleDefs.clear();
        for (const role of roles || []) {
            this.roleDefs.set(role.id, role.permissions || []);
        }
    }

    /**
     * Whether the current identity holds `permission`.
     *  - security disabled          → allow (nothing to gate);
     *  - administrator              → allow (admins hold the whole ADMIN_PERMISSION_SET, AC-10.4);
     *  - server `effective` loaded  → authoritative set-membership (D-050). This is the SAME set the
     *                                 server's `isAllowed` consults, so the gate cannot disagree with
     *                                 enforcement;
     *  - `effective` NOT loaded     → fall back to locally-known role definitions if any were supplied,
     *                                 else **defer to the server** (allow the attempt).
     *
     * Why deferring (not denying) is correct when nothing is loaded — this is the D-050 root fix.
     * The previous code denied here, and because a non-admin cannot read `GET /api/roles` the local
     * cache could never fill, so the deny was PERMANENT: a user holding `user.read` was locked out of a
     * page the server would happily serve (verified live, N-091 L1). Deferring costs at most one
     * request that the server answers with 403 — which the page already renders as "Unauthorized!" —
     * and it CANNOT leak anything, because this gate is UX-only and every data-bearing endpoint is
     * independently authorized server-side. Fail-open in a UX hint, fail-closed in enforcement.
     */
    hasPermission(permission: string): boolean {
        if (!this.projectService.isSecurityEnabled()) {
            return true;
        }
        if (this.authService.isAdmin()) {
            return true;
        }
        if (this.effective) {
            return this.effective.has(permission);
        }
        const roleIds = this.session.roles();
        if (this.roleDefs.size > 0) {
            return roleIds.some(id => (this.roleDefs.get(id) || []).includes(permission));
        }
        // Authority unknown (endpoint unavailable/not yet loaded) → let the server decide.
        return true;
    }

    /** Convenience for the management-route gate (AC-12.6). */
    canReadUsers(): boolean {
        return this.hasPermission(USER_READ);
    }

    /** Convenience for the Role-Management route gate (D-046). */
    canReadRoles(): boolean {
        return this.hasPermission(ROLE_READ);
    }
}
