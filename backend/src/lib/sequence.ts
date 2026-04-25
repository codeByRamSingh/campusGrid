import type { Prisma, PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;

export async function nextSequenceValue(tx: TxClient, scope: string, key: string, seed = 0): Promise<number> {
  const counter = await tx.sequenceCounter.upsert({
    where: { scope_key: { scope, key } },
    update: { value: { increment: 1 } },
    create: { scope, key, value: seed },
  });

  return counter.value;
}
