type CollegeData = {
  college: string;
  revenue: number;
  collectionPct: number;
  admissions: number;
  status: "Healthy" | "Watch" | "At Risk";
};

type Props = {
  data: CollegeData[];
  height?: number;
  title?: string;
};

export function CollegePerformanceChart({ data, height = 320, title = "College-wise Performance" }: Props) {
  const getStatusColor = (status: CollegeData["status"]) => {
    if (status === "Healthy") {
      return "bg-emerald-50 text-emerald-700";
    }
    if (status === "Watch") {
      return "bg-amber-50 text-amber-700";
    }
    return "bg-rose-50 text-rose-700";
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">Trust-wide institution comparison snapshot</p>
      </div>

      <div className="overflow-x-auto" style={{ maxHeight: height }}>
        <table className="w-full text-sm border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="pb-1 font-semibold">College</th>
              <th className="pb-1 font-semibold">Revenue</th>
              <th className="pb-1 font-semibold">Collection %</th>
              <th className="pb-1 font-semibold">Admissions</th>
              <th className="pb-1 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.college} className="bg-slate-50/80">
                <td className="px-3 py-2 rounded-l-xl font-semibold text-slate-800">{row.college}</td>
                <td className="px-3 py-2 text-slate-700">INR {(row.revenue / 1000).toFixed(1)}K</td>
                <td className="px-3 py-2 text-slate-700">{row.collectionPct.toFixed(1)}%</td>
                <td className="px-3 py-2 text-slate-700">{row.admissions.toLocaleString()}</td>
                <td className="px-3 py-2 rounded-r-xl">
                  <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-semibold ${getStatusColor(row.status)}`}>{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
