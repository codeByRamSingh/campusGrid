import { Router } from "express";
import { body } from "express-validator";
import * as FinanceService from "../../services/finance.service.js";
import { buildCashLedger } from "../../services/reporting.service.js";
import { getLedgerBalance, runConsistencyCheck } from "../../services/ledger.service.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import {
  canAccessCollege,
  getScopedCollegeId,
  requirePermission,
  type AuthenticatedRequest,
} from "../../middleware/auth.js";
import { handleValidation } from "../../middleware/validate.js";

export const ledgerRouter = Router();

// ─── GET /finance/cash-ledger ─────────────────────────────────────────────────

ledgerRouter.get(
  "/finance/cash-ledger",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.college_id as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Cannot access another college's cash ledger" });
        return;
      }
      if (!scopedCollegeId) {
        res.status(400).json({ message: "college_id is required" });
        return;
      }

      const startRaw = req.query.start_date as string | undefined;
      const endRaw = req.query.end_date as string | undefined;

      const startDate = startRaw ? new Date(`${startRaw}T00:00:00.000Z`) : undefined;
      const endDate = endRaw ? new Date(`${endRaw}T23:59:59.999Z`) : undefined;

      if (startDate && Number.isNaN(startDate.getTime())) {
        res.status(400).json({ message: "Invalid start_date format. Expected YYYY-MM-DD" });
        return;
      }
      if (endDate && Number.isNaN(endDate.getTime())) {
        res.status(400).json({ message: "Invalid end_date format. Expected YYYY-MM-DD" });
        return;
      }

      const result = await buildCashLedger(prisma, { collegeId: scopedCollegeId, startDate, endDate });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /finance/ledger ──────────────────────────────────────────────────────

ledgerRouter.get(
  "/finance/ledger",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Cannot access another college's ledger" });
        return;
      }

      const period = (((req.query.period as string | undefined) || "monthly") as "daily" | "weekly" | "monthly" | "quarterly" | "yearly");
      const summary = await FinanceService.getLedgerSummary(scopedCollegeId, period);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /finance/fine-policies/:collegeId ────────────────────────────────────

ledgerRouter.get(
  "/finance/fine-policies/:collegeId",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.params.collegeId)) {
        res.status(403).json({ message: "Cannot access another college's fine policy" });
        return;
      }

      const policy = await FinanceService.getFinePolicy(req.params.collegeId);
      res.json(
        policy ?? {
          collegeId: req.params.collegeId,
          defaultFineAmount: 0,
          daysBrackets: [],
        },
      );
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /finance/fine-policies/:collegeId ────────────────────────────────────

ledgerRouter.put(
  "/finance/fine-policies/:collegeId",
  requirePermission("FINANCE_APPROVE"),
  [body("defaultFineAmount").isFloat({ min: 0 }), body("daysBrackets").optional().isArray()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.params.collegeId)) {
        res.status(403).json({ message: "Cannot update another college's fine policy" });
        return;
      }

      const policy = await FinanceService.upsertFinePolicy(
        {
          collegeId: req.params.collegeId,
          defaultFineAmount: req.body.defaultFineAmount,
          daysBrackets: req.body.daysBrackets,
        },
        req.user?.id,
      );

      res.json(policy);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── GET /finance/fee-demand-cycles ───────────────────────────────────────────

ledgerRouter.get(
  "/finance/fee-demand-cycles",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const studentId = req.query.studentId as string | undefined;
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Cannot access another college's data" });
        return;
      }

      if (!studentId && !scopedCollegeId) {
        res.status(400).json({ message: "Either studentId or collegeId query parameter is required" });
        return;
      }

      const cycles = await FinanceService.listFeeDemandCycles({
        studentId,
        collegeId: scopedCollegeId,
      });
      res.json(cycles);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PATCH /finance/fee-demand-cycles/:cycleId ────────────────────────────────

ledgerRouter.patch(
  "/finance/fee-demand-cycles/:cycleId",
  requirePermission("FINANCE_WRITE"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const cycle = await FinanceService.getFeeDemandCycleForCollegeCheck(req.params.cycleId);
      if (!cycle) {
        res.status(404).json({ message: "Fee demand cycle not found" });
        return;
      }
      if (!canAccessCollege(req, cycle.collegeId)) {
        res.status(403).json({ message: "Cannot update another college's data" });
        return;
      }

      const updated = await FinanceService.updateFeeDemandCycle(req.params.cycleId, {
        status: req.body.status,
        paidAmount: req.body.paidAmount,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── GET /finance/ledger-balance ──────────────────────────────────────────────
// Phase 3: authoritative balance derived from FinancialTransaction only.

ledgerRouter.get(
  "/finance/ledger-balance",
  requirePermission("FINANCE_READ"),
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

      const balance = await getLedgerBalance(scopedCollegeId);
      res.json({ collegeId: scopedCollegeId, balance, source: "FinancialTransaction" });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /finance/consistency-check ──────────────────────────────────────────
// Phase 2/3: compares module-level totals vs ledger totals; returns orphan counts.
// Requires FINANCE_APPROVE so only finance managers / super-admins can run it.

ledgerRouter.get(
  "/finance/consistency-check",
  requirePermission("FINANCE_APPROVE"),
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

      const report = await runConsistencyCheck(scopedCollegeId);
      const isClean =
        report.missingExpenseLedger === 0 &&
        report.missingPayrollLedger === 0 &&
        report.missingFeeCollectionLedger === 0 &&
        report.missingPaymentReversalLedger === 0 &&
        report.drift < 0.01;

      res.json({
        collegeId: scopedCollegeId,
        status: isClean ? "CLEAN" : "DRIFT_DETECTED",
        ...report,
        recommendation: isClean
          ? "Ledger is consistent. No action required."
          : "Run the backfill script (prisma/backfill-ledger.ts) to populate missing entries.",
      });
    } catch (err) {
      next(err);
    }
  },
);
