import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "../services/adminApi";
import { useAuth } from "../contexts/AuthContext";

export const ACADEMIC_STRUCTURE_KEY = ["academic-structure"] as const;
export const COLLEGES_KEY = ["colleges"] as const;
export const CUSTOM_ROLES_KEY = ["custom-roles"] as const;
export const USERS_KEY = ["users"] as const;

export function useAcademicStructure(collegeId?: string) {
  const { user, permissions } = useAuth();
  const canRead = user?.role === "SUPER_ADMIN" || permissions.includes("ACADEMIC_READ");

  return useQuery({
    queryKey: [...ACADEMIC_STRUCTURE_KEY, collegeId],
    queryFn: () => adminApi.getAcademicStructure(collegeId),
    enabled: canRead,
  });
}

export function useColleges(collegeId?: string) {
  return useQuery({
    queryKey: [...COLLEGES_KEY, collegeId],
    queryFn: () => adminApi.getColleges(collegeId),
  });
}

export function useCustomRoles(collegeId?: string) {
  const { user, permissions } = useAuth();
  const canRead = user?.role === "SUPER_ADMIN" || permissions.includes("HR_WRITE");

  return useQuery({
    queryKey: [...CUSTOM_ROLES_KEY, collegeId],
    queryFn: () => adminApi.getCustomRoles(collegeId),
    enabled: canRead,
  });
}

export function useUsers() {
  const { user } = useAuth();

  return useQuery({
    queryKey: USERS_KEY,
    queryFn: () => adminApi.getUsers(),
    enabled: user?.role === "SUPER_ADMIN",
  });
}

export function useCreateCollege() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createCollege,
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useUpdateCollege() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => adminApi.updateCollege(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useDeleteCollege() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.deleteCollege,
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useCreateCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createCourse,
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useUpdateCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => adminApi.updateCourse(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useDeleteCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.deleteCourse,
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useUpdateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => adminApi.updateSession(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.deleteSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useCreateSubject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createSubject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useUpdateSubject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => adminApi.updateSubject(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useDeleteSubject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.deleteSubject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ACADEMIC_STRUCTURE_KEY }),
  });
}

export function useCreateCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createCustomRole,
    onSuccess: () => qc.invalidateQueries({ queryKey: CUSTOM_ROLES_KEY }),
  });
}

export function useUpdateCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => adminApi.updateCustomRole(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: CUSTOM_ROLES_KEY }),
  });
}

export function useDeleteCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.deleteCustomRole,
    onSuccess: () => qc.invalidateQueries({ queryKey: CUSTOM_ROLES_KEY }),
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) => adminApi.assignRole(email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  });
}
