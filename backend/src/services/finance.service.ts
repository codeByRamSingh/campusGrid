import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { ExceptionModule, ExceptionSeverity, FinancialTxnSource, FinancialTxnType } from "@prisma/client";
import { BadRequestError, ConflictError, NotFoundError } from "../lib/errors.js";
import { createExceptionCase } from "../lib/exceptions.js";
import { writeAuditLog } from "../lib/audit.js";
import { sendNotification } from "../lib/notify.js";
import { prisma } from "../lib/prisma.js";
import { nextSequenceValue } from "../lib/sequence.js";
import { buildLedgerSummary } from "./reporting.service.js";
import { ledgerCredit, ledgerDebit } from "./ledger.service.js";
import { FinanceRepository } from "../repositories/finance.repository.js";

const financeRepo = new FinanceRepository(prisma);

// ─── Generic helpers ──────────────────────────────────────────────────────────

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const escapeCell = (value: string) => {
    const normalized = value.replace(/\r?\n/g, " ");
    if (/[",]/.test(normalized)) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }
    return normalized;
  };
  return [headers.join(","), ...rows.map((row) => row.map((cell) => escapeCell(cell ?? "")).join(","))].join("\n");
}

// ─── Attachment token helpers ─────────────────────────────────────────────────

const _attachmentSecret = process.env.JWT_SECRET;
if (!_attachmentSecret) {
  throw new Error("FATAL: JWT_SECRET environment variable must be set");
}
const ATTACHMENT_HMAC_SECRET: string = _attachmentSecret;

export const ATTACHMENTS_ROOT = path.resolve(process.cwd(), "storage", "expense-documents");
export const ATTACHMENT_TOKEN_TTL_SECONDS = 60 * 15;

export function signAttachmentToken(payload: Record<string, unknown>): string {
  const data = { ...payload, exp: Math.floor(Date.now() / 1000) + ATTACHMENT_TOKEN_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = crypto.createHmac("sha256", ATTACHMENT_HMAC_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyAttachmentToken(token: string): Record<string, unknown> | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac("sha256", ATTACHMENT_HMAC_SECRET).update(encoded).digest("base64url");
  if (expected !== signature) return null;
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as Record<string, unknown>;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ─── Fund rule helpers ────────────────────────────────────────────────────────

export const RESTRICTED_FUND_RULES: Record<string, string[]> = {
  GRANTS: ["Academic", "Student Welfare", "Capital"],
  DONATIONS: ["Academic", "Student Welfare", "Capital", "Trust/Admin"],
  "CSR FUNDS": ["Academic", "Student Welfare", "Capital"],
  "SCHOLARSHIP FUNDS": ["Student Welfare"],
};

export function normalizedFundKey(value?: string | null): string {
  return (value ?? "").trim().toUpperCase();
}

export function isCategoryAllowedForFund(paymentSource?: string | null, category?: string | null): boolean {
  const fundKey = normalizedFundKey(paymentSource);
  const categoryName = (category ?? "").trim();
  const allowedCategories = RESTRICTED_FUND_RULES[fundKey];
  if (!allowedCategories) return true;
  return allowedCategories.includes(categoryName);
}

export function classifyExpenseNature(category?: string | null): "CapEx" | "OpEx" {
  return (category ?? "").trim().toLowerCase() === "capital" ? "CapEx" : "OpEx";
}

// ─── Cycle helpers ────────────────────────────────────────────────────────────

function getCourseDurationYears(startYear?: number | null, endYear?: number | null): number {
  if (!startYear || !endYear) return 1;
  return Math.max(1, endYear - startYear);
}

function getCycleLabel(cycleKey?: string | null): string | null {
  if (!cycleKey?.startsWith("CYCLE_")) return null;
  return `Cycle ${cycleKey.replace("CYCLE_", "")} due`;
}

function computeCycleSummary(feeConfigured: number, feePaid: number, cycleCount: number) {
  const baseAmount = Math.round((feeConfigured / cycleCount) * 100) / 100;
  const rows: Array<{ amount: number; remaining: number }> = [];
  let remainingConfigured = Math.max(0, Number(feeConfigured || 0));
  let remainingPaid = Math.max(0, Number(feePaid || 0));

  for (let i = 0; i < cycleCount; i++) {
    const isLast = i === cycleCount - 1;
    const amount = isLast ? Math.round(remainingConfigured * 100) / 100 : Math.min(remainingConfigured, baseAmount);
    remainingConfigured = Math.max(0, Math.round((remainingConfigured - amount) * 100) / 100);
    const collected = Math.min(remainingPaid, amount);
    remainingPaid = Math.max(0, Math.round((remainingPaid - collected) * 100) / 100);
    rows.push({ amount, remaining: Math.max(0, Math.round((amount - collected) * 100) / 100) });
  }
  return rows;
}

export async function generateReceiptNumber(
  tx: Parameters<typeof nextSequenceValue>[0],
  collegeId: string,
  prefix: "FEE" | "MISC" | "FINE",
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const sequence = await nextSequenceValue(tx, "RECEIPT", `${collegeId}:${prefix}:${today}`, 1);
  return `${prefix}-${today}-${String(sequence).padStart(5, "0")}`;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export type StudentRef = { id: string; collegeId: string };

export async function loadStudentForFinance(studentId: string): Promise<StudentRef> {
  const student = await financeRepo.findStudentBasic(studentId);
  if (!student) throw new NotFoundError("Student not found");
  return student;
}

// ─── Fee Collection ────────────────────────────────────────────────────────────

export type CollectFeeInput = {
  studentId: string;
  amount: number;
  description: string;
  dueCycle?: string | null;
  lateFine?: number;
  exceptionRequestId?: string | null;
  paymentMode?: string | null;
  reference?: string | null;
  postingDate?: string | null;
  collectedBy?: string | null;
  idempotencyKey?: string | null;
};

export async function collectFee(input: CollectFeeInput, actorEmail?: string | null, actorUserId?: string) {
  const student = await financeRepo.findStudentForFeeCollection(input.studentId);
  if (!student) throw new NotFoundError("Student not found");

  const amount = Number(input.amount);
  const lateFine = Number(input.lateFine || 0);
  const paymentMode = optionalString(input.paymentMode);
  const referenceNumber = optionalString(input.reference);
  const collectedBy = optionalString(input.collectedBy) ?? actorEmail ?? null;
  const paidAt = input.postingDate ? new Date(input.postingDate) : new Date();
  const cycleKey = optionalString(input.dueCycle);
  const cycleLabel = getCycleLabel(cycleKey);
  const exceptionRequestId = optionalString(input.exceptionRequestId);
  const latestAdmission = student.admissions[0];

  const feePaid = await financeRepo.aggregateFeePaid(input.studentId);
  const feeConfigured = Number(student.totalPayable);
  const cycleCount = Math.max(
    2,
    getCourseDurationYears(latestAdmission?.session?.startYear, latestAdmission?.session?.endYear) * 2,
  );
  const cycleSummary = computeCycleSummary(feeConfigured, feePaid, cycleCount);
  const selectedCycleIndex = cycleKey?.startsWith("CYCLE_")
    ? Math.max(0, Number(cycleKey.replace("CYCLE_", "")) - 1)
    : 0;

  const approvedException = exceptionRequestId
    ? await financeRepo.findApprovedFeeException(exceptionRequestId, input.studentId)
    : null;

  const cycleBlocked = cycleSummary.slice(0, selectedCycleIndex).some((c) => c.remaining > 0);
  if (cycleBlocked && !approvedException) {
    await _logFeeException(
      student.collegeId,
      input,
      actorUserId,
      "FUTURE_CYCLE_BLOCKED",
      "A later cycle cannot be collected while an earlier cycle is unpaid.",
      ExceptionSeverity.MEDIUM,
    );
    throw new ConflictError(
      "A later cycle cannot be collected while an earlier cycle is unpaid.",
      "FUTURE_CYCLE_BLOCKED",
    );
  }

  const selectedRemaining =
    cycleSummary[selectedCycleIndex]?.remaining ?? cycleSummary[0]?.remaining ?? feeConfigured;
  if (selectedRemaining > 0 && amount > selectedRemaining && !approvedException) {
    await _logFeeException(
      student.collegeId,
      input,
      actorUserId,
      "OVERPAYMENT_DETECTED",
      "Collection amount exceeds remaining balance for selected cycle.",
      ExceptionSeverity.HIGH,
    );
    throw new ConflictError(
      "Collection amount exceeds remaining balance for selected cycle.",
      "OVERPAYMENT_DETECTED",
    );
  }

  const duplicate = await financeRepo.findDuplicatePayment(input.studentId, amount, paidAt, referenceNumber);
  if (duplicate && !approvedException) {
    await _logFeeException(
      student.collegeId,
      input,
      actorUserId,
      "DUPLICATE_PAYMENT",
      "Similar fee collection already exists for this student.",
      ExceptionSeverity.HIGH,
    );
    throw new ConflictError(
      "Similar fee collection already exists for this student.",
      "DUPLICATE_PAYMENT",
    );
  }

  if (lateFine > 0) {
    const finePolicy = await financeRepo.findFinePolicy(student.collegeId);
    if (!finePolicy) {
      throw new BadRequestError(
        "Fine policy not configured for this college. Contact admin to set up fine brackets.",
        "NO_FINE_POLICY",
      );
    }
    const daysBrackets = Array.isArray(finePolicy.daysBrackets) ? finePolicy.daysBrackets : [];
    const maxAllowedFine =
      daysBrackets.length > 0
        ? Math.max(...daysBrackets.map((b: unknown) => (b as { fine?: number }).fine || 0))
        : Number((finePolicy as { defaultFineAmount?: unknown }).defaultFineAmount || 0);
    if (lateFine > maxAllowedFine) {
      throw new ConflictError(
        `Fine amount ${lateFine} exceeds maximum allowed fine of ${maxAllowedFine} per policy.`,
        "FINE_EXCEEDS_POLICY",
      );
    }
  }

  const payment = await prisma.$transaction(async (tx) => {
    const receiptNumber = await generateReceiptNumber(tx, student.collegeId, "FEE");

    const createdPayment = await financeRepo.createFeeCollectionTx(
      tx,
      {
        collegeId: student.collegeId,
        studentId: input.studentId,
        amount,
        paymentType: "FEE_COLLECTION",
        description: input.description,
        receiptNumber,
        paymentMode,
        referenceNumber,
        collectedBy,
        paidAt,
      },
      {
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
            description: input.description,
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
      input.studentId,
      actorUserId,
      approvedException
        ? { id: approvedException.id, reviewNote: (approvedException as { reviewNote?: string | null }).reviewNote ?? null }
        : null,
      {
        collegeId: student.collegeId,
        studentId: input.studentId,
        amount,
        cycleKey,
        cycleLabel,
        lateFine,
        paymentMode,
        referenceNumber,
        collectedBy,
        paidAt,
        exceptionRequestId: approvedException?.id ?? null,
      },
    );

    // Write to unified financial transaction ledger (single source of truth)
    await tx.financialTransaction.create({
      data: {
        collegeId: student.collegeId,
        voucherNo: receiptNumber,
        type: FinancialTxnType.CREDIT,
        amount,
        mode: paymentMode ?? "CASH",
        source: FinancialTxnSource.FEES,
        studentId: input.studentId,
        remarks: `${cycleLabel ?? "Fee"} — ${student.candidateName}`,
        date: paidAt,
        createdBy: actorUserId ?? null,
      },
    });

    return createdPayment;
  });

  return payment;
}

async function _logFeeException(
  collegeId: string,
  input: CollectFeeInput,
  actorUserId: string | undefined,
  code: string,
  message: string,
  severity: ExceptionSeverity,
) {
  try {
    const cycleKey = typeof input.dueCycle === "string" && input.dueCycle.trim() ? input.dueCycle.trim() : "NO_CYCLE";
    await createExceptionCase(prisma, {
      collegeId,
      module: ExceptionModule.STUDENT_FEES,
      category: code,
      severity,
      title: `Fee collection blocked: ${code}`,
      description: message,
      sourceEntityType: "STUDENT",
      sourceEntityId: input.studentId,
      sourceOperation: "FEE_COLLECTION",
      dedupeKey: ["FEE_COLLECTION", code, input.studentId, cycleKey].join(":"),
      idempotencyKey: input.idempotencyKey ?? null,
      isRetryable: true,
      maxRetries: 3,
      metadata: {
        amount: Number(input.amount),
        dueCycle: input.dueCycle ?? null,
        paymentMode: input.paymentMode ?? null,
        reference: input.reference ?? null,
      },
      createdByUserId: actorUserId,
    });
  } catch (hookError) {
    console.error("Failed to persist centralized exception case", hookError);
  }
}

// ─── Fee Drafts ───────────────────────────────────────────────────────────────

export type CreateFeeDraftInput = {
  studentId: string;
  amount: number;
  dueCycle?: string | null;
  lateFine?: number;
  paymentMode?: string | null;
  reference?: string | null;
  postingDate?: string | null;
  collectedBy?: string | null;
  notes?: string | null;
};

export async function createFeeDraft(input: CreateFeeDraftInput, actorEmail?: string | null, actorUserId?: string) {
  const student = await loadStudentForFinance(input.studentId);

  const draft = await financeRepo.createFeeDraft({
    studentId: student.id,
    collegeId: student.collegeId,
    cycleKey: optionalString(input.dueCycle),
    amount: Number(input.amount),
    lateFine: Number(input.lateFine || 0),
    paymentMode: optionalString(input.paymentMode),
    referenceNumber: optionalString(input.reference),
    postingDate: input.postingDate ? new Date(input.postingDate) : null,
    collectedBy: optionalString(input.collectedBy) ?? actorEmail ?? null,
    notes: optionalString(input.notes),
    createdByUserId: actorUserId ?? null,
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
      actorUserId,
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

  return {
    ...draft,
    amount: Number(draft.amount),
    lateFine: Number(draft.lateFine),
  };
}

// ─── Fee Exceptions ───────────────────────────────────────────────────────────

export type CreateFeeExceptionInput = {
  studentId: string;
  requestedAmount: number;
  remainingBalance: number;
  reason: string;
  dueCycle?: string | null;
};

export async function createFeeException(input: CreateFeeExceptionInput, actorUserId?: string) {
  const student = await loadStudentForFinance(input.studentId);

  const exception = await financeRepo.createFeeException({
    studentId: student.id,
    collegeId: student.collegeId,
    cycleKey: optionalString(input.dueCycle),
    requestedAmount: Number(input.requestedAmount),
    remainingBalance: Number(input.remainingBalance),
    reason: input.reason,
    requestedByUserId: actorUserId ?? null,
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
      actorUserId,
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

  return {
    ...exception,
    requestedAmount: Number(exception.requestedAmount),
    remainingBalance: Number(exception.remainingBalance),
  };
}

export async function reviewFeeException(
  exceptionId: string,
  status: "APPROVED" | "REJECTED",
  reviewNote: string | null,
  actorUserId?: string,
) {
  const exception = await financeRepo.findFeeExceptionWithCollege(exceptionId);
  if (!exception) throw new NotFoundError("Exception request not found");
  if (exception.status === "RESOLVED") {
    throw new ConflictError("Resolved exception cannot be changed");
  }

  const updated = await financeRepo.updateFeeException(exceptionId, {
    status,
    reviewNote: optionalString(reviewNote),
    reviewedAt: new Date(),
    reviewedByUserId: actorUserId ?? null,
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
      actorUserId,
      action: "FEE_EXCEPTION_REVIEWED",
      entityType: "FEE_COLLECTION_EXCEPTION",
      entityId: updated.id,
      metadata: {
        status: updated.status,
        reviewNote: updated.reviewNote,
      },
    },
  });

  return {
    ...updated,
    requestedAmount: Number(updated.requestedAmount),
    remainingBalance: Number(updated.remainingBalance),
  };
}

export async function getExceptionForCollegeCheck(exceptionId: string) {
  return financeRepo.findFeeExceptionWithCollege(exceptionId);
}

// ─── Receipts ─────────────────────────────────────────────────────────────────

export async function getReceiptByNumber(receiptNumber: string) {
  const receipt = await financeRepo.findReceiptByNumber(receiptNumber);
  if (!receipt) throw new NotFoundError("Receipt not found");
  return receipt;
}

export function serializeReceipt(receipt: Awaited<ReturnType<typeof getReceiptByNumber>>) {
  return {
    ...receipt,
    amount: Number(receipt.amount),
    lateFine: Number(receipt.lateFine),
    totalReceived: Number(receipt.totalReceived),
  };
}

// ─── Student Ledger ───────────────────────────────────────────────────────────

export async function getStudentLedger(studentId: string) {
  const student = await loadStudentForFinance(studentId);
  const data = await financeRepo.getStudentLedger(studentId);

  return {
    student,
    payments: data.payments.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
    receipts: data.receipts.map((receipt) => ({
      ...receipt,
      amount: Number(receipt.amount),
      lateFine: Number(receipt.lateFine),
      totalReceived: Number(receipt.totalReceived),
    })),
    drafts: data.drafts.map((draft) => ({
      ...draft,
      amount: Number(draft.amount),
      lateFine: Number(draft.lateFine),
    })),
    exceptions: data.exceptions.map((exception) => ({
      ...exception,
      requestedAmount: Number(exception.requestedAmount),
      remainingBalance: Number(exception.remainingBalance),
    })),
    timeline: data.timeline,
  };
}

// ─── Misc Credits ─────────────────────────────────────────────────────────────

export type CreateMiscCreditInput = {
  collegeId: string;
  amount: number;
  source: string;
  notes?: string | null;
};

export async function createMiscCredit(input: CreateMiscCreditInput, actorUserId?: string) {
  const college = await financeRepo.findCollegeById(input.collegeId);
  if (!college) throw new NotFoundError("College not found");

  return prisma.$transaction(async (tx) => {
    const receiptNumber = await generateReceiptNumber(tx, input.collegeId, "MISC");

    await tx.payment.create({
      data: {
        collegeId: input.collegeId,
        amount: input.amount,
        paymentType: "MISC_CREDIT",
        description: input.source,
        receiptNumber,
      },
    });

    // Write to unified financial transaction ledger (single source of truth)
    const ftx = await tx.financialTransaction.create({
      data: {
        collegeId: input.collegeId,
        voucherNo: receiptNumber,
        type: FinancialTxnType.CREDIT,
        amount: input.amount,
        mode: "BANK",
        source: FinancialTxnSource.MISC,
        remarks: input.notes ?? input.source,
        createdBy: actorUserId ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "MISC_CREDIT_ADDED",
        entityType: "FINANCIAL_TRANSACTION",
        entityId: ftx.id,
        metadata: {
          collegeId: input.collegeId,
          amount: input.amount,
          source: input.source,
          receiptNumber,
        },
      },
    });

    return ftx;
  });
}

// ─── Fines ────────────────────────────────────────────────────────────────────

export type CreateFineInput = {
  studentId: string;
  amount: number;
  description: string;
};

export async function createFine(input: CreateFineInput, actorUserId?: string) {
  const student = await loadStudentForFinance(input.studentId);

  return prisma.$transaction(async (tx) => {
    const receiptNumber = await generateReceiptNumber(tx, student.collegeId, "FINE");

    const createdFine = await tx.payment.create({
      data: {
        collegeId: student.collegeId,
        studentId: input.studentId,
        amount: input.amount,
        paymentType: "FINE",
        description: input.description,
        receiptNumber,
      },
    });

    // Phase 2: ledger CREDIT for fine collection
    await ledgerCredit(tx, {
      collegeId: student.collegeId,
      voucherNo: receiptNumber,
      amount: input.amount,
      mode: "CASH",
      source: FinancialTxnSource.FEES,
      studentId: input.studentId,
      referenceNo: createdFine.id,
      remarks: `Fine — ${input.description}`,
      createdBy: actorUserId ?? null,
    });

    await tx.studentTimeline.create({
      data: {
        studentId: input.studentId,
        title: "Fine Charged",
        details: `Fine amount ${input.amount} added: ${input.description}`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "FINE_CHARGED",
        entityType: "PAYMENT",
        entityId: createdFine.id,
        metadata: {
          collegeId: student.collegeId,
          studentId: input.studentId,
          amount: input.amount,
          receiptNumber,
        },
      },
    });

    return createdFine;
  });
}

// ─── Payment Reversals ────────────────────────────────────────────────────────

export async function reversePayment(paymentId: string, reason: string, actorUserId?: string) {
  const payment = await financeRepo.findPaymentWithReversal(paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  if (payment.reversal) throw new ConflictError("Payment has already been reversed");

  const reversal = await prisma.$transaction(async (tx) => {
    const rev = await tx.paymentReversal.create({
      data: {
        paymentId: payment.id,
        collegeId: payment.collegeId,
        reason,
        reversedBy: actorUserId ?? null,
      },
    });

    // Phase 4: ledger REVERSAL debit — referenceNo = payment.id for deduplication
    // in buildCashLedger so the legacy PaymentReversal block is skipped for this record.
    await ledgerDebit(tx, {
      collegeId: payment.collegeId,
      voucherNo: `REV-${payment.receiptNumber}`,
      amount: Number(payment.amount),
      mode: payment.paymentMode ?? "CASH",
      source: FinancialTxnSource.REVERSAL,
      referenceNo: payment.id,
      remarks: reason,
      createdBy: actorUserId ?? null,
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "PAYMENT_REVERSED",
        entityType: "PAYMENT",
        entityId: payment.id,
        metadata: {
          collegeId: payment.collegeId,
          amount: payment.amount,
          reason,
          receiptNumber: payment.receiptNumber,
        },
      },
    });

    return rev;
  });

  return { reversal, paymentCollegeId: payment.collegeId };
}

export async function getPaymentForCollegeCheck(paymentId: string) {
  return financeRepo.findPaymentWithReversal(paymentId);
}

// ─── Fee Collection from Draft ────────────────────────────────────────────────

export async function postFeeCollectionFromDraft(draftId: string, actorEmail?: string | null, actorUserId?: string) {
  const draft = await financeRepo.findFeeDraftWithStudent(draftId);
  if (!draft) throw new NotFoundError("Draft not found");
  if (draft.status === "POSTED") {
    throw new ConflictError("Draft already posted");
  }

  return prisma.$transaction(async (tx) => {
    const student = draft.student;
    const receiptNumber = await generateReceiptNumber(tx, student.collegeId, "FEE");
    const amount = Number(draft.amount);
    const lateFine = Number(draft.lateFine || 0);
    const paymentMode = draft.paymentMode;
    const referenceNumber = draft.referenceNumber;
    const collectedBy = draft.collectedBy ?? actorEmail ?? null;
    const paidAt = draft.postingDate ? new Date(draft.postingDate) : new Date();
    const cycleKey = draft.cycleKey;
    const cycleLabel = getCycleLabel(cycleKey);
    const latestAdmission = student.admissions[0];

    if (lateFine > 0) {
      const finePolicy = await tx.finePolicy.findFirst({ where: { collegeId: student.collegeId } });
      if (finePolicy) {
        const daysBrackets = Array.isArray(finePolicy.daysBrackets) ? finePolicy.daysBrackets : [];
        const maxAllowedFine =
          daysBrackets.length > 0
            ? Math.max(...daysBrackets.map((b: unknown) => (b as { fine?: number }).fine || 0))
            : Number(finePolicy.defaultFineAmount || 0);
        if (lateFine > maxAllowedFine) {
          throw new ConflictError(
            `Fine amount ${lateFine} exceeds maximum allowed fine of ${maxAllowedFine}.`,
            "FINE_EXCEEDS_POLICY",
          );
        }
      }
    }

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

    await tx.feeCollectionDraft.update({
      where: { id: draft.id },
      data: { status: "POSTED" },
    });

    await tx.studentTimeline.create({
      data: {
        studentId: student.id,
        title: "Fee Collected from Draft",
        details: `Amount ${amount} received with receipt ${receiptNumber}${cycleLabel ? ` for ${cycleLabel}` : ""}${paymentMode ? ` via ${paymentMode}` : ""}`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
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

    // Write to unified financial transaction ledger (single source of truth)
    await tx.financialTransaction.create({
      data: {
        collegeId: student.collegeId,
        voucherNo: receiptNumber,
        type: FinancialTxnType.CREDIT,
        amount,
        mode: paymentMode ?? "CASH",
        source: FinancialTxnSource.FEES,
        studentId: student.id,
        remarks: `${cycleLabel ?? "Fee"} — ${student.candidateName}`,
        date: paidAt,
        createdBy: actorUserId ?? null,
      },
    });

    return createdPayment;
  });
}

export async function getDraftForCollegeCheck(draftId: string) {
  return financeRepo.findFeeDraftWithStudent(draftId);
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export type CreateExpenseInput = {
  collegeId: string;
  amount: number;
  category: string;
  spentOn: string;
  subcategory?: string | null;
  notes?: string | null;
  description?: string | null;
  vendorId?: string | null;
  vendorName?: string | null;
  paymentSource?: string | null;
  procurementRequestRef?: string | null;
  procurementOrderRef?: string | null;
  goodsReceiptRef?: string | null;
  sourceDocumentRef?: string | null;
  attachmentUrl?: string | null;
  attachmentPath?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  attachmentSize?: number | null;
};

export async function createExpense(input: CreateExpenseInput, actorUserId?: string) {
  const college = await financeRepo.findCollegeById(input.collegeId);
  if (!college) throw new NotFoundError("College not found");

  const sourceDocumentRef = optionalString(input.sourceDocumentRef);
  if (sourceDocumentRef) {
    const duplicate = await financeRepo.findExpenseByDocRef(input.collegeId, sourceDocumentRef);
    if (duplicate) {
      throw new ConflictError("An expense already exists for this source document reference.");
    }
  }

  const expense = await financeRepo.createExpense({
    collegeId: input.collegeId,
    amount: input.amount,
    category: input.category,
    subcategory: optionalString(input.subcategory),
    notes: input.notes ?? null,
    description: optionalString(input.description),
    spentOn: new Date(input.spentOn),
    vendorId: optionalString(input.vendorId),
    vendorName: optionalString(input.vendorName),
    paymentSource: optionalString(input.paymentSource),
    procurementRequestRef: optionalString(input.procurementRequestRef),
    procurementOrderRef: optionalString(input.procurementOrderRef),
    goodsReceiptRef: optionalString(input.goodsReceiptRef),
    sourceDocumentRef,
    attachmentUrl: optionalString(input.attachmentUrl),
    attachmentPath: optionalString(input.attachmentPath),
    attachmentName: optionalString(input.attachmentName),
    attachmentMime: optionalString(input.attachmentMime),
    attachmentSize: typeof input.attachmentSize === "number" ? input.attachmentSize : null,
  });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "EXPENSE_RECORDED",
    entityType: "EXPENSE",
    entityId: expense.id,
    metadata: {
      collegeId: input.collegeId,
      amount: input.amount,
      category: input.category,
      sourceDocumentRef,
    },
  });

  // Budget utilization alert
  try {
    const currentYear = new Date().getFullYear();
    const fy = `${currentYear}-${String(currentYear + 1).slice(-2)}`;
    const budget = await financeRepo.findBudget(input.collegeId, input.category, fy);
    if (budget && Number(budget.allocatedAmount) > 0) {
      const spent = await financeRepo.aggregateExpensesByCategory(input.collegeId, input.category);
      const allocated = Number(budget.allocatedAmount);
      const utilization = Math.round((spent / allocated) * 100);

      if (utilization >= 100) {
        await sendNotification({
          subject: `Budget exceeded: ${input.category}`,
          body: `The budget for ${input.category} has been fully utilized (${utilization}%). Allocated: ${allocated}, Spent: ${spent}.`,
          collegeId: input.collegeId,
          metadata: { category: input.category, utilization, allocated, spent },
        });
      } else if (utilization >= 80) {
        await sendNotification({
          subject: `Budget alert: ${input.category} at ${utilization}%`,
          body: `${input.category} budget is ${utilization}% utilized. Allocated: ${allocated}, Spent: ${spent}.`,
          collegeId: input.collegeId,
          metadata: { category: input.category, utilization, allocated, spent },
        });
      }
    }
  } catch {
    // Non-critical
  }

  return expense;
}

export async function listExpenses(filters: {
  collegeId?: string;
  status?: string;
  category?: string;
  from?: string;
  to?: string;
}) {
  return financeRepo.listExpensesFiltered(filters);
}

export type UpdateExpenseInput = Partial<CreateExpenseInput>;

export async function updateExpense(
  expenseId: string,
  input: Record<string, unknown>,
  _actorUserId?: string,
) {
  const expense = await financeRepo.findExpenseSimple(expenseId);
  if (!expense) throw new NotFoundError("Expense not found");

  const sourceDocumentRef =
    input.sourceDocumentRef !== undefined ? optionalString(input.sourceDocumentRef) : undefined;
  if (sourceDocumentRef && sourceDocumentRef !== expense.sourceDocumentRef) {
    const duplicate = await financeRepo.findExpenseByDocRef(expense.collegeId, sourceDocumentRef, expense.id);
    if (duplicate) {
      throw new ConflictError("An expense already exists for this source document reference.");
    }
  }

  const updated = await financeRepo.updateExpense(expenseId, {
    ...(input.amount !== undefined ? { amount: input.amount as number } : {}),
    ...(input.category ? { category: input.category as string } : {}),
    ...(input.subcategory !== undefined ? { subcategory: input.subcategory as string | null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes as string | null } : {}),
    ...(input.description !== undefined ? { description: input.description as string | null } : {}),
    ...(input.vendorId !== undefined ? { vendorId: (input.vendorId as string) || null } : {}),
    ...(input.vendorName !== undefined ? { vendorName: (input.vendorName as string) || null } : {}),
    ...(input.paymentSource !== undefined ? { paymentSource: (input.paymentSource as string) || null } : {}),
    ...(input.procurementRequestRef !== undefined ? { procurementRequestRef: optionalString(input.procurementRequestRef) } : {}),
    ...(input.procurementOrderRef !== undefined ? { procurementOrderRef: optionalString(input.procurementOrderRef) } : {}),
    ...(input.goodsReceiptRef !== undefined ? { goodsReceiptRef: optionalString(input.goodsReceiptRef) } : {}),
    ...(sourceDocumentRef !== undefined ? { sourceDocumentRef } : {}),
    ...(input.attachmentUrl !== undefined ? { attachmentUrl: (input.attachmentUrl as string) || null } : {}),
    ...(input.attachmentPath !== undefined ? { attachmentPath: optionalString(input.attachmentPath) } : {}),
    ...(input.attachmentName !== undefined ? { attachmentName: optionalString(input.attachmentName) } : {}),
    ...(input.attachmentMime !== undefined ? { attachmentMime: optionalString(input.attachmentMime) } : {}),
    ...(input.attachmentSize !== undefined ? { attachmentSize: Number(input.attachmentSize) || null } : {}),
    ...(input.spentOn ? { spentOn: new Date(input.spentOn as string) } : {}),
  });

  return updated;
}

export async function getExpenseForCollegeCheck(expenseId: string) {
  return financeRepo.findExpenseSimple(expenseId);
}

export async function approveExpense(expenseId: string, actorUserId?: string) {
  const expense = await financeRepo.findExpenseSimple(expenseId);
  if (!expense) throw new NotFoundError("Expense not found");
  if (expense.approvalStatus === "APPROVED") {
    throw new ConflictError("Expense already approved");
  }

  if (!isCategoryAllowedForFund(expense.paymentSource, expense.category)) {
    const fundKey = normalizedFundKey(expense.paymentSource);
    const allowedCategories = RESTRICTED_FUND_RULES[fundKey] ?? [];
    const err = new ConflictError(
      `Category '${expense.category}' is not allowed for funding source '${expense.paymentSource}'.`,
      "RESTRICTED_FUND_CATEGORY_VIOLATION",
    );
    (err as ConflictError & { allowedCategories?: string[] }).allowedCategories = allowedCategories;
    throw err;
  }

  // Phase 2: wrap approval + ledger debit atomically so a ledger failure rolls
  // back the approval status change.
  return prisma.$transaction(async (tx) => {
    const updated = await tx.expense.update({
      where: { id: expenseId },
      data: {
        approvalStatus: "APPROVED",
        approvedByUserId: actorUserId ?? null,
        approvedAt: new Date(),
        rejectedAt: null,
        rejectionNote: null,
      },
    });

    // Ledger DEBIT — referenceNo links back to the Expense row for deduplication.
    await ledgerDebit(tx, {
      collegeId: expense.collegeId,
      voucherNo: `EXP-${expense.id.slice(0, 8).toUpperCase()}`,
      amount: Number(expense.amount),
      mode: expense.paymentSource ?? "BANK",
      source: FinancialTxnSource.EXPENSE,
      referenceNo: expense.id,
      remarks: `${expense.category}${expense.subcategory ? ": " + expense.subcategory : ""}`,
      date: expense.spentOn,
      createdBy: actorUserId ?? null,
    });

    await writeAuditLog(tx as typeof prisma, {
      actorUserId,
      action: "EXPENSE_APPROVED",
      entityType: "EXPENSE",
      entityId: expense.id,
      metadata: { collegeId: expense.collegeId, amount: String(expense.amount) },
    });

    return updated;
  });
}

export async function rejectExpense(expenseId: string, note: string | null, actorUserId?: string) {
  const expense = await financeRepo.findExpenseSimple(expenseId);
  if (!expense) throw new NotFoundError("Expense not found");

  const updated = await financeRepo.updateExpense(expenseId, {
    approvalStatus: "REJECTED",
    rejectedAt: new Date(),
    rejectionNote: note ?? null,
    approvedAt: null,
    approvedByUserId: null,
  });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "EXPENSE_REJECTED",
    entityType: "EXPENSE",
    entityId: expense.id,
    metadata: { collegeId: expense.collegeId, note },
  });

  return updated;
}

// ─── Vendors ─────────────────────────────────────────────────────────────────

export async function listVendors(collegeId?: string) {
  return financeRepo.listVendors(collegeId);
}

export type CreateVendorInput = {
  collegeId: string;
  name: string;
  gstNumber?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  ifscCode?: string | null;
};

export async function createVendor(input: CreateVendorInput, actorUserId?: string) {
  const college = await financeRepo.findCollegeById(input.collegeId);
  if (!college) throw new NotFoundError("College not found");

  const vendor = await financeRepo.createVendor({
    collegeId: input.collegeId,
    name: input.name,
    gstNumber: optionalString(input.gstNumber),
    contactPerson: optionalString(input.contactPerson),
    phone: optionalString(input.phone),
    email: optionalString(input.email),
    address: optionalString(input.address),
    paymentTerms: optionalString(input.paymentTerms),
    bankName: optionalString(input.bankName),
    bankAccount: optionalString(input.bankAccount),
    ifscCode: optionalString(input.ifscCode),
  });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "VENDOR_CREATED",
    entityType: "VENDOR",
    entityId: vendor.id,
    metadata: { collegeId: input.collegeId, name: input.name },
  });

  return vendor;
}

export async function updateVendor(
  vendorId: string,
  input: Record<string, unknown>,
  _actorUserId?: string,
) {
  const vendor = await financeRepo.findVendorById(vendorId);
  if (!vendor) throw new NotFoundError("Vendor not found");

  const updated = await financeRepo.updateVendor(vendorId, {
    ...(input.name ? { name: input.name as string } : {}),
    ...(input.gstNumber !== undefined ? { gstNumber: optionalString(input.gstNumber) } : {}),
    ...(input.contactPerson !== undefined ? { contactPerson: optionalString(input.contactPerson) } : {}),
    ...(input.phone !== undefined ? { phone: optionalString(input.phone) } : {}),
    ...(input.email !== undefined ? { email: optionalString(input.email) } : {}),
    ...(input.address !== undefined ? { address: optionalString(input.address) } : {}),
    ...(input.paymentTerms !== undefined ? { paymentTerms: optionalString(input.paymentTerms) } : {}),
    ...(input.bankName !== undefined ? { bankName: optionalString(input.bankName) } : {}),
    ...(input.bankAccount !== undefined ? { bankAccount: optionalString(input.bankAccount) } : {}),
    ...(input.ifscCode !== undefined ? { ifscCode: optionalString(input.ifscCode) } : {}),
    ...(input.isActive !== undefined ? { isActive: Boolean(input.isActive) } : {}),
  });

  return updated;
}

export async function getVendorForCollegeCheck(vendorId: string) {
  return financeRepo.findVendorCollegeId(vendorId);
}

// ─── Vendor Payments ──────────────────────────────────────────────────────────

export async function listVendorPayments(vendorId: string) {
  return financeRepo.listVendorPayments(vendorId);
}

export type CreateVendorPaymentInput = {
  vendorId: string;
  amount: number;
  description: string;
  paymentMode?: string | null;
  referenceNumber?: string | null;
  expenseId?: string | null;
  paidAt?: string | null;
};

export async function createVendorPayment(input: CreateVendorPaymentInput, actorUserId?: string) {
  const vendor = await financeRepo.findVendorCollegeId(input.vendorId);
  if (!vendor) throw new NotFoundError("Vendor not found");

  return prisma.$transaction(async (tx) => {
    const payment = await tx.vendorPayment.create({
      data: {
        vendorId: input.vendorId,
        collegeId: vendor.collegeId,
        amount: Number(input.amount),
        description: input.description,
        paymentMode: optionalString(input.paymentMode) ?? "BANK_TRANSFER",
        referenceNumber: optionalString(input.referenceNumber),
        expenseId: optionalString(input.expenseId),
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        recordedBy: actorUserId ?? null,
      },
    });

    // Phase 2: ledger DEBIT for vendor payment (EXPENSE source)
    await ledgerDebit(tx, {
      collegeId: vendor.collegeId,
      voucherNo: `VP-${payment.id.slice(0, 8).toUpperCase()}`,
      amount: Number(input.amount),
      mode: optionalString(input.paymentMode) ?? "BANK_TRANSFER",
      source: FinancialTxnSource.EXPENSE,
      referenceNo: payment.id,
      remarks: input.description,
      date: input.paidAt ? new Date(input.paidAt) : new Date(),
      createdBy: actorUserId ?? null,
    });

    await writeAuditLog(tx as typeof prisma, {
      actorUserId,
      action: "VENDOR_PAYMENT_RECORDED",
      entityType: "VENDOR_PAYMENT",
      entityId: payment.id,
      metadata: { vendorId: input.vendorId, amount: payment.amount },
    });

    return payment;
  });
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

export async function listBudgets(collegeId?: string, financialYear?: string) {
  return financeRepo.listBudgets(collegeId, financialYear);
}

export type UpsertBudgetInput = {
  collegeId: string;
  category: string;
  subcategory?: string | null;
  allocatedAmount: number;
  financialYear: string;
  description?: string | null;
};

export async function upsertBudget(input: UpsertBudgetInput, _actorUserId?: string) {
  return financeRepo.upsertBudgetFull({
    collegeId: input.collegeId,
    category: input.category,
    subcategory: optionalString(input.subcategory),
    allocatedAmount: input.allocatedAmount,
    financialYear: input.financialYear,
    description: optionalString(input.description),
  });
}

export async function getBudgetForCollegeCheck(budgetId: string) {
  return financeRepo.findBudgetById(budgetId);
}

export async function deleteBudget(budgetId: string) {
  const budget = await financeRepo.findBudgetById(budgetId);
  if (!budget) throw new NotFoundError("Budget not found");
  await financeRepo.deleteBudget(budgetId);
  return budget;
}

// ─── Recurring Expenses ───────────────────────────────────────────────────────

export async function listRecurringExpenses(collegeId?: string) {
  return financeRepo.listRecurringExpenses(collegeId);
}

export type CreateRecurringExpenseInput = {
  collegeId: string;
  title: string;
  category: string;
  subcategory?: string | null;
  amount: number;
  frequency: string;
  nextDueDate: string;
  vendorId?: string | null;
  notes?: string | null;
};

export async function createRecurringExpense(input: CreateRecurringExpenseInput, _actorUserId?: string) {
  return financeRepo.createRecurringExpense({
    collegeId: input.collegeId,
    title: input.title,
    category: input.category,
    subcategory: optionalString(input.subcategory),
    amount: input.amount,
    frequency: input.frequency,
    nextDueDate: new Date(input.nextDueDate),
    vendorId: optionalString(input.vendorId),
    notes: optionalString(input.notes),
  });
}

export async function getRecurringExpenseForCollegeCheck(id: string) {
  return financeRepo.findRecurringExpenseById(id);
}

export async function updateRecurringExpense(
  id: string,
  input: Record<string, unknown>,
  _actorUserId?: string,
) {
  const item = await financeRepo.findRecurringExpenseById(id);
  if (!item) throw new NotFoundError("Not found");

  return financeRepo.updateRecurringExpense(id, {
    ...(input.title ? { title: input.title as string } : {}),
    ...(input.category ? { category: input.category as string } : {}),
    ...(input.amount !== undefined ? { amount: input.amount as number } : {}),
    ...(input.frequency ? { frequency: input.frequency as string } : {}),
    ...(input.nextDueDate ? { nextDueDate: new Date(input.nextDueDate as string) } : {}),
    ...(input.isActive !== undefined ? { isActive: Boolean(input.isActive) } : {}),
    ...(input.vendorId !== undefined ? { vendorId: optionalString(input.vendorId) } : {}),
    ...(input.notes !== undefined ? { notes: optionalString(input.notes) } : {}),
  });
}

export async function deleteRecurringExpense(id: string) {
  const item = await financeRepo.findRecurringExpenseById(id);
  if (!item) throw new NotFoundError("Not found");
  await financeRepo.deleteRecurringExpense(id);
  return item;
}

/**
 * Materialise a recurring-expense template as a PENDING Expense record so it
 * flows through the normal Approvals queue. When approved, the Phase 2
 * approveExpense() handler writes the FinancialTransaction (EXPENSE debit)
 * to the unified cash ledger automatically.
 *
 * Also advances nextDueDate by one frequency period.
 */
export async function postRecurringExpense(id: string, actorUserId?: string) {
  const item = await financeRepo.findRecurringExpenseById(id);
  if (!item) throw new NotFoundError("Recurring expense not found");

  // Compute next occurrence date
  const current = new Date(item.nextDueDate);
  let next: Date;
  switch (item.frequency) {
    case "WEEKLY":   next = new Date(current); next.setDate(next.getDate() + 7); break;
    case "MONTHLY":  next = new Date(current); next.setMonth(next.getMonth() + 1); break;
    case "QUARTERLY":next = new Date(current); next.setMonth(next.getMonth() + 3); break;
    case "ANNUAL":   next = new Date(current); next.setFullYear(next.getFullYear() + 1); break;
    default:         next = new Date(current); next.setMonth(next.getMonth() + 1);
  }

  return prisma.$transaction(async (tx) => {
    // Create the PENDING expense
    const expense = await tx.expense.create({
      data: {
        collegeId: item.collegeId,
        category: item.category,
        subcategory: item.subcategory ?? null,
        amount: item.amount,
        spentOn: new Date(item.nextDueDate),
        notes: `Auto-generated from recurring: ${item.title}`,
        approvalStatus: "PENDING",
        vendorId: item.vendorId ?? null,
      },
    });

    // Advance the recurring schedule
    await tx.recurringExpense.update({
      where: { id: item.id },
      data: { nextDueDate: next },
    });

    await writeAuditLog(tx as typeof prisma, {
      actorUserId,
      action: "RECURRING_EXPENSE_POSTED",
      entityType: "EXPENSE",
      entityId: expense.id,
      metadata: { recurringId: id, collegeId: item.collegeId, amount: String(item.amount) },
    });

    return expense;
  });
}



export async function listPettyCash(collegeId?: string) {
  return financeRepo.listPettyCash(collegeId);
}

export type CreatePettyCashInput = {
  collegeId: string;
  entryType: "ALLOCATION" | "EXPENSE" | "REIMBURSEMENT";
  amount: number;
  description: string;
  reference?: string | null;
};

export async function createPettyCashEntry(input: CreatePettyCashInput, actorUserId?: string) {
  return prisma.$transaction(
    async (tx) => {
      const agg = await tx.$queryRaw<Array<{ balance: string }>>`
        SELECT COALESCE(SUM(
          CASE
            WHEN "entryType" IN ('ALLOCATION', 'REIMBURSEMENT') THEN amount
            ELSE -amount
          END
        ), 0)::text AS balance
        FROM "PettyCashEntry"
        WHERE "collegeId" = ${input.collegeId}
      `;

      const prevBalance = Number(agg[0]?.balance ?? 0);
      const amount = Number(input.amount);
      const newBalance =
        input.entryType === "ALLOCATION" || input.entryType === "REIMBURSEMENT"
          ? prevBalance + amount
          : prevBalance - amount;

      if (newBalance < 0) {
        throw new BadRequestError("Insufficient petty cash balance");
      }

      const entry = await tx.pettyCashEntry.create({
        data: {
          collegeId: input.collegeId,
          entryType: input.entryType,
          amount,
          description: input.description,
          reference: optionalString(input.reference),
          runningBalance: newBalance,
          recordedBy: actorUserId ?? null,
        },
      });

      // Derive transaction type: ALLOCATION/REIMBURSEMENT = CREDIT, EXPENSE = DEBIT
      const txnType =
        input.entryType === "ALLOCATION" || input.entryType === "REIMBURSEMENT"
          ? FinancialTxnType.CREDIT
          : FinancialTxnType.DEBIT;

      const voucherPrefix = input.entryType === "ALLOCATION" ? "PC-ALLOC" :
        input.entryType === "REIMBURSEMENT" ? "PC-REIMB" : "PC-EXP";
      const voucherNo = `${voucherPrefix}-${entry.id.slice(0, 8).toUpperCase()}`;

      await tx.financialTransaction.create({
        data: {
          collegeId: input.collegeId,
          voucherNo,
          type: txnType,
          amount,
          mode: "CASH",
          source: FinancialTxnSource.PETTY_CASH,
          referenceNo: optionalString(input.reference),
          remarks: input.description,
          createdBy: actorUserId ?? null,
        },
      });

      return entry;
    },
    { isolationLevel: "Serializable" },
  );
}

// ─── Fine Policies ────────────────────────────────────────────────────────────

export async function getFinePolicy(collegeId: string) {
  return financeRepo.findFinePolicyByUnique(collegeId);
}

export type UpsertFinePolicyInput = {
  collegeId: string;
  defaultFineAmount: number;
  daysBrackets?: unknown[];
};

export async function upsertFinePolicy(input: UpsertFinePolicyInput, actorUserId?: string) {
  const daysBrackets = Array.isArray(input.daysBrackets) ? input.daysBrackets : [];
  const invalidBracket = daysBrackets.find(
    (entry: unknown) =>
      typeof entry !== "object" ||
      !entry ||
      typeof (entry as { daysAfterDue?: unknown }).daysAfterDue !== "number" ||
      typeof (entry as { fine?: unknown }).fine !== "number" ||
      (entry as { daysAfterDue: number }).daysAfterDue < 0 ||
      (entry as { fine: number }).fine < 0,
  );

  if (invalidBracket) {
    throw new BadRequestError(
      "Each fine bracket must contain non-negative numeric daysAfterDue and fine values.",
    );
  }

  const policy = await financeRepo.upsertFinePolicy(input.collegeId, input.defaultFineAmount, daysBrackets);

  await writeAuditLog(prisma, {
    actorUserId,
    action: "FINE_POLICY_UPDATED",
    entityType: "FINE_POLICY",
    entityId: policy.id,
    metadata: {
      collegeId: policy.collegeId,
      defaultFineAmount: Number(policy.defaultFineAmount),
      daysBrackets,
    },
  });

  return {
    ...policy,
    defaultFineAmount: Number(policy.defaultFineAmount),
  };
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

export async function getLedgerSummary(
  collegeId: string | undefined,
  period: "daily" | "weekly" | "monthly" | "quarterly" | "yearly",
) {
  return buildLedgerSummary(prisma, { collegeId, period });
}

// ─── Expense Reports ──────────────────────────────────────────────────────────

export async function getExpenseReport(filters: { collegeId?: string; from?: string; to?: string }) {
  const expenses = await financeRepo.listExpensesForReports(filters);

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
    const vendorKey = expense.vendor?.name ?? expense.vendorName ?? "Unmapped Vendor";
    byVendor.set(vendorKey, (byVendor.get(vendorKey) ?? 0) + amount);
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

  return {
    totalExpenses: expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    pendingApprovals,
    capex,
    opex,
    byCategory: Array.from(byCategory.entries()).map(([name, amount]) => ({ name, amount })),
    byVendor: Array.from(byVendor.entries()).map(([name, amount]) => ({ name, amount })),
    byInstitution: Array.from(byInstitution.entries()).map(([name, amount]) => ({ name, amount })),
    byStatus: Array.from(byStatus.entries()).map(([name, amount]) => ({ name, amount })),
    rows: expenses,
  };
}

export async function getExpenseReportCsv(filters: { collegeId?: string; from?: string; to?: string }) {
  const expenses = await financeRepo.listExpensesForReports(filters);

  return toCsv(
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
    ]),
  );
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export async function getFinanceAuditLogs(filters: {
  collegeId?: string;
  action?: string;
  from?: string;
  to?: string;
}) {
  const logs = await financeRepo.listFinanceAuditLogs({
    action: filters.action,
    from: filters.from,
    to: filters.to,
  });

  return logs.filter((log) => {
    if (!filters.collegeId) return true;
    const metadata = (log.metadata ?? {}) as Record<string, unknown>;
    const metaCollege = typeof metadata.collegeId === "string" ? metadata.collegeId : null;
    return !metaCollege || metaCollege === filters.collegeId;
  });
}

export async function getFinanceAuditLogsCsv(filters: {
  collegeId?: string;
  action?: string;
  from?: string;
  to?: string;
}) {
  const filtered = await getFinanceAuditLogs(filters);

  return toCsv(
    ["Timestamp", "Action", "Entity", "Entity ID", "Actor", "Metadata"],
    filtered.map((log) => [
      log.createdAt.toISOString(),
      log.action,
      log.entityType,
      log.entityId ?? "",
      log.actor?.email ?? "System",
      JSON.stringify(log.metadata ?? {}),
    ]),
  );
}

// ─── Fee Demand Cycles ────────────────────────────────────────────────────────

export async function listFeeDemandCycles(filters: { studentId?: string; collegeId?: string }) {
  return financeRepo.listFeeDemandCycles(filters);
}

export async function getFeeDemandCycleForCollegeCheck(id: string) {
  return financeRepo.findFeeDemandCycle(id);
}

export async function updateFeeDemandCycle(
  id: string,
  input: { status?: string; paidAmount?: number },
) {
  const cycle = await financeRepo.findFeeDemandCycle(id);
  if (!cycle) throw new NotFoundError("Fee demand cycle not found");

  return financeRepo.updateFeeDemandCycle(id, {
    ...(input.status ? { status: input.status as never } : {}),
    ...(input.paidAmount !== undefined ? { paidAmount: Number(input.paidAmount) } : {}),
  });
}

// ─── Attachment helpers (file IO) ─────────────────────────────────────────────

export type SignAttachmentInput = {
  collegeId: string;
  fileName: string;
  mimeType?: string | null;
  expenseId?: string | null;
};

export async function signExpenseAttachmentTokens(input: SignAttachmentInput) {
  const safeName = String(input.fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const expenseId = optionalString(input.expenseId);
  if (expenseId) {
    const expense = await financeRepo.findExpenseSimple(expenseId);
    if (!expense || expense.collegeId !== input.collegeId) {
      throw new NotFoundError("Expense not found for selected institution");
    }
  }

  const fileKey = `${input.collegeId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}_${safeName}`;
  const uploadToken = signAttachmentToken({ action: "upload", fileKey, collegeId: input.collegeId, expenseId: expenseId ?? null });
  const downloadToken = signAttachmentToken({ action: "download", fileKey, collegeId: input.collegeId, expenseId: expenseId ?? null });
  const baseUrl = process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || "4000"}`;

  return {
    fileKey,
    attachmentPath: fileKey,
    uploadUrl: `${baseUrl}/finance/expenses/attachments/upload?token=${uploadToken}`,
    downloadUrl: `${baseUrl}/finance/expenses/attachments/download?token=${downloadToken}`,
    expiresInSeconds: ATTACHMENT_TOKEN_TTL_SECONDS,
    suggested: {
      attachmentName: safeName,
      attachmentMime: optionalString(input.mimeType),
    },
  };
}

export async function uploadExpenseAttachment(token: string, contentBase64: string, collegeIdAccessor: (collegeId: string) => boolean) {
  const payload = verifyAttachmentToken(token);
  if (!payload || payload.action !== "upload") {
    throw new Error("INVALID_UPLOAD_TOKEN");
  }
  const collegeId = payload.collegeId as string;
  if (!collegeIdAccessor(collegeId)) {
    throw new Error("FORBIDDEN");
  }
  const fileKey = payload.fileKey as string;
  const targetPath = path.resolve(ATTACHMENTS_ROOT, fileKey);
  if (!targetPath.startsWith(ATTACHMENTS_ROOT)) {
    throw new BadRequestError("Invalid file target");
  }
  const contentBuffer = Buffer.from(contentBase64, "base64");
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contentBuffer);
  return { attachmentPath: fileKey, size: contentBuffer.length };
}

// ─── Fee Dues (simplified cashier view) ──────────────────────────────────────

export type StudentDueRow = {
  cycleKey: string;
  label: string;
  dueDate: string;
  amount: number;
  paid: number;
  balance: number;
  status: string;
};

export type StudentDuesResponse = {
  student: {
    id: string;
    name: string;
    admissionNo: string;
    college: string;
    course: string;
    session: string;
    status: string;
    totalPayable: number;
    totalPaid: number;
    totalDue: number;
  };
  dues: StudentDueRow[];
};

export async function getStudentDues(studentId: string): Promise<StudentDuesResponse> {
  const student = await financeRepo.findStudentForFeeCollection(studentId);
  if (!student) throw new NotFoundError("Student not found");

  const totalPaid = await financeRepo.aggregateFeePaid(studentId);
  const feeConfigured = Number(student.totalPayable);
  const latestAdmission = student.admissions[0] ?? null;

  const dbCycles = await prisma.feeDemandCycle.findMany({
    where: { studentId, status: { not: "WAIVED" } },
    orderBy: { cycleKey: "asc" },
    select: { cycleKey: true, label: true, dueDate: true, amount: true, paidAmount: true, status: true },
  });

  let dues: StudentDueRow[];

  if (dbCycles.length > 0) {
    dues = dbCycles.map((cycle) => {
      const amount = Number(cycle.amount);
      const paid = Number(cycle.paidAmount);
      const balance = Math.max(0, Math.round((amount - paid) * 100) / 100);
      const overdue = balance > 0 && new Date(cycle.dueDate) < new Date();
      const status =
        cycle.status === "PAID" || balance === 0
          ? "Paid"
          : paid > 0
          ? "Partial"
          : overdue
          ? "Overdue"
          : "Open";
      return {
        cycleKey: cycle.cycleKey,
        label: cycle.label,
        dueDate: new Date(cycle.dueDate).toISOString().slice(0, 10),
        amount,
        paid,
        balance,
        status,
      };
    });
  } else {
    const durationYears = getCourseDurationYears(latestAdmission?.session?.startYear, latestAdmission?.session?.endYear);
    const cycleCount = Math.max(2, durationYears * 2);
    const cycleSummary = computeCycleSummary(feeConfigured, totalPaid, cycleCount);
    const startYear = latestAdmission?.session?.startYear ?? new Date().getFullYear();

    dues = cycleSummary.map((cycle, i) => {
      const cycleKey = `CYCLE_${i + 1}`;
      const label = `Semester ${i + 1}`;
      const monthOffset = 6 + i * 6;
      const year = startYear + Math.floor(monthOffset / 12);
      const month = monthOffset % 12;
      const dueDate = new Date(year, month === 0 ? 11 : month - 1, 15).toISOString().slice(0, 10);
      const paid = Math.round((cycle.amount - cycle.remaining) * 100) / 100;
      const balance = cycle.remaining;
      const overdue = balance > 0 && new Date(dueDate) < new Date();
      const status = balance === 0 ? "Paid" : paid > 0 ? "Partial" : overdue ? "Overdue" : "Open";
      return { cycleKey, label, dueDate, amount: cycle.amount, paid, balance, status };
    });
  }

  const totalDue = Math.round(dues.reduce((sum, d) => sum + d.balance, 0) * 100) / 100;

  return {
    student: {
      id: student.id,
      name: student.candidateName,
      admissionNo: student.admissionCode ?? `#${student.admissionNumber}`,
      college: student.college.name,
      course: latestAdmission?.course.name ?? "Not mapped",
      session: latestAdmission?.session
        ? `${latestAdmission.session.label} (${latestAdmission.session.startYear}–${latestAdmission.session.endYear})`
        : "Not mapped",
      status: student.status as string,
      totalPayable: feeConfigured,
      totalPaid,
      totalDue,
    },
    dues,
  };
}

// ─── Allocated Fee Collection (multi-cycle, single receipt) ──────────────────

export type CollectFeeAllocatedInput = {
  studentId: string;
  paymentMode: string;
  paymentDate?: string | null;
  notes?: string | null;
  reference?: string | null;
  allocations: Array<{ cycleKey: string; amount: number }>;
};

export type CollectFeeAllocatedResult = {
  receiptNumber: string;
  totalAmount: number;
  paymentMode: string;
  paidAt: string;
  allocations: Array<{ cycleKey: string; label: string; amount: number }>;
  student: {
    name: string;
    admissionNo: string;
    college: string;
    course: string | null;
    session: string | null;
  };
};

export async function collectFeeAllocated(
  input: CollectFeeAllocatedInput,
  actorEmail?: string | null,
  actorUserId?: string,
): Promise<CollectFeeAllocatedResult> {
  const student = await financeRepo.findStudentForFeeCollection(input.studentId);
  if (!student) throw new NotFoundError("Student not found");

  if ((student.status as string) !== "ACTIVE") {
    throw new BadRequestError("Student account is not active. Please contact administration.", "STUDENT_INACTIVE");
  }

  const allocations = input.allocations.filter((a) => Number(a.amount) > 0);
  if (allocations.length === 0) throw new BadRequestError("No payment amounts specified.");

  const totalAmount = Math.round(allocations.reduce((sum, a) => sum + Number(a.amount), 0) * 100) / 100;

  const totalPaid = await financeRepo.aggregateFeePaid(input.studentId);
  const feeConfigured = Number(student.totalPayable);
  const outstandingBalance = Math.max(0, Math.round((feeConfigured - totalPaid) * 100) / 100);

  if (totalAmount > outstandingBalance + 0.01) {
    throw new ConflictError(
      `Payment of ₹${totalAmount.toLocaleString()} exceeds outstanding balance of ₹${outstandingBalance.toLocaleString()}.`,
      "OVERPAYMENT_DETECTED",
    );
  }

  const paidAt = input.paymentDate ? new Date(input.paymentDate) : new Date();
  const paymentMode = optionalString(input.paymentMode) ?? "CASH";
  const collectedBy = actorEmail ?? null;
  const referenceNumber = optionalString(input.reference);
  const latestAdmission = student.admissions[0] ?? null;

  const duplicate = await financeRepo.findDuplicatePayment(input.studentId, totalAmount, paidAt, referenceNumber);
  if (duplicate) {
    throw new ConflictError("A similar payment was already recorded for this student today.", "DUPLICATE_PAYMENT");
  }

  const result = await prisma.$transaction(async (tx) => {
    const receiptNumber = await generateReceiptNumber(tx, student.collegeId, "FEE");

    const dbCycles = await tx.feeDemandCycle.findMany({
      where: { studentId: input.studentId },
      select: { cycleKey: true, label: true },
    });
    const cycleLabels = new Map(dbCycles.map((c) => [c.cycleKey, c.label]));

    const enrichedAllocations = allocations.map((a) => ({
      cycleKey: a.cycleKey,
      label: cycleLabels.get(a.cycleKey) ?? getCycleLabel(a.cycleKey) ?? `Cycle ${a.cycleKey.replace("CYCLE_", "")}`,
      amount: Number(a.amount),
    }));

    const description =
      enrichedAllocations.length === 1
        ? `${enrichedAllocations[0].label} fee collection`
        : `Fee collection (${enrichedAllocations.length} instalments)`;

    const cycleKeyForReceipt = enrichedAllocations.length === 1 ? enrichedAllocations[0].cycleKey : null;
    const cycleLabelForReceipt =
      enrichedAllocations.length === 1 ? enrichedAllocations[0].label : `${enrichedAllocations.length} instalments`;

    const createdPayment = await tx.payment.create({
      data: {
        collegeId: student.collegeId,
        studentId: input.studentId,
        amount: totalAmount,
        paymentType: "FEE_COLLECTION" as never,
        description,
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
        studentId: input.studentId,
        receiptNumber,
        cycleKey: cycleKeyForReceipt,
        cycleLabel: cycleLabelForReceipt,
        amount: totalAmount,
        lateFine: 0,
        totalReceived: totalAmount,
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
              ? `${latestAdmission.session.label} (${latestAdmission.session.startYear}–${latestAdmission.session.endYear})`
              : null,
          },
          payment: {
            description,
            allocations: enrichedAllocations,
            totalAmount,
            paymentMode,
            referenceNumber,
            collectedBy,
            collectedAt: paidAt.toISOString(),
            receiptNumber,
          },
        },
      },
    });

    for (const alloc of enrichedAllocations) {
      await tx.feeDemandCycle.updateMany({
        where: { studentId: input.studentId, cycleKey: alloc.cycleKey },
        data: { paidAmount: { increment: alloc.amount } },
      });
    }

    await tx.studentTimeline.create({
      data: {
        studentId: input.studentId,
        title: "Fee Collected",
        details: `₹${totalAmount.toLocaleString()} received via ${paymentMode} — Receipt ${receiptNumber}`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "FEE_COLLECTED",
        entityType: "PAYMENT",
        entityId: createdPayment.id,
        metadata: {
          studentId: input.studentId,
          totalAmount,
          allocations: enrichedAllocations,
          receiptNumber,
          paymentMode,
        } as object,
      },
    });

    // Write to unified financial transaction ledger (single source of truth)
    await tx.financialTransaction.create({
      data: {
        collegeId: student.collegeId,
        voucherNo: receiptNumber,
        type: FinancialTxnType.CREDIT,
        amount: totalAmount,
        mode: paymentMode,
        source: FinancialTxnSource.FEES,
        studentId: input.studentId,
        remarks: description,
        date: paidAt,
        createdBy: actorUserId ?? null,
      },
    });

    return {
      receiptNumber,
      totalAmount,
      paymentMode,
      paidAt: paidAt.toISOString(),
      allocations: enrichedAllocations,
      student: {
        name: student.candidateName,
        admissionNo: student.admissionCode ?? `#${student.admissionNumber}`,
        college: student.college.name,
        course: latestAdmission?.course.name ?? null,
        session: latestAdmission?.session
          ? `${latestAdmission.session.label} (${latestAdmission.session.startYear}–${latestAdmission.session.endYear})`
          : null,
      },
    };
  });

  return result;
}
