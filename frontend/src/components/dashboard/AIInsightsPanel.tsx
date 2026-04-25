import { ArrowRight, Lightbulb, ShieldAlert } from "lucide-react";

type Insight = {
  id: string;
  text: string;
  indicator: "positive" | "neutral" | "warning" | "critical";
  action?: {
    label: string;
    target: string;
  };
};

type Props = {
  insights: Insight[];
  title?: string;
};

export function AIInsightsPanel({ insights, title = "AI-Generated Insights" }: Props) {
  const getIndicatorColor = (indicator: string) => {
    switch (indicator) {
      case "critical":
        return "bg-rose-50 border-rose-200 text-rose-700";
      case "warning":
        return "bg-amber-50 border-amber-200 text-amber-700";
      case "positive":
        return "bg-emerald-50 border-emerald-200 text-emerald-700";
      default:
        return "bg-blue-50 border-blue-200 text-blue-700";
    }
  };

  const getIndicatorBadge = (indicator: string) => {
    switch (indicator) {
      case "critical":
        return "bg-rose-100 text-rose-700";
      case "warning":
        return "bg-amber-100 text-amber-700";
      case "positive":
        return "bg-emerald-100 text-emerald-700";
      default:
        return "bg-blue-100 text-blue-700";
    }
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="h-5 w-5 text-orange-500" />
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>

      {insights.length === 0 ? (
        <div className="rounded-2xl bg-slate-50 p-4 text-center">
          <p className="text-sm text-slate-600">No insights available at this time</p>
        </div>
      ) : (
        <div className="space-y-3">
          {insights.map((insight) => (
            <div
              key={insight.id}
              className={`border rounded-2xl p-4 ${getIndicatorColor(insight.indicator)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm leading-relaxed flex-1">{insight.text}</p>
                <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-semibold ${getIndicatorBadge(insight.indicator)}`}>
                  {insight.indicator === "critical" ? "Urgent" : insight.indicator === "warning" ? "Review" : insight.indicator === "positive" ? "Opportunity" : "Info"}
                </span>
              </div>
              {insight.action && (
                <button
                  type="button"
                  className="mt-3 inline-flex items-center gap-2 text-xs font-semibold hover:opacity-75 transition-opacity"
                >
                  {insight.action.label}
                  <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500 inline-flex items-center gap-1">
        <Lightbulb className="h-3 w-3" /> Action center prioritizes decisions requiring same-day response.
      </p>
    </div>
  );
}
