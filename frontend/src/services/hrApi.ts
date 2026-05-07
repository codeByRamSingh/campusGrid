import { api } from "./api";

export type Staff = {
  id: string;
  fullName: string;
  email: string;
  mobile: string;
  collegeId: string;
  role?: string;
  designation?: string;
  staffType?: string;
  employmentType?: string;
  joiningDate?: string;
  customRoleId?: string;
  isActive?: boolean;
};

export type SalaryConfig = {
  id: string;
  staffId: string;
  basicSalary: number;
  hra: number;
  da: number;
  otherAllowances: number;
  bankAccountNumber: string | null;
  bankName: string | null;
  ifscCode: string | null;
  pan: string | null;
  pfUan: string | null;
  paymentMode: string;
};

export type SalaryConfigMap = Record<string, SalaryConfig>;

export type AttendanceRow = { id: string; date: string; status: string; staff: { fullName: string } };
export type LeaveRow = { id: string; fromDate: string; toDate: string; status: string; staff: { fullName: string }; reason: string };
export type PayrollRow = { id: string; month: number; year: number; amount: number; grossAmount?: number; netAmount?: number; status: string; paidAt?: string | null; staff: { id?: string; fullName: string } };

export type PaginatedResponse<T> = { data: T[]; nextCursor?: string; hasMore: boolean };

export const hrApi = {
  // ─── Staff ──────────────────────────────────────────────────────────────────
  getStaff: (collegeId?: string) =>
    api.get<Staff[]>("/hr/staff", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  createStaff: (data: Record<string, unknown>) =>
    api.post<{ id: string; email: string; fullName: string; role: string; invite: { expiresAt: string } }>("/hr/staff", data).then((r) => r.data),

  updateStaff: (staffId: string, data: Record<string, unknown>) =>
    api.patch<Staff>(`/hr/staff/${staffId}`, data).then((r) => r.data),

  deleteStaff: (staffId: string) =>
    api.delete(`/hr/staff/${staffId}`).then((r) => r.data),

  reinviteStaff: (staffId: string) =>
    api.post(`/hr/staff/${staffId}/reinvite`).then((r) => r.data),

  // ─── Salary ─────────────────────────────────────────────────────────────────
  getSalaryConfig: (staffId: string) =>
    api.get<SalaryConfig | null>(`/hr/staff/${staffId}/salary`).then((r) => r.data),

  getSalaryConfigs: (collegeId?: string) =>
    api.get<SalaryConfigMap>("/hr/salary-configs", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  setSalaryConfig: (staffId: string, data: Partial<SalaryConfig>) =>
    api.put<SalaryConfig>(`/hr/staff/${staffId}/salary`, data).then((r) => r.data),

  // ─── Attendance ─────────────────────────────────────────────────────────────
  getAttendance: (params?: { staffId?: string; startDate?: string; endDate?: string; cursor?: string; limit?: number }) =>
    api.get<PaginatedResponse<AttendanceRow>>("/hr/attendance", { params }).then((r) => r.data),

  markAttendance: (data: { staffId: string; date: string; status: string; remarks?: string }) =>
    api.post<AttendanceRow>("/hr/attendance", data).then((r) => r.data),

  // ─── Leave ──────────────────────────────────────────────────────────────────
  getLeaveRequests: (params?: { staffId?: string; status?: string; startDate?: string; endDate?: string }) =>
    api.get<PaginatedResponse<LeaveRow>>("/hr/leave-requests", { params }).then((r) => r.data),

  updateLeaveStatus: (leaveRequestId: string, status: "APPROVED" | "REJECTED") =>
    api.patch<LeaveRow>(`/hr/leave-requests/${leaveRequestId}/status`, { status }).then((r) => r.data),

  getLeaveBalance: (staffId: string, year?: number) =>
    api.get(`/hr/leave-balance/${staffId}`, { params: year ? { year } : {} }).then((r) => r.data),

  setLeaveBalance: (staffId: string, data: { leaveType: string; totalDays: number; year: number }) =>
    api.put(`/hr/leave-balance/${staffId}`, data).then((r) => r.data),

  // ─── Payroll ────────────────────────────────────────────────────────────────
  getPayroll: (staffId?: string) =>
    api.get<PayrollRow[]>("/hr/payroll", { params: staffId ? { staffId } : {} }).then((r) => r.data),

  processPayroll: (data: Record<string, unknown>) =>
    api.post<PayrollRow>("/hr/payroll", data).then((r) => r.data),

  updatePayrollStatus: (payrollId: string, status: "PROCESSED" | "PAID" | "REVERSED") =>
    api.patch<PayrollRow>(`/hr/payroll/${payrollId}/status`, { status }).then((r) => r.data),

  // ─── Documents ──────────────────────────────────────────────────────────────
  getStaffDocuments: (staffId: string) =>
    api.get(`/hr/staff/${staffId}/documents`).then((r) => r.data),

  uploadStaffDocument: (staffId: string, file: File, label?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (label) form.append("label", label);
    return api.post(`/hr/staff/${staffId}/documents`, form, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
  },

  // ─── Onboarding Drafts ──────────────────────────────────────────────────────
  getOnboardingDrafts: (collegeId?: string) =>
    api.get("/hr/onboarding-drafts", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  createOnboardingDraft: (data: { collegeId: string; formDataJson: string; step?: number }) =>
    api.post("/hr/onboarding-drafts", data).then((r) => r.data),

  updateOnboardingDraft: (draftId: string, data: { formDataJson?: string; step?: number }) =>
    api.patch(`/hr/onboarding-drafts/${draftId}`, data).then((r) => r.data),

  deleteOnboardingDraft: (draftId: string) =>
    api.delete(`/hr/onboarding-drafts/${draftId}`).then((r) => r.data),
};
