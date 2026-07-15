/**
 * Unit tests for the pure auth-management client protocol (Task 15.4, headless jest/ts-jest — no
 * TestBed/browser). Verifies success mapping + stable error-id normalization against the server
 * contracts (§07 §2.3, §04 §8.2, §05 §8.1).
 */

import {
    mapSignInSuccess, normalizeSignInError,
    mapUserView, mapUsersResponse, mapUserResponse, mapRolesResponse, normalizeAdminError,
} from './auth-protocol';

describe('auth-protocol — sign-in (design/07 §2.3, D-007)', () => {
    it('mapSignInSuccess maps the envelope { data:{…} } to first-class roles (no groups/info)', () => {
        const r = mapSignInSuccess({ status: 'success', data: { token: 'T', username: 'admin', fullname: 'Admin', roles: ['r1', 'r2'] } });
        expect(r).toEqual({ token: 'T', username: 'admin', fullname: 'Admin', roles: ['r1', 'r2'] });
    });

    it('mapSignInSuccess accepts the inner data object directly and defends against missing fields', () => {
        expect(mapSignInSuccess({ token: 'T', username: 'u' })).toEqual({ token: 'T', username: 'u', fullname: '', roles: [] });
        expect(mapSignInSuccess(null)).toEqual({ token: '', username: '', fullname: '', roles: [] });
        expect(mapSignInSuccess({ data: { roles: 'notarray' } }).roles).toEqual([]);
    });

    it('normalizeSignInError maps known ids and folds unknowns to unexpected_error', () => {
        expect(normalizeSignInError(401, { status: 'error', error: 'invalid_credentials' })).toEqual({ errorId: 'invalid_credentials', status: 401 });
        expect(normalizeSignInError(400, { error: 'missing_field', field: 'password' })).toEqual({ errorId: 'missing_field', status: 400 });
        expect(normalizeSignInError(404, { error: 'user_not_found' }).errorId).toBe('user_not_found');
        expect(normalizeSignInError(500, { error: 'something_weird' }).errorId).toBe('unexpected_error');
        expect(normalizeSignInError(0, null).errorId).toBe('unexpected_error');
    });

    it('normalizeSignInError carries retryAfterMs for 429 too_many_attempts', () => {
        const e = normalizeSignInError(429, { error: 'too_many_attempts', retryAfterMs: 5000 });
        expect(e).toEqual({ errorId: 'too_many_attempts', status: 429, retryAfterMs: 5000 });
    });

    it('DV-006: unknown-user and bad-password both surface as invalid_credentials (identical client id)', () => {
        // The server returns the SAME body for both (DV-006), so the client normalizes both identically.
        const a = normalizeSignInError(401, { status: 'error', error: 'invalid_credentials' });
        const b = normalizeSignInError(401, { status: 'error', error: 'invalid_credentials' });
        expect(a).toEqual(b);
        expect(a.errorId).toBe('invalid_credentials');
    });
});

describe('auth-protocol — users (design/04 §8.2)', () => {
    it('mapUserView is hash-free and defensive', () => {
        const v = mapUserView({ username: 'u', fullname: 'U', roles: ['a'], metadata: { x: 1 }, passwordHash: 'LEAK' });
        expect(v).toEqual({ username: 'u', fullname: 'U', roles: ['a'], metadata: { x: 1 } });
        expect((v as any).passwordHash).toBeUndefined();
        expect(mapUserView(null)).toEqual({ username: '', fullname: '', roles: [], metadata: {} });
    });

    it('mapUsersResponse maps a list; mapUserResponse returns null for an empty single result (AC-6.4)', () => {
        const list = mapUsersResponse({ status: 'success', data: [{ username: 'a', roles: [] }, { username: 'b', roles: ['r'] }] });
        expect(list.map(u => u.username)).toEqual(['a', 'b']);
        expect(mapUsersResponse({ status: 'success' })).toEqual([]);
        expect(mapUserResponse({ status: 'success', data: null })).toBeNull();
        expect(mapUserResponse({ status: 'success', data: { username: 'a', roles: [] } })!.username).toBe('a');
    });
});

describe('auth-protocol — roles (design/05 §8.1)', () => {
    it('mapRolesResponse maps { data: Role[] } to RoleOption[]', () => {
        const roles = mapRolesResponse({ status: 'success', data: [{ id: 'admin', name: 'Admin', permissions: ['user.read'] }] });
        expect(roles).toEqual([{ id: 'admin', name: 'Admin', permissions: ['user.read'] }]);
        expect(mapRolesResponse({})).toEqual([]);
    });
});

describe('auth-protocol — admin errors (§04 §8.2 / §05 §8.1)', () => {
    it('normalizeAdminError maps every known id and falls back to unexpected_error', () => {
        for (const id of ['duplicate_username', 'validation_error', 'user_not_found', 'last_admin', 'duplicate_role', 'role_not_found', 'forbidden', 'unauthorized_error', 'missing_field']) {
            expect(normalizeAdminError(400, { error: id }).errorId).toBe(id);
        }
        expect(normalizeAdminError(418, { error: 'teapot' }).errorId).toBe('unexpected_error');
        expect(normalizeAdminError(500, undefined).errorId).toBe('unexpected_error');
    });

    it('normalizeAdminError carries the field for missing_field', () => {
        expect(normalizeAdminError(400, { error: 'missing_field', field: 'username' })).toEqual({ errorId: 'missing_field', status: 400, field: 'username' });
    });
});
