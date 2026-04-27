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

export function hasPermission(permissions: string[], permission: AppPermission): boolean {
  return permissions.includes(permission);
}

export function hasAnyPermission(permissions: string[], required: AppPermission[]): boolean {
  return required.some((permission) => permissions.includes(permission));
}
