# Requirements Document

## Introduction

This document specifies the requirements for the **Authentication and User Management module with Role-Based Access Control (RBAC)** — the first core module of a large, deeply modular system being scaffolded inside the FUXA workspace.

The module provides three capabilities, layered as clearly separated sub-modules:

1. **Authentication** — a login page and the services that verify credentials and issue session tokens.
2. **User Management** — full CRUD (create, read, update, delete) for user accounts through a dedicated management page.
3. **Authorization (RBAC)** — roles, permissions, and enforcement of access control across the module's operations.

**Scope assumption (to confirm during review):** This module is designed as a *self-contained, deeply layered subsystem* living inside the FUXA workspace. It reuses primitives already present in FUXA (JSON Web Token issuance, `bcrypt` password hashing, a user/role persistence store) but organizes its own logic into cleanly separated modules (UI layer, API layer, service layer, store layer) so it can grow into a large system and, later, integrate with or replace FUXA's existing auth path. If instead the intent is to extend FUXA's existing `server/api/auth` and `server/runtime/users` code in place without a new modular boundary, note this during review and the requirements will be adjusted.

The requirements below emphasize **testability**: acceptance criteria are written to be measurable and verifiable, and serialization boundaries include explicit round-trip properties.

## Glossary

- **Authentication_Service**: The module component that verifies submitted credentials against stored user records and initiates a session.
- **Token_Service**: The module component that issues, signs, validates, and refreshes session tokens (access tokens and refresh tokens).
- **User_Service**: The module component that performs create, read, update, and delete operations on user accounts.
- **Role_Service**: The module component that performs create, read, update, and delete operations on roles.
- **Authorization_Service**: The module component that decides whether an authenticated identity is permitted to perform a requested operation, based on the identity's roles and the permissions those roles grant.
- **Password_Hasher**: The module component that converts a plaintext password into a one-way salted hash and verifies a plaintext password against a stored hash.
- **User_Store**: The persistence component that stores and retrieves user records.
- **Role_Store**: The persistence component that stores and retrieves role records.
- **Audit_Logger**: The module component that records security-relevant events (sign-in, sign-out, user changes, role changes, authorization denials).
- **Login_Page**: The user interface through which a person submits credentials to authenticate.
- **User_Management_Page**: The user interface through which an authorized administrator manages user accounts and role assignments.
- **User_Record**: A stored account consisting of a unique username, a display full name, a password hash, a set of assigned roles, and an optional metadata object.
- **Role**: A named collection of permissions that can be assigned to users.
- **Permission**: A named capability (for example, `user.create`) that gates a specific operation.
- **Access_Token**: A short-lived signed token that authenticates API requests.
- **Refresh_Token**: A longer-lived signed token used to obtain a new Access_Token without re-entering credentials.
- **Administrator**: An authenticated user whose assigned roles grant user-management and role-management permissions.
- **Session**: The authenticated context established after a successful sign-in, represented by a valid Access_Token.

## Requirements

### Requirement 1: User Authentication (Login)

**User Story:** As a registered user, I want to sign in with my username and password, so that I can obtain an authenticated session.

#### Acceptance Criteria

1. WHEN a sign-in request is received with a username and password that match a stored User_Record, THE Authentication_Service SHALL return a success response containing an Access_Token, the username, the full name, and the assigned roles.
2. IF a sign-in request is received with a username that has no matching User_Record, THEN THE Authentication_Service SHALL return the **same** HTTP status 401 and the **same** response body as a wrong-password failure (AC-1.3), and SHALL NOT return an Access_Token, so the response does not reveal whether the username exists. *(Refined by DV-006: was HTTP 404; unified to 401 to remove the username-enumeration oracle.)*
3. IF a sign-in request is received with a username that matches a stored User_Record but a password that does not match the stored password hash, THEN THE Authentication_Service SHALL return a response with HTTP status 401 and a generic error body (identical to the unknown-username case, AC-1.2) and SHALL NOT return an Access_Token; AND to avoid a timing oracle, THE Authentication_Service SHALL perform a comparable-cost password comparison (against a dummy hash) even when the username is unknown. *(Refined by DV-006: unknown-user and bad-password are made indistinguishable in both status/body and timing.)*
4. IF a sign-in request is received that is missing either the username field or the password field, THEN THE Authentication_Service SHALL return a response with HTTP status 400 and an error identifier.
5. WHEN the Authentication_Service verifies a submitted password, THE Authentication_Service SHALL delegate comparison to the Password_Hasher and SHALL NOT compare plaintext passwords directly.

### Requirement 2: Session Token Issuance and Validation

**User Story:** As an authenticated user, I want my session represented by a signed token, so that subsequent requests are authenticated without resending my password.

#### Acceptance Criteria

1. WHEN the Authentication_Service authenticates a user successfully, THE Token_Service SHALL issue an Access_Token that encodes the username and the assigned roles.
2. THE Token_Service SHALL sign every issued Access_Token with the configured secret.
3. WHEN a request presents an Access_Token whose signature is valid and whose expiry time is in the future, THE Token_Service SHALL report the request as authenticated and SHALL expose the encoded username and roles to downstream components.
4. IF a request presents an Access_Token whose signature is invalid, THEN THE Token_Service SHALL report the request as not authenticated.
5. IF a request presents an Access_Token whose expiry time is in the past, THEN THE Token_Service SHALL report the request as not authenticated.
6. WHERE token expiry is configured, THE Token_Service SHALL set the Access_Token expiry to the configured duration.
7. WHERE no token expiry duration is configured AND non-expiring token mode is not explicitly enabled, THE Token_Service SHALL set the Access_Token expiry to a safe default duration of 1 hour.
8. WHERE non-expiring token mode is explicitly enabled as a development-only setting, THE Token_Service SHALL issue Access_Tokens that do not expire.

### Requirement 3: Token Refresh and Sign-Out

**User Story:** As an authenticated user, I want to refresh my session and sign out, so that I can stay signed in securely and end my session when finished.

#### Acceptance Criteria

1. WHERE refresh-token authentication is enabled, WHEN a user authenticates successfully, THE Token_Service SHALL issue a Refresh_Token and SHALL store it in an HttpOnly cookie.
2. WHERE refresh-token authentication is enabled, WHEN a refresh request presents a valid Refresh_Token, THE Token_Service SHALL issue a new Access_Token and a new Refresh_Token.
3. IF a refresh request presents a Refresh_Token that is missing, expired, or invalid, THEN THE Token_Service SHALL return a response with HTTP status 401 and SHALL clear the Refresh_Token cookie.
4. WHEN a sign-out request is received, THE Authentication_Service SHALL clear the Refresh_Token cookie and SHALL return a response with HTTP status 204.

### Requirement 4: Password Security

**User Story:** As a security-conscious operator, I want passwords stored only as salted one-way hashes, so that stored credentials cannot be read even if the store is exposed.

#### Acceptance Criteria

1. WHEN a User_Record is created or its password is changed, THE Password_Hasher SHALL convert the plaintext password into a salted one-way hash before the User_Store persists the record.
2. THE User_Store SHALL persist only the password hash and SHALL NOT persist the plaintext password.
3. WHEN the Password_Hasher hashes the same plaintext password twice, THE Password_Hasher SHALL produce two hashes that each verify successfully against that plaintext password.
4. WHEN the Password_Hasher verifies a plaintext password against a hash produced from that same plaintext password, THE Password_Hasher SHALL report a successful match.
5. WHEN the Password_Hasher verifies a plaintext password against a hash produced from a different plaintext password, WHERE both passwords are within the accepted password domain (UTF-8 byte length not exceeding 72 bytes, per AC-4.6), THE Password_Hasher SHALL report a failed match.
6. IF a password submitted for account creation or password change has a UTF-8 byte length exceeding 72 bytes, THEN THE User_Service SHALL reject it with a validation error and SHALL NOT hash or persist it. (Rationale: bcrypt truncates input beyond 72 bytes, so without this bound two distinct passwords that share their first 72 bytes would verify interchangeably — see DV-007 / N-012.)
7. IF a password submitted for account creation or password change is shorter than the configured minimum length (default 12 characters; NIST SP 800-63B-4 recommends at least 15 for single-factor authentication) OR appears on the configured common-password blocklist, THEN THE User_Service SHALL reject it with a validation error and SHALL NOT persist the account change.

### Requirement 5: Create User

**User Story:** As an administrator, I want to create new user accounts, so that new people can access the system.

#### Acceptance Criteria

1. WHEN the User_Service receives a create request with a username, a full name, a password, and a set of roles from an Administrator, THE User_Service SHALL create a User_Record and SHALL return a success response.
2. IF the User_Service receives a create request with a username that already exists in the User_Store, THEN THE User_Service SHALL reject the request with an error identifying the duplicate username and SHALL NOT modify the existing User_Record.
3. IF the User_Service receives a create request that is missing the username field, THEN THE User_Service SHALL reject the request with a validation error.
4. WHEN the User_Service creates a User_Record, THE User_Service SHALL store the password only as a hash produced by the Password_Hasher.

### Requirement 6: List and View Users

**User Story:** As an administrator, I want to list and view user accounts, so that I can review who has access.

#### Acceptance Criteria

1. WHEN the User_Service receives a list request from an Administrator, THE User_Service SHALL return every stored User_Record with username, full name, and assigned roles equal to the values held in the User_Store.
2. WHEN the User_Service returns a User_Record, THE User_Service SHALL exclude the password hash from the returned data.
3. WHEN the User_Service receives a request for a single username that exists, THE User_Service SHALL return the exact matching User_Record with its stored username, full name, and assigned roles.
4. IF the User_Service receives a request for a single username that does not exist, THEN THE User_Service SHALL return an empty result.

### Requirement 7: Update User

**User Story:** As an administrator, I want to update user accounts, so that I can change names, passwords, and role assignments.

#### Acceptance Criteria

1. WHEN the User_Service receives an update request from an Administrator for an existing username, THE User_Service SHALL apply the submitted full name, roles, and metadata to the matching User_Record.
2. WHERE an update request includes a new password, THE User_Service SHALL store the new password only as a hash produced by the Password_Hasher.
3. WHERE an update request omits the password field, THE User_Service SHALL retain the existing password hash of the matching User_Record.
4. IF the User_Service receives an update request for a username that does not exist, THEN THE User_Service SHALL reject the request with an error identifying the missing username.
5. IF the User_Service receives an update request for an existing username that fails validation or authorization, THEN THE User_Service SHALL reject the request with an error identifying the cause and SHALL NOT modify the matching User_Record.

### Requirement 8: Delete User

**User Story:** As an administrator, I want to delete user accounts, so that I can revoke access for people who should no longer have it.

#### Acceptance Criteria

1. WHEN the User_Service receives a delete request from an Administrator for an existing username, THE User_Service SHALL remove the matching User_Record from the User_Store and SHALL return a success response.
2. WHEN the User_Service removes a User_Record, THE User_Service SHALL also remove that user from any in-memory permission cache.
3. IF the User_Service receives a delete request for a username that does not exist, THEN THE User_Service SHALL return an error identifying the missing username.
4. WHEN a User_Record has been deleted, THE Authentication_Service SHALL reject subsequent sign-in requests for that username with the same generic HTTP status 401 response as any other unknown username (per AC-1.2). *(Refined by DV-006 in lockstep with AC-1.2: was HTTP 404; a deleted username is now indistinguishable from a never-existing one.)*
5. IF the User_Service receives a delete request for the last remaining administrator account, THEN THE User_Service SHALL reject the request with an error identifying that the last administrator cannot be deleted and SHALL NOT remove the account.

### Requirement 9: Role Management (RBAC)

**User Story:** As an administrator, I want to define roles and the permissions they grant, so that I can control access by assigning roles instead of individual permissions.

#### Acceptance Criteria

1. WHEN the Role_Service receives a create request from an Administrator with a role name and a set of permissions, THE Role_Service SHALL persist the Role in the Role_Store.
2. WHEN the Role_Service receives a list request from an Administrator, THE Role_Service SHALL return every stored Role with its name and permissions.
3. WHEN the Role_Service receives an update request from an Administrator for an existing Role, THE Role_Service SHALL replace that Role's permission set with the submitted permission set.
4. WHEN the Role_Service receives a delete request from an Administrator for existing Roles, THE Role_Service SHALL remove those Roles from the Role_Store and SHALL remove the deleted Role identifiers from every User_Record that referenced them.
5. IF the Role_Service receives a create request with a role name that already exists, THEN THE Role_Service SHALL reject the request with an error identifying the duplicate role name.

### Requirement 10: Authorization Enforcement

**User Story:** As a system owner, I want each protected operation to require a specific permission, so that users can only perform actions their roles allow.

#### Acceptance Criteria

1. WHEN an authenticated identity requests a protected operation and at least one of the identity's assigned roles grants the Permission required by that operation, THE Authorization_Service SHALL allow the operation.
2. IF an authenticated identity requests a protected operation and none of the identity's assigned roles grants the Permission required by that operation, THEN THE Authorization_Service SHALL deny the operation with HTTP status 403.
3. IF an unauthenticated request targets a protected operation, THEN THE Authorization_Service SHALL deny the operation with HTTP status 401.
4. WHERE an identity holds an administrator role, THE Authorization_Service SHALL allow user-management and role-management operations.
5. WHEN the Authorization_Service evaluates the same identity against the same operation more than once without any change to the identity's roles or the roles' permissions, THE Authorization_Service SHALL return the decision it produced on the first evaluation.

### Requirement 11: Login Page

**User Story:** As a user, I want a login page, so that I can enter my credentials and sign in.

#### Acceptance Criteria

1. THE Login_Page SHALL present a username input, a password input, and a submit control.
2. WHEN a user submits the Login_Page with both fields populated, THE Login_Page SHALL send a sign-in request to the Authentication_Service.
3. WHEN the Authentication_Service returns a success response, THE Login_Page SHALL store the returned Access_Token and SHALL navigate the user to the authenticated area.
4. IF the Authentication_Service returns an error response, THEN THE Login_Page SHALL display an error message and SHALL keep the user on the Login_Page.
5. WHILE a submitted sign-in request is awaiting a response, THE Login_Page SHALL disable the submit control.

### Requirement 12: User Management Page

**User Story:** As an administrator, I want a user management page, so that I can perform CRUD operations and role assignments through a UI.

#### Acceptance Criteria

1. WHEN an Administrator opens the User_Management_Page, THE User_Management_Page SHALL display the list of users with username, full name, and assigned roles.
2. WHEN an Administrator submits the create-user form with valid inputs, THE User_Management_Page SHALL send a create request to the User_Service and SHALL refresh the displayed list on success.
3. WHEN an Administrator submits the edit-user form for a user shown in the displayed list, THE User_Management_Page SHALL send an update request to the User_Service and SHALL refresh the displayed list on success.
4. IF an Administrator submits the create-user form or the edit-user form with invalid inputs, THEN THE User_Management_Page SHALL display a validation error and SHALL NOT send the request to the User_Service.
5. WHEN an Administrator confirms deletion of a user, THE User_Management_Page SHALL send a delete request to the User_Service and SHALL remove that user from the displayed list on success.
6. IF a user who is not an Administrator opens the User_Management_Page, THEN THE User_Management_Page SHALL deny access and SHALL display an authorization error.

### Requirement 13: User and Role Serialization Round-Trip

**User Story:** As a developer, I want user and role records to survive storage and retrieval without loss, so that data remains correct across persistence boundaries.

#### Acceptance Criteria

1. WHEN a User_Record is written to the User_Store and then read back, THE User_Store SHALL return a User_Record whose username, full name, roles, and metadata are equal to the written values.
2. WHEN a Role is written to the Role_Store and then read back, THE Role_Store SHALL return a Role whose name and permission set are equal to the written values.
3. WHEN the module serializes a User_Record's metadata object to its stored string form and then deserializes that stored form, THE module SHALL produce a metadata object equal to the original metadata object (round-trip property).
4. IF the module attempts to deserialize a stored metadata string that is not valid serialized form, THEN THE module SHALL report a descriptive error and SHALL NOT terminate the containing operation for unrelated records.

### Requirement 14: Security Audit Logging

**User Story:** As a system owner, I want security-relevant events recorded, so that I can audit access and changes.

#### Acceptance Criteria

1. WHEN the Authentication_Service completes a sign-in attempt, THE Audit_Logger SHALL record the username, the outcome, and the time of the attempt.
2. WHEN the User_Service creates, updates, or deletes a User_Record, THE Audit_Logger SHALL record the operation, the affected username, and the time.
3. WHEN the Role_Service creates, updates, or deletes a Role, THE Audit_Logger SHALL record the operation, the affected role name, and the time.
4. WHEN the Authorization_Service denies an operation, THE Audit_Logger SHALL record the identity, the requested operation, and the time.
5. THE Audit_Logger SHALL record only the fields supplied by the calling service, and each calling service SHALL sanitize plaintext passwords and password hashes out of event data before sending the event to the Audit_Logger.

### Requirement 15: Brute-Force Protection

**User Story:** As a system owner, I want repeated failed sign-in attempts to be throttled, so that password-guessing attacks are slowed.

#### Acceptance Criteria

1. WHILE the count of consecutive failed sign-in attempts for a username is below the configured threshold, THE Authentication_Service SHALL process each sign-in attempt normally.
2. IF the count of consecutive failed sign-in attempts for a username reaches the configured threshold, THEN THE Authentication_Service SHALL apply an adaptive throttle to further sign-in attempts for that username — rejecting them with HTTP status 429 and a `retryAfter` hint that increases with continued failures (exponential backoff) up to an optional configured maximum interval — rather than a single fixed-duration hard lockout. *(Refined by DV-008: adaptive throttling replaces the hard fixed-duration lockout to resist attacker-induced lockout of a legitimate operator, per NIST SP 800-63B; a configured maximum interval MAY still bound the backoff.)*
3. WHERE the configured threshold is zero, THE Authentication_Service SHALL reject every sign-in attempt for every username with HTTP status 429.
4. WHEN a sign-in attempt for a username succeeds, THE Authentication_Service SHALL reset the consecutive failed-attempt count and the adaptive-throttle interval for that username to zero.
5. WHEN the current adaptive-throttle interval for a username elapses without a further failed attempt, THE Authentication_Service SHALL again process sign-in attempts for that username normally.
6. WHERE the deployment runs more than one Authentication_Service instance, THE brute-force counter state SHALL be resolvable from a shared store so that the effective threshold is not multiplied by the instance count; AND the adaptive throttle SHALL be bounded (each individual block interval finite, cleared on success or interval elapse) so that a party who knows a username cannot lock out the legitimate operator indefinitely. *(Added by DV-008 + N-019: multi-instance consistency and targeted-DoS resistance.)*

### Requirement 16: Modular Architecture

**User Story:** As an architect of a large system, I want authentication, user management, and authorization organized as clearly separated modules, so that the system can scale and each concern can evolve independently.

#### Acceptance Criteria

1. THE module SHALL separate the user interface layer, the API layer, the service layer, and the store layer into distinct components.
2. THE Authentication_Service, the User_Service, the Role_Service, and the Authorization_Service SHALL each expose their capability through a defined interface that hides its storage details from callers.
3. WHEN a caller invokes the API layer, THE API layer SHALL delegate business logic to the service layer and SHALL NOT access the User_Store or Role_Store directly.
4. IF the service layer is unavailable when the API layer receives a request, THEN THE API layer SHALL fail the request immediately with an error response.
5. WHERE the store layer implementation changes, THE service layer interfaces SHALL remain unchanged.

### Requirement 17: Administrator Bootstrap (First-Run Seeding)

**User Story:** As a system owner, I want a first administrator to exist safely on first run, so that user and role management can begin without a chicken-and-egg problem and without a lingering known-default credential.

#### Acceptance Criteria

1. WHEN the system starts AND the User_Store contains no administrator account, THE system SHALL create exactly one default Administrator account.
2. WHILE a seeded default Administrator has not completed a password rotation, THE Authorization_Service SHALL deny that account every protected operation except the password-rotation operation.
3. WHEN the seeded default Administrator completes a password rotation, THE system SHALL grant that account its administrator permissions.
4. WHERE the User_Store already contains at least one administrator account at startup, THE system SHALL retain the existing administrator accounts and SHALL create no default Administrator account.
5. WHEN the system creates a default Administrator account, THE Audit_Logger SHALL record the bootstrap seeding event, the affected username, and the time.
