type FunnelStage = {
  stage: string;
  value: number;
  conversionPct: number;
};

type Props = {
  data: FunnelStage[];
  height?: number;
  title?: string;
};

export function AdmissionsFunnelChart({ data, height = 320, title = "Admissions Pipeline" }: Props) {
  const getColor = (index: number) => {
    const colors = ["#0284c7", "#0ea5e9", "#22c55e", "#16a34a", "#f97316"];
    return colors[index % colors.length];
  };

  const topStage = data[0]?.value ?? 0;
  const finalStage = data[data.length - 2]?.value ?? 0;
  const dropOff = data[data.length - 1]?.value ?? Math.max(topStage - finalStage, 0);
  const endToEnd = topStage > 0 ? (finalStage / topStage) * 100 : 0;

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100" style={{ height }}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">Applications to enrollment with conversion by stage</p>
      </div>

      <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: height - 116 }}>
        {data.map((item, index) => (
          <div key={item.stage} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">{item.stage}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{item.value.toLocaleString()}</span>
                <span className="text-xs text-slate-500">({item.conversionPct}%)</span>
              </div>
            </div>
            <div className="h-8 bg-slate-100 rounded-lg overflow-hidden">
              <div
                className="h-full rounded-lg transition-all"
                style={{
                  width: `${Math.max(4, item.conversionPct)}%`,
                  backgroundColor: getColor(index),
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-slate-200">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <p className="text-slate-500">
            <span className="font-semibold text-slate-700">End-to-end conversion:</span> {endToEnd.toFixed(1)}%
          </p>
          <p className="text-slate-500 text-right">
            <span className="font-semibold text-orange-600">Drop-offs:</span> {dropOff.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
