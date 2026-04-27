import { NextFunction, Request, Response, Router } from "express";
import { body } from "express-validator";
import { comparePassword, generateRefreshToken, hashPassword, hashRefreshToken, REFRESH_TOKEN_TTL_MS, signToken } from "../lib/auth.js";
import { hashOpaqueToken, validatePasswordStrength } from "../lib/security.js";
import { getPermissionsForUser } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { consumeRateLimit } from "../lib/redis.js";
import { handleValidation } from "../middleware/validate.js";

export const authRouter = Router();

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true" || IS_PRODUCTION;
const ACCESS_TOKEN_COOKIE = "campusgrid_token";
const REFRESH_TOKEN_COOKIE = "campusgrid_refresh_token";

function setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
  const cookieOpts = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "strict" as const,
    path: "/",
  };
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, { ...cookieOpts, maxAge: 12 * 60 * 60 * 1000 });
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, { ...cookieOpts, maxAge: REFRESH_TOKEN_TTL_MS });
}

function clearTokenCookies(res: Response) {
  const cookieOpts = { httpOnly: true, secure: COOKIE_SECURE, sameSite: "strict" as const, path: "/" };
  res.clearCookie(ACCESS_TOKEN_COOKIE, cookieOpts);
  res.clearCookie(REFRESH_TOKEN_COOKIE, cookieOpts);
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

async function loginLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 64);
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 160) : "unknown";
  const now = new Date();
  const resetAt = new Date(Date.now() + LOGIN_WINDOW_MS);

  try {
    const distributedLimit = await consumeRateLimit(`login:${ip}:${email}`, LOGIN_WINDOW_MS);
    if (distributedLimit) {
      res.setHeader("X-RateLimit-Limit", String(LOGIN_MAX_ATTEMPTS));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, LOGIN_MAX_ATTEMPTS - distributedLimit.count)));
      res.setHeader("X-RateLimit-Reset", new Date(distributedLimit.resetAt).toISOString());

      if (distributedLimit.count > LOGIN_MAX_ATTEMPTS) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((distributedLimit.resetAt - Date.now()) / 1000))));
        res.status(429).json({ message: "Too many login attempts, please try again later." });
        return;
      }

      next();
      return;
    }

    const existing = await prisma.loginAttempt.findUnique({ where: { ip } });

    if (existing && existing.resetAt > now) {
      // Window still active
      if (existing.count >= LOGIN_MAX_ATTEMPTS) {
        res.status(429).json({ message: "Too many login attempts, please try again later." });
        return;
      }
      await prisma.loginAttempt.update({ where: { ip }, data: { count: { increment: 1 } } });
    } else {
      // Expired window or first attempt — reset/create
      await prisma.loginAttempt.upsert({
        where: { ip },
        update: { count: 1, resetAt },
        create: { ip, count: 1, resetAt },
      });
    }
  } catch {
    // If DB is unavailable, fail open to avoid blocking all logins
  }

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

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          staff: {
            include: {
              customRole: {
                select: {
                  id: true,
                  name: true,
                  permissions: true,
                },
              },
            },
          },
        },
      });
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

      const token = signToken({ sub: user.id });

      const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: refreshHash,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      });

      setTokenCookies(res, token, refreshRaw);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          permissions: getPermissionsForUser(user.role, user.staff?.role, {
            hasCustomRole: Boolean(user.staff?.customRoleId),
            customRolePermissions: user.staff?.customRole?.permissions,
          }),
          staff: user.staff
            ? {
                id: user.staff.id,
                fullName: user.staff.fullName,
                collegeId: user.staff.collegeId,
                role: user.staff.customRole?.name ?? user.staff.role,
                customRoleId: user.staff.customRoleId,
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
  "/auth/refresh",
  async (req, res, next) => {
    try {
      // Accept refresh token from httpOnly cookie or body (for backward compat / mobile)
      const rawToken: string | undefined =
        (req.cookies as Record<string, string | undefined>)[REFRESH_TOKEN_COOKIE] ||
        (req.body?.refreshToken as string | undefined);

      if (!rawToken) {
        res.status(401).json({ message: "No refresh token provided" });
        return;
      }

      const tokenHash = hashRefreshToken(rawToken);
      const now = new Date();

      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: { include: { staff: true } } },
      });

      if (!stored || stored.revokedAt || stored.expiresAt < now) {
        res.status(401).json({ message: "Invalid or expired refresh token" });
        return;
      }

      if (stored.user.role === "STAFF" && stored.user.staff && !stored.user.staff.isActive) {
        res.status(403).json({ message: "Staff account is inactive" });
        return;
      }

      // Rotate: revoke old token and issue new pair
      await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: now } });

      const newAccessToken = signToken({ sub: stored.user.id });
      const { raw: newRefreshRaw, hash: newRefreshHash } = generateRefreshToken();
      await prisma.refreshToken.create({
        data: {
          userId: stored.user.id,
          tokenHash: newRefreshHash,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      });

      setTokenCookies(res, newAccessToken, newRefreshRaw);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  "/auth/logout",
  async (req, res, next) => {
    try {
      // Accept refresh token from httpOnly cookie or body
      const rawToken: string | undefined =
        (req.cookies as Record<string, string | undefined>)[REFRESH_TOKEN_COOKIE] ||
        (req.body?.refreshToken as string | undefined);

      if (rawToken) {
        const tokenHash = hashRefreshToken(rawToken);
        await prisma.refreshToken.updateMany({
          where: { tokenHash, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      clearTokenCookies(res);
      res.json({ message: "Logged out" });
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
