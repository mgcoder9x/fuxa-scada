import { Injectable } from '@angular/core';

/**
 * Module-owned session shape.
 *
 * D-007: roles are a **first-class** field on the session, NOT parsed out of
 * `info.roles` (contrast FUXA's `AuthService.signIn`, which reads `result.data.info`
 * and does `JSON.parse(info)?.roles` into `infoRoles`). The module stores/reads the
 * `roles` array directly; the FUXA record/`info` shape stays server-side (AC-16.5).
 *
 * The success payload contract is `{ token, username, fullname, roles }`
 * (design/07-ui-login-page.md §2.3, §5.1; design/08-ui-user-management-page.md §2.4).
 */
export interface ModuleSession {
    token: string;
    username: string;
    fullname: string;
    roles: string[];
}

/**
 * Reuse FUXA's existing sessionStorage key so the reused session plumbing keeps working:
 * FUXA's `AuthService` reads `sessionStorage.getItem('currentUser')` on (re)load and the
 * reused `AuthInterceptor` attaches the token it exposes via `getUserToken()`.
 * (verified: client/src/app/_services/auth.service.ts, client/src/app/_helpers/auth-interceptor.ts)
 */
const CURRENT_USER_KEY = 'currentUser';

/**
 * Adapts token/session storage for the module while REUSING FUXA's generic session
 * mechanism unchanged (D-002/D-011 applied to the client):
 *  - the `Access_Token` is persisted in `sessionStorage` (tab-scoped, cleared on tab close),
 *  - and published to the global `window.fuxaAccessToken`,
 * exactly as FUXA does today (verified: `AuthService.saveUserToken` + `publishAccessToken`).
 *
 * This service does NOT edit any FUXA file in place. The composition-root wiring that makes
 * this the authoritative login store (the D-011 SUPERSEDE cutover) lands in later tasks
 * (16.1 / 17.4); this task (15.1) only provides the module-owned, roles-first-class store.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {

    /** Persist the sign-in result and publish the token where the reused interceptor path expects it. */
    save(session: ModuleSession): void {
        sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(session));
        this.publishAccessToken(session ? session.token : null);
    }

    /** Read the current module session, or `null` if absent/corrupt. */
    read(): ModuleSession | null {
        try {
            const raw = sessionStorage.getItem(CURRENT_USER_KEY);
            return raw ? (JSON.parse(raw) as ModuleSession) : null;
        } catch {
            return null;
        }
    }

    /** The short-lived `Access_Token`, or `null` when signed out. */
    token(): string | null {
        return this.read()?.token ?? null;
    }

    /** First-class role ids for the current session (D-007) — never parsed from `info`. */
    roles(): string[] {
        return this.read()?.roles ?? [];
    }

    /** Convenience accessor for the current username, or `null`. */
    username(): string | null {
        return this.read()?.username ?? null;
    }

    /** Clear the stored session and the published token (sign-out). */
    clear(): void {
        sessionStorage.removeItem(CURRENT_USER_KEY);
        this.publishAccessToken(null);
    }

    private publishAccessToken(token: string | null): void {
        (window as any).fuxaAccessToken = token || null;
    }
}
