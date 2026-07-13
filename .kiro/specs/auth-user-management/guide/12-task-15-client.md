# 12 — Task 15: Client HTTP + tái dùng hạ tầng phiên

> Tương ứng **Task 15** trong `../tasks.md`. Requirement: 11.2, 11.4, 12.1–12.5, 11.3, 12.6.
> Thiết kế: `../design/07-ui-login-page.md` §5, `../design/08-ui-user-management-page.md` §2.4.

> ### ⚠️ ĐỐI CHIẾU (2026-07-13) — GHI ĐÈ theo DV-006
> Ở **`AuthSignInClient`**, sign-in **không còn trả 404/`user_not_found`**: unknown-user nay là **401
> `invalid_credentials`** giống hệt sai mật khẩu. Nhánh `e.status === 404 ? 'user_not_found'` trong `toError`
> của sign-in client là **nhánh chết** — bỏ đi hoặc giữ vô hại, nhưng đừng dựa vào nó. `user_not_found`/**404**
> **vẫn đúng** cho **`UserAdminClient`** (admin CRUD sửa/xóa user — AC-7.4/8.3), không phải sign-in. Xem
> `../design/01` §4 (DV-006) và guide 06.

## Mục tiêu

Có các Angular service gọi API: `AuthSignInClient` (đăng nhập), `UserAdminClient` + `RoleAdminClient`
(quản lý). **Tái dùng** hạ tầng phiên sẵn có của FUXA (lưu token, interceptor `x-access-token`, AuthGuard)
thay vì dựng mới.

## Phụ thuộc

Server đã chạy (Task 13). Angular client biên dịch được.

## Kiến thức nền (đã kiểm chứng trong thiết kế §07)

FUXA client sẵn có (KHÔNG sửa, chỉ dùng lại):
- Lưu token: `sessionStorage` khóa `currentUser` + biến toàn cục `window.fuxaAccessToken`
  (trong `client/src/app/_services/auth.service.ts`).
- Interceptor gắn header `x-access-token` cho mọi request (`_helpers/auth-interceptor.ts`,
  hằng `TOKEN_HEADER_KEY = 'x-access-token'`).
- Bảo vệ route: `AuthGuard` (`auth.guard.ts`).
- Base URL API: `EndPointApi.getURL()` (`_helpers/endpointapi.ts`).

> Module đặt code MỚI trong `client/src/app/auth-management/`. Không sửa file FUXA cũ (D-011 SUPERSEDE).

---

## Bước 1 — Tạo thư mục & service đăng nhập

Tạo `client/src/app/auth-management/services/auth-signin.client.ts`:

```typescript
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { EndPointApi } from '../../_helpers/endpointapi';

export interface SignInResult { token: string; username: string; fullname: string; roles: string[]; }
export interface SignInError { errorId: string; status: number; }

@Injectable({ providedIn: 'root' })
export class AuthSignInClient {
  private base = EndPointApi.getURL();
  constructor(private http: HttpClient) {}

  signIn(username: string, password: string): Observable<SignInResult> {
    // Skip-Error để 401 KHÔNG kích interceptor đăng xuất/reload toàn cục
    const headers = { 'Skip-Error': 'true' };
    return this.http.post<any>(`${this.base}/api/signin`, { username, password }, { headers }).pipe(
      map(res => res.data as SignInResult),
      catchError((e: HttpErrorResponse) => throwError(() => this.toError(e)))
    );
  }

  private toError(e: HttpErrorResponse): SignInError {
    const errorId = e.error?.error
      || (e.status === 401 ? 'invalid_credentials'
        : e.status === 404 ? 'user_not_found'
        : e.status === 429 ? 'too_many_attempts'
        : e.status === 400 ? 'missing_field' : 'unexpected_error');
    return { errorId, status: e.status };
  }
}
```

## Bước 2 — Service lưu token (bọc cơ chế FUXA, thêm roles first-class)

Tạo `client/src/app/auth-management/services/session.store.ts`:

```typescript
import { Injectable } from '@angular/core';

const KEY = 'currentUser'; // dùng lại khóa của FUXA

@Injectable({ providedIn: 'root' })
export class SessionStore {
  save(result: { token: string; username: string; fullname: string; roles: string[] }): void {
    sessionStorage.setItem(KEY, JSON.stringify(result));
    (window as any).fuxaAccessToken = result.token; // interceptor FUXA đọc cái này
  }
  token(): string | null { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null')?.token || null; } catch { return null; } }
  roles(): string[] { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null')?.roles || []; } catch { return []; } }
  clear(): void { sessionStorage.removeItem(KEY); (window as any).fuxaAccessToken = undefined; }
}
```

> Nếu FUXA lưu `currentUser` theo cấu trúc khác, đọc `_services/auth.service.ts` và khớp cho đúng để
> interceptor cũ vẫn hoạt động. Cốt lõi: token phải nằm ở nơi interceptor `x-access-token` lấy được.

## Bước 3 — Service quản lý user/role

Tạo `client/src/app/auth-management/services/user-admin.client.ts`:

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { EndPointApi } from '../../_helpers/endpointapi';

export interface UserView { username: string; fullname: string; roles: string[]; metadata?: any; }
export interface RoleOption { id: string; name: string; }

@Injectable({ providedIn: 'root' })
export class UserAdminClient {
  private base = EndPointApi.getURL();
  constructor(private http: HttpClient) {}
  list(): Observable<UserView[]> { return this.http.get<any>(`${this.base}/api/users`).pipe(m => m as any).pipe(); }
  // gợi ý: dùng map(res => res.data) như dưới
}
```

Bản đầy đủ (dùng `map`):

```typescript
import { map } from 'rxjs/operators';
// list()
list(): Observable<UserView[]> { return this.http.get<any>(`${this.base}/api/users`).pipe(map(r => r.data as UserView[])); }
create(req: any): Observable<UserView> { return this.http.post<any>(`${this.base}/api/users`, req).pipe(map(r => r.data)); }
update(username: string, req: any): Observable<UserView> { return this.http.put<any>(`${this.base}/api/users/${encodeURIComponent(username)}`, req).pipe(map(r => r.data)); }
remove(username: string): Observable<void> { return this.http.delete<any>(`${this.base}/api/users/${encodeURIComponent(username)}`).pipe(map(() => void 0)); }
```

Và `role-admin.client.ts`: `list()` gọi `GET /api/roles`, map sang `RoleOption[] { id, name }`.

## Bước 4 (15.4) — Test service (HttpClientTestingModule)

Tạo `client/src/app/auth-management/services/auth-signin.client.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AuthSignInClient } from './auth-signin.client';

describe('AuthSignInClient', () => {
  let client: AuthSignInClient; let httpMock: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule], providers: [AuthSignInClient] });
    client = TestBed.inject(AuthSignInClient); httpMock = TestBed.inject(HttpTestingController);
  });
  afterEach(() => httpMock.verify());

  it('thành công ⇒ trả { token, username, fullname, roles }', () => {
    client.signIn('alice', 'p').subscribe(r => {
      expect(r.token).toBe('T'); expect(r.roles).toEqual(['r1']);
    });
    const req = httpMock.expectOne(r => r.url.endsWith('/api/signin'));
    expect(req.request.method).toBe('POST');
    req.flush({ status: 'success', data: { token: 'T', username: 'alice', fullname: 'A', roles: ['r1'] } });
  });

  it('401 ⇒ errorId invalid_credentials', () => {
    client.signIn('a', 'x').subscribe({ error: e => expect(e.errorId).toBe('invalid_credentials') });
    httpMock.expectOne(r => r.url.endsWith('/api/signin')).flush({ error: 'invalid_credentials' }, { status: 401, statusText: 'Unauthorized' });
  });
});
```

Chạy test client: `npm test --prefix client` (Angular dùng Karma/Jasmine — lệnh theo `client/package.json`).

---

## Đã xong task khi

- [ ] `AuthSignInClient` gọi `/api/signin`, map data + chuẩn hóa lỗi theo errorId.
- [ ] Token lưu đúng nơi interceptor `x-access-token` đọc được (tái dùng cơ chế FUXA).
- [ ] `UserAdminClient`/`RoleAdminClient` gọi đúng endpoint, map `data`.
- [ ] Test service PASS.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 15 (15.1–15.4) |
| Requirement | 11.2, 11.4, 12.1–12.5, 11.3, 12.6 |
| Thiết kế | `../design/07-ui-login-page.md` §5, `../design/08-ui-user-management-page.md` §2.4 |
| Quyết định | D-007 (roles first-class), D-011 (tái dùng session) |

➡️ Xong Task 15 → sang `13-task-16-ui-login.md`.
