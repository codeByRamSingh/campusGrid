import { FormEvent, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  Clock3,
  Landmark,
  Lock,
  Printer,
  ReceiptText,
  RefreshCcw,
  Search,
  ShieldCheck,
  Wallet2,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { hasPermission } from "../../lib/permissions";
import { exportRowsToCsv, loadSavedPresets, removeSavedPreset, type SavedPreset, upsertSavedPreset } from "../../lib/viewPresets";
import { api } from "../../services/api";

type College = {
  id: string;
  name: string;
  courses: Array<{
    id: string;
    name: string;
    sessions: Array<{ id: string; label: string; startYear: number; endYear: number; sessionFee: number }>;
  }>;
};

type Student = {
  id: string;
  candidateName: string;
  admissionNumber: number;
  admissionCode?: string;
  collegeId: string;
  totalPayable: number;
  status?: string;
  admissions?: Array<{ id: string; courseId: string; sessionId: string; createdAt?: string }>;
};

type Expense = {
  id: string;
  amount: number;
  category: string;
  subcategory?: string | null;
  spentOn: string;
  notes?: string | null;
  description?: string | null;
  vendorId?: string | null;
  vendorName?: string | null;
  paymentSource?: string | null;
  procurementRequestRef?: string | null;
  procurementOrderRef?: string | null;
  goodsReceiptRef?: string | null;
  sourceDocumentRef?: string | null;
  approvalStatus?: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionNote?: string | null;
  attachmentUrl?: string | null;
  attachmentPath?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  attachmentSize?: number | null;
  createdAt?: string;
  vendor?: { id: string; name: string } | null;
  college?: { id: string; name: string };
};

type ExpenseVendor = {
  id: string; collegeId: string; name: string; gstNumber?: string | null;
  contactPerson?: string | null; phone?: string | null; email?: string | null;
  address?: string | null; paymentTerms?: string | null; isActive: boolean;
};

type ExpenseBudget = {
  id: string; collegeId: string; category: string; subcategory?: string | null;
  allocatedAmount: number; financialYear: string;
};

type ExpenseRecurring = {
  id: string; collegeId: string; title: string; category: string; subcategory?: string | null;
  amount: number; frequency: string; nextDueDate: string; isActive: boolean;
  vendor?: { id: string; name: string } | null;
};

type PettyCashEntry = {
  id: string; collegeId: string; entryType: string; amount: number;
  description: string; reference?: string | null; runningBalance: number; createdAt: string;
};

type ExpenseReportResponse = {
  totalExpenses: number;
  pendingApprovals: number;
  capex: number;
  opex: number;
  byCategory: Array<{ name: string; amount: number }>;
  byVendor: Array<{ name: string; amount: number }>;
  byInstitution: Array<{ name: string; amount: number }>;
  byStatus: Array<{ name: string; amount: number }>;
  rows: Expense[];
};

type ExpenseAuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  actor?: { email?: string | null } | null;
};

type ExpenseTab = "dashboard" | "all" | "add" | "approvals" | "budgets" | "vendors" | "recurring" | "petty-cash" | "reports" | "audit-logs";
type LedgerReceiptPresetValues = {
  receiptSearch: string;
  selectedStudentId: string;
};

type ExpenseFilterPresetValues = {
  collegeId: string;
  status: string;
  category: string;
};

const FINANCE_LEDGER_PRESET_KEY = "campusgrid_finance_ledger_presets_v1";
const EXPENSE_FILTER_PRESET_KEY = "campusgrid_expense_filter_presets_v1";
type Dues = { studentId: string; candidateName: string; due: number; fines: number };

type StudentLedger = {
  payments: Array<{
    id: string;
    amount: number;
    paymentType: "FEE_COLLECTION" | "FINE";
    description: string;
    receiptNumber: string;
    paymentMode?: string | null;
    referenceNumber?: string | null;
    collectedBy?: string | null;
    paidAt: string;
  }>;
  receipts: Array<{
    id: string;
    receiptNumber: string;
    cycleKey?: string | null;
    cycleLabel?: string | null;
    amount: number;
    lateFine: number;
    totalReceived: number;
    paymentMode?: string | null;
    referenceNumber?: string | null;
    collectedBy?: string | null;
    collectedAt: string;
  }>;
  drafts: Array<{
    id: string;
    cycleKey?: string | null;
    amount: number;
    lateFine: number;
    paymentMode?: string | null;
    referenceNumber?: string | null;
    postingDate?: string | null;
    collectedBy?: string | null;
    notes?: string | null;
    status: string;
    createdAt: string;
  }>;
  exceptions: Array<{
    id: string;
    cycleKey?: string | null;
    requestedAmount: number;
    remainingBalance: number;
    reason: string;
    status: string;
    reviewNote?: string | null;
    createdAt: string;
    reviewedAt?: string | null;
  }>;
  timeline: Array<{ id: string; title: string; details: string; createdAt: string }>;
};

type ReceiptSnapshotResponse = {
  receiptNumber: string;
  cycleLabel?: string | null;
  amount: number;
  lateFine: number;
  totalReceived: number;
  paymentMode?: string | null;
  referenceNumber?: string | null;
  collectedBy?: string | null;
  collectedAt: string;
  snapshot: {
    student: {
      candidateName: string;
      admissionNumber: number;
      admissionCode?: string | null;
    };
    academicContext?: {
      college?: string | null;
      course?: string | null;
      session?: string | null;
    };
    payment: {
      description: string;
      cycleLabel?: string | null;
      amount: number;
      lateFine: number;
      totalReceived: number;
      paymentMode?: string | null;
      referenceNumber?: string | null;
      collectedBy?: string | null;
      collectedAt: string;
      receiptNumber: string;
    };
  };
};

type Ledger = {
  openingBalance: number;
  totalFeeDeposit: number;
  totalMiscCredits: number;
  totalExpenses: number;
  totalPayroll: number;
  closingBalance: number;
} | null;

type Props = {
  ledger: Ledger;
  colleges: College[];
  students: Student[];
  trustName?: string;
  expenses: Expense[];
  duesReport: Dues[];
  receivablesAging: {
    buckets: Array<{ label: string; count: number; amount: number }>;
    defaulters: Array<{ studentId: string; admissionNumber: number; admissionCode?: string; candidateName: string; due: number; daysOutstanding: number }>;
  };
  loading: boolean;
  currentUserEmail?: string;
  currentUserRole?: "SUPER_ADMIN" | "STAFF";
  permissions: string[];
  onCollectFee: (payload: Record<string, unknown>) => Promise<{ receiptNumber?: string } | undefined>;
  onSaveDraft: (payload: Record<string, unknown>) => Promise<{ id?: string } | undefined>;
  onRaiseException: (payload: Record<string, unknown>) => Promise<{ id?: string } | undefined>;
  onAddCredit: (payload: Record<string, unknown>) => Promise<void>;
  onAddExpense: (payload: Record<string, unknown>) => Promise<void>;
};

type FinanceSubmodule = "fee-collection" | "receivables" | "credits-adjustments" | "expenses" | "ledger-receipts";
type DueCycle = string;
type LedgerTab = "receipts" | "demand" | "adjustments" | "audit";

export function FinancePage({
  ledger,
  colleges,
  students,
  trustName,
  expenses,
  duesReport,
  receivablesAging,
  loading,
  currentUserEmail,
  permissions,
  onCollectFee,
  onSaveDraft,
  onRaiseException,
  onAddCredit,
  onAddExpense,
}: Props) {
  const [activeModule, setActiveModule] = useState<FinanceSubmodule>("fee-collection");
  const [studentQuery, setStudentQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedCycle, setSelectedCycle] = useState<DueCycle>("CYCLE_1");
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>("receipts");

  const [paymentMode, setPaymentMode] = useState("CASH");
  const [amount, setAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [collectedBy, setCollectedBy] = useState(currentUserEmail ?? "");
  const [cashCounter, setCashCounter] = useState("Counter 1");
  const [narration, setNarration] = useState("");
  const [instrumentRef, setInstrumentRef] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [instrumentDate, setInstrumentDate] = useState("");
  const [utrNumber, setUtrNumber] = useState("");
  const [ddNumber, setDdNumber] = useState("");
  const [waiveFine, setWaiveFine] = useState(false);
  const [editDemandModalOpen, setEditDemandModalOpen] = useState(false);
  const [editingCycle, setEditingCycle] = useState<DueCycle>("CYCLE_1");
  const [editedCycleAmount, setEditedCycleAmount] = useState(0);
  const [editedCycleDueDate, setEditedCycleDueDate] = useState("");
  const [demandCycleOverrides, setDemandCycleOverrides] = useState<Record<string, { amount?: number; dueDate?: string }>>({});

  // TODO: Shift management disabled until backend shift endpoints are implemented (Phase 2)
  // const [shiftOpen, setShiftOpen] = useState(false);
  // const [openingCash, setOpeningCash] = useState("0");
  // const [closingCash, setClosingCash] = useState("");

  const [studentLedger, setStudentLedger] = useState<StudentLedger | null>(null);
  const [studentLedgerLoading, setStudentLedgerLoading] = useState(false);
  const [studentLedgerError, setStudentLedgerError] = useState("");
  const [studentLedgerRefreshKey, setStudentLedgerRefreshKey] = useState(0);
  const [ledgerReceiptSearch, setLedgerReceiptSearch] = useState("");
  const [ledgerPresetName, setLedgerPresetName] = useState("");
  const [selectedLedgerPresetId, setSelectedLedgerPresetId] = useState("");
  const [savedLedgerPresets, setSavedLedgerPresets] = useState<Array<SavedPreset<LedgerReceiptPresetValues>>>(() =>
    loadSavedPresets<LedgerReceiptPresetValues>(FINANCE_LEDGER_PRESET_KEY)
  );

  const canCollect = hasPermission(permissions, "FINANCE_WRITE");
  const canAdjust = hasPermission(permissions, "FINANCE_APPROVE");
  const canApprove = hasPermission(permissions, "FINANCE_APPROVE");
  const canReverse = hasPermission(permissions, "FINANCE_APPROVE");

  const filteredStudents = useMemo(() => {
    const query = studentQuery.trim().toLowerCase();
    if (!query) {
      return students;
    }

    return students.filter((student) => {
      const searchable = `${student.candidateName} ${student.admissionCode ?? student.admissionNumber}`.toLowerCase();
      return searchable.includes(query);
    });
  }, [studentQuery, students]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? filteredStudents[0] ?? students[0] ?? null,
    [filteredStudents, selectedStudentId, students]
  );

  const selectedAdmission = useMemo(() => {
    if (!selectedStudent?.admissions?.length) {
      return null;
    }

    return [...selectedStudent.admissions].sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightTime - leftTime;
    })[0];
  }, [selectedStudent]);

  const academicContext = useMemo(() => {
    if (!selectedStudent) {
      return null;
    }

    const college = colleges.find((item) => item.id === selectedStudent.collegeId) ?? null;
    const course = college?.courses.find((item) => item.id === selectedAdmission?.courseId) ?? null;
    const session = course?.sessions.find((item) => item.id === selectedAdmission?.sessionId) ?? null;

    return { college, course, session };
  }, [colleges, selectedAdmission, selectedStudent]);

  const dueRow = useMemo(() => duesReport.find((row) => row.studentId === selectedStudent?.id) ?? null, [duesReport, selectedStudent]);
  const sessionFee = Number(academicContext?.session?.sessionFee ?? selectedStudent?.totalPayable ?? 0);
  const feeConfigured = Number(selectedStudent?.totalPayable ?? sessionFee);
  const finesRaised = Number(dueRow?.fines ?? 0);
  const outstandingBalance = Math.max(0, Number(dueRow?.due ?? feeConfigured));
  const amountCollected = Math.max(0, feeConfigured + finesRaised - outstandingBalance);
  const cycleRows = useMemo(() => {
    const durationYears = getCourseDurationYears(academicContext?.session?.startYear, academicContext?.session?.endYear);
    const cycleCount = Math.max(2, durationYears * 2);
    const baseAmount = Math.round((feeConfigured / cycleCount) * 100) / 100;
    const rows: Array<{
      key: DueCycle;
      demand: string;
      dueDate: string;
      amount: number;
      collected: number;
      balance: number;
      status: string;
      locked: boolean;
      overdue: boolean;
      dueDateValue: Date;
    }> = [];
    let remainingConfigured = Math.max(0, feeConfigured);
    let remainingPaid = Math.max(0, amountCollected);

    for (let index = 0; index < cycleCount; index += 1) {
      const key = `CYCLE_${index + 1}`;
      const isLastCycle = index === cycleCount - 1;
      const amount = Math.max(0, Number(demandCycleOverrides[key]?.amount ?? (isLastCycle ? remainingConfigured : Math.min(remainingConfigured, baseAmount))));
      remainingConfigured = Math.max(0, Math.round((remainingConfigured - amount) * 100) / 100);

      const collected = Math.min(remainingPaid, amount);
      remainingPaid = Math.max(0, Math.round((remainingPaid - collected) * 100) / 100);

      const defaultDueDate = getDueDateLabel(academicContext?.session?.startYear, 6 + index * 6, 15);
      const dueDate = demandCycleOverrides[key]?.dueDate ?? defaultDueDate;
      const dueDateValue = new Date(toIsoDate(dueDate) || dueDate);
      rows.push({
        key,
        demand: `Cycle ${index + 1}`,
        dueDate,
        dueDateValue,
        amount,
        collected,
        balance: Math.max(0, Math.round((amount - collected) * 100) / 100),
        status: "Due",
        locked: false,
        overdue: false,
      });
    }

    const now = new Date();
    const overdueRows = rows.filter((row) => row.balance > 0 && row.dueDateValue <= now);
    let previousIncomplete = false;

    return rows.map((row) => {
      const overdue = row.balance > 0 && row.dueDateValue <= now;
      const locked = previousIncomplete;
      let status = "Due";

      if (row.balance === 0) {
        status = "Paid";
      } else if (row.collected > 0) {
        status = overdueRows.length >= 3 && overdue ? "Defaulter" : overdueRows.length >= 2 && overdue ? "Overdue" : "Partial";
      } else if (overdueRows.length >= 3 && overdue) {
        status = "Defaulter";
      } else if (overdueRows.length >= 2 && overdue) {
        status = "Overdue";
      } else if (locked) {
        status = "Blocked";
      }

      if (row.balance > 0) {
        previousIncomplete = true;
      }

      return { ...row, status, locked, overdue };
    });
  }, [academicContext?.session?.endYear, academicContext?.session?.startYear, amountCollected, demandCycleOverrides, feeConfigured]);

  const earliestOutstandingDays = useMemo(() => {
    const overdueCycle = cycleRows.find((row) => row.balance > 0 && row.overdue);
    if (!overdueCycle) {
      return 0;
    }
    return Math.max(0, Math.floor((Date.now() - overdueCycle.dueDateValue.getTime()) / (1000 * 60 * 60 * 24)));
  }, [cycleRows]);

  const lateFine = waiveFine ? 0 : calculateLateFine(earliestOutstandingDays);

  const selectedCycleRow = cycleRows.find((row) => row.key === selectedCycle) ?? cycleRows[0];

  const duplicatePaymentDetected = useMemo(() => {
    const requestedAmount = Number(amount || 0);
    if (!studentLedger || !requestedAmount) {
      return false;
    }

    return studentLedger.payments.some((payment) => {
      if (payment.paymentType !== "FEE_COLLECTION") {
        return false;
      }
      if (Number(payment.amount) !== requestedAmount) {
        return false;
      }
      if (!isSameDate(payment.paidAt, receiptDate)) {
        return false;
      }

      const referenceCandidate = normalizedReference();
      if (!referenceCandidate) {
        return false;
      }

      return payment.referenceNumber?.toLowerCase() === referenceCandidate.toLowerCase();
    });
  }, [amount, receiptDate, studentLedger, paymentMode, instrumentRef, chequeNo, utrNumber, ddNumber]);

  const hasDemand = Boolean(selectedCycleRow);
  const cycleSequencingValid = !selectedCycleRow?.locked;
  const amountWithinOutstanding = Number(amount || 0) <= Number(selectedCycleRow?.balance ?? 0);
  const studentActive = isStudentActive(selectedStudent?.status);
  const concessionTag = feeConfigured < sessionFee ? "Scholarship / Concession" : "No concession";
  const approvalNeededForConcession = concessionTag !== "No concession" && !canApprove;
  const approvedException =
    studentLedger?.exceptions.find((item) => item.status === "APPROVED" && (!item.cycleKey || item.cycleKey === selectedCycle)) ?? null;

  const canPost =
    canCollect &&
    Boolean(selectedStudent) &&
    Number(amount || 0) > 0 &&
    studentActive &&
    hasDemand &&
    !duplicatePaymentDetected &&
    (amountWithinOutstanding || Boolean(approvedException)) &&
    (cycleSequencingValid || Boolean(approvedException));

  const validations = [
    { label: "Student active", pass: studentActive, warning: false },
    { label: "Demand exists", pass: hasDemand, warning: false },
    { label: "Duplicate payment check", pass: !duplicatePaymentDetected, warning: false },
    { label: "Amount within outstanding", pass: amountWithinOutstanding || Boolean(approvedException), warning: false },
    { label: "Cycle sequencing valid", pass: cycleSequencingValid || Boolean(approvedException), warning: false },
    { label: "Late fine applied", pass: lateFine > 0, warning: true },
    { label: "Approval needed if concession", pass: !approvalNeededForConcession, warning: approvalNeededForConcession },
  ];

  const todayCollection = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    if (!studentLedger) {
      return 0;
    }

    return studentLedger.payments
      .filter((payment) => payment.paymentType === "FEE_COLLECTION" && isSameDate(payment.paidAt, todayKey))
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
  }, [studentLedger]);

  const filteredLedgerReceipts = useMemo(() => {
    const q = ledgerReceiptSearch.trim().toLowerCase();
    const receipts = studentLedger?.receipts ?? [];
    if (!q) {
      return receipts;
    }
    return receipts.filter((row) =>
      row.receiptNumber.toLowerCase().includes(q) ||
      (row.cycleLabel ?? "").toLowerCase().includes(q)
    );
  }, [ledgerReceiptSearch, studentLedger?.receipts]);

  function saveLedgerPreset() {
    const name = ledgerPresetName.trim();
    if (!name) {
      return;
    }
    const next = upsertSavedPreset<LedgerReceiptPresetValues>(FINANCE_LEDGER_PRESET_KEY, name, {
      receiptSearch: ledgerReceiptSearch,
      selectedStudentId: selectedStudent?.id ?? "",
    });
    setSavedLedgerPresets(next);
    setLedgerPresetName("");
  }

  function applyLedgerPresetById(presetId: string) {
    setSelectedLedgerPresetId(presetId);
    const preset = savedLedgerPresets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setLedgerReceiptSearch(preset.values.receiptSearch);
    if (preset.values.selectedStudentId) {
      setSelectedStudentId(preset.values.selectedStudentId);
    }
  }

  function deleteLedgerPreset() {
    if (!selectedLedgerPresetId) {
      return;
    }
    const next = removeSavedPreset<LedgerReceiptPresetValues>(FINANCE_LEDGER_PRESET_KEY, selectedLedgerPresetId);
    setSavedLedgerPresets(next);
    setSelectedLedgerPresetId("");
  }

  function exportLedgerReceiptsCsv() {
    exportRowsToCsv(
      `finance-ledger-receipts-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Receipt Number", "Student", "Cycle", "Amount", "Date"],
      filteredLedgerReceipts.map((row) => [
        row.receiptNumber,
        selectedStudent ? formatStudentLabel(selectedStudent) : "",
        row.cycleLabel ?? "Fee",
        String(row.totalReceived ?? row.amount),
        new Date(row.collectedAt).toISOString().slice(0, 10),
      ])
    );
  }

  const todayPending = useMemo(() => Math.max(0, duesReport.reduce((sum, row) => sum + Number(row.due), 0)), [duesReport]);

  const expenseByCategory = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const expense of expenses) {
      grouped.set(expense.category, (grouped.get(expense.category) ?? 0) + Number(expense.amount));
    }
    return Array.from(grouped.entries()).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const monthlyExpenses = useMemo(() => {
    return Array.from({ length: 6 }).map((_, index) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - index));
      const month = date.toLocaleString("en-US", { month: "short" });
      const total = expenses
        .filter((item) => {
          const expenseDate = new Date(item.spentOn);
          return expenseDate.getMonth() === date.getMonth() && expenseDate.getFullYear() === date.getFullYear();
        })
        .reduce((sum, item) => sum + Number(item.amount), 0);

      return { month, total };
    });
  }, [expenses]);

  useEffect(() => {
    if (!selectedStudentId && students[0]) {
      setSelectedStudentId(students[0].id);
    }
  }, [selectedStudentId, students]);

  useEffect(() => {
    if (!currentUserEmail) {
      return;
    }
    setCollectedBy((value) => value || currentUserEmail);
  }, [currentUserEmail]);

  useEffect(() => {
    if (!filteredStudents.length) {
      return;
    }

    if (!selectedStudent || !filteredStudents.some((student) => student.id === selectedStudent.id)) {
      setSelectedStudentId(filteredStudents[0].id);
    }
  }, [filteredStudents, selectedStudent]);

  useEffect(() => {
    const firstOpenCycle = cycleRows.find((row) => row.balance > 0) ?? cycleRows[0];
    if (firstOpenCycle) {
      setSelectedCycle(firstOpenCycle.key);
    }
  }, [selectedStudent?.id, cycleRows]);

  useEffect(() => {
    if (!selectedCycleRow) {
      setAmount("");
      return;
    }
    setAmount(selectedCycleRow.balance > 0 ? selectedCycleRow.balance.toFixed(2) : "");
  }, [selectedCycleRow?.key, selectedStudent?.id]);

  useEffect(() => {
    setDemandCycleOverrides({});
  }, [selectedStudent?.id]);

  function openEditDemandCycle(cycle: DueCycle) {
    const row = cycleRows.find((item) => item.key === cycle);
    if (!row) {
      return;
    }

    setEditingCycle(cycle);
    setEditedCycleAmount(Number(row.amount));
    setEditedCycleDueDate(toIsoDate(row.dueDate));
    setEditDemandModalOpen(true);
  }

  function saveEditedDemandCycle() {
    const sanitizedAmount = Math.max(0, Math.min(Number(editedCycleAmount || 0), feeConfigured));
    const lastCycleKey = cycleRows[cycleRows.length - 1]?.key;

    setDemandCycleOverrides((prev) => ({
      ...prev,
      [editingCycle]: {
        ...prev[editingCycle],
        amount: Math.round(sanitizedAmount * 100) / 100,
        dueDate: editedCycleDueDate ? formatDueDateFromIso(editedCycleDueDate) : prev[editingCycle].dueDate,
      },
      ...(lastCycleKey && lastCycleKey !== editingCycle
        ? {
            [lastCycleKey]: {
              ...prev[lastCycleKey],
              amount: Math.max(
                0,
                Math.round(
                  (feeConfigured -
                    cycleRows
                      .filter((row) => row.key !== lastCycleKey)
                      .reduce((sum, row) => sum + (row.key === editingCycle ? sanitizedAmount : Number(prev[row.key]?.amount ?? row.amount)), 0)) *
                    100
                ) / 100
              ),
            },
          }
        : {}),
    }));

    setEditDemandModalOpen(false);
  }

  useEffect(() => {
    if (!selectedStudent?.id) {
      setStudentLedger(null);
      return;
    }

    let cancelled = false;

    async function loadLedger() {
      setStudentLedgerLoading(true);
      setStudentLedgerError("");

      try {
        const response = await api.get<StudentLedger>(`/finance/students/${selectedStudent.id}/ledger`);
        if (!cancelled) {
          setStudentLedger(response.data);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setStudentLedger(null);
          setStudentLedgerError("Student ledger could not be loaded right now.");
        }
      } finally {
        if (!cancelled) {
          setStudentLedgerLoading(false);
        }
      }
    }

    void loadLedger();
    return () => {
      cancelled = true;
    };
  }, [selectedStudent?.id, studentLedgerRefreshKey]);

  async function postFee(action: "print" | "post-only" | "new") {
    if (!selectedStudent || !selectedCycleRow || !canPost) {
      return;
    }

    const created = await onCollectFee({
      studentId: selectedStudent.id,
      amount: Number(amount),
      description: `${selectedCycleRow.demand} fee collection`,
      dueCycle: selectedCycle,
      lateFine,
      paymentMode,
      reference: normalizedReference(),
      postingDate: receiptDate,
      collectedBy,
      cashCounter,
      narration,
      exceptionRequestId: approvedException?.id,
    });

    if (!created) {
      return;
    }

    setStudentLedgerRefreshKey((value) => value + 1);

    if (action === "print" && created.receiptNumber) {
      await printReceipt(created.receiptNumber, trustName);
    }

    if (action === "new") {
      resetTransactionEntry();
    }
  }

  async function submitFee(event: FormEvent<HTMLFormElement>, action: "print" | "post-only" | "new") {
    event.preventDefault();
    await postFee(action);
  }

  async function saveDraft() {
    if (!selectedStudent || Number(amount || 0) <= 0) {
      return;
    }

    const created = await onSaveDraft({
      studentId: selectedStudent.id,
      amount: Number(amount),
      dueCycle: selectedCycle,
      lateFine,
      paymentMode,
      reference: normalizedReference(),
      postingDate: receiptDate,
      collectedBy,
      notes: narration,
    });

    if (created?.id) {
      setStudentLedgerRefreshKey((value) => value + 1);
    }
  }

  async function requestException() {
    if (!selectedStudent || Number(amount || 0) <= 0) {
      return;
    }

    const reason = typeof window !== "undefined" ? window.prompt("Enter reason for exception") : null;
    if (!reason?.trim()) {
      return;
    }

    const created = await onRaiseException({
      studentId: selectedStudent.id,
      dueCycle: selectedCycle,
      requestedAmount: Number(amount),
      remainingBalance: Number(selectedCycleRow?.balance ?? 0),
      reason: reason.trim(),
    });

    if (created?.id) {
      setStudentLedgerRefreshKey((value) => value + 1);
    }
  }

  async function submitCredit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onAddCredit({
      collegeId: form.get("collegeId"),
      amount: Number(form.get("amount")),
      source: form.get("source"),
      notes: form.get("notes"),
    });
    event.currentTarget.reset();
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onAddExpense({
      collegeId: form.get("collegeId"),
      amount: Number(form.get("amount")),
      category: form.get("category"),
      spentOn: form.get("spentOn"),
      notes: form.get("notes"),
    });
    event.currentTarget.reset();
  }

  function normalizedReference() {
    if (paymentMode === "CHEQUE") {
      return chequeNo.trim();
    }
    if (paymentMode === "UPI") {
      return utrNumber.trim();
    }
    if (paymentMode === "DD") {
      return ddNumber.trim();
    }
    return instrumentRef.trim();
  }

  function resetTransactionEntry() {
    setInstrumentRef("");
    setChequeNo("");
    setChequeBank("");
    setInstrumentDate("");
    setUtrNumber("");
    setDdNumber("");
    setNarration("");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-slate-500">Cashier operations, receivables management, adjustments, expenses, and receipt ledger.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            ["fee-collection", "Fee Collection"],
            ["receivables", "Receivables & Dues"],
            ["credits-adjustments", "Misc Credits & Adjustments"],
            ["expenses", "Expenses"],
            ["ledger-receipts", "Ledger & Receipts"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveModule(key as FinanceSubmodule)}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium ${activeModule === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeModule === "fee-collection" && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <CardStat title="Today Collection" value={formatCurrency(todayCollection)} icon={Wallet2} />
            <CardStat title="Today Pending" value={formatCurrency(todayPending)} icon={Landmark} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.8fr_1fr]">
            <div className="space-y-4">
              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <h2 className="text-sm font-semibold">Student Fee Context</h2>
                <p className="mt-1 text-xs text-slate-500">Cashier workspace context from student academic structure and fee setup.</p>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="relative md:col-span-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={studentQuery}
                      onChange={(event) => setStudentQuery(event.target.value)}
                      placeholder="Search student by name or admission code"
                      className="w-full rounded-xl bg-slate-100 px-9 py-2.5 text-sm"
                    />
                  </div>
                  <select value={selectedStudent?.id ?? ""} onChange={(event) => setSelectedStudentId(event.target.value)} className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                    {filteredStudents.map((student) => (
                      <option key={student.id} value={student.id}>
                        {formatStudentLabel(student)}
                      </option>
                    ))}
                  </select>

                  <InfoTile label="College" value={academicContext?.college?.name ?? "Not mapped"} />
                  <InfoTile label="Course" value={academicContext?.course?.name ?? "Not mapped"} />
                  <InfoTile label="Session" value={academicContext?.session ? `${academicContext.session.label} (${academicContext.session.startYear}-${academicContext.session.endYear})` : "Not mapped"} />
                  <InfoTile label="Admission No" value={selectedStudent?.admissionCode ?? `#${selectedStudent?.admissionNumber ?? "--"}`} />
                  <InfoTile label="Fee Plan / Version" value={academicContext?.session ? `STRUCT-${academicContext.session.startYear}-${academicContext.session.endYear}` : "Default"} />
                  <InfoTile label="Scholarship / Concession" value={concessionTag} />
                </div>

                <div className="mt-3 flex items-center gap-2 text-sm">
                  <span className="text-slate-500">Student Status:</span>
                  <StatusChip status={normalizeStatus(selectedStudent?.status)} />
                </div>
              </section>

              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <h2 className="text-sm font-semibold">Demand Grid</h2>
                <p className="mt-1 text-xs text-slate-500">Demand cycles are generated from course duration with half-year sequencing controls.</p>

                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2">Demand</th>
                        <th className="px-3 py-2">Due Date</th>
                        <th className="px-3 py-2">Amount</th>
                        <th className="px-3 py-2">Collected</th>
                        <th className="px-3 py-2">Balance</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cycleRows.map((row) => (
                        <tr key={row.key} className={selectedCycle === row.key ? "bg-slate-50" : ""}>
                          <td className="px-3 py-2 font-medium">{row.demand}</td>
                          <td className="px-3 py-2">{row.dueDate}</td>
                          <td className="px-3 py-2">{formatCurrency(row.amount)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.collected)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.balance)}</td>
                          <td className="px-3 py-2">
                            <StatusChip status={row.status} />
                          </td>
                          <td className="px-3 py-2">
                            {row.locked ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500">
                                <Lock className="h-3.5 w-3.5" /> Locked
                              </span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setSelectedCycle(row.key)} className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white">
                                  Collect
                                </button>
                                <button type="button" onClick={() => openEditDemandCycle(row.key)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700">
                                  Edit
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <span className="rounded-lg bg-amber-100 px-2 py-1 text-amber-700">Late fine: {formatCurrency(lateFine)}</span>
                  <button type="button" className="rounded-lg border border-slate-300 px-2 py-1 text-slate-700 disabled:opacity-60" disabled={!canAdjust} onClick={() => setWaiveFine((value) => !value)}>
                    {waiveFine ? "Fine Waiver Applied" : "Waive Fine"}
                  </button>
                  <button type="button" className="rounded-lg border border-slate-300 px-2 py-1 text-slate-700">Installment Split</button>
                </div>
              </section>

              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <h2 className="text-sm font-semibold">Payment Entry</h2>
                <p className="mt-1 text-xs text-slate-500">Accounting-grade posting fields with instrument-level controls.</p>

                <form className="mt-4 space-y-4" onSubmit={(event) => void submitFee(event, "print")}>
                  <div className="grid gap-3 md:grid-cols-3">
                    <select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)} className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required>
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="BANK">Bank Transfer</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="DD">Demand Draft</option>
                    </select>
                    <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0" step="0.01" placeholder="Amount" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                    <input value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} type="date" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                    <input value={collectedBy} onChange={(event) => setCollectedBy(event.target.value)} placeholder="Collected by" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                    <input value={cashCounter} onChange={(event) => setCashCounter(event.target.value)} placeholder="Cash drawer / counter" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                    <input value={instrumentRef} onChange={(event) => setInstrumentRef(event.target.value)} placeholder="Instrument ref" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                  </div>

                  {paymentMode === "CHEQUE" && (
                    <div className="grid gap-3 md:grid-cols-3">
                      <input value={chequeNo} onChange={(event) => setChequeNo(event.target.value)} placeholder="Cheque No" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                      <input value={chequeBank} onChange={(event) => setChequeBank(event.target.value)} placeholder="Bank" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                      <input value={instrumentDate} onChange={(event) => setInstrumentDate(event.target.value)} type="date" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                    </div>
                  )}

                  {paymentMode === "UPI" && (
                    <div className="grid gap-3 md:grid-cols-3">
                      <input value={utrNumber} onChange={(event) => setUtrNumber(event.target.value)} placeholder="UTR Number" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                    </div>
                  )}

                  {paymentMode === "DD" && (
                    <div className="grid gap-3 md:grid-cols-3">
                      <input value={ddNumber} onChange={(event) => setDdNumber(event.target.value)} placeholder="DD Number" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                    </div>
                  )}

                  <textarea value={narration} onChange={(event) => setNarration(event.target.value)} placeholder="Narration (optional)" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" rows={2} />

                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={loading || !canPost} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                      {loading ? "Posting..." : "Post & Print Receipt"}
                    </button>
                    <button type="button" disabled={loading || !canPost} onClick={() => void postFee("post-only")} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-60">
                      Post Only
                    </button>
                    <button type="button" disabled={loading || Number(amount || 0) <= 0} onClick={() => void saveDraft()} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-60">
                      Save as Draft
                    </button>
                    <button type="button" onClick={resetTransactionEntry} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">
                      Cancel Transaction
                    </button>
                    <button type="button" disabled={loading || Number(amount || 0) <= 0} onClick={() => void requestException()} className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 disabled:opacity-60">
                      Request Exception
                    </button>
                  </div>
                </form>
              </section>

              {/* TODO: Shift Control implementation pending Phase 2 backend work
              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <h2 className="text-sm font-semibold">Cashier Shift Control</h2>
                <p className="mt-1 text-xs text-slate-500">Open counter, close counter, and day-end reconciliation.</p>

                <div className="mt-4 flex flex-wrap gap-3">
                  <input disabled type="number" min="0" step="0.01" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" placeholder="Opening cash" />
                  <input disabled type="number" min="0" step="0.01" className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm" placeholder="Closing cash" />
                  <button disabled type="button" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white opacity-50">
                    Open Cash Counter
                  </button>
                  <button disabled type="button" className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm opacity-50">
                    Close Counter
                  </button>
                  <button disabled type="button" className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm opacity-50">
                    Day-End Reconciliation
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-500">Shift status: <span className="font-semibold text-slate-700">Disabled (Phase 2)</span></p>
              </section>
              */}

              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <h2 className="text-sm font-semibold">Student Ledger</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    ["receipts", "Receipts"],
                    ["demand", "Demand Ledger"],
                    ["adjustments", "Adjustments"],
                    ["audit", "Audit Trail"],
                  ].map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setLedgerTab(key as LedgerTab)} className={`rounded-xl px-3 py-1.5 text-xs font-medium ${ledgerTab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
                      {label}
                    </button>
                  ))}
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Doc No</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Debit</th>
                        <th className="px-3 py-2">Credit</th>
                        <th className="px-3 py-2">Balance</th>
                        <th className="px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {studentLedgerLoading && (
                        <tr>
                          <td className="px-3 py-4 text-slate-500" colSpan={7}>Loading ledger...</td>
                        </tr>
                      )}

                      {!studentLedgerLoading && studentLedgerError && (
                        <tr>
                          <td className="px-3 py-4 text-rose-500" colSpan={7}>{studentLedgerError}</td>
                        </tr>
                      )}

                      {!studentLedgerLoading && !studentLedgerError && ledgerTab === "receipts" && (studentLedger?.receipts ?? []).map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2">{new Date(row.collectedAt).toLocaleDateString()}</td>
                          <td className="px-3 py-2 font-medium">{row.receiptNumber}</td>
                          <td className="px-3 py-2">{row.cycleLabel ?? "Receipt"}</td>
                          <td className="px-3 py-2">{formatCurrency(row.totalReceived)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.totalReceived)}</td>
                          <td className="px-3 py-2">{formatCurrency(Math.max(0, outstandingBalance))}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              <button type="button" onClick={() => void printReceipt(row.receiptNumber, trustName)} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">
                                <Printer className="h-3.5 w-3.5" /> Reprint
                              </button>
                              <button type="button" disabled={!canReverse} className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-60">Reverse</button>
                              <button type="button" disabled={!canReverse} className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-60">Void</button>
                              <button type="button" disabled={!canReverse} className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-60">Reissue</button>
                            </div>
                          </td>
                        </tr>
                      ))}

                      {!studentLedgerLoading && !studentLedgerError && ledgerTab === "demand" && cycleRows.map((row) => (
                        <tr key={row.key}>
                          <td className="px-3 py-2">{row.dueDate}</td>
                          <td className="px-3 py-2">{row.demand}</td>
                          <td className="px-3 py-2">Demand</td>
                          <td className="px-3 py-2">{formatCurrency(row.amount)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.collected)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.balance)}</td>
                          <td className="px-3 py-2">{row.status}</td>
                        </tr>
                      ))}

                      {!studentLedgerLoading && !studentLedgerError && ledgerTab === "adjustments" && [
                        ...(studentLedger?.drafts ?? []).map((row) => ({
                          id: row.id,
                          date: row.createdAt,
                          doc: row.id,
                          type: "Draft",
                          debit: Number(row.amount),
                          credit: 0,
                          balance: Number(row.amount),
                        })),
                        ...(studentLedger?.exceptions ?? []).map((row) => ({
                          id: row.id,
                          date: row.createdAt,
                          doc: row.id,
                          type: `Exception ${row.status}`,
                          debit: Number(row.requestedAmount),
                          credit: 0,
                          balance: Number(row.remainingBalance),
                        })),
                      ].map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2">{new Date(row.date).toLocaleDateString()}</td>
                          <td className="px-3 py-2">{row.doc}</td>
                          <td className="px-3 py-2">{row.type}</td>
                          <td className="px-3 py-2">{formatCurrency(row.debit)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.credit)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.balance)}</td>
                          <td className="px-3 py-2">--</td>
                        </tr>
                      ))}

                      {!studentLedgerLoading && !studentLedgerError && ledgerTab === "audit" && (studentLedger?.timeline ?? []).slice(0, 12).map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2">{new Date(row.createdAt).toLocaleDateString()}</td>
                          <td className="px-3 py-2">{row.id.slice(0, 8)}</td>
                          <td className="px-3 py-2">{row.title}</td>
                          <td className="px-3 py-2">--</td>
                          <td className="px-3 py-2">--</td>
                          <td className="px-3 py-2">--</td>
                          <td className="px-3 py-2 text-xs text-slate-500">{row.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="grid gap-4 md:grid-cols-2">
                <Panel title="Adjustments" description="Approval-controlled finance actions.">
                  <ul className="space-y-2 text-sm text-slate-700">
                    <li>Fee concession</li>
                    <li>Fine waiver</li>
                    <li>Excess refund</li>
                    <li>Credit note</li>
                    <li>Scholarship adjustment</li>
                  </ul>
                  <button type="button" disabled={!canAdjust} className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium disabled:opacity-60">
                    Start Adjustment
                  </button>
                </Panel>

                <Panel title="Bulk Utilities" description="Batch tools for finance staff.">
                  <div className="grid gap-2 text-sm">
                    <button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-left">Bulk demand generation</button>
                    <button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-left">Bulk fine calculation</button>
                    <button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-left">Bulk receipt reprint</button>
                    <button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-left">Bulk due reminders</button>
                  </div>
                </Panel>
              </section>
            </div>

            <div className="space-y-4 xl:sticky xl:top-4">
              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Receipt Preview</h2>
                    <p className="mt-1 text-xs text-slate-500">Pre-generated operational preview before posting.</p>
                  </div>
                  <ReceiptText className="h-5 w-5 text-slate-500" />
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <PreviewRow label="Receipt No" value={previewReceiptNumber(selectedStudent?.id, selectedCycle)} />
                  <PreviewRow label="Student" value={selectedStudent ? formatStudentLabel(selectedStudent) : "Select student"} />
                  <PreviewRow label="Demand" value={selectedCycleRow?.demand ?? "--"} />
                  <PreviewRow label="Receipt Date" value={receiptDate || "--"} />
                  <PreviewRow label="Payment Mode" value={paymentMode} />
                  <PreviewRow label="Counter" value={cashCounter || "--"} />
                </div>

                <div className="mt-4 rounded-2xl bg-slate-900 p-4 text-sm text-white">
                  <div className="mb-1 text-xs uppercase tracking-wide text-slate-300">Ledger impact preview</div>
                  <div className="flex items-center justify-between">
                    <span>Debit: Cash</span>
                    <span>{formatCurrency(Number(amount || 0))}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>Credit: Student Fee Receivable</span>
                    <span>{formatCurrency(Number(amount || 0))}</span>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <h2 className="text-sm font-semibold">Posting Checks</h2>
                <div className="mt-3 space-y-2">
                  {validations.map((row) => (
                    <div key={row.label} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <span className="text-slate-700">{row.label}</span>
                      {row.pass ? (
                        <CircleCheck className="h-4 w-4 text-emerald-600" />
                      ) : row.warning ? (
                        <CircleAlert className="h-4 w-4 text-amber-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-rose-600" />
                      )}
                    </div>
                  ))}
                </div>

                {!canPost && (
                  <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">Posting is blocked until all mandatory validations are green or an approved exception is available.</p>
                )}
              </section>

              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                <h2 className="text-sm font-semibold">Role Controls</h2>
                <ul className="mt-3 space-y-2 text-xs text-slate-600">
                  <li>Cashier: collect, print</li>
                  <li>Finance Officer: adjust, waive fine</li>
                  <li>Approver: approve concessions</li>
                  <li>Super Admin: reverse/void/reissue</li>
                </ul>
              </section>
            </div>
          </div>
        </>
      )}

      {activeModule === "receivables" && (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h2 className="text-sm font-semibold">Receivables Aging</h2>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Bucket</th>
                    <th className="px-3 py-2">Accounts</th>
                    <th className="px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receivablesAging.buckets.map((bucket) => (
                    <tr key={bucket.label}>
                      <td className="px-3 py-2">{bucket.label}</td>
                      <td className="px-3 py-2">{bucket.count}</td>
                      <td className="px-3 py-2">{formatCurrency(Number(bucket.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="mt-5 text-sm font-semibold">Defaulter Monitoring</h3>
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Student</th>
                    <th className="px-3 py-2">Days</th>
                    <th className="px-3 py-2">Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receivablesAging.defaulters.slice(0, 12).map((row) => (
                    <tr key={row.studentId}>
                      <td className="px-3 py-2">{row.candidateName}</td>
                      <td className="px-3 py-2">{row.daysOutstanding}</td>
                      <td className="px-3 py-2">{formatCurrency(row.due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h2 className="text-sm font-semibold">Receivable Snapshot</h2>
            <div className="mt-4 space-y-3">
              <MetricRow label="Total Due" value={formatCurrency(todayPending)} />
              <MetricRow label="High Risk (90+)" value={String(receivablesAging.buckets.find((b) => b.label === "90+")?.count ?? 0)} />
              <MetricRow label="Exceptions Queue" value={String(receivablesAging.defaulters.filter((row) => row.daysOutstanding > 60).length)} />
            </div>
          </section>
        </div>
      )}

      {activeModule === "credits-adjustments" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h2 className="text-sm font-semibold">Misc Credits</h2>
            <form className="mt-4 space-y-3" onSubmit={submitCredit}>
              <select name="collegeId" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required>
                {colleges.map((college) => (
                  <option key={college.id} value={college.id}>{college.name}</option>
                ))}
              </select>
              <input name="source" placeholder="Credit source" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
              <input name="amount" type="number" min="0" step="0.01" placeholder="Amount" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
              <textarea name="notes" placeholder="Notes" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" rows={2} />
              <button type="submit" disabled={loading} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Add Credit</button>
            </form>
          </section>

          <Panel title="Controlled Adjustments" description="Approval-based financial adjustments.">
            <div className="space-y-2 text-sm">
              <button type="button" disabled={!canAdjust} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-left disabled:opacity-60">Fee concession</button>
              <button type="button" disabled={!canAdjust} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-left disabled:opacity-60">Fine waiver</button>
              <button type="button" disabled={!canAdjust} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-left disabled:opacity-60">Excess refund</button>
              <button type="button" disabled={!canAdjust} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-left disabled:opacity-60">Credit note</button>
              <button type="button" disabled={!canAdjust} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-left disabled:opacity-60">Scholarship adjustment</button>
            </div>
          </Panel>
        </div>
      )}

      {activeModule === "expenses" && (
        <ExpenseManagement
          colleges={colleges}
          permissions={permissions}
          onAddExpense={onAddExpense}
          loading={loading}
          expenses={expenses}
        />
      )}

      {activeModule === "ledger-receipts" && (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Ledger & Receipts</h2>
            <button type="button" onClick={() => setStudentLedgerRefreshKey((value) => value + 1)} className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <RefreshCcw className="h-4 w-4" /> Refresh
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input value={ledgerReceiptSearch} onChange={(event) => setLedgerReceiptSearch(event.target.value)} placeholder="Search receipt number or cycle" className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
            <input value={ledgerPresetName} onChange={(event) => setLedgerPresetName(event.target.value)} placeholder="Preset name" className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
            <button type="button" onClick={saveLedgerPreset} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Save Preset</button>
            <select value={selectedLedgerPresetId} onChange={(event) => applyLedgerPresetById(event.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
              <option value="">Apply saved preset</option>
              {savedLedgerPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </select>
            <button type="button" onClick={deleteLedgerPreset} disabled={!selectedLedgerPresetId} className="rounded-xl bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60">Delete</button>
            <button type="button" onClick={exportLedgerReceiptsCsv} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">Export CSV</button>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Receipt No</th>
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">Cycle</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLedgerReceipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td className="px-3 py-2 font-medium">{receipt.receiptNumber}</td>
                    <td className="px-3 py-2">{selectedStudent ? formatStudentLabel(selectedStudent) : "--"}</td>
                    <td className="px-3 py-2">{receipt.cycleLabel ?? "Fee"}</td>
                    <td className="px-3 py-2">{formatCurrency(receipt.totalReceived)}</td>
                    <td className="px-3 py-2">{new Date(receipt.collectedAt).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button type="button" onClick={() => void printReceipt(receipt.receiptNumber, trustName)} className="rounded-lg bg-slate-100 px-2 py-1 text-xs">Print</button>
                        <button type="button" disabled={!canReverse} className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-60">Reverse</button>
                        <button type="button" disabled={!canReverse} className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-60">Void</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredLedgerReceipts.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={6}>No receipts available for selected student.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editDemandModalOpen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">Edit Demand Cycle</h3>
            <p className="mt-1 text-xs text-slate-500">Adjust amount and due date for {cycleRows.find((row) => row.key === editingCycle)?.demand ?? editingCycle}. The final cycle absorbs the remaining configured fee.</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Cycle Amount</label>
                <input
                  type="number"
                  min="0"
                  max={feeConfigured}
                  step="0.01"
                  value={editedCycleAmount}
                  onChange={(event) => setEditedCycleAmount(Number(event.target.value))}
                  className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Due Date</label>
                <input
                  type="date"
                  value={editedCycleDueDate}
                  onChange={(event) => setEditedCycleDueDate(event.target.value)}
                  className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm"
                />
              </div>

              <p className="text-xs text-slate-500">Total configured fee remains {formatCurrency(feeConfigured)}.</p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditDemandModalOpen(false)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700">
                Cancel
              </button>
              <button type="button" onClick={saveEditedDemandCycle} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                Save Cycle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CardStat({ title, value, icon: Icon }: { title: string; value: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-400">{title}</p>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-white">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-4 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const palette =
    status === "Paid" || status === "Active"
      ? "bg-emerald-100 text-emerald-700"
      : status === "Partial"
        ? "bg-amber-100 text-amber-700"
        : status === "Blocked"
          ? "bg-slate-200 text-slate-700"
          : status === "Overdue" || status === "Suspended" || status === "Debarred"
            ? "bg-rose-100 text-rose-700"
            : "bg-slate-100 text-slate-700";

  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${palette}`}>{status}</span>;
}

function formatStudentLabel(student: Student) {
  return `${student.candidateName} (${student.admissionCode ?? `#${student.admissionNumber}`})`;
}

function formatCurrency(value: number) {
  const v = Number(value || 0);
  return `INR ${(v / 1000).toFixed(1)}K`;
}

function getDueDateLabel(year: number | undefined, month: number, day: number) {
  const resolvedYear = year ?? new Date().getFullYear();
  const date = new Date(resolvedYear, month - 1, day);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function toIsoDate(displayDate: string) {
  const parsed = new Date(displayDate);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function formatDueDateFromIso(isoDate: string) {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Get date boundary in UTC format for duplicate detection.
 * Ensures timezone-aware comparison at midnight UTC boundaries.
 */
function getDateBoundaryUTC(dateStr: string) {
  const date = new Date(dateStr + "T00:00:00Z"); // Parse as UTC
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setUTCHours(23, 59, 59, 999);
  return { dayStart, dayEnd };
}

function isSameDate(left: string, right: string) {
  // Use UTC boundary comparison for timezone safety
  const { dayStart, dayEnd } = getDateBoundaryUTC(right);
  const leftDate = new Date(left);
  return leftDate >= dayStart && leftDate <= dayEnd;
}

function normalizeStatus(status: string | undefined) {
  if (!status) {
    return "Active";
  }
  if (status === "ACTIVE") {
    return "Active";
  }
  if (status === "DROP_OUT") {
    return "Debarred";
  }
  if (status === "PASSED_OUT") {
    return "Alumni";
  }
  return status;
}

function isStudentActive(status: string | undefined) {
  const normalized = normalizeStatus(status).toLowerCase();
  return normalized === "active";
}

function getCourseDurationYears(startYear?: number, endYear?: number) {
  if (!startYear || !endYear) {
    return 1;
  }

  return Math.max(1, endYear - startYear);
}

function calculateLateFine(daysOutstanding: number) {
  if (daysOutstanding <= 30) {
    return 0;
  }
  if (daysOutstanding <= 60) {
    return 250;
  }
  if (daysOutstanding <= 90) {
    return 500;
  }
  return 1000;
}

function previewReceiptNumber(studentId: string | undefined, dueCycle: DueCycle) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const seed = (studentId ?? "XXXX").slice(-4).toUpperCase();
  const cycleSuffix = dueCycle.replace("CYCLE_", "C");
  return `PRE-${cycleSuffix}-${today}-${seed}`;
}

// ─── Expense Management Module ────────────────────────────────────────────────

const EXPENSE_CATEGORY_MAP: Record<string, string[]> = {
  "Operational": ["Electricity", "Internet", "Maintenance", "Transport", "Security", "Housekeeping", "Other"],
  "Academic": ["Lab Equipment", "Library Books", "Faculty Training", "Examination Expenses", "Other"],
  "Capital": ["Building Construction", "Furniture", "Vehicle Purchase", "Infrastructure Upgrades", "Other"],
  "Trust/Admin": ["Legal Fees", "Audit Fees", "Compliance Fees", "Other"],
  "Student Welfare": ["Scholarships", "Fee Waivers", "Student Aid", "Other"],
};

const EXPENSE_PAYMENT_SOURCES = ["Student Fees", "Donations", "Grants", "Trust Reserves", "CSR Funds", "Scholarship Funds", "Other"];
const EXPENSE_FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"];
const PIE_COLORS = ["#1e40af", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#0f172a"];

function formatINR(amount: number) {
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)}L`;
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(1)}K`;
  return `₹${amount.toFixed(0)}`;
}

function KpiCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: "blue" | "green" | "amber" | "purple" | "red" }) {
  const colorMap = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700",
    purple: "bg-purple-50 text-purple-700",
    red: "bg-red-50 text-red-700",
  };
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${colorMap[color]}`}>{icon}</span>
      </div>
      <div className="mt-2 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function ExpenseStatusBadge({ status }: { status: string | undefined }) {
  if (status === "APPROVED") return <span className="rounded-lg bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Approved</span>;
  if (status === "REJECTED") return <span className="rounded-lg bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Rejected</span>;
  return <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Pending</span>;
}

function RejectModal({ onConfirm, onCancel }: { onConfirm: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="mb-3 text-base font-semibold">Reject Expense</h3>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Rejection reason (optional)" className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm" rows={3} />
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => onConfirm(note)} className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white">Confirm Reject</button>
          <button type="button" onClick={onCancel} className="flex-1 rounded-xl bg-slate-100 px-4 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ExpenseManagement({
  colleges,
  permissions,
  onAddExpense,
  loading,
}: {
  colleges: College[];
  permissions: string[];
  onAddExpense: (payload: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  expenses: Expense[];
}) {
  const canApprove = hasPermission(permissions, "FINANCE_APPROVE");
  const canWrite = hasPermission(permissions, "FINANCE_WRITE");

  const [activeTab, setActiveTab] = useState<ExpenseTab>("dashboard");
  const [filterCollegeId, setFilterCollegeId] = useState(colleges[0]?.id ?? "");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [expensePresetName, setExpensePresetName] = useState("");
  const [selectedExpensePresetId, setSelectedExpensePresetId] = useState("");
  const [savedExpensePresets, setSavedExpensePresets] = useState<Array<SavedPreset<ExpenseFilterPresetValues>>>(() =>
    loadSavedPresets<ExpenseFilterPresetValues>(EXPENSE_FILTER_PRESET_KEY)
  );

  const [vendors, setVendors] = useState<ExpenseVendor[]>([]);
  const [budgets, setBudgets] = useState<ExpenseBudget[]>([]);
  const [recurring, setRecurring] = useState<ExpenseRecurring[]>([]);
  const [pettyCash, setPettyCash] = useState<PettyCashEntry[]>([]);
  const [detailExpenses, setDetailExpenses] = useState<Expense[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Add expense form
  const [expCategory, setExpCategory] = useState("Operational");
  const [expSubcategory, setExpSubcategory] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));
  const [expVendorId, setExpVendorId] = useState("");
  const [expVendorName, setExpVendorName] = useState("");
  const [expPaymentSource, setExpPaymentSource] = useState("");
  const [expProcurementRequestRef, setExpProcurementRequestRef] = useState("");
  const [expProcurementOrderRef, setExpProcurementOrderRef] = useState("");
  const [expGoodsReceiptRef, setExpGoodsReceiptRef] = useState("");
  const [expSourceDocumentRef, setExpSourceDocumentRef] = useState("");
  const [expDescription, setExpDescription] = useState("");
  const [expAttachmentName, setExpAttachmentName] = useState("");
  const [expAttachmentPath, setExpAttachmentPath] = useState("");
  const [expAttachmentMime, setExpAttachmentMime] = useState("");
  const [expAttachmentSize, setExpAttachmentSize] = useState<number | null>(null);
  const [expAttachmentDownloadUrl, setExpAttachmentDownloadUrl] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [expCollegeId, setExpCollegeId] = useState(colleges[0]?.id ?? "");
  const [expSubmitting, setExpSubmitting] = useState(false);

  // Vendor form
  const [vendorFormOpen, setVendorFormOpen] = useState(false);
  const [vendorForm, setVendorForm] = useState({ name: "", gstNumber: "", contactPerson: "", phone: "", email: "", address: "", paymentTerms: "" });
  const [vendorCollegeId, setVendorCollegeId] = useState(colleges[0]?.id ?? "");
  const [vendorSubmitting, setVendorSubmitting] = useState(false);

  // Budget form
  const [budgetFormOpen, setBudgetFormOpen] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ category: "Operational", allocatedAmount: "", financialYear: "" });
  const [budgetCollegeId, setBudgetCollegeId] = useState(colleges[0]?.id ?? "");

  // Recurring form
  const [recurringFormOpen, setRecurringFormOpen] = useState(false);
  const [recurringForm, setRecurringForm] = useState({ title: "", category: "Operational", amount: "", frequency: "MONTHLY", nextDueDate: new Date().toISOString().slice(0, 10) });
  const [recurringCollegeId, setRecurringCollegeId] = useState(colleges[0]?.id ?? "");

  // Petty cash form
  const [pettyCollegeId, setPettyCollegeId] = useState(colleges[0]?.id ?? "");
  const [pettyForm, setPettyForm] = useState({ entryType: "EXPENSE", amount: "", description: "", reference: "" });

  // Approval state
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  // Reports + audit state
  const [reportDateFrom, setReportDateFrom] = useState("");
  const [reportDateTo, setReportDateTo] = useState("");
  const [reportData, setReportData] = useState<ExpenseReportResponse | null>(null);
  const [auditLogs, setAuditLogs] = useState<ExpenseAuditLog[]>([]);
  const [auditAction, setAuditAction] = useState("");

  const currentFY = useMemo(() => {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${String(year + 1).slice(-2)}`;
  }, []);

  useEffect(() => {
    setBudgetForm((f) => ({ ...f, financialYear: currentFY }));
  }, [currentFY]);

  async function loadData() {
    setDataLoading(true);
    try {
      const params = filterCollegeId ? { collegeId: filterCollegeId } : {};
      const expenseParams = {
        ...params,
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterCategory ? { category: filterCategory } : {}),
      };
      const reportsParams = {
        ...params,
        ...(reportDateFrom ? { from: reportDateFrom } : {}),
        ...(reportDateTo ? { to: reportDateTo } : {}),
      };
      const auditParams = {
        ...params,
        ...(reportDateFrom ? { from: reportDateFrom } : {}),
        ...(reportDateTo ? { to: reportDateTo } : {}),
        ...(auditAction ? { action: auditAction } : {}),
      };

      const [vendorsRes, budgetsRes, recurringRes, pettyCashRes, expensesRes, reportsRes, auditRes] = await Promise.all([
        api.get<ExpenseVendor[]>("/finance/vendors", { params }),
        api.get<ExpenseBudget[]>("/finance/budgets", { params: { ...params, financialYear: currentFY } }),
        api.get<ExpenseRecurring[]>("/finance/recurring-expenses", { params }),
        api.get<PettyCashEntry[]>("/finance/petty-cash", { params }),
        api.get<Expense[]>("/finance/expenses", { params: expenseParams }),
        api.get<ExpenseReportResponse>("/finance/expenses/reports", { params: reportsParams }),
        api.get<ExpenseAuditLog[]>("/finance/expenses/audit-logs", { params: auditParams }),
      ]);
      setVendors(vendorsRes.data);
      setBudgets(budgetsRes.data);
      setRecurring(recurringRes.data);
      setPettyCash(pettyCashRes.data);
      setDetailExpenses(expensesRes.data);
      setReportData(reportsRes.data);
      setAuditLogs(auditRes.data);
    } catch {
      // fail silently
    } finally {
      setDataLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, [filterCollegeId, filterStatus, filterCategory, reportDateFrom, reportDateTo, auditAction]);

  // ── KPI computations ──────────────────────────────────────────────────────
  const thisMonthExpenses = useMemo(() => {
    const now = new Date();
    return detailExpenses
      .filter((e) => { const d = new Date(e.spentOn); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }, [detailExpenses]);

  const pendingCount = useMemo(() => detailExpenses.filter((e) => !e.approvalStatus || e.approvalStatus === "PENDING").length, [detailExpenses]);

  const upcomingRecurring = useMemo(() => {
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    return recurring.filter((r) => r.isActive && new Date(r.nextDueDate) <= in30).length;
  }, [recurring]);

  const pettyCashBalance = useMemo(() => {
    const sorted = [...pettyCash].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return Number(sorted[0]?.runningBalance ?? 0);
  }, [pettyCash]);

  const categoryData = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of detailExpenses) { map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount)); }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [detailExpenses]);

  const monthlyTrend = useMemo(() => {
    return Array.from({ length: 6 }).map((_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
      const month = d.toLocaleString("en-US", { month: "short" });
      const total = detailExpenses
        .filter((e) => { const ed = new Date(e.spentOn); return ed.getMonth() === d.getMonth() && ed.getFullYear() === d.getFullYear(); })
        .reduce((sum, e) => sum + Number(e.amount), 0);
      return { month, total };
    });
  }, [detailExpenses]);

  const budgetUtilization = useMemo(() => {
    return budgets.map((b) => {
      const spent = detailExpenses
        .filter((e) => e.category === b.category && e.approvalStatus === "APPROVED")
        .reduce((sum, e) => sum + Number(e.amount), 0);
      const pct = Number(b.allocatedAmount) > 0 ? Math.round((spent / Number(b.allocatedAmount)) * 100) : 0;
      return { ...b, spent, pct };
    });
  }, [budgets, detailExpenses]);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleApprove(id: string) {
    try { await api.post(`/finance/expenses/${id}/approve`); await loadData(); } catch { /* ignore */ }
  }

  async function handleReject(id: string, note: string) {
    try { await api.post(`/finance/expenses/${id}/reject`, { note }); setRejectingId(null); await loadData(); } catch { /* ignore */ }
  }

  async function uploadAttachment(file: File) {
    if (!expCollegeId) {
      return;
    }

    setUploadingAttachment(true);
    try {
      const signRes = await api.post<{
        attachmentPath: string;
        uploadUrl: string;
        downloadUrl: string;
        suggested?: { attachmentName?: string; attachmentMime?: string };
      }>("/finance/expenses/attachments/sign", {
        collegeId: expCollegeId,
        fileName: file.name,
        mimeType: file.type,
      });

      const uploadPath = signRes.data.uploadUrl.replace(/^https?:\/\/[^/]+/, "");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? "");
          const payload = result.includes(",") ? result.split(",")[1] : result;
          resolve(payload);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      await api.post(uploadPath, { contentBase64: base64, size: file.size });

      setExpAttachmentPath(signRes.data.attachmentPath);
      setExpAttachmentName(signRes.data.suggested?.attachmentName ?? file.name);
      setExpAttachmentMime(signRes.data.suggested?.attachmentMime ?? file.type);
      setExpAttachmentSize(file.size);
      setExpAttachmentDownloadUrl(signRes.data.downloadUrl);
    } finally {
      setUploadingAttachment(false);
    }
  }

  function openExport(pathname: string, extraParams?: Record<string, string>) {
    const params = new URLSearchParams({
      ...(filterCollegeId ? { collegeId: filterCollegeId } : {}),
      ...(reportDateFrom ? { from: reportDateFrom } : {}),
      ...(reportDateTo ? { to: reportDateTo } : {}),
      ...(extraParams ?? {}),
    });
    if (typeof window !== "undefined") {
      window.open(`${api.defaults.baseURL}${pathname}?${params.toString()}`, "_blank");
    }
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExpSubmitting(true);
    try {
      await onAddExpense({
        collegeId: expCollegeId,
        category: expCategory,
        subcategory: expSubcategory || undefined,
        amount: Number(expAmount),
        spentOn: expDate,
        vendorId: expVendorId || undefined,
        vendorName: expVendorName || undefined,
        paymentSource: expPaymentSource || undefined,
        procurementRequestRef: expProcurementRequestRef || undefined,
        procurementOrderRef: expProcurementOrderRef || undefined,
        goodsReceiptRef: expGoodsReceiptRef || undefined,
        sourceDocumentRef: expSourceDocumentRef || undefined,
        description: expDescription || undefined,
        attachmentPath: expAttachmentPath || undefined,
        attachmentName: expAttachmentName || undefined,
        attachmentMime: expAttachmentMime || undefined,
        attachmentSize: expAttachmentSize || undefined,
        attachmentUrl: expAttachmentDownloadUrl || undefined,
      });
      setExpAmount("");
      setExpSubcategory("");
      setExpVendorId("");
      setExpVendorName("");
      setExpPaymentSource("");
      setExpProcurementRequestRef("");
      setExpProcurementOrderRef("");
      setExpGoodsReceiptRef("");
      setExpSourceDocumentRef("");
      setExpDescription("");
      setExpAttachmentPath("");
      setExpAttachmentName("");
      setExpAttachmentMime("");
      setExpAttachmentSize(null);
      setExpAttachmentDownloadUrl("");
      await loadData();
      setActiveTab("all");
    } finally { setExpSubmitting(false); }
  }

  async function submitVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVendorSubmitting(true);
    try {
      await api.post("/finance/vendors", { collegeId: vendorCollegeId, ...vendorForm });
      setVendorForm({ name: "", gstNumber: "", contactPerson: "", phone: "", email: "", address: "", paymentTerms: "" });
      setVendorFormOpen(false);
      await loadData();
    } finally { setVendorSubmitting(false); }
  }

  async function submitBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api.post("/finance/budgets", { collegeId: budgetCollegeId, ...budgetForm, allocatedAmount: Number(budgetForm.allocatedAmount) });
      setBudgetForm({ category: "Operational", allocatedAmount: "", financialYear: currentFY });
      setBudgetFormOpen(false);
      await loadData();
    } catch { /* ignore */ }
  }

  async function submitRecurring(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api.post("/finance/recurring-expenses", { collegeId: recurringCollegeId, ...recurringForm, amount: Number(recurringForm.amount) });
      setRecurringForm({ title: "", category: "Operational", amount: "", frequency: "MONTHLY", nextDueDate: new Date().toISOString().slice(0, 10) });
      setRecurringFormOpen(false);
      await loadData();
    } catch { /* ignore */ }
  }

  async function submitPettyCash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api.post("/finance/petty-cash", { collegeId: pettyCollegeId, ...pettyForm, amount: Number(pettyForm.amount) });
      setPettyForm({ entryType: "EXPENSE", amount: "", description: "", reference: "" });
      await loadData();
    } catch { /* ignore */ }
  }

  async function toggleRecurring(id: string, isActive: boolean) {
    try { await api.patch(`/finance/recurring-expenses/${id}`, { isActive: !isActive }); await loadData(); } catch { /* ignore */ }
  }

  function saveExpensePreset() {
    const name = expensePresetName.trim();
    if (!name) {
      return;
    }
    const next = upsertSavedPreset<ExpenseFilterPresetValues>(EXPENSE_FILTER_PRESET_KEY, name, {
      collegeId: filterCollegeId,
      status: filterStatus,
      category: filterCategory,
    });
    setSavedExpensePresets(next);
    setExpensePresetName("");
  }

  function applyExpensePresetById(presetId: string) {
    setSelectedExpensePresetId(presetId);
    const preset = savedExpensePresets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setFilterCollegeId(preset.values.collegeId);
    setFilterStatus(preset.values.status);
    setFilterCategory(preset.values.category);
  }

  function deleteExpensePreset() {
    if (!selectedExpensePresetId) {
      return;
    }
    const next = removeSavedPreset<ExpenseFilterPresetValues>(EXPENSE_FILTER_PRESET_KEY, selectedExpensePresetId);
    setSavedExpensePresets(next);
    setSelectedExpensePresetId("");
  }

  function exportExpensesCsv() {
    exportRowsToCsv(
      `expenses-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Date", "Category", "Subcategory", "Vendor", "Amount", "Source", "Status", "Source Doc Ref"],
      detailExpenses.map((expense) => [
        new Date(expense.spentOn).toISOString().slice(0, 10),
        expense.category,
        expense.subcategory ?? "",
        (expense.vendor as { name: string } | null)?.name ?? expense.vendorName ?? "",
        String(expense.amount ?? 0),
        expense.paymentSource ?? "",
        expense.approvalStatus ?? "PENDING",
        expense.sourceDocumentRef ?? "",
      ])
    );
  }

  const tabDefs: Array<{ key: ExpenseTab; label: string }> = [
    { key: "dashboard", label: "Dashboard" },
    { key: "all", label: "All Expenses" },
    { key: "add", label: "Add Expense" },
    { key: "approvals", label: pendingCount > 0 ? `Approvals (${pendingCount})` : "Approvals" },
    { key: "budgets", label: "Budgets" },
    { key: "vendors", label: "Vendors" },
    { key: "recurring", label: "Recurring" },
    { key: "petty-cash", label: "Petty Cash" },
    { key: "reports", label: "Reports" },
    { key: "audit-logs", label: "Audit Logs" },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-navigation + college filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select value={filterCollegeId} onChange={(e) => setFilterCollegeId(e.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
          {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="flex flex-wrap gap-1">
          {tabDefs.map((t) => (
            <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${activeTab === t.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── DASHBOARD ── */}
      {activeTab === "dashboard" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="This Month" value={formatINR(thisMonthExpenses)} icon="₹" color="blue" />
            <KpiCard label="Pending Approvals" value={String(pendingCount)} icon="⏳" color={pendingCount > 0 ? "amber" : "green"} />
            <KpiCard label="Recurring Due (30d)" value={String(upcomingRecurring)} icon="🔄" color="purple" />
            <KpiCard label="Petty Cash Balance" value={formatINR(pettyCashBalance)} icon="💰" color="green" />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="col-span-2 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">Monthly Expense Trend</h3>
              <div className="mt-4 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`} />
                    <Tooltip formatter={(v) => [formatINR(Number(v)), "Amount"]} />
                    <Bar dataKey="total" fill="#1e40af" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">Category Mix</h3>
              <div className="mt-2 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="name" outerRadius={68} label={({ name }: { name?: string }) => (name ?? "").slice(0, 8)}>
                      {categoryData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [formatINR(Number(v)), "Amount"]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Approval Status</h3>
              {[
                { label: "Approved", value: detailExpenses.filter((e) => e.approvalStatus === "APPROVED").length, color: "#22c55e" },
                { label: "Pending",  value: detailExpenses.filter((e) => !e.approvalStatus || e.approvalStatus === "PENDING").length, color: "#f59e0b" },
                { label: "Rejected", value: detailExpenses.filter((e) => e.approvalStatus === "REJECTED").length, color: "#ef4444" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-slate-600">{item.label}</span>
                  </div>
                  <span className="font-semibold text-slate-800">{item.value}</span>
                </div>
              ))}
            </div>

            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Budget Utilization — FY {currentFY}</h3>
              {budgetUtilization.length === 0
                ? <p className="text-xs text-slate-400">No budgets set. Go to Budgets tab to configure.</p>
                : <div className="space-y-2">
                    {budgetUtilization.map((b) => (
                      <div key={b.id}>
                        <div className="flex justify-between text-xs text-slate-500 mb-0.5">
                          <span>{b.category}</span>
                          <span>{b.pct}% of {formatINR(Number(b.allocatedAmount))}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100">
                          <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, b.pct)}%`, backgroundColor: b.pct >= 90 ? "#ef4444" : b.pct >= 70 ? "#f59e0b" : "#22c55e" }} />
                        </div>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </div>

          {/* Upcoming recurring */}
          {(() => {
            const in30 = new Date(); in30.setDate(in30.getDate() + 30);
            const upcoming = recurring.filter((r) => r.isActive && new Date(r.nextDueDate) <= in30);
            if (upcoming.length === 0) return null;
            return (
              <div className="rounded-3xl bg-amber-50 p-5 ring-1 ring-amber-200">
                <h3 className="mb-2 text-sm font-semibold text-amber-800">Upcoming Recurring Payments (Next 30 Days)</h3>
                <div className="space-y-1">
                  {upcoming.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-amber-100">
                      <div>
                        <span className="font-medium text-slate-800">{r.title}</span>
                        <span className="ml-2 text-xs text-slate-500">{r.category} · {r.frequency}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-slate-900">{formatINR(Number(r.amount))}</div>
                        <div className="text-xs text-amber-600">Due {new Date(r.nextDueDate).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── ALL EXPENSES ── */}
      {activeTab === "all" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
              <option value="">All Categories</option>
              {Object.keys(EXPENSE_CATEGORY_MAP).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" onClick={() => void loadData()} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Refresh</button>
            <input value={expensePresetName} onChange={(event) => setExpensePresetName(event.target.value)} placeholder="Preset name" className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
            <button type="button" onClick={saveExpensePreset} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Save Preset</button>
            <select value={selectedExpensePresetId} onChange={(event) => applyExpensePresetById(event.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
              <option value="">Apply saved preset</option>
              {savedExpensePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </select>
            <button type="button" onClick={deleteExpensePreset} disabled={!selectedExpensePresetId} className="rounded-xl bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60">Delete</button>
            <button type="button" onClick={exportExpensesCsv} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Export CSV</button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Source Doc</th>
                  <th className="px-3 py-2">Status</th>
                  {canApprove && <th className="px-3 py-2">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detailExpenses.length === 0 && (
                  <tr><td colSpan={canApprove ? 8 : 7} className="px-3 py-6 text-center text-slate-400">{dataLoading ? "Loading..." : "No expenses found."}</td></tr>
                )}
                {detailExpenses.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">{new Date(e.spentOn).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{e.category}</span>
                      {e.subcategory && <span className="ml-1 text-xs text-slate-400">/ {e.subcategory}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{(e.vendor as { name: string } | null)?.name ?? e.vendorName ?? "—"}</td>
                    <td className="px-3 py-2 font-semibold">{formatINR(Number(e.amount))}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{e.paymentSource ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      <div>{e.sourceDocumentRef ?? "—"}</div>
                      {e.attachmentUrl && (
                        <a className="text-blue-600 underline" href={e.attachmentUrl} target="_blank" rel="noreferrer">Attachment</a>
                      )}
                    </td>
                    <td className="px-3 py-2"><ExpenseStatusBadge status={e.approvalStatus} /></td>
                    {canApprove && (
                      <td className="px-3 py-2">
                        {(!e.approvalStatus || e.approvalStatus === "PENDING") && (
                          <div className="flex gap-1">
                            <button type="button" onClick={() => void handleApprove(e.id)} className="rounded-lg bg-green-100 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-200">Approve</button>
                            <button type="button" onClick={() => setRejectingId(e.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200">Reject</button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rejectingId && (
            <RejectModal onConfirm={(note) => void handleReject(rejectingId, note)} onCancel={() => setRejectingId(null)} />
          )}
        </div>
      )}

      {/* ── ADD EXPENSE ── */}
      {activeTab === "add" && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">Record New Expense</h2>
            <form onSubmit={submitExpense} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Institution</label>
                  <select value={expCollegeId} onChange={(e) => setExpCollegeId(e.target.value)} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required>
                    {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Category</label>
                  <select value={expCategory} onChange={(e) => { setExpCategory(e.target.value); setExpSubcategory(""); }} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required>
                    {Object.keys(EXPENSE_CATEGORY_MAP).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Sub-Category</label>
                  <select value={expSubcategory} onChange={(e) => setExpSubcategory(e.target.value)} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                    <option value="">— Select sub-category —</option>
                    {EXPENSE_CATEGORY_MAP[expCategory]?.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Amount (₹)</label>
                  <input type="number" min="0.01" step="0.01" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder="0.00" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Date</label>
                  <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Payment Source</label>
                  <select value={expPaymentSource} onChange={(e) => setExpPaymentSource(e.target.value)} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                    <option value="">— Select source —</option>
                    {EXPENSE_PAYMENT_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Source Document Ref</label>
                  <input value={expSourceDocumentRef} onChange={(e) => setExpSourceDocumentRef(e.target.value)} placeholder="Invoice/PO unique reference" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Procurement Request Ref</label>
                  <input value={expProcurementRequestRef} onChange={(e) => setExpProcurementRequestRef(e.target.value)} placeholder="PR-..." className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Purchase Order Ref</label>
                  <input value={expProcurementOrderRef} onChange={(e) => setExpProcurementOrderRef(e.target.value)} placeholder="PO-..." className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Goods Receipt Ref</label>
                  <input value={expGoodsReceiptRef} onChange={(e) => setExpGoodsReceiptRef(e.target.value)} placeholder="GRN-..." className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Vendor</label>
                  <select value={expVendorId} onChange={(e) => { setExpVendorId(e.target.value); setExpVendorName(""); }} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                    <option value="">— Select registered vendor —</option>
                    {vendors.filter((v) => v.isActive && v.collegeId === expCollegeId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                {!expVendorId && (
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Vendor Name (if unregistered)</label>
                    <input value={expVendorName} onChange={(e) => setExpVendorName(e.target.value)} placeholder="e.g. KSEB, BSNL" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Attachment (Invoice/Receipt/PDF/Image)</label>
                  <input
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void uploadAttachment(file);
                      }
                    }}
                    className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm"
                  />
                  <div className="mt-1 text-xs text-slate-500">
                    {uploadingAttachment && "Uploading attachment..."}
                    {!uploadingAttachment && expAttachmentName && `Attached: ${expAttachmentName}`}
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Description / Notes</label>
                <textarea value={expDescription} onChange={(e) => setExpDescription(e.target.value)} rows={2} placeholder="Additional details..." className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
              </div>
              <button type="submit" disabled={expSubmitting || loading} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {expSubmitting ? "Recording..." : "Record Expense"}
              </button>
            </form>
          </section>
          <section className="rounded-3xl bg-slate-50 p-5 ring-1 ring-slate-200">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Category Guide</h3>
            <div className="space-y-3">
              {Object.entries(EXPENSE_CATEGORY_MAP).map(([cat, subs]) => (
                <div key={cat}>
                  <div className="text-xs font-semibold text-slate-600">{cat}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {subs.map((s) => <span key={s} className="rounded-lg bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">{s}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ── APPROVALS ── */}
      {activeTab === "approvals" && (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Approval Queue</h2>
            {pendingCount > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">{pendingCount} pending</span>}
          </div>
          {detailExpenses.filter((e) => !e.approvalStatus || e.approvalStatus === "PENDING").length === 0
            ? <p className="py-6 text-center text-sm text-slate-400">No expenses pending approval.</p>
            : <div className="space-y-3">
                {detailExpenses.filter((e) => !e.approvalStatus || e.approvalStatus === "PENDING").map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-800">{e.category}</span>
                        {e.subcategory && <span className="text-xs text-slate-500">/ {e.subcategory}</span>}
                        {e.paymentSource && <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs text-blue-600">{e.paymentSource}</span>}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {new Date(e.spentOn).toLocaleDateString()} · {(e.vendor as { name: string } | null)?.name ?? e.vendorName ?? "No vendor"}
                        {e.description && <span className="ml-2">· {e.description}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-base font-bold text-slate-900">{formatINR(Number(e.amount))}</span>
                      {canApprove && (
                        <>
                          <button type="button" onClick={() => void handleApprove(e.id)} className="rounded-xl bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-200">✓ Approve</button>
                          <button type="button" onClick={() => setRejectingId(e.id)} className="rounded-xl bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200">✕ Reject</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
          }
          {rejectingId && (
            <RejectModal onConfirm={(note) => void handleReject(rejectingId, note)} onCancel={() => setRejectingId(null)} />
          )}
        </section>
      )}

      {/* ── BUDGETS ── */}
      {activeTab === "budgets" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Budget Management — FY {currentFY}</h2>
            {canApprove && <button type="button" onClick={() => setBudgetFormOpen(true)} className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">+ Set Budget</button>}
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Allocated</th>
                  <th className="px-3 py-2">Spent</th>
                  <th className="px-3 py-2">Remaining</th>
                  <th className="px-3 py-2">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {budgetUtilization.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No budgets for FY {currentFY}. Click "Set Budget" to configure.</td></tr>
                )}
                {budgetUtilization.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{b.category}</td>
                    <td className="px-3 py-2">{formatINR(Number(b.allocatedAmount))}</td>
                    <td className="px-3 py-2">{formatINR(b.spent)}</td>
                    <td className="px-3 py-2 font-medium" style={{ color: Number(b.allocatedAmount) - b.spent < 0 ? "#ef4444" : "#16a34a" }}>
                      {formatINR(Math.max(0, Number(b.allocatedAmount) - b.spent))}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full" style={{ width: `${Math.min(100, b.pct)}%`, backgroundColor: b.pct >= 90 ? "#ef4444" : b.pct >= 70 ? "#f59e0b" : "#22c55e" }} />
                        </div>
                        <span className="text-xs text-slate-500">{b.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {budgetFormOpen && (
            <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/40 p-4">
              <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
                <h3 className="mb-4 text-base font-semibold">Set Budget Allocation</h3>
                <form onSubmit={submitBudget} className="space-y-3">
                  <select value={budgetCollegeId} onChange={(e) => setBudgetCollegeId(e.target.value)} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                    {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select value={budgetForm.category} onChange={(e) => setBudgetForm((f) => ({ ...f, category: e.target.value }))} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                    {Object.keys(EXPENSE_CATEGORY_MAP).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input value={budgetForm.financialYear} onChange={(e) => setBudgetForm((f) => ({ ...f, financialYear: e.target.value }))} placeholder="Financial Year (e.g. 2025-26)" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                  <input type="number" min="1" step="0.01" value={budgetForm.allocatedAmount} onChange={(e) => setBudgetForm((f) => ({ ...f, allocatedAmount: e.target.value }))} placeholder="Allocated Amount (₹)" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Save</button>
                    <button type="button" onClick={() => setBudgetFormOpen(false)} className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── VENDORS ── */}
      {activeTab === "vendors" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Vendor Directory</h2>
            {canWrite && <button type="button" onClick={() => setVendorFormOpen(true)} className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">+ Add Vendor</button>}
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">GST</th>
                  <th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2">Phone / Email</th>
                  <th className="px-3 py-2">Payment Terms</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vendors.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No vendors added yet.</td></tr>}
                {vendors.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800">{v.name}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{v.gstNumber ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{v.contactPerson ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {v.phone ?? "—"}
                      {v.email && <div>{v.email}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{v.paymentTerms ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${v.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                        {v.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {vendorFormOpen && (
            <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/40 p-4">
              <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
                <h3 className="mb-4 text-base font-semibold">Add Vendor</h3>
                <form onSubmit={submitVendor} className="space-y-3">
                  <select value={vendorCollegeId} onChange={(e) => setVendorCollegeId(e.target.value)} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                    {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input value={vendorForm.name} onChange={(e) => setVendorForm((f) => ({ ...f, name: e.target.value }))} placeholder="Vendor Name *" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                    <input value={vendorForm.gstNumber} onChange={(e) => setVendorForm((f) => ({ ...f, gstNumber: e.target.value }))} placeholder="GST Number" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                    <input value={vendorForm.contactPerson} onChange={(e) => setVendorForm((f) => ({ ...f, contactPerson: e.target.value }))} placeholder="Contact Person" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                    <input value={vendorForm.phone} onChange={(e) => setVendorForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                    <input type="email" value={vendorForm.email} onChange={(e) => setVendorForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                    <input value={vendorForm.paymentTerms} onChange={(e) => setVendorForm((f) => ({ ...f, paymentTerms: e.target.value }))} placeholder="Payment Terms (e.g. Net 30)" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                    <input value={vendorForm.address} onChange={(e) => setVendorForm((f) => ({ ...f, address: e.target.value }))} placeholder="Address" className="sm:col-span-2 w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={vendorSubmitting} className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Save Vendor</button>
                    <button type="button" onClick={() => setVendorFormOpen(false)} className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── RECURRING ── */}
      {activeTab === "recurring" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recurring Expenses</h2>
            {canWrite && <button type="button" onClick={() => setRecurringFormOpen(true)} className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">+ Add Recurring</button>}
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Frequency</th>
                  <th className="px-3 py-2">Next Due</th>
                  <th className="px-3 py-2">Status</th>
                  {canWrite && <th className="px-3 py-2">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recurring.length === 0 && <tr><td colSpan={canWrite ? 7 : 6} className="px-3 py-6 text-center text-slate-400">No recurring expenses. Click "+ Add Recurring" to set one up.</td></tr>}
                {recurring.map((r) => {
                  const isOverdue = new Date(r.nextDueDate) < new Date();
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium">{r.title}</td>
                      <td className="px-3 py-2 text-slate-500">{r.category}</td>
                      <td className="px-3 py-2 font-semibold">{formatINR(Number(r.amount))}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{r.frequency}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-medium ${isOverdue ? "text-red-600" : "text-slate-600"}`}>
                          {new Date(r.nextDueDate).toLocaleDateString()}{isOverdue && " ⚠"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${r.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
                          {r.isActive ? "Active" : "Paused"}
                        </span>
                      </td>
                      {canWrite && (
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => void toggleRecurring(r.id, r.isActive)} className="rounded-lg bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">
                            {r.isActive ? "Pause" : "Resume"}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {recurringFormOpen && (
            <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/40 p-4">
              <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
                <h3 className="mb-4 text-base font-semibold">Add Recurring Expense</h3>
                <form onSubmit={submitRecurring} className="space-y-3">
                  <select value={recurringCollegeId} onChange={(e) => setRecurringCollegeId(e.target.value)} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                    {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input value={recurringForm.title} onChange={(e) => setRecurringForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title (e.g. Monthly Electricity Bill)" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                  <select value={recurringForm.category} onChange={(e) => setRecurringForm((f) => ({ ...f, category: e.target.value }))} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                    {Object.keys(EXPENSE_CATEGORY_MAP).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input type="number" min="1" step="0.01" value={recurringForm.amount} onChange={(e) => setRecurringForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Amount (₹)" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
                    <select value={recurringForm.frequency} onChange={(e) => setRecurringForm((f) => ({ ...f, frequency: e.target.value }))} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                      {EXPENSE_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <input type="date" value={recurringForm.nextDueDate} onChange={(e) => setRecurringForm((f) => ({ ...f, nextDueDate: e.target.value }))} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm col-span-2" required />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Save</button>
                    <button type="button" onClick={() => setRecurringFormOpen(false)} className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PETTY CASH ── */}
      {activeTab === "petty-cash" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Petty Cash Entry</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{formatINR(pettyCashBalance)} balance</span>
            </div>
            <form onSubmit={submitPettyCash} className="space-y-3">
              <select value={pettyCollegeId} onChange={(e) => setPettyCollegeId(e.target.value)} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={pettyForm.entryType} onChange={(e) => setPettyForm((f) => ({ ...f, entryType: e.target.value }))} className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm">
                <option value="ALLOCATION">Allocation (top-up)</option>
                <option value="EXPENSE">Expense (debit)</option>
                <option value="REIMBURSEMENT">Reimbursement (credit)</option>
              </select>
              <input type="number" min="0.01" step="0.01" value={pettyForm.amount} onChange={(e) => setPettyForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Amount (₹)" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
              <input value={pettyForm.description} onChange={(e) => setPettyForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" required />
              <input value={pettyForm.reference} onChange={(e) => setPettyForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Voucher / Reference No" className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm" />
              <button type="submit" className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Record Entry</button>
            </form>
          </section>
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h2 className="mb-4 text-sm font-semibold">Cash Book</h2>
            <div className="max-h-80 overflow-y-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">Description</th>
                    <th className="px-2 py-2">Amount</th>
                    <th className="px-2 py-2">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pettyCash.length === 0 && <tr><td colSpan={5} className="px-2 py-6 text-center text-slate-400">No entries yet.</td></tr>}
                  {pettyCash.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-2 py-2 text-xs">{new Date(entry.createdAt).toLocaleDateString()}</td>
                      <td className="px-2 py-2">
                        <span className={`rounded-lg px-1.5 py-0.5 text-xs font-medium ${entry.entryType === "EXPENSE" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
                          {entry.entryType}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-500">{entry.description}</td>
                      <td className="px-2 py-2 text-xs font-medium">{entry.entryType === "EXPENSE" ? "−" : "+"}{formatINR(Number(entry.amount))}</td>
                      <td className="px-2 py-2 text-xs font-semibold">{formatINR(Number(entry.runningBalance))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {activeTab === "reports" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={reportDateFrom} onChange={(e) => setReportDateFrom(e.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
            <input type="date" value={reportDateTo} onChange={(e) => setReportDateTo(e.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
            <button type="button" onClick={() => void loadData()} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Apply</button>
            <button type="button" onClick={() => openExport("/finance/expenses/reports/export")} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Export CSV</button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Total Expenses" value={formatINR(Number(reportData?.totalExpenses ?? 0))} icon="₹" color="blue" />
            <KpiCard label="Pending Approvals" value={String(reportData?.pendingApprovals ?? 0)} icon="⏳" color="amber" />
            <KpiCard label="CapEx" value={formatINR(Number(reportData?.capex ?? 0))} icon="🏗" color="purple" />
            <KpiCard label="OpEx" value={formatINR(Number(reportData?.opex ?? 0))} icon="⚙" color="green" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h3 className="mb-3 text-sm font-semibold">Institution-wise Expenses</h3>
              <div className="space-y-2">
                {(reportData?.byInstitution ?? []).map((row) => (
                  <div key={row.name} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-600">{row.name}</span>
                    <span className="font-semibold text-slate-900">{formatINR(row.amount)}</span>
                  </div>
                ))}
                {(reportData?.byInstitution.length ?? 0) === 0 && <p className="text-sm text-slate-400">No data for selected filters.</p>}
              </div>
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h3 className="mb-3 text-sm font-semibold">Vendor-wise Expenses</h3>
              <div className="space-y-2">
                {(reportData?.byVendor ?? []).slice(0, 8).map((row) => (
                  <div key={row.name} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-600">{row.name}</span>
                    <span className="font-semibold text-slate-900">{formatINR(row.amount)}</span>
                  </div>
                ))}
                {(reportData?.byVendor.length ?? 0) === 0 && <p className="text-sm text-slate-400">No data for selected filters.</p>}
              </div>
            </section>
          </div>
        </div>
      )}

      {activeTab === "audit-logs" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={reportDateFrom} onChange={(e) => setReportDateFrom(e.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
            <input type="date" value={reportDateTo} onChange={(e) => setReportDateTo(e.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
            <input value={auditAction} onChange={(e) => setAuditAction(e.target.value)} placeholder="Action filter (e.g. EXPENSE_APPROVED)" className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
            <button type="button" onClick={() => void loadData()} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Apply</button>
            <button type="button" onClick={() => openExport("/finance/expenses/audit-logs/export", auditAction ? { action: auditAction } : {})} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Export CSV</button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No logs found for selected filters.</td></tr>
                )}
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs font-medium text-slate-800">{log.action}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{log.entityType}{log.entityId ? ` (${log.entityId.slice(0, 8)})` : ""}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{log.actor?.email ?? "System"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{JSON.stringify(log.metadata ?? {})}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

async function printReceipt(receiptNumber: string, trustName?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const response = await api.get<ReceiptSnapshotResponse>(`/finance/receipts/${receiptNumber}`);
  const receipt = response.data;
  const popup = window.open("", "_blank", "width=820,height=900");

  if (!popup) {
    return;
  }

  const studentLabel = `${receipt.snapshot.student.candidateName} (${receipt.snapshot.student.admissionCode ?? `#${receipt.snapshot.student.admissionNumber}`})`;
  const receiptTitle = `${trustName?.trim() || "CampusGrid"} Fee Receipt`;

  popup.document.write(`
    <html>
      <head>
        <title>${receipt.receiptNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
          .card { border: 1px solid #cbd5e1; border-radius: 16px; padding: 24px; }
          .row { display: flex; justify-content: space-between; gap: 16px; margin: 10px 0; }
          .label { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
          .value { font-weight: 600; }
          .total { margin-top: 24px; background: #0f172a; color: white; border-radius: 16px; padding: 16px 20px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 style="margin:0 0 4px;">${receiptTitle}</h2>
          <p style="margin:0 0 20px;color:#64748b;">Receipt ${receipt.receiptNumber}</p>
          <div class="row"><span class="label">Student</span><span class="value">${studentLabel}</span></div>
          <div class="row"><span class="label">College</span><span class="value">${receipt.snapshot.academicContext?.college ?? "Not mapped"}</span></div>
          <div class="row"><span class="label">Course</span><span class="value">${receipt.snapshot.academicContext?.course ?? "Not mapped"}</span></div>
          <div class="row"><span class="label">Session</span><span class="value">${receipt.snapshot.academicContext?.session ?? "Not mapped"}</span></div>
          <div class="row"><span class="label">Demand cycle</span><span class="value">${receipt.snapshot.payment.cycleLabel ?? receipt.cycleLabel ?? "Fee collection"}</span></div>
          <div class="row"><span class="label">Collected on</span><span class="value">${new Date(receipt.collectedAt).toLocaleString()}</span></div>
          <div class="row"><span class="label">Payment mode</span><span class="value">${receipt.paymentMode ?? "--"}</span></div>
          <div class="row"><span class="label">Reference</span><span class="value">${receipt.referenceNumber ?? "--"}</span></div>
          <div class="row"><span class="label">Collected by</span><span class="value">${receipt.collectedBy ?? "--"}</span></div>
          <div class="total">
            <div class="row"><span>Collection amount</span><span>${formatCurrency(receipt.amount)}</span></div>
            <div class="row"><span>Late fine</span><span>${formatCurrency(receipt.lateFine)}</span></div>
            <div class="row"><span>Total received</span><span>${formatCurrency(receipt.totalReceived)}</span></div>
          </div>
        </div>
      </body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
}
