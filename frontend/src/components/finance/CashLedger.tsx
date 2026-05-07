import { useMemo, useState } from "react";
import { Download, Printer, RefreshCcw, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useCashLedger } from "../../hooks/useFinanceLedger";
import type { CashLedgerTransaction } from "../../services/financeApi";
import { exportRowsToCsv } from "../../lib/viewPresets";

// ─── Types ────────────────────────────────────────────────────────────────────

type College = { id: string; name: string };

type Props = {
  colleges: College[];
  defaultCollegeId?: string;
  trustName?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Canonical Particulars labels keyed by source_module */
const PARTICULARS_LABEL: Record<string, string> = {
  FEES: "Fee Collection",
  ADJUSTMENT: "Misc Credit / Adjustment",
  EXPENSE: "Expense",
  REVERSAL: "Reversal",
};

/** Normalize the free-text particulars from the backend into an enum value */
function canonicalParticulars(t: CashLedgerTransaction): string {
  // If backend already has a meaningful label that maps, use our canonical one
  const base = PARTICULARS_LABEL[t.source_module] ?? t.particulars;
  // Narrow further for FEES module
  if (t.source_module === "FEES") {
    if (t.particulars.toLowerCase().includes("misc")) return "Misc Income";
    if (t.particulars.toLowerCase().includes("fine")) return "Fine Collection";
    return "Fee Collection";
  }
  return base;
}

/** Module tag: label + color classes */
const MODULE_TAG: Record<string, { label: string; cls: string }> = {
  FEES:       { label: "FEE",  cls: "bg-sky-100 text-sky-700 ring-sky-200" },
  ADJUSTMENT: { label: "ADJ",  cls: "bg-violet-100 text-violet-700 ring-violet-200" },
  EXPENSE:    { label: "EXP",  cls: "bg-orange-100 text-orange-700 ring-orange-200" },
  REVERSAL:   { label: "REV",  cls: "bg-rose-100 text-rose-700 ring-rose-200" },
  MISC:       { label: "MISC", cls: "bg-violet-100 text-violet-700 ring-violet-200" },
  PETTY_CASH: { label: "PC",   cls: "bg-teal-100 text-teal-700 ring-teal-200" },
};

/** Voucher prefix → badge style */
function voucherBadge(voucher_no: string, source_module: string): { label: string; cls: string } {
  return MODULE_TAG[source_module] ?? { label: "TXN", cls: "bg-slate-100 text-slate-600 ring-slate-200" };
}

/** Payment mode → badge colors */
const MODE_BADGE: Record<string, string> = {
  CASH:          "bg-slate-100 text-slate-700 ring-slate-200",
  BANK:          "bg-blue-100  text-blue-700  ring-blue-200",
  BANK_TRANSFER: "bg-blue-100  text-blue-700  ring-blue-200",
  UPI:           "bg-purple-100 text-purple-700 ring-purple-200",
  CHEQUE:        "bg-amber-100 text-amber-700 ring-amber-200",
  DD:            "bg-amber-100 text-amber-700 ring-amber-200",
  NEFT:          "bg-blue-100  text-blue-700  ring-blue-200",
  RTGS:          "bg-blue-100  text-blue-700  ring-blue-200",
};

function modeBadgeCls(mode: string): string {
  return MODE_BADGE[mode.toUpperCase()] ?? "bg-slate-100 text-slate-600 ring-slate-200";
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function fmt(value: number): string {
  if (value === 0) return "—";
  return INR.format(value);
}

function fmtBalance(value: number): string {
  return INR.format(value);
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function fyStartISO(): string {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-04-01`;
}

function fmtDateHeading(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon: Icon,
  iconCls,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  iconCls: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-100">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconCls}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{fmtBalance(value)}</p>
      </div>
    </div>
  );
}

// ─── Summary Strip ────────────────────────────────────────────────────────────

function SummaryStrip({
  opening, credit, debit, closing,
}: {
  opening: number; credit: number; debit: number; closing: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-slate-50 px-4 py-2.5 text-xs">
      <span className="text-slate-500">
        Opening: <strong className="tabular-nums text-slate-900">{fmtBalance(opening)}</strong>
      </span>
      <span className="text-slate-300">|</span>
      <span className="text-slate-500">
        Credit: <strong className="tabular-nums text-emerald-700">{fmtBalance(credit)}</strong>
      </span>
      <span className="text-slate-300">|</span>
      <span className="text-slate-500">
        Debit: <strong className="tabular-nums text-rose-700">{fmtBalance(debit)}</strong>
      </span>
      <span className="text-slate-300">|</span>
      <span className="text-slate-500">
        Closing: <strong className="tabular-nums text-slate-900">{fmtBalance(closing)}</strong>
      </span>
    </div>
  );
}

// ─── Print View ───────────────────────────────────────────────────────────────

function PrintView({
  collegeName,
  trustName,
  startDate,
  endDate,
  openingBalance,
  closingBalance,
  totalCredit,
  totalDebit,
  transactions,
}: {
  collegeName: string;
  trustName?: string;
  startDate: string;
  endDate: string;
  openingBalance: number;
  closingBalance: number;
  totalCredit: number;
  totalDebit: number;
  transactions: CashLedgerTransaction[];
}) {
  return (
    <div className="hidden print:block p-8 font-sans text-sm text-slate-900">
      {/* Header */}
      <div className="border-b-2 border-slate-800 pb-4 text-center">
        {trustName && <p className="text-xs text-slate-500">{trustName}</p>}
        <h1 className="text-xl font-bold tracking-tight">{collegeName}</h1>
        <h2 className="mt-1 text-base font-semibold">Cash Ledger Report</h2>
        <p className="mt-1 text-xs text-slate-500">
          Period: {startDate} to {endDate}
        </p>
      </div>

      {/* Summary */}
      <div className="mt-4 grid grid-cols-4 gap-4 rounded border border-slate-200 p-3 text-xs">
        <div>Opening Balance<br /><strong>{fmtBalance(openingBalance)}</strong></div>
        <div>Total Credit<br /><strong className="text-emerald-700">{fmtBalance(totalCredit)}</strong></div>
        <div>Total Debit<br /><strong className="text-rose-700">{fmtBalance(totalDebit)}</strong></div>
        <div>Closing Balance<br /><strong>{fmtBalance(closingBalance)}</strong></div>
      </div>

      {/* Table */}
      <table className="mt-4 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left text-[10px] uppercase tracking-wide">
            <th className="py-1 pr-2 w-16">Date</th>
            <th className="py-1 pr-2">Voucher</th>
            <th className="py-1 pr-2">Particulars</th>
            <th className="py-1 pr-2">Party</th>
            <th className="py-1 pr-2">Receipt No.</th>
            <th className="py-1 pr-2 text-right">Debit (₹)</th>
            <th className="py-1 pr-2 text-right">Credit (₹)</th>
            <th className="py-1 pr-2">Mode</th>
            <th className="py-1 text-right">Balance (₹)</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-300 bg-slate-100">
            <td className="py-1 pr-2 font-semibold">{startDate}</td>
            <td colSpan={7} className="py-1 pr-2 font-semibold">Opening Balance</td>
            <td className="py-1 text-right font-semibold">{fmtBalance(openingBalance)}</td>
          </tr>
          {transactions.map((t) => (
            <tr key={t.id} className="border-b border-slate-100">
              <td className="py-0.5 pr-2 tabular-nums">{t.date}</td>
              <td className="py-0.5 pr-2 font-mono">{t.voucher_no}</td>
              <td className="py-0.5 pr-2">{canonicalParticulars(t)}</td>
              <td className="py-0.5 pr-2">{t.party ?? "—"}</td>
              <td className="py-0.5 pr-2 font-mono">{t.receipt_no ?? "—"}</td>
              <td className="py-0.5 pr-2 text-right">{t.debit > 0 ? t.debit.toFixed(2) : "—"}</td>
              <td className="py-0.5 pr-2 text-right">{t.credit > 0 ? t.credit.toFixed(2) : "—"}</td>
              <td className="py-0.5 pr-2">{t.mode}</td>
              <td className="py-0.5 text-right tabular-nums">{t.running_balance.toFixed(2)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-800 bg-slate-100">
            <td className="py-1.5 pr-2 font-bold">{endDate}</td>
            <td colSpan={7} className="py-1.5 pr-2 font-bold">Closing Balance</td>
            <td className="py-1.5 text-right font-bold">{fmtBalance(closingBalance)}</td>
          </tr>
        </tbody>
      </table>

      {/* Footer */}
      <div className="mt-16 flex justify-between text-xs text-slate-500 border-t border-slate-200 pt-4">
        <span>Generated: {new Date().toLocaleString("en-IN")}</span>
        <span>Authorized Signatory: ___________________________</span>
      </div>
    </div>
  );
}

// ─── Skeleton Rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={`sk-${i}`} className="animate-pulse border-b border-slate-100">
          <td className="px-3 py-3"><div className="h-3 w-16 rounded bg-slate-100" /></td>
          <td className="px-3 py-3"><div className="h-3 w-28 rounded bg-slate-100" /></td>
          <td className="px-3 py-3"><div className="h-3 w-32 rounded bg-slate-100" /></td>
          <td className="px-3 py-3"><div className="h-3 w-28 rounded bg-slate-100" /></td>
          <td className="px-3 py-3"><div className="h-3 w-24 rounded bg-slate-100" /></td>
          <td className="px-3 py-3"><div className="ml-auto h-3 w-16 rounded bg-slate-100" /></td>
          <td className="px-3 py-3"><div className="ml-auto h-3 w-16 rounded bg-slate-100" /></td>
          <td className="px-3 py-3"><div className="h-3 w-12 rounded bg-slate-100" /></td>
          <td className="px-3 py-3"><div className="ml-auto h-3 w-20 rounded bg-slate-100" /></td>
          <td className="px-3 py-3"><div className="h-3 w-24 rounded bg-slate-100" /></td>
        </tr>
      ))}
    </>
  );
}

// ─── Date Group Separator Row ─────────────────────────────────────────────────

function DateGroupRow({ date }: { date: string }) {
  return (
    <tr className="bg-slate-50/80">
      <td colSpan={10} className="px-4 py-1.5">
        <span className="text-xs font-semibold text-slate-500">{fmtDateHeading(date)}</span>
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CashLedger({ colleges, defaultCollegeId, trustName }: Props) {
  const initialCollegeId = defaultCollegeId ?? colleges[0]?.id ?? "";

  const [selectedCollegeId, setSelectedCollegeId] = useState(initialCollegeId);
  const [startDate, setStartDate] = useState(fyStartISO());
  const [endDate, setEndDate] = useState(todayISO());

  const queryParams = selectedCollegeId
    ? { college_id: selectedCollegeId, start_date: startDate, end_date: endDate }
    : null;

  const { data, isFetching, isError, refetch } = useCashLedger(queryParams);

  const selectedCollege = colleges.find((c) => c.id === selectedCollegeId);

  // Group transactions by date for display
  const grouped = useMemo((): Array<{ date: string; rows: CashLedgerTransaction[] }> => {
    if (!data?.transactions.length) return [];
    const map = new Map<string, CashLedgerTransaction[]>();
    for (const t of data.transactions) {
      const existing = map.get(t.date);
      if (existing) existing.push(t);
      else map.set(t.date, [t]);
    }
    return Array.from(map.entries()).map(([date, rows]) => ({ date, rows }));
  }, [data?.transactions]);

  // ── CSV Export ─────────────────────────────────────────────────────────────
  function handleExportCsv() {
    if (!data) return;
    const headers = [
      "Date", "Voucher No.", "Particulars", "Party / Dept", "Receipt No.",
      "Debit (INR)", "Credit (INR)", "Mode", "Running Balance (INR)", "Remarks", "Module",
    ];
    const openingRow = [
      startDate, "—", "Opening Balance", "", "", "", "", "", data.opening_balance.toFixed(2), "", "",
    ];
    const txnRows = data.transactions.map((t) => [
      t.date,
      t.voucher_no,
      canonicalParticulars(t),
      t.party ?? "",
      t.receipt_no ?? "",
      t.debit > 0 ? t.debit.toFixed(2) : "",
      t.credit > 0 ? t.credit.toFixed(2) : "",
      t.mode,
      t.running_balance.toFixed(2),
      t.remarks ?? "",
      t.source_module,
    ]);
    const closingRow = [
      endDate, "—", "Closing Balance", "", "", "", "", "", data.closing_balance.toFixed(2), "", "",
    ];
    exportRowsToCsv(
      `cash-ledger-${selectedCollege?.name ?? "all"}-${startDate}-to-${endDate}.csv`,
      headers,
      [openingRow, ...txnRows, closingRow],
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Print-only layout */}
      {data && (
        <PrintView
          collegeName={selectedCollege?.name ?? "All Colleges"}
          trustName={trustName}
          startDate={startDate}
          endDate={endDate}
          openingBalance={data.opening_balance}
          closingBalance={data.closing_balance}
          totalCredit={data.total_credit}
          totalDebit={data.total_debit}
          transactions={data.transactions}
        />
      )}

      {/* Screen view */}
      <div className="space-y-5 print:hidden">

        {/* ── Page header + actions ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Cash Ledger</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              System-generated · Read-only · Aggregates fee collections, credits, and expenses.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!data || isFetching}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!data || isFetching}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
          </div>
        </div>

        {/* ── Filter bar ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-slate-50 px-4 py-3">
          {/* College selector — always shown */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">College</label>
            <select
              value={selectedCollegeId}
              onChange={(e) => setSelectedCollegeId(e.target.value)}
              className="min-w-[200px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              {colleges.length === 0 && (
                <option value="">No colleges available</option>
              )}
              {colleges.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">From</label>
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">To</label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              max={todayISO()}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
        </div>

        {/* ── Summary cards ──────────────────────────────────────────────── */}
        {data && !isFetching && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Opening Balance"
              value={data.opening_balance}
              icon={Wallet}
              iconCls="bg-slate-800 text-white"
            />
            <SummaryCard
              label="Total Credit (Cash In)"
              value={data.total_credit}
              icon={TrendingUp}
              iconCls="bg-emerald-100 text-emerald-700"
            />
            <SummaryCard
              label="Total Debit (Cash Out)"
              value={data.total_debit}
              icon={TrendingDown}
              iconCls="bg-rose-100 text-rose-700"
            />
            <SummaryCard
              label="Closing Balance"
              value={data.closing_balance}
              icon={Wallet}
              iconCls="bg-slate-900 text-white"
            />
          </div>
        )}
        {isFetching && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-2xl bg-slate-100 h-[76px]" />
            ))}
          </div>
        )}

        {/* ── Summary strip ──────────────────────────────────────────────── */}
        {data && !isFetching && (
          <SummaryStrip
            opening={data.opening_balance}
            credit={data.total_credit}
            debit={data.total_debit}
            closing={data.closing_balance}
          />
        )}

        {/* ── Ledger table ────────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              {/* Table head */}
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="whitespace-nowrap px-4 py-3">Date</th>
                  <th className="whitespace-nowrap px-4 py-3">Voucher No.</th>
                  <th className="whitespace-nowrap px-4 py-3">Particulars</th>
                  <th className="whitespace-nowrap px-4 py-3">Student / Dept</th>
                  <th className="whitespace-nowrap px-4 py-3">Receipt No.</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right text-rose-500">Debit (Out)</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right text-emerald-600">Credit (In)</th>
                  <th className="whitespace-nowrap px-4 py-3">Mode</th>
                  <th className="sticky right-0 whitespace-nowrap bg-slate-50 px-4 py-3 text-right shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]">
                    Balance
                  </th>
                  <th className="whitespace-nowrap px-4 py-3">Remarks</th>
                </tr>
              </thead>

              <tbody>
                {/* Skeleton while loading (no prior data) */}
                {isFetching && !data && <SkeletonRows />}

                {/* Error */}
                {isError && !isFetching && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-rose-600">
                      Failed to load cash ledger. Please refresh and try again.
                    </td>
                  </tr>
                )}

                {/* No college selected */}
                {!isFetching && !isError && !selectedCollegeId && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">
                      Select a college to view the cash ledger.
                    </td>
                  </tr>
                )}

                {/* ── Data ───────────────────────────────────────────────── */}
                {!isError && data && selectedCollegeId && (
                  <>
                    {/* Opening balance — visually distinct header row */}
                    <tr className="border-b-2 border-slate-200 bg-slate-100/70">
                      <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold tabular-nums text-slate-600">
                        {startDate}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">—</td>
                      <td className="px-4 py-3" colSpan={5}>
                        <span className="inline-flex items-center rounded-md bg-slate-200 px-2.5 py-1 text-xs font-bold tracking-wide text-slate-700">
                          ⬤ Opening Balance
                        </span>
                      </td>
                      <td className="px-4 py-3" />
                      <td className="sticky right-0 bg-slate-100/70 px-4 py-3 text-right text-base font-bold tabular-nums text-slate-900 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]">
                        {fmtBalance(data.opening_balance)}
                      </td>
                      <td className="px-4 py-3" />
                    </tr>

                    {/* Transactions — empty state */}
                    {data.transactions.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-12 text-center">
                          <p className="text-sm font-medium text-slate-500">No transactions found</p>
                          <p className="mt-1 text-xs text-slate-400">
                            No fee collections, credits, or expenses found for the selected date range.
                          </p>
                        </td>
                      </tr>
                    )}

                    {/* Transactions grouped by date */}
                    {grouped.map(({ date, rows }) => (
                      <>
                        <DateGroupRow key={`grp-${date}`} date={date} />
                        {rows.map((t) => (
                          <tr
                            key={t.id}
                            className={`group border-b border-slate-100 transition-colors hover:bg-sky-50/40 ${t.is_reversed ? "opacity-50" : ""}`}
                          >
                            {/* Date */}
                            <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-slate-500">
                              {t.date}
                            </td>

                            {/* Voucher No. with prefix badge */}
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ring-1 ${voucherBadge(t.voucher_no, t.source_module).cls}`}>
                                  {voucherBadge(t.voucher_no, t.source_module).label}
                                </span>
                                <span className="font-mono text-xs text-slate-500">{t.voucher_no}</span>
                              </div>
                            </td>

                            {/* Particulars */}
                            <td className="px-4 py-2.5">
                              <span className="font-medium text-slate-800">
                                {canonicalParticulars(t)}
                              </span>
                              {t.is_reversed && (
                                <span className="ml-1.5 text-[10px] font-semibold text-rose-500">REVERSED</span>
                              )}
                            </td>

                            {/* Party */}
                            <td className="max-w-[180px] px-4 py-2.5">
                              <span className="block truncate text-slate-600">
                                {t.party ?? <span className="text-slate-300">—</span>}
                              </span>
                            </td>

                            {/* Receipt No. */}
                            <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-500">
                              {t.receipt_no ?? <span className="text-slate-300">—</span>}
                            </td>

                            {/* Debit */}
                            <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                              {t.debit > 0 ? (
                                <span className="font-semibold text-rose-600">{fmt(t.debit)}</span>
                              ) : (
                                <span className="text-slate-200">—</span>
                              )}
                            </td>

                            {/* Credit */}
                            <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                              {t.credit > 0 ? (
                                <span className="font-semibold text-emerald-600">{fmt(t.credit)}</span>
                              ) : (
                                <span className="text-slate-200">—</span>
                              )}
                            </td>

                            {/* Mode badge */}
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${modeBadgeCls(t.mode)}`}>
                                {t.mode}
                              </span>
                            </td>

                            {/* Running balance — sticky */}
                            <td className="sticky right-0 whitespace-nowrap bg-white px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)] group-hover:bg-sky-50/40">
                              {fmtBalance(t.running_balance)}
                            </td>

                            {/* Remarks */}
                            <td className="max-w-[200px] px-4 py-2.5">
                              <span className="block truncate text-xs text-slate-400" title={t.remarks ?? ""}>
                                {t.remarks ?? ""}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </>
                    ))}

                    {/* Closing balance — always shown */}
                    <tr className="border-t-2 border-slate-800 bg-slate-900">
                      <td className="whitespace-nowrap px-4 py-3.5 text-xs font-semibold tabular-nums text-slate-400">
                        {endDate}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600">—</td>
                      <td className="px-4 py-3.5" colSpan={5}>
                        <span className="inline-flex items-center rounded-md bg-white/10 px-2.5 py-1 text-xs font-bold tracking-wide text-white">
                          ■ Closing Balance
                        </span>
                      </td>
                      <td className="px-4 py-3.5" />
                      <td className="sticky right-0 bg-slate-900 px-4 py-3.5 text-right text-lg font-bold tabular-nums text-white shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.3)]">
                        {fmtBalance(data.closing_balance)}
                      </td>
                      <td className="px-4 py-3.5" />
                    </tr>
                  </>
                )}

                {/* Refetch overlay row — show skeleton shimmer on data refresh */}
                {isFetching && data && <SkeletonRows />}
              </tbody>
            </table>
          </div>

          {/* Table footer note */}
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-400">
            <span>Read-only · All entries are system-generated · Reversals post as offsetting debits</span>
            {data && (
              <span className="tabular-nums">
                {data.transactions.length} transaction{data.transactions.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
