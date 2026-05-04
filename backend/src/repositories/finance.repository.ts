import type { PrismaClient, Prisma } from "@prisma/client";

export type CreatePaymentData = {
  collegeId: string;
  studentId: string;
  amount: number;
  paymentType: string;
  description: string;
  receiptNumber: string;
  paymentMode: string | null;
  referenceNumber: string | null;
  collectedBy: string | null;
  paidAt: Date;
};

export type CreateFeeReceiptData = {
  paymentId: string;
  studentId: string;
  receiptNumber: string;
  cycleKey: string | null;
  cycleLabel: string | null;
  amount: number;
  lateFine: number;
  totalReceived: number;
  paymentMode: string | null;
  referenceNumber: string | null;
  collectedBy: string | null;
  collectedAt: Date;
  snapshot: object;
};

export type ExpenseFilters = {
  collegeId?: string;
  cursor?: string;
  limit: number;
  status?: string;
  categoryId?: string;
  vendorId?: string;
};

export class FinanceRepository {
  constructor(private readonly db: PrismaClient) {}

  // ─── Payments ─────────────────────────────────────────────────────────────────

  async findStudentForFeeCollection(studentId: string) {
    return this.db.student.findUnique({
      where: { id: studentId },
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
    });
  }

  async findStudentBasic(studentId: string) {
    return this.db.student.findUnique({
      where: { id: studentId },
      select: { id: true, collegeId: true },
    });
  }

  async aggregateFeePaid(studentId: string) {
    const result = await this.db.payment.aggregate({
      where: { studentId, paymentType: "FEE_COLLECTION" },
      _sum: { amount: true },
    });
    return Number(result._sum.amount || 0);
  }

  async findApprovedFeeException(exceptionRequestId: string, studentId: string) {
    return this.db.feeCollectionException.findFirst({
      where: { id: exceptionRequestId, studentId, status: "APPROVED" },
    });
  }

  async findFinePolicy(collegeId: string) {
    return this.db.finePolicy.findFirst({ where: { collegeId } });
  }

  async findFinePolicyByUnique(collegeId: string) {
    return this.db.finePolicy.findUnique({ where: { collegeId } });
  }

  async upsertFinePolicy(collegeId: string, defaultFineAmount: number, daysBrackets: unknown[]) {
    return this.db.finePolicy.upsert({
      where: { collegeId },
      update: { defaultFineAmount, daysBrackets: daysBrackets as never },
      create: { collegeId, defaultFineAmount, daysBrackets: daysBrackets as never },
    });
  }

  async findDuplicatePayment(studentId: string, amount: number, paidAt: Date, referenceNumber: string | null) {
    const dayStart = new Date(paidAt.toISOString().slice(0, 10) + "T00:00:00Z");
    const dayEnd = new Date(paidAt.toISOString().slice(0, 10) + "T23:59:59Z");
    return this.db.payment.findFirst({
      where: {
        studentId,
        paymentType: "FEE_COLLECTION",
        amount,
        paidAt: { gte: dayStart, lte: dayEnd },
        ...(referenceNumber ? { referenceNumber } : {}),
      },
      select: { id: true },
    });
  }

  async createFeeCollectionTx(
    tx: Prisma.TransactionClient,
    payment: CreatePaymentData,
    receipt: Omit<CreateFeeReceiptData, "paymentId">,
    studentId: string,
    actorUserId: string | undefined,
    approvedException: { id: string; reviewNote: string | null } | null,
    metadata: Record<string, unknown>,
  ) {
    const createdPayment = await tx.payment.create({ data: { ...payment, paymentType: payment.paymentType as never } });

    await tx.feeReceipt.create({
      data: { ...receipt, paymentId: createdPayment.id },
    });

    await tx.studentTimeline.create({
      data: {
        studentId,
        title: "Fee Collected",
        details: `Amount ${payment.amount} received with receipt ${payment.receiptNumber}${receipt.cycleLabel ? ` for ${receipt.cycleLabel}` : ""}${payment.paymentMode ? ` via ${payment.paymentMode}` : ""}`,
      },
    });

    await tx.studentTimeline.create({
      data: {
        studentId,
        title: "Fee Receipt Stored",
        details: `Receipt ${payment.receiptNumber} stored in student profile${receipt.cycleLabel ? ` for ${receipt.cycleLabel}` : ""}`,
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
          studentId,
          title: "Fee Exception Resolved",
          details: `Approved exception ${approvedException.id} was resolved by receipt ${payment.receiptNumber}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "FEE_COLLECTED",
        entityType: "PAYMENT",
        entityId: createdPayment.id,
        metadata: { ...metadata, receiptNumber: payment.receiptNumber } as object,
      },
    });

    return createdPayment;
  }

  async nextReceiptSequence(
    tx: Parameters<PrismaClient["$transaction"]>[0] extends (fn: (client: infer C) => unknown) => unknown ? C : never,
    collegeId: string,
    prefix: "FEE" | "MISC" | "FINE",
  ) {
    const { nextSequenceValue } = await import("../lib/sequence.js");
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const sequence = await nextSequenceValue(tx as never, "RECEIPT", `${collegeId}:${prefix}:${today}`, 1);
    return `${prefix}-${today}-${String(sequence).padStart(5, "0")}`;
  }

  // ─── Fee Drafts ───────────────────────────────────────────────────────────────

  async createFeeDraft(data: Prisma.FeeCollectionDraftUncheckedCreateInput) {
    return this.db.feeCollectionDraft.create({ data });
  }

  async findFeeDraftWithStudent(draftId: string) {
    return this.db.feeCollectionDraft.findUnique({
      where: { id: draftId },
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
  }

  // ─── Fee Exceptions ───────────────────────────────────────────────────────────

  async createFeeException(data: Prisma.FeeCollectionExceptionUncheckedCreateInput) {
    return this.db.feeCollectionException.create({ data });
  }

  async findFeeExceptionWithCollege(exceptionId: string) {
    return this.db.feeCollectionException.findUnique({
      where: { id: exceptionId },
      select: { id: true, studentId: true, status: true, collegeId: true },
    });
  }

  // ─── Receipts ─────────────────────────────────────────────────────────────────

  async findReceiptByNumber(receiptNumber: string) {
    return this.db.feeReceipt.findUnique({
      where: { receiptNumber },
      include: {
        student: { select: { collegeId: true } },
      },
    });
  }

  // ─── Student Ledger ───────────────────────────────────────────────────────────

  async getStudentLedger(studentId: string) {
    const [payments, timeline, receipts, drafts, exceptions] = await Promise.all([
      this.db.payment.findMany({
        where: { studentId, paymentType: { in: ["FEE_COLLECTION", "FINE"] } },
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
      this.db.studentTimeline.findMany({
        where: { studentId },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, title: true, details: true, createdAt: true },
      }),
      this.db.feeReceipt.findMany({
        where: { studentId },
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
      this.db.feeCollectionDraft.findMany({
        where: { studentId, status: "DRAFT" },
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
      this.db.feeCollectionException.findMany({
        where: { studentId },
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

    return { payments, timeline, receipts, drafts, exceptions };
  }

  // ─── Expenses ─────────────────────────────────────────────────────────────────

  async findExpenseById(expenseId: string) {
    return this.db.expense.findUnique({
      where: { id: expenseId },
      include: {
        vendor: { select: { id: true, name: true, collegeId: true } },
      },
    });
  }

  async findExpenseSimple(expenseId: string) {
    return this.db.expense.findUnique({ where: { id: expenseId } });
  }

  async findExpenseByDocRef(collegeId: string, sourceDocumentRef: string, excludeId?: string) {
    return this.db.expense.findFirst({
      where: {
        collegeId,
        sourceDocumentRef,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async listExpensesFiltered(filters: {
    collegeId?: string;
    status?: string;
    category?: string;
    from?: string;
    to?: string;
  }) {
    const where: Prisma.ExpenseWhereInput = {};
    if (filters.collegeId) where.collegeId = filters.collegeId;
    if (filters.status) where.approvalStatus = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.from || filters.to) {
      where.spentOn = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    return this.db.expense.findMany({
      where,
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { spentOn: "desc" },
      take: 500,
    });
  }

  async listExpenses(filters: ExpenseFilters) {
    const where: Prisma.ExpenseWhereInput = {
      ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
      ...(filters.status ? { approvalStatus: filters.status } : {}),
      ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
    };

    const records = await this.db.expense.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: filters.limit + 1,
      ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
    });

    const hasMore = records.length > filters.limit;
    const data = records.slice(0, filters.limit);
    return { data, hasMore, nextCursor: hasMore ? data.at(-1)?.id : undefined };
  }

  async createExpense(data: Prisma.ExpenseUncheckedCreateInput) {
    return this.db.expense.create({ data });
  }

  async updateExpense(expenseId: string, data: Prisma.ExpenseUpdateInput) {
    return this.db.expense.update({ where: { id: expenseId }, data });
  }

  async aggregateExpensesByCategory(collegeId: string, category: string) {
    const result = await this.db.expense.aggregate({
      _sum: { amount: true },
      where: { collegeId, category },
    });
    return Number(result._sum.amount ?? 0);
  }

  async listExpensesForReports(filters: { collegeId?: string; from?: string; to?: string }) {
    return this.db.expense.findMany({
      where: {
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
        ...((filters.from || filters.to)
          ? {
              spentOn: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        college: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
      },
      orderBy: { spentOn: "desc" },
    });
  }

  // ─── Audit Logs ───────────────────────────────────────────────────────────────

  async listFinanceAuditLogs(filters: { action?: string; from?: string; to?: string }) {
    return this.db.auditLog.findMany({
      where: {
        entityType: { in: ["EXPENSE", "VENDOR", "BUDGET", "RECURRING_EXPENSE", "PETTY_CASH"] },
        ...(filters.action ? { action: filters.action } : {}),
        ...((filters.from || filters.to)
          ? {
              createdAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: { actor: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  // ─── Budgets ──────────────────────────────────────────────────────────────────

  async findBudget(collegeId: string, category: string, financialYear: string) {
    return this.db.budget.findFirst({
      where: { collegeId, category, financialYear },
    });
  }

  async findBudgetById(id: string) {
    return this.db.budget.findUnique({ where: { id } });
  }

  async deleteBudget(id: string) {
    return this.db.budget.delete({ where: { id } });
  }

  async upsertBudget(collegeId: string, category: string, financialYear: string, allocatedAmount: number) {
    const existing = await this.findBudget(collegeId, category, financialYear);
    if (existing) {
      return this.db.budget.update({
        where: { id: existing.id },
        data: { allocatedAmount },
      });
    }
    return this.db.budget.create({
      data: { collegeId, category, financialYear, allocatedAmount },
    });
  }

  async upsertBudgetFull(data: {
    collegeId: string;
    category: string;
    subcategory?: string | null;
    financialYear: string;
    allocatedAmount: number;
    description?: string | null;
  }) {
    return this.db.budget.upsert({
      where: {
        collegeId_category_financialYear: {
          collegeId: data.collegeId,
          category: data.category,
          financialYear: data.financialYear,
        },
      },
      update: { allocatedAmount: data.allocatedAmount, description: data.description ?? null },
      create: {
        collegeId: data.collegeId,
        category: data.category,
        subcategory: data.subcategory ?? null,
        allocatedAmount: data.allocatedAmount,
        financialYear: data.financialYear,
        description: data.description ?? null,
      },
    });
  }

  async listBudgets(collegeId?: string, financialYear?: string) {
    return this.db.budget.findMany({
      where: {
        ...(collegeId ? { collegeId } : {}),
        ...(financialYear ? { financialYear } : {}),
      },
      orderBy: [{ category: "asc" }],
    });
  }

  // ─── Vendors ─────────────────────────────────────────────────────────────────

  async findVendorById(vendorId: string) {
    return this.db.vendor.findUnique({ where: { id: vendorId } });
  }

  async findVendorCollegeId(vendorId: string) {
    return this.db.vendor.findUnique({ where: { id: vendorId }, select: { collegeId: true } });
  }

  async listVendors(collegeId?: string) {
    return this.db.vendor.findMany({
      where: collegeId ? { collegeId } : {},
      orderBy: { name: "asc" },
    });
  }

  async createVendor(data: Prisma.VendorUncheckedCreateInput) {
    return this.db.vendor.create({ data });
  }

  async updateVendor(vendorId: string, data: Prisma.VendorUpdateInput) {
    return this.db.vendor.update({ where: { id: vendorId }, data });
  }

  // ─── Vendor Payments ──────────────────────────────────────────────────────────

  async listVendorPayments(vendorId: string) {
    return this.db.vendorPayment.findMany({
      where: { vendorId },
      orderBy: { paidAt: "desc" },
      take: 100,
    });
  }

  async createVendorPayment(data: Prisma.VendorPaymentUncheckedCreateInput) {
    return this.db.vendorPayment.create({ data });
  }

  // ─── Credits ─────────────────────────────────────────────────────────────────

  async findCollegeById(collegeId: string) {
    return this.db.college.findUnique({ where: { id: collegeId } });
  }

  async listCredits(collegeId?: string) {
    return this.db.credit.findMany({
      where: collegeId ? { collegeId } : {},
      orderBy: { createdAt: "desc" },
    });
  }

  async createCredit(data: Prisma.CreditCreateInput) {
    return this.db.credit.create({ data });
  }

  // ─── Fee Collection Exceptions ────────────────────────────────────────────────

  async listFeeExceptions(collegeId?: string, studentId?: string) {
    return this.db.feeCollectionException.findMany({
      where: {
        ...(collegeId ? { student: { collegeId } } : {}),
        ...(studentId ? { studentId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findFeeException(id: string) {
    return this.db.feeCollectionException.findUnique({ where: { id } });
  }

  async updateFeeException(id: string, data: Prisma.FeeCollectionExceptionUpdateInput) {
    return this.db.feeCollectionException.update({ where: { id }, data });
  }

  // ─── Petty Cash ───────────────────────────────────────────────────────────────

  async listPettyCash(collegeId?: string) {
    return this.db.pettyCashEntry.findMany({
      where: collegeId ? { collegeId } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async createPettyCash(data: Prisma.PettyCashEntryCreateInput) {
    return this.db.pettyCashEntry.create({ data });
  }

  // ─── Recurring Expenses ───────────────────────────────────────────────────────

  async listRecurringExpenses(collegeId?: string) {
    return this.db.recurringExpense.findMany({
      where: collegeId ? { collegeId } : {},
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { nextDueDate: "asc" },
    });
  }

  async findRecurringExpenseById(id: string) {
    return this.db.recurringExpense.findUnique({ where: { id } });
  }

  async createRecurringExpense(data: Prisma.RecurringExpenseUncheckedCreateInput) {
    return this.db.recurringExpense.create({ data });
  }

  async updateRecurringExpense(id: string, data: Prisma.RecurringExpenseUpdateInput) {
    return this.db.recurringExpense.update({ where: { id }, data });
  }

  async deleteRecurringExpense(id: string) {
    return this.db.recurringExpense.delete({ where: { id } });
  }

  // ─── Payment Reversals ────────────────────────────────────────────────────────

  async findPaymentWithReversal(paymentId: string) {
    return this.db.payment.findUnique({
      where: { id: paymentId },
      include: { reversal: true },
    });
  }

  // ─── Fee Demand Cycles ────────────────────────────────────────────────────────

  async listFeeDemandCycles(filters: { studentId?: string; collegeId?: string }) {
    return this.db.feeDemandCycle.findMany({
      where: {
        ...(filters.studentId ? { studentId: filters.studentId } : {}),
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
      },
      orderBy: [{ studentId: "asc" }, { dueDate: "asc" }],
    });
  }

  async findFeeDemandCycle(id: string) {
    return this.db.feeDemandCycle.findUnique({ where: { id } });
  }

  async updateFeeDemandCycle(id: string, data: Prisma.FeeDemandCycleUpdateInput) {
    return this.db.feeDemandCycle.update({ where: { id }, data });
  }
}
