import { Router } from "express";
import { body } from "express-validator";
import * as AdminService from "../../services/admin.service.js";
import { AppError } from "../../lib/errors.js";
import { getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../../middleware/auth.js";
import { handleValidation } from "../../middleware/validate.js";

export const rolesRouter = Router();

rolesRouter.get(
  "/custom-roles",
  requirePermission("SETTINGS_COLLEGE", "HR_WRITE"),
  async (req: AuthenticatedRequest, res) => {
    const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
    if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Cannot access another college" }); return; }
    const roles = await AdminService.listCustomRoles(scopedCollegeId);
    res.json(roles);
  },
);

rolesRouter.post(
  "/custom-roles",
  requirePermission("SETTINGS_COLLEGE"),
  [body("collegeId").notEmpty(), body("name").notEmpty(), body("permissions").isArray({ min: 0 })],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    const scopedCollegeId = getScopedCollegeId(req, req.body.collegeId as string);
    if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Cannot create roles for another college" }); return; }
    try {
      const created = await AdminService.createCustomRole(
        scopedCollegeId ?? req.body.collegeId,
        String(req.body.name),
        req.body.permissions as string[],
        req.user?.id,
      );
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

rolesRouter.patch(
  "/custom-roles/:roleId",
  requirePermission("SETTINGS_COLLEGE"),
  [body("name").optional().notEmpty(), body("permissions").optional().isArray({ min: 0 })],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    // Scope check: ensure the role belongs to an accessible college
    const { prisma } = await import("../../lib/prisma.js");
    const existing = await prisma.customRole.findUnique({ where: { id: req.params.roleId }, select: { id: true, collegeId: true } });
    if (!existing) { res.status(404).json({ message: "Custom role not found" }); return; }
    const scopedCollegeId = getScopedCollegeId(req, existing.collegeId);
    if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Cannot update another college's custom role" }); return; }
    try {
      const updated = await AdminService.updateCustomRole(
        req.params.roleId,
        { name: req.body.name, permissions: req.body.permissions as string[] | undefined },
        req.user?.id,
      );
      res.json(updated);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

rolesRouter.delete(
  "/custom-roles/:roleId",
  requirePermission("SETTINGS_COLLEGE"),
  async (req: AuthenticatedRequest, res, next) => {
    const { prisma } = await import("../../lib/prisma.js");
    const existing = await prisma.customRole.findUnique({ where: { id: req.params.roleId }, select: { collegeId: true } });
    if (!existing) { res.status(404).json({ message: "Custom role not found" }); return; }
    const scopedCollegeId = getScopedCollegeId(req, existing.collegeId);
    if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Cannot delete another college's custom role" }); return; }
    try {
      await AdminService.deleteCustomRole(req.params.roleId, req.user?.id);
      res.json({ message: "Custom role deleted successfully" });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);
