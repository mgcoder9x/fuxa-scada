/**
 * Pure, framework-free Role-Management page presenter (design/05 §8.1 · REQ-9, D-046).
 *
 * DV-010: ALL logic for the Role-Management page lives HERE, in a plain class with NO Angular
 * decorator/import, so it is unit-testable headlessly with jest (no TestBed/DOM/browser). The thin
 * standalone `@Component` shell (`role-management.component.ts`, D-039) only binds a template to this
 * presenter and wires the real seams. Mirrors `UserManagementPresenter` (DV-010, N-056) +
 * `auth-protocol` pure core (D-036).
 *
 * Server contract (VERIFIED, roles.router.js / role.service.js · §05 §8.1):
 *  - list  : GET  /api/roles                 → RoleOption[] { id, name, permissions[] }   (role.read)
 *  - create: POST /api/roles {id,name,perms} → created role | duplicate_role | validation_error (role.create)
 *  - update: PUT  /api/roles/:id {perms}      → role (PERMISSIONS replaced wholesale; id+name IMMUTABLE) | role_not_found | validation_error (role.update)
 *  - delete: DELETE /api/roles/:id            → { removed, prunedUsers } (prunes referencing users)  (role.delete)
 *
 * Security posture: the client access gate is UX-ONLY; the server (§05) authorizes every request and
 * is the real boundary — a 401/403 on `list()` still forces `access='denied'`. Errors render a
 * GENERIC i18n KEY, never server text.
 */

import type { Observable } from 'rxjs';
import type { RoleOption, AdminError, AdminErrorId } from '../clients/auth-protocol';
import type { RoleDeleteResult } from '../clients/role-admin.client';

/** Access-gate result for the page (mirrors AC-12.6 for users). */
export type AccessState = 'checking' | 'granted' | 'denied';
/** Role form mode: closed (null), create (id+name+perms), or edit (perms only — id/name immutable). */
export type RoleFormMode = 'create' | 'edit';

/**
 * The canonical assignable permission catalog — a CLIENT MIRROR of the server's `ADMIN_PERMISSION_SET`
 * (VERIFIED in `server/auth-management/services/authorization.service.js`). Drift risk is documented
 * in D-046; the root-correct follow-up is a server `GET /api/permissions` endpoint. `account.rotatePassword`
 * is intentionally excluded here (self-service/gate permission, Phase-3 concern).
 */
export const KNOWN_PERMISSIONS: readonly string[] = Object.freeze([
    'user.create', 'user.read', 'user.update', 'user.delete',
    'role.create', 'role.read', 'role.update', 'role.delete',
]);

/** Generic i18n KEYS for role admin outcomes (translation keys, never server text). */
export const ROLE_MGMT_ERROR_KEYS = {
    unauthorized: 'msg.signin-unauthorized',
    duplicateRole: 'msg.role-duplicate',
    invalid: 'msg.role-invalid-input',
    notFound: 'msg.role-not-found',
    failed: 'msg.roles-error',
} as const;

/** Map a stable AdminError.errorId to a GENERIC role i18n key. */
export function mapRoleAdminErrorKey(errorId: AdminErrorId | string | null | undefined): string {
    switch (errorId) {
        case 'unauthorized_error':
        case 'forbidden':
            return ROLE_MGMT_ERROR_KEYS.unauthorized;
        case 'duplicate_role':
            return ROLE_MGMT_ERROR_KEYS.duplicateRole;
        case 'validation_error':
        case 'missing_field':
            return ROLE_MGMT_ERROR_KEYS.invalid;
        case 'role_not_found':
            return ROLE_MGMT_ERROR_KEYS.notFound;
        default:
            return ROLE_MGMT_ERROR_KEYS.failed;
    }
}

function isAccessError(err: AdminError | undefined): boolean {
    if (!err) return false;
    return err.status === 401 || err.status === 403
        || err.errorId === 'unauthorized_error' || err.errorId === 'forbidden';
}

/** Seams the presenter needs, injected as plain functions (DV-010) — never Angular services. */
export interface RoleManagementSeams {
    canReadRoles: () => boolean;
    listRoles: () => Observable<RoleOption[]>;
    createRole: (input: { id: string; name: string; permissions: string[] }) => Observable<RoleOption>;
    updateRole: (id: string, permissions: string[]) => Observable<RoleOption>;
    deleteRole: (id: string) => Observable<RoleDeleteResult>;
}

export class RoleManagementPresenter {
    roles: RoleOption[] = [];
    access: AccessState = 'checking';
    loading = false;
    savePending = false;
    deletePending = false;
    errorKey: string | null = null;

    /** Form state (null = closed). */
    formMode: RoleFormMode | null = null;
    formId = '';
    formName = '';
    /** Selected permission ids for the form (a Set for O(1) toggle/has). */
    formPermissions = new Set<string>();

    constructor(private readonly seams: RoleManagementSeams) { }

    /** Gate + initial load. `access` starts `checking`; a non-`role.read` identity → `denied`, no request. */
    init(): void {
        this.access = 'checking';
        this.errorKey = null;
        if (!this.seams.canReadRoles()) {
            this.access = 'denied';
            this.errorKey = ROLE_MGMT_ERROR_KEYS.unauthorized;
            return;
        }
        this.access = 'granted';
        this.refresh();
    }

    /** (Re)load the role list. 401/403 → `denied`; else a generic error key. */
    refresh(): void {
        this.loading = true;
        this.errorKey = null;
        this.seams.listRoles().subscribe({
            next: (roles) => { this.roles = roles || []; this.loading = false; },
            error: (err: AdminError) => {
                this.loading = false;
                if (isAccessError(err)) {
                    this.access = 'denied';
                    this.errorKey = ROLE_MGMT_ERROR_KEYS.unauthorized;
                } else {
                    this.errorKey = mapRoleAdminErrorKey(err ? err.errorId : undefined);
                }
            },
        });
    }

    /**
     * Assignable permission catalog: the known set (client mirror of the server ADMIN_PERMISSION_SET,
     * D-046) UNION any permission already present on a loaded role (so a custom/unknown perm stored on
     * a role is never hidden). Sorted for a stable display order.
     */
    availablePermissions(): string[] {
        const set = new Set<string>(KNOWN_PERMISSIONS);
        for (const r of this.roles) {
            for (const p of (r.permissions || [])) {
                if (typeof p === 'string' && p.length > 0) set.add(p);
            }
        }
        return Array.from(set).sort();
    }

    // --- Form ---------------------------------------------------------------

    openCreate(): void {
        this.formMode = 'create';
        this.formId = '';
        this.formName = '';
        this.formPermissions = new Set<string>();
        this.errorKey = null;
    }

    openEdit(role: RoleOption): void {
        this.formMode = 'edit';
        this.formId = role.id;
        this.formName = role.name;
        this.formPermissions = new Set<string>(Array.isArray(role.permissions) ? role.permissions : []);
        this.errorKey = null;
    }

    closeForm(): void {
        this.formMode = null;
        this.formId = '';
        this.formName = '';
        this.formPermissions = new Set<string>();
    }

    hasPermission(p: string): boolean {
        return this.formPermissions.has(p);
    }

    togglePermission(p: string, on: boolean): void {
        if (on) this.formPermissions.add(p);
        else this.formPermissions.delete(p);
    }

    /**
     * Submit is permitted only when: create → id+name non-empty (trimmed) and not saving; edit →
     * not saving (permissions MAY be empty = demotion, which the server allows). id/name are immutable
     * in edit mode (server PUT only replaces permissions).
     */
    canSubmit(): boolean {
        if (this.savePending || this.formMode === null) return false;
        if (this.formMode === 'create') {
            return this.formId.trim() !== '' && this.formName.trim() !== '';
        }
        return true; // edit: permissions-only, empty allowed
    }

    /**
     * Create (id+name+perms) or update (perms wholesale). On success → close + refresh. On error →
     * map a generic key, STAY on the form. `savePending` resets in every terminal branch.
     */
    submitForm(): void {
        if (!this.canSubmit() || this.formMode === null) return;
        this.savePending = true;
        this.errorKey = null;
        const permissions = Array.from(this.formPermissions);
        const done = () => { this.savePending = false; this.closeForm(); this.refresh(); };
        const fail = (err: AdminError) => {
            this.savePending = false;
            if (isAccessError(err)) { this.access = 'denied'; this.errorKey = ROLE_MGMT_ERROR_KEYS.unauthorized; }
            else { this.errorKey = mapRoleAdminErrorKey(err ? err.errorId : undefined); }
        };
        if (this.formMode === 'create') {
            this.seams.createRole({ id: this.formId.trim(), name: this.formName.trim(), permissions })
                .subscribe({ next: done, error: fail });
        } else {
            this.seams.updateRole(this.formId, permissions).subscribe({ next: done, error: fail });
        }
    }

    // --- Delete -------------------------------------------------------------

    /** Confirmed delete (host calls after confirm). Removes the row on success (+ server prunes users). */
    deleteRole(id: string): void {
        if (this.deletePending) return;
        this.deletePending = true;
        this.errorKey = null;
        this.seams.deleteRole(id).subscribe({
            next: () => {
                this.deletePending = false;
                this.roles = this.roles.filter((r) => r.id !== id);
            },
            error: (err: AdminError) => {
                this.deletePending = false;
                if (isAccessError(err)) { this.access = 'denied'; this.errorKey = ROLE_MGMT_ERROR_KEYS.unauthorized; }
                else if (err && (err.errorId === 'role_not_found' || err.status === 404)) {
                    this.refresh(); this.errorKey = ROLE_MGMT_ERROR_KEYS.notFound;
                } else { this.errorKey = mapRoleAdminErrorKey(err ? err.errorId : undefined); }
            },
        });
    }

    /** Comma-joined permission list for a row. */
    permissionLabel(role: RoleOption): string {
        return Array.isArray(role.permissions) ? role.permissions.join(', ') : '';
    }
}
