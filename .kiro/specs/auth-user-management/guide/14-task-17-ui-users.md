# 14 — Task 17: UI User Management (trang quản lý người dùng)

> Tương ứng **Task 17** trong `../tasks.md`. Requirement: 12.1–12.6, 11.3.
> Thiết kế: `../design/08-ui-user-management-page.md`. Không sở hữu property (test component).

## Mục tiêu

Trang quản lý routed (mới, thay trang users cũ của FUXA — D-011): danh sách user (username/họ tên/vai
trò), form tạo/sửa, dialog xác nhận xóa (xử lý `last_admin`), và **cổng truy cập** cho non-admin.

## Phụ thuộc

Task 15 (`UserAdminClient`, `RoleAdminClient`, `SessionStore`).

---

## Bước 1 (17.1) — Container + danh sách + cổng truy cập

Tạo `client/src/app/auth-management/user-management/user-management-page.component.ts`:

```typescript
import { Component, OnInit } from '@angular/core';
import { UserAdminClient, UserView, RoleOption } from '../services/user-admin.client';
import { RoleAdminClient } from '../services/role-admin.client';
import { SessionStore } from '../services/session.store';

@Component({ selector: 'app-user-management', templateUrl: './user-management-page.component.html' })
export class UserManagementPageComponent implements OnInit {
  users: UserView[] = [];
  roles: RoleOption[] = [];
  access: 'checking' | 'granted' | 'denied' = 'checking';
  errorKey: string | null = null;

  constructor(private usersApi: UserAdminClient, private rolesApi: RoleAdminClient, private session: SessionStore) {}

  ngOnInit(): void {
    // Cổng phía client (UX). LƯU Ý: server MỚI là ranh giới thật (401/403).
    // Ở đây kiểm quyền tối giản qua roles trong session; nếu không có quyền đọc user ⇒ denied.
    // (Có thể thay bằng gọi API và bắt 403 — xem xử lý lỗi bên dưới.)
    this.refresh();
    this.rolesApi.list().subscribe({ next: r => this.roles = r, error: () => {} });
  }

  roleName(id: string): string { return this.roles.find(r => r.id === id)?.name || ''; }

  refresh(): void {
    this.usersApi.list().subscribe({
      next: (u) => { this.users = u; this.access = 'granted'; },
      error: (e) => {
        if (e.status === 401 || e.status === 403) { this.access = 'denied'; }   // AC-12.6
        else { this.errorKey = 'users.load_failed'; }
      },
    });
  }

  onDeleted(username: string): void { this.users = this.users.filter(u => u.username !== username); }
  onSaved(): void { this.refresh(); }   // AC-12.2/12.3 refresh sau khi lưu
}
```

`user-management-page.component.html` (rút gọn):

```html
<ng-container [ngSwitch]="access">
  <div *ngSwitchCase="'denied'" role="alert">Bạn không có quyền truy cập trang này.</div> <!-- AC-12.6 -->
  <div *ngSwitchCase="'granted'">
    <table role="table" aria-label="Danh sách người dùng">
      <thead><tr><th>Tên đăng nhập</th><th>Họ tên</th><th>Vai trò</th><th></th></tr></thead>
      <tbody>
        <tr *ngFor="let u of users">
          <td>{{ u.username }}</td>
          <td>{{ u.fullname }}</td>
          <td>{{ u.roles?.length ? u.roles.map(roleName).join(', ') : '' }}</td>
          <td>
            <app-user-edit-form [user]="u" [roles]="roles" (saved)="onSaved()"></app-user-edit-form>
            <app-delete-user-confirm [username]="u.username" (deleted)="onDeleted(u.username)"></app-delete-user-confirm>
          </td>
        </tr>
      </tbody>
    </table>
    <app-user-create-form [roles]="roles" (saved)="onSaved()"></app-user-create-form>
  </div>
</ng-container>
```

## Bước 2 (17.2) — Form tạo & sửa

Tạo `user-create-form.component.ts` và `user-edit-form.component.ts` (dạng reactive form). Điểm chốt:
- Tạo: `username` (required + kiểm trùng phía client tùy chọn), `password` (required), `roles` (multi-select).
  Gửi `UserAdminClient.create(...)`; thành công ⇒ phát `saved`. Không hợp lệ ⇒ hiện lỗi, KHÔNG gửi (AC-12.4).
- Sửa: `username` **disable** (không đổi); `password` **để trống** (bỏ trống ⇒ giữ nguyên — AC-7.3);
  `roles` chọn lại. Gửi `UserAdminClient.update(username, {...})`; thành công ⇒ phát `saved`.
- Nút gửi disable khi form không hợp lệ **hoặc** đang chờ (chặn double-submit).

Ví dụ rút gọn phần logic tạo:

```typescript
submit() {
  if (this.form.invalid || this.pending) { this.errorKey = 'form.invalid'; return; } // AC-12.4
  this.pending = true; this.errorKey = null;
  const v = this.form.value;
  this.usersApi.create({ username: (v.username||'').trim(), fullname: v.fullname, password: v.password, roles: v.roles || [] })
    .subscribe({
      next: () => { this.pending = false; this.saved.emit(); },
      error: (e) => { this.pending = false; this.errorKey = this.msg(e.errorId); }, // duplicate_username/validation_error
    });
}
```

## Bước 3 (17.3) — Dialog xác nhận xóa (xử lý last_admin)

`delete-user-confirm.component.ts` — bấm Xóa ⇒ mở xác nhận; xác nhận ⇒ gọi
`UserAdminClient.remove(username)`:

```typescript
confirmDelete() {
  this.usersApi.remove(this.username).subscribe({
    next: () => this.deleted.emit(),                     // AC-12.5 xóa khỏi danh sách
    error: (e) => {
      if (e.errorId === 'last_admin') this.message = 'Không thể xóa admin cuối cùng.'; // giữ dòng, báo rõ
      else if (e.status === 404) { this.message = 'Người dùng không còn tồn tại.'; this.refreshNeeded.emit(); }
      else this.message = 'Xóa thất bại.';
    },
  });
}
```

## Bước 4 (17.4) — Route + cutover (chuyển hẳn sang trang mới)

- Đăng ký routes trong module `auth-management`:
  `{ path: 'login', component: LoginPageComponent }`,
  `{ path: 'user-management', component: UserManagementPageComponent, canActivate: [AuthGuard] }`.
- Trỏ điều hướng/quản lý user tới trang mới; **ngừng dùng** dialog login cũ và route `users` cũ của FUXA
  (KHÔNG sửa file cũ tại chỗ — chỉ thôi trỏ tới chúng). Đây là bước cutover của D-011.

## Bước 5 (17.5) — Test component

Tạo `user-management-page.component.spec.ts` kiểm:
- AC-12.1: `list` trả data ⇒ render đúng số dòng, cột roles hiển thị tên (không lộ hash — UserView không có).
- AC-12.6: `list` trả 403 ⇒ `access==='denied'`, hiện thông báo, không render bảng.
- AC-12.2/12.3: sau `saved` gọi `refresh()`.
- AC-12.5: `onDeleted` bỏ đúng dòng khỏi `users`.

Ví dụ 1 test:

```typescript
it('AC-12.6: 403 ⇒ denied, không render bảng', () => {
  usersApi.list.and.returnValue(throwError(() => ({ status: 403 })));
  comp.ngOnInit();
  expect(comp.access).toBe('denied');
});
```

---

## Cách kiểm chứng

```powershell
npm test --prefix client
```

Mong đợi: các test UserManagement PASS. Chạy thật: build client (`npm run build --prefix client`),
khởi động server, vào trang `/user-management` bằng tài khoản admin (sau khi đã đổi mật khẩu bootstrap).

## Đã xong task khi

- [ ] Danh sách hiện username/họ tên/vai trò, không lộ hash.
- [ ] Tạo/sửa gửi đúng, refresh khi thành công; sửa để trống mật khẩu ⇒ giữ nguyên.
- [ ] Xóa có xác nhận; xử lý `last_admin` và `user_not_found`.
- [ ] Non-admin ⇒ denied (AC-12.6). Cutover sang trang mới.

## Đối chiếu

| Mục | Tham chiếu |
|-----|-----------|
| Task gốc | `../tasks.md` Task 17 (17.1–17.5) |
| Requirement | 12.1–12.6, 11.3 |
| Thiết kế | `../design/08-ui-user-management-page.md` |
| Quyết định | D-011 (SUPERSEDE + cutover), D-007 (roles), D-009 (last_admin ở UI) |

🎉 **Đây là file hướng dẫn cuối cùng.** Hoàn thành 14 task theo thứ tự là bạn có module hoàn chỉnh,
có test (gồm 12 property) kiểm chứng đúng đắn.
