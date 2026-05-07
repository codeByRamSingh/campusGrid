import { useQuery } from "@tanstack/react-query";
import { reportsApi } from "../services/reportsApi";
import { useAuth } from "../contexts/AuthContext";

export const DASHBOARD_SUMMARY_KEY = ["dashboard-summary"] as const;
export const EXPENSE_REPORT_KEY = ["report-expenses"] as const;
export const DUES_FINES_KEY = ["report-dues-fines"] as const;
export const RECEIVABLES_AGING_KEY = ["report-receivables-aging"] as const;
export const LEDGER_SUMMARY_KEY = ["report-ledger-summary"] as const;
export const PAYROLL_SUMMARY_KEY = ["report-payroll-summary"] as const;

function useReportsEnabled() {
  const { permissions } = useAuth();
  return permissions.includes("REPORTS_READ");
}

export function useDashboardSummary(params?: { collegeId?: string; courseId?: string; sessionId?: string }) {
  const enabled = useReportsEnabled();
  return useQuery({
    queryKey: [...DASHBOARD_SUMMARY_KEY, params],
    queryFn: () => reportsApi.getDashboardSummary(params),
    enabled,
  });
}

export function useExpenseReport(params?: { collegeId?: string; startDate?: string; endDate?: string }) {
  const enabled = useReportsEnabled();
  return useQuery({
    queryKey: [...EXPENSE_REPORT_KEY, params],
    queryFn: () => reportsApi.getExpenseReport(params),
    enabled,
  });
}

export function useDuesFines(params?: { collegeId?: string }) {
  const enabled = useReportsEnabled();
  return useQuery({
    queryKey: [...DUES_FINES_KEY, params],
    queryFn: () => reportsApi.getDuesFines(params),
    enabled,
  });
}

export function useReceivablesAging(params?: { collegeId?: string }) {
  const enabled = useReportsEnabled();
  return useQuery({
    queryKey: [...RECEIVABLES_AGING_KEY, params],
    queryFn: () => reportsApi.getReceivablesAging(params),
    enabled,
  });
}

export function useLedgerSummary(params?: { collegeId?: string; startDate?: string; endDate?: string }) {
  const enabled = useReportsEnabled();
  return useQuery({
    queryKey: [...LEDGER_SUMMARY_KEY, params],
    queryFn: () => reportsApi.getLedgerSummary(params),
    enabled,
  });
}

export function usePayrollSummary(params?: { collegeId?: string; year?: number }) {
  const enabled = useReportsEnabled();
  return useQuery({
    queryKey: [...PAYROLL_SUMMARY_KEY, params],
    queryFn: () => reportsApi.getPayrollSummary(params),
    enabled,
  });
}
