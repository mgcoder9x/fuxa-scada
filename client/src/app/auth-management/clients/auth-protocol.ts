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
