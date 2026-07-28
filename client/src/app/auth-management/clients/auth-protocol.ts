/**
 * Auth-management client PROTOCOL — pure, framework-free mapping + error normalization for the
 * module's HTTP contract (design/07 §2.3 · design/04 §8.2 · design/05 §8.1 · REQ-11/12, D-007/D-011).
 *
 * This module has NO Angular import: it is the pure core the thin `@Injectable` client shells
 * (auth-signin.client.ts / user-admin.client.ts / role-admin.client.ts) delegate to. Keeping the
 * logic framework-free makes it fully unit-testable in Node (jest/ts-jest, headless — no TestBed, no
 * browser) and keeps the Angular services trivial adapters (best practice: pure core + thin edge).
 *
 * Contracts consumed (server-verified):
 *  - sign-in success body: `{ status:'success', data:{ token, username, fullname, roles } }` (D-007)
 *  - sign-in error body:   `{ error:'invalid_credentials'|'missing_field'|'too_many_attempts'|…, field?, retryAfterMs? }`
 *    (DV-006: unknown-user is folded into `invalid_credentials` at sign-in; `user_not_found` is kept
 *     in the map only for robustness if a future/non-UI path surfaces it — §07 §4.3.)
 *  - users list/get body:  `{ status:'success', data: UserView[] | UserView | null }` (§04 §8.2)
 *  - roles list body:      `{ status:'success', data: Role[] }` (§05 §8.1)
 *  - admin error bodies:   `{ error:'duplicate_username'|'validation_error'|'user_not_found'|'last_admin'
 *                              |'duplicate_role'|'role_not_found'|'forbidden'|'unauthorized_error'|…, field? }`
 */

// ---------------------------------------------------------------------------
// Success shapes
// ---------------------------------------------------------------------------

/** Sign-in success payload (D-007) — first-class `roles`, NO legacy `groups`/`info`. */
export interface SignInResult {
    token: string;
    username: string;
    fullname: string;
    roles: string[];
}

/** Hash-free user view returned by the users endpoints (§04 §2.1 UserView). */
export interface UserView {
    username: string;
    fullname: string;
    roles: string[];
    metadata: Record<string, unknown>;
}

/** A role option as returned by GET /api/roles (§05 Role: id/name/permissions). */
export interface RoleOption {
    id: string;
    name: string;
    permissions: string[];
}

// ---------------------------------------------------------------------------
// Error shapes (stable identifiers are the contract; UI branches on the id, never on message text)
// ---------------------------------------------------------------------------

export type SignInErrorId =
    | 'missing_field'
    | 'invalid_credentials'
    | 'user_not_found'
    | 'too_many_attempts'
    | 'unexpected_error';

export interface SignInError {
    errorId: SignInErrorId;
    status: number;
    retryAfterMs?: number;
}

export type AdminErrorId =
    | 'missing_field'
    | 'validation_error'
    | 'duplicate_username'
    | 'duplicate_role'
    | 'user_not_found'
    | 'role_not_found'
    | 'last_admin'
    | 'forbidden'
    | 'unauthorized_error'
    | 'unexpected_error';

export interface AdminError {
    errorId: AdminErrorId;
    status: number;
    field?: string;
    /**
     * D-051: the server's STABLE machine-readable reason code (e.g. `password_too_short`), when the
     * endpoint provides one. Carried so the UI can render a SPECIFIC translated message; the server's
     * English `message` is still never displayed (§9).
     */
    detailCode?: string;
    /** D-051: interpolation values for the translated message (e.g. `{ min: 12 }`). */
    detailParams?: Record<string, unknown>;
}

const SIGN_IN_ERROR_IDS: ReadonlySet<SignInErrorId> = new Set<SignInErrorId>([
    'missing_field', 'invalid_credentials', 'user_not_found', 'too_many_attempts', 'unexpected_error',
]);

const ADMIN_ERROR_IDS: ReadonlySet<AdminErrorId> = new Set<AdminErrorId>([
    'missing_field', 'validation_error', 'duplicate_username', 'duplicate_role',
    'user_not_found', 'role_not_found', 'last_admin', 'forbidden', 'unauthorized_error', 'unexpected_error',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback = ''): string {
    return typeof v === 'string' ? v : fallback;
}
function asStringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function asObject(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// Sign-in mapping / normalization (§07)
// ---------------------------------------------------------------------------

/**
 * Map a sign-in success body to `SignInResult`. Accepts either the full envelope
 * `{ status, data:{…} }` or the inner `data` object directly.
 */
export function mapSignInSuccess(body: unknown): SignInResult {
    const b = asObject(body);
    const data = asObject('data' in b ? b['data'] : b);
    return {
        token: asString(data['token']),
        username: asString(data['username']),
        fullname: asString(data['fullname']),
        roles: asStringArray(data['roles']),
    };
}

/**
 * Normalize a sign-in error (HTTP status + error body) to a stable `SignInError`. An unrecognized or
 * absent identifier falls back to `unexpected_error` (keyed by status). `retryAfterMs` is carried
 * through for `too_many_attempts` (429) when present.
 */
export function normalizeSignInError(status: number, body: unknown): SignInError {
    const b = asObject(body);
    const raw = b['error'];
    const errorId: SignInErrorId = typeof raw === 'string' && SIGN_IN_ERROR_IDS.has(raw as SignInErrorId)
        ? (raw as SignInErrorId)
        : 'unexpected_error';
    const out: SignInError = { errorId, status: typeof status === 'number' ? status : 0 };
    if (typeof b['retryAfterMs'] === 'number') {
        out.retryAfterMs = b['retryAfterMs'] as number;
    }
    return out;
}

// ---------------------------------------------------------------------------
// User / role admin mapping / normalization (§04 §8.2, §05 §8.1)
// ---------------------------------------------------------------------------

/** Map one raw user object to a hash-free `UserView` (defensive against missing fields). */
export function mapUserView(raw: unknown): UserView {
    const r = asObject(raw);
    return {
        username: asString(r['username']),
        fullname: asString(r['fullname']),
        roles: asStringArray(r['roles']),
        metadata: asObject(r['metadata']),
    };
}

/** Map a users-list body `{ data: UserView[] }` to `UserView[]` (empty array when absent). */
export function mapUsersResponse(body: unknown): UserView[] {
    const data = asObject(body)['data'];
    return Array.isArray(data) ? data.map(mapUserView) : [];
}

/** Map a single-user body `{ data: UserView | null }` to `UserView | null` (null = empty result, AC-6.4). */
export function mapUserResponse(body: unknown): UserView | null {
    const data = asObject(body)['data'];
    return data && typeof data === 'object' && !Array.isArray(data) ? mapUserView(data) : null;
}

/** Map a roles-list body `{ data: Role[] }` to `RoleOption[]`. */
export function mapRolesResponse(body: unknown): RoleOption[] {
    const data = asObject(body)['data'];
    if (!Array.isArray(data)) {
        return [];
    }
    return data.map((raw) => {
        const r = asObject(raw);
        return { id: asString(r['id']), name: asString(r['name']), permissions: asStringArray(r['permissions']) };
    });
}

// ---------------------------------------------------------------------------
// Own-authority + permission vocabulary (D-050 · GET /api/auth/permissions)
// ---------------------------------------------------------------------------

/**
 * The caller's OWN authority plus the grantable permission vocabulary, as returned by
 * `GET /api/auth/permissions` (D-050).
 *
 * `effective` is server-computed by the SAME `Authorization_Service.effective` that decides
 * `isAllowed`, so a client gate built on it can never disagree with enforcement. `catalog` is the
 * vocabulary the role editor offers (server-owned, so a newly added server permission — e.g. D-049's
 * `settings.*` — appears without a client release; this retires the hand-mirror that caused N-091 L3).
 * `mustRotate` true ⇒ `effective` is empty by contract (P-009: a gated account may do nothing but
 * rotate its password).
 */
export interface IdentityPermissions {
    username: string;
    effective: string[];
    catalog: string[];
    mustRotate: boolean;
}

/**
 * Map a `GET /api/auth/permissions` body to `IdentityPermissions`. Accepts the full envelope
 * `{ status, data:{…} }` or the inner `data` object. Defensive: absent/malformed fields degrade to
 * empty arrays / `false` rather than throwing, so a partial response can never crash the gate.
 */
export function mapPermissionsResponse(body: unknown): IdentityPermissions {
    const b = asObject(body);
    const data = asObject('data' in b ? b['data'] : b);
    return {
        username: asString(data['username']),
        effective: asStringArray(data['effective']),
        catalog: asStringArray(data['catalog']),
        mustRotate: data['mustRotate'] === true,
    };
}

// ---------------------------------------------------------------------------
// Runtime auth-configuration (D-049 · GET/PUT/DELETE /api/auth/config)
// ---------------------------------------------------------------------------

/** Brute-force tunables as stored/served by the module (design/13 §2). */
export interface BruteForceConfig {
    threshold: number;
    baseThrottleMs: number;
    backoffFactor: number;
    maxThrottleMs: number;
    failureWindowMs: number;
}

/** The effective runtime auth configuration (defaults ◁ settings.js baseline ◁ persisted override). */
export interface AuthConfig {
    passwordMinLength: number;
    passwordBlocklist: string[];
    tokenExpiresIn: string | number;
    refreshTokenExpiresIn: string | number;
    bcryptCost: number;
    bruteForce: BruteForceConfig;
    // Token-signing "Advanced" trio (D-054 Option B, task 20.3). iss/aud are `null` when unset (D-029);
    // changing any of the three is a confirmed, session-ending change (existing tokens then fail verify).
    jwtIssuer: string | null;
    jwtAudience: string | null;
    jwtAlgorithm: string;
}

/**
 * The server's VALIDATION BOUNDS, served alongside the config (D-049 Phase 2).
 *
 * The page validates against these instead of hand-copying the numbers: a hand-copied policy constant
 * is exactly the drift that made `settings.*` ungrantable in the role editor (N-091 L3). If a bound
 * changes server-side, the UI and its messages follow automatically.
 */
export interface AuthConfigBounds {
    passwordMinLength: { min: number; max: number };
    bcryptCost: { min: number; max: number };
    blocklistMaxEntries: number;
    blocklistMaxEntryLen: number;
    // D-054 Option B: the HS-only algorithm choices + the iss/aud length limit, served so the page
    // renders the <select> options and the length check FROM the server (never a hand-copied list).
    jwtAlgorithms: string[];
    jwtClaimMaxLen: number;
}

/** What the settings page needs from `GET /api/auth/config`. */
export interface AuthConfigView {
    config: AuthConfig;
    bounds: AuthConfigBounds | null;
}

function asNumber(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asDuration(v: unknown, fallback: string): string | number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return typeof v === 'string' && v !== '' ? v : fallback;
}
function asRange(v: unknown, min: number, max: number): { min: number; max: number } {
    const o = asObject(v);
    return { min: asNumber(o['min'], min), max: asNumber(o['max'], max) };
}

/**
 * Map `GET /api/auth/config` to `AuthConfigView`. Defensive: every field degrades to the documented
 * default rather than throwing, so a partial/older server response can never break the page. `bounds`
 * is `null` when the server does not provide it (older build) — the presenter then falls back to
 * server-side validation only, which is the honest behaviour (it must never invent limits).
 */
export function mapAuthConfigResponse(body: unknown): AuthConfigView {
    const b = asObject(body);
    const data = asObject('data' in b ? b['data'] : b);
    const bf = asObject(data['bruteForce']);
    const config: AuthConfig = {
        passwordMinLength: asNumber(data['passwordMinLength'], 12),
        passwordBlocklist: asStringArray(data['passwordBlocklist']),
        tokenExpiresIn: asDuration(data['tokenExpiresIn'], '1h'),
        refreshTokenExpiresIn: asDuration(data['refreshTokenExpiresIn'], '7d'),
        bcryptCost: asNumber(data['bcryptCost'], 12),
        bruteForce: {
            threshold: asNumber(bf['threshold'], 5),
            baseThrottleMs: asNumber(bf['baseThrottleMs'], 30000),
            backoffFactor: asNumber(bf['backoffFactor'], 2),
            maxThrottleMs: asNumber(bf['maxThrottleMs'], 900000),
            failureWindowMs: asNumber(bf['failureWindowMs'], 0),
        },
        // D-054 Option B — token-signing trio. iss/aud: a non-empty string, else null (unset).
        jwtIssuer: typeof data['jwtIssuer'] === 'string' && data['jwtIssuer'] !== '' ? data['jwtIssuer'] as string : null,
        jwtAudience: typeof data['jwtAudience'] === 'string' && data['jwtAudience'] !== '' ? data['jwtAudience'] as string : null,
        jwtAlgorithm: typeof data['jwtAlgorithm'] === 'string' && data['jwtAlgorithm'] !== '' ? data['jwtAlgorithm'] as string : 'HS256',
    };
    let bounds: AuthConfigBounds | null = null;
    if (b['bounds'] && typeof b['bounds'] === 'object' && !Array.isArray(b['bounds'])) {
        const raw = asObject(b['bounds']);
        bounds = {
            passwordMinLength: asRange(raw['passwordMinLength'], 8, 128),
            bcryptCost: asRange(raw['bcryptCost'], 10, 15),
            blocklistMaxEntries: asNumber(raw['blocklistMaxEntries'], 5000),
            blocklistMaxEntryLen: asNumber(raw['blocklistMaxEntryLen'], 256),
            // D-054 Option B: HS-only choices; default to the known HS set if an older server omits them.
            jwtAlgorithms: Array.isArray(raw['jwtAlgorithms']) && raw['jwtAlgorithms'].length
                ? asStringArray(raw['jwtAlgorithms']) : ['HS256', 'HS384', 'HS512'],
            jwtClaimMaxLen: asNumber(raw['jwtClaimMaxLen'], 256),
        };
    }
    return { config, bounds };
}

/**
 * Normalize a user/role admin error (HTTP status + error body) to a stable `AdminError`. Unknown or
 * absent identifiers fall back to `unexpected_error`. `field` is carried through when present
 * (e.g. `missing_field` → which field).
 */
export function normalizeAdminError(status: number, body: unknown): AdminError {
    const b = asObject(body);
    const raw = b['error'];
    const errorId: AdminErrorId = typeof raw === 'string' && ADMIN_ERROR_IDS.has(raw as AdminErrorId)
        ? (raw as AdminErrorId)
        : 'unexpected_error';
    const out: AdminError = { errorId, status: typeof status === 'number' ? status : 0 };
    if (typeof b['field'] === 'string') {
        out.field = b['field'] as string;
    }
    // D-051: carry the machine-readable reason + its interpolation values when present. Never the
    // server's `message` — that stays server-side (§9); only the code drives the translated text.
    if (typeof b['detailCode'] === 'string' && b['detailCode'] !== '') {
        out.detailCode = b['detailCode'] as string;
        const params = b['detailParams'];
        if (params && typeof params === 'object' && !Array.isArray(params)) {
            out.detailParams = params as Record<string, unknown>;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Account rotate-password mapping / normalization (design/12 §4 · REQ-17, D-045)
// ---------------------------------------------------------------------------

export type RotateErrorId =
    | 'bad_current_password'
    | 'weak_or_reused_password'
    | 'unexpected_error';

export interface RotateError {
    errorId: RotateErrorId;
    status: number;
    /** Server-provided detail (invalid-new policy message). Carried for diagnostics; the UI still
     *  branches on `errorId` and renders a generic i18n key, never this text. */
    detail?: string;
}

const ROTATE_ERROR_IDS: ReadonlySet<RotateErrorId> = new Set<RotateErrorId>([
    'bad_current_password', 'weak_or_reused_password', 'unexpected_error',
]);

/** True iff a rotate-password body indicates success (`{ status:'success' }`). */
export function isRotateSuccess(body: unknown): boolean {
    return asString(asObject(body)['status']) === 'success';
}

/**
 * Normalize a rotate-password error (HTTP status + error body) to a stable `RotateError`. Verified
 * server ids (design/12 §4 / account.router.js): `bad_current_password` (400), `weak_or_reused_password`
 * (400). Unknown/absent ids fall back to `unexpected_error`. `message` is carried as `detail`.
 */
export function normalizeRotateError(status: number, body: unknown): RotateError {
    const b = asObject(body);
    const raw = b['error'];
    const errorId: RotateErrorId = typeof raw === 'string' && ROTATE_ERROR_IDS.has(raw as RotateErrorId)
        ? (raw as RotateErrorId)
        : 'unexpected_error';
    const out: RotateError = { errorId, status: typeof status === 'number' ? status : 0 };
    if (typeof b['message'] === 'string') {
        out.detail = b['message'] as string;
    }
    return out;
}
