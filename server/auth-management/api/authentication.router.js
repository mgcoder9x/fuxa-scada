//@ts-check
'use strict';

/**
 * Authentication / session router (design/01 §4, design/02 §6 · REQ-1, REQ-3). Task 13.2.
 *
 * Owns `POST /api/signin`, `POST /api/refresh`, `POST /api/signout`. It reads/writes only the HTTP
 * request/response + the `fuxa_refresh` cookie and delegates ALL credential/token logic to the
 * services (AC-16.3); it imports no bcrypt/jsonwebtoken (those live behind the Password_Hasher /
 * Token seams). Cookie name/path/scheme are unchanged from FUXA (`fuxa_refresh`, path `/api/refresh`)
 * so tokens stay FUXA-compatible (D-003).
 *
 * Mappings:
 *  - signin (§01 §4): success 200 `{status:'success',data:{token,username,fullname,roles,groups,info}}`
 *    (D-044: `groups`+`info` are the SUPERSEDE client-compat projection built by the service — the
 *    router returns `outcome.session` verbatim);
 *    unknown_user/bad_password → **byte-identical** 401 `{status:'error',error:'invalid_credentials'}`
 *    (DV-006 enumeration parity); missing_field → 400; rate_limited → 429 `too_many_attempts`.
 *  - refresh (§02 §6.3): disabled → 204; rotated → 200 + new cookie; every rejection → 401 + **clear
 *    cookie** (AC-3.3 hardening on ALL paths incl. missing); reuse/revoked also revoke the family
 *    (done inside `Token_Service.refresh`).
 *  - signout (AC-3.4): revoke the server-side family (not just the cookie) + clear cookie + 204.
 */

const express = require('express');

const REFRESH_COOKIE = 'fuxa_refresh';
const REFRESH_COOKIE_PATH = '/api/refresh';

/** Read a cookie value from the raw header (no cookie-parser dependency), or null. */
function readCookie(req, name) {
    const header = req && req.headers && req.headers.cookie;
    if (!header) return null;
    for (const part of String(header).split(';')) {
        const idx = part.indexOf('=');
        const key = (idx === -1 ? part : part.slice(0, idx)).trim();
        if (key === name) {
            return decodeURIComponent(part.slice(idx + 1).trim());
        }
    }
    return null;
}

/** Parse a JWT-style expiry (`number` seconds or `"7d"`/`"1h"`…) to ms, or null. */
function parseExpiresToMs(expiresIn) {
    if (expiresIn === undefined || expiresIn === null) return null;
    if (typeof expiresIn === 'number') return expiresIn * 1000;
    if (typeof expiresIn !== 'string') return null;
    const m = expiresIn.trim().match(/^(\d+)\s*([smhd])?$/i);
    if (!m) return null;
    const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return Number(m[1]) * (mult[(m[2] || 's').toLowerCase()] || 1000);
}

function setRefreshCookie(res, token, settings) {
    /** @type {any} */
    const options = { httpOnly: true, sameSite: 'lax', secure: !!(settings && settings.https), path: REFRESH_COOKIE_PATH };
    const maxAge = parseExpiresToMs((settings && settings.refreshTokenExpiresIn) || '7d');
    if (maxAge) options.maxAge = maxAge;
    res.cookie(REFRESH_COOKIE, token, options);
}
function clearRefreshCookie(res) {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

/**
 * @param {{
 *   authenticationService: { signIn(creds: any): Promise<any> },
 *   tokenService: { issueRefreshForSignIn(id: any): any, refresh(t: string|null): Promise<any>, revokeRefreshByToken(t: string|null): Promise<number> },
 *   userStore: { get(u: string): Promise<any|undefined> },
 *   refreshStore: { insert(token: string, meta: any): Promise<void> },
 *   settings?: { secureEnabled?: boolean, enableRefreshCookieAuth?: boolean, https?: boolean, refreshTokenExpiresIn?: string|number }
 * }} deps
 * @returns {import('express').Router}
 */
function createAuthenticationRouter(deps) {
    const d = deps || {};
    if (!d.authenticationService || typeof d.authenticationService.signIn !== 'function') {
        throw new Error('createAuthenticationRouter requires an authenticationService with signIn()');
    }
    if (!d.tokenService || typeof d.tokenService.refresh !== 'function') {
        throw new Error('createAuthenticationRouter requires a tokenService with refresh()');
    }
    const { authenticationService, tokenService, userStore, refreshStore } = d;
    const settings = d.settings || {};
    const refreshEnabled = () => !!(settings.secureEnabled && settings.enableRefreshCookieAuth);

    const router = express.Router();

    // POST /api/signin — §01 §4
    router.post('/api/signin', async (req, res) => {
        const b = req.body || {};
        let outcome;
        try {
            outcome = await authenticationService.signIn({ username: b.username, password: b.password });
        } catch (_e) {
            // A token-issuance / infra failure after a valid credential (§01 §7) — do not fake success.
            return res.status(500).json({ error: 'unexpected_error', message: 'Sign-in failed' });
        }
        switch (outcome.kind) {
            case 'success': {
                // Issue a refresh token + cookie ONLY when refresh auth is enabled (§02 §6.1).
                if (refreshEnabled() && userStore && refreshStore) {
                    try {
                        const rec = await userStore.get(outcome.session.username);
                        const tokenVersion = (rec && rec.metadata && Number(rec.metadata.tokenVersion)) || 0;
                        const m = tokenService.issueRefreshForSignIn({ username: outcome.session.username, tokenVersion });
                        await refreshStore.insert(m.token, { jti: m.jti, familyId: m.familyId, parentJti: null, username: outcome.session.username, issuedAt: m.issuedAt, expiresAt: m.expiresAt });
                        setRefreshCookie(res, m.token, settings);
                    } catch (_e) {
                        // Refresh issuance is best-effort transport; the access token is already valid.
                    }
                }
                return res.status(200).json({ status: 'success', data: outcome.session });
            }
            case 'missing_field':
                return res.status(400).json({ error: 'missing_field', field: outcome.field, message: 'Missing required field: ' + outcome.field });
            case 'rate_limited':
                return res.status(429).json({ error: 'too_many_attempts', message: 'Too many attempts, try again later', retryAfterMs: outcome.retryAfterMs });
            case 'unknown_user':
            case 'bad_password':
                // DV-006: byte-identical client-facing 401 for both (no token, no enumeration oracle).
                return res.status(401).json({ status: 'error', error: 'invalid_credentials', message: 'Invalid username/password' });
            default:
                return res.status(500).json({ error: 'unexpected_error', message: 'Unexpected sign-in outcome' });
        }
    });

    // POST /api/refresh — §02 §6.2/§6.3
    router.post('/api/refresh', async (req, res) => {
        if (!refreshEnabled()) {
            return res.status(204).end(); // disabled — unchanged from FUXA
        }
        const presented = readCookie(req, REFRESH_COOKIE);
        let outcome;
        try {
            outcome = await tokenService.refresh(presented || null);
        } catch (_e) {
            clearRefreshCookie(res);
            return res.status(401).json({ status: 'error', message: 'Invalid refresh token' });
        }
        if (outcome.kind === 'rotated') {
            setRefreshCookie(res, outcome.refreshToken, settings);
            return res.status(200).json({
                status: 'success',
                data: { token: outcome.accessToken, username: outcome.identity.username, roles: outcome.identity.roles },
            });
        }
        // Every rejection (incl. missing) clears the cookie (AC-3.3 hardening); reuse/revoked/unknown
        // also revoke the family inside Token_Service.refresh.
        clearRefreshCookie(res);
        return res.status(401).json({ status: 'error', message: 'Invalid refresh token' });
    });

    // POST /api/signout — AC-3.4
    router.post('/api/signout', async (req, res) => {
        if (refreshEnabled()) {
            const presented = readCookie(req, REFRESH_COOKIE);
            if (presented) {
                try { await tokenService.revokeRefreshByToken(presented); } catch (_e) { /* best-effort */ }
            }
            clearRefreshCookie(res);
        }
        return res.status(204).end();
    });

    return router;
}

module.exports = { createAuthenticationRouter, readCookie, parseExpiresToMs };
