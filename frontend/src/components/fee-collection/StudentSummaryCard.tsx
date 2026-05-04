import type { StudentInfo } from "./types";

function fmt(n: number) {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

type Props = { data: StudentInfo };

export function StudentSummaryCard({ data }: Props) {
  const isActive = data.status === "ACTIVE";

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-900">{data.name}</p>
          <p className="mt-0.5 text-xs text-slate-500">{data.admissionNo}</p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {data.course} &middot; {data.session}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-400">{data.college}</p>
        </div>

        <span
          className={`mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            isActive ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
          }`}
        >
          {isActive ? "Active" : data.status}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-slate-100 rounded-2xl bg-slate-50 text-center">
        <div className="px-3 py-3">
          <p className="text-xs text-slate-500">Total Fee</p>
          <p className="mt-1 font-semibold text-slate-800">{fmt(data.totalPayable)}</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-xs text-slate-500">Paid</p>
          <p className="mt-1 font-semibold text-emerald-600">{fmt(data.totalPaid)}</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-xs text-slate-500">Due</p>
          <p className={`mt-1 font-semibold ${data.totalDue > 0 ? "text-rose-600" : "text-slate-800"}`}>
            {fmt(data.totalDue)}
          </p>
        </div>
      </div>

      {!isActive && (
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
          This student account is not active. Fee collection is blocked.
        </p>
      )}
    </section>
  );
}
