import type { PrismaClient } from "@prisma/client";

type AuditInput = {
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: unknown;
};

export async function writeAuditLog(prisma: PrismaClient, input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as object | undefined,
    },
  });
}
