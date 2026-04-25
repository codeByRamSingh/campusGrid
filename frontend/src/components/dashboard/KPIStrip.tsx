import { AlertCircle, ArrowRight, Coins, ShieldAlert, TrendingDown, TrendingUp, UserRound, Users } from "lucide-react";

type KPIMetric = {
  label: string;
  value: string;
  trend?: number; // percentage, positive or negative
  trendLabel?: string;
  icon: "wallet" | "users" | "alert" | "staff" | "payroll" | "compliance";
  severity?: "good" | "neutral" | "warning" | "critical";
  target?: "students" | "finance" | "hr" | "admin" | "settings" | "dashboard";
};

type Props = {
  metrics: KPIMetric[];
  onMetricClick?: (target: KPIMetric["target"]) => void;
};

export function KPIStrip({ metrics, onMetricClick }: Props) {
  const getTrendColor = (severity?: string) => {
    switch (severity) {
      case "critical":
        return "bg-rose-50 text-rose-700";
      case "warning":
        return "bg-amber-50 text-amber-700";
      case "good":
        return "bg-emerald-50 text-emerald-700";
      default:
        return "bg-blue-50 text-blue-700";
    }
  };

  const getIconColor = (severity?: string) => {
    switch (severity) {
      case "critical":
        return "bg-rose-100 text-rose-700";
      case "warning":
        return "bg-amber-100 text-amber-700";
      case "good":
        return "bg-emerald-100 text-emerald-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {metrics.map((metric) => (
        <button
          type="button"
          key={metric.label}
          onClick={() => onMetricClick?.(metric.target)}
          className="bg-white text-left rounded-2xl p-4 ring-1 ring-slate-100 hover:ring-slate-300 hover:shadow-sm transition-all"
        >
          <div className="flex items-start justify-between mb-2">
            <h3 className="text-xs uppercase font-semibold text-slate-500 tracking-wide">{metric.label}</h3>
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${getIconColor(metric.severity)}`}>
              {metric.icon === "wallet" && <Coins className="h-4 w-4" />}
              {metric.icon === "users" && <Users className="h-4 w-4" />}
              {metric.icon === "alert" && <AlertCircle className="h-4 w-4" />}
              {metric.icon === "staff" && <UserRound className="h-4 w-4" />}
              {metric.icon === "payroll" && <Coins className="h-4 w-4" />}
              {metric.icon === "compliance" && <ShieldAlert className="h-4 w-4" />}
            </div>
          </div>

          <div className="mb-3">
            <p className="text-2xl font-bold text-slate-900">{metric.value}</p>
          </div>

          {metric.trend !== undefined && (
            <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${getTrendColor(metric.severity)}`}>
              {metric.trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              <span>
                {Math.abs(metric.trend)}% {metric.trendLabel || "MoM"}
              </span>
            </div>
          )}

          {metric.target && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
              Open module <ArrowRight className="h-3 w-3" />
            </p>
          )}
        </button>
      ))}
    </div>
  );
}
