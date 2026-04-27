/**
 * DOC-01: Document model + file upload endpoint
 * Files are stored on disk at /app/storage/documents (mounted as campusgrid_storage volume).
 */
import { Router } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { body, param } from "express-validator";
import { prisma } from "../lib/prisma.js";
import { authenticate, canAccessCollege, requirePermission } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";

export const documentsRouter = Router();

const STORAGE_DIR = process.env.STORAGE_DIR ?? "/app/storage/documents";

// Ensure storage directory exists at module load
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, STORAGE_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safe = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${Date.now()}_${safe}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
    }
  },
});

// POST /documents — upload a new document
documentsRouter.post(
  "/documents",
  authenticate,
  requirePermission("HR_WRITE"),
  upload.single("file"),
  [body("entityType").notEmpty(), body("entityId").notEmpty(), body("collegeId").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }
    if (!canAccessCollege(req, req.body.collegeId as string)) {
      // Remove the uploaded file if access denied
      fs.unlink(req.file.path, () => {});
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const doc = await prisma.document.create({
      data: {
        entityType: req.body.entityType as string,
        entityId: req.body.entityId as string,
        collegeId: req.body.collegeId as string,
        fileName: req.file.originalname,
        storagePath: req.file.filename,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedBy: req.user?.id ?? null,
      },
    });

    res.status(201).json(doc);
  }
);

// GET /documents?entityType=&entityId= — list documents for an entity
documentsRouter.get(
  "/documents",
  authenticate,
  requirePermission("HR_READ"),
  async (req: AuthenticatedRequest, res) => {
    const { entityType, entityId, collegeId } = req.query as Record<string, string>;

    if (!entityType || !entityId) {
      res.status(400).json({ message: "entityType and entityId are required" });
      return;
    }
    if (collegeId && !canAccessCollege(req, collegeId)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const docs = await prisma.document.findMany({
      where: {
        entityType,
        entityId,
        ...(collegeId ? { collegeId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(docs);
  }
);

// GET /documents/:id/download — serve the file
documentsRouter.get(
  "/documents/:id/download",
  authenticate,
  requirePermission("HR_READ"),
  [param("id").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) { res.status(404).json({ message: "Document not found" }); return; }
    if (!canAccessCollege(req, doc.collegeId)) { res.status(403).json({ message: "Forbidden" }); return; }

    const filePath = path.join(STORAGE_DIR, doc.storagePath);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ message: "File not found on storage" });
      return;
    }

    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
    res.sendFile(filePath);
  }
);

// DELETE /documents/:id
documentsRouter.delete(
  "/documents/:id",
  authenticate,
  requirePermission("HR_WRITE"),
  [param("id").notEmpty()],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) { res.status(404).json({ message: "Document not found" }); return; }
    if (!canAccessCollege(req, doc.collegeId)) { res.status(403).json({ message: "Forbidden" }); return; }

    // Remove file from disk
    const filePath = path.join(STORAGE_DIR, doc.storagePath);
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, () => {});
    }

    await prisma.document.delete({ where: { id: req.params.id } });

    res.status(204).send();
  }
);
