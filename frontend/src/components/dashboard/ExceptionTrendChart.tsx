import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type ExceptionTrendData = {
  date: string;
  count: number;
};

type Props = {
  data: ExceptionTrendData[];
  height?: number;
  title?: string;
};

export function ExceptionTrendChart({
  data,
  height = 280,
  title = "Exception Trend Over Time",
}: Props) {
  const latestCount = data[data.length - 1]?.count ?? 0;
  const previousCount = data[data.length - 2]?.count ?? latestCount;
  const trend = latestCount - previousCount;
  const trendColor = trend > 0 ? "text-rose-600" : "text-emerald-600";
  const trendIcon = trend > 0 ? "↑" : "↓";

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">Cumulative exceptions over time</p>
      </div>

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="date" stroke="#94a3b8" style={{ fontSize: "12px" }} />
            <YAxis stroke="#94a3b8" style={{ fontSize: "12px" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1e293b",
                border: "1px solid #475569",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "#f1f5f9" }}
              formatter={(value: any) => `${value ?? 0} exceptions`}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              isAnimationActive={true}
              name="Exceptions"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500">Current Exception Count</p>
          <p className="text-2xl font-bold text-slate-900">{latestCount}</p>
        </div>
        <div className={`text-right ${trendColor}`}>
          <p className="text-xs text-slate-500">Trend (Period vs Previous)</p>
          <p className="text-2xl font-bold">
            {trendIcon} {Math.abs(trend)}
          </p>
        </div>
      </div>
    </div>
  );
}
