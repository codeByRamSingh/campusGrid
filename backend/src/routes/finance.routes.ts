import { Router } from "express";
import { body } from "express-validator";
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { ExceptionModule, ExceptionSeverity } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createExceptionCase } from "../lib/exceptions.js";
import { authenticate, canAccessCollege, getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";
import { nextSequenceValue } from "../lib/sequence.js";
import { writeAuditLog } from "../lib/audit.js";
import { buildLedgerSummary } from "../services/reporting.service.js";

export const financeRouter = Router();

financeRouter.use(authenticate);

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const ATTACHMENTS_ROOT = path.resolve(process.cwd(), "storage", "expense-documents");
const ATTACHMENT_TOKEN_TTL_SECONDS = 60 * 15;

const RESTRICTED_FUND_RULES: Record<string, string[]> = {
  GRANTS: ["Academic", "Student Welfare", "Capital"],
  DONATIONS: ["Academic", "Student Welfare", "Capital", "Trust/Admin"],
  "CSR FUNDS": ["Academic", "Student Welfare", "Capital"],
  "SCHOLARSHIP FUNDS": ["Student Welfare"],
};

function normalizedFundKey(value?: string | null) {
  return (value ?? "").trim().toUpperCase();
}

function isCategoryAllowedForFund(paymentSource?: string | null, category?: string | null) {
  const fundKey = normalizedFundKey(paymentSource);
  const categoryName = (category ?? "").trim();
  const allowedCategories = RESTRICTED_FUND_RULES[fundKey];
  if (!allowedCategories) {
    return true;
  }
  return allowedCategories.includes(categoryName);
}

function classifyExpenseNature(category?: string | null) {
  const key = (category ?? "").trim().toLowerCase();
  return key === "capital" ? "CapEx" : "OpEx";
}

function toCsv(headers: string[], rows: string[][]) {
  const escapeCell = (value: string) => {
    const normalized = value.replace(/\r?\n/g, " ");
    if (/[",]/.test(normalized)) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }
    return normalized;
  };

  return [headers.join(","), ...rows.map((row) => row.map((cell) => escapeCell(cell ?? "")).join(","))].join("\n");
}

function signAttachmentToken(payload: Record<string, unknown>) {
  const data = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ATTACHMENT_TOKEN_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
  const secret = process.env.JWT_SECRET || "change-this-in-production";
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyAttachmentToken(token: string) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const secret = process.env.JWT_SECRET || "change-this-in-production";
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  if (expected !== signature) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as Record<string, unknown>;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function getCourseDurationYears(startYear?: number | null, endYear?: number | null) {
  if (!startYear || !endYear) {
    return 1;
  }

  return Math.max(1, endYear - startYear);
}

function getCycleLabel(cycleKey?: string | null) {
  if (!cycleKey?.startsWith("CYCLE_")) {
    return null;
  }

  const cycleNumber = cycleKey.replace("CYCLE_", "");
  return `Cycle ${cycleNumber} due`;
}

function computeCycleSummary(feeConfigured: number, feePaid: number, cycleCount: number) {
  const baseAmount = Math.round((feeConfigured / cycleCount) * 100) / 100;
  const rows: Array<{ amount: number; remaining: number }> = [];
  let remainingConfigured = Math.max(0, Number(feeConfigured || 0));
  let remainingPaid = Math.max(0, Number(feePaid || 0));

  for (let index = 0; index < cycleCount; index += 1) {
    const isLastCycle = index === cycleCount - 1;
    const amount = isLastCycle ? Math.round(remainingConfigured * 100) / 100 : Math.min(remainingConfigured, baseAmount);
    remainingConfigured = Math.max(0, Math.round((remainingConfigured - amount) * 100) / 100);
    const collected = Math.min(remainingPaid, amount);
    remainingPaid = Math.max(0, Math.round((remainingPaid - collected) * 100) / 100);
    rows.push({ amount, remaining: Math.max(0, Math.round((amount - collected) * 100) / 100) });
  }

  return rows;
}

async function generateReceiptNumber(tx: Parameters<typeof nextSequenceValue>[0], collegeId: string, prefix: "FEE" | "MISC" | "FINE") {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const sequence = await nextSequenceValue(tx, "RECEIPT", `${collegeId}:${prefix}:${today}`, 1);
  return `${prefix}-${today}-${String(sequence).padStart(5, "0")}`;
}

financeRouter.post(
  "/finance/fee-collections",
  requirePermission("FINANCE_WRITE"),
  [
    body("studentId").notEmpty(),
    body("amount").isFloat({ gt: 0 }),
    body("description").notEmpty(),
    body("dueCycle").optional().isString(),
    body("lateFine").optional().isNumeric(),
    body("exceptionRequestId").optional().isString(),
    body("paymentMode").optional().isIn(["CASH", "UPI", "BANK", "CHEQUE"]),
    body("reference").optional().isString(),
    body("postingDate").optional().isISO8601(),
    body("collectedBy").optional().isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const student = await prisma.student.findUnique({
      where: { id: req.body.studentId },
      select: {
        id: true,
        collegeId: true,
        candidateName: true,
        admissionNumber: true,
        admissionCode: true,
        totalPayable: true,
        college: {
          select: { name: true },
        },
        admissions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            course: { select: { name: true } },
            session: { select: { label: true, startYear: true, endYear: true } },
          },
        },
      },
    });

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }
    if (!canAccessCollege(req, student.collegeId)) {
      res.status(403).json({ message: "Cannot collect fees for another college" });
      return;
    }

    try {
      const payment = await prisma.$transaction(async (tx) => {
        const receiptNumber = await generateReceiptNumber(tx, student.collegeId, "FEE");
        const paymentMode = optionalString(req.body.paymentMode);
        const referenceNumber = optionalString(req.body.reference);
        const collectedBy = optionalString(req.body.collectedBy) ?? req.user?.email ?? null;
        const paidAt = req.body.postingDate ? new Date(req.body.postingDate) : new Date();
        const lateFine = Number(req.body.lateFine || 0);
        const amount = Number(req.body.amount);
        const latestAdmission = student.admissions[0];
        const cycleKey = optionalString(req.body.dueCycle);
        const cycleLabel = getCycleLabel(cycleKey);
        const exceptionRequestId = optionalString(req.body.exceptionRequestId);

        const feeAggregate = await tx.payment.aggregate({
          where: {
            studentId: req.body.studentId,
            paymentType: "FEE_COLLECTION",
          },
          _sum: { amount: true },
        });
        const feePaid = Number(feeAggregate._sum.amount || 0);
        const feeConfigured = Number(student.totalPayable);
        const cycleCount = Math.max(2, getCourseDurationYears(latestAdmission?.session?.startYear, latestAdmission?.session?.endYear) * 2);
        const cycleSummary = computeCycleSummary(feeConfigured, feePaid, cycleCount);
        const selectedCycleIndex = cycleKey?.startsWith("CYCLE_") ? Math.max(0, Number(cycleKey.replace("CYCLE_", "")) - 1) : 0;

        const approvedException = exceptionRequestId
          ? await tx.feeCollectionException.findFirst({
              where: {
                id: exceptionRequestId,
                studentId: req.body.studentId,
                status: "APPROVED",
              },
            })
          : null;

        const cycleBlocked = cycleSummary.slice(0, selectedCycleIndex).some((cycle) => cycle.remaining > 0);
        if (cycleBlocked && !approvedException) {
          throw { status: 409, code: "FUTURE_CYCLE_BLOCKED", message: "A later cycle cannot be collected while an earlier cycle is unpaid." };
        }

        const selectedRemaining = cycleSummary[selectedCycleIndex]?.remaining ?? cycleSummary[0]?.remaining ?? feeConfigured;
        if (selectedRemaining > 0 && amount > selectedRemaining && !approvedException) {
          throw { status: 409, code: "OVERPAYMENT_DETECTED", message: "Collection amount exceeds remaining balance for selected cycle." };
        }

        // Convert receipt date to UTC boundary for timezone-safe duplicate detection
        const dayStart = new Date(paidAt.toISOString().slice(0, 10) + "T00:00:00Z");
        const dayEnd = new Date(paidAt.toISOString().slice(0, 10) + "T23:59:59Z");

        const duplicatePayment = await tx.payment.findFirst({
          where: {
            studentId: req.body.studentId,
            paymentType: "FEE_COLLECTION",
            amount,
            paidAt: {
              gte: dayStart,
              lte: dayEnd,
            },
            ...(referenceNumber ? { referenceNumber } : {}),
          },
          select: { id: true },
        });

        if (duplicatePayment && !approvedException) {
          throw { status: 409, code: "DUPLICATE_PAYMENT", message: "Similar fee collection already exists for this student." };
        }

        // Validate late fine against college policy
        if (lateFine > 0) {
          const finePolicy = await tx.finePolicy.findFirst({
            where: { collegeId: student.collegeId },
          });

          if (!finePolicy) {
            throw { status: 400, code: "NO_FINE_POLICY", message: "Fine policy not configured for this college. Contact admin to set up fine brackets." };
          }

          const daysBrackets = Array.isArray(finePolicy.daysBrackets) ? finePolicy.daysBrackets : [];
          const maxAllowedFine =
            daysBrackets.length > 0
              ? Math.max(...daysBrackets.map((b: any) => b.fine || 0))
              : Number(finePolicy.defaultFineAmount || 0);

          if (lateFine > maxAllowedFine) {
            throw {
              status: 409,
              code: "FINE_EXCEEDS_POLICY",
              message: `Fine amount ${lateFine} exceeds maximum allowed fine of ${maxAllowedFine} per policy.`,
            };
          }
        }

        const createdPayment = await tx.payment.create({
          data: {
            collegeId: student.collegeId,
            studentId: req.body.studentId,
            amount,
            paymentType: "FEE_COLLECTION",
            description: req.body.description,
            receiptNumber,
            paymentMode,
            referenceNumber,
            collectedBy,
            paidAt,
          },
        });

        await tx.feeReceipt.create({
          data: {
            paymentId: createdPayment.id,
            studentId: student.id,
            receiptNumber,
            cycleKey,
            cycleLabel,
            amount,
            lateFine,
            totalReceived: amount,
            paymentMode,
            referenceNumber,
            collectedBy,
            collectedAt: paidAt,
            snapshot: {
              student: {
                id: student.id,
                candidateName: student.candidateName,
                admissionNumber: student.admissionNumber,
                admissionCode: student.admissionCode,
              },
              academicContext: {
                college: student.college.name,
                course: latestAdmission?.course.name ?? null,
                session: latestAdmission?.session
                  ? `${latestAdmission.session.label} (${latestAdmission.session.startYear}-${latestAdmission.session.endYear})`
                  : null,
              },
              feeConfigured: Number(student.totalPayable),
              payment: {
                description: req.body.description,
                cycleKey,
                cycleLabel,
                amount,
                lateFine,
                totalReceived: amount,
                paymentMode,
                referenceNumber,
                collectedBy,
                collectedAt: paidAt.toISOString(),
                receiptNumber,
              },
            },
          },
        });

        await tx.studentTimeline.create({
          data: {
            studentId: req.body.studentId,
            title: "Fee Collected",
            details: `Amount ${amount} received with receipt ${receiptNumber}${cycleLabel ? ` for ${cycleLabel}` : ""}${paymentMode ? ` via ${paymentMode}` : ""}`,
          },
        });

        await tx.studentTimeline.create({
          data: {
            studentId: req.body.studentId,
            title: "Fee Receipt Stored",
            details: `Receipt ${receiptNumber} stored in student profile${cycleLabel ? ` for ${cycleLabel}` : ""}`,
          },
        });

        if (approvedException) {
          await tx.feeCollectionException.update({
            where: { id: approvedException.id },
            data: {
              status: "RESOLVED",
              reviewNote: approvedException.reviewNote || "Resolved through approved fee collection.",
              reviewedAt: new Date(),
            },
          });
          await tx.studentTimeline.create({
            data: {
              studentId: req.body.studentId,
              title: "Fee Exception Resolved",
              details: `Approved exception ${approvedException.id} was resolved by receipt ${receiptNumber}`,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            actorUserId: req.user?.id,
            action: "FEE_COLLECTED",
            entityType: "PAYMENT",
            entityId: createdPayment.id,
            metadata: {
              collegeId: student.collegeId,
              studentId: req.body.studentId,
              amount,
              receiptNumber,
              cycleKey,
              cycleLabel,
              lateFine,
              paymentMode,
              referenceNumber,
              collectedBy,
              paidAt,
              exceptionRequestId: approvedException?.id ?? null,
            },
          },
        });

        return createdPayment;
      });

      res.status(201).json(payment);
    } catch (error) {
      if (typeof error === "object" && error && "status" in error && "message" in error) {
        const typedError = error as { status: number; message: string; code?: string };

        if (typedError.code) {
          try {
            const collegeId = student.collegeId;
            const cycleKey = optionalString(req.body.dueCycle) ?? "NO_CYCLE";
            const dedupeKey = ["FEE_COLLECTION", typedError.code, req.body.studentId, cycleKey].join(":");
            await createExceptionCase(prisma, {
              collegeId,
              module: ExceptionModule.STUDENT_FEES,
              category: typedError.code,
              severity:
                typedError.code === "DUPLICATE_PAYMENT" || typedError.code === "OVERPAYMENT_DETECTED"
                  ? ExceptionSeverity.HIGH
                  : ExceptionSeverity.MEDIUM,
              title: `Fee collection blocked: ${typedError.code}`,
              description: typedError.message,
              sourceEntityType: "STUDENT",
              sourceEntityId: req.body.studentId,
              sourceOperation: "FEE_COLLECTION",
              dedupeKey,
              idempotencyKey: req.header("x-idempotency-key") || null,
              isRetryable: true,
              maxRetries: 3,
              metadata: {
                amount: Number(req.body.amount),
                dueCycle: optionalString(req.body.dueCycle),
                paymentMode: optionalString(req.body.paymentMode),
                reference: optionalString(req.body.reference),
              },
              createdByUserId: req.user?.id,
            });
          } catch (hookError) {
            console.error("Failed to persist centralized exception case", hookError);
          }
        }

        res.status(typedError.status).json({ message: typedError.message, code: typedError.code });
        return;
      }

      console.error(error);
      res.status(500).json({ message: "Unable to collect fee right now" });
    }
  }
);

financeRouter.post(
  "/finance/fee-collections/drafts",
  requirePermission("FINANCE_WRITE"),
  [
    body("studentId").notEmpty(),
    body("amount").isFloat({ gt: 0 }),
    body("dueCycle").optional().isString(),
    body("lateFine").optional().isNumeric(),
    body("paymentMode").optional().isIn(["CASH", "UPI", "BANK", "CHEQUE"]),
    body("reference").optional().isString(),
    body("postingDate").optional().isISO8601(),
    body("collectedBy").optional().isString(),
    body("notes").optional().isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const student = await prisma.student.findUnique({
      where: { id: req.body.studentId },
      select: { id: true, collegeId: true },
    });

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }
    if (!canAccessCollege(req, student.collegeId)) {
      res.status(403).json({ message: "Cannot save drafts for another college" });
      return;
    }

    const draft = await prisma.feeCollectionDraft.create({
      data: {
        studentId: student.id,
        collegeId: student.collegeId,
        cycleKey: optionalString(req.body.dueCycle),
        amount: Number(req.body.amount),
        lateFine: Number(req.body.lateFine || 0),
        paymentMode: optionalString(req.body.paymentMode),
        referenceNumber: optionalString(req.body.reference),
        postingDate: req.body.postingDate ? new Date(req.body.postingDate) : null,
        collectedBy: optionalString(req.body.collectedBy) ?? req.user?.email ?? null,
        notes: optionalString(req.body.notes),
        createdByUserId: req.user?.id ?? null,
      },
    });

    await prisma.studentTimeline.create({
      data: {
        studentId: student.id,
        title: "Fee Draft Saved",
        details: `Draft ${draft.id} saved for ${draft.cycleKey ?? "fee collection"}`,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user?.id,
        action: "FEE_DRAFT_SAVED",
        entityType: "FEE_COLLECTION_DRAFT",
        entityId: draft.id,
        metadata: {
          studentId: student.id,
          collegeId: student.collegeId,
          amount: Number(draft.amount),
          cycleKey: draft.cycleKey,
        },
      },
    });

    res.status(201).json({
      ...draft,
      amount: Number(draft.amount),
      lateFine: Number(draft.lateFine),
    });
  }
);

financeRouter.post(
  "/finance/fee-collections/exceptions",
  requirePermission("FINANCE_WRITE"),
  [
    body("studentId").notEmpty(),
    body("requestedAmount").isFloat({ gt: 0 }),
    body("remainingBalance").isFloat({ min: 0 }),
    body("reason").notEmpty(),
    body("dueCycle").optional().isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const student = await prisma.student.findUnique({
      where: { id: req.body.studentId },
      select: { id: true, collegeId: true },
    });

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }
    if (!canAccessCollege(req, student.collegeId)) {
      res.status(403).json({ message: "Cannot raise exceptions for another college" });
      return;
    }

    const exception = await prisma.feeCollectionException.create({
      data: {
        studentId: student.id,
        collegeId: student.collegeId,
        cycleKey: optionalString(req.body.dueCycle),
        requestedAmount: Number(req.body.requestedAmount),
        remainingBalance: Number(req.body.remainingBalance),
        reason: req.body.reason,
        requestedByUserId: req.user?.id ?? null,
      },
    });

    await prisma.studentTimeline.create({
      data: {
        studentId: student.id,
        title: "Fee Exception Raised",
        details: `Exception ${exception.id} raised for ${exception.cycleKey ?? "fee collection"}`,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user?.id,
        action: "FEE_EXCEPTION_RAISED",
        entityType: "FEE_COLLECTION_EXCEPTION",
        entityId: exception.id,
        metadata: {
          studentId: student.id,
          collegeId: student.collegeId,
          requestedAmount: Number(exception.requestedAmount),
          remainingBalance: Number(exception.remainingBalance),
          cycleKey: exception.cycleKey,
          reason: exception.reason,
        },
      },
    });

    res.status(201).json({
      ...exception,
      requestedAmount: Number(exception.requestedAmount),
      remainingBalance: Number(exception.remainingBalance),
    });
  }
);

financeRouter.patch(
  "/finance/fee-collections/exceptions/:exceptionId/status",
  requirePermission("FINANCE_APPROVE"),
  [body("status").isIn(["APPROVED", "REJECTED"]), body("reviewNote").optional().isString()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const exception = await prisma.feeCollectionException.findUnique({
      where: { id: req.params.exceptionId },
      select: { id: true, studentId: true, status: true, collegeId: true },
    });

    if (!exception) {
      res.status(404).json({ message: "Exception request not found" });
      return;
    }

    if (exception.status === "RESOLVED") {
      res.status(409).json({ message: "Resolved exception cannot be changed" });
      return;
    }
    if (!canAccessCollege(req, exception.collegeId)) {
      res.status(403).json({ message: "Cannot review another college's exception" });
      return;
    }

    const updated = await prisma.feeCollectionException.update({
      where: { id: req.params.exceptionId },
      data: {
        status: req.body.status,
        reviewNote: optionalString(req.body.reviewNote),
        reviewedAt: new Date(),
        reviewedByUserId: req.user?.id ?? null,
      },
    });

    await prisma.studentTimeline.create({
      data: {
        studentId: exception.studentId,
        title: "Fee Exception Reviewed",
        details: `Exception ${updated.id} marked ${updated.status}`,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user?.id,
        action: "FEE_EXCEPTION_REVIEWED",
        entityType: "FEE_COLLECTION_EXCEPTION",
        entityId: updated.id,
        metadata: {
          status: updated.status,
          reviewNote: updated.reviewNote,
        },
      },
    });

    res.json({
      ...updated,
      requestedAmount: Number(updated.requestedAmount),
      remainingBalance: Number(updated.remainingBalance),
    });
  }
);

financeRouter.get("/finance/receipts/:receiptNumber", requirePermission("FINANCE_READ"), async (req, res) => {
  const receipt = await prisma.feeReceipt.findUnique({
    where: { receiptNumber: req.params.receiptNumber },
    include: {
      student: {
        select: { collegeId: true },
      },
    },
  });

  if (!receipt) {
    res.status(404).json({ message: "Receipt not found" });
    return;
  }
  if (!canAccessCollege(req, receipt.student.collegeId)) {
    res.status(403).json({ message: "Cannot access another college's receipt" });
    return;
  }

  res.json({
    ...receipt,
    amount: Number(receipt.amount),
    lateFine: Number(receipt.lateFine),
    totalReceived: Number(receipt.totalReceived),
  });
});

financeRouter.get("/finance/students/:studentId/ledger", requirePermission("FINANCE_READ"), async (req, res) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.studentId },
    select: { id: true, collegeId: true },
  });

  if (!student) {
    res.status(404).json({ message: "Student not found" });
    return;
  }
  if (!canAccessCollege(req, student.collegeId)) {
    res.status(403).json({ message: "Cannot access another college's student ledger" });
    return;
  }

  const [payments, timeline, receipts, drafts, exceptions] = await Promise.all([
    prisma.payment.findMany({
      where: {
        studentId: req.params.studentId,
        paymentType: { in: ["FEE_COLLECTION", "FINE"] },
      },
      orderBy: { paidAt: "desc" },
      take: 20,
      select: {
        id: true,
        amount: true,
        paymentType: true,
        description: true,
        receiptNumber: true,
        paymentMode: true,
        referenceNumber: true,
        collectedBy: true,
        paidAt: true,
      },
    }),
    prisma.studentTimeline.findMany({
      where: { studentId: req.params.studentId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        title: true,
        details: true,
        createdAt: true,
      },
    }),
    prisma.feeReceipt.findMany({
      where: { studentId: req.params.studentId },
      orderBy: { collectedAt: "desc" },
      take: 20,
      select: {
        id: true,
        receiptNumber: true,
        cycleKey: true,
        cycleLabel: true,
        amount: true,
        lateFine: true,
        totalReceived: true,
        paymentMode: true,
        referenceNumber: true,
        collectedBy: true,
        collectedAt: true,
      },
    }),
    prisma.feeCollectionDraft.findMany({
      where: {
        studentId: req.params.studentId,
        status: "DRAFT",
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        cycleKey: true,
        amount: true,
        lateFine: true,
        paymentMode: true,
        referenceNumber: true,
        postingDate: true,
        collectedBy: true,
        notes: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.feeCollectionException.findMany({
      where: { studentId: req.params.studentId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        cycleKey: true,
        requestedAmount: true,
        remainingBalance: true,
        reason: true,
        status: true,
        reviewNote: true,
        createdAt: true,
        reviewedAt: true,
      },
    }),
  ]);

  res.json({
    payments: payments.map((payment) => ({
      ...payment,
      amount: Number(payment.amount),
    })),
    receipts: receipts.map((receipt) => ({
      ...receipt,
      amount: Number(receipt.amount),
      lateFine: Number(receipt.lateFine),
      totalReceived: Number(receipt.totalReceived),
    })),
    drafts: drafts.map((draft) => ({
      ...draft,
      amount: Number(draft.amount),
      lateFine: Number(draft.lateFine),
    })),
    exceptions: exceptions.map((exception) => ({
      ...exception,
      requestedAmount: Number(exception.requestedAmount),
      remainingBalance: Number(exception.remainingBalance),
    })),
    timeline,
  });
});

financeRouter.post(
  "/finance/misc-credits",
  requirePermission("FINANCE_WRITE"),
  [body("collegeId").notEmpty(), body("amount").isFloat({ gt: 0 }), body("source").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) {
      res.status(403).json({ message: "Cannot add credits to another college" });
      return;
    }

    const college = await prisma.college.findUnique({ where: { id: req.body.collegeId } });
    if (!college) {
      res.status(404).json({ message: "College not found" });
      return;
    }

    const credit = await prisma.$transaction(async (tx) => {
      const receiptNumber = await generateReceiptNumber(tx, req.body.collegeId, "MISC");

      const createdCredit = await tx.credit.create({
        data: {
          collegeId: req.body.collegeId,
          amount: req.body.amount,
          source: req.body.source,
          notes: req.body.notes,
        },
      });

      await tx.payment.create({
        data: {
          collegeId: req.body.collegeId,
          amount: req.body.amount,
          paymentType: "MISC_CREDIT",
          description: req.body.source,
          receiptNumber,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user?.id,
          action: "MISC_CREDIT_ADDED",
          entityType: "CREDIT",
          entityId: createdCredit.id,
          metadata: {
            collegeId: req.body.collegeId,
            amount: req.body.amount,
            source: req.body.source,
            receiptNumber,
          },
        },
      });

      return createdCredit;
    });

    res.status(201).json(credit);
  }
);

financeRouter.post(
  "/finance/fines",
  requirePermission("FINANCE_APPROVE"),
  [body("studentId").notEmpty(), body("amount").isFloat({ gt: 0 }), body("description").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const student = await prisma.student.findUnique({
      where: { id: req.body.studentId },
      select: { collegeId: true },
    });

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }
    if (!canAccessCollege(req, student.collegeId)) {
      res.status(403).json({ message: "Cannot charge fines for another college" });
      return;
    }

    const fine = await prisma.$transaction(async (tx) => {
      const receiptNumber = await generateReceiptNumber(tx, student.collegeId, "FINE");

      const createdFine = await tx.payment.create({
        data: {
          collegeId: student.collegeId,
          studentId: req.body.studentId,
          amount: req.body.amount,
          paymentType: "FINE",
          description: req.body.description,
          receiptNumber,
        },
      });

      await tx.studentTimeline.create({
        data: {
          studentId: req.body.studentId,
          title: "Fine Charged",
          details: `Fine amount ${req.body.amount} added: ${req.body.description}`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user?.id,
          action: "FINE_CHARGED",
          entityType: "PAYMENT",
          entityId: createdFine.id,
          metadata: {
            collegeId: student.collegeId,
            studentId: req.body.studentId,
            amount: req.body.amount,
            receiptNumber,
          },
        },
      });

      return createdFine;
    });

    res.status(201).json(fine);
  }
);

financeRouter.post(
  "/finance/expenses",
  requirePermission("FINANCE_WRITE"),
  [
    body("collegeId").notEmpty(),
    body("amount").isFloat({ gt: 0 }),
    body("category").notEmpty(),
    body("spentOn").isISO8601(),
    body("sourceDocumentRef").optional().isString(),
    body("attachmentPath").optional().isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) {
      res.status(403).json({ message: "Cannot record expenses for another college" });
      return;
    }

    const college = await prisma.college.findUnique({ where: { id: req.body.collegeId } });
    if (!college) {
      res.status(404).json({ message: "College not found" });
      return;
    }

    const sourceDocumentRef = optionalString(req.body.sourceDocumentRef);
    if (sourceDocumentRef) {
      const duplicate = await prisma.expense.findFirst({
        where: {
          collegeId: req.body.collegeId,
          sourceDocumentRef,
        },
      });
      if (duplicate) {
        res.status(409).json({ message: "An expense already exists for this source document reference." });
        return;
      }
    }

    const expense = await prisma.expense.create({
      data: {
        collegeId: req.body.collegeId,
        amount: req.body.amount,
        category: req.body.category,
        subcategory: optionalString(req.body.subcategory),
        notes: req.body.notes,
        description: optionalString(req.body.description),
        spentOn: new Date(req.body.spentOn),
        vendorId: optionalString(req.body.vendorId),
        vendorName: optionalString(req.body.vendorName),
        paymentSource: optionalString(req.body.paymentSource),
        procurementRequestRef: optionalString(req.body.procurementRequestRef),
        procurementOrderRef: optionalString(req.body.procurementOrderRef),
        goodsReceiptRef: optionalString(req.body.goodsReceiptRef),
        sourceDocumentRef,
        attachmentUrl: optionalString(req.body.attachmentUrl),
        attachmentPath: optionalString(req.body.attachmentPath),
        attachmentName: optionalString(req.body.attachmentName),
        attachmentMime: optionalString(req.body.attachmentMime),
        attachmentSize: typeof req.body.attachmentSize === "number" ? req.body.attachmentSize : null,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "EXPENSE_RECORDED",
      entityType: "EXPENSE",
      entityId: expense.id,
      metadata: {
        collegeId: req.body.collegeId,
        amount: req.body.amount,
        category: req.body.category,
        sourceDocumentRef,
      },
    });

    res.status(201).json(expense);
  }
);

financeRouter.get("/finance/fine-policies/:collegeId", requirePermission("FINANCE_READ"), async (req, res) => {
  if (!canAccessCollege(req, req.params.collegeId)) {
    res.status(403).json({ message: "Cannot access another college's fine policy" });
    return;
  }

  const policy = await prisma.finePolicy.findUnique({
    where: { collegeId: req.params.collegeId },
  });

  res.json(
    policy ?? {
      collegeId: req.params.collegeId,
      defaultFineAmount: 0,
      daysBrackets: [],
    }
  );
});

financeRouter.put(
  "/finance/fine-policies/:collegeId",
  requirePermission("FINANCE_APPROVE"),
  [body("defaultFineAmount").isFloat({ min: 0 }), body("daysBrackets").optional().isArray()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.params.collegeId)) {
      res.status(403).json({ message: "Cannot update another college's fine policy" });
      return;
    }

    const daysBrackets = Array.isArray(req.body.daysBrackets) ? req.body.daysBrackets : [];
    const invalidBracket = daysBrackets.find(
      (entry: unknown) =>
        typeof entry !== "object" ||
        !entry ||
        typeof (entry as { daysAfterDue?: unknown }).daysAfterDue !== "number" ||
        typeof (entry as { fine?: unknown }).fine !== "number" ||
        (entry as { daysAfterDue: number }).daysAfterDue < 0 ||
        (entry as { fine: number }).fine < 0
    );

    if (invalidBracket) {
      res.status(400).json({ message: "Each fine bracket must contain non-negative numeric daysAfterDue and fine values." });
      return;
    }

    const policy = await prisma.finePolicy.upsert({
      where: { collegeId: req.params.collegeId },
      update: {
        defaultFineAmount: req.body.defaultFineAmount,
        daysBrackets,
      },
      create: {
        collegeId: req.params.collegeId,
        defaultFineAmount: req.body.defaultFineAmount,
        daysBrackets,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "FINE_POLICY_UPDATED",
      entityType: "FINE_POLICY",
      entityId: policy.id,
      metadata: { collegeId: policy.collegeId, defaultFineAmount: Number(policy.defaultFineAmount), daysBrackets },
    });

    res.json({
      ...policy,
      defaultFineAmount: Number(policy.defaultFineAmount),
    });
  }
);

financeRouter.get("/finance/ledger", requirePermission("FINANCE_READ"), async (req, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's ledger" });
    return;
  }

  const period = (((req.query.period as string | undefined) || "monthly") as "daily" | "weekly" | "monthly" | "quarterly" | "yearly");
  const summary = await buildLedgerSummary(prisma, {
    collegeId: scopedCollegeId,
    period,
  });

  res.json(summary);
});

/**
 * POST /finance/fee-collections/from-draft/:draftId
 * Convert a FeeCollectionDraft to a posted Payment + FeeReceipt
 * Re-validates draft data and posts as new fee collection
 */
financeRouter.post(
  "/finance/fee-collections/from-draft/:draftId",
  requirePermission("FINANCE_WRITE"),
  async (req: AuthenticatedRequest, res) => {
    const draft = await prisma.feeCollectionDraft.findUnique({
      where: { id: req.params.draftId },
      include: {
        student: {
          select: {
            id: true,
            collegeId: true,
            candidateName: true,
            admissionNumber: true,
            admissionCode: true,
            totalPayable: true,
            status: true,
            college: { select: { name: true } },
            admissions: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                course: { select: { name: true } },
                session: { select: { label: true, startYear: true, endYear: true } },
              },
            },
          },
        },
      },
    });

    if (!draft) {
      res.status(404).json({ message: "Draft not found" });
      return;
    }
    if (!canAccessCollege(req, draft.student.collegeId)) {
      res.status(403).json({ message: "Cannot post drafts for another college" });
      return;
    }

    if (draft.status === "POSTED") {
      res.status(409).json({ message: "Draft already posted" });
      return;
    }

    try {
      const payment = await prisma.$transaction(async (tx) => {
        const student = draft.student;
        const receiptNumber = await generateReceiptNumber(tx, student.collegeId, "FEE");
        const amount = Number(draft.amount);
        const lateFine = Number(draft.lateFine || 0);
        const paymentMode = draft.paymentMode;
        const referenceNumber = draft.referenceNumber;
        const collectedBy = draft.collectedBy ?? req.user?.email ?? null;
        const paidAt = draft.postingDate ? new Date(draft.postingDate) : new Date();
        const cycleKey = draft.cycleKey;
        const cycleLabel = getCycleLabel(cycleKey);
        const latestAdmission = student.admissions[0];

        // Re-validate fine against policy
        if (lateFine > 0) {
          const finePolicy = await tx.finePolicy.findFirst({
            where: { collegeId: student.collegeId },
          });

          if (finePolicy) {
            const daysBrackets = Array.isArray(finePolicy.daysBrackets) ? finePolicy.daysBrackets : [];
            const maxAllowedFine =
              daysBrackets.length > 0
                ? Math.max(...daysBrackets.map((b: any) => b.fine || 0))
                : Number(finePolicy.defaultFineAmount || 0);

            if (lateFine > maxAllowedFine) {
              throw {
                status: 409,
                code: "FINE_EXCEEDS_POLICY",
                message: `Fine amount ${lateFine} exceeds maximum allowed fine of ${maxAllowedFine}.`,
              };
            }
          }
        }

        // Create payment
        const createdPayment = await tx.payment.create({
          data: {
            collegeId: student.collegeId,
            studentId: student.id,
            amount,
            paymentType: "FEE_COLLECTION",
            description: draft.notes ?? "Fee collection from draft",
            receiptNumber,
            paymentMode,
            referenceNumber,
            collectedBy,
            paidAt,
          },
        });

        // Create receipt with snapshot
        await tx.feeReceipt.create({
          data: {
            paymentId: createdPayment.id,
            studentId: student.id,
            receiptNumber,
            cycleKey,
            cycleLabel,
            amount,
            lateFine,
            totalReceived: amount,
            paymentMode,
            referenceNumber,
            collectedBy,
            collectedAt: paidAt,
            snapshot: {
              student: {
                id: student.id,
                candidateName: student.candidateName,
                admissionNumber: student.admissionNumber,
                admissionCode: student.admissionCode,
              },
              academicContext: {
                college: student.college.name,
                course: latestAdmission?.course.name ?? null,
                session: latestAdmission?.session
                  ? `${latestAdmission.session.label} (${latestAdmission.session.startYear}-${latestAdmission.session.endYear})`
                  : null,
              },
              feeConfigured: Number(student.totalPayable),
              payment: {
                description: draft.notes ?? "Fee collection from draft",
                cycleKey,
                cycleLabel,
                amount,
                lateFine,
                totalReceived: amount,
                paymentMode,
                referenceNumber,
                collectedBy,
                collectedAt: paidAt.toISOString(),
                receiptNumber,
              },
            },
          },
        });

        // Mark draft as posted
        await tx.feeCollectionDraft.update({
          where: { id: draft.id },
          data: { status: "POSTED" },
        });

        // Log timeline
        await tx.studentTimeline.create({
          data: {
            studentId: student.id,
            title: "Fee Collected from Draft",
            details: `Amount ${amount} received with receipt ${receiptNumber}${cycleLabel ? ` for ${cycleLabel}` : ""}${paymentMode ? ` via ${paymentMode}` : ""}`,
          },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            actorUserId: req.user?.id,
            action: "FEE_COLLECTION_FROM_DRAFT",
            entityType: "PAYMENT",
            entityId: createdPayment.id,
            metadata: {
              studentId: student.id,
              collegeId: student.collegeId,
              draftId: draft.id,
              amount,
              lateFine,
              cycleKey,
              receiptNumber,
            },
          },
        });

        return createdPayment;
      });

      res.status(201).json({
        payment,
        receiptNumber: payment.receiptNumber,
        message: "Draft converted to posted payment",
      });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ code: error.code, message: error.message });
      } else {
        res.status(500).json({ message: "Failed to post draft" });
      }
    }
  }
);

// ─── Expense Management ─────────────────────────────────────────────────────

financeRouter.get("/finance/expenses", requirePermission("FINANCE_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's expenses" });
    return;
  }

  const { status, category, from, to } = req.query as Record<string, string | undefined>;
  const where: Record<string, unknown> = {};
  if (scopedCollegeId) where.collegeId = scopedCollegeId;
  if (status) where.approvalStatus = status;
  if (category) where.category = category;
  if (from || to) {
    where.spentOn = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: { vendor: { select: { id: true, name: true } } },
    orderBy: { spentOn: "desc" },
    take: 500,
  });

  res.json(expenses);
});

financeRouter.patch(
  "/finance/expenses/:id",
  requirePermission("FINANCE_WRITE"),
  [body("amount").optional().isFloat({ gt: 0 }), body("category").optional().notEmpty(), body("sourceDocumentRef").optional().isString()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) { res.status(404).json({ message: "Expense not found" }); return; }
    if (!canAccessCollege(req, expense.collegeId)) { res.status(403).json({ message: "Forbidden" }); return; }

    const sourceDocumentRef = req.body.sourceDocumentRef !== undefined ? optionalString(req.body.sourceDocumentRef) : undefined;
    if (sourceDocumentRef && sourceDocumentRef !== expense.sourceDocumentRef) {
      const duplicate = await prisma.expense.findFirst({
        where: {
          collegeId: expense.collegeId,
          sourceDocumentRef,
          id: { not: expense.id },
        },
      });
      if (duplicate) {
        res.status(409).json({ message: "An expense already exists for this source document reference." });
        return;
      }
    }

    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.amount !== undefined ? { amount: req.body.amount } : {}),
        ...(req.body.category ? { category: req.body.category } : {}),
        ...(req.body.subcategory !== undefined ? { subcategory: req.body.subcategory } : {}),
        ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
        ...(req.body.description !== undefined ? { description: req.body.description } : {}),
        ...(req.body.vendorId !== undefined ? { vendorId: req.body.vendorId || null } : {}),
        ...(req.body.vendorName !== undefined ? { vendorName: req.body.vendorName || null } : {}),
        ...(req.body.paymentSource !== undefined ? { paymentSource: req.body.paymentSource || null } : {}),
        ...(req.body.procurementRequestRef !== undefined ? { procurementRequestRef: optionalString(req.body.procurementRequestRef) } : {}),
        ...(req.body.procurementOrderRef !== undefined ? { procurementOrderRef: optionalString(req.body.procurementOrderRef) } : {}),
        ...(req.body.goodsReceiptRef !== undefined ? { goodsReceiptRef: optionalString(req.body.goodsReceiptRef) } : {}),
        ...(sourceDocumentRef !== undefined ? { sourceDocumentRef } : {}),
        ...(req.body.attachmentUrl !== undefined ? { attachmentUrl: req.body.attachmentUrl || null } : {}),
        ...(req.body.attachmentPath !== undefined ? { attachmentPath: optionalString(req.body.attachmentPath) } : {}),
        ...(req.body.attachmentName !== undefined ? { attachmentName: optionalString(req.body.attachmentName) } : {}),
        ...(req.body.attachmentMime !== undefined ? { attachmentMime: optionalString(req.body.attachmentMime) } : {}),
        ...(req.body.attachmentSize !== undefined ? { attachmentSize: Number(req.body.attachmentSize) || null } : {}),
        ...(req.body.spentOn ? { spentOn: new Date(req.body.spentOn) } : {}),
      },
    });

    res.json(updated);
  }
);

financeRouter.post(
  "/finance/expenses/:id/approve",
  requirePermission("FINANCE_APPROVE"),
  async (req: AuthenticatedRequest, res) => {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) { res.status(404).json({ message: "Expense not found" }); return; }
    if (!canAccessCollege(req, expense.collegeId)) { res.status(403).json({ message: "Forbidden" }); return; }
    if (expense.approvalStatus === "APPROVED") { res.status(409).json({ message: "Expense already approved" }); return; }

    if (!isCategoryAllowedForFund(expense.paymentSource, expense.category)) {
      const fundKey = normalizedFundKey(expense.paymentSource);
      const allowedCategories = RESTRICTED_FUND_RULES[fundKey] ?? [];
      res.status(409).json({
        code: "RESTRICTED_FUND_CATEGORY_VIOLATION",
        message: `Category '${expense.category}' is not allowed for funding source '${expense.paymentSource}'.`,
        allowedCategories,
      });
      return;
    }

    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "APPROVED",
        approvedByUserId: req.user?.id ?? null,
        approvedAt: new Date(),
        rejectedAt: null,
        rejectionNote: null,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "EXPENSE_APPROVED",
      entityType: "EXPENSE",
      entityId: expense.id,
      metadata: { collegeId: expense.collegeId, amount: String(expense.amount) },
    });

    res.json(updated);
  }
);

financeRouter.post(
  "/finance/expenses/:id/reject",
  requirePermission("FINANCE_APPROVE"),
  [body("note").optional().isString()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) { res.status(404).json({ message: "Expense not found" }); return; }
    if (!canAccessCollege(req, expense.collegeId)) { res.status(403).json({ message: "Forbidden" }); return; }

    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "REJECTED",
        rejectedAt: new Date(),
        rejectionNote: req.body.note ?? null,
        approvedAt: null,
        approvedByUserId: null,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "EXPENSE_REJECTED",
      entityType: "EXPENSE",
      entityId: expense.id,
      metadata: { collegeId: expense.collegeId, note: req.body.note },
    });

    res.json(updated);
  }
);

// ─── Vendor Management ────────────────────────────────────────────────────────

financeRouter.get("/finance/vendors", requirePermission("FINANCE_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Forbidden" }); return; }

  const vendors = await prisma.vendor.findMany({
    where: scopedCollegeId ? { collegeId: scopedCollegeId } : {},
    orderBy: { name: "asc" },
  });

  res.json(vendors);
});

financeRouter.post(
  "/finance/vendors",
  requirePermission("FINANCE_WRITE"),
  [body("collegeId").notEmpty(), body("name").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) { res.status(403).json({ message: "Forbidden" }); return; }

    const college = await prisma.college.findUnique({ where: { id: req.body.collegeId } });
    if (!college) { res.status(404).json({ message: "College not found" }); return; }

    const vendor = await prisma.vendor.create({
      data: {
        collegeId: req.body.collegeId,
        name: req.body.name,
        gstNumber: optionalString(req.body.gstNumber),
        contactPerson: optionalString(req.body.contactPerson),
        phone: optionalString(req.body.phone),
        email: optionalString(req.body.email),
        address: optionalString(req.body.address),
        paymentTerms: optionalString(req.body.paymentTerms),
        bankName: optionalString(req.body.bankName),
        bankAccount: optionalString(req.body.bankAccount),
        ifscCode: optionalString(req.body.ifscCode),
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "VENDOR_CREATED",
      entityType: "VENDOR",
      entityId: vendor.id,
      metadata: { collegeId: req.body.collegeId, name: req.body.name },
    });

    res.status(201).json(vendor);
  }
);

financeRouter.patch(
  "/finance/vendors/:id",
  requirePermission("FINANCE_WRITE"),
  [body("name").optional().notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor) { res.status(404).json({ message: "Vendor not found" }); return; }
    if (!canAccessCollege(req, vendor.collegeId)) { res.status(403).json({ message: "Forbidden" }); return; }

    const updated = await prisma.vendor.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.name ? { name: req.body.name } : {}),
        ...(req.body.gstNumber !== undefined ? { gstNumber: optionalString(req.body.gstNumber) } : {}),
        ...(req.body.contactPerson !== undefined ? { contactPerson: optionalString(req.body.contactPerson) } : {}),
        ...(req.body.phone !== undefined ? { phone: optionalString(req.body.phone) } : {}),
        ...(req.body.email !== undefined ? { email: optionalString(req.body.email) } : {}),
        ...(req.body.address !== undefined ? { address: optionalString(req.body.address) } : {}),
        ...(req.body.paymentTerms !== undefined ? { paymentTerms: optionalString(req.body.paymentTerms) } : {}),
        ...(req.body.bankName !== undefined ? { bankName: optionalString(req.body.bankName) } : {}),
        ...(req.body.bankAccount !== undefined ? { bankAccount: optionalString(req.body.bankAccount) } : {}),
        ...(req.body.ifscCode !== undefined ? { ifscCode: optionalString(req.body.ifscCode) } : {}),
        ...(req.body.isActive !== undefined ? { isActive: Boolean(req.body.isActive) } : {}),
      },
    });

    res.json(updated);
  }
);

// ─── Budget Management ────────────────────────────────────────────────────────

financeRouter.get("/finance/budgets", requirePermission("FINANCE_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Forbidden" }); return; }

  const budgets = await prisma.budget.findMany({
    where: {
      ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
      ...(req.query.financialYear ? { financialYear: req.query.financialYear as string } : {}),
    },
    orderBy: [{ category: "asc" }],
  });

  res.json(budgets);
});

financeRouter.post(
  "/finance/budgets",
  requirePermission("FINANCE_APPROVE"),
  [body("collegeId").notEmpty(), body("category").notEmpty(), body("allocatedAmount").isFloat({ gt: 0 }), body("financialYear").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) { res.status(403).json({ message: "Forbidden" }); return; }

    const budget = await prisma.budget.upsert({
      where: { collegeId_category_financialYear: { collegeId: req.body.collegeId, category: req.body.category, financialYear: req.body.financialYear } },
      update: { allocatedAmount: req.body.allocatedAmount, description: optionalString(req.body.description) },
      create: {
        collegeId: req.body.collegeId,
        category: req.body.category,
        subcategory: optionalString(req.body.subcategory),
        allocatedAmount: req.body.allocatedAmount,
        financialYear: req.body.financialYear,
        description: optionalString(req.body.description),
      },
    });

    res.status(201).json(budget);
  }
);

financeRouter.delete("/finance/budgets/:id", requirePermission("FINANCE_APPROVE"), async (req: AuthenticatedRequest, res) => {
  const budget = await prisma.budget.findUnique({ where: { id: req.params.id } });
  if (!budget) { res.status(404).json({ message: "Budget not found" }); return; }
  if (!canAccessCollege(req, budget.collegeId)) { res.status(403).json({ message: "Forbidden" }); return; }

  await prisma.budget.delete({ where: { id: req.params.id } });
  res.json({ message: "Budget deleted" });
});

// ─── Recurring Expenses ───────────────────────────────────────────────────────

financeRouter.get("/finance/recurring-expenses", requirePermission("FINANCE_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Forbidden" }); return; }

  const items = await prisma.recurringExpense.findMany({
    where: scopedCollegeId ? { collegeId: scopedCollegeId } : {},
    include: { vendor: { select: { id: true, name: true } } },
    orderBy: { nextDueDate: "asc" },
  });

  res.json(items);
});

financeRouter.post(
  "/finance/recurring-expenses",
  requirePermission("FINANCE_WRITE"),
  [body("collegeId").notEmpty(), body("title").notEmpty(), body("category").notEmpty(), body("amount").isFloat({ gt: 0 }), body("frequency").notEmpty(), body("nextDueDate").isISO8601()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) { res.status(403).json({ message: "Forbidden" }); return; }

    const item = await prisma.recurringExpense.create({
      data: {
        collegeId: req.body.collegeId,
        title: req.body.title,
        category: req.body.category,
        subcategory: optionalString(req.body.subcategory),
        amount: req.body.amount,
        frequency: req.body.frequency,
        nextDueDate: new Date(req.body.nextDueDate),
        vendorId: optionalString(req.body.vendorId),
        notes: optionalString(req.body.notes),
      },
    });

    res.status(201).json(item);
  }
);

financeRouter.patch(
  "/finance/recurring-expenses/:id",
  requirePermission("FINANCE_WRITE"),
  async (req: AuthenticatedRequest, res) => {
    const item = await prisma.recurringExpense.findUnique({ where: { id: req.params.id } });
    if (!item) { res.status(404).json({ message: "Not found" }); return; }
    if (!canAccessCollege(req, item.collegeId)) { res.status(403).json({ message: "Forbidden" }); return; }

    const updated = await prisma.recurringExpense.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.title ? { title: req.body.title } : {}),
        ...(req.body.category ? { category: req.body.category } : {}),
        ...(req.body.amount !== undefined ? { amount: req.body.amount } : {}),
        ...(req.body.frequency ? { frequency: req.body.frequency } : {}),
        ...(req.body.nextDueDate ? { nextDueDate: new Date(req.body.nextDueDate) } : {}),
        ...(req.body.isActive !== undefined ? { isActive: Boolean(req.body.isActive) } : {}),
        ...(req.body.vendorId !== undefined ? { vendorId: optionalString(req.body.vendorId) } : {}),
        ...(req.body.notes !== undefined ? { notes: optionalString(req.body.notes) } : {}),
      },
    });

    res.json(updated);
  }
);

financeRouter.delete("/finance/recurring-expenses/:id", requirePermission("FINANCE_WRITE"), async (req: AuthenticatedRequest, res) => {
  const item = await prisma.recurringExpense.findUnique({ where: { id: req.params.id } });
  if (!item) { res.status(404).json({ message: "Not found" }); return; }
  if (!canAccessCollege(req, item.collegeId)) { res.status(403).json({ message: "Forbidden" }); return; }

  await prisma.recurringExpense.delete({ where: { id: req.params.id } });
  res.json({ message: "Deleted" });
});

// ─── Petty Cash ───────────────────────────────────────────────────────────────

financeRouter.get("/finance/petty-cash", requirePermission("FINANCE_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Forbidden" }); return; }

  const entries = await prisma.pettyCashEntry.findMany({
    where: scopedCollegeId ? { collegeId: scopedCollegeId } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json(entries);
});

financeRouter.post(
  "/finance/petty-cash",
  requirePermission("FINANCE_WRITE"),
  [body("collegeId").notEmpty(), body("entryType").isIn(["ALLOCATION", "EXPENSE", "REIMBURSEMENT"]), body("amount").isFloat({ gt: 0 }), body("description").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) { res.status(403).json({ message: "Forbidden" }); return; }

    const lastEntry = await prisma.pettyCashEntry.findFirst({
      where: { collegeId: req.body.collegeId },
      orderBy: { createdAt: "desc" },
    });

    const prevBalance = Number(lastEntry?.runningBalance ?? 0);
    const amount = Number(req.body.amount);
    const newBalance =
      req.body.entryType === "ALLOCATION" || req.body.entryType === "REIMBURSEMENT"
        ? prevBalance + amount
        : prevBalance - amount;

    if (newBalance < 0) {
      res.status(400).json({ message: "Insufficient petty cash balance" });
      return;
    }

    const entry = await prisma.pettyCashEntry.create({
      data: {
        collegeId: req.body.collegeId,
        entryType: req.body.entryType,
        amount,
        description: req.body.description,
        reference: optionalString(req.body.reference),
        runningBalance: newBalance,
        recordedBy: req.user?.id ?? null,
      },
    });

    res.status(201).json(entry);
  }
);

// ─── Expense Attachments ─────────────────────────────────────────────────────

financeRouter.post(
  "/finance/expenses/attachments/sign",
  requirePermission("FINANCE_WRITE"),
  [body("collegeId").notEmpty(), body("fileName").notEmpty(), body("mimeType").optional().isString(), body("expenseId").optional().isString()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const collegeId = req.body.collegeId as string;
    if (!canAccessCollege(req, collegeId)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const safeName = String(req.body.fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
    const expenseId = optionalString(req.body.expenseId);
    if (expenseId) {
      const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
      if (!expense || expense.collegeId !== collegeId) {
        res.status(404).json({ message: "Expense not found for selected institution" });
        return;
      }
    }

    const fileKey = `${collegeId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}_${safeName}`;
    const uploadToken = signAttachmentToken({ action: "upload", fileKey, collegeId, expenseId: expenseId ?? null });
    const downloadToken = signAttachmentToken({ action: "download", fileKey, collegeId, expenseId: expenseId ?? null });
    const baseUrl = process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || "4000"}`;

    res.json({
      fileKey,
      attachmentPath: fileKey,
      uploadUrl: `${baseUrl}/finance/expenses/attachments/upload?token=${uploadToken}`,
      downloadUrl: `${baseUrl}/finance/expenses/attachments/download?token=${downloadToken}`,
      expiresInSeconds: ATTACHMENT_TOKEN_TTL_SECONDS,
      suggested: {
        attachmentName: safeName,
        attachmentMime: optionalString(req.body.mimeType),
      },
    });
  }
);

financeRouter.post(
  "/finance/expenses/attachments/upload",
  requirePermission("FINANCE_WRITE"),
  [body("contentBase64").notEmpty().isString(), body("size").optional().isInt({ gt: 0 })],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const token = req.query.token as string | undefined;
    if (!token) {
      res.status(400).json({ message: "Missing upload token" });
      return;
    }

    const payload = verifyAttachmentToken(token);
    if (!payload || payload.action !== "upload") {
      res.status(401).json({ message: "Invalid or expired upload token" });
      return;
    }

    const collegeId = payload.collegeId as string;
    if (!canAccessCollege(req, collegeId)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const fileKey = payload.fileKey as string;
    const targetPath = path.resolve(ATTACHMENTS_ROOT, fileKey);
    if (!targetPath.startsWith(ATTACHMENTS_ROOT)) {
      res.status(400).json({ message: "Invalid file target" });
      return;
    }

    const contentBuffer = Buffer.from(req.body.contentBase64 as string, "base64");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, contentBuffer);

    res.status(201).json({
      message: "Uploaded",
      attachmentPath: fileKey,
      size: contentBuffer.length,
    });
  }
);

financeRouter.get(
  "/finance/expenses/attachments/download",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res) => {
    const token = req.query.token as string | undefined;
    if (!token) {
      res.status(400).json({ message: "Missing download token" });
      return;
    }

    const payload = verifyAttachmentToken(token);
    if (!payload || payload.action !== "download") {
      res.status(401).json({ message: "Invalid or expired download token" });
      return;
    }

    const collegeId = payload.collegeId as string;
    if (!canAccessCollege(req, collegeId)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const fileKey = payload.fileKey as string;
    const targetPath = path.resolve(ATTACHMENTS_ROOT, fileKey);
    if (!targetPath.startsWith(ATTACHMENTS_ROOT)) {
      res.status(400).json({ message: "Invalid file target" });
      return;
    }

    try {
      await fs.access(targetPath);
      const fileName = path.basename(targetPath);
      res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      res.sendFile(targetPath);
    } catch {
      res.status(404).json({ message: "Attachment not found" });
    }
  }
);

// ─── Expense Reports & Audit Logs ───────────────────────────────────────────

financeRouter.get("/finance/expenses/reports", requirePermission("REPORTS_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's reports" });
    return;
  }

  const from = optionalString(req.query.from);
  const to = optionalString(req.query.to);
  const where = {
    ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
    ...((from || to)
      ? {
          spentOn: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };

  const expenses = await prisma.expense.findMany({
    where,
    include: {
      college: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
    },
    orderBy: { spentOn: "desc" },
  });

  const byCategory = new Map<string, number>();
  const byVendor = new Map<string, number>();
  const byInstitution = new Map<string, number>();
  const byStatus = new Map<string, number>();

  let capex = 0;
  let opex = 0;
  let pendingApprovals = 0;

  for (const expense of expenses) {
    const amount = Number(expense.amount || 0);
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + amount);
    byVendor.set(expense.vendor?.name ?? expense.vendorName ?? "Unmapped Vendor", (byVendor.get(expense.vendor?.name ?? expense.vendorName ?? "Unmapped Vendor") ?? 0) + amount);
    byInstitution.set(expense.college.name, (byInstitution.get(expense.college.name) ?? 0) + amount);
    const status = expense.approvalStatus || "PENDING";
    byStatus.set(status, (byStatus.get(status) ?? 0) + amount);

    if (classifyExpenseNature(expense.category) === "CapEx") {
      capex += amount;
    } else {
      opex += amount;
    }

    if (!expense.approvalStatus || expense.approvalStatus === "PENDING") {
      pendingApprovals += 1;
    }
  }

  res.json({
    totalExpenses: expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    pendingApprovals,
    capex,
    opex,
    byCategory: Array.from(byCategory.entries()).map(([name, amount]) => ({ name, amount })),
    byVendor: Array.from(byVendor.entries()).map(([name, amount]) => ({ name, amount })),
    byInstitution: Array.from(byInstitution.entries()).map(([name, amount]) => ({ name, amount })),
    byStatus: Array.from(byStatus.entries()).map(([name, amount]) => ({ name, amount })),
    rows: expenses,
  });
});

financeRouter.get("/finance/expenses/reports/export", requirePermission("REPORTS_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's reports" });
    return;
  }

  const from = optionalString(req.query.from);
  const to = optionalString(req.query.to);

  const expenses = await prisma.expense.findMany({
    where: {
      ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
      ...((from || to)
        ? {
            spentOn: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    include: {
      college: { select: { name: true } },
      vendor: { select: { name: true } },
    },
    orderBy: { spentOn: "desc" },
  });

  const csv = toCsv(
    ["Date", "Institution", "Category", "Subcategory", "Amount", "Nature", "Status", "Vendor", "Payment Source", "Source Doc Ref"],
    expenses.map((expense) => [
      expense.spentOn.toISOString().slice(0, 10),
      expense.college.name,
      expense.category,
      expense.subcategory ?? "",
      String(Number(expense.amount || 0)),
      classifyExpenseNature(expense.category),
      expense.approvalStatus || "PENDING",
      expense.vendor?.name ?? expense.vendorName ?? "",
      expense.paymentSource ?? "",
      expense.sourceDocumentRef ?? "",
    ])
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=\"expense-report-${Date.now()}.csv\"`);
  res.send(csv);
});

financeRouter.get("/finance/expenses/audit-logs", requirePermission("REPORTS_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's logs" });
    return;
  }

  const action = optionalString(req.query.action);
  const from = optionalString(req.query.from);
  const to = optionalString(req.query.to);

  const logs = await prisma.auditLog.findMany({
    where: {
      entityType: { in: ["EXPENSE", "VENDOR", "BUDGET", "RECURRING_EXPENSE", "PETTY_CASH"] },
      ...(action ? { action } : {}),
      ...((from || to)
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    include: {
      actor: { select: { email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const filtered = logs.filter((log) => {
    if (!scopedCollegeId) {
      return true;
    }
    const metadata = (log.metadata ?? {}) as Record<string, unknown>;
    const metaCollege = typeof metadata.collegeId === "string" ? metadata.collegeId : null;
    return !metaCollege || metaCollege === scopedCollegeId;
  });

  res.json(filtered);
});

financeRouter.get("/finance/expenses/audit-logs/export", requirePermission("REPORTS_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's logs" });
    return;
  }

  const action = optionalString(req.query.action);
  const from = optionalString(req.query.from);
  const to = optionalString(req.query.to);

  const logs = await prisma.auditLog.findMany({
    where: {
      entityType: { in: ["EXPENSE", "VENDOR", "BUDGET", "RECURRING_EXPENSE", "PETTY_CASH"] },
      ...(action ? { action } : {}),
      ...((from || to)
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    include: { actor: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const filtered = logs.filter((log) => {
    if (!scopedCollegeId) {
      return true;
    }
    const metadata = (log.metadata ?? {}) as Record<string, unknown>;
    const metaCollege = typeof metadata.collegeId === "string" ? metadata.collegeId : null;
    return !metaCollege || metaCollege === scopedCollegeId;
  });

  const csv = toCsv(
    ["Timestamp", "Action", "Entity", "Entity ID", "Actor", "Metadata"],
    filtered.map((log) => [
      log.createdAt.toISOString(),
      log.action,
      log.entityType,
      log.entityId ?? "",
      log.actor?.email ?? "System",
      JSON.stringify(log.metadata ?? {}),
    ])
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=\"expense-audit-${Date.now()}.csv\"`);
  res.send(csv);
});
