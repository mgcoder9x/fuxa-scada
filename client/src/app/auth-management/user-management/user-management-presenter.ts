/**
 * Pure, framework-free User-Management page presenter (design/08 §2/§6 · REQ-12, AC-12.1/AC-12.6).
 *
 * DV-010: ALL page-container acceptance-criteria logic lives HERE, in a plain class with NO Angular
 * decorator/import, so it is unit-testable headlessly with jest (no TestBed, no DOM, no browser).
 * The thin standalone `@Component` shell (`user-management.component.ts`, D-039) only binds a
 * template to this presenter and wires the real seams. This mirrors the shipped `auth-protocol`
 * pure-core + thin-shell pattern (D-036/DV-009) and the Login presenter (DV-010, N-050).
 *
 * Scope of THIS presenter (Task 17.1): the page container — load the user list + role options,
 * resolve role ids → names for display, the access gate (`checking | granted | denied`, AC-12.6),
 * and the refresh cycle. The create/edit forms (17.2) and the delete flow (17.3) are separate
 * presenters that reuse `USER_MGMT_ERROR_KEYS` + `mapAdminErrorKey` below.
 *
 * Security posture (design/08 §9): the client access gate is UX-ONLY; the server (§05) authorizes
 * every request and is the real boundary — a `401`/`403` on `list()` still forces `access='denied'`.
 * No password/hash is ever handled (UserView is hash-free). Errors render a GENERIC i18n KEY,
 * never server text.
 */

import type { Observable } from 'rxjs';
import type { UserView, RoleOption, AdminError, AdminErrorId } from '../clients/auth-protocol';

/** Access-gate result for the page (AC-12.6). */
export type AccessState = 'checking' | 'granted' | 'denied';

/** Seams the presenter needs, injected as plain functions (DV-010) — never Angular services. */
export interface UserManagementSeams {
    /** UX gate: does the current identity hold `user.read`? (ModulePermissionService.canReadUsers) */
    canReadUsers: () => boolean;
    /**
     * Optional (D-051, fixes N-091 L5): does the identity hold an arbitrary permission?
     * (`ModulePermissionService.hasPermission`). Used to render only the actions the identity can
     * actually perform. When omitted, every action is offered — i.e. the previous behavior, with the
     * server as the enforcing boundary. Never a security control: the server authorizes every write.
     */
    can?: (permission: string) => boolean;
    /** GET /api/users → hash-free UserView[] (UserAdminClient.list). */
    listUsers: () => Observable<UserView[]>;
    /** GET /api/roles → RoleOption[] (RoleAdminClient.list). */
    listRoles: () => Observable<RoleOption[]>;
    /** DELETE /api/users/:username (UserAdminClient.delete) — used by the confirmed-delete flow (17.3). */
    deleteUser: (username: string) => Observable<void>;
    /**
     * Optional: called with the loaded role options so the host can populate the RBAC
     * permission resolver (ModulePermissionService.setRoleDefinitions), keeping role-based
     * permission checks consistent app-wide (design/05; Task 15 intent). Pure/testable.
     */
    onRolesLoaded?: (roles: RoleOption[]) => void;
}

/**
 * Generic, i18n KEYS for admin outcomes (design/08 §3.4/§5.2/§6). These are translation keys, never
 * rendered server text. `msg.signin-unauthorized` is an existing FUXA key (used by AuthGuard /
 * UserReadGuard); the rest are module keys (i18n entries are a separate, non-blocking polish).
 */
export const USER_MGMT_ERROR_KEYS = {
    unauthorized: 'msg.signin-unauthorized',
    duplicateUsername: 'msg.user-duplicate-username',
    invalid: 'msg.user-invalid-input',
    notFound: 'msg.user-not-found',
    lastAdmin: 'msg.user-last-admin',
    failed: 'msg.users-error',
} as const;

/**
 * D-051: SPECIFIC i18n keys for the server's machine-readable password-rejection codes.
 *
 * Fixes N-091 L2: the server knew exactly why a password was refused ("shorter than the 12-character
 * minimum" / "on the common-password blocklist") but the UI could only say "Invalid input", because
 * §9 forbids rendering server text. Mapping the CODE (not the text) to a translation key keeps that
 * rule intact while telling the operator the actual rule — and `password_too_short` interpolates the
 * runtime-configured minimum (D-049 makes it changeable, so it must not be hard-coded in the string).
 * An unknown/absent code falls back to the generic key, so a future server code can never break the UI.
 */
export const DETAIL_CODE_KEYS: Readonly<Record<string, string>> = Object.freeze({
    password_required: 'msg.user-password-required',
    password_too_short: 'msg.password-too-short',
    password_too_long: 'msg.password-too-long',
    password_blocklisted: 'msg.password-blocklisted',
    password_malformed: 'msg.password-malformed',
    password_reused: 'msg.rotate-weak-or-reused',
});

/**
 * Resolve the i18n key for an admin error, preferring the SPECIFIC key implied by the server's
 * `detailCode` (D-051) and falling back to the generic `errorId` mapping.
 */
export function mapAdminErrorDetailKey(err: AdminError | null | undefined): string {
    const code = err && err.detailCode;
    if (typeof code === 'string' && DETAIL_CODE_KEYS[code]) {
        return DETAIL_CODE_KEYS[code];
    }
    return mapAdminErrorKey(err ? err.errorId : undefined);
}

/** Map a stable AdminError.errorId (the §04/§05 contract) to a GENERIC i18n key. */
export function mapAdminErrorKey(errorId: AdminErrorId | string | null | undefined): string {
    switch (errorId) {
        case 'unauthorized_error':
        case 'forbidden':
            return USER_MGMT_ERROR_KEYS.unauthorized;
        case 'duplicate_username':
            return USER_MGMT_ERROR_KEYS.duplicateUsername;
        case 'validation_error':
        case 'missing_field':
            return USER_MGMT_ERROR_KEYS.invalid;
        case 'user_not_found':
            return USER_MGMT_ERROR_KEYS.notFound;
        case 'last_admin':
            return USER_MGMT_ERROR_KEYS.lastAdmin;
        default:
            return USER_MGMT_ERROR_KEYS.failed;
    }
}

/** True when an AdminError means "not allowed" (drives the access gate on the server path). */
function isAccessError(err: AdminError | undefined): boolean {
    if (!err) {
        return false;
    }
    return err.status === 401 || err.status === 403
        || err.errorId === 'unauthorized_error' || err.errorId === 'forbidden';
}

export class UserManagementPresenter {
    /** The displayed user list (AC-12.1) — never carries a password hash (UserView is hash-free). */
    users: UserView[] = [];
    /** Role options { id, name, permissions } for id→name resolution + (17.2) assignment dropdowns. */
    roles: RoleOption[] = [];
    /** True while the user-list fetch is in flight. */
    loading = false;
    /** True while a confirmed delete is in flight (separate from list `loading`). */
    deletePending = false;
    /** Access-gate result (AC-12.6): starts `checking`. */
    access: AccessState = 'checking';
    /** Generic i18n key for the current error, or null. */
    errorKey: string | null = null;

    constructor(private readonly seams: UserManagementSeams) { }

    /**
     * AC-12.6 gate + AC-12.1 load. `access` starts `checking`. If the current identity lacks
     * `user.read` (client UX gate), set `denied` and DO NOT issue any request. Otherwise `granted`:
     * load the role options (for id→name) and the user list. A `401`/`403` on the list (server
     * boundary, defense-in-depth) also drives `denied`.
     */
    init(): void {
        this.access = 'checking';
        this.errorKey = null;
        if (!this.seams.canReadUsers()) {
            this.access = 'denied';
            this.errorKey = USER_MGMT_ERROR_KEYS.unauthorized;
            return;                       // no request issued for a non-admin (AC-12.6)
        }
        this.access = 'granted';
        this.loadRoles();
        this.refresh();
    }

    /** Load role options; a failure leaves `roles=[]` (names then fall back to omission, §2.3). */
    loadRoles(): void {
        this.seams.listRoles().subscribe({
            next: (roles) => {
                this.roles = roles || [];
                if (this.seams.onRolesLoaded) {
                    this.seams.onRolesLoaded(this.roles);
                }
            },
            error: () => { this.roles = []; },
        });
    }

    /**
     * (Re)load the user list (AC-12.1; also the refresh-on-success target for 17.2). Sets `loading`
     * across the fetch; on a `401`/`403` flips the gate to `denied` (server path), else maps a
     * generic error key. Resolves `loading=false` in every terminal branch.
     */
    refresh(): void {
        this.loading = true;
        this.errorKey = null;
        this.seams.listUsers().subscribe({
            next: (users) => {
                this.users = users || [];
                this.loading = false;
            },
            error: (err: AdminError) => {
                this.loading = false;
                if (isAccessError(err)) {
                    this.access = 'denied';
                    this.errorKey = USER_MGMT_ERROR_KEYS.unauthorized;
                } else {
                    this.errorKey = mapAdminErrorKey(err ? err.errorId : undefined);
                }
            },
        });
    }

    /**
     * Confirmed-delete flow (design/08 §5 · AC-12.5). Called by the host ONLY after the
     * `DeleteUserConfirmDialog` is confirmed. On success removes exactly that row from the displayed
     * list (no full re-fetch). On `last_admin` (AC-8.5/D-009) KEEPS the row + shows the specific
     * message. On `user_not_found` shows the message + refreshes so the stale row disappears. A
     * `401`/`403` flips the gate to `denied`. `deletePending` resets in every terminal branch; a
     * second delete is ignored while one is in flight.
     */
    deleteUser(username: string): void {
        if (this.deletePending) {
            return;
        }
        this.deletePending = true;
        this.errorKey = null;
        this.seams.deleteUser(username).subscribe({
            next: () => {
                this.deletePending = false;
                this.users = this.users.filter((u) => u.username !== username);   // AC-12.5 remove row
            },
            error: (err: AdminError) => {
                this.deletePending = false;
                if (err && err.errorId === 'last_admin') {
                    this.errorKey = USER_MGMT_ERROR_KEYS.lastAdmin;                // keep the row (D-009)
                } else if (err && (err.errorId === 'user_not_found' || err.status === 404)) {
                    this.refresh();                                               // reconcile the stale row (clears errorKey)
                    this.errorKey = USER_MGMT_ERROR_KEYS.notFound;                // set AFTER refresh so it survives
                } else if (isAccessError(err)) {
                    this.access = 'denied';
                    this.errorKey = USER_MGMT_ERROR_KEYS.unauthorized;
                } else {
                    this.errorKey = mapAdminErrorKey(err ? err.errorId : undefined);
                }
            },
        });
    }

    /**
     * Resolve a user's role IDS to display NAMES via the loaded `roles` (design/08 §2.3), falling back
     * to the raw ID when no name is known.
     *
     * D-050 refinement (found by the N-091 follow-up live test): the original code OMITTED an
     * unresolved id. That was harmless when only admins reached this page, but a user holding
     * `user.read` WITHOUT `role.read` cannot load the role catalogue at all, so EVERY row's roles
     * rendered blank — the page silently under-reported authority, which is worse than showing a raw
     * id. Showing the id is truthful and still reconciles to the friendly name for anyone who can read
     * roles. An empty/whitespace id contributes nothing.
     */
    roleNames(user: UserView): string[] {
        if (!user || !Array.isArray(user.roles)) {
            return [];
        }
        const byId = new Map(this.roles.map((r) => [r.id, r.name]));
        return user.roles
            .map((id) => {
                const name = byId.get(id);
                if (typeof name === 'string' && name.length > 0) {
                    return name;
                }
                return typeof id === 'string' ? id.trim() : '';
            })
            .filter((label): label is string => label.length > 0);
    }

    /** Convenience for the template: comma-joined role names for a row. */
    roleLabel(user: UserView): string {
        return this.roleNames(user).join(', ');
    }

    // --- Action capabilities (D-051, fixes N-091 L5) -------------------------
    //
    // WHY. Before this, a `user.read`-only identity saw Add/Edit/Remove buttons and got a 403 it could
    // not anticipate: the UI advertised authority the identity did not have. Now that the server tells
    // the client its effective permissions (D-050), the honest UI is to offer only the possible actions.
    // These are UX affordances ONLY — the server still authorizes every mutation, so hiding a button
    // removes confusion, not protection. When the `can` seam is absent the actions are all offered and
    // the server decides (the pre-D-051 behavior), so no caller is forced to supply it.

    private allowed(permission: string): boolean {
        return this.seams.can ? this.seams.can(permission) === true : true;
    }

    /** May the identity create users (`user.create`)? Drives the "Add User" control. */
    get canCreateUsers(): boolean {
        return this.allowed('user.create');
    }

    /** May the identity edit users (`user.update`)? Drives the row "Edit" control. */
    get canUpdateUsers(): boolean {
        return this.allowed('user.update');
    }

    /** May the identity delete users (`user.delete`)? Drives the row "Remove" control. */
    get canDeleteUsers(): boolean {
        return this.allowed('user.delete');
    }
}
