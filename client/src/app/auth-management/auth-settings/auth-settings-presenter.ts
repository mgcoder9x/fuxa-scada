/**
 * Pure, framework-free Auth-Settings page presenter (D-049 Phase 2 · design/13-runtime-config.md).
 *
 * DV-010: ALL logic lives here in a plain class with no Angular import, so it is unit-testable headlessly
 * (no TestBed/DOM). The thin standalone `@Component` only binds a template and wires the real seams.
 *
 * WHAT THIS PAGE IS FOR. D-049 Phase 1 made the auth policy runtime-configurable and hot-swappable, but
 * only over HTTP — no operator could reach it (N-088/N-094). This is the missing half.
 *
 * DESIGN CHOICES THAT MATTER (and why):
 *  - **Bounds come from the server** (`AuthConfigView.bounds`), never hand-copied. A copied policy limit
 *    is the exact drift that made `settings.*` ungrantable in the role editor (N-091 L3). If the server
 *    changes a bound, this page's validation and its messages follow with no client release. When the
 *    server does not send bounds (older build), the page does NOT invent limits: it skips the numeric
 *    range checks and lets the server be the judge — honest, and still safe because the server always
 *    re-validates.
 *  - **Only CHANGED keys are submitted.** The endpoint takes a partial patch, so an untouched field is
 *    omitted rather than echoed back. That keeps an operator from accidentally pinning a value they
 *    never looked at, and it makes the audit entry name exactly what they meant to change.
 *  - **Durations are passed through as typed** (`'1h'`, `'30 minutes'`, `3600`). The server owns the
 *    duration grammar; re-implementing a parser here would be a second source of truth. The page only
 *    rejects the obviously empty value and reports the server's verdict otherwise.
 *  - **Errors render a translated KEY** (design/08 §9): the server's English `errors[]` strings are never
 *    displayed. Field-level messages are generated locally from the server bounds with interpolation
 *    params (the D-051 pattern).
 *  - **Reset is a two-step, confirmed action** because it discards the whole persisted override at once.
 *
 * The client gate is UX-only: `settings.read` to view, `settings.manage` to save/reset. The server
 * enforces both independently (`requirePermission`), so this can never be a security boundary.
 */

import type { Observable } from 'rxjs';
import type { AuthConfigView, AuthConfigBounds, AdminError, AdminErrorId } from '../clients/auth-protocol';
import type { AuthConfigPatch } from '../clients/auth-config.client';

/** Access-gate result (mirrors the users/roles pages). */
export type AccessState = 'checking' | 'granted' | 'denied';

/** Generic i18n KEYS for this page (translation keys, never server text). */
export const AUTH_SETTINGS_KEYS = {
    unauthorized: 'msg.signin-unauthorized',
    invalid: 'msg.settings-invalid-input',
    saved: 'msg.settings-saved',
    failed: 'msg.settings-error',
} as const;

/** Field-level validation messages, keyed by field, with `params` for interpolation (D-051 pattern). */
export interface FieldError {
    key: string;
    params?: Record<string, unknown>;
}

/** Seams injected as plain functions (DV-010) — never Angular services. */
export interface AuthSettingsSeams {
    /** UX gate: may the identity READ the config (`settings.read`)? */
    canRead: () => boolean;
    /** UX gate: may the identity CHANGE the config (`settings.manage`)? */
    canManage: () => boolean;
    /** GET /api/auth/config → effective config + server bounds. */
    load: () => Observable<AuthConfigView>;
    /** PUT /api/auth/config with ONLY the changed keys. */
    save: (patch: AuthConfigPatch) => Observable<AuthConfigView>;
    /** DELETE /api/auth/config → discard the persisted override. */
    reset: () => Observable<AuthConfigView>;
}

/** Map a stable AdminError.errorId to a GENERIC i18n key for this page. */
export function mapSettingsErrorKey(errorId: AdminErrorId | string | null | undefined): string {
    switch (errorId) {
        case 'unauthorized_error':
        case 'forbidden':
            return AUTH_SETTINGS_KEYS.unauthorized;
        case 'validation_error':
        case 'missing_field':
            return AUTH_SETTINGS_KEYS.invalid;
        default:
            return AUTH_SETTINGS_KEYS.failed;
    }
}

function isAccessError(err: AdminError | undefined): boolean {
    if (!err) return false;
    return err.status === 401 || err.status === 403
        || err.errorId === 'unauthorized_error' || err.errorId === 'forbidden';
}

/**
 * The editable form shape.
 *
 * Each field is `string | number` — NOT just `string` — because the value comes from the DOM, which is
 * an EXTERNAL input this class must not make assumptions about: Angular's `[(ngModel)]` on an
 * `<input type="number">` writes back a **number**, while a text input/textarea writes a string. An
 * earlier version typed these as `string` and called `.trim()`; the unit tests passed (they set strings)
 * and the page then threw `this.form.bcryptCost.trim is not a function` in the real browser on every
 * change-detection pass. TypeScript could not catch it because the wrong type is injected at runtime.
 * The honest type is therefore the union, and every read goes through {@link AuthSettingsPresenter.raw}.
 */
export interface SettingsForm {
    passwordMinLength: string | number;
    bcryptCost: string | number;
    tokenExpiresIn: string | number;
    refreshTokenExpiresIn: string | number;
    blocklist: string;           // one entry per line (textarea → always a string)
    bfThreshold: string | number;
    bfBaseThrottleMs: string | number;
    bfBackoffFactor: string | number;
    bfMaxThrottleMs: string | number;
    bfFailureWindowMs: string | number;
}

const EMPTY_FORM: SettingsForm = {
    passwordMinLength: '', bcryptCost: '', tokenExpiresIn: '', refreshTokenExpiresIn: '',
    blocklist: '', bfThreshold: '', bfBaseThrottleMs: '', bfBackoffFactor: '', bfMaxThrottleMs: '',
    bfFailureWindowMs: '',
};

/** Split a textarea into blocklist entries: trimmed, non-empty, de-duplicated, order preserved. */
export function parseBlocklist(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const v = raw.trim();
        if (v === '' || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return out;
}

export class AuthSettingsPresenter {
    access: AccessState = 'checking';
    loading = false;
    savePending = false;
    resetPending = false;
    /** Generic page-level error key, or null. */
    errorKey: string | null = null;
    /** Interpolation params for `errorKey` (D-051 pattern). */
    errorParams?: Record<string, unknown>;
    /** True right after a successful save/reset (drives the "saved" confirmation). */
    saved = false;
    /** Reset confirmation gate: the destructive action needs two steps. */
    confirmingReset = false;

    /** Server bounds, or null when the server did not provide them (then range checks are skipped). */
    bounds: AuthConfigBounds | null = null;
    /** The last loaded effective config, used to compute the CHANGED-keys patch. */
    private loaded: AuthConfigView['config'] | null = null;

    form: SettingsForm = { ...EMPTY_FORM };
    /** Per-field validation errors, empty when the form is clean. */
    fieldErrors: Partial<Record<keyof SettingsForm, FieldError>> = {};

    constructor(private readonly seams: AuthSettingsSeams) { }

    /**
     * Read a form field as a trimmed STRING regardless of what the DOM put there (string from a text
     * input, number from `type="number"`, `null` when the user clears a number input). This is the single
     * coercion point: nothing else in this class may touch `this.form[...]` directly. It exists because a
     * runtime type from the DOM is not the type a form model declares — see the {@link SettingsForm} note.
     */
    private raw(field: keyof SettingsForm): string {
        const v = this.form[field];
        return v === null || v === undefined ? '' : String(v).trim();
    }

    // --- Load ---------------------------------------------------------------

    /** Gate + initial load. A non-`settings.read` identity → `denied` without issuing a request. */
    init(): void {
        this.access = 'checking';
        this.errorKey = null;
        if (!this.seams.canRead()) {
            this.access = 'denied';
            this.errorKey = AUTH_SETTINGS_KEYS.unauthorized;
            return;
        }
        this.access = 'granted';
        this.refresh();
    }

    /** (Re)load the effective config; 401/403 → `denied`, else a generic error key. */
    refresh(): void {
        this.loading = true;
        this.errorKey = null;
        this.saved = false;
        this.seams.load().subscribe({
            next: (view) => {
                this.loading = false;
                this.applyView(view);
            },
            error: (err: AdminError) => {
                this.loading = false;
                if (isAccessError(err)) {
                    this.access = 'denied';
                    this.errorKey = AUTH_SETTINGS_KEYS.unauthorized;
                } else {
                    this.errorKey = mapSettingsErrorKey(err ? err.errorId : undefined);
                }
            },
        });
    }

    /** Adopt a loaded/returned view into the form + bounds (single place, so save and load agree). */
    private applyView(view: AuthConfigView): void {
        const c = view && view.config;
        if (!c) return;
        this.bounds = (view && view.bounds) || null;
        this.loaded = c;
        this.form = {
            passwordMinLength: String(c.passwordMinLength),
            bcryptCost: String(c.bcryptCost),
            tokenExpiresIn: String(c.tokenExpiresIn),
            refreshTokenExpiresIn: String(c.refreshTokenExpiresIn),
            blocklist: (c.passwordBlocklist || []).join('\n'),
            bfThreshold: String(c.bruteForce.threshold),
            bfBaseThrottleMs: String(c.bruteForce.baseThrottleMs),
            bfBackoffFactor: String(c.bruteForce.backoffFactor),
            bfMaxThrottleMs: String(c.bruteForce.maxThrottleMs),
            bfFailureWindowMs: String(c.bruteForce.failureWindowMs),
        };
        this.fieldErrors = {};
    }

    // --- Validation ---------------------------------------------------------

    /**
     * Validate the form against the SERVER bounds. Integer/range checks are skipped when the server did
     * not send bounds (never invent a limit). Returns true when the form may be submitted.
     */
    validate(): boolean {
        const errors: Partial<Record<keyof SettingsForm, FieldError>> = {};
        const intField = (field: keyof SettingsForm, range: { min: number; max: number } | null) => {
            const raw = this.raw(field);
            if (raw === '') {
                errors[field] = { key: 'msg.settings-field-required' };
                return;
            }
            if (!/^-?\d+$/.test(raw)) {
                errors[field] = { key: 'msg.settings-field-integer' };
                return;
            }
            const v = Number(raw);
            if (range && (v < range.min || v > range.max)) {
                errors[field] = { key: 'msg.settings-field-range', params: { min: range.min, max: range.max } };
            }
        };
        const nonNegNumber = (field: keyof SettingsForm, min: number) => {
            const raw = this.raw(field);
            if (raw === '') {
                errors[field] = { key: 'msg.settings-field-required' };
                return;
            }
            const v = Number(raw);
            if (!Number.isFinite(v)) {
                errors[field] = { key: 'msg.settings-field-number' };
                return;
            }
            if (v < min) {
                errors[field] = { key: 'msg.settings-field-min', params: { min } };
            }
        };

        intField('passwordMinLength', this.bounds ? this.bounds.passwordMinLength : null);
        intField('bcryptCost', this.bounds ? this.bounds.bcryptCost : null);
        intField('bfThreshold', null);
        if (!errors.bfThreshold && Number(this.raw('bfThreshold')) < 0) {
            errors.bfThreshold = { key: 'msg.settings-field-min', params: { min: 0 } };
        }
        nonNegNumber('bfBaseThrottleMs', 0);
        nonNegNumber('bfMaxThrottleMs', 0);
        nonNegNumber('bfFailureWindowMs', 0);
        nonNegNumber('bfBackoffFactor', 1);

        // Durations: the SERVER owns the grammar (design/13 §5). Only emptiness is decided here; any
        // other verdict comes from the server, so there is no second parser to drift.
        for (const field of ['tokenExpiresIn', 'refreshTokenExpiresIn'] as (keyof SettingsForm)[]) {
            if (this.raw(field) === '') {
                errors[field] = { key: 'msg.settings-field-required' };
            }
        }

        // Blocklist size limits, again only when the server told us what they are.
        if (this.bounds) {
            const entries = parseBlocklist(this.form.blocklist);
            if (entries.length > this.bounds.blocklistMaxEntries) {
                errors.blocklist = { key: 'msg.settings-blocklist-too-many', params: { max: this.bounds.blocklistMaxEntries } };
            } else {
                const tooLong = entries.find((e) => e.length > this.bounds!.blocklistMaxEntryLen);
                if (tooLong !== undefined) {
                    errors.blocklist = { key: 'msg.settings-blocklist-entry-too-long', params: { max: this.bounds.blocklistMaxEntryLen } };
                }
            }
        }

        this.fieldErrors = errors;
        return Object.keys(errors).length === 0;
    }

    /** Field error accessor for the template. */
    fieldError(field: keyof SettingsForm): FieldError | null {
        return this.fieldErrors[field] || null;
    }

    // --- Patch building -----------------------------------------------------

    /**
     * Build the patch of CHANGED keys only (see the class doc for why). Durations are compared as
     * strings against the loaded value so `'1h'` → `'1h'` is not resubmitted; numbers are compared
     * numerically. `bruteForce` is included only when at least one of its keys changed, and then only
     * with the changed sub-keys.
     */
    buildPatch(): AuthConfigPatch {
        const patch: AuthConfigPatch = {};
        const base = this.loaded;
        if (!base) return patch;

        const nextMinLength = Number(this.raw('passwordMinLength'));
        if (nextMinLength !== base.passwordMinLength) patch.passwordMinLength = nextMinLength;

        const nextCost = Number(this.raw('bcryptCost'));
        if (nextCost !== base.bcryptCost) patch.bcryptCost = nextCost;

        const nextToken = this.raw('tokenExpiresIn');
        if (nextToken !== String(base.tokenExpiresIn)) patch.tokenExpiresIn = nextToken;

        const nextRefresh = this.raw('refreshTokenExpiresIn');
        if (nextRefresh !== String(base.refreshTokenExpiresIn)) patch.refreshTokenExpiresIn = nextRefresh;

        const nextList = parseBlocklist(this.form.blocklist);
        const prevList = base.passwordBlocklist || [];
        if (nextList.length !== prevList.length || nextList.some((v, i) => v !== prevList[i])) {
            patch.passwordBlocklist = nextList;
        }

        const bf: AuthConfigPatch['bruteForce'] = {};
        const bfPairs: [keyof SettingsForm, keyof typeof base.bruteForce][] = [
            ['bfThreshold', 'threshold'],
            ['bfBaseThrottleMs', 'baseThrottleMs'],
            ['bfBackoffFactor', 'backoffFactor'],
            ['bfMaxThrottleMs', 'maxThrottleMs'],
            ['bfFailureWindowMs', 'failureWindowMs'],
        ];
        for (const [formKey, cfgKey] of bfPairs) {
            const next = Number(this.raw(formKey));
            if (next !== base.bruteForce[cfgKey]) {
                (bf as Record<string, number>)[cfgKey] = next;
            }
        }
        if (Object.keys(bf).length > 0) patch.bruteForce = bf;

        return patch;
    }

    /** True when the form differs from the loaded config (drives the Save control). */
    get isDirty(): boolean {
        return Object.keys(this.buildPatch()).length > 0;
    }

    /** Submit is allowed only for a `settings.manage` identity, when dirty and nothing is in flight. */
    canSubmit(): boolean {
        return this.seams.canManage() && !this.savePending && !this.loading && this.isDirty;
    }

    // --- Save / reset -------------------------------------------------------

    /**
     * Validate → PUT only the changed keys → adopt the returned effective config. On a server rejection
     * the page STAYS on the form with a generic key (server text is never rendered, §9).
     */
    submit(): void {
        if (!this.canSubmit()) return;
        if (!this.validate()) {
            this.errorKey = AUTH_SETTINGS_KEYS.invalid;
            this.errorParams = undefined;
            return;
        }
        const patch = this.buildPatch();
        if (Object.keys(patch).length === 0) return;
        this.savePending = true;
        this.errorKey = null;
        this.saved = false;
        this.seams.save(patch).subscribe({
            next: (view) => {
                this.savePending = false;
                this.applyView(view);
                this.saved = true;
            },
            error: (err: AdminError) => {
                this.savePending = false;
                if (isAccessError(err)) {
                    this.access = 'denied';
                    this.errorKey = AUTH_SETTINGS_KEYS.unauthorized;
                } else {
                    this.errorKey = mapSettingsErrorKey(err ? err.errorId : undefined);
                }
            },
        });
    }

    /** Step 1 of the destructive reset. */
    askReset(): void {
        if (!this.seams.canManage()) return;
        this.confirmingReset = true;
        this.errorKey = null;
        this.saved = false;
    }

    /** Cancel the reset confirmation. */
    cancelReset(): void {
        this.confirmingReset = false;
    }

    /** Step 2: discard the persisted override and adopt the baseline/defaults the server returns. */
    confirmReset(): void {
        if (!this.seams.canManage() || this.resetPending) return;
        this.resetPending = true;
        this.confirmingReset = false;
        this.errorKey = null;
        this.seams.reset().subscribe({
            next: (view) => {
                this.resetPending = false;
                this.applyView(view);
                this.saved = true;
            },
            error: (err: AdminError) => {
                this.resetPending = false;
                if (isAccessError(err)) {
                    this.access = 'denied';
                    this.errorKey = AUTH_SETTINGS_KEYS.unauthorized;
                } else {
                    this.errorKey = mapSettingsErrorKey(err ? err.errorId : undefined);
                }
            },
        });
    }

    /** Discard local edits and re-adopt the last loaded config (no request). */
    revert(): void {
        if (this.loaded) {
            this.applyView({ config: this.loaded, bounds: this.bounds });
        }
        this.errorKey = null;
        this.saved = false;
    }

    /** Read-only view for the template: is the identity allowed to change anything? */
    get readOnly(): boolean {
        return !this.seams.canManage();
    }
}
