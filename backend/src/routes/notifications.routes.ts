import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate, type AuthenticatedRequest, requireRole } from "../middleware/auth.js";
import { sendNotification } from "../lib/notify.js";

export const notificationsRouter = Router();

// GET /notifications/mine — authenticated user in-app notifications
notificationsRouter.get("/notifications/mine", authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const limit = Math.min(Number(req.query.limit || 30), 100);
    const onlyUnread = String(req.query.onlyUnread || "").toLowerCase() === "true";

    const notifications = await prisma.notificationLog.findMany({
      where: {
        channel: "IN_APP",
        recipientId: req.user.id,
        ...(onlyUnread ? { isRead: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const unreadCount = await prisma.notificationLog.count({
      where: {
        channel: "IN_APP",
        recipientId: req.user.id,
        isRead: false,
      },
    });

    res.json({ unreadCount, notifications });
  } catch (err) {
    next(err);
  }
});

// PATCH /notifications/:id/read — mark one notification as read
notificationsRouter.patch("/notifications/:id/read", authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const notification = await prisma.notificationLog.findUnique({ where: { id: req.params.id } });
    if (!notification || notification.channel !== "IN_APP") {
      res.status(404).json({ message: "Notification not found" });
      return;
    }

    if (notification.recipientId !== req.user.id) {
      res.status(403).json({ message: "Cannot access another user's notification" });
      return;
    }

    const updated = await prisma.notificationLog.update({
      where: { id: req.params.id },
      data: {
        isRead: true,
        readAt: notification.readAt ?? new Date(),
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PATCH /notifications/read-all — mark all in-app notifications as read for current user
notificationsRouter.patch("/notifications/read-all", authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const result = await prisma.notificationLog.updateMany({
      where: {
        channel: "IN_APP",
        recipientId: req.user.id,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});

// POST /notifications/retry — SUPER_ADMIN only: retry FAILED notifications from last 24h
notificationsRouter.post("/notifications/retry", authenticate, requireRole("SUPER_ADMIN"), async (_req, res, next) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const failed = await prisma.notificationLog.findMany({
      where: {
        status: "FAILED",
        createdAt: { gte: since },
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    });

    let retried = 0;
    let succeeded = 0;

    for (const log of failed) {
      retried++;
      try {
        await sendNotification({
          subject: log.subject,
          body: log.body,
          collegeId: log.collegeId ?? undefined,
          recipientEmail: log.recipientEmail ?? undefined,
          recipientId: log.recipientId ?? undefined,
        });
        succeeded++;
      } catch {
        // Already logged in sendNotification
      }
    }

    res.json({ retried, succeeded, failed: retried - succeeded });
  } catch (err) {
    next(err);
  }
});

// GET /notifications/logs — SUPER_ADMIN only: view recent notification logs
notificationsRouter.get("/notifications/logs", authenticate, requireRole("SUPER_ADMIN"), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const status = req.query.status as string | undefined;

    const logs = await prisma.notificationLog.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    res.json(logs);
  } catch (err) {
    next(err);
  }
});
