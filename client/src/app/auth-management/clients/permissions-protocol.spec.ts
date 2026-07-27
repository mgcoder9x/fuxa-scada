/**
 * D-050 client-side specs: the pure `mapPermissionsResponse` mapper + the role editor's
 * server-owned permission catalog. Framework-free (DV-010/D-036): direct instantiation, no TestBed.
 *
 * Each case pins a defect observed LIVE in N-091:
 *   - L3: the editor must offer the SERVER vocabulary (incl. D-049 `settings.*`), not a hand-copied list.
 *   - robustness: a partial/garbage payload must degrade, never throw, or the gate would crash the page.
 */

import { mapPermissionsResponse } from './auth-protocol';
import { RoleManagementPresenter, KNOWN_PERMISSIONS } from '../role-management/role-management-presenter';
import { of } from 'rxjs';

describe('mapPermissionsResponse (D-050 pure mapper)', () => {
    it('maps the full envelope', () => {
        const r = mapPermissionsResponse({
            status: 'success',
            data: { username: 'operator1', effective: ['user.read'], catalog: ['user.read', 'settings.manage'], mustRotate: false },
        });
        expect(r).toEqual({ username: 'operator1', effective: ['user.read'], catalog: ['user.read', 'settings.manage'], mustRotate: false });
    });

    it('accepts the inner data object directly', () => {
        const r = mapPermissionsResponse({ username: 'admin', effective: ['user.read'], catalog: [], mustRotate: false });
        expect(r.username).toBe('admin');
        expect(r.effective).toEqual(['user.read']);
    });

    it('carries mustRotate=true (gated identity ⇒ empty authority by server contract)', () => {
        const r = mapPermissionsResponse({ data: { username: 'admin', effective: [], catalog: ['user.read'], mustRotate: true } });
        expect(r.mustRotate).toBe(true);
        expect(r.effective).toEqual([]);
    });

    it('degrades a malformed/partial payload instead of throwing', () => {
        expect(mapPermissionsResponse(null)).toEqual({ username: '', effective: [], catalog: [], mustRotate: false });
        expect(mapPermissionsResponse({ data: { effective: 'nope', catalog: 42, mustRotate: 'yes' } }))
            .toEqual({ username: '', effective: [], catalog: [], mustRotate: false });
        expect(mapPermissionsResponse({ data: { effective: ['a', 7, null, 'b'] } }).effective).toEqual(['a', 'b']);
    });
});

describe('RoleManagementPresenter.availablePermissions (D-050 server catalog, fixes N-091 L3)', () => {
    const seams = (overrides: any = {}) => ({
        canReadRoles: () => true,
        listRoles: () => of([]),
        createRole: () => of({ id: 'x', name: 'x', permissions: [] } as any),
        updateRole: () => of({ id: 'x', name: 'x', permissions: [] } as any),
        deleteRole: () => of({ removed: [], prunedUsers: [] } as any),
        ...overrides,
    });

    it('uses the SERVER catalog when provided (a server-only permission becomes grantable)', () => {
        const p = new RoleManagementPresenter(seams({
            permissionCatalog: () => ['user.read', 'settings.read', 'settings.manage', 'brand.new'],
        }));
        expect(p.availablePermissions()).toEqual(['brand.new', 'settings.manage', 'settings.read', 'user.read']);
    });

    it('falls back to the local list when the server catalog is empty/absent', () => {
        const empty = new RoleManagementPresenter(seams({ permissionCatalog: () => [] }));
        expect(empty.availablePermissions()).toEqual([...KNOWN_PERMISSIONS].sort());
        const absent = new RoleManagementPresenter(seams());
        expect(absent.availablePermissions()).toEqual([...KNOWN_PERMISSIONS].sort());
    });

    it('the local fallback itself now includes the D-049 settings permissions (no silent gap)', () => {
        expect(KNOWN_PERMISSIONS).toContain('settings.read');
        expect(KNOWN_PERMISSIONS).toContain('settings.manage');
    });

    it('unions permissions already stored on loaded roles, so a custom perm is never hidden', () => {
        const p = new RoleManagementPresenter(seams({ permissionCatalog: () => ['user.read'] }));
        p.roles = [{ id: 'r', name: 'R', permissions: ['legacy.perm', 'user.read'] } as any];
        expect(p.availablePermissions()).toEqual(['legacy.perm', 'user.read']);
    });
});
