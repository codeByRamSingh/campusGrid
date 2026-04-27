import { Router } from "express";
import { body, param } from "express-validator";
import { prisma } from "../lib/prisma.js";
import { authenticate, getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";

export const examRouter = Router();

// ─── Exam Schedules ───────────────────────────────────────────────────────────

examRouter.get("/exam/schedules", authenticate, requirePermission("EXAM_READ"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const scopedCollegeId = getScopedCollegeId(req);
    const { courseId, sessionId } = req.query as Record<string, string | undefined>;

    const schedules = await prisma.examSchedule.findMany({
      where: {
        ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
        ...(courseId ? { courseId } : {}),
        ...(sessionId ? { sessionId } : {}),
      },
      include: { results: { select: { id: true, studentId: true, marksObtained: true, isPassed: true, grade: true, isAbsent: true } } },
      orderBy: { examDate: "asc" },
    });
    res.json(schedules);
  } catch (err) {
    next(err);
  }
});

examRouter.post(
  "/exam/schedules",
  authenticate,
  requirePermission("EXAM_WRITE"),
  [
    body("collegeId").notEmpty(),
    body("courseId").notEmpty(),
    body("sessionId").notEmpty(),
    body("title").notEmpty(),
    body("examDate").isISO8601(),
    body("maxMarks").optional().isNumeric(),
    body("passingMarks").optional().isNumeric(),
    body("examType").optional().isIn(["INTERNAL", "EXTERNAL", "PRACTICAL", "VIVA"]),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const schedule = await prisma.examSchedule.create({
        data: {
          collegeId: req.body.collegeId as string,
          courseId: req.body.courseId as string,
          sessionId: req.body.sessionId as string,
          subjectId: req.body.subjectId as string | undefined,
          title: req.body.title as string,
          examType: req.body.examType ?? "INTERNAL",
          examDate: new Date(req.body.examDate as string),
          startTime: req.body.startTime as string | undefined,
          endTime: req.body.endTime as string | undefined,
          venue: req.body.venue as string | undefined,
          maxMarks: req.body.maxMarks ?? 100,
          passingMarks: req.body.passingMarks ?? 40,
          notes: req.body.notes as string | undefined,
        },
      });
      res.status(201).json(schedule);
    } catch (err) {
      next(err);
    }
  }
);

examRouter.patch(
  "/exam/schedules/:id",
  authenticate,
  requirePermission("EXAM_WRITE"),
  [param("id").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { title, examType, examDate, startTime, endTime, venue, maxMarks, passingMarks, notes } = req.body as Record<string, unknown>;
      const schedule = await prisma.examSchedule.update({
        where: { id: req.params.id },
        data: {
          ...(title !== undefined ? { title: title as string } : {}),
          ...(examType !== undefined ? { examType: examType as "INTERNAL" | "EXTERNAL" | "PRACTICAL" | "VIVA" } : {}),
          ...(examDate !== undefined ? { examDate: new Date(examDate as string) } : {}),
          ...(startTime !== undefined ? { startTime: startTime as string } : {}),
          ...(endTime !== undefined ? { endTime: endTime as string } : {}),
          ...(venue !== undefined ? { venue: venue as string } : {}),
          ...(maxMarks !== undefined ? { maxMarks: maxMarks as number } : {}),
          ...(passingMarks !== undefined ? { passingMarks: passingMarks as number } : {}),
          ...(notes !== undefined ? { notes: notes as string } : {}),
        },
      });
      res.json(schedule);
    } catch (err) {
      next(err);
    }
  }
);

examRouter.delete("/exam/schedules/:id", authenticate, requirePermission("EXAM_WRITE"), async (req: AuthenticatedRequest, res, next) => {
  try {
    await prisma.examSchedule.delete({ where: { id: req.params.id } });
    res.json({ message: "Deleted" });
  } catch (err) {
    next(err);
  }
});

// ─── Exam Results ─────────────────────────────────────────────────────────────

examRouter.get("/exam/schedules/:id/results", authenticate, requirePermission("EXAM_READ"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const results = await prisma.examResult.findMany({
      where: { scheduleId: req.params.id },
      include: { student: { select: { id: true, candidateName: true, admissionNumber: true, rollNumber: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json(results);
  } catch (err) {
    next(err);
  }
});

examRouter.put(
  "/exam/schedules/:id/results",
  authenticate,
  requirePermission("EXAM_WRITE"),
  [param("id").notEmpty(), body("results").isArray()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scheduleId = req.params.id;
      const schedule = await prisma.examSchedule.findUnique({ where: { id: scheduleId } });
      if (!schedule) {
        res.status(404).json({ message: "Exam schedule not found" });
        return;
      }

      type ResultInput = { studentId: string; marksObtained?: number; isAbsent?: boolean; remarks?: string };
      const results = req.body.results as ResultInput[];

      const upserts = results.map((r) => {
        const marksObtained = r.isAbsent ? null : (r.marksObtained ?? null);
        const isPassed = marksObtained !== null ? marksObtained >= Number(schedule.passingMarks) : null;
        const grade =
          marksObtained === null ? null
          : marksObtained >= 90 ? "O"
          : marksObtained >= 75 ? "A+"
          : marksObtained >= 60 ? "A"
          : marksObtained >= 50 ? "B"
          : marksObtained >= 40 ? "C"
          : "F";

        return prisma.examResult.upsert({
          where: { scheduleId_studentId: { scheduleId, studentId: r.studentId } },
          create: { scheduleId, studentId: r.studentId, collegeId: schedule.collegeId, marksObtained, isPassed, grade, isAbsent: r.isAbsent ?? false, remarks: r.remarks },
          update: { marksObtained, isPassed, grade, isAbsent: r.isAbsent ?? false, remarks: r.remarks },
        });
      });

      await prisma.$transaction(upserts);
      res.json({ updated: results.length });
    } catch (err) {
      next(err);
    }
  }
);

examRouter.get("/exam/results/student/:studentId", authenticate, requirePermission("EXAM_READ"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const results = await prisma.examResult.findMany({
      where: { studentId: req.params.studentId },
      include: { schedule: { select: { title: true, examType: true, examDate: true, maxMarks: true, passingMarks: true, courseId: true, sessionId: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(results);
  } catch (err) {
    next(err);
  }
});
