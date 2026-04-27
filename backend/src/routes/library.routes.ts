import { Router } from "express";
import { body, param } from "express-validator";
import { prisma } from "../lib/prisma.js";
import { authenticate, canAccessCollege, getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";

export const libraryRouter = Router();

// ─── Library Books ────────────────────────────────────────────────────────────

libraryRouter.get("/library/books", authenticate, requirePermission("LIBRARY_READ"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const scopedCollegeId = getScopedCollegeId(req);
    const { category, available } = req.query as Record<string, string | undefined>;
    const books = await prisma.libraryBook.findMany({
      where: {
        ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
        isActive: true,
        ...(category ? { category } : {}),
        ...(available === "true" ? { availableCopies: { gt: 0 } } : {}),
      },
      include: {
        _count: { select: { transactions: { where: { status: "ISSUED" } } } },
      },
      orderBy: { title: "asc" },
    });
    res.json(books);
  } catch (err) {
    next(err);
  }
});

libraryRouter.post(
  "/library/books",
  authenticate,
  requirePermission("LIBRARY_WRITE"),
  [body("collegeId").notEmpty(), body("title").notEmpty(), body("author").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!canAccessCollege(req, req.body.collegeId as string)) {
        res.status(403).json({ message: "Cannot manage library for another college" });
        return;
      }
      const totalCopies = Number(req.body.totalCopies ?? 1);
      const book = await prisma.libraryBook.create({
        data: {
          collegeId: req.body.collegeId as string,
          title: req.body.title as string,
          author: req.body.author as string,
          isbn: req.body.isbn as string | undefined,
          publisher: req.body.publisher as string | undefined,
          edition: req.body.edition as string | undefined,
          category: req.body.category as string | undefined,
          totalCopies,
          availableCopies: totalCopies,
          shelfLocation: req.body.shelfLocation as string | undefined,
        },
      });
      res.status(201).json(book);
    } catch (err) {
      next(err);
    }
  }
);

libraryRouter.patch(
  "/library/books/:id",
  authenticate,
  requirePermission("LIBRARY_WRITE"),
  [param("id").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const book = await prisma.libraryBook.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.title !== undefined ? { title: req.body.title as string } : {}),
          ...(req.body.author !== undefined ? { author: req.body.author as string } : {}),
          ...(req.body.isbn !== undefined ? { isbn: req.body.isbn as string } : {}),
          ...(req.body.publisher !== undefined ? { publisher: req.body.publisher as string } : {}),
          ...(req.body.edition !== undefined ? { edition: req.body.edition as string } : {}),
          ...(req.body.category !== undefined ? { category: req.body.category as string } : {}),
          ...(req.body.totalCopies !== undefined ? { totalCopies: req.body.totalCopies as number } : {}),
          ...(req.body.shelfLocation !== undefined ? { shelfLocation: req.body.shelfLocation as string } : {}),
          ...(req.body.isActive !== undefined ? { isActive: req.body.isActive as boolean } : {}),
        },
      });
      res.json(book);
    } catch (err) {
      next(err);
    }
  }
);

// ─── Library Transactions ─────────────────────────────────────────────────────

libraryRouter.get("/library/transactions", authenticate, requirePermission("LIBRARY_READ"), async (req: AuthenticatedRequest, res, next) => {
  try {
    const scopedCollegeId = getScopedCollegeId(req);
    const { status, studentId } = req.query as Record<string, string | undefined>;
    const transactions = await prisma.libraryTransaction.findMany({
      where: {
        ...(scopedCollegeId ? { collegeId: scopedCollegeId } : {}),
        ...(status ? { status: status as "ISSUED" | "RETURNED" | "OVERDUE" | "LOST" } : {}),
        ...(studentId ? { studentId } : {}),
      },
      include: {
        book: { select: { id: true, title: true, author: true, isbn: true } },
        student: { select: { id: true, candidateName: true, admissionNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(transactions);
  } catch (err) {
    next(err);
  }
});

libraryRouter.post(
  "/library/transactions/issue",
  authenticate,
  requirePermission("LIBRARY_WRITE"),
  [body("bookId").notEmpty(), body("studentId").notEmpty(), body("collegeId").notEmpty(), body("dueDate").isISO8601()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const book = await prisma.libraryBook.findUnique({ where: { id: req.body.bookId as string } });
      if (!book) {
        res.status(404).json({ message: "Book not found" });
        return;
      }
      if (book.availableCopies <= 0) {
        res.status(409).json({ message: "No copies available for issue" });
        return;
      }

      // Check student doesn't already have this book issued
      const existingIssue = await prisma.libraryTransaction.findFirst({
        where: { bookId: req.body.bookId as string, studentId: req.body.studentId as string, status: "ISSUED" },
      });
      if (existingIssue) {
        res.status(409).json({ message: "Student already has this book issued" });
        return;
      }

      const [transaction] = await prisma.$transaction([
        prisma.libraryTransaction.create({
          data: {
            bookId: req.body.bookId as string,
            studentId: req.body.studentId as string,
            collegeId: req.body.collegeId as string,
            dueDate: new Date(req.body.dueDate as string),
            issuedBy: req.user?.id,
            notes: req.body.notes as string | undefined,
          },
        }),
        prisma.libraryBook.update({
          where: { id: req.body.bookId as string },
          data: { availableCopies: { decrement: 1 } },
        }),
      ]);
      res.status(201).json(transaction);
    } catch (err) {
      next(err);
    }
  }
);

libraryRouter.post(
  "/library/transactions/:id/return",
  authenticate,
  requirePermission("LIBRARY_WRITE"),
  [param("id").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const txn = await prisma.libraryTransaction.findUnique({ where: { id: req.params.id } });
      if (!txn) {
        res.status(404).json({ message: "Transaction not found" });
        return;
      }
      if (txn.status !== "ISSUED" && txn.status !== "OVERDUE") {
        res.status(400).json({ message: "Book is not currently issued" });
        return;
      }

      const returnDate = new Date();
      const overdueDays = Math.max(0, Math.floor((returnDate.getTime() - txn.dueDate.getTime()) / 86400000));
      const finePerDay = Number(req.body.finePerDay ?? 2);
      const fine = overdueDays * finePerDay;

      const [transaction] = await prisma.$transaction([
        prisma.libraryTransaction.update({
          where: { id: req.params.id },
          data: {
            status: "RETURNED",
            returnDate,
            fine,
            finePaid: fine === 0,
            returnedTo: req.user?.id,
          },
        }),
        prisma.libraryBook.update({
          where: { id: txn.bookId },
          data: { availableCopies: { increment: 1 } },
        }),
      ]);
      res.json({ transaction, overdueDays, fine });
    } catch (err) {
      next(err);
    }
  }
);

// Mark overdue transactions
libraryRouter.post("/library/transactions/mark-overdue", authenticate, requirePermission("LIBRARY_WRITE"), async (_req, res, next) => {
  try {
    const { count } = await prisma.libraryTransaction.updateMany({
      where: { status: "ISSUED", dueDate: { lt: new Date() } },
      data: { status: "OVERDUE" },
    });
    res.json({ updated: count });
  } catch (err) {
    next(err);
  }
});
