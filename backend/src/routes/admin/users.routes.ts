import { Router } from "express";
import { body } from "express-validator";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { requireRole, type AuthenticatedRequest } from "../../middleware/auth.js";
import { handleValidation } from "../../middleware/validate.js";

export const usersRouter = Router();

usersRouter.get("/users", requireRole("SUPER_ADMIN"), async (_req, res) => {
  const users = await prisma.user.findMany({
    include: {
      staff: {
        select: {
          id: true,
          fullName: true,
          collegeId: true,
          role: true,
          isActive: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      staff: user.staff,
    })),
  );
});

usersRouter.post(
  "/users/assign-role",
  requireRole("SUPER_ADMIN"),
  [body("email").isEmail(), body("role").isIn(["SUPER_ADMIN", "STAFF"])],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const updated = await prisma.user.update({
      where: { email: req.body.email },
      data: { role: req.body.role },
    });
    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "USER_ROLE_ASSIGNED",
      entityType: "USER",
      entityId: updated.id,
      metadata: { email: updated.email, role: updated.role },
    });
    res.json({ id: updated.id, email: updated.email, role: updated.role });
  },
);
