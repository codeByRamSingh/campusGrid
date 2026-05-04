import type { StudentDue } from "./types";

function fmt(n: number) {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(2)}K`;
  return `₹${n.toFixed(2)}`;
}

function statusColor(status: string) {
  switch (status) {
    case "Paid": return "bg-emerald-100 text-emerald-700";
    case "Partial": return "bg-amber-100 text-amber-700";
    case "Overdue": return "bg-rose-100 text-rose-700";
    default: return "bg-slate-100 text-slate-600";
  }
}

type Props = {
  dues: StudentDue[];
  loading: boolean;
  error: string;
  payNow: Record<string, string>;
  onPayNowChange: (cycleKey: string, value: string) => void;
  payAll: boolean;
  onPayAllToggle: () => void;
};

export function FeeTable({ dues, loading, error, payNow, onPayNowChange, payAll, onPayAllToggle }: Props) {
  const openDues = dues.filter((d) => d.balance > 0);

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Fee Dues</h2>
          <p className="mt-0.5 text-xs text-slate-500">{openDues.length} instalment{openDues.length !== 1 ? "s" : ""} outstanding</p>
        </div>

        {openDues.length > 0 && (
          <button
            type="button"
            onClick={onPayAllToggle}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
              payAll ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {payAll ? "Pay All (ON)" : "Pay All"}
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-4 flex items-center justify-center py-8 text-sm text-slate-400">Loading dues…</div>
      )}

      {!loading && error && (
        <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {!loading && !error && dues.length === 0 && (
        <div className="mt-4 flex items-center justify-center py-8 text-sm text-slate-400">No fee records found.</div>
      )}

      {!loading && !error && dues.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5">Instalment</th>
                <th className="px-3 py-2.5">Due Date</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-3 py-2.5 text-right">Paid</th>
                <th className="px-3 py-2.5 text-right">Balance</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Pay Now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dues.map((row) => {
                const val = payNow[row.cycleKey] ?? "";
                const payNowNum = parseFloat(val) || 0;
                const overEntry = payNowNum > row.balance + 0.001;

                return (
                  <tr key={row.cycleKey} className={`${payNowNum > 0 ? "bg-slate-50/60" : ""}`}>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{row.label}</td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {new Date(row.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-700">{fmt(row.amount)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-500">{fmt(row.paid)}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-800">{fmt(row.balance)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${statusColor(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {row.balance > 0 ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min="0"
                            max={row.balance}
                            step="0.01"
                            value={val}
                            onChange={(e) => onPayNowChange(row.cycleKey, e.target.value)}
                            placeholder={fmt(row.balance)}
                            className={`w-28 rounded-xl px-2.5 py-1.5 text-right text-sm outline-none ring-1 focus:ring-2 ${
                              overEntry
                                ? "bg-rose-50 ring-rose-300 focus:ring-rose-400"
                                : "bg-slate-100 ring-slate-200 focus:ring-slate-400"
                            }`}
                          />
                          {val === "" && (
                            <button
                              type="button"
                              title="Fill full balance"
                              onClick={() => onPayNowChange(row.cycleKey, row.balance.toFixed(2))}
                              className="rounded-lg bg-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-300"
                            >
                              Full
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="block text-right text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
