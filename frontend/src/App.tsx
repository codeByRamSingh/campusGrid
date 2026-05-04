import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useAuth } from "./contexts/AuthContext";
import { useAcademicStructure, useUsers, useCustomRoles, useCreateCollege, useUpdateCollege, useDeleteCollege, useCreateCourse, useUpdateCourse, useDeleteCourse, useCreateSession, useUpdateSession, useDeleteSession, useCreateSubject, useUpdateSubject, useDeleteSubject, useCreateCustomRole, useUpdateCustomRole, useDeleteCustomRole } from "./hooks/useAcademicStructure";
import { useSettings, useUpdateSettings } from "./hooks/useSettings";
import { useMyNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "./hooks/useNotifications";
import { useWorkflowInbox } from "./hooks/useWorkflow";
import { useStudents } from "./hooks/useStudents";
import { useLeaveRequests } from "./hooks/useHr";
import { hasAnyPermission, hasPermission } from "./lib/permissions";
import {
  Bell,
  BookOpen,
  BedDouble,
  Building2,
  Bus,
  CalendarDays,
  Check,
  ChevronDown,
  Command,
  Grid2x2,
  Inbox,
  LayoutDashboard,
  Minus,
  ListTodo,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldAlert,
  Users,
  Wallet,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { LoginForm } from "./components/LoginForm";

const DashboardPage = lazy(() => import("./modules/saas/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const StudentsPage = lazy(() => import("./modules/saas/StudentsPage").then((module) => ({ default: module.StudentsPage })));
const FinancePage = lazy(() => import("./modules/saas/FinancePage").then((module) => ({ default: module.FinancePage })));
const HrPage = lazy(() => import("./modules/saas/HrPage").then((module) => ({ default: module.HrPage })));
const ExceptionsPage = lazy(() => import("./modules/saas/ExceptionsPage").then((module) => ({ default: module.ExceptionsPage })));
const ExamPage = lazy(() => import("./modules/saas/ExamPage").then((module) => ({ default: module.default })));
const HostelPage = lazy(() => import("./modules/saas/HostelPage").then((module) => ({ default: module.default })));
const LibraryPage = lazy(() => import("./modules/saas/LibraryPage").then((module) => ({ default: module.default })));
const TransportPage = lazy(() => import("./modules/saas/TransportPage").then((module) => ({ default: module.default })));

type College = {
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
    sessions: Array<{ id: string; label: string; startYear: number; endYear: number; startingRollNumber: number; rollNumberPrefix: string; seatCount: number; sessionFee: number }>;
    subjects: Array<{ id: string; name: string; code: string }>;
  }>;
};

type NavKey = "dashboard" | "students" | "finance" | "hr" | "exceptions" | "exam" | "hostel" | "library" | "transport" | "admin" | "settings";

type WorkflowInbox = {
  sections: Array<{
    id: string;
    title: string;
    count: number;
    nav: NavKey;
    items: Array<{ id: string; title: string; subtitle: string }>;
  }>;
  summary: { approvals: number; exceptions: number; tasks: number; total: number };
};

type NotificationItem = {
  id: string;
  title: string;
  subtitle: string;
  nav: NavKey;
  severity?: "info" | "warning" | "critical";
  isRead: boolean;
};

type LoginAccount = {
  id: string;
  email: string;
  role: "SUPER_ADMIN" | "STAFF";
  createdAt: string;
  staff: { id: string; fullName: string; collegeId: string; isActive: boolean } | null;
};

type CustomRole = {
  id: string;
  collegeId: string;
  name: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  _count?: { staff: number };
};

const navigation = [
  { key: "dashboard" as NavKey, label: "Dashboard", icon: LayoutDashboard },
  { key: "students" as NavKey, label: "Students", icon: Users },
  { key: "finance" as NavKey, label: "Finance", icon: Wallet },
  { key: "hr" as NavKey, label: "HR", icon: Receipt },
  { key: "exceptions" as NavKey, label: "Exceptions", icon: ShieldAlert },
  { key: "exam" as NavKey, label: "Exams", icon: CalendarDays },
  { key: "hostel" as NavKey, label: "Hostel", icon: BedDouble },
  { key: "library" as NavKey, label: "Library", icon: BookOpen },
  { key: "transport" as NavKey, label: "Transport", icon: Bus },
  { key: "admin" as NavKey, label: "Admin", icon: Building2 },
  { key: "settings" as NavKey, label: "Settings", icon: Settings },
];

const queueItems = [
  { key: "approvals", label: "Approvals", icon: Receipt },
  { key: "exceptions", label: "Exceptions", icon: ShieldAlert },
  { key: "tasks", label: "Tasks", icon: ListTodo },
];

export default function App() {
  const { user, permissions, login, logout: authLogout } = useAuth();
  const [activeNav, setActiveNav] = useState<NavKey>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");

  const { data: notificationsData } = useMyNotifications();
  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();
  const { data: workflowInboxData } = useWorkflowInbox();
  const { data: studentsForBadge } = useStudents();
  const { data: leaveData } = useLeaveRequests();
  const { data: settingsData } = useSettings();
  const canViewDashboard = hasPermission(permissions, "REPORTS_READ");
  const canViewStudents = hasPermission(permissions, "STUDENTS_READ");
  const canViewFinance = hasPermission(permissions, "FINANCE_READ");
  const canViewHr = hasAnyPermission(permissions, ["HR_READ", "HR_ATTENDANCE"]);
  const canViewExceptions = hasPermission(permissions, "EXCEPTIONS_READ");
  const canViewAdmin = user?.role === "SUPER_ADMIN";
  const canViewSettings = user?.role === "SUPER_ADMIN";
  const canViewExam = hasPermission(permissions, "EXAM_READ");
  const canViewHostel = hasPermission(permissions, "HOSTEL_READ");
  const canViewLibrary = hasPermission(permissions, "LIBRARY_READ");
  const canViewTransport = hasPermission(permissions, "TRANSPORT_READ");

  const accessibleNavigation = useMemo(
    () =>
      navigation.filter((item) => {
        if (item.key === "dashboard") return canViewDashboard;
        if (item.key === "students") return canViewStudents;
        if (item.key === "finance") return canViewFinance;
        if (item.key === "hr") return canViewHr;
        if (item.key === "exceptions") return canViewExceptions;
        if (item.key === "exam") return canViewExam;
        if (item.key === "hostel") return canViewHostel;
        if (item.key === "library") return canViewLibrary;
        if (item.key === "transport") return canViewTransport;
        if (item.key === "admin") return canViewAdmin;
        if (item.key === "settings") return canViewSettings;
        return false;
      }),
    [canViewAdmin, canViewDashboard, canViewExceptions, canViewExam, canViewFinance, canViewHostel, canViewHr, canViewLibrary, canViewSettings, canViewStudents, canViewTransport]
  );

  useEffect(() => {
    if (!user || accessibleNavigation.length === 0) {
      return;
    }

    if (!accessibleNavigation.some((item) => item.key === activeNav)) {
      setActiveNav(accessibleNavigation[0].key);
    }
  }, [activeNav, accessibleNavigation, user]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        setCreateMenuOpen(false);
        setProfileMenuOpen(false);
        setInboxOpen(false);
        setNotificationOpen(false);
      }

      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
        setCreateMenuOpen(false);
        setProfileMenuOpen(false);
        setInboxOpen(false);
        setNotificationOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const navBadges = useMemo(
    () => {
      const studentList = Array.isArray(studentsForBadge)
        ? studentsForBadge
        : (studentsForBadge as { data?: { status: string }[] } | undefined)?.data ?? [];
      const leaveList = (leaveData as { data?: { status: string }[] } | undefined)?.data ?? [];
      return {
        students: studentList.filter((s) => s.status !== "ACTIVE").length,
        finance: 0,
        hr: leaveList.filter((l) => l.status === "PENDING").length,
      };
    },
    [studentsForBadge, leaveData]
  );

  const workflowInbox = (workflowInboxData ?? { sections: [], summary: { approvals: 0, exceptions: 0, tasks: 0, total: 0 } }) as unknown as WorkflowInbox;
  const queueBadges = workflowInbox.summary;
  const approvalInboxItems = workflowInbox.sections;
  const inboxCount = workflowInbox.summary.total;

  const notificationItems = useMemo<NotificationItem[]>(() => {
    return (notificationsData ?? []).map((entry) => ({
      id: entry.id,
      title: entry.title,
      subtitle: entry.body,
      nav: (entry.metadata?.nav as NavKey | undefined) ?? "dashboard",
      severity: (entry.metadata?.severity as "info" | "warning" | "critical" | undefined) ?? "info",
      isRead: entry.isRead,
    }));
  }, [notificationsData]);

  const unreadNotificationCount = notificationItems.filter((n) => !n.isRead).length;

  const commandActions = useMemo(
    () => [
      { id: "student-1023", label: "Go to Student 1023", description: "Open Students workspace and focus the directory.", nav: "students" as NavKey },
      { id: "generate-payroll", label: "Generate Payroll", description: "Open the HR payroll workspace.", nav: "hr" as NavKey },
      { id: "collect-fee", label: "Collect Fee", description: "Open finance fee collection.", nav: "finance" as NavKey },
      { id: "exceptions-queue", label: "Open Exceptions Queue", description: "Review finance and HR exceptions.", nav: "exceptions" as NavKey },
      { id: "approval-inbox", label: "Open Approval Inbox", description: "Review admissions, payroll, and fee disputes.", nav: "dashboard" as NavKey, opensInbox: true },
      { id: "settings", label: "Open Settings", description: "View branding, notifications, and integrations.", nav: "settings" as NavKey },
    ],
    []
  );

  const allowedCreateActions = useMemo(
    () =>
      [
        canViewStudents && hasPermission(permissions, "STUDENTS_WRITE") ? (["New Student", "student"] as const) : null,
        canViewFinance && hasPermission(permissions, "FINANCE_WRITE") ? (["Collect Fee", "fee"] as const) : null,
        canViewHr && hasPermission(permissions, "HR_WRITE") ? (["Add Staff", "staff"] as const) : null,
        canViewFinance && hasPermission(permissions, "FINANCE_WRITE") ? (["Expense", "expense"] as const) : null,
        canViewHr && hasPermission(permissions, "HR_WRITE") ? (["Payroll Run", "payroll"] as const) : null,
      ].filter(Boolean) as Array<[string, "student" | "fee" | "staff" | "expense" | "payroll"]>,
    [canViewFinance, canViewHr, canViewStudents, permissions]
  );

  const filteredCommands = useMemo(() => {
    const normalizedQuery = commandQuery.trim().toLowerCase();
    const allowedCommands = commandActions.filter((action) => accessibleNavigation.some((item) => item.key === action.nav));
    if (!normalizedQuery) {
      return allowedCommands;
    }

    return allowedCommands.filter(
      (action) =>
        action.label.toLowerCase().includes(normalizedQuery) ||
        action.description.toLowerCase().includes(normalizedQuery)
    );
  }, [accessibleNavigation, commandActions, commandQuery]);

  function openQueue(queueKey: string) {
    if (queueKey === "approvals") {
      setInboxOpen(true);
      setActiveNav("dashboard");
      return;
    }
    if (queueKey === "exceptions") {
      setActiveNav("exceptions");
      return;
    }
    if (queueKey === "tasks") {
      setActiveNav("hr");
    }
  }

  function runCommand(action: (typeof commandActions)[number]) {
    setCommandPaletteOpen(false);
    setCommandQuery("");
    setActiveNav(action.nav);
    if (action.opensInbox) {
      setInboxOpen(true);
    }
  }

  function runCreateAction(action: "student" | "fee" | "staff" | "expense" | "payroll") {
    setCreateMenuOpen(false);
    if (action === "student") {
      setActiveNav("students");
      return;
    }
    if (action === "fee" || action === "expense") {
      setActiveNav("finance");
      return;
    }
    if (action === "staff" || action === "payroll") {
      setActiveNav("hr");
    }
  }

  async function openNotification(item: NotificationItem) {
    void markReadMutation.mutateAsync(item.id);
    setNotificationOpen(false);
    setActiveNav(item.nav);
  }

  if (!user) {
    return (
      <>
        <LoginForm onSuccess={login} />
        <Toaster richColors position="top-right" closeButton />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="flex min-h-screen">
        <aside
          className={`sticky top-0 h-screen border-r border-slate-200 bg-white/90 p-4 backdrop-blur transition-all duration-300 ${
            sidebarCollapsed ? "w-[92px]" : "w-[284px]"
          }`}
        >
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-slate-700">
                <Grid2x2 className="h-4 w-4" />
              </div>
              {!sidebarCollapsed && (
                <div>
                  <p className="text-sm font-semibold">{settingsData?.trust?.name ?? "CampusGrid"}</p>
                  <p className="text-xs text-slate-500">Application Shell</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Toggle sidebar"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${sidebarCollapsed ? "-rotate-90" : "rotate-90"}`} />
            </button>
          </div>

          {!sidebarCollapsed && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">App Launcher</p>}
          <nav className="space-y-1">
            {accessibleNavigation.map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.key;
              const badge = item.key === "students" ? navBadges.students : item.key === "finance" ? navBadges.finance : item.key === "hr" ? navBadges.hr : 0;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveNav(item.key)}
                  className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium transition ${
                    active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-white" : "text-slate-500 group-hover:text-slate-700"}`} />
                  {!sidebarCollapsed && <span className="flex-1">{item.label}</span>}
                  {!sidebarCollapsed && badge > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-white/15 text-white" : "bg-rose-50 text-rose-700"}`}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {!sidebarCollapsed && (
            <div className="mt-8">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Work Queues</p>
              <div className="space-y-1 rounded-2xl border border-slate-200 bg-slate-50/80 p-2">
                {queueItems.map((item) => {
                  const Icon = item.icon;
                  const badge = queueBadges[item.key as keyof typeof queueBadges];

                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => openQueue(item.key)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-white"
                    >
                      <Icon className="h-4 w-4 text-slate-500" />
                      <span className="flex-1 text-left">{item.label}</span>
                      {badge > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">{badge}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative min-w-[220px] flex-1">
                <input
                  className="w-full rounded-2xl border-0 bg-slate-100 px-4 py-2.5 text-sm text-slate-700 outline-none ring-1 ring-transparent transition focus:ring-slate-300"
                  placeholder="Search students, staff, transactions..."
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-4">
                <div
                  className="max-w-[320px] truncate rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700"
                  title={settingsData?.trust?.name ?? "CampusGrid ERP"}
                >
                  {settingsData?.trust?.name ?? "CampusGrid ERP"}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    disabled={allowedCreateActions.length === 0}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    onClick={() => {
                      setCreateMenuOpen((open) => !open);
                      setProfileMenuOpen(false);
                      setInboxOpen(false);
                    }}
                  >
                    <Plus className="h-4 w-4" /> Create <ChevronDown className="h-4 w-4" />
                  </button>
                  {createMenuOpen && (
                    <div className="absolute right-0 top-12 z-30 w-48 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                      {allowedCreateActions.map(([label, action]) => (
                        <button
                          key={label}
                          type="button"
                          className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                          onClick={() => runCreateAction(action as "student" | "fee" | "staff" | "expense" | "payroll")}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                    onClick={() => {
                      setInboxOpen((open) => !open);
                      setCreateMenuOpen(false);
                      setProfileMenuOpen(false);
                    }}
                  >
                    <Inbox className="h-4 w-4" /> Inbox ({inboxCount})
                  </button>
                  {inboxOpen && (
                    <div className="absolute right-0 top-12 z-30 w-[360px] rounded-3xl border border-slate-200 bg-white p-3 shadow-xl">
                      <div className="mb-3 flex items-center justify-between px-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Approval Inbox</p>
                          <p className="text-xs text-slate-500">Enterprise review queue</p>
                        </div>
                        <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">{inboxCount}</span>
                      </div>
                      <div className="space-y-2">
                        {approvalInboxItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="block w-full rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-left hover:bg-slate-100"
                            onClick={() => {
                              setInboxOpen(false);
                              setActiveNav(item.nav);
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-slate-900">{item.title}</p>
                              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{item.count}</span>
                            </div>
                            <div className="mt-2 space-y-1">
                              {item.items.slice(0, 3).map((entry) => (
                                <p key={entry.id} className="text-xs text-slate-500">{entry.title} · {entry.subtitle}</p>
                              ))}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    className="relative rounded-2xl border border-slate-200 bg-white p-2.5 text-slate-500"
                    onClick={() => {
                      setNotificationOpen((open) => !open);
                      setCreateMenuOpen(false);
                      setInboxOpen(false);
                      setProfileMenuOpen(false);
                    }}
                  >
                    <Bell className="h-4 w-4" />
                    {unreadNotificationCount > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />}
                  </button>
                  {notificationOpen && (
                    <div className="absolute right-0 top-12 z-30 w-[360px] rounded-3xl border border-slate-200 bg-white p-3 shadow-xl">
                      <div className="mb-2 flex items-center justify-between px-1">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Notifications</p>
                          <p className="text-xs text-slate-500">Realtime ops and queue alerts</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">{unreadNotificationCount}</span>
                          <button
                            type="button"
                            className="text-xs font-medium text-slate-600 hover:text-slate-900"
                            onClick={() => {
                              void markAllReadMutation.mutateAsync();
                            }}
                          >
                            Mark all read
                          </button>
                        </div>
                      </div>
                      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                        {notificationItems.length === 0 && <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">No notifications right now.</p>}
                        {notificationItems.map((item) => {
                          const unread = !item.isRead;
                          const accent =
                            item.severity === "critical"
                              ? "bg-rose-500"
                              : item.severity === "warning"
                                ? "bg-amber-500"
                                : "bg-sky-500";
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={`block w-full rounded-2xl border p-3 text-left hover:bg-slate-50 ${unread ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50/80"}`}
                              onClick={() => {
                                void openNotification(item);
                              }}
                            >
                              <div className="flex items-start gap-3">
                                <span className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${accent}`} />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                                  <p className="mt-1 text-xs text-slate-500">{item.subtitle}</p>
                                </div>
                                {unread && <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">new</span>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                    onClick={() => {
                      setProfileMenuOpen((open) => !open);
                      setCreateMenuOpen(false);
                      setInboxOpen(false);
                    }}
                  >
                    {user.email.split("@")[0]} <ChevronDown className="h-4 w-4" />
                  </button>
                  {profileMenuOpen && (
                    <div className="absolute right-0 top-12 z-30 w-44 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                      {[
                        ["Profile", "profile"],
                        ["Settings", "settings"],
                        ["Logout", "logout"],
                      ].map(([label, action]) => (
                        <button
                          key={label}
                          type="button"
                          className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            if (action === "settings") {
                              setActiveNav("settings");
                            }
                            if (action === "logout") {
                              authLogout();
                            }
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 px-6 py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeNav}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <Suspense fallback={<WorkspaceLoadingState nav={activeNav} />}>
                  {activeNav === "dashboard" && (
                    <DashboardPage onNavigate={setActiveNav} />
                  )}

                  {activeNav === "students" && (
                    <StudentsPage />
                  )}

                  {activeNav === "finance" && (
                    <FinancePage />
                  )}

                  {activeNav === "hr" && (
                    <HrPage />
                  )}

                  {activeNav === "exceptions" && (
                    <ExceptionsPage />
                  )}

                  {activeNav === "exam" && <ExamPage />}

                  {activeNav === "hostel" && <HostelPage />}

                  {activeNav === "library" && <LibraryPage />}

                  {activeNav === "transport" && <TransportPage />}

                  {(activeNav === "admin" || activeNav === "settings") && (
                    <EnterpriseAdminSettingsPanel activeNav={activeNav} />
                  )}
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      <AnimatePresence>
        {commandPaletteOpen && (
          <motion.div className="fixed inset-0 z-40 bg-slate-950/30 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 18, opacity: 0 }}
              className="mx-auto mt-20 w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl"
            >
              <div className="flex items-center gap-3 rounded-2xl bg-slate-100 px-4 py-3">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  autoFocus
                  value={commandQuery}
                  onChange={(event) => setCommandQuery(event.target.value)}
                  placeholder="Go to Student 1023, Generate Payroll, Collect Fee..."
                  className="w-full bg-transparent text-sm text-slate-700 outline-none"
                />
                <span className="rounded-lg bg-white px-2 py-1 text-[11px] text-slate-500 ring-1 ring-slate-200">Esc</span>
              </div>

              <div className="mt-4 space-y-2">
                {filteredCommands.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="flex w-full items-start justify-between rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-left hover:bg-slate-100"
                    onClick={() => runCommand(action)}
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{action.label}</p>
                      <p className="mt-1 text-xs text-slate-500">{action.description}</p>
                    </div>
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                      {action.nav}
                    </span>
                  </button>
                ))}
                {filteredCommands.length === 0 && <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No matching commands.</div>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toaster richColors position="top-right" closeButton />
    </div>
  );
}

function WorkspaceLoadingState({ nav }: { nav: NavKey }) {
  return (
    <div className="rounded-3xl bg-white p-10 shadow-sm ring-1 ring-slate-100">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Loading Module</p>
      <h2 className="mt-3 text-2xl font-semibold capitalize text-slate-900">{nav}</h2>
      <p className="mt-2 text-sm text-slate-500">Preparing workspace data and assets.</p>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    </div>
  );
}

function EnterpriseAdminSettingsPanel({ activeNav }: { activeNav: NavKey }) {
  const { data: academicStructure = [], isFetching: loading } = useAcademicStructure();
  const colleges: College[] = academicStructure;
  const { data: loginAccounts = [] } = useUsers();
  const { data: customRoles = [] } = useCustomRoles();
  const { data: settingsSnapshot = null } = useSettings();

  const createCollegeMutation = useCreateCollege();
  const updateCollegeMutation = useUpdateCollege();
  const deleteCollegeMutation = useDeleteCollege();
  const createCourseMutation = useCreateCourse();
  const updateCourseMutation = useUpdateCourse();
  const deleteCourseMutation = useDeleteCourse();
  const createSessionMutation = useCreateSession();
  const updateSessionMutation = useUpdateSession();
  const deleteSessionMutation = useDeleteSession();
  const createSubjectMutation = useCreateSubject();
  const updateSubjectMutation = useUpdateSubject();
  const deleteSubjectMutation = useDeleteSubject();
  const createCustomRoleMutation = useCreateCustomRole();
  const updateCustomRoleMutation = useUpdateCustomRole();
  const deleteCustomRoleMutation = useDeleteCustomRole();
  const updateSettingsMutation = useUpdateSettings();

  const onAddCollege = (payload: Record<string, unknown>) => createCollegeMutation.mutateAsync(payload).then(() => undefined);
  const onUpdateCollege = (id: string, payload: Record<string, unknown>) => updateCollegeMutation.mutateAsync({ id, data: payload }).then(() => undefined);
  const onDeleteCollege = (id: string) => deleteCollegeMutation.mutateAsync(id).then(() => undefined);
  const onAddCourse = (payload: Record<string, unknown>) => createCourseMutation.mutateAsync(payload).then(() => undefined);
  const onUpdateCourse = (id: string, payload: Record<string, unknown>) => updateCourseMutation.mutateAsync({ id, data: payload }).then(() => undefined);
  const onDeleteCourse = (id: string) => deleteCourseMutation.mutateAsync(id).then(() => undefined);
  const onAddSession = (payload: Record<string, unknown>) => createSessionMutation.mutateAsync(payload).then(() => undefined);
  const onUpdateSession = (id: string, payload: Record<string, unknown>) => updateSessionMutation.mutateAsync({ id, data: payload }).then(() => undefined);
  const onDeleteSession = (id: string) => deleteSessionMutation.mutateAsync(id).then(() => undefined);
  const onAddSubject = (payload: Record<string, unknown>) => createSubjectMutation.mutateAsync(payload).then(() => undefined);
  const onUpdateSubject = (id: string, payload: Record<string, unknown>) => updateSubjectMutation.mutateAsync({ id, data: payload }).then(() => undefined);
  const onDeleteSubject = (id: string) => deleteSubjectMutation.mutateAsync(id).then(() => undefined);
  const onAddCustomRole = (payload: Record<string, unknown>) => createCustomRoleMutation.mutateAsync(payload).then(() => undefined);
  const onUpdateCustomRole = (id: string, payload: Record<string, unknown>) => updateCustomRoleMutation.mutateAsync({ id, data: payload }).then(() => undefined);
  const onDeleteCustomRole = (id: string) => deleteCustomRoleMutation.mutateAsync(id).then(() => undefined);
  const onUpdateSettings = (payload: {
    localization: { timezone: string; currency: string; dateFormat: string };
    security: { authStandard: string; staffDefaultPasswordPolicy: string };
  }) => updateSettingsMutation.mutateAsync(payload).then(() => undefined);

  const isAdmin = activeNav === "admin";

  type ModalType = "college" | "editCollege" | "course" | "editCourse" | "session" | "editSession" | "subject" | "editSubject" | "customRole" | "editCustomRole" | null;
  const [modal, setModal] = useState<ModalType>(null);
  const [editingCollegeId, setEditingCollegeId] = useState("");
  const [editingCourseId, setEditingCourseId] = useState("");
  const [editingSessionId, setEditingSessionId] = useState("");
  const [editingSubjectId, setEditingSubjectId] = useState("");
  const [editingCustomRoleId, setEditingCustomRoleId] = useState("");
  const [targetCollegeId, setTargetCollegeId] = useState("");
  const [targetCourseId, setTargetCourseId] = useState("");
  const [expandedColleges, setExpandedColleges] = useState<Set<string>>(new Set());
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());

  const [collegeName, setCollegeName] = useState("");
  const [collegeCode, setCollegeCode] = useState("");
  const [collegeUniversity, setCollegeUniversity] = useState("");
  const [collegeAddress, setCollegeAddress] = useState("");
  const [collegeAdmissionPrefix, setCollegeAdmissionPrefix] = useState(`MTET/AD${new Date().getFullYear()}`);
  const [collegeAdmissionNo, setCollegeAdmissionNo] = useState("1");

  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");

  const [sessionLabel, setSessionLabel] = useState("");
  const [sessionStart, setSessionStart] = useState(String(new Date().getFullYear()));
  const [sessionEnd, setSessionEnd] = useState(String(new Date().getFullYear() + 1));
  const [sessionRollPrefix, setSessionRollPrefix] = useState(`MTET/R${new Date().getFullYear()}`);
  const [sessionStartingRoll, setSessionStartingRoll] = useState("1");
  const [sessionSeats, setSessionSeats] = useState("");
  const [sessionFee, setSessionFee] = useState("");

  const [subjectName, setSubjectName] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [customRoleCollegeId, setCustomRoleCollegeId] = useState("");
  const [customRoleName, setCustomRoleName] = useState("");
  const [customRolePermissions, setCustomRolePermissions] = useState<string[]>([]);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [currency, setCurrency] = useState("INR");
  const [dateFormat, setDateFormat] = useState("DD-MM-YYYY");
  const [authStandard, setAuthStandard] = useState("JWT with role based access control");
  const [staffPolicy, setStaffPolicy] = useState("No default passwords. Staff are onboarded using one-time invite links with password setup.");

  function closeModal() {
    setModal(null);
    setEditingCollegeId("");
    setEditingCourseId("");
    setEditingSessionId("");
    setEditingSubjectId("");
    setEditingCustomRoleId("");
    setCollegeName(""); setCollegeCode(""); setCollegeUniversity(""); setCollegeAddress(""); setCollegeAdmissionPrefix(`MTET/AD${new Date().getFullYear()}`); setCollegeAdmissionNo("1");
    setCourseName(""); setCourseCode("");
    setSessionLabel(""); setSessionStart(String(new Date().getFullYear())); setSessionEnd(String(new Date().getFullYear() + 1)); setSessionRollPrefix(`MTET/R${new Date().getFullYear()}`); setSessionStartingRoll("1"); setSessionSeats(""); setSessionFee("");
    setSubjectName(""); setSubjectCode("");
    setCustomRoleCollegeId(""); setCustomRoleName(""); setCustomRolePermissions([]);
  }

  function openEditCollegeModal(college: College) {
    setEditingCollegeId(college.id);
    setCollegeName(college.name);
    setCollegeCode(college.code);
    setCollegeUniversity(college.university);
    setCollegeAddress(college.address ?? "");
    setCollegeAdmissionPrefix(college.admissionNumberPrefix ?? `MTET/AD${new Date().getFullYear()}`);
    setCollegeAdmissionNo(String(college.startingAdmissionNumber ?? 1));
    setModal("editCollege");
  }

  function openEditCourseModal(course: College["courses"][number]) {
    setEditingCourseId(course.id);
    setCourseName(course.name);
    setCourseCode(course.courseCode);
    setModal("editCourse");
  }

  function openEditSessionModal(session: College["courses"][number]["sessions"][number]) {
    setEditingSessionId(session.id);
    setSessionLabel(session.label);
    setSessionStart(String(session.startYear));
    setSessionEnd(String(session.endYear));
    setSessionRollPrefix(session.rollNumberPrefix ?? `MTET/R${session.startYear}`);
    setSessionStartingRoll(String(session.startingRollNumber));
    setSessionSeats(String(session.seatCount));
    setSessionFee(String(session.sessionFee));
    setModal("editSession");
  }

  function openEditSubjectModal(subject: College["courses"][number]["subjects"][number]) {
    setEditingSubjectId(subject.id);
    setSubjectName(subject.name);
    setSubjectCode(subject.code);
    setModal("editSubject");
  }

  function openEditCustomRoleModal(role: CustomRole) {
    setEditingCustomRoleId(role.id);
    setCustomRoleCollegeId(role.collegeId);
    setCustomRoleName(role.name);
    setCustomRolePermissions(role.permissions);
    setModal("editCustomRole");
  }

  async function handleAddCollege(e: React.FormEvent) {
    e.preventDefault();
    await onAddCollege({ name: collegeName, code: collegeCode, university: collegeUniversity, address: collegeAddress || undefined, admissionNumberPrefix: collegeAdmissionPrefix.trim(), startingAdmissionNumber: collegeAdmissionNo ? Number(collegeAdmissionNo) : undefined });
    closeModal();
  }

  async function handleEditCollege(e: React.FormEvent) {
    e.preventDefault();
    const current = colleges.find((c) => c.id === editingCollegeId);
    if (!current) return;

    await onUpdateCollege(editingCollegeId, {
      name: collegeName,
      code: collegeCode,
      university: collegeUniversity,
      address: collegeAddress || "Not specified",
      admissionNumberPrefix: collegeAdmissionPrefix.trim(),
      startingAdmissionNumber: collegeAdmissionNo ? Number(collegeAdmissionNo) : current.startingAdmissionNumber,
      registrationYear: current.registrationYear,
      startingRollNumber: current.startingRollNumber,
    });
    closeModal();
  }

  async function handleAddCourse(e: React.FormEvent) {
    e.preventDefault();
    await onAddCourse({ collegeId: targetCollegeId, name: courseName, courseCode });
    closeModal();
  }

  async function handleEditCourse(e: React.FormEvent) {
    e.preventDefault();
    await onUpdateCourse(editingCourseId, { name: courseName, courseCode });
    closeModal();
  }

  async function handleAddSession(e: React.FormEvent) {
    e.preventDefault();
    await onAddSession({ courseId: targetCourseId, label: sessionLabel, startYear: Number(sessionStart), endYear: Number(sessionEnd), rollNumberPrefix: sessionRollPrefix.trim(), startingRollNumber: Number(sessionStartingRoll), seatCount: Number(sessionSeats), sessionFee: Number(sessionFee) });
    closeModal();
  }

  async function handleEditSession(e: React.FormEvent) {
    e.preventDefault();
    await onUpdateSession(editingSessionId, { label: sessionLabel, startYear: Number(sessionStart), endYear: Number(sessionEnd), rollNumberPrefix: sessionRollPrefix.trim(), startingRollNumber: Number(sessionStartingRoll), seatCount: Number(sessionSeats), sessionFee: Number(sessionFee) });
    closeModal();
  }

  async function handleAddSubject(e: React.FormEvent) {
    e.preventDefault();
    await onAddSubject({ courseId: targetCourseId, name: subjectName, code: subjectCode });
    closeModal();
  }

  async function handleEditSubject(e: React.FormEvent) {
    e.preventDefault();
    await onUpdateSubject(editingSubjectId, { name: subjectName, code: subjectCode });
    closeModal();
  }

  async function handleAddCustomRole(e: React.FormEvent) {
    e.preventDefault();
    await onAddCustomRole({ collegeId: customRoleCollegeId, name: customRoleName, permissions: customRolePermissions });
    closeModal();
  }

  async function handleEditCustomRole(e: React.FormEvent) {
    e.preventDefault();
    await onUpdateCustomRole(editingCustomRoleId, { name: customRoleName, permissions: customRolePermissions });
    closeModal();
  }

  function toggleCustomRolePermission(permission: string) {
    setCustomRolePermissions((current) =>
      current.includes(permission) ? current.filter((entry) => entry !== permission) : [...current, permission]
    );
  }

  const totalCourses = colleges.reduce((sum, c) => sum + c.courses.length, 0);
  const totalSessions = colleges.reduce((sum, c) => sum + c.courses.reduce((s, cr) => s + cr.sessions.length, 0), 0);
  const totalSubjects = colleges.reduce((sum, c) => sum + c.courses.reduce((s, cr) => s + (cr.subjects?.length ?? 0), 0), 0);
  const permissionCatalog = [
    "ACADEMIC_READ", "ADMIN_MANAGE", "AUDIT_READ", "ADMISSIONS_APPROVE", "FINANCE_APPROVE", "FINANCE_READ", "FINANCE_WRITE",
    "HR_ATTENDANCE", "HR_READ", "HR_WRITE", "PAYROLL_READ", "REPORTS_READ", "SETTINGS_MANAGE", "SETTINGS_COLLEGE",
    "STUDENTS_READ", "STUDENTS_WRITE", "WORKFLOW_READ", "EXCEPTIONS_READ", "EXCEPTIONS_WRITE", "EXCEPTIONS_RESOLVE",
    "EXAM_READ", "EXAM_WRITE", "HOSTEL_READ", "HOSTEL_WRITE", "LIBRARY_READ", "LIBRARY_WRITE", "TRANSPORT_READ", "TRANSPORT_WRITE",
  ] as const;

  const settingsModules = [
    ["Security", settingsSnapshot?.security.authStandard ?? "JWT with role-based controls"],
    ["Staff Access", settingsSnapshot?.security.staffDefaultPasswordPolicy ?? "Invite-based onboarding"],
    ["Timezone", settingsSnapshot?.localization.timezone ?? "Asia/Kolkata"],
    ["Currency", settingsSnapshot?.localization.currency ?? "INR"],
    ["Date Format", settingsSnapshot?.localization.dateFormat ?? "DD-MM-YYYY"],
  ] as const;

  useEffect(() => {
    setTimezone(settingsSnapshot?.localization.timezone ?? "Asia/Kolkata");
    setCurrency(settingsSnapshot?.localization.currency ?? "INR");
    setDateFormat(settingsSnapshot?.localization.dateFormat ?? "DD-MM-YYYY");
    setAuthStandard(settingsSnapshot?.security.authStandard ?? "JWT with role based access control");
    setStaffPolicy(
      settingsSnapshot?.security.staffDefaultPasswordPolicy ??
        "No default passwords. Staff are onboarded using one-time invite links with password setup."
    );
  }, [settingsSnapshot]);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    await onUpdateSettings({
      localization: {
        timezone,
        currency,
        dateFormat,
      },
      security: {
        authStandard,
        staffDefaultPasswordPolicy: staffPolicy,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{isAdmin ? "Admin Control Center" : "Settings Control Center"}</h1>
        <p className="mt-1 text-sm text-slate-500">{isAdmin ? "Manage colleges, courses, sessions, and subjects under the Trust." : "Control branding, notifications, academic calendar, finance rules, and integrations."}</p>
      </div>

      {isAdmin && (
        <>
          {/* KPI Row */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {([
              ["Colleges", colleges.length],
              ["Courses", totalCourses],
              ["Sessions", totalSessions],
              ["Subjects", totalSubjects],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          {/* Academic Structure */}
          <div className="rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Academic Structure</h2>
              <button
                type="button"
                onClick={() => {
                  closeModal();
                  setModal("college");
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add College
              </button>
            </div>

            {colleges.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">No colleges yet. Add the first college under your Trust.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {colleges.map((college) => {
                  const colExpanded = expandedColleges.has(college.id);
                  return (
                    <div key={college.id}>
                      {/* College row */}
                      <div className="flex items-center gap-3 px-5 py-3.5">
                        <button
                          type="button"
                          onClick={() => setExpandedColleges((prev) => { const next = new Set(prev); colExpanded ? next.delete(college.id) : next.add(college.id); return next; })}
                          className="grid h-6 w-6 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${colExpanded ? "" : "-rotate-90"}`} />
                        </button>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-slate-900">{college.name}</p>
                          <p className="text-xs text-slate-500">{college.code} · {college.university} · {college.courses.length} course{college.courses.length !== 1 ? "s" : ""}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setTargetCollegeId(college.id); setCourseName(""); setCourseCode(""); setModal("course"); }}
                          className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          + Add Course
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditCollegeModal(college)}
                          className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const confirmed = window.confirm(`Delete ${college.name}? This will fail if linked data exists.`);
                            if (!confirmed) return;
                            void onDeleteCollege(college.id);
                          }}
                          className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      </div>

                      {/* Courses */}
                      {colExpanded && (
                        <div className="ml-10 border-l border-slate-100 pb-2">
                          {college.courses.length === 0 ? (
                            <p className="px-4 py-3 text-xs text-slate-400">No courses yet.</p>
                          ) : (
                            college.courses.map((course) => {
                              const courseExpanded = expandedCourses.has(course.id);
                              return (
                                <div key={course.id} className="border-b border-slate-50 last:border-0">
                                  {/* Course row */}
                                  <div className="flex items-center gap-3 px-4 py-3">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedCourses((prev) => { const next = new Set(prev); courseExpanded ? next.delete(course.id) : next.add(course.id); return next; })}
                                      className="grid h-5 w-5 place-items-center rounded-md bg-slate-100 text-slate-500 hover:bg-slate-200"
                                    >
                                      <ChevronDown className={`h-3 w-3 transition-transform ${courseExpanded ? "" : "-rotate-90"}`} />
                                    </button>
                                    <div className="flex-1">
                                      <p className="text-sm font-medium text-slate-800">{course.name}</p>
                                      <p className="text-xs text-slate-500">{course.courseCode} · {course.sessions.length} session{course.sessions.length !== 1 ? "s" : ""} · {course.subjects?.length ?? 0} subject{(course.subjects?.length ?? 0) !== 1 ? "s" : ""}</p>
                                    </div>
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => { const currentYear = new Date().getFullYear(); setTargetCourseId(course.id); setSessionLabel(""); setSessionStart(String(currentYear)); setSessionEnd(String(currentYear + 1)); setSessionRollPrefix(`MTET/R${currentYear}`); setSessionStartingRoll("1"); setSessionSeats(""); setSessionFee(""); setModal("session"); }}
                                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                                      >
                                        + Session
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setTargetCourseId(course.id); setSubjectName(""); setSubjectCode(""); setModal("subject"); }}
                                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                                      >
                                        + Subject
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openEditCourseModal(course)}
                                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const confirmed = window.confirm(`Delete course ${course.name}? This will fail if linked sessions, subjects or admissions exist.`);
                                          if (!confirmed) return;
                                          void onDeleteCourse(course.id);
                                        }}
                                        className="rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>

                                  {/* Sessions & Subjects */}
                                  {courseExpanded && (
                                    <div className="ml-8 grid gap-3 px-4 pb-3 sm:grid-cols-2">
                                      <div>
                                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sessions</p>
                                        {course.sessions.length === 0 ? (
                                          <p className="text-xs text-slate-400">No sessions yet.</p>
                                        ) : (
                                          <div className="space-y-1">
                                            {course.sessions.map((session) => (
                                              <div key={session.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                                                <span>
                                                  {session.label} <span className="text-slate-400">({session.startYear}–{session.endYear}) · Seats: {session.seatCount} · Fee: ₹{Number(session.sessionFee).toLocaleString()}</span>
                                                </span>
                                                <span className="flex gap-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => openEditSessionModal(session)}
                                                    className="font-medium text-slate-600 hover:text-slate-900"
                                                  >
                                                    Edit
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      const confirmed = window.confirm(`Delete session ${session.label}?`);
                                                      if (!confirmed) return;
                                                      void onDeleteSession(session.id);
                                                    }}
                                                    className="font-medium text-rose-700 hover:text-rose-900"
                                                  >
                                                    Delete
                                                  </button>
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <div>
                                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Subjects</p>
                                        {(course.subjects?.length ?? 0) === 0 ? (
                                          <p className="text-xs text-slate-400">No subjects yet.</p>
                                        ) : (
                                          <div className="space-y-1">
                                            {course.subjects?.map((subject) => (
                                              <div key={subject.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                                                <span>
                                                  {subject.name} <span className="text-slate-400">({subject.code})</span>
                                                </span>
                                                <span className="flex gap-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => openEditSubjectModal(subject)}
                                                    className="font-medium text-slate-600 hover:text-slate-900"
                                                  >
                                                    Edit
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      const confirmed = window.confirm(`Delete subject ${subject.name}?`);
                                                      if (!confirmed) return;
                                                      void onDeleteSubject(subject.id);
                                                    }}
                                                    className="font-medium text-rose-700 hover:text-rose-900"
                                                  >
                                                    Delete
                                                  </button>
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Role Access Matrix */}
          <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Role Access Matrix</h2>
            </div>
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">View</th>
                  <th className="px-4 py-3">Edit</th>
                  <th className="px-4 py-3">Approve</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {([
                  ["Super Admin", true, true, true],
                  ["College Admin", true, true, false],
                  ["Finance", true, true, false],
                  ["Operations", true, false, true],
                ] as Array<[string, boolean, boolean, boolean]>).map(([role, view, edit, approve]) => (
                  <tr key={role}>
                    <td className="px-4 py-3 font-medium text-slate-800">{role}</td>
                    <td className="px-4 py-3">{view ? <Check className="h-4 w-4 text-emerald-600" /> : <Minus className="h-4 w-4 text-slate-400" />}</td>
                    <td className="px-4 py-3">{edit ? <Check className="h-4 w-4 text-emerald-600" /> : <Minus className="h-4 w-4 text-slate-400" />}</td>
                    <td className="px-4 py-3">{approve ? <Check className="h-4 w-4 text-emerald-600" /> : <Minus className="h-4 w-4 text-slate-400" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Custom Roles</h2>
                <p className="mt-1 text-xs text-slate-500">Build college-specific permission bundles for principals, registrars, or specialized operators.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  closeModal();
                  setCustomRoleCollegeId(colleges[0]?.id ?? "");
                  setModal("customRole");
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add Custom Role
              </button>
            </div>
            {customRoles.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">No custom roles defined yet.</div>
            ) : (
              <div className="grid gap-4 p-5 md:grid-cols-2">
                {customRoles.map((role) => (
                  <div key={role.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{role.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{colleges.find((college) => college.id === role.collegeId)?.name ?? "Unknown college"}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">{role._count?.staff ?? 0} assigned</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {role.permissions.map((permission) => (
                        <span key={permission} className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                          {permission}
                        </span>
                      ))}
                      {role.permissions.length === 0 && <span className="text-xs text-slate-400">No permissions granted</span>}
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEditCustomRoleModal(role)}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const confirmed = window.confirm(`Delete custom role ${role.name}? This will fail if it is still assigned.`);
                          if (!confirmed) return;
                          void onDeleteCustomRole(role.id);
                        }}
                        className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Login Accounts</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{loginAccounts.length} total</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Staff Profile</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loginAccounts.map((account) => (
                    <tr key={account.id}>
                      <td className="px-4 py-3 font-medium text-slate-800">{account.email}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${account.role === "SUPER_ADMIN" ? "bg-slate-900 text-white" : "bg-blue-50 text-blue-700"}`}>
                          {account.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{account.staff?.fullName ?? "Not linked"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${account.staff ? (account.staff.isActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700") : "bg-slate-100 text-slate-600"}`}>
                          {account.staff ? (account.staff.isActive ? "Active" : "Inactive") : "System"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{new Date(account.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {loginAccounts.length === 0 && (
                    <tr>
                      <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>No login accounts found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!isAdmin && (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h2 className="mb-4 text-sm font-semibold text-slate-800">Configuration Modules</h2>
              <form className="mb-5 space-y-4" onSubmit={(e) => void handleSaveSettings(e)}>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-slate-600">
                    Timezone
                    <input
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
                    />
                  </label>
                  <label className="text-xs text-slate-600">
                    Currency
                    <input
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
                    />
                  </label>
                </div>
                <label className="block text-xs text-slate-600">
                  Date Format
                  <input
                    value={dateFormat}
                    onChange={(e) => setDateFormat(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
                  />
                </label>
                <label className="block text-xs text-slate-600">
                  Auth Standard
                  <input
                    value={authStandard}
                    onChange={(e) => setAuthStandard(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
                  />
                </label>
                <label className="block text-xs text-slate-600">
                  Staff Password Policy
                  <textarea
                    value={staffPolicy}
                    onChange={(e) => setStaffPolicy(e.target.value)}
                    className="mt-1 min-h-[88px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
                  />
                </label>
                <div className="flex justify-end">
                  <button type="submit" disabled={loading} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                    {loading ? "Saving..." : "Save Settings"}
                  </button>
                </div>
              </form>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {settingsModules.map(([title, description]) => (
                  <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    <p className="mt-2 text-xs text-slate-500">{description}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Context</h2>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Trust</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{settingsSnapshot?.trust?.name ?? "Trust not configured"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Scope: All colleges (Unified View)
                    {settingsSnapshot?.trust?.registrationNumber ? ` · Reg: ${settingsSnapshot.trust.registrationNumber}` : ""}
                  </p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-amber-700">Workflow Engine Status</p>
                  <p className="mt-1 text-sm font-semibold text-amber-900">Approval Inbox + Exception Manager enabled</p>
                </div>
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">System Configuration Coverage</h2>
            </div>
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Module</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settingsModules.map(([title], index) => (
                  <tr key={title}>
                    <td className="px-4 py-3 font-medium text-slate-800">{title}</td>
                    <td className="px-4 py-3 text-slate-600">{index % 2 === 0 ? "Platform" : "Operations"}</td>
                    <td className="px-4 py-3"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Configured</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modals */}
      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            {(modal === "college" || modal === "editCollege") && (
              <form onSubmit={(e) => { void (modal === "college" ? handleAddCollege(e) : handleEditCollege(e)); }}>
                <h3 className="text-base font-semibold text-slate-900">{modal === "college" ? "Add College" : "Edit College"}</h3>
                <p className="mt-1 text-xs text-slate-500">{modal === "college" ? "Register a new college under the Trust." : "Update college details."}</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">College Name</label>
                    <input required value={collegeName} onChange={(e) => setCollegeName(e.target.value)} placeholder="e.g. St. Xavier's College" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">College Code</label>
                    <input required value={collegeCode} onChange={(e) => setCollegeCode(e.target.value)} placeholder="e.g. SXC" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">University / Parent Institute</label>
                    <input required value={collegeUniversity} onChange={(e) => setCollegeUniversity(e.target.value)} placeholder="e.g. Mumbai University" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">College Address</label>
                    <input value={collegeAddress} onChange={(e) => setCollegeAddress(e.target.value)} placeholder="e.g. 5 Park Street, Mumbai" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Admission Prefix (Fixed Text)</label>
                    <input required value={collegeAdmissionPrefix} onChange={(e) => setCollegeAdmissionPrefix(e.target.value)} placeholder="e.g. MTET/AD2026" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Starting Admission Number</label>
                    <input type="number" min="1" value={collegeAdmissionNo} onChange={(e) => setCollegeAdmissionNo(e.target.value)} placeholder="e.g. 1" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                    <p className="mt-1 text-[11px] text-slate-500">Preview: {collegeAdmissionPrefix || "MTET/AD2026"}/{String(Number(collegeAdmissionNo || 1)).padStart(2, "0")}</p>
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={closeModal} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={loading} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{loading ? "Saving…" : (modal === "college" ? "Add College" : "Save Changes")}</button>
                </div>
              </form>
            )}

            {(modal === "course" || modal === "editCourse") && (
              <form onSubmit={(e) => { void (modal === "course" ? handleAddCourse(e) : handleEditCourse(e)); }}>
                <h3 className="text-base font-semibold text-slate-900">{modal === "course" ? "Add Course" : "Edit Course"}</h3>
                <p className="mt-1 text-xs text-slate-500">{modal === "course" ? `Create a new course in ${colleges.find((c) => c.id === targetCollegeId)?.name ?? "the college"}.` : "Update course details."}</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Course Name</label>
                    <input required value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="e.g. Bachelor of Commerce" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Course Code</label>
                    <input required value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="e.g. BCOM" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={closeModal} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={loading} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{loading ? "Saving…" : (modal === "course" ? "Add Course" : "Save Changes")}</button>
                </div>
              </form>
            )}

            {(modal === "session" || modal === "editSession") && (
              <form onSubmit={(e) => { void (modal === "session" ? handleAddSession(e) : handleEditSession(e)); }}>
                <h3 className="text-base font-semibold text-slate-900">{modal === "session" ? "Add Session" : "Edit Session"}</h3>
                <p className="mt-1 text-xs text-slate-500">{modal === "session" ? `Add an academic session to ${colleges.flatMap((c) => c.courses).find((cr) => cr.id === targetCourseId)?.name ?? "the course"}.` : "Update session details."}</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Session Label</label>
                    <input required value={sessionLabel} onChange={(e) => setSessionLabel(e.target.value)} placeholder="e.g. 2024-25" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">Start Year</label>
                      <input required type="number" value={sessionStart} onChange={(e) => setSessionStart(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">End Year</label>
                      <input required type="number" value={sessionEnd} onChange={(e) => setSessionEnd(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">Roll Prefix (Fixed Text)</label>
                      <input required value={sessionRollPrefix} onChange={(e) => setSessionRollPrefix(e.target.value)} placeholder="e.g. MTET/R2026" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">Starting Roll Number</label>
                      <input required type="number" min="1" value={sessionStartingRoll} onChange={(e) => setSessionStartingRoll(e.target.value)} placeholder="e.g. 1" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                    <div className="col-span-2 text-[11px] text-slate-500">Preview: {sessionRollPrefix || "MTET/R2026"}/{String(Number(sessionStartingRoll || 1)).padStart(2, "0")}</div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">No. of Seats</label>
                      <input required type="number" min="0" value={sessionSeats} onChange={(e) => setSessionSeats(e.target.value)} placeholder="e.g. 60" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">Course Fee for the Session (₹)</label>
                      <input required type="number" min="0" value={sessionFee} onChange={(e) => setSessionFee(e.target.value)} placeholder="e.g. 45000" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={closeModal} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={loading} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{loading ? "Saving…" : (modal === "session" ? "Add Session" : "Save Changes")}</button>
                </div>
              </form>
            )}

            {(modal === "subject" || modal === "editSubject") && (
              <form onSubmit={(e) => { void (modal === "subject" ? handleAddSubject(e) : handleEditSubject(e)); }}>
                <h3 className="text-base font-semibold text-slate-900">{modal === "subject" ? "Add Subject" : "Edit Subject"}</h3>
                <p className="mt-1 text-xs text-slate-500">{modal === "subject" ? `Add a subject to ${colleges.flatMap((c) => c.courses).find((cr) => cr.id === targetCourseId)?.name ?? "the course"}.` : "Update subject details."}</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Subject Name</label>
                    <input required value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="e.g. Financial Accounting" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Subject Code</label>
                    <input required value={subjectCode} onChange={(e) => setSubjectCode(e.target.value)} placeholder="e.g. FA101" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={closeModal} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={loading} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{loading ? "Saving…" : (modal === "subject" ? "Add Subject" : "Save Changes")}</button>
                </div>
              </form>
            )}

            {(modal === "customRole" || modal === "editCustomRole") && (
              <form onSubmit={(e) => { void (modal === "customRole" ? handleAddCustomRole(e) : handleEditCustomRole(e)); }}>
                <h3 className="text-base font-semibold text-slate-900">{modal === "customRole" ? "Add Custom Role" : "Edit Custom Role"}</h3>
                <p className="mt-1 text-xs text-slate-500">Create reusable permission bundles for college-specific operations teams.</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">College</label>
                    <select
                      required
                      disabled={modal === "editCustomRole"}
                      value={customRoleCollegeId}
                      onChange={(e) => setCustomRoleCollegeId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-70"
                    >
                      <option value="">Select a college</option>
                      {colleges.map((college) => (
                        <option key={college.id} value={college.id}>{college.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Role Name</label>
                    <input
                      required
                      value={customRoleName}
                      onChange={(e) => setCustomRoleName(e.target.value)}
                      placeholder="e.g. Principal, Registrar"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium text-slate-700">Permissions</label>
                    <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      {permissionCatalog.map((permission) => {
                        const checked = customRolePermissions.includes(permission);
                        return (
                          <label key={permission} className={`flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-xs ${checked ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCustomRolePermission(permission)}
                              className="rounded border-slate-300"
                            />
                            <span>{permission}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={closeModal} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={loading} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{loading ? "Saving…" : (modal === "customRole" ? "Create Role" : "Save Changes")}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
