/**
 * Headless jest specs for the pure `RoleManagementPresenter` (DV-010 · REQ-9, D-046).
 *
 * Framework-free: direct instantiation with plain stub seams (mirrors `user-management-presenter`
 * style). Seams return rxjs `of(...)`/`throwError(...)`; no TestBed, no DOM.
 */

import { of, throwError } from 'rxjs';

import {
    RoleManagementPresenter, ROLE_MGMT_ERROR_KEYS, KNOWN_PERMISSIONS, mapRoleAdminErrorKey, RoleManagementSeams,
} from './role-management-presenter';
import type { RoleOption, AdminError } from '../clients/auth-protocol';
import type { RoleDeleteResult } from '../clients/role-admin.client';

const ROLE_A: RoleOption = { id: 'operators', name: 'Operators', permissions: ['user.read'] };
const ROLE_B: RoleOption = { id: 'auditors', name: 'Auditors', permissions: ['user.read', 'custom.export'] };

function make(over: Partial<RoleManagementSeams> = {}) {
    const calls: any = { list: 0, create: [], update: [], delete: [] };
    const seams: RoleManagementSeams = {
        canReadRoles: over.canReadRoles ?? (() => true),
        listRoles: over.listRoles ?? (() => { calls.list++; return of([ROLE_A, ROLE_B]); }),
        createRole: over.createRole ?? ((i) => { calls.create.push(i); return of({ id: i.id, name: i.name, permissions: i.permissions }); }),
        updateRole: over.updateRole ?? ((id, p) => { calls.update.push([id, p]); return of({ id, name: id, permissions: p }); }),
        deleteRole: over.deleteRole ?? ((id) => { calls.delete.push(id); return of({ removed: [id], prunedUsers: [] } as RoleDeleteResult); }),
    };
    const presenter = new RoleManagementPresenter(seams);
    return { presenter, calls };
}

describe('RoleManagementPresenter.init (access gate)', () => {
    it('non-role.read identity → denied, NO list request', () => {
        let listed = false;
        const { presenter } = make({ canReadRoles: () => false, listRoles: () => { listed = true; return of([]); } });
        presenter.init();
        expect(presenter.access).toBe('denied');
        expect(presenter.errorKey).toBe(ROLE_MGMT_ERROR_KEYS.unauthorized);
        expect(listed).toBe(false);
    });

    it('granted → loads the role list', () => {
        const { presenter, calls } = make();
        presenter.init();
        expect(presenter.access).toBe('granted');
        expect(calls.list).toBe(1);
        expect(presenter.roles.map(r => r.id)).toEqual(['operators', 'auditors']);
        expect(presenter.loading).toBe(false);
    });

    it('a 403 on list flips the gate to denied', () => {
        const err: AdminError = { errorId: 'forbidden', status: 403 };
        const { presenter } = make({ listRoles: () => throwError(() => err) });
        presenter.init();
        expect(presenter.access).toBe('denied');
        expect(presenter.errorKey).toBe(ROLE_MGMT_ERROR_KEYS.unauthorized);
    });
});

describe('RoleManagementPresenter.availablePermissions', () => {
    it('= known catalog UNION permissions present on loaded roles, sorted', () => {
        const { presenter } = make();
        presenter.init();
        const avail = presenter.availablePermissions();
        for (const k of KNOWN_PERMISSIONS) { expect(avail).toContain(k); }
        expect(avail).toContain('custom.export');        // union from ROLE_B, not hidden
        expect(avail).toEqual([...avail].sort());          // stable sorted order
    });
});

describe('RoleManagementPresenter form + submit', () => {
    it('openCreate resets fields; canSubmit needs id+name', () => {
        const { presenter } = make();
        presenter.openCreate();
        expect(presenter.formMode).toBe('create');
        expect(presenter.canSubmit()).toBe(false);
        presenter.formId = 'ops'; presenter.formName = 'Ops';
        expect(presenter.canSubmit()).toBe(true);
    });

    it('create submit calls createRole with {id,name,permissions} then closes + refreshes', () => {
        const { presenter, calls } = make();
        presenter.init();
        presenter.openCreate();
        presenter.formId = ' ops '; presenter.formName = ' Ops '; presenter.togglePermission('user.read', true);
        presenter.submitForm();
        expect(calls.create).toHaveLength(1);
        expect(calls.create[0]).toEqual({ id: 'ops', name: 'Ops', permissions: ['user.read'] });  // trimmed
        expect(presenter.formMode).toBeNull();       // closed
        expect(calls.list).toBe(2);                   // initial + refresh-on-success
        expect(presenter.savePending).toBe(false);
    });

    it('edit submit sends permissions wholesale via updateRole(id, perms); id/name immutable', () => {
        const { presenter, calls } = make();
        presenter.init();
        presenter.openEdit(ROLE_A);
        expect(presenter.formMode).toBe('edit');
        expect(presenter.canSubmit()).toBe(true);     // perms optional in edit
        presenter.togglePermission('role.read', true);
        presenter.submitForm();
        expect(calls.update).toHaveLength(1);
        expect(calls.update[0][0]).toBe('operators');
        expect(calls.update[0][1].sort()).toEqual(['role.read', 'user.read']);
        expect(presenter.formMode).toBeNull();
    });

    it('duplicate_role on create → duplicate key, form STAYS open', () => {
        const err: AdminError = { errorId: 'duplicate_role', status: 400 };
        const { presenter } = make({ createRole: () => throwError(() => err) });
        presenter.openCreate();
        presenter.formId = 'ops'; presenter.formName = 'Ops';
        presenter.submitForm();
        expect(presenter.errorKey).toBe(ROLE_MGMT_ERROR_KEYS.duplicateRole);
        expect(presenter.formMode).toBe('create');    // stays open
        expect(presenter.savePending).toBe(false);
    });
});

describe('RoleManagementPresenter.deleteRole', () => {
    it('success removes the row', () => {
        const { presenter } = make();
        presenter.init();
        presenter.deleteRole('operators');
        expect(presenter.roles.map(r => r.id)).toEqual(['auditors']);
        expect(presenter.deletePending).toBe(false);
    });

    it('role_not_found → refresh + notFound key', () => {
        const err: AdminError = { errorId: 'role_not_found', status: 404 };
        const { presenter, calls } = make({ deleteRole: () => throwError(() => err) });
        presenter.init();
        presenter.deleteRole('ghost');
        expect(calls.list).toBe(2);                    // refreshed
        expect(presenter.errorKey).toBe(ROLE_MGMT_ERROR_KEYS.notFound);
    });
});

describe('mapRoleAdminErrorKey', () => {
    it('maps stable ids + falls back to generic', () => {
        expect(mapRoleAdminErrorKey('forbidden')).toBe(ROLE_MGMT_ERROR_KEYS.unauthorized);
        expect(mapRoleAdminErrorKey('duplicate_role')).toBe(ROLE_MGMT_ERROR_KEYS.duplicateRole);
        expect(mapRoleAdminErrorKey('validation_error')).toBe(ROLE_MGMT_ERROR_KEYS.invalid);
        expect(mapRoleAdminErrorKey('role_not_found')).toBe(ROLE_MGMT_ERROR_KEYS.notFound);
        expect(mapRoleAdminErrorKey(undefined)).toBe(ROLE_MGMT_ERROR_KEYS.failed);
    });
});
