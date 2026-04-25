import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles, UserPlus2, Filter, Download, Columns3, BadgeCheck, ChevronRight, History, ChevronDown, Printer, FileText } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { hasPermission } from "../../lib/permissions";
import { exportRowsToCsv, loadSavedPresets, removeSavedPreset, type SavedPreset, upsertSavedPreset } from "../../lib/viewPresets";
import { api } from "../../services/api";

type College = {
  id: string;
  name: string;
  courses: Array<{
    id: string;
    name: string;
    sessions: Array<{ id: string; label: string; seatCount?: number; sessionFee?: number }>;
  }>;
};

type Student = {
  id: string;
  candidateName: string;
  admissionNumber: number;
  admissionCode?: string;
  status: string;
  totalPayable: number;
  collegeId: string;
  admissions?: Array<{ courseId: string; sessionId: string; createdAt?: string }>;
};

type StudentFilterPresetValues = {
  query: string;
  statusFilter: string;
  savedView: string;
  selectedCollegeFilter: string;
  selectedCourseFilter: string;
  selectedSessionFilter: string;
};

const STUDENT_FILTER_PRESET_KEY = "campusgrid_students_filter_presets_v1";

type SubmittedAdmissionData = {
  id: string;
  admissionNumber: number;
  admissionCode?: string;
  candidateName: string;
  formSnapshot: WizardFormData;
  collegeName: string;
  courseName: string;
  sessionLabel: string;
  feePayable: number;
  submittedAt: string;
};

type Props = {
  colleges: College[];
  students: Student[];
  trustName?: string;
  loading: boolean;
  permissions: string[];
  onCreateAdmission: (payload: Record<string, unknown>) => Promise<{ id: string; admissionNumber: number; admissionCode?: string; candidateName: string } | void>;
  onDeleteStudent: (studentId: string) => Promise<void>;
  onRefreshStudents: () => Promise<void>;
};

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
type DetailTab = "complete" | "fees" | "documents" | "audit";
type ProfileMode = "directory" | "view" | "edit";

type WizardFormData = {
  // Step 1: Academic Mapping
  collegeId: string;
  courseId: string;
  sessionId: string;
  admissionType: "NEW" | "LATERAL" | "TRANSFER";
  categoryQuota: string;
  // Step 2: Student Profile
  candidateName: string;
  dob: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  nationality: string;
  maritalStatus: string;
  category: string;
  background: "URBAN" | "RURAL";
  bloodGroup: string;
  aadhaarNo: string;
  previousQualification: string;
  board: string;
  passingYear: string;
  marksPercentage: string;
  postalVillageCity: string;
  postalPostOffice: string;
  postalPoliceStation: string;
  postalDistrict: string;
  postalState: string;
  postalPinCode: string;
  permanentAddress: string;
  sameAsPostalAddress: boolean;
  // Step 3: Guardian Details
  fatherName: string;
  fatherOccupation: string;
  fatherAnnualIncome: string;
  motherName: string;
  motherOccupation: string;
  guardianName: string;
  mobile: string;
  alternateMobile: string;
  email: string;
  sameWhatsApp: boolean;
  guardianAddress: string;
  // Step 4: Documents
  documents: Array<{ type: string; file: File | null; status: "uploaded" | "missing" }>;
  // Step 5: Fee Payable
  discountAmount: string;
  scholarshipAmount: string;
  // Step 6: Review & Submit - computed fields
};
type HistoryTab = "activity" | "audit" | "changes" | "approvals" | "notes";

type StudentWorkflowResponse = {
  student: {
    id: string;
    candidateName: string;
    admissionNumber: number;
    admissionCode?: string;
    status: string;
    totalPayable: number;
  };
  workflow: {
    admissionId: string;
    status: string;
    notes: string | null;
    workflowUpdatedAt: string;
    steps: Array<{ key: string; label: string; complete: boolean }>;
  };
};

type StudentHistoryResponse = {
  timeline: Array<{ id: string; title: string; details: string; createdAt: string }>;
  audit: Array<{ id: string; action: string; entityType: string; entityId?: string | null; metadata?: unknown; createdAt: string; actor?: { id: string; email: string } | null }>;
  receipts: Array<{ id: string; receiptNumber: string; cycleKey?: string | null; cycleLabel?: string | null; amount: number; lateFine: number; totalReceived: number; paymentMode?: string | null; referenceNumber?: string | null; collectedBy?: string | null; collectedAt: string }>;
  workflow: StudentWorkflowResponse["workflow"] | null;
};

type StudentPrintablesResponse = {
  student: {
    id: string;
    candidateName: string;
    admissionNumber: number;
    admissionCode?: string;
    status: string;
    totalPayable: number;
    collegeId: string;
    fatherName?: string;
    motherName?: string;
    rollNumber?: number;
    rollCode?: string;
    fatherMobile?: string;
    mobile?: string;
    email?: string;
    dob?: string;
    gender?: string;
    nationality?: string;
    maritalStatus?: string | null;
    bloodGroup?: string | null;
    category?: string | null;
    background?: string | null;
    previousQualificationJson?: unknown;
    permanentAddress?: string;
    mailingAddress?: string;
    admissions?: Array<{
      id: string;
      createdAt?: string;
      declarationDate?: string;
      declarationText?: string;
      course?: { id: string; name: string };
      session?: { id: string; label: string; startYear: number; endYear: number };
    }>;
  };
  availableDocuments: string[];
};

type StudentEditForm = {
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

export function StudentsPage({ colleges, students, loading, permissions, onCreateAdmission, onDeleteStudent, onRefreshStudents }: Props) {
  const canCreateAdmission = hasPermission(permissions, "STUDENTS_WRITE");
  const canManageWorkflow = hasPermission(permissions, "ADMISSIONS_APPROVE");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [savedView, setSavedView] = useState("all");
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [savedPresets, setSavedPresets] = useState<Array<SavedPreset<StudentFilterPresetValues>>>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [step, setStep] = useState<WizardStep>(1);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [profileMode, setProfileMode] = useState<ProfileMode>("directory");
  const [detailTab, setDetailTab] = useState<DetailTab>("complete");
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<HistoryTab>("activity");
  const [selectedCollegeFilter, setSelectedCollegeFilter] = useState("ALL");
  const [selectedCourseFilter, setSelectedCourseFilter] = useState("ALL");
  const [selectedSessionFilter, setSelectedSessionFilter] = useState("ALL");
  const [workflowData, setWorkflowData] = useState<StudentWorkflowResponse | null>(null);
  const [historyData, setHistoryData] = useState<StudentHistoryResponse | null>(null);
  const [studentProfileData, setStudentProfileData] = useState<StudentPrintablesResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editProfileSaving, setEditProfileSaving] = useState(false);
  const [editProfileForm, setEditProfileForm] = useState<StudentEditForm>({
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
  const [submittedAdmission, setSubmittedAdmission] = useState<SubmittedAdmissionData | null>(null);
  const [showAdmissionPrint, setShowAdmissionPrint] = useState(false);
  const [wizardForm, setWizardForm] = useState<WizardFormData>({
    collegeId: "",
    courseId: "",
    sessionId: "",
    admissionType: "NEW",
    categoryQuota: "",
    candidateName: "",
    dob: "",
    gender: "MALE",
    nationality: "Indian",
    maritalStatus: "",
    category: "",
    background: "URBAN",
    bloodGroup: "",
    aadhaarNo: "",
    previousQualification: "",
    board: "",
    passingYear: "",
    marksPercentage: "",
    postalVillageCity: "",
    postalPostOffice: "",
    postalPoliceStation: "",
    postalDistrict: "",
    postalState: "",
    postalPinCode: "",
    permanentAddress: "",
    sameAsPostalAddress: false,
    fatherName: "",
    fatherOccupation: "",
    fatherAnnualIncome: "",
    motherName: "",
    motherOccupation: "",
    guardianName: "",
    mobile: "",
    alternateMobile: "",
    email: "",
    sameWhatsApp: false,
    guardianAddress: "",
    documents: [{ type: "", file: null, status: "missing" }],
    discountAmount: "0",
    scholarshipAmount: "0",
  });

  const collegeById = useMemo(() => Object.fromEntries(colleges.map((college) => [college.id, college])), [colleges]);
  const courseNameById = useMemo(
    () => Object.fromEntries(colleges.flatMap((college) => college.courses.map((course) => [course.id, course.name]))),
    [colleges]
  );
  const courseCollegeById = useMemo(
    () => Object.fromEntries(colleges.flatMap((college) => college.courses.map((course) => [course.id, college.id]))),
    [colleges]
  );
  const sessionNameById = useMemo(
    () =>
      Object.fromEntries(
        colleges.flatMap((college) => college.courses.flatMap((course) => course.sessions.map((session) => [session.id, session.label])))
      ),
    [colleges]
  );
  const sessionFeeById = useMemo(
    () =>
      Object.fromEntries(
        colleges.flatMap((college) => college.courses.flatMap((course) => course.sessions.map((session) => [session.id, session.sessionFee ?? 0])))
      ),
    [colleges]
  );
  const sessionSeatById = useMemo(
    () =>
      Object.fromEntries(
        colleges.flatMap((college) => college.courses.flatMap((course) => course.sessions.map((session) => [session.id, session.seatCount ?? 0])))
      ),
    [colleges]
  );

  const wizardCollege = useMemo(() => colleges.find((college) => college.id === wizardForm.collegeId) ?? null, [colleges, wizardForm.collegeId]);
  const wizardCourse = useMemo(() => wizardCollege?.courses.find((course) => course.id === wizardForm.courseId) ?? null, [wizardCollege, wizardForm.courseId]);
  const wizardSession = useMemo(() => wizardCourse?.sessions.find((session) => session.id === wizardForm.sessionId) ?? null, [wizardCourse, wizardForm.sessionId]);

  const wizardFormUpdate = (updates: Partial<WizardFormData>) => {
    setWizardForm((prev) => ({ ...prev, ...updates }));
  };

  const calculateAge = (dob: string): number | null => {
    if (!dob) return null;
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const normalizeUpperName = (value: string) => value.toUpperCase().trimStart();
  const composePostalAddress = (form: WizardFormData) =>
    [
      form.postalVillageCity,
      form.postalPostOffice,
      form.postalPoliceStation,
      form.postalDistrict,
      form.postalState,
      form.postalPinCode,
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ");

  const calculateFeePayable = (): number => {
    const sessionFee = sessionFeeById[wizardForm.sessionId] ?? 0;
    const discount = Number(wizardForm.discountAmount) || 0;
    const scholarship = Number(wizardForm.scholarshipAmount) || 0;
    return Math.max(0, sessionFee - discount - scholarship);
  };

  const generateRollNumber = (admissionNumber: number, sessionLabel: string): string => {
    const year = sessionLabel ? sessionLabel.split("-")[0] ?? new Date().getFullYear().toString() : new Date().getFullYear().toString();
    return `${year}${String(admissionNumber).padStart(4, "0")}`;
  };

  const admissionFormHtml = (
    admNo: number,
    admCode: string | undefined,
    name: string,
    collegeName: string,
    courseName: string,
    sessionLabel: string,
    form: Partial<WizardFormData>,
    feePayable: number,
    submittedAt?: string
  ) => {
    const rollNo = generateRollNumber(admNo, sessionLabel);
    const admDate = submittedAt ? new Date(submittedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    const blank = (val?: string) => val && val.trim() ? val : "___________________________";
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Admission Form - ${name || "Blank"}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #0f172a; padding: 28px 36px; }
    h1 { font-size: 18px; text-align: center; font-weight: bold; margin-bottom: 2px; }
    h2 { font-size: 14px; text-align: center; font-weight: normal; margin-bottom: 4px; color: #334155; }
    .subtitle { text-align: center; font-size: 11px; color: #64748b; margin-bottom: 16px; }
    .header-bar { display: flex; justify-content: space-between; align-items: flex-start; border-top: 2px solid #0f172a; border-bottom: 1px solid #0f172a; padding: 8px 0; margin-bottom: 14px; }
    .header-bar .field { font-size: 11px; }
    .header-bar .field span { font-weight: bold; }
    .photo-box { width: 90px; height: 110px; border: 1px solid #94a3b8; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #94a3b8; text-align: center; margin-left: 16px; flex-shrink: 0; }
    section { margin-bottom: 12px; }
    section h3 { font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.06em; background: #f1f5f9; padding: 4px 8px; border-left: 3px solid #0f172a; margin-bottom: 8px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
    .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 24px; }
    .field-row { margin-bottom: 6px; }
    .field-row label { font-size: 10px; color: #64748b; display: block; margin-bottom: 1px; }
    .field-row .val { font-weight: 600; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; min-height: 18px; font-size: 12px; }
    .full-width { grid-column: 1 / -1; }
    .fee-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    .fee-table th, .fee-table td { border: 1px solid #cbd5e1; padding: 5px 8px; font-size: 11px; }
    .fee-table th { background: #f8fafc; font-weight: bold; text-align: left; }
    .declaration { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 12px; margin-bottom: 12px; font-size: 11px; line-height: 1.7; }
    .signature-row { display: flex; justify-content: space-between; margin-top: 28px; }
    .signature-box { text-align: center; width: 160px; }
    .signature-box .line { border-top: 1px solid #0f172a; margin-bottom: 4px; }
    .signature-box label { font-size: 10px; color: #64748b; }
    .page-break { page-break-before: always; }
    @media print { body { padding: 10px 20px; } }
  </style>
</head>
<body>
  <!-- ===== PAGE 1: ADMISSION FORM ===== -->
  <h1>MOTHER TERESA EDUCATIONAL TRUST</h1>
  <h2>${collegeName || "College Name"}</h2>
  <p class="subtitle">Affiliated to NCVT / State Board &nbsp;|&nbsp; Application for Admission</p>

  <div class="header-bar">
    <div style="flex:1;">
      <div class="field" style="margin-bottom:6px;">Admission No.: <span>${admCode ?? `ADM-${String(admNo).padStart(4, "0")}`}</span></div>
      <div class="field" style="margin-bottom:6px;">Roll No.: <span>${rollNo}</span></div>
      <div class="field" style="margin-bottom:6px;">Date of Admission: <span>${admDate}</span></div>
      <div class="field" style="margin-bottom:6px;">Course: <span>${blank(courseName)}</span></div>
      <div class="field">Session: <span>${blank(sessionLabel)}</span></div>
    </div>
    <div class="photo-box">Paste<br/>Passport<br/>Photo</div>
  </div>

  <section>
    <h3>Personal Information</h3>
    <div class="grid2">
      <div class="field-row full-width"><label>Candidate Name (in BLOCK letters)</label><div class="val">${blank(name)}</div></div>
      <div class="field-row"><label>Date of Birth</label><div class="val">${blank(form.dob)}</div></div>
      <div class="field-row"><label>Gender</label><div class="val">${blank(form.gender)}</div></div>
      <div class="field-row"><label>Nationality</label><div class="val">${blank(form.nationality)}</div></div>
      <div class="field-row"><label>Blood Group</label><div class="val">${blank(form.bloodGroup)}</div></div>
      <div class="field-row"><label>Category</label><div class="val">${blank(form.category)}</div></div>
      <div class="field-row"><label>Category / Quota</label><div class="val">${blank(form.categoryQuota)}</div></div>
      <div class="field-row"><label>Aadhaar No.</label><div class="val">${blank(form.aadhaarNo)}</div></div>
      <div class="field-row"><label>Email</label><div class="val">${blank(form.email)}</div></div>
      <div class="field-row full-width"><label>Postal Address</label><div class="val">${blank(form.postalVillageCity ? [form.postalVillageCity, form.postalPostOffice, form.postalPoliceStation, form.postalDistrict, form.postalState, form.postalPinCode].filter(Boolean).join(", ") : "")}</div></div>
      <div class="field-row full-width"><label>Permanent Address</label><div class="val">${blank(form.permanentAddress)}</div></div>
    </div>
  </section>

  <section>
    <h3>Academic Background</h3>
    <div class="grid3">
      <div class="field-row"><label>Last Qualification</label><div class="val">${blank(form.previousQualification)}</div></div>
      <div class="field-row"><label>Board / University</label><div class="val">${blank(form.board)}</div></div>
      <div class="field-row"><label>Passing Year</label><div class="val">${blank(form.passingYear)}</div></div>
      <div class="field-row"><label>Marks %</label><div class="val">${blank(form.marksPercentage)}</div></div>
    </div>
  </section>

  <section>
    <h3>Guardian / Family Details</h3>
    <div class="grid2">
      <div class="field-row"><label>Father's Name</label><div class="val">${blank(form.fatherName)}</div></div>
      <div class="field-row"><label>Father's Occupation</label><div class="val">${blank(form.fatherOccupation)}</div></div>
      <div class="field-row"><label>Father's Annual Income</label><div class="val">${form.fatherAnnualIncome ? "₹ " + Number(form.fatherAnnualIncome).toLocaleString() : "___________________________"}</div></div>
      <div class="field-row"><label>Mother's Name</label><div class="val">${blank(form.motherName)}</div></div>
      <div class="field-row"><label>Mother's Occupation</label><div class="val">${blank(form.motherOccupation)}</div></div>
      <div class="field-row"><label>Mobile No.</label><div class="val">${blank(form.mobile)}</div></div>
      <div class="field-row"><label>Alternate Mobile</label><div class="val">${blank(form.alternateMobile)}</div></div>
    </div>
  </section>

  <section>
    <h3>Fee Summary</h3>
    <table class="fee-table">
      <thead><tr><th>Description</th><th>Amount (₹)</th></tr></thead>
      <tbody>
        <tr><td>Course Fee (Annual)</td><td>${feePayable > 0 ? (feePayable + (Number(form.discountAmount)||0) + (Number(form.scholarshipAmount)||0)).toLocaleString() : "_______________"}</td></tr>
        <tr><td>Discount</td><td>${form.discountAmount && Number(form.discountAmount) > 0 ? Number(form.discountAmount).toLocaleString() : "—"}</td></tr>
        <tr><td>Scholarship</td><td>${form.scholarshipAmount && Number(form.scholarshipAmount) > 0 ? Number(form.scholarshipAmount).toLocaleString() : "—"}</td></tr>
        <tr><td><strong>Total Fee Payable</strong></td><td><strong>${feePayable > 0 ? feePayable.toLocaleString() : "_______________"}</strong></td></tr>
      </tbody>
    </table>
  </section>

  <!-- ===== PAGE 2: DECLARATION / AFFIDAVIT ===== -->
  <div class="page-break"></div>

  <h1>MOTHER TERESA EDUCATIONAL TRUST</h1>
  <h2>${collegeName || "College Name"}</h2>
  <p class="subtitle">Declaration &amp; Affidavit by Student / Guardian</p>
  <br/>

  <div class="declaration">
    <p><strong>I, ${blank(name)}</strong>, son/daughter of <strong>${blank(form.fatherName)}</strong>, hereby solemnly affirm and declare as follows:</p>
    <br/>
    <ol style="padding-left:18px;line-height:2;">
      <li>I have read and understood all the rules and regulations of <strong>${collegeName || "the College"}</strong> and agree to abide by them throughout my period of study.</li>
      <li>The information furnished in this admission form is true and correct to the best of my knowledge and belief. If any information is found to be false or misleading, my admission shall be liable to cancellation without prior notice.</li>
      <li>I shall maintain discipline and decorum within the college campus and follow all instructions issued by the college administration from time to time.</li>
      <li>I understand that my admission is provisional and subject to verification of original documents. I shall submit all required documents within the stipulated time.</li>
      <li>I shall not indulge in any anti-social, unlawful, or ragging-related activities. I am aware that such acts are punishable under the law and college norms.</li>
      <li>I agree to pay all dues (tuition fees, exam fees, and other charges) within the prescribed schedule. Non-payment may lead to suspension from classes or cancellation of admission.</li>
      <li>I authorise the college to share my academic and contact information with concerned boards, affiliating bodies, and government authorities as required.</li>
      <li>My parent / guardian has duly consented to my admission and has verified all the details mentioned in this form.</li>
    </ol>
    <br/>
    <p>I / We make this declaration consciously and voluntarily, fully knowing the consequences thereof.</p>
  </div>

  <div class="signature-row">
    <div class="signature-box">
      <div class="line"></div>
      <label>Signature of Student<br/>${blank(name)}</label>
    </div>
    <div class="signature-box">
      <div class="line"></div>
      <label>Signature of Parent/Guardian<br/>${blank(form.fatherName)}</label>
    </div>
    <div class="signature-box">
      <div class="line"></div>
      <label>Signature of Principal<br/>with Office Seal</label>
    </div>
  </div>

  <br/><br/>
  <p style="font-size:10px;color:#94a3b8;text-align:center;">Generated by CampusGrid ERP &nbsp;|&nbsp; ${new Date().toLocaleString("en-IN")} &nbsp;|&nbsp; Admission No.: ${admCode ?? `ADM-${String(admNo).padStart(4, "0")}`} &nbsp;|&nbsp; Roll No.: ${rollNo}</p>
</body>
</html>`;
  };

  const printFilledAdmissionForm = (student: Student, collegeName: string, courseName: string, sessionLabel: string) => {
    const popup = window.open("", "_blank", "width=900,height=1000");
    if (!popup) { toast.error("Popup blocked. Please allow popups."); return; }
    const html = admissionFormHtml(student.admissionNumber, student.admissionCode, student.candidateName, collegeName, courseName, sessionLabel, {}, 0);
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const printBlankAdmissionForm = () => {
    const popup = window.open("", "_blank", "width=900,height=1000");
    if (!popup) { toast.error("Popup blocked. Please allow popups."); return; }
    const firstCollege = colleges[0];
    const html = admissionFormHtml(0, undefined, "", firstCollege?.name ?? "College Name", "", "", {}, 0);
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const wizardStepLabels: Record<WizardStep, string> = {
    1: "Academic Mapping",
    2: "Student Profile",
    3: "Guardian Details",
    4: "Documents",
    5: "Fee Payable",
    6: "Review & Submit",
  };

  const addWizardDocumentRow = () => {
    setWizardForm((prev) => ({
      ...prev,
      documents: [...prev.documents, { type: "", file: null, status: "missing" }],
    }));
  };

  const updateWizardDocumentName = (index: number, type: string) => {
    setWizardForm((prev) => ({
      ...prev,
      documents: prev.documents.map((doc, i) => (i === index ? { ...doc, type } : doc)),
    }));
  };

  const attachWizardDocument = (index: number, file: File | null) => {
    setWizardForm((prev) => ({
      ...prev,
      documents: prev.documents.map((doc, i) => (i === index ? { ...doc, file, status: file ? "uploaded" : "missing" } : doc)),
    }));
  };

  const removeWizardDocumentRow = (index: number) => {
    setWizardForm((prev) => {
      const nextDocs = prev.documents.filter((_, i) => i !== index);
      return {
        ...prev,
        documents: nextDocs.length ? nextDocs : [{ type: "", file: null, status: "missing" }],
      };
    });
  };

  const latestAdmissionByStudentId = useMemo(() => {
    const map = new Map<string, { courseId: string; sessionId: string; createdAt?: string }>();
    for (const student of students) {
      const admissions = student.admissions ?? [];
      if (!admissions.length) {
        continue;
      }

      const latest = admissions.reduce((best, current) => {
        if (!best) return current;
        return new Date(current.createdAt ?? 0).getTime() > new Date(best.createdAt ?? 0).getTime() ? current : best;
      }, admissions[0]);
      map.set(student.id, latest);
    }
    return map;
  }, [students]);

  const courseOptions = useMemo(() => {
    if (selectedCollegeFilter === "ALL") {
      return colleges.flatMap((college) => college.courses.map((course) => ({ id: course.id, name: course.name })));
    }

    const college = colleges.find((item) => item.id === selectedCollegeFilter);
    return (college?.courses ?? []).map((course) => ({ id: course.id, name: course.name }));
  }, [colleges, selectedCollegeFilter]);

  const sessionOptions = useMemo(() => {
    if (selectedCourseFilter !== "ALL") {
      for (const college of colleges) {
        const course = college.courses.find((item) => item.id === selectedCourseFilter);
        if (course) {
          return course.sessions.map((session) => ({ id: session.id, label: session.label }));
        }
      }
      return [];
    }

    if (selectedCollegeFilter !== "ALL") {
      const college = colleges.find((item) => item.id === selectedCollegeFilter);
      return (college?.courses ?? []).flatMap((course) => course.sessions.map((session) => ({ id: session.id, label: session.label })));
    }

    return colleges.flatMap((college) =>
      college.courses.flatMap((course) => course.sessions.map((session) => ({ id: session.id, label: session.label })))
    );
  }, [colleges, selectedCollegeFilter, selectedCourseFilter]);

  const filtered = useMemo(() => {
    return students
      .filter((s) => (statusFilter === "ALL" ? true : s.status === statusFilter))
      .filter((s) => {
        if (savedView === "defaulters") return s.totalPayable > 0;
        if (savedView === "pending") return s.status !== "ACTIVE";
        if (savedView === "dropouts") return s.status === "DROP_OUT";
        return true;
      })
      .filter((s) => {
        const latestAdmission = latestAdmissionByStudentId.get(s.id);
        const mappedCollegeId = latestAdmission?.courseId ? courseCollegeById[latestAdmission.courseId] : s.collegeId;

        if (selectedCollegeFilter !== "ALL" && mappedCollegeId !== selectedCollegeFilter) return false;
        if (selectedCourseFilter !== "ALL" && latestAdmission?.courseId !== selectedCourseFilter) return false;
        if (selectedSessionFilter !== "ALL" && latestAdmission?.sessionId !== selectedSessionFilter) return false;
        return true;
      })
      .filter((s) => s.candidateName.toLowerCase().includes(query.toLowerCase()) || String(s.admissionNumber).includes(query) || (s.admissionCode ?? "").toLowerCase().includes(query.toLowerCase()));
  }, [students, statusFilter, query, savedView, latestAdmissionByStudentId, courseCollegeById, selectedCollegeFilter, selectedCourseFilter, selectedSessionFilter]);

  useEffect(() => {
    setSavedPresets(loadSavedPresets<StudentFilterPresetValues>(STUDENT_FILTER_PRESET_KEY));
  }, []);

  function applyPreset(preset: SavedPreset<StudentFilterPresetValues>) {
    setQuery(preset.values.query);
    setStatusFilter(preset.values.statusFilter);
    setSavedView(preset.values.savedView);
    setSelectedCollegeFilter(preset.values.selectedCollegeFilter);
    setSelectedCourseFilter(preset.values.selectedCourseFilter);
    setSelectedSessionFilter(preset.values.selectedSessionFilter);
  }

  function saveCurrentPreset() {
    const name = presetName.trim();
    if (!name) {
      toast.error("Preset name is required.");
      return;
    }

    const next = upsertSavedPreset<StudentFilterPresetValues>(STUDENT_FILTER_PRESET_KEY, name, {
      query,
      statusFilter,
      savedView,
      selectedCollegeFilter,
      selectedCourseFilter,
      selectedSessionFilter,
    });

    setSavedPresets(next);
    setPresetName("");
    toast.success("Student filter preset saved.");
  }

  function deleteSelectedPreset() {
    if (!selectedPresetId) {
      return;
    }

    const next = removeSavedPreset<StudentFilterPresetValues>(STUDENT_FILTER_PRESET_KEY, selectedPresetId);
    setSavedPresets(next);
    setSelectedPresetId("");
    toast.success("Student preset deleted.");
  }

  function exportFilteredStudents() {
    exportRowsToCsv(
      `students-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Admission No", "Admission Code", "Student", "Status", "College", "Course", "Session", "Total Payable"],
      filtered.map((student) => {
        const latestAdmission = latestAdmissionByStudentId.get(student.id);
        const collegeId = latestAdmission?.courseId ? courseCollegeById[latestAdmission.courseId] : student.collegeId;
        return [
          String(student.admissionNumber),
          student.admissionCode ?? "",
          student.candidateName,
          student.status,
          collegeById[collegeId]?.name ?? "",
          latestAdmission?.courseId ? courseNameById[latestAdmission.courseId] ?? "" : "",
          latestAdmission?.sessionId ? sessionNameById[latestAdmission.sessionId] ?? "" : "",
          String(student.totalPayable ?? 0),
        ];
      })
    );
  }

  useEffect(() => {
    if (!filtered.length) {
      setSelectedStudentId(null);
      return;
    }

    if (!selectedStudentId || !filtered.some((student) => student.id === selectedStudentId)) {
      setSelectedStudentId(filtered[0].id);
    }
  }, [filtered, selectedStudentId]);

  useEffect(() => {
    if (!colleges.length) {
      setWizardForm((prev) => ({ ...prev, collegeId: "", courseId: "", sessionId: "" }));
      return;
    }

    if (!wizardForm.collegeId || !colleges.some((college) => college.id === wizardForm.collegeId)) {
      setWizardForm((prev) => ({ ...prev, collegeId: colleges[0].id, courseId: "", sessionId: "" }));
    }
  }, [colleges, wizardForm.collegeId]);

  useEffect(() => {
    if (!wizardCollege?.courses.length) {
      setWizardForm((prev) => ({ ...prev, courseId: "", sessionId: "" }));
      return;
    }

    if (!wizardForm.courseId || !wizardCollege.courses.some((course) => course.id === wizardForm.courseId)) {
      setWizardForm((prev) => ({ ...prev, courseId: wizardCollege.courses[0].id, sessionId: "" }));
    }
  }, [wizardCollege, wizardForm.courseId]);

  useEffect(() => {
    if (!wizardCourse?.sessions.length) {
      setWizardForm((prev) => ({ ...prev, sessionId: "" }));
      return;
    }

    if (!wizardForm.sessionId || !wizardCourse.sessions.some((session) => session.id === wizardForm.sessionId)) {
      setWizardForm((prev) => ({ ...prev, sessionId: wizardCourse.sessions[0].id }));
    }
  }, [wizardCourse, wizardForm.sessionId]);

  useEffect(() => {
    if (!selectedStudentId) {
      setWorkflowData(null);
      setHistoryData(null);
      setStudentProfileData(null);
      return;
    }

    let cancelled = false;

    async function loadStudentWorkspace(initialLoad: boolean) {
      if (initialLoad) {
        setDetailLoading(true);
      }

      try {
        const [workflowRes, historyRes, profileRes] = await Promise.all([
          api.get<StudentWorkflowResponse>(`/students/${selectedStudentId}/workflow`),
          api.get<StudentHistoryResponse>(`/students/${selectedStudentId}/history`),
          api.get<StudentPrintablesResponse>(`/students/${selectedStudentId}/printables`),
        ]);

        if (cancelled) {
          return;
        }

        setWorkflowData(workflowRes.data);
        setHistoryData(historyRes.data);
        setStudentProfileData(profileRes.data);
      } catch (error) {
        if (!cancelled && initialLoad) {
          console.error(error);
          toast.error("Unable to load student workflow details.");
        }
      } finally {
        if (!cancelled && initialLoad) {
          setDetailLoading(false);
        }
      }
    }

    void loadStudentWorkspace(true);

    const intervalId = window.setInterval(() => {
      void loadStudentWorkspace(false);
    }, 20000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedStudentId]);

  const selectedStudent = useMemo(() => filtered.find((student) => student.id === selectedStudentId) ?? null, [filtered, selectedStudentId]);
  const selectedAdmissionDetails = studentProfileData?.student.admissions?.[0] ?? null;
  const recentTimeline = useMemo(
    () =>
      [...(historyData?.timeline ?? [])]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 12),
    [historyData]
  );

  async function removeStudent() {
    if (!selectedStudent) {
      return;
    }

    if (!window.confirm(`Delete student ${selectedStudent.candidateName}? This will mark the record as deleted.`)) {
      return;
    }

    try {
      await onDeleteStudent(selectedStudent.id);
      setSelectedRows((prev) => prev.filter((id) => id !== selectedStudent.id));
      setSelectedStudentId(null);
    } catch (error) {
      console.error(error);
      toast.error("Unable to delete student right now.");
    }
  }

  useEffect(() => {
    if (selectedCourseFilter === "ALL") {
      return;
    }

    if (!courseOptions.some((course) => course.id === selectedCourseFilter)) {
      setSelectedCourseFilter("ALL");
    }
  }, [courseOptions, selectedCourseFilter]);

  useEffect(() => {
    if (selectedSessionFilter === "ALL") {
      return;
    }

    if (!sessionOptions.some((session) => session.id === selectedSessionFilter)) {
      setSelectedSessionFilter("ALL");
    }
  }, [sessionOptions, selectedSessionFilter]);

  useEffect(() => {
    if (!wizardForm.sameAsPostalAddress) {
      return;
    }

    setWizardForm((prev) => ({ ...prev, permanentAddress: composePostalAddress(prev) }));
  }, [
    wizardForm.postalVillageCity,
    wizardForm.postalPostOffice,
    wizardForm.postalPoliceStation,
    wizardForm.postalDistrict,
    wizardForm.postalState,
    wizardForm.postalPinCode,
    wizardForm.sameAsPostalAddress,
  ]);

  useEffect(() => {
    if (!selectedStudent || !studentProfileData?.student) {
      return;
    }

    setEditProfileForm({
      candidateName: selectedStudent.candidateName,
      fatherName: studentProfileData.student.fatherName ?? "",
      motherName: studentProfileData.student.motherName ?? "",
      mobile: studentProfileData.student.mobile ?? "",
      fatherMobile: studentProfileData.student.fatherMobile ?? "",
      email: studentProfileData.student.email ?? "",
      permanentAddress: studentProfileData.student.permanentAddress ?? "",
      mailingAddress: studentProfileData.student.mailingAddress ?? "",
      universityEnrollmentNumber: "",
      universityRegistrationNumber: "",
    });
  }, [selectedStudent, studentProfileData]);

  const pendingApprovalCount = useMemo(() => students.filter((student) => student.status !== "ACTIVE").length, [students]);
  const selectedStudentInitials = selectedStudent?.candidateName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const selectedWorkflow = workflowData?.workflow ?? null;
  const documentsVerified = selectedWorkflow?.steps.find((step) => step.key === "DOCUMENTS_VERIFIED")?.complete ?? false;
  const feesVerified = selectedWorkflow?.steps.find((step) => step.key === "FEE_VERIFIED")?.complete ?? false;
  const workflowStatus = selectedWorkflow?.status ?? "SUBMITTED";
  const workflowActions = [
    !documentsVerified
      ? { key: "VERIFY_DOCUMENTS" as const, label: "Verify Documents", className: "bg-blue-600 text-white" }
      : null,
    !feesVerified
      ? { key: "VERIFY_FEES" as const, label: "Verify Fees", className: "bg-indigo-600 text-white" }
      : null,
    ["SUBMITTED", "DOCUMENTS_VERIFIED", "FEE_VERIFIED", "CHANGES_REQUESTED"].includes(workflowStatus)
      ? { key: "SEND_FOR_APPROVAL" as const, label: "Send For Approval", className: "bg-slate-700 text-white" }
      : null,
    workflowStatus === "PENDING_APPROVAL"
      ? { key: "APPROVE" as const, label: "Approve", className: "bg-emerald-600 text-white" }
      : null,
    workflowStatus === "PENDING_APPROVAL"
      ? { key: "REJECT" as const, label: "Reject", className: "bg-rose-600 text-white" }
      : null,
    ["PENDING_APPROVAL", "REJECTED"].includes(workflowStatus)
      ? { key: "REQUEST_CHANGES" as const, label: "Request Changes", className: "bg-slate-100 text-slate-700" }
      : null,
  ].filter(Boolean) as Array<{
    key: "VERIFY_DOCUMENTS" | "VERIFY_FEES" | "SEND_FOR_APPROVAL" | "APPROVE" | "REJECT" | "REQUEST_CHANGES";
    label: string;
    className: string;
  }>;
  const visibleWorkflowActions = canManageWorkflow ? workflowActions : [];

  async function runWorkflowAction(action: "VERIFY_DOCUMENTS" | "VERIFY_FEES" | "SEND_FOR_APPROVAL" | "APPROVE" | "REJECT" | "REQUEST_CHANGES") {
    if (!selectedStudentId) {
      return;
    }

    setDetailLoading(true);
    try {
      await api.patch(`/students/${selectedStudentId}/workflow`, {
        action,
        notes: action === "REQUEST_CHANGES" ? "Additional documents and fee validation required." : undefined,
      });

      const [workflowRes, historyRes] = await Promise.all([
        api.get<StudentWorkflowResponse>(`/students/${selectedStudentId}/workflow`),
        api.get<StudentHistoryResponse>(`/students/${selectedStudentId}/history`),
      ]);

      setWorkflowData(workflowRes.data);
      setHistoryData(historyRes.data);
      toast.success(`Workflow updated: ${action.replace(/_/g, " ").toLowerCase()}`);
    } catch (error) {
      console.error(error);
      toast.error("Unable to update admission workflow.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveProfileEdits() {
    if (!selectedStudentId) {
      return;
    }

    if (!editProfileForm.candidateName.trim()) {
      toast.error("Candidate name is required.");
      return;
    }

    setEditProfileSaving(true);
    try {
      await api.patch(`/students/${selectedStudentId}`, {
        candidateName: editProfileForm.candidateName.trim(),
        fatherName: editProfileForm.fatherName.trim(),
        motherName: editProfileForm.motherName.trim(),
        mobile: editProfileForm.mobile.trim(),
        fatherMobile: editProfileForm.fatherMobile.trim(),
        email: editProfileForm.email.trim(),
        permanentAddress: editProfileForm.permanentAddress.trim(),
        mailingAddress: editProfileForm.mailingAddress.trim(),
        universityEnrollmentNumber: editProfileForm.universityEnrollmentNumber.trim() || undefined,
        universityRegistrationNumber: editProfileForm.universityRegistrationNumber.trim() || undefined,
      });

      const [workflowRes, historyRes, profileRes] = await Promise.all([
        api.get<StudentWorkflowResponse>(`/students/${selectedStudentId}/workflow`),
        api.get<StudentHistoryResponse>(`/students/${selectedStudentId}/history`),
        api.get<StudentPrintablesResponse>(`/students/${selectedStudentId}/printables`),
      ]);

      setWorkflowData(workflowRes.data);
      setHistoryData(historyRes.data);
      setStudentProfileData(profileRes.data);
      await onRefreshStudents();
      setProfileMode("view");
      toast.success("Student profile updated.");
    } catch (error) {
      console.error(error);
      toast.error("Unable to save student profile.");
    } finally {
      setEditProfileSaving(false);
    }
  }

  async function submitWizard() {
    if (!wizardForm.collegeId || !wizardForm.courseId || !wizardForm.sessionId) {
      toast.error("Please complete academic mapping before submitting.");
      return;
    }

    if (!wizardForm.candidateName || !wizardForm.dob || !wizardForm.fatherName || !wizardForm.motherName) {
      toast.error("Please complete student profile.");
      return;
    }

    if (!wizardForm.mobile || !wizardForm.email) {
      toast.error("Please complete contact details.");
      return;
    }

    const resolvedPostalAddress = composePostalAddress(wizardForm);

    if (
      !wizardForm.postalVillageCity.trim() ||
      !wizardForm.postalPostOffice.trim() ||
      !wizardForm.postalPoliceStation.trim() ||
      !wizardForm.postalDistrict.trim() ||
      !wizardForm.postalState.trim() ||
      !wizardForm.postalPinCode.trim() ||
      !resolvedPostalAddress ||
      (!wizardForm.sameAsPostalAddress && !wizardForm.permanentAddress.trim())
    ) {
      toast.error("Please complete postal and permanent address details.");
      return;
    }

    const resolvedPermanentAddress = wizardForm.sameAsPostalAddress ? resolvedPostalAddress : wizardForm.permanentAddress;

    setWizardLoading(true);
    try {
      const snapshotForm = { ...wizardForm };
      const snapshotCollege = wizardCollege?.name ?? "";
      const snapshotCourse = wizardCourse?.name ?? "";
      const snapshotSession = wizardSession?.label ?? "";
      const snapshotFee = calculateFeePayable();
      const result = await onCreateAdmission({
        collegeId: wizardForm.collegeId,
        courseId: wizardForm.courseId,
        sessionId: wizardForm.sessionId,
        candidateName: normalizeUpperName(wizardForm.candidateName).trim(),
        fatherName: normalizeUpperName(wizardForm.fatherName).trim(),
        motherName: normalizeUpperName(wizardForm.motherName).trim(),
        dob: wizardForm.dob,
        gender: wizardForm.gender,
        nationality: wizardForm.nationality,
        mobile: wizardForm.mobile,
        fatherMobile: wizardForm.alternateMobile || wizardForm.mobile,
        email: wizardForm.email,
        permanentAddress: resolvedPermanentAddress,
        mailingAddress: resolvedPostalAddress,
        discountAmount: Number(wizardForm.discountAmount) || 0,
        scholarshipAmount: Number(wizardForm.scholarshipAmount) || 0,
      });
      if (result) {
        setSubmittedAdmission({
          id: result.id,
          admissionNumber: result.admissionNumber,
          admissionCode: result.admissionCode,
          candidateName: result.candidateName,
          formSnapshot: snapshotForm,
          collegeName: snapshotCollege,
          courseName: snapshotCourse,
          sessionLabel: snapshotSession,
          feePayable: snapshotFee,
          submittedAt: new Date().toISOString(),
        });
        setShowAdmissionPrint(true);
      }
      setShowWizard(false);
      setStep(1);
      setWizardForm({
        collegeId: colleges[0]?.id ?? "",
        courseId: "",
        sessionId: "",
        admissionType: "NEW",
        categoryQuota: "",
        candidateName: "",
        dob: "",
        gender: "MALE",
        nationality: "Indian",
        maritalStatus: "",
        category: "",
        background: "URBAN",
        bloodGroup: "",
        aadhaarNo: "",
        previousQualification: "",
        board: "",
        passingYear: "",
        marksPercentage: "",
        postalVillageCity: "",
        postalPostOffice: "",
        postalPoliceStation: "",
        postalDistrict: "",
        postalState: "",
        postalPinCode: "",
        permanentAddress: "",
        sameAsPostalAddress: false,
        fatherName: "",
        fatherOccupation: "",
        fatherAnnualIncome: "",
        motherName: "",
        motherOccupation: "",
        guardianName: "",
        mobile: "",
        alternateMobile: "",
        email: "",
        sameWhatsApp: false,
        guardianAddress: "",
        documents: [{ type: "", file: null, status: "missing" }],
        discountAmount: "0",
        scholarshipAmount: "0",
      });
    } catch (error) {
      console.error(error);
      toast.error("Failed to submit admission. Please try again.");
    } finally {
      setWizardLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Students Directory</h1>
          <p className="mt-1 text-sm text-slate-500">Search, filter by college/course/session, and manage student admissions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700"
            onClick={() => printBlankAdmissionForm()}
          >
            <FileText className="h-4 w-4" /> Print Blank Form
          </button>
          <button
            type="button"
            disabled={!canCreateAdmission}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => setShowWizard(true)}
          >
            <UserPlus2 className="h-4 w-4" /> New Admission
          </button>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            ["All Students", "all"],
            ["Defaulters", "defaulters"],
            ["Pending Admission", "pending"],
            ["Dropouts", "dropouts"],
          ].map(([label, value]) => (
            <button
              key={value}
              type="button"
              className={`rounded-xl px-3 py-1.5 text-sm font-medium ${savedView === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
              onClick={() => setSavedView(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-6">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input
              className="w-full rounded-2xl bg-slate-100 py-2.5 pl-10 pr-4 text-sm outline-none"
              placeholder="Search student name or admission number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            value={selectedCollegeFilter}
            onChange={(e) => setSelectedCollegeFilter(e.target.value)}
            className="rounded-2xl bg-slate-100 px-3 py-2.5 text-sm outline-none"
          >
            <option value="ALL">All colleges</option>
            {colleges.map((college) => (
              <option key={college.id} value={college.id}>
                {college.name}
              </option>
            ))}
          </select>
          <select
            value={selectedCourseFilter}
            onChange={(e) => setSelectedCourseFilter(e.target.value)}
            className="rounded-2xl bg-slate-100 px-3 py-2.5 text-sm outline-none"
          >
            <option value="ALL">All courses</option>
            {courseOptions.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
          <select
            value={selectedSessionFilter}
            onChange={(e) => setSelectedSessionFilter(e.target.value)}
            className="rounded-2xl bg-slate-100 px-3 py-2.5 text-sm outline-none"
          >
            <option value="ALL">All sessions</option>
            {sessionOptions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-2xl bg-slate-100 px-3 py-2.5 text-sm outline-none"
          >
            <option value="ALL">All status</option>
            <option value="ACTIVE">Active</option>
            <option value="PASSED_OUT">Passed out</option>
            <option value="DROP_OUT">Drop out</option>
          </select>

        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Save current filters as..."
            className="min-w-[180px] rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none"
          />
          <button type="button" onClick={saveCurrentPreset} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Save Preset</button>
          <select
            value={selectedPresetId}
            onChange={(event) => {
              const presetId = event.target.value;
              setSelectedPresetId(presetId);
              const preset = savedPresets.find((item) => item.id === presetId);
              if (preset) {
                applyPreset(preset);
              }
            }}
            className="rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none"
          >
            <option value="">Apply saved preset</option>
            {savedPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
          <button type="button" onClick={deleteSelectedPreset} disabled={!selectedPresetId} className="rounded-xl bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60">Delete</button>
          <button type="button" onClick={exportFilteredStudents} className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>{filtered.length} records</span>
          <span>•</span>
          <span>{selectedRows.length} selected</span>
          <span>•</span>
          <span>{pendingApprovalCount} awaiting approval</span>
        </div>
      </div>

      {profileMode !== "directory" && selectedStudent && (
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Student Profile</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">
                {profileMode === "edit" ? "Edit Student Profile" : "Full Student Profile"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {selectedStudent.candidateName} · Admission {selectedStudent.admissionCode ?? `#${selectedStudent.admissionNumber}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700"
                onClick={() => setProfileMode("directory")}
              >
                Back to Directory
              </button>
              {profileMode === "view" && (
                <button
                  type="button"
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                  onClick={() => setProfileMode("edit")}
                >
                  Edit Profile
                </button>
              )}
              {profileMode === "edit" && (
                <>
                  <button
                    type="button"
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
                    onClick={() => void removeStudent()}
                  >
                    Delete Student
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    onClick={() => void saveProfileEdits()}
                    disabled={editProfileSaving}
                  >
                    {editProfileSaving ? "Saving..." : "Save Changes"}
                  </button>
                </>
              )}
            </div>
          </div>

          {profileMode === "view" && (
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <DetailSection title="Personal Details" description="Core student and guardian identity data.">
                <DetailRow label="Student" value={selectedStudent.candidateName} />
                <DetailRow label="Father Name" value={studentProfileData?.student.fatherName ?? "Not available"} />
                <DetailRow label="Mother Name" value={studentProfileData?.student.motherName ?? "Not available"} />
                <DetailRow label="DOB" value={studentProfileData?.student.dob ? new Date(studentProfileData.student.dob).toLocaleDateString() : "Not available"} />
                <DetailRow label="Gender" value={studentProfileData?.student.gender ?? "Not available"} />
                <DetailRow label="Nationality" value={studentProfileData?.student.nationality ?? "Not available"} />
                <DetailRow label="Mobile" value={studentProfileData?.student.mobile ?? "Not available"} />
                <DetailRow label="Email" value={studentProfileData?.student.email ?? "Not available"} />
              </DetailSection>

              <DetailSection title="Academic Details" description="Course, session, roll, and status mapping.">
                <DetailRow label="Admission Number" value={selectedStudent.admissionCode ?? `#${selectedStudent.admissionNumber}`} />
                <DetailRow label="Roll Number" value={studentProfileData?.student.rollCode ?? String(studentProfileData?.student.rollNumber ?? "Not generated")} />
                <DetailRow label="College" value={collegeById[selectedStudent.collegeId]?.name ?? "Trust"} />
                <DetailRow label="Course" value={selectedAdmissionDetails?.course?.name ?? "Not mapped"} />
                <DetailRow label="Session" value={selectedAdmissionDetails?.session?.label ?? "Not mapped"} />
                <DetailRow label="Status" value={selectedStudent.status} />
              </DetailSection>

              <DetailSection title="Documents" description="Uploaded and available supporting files.">
                <DetailRow label="Available Docs" value={(studentProfileData?.availableDocuments ?? []).join(", ") || "No documents listed"} />
                <DetailRow label="Document Verification" value={documentsVerified ? "Verified" : "Pending"} />
                <DetailRow label="Latest Note" value={workflowData?.workflow.notes ?? "No note"} />
              </DetailSection>

              <DetailSection title="Finance" description="Fee and receipt snapshot.">
                <DetailRow label="Total Payable" value={`INR ${selectedStudent.totalPayable.toLocaleString()}`} />
                <DetailRow label="Receipts" value={String(historyData?.receipts.length ?? 0)} />
                <DetailRow label="Latest Receipt" value={historyData?.receipts[0]?.receiptNumber ?? "No stored receipt"} />
              </DetailSection>

              <DetailSection title="Attendance & Activity" description="Most recent timeline events.">
                <div className="max-h-72 space-y-2 overflow-auto pr-1">
                  {recentTimeline.slice(0, 10).map((entry) => (
                    <div key={entry.id} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-800">{entry.title}</p>
                        <span className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{entry.details}</p>
                    </div>
                  ))}
                  {recentTimeline.length === 0 && <p className="text-sm text-slate-500">No timeline records available.</p>}
                </div>
              </DetailSection>

              <DetailSection title="Audit Logs" description="Recent audit and workflow actions.">
                <div className="max-h-72 space-y-2 overflow-auto pr-1">
                  {(historyData?.audit ?? []).slice(0, 10).map((item) => (
                    <div key={item.id} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-800">{item.action.replace(/_/g, " ")}</p>
                        <span className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{item.entityType}</p>
                    </div>
                  ))}
                  {(historyData?.audit.length ?? 0) === 0 && <p className="text-sm text-slate-500">No audit records available.</p>}
                </div>
              </DetailSection>
            </div>
          )}

          {profileMode === "edit" && (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-600">
                Candidate Name
                <input
                  value={editProfileForm.candidateName}
                  onChange={(event) => setEditProfileForm((prev) => ({ ...prev, candidateName: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-slate-600">
                Father Name
                <input
                  value={editProfileForm.fatherName}
                  onChange={(event) => setEditProfileForm((prev) => ({ ...prev, fatherName: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-slate-600">
                Mother Name
                <input
                  value={editProfileForm.motherName}
                  onChange={(event) => setEditProfileForm((prev) => ({ ...prev, motherName: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-slate-600">
                Mobile
                <input
                  value={editProfileForm.mobile}
                  onChange={(event) => setEditProfileForm((prev) => ({ ...prev, mobile: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-slate-600">
                Guardian Mobile
                <input
                  value={editProfileForm.fatherMobile}
                  onChange={(event) => setEditProfileForm((prev) => ({ ...prev, fatherMobile: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-slate-600">
                Email
                <input
                  value={editProfileForm.email}
                  onChange={(event) => setEditProfileForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-slate-600 md:col-span-2">
                Permanent Address
                <textarea
                  value={editProfileForm.permanentAddress}
                  onChange={(event) => setEditProfileForm((prev) => ({ ...prev, permanentAddress: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  rows={2}
                />
              </label>
              <label className="text-sm text-slate-600 md:col-span-2">
                Mailing Address
                <textarea
                  value={editProfileForm.mailingAddress}
                  onChange={(event) => setEditProfileForm((prev) => ({ ...prev, mailingAddress: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  rows={2}
                />
              </label>
              <label className="text-sm text-slate-600">
                University Enrollment Number
                <input
                  value={editProfileForm.universityEnrollmentNumber}
                  onChange={(event) => setEditProfileForm((prev) => ({ ...prev, universityEnrollmentNumber: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-slate-600">
                University Registration Number
                <input
                  value={editProfileForm.universityRegistrationNumber}
                  onChange={(event) => setEditProfileForm((prev) => ({ ...prev, universityRegistrationNumber: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>
          )}
        </div>
      )}

      {profileMode === "directory" && (
      <div className="grid gap-4 xl:grid-cols-[7fr_3fr]">
        <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-slate-800">Student Workspace</div>
            <div className="flex flex-wrap gap-2">
              {[
                [Download, "Export"],
                [Columns3, "Columns"],
              ].map(([Icon, label]) => {
                const ToolbarIcon = Icon as typeof Filter;
                return (
                  <button key={label as string} type="button" className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">
                    <ToolbarIcon className="h-3.5 w-3.5" />
                    {label as string}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
              <div className="text-sm font-medium">{selectedRows.length} selected</div>
              <button
                type="button"
                className="rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/20"
                onClick={() => toast.success(`Bulk action queued for ${selectedRows.length} records`)}
              >
                Run Bulk Action
              </button>
            </div>
          )}

          <div className="max-h-[640px] overflow-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Select</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Admission</th>
                  <th className="px-4 py-3">Course</th>
                  <th className="px-4 py-3">Session</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((student) => {
                  const selected = selectedRows.includes(student.id);
                  const latestAdmission = latestAdmissionByStudentId.get(student.id);
                  return (
                    <tr
                      key={student.id}
                      className={`cursor-pointer hover:bg-slate-50/70 ${selectedStudentId === student.id ? "bg-slate-50" : ""}`}
                      onClick={() => {
                        setSelectedStudentId(student.id);
                        setDetailTab("complete");
                      }}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() =>
                            setSelectedRows((prev) => (selected ? prev.filter((id) => id !== student.id) : [...prev, student.id]))
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-700">
                            {student.candidateName
                              .split(" ")
                              .map((part) => part[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-slate-800">{student.candidateName}</p>
                            <p className="text-xs text-slate-500">{collegeById[student.collegeId]?.name ?? "Trust"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">{student.admissionCode ?? `#${student.admissionNumber}`}</td>
                      <td className="px-4 py-3 text-slate-600">{(latestAdmission?.courseId && courseNameById[latestAdmission.courseId]) || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{(latestAdmission?.sessionId && sessionNameById[latestAdmission.sessionId]) || "-"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            student.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {student.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td className="px-4 py-10 text-center text-sm text-slate-500" colSpan={6}>
                      No students found. Try adjusting filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sticky top-24 h-fit rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          {!selectedStudent && <div className="text-sm text-slate-500">Select a student to open the detail panel.</div>}
          {selectedStudent && (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">{selectedStudentInitials}</div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{selectedStudent.candidateName}</h3>
                    <p className="text-sm text-slate-500">{selectedStudent.admissionCode ?? `#${selectedStudent.admissionNumber}`}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Student Summary</p>
                <div className="mt-2 space-y-1 text-sm text-slate-700">
                  <p><span className="font-medium text-slate-900">Admission:</span> {selectedStudent.admissionCode ?? `#${selectedStudent.admissionNumber}`}</p>
                  <p><span className="font-medium text-slate-900">Course:</span> {selectedAdmissionDetails?.course?.name ?? "Not mapped"}</p>
                  <p><span className="font-medium text-slate-900">Session:</span> {selectedAdmissionDetails?.session?.label ?? "Not mapped"}</p>
                  <p><span className="font-medium text-slate-900">Status:</span> {selectedStudent.status}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                  onClick={() => setProfileMode("view")}
                >
                  View Profile
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700"
                  onClick={() => setProfileMode("edit")}
                >
                  Edit Profile
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Recent Activity</p>
                  {detailLoading && <span className="text-xs text-slate-400">Refreshing...</span>}
                </div>
                <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
                  {recentTimeline.map((entry) => (
                    <div key={entry.id} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800">{entry.title}</p>
                        <span className="text-[11px] text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{entry.details}</p>
                    </div>
                  ))}
                  {recentTimeline.length === 0 && <p className="text-sm text-slate-500">No timeline records available.</p>}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Workflow</p>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">{workflowData?.workflow.status.replace(/_/g, " ") ?? "Loading"}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {visibleWorkflowActions.length === 0 && <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-500 ring-1 ring-slate-200">{canManageWorkflow ? "No actions for current state." : "Workflow actions are limited by your role."}</div>}
                  {visibleWorkflowActions.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      className={`rounded-xl px-3 py-2 text-sm font-medium disabled:opacity-60 ${action.className}`}
                      onClick={() => void runWorkflowAction(action.key)}
                      disabled={detailLoading}
                    >
                      {detailLoading ? "Updating..." : action.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      )}

      <AnimatePresence>
        {showWizard && (
          <motion.div
            className="fixed inset-0 z-40 bg-slate-950/50 p-4 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-6xl rounded-3xl bg-white shadow-2xl flex flex-col max-h-[90vh]"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <div>
                  <h3 className="text-xl font-semibold">New Admission Wizard</h3>
                  <p className="text-sm text-slate-500">6-step admission onboarding process</p>
                </div>
                <button type="button" className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700" onClick={() => setShowWizard(false)}>
                  Close
                </button>
              </div>

              {/* Progress Stepper */}
              <div className="border-b border-slate-100 px-6 py-4 bg-slate-50/50">
                <div className="flex items-center justify-between gap-2">
                  {[1, 2, 3, 4, 5, 6].map((s) => (
                    <div key={s} className="flex items-center flex-1">
                      <button
                        type="button"
                        onClick={() => setStep(s as WizardStep)}
                        className={`relative w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all ${
                          s < step
                            ? "bg-emerald-500 text-white"
                            : s === step
                              ? "bg-slate-900 text-white"
                              : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {s < step ? "✓" : s}
                      </button>
                      {s < 6 && (
                        <div
                          className={`flex-1 h-1 mx-1 rounded transition-all ${
                            s < step ? "bg-emerald-500" : "bg-slate-200"
                          }`}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-center text-sm font-medium text-slate-700">{wizardStepLabels[step]}</p>
              </div>

              {/* Main Content - Two Panel Layout */}
              <div className="flex-1 overflow-hidden flex gap-4 p-6">
                {/* Left Panel - Form */}
                <div className="flex-1 overflow-y-auto">
                  <div className="space-y-5">
                    {/* Step 1: Academic Mapping */}
                    {step === 1 && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="text-2xl">🎓</div>
                            <div>
                              <h4 className="font-semibold text-slate-800">Academic Mapping</h4>
                              <p className="text-xs text-slate-500">Assign student to college, course, and session</p>
                            </div>
                          </div>
                          <div className="space-y-3 grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">College</label>
                              <select
                                value={wizardForm.collegeId}
                                onChange={(e) => wizardFormUpdate({ collegeId: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              >
                                {colleges.map((college) => (
                                  <option key={college.id} value={college.id}>
                                    {college.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Course</label>
                              <select
                                value={wizardForm.courseId}
                                onChange={(e) => wizardFormUpdate({ courseId: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              >
                                {(wizardCollege?.courses ?? []).map((course) => (
                                  <option key={course.id} value={course.id}>
                                    {course.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Session</label>
                              <select
                                value={wizardForm.sessionId}
                                onChange={(e) => wizardFormUpdate({ sessionId: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              >
                                {(wizardCourse?.sessions ?? []).map((session) => (
                                  <option key={session.id} value={session.id}>
                                    {session.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Admission Type</label>
                              <select
                                value={wizardForm.admissionType}
                                onChange={(e) => wizardFormUpdate({ admissionType: e.target.value as "NEW" | "LATERAL" | "TRANSFER" })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              >
                                <option value="NEW">New</option>
                                <option value="LATERAL">Lateral</option>
                                <option value="TRANSFER">Transfer</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Category/Quota</label>
                              <select
                                value={wizardForm.categoryQuota}
                                onChange={(e) => wizardFormUpdate({ categoryQuota: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              >
                                <option value="">Select</option>
                                <option value="GENERAL">General</option>
                                <option value="OBC">OBC</option>
                                <option value="SC">SC</option>
                                <option value="ST">ST</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 2: Student Profile */}
                    {step === 2 && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <h4 className="font-semibold text-slate-800 mb-4">👤 Personal Information</h4>
                          <div className="space-y-3 grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Candidate Name *</label>
                              <input
                                type="text"
                                value={wizardForm.candidateName}
                                onChange={(e) => wizardFormUpdate({ candidateName: normalizeUpperName(e.target.value) })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Date of Birth *</label>
                              <input
                                type="date"
                                value={wizardForm.dob}
                                onChange={(e) => wizardFormUpdate({ dob: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                              {wizardForm.dob && (
                                <p className="text-xs text-slate-500 mt-1">Age: {calculateAge(wizardForm.dob)} years</p>
                              )}
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Gender</label>
                              <select
                                value={wizardForm.gender}
                                onChange={(e) => wizardFormUpdate({ gender: e.target.value as "MALE" | "FEMALE" | "OTHER" })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              >
                                <option value="MALE">Male</option>
                                <option value="FEMALE">Female</option>
                                <option value="OTHER">Other</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Nationality</label>
                              <input
                                type="text"
                                value={wizardForm.nationality}
                                onChange={(e) => wizardFormUpdate({ nationality: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Blood Group</label>
                              <select
                                value={wizardForm.bloodGroup}
                                onChange={(e) => wizardFormUpdate({ bloodGroup: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              >
                                <option value="">Select</option>
                                <option value="A+">A+</option>
                                <option value="A-">A-</option>
                                <option value="B+">B+</option>
                                <option value="B-">B-</option>
                                <option value="AB+">AB+</option>
                                <option value="AB-">AB-</option>
                                <option value="O+">O+</option>
                                <option value="O-">O-</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Background</label>
                              <select
                                value={wizardForm.background}
                                onChange={(e) => wizardFormUpdate({ background: e.target.value as "URBAN" | "RURAL" })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              >
                                <option value="URBAN">Urban</option>
                                <option value="RURAL">Rural</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Aadhaar No. (Optional)</label>
                              <input
                                type="text"
                                value={wizardForm.aadhaarNo}
                                onChange={(e) => wizardFormUpdate({ aadhaarNo: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Email (Optional)</label>
                              <input
                                type="email"
                                value={wizardForm.email}
                                onChange={(e) => wizardFormUpdate({ email: e.target.value })}
                                placeholder="student@example.com"
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Vill/City</label>
                              <input
                                type="text"
                                value={wizardForm.postalVillageCity}
                                onChange={(e) => wizardFormUpdate({ postalVillageCity: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Post Office</label>
                              <input
                                type="text"
                                value={wizardForm.postalPostOffice}
                                onChange={(e) => wizardFormUpdate({ postalPostOffice: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Police Station</label>
                              <input
                                type="text"
                                value={wizardForm.postalPoliceStation}
                                onChange={(e) => wizardFormUpdate({ postalPoliceStation: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">District</label>
                              <input
                                type="text"
                                value={wizardForm.postalDistrict}
                                onChange={(e) => wizardFormUpdate({ postalDistrict: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">State</label>
                              <input
                                type="text"
                                value={wizardForm.postalState}
                                onChange={(e) => wizardFormUpdate({ postalState: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Pin Code</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={wizardForm.postalPinCode}
                                onChange={(e) => wizardFormUpdate({ postalPinCode: e.target.value.replace(/\D/g, "") })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Postal Address</label>
                              <textarea
                                value={composePostalAddress(wizardForm)}
                                readOnly
                                placeholder="Vill/City, Post Office, Police Station, District, State, Pin Code"
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                                rows={2}
                              />
                            </div>
                            <div className="col-span-2 flex items-center gap-2 py-1">
                              <input
                                type="checkbox"
                                id="sameAsPostalAddress"
                                checked={wizardForm.sameAsPostalAddress}
                                onChange={(e) =>
                                  wizardFormUpdate({
                                    sameAsPostalAddress: e.target.checked,
                                    permanentAddress: e.target.checked ? composePostalAddress(wizardForm) : wizardForm.permanentAddress,
                                  })
                                }
                                className="h-4 w-4 rounded"
                              />
                              <label htmlFor="sameAsPostalAddress" className="text-xs font-medium text-slate-700">
                                Permanent address same as postal address
                              </label>
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Permanent Address</label>
                              <textarea
                                value={wizardForm.sameAsPostalAddress ? composePostalAddress(wizardForm) : wizardForm.permanentAddress}
                                onChange={(e) => wizardFormUpdate({ permanentAddress: e.target.value })}
                                disabled={wizardForm.sameAsPostalAddress}
                                placeholder="Vill/City, Post Office, Police Station, District, State, Pin Code"
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                                rows={2}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <h4 className="font-semibold text-slate-800 mb-4">📚 Academic Background</h4>
                          <div className="space-y-3 grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Previous Qualification</label>
                              <input
                                type="text"
                                value={wizardForm.previousQualification}
                                onChange={(e) => wizardFormUpdate({ previousQualification: e.target.value })}
                                placeholder="e.g., SSC, HSC, Bachelor"
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Board</label>
                              <input
                                type="text"
                                value={wizardForm.board}
                                onChange={(e) => wizardFormUpdate({ board: e.target.value })}
                                placeholder="e.g., CBSE, ICSE, State"
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Passing Year</label>
                              <input
                                type="number"
                                value={wizardForm.passingYear}
                                onChange={(e) => wizardFormUpdate({ passingYear: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Marks %</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={wizardForm.marksPercentage}
                                onChange={(e) => wizardFormUpdate({ marksPercentage: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 3: Guardian Details */}
                    {step === 3 && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <h4 className="font-semibold text-slate-800 mb-4">👨‍👩‍👦 Guardian Details</h4>
                          <div className="space-y-3 grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Father Name *</label>
                              <input
                                type="text"
                                value={wizardForm.fatherName}
                                onChange={(e) => wizardFormUpdate({ fatherName: normalizeUpperName(e.target.value) })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Father Occupation</label>
                              <input
                                type="text"
                                value={wizardForm.fatherOccupation}
                                onChange={(e) => wizardFormUpdate({ fatherOccupation: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Father Annual Income</label>
                              <input
                                type="number"
                                value={wizardForm.fatherAnnualIncome}
                                onChange={(e) => wizardFormUpdate({ fatherAnnualIncome: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Mother Name</label>
                              <input
                                type="text"
                                value={wizardForm.motherName}
                                onChange={(e) => wizardFormUpdate({ motherName: normalizeUpperName(e.target.value) })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Mother Occupation</label>
                              <input
                                type="text"
                                value={wizardForm.motherOccupation}
                                onChange={(e) => wizardFormUpdate({ motherOccupation: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Mobile *</label>
                              <input
                                type="tel"
                                value={wizardForm.mobile}
                                onChange={(e) => wizardFormUpdate({ mobile: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Alternate Mobile</label>
                              <input
                                type="tel"
                                value={wizardForm.alternateMobile}
                                onChange={(e) => wizardFormUpdate({ alternateMobile: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Email *</label>
                              <input
                                type="email"
                                value={wizardForm.email}
                                onChange={(e) => wizardFormUpdate({ email: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="col-span-2 flex items-center gap-2 py-1">
                              <input
                                type="checkbox"
                                id="sameWhatsApp"
                                checked={wizardForm.sameWhatsApp}
                                onChange={(e) => wizardFormUpdate({ sameWhatsApp: e.target.checked })}
                                className="w-4 h-4 rounded"
                              />
                              <label htmlFor="sameWhatsApp" className="text-xs font-medium text-slate-700">
                                Same WhatsApp Number
                              </label>
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-700 mb-1.5">Guardian Address</label>
                              <textarea
                                value={wizardForm.guardianAddress}
                                onChange={(e) => wizardFormUpdate({ guardianAddress: e.target.value })}
                                className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                                rows={2}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 4: Documents */}
                    {step === 4 && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <h4 className="font-semibold text-slate-800 mb-4">📄 Document Upload</h4>
                          <div className="space-y-3">
                            {wizardForm.documents.map((doc, index) => (
                              <div key={`doc-${index}`} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                                <input
                                  type="text"
                                  value={doc.type}
                                  onChange={(e) => updateWizardDocumentName(index, e.target.value)}
                                  placeholder="Enter document name"
                                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                />

                                <label className="cursor-pointer rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200">
                                  Attach Document
                                  <input
                                    type="file"
                                    className="hidden"
                                    onChange={(event) => attachWizardDocument(index, event.target.files?.[0] ?? null)}
                                  />
                                </label>

                                <span
                                  className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                                    doc.status === "uploaded" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                                  }`}
                                >
                                  {doc.status === "uploaded" ? "Uploaded" : "Missing"}
                                </span>

                                <button
                                  type="button"
                                  onClick={() => removeWizardDocumentRow(index)}
                                  className="rounded-lg bg-slate-100 px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>

                          <div className="mt-3 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={addWizardDocumentRow}
                              className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200"
                            >
                              + Add Document
                            </button>
                            <span className="text-xs text-slate-500">Document name + file attachment supported</span>
                          </div>
                          <p className="mt-4 text-xs text-slate-500">💡 Uploaded documents can be verified and tracked in the Fee & Workflow tabs</p>
                        </div>
                      </div>
                    )}

                    {/* Step 5: Fee Payable */}
                    {step === 5 && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <h4 className="font-semibold text-slate-800 mb-4">💰 Fee Calculation</h4>
                          <div className="bg-white rounded-xl p-4 space-y-3 mb-4">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-slate-600">Base Fee (per year):</span>
                              <span className="text-sm font-semibold text-slate-900">
                                ₹{(sessionFeeById[wizardForm.sessionId] ?? 0).toLocaleString()}
                              </span>
                            </div>
                            <div className="border-t border-slate-200" />
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1.5">Discount</label>
                                <input
                                  type="number"
                                  min="0"
                                  value={wizardForm.discountAmount}
                                  onChange={(e) => wizardFormUpdate({ discountAmount: e.target.value })}
                                  className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1.5">Scholarship</label>
                                <input
                                  type="number"
                                  min="0"
                                  value={wizardForm.scholarshipAmount}
                                  onChange={(e) => wizardFormUpdate({ scholarshipAmount: e.target.value })}
                                  className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                                />
                              </div>
                            </div>
                            <div className="border-t border-slate-200 pt-3">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-slate-900">Total Payable:</span>
                                <span className="text-lg font-bold text-emerald-600">₹{calculateFeePayable().toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 6: Review & Submit */}
                    {step === 6 && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                          <h4 className="font-semibold text-emerald-900 mb-3">✓ Review Admission Details</h4>
                          <div className="space-y-3 text-sm">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs text-emerald-700 font-medium">College</p>
                                <p className="text-emerald-900 font-semibold">{wizardCollege?.name}</p>
                              </div>
                              <div>
                                <p className="text-xs text-emerald-700 font-medium">Course</p>
                                <p className="text-emerald-900 font-semibold">{wizardCourse?.name}</p>
                              </div>
                              <div>
                                <p className="text-xs text-emerald-700 font-medium">Session</p>
                                <p className="text-emerald-900 font-semibold">{wizardSession?.label}</p>
                              </div>
                              <div>
                                <p className="text-xs text-emerald-700 font-medium">Admission Type</p>
                                <p className="text-emerald-900 font-semibold">{wizardForm.admissionType}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <h4 className="font-semibold text-slate-800 mb-3">Student Profile Summary</h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-slate-600">Name:</span>
                              <span className="font-semibold text-slate-900">{wizardForm.candidateName}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-600">Date of Birth:</span>
                              <span className="font-semibold text-slate-900">{wizardForm.dob} ({calculateAge(wizardForm.dob)} yrs)</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-600">Father:</span>
                              <span className="font-semibold text-slate-900">{wizardForm.fatherName}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-600">Mobile:</span>
                              <span className="font-semibold text-slate-900">{wizardForm.mobile}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-600">Email:</span>
                              <span className="font-semibold text-slate-900">{wizardForm.email}</span>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-slate-200">
                              <span className="text-slate-600">Total Fee Payable:</span>
                              <span className="font-bold text-emerald-600">₹{calculateFeePayable().toLocaleString()}</span>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                          <p className="text-xs text-blue-800">
                            <strong>Note:</strong> After submission, an admission receipt will be generated and you can track the admission status in the workflow.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Panel - Summary */}
                <div className="w-64 border-l border-slate-100 pl-4 overflow-y-auto">
                  <div className="space-y-4 sticky top-0">
                    {/* Program Summary */}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <h5 className="font-semibold text-slate-800 mb-3 text-sm">Selected Program</h5>
                      <div className="space-y-2 text-sm">
                        <div className="font-bold text-slate-900">{wizardCourse?.name || "No course selected"}</div>
                        {wizardSession && (
                          <>
                            <p className="text-slate-600">
                              <span className="font-semibold">Duration:</span> 2 Years
                            </p>
                            <p className="text-slate-600">
                              <span className="font-semibold">Available Seats:</span> {sessionSeatById[wizardForm.sessionId] ?? 0}
                            </p>
                            <p className="text-slate-600">
                              <span className="font-semibold">Fees:</span> ₹{(sessionFeeById[wizardForm.sessionId] ?? 0).toLocaleString()}/year
                            </p>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Completion Status */}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <h5 className="font-semibold text-slate-800 mb-3 text-sm">Progress</h5>
                      <div className="space-y-2">
                        {[1, 2, 3, 4, 5, 6].map((s) => (
                          <div key={s} className="flex items-center gap-2 text-xs">
                            <div
                              className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-white ${
                                s < step ? "bg-emerald-500" : s === step ? "bg-slate-900" : "bg-slate-300"
                              }`}
                            >
                              {s < step ? "✓" : s}
                            </div>
                            <span className={s <= step ? "text-slate-900 font-medium" : "text-slate-500"}>
                              {wizardStepLabels[s as WizardStep]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Smart Features */}
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="h-4 w-4 text-amber-700" />
                        <h5 className="font-semibold text-amber-900 text-sm">Smart Features</h5>
                      </div>
                      <ul className="text-xs text-amber-800 space-y-1">
                        <li>✓ Duplicate student detection</li>
                        <li>✓ Auto-calculate age from DOB</li>
                        <li>✓ Auto-generate admission number</li>
                        <li>✓ Real-time fee calculation</li>
                      </ul>
                    </div>

                    {/* Admission Status */}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <h5 className="font-semibold text-slate-800 mb-2 text-sm">Admission Status</h5>
                      <span className="inline-block px-3 py-1.5 bg-slate-200 text-slate-800 rounded-full text-xs font-medium">Draft</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sticky Footer */}
              <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 flex items-center justify-between">
                <div className="text-xs text-slate-500">Step {step} of 6 • {wizardStepLabels[step]}</div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (step > 1) setStep((step - 1) as WizardStep);
                    }}
                    disabled={step === 1}
                    className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (step < 6) setStep((step + 1) as WizardStep);
                    }}
                    className="px-4 py-2 rounded-xl bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300"
                  >
                    Save & Close
                  </button>
                  {step < 6 && (
                    <button
                      type="button"
                      onClick={() => setStep((step + 1) as WizardStep)}
                      className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
                    >
                      Next
                    </button>
                  )}
                  {step === 6 && (
                    <button
                      type="button"
                      onClick={submitWizard}
                      disabled={wizardLoading}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {wizardLoading ? "Submitting..." : "Submit Admission"}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admission Submission Success + Print Modal */}
      <AnimatePresence>
        {showAdmissionPrint && submittedAdmission && (
          <motion.div
            className="fixed inset-0 z-50 bg-slate-950/60 p-4 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl overflow-hidden"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="bg-emerald-600 px-6 py-5 text-white">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold">Admission Submitted Successfully!</h3>
                    <p className="mt-1 text-sm text-emerald-100">Admission form and declaration are ready to print.</p>
                  </div>
                  <button type="button" className="rounded-xl bg-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/30" onClick={() => setShowAdmissionPrint(false)}>
                    Close
                  </button>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4 rounded-2xl bg-slate-50 p-4">
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Admission Number</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{submittedAdmission.admissionCode ?? `ADM-${String(submittedAdmission.admissionNumber).padStart(4, "0")}`}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Roll Number</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{generateRollNumber(submittedAdmission.admissionNumber, submittedAdmission.sessionLabel)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Student</p>
                    <p className="mt-1 font-semibold text-slate-900">{submittedAdmission.candidateName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Course &amp; Session</p>
                    <p className="mt-1 font-semibold text-slate-900">{submittedAdmission.courseName} · {submittedAdmission.sessionLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">College</p>
                    <p className="mt-1 font-semibold text-slate-900">{submittedAdmission.collegeName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Total Fee Payable</p>
                    <p className="mt-1 font-bold text-emerald-700">₹{submittedAdmission.feePayable.toLocaleString()}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  The filled admission form includes the complete admission details and a signed declaration affidavit. Print and retain a copy in the student file.
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
                    onClick={() => {
                      const popup = window.open("", "_blank", "width=900,height=1000");
                      if (!popup) { toast.error("Popup blocked. Please allow popups."); return; }
                      const html = admissionFormHtml(
                        submittedAdmission.admissionNumber,
                        submittedAdmission.admissionCode,
                        submittedAdmission.candidateName,
                        submittedAdmission.collegeName,
                        submittedAdmission.courseName,
                        submittedAdmission.sessionLabel,
                        submittedAdmission.formSnapshot,
                        submittedAdmission.feePayable,
                        submittedAdmission.submittedAt
                      );
                      popup.document.write(html);
                      popup.document.close();
                      popup.focus();
                      popup.print();
                    }}
                  >
                    <Printer className="h-4 w-4" /> Print Filled Admission Form + Affidavit
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => setShowAdmissionPrint(false)}
                  >
                    Done
                  </button>
                </div>
                <p className="text-center text-xs text-slate-400">This form is permanently stored and can be reprinted anytime from the student profile.</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {historyDrawerOpen && selectedStudent && (
          <motion.div className="fixed inset-0 z-40 bg-slate-950/30 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              initial={{ x: 24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 24, opacity: 0 }}
              className="ml-auto h-full w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selectedStudent.candidateName}</p>
                  <p className="text-xs text-slate-500">Activity, audit, approvals, and notes</p>
                </div>
                <button type="button" className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700" onClick={() => setHistoryDrawerOpen(false)}>
                  Close
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  ["Activity", "activity"],
                  ["Audit Log", "audit"],
                  ["Changes", "changes"],
                  ["Approvals", "approvals"],
                  ["Notes", "notes"],
                ].map(([label, value]) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-xl px-3 py-1.5 text-sm font-medium ${historyTab === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                    onClick={() => setHistoryTab(value as HistoryTab)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-5 space-y-3">
                {getHistoryItems(historyTab, selectedStudent, historyData, workflowData).map((item) => (
                  <div key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-900">{item.title}</p>
                      <span className="text-xs text-slate-400">{item.when}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{item.detail}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">{value} <ChevronRight className="h-4 w-4 text-slate-300" /></span>
    </div>
  );
}

async function printStudentReceipt(receiptNumber: string, trustName?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const response = await api.get<{
    receiptNumber: string;
    cycleLabel?: string | null;
    amount: number;
    lateFine: number;
    totalReceived: number;
    paymentMode?: string | null;
    referenceNumber?: string | null;
    collectedBy?: string | null;
    collectedAt: string;
    snapshot: {
      student: { candidateName: string; admissionNumber: number; admissionCode?: string | null };
      academicContext?: { college?: string | null; course?: string | null; session?: string | null };
      payment: { cycleLabel?: string | null };
    };
  }>(`/finance/receipts/${receiptNumber}`);

  const receipt = response.data;
  const receiptTitle = `${trustName?.trim() || "CampusGrid"} Fee Receipt`;
  const popup = window.open("", "_blank", "width=820,height=900");
  if (!popup) {
    return;
  }

  popup.document.write(`
    <html>
      <head>
        <title>${receipt.receiptNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
          .card { border: 1px solid #cbd5e1; border-radius: 16px; padding: 24px; }
          .row { display: flex; justify-content: space-between; gap: 16px; margin: 10px 0; }
          .label { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
          .value { font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 style="margin:0 0 4px;">${receiptTitle}</h2>
          <p style="margin:0 0 20px;color:#64748b;">Receipt ${receipt.receiptNumber}</p>
          <div class="row"><span class="label">Student</span><span class="value">${receipt.snapshot.student.candidateName} (${receipt.snapshot.student.admissionCode ?? `#${receipt.snapshot.student.admissionNumber}`})</span></div>
          <div class="row"><span class="label">College</span><span class="value">${receipt.snapshot.academicContext?.college ?? "Not mapped"}</span></div>
          <div class="row"><span class="label">Course</span><span class="value">${receipt.snapshot.academicContext?.course ?? "Not mapped"}</span></div>
          <div class="row"><span class="label">Session</span><span class="value">${receipt.snapshot.academicContext?.session ?? "Not mapped"}</span></div>
          <div class="row"><span class="label">Cycle</span><span class="value">${receipt.snapshot.payment.cycleLabel ?? receipt.cycleLabel ?? "Fee collection"}</span></div>
          <div class="row"><span class="label">Collected on</span><span class="value">${new Date(receipt.collectedAt).toLocaleString()}</span></div>
          <div class="row"><span class="label">Payment mode</span><span class="value">${receipt.paymentMode ?? "--"}</span></div>
          <div class="row"><span class="label">Reference</span><span class="value">${receipt.referenceNumber ?? "--"}</span></div>
          <div class="row"><span class="label">Collected by</span><span class="value">${receipt.collectedBy ?? "--"}</span></div>
          <div class="row"><span class="label">Amount</span><span class="value">INR ${receipt.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div class="row"><span class="label">Late fine</span><span class="value">INR ${receipt.lateFine.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div class="row"><span class="label">Total received</span><span class="value">INR ${receipt.totalReceived.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        </div>
      </body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
}

function getHistoryItems(
  historyTab: HistoryTab,
  student: Student,
  historyData: StudentHistoryResponse | null,
  workflowData: StudentWorkflowResponse | null
) {
  const toRelative = (value: string) => new Date(value).toLocaleString();

  if (historyTab === "activity") {
    const timelineItems = (historyData?.timeline ?? []).slice(0, 6).map((item) => ({
      title: item.title,
      detail: item.details,
      when: toRelative(item.createdAt),
    }));
    const receiptItems = (historyData?.receipts ?? []).slice(0, 2).map((item) => ({
      title: `Receipt ${item.receiptNumber}`,
      detail: `${item.cycleLabel ?? "Fee collection"} stored in profile · Total ${item.totalReceived.toLocaleString()}`,
      when: toRelative(item.collectedAt),
    }));

    return [...receiptItems, ...timelineItems].slice(0, 8);
  }

  if (historyTab === "audit") {
    return (historyData?.audit ?? []).slice(0, 8).map((item) => ({
      title: item.action.replace(/_/g, " "),
      detail: `Logged against ${item.entityType}${item.actor?.email ? ` by ${item.actor.email}` : ""}`,
      when: toRelative(item.createdAt),
    }));
  }

  if (historyTab === "changes") {
    return (historyData?.timeline ?? [])
      .filter((item) => /updated|changed/i.test(item.title) || /updated|changed/i.test(item.details))
      .slice(0, 8)
      .map((item) => ({
        title: item.title,
        detail: item.details,
        when: toRelative(item.createdAt),
      }));
  }

  if (historyTab === "approvals") {
    return (historyData?.audit ?? [])
      .filter((item) => /ADMISSION_/.test(item.action))
      .slice(0, 8)
      .map((item) => ({
        title: item.action.replace(/_/g, " "),
        detail: `Workflow status ${workflowData?.workflow.status.replace(/_/g, " ") ?? student.status.replace(/_/g, " ")}`,
        when: toRelative(item.createdAt),
      }));
  }

  if (historyTab === "notes") {
    return workflowData?.workflow.notes
      ? [{ title: "Workflow note", detail: workflowData.workflow.notes, when: toRelative(workflowData.workflow.workflowUpdatedAt) }]
      : [{ title: "No notes", detail: `No workflow notes recorded for ${student.candidateName}.`, when: "Current" }];
  }

  return [{ title: "No history", detail: `No history available for ${student.candidateName}.`, when: "Current" }];
}

function WizardSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">{children}</div>
    </section>
  );
}
