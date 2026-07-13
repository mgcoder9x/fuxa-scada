# 13 — Task 16: UI Login (trang đăng nhập)

> Tương ứng **Task 16** trong `../tasks.md`. Requirement: 11.1–11.5.
> Thiết kế: `../design/07-ui-login-page.md`. Không sở hữu property (test component).

> ### ⚠️ ĐỐI CHIẾU (2026-07-13) — GHI ĐÈ theo DV-006
> Cách hiển thị "401 và 404 cùng một câu" của guide này **vẫn enumeration-safe**, nhưng theo DV-006 **server
> nay trả 401 cho CẢ hai** trường hợp (unknown-user và sai mật khẩu) — không còn 404 ở sign-in. Trang login
> chỉ cần map `invalid_credentials` (và `too_many_attempts`/`missing_field`) sang thông báo chung; nhánh xử lý
> `user_not_found`/404 là dư thừa cho sign-in (có thể bỏ). Test nên giả lập **401** cho cả hai thay vì 404.

## Mục tiêu

Có trang đăng nhập routed (mới, thay dialog cũ của FUXA — D-011): form username/password, chặn
double-submit, thông báo lỗi chung chung (không lộ user tồn tại), thành công thì lưu token + điều hướng.

## Phụ thuộc

Task 15 (`AuthSignInClient`, `SessionStore`).

## Kiến thức nền

- REQ-11 yêu cầu **điều hướng** khi thành công ⇒ dùng trang routed + `Router` (hợp hơn dialog).
- Lỗi 401 (sai mật khẩu) và 404 (không có user) hiển thị **cùng một câu** ⇒ không lộ user tồn tại.
- Nút gửi disable khi form không hợp lệ **hoặc** đang chờ phản hồi (AC-11.5) ⇒ chặn double-submit.

---

## Bước 1 (16.1) — Component

Tạo `client/src/app/auth-management/login/login-page.component.ts`:

```typescript
import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthSignInClient } from '../services/auth-signin.client';
import { SessionStore } from '../services/session.store';

@Component({ selector: 'app-login-page', templateUrl: './login-page.component.html' })
export class LoginPageComponent {
  form: FormGroup;
  pending = false;
  errorKey: string | null = null;

  constructor(private fb: FormBuilder, private auth: AuthSignInClient, private session: SessionStore, private router: Router) {
    this.form = this.fb.group({
      username: ['', [Validators.required]],
      password: ['', [Validators.required]],
    });
  }

  canSubmit(): boolean { return this.form.valid && !this.pending; }

  submit(): void {
    if (!this.canSubmit()) { return; }              // AC-11.2 + AC-11.4 (client chặn khi rỗng)
    this.pending = true; this.errorKey = null;      // AC-11.5 disable nút
    const { username, password } = this.form.value;
    this.auth.signIn((username || '').trim(), password || '').subscribe({
      next: (res) => {                              // AC-11.3
        this.session.save(res);
        this.pending = false;
        this.router.navigate(['/']);               // điều hướng vào khu vực đã xác thực
      },
      error: (e) => {                              // AC-11.4
        this.pending = false;
        this.errorKey = this.messageKey(e.errorId);
      },
    });
  }

  // 401 & 404 CÙNG một câu ⇒ không lộ user tồn tại
  private messageKey(errorId: string): string {
    switch (errorId) {
      case 'invalid_credentials':
      case 'user_not_found': return 'login.invalid';        // "Sai tên đăng nhập hoặc mật khẩu"
      case 'too_many_attempts': return 'login.too_many';
      case 'missing_field': return 'login.missing';
      default: return 'login.failed';
    }
  }
}
```

Tạo `client/src/app/auth-management/login/login-page.component.html`:

```html
<form [formGroup]="form" (ngSubmit)="submit()" autocomplete="on">
  <label for="username">Tên đăng nhập</label>
  <input id="username" type="text" formControlName="username" autocomplete="username" />

  <label for="password">Mật khẩu</label>
  <input id="password" type="password" formControlName="password" autocomplete="current-password" />

  <button type="submit" [disabled]="!canSubmit()" [attr.aria-busy]="pending">Đăng nhập</button>

  <div *ngIf="errorKey" role="alert" aria-live="assertive">{{ errorKey | translate }}</div>
</form>
```

> Nếu dự án dùng Angular Material như FUXA, có thể thay bằng `mat-form-field`; điểm bắt buộc là 3 điều
> khiển (username/password/submit) + vùng `role="alert"` + nút disable theo `canSubmit()`.

## Bước 2 (16.2) — Test component

Tạo `client/src/app/auth-management/login/login-page.component.spec.ts`:

```typescript
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { LoginPageComponent } from './login-page.component';
import { AuthSignInClient } from '../services/auth-signin.client';
import { SessionStore } from '../services/session.store';

describe('LoginPageComponent', () => {
  let fixture: ComponentFixture<LoginPageComponent>; let comp: LoginPageComponent;
  let auth: any; let session: any; let router: any;

  beforeEach(() => {
    auth = { signIn: jasmine.createSpy() };
    session = { save: jasmine.createSpy() };
    router = { navigate: jasmine.createSpy() };
    TestBed.configureTestingModule({
      declarations: [LoginPageComponent],
      imports: [ReactiveFormsModule],
      providers: [
        { provide: AuthSignInClient, useValue: auth },
        { provide: SessionStore, useValue: session },
        { provide: Router, useValue: router },
      ],
    });
    fixture = TestBed.createComponent(LoginPageComponent); comp = fixture.componentInstance; fixture.detectChanges();
  });

  it('AC-11.1/11.2: nút disable khi rỗng; gửi khi đủ 2 field', () => {
    expect(comp.canSubmit()).toBeFalse();
    comp.form.setValue({ username: 'a', password: 'p' });
    expect(comp.canSubmit()).toBeTrue();
    auth.signIn.and.returnValue(of({ token: 'T', username: 'a', fullname: 'A', roles: [] }));
    comp.submit();
    expect(auth.signIn).toHaveBeenCalledOnceWith('a', 'p');
  });

  it('AC-11.3: thành công ⇒ lưu token + điều hướng', () => {
    comp.form.setValue({ username: 'a', password: 'p' });
    auth.signIn.and.returnValue(of({ token: 'T', username: 'a', fullname: 'A', roles: [] }));
    comp.submit();
    expect(session.save).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('AC-11.4: 401 và 404 hiển thị CÙNG câu; ở lại trang', () => {
    comp.form.setValue({ username: 'a', password: 'p' });
    auth.signIn.and.returnValue(throwError(() => ({ errorId: 'invalid_credentials', status: 401 })));
    comp.submit(); const k1 = comp.errorKey;
    auth.signIn.and.returnValue(throwError(() => ({ errorId: 'user_not_found', status: 404 })));
    comp.submit(); const k2 = comp.errorKey;
    expect(k1).toBe(k2);                       // không lộ user tồn tại
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('AC-11.5: đang chờ ⇒ disable nút (chặn double-submit)', () => {
    comp.form.setValue({ username: 'a', password: 'p' });
    const pendingSubject = new Subject<any>();
    auth.signIn.and.returnValue(pendingSubject);
    comp.submit();
    expect(comp.pending).toBeTrue();
    expect(comp.canSubmit()).toBeFalse();      // không gửi lần 2 được
  });
});
```

## Bước 3 (17.4 phần login) — Đăng ký route + cutover

Trong module routing của `auth-management`, đăng ký `{ path: 'login', component: LoginPageComponent }`
và trỏ `AuthGuard` tới trang này (thay vì mở dialog cũ). Việc gỡ hẳn dialog cũ để ở Task 17 (cutover chung).

---

## Cách kiểm chứng

```powershell
npm test --prefix client
```

Mong đợi: 4 test LoginPage PASS. (Angular test chạy qua Karma/Jasmine theo cấu hình client.)

## Đã xong task khi

- [ ] 3 điều khiển + vùng alert; nút disable theo `canSubmit()`.
- [ ] Thành công lưu token + điều hướng; lỗi ở lại trang, 401/404 cùng câu.
- [ ] 4 test component PASS.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 16 (16.1–16.2) |
| Requirement | 11.1–11.5 |
| Thiết kế | `../design/07-ui-login-page.md` |
| Quyết định | D-011 (trang routed thay dialog), D-007 (roles) |

➡️ Xong Task 16 → sang `14-task-17-ui-users.md` (file cuối).
