import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { financeApi } from "../services/financeApi";
import { useAuth } from "../contexts/AuthContext";

export const EXPENSES_KEY = ["expenses"] as const;
export const VENDORS_KEY = ["vendors"] as const;
export const CREDITS_KEY = ["credits"] as const;
export const BUDGETS_KEY = ["budgets"] as const;
export const PETTY_CASH_KEY = ["petty-cash"] as const;
export const FINE_POLICY_KEY = ["fine-policy"] as const;
export const FEE_EXCEPTIONS_KEY = ["fee-exceptions"] as const;
export const VENDOR_PAYMENTS_KEY = ["vendor-payments"] as const;

export function useExpenses(params?: { cursor?: string; limit?: number; status?: string }) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("FINANCE_READ") || permissions.includes("FINANCE_WRITE");

  return useQuery({
    queryKey: [...EXPENSES_KEY, params],
    queryFn: () => financeApi.getExpenses(params),
    enabled: canRead,
  });
}

export function useVendors(collegeId?: string) {
  return useQuery({
    queryKey: [...VENDORS_KEY, collegeId],
    queryFn: () => financeApi.getVendors(collegeId),
  });
}

export function useCredits(collegeId?: string) {
  return useQuery({
    queryKey: [...CREDITS_KEY, collegeId],
    queryFn: () => financeApi.getCredits(collegeId),
  });
}

export function useBudgets(collegeId?: string) {
  return useQuery({
    queryKey: [...BUDGETS_KEY, collegeId],
    queryFn: () => financeApi.getBudgets(collegeId),
  });
}

export function usePettyCash(collegeId?: string) {
  return useQuery({
    queryKey: [...PETTY_CASH_KEY, collegeId],
    queryFn: () => financeApi.getPettyCash(collegeId),
  });
}

export function useFinePolicy(collegeId: string) {
  return useQuery({
    queryKey: [...FINE_POLICY_KEY, collegeId],
    queryFn: () => financeApi.getFinePolicy(collegeId),
    enabled: !!collegeId,
  });
}

export function useFeeExceptions(params?: { studentId?: string; collegeId?: string }) {
  return useQuery({
    queryKey: [...FEE_EXCEPTIONS_KEY, params],
    queryFn: () => financeApi.getFeeExceptions(params),
  });
}

export function useVendorPayments(vendorId?: string) {
  return useQuery({
    queryKey: [...VENDOR_PAYMENTS_KEY, vendorId],
    queryFn: () => financeApi.getVendorPayments(vendorId),
  });
}

export function useCollectFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: financeApi.collectFee,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["students"] }),
  });
}

export function useSaveFeeDraft() {
  return useMutation({ mutationFn: financeApi.saveFeeDraft });
}

export function useConfirmFeeDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: financeApi.confirmFeeDraft,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["students"] }),
  });
}

export function useRaiseFeeException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: financeApi.raiseFeeException,
    onSuccess: () => qc.invalidateQueries({ queryKey: FEE_EXCEPTIONS_KEY }),
  });
}

export function useReviewFeeException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ exceptionId, data }: { exceptionId: string; data: { status: string; reviewNote?: string } }) =>
      financeApi.reviewFeeException(exceptionId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEE_EXCEPTIONS_KEY }),
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: financeApi.createExpense,
    onSuccess: () => qc.invalidateQueries({ queryKey: EXPENSES_KEY }),
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId, data }: { expenseId: string; data: Record<string, unknown> }) =>
      financeApi.updateExpense(expenseId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXPENSES_KEY }),
  });
}

export function useApproveExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId, data }: { expenseId: string; data: { status: string; rejectionNote?: string } }) =>
      financeApi.approveExpense(expenseId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXPENSES_KEY }),
  });
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: financeApi.createVendor,
    onSuccess: () => qc.invalidateQueries({ queryKey: VENDORS_KEY }),
  });
}

export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ vendorId, data }: { vendorId: string; data: Record<string, unknown> }) =>
      financeApi.updateVendor(vendorId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: VENDORS_KEY }),
  });
}

export function useAddMiscCredit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: financeApi.addMiscCredit,
    onSuccess: () => qc.invalidateQueries({ queryKey: CREDITS_KEY }),
  });
}

export function useUpsertBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: financeApi.upsertBudget,
    onSuccess: () => qc.invalidateQueries({ queryKey: BUDGETS_KEY }),
  });
}

export function useAddPettyCash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: financeApi.addPettyCash,
    onSuccess: () => qc.invalidateQueries({ queryKey: PETTY_CASH_KEY }),
  });
}

export function useUpsertFinePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: financeApi.upsertFinePolicy,
    onSuccess: () => qc.invalidateQueries({ queryKey: FINE_POLICY_KEY }),
  });
}

export function useRecordVendorPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ vendorId, data }: { vendorId: string; data: Record<string, unknown> }) =>
      financeApi.recordVendorPayment(vendorId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: VENDOR_PAYMENTS_KEY }),
  });
}
