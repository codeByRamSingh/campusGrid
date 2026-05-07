import { AdmissionWorkflowStatus, Prisma, PrismaClient } from "@prisma/client";

type ReportScope = {
  collegeId?: string;
  courseId?: string;
  sessionId?: string;
};

type LedgerPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

type DemandCycleSnapshot = {
  key: string;
  dueDate: Date;
  amount: number;
  collected: number;
  balance: number;
};

function getCourseDurationYears(startYear?: number | null, endYear?: number | null) {
  if (!startYear || !endYear) {
    return 1;
  }

  return Math.max(1, endYear - startYear);
}

function buildDemandCycles(totalPayable: number, feePaid: number, startYear?: number | null, endYear?: number | null): DemandCycleSnapshot[] {
  const durationYears = getCourseDurationYears(startYear, endYear);
  const cycleCount = Math.max(2, durationYears * 2);
  const perCycleAmount = Math.round(((totalPayable || 0) / cycleCount) * 100) / 100;
  const rows: DemandCycleSnapshot[] = [];
  let remainingConfigured = Math.max(0, Number(totalPayable || 0));
  let remainingPaid = Math.max(0, Number(feePaid || 0));

  for (let index = 0; index < cycleCount; index += 1) {
    const isLastCycle = index === cycleCount - 1;
    const amount = isLastCycle ? Math.round(remainingConfigured * 100) / 100 : Math.min(remainingConfigured, perCycleAmount);
    remainingConfigured = Math.max(0, Math.round((remainingConfigured - amount) * 100) / 100);

    const collected = Math.min(remainingPaid, amount);
    remainingPaid = Math.max(0, Math.round((remainingPaid - collected) * 100) / 100);

    const dueDate = new Date((startYear ?? new Date().getFullYear()), 5 + index * 6, 15);
    rows.push({
      key: `CYCLE_${index + 1}`,
      dueDate,
      amount,
      collected,
      balance: Math.max(0, Math.round((amount - collected) * 100) / 100),
    });
  }

  return rows;
}

function classifyDemandStatus(cycles: DemandCycleSnapshot[], now: Date) {
  const overdueCycles = cycles.filter((cycle) => cycle.balance > 0 && cycle.dueDate <= now);
  const firstOpenCycle = cycles.find((cycle) => cycle.balance > 0) ?? null;
  const earliestOutstandingCycle = overdueCycles[0] ?? firstOpenCycle;
  const currentCyclePartiallyPaid = Boolean(firstOpenCycle && firstOpenCycle.collected > 0 && firstOpenCycle.balance > 0);

  const category = overdueCycles.length >= 3 ? "DEFAULTER" : overdueCycles.length >= 2 ? "OVERDUE" : firstOpenCycle ? "DUE" : "CLEAR";
  const anchorDate = earliestOutstandingCycle?.dueDate ?? now;
  const daysOutstanding = Math.max(0, Math.floor((now.getTime() - anchorDate.getTime()) / (1000 * 60 * 60 * 24)));

  return {
    category,
    currentCyclePartiallyPaid,
    daysOutstanding,
    overdueCycles,
  };
}

function getPeriodWindow(period: LedgerPeriod): { startDate: Date; endDate: Date } {
  const now = new Date();
  const endDate = new Date(now);
  const startDate = new Date(now);

  if (period === "daily") {
    startDate.setHours(0, 0, 0, 0);
  } else if (period === "weekly") {
    startDate.setDate(now.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === "monthly") {
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === "quarterly") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    startDate.setMonth(quarterStartMonth, 1);
    startDate.setHours(0, 0, 0, 0);
  } else {
    startDate.setMonth(0, 1);
    startDate.setHours(0, 0, 0, 0);
  }

  return { startDate, endDate };
}

function buildStudentScope(scope: ReportScope) {
  return {
    ...(scope.collegeId ? { collegeId: scope.collegeId } : {}),
    ...(scope.courseId || scope.sessionId
      ? {
          admissions: {
            some: {
              ...(scope.courseId ? { courseId: scope.courseId } : {}),
              ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
            },
          },
        }
      : {}),
  };
}

function buildAdmissionScope(scope: ReportScope) {
  return {
    ...(scope.collegeId ? { collegeId: scope.collegeId } : {}),
    ...(scope.courseId ? { courseId: scope.courseId } : {}),
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
  };
}

export async function buildDuesReport(prisma: PrismaClient, scope: ReportScope = {}) {
  const students = await prisma.student.findMany({
    where: {
      isSoftDeleted: false,
      ...buildStudentScope(scope),
    },
    select: {
      id: true,
      candidateName: true,
      totalPayable: true,
      collegeId: true,
      admissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          session: {
            select: {
              startYear: true,
              endYear: true,
            },
          },
        },
      },
      payments: {
        select: {
          amount: true,
          paymentType: true,
        },
      },
    },
  });

  return students.map((student) => {
    const paid = student.payments
      .filter((payment) => payment.paymentType === "FEE_COLLECTION")
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const fines = student.payments
      .filter((payment) => payment.paymentType === "FINE")
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const due = Math.max(0, Number(student.totalPayable) - paid + fines);
    const latestSession = student.admissions[0]?.session;
    const cycles = buildDemandCycles(Number(student.totalPayable), paid, latestSession?.startYear, latestSession?.endYear);
    const classification = classifyDemandStatus(cycles, new Date());

    return {
      studentId: student.id,
      candidateName: student.candidateName,
      collegeId: student.collegeId,
      totalPayable: Number(student.totalPayable),
      paid,
      fines,
      due,
      category: classification.category,
      currentCyclePartiallyPaid: classification.currentCyclePartiallyPaid,
    };
  }).filter((row) => row.due > 0);
}

export async function buildReceivablesAgingReport(prisma: PrismaClient, scope: ReportScope = {}) {
  const now = new Date();
  const students = await prisma.student.findMany({
    where: {
      isSoftDeleted: false,
      ...buildStudentScope(scope),
    },
    select: {
      id: true,
      candidateName: true,
      admissionNumber: true,
      admissionCode: true,
      createdAt: true,
      totalPayable: true,
      admissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          session: {
            select: {
              startYear: true,
              endYear: true,
            },
          },
        },
      },
      payments: {
        where: { paymentType: { in: ["FEE_COLLECTION", "FINE"] } },
        select: {
          amount: true,
          paymentType: true,
          paidAt: true,
        },
      },
    },
  });

  const rows = students
    .map((student) => {
      const paid = student.payments
        .filter((payment) => payment.paymentType === "FEE_COLLECTION")
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
      const fines = student.payments
        .filter((payment) => payment.paymentType === "FINE")
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
      const due = Math.max(0, Number(student.totalPayable) - paid + fines);
      const latestSession = student.admissions[0]?.session;
      const cycles = buildDemandCycles(Number(student.totalPayable), paid, latestSession?.startYear, latestSession?.endYear);
      const classification = classifyDemandStatus(cycles, now);

      return {
        studentId: student.id,
        admissionNumber: student.admissionNumber,
        admissionCode: student.admissionCode,
        candidateName: student.candidateName,
        due,
        daysOutstanding: classification.daysOutstanding,
        category: classification.category,
      };
    })
    .filter((row) => row.due > 0)
    .sort((left, right) => right.due - left.due);

  const bucketTemplate = {
    "0-30": { label: "0-30", count: 0, amount: 0 },
    "31-60": { label: "31-60", count: 0, amount: 0 },
    "61-90": { label: "61-90", count: 0, amount: 0 },
    "90+": { label: "90+", count: 0, amount: 0 },
  };

  for (const row of rows) {
    const bucketKey = row.daysOutstanding <= 30 ? "0-30" : row.daysOutstanding <= 60 ? "31-60" : row.daysOutstanding <= 90 ? "61-90" : "90+";
    bucketTemplate[bucketKey].count += 1;
    bucketTemplate[bucketKey].amount += row.due;
  }

  return {
    buckets: Object.values(bucketTemplate),
    defaulters: rows.filter((row) => row.category === "DEFAULTER").slice(0, 20),
  };
}

/**
 * Phase 3 — Ledger-driven summary.
 *
 * Primary source: FinancialTransaction (the single source of truth for all new
 * transactions written after the Phase 2 enforcement layer was deployed).
 *
 * Legacy fallback: for records that existed before the FinancialTransaction
 * table was populated we continue to read from the originating module tables
 * (Payment, Credit, Expense, Payroll) with NOT-EXISTS deduplication so totals
 * are never double-counted.
 *
 * For SUPER_ADMIN multi-college views (collegeId = undefined) we fall back to
 * the legacy aggregate-only approach since parameterized raw SQL requires a
 * fixed collegeId.
 */
export async function buildLedgerSummary(
  prisma: PrismaClient,
  input: { period: LedgerPeriod; collegeId?: string }
) {
  const { startDate, endDate } = getPeriodWindow(input.period);

  // ── Multi-college fallback (SUPER_ADMIN) ─────────────────────────────────
  if (!input.collegeId) {
    const [feeCollection, miscCredits, expenses, payroll] = await Promise.all([
      prisma.payment.aggregate({
        where: { paymentType: { in: ["FEE_COLLECTION", "MISC_CREDIT"] }, paidAt: { gte: startDate, lte: endDate } },
        _sum: { amount: true },
      }),
      prisma.credit.aggregate({ where: { createdAt: { gte: startDate, lte: endDate } }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { spentOn: { gte: startDate, lte: endDate } }, _sum: { amount: true } }),
      prisma.payroll.aggregate({ where: { paidAt: { gte: startDate, lte: endDate } }, _sum: { amount: true } }),
    ]);

    const totalFeeDeposit = Number(feeCollection._sum.amount || 0);
    const totalMiscCredits = Number(miscCredits._sum.amount || 0);
    const totalExpenses = Number(expenses._sum.amount || 0);
    const totalPayroll = Number(payroll._sum.amount || 0);
    const closingBalance = totalFeeDeposit + totalMiscCredits - totalExpenses - totalPayroll;
    return {
      period: input.period, startDate: startDate.toISOString(), endDate: endDate.toISOString(),
      openingBalance: 0, totalFeeDeposit, totalMiscCredits, totalExpenses, totalPayroll, closingBalance,
      formula: "Closing Balance = (Fee Deposit + Misc Credits) - (Expenses + Payroll)",
      source: "legacy_aggregate",
    };
  }

  // ── Single-college: FinancialTransaction as primary source ───────────────
  const collegeId = input.collegeId;

  type SummaryRow = {
    total_fee_credit: string;
    total_misc_credit: string;
    total_expense_debit: string;
    total_salary_debit: string;
    total_petty_net: string;
  };

  const [summaryRows, openingRows] = await Promise.all([
    // ─ Period totals (unified, deduplicated) ─────────────────────────────
    prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN side = 'FEE_CREDIT'     THEN amount END), 0)::text AS total_fee_credit,
        COALESCE(SUM(CASE WHEN side = 'MISC_CREDIT'    THEN amount END), 0)::text AS total_misc_credit,
        COALESCE(SUM(CASE WHEN side = 'EXPENSE_DEBIT'  THEN amount END), 0)::text AS total_expense_debit,
        COALESCE(SUM(CASE WHEN side = 'SALARY_DEBIT'   THEN amount END), 0)::text AS total_salary_debit,
        COALESCE(SUM(CASE WHEN side = 'PETTY_NET'      THEN amount END), 0)::text AS total_petty_net
      FROM (
        -- FinancialTransaction FEES (fee collections)
        SELECT ft.amount::numeric AS amount, 'FEE_CREDIT' AS side
        FROM "FinancialTransaction" ft
        WHERE ft."collegeId" = ${collegeId} AND ft.source = 'FEES' AND ft.type = 'CREDIT'
          AND ft."isReversed" = false AND ft.date >= ${startDate} AND ft.date <= ${endDate}

        UNION ALL
        -- FinancialTransaction MISC / ADJUSTMENT credits
        SELECT ft.amount::numeric, 'MISC_CREDIT'
        FROM "FinancialTransaction" ft
        WHERE ft."collegeId" = ${collegeId} AND ft.source IN ('MISC','ADJUSTMENT') AND ft.type = 'CREDIT'
          AND ft."isReversed" = false AND ft.date >= ${startDate} AND ft.date <= ${endDate}

        UNION ALL
        -- FinancialTransaction EXPENSE debits
        SELECT ft.amount::numeric, 'EXPENSE_DEBIT'
        FROM "FinancialTransaction" ft
        WHERE ft."collegeId" = ${collegeId} AND ft.source = 'EXPENSE' AND ft.type = 'DEBIT'
          AND ft.date >= ${startDate} AND ft.date <= ${endDate}

        UNION ALL
        -- FinancialTransaction SALARY debits
        SELECT ft.amount::numeric, 'SALARY_DEBIT'
        FROM "FinancialTransaction" ft
        WHERE ft."collegeId" = ${collegeId} AND ft.source = 'SALARY' AND ft.type = 'DEBIT'
          AND ft.date >= ${startDate} AND ft.date <= ${endDate}

        UNION ALL
        -- FinancialTransaction PETTY_CASH net (credit - debit)
        SELECT
          CASE WHEN ft.type = 'CREDIT' THEN ft.amount::numeric ELSE -ft.amount::numeric END, 'PETTY_NET'
        FROM "FinancialTransaction" ft
        WHERE ft."collegeId" = ${collegeId} AND ft.source = 'PETTY_CASH'
          AND ft.date >= ${startDate} AND ft.date <= ${endDate}

        UNION ALL
        -- Legacy Payment FEE_COLLECTION not yet in FinancialTransaction
        SELECT p.amount::numeric, 'FEE_CREDIT'
        FROM "Payment" p
        WHERE p."collegeId" = ${collegeId} AND p."paymentType" = 'FEE_COLLECTION'
          AND p."paidAt" >= ${startDate} AND p."paidAt" <= ${endDate}
          AND NOT EXISTS (SELECT 1 FROM "PaymentReversal" pr WHERE pr."paymentId" = p.id)
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft2
            WHERE ft2."voucherNo" = p."receiptNumber" AND ft2.source = 'FEES'
          )

        UNION ALL
        -- Legacy Payment MISC_CREDIT not yet in FinancialTransaction
        SELECT p.amount::numeric, 'MISC_CREDIT'
        FROM "Payment" p
        WHERE p."collegeId" = ${collegeId} AND p."paymentType" = 'MISC_CREDIT'
          AND p."paidAt" >= ${startDate} AND p."paidAt" <= ${endDate}
          AND NOT EXISTS (SELECT 1 FROM "PaymentReversal" pr WHERE pr."paymentId" = p.id)
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft2
            WHERE ft2."voucherNo" = p."receiptNumber" AND ft2.source = 'MISC'
          )

        UNION ALL
        -- Legacy Credit table
        SELECT c.amount::numeric, 'MISC_CREDIT'
        FROM "Credit" c
        WHERE c."collegeId" = ${collegeId}
          AND c."createdAt" >= ${startDate} AND c."createdAt" <= ${endDate}

        UNION ALL
        -- Legacy Expense not yet in FinancialTransaction
        SELECT e.amount::numeric, 'EXPENSE_DEBIT'
        FROM "Expense" e
        WHERE e."collegeId" = ${collegeId} AND e."approvalStatus" = 'APPROVED'
          AND e."spentOn" >= ${startDate} AND e."spentOn" <= ${endDate}
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft3
            WHERE ft3."referenceNo" = e.id AND ft3.source = 'EXPENSE'
          )

        UNION ALL
        -- Legacy Payroll not yet in FinancialTransaction
        SELECT py."netAmount"::numeric, 'SALARY_DEBIT'
        FROM "Payroll" py
        JOIN "Staff" s ON py."staffId" = s.id
        WHERE s."collegeId" = ${collegeId} AND py.status = 'PAID'
          AND py."paidAt" >= ${startDate} AND py."paidAt" <= ${endDate}
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft4
            WHERE ft4."referenceNo" = py.id AND ft4.source = 'SALARY'
          )
      ) unified
    `),

    // ─ Opening balance (everything before startDate) ─────────────────────
    prisma.$queryRaw<Array<{ opening_balance: string }>>(Prisma.sql`
      SELECT COALESCE(SUM(
        CASE WHEN src = 'CREDIT' THEN amt ELSE -amt END
      ), 0)::text AS opening_balance
      FROM (
        SELECT ft.amount::numeric AS amt,
               CASE WHEN ft.type = 'CREDIT' THEN 'CREDIT' ELSE 'DEBIT' END AS src
        FROM "FinancialTransaction" ft
        WHERE ft."collegeId" = ${collegeId} AND ft."isReversed" = false
          AND ft.date < ${startDate}

        UNION ALL
        SELECT p.amount::numeric, 'CREDIT'
        FROM "Payment" p
        WHERE p."collegeId" = ${collegeId}
          AND p."paymentType" IN ('FEE_COLLECTION','MISC_CREDIT')
          AND p."paidAt" < ${startDate}
          AND NOT EXISTS (SELECT 1 FROM "PaymentReversal" pr WHERE pr."paymentId" = p.id)
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft2
            WHERE ft2."voucherNo" = p."receiptNumber" AND ft2.source IN ('FEES','MISC')
          )

        UNION ALL
        SELECT c.amount::numeric, 'CREDIT'
        FROM "Credit" c
        WHERE c."collegeId" = ${collegeId} AND c."createdAt" < ${startDate}

        UNION ALL
        SELECT e.amount::numeric, 'DEBIT'
        FROM "Expense" e
        WHERE e."collegeId" = ${collegeId} AND e."approvalStatus" = 'APPROVED'
          AND e."spentOn" < ${startDate}
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft3
            WHERE ft3."referenceNo" = e.id AND ft3.source = 'EXPENSE'
          )

        UNION ALL
        SELECT py."netAmount"::numeric, 'DEBIT'
        FROM "Payroll" py
        JOIN "Staff" s ON py."staffId" = s.id
        WHERE s."collegeId" = ${collegeId} AND py.status = 'PAID'
          AND py."paidAt" < ${startDate}
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft4
            WHERE ft4."referenceNo" = py.id AND ft4.source = 'SALARY'
          )
      ) legacy
    `),
  ]);

  const row = summaryRows[0];
  const openingBalance = parseFloat(openingRows[0]?.opening_balance ?? "0");
  const totalFeeDeposit  = parseFloat(row?.total_fee_credit    ?? "0");
  const totalMiscCredits = parseFloat(row?.total_misc_credit   ?? "0");
  const totalExpenses    = parseFloat(row?.total_expense_debit ?? "0");
  const totalPayroll     = parseFloat(row?.total_salary_debit  ?? "0");
  const closingBalance   = openingBalance + totalFeeDeposit + totalMiscCredits - totalExpenses - totalPayroll;

  return {
    period: input.period,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    openingBalance,
    totalFeeDeposit,
    totalMiscCredits,
    totalExpenses,
    totalPayroll,
    closingBalance,
    formula: "Closing Balance = Opening + (Fee Deposit + Misc Credits) − (Expenses + Payroll)",
    source: "ledger_driven",
  };
}

// ─── Cash Ledger ─────────────────────────────────────────────────────────────

export type CashLedgerTransaction = {
  id: string;
  date: string;
  voucher_no: string;
  particulars: string;
  party: string | null;
  receipt_no: string | null;
  debit: number;
  credit: number;
  mode: string;
  running_balance: number;
  remarks: string | null;
  source_module: string;
  is_reversed: boolean;
};

export type CashLedgerResponse = {
  opening_balance: number;
  transactions: CashLedgerTransaction[];
  closing_balance: number;
  total_credit: number;
  total_debit: number;
};

export async function buildCashLedger(
  prisma: PrismaClient,
  input: { collegeId: string; startDate?: Date; endDate?: Date }
): Promise<CashLedgerResponse> {
  const { collegeId } = input;
  // Default: start of current financial year (April 1) to end of day today
  const now = new Date();
  const fyStart = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1, 0, 0, 0, 0);
  const startDate = input.startDate ?? fyStart;
  const endDate = input.endDate ?? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Opening balance: sum of all transactions before startDate
  type OpeningRow = { opening_balance: string };
  const openingRows = await prisma.$queryRaw<OpeningRow[]>(
    Prisma.sql`
      SELECT COALESCE(
        SUM(CASE WHEN src = 'CREDIT' THEN amt ELSE -amt END),
        0
      )::text AS opening_balance
      FROM (
        -- FinancialTransaction: FEES, MISC, PETTY_CASH, REVERSAL (unified ledger)
        SELECT
          ft.amount::numeric AS amt,
          CASE WHEN ft."type" = 'CREDIT' THEN 'CREDIT' ELSE 'DEBIT' END AS src
        FROM "FinancialTransaction" ft
        WHERE ft."collegeId" = ${collegeId}
          AND ft."source" IN ('FEES', 'MISC', 'PETTY_CASH', 'EXPENSE', 'SALARY', 'ADJUSTMENT', 'REVERSAL')
          AND ft."date" < ${startDate}
        UNION ALL
        -- Legacy fee payments (Payment table, only for entries WITHOUT a FinancialTransaction counterpart)
        SELECT p.amount::numeric AS amt, 'CREDIT' AS src
        FROM "Payment" p
        WHERE p."collegeId" = ${collegeId}
          AND p."paymentType" IN ('FINE')
          AND p."paidAt" < ${startDate}
          AND NOT EXISTS (
            SELECT 1 FROM "PaymentReversal" pr WHERE pr."paymentId" = p.id
          )
        UNION ALL
        -- Legacy FEE_COLLECTION + MISC_CREDIT from Payment table (pre-FinancialTransaction migration)
        SELECT p.amount::numeric AS amt, 'CREDIT' AS src
        FROM "Payment" p
        WHERE p."collegeId" = ${collegeId}
          AND p."paymentType" IN ('FEE_COLLECTION', 'MISC_CREDIT')
          AND p."paidAt" < ${startDate}
          AND NOT EXISTS (
            SELECT 1 FROM "PaymentReversal" pr WHERE pr."paymentId" = p.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft2
            WHERE ft2."voucherNo" = p."receiptNumber"
              AND ft2."source" IN ('FEES', 'MISC')
          )
        UNION ALL
        -- Legacy misc credits (Credit table — pre-FinancialTransaction era)
        SELECT c.amount::numeric AS amt, 'CREDIT' AS src
        FROM "Credit" c
        WHERE c."collegeId" = ${collegeId}
          AND c."createdAt" < ${startDate}
        UNION ALL
        -- Legacy approved expenses (not yet in FinancialTransaction)
        SELECT e.amount::numeric AS amt, 'DEBIT' AS src
        FROM "Expense" e
        WHERE e."collegeId" = ${collegeId}
          AND e."approvalStatus" = 'APPROVED'
          AND e."spentOn" < ${startDate}
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft5
            WHERE ft5."referenceNo" = e.id AND ft5.source = 'EXPENSE'
          )
        UNION ALL
        -- Legacy paid payroll (not yet in FinancialTransaction)
        SELECT py."netAmount"::numeric AS amt, 'DEBIT' AS src
        FROM "Payroll" py
        JOIN "Staff" s ON py."staffId" = s.id
        WHERE s."collegeId" = ${collegeId}
          AND py.status = 'PAID'
          AND py."paidAt" < ${startDate}
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft6
            WHERE ft6."referenceNo" = py.id AND ft6.source = 'SALARY'
          )
        UNION ALL
        -- Legacy fee payment reversals (not yet in FinancialTransaction as REVERSAL)
        SELECT p2.amount::numeric AS amt, 'DEBIT' AS src
        FROM "PaymentReversal" pr2
        JOIN "Payment" p2 ON pr2."paymentId" = p2.id
        WHERE p2."collegeId" = ${collegeId}
          AND pr2."reversedAt" < ${startDate}
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft7
            WHERE ft7."referenceNo" = p2.id AND ft7.source = 'REVERSAL'
          )
      ) sub
    `
  );
  const openingBalance = parseFloat(openingRows[0]?.opening_balance ?? "0");

  // Transactions in date range with running balance (window function)
  type TxnRow = {
    id: string;
    txn_date: Date;
    voucher_no: string;
    particulars: string;
    party: string | null;
    receipt_no: string | null;
    debit: string;
    credit: string;
    mode: string;
    remarks: string | null;
    source_module: string;
    is_reversed: boolean;
    running_balance: string;
  };

  const openingBalanceDecimal = new Prisma.Decimal(openingBalance);

  const rawTxns = await prisma.$queryRaw<TxnRow[]>(
    Prisma.sql`
      WITH base AS (
        -- FinancialTransaction: FEES (fee collections via unified ledger)
        SELECT
          ft.id::text                                                        AS id,
          ft."date"                                                          AS txn_date,
          ft."voucherNo"                                                     AS voucher_no,
          COALESCE(ft.remarks, 'Fee Received')                               AS particulars,
          (
            SELECT s2."candidateName" || ' (' ||
                   COALESCE(s2."admissionCode", '#' || s2."admissionNumber"::text) || ')'
            FROM "Student" s2 WHERE s2.id = ft."studentId"
          )                                                                  AS party,
          ft."voucherNo"                                                     AS receipt_no,
          0::numeric                                                         AS debit,
          ft.amount::numeric                                                 AS credit,
          ft.mode                                                            AS mode,
          ft.remarks                                                         AS remarks,
          'FEES'                                                             AS source_module,
          ft."isReversed"                                                    AS is_reversed
        FROM "FinancialTransaction" ft
        WHERE ft."collegeId" = ${collegeId}
          AND ft."source" = 'FEES'
          AND ft."type" = 'CREDIT'
          AND ft."date" >= ${startDate}
          AND ft."date" <= ${endDate}

        UNION ALL

        -- Fine payments (still in Payment table — not yet in FinancialTransaction)
        SELECT
          p.id::text                                                         AS id,
          p."paidAt"                                                         AS txn_date,
          p."receiptNumber"                                                  AS voucher_no,
          'Fine Collected'                                                   AS particulars,
          COALESCE(
            s."candidateName" || ' (' ||
            COALESCE(s."admissionCode", '#' || s."admissionNumber"::text) || ')',
            'Unknown'
          )                                                                  AS party,
          p."receiptNumber"                                                  AS receipt_no,
          0::numeric                                                         AS debit,
          p.amount::numeric                                                  AS credit,
          COALESCE(p."paymentMode", 'CASH')                                  AS mode,
          p.description                                                      AS remarks,
          'FEES'                                                             AS source_module,
          false                                                              AS is_reversed
        FROM "Payment" p
        LEFT JOIN "Student" s ON p."studentId" = s.id
        WHERE p."collegeId" = ${collegeId}
          AND p."paymentType" = 'FINE'
          AND p."paidAt" >= ${startDate}
          AND p."paidAt" <= ${endDate}
          AND NOT EXISTS (
            SELECT 1 FROM "PaymentReversal" pr WHERE pr."paymentId" = p.id
          )

        UNION ALL

        -- Legacy fee collections (Payment table, for entries that pre-date the FinancialTransaction migration)
        SELECT
          p.id::text                                                         AS id,
          p."paidAt"                                                         AS txn_date,
          p."receiptNumber"                                                  AS voucher_no,
          CASE
            WHEN p."paymentType" = 'MISC_CREDIT' THEN 'Misc Credit'
            ELSE 'Fee Received'
          END                                                                AS particulars,
          COALESCE(
            s."candidateName" || ' (' ||
            COALESCE(s."admissionCode", '#' || s."admissionNumber"::text) || ')',
            'Unknown'
          )                                                                  AS party,
          p."receiptNumber"                                                  AS receipt_no,
          0::numeric                                                         AS debit,
          p.amount::numeric                                                  AS credit,
          COALESCE(p."paymentMode", 'CASH')                                  AS mode,
          p.description                                                      AS remarks,
          'FEES'                                                             AS source_module,
          false                                                              AS is_reversed
        FROM "Payment" p
        LEFT JOIN "Student" s ON p."studentId" = s.id
        WHERE p."collegeId" = ${collegeId}
          AND p."paymentType" IN ('FEE_COLLECTION', 'MISC_CREDIT')
          AND p."paidAt" >= ${startDate}
          AND p."paidAt" <= ${endDate}
          AND NOT EXISTS (
            SELECT 1 FROM "PaymentReversal" pr WHERE pr."paymentId" = p.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft2
            WHERE ft2."voucherNo" = p."receiptNumber"
              AND ft2."source" IN ('FEES', 'MISC')
          )

        UNION ALL

        -- Legacy Misc Credits table (pre-FinancialTransaction records only)
        SELECT
          c.id::text                                                         AS id,
          c."createdAt"                                                      AS txn_date,
          ('MISC-' || UPPER(LEFT(c.id::text, 8)))                           AS voucher_no,
          ('Misc Income: ' || c.source)                                     AS particulars,
          NULL::text                                                         AS party,
          NULL::text                                                         AS receipt_no,
          0::numeric                                                         AS debit,
          c.amount::numeric                                                  AS credit,
          'BANK'                                                             AS mode,
          c.notes                                                            AS remarks,
          'ADJUSTMENT'                                                       AS source_module,
          false                                                              AS is_reversed
        FROM "Credit" c
        WHERE c."collegeId" = ${collegeId}
          AND c."createdAt" >= ${startDate}
          AND c."createdAt" <= ${endDate}

        UNION ALL

        -- FinancialTransaction: non-FEES entries (MISC, PETTY_CASH, REVERSAL, EXPENSE, SALARY, ADJUSTMENT)
        SELECT
          ft.id::text                                                        AS id,
          ft."date"                                                          AS txn_date,
          ft."voucherNo"                                                     AS voucher_no,
          CASE ft."source"
            WHEN 'MISC'       THEN COALESCE(ft.remarks, 'Misc Credit')
            WHEN 'PETTY_CASH' THEN COALESCE(ft.remarks, 'Petty Cash')
            WHEN 'REVERSAL'   THEN COALESCE(ft.remarks, 'Reversal')
            WHEN 'EXPENSE'    THEN COALESCE(ft.remarks, 'Expense')
            WHEN 'SALARY'     THEN COALESCE(ft.remarks, 'Salary Payment')
            ELSE COALESCE(ft.remarks, ft."source"::text)
          END                                                                AS particulars,
          CASE ft."source"
            WHEN 'EXPENSE' THEN (
              SELECT COALESCE(e."vendorName", v.name, e.description)
              FROM "Expense" e LEFT JOIN "Vendor" v ON e."vendorId" = v.id
              WHERE e.id = ft."referenceNo"
            )
            WHEN 'SALARY' THEN (
              SELECT s."fullName"
              FROM "Payroll" py JOIN "Staff" s ON py."staffId" = s.id
              WHERE py.id = ft."referenceNo"
            )
            ELSE NULL::text
          END                                                                AS party,
          NULL::text                                                         AS receipt_no,
          CASE WHEN ft."type" = 'DEBIT'  THEN ft.amount::numeric ELSE 0::numeric END AS debit,
          CASE WHEN ft."type" = 'CREDIT' THEN ft.amount::numeric ELSE 0::numeric END AS credit,
          ft.mode                                                            AS mode,
          ft.remarks                                                         AS remarks,
          ft."source"::text                                                  AS source_module,
          ft."isReversed"                                                    AS is_reversed
        FROM "FinancialTransaction" ft
        WHERE ft."collegeId" = ${collegeId}
          AND ft."source" IN ('MISC', 'PETTY_CASH', 'REVERSAL', 'EXPENSE', 'SALARY', 'ADJUSTMENT')
          AND ft."date" >= ${startDate}
          AND ft."date" <= ${endDate}

        UNION ALL

        -- Legacy Expenses (DEBIT) — only for records NOT yet in FinancialTransaction
        SELECT
          e.id::text                                                         AS id,
          e."spentOn"                                                        AS txn_date,
          ('EXP-' || UPPER(LEFT(e.id::text, 8)))                            AS voucher_no,
          (e.category || COALESCE(': ' || e.subcategory, ''))               AS particulars,
          COALESCE(e."vendorName", v.name, e.description)                   AS party,
          NULL::text                                                         AS receipt_no,
          e.amount::numeric                                                  AS debit,
          0::numeric                                                         AS credit,
          COALESCE(e."paymentSource", 'BANK')                               AS mode,
          COALESCE(e.notes, e.description)                                   AS remarks,
          'EXPENSE'                                                          AS source_module,
          false                                                              AS is_reversed
        FROM "Expense" e
        LEFT JOIN "Vendor" v ON e."vendorId" = v.id
        WHERE e."collegeId" = ${collegeId}
          AND e."approvalStatus" = 'APPROVED'
          AND e."spentOn" >= ${startDate}
          AND e."spentOn" <= ${endDate}
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft5
            WHERE ft5."referenceNo" = e.id AND ft5.source = 'EXPENSE'
          )

        UNION ALL

        -- Legacy Payroll (DEBIT) — only for paid payroll NOT yet in FinancialTransaction
        SELECT
          py.id::text                                                        AS id,
          COALESCE(py."paidAt", NOW())                                       AS txn_date,
          ('SAL-' || UPPER(LEFT(py.id::text, 8)))                           AS voucher_no,
          ('Salary ' || py.month::text || '/' || py.year::text)             AS particulars,
          s."fullName"                                                       AS party,
          NULL::text                                                         AS receipt_no,
          py."netAmount"::numeric                                            AS debit,
          0::numeric                                                         AS credit,
          'BANK_TRANSFER'                                                    AS mode,
          ('Salary ' || py.month::text || '/' || py.year::text)             AS remarks,
          'SALARY'                                                           AS source_module,
          false                                                              AS is_reversed
        FROM "Payroll" py
        JOIN "Staff" s ON py."staffId" = s.id
        WHERE s."collegeId" = ${collegeId}
          AND py.status = 'PAID'
          AND py."paidAt" >= ${startDate}
          AND py."paidAt" <= ${endDate}
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft6
            WHERE ft6."referenceNo" = py.id AND ft6.source = 'SALARY'
          )

        UNION ALL

        -- Legacy Payment Reversals (DEBIT) — only for reversals NOT yet in FinancialTransaction
        SELECT
          pr.id::text                                                        AS id,
          pr."reversedAt"                                                    AS txn_date,
          ('REV-' || UPPER(LEFT(pr.id::text, 8)))                           AS voucher_no,
          'Payment Reversal'                                                 AS particulars,
          COALESCE(s2."candidateName", 'Unknown')                           AS party,
          p2."receiptNumber"                                                 AS receipt_no,
          p2.amount::numeric                                                 AS debit,
          0::numeric                                                         AS credit,
          COALESCE(p2."paymentMode", 'CASH')                                AS mode,
          pr.reason                                                          AS remarks,
          'REVERSAL'                                                         AS source_module,
          true                                                               AS is_reversed
        FROM "PaymentReversal" pr
        JOIN  "Payment" p2 ON pr."paymentId" = p2.id
        LEFT JOIN "Student" s2 ON p2."studentId" = s2.id
        WHERE p2."collegeId" = ${collegeId}
          AND pr."reversedAt" >= ${startDate}
          AND pr."reversedAt" <= ${endDate}
          AND NOT EXISTS (
            SELECT 1 FROM "FinancialTransaction" ft7
            WHERE ft7."referenceNo" = p2.id AND ft7.source = 'REVERSAL'
          )
      )
      SELECT
        id,
        txn_date,
        voucher_no,
        particulars,
        party,
        receipt_no,
        debit::text,
        credit::text,
        mode,
        remarks,
        source_module,
        is_reversed,
        (${openingBalanceDecimal} + SUM(credit - debit) OVER (
          ORDER BY txn_date, id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ))::text AS running_balance
      FROM base
      ORDER BY txn_date, id
    `
  );

  const transactions: CashLedgerTransaction[] = rawTxns.map((t) => ({
    id: t.id,
    date: new Date(t.txn_date).toISOString().slice(0, 10),
    voucher_no: t.voucher_no,
    particulars: t.particulars,
    party: t.party,
    receipt_no: t.receipt_no,
    debit: parseFloat(t.debit),
    credit: parseFloat(t.credit),
    mode: t.mode,
    running_balance: parseFloat(t.running_balance),
    remarks: t.remarks,
    source_module: t.source_module,
    is_reversed: t.is_reversed,
  }));

  const totalCredit = transactions.reduce((s, t) => s + t.credit, 0);
  const totalDebit = transactions.reduce((s, t) => s + t.debit, 0);
  const closingBalance = transactions.length > 0
    ? transactions[transactions.length - 1].running_balance
    : openingBalance;

  return {
    opening_balance: openingBalance,
    transactions,
    closing_balance: closingBalance,
    total_credit: totalCredit,
    total_debit: totalDebit,
  };
}

// ─── Dashboard Summary ────────────────────────────────────────────────────────

export async function buildDashboardSummary(prisma: PrismaClient, scope: ReportScope = {}) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const studentScope = buildStudentScope(scope);
  const admissionScope = buildAdmissionScope(scope);

  const [duesReport, agingReport, admissions, students, colleges, staff, payrollRows, pendingLeaves, feeExceptions, recentFeeSubmissions] = await Promise.all([
    buildDuesReport(prisma, scope),
    buildReceivablesAgingReport(prisma, scope),
    prisma.admission.findMany({
      where: admissionScope,
      select: {
        id: true,
        collegeId: true,
        courseId: true,
        sessionId: true,
        workflowStatus: true,
        createdAt: true,
      },
    }),
    prisma.student.findMany({
      where: {
        isSoftDeleted: false,
        ...studentScope,
      },
      select: {
        id: true,
        collegeId: true,
        totalPayable: true,
        createdAt: true,
        status: true,
      },
    }),
    prisma.college.findMany({
      where: scope.collegeId ? { id: scope.collegeId } : {},
      include: {
        courses: {
          include: {
            sessions: true,
          },
        },
      },
    }),
    prisma.staff.findMany({
      where: {
        isActive: true,
        ...(scope.collegeId ? { collegeId: scope.collegeId } : {}),
      },
      select: { id: true, collegeId: true, fullName: true },
    }),
    prisma.payroll.findMany({
      where: {
        month: currentMonth,
        year: currentYear,
        ...(scope.collegeId ? { staff: { collegeId: scope.collegeId } } : {}),
      },
      select: { staffId: true, amount: true, month: true, year: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: "PENDING",
        ...(scope.collegeId ? { staff: { collegeId: scope.collegeId } } : {}),
      },
      select: { id: true },
    }),
    prisma.feeCollectionException.findMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        ...(scope.collegeId ? { collegeId: scope.collegeId } : {}),
      },
      select: { id: true, collegeId: true },
    }),
    prisma.feeReceipt.findMany({
      where: {
        student: {
          isSoftDeleted: false,
          ...buildStudentScope(scope),
        },
      },
      orderBy: { collectedAt: "desc" },
      take: 100,
      select: {
        id: true,
        receiptNumber: true,
        cycleLabel: true,
        totalReceived: true,
        collectedAt: true,
        student: {
          select: {
            id: true,
            candidateName: true,
            admissionCode: true,
            admissionNumber: true,
            college: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const totalFeeCollected = duesReport.reduce((sum, row) => sum + row.paid, 0);
  const outstandingFees = duesReport.reduce((sum, row) => sum + row.due, 0);
  const totalPayable = duesReport.reduce((sum, row) => sum + row.totalPayable, 0);
  const collectionRate = totalPayable > 0 ? (totalFeeCollected / totalPayable) * 100 : 0;

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const currentAdmissions = admissions.filter((admission) => admission.createdAt >= thirtyDaysAgo).length;
  const previousAdmissions = admissions.filter((admission) => admission.createdAt >= sixtyDaysAgo && admission.createdAt < thirtyDaysAgo).length;
  const admissionTrend = previousAdmissions > 0 ? ((currentAdmissions - previousAdmissions) / previousAdmissions) * 100 : currentAdmissions > 0 ? 100 : 0;

  const payrollCost = payrollRows.reduce((sum, row) => sum + Number(row.amount), 0);
  const staffStrength = staff.length;
  const payrollStaffIds = new Set(payrollRows.map((row) => row.staffId));
  const payrollExceptions = staff.filter((member) => !payrollStaffIds.has(member.id)).length;
  const pendingAdmissionStatuses: AdmissionWorkflowStatus[] = [
    AdmissionWorkflowStatus.SUBMITTED,
    AdmissionWorkflowStatus.DOCUMENTS_VERIFIED,
    AdmissionWorkflowStatus.FEE_VERIFIED,
    AdmissionWorkflowStatus.PENDING_APPROVAL,
    AdmissionWorkflowStatus.CHANGES_REQUESTED,
  ];
  const admissionsAwaitingApproval = admissions.filter((admission) =>
    pendingAdmissionStatuses.includes(admission.workflowStatus)
  ).length;
  const complianceAlerts = admissionsAwaitingApproval + pendingLeaves.length + payrollExceptions + feeExceptions.length;

  const totalSeats = colleges
    .flatMap((college) => college.courses)
    .flatMap((course) => course.sessions)
    .reduce((sum, session) => sum + Number(session.seatCount ?? 0), 0);
  const activeStudents = students.filter((student) => student.status === "ACTIVE").length;
  const seatUtilization = totalSeats > 0 ? (activeStudents / totalSeats) * 100 : 0;

  const duesByCollege = new Map<string, { billed: number; collected: number; outstanding: number; admissions: number }>();
  for (const row of duesReport) {
    const current = duesByCollege.get(row.collegeId) ?? { billed: 0, collected: 0, outstanding: 0, admissions: 0 };
    current.billed += row.totalPayable;
    current.collected += row.paid;
    current.outstanding += row.due;
    current.admissions += 1;
    duesByCollege.set(row.collegeId, current);
  }

  const collectionByCollege = colleges.map((college) => {
    const totals = duesByCollege.get(college.id) ?? { billed: 0, collected: 0, outstanding: 0, admissions: 0 };
    return {
      collegeId: college.id,
      college: college.name,
      billed: totals.billed,
      collected: totals.collected,
      outstanding: totals.outstanding,
      collectionPct: totals.billed > 0 ? (totals.collected / totals.billed) * 100 : 0,
      admissions: totals.admissions,
    };
  });

  const submittedCount = admissions.filter((admission) => admission.workflowStatus === AdmissionWorkflowStatus.SUBMITTED).length;
  const documentsVerifiedCount = admissions.filter((admission) => admission.workflowStatus === AdmissionWorkflowStatus.DOCUMENTS_VERIFIED).length;
  const feeVerifiedCount = admissions.filter((admission) => admission.workflowStatus === AdmissionWorkflowStatus.FEE_VERIFIED).length;
  const pendingApprovalCount = admissions.filter((admission) => admission.workflowStatus === AdmissionWorkflowStatus.PENDING_APPROVAL).length;
  const approvedCount = admissions.filter((admission) => admission.workflowStatus === AdmissionWorkflowStatus.APPROVED).length;
  const pipelineBase = Math.max(admissions.length, 1);

  return {
    kpis: {
      totalFeeCollected,
      outstandingFees,
      collectionRate,
      newAdmissions: currentAdmissions,
      admissionTrend,
      payrollCost,
      staffStrength,
      complianceAlerts,
      seatUtilization,
      activeStudents,
      totalSeats,
    },
    collectionByCollege,
    admissionsPipeline: [
      { stage: "Submitted", value: submittedCount, conversionPct: Math.round((submittedCount / pipelineBase) * 100) },
      { stage: "Documents Verified", value: documentsVerifiedCount, conversionPct: Math.round((documentsVerifiedCount / pipelineBase) * 100) },
      { stage: "Fee Verified", value: feeVerifiedCount, conversionPct: Math.round((feeVerifiedCount / pipelineBase) * 100) },
      { stage: "Pending Approval", value: pendingApprovalCount, conversionPct: Math.round((pendingApprovalCount / pipelineBase) * 100) },
      { stage: "Approved", value: approvedCount, conversionPct: Math.round((approvedCount / pipelineBase) * 100) },
    ],
    receivablesAging: agingReport,
    recentFeeSubmissions: recentFeeSubmissions.map((receipt) => ({
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      cycleLabel: receipt.cycleLabel,
      amount: Number(receipt.totalReceived),
      collectedAt: receipt.collectedAt.toISOString(),
      studentId: receipt.student.id,
      candidateName: receipt.student.candidateName,
      admissionRef: receipt.student.admissionCode ?? `#${receipt.student.admissionNumber}`,
      college: receipt.student.college.name,
    })),
    liveIndicators: {
      admissionsAwaitingApproval,
      payrollExceptions,
      pendingLeaves: pendingLeaves.length,
      feeExceptions: feeExceptions.length,
      previousAdmissions,
    },
  };
}
