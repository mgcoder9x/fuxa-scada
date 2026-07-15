/**
 * Headless jest specs for the pure `UserFormPresenter` (DV-010 · REQ-12, AC-12.2/12.3/12.4).
 * Direct instantiation with stub seams; no TestBed/DOM.
 */

import { of, throwError, Subject } from 'rxjs';

import {
    UserFormPresenter, USER_FORM_ERROR_KEYS, UserFormSeams, UserFormInitial,
} from './user-form-presenter';
import { USER_MGMT_ERROR_KEYS } from './user-management-presenter';
import type { UserView, AdminError } from '../clients/auth-protocol';

const CREATED: UserView = { username: 'neo', fullname: 'Neo', roles: ['r-op'], metadata: {} };
const EDIT_INITIAL: UserFormInitial = { username: 'joe', fullname: 'Joe Op', roles: ['r-op'], metadata: { start: true } };

function make(mode: 'create' | 'edit', overrides: Partial<UserFormSeams> = {}, initial?: UserFormInitial) {
    const createUser = jest.fn(overrides.createUser ?? (() => of(CREATED)));
    const updateUser = jest.fn(overrides.updateUser ?? ((_u: string) => of(CREATED)));
    const existingUsernames = jest.fn(overrides.existingUsernames ?? (() => ['admin', 'joe']));
    const onSuccess = jest.fn(overrides.onSuccess ?? (() => undefined));
    const presenter = new UserFormPresenter({ createUser, updateUser, existingUsernames, onSuccess }, mode, initial);
    return { presenter, createUser, updateUser, existingUsernames, onSuccess };
}

describe('UserFormPresenter create — validation (AC-12.4)', () => {
    it('requires a non-empty username and password; blocks submit + sends nothing when invalid', () => {
        const { presenter, createUser } = make('create');
        expect(presenter.usernameError()).toBe(USER_FORM_ERROR_KEYS.usernameRequired);
        expect(presenter.passwordError()).toBe(USER_FORM_ERROR_KEYS.passwordRequired);
        expect(presenter.canSubmit()).toBe(false);
        presenter.submit();
        expect(createUser).not.toHaveBeenCalled();
    });

    it('flags a duplicate username against the loaded list (client uniqueness)', () => {
        const { presenter } = make('create');
        presenter.username = 'joe';           // already exists
        presenter.password = 'pw';
        expect(presenter.usernameError()).toBe(USER_FORM_ERROR_KEYS.usernameDuplicate);
        expect(presenter.canSubmit()).toBe(false);
    });

    it('is valid with a fresh username + password', () => {
        const { presenter } = make('create');
        presenter.username = '  neo  ';
        presenter.password = 'secret';
        expect(presenter.usernameError()).toBeNull();
        expect(presenter.passwordError()).toBeNull();
        expect(presenter.canSubmit()).toBe(true);
    });
});

describe('UserFormPresenter create — submit (AC-12.2)', () => {
    it('sends ONE create with trimmed username/fullname + roles + password, then onSuccess', () => {
        const { presenter, createUser, onSuccess } = make('create');
        presenter.username = '  neo  ';
        presenter.fullname = '  Neo  ';
        presenter.password = 'secret';
        presenter.roles = ['r-op'];

        presenter.submit();

        expect(createUser).toHaveBeenCalledTimes(1);
        expect(createUser).toHaveBeenCalledWith({ username: 'neo', fullname: 'Neo', password: 'secret', roles: ['r-op'] });
        expect(onSuccess).toHaveBeenCalledWith(CREATED);
        expect(presenter.pending).toBe(false);
    });

    it('maps a duplicate_username server error to a key and keeps the form (no onSuccess)', () => {
        const err: AdminError = { errorId: 'duplicate_username', status: 400 };
        const { presenter, onSuccess } = make('create', { createUser: () => throwError(() => err) });
        presenter.username = 'neo';
        presenter.password = 'pw';

        presenter.submit();

        expect(presenter.errorKey).toBe(USER_MGMT_ERROR_KEYS.duplicateUsername);
        expect(onSuccess).not.toHaveBeenCalled();
        expect(presenter.pending).toBe(false);
    });

    it('does not dispatch a second request while one is pending', () => {
        const gate = new Subject<UserView>();
        const { presenter, createUser } = make('create', { createUser: () => gate.asObservable() });
        presenter.username = 'neo';
        presenter.password = 'pw';
        presenter.submit();
        presenter.submit();
        expect(createUser).toHaveBeenCalledTimes(1);
        expect(presenter.pending).toBe(true);
    });
});

describe('UserFormPresenter edit (AC-12.3)', () => {
    it('opens with the initial values, username immutable, password blank', () => {
        const { presenter } = make('edit', {}, EDIT_INITIAL);
        expect(presenter.username).toBe('joe');
        expect(presenter.fullname).toBe('Joe Op');
        expect(presenter.roles).toEqual(['r-op']);
        expect(presenter.password).toBe('');
        expect(presenter.usernameError()).toBeNull();   // immutable → never a field error
        expect(presenter.passwordError()).toBeNull();    // optional on edit
        expect(presenter.canSubmit()).toBe(true);         // no required fields on edit
    });

    it('OMITS password when left empty (server retains the hash, AC-7.3) + preserves metadata', () => {
        const { presenter, updateUser } = make('edit', {}, EDIT_INITIAL);
        presenter.fullname = 'Joe Operator';
        presenter.roles = ['r-op', 'r-admin'];

        presenter.submit();

        expect(updateUser).toHaveBeenCalledTimes(1);
        expect(updateUser).toHaveBeenCalledWith('joe', {
            fullname: 'Joe Operator',
            roles: ['r-op', 'r-admin'],
            metadata: { start: true },
        });
        // no `password` key in the patch
        expect(Object.prototype.hasOwnProperty.call(updateUser.mock.calls[0][1], 'password')).toBe(false);
    });

    it('INCLUDES password when the admin typed one (server re-hashes, AC-7.2)', () => {
        const { presenter, updateUser } = make('edit', {}, EDIT_INITIAL);
        presenter.password = 'newpw';

        presenter.submit();

        expect(updateUser.mock.calls[0][1].password).toBe('newpw');
    });

    it('maps user_not_found and keeps the form', () => {
        const err: AdminError = { errorId: 'user_not_found', status: 404 };
        const { presenter, onSuccess } = make('edit', { updateUser: () => throwError(() => err) }, EDIT_INITIAL);
        presenter.submit();
        expect(presenter.errorKey).toBe(USER_MGMT_ERROR_KEYS.notFound);
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('throws if constructed in edit mode without an initial user', () => {
        expect(() => make('edit')).toThrow();
    });
});
