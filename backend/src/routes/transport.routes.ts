import { Router } from "express";
import { body, param } from "express-validator";
import { prisma } from "../lib/prisma.js";
import { authenticate, canAccessCollege, getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";

export const transportRouter = Router();

// ─── Transport Routes ─────────────────────────────────────────────────────────

transportRouter.get("/transport/routes", authenticate, requirePermission("TRANSPORT_READ"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const scopedCollegeId = getScopedCollegeId(req);
    const routes = await prisma.transportRoute.findMany({
      where: {
        ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
        isActive: true,
      },
      include: {
        _count: { select: { allocations: { where: { status: "ACTIVE" } } } },
      },
      orderBy: { routeCode: "asc" },
    });
    res.json(routes);
  } catch (err) {
    next(err);
  }
});

transportRouter.post(
  "/transport/routes",
  authenticate,
  requirePermission("TRANSPORT_WRITE"),
  [body("collegeId").notEmpty(), body("routeCode").notEmpty(), body("routeName").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.body.collegeId as string)) {
        res.status(403).json({ message: "Cannot manage transport for another college" });
        return;
      }
      const route = await prisma.transportRoute.create({
        data: {
          collegeId: req.body.collegeId as string,
          routeCode: req.body.routeCode as string,
          routeName: req.body.routeName as string,
          stops: Array.isArray(req.body.stops) ? (req.body.stops as string[]) : [],
          vehicleNumber: req.body.vehicleNumber as string | undefined,
          driverName: req.body.driverName as string | undefined,
          driverPhone: req.body.driverPhone as string | undefined,
          conductorName: req.body.conductorName as string | undefined,
          departureTime: req.body.departureTime as string | undefined,
          returnTime: req.body.returnTime as string | undefined,
          feePerTerm: req.body.feePerTerm ?? 0,
          notes: req.body.notes as string | undefined,
        },
      });
      res.status(201).json(route);
    } catch (err) {
      next(err);
    }
  }
);

transportRouter.patch(
  "/transport/routes/:id",
  authenticate,
  requirePermission("TRANSPORT_WRITE"),
  [param("id").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const route = await prisma.transportRoute.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.routeName !== undefined ? { routeName: req.body.routeName as string } : {}),
          ...(req.body.stops !== undefined ? { stops: req.body.stops as string[] } : {}),
          ...(req.body.vehicleNumber !== undefined ? { vehicleNumber: req.body.vehicleNumber as string } : {}),
          ...(req.body.driverName !== undefined ? { driverName: req.body.driverName as string } : {}),
          ...(req.body.driverPhone !== undefined ? { driverPhone: req.body.driverPhone as string } : {}),
          ...(req.body.conductorName !== undefined ? { conductorName: req.body.conductorName as string } : {}),
          ...(req.body.departureTime !== undefined ? { departureTime: req.body.departureTime as string } : {}),
          ...(req.body.returnTime !== undefined ? { returnTime: req.body.returnTime as string } : {}),
          ...(req.body.feePerTerm !== undefined ? { feePerTerm: req.body.feePerTerm as number } : {}),
          ...(req.body.isActive !== undefined ? { isActive: req.body.isActive as boolean } : {}),
          ...(req.body.notes !== undefined ? { notes: req.body.notes as string } : {}),
        },
      });
      res.json(route);
    } catch (err) {
      next(err);
    }
  }
);

// ─── Transport Allocations ────────────────────────────────────────────────────

transportRouter.get("/transport/allocations", authenticate, requirePermission("TRANSPORT_READ"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const scopedCollegeId = getScopedCollegeId(req);
    const { status } = req.query as { status?: string };
    const allocations = await prisma.transportAllocation.findMany({
      where: {
        ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
        ...(status ? { status: status as "ACTIVE" | "CANCELLED" | "COMPLETED" } : {}),
      },
      include: {
        route: { select: { id: true, routeCode: true, routeName: true, stops: true, departureTime: true } },
        student: { select: { id: true, candidateName: true, admissionNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(allocations);
  } catch (err) {
    next(err);
  }
});

transportRouter.post(
  "/transport/allocations",
  authenticate,
  requirePermission("TRANSPORT_WRITE"),
  [body("routeId").notEmpty(), body("studentId").notEmpty(), body("collegeId").notEmpty(), body("fromDate").isISO8601()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      // Prevent double-allocating a student on same route
      const existing = await prisma.transportAllocation.findFirst({
        where: { studentId: req.body.studentId as string, routeId: req.body.routeId as string, status: "ACTIVE" },
      });
      if (existing) {
        res.status(409).json({ message: "Student already has an active allocation on this route" });
        return;
      }

      const allocation = await prisma.transportAllocation.create({
        data: {
          routeId: req.body.routeId as string,
          studentId: req.body.studentId as string,
          collegeId: req.body.collegeId as string,
          fromDate: new Date(req.body.fromDate as string),
          toDate: req.body.toDate ? new Date(req.body.toDate as string) : undefined,
          pickupStop: req.body.pickupStop as string | undefined,
          notes: req.body.notes as string | undefined,
        },
      });
      res.status(201).json(allocation);
    } catch (err) {
      next(err);
    }
  }
);

transportRouter.patch(
  "/transport/allocations/:id",
  authenticate,
  requirePermission("TRANSPORT_WRITE"),
  [param("id").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { status, toDate, pickupStop, notes } = req.body as Record<string, unknown>;
      const allocation = await prisma.transportAllocation.update({
        where: { id: req.params.id },
        data: {
          ...(status !== undefined ? { status: status as "ACTIVE" | "CANCELLED" | "COMPLETED" } : {}),
          ...(toDate !== undefined ? { toDate: new Date(toDate as string) } : {}),
          ...(pickupStop !== undefined ? { pickupStop: pickupStop as string } : {}),
          ...(notes !== undefined ? { notes: notes as string } : {}),
        },
      });
      res.json(allocation);
    } catch (err) {
      next(err);
    }
  }
);
