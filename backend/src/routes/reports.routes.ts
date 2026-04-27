import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate, getScopedCollegeId, requirePermission } from "../middleware/auth.js";
import {
  buildDashboardSummary,
  buildDuesReport,
  buildLedgerSummary,
  buildReceivablesAgingReport,
} from "../services/reporting.service.js";

export const reportsRouter = Router();

reportsRouter.get("/reports/expenses", authenticate, requirePermission("REPORTS_READ"), async (req, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's reports" });
    return;
  }

  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(Number(req.query.limit || 100), 500);

  const expenses = await prisma.expense.findMany({
    where: {
      ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
      ...(startDate || endDate
        ? {
            spentOn: {
              ...(startDate ? { gte: new Date(startDate) } : {}),
              ...(endDate ? { lte: new Date(endDate) } : {}),
            },
          }
        : {}),
    },
    orderBy: { spentOn: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = expenses.length > limit;
  const page = hasMore ? expenses.slice(0, limit) : expenses;
  const nextCursor = hasMore ? page[page.length - 1].id : undefined;

  res.json({ data: page, nextCursor, hasMore });
});

reportsRouter.get("/reports/dues-fines", authenticate, requirePermission("REPORTS_READ"), async (req, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's reports" });
    return;
  }

  const report = await buildDuesReport(prisma, { collegeId: scopedCollegeId });
  res.json(report);
});

reportsRouter.get("/reports/receivables-aging", authenticate, requirePermission("REPORTS_READ"), async (req, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's reports" });
    return;
  }

  const report = await buildReceivablesAgingReport(prisma, { collegeId: scopedCollegeId });
  res.json(report);
});

reportsRouter.get("/reports/ledger-summary", authenticate, requirePermission("REPORTS_READ"), async (req, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's reports" });
    return;
  }

  const period = ((req.query.period as string | undefined) || "monthly") as
    | "daily"
    | "weekly"
    | "monthly"
    | "quarterly"
    | "yearly";

  const summary = await buildLedgerSummary(prisma, { collegeId: scopedCollegeId, period });
  res.json(summary);
});

reportsRouter.get("/reports/dashboard-summary", authenticate, requirePermission("REPORTS_READ"), async (req, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's reports" });
    return;
  }

  const summary = await buildDashboardSummary(prisma, {
    collegeId: scopedCollegeId,
    courseId: req.query.courseId as string | undefined,
    sessionId: req.query.sessionId as string | undefined,
  });
  res.json(summary);
});

// GET /reports/payroll-summary?month=&year=&collegeId=
reportsRouter.get("/reports/payroll-summary", authenticate, requirePermission("REPORTS_READ"), async (req, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's reports" });
    return;
  }

  const month = req.query.month ? Number(req.query.month) : undefined;
  const year = req.query.year ? Number(req.query.year) : undefined;

  if ((month !== undefined && (isNaN(month) || month < 1 || month > 12)) ||
      (year !== undefined && (isNaN(year) || year < 2000 || year > 2100))) {
    res.status(400).json({ message: "Invalid month or year" });
    return;
  }

  const payrolls = await prisma.payroll.findMany({
    where: {
      ...(month !== undefined ? { month } : {}),
      ...(year !== undefined ? { year } : {}),
      staff: scopedCollegeId ? { collegeId: scopedCollegeId } : undefined,
    },
    include: {
      staff: { select: { id: true, fullName: true, role: true, collegeId: true } },
    },
  });

  const totalGross = payrolls.reduce((sum, p) => sum + Number(p.amount), 0);
  const paidCount = payrolls.filter((p) => p.status === "PAID").length;
  const pendingCount = payrolls.filter((p) => p.status === "PROCESSED").length;

  const byStaff = payrolls.map((p) => ({
    staffId: p.staff.id,
    fullName: p.staff.fullName,
    role: p.staff.role,
    amount: Number(p.amount),
    status: p.status,
    month: p.month,
    year: p.year,
    paidAt: p.paidAt,
  }));

  res.json({
    summary: { totalGross, paidCount, pendingCount, total: payrolls.length },
    records: byStaff,
  });
});
