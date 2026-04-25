type Issue = {
  id: string;
  priority: "High" | "Medium" | "Low";
  issue: string;
  module: string;
  assigned: string;
};

type Props = {
  issues: Issue[];
  title?: string;
  maxItems?: number;
};

export function CriticalIssuesList({ issues, title = "Critical Issues", maxItems = 10 }: Props) {
  const sortedIssues = [...issues]
    .sort((a, b) => {
      const severityOrder = { High: 0, Medium: 1, Low: 2 };
      return severityOrder[a.priority] - severityOrder[b.priority];
    })
    .slice(0, maxItems);

  const getPriorityColor = (priority: Issue["priority"]) => {
    if (priority === "High") {
      return "bg-rose-50 text-rose-700";
    }
    if (priority === "Medium") {
      return "bg-amber-50 text-amber-700";
    }
    return "bg-blue-50 text-blue-700";
  };

  if (sortedIssues.length === 0) {
    return (
      <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">{title}</h2>
        <div className="rounded-2xl bg-emerald-50 p-4 text-center">
          <p className="text-sm font-medium text-emerald-700">✓ No critical issues</p>
          <p className="text-xs text-emerald-600 mt-1">All systems operating normally</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm ring-1 ring-slate-100">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="pb-1 font-semibold">Priority</th>
              <th className="pb-1 font-semibold">Issue</th>
              <th className="pb-1 font-semibold">Module</th>
              <th className="pb-1 font-semibold">Assigned</th>
            </tr>
          </thead>
          <tbody>
            {sortedIssues.map((issue) => (
              <tr key={issue.id} className="bg-slate-50/80">
                <td className="px-3 py-2 rounded-l-xl">
                  <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-semibold ${getPriorityColor(issue.priority)}`}>{issue.priority}</span>
                </td>
                <td className="px-3 py-2 text-slate-800 font-medium">{issue.issue}</td>
                <td className="px-3 py-2 text-slate-700">{issue.module}</td>
                <td className="px-3 py-2 rounded-r-xl text-slate-700">{issue.assigned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {issues.length > maxItems && (
        <p className="text-xs text-slate-500 mt-3 text-center">
          Showing {maxItems} of {issues.length} issues
        </p>
      )}
    </div>
  );
}
