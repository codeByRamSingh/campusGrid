type HeatmapData = {
  month: string;
  colleges: Array<{
    name: string;
    percentage: number;
  }>;
};

type Props = {
  data: HeatmapData[];
  title?: string;
};

export function FeeCollectionHeatmap({ data, title = "Fee Collection Heatmap" }: Props) {
  // Collect all college names
  const collegeNames = Array.from(
    new Set(data.flatMap((m) => m.colleges.map((c) => c.name)))
  );

  const getColor = (percentage: number) => {
    if (percentage >= 90) return "bg-emerald-600 text-white";
    if (percentage >= 70) return "bg-emerald-400 text-white";
    if (percentage >= 50) return "bg-yellow-300 text-slate-900";
    if (percentage >= 30) return "bg-orange-400 text-white";
    return "bg-rose-500 text-white";
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">Month vs College collection percentage</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left py-3 px-3 font-semibold text-slate-700 bg-slate-50">Month</th>
              {collegeNames.map((college) => (
                <th key={college} className="text-center py-3 px-2 font-semibold text-slate-700 bg-slate-50">
                  <span className="block text-xs">{college}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.month} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="py-3 px-3 font-medium text-slate-700">{item.month}</td>
                {collegeNames.map((collegeName) => {
                  const collegeData = item.colleges.find((c) => c.name === collegeName);
                  const percentage = collegeData?.percentage ?? 0;

                  return (
                    <td key={collegeName} className="text-center py-3 px-2">
                      <div
                        className={`inline-block rounded-lg px-3 py-2 font-semibold w-16 text-xs ${getColor(percentage)}`}
                      >
                        {percentage}%
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-emerald-600" />
          <span className="text-slate-600">90%+</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-yellow-300" />
          <span className="text-slate-600">50-89%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-rose-500" />
          <span className="text-slate-600">&lt;30%</span>
        </div>
      </div>
    </div>
  );
}
