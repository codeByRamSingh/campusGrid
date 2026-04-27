import { Router } from "express";
import { body } from "express-validator";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { normalizePermissions } from "../lib/permissions.js";
import { authenticate, getScopedCollegeId, requirePermission, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";

export const adminRouter = Router();

adminRouter.use(authenticate);

adminRouter.get("/admin/colleges", requirePermission("ACADEMIC_READ"), async (req, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college" });
    return;
  }

  const colleges = await prisma.college.findMany({
    where: scopedCollegeId ? { id: scopedCollegeId } : {},
    include: { courses: true },
  });
  res.json(colleges);
});

adminRouter.get("/admin/academic-structure", requirePermission("ACADEMIC_READ"), async (req, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college" });
    return;
  }

  const colleges = await prisma.college.findMany({
    where: scopedCollegeId ? { id: scopedCollegeId } : {},
    include: {
      courses: {
        include: {
          sessions: true,
          subjects: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  res.json(colleges);
});

adminRouter.get("/admin/courses/:courseId/sessions", requirePermission("ACADEMIC_READ"), async (req: AuthenticatedRequest, res) => {
  const course = await prisma.course.findUnique({
    where: { id: req.params.courseId },
    select: { collegeId: true },
  });
  if (!course) {
    res.status(404).json({ message: "Course not found" });
    return;
  }
  if (!req.user || (req.user.role !== "SUPER_ADMIN" && req.user.collegeId !== course.collegeId)) {
    res.status(403).json({ message: "Cannot access another college" });
    return;
  }

  const sessions = await prisma.session.findMany({
    where: { courseId: req.params.courseId },
    orderBy: { startYear: "asc" },
  });

  res.json(sessions);
});

adminRouter.get("/admin/users", requireRole("SUPER_ADMIN"), async (_req, res) => {
  const users = await prisma.user.findMany({
    include: {
      staff: {
        select: {
          id: true,
          fullName: true,
          collegeId: true,
          role: true,
          isActive: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      staff: user.staff,
    }))
  );
});

adminRouter.get("/admin/custom-roles", requirePermission("SETTINGS_COLLEGE", "HR_WRITE"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college" });
    return;
  }

  const roles = await prisma.customRole.findMany({
    where: scopedCollegeId ? { collegeId: scopedCollegeId } : {},
    include: { _count: { select: { staff: true } } },
    orderBy: [{ collegeId: "asc" }, { name: "asc" }],
  });

  res.json(roles.map((role) => ({ ...role, permissions: normalizePermissions(role.permissions) })));
});

adminRouter.post(
  "/admin/custom-roles",
  requirePermission("SETTINGS_COLLEGE"),
  [body("collegeId").notEmpty(), body("name").notEmpty(), body("permissions").isArray({ min: 0 })],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const scopedCollegeId = getScopedCollegeId(req, req.body.collegeId as string);
    if (scopedCollegeId === "__FORBIDDEN__") {
      res.status(403).json({ message: "Cannot create roles for another college" });
      return;
    }

    const permissions = normalizePermissions(req.body.permissions);
    const created = await prisma.customRole.create({
      data: {
        collegeId: scopedCollegeId ?? req.body.collegeId,
        name: String(req.body.name).trim(),
        permissions,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "CUSTOM_ROLE_CREATED",
      entityType: "CUSTOM_ROLE",
      entityId: created.id,
      metadata: { collegeId: created.collegeId, permissions },
    });

    res.status(201).json({ ...created, permissions });
  }
);

adminRouter.patch(
  "/admin/custom-roles/:roleId",
  requirePermission("SETTINGS_COLLEGE"),
  [body("name").optional().notEmpty(), body("permissions").optional().isArray({ min: 0 })],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.customRole.findUnique({ where: { id: req.params.roleId }, select: { id: true, collegeId: true } });
    if (!existing) {
      res.status(404).json({ message: "Custom role not found" });
      return;
    }

    const scopedCollegeId = getScopedCollegeId(req, existing.collegeId);
    if (scopedCollegeId === "__FORBIDDEN__") {
      res.status(403).json({ message: "Cannot update another college's custom role" });
      return;
    }

    const permissions = req.body.permissions !== undefined ? normalizePermissions(req.body.permissions) : undefined;
    const updated = await prisma.customRole.update({
      where: { id: req.params.roleId },
      data: {
        ...(req.body.name !== undefined ? { name: String(req.body.name).trim() } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "CUSTOM_ROLE_UPDATED",
      entityType: "CUSTOM_ROLE",
      entityId: updated.id,
      metadata: { collegeId: updated.collegeId, permissions: permissions ?? normalizePermissions(updated.permissions) },
    });

    res.json({ ...updated, permissions: normalizePermissions(updated.permissions) });
  }
);

adminRouter.delete("/admin/custom-roles/:roleId", requirePermission("SETTINGS_COLLEGE"), async (req: AuthenticatedRequest, res) => {
  const existing = await prisma.customRole.findUnique({ where: { id: req.params.roleId }, include: { _count: { select: { staff: true } } } });
  if (!existing) {
    res.status(404).json({ message: "Custom role not found" });
    return;
  }

  const scopedCollegeId = getScopedCollegeId(req, existing.collegeId);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot delete another college's custom role" });
    return;
  }

  if (existing._count.staff > 0) {
    res.status(409).json({ message: "Cannot delete a custom role that is assigned to staff members" });
    return;
  }

  await prisma.customRole.delete({ where: { id: req.params.roleId } });
  await writeAuditLog(prisma, {
    actorUserId: req.user?.id,
    action: "CUSTOM_ROLE_DELETED",
    entityType: "CUSTOM_ROLE",
    entityId: existing.id,
    metadata: { collegeId: existing.collegeId, name: existing.name },
  });

  res.json({ message: "Custom role deleted successfully" });
});

adminRouter.post(
  "/admin/colleges",
  requireRole("SUPER_ADMIN"),
  [body("name").notEmpty(), body("code").notEmpty(), body("university").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const trust = await prisma.trust.findFirst();
    if (!trust) {
      res.status(400).json({ message: "Trust not initialized" });
      return;
    }

    const college = await prisma.college.create({
      data: {
        trustId: trust.id,
        name: req.body.name,
        code: req.body.code,
        registrationYear: Number(req.body.registrationYear ?? new Date().getFullYear()),
        address: req.body.address ?? "Not specified",
        university: req.body.university,
        startingRollNumber: Number(req.body.startingRollNumber ?? 1),
        startingAdmissionNumber: Number(req.body.startingAdmissionNumber ?? 1),
        admissionNumberPrefix: String(req.body.admissionNumberPrefix ?? `MTET/AD${new Date().getFullYear()}`),
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "COLLEGE_CREATED",
      entityType: "COLLEGE",
      entityId: college.id,
      metadata: { code: college.code, university: college.university },
    });

    res.status(201).json(college);
  }
);

adminRouter.put(
  "/admin/colleges/:collegeId",
  requireRole("SUPER_ADMIN"),
  [
    body("name").notEmpty(),
    body("code").notEmpty(),
    body("registrationYear").isInt(),
    body("address").notEmpty(),
    body("university").notEmpty(),
    body("startingRollNumber").isInt(),
    body("startingAdmissionNumber").isInt(),
    body("admissionNumberPrefix").notEmpty(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const updatedCollege = await prisma.college.update({
      where: { id: req.params.collegeId },
      data: {
        name: req.body.name,
        code: req.body.code,
        registrationYear: Number(req.body.registrationYear),
        address: req.body.address,
        university: req.body.university,
        startingRollNumber: Number(req.body.startingRollNumber),
        startingAdmissionNumber: Number(req.body.startingAdmissionNumber),
        admissionNumberPrefix: req.body.admissionNumberPrefix,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "COLLEGE_UPDATED",
      entityType: "COLLEGE",
      entityId: updatedCollege.id,
      metadata: { code: updatedCollege.code, university: updatedCollege.university },
    });

    res.json(updatedCollege);
  }
);

adminRouter.delete("/admin/colleges/:collegeId", requireRole("SUPER_ADMIN"), async (req: AuthenticatedRequest, res) => {
  const collegeId = req.params.collegeId;

  const [coursesCount, studentsCount, staffCount, admissionsCount, paymentsCount, creditsCount, expensesCount] = await Promise.all([
    prisma.course.count({ where: { collegeId } }),
    prisma.student.count({ where: { collegeId } }),
    prisma.staff.count({ where: { collegeId } }),
    prisma.admission.count({ where: { collegeId } }),
    prisma.payment.count({ where: { collegeId } }),
    prisma.credit.count({ where: { collegeId } }),
    prisma.expense.count({ where: { collegeId } }),
  ]);

  const hasDependencies =
    coursesCount > 0 ||
    studentsCount > 0 ||
    staffCount > 0 ||
    admissionsCount > 0 ||
    paymentsCount > 0 ||
    creditsCount > 0 ||
    expensesCount > 0;

  if (hasDependencies) {
    res.status(400).json({
      message:
        "Cannot delete college with linked data. Remove linked courses/students/staff/finance/admissions first.",
      dependencies: {
        courses: coursesCount,
        students: studentsCount,
        staff: staffCount,
        admissions: admissionsCount,
        payments: paymentsCount,
        credits: creditsCount,
        expenses: expensesCount,
      },
    });
    return;
  }

  await prisma.college.delete({ where: { id: collegeId } });
  await writeAuditLog(prisma, {
    actorUserId: req.user?.id,
    action: "COLLEGE_DELETED",
    entityType: "COLLEGE",
    entityId: collegeId,
  });
  res.json({ message: "College deleted successfully" });
});

adminRouter.post(
  "/admin/courses",
  requireRole("SUPER_ADMIN"),
  [body("collegeId").notEmpty(), body("name").notEmpty(), body("courseCode").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const course = await prisma.course.create({
      data: {
        collegeId: req.body.collegeId,
        name: req.body.name,
        courseCode: req.body.courseCode,
        courseFee: req.body.courseFee ?? 0,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "COURSE_CREATED",
      entityType: "COURSE",
      entityId: course.id,
      metadata: { collegeId: course.collegeId, courseCode: course.courseCode },
    });

    res.status(201).json(course);
  }
);

adminRouter.put(
  "/admin/courses/:courseId",
  requireRole("SUPER_ADMIN"),
  [body("name").notEmpty(), body("courseCode").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const updatedCourse = await prisma.course.update({
      where: { id: req.params.courseId },
      data: {
        name: req.body.name,
        courseCode: req.body.courseCode,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "COURSE_UPDATED",
      entityType: "COURSE",
      entityId: updatedCourse.id,
      metadata: { collegeId: updatedCourse.collegeId, courseCode: updatedCourse.courseCode },
    });

    res.json(updatedCourse);
  }
);

adminRouter.delete("/admin/courses/:courseId", requireRole("SUPER_ADMIN"), async (req: AuthenticatedRequest, res) => {
  const courseId = req.params.courseId;

  const [sessionsCount, subjectsCount, admissionsCount] = await Promise.all([
    prisma.session.count({ where: { courseId } }),
    prisma.subject.count({ where: { courseId } }),
    prisma.admission.count({ where: { courseId } }),
  ]);

  const hasDependencies = sessionsCount > 0 || subjectsCount > 0 || admissionsCount > 0;
  if (hasDependencies) {
    res.status(400).json({
      message: "Cannot delete course with linked sessions/subjects/admissions. Remove linked data first.",
      dependencies: {
        sessions: sessionsCount,
        subjects: subjectsCount,
        admissions: admissionsCount,
      },
    });
    return;
  }

  await prisma.course.delete({ where: { id: courseId } });
  await writeAuditLog(prisma, {
    actorUserId: req.user?.id,
    action: "COURSE_DELETED",
    entityType: "COURSE",
    entityId: courseId,
  });
  res.json({ message: "Course deleted successfully" });
});

adminRouter.post(
  "/admin/sessions",
  requireRole("SUPER_ADMIN"),
  [body("courseId").notEmpty(), body("label").notEmpty(), body("startYear").isInt(), body("endYear").isInt(), body("startingRollNumber").isInt({ min: 1 }), body("rollNumberPrefix").notEmpty(), body("seatCount").isInt({ min: 0 }), body("sessionFee").isNumeric()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const session = await prisma.session.create({
      data: {
        courseId: req.body.courseId,
        label: req.body.label,
        startYear: Number(req.body.startYear),
        endYear: Number(req.body.endYear),
        startingRollNumber: Number(req.body.startingRollNumber),
        rollNumberPrefix: String(req.body.rollNumberPrefix ?? `MTET/R${req.body.startYear}`),
        seatCount: Number(req.body.seatCount),
        sessionFee: req.body.sessionFee,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "SESSION_CREATED",
      entityType: "SESSION",
      entityId: session.id,
      metadata: { courseId: session.courseId, label: session.label },
    });

    res.status(201).json(session);
  }
);

adminRouter.put(
  "/admin/sessions/:sessionId",
  requireRole("SUPER_ADMIN"),
  [body("label").notEmpty(), body("startYear").isInt(), body("endYear").isInt(), body("startingRollNumber").isInt({ min: 1 }), body("rollNumberPrefix").notEmpty(), body("seatCount").isInt({ min: 0 }), body("sessionFee").isNumeric()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const updatedSession = await prisma.session.update({
      where: { id: req.params.sessionId },
      data: {
        label: req.body.label,
        startYear: Number(req.body.startYear),
        endYear: Number(req.body.endYear),
        startingRollNumber: Number(req.body.startingRollNumber),
        rollNumberPrefix: req.body.rollNumberPrefix,
        seatCount: Number(req.body.seatCount),
        sessionFee: req.body.sessionFee,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "SESSION_UPDATED",
      entityType: "SESSION",
      entityId: updatedSession.id,
      metadata: { courseId: updatedSession.courseId, label: updatedSession.label },
    });

    res.json(updatedSession);
  }
);

adminRouter.delete("/admin/sessions/:sessionId", requireRole("SUPER_ADMIN"), async (req: AuthenticatedRequest, res) => {
  const sessionId = req.params.sessionId;
  const admissionsCount = await prisma.admission.count({ where: { sessionId } });

  if (admissionsCount > 0) {
    res.status(400).json({
      message: "Cannot delete session with linked admissions.",
      dependencies: { admissions: admissionsCount },
    });
    return;
  }

  await prisma.session.delete({ where: { id: sessionId } });
  await writeAuditLog(prisma, {
    actorUserId: req.user?.id,
    action: "SESSION_DELETED",
    entityType: "SESSION",
    entityId: sessionId,
  });
  res.json({ message: "Session deleted successfully" });
});

adminRouter.post(
  "/admin/subjects",
  requireRole("SUPER_ADMIN"),
  [body("courseId").notEmpty(), body("name").notEmpty(), body("code").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const subject = await prisma.subject.create({
      data: {
        courseId: req.body.courseId,
        name: req.body.name,
        code: req.body.code,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "SUBJECT_CREATED",
      entityType: "SUBJECT",
      entityId: subject.id,
      metadata: { courseId: subject.courseId, code: subject.code },
    });

    res.status(201).json(subject);
  }
);

adminRouter.put(
  "/admin/subjects/:subjectId",
  requireRole("SUPER_ADMIN"),
  [body("name").notEmpty(), body("code").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const updatedSubject = await prisma.subject.update({
      where: { id: req.params.subjectId },
      data: {
        name: req.body.name,
        code: req.body.code,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "SUBJECT_UPDATED",
      entityType: "SUBJECT",
      entityId: updatedSubject.id,
      metadata: { courseId: updatedSubject.courseId, code: updatedSubject.code },
    });

    res.json(updatedSubject);
  }
);

adminRouter.delete("/admin/subjects/:subjectId", requireRole("SUPER_ADMIN"), async (req: AuthenticatedRequest, res) => {
  await prisma.subject.delete({ where: { id: req.params.subjectId } });
  await writeAuditLog(prisma, {
    actorUserId: req.user?.id,
    action: "SUBJECT_DELETED",
    entityType: "SUBJECT",
    entityId: req.params.subjectId,
  });
  res.json({ message: "Subject deleted successfully" });
});

adminRouter.post(
  "/admin/users/assign-role",
  requireRole("SUPER_ADMIN"),
  [body("email").isEmail(), body("role").isIn(["SUPER_ADMIN", "STAFF"])],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const updated = await prisma.user.update({
      where: { email: req.body.email },
      data: { role: req.body.role },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "USER_ROLE_ASSIGNED",
      entityType: "USER",
      entityId: updated.id,
      metadata: { email: updated.email, role: updated.role },
    });

    res.json({ id: updated.id, email: updated.email, role: updated.role });
  }
);
