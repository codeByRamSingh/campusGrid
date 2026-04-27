import { Router } from "express";
import { body, param } from "express-validator";
import { prisma } from "../lib/prisma.js";
import { authenticate, canAccessCollege, getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";

export const hostelRouter = Router();

// ─── Hostel Blocks ────────────────────────────────────────────────────────────

hostelRouter.get("/hostel/blocks", authenticate, requirePermission("HOSTEL_READ"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const scopedCollegeId = getScopedCollegeId(req);
    const blocks = await prisma.hostelBlock.findMany({
      where: scopedCollegeId ? { collegeId: scopedCollegeId } : {},
      include: {
        rooms: {
          include: {
            _count: { select: { allocations: { where: { status: "ACTIVE" } } } },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    res.json(blocks);
  } catch (err) {
    next(err);
  }
});

hostelRouter.post(
  "/hostel/blocks",
  authenticate,
  requirePermission("HOSTEL_WRITE"),
  [body("collegeId").notEmpty(), body("name").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.body.collegeId as string)) {
        res.status(403).json({ message: "Cannot manage hostel for another college" });
        return;
      }
      const block = await prisma.hostelBlock.create({
        data: {
          collegeId: req.body.collegeId as string,
          name: req.body.name as string,
          gender: (req.body.gender as string) ?? "ANY",
          floors: (req.body.floors as number) ?? 1,
          notes: req.body.notes as string | undefined,
        },
      });
      res.status(201).json(block);
    } catch (err) {
      next(err);
    }
  }
);

hostelRouter.patch(
  "/hostel/blocks/:id",
  authenticate,
  requirePermission("HOSTEL_WRITE"),
  [param("id").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const block = await prisma.hostelBlock.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name as string } : {}),
          ...(req.body.gender !== undefined ? { gender: req.body.gender as string } : {}),
          ...(req.body.floors !== undefined ? { floors: req.body.floors as number } : {}),
          ...(req.body.notes !== undefined ? { notes: req.body.notes as string } : {}),
          ...(req.body.isActive !== undefined ? { isActive: req.body.isActive as boolean } : {}),
        },
      });
      res.json(block);
    } catch (err) {
      next(err);
    }
  }
);

// ─── Hostel Rooms ─────────────────────────────────────────────────────────────

hostelRouter.post(
  "/hostel/rooms",
  authenticate,
  requirePermission("HOSTEL_WRITE"),
  [body("blockId").notEmpty(), body("collegeId").notEmpty(), body("roomNumber").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const room = await prisma.hostelRoom.create({
        data: {
          blockId: req.body.blockId as string,
          collegeId: req.body.collegeId as string,
          roomNumber: req.body.roomNumber as string,
          floor: (req.body.floor as number) ?? 1,
          roomType: (req.body.roomType as "SINGLE" | "DOUBLE" | "TRIPLE" | "DORMITORY") ?? "SINGLE",
          capacity: (req.body.capacity as number) ?? 1,
          feePerTerm: (req.body.feePerTerm as number) ?? 0,
        },
      });
      res.status(201).json(room);
    } catch (err) {
      next(err);
    }
  }
);

hostelRouter.patch(
  "/hostel/rooms/:id",
  authenticate,
  requirePermission("HOSTEL_WRITE"),
  [param("id").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const room = await prisma.hostelRoom.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.roomNumber !== undefined ? { roomNumber: req.body.roomNumber as string } : {}),
          ...(req.body.floor !== undefined ? { floor: req.body.floor as number } : {}),
          ...(req.body.roomType !== undefined ? { roomType: req.body.roomType as "SINGLE" | "DOUBLE" | "TRIPLE" | "DORMITORY" } : {}),
          ...(req.body.capacity !== undefined ? { capacity: req.body.capacity as number } : {}),
          ...(req.body.feePerTerm !== undefined ? { feePerTerm: req.body.feePerTerm as number } : {}),
          ...(req.body.isActive !== undefined ? { isActive: req.body.isActive as boolean } : {}),
        },
      });
      res.json(room);
    } catch (err) {
      next(err);
    }
  }
);

// ─── Hostel Allocations ───────────────────────────────────────────────────────

hostelRouter.get("/hostel/allocations", authenticate, requirePermission("HOSTEL_READ"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const scopedCollegeId = getScopedCollegeId(req);
    const { status } = req.query as { status?: string };
    const allocations = await prisma.hostelAllocation.findMany({
      where: {
        ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
        ...(status ? { status: status as "ACTIVE" | "VACATED" | "RESERVED" } : {}),
      },
      include: {
        room: { include: { block: { select: { name: true, gender: true } } } },
        student: { select: { id: true, candidateName: true, admissionNumber: true, rollNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(allocations);
  } catch (err) {
    next(err);
  }
});

hostelRouter.post(
  "/hostel/allocations",
  authenticate,
  requirePermission("HOSTEL_WRITE"),
  [body("roomId").notEmpty(), body("studentId").notEmpty(), body("collegeId").notEmpty(), body("fromDate").isISO8601()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const existing = await prisma.hostelAllocation.findFirst({
        where: { studentId: req.body.studentId as string, status: "ACTIVE" },
      });
      if (existing) {
        res.status(409).json({ message: "Student already has an active hostel allocation. Vacate it first." });
        return;
      }

      const allocation = await prisma.hostelAllocation.create({
        data: {
          roomId: req.body.roomId as string,
          studentId: req.body.studentId as string,
          collegeId: req.body.collegeId as string,
          fromDate: new Date(req.body.fromDate as string),
          toDate: req.body.toDate ? new Date(req.body.toDate as string) : undefined,
          notes: req.body.notes as string | undefined,
        },
      });
      res.status(201).json(allocation);
    } catch (err) {
      next(err);
    }
  }
);

hostelRouter.patch(
  "/hostel/allocations/:id",
  authenticate,
  requirePermission("HOSTEL_WRITE"),
  [param("id").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { status, toDate, notes } = req.body as Record<string, unknown>;
      const allocation = await prisma.hostelAllocation.update({
        where: { id: req.params.id },
        data: {
          ...(status !== undefined ? { status: status as "ACTIVE" | "VACATED" | "RESERVED" } : {}),
          ...(toDate !== undefined ? { toDate: new Date(toDate as string) } : {}),
          ...(notes !== undefined ? { notes: notes as string } : {}),
        },
      });
      res.json(allocation);
    } catch (err) {
      next(err);
    }
  }
);
