import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { adminRouter } from "./routes/admin.routes.js";
import { auditRouter } from "./routes/audit.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { documentsRouter } from "./routes/documents.routes.js";
import { exceptionsRouter } from "./routes/exceptions.routes.js";
import { financeRouter } from "./routes/finance.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { hrRouter } from "./routes/hr.routes.js";
import { notificationsRouter } from "./routes/notifications.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { settingsRouter } from "./routes/settings.routes.js";
import { studentRouter } from "./routes/student.routes.js";
import { workflowRouter } from "./routes/workflow.routes.js";
import { examRouter } from "./routes/exam.routes.js";
import { hostelRouter } from "./routes/hostel.routes.js";
import { libraryRouter } from "./routes/library.routes.js";
import { transportRouter } from "./routes/transport.routes.js";

dotenv.config();

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret === "change-this-in-production") {
  if (process.env.NODE_ENV === "production") {
    console.error("FATAL: JWT_SECRET must be set to a strong random value in production.");
    process.exit(1);
  } else {
    console.warn("WARNING: JWT_SECRET is using the default insecure value. Set a strong secret before going to production.");
  }
}

const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, health checks)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("combined"));

app.use("/api", healthRouter);
app.use("/api", authRouter);
app.use("/api", adminRouter);
app.use("/api", workflowRouter);
app.use("/api", auditRouter);
app.use("/api", studentRouter);
app.use("/api", financeRouter);
app.use("/api", exceptionsRouter);
app.use("/api", hrRouter);
app.use("/api", reportsRouter);
app.use("/api", settingsRouter);
app.use("/api", documentsRouter);
app.use("/api", notificationsRouter);
app.use("/api", examRouter);
app.use("/api", hostelRouter);
app.use("/api", libraryRouter);
app.use("/api", transportRouter);

// 404 handler for unmatched API routes
app.use("/api", (_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Global error handler (sync and async errors forwarded via next(err))
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({ message: status === 500 ? "Internal server error" : err.message });
});
