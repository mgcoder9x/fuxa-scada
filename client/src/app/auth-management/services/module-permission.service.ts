import { Injectable } from '@angular/core';

import { AuthService } from '../../_services/auth.service';
import { ProjectService } from '../../_services/project.service';
import { SessionStore } from './session.store';

/**
 * Permission ids from the RBAC model (design/05-rbac-authorization.md §2/§5).
 * `user.read` is the permission the management route requires (AC-10.4, AC-12.6).
 */
export const USER_READ = 'user.read';

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

    constructor(
        private authService: AuthService,
        private projectService: ProjectService,
        private session: SessionStore
    ) { }

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
     *  - security disabled  → allow (nothing to gate);
     *  - administrator      → allow (admins hold `user.*` incl. `user.read`, AC-10.4);
     *  - otherwise          → resolve from first-class `roles` (D-007) against loaded role defs;
     *                         if no defs are loaded yet, deny locally and let the server enforce (403).
     */
    hasPermission(permission: string): boolean {
        if (!this.projectService.isSecurityEnabled()) {
            return true;
        }
        if (this.authService.isAdmin()) {
            return true;
        }
        const roleIds = this.session.roles();
        if (this.roleDefs.size === 0) {
            return false;
        }
        return roleIds.some(id => (this.roleDefs.get(id) || []).includes(permission));
    }

    /** Convenience for the management-route gate (AC-12.6). */
    canReadUsers(): boolean {
        return this.hasPermission(USER_READ);
    }
}
