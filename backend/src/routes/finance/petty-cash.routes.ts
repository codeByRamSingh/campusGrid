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

export const pettyCashRouter = Router();

// ─── GET /finance/petty-cash ──────────────────────────────────────────────────

pettyCashRouter.get(
  "/finance/petty-cash",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      const entries = await FinanceService.listPettyCash(scopedCollegeId);
      res.json(entries);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /finance/petty-cash ─────────────────────────────────────────────────

pettyCashRouter.post(
  "/finance/petty-cash",
  requirePermission("FINANCE_WRITE"),
  [
    body("collegeId").notEmpty(),
    body("entryType").isIn(["ALLOCATION", "EXPENSE", "REIMBURSEMENT"]),
    body("amount").isFloat({ gt: 0 }),
    body("description").notEmpty(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.body.collegeId as string)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const entry = await FinanceService.createPettyCashEntry(
        {
          collegeId: req.body.collegeId,
          entryType: req.body.entryType,
          amount: req.body.amount,
          description: req.body.description,
          reference: req.body.reference,
        },
        req.user?.id,
      );

      res.status(201).json(entry);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);
