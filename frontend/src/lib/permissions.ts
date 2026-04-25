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
  | "REPORTS_READ"
  | "SETTINGS_MANAGE"
  | "STUDENTS_READ"
  | "STUDENTS_WRITE"
  | "WORKFLOW_READ"
  | "EXCEPTIONS_READ"
  | "EXCEPTIONS_WRITE"
  | "EXCEPTIONS_RESOLVE";

export function hasPermission(permissions: string[], permission: AppPermission): boolean {
  return permissions.includes(permission);
}

export function hasAnyPermission(permissions: string[], required: AppPermission[]): boolean {
  return required.some((permission) => permissions.includes(permission));
}
