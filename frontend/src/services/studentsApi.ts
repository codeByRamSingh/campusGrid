import { api } from "./api";

export type Student = {
  id: string;
  candidateName: string;
  admissionNumber: number;
  admissionCode?: string;
  status: string;
  totalPayable: number;
  collegeId: string;
  createdAt?: string;
  admissions?: Array<{ id: string; courseId: string; sessionId: string; createdAt?: string }>;
};

export type StudentDocument = {
  id: string;
  documentId: string;
  docType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  uploadedAt: string;
};

export type PaginatedResponse<T> = { data: T[]; nextCursor?: string; hasMore: boolean };

export const studentsApi = {
  getStudents: (params?: { collegeId?: string; cursor?: string; limit?: number; status?: string }) =>
    api.get<PaginatedResponse<Student> | Student[]>("/students", { params }).then((r) => r.data),

  getStudent: (studentId: string) =>
    api.get<Student>(`/students/${studentId}`).then((r) => r.data),

  submitAdmission: (data: Record<string, unknown>) =>
    api.post<{ student: { id: string; admissionNumber: number; admissionCode?: string; candidateName: string } }>("/students/admissions", data).then((r) => r.data),

  updateStudent: (studentId: string, data: Record<string, unknown>) =>
    api.patch<Student>(`/students/${studentId}`, data).then((r) => r.data),

  deleteStudent: (studentId: string) =>
    api.patch(`/students/${studentId}`, { status: "SOFT_DELETED" }).then((r) => r.data),

  updateAdmissionWorkflow: (studentId: string, action: string, notes?: string) =>
    api.patch(`/students/${studentId}/workflow`, { action, notes }).then((r) => r.data),

  getStudentTimeline: (studentId: string) =>
    api.get(`/students/${studentId}/timeline`).then((r) => r.data),

  getAdmissions: (params?: { collegeId?: string; status?: string }) =>
    api.get("/students/admissions", { params }).then((r) => r.data),

  uploadStudentPhoto: (studentId: string, file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return api.post<{ photoUrl: string }>(`/students/${studentId}/photo`, form, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
  },

  uploadAdmissionDocument: (admissionId: string, file: File, type: string) => {
    const form = new FormData();
    form.append("document", file);
    form.append("type", type);
    return api.post(`/students/admissions/${admissionId}/documents`, form, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
  },

  getStudentDocuments: (studentId: string) =>
    api.get<{ documents: StudentDocument[]; admissionId: string | null }>(`/students/${studentId}/documents`).then((r) => r.data),

  uploadStudentDocument: (studentId: string, file: File, docType: string) => {
    const form = new FormData();
    form.append("document", file);
    form.append("docType", docType);
    return api.post<StudentDocument>(`/students/${studentId}/documents`, form, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
  },

  deleteStudentDocument: (studentId: string, admissionDocId: string) =>
    api.delete(`/students/${studentId}/documents/${admissionDocId}`).then((r) => r.data),

  getDocumentDownloadUrl: (documentId: string) =>
    `${api.defaults.baseURL}/documents/${documentId}/download`,
};
