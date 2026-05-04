import { api } from "./api";

export type ExpenseReportRow = { category: string; total: number; count: number };
export type DuesFinesRow = { studentId: string; candidateName: string; admissionNumber: number; due: number; fines: number };
export type ReceivablesAgingResult = {
  buckets: Array<{ label: string; count: number; amount: number }>;
  defaulters: Array<{ studentId: string; admissionNumber: number; admissionCode?: string; candidateName: string; due: number; daysOutstanding: number }>;
};
export type LedgerSummary = { totalCollected: number; totalExpenses: number; netBalance: number; breakdown: Record<string, number> };
export type DashboardSummary = {
  totalStudents: number;
  activeStudents: number;
  totalCollected: number;
  pendingDues: number;
  totalExpenses: number;
  staffCount: number;
};
export type PayrollSummary = { month: number; year: number; totalGross: number; totalNet: number; count: number };

export const reportsApi = {
  getExpenseReport: (params?: { collegeId?: string; startDate?: string; endDate?: string }) =>
    api.get<{ data: ExpenseReportRow[]; hasMore: boolean; nextCursor?: string }>("/reports/expenses", { params }).then((r) => r.data.data),

  getDuesFines: (params?: { collegeId?: string }) =>
    api.get<DuesFinesRow[]>("/reports/dues-fines", { params }).then((r) => r.data),

  getReceivablesAging: (params?: { collegeId?: string }) =>
    api.get<ReceivablesAgingResult>("/reports/receivables-aging", { params }).then((r) => r.data),

  getLedgerSummary: (params?: { collegeId?: string; startDate?: string; endDate?: string }) =>
    api.get<LedgerSummary>("/reports/ledger-summary", { params }).then((r) => r.data),

  getDashboardSummary: (params?: { collegeId?: string }) =>
    api.get<DashboardSummary>("/reports/dashboard-summary", { params }).then((r) => r.data),

  getPayrollSummary: (params?: { collegeId?: string; year?: number }) =>
    api.get<PayrollSummary[]>("/reports/payroll-summary", { params }).then((r) => r.data),
};
