import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrApi, type SalaryConfig } from "../services/hrApi";
import { useAuth } from "../contexts/AuthContext";

export const STAFF_KEY = ["staff"] as const;
export const SALARY_CONFIGS_KEY = ["salary-configs"] as const;
export const ATTENDANCE_KEY = ["attendance"] as const;
export const LEAVE_KEY = ["leave-requests"] as const;
export const PAYROLL_KEY = ["payroll"] as const;
export const ONBOARDING_DRAFTS_KEY = ["onboarding-drafts"] as const;

export function useStaff(collegeId?: string) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("HR_READ") || permissions.includes("HR_WRITE");

  return useQuery({
    queryKey: [...STAFF_KEY, collegeId],
    queryFn: () => hrApi.getStaff(collegeId),
    enabled: canRead,
  });
}

export function useSalaryConfigs(collegeId?: string) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("PAYROLL_READ") || permissions.includes("PAYROLL_WRITE");

  return useQuery({
    queryKey: [...SALARY_CONFIGS_KEY, collegeId],
    queryFn: () => hrApi.getSalaryConfigs(collegeId),
    enabled: canRead,
  });
}

export function useAttendance(params?: { staffId?: string; startDate?: string; endDate?: string; cursor?: string; limit?: number }) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("HR_READ") || permissions.includes("HR_WRITE");

  return useQuery({
    queryKey: [...ATTENDANCE_KEY, params],
    queryFn: () => hrApi.getAttendance(params),
    enabled: canRead,
  });
}

export function useLeaveRequests(params?: { staffId?: string; status?: string; startDate?: string; endDate?: string }) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("HR_READ") || permissions.includes("HR_WRITE");

  return useQuery({
    queryKey: [...LEAVE_KEY, params],
    queryFn: () => hrApi.getLeaveRequests(params),
    enabled: canRead,
  });
}

export function usePayroll(staffId?: string) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("PAYROLL_READ") || permissions.includes("PAYROLL_WRITE");

  return useQuery({
    queryKey: [...PAYROLL_KEY, staffId],
    queryFn: () => hrApi.getPayroll(staffId),
    enabled: canRead,
  });
}

export function useOnboardingDrafts(collegeId?: string) {
  return useQuery({
    queryKey: [...ONBOARDING_DRAFTS_KEY, collegeId],
    queryFn: () => hrApi.getOnboardingDrafts(collegeId),
  });
}

export function useCreateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: hrApi.createStaff,
    onSuccess: () => qc.invalidateQueries({ queryKey: STAFF_KEY }),
  });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, data }: { staffId: string; data: Record<string, unknown> }) =>
      hrApi.updateStaff(staffId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: STAFF_KEY }),
  });
}

export function useDeleteStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: hrApi.deleteStaff,
    onSuccess: () => qc.invalidateQueries({ queryKey: STAFF_KEY }),
  });
}

export function useReinviteStaff() {
  return useMutation({ mutationFn: hrApi.reinviteStaff });
}

export function useSetSalaryConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, data }: { staffId: string; data: Partial<SalaryConfig> }) =>
      hrApi.setSalaryConfig(staffId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: SALARY_CONFIGS_KEY }),
  });
}

export function useMarkAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: hrApi.markAttendance,
    onSuccess: () => qc.invalidateQueries({ queryKey: ATTENDANCE_KEY }),
  });
}

export function useUpdateLeaveStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) =>
      hrApi.updateLeaveStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LEAVE_KEY });
      void qc.invalidateQueries({ queryKey: PAYROLL_KEY });
    },
  });
}

export function useProcessPayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: hrApi.processPayroll,
    onSuccess: () => qc.invalidateQueries({ queryKey: PAYROLL_KEY }),
  });
}

export function useUpdatePayrollStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ payrollId, status }: { payrollId: string; status: "PROCESSED" | "PAID" | "REVERSED" }) =>
      hrApi.updatePayrollStatus(payrollId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: PAYROLL_KEY }),
  });
}

export function useCreateOnboardingDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: hrApi.createOnboardingDraft,
    onSuccess: () => qc.invalidateQueries({ queryKey: ONBOARDING_DRAFTS_KEY }),
  });
}

export function useUpdateOnboardingDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, data }: { draftId: string; data: { formDataJson?: string; step?: number } }) =>
      hrApi.updateOnboardingDraft(draftId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ONBOARDING_DRAFTS_KEY }),
  });
}

export function useDeleteOnboardingDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: hrApi.deleteOnboardingDraft,
    onSuccess: () => qc.invalidateQueries({ queryKey: ONBOARDING_DRAFTS_KEY }),
  });
}

export function useUploadStaffDocument() {
  return useMutation({
    mutationFn: ({ staffId, file, label }: { staffId: string; file: File; label?: string }) =>
      hrApi.uploadStaffDocument(staffId, file, label),
  });
}
