import { Router } from "express";
import { query } from "express-validator";
import { FinancialTxnSource } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError, BadRequestError, NotFoundError } from "../../lib/errors.js";
import {
  canAccessCollege,
  getScopedCollegeId,
  requirePermission,
  type AuthenticatedRequest,
} from "../../middleware/auth.js";
import { handleValidation } from "../../middleware/validate.js";
import { writeAuditLog } from "../../lib/audit.js";

export const transactionsRouter = Router();

// ─── GET /finance/transactions ────────────────────────────────────────────────
// List FinancialTransaction records (filterable by source, date range)

transactionsRouter.get(
  "/finance/transactions",
  requirePermission("FINANCE_READ"),
  [
    query("collegeId").optional().isString(),
    query("source").optional().isIn(Object.values(FinancialTxnSource)),
    query("start_date").optional().isISO8601(),
    query("end_date").optional().isISO8601(),
    query("limit").optional().isInt({ min: 1, max: 200 }),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      if (!scopedCollegeId) {
        res.status(400).json({ message: "collegeId is required" });
        return;
      }

      const source = req.query.source as FinancialTxnSource | undefined;
      const startRaw = req.query.start_date as string | undefined;
      const endRaw = req.query.end_date as string | undefined;
      const limit = Math.min(Number(req.query.limit ?? 100), 200);

      const startDate = startRaw ? new Date(`${startRaw}T00:00:00.000Z`) : undefined;
      const endDate = endRaw ? new Date(`${endRaw}T23:59:59.999Z`) : undefined;

      const transactions = await prisma.financialTransaction.findMany({
        where: {
          collegeId: scopedCollegeId,
          ...(source ? { source } : {}),
          ...(startDate || endDate
            ? {
                date: {
                  ...(startDate ? { gte: startDate } : {}),
                  ...(endDate ? { lte: endDate } : {}),
                },
              }
            : {}),
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: limit,
      });

      res.json(transactions);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /finance/transactions/:id/reverse ───────────────────────────────────
// Creates a reversal transaction — never deletes

transactionsRouter.post(
  "/finance/transactions/:id/reverse",
  requirePermission("FINANCE_WRITE"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const original = await prisma.financialTransaction.findUnique({
        where: { id: req.params.id },
      });

      if (!original) {
        throw new NotFoundError("Transaction not found");
      }

      if (!canAccessCollege(req, original.collegeId)) {
        res.status(403).json({ message: "Cannot reverse a transaction from another college" });
        return;
      }

      if (original.isReversed) {
        throw new BadRequestError("Transaction has already been reversed");
      }

      if (original.source === "REVERSAL") {
        throw new BadRequestError("Cannot reverse a reversal transaction");
      }

      const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim()
        : "Manual reversal";

      const result = await prisma.$transaction(async (tx) => {
        // Mark original as reversed
        await tx.financialTransaction.update({
          where: { id: original.id },
          data: { isReversed: true },
        });

        // Create the reversal entry (opposite type, same amount)
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
            createdBy: req.user?.id ?? null,
          },
        });

        await writeAuditLog(tx as typeof prisma, {
          actorUserId: req.user?.id,
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

        return reversal;
      });

      res.status(201).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);
