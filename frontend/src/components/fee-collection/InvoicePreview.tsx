import type { StudentInfo, PayAllocation, PaymentMode } from "./types";

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

type Props = {
  student: StudentInfo | null;
  allocations: PayAllocation[];
  paymentMode: PaymentMode;
  paymentDate: string;
  totalAmount: number;
};

export function InvoicePreview({ student, allocations, paymentMode, paymentDate, totalAmount }: Props) {
  const hasData = student !== null && totalAmount > 0;

  const modeLabel: Record<PaymentMode, string> = { CASH: "Cash", UPI: "UPI / QR", BANK: "Bank Transfer" };

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Receipt Preview</h2>
        <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Draft</span>
      </div>

      {!hasData && (
        <div className="mt-6 flex flex-col items-center justify-center gap-2 py-6 text-center">
          <div className="text-2xl">🧾</div>
          <p className="text-xs text-slate-400">Select a student and enter payment amounts to preview receipt.</p>
        </div>
      )}

      {hasData && (
        <div className="mt-4 space-y-1 text-sm">
          <Row label="Student" value={`${student!.name} (${student!.admissionNo})`} />
          <Row label="College" value={student!.college} />
          <Row label="Course" value={student!.course} />
          <Row label="Session" value={student!.session} />
          <Row label="Payment Mode" value={modeLabel[paymentMode]} />
          <Row label="Date" value={paymentDate ? new Date(paymentDate).toLocaleDateString("en-IN") : "—"} />

          <div className="my-2 border-t border-slate-100" />

          {allocations.map((a) => (
            <Row key={a.cycleKey} label={a.label} value={fmt(a.amount)} />
          ))}
        </div>
      )}

      {hasData && (
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white">
          <span className="font-medium">Total Received</span>
          <span className="text-lg font-bold">{fmt(totalAmount)}</span>
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl px-1 py-1">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="text-right text-xs font-medium text-slate-800">{value}</span>
    </div>
  );
}
