import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { exceptionsApi } from "../services/exceptionsApi";
import { useAuth } from "../contexts/AuthContext";

export const EXCEPTIONS_KEY = ["exceptions"] as const;
export const EXCEPTION_METRICS_KEY = ["exception-metrics"] as const;

function useExceptionsEnabled() {
  const { permissions } = useAuth();
  return permissions.includes("EXCEPTIONS_READ") || permissions.includes("EXCEPTIONS_WRITE");
}

export function useExceptions(params?: { collegeId?: string; module?: string; status?: string; severity?: string; cursor?: string; limit?: number }) {
  const enabled = useExceptionsEnabled();
  return useQuery({
    queryKey: [...EXCEPTIONS_KEY, params],
    queryFn: () => exceptionsApi.getExceptions(params),
    enabled,
  });
}

export function useExceptionMetrics(params?: { collegeId?: string }) {
  const enabled = useExceptionsEnabled();
  return useQuery({
    queryKey: [...EXCEPTION_METRICS_KEY, params],
    queryFn: () => exceptionsApi.getMetrics(params),
    enabled,
  });
}

export function useException(exceptionCaseId: string) {
  return useQuery({
    queryKey: [...EXCEPTIONS_KEY, exceptionCaseId],
    queryFn: () => exceptionsApi.getException(exceptionCaseId),
    enabled: !!exceptionCaseId,
  });
}

export function useExceptionHistory(exceptionCaseId: string) {
  return useQuery({
    queryKey: [...EXCEPTIONS_KEY, exceptionCaseId, "history"],
    queryFn: () => exceptionsApi.getHistory(exceptionCaseId),
    enabled: !!exceptionCaseId,
  });
}

export function useCreateException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: exceptionsApi.createException,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EXCEPTIONS_KEY });
      void qc.invalidateQueries({ queryKey: EXCEPTION_METRICS_KEY });
    },
  });
}

export function useTransitionException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { action: string; notes?: string } }) =>
      exceptionsApi.transition(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EXCEPTIONS_KEY });
      void qc.invalidateQueries({ queryKey: EXCEPTION_METRICS_KEY });
    },
  });
}

export function useTransitionExceptionBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: exceptionsApi.transitionBulk,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EXCEPTIONS_KEY });
      void qc.invalidateQueries({ queryKey: EXCEPTION_METRICS_KEY });
    },
  });
}

export function useRetryException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: exceptionsApi.retry,
    onSuccess: () => qc.invalidateQueries({ queryKey: EXCEPTIONS_KEY }),
  });
}
