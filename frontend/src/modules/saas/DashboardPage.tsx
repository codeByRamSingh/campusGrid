import { useMemo, useState } from "react";
import { AIInsightsPanel } from "../../components/dashboard/AIInsightsPanel";
import { AdmissionsFunnelChart } from "../../components/dashboard/AdmissionsFunnelChart";
import { CollegePerformanceChart } from "../../components/dashboard/CollegePerformanceChart";
import { CriticalIssuesList } from "../../components/dashboard/CriticalIssuesList";
import { KPIStrip } from "../../components/dashboard/KPIStrip";
import { OutstandingAgingChart } from "../../components/dashboard/OutstandingAgingChart";
import { RevenueVsCollectionChart } from "../../components/dashboard/RevenueVsCollectionChart";

type College = {
  id: string;
  name: string;
  courses: Array<{
    id: string;
    name: string;
    sessions: Array<{ id: string; label: string; seatCount?: number; sessionFee?: number }>;
  }>;
};
type Student = {
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
type Staff = { id: string; fullName: string; role?: string; collegeId: string };
type Attendance = { id: string; date: string; status: string };
type Leave = { id: string; fromDate: string; status: string; staff: { fullName: string } };
type Payroll = { id: string; amount: number; month: number; year: number };
type Ledger = { totalFeeDeposit: number; totalExpenses: number; closingBalance: number } | null;

type WorkflowInbox = {
  sections: Array<{
    id: string;
    title: string;
    count: number;
    nav: string;
    items: Array<{
      id: string;
      title: string;
      subtitle: string;
    }>;
  }>;
  summary: {
    approvals: number;
    exceptions: number;
    tasks: number;
    total: number;
  };
};

type DashboardSummary = {
  kpis: {
    totalFeeCollected: number;
    outstandingFees: number;
    collectionRate: number;
    newAdmissions: number;
    admissionTrend: number;
    payrollCost: number;
    staffStrength: number;
    complianceAlerts: number;
    seatUtilization: number;
    activeStudents: number;
    totalSeats: number;
  };
  collectionByCollege: Array<{
    collegeId: string;
    college: string;
    billed: number;
    collected: number;
    outstanding: number;
    collectionPct: number;
    admissions: number;
  }>;
  admissionsPipeline: Array<{
    stage: string;
    value: number;
    conversionPct: number;
  }>;
  receivablesAging: {
    buckets: Array<{ label: string; count: number; amount: number }>;
  };
  recentFeeSubmissions: Array<{
    id: string;
    receiptNumber: string;
    cycleLabel?: string | null;
    amount: number;
    collectedAt: string;
    studentId: string;
    candidateName: string;
    admissionRef: string;
    college: string;
  }>;
};

type Props = {
  colleges: College[];
  students: Student[];
  staff: Staff[];
  attendanceRows: Attendance[];
  leaveRows: Leave[];
  payrollRows: Payroll[];
  ledger: Ledger;
  workflowInbox: WorkflowInbox;
  dashboardSummary: DashboardSummary | null;
  loading: boolean;
  dashboardFilters: {
    collegeId: string;
    courseId: string;
    sessionId: string;
  };
  onChangeDashboardFilters: (next: { collegeId?: string; courseId?: string; sessionId?: string }) => void;
  onRunAdmissionAction: (studentId: string, action: "SEND_FOR_APPROVAL" | "APPROVE" | "REJECT" | "REQUEST_CHANGES") => Promise<void>;
  onUpdateLeaveStatus: (leaveRequestId: string, status: "APPROVED" | "REJECTED") => Promise<void>;
  onNavigate: (target: "students" | "finance" | "hr" | "admin" | "settings" | "dashboard") => void;
};

export function DashboardPage({ colleges, students, staff, attendanceRows, payrollRows, ledger, workflowInbox, dashboardSummary, dashboardFilters, onChangeDashboardFilters, onNavigate }: Props) {
  const [dateRange, setDateRange] = useState<"month" | "quarter" | "year">("month");
  const [txnFilter, setTxnFilter] = useState<"today" | "week" | "month">("month");

  const filteredStudents = useMemo(
    () =>
      students.filter((student) => {
        if (dashboardFilters.collegeId !== "ALL" && student.collegeId !== dashboardFilters.collegeId) {
          return false;
        }
        const latestAdmission = student.admissions?.[0];
        if (dashboardFilters.courseId !== "ALL" && latestAdmission?.courseId !== dashboardFilters.courseId) {
          return false;
        }
        if (dashboardFilters.sessionId !== "ALL" && latestAdmission?.sessionId !== dashboardFilters.sessionId) {
          return false;
        }
        return true;
      }),
    [students, dashboardFilters]
  );

  const filteredStaff = useMemo(
    () => staff.filter((member) => (dashboardFilters.collegeId === "ALL" ? true : member.collegeId === dashboardFilters.collegeId)),
    [staff, dashboardFilters.collegeId]
  );

  const collectedRevenue = dashboardSummary?.kpis.totalFeeCollected ?? ledger?.totalFeeDeposit ?? 0;
  const totalPayable = filteredStudents.reduce((sum, student) => sum + Number(student.totalPayable), 0);
  const outstandingAmount = dashboardSummary?.kpis.outstandingFees ?? Math.max(0, totalPayable - collectedRevenue);
  const activeStudents = dashboardSummary?.kpis.activeStudents ?? filteredStudents.filter((student) => student.status === "ACTIVE").length;
  const totalStaff = dashboardSummary?.kpis.staffStrength ?? filteredStaff.length;
  const payrollCost = dashboardSummary?.kpis.payrollCost ?? payrollRows.reduce((sum, row) => sum + Number(row.amount), 0);

  const admissionsSection = workflowInbox.sections.find((section) => section.id === "admissions-awaiting-approval");
  const payrollSection = workflowInbox.sections.find((section) => section.id === "payroll-exception-requiring-review");
  const feeSection = workflowInbox.sections.find((section) => section.id === "fee-dispute-pending-action");

  const payrollExceptions = payrollSection?.count ?? 0;
  const feeDisputes = feeSection?.count ?? 0;
  const complianceAlerts = dashboardSummary?.kpis.complianceAlerts ?? Math.max((admissionsSection?.count ?? 0) + payrollExceptions + feeDisputes, 0);
  const currentAdmissions = dashboardSummary?.kpis.newAdmissions ?? filteredStudents.length;
  const admissionTrend = dashboardSummary?.kpis.admissionTrend ?? 0;

  const collectionRate = dashboardSummary?.kpis.collectionRate ?? (totalPayable > 0 ? (collectedRevenue / totalPayable) * 100 : 0);
  const retentionRate = filteredStudents.length > 0 ? (activeStudents / filteredStudents.length) * 100 : 0;
  const totalSeats =
    dashboardSummary?.kpis.totalSeats ??
    colleges.flatMap((college) => college.courses).flatMap((course) => course.sessions).reduce((sum, session) => sum + Number(session.seatCount ?? 0), 0);
  const seatUtilization = dashboardSummary?.kpis.seatUtilization ?? (totalSeats > 0 ? (activeStudents / totalSeats) * 100 : 0);

  const collegeEfficiencyData = (dashboardSummary?.collectionByCollege ?? [])
    .filter((row) => (dashboardFilters.collegeId === "ALL" ? true : row.collegeId === dashboardFilters.collegeId))
    .sort((a, b) => a.collectionPct - b.collectionPct);

  const revenueChartData = collegeEfficiencyData.map((row) => ({
    college: row.college,
    billed: row.billed,
    collected: row.collected,
    outstanding: row.outstanding,
    collectionPct: row.collectionPct,
  }));

  const admissionsPipelineData = dashboardSummary?.admissionsPipeline ?? [];

  const collegeLeaderboardData = collegeEfficiencyData.map((row) => ({
    college: row.college,
    revenue: row.billed,
    collectionPct: row.collectionPct,
    admissions: row.admissions,
    status: row.collectionPct >= 85 ? ("Healthy" as const) : row.collectionPct >= 70 ? ("Watch" as const) : ("At Risk" as const),
  }));

  const outstandingAgingData =
    dashboardSummary?.receivablesAging.buckets.map((bucket) => ({
      period: bucket.label === "90+" ? "90+ days" : `${bucket.label} days`,
      count: bucket.count,
      amount: bucket.amount,
    })) ?? [];

  const recentFeeSubmissions = useMemo(() => {
    const now = new Date();
    const startOf = (unit: "today" | "week" | "month") => {
      const d = new Date(now);
      if (unit === "today") { d.setHours(0, 0, 0, 0); return d; }
      if (unit === "week") { d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d; }
      d.setDate(1); d.setHours(0, 0, 0, 0); return d;
    };
    const from = startOf(txnFilter);
    return (dashboardSummary?.recentFeeSubmissions ?? [])
      .filter((receipt) => new Date(receipt.collectedAt) >= from)
      .slice(0, 50)
      .map((receipt) => ({
        id: receipt.id,
        student: receipt.candidateName,
        receiptNumber: receipt.receiptNumber,
        cycleLabel: receipt.cycleLabel,
        college: receipt.college,
        amount: receipt.amount,
        date: new Date(receipt.collectedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      }));
  }, [dashboardSummary, txnFilter]);

  const criticalIssues = [
    {
      id: "1",
      priority: "High" as const,
      issue: "Fee aging above 90 days",
      module: "Finance",
      assigned: "Accountant",
    },
    {
      id: "2",
      priority: payrollExceptions > 0 ? ("High" as const) : ("Medium" as const),
      issue: `${payrollExceptions.toLocaleString()} payroll exceptions pending`,
      module: "HR",
      assigned: "HR Manager",
    },
    {
      id: "3",
      priority: feeDisputes > 0 ? ("Medium" as const) : ("Low" as const),
      issue: `${feeDisputes.toLocaleString()} fee disputes pending action`,
      module: "Finance",
      assigned: "Collections Lead",
    },
    {
      id: "4",
      priority: complianceAlerts > 6 ? ("Medium" as const) : ("Low" as const),
      issue: `${complianceAlerts.toLocaleString()} compliance alerts open`,
      module: "Admin",
      assigned: "Compliance Officer",
    },
  ];

  const weakestCollege = collegeEfficiencyData[0];
  const strongestCollege = collegeEfficiencyData[collegeEfficiencyData.length - 1];

  const aiInsights = [
    {
      id: "1",
      text: weakestCollege
        ? `${weakestCollege.college} collection efficiency is ${weakestCollege.collectionPct.toFixed(1)}%. Review collections team and recovery plan today.`
        : "Collection performance is stable. Continue monitoring daily inflow variances.",
      indicator: "critical" as const,
      action: { label: "Open Finance Dashboard", target: "finance" },
    },
    {
      id: "2",
      text:
        admissionTrend < 0
          ? `Admissions are down ${Math.abs(admissionTrend).toFixed(1)}% versus previous cycle. Launch scholarship and outreach campaign.`
          : `Admissions are up ${admissionTrend.toFixed(1)}% versus previous cycle. Scale counseling capacity to improve enrollment conversion.`,
      indicator: admissionTrend < 0 ? ("warning" as const) : ("positive" as const),
      action: { label: "Open Students Dashboard", target: "students" },
    },
    {
      id: "3",
      text: `Payroll cost stands at INR ${(payrollCost / 1000).toFixed(1)}K. Audit staffing mix if growth outpaces admissions.`,
      indicator: "warning" as const,
      action: { label: "Open HR Dashboard", target: "hr" },
    },
    {
      id: "4",
      text: strongestCollege
        ? `${strongestCollege.college} is performing above trust benchmark at ${strongestCollege.collectionPct.toFixed(1)}% collection.`
        : "Top-performing institution benchmark is not available yet.",
      indicator: "positive" as const,
    },
  ];

  const selectedCollege = colleges.find((college) => college.id === dashboardFilters.collegeId);
  const courseOptions = (selectedCollege?.courses ?? colleges.flatMap((college) => college.courses)).map((course) => ({
    id: course.id,
    name: course.name,
  }));
  const sessionOptions =
    dashboardFilters.courseId !== "ALL"
      ? colleges
          .flatMap((college) => college.courses)
          .find((course) => course.id === dashboardFilters.courseId)
          ?.sessions.map((session) => ({ id: session.id, label: session.label })) ?? []
      : (selectedCollege?.courses ?? colleges.flatMap((college) => college.courses)).flatMap((course) =>
          course.sessions.map((session) => ({ id: session.id, label: session.label }))
        );

  const kpiMetrics: Array<{
    label: string;
    value: string;
    trend: number;
    trendLabel: string;
    icon: "wallet" | "users" | "alert" | "staff" | "payroll" | "compliance";
    severity: "good" | "neutral" | "warning" | "critical";
    target: "students" | "finance" | "hr" | "admin" | "settings" | "dashboard";
  }> = [
    {
      label: "Outstanding Fees",
      value: `INR ${(outstandingAmount / 1000).toFixed(1)}K`,
      trend: -Math.max(0, 100 - collectionRate),
      trendLabel: "Risk",
      icon: "alert",
      severity: outstandingAmount > totalPayable * 0.3 ? "critical" : "warning",
      target: "finance",
    },
    {
      label: "New Admissions",
      value: `${currentAdmissions.toLocaleString()} Students`,
      trend: admissionTrend,
      trendLabel: "vs Last",
      icon: "users",
      severity: admissionTrend >= 0 ? "good" : "warning",
      target: "students",
    },
    {
      label: "Payroll Cost",
      value: `INR ${(payrollCost / 1000).toFixed(1)}K`,
      trend: 2.4,
      trendLabel: "MoM",
      icon: "payroll",
      severity: "neutral",
      target: "hr",
    },
    {
      label: "Staff Strength",
      value: `${totalStaff.toLocaleString()} Employees`,
      trend: 1.6,
      trendLabel: "MoM",
      icon: "staff",
      severity: "neutral",
      target: "hr",
    },
    {
      label: "Compliance Alerts",
      value: `${complianceAlerts.toLocaleString()} Open`,
      trend: complianceAlerts > 0 ? -4.2 : 0,
      trendLabel: "Pending",
      icon: "compliance",
      severity: complianceAlerts > 6 ? "critical" : complianceAlerts > 0 ? "warning" : "good",
      target: "admin",
    },
  ];

  return (
    <div className="space-y-6 pb-8">
      <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur -mx-6 px-6 py-4 border-b border-slate-200">
        <div className="mb-4">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Trust Executive Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">Summary first, drill down later: admissions, collections, risk, and action priorities.</p>
        </div>

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 max-w-6xl">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">College</label>
            <select
              value={dashboardFilters.collegeId}
              onChange={(event) => onChangeDashboardFilters({ collegeId: event.target.value })}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none hover:border-slate-400 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              <option value="ALL">All colleges</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>
                  {college.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Course</label>
            <select
              value={dashboardFilters.courseId}
              onChange={(event) => onChangeDashboardFilters({ courseId: event.target.value })}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none hover:border-slate-400 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              <option value="ALL">All courses</option>
              {courseOptions.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Session</label>
            <select
              value={dashboardFilters.sessionId}
              onChange={(event) => onChangeDashboardFilters({ sessionId: event.target.value })}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none hover:border-slate-400 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              <option value="ALL">All sessions</option>
              {sessionOptions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Date Range</label>
            <select
              value={dateRange}
              onChange={(event) => setDateRange(event.target.value as "month" | "quarter" | "year")}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none hover:border-slate-400 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="year">This Year</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setDateRange("month");
                onChangeDashboardFilters({ collegeId: "ALL", courseId: "ALL", sessionId: "ALL" });
              }}
              className="w-full rounded-xl bg-slate-200 hover:bg-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Executive Summary</h2>
        <KPIStrip metrics={kpiMetrics} onMetricClick={(target) => target && onNavigate(target)} />

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-100">
            <p className="text-xs uppercase tracking-wide text-slate-500">Student Retention</p>
            <p className="text-lg font-semibold text-slate-900">{retentionRate.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-100">
            <p className="text-xs uppercase tracking-wide text-slate-500">Seat Utilization</p>
            <p className="text-lg font-semibold text-slate-900">{seatUtilization.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-100">
            <p className="text-xs uppercase tracking-wide text-slate-500">Scholarship Expense</p>
            <p className="text-lg font-semibold text-slate-900">Tracking</p>
          </div>
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-100">
            <p className="text-xs uppercase tracking-wide text-slate-500">Cash Flow (Expected vs Actual)</p>
            <p className="text-lg font-semibold text-slate-900">{collectionRate.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-100">
            <p className="text-xs uppercase tracking-wide text-slate-500">Employee Attrition</p>
            <p className="text-lg font-semibold text-slate-900">Tracking</p>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Strategic Health</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <RevenueVsCollectionChart data={revenueChartData} height={340} />
          <AdmissionsFunnelChart data={admissionsPipelineData} height={340} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Institutional Comparison & Risk</h2>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CollegePerformanceChart data={collegeLeaderboardData} height={280} title="College Leaderboard" />
          </div>
          <OutstandingAgingChart data={outstandingAgingData} height={280} title="Outstanding Aging Buckets" />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Risk & Action Center</h2>
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Recent Fee Submissions</h2>
                  <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                    {(["today", "week", "month"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setTxnFilter(f)}
                        className={`rounded-lg px-3 py-1 text-xs font-semibold capitalize transition-colors ${txnFilter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                      >
                        {f === "today" ? "Today" : f === "week" ? "This Week" : "This Month"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl bg-white ring-1 ring-slate-100 overflow-hidden">
                  {recentFeeSubmissions.length === 0 ? (
                    <div className="py-12 text-center text-sm text-slate-400">No fee submissions found for the selected period.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Student</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Demand</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">College</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {recentFeeSubmissions.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-800">{item.student}</td>
                            <td className="px-4 py-3 text-slate-500 font-mono text-xs">{item.receiptNumber}</td>
                            <td className="px-4 py-3 text-slate-600">{item.cycleLabel ?? "Fee"}</td>
                            <td className="px-4 py-3 text-slate-600">{item.college}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-800">INR {(item.amount / 1000).toFixed(1)}K</td>
                            <td className="px-4 py-3 text-right text-slate-500">{item.date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <CriticalIssuesList issues={criticalIssues} maxItems={6} />
          <AIInsightsPanel insights={aiInsights} title="Recommended Actions" />
        </div>
      </section>

      {attendanceRows.length === 0 && (
        <p className="text-xs text-slate-500">Attendance and payroll exception trend visualizations have been moved to HR - Workforce Analytics.</p>
      )}
    </div>
  );
}
