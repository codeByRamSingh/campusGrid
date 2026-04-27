import { UserRole } from "@prisma/client";

export type AppPermission =
  | "ACADEMIC_READ"
  | "ADMIN_MANAGE"
  | "AUDIT_READ"
  | "ADMISSIONS_APPROVE"
  | "FINANCE_APPROVE"
  | "FINANCE_READ"
  | "FINANCE_WRITE"
  | "HR_ATTENDANCE"
  | "HR_READ"
  | "HR_WRITE"
  | "PAYROLL_READ"
  | "REPORTS_READ"
  | "SETTINGS_MANAGE"
  | "SETTINGS_COLLEGE"
  | "STUDENTS_READ"
  | "STUDENTS_WRITE"
  | "WORKFLOW_READ"
  | "EXCEPTIONS_READ"
  | "EXCEPTIONS_WRITE"
  | "EXCEPTIONS_RESOLVE"
  | "EXAM_READ"
  | "EXAM_WRITE"
  | "HOSTEL_READ"
  | "HOSTEL_WRITE"
  | "LIBRARY_READ"
  | "LIBRARY_WRITE"
  | "TRANSPORT_READ"
  | "TRANSPORT_WRITE";

export const allPermissions: AppPermission[] = [
  "ACADEMIC_READ",
  "ADMIN_MANAGE",
  "AUDIT_READ",
  "ADMISSIONS_APPROVE",
  "FINANCE_APPROVE",
  "FINANCE_READ",
  "FINANCE_WRITE",
  "HR_ATTENDANCE",
  "HR_READ",
  "HR_WRITE",
  "PAYROLL_READ",
  "REPORTS_READ",
  "SETTINGS_MANAGE",
  "SETTINGS_COLLEGE",
  "STUDENTS_READ",
  "STUDENTS_WRITE",
  "WORKFLOW_READ",
  "EXCEPTIONS_READ",
  "EXCEPTIONS_WRITE",
  "EXCEPTIONS_RESOLVE",
  "EXAM_READ",
  "EXAM_WRITE",
  "HOSTEL_READ",
  "HOSTEL_WRITE",
  "LIBRARY_READ",
  "LIBRARY_WRITE",
  "TRANSPORT_READ",
  "TRANSPORT_WRITE",
];

export type StaffRoleName =
  | "COLLEGE_ADMIN"
  | "ADMISSIONS_OPERATOR"
  | "CASHIER"
  | "HR_OPERATOR"
  | "ATTENDANCE_OPERATOR"
  | "AUDITOR";

const staffRolePermissions: Record<StaffRoleName, AppPermission[]> = {
  COLLEGE_ADMIN: [
    "ACADEMIC_READ",
    "AUDIT_READ",
    "ADMISSIONS_APPROVE",
    "FINANCE_APPROVE",
    "FINANCE_READ",
    "FINANCE_WRITE",
    "HR_ATTENDANCE",
    "HR_READ",
    "HR_WRITE",
    "PAYROLL_READ",
    "REPORTS_READ",
    "SETTINGS_COLLEGE",
    "STUDENTS_READ",
    "STUDENTS_WRITE",
    "WORKFLOW_READ",
    "EXCEPTIONS_READ",
    "EXCEPTIONS_WRITE",
    "EXCEPTIONS_RESOLVE",
    "EXAM_READ",
    "EXAM_WRITE",
    "HOSTEL_READ",
    "HOSTEL_WRITE",
    "LIBRARY_READ",
    "LIBRARY_WRITE",
    "TRANSPORT_READ",
    "TRANSPORT_WRITE",
  ],
  ADMISSIONS_OPERATOR: [
    "ACADEMIC_READ", "STUDENTS_READ", "STUDENTS_WRITE", "WORKFLOW_READ",
    "EXCEPTIONS_READ", "EXCEPTIONS_WRITE",
    "EXAM_READ", "HOSTEL_READ", "LIBRARY_READ", "TRANSPORT_READ",
  ],
  CASHIER: [
    "ACADEMIC_READ", "ADMISSIONS_APPROVE", "FINANCE_READ", "FINANCE_WRITE",
    "REPORTS_READ", "WORKFLOW_READ", "EXCEPTIONS_READ", "EXCEPTIONS_WRITE",
    "HOSTEL_READ", "LIBRARY_READ", "TRANSPORT_READ",
  ],
  HR_OPERATOR: [
    "ACADEMIC_READ", "HR_ATTENDANCE", "HR_READ", "HR_WRITE", "PAYROLL_READ",
    "REPORTS_READ", "EXCEPTIONS_READ", "EXCEPTIONS_WRITE",
  ],
  ATTENDANCE_OPERATOR: ["ACADEMIC_READ", "HR_ATTENDANCE", "HR_READ", "STUDENTS_READ"],
  AUDITOR: [
    "ACADEMIC_READ", "AUDIT_READ", "FINANCE_READ", "HR_READ", "REPORTS_READ",
    "STUDENTS_READ", "WORKFLOW_READ", "EXCEPTIONS_READ", "EXCEPTIONS_WRITE",
    "EXAM_READ", "HOSTEL_READ", "LIBRARY_READ", "TRANSPORT_READ",
  ],
};

export function normalizePermissions(input: unknown): AppPermission[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const validPermissions = new Set(allPermissions);
  return Array.from(
    new Set(
      input.filter(
        (permission): permission is AppPermission =>
          typeof permission === "string" && validPermissions.has(permission as AppPermission)
      )
    )
  );
}

export function getPermissionsForUser(
  userRole: UserRole,
  staffRole?: string | null,
  options?: { hasCustomRole?: boolean; customRolePermissions?: unknown }
): AppPermission[] {
  if (userRole === "SUPER_ADMIN") {
    return allPermissions;
  }

  if (options?.hasCustomRole) {
    return normalizePermissions(options.customRolePermissions);
  }

  if (!staffRole || !(staffRole in staffRolePermissions)) {
    return [];
  }

  return staffRolePermissions[staffRole as StaffRoleName] ?? [];
}
