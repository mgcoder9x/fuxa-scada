// Jest config scoped to the module-owned auth-management CLIENT code (Task 15, D-011/D-036).
//
// WHY ts-jest + node + a scoped root (not karma, not jest-preset-angular):
//  - karma needs a real browser (unavailable/unverified here) and compiles the whole app — which
//    currently does NOT build (N-044: upstream FUXA dep drift in app.module/gridster/charts/…).
//  - jest-preset-angular runs the Angular compiler over the reachable graph → would also hit the
//    broken app modules.
//  - ts-jest with `roots` limited to `src/app/auth-management/` compiles ONLY the auth-management
//    files reachable from its specs, isolating them from the broken FUXA code, so the auth client
//    logic is verifiable headlessly in Node. The pure protocol layer (auth-protocol.ts) has NO
//    Angular import at all; the thin @Injectable client shells are type-checked separately via tsc.
module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/src/app/auth-management'],
    testMatch: ['**/*.spec.ts'],
    // The thin @Injectable shells import `@angular/core` + `@angular/common/http`, which ship as
    // fesm2022 ESM (.mjs) that a CommonJS ts-jest transform cannot load (and would drag in the whole
    // Angular runtime). We map ONLY the two Angular entry points the shells touch to tiny runtime
    // stubs (Injectable no-op + a minimal HttpHeaders). This does NOT weaken type-checking:
    // moduleNameMapper affects runtime resolution only — ts-jest still compiles the shells against
    // the REAL Angular type declarations. The pure protocol core imports no Angular at all.
    moduleNameMapper: {
        '^@angular/core$': '<rootDir>/src/app/auth-management/testing/angular-core.stub.ts',
        '^@angular/common/http$': '<rootDir>/src/app/auth-management/testing/angular-http.stub.ts',
        // FUXA-core EndPointApi: mapped so its strictNullChecks violation (`url: string = null`,
        // D-003 no-edit) is not pulled into our strict ts-jest compile, and so getURL() returns a
        // deterministic base in the node env instead of throwing on the absent `location`.
        '/_helpers/endpointapi$': '<rootDir>/src/app/auth-management/testing/endpointapi.stub.ts',
    },
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            // Inline tsconfig so we do NOT inherit the app's Angular-specific/strict compiler options
            // (and skipLibCheck avoids the unrelated @types/node@26 / xgplayer .d.ts noise, N-044).
            tsconfig: {
                target: 'ES2022',
                module: 'CommonJS',
                moduleResolution: 'node',
                lib: ['ES2022', 'DOM'],
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
                esModuleInterop: true,
                skipLibCheck: true,
                strict: true,
            },
        }],
    },
};
