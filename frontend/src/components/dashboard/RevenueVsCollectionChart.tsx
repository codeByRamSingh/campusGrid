import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type DataPoint = {
  college: string;
  billed: number;
  collected: number;
  outstanding: number;
  collectionPct: number;
};

type Props = {
  data: DataPoint[];
  height?: number;
  title?: string;
};

export function RevenueVsCollectionChart({ data, height = 320, title = "Revenue Collection Efficiency" }: Props) {
  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">Billed vs collected by institution with collection efficiency</p>
      </div>

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="college" stroke="#94a3b8" style={{ fontSize: "12px" }} />
            <YAxis stroke="#94a3b8" style={{ fontSize: "12px" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1e293b",
                border: "1px solid #475569",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "#f1f5f9" }}
              formatter={(value: any, name: any) => {
                const numericValue = Number(value ?? 0);
                if (name === "Collection %") {
                  return [`${numericValue.toFixed(1)}%`, String(name)];
                }
                return [`INR ${(numericValue / 1000).toFixed(1)}K`, String(name)];
              }}
            />
            <Bar dataKey="collected" stackId="fees" name="Collected" fill="#16a34a" radius={[6, 6, 0, 0]} />
            <Bar dataKey="outstanding" stackId="fees" name="Outstanding" fill="#f97316" radius={[6, 6, 0, 0]}>
              <LabelList dataKey="collectionPct" position="top" formatter={(value: any) => `${Number(value ?? 0).toFixed(0)}%`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
