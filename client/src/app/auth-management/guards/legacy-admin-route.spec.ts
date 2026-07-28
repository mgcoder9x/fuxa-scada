/**
 * Headless jest verification of the pure SUPERSEDE redirect pipeline (D-052 / task 24.2).
 * The valuable case is the RACE test: the guard must WAIT until settings are loaded before it
 * decides, otherwise a cold direct-URL /users load reads the default-false flag and leaks the
 * legacy page under SUPERSEDE (the N-096-class browser-only defect).
 */

import { BehaviorSubject } from 'rxjs';

import { legacyAdminRedirect$ } from './legacy-admin-route';

describe('legacyAdminRedirect$ (D-052 / task 24.2)', () => {
    const REDIRECT = { url: '/auth/users' };

    it('allows the legacy page (true) when SUPERSEDE is inactive', done => {
        legacyAdminRedirect$(new BehaviorSubject(true), () => false, () => REDIRECT).subscribe(r => {
            expect(r).toBe(true);
            done();
        });
    });

    it('redirects when SUPERSEDE is active', done => {
        legacyAdminRedirect$(new BehaviorSubject(true), () => true, () => REDIRECT).subscribe(r => {
            expect(r).toBe(REDIRECT);
            done();
        });
    });

    it('WAITS until settings are loaded before deciding (no default-false race)', () => {
        const loaded$ = new BehaviorSubject(false);
        let supersede = false; // client default before /api/settings resolves
        const emissions: Array<true | typeof REDIRECT> = [];
        legacyAdminRedirect$(loaded$, () => supersede, () => REDIRECT).subscribe(r => emissions.push(r));
        // settings not loaded yet → the guard must NOT have decided
        expect(emissions).toEqual([]);
        // server settings now arrive AFTER the guard ran, flipping SUPERSEDE on
        supersede = true;
        loaded$.next(true);
        // decided only now, and with the authoritative (post-load) flag → redirect
        expect(emissions).toEqual([REDIRECT]);
    });

    it('emits exactly once and completes (take(1) — no re-decide on later settings churn)', () => {
        const loaded$ = new BehaviorSubject(true);
        const emissions: Array<true | typeof REDIRECT> = [];
        let completed = false;
        legacyAdminRedirect$(loaded$, () => true, () => REDIRECT).subscribe({
            next: r => emissions.push(r),
            complete: () => { completed = true; }
        });
        loaded$.next(true); // a later settings refresh must not re-trigger a navigation
        expect(emissions).toEqual([REDIRECT]);
        expect(completed).toBe(true);
    });
});
