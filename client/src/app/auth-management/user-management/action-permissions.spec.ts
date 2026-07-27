/**
 * D-051 client specs — the two remaining N-091 defects:
 *   L2: a rejected password must produce a SPECIFIC translated key (+ interpolation params), not the
 *       generic "Invalid input", while still never rendering server-authored text (§9).
 *   L5: action controls must be offered only when the identity holds the matching permission, so the
 *       UI stops advertising operations the server will refuse.
 *
 * Framework-free (DV-010): presenters/mappers are instantiated directly, no TestBed/DOM.
 */

import { of, throwError } from 'rxjs';
import { UserManagementPresenter, mapAdminErrorDetailKey, DETAIL_CODE_KEYS, USER_MGMT_ERROR_KEYS } from './user-management-presenter';
import { UserFormPresenter } from './user-form-presenter';
import { RoleManagementPresenter } from '../role-management/role-management-presenter';
import { normalizeAdminError } from '../clients/auth-protocol';
import type { AdminError } from '../clients/auth-protocol';

// ---------------------------------------------------------------------------
// L2 — specific, translatable rejection reason
// ---------------------------------------------------------------------------

describe('D-051 L2: the server detailCode selects a SPECIFIC i18n key', () => {
    it('normalizeAdminError carries detailCode + detailParams from the 400 body', () => {
        const err = normalizeAdminError(400, {
            error: 'validation_error',
            message: 'password shorter than the 12-character minimum',
            detailCode: 'password_too_short',
            detailParams: { min: 12 },
        });
        expect(err.errorId).toBe('validation_error');
        expect(err.detailCode).toBe('password_too_short');
        expect(err.detailParams).toEqual({ min: 12 });
    });

    it('ignores a malformed detailParams and a blank detailCode (defensive)', () => {
        expect(normalizeAdminError(400, { error: 'validation_error', detailCode: '' }).detailCode).toBeUndefined();
        const e = normalizeAdminError(400, { error: 'validation_error', detailCode: 'password_too_short', detailParams: 'nope' });
        expect(e.detailCode).toBe('password_too_short');
        expect(e.detailParams).toBeUndefined();
    });

    it('maps each known code to its specific key, and falls back generically for unknown codes', () => {
        expect(mapAdminErrorDetailKey({ errorId: 'validation_error', status: 400, detailCode: 'password_too_short' }))
            .toBe(DETAIL_CODE_KEYS['password_too_short']);
        expect(mapAdminErrorDetailKey({ errorId: 'validation_error', status: 400, detailCode: 'password_blocklisted' }))
            .toBe(DETAIL_CODE_KEYS['password_blocklisted']);
        // an unrecognized future code must NOT break the UI
        expect(mapAdminErrorDetailKey({ errorId: 'validation_error', status: 400, detailCode: 'password_from_the_future' }))
            .toBe(USER_MGMT_ERROR_KEYS.invalid);
        // no code at all → generic mapping by errorId
        expect(mapAdminErrorDetailKey({ errorId: 'duplicate_username', status: 400 }))
            .toBe(USER_MGMT_ERROR_KEYS.duplicateUsername);
        expect(mapAdminErrorDetailKey(undefined)).toBe(USER_MGMT_ERROR_KEYS.failed);
    });

    it('the create form surfaces the specific key AND the params (so the real minimum is shown)', () => {
        const err: AdminError = { errorId: 'validation_error', status: 400, detailCode: 'password_too_short', detailParams: { min: 20 } };
        const presenter = new UserFormPresenter({
            existingUsernames: () => [],
            createUser: () => throwError(() => err),
            updateUser: () => throwError(() => err),
            onSaved: () => { /* not reached */ },
        } as any, 'create');
        presenter.username = 'newbie';
        presenter.password = 'short1';
        presenter.submit();
        expect(presenter.errorKey).toBe(DETAIL_CODE_KEYS['password_too_short']);
        expect(presenter.errorParams).toEqual({ min: 20 });
        expect(presenter.pending).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// L5 — honest action affordances
// ---------------------------------------------------------------------------

describe('D-051 L5: action controls follow the identity effective permissions', () => {
    const userSeams = (can?: (p: string) => boolean) => ({
        canReadUsers: () => true,
        can,
        listUsers: () => of([]),
        listRoles: () => of([]),
        deleteUser: () => of(undefined as void),
    });

    it('a read-only identity is offered NO create/edit/delete action', () => {
        const p = new UserManagementPresenter(userSeams((perm) => perm === 'user.read'));
        expect(p.canCreateUsers).toBe(false);
        expect(p.canUpdateUsers).toBe(false);
        expect(p.canDeleteUsers).toBe(false);
    });

    it('a full user-admin identity is offered every action', () => {
        const p = new UserManagementPresenter(userSeams(() => true));
        expect(p.canCreateUsers).toBe(true);
        expect(p.canUpdateUsers).toBe(true);
        expect(p.canDeleteUsers).toBe(true);
    });

    it('without the optional seam everything is offered (server remains the boundary)', () => {
        const p = new UserManagementPresenter(userSeams(undefined));
        expect(p.canCreateUsers).toBe(true);
        expect(p.canDeleteUsers).toBe(true);
    });

    it('a non-boolean seam result is treated as NOT allowed (fail-safe affordance)', () => {
        const p = new UserManagementPresenter(userSeams((() => 'yes') as any));
        expect(p.canCreateUsers).toBe(false);
    });

    it('the role page gates its own three actions the same way', () => {
        const seams = (can?: (p: string) => boolean) => ({
            canReadRoles: () => true,
            can,
            listRoles: () => of([]),
            createRole: () => of({ id: 'x', name: 'x', permissions: [] } as any),
            updateRole: () => of({ id: 'x', name: 'x', permissions: [] } as any),
            deleteRole: () => of({ removed: [], prunedUsers: [] } as any),
        });
        const readOnly = new RoleManagementPresenter(seams((perm) => perm === 'role.read'));
        expect([readOnly.canCreateRoles, readOnly.canUpdateRoles, readOnly.canDeleteRoles]).toEqual([false, false, false]);
        const admin = new RoleManagementPresenter(seams(() => true));
        expect([admin.canCreateRoles, admin.canUpdateRoles, admin.canDeleteRoles]).toEqual([true, true, true]);
    });
});
