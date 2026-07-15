/**
 * Runtime-only stub for `@angular/core`, mapped in jest.config.js (D-036, headless).
 *
 * The auth-management client shells import ONLY the `Injectable` decorator from `@angular/core`. The
 * real package ships as fesm2022 `.mjs` ESM that a CommonJS ts-jest transform cannot load, and it
 * pulls the whole Angular runtime — neither is needed to verify our thin shells headlessly.
 *
 * This stub provides a no-op `Injectable` so the decorator applies without side effects. It is a
 * RUNTIME substitute only: ts-jest still type-checks the shells against the REAL `@angular/core`
 * type declarations (moduleNameMapper does not affect TypeScript type resolution), so decorator
 * usage stays type-correct.
 */
export function Injectable(_config?: unknown): (target: unknown) => unknown {
    return (target: unknown) => target;
}
