import { Router } from "express";
import { body, param } from "express-validator";
import fs from "fs";
import multer from "multer";
import path from "path";
import { ExceptionModule, ExceptionSeverity } from "@prisma/client";
import { createExceptionCase } from "../lib/exceptions.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/auth.js";
import { buildInviteLink, generateOpaqueToken, hashOpaqueToken } from "../lib/security.js";
import { authenticate, canAccessCollege, getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";
import { writeAuditLog } from "../lib/audit.js";
import { sendInAppNotification, sendNotification } from "../lib/notify.js";
import { createRateLimitMiddleware } from "../lib/rate-limit.js";

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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
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
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) {
      res.status(403).json({ message: "Cannot manage staff for another college" });
      return;
    }

    const normalizedEmail = String(req.body.email).trim().toLowerCase();

    const [existingStaff, existingUser] = await Promise.all([
      prisma.staff.findFirst({
        where: { email: { equals: normalizedEmail, mode: "insensitive" } },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: "insensitive" } },
        select: { id: true, staffId: true },
      }),
    ]);
    if (existingStaff) {
      res.status(409).json({ message: "A staff account with this email already exists" });
      return;
    }
    if (existingUser) {
      res.status(409).json({ message: "A user account with this email already exists" });
      return;
    }

    const rawSetupToken = generateOpaqueToken(32);
    const setupTokenHash = hashOpaqueToken(rawSetupToken);
    const temporaryPassword = generateOpaqueToken(12);
    const passwordHash = await hashPassword(temporaryPassword);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const customRoleId = typeof req.body.customRoleId === "string" && req.body.customRoleId.trim().length > 0
      ? req.body.customRoleId.trim()
      : null;

    if (customRoleId) {
      const customRole = await prisma.customRole.findUnique({ where: { id: customRoleId }, select: { collegeId: true, name: true } });
      if (!customRole || customRole.collegeId !== req.body.collegeId) {
        res.status(400).json({ message: "Custom role must belong to the same college" });
        return;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const staff = await tx.staff.create({
        data: {
          collegeId: req.body.collegeId,
          customRoleId,
          fullName: req.body.fullName,
          email: normalizedEmail,
          mobile: req.body.mobile,
          role: req.body.role ?? "ATTENDANCE_OPERATOR",
          designation: req.body.designation ?? null,
          staffType: req.body.staffType ?? null,
          employmentType: req.body.employmentType ?? null,
          joiningDate: req.body.joiningDate ? new Date(req.body.joiningDate as string) : null,

          // Extended personal profile
          dob: req.body.dob ? new Date(req.body.dob as string) : null,
          gender: req.body.gender ?? null,
          nationality: req.body.nationality ?? null,
          emergencyContact: req.body.emergencyContact ?? null,
          currentAddress: req.body.currentAddress ?? null,
          currentCity: req.body.currentCity ?? null,
          currentDistrict: req.body.currentDistrict ?? null,
          currentState: req.body.currentState ?? null,
          currentPincode: req.body.currentPincode ?? null,
          currentCountry: req.body.currentCountry ?? null,
          permanentAddress: req.body.permanentAddress ?? null,
          permanentCity: req.body.permanentCity ?? null,
          permanentDistrict: req.body.permanentDistrict ?? null,
          permanentState: req.body.permanentState ?? null,
          permanentPincode: req.body.permanentPincode ?? null,
          permanentCountry: req.body.permanentCountry ?? null,

          // Employment details
          department: req.body.department ?? null,
          functionalRole: req.body.functionalRole ?? null,
          subjectSpecialization: req.body.subjectSpecialization ?? null,
          qualification: req.body.qualification ?? null,
          experience: req.body.experience ?? null,
          employmentStatus: req.body.employmentStatus ?? null,

          invitedAt: new Date(),
        },
      });

      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role: "STAFF",
          staffId: staff.id,
        },
      });

      await tx.passwordSetupToken.create({
        data: {
          userId: user.id,
          tokenHash: setupTokenHash,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user?.id,
          action: "STAFF_INVITED",
          entityType: "STAFF",
          entityId: staff.id,
          metadata: {
            email: staff.email,
            collegeId: staff.collegeId,
            inviteExpiresAt: expiresAt.toISOString(),
          },
        },
      });

      return { staff, user };
    });

    // Send the invite link via email only — never expose it in the response body.
    const inviteLink = buildInviteLink(rawSetupToken);
    await sendNotification({
      collegeId: result.staff.collegeId,
      recipientId: result.user.id,
      recipientEmail: normalizedEmail,
      subject: "Your CampusGrid account invitation",
      body: `Hello ${result.staff.fullName},\n\nYou have been invited to CampusGrid. Use the link below to set up your password (expires in 24 hours):\n\n${inviteLink}\n\nIf you did not expect this invitation, please ignore this email.`,
      metadata: { staffId: result.staff.id, expiresAt: expiresAt.toISOString() },
    });

    await sendInAppNotification({
      collegeId: result.staff.collegeId,
      recipientId: result.user.id,
      subject: "Account invitation sent",
      body: "Your account invitation email has been sent. Please complete password setup from the link in your email.",
      metadata: { nav: "settings", type: "STAFF_INVITE" },
    });

    res.status(201).json({
      id: result.staff.id,
      email: result.staff.email,
      fullName: result.staff.fullName,
      collegeId: result.staff.collegeId,
      role: result.staff.customRoleId
        ? (await prisma.customRole.findUnique({ where: { id: result.staff.customRoleId }, select: { name: true } }))?.name ?? result.staff.role
        : result.staff.role,
      customRoleId: result.staff.customRoleId,
      invite: {
        expiresAt: expiresAt.toISOString(),
        // Invite link delivered via email only (not returned in response)
      },
    });
  }
);

hrRouter.get("/hr/staff", authenticate, requirePermission("HR_READ"), async (req, res) => {
  const collegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (collegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's staff" });
    return;
  }

  const staff = await prisma.staff.findMany({
    where: collegeId ? { collegeId } : {},
    include: { customRole: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(staff.map((member) => ({
    ...member,
    role: member.customRole?.name ?? member.role,
  })));
});

hrRouter.get("/hr/attendance", authenticate, requirePermission("HR_READ", "HR_ATTENDANCE"), async (req: AuthenticatedRequest, res) => {
  const staffId = req.query.staffId as string | undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(Number(req.query.limit || 100), 500); // Max 500 per page

  if (staffId && req.user?.role !== "SUPER_ADMIN") {
    const staffMember = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { collegeId: true },
    });
    if (!staffMember || staffMember.collegeId !== req.user?.collegeId) {
      res.status(403).json({ message: "Cannot access another college's attendance" });
      return;
    }
  }

  const attendance = await prisma.attendance.findMany({
    where: {
      ...(staffId ? { staffId } : {}),
      ...(req.user?.role !== "SUPER_ADMIN" ? { staff: { collegeId: req.user?.collegeId } } : {}),
      ...(startDate || endDate
        ? {
            date: {
              ...(startDate ? { gte: new Date(startDate) } : {}),
              ...(endDate ? { lte: new Date(endDate) } : {}),
            },
          }
        : {}),
    },
    include: {
      staff: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
    },
    orderBy: { date: "desc" },
    take: limit + 1, // +1 to check if there are more records
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = attendance.length > limit;
  const data = attendance.slice(0, limit);
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : undefined;

  res.json({
    data,
    nextCursor,
    hasMore,
  });
});

hrRouter.get("/hr/leave-requests", authenticate, requirePermission("HR_READ"), async (req: AuthenticatedRequest, res) => {
  const staffId = req.query.staffId as string | undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const status = req.query.status as string | undefined;
  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(Number(req.query.limit || 100), 500); // Max 500 per page

  if (staffId && req.user?.role !== "SUPER_ADMIN") {
    const staffMember = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { collegeId: true },
    });
    if (!staffMember || staffMember.collegeId !== req.user?.collegeId) {
      res.status(403).json({ message: "Cannot access another college's leave requests" });
      return;
    }
  }

  const leaveRequests = await prisma.leaveRequest.findMany({
    where: {
      ...(staffId ? { staffId } : {}),
      ...(req.user?.role !== "SUPER_ADMIN" ? { staff: { collegeId: req.user?.collegeId } } : {}),
      ...(status ? { status: status as "PENDING" | "APPROVED" | "REJECTED" } : {}),
      ...(startDate || endDate
        ? {
            fromDate: {
              ...(startDate ? { gte: new Date(startDate) } : {}),
              ...(endDate ? { lte: new Date(endDate) } : {}),
            },
          }
        : {}),
    },
    include: {
      staff: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // +1 to check if there are more records
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = leaveRequests.length > limit;
  const data = leaveRequests.slice(0, limit);
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : undefined;

  res.json({
    data,
    nextCursor,
    hasMore,
  });
});

hrRouter.patch(
  "/hr/leave-requests/:leaveRequestId/status",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("leaveRequestId").notEmpty(), body("status").isIn(["APPROVED", "REJECTED"])],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.leaveRequest.findUnique({
      where: { id: req.params.leaveRequestId },
      include: { staff: { select: { collegeId: true } } },
    });
    if (!existing) {
      res.status(404).json({ message: "Leave request not found" });
      return;
    }
    if (!canAccessCollege(req, existing.staff.collegeId)) {
      res.status(403).json({ message: "Cannot review another college's leave request" });
      return;
    }
    if (existing.status !== "PENDING") {
      await createExceptionCase(prisma, {
        collegeId: existing.staff.collegeId,
        module: ExceptionModule.HR,
        category: "INVALID_LEAVE_STATUS_TRANSITION",
        severity: ExceptionSeverity.MEDIUM,
        title: "Leave review conflict",
        description: `Leave request ${existing.id} is already ${existing.status}`,
        sourceEntityType: "LEAVE_REQUEST",
        sourceEntityId: existing.id,
        sourceOperation: "LEAVE_STATUS_UPDATE",
        dedupeKey: `LEAVE:${existing.id}:STATUS_CONFLICT`,
        isRetryable: false,
        metadata: {
          currentStatus: existing.status,
          requestedStatus: req.body.status,
          staffId: existing.staffId,
        },
        createdByUserId: req.user?.id,
      });
      res.status(409).json({ message: `Leave request is already ${existing.status}` });
      return;
    }

    // Deduct from LeaveBalance when approving
    if (req.body.status === "APPROVED") {
      const fromDate = new Date(existing.fromDate);
      const toDate = new Date(existing.toDate);
      const days = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const year = fromDate.getFullYear();
      const leaveType = (existing as { leaveType?: string | null }).leaveType ?? "GENERAL";

      await prisma.leaveBalance.upsert({
        where: { staffId_leaveType_year: { staffId: existing.staffId, leaveType, year } },
        update: { usedDays: { increment: days } },
        create: { staffId: existing.staffId, leaveType, year, totalDays: 0, usedDays: days },
      });
    }

    const leaveRequest = await prisma.leaveRequest.update({
      where: { id: req.params.leaveRequestId },
      data: { status: req.body.status },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "LEAVE_STATUS_UPDATED",
      entityType: "LEAVE_REQUEST",
      entityId: leaveRequest.id,
      metadata: {
        status: leaveRequest.status,
        staffId: leaveRequest.staffId,
      },
    });

    res.json(leaveRequest);
  }
);

hrRouter.post(
  "/hr/attendance",
  authenticate,
  requirePermission("HR_ATTENDANCE"),
  [body("staffId").notEmpty(), body("date").isISO8601(), body("status").isIn(["PRESENT", "ABSENT", "HALF_DAY"])],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const staffMember = await prisma.staff.findUnique({
      where: { id: req.body.staffId },
      select: { id: true, collegeId: true },
    });
    if (!staffMember) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }
    if (!canAccessCollege(req, staffMember.collegeId)) {
      res.status(403).json({ message: "Cannot mark attendance for another college" });
      return;
    }

    const attendance = await prisma.attendance.upsert({
      where: {
        staffId_date: {
          staffId: req.body.staffId,
          date: new Date(req.body.date),
        },
      },
      update: {
        status: req.body.status,
        remarks: req.body.remarks,
      },
      create: {
        staffId: req.body.staffId,
        date: new Date(req.body.date),
        status: req.body.status,
        remarks: req.body.remarks,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "ATTENDANCE_MARKED",
      entityType: "ATTENDANCE",
      entityId: attendance.id,
      metadata: { staffId: attendance.staffId, status: attendance.status, date: attendance.date },
    });

    res.status(201).json(attendance);
  }
);

hrRouter.post(
  "/hr/payroll",
  authenticate,
  payrollRateLimiter,
  requirePermission("HR_WRITE"),
  [body("staffId").notEmpty(), body("amount").isFloat({ gt: 0 }), body("month").isInt({ min: 1, max: 12 }), body("year").isInt()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const staffMember = await prisma.staff.findUnique({
      where: { id: req.body.staffId },
      select: { collegeId: true },
    });
    if (!staffMember) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }
    if (!canAccessCollege(req, staffMember.collegeId)) {
      res.status(403).json({ message: "Cannot process payroll for another college" });
      return;
    }

    const existingPayroll = await prisma.payroll.findFirst({
      where: {
        staffId: req.body.staffId,
        month: Number(req.body.month),
        year: Number(req.body.year),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });

    // PAY-05: Prevent double-run — a PAID payroll cannot be reprocessed
    if (existingPayroll && existingPayroll.status === "PAID") {
      res.status(409).json({
        code: "PAYROLL_LOCKED",
        message: `Payroll for ${req.body.month}/${req.body.year} has already been paid and cannot be reprocessed. Use status PATCH to reverse it first.`,
      });
      return;
    }

    const deductions = Array.isArray(req.body.deductions)
      ? (req.body.deductions as Array<{ type: string; label: string; amount: number }>)
      : [];

    const grossAmount = Number(req.body.grossAmount ?? req.body.amount);
    const totalDeductions = deductions.reduce((sum, d) => sum + Number(d.amount), 0);
    const netAmount = grossAmount - totalDeductions;

    const payroll = existingPayroll
      ? await prisma.payroll.update({
          where: { id: existingPayroll.id },
          data: {
            amount: netAmount,
            grossAmount,
            totalDeductions,
            netAmount,
            deductions: {
              deleteMany: {},
              create: deductions.map((d) => ({
                type: d.type as never,
                label: d.label,
                amount: Number(d.amount),
              })),
            },
          },
          include: { deductions: true },
        })
      : await prisma.payroll.create({
          data: {
            staffId: req.body.staffId,
            amount: netAmount,
            grossAmount,
            totalDeductions,
            netAmount,
            month: Number(req.body.month),
            year: Number(req.body.year),
            deductions: {
              create: deductions.map((d) => ({
                type: d.type as never,
                label: d.label,
                amount: Number(d.amount),
              })),
            },
          },
          include: { deductions: true },
        });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "PAYROLL_PROCESSED",
      entityType: "PAYROLL",
      entityId: payroll.id,
      metadata: {
        staffId: payroll.staffId,
        month: payroll.month,
        year: payroll.year,
        amount: payroll.amount,
      },
    });

    res.status(201).json(payroll);
  }
);

hrRouter.get("/hr/payroll", authenticate, payrollRateLimiter, requirePermission("HR_READ"), async (req: AuthenticatedRequest, res) => {
  const staffId = req.query.staffId as string | undefined;
  if (staffId && req.user?.role !== "SUPER_ADMIN") {
    const staffMember = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { collegeId: true },
    });
    if (!staffMember || staffMember.collegeId !== req.user?.collegeId) {
      res.status(403).json({ message: "Cannot access another college's payroll" });
      return;
    }
  }

  const payroll = await prisma.payroll.findMany({
    where: {
      ...(staffId ? { staffId } : {}),
      ...(req.user?.role !== "SUPER_ADMIN" ? { staff: { collegeId: req.user?.collegeId } } : {}),
    },
    include: {
      staff: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  res.json(payroll);
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
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.staff.findUnique({
      where: { id: req.params.staffId },
      select: { id: true, collegeId: true, role: true, isActive: true, email: true, user: { select: { id: true } } },
    });
    if (!existing) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }
    if (!canAccessCollege(req, existing.collegeId)) {
      res.status(403).json({ message: "Cannot update another college's staff" });
      return;
    }
    if (req.body.collegeId && !canAccessCollege(req, req.body.collegeId as string)) {
      res.status(403).json({ message: "Cannot transfer staff to another college" });
      return;
    }

    const customRoleId = req.body.customRoleId === null
      ? null
      : typeof req.body.customRoleId === "string" && req.body.customRoleId.trim().length > 0
        ? req.body.customRoleId.trim()
        : undefined;

    if (customRoleId !== undefined && customRoleId !== null) {
      const customRole = await prisma.customRole.findUnique({ where: { id: customRoleId }, select: { collegeId: true } });
      const targetCollegeId = String(req.body.collegeId ?? existing.collegeId);
      if (!customRole || customRole.collegeId !== targetCollegeId) {
        res.status(400).json({ message: "Custom role must belong to the same college" });
        return;
      }
    }

    const normalizedEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : undefined;
    if (normalizedEmail && normalizedEmail !== existing.email.toLowerCase()) {
      const [emailInStaff, emailInUser] = await Promise.all([
        prisma.staff.findFirst({
          where: {
            email: { equals: normalizedEmail, mode: "insensitive" },
            id: { not: existing.id },
          },
          select: { id: true },
        }),
        prisma.user.findFirst({
          where: {
            email: { equals: normalizedEmail, mode: "insensitive" },
            ...(existing.user?.id ? { id: { not: existing.user.id } } : {}),
          },
          select: { id: true },
        }),
      ]);

      if (emailInStaff || emailInUser) {
        res.status(409).json({ message: "Email is already in use by another account" });
        return;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const staffUpdate = await tx.staff.update({
        where: { id: req.params.staffId },
        data: {
          ...(req.body.fullName ? { fullName: req.body.fullName } : {}),
          ...(normalizedEmail ? { email: normalizedEmail } : {}),
          ...(req.body.mobile ? { mobile: req.body.mobile } : {}),
          ...(req.body.role ? { role: req.body.role } : {}),
          ...(customRoleId !== undefined ? { customRoleId } : {}),
          ...(typeof req.body.isActive === "boolean" ? { isActive: req.body.isActive } : {}),
          ...(req.body.collegeId ? { collegeId: req.body.collegeId } : {}),
          ...(req.body.designation !== undefined ? { designation: req.body.designation } : {}),
          ...(req.body.staffType !== undefined ? { staffType: req.body.staffType } : {}),
          ...(req.body.employmentType !== undefined ? { employmentType: req.body.employmentType } : {}),
          ...(req.body.joiningDate ? { joiningDate: new Date(req.body.joiningDate as string) } : {}),

          // Extended profile fields
          ...(req.body.dob !== undefined ? { dob: req.body.dob ? new Date(req.body.dob as string) : null } : {}),
          ...(req.body.gender !== undefined ? { gender: req.body.gender ?? null } : {}),
          ...(req.body.nationality !== undefined ? { nationality: req.body.nationality ?? null } : {}),
          ...(req.body.emergencyContact !== undefined ? { emergencyContact: req.body.emergencyContact ?? null } : {}),
          ...(req.body.currentAddress !== undefined ? { currentAddress: req.body.currentAddress ?? null } : {}),
          ...(req.body.currentCity !== undefined ? { currentCity: req.body.currentCity ?? null } : {}),
          ...(req.body.currentDistrict !== undefined ? { currentDistrict: req.body.currentDistrict ?? null } : {}),
          ...(req.body.currentState !== undefined ? { currentState: req.body.currentState ?? null } : {}),
          ...(req.body.currentPincode !== undefined ? { currentPincode: req.body.currentPincode ?? null } : {}),
          ...(req.body.currentCountry !== undefined ? { currentCountry: req.body.currentCountry ?? null } : {}),
          ...(req.body.permanentAddress !== undefined ? { permanentAddress: req.body.permanentAddress ?? null } : {}),
          ...(req.body.permanentCity !== undefined ? { permanentCity: req.body.permanentCity ?? null } : {}),
          ...(req.body.permanentDistrict !== undefined ? { permanentDistrict: req.body.permanentDistrict ?? null } : {}),
          ...(req.body.permanentState !== undefined ? { permanentState: req.body.permanentState ?? null } : {}),
          ...(req.body.permanentPincode !== undefined ? { permanentPincode: req.body.permanentPincode ?? null } : {}),
          ...(req.body.permanentCountry !== undefined ? { permanentCountry: req.body.permanentCountry ?? null } : {}),
          ...(req.body.department !== undefined ? { department: req.body.department ?? null } : {}),
          ...(req.body.functionalRole !== undefined ? { functionalRole: req.body.functionalRole ?? null } : {}),
          ...(req.body.subjectSpecialization !== undefined ? { subjectSpecialization: req.body.subjectSpecialization ?? null } : {}),
          ...(req.body.qualification !== undefined ? { qualification: req.body.qualification ?? null } : {}),
          ...(req.body.experience !== undefined ? { experience: req.body.experience ?? null } : {}),
          ...(req.body.employmentStatus !== undefined ? { employmentStatus: req.body.employmentStatus ?? null } : {}),
        },
      });

      if (normalizedEmail && existing.user?.id) {
        await tx.user.update({
          where: { id: existing.user.id },
          data: { email: normalizedEmail },
        });
      }

      return staffUpdate;
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "STAFF_UPDATED",
      entityType: "STAFF",
      entityId: updated.id,
      metadata: { role: updated.role, isActive: updated.isActive, collegeId: updated.collegeId },
    });

    res.json(updated);
  }
);

hrRouter.delete(
  "/hr/staff/:staffId",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("staffId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.staff.findUnique({
      where: { id: req.params.staffId },
      select: {
        id: true,
        collegeId: true,
        fullName: true,
        user: { select: { id: true } },
      },
    });

    if (!existing) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }

    if (!canAccessCollege(req, existing.collegeId)) {
      res.status(403).json({ message: "Cannot delete another college's staff" });
      return;
    }

    const [attendanceCount, leaveCount, payrollCount] = await Promise.all([
      prisma.attendance.count({ where: { staffId: existing.id } }),
      prisma.leaveRequest.count({ where: { staffId: existing.id } }),
      prisma.payroll.count({ where: { staffId: existing.id } }),
    ]);

    if (attendanceCount > 0 || leaveCount > 0 || payrollCount > 0) {
      res.status(409).json({
        message: "Cannot delete staff with linked attendance, leave, or payroll records. Mark staff inactive instead.",
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (existing.user?.id) {
        await tx.user.delete({ where: { id: existing.user.id } });
      }
      await tx.staff.delete({ where: { id: existing.id } });
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "STAFF_DELETED",
      entityType: "STAFF",
      entityId: existing.id,
      metadata: { fullName: existing.fullName, collegeId: existing.collegeId },
    });

    res.json({ message: "Staff member deleted successfully" });
  }
);

hrRouter.post(
  "/hr/staff/:staffId/reinvite",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("staffId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.staff.findUnique({
      where: { id: req.params.staffId },
      include: {
        user: {
          select: {
            id: true,
          },
        },
      },
    });
    if (!existing || !existing.user) {
      res.status(404).json({ message: "Staff member or linked user not found" });
      return;
    }
    if (!canAccessCollege(req, existing.collegeId)) {
      res.status(403).json({ message: "Cannot reinvite another college's staff" });
      return;
    }

    const rawSetupToken = generateOpaqueToken(32);
    const setupTokenHash = hashOpaqueToken(rawSetupToken);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

    await prisma.$transaction(async (tx) => {
      await tx.passwordSetupToken.create({
        data: {
          userId: existing.user!.id,
          tokenHash: setupTokenHash,
          expiresAt,
        },
      });

      await tx.staff.update({
        where: { id: existing.id },
        data: { invitedAt: new Date() },
      });
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "STAFF_REINVITED",
      entityType: "STAFF",
      entityId: existing.id,
      metadata: { inviteExpiresAt: expiresAt.toISOString() },
    });

    res.json({
      invite: {
        expiresAt: expiresAt.toISOString(),
        inviteLink: buildInviteLink(rawSetupToken),
      },
    });
  }
);

// ─── Salary Configuration ─────────────────────────────────────────────────────

hrRouter.get("/hr/staff/:staffId/salary", authenticate, payrollRateLimiter, requirePermission("PAYROLL_READ"), async (req: AuthenticatedRequest, res) => {
  const staffMember = await prisma.staff.findUnique({
    where: { id: req.params.staffId },
    select: { collegeId: true },
  });
  if (!staffMember) {
    res.status(404).json({ message: "Staff member not found" });
    return;
  }
  if (!canAccessCollege(req, staffMember.collegeId)) {
    res.status(403).json({ message: "Cannot access another college's staff salary" });
    return;
  }

  const config = await prisma.staffSalaryConfig.findUnique({ where: { staffId: req.params.staffId } });
  res.json(config ?? null);
});

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
  async (req: AuthenticatedRequest, res) => {
    const staffMember = await prisma.staff.findUnique({
      where: { id: req.params.staffId },
      select: { collegeId: true },
    });
    if (!staffMember) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }
    if (!canAccessCollege(req, staffMember.collegeId)) {
      res.status(403).json({ message: "Cannot update another college's staff salary" });
      return;
    }

    const data = {
      ...(req.body.basicSalary !== undefined ? { basicSalary: Number(req.body.basicSalary) } : {}),
      ...(req.body.hra !== undefined ? { hra: Number(req.body.hra) } : {}),
      ...(req.body.da !== undefined ? { da: Number(req.body.da) } : {}),
      ...(req.body.otherAllowances !== undefined ? { otherAllowances: Number(req.body.otherAllowances) } : {}),
      ...(req.body.bankAccountNumber !== undefined ? { bankAccountNumber: req.body.bankAccountNumber } : {}),
      ...(req.body.bankName !== undefined ? { bankName: req.body.bankName } : {}),
      ...(req.body.ifscCode !== undefined ? { ifscCode: req.body.ifscCode } : {}),
      ...(req.body.pan !== undefined ? { pan: req.body.pan } : {}),
      ...(req.body.pfUan !== undefined ? { pfUan: req.body.pfUan } : {}),
      ...(req.body.paymentMode !== undefined ? { paymentMode: req.body.paymentMode } : {}),
    };

    const config = await prisma.staffSalaryConfig.upsert({
      where: { staffId: req.params.staffId },
      update: data,
      create: { staffId: req.params.staffId, ...data },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "SALARY_CONFIG_UPDATED",
      entityType: "STAFF_SALARY_CONFIG",
      entityId: config.id,
      metadata: { staffId: req.params.staffId },
    });

    res.json(config);
  }
);

// ─── Salary Configs Bulk ─────────────────────────────────────────────────────

hrRouter.get("/hr/salary-configs", authenticate, payrollRateLimiter, requirePermission("PAYROLL_READ"), async (req: AuthenticatedRequest, res) => {
  const collegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (collegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's salary configs" });
    return;
  }

  const configs = await prisma.staffSalaryConfig.findMany({
    where: collegeId ? { staff: { collegeId } } : {},
    include: { staff: { select: { id: true } } },
  });

  // Return as Record<staffId, config>
  const result: Record<string, typeof configs[number]> = {};
  for (const config of configs) {
    result[config.staffId] = config;
  }
  res.json(result);
});

// ─── Payroll Status ───────────────────────────────────────────────────────────

hrRouter.patch(
  "/hr/payroll/:payrollId/status",
  authenticate,
  payrollRateLimiter,
  requirePermission("HR_WRITE"),
  [param("payrollId").notEmpty(), body("status").isIn(["PROCESSED", "PAID", "REVERSED"])],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.payroll.findUnique({
      where: { id: req.params.payrollId },
      include: { staff: { select: { collegeId: true } } },
    });
    if (!existing) {
      res.status(404).json({ message: "Payroll record not found" });
      return;
    }
    if (!canAccessCollege(req, existing.staff.collegeId)) {
      res.status(403).json({ message: "Cannot update another college's payroll" });
      return;
    }

    const updated = await prisma.payroll.update({
      where: { id: req.params.payrollId },
      data: {
        status: req.body.status,
        ...(req.body.status === "PAID" ? { paidAt: new Date() } : {}),
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "PAYROLL_STATUS_UPDATED",
      entityType: "PAYROLL",
      entityId: updated.id,
      metadata: { status: updated.status, staffId: updated.staffId, month: updated.month, year: updated.year },
    });

    res.json(updated);
  }
);

// GET /hr/leave-balance/:staffId — get leave balances for a staff member
hrRouter.get(
  "/hr/leave-balance/:staffId",
  authenticate,
  requirePermission("HR_READ"),
  [param("staffId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const staffMember = await prisma.staff.findUnique({
      where: { id: req.params.staffId },
      select: { id: true, collegeId: true },
    });
    if (!staffMember) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }
    if (!canAccessCollege(req, staffMember.collegeId)) {
      res.status(403).json({ message: "Cannot access another college's data" });
      return;
    }

    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

    const balances = await prisma.leaveBalance.findMany({
      where: { staffId: req.params.staffId, year },
      orderBy: { leaveType: "asc" },
    });

    res.json(balances);
  }
);

// PUT /hr/leave-balance/:staffId — set leave allocation for a staff member
hrRouter.put(
  "/hr/leave-balance/:staffId",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("staffId").notEmpty(), body("leaveType").isString().notEmpty(), body("totalDays").isInt({ min: 0 }), body("year").isInt({ min: 2000 })],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const staffMember = await prisma.staff.findUnique({
      where: { id: req.params.staffId },
      select: { id: true, collegeId: true },
    });
    if (!staffMember) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }
    if (!canAccessCollege(req, staffMember.collegeId)) {
      res.status(403).json({ message: "Cannot update another college's data" });
      return;
    }

    const balance = await prisma.leaveBalance.upsert({
      where: {
        staffId_leaveType_year: {
          staffId: req.params.staffId,
          leaveType: req.body.leaveType,
          year: Number(req.body.year),
        },
      },
      update: { totalDays: Number(req.body.totalDays) },
      create: {
        staffId: req.params.staffId,
        leaveType: req.body.leaveType,
        year: Number(req.body.year),
        totalDays: Number(req.body.totalDays),
        usedDays: 0,
      },
    });

    res.json(balance);
  }
);

// POST /hr/staff/:staffId/documents — upload a document for a staff member
hrRouter.post(
  "/hr/staff/:staffId/documents",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("staffId").notEmpty()],
  handleValidation,
  staffDocUpload.single("file"),
  async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    const staffMember = await prisma.staff.findUnique({
      where: { id: req.params.staffId },
      select: { id: true, collegeId: true },
    });

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

    const doc = await prisma.document.create({
      data: {
        entityType: "STAFF",
        entityId: staffMember.id,
        collegeId: staffMember.collegeId,
        fileName: req.file.originalname,
        storagePath: req.file.path,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedBy: req.user?.id,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "DOCUMENT_UPLOADED",
      entityType: "STAFF",
      entityId: staffMember.id,
      metadata: { documentId: doc.id, fileName: doc.fileName },
    });

    res.status(201).json(doc);
  }
);

// GET /hr/staff/:staffId/documents — list documents for a staff member
hrRouter.get(
  "/hr/staff/:staffId/documents",
  authenticate,
  requirePermission("HR_READ"),
  [param("staffId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const staffMember = await prisma.staff.findUnique({
      where: { id: req.params.staffId },
      select: { id: true, collegeId: true },
    });

    if (!staffMember) {
      res.status(404).json({ message: "Staff member not found" });
      return;
    }

    if (!canAccessCollege(req, staffMember.collegeId)) {
      res.status(403).json({ message: "Cannot access another college's staff documents" });
      return;
    }

    const docs = await prisma.document.findMany({
      where: { entityType: "STAFF", entityId: staffMember.id },
      orderBy: { createdAt: "desc" },
    });

    res.json(docs);
  }
);

// ---------------------------------------------------------------------------
// TASK-HR-03: Staff onboarding drafts (auto-save/resume)
// ---------------------------------------------------------------------------

hrRouter.get(
  "/hr/onboarding-drafts",
  authenticate,
  requirePermission("HR_WRITE"),
  async (req: AuthenticatedRequest, res) => {
    const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
    if (scopedCollegeId === "__FORBIDDEN__") {
      res.status(403).json({ message: "Cannot access another college's drafts" });
      return;
    }

    const drafts = await prisma.staffOnboardingDraft.findMany({
      where: {
        createdByUserId: req.user!.id,
        ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json(drafts);
  }
);

hrRouter.post(
  "/hr/onboarding-drafts",
  authenticate,
  requirePermission("HR_WRITE"),
  [body("collegeId").notEmpty(), body("formDataJson").notEmpty(), body("step").optional().isInt({ min: 1 })],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) {
      res.status(403).json({ message: "Cannot create draft for another college" });
      return;
    }

    const draft = await prisma.staffOnboardingDraft.create({
      data: {
        createdByUserId: req.user!.id,
        collegeId: req.body.collegeId,
        formDataJson: req.body.formDataJson,
        step: Number(req.body.step ?? 1),
      },
    });

    res.status(201).json(draft);
  }
);

hrRouter.patch(
  "/hr/onboarding-drafts/:draftId",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("draftId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.staffOnboardingDraft.findUnique({
      where: { id: req.params.draftId },
    });

    if (!existing) {
      res.status(404).json({ message: "Draft not found" });
      return;
    }

    if (existing.createdByUserId !== req.user?.id) {
      res.status(403).json({ message: "Cannot edit another user's draft" });
      return;
    }

    const updated = await prisma.staffOnboardingDraft.update({
      where: { id: req.params.draftId },
      data: {
        ...(req.body.formDataJson !== undefined ? { formDataJson: req.body.formDataJson } : {}),
        ...(req.body.step !== undefined ? { step: Number(req.body.step) } : {}),
      },
    });

    res.json(updated);
  }
);

hrRouter.delete(
  "/hr/onboarding-drafts/:draftId",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("draftId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.staffOnboardingDraft.findUnique({
      where: { id: req.params.draftId },
    });

    if (!existing) {
      res.status(404).json({ message: "Draft not found" });
      return;
    }

    if (existing.createdByUserId !== req.user?.id && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ message: "Cannot delete another user's draft" });
      return;
    }

    await prisma.staffOnboardingDraft.delete({ where: { id: req.params.draftId } });

    res.json({ message: "Draft deleted" });
  }
);
