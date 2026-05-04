import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { createRateLimitMiddleware } from "../../lib/rate-limit.js";
import { collectionsRouter } from "./collections.routes.js";
import { expensesRouter } from "./expenses.routes.js";
import { vendorsRouter } from "./vendors.routes.js";
import { budgetsRouter } from "./budgets.routes.js";
import { pettyCashRouter } from "./petty-cash.routes.js";
import { ledgerRouter } from "./ledger.routes.js";

export const financeRouter = Router();

// All finance routes require authentication
financeRouter.use(authenticate);

// Shared rate limit for finance API
financeRouter.use(
  createRateLimitMiddleware({
    scope: "finance-api",
    windowMs: 60 * 1000,
    max: Number(process.env.FINANCE_API_RATE_LIMIT_MAX ?? 180),
    message: "Too many finance API requests. Please retry in a minute.",
    key: (req) => req.user?.id ?? req.ip,
  }),
);

// Mount domain subrouters — all paths remain under /finance/*
financeRouter.use(collectionsRouter);
financeRouter.use(expensesRouter);
financeRouter.use(vendorsRouter);
financeRouter.use(budgetsRouter);
financeRouter.use(pettyCashRouter);
financeRouter.use(ledgerRouter);
