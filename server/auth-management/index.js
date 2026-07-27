//@ts-check
'use strict';

/**
 * Composition root of the auth-management module (design.md "API Composition Root & Cutover" ·
 * D-014/D-018). Task 13.5.
 *
 * `createAuthManagementModule(deps)` wires the whole module bottom-up — the FUXA-backed stores, the
 * seams/services (Password_Hasher, Token_Service, brute-force guard, Authorization/User/Role/Account
 * services), runs the admin bootstrap ONCE at startup (REQ-17), and returns a single mounted Express
 * `router` that owns `/api/signin`, `/api/refresh`, `/api/signout`, `/api/users[/:username]`,
 * `/api/roles[/:id]`, and `/api/account/rotate-password`. Every dependency is injectable (so the
 * factory is testable end-to-end on an in-memory DB with a spy enrollment channel and a test JWT
 * seam) and defaults to the real FUXA collaborators in production.
 *
 * This file does NOT edit FUXA core. The single FUXA-core edit — mounting THIS router in
 * `server/api/index.js` and un-mounting FUXA's overlapping `authApi`/`usersApi` (the SUPERSEDE
 * cutover, D-014) — is the final coordinated step and MUST land together with the client cutover
 * (D-011), because the module's signin payload `{ token, username, fullname, roles }` differs from
 * FUXA's `{ groups, info }` and would otherwise break the running built client.
 *
 * Boundary (D-003): FUXA core is reached ONLY through the thin adapters (jwt/bcrypt/user-store/
 * role-store) + `runtime.users` for cache coherence; no FUXA business logic is edited here.
 */

const express = require('express');

const { FuxaAuthDb } = require('./store/fuxa-auth-db');
const { RefreshTokenStore } = require('./store/refresh-token-store');
const { FuxaUserStoreAdapter } = require('./adapters/fuxa-user-store.adapter');
const { FuxaRoleStoreAdapter } = require('./adapters/fuxa-role-store.adapter');
const { BcryptHasherAdapter } = require('./adapters/fuxa-bcrypt.adapter');
const { Password_Hasher } = require('./services/password-hasher');
const { TokenService } = require('./services/token.service');
const { BruteForceGuard } = require('./services/brute-force');
const { AuthorizationService } = require('./services/authorization.service');
const { AuthenticationService } = require('./services/authentication.service');
const { UserService } = require('./services/user.service');
const { RoleService } = require('./services/role.service');
const { AccountService } = require('./services/account.service');
const { runBootstrap } = require('./services/bootstrap');
const { AuthConfigStore } = require('./store/auth-config-store');
const { AuthConfigService } = require('./services/auth-config.service');
const { createAuthorizationMiddleware } = require('./api/authorization.middleware');
const { createAuthenticationRouter } = require('./api/authentication.router');
const { createUsersRouter } = require('./api/users.router');
const { createRolesRouter } = require('./api/roles.router');
const { createAccountRouter } = require('./api/account.router');
const { createAuthConfigRouter } = require('./api/auth-config.router');
const { createPermissionsRouter } = require('./api/permissions.router');

const DEFAULT_BCRYPT_COST = 12; // D-008

/**
 * Assemble the auth-management module and run first-run bootstrap. Async because it ensures the
 * module-owned refresh-token schema and runs `runBootstrap` before returning a ready router.
 *
 * @param {{
 *   db?: FuxaAuthDb, dbFile?: string, workDir?: string, sqlite3?: any,
 *   runtimeUsers?: any,                 // FUXA runtime.users — cache coherence + role prune (optional in tests)
 *   tokenAdapter?: any,                 // default: new TokenAdapter() over FUXA jwt-helper's shared secret
 *   auditLogger?: { record(e: object): void },  // default no-op; production MUST inject the real Audit_Logger (§09)
 *   enrollmentChannel: { deliver(info: any): Promise<void>|void }, // REQUIRED — secure, non-log (D-022)
 *   settings?: {
 *     secureEnabled?: boolean, enableRefreshCookieAuth?: boolean, https?: boolean,
 *     tokenExpiresIn?: number|string, refreshTokenExpiresIn?: number|string,
 *     auth?: { bcryptCost?: number, passwordMinLength?: number, passwordBlocklist?: string[],
 *              jwtAlgorithm?: string, jwtIssuer?: string, jwtAudience?: string, kid?: string,
 *              devNonExpiringTokens?: boolean, production?: boolean, bootstrapAdminUsername?: string,
 *              bruteForce?: object }
 *   }
 * }} deps
 * @returns {Promise<{ router: import('express').Router, db: FuxaAuthDb, bootstrapResult: any, services: object, stores: object }>}
 */
async function createAuthManagementModule(deps = {}) {
    const settings = deps.settings || {};
    const auth = settings.auth || {};
    if (!deps.enrollmentChannel || typeof deps.enrollmentChannel.deliver !== 'function') {
        throw new Error('createAuthManagementModule requires an enrollmentChannel with deliver() (secure, non-log — D-022)');
    }

    const db = deps.db || new FuxaAuthDb({ dbFile: deps.dbFile, workDir: deps.workDir, sqlite3: deps.sqlite3 });
    const runtimeUsers = deps.runtimeUsers || null;
    const auditLogger = deps.auditLogger || { record: () => {} };

    // ---- Store layer (both adapters share the one module connection; refresh schema is module-owned) ----
    const userStore = new FuxaUserStoreAdapter({ db, runtimeUsers });
    const roleStore = new FuxaRoleStoreAdapter({ db, runtimeUsers });
    const refreshStore = new RefreshTokenStore({ db });
    await refreshStore.ensureSchema();

    // ---- Seams + Service layer ----
    const tokenAdapter = deps.tokenAdapter || (() => {
        const { TokenAdapter } = require('./adapters/fuxa-jwt.adapter'); // lazy: only touch FUXA jwt-helper in prod
        return new TokenAdapter();
    })();
    const passwordHasher = new Password_Hasher(new BcryptHasherAdapter({ cost: Number.isInteger(auth.bcryptCost) ? auth.bcryptCost : DEFAULT_BCRYPT_COST }));
    const tokenService = new TokenService({
        tokenAdapter,
        settings: {
            algorithm: auth.jwtAlgorithm,
            tokenExpiresIn: settings.tokenExpiresIn,
            devNonExpiringTokens: auth.devNonExpiringTokens,
            production: auth.production,
            jwtIssuer: auth.jwtIssuer,
            jwtAudience: auth.jwtAudience,
            kid: auth.kid,
            refreshTokenExpiresIn: settings.refreshTokenExpiresIn,
        },
        refreshStore,
        userStore,
    });
    const bruteForceGuard = new BruteForceGuard(auth.bruteForce || {});
    const authorization = new AuthorizationService({ roleStore });
    const authenticationService = new AuthenticationService({ userStore, passwordHasher, tokenService, bruteForceGuard, auditLogger, authorization });
    const userService = new UserService({ userStore, passwordHasher, authorization, auditLogger, settings });
    const roleService = new RoleService({ roleStore, userStore, auditLogger });
    const accountService = new AccountService({ userStore, passwordHasher, auditLogger, settings });

    // ---- Runtime config (D-049): module-owned override store + live-apply service. init() overlays
    // any persisted runtime override onto the baseline-built services BEFORE bootstrap, so the seeded
    // admin's hash honors an overridden bcryptCost too. Fail-safe: a corrupt override → baseline. ----
    const authConfigStore = new AuthConfigStore({ db });
    const authConfigService = new AuthConfigService({
        store: authConfigStore,
        baseline: { auth, tokenExpiresIn: settings.tokenExpiresIn, refreshTokenExpiresIn: settings.refreshTokenExpiresIn },
        auditLogger,
        services: { tokenService, bruteForceGuard, passwordHasher, userService, accountService },
    });
    await authConfigService.init();

    // ---- Bootstrap (once, at startup — REQ-17): seed-if-empty / retain+remediate ----
    const bootstrapResult = await runBootstrap({
        userStore, authorization, passwordHasher, auditLogger,
        enrollmentChannel: deps.enrollmentChannel, settings,
    });

    // ---- API layer: middleware + mounted routers ----
    const { requirePermission, requireAuthenticated } = createAuthorizationMiddleware({ tokenService, userStore, authorizationService: authorization });
    const routerSettings = {
        secureEnabled: settings.secureEnabled,
        enableRefreshCookieAuth: settings.enableRefreshCookieAuth,
        https: settings.https,
        refreshTokenExpiresIn: settings.refreshTokenExpiresIn,
    };
    const router = express.Router();
    router.use(createAuthenticationRouter({ authenticationService, tokenService, userStore, refreshStore, settings: routerSettings }));
    router.use(createUsersRouter({ userService, requirePermission }));
    router.use(createRolesRouter({ roleService, requirePermission }));
    router.use(createAccountRouter({ accountService, requirePermission }));
    router.use(createAuthConfigRouter({ authConfigService, requirePermission })); // D-049 runtime config
    // D-050: own-authority + vocabulary read (authenticated-only, cannot deadlock like role.read).
    router.use(createPermissionsRouter({ authorizationService: authorization, roleStore, requireAuthenticated }));

    return {
        router,
        db,
        bootstrapResult,
        // D-047: re-issue a MODULE session for an already-authenticated identity (heartbeat token
        // refresh under SUPERSEDE, fixes N-082). NOT a login — no password check; the caller proved
        // identity via a valid token. Bound so the api layer can call it directly.
        issueSessionFor: (username) => authenticationService.issueSessionFor(username),
        services: { authentication: authenticationService, token: tokenService, user: userService, role: roleService, account: accountService, authorization, bruteForce: bruteForceGuard, authConfig: authConfigService },
        stores: { user: userStore, role: roleStore, refresh: refreshStore, authConfig: authConfigStore },
    };
}

module.exports = { createAuthManagementModule };
