# Design Section 07 — Login Page (UI) · `DES-UI-LOGIN`

> **Section role: DETAILED DESIGN.** This file details the `Login_Page` UI component and the
> HTTP client it uses to reach the `Authentication_Service` (REQ-11). Read
> [`../design.md`](../design.md) (the **master map**) first — it owns the layered
> architecture, the adapter seams, the Error Handling status/shape table, the Security
> Posture, and the module-boundary rules (D-003, AC-16.*). This section refines those
> decisions for REQ-11 only; it does not restate or override them.
>
> **Covers:** REQ-11 (Login Page), acceptance criteria AC-11.1 … AC-11.5.
> **Owns properties:** **none.** Per the master-map Table of Contents, `DES-UI-LOGIN` owns no
> correctness properties: the Login Page is UI behavior, covered by Angular
> **example / component tests**, not property-based tests (see [§9](#9-testing-notes-req-11)).
> The sign-in *contract* it consumes, and the universal properties behind it, are owned by
> [`01-authentication.md`](./01-authentication.md) (REQ-1) and
> [`02-token-and-session.md`](./02-token-and-session.md) (REQ-2, P-007/P-008).
>
> **Grounding.** Every FUXA claim below was verified by reading the actual client source:
> `client/src/app/login/login.component.ts`, `login.component.html`;
> `client/src/app/_services/auth.service.ts`; `client/src/app/_helpers/auth-interceptor.ts`;
> `client/src/app/auth.guard.ts`; `client/src/app/app.routing.ts`;
> `client/src/app/_helpers/endpointapi.ts`; `client/src/app/_models/user.ts`. Files are cited
> inline. Decisions/notes referenced as `D-***` / `N-***` live in
> [`../decisions/`](../decisions/) and
> [`../decisions/traceability.md`](../decisions/traceability.md).

---

## 1. Purpose & Scope

This section specifies **how a user enters credentials in a browser and exchanges them for an
authenticated session**: the `Login_Page` Angular component (form, validation, pending state,
error surface) and the thin **auth HTTP client** it calls. It is the UI-layer counterpart to
the server-side sign-in path designed in [`01-authentication.md`](./01-authentication.md).

Scope, precisely (REQ-11):

- **AC-11.1** — present a username input, a password input, and a submit control.
- **AC-11.2** — when submitted with **both** fields populated, send a sign-in request to the
  `Authentication_Service`.
- **AC-11.3** — on a success response, **store** the returned `Access_Token` and **navigate**
  the user to the authenticated area.
- **AC-11.4** — on an error response, **display an error message** and **keep** the user on the
  Login Page.
- **AC-11.5** — **while** a submitted request is awaiting a response, **disable** the submit
  control.

What this section **delegates** and only references (see [§6](#6-collaborators--boundaries)):

- the sign-in decision, HTTP status codes, and the stable error identifiers
  (`missing_field` / `user_not_found` / `invalid_credentials` / `too_many_attempts`) →
  [`01-authentication.md`](./01-authentication.md) (REQ-1);
- the success payload shape `{ token, username, fullname, roles }` (**D-007**) →
  [`01-authentication.md`](./01-authentication.md) §2.3;
- `Access_Token` semantics, expiry, and the `HttpOnly` `fuxa_refresh` cookie (browser-managed)
  → [`02-token-and-session.md`](./02-token-and-session.md) (REQ-2, REQ-3).

### 1.1 Where it sits in the layered architecture (AC-16.1, D-001)

The Login Page lives in the **UI layer** (`client/`, Angular) and reaches the server **only
through the API layer over HTTP** — it never accesses a service, store, or FUXA runtime
object directly. The data flow is strictly:

```
Login_Page component  →  Auth HTTP client (module-owned Angular service)
                      →  POST /api/signin  (API layer, server)
                      →  Authentication_Service (§01)  →  … (service/store layers)
```

- **UI component** — the form, reactive validation, pending flag, and error text. It owns no
  business logic; it decides only what to render and when to call the HTTP client.
- **Auth HTTP client** — a module-owned Angular `@Injectable()` that issues the `POST /api/signin`
  request, maps the `{ token, username, fullname, roles }` success payload, and normalizes error
  responses to the stable error identifiers from §01. It is the UI layer's single seam to the
  API layer; the component depends on its interface, not on `HttpClient` directly.
- **Session wiring (reused, not reinvented)** — token storage, the `x-access-token` request
  header, and the route guard are **existing FUXA client mechanisms** the module reuses
  (see [§5](#5-token-storage--session-wiring)); this section does not fork them.

> **Boundary note (D-003).** FUXA today performs sign-in from a **dialog** component
> (`client/src/app/login/login.component.ts`) that calls `AuthService.signIn(...)`
> (`client/src/app/_services/auth.service.ts`), which `POST`s `/api/signin` and stores the
> result. This module does **not** edit those files in place; it introduces a module-owned
> Login Page and auth HTTP client under `client/src/app/auth-management/login/` and reuses the
> existing token-store / interceptor / guard mechanisms unchanged. The EXTEND-vs-SUPERSEDE
> analysis and recommendation are in [§7](#7-extend-vs-supersede-the-existing-fuxa-login-component).

---

## 2. Component Design

### 2.1 `Login_Page` component structure (AC-11.1)

The component renders one credential form with exactly three interactive elements required by
AC-11.1, plus a non-interactive error region:

| Element | Control | AC | Notes |
|---------|---------|----|-------|
| Username input | text `<input>` bound to `loginForm.username` | AC-11.1 | `autocomplete="username"`, trimmed on submit |
| Password input | password `<input>` bound to `loginForm.password` | AC-11.1 | `autocomplete="current-password"`, masked by default |
| Submit control | `<button type="submit">` | AC-11.1, AC-11.5 | disabled while `pending` **or** form invalid |
| Error region | `<div role="alert" aria-live="assertive">` | AC-11.4 | populated only on error; empty otherwise |

Component state (minimal, testable):

```
LoginPageState = {
  loginForm:   FormGroup<{ username: FormControl<string>, password: FormControl<string> }>,
  pending:     boolean,   // true from submit until the response settles (AC-11.5)
  errorKey:    string | null   // i18n key derived from the server error identifier (AC-11.4)
}
```

- `pending` is the single source of truth for the awaiting-response state (AC-11.5). It is set
  `true` immediately before the HTTP call and reset `false` in **both** the success and error
  handlers (including transport failure), so the button can never remain stuck disabled.
- `errorKey` holds a translation key, not a server-provided string, so no server text is
  rendered verbatim and messaging stays generic ([§8](#8-accessibility--security-posture)).

### 2.2 Reactive form and validation

The component uses an Angular **reactive** `FormGroup` (not template-driven), with each control
carrying `Validators.required`. A submit is permitted only when the group is valid — i.e. both
controls are non-empty after trimming (AC-11.2, **D-004b**). This mirrors, and makes explicit,
the existing FUXA login's `isValidate()` check
(`return this.username.value && this.password.value`, verified in `login.component.ts`), but
promotes the two loose `UntypedFormControl`s into a single validated `FormGroup` so submit
enablement and validation are one derived predicate.

```
canSubmit() === loginForm.valid && !pending
```

### 2.3 Auth HTTP client (the service the component calls)

A module-owned Angular service is the component's only path to the server:

```
interface AuthSignInClient {
  // POST /api/signin { username, password }
  // resolves the §01 success payload on 2xx; rejects with a normalized error on non-2xx
  signIn(username: string, password: string): Observable<SignInResult>
}

SignInResult = { token: string, username: string, fullname: string, roles: string[] }   // D-007

SignInError = {
  errorId: 'missing_field' | 'user_not_found' | 'invalid_credentials'
         | 'too_many_attempts' | 'unexpected_error',
  status:  number,          // HTTP status from §01/§04 mapping
  retryAfterMs?: number     // present for 'too_many_attempts' (429), per §01
}
```

- The client targets the base URL resolved by the existing `EndPointApi.getURL()` helper
  (verified in `client/src/app/_helpers/endpointapi.ts`) so proxy/host resolution is identical
  to the rest of the app.
- On success it returns `{ token, username, fullname, roles }` exactly as specified by **D-007**
  and [`01-authentication.md`](./01-authentication.md) §2.3. **Note the migration difference:**
  FUXA's existing `AuthService.signIn` reads `result.data` as `{ username, fullname, groups,
  info, token }` and parses `info.roles` client-side (verified in `auth.service.ts`); the module
  client instead consumes a first-class `roles` field and does not parse `info` (AC-16.2/16.5 —
  the store shape stays server-side).
- On a non-2xx response it maps the body's stable `error` identifier (§01 §2.4) into
  `SignInError.errorId`; if the body has no identifier it falls back to `unexpected_error` keyed
  by status. The component branches on `errorId`, never on message text.

---

## 3. Client-Side Validation Before Submit (AC-11.2, D-004b) and Its Relation to Server 400

**Client-side (this section).** The submit control is enabled only when `loginForm.valid`
(both fields non-empty after trim) and not `pending` ([§2.2](#22-reactive-form-and-validation)).
Therefore a user cannot trigger a sign-in request with a missing username or password: AC-11.2's
"with both fields populated" is enforced *before* the request is ever sent. This is the client
half of **D-004(b)** ("the Login Page validates inputs client-side before submitting").

**Server-side (defense in depth).** Client validation is a UX guard, **not** a security
boundary — a crafted request could still omit a field. The server therefore independently
validates field presence and returns **400** `{ error: 'missing_field' }` up front (owned by
[`01-authentication.md`](./01-authentication.md) §7, AC-1.4). The two layers are complementary:

| Layer | Trigger | Effect |
|-------|---------|--------|
| Login Page (client) | either field empty | submit **disabled**; no request sent (AC-11.2, D-004b) |
| `Authentication_Service` (server) | request arrives missing a field | **400 `missing_field`** (AC-1.4, §01) |

If the client ever receives a `400 missing_field` (e.g. a race, a non-UI caller, or a future
regression), the Auth HTTP client maps it to `errorId: 'missing_field'` and the component shows
the corresponding generic message and stays on the page — the same handling as any other error
outcome ([§4.3](#43-error-handling-ac-114)). The client does not treat `missing_field` specially.

---

## 4. Submit Flow, Success, Error, and Pending State

### 4.1 Submit (AC-11.2)

On submit, if `canSubmit()` is false the handler returns without side effects (defensive; the
button is already disabled). Otherwise the component:

1. sets `pending = true` and clears `errorKey` (this disables the submit control — AC-11.5);
2. reads trimmed `username` and `password` from the form;
3. calls `authSignInClient.signIn(username, password)` (one request per submit — AC-11.2).

### 4.2 Success handling (AC-11.3)

On a success response `{ token, username, fullname, roles }`:

1. **Store the `Access_Token`** via the reused session store
   ([§5](#5-token-storage--session-wiring)) — persisted in `sessionStorage` and published to
   `window.fuxaAccessToken`, exactly as FUXA does today (verified in `auth.service.ts`), so the
   `x-access-token` interceptor picks it up on subsequent requests.
2. **Navigate to the authenticated area** (AC-11.3). Because REQ-11 requires navigation (not
   merely closing a modal), the module's Login Page is a **routed page** that, on success, uses
   the Angular `Router` to navigate to the app's authenticated landing route
   (`''` / `home`, verified in `app.routing.ts`). See the guard-return nuance in
   [§5.3](#53-route-guard-interaction) for the case where login is presented by the guard.
3. reset `pending = false`.

### 4.3 Error handling (AC-11.4)

On any error outcome, the component:

1. resets `pending = false` (re-enabling submit so the user can retry — AC-11.5);
2. maps `SignInError.errorId` to a **generic** i18n message key and sets `errorKey`
   (see the table below); the message is rendered in the `role="alert"` region;
3. **stays on the Login Page** — no navigation, credentials-preserving so the user can correct
   and resubmit (AC-11.4). The password field is left populated but masked; nothing is logged.

Error-identifier → message mapping (identifiers are the stable contract from §01 §2.4; messages
are deliberately generic — see [§8](#8-accessibility--security-posture)):

| `errorId` (from §01) | HTTP | Message intent (i18n key) | Enumeration-safe? |
|----------------------|------|---------------------------|-------------------|
| `invalid_credentials` | 401 | "Invalid username or password" (generic) | Yes — same text as `user_not_found` |
| `user_not_found` | 404 | "Invalid username or password" (generic) | Yes — same text as `invalid_credentials` |
| `too_many_attempts` | 429 | "Too many attempts, try again later" (may show retry hint) | Yes |
| `missing_field` | 400 | "Enter username and password" | Yes |
| `unexpected_error` | 5xx / transport | "Sign-in failed, please try again" | Yes |

> **AC-11.4 covers *any* error response.** The four named identifiers plus the
> `unexpected_error` fallback exhaust the non-success outcomes of the sign-in contract (§01 §4),
> so every error keeps the user on the page with a message — no error outcome is unhandled.

### 4.4 Pending state (AC-11.5)

`pending` gates the submit control's `disabled` binding for the entire in-flight window:
`disabled = pending || loginForm.invalid`. It is set `true` before the call and reset `false`
in every terminal branch (success, mapped error, transport error), guaranteeing the control is
disabled *while awaiting* and re-enabled once the response settles. A spinner/progress indicator
is shown while `pending` for feedback.

> **Verified gap this closes.** FUXA's existing login binds the OK button to
> `[disabled]="!isValidate()"` and tracks a separate `submitLoading` flag that only drives a
> spinner — the button is **not** disabled by `submitLoading` (verified in
> `login.component.html`/`.ts`). A rapid double-click can therefore issue two sign-in requests.
> The module binds the submit control to the `pending` flag directly, satisfying AC-11.5 and
> preventing double submit ([§8](#8-accessibility--security-posture)).

---

## 5. Token Storage & Session Wiring

The module **reuses FUXA's existing client session mechanism verbatim** rather than inventing a
new one (**D-002** applied to the client). All three facts below were verified in source.

### 5.1 Where the `Access_Token` is stored (AC-11.3)

- The token is stored in **`sessionStorage`** under the key `currentUser` (a JSON user profile
  whose `token` field carries the `Access_Token`), and additionally published to the global
  `window.fuxaAccessToken` (verified: `AuthService.saveUserToken` and `publishAccessToken` in
  `client/src/app/_services/auth.service.ts`).
- `sessionStorage` (not `localStorage`) means the token is scoped to the browser tab/session and
  is cleared when the tab closes — a deliberate, verified FUXA choice the module preserves.
- The module's success handler stores the token through this same mechanism, adapting only to the
  new `roles` field (D-007): it sets `roles` directly instead of parsing `info.roles`.

### 5.2 How the token is attached to subsequent requests

- An existing Angular `HttpInterceptor` (`AuthInterceptor` in
  `client/src/app/_helpers/auth-interceptor.ts`, verified) attaches the token as the
  **`x-access-token`** request header (constant `TOKEN_HEADER_KEY = 'x-access-token'`) and a
  companion `x-auth-user` header, for every request that does not opt out via `Skip-Auth`.
- The interceptor also reacts to **401/403** by signing out and reloading (verified). The
  sign-in request itself is a public endpoint; the Login Page issues it *without* a token and
  handles its own 401/404/429 outcomes ([§4.3](#43-error-handling-ac-114)) rather than relying on
  the interceptor's global 401 handling (it uses the `Skip-Error` opt-out so a `401
  invalid_credentials` does not trigger a global sign-out/reload).

### 5.3 Route guard interaction

- The authenticated area is protected by `AuthGuard` (`client/src/app/auth.guard.ts`, verified),
  which activates protected routes (`editor`, `users`, `device`, …, verified in
  `app.routing.ts`) only when security is disabled or the user is authorized; otherwise it
  presents the login flow.
- FUXA's current guard opens the login **as a dialog** (`this.dialog.open(LoginComponent)`) and
  gates on its `afterClosed()` result (verified). Under the module's routed Login Page, the
  guard interaction is one of the two integration modes documented in
  [§7.3](#73-recommended-decision-supersede-the-component-reuse-the-session-wiring); in both, a
  successful sign-in results in the guarded route activating (either the reopened route resolves
  after the token is stored, or the guard's presented login resolves to `true`).

### 5.4 Refresh cookie is browser-managed (§02)

The `HttpOnly` `fuxa_refresh` refresh cookie is **not** touched by the Login Page: being
`HttpOnly`, it is invisible to JavaScript and is set/cleared by the server and carried
automatically by the browser on `withCredentials` calls to `/api/refresh` (verified:
`AuthService.refreshAccessToken` posts with `withCredentials: true`; cookie attributes owned by
[`02-token-and-session.md`](./02-token-and-session.md) §6). The Login Page only stores the
short-lived `Access_Token`; refresh is out of its scope (REQ-3, §02).

---

## 6. Collaborators & Boundaries

What this section **owns** vs. **delegates** (kept DRY — details live with the owner):

| Concern | Owned here? | Owner | Contract used |
|---------|-------------|-------|---------------|
| Login form, validation, pending flag, error surface | **Yes** | this section | `LoginPageState` (§2) |
| Auth HTTP client (`POST /api/signin`, payload/error mapping) | **Yes** | this section | `AuthSignInClient.signIn` (§2.3) |
| Client-side pre-submit validation (AC-11.2, D-004b) | **Yes** | this section | `loginForm.valid` (§3) |
| Sign-in decision, status codes, error identifiers | No | [`01`](./01-authentication.md) (REQ-1) | `POST /api/signin` outcomes (§01 §4) |
| Success payload shape `{ token, username, fullname, roles }` | No | [`01`](./01-authentication.md) §2.3 (D-007) | consumed by the client |
| `Access_Token` semantics, expiry, refresh cookie | No | [`02`](./02-token-and-session.md) (REQ-2/3) | token is opaque to the UI |
| Token storage, `x-access-token` header, 401/403 handling | No (reused) | FUXA client (`auth.service.ts`, `auth-interceptor.ts`) | store + interceptor |
| Route protection of the authenticated area | No (reused) | FUXA client (`auth.guard.ts`) | `AuthGuard.canActivate` |

**Boundary rules honored (AC-16.*):** the UI calls only the API layer over HTTP and never a
service/store/FUXA-runtime object directly (AC-16.1/16.3); the component depends on the
`AuthSignInClient` interface, not on `HttpClient` internals (AC-16.2); the FUXA record/`info`
shape stays server-side — the client consumes first-class `roles` (AC-16.5).

---

## 7. EXTEND vs SUPERSEDE the Existing FUXA Login Component

REQ-11 must be delivered against a codebase that **already has a login UI**. This is an explicit
architectural fork that the master map defers to this section (see the master map's *Physical
Layout* note). It is flagged below for the decisions ledger as a **proposed decision (candidate
`D-011`, pending ledger entry)** — not yet assigned a final ID.

### 7.1 What exists today (verified)

- `client/src/app/login/login.component.ts` + `.html` + `.scss`: a **MatDialog** component
  (injects `MatDialogRef` and `MAT_DIALOG_DATA`), with two loose `UntypedFormControl`s, an
  `isValidate()` both-populated check, a `submitLoading` spinner flag, an inline error string
  (`messageError`), FUXA-specific concerns (touch keyboard directive, `projectService.reload()`,
  HMI login-overlay layout), and `autocomplete="off"` on the inputs.
- It signs in via `AuthService.signIn(username, password)` (`_services/auth.service.ts`), which
  `POST`s `/api/signin` and reads `result.data = { username, fullname, groups, info, token }`,
  parsing `info.roles` into `infoRoles`.
- It is presented by `AuthGuard` as a **dialog**, not a routed page.

### 7.2 Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **EXTEND** | Modify the existing `app/login` dialog + `AuthService` in place to consume `{…, roles}` and disable-on-submit | Least new code; reuses dialog UX | Edits FUXA core UI files in place → higher `git merge` conflict on FUXA upgrades (violates **D-003** intent, N-001); keeps sign-in logic tangled with HMI/touch-keyboard concerns; dialog model fits AC-11.3 "navigate" poorly |
| **SUPERSEDE** | New routed `Login_Page` + module-owned `AuthSignInClient` under `client/src/app/auth-management/login/`; **reuse** the existing token store, interceptor, and guard | Preserves module boundary (**D-003**); clean AC-11.3 navigation; new payload contract (D-007) isolated; existing dialog untouched so FUXA upgrades stay low-conflict | More new files; two login entry points must be reconciled during migration ([§7.3](#73-recommended-decision-supersede-the-component-reuse-the-session-wiring)) |

### 7.3 Recommended decision: SUPERSEDE the component, REUSE the session wiring

**Recommendation (proposed `D-011`, for the ledger):** introduce a **new, module-owned routed
`Login_Page` component and `AuthSignInClient`** under `client/src/app/auth-management/login/`,
and **do not** edit `client/src/app/login/` in place. **Reuse** — unchanged — the existing
session-wiring primitives that are not login-component-specific: the `sessionStorage` +
`window.fuxaAccessToken` token store, the `x-access-token` `AuthInterceptor`, and the
`AuthGuard`.

Reasons (all grounded):

1. **Module boundary / upgrade safety (D-003, N-001).** The workspace receives future FUXA
   upgrades; editing `app/login` and `AuthService` in place maximizes merge conflicts, while a
   superseding component under `auth-management/` keeps the module self-contained and the FUXA
   files pristine.
2. **AC-11.3 navigation fits a routed page.** The requirement is to *navigate to the
   authenticated area*. FUXA's current flow *closes a dialog* and reloads; a routed page
   expresses "navigate" directly via the `Router`.
3. **Contract isolation (D-007).** The module's success payload is `{ token, username, fullname,
   roles }` — different from FUXA's `{…, groups, info}`. Isolating the new contract in a
   module-owned client avoids weakening or forking the shared `AuthService` behavior mid-migration.
4. **Reuse where reuse is safe.** Token storage, the request-header interceptor, and the route
   guard are generic session plumbing, not login-form concerns; reusing them avoids a second,
   divergent session mechanism (which would be a real correctness hazard).

**Migration reconciliation (documented, for tasks):** during migration two login surfaces may
coexist (FUXA's dialog and the module's routed page). The tasks phase must choose the cutover:
either (a) route the `AuthGuard` to the module's `Login_Page` and retire the dialog, or (b) keep
the dialog as a fallback until the routed page is verified. This is an integration decision, not
a REQ-11 acceptance-criteria change, and is flagged in the ledger alongside `D-011`.

---

## 8. Accessibility & Security Posture

**Accessibility (WCAG-aligned; full validation still requires assistive-technology testing):**

- **Labeled controls.** The username and password inputs have programmatic labels (`<label
  for>` / `aria-label`), not placeholder-only labeling, so screen readers announce each field.
- **Error announcement.** The error region uses `role="alert"` with `aria-live="assertive"` so a
  sign-in error (AC-11.4) is announced when it appears. (FUXA's existing markup already uses
  `role="alert" aria-live="assertive"` on its message div — verified — and the module keeps this.)
- **Focus & keyboard.** The username field receives initial focus; the form submits on `Enter`;
  the disabled submit state is conveyed via the native `disabled` attribute (and `aria-busy`
  while pending) so keyboard/AT users perceive the awaiting state (AC-11.5).
- **Field association.** Invalid fields set `aria-invalid` and reference their message via
  `aria-describedby`.

**Security posture (login-specific; refines the master map):**

- **`autocomplete` attributes.** Username uses `autocomplete="username"` and password
  `autocomplete="current-password"` so password managers work correctly. (This is a deliberate
  change from FUXA's `autocomplete="off"`, verified in `login.component.html`, which is now
  discouraged for credential fields; noted for the ledger.)
- **No plaintext logging.** Neither the component nor the `AuthSignInClient` logs the password,
  the username, or the returned token. Nothing about credentials is written to `console` or any
  telemetry (contrast: FUXA's `AuthService.signIn` calls `console.error(err)` on failure — the
  module's client logs a non-sensitive error identifier only, never the request body).
- **Disable-on-submit prevents double submit.** Binding the submit control to `pending`
  (AC-11.5, [§4.4](#44-pending-state-ac-115)) prevents duplicate concurrent sign-in requests
  from a rapid double-click — closing the verified gap where FUXA disables only on validity.
- **Generic error messaging (no user enumeration).** `invalid_credentials` (401) and
  `user_not_found` (404) render the **same** generic "invalid username or password" message
  ([§4.3](#43-error-handling-ac-114)), so the UI does not reveal whether a username exists — even
  though the underlying status codes differ per AC-1.2/AC-1.3. This is consistent with §01's
  uniform-failure posture. No server-provided message string is rendered verbatim.
- **Token exposure.** The `Access_Token` is held in `sessionStorage`/`window.fuxaAccessToken`
  (reused FUXA mechanism, [§5.1](#51-where-the-access_token-is-stored-ac-113)); the long-lived
  refresh token is never in JS reach (`HttpOnly`, §02). Per master-map **N-002**, any non-localhost
  deployment must serve the client over TLS so the token and headers are not sent in clear.

---

## 9. Testing Notes (REQ-11)

**PBT applicability for this section: NOT applicable.** REQ-11's acceptance criteria are UI
interaction and rendering behaviors (which controls exist, what happens on submit, what is shown
on error, whether a button is disabled while a request is in flight). These are best covered by
**Angular component / example tests**, not property-based tests — there is no meaningful
"for all inputs X, property P(X)" statement over UI rendering that would find bugs that a handful
of example tests would not. This matches the master-map Table of Contents, where **`DES-UI-LOGIN`
owns no properties**, and the master-map Testing Strategy, which explicitly excludes Angular UI
from PBT. The universal properties the login path *relies on* (token authenticity P-007; the
sign-in decision correctness behind AC-1.1–1.5) are owned and proven by §02 and §01 and are only
referenced here.

> **New-property watch (flagged, no ID assigned).** One arguably universal invariant exists on
> the client: *for any form state, the submit control is enabled iff both fields are non-empty
> (trimmed) and no request is pending.* Per the master-map decision that UI is covered by
> example/component tests, this is verified as a component test ([§9.1](#91-component--example-tests)
> below), **not** promoted to a PBT property. It is flagged here for review; no `P-***` ID is
> assigned by this section.

### 9.1 Component / example tests

Using Angular's `TestBed` + `HttpClientTestingModule` (and a `RouterTestingModule` /
`Router` spy for navigation), with the `AuthSignInClient` and session store replaced by test
doubles where needed so the component logic is isolated:

1. **AC-11.1 — controls present.** The rendered component exposes a username input, a password
   input, and a submit control (query by role/label); the submit control exists and is initially
   disabled (empty form).
2. **AC-11.2 — submit sends request when both populated.** With both fields set to non-empty
   values, activating submit calls `AuthSignInClient.signIn(username, password)` exactly once
   with the trimmed values; with either field empty, the submit control is disabled and no
   request is made (client-side validation, D-004b).
3. **AC-11.3 — success stores token and navigates.** Given the client resolves
   `{ token, username, fullname, roles }`, the component stores the token via the session store
   (assert the store received the token) and invokes `Router` navigation to the authenticated
   route (assert navigation target).
4. **AC-11.4 — error shows message and stays.** For each error outcome
   (`invalid_credentials` 401, `user_not_found` 404, `too_many_attempts` 429, `missing_field`
   400, and a transport/5xx `unexpected_error`), the component sets `errorKey`, renders text in
   the `role="alert"` region, performs **no** navigation, and preserves the entered username.
   Assert that 401 and 404 render the **same generic** message (no enumeration).
5. **AC-11.5 — submit disabled while awaiting.** With a deferred (pending) `signIn` observable,
   assert the submit control is `disabled` after submit and before the response settles, and
   becomes enabled again after both a success and an error resolution. Include a
   double-activation test asserting only **one** request is issued.
6. **Validation invariant (flagged §9).** Parameterized examples over
   {empty/empty, filled/empty, empty/filled, filled/filled} × {pending true/false} assert
   `submit.disabled === !(bothFilled && !pending)`.

### 9.2 Integration / example tests (auth HTTP client)

With `HttpClientTestingModule` asserting the wire contract against §01:

- A `200` `{ status:'success', data:{ token, username, fullname, roles } }` response resolves
  `SignInResult` with those exact fields (roles first-class; `info` not parsed).
- A `401 { error:'invalid_credentials' }`, `404`, `429 { error:'too_many_attempts' }`, and
  `400 { error:'missing_field' }` each map to the corresponding `SignInError.errorId`; the
  `signin` request carries the `Skip-Error` header so a `401` does not trigger the global
  interceptor sign-out/reload.
- The request is a `POST` to `EndPointApi.getURL() + '/api/signin'` with body
  `{ username, password }` and no `x-access-token` header (public endpoint).

These tests verify UI behavior and the client↔API wire contract; exhaustive credential-decision
coverage (P-001/P-002/P-007) lives in the server sections §01/§02/§03.

---

## 10. Traceability (this section)

| AC | Behavior | Verified FUXA anchor | Test type |
|----|----------|----------------------|-----------|
| AC-11.1 | Login Page presents username, password, and submit controls | `login.component.html` (username/password `formControl`, OK button) | component/example |
| AC-11.2 | Submit with both fields populated → sends sign-in request | `isValidate()` both-populated check + `AuthService.signIn` → `POST /api/signin` in `auth.service.ts` | component/example |
| AC-11.3 | Success → store `Access_Token` + navigate to authenticated area | `saveUserToken`/`publishAccessToken` (`sessionStorage`, `window.fuxaAccessToken`) in `auth.service.ts`; routes in `app.routing.ts` | component/example + integration |
| AC-11.4 | Error → display message + stay on page (generic, enumeration-safe) | `messageError` + `role="alert"` region in `login.component`; error id contract from §01 | component/example |
| AC-11.5 | While awaiting response → disable submit control | `submitLoading` flag in `login.component` (button disabled bound to `pending` — gap closed) | component/example |

No orphan criteria: AC-11.1 … AC-11.5 each map to at least one test above. This section maps back
to REQ-11 only, matching [`../decisions/traceability.md`](../decisions/traceability.md) §A/§B
(`DES-UI-LOGIN → REQ-11`), and owns no correctness properties (consistent with the master-map
Table of Contents).

---

## 11. Open Items / Flags for the Ledger

- **Proposed `D-011` (EXTEND vs SUPERSEDE):** SUPERSEDE the existing `app/login` dialog with a
  module-owned routed `Login_Page` + `AuthSignInClient` under `auth-management/login/`, reusing
  the token store, `x-access-token` interceptor, and `AuthGuard`. Reasons in
  [§7.3](#73-recommended-decision-supersede-the-component-reuse-the-session-wiring). **Pending
  ledger entry — no final ID assigned by this section.**
- **Migration cutover** (guard→routed page vs. dialog fallback) to be settled at Tasks
  ([§7.3](#73-recommended-decision-supersede-the-component-reuse-the-session-wiring)).
- **`autocomplete` change** from FUXA's `off` to `username` / `current-password` on credential
  fields ([§8](#8-accessibility--security-posture)) — minor, flagged for review.
- **New-property watch** (submit-enabled invariant) flagged in [§9](#9-testing-notes-req-11) with
  **no `P-***` ID assigned**, per the master-map decision that UI uses example/component tests.
