import { Router } from "express";
import { body } from "express-validator";
import * as FinanceService from "../../services/finance.service.js";
import { AppError } from "../../lib/errors.js";
import { canAccessCollege, requirePermission, type AuthenticatedRequest } from "../../middleware/auth.js";
import { handleValidation } from "../../middleware/validate.js";

// ─── GET /finance/students/:studentId/dues ────────────────────────────────────

export const collectionsRouter = Router();

collectionsRouter.get(
  "/finance/students/:studentId/dues",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const student = await FinanceService.loadStudentForFinance(req.params.studentId);
      if (!canAccessCollege(req, student.collegeId)) {
        res.status(403).json({ message: "Cannot access another college's student data" });
        return;
      }
      const dues = await FinanceService.getStudentDues(req.params.studentId);
      res.json(dues);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── POST /finance/fee-collections/allocate ───────────────────────────────────

collectionsRouter.post(
  "/finance/fee-collections/allocate",
  requirePermission("FINANCE_WRITE"),
  [
    body("studentId").notEmpty(),
    body("paymentMode").isIn(["CASH", "UPI", "BANK"]),
    body("paymentDate").optional().isISO8601(),
    body("reference").optional().isString(),
    body("notes").optional().isString(),
    body("allocations").isArray({ min: 1 }),
    body("allocations.*.cycleKey").notEmpty().isString(),
    body("allocations.*.amount").isFloat({ gt: 0 }),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const student = await FinanceService.loadStudentForFinance(req.body.studentId);
      if (!canAccessCollege(req, student.collegeId)) {
        res.status(403).json({ message: "Cannot collect fees for another college" });
        return;
      }
      const result = await FinanceService.collectFeeAllocated(
        {
          studentId: req.body.studentId,
          paymentMode: req.body.paymentMode,
          paymentDate: req.body.paymentDate ?? null,
          notes: req.body.notes ?? null,
          reference: req.body.reference ?? null,
          allocations: req.body.allocations,
        },
        req.user?.email,
        req.user?.id,
      );
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      console.error(err);
      res.status(500).json({ message: "Unable to process payment right now" });
    }
  },
);

// ─── POST /finance/fee-collections ────────────────────────────────────────────

collectionsRouter.post(
  "/finance/fee-collections",
  requirePermission("FINANCE_WRITE"),
  [
    body("studentId").notEmpty(),
    body("amount").isFloat({ gt: 0 }),
    body("description").notEmpty(),
    body("dueCycle").optional().isString(),
    body("lateFine").optional().isNumeric(),
    body("exceptionRequestId").optional().isString(),
    body("paymentMode").optional().isIn(["CASH", "UPI", "BANK", "CHEQUE"]),
    body("reference").optional().isString(),
    body("postingDate").optional().isISO8601(),
    body("collectedBy").optional().isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const student = await FinanceService.loadStudentForFinance(req.body.studentId);
      if (!canAccessCollege(req, student.collegeId)) {
        res.status(403).json({ message: "Cannot collect fees for another college" });
        return;
      }

      const payment = await FinanceService.collectFee(
        {
          studentId: req.body.studentId,
          amount: Number(req.body.amount),
          description: req.body.description,
          dueCycle: req.body.dueCycle,
          lateFine: req.body.lateFine,
          exceptionRequestId: req.body.exceptionRequestId,
          paymentMode: req.body.paymentMode,
          reference: req.body.reference,
          postingDate: req.body.postingDate,
          collectedBy: req.body.collectedBy,
          idempotencyKey: req.header("x-idempotency-key") || null,
        },
        req.user?.email,
        req.user?.id,
      );

      res.status(201).json(payment);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      console.error(err);
      res.status(500).json({ message: "Unable to collect fee right now" });
    }
  },
);

// ─── POST /finance/fee-collections/drafts ─────────────────────────────────────

collectionsRouter.post(
  "/finance/fee-collections/drafts",
  requirePermission("FINANCE_WRITE"),
  [
    body("studentId").notEmpty(),
    body("amount").isFloat({ gt: 0 }),
    body("dueCycle").optional().isString(),
    body("lateFine").optional().isNumeric(),
    body("paymentMode").optional().isIn(["CASH", "UPI", "BANK", "CHEQUE"]),
    body("reference").optional().isString(),
    body("postingDate").optional().isISO8601(),
    body("collectedBy").optional().isString(),
    body("notes").optional().isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const student = await FinanceService.loadStudentForFinance(req.body.studentId);
      if (!canAccessCollege(req, student.collegeId)) {
        res.status(403).json({ message: "Cannot save drafts for another college" });
        return;
      }

      const draft = await FinanceService.createFeeDraft(
        {
          studentId: req.body.studentId,
          amount: req.body.amount,
          dueCycle: req.body.dueCycle,
          lateFine: req.body.lateFine,
          paymentMode: req.body.paymentMode,
          reference: req.body.reference,
          postingDate: req.body.postingDate,
          collectedBy: req.body.collectedBy,
          notes: req.body.notes,
        },
        req.user?.email,
        req.user?.id,
      );

      res.status(201).json(draft);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── POST /finance/fee-collections/exceptions ─────────────────────────────────

collectionsRouter.post(
  "/finance/fee-collections/exceptions",
  requirePermission("FINANCE_WRITE"),
  [
    body("studentId").notEmpty(),
    body("requestedAmount").isFloat({ gt: 0 }),
    body("remainingBalance").isFloat({ min: 0 }),
    body("reason").notEmpty(),
    body("dueCycle").optional().isString(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const student = await FinanceService.loadStudentForFinance(req.body.studentId);
      if (!canAccessCollege(req, student.collegeId)) {
        res.status(403).json({ message: "Cannot raise exceptions for another college" });
        return;
      }

      const exception = await FinanceService.createFeeException(
        {
          studentId: req.body.studentId,
          requestedAmount: req.body.requestedAmount,
          remainingBalance: req.body.remainingBalance,
          reason: req.body.reason,
          dueCycle: req.body.dueCycle,
        },
        req.user?.id,
      );

      res.status(201).json(exception);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── PATCH /finance/fee-collections/exceptions/:exceptionId/status ───────────

collectionsRouter.patch(
  "/finance/fee-collections/exceptions/:exceptionId/status",
  requirePermission("FINANCE_APPROVE"),
  [body("status").isIn(["APPROVED", "REJECTED"]), body("reviewNote").optional().isString()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const existing = await FinanceService.getExceptionForCollegeCheck(req.params.exceptionId);
      if (!existing) {
        res.status(404).json({ message: "Exception request not found" });
        return;
      }
      if (!canAccessCollege(req, existing.collegeId)) {
        res.status(403).json({ message: "Cannot review another college's exception" });
        return;
      }

      const updated = await FinanceService.reviewFeeException(
        req.params.exceptionId,
        req.body.status,
        req.body.reviewNote ?? null,
        req.user?.id,
      );

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

// ─── GET /finance/receipts/:receiptNumber ─────────────────────────────────────

collectionsRouter.get(
  "/finance/receipts/:receiptNumber",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const receipt = await FinanceService.getReceiptByNumber(req.params.receiptNumber);
      if (!canAccessCollege(req, receipt.student.collegeId)) {
        res.status(403).json({ message: "Cannot access another college's receipt" });
        return;
      }
      res.json(FinanceService.serializeReceipt(receipt));
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── GET /finance/students/:studentId/ledger ──────────────────────────────────

collectionsRouter.get(
  "/finance/students/:studentId/ledger",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const student = await FinanceService.loadStudentForFinance(req.params.studentId);
      if (!canAccessCollege(req, student.collegeId)) {
        res.status(403).json({ message: "Cannot access another college's student ledger" });
        return;
      }

      const ledger = await FinanceService.getStudentLedger(req.params.studentId);
      const { student: _ignored, ...rest } = ledger;
      void _ignored;
      res.json(rest);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── POST /finance/fines ──────────────────────────────────────────────────────

collectionsRouter.post(
  "/finance/fines",
  requirePermission("FINANCE_APPROVE"),
  [body("studentId").notEmpty(), body("amount").isFloat({ gt: 0 }), body("description").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const student = await FinanceService.loadStudentForFinance(req.body.studentId);
      if (!canAccessCollege(req, student.collegeId)) {
        res.status(403).json({ message: "Cannot charge fines for another college" });
        return;
      }

      const fine = await FinanceService.createFine(
        {
          studentId: req.body.studentId,
          amount: req.body.amount,
          description: req.body.description,
        },
        req.user?.id,
      );

      res.status(201).json(fine);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── POST /finance/payments/:paymentId/reverse ────────────────────────────────

collectionsRouter.post(
  "/finance/payments/:paymentId/reverse",
  requirePermission("FINANCE_APPROVE"),
  [body("reason").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const existing = await FinanceService.getPaymentForCollegeCheck(req.params.paymentId);
      if (!existing) {
        res.status(404).json({ message: "Payment not found" });
        return;
      }
      if (!canAccessCollege(req, existing.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const result = await FinanceService.reversePayment(req.params.paymentId, req.body.reason as string, req.user?.id);
      res.status(201).json(result.reversal);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── POST /finance/fee-collections/from-draft/:draftId ────────────────────────

collectionsRouter.post(
  "/finance/fee-collections/from-draft/:draftId",
  requirePermission("FINANCE_WRITE"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const draft = await FinanceService.getDraftForCollegeCheck(req.params.draftId);
      if (!draft) {
        res.status(404).json({ message: "Draft not found" });
        return;
      }
      if (!canAccessCollege(req, draft.student.collegeId)) {
        res.status(403).json({ message: "Cannot post drafts for another college" });
        return;
      }

      const payment = await FinanceService.postFeeCollectionFromDraft(
        req.params.draftId,
        req.user?.email,
        req.user?.id,
      );

      res.status(201).json({
        payment,
        receiptNumber: payment.receiptNumber,
        message: "Draft converted to posted payment",
      });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      console.error(err);
      res.status(500).json({ message: "Failed to post draft" });
    }
  },
);

// ─── POST /finance/misc-credits ──────────────────────────────────────────────

collectionsRouter.post(
  "/finance/misc-credits",
  requirePermission("FINANCE_WRITE"),
  [body("collegeId").notEmpty(), body("amount").isFloat({ gt: 0 }), body("source").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.body.collegeId as string)) {
        res.status(403).json({ message: "Cannot add credits to another college" });
        return;
      }

      const credit = await FinanceService.createMiscCredit(
        {
          collegeId: req.body.collegeId,
          amount: req.body.amount,
          source: req.body.source,
          notes: req.body.notes,
        },
        req.user?.id,
      );

      res.status(201).json(credit);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);
