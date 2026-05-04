import { Router } from "express";
import { body, param } from "express-validator";
import fs from "fs";
import multer from "multer";
import path from "path";
import * as HrService from "../services/hr.service.js";
import { AppError } from "../lib/errors.js";
import { authenticate, canAccessCollege, getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";
import { createRateLimitMiddleware } from "../lib/rate-limit.js";
import { writeAuditLog } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";

const BUILTIN_STAFF_ROLES = ["COLLEGE_ADMIN", "ADMISSIONS_OPERATOR", "CASHIER", "HR_OPERATOR", "ATTENDANCE_OPERATOR", "AUDITOR"] as const;

const STAFF_DOC_DIR = process.env.STAFF_DOC_STORAGE_DIR ?? "/app/storage/staff-documents";
if (!fs.existsSync(STAFF_DOC_DIR)) {
  fs.mkdirSync(STAFF_DOC_DIR, { recursive: true });
}

const staffDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STAFF_DOC_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safe = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${Date.now()}_${safe}${ext}`);
  },
});

const staffDocUpload = multer({
  storage: staffDocStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/webp", "application/pdf",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
    }
  },
});

export const hrRouter = Router();

const payrollRateLimiter = createRateLimitMiddleware({
  scope: "hr-payroll",
  windowMs: 60 * 1000,
  max: Number(process.env.PAYROLL_API_RATE_LIMIT_MAX ?? 45),
  message: "Too many payroll API requests. Please retry in a minute.",
  key: (req) => req.user?.id ?? req.ip,
});

// ─── Staff ────────────────────────────────────────────────────────────────────

hrRouter.post(
  "/hr/staff",
  authenticate,
  requirePermission("HR_WRITE"),
  [
    body("collegeId").notEmpty(),
    body("fullName").notEmpty(),
    body("email").isEmail(),
    body("mobile").notEmpty(),
    body("role").optional().isIn(BUILTIN_STAFF_ROLES),
    body("customRoleId").optional({ nullable: true }).isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) {
      res.status(403).json({ message: "Cannot manage staff for another college" });
      return;
    }
    try {
      const result = await HrService.createStaff(req.body as HrService.CreateStaffInput, req.user?.id);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

hrRouter.get("/hr/staff", authenticate, requirePermission("HR_READ"), async (req: AuthenticatedRequest, res) => {
  const collegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (collegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's staff" });
    return;
  }
  const staff = await HrService.listStaff(collegeId);
  res.json(staff);
});

hrRouter.patch(
  "/hr/staff/:staffId",
  authenticate,
  requirePermission("HR_WRITE"),
  [
    param("staffId").notEmpty(),
    body("fullName").optional().isString().trim().isLength({ min: 1 }),
    body("email").optional().isEmail(),
    body("mobile").optional().isString().trim().isLength({ min: 5 }),
    body("role").optional().isIn(BUILTIN_STAFF_ROLES),
    body("customRoleId").optional({ nullable: true }).isString(),
    body("collegeId").optional().isString(),
    body("isActive").optional().isBoolean(),
    body("designation").optional().isString(),
    body("staffType").optional().isIn(["TEACHING", "EXECUTIVE"]),
    body("employmentType").optional().isIn(["FULL_TIME", "PART_TIME", "CONTRACT"]),
    body("joiningDate").optional().isISO8601(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    // College access guard: existing college must be accessible
    const { prisma: _p } = await import("../lib/prisma.js");
    const existing = await _p.staff.findUnique({
      where: { id: req.params.staffId },
      select: { collegeId: true },
    });
    if (existing && !canAccessCollege(req, existing.collegeId)) {
      res.status(403).json({ message: "Cannot update another college's staff" });
      return;
    }
    if (req.body.collegeId && !canAccessCollege(req, req.body.collegeId as string)) {
      res.status(403).json({ message: "Cannot transfer staff to another college" });
      return;
    }
    try {
      const updated = await HrService.updateStaff(req.params.staffId, req.body as HrService.UpdateStaffInput, req.user?.id);
      res.json(updated);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

hrRouter.delete(
  "/hr/staff/:staffId",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("staffId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    const { prisma: _p } = await import("../lib/prisma.js");
    const existing = await _p.staff.findUnique({
      where: { id: req.params.staffId },
      select: { collegeId: true },
    });
    if (existing && !canAccessCollege(req, existing.collegeId)) {
      res.status(403).json({ message: "Cannot delete another college's staff" });
      return;
    }
    try {
      await HrService.deleteStaff(req.params.staffId, req.user?.id);
      res.json({ message: "Staff member deleted successfully" });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

hrRouter.post(
  "/hr/staff/:staffId/reinvite",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("staffId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    const { prisma: _p } = await import("../lib/prisma.js");
    const existing = await _p.staff.findUnique({
      where: { id: req.params.staffId },
      select: { collegeId: true },
    });
    if (existing && !canAccessCollege(req, existing.collegeId)) {
      res.status(403).json({ message: "Cannot reinvite another college's staff" });
      return;
    }
    try {
      const result = await HrService.reinviteStaff(req.params.staffId, req.user?.id);
      res.json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

// ─── Salary Config ────────────────────────────────────────────────────────────

hrRouter.get(
  "/hr/staff/:staffId/salary",
  authenticate,
  payrollRateLimiter,
  requirePermission("PAYROLL_READ"),
  [param("staffId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const { prisma: _p } = await import("../lib/prisma.js");
    const staffMember = await _p.staff.findUnique({ where: { id: req.params.staffId }, select: { collegeId: true } });
    if (!staffMember) { res.status(404).json({ message: "Staff member not found" }); return; }
    if (!canAccessCollege(req, staffMember.collegeId)) { res.status(403).json({ message: "Cannot access another college's staff salary" }); return; }
    const config = await HrService.getSalaryConfig(req.params.staffId);
    res.json(config ?? null);
  },
);

hrRouter.put(
  "/hr/staff/:staffId/salary",
  authenticate,
  payrollRateLimiter,
  requirePermission("HR_WRITE"),
  [
    param("staffId").notEmpty(),
    body("basicSalary").optional().isFloat({ min: 0 }),
    body("hra").optional().isFloat({ min: 0 }),
    body("da").optional().isFloat({ min: 0 }),
    body("otherAllowances").optional().isFloat({ min: 0 }),
    body("bankAccountNumber").optional().isString(),
    body("bankName").optional().isString(),
    body("ifscCode").optional().isString(),
    body("pan").optional().isString(),
    body("pfUan").optional().isString(),
    body("paymentMode").optional().isIn(["BANK_TRANSFER", "CASH", "UPI"]),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    const { prisma: _p } = await import("../lib/prisma.js");
    const staffMember = await _p.staff.findUnique({ where: { id: req.params.staffId }, select: { collegeId: true } });
    if (!staffMember) { res.status(404).json({ message: "Staff member not found" }); return; }
    if (!canAccessCollege(req, staffMember.collegeId)) { res.status(403).json({ message: "Cannot update another college's staff salary" }); return; }
    try {
      const config = await HrService.setSalaryConfig(req.params.staffId, {
        basicSalary: req.body.basicSalary !== undefined ? Number(req.body.basicSalary) : undefined,
        hra: req.body.hra !== undefined ? Number(req.body.hra) : undefined,
        da: req.body.da !== undefined ? Number(req.body.da) : undefined,
        otherAllowances: req.body.otherAllowances !== undefined ? Number(req.body.otherAllowances) : undefined,
        bankAccountNumber: req.body.bankAccountNumber,
        bankName: req.body.bankName,
        ifscCode: req.body.ifscCode,
        pan: req.body.pan,
        pfUan: req.body.pfUan,
        paymentMode: req.body.paymentMode,
      }, req.user?.id);
      res.json(config);
    } catch (err) {
      next(err);
    }
  },
);

hrRouter.get(
  "/hr/salary-configs",
  authenticate,
  payrollRateLimiter,
  requirePermission("PAYROLL_READ"),
  async (req: AuthenticatedRequest, res) => {
    const collegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
    if (collegeId === "__FORBIDDEN__") {
      res.status(403).json({ message: "Cannot access another college's salary configs" });
      return;
    }
    const result = await HrService.listSalaryConfigs(collegeId);
    res.json(result);
  },
);

// ─── Attendance ───────────────────────────────────────────────────────────────

hrRouter.get(
  "/hr/attendance",
  authenticate,
  requirePermission("HR_READ", "HR_ATTENDANCE"),
  async (req: AuthenticatedRequest, res) => {
    const staffId = req.query.staffId as string | undefined;
    const limit = Math.min(Number(req.query.limit || 100), 500);

    if (staffId && req.user?.role !== "SUPER_ADMIN") {
      const { prisma: _p } = await import("../lib/prisma.js");
      const staffMember = await _p.staff.findUnique({ where: { id: staffId }, select: { collegeId: true } });
      if (!staffMember || staffMember.collegeId !== req.user?.collegeId) {
        res.status(403).json({ message: "Cannot access another college's attendance" });
        return;
      }
    }

    const result = await HrService.listAttendance(
      {
        staffId,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        cursor: req.query.cursor as string | undefined,
        limit,
      },
      req.user?.role !== "SUPER_ADMIN" ? req.user?.collegeId : undefined,
    );
    res.json(result);
  },
);

hrRouter.post(
  "/hr/attendance",
  authenticate,
  requirePermission("HR_ATTENDANCE"),
  [body("staffId").notEmpty(), body("date").isISO8601(), body("status").isIn(["PRESENT", "ABSENT", "HALF_DAY"])],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    const { prisma: _p } = await import("../lib/prisma.js");
    const staffMember = await _p.staff.findUnique({ where: { id: req.body.staffId }, select: { id: true, collegeId: true } });
    if (!staffMember) { res.status(404).json({ message: "Staff member not found" }); return; }
    if (!canAccessCollege(req, staffMember.collegeId)) { res.status(403).json({ message: "Cannot mark attendance for another college" }); return; }
    try {
      const attendance = await HrService.markAttendance({
        staffId: req.body.staffId,
        date: req.body.date,
        status: req.body.status,
        remarks: req.body.remarks,
      }, req.user?.id);
      res.status(201).json(attendance);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Leave ────────────────────────────────────────────────────────────────────

hrRouter.get(
  "/hr/leave-requests",
  authenticate,
  requirePermission("HR_READ"),
  async (req: AuthenticatedRequest, res) => {
    const staffId = req.query.staffId as string | undefined;
    const limit = Math.min(Number(req.query.limit || 100), 500);

    if (staffId && req.user?.role !== "SUPER_ADMIN") {
      const { prisma: _p } = await import("../lib/prisma.js");
      const staffMember = await _p.staff.findUnique({ where: { id: staffId }, select: { collegeId: true } });
      if (!staffMember || staffMember.collegeId !== req.user?.collegeId) {
        res.status(403).json({ message: "Cannot access another college's leave requests" });
        return;
      }
    }

    const result = await HrService.listLeaveRequests(
      {
        staffId,
        status: req.query.status as "PENDING" | "APPROVED" | "REJECTED" | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        cursor: req.query.cursor as string | undefined,
        limit,
      },
      req.user?.role !== "SUPER_ADMIN" ? req.user?.collegeId : undefined,
    );
    res.json(result);
  },
);

hrRouter.patch(
  "/hr/leave-requests/:leaveRequestId/status",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("leaveRequestId").notEmpty(), body("status").isIn(["APPROVED", "REJECTED"])],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    // College access guard
    const { prisma: _p } = await import("../lib/prisma.js");
    const existing = await _p.leaveRequest.findUnique({
      where: { id: req.params.leaveRequestId },
      include: { staff: { select: { collegeId: true } } },
    });
    if (existing && !canAccessCollege(req, existing.staff.collegeId)) {
      res.status(403).json({ message: "Cannot review another college's leave request" });
      return;
    }
    try {
      const updated = await HrService.updateLeaveStatus(
        req.params.leaveRequestId,
        req.body.status as "APPROVED" | "REJECTED",
        req.user?.id,
      );
      res.json(updated);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

hrRouter.get(
  "/hr/leave-balance/:staffId",
  authenticate,
  requirePermission("HR_READ"),
  [param("staffId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const { prisma: _p } = await import("../lib/prisma.js");
    const staffMember = await _p.staff.findUnique({ where: { id: req.params.staffId }, select: { id: true, collegeId: true } });
    if (!staffMember) { res.status(404).json({ message: "Staff member not found" }); return; }
    if (!canAccessCollege(req, staffMember.collegeId)) { res.status(403).json({ message: "Cannot access another college's data" }); return; }
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const balances = await HrService.getLeaveBalance(req.params.staffId, year);
    res.json(balances);
  },
);

hrRouter.put(
  "/hr/leave-balance/:staffId",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("staffId").notEmpty(), body("leaveType").isString().notEmpty(), body("totalDays").isInt({ min: 0 }), body("year").isInt({ min: 2000 })],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    const { prisma: _p } = await import("../lib/prisma.js");
    const staffMember = await _p.staff.findUnique({ where: { id: req.params.staffId }, select: { id: true, collegeId: true } });
    if (!staffMember) { res.status(404).json({ message: "Staff member not found" }); return; }
    if (!canAccessCollege(req, staffMember.collegeId)) { res.status(403).json({ message: "Cannot update another college's data" }); return; }
    try {
      const balance = await HrService.setLeaveBalance(
        req.params.staffId,
        req.body.leaveType,
        Number(req.body.year),
        Number(req.body.totalDays),
      );
      res.json(balance);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Payroll ──────────────────────────────────────────────────────────────────

hrRouter.post(
  "/hr/payroll",
  authenticate,
  payrollRateLimiter,
  requirePermission("HR_WRITE"),
  [body("staffId").notEmpty(), body("amount").isFloat({ gt: 0 }), body("month").isInt({ min: 1, max: 12 }), body("year").isInt()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    const { prisma: _p } = await import("../lib/prisma.js");
    const staffMember = await _p.staff.findUnique({ where: { id: req.body.staffId }, select: { collegeId: true } });
    if (!staffMember) { res.status(404).json({ message: "Staff member not found" }); return; }
    if (!canAccessCollege(req, staffMember.collegeId)) { res.status(403).json({ message: "Cannot process payroll for another college" }); return; }
    try {
      const payroll = await HrService.processPayroll({
        staffId: req.body.staffId,
        amount: Number(req.body.amount),
        grossAmount: req.body.grossAmount !== undefined ? Number(req.body.grossAmount) : undefined,
        month: Number(req.body.month),
        year: Number(req.body.year),
        deductions: req.body.deductions,
      }, req.user?.id);
      res.status(201).json(payroll);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

hrRouter.get(
  "/hr/payroll",
  authenticate,
  payrollRateLimiter,
  requirePermission("HR_READ"),
  async (req: AuthenticatedRequest, res) => {
    const staffId = req.query.staffId as string | undefined;
    if (staffId && req.user?.role !== "SUPER_ADMIN") {
      const { prisma: _p } = await import("../lib/prisma.js");
      const staffMember = await _p.staff.findUnique({ where: { id: staffId }, select: { collegeId: true } });
      if (!staffMember || staffMember.collegeId !== req.user?.collegeId) {
        res.status(403).json({ message: "Cannot access another college's payroll" });
        return;
      }
    }
    const payroll = await HrService.listPayroll({
      staffId,
      collegeId: req.user?.role !== "SUPER_ADMIN" ? req.user?.collegeId : undefined,
    });
    res.json(payroll);
  },
);

hrRouter.patch(
  "/hr/payroll/:payrollId/status",
  authenticate,
  payrollRateLimiter,
  requirePermission("HR_WRITE"),
  [param("payrollId").notEmpty(), body("status").isIn(["PROCESSED", "PAID", "REVERSED"])],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    const { prisma: _p } = await import("../lib/prisma.js");
    const existing = await _p.payroll.findUnique({
      where: { id: req.params.payrollId },
      include: { staff: { select: { collegeId: true } } },
    });
    if (existing && !canAccessCollege(req, existing.staff.collegeId)) {
      res.status(403).json({ message: "Cannot update another college's payroll" });
      return;
    }
    try {
      const updated = await HrService.updatePayrollStatus(req.params.payrollId, req.body.status, req.user?.id);
      res.json(updated);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

// ─── Staff Documents ──────────────────────────────────────────────────────────

hrRouter.post(
  "/hr/staff/:staffId/documents",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("staffId").notEmpty()],
  handleValidation,
  staffDocUpload.single("file"),
  async (req: AuthenticatedRequest, res, next) => {
    if (!req.file) { res.status(400).json({ message: "No file uploaded" }); return; }
    const { prisma: _p } = await import("../lib/prisma.js");
    const staffMember = await _p.staff.findUnique({ where: { id: req.params.staffId }, select: { id: true, collegeId: true } });
    if (!staffMember) {
      fs.unlink(req.file.path, () => {});
      res.status(404).json({ message: "Staff member not found" });
      return;
    }
    if (!canAccessCollege(req, staffMember.collegeId)) {
      fs.unlink(req.file.path, () => {});
      res.status(403).json({ message: "Cannot upload documents for another college's staff" });
      return;
    }
    try {
      const { HrRepository } = await import("../repositories/hr.repository.js");
      const repo = new HrRepository(prisma);
      const doc = await repo.createStaffDocument({
        staffId: staffMember.id,
        collegeId: staffMember.collegeId,
        fileName: req.file.originalname,
        storagePath: req.file.path,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedBy: req.user?.id,
      });
      await writeAuditLog(prisma, {
        actorUserId: req.user?.id,
        action: "DOCUMENT_UPLOADED",
        entityType: "STAFF",
        entityId: staffMember.id,
        metadata: { documentId: doc.id, fileName: doc.fileName },
      });
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  },
);

hrRouter.get(
  "/hr/staff/:staffId/documents",
  authenticate,
  requirePermission("HR_READ"),
  [param("staffId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const { prisma: _p } = await import("../lib/prisma.js");
    const staffMember = await _p.staff.findUnique({ where: { id: req.params.staffId }, select: { id: true, collegeId: true } });
    if (!staffMember) { res.status(404).json({ message: "Staff member not found" }); return; }
    if (!canAccessCollege(req, staffMember.collegeId)) { res.status(403).json({ message: "Cannot access another college's staff documents" }); return; }
    const { HrRepository } = await import("../repositories/hr.repository.js");
    const repo = new HrRepository(prisma);
    const docs = await repo.listStaffDocuments(staffMember.id);
    res.json(docs);
  },
);

// ─── Onboarding Drafts ────────────────────────────────────────────────────────

hrRouter.get(
  "/hr/onboarding-drafts",
  authenticate,
  requirePermission("HR_WRITE"),
  async (req: AuthenticatedRequest, res) => {
    const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
    if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Cannot access another college's drafts" }); return; }
    const drafts = await HrService.listOnboardingDrafts(req.user!.id, scopedCollegeId);
    res.json(drafts);
  },
);

hrRouter.post(
  "/hr/onboarding-drafts",
  authenticate,
  requirePermission("HR_WRITE"),
  [body("collegeId").notEmpty(), body("formDataJson").notEmpty(), body("step").optional().isInt({ min: 1 })],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) { res.status(403).json({ message: "Cannot create draft for another college" }); return; }
    try {
      const draft = await HrService.createOnboardingDraft(
        req.user!.id,
        req.body.collegeId,
        req.body.formDataJson,
        Number(req.body.step ?? 1),
      );
      res.status(201).json(draft);
    } catch (err) {
      next(err);
    }
  },
);

hrRouter.patch(
  "/hr/onboarding-drafts/:draftId",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("draftId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const updated = await HrService.updateOnboardingDraft(req.params.draftId, req.user!.id, {
        formDataJson: req.body.formDataJson,
        step: req.body.step !== undefined ? Number(req.body.step) : undefined,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

hrRouter.delete(
  "/hr/onboarding-drafts/:draftId",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("draftId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      await HrService.deleteOnboardingDraft(
        req.params.draftId,
        req.user!.id,
        req.user?.role === "SUPER_ADMIN",
      );
      res.json({ message: "Draft deleted" });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);
