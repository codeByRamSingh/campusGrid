import { useQuery } from "@tanstack/react-query";
import { workflowApi } from "../services/workflowApi";
import { useAuth } from "../contexts/AuthContext";

export const WORKFLOW_INBOX_KEY = ["workflow-inbox"] as const;

export function useWorkflowInbox(params?: { collegeId?: string; courseId?: string; sessionId?: string }) {
  const { permissions } = useAuth();
  const canRead = permissions.includes("WORKFLOW_READ");

  return useQuery({
    queryKey: [...WORKFLOW_INBOX_KEY, params],
    queryFn: () => workflowApi.getInbox(params),
    enabled: canRead,
  });
}
