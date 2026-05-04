import { useState, useRef, useCallback } from "react";
import {
  ArrowLeft, Pencil, X, Check, Camera, Upload, Trash2,
  Eye, MoreHorizontal, CreditCard, GraduationCap, User,
  Clock, Phone, Mail, MapPin, FileText, Activity,
  ChevronDown, Shield,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../services/api";
import { studentsApi, type Student, type StudentDocument } from "../../services/studentsApi";
import { STUDENTS_KEY } from "../../hooks/useStudents";

// ─── Local types ────────────────────────────────────────────────────────────

type Tab = "overview" | "academic" | "documents" | "finance" | "activity";

type College = {
  id: string;
  name: string;
  courses: Array<{
    id: string;
    name: string;
    sessions: Array<{ id: string; label: string }>;
  }>;
};

type ProfileData = {
  student: {
    id: string;
    candidateName: string;
    fatherName?: string;
    motherName?: string;
    fatherMobile?: string;
    mobile?: string;
    email?: string;
    dob?: string;
    gender?: string;
    nationality?: string;
    bloodGroup?: string | null;
    category?: string | null;
    background?: string | null;
    maritalStatus?: string | null;
    aadhaarNo?: string | null;
    permanentAddress?: string;
    mailingAddress?: string;
    rollNumber?: number;
    rollCode?: string;
    photoUrl?: string | null;
    previousQualificationJson?: unknown;
    universityEnrollmentNumber?: string | null;
    universityRegistrationNumber?: string | null;
    fatherOccupation?: string | null;
    motherOccupation?: string | null;
    admissions?: Array<{
      id: string;
      createdAt?: string;
      admissionType?: string;
      categoryQuota?: string | null;
      course?: { id: string; name: string };
      session?: { id: string; label: string; startYear: number; endYear: number };
    }>;
  };
  availableDocuments: string[];
};

type HistoryData = {
  timeline: Array<{ id: string; title: string; details: string; createdAt: string }>;
  audit: Array<{
    id: string;
    action: string;
    entityType: string;
    metadata?: unknown;
    createdAt: string;
    actor?: { id: string; email: string } | null;
  }>;
  receipts: Array<{
    id: string;
    receiptNumber: string;
    cycleKey?: string | null;
    cycleLabel?: string | null;
    amount: number;
    lateFine: number;
    totalReceived: number;
    paymentMode?: string | null;
    referenceNumber?: string | null;
    collectedBy?: string | null;
    collectedAt: string;
  }>;
  workflow: {
    admissionId: string;
    status: string;
    notes: string | null;
    workflowUpdatedAt: string;
    steps: Array<{ key: string; label: string; complete: boolean }>;
  } | null;
};

type EditForm = {
  candidateName: string;
  fatherName: string;
  motherName: string;
  mobile: string;
  fatherMobile: string;
  email: string;
  permanentAddress: string;
  mailingAddress: string;
  universityEnrollmentNumber: string;
  universityRegistrationNumber: string;
};

type Props = {
  studentId: string;
  student: Student;
  colleges: College[];
  canEdit: boolean;
  canManageWorkflow: boolean;
  onBack: () => void;
  onDeleted: () => void;
  onWorkflowAction: (action: string, notes?: string) => Promise<void>;
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function Field({ label, value, edit, children }: {
  label: string;
  value?: string | null;
  edit?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {edit && children ? (
        children
      ) : (
        <span className="text-sm text-slate-800">{value || <span className="text-slate-400 italic">—</span>}</span>
      )}
    </div>
  );
}

function Card({ title, icon: Icon, children }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    PENDING: "bg-amber-50 text-amber-700 ring-amber-200",
    SOFT_DELETED: "bg-rose-50 text-rose-600 ring-rose-200",
  };
  const cls = map[status] ?? "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function EditInput({ value, onChange, multiline }: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  const cls = "w-full rounded-xl border border-blue-200 bg-blue-50/40 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100";
  if (multiline) {
    return <textarea className={cls} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} />;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function StudentProfilePage({
  studentId,
  student,
  colleges,
  canEdit,
  canManageWorkflow,
  onBack,
  onDeleted,
  onWorkflowAction,
}: Props) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    candidateName: "",
    fatherName: "",
    motherName: "",
    mobile: "",
    fatherMobile: "",
    email: "",
    permanentAddress: "",
    mailingAddress: "",
    universityEnrollmentNumber: "",
    universityRegistrationNumber: "",
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [uploadDocType, setUploadDocType] = useState("");
  const [uploadDocTypeInput, setUploadDocTypeInput] = useState("");
  const [showDocUpload, setShowDocUpload] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const profileKey = ["student-printables", studentId];
  const historyKey = ["student-history", studentId];
  const docsKey = ["student-documents", studentId];

  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: profileKey,
    queryFn: () => api.get<ProfileData>(`/students/${studentId}/printables`).then((r) => r.data),
    enabled: !!studentId,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: historyKey,
    queryFn: () => api.get<HistoryData>(`/students/${studentId}/history`).then((r) => r.data),
    enabled: !!studentId,
    refetchInterval: 30_000,
  });

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: docsKey,
    queryFn: () => studentsApi.getStudentDocuments(studentId),
    enabled: !!studentId,
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  const profile = profileData?.student;
  const admission = profile?.admissions?.[0] ?? null;
  const workflow = historyData?.workflow ?? null;
  const collegeMap = Object.fromEntries(colleges.map((c) => [c.id, c]));
  const collegeName = collegeMap[student.collegeId]?.name ?? "Trust";

  const totalPaid = (historyData?.receipts ?? []).reduce((sum, r) => sum + r.totalReceived, 0);
  const pending = Math.max(0, student.totalPayable - totalPaid);

  // ── Edit mode helpers ──────────────────────────────────────────────────────

  const enterEdit = useCallback(() => {
    setEditForm({
      candidateName: student.candidateName,
      fatherName: profile?.fatherName ?? "",
      motherName: profile?.motherName ?? "",
      mobile: profile?.mobile ?? "",
      fatherMobile: profile?.fatherMobile ?? "",
      email: profile?.email ?? "",
      permanentAddress: profile?.permanentAddress ?? "",
      mailingAddress: profile?.mailingAddress ?? "",
      universityEnrollmentNumber: profile?.universityEnrollmentNumber ?? "",
      universityRegistrationNumber: profile?.universityRegistrationNumber ?? "",
    });
    setEditMode(true);
  }, [profile, student.candidateName]);

  const cancelEdit = () => setEditMode(false);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: () => studentsApi.updateStudent(studentId, editForm),
    onSuccess: () => {
      toast.success("Profile saved");
      setEditMode(false);
      void qc.invalidateQueries({ queryKey: STUDENTS_KEY });
      void qc.invalidateQueries({ queryKey: profileKey });
    },
    onError: () => toast.error("Failed to save changes"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => studentsApi.deleteStudent(studentId),
    onSuccess: () => {
      toast.success("Student deleted");
      void qc.invalidateQueries({ queryKey: STUDENTS_KEY });
      onDeleted();
    },
    onError: () => toast.error("Failed to delete student"),
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => studentsApi.uploadStudentPhoto(studentId, file),
    onSuccess: () => {
      toast.success("Photo updated");
      void qc.invalidateQueries({ queryKey: profileKey });
    },
    onError: () => toast.error("Photo upload failed"),
  });

  const uploadDocMutation = useMutation({
    mutationFn: ({ file, docType }: { file: File; docType: string }) =>
      studentsApi.uploadStudentDocument(studentId, file, docType),
    onSuccess: () => {
      toast.success("Document uploaded");
      setShowDocUpload(false);
      setUploadDocType("");
      setUploadDocTypeInput("");
      void qc.invalidateQueries({ queryKey: docsKey });
    },
    onError: () => toast.error("Document upload failed"),
  });

  const deleteDocMutation = useMutation({
    mutationFn: (admDocId: string) => studentsApi.deleteStudentDocument(studentId, admDocId),
    onSuccess: () => {
      toast.success("Document deleted");
      void qc.invalidateQueries({ queryKey: docsKey });
    },
    onError: () => toast.error("Failed to delete document"),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) photoMutation.mutate(file);
    e.target.value = "";
  };

  const handleDocFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const docType = uploadDocType || uploadDocTypeInput || file.name;
    if (!docType.trim()) {
      toast.error("Please specify a document type first");
      return;
    }
    uploadDocMutation.mutate({ file, docType: docType.trim() });
    e.target.value = "";
  };

  const handleReplaceDoc = (doc: StudentDocument) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) uploadDocMutation.mutate({ file, docType: doc.docType });
    };
    input.click();
  };

  const handleDeleteDoc = (doc: StudentDocument) => {
    if (!window.confirm(`Delete "${doc.docType}"? This cannot be undone.`)) return;
    deleteDocMutation.mutate(doc.id);
  };

  const handleDeleteStudent = () => {
    if (!window.confirm(`Delete student "${student.candidateName}"? This will mark the record as deleted.`)) return;
    deleteMutation.mutate();
  };

  const pf = (v: string) => (f: Partial<EditForm>) => setEditForm((prev) => ({ ...prev, [v]: Object.values(f)[0] ?? "" }));

  // ── Tab data ───────────────────────────────────────────────────────────────

  const activityItems = [
    ...(historyData?.timeline ?? []).map((t) => ({
      id: `t-${t.id}`, title: t.title, desc: t.details, at: t.createdAt, kind: "timeline" as const,
    })),
    ...(historyData?.audit ?? []).map((a) => ({
      id: `a-${a.id}`,
      title: a.action.replace(/_/g, " "),
      desc: `${a.entityType}${a.actor ? ` · by ${a.actor.email}` : ""}`,
      at: a.createdAt,
      kind: "audit" as const,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const tabs: Array<{ key: Tab; label: string; icon: React.ElementType }> = [
    { key: "overview", label: "Overview", icon: User },
    { key: "academic", label: "Academic", icon: GraduationCap },
    { key: "documents", label: "Documents", icon: FileText },
    { key: "finance", label: "Finance", icon: CreditCard },
    { key: "activity", label: "Activity", icon: Activity },
  ];

  const photoUrl = profile?.photoUrl
    ? `${api.defaults.baseURL?.replace("/api", "")}${profile.photoUrl}`
    : null;

  const initials = student.candidateName
    .split(" ")
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-0">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Directory
          </button>

          <div className="flex items-center gap-2">
            {editMode ? (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <X className="h-4 w-4" /> Cancel
                </button>
                <button
                  type="button"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                  <Check className="h-4 w-4" />
                  {saveMutation.isPending ? "Saving…" : "Save Changes"}
                </button>
              </>
            ) : (
              <>
                {canEdit && (
                  <button
                    type="button"
                    onClick={enterEdit}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
                  >
                    <Pencil className="h-4 w-4" /> Edit Profile
                  </button>
                )}
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
                  onClick={() => setActiveTab("finance")}
                >
                  <CreditCard className="h-4 w-4" /> Collect Fee
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMoreOpen((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  <AnimatePresence>
                    {moreOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="absolute right-0 top-10 z-50 min-w-[180px] rounded-2xl border border-slate-100 bg-white p-1.5 shadow-lg"
                      >
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => { setMoreOpen(false); handleDeleteStudent(); }}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" /> Delete Student
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { setMoreOpen(false); setActiveTab("activity"); }}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <Activity className="h-4 w-4" /> View Activity
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Student identity strip */}
        <div className="flex flex-wrap items-center gap-5 px-6 py-5">
          {/* Photo */}
          <div className="relative flex-shrink-0">
            <div
              className={`h-20 w-20 overflow-hidden rounded-2xl bg-slate-100 ring-2 ring-slate-200 ${editMode ? "cursor-pointer hover:ring-blue-400 transition-all" : ""}`}
              onClick={() => editMode && photoInputRef.current?.click()}
            >
              {photoUrl ? (
                <img src={photoUrl} alt={student.candidateName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-bold text-slate-500">
                  {initials}
                </div>
              )}
              {editMode && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-900/40 opacity-0 hover:opacity-100 transition-opacity">
                  <Camera className="h-6 w-6 text-white" />
                </div>
              )}
            </div>
            {photoMutation.isPending && (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/70">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              </div>
            )}
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900 truncate">{student.candidateName}</h1>
              <StatusBadge status={student.status} />
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {student.admissionCode ?? `ADM-${String(student.admissionNumber).padStart(4, "0")}`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {admission?.course && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {admission.course.name}
                </span>
              )}
              {admission?.session && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {admission.session.label}
                </span>
              )}
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {collegeName}
              </span>
            </div>
          </div>

          {/* Workflow status pill */}
          {workflow && (
            <div className="hidden md:flex items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <Shield className="h-4 w-4 text-slate-400" />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Workflow</p>
                <p className="text-sm font-semibold text-slate-800">{workflow.status.replace(/_/g, " ")}</p>
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-t border-slate-100 px-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors ${
                  active ? "text-slate-900" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {active && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-slate-900"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <div className="mt-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* ── OVERVIEW ─────────────────────────────────────────────── */}
            {activeTab === "overview" && (
              <div className="grid gap-4 xl:grid-cols-3">
                {/* Left column (2/3) */}
                <div className="xl:col-span-2 space-y-4">
                  <Card title="Personal Details" icon={User}>
                    {profileLoading ? (
                      <LoadingRows n={4} />
                    ) : (
                      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                        <Field label="Full Name" value={profile?.candidateName ?? student.candidateName} edit={editMode}>
                          <EditInput value={editForm.candidateName} onChange={(v) => setEditForm((p) => ({ ...p, candidateName: v }))} />
                        </Field>
                        <Field label="Date of Birth" value={profile?.dob ? new Date(profile.dob).toLocaleDateString("en-IN") : undefined} />
                        <Field label="Gender" value={profile?.gender} />
                        <Field label="Blood Group" value={profile?.bloodGroup} />
                        <Field label="Category" value={profile?.category} />
                        <Field label="Nationality" value={profile?.nationality} />
                        <Field label="Background" value={profile?.background} />
                        <Field label="Marital Status" value={profile?.maritalStatus} />
                        <Field label="Aadhaar No." value={profile?.aadhaarNo} />
                      </div>
                    )}
                  </Card>

                  <Card title="Contact Details" icon={Phone}>
                    {profileLoading ? (
                      <LoadingRows n={3} />
                    ) : (
                      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                        <Field label="Mobile" value={profile?.mobile} edit={editMode}>
                          <EditInput value={editForm.mobile} onChange={(v) => setEditForm((p) => ({ ...p, mobile: v }))} />
                        </Field>
                        <Field label="Email" value={profile?.email} edit={editMode}>
                          <EditInput value={editForm.email} onChange={(v) => setEditForm((p) => ({ ...p, email: v }))} />
                        </Field>
                        <Field label="Permanent Address" value={profile?.permanentAddress} edit={editMode}>
                          <EditInput value={editForm.permanentAddress} onChange={(v) => setEditForm((p) => ({ ...p, permanentAddress: v }))} multiline />
                        </Field>
                        <Field label="Mailing Address" value={profile?.mailingAddress} edit={editMode}>
                          <EditInput value={editForm.mailingAddress} onChange={(v) => setEditForm((p) => ({ ...p, mailingAddress: v }))} multiline />
                        </Field>
                      </div>
                    )}
                  </Card>

                  <Card title="Guardian Info" icon={User}>
                    {profileLoading ? (
                      <LoadingRows n={4} />
                    ) : (
                      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                        <Field label="Father Name" value={profile?.fatherName} edit={editMode}>
                          <EditInput value={editForm.fatherName} onChange={(v) => setEditForm((p) => ({ ...p, fatherName: v }))} />
                        </Field>
                        <Field label="Father Occupation" value={profile?.fatherOccupation} />
                        <Field label="Mother Name" value={profile?.motherName} edit={editMode}>
                          <EditInput value={editForm.motherName} onChange={(v) => setEditForm((p) => ({ ...p, motherName: v }))} />
                        </Field>
                        <Field label="Mother Occupation" value={profile?.motherOccupation} />
                        <Field label="Guardian Mobile" value={profile?.fatherMobile} edit={editMode}>
                          <EditInput value={editForm.fatherMobile} onChange={(v) => setEditForm((p) => ({ ...p, fatherMobile: v }))} />
                        </Field>
                      </div>
                    )}
                  </Card>
                </div>

                {/* Right column (1/3) */}
                <div className="space-y-4">
                  <Card title="Admission Details" icon={GraduationCap}>
                    <div className="space-y-4">
                      <Field label="Admission Number" value={student.admissionCode ?? `#${student.admissionNumber}`} />
                      <Field
                        label="Roll Number"
                        value={profile?.rollCode ?? (profile?.rollNumber ? `MTET/R${profile.rollNumber}` : undefined)}
                      />
                      <Field label="College" value={collegeName} />
                      <Field label="Status" value={student.status} />
                      <Field label="Admission Date" value={admission?.createdAt ? new Date(admission.createdAt).toLocaleDateString("en-IN") : undefined} />
                    </div>
                  </Card>

                  {/* Workflow steps */}
                  {workflow && (
                    <Card title="Status Timeline" icon={Clock}>
                      <div className="space-y-2">
                        {workflow.steps.map((step, i) => (
                          <div key={step.key} className="flex items-center gap-3">
                            <div
                              className={`h-6 w-6 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                                step.complete ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"
                              }`}
                            >
                              {step.complete ? "✓" : i + 1}
                            </div>
                            <span className={`text-sm ${step.complete ? "text-slate-800 font-medium" : "text-slate-400"}`}>
                              {step.label}
                            </span>
                          </div>
                        ))}
                        {workflow.notes && (
                          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">{workflow.notes}</p>
                        )}
                      </div>

                      {/* Workflow actions for managers */}
                      {canManageWorkflow && (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                          {getWorkflowActions(workflow).map((action) => (
                            <button
                              key={action.key}
                              type="button"
                              className={`rounded-xl px-3 py-1.5 text-xs font-medium ${action.cls} transition-colors`}
                              onClick={() => void onWorkflowAction(action.key)}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </Card>
                  )}
                </div>
              </div>
            )}

            {/* ── ACADEMIC ─────────────────────────────────────────────── */}
            {activeTab === "academic" && (
              <div className="grid gap-4 md:grid-cols-2">
                <Card title="Course & Session" icon={GraduationCap}>
                  {profileLoading ? (
                    <LoadingRows n={4} />
                  ) : (
                    <div className="space-y-4">
                      <Field label="Course" value={admission?.course?.name} />
                      <Field label="Session" value={admission?.session?.label} />
                      <Field label="Admission Type" value={admission?.admissionType} />
                      <Field label="Category / Quota" value={admission?.categoryQuota} />
                      <Field label="College" value={collegeName} />
                    </div>
                  )}
                </Card>

                <Card title="Academic Background" icon={FileText}>
                  {profileLoading ? (
                    <LoadingRows n={4} />
                  ) : (
                    <div className="space-y-4">
                      <Field
                        label="Previous Qualification"
                        value={
                          profile?.previousQualificationJson
                            ? formatQualification(profile.previousQualificationJson)
                            : undefined
                        }
                      />
                      <Field
                        label="University Enrollment No."
                        value={profile?.universityEnrollmentNumber}
                        edit={editMode}
                      >
                        <EditInput
                          value={editForm.universityEnrollmentNumber}
                          onChange={(v) => setEditForm((p) => ({ ...p, universityEnrollmentNumber: v }))}
                        />
                      </Field>
                      <Field
                        label="University Registration No."
                        value={profile?.universityRegistrationNumber}
                        edit={editMode}
                      >
                        <EditInput
                          value={editForm.universityRegistrationNumber}
                          onChange={(v) => setEditForm((p) => ({ ...p, universityRegistrationNumber: v }))}
                        />
                      </Field>
                    </div>
                  )}
                </Card>
              </div>
            )}

            {/* ── DOCUMENTS ────────────────────────────────────────────── */}
            {activeTab === "documents" && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">Uploaded Documents</h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {docsData?.documents.length ?? 0} documents on file
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setShowDocUpload((v) => !v)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
                      >
                        <Upload className="h-4 w-4" /> Upload Document
                      </button>
                    )}
                  </div>

                  {/* Upload form */}
                  <AnimatePresence>
                    {showDocUpload && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-b border-slate-100"
                      >
                        <div className="flex flex-wrap items-end gap-3 bg-slate-50 px-5 py-4">
                          <div className="flex-1 min-w-[200px]">
                            <label className="mb-1 block text-xs font-medium text-slate-600">Document Type</label>
                            <select
                              value={uploadDocType}
                              onChange={(e) => { setUploadDocType(e.target.value); setUploadDocTypeInput(""); }}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                            >
                              <option value="">— Custom type —</option>
                              {DOCUMENT_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </div>
                          {!uploadDocType && (
                            <div className="flex-1 min-w-[200px]">
                              <label className="mb-1 block text-xs font-medium text-slate-600">Custom Type Name</label>
                              <input
                                value={uploadDocTypeInput}
                                onChange={(e) => setUploadDocTypeInput(e.target.value)}
                                placeholder="e.g. Marksheet"
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                              />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => docInputRef.current?.click()}
                            disabled={uploadDocMutation.isPending}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                          >
                            <Upload className="h-4 w-4" />
                            {uploadDocMutation.isPending ? "Uploading…" : "Choose File"}
                          </button>
                          <input ref={docInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={handleDocFileSelect} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Documents table */}
                  {docsLoading ? (
                    <div className="px-5 py-8">
                      <LoadingRows n={3} />
                    </div>
                  ) : (docsData?.documents ?? []).length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-16 text-center">
                      <FileText className="h-10 w-10 text-slate-200" />
                      <p className="text-sm text-slate-500">No documents uploaded yet.</p>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setShowDocUpload(true)}
                          className="text-sm font-medium text-indigo-600 hover:underline"
                        >
                          Upload the first document
                        </button>
                      )}
                    </div>
                  ) : (
                    <table className="min-w-full divide-y divide-slate-100">
                      <thead>
                        <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                          <th className="px-5 py-3">Document Type</th>
                          <th className="px-5 py-3">File Name</th>
                          <th className="px-5 py-3">Size</th>
                          <th className="px-5 py-3">Uploaded</th>
                          <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {docsData!.documents.map((doc) => (
                          <tr key={doc.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-5 py-3">
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                                {doc.docType}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-sm text-slate-700 max-w-[200px] truncate">{doc.fileName}</td>
                            <td className="px-5 py-3 text-sm text-slate-500">
                              {doc.sizeBytes ? formatBytes(doc.sizeBytes) : "—"}
                            </td>
                            <td className="px-5 py-3 text-sm text-slate-500">
                              {new Date(doc.uploadedAt).toLocaleDateString("en-IN")}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <a
                                  href={studentsApi.getDocumentDownloadUrl(doc.documentId)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                                  title="View"
                                >
                                  <Eye className="h-4 w-4" />
                                </a>
                                {canEdit && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleReplaceDoc(doc)}
                                      className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                                      title="Replace"
                                    >
                                      <Upload className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteDoc(doc)}
                                      disabled={deleteDocMutation.isPending}
                                      className="rounded-xl p-2 text-rose-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 transition-colors"
                                      title="Delete"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* ── FINANCE ──────────────────────────────────────────────── */}
            {activeTab === "finance" && (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {[
                    { label: "Total Payable", value: student.totalPayable, color: "bg-slate-50 text-slate-800" },
                    { label: "Amount Paid", value: totalPaid, color: "bg-emerald-50 text-emerald-800" },
                    { label: "Pending Dues", value: pending, color: pending > 0 ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800" },
                  ].map((card) => (
                    <div key={card.label} className={`rounded-2xl border border-slate-100 p-5 ${card.color}`}>
                      <p className="text-xs font-medium uppercase tracking-wide opacity-60">{card.label}</p>
                      <p className="mt-1 text-2xl font-bold">
                        ₹ {card.value.toLocaleString("en-IN")}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Receipts */}
                <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h3 className="text-sm font-semibold text-slate-800">Payment History</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {historyData?.receipts.length ?? 0} receipts on record
                    </p>
                  </div>
                  {historyLoading ? (
                    <div className="px-5 py-6">
                      <LoadingRows n={3} />
                    </div>
                  ) : (historyData?.receipts ?? []).length === 0 ? (
                    <div className="py-16 text-center text-sm text-slate-500">No receipts recorded yet.</div>
                  ) : (
                    <table className="min-w-full divide-y divide-slate-100">
                      <thead>
                        <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                          <th className="px-5 py-3">Receipt No.</th>
                          <th className="px-5 py-3">Fee Cycle</th>
                          <th className="px-5 py-3">Amount</th>
                          <th className="px-5 py-3">Late Fine</th>
                          <th className="px-5 py-3">Total</th>
                          <th className="px-5 py-3">Mode</th>
                          <th className="px-5 py-3">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {historyData!.receipts.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-5 py-3 font-medium text-slate-800">{r.receiptNumber}</td>
                            <td className="px-5 py-3 text-slate-600">{r.cycleLabel ?? "—"}</td>
                            <td className="px-5 py-3 text-slate-700">₹ {r.amount.toLocaleString("en-IN")}</td>
                            <td className="px-5 py-3 text-slate-700">₹ {r.lateFine.toLocaleString("en-IN")}</td>
                            <td className="px-5 py-3 font-semibold text-slate-900">₹ {r.totalReceived.toLocaleString("en-IN")}</td>
                            <td className="px-5 py-3 text-slate-600">{r.paymentMode ?? "—"}</td>
                            <td className="px-5 py-3 text-slate-500">
                              {new Date(r.collectedAt).toLocaleDateString("en-IN")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* ── ACTIVITY ─────────────────────────────────────────────── */}
            {activeTab === "activity" && (
              <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3 className="text-sm font-semibold text-slate-800">Timeline</h3>
                  <p className="mt-0.5 text-xs text-slate-500">All events and audit actions merged by time</p>
                </div>
                {historyLoading ? (
                  <div className="px-5 py-6">
                    <LoadingRows n={5} />
                  </div>
                ) : activityItems.length === 0 ? (
                  <div className="py-16 text-center text-sm text-slate-500">No activity recorded yet.</div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {activityItems.map((item) => (
                      <div key={item.id} className="flex items-start gap-4 px-5 py-4">
                        <div
                          className={`mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                            item.kind === "audit" ? "bg-indigo-400" : "bg-emerald-400"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800">{item.title}</p>
                          <p className="mt-0.5 text-xs text-slate-500 truncate">{item.desc}</p>
                        </div>
                        <time className="flex-shrink-0 text-xs text-slate-400">
                          {new Date(item.at).toLocaleString("en-IN", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                        </time>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Overlay close for more menu */}
      {moreOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function LoadingRows({ n }: { n: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-6 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatQualification(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const q = raw as Record<string, string>;
    return [q.qualification, q.board, q.passingYear, q.marksPercentage ? `${q.marksPercentage}%` : ""]
      .filter(Boolean)
      .join(" · ");
  }
  return "";
}

function getWorkflowActions(workflow: {
  status: string;
  steps: Array<{ key: string; complete: boolean }>;
}) {
  const docsDone = workflow.steps.find((s) => s.key === "DOCUMENTS_VERIFIED")?.complete ?? false;
  const feesDone = workflow.steps.find((s) => s.key === "FEE_VERIFIED")?.complete ?? false;
  const status = workflow.status;

  const actions: Array<{ key: string; label: string; cls: string }> = [];

  if (!docsDone) actions.push({ key: "VERIFY_DOCUMENTS", label: "Verify Documents", cls: "bg-blue-600 text-white hover:bg-blue-700" });
  if (!feesDone) actions.push({ key: "VERIFY_FEES", label: "Verify Fees", cls: "bg-indigo-600 text-white hover:bg-indigo-700" });
  if (["SUBMITTED", "DOCUMENTS_VERIFIED", "FEE_VERIFIED", "CHANGES_REQUESTED"].includes(status)) {
    actions.push({ key: "SEND_FOR_APPROVAL", label: "Send for Approval", cls: "bg-slate-700 text-white hover:bg-slate-800" });
  }
  if (status === "PENDING_APPROVAL") {
    actions.push({ key: "APPROVE", label: "Approve", cls: "bg-emerald-600 text-white hover:bg-emerald-700" });
    actions.push({ key: "REJECT", label: "Reject", cls: "bg-rose-600 text-white hover:bg-rose-700" });
  }

  return actions;
}

const DOCUMENT_TYPES = [
  "Aadhaar Card",
  "Birth Certificate",
  "Caste Certificate",
  "Character Certificate",
  "Income Certificate",
  "Marksheet (10th)",
  "Marksheet (12th)",
  "Migration Certificate",
  "Passport Photo",
  "Transfer Certificate",
];
