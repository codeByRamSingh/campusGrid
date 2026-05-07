import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, Printer, Search, X } from "lucide-react";
import { useStudents } from "../../hooks/useStudents";
import { useAcademicStructure } from "../../hooks/useAcademicStructure";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../services/api";
import { financeApi } from "../../services/financeApi";
import type { StudentDuesData, CollectResult, PayAllocation, PaymentMode } from "./types";

// ─── Local types ──────────────────────────────────────────────────────────────

type StudentRow = {
  id: string;
  candidateName: string;
  admissionNumber: number;
  admissionCode?: string;
  collegeId: string;
  totalPayable: number;
  status?: string;
  admissions?: Array<{ courseId: string; sessionId: string; createdAt?: string }>;
};

type Props = {
  trustName?: string;
  canCollect: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number) {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(2)}K`;
  return `₹${n.toFixed(2)}`;
}

function fmtFull(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function dueStatusClass(status: string) {
  switch (status) {
    case "Paid":    return "bg-emerald-100 text-emerald-700";
    case "Partial": return "bg-amber-100 text-amber-700";
    case "Overdue": return "bg-rose-100 text-rose-700";
    default:        return "bg-slate-100 text-slate-600";
  }
}

async function openPrint(receiptNumber: string, trustName?: string) {
  if (typeof window === "undefined") return;
  try {
    const r = await api.get<{
      receiptNumber: string;
      amount: number;
      lateFine: number;
      totalReceived: number;
      paymentMode?: string | null;
      referenceNumber?: string | null;
      collectedAt: string;
      snapshot: {
        student: { candidateName: string; admissionNumber: number; admissionCode?: string | null };
        academicContext?: { college?: string | null; course?: string | null; session?: string | null };
        payment: { allocations?: Array<{ label: string; amount: number }> };
      };
    }>(`/finance/receipts/${receiptNumber}`);
    const rec = r.data;
    const popup = window.open("", "_blank", "width=840,height=960");
    if (!popup) return;
    const name = `${rec.snapshot.student.candidateName} (${rec.snapshot.student.admissionCode ?? `#${rec.snapshot.student.admissionNumber}`})`;
    const allocs = (rec.snapshot.payment.allocations ?? [])
      .map((a) => `<div class="row"><span>${a.label}</span><span>${fmtFull(a.amount)}</span></div>`)
      .join("");
    popup.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${rec.receiptNumber}</title>
<style>
body{font-family:Arial,sans-serif;padding:40px;color:#0f172a;max-width:560px;margin:auto}
h1{margin:0 0 2px;font-size:20px}.sub{margin:0 0 24px;color:#64748b;font-size:13px}
.card{border:1px solid #e2e8f0;border-radius:16px;padding:24px}
.row{display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
.lbl{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.total{margin-top:20px;background:#0f172a;color:#fff;border-radius:14px;padding:16px 20px}
.total .row{border-color:#1e293b;color:#e2e8f0}.big{font-size:18px;font-weight:700;color:#fff}
</style></head><body><div class="card">
<h1>${(trustName?.trim() || "CampusGrid")} — Fee Receipt</h1>
<p class="sub">Receipt No: <b>${rec.receiptNumber}</b></p>
<div class="row"><span class="lbl">Student</span><span><b>${name}</b></span></div>
<div class="row"><span class="lbl">College</span><span>${rec.snapshot.academicContext?.college ?? "—"}</span></div>
<div class="row"><span class="lbl">Course</span><span>${rec.snapshot.academicContext?.course ?? "—"}</span></div>
<div class="row"><span class="lbl">Session</span><span>${rec.snapshot.academicContext?.session ?? "—"}</span></div>
<div class="row"><span class="lbl">Collected On</span><span>${new Date(rec.collectedAt).toLocaleString("en-IN")}</span></div>
<div class="row"><span class="lbl">Mode</span><span>${rec.paymentMode ?? "—"}</span></div>
<div class="total">${allocs}
  <div class="row" style="border:none;padding-top:10px"><span>Total Received</span><span class="big">${fmtFull(rec.totalReceived)}</span></div>
</div></div></body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  } catch { /* best-effort */ }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-3 rounded-2xl px-4 py-3 shadow-lg ring-1 ${
      type === "success" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-800 ring-rose-200"
    }`}>
      {type === "success" ? <CheckCircle className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
      <span className="text-sm font-medium">{message}</span>
      <button type="button" onClick={onClose} className="ml-2 shrink-0 opacity-60 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

// ─── Receipt success ──────────────────────────────────────────────────────────

function ReceiptSuccess({ receipt, trustName, onNew }: { receipt: CollectResult; trustName?: string; onNew: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-5 py-8 text-center">
      <CheckCircle className="mx-auto h-14 w-14 text-emerald-500" />
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Payment Collected</h2>
        <p className="mt-1 text-sm text-slate-500">Receipt {receipt.receiptNumber} generated.</p>
      </div>
      <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100 text-left space-y-1.5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Summary</p>
        <SR label="Student"    value={`${receipt.student.name} (${receipt.student.admissionNo})`} />
        <SR label="Receipt No" value={receipt.receiptNumber} />
        <SR label="Mode"       value={receipt.paymentMode} />
        <SR label="Date"       value={new Date(receipt.paidAt).toLocaleDateString("en-IN")} />
        {receipt.allocations.length > 0 && <div className="my-1 border-t border-slate-100" />}
        {receipt.allocations.map((a) => <SR key={a.cycleKey} label={a.label} value={fmtFull(a.amount)} />)}
        <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2.5 text-white">
          <span className="text-xs font-medium">Total Collected</span>
          <span className="font-bold">{fmtFull(receipt.totalAmount)}</span>
        </div>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={() => void openPrint(receipt.receiptNumber, trustName)}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-300 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <Printer className="h-4 w-4" /> Print Receipt
        </button>
        <button type="button" onClick={onNew}
          className="flex-1 rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800">
          New Transaction
        </button>
      </div>
    </div>
  );
}

function SR({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-1 py-0.5">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="text-right text-xs font-medium text-slate-800">{value}</span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function FeeCollectionWorkflow({ trustName, canCollect }: Props) {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Academic structure (colleges / courses / sessions) ────────────────────
  const { data: academicStructure = [] } = useAcademicStructure();
  const colleges = useMemo(
    () =>
      academicStructure.map((c) => ({
        id: c.id,
        name: c.name,
        courses: c.courses.map((course) => ({
          id: course.id,
          name: course.name,
          sessions: course.sessions.map((s) => ({ id: s.id, label: s.label })),
        })),
      })),
    [academicStructure],
  );

  const courseCollegeById = useMemo(
    () => Object.fromEntries(colleges.flatMap((col) => col.courses.map((c) => [c.id, col.id]))),
    [colleges],
  );

  // ── Students ──────────────────────────────────────────────────────────────
  const { data: studentsPayload, isFetching: studentsLoading } = useStudents();
  const allStudents: StudentRow[] = useMemo(
    () => (Array.isArray(studentsPayload) ? studentsPayload : (studentsPayload?.data ?? [])),
    [studentsPayload],
  );

  const latestAdmissionByStudentId = useMemo(() => {
    const map = new Map<string, { courseId: string; sessionId: string; createdAt?: string }>();
    for (const s of allStudents) {
      const admissions = s.admissions ?? [];
      if (!admissions.length) continue;
      const latest = admissions.reduce((best, cur) =>
        new Date(cur.createdAt ?? 0).getTime() > new Date(best.createdAt ?? 0).getTime() ? cur : best,
      );
      map.set(s.id, latest);
    }
    return map;
  }, [allStudents]);

  // ── Filter state (mirrors StudentsPage exactly) ───────────────────────────
  const [query, setQuery]                         = useState("");
  const [collegeFilter, setCollegeFilter]         = useState("ALL");
  const [courseFilter, setCourseFilter]           = useState("ALL");
  const [sessionFilter, setSessionFilter]         = useState("ALL");
  const [statusFilter, setStatusFilter]           = useState("ALL");

  // Derived dropdown options
  const courseOptions = useMemo(() => {
    if (collegeFilter === "ALL") {
      return colleges.flatMap((col) => col.courses.map((c) => ({ id: c.id, name: c.name })));
    }
    return (colleges.find((col) => col.id === collegeFilter)?.courses ?? []).map((c) => ({ id: c.id, name: c.name }));
  }, [colleges, collegeFilter]);

  const sessionOptions = useMemo(() => {
    if (courseFilter !== "ALL") {
      for (const col of colleges) {
        const course = col.courses.find((c) => c.id === courseFilter);
        if (course) return course.sessions;
      }
      return [];
    }
    if (collegeFilter !== "ALL") {
      return (colleges.find((col) => col.id === collegeFilter)?.courses ?? []).flatMap((c) => c.sessions);
    }
    return colleges.flatMap((col) => col.courses.flatMap((c) => c.sessions));
  }, [colleges, collegeFilter, courseFilter]);

  // Reset dependent filters when parent changes
  useEffect(() => {
    if (courseFilter !== "ALL" && !courseOptions.some((c) => c.id === courseFilter)) setCourseFilter("ALL");
  }, [courseOptions, courseFilter]);

  useEffect(() => {
    if (sessionFilter !== "ALL" && !sessionOptions.some((s) => s.id === sessionFilter)) setSessionFilter("ALL");
  }, [sessionOptions, sessionFilter]);

  // Filtered student list (same logic as StudentsPage)
  const filteredStudents = useMemo(() => {
    return allStudents
      .filter((s) => statusFilter === "ALL" || s.status === statusFilter)
      .filter((s) => {
        const admission = latestAdmissionByStudentId.get(s.id);
        const mappedCollegeId = admission?.courseId ? courseCollegeById[admission.courseId] : s.collegeId;
        if (collegeFilter !== "ALL" && mappedCollegeId !== collegeFilter) return false;
        if (courseFilter  !== "ALL" && admission?.courseId  !== courseFilter)  return false;
        if (sessionFilter !== "ALL" && admission?.sessionId !== sessionFilter) return false;
        return true;
      })
      .filter((s) =>
        s.candidateName.toLowerCase().includes(query.toLowerCase()) ||
        String(s.admissionNumber).includes(query) ||
        (s.admissionCode ?? "").toLowerCase().includes(query.toLowerCase()),
      );
  }, [allStudents, query, statusFilter, collegeFilter, courseFilter, sessionFilter, latestAdmissionByStudentId, courseCollegeById]);

  // ── Student selection ─────────────────────────────────────────────────────
  const [selectedStudentId, setSelectedStudentId] = useState("");

  const selectedStudent = useMemo(
    () => allStudents.find((s) => s.id === selectedStudentId) ?? null,
    [allStudents, selectedStudentId],
  );

  // Auto-select first match when list changes
  useEffect(() => {
    if (filteredStudents.length === 0) { setSelectedStudentId(""); return; }
    if (!selectedStudentId || !filteredStudents.some((s) => s.id === selectedStudentId)) {
      setSelectedStudentId(filteredStudents[0].id);
    }
  }, [filteredStudents, selectedStudentId]);

  // ── Dues ──────────────────────────────────────────────────────────────────
  const [duesData, setDuesData]     = useState<StudentDuesData | null>(null);
  const [duesLoading, setDuesLoading] = useState(false);
  const [duesError, setDuesError]   = useState("");

  useEffect(() => {
    if (!selectedStudentId) { setDuesData(null); return; }
    let cancelled = false;
    setDuesLoading(true);
    setDuesError("");
    api
      .get<StudentDuesData>(`/finance/students/${selectedStudentId}/dues`)
      .then((r) => {
        if (cancelled) return;
        setDuesData(r.data);
        const first = r.data.dues.find((d) => d.balance > 0);
        setPayNow(first ? { [first.cycleKey]: first.balance.toFixed(2) } : {});
        setPayAll(false);
      })
      .catch(() => { if (!cancelled) setDuesError("Could not load fee dues. Please try again."); })
      .finally(() => { if (!cancelled) setDuesLoading(false); });
    return () => { cancelled = true; };
  }, [selectedStudentId]);

  // ── Pay-now ───────────────────────────────────────────────────────────────
  const [payNow, setPayNow] = useState<Record<string, string>>({});
  const [payAll, setPayAll] = useState(false);

  function setKey(key: string, val: string) { setPayNow((p) => ({ ...p, [key]: val })); }
  function fillFull(key: string, bal: number) { setPayNow((p) => ({ ...p, [key]: bal.toFixed(2) })); }
  function clearKey(key: string) { setPayNow((p) => ({ ...p, [key]: "" })); }

  function togglePayAll() {
    const next = !payAll;
    setPayAll(next);
    if (next && duesData) {
      const filled: Record<string, string> = {};
      duesData.dues.forEach((d) => { if (d.balance > 0) filled[d.cycleKey] = d.balance.toFixed(2); });
      setPayNow(filled);
    }
  }

  // ── Payment mode / date ───────────────────────────────────────────────────
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("CASH");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes]             = useState("");
  const [reference, setReference]     = useState("");

  // ── Derived ───────────────────────────────────────────────────────────────
  const allocations = useMemo((): PayAllocation[] => {
    if (!duesData) return [];
    return duesData.dues
      .map((d) => ({ cycleKey: d.cycleKey, label: d.label, amount: parseFloat(payNow[d.cycleKey] ?? "") || 0 }))
      .filter((a) => a.amount > 0);
  }, [payNow, duesData]);

  const totalPayNow = allocations.reduce((s, a) => s + a.amount, 0);

  const hasOverEntry = useMemo(
    () => duesData?.dues.some((d) => (parseFloat(payNow[d.cycleKey] ?? "") || 0) > d.balance + 0.001) ?? false,
    [duesData, payNow],
  );

  const canSubmit = canCollect && duesData?.student.status === "ACTIVE" && totalPayNow > 0 && !hasOverEntry;

  // ── Submit ────────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt]       = useState<CollectResult | null>(null);
  const [toast, setToast]           = useState<{ message: string; type: "success" | "error" } | null>(null);

  async function handleSubmit() {
    if (!selectedStudentId || allocations.length === 0 || !canSubmit) return;
    setSubmitting(true);
    try {
      const result = await financeApi.collectFeeAllocated({
        studentId: selectedStudentId,
        paymentMode,
        paymentDate,
        notes: notes.trim() || undefined,
        reference: reference.trim() || undefined,
        allocations: allocations.map((a) => ({ cycleKey: a.cycleKey, amount: a.amount })),
      });
      void qc.invalidateQueries({ queryKey: ["students"] });
      setReceipt(result as CollectResult);
      setToast({ message: `Receipt ${result.receiptNumber} generated`, type: "success" });
      void openPrint(result.receiptNumber, trustName);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Payment failed. Please try again.";
      setToast({ message: msg, type: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  function handleNewTransaction() {
    setReceipt(null);
    setPayNow({});
    setPayAll(false);
    setNotes("");
    setReference("");
    if (selectedStudentId) {
      setDuesData(null);
      setDuesLoading(true);
      api
        .get<StudentDuesData>(`/finance/students/${selectedStudentId}/dues`)
        .then((r) => {
          setDuesData(r.data);
          const first = r.data.dues.find((d) => d.balance > 0);
          setPayNow(first ? { [first.cycleKey]: first.balance.toFixed(2) } : {});
        })
        .catch(() => setDuesError("Unable to reload dues."))
        .finally(() => setDuesLoading(false));
    }
    setTimeout(() => searchRef.current?.focus(), 100);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (receipt) {
    return (
      <>
        <ReceiptSuccess receipt={receipt} trustName={trustName} onNew={handleNewTransaction} />
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </>
    );
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        {/* ── LEFT ── */}
        <div className="space-y-3">

          {/* 1. Filter bar — matches StudentsPage exactly */}
          <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <div className="grid gap-3 lg:grid-cols-6">
              {/* Search — spans 2 cols like Students */}
              <div className="relative lg:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  ref={searchRef}
                  autoFocus
                  className="w-full rounded-2xl bg-slate-100 py-2.5 pl-10 pr-4 text-sm outline-none"
                  placeholder="Search student name or admission number"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <select
                value={collegeFilter}
                onChange={(e) => setCollegeFilter(e.target.value)}
                className="rounded-2xl bg-slate-100 px-3 py-2.5 text-sm outline-none"
              >
                <option value="ALL">All colleges</option>
                {colleges.map((col) => (
                  <option key={col.id} value={col.id}>{col.name}</option>
                ))}
              </select>

              <select
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                className="rounded-2xl bg-slate-100 px-3 py-2.5 text-sm outline-none"
              >
                <option value="ALL">All courses</option>
                {courseOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <select
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value)}
                className="rounded-2xl bg-slate-100 px-3 py-2.5 text-sm outline-none"
              >
                <option value="ALL">All sessions</option>
                {sessionOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-2xl bg-slate-100 px-3 py-2.5 text-sm outline-none"
              >
                <option value="ALL">All status</option>
                <option value="ACTIVE">Active</option>
                <option value="PASSED_OUT">Passed out</option>
                <option value="DROP_OUT">Drop out</option>
              </select>
            </div>

            {/* Student picker — narrows after filters applied */}
            <div className="mt-3 flex items-center gap-3">
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="flex-1 rounded-2xl bg-slate-100 px-3 py-2.5 text-sm outline-none"
                disabled={studentsLoading || filteredStudents.length === 0}
              >
                {studentsLoading && <option value="">Loading students…</option>}
                {!studentsLoading && filteredStudents.length === 0 && <option value="">No students match filters</option>}
                {filteredStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.candidateName} ({s.admissionCode ?? `#${s.admissionNumber}`})
                  </option>
                ))}
              </select>

              {(query || collegeFilter !== "ALL" || courseFilter !== "ALL" || sessionFilter !== "ALL" || statusFilter !== "ALL") && (
                <button
                  type="button"
                  onClick={() => { setQuery(""); setCollegeFilter("ALL"); setCourseFilter("ALL"); setSessionFilter("ALL"); setStatusFilter("ALL"); }}
                  className="flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
                >
                  <X className="h-3.5 w-3.5" /> Clear filters
                </button>
              )}
            </div>

            {/* Compact student strip — shown after student is resolved */}
            {selectedStudent && duesData && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-slate-50 px-4 py-2.5 text-sm">
                <span className="font-semibold text-slate-800">{duesData.student.name}</span>
                <span className="text-slate-400">{duesData.student.admissionNo}</span>
                <span className="text-slate-500">{duesData.student.course}</span>
                <span className="text-slate-400">{duesData.student.session}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  duesData.student.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                }`}>
                  {duesData.student.status === "ACTIVE" ? "Active" : duesData.student.status}
                </span>
                <span className="ml-auto shrink-0">
                  <span className="text-xs text-slate-500">Total Due </span>
                  <span className={`text-sm font-semibold ${duesData.student.totalDue > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {fmtINR(duesData.student.totalDue)}
                  </span>
                </span>
              </div>
            )}
          </section>

          {/* 2. Fee dues table */}
          {selectedStudentId && (
            <section className="rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
              <div className="flex items-center justify-between px-5 pt-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Fee Dues</h2>
                  {duesData && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {duesData.dues.filter((d) => d.balance > 0).length} unpaid instalment
                      {duesData.dues.filter((d) => d.balance > 0).length !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
                {duesData?.dues.some((d) => d.balance > 0) && (
                  <button type="button" onClick={togglePayAll}
                    className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                      payAll ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}>
                    {payAll ? "Pay All ✓" : "Pay All"}
                  </button>
                )}
              </div>

              {duesLoading && (
                <div className="flex items-center justify-center py-12 text-sm text-slate-400">Loading fee dues…</div>
              )}
              {!duesLoading && duesError && (
                <div className="mx-5 mb-4 mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{duesError}</div>
              )}
              {!duesLoading && !duesError && duesData?.dues.length === 0 && (
                <div className="flex items-center justify-center py-12 text-sm text-slate-400">No fee records found.</div>
              )}

              {!duesLoading && !duesError && duesData && duesData.dues.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-2.5">Fee Head</th>
                        <th className="px-4 py-2.5">Due Date</th>
                        <th className="px-4 py-2.5 text-right">Amount</th>
                        <th className="px-4 py-2.5 text-right">Paid</th>
                        <th className="px-4 py-2.5 text-right">Balance</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-right">Pay Now</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {duesData.dues.map((row) => {
                        const val = payNow[row.cycleKey] ?? "";
                        const num = parseFloat(val) || 0;
                        const over = num > row.balance + 0.001;
                        return (
                          <tr key={row.cycleKey} className={num > 0 ? "bg-slate-50/70" : "hover:bg-slate-50/40"}>
                            <td className="px-4 py-2.5 font-medium text-slate-800">{row.label}</td>
                            <td className="px-4 py-2.5 text-slate-500">
                              {new Date(row.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                            </td>
                            <td className="px-4 py-2.5 text-right text-slate-700">{fmtINR(row.amount)}</td>
                            <td className="px-4 py-2.5 text-right text-slate-500">{fmtINR(row.paid)}</td>
                            <td className="px-4 py-2.5 text-right font-medium text-slate-800">{fmtINR(row.balance)}</td>
                            <td className="px-4 py-2.5">
                              <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${dueStatusClass(row.status)}`}>
                                {row.status}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              {row.balance > 0 ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <input
                                    type="number" min="0" max={row.balance} step="0.01"
                                    value={val}
                                    onChange={(e) => setKey(row.cycleKey, e.target.value)}
                                    onFocus={(e) => e.target.select()}
                                    placeholder={fmtINR(row.balance)}
                                    className={`w-28 rounded-xl px-2.5 py-1.5 text-right text-sm outline-none ring-1 focus:ring-2 ${
                                      over ? "bg-rose-50 ring-rose-300 focus:ring-rose-400" : "bg-white ring-slate-200 focus:ring-slate-400"
                                    }`}
                                  />
                                  {val ? (
                                    <button type="button" onClick={() => clearKey(row.cycleKey)}
                                      className="rounded-lg p-1 text-slate-400 hover:text-slate-600">
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  ) : (
                                    <button type="button" onClick={() => fillFull(row.cycleKey, row.balance)}
                                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
                                      Full
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="block text-right text-xs text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Payment summary strip */}
              {!duesLoading && duesData && duesData.dues.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <p className="text-xs font-medium text-slate-500">Total Collecting</p>
                      <p className={`mt-1 text-2xl font-bold ${totalPayNow > 0 ? "text-slate-900" : "text-slate-300"}`}>
                        {totalPayNow > 0 ? fmtFull(totalPayNow) : "₹0"}
                      </p>
                      {hasOverEntry && <p className="mt-1 text-xs text-rose-600">One or more entries exceed the balance.</p>}
                    </div>

                    <div className="flex gap-1.5">
                      {(["CASH", "UPI", "BANK"] as PaymentMode[]).map((m) => (
                        <button key={m} type="button" onClick={() => setPaymentMode(m)}
                          className={`rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                            paymentMode === m ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}>
                          {m === "BANK" ? "Bank" : m}
                        </button>
                      ))}
                    </div>

                    <div>
                      <p className="mb-1 text-xs font-medium text-slate-500">Date</p>
                      <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}
                        className="rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>

                    {(paymentMode === "UPI" || paymentMode === "BANK") && (
                      <div className="flex-1">
                        <p className="mb-1 text-xs font-medium text-slate-500">
                          {paymentMode === "UPI" ? "UTR Number" : "Reference"}
                        </p>
                        <input value={reference} onChange={(e) => setReference(e.target.value)}
                          placeholder={paymentMode === "UPI" ? "12-digit UTR" : "Transaction ID"}
                          className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                      </div>
                    )}

                    <div className="flex-1">
                      <p className="mb-1 text-xs font-medium text-slate-500">Notes (optional)</p>
                      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any remarks…"
                        className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {/* ── RIGHT: preview + CTA ── */}
        <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Receipt Preview</h2>
              {totalPayNow > 0 && (
                <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Draft</span>
              )}
            </div>

            {!selectedStudentId || !duesData ? (
              <div className="mt-6 flex flex-col items-center gap-2 py-8 text-center">
                <span className="text-3xl">🧾</span>
                <p className="text-xs text-slate-400">Select a student to preview receipt.</p>
              </div>
            ) : totalPayNow === 0 ? (
              <div className="mt-4 py-6 text-center">
                <p className="text-xs text-slate-400">Enter payment amounts to continue.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-1">
                <PR label="Student"  value={duesData.student.name} />
                <PR label="Adm No"   value={duesData.student.admissionNo} />
                <PR label="Course"   value={duesData.student.course} />
                <PR label="Mode"     value={paymentMode} />
                <PR label="Date"     value={new Date(paymentDate).toLocaleDateString("en-IN")} />
                {allocations.length > 0 && <div className="my-2 border-t border-slate-100" />}
                {allocations.map((a) => <PR key={a.cycleKey} label={a.label} value={fmtFull(a.amount)} />)}
                <div className="mt-3 flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-3 text-white">
                  <span className="text-xs font-medium">Total</span>
                  <span className="text-lg font-bold">{fmtFull(totalPayNow)}</span>
                </div>
              </div>
            )}
          </section>

          <button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit || submitting}
            className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40 hover:enabled:bg-slate-800">
            {submitting ? "Processing…" : "Collect Fee & Generate Receipt"}
          </button>

          {!canCollect && (
            <p className="text-center text-xs text-slate-400">No permission to collect fees.</p>
          )}
          {selectedStudentId && duesData?.student.status !== "ACTIVE" && (
            <p className="text-center text-xs text-rose-500">Student inactive — collection blocked.</p>
          )}
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

function PR({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-1 py-0.5">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="text-right text-xs font-medium text-slate-800">{value}</span>
    </div>
  );
}
