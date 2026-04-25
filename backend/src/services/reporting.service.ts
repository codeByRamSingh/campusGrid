import { AdmissionWorkflowStatus, PrismaClient } from "@prisma/client";

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

export async function buildLedgerSummary(
  prisma: PrismaClient,
  input: { period: LedgerPeriod; collegeId?: string }
) {
  const { startDate, endDate } = getPeriodWindow(input.period);
  const collegeFilter = input.collegeId ? { collegeId: input.collegeId } : {};

  const [feeCollection, miscCredits, expenses, payroll] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        ...collegeFilter,
        paymentType: { in: ["FEE_COLLECTION", "MISC_CREDIT"] },
        paidAt: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    }),
    prisma.credit.aggregate({
      where: {
        ...collegeFilter,
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: {
        ...collegeFilter,
        spentOn: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    }),
    prisma.payroll.aggregate({
      where: {
        ...(input.collegeId ? { staff: { collegeId: input.collegeId } } : {}),
        paidAt: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    }),
  ]);

  const openingBalance = 0;
  const totalFeeDeposit = Number(feeCollection._sum.amount || 0);
  const totalMiscCredits = Number(miscCredits._sum.amount || 0);
  const totalExpenses = Number(expenses._sum.amount || 0);
  const totalPayroll = Number(payroll._sum.amount || 0);
  const closingBalance = openingBalance + totalFeeDeposit + totalMiscCredits - (totalExpenses + totalPayroll);

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
    formula:
      "Closing Balance = (Opening balance + Total Fee Deposit + Misc Credits) - (Total Expenses + Total Payroll)",
  };
}

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
