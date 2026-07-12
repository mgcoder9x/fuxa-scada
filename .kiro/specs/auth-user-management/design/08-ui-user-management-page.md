# Design Section 08 — User Management Page (UI) · `DES-UI-USERS`

> **Section role: DETAILED DESIGN.** This file details the `User_Management_Page` UI component
> and the HTTP client(s) it uses to reach the `User_Service` (REQ-5…8) and the `Role_Service`
> (REQ-9) over the API layer (REQ-12). Read [`../design.md`](../design.md) (the **master map**)
> first — it owns the layered architecture, the adapter seams, the Error Handling status/shape
> table, the Security Posture, and the module-boundary rules (D-003, AC-16.*). This section
> refines those decisions for REQ-12 only; it does not restate or override them.
>
> **Covers:** REQ-12 (User Management Page), acceptance criteria AC-12.1 … AC-12.6.
> **Owns properties:** **none.** Per the master-map Table of Contents and
> [`../decisions/traceability.md`](../decisions/traceability.md) §C, `DES-UI-USERS` owns no
> correctness properties: the User Management Page is UI behavior, covered by Angular
> **example / component tests**, not property-based tests (see [§10](#10-testing-notes-req-12)).
> The CRUD *contracts* it consumes, and the universal properties behind them, are owned by
> [`04-user-management.md`](./04-user-management.md) (REQ-5…8), [`05-rbac-authorization.md`](./05-rbac-authorization.md)
> (REQ-9/10), and the round-trip **P-003**/**P-004** owned by
> [`06-persistence-and-serialization.md`](./06-persistence-and-serialization.md).
>
> **Grounding.** Every FUXA claim below was verified by reading the actual client source:
> `client/src/app/users/users.component.ts` + `.html`; `client/src/app/users/user-edit/user-edit.component.ts`;
> `client/src/app/users/users-roles/` (role UI); `client/src/app/_services/user.service.ts`;
> `client/src/app/_helpers/auth-interceptor.ts`; `client/src/app/auth.guard.ts`;
> `client/src/app/app.routing.ts`; `client/src/app/_helpers/endpointapi.ts` — and the server
> gate in `server/api/users/index.js`. Files are cited inline. Decisions/notes referenced as
> `D-***` / `N-***` live in [`../decisions/`](../decisions/) and
> [`../decisions/traceability.md`](../decisions/traceability.md).

---

## 1. Purpose & Scope

This section specifies **how an administrator manages user accounts and their role assignments
through a browser**: the `User_Management_Page` Angular component (user list, create-user form,
edit-user form, delete-confirmation dialog, access gate) and the thin **admin HTTP client(s)**
it calls. It is the UI-layer counterpart to the server-side CRUD path designed in
[`04-user-management.md`](./04-user-management.md) and the role/authorization path in
[`05-rbac-authorization.md`](./05-rbac-authorization.md).

Scope, precisely (REQ-12):

- **AC-12.1** — when an administrator opens the page, **display the user list** with `username`,
  full name, and assigned roles.
- **AC-12.2** — when the create-user form is submitted with **valid** inputs, **send a create**
  request to the `User_Service` and **refresh the displayed list on success**.
- **AC-12.3** — when the edit-user form is submitted for a listed user, **send an update**
  request and **refresh the displayed list on success**.
- **AC-12.4** — when the create-user or edit-user form is submitted with **invalid** inputs,
  **display a validation error** and **do NOT send** the request.
- **AC-12.5** — when the administrator **confirms** a deletion, **send a delete** request and
  **remove that user from the displayed list on success**.
- **AC-12.6** — when a **non-administrator** opens the page, **deny access** and **display an
  authorization error**.

What this section **delegates** and only references (see [§7](#7-collaborators--boundaries)):

- the CRUD decisions, outcome types, stable error identifiers (`missing_field` /
  `duplicate_username` / `validation_error` / `user_not_found` / `last_admin`), and the
  outcome→HTTP mapping → [`04-user-management.md`](./04-user-management.md) (REQ-5…8, §8.2);
- the `UserView` shape `{ username, fullname, roles, metadata }` (no hash, **D-007**) and the
  read-path hash exclusion → [`04-user-management.md`](./04-user-management.md) §2.1 / §4.2 and
  [`06-persistence-and-serialization.md`](./06-persistence-and-serialization.md);
- the role list contract `Role { id, name, permissions[] }` used to populate role dropdowns →
  [`05-rbac-authorization.md`](./05-rbac-authorization.md) §3 (REQ-9, `Role_Service.list`);
- the permission model (`user.create` / `user.read` / `user.update` / `user.delete`,
  `role.read`), the admin gate, and the **401/403** decisions behind AC-12.6 →
  [`05-rbac-authorization.md`](./05-rbac-authorization.md) (REQ-10, AC-10.2/10.3/10.4);
- token storage, the `x-access-token` interceptor, and the route guard (reused, not reinvented)
  → [`07-ui-login-page.md`](./07-ui-login-page.md) §5 and FUXA client primitives.

### 1.1 Where it sits in the layered architecture (AC-16.1, D-001)

The User Management Page lives in the **UI layer** (`client/`, Angular) and reaches the server
**only through the API layer over HTTP** — it never accesses a service, store, or FUXA runtime
object directly (AC-16.1/16.3). The data flow is strictly:

```
User_Management_Page component
   → User admin HTTP client  → GET/POST/PUT/DELETE /api/users  (API layer, server)
   → Role admin HTTP client  → GET /api/roles                  (API layer, server)
        → User_Service (§04) / Role_Service (§05) → … (service/store layers)
```

- **UI component** — the user table, the create/edit reactive forms, the pending flags, the
  delete-confirmation dialog, the access gate, and the error surface. It owns no business logic;
  it decides only what to render and when to call an HTTP client.
- **Admin HTTP client(s)** — module-owned Angular `@Injectable()` services that issue the CRUD
  requests to the users router (§04 §1.1) and the role-list request to the roles router (§05),
  map the `UserView[]` / `Role[]` success payloads, and normalize error responses to the stable
  error identifiers from §04/§05. They are the UI layer's only seam to the API layer; the
  component depends on their interfaces, not on `HttpClient` directly (AC-16.2).
- **Session wiring (reused, not reinvented)** — token storage (`sessionStorage` +
  `window.fuxaAccessToken`), the `x-access-token` request header interceptor, and the route
  guard are the **existing FUXA client mechanisms** the module reuses (see
  [§6](#6-access-control-ac-126) and [§8](#8-extend-vs-supersede-the-existing-fuxa-users-ui)),
  exactly as the Login Page does ([`07-ui-login-page.md`](./07-ui-login-page.md) §5).

> **Boundary note (D-003 / D-011 CONFIRMED).** FUXA today manages users from a **routed**
> `UsersComponent` (`client/src/app/users/users.component.ts`, route `users` in
> `app.routing.ts`) that opens a **MatDialog** `UserEditComponent` for create/edit and a
> `ConfirmDialogComponent` for delete, calling `UserService` (`_services/user.service.ts`,
> verified). Per confirmed decision **D-011**, this module **supersedes** that UI with new,
> module-owned routed components under `client/src/app/auth-management/user-management/` and
> **reuses** the session plumbing unchanged; it does **not** edit `client/src/app/users/` in
> place. The full EXTEND-vs-SUPERSEDE analysis and migration note are in
> [§8](#8-extend-vs-supersede-the-existing-fuxa-users-ui).

---

## 2. Component Design

### 2.1 Component composition

The page is a small tree of module-owned components, each with a single responsibility. All live
under `client/src/app/auth-management/user-management/` (D-011 SUPERSEDE):

| Component | Responsibility | AC |
|-----------|----------------|----|
| `UserManagementPage` (routed container) | Loads the user list, holds the access gate result, hosts the list/forms/dialog, owns the refresh cycle | AC-12.1, AC-12.6 |
| `UserListView` | Renders the tabular list of `UserView` rows (username / full name / roles) + row actions (edit, delete) | AC-12.1 |
| `UserCreateForm` | Reactive form for a new user; validates before send | AC-12.2, AC-12.4 |
| `UserEditForm` | Reactive form for an existing user; password-optional; role assignment | AC-12.3, AC-12.4 |
| `DeleteUserConfirmDialog` | Destructive-action confirmation before delete | AC-12.5 |

> The create and edit forms MAY be realized as one parameterized form component with a `mode`
> input (`create` | `edit`); they are described separately here because their validation and
> field-enablement rules differ (username immutable on edit, password required on create but
> optional on edit — [§3](#3-create-flow-ac-122-and-client-side-validation-ac-124) /
> [§4](#4-edit-flow-ac-123)). This mirrors FUXA's single `UserEditComponent` that switches on
> `data.current?.username` to disable the username control (verified).

### 2.2 Page state (minimal, testable)

```
UserManagementPageState = {
  users:       UserView[],        // the displayed list (AC-12.1) — never carries a hash
  roles:       RoleOption[],      // { id, name } options for role assignment dropdowns (§05)
  loading:     boolean,           // list fetch in flight
  access:      'checking' | 'granted' | 'denied',   // gate result (AC-12.6)
  errorKey:    string | null      // i18n key derived from a stable error identifier
}

// The row shape rendered by the list — structurally identical to §04's UserView (no hash)
UserView = { username: string, fullname: string, roles: string[], metadata: object }

// Role option for dropdowns — derived from §05 Role.list(), display name + join id
RoleOption = { id: string, name: string }
```

- `users` holds the last successfully fetched list. It is re-fetched (refresh) after a successful
  create/update (AC-12.2/12.3) and mutated in place by removal after a successful delete
  (AC-12.5, [§5](#5-delete-flow-ac-125)).
- `roles` is fetched once on page load from the `Role_Service` list (`role.read`, §05) and used
  to (a) render human-readable role names in the list column and (b) populate the
  role-assignment control in the create/edit forms (**D-007**: roles are first-class ids, not
  parsed out of `info`).
- `errorKey` holds a **translation key**, not a server string, so no server text is rendered
  verbatim and messaging stays generic ([§9](#9-accessibility--security-posture)).

### 2.3 User list view (AC-12.1)

`UserListView` renders every `UserView` returned by `list()` with **exactly** the three
required columns plus row actions:

| Column | Source | Notes |
|--------|--------|-------|
| Username | `UserView.username` | stable identity / join key; immutable once created |
| Full name | `UserView.fullname` | display label |
| Roles | `UserView.roles` mapped through `roles` options to role **names** | ids resolved to `RoleOption.name`; comma-joined for display |
| (actions) | — | Edit → opens `UserEditForm`; Delete → opens `DeleteUserConfirmDialog` |

The roles column resolves role **ids** (`UserView.roles`) to display **names** by looking each id
up in the fetched `roles` options — the client-side counterpart of the RBAC join
([`05-rbac-authorization.md`](./05-rbac-authorization.md) §2.1). An id with no matching role
(e.g. a role deleted after the user was loaded) is omitted from the label rather than shown as a
raw id; a subsequent refresh reconciles the view.

> **Verified FUXA anchor.** FUXA's `UsersComponent` already lists users in a `MatTableDataSource`
> with `displayedColumns = ['select','username','fullname','groups','start','remove']` and, when
> role permissions are enabled (`settingsService.getSettings()?.userRole`), resolves role names
> via `roles.filter(r => userInfo.roleIds?.includes(r.id)).map(r => r.name).join(', ')`
> (verified in `users.component.ts` `permissionValueToLabel`). The module keeps the role-name
> resolution but **replaces the `groups` column with a first-class `roles` column** (AC-12.1
> requires roles, and the module surfaces `roles` directly rather than parsing `info.roles`
> client-side — the store shape stays server-side, AC-16.5). The `start`/`select` columns are
> FUXA-HMI concerns and are **not** part of REQ-12; they are dropped in the superseding page.

### 2.4 Admin HTTP client(s) (the services the component calls)

Two module-owned Angular services are the component's only path to the server. They target the
base URL resolved by the existing `EndPointApi.getURL()` helper (verified in
`client/src/app/_helpers/endpointapi.ts`) so proxy/host resolution is identical to the rest of
the app.

```
interface UserAdminClient {
  list():                                   Observable<UserView[]>                 // GET  /api/users        (AC-12.1)
  create(req: CreateUserRequest):           Observable<UserView>                   // POST /api/users        (AC-12.2)
  update(username: string, req: UpdateUserRequest): Observable<UserView>           // PUT  /api/users/:user  (AC-12.3)
  remove(username: string):                 Observable<void>                       // DELETE /api/users/:user(AC-12.5)
}

interface RoleAdminClient {
  list(): Observable<RoleOption[]>          // GET /api/roles → Role[] mapped to { id, name }   (§05, role.read)
}

// Request payloads mirror §04 §2.1 (only listed fields are sent)
CreateUserRequest = { username: string, fullname: string, password: string, roles: string[], metadata?: object }
UpdateUserRequest = { fullname?: string, roles?: string[], metadata?: object, password?: string }

// Normalized error surfaced to the component — component branches on errorId, never on message text
AdminError = {
  errorId: 'missing_field' | 'validation_error' | 'duplicate_username'
         | 'user_not_found' | 'last_admin' | 'unauthorized_error' | 'forbidden' | 'unexpected_error',
  status:  number     // HTTP status from §04 §8.2 / §05 §8
}
```

- **Success mapping.** `list()`/`create()`/`update()` resolve the `UserView` payload(s) from the
  §04 outcome→HTTP mapping (`{ status:'success', data: … }`, §04 §8.2). The client consumes the
  first-class `roles` field and **does not parse `info`** (contrast: FUXA's `UserInfo` class
  `JSON.parse(info)` to read `obj.roles`, verified in `user-edit.component.ts`) — the FUXA record
  shape stays server-side (AC-16.5).
- **Error mapping.** On a non-2xx response the client maps the body's stable `error` identifier
  (§04 §8.2 / §05) into `AdminError.errorId`; if the body carries no identifier it falls back to
  `unexpected_error` keyed by status. The component branches on `errorId`.
- **Server route ownership.** The concrete server routes and their outcome→status mapping are
  **owned by** [`04-user-management.md`](./04-user-management.md) §1.1/§8.2 (users) and
  [`05-rbac-authorization.md`](./05-rbac-authorization.md) (roles); this section fixes only the
  client-facing calls. The verbs shown (`POST` create, `PUT` update, `DELETE` remove) reflect the
  module's create/update **separation** (§04 §3/§5) — distinct from FUXA's single upsert `POST
  /api/users` and `DELETE /api/users` with a `{param: username}` body (verified in
  `_services/user.service.ts`); any final route-shape choice remains §04's contract, and this
  client depends on the operation semantics, not the exact path.

---

## 3. Create Flow (AC-12.2) and Client-Side Validation (AC-12.4)

### 3.1 Create form and validation

`UserCreateForm` is an Angular **reactive** `FormGroup` (not template-driven). Its controls and
client-side validators:

| Control | Validator(s) | Rationale |
|---------|--------------|-----------|
| `username` | `Validators.required`, non-empty-after-trim, client-side uniqueness against the loaded list | AC-12.4; mirrors FUXA's `isValidUserName()` uniqueness check (verified) |
| `password` | `Validators.required` (create only) | a created account must have a credential (§04 §8.1 forbids a hash-less created account) |
| `fullname` | none (optional display label) | — |
| `roles` | none (may be empty) | role ids selected from the `roles` options (§05) |
| `metadata` | must be a serializable object | round-trip safety (REQ-13) |

`canSubmit() === createForm.valid && !pending`. The submit control is disabled whenever the form
is invalid or a request is in flight ([§3.3](#33-pending-state-and-refresh)).

### 3.2 Submit → create → refresh (AC-12.2)

On submit, if `canSubmit()` is false the handler returns without side effects (defensive; the
button is already disabled — this is the **AC-12.4 client half**: invalid inputs never reach the
server). Otherwise the component:

1. sets `pending = true`, clears `errorKey`;
2. builds a `CreateUserRequest` from the trimmed form values (username, fullname, password,
   selected role ids, metadata);
3. calls `userAdminClient.create(req)` (**one** request per submit — AC-12.2);
4. **on success** — closes the form, then **re-fetches the list** via `list()` and rebinds it, so
   the newly created user appears (AC-12.2 "refresh the displayed list on success"); resets
   `pending = false`;
5. **on error** — resets `pending = false`, maps `AdminError.errorId` to a generic message
   (`errorKey`), keeps the form open with entered values preserved so the admin can correct and
   resubmit ([§3.4](#34-relation-to-server-side-validation-and-duplicate-detection)).

> **Verified FUXA anchor (refresh-on-success).** FUXA's `UsersComponent.editUser` calls
> `userService.setUser(result)` and, in the success callback, calls `this.loadUsers()` to
> re-fetch (verified). The module keeps this refresh-on-success discipline for create/update; it
> differs only in separating create from update (§04) and in consuming `roles` first-class.

### 3.3 Pending state and refresh

`pending` is the single source of truth for the in-flight window. It gates the submit control's
`disabled` binding (`disabled = pending || form.invalid`) and is reset in **every** terminal
branch (success, mapped error, transport error) so the control can never remain stuck disabled.

> **Verified gap this closes.** FUXA's `UserEditComponent` OK button is not disabled while the
> save is in flight (the dialog closes and `setUser` runs afterward; there is no in-flight submit
> guard on the edit dialog — verified). The module binds submit to `pending`, preventing a rapid
> double-submit from issuing two create/update requests (same discipline as the Login Page,
> [`07-ui-login-page.md`](./07-ui-login-page.md) §4.4).

### 3.4 Relation to server-side validation and duplicate detection

Client-side validation (AC-12.4) is a **UX guard, not a security boundary**. The server
independently validates and detects duplicates (defense in depth), so the client must handle the
server outcomes even though its own validation aims to prevent them:

| Server outcome (§04 §8.2) | HTTP | Client handling |
|---------------------------|------|-----------------|
| `missing_field` (username absent/whitespace, AC-5.3) | 400 | show generic "username is required"; keep form open |
| `duplicate_username` (AC-5.2) | 400 | show "a user with that username already exists"; keep form open, focus username |
| `validation_error` (AC-7.5, edit) | 400 | show generic validation message; keep form open |

The client's own `required`/uniqueness validators aim to prevent `missing_field` and
`duplicate_username` before send, but a race (a user created by another admin between list-load
and submit) can still surface `duplicate_username` from the server — the client maps it and keeps
the admin on the form. The client never treats these specially beyond message text; it always
branches on the stable `errorId`.

### 3.5 Create sequence

```mermaid
sequenceDiagram
    autonumber
    participant A as Administrator
    participant P as UserManagementPage (client)
    participant UC as UserAdminClient
    participant API as API Layer (users router, §04)
    participant SVC as User_Service (§04)

    A->>P: submit create-user form
    alt form invalid (AC-12.4)
        P-->>A: show validation error; NO request sent
    else form valid (AC-12.2)
        P->>P: pending = true
        P->>UC: create({ username, fullname, password, roles, metadata })
        UC->>API: POST /api/users
        API->>SVC: create(req)   %% authZ enforced at seam (§05)
        alt created (AC-5.1)
            SVC-->>API: { kind:'created', user }
            API-->>UC: 200 { data: UserView }
            UC-->>P: UserView
            P->>UC: list()                      %% refresh on success (AC-12.2)
            UC->>API: GET /api/users
            API-->>UC: 200 { data: UserView[] }
            UC-->>P: UserView[]
            P-->>A: list refreshed (new user shown); pending = false
        else duplicate / missing_field (AC-5.2/5.3)
            SVC-->>API: { kind:'duplicate' | 'missing_field' }
            API-->>UC: 400 { error }
            UC-->>P: AdminError
            P-->>A: show generic error; form stays open; pending = false
        end
    end
```

---

## 4. Edit Flow (AC-12.3)

### 4.1 Edit form, password-optional, and role assignment

`UserEditForm` opens pre-populated from the selected `UserView`. Its rules:

- **Username is immutable.** The `username` control is rendered disabled/read-only — the username
  is the store key and cannot be changed on edit. (Verified FUXA behavior: `UserEditComponent`
  disables the `username` control when `data.current?.username` is set.)
- **Password is optional (AC-7.3).** The `password` control starts **empty** and carries **no**
  `required` validator on edit. If the admin leaves it empty, the `UpdateUserRequest` **omits**
  `password`, and the server retains the existing hash (AC-7.3, owned by §04 §5.2); if the admin
  types a new password, it is sent and the server re-hashes it (AC-7.2). This matches FUXA, which
  blanks the password on open (`muser.password = ''`) and only sends a new one when typed
  (verified in `users.component.ts` `editUser` + `user-edit.component.ts`).
- **Role assignment (D-007).** The role control is a multi-select populated from the `roles`
  options fetched from the `Role_Service` list (`role.read`, §05). The selected role **ids**
  become `UpdateUserRequest.roles`. This is the first-class-roles counterpart to FUXA's
  `SelOptionsComponent`, which maps selected options to `role.id` and stores them in
  `info.roles` (verified) — the module sends `roles` directly and lets the store adapter own the
  `info.roles` composition (§04/§06).
- **Metadata.** Non-role metadata (the remainder of `info`) is edited/retained as an opaque
  serializable object and round-trips through the store (REQ-13); the page does not interpret
  FUXA-HMI-specific fields (`start`, `languageId`) as REQ-12 concerns.

### 4.2 Submit → update → refresh (AC-12.3)

The edit submit path is identical in shape to create ([§3.2](#32-submit--create--refresh-ac-122)):
validate client-side (AC-12.4) → set `pending` → call `userAdminClient.update(username, req)` →
**on success re-fetch the list** and rebind (AC-12.3 "refresh the displayed list on success") →
on error map `errorId`, keep the form open, reset `pending`. The distinct server error the edit
path must handle is `user_not_found` (AC-7.4 — the target user was deleted between load and
submit): the client shows a generic "that user no longer exists" message and refreshes the list
so the stale row disappears.

---

## 5. Delete Flow (AC-12.5)

### 5.1 Confirm → delete → remove-from-list

Deletion is a **destructive** action, so it is gated by an explicit confirmation dialog before
any request is sent:

1. The admin activates *Delete* on a list row; the page opens `DeleteUserConfirmDialog` naming
   the target username.
2. **If the admin cancels**, nothing is sent (no side effect).
3. **If the admin confirms** (AC-12.5), the page calls `userAdminClient.remove(username)`.
4. **On success**, the page **removes that user from the displayed list** (AC-12.5) — it filters
   the row out of `users` in place and rebinds, avoiding a full re-fetch for the common case.
5. **On error**, the row is **kept** and a generic message is shown ([§5.2](#52-error-handling-last_admin-and-user_not_found)).

> **Verified FUXA anchor.** FUXA's `UsersComponent.onRemoveUser` opens a `ConfirmDialogComponent`
> (message key `msg.user-remove`), and only on confirmation calls `userService.removeUser(user)`;
> on success it filters the local array (`this.users.filter(el => el.username !== user.username)`)
> and rebinds the table (verified). The module preserves this confirm-then-filter pattern in a
> module-owned dialog + client, adding explicit handling of the `last_admin` and `user_not_found`
> outcomes (below), which FUXA's UI does not surface.

### 5.2 Error handling: `last_admin` and `user_not_found`

The delete path must handle two server outcomes gracefully, keeping the displayed list consistent
(the row is **not** removed on either):

| Server outcome (§04 §8.2) | HTTP | Client handling | Anchor |
|---------------------------|------|-----------------|--------|
| `last_admin` — refuse to delete the last administrator | 400 | show a **specific but generic** message ("the last administrator cannot be deleted"); keep the row; no list mutation | AC-8.5 / **D-009** |
| `user_not_found` — target already gone | 404 | show "that user no longer exists"; **refresh** the list so the stale row disappears | AC-8.3 |
| `unauthorized_error` / `forbidden` | 401 / 403 | treated per [§6](#6-access-control-ac-126) (session expiry / lost permission) | AC-10.2/10.3 |

The `last_admin` case is the UI obligation flowing from **AC-8.5** (the last-administrator guard,
owned by §04 §6.5; the admin-determination predicate owned by §05 §5.3; recorded as decision
**D-009**): the server refuses the deletion and returns the stable `last_admin` identifier, and
the page surfaces it without mutating the list — the deleted-that-was-refused user remains
visible and usable. Because the client branches on the stable `errorId`, the 400-vs-409 status
choice (flagged in §04 §8.2) does not affect this handling.

### 5.3 Delete sequence

```mermaid
sequenceDiagram
    autonumber
    participant A as Administrator
    participant P as UserManagementPage (client)
    participant D as DeleteUserConfirmDialog
    participant UC as UserAdminClient
    participant API as API Layer (users router, §04)
    participant SVC as User_Service (§04)

    A->>P: activate Delete on a row
    P->>D: open confirm(username)
    alt admin cancels
        D-->>P: cancelled
        P-->>A: no request sent
    else admin confirms (AC-12.5)
        D-->>P: confirmed
        P->>UC: remove(username)
        UC->>API: DELETE /api/users/:username
        API->>SVC: delete(username)   %% authZ at seam (§05); last-admin guard (§04 §6.5)
        alt deleted (AC-8.1)
            SVC-->>API: { kind:'deleted' }
            API-->>UC: 200 { status:'success' }
            UC-->>P: void
            P->>P: remove row from list (AC-12.5)
            P-->>A: user removed from displayed list
        else last_admin (AC-8.5 / D-009)
            SVC-->>API: { kind:'last_admin' }
            API-->>UC: 400 { error:'last_admin' }
            UC-->>P: AdminError
            P-->>A: show "last administrator cannot be deleted"; row kept
        else user_not_found (AC-8.3)
            SVC-->>API: { kind:'unknown_user' }
            API-->>UC: 404 { error:'user_not_found' }
            UC-->>P: AdminError
            P->>UC: list()   %% reconcile stale row
            P-->>A: show "user no longer exists"; list refreshed
        end
    end
```

---

## 6. Access Control (AC-12.6)

### 6.1 Requirement and layering

AC-12.6 requires that a **non-administrator** who opens the User Management Page is **denied
access** and shown an **authorization error**. This is enforced in two complementary places, and
the security boundary is on the **server**, not the client:

| Layer | Mechanism | Effect | Boundary role |
|-------|-----------|--------|---------------|
| **Client (UX gate)** | Route guard + a page-level permission check for `user.read` | non-admin never sees the management UI; is redirected/shown an authorization error | **UX only** — not a security boundary |
| **Server (enforcement)** | Authorization middleware requires `user.read` for `GET /api/users` (and the matching `user.*` permission for each mutation) | non-admin request denied **403**; unauthenticated denied **401** | **the real boundary** (defense in depth) |

The client gate improves UX (a non-admin is never shown a page they cannot use), but it is **not**
trusted for security: every data-bearing request is independently authorized by the server
(§05). Even if the client gate were bypassed, `list()` would return **403** and the page would
render the authorization error with no user data.

### 6.2 Client-side gate design (reuse `AuthGuard` + a `user.read` check)

The route to the module page is protected by the **reused** `AuthGuard`
(`client/src/app/auth.guard.ts`, verified) exactly as the existing `users` route is
(`{ path: 'users', component: UsersComponent, canActivate: [AuthGuard] }`, verified in
`app.routing.ts`). The module adds a **permission-aware** check on top:

- `AuthGuard` today returns `true` when security is disabled or `authService.isAdmin()` is true,
  otherwise presents the login flow and, on failure, calls `notifySaveError('msg.signin-unauthorized')`,
  navigates to `/`, and returns `false` (verified). The module reuses this guard so an
  unauthenticated visitor is routed through sign-in first.
- On top of the guard, the `UserManagementPage` performs a **`user.read` permission check** on
  init: `access` starts `checking`; if the current identity lacks `user.read` (a non-admin), the
  page sets `access = 'denied'`, renders the authorization error, and does **not** issue `list()`.
  This is the client expression of the §05 admin gate (AC-10.4: administrators hold
  `user.read`). It relates directly to **AC-10.2** (authenticated-but-unpermitted → 403) and is
  the UX-side of the same decision.

> **Grounding / divergence.** FUXA's `AuthGuard` gate is a coarse `isAdmin()` check keyed to the
> hardcoded `admin` username in places (`UsersComponent.isAdmin` returns true only when
> `username === 'admin'`, verified) — i.e. group/username-based, not permission-based. The module
> keeps `AuthGuard` for the authentication redirect but expresses **authorization** as a
> `user.read` permission check consistent with the RBAC model (§05), rather than a username test.

### 6.3 Server denial is authoritative (defense in depth)

If the client gate is bypassed or a permission is lost mid-session, the server is authoritative:

- `GET /api/users` (and each mutation) requires the matching `user.*` permission at the
  authorization middleware seam (§05). An **unauthenticated** request → **401** `unauthorized_error`
  (AC-10.3); an **authenticated non-admin** → **403** `forbidden` (AC-10.2).
- The page's HTTP clients map a `401`/`403` on the initial `list()` to `access = 'denied'` and
  render the same authorization error, so AC-12.6 holds even when reached through the server path.

> **Verified FUXA anchor.** FUXA's `server/api/users/index.js` already guards `GET/POST/DELETE
> /api/users` (and `/api/roles`) with `secureFnc` then `authJwt.haveAdminPermission(checkGroupsFnc(req))`,
> returning `401 { error:'unauthorized_error' }` when the caller is not an admin (verified — the
> same 401 for both no-token and not-admin). The module replaces that coarse admin-only gate with
> the permission-based `Authorization_Service` decision that **splits** unauthenticated (401) from
> authenticated-but-unpermitted (403) — owned by §05 — and the page renders whichever it receives
> as the AC-12.6 authorization error. The `x-access-token` interceptor
> (`client/src/app/_helpers/auth-interceptor.ts`, verified) attaches the session token to these
> requests and reacts to 401/403 globally; the page additionally handles them locally for the
> access gate.

---

## 7. Collaborators & Boundaries

What this section **owns** vs. **delegates** (kept DRY — details live with the owner):

| Concern | Owned here? | Owner | Contract used |
|---------|-------------|-------|---------------|
| User list view, create/edit forms, delete dialog, pending flags, error surface, access gate | **Yes** | this section | `UserManagementPageState` (§2.2) |
| Admin HTTP clients (`UserAdminClient`, `RoleAdminClient`) — calls + payload/error mapping | **Yes** | this section | interfaces (§2.4) |
| Client-side pre-submit validation (AC-12.4) | **Yes** | this section | `form.valid` (§3.1) |
| CRUD decisions, outcome types, error identifiers, outcome→HTTP mapping | No | [`04`](./04-user-management.md) (REQ-5…8) | `User_Service` outcomes (§04 §2/§8.2) |
| `UserView` shape (no hash), read-path hash exclusion | No | [`04`](./04-user-management.md) §2.1/§4.2, [`06`](./06-persistence-and-serialization.md) | consumed by the client |
| Password retain-on-omit (AC-7.3), re-hash on new password (AC-7.2) | No | [`04`](./04-user-management.md) §5.2 | edit form omits/sends `password` |
| Last-administrator guard (AC-8.5 / D-009) + admin-determination predicate | No | [`04`](./04-user-management.md) §6.5 + [`05`](./05-rbac-authorization.md) §5.3 | `last_admin` outcome |
| Role list for dropdowns `Role { id, name, permissions[] }` | No | [`05`](./05-rbac-authorization.md) §3 (REQ-9) | `Role_Service.list` (`role.read`) |
| Permission model, admin gate, 401/403 decisions (AC-12.6) | No | [`05`](./05-rbac-authorization.md) (REQ-10) | `user.read`/`user.*` at the seam |
| Token storage, `x-access-token` header, 401/403 handling | No (reused) | FUXA client (`auth.service.ts`, `auth-interceptor.ts`) | store + interceptor |
| Route protection of the page | No (reused) | FUXA client (`auth.guard.ts`) | `AuthGuard.canActivate` |
| `User_Record`/`Role` write→read round-trip (P-003/P-004) | No | [`06`](./06-persistence-and-serialization.md) | referenced (§10) |

**Boundary rules honored (AC-16.*):** the UI calls only the API layer over HTTP and never a
service/store/FUXA-runtime object directly (AC-16.1/16.3); the components depend on the
`UserAdminClient` / `RoleAdminClient` interfaces, not on `HttpClient` internals (AC-16.2); the
FUXA record/`info` shape stays server-side — the client consumes first-class `roles` (AC-16.5).

---

## 8. EXTEND vs SUPERSEDE the Existing FUXA Users UI

REQ-12 must be delivered against a codebase that **already has a user-management UI**. Per the
master map's *Physical Layout* note, this fork is decided per-section. Decision **D-011** (SUPERSEDE)
is **CONFIRMED** and applies here identically to the Login Page ([`07-ui-login-page.md`](./07-ui-login-page.md) §7).

### 8.1 What exists today (verified)

- `client/src/app/users/users.component.ts` + `.html` + `.scss`: a **routed** `UsersComponent`
  (route `users`, `canActivate: [AuthGuard]` in `app.routing.ts`) using `MatTableDataSource` /
  `MatSort`, columns `['select','username','fullname','groups','start','remove']`. It opens
  `UserEditComponent` as a **MatDialog** for create/edit and `ConfirmDialogComponent` for delete;
  it calls `UserService` (`_services/user.service.ts`), resolves role names when
  `settingsService.getSettings()?.userRole` is on, and has a coarse `isAdmin()` keyed to the
  `admin` username (verified).
- `client/src/app/users/user-edit/user-edit.component.ts` + `.html`: a MatDialog form
  (`UntypedFormGroup`: `username` required + uniqueness validator, `fullname`, `password`,
  FUXA-HMI `start`/`languageId`), disables `username` on edit, blanks password on open, maps
  selected role options to `role.id`, and serializes `info = JSON.stringify({ start, roles,
  languageId })` client-side (verified).
- `client/src/app/users/users-roles/` (+ `users-role-edit/`): the existing **role management**
  UI (route `userRoles`, verified in `app.routing.ts`).
- `client/src/app/_services/user.service.ts`: `getUsers` → `GET /api/users`; `setUser` →
  `POST /api/users` (upsert); `removeUser` → `DELETE /api/users` with `{param: username}`;
  `getRoles`/`setRole`/`removeRole` via the `ResourceStorageService` abstraction; `EndPointApi`
  base URL; toastr error notifications (verified).

### 8.2 Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **EXTEND** | Modify `app/users` + `UserEditComponent` + `UserService` in place to consume first-class `roles`, separate create/update, add last-admin handling, and a permission gate | Least new code; reuses table/dialog UX | Edits FUXA core UI files in place → high `git merge` conflict on FUXA upgrades (violates **D-003** intent, N-001); tangles REQ-12 with FUXA-HMI concerns (`start`, touch keyboard, `projectService`); dialog upsert model fights the module's create/update separation (§04) |
| **SUPERSEDE** (D-011, CONFIRMED) | New routed `UserManagementPage` + `UserAdminClient`/`RoleAdminClient` under `client/src/app/auth-management/user-management/`; **reuse** token store, `x-access-token` interceptor, and `AuthGuard` | Preserves module boundary (D-003); clean create/update separation and `last_admin` UX; new payload contract (D-007) isolated; existing UI untouched → low-conflict upgrades | More new files; two user-management surfaces coexist during migration ([§8.3](#83-migration-note)) |

### 8.3 Migration note

Following confirmed **D-011**: introduce the module-owned routed `UserManagementPage` and its
admin HTTP clients under `client/src/app/auth-management/user-management/`, and **do not** edit
`client/src/app/users/` in place. **Reuse — unchanged —** the generic session plumbing that is
not user-management-specific: the `sessionStorage` + `window.fuxaAccessToken` token store, the
`x-access-token` `AuthInterceptor`, and the `AuthGuard`
([`07-ui-login-page.md`](./07-ui-login-page.md) §5, verified).

During migration two user-management surfaces may coexist (FUXA's `users` route and the module's
routed page). The **tasks phase must choose the cutover**: either (a) point the navigation/route
for user management at the module's `UserManagementPage` and retire the FUXA `UsersComponent`/
`UserEditComponent`, or (b) keep the FUXA page as a fallback until the module page is verified.
The existing **role-management** UI (`users/users-roles/`) covers REQ-9's UI, which is out of
REQ-12's scope; whether it is likewise superseded is a REQ-9 concern to be decided when that UI
is designed, not here. This is an integration decision, not a REQ-12 acceptance-criteria change,
and is flagged for the ledger alongside D-011.

---

## 9. Accessibility & Security Posture

**Accessibility (WCAG-aligned; full validation still requires assistive-technology testing):**

- **Table semantics.** The user list uses proper table semantics (`<table>`/`role="table"` with
  header cells and a caption/`aria-label`) so screen readers announce columns (username, full
  name, roles) and row actions. Row action controls (Edit/Delete) have accessible names that
  include the target username.
- **Labeled form controls.** Create/edit form inputs have programmatic labels (`<label for>` /
  `aria-label`), not placeholder-only labeling; the role multi-select is keyboard-operable and
  labeled. Invalid fields set `aria-invalid` and reference their message via `aria-describedby`.
- **Confirm dialog for destructive delete.** Deletion is guarded by a modal confirmation
  (`role="dialog"`, focus-trapped, labelled title naming the user) so a destructive action is
  never a single accidental click (AC-12.5) and is announced to AT users.
- **Error announcement.** The page error region uses `role="alert"` with `aria-live="assertive"`
  so validation/authorization errors (AC-12.4/12.6) are announced when they appear.
- **Pending feedback.** Submit controls set `aria-busy` while pending and are natively `disabled`
  so keyboard/AT users perceive the in-flight state.

**Security posture (page-specific; refines the master map):**

- **No password hash is ever shown.** The list and forms render `UserView`, which structurally
  has **no** `password`/`passwordHash` field (§04 §2.1) — the hash cannot leak to the UI on any
  read path (AC-6.2). This is the client counterpart to FUXA's server-side `sanitizeUser` (which
  `delete`s `password`, verified) and the module's read-mapping exclusion (§04 §4.2).
- **Passwords never logged.** Neither the components nor the admin HTTP clients log form values,
  the password, or the token. (Contrast: FUXA's `UserService` logs `console.error(err)` on save
  failure — the module logs only a non-sensitive error identifier.)
- **Generic error messaging.** Errors are surfaced from stable identifiers via i18n keys, not
  server-provided strings; messages are generic ("username already exists", "last administrator
  cannot be deleted") and reveal no internal detail.
- **Authorization is server-enforced (defense in depth).** The client access gate (§6) is UX
  only; the server authorizes every request (§05), so a non-admin cannot read or mutate user data
  even if the client gate is bypassed (AC-12.6).
- **Disable-on-submit** prevents duplicate create/update requests from a double-click (§3.3).
- **Transport (N-002).** Per the master map, any non-localhost deployment must serve the client
  over TLS so the session token and `x-access-token` header are not sent in clear.

---

## 10. Testing Notes (REQ-12)

**PBT applicability for this section: NOT applicable.** REQ-12's acceptance criteria are UI
interaction and rendering behaviors (which columns are shown, whether a valid form submits,
whether an invalid form is blocked, whether the list refreshes/removes a row, whether a non-admin
is denied). These are best covered by **Angular component / example tests**, not property-based
tests — there is no meaningful "for all inputs X, property P(X)" over UI rendering that a handful
of example tests would not already find. This matches the master-map Table of Contents, where
**`DES-UI-USERS` owns no properties**, and the master-map Testing Strategy, which excludes
Angular UI from PBT. The universal properties this page *relies on* — the `User_Record`/`Role`
write→read round-trips **P-003**/**P-004** (owned by §06) and the authorization determinism
**P-006** (owned by §05) — are proven server-side and only referenced here.

> **New-property watch (flagged, no ID assigned).** One arguably universal client invariant
> exists: *for any create/edit form state, the submit control is enabled iff the form is valid
> and no request is pending.* Per the master-map decision that UI is covered by example/component
> tests, this is verified as a component test ([§10.1](#101-component--example-tests) item 4),
> **not** promoted to a PBT property. It is flagged here for review; no `P-***` ID is assigned by
> this section.

### 10.1 Component / example tests

Using Angular's `TestBed` + `HttpClientTestingModule` (and a `Router`/guard spy plus a permission
service double), with `UserAdminClient` / `RoleAdminClient` and the session store replaced by test
doubles so the component logic is isolated:

1. **AC-12.1 — list displayed with required columns.** Given the client resolves a `UserView[]`,
   the rendered list shows a row per user with `username`, full name, and roles (role ids
   resolved to names via the fetched `roles` options); assert **no** rendered cell/binding exposes
   a `password`/`passwordHash`.
2. **AC-12.2 — create sends then refreshes.** With a valid create form, activating submit calls
   `UserAdminClient.create` **once** with the trimmed values; on a success response the page calls
   `list()` again and the new user appears. With either required field empty the submit control is
   disabled and **no** request is made.
3. **AC-12.3 — edit sends update then refreshes; password-optional.** For a listed user, editing
   and submitting calls `UserAdminClient.update(username, req)` once and refreshes on success; (a)
   leaving password empty produces an `UpdateUserRequest` that **omits** `password`; (b) typing a
   password includes it; (c) selected role ids are sent as `roles`.
4. **AC-12.4 — invalid inputs blocked + validation invariant.** For an invalid create form
   (empty/whitespace username) and an invalid edit form, the page shows a validation error and
   `UserAdminClient.create`/`update` is **never** called. Parameterized examples over
   {valid, invalid} × {pending true/false} assert `submit.disabled === !(form.valid && !pending)`.
5. **AC-12.5 — confirm→delete→remove; cancel→no-op.** Activating Delete opens the confirm dialog;
   **cancelling** issues no request; **confirming** calls `UserAdminClient.remove(username)` once
   and, on success, removes exactly that row from the displayed list (other rows unchanged).
6. **AC-12.5 error handling — `last_admin` and `user_not_found`.** A `400 last_admin` response
   keeps the row and shows the last-administrator message (no list mutation); a `404
   user_not_found` shows the "no longer exists" message and refreshes the list.
7. **AC-12.6 — non-admin denied.** With the permission double reporting **no** `user.read`, the
   page sets `access = 'denied'`, renders the authorization error, and issues **no** `list()`
   request. With `user.read` present, the list loads normally. Additionally, a `401`/`403` on the
   initial `list()` (server path) drives the same `access = 'denied'` rendering.

### 10.2 Integration / example tests (admin HTTP clients)

With `HttpClientTestingModule` asserting the wire contract against §04/§05:

- `list()` maps a `200 { status:'success', data: UserView[] }` to `UserView[]` with first-class
  `roles` (no `info` parsing, no hash field).
- `create()`/`update()` `POST`/`PUT` `/api/users` with only the listed request fields and map a
  `200 { data: UserView }` to `UserView`; a `400 { error:'duplicate_username' | 'missing_field' |
  'validation_error' }`, a `404 { error:'user_not_found' }`, and a `400 { error:'last_admin' }`
  each map to the corresponding `AdminError.errorId`.
- `remove()` issues `DELETE /api/users/:username` and maps `200 { status:'success' }` to void; a
  `400 last_admin` / `404 user_not_found` map to `AdminError`.
- `RoleAdminClient.list()` maps `GET /api/roles` `Role[]` to `RoleOption[] { id, name }`.
- All requests carry the `x-access-token` header (via the reused interceptor); a `401`/`403` maps
  to `unauthorized_error`/`forbidden`.

These tests verify UI behavior and the client↔API wire contract; exhaustive CRUD-decision and
round-trip coverage (P-003/P-004/P-006) lives in the server sections §04/§05/§06.

---

## 11. Traceability (this section)

| AC | Behavior | Verified FUXA anchor | Test type |
|----|----------|----------------------|-----------|
| AC-12.1 | Admin opens page → display user list with username / full name / roles | `UsersComponent` `MatTableDataSource` + `permissionValueToLabel` role-name resolution (`users.component.ts`); `GET /api/users` (`_services/user.service.ts`) | component/example + integration |
| AC-12.2 | Valid create-user form → send create + refresh list on success | `editUser` → `userService.setUser` then `loadUsers()` refresh (`users.component.ts`); `POST /api/users` (create separated per §04) | component/example |
| AC-12.3 | Edit-user form → send update + refresh on success (password-optional, roles) | `UserEditComponent` blank-password-on-open + role-id mapping (`user-edit.component.ts`); retain-on-omit AC-7.3 (§04 §5.2) | component/example |
| AC-12.4 | Invalid inputs → show validation error, do NOT send | `UntypedFormGroup` `Validators.required` + `isValidUserName()` uniqueness (`user-edit.component.ts`) | component/example |
| AC-12.5 | Confirm delete → send delete + remove from list on success; handle `last_admin`/`user_not_found` | `onRemoveUser` → `ConfirmDialogComponent` then `removeUser` + array filter (`users.component.ts`); `DELETE /api/users`; last-admin guard (§04 §6.5 / D-009) | component/example + integration |
| AC-12.6 | Non-admin opens page → deny access + authorization error | `AuthGuard.canActivate` (`auth.guard.ts`, route `users` in `app.routing.ts`); server `haveAdminPermission` → 401 on `GET /api/users` (`server/api/users/index.js`), replaced by permission-based 401/403 (§05) | component/example + integration |

No orphan criteria: AC-12.1 … AC-12.6 each map to at least one test above. This section maps back
to REQ-12 only, matching [`../decisions/traceability.md`](../decisions/traceability.md) §A/§B
(`DES-UI-USERS → REQ-12`), and owns no correctness properties (consistent with the master-map
Table of Contents; P-003/P-004 owned by §06, P-006 by §05, last-admin candidate P-010 by §04+§12
— all referenced, none minted here).

---

## 12. Open Items / Flags for the Ledger

- **D-011 (EXTEND vs SUPERSEDE): CONFIRMED — SUPERSEDE** the existing `app/users` UI with a
  module-owned routed `UserManagementPage` + `UserAdminClient`/`RoleAdminClient` under
  `auth-management/user-management/`, reusing the token store, `x-access-token` interceptor, and
  `AuthGuard` ([§8](#8-extend-vs-supersede-the-existing-fuxa-users-ui)).
- **Migration cutover** (route user management to the module page vs. keep FUXA `UsersComponent`
  as fallback) to be settled at Tasks ([§8.3](#83-migration-note)).
- **Role-management UI scope.** The existing `users/users-roles/` UI serves REQ-9 (role CRUD),
  which is **out of REQ-12 scope**; whether it is likewise superseded is a REQ-9 UI decision, not
  made here — flagged.
- **Self-deletion of a non-last administrator.** The page currently allows an admin to delete any
  non-last admin (including their own account), consistent with §04 §8.3's open item; if review
  adds a self-deletion restriction, the delete flow ([§5](#5-delete-flow-ac-125)) surfaces it as
  another stable error id — flagged, not invented here.
- **New-property watch** (submit-enabled invariant) flagged in [§10](#10-testing-notes-req-12)
  with **no `P-***` ID assigned**, per the master-map decision that UI uses example/component
  tests.
