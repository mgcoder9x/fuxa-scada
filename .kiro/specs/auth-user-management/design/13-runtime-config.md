# Design Section 13 — Runtime Configuration of the Auth Module (D-049)

> Status: **PROPOSED (design-first, pending user validation before code)** — 2026-07-17.
> Owner decision: D-049. Enacts the user requirement "mọi cấu hình đều được cấu hình runtime trừ
> giao diện" (all configuration runtime-configurable except the UI). Safety approach = "Hướng B"
> (module-owned; near-zero FUXA-core footprint). Every claim below is verified against source and
> cited; nothing is speculative.

---

## 1. Goal, scope, and non-goals

**Goal.** Let an administrator change the auth module's operational policy **at runtime** — through a
module-owned admin page — with the change taking effect **without a server restart** and **without
editing `settings.js`** (which is the engineer-only, restart-required path today).

**In scope (runtime-configurable):** the `settings.auth.*` policy block — password policy,
brute-force throttling, and token/JWT policy — plus `bcryptCost`.

**Out of scope, and WHY (verified):**
- `authModuleEnabled` (the D-014 SUPERSEDE mount) — decided ONCE at `server/api/index.js` init
  (`const authModuleEnabled = runtime.settings.authModuleEnabled === true;`). Live router remount is
  exactly the N-071 hazard (module build race → `apiApp` undefined → `main.js` crash). **Stays a
  restart-gated deployment switch.** Documented, not hot-swapped.
- `secureEnabled` — toggles the whole FUXA auth pipeline mounting; FUXA ALREADY restarts on this via
  `POST /api/settings` (verified `server/api/index.js` mergeUserSettings re-init block). Not module scope.
- `secretCode` — the JWT signing **secret** (sourced from FUXA `jwt-helper`, shared). It is a secret,
  not ordinary config; per D-022 posture secrets are never displayed/edited in a normal config UI.
  Stays in FUXA's existing secure settings path.
- `bootstrapAdminUsername`, enrollment tunables — consumed ONCE by `runBootstrap` at first run
  (verified `bootstrap.js`); changing them later has no effect. Exposed **read-only** at most.

**Non-goal:** editing FUXA's built-in Settings dialog (`client/src/app/editor/app-settings/*`). The UI
is a NEW module-owned page (Hướng B), so FUXA-core client stays untouched except one additive route.

---

## 2. Config surface + per-field classification (verified against source)

Each field is classified by HOW its consuming service reads it today (verified by reading the
services), which determines whether it is hot-swappable and what the apply step must do.

| Field | Consumer (verified) | Read pattern today | Hot-swap mechanism | Retroactive? |
|-------|---------------------|--------------------|--------------------|--------------|
| `passwordMinLength` | `UserService`, `AccountService` | snapshot `this.passwordPolicy = resolvePasswordPolicy(settings)` at construction | add `setPasswordPolicy(policy)` setter (re-resolve) | No — only new create/update/rotate |
| `passwordBlocklist` | same | same snapshot | same setter | No |
| `bruteForce.threshold` / `baseThrottleMs` / `backoffFactor` / `maxThrottleMs` / `failureWindowMs` | `BruteForceGuard` | instance fields set in constructor; logic reads `this.*` live | add `reconfigure(cfg)` setter (updates fields) | Applies to next decision; in-flight counters retained |
| `tokenExpiresIn` | `TokenService._resolveAccessExpiry()` | reads `this.settings.tokenExpiresIn` **live per call** | mutate `tokenService.settings` in place | No — only newly issued tokens |
| `refreshTokenExpiresIn` | `TokenService.issueRefreshToken` | `this.settings.refreshTokenExpiresIn` live | same | No |
| `jwtIssuer` / `jwtAudience` | `TokenService._signOptions()` + `verify()` | `this.settings.*` live | same | **Yes (careful)** — changing these makes existing tokens fail `verify` → users must re-login |
| `jwtAlgorithm` | `TokenService._algorithm()` | `this.settings.algorithm` live | same | **Yes (careful)** — same re-login effect |
| `bcryptCost` | `BcryptHasherAdapter` | baked into adapter at construction; **cost is embedded in each hash** | add `setCost(n)` on adapter/hasher | No — old hashes still verify (bcrypt embeds cost, D-008) |

**Key safety fact (verified):** `TokenService` already reads its `settings` object live on every
issue/verify, so mutating that object hot-swaps token policy with zero refactor. The other three
(`passwordPolicy`, `BruteForceGuard`, bcrypt cost) snapshot at construction and get small, additive
`reconfigure`/setter methods — all inside the module.

**Fields that invalidate existing sessions when changed** (`jwtIssuer`, `jwtAudience`, `jwtAlgorithm`,
and — if ever exposed — `secretCode`): NOT a brick (users simply re-login), but the UI MUST warn
"changing this signs out all active sessions". Classified as "careful" above.

---

## 3. Architecture (Hướng B — module-owned, near-zero FUXA-core)

```
 Admin browser                         FUXA server (only when authModuleEnabled = true)
 ┌──────────────────────────┐          ┌──────────────────────────────────────────────┐
 │ /auth/settings (NEW,      │  GET/PUT │  module router (already mounted at SUPERSEDE)  │
 │  standalone module page)  │ ───────▶ │   └─ NEW /api/auth/config  (requirePermission)│
 │  AuthConfigClient         │          │        ├─ AuthConfigService.get()             │
 └──────────────────────────┘          │        └─ AuthConfigService.apply(patch)       │
                                        │             ├─ validate (strict, safe-default) │
                                        │             ├─ persist → auth_config table     │
                                        │             ├─ applyToServices()               │
                                        │             │    • tokenService.settings = …   │
                                        │             │    • bruteForceGuard.reconfigure │
                                        │             │    • userSvc/acctSvc.setPolicy    │
                                        │             │    • hasher.setCost               │
                                        │             └─ auditLogger.record(config.update)│
                                        └──────────────────────────────────────────────┘
```

**New components (all inside `server/auth-management/**` + `client/src/app/auth-management/**`):**
- **`AuthConfigStore`** (server, module) — a single-row, JSON-valued, versioned table `auth_config`
  in the existing module DB (`FuxaAuthDb`). Additive schema (like `RefreshTokenStore.ensureSchema()`).
- **`AuthConfigService`** (server, module) — `get()`, `validate(patch)`, `apply(patch)`. Owns the
  merge/precedence, validation, persistence, live-apply orchestration, and audit.
- **`createAuthConfigRouter`** (server, module) — `GET /api/auth/config` (gate `settings.read`),
  `PUT /api/auth/config` (gate `settings.manage`), mounted inside the module router.
- **Service reconfigure seams** (server, module, additive): `BruteForceGuard.reconfigure(cfg)`,
  `UserService.setPasswordPolicy(p)` + `AccountService.setPasswordPolicy(p)`, `Password_Hasher`/
  `BcryptHasherAdapter.setCost(n)`. `TokenService` needs none (mutate its live `settings`).
- **Client:** `AuthConfigClient` (HTTP, module), a standalone `/auth/settings` page + presenter
  (DV-010 pattern), and a nav tab in the existing `AuthNavComponent` (module file).

## 4. Persistence & precedence (fail-safe)

1. **Baseline default:** `settings.auth.*` from `settings.js` (engineer/infra baseline). Unchanged path.
2. **Runtime override:** the `auth_config` row (module DB). Written ONLY via `PUT /api/auth/config`.
3. **Effective config = deep-merge(baseline, override)** — override wins per-field; absent fields
   fall through to baseline; baseline absent → hardcoded safe defaults (the `DEFAULT_*` constants
   already in `password-policy.js`, `brute-force.js`, `token.service.js`).
4. **On module build** (`createAuthManagementModule`): load baseline, overlay persisted override,
   construct services with the effective values (so a restart also honors the runtime override).
5. **Fail-safe load (P-019):** a missing/corrupt `auth_config` row → log + use baseline/defaults;
   the module MUST still build (never crash — same discipline as the N-071 fail-safe).
6. **"Reset to defaults"** = delete the override row → next apply/build falls back to baseline.

`settings.js` is NEVER rewritten by this feature (keeps FUXA's settings file clean; avoids touching
FUXA's settings-write path — a deliberate D-003 boundary choice).

## 5. Security

- **Authorization:** add two permissions `settings.read`, `settings.manage` to the catalog and to
  `ADMIN_PERMISSION_SET` (admins inherit them; other roles can be granted explicitly). Exactly the
  additive pattern D-046 used for `role.read`. Routes gated by the existing `requirePermission`.
- **Strict validation (P-018), reject → 400, no partial apply:**
  - `passwordMinLength` ∈ [8, 128] (bounded so it can neither weaken policy below 8 nor lock out via
    an absurd minimum); only affects NEW passwords, existing users unaffected.
  - `bcryptCost` ∈ [10, 15] (≥ FUXA's 10, D-008; capped to avoid a login-CPU DoS).
  - `bruteForce.threshold` ≥ 0 integer; `*Ms` fields finite ≥ 0; `backoffFactor` ≥ 1.
  - `tokenExpiresIn`/`refreshTokenExpiresIn` — valid positive number (s) or `jsonwebtoken` duration
    string; reject 0/negative/garbage.
  - `passwordBlocklist` — array of strings (bounded length).
  - `jwtIssuer`/`jwtAudience` — string or null; `jwtAlgorithm` ∈ allowed HS/RS set.
- **Never-brick invariants:** validation caps above + the "careful" fields only force re-login (not a
  lockout) + fail-safe load. A rejected PUT leaves the live config byte-identical (atomic apply).
- **Secrets excluded:** `secretCode` is never read from or written by this surface.
- **Audit:** every successful/failed apply emits an `Audit_Logger` event (actor, changed keys — NOT
  values for sensitive fields, outcome, timestamp) — reuses §09 sink.

## 6. FUXA-core footprint (exact) + flag-gating

**Server FUXA-core edits:** target = **0 hot-path edits**. The new `/api/auth/config` route lives in
the module router (module code), which is already mounted via `mountDeferredAuthModule`. The ONLY
possible core touch is a **1-line** addition of `'/api/auth'` to the existing `AUTH_MODULE_PATHS`
array (so config calls also return the fail-safe 503 during module init) — that array is part of the
already-added SUPERSEDE seam, not a new concern. `buildAuthModule` already passes `settings.auth`; it
gains the persisted-override overlay (module-side). **Verified:** with `authModuleEnabled = false`
none of this loads (the module is never built) → OFF path byte-for-byte unchanged.

**Client FUXA-core edits:** exactly **1 additive route line** in `app.routing.ts` (`/auth/settings`),
identical in kind to the 4 existing `/auth/*` routes. Everything else is new files under
`auth-management/**`. FUXA's `app-settings` dialog is NOT touched.

**Flag-gating & reversibility:** whole feature is reachable only under `authModuleEnabled` (module
must be mounted). Revert = `git revert` (route + page + module files); the `auth_config` table is
additive and ignorable. "Reset to defaults" deletes the override row.

## 7. Correctness Properties (new)

- **P-017 (hot-swap, non-retroactive):** after a successful `apply(patch)`, the next auth operation
  observes the new policy WITHOUT a restart; already-issued artifacts are unaffected — old bcrypt
  hashes still verify after a `bcryptCost` change; already-issued tokens keep their original TTL.
- **P-018 (atomic validation):** an invalid `patch` is rejected whole (400); no field is persisted or
  applied; the live effective config is unchanged.
- **P-019 (fail-safe load):** a missing/corrupt persisted override loads as baseline/defaults; the
  module build never throws on it.
- **P-020 (gated):** `GET`/`PUT /api/auth/config` require `settings.read`/`settings.manage`
  respectively; unauthenticated → 401, unpermitted → 403.

## 8. Rollback & 9. Test plan

**Rollback:** feature flag-gated + additive table + git-revertable; runtime "reset to defaults".

**Test plan (per G5 Definition of Done — all green before merge):**
- Unit: each reconfigure seam takes effect on the next call (BruteForceGuard.reconfigure, setPolicy,
  hasher.setCost, tokenService.settings mutation); validation matrix (bounds, types) → reject/accept;
  fail-safe load of corrupt/absent override; merge precedence; audit emission.
- Property (≥100 iters): P-017 (apply→next-op reflects; old hash still verifies), P-018 (invalid ⇒
  unchanged), P-019 (arbitrary corrupt blob ⇒ defaults, no throw), P-020 (gate).
- HTTP: `GET/PUT /api/auth/config` over real Express incl. 400/401/403 paths + persistence round-trip.
- Browser (Playwright, flipped temp instance): open `/auth/settings`, lower `passwordMinLength`/change
  brute-force, then verify a create/rotate reflects it WITHOUT restart; 0 console errors.
- Regression: `authModuleEnabled=false` boot unchanged; full server suite stays green.

## 10. Traceability

| Item | Design | Impl (planned) | Test (planned) |
|------|--------|----------------|----------------|
| Config surface + classification | §2 | `AuthConfigService`, reconfigure seams | unit setters |
| Store + precedence + fail-safe | §4 | `AuthConfigStore`, `buildAuthModule` overlay | P-019, merge unit |
| Endpoint + gate | §3/§5 | `createAuthConfigRouter`, `settings.*` perms | P-020, HTTP |
| Validation | §5 | `AuthConfigService.validate` | P-018, matrix |
| Hot-swap apply | §2/§3 | `applyToServices()` | P-017, browser |
| UI | §3/§6 | `/auth/settings` page + `AuthConfigClient` + nav | jest + browser |

## 11. Open decisions for user validation (before code)

1. **Config field scope** — approve the §2 in-scope set (password policy + brute-force + token/JWT +
   bcryptCost), and `authModuleEnabled`/`secretCode` staying restart-/secure-path only. Add/remove any?
2. **Permission model** — new `settings.read`/`settings.manage` in `ADMIN_PERMISSION_SET` (admin-only
   by default). OK, or admin-hardcoded only (no new permission)?
3. **"Careful" fields** (`jwtIssuer/jwtAudience/jwtAlgorithm`) — expose with a "signs out everyone"
   warning, or exclude from the runtime surface for now?
4. **Persistence home** — module DB `auth_config` table (recommended; keeps `settings.js` untouched).
   Confirm vs writing back into `settings.js` via FUXA's settings path.
