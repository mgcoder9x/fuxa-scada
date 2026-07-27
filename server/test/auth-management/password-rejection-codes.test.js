//@ts-check
'use strict';

/**
 * Feature: auth-user-management — machine-readable password-rejection codes (D-051, fixes N-091 L2).
 *
 * WHAT THIS PINS DOWN. The API used to explain a rejected password only in an English sentence, and
 * the client's §9 rule forbids rendering server text, so the UI showed a generic "Invalid input" and
 * the operator could not learn which rule failed (observed live, N-091 L2). These tests fix the
 * contract that makes a translated, specific message possible:
 *   - every rule returns a STABLE `code` plus the `params` the UI needs to interpolate (e.g. `min`);
 *   - the legacy string API is derived from the SAME structured result (so the two cannot drift, D-034);
 *   - `User_Service.create/update` and `Account_Service.rotatePassword` propagate `detailCode`/
 *     `detailParams` while leaving `detail` (the HTTP `message`) byte-identical — proving the change is
 *     additive and cannot break an existing consumer.
 */

const assert = require('node:assert/strict');

const {
    validatePasswordPolicy,
    validatePasswordPolicyDetailed,
    resolvePasswordPolicy,
    PASSWORD_REJECTION_CODES,
    BCRYPT_MAX_UTF8_BYTES,
} = require('../../auth-management/services/password-policy');
const { UserService } = require('../../auth-management/services/user.service');
const { AccountService } = require('../../auth-management/services/account.service');
const { Password_Hasher } = require('../../auth-management/services/password-hasher');
const { BcryptHasherAdapter } = require('../../auth-management/adapters/fuxa-bcrypt.adapter');

const policy = resolvePasswordPolicy({ auth: { passwordMinLength: 12 } });

describe('password policy — structured rejection codes (D-051)', function () {
    it('every rule yields a stable code + the params the UI must interpolate', function () {
        assert.deepEqual(validatePasswordPolicyDetailed('', policy),
            { code: PASSWORD_REJECTION_CODES.required, message: 'password is required', params: {} });

        const short = validatePasswordPolicyDetailed('short1', policy);
        assert.equal(short.code, PASSWORD_REJECTION_CODES.tooShort);
        assert.deepEqual(short.params, { min: 12 }, 'the UI needs the ACTUAL minimum, which is runtime-configurable (D-049)');

        const blocked = validatePasswordPolicyDetailed('password1234', policy);
        assert.equal(blocked.code, PASSWORD_REJECTION_CODES.blocklisted);
        assert.deepEqual(blocked.params, {});

        const tooLong = validatePasswordPolicyDetailed('a'.repeat(BCRYPT_MAX_UTF8_BYTES + 1), policy);
        assert.equal(tooLong.code, PASSWORD_REJECTION_CODES.tooLong);
        assert.deepEqual(tooLong.params, { max: BCRYPT_MAX_UTF8_BYTES });

        const malformed = validatePasswordPolicyDetailed('abc\uD800defghijklmn', policy);
        assert.equal(malformed.code, PASSWORD_REJECTION_CODES.malformed);

        assert.equal(validatePasswordPolicyDetailed('a-perfectly-fine-secret', policy), null);
    });

    it('the min-length code tracks a RUNTIME-CHANGED minimum (D-049 hot-swap), not a hard-coded 12', function () {
        const strict = resolvePasswordPolicy({ auth: { passwordMinLength: 20 } });
        const r = validatePasswordPolicyDetailed('only-fourteen1', strict);
        assert.equal(r.code, PASSWORD_REJECTION_CODES.tooShort);
        assert.deepEqual(r.params, { min: 20 });
    });

    it('the legacy string API is DERIVED from the structured one (single source — cannot drift)', function () {
        for (const pw of ['', 'short1', 'password1234', 'a'.repeat(80), 'a-perfectly-fine-secret']) {
            const detailed = validatePasswordPolicyDetailed(pw, policy);
            assert.equal(validatePasswordPolicy(pw, policy), detailed ? detailed.message : null);
        }
    });
});

describe('service outcomes carry the code ADDITIVELY (message unchanged — no consumer breaks)', function () {
    const passwordHasher = new Password_Hasher(new BcryptHasherAdapter({ cost: 4 })); // cost 4: test speed only
    const auditLogger = { record: () => {} };
    const settings = { auth: { passwordMinLength: 12 } };

    function userService(existing) {
        const store = {
            get: async (u) => (existing && existing[u]) || undefined,
            readAll: async () => ({ records: Object.values(existing || {}), errors: [] }),
            create: async () => {},
            update: async () => {},
            delete: async () => {},
            deleteGuarded: async () => ({ kind: 'deleted' }),
        };
        return new UserService({
            userStore: store, passwordHasher,
            authorization: { isAdministrator: async () => false },
            auditLogger, settings,
        });
    }

    it('UserService.create: invalid password → detail (unchanged) + detailCode + detailParams', async function () {
        const outcome = await userService({}).create({ username: 'bob', fullname: 'Bob', password: 'short1', roles: [] });
        assert.equal(outcome.kind, 'invalid');
        assert.equal(outcome.error, 'validation_error');
        assert.equal(outcome.detail, 'password shorter than the 12-character minimum', 'the HTTP message must stay byte-identical');
        assert.equal(outcome.detailCode, PASSWORD_REJECTION_CODES.tooShort);
        assert.deepEqual(outcome.detailParams, { min: 12 });
    });

    it('UserService.update: blocklisted password → blocklisted code', async function () {
        const existing = { bob: { username: 'bob', fullname: 'Bob', passwordHash: 'x', roles: [], metadata: {}, groups: 0 } };
        const outcome = await userService(existing).update('bob', { password: 'password1234' });
        assert.equal(outcome.kind, 'invalid');
        assert.equal(outcome.detailCode, PASSWORD_REJECTION_CODES.blocklisted);
    });

    it('AccountService.rotatePassword: reuse and policy failures both carry a code', async function () {
        const hash = passwordHasher.hash('current-secret-1234');
        const record = { username: 'admin', fullname: 'Admin', passwordHash: hash, roles: [], metadata: { mustRotate: true }, groups: -1 };
        const svc = new AccountService({
            userStore: { get: async () => record, update: async () => {} },
            passwordHasher, auditLogger, settings,
        });

        const reused = await svc.rotatePassword({ username: 'admin' }, { currentPassword: 'current-secret-1234', newPassword: 'current-secret-1234' });
        assert.equal(reused.kind, 'invalid_new');
        assert.equal(reused.detail, 'new password must differ from the current password');
        assert.equal(reused.detailCode, 'password_reused');

        const weak = await svc.rotatePassword({ username: 'admin' }, { currentPassword: 'current-secret-1234', newPassword: 'short1' });
        assert.equal(weak.kind, 'invalid_new');
        assert.equal(weak.detailCode, PASSWORD_REJECTION_CODES.tooShort);
        assert.deepEqual(weak.detailParams, { min: 12 });

        const missing = await svc.rotatePassword({ username: 'admin' }, { currentPassword: 'current-secret-1234', newPassword: '' });
        assert.equal(missing.detailCode, PASSWORD_REJECTION_CODES.required);
    });
});
