import { api } from "./api";

export type ExceptionStatus = "NEW" | "TRIAGED" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | "REOPENED";
export type ExceptionSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ExceptionCase = {
  id: string;
  collegeId: string;
  module: string;
  category: string;
  title: string;
  description: string;
  severity: ExceptionSeverity;
  status: ExceptionStatus;
  sourceEntityType?: string;
  sourceEntityId?: string;
  sourceOperation?: string;
  isRetryable?: boolean;
  retryCount?: number;
  maxRetries?: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type ExceptionMetrics = {
  total: number;
  resolved: number;
  reopened: number;
  resolutionRate: number;
  mttrHours: number;
  byStatus: Array<{ status: string; count: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  aging: Array<{ bucket: string; count: number }>;
};

export type ExceptionHistory = {
  id: string;
  fromStatus: string;
  toStatus: string;
  transitionedAt: string;
  notes?: string;
  actor?: { fullName: string };
};

export const exceptionsApi = {
  createException: (data: Record<string, unknown>) =>
    api.post<ExceptionCase>("/exceptions", data).then((r) => r.data),

  getExceptions: (params?: { collegeId?: string; module?: string; status?: string; severity?: string; cursor?: string; limit?: number }) =>
    api.get<ExceptionCase[]>("/exceptions", { params }).then((r) => r.data),

  getMetrics: (params?: { collegeId?: string }) =>
    api.get<ExceptionMetrics>("/exceptions/metrics", { params }).then((r) => r.data),

  getException: (exceptionCaseId: string) =>
    api.get<ExceptionCase>(`/exceptions/${exceptionCaseId}`).then((r) => r.data),

  getHistory: (exceptionCaseId: string) =>
    api.get<ExceptionHistory[]>(`/exceptions/${exceptionCaseId}/history`).then((r) => r.data),

  transition: (exceptionCaseId: string, data: { action: string; notes?: string }) =>
    api.patch(`/exceptions/${exceptionCaseId}/transition`, data).then((r) => r.data),

  transitionBulk: (data: { exceptionCaseIds: string[]; action: string; notes?: string }) =>
    api.post("/exceptions/transition-bulk", data).then((r) => r.data),

  retry: (exceptionCaseId: string) =>
    api.post(`/exceptions/${exceptionCaseId}/retry`).then((r) => r.data),

  runAutomation: () =>
    api.post("/exceptions/automation/run").then((r) => r.data),
};
