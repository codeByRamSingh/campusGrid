# CampusGrid ERP — Implementation Task Roadmap
> Source of truth: live code audit (April 2026).  
> Every task is grounded in actual files and line-level findings, not assumptions.

---

## 0. Platform Baseline

| Layer | Stack | Status |
|---|---|---|
| Backend | Node.js / Express / TypeScript / Prisma / PostgreSQL | Functional |
| Frontend | React / TypeScript / Vite / Tailwind CSS | Functional |
| Auth | JWT (12 h), RBAC (6 staff roles) | Functional — gaps below |
| Notifications | Email via SMTP + `NotificationLog` | Partial — no SMS/WhatsApp |
| Deployment | Docker Compose (db + backend + nginx) | Functional — env gaps below |
| CI | GitHub Actions runtime certification | Present |

---

## 1. Module Inventory

| Module | Exists | State |
|---|---|---|
| Trust & College Admin | Yes | Functional |
| Authentication & RBAC | Yes | Functional — in-memory rate limiter, no refresh token |
| Student Management | Yes | Functional — hard-cap 500 rows, no cursor pagination |
| Admissions Workflow | Yes | Functional — 5-step workflow complete |
| Finance (Payments, Expenses, Vendors, Budget, Petty Cash) | Yes | Functional — attachment is local FS only |
| HR (Staff, Attendance, Leave, Payroll, SalaryConfig) | Yes | **CRITICAL DATA LOSS** — 30+ onboarding fields discarded |
| Payroll Deductions | Partial | Frontend state only — never sent to or stored in backend |
| Exceptions / Triage | Yes | Functional |
| Notifications (Email) | Yes | Log-only mode by default — no SMTP-less fallback with retry |
| Reports & Dashboard | Yes | Functional — expenses capped at 200, no pagination |
| Audit Log | Yes | Functional |
| Settings | Yes | Functional — COLLEGE_ADMIN cannot edit college-level settings |
| Procurement | Hollow | Only free-text reference fields on Expense — no real model/workflow |
| Exam Management | No | Not started |
| Hostel Management | No | Not started |
| Library Management | No | Not started |
| Transport Management | No | Not started |
| Student Self-Service Portal | No | Not started |
| Academic Calendar / Timetable | No | Not started |

---

## 2. Critical Bugs (Data Loss / Security / Broken)

### BUG-01 — Staff Onboarding Data Loss ⚠️ CRITICAL
**Problem**: `HrPage.tsx` collects 30+ fields across a 4-step onboarding wizard (DOB, gender, current/permanent address, emergency contact, qualifications, experience, department, subject specialisation, photo, appointment letter, ID proof, address proof). The `Staff` Prisma model only has 12 fields. All personal details, address data, qualifications and uploaded documents are **silently discarded** on submit.  
**Affected files**:  
- `frontend/src/modules/saas/HrPage.tsx` — `OnboardingForm` type, `defaultOnboardingForm`, `onAddStaff` call  
- `backend/src/routes/hr.routes.ts` — `POST /hr/staff` only persists 9 fields  
- `backend/prisma/schema.prisma` — `Staff` model  
**Fix**: Extend `Staff` model + API + add `StaffDocument` upload endpoint.

### BUG-02 — In-Memory Login Rate Limiter Resets on Restart ⚠️ HIGH
**Problem**: `loginAttempts` is a `new Map<string, ...>()` in `auth.routes.ts`. Resets on every pod restart. Provides no protection in multi-instance deployments.  
**Affected files**: `backend/src/routes/auth.routes.ts` (lines 11-14)  
**Fix**: Move to Redis-backed or DB-backed counter with TTL.

### BUG-03 — No JWT Refresh Token ⚠️ HIGH
**Problem**: `signToken` issues a 12-hour JWT. No refresh endpoint exists. Users are hard-logged out mid-session.  
**Affected files**: `backend/src/lib/auth.ts`, `backend/src/routes/auth.routes.ts`, `frontend/src/services/api.ts`  
**Fix**: Add `POST /auth/refresh` with a `refreshToken` cookie (httpOnly, Secure) and silent refresh interceptor on the Axios client.

### BUG-04 — Onboarding Drafts Are Pure Local State
**Problem**: `onboardingDrafts` state in `HrPage.tsx` is in-memory React state only. Browser refresh or navigation loses any in-progress staff onboarding work.  
**Affected files**: `frontend/src/modules/saas/HrPage.tsx`  
**Fix**: Add `OnboardingDraft` Prisma model + `POST/GET /hr/onboarding-drafts` API.

### BUG-05 — VITE_API_URL Hardcoded to localhost in docker-compose
**Problem**: `docker-compose.yml` bakes `VITE_API_URL: http://localhost:4000/api` into the frontend bundle at build time. Any non-localhost deployment serves a broken frontend.  
**Affected files**: `docker-compose.yml`  
**Fix**: Accept `VITE_API_URL` as a build arg from `.env` or use runtime config injection via nginx.

### BUG-06 — Fee Demand Cycles Not Persisted
**Problem**: `buildDemandCycles()` in `reporting.service.ts` re-calculates installment cycles on every report call using current `totalPayable`. If fees are updated or discounts are applied, past cycle history drifts and dues become inconsistent.  
**Affected files**: `backend/src/services/reporting.service.ts`  
**Fix**: Add a `FeeDemandCycle` model persisted at admission time; recalculate only on explicit fee plan change.

### BUG-07 — `NotificationLog` Missing `recipientEmail` Field
**Problem**: `NotificationLog` stores `recipientId` but not `recipientEmail`. Failed notifications cannot be retried without a separate lookup.  
**Affected files**: `backend/prisma/schema.prisma` — `NotificationLog` model, `backend/src/lib/notify.ts`  
**Fix**: Add `recipientEmail String?` to `NotificationLog`; store it at send time.

### BUG-08 — Reports Expense Endpoint Hard-Capped at 200 Rows
**Problem**: `GET /reports/expenses` has `take: 200` with no pagination or date-range filter. Large colleges will silently miss records.  
**Affected files**: `backend/src/routes/reports.routes.ts`  
**Fix**: Add cursor-based pagination and `startDate`/`endDate` query params.

### BUG-09 — Attendance & Leave Queries Capped at 200 / No Pagination
**Problem**: `hr.routes.ts` uses `take: 200` for both attendance and leave records. No cursor or date-range support.  
**Affected files**: `backend/src/routes/hr.routes.ts`  
**Fix**: Add `startDate`, `endDate`, cursor pagination.

### BUG-10 — Stale `HrPage.old.tsx` File
**Problem**: Legacy file `frontend/src/modules/saas/HrPage.old.tsx` is in source; can cause confusion and bundle bloat.  
**Affected files**: `frontend/src/modules/saas/HrPage.old.tsx`  
**Fix**: Delete file.

---

## 3. Master Backlog

---

### MODULE: Authentication & Security

#### TASK-AUTH-01 — Persistent Rate Limiter
- **Problem**: In-memory login rate limiter (BUG-02)
- **Backend**: `backend/src/routes/auth.routes.ts` — replace `Map` with Prisma `LoginAttempt` model or Redis
- **Schema**: Add `LoginAttempt { ip, count, resetAt }` model OR use `AppSetting` table for config
- **Complexity**: Medium
- **Dependencies**: None
- **Phase**: Phase 1

#### TASK-AUTH-02 — JWT Refresh Token Flow
- **Problem**: Hard logout after 12 h (BUG-03)
- **Backend**: `backend/src/routes/auth.routes.ts` — add `POST /auth/refresh`; `backend/src/lib/auth.ts` — add `signRefreshToken()`
- **Frontend**: `frontend/src/services/api.ts` — add Axios response interceptor for 401 → refresh → retry
- **Schema**: Add `RefreshToken { userId, tokenHash, expiresAt, revokedAt }` model
- **Complexity**: Medium
- **Dependencies**: None
- **Phase**: Phase 1

#### TASK-AUTH-03 — Email Verification for Password Setup Links
- **Problem**: Invite link is returned in the JSON response body — any API consumer can read it without needing to check email
- **Backend**: `backend/src/routes/hr.routes.ts` — remove invite link from response; only deliver via `sendNotification()`
- **Frontend**: Update staff creation confirmation to "Invite sent to email"
- **Complexity**: Low
- **Dependencies**: SMTP must be configured; TASK-NOTIF-01 first
- **Phase**: Phase 1

#### TASK-AUTH-04 — COLLEGE_ADMIN College-Level Settings Permission
- **Problem**: `COLLEGE_ADMIN` lacks `SETTINGS_MANAGE` but needs to configure college-specific settings (prefix, fine policy, fee cycles)
- **Backend**: `backend/src/lib/permissions.ts` — add `SETTINGS_MANAGE` or `SETTINGS_COLLEGE` to `COLLEGE_ADMIN` role
- **Backend**: `backend/src/routes/settings.routes.ts` — split super-admin settings from college settings
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-AUTH-05 — HttpOnly Cookie for Auth Token
- **Problem**: JWT stored in `localStorage` is vulnerable to XSS
- **Backend**: `backend/src/routes/auth.routes.ts` — set `Set-Cookie` with `httpOnly; Secure; SameSite=Strict`
- **Frontend**: `frontend/src/services/api.ts` — remove `localStorage` token usage; rely on cookie
- **Complexity**: Medium
- **Dependencies**: TASK-AUTH-02
- **Phase**: Phase 2

---

### MODULE: HR & Staff Management

#### TASK-HR-01 — Extend Staff Model for Full Personal Profile ⚠️ Data Loss Fix
- **Problem**: 30+ onboarding fields are discarded (BUG-01)
- **Schema**: `backend/prisma/schema.prisma` — extend `Staff` model: `dob DateTime?`, `gender String?`, `nationality String?`, `emergencyContact String?`, `currentAddress String?`, `permanentAddress String?`, `city/district/state/pincode/country String?`, `qualification String?`, `experience String?`, `department String?`, `subjectSpecialization String?`, `functionalRole String?`
- **Backend**: `backend/src/routes/hr.routes.ts` — `POST /hr/staff` and `PATCH /hr/staff/:id` accept and persist all new fields
- **Frontend**: `frontend/src/modules/saas/HrPage.tsx` — wire `onAddStaff` payload to include all form fields
- **Complexity**: Medium
- **Dependencies**: None
- **Phase**: Phase 1

#### TASK-HR-02 — Staff Document Upload
- **Problem**: Appointment letter, ID proof, address proof collected in onboarding form but never uploaded
- **Backend**: Add `POST /hr/staff/:id/documents` (multipart); store files using existing Document model pattern
- **Schema**: `Document` model already exists — link via `entityType = "STAFF"`, `entityId = staff.id`
- **Frontend**: `frontend/src/modules/saas/HrPage.tsx` — call upload endpoint in `onAddStaff` after staff is created
- **Complexity**: Medium
- **Dependencies**: TASK-HR-01
- **Phase**: Phase 1

#### TASK-HR-03 — Persist Onboarding Drafts to DB
- **Problem**: Onboarding drafts are in-memory React state (BUG-04)
- **Schema**: Add `StaffOnboardingDraft { id, createdByUserId, collegeId, formDataJson Json, step Int, createdAt, updatedAt }` model
- **Backend**: `POST /hr/onboarding-drafts`, `GET /hr/onboarding-drafts`, `DELETE /hr/onboarding-drafts/:id`
- **Frontend**: `frontend/src/modules/saas/HrPage.tsx` — auto-save on step advance, load on mount
- **Complexity**: Medium
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-HR-04 — Payroll Deduction Engine (Server-Side)
- **Problem**: `deductionsByStaff`, `allowancesByStaff`, `manualAdjustmentsByStaff` are local React state — these are NEVER sent to the backend and are lost on refresh
- **Schema**: Add `PayrollDeduction { payrollId, type (PF|TDS|ADVANCE|OTHER), amount, label }` model
- **Backend**: `backend/src/routes/hr.routes.ts` — include deductions in `POST /hr/payroll`; compute gross, deductions, net pay
- **Frontend**: `frontend/src/modules/saas/HrPage.tsx` — send deduction rows in payroll request; display net pay breakdown
- **Complexity**: High
- **Dependencies**: TASK-HR-01
- **Phase**: Phase 2

#### TASK-HR-05 — Attendance Bulk Upload (CSV)
- **Problem**: Attendance is entered one record at a time — inefficient for bulk import
- **Backend**: Add `POST /hr/attendance/bulk` accepting CSV body
- **Frontend**: File input + column mapping UI in HR Attendance tab
- **Complexity**: Medium
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-HR-06 — Leave Balance & Accrual Tracking
- **Problem**: Leave requests have PENDING/APPROVED/REJECTED status but no leave balance model — unlimited leaves possible
- **Schema**: Add `LeaveBalance { staffId, leaveType, totalDays, usedDays, year }` model; add `leaveType` to `LeaveRequest`
- **Backend**: Deduct from balance on approval; add `GET /hr/leave-balance/:staffId`
- **Frontend**: Show balance in HR Leave tab
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-HR-07 — Attendance Pagination Fix (BUG-09)
- **Problem**: `take: 200` hard cap
- **Backend**: `backend/src/routes/hr.routes.ts` — add `startDate`, `endDate`, cursor
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 1

#### TASK-HR-08 — Delete Stale `HrPage.old.tsx` (BUG-10)
- **Problem**: Stale file in source
- **Frontend**: Delete `frontend/src/modules/saas/HrPage.old.tsx`
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 1

---

### MODULE: Finance

#### TASK-FIN-01 — Persist Fee Demand Cycles ⚠️ Data Integrity Fix
- **Problem**: Fee cycles recalculated dynamically on every report — drifts when fees change (BUG-06)
- **Schema**: Add `FeeDemandCycle { id, studentId, cycleKey, label, dueDate, amount, status (OPEN|PAID|WAIVED), createdAt }` model
- **Backend**: Generate cycles at `POST /students` (admission creation); recalculate on explicit fee plan change only
- **Backend**: Update `reporting.service.ts` to read from `FeeDemandCycle` table instead of computing
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 1

#### TASK-FIN-02 — Fee Collection Draft → Payment Workflow
- **Problem**: `FeeCollectionDraft` exists in schema but there is no documented/enforced workflow API to transition draft → confirmed payment
- **Backend**: Add `POST /finance/fee-drafts/:id/confirm` endpoint with proper validation
- **Frontend**: `frontend/src/modules/saas/FinancePage.tsx` — add "Confirm Collection" action on drafts
- **Complexity**: Medium
- **Dependencies**: TASK-FIN-01
- **Phase**: Phase 2

#### TASK-FIN-03 — Expense Reports Pagination Fix (BUG-08)
- **Problem**: `GET /reports/expenses` hard-capped at 200 rows
- **Backend**: `backend/src/routes/reports.routes.ts` — add `startDate`, `endDate`, cursor pagination
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 1

#### TASK-FIN-04 — Real Procurement Module
- **Problem**: `procurementRequestRef`, `procurementOrderRef`, `goodsReceiptRef` are free-text strings on `Expense` — no real workflow
- **Schema**: Add `ProcurementRequest { id, collegeId, title, description, estimatedAmount, status (DRAFT|SUBMITTED|APPROVED|ORDERED|GOODS_RECEIVED|CLOSED), vendorId?, approvedByUserId?, createdAt }` and `PurchaseOrder { procurementRequestId, orderNumber, amount, orderedAt }` models
- **Backend**: New `procurement.routes.ts` with full CRUD and status transitions
- **Frontend**: New Procurement tab in Finance page
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 3

#### TASK-FIN-05 — Budget Utilisation Alerts
- **Problem**: `Budget` model exists but no alert when spending approaches/exceeds budget
- **Backend**: After every `Expense` insert, compare category spend vs. `Budget.allocatedAmount`; fire `sendNotification()` at 80% and 100% thresholds
- **Frontend**: Show utilisation bar in Finance budget view
- **Complexity**: Medium
- **Dependencies**: TASK-NOTIF-01
- **Phase**: Phase 2

#### TASK-FIN-06 — Cloud / S3 Expense Attachment Storage
- **Problem**: Attachments stored on local FS (`storage/expense-documents`) — breaks horizontal scaling; volume backup-dependent
- **Backend**: `backend/src/routes/finance.routes.ts` — add S3 (or compatible) upload path; keep local as fallback
- **Infrastructure**: Docker compose — add `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` env vars
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 3

#### TASK-FIN-07 — Multi-Currency & GST Support
- **Problem**: `AppSetting.currency` is a string field but no conversion or GST/TDS calculation exists
- **Schema**: Add `gstNumber String?`, `gstRate Decimal?` to `Vendor`; add `gstAmount Decimal?`, `tdsAmount Decimal?` to `Expense`
- **Backend**: Compute GST/TDS in expense creation; expose in reports
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 3

---

### MODULE: Admissions

#### TASK-ADM-01 — Required Document Type Enforcement
- **Problem**: `AdmissionDocument` stores uploaded documents but no validation that all required document types are present before workflow advances
- **Backend**: Add a `requiredDocTypes` field to `Course` or `College` settings; validate in `VERIFY_DOCUMENTS` workflow step
- **Frontend**: Show checklist in admission document panel
- **Complexity**: Medium
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-ADM-02 — Admission Number Prefix Per Session
- **Problem**: `admissionNumberPrefix` is on `College` model — all sessions/years share one prefix, making cross-year number codes collide
- **Schema**: Add `admissionNumberPrefix String?` to `Session` (override); fallback to `College.admissionNumberPrefix`
- **Backend**: `backend/src/routes/student.routes.ts` — use session-level prefix when set
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-ADM-03 — Bulk Admission Import (CSV)
- **Problem**: Admissions entered one-by-one — slow for migrating existing student data
- **Backend**: Add `POST /students/bulk-import` accepting CSV; validate, create students + admissions in transaction
- **Frontend**: CSV upload wizard in Admissions page
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 3

#### TASK-ADM-04 — Application Portal for Prospective Students
- **Problem**: No self-service application entry — admissions staff manually enter all applications
- **Frontend + Backend**: Public `POST /apply` endpoint (no auth); frontend `/apply` route with application form
- **Schema**: Add `ApplicationStatus` enum and `Application` model separate from `Admission` (pre-admission)
- **Complexity**: High
- **Dependencies**: TASK-NOTIF-01 (confirmation email)
- **Phase**: Phase 3

---

### MODULE: Student Management

#### TASK-STU-01 — Student Fee Demand Cycle Persistence (see FIN-01)
Covered under TASK-FIN-01.

#### TASK-STU-02 — Student Self-Service Portal
- **Problem**: Students have no login, cannot view fee receipts, admission status, or attendance
- **Schema**: Add `StudentUser { id, studentId, email, passwordHash }` model
- **Backend**: Add student auth routes + `GET /student/me`, `GET /student/me/receipts`, `GET /student/me/admission`
- **Frontend**: New `/student` route group with login + dashboard
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 3

#### TASK-STU-03 — Student Photo Upload
- **Problem**: `Student.photoUrl` field exists but there is no upload endpoint
- **Backend**: Add `POST /students/:id/photo` (multipart upload)
- **Frontend**: Photo upload in student profile view
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-STU-04 — Student Pagination Fix
- **Problem**: `GET /students` hard-caps at 500 rows
- **Backend**: `backend/src/routes/student.routes.ts` — enforce proper cursor + `limit ≤ 200` with `hasMore` flag; add full-text search via `q` param
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 1

---

### MODULE: Notifications

#### TASK-NOTIF-01 — Add `recipientEmail` to `NotificationLog` (BUG-07)
- **Problem**: Failed emails cannot be retried without re-fetching user email
- **Schema**: Add `recipientEmail String?` to `NotificationLog`
- **Backend**: `backend/src/lib/notify.ts` — pass and store `recipientEmail` in log entry
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 1

#### TASK-NOTIF-02 — Notification Retry Queue
- **Problem**: `FAILED` notification logs are never retried
- **Backend**: Add `POST /notifications/retry` (admin only); or cron-style retry for `FAILED` within last 24 h
- **Complexity**: Medium
- **Dependencies**: TASK-NOTIF-01
- **Phase**: Phase 2

#### TASK-NOTIF-03 — In-App Notification Bell
- **Problem**: Notifications are email-only; no in-app notification feed
- **Schema**: Add `channel = "IN_APP"` to `NotificationLog`; add `isRead Boolean` field
- **Backend**: `GET /notifications/mine` for current user; `PATCH /notifications/:id/read`
- **Frontend**: Notification bell in navbar with unread badge
- **Complexity**: Medium
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-NOTIF-04 — WhatsApp / SMS Channel
- **Problem**: Email delivery is unreliable in India for institution use cases; WhatsApp/SMS is the dominant channel
- **Backend**: `backend/src/lib/notify.ts` — add `channel: "WHATSAPP" | "SMS"` support via Twilio or MSG91
- **Schema**: Add `whatsappNumber String?` to `Staff`, `Student`
- **Complexity**: High
- **Dependencies**: TASK-NOTIF-01
- **Phase**: Phase 3

---

### MODULE: Dashboard & Reports

#### TASK-RPT-01 — Expense Report Pagination (see FIN-03)
Covered under TASK-FIN-03.

#### TASK-RPT-02 — Payroll Report Endpoint
- **Problem**: No dedicated payroll report endpoint — HR module fetches raw payroll rows; no summary by department/period
- **Backend**: Add `GET /reports/payroll-summary?month=&year=&collegeId=` to `reports.routes.ts`
- **Frontend**: Add payroll KPI cards to Dashboard
- **Complexity**: Medium
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-RPT-03 — Downloadable PDF / Excel Reports
- **Problem**: Only CSV export exists (`exportRowsToCsv` helper) — no PDF receipts, no Excel P&L
- **Backend**: Add `GET /reports/expenses/export?format=xlsx` using `exceljs`; `GET /fee-receipts/:id/pdf` using `pdfkit`
- **Frontend**: "Export" dropdown with PDF/Excel options
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-RPT-04 — Timetable & Academic Calendar Reports
- **Problem**: No academic calendar or timetable module — blocked on new module creation
- **Dependencies**: TASK-NEW-03
- **Phase**: Phase 4

---

### MODULE: Settings & Infrastructure

#### TASK-INF-01 — Fix VITE_API_URL for Non-localhost Deployments (BUG-05)
- **Problem**: API URL baked into bundle at build time from hardcoded `localhost`
- **docker-compose.yml**: Accept `VITE_API_URL` from `.env` (`${VITE_API_URL:-http://localhost:4000/api}`)
- **Alternative (Runtime)**: Inject `window.__API_URL__` via nginx config template; read in `api.ts`
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 1

#### TASK-INF-02 — Persistent Login Rate Limiter (see AUTH-01)
Covered under TASK-AUTH-01.

#### TASK-INF-03 — Health-Check & Readiness Probe Endpoint
- **Problem**: Only `GET /health` exists; no database connectivity check
- **Backend**: `backend/src/routes/health.routes.ts` — add DB ping to health response; differentiate liveness vs. readiness
- **docker-compose.yml**: Add `healthcheck` to backend service
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 1

#### TASK-INF-04 — Environment Variable Validation at Startup
- **Problem**: Missing env vars crash at runtime with unclear errors
- **Backend**: `backend/src/server.ts` — add `zod` or manual env validation block before `app.listen()`
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 1

#### TASK-INF-05 — Horizontal Scale / Redis Session Store
- **Problem**: In-memory rate limiter and in-process state prevent horizontal scaling
- **Infrastructure**: Add Redis service to `docker-compose.yml`; wire to rate limiter (AUTH-01) and any future session stores
- **Complexity**: Medium
- **Dependencies**: TASK-AUTH-01
- **Phase**: Phase 4

#### TASK-INF-06 — S3-Compatible Object Storage
- **Problem**: All file uploads (expense attachments, staff docs, student photos) go to local FS volume
- **Infrastructure**: Add MinIO or S3 config; abstract storage behind `storage.service.ts`
- **Complexity**: High
- **Dependencies**: TASK-HR-02, TASK-FIN-06
- **Phase**: Phase 3

#### TASK-INF-07 — Database Backup & Point-in-Time Recovery
- **Problem**: Only `campusgrid_db_data` volume — no automated backup strategy
- **Infrastructure**: Add pg_dump cron job container or WAL archiving to `docker-compose.yml`
- **Complexity**: Medium
- **Dependencies**: None
- **Phase**: Phase 2

#### TASK-INF-08 — API Rate Limiting (Per-User)
- **Problem**: No per-user or per-endpoint rate limiting beyond login
- **Backend**: Add `express-rate-limit` with Redis store for sensitive endpoints (`/finance`, `/hr/payroll`)
- **Complexity**: Medium
- **Dependencies**: TASK-INF-05
- **Phase**: Phase 3

---

### MODULE: New Modules (Phase 3)

#### TASK-NEW-01 — Exam Management Module
- **Schema**: `Exam { id, collegeId, courseId, sessionId, title, examType, scheduledAt }`, `ExamResult { examId, studentId, subjectId, marksObtained, maxMarks, grade }`
- **Backend**: New `exam.routes.ts`
- **Frontend**: New Exam tab
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 3

#### TASK-NEW-02 — Hostel Management Module
- **Schema**: `HostelBlock`, `HostelRoom`, `HostelAllocation { studentId, roomId, fromDate, toDate, feeAmount }`, `HostelPayment`
- **Backend**: New `hostel.routes.ts`
- **Frontend**: New Hostel tab
- **Complexity**: High
- **Dependencies**: TASK-FIN-01 (fee cycle integration)
- **Phase**: Phase 3

#### TASK-NEW-03 — Academic Calendar & Timetable Module
- **Schema**: `AcademicEvent { id, collegeId, courseId?, sessionId?, title, eventType, startDate, endDate }`, `TimetableSlot { id, sessionId, subjectId, staffId, dayOfWeek, startTime, endTime }`
- **Backend**: New `academic.routes.ts`
- **Frontend**: Calendar view + timetable grid
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 3

#### TASK-NEW-04 — Library Management Module
- **Schema**: `LibraryBook { id, collegeId, title, author, isbn, totalCopies, availableCopies }`, `LibraryIssue { bookId, studentId, issuedAt, dueDate, returnedAt, fine }`
- **Backend**: New `library.routes.ts`
- **Frontend**: New Library tab
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 3

#### TASK-NEW-05 — Transport Management Module
- **Schema**: `TransportRoute { id, collegeId, routeName, fare }`, `TransportStop`, `StudentTransport { studentId, routeId, pickupStop, sessionId }`
- **Backend**: New `transport.routes.ts`
- **Frontend**: New Transport tab
- **Complexity**: Medium
- **Dependencies**: None
- **Phase**: Phase 3

#### TASK-NEW-06 — Full Procurement Workflow (see FIN-04)
Covered under TASK-FIN-04.

---

### MODULE: Permissions & Roles

#### TASK-PERM-01 — `SETTINGS_COLLEGE` Granular Permission (see AUTH-04)
Covered under TASK-AUTH-04.

#### TASK-PERM-02 — Custom Role Builder (Advanced)
- **Problem**: 6 fixed staff roles — institutions need custom roles (e.g., "Principal", "Registrar")
- **Schema**: Add `CustomRole { id, collegeId, name, permissions Json }` model; update permission resolution
- **Complexity**: High
- **Dependencies**: None
- **Phase**: Phase 4

#### TASK-PERM-03 — Field-Level Permissions for Sensitive Payroll Data
- **Problem**: `HR_READ` exposes salary config, bank details to all HR readers
- **Backend**: Gate `StaffSalaryConfig` response behind `HR_WRITE` or a new `PAYROLL_READ` permission
- **Complexity**: Low
- **Dependencies**: None
- **Phase**: Phase 2

---

## 4. Sprint Roadmap

### Sprint 1 — Critical Bug Fixes (Weeks 1–2)
| Task | Description | Effort |
|---|---|---|
| TASK-HR-01 | Extend Staff model, fix onboarding data loss | 3 days |
| TASK-HR-08 | Delete HrPage.old.tsx | 15 min |
| TASK-HR-07 | Attendance/leave query pagination | 2 h |
| TASK-STU-04 | Student list pagination fix | 2 h |
| TASK-FIN-03 | Expense reports pagination | 2 h |
| TASK-NOTIF-01 | Add recipientEmail to NotificationLog | 1 h |
| TASK-INF-01 | Fix VITE_API_URL in docker-compose | 1 h |
| TASK-INF-03 | Health check DB ping | 2 h |
| TASK-INF-04 | Env var validation at startup | 2 h |
| TASK-AUTH-01 | Persistent login rate limiter (DB-backed) | 4 h |

### Sprint 2 — Workflow Fixes (Weeks 3–4)
| Task | Description | Effort |
|---|---|---|
| TASK-AUTH-02 | JWT refresh token flow | 2 days |
| TASK-FIN-01 | Persist fee demand cycles | 3 days |
| TASK-HR-02 | Staff document upload endpoint | 1 day |
| TASK-HR-04 | Server-side payroll deductions engine | 3 days |
| TASK-FIN-02 | Fee collection draft → confirm workflow | 1 day |
| TASK-AUTH-03 | Remove invite link from API response | 2 h |
| TASK-PERM-03 | Gate salary config behind PAYROLL_READ | 2 h |

### Sprint 3 — UI & Usability Improvements (Weeks 5–6)
| Task | Description | Effort |
|---|---|---|
| TASK-HR-03 | Persist onboarding drafts to DB | 2 days |
| TASK-HR-06 | Leave balance & accrual | 2 days |
| TASK-NOTIF-02 | Notification retry queue | 1 day |
| TASK-NOTIF-03 | In-app notification bell | 2 days |
| TASK-ADM-01 | Required document type enforcement | 1 day |
| TASK-ADM-02 | Admission number prefix per session | 4 h |
| TASK-FIN-05 | Budget utilisation alerts | 1 day |
| TASK-RPT-02 | Payroll report endpoint | 1 day |
| TASK-STU-03 | Student photo upload | 4 h |
| TASK-AUTH-04 | COLLEGE_ADMIN college settings permission | 4 h |
| TASK-INF-07 | DB backup strategy | 1 day |

### Sprint 4 — New Modules (Weeks 7–10)
| Task | Description | Effort |
|---|---|---|
| TASK-HR-05 | Attendance bulk CSV upload | 2 days |
| TASK-RPT-03 | PDF/Excel report export | 3 days |
| TASK-STU-02 | Student self-service portal (MVP) | 5 days |
| TASK-FIN-04 | Real procurement workflow module | 4 days |
| TASK-NEW-01 | Exam management module | 5 days |
| TASK-NEW-03 | Academic calendar & timetable | 4 days |
| TASK-NEW-04 | Library management module | 3 days |
| TASK-ADM-03 | Bulk admission CSV import | 3 days |
| TASK-NOTIF-04 | WhatsApp/SMS notification channel | 3 days |

### Sprint 5 — Scale & Optimisation (Weeks 11–12)
| Task | Description | Effort |
|---|---|---|
| TASK-INF-05 | Redis service + horizontal scale | 2 days |
| TASK-AUTH-05 | HttpOnly cookie for auth token | 1 day |
| TASK-INF-06 | S3/MinIO object storage abstraction | 3 days |
| TASK-FIN-06 | S3 expense attachments | 1 day |
| TASK-INF-08 | Per-user API rate limiting | 1 day |
| TASK-PERM-02 | Custom role builder | 3 days |
| TASK-NEW-02 | Hostel management module | 4 days |
| TASK-NEW-05 | Transport management module | 3 days |
| TASK-FIN-07 | GST/TDS on expenses | 3 days |

---

## 5. Quick Wins

### Under 2 Hours
| Task | What it fixes |
|---|---|
| TASK-HR-08 | Delete stale HrPage.old.tsx |
| TASK-NOTIF-01 | Add recipientEmail to NotificationLog migration |
| TASK-INF-01 | Fix VITE_API_URL hardcode in docker-compose |
| TASK-STU-04 | Student pagination hard-cap fix |
| TASK-FIN-03 | Expense report pagination fix |
| TASK-HR-07 | Attendance/leave pagination fix |
| TASK-PERM-03 | Gate salary config behind PAYROLL_READ |
| TASK-ADM-02 | Admission prefix per session |

### Under 1 Day
| Task | What it fixes |
|---|---|
| TASK-AUTH-01 | Persistent DB-backed login rate limiter |
| TASK-INF-03 | Health check with DB ping |
| TASK-INF-04 | Startup env var validation |
| TASK-AUTH-03 | Stop returning invite link in response body |
| TASK-AUTH-04 | COLLEGE_ADMIN settings permission |
| TASK-STU-03 | Student photo upload endpoint |
| TASK-FIN-02 | Fee draft → confirm API endpoint |

### Under 1 Week
| Task | What it fixes |
|---|---|
| TASK-HR-01 | Full staff model extension (data loss fix) |
| TASK-AUTH-02 | JWT refresh token flow |
| TASK-HR-04 | Server-side payroll deductions |
| TASK-FIN-01 | Persist fee demand cycles |
| TASK-NOTIF-03 | In-app notification bell |

---

## 6. High-Risk Tasks

| Task | Risk | Mitigation |
|---|---|---|
| TASK-FIN-01 (Fee Demand Cycles) | Persisting cycles will change report totals — can expose existing data inconsistencies | Run cycle generation in shadow mode first; compare against current dynamic calculations; backfill in a separate migration |
| TASK-HR-01 (Staff Model Extension) | Schema migration on a live production table | Use `@default` for all new fields; deploy migration before code; test with `prisma migrate deploy --preview-feature` |
| TASK-AUTH-02 (Refresh Tokens) | Session management change affects all users simultaneously | Deploy backend first with refresh endpoint; roll out frontend change during low-traffic window |
| TASK-AUTH-05 (HttpOnly Cookies) | Removes localStorage token — breaks any external API integrations | Maintain `Authorization: Bearer` header support alongside cookie; deprecate localStorage gradually |
| TASK-STU-02 (Student Portal) | New auth domain — must not share session store with staff auth | Use separate `StudentUser` model and distinct JWT audience claim |
| TASK-ADM-03 (Bulk Import) | CSV import with bad data can corrupt student/admission tables | Run in dry-run mode first; wrap in transaction; reject entire batch on first validation error |

---

## 7. Recommended Implementation Sequence

```
[Phase 1 — Now]
  TASK-HR-08 (delete stale file)
  → TASK-INF-01 (fix docker env)
  → TASK-INF-04 (env validation)
  → TASK-INF-03 (health check)
  → TASK-NOTIF-01 (recipientEmail field)
  → TASK-STU-04 (pagination fix)
  → TASK-HR-07 (attendance pagination)
  → TASK-FIN-03 (expense report pagination)
  → TASK-AUTH-01 (persistent rate limiter)
  → TASK-AUTH-03 (stop leaking invite link)
  → TASK-HR-01 ⚠️ (staff model + API data loss fix)
  → TASK-HR-02 (staff document upload)

[Phase 2 — Core Improvements]
  → TASK-AUTH-02 (refresh tokens)
  → TASK-FIN-01 ⚠️ (persist fee cycles)
  → TASK-HR-04 (payroll deductions)
  → TASK-HR-03 (onboarding drafts persist)
  → TASK-HR-06 (leave balances)
  → TASK-FIN-02 (draft → confirm)
  → TASK-FIN-05 (budget alerts)
  → TASK-NOTIF-02 + TASK-NOTIF-03 (retry + in-app bell)
  → TASK-ADM-01 (required document enforcement)
  → TASK-RPT-02 (payroll report)
  → TASK-RPT-03 (PDF/Excel export)
  → TASK-INF-07 (DB backup)
  → TASK-PERM-03 (salary gate)
  → TASK-AUTH-04 (college admin settings)

[Phase 3 — Expansion]
  → TASK-STU-02 (student portal)
  → TASK-FIN-04 (procurement)
  → TASK-NEW-01 (exams)
  → TASK-NEW-03 (calendar/timetable)
  → TASK-NEW-04 (library)
  → TASK-NEW-05 (transport)
  → TASK-NOTIF-04 (WhatsApp/SMS)
  → TASK-ADM-03 (bulk import)
  → TASK-ADM-04 (application portal)
  → TASK-INF-06 (S3 storage)
  → TASK-FIN-06 (S3 attachments)
  → TASK-FIN-07 (GST/TDS)

[Phase 4 — Scale & Polish]
  → TASK-INF-05 (Redis)
  → TASK-INF-08 (per-user rate limiting)
  → TASK-AUTH-05 (httpOnly cookies)
  → TASK-PERM-02 (custom roles)
  → TASK-NEW-02 (hostel)
  → TASK-RPT-04 (timetable reports)
```

---

## 8. Task Summary by Phase

| Phase | Tasks | Focus |
|---|---|---|
| Phase 1 — Critical Fixes | 12 tasks | Data loss, security gaps, pagination hard-caps, broken env |
| Phase 2 — Core Improvements | 13 tasks | Refresh tokens, payroll engine, fee cycles, notifications, reporting |
| Phase 3 — Feature Expansion | 12 tasks | Student portal, procurement, 4 new modules, S3, GST |
| Phase 4 — Scale & Optimisation | 6 tasks | Redis, custom roles, HttpOnly cookies, performance |
| **Total** | **43 tasks** | |
