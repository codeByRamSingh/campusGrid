/**
 * LedgerService — Phase 1 / Phase 2 central ledger abstraction.
 *
 * All financial flows MUST route through this service so every transaction is
 * recorded in FinancialTransaction (the single source of truth).
 *
 * Usage inside a Prisma $transaction:
 *   await ledgerCredit(tx, {...});
 *
 * Usage outside a transaction:
 *   await ledgerCredit(prisma, {...});
 *
 * Phase progression:
 *   Phase 1 — Parallel write: existing module logic unchanged, ledger populated.
 *   Phase 2 — Enforced write: ledger write is inside the same $transaction as
 *             the module write.  Rollback if ledger fails.
 *   Phase 3 — Authoritative: reports derive balance from ledger only.
 */

import type { PrismaClient, FinancialTxnSource } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { LedgerRepository } from "../repositories/ledger.repository.js";

// ─── Internal types ───────────────────────────────────────────────────────────

// Accepts either a regular PrismaClient or an interactive-transaction client.
type Db = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export type LedgerEntryInput = {
  collegeId: string;
  amount: number;
  mode: string;
  source: FinancialTxnSource;
  voucherNo: string;
  studentId?: string | null;
  /** Link back to the originating module record (expenseId, payrollId, etc.) */
  referenceNo?: string | null;
  remarks?: string | null;
  date?: Date;
  createdBy?: string | null;
};

// ─── Primitive write helpers (used inside $transaction) ───────────────────────

/**
 * Create a CREDIT entry in the unified ledger.
 * Call inside a Prisma $transaction for atomicity.
 */
export async function ledgerCredit(db: Db, data: LedgerEntryInput) {
  return db.financialTransaction.create({
    data: {
      collegeId: data.collegeId,
      voucherNo: data.voucherNo,
      type: "CREDIT",
      amount: data.amount,
      mode: data.mode,
      source: data.source,
      studentId: data.studentId ?? null,
      referenceNo: data.referenceNo ?? null,
      remarks: data.remarks ?? null,
      date: data.date ?? new Date(),
      createdBy: data.createdBy ?? null,
    },
  });
}

/**
 * Create a DEBIT entry in the unified ledger.
 * Call inside a Prisma $transaction for atomicity.
 */
export async function ledgerDebit(db: Db, data: LedgerEntryInput) {
  return db.financialTransaction.create({
    data: {
      collegeId: data.collegeId,
      voucherNo: data.voucherNo,
      type: "DEBIT",
      amount: data.amount,
      mode: data.mode,
      source: data.source,
      studentId: data.studentId ?? null,
      referenceNo: data.referenceNo ?? null,
      remarks: data.remarks ?? null,
      date: data.date ?? new Date(),
      createdBy: data.createdBy ?? null,
    },
  });
}

// ─── High-level service methods ───────────────────────────────────────────────

const ledgerRepo = new LedgerRepository(defaultPrisma);

/**
 * Reverse a FinancialTransaction entry.
 * Creates an opposite-type entry linked via reversalOf.
 * Marks the original as isReversed = true.
 * Audit logged.
 */
export async function reverseLedgerEntry(
  entryId: string,
  reason: string,
  actorUserId?: string,
): Promise<{ original: Awaited<ReturnType<typeof ledgerRepo.findById>>; reversalId: string }> {
  const original = await ledgerRepo.findById(entryId);
  if (!original) throw new NotFoundError("Transaction not found");
  if (original.isReversed) throw new BadRequestError("Transaction has already been reversed");
  if (original.source === "REVERSAL") throw new BadRequestError("Cannot reverse a reversal entry");

  const result = await defaultPrisma.$transaction(async (tx) => {
    await tx.financialTransaction.update({
      where: { id: original.id },
      data: { isReversed: true },
    });

    const reversal = await tx.financialTransaction.create({
      data: {
        collegeId: original.collegeId,
        voucherNo: `REV-${original.voucherNo}`,
        type: original.type === "CREDIT" ? "DEBIT" : "CREDIT",
        amount: original.amount,
        mode: original.mode,
        source: "REVERSAL",
        referenceNo: original.voucherNo,
        remarks: reason,
        reversalOf: original.id,
        createdBy: actorUserId ?? null,
      },
    });

    await writeAuditLog(tx as typeof defaultPrisma, {
      actorUserId,
      action: "FINANCIAL_TRANSACTION_REVERSED",
      entityType: "FINANCIAL_TRANSACTION",
      entityId: original.id,
      metadata: {
        reversalId: reversal.id,
        originalVoucherNo: original.voucherNo,
        amount: original.amount.toString(),
        reason,
      },
    });

    return { original, reversalId: reversal.id };
  });

  return result;
}

/**
 * Return the net balance (total credits − total debits) from FinancialTransaction.
 * Phase 3: this becomes the authoritative balance.
 */
export async function getLedgerBalance(collegeId: string): Promise<number> {
  return ledgerRepo.getBalance(collegeId);
}

/**
 * Detect transactions in the originating module tables that have NO
 * corresponding FinancialTransaction entry.
 *
 * Returns counts of orphaned records per category.
 * Used by the /finance/consistency-check endpoint.
 */
export async function runConsistencyCheck(collegeId: string): Promise<{
  missingExpenseLedger: number;
  missingPayrollLedger: number;
  missingFeeCollectionLedger: number;
  missingPaymentReversalLedger: number;
  ledgerBalance: number;
  moduleBalance: number;
  drift: number;
}> {
  // 1. Approved expenses without a DEBIT ledger entry
  const missingExpenseLedger = await defaultPrisma.expense.count({
    where: {
      collegeId,
      approvalStatus: "APPROVED",
      NOT: {
        id: {
          in: (
            await defaultPrisma.financialTransaction.findMany({
              where: { collegeId, source: "EXPENSE" },
              select: { referenceNo: true },
            })
          )
            .map((r) => r.referenceNo)
            .filter((r): r is string => r !== null),
        },
      },
    },
  });

  // 2. Paid payroll without a SALARY ledger entry
  const missingPayrollLedger = await defaultPrisma.payroll.count({
    where: {
      status: "PAID",
      staff: { collegeId },
      NOT: {
        id: {
          in: (
            await defaultPrisma.financialTransaction.findMany({
              where: { collegeId, source: "SALARY" },
              select: { referenceNo: true },
            })
          )
            .map((r) => r.referenceNo)
            .filter((r): r is string => r !== null),
        },
      },
    },
  });

  // 3. Fee collections (Payment table) without a FEES ledger entry
  const missingFeeCollectionLedger = await defaultPrisma.payment.count({
    where: {
      collegeId,
      paymentType: { in: ["FEE_COLLECTION", "MISC_CREDIT", "FINE"] },
      reversal: null,
      NOT: {
        receiptNumber: {
          in: (
            await defaultPrisma.financialTransaction.findMany({
              where: { collegeId, source: { in: ["FEES", "MISC"] } },
              select: { voucherNo: true },
            })
          ).map((r) => r.voucherNo),
        },
      },
    },
  });

  // 4. Payment reversals without a REVERSAL ledger entry
  const allPaymentReversals = await defaultPrisma.paymentReversal.findMany({
    where: { payment: { collegeId } },
    include: { payment: { select: { id: true } } },
  });
  const reversalPaymentIds = allPaymentReversals.map((r) => r.payment.id);
  const reversalsWithLedger = await defaultPrisma.financialTransaction.count({
    where: {
      collegeId,
      source: "REVERSAL",
      referenceNo: { in: reversalPaymentIds },
    },
  });
  const missingPaymentReversalLedger = Math.max(0, reversalPaymentIds.length - reversalsWithLedger);

  // Balance drift: ledger balance vs module-computed balance
  const ledgerBalance = await getLedgerBalance(collegeId);

  const [feeCredits, expenseDebits, payrollDebits] = await Promise.all([
    defaultPrisma.payment.aggregate({
      where: { collegeId, paymentType: { in: ["FEE_COLLECTION", "MISC_CREDIT"] }, reversal: null },
      _sum: { amount: true },
    }),
    defaultPrisma.expense.aggregate({
      where: { collegeId, approvalStatus: "APPROVED" },
      _sum: { amount: true },
    }),
    defaultPrisma.payroll.aggregate({
      where: { status: "PAID", staff: { collegeId } },
      _sum: { netAmount: true },
    }),
  ]);
  const moduleBalance =
    Number(feeCredits._sum.amount ?? 0) -
    Number(expenseDebits._sum.amount ?? 0) -
    Number(payrollDebits._sum.netAmount ?? 0);

  return {
    missingExpenseLedger,
    missingPayrollLedger,
    missingFeeCollectionLedger,
    missingPaymentReversalLedger,
    ledgerBalance,
    moduleBalance,
    drift: Math.abs(ledgerBalance - moduleBalance),
  };
}
