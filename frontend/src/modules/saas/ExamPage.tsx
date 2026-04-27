import { useState } from "react";
import { CalendarDays, Plus, ClipboardList, BookOpen, CheckCircle2, XCircle, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../services/api";
import { hasPermission } from "../../lib/permissions";

type College = { id: string; name: string; courses: Array<{ id: string; name: string; sessions: Array<{ id: string; label: string }> }> };

export type ExamSchedule = {
  id: string;
  collegeId: string;
  courseId: string;
  sessionId: string;
  title: string;
  examType: "INTERNAL" | "EXTERNAL" | "PRACTICAL" | "VIVA";
  examDate: string;
  startTime?: string;
  endTime?: string;
  venue?: string;
  maxMarks: number;
  passingMarks: number;
  notes?: string;
  results: Array<{
    id: string;
    studentId: string;
    marksObtained: number | null;
    isPassed: boolean | null;
    grade: string | null;
    isAbsent: boolean;
  }>;
};

type Props = {
  colleges: College[];
  permissions: string[];
  loading: boolean;
};

const EXAM_TYPES = ["INTERNAL", "EXTERNAL", "PRACTICAL", "VIVA"] as const;
const EXAM_TYPE_LABELS: Record<string, string> = {
  INTERNAL: "Internal",
  EXTERNAL: "External",
  PRACTICAL: "Practical",
  VIVA: "Viva",
};

export default function ExamPage({ colleges, permissions, loading }: Props) {
  const canWrite = hasPermission(permissions, "EXAM_WRITE");

  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [fetched, setFetched] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);

  const [filterCourseId, setFilterCourseId] = useState("ALL");
  const [filterSessionId, setFilterSessionId] = useState("ALL");
  const [filterCollegeId, setFilterCollegeId] = useState("ALL");

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<ExamSchedule | null>(null);
  const [formData, setFormData] = useState({
    collegeId: "",
    courseId: "",
    sessionId: "",
    title: "",
    examType: "INTERNAL" as (typeof EXAM_TYPES)[number],
    examDate: "",
    startTime: "",
    endTime: "",
    venue: "",
    maxMarks: 100,
    passingMarks: 40,
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  async function fetchSchedules() {
    setFetchLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filterCourseId !== "ALL") params.courseId = filterCourseId;
      if (filterSessionId !== "ALL") params.sessionId = filterSessionId;
      const { data } = await api.get<ExamSchedule[]>("/exam/schedules", { params });
      setSchedules(data);
      setFetched(true);
    } catch {
      toast.error("Failed to load exam schedules");
    } finally {
      setFetchLoading(false);
    }
  }

  function openCreate() {
    setEditTarget(null);
    setFormData({ collegeId: colleges[0]?.id ?? "", courseId: "", sessionId: "", title: "", examType: "INTERNAL", examDate: "", startTime: "", endTime: "", venue: "", maxMarks: 100, passingMarks: 40, notes: "" });
    setShowForm(true);
  }

  function openEdit(s: ExamSchedule) {
    setEditTarget(s);
    setFormData({
      collegeId: s.collegeId,
      courseId: s.courseId,
      sessionId: s.sessionId,
      title: s.title,
      examType: s.examType,
      examDate: s.examDate.split("T")[0],
      startTime: s.startTime ?? "",
      endTime: s.endTime ?? "",
      venue: s.venue ?? "",
      maxMarks: s.maxMarks,
      passingMarks: s.passingMarks,
      notes: s.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editTarget) {
        const { data } = await api.patch<ExamSchedule>(`/exam/schedules/${editTarget.id}`, formData);
        setSchedules((prev) => prev.map((s) => (s.id === data.id ? { ...s, ...data } : s)));
        toast.success("Exam updated");
      } else {
        const { data } = await api.post<ExamSchedule>("/exam/schedules", formData);
        setSchedules((prev) => [{ ...data, results: [] }, ...prev]);
        toast.success("Exam scheduled");
      }
      setShowForm(false);
    } catch {
      toast.error("Failed to save exam schedule");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this exam schedule? All results will be lost.")) return;
    try {
      await api.delete(`/exam/schedules/${id}`);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      toast.success("Exam schedule deleted");
    } catch {
      toast.error("Failed to delete exam schedule");
    }
  }

  const allCourses = colleges.flatMap((c) => c.courses.map((co) => ({ ...co, collegeName: c.name })));
  const allSessions = allCourses.flatMap((co) => co.sessions.map((s) => ({ ...s, courseId: co.id, courseName: co.name })));

  const filteredSchedules = schedules.filter((s) => {
    if (filterCollegeId !== "ALL" && s.collegeId !== filterCollegeId) return false;
    if (filterCourseId !== "ALL" && s.courseId !== filterCourseId) return false;
    if (filterSessionId !== "ALL" && s.sessionId !== filterSessionId) return false;
    return true;
  });

  const selectedCollege = colleges.find((c) => c.id === formData.collegeId);
  const selectedCourse = selectedCollege?.courses.find((c) => c.id === formData.courseId);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-violet-500" />
          <h1 className="text-xl font-semibold text-white">Exam Schedules</h1>
        </div>
        {canWrite && (
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Schedule Exam
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={filterCollegeId} onChange={(e) => setFilterCollegeId(e.target.value)} className="bg-slate-800 text-slate-200 text-sm border border-slate-700 rounded-lg px-3 py-2">
          <option value="ALL">All Colleges</option>
          {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterCourseId} onChange={(e) => { setFilterCourseId(e.target.value); setFilterSessionId("ALL"); }} className="bg-slate-800 text-slate-200 text-sm border border-slate-700 rounded-lg px-3 py-2">
          <option value="ALL">All Courses</option>
          {allCourses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterSessionId} onChange={(e) => setFilterSessionId(e.target.value)} className="bg-slate-800 text-slate-200 text-sm border border-slate-700 rounded-lg px-3 py-2">
          <option value="ALL">All Sessions</option>
          {allSessions.filter((s) => filterCourseId === "ALL" || s.courseId === filterCourseId).map((s) => (
            <option key={s.id} value={s.id}>{s.label} — {s.courseName}</option>
          ))}
        </select>
        <button onClick={fetchSchedules} disabled={fetchLoading} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-sm text-white rounded-lg transition-colors disabled:opacity-50">
          {fetchLoading ? "Loading…" : "Load Schedules"}
        </button>
      </div>

      {/* Schedule List */}
      {fetched && (
        <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
          {filteredSchedules.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No exam schedules found. Create one to get started.</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3">Exam</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Venue</th>
                  <th className="px-4 py-3">Marks</th>
                  <th className="px-4 py-3">Results</th>
                  {canWrite && <th className="px-4 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredSchedules.map((s) => {
                  const passed = s.results.filter((r) => r.isPassed).length;
                  const total = s.results.length;
                  return (
                    <tr key={s.id} className="hover:bg-slate-700/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-white">{s.title}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-violet-900/40 text-violet-300">{EXAM_TYPE_LABELS[s.examType]}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{new Date(s.examDate).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-slate-400">{s.venue ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-300">{s.maxMarks} / {s.passingMarks} pass</td>
                      <td className="px-4 py-3">
                        {total > 0 ? (
                          <div className="flex items-center gap-1 text-xs">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">{passed}</span>
                            <XCircle className="w-3.5 h-3.5 text-red-400 ml-1" /><span className="text-red-400">{total - passed}</span>
                            <span className="text-slate-400 ml-1">/ {total}</span>
                          </div>
                        ) : <span className="text-slate-500 text-xs">No results</span>}
                      </td>
                      {canWrite && (
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-slate-600 text-slate-400 hover:text-white transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => void handleDelete(s.id)} className="p-1.5 rounded hover:bg-red-900/40 text-slate-400 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-violet-400" />
                <h2 className="text-lg font-semibold text-white">{editTarget ? "Edit Exam" : "Schedule Exam"}</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white transition-colors text-lg">✕</button>
            </div>
            <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
              {!editTarget && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">College</label>
                    <select value={formData.collegeId} onChange={(e) => setFormData((f) => ({ ...f, collegeId: e.target.value, courseId: "", sessionId: "" }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                      <option value="">Select college</option>
                      {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Course</label>
                    <select value={formData.courseId} onChange={(e) => setFormData((f) => ({ ...f, courseId: e.target.value, sessionId: "" }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                      <option value="">Select course</option>
                      {(selectedCollege?.courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">Session</label>
                    <select value={formData.sessionId} onChange={(e) => setFormData((f) => ({ ...f, sessionId: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                      <option value="">Select session</option>
                      {(selectedCourse?.sessions ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1">Exam Title</label>
                <input value={formData.title} onChange={(e) => setFormData((f) => ({ ...f, title: e.target.value }))} required placeholder="e.g. Mid-Term Mathematics" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Exam Type</label>
                  <select value={formData.examType} onChange={(e) => setFormData((f) => ({ ...f, examType: e.target.value as typeof formData.examType }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                    {EXAM_TYPES.map((t) => <option key={t} value={t}>{EXAM_TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Exam Date</label>
                  <input type="date" value={formData.examDate} onChange={(e) => setFormData((f) => ({ ...f, examDate: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Start Time</label>
                  <input type="time" value={formData.startTime} onChange={(e) => setFormData((f) => ({ ...f, startTime: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">End Time</label>
                  <input type="time" value={formData.endTime} onChange={(e) => setFormData((f) => ({ ...f, endTime: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Max Marks</label>
                  <input type="number" value={formData.maxMarks} onChange={(e) => setFormData((f) => ({ ...f, maxMarks: Number(e.target.value) }))} min={1} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Passing Marks</label>
                  <input type="number" value={formData.passingMarks} onChange={(e) => setFormData((f) => ({ ...f, passingMarks: Number(e.target.value) }))} min={0} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Venue</label>
                <input value={formData.venue} onChange={(e) => setFormData((f) => ({ ...f, venue: e.target.value }))} placeholder="e.g. Room 201, Block A" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Notes</label>
                <textarea value={formData.notes} onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Additional instructions…" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 resize-none" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                  {saving ? "Saving…" : editTarget ? "Update Exam" : "Schedule Exam"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
