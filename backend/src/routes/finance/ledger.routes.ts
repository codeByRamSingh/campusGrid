import { Router } from "express";
import { body } from "express-validator";
import * as FinanceService from "../../services/finance.service.js";
import { AppError } from "../../lib/errors.js";
import {
  canAccessCollege,
  getScopedCollegeId,
  requirePermission,
  type AuthenticatedRequest,
} from "../../middleware/auth.js";
import { handleValidation } from "../../middleware/validate.js";

export const ledgerRouter = Router();

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
