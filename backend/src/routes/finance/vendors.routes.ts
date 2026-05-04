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

export const vendorsRouter = Router();

// ─── GET /finance/vendors ─────────────────────────────────────────────────────

vendorsRouter.get(
  "/finance/vendors",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
      if (scopedCollegeId === "__FORBIDDEN__") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      const vendors = await FinanceService.listVendors(scopedCollegeId);
      res.json(vendors);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /finance/vendors ────────────────────────────────────────────────────

vendorsRouter.post(
  "/finance/vendors",
  requirePermission("FINANCE_WRITE"),
  [body("collegeId").notEmpty(), body("name").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.body.collegeId as string)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const vendor = await FinanceService.createVendor(req.body, req.user?.id);
      res.status(201).json(vendor);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);

// ─── PATCH /finance/vendors/:id ───────────────────────────────────────────────

vendorsRouter.patch(
  "/finance/vendors/:id",
  requirePermission("FINANCE_WRITE"),
  [body("name").optional().notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const vendor = await FinanceService.getVendorForCollegeCheck(req.params.id);
      if (!vendor) {
        res.status(404).json({ message: "Vendor not found" });
        return;
      }
      if (!canAccessCollege(req, vendor.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const updated = await FinanceService.updateVendor(req.params.id, req.body, req.user?.id);
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

// ─── GET /finance/vendors/:vendorId/payments ──────────────────────────────────

vendorsRouter.get(
  "/finance/vendors/:vendorId/payments",
  requirePermission("FINANCE_READ"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const vendor = await FinanceService.getVendorForCollegeCheck(req.params.vendorId);
      if (!vendor) {
        res.status(404).json({ message: "Vendor not found" });
        return;
      }
      if (!canAccessCollege(req, vendor.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const payments = await FinanceService.listVendorPayments(req.params.vendorId);
      res.json(payments);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /finance/vendors/:vendorId/payments ─────────────────────────────────

vendorsRouter.post(
  "/finance/vendors/:vendorId/payments",
  requirePermission("FINANCE_WRITE"),
  [
    body("amount").isFloat({ gt: 0 }),
    body("description").notEmpty(),
    body("paymentMode").optional().isString(),
    body("referenceNumber").optional().isString(),
    body("expenseId").optional().isString(),
    body("paidAt").optional().isISO8601(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const vendor = await FinanceService.getVendorForCollegeCheck(req.params.vendorId);
      if (!vendor) {
        res.status(404).json({ message: "Vendor not found" });
        return;
      }
      if (!canAccessCollege(req, vendor.collegeId)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const payment = await FinanceService.createVendorPayment(
        {
          vendorId: req.params.vendorId,
          amount: req.body.amount,
          description: req.body.description,
          paymentMode: req.body.paymentMode,
          referenceNumber: req.body.referenceNumber,
          expenseId: req.body.expenseId,
          paidAt: req.body.paidAt,
        },
        req.user?.id,
      );

      res.status(201).json(payment);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    }
  },
);
