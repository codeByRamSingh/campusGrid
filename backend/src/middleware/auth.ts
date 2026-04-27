import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../lib/auth.js";
import { getPermissionsForUser, type AppPermission } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";

type AuthRole = "SUPER_ADMIN" | "STAFF";

export type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    email: string;
    role: AuthRole;
    staffId?: string;
    staffRole?: string;
    customRoleId?: string;
    customRoleName?: string;
    collegeId?: string;
    permissions: AppPermission[];
  };
};

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  // Try httpOnly cookie first, then fall back to Authorization header (for API clients / mobile)
  let token: string | undefined;
  const cookieToken = (req.cookies as Record<string, string | undefined>)["campusgrid_token"];
  if (cookieToken) {
    token = cookieToken;
  } else {
    const header = req.headers.authorization;
    if (header && header.startsWith("Bearer ")) {
      token = header.slice(7);
    }
  }

  if (!token) {
    res.status(401).json({ message: "Missing authorization token" });
    return;
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        staffId: true,
        staff: {
          select: {
            id: true,
            role: true,
            collegeId: true,
            isActive: true,
            customRoleId: true,
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
      res.status(401).json({ message: "Account not found" });
      return;
    }

    if (user.role === "STAFF" && (!user.staff || !user.staff.isActive)) {
      res.status(403).json({ message: "Staff account is inactive" });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      staffId: user.staffId ?? undefined,
      staffRole: user.staff?.customRole?.name ?? user.staff?.role,
      customRoleId: user.staff?.customRoleId ?? undefined,
      customRoleName: user.staff?.customRole?.name ?? undefined,
      collegeId: user.staff?.collegeId,
      permissions: getPermissionsForUser(user.role, user.staff?.role, {
        hasCustomRole: Boolean(user.staff?.customRoleId),
        customRolePermissions: user.staff?.customRole?.permissions,
      }),
    };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function requireRole(...roles: AuthRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requirePermission(...permissions: AppPermission[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !permissions.some((permission) => req.user?.permissions.includes(permission))) {
      res.status(403).json({ message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function getScopedCollegeId(req: AuthenticatedRequest, requestedCollegeId?: string | null): string | undefined {
  if (!req.user) {
    return undefined;
  }

  if (req.user.role === "SUPER_ADMIN") {
    return requestedCollegeId || undefined;
  }

  if (requestedCollegeId && requestedCollegeId !== req.user.collegeId) {
    return "__FORBIDDEN__";
  }

  return req.user.collegeId;
}

export function canAccessCollege(req: AuthenticatedRequest, collegeId: string): boolean {
  if (!req.user) {
    return false;
  }

  if (req.user.role === "SUPER_ADMIN") {
    return true;
  }

  return Boolean(req.user.collegeId && req.user.collegeId === collegeId);
}
