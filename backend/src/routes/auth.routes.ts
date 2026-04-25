import { NextFunction, Request, Response, Router } from "express";
import { body } from "express-validator";
import { comparePassword, hashPassword, signToken } from "../lib/auth.js";
import { hashOpaqueToken, validatePasswordStrength } from "../lib/security.js";
import { getPermissionsForUser } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { handleValidation } from "../middleware/validate.js";

export const authRouter = Router();

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;

function loginLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    next();
    return;
  }

  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    res.status(429).json({ message: "Too many login attempts, please try again later." });
    return;
  }

  entry.count += 1;
  loginAttempts.set(ip, entry);
  next();
}

authRouter.post(
  "/auth/login",
  loginLimiter,
  [body("email").isEmail(), body("password").isString().isLength({ min: 6 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const { email, password } = req.body as { email: string; password: string };

      const user = await prisma.user.findUnique({ where: { email }, include: { staff: true } });
      if (!user) {
        res.status(401).json({ message: "Invalid credentials" });
        return;
      }

      if (user.role === "STAFF" && user.staff && !user.staff.isActive) {
        res.status(403).json({ message: "Staff account is inactive" });
        return;
      }

      const ok = await comparePassword(password, user.passwordHash);
      if (!ok) {
        res.status(401).json({ message: "Invalid credentials" });
        return;
      }

      const token = signToken({
        sub: user.id,
      });

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          permissions: getPermissionsForUser(user.role, user.staff?.role),
          staff: user.staff
            ? {
                id: user.staff.id,
                fullName: user.staff.fullName,
                collegeId: user.staff.collegeId,
                role: user.staff.role,
                isActive: user.staff.isActive,
              }
            : null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  "/auth/setup-password",
  [body("token").isString().isLength({ min: 32 }), body("password").isString().isLength({ min: 8 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const issues = validatePasswordStrength(req.body.password as string);
      if (issues.length > 0) {
        res.status(400).json({ message: "Password does not meet policy requirements", issues });
        return;
      }

      const tokenHash = hashOpaqueToken(req.body.token as string);
      const setupToken = await prisma.passwordSetupToken.findUnique({ where: { tokenHash } });

      if (!setupToken || setupToken.usedAt || setupToken.expiresAt < new Date()) {
        res.status(400).json({ message: "Invalid or expired setup token" });
        return;
      }

      const passwordHash = await hashPassword(req.body.password as string);

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: setupToken.userId },
          data: { passwordHash },
        });

        await tx.passwordSetupToken.update({
          where: { id: setupToken.id },
          data: { usedAt: new Date() },
        });

        await tx.staff.updateMany({
          where: { user: { id: setupToken.userId } },
          data: { inviteAcceptedAt: new Date() },
        });
      });

      res.json({ message: "Password configured successfully" });
    } catch (err) {
      next(err);
    }
  }
);
