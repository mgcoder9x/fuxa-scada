/**
 * Headless jest specs for the pure `UserManagementPresenter` (DV-010 · REQ-12, AC-12.1/AC-12.6).
 *
 * The presenter is framework-free, exercised by DIRECT instantiation with plain stub seams
 * (`canReadUsers` boolean fn; `listUsers`/`listRoles` return rxjs `of(...)`/`throwError(...)`), no
 * TestBed/DOM. Template-presence (AC-12.1 columns rendered) is markup-only and is covered by
 * `ng build` + inspection (DV-010), not here.
 */

import { of, throwError, Subject } from 'rxjs';

import {
    UserManagementPresenter, USER_MGMT_ERROR_KEYS, mapAdminErrorKey, UserManagementSeams,
} from './user-management-presenter';
import type { UserView, RoleOption, AdminError } from '../clients/auth-protocol';

const ROLES: RoleOption[] = [
    { id: 'r-admin', name: 'Administrator', permissions: ['user.read', 'user.create'] },
    { id: 'r-op', name: 'Operator', permissions: ['view.read'] },
];
const USERS: UserView[] = [
    { username: 'admin', fullname: 'Admin User', roles: ['r-admin'], metadata: {} },
    { username: 'joe', fullname: 'Joe Op', roles: ['r-op', 'r-ghost'], metadata: {} },
];

function make(overrides: Partial<UserManagementSeams> = {}) {
    const canReadUsers = jest.fn(overrides.canReadUsers ?? (() => true));
    const listUsers = jest.fn(overrides.listUsers ?? (() => of(USERS)));
    const listRoles = jest.fn(overrides.listRoles ?? (() => of(ROLES)));
    const deleteUser = jest.fn(overrides.deleteUser ?? (() => of(undefined as void)));
    const presenter = new UserManagementPresenter({
        canReadUsers, listUsers, listRoles, deleteUser, onRolesLoaded: overrides.onRolesLoaded,
    });
    return { presenter, canReadUsers, listUsers, listRoles, deleteUser };
}

describe('UserManagementPresenter access gate (AC-12.6)', () => {
    it('denies + issues NO request when the identity lacks user.read (client UX gate)', () => {
        const { presenter, listUsers, listRoles } = make({ canReadUsers: () => false });
        presenter.init();
        expect(presenter.access).toBe('denied');
        expect(presenter.errorKey).toBe(USER_MGMT_ERROR_KEYS.unauthorized);
        expect(listUsers).not.toHaveBeenCalled();     // no data request for a non-admin
        expect(listRoles).not.toHaveBeenCalled();
    });

    it('grants + loads list and roles when user.read is present', () => {
        const { presenter, listUsers, listRoles } = make();
        presenter.init();
        expect(presenter.access).toBe('granted');
        expect(listUsers).toHaveBeenCalledTimes(1);
        expect(listRoles).toHaveBeenCalledTimes(1);
        expect(presenter.users).toEqual(USERS);
        expect(presenter.roles).toEqual(ROLES);
        expect(presenter.loading).toBe(false);
        expect(presenter.errorKey).toBeNull();
    });

    it('flips to denied on a server 403 for the list (defense-in-depth, server path)', () => {
        const err: AdminError = { errorId: 'forbidden', status: 403 };
        const { presenter } = make({ listUsers: () => throwError(() => err) });
        presenter.init();
        expect(presenter.access).toBe('denied');
        expect(presenter.errorKey).toBe(USER_MGMT_ERROR_KEYS.unauthorized);
        expect(presenter.loading).toBe(false);
    });

    it('flips to denied on a server 401 for the list', () => {
        const err: AdminError = { errorId: 'unauthorized_error', status: 401 };
        const { presenter } = make({ listUsers: () => throwError(() => err) });
        presenter.init();
        expect(presenter.access).toBe('denied');
    });
});

describe('UserManagementPresenter list + role resolution (AC-12.1)', () => {
    /**
     * D-050 (deliberate behavior change, NOT a weakened assertion): an unresolved role id is now shown
     * RAW instead of being omitted. Reason — a user holding `user.read` but not `role.read` cannot load
     * the role catalogue at all, so omission made EVERY row's roles render blank on the live instance,
     * i.e. the page silently under-reported a user's authority. A raw id is truthful and still resolves
     * to the friendly name for anyone who can read roles.
     */
    it('resolves role ids to names, showing an unresolved id RAW (D-050, was: omitted)', () => {
        const { presenter } = make();
        presenter.init();
        expect(presenter.roleNames(USERS[0])).toEqual(['Administrator']);
        // joe has r-op (Operator) + r-ghost (unknown → shown raw so authority is never hidden)
        expect(presenter.roleNames(USERS[1])).toEqual(['Operator', 'r-ghost']);
        expect(presenter.roleLabel(USERS[1])).toBe('Operator, r-ghost');
    });

    it('roleNames is defensive for a user with no/invalid roles', () => {
        const { presenter } = make();
        presenter.init();
        expect(presenter.roleNames({ username: 'x', fullname: '', roles: [], metadata: {} })).toEqual([]);
        expect(presenter.roleNames({} as UserView)).toEqual([]);
    });

    it('calls onRolesLoaded with the loaded roles (populates the RBAC permission resolver)', () => {
        const onRolesLoaded = jest.fn();
        const { presenter } = make({ onRolesLoaded });
        presenter.init();
        expect(onRolesLoaded).toHaveBeenCalledTimes(1);
        expect(onRolesLoaded).toHaveBeenCalledWith(ROLES);
    });

    it('still loads the list when the role fetch fails, and shows role IDS raw (D-050)', () => {
        const { presenter } = make({ listRoles: () => throwError(() => ({ errorId: 'unexpected_error', status: 500 })) });
        presenter.init();
        expect(presenter.access).toBe('granted');
        expect(presenter.users).toEqual(USERS);
        expect(presenter.roles).toEqual([]);
        // No role catalogue ⇒ ids cannot be resolved to names, but they MUST still be visible:
        // this is exactly the live case of a `user.read`-only identity (403 on /api/roles).
        expect(presenter.roleNames(USERS[0])).toEqual([...USERS[0].roles]);
        expect(presenter.roleNames(USERS[1])).toEqual([...USERS[1].roles]);
    });
});

describe('UserManagementPresenter loading + refresh (AC-12.1)', () => {
    it('sets loading true while the list is in flight and false when it settles', () => {
        const gate = new Subject<UserView[]>();
        const { presenter } = make({ listUsers: () => gate.asObservable() });
        presenter.init();
        expect(presenter.loading).toBe(true);
        gate.next(USERS);
        gate.complete();
        expect(presenter.loading).toBe(false);
        expect(presenter.users).toEqual(USERS);
    });

    it('refresh() re-fetches the user list', () => {
        const { presenter, listUsers } = make();
        presenter.init();                 // 1st call
        presenter.refresh();              // 2nd call
        expect(listUsers).toHaveBeenCalledTimes(2);
    });

    it('maps a non-access list error to a generic key and stays granted', () => {
        const err: AdminError = { errorId: 'unexpected_error', status: 500 };
        const { presenter } = make({ listUsers: () => throwError(() => err) });
        presenter.init();
        expect(presenter.access).toBe('granted');       // not an auth error → stays granted
        expect(presenter.errorKey).toBe(USER_MGMT_ERROR_KEYS.failed);
        expect(presenter.loading).toBe(false);
    });
});

describe('UserManagementPresenter delete flow (AC-12.5 · design/08 §5)', () => {
    it('removes exactly the deleted row from the list on success', () => {
        const { presenter, deleteUser } = make();
        presenter.init();
        expect(presenter.users.length).toBe(2);
        presenter.deleteUser('joe');
        expect(deleteUser).toHaveBeenCalledWith('joe');
        expect(presenter.users.map((u) => u.username)).toEqual(['admin']);   // only 'joe' removed
        expect(presenter.deletePending).toBe(false);
    });

    it('KEEPS the row and shows the last-admin message on last_admin (D-009)', () => {
        const err: AdminError = { errorId: 'last_admin', status: 400 };
        const { presenter } = make({ deleteUser: () => throwError(() => err) });
        presenter.init();
        presenter.deleteUser('admin');
        expect(presenter.errorKey).toBe(USER_MGMT_ERROR_KEYS.lastAdmin);
        expect(presenter.users.map((u) => u.username)).toEqual(['admin', 'joe']);   // nothing removed
        expect(presenter.deletePending).toBe(false);
    });

    it('shows not-found + refreshes on user_not_found', () => {
        const err: AdminError = { errorId: 'user_not_found', status: 404 };
        const { presenter, listUsers } = make({ deleteUser: () => throwError(() => err) });
        presenter.init();                       // listUsers call #1
        presenter.deleteUser('joe');
        expect(presenter.errorKey).toBe(USER_MGMT_ERROR_KEYS.notFound);
        expect(listUsers).toHaveBeenCalledTimes(2);   // refresh() re-fetched
    });

    it('flips to denied on a 403 during delete', () => {
        const err: AdminError = { errorId: 'forbidden', status: 403 };
        const { presenter } = make({ deleteUser: () => throwError(() => err) });
        presenter.init();
        presenter.deleteUser('joe');
        expect(presenter.access).toBe('denied');
        expect(presenter.errorKey).toBe(USER_MGMT_ERROR_KEYS.unauthorized);
    });

    it('ignores a second delete while one is in flight', () => {
        const gate = new Subject<void>();
        const { presenter, deleteUser } = make({ deleteUser: () => gate.asObservable() });
        presenter.init();
        presenter.deleteUser('joe');
        presenter.deleteUser('joe');
        expect(deleteUser).toHaveBeenCalledTimes(1);
        expect(presenter.deletePending).toBe(true);
    });
});

describe('mapAdminErrorKey (shared by 17.2/17.3)', () => {
    it('maps each stable admin error id to its generic key', () => {
        expect(mapAdminErrorKey('duplicate_username')).toBe(USER_MGMT_ERROR_KEYS.duplicateUsername);
        expect(mapAdminErrorKey('validation_error')).toBe(USER_MGMT_ERROR_KEYS.invalid);
        expect(mapAdminErrorKey('missing_field')).toBe(USER_MGMT_ERROR_KEYS.invalid);
        expect(mapAdminErrorKey('user_not_found')).toBe(USER_MGMT_ERROR_KEYS.notFound);
        expect(mapAdminErrorKey('last_admin')).toBe(USER_MGMT_ERROR_KEYS.lastAdmin);
        expect(mapAdminErrorKey('forbidden')).toBe(USER_MGMT_ERROR_KEYS.unauthorized);
        expect(mapAdminErrorKey('unauthorized_error')).toBe(USER_MGMT_ERROR_KEYS.unauthorized);
        expect(mapAdminErrorKey(undefined)).toBe(USER_MGMT_ERROR_KEYS.failed);
        expect(mapAdminErrorKey('something_else')).toBe(USER_MGMT_ERROR_KEYS.failed);
    });
});
