//@ts-check
'use strict';

/**
 * Role_Service — role/permission management (design/05-rbac-authorization.md · REQ-9).
 *
 * Service-layer owner of `create/list/update/delete` over the injected `Role_Store` + `Audit_Logger`
 * (AC-16.2/16.5, D-003 — no FUXA row-shape knowledge here). Each operation returns a closed outcome
 * the API layer maps to HTTP (§8.1). Role identity is `role.id` (the roles-table PK stores role.id;
 * §3.1); where a request supplies only a display name the API layer maps it to the id first.
 *
 * AC-9.5 duplicate rejection uses the store's ATOMIC create (D-020/D-024: plain INSERT → PK conflict
 * → `DuplicateKeyError`), NOT a read-then-write pre-check — this is TOCTOU-free and still leaves the
 * existing role unmodified (a failed INSERT does not REPLACE), which is exactly AC-9.5. (This is a
 * faithful, stronger realization of §3.3's intent; see N-036.)
 *
 * AC-9.4 delete prunes the deleted ids from every referencing user: delegated to `Role_Store.delete`
 * (adapter → verified FUXA `removeRoles`, store + `usersMap`). `prunedUsers` is computed from a
 * pre-delete `User_Store.readAll` scan when a `userStore` is injected (accurate, not fabricated);
 * without one it is reported empty.
 */

class RoleService {
    /**
     * @param {{
     *   roleStore: { get(id: string): Promise<any|undefined>, readAll(): Promise<{records:any[],errors:any[]}>, create(role: any): Promise<void>, update(role: any): Promise<void>, delete(ids: string[]): Promise<void> },
     *   auditLogger: { record(event: object): void },
     *   userStore?: { readAll(): Promise<{records:any[],errors:any[]}> },
     *   clock?: () => number
     * }} deps
     */
    constructor(deps) {
        const d = deps || {};
        if (!d.roleStore || ['get', 'readAll', 'create', 'update', 'delete'].some((m) => typeof d.roleStore[m] !== 'function')) {
            throw new Error('RoleService requires a roleStore (get/readAll/create/update/delete)');
        }
        if (!d.auditLogger || typeof d.auditLogger.record !== 'function') {
            throw new Error('RoleService requires an auditLogger');
        }
        this.roleStore = d.roleStore;
        this.auditLogger = d.auditLogger;
        this.userStore = d.userStore || null;
        this.clock = typeof d.clock === 'function' ? d.clock : Date.now;
    }

    /**
     * @param {string} operation
     * @param {string} subject
     * @param {string} outcome
     * @private
     */
    _audit(operation, subject, outcome) {
        try {
            this.auditLogger.record({
                category: 'role',
                operation,
                subject: String(subject),
                outcome,
                timestamp: new Date(this.clock()).toISOString(),
            });
        } catch (_e) { /* audit never affects the outcome (§7 §09) */ }
    }

    /**
     * Validate a Role's shape: `id`/`name` non-empty strings, `permissions` an array of strings.
     * @param {any} role
     * @returns {string|null} an error detail, or null when valid
     * @private
     */
    _validateRole(role) {
        if (!role || typeof role !== 'object') return 'role must be an object';
        if (typeof role.id !== 'string' || role.id.trim() === '') return 'id is required';
        if (typeof role.name !== 'string' || role.name.trim() === '') return 'name is required';
        if (!Array.isArray(role.permissions) || role.permissions.some((p) => typeof p !== 'string')) {
            return 'permissions must be an array of permission ids';
        }
        return null;
    }

    /**
     * Create a role (AC-9.1); reject a duplicate id atomically without overwriting (AC-9.5).
     * @param {any} role a `{ id, name, permissions }`
     * @returns {Promise<{kind:'created',role:any}|{kind:'duplicate',error:'duplicate_role',name:string}|{kind:'invalid',error:'validation_error',detail:string}>}
     */
    async create(role) {
        const detail = this._validateRole(role);
        if (detail) {
            return { kind: 'invalid', error: 'validation_error', detail };
        }
        const clean = { id: role.id, name: role.name, permissions: role.permissions.slice() };
        try {
            await this.roleStore.create(clean); // plain INSERT → atomic duplicate rejection (D-024)
        } catch (e) {
            if (e && e.code === 'duplicate_key') {
                return { kind: 'duplicate', error: 'duplicate_role', name: clean.id };
            }
            throw e; // unexpected store error → surfaced to the API (5xx)
        }
        this._audit('role.create', clean.id, 'success');
        return { kind: 'created', role: clean };
    }

    /**
     * List every stored role with its name + permissions (AC-9.2). Resilient: one corrupt row is
     * isolated by the store's `readAll` and excluded from the returned set (AC-13.4).
     * @returns {Promise<{kind:'ok',roles:any[]}>}
     */
    async list() {
        const { records } = await this.roleStore.readAll();
        return { kind: 'ok', roles: records };
    }

    /**
     * Replace a role's permission set wholesale (AC-9.3). Unknown target → `unknown_role`, no write.
     * @param {string} roleId the role id (the roles-table PK / §3.1 canonical identifier)
     * @param {string[]} permissions the NEW permission set (replaces, not merges)
     * @returns {Promise<{kind:'updated',role:any}|{kind:'unknown_role',error:'role_not_found',name:string}|{kind:'invalid',error:'validation_error',detail:string}>}
     */
    async update(roleId, permissions) {
        if (typeof roleId !== 'string' || roleId.trim() === '') {
            return { kind: 'invalid', error: 'validation_error', detail: 'roleId is required' };
        }
        if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== 'string')) {
            return { kind: 'invalid', error: 'validation_error', detail: 'permissions must be an array of permission ids' };
        }
        const existing = await this.roleStore.get(roleId);
        if (!existing) {
            return { kind: 'unknown_role', error: 'role_not_found', name: roleId };
        }
        // Preserve id + display name; replace the permission set verbatim (empty set = demotion).
        const role = { id: existing.id, name: existing.name, permissions: permissions.slice() };
        await this.roleStore.update(role);
        this._audit('role.update', roleId, 'success');
        return { kind: 'updated', role };
    }

    /**
     * Delete roles and prune the ids from every referencing user (AC-9.4). Idempotent for unknown
     * ids. `prunedUsers` is computed from a pre-delete user scan when a `userStore` is injected.
     * @param {string[]} ids role ids to delete
     * @returns {Promise<{kind:'deleted',removed:string[],prunedUsers:string[]}>}
     */
    async delete(ids) {
        const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string' && x.trim() !== '') : [];
        if (list.length === 0) {
            return { kind: 'deleted', removed: [], prunedUsers: [] };
        }
        const idSet = new Set(list);
        // Accurate prunedUsers: scan users BEFORE the delete for any that reference a deleted id.
        let prunedUsers = [];
        if (this.userStore && typeof this.userStore.readAll === 'function') {
            const { records } = await this.userStore.readAll();
            prunedUsers = records
                .filter((u) => Array.isArray(u.roles) && u.roles.some((r) => idSet.has(r)))
                .map((u) => u.username);
        }
        await this.roleStore.delete(list); // adapter → removeRoles: prune info.roles per user + delete rows
        this._audit('role.delete', list.join(','), 'success');
        return { kind: 'deleted', removed: list, prunedUsers };
    }
}

module.exports = { RoleService };
