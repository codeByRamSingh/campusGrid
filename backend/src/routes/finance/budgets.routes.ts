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

export const budgetsRouter = Router();

// ─── GET /finance/budgets ─────────────────────────────────────────────────────

budgetsRouter.get(
  "/finance/budgets",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const budgets = await FinanceService.listBudgets(
        scopedCollegeId,
        req.query.financialYear as string | undefined,
      );
      res.json(budgets);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /finance/budgets ────────────────────────────────────────────────────

budgetsRouter.post(
  "/finance/budgets",
  requirePermission("FINANCE_APPROVE"),
  [
    body("collegeId").notEmpty(),
    body("category").notEmpty(),
    body("allocatedAmount").isFloat({ gt: 0 }),
    body("financialYear").notEmpty(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.body.collegeId as string)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const budget = await FinanceService.upsertBudget(
        {
          collegeId: req.body.collegeId,
          category: req.body.category,
          subcategory: req.body.subcategory,
          allocatedAmount: req.body.allocatedAmount,
          financialYear: req.body.financialYear,
          description: req.body.description,
        },
        req.user?.id,
      );

      res.status(201).json(budget);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── DELETE /finance/budgets/:id ──────────────────────────────────────────────

budgetsRouter.delete(
  "/finance/budgets/:id",
  requirePermission("FINANCE_APPROVE"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const budget = await FinanceService.getBudgetForCollegeCheck(req.params.id);
      if (!budget) {
        res.status(404).json({ message: "Budget not found" });
        return;
      }
      if (!canAccessCollege(req, budget.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      await FinanceService.deleteBudget(req.params.id);
      res.json({ message: "Budget deleted" });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── GET /finance/recurring-expenses ──────────────────────────────────────────

budgetsRouter.get(
  "/finance/recurring-expenses",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      const items = await FinanceService.listRecurringExpenses(scopedCollegeId);
      res.json(items);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /finance/recurring-expenses ─────────────────────────────────────────

budgetsRouter.post(
  "/finance/recurring-expenses",
  requirePermission("FINANCE_WRITE"),
  [
    body("collegeId").notEmpty(),
    body("title").notEmpty(),
    body("category").notEmpty(),
    body("amount").isFloat({ gt: 0 }),
    body("frequency").notEmpty(),
    body("nextDueDate").isISO8601(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.body.collegeId as string)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const item = await FinanceService.createRecurringExpense(req.body, req.user?.id);
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── PATCH /finance/recurring-expenses/:id ────────────────────────────────────

budgetsRouter.patch(
  "/finance/recurring-expenses/:id",
  requirePermission("FINANCE_WRITE"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const item = await FinanceService.getRecurringExpenseForCollegeCheck(req.params.id);
      if (!item) {
        res.status(404).json({ message: "Not found" });
        return;
      }
      if (!canAccessCollege(req, item.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const updated = await FinanceService.updateRecurringExpense(req.params.id, req.body, req.user?.id);
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

// ─── DELETE /finance/recurring-expenses/:id ───────────────────────────────────

budgetsRouter.delete(
  "/finance/recurring-expenses/:id",
  requirePermission("FINANCE_WRITE"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const item = await FinanceService.getRecurringExpenseForCollegeCheck(req.params.id);
      if (!item) {
        res.status(404).json({ message: "Not found" });
        return;
      }
      if (!canAccessCollege(req, item.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      await FinanceService.deleteRecurringExpense(req.params.id);
      res.json({ message: "Deleted" });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── POST /finance/recurring-expenses/:id/post ────────────────────────────────
// Materialises a recurring expense template as a PENDING Expense record so it
// can be reviewed in the Approvals queue and — once approved — writes to the
// unified cash ledger.

budgetsRouter.post(
  "/finance/recurring-expenses/:id/post",
  requirePermission("FINANCE_WRITE"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const item = await FinanceService.getRecurringExpenseForCollegeCheck(req.params.id);
      if (!item) {
        res.status(404).json({ message: "Recurring expense not found" });
        return;
      }
      if (!canAccessCollege(req, item.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const expense = await FinanceService.postRecurringExpense(req.params.id, req.user?.id);
      res.status(201).json(expense);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);
