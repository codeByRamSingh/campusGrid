import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type AgingBucket = {
  period: string;
  count: number;
  amount: number;
};

type Props = {
  data: AgingBucket[];
  height?: number;
  title?: string;
};

export function OutstandingAgingChart({ data, height = 280, title = "Outstanding Aging Analysis" }: Props) {
  const total = data.reduce((sum, item) => sum + item.amount, 0);
  const highRisk = data.find((item) => item.period.includes("90"))?.amount ?? 0;
  const palette = ["#2563eb", "#10b981", "#f59e0b", "#dc2626"];

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">Outstanding aging buckets and recovery risk</p>
      </div>

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="period"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
            >
              {data.map((entry, index) => (
                <Cell key={entry.period} fill={palette[index % palette.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#1e293b",
                border: "1px solid #475569",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "#f1f5f9" }}
              formatter={(value: any) => {
                const numericValue = Number(value ?? 0);
                return [`INR ${(numericValue / 1000).toFixed(1)}K`, "Outstanding"];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-slate-500">Total Outstanding</p>
          <p className="text-xl font-bold text-slate-900">INR {(total / 1000).toFixed(1)}K</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">High Recovery Risk</p>
          <p className="text-xl font-bold text-rose-600">INR {(highRisk / 1000).toFixed(1)}K</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
        INR {highRisk.toLocaleString()} at high recovery risk (90+ days)
      </div>
    </div>
  );
}
