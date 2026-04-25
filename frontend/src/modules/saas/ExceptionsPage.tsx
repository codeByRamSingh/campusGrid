import { useMemo, useState } from "react";
import { AlertOctagon, Clock3, RefreshCw, ShieldAlert, TrendingUp, Wrench } from "lucide-react";
import { hasAnyPermission } from "../../lib/permissions";

type ExceptionStatus = "NEW" | "TRIAGED" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | "REOPENED";
type ExceptionSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type ExceptionCase = {
  id: string;
  collegeId: string;
  module: string;
  category: string;
  severity: ExceptionSeverity;
  title: string;
  description: string;
  status: ExceptionStatus;
  assigneeStaffId?: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  slaDueAt?: string | null;
  escalatedAt?: string | null;
};

type ExceptionMetrics = {
  total: number;
  resolved: number;
  reopened: number;
  resolutionRate: number;
  mttrHours: number;
  byStatus: Array<{ status: string; count: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  aging: Array<{ bucket: string; count: number }>;
};

type Props = {
  exceptions: ExceptionCase[];
  metrics: ExceptionMetrics | null;
  loading: boolean;
  permissions: string[];
  onTransition: (exceptionCaseId: string, toStatus: ExceptionStatus, note?: string) => Promise<void>;
  onRunAutomation: () => Promise<void>;
  onRefresh: () => Promise<void>;
};

const statusFlow: ExceptionStatus[] = ["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];

function badgeClassForSeverity(severity: ExceptionSeverity) {
  if (severity === "CRITICAL") return "bg-rose-100 text-rose-800";
  if (severity === "HIGH") return "bg-orange-100 text-orange-800";
  if (severity === "MEDIUM") return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-800";
}

function badgeClassForStatus(status: ExceptionStatus) {
  if (status === "CLOSED") return "bg-slate-200 text-slate-800";
  if (status === "RESOLVED") return "bg-emerald-100 text-emerald-800";
  if (status === "IN_PROGRESS") return "bg-blue-100 text-blue-800";
  if (status === "REOPENED") return "bg-violet-100 text-violet-800";
  return "bg-amber-100 text-amber-800";
}

function getNextStatus(status: ExceptionStatus): ExceptionStatus | null {
  if (status === "REOPENED") return "IN_PROGRESS";
  const index = statusFlow.indexOf(status);
  if (index < 0 || index >= statusFlow.length - 1) return null;
  return statusFlow[index + 1];
}

export function ExceptionsPage({ exceptions, metrics, loading, permissions, onTransition, onRunAutomation, onRefresh }: Props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ExceptionStatus | "ALL">("ALL");
  const [severityFilter, setSeverityFilter] = useState<ExceptionSeverity | "ALL">("ALL");

  const canMutate = hasAnyPermission(permissions, ["EXCEPTIONS_WRITE", "EXCEPTIONS_RESOLVE"]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return exceptions.filter((item) => {
      if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
      if (severityFilter !== "ALL" && item.severity !== severityFilter) return false;
      if (!normalized) return true;

      return (
        item.title.toLowerCase().includes(normalized) ||
        item.description.toLowerCase().includes(normalized) ||
        item.category.toLowerCase().includes(normalized) ||
        item.module.toLowerCase().includes(normalized)
      );
    });
  }, [exceptions, query, severityFilter, statusFilter]);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-4">
        <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs uppercase tracking-wide text-slate-500">Open Cases</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{(metrics?.total ?? exceptions.length) - (metrics?.resolved ?? 0)}</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><ShieldAlert className="h-3.5 w-3.5" /> Active exception queue</div>
        </article>
        <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs uppercase tracking-wide text-slate-500">Resolution Rate</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{metrics?.resolutionRate.toFixed(1) ?? "0.0"}%</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><TrendingUp className="h-3.5 w-3.5" /> Resolved vs total</div>
        </article>
        <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs uppercase tracking-wide text-slate-500">MTTR</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{metrics?.mttrHours.toFixed(1) ?? "0.0"}h</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" /> Mean time to resolution</div>
        </article>
        <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs uppercase tracking-wide text-slate-500">Reopened</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{metrics?.reopened ?? 0}</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><AlertOctagon className="h-3.5 w-3.5" /> Requires root-cause review</div>
        </article>
      </section>

      <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title, module, category"
            className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ExceptionStatus | "ALL")}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="ALL">All statuses</option>
            <option value="NEW">New</option>
            <option value="TRIAGED">Triaged</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
            <option value="REOPENED">Reopened</option>
          </select>

          <select
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value as ExceptionSeverity | "ALL")}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="ALL">All severities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>

          <button
            type="button"
            onClick={() => void onRefresh()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>

          {canMutate && (
            <button
              type="button"
              onClick={() => void onRunAutomation()}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <Wrench className="h-4 w-4" /> Run Automation
            </button>
          )}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Module</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Retry</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const nextStatus = getNextStatus(item.status);
                return (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500">{item.category}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{item.module}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClassForSeverity(item.severity)}`}>{item.severity}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClassForStatus(item.status)}`}>{item.status}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{item.retryCount}/{item.maxRetries}</td>
                    <td className="px-3 py-2 text-slate-700">{new Date(item.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      {canMutate && nextStatus ? (
                        <button
                          type="button"
                          onClick={() => void onTransition(item.id, nextStatus, `Progressed from ${item.status} to ${nextStatus}`)}
                          className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs text-white"
                        >
                          Mark {nextStatus}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">No action</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>No exceptions match the current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
