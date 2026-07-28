import { Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';

/**
 * Pure decision pipeline for FUXA's built-in `/users` and `/userRoles` routes under the
 * auth-management SUPERSEDE (D-048 residual → D-052, task 24.2). No Angular imports, so it is
 * verifiable headlessly with jest (D-036); the thin `LegacyUserAdminRedirectGuard` shell wires it
 * to `SettingsService` + `Router`.
 *
 * Emission contract:
 *   - `true`             → SUPERSEDE inactive: let FUXA's built-in page render UNCHANGED
 *                          (legacy / non-flipped deployments are byte-identical).
 *   - a redirect sentinel → SUPERSEDE active: the module owns identity, send the user to the
 *                          module-owned page (the shell produces a `UrlTree`).
 *
 * WHY it gates on `loaded$` first (the important part): `authModuleEnabled` is mirrored from the
 * server ASYNCHRONOUSLY (`SettingsService.init()` → `GET /api/settings`). Its client-side default
 * is `false`. A cold direct-URL load of `/users` runs this guard BEFORE `/api/settings` resolves,
 * so reading the flag synchronously would see `false` and wrongly render the legacy page even under
 * SUPERSEDE — the exact N-096-class browser-only race (green in jest+build, broken in a browser).
 * Waiting for `loaded$===true` makes the flag authoritative before deciding.
 */
export function legacyAdminRedirect$<R>(
    loaded$: Observable<boolean>,
    isSupersedeActive: () => boolean,
    makeRedirect: () => R
): Observable<true | R> {
    return loaded$.pipe(
        filter(loaded => loaded === true),
        take(1),
        map(() => (isSupersedeActive() ? makeRedirect() : (true as const)))
    );
}
