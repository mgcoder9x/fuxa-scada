import { Routes, RouterModule } from '@angular/router';

import { AuthGuard } from './auth.guard';

import { HomeComponent } from './home/home.component';
import { EditorComponent } from './editor/editor.component';
import { DeviceComponent } from './device/device.component';
import { LabComponent } from './lab/lab.component';
import { UsersComponent } from './users/users.component';
import { ViewComponent } from './view/view.component';
import { AlarmViewComponent } from './alarms/alarm-view/alarm-view.component';
import { LogsViewComponent } from './logs-view/logs-view.component';
import { AlarmListComponent } from './alarms/alarm-list/alarm-list.component';
import { NotificationListComponent } from './notifications/notification-list/notification-list.component';
import { ScriptListComponent } from './scripts/script-list/script-list.component';
import { DEVICE_READONLY } from './_models/hmi';
import { ReportListComponent } from './reports/report-list/report-list.component';
import { UsersRolesComponent } from './users/users-roles/users-roles.component';
import { MapsLocationListComponent } from './maps/maps-location-list/maps-location-list.component';
import { LanguageTextListComponent } from './language/language-text-list/language-text-list.component';
import { NodeRedFlowsComponent } from './integrations/node-red/node-red-flows/node-red-flows.component';
import { ApiKeysListComponent } from './apikeys/api-keys-list/api-keys-list.component';
import { PluginsListComponent } from './plugins/plugins-list/plugins-list.component';
import { ArMarkerListComponent } from './ar/ar-marker-list/ar-marker-list.component';
import { ArViewComponent } from './ar/ar-view/ar-view.component';
// auth-management module standalone pages (Task 17.4 additive routing — see below)
import { LoginComponent } from './auth-management/login/login.component';
import { UserManagementComponent } from './auth-management/user-management/user-management.component';
import { RotatePasswordComponent } from './auth-management/rotate-password/rotate-password.component';
import { RoleManagementComponent } from './auth-management/role-management/role-management.component';
import { AuthSettingsComponent } from './auth-management/auth-settings/auth-settings.component';
// D-052 (task 24.2): under SUPERSEDE, redirect the legacy /users and /userRoles routes to the
// module-owned pages so a direct URL cannot bypass the module that owns identity (DV-013 wires it).
import { LegacyUserAdminRedirectGuard } from './auth-management/guards/legacy-user-admin-redirect.guard';

const appRoutes: Routes = [
    { path: '', component: HomeComponent},//, canActivate: [AuthGuard] },
    { path: 'home', component: HomeComponent},//, canActivate: [AuthGuard] },
    { path: 'home/:viewName', component: HomeComponent},//, canActivate: [AuthGuard] },
    { path: 'editor', component: EditorComponent, canActivate: [AuthGuard]},
    { path: 'lab', component: LabComponent, canActivate: [AuthGuard] },
    { path: 'device', component: DeviceComponent, canActivate: [AuthGuard] },
    { path: DEVICE_READONLY, component: DeviceComponent, canActivate: [AuthGuard] },
    // D-052/DV-013: LegacyUserAdminRedirectGuard runs BEFORE AuthGuard — under SUPERSEDE it
    // redirects (UrlTree) to the module page (so neither the legacy page nor FUXA's login dialog
    // shows); OFF it returns true and AuthGuard runs unchanged (non-flipped = byte-identical).
    { path: 'users', component: UsersComponent, canActivate: [LegacyUserAdminRedirectGuard, AuthGuard], data: { supersedeRedirect: '/auth/users' } },
    { path: 'userRoles', component: UsersRolesComponent, canActivate: [LegacyUserAdminRedirectGuard, AuthGuard], data: { supersedeRedirect: '/auth/roles' } },
    { path: 'alarms', component: AlarmViewComponent, canActivate: [AuthGuard] },
    { path: 'messages', component: AlarmListComponent, canActivate: [AuthGuard] },
    { path: 'notifications', component: NotificationListComponent, canActivate: [AuthGuard] },
    { path: 'scripts', component: ScriptListComponent, canActivate: [AuthGuard] },
    { path: 'reports', component: ReportListComponent, canActivate: [AuthGuard] },
    { path: 'language', component: LanguageTextListComponent, canActivate: [AuthGuard] },
    { path: 'logs', component: LogsViewComponent, canActivate: [AuthGuard] },
    { path: 'events', component: LogsViewComponent, canActivate: [AuthGuard] },
    { path: 'view', component: ViewComponent },
    { path: 'mapsLocations', component: MapsLocationListComponent, canActivate: [AuthGuard] },
    { path: 'flows', component: NodeRedFlowsComponent, canActivate: [AuthGuard] },
    { path: 'apikeys', component: ApiKeysListComponent, canActivate: [AuthGuard] },
    { path: 'plugins', component: PluginsListComponent, canActivate: [AuthGuard] },
    { path: 'arMarkers', component: ArMarkerListComponent, canActivate: [AuthGuard] },
    { path: 'ar', component: ArViewComponent },

    // auth-management module (Task 17.4 — ADDITIVE, non-destructive step): expose the module-owned
    // standalone Login + User-Management pages under a distinct `auth/*` namespace so they are
    // reachable/testable in a real browser WITHOUT removing FUXA's own /login dialog or /users route
    // (the destructive SUPERSEDE cutover — retiring FUXA auth, api/index.js, AuthGuard redirect,
    // enabling security — remains a separate, confirmed step). Lazy `loadComponent` (standalone).
    { path: 'auth/login', component: LoginComponent },
    { path: 'auth/users', component: UserManagementComponent },
    // Forced first-login password rotation (REQ-17, D-045). Reached from the Login flow when the
    // signed-in account is `mustRotate`; no AuthGuard (like auth/login) — the page requires a session
    // and redirects to auth/login if absent.
    { path: 'auth/rotate-password', component: RotatePasswordComponent },
    // Role-Management page (REQ-9, D-046). No AuthGuard (like auth/users); UX gate + server §05 authorize.
    { path: 'auth/roles', component: RoleManagementComponent },
    // Runtime auth-configuration page (D-049 Phase 2). Same posture as the pages above: no AuthGuard —
    // the page's own UX gate needs `settings.read` and the server (§05 requirePermission) authorizes
    // every read/write independently, so the route itself carries no authority.
    { path: 'auth/settings', component: AuthSettingsComponent },

    // otherwise redirect to home
    { path: '**', redirectTo: '' }
];

export const routing = RouterModule.forRoot(appRoutes, {});
