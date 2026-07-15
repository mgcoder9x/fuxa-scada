/**
 * Runtime-only stub for `@angular/common/http`, mapped in jest.config.js (D-036, headless).
 *
 * The client shells use, at RUNTIME, only `new HttpHeaders({...})` (and `.has()` to assert the
 * `Skip-Error` opt-out in tests); `HttpClient` and `HttpErrorResponse` appear only as erased type
 * annotations. This minimal `HttpHeaders` reproduces the immutable-ish header semantics the shells
 * rely on. As with the core stub, ts-jest type-checks the shells against the REAL
 * `@angular/common/http` declarations; this file is a runtime substitute only.
 */
export class HttpHeaders {
    private readonly store: Record<string, string> = {};
    constructor(init?: Record<string, string>) {
        if (init) {
            for (const k of Object.keys(init)) {
                this.store[k] = init[k];
            }
        }
    }
    has(name: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.store, name);
    }
    get(name: string): string | null {
        return this.has(name) ? this.store[name] : null;
    }
    set(name: string, value: string): HttpHeaders {
        const next = new HttpHeaders(this.store);
        (next as unknown as { store: Record<string, string> }).store[name] = value;
        return next;
    }
    delete(name: string): HttpHeaders {
        const copy: Record<string, string> = { ...this.store };
        delete copy[name];
        return new HttpHeaders(copy);
    }
}

/** Placeholder classes — used only as compile-time types by the shells (never constructed here). */
export class HttpClient { }
export class HttpErrorResponse { }
