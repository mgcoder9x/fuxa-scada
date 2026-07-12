# Đánh giá chuyên sâu — `reivew.md` & hồ sơ IAM/RBAC `.kiro/specs/auth-user-management`

> **Vai trò tài liệu:** Meta-audit (đánh giá bản đánh giá) + independent security/architecture review  
> **Đối tượng:** `reivew.md` (audit trước) + specs `.kiro` + code FUXA runtime hiện tại  
> **Phạm vi xác minh:** Đối chiếu trực tiếp `server/api/*`, `server/runtime/users/*`, design/guide `.kiro`  
> **Ngày:** 2026-07-12  
> **Kết luận ngắn:** Bản `reivew.md` đạt chất lượng audit **cao** (≈ **8,4/10** về độ chính xác claim).  
> Hệ thống **spec IAM + FUXA baseline** vẫn **chưa sẵn sàng production** cho IAM nghiêm ngặt, càng không cho SCADA/OT enterprise.  
> Production-readiness IAM: **≈ 2,8–3,5/10**.  
> Production-readiness nếu coi là kiến trúc SCADA lớn: **≈ 1,2–1,6/10**.

---

## 0. Executive summary (dành cho decision-maker)

| Câu hỏi | Trả lời thẳng |
|--------|----------------|
| `reivew.md` có đúng không? | **Đúng phần lớn P0**, có grounding code, ít “ý kiến suông”. |
| Có được triển khai theo guide hiện tại? | **Không.** Guide chưa implement; cutover router sai; bootstrap/session/persistence còn lỗ hổng thiết kế. |
| Có nên “code theo guide rồi vá sau”? | **Không.** Sửa spec + ADR trước. Code theo guide hiện tại = nợ kỹ thuật + lỗ hổng an ninh ngay từ ngày 1. |
| Điểm mạnh đáng giữ? | Requirements-first, decision ledger, modular boundary, ports/adapters, PBT intent. |
| Điểm chết? | Authority trong JWT, không transaction, router shadow, bootstrap secret leak, refresh rotation giả, test optional. |

### Verdict tổng hợp

```
┌─────────────────────────────────────────────────────────────┐
│  SPEC QUALITY (tài liệu, cấu trúc, tư duy)     :  7.0/10   │
│  SPEC CORRECTNESS (đúng với FUXA + security)   :  2.5/10   │
│  IMPLEMENTATION STATUS                         :  0.0/10   │
│  FUXA BASELINE SECURITY (code hiện tại)        :  3.0/10   │
│  OT/SCADA PLATFORM FIT                         :  1.5/10   │
│  reivew.md AUDIT QUALITY                       :  8.4/10   │
└─────────────────────────────────────────────────────────────┘
```

**Không triển khai.** Gate bắt buộc: sửa P0 trong specification → ADR cutover → concurrency/transaction model → session authority live → rồi mới code.

---

## 1. Meta-review: `reivew.md` có tốt không?

### 1.1 Điểm mạnh của bản audit

| Tiêu chí | Đánh giá | Ghi chú |
|---------|----------|---------|
| Grounding bằng path/line | Xuất sắc | Dẫn đúng guide + file FUXA thật |
| Phân loại P0/P1 | Rất tốt | Hầu hết P0 xứng đáng blocker |
| Tách “spec quality” vs “runtime correctness” | Tốt | Tránh nhầm “tài liệu đẹp = hệ thống an toàn” |
| Blueprint SCADA | Hữu ích | Đúng hướng ISA/IEC 62443 + NIST 800-82 |
| Không over-claim “đã implement” | Tốt | Nhận ra 76 task chưa tick, module chưa tồn tại |

### 1.2 Điểm yếu / chỗ audit còn thiếu hoặc hơi lệch

| ID | Vấn đề trong `reivew.md` | Mức | Phân tích chuyên sâu |
|----|--------------------------|-----|----------------------|
| M-01 | **Scope inflation** — chấm “SCADA lớn 1.4/10” trên hồ sơ chỉ cover IAM | Trung bình | Đúng nếu goal là platform SCADA; **lệch** nếu goal chỉ là “module auth tốt hơn FUXA hiện tại”. Cần dual-score rõ ràng hơn. |
| M-02 | **Thiếu threat model formal** (STRIDE/LINDDUN/attack tree) | Cao | Audit liệt kê lỗ hổng nhưng chưa map actor × asset × entry-point × impact. |
| M-03 | **Thiếu đánh giá FUXA baseline** song song với “design mới” | Cao | Nhiều P0 là **lỗ hổng FUXA sẵn có** (JWT authority, 404 enumeration, INSERT OR REPLACE). Spec mới **kế thừa** chứ không chỉ “tự sinh”. |
| M-04 | **Chưa đủ sâu về dual-auth model** (`groups` integer vs `roles[]`) | Cao | Đây là architectural landmine: FUXA core vẫn đọc `groups`; module mới thêm `roles` trong JWT/info. Race semantic giữa hai mô hình. |
| M-05 | **Chưa phân tích Express router matching semantics đủ kỹ** | Trung bình | “Mount sau = shadow” đúng cho **cùng method+path** khi handler cũ `res.*` và không `next()`. Nhưng cần phân biệt: middleware chain, router mount order, path-prefix, và case “handler cũ next()”. |
| M-06 | **P0-10 bcrypt 72-byte** đúng kỹ thuật nhưng severity phụ thuộc policy length | Thấp–TB | Nếu validate max 72 UTF-8 bytes thì P-002 “đúng trong domain”. Vẫn nên flag là property statement **sai universal**. |
| M-07 | **Thiếu residual risk & residual accept criteria** | Trung bình | Blueprint SCADA hay, nhưng thiếu “MVP edge single-node chấp nhận được gì / không được gì”. |
| M-08 | **Chưa chạm script engine / Node-RED / command API surface** | Cao | Với SCADA, IAM không cô lập: script runtime, plugin npm, command endpoints, API keys là lateral movement paths. |
| M-09 | **Chưa đánh giá supply-chain & secret lifecycle** (`secretCode` fallback random per process) | Cao | `jwt-helper.js` tạo secret runtime nếu không cấu hình → restart invalidate tokens (có thể chấp nhận) nhưng **secret không durable** = session chaos + operational risk. |
| M-10 | **Điểm số hơi “cảm tính”** dù claim tốt | Thấp | Nên dùng weighted scoring có trọng số explicit (security 40%, integrity 20%, operability 15%…). |

### 1.3 Chấm meta-quality của `reivew.md`

| Hạng mục | Điểm | Nhận xét |
|---------|------|----------|
| Độ chính xác kỹ thuật (đã verify) | 9.0 | P0-01…P0-09 gần như solid |
| Độ đầy đủ trong phạm vi IAM | 7.5 | Thiếu dual-auth, API key, guest token, secureEnabled=false |
| Tách layer (design/impl/ops) | 8.0 | Tốt |
| Actionability | 8.5 | Gate 1–5 rõ |
| Calibration điểm số | 7.0 | Cần dual score IAM vs SCADA |
| Rigor formal methods / threat model | 6.0 | Có PBT awareness nhưng thiếu formal TM |
| **Tổng meta** | **8.4/10** | Audit chuyên nghiệp, dùng được làm decision input |

---

## 2. Xác minh độc lập các claim quan trọng (code-backed)

### 2.1 Hiện trạng implementation

| Kiểm tra | Kết quả | Ý nghĩa |
|---------|---------|---------|
| `server/auth-management/` | **Không tồn tại** | Guide = tài liệu, chưa code |
| `client/src/app/auth-management/` | **Không tồn tại** | UI module chưa code |
| Traceability Design→Task→Test | **pending** trong `traceability.md` | Drift control chưa đóng |
| Tasks checklist | Hầu hết unchecked; `*` tests optional | “HOÀN TẤT guide” ≠ “HOÀN TẤT feature” |

### 2.2 Ma trận verify P0

| ID | Claim `reivew.md` | Verify code/spec | Kết luận |
|----|-------------------|------------------|----------|
| **P0-01** Router shadow | FUXA mount `/api/signin`, `/api/users`… tại `server/api/index.js` ~70–77; guide mount **sau** cùng path | **CONFIRMED** | Express sẽ phục vụ handler cũ trước nếu cùng app stack và handler kết thúc response. Module mới “tồn tại trên giấy”. |
| **P0-02** mustRotate deadlock | Middleware/gate `mustRotate` trong guide; composition root **không** wire `Account_Service` / rotate endpoint | **CONFIRMED** | Admin seed bị khóa chức năng. |
| **P0-03** Migration lockout | Guide bootstrap/migration đổi secret; operator không nhận secret an toàn | **CONFIRMED (design)** | Admin lockout risk trên upgrade. |
| **P0-04** Secret in log | `discloseSecret` → `runtime.logger.info(... password ...)` trong guide 11-task-13 | **CONFIRMED** | Credential disclosure qua log pipeline. |
| **P0-05** Deleted user giữ admin | Middleware chỉ live-load `mustRotate`; `groups/roles` từ JWT | **CONFIRMED (design)** + **FUXA baseline cũng JWT-authority** | Thu hồi quyền không immediate. |
| **P0-06** Refresh rotation giả | FUXA `auth/index.js` rotate cookie nhưng **không store jti/family/revoke**; guide Token_Service tương tự | **CONFIRMED** | Replay refresh token cũ vẫn possible (stateless). |
| **P0-07** No real transaction | Guide 02 thừa nhận 2 connection; design yêu cầu atomic 2-step | **CONFIRMED** | Spec tự mâu thuẫn; crash = partial write. |
| **P0-08** last-admin race | Check-then-act không lock | **CONFIRMED (logic)** | TOCTOU classic. |
| **P0-09** INSERT OR REPLACE | `usrstorage.setUser` / `setRoles` dùng `INSERT OR REPLACE` | **CONFIRMED** | “PK rejects duplicate” là **sai** với SQLite semantics này. |
| **P0-10** bcrypt 72-byte | bcryptjs truncate 72 bytes; P-002 universal claim | **CONFIRMED** | Property overstated. |

### 2.3 Claim P1 — xác minh nhanh

| Claim | Verify | Ghi chú bổ sung |
|-------|--------|-----------------|
| `/api/refresh` bị guide bỏ qua | **CONFIRMED** | Router auth guide chỉ signin/signout; comment “tối giản”. |
| Bootstrap async không await ready | **CONFIRMED** | `ready = runBootstrap(...).catch` — race request vs seed. |
| JWT thiếu alg/iss/aud/jti | **CONFIRMED** | `jwt.verify(token, secretCode)` không `algorithms: ['HS256']`. |
| Username enumeration 404 vs 401 | **CONFIRMED** | `auth/index.js` và guide copy hành vi này. |
| Token sessionStorage / `window.fuxaAccessToken` | **CONFIRMED** (design D-011) | XSS = full session theft. |
| Hard lockout DoS | **Plausible** | Design brute-force; OT operator impact cao. |
| Audit 1MB×5 + swallow errors | **CONFIRMED design** | Không compliance-grade. |
| Tests optional | **CONFIRMED** | `tasks.md` Notes line explicit. |

---

## 3. Kiến trúc: chỗ “đúng pattern” và chỗ “sai struct”

### 3.1 Pattern đang dùng (as-designed)

```
UI (Angular)
   ↓ HTTP
API routers + middleware
   ↓
Services (“pure” claimed)
   ↓ ports
Adapters → FUXA runtime (users, jwt, bcrypt, logger)
```

Đây là **Modular Monolith + Hexagonal (ports/adapters)** — lựa chọn **đúng** cho FUXA hiện tại.  
**Không** nên nhảy microservice IAM lúc này.

### 3.2 Anti-patterns & structural defects

#### A. “Pure service” giả (False purity)

Guide/design gắn nhãn Service layer là “pure logic / PBT-testable”, nhưng:

- `Authentication_Service` phụ thuộc store, hasher, brute-force, audit (I/O).
- `User_Service` phụ thuộc persistence + password hashing.
- Chỉ policy functions (`isAllowed` thuần quyết định từ identity snapshot) mới thực sự pure.

**Hậu quả:** Property-based tests hoặc bị mock hóa sai, hoặc không test được concurrency/persistence invariants — đúng chỗ cần PBT nhất.

**Pattern đúng:**

```
Domain policy (pure)     → Decision, PasswordPolicy, RoleInvariants
Application use-case     → transaction boundary, orchestration
Adapters                 → SQLite, JWT, HTTP, clock, entropy
```

#### B. Transaction boundary đặt sai layer

Invariant “user row + password hash atomic” bị đẩy xuống adapter hack 2-step:

1. `setUsers` (no password) → metadata  
2. raw `UPDATE password` connection khác  

Đây là **Split-Write Anti-Pattern** trên SQLite single-writer mà **không** dùng chung connection/transaction.

**Struct đúng:**

- Mở rộng port: `UserStore.save(user, { passwordHash })` **một** command  
- Persistence adapter mở **một** `db.serialize` / explicit `BEGIN IMMEDIATE`  
- Hoặc migration schema: password hash là cột trong cùng row write path, bypass double-hash bằng flag `passwordAlreadyHashed`

#### C. Authority-in-token (Capability token sai chỗ)

FUXA baseline + design mới đều nhét `groups` (và design thêm `roles`) vào access JWT.

| Mô hình | Phù hợp khi | FUXA/IAM hiện tại |
|---------|-------------|-------------------|
| **Capability token** (permissions trong JWT) | TTL cực ngắn, revocation list, low-risk API | Không |
| **Identity token + server-side authority** | IAM/RBAC có revoke, disable, role change | **Bắt buộc** |

Hiện tại là capability-ish token **không** có revocation → **confused deputy / stale admin** sau delete/disable/role change.

#### D. Dual authority models (chưa được `reivew.md` đào đủ sâu)

FUXA core:

- `groups` integer: `-1` / `255` = admin (`jwt-helper.adminGroups`)
- optional `userRole` path đọc roles từ store trong một số flow
- API keys riêng (`apikeys`)

Design mới:

- `roles[]` first-class + permissions set
- vẫn giữ `groups` “for compatibility”

**Rủi ro struct:**

1. Admin qua `groups=-1` **bypass** permission set tinh vi.  
2. Token có `roles` cũ + store đã prune → inconsistency.  
3. UI/API mới authorize theo permission; endpoint FUXA cũ authorize theo groups → **policy split brain**.  
4. Cutover “1 dòng mount” **không** thay `verifyGroups` toàn hệ thống → RBAC mới chỉ bảo vệ router mới (mà router mới còn bị shadow).

Đây là **architectural incomplete migration**, không chỉ bug route.

#### E. Composition root “1 dòng chạm FUXA” là ảo tưởng nguy hiểm

D-003 tối ưu conflict merge, nhưng IAM **không thể** an toàn nếu:

- không thay auth routes cũ,
- không thay authorization middleware toàn cục,
- không đồng bộ session validation cho project/scripts/command/daq APIs,
- không đụng guest token path.

**Truth:** cutover IAM tối thiểu cần **composition root rewrite** của `server/api/index.js` auth stack, không phải 1 dòng.

#### F. SQLite + in-process state = vertical scale ceiling

| State | Vị trí | Multi-instance |
|------|--------|----------------|
| Users/roles | SQLite file | Single writer, lock contention |
| Brute-force counters | per-process memory (design) | Threshold nhân theo node |
| Refresh validity | JWT stateless | Không revoke cross-node |
| usersMap cache | process memory | Stale across nodes |
| Audit | local rotating files | Mất khi disk/node mất |

Kết luận: HA active-active **không khả thi** với design hiện tại. Active-passive cần file lock + fencing — chưa thiết kế.

#### G. Security logging ≠ Audit system

Audit sink = `fuxa.log` rotate nhỏ, fail-open (nuốt lỗi), thiếu:

- hash chain / WORM  
- correlation id  
- before/after  
- non-repudiation  
- separate failure domain  

Với OT compliance (IEC 62443-3-3, audit requirements) đây là **control gap**, không phải “nice to have”.

---

## 4. Rủi ro theo góc nhìn chuyên gia (mở rộng hơn `reivew.md`)

### 4.1 Bảng rủi ro (Likelihood × Impact)

Thang: L/I = 1–5; Score = L×I.

| RID | Rủi ro | L | I | Score | Nguồn | Ghi chú |
|-----|--------|---|---|-------|-------|---------|
| R-01 | Module mới không hiệu lực (router shadow) → false sense of security | 5 | 5 | **25** | Spec cutover | Deploy “xong” nhưng auth cũ vẫn chạy |
| R-02 | Stale JWT admin sau delete/disable/role change | 5 | 5 | **25** | JWT authority | Privilege persistence |
| R-03 | Refresh token replay (stateless rotation) | 4 | 5 | **20** | auth + design | Session hijack kéo dài |
| R-04 | Bootstrap/migration admin lockout | 4 | 5 | **20** | bootstrap guide | Mất control plane |
| R-05 | Admin password in log | 5 | 4 | **20** | composition root | Secret sprawl |
| R-06 | Partial write user/password (no TX) | 3 | 5 | **15** | adapter 2-step | Auth corruption |
| R-07 | last-admin TOCTOU → zero admin | 3 | 5 | **15** | user delete | Lockout + recovery hell |
| R-08 | Concurrent create overwrite (INSERT OR REPLACE) | 3 | 4 | **12** | usrstorage | Integrity/IDOR-ish |
| R-09 | Username enumeration | 5 | 2 | **10** | signin codes | Recon |
| R-10 | XSS → token theft (sessionStorage + window global) | 3 | 5 | **15** | client design | Full account takeover |
| R-11 | Hard lockout DoS operator | 4 | 4 | **16** | brute-force | OT availability hit |
| R-12 | Guest token auto-issue path | 4 | 3 | **12** | jwt-helper | AuthZ confusion nếu secureEnabled lỏng |
| R-13 | Algorithm confusion / none alg (no algorithms allow-list) | 2 | 5 | **10** | jwt.verify usage | Phụ thuộc library defaults; vẫn phải pin alg |
| R-14 | `secretCode` ephemeral / weak ops handling | 3 | 4 | **12** | jwt-helper init | Restart/session invalidation; secret mgmt kém |
| R-15 | Script/plugin/command surface ngoài RBAC mới | 4 | 5 | **20** | FUXA platform | IAM “đẹp” nhưng bypass qua automation |
| R-16 | API key auth parallel path | 3 | 4 | **12** | apikeys | Second identity plane không cùng audit model |
| R-17 | Node-RED integration token checks drift | 3 | 4 | **12** | integrations | Inconsistent gate |
| R-18 | Clock-dependent lockout without monotonic/time policy | 2 | 3 | **6** | brute-force | Edge case |
| R-19 | Audit loss on disk full / rotation | 3 | 4 | **12** | audit design | Compliance failure |
| R-20 | False green from optional tests | 5 | 4 | **20** | tasks.md | Process risk: ship broken IAM |

### 4.2 Kill-chain minh họa (stale admin)

```
1. Attacker lấy access token admin (XSS / log / network)
2. Operator xóa user attacker hoặc downgrade role
3. Middleware (design) vẫn tin groups/roles trong JWT
4. Attacker gọi API privileged đến khi access token hết hạn
5. Nếu có refresh token đã đánh cắp: gia hạn gần như vô hạn (stateless)
```

Mitigation tối thiểu: live account lookup + `tokenVersion`/`sessionVersion` + refresh store + logout revoke family.

### 4.3 Kill-chain (false secure deploy)

```
1. Team implement đúng guide, mount 1 dòng sau authApi
2. Integration test gọi service trực tiếp (bypass router) → pass
3. Production traffic hit /api/signin cũ
4. mustRotate, audit, RBAC middleware không chạy
5. Dashboard “auth-management done” → residual risk ẩn
```

Đây là lý do P0-01 phải là **release blocker tuyệt đối**.

---

## 5. Đánh giá pattern/struct theo từng bounded concern

### 5.1 Authentication

| Khía cạnh | Hiện trạng FUXA | Spec mới | Gap |
|----------|-----------------|----------|-----|
| Credential verify | bcrypt compare sync | Tương tự + brute-force | OK hướng |
| Enumeration | 404/401 split | **Giữ nguyên lỗi** | Cố ý copy anti-pattern |
| MFA / step-up | Không | Không | Thiếu cho remote/admin |
| IdP federation | Không | Không | Enterprise blocker |
| Timing safety | compareSync + early branch user missing | Chưa normalize response time | Side channel nhẹ |

### 5.2 Session / Token

| Khía cạnh | Cần | Thực tế |
|----------|-----|---------|
| Access token claims | `sub`, `iss`, `aud`, `iat`, `exp`, `jti`, `typ` | Chủ yếu `id`, `groups` (+roles design) |
| Alg pin | `algorithms: ['HS256']` | Không |
| Refresh rotation | server-side family + reuse detection | Cookie rewrite only |
| Logout | revoke server-side | clear cookie only |
| Session inventory | list/revoke sessions | Không |
| Binding | device/IP/UA step-up (optional) | Không |

### 5.3 Password

| Khía cạnh | Cần | Thực tế |
|----------|-----|---------|
| Hash | Argon2id (ưu tiên) hoặc bcrypt cost≥12 + max length | bcryptjs cost 10 baseline; design cost 12 |
| 72-byte hazard | validate/normalize | P-002 phủ nhận thực tế |
| Policy | length≥15 (NIST single-factor guidance direction), blocklist | Yếu/không đầy đủ |
| Rotation ceremony | dedicated endpoint + audit | missing wire |
| Default password | never | FUXA default `123456` vẫn là legacy risk |

### 5.4 RBAC

| Khía cạnh | Cần | Thực tế |
|----------|-----|---------|
| Permission model | resource:action (+ scope) | permission strings phẳng |
| Scope OT | site/area/asset | Không |
| Separation of duties | dual control dangerous ops | Không |
| Admin invariant | DB constraint / serializable TX | check-then-act memory-level |
| Enforcement point | single PDP for all APIs | split: old groups vs new roles |

### 5.5 Persistence

| Khía cạnh | Cần | Thực tế |
|----------|-----|---------|
| Unique create | INSERT + catch constraint | INSERT OR REPLACE |
| TX | BEGIN IMMEDIATE multi-statement | 2 connections |
| Migrations | versioned schema | ad-hoc ALTER columns |
| Integrity | FK role assignments | roles embedded JSON in `info` |
| Backup consistency | consistent snapshot users+roles+sessions | file copy ad-hoc |

### 5.6 Observability / Audit

| Khía cạnh | Cần | Thực tế |
|----------|-----|---------|
| Sink isolation | separate audit store | app log |
| Integrity | append-only / hash chain | rotate overwrite |
| Schema | actor, target, action, result, reason, src, session, corr | thin |
| Fail policy | fail-closed or buffered durable | swallow |

---

## 6. Mâu thuẫn nội tại của hồ sơ `.kiro` (architecture debt in docs)

Những mâu thuẫn sau là **defect của specification**, không phải “chưa implement”:

1. **Design atomic TX** vs **Guide multi-connection no TX**  
2. **Design full refresh** vs **Guide omit `/api/refresh`**  
3. **Design mustRotate gate** vs **No rotate route in composition root**  
4. **“Out-of-band secret”** vs **log plaintext password**  
5. **“PK prevents race”** vs **INSERT OR REPLACE semantics**  
6. **P-010 last-admin** vs **no concurrency model**  
7. **P-002 universal** vs **bcrypt 72-byte**  
8. **Traceability “pending”** vs narrative “tasks generated / guide complete”  
9. **D-003 minimal core touch** vs **real cutover needs global PDP replacement**  
10. **Service pure** vs **services with I/O side effects**

Một spec có decision ledger tốt nhưng **self-inconsistent** thì implementer sẽ “chọn nhánh tiện” → entropy tăng.

---

## 7. FUXA baseline risks mà design mới đang **kế thừa** (không chỉ “thêm”)

`reivew.md` tập trung spec mới; dưới đây là nợ sẵn có trong code production:

| Baseline issue | File | Risk |
|----------------|------|------|
| Default admin `123456` on empty DB | `usrstorage.setDefault` | Known credential |
| JWT secret fallback random in-process | `jwt-helper.js` | Ops fragility |
| No alg allow-list | `jwt.verify(token, secretCode)` | Hardening gap |
| Guest token minting when missing token | `verifyToken` | Ambiguous auth state |
| Refresh stateless | `api/auth/index.js` | Replay |
| Groups authority in token | access token payload | Stale privileges |
| Username enumeration | signin 404/401 | Recon |
| INSERT OR REPLACE users/roles | `usrstorage.js` | Integrity |
| Large body parser default `100mb` | `api/index.js` | DoS surface |
| secureEnabled=false trusted mode | SECURITY.md | Footgun deploy |

**Hệ quả:** module auth-management nếu chỉ “bọc” baseline mà không remediation sẽ **đóng gói lại lỗ hổng cũ** dưới kiến trúc mới.

---

## 8. Chấm điểm lại (dual score — sửa calibration)

### 8.1 Nếu mục tiêu = “IAM module thay auth FUXA tốt hơn, single-node edge”

| Hạng mục | Trọng số | Điểm | Có trọng số |
|---------|----------|------|-------------|
| Requirements & docs structure | 10% | 7.0 | 0.70 |
| Module boundaries | 10% | 7.0 | 0.70 |
| AuthN correctness | 15% | 2.5 | 0.38 |
| AuthZ/session revoke | 15% | 2.0 | 0.30 |
| Persistence integrity | 15% | 2.0 | 0.30 |
| Cutover/integration realism | 15% | 1.5 | 0.23 |
| Audit/compliance | 10% | 2.5 | 0.25 |
| Testability & traceability | 10% | 4.0 | 0.40 |
| **Tổng** | 100% | | **≈ 3.3/10** |

### 8.2 Nếu mục tiêu = “nền tảng SCADA lớn / multi-site OT”

| Hạng mục | Điểm | Lý do ngắn |
|---------|------|------------|
| Zone/conduit, DMZ | 1.0 | Không có |
| Command safety / SBO | 1.0 | Ngoài scope, chưa thiết kế |
| Alarm lifecycle | 1.0 | FUXA alarms ≠ ISA-18.2 philosophy |
| Historian/HA/DR | 1.5 | SQLite/local files |
| Identity enterprise (LDAP/OIDC/mTLS) | 1.0 | Không |
| IAM foundation (từ 8.1) | 3.3 | Vẫn yếu |
| **Tổng blended** | **≈ 1.4/10** | Khớp tinh thần `reivew.md` |

### 8.3 Điểm của chính `reivew.md` với tư cách audit artifact

**8.4/10** — nên dùng làm input Gate 0; không đủ thay threat model + ADR pack.

---

## 9. Những chỗ `reivew.md` đúng nhưng cần “siết” thành requirement

Chuyển từ “nhận xét audit” → **acceptance gates** (để không bị ignore):

| Gate ID | Acceptance criterion (testable) |
|---------|----------------------------------|
| G-CUT-01 | Request `POST /api/signin` chỉ đi qua module mới; handler FUXA cũ **không** còn registered hoặc bị hard-disabled. |
| G-AUTHZ-01 | User bị delete/disable → access token cũ bị reject trong ≤ 1 request tiếp theo (live lookup). |
| G-AUTHZ-02 | Role revoke/downgrade có hiệu lực trước hết hạn access token (version check hoặc live resolve). |
| G-REF-01 | Refresh token reuse sau rotate → family revoke + 401; token cũ không issue access mới. |
| G-TX-01 | Crash injection giữa các bước persist user **không** để lại password null / metadata lệch (TX hoặc single statement). |
| G-ADM-01 | Concurrent delete 2 admin cuối: ≥1 admin còn lại (property concurrent, not only sequential). |
| G-BOOT-01 | Bootstrap secret không xuất hiện trong log files; recovery qua console ceremony có audit. |
| G-ROT-01 | `mustRotate=true` có endpoint rotate khả dụng; mọi API khác 403. |
| G-JWT-01 | `jwt.verify` pin algorithm; claims có `typ` access/refresh tách; reject missing/invalid typ. |
| G-AUD-01 | Audit failure được metric/alert; audit events critical không chỉ best-effort log. |
| G-TEST-01 | Không còn security property test “optional” trên critical path. |

---

## 10. Kiến trúc đích đề xuất (realistic cho FUXA, không ảo tưởng microservice)

### 10.1 Target modular monolith (IAM slice)

```
server/
  identity/                      # bounded context
    domain/
      password-policy.js         # pure
      admin-invariant.js         # pure
      permission-catalog.js      # pure
    app/
      sign-in.js                 # use case + TX boundary
      rotate-password.js
      user-commands.js
      role-commands.js
      session-service.js         # refresh family, revoke
    ports/
      user-repository.js
      session-repository.js
      clock.js
      entropy.js
      audit-port.js
    adapters/
      sqlite-user-repository.js  # ONE db handle, TX
      sqlite-session-repository.js
      jwt-access-token.js
      fuxa-logger-audit.js       # temporary
      secure-audit-sink.js       # later
    api/
      routes.js                  # owns /api/v1/auth/* during migration
      middleware.js              # global PDP adapter
    composition.js
```

### 10.2 Cutover strategy (bắt buộc, không “1 dòng”)

**Phase A — Parallel namespace**

- Ship `/api/v1/identity/*` đầy đủ  
- Không đụng URL cũ  
- Feature flag  

**Phase B — PDP unification**

- `verifyGroups` / `authMiddleware` ủy quyền sang identity middleware  
- Live account resolve cho **mọi** protected route (project, scripts, command, daq…)  

**Phase C — Atomic URL cutover**

- Gỡ `authApi`/`usersApi` handlers cũ hoặc biến thành thin proxy  
- Contract test: old clients still work  

**Phase D — Decommission**

- Xóa dead code paths, dual writes, compatibility shims  

### 10.3 Session model khuyến nghị

```
Access Token (short, 5–15m):
  { typ:"access", sub, ver, sid, iss, aud, iat, exp, jti }
  // KHÔNG chứa permissions dài hạn; optional cache hint only

Refresh Token (opaque or JWT with jti only):
  stored server-side: hash(jti), family_id, user_id, ver, revoked_at

On each request:
  verify signature+exp+typ
  load user by sub
  reject if missing/disabled/deleted
  reject if token.ver != user.sessionVersion
  resolve permissions from live roles
```

### 10.4 Persistence khuyến nghị tối thiểu (SQLite single-node)

```sql
BEGIN IMMEDIATE;
-- create user
INSERT INTO users(...);           -- fail on conflict, NOT OR REPLACE
UPDATE users SET password=? ...;
-- admin invariant can be enforced with a conditional
-- or a singleton security_state row locked in same TX
COMMIT;
```

Roles assignment: bảng quan hệ `user_roles(user, role_id)` thay vì chỉ JSON `info.roles` nếu cần prune atomic.

---

## 11. Lộ trình chuyên gia (sửa & siết so với Gate 1–5 của `reivew.md`)

### Gate 0 — Freeze & re-scope (mới, bắt buộc)

1. Chốt dual goal: **(A) IAM hardening single-node** vs **(B) SCADA platform**.  
2. Nếu goal A: blueprint SCADA là backlog riêng, không chặn IAM MVP.  
3. Nếu goal B: IAM chỉ là PR1 trong chương trình lớn.  
4. Viết threat model (STRIDE) cho login, refresh, user admin, role admin, bootstrap, API keys, scripts.

### Gate 1 — Spec repair (trước mọi code)

- ADR-001 Router cutover strategy  
- ADR-002 Session authority live + token version  
- ADR-003 Refresh family store  
- ADR-004 Persistence TX model on FUXA SQLite  
- ADR-005 Bootstrap/recovery ceremony (no log secrets)  
- ADR-006 Dual groups/roles deprecation plan  
- Fix P-002 domain; fix traceability matrix; remove optional on security tests  

### Gate 2 — Vertical slice implement

Thứ tự code an toàn:

1. Session repository + token profile  
2. User repository TX  
3. Sign-in/refresh/sign-out  
4. Live AuthZ middleware  
5. User/role CRUD + admin invariant  
6. Bootstrap without log disclosure  
7. Client storage strategy (prefer memory + refresh cookie; harden XSS assumptions)  

### Gate 3 — Concurrency & chaos tests (non-optional)

- parallel last-admin deletes  
- parallel same-username creates  
- refresh replay  
- delete user while token in use  
- kill -9 giữa TX steps (hoặc fault inject)  
- bootstrap double-start  

### Gate 4 — Platform expansion (chỉ nếu goal B)

Giữ blueprint `reivew.md` §5–6; thêm:

- API keys vào cùng identity plane  
- Script execution permission scopes  
- Command authorization separate from telemetry read  
- Audit sink externalizable  

### Gate 5 — Production accept

Không gọi “xong” nếu còn P0/P1 security mở, hoặc test critical optional.

---

## 12. Quyết định khuyến nghị (recommendation record)

| Quyết định | Khuyến nghị |
|-----------|-------------|
| Implement guide hiện tại as-is? | **REJECT** |
| Có giá trị salvage từ `.kiro`? | **YES** — requirements structure, decision log, module boundary intent, nhiều AC |
| Rewrite lớn nhất cần làm? | Session authority + cutover + TX persistence + bootstrap ceremony |
| Microservice tách IAM? | **NO** (hiện tại) |
| Modular monolith identity BC? | **YES** |
| Có thể ship partial (chỉ password policy)? | Chỉ như **internal hardening PR**, không marketing “RBAC module complete” |
| `reivew.md` dùng làm gì tiếp? | Làm **baseline defect list**; promote P0 → ADR + AC; bổ sung R-12…R-20 từ tài liệu này |

---

## 13. Phụ lục A — Checklist review nhanh cho PR tương lai

- [ ] Có ADR cho mọi thay đổi auth surface  
- [ ] Không mount overlapping routes “thêm” mà không disable cũ  
- [ ] Mọi protected route đi qua live identity resolve  
- [ ] Refresh có server-side revoke/reuse detection  
- [ ] Không log secrets/passwords/tokens  
- [ ] SQLite writes critical nằm trong `BEGIN IMMEDIATE`  
- [ ] Không `INSERT OR REPLACE` cho create-user semantics  
- [ ] Admin invariant concurrent test xanh  
- [ ] JWT pin `algorithms`  
- [ ] Access token không phải nguồn permissions duy nhất  
- [ ] Security tests không optional  
- [ ] Traceability REQ→DES→TASK→TEST đóng  

## 14. Phụ lục B — Mapping ngắn `reivew.md` → action owner

| Mục `reivew.md` | Action | Owner gợi ý |
|-----------------|--------|-------------|
| P0-01 | ADR cutover + remove/shadow old routers | Tech lead backend |
| P0-02/03/04 | Bootstrap ceremony redesign | Security + backend |
| P0-05/06 | Session model redesign | Backend IAM |
| P0-07/08/09 | Persistence TX + constraints | Backend + data |
| P0-10 | Password policy domain fix | Security eng |
| P1 list | Backlog ranked by Score L×I | PM + eng |
| SCADA blueprint | Program epic riêng | Architecture board |

---

## 15. Kết luận cuối

1. **`reivew.md` là một audit tốt**, claim P0 gần như đều verify được trên spec + code FUXA.  
2. **Hồ sơ `.kiro` có tư duy tài liệu đáng giữ**, nhưng **self-contradiction** ở cutover, session, transaction, bootstrap khiến nó **chưa phải implementation blueprint an toàn**.  
3. **FUXA baseline đã mang sẵn nhiều anti-pattern IAM**; design mới đang reuse primitives theo hướng tương thích → **kế thừa rủi ro** thay vì dập tắt.  
4. Pattern đúng cần neo là: **Modular monolith Identity BC + live PDP + TX repository + refresh family store + atomic cutover**.  
5. Vá nhỏ (“thêm middleware”, “thêm 1 dòng mount”, “thêm mustRotate flag”) **không** đưa hệ thống từ ~3/10 lên production-grade.  

**Chỉ thị kỹ thuật:**  
**STOP implementation → repair specification & ADRs → prove concurrent invariants → then build.**

---

*Tài liệu này đánh giá `reivew.md` và hồ sơ thiết kế; không sửa code production. Mọi path dẫn chiếu đã được đối chiếu tại thời điểm 2026-07-12.*
