import { useQuery } from "@tanstack/react-query";
import { financeApi } from "../services/financeApi";
import { useAuth } from "../contexts/AuthContext";

export const LEDGER_KEY = ["finance-ledger"] as const;

export function useLedger(params?: { collegeId?: string; period?: string }) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("FINANCE_READ") || permissions.includes("FINANCE_WRITE");

  return useQuery({
    queryKey: [...LEDGER_KEY, params],
    queryFn: () => financeApi.getLedger(params),
    enabled: canRead,
  });
}
