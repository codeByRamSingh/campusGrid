/**
 * NOTIF-01: Notification service
 * Sends emails via SMTP (if configured) and always writes a NotificationLog entry.
 */
import nodemailer from "nodemailer";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

interface SendNotificationOptions {
  collegeId?: string;
  recipientEmail?: string;
  recipientId?: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}

interface SendInAppNotificationOptions {
  collegeId?: string;
  recipientId: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}


function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null; // SMTP not configured — log-only mode
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendNotification(opts: SendNotificationOptions): Promise<void> {
  const log = await prisma.notificationLog.create({
    data: {
      collegeId: opts.collegeId ?? null,
      recipientId: opts.recipientId ?? null,
      recipientEmail: opts.recipientEmail ?? null,
      channel: "EMAIL",
      subject: opts.subject,
      body: opts.body,
      status: "PENDING",
      metadata: (opts.metadata != null ? opts.metadata : Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });

  const transporter = buildTransporter();
  const from = process.env.SMTP_FROM ?? "noreply@campusgrid.local";

  if (!transporter || !opts.recipientEmail) {
    // Dev mode — just mark as SENT (logged only)
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: "SENT_LOG_ONLY", sentAt: new Date() },
    });
    console.log(`[notify] ${opts.subject} → ${opts.recipientEmail ?? "no recipient"}`);
    return;
  }

  try {
    await transporter.sendMail({
      from,
      to: opts.recipientEmail,
      subject: opts.subject,
      text: opts.body,
    });
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: "SENT", sentAt: new Date() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: "FAILED", error: message },
    });
    console.error(`[notify] Failed to send "${opts.subject}": ${message}`);
  }
}

export async function sendInAppNotification(opts: SendInAppNotificationOptions): Promise<void> {
  await prisma.notificationLog.create({
    data: {
      collegeId: opts.collegeId ?? null,
      recipientId: opts.recipientId,
      channel: "IN_APP",
      subject: opts.subject,
      body: opts.body,
      status: "SENT",
      sentAt: new Date(),
      isRead: false,
      metadata: (opts.metadata != null ? opts.metadata : Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });
}
