import { api } from "./api";

export type WorkflowSection = {
  type: string;
  items: Array<{ id: string; title: string; status: string; collegeId?: string; createdAt: string }>;
};

export type WorkflowInbox = {
  sections: WorkflowSection[];
  summary: { approvals: number; exceptions: number; tasks: number; total: number };
};

export const workflowApi = {
  getInbox: (params?: { collegeId?: string; courseId?: string; sessionId?: string }) =>
    api.get<WorkflowInbox>("/workflow/inbox", { params }).then((r) => r.data),
};
