/**
 * Runtime-only stub for FUXA-core `_helpers/endpointapi` (mapped in jest.config.js, D-036/D-003).
 *
 * The real `EndPointApi` resolves its base URL from `location`/`environment`, which do not exist in
 * the node test env (getURL() would throw), and — being FUXA core — it also contains a
 * strictNullChecks violation (`url: string = null`) we must NOT edit (D-003). Mapping it to this
 * stub keeps the FUXA-core file out of ts-jest's strict compilation while letting the shells resolve
 * a deterministic base URL under test. As with the Angular stubs, ts-jest still type-checks the
 * shells against the REAL declaration; this is a runtime substitute only.
 */
export class EndPointApi {
    public static getURL(): string {
        return 'http://localhost';
    }
    public static getRemoteURL(_destIp: string): string {
        return 'http://localhost/api';
    }
    public static resolveUrl = (input?: string): string => input || '';
}
