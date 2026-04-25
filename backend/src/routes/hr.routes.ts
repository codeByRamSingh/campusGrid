import { Router } from "express";
import { body, param } from "express-validator";
import { ExceptionModule, ExceptionSeverity } from "@prisma/client";
import { createExceptionCase } from "../lib/exceptions.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/auth.js";
import { buildInviteLink, generateOpaqueToken, hashOpaqueToken } from "../lib/security.js";
import { authenticate, canAccessCollege, getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";
import { writeAuditLog } from "../lib/audit.js";

export const hrRouter = Router();

hrRouter.post(
  "/hr/staff",
  authenticate,
  requirePermission("HR_WRITE"),
  [
    body("collegeId").notEmpty(),
    body("fullName").notEmpty(),
    body("email").isEmail(),
    body("mobile").notEmpty(),
    body("role").optional().isIn(["COLLEGE_ADMIN", "ADMISSIONS_OPERATOR", "CASHIER", "HR_OPERATOR", "ATTENDANCE_OPERATOR", "AUDITOR"]),
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

    const result = await prisma.$transaction(async (tx) => {
      const staff = await tx.staff.create({
        data: {
          collegeId: req.body.collegeId,
          fullName: req.body.fullName,
          email: normalizedEmail,
          mobile: req.body.mobile,
          role: req.body.role ?? "ATTENDANCE_OPERATOR",
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

    res.status(201).json({
      ...result,
      invite: {
        expiresAt: expiresAt.toISOString(),
        inviteLink: buildInviteLink(rawSetupToken),
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
    orderBy: { createdAt: "desc" },
  });
  res.json(staff);
});

hrRouter.get("/hr/attendance", authenticate, requirePermission("HR_READ", "HR_ATTENDANCE"), async (req: AuthenticatedRequest, res) => {
  const staffId = req.query.staffId as string | undefined;
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
    take: 200,
  });

  res.json(attendance);
});

hrRouter.get("/hr/leave-requests", authenticate, requirePermission("HR_READ"), async (req: AuthenticatedRequest, res) => {
  const staffId = req.query.staffId as string | undefined;
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
    take: 200,
  });

  res.json(leaveRequests);
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
      select: { id: true },
    });

    const payroll = existingPayroll
      ? await prisma.payroll.update({
          where: { id: existingPayroll.id },
          data: {
            amount: Number(req.body.amount),
            paidAt: new Date(),
          },
        })
      : await prisma.payroll.create({
          data: {
            staffId: req.body.staffId,
            amount: Number(req.body.amount),
            month: Number(req.body.month),
            year: Number(req.body.year),
          },
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

hrRouter.get("/hr/payroll", authenticate, requirePermission("HR_READ"), async (req: AuthenticatedRequest, res) => {
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
    body("role").optional().isIn(["COLLEGE_ADMIN", "ADMISSIONS_OPERATOR", "CASHIER", "HR_OPERATOR", "ATTENDANCE_OPERATOR", "AUDITOR"]),
    body("collegeId").optional().isString(),
    body("isActive").optional().isBoolean(),
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
          ...(typeof req.body.isActive === "boolean" ? { isActive: req.body.isActive } : {}),
          ...(req.body.collegeId ? { collegeId: req.body.collegeId } : {}),
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
