import { Search } from "lucide-react";

type StudentRef = {
  id: string;
  candidateName: string;
  admissionNumber: number;
  admissionCode?: string;
};

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  students: StudentRef[];
  selectedId: string;
  onSelect: (id: string) => void;
  loading: boolean;
};

export function StudentSelector({ query, onQueryChange, students, selectedId, onSelect, loading }: Props) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <h2 className="text-sm font-semibold text-slate-800">Find Student</h2>

      <div className="mt-3 flex gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Name, admission number, or code…"
            className="w-full rounded-xl bg-slate-100 py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            autoFocus
          />
        </div>

        <select
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          className="min-w-0 flex-1 rounded-xl bg-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
          disabled={loading}
        >
          {students.length === 0 && <option value="">No students found</option>}
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.candidateName} ({s.admissionCode ?? `#${s.admissionNumber}`})
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
