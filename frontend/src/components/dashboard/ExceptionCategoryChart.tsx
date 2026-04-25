import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

type CategoryData = {
  category: string;
  count: number;
  color: string;
};

type Props = {
  data: CategoryData[];
  height?: number;
  title?: string;
};

export function ExceptionCategoryChart({
  data,
  height = 320,
  title = "Exception Category Breakdown",
}: Props) {
  const total = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">Distribution by category</p>
      </div>

      <div style={{ height }} className="flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="count"
              label={({ name, percent }: any) => {
                const item = data.find((d) => d.category === name);
                return `${item?.category ?? name} ${((percent ?? 0) * 100).toFixed(0)}%`;
              }}
            >
              {data.map((item) => (
                <Cell key={item.category} fill={item.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value: any) => `${value ?? 0} exceptions`} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200">
        <div className="grid grid-cols-2 gap-3">
          {data.map((item) => (
            <div key={item.category} className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
              <div>
                <p className="text-xs text-slate-600">{item.category}</p>
                <p className="text-sm font-semibold text-slate-900">
                  {item.count} ({((item.count / total) * 100).toFixed(1)}%)
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
