import { Router } from "express";
import { body, param } from "express-validator";
import * as AdminService from "../../services/admin.service.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { requirePermission, requireRole, type AuthenticatedRequest } from "../../middleware/auth.js";
import { handleValidation } from "../../middleware/validate.js";

export const courseRouter = Router();

// ─── Courses ──────────────────────────────────────────────────────────────────

courseRouter.post(
  "/courses",
  requireRole("SUPER_ADMIN"),
  [body("collegeId").notEmpty(), body("name").notEmpty(), body("courseCode").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const course = await AdminService.createCourse(req.body as AdminService.CreateCourseInput, req.user?.id);
      res.status(201).json(course);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

courseRouter.put(
  "/courses/:courseId",
  requireRole("SUPER_ADMIN"),
  [body("name").notEmpty(), body("courseCode").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const updated = await AdminService.updateCourse(req.params.courseId, req.body, req.user?.id);
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

courseRouter.delete(
  "/courses/:courseId",
  requireRole("SUPER_ADMIN"),
  async (req: AuthenticatedRequest, res) => {
    const courseId = req.params.courseId;
    const [sessionsCount, subjectsCount, admissionsCount] = await Promise.all([
      prisma.session.count({ where: { courseId } }),
      prisma.subject.count({ where: { courseId } }),
      prisma.admission.count({ where: { courseId } }),
    ]);
    if (sessionsCount > 0 || subjectsCount > 0 || admissionsCount > 0) {
      res.status(400).json({
        message: "Cannot delete course with linked sessions/subjects/admissions. Remove linked data first.",
        dependencies: { sessions: sessionsCount, subjects: subjectsCount, admissions: admissionsCount },
      });
      return;
    }
    await prisma.course.delete({ where: { id: courseId } });
    await writeAuditLog(prisma, { actorUserId: req.user?.id, action: "COURSE_DELETED", entityType: "COURSE", entityId: courseId });
    res.json({ message: "Course deleted successfully" });
  },
);

courseRouter.get(
  "/courses/:courseId/sessions",
  requirePermission("ACADEMIC_READ"),
  async (req: AuthenticatedRequest, res) => {
    const course = await prisma.course.findUnique({ where: { id: req.params.courseId }, select: { collegeId: true } });
    if (!course) { res.status(404).json({ message: "Course not found" }); return; }
    if (!req.user || (req.user.role !== "SUPER_ADMIN" && req.user.collegeId !== course.collegeId)) {
      res.status(403).json({ message: "Cannot access another college" });
      return;
    }
    const sessions = await AdminService.listCourseSessions(req.params.courseId);
    res.json(sessions);
  },
);

// ─── Sessions ─────────────────────────────────────────────────────────────────

courseRouter.post(
  "/sessions",
  requireRole("SUPER_ADMIN"),
  [
    body("courseId").notEmpty(),
    body("label").notEmpty(),
    body("startYear").isInt(),
    body("endYear").isInt(),
    body("startingRollNumber").isInt({ min: 1 }),
    body("rollNumberPrefix").notEmpty(),
    body("seatCount").isInt({ min: 0 }),
    body("sessionFee").isNumeric(),
  ],
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
  },
);

courseRouter.put(
  "/sessions/:sessionId",
  requireRole("SUPER_ADMIN"),
  [
    body("label").notEmpty(),
    body("startYear").isInt(),
    body("endYear").isInt(),
    body("startingRollNumber").isInt({ min: 1 }),
    body("rollNumberPrefix").notEmpty(),
    body("seatCount").isInt({ min: 0 }),
    body("sessionFee").isNumeric(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const updated = await prisma.session.update({
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
      entityId: updated.id,
      metadata: { courseId: updated.courseId, label: updated.label },
    });
    res.json(updated);
  },
);

courseRouter.delete("/sessions/:sessionId", requireRole("SUPER_ADMIN"), async (req: AuthenticatedRequest, res) => {
  const admissionsCount = await prisma.admission.count({ where: { sessionId: req.params.sessionId } });
  if (admissionsCount > 0) {
    res.status(400).json({ message: "Cannot delete session with linked admissions.", dependencies: { admissions: admissionsCount } });
    return;
  }
  await prisma.session.delete({ where: { id: req.params.sessionId } });
  await writeAuditLog(prisma, { actorUserId: req.user?.id, action: "SESSION_DELETED", entityType: "SESSION", entityId: req.params.sessionId });
  res.json({ message: "Session deleted successfully" });
});

// ─── Subjects ─────────────────────────────────────────────────────────────────

courseRouter.post(
  "/subjects",
  requireRole("SUPER_ADMIN"),
  [body("courseId").notEmpty(), body("name").notEmpty(), body("code").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const subject = await prisma.subject.create({
      data: { courseId: req.body.courseId, name: req.body.name, code: req.body.code },
    });
    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "SUBJECT_CREATED",
      entityType: "SUBJECT",
      entityId: subject.id,
      metadata: { courseId: subject.courseId, code: subject.code },
    });
    res.status(201).json(subject);
  },
);

courseRouter.put(
  "/subjects/:subjectId",
  requireRole("SUPER_ADMIN"),
  [body("name").notEmpty(), body("code").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const updated = await prisma.subject.update({
      where: { id: req.params.subjectId },
      data: { name: req.body.name, code: req.body.code },
    });
    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "SUBJECT_UPDATED",
      entityType: "SUBJECT",
      entityId: updated.id,
      metadata: { courseId: updated.courseId, code: updated.code },
    });
    res.json(updated);
  },
);

courseRouter.delete("/subjects/:subjectId", requireRole("SUPER_ADMIN"), async (req: AuthenticatedRequest, res) => {
  await prisma.subject.delete({ where: { id: req.params.subjectId } });
  await writeAuditLog(prisma, { actorUserId: req.user?.id, action: "SUBJECT_DELETED", entityType: "SUBJECT", entityId: req.params.subjectId });
  res.json({ message: "Subject deleted successfully" });
});
