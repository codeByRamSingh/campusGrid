import { Router } from "express";
import { body } from "express-validator";
import path from "path";
import { promises as fs } from "fs";
import * as FinanceService from "../../services/finance.service.js";
import { AppError } from "../../lib/errors.js";
import {
  canAccessCollege,
  getScopedCollegeId,
  requirePermission,
  type AuthenticatedRequest,
} from "../../middleware/auth.js";
import { handleValidation } from "../../middleware/validate.js";

export const expensesRouter = Router();

// ─── POST /finance/expenses ───────────────────────────────────────────────────

expensesRouter.post(
  "/finance/expenses",
  requirePermission("FINANCE_WRITE"),
  [
    body("collegeId").notEmpty(),
    body("amount").isFloat({ gt: 0 }),
    body("category").notEmpty(),
    body("spentOn").isISO8601(),
    body("sourceDocumentRef").optional().isString(),
    body("attachmentPath").optional().isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.body.collegeId as string)) {
        res.status(403).json({ message: "Cannot record expenses for another college" });
        return;
      }

      const expense = await FinanceService.createExpense(req.body, req.user?.id);
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

// ─── GET /finance/expenses ────────────────────────────────────────────────────

expensesRouter.get(
  "/finance/expenses",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Cannot access another college's expenses" });
        return;
      }

      const expenses = await FinanceService.listExpenses({
        collegeId: scopedCollegeId,
        status: req.query.status as string | undefined,
        category: req.query.category as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });

      res.json(expenses);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PATCH /finance/expenses/:id ──────────────────────────────────────────────

expensesRouter.patch(
  "/finance/expenses/:id",
  requirePermission("FINANCE_WRITE"),
  [
    body("amount").optional().isFloat({ gt: 0 }),
    body("category").optional().notEmpty(),
    body("sourceDocumentRef").optional().isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const expense = await FinanceService.getExpenseForCollegeCheck(req.params.id);
      if (!expense) {
        res.status(404).json({ message: "Expense not found" });
        return;
      }
      if (!canAccessCollege(req, expense.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const updated = await FinanceService.updateExpense(req.params.id, req.body, req.user?.id);
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

// ─── POST /finance/expenses/:id/approve ───────────────────────────────────────

expensesRouter.post(
  "/finance/expenses/:id/approve",
  requirePermission("FINANCE_APPROVE"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const expense = await FinanceService.getExpenseForCollegeCheck(req.params.id);
      if (!expense) {
        res.status(404).json({ message: "Expense not found" });
        return;
      }
      if (!canAccessCollege(req, expense.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const updated = await FinanceService.approveExpense(req.params.id, req.user?.id);
      res.json(updated);
    } catch (err) {
      if (err instanceof AppError) {
        const allowed = (err as AppError & { allowedCategories?: string[] }).allowedCategories;
        const body: Record<string, unknown> = { message: err.message };
        if (err.code) body.code = err.code;
        if (allowed) body.allowedCategories = allowed;
        res.status(err.status).json(body);
        return;
      }
      next(err);
    }
  },
);

// ─── POST /finance/expenses/:id/reject ────────────────────────────────────────

expensesRouter.post(
  "/finance/expenses/:id/reject",
  requirePermission("FINANCE_APPROVE"),
  [body("note").optional().isString()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const expense = await FinanceService.getExpenseForCollegeCheck(req.params.id);
      if (!expense) {
        res.status(404).json({ message: "Expense not found" });
        return;
      }
      if (!canAccessCollege(req, expense.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const updated = await FinanceService.rejectExpense(req.params.id, req.body.note ?? null, req.user?.id);
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

// ─── Attachments ──────────────────────────────────────────────────────────────

expensesRouter.post(
  "/finance/expenses/attachments/sign",
  requirePermission("FINANCE_WRITE"),
  [
    body("collegeId").notEmpty(),
    body("fileName").notEmpty(),
    body("mimeType").optional().isString(),
    body("expenseId").optional().isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const collegeId = req.body.collegeId as string;
      if (!canAccessCollege(req, collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const result = await FinanceService.signExpenseAttachmentTokens({
        collegeId,
        fileName: req.body.fileName,
        mimeType: req.body.mimeType,
        expenseId: req.body.expenseId,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

expensesRouter.post(
  "/finance/expenses/attachments/upload",
  requirePermission("FINANCE_WRITE"),
  [body("contentBase64").notEmpty().isString(), body("size").optional().isInt({ gt: 0 })],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const token = req.query.token as string | undefined;
      if (!token) {
        res.status(400).json({ message: "Missing upload token" });
        return;
      }

      const payload = FinanceService.verifyAttachmentToken(token);
      if (!payload || payload.action !== "upload") {
        res.status(401).json({ message: "Invalid or expired upload token" });
        return;
      }

      const collegeId = payload.collegeId as string;
      if (!canAccessCollege(req, collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const fileKey = payload.fileKey as string;
      const targetPath = path.resolve(FinanceService.ATTACHMENTS_ROOT, fileKey);
      if (!targetPath.startsWith(FinanceService.ATTACHMENTS_ROOT)) {
        res.status(400).json({ message: "Invalid file target" });
        return;
      }

      const contentBuffer = Buffer.from(req.body.contentBase64 as string, "base64");
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, contentBuffer);

      res.status(201).json({
        message: "Uploaded",
        attachmentPath: fileKey,
        size: contentBuffer.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

expensesRouter.get(
  "/finance/expenses/attachments/download",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const token = req.query.token as string | undefined;
      if (!token) {
        res.status(400).json({ message: "Missing download token" });
        return;
      }

      const payload = FinanceService.verifyAttachmentToken(token);
      if (!payload || payload.action !== "download") {
        res.status(401).json({ message: "Invalid or expired download token" });
        return;
      }

      const collegeId = payload.collegeId as string;
      if (!canAccessCollege(req, collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const fileKey = payload.fileKey as string;
      const targetPath = path.resolve(FinanceService.ATTACHMENTS_ROOT, fileKey);
      if (!targetPath.startsWith(FinanceService.ATTACHMENTS_ROOT)) {
        res.status(400).json({ message: "Invalid file target" });
        return;
      }

      try {
        await fs.access(targetPath);
        const fileName = path.basename(targetPath);
        res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
        res.sendFile(targetPath);
      } catch {
        res.status(404).json({ message: "Attachment not found" });
      }
    } catch (err) {
      next(err);
    }
  },
);

// ─── Reports & Audit Logs ─────────────────────────────────────────────────────

expensesRouter.get(
  "/finance/expenses/reports",
  requirePermission("REPORTS_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Cannot access another college's reports" });
        return;
      }

      const report = await FinanceService.getExpenseReport({
        collegeId: scopedCollegeId,
        from: FinanceService.optionalString(req.query.from) ?? undefined,
        to: FinanceService.optionalString(req.query.to) ?? undefined,
      });
      res.json(report);
    } catch (err) {
      next(err);
    }
  },
);

expensesRouter.get(
  "/finance/expenses/reports/export",
  requirePermission("REPORTS_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Cannot access another college's reports" });
        return;
      }

      const csv = await FinanceService.getExpenseReportCsv({
        collegeId: scopedCollegeId,
        from: FinanceService.optionalString(req.query.from) ?? undefined,
        to: FinanceService.optionalString(req.query.to) ?? undefined,
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=\"expense-report-${Date.now()}.csv\"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },
);

expensesRouter.get(
  "/finance/expenses/audit-logs",
  requirePermission("REPORTS_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Cannot access another college's logs" });
        return;
      }

      const logs = await FinanceService.getFinanceAuditLogs({
        collegeId: scopedCollegeId,
        action: FinanceService.optionalString(req.query.action) ?? undefined,
        from: FinanceService.optionalString(req.query.from) ?? undefined,
        to: FinanceService.optionalString(req.query.to) ?? undefined,
      });
      res.json(logs);
    } catch (err) {
      next(err);
    }
  },
);

expensesRouter.get(
  "/finance/expenses/audit-logs/export",
  requirePermission("REPORTS_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Cannot access another college's logs" });
        return;
      }

      const csv = await FinanceService.getFinanceAuditLogsCsv({
        collegeId: scopedCollegeId,
        action: FinanceService.optionalString(req.query.action) ?? undefined,
        from: FinanceService.optionalString(req.query.from) ?? undefined,
        to: FinanceService.optionalString(req.query.to) ?? undefined,
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=\"expense-audit-${Date.now()}.csv\"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },
);
