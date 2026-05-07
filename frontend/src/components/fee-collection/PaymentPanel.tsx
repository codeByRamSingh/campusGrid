import type { PaymentMode } from "./types";

type Props = {
  mode: PaymentMode;
  onModeChange: (m: PaymentMode) => void;
  date: string;
  onDateChange: (d: string) => void;
  notes: string;
  onNotesChange: (n: string) => void;
  reference: string;
  onReferenceChange: (r: string) => void;
};

const MODE_LABELS: Record<PaymentMode, string> = {
  CASH: "Cash",
  UPI: "UPI / QR",
  BANK: "Bank Transfer",
};

export function PaymentPanel({
  mode,
  onModeChange,
  date,
  onDateChange,
  notes,
  onNotesChange,
  reference,
  onReferenceChange,
}: Props) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <h2 className="text-sm font-semibold text-slate-800">Payment Details</h2>

      <div className="mt-4 space-y-4">
        {/* Mode selector */}
        <div className="flex gap-2">
          {(["CASH", "UPI", "BANK"] as PaymentMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Payment Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              required
            />
          </div>

          {(mode === "UPI" || mode === "BANK") && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">
                {mode === "UPI" ? "UTR / Reference Number" : "Transaction Reference"}
              </label>
              <input
                value={reference}
                onChange={(e) => onReferenceChange(e.target.value)}
                placeholder={mode === "UPI" ? "12-digit UTR" : "Transaction ID"}
                className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Notes (optional)</label>
          <input
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Any remarks for this payment…"
            className="w-full rounded-xl bg-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>
      </div>
    </section>
  );
}
