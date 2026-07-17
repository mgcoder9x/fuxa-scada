/**
 * 'api/project': API server initialization and general GET/POST
 */

const fs = require('fs');
var express = require('express');
var morgan = require('morgan');
var bodyParser = require('body-parser');
const authJwt = require('./jwt-helper');
const rateLimit = require("express-rate-limit");

var prjApi = require('./projects');
var authApi = require('./auth');
var usersApi = require('./users');
var apiKeysApi = require('./apikeys');
var alarmsApi = require('./alarms');
var pluginsApi = require('./plugins');
var diagnoseApi = require('./diagnose');
var scriptsApi = require('./scripts');
var resourcesApi = require('./resources');
var daqApi = require('./daq');
var schedulerApi = require('./scheduler');
var commandApi = require('./command');
const reports = require('../dist/reports.service');
const reportsApi = new reports.ReportsApiService();
const verifyApiOrToken = require('./apikeys/verify-api-or-token');
const utils = require('../runtime/utils');

const version = '1.0.0';

var apiApp;
var server;
var runtime;
// D-047: the module's session re-issue capability, set once the SUPERSEDE module is built; used by
// `/api/heartbeat` to refresh a MODULE token (tokenVersion-stamped) instead of a FUXA token (N-082).
var authModuleIssueSession = null;

function init(_server, _runtime) {
    server = _server;
    runtime = _runtime;
    // `apiApp` is ALWAYS built synchronously here (as in legacy FUXA) so `FUXA.httpApi` is never
    // undefined when main.js mounts it. The optional auth-management SUPERSEDE (D-043 Stage 2/4,
    // OFF by default) is wired inside `runInit` as a LAZY deferred mount — never on this critical
    // path — so a module-bootstrap failure can never leave `apiApp` unbuilt (N-071).
    return runInit();
}

function runInit() {
    return new Promise(function (resolve, reject) {
        if (runtime.settings.disableServer !== false) {
            apiApp = express();

			if (runtime.settings.logApiLevel !== 'none') {
				apiApp.use(morgan(['combined', 'common', 'dev', 'short', 'tiny'].
				includes(runtime.settings.logApiLevel) ? runtime.settings.logApiLevel : 'combined'));
			}

            var maxApiRequestSize = runtime.settings.apiMaxLength || '100mb';
            apiApp.use(bodyParser.json({limit:maxApiRequestSize}));
            apiApp.use(bodyParser.urlencoded({limit:maxApiRequestSize, extended: true}));
            authJwt.init(runtime.settings.secureEnabled, runtime.settings.secretCode, runtime.settings.tokenExpiresIn);
            const authMiddleware = verifyApiOrToken(runtime);

            const authLimiter = rateLimit({
                windowMs: runtime.settings.authRateLimitWindowMs || 5 * 60 * 1000,
                max: runtime.settings.authRateLimitMax || 100,
                skip: (req) => req.path !== '/api/signin' && req.path !== '/api/refresh'
            });

            const limiter = rateLimit({
                windowMs: runtime.settings.apiRateLimitWindowMs || 5 * 60 * 1000,
                max: runtime.settings.apiRateLimitMax || 1000,
                skip: (req) => req.path === '/api/version'
            });

            // Apply before route handlers so sub-routers are covered too.
            apiApp.use(authLimiter);
            apiApp.use(limiter);

            // D-043 Stage 2/4 — optional SUPERSEDE by the auth-management module (OFF by default).
            const authModuleEnabled = runtime.settings.authModuleEnabled === true;

            prjApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(prjApi.app());
            if (authModuleEnabled) {
                // SUPERSEDE (D-014): the module owns /api/signin, /api/refresh, /api/signout,
                // /api/users[/:username], /api/roles[/:id], /api/account/rotate-password; FUXA's
                // overlapping usersApi + authApi are NOT mounted (verified non-overlapping with every
                // other FUXA router). A deferred proxy is mounted SYNCHRONOUSLY here (former usersApi
                // position — after authLimiter/limiter, before the shared error handler); the real
                // module is built LAZILY after FUXA's user store is ready (`init-users-ok`) so its
                // bootstrap REMEDIATES FUXA's seeded admin (AC-17.4) instead of racing FUXA's own
                // `setDefault` seed on the same users table (root fix for the N-071 duplicate/clobber).
                mountDeferredAuthModule(apiApp);
            } else {
                usersApi.init(runtime, authMiddleware, verifyGroups);
                apiApp.use(usersApi.app());
            }
            alarmsApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(alarmsApi.app());
            if (!authModuleEnabled) {
                authApi.init(runtime, authJwt.secretCode, authJwt.tokenExpiresIn, runtime.settings.enableRefreshCookieAuth, runtime.settings.refreshTokenExpiresIn);
                apiApp.use(authApi.app());
            }
            pluginsApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(pluginsApi.app());
            diagnoseApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(diagnoseApi.app());
            daqApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(daqApi.app());
            schedulerApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(schedulerApi.app());
            scriptsApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(scriptsApi.app());
            resourcesApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(resourcesApi.app());
            commandApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(commandApi.app());
            reportsApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(reportsApi.app());
            apiKeysApi.init(runtime, authMiddleware, verifyGroups);
            apiApp.use(apiKeysApi.app());

            apiApp.use((err, req, res, next) => {
                if (err?.type === 'entity.too.large') {
                    return res.status(413).json({
                        message: `The submitted content exceeds the maximum allowed size (${maxApiRequestSize})`
                    });
                }
                next(err);
            });

            /**
             * GET Server setting data
             */
            apiApp.get('/api/version', function (req, res) {
                res.json(version);
            });

            /**
             * GET Server setting data
             */
            apiApp.get('/api/settings', authMiddleware, function (req, res) {
                if (runtime.settings) {
                    const permission = verifyGroups(req);
                    const tosend = authJwt.haveAdminPermission(permission)
                        ? getSanitizedSettings(runtime.settings)
                        : getPublicSettings(runtime.settings);
                    // res.header("Access-Control-Allow-Origin", "*");
                    // res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
                    res.json(tosend);
                } else {
                    res.status(404).end();
                    runtime.logger.error('api get settings: Value Not Found!');
                }
            });

            /**
             * POST Server user settings
             */
            apiApp.post("/api/settings", authMiddleware, function(req, res, next) {
                const permission = verifyGroups(req);
                if (res.statusCode === 403) {
                    runtime.logger.error("api post settings: Tocken Expired");
                } else if (!authJwt.haveAdminPermission(permission)) {
                    res.status(401).json({error:"unauthorized_error", message: "Unauthorized!"});
                    runtime.logger.error("api post settings: Unauthorized");
                } else {
                    try {
                        if (req.body.smtp && !req.body.smtp.password && runtime.settings.smtp && runtime.settings.smtp.password) {
                            req.body.smtp.password = runtime.settings.smtp.password;
                        }
                        if (utils.isEmptyObject(req.body.daqstore?.credentials) && runtime.settings.daqstore?.credentials) {
                            req.body.daqstore.credentials = runtime.settings.daqstore?.credentials;
                        }
                        if (!req.body.secretCode && runtime.settings.secretCode) {
                            req.body.secretCode = runtime.settings.secretCode;
                        }
                        if (req.body.secureEnabled && !req.body.secretCode) {
                            req.body.secretCode = utils.generateSecretCode();
                            runtime.logger.warn('Generated random JWT secret because secureEnabled=true and no secretCode was provided.');
                        }
                        const prevAuth = {
                            secureEnabled: runtime.settings.secureEnabled,
                            tokenExpiresIn: runtime.settings.tokenExpiresIn,
                            enableRefreshCookieAuth: runtime.settings.enableRefreshCookieAuth,
                            refreshTokenExpiresIn: runtime.settings.refreshTokenExpiresIn,
                            secretCode: runtime.settings.secretCode
                        };
                        if (req.body.nodeRedEnabled === true &&
                            utils.isNullOrUndefined(req.body.nodeRedAuthMode) &&
                            runtime.settings.nodeRedEnabled === false) {
                            req.body.nodeRedAuthMode = 'secure';
                        }
                        fs.writeFileSync(runtime.settings.userSettingsFile, JSON.stringify(req.body, null, 4));
                        mergeUserSettings(req.body);
                        if (prevAuth.secureEnabled !== runtime.settings.secureEnabled ||
                            prevAuth.tokenExpiresIn !== runtime.settings.tokenExpiresIn ||
                            prevAuth.enableRefreshCookieAuth !== runtime.settings.enableRefreshCookieAuth ||
                            prevAuth.refreshTokenExpiresIn !== runtime.settings.refreshTokenExpiresIn ||
                            prevAuth.secretCode !== runtime.settings.secretCode) {
                            authJwt.init(runtime.settings.secureEnabled, runtime.settings.secretCode, runtime.settings.tokenExpiresIn);
                            authApi.init(runtime, authJwt.secretCode, authJwt.tokenExpiresIn, runtime.settings.enableRefreshCookieAuth, runtime.settings.refreshTokenExpiresIn);
                        }
                        runtime.restart(true).then(function(result) {
                            res.end();
                        });
                    } catch (err) {
                        res.status(400).json({ error: "unexpected_error", message: err });
                        runtime.logger.error("api post settings: " + err);
                    }
                }
            });

            /**
             * GET Heartbeat to check token
             */
            apiApp.post('/api/heartbeat', authMiddleware, async function (req, res) {

                if (!runtime.settings.secureEnabled) {
                    return res.end();
                }

                if (req.body.params) {

                    if (!req.isAuthenticated) {
                        // guest → NON puo rinnovare token
                        return res.status(200).json({
                            message: 'guest'
                        });
                    }

                    // D-047 (fixes N-082): under the SUPERSEDE, refresh a MODULE access token
                    // (tokenVersion-stamped + type:'access' + roles) via the module's session re-issue,
                    // instead of FUXA's `getNewTokenFromRequest` (which mints a tokenVersion-less token
                    // the module then actively-revokes). Returns the same projected session as sign-in
                    // (D-044/D-045) so the client's currentUser stays module-consistent.
                    if (authModuleEnabled && typeof authModuleIssueSession === 'function') {
                        let session;
                        try {
                            session = await authModuleIssueSession(req.userId);
                        } catch (err) {
                            runtime.logger.error(`api heartbeat: module session re-issue failed ${err}`);
                            return res.status(503).json({ error: 'service_unavailable', message: 'Auth module unavailable' });
                        }
                        if (!session) {
                            return res.status(401).json({ error: 'unauthorized_error', message: 'Unauthorized!' });
                        }
                        return res.status(200).json({ message: 'tokenRefresh', token: session.token, data: session });
                    }

                    const currentUser = await getCurrentTokenUser(req);
                    if (!currentUser) {
                        return res.status(401).json({ error: 'unauthorized_error', message: 'Unauthorized!' });
                    }

                    req.userGroups = currentUser.groups;
                    const token = authJwt.getNewTokenFromRequest(req);
                    return res.status(200).json({
                        message: 'tokenRefresh',
                        token,
                        data: currentUser
                    });
                }

                // Guest heartbeat
                if (req.userId === 'guest') {
                    return res.status(200).json({
                        message: 'guest',
                        token: authJwt.getGuestToken()
                    });
                }

                return res.end();
            });

            runtime.logger.info('api: init successful!', true);
        } else {
        }
        resolve();
    });
}

function getPublicSettings(settings) {
    const tosend = getSanitizedSettings(settings);
    if (tosend.smtp) {
        delete tosend.smtp.host;
        delete tosend.smtp.port;
        delete tosend.smtp.username;
    }
    if (tosend.daqstore) {
        delete tosend.daqstore.url;
        delete tosend.daqstore.host;
    }
    return tosend;
}

function getSanitizedSettings(settings) {
    const tosend = JSON.parse(JSON.stringify(settings));
    delete tosend.secretCode;
    if (tosend.smtp) {
        delete tosend.smtp.password;
    }
    if (tosend.daqstore?.credentials) {
        delete tosend.daqstore.credentials;
    }
    return tosend;
}

function mergeUserSettings(settings) {
    if (settings.language) {
        runtime.settings.language = settings.language;
    }
    if (!utils.isNullOrUndefined(settings.hideEditorOnboarding)) {
        runtime.settings.hideEditorOnboarding = settings.hideEditorOnboarding;
    }
    if (settings.editorSectionMessages) {
        runtime.settings.editorSectionMessages = Object.assign(
            {},
            runtime.settings.editorSectionMessages || {},
            settings.editorSectionMessages
        );
    }
    runtime.settings.broadcastAll = settings.broadcastAll;
    if (!utils.isNullOrUndefined(settings.lazyViewLoading)) {
        runtime.settings.lazyViewLoading = settings.lazyViewLoading;
    }
    if (!utils.isNullOrUndefined(settings.apiRateLimitWindowMs)) {
        runtime.settings.apiRateLimitWindowMs = settings.apiRateLimitWindowMs;
    }
    if (!utils.isNullOrUndefined(settings.apiRateLimitMax)) {
        runtime.settings.apiRateLimitMax = settings.apiRateLimitMax;
    }
    if (!utils.isNullOrUndefined(settings.authRateLimitWindowMs)) {
        runtime.settings.authRateLimitWindowMs = settings.authRateLimitWindowMs;
    }
    if (!utils.isNullOrUndefined(settings.authRateLimitMax)) {
        runtime.settings.authRateLimitMax = settings.authRateLimitMax;
    }
    runtime.settings.secureEnabled = settings.secureEnabled;
    runtime.settings.logFull = settings.logFull;
    runtime.settings.userRole = settings.userRole;
    runtime.settings.nodeRedEnabled = settings.nodeRedEnabled;
    if (!utils.isNullOrUndefined(settings.nodeRedAuthMode)) {
        runtime.settings.nodeRedAuthMode = settings.nodeRedAuthMode;
    }
    if (!utils.isNullOrUndefined(settings.enableRefreshCookieAuth)) {
        runtime.settings.enableRefreshCookieAuth = settings.enableRefreshCookieAuth;
    }
    if (!utils.isNullOrUndefined(settings.refreshTokenExpiresIn)) {
        runtime.settings.refreshTokenExpiresIn = settings.refreshTokenExpiresIn;
    }
    if (!utils.isNullOrUndefined(settings.nodeRedUnsafeModules)) {
        runtime.settings.nodeRedUnsafeModules = settings.nodeRedUnsafeModules;
    }
    runtime.settings.swaggerEnabled = settings.swaggerEnabled;
    if (settings.secretCode) {
        runtime.settings.secretCode = settings.secretCode;
    }
    if (settings.secureEnabled) {
        runtime.settings.tokenExpiresIn = settings.tokenExpiresIn;
        runtime.settings.enableRefreshCookieAuth = settings.enableRefreshCookieAuth;
        runtime.settings.refreshTokenExpiresIn = settings.refreshTokenExpiresIn;
    }
    if (settings.smtp) {
        runtime.settings.smtp = settings.smtp;
    }
    if (settings.daqstore) {
        runtime.settings.daqstore = settings.daqstore;
    }
    if (settings.alarms) {
        runtime.settings.alarms = settings.alarms;
    }
    if (settings.logs) {
        runtime.settings.logs = settings.logs;
    }
}

async function getCurrentTokenUser(req) {
    if (!req.isAuthenticated || authJwt.isGuestUser(req.userId, req.userGroups)) {
        return null;
    }

    try {
        const users = await runtime.users.getUsers({ username: req.userId });
        if (users && users.length && !utils.isNullOrUndefined(users[0].groups)) {
            return {
                username: users[0].username,
                fullname: users[0].fullname,
                groups: users[0].groups,
                info: users[0].info
            };
        }
    } catch (err) {
        runtime.logger.error(`api heartbeat: user lookup failed ${err}`);
    }

    return null;
}

function verifyGroups(req) {
    if (runtime.settings && runtime.settings.secureEnabled) {
        if (req.apiKey) {
            return authJwt.adminGroups[0];
        }
        if (req.tokenExpired) {
            return (runtime.settings.userRole) ? null : 0;
        }
        const userInfo = runtime.users.getUserCache(req.userId);
        if (req.isAuthenticated && !authJwt.isGuestUser(req.userId, req.userGroups) && !userInfo) {
            return null;
        }
        return (runtime.settings.userRole && req.userId !== 'admin') ? userInfo : userInfo ? userInfo.groups : req.userGroups;
    } else {
        return authJwt.adminGroups[0];
    }
}

// Identity URLs the auth-management module is authoritative for under SUPERSEDE (D-014). Used by the
// deferred proxy to fail-safe (503) ONLY those paths while the module is still initializing.
const AUTH_MODULE_PATHS = ['/api/signin', '/api/refresh', '/api/signout', '/api/users', '/api/roles', '/api/account', '/api/auth'];

/**
 * Mount the SUPERSEDE auth-management router as a DEFERRED proxy (D-043 Stage 2/4; root fix for the
 * N-071 bootstrap race). A synchronous middleware is mounted NOW (so `apiApp` is fully built before
 * main.js reads `FUXA.httpApi`); it forwards to the real module router once that has been built. The
 * module is built LAZILY on FUXA's `init-users-ok` event — i.e. AFTER `runtime.users` has created the
 * table and run its own `setDefault` seed — so the module bootstrap deterministically REMEDIATES the
 * FUXA-seeded admin (AC-17.4 / DEF-B1) instead of racing/clobbering it on the shared users table.
 * Until the module is ready, ONLY the identity URLs return a clear 503 (fail-safe); every other route
 * passes through untouched. A module-build failure leaves identity URLs at 503 but never crashes FUXA.
 * @param {import('express').Application} app the apiApp
 */
function mountDeferredAuthModule(app) {
    let moduleRouter = null;
    app.use(function (req, res, next) {
        if (moduleRouter) {
            return moduleRouter(req, res, next); // express Router: handles its routes, next() otherwise
        }
        const p = req.path;
        if (AUTH_MODULE_PATHS.some(function (m) { return p === m || p.indexOf(m + '/') === 0; })) {
            return res.status(503).json({ error: 'service_unavailable', message: 'Auth module is initializing' });
        }
        return next();
    });
    const build = function () {
        buildAuthModule(runtime).then(function (m) {
            moduleRouter = m.router;
            authModuleIssueSession = m.issueSessionFor; // D-047: heartbeat MODULE-token refresh
            runtime.logger.info('auth-management module mounted — SUPERSEDE active (D-014)', true);
        }).catch(function (e) {
            runtime.logger.error('auth-management module build FAILED (identity URLs remain 503): ' + (e && e.stack ? e.stack : e));
        });
    };
    // Race-safe: api.init runs synchronously right after runtime.init KICKED OFF users.init (async,
    // cannot have resolved yet), so subscribing now reliably catches `init-users-ok`. A defensive
    // fallback covers the (not-expected) case where the events emitter is unavailable.
    if (runtime.events && typeof runtime.events.once === 'function') {
        runtime.events.once('init-users-ok', build);
    } else {
        setImmediate(build);
    }
}

/**
 * Build the auth-management module for the SUPERSEDE cutover (D-014 / D-043 Stage 2). Everything is
 * lazily required so that when `authModuleEnabled` is OFF this FUXA-core file loads and behaves
 * exactly as before (no module import cost, no side effects). The one-time enrollment secret is
 * delivered to the operator's controlled console (InteractiveConsoleEnrollmentChannel — D-035 /
 * N-067; never fuxa.log), which resolves the N-060 running-server retrieval gap. Audit events go to
 * the module's dedicated append-only sink (createFuxaAuditSink — D-023 / §09). The module opens its
 * own sqlite connection to FUXA's users.fuxap.db (workDir) and runs the REQ-17 bootstrap once.
 *
 * @param {*} _runtime FUXA runtime (settings, users, logger)
 * @returns {Promise<{ router: import('express').Router, db: any, services: object, stores: object }>}
 */
function buildAuthModule(_runtime) {
    const { createAuthManagementModule } = require('../auth-management');
    const { InteractiveConsoleEnrollmentChannel } = require('../auth-management/services/enrollment');
    const { Audit_Logger, createFuxaAuditSink } = require('../auth-management/services/audit-logger');

    const s = _runtime.settings || {};
    const auditLogger = new Audit_Logger(createFuxaAuditSink(_runtime.logger, { logDir: s.logDir }));
    return createAuthManagementModule({
        workDir: s.workDir,
        runtimeUsers: _runtime.users,
        enrollmentChannel: new InteractiveConsoleEnrollmentChannel(),
        auditLogger,
        settings: {
            secureEnabled: s.secureEnabled,
            enableRefreshCookieAuth: s.enableRefreshCookieAuth,
            https: s.https,
            tokenExpiresIn: s.tokenExpiresIn,
            refreshTokenExpiresIn: s.refreshTokenExpiresIn,
            auth: s.auth || {},
        },
    });
}

function start() {
}

function stop() {
}

module.exports = {
    init: init,
    start: start,
    stop: stop,

    get apiApp() { return apiApp; },
    get server() { return server; },
    get authJwt() { return authJwt; },
    _getPublicSettings: getPublicSettings,
    _getSanitizedSettings: getSanitizedSettings
};
