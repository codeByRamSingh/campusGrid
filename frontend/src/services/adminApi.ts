import { api } from "./api";

export type College = {
  id: string;
  name: string;
  code: string;
  registrationYear: number;
  address: string;
  university: string;
  startingRollNumber: number;
  startingAdmissionNumber: number;
  admissionNumberPrefix: string;
  courses: Array<{
    id: string;
    name: string;
    courseCode: string;
    courseFee: number;
    startYear?: number | null;
    endYear?: number | null;
    sessions: Array<{ id: string; label: string; startYear: number; endYear: number; startingRollNumber: number; rollNumberPrefix: string; seatCount: number; sessionFee: number }>;
    subjects: Array<{ id: string; name: string; code: string }>;
  }>;
};

export type CustomRole = {
  id: string;
  collegeId: string;
  name: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  _count?: { staff: number };
};

export type LoginAccount = {
  id: string;
  email: string;
  role: "SUPER_ADMIN" | "STAFF";
  createdAt: string;
  staff: { id: string; fullName: string; collegeId: string; isActive: boolean } | null;
};

export const adminApi = {
  getAcademicStructure: (collegeId?: string) =>
    api.get<College[]>("/admin/academic-structure", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  getColleges: (collegeId?: string) =>
    api.get<College[]>("/admin/colleges", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  createCollege: (data: Record<string, unknown>) =>
    api.post<College>("/admin/colleges", data).then((r) => r.data),

  updateCollege: (collegeId: string, data: Record<string, unknown>) =>
    api.put<College>(`/admin/colleges/${collegeId}`, data).then((r) => r.data),

  deleteCollege: (collegeId: string) =>
    api.delete(`/admin/colleges/${collegeId}`).then((r) => r.data),

  createCourse: (data: Record<string, unknown>) =>
    api.post("/admin/courses", data).then((r) => r.data),

  updateCourse: (courseId: string, data: Record<string, unknown>) =>
    api.put(`/admin/courses/${courseId}`, data).then((r) => r.data),

  deleteCourse: (courseId: string) =>
    api.delete(`/admin/courses/${courseId}`).then((r) => r.data),

  createSession: (data: Record<string, unknown>) =>
    api.post("/admin/sessions", data).then((r) => r.data),

  updateSession: (sessionId: string, data: Record<string, unknown>) =>
    api.put(`/admin/sessions/${sessionId}`, data).then((r) => r.data),

  deleteSession: (sessionId: string) =>
    api.delete(`/admin/sessions/${sessionId}`).then((r) => r.data),

  createSubject: (data: Record<string, unknown>) =>
    api.post("/admin/subjects", data).then((r) => r.data),

  updateSubject: (subjectId: string, data: Record<string, unknown>) =>
    api.put(`/admin/subjects/${subjectId}`, data).then((r) => r.data),

  deleteSubject: (subjectId: string) =>
    api.delete(`/admin/subjects/${subjectId}`).then((r) => r.data),

  getCustomRoles: (collegeId?: string) =>
    api.get<CustomRole[]>("/admin/custom-roles", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  createCustomRole: (data: Record<string, unknown>) =>
    api.post<CustomRole>("/admin/custom-roles", data).then((r) => r.data),

  updateCustomRole: (roleId: string, data: Record<string, unknown>) =>
    api.patch<CustomRole>(`/admin/custom-roles/${roleId}`, data).then((r) => r.data),

  deleteCustomRole: (roleId: string) =>
    api.delete(`/admin/custom-roles/${roleId}`).then((r) => r.data),

  getUsers: () =>
    api.get<LoginAccount[]>("/admin/users").then((r) => r.data),

  assignRole: (email: string, role: string) =>
    api.post("/admin/users/assign-role", { email, role }).then((r) => r.data),
};
