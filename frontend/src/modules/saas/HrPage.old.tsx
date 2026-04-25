import { FormEvent, useEffect, useMemo, useState, type ComponentType } from "react";
import { CalendarClock, FileCheck2, HandCoins, UserRound, Filter, LayoutList, Download, Columns3, SlidersHorizontal, History } from "lucide-react";
import { api } from "../../services/api";

type College = { id: string; name: string };
type Staff = { id: string; fullName: string; email: string; mobile: string; collegeId: string };
type Attendance = { id: string; date: string; status: string; staff: { fullName: string } };
type Leave = { id: string; fromDate: string; toDate: string; status: string; staff: { fullName: string } };
type Payroll = { id: string; amount: number; month: number; year: number; staff: { fullName: string } };

type Props = {
  colleges: College[];
  staff: Staff[];
  attendanceRows: Attendance[];
  leaveRows: Leave[];
  payrollRows: Payroll[];
  loading: boolean;
  onAddStaff: (payload: Record<string, unknown>) => Promise<void>;
  onProcessPayroll: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateLeaveStatus: (leaveRequestId: string, status: "APPROVED" | "REJECTED") => Promise<void>;
};

type DetailTab = "overview" | "workflow" | "history";
type AuditEntry = { id: string; action: string; entityType: string; createdAt: string; actor?: { email: string } | null };

export function HrPage({
  colleges,
  staff,
  attendanceRows,
  leaveRows,
  payrollRows,
  loading,
  onAddStaff,
  onProcessPayroll,
  onUpdateLeaveStatus,
}: Props) {
  const [savedView, setSavedView] = useState("all");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [selectedDetail, setSelectedDetail] = useState<{ type: "staff" | "leave" | "payroll"; id: string } | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const filteredStaff = useMemo(
    () =>
      staff
        .filter((member) => {
          if (savedView === "leavePending") return leaveRows.some((leave) => leave.staff.fullName === member.fullName && leave.status === "PENDING");
          if (savedView === "payrollExceptions") return !payrollRows.some((row) => row.staff.fullName === member.fullName);
          return true;
        }),
    [staff, savedView, leaveRows, payrollRows]
  );

  const selectedStaff = useMemo(
    () => (selectedDetail?.type === "staff" ? filteredStaff.find((member) => member.id === selectedDetail.id) ?? null : null),
    [selectedDetail, filteredStaff]
  );

  const selectedLeave = useMemo(
    () => (selectedDetail?.type === "leave" ? leaveRows.find((leave) => leave.id === selectedDetail.id) ?? null : null),
    [selectedDetail, leaveRows]
  );

  const selectedPayroll = useMemo(
    () => (selectedDetail?.type === "payroll" ? payrollRows.find((payroll) => payroll.id === selectedDetail.id) ?? null : null),
    [selectedDetail, payrollRows]
  );

  useEffect(() => {
    if (!selectedDetail) {
      if (leaveRows[0]) {
        setSelectedDetail({ type: "leave", id: leaveRows[0].id });
        return;
      }
      if (filteredStaff[0]) {
        setSelectedDetail({ type: "staff", id: filteredStaff[0].id });
      }
    }
  }, [selectedDetail, leaveRows, filteredStaff]);

  useEffect(() => {
    if (!selectedDetail) {
      setAuditEntries([]);
      return;
    }

    const detail = selectedDetail;

    let cancelled = false;

    async function loadAudit() {
      try {
        const params =
          detail.type === "staff"
            ? { entityType: "STAFF", entityId: detail.id, limit: 12 }
            : detail.type === "leave"
              ? { entityType: "LEAVE_REQUEST", entityId: detail.id, limit: 12 }
              : { entityType: "PAYROLL", entityId: detail.id, limit: 12 };

        const response = await api.get<AuditEntry[]>("/audit-logs", { params });
        if (!cancelled) {
          setAuditEntries(response.data);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setAuditEntries([]);
        }
      }
    }

    void loadAudit();

    return () => {
      cancelled = true;
    };
  }, [selectedDetail]);

  async function submitStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onAddStaff({
      collegeId: form.get("collegeId"),
      fullName: form.get("fullName"),
      email: form.get("email"),
      mobile: form.get("mobile"),
    });
    event.currentTarget.reset();
  }

  async function submitPayroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onProcessPayroll({
      staffId: form.get("staffId"),
      amount: Number(form.get("amount")),
      month: Number(form.get("month")),
      year: Number(form.get("year")),
    });
    event.currentTarget.reset();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">HR Operations</h1>
        <p className="mt-1 text-sm text-slate-500">Staff directory, attendance management, payroll, and leave approvals.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-2">
        <SummaryCard title="Staff Directory" value={filteredStaff.length.toString()} icon={UserRound} />
        <SummaryCard title="Attendance Logs" value={attendanceRows.length.toString()} icon={CalendarClock} />
        <SummaryCard title="Leave Approvals" value={leaveRows.filter((l) => l.status === "PENDING").length.toString()} icon={FileCheck2} />
        <SummaryCard title="Payroll Records" value={payrollRows.length.toString()} icon={HandCoins} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <h3 className="text-sm font-semibold">Add Staff Member</h3>
          <form className="mt-4 space-y-4" onSubmit={submitStaff}>
            <FormSection title="Staff Details" description="Set up the staff member against the correct college and contact profile.">
              <select name="collegeId" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required>
                {colleges.map((college) => (
                  <option key={college.id} value={college.id}>
                    {college.name}
                  </option>
                ))}
              </select>
              <input name="fullName" placeholder="Full Name" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
              <input name="email" type="email" placeholder="Email" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
              <input name="mobile" placeholder="Mobile" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
            </FormSection>
            <button className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white" type="submit" disabled={loading}>
              {loading ? "Saving..." : "Add Staff"}
            </button>
          </form>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <h3 className="text-sm font-semibold">Process Payroll</h3>
          <form className="mt-4 space-y-4" onSubmit={submitPayroll}>
            <FormSection title="Payroll Details" description="Create the payroll run with the right month, year, and employee.">
              <select name="staffId" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required>
                {filteredStaff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))}
              </select>
              <input name="amount" type="number" min="0" step="0.01" placeholder="Amount" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
              <input name="month" type="number" min="1" max="12" placeholder="Month" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
              <input name="year" type="number" min="2000" placeholder="Year" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
            </FormSection>
            <button className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white" type="submit" disabled={loading}>
              {loading ? "Processing..." : "Process Payroll"}
            </button>
          </form>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["All Staff", "all"],
          ["Pending Leave", "leavePending"],
          ["Payroll Exceptions", "payrollExceptions"],
        ].map(([label, value]) => (
          <button
            key={value}
            type="button"
            className={`rounded-xl px-3 py-1.5 text-sm font-medium ${savedView === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
            onClick={() => setSavedView(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
        <div className="space-y-4">
        <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold">Staff Directory</div>
            <div className="flex flex-wrap gap-2">
              {[
                [Filter, "Filter"],
                [LayoutList, "Saved Views"],
                [Download, "Export"],
                [SlidersHorizontal, "Bulk Actions"],
                [Columns3, "Columns"],
              ].map(([Icon, label]) => {
                const ToolbarIcon = Icon as typeof Filter;
                return (
                  <button key={label as string} type="button" className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">
                    <ToolbarIcon className="h-3.5 w-3.5" />
                    {label as string}
                  </button>
                );
              })}
            </div>
          </div>
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Mobile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStaff.map((member) => (
                <tr
                  key={member.id}
                  className={`cursor-pointer hover:bg-slate-50 ${selectedDetail?.type === "staff" && selectedDetail.id === member.id ? "bg-slate-50" : ""}`}
                  onClick={() => {
                    setSelectedDetail({ type: "staff", id: member.id });
                    setDetailTab("overview");
                  }}
                >
                  <td className="px-4 py-3">{member.fullName}</td>
                  <td className="px-4 py-3">{member.email}</td>
                  <td className="px-4 py-3">{member.mobile}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold">Leave Approval Queue</div>
            <div className="flex flex-wrap gap-2">
              {[
                [Filter, "Filter"],
                [LayoutList, "Saved Views"],
                [Download, "Export"],
                [Columns3, "Columns"],
              ].map(([Icon, label]) => {
                const ToolbarIcon = Icon as typeof Filter;
                return (
                  <button key={label as string} type="button" className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">
                    <ToolbarIcon className="h-3.5 w-3.5" />
                    {label as string}
                  </button>
                );
              })}
            </div>
          </div>
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leaveRows.slice(0, 10).map((leave) => (
                <tr
                  key={leave.id}
                  className={`cursor-pointer hover:bg-slate-50 ${selectedDetail?.type === "leave" && selectedDetail.id === leave.id ? "bg-slate-50" : ""}`}
                  onClick={() => {
                    setSelectedDetail({ type: "leave", id: leave.id });
                    setDetailTab("workflow");
                  }}
                >
                  <td className="px-4 py-3">{leave.staff.fullName}</td>
                  <td className="px-4 py-3">{new Date(leave.fromDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{new Date(leave.toDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs ${leave.status === "PENDING" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-700"}`}>
                      {leave.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {leave.status === "PENDING" ? (
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onUpdateLeaveStatus(leave.id, "APPROVED");
                          }}
                          disabled={loading}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onUpdateLeaveStatus(leave.id, "REJECTED");
                          }}
                          disabled={loading}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">No action</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Payroll Records</div>
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payrollRows.slice(0, 10).map((row) => (
                <tr
                  key={row.id}
                  className={`cursor-pointer hover:bg-slate-50 ${selectedDetail?.type === "payroll" && selectedDetail.id === row.id ? "bg-slate-50" : ""}`}
                  onClick={() => {
                    setSelectedDetail({ type: "payroll", id: row.id });
                    setDetailTab("history");
                  }}
                >
                  <td className="px-4 py-3">{row.staff.fullName}</td>
                  <td className="px-4 py-3">{row.month}/{row.year}</td>
                  <td className="px-4 py-3">INR {Number(row.amount).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">HR Detail Panel</h3>
              <p className="mt-1 text-xs text-slate-500">Selected record, workflow context, and audit history.</p>
            </div>
            <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">
              <History className="h-3.5 w-3.5" /> Audit Trail
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ["Overview", "overview"],
              ["Workflow", "workflow"],
              ["History", "history"],
            ].map(([label, value]) => (
              <button
                key={value}
                type="button"
                className={`rounded-xl px-3 py-1.5 text-sm font-medium ${detailTab === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                onClick={() => setDetailTab(value as DetailTab)}
              >
                {label}
              </button>
            ))}
          </div>

          {detailTab === "overview" && (
            <div className="mt-4 space-y-3">
              {selectedStaff && (
                <>
                  <DetailMetric label="Staff" value={selectedStaff.fullName} />
                  <DetailMetric label="Email" value={selectedStaff.email} />
                  <DetailMetric label="Mobile" value={selectedStaff.mobile} />
                  <DetailMetric label="Operational State" value="Active workforce record" />
                </>
              )}
              {selectedLeave && (
                <>
                  <DetailMetric label="Leave Staff" value={selectedLeave.staff.fullName} />
                  <DetailMetric label="Dates" value={`${new Date(selectedLeave.fromDate).toLocaleDateString()} - ${new Date(selectedLeave.toDate).toLocaleDateString()}`} />
                  <DetailMetric label="Status" value={selectedLeave.status} />
                  <DetailMetric label="Review Note" value={selectedLeave.status === "PENDING" ? "Awaiting decision" : "Decision recorded"} />
                </>
              )}
              {selectedPayroll && (
                <>
                  <DetailMetric label="Payroll Staff" value={selectedPayroll.staff.fullName} />
                  <DetailMetric label="Period" value={`${selectedPayroll.month}/${selectedPayroll.year}`} />
                  <DetailMetric label="Amount" value={`INR ${Number(selectedPayroll.amount).toLocaleString()}`} />
                </>
              )}
            </div>
          )}

          {detailTab === "workflow" && (
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-amber-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Approval Workflow</p>
                <p className="mt-2 text-lg font-semibold text-amber-900">{selectedLeave ? `${selectedLeave.staff.fullName} leave request` : "HR workflow record"}</p>
              </div>
              {[
                ["Submitted", true],
                ["Reviewed", Boolean(selectedLeave && selectedLeave.status !== "PENDING")],
                ["Decision Applied", Boolean(selectedLeave && selectedLeave.status !== "PENDING")],
              ].map(([label, complete]) => (
                <div key={label as string} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">{label as string}</span>
                  <span className={`font-medium ${complete ? "text-emerald-700" : "text-slate-400"}`}>{complete ? "Complete" : "Pending"}</span>
                </div>
              ))}
            </div>
          )}

          {detailTab === "history" && (
            <div className="mt-4 space-y-3">
              {auditEntries.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900">{entry.action.replace(/_/g, " ")}</p>
                    <span className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{entry.actor?.email ?? "System"} · {entry.entityType}</p>
                </div>
              ))}
              {auditEntries.length === 0 && <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No audit history for this selection.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

function SummaryCard({ title, value, icon: Icon }: { title: string; value: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-400">{title}</p>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-white">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-4 text-2xl font-semibold">{value}</p>
    </div>
  );
}
