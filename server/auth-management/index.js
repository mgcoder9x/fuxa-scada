//@ts-check
'use strict';

/**
 * Composition root of the auth-management module (PLACEHOLDER).
 *
 * Task 13.5 (D-014) will wire this up: instantiate the adapters → services (Password_Hasher,
 * Token_Service, brute-force guard, Audit_Logger, Refresh_Token_Store, User/Role stores), run
 * `runBootstrap` at startup, and export the mounted router that SUPERSEDES FUXA's overlapping
 * `/api/signin`, `/api/refresh`, `/api/signout`, `/api/users`, `/api/roles` handlers.
 *
 * It is intentionally an unimplemented stub for now so that requiring this file does not pull in
 * any not-yet-built dependency. Calling the factory before Task 13.5 fails loudly.
 */
function createAuthManagementModule(/* deps */) {
  throw new Error('not_implemented:createAuthManagementModule (wired in Task 13.5)');
}

module.exports = { createAuthManagementModule };
