import { Router } from "express";
import { body } from "express-validator";
import { writeAuditLog } from "../lib/audit.js";
import { type AuthenticatedRequest, authenticate, requireRole, requirePermission } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";
import { prisma } from "../lib/prisma.js";

export const settingsRouter = Router();

settingsRouter.get("/settings", authenticate, async (_req, res) => {
  const [trust, appSetting] = await Promise.all([
    prisma.trust.findFirst(),
    prisma.appSetting.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
    }),
  ]);

  res.json({
    trust,
    security: {
      staffDefaultPasswordPolicy: appSetting.staffDefaultPasswordPolicy,
      authStandard: appSetting.authStandard,
    },
    localization: {
      timezone: appSetting.timezone,
      currency: appSetting.currency,
      dateFormat: appSetting.dateFormat,
    },
  });
});

settingsRouter.patch(
  "/settings",
  authenticate,
  requireRole("SUPER_ADMIN"),
  [
    body("localization.timezone").optional().isString().isLength({ min: 1, max: 100 }),
    body("localization.currency").optional().isString().isLength({ min: 1, max: 20 }),
    body("localization.dateFormat").optional().isString().isLength({ min: 1, max: 50 }),
    body("security.authStandard").optional().isString().isLength({ min: 1, max: 200 }),
    body("security.staffDefaultPasswordPolicy").optional().isString().isLength({ min: 1, max: 500 }),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const localization = (req.body.localization ?? {}) as {
      timezone?: string;
      currency?: string;
      dateFormat?: string;
    };
    const security = (req.body.security ?? {}) as {
      authStandard?: string;
      staffDefaultPasswordPolicy?: string;
    };

    const updated = await prisma.appSetting.upsert({
      where: { id: "default" },
      update: {
        ...(localization.timezone ? { timezone: localization.timezone } : {}),
        ...(localization.currency ? { currency: localization.currency } : {}),
        ...(localization.dateFormat ? { dateFormat: localization.dateFormat } : {}),
        ...(security.authStandard ? { authStandard: security.authStandard } : {}),
        ...(security.staffDefaultPasswordPolicy
          ? { staffDefaultPasswordPolicy: security.staffDefaultPasswordPolicy }
          : {}),
      },
      create: {
        id: "default",
        timezone: localization.timezone ?? "Asia/Kolkata",
        currency: localization.currency ?? "INR",
        dateFormat: localization.dateFormat ?? "DD-MM-YYYY",
        authStandard: security.authStandard ?? "JWT with role based access control",
        staffDefaultPasswordPolicy:
          security.staffDefaultPasswordPolicy ??
          "No default passwords. Staff are onboarded using one-time invite links with password setup.",
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "SETTINGS_UPDATED",
      entityType: "APP_SETTINGS",
      entityId: updated.id,
      metadata: {
        localization,
        security,
      },
    });

    res.json({
      security: {
        staffDefaultPasswordPolicy: updated.staffDefaultPasswordPolicy,
        authStandard: updated.authStandard,
      },
      localization: {
        timezone: updated.timezone,
        currency: updated.currency,
        dateFormat: updated.dateFormat,
      },
      updatedAt: updated.updatedAt,
    });
  }
);

// PATCH /settings/college — COLLEGE_ADMIN can update localization settings only
settingsRouter.patch(
  "/settings/college",
  authenticate,
  requirePermission("SETTINGS_COLLEGE"),
  [
    body("localization.timezone").optional().isString().isLength({ min: 1, max: 100 }),
    body("localization.currency").optional().isString().isLength({ min: 1, max: 20 }),
    body("localization.dateFormat").optional().isString().isLength({ min: 1, max: 50 }),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const localization = (req.body.localization ?? {}) as {
      timezone?: string;
      currency?: string;
      dateFormat?: string;
    };

    const updated = await prisma.appSetting.upsert({
      where: { id: "default" },
      update: {
        ...(localization.timezone ? { timezone: localization.timezone } : {}),
        ...(localization.currency ? { currency: localization.currency } : {}),
        ...(localization.dateFormat ? { dateFormat: localization.dateFormat } : {}),
      },
      create: {
        id: "default",
        timezone: localization.timezone ?? "Asia/Kolkata",
        currency: localization.currency ?? "INR",
        dateFormat: localization.dateFormat ?? "DD-MM-YYYY",
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "SETTINGS_UPDATED",
      entityType: "APP_SETTINGS",
      entityId: updated.id,
      metadata: { localization },
    });

    res.json({
      localization: {
        timezone: updated.timezone,
        currency: updated.currency,
        dateFormat: updated.dateFormat,
      },
      updatedAt: updated.updatedAt,
    });
  }
);
