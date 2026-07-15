/**
 * Wiring tests for the thin Angular client shells (Task 15.4, headless jest/ts-jest — no TestBed,
 * no browser, D-036). The shells are instantiated DIRECTLY with a stub `HttpClient` (a plain object
 * exposing get/post/put/delete that returns rxjs observables), which is sufficient because the
 * shells only call those four methods and delegate all mapping/normalization to the already-tested
 * pure `auth-protocol` core. These tests assert the WIRING the pure tests cannot: the exact
 * URL/method, the `Skip-Error` opt-out header, success-mapping delegation, and that every HTTP error
 * is surfaced as a normalized stable error object (never the raw HttpErrorResponse).
 *
 * Running these specs also forces ts-jest to compile the shells under `strict:true`
 * (jest.config.js), giving strict type coverage of the module client code that the app's non-strict
 * build does not.
 */

import { of, throwError, firstValueFrom } from 'rxjs';

import { AuthSignInClient } from './auth-signin.client';
import { UserAdminClient } from './user-admin.client';
import { RoleAdminClient } from './role-admin.client';

// The shells resolve their base URL from EndPointApi.getURL() at construction. In the node test
// env there is no `location`/`environment.apiEndpoint`, so getURL() would throw; we stub the two
// statics the shells touch. (EndPointApi itself is FUXA core and not under test here.)
import { EndPointApi } from '../../_helpers/endpointapi';

const BASE = 'http://test.local';
beforeAll(() => {
    (EndPointApi as unknown as { getURL: () => string }).getURL = () => BASE;
});

/** Build a stub HttpClient whose method records the call and returns the given observable. */
function stubHttp(method: 'get' | 'post' | 'put' | 'delete', impl: (...args: any[]) => any) {
    const calls: any[][] = [];
    const http: any = {
        get: () => of(null), post: () => of(null), put: () => of(null), delete: () => of(null),
    };
    http[method] = (...args: any[]) => { calls.push(args); return impl(...args); };
    return { http, calls };
}

/** Assert a captured request carried the `Skip-Error` opt-out header. */
function hasSkipError(optionsArg: any): boolean {
    const headers = optionsArg && optionsArg.headers;
    return !!headers && typeof headers.has === 'function' && headers.has('Skip-Error');
}

describe('AuthSignInClient (design/07 §2.3)', () => {
    it('POSTs /api/signin with Skip-Error and maps the success envelope', async () => {
        const { http, calls } = stubHttp('post', () =>
            of({ status: 'success', data: { token: 'T', username: 'admin', fullname: 'Admin', roles: ['r1'] } }));
        const client = new AuthSignInClient(http);
        const result = await firstValueFrom(client.signIn('admin', 'pw'));

        expect(result).toEqual({ token: 'T', username: 'admin', fullname: 'Admin', roles: ['r1'] });
        const [url, body, options] = calls[0];
        expect(url).toBe(`${BASE}/api/signin`);
        expect(body).toEqual({ username: 'admin', password: 'pw' });
        expect(hasSkipError(options)).toBe(true);
    });

    it('normalizes a 401 to a stable SignInError (invalid_credentials), not the raw response', async () => {
        const { http } = stubHttp('post', () =>
            throwError(() => ({ status: 401, error: { status: 'error', error: 'invalid_credentials' } })));
        const client = new AuthSignInClient(http);
        await expect(firstValueFrom(client.signIn('x', 'y'))).rejects.toEqual({ errorId: 'invalid_credentials', status: 401 });
    });

    it('carries retryAfterMs for a 429 too_many_attempts', async () => {
        const { http } = stubHttp('post', () =>
            throwError(() => ({ status: 429, error: { error: 'too_many_attempts', retryAfterMs: 5000 } })));
        const client = new AuthSignInClient(http);
        await expect(firstValueFrom(client.signIn('x', 'y')))
            .rejects.toEqual({ errorId: 'too_many_attempts', status: 429, retryAfterMs: 5000 });
    });
});

describe('UserAdminClient (design/04 §8.2)', () => {
    it('GET /api/users maps to a hash-free UserView[]', async () => {
        const { http, calls } = stubHttp('get', () =>
            of({ status: 'success', data: [{ username: 'a', roles: [], passwordHash: 'LEAK' }] }));
        const client = new UserAdminClient(http);
        const list = await firstValueFrom(client.list());

        expect(list).toEqual([{ username: 'a', fullname: '', roles: [], metadata: {} }]);
        expect((list[0] as any).passwordHash).toBeUndefined();
        expect(calls[0][0]).toBe(`${BASE}/api/users`);
        expect(hasSkipError(calls[0][1])).toBe(true);
    });

    it('GET /api/users/:username returns null for an empty result and encodes the name', async () => {
        const { http, calls } = stubHttp('get', () => of({ status: 'success', data: null }));
        const client = new UserAdminClient(http);
        const one = await firstValueFrom(client.get('a b'));

        expect(one).toBeNull();
        expect(calls[0][0]).toBe(`${BASE}/api/users/a%20b`);
    });

    it('POST /api/users maps created data; PUT maps updated data', async () => {
        const post = stubHttp('post', () => of({ status: 'success', data: { username: 'n', fullname: 'N', roles: ['r'] } }));
        const created = await firstValueFrom(new UserAdminClient(post.http).create({ username: 'n', password: 'p' }));
        expect(created).toEqual({ username: 'n', fullname: 'N', roles: ['r'], metadata: {} });
        expect(post.calls[0][0]).toBe(`${BASE}/api/users`);

        const put = stubHttp('put', () => of({ status: 'success', data: { username: 'n', fullname: 'N2', roles: [] } }));
        const updated = await firstValueFrom(new UserAdminClient(put.http).update('n', { fullname: 'N2' }));
        expect(updated.fullname).toBe('N2');
        expect(put.calls[0][0]).toBe(`${BASE}/api/users/n`);
    });

    it('DELETE resolves void on success and normalizes last_admin (400) to a stable AdminError', async () => {
        const ok = stubHttp('delete', () => of({ status: 'success' }));
        await expect(firstValueFrom(new UserAdminClient(ok.http).delete('n'))).resolves.toBeUndefined();

        const bad = stubHttp('delete', () => throwError(() => ({ status: 400, error: { error: 'last_admin' } })));
        await expect(firstValueFrom(new UserAdminClient(bad.http).delete('admin')))
            .rejects.toEqual({ errorId: 'last_admin', status: 400 });
    });

    it('normalizes 403 forbidden (not a global sign-out) to a stable AdminError', async () => {
        const { http } = stubHttp('get', () => throwError(() => ({ status: 403, error: { error: 'forbidden' } })));
        await expect(firstValueFrom(new UserAdminClient(http).list()))
            .rejects.toEqual({ errorId: 'forbidden', status: 403 });
    });
});

describe('RoleAdminClient (design/05 §8.1)', () => {
    it('GET /api/roles maps to RoleOption[]', async () => {
        const { http, calls } = stubHttp('get', () =>
            of({ status: 'success', data: [{ id: 'admin', name: 'Admin', permissions: ['user.read'] }] }));
        const roles = await firstValueFrom(new RoleAdminClient(http).list());
        expect(roles).toEqual([{ id: 'admin', name: 'Admin', permissions: ['user.read'] }]);
        expect(calls[0][0]).toBe(`${BASE}/api/roles`);
    });

    it('POST /api/roles maps the single created role', async () => {
        const { http, calls } = stubHttp('post', () =>
            of({ status: 'success', data: { id: 'op', name: 'Operator', permissions: ['user.read'] } }));
        const role = await firstValueFrom(new RoleAdminClient(http).create({ id: 'op', name: 'Operator', permissions: ['user.read'] }));
        expect(role).toEqual({ id: 'op', name: 'Operator', permissions: ['user.read'] });
        expect(calls[0][1]).toEqual({ id: 'op', name: 'Operator', permissions: ['user.read'] });
    });

    it('PUT /api/roles/:id sends { permissions } and maps the replaced role', async () => {
        const { http, calls } = stubHttp('put', () =>
            of({ status: 'success', data: { id: 'op', name: 'Operator', permissions: ['user.read', 'user.update'] } }));
        const role = await firstValueFrom(new RoleAdminClient(http).update('op', ['user.read', 'user.update']));
        expect(role.permissions).toEqual(['user.read', 'user.update']);
        expect(calls[0][0]).toBe(`${BASE}/api/roles/op`);
        expect(calls[0][1]).toEqual({ permissions: ['user.read', 'user.update'] });
    });

    it('DELETE /api/roles/:id returns { removed, prunedUsers }; duplicate_role (400) normalizes', async () => {
        const del = stubHttp('delete', () => of({ status: 'success', data: { removed: ['op'], prunedUsers: ['u1'] } }));
        await expect(firstValueFrom(new RoleAdminClient(del.http).delete('op')))
            .resolves.toEqual({ removed: ['op'], prunedUsers: ['u1'] });

        const dup = stubHttp('post', () => throwError(() => ({ status: 400, error: { error: 'duplicate_role' } })));
        await expect(firstValueFrom(new RoleAdminClient(dup.http).create({ id: 'op' })))
            .rejects.toEqual({ errorId: 'duplicate_role', status: 400 });
    });
});
