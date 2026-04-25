import { ExceptionModule, ExceptionSeverity, ExceptionStatus } from "@prisma/client";
import { Router } from "express";
import { body, param, query } from "express-validator";
import { createExceptionCase, runExceptionAutomation, transitionExceptionCase } from "../lib/exceptions.js";
import { prisma } from "../lib/prisma.js";
import { authenticate, canAccessCollege, getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";

export const exceptionsRouter = Router();

exceptionsRouter.use(authenticate);

exceptionsRouter.post(
  "/exceptions",
  requirePermission("EXCEPTIONS_WRITE"),
  [
    body("collegeId").notEmpty(),
    body("module").isIn(Object.values(ExceptionModule)),
    body("category").notEmpty(),
    body("title").notEmpty(),
    body("description").notEmpty(),
    body("severity").optional().isIn(Object.values(ExceptionSeverity)),
    body("sourceEntityType").optional().isString(),
    body("sourceEntityId").optional().isString(),
    body("sourceOperation").optional().isString(),
    body("dedupeKey").optional().isString(),
    body("idempotencyKey").optional().isString(),
    body("isRetryable").optional().isBoolean(),
    body("maxRetries").optional().isInt({ min: 0, max: 10 }),
    body("metadata").optional().isObject(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) {
      res.status(403).json({ message: "Cannot create exceptions for another college" });
      return;
    }

    const result = await createExceptionCase(prisma, {
      collegeId: req.body.collegeId,
      module: req.body.module,
      category: req.body.category,
      severity: req.body.severity,
      title: req.body.title,
      description: req.body.description,
      sourceEntityType: req.body.sourceEntityType,
      sourceEntityId: req.body.sourceEntityId,
      sourceOperation: req.body.sourceOperation,
      dedupeKey: req.body.dedupeKey,
      idempotencyKey: req.body.idempotencyKey,
      isRetryable: req.body.isRetryable,
      maxRetries: req.body.maxRetries,
      metadata: req.body.metadata,
      createdByUserId: req.user?.id,
    });

    res.status(result.created ? 201 : 200).json(result);
  }
);

exceptionsRouter.get(
  "/exceptions",
  requirePermission("EXCEPTIONS_READ"),
  [
    query("collegeId").optional().isString(),
    query("module").optional().isIn(Object.values(ExceptionModule)),
    query("status").optional().isIn(Object.values(ExceptionStatus)),
    query("severity").optional().isIn(Object.values(ExceptionSeverity)),
    query("assigneeStaffId").optional().isString(),
    query("q").optional().isString(),
    query("limit").optional().isInt({ min: 1, max: 200 }),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
    if (scopedCollegeId === "__FORBIDDEN__") {
      res.status(403).json({ message: "Cannot access another college's exceptions" });
      return;
    }

    const q = (req.query.q as string | undefined)?.trim();
    const where = {
      ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
      ...(req.query.module ? { module: req.query.module as ExceptionModule } : {}),
      ...(req.query.status ? { status: req.query.status as ExceptionStatus } : {}),
      ...(req.query.severity ? { severity: req.query.severity as ExceptionSeverity } : {}),
      ...(req.query.assigneeStaffId ? { assigneeStaffId: req.query.assigneeStaffId as string } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
              { category: { contains: q, mode: "insensitive" as const } },
              { sourceEntityId: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const limit = Number(req.query.limit || 100);
    const items = await prisma.exceptionCase.findMany({
      where,
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    res.json(items);
  }
);

exceptionsRouter.get(
  "/exceptions/metrics",
  requirePermission("EXCEPTIONS_READ"),
  [query("collegeId").optional().isString(), query("module").optional().isIn(Object.values(ExceptionModule))],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
    if (scopedCollegeId === "__FORBIDDEN__") {
      res.status(403).json({ message: "Cannot access another college's exception metrics" });
      return;
    }

    const where = {
      ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
      ...(req.query.module ? { module: req.query.module as ExceptionModule } : {}),
    };

    const [total, byStatusRaw, bySeverityRaw, resolved, reopened, resolvedRows, activeRows] = await Promise.all([
      prisma.exceptionCase.count({ where }),
      prisma.exceptionCase.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.exceptionCase.groupBy({ by: ["severity"], where, _count: { _all: true } }),
      prisma.exceptionCase.count({ where: { ...where, status: ExceptionStatus.RESOLVED } }),
      prisma.exceptionCase.count({ where: { ...where, status: ExceptionStatus.REOPENED } }),
      prisma.exceptionCase.findMany({
        where: { ...where, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
      }),
      prisma.exceptionCase.findMany({
        where: {
          ...where,
          status: { in: [ExceptionStatus.NEW, ExceptionStatus.TRIAGED, ExceptionStatus.ASSIGNED, ExceptionStatus.IN_PROGRESS, ExceptionStatus.REOPENED] },
        },
        select: { createdAt: true },
      }),
    ]);

    const byStatus = byStatusRaw.map((row) => ({ status: row.status, count: row._count._all }));
    const bySeverity = bySeverityRaw.map((row) => ({ severity: row.severity, count: row._count._all }));
    const mttrHours =
      resolvedRows.length > 0
        ? Number(
            (
              resolvedRows.reduce((sum, row) => sum + (row.resolvedAt!.getTime() - row.createdAt.getTime()) / 3600000, 0) / resolvedRows.length
            ).toFixed(2)
          )
        : 0;

    const bucketCount = { "0-4h": 0, "4-24h": 0, "24-72h": 0, "72h+": 0 };
    for (const row of activeRows) {
      const ageHours = (Date.now() - row.createdAt.getTime()) / 3600000;
      if (ageHours <= 4) bucketCount["0-4h"] += 1;
      else if (ageHours <= 24) bucketCount["4-24h"] += 1;
      else if (ageHours <= 72) bucketCount["24-72h"] += 1;
      else bucketCount["72h+"] += 1;
    }

    res.json({
      total,
      resolved,
      reopened,
      resolutionRate: total > 0 ? Number(((resolved / total) * 100).toFixed(2)) : 0,
      mttrHours,
      byStatus,
      bySeverity,
      aging: Object.entries(bucketCount).map(([bucket, count]) => ({ bucket, count })),
    });
  }
);

exceptionsRouter.get(
  "/exceptions/:exceptionCaseId",
  requirePermission("EXCEPTIONS_READ"),
  [param("exceptionCaseId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const item = await prisma.exceptionCase.findUnique({ where: { id: req.params.exceptionCaseId } });
    if (!item) {
      res.status(404).json({ message: "Exception not found" });
      return;
    }
    if (!canAccessCollege(req, item.collegeId)) {
      res.status(403).json({ message: "Cannot access another college's exception" });
      return;
    }

    res.json(item);
  }
);

exceptionsRouter.get(
  "/exceptions/:exceptionCaseId/history",
  requirePermission("EXCEPTIONS_READ"),
  [param("exceptionCaseId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const item = await prisma.exceptionCase.findUnique({
      where: { id: req.params.exceptionCaseId },
      select: { id: true, collegeId: true },
    });
    if (!item) {
      res.status(404).json({ message: "Exception not found" });
      return;
    }
    if (!canAccessCollege(req, item.collegeId)) {
      res.status(403).json({ message: "Cannot access another college's exception history" });
      return;
    }

    const history = await prisma.exceptionHistory.findMany({
      where: { exceptionCaseId: item.id },
      orderBy: { createdAt: "asc" },
    });

    res.json(history);
  }
);

exceptionsRouter.patch(
  "/exceptions/:exceptionCaseId/transition",
  requirePermission("EXCEPTIONS_RESOLVE", "EXCEPTIONS_WRITE"),
  [
    param("exceptionCaseId").notEmpty(),
    body("toStatus").isIn(Object.values(ExceptionStatus)),
    body("note").optional().isString(),
    body("metadata").optional().isObject(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.exceptionCase.findUnique({
      where: { id: req.params.exceptionCaseId },
      select: { id: true, collegeId: true },
    });
    if (!existing) {
      res.status(404).json({ message: "Exception not found" });
      return;
    }
    if (!canAccessCollege(req, existing.collegeId)) {
      res.status(403).json({ message: "Cannot transition another college's exception" });
      return;
    }

    try {
      const updated = await transitionExceptionCase(prisma, {
        exceptionCaseId: existing.id,
        toStatus: req.body.toStatus,
        actorUserId: req.user?.id,
        actorStaffId: req.user?.staffId,
        note: req.body.note,
        metadata: req.body.metadata,
      });
      res.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown transition error";
      if (message.startsWith("INVALID_EXCEPTION_TRANSITION:")) {
        res.status(409).json({ message });
        return;
      }
      if (message === "EXCEPTION_CASE_NOT_FOUND") {
        res.status(404).json({ message: "Exception not found" });
        return;
      }
      throw error;
    }
  }
);

exceptionsRouter.post(
  "/exceptions/transition-bulk",
  requirePermission("EXCEPTIONS_RESOLVE", "EXCEPTIONS_WRITE"),
  [body("exceptionCaseIds").isArray({ min: 1 }), body("toStatus").isIn(Object.values(ExceptionStatus)), body("note").optional().isString()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const ids = req.body.exceptionCaseIds as string[];
    const cases = await prisma.exceptionCase.findMany({ where: { id: { in: ids } } });

    const forbidden = cases.some((item) => !canAccessCollege(req, item.collegeId));
    if (forbidden) {
      res.status(403).json({ message: "Cannot bulk transition exceptions outside your college" });
      return;
    }

    const successes: string[] = [];
    const failures: Array<{ id: string; reason: string }> = [];

    for (const item of cases) {
      try {
        await transitionExceptionCase(prisma, {
          exceptionCaseId: item.id,
          toStatus: req.body.toStatus,
          actorUserId: req.user?.id,
          actorStaffId: req.user?.staffId,
          note: req.body.note,
        });
        successes.push(item.id);
      } catch (error) {
        failures.push({ id: item.id, reason: error instanceof Error ? error.message : "Unknown error" });
      }
    }

    res.json({
      requested: ids.length,
      updated: successes.length,
      failed: failures.length,
      successes,
      failures,
    });
  }
);

exceptionsRouter.post(
  "/exceptions/:exceptionCaseId/retry",
  requirePermission("EXCEPTIONS_RESOLVE", "EXCEPTIONS_WRITE"),
  [param("exceptionCaseId").notEmpty(), body("note").optional().isString()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.exceptionCase.findUnique({ where: { id: req.params.exceptionCaseId } });
    if (!existing) {
      res.status(404).json({ message: "Exception not found" });
      return;
    }
    if (!canAccessCollege(req, existing.collegeId)) {
      res.status(403).json({ message: "Cannot retry another college's exception" });
      return;
    }
    if (!existing.isRetryable) {
      res.status(409).json({ message: "This exception is not retryable" });
      return;
    }
    if (existing.retryCount >= existing.maxRetries) {
      res.status(409).json({ message: "Retry limit reached" });
      return;
    }

    const [updated] = await prisma.$transaction([
      prisma.exceptionCase.update({
        where: { id: existing.id },
        data: {
          retryCount: { increment: 1 },
          status: ExceptionStatus.IN_PROGRESS,
          inProgressAt: new Date(),
        },
      }),
      prisma.exceptionHistory.create({
        data: {
          exceptionCaseId: existing.id,
          eventType: "RETRY_REQUESTED",
          fromStatus: existing.status,
          toStatus: ExceptionStatus.IN_PROGRESS,
          actorUserId: req.user?.id,
          actorStaffId: req.user?.staffId,
          note: req.body.note,
        },
      }),
    ]);

    res.json(updated);
  }
);

exceptionsRouter.post(
  "/exceptions/automation/run",
  requirePermission("EXCEPTIONS_RESOLVE"),
  [body("collegeId").optional().isString()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const requestedCollegeId = req.body.collegeId as string | undefined;
    if (requestedCollegeId && !canAccessCollege(req, requestedCollegeId)) {
      res.status(403).json({ message: "Cannot run exception automation for another college" });
      return;
    }

    const scopedCollegeId = req.user?.role === "SUPER_ADMIN" ? requestedCollegeId : req.user?.collegeId;
    const summary = await runExceptionAutomation(prisma, req.user?.id, scopedCollegeId);
    res.json(summary);
  }
);
