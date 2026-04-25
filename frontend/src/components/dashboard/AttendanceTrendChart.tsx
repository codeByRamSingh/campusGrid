import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

type AttendanceData = {
  date: string;
  percentage: number;
};

type Props = {
  data: AttendanceData[];
  height?: number;
  title?: string;
  targetPercentage?: number;
};

export function AttendanceTrendChart({
  data,
  height = 280,
  title = "Attendance Trend",
  targetPercentage = 95,
}: Props) {
  const avgAttendance = (
    data.reduce((sum, item) => sum + item.percentage, 0) / data.length
  ).toFixed(1);

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">30-day rolling average</p>
      </div>

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="date" stroke="#94a3b8" style={{ fontSize: "12px" }} />
            <YAxis stroke="#94a3b8" style={{ fontSize: "12px" }} domain={[80, 100]} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1e293b",
                border: "1px solid #475569",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "#f1f5f9" }}
              formatter={(value: any) => `${(value ?? 0).toFixed(1)}%`}
            />
            <ReferenceLine
              y={targetPercentage}
              stroke="#8b5cf6"
              strokeDasharray="5 5"
              label={{ value: "Target", position: "right", fill: "#8b5cf6" }}
            />
            <Line
              type="monotone"
              dataKey="percentage"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              isAnimationActive={true}
              name="Attendance %"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-slate-500">Average Attendance</p>
          <p className="text-2xl font-bold text-slate-900">{avgAttendance}%</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">vs Target</p>
          <p className={`text-2xl font-bold ${parseFloat(avgAttendance) >= targetPercentage ? "text-emerald-600" : "text-rose-600"}`}>
            {parseFloat(avgAttendance) >= targetPercentage ? "✓" : "⚠"} {Math.abs(parseFloat(avgAttendance) - targetPercentage).toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}
