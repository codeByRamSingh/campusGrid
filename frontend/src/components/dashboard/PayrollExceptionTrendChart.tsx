import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type PayrollData = {
  month: string;
  exceptions: number;
  resolved: number;
  pending: number;
};

type Props = {
  data: PayrollData[];
  height?: number;
  title?: string;
};

export function PayrollExceptionTrendChart({
  data,
  height = 280,
  title = "Payroll Exception Trend",
}: Props) {
  const totalExceptions = data.reduce((sum, item) => sum + item.exceptions, 0);
  const totalResolved = data.reduce((sum, item) => sum + item.resolved, 0);
  const resolutionRate = ((totalResolved / totalExceptions) * 100).toFixed(1);

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">Exception lifecycle tracking</p>
      </div>

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="month" stroke="#94a3b8" style={{ fontSize: "12px" }} />
            <YAxis stroke="#94a3b8" style={{ fontSize: "12px" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1e293b",
                border: "1px solid #475569",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "#f1f5f9" }}
            />
            <Legend wrapperStyle={{ paddingTop: "20px" }} />
            <Bar dataKey="exceptions" name="Total Exceptions" fill="#ef4444" radius={[6, 6, 0, 0]} />
            <Bar dataKey="resolved" name="Resolved" fill="#10b981" radius={[6, 6, 0, 0]} />
            <Bar dataKey="pending" name="Pending" fill="#f97316" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200">
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Resolution Rate:</span> {resolutionRate}%
        </p>
      </div>
    </div>
  );
}
