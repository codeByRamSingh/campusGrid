import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const healthRouter = Router();

// Liveness probe: Is the service running? (can respond to requests)
healthRouter.get("/health/live", (_req, res) => {
  res.json({
    status: "alive",
    service: "campusgrid-backend",
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe: Is the service ready to serve requests? (DB connectivity check)
healthRouter.get("/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ready",
      service: "campusgrid-backend",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "not_ready",
      service: "campusgrid-backend",
      database: "disconnected",
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
});

// Combined health check: Legacy endpoint for backward compatibility
healthRouter.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      service: "campusgrid-backend",
      database: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      service: "campusgrid-backend",
      database: "unavailable",
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
});
