import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studentsApi } from "../services/studentsApi";
import { useAuth } from "../contexts/AuthContext";

export const STUDENTS_KEY = ["students"] as const;
export const ADMISSIONS_KEY = ["admissions"] as const;

export function useStudents(params?: { collegeId?: string; cursor?: string; limit?: number; status?: string }) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("STUDENTS_READ") || permissions.includes("STUDENTS_WRITE");

  return useQuery({
    queryKey: [...STUDENTS_KEY, params],
    queryFn: () => studentsApi.getStudents(params),
    enabled: canRead,
  });
}

export function useStudent(studentId: string) {
  return useQuery({
    queryKey: [...STUDENTS_KEY, studentId],
    queryFn: () => studentsApi.getStudent(studentId),
    enabled: !!studentId,
  });
}

export function useAdmissions(params?: { collegeId?: string; status?: string }) {
  return useQuery({
    queryKey: [...ADMISSIONS_KEY, params],
    queryFn: () => studentsApi.getAdmissions(params),
  });
}

export function useSubmitAdmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: studentsApi.submitAdmission,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STUDENTS_KEY });
      void qc.invalidateQueries({ queryKey: ADMISSIONS_KEY });
    },
  });
}

export function useUpdateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, data }: { studentId: string; data: Record<string, unknown> }) =>
      studentsApi.updateStudent(studentId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: STUDENTS_KEY }),
  });
}

export function useDeleteStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: studentsApi.deleteStudent,
    onSuccess: () => qc.invalidateQueries({ queryKey: STUDENTS_KEY }),
  });
}

export function useUpdateAdmissionWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, action, notes }: { studentId: string; action: string; notes?: string }) =>
      studentsApi.updateAdmissionWorkflow(studentId, action, notes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STUDENTS_KEY });
      void qc.invalidateQueries({ queryKey: ADMISSIONS_KEY });
    },
  });
}

export function useUploadStudentPhoto() {
  return useMutation({
    mutationFn: ({ studentId, file }: { studentId: string; file: File }) =>
      studentsApi.uploadStudentPhoto(studentId, file),
  });
}

export function useUploadAdmissionDocument() {
  return useMutation({
    mutationFn: ({ admissionId, file, type }: { admissionId: string; file: File; type: string }) =>
      studentsApi.uploadAdmissionDocument(admissionId, file, type),
  });
}
