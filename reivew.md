
Kết luận thẳng: thiết kế hiện tại chưa thể đạt 10/10 và chưa nên triển khai. Đây là một hồ sơ IAM/RBAC có tư duy tài liệu tốt, nhưng tính sẵn sàng production chỉ khoảng 3,2/10; nếu xem nó là kiến trúc toàn bộ SCADA lớn thì chỉ khoảng 1,4/10.
Mình đã audit 37 tài liệu, 12.202 dòng, đối chiếu trực tiếp với code FUXA hiện tại. Không sửa file nào vì yêu cầu lần này là đánh giá.

1. Chấm điểm
   Hạng mục	Điểm	Nhận xét
   Requirements-first, tài liệu	7,0	Có REQ/AC/DES/P/TASK và decision ledger khá tốt
   Phân lớp, module boundary	7,0	Modular monolith + adapter là hướng đúng
   Traceability thực tế	4,5	Ma trận Design→Task→Test vẫn pending, nhiều trạng thái cũ
   Khả năng tích hợp FUXA	1,5	Router bị shadow, refresh/rotation không được wire
   Authentication/session	2,5	JWT và refresh có nhiều lỗ hổng thiết kế
   Data integrity/concurrency	2,0	Nhiều invariant chỉ đúng khi chạy tuần tự
   Audit/compliance	2,5	Log chung, dễ mất, không tamper-evident
   HA/horizontal scaling	1,0	Hầu hết state per-process, SQLite đơn node
   Phù hợp OT/SCADA	1,5	Chưa có zone/conduit, command safety, alarm lifecycle
   Khả năng kiểm chứng	4,5	Có PBT nhưng test lại được đánh dấu optional

Điểm tổng hợp theo mục tiêu “một SCADA lớn”: 3,1/10.
2. Các blocker nghiêm trọng nhất
P0-01 — Router mới gần như không bao giờ được chạy
Guide yêu cầu mount module sau các router FUXA, nhưng router FUXA đã đăng ký /api/users, /api/roles, /api/signin, /api/refresh, /api/signout trước đó tại [server/api/index.js (line 70)](C:/Users/toann/Desktop/WORK_PRO/FUXA/server/api/index.js:70).
Module mới lại dùng chính các URL này và được mount sau router cũ tại [11-task-13-api.md (line 218)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/guide/11-task-13-api.md:218). Express sẽ kết thúc response ở handler cũ, nên middleware RBAC và service mới không được gọi.
Hệ quả:
Login vẫn chạy logic FUXA cũ.
User/role CRUD vẫn dùng admin-group cũ.
Brute-force guard, audit và mustRotate không thực sự bảo vệ endpoint.
Tài liệu có thể “pass unit test” nhưng hệ thống chạy thật vẫn sai.
Phải chọn một trong hai chiến lược rõ ràng:
Thay thế router cũ tại composition root, hoặc
Dùng namespace mới như /api/v2/identity/*, migration xong mới cutover atomically.
P0-02 — Admin bootstrap tạo ra tài khoản không thể đổi mật khẩu
Guide tạo Account_Service, nhưng composition root không import, instantiate hoặc mount endpoint đổi mật khẩu; xem danh sách wiring tại [11-task-13-api.md (line 163)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/guide/11-task-13-api.md:163).
Admin được gắn mustRotate=true, trong khi không có route khả dụng để thực hiện account.rotatePassword. Đây là deadlock chức năng.
P0-03 — Migration có thể khóa vĩnh viễn tài khoản admin
Migration thay password 123456 bằng secret ngẫu nhiên tại [10-task-12-bootstrap.md (line 73)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/guide/10-task-12-bootstrap.md:73), nhưng secret mới không được trả hoặc chuyển cho operator.
Kết quả:
Password cũ không còn hợp lệ.
Password mới không ai biết.
Admin không thể login để rotate.
Hệ thống mất quyền quản trị.
Migration credential không được tự động đổi secret theo cách này. Nên dùng một trong các phương án:
CLI tương tác tại console được kiểm soát.
One-time enrollment token có TTL và hash-at-rest.
Recovery ceremony có dual control.
Giữ password hiện tại nhưng buộc step-up/rotation sau lần login hợp lệ.
P0-04 — Secret bootstrap bị ghi thẳng vào log
Guide tuyên bố “không log plaintext” tại [guide/README.md (line 33)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/guide/README.md:33), nhưng composition root lại ghi mật khẩu admin vào fuxa.log tại [11-task-13-api.md (line 202)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/guide/11-task-13-api.md:202).
Đây là credential disclosure, không phải “out-of-band secure channel”. Log có thể được backup, ship, đọc bởi support, operator hoặc malware.
P0-05 — User đã xóa vẫn có thể giữ quyền admin
Authorization middleware chỉ đọc live store để lấy mustRotate; groups và roles vẫn lấy từ JWT tại [11-task-13-api.md (line 39)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/guide/11-task-13-api.md:39).
Nếu user đã bị xóa:
userStore.get() trả rỗng.
mustRotate trở thành false.
groups=-1 cũ trong token vẫn được tin.
Authorization vẫn cấp toàn bộ admin permission cho đến khi token hết hạn.
Tương tự, việc gỡ role, downgrade group hoặc disable account không có hiệu lực ngay.
Cần dựng identity từ trạng thái hiện hành:
verified token
    → lookup current account
    → reject missing/disabled/deleted
    → check sessionVersion/tokenVersion
    → load current groups + role assignments
    → resolve permissions
JWT chỉ nên mang identity/session reference, không phải authority không thể thu hồi.
P0-06 — “Refresh token rotation” không thật sự rotation
Token_Service.refresh() tạo token mới nhưng không lưu jti, token family, trạng thái đã sử dụng hoặc revoke token cũ tại [04-task-5-token-service.md (line 118)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/guide/04-task-5-token-service.md:118).
Token cũ vẫn có thể replay nhiều lần. Sign-out chỉ xóa cookie phía trình duyệt, không vô hiệu hóa token bị đánh cắp.
RFC 9700 yêu cầu refresh rotation phải vô hiệu token cũ và giữ quan hệ token-family để phát hiện reuse. Cần có:
family_id, jti, parent_jti
hash refresh token trong store
used/revoked/expired state
atomic consume-and-rotate
family revocation khi phát hiện replay
revoke khi logout, password change, disable hoặc role-sensitive event
P0-07 — Persistence được mô tả transaction nhưng guide thừa nhận không transaction
Design bắt buộc hai bước ghi user nằm trong một transaction tại [06-persistence-and-serialization.md (line 400)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/design/06-persistence-and-serialization.md:400).
Guide lại mở kết nối SQLite thứ hai và thừa nhận hai bước không thể nằm trong cùng transaction tại [02-task-2-luu-tru.md (line 31)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/guide/02-task-2-luu-tru.md:31).
Crash giữa hai bước có thể để lại:
User không password.
Metadata mới nhưng password cũ.
Cache đã cập nhật nhưng DB password chưa cập nhật.
API trả lỗi dù một phần thay đổi đã commit.
Đánh giá “hiếm và tự lành” là không đủ cho IAM, càng không đủ cho SCADA.
Cách đúng:
Mở rộng persistence port của FUXA để có một transaction duy nhất nhận hash verbatim; hoặc
Dùng dedicated IAM database có transaction, unique constraints và migration chính thức.
P0-08 — Invariant “luôn còn ít nhất một admin” sai khi concurrent
Logic hiện tại:
Đọc target.
Đếm admin còn lại.
Xóa.
Hai admin A và B bị xóa đồng thời có thể cùng nhìn thấy “admin còn lại”, rồi cùng xóa thành zero-admin. Logic nằm tại [08-task-9-user-crud.md (line 94)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/guide/08-task-9-user-crud.md:94).
P-010 chỉ kiểm chuỗi tuần tự, không kiểm interleaving/concurrency. Cần transaction với:
row/advisory lock trên singleton security state;
serializable isolation; hoặc
invariant enforced ở persistence command duy nhất.
Bootstrap nhiều node cũng có race tương tự.
P0-09 — Duplicate-create không an toàn
Design tuyên bố primary key sẽ từ chối concurrent create tại [04-user-management.md (line 541)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/design/04-user-management.md:541), nhưng FUXA sử dụng INSERT OR REPLACE.
Concurrent create có thể overwrite record vừa tạo. Đây là sai lệch trực tiếp giữa design và persistence semantics.
P0-10 — Property password P-002 là sai về toán học
P-002 tuyên bố mọi hai password khác nhau phải không verify chéo tại [03-password-security.md (line 304)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/design/03-password-security.md:304).
Bcrypt chỉ xử lý 72 byte đầu. Mình đã kiểm chứng ngay với dependency hiện tại:
A = "a" × 72 + "X"
B = "a" × 72 + "Y"
A != B
bcrypt.compare(B, bcrypt.hash(A)) == true
Do đó P-002 không thể đúng nếu input cho phép chuỗi dài/Unicode tùy ý.
Cần:
Quy định và validate giới hạn byte UTF-8 tương thích bcrypt; hoặc
Chuyển sang Argon2id với migration scheme/version; hoặc
Nếu pre-hash, phải thiết kế domain separation và migration rất cẩn thận.
Ngoài ra chưa có password blocklist, compromised-password checking hay policy đầy đủ. NIST SP 800-63B-4 yêu cầu tối thiểu 15 ký tự cho password single-factor và so với blocklist password phổ biến/đã lộ.
3. Các rủi ro P1
/api/refresh bị guide bỏ qua dù task và requirement yêu cầu đầy đủ; xem [11-task-13-api.md (line 86)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/guide/11-task-13-api.md:86).
Bootstrap chạy nền, router nhận request ngay và ready không được await.
JWT không khóa algorithms, không có iss, aud, sub, jti, explicit token type hoặc key rotation. Đây là các kiểm soát trọng yếu trong RFC 8725.
Login trả 404 cho username không tồn tại và 401 cho password sai, tạo username-enumeration oracle.
Access token nằm trong sessionStorage và window.fuxaAccessToken tại [07-ui-login-page.md (line 268)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/design/07-ui-login-page.md:268), nên XSS có thể lấy token.
Guide mới luôn ghi token vào sessionStorage, trong khi code FUXA hiện tại đã cố tránh lưu token khi refresh-cookie mode được bật.
Không có MFA, WebAuthn, OIDC/SAML/LDAP/Active Directory, account disable, session inventory, forced logout hoặc access review.
Hard account lock 15 phút tạo DoS rất dễ đối với operator SCADA. NIST khuyến nghị throttling và tăng delay thích ứng để giảm nguy cơ attacker khóa user hợp lệ; xem NIST SP 800-63B-4, Rate Limiting.
Brute-force state per-process; khi chạy nhiều node, threshold bị nhân theo số node.
Date.now() dùng cho lockout, không có chính sách clock/NTP drift. Clock nhảy tiến có thể kết thúc lockout sớm.
Role delete prune từng user rồi xóa từng role, không transaction; failure giữa chừng tạo partial state.
Audit ghi chung vào fuxa.log, chỉ 1 MB × 5 file, được thừa nhận tại [09-audit-logging.md (line 277)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/design/09-audit-logging.md:277).
Audit không đủ actor, target, source IP/device, session, correlation ID, before/after, policy decision và reason.
Audit failure bị nuốt; cả audit và error log có thể cùng hỏng khi disk full.
Tất cả property/integration test quan trọng lại được cho phép bỏ qua như “optional” tại [tasks.md (line 247)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/tasks.md:247).
Ma trận Design→Task→Test vẫn pending dù task đã sinh tại [traceability.md (line 67)](C:/Users/toann/Desktop/WORK_PRO/FUXA/.kiro/specs/auth-user-management/decisions/traceability.md:67).
76 task/subtask đều chưa tick; server/auth-management và client/.../auth-management chưa tồn tại. “HOÀN TẤT” trong guide chỉ có nghĩa hoàn tất viết hướng dẫn, không phải hoàn tất module.
4. Pattern kiến trúc nên dùng
Đối với FUXA hiện tại, lựa chọn đúng nhất không phải microservice ngay từ đầu. Nên dùng:
Modular Monolith
└── Bounded Context
    ├── Domain
    │   ├── entities / value objects
    │   ├── invariants
    │   └── pure policies
    ├── Application
    │   ├── commands / queries
    │   ├── transaction boundary
    │   └── ports
    ├── Adapters
    │   ├── HTTP/UI
    │   ├── persistence
    │   ├── IdP/JWT
    │   └── audit/event
    └── Composition Root
Thiết kế bốn tầng hiện tại có tinh thần đúng, nhưng đang gọi cả service có I/O là “pure logic”. Transaction boundary cũng bị đặt sai: nó phải thuộc application use case và được persistence port thực hiện atomically.
5. Blueprint cho SCADA lớn
.kiro hiện chỉ bao phủ IAM. Một SCADA lớn cần ít nhất các bounded context sau:
Identity & Access
Human identity qua enterprise IdP.
Machine/device identity bằng certificate/mTLS.
Break-glass account offline, dual-control, audit chặt.
RBAC kết hợp scope theo site/area/asset và ABAC theo ca trực/trạng thái.

Asset/Tag Model
Enterprise → site → area → line → equipment → device → tag.
Namespace ổn định, versioning, metadata engineering unit.
Source timestamp, server timestamp, quality, sequence và provenance.

Southbound Connectivity
OPC UA, Modbus, S7, BACnet, MQTT… qua protocol adapters.
Connection supervision, retry/backoff, store-and-forward.
Driver isolation để lỗi protocol không làm sập core.

Realtime Data Plane
Ingestion, normalization, quality propagation, cache/subscription.
Backpressure, bounded queues, duplicate/out-of-order handling.
Không trộn command path với telemetry path.

Command & Control
Command authorization theo asset/action.
Idempotency key, timeout, acknowledgment, sequence/fencing token.
Select-before-operate nếu domain yêu cầu.
Dual approval cho lệnh nguy hiểm.
Không được coi SCADA authentication là safety interlock; SIS/PLC vẫn phải fail-safe độc lập.

Alarm Management
Alarm philosophy, rationalization, priority, shelving/suppression, acknowledge, escalation, audit và MOC.
Đây là lifecycle bắt buộc đối với SCADA/process industries theo ISA-18.2.

Historian
Hot/warm/cold retention.
Compression/downsampling nhưng bảo toàn raw critical events.
Query partitioning, backup/restore, legal hold.

Configuration & MOC
Immutable version, diff, review/approve, staged deployment, rollback.
Không sửa production trực tiếp từ UI mà không có change record.

Audit & Security Monitoring
Dedicated append-only sink.
WORM/object-lock hoặc external SIEM.
Clock health, sequence, signing/hash chain nếu yêu cầu.
Audit health là observable control, không chỉ log lỗi vào cùng ổ đĩa.

Platform Operations
Health, metrics, tracing, capacity, SLO.
Backup, restore drill, DR, RTO/RPO.
Patch/SBOM/vulnerability management.
Blue-green/canary phù hợp OT, không test trực tiếp trên hệ thống đang vận hành.

6. Network và HA bắt buộc phải bổ sung
   Không thể đạt chuẩn SCADA lớn nếu thiếu:
   Zone/conduit và OT DMZ.
   Tách enterprise, operations, supervisory, control, field và safety zone.
   Firewall allow-list theo mapped data flow.
   Remote access qua managed access point, MFA, session recording và time-bound approval.
   Redundant server/network/store.
   Fencing để ngăn split-brain command execution.
   RTO/RPO định lượng.
   Safe degraded mode và manual operation procedure.
   NIST SP 800-82 Rev.3 yêu cầu kiến trúc OT cân nhắc segmentation, DMZ, least privilege, redundancy, remote access và ảnh hưởng tới safety/operations. ISA/IEC 62443 phải trở thành compliance backbone thay vì chỉ được xem như tài liệu tham khảo.
7. Lộ trình đạt 10/10
   Gate 1 — Dừng implementation và sửa specification
   Thêm threat model và trust boundaries.
   Thêm quality attribute scenarios: scale, latency, availability, RTO/RPO, retention.
   Chốt deployment topology: edge single-node hay central HA.
   Chuyển mọi P0 thành requirement/ADR có acceptance test.
   Hoàn thiện traceability REQ→DES→TASK→TEST.
   Gate 2 — Sửa IAM foundation
   Thiết kế lại router cutover.
   Persistence transaction thật.
   Live account/session validation.
   Refresh-token family + replay detection.
   JWT profile chuẩn alg/iss/aud/sub/jti/typ.
   Secure bootstrap/recovery ceremony.
   MFA/phishing-resistant option cho admin và remote access.
   Password policy + bcrypt 72-byte handling hoặc Argon2id migration.
   Dedicated audit sink.
   Gate 3 — Chứng minh invariant dưới concurrency
   Bắt buộc test:
   Hai request xóa hai admin đồng thời.
   Hai node bootstrap đồng thời.
   Concurrent create cùng username.
   Role delete trong khi user update.
   Password rotate trong khi refresh.
   Refresh-token replay.
   Deleted/disabled/downgraded admin dùng token cũ.
   Crash giữa từng persistence step.
   Gate 4 — Kiến trúc SCADA platform
   Bounded contexts như blueprint trên.
   Zone/conduit diagram.
   Telemetry và command dataflow.
   Alarm lifecycle.
   HA/failover/fencing.
   Historian retention và DR.
   MOC/deployment workflow.
   Gate 5 — Production acceptance
   Chỉ được gọi là 10/10 khi:
   Không còn P0/P1 mở.
   Không có security/integration test “optional”.
   Traceability đầy đủ và executable.
   Load test đạt target tag/update/subscriber đã định lượng.
   Failover test chứng minh RTO/RPO.
   Restore drill thành công.
   Pen-test và OT threat model được sign-off.
   Operator workflow và alarm performance được validation.
   Điểm mạnh đáng giữ là tư duy requirements-first, decision ledger, bounded module, ports/adapters và property-based testing. Tuy nhiên cần thay phần persistence, session authority, bootstrap, router cutover và audit; vá nhỏ trên cấu trúc hiện tại sẽ không đủ để nâng từ 3/10 lên 10/10.
