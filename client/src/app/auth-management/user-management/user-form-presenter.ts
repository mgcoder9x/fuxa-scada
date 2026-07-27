/**
 * Pure, framework-free Create/Edit user-form presenter (design/08 §3/§4 · REQ-12, AC-12.2/12.3/12.4).
 *
 * DV-010: ALL create/edit form acceptance-criteria logic lives HERE (a plain class, no Angular
 * import) so it is unit-testable headlessly with jest. The thin standalone `@Component`
 * (`user-form.component.ts`, D-039) binds a reactive template to this presenter and wires the real
 * `UserAdminClient` + a refresh callback. One PARAMETERIZED presenter serves both modes
 * (design/08 §2.1 "MAY be one parameterized form with a `mode` input"): the validation and
 * field-enablement rules differ (username immutable on edit; password required on create but
 * optional on edit — §3.1/§4.1).
 *
 * Security (design/08 §9): passwords are never logged; errors render a GENERIC i18n KEY (via the
 * shared `mapAdminErrorKey`), never server text; on edit an empty password is OMITTED so the server
 * retains the existing hash (AC-7.3) — the form never sees or sends a hash.
 */

import type { Observable } from 'rxjs';
import type { UserView, AdminError } from '../clients/auth-protocol';
import type { CreateUserInput, UpdateUserInput } from '../clients/user-admin.client';
import { mapAdminErrorKey, mapAdminErrorDetailKey, USER_MGMT_ERROR_KEYS } from './user-management-presenter';

export type UserFormMode = 'create' | 'edit';

/** Seams the form presenter needs, injected as plain functions (DV-010). */
export interface UserFormSeams {
    /** POST /api/users (UserAdminClient.create). */
    createUser: (input: CreateUserInput) => Observable<UserView>;
    /** PUT /api/users/:username (UserAdminClient.update). */
    updateUser: (username: string, patch: UpdateUserInput) => Observable<UserView>;
    /** Existing usernames (from the loaded list) for the create-mode client uniqueness check. */
    existingUsernames: () => string[];
    /** Called after a successful create/update so the host closes the form + refreshes the list. */
    onSuccess: (user: UserView) => void;
}

/** Initial values for edit mode (from the selected UserView). */
export interface UserFormInitial {
    username: string;
    fullname: string;
    roles: string[];
    metadata: Record<string, unknown>;
}

/** Field-level validation keys (generic i18n keys; UI renders the key, never server text). */
export const USER_FORM_ERROR_KEYS = {
    usernameRequired: 'msg.user-username-required',
    usernameDuplicate: USER_MGMT_ERROR_KEYS.duplicateUsername,
    passwordRequired: 'msg.user-password-required',
} as const;

export class UserFormPresenter {
    /** Username — editable only in create mode; immutable (fixed) in edit mode (§4.1). */
    username = '';
    fullname = '';
    /** Password — required on create; on edit starts empty and, if left empty, is OMITTED (AC-7.3). */
    password = '';
    /** Selected role ids (multi-select). */
    roles: string[] = [];

    pending = false;
    /** Generic i18n key for a server/submit error, or null (AC-12.4 field errors are separate). */
    errorKey: string | null = null;
    /**
     * D-051: interpolation values for `errorKey` (e.g. `{ min: 12 }` for `msg.password-too-short`), or
     * undefined. The template passes them to `translate`, so the message states the ACTUAL rule.
     */
    errorParams?: Record<string, unknown>;

    private readonly metadata: Record<string, unknown>;

    constructor(
        private readonly seams: UserFormSeams,
        public readonly mode: UserFormMode,
        initial?: UserFormInitial,
    ) {
        if (mode === 'edit') {
            if (!initial) {
                throw new Error('UserFormPresenter: edit mode requires an initial user');
            }
            this.username = initial.username;
            this.fullname = initial.fullname ?? '';
            this.roles = Array.isArray(initial.roles) ? [...initial.roles] : [];
            this.metadata = initial.metadata ?? {};
            this.password = '';                 // blank on open (AC-7.3); typing sends a new one
        } else {
            this.metadata = {};
        }
    }

    isEdit(): boolean {
        return this.mode === 'edit';
    }

    // --- Field validation (AC-12.4 client half) -----------------------------

    /** Create: username required (non-empty after trim) + client uniqueness. Edit: immutable → no error. */
    usernameError(): string | null {
        if (this.isEdit()) {
            return null;
        }
        const u = this.username.trim();
        if (u === '') {
            return USER_FORM_ERROR_KEYS.usernameRequired;
        }
        if (this.seams.existingUsernames().indexOf(u) !== -1) {
            return USER_FORM_ERROR_KEYS.usernameDuplicate;
        }
        return null;
    }

    /** Create: password required. Edit: optional (empty retains the existing hash). */
    passwordError(): string | null {
        if (this.isEdit()) {
            return null;
        }
        return this.password.trim() === '' ? USER_FORM_ERROR_KEYS.passwordRequired : null;
    }

    /** The form is valid when no field error is present (edit has no required fields). */
    valid(): boolean {
        return this.usernameError() === null && this.passwordError() === null;
    }

    /** AC-12.2/12.3/12.4: submit permitted only when valid and not already in flight. */
    canSubmit(): boolean {
        return this.valid() && !this.pending;
    }

    // --- Submit orchestration (AC-12.2 create / AC-12.3 edit) ---------------

    /**
     * AC-12.4 (client half): a no-op when invalid (the control is already disabled → NO request).
     * Otherwise set `pending`, build the request from TRIMMED values, call create/update ONCE, and
     * on success invoke `onSuccess` (host closes + refreshes the list — AC-12.2/12.3). On error map
     * `errorId` to a generic key and KEEP the form open (AC-12.4), resetting `pending` in every
     * terminal branch.
     */
    submit(): void {
        if (!this.canSubmit()) {
            return;                              // invalid or pending → no request (AC-12.4)
        }
        this.pending = true;
        this.errorKey = null;

        const done = {
            next: (user: UserView) => {
                this.pending = false;
                this.seams.onSuccess(user);
            },
            error: (err: AdminError) => {
                this.pending = false;
                // D-051: prefer the SPECIFIC key the server's detailCode implies (e.g. "password must
                // be at least {{min}} characters") over the generic "invalid input" (N-091 L2).
                this.errorKey = mapAdminErrorDetailKey(err);
                this.errorParams = (err && err.detailParams) || undefined;
            },
        };

        if (this.isEdit()) {
            this.seams.updateUser(this.username, this.buildUpdate()).subscribe(done);
        } else {
            this.seams.createUser(this.buildCreate()).subscribe(done);
        }
    }

    /** Build the create request from trimmed values (username + password + roles + optional fullname). */
    private buildCreate(): CreateUserInput {
        return {
            username: this.username.trim(),
            fullname: this.fullname.trim(),
            password: this.password,             // sent verbatim; server hashes (never trimmed away)
            roles: [...this.roles],
        };
    }

    /**
     * Build the update patch: fullname + roles + preserved metadata; password ONLY when the admin
     * typed one (empty → omitted → server retains the existing hash, AC-7.3). Username is the path
     * param, never in the body (immutable).
     */
    private buildUpdate(): UpdateUserInput {
        const patch: UpdateUserInput = {
            fullname: this.fullname.trim(),
            roles: [...this.roles],
            metadata: this.metadata,             // preserve opaque metadata (§4.1) — never clobbered
        };
        if (this.password.trim() !== '') {
            patch.password = this.password;      // typed → send → server re-hashes (AC-7.2)
        }
        return patch;
    }
}
