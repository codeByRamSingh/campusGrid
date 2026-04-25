import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";

export const auditRouter = Router();

auditRouter.use(authenticate, requirePermission("AUDIT_READ"));

async function canAccessAuditEntity(entityType: string, entityId: string, collegeId: string | undefined): Promise<boolean> {
  if (!collegeId) {
    return false;
  }

  if (entityType === "STUDENT") {
    const entity = await prisma.student.findUnique({ where: { id: entityId }, select: { collegeId: true } });
    return entity?.collegeId === collegeId;
  }

  if (entityType === "STAFF") {
    const entity = await prisma.staff.findUnique({ where: { id: entityId }, select: { collegeId: true } });
    return entity?.collegeId === collegeId;
  }

  if (entityType === "ADMISSION") {
    const entity = await prisma.admission.findUnique({ where: { id: entityId }, select: { collegeId: true } });
    return entity?.collegeId === collegeId;
  }

  if (entityType === "PAYROLL") {
    const entity = await prisma.payroll.findUnique({
      where: { id: entityId },
      select: { staff: { select: { collegeId: true } } },
    });
    return entity?.staff.collegeId === collegeId;
  }

  if (entityType === "LEAVE_REQUEST") {
    const entity = await prisma.leaveRequest.findUnique({
      where: { id: entityId },
      select: { staff: { select: { collegeId: true } } },
    });
    return entity?.staff.collegeId === collegeId;
  }

  if (entityType === "PAYMENT") {
    const entity = await prisma.payment.findUnique({ where: { id: entityId }, select: { collegeId: true } });
    return entity?.collegeId === collegeId;
  }

  if (entityType === "EXPENSE") {
    const entity = await prisma.expense.findUnique({ where: { id: entityId }, select: { collegeId: true } });
    return entity?.collegeId === collegeId;
  }

  if (entityType === "CREDIT") {
    const entity = await prisma.credit.findUnique({ where: { id: entityId }, select: { collegeId: true } });
    return entity?.collegeId === collegeId;
  }

  return false;
}

auditRouter.get("/audit-logs", async (req: AuthenticatedRequest, res) => {
  const entityType = req.query.entityType as string | undefined;
  const entityId = req.query.entityId as string | undefined;
  const entityIdsRaw = req.query.entityIds as string | undefined;
  const limit = Math.min(Number(req.query.limit || 30), 100);

  const entityIds = entityIdsRaw
    ? entityIdsRaw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  if (req.user?.role !== "SUPER_ADMIN") {
    if (!entityType || (!entityId && entityIds.length === 0)) {
      res.status(400).json({ message: "College-scoped audit access requires entityType and entityId(s)." });
      return;
    }

    const idsToCheck = entityId ? [entityId] : entityIds;
    for (const id of idsToCheck) {
      const allowed = await canAccessAuditEntity(entityType, id, req.user?.collegeId);
      if (!allowed) {
        res.status(403).json({ message: "Cannot access audit logs for another college." });
        return;
      }
    }
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(entityIds.length > 0 ? { entityId: { in: entityIds } } : {}),
    },
    include: {
      actor: {
        select: {
          id: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  res.json(logs);
});
