import { Router } from "express";
import { body } from "express-validator";
import * as AdminService from "../../services/admin.service.js";
import { AppError } from "../../lib/errors.js";
import { getScopedCollegeId, requirePermission, requireRole, type AuthenticatedRequest } from "../../middleware/auth.js";
import { handleValidation } from "../../middleware/validate.js";

export const collegeRouter = Router();

collegeRouter.get("/colleges", requirePermission("ACADEMIC_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Cannot access another college" }); return; }
  const colleges = await AdminService.listColleges(scopedCollegeId);
  res.json(colleges);
});

collegeRouter.get("/academic-structure", requirePermission("ACADEMIC_READ"), async (req: AuthenticatedRequest, res) => {
  const scopedCollegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (scopedCollegeId === "__FORBIDDEN__") { res.status(403).json({ message: "Cannot access another college" }); return; }
  const structure = await AdminService.getAcademicStructure(scopedCollegeId);
  res.json(structure);
});

collegeRouter.post(
  "/colleges",
  requireRole("SUPER_ADMIN"),
  [body("name").notEmpty(), body("code").notEmpty(), body("university").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const college = await AdminService.createCollege(req.body as AdminService.CreateCollegeInput, req.user?.id);
      res.status(201).json(college);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      next(err);
    }
  },
);

collegeRouter.put(
  "/colleges/:collegeId",
  requireRole("SUPER_ADMIN"),
  [
    body("name").notEmpty(),
    body("code").notEmpty(),
    body("registrationYear").isInt(),
    body("address").notEmpty(),
    body("university").notEmpty(),
    body("startingRollNumber").isInt(),
    body("startingAdmissionNumber").isInt(),
    body("admissionNumberPrefix").notEmpty(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const updated = await AdminService.updateCollege(req.params.collegeId, req.body as AdminService.UpdateCollegeInput, req.user?.id);
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

collegeRouter.delete("/colleges/:collegeId", requireRole("SUPER_ADMIN"), async (req: AuthenticatedRequest, res, next) => {
  try {
    await AdminService.deleteCollege(req.params.collegeId, req.user?.id);
    res.json({ message: "College deleted successfully" });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
      return;
    }
    next(err);
  }
});
