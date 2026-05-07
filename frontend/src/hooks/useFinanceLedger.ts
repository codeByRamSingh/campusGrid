import { useQuery } from "@tanstack/react-query";
import { financeApi } from "../services/financeApi";
import { useAuth } from "../contexts/AuthContext";

export const LEDGER_KEY = ["finance-ledger"] as const;
export const CASH_LEDGER_KEY = ["finance-cash-ledger"] as const;
export const LEDGER_BALANCE_KEY = ["finance-ledger-balance"] as const;
export const CONSISTENCY_CHECK_KEY = ["finance-consistency-check"] as const;

export function useLedger(params?: { collegeId?: string; period?: string }) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("FINANCE_READ") || permissions.includes("FINANCE_WRITE");

  return useQuery({
    queryKey: [...LEDGER_KEY, params],
    queryFn: () => financeApi.getLedger(params),
    enabled: canRead,
  });
}

export function useCashLedger(params: { college_id: string; start_date?: string; end_date?: string } | null) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("FINANCE_READ") || permissions.includes("FINANCE_WRITE");

  return useQuery({
    queryKey: [...CASH_LEDGER_KEY, params],
    queryFn: () => financeApi.getCashLedger(params!),
    enabled: canRead && !!params?.college_id,
    staleTime: 30_000,
  });
}

export function useLedgerBalance(collegeId: string | undefined) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("FINANCE_READ") || permissions.includes("FINANCE_WRITE");

  return useQuery({
    queryKey: [...LEDGER_BALANCE_KEY, collegeId],
    queryFn: () => financeApi.getLedgerBalance(collegeId!),
    enabled: canRead && !!collegeId,
    staleTime: 60_000,
  });
}

export function useConsistencyCheck(collegeId: string | undefined) {
  const { permissions } = useAuth();
  // Only finance approvers / admins can run this
  const canRun = permissions.includes("FINANCE_APPROVE");

  return useQuery({
    queryKey: [...CONSISTENCY_CHECK_KEY, collegeId],
    queryFn: () => financeApi.getConsistencyCheck(collegeId!),
    enabled: canRun && !!collegeId,
    // Don't auto-refresh; this is an on-demand check
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
