import { api } from "./api";

export type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type NotificationLog = {
  id: string;
  channel: string;
  status: string;
  recipient: string;
  createdAt: string;
  error?: string;
};

export const notificationsApi = {
  getMyNotifications: () =>
    api.get<{ unreadCount: number; notifications: Notification[] }>("/notifications/mine")
      .then((r) => r.data.notifications),

  markRead: (notificationId: string) =>
    api.patch(`/notifications/${notificationId}/read`).then((r) => r.data),

  markAllRead: () =>
    api.patch("/notifications/read-all").then((r) => r.data),

  retryFailed: () =>
    api.post("/notifications/retry").then((r) => r.data),

  getLogs: (params?: { cursor?: string; limit?: number }) =>
    api.get<NotificationLog[]>("/notifications/logs", { params }).then((r) => r.data),
};
