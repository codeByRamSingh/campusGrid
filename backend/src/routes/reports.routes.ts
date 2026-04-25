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

  const expenses = await prisma.expense.findMany({
    where: scopedCollegeId ? { collegeId: scopedCollegeId } : {},
    orderBy: { spentOn: "desc" },
    take: 200,
  });

  res.json(expenses);
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
