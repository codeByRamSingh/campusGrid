import { FormEvent, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  BadgeCheck,
  CalendarClock,
  FileCheck2,
  HandCoins,
  Mail,
  Phone,
  ShieldAlert,
  UserRound,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { hasAnyPermission, hasPermission } from "../../lib/permissions";
import { exportRowsToCsv, loadSavedPresets, removeSavedPreset, type SavedPreset, upsertSavedPreset } from "../../lib/viewPresets";
import { AttendanceTrendChart } from "../../components/dashboard/AttendanceTrendChart";
import { PayrollExceptionTrendChart } from "../../components/dashboard/PayrollExceptionTrendChart";
import { useAuth } from "../../contexts/AuthContext";
import { useAcademicStructure } from "../../hooks/useAcademicStructure";
import { useCustomRoles } from "../../hooks/useAcademicStructure";
import {
  useStaff, useSalaryConfigs, useAttendance, useLeaveRequests, usePayroll,
  useCreateStaff, useUpdateStaff, useDeleteStaff, useSetSalaryConfig,
  useMarkAttendance, useUpdateLeaveStatus, useProcessPayroll, useUpdatePayrollStatus,
} from "../../hooks/useHr";

type College = { id: string; name: string };
type Staff = { id: string; fullName: string; email: string; mobile: string; collegeId: string; role?: string; designation?: string; staffType?: string; employmentType?: string; joiningDate?: string; customRoleId?: string };
type Attendance = { id: string; date: string; status: string; staff: { fullName: string } };
type Leave = { id: string; fromDate: string; toDate: string; status: string; staff: { fullName: string } };
type Payroll = { id: string; amount: number; month: number; year: number; status?: string; paidAt?: string | null; staff: { id?: string; fullName: string } };
type SalaryConfig = { id: string; staffId: string; basicSalary: number; hra: number; da: number; otherAllowances: number; bankAccountNumber: string | null; bankName: string | null; ifscCode: string | null; pan: string | null; pfUan: string | null; paymentMode: string };
type SalaryConfigMap = Record<string, SalaryConfig>;
type CustomRole = { id: string; collegeId: string; name: string; permissions: string[]; createdAt: string; updatedAt: string };


type WorkspaceKey = "people" | "onboarding" | "payroll" | "attendance" | "leave";
type StaffType = "TEACHING" | "EXECUTIVE";
type EmploymentStatus = "ACTIVE" | "PROBATION" | "INACTIVE";
type OnboardingStep = 1 | 2 | 3 | 4;

type OnboardingForm = {
  fullName: string;
  staffType: StaffType;
  dob: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  mobile: string;
  email: string;
  emergencyContact: string;
  photo: File | null;

  currentAddress: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  country: string;
  sameAsCurrentAddress: boolean;
  permanentAddress: string;
  permanentCity: string;
  permanentDistrict: string;
  permanentState: string;
  permanentPincode: string;
  permanentCountry: string;

  institutionAssignment: string;
  designation: string;
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT";
  joiningDate: string;
  employmentStatus: EmploymentStatus;
  subjectSpecialization: string;
  qualification: string;
  experience: string;
  functionalRole: string;
  department: string;
  customRoleId: string;

  monthlySalary: string;
  bankAccountNumber: string;
  ifscCode: string;
  pan: string;
  pfUan: string;
  paymentMode: "BANK_TRANSFER" | "CASH" | "UPI";
  appointmentLetter: File | null;
  idProof: File | null;
  addressProof: File | null;
  additionalDocuments: File[];
};

type OnboardingDraft = {
  id: string;
  fullName: string;
  staffType: StaffType;
  employmentStatus: EmploymentStatus;
  designation: string;
  createdAt: string;
};

type HrPeoplePresetValues = {
  query: string;
  collegeId: string;
  status: "ALL" | EmploymentStatus;
};

type HrPayrollPresetValues = {
  month: number;
  year: number;
  institution: string;
  staffType: "ALL" | StaffType;
  employmentStatus: "ALL" | EmploymentStatus;
};

const HR_PEOPLE_PRESET_KEY = "campusgrid_hr_people_presets_v1";
const HR_PAYROLL_PRESET_KEY = "campusgrid_hr_payroll_presets_v1";

const stepLabels: Record<OnboardingStep, string> = {
  1: "Personal Information",
  2: "Address Information",
  3: "Employment Information",
  4: "Payroll + Documents",
};

function defaultOnboardingForm(colleges: College[]): OnboardingForm {
  return {
    fullName: "",
    staffType: "TEACHING",
    dob: "",
    gender: "MALE",
    mobile: "",
    email: "",
    emergencyContact: "",
    photo: null,

    currentAddress: "",
    city: "",
    district: "",
    state: "",
    pincode: "",
    country: "India",
    sameAsCurrentAddress: true,
    permanentAddress: "",
    permanentCity: "",
    permanentDistrict: "",
    permanentState: "",
    permanentPincode: "",
    permanentCountry: "India",

    institutionAssignment: colleges[0]?.id ?? "",
    designation: "",
    employmentType: "FULL_TIME",
    joiningDate: "",
    employmentStatus: "ACTIVE",
    subjectSpecialization: "",
    qualification: "",
    experience: "",
    functionalRole: "",
    department: "",
    customRoleId: "",

    monthlySalary: "",
    bankAccountNumber: "",
    ifscCode: "",
    pan: "",
    pfUan: "",
    paymentMode: "BANK_TRANSFER",
    appointmentLetter: null,
    idProof: null,
    addressProof: null,
    additionalDocuments: [],
  };
}

export function HrPage() {
  const { permissions } = useAuth();
  const { data: academicStructure = [] } = useAcademicStructure();
  const colleges: College[] = academicStructure.map((c) => ({ id: c.id, name: c.name }));
  const { data: staff = [], isFetching: staffFetching } = useStaff();
  const { data: salaryConfigs = {} } = useSalaryConfigs();
  const { data: customRolesData = [] } = useCustomRoles();
  const customRoles: CustomRole[] = customRolesData.map((r) => ({ id: r.id, collegeId: r.collegeId, name: r.name, permissions: r.permissions, createdAt: r.createdAt, updatedAt: r.updatedAt }));
  const { data: attendanceData } = useAttendance();
  const attendanceRows: Attendance[] = attendanceData?.data ?? [];
  const { data: leaveData } = useLeaveRequests();
  const leaveRows: Leave[] = leaveData?.data ?? [];
  const { data: payrollRows = [] } = usePayroll();
  const loading = staffFetching;

  const createStaff = useCreateStaff();
  const updateStaffMutation = useUpdateStaff();
  const deleteStaffMutation = useDeleteStaff();
  const setSalaryConfigMutation = useSetSalaryConfig();
  const markAttendanceMutation = useMarkAttendance();
  const updateLeaveStatusMutation = useUpdateLeaveStatus();
  const processPayrollMutation = useProcessPayroll();
  const updatePayrollStatusMutation = useUpdatePayrollStatus();

  const onAddStaff = (payload: Record<string, unknown>) => createStaff.mutateAsync(payload).then(() => undefined);
  const onProcessPayroll = (payload: Record<string, unknown>) => processPayrollMutation.mutateAsync(payload).then(() => undefined);
  const onUpdateStaff = (staffId: string, payload: Record<string, unknown>) => updateStaffMutation.mutateAsync({ staffId, data: payload }).then(() => undefined);
  const onDeleteStaff = (staffId: string) => deleteStaffMutation.mutateAsync(staffId).then(() => undefined);
  const onUpdateLeaveStatus = (id: string, status: "APPROVED" | "REJECTED") => updateLeaveStatusMutation.mutateAsync({ id, status }).then(() => undefined);
  const onSaveSalaryConfig = (staffId: string, config: Partial<SalaryConfig>) => setSalaryConfigMutation.mutateAsync({ staffId, data: config }).then(() => undefined);
  const onUpdatePayrollStatus = (payrollId: string, status: "PROCESSED" | "PAID" | "REVERSED") => updatePayrollStatusMutation.mutateAsync({ payrollId, status }).then(() => undefined);

  const canManageStaff = hasPermission(permissions, "HR_WRITE");
  const canManageAttendance = hasPermission(permissions, "HR_ATTENDANCE");
  const canManageLeave = hasPermission(permissions, "HR_WRITE");
  const canViewPayroll = hasPermission(permissions, "PAYROLL_READ");

  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceKey>("people");

  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(1);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingForm, setOnboardingForm] = useState<OnboardingForm>(() => defaultOnboardingForm(colleges));
  const [onboardingDrafts, setOnboardingDrafts] = useState<OnboardingDraft[]>([]);

  const [attendanceStaffId, setAttendanceStaffId] = useState(staff[0]?.id ?? "");
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [attendanceStatus, setAttendanceStatus] = useState<"PRESENT" | "ABSENT" | "HALF_DAY">("PRESENT");
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  const now = new Date();
  const [payrollMonth, setPayrollMonth] = useState(now.getMonth() + 1);
  const [payrollYear, setPayrollYear] = useState(now.getFullYear());
  const [payrollInstitution, setPayrollInstitution] = useState("ALL");
  const [payrollStaffType, setPayrollStaffType] = useState<"ALL" | StaffType>("ALL");
  const [payrollEmploymentStatus, setPayrollEmploymentStatus] = useState<"ALL" | EmploymentStatus>("ALL");

  const [allowancesByStaff, setAllowancesByStaff] = useState<Record<string, number>>({});
  const [deductionsByStaff, setDeductionsByStaff] = useState<Record<string, number>>({});
  const [manualAdjustmentsByStaff, setManualAdjustmentsByStaff] = useState<Record<string, number>>({});
  const [payrollHoldByStaff, setPayrollHoldByStaff] = useState<Record<string, boolean>>({});

  const [showRunPayrollModal, setShowRunPayrollModal] = useState(false);
  const [includeAttendanceDeductions, setIncludeAttendanceDeductions] = useState(true);
  const [includeLeaveDeductions, setIncludeLeaveDeductions] = useState(true);
  const [includeBonuses, setIncludeBonuses] = useState(false);
  const [includeManualAdjustments, setIncludeManualAdjustments] = useState(true);
  const [runPayrollLoading, setRunPayrollLoading] = useState(false);

  const [selectedPayrollStaffId, setSelectedPayrollStaffId] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleCollegeFilter, setPeopleCollegeFilter] = useState("ALL");
  const [peopleStatusFilter, setPeopleStatusFilter] = useState<"ALL" | EmploymentStatus>("ALL");
  const [peoplePresetName, setPeoplePresetName] = useState("");
  const [selectedPeoplePresetId, setSelectedPeoplePresetId] = useState("");
  const [savedPeoplePresets, setSavedPeoplePresets] = useState<Array<SavedPreset<HrPeoplePresetValues>>>(() =>
    loadSavedPresets<HrPeoplePresetValues>(HR_PEOPLE_PRESET_KEY)
  );

  const [payrollPresetName, setPayrollPresetName] = useState("");
  const [selectedPayrollPresetId, setSelectedPayrollPresetId] = useState("");
  const [savedPayrollPresets, setSavedPayrollPresets] = useState<Array<SavedPreset<HrPayrollPresetValues>>>(() =>
    loadSavedPresets<HrPayrollPresetValues>(HR_PAYROLL_PRESET_KEY)
  );
  const [staffProfileMode, setStaffProfileMode] = useState<"directory" | "view" | "edit">("directory");
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [staffProfileOverrides, setStaffProfileOverrides] = useState<
    Record<
      string,
      Partial<{
        fullName: string;
        email: string;
        mobile: string;
        designation: string;
        staffType: StaffType;
        employmentStatus: EmploymentStatus;
        salary: number;
        bankAccountNumber: string;
      }>
    >
  >({});
  const [staffEditForm, setStaffEditForm] = useState({
    fullName: "",
    email: "",
    mobile: "",
    designation: "",
    staffType: "EXECUTIVE" as StaffType,
    employmentStatus: "ACTIVE" as EmploymentStatus,
    salary: "",
    bankAccountNumber: "",
    customRoleId: "",
  });

  const collegeNameById = useMemo(() => Object.fromEntries(colleges.map((college) => [college.id, college.name])), [colleges]);


  const staffDirectoryRows = useMemo(() => {
    return staff.map((member) => {
      const inferredType = inferStaffType(member.role);
      const inferredStatus: EmploymentStatus = "ACTIVE";
      const inferredDesignation = inferDesignation(member.role);
      const overrides = staffProfileOverrides[member.id] ?? {};
      const cfg = salaryConfigs[member.id];
      const salary = Number(overrides.salary ?? cfg?.basicSalary ?? guessSalary(member.role));

      return {
        ...member,
        fullName: overrides.fullName ?? member.fullName,
        email: overrides.email ?? member.email,
        mobile: overrides.mobile ?? member.mobile,
        staffType: (overrides.staffType ?? member.staffType ?? inferredType) as StaffType,
        employmentStatus: (overrides.employmentStatus ?? inferredStatus) as EmploymentStatus,
        designation: overrides.designation ?? member.designation ?? inferredDesignation,
        salary,
        bankAccountNumber: overrides.bankAccountNumber ?? cfg?.bankAccountNumber ?? "",
      };
    });
  }, [staff, salaryConfigs, staffProfileOverrides]);

  const filteredStaffDirectoryRows = useMemo(() => {
    const q = peopleQuery.trim().toLowerCase();
    return staffDirectoryRows.filter((member) => {
      if (peopleCollegeFilter !== "ALL" && member.collegeId !== peopleCollegeFilter) {
        return false;
      }
      if (peopleStatusFilter !== "ALL" && member.employmentStatus !== peopleStatusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        member.fullName.toLowerCase().includes(q) ||
        member.email.toLowerCase().includes(q) ||
        member.mobile.includes(q) ||
        member.designation.toLowerCase().includes(q)
      );
    });
  }, [peopleCollegeFilter, peopleQuery, peopleStatusFilter, staffDirectoryRows]);

  const monthlyPayrollByStaff = useMemo(() => {
    const map: Record<string, Payroll[]> = {};
    for (const row of payrollRows) {
      const staffId = row.staff.id;
      if (!staffId) {
        continue;
      }
      if (!map[staffId]) {
        map[staffId] = [];
      }
      map[staffId].push(row);
    }
    return map;
  }, [payrollRows]);

  const payrollFilteredStaff = useMemo(() => {
    return staffDirectoryRows.filter((member) => {
      if (payrollInstitution !== "ALL" && member.collegeId !== payrollInstitution) {
        return false;
      }
      if (payrollStaffType !== "ALL" && member.staffType !== payrollStaffType) {
        return false;
      }
      if (payrollEmploymentStatus !== "ALL" && member.employmentStatus !== payrollEmploymentStatus) {
        return false;
      }
      return true;
    });
  }, [payrollEmploymentStatus, payrollInstitution, payrollStaffType, staffDirectoryRows]);

  const payrollRowsComputed = useMemo(() => {
    return payrollFilteredStaff.map((member) => {
      const processedRecords = (monthlyPayrollByStaff[member.id] ?? []).filter((row) => row.month === payrollMonth && row.year === payrollYear);
      const baseSalary = Number(member.salary || 0);
      const allowances = Number(allowancesByStaff[member.id] ?? 0);
      const deductions = Number(deductionsByStaff[member.id] ?? 0);
      const manual = Number(manualAdjustmentsByStaff[member.id] ?? 0);
      const netPay = Math.max(0, baseSalary + allowances + manual - deductions);

      const missingSalary = baseSalary <= 0;
      const missingBank = !member.bankAccountNumber;
      const duplicatePayroll = processedRecords.length > 1;
      const negativePayroll = baseSalary + allowances + manual - deductions < 0;
      const held = Boolean(payrollHoldByStaff[member.id]);

      const status = held
        ? "Held"
        : processedRecords.length > 0
          ? processedRecords[0].status === "PAID"
            ? "Paid"
            : "Processed"
          : "Pending";

      return {
        member,
        processedRecords,
        baseSalary,
        allowances,
        deductions,
        manual,
        netPay,
        status,
        exceptions: {
          missingSalary,
          missingBank,
          duplicatePayroll,
          negativePayroll,
        },
      };
    });
  }, [allowancesByStaff, deductionsByStaff, manualAdjustmentsByStaff, monthlyPayrollByStaff, payrollFilteredStaff, payrollHoldByStaff, payrollMonth, payrollYear]);

  const payrollKpis = useMemo(() => {
    const activeStaff = payrollFilteredStaff.filter((member) => member.employmentStatus === "ACTIVE").length;
    const monthlyAmount = payrollRowsComputed.reduce((sum, row) => sum + row.netPay, 0);
    const processed = payrollRowsComputed.filter((row) => row.status === "Processed" || row.status === "Paid").length;
    const pending = payrollRowsComputed.filter((row) => row.status === "Pending").length;
    const exceptions = payrollRowsComputed.filter(
      (row) => row.exceptions.missingBank || row.exceptions.missingSalary || row.exceptions.negativePayroll || row.exceptions.duplicatePayroll
    ).length;

    return { activeStaff, monthlyAmount, processed, pending, exceptions };
  }, [payrollFilteredStaff, payrollRowsComputed]);

  const payrollSummary = useMemo(() => {
    const totalGross = payrollRowsComputed.reduce((sum, row) => sum + row.baseSalary + row.allowances + row.manual, 0);
    const totalDeductions = payrollRowsComputed.reduce((sum, row) => sum + row.deductions, 0);
    const totalNet = payrollRowsComputed.reduce((sum, row) => sum + row.netPay, 0);
    const missingPayrollData = payrollRowsComputed.filter((row) => row.exceptions.missingBank || row.exceptions.missingSalary).length;
    const payrollExceptions = payrollRowsComputed.filter(
      (row) => row.exceptions.missingBank || row.exceptions.missingSalary || row.exceptions.negativePayroll || row.exceptions.duplicatePayroll
    ).length;

    return {
      totalStaff: payrollRowsComputed.length,
      totalGross,
      totalDeductions,
      totalNet,
      missingPayrollData,
      payrollExceptions,
    };
  }, [payrollRowsComputed]);

  const payrollExceptionsQueue = useMemo(() => {
    const entries: Array<{ id: string; issue: string; staffName: string; severity: "warning" | "critical" }> = [];

    for (const row of payrollRowsComputed) {
      if (row.exceptions.missingBank) {
        entries.push({ id: `${row.member.id}-bank`, issue: "Missing bank details", staffName: row.member.fullName, severity: "critical" });
      }
      if (row.exceptions.missingSalary) {
        entries.push({ id: `${row.member.id}-salary`, issue: "Missing salary data", staffName: row.member.fullName, severity: "critical" });
      }
      if (row.exceptions.negativePayroll) {
        entries.push({ id: `${row.member.id}-negative`, issue: "Negative payroll", staffName: row.member.fullName, severity: "critical" });
      }
      if (row.exceptions.duplicatePayroll) {
        entries.push({ id: `${row.member.id}-duplicate`, issue: "Duplicate payroll run", staffName: row.member.fullName, severity: "warning" });
      }
      if (row.status === "Held") {
        entries.push({ id: `${row.member.id}-hold`, issue: "Failed payment / payroll on hold", staffName: row.member.fullName, severity: "warning" });
      }
    }

    return entries.slice(0, 20);
  }, [payrollRowsComputed]);

  const attendanceTrendData = useMemo(
    () =>
      Array.from({ length: 14 }).map((_, index) => {
        const d = new Date();
        d.setDate(d.getDate() - (13 - index));
        const dateKey = d.toISOString().slice(0, 10);
        const rows = attendanceRows.filter((row) => row.date.slice(0, 10) === dateKey);
        const presentCount = rows.filter((row) => row.status === "PRESENT").length;
        const percentage = rows.length > 0 ? (presentCount / rows.length) * 100 : 0;

        return {
          date: d.toLocaleString("en-US", { month: "short", day: "numeric" }),
          percentage,
        };
      }),
    [attendanceRows]
  );

  const payrollExceptionTrendData = useMemo(
    () =>
      Array.from({ length: 6 }).map((_, index) => {
        const d = new Date();
        d.setMonth(d.getMonth() - (5 - index));
        const month = d.getMonth() + 1;
        const year = d.getFullYear();
        const processed = payrollRows.filter((row) => row.month === month && row.year === year).length;
        const expected = staff.length;
        const pending = Math.max(0, expected - processed);
        const exceptions = Math.max(0, Math.round(pending * 0.4));
        const resolved = Math.max(0, Math.round(exceptions * 0.6));

        return {
          month: d.toLocaleString("en-US", { month: "short" }),
          exceptions,
          resolved,
          pending: Math.max(0, exceptions - resolved),
        };
      }),
    [payrollRows, staff.length]
  );

  const selectedPayrollRow = payrollRowsComputed.find((row) => row.member.id === selectedPayrollStaffId) ?? null;
  const selectedStaffProfile =
    staffDirectoryRows.find((member) => member.id === selectedStaffId) ??
    staffDirectoryRows[0] ??
    null;

  const totalEmployeesForRun = payrollRowsComputed.filter((row) => row.status === "Pending" && !row.exceptions.missingSalary && !row.exceptions.negativePayroll).length;
  const estimatedPayout = payrollRowsComputed
    .filter((row) => row.status === "Pending" && !row.exceptions.missingSalary && !row.exceptions.negativePayroll)
    .reduce((sum, row) => sum + row.netPay, 0);

  function updateOnboarding(updates: Partial<OnboardingForm>) {
    setOnboardingForm((prev) => ({ ...prev, ...updates }));
  }

  function canProceed(step: OnboardingStep) {
    if (step === 1) {
      return Boolean(onboardingForm.fullName && onboardingForm.dob && onboardingForm.mobile && onboardingForm.email && onboardingForm.emergencyContact);
    }
    if (step === 2) {
      if (!onboardingForm.currentAddress || !onboardingForm.city || !onboardingForm.district || !onboardingForm.state || !onboardingForm.pincode || !onboardingForm.country) {
        return false;
      }
      if (onboardingForm.sameAsCurrentAddress) {
        return true;
      }
      return Boolean(
        onboardingForm.permanentAddress &&
          onboardingForm.permanentCity &&
          onboardingForm.permanentDistrict &&
          onboardingForm.permanentState &&
          onboardingForm.permanentPincode &&
          onboardingForm.permanentCountry
      );
    }
    if (step === 3) {
      if (!onboardingForm.institutionAssignment || !onboardingForm.designation || !onboardingForm.joiningDate) {
        return false;
      }
      if (onboardingForm.staffType === "TEACHING") {
        return Boolean(onboardingForm.subjectSpecialization && onboardingForm.qualification && onboardingForm.experience);
      }
      return Boolean(onboardingForm.functionalRole && onboardingForm.department);
    }

    return Boolean(
      onboardingForm.monthlySalary &&
        onboardingForm.bankAccountNumber &&
        onboardingForm.ifscCode &&
        onboardingForm.pan &&
        onboardingForm.appointmentLetter &&
        onboardingForm.idProof &&
        onboardingForm.addressProof
    );
  }

  async function submitOnboarding(mode: "draft" | "activate" | "addAnother") {
    if (mode === "draft") {
      const draft: OnboardingDraft = {
        id: `draft-${Date.now()}`,
        fullName: onboardingForm.fullName || "Untitled draft",
        staffType: onboardingForm.staffType,
        employmentStatus: onboardingForm.employmentStatus,
        designation: onboardingForm.designation || "Not set",
        createdAt: new Date().toISOString(),
      };
      setOnboardingDrafts((prev) => [draft, ...prev]);
      toast.success("Onboarding draft saved");
      return;
    }

    if (!canProceed(4)) {
      toast.error("Complete all mandatory onboarding fields before submitting");
      return;
    }

    setOnboardingSaving(true);
    try {
      await onAddStaff({
        collegeId: onboardingForm.institutionAssignment,
        fullName: onboardingForm.fullName,
        email: onboardingForm.email,
        mobile: onboardingForm.mobile,
        role: onboardingForm.staffType === "TEACHING" ? "ADMISSIONS_OPERATOR" : "HR_OPERATOR",
        staffType: onboardingForm.staffType,
        designation: onboardingForm.designation,
        employmentType: onboardingForm.employmentType,
        joiningDate: onboardingForm.joiningDate || null,
        employmentStatus: onboardingForm.employmentStatus,

        // Personal profile (step 1)
        dob: onboardingForm.dob || null,
        gender: onboardingForm.gender,
        emergencyContact: onboardingForm.emergencyContact || null,

        // Address (step 2) — send granular fields
        currentAddress: onboardingForm.currentAddress || null,
        currentCity: onboardingForm.city || null,
        currentDistrict: onboardingForm.district || null,
        currentState: onboardingForm.state || null,
        currentPincode: onboardingForm.pincode || null,
        currentCountry: onboardingForm.country || null,
        permanentAddress: onboardingForm.sameAsCurrentAddress ? onboardingForm.currentAddress || null : onboardingForm.permanentAddress || null,
        permanentCity: onboardingForm.sameAsCurrentAddress ? onboardingForm.city || null : onboardingForm.permanentCity || null,
        permanentDistrict: onboardingForm.sameAsCurrentAddress ? onboardingForm.district || null : onboardingForm.permanentDistrict || null,
        permanentState: onboardingForm.sameAsCurrentAddress ? onboardingForm.state || null : onboardingForm.permanentState || null,
        permanentPincode: onboardingForm.sameAsCurrentAddress ? onboardingForm.pincode || null : onboardingForm.permanentPincode || null,
        permanentCountry: onboardingForm.sameAsCurrentAddress ? onboardingForm.country || null : onboardingForm.permanentCountry || null,

        // Employment (step 3)
        department: onboardingForm.department || null,
        functionalRole: onboardingForm.functionalRole || null,
        subjectSpecialization: onboardingForm.subjectSpecialization || null,
        qualification: onboardingForm.qualification || null,
        experience: onboardingForm.experience || null,
        customRoleId: onboardingForm.customRoleId || null,

        // Payroll (step 4)
        monthlySalary: Number(onboardingForm.monthlySalary || 0),
        bankAccountNumber: onboardingForm.bankAccountNumber || null,
        ifscCode: onboardingForm.ifscCode || null,
        pan: onboardingForm.pan || null,
        pfUan: onboardingForm.pfUan || null,
        paymentMode: onboardingForm.paymentMode,
      });

      toast.success("Employee submitted and activated");
      if (mode === "addAnother") {
        setOnboardingForm(defaultOnboardingForm(colleges));
        setOnboardingStep(1);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to submit onboarding");
    } finally {
      setOnboardingSaving(false);
    }
  }

  async function markAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttendanceLoading(true);
    try {
      await markAttendanceMutation.mutateAsync({
        staffId: attendanceStaffId,
        date: attendanceDate,
        status: attendanceStatus,
      });
      toast.success("Attendance saved");
    } catch (error) {
      console.error(error);
      toast.error("Failed to save attendance");
    } finally {
      setAttendanceLoading(false);
    }
  }

  async function runBatchPayroll() {
    setRunPayrollLoading(true);
    try {
      const candidates = payrollRowsComputed.filter((row) => row.status === "Pending" && !row.exceptions.missingSalary && !row.exceptions.negativePayroll);
      if (candidates.length === 0) {
        toast.error("No pending staff available for payroll run");
        return;
      }

      for (const row of candidates) {
        if (row.exceptions.missingBank) {
          continue;
        }
        await onProcessPayroll({
          staffId: row.member.id,
          amount: Number(row.netPay.toFixed(2)),
          month: payrollMonth,
          year: payrollYear,
          includeAttendanceDeductions,
          includeLeaveDeductions,
          includeBonuses,
          includeManualAdjustments,
        });
      }

      toast.success("Monthly payroll batch processed");
      setShowRunPayrollModal(false);
    } catch (error) {
      console.error(error);
      toast.error("Payroll run failed");
    } finally {
      setRunPayrollLoading(false);
    }
  }

  function togglePayrollHold(staffId: string) {
    setPayrollHoldByStaff((prev) => ({ ...prev, [staffId]: !prev[staffId] }));
  }

  async function markPayslipPaid(row: typeof payrollRowsComputed[number]) {
    const record = row.processedRecords[0];
    if (!record) {
      toast.error("No payroll record found for this month. Process payroll first.");
      return;
    }
    await onUpdatePayrollStatus(record.id, "PAID");
  }

  function generatePayslip(staffId: string) {
    toast.success(`Payslip generated for ${staffDirectoryRows.find((s) => s.id === staffId)?.fullName ?? "staff"}`);
  }

  function downloadPayslipPdf(staffId: string) {
    const row = payrollRowsComputed.find((item) => item.member.id === staffId);
    if (!row || typeof window === "undefined") {
      return;
    }

    const content = [
      `CampusGrid Payslip`,
      `Staff: ${row.member.fullName}`,
      `Month: ${new Date(payrollYear, payrollMonth - 1).toLocaleString("en-US", { month: "long" })} ${payrollYear}`,
      `Basic Salary: INR ${row.baseSalary.toLocaleString()}`,
      `Allowances: INR ${row.allowances.toLocaleString()}`,
      `Deductions: INR ${row.deductions.toLocaleString()}`,
      `Net Pay: INR ${row.netPay.toLocaleString()}`,
    ].join("\n");

    const blob = new Blob([content], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${row.member.fullName.replace(/\s+/g, "_")}-${payrollMonth}-${payrollYear}-payslip.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function emailPayslip(staffId: string) {
    const row = payrollRowsComputed.find((item) => item.member.id === staffId);
    toast.success(`Payslip emailed to ${row?.member.email ?? "staff"}`);
  }

  function openStaffProfile(mode: "view" | "edit", memberId: string) {
    const member = staffDirectoryRows.find((item) => item.id === memberId);
    if (!member) {
      return;
    }

    setSelectedStaffId(member.id);
    setStaffEditForm({
      fullName: member.fullName,
      email: member.email,
      mobile: member.mobile,
      designation: member.designation,
      staffType: member.staffType,
      employmentStatus: member.employmentStatus,
      salary: String(member.salary),
      bankAccountNumber: member.bankAccountNumber,
      customRoleId: member.customRoleId ?? "",
    });
    setStaffProfileMode(mode);
  }

  function savePeoplePreset() {
    const name = peoplePresetName.trim();
    if (!name) {
      toast.error("Preset name is required.");
      return;
    }

    const next = upsertSavedPreset<HrPeoplePresetValues>(HR_PEOPLE_PRESET_KEY, name, {
      query: peopleQuery,
      collegeId: peopleCollegeFilter,
      status: peopleStatusFilter,
    });
    setSavedPeoplePresets(next);
    setPeoplePresetName("");
    toast.success("People filter preset saved.");
  }

  function applyPeoplePresetById(presetId: string) {
    setSelectedPeoplePresetId(presetId);
    const preset = savedPeoplePresets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setPeopleQuery(preset.values.query);
    setPeopleCollegeFilter(preset.values.collegeId);
    setPeopleStatusFilter(preset.values.status);
  }

  function deletePeoplePreset() {
    if (!selectedPeoplePresetId) {
      return;
    }
    const next = removeSavedPreset<HrPeoplePresetValues>(HR_PEOPLE_PRESET_KEY, selectedPeoplePresetId);
    setSavedPeoplePresets(next);
    setSelectedPeoplePresetId("");
    toast.success("People preset deleted.");
  }

  function exportPeopleCsv() {
    exportRowsToCsv(
      `hr-people-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Staff ID", "Name", "Email", "Mobile", "Designation", "College", "Status", "Salary"],
      filteredStaffDirectoryRows.map((member) => [
        member.id,
        member.fullName,
        member.email,
        member.mobile,
        member.designation,
        collegeNameById[member.collegeId] ?? "",
        member.employmentStatus,
        String(member.salary ?? 0),
      ])
    );
  }

  function savePayrollPreset() {
    const name = payrollPresetName.trim();
    if (!name) {
      toast.error("Preset name is required.");
      return;
    }
    const next = upsertSavedPreset<HrPayrollPresetValues>(HR_PAYROLL_PRESET_KEY, name, {
      month: payrollMonth,
      year: payrollYear,
      institution: payrollInstitution,
      staffType: payrollStaffType,
      employmentStatus: payrollEmploymentStatus,
    });
    setSavedPayrollPresets(next);
    setPayrollPresetName("");
    toast.success("Payroll preset saved.");
  }

  function applyPayrollPresetById(presetId: string) {
    setSelectedPayrollPresetId(presetId);
    const preset = savedPayrollPresets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setPayrollMonth(Number(preset.values.month));
    setPayrollYear(Number(preset.values.year));
    setPayrollInstitution(preset.values.institution);
    setPayrollStaffType(preset.values.staffType);
    setPayrollEmploymentStatus(preset.values.employmentStatus);
  }

  function deletePayrollPreset() {
    if (!selectedPayrollPresetId) {
      return;
    }
    const next = removeSavedPreset<HrPayrollPresetValues>(HR_PAYROLL_PRESET_KEY, selectedPayrollPresetId);
    setSavedPayrollPresets(next);
    setSelectedPayrollPresetId("");
    toast.success("Payroll preset deleted.");
  }

  function exportPayrollCsv() {
    exportRowsToCsv(
      `hr-payroll-${payrollMonth}-${payrollYear}.csv`,
      ["Staff ID", "Name", "Designation", "Base Salary", "Allowances", "Deductions", "Net Pay", "Status"],
      payrollRowsComputed.map((row) => [
        row.member.id,
        row.member.fullName,
        row.member.designation,
        String(row.baseSalary),
        String(row.allowances),
        String(row.deductions),
        String(row.netPay),
        row.status,
      ])
    );
  }

  async function saveStaffProfile() {
    if (!selectedStaffProfile) {
      return;
    }

    const nextRole = inferRoleFromDraft(staffEditForm.staffType, staffEditForm.designation, selectedStaffProfile.role);
    const isActive = staffEditForm.employmentStatus !== "INACTIVE";

    await onUpdateStaff(selectedStaffProfile.id, {
      fullName: staffEditForm.fullName,
      email: staffEditForm.email,
      mobile: staffEditForm.mobile,
      role: nextRole,
      isActive,
      designation: staffEditForm.designation,
      staffType: staffEditForm.staffType,
      employmentType: staffEditForm.staffType === "TEACHING" ? "FULL_TIME" : "FULL_TIME",
      customRoleId: staffEditForm.customRoleId || null,
    });

    // Persist salary/bank to the dedicated salary config endpoint
    await onSaveSalaryConfig(selectedStaffProfile.id, {
      basicSalary: Number(staffEditForm.salary || 0),
      bankAccountNumber: staffEditForm.bankAccountNumber || null,
    });

    // Keep cosmetic overrides for designation/staffType/employmentStatus in local state
    // (refreshAll will update salary/bank from the API)
    setStaffProfileOverrides((prev) => ({
      ...prev,
      [selectedStaffProfile.id]: {
        ...prev[selectedStaffProfile.id],
        fullName: staffEditForm.fullName,
        email: staffEditForm.email,
        mobile: staffEditForm.mobile,
        designation: staffEditForm.designation,
        staffType: staffEditForm.staffType,
        employmentStatus: staffEditForm.employmentStatus,
      },
    }));
    setStaffProfileMode("view");
  }

  async function deleteSelectedStaff() {
    if (!selectedStaffProfile) {
      return;
    }

    const confirmed = window.confirm(
      `Delete staff ${selectedStaffProfile.fullName}? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    await onDeleteStaff(selectedStaffProfile.id);
    setSelectedStaffId("");
    setStaffProfileMode("directory");
    setStaffProfileOverrides((prev) => {
      const next = { ...prev };
      delete next[selectedStaffProfile.id];
      return next;
    });
  }

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People Operations</h1>
        <p className="mt-1 text-sm text-slate-500">Staff onboarding, payroll processing, attendance, and leave workflows within CampusGrid HR.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard title="Total Staff" value={String(staffDirectoryRows.length)} subtitle="Campus workforce" icon={UserRound} tone="blue" />
        <SummaryCard title="Active Staff" value={String(staffDirectoryRows.filter((member) => member.employmentStatus === "ACTIVE").length)} subtitle="Current operations" icon={BadgeCheck} tone="emerald" />
        <SummaryCard title="Payroll Month" value={`INR ${(payrollKpis.monthlyAmount / 1000).toFixed(1)}K`} subtitle="Expected payout" icon={Wallet} tone="indigo" />
        <SummaryCard title="Pending Leaves" value={String(leaveRows.filter((row) => row.status === "PENDING").length)} subtitle="Needs approval" icon={FileCheck2} tone="amber" />
        <SummaryCard title="Payroll Exceptions" value={String(payrollExceptionsQueue.length)} subtitle="Needs fixes" icon={ShieldAlert} tone="rose" />
      </div>

      <section className="rounded-3xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <WorkspaceNavButton label="People Operations" active={activeWorkspace === "people"} onClick={() => setActiveWorkspace("people")} />
          <WorkspaceNavButton label="Staff Onboarding" active={activeWorkspace === "onboarding"} onClick={() => setActiveWorkspace("onboarding")} />
          <WorkspaceNavButton label="Process Payroll" active={activeWorkspace === "payroll"} onClick={() => setActiveWorkspace("payroll")} />
          <WorkspaceNavButton label="Attendance" active={activeWorkspace === "attendance"} onClick={() => setActiveWorkspace("attendance")} />
          <WorkspaceNavButton label="Leave Management" active={activeWorkspace === "leave"} onClick={() => setActiveWorkspace("leave")} />
        </div>
      </section>

      <main className="space-y-5">
          {activeWorkspace === "people" && (
            <>
              {staffProfileMode === "directory" && (
                <div className="grid gap-4 xl:grid-cols-[7fr_3fr]">
                  <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">Staff Directory</div>
                    </div>
                    <div className="border-b border-slate-100 px-4 py-3">
                      <div className="grid gap-2 md:grid-cols-3">
                        <input value={peopleQuery} onChange={(event) => setPeopleQuery(event.target.value)} placeholder="Search name, email, mobile" className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
                        <select value={peopleCollegeFilter} onChange={(event) => setPeopleCollegeFilter(event.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
                          <option value="ALL">All Colleges</option>
                          {colleges.map((college) => (
                            <option key={college.id} value={college.id}>{college.name}</option>
                          ))}
                        </select>
                        <select value={peopleStatusFilter} onChange={(event) => setPeopleStatusFilter(event.target.value as "ALL" | EmploymentStatus)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
                          <option value="ALL">All Status</option>
                          <option value="ACTIVE">Active</option>
                          <option value="PROBATION">Probation</option>
                          <option value="INACTIVE">Inactive</option>
                        </select>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input value={peoplePresetName} onChange={(event) => setPeoplePresetName(event.target.value)} placeholder="Preset name" className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
                        <button type="button" onClick={savePeoplePreset} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Save Preset</button>
                        <select value={selectedPeoplePresetId} onChange={(event) => applyPeoplePresetById(event.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
                          <option value="">Apply saved preset</option>
                          {savedPeoplePresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>{preset.name}</option>
                          ))}
                        </select>
                        <button type="button" onClick={deletePeoplePreset} disabled={!selectedPeoplePresetId} className="rounded-xl bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60">Delete</button>
                        <button type="button" onClick={exportPeopleCsv} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">Export CSV</button>
                      </div>
                    </div>
                    <div className="max-h-[620px] overflow-auto">
                      <table className="min-w-full divide-y divide-slate-100">
                        <thead>
                          <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                            <th className="px-4 py-3">Staff</th>
                            <th className="px-4 py-3">Email</th>
                            <th className="px-4 py-3">Mobile</th>
                            <th className="px-4 py-3">Designation</th>
                            <th className="px-4 py-3">College</th>
                            <th className="px-4 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {filteredStaffDirectoryRows.map((member) => (
                            <tr
                              key={member.id}
                              className={`cursor-pointer hover:bg-slate-50/70 ${selectedStaffId === member.id ? "bg-slate-50" : ""}`}
                              onClick={() => setSelectedStaffId(member.id)}
                            >
                              <td className="px-4 py-3 font-medium text-slate-800">{member.fullName}</td>
                              <td className="px-4 py-3 text-slate-600">{member.email}</td>
                              <td className="px-4 py-3 text-slate-600">{member.mobile}</td>
                              <td className="px-4 py-3 text-slate-700">{member.designation}</td>
                              <td className="px-4 py-3 text-slate-600">{collegeNameById[member.collegeId] ?? "--"}</td>
                              <td className="px-4 py-3"><StatusPill status={member.employmentStatus} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {!filteredStaffDirectoryRows.length && (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">No staff found for selected filters.</div>
                  )}

                  <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                    {selectedStaffProfile ? (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-900 text-white">
                            {selectedStaffProfile.fullName.slice(0, 1)}
                          </div>
                          <div>
                            <p className="text-base font-semibold text-slate-900">{selectedStaffProfile.fullName}</p>
                            <p className="text-xs text-slate-500">{selectedStaffProfile.designation}</p>
                          </div>
                        </div>
                        <div className="mt-4 space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                          <DetailRow label="College" value={collegeNameById[selectedStaffProfile.collegeId] ?? "--"} />
                          <DetailRow label="Staff Type" value={selectedStaffProfile.staffType} />
                          <DetailRow label="Status" value={selectedStaffProfile.employmentStatus} />
                          <DetailRow label="Salary" value={`INR ${(selectedStaffProfile.salary / 1000).toFixed(1)}K`} />
                        </div>
                        <div className="mt-4 grid gap-2">
                          <button type="button" className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={() => openStaffProfile("view", selectedStaffProfile.id)}>
                            View Profile
                          </button>
                          <button type="button" className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700" onClick={() => openStaffProfile("edit", selectedStaffProfile.id)}>
                            Edit Profile
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-slate-500">No staff records available.</p>
                    )}
                  </div>
                </div>
              )}

              {staffProfileMode !== "directory" && selectedStaffProfile && (
                <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">Staff Profile</p>
                      <h2 className="mt-1 text-xl font-semibold text-slate-900">
                        {staffProfileMode === "edit" ? "Edit Staff Profile" : "Full Staff Profile"}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">{selectedStaffProfile.fullName} · {selectedStaffProfile.designation}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700" onClick={() => setStaffProfileMode("directory")}>Back to Directory</button>
                      {staffProfileMode === "view" && (
                        <button type="button" className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={() => openStaffProfile("edit", selectedStaffProfile.id)}>Edit Profile</button>
                      )}
                      {staffProfileMode === "edit" && (
                        <button type="button" className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white" onClick={() => void saveStaffProfile()}>Save Changes</button>
                      )}
                      {canManageStaff && (
                        <button type="button" className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-medium text-white" onClick={() => void deleteSelectedStaff()}>Delete Staff</button>
                      )}
                    </div>
                  </div>

                  {staffProfileMode === "view" && (
                    <div className="mt-5 grid gap-4 xl:grid-cols-2">
                      <DetailSection title="Personal Details" description="Core staff and contact identity data.">
                        <DetailRow label="Full Name" value={selectedStaffProfile.fullName} />
                        <DetailRow label="Email" value={selectedStaffProfile.email} />
                        <DetailRow label="Mobile" value={selectedStaffProfile.mobile} />
                        <DetailRow label="Staff Type" value={selectedStaffProfile.staffType} />
                      </DetailSection>
                      <DetailSection title="Employment Details" description="Role, institution, and current HR status.">
                        <DetailRow label="Designation" value={selectedStaffProfile.designation} />
                        <DetailRow label="College" value={collegeNameById[selectedStaffProfile.collegeId] ?? "--"} />
                        <DetailRow label="Status" value={selectedStaffProfile.employmentStatus} />
                        <DetailRow label="Salary" value={`INR ${(selectedStaffProfile.salary / 1000).toFixed(1)}K`} />
                      </DetailSection>
                    </div>
                  )}

                  {staffProfileMode === "edit" && (
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <label className="text-sm text-slate-600">Full Name<input value={staffEditForm.fullName} onChange={(event) => setStaffEditForm((prev) => ({ ...prev, fullName: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                      <label className="text-sm text-slate-600">Email<input value={staffEditForm.email} onChange={(event) => setStaffEditForm((prev) => ({ ...prev, email: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                      <label className="text-sm text-slate-600">Mobile<input value={staffEditForm.mobile} onChange={(event) => setStaffEditForm((prev) => ({ ...prev, mobile: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                      <label className="text-sm text-slate-600">Designation<input value={staffEditForm.designation} onChange={(event) => setStaffEditForm((prev) => ({ ...prev, designation: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                      <label className="text-sm text-slate-600">Staff Type<select value={staffEditForm.staffType} onChange={(event) => setStaffEditForm((prev) => ({ ...prev, staffType: event.target.value as StaffType }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"><option value="TEACHING">Teaching</option><option value="EXECUTIVE">Executive</option></select></label>
                      <label className="text-sm text-slate-600">Employment Status<select value={staffEditForm.employmentStatus} onChange={(event) => setStaffEditForm((prev) => ({ ...prev, employmentStatus: event.target.value as EmploymentStatus }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"><option value="ACTIVE">Active</option><option value="PROBATION">Probation</option><option value="INACTIVE">Inactive</option></select></label>
                      <label className="text-sm text-slate-600">Custom Role (Optional)<select value={staffEditForm.customRoleId} onChange={(event) => setStaffEditForm((prev) => ({ ...prev, customRoleId: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">None</option>{customRoles.map((role) => (<option key={role.id} value={role.id}>{role.name}</option>))}</select></label>
                      <label className="text-sm text-slate-600">Salary<input type="number" value={staffEditForm.salary} onChange={(event) => setStaffEditForm((prev) => ({ ...prev, salary: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                      <label className="text-sm text-slate-600">Bank Account Number<input value={staffEditForm.bankAccountNumber} onChange={(event) => setStaffEditForm((prev) => ({ ...prev, bankAccountNumber: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-2">
                <AttendanceTrendChart data={attendanceTrendData} height={280} title="Attendance Trend" targetPercentage={95} />
                <PayrollExceptionTrendChart data={payrollExceptionTrendData} height={280} title="Payroll Exception Trend" />
              </div>
            </>
          )}

          {activeWorkspace === "onboarding" && (
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Staff Onboarding Workspace</h2>
                  <p className="mt-1 text-sm text-slate-500">Dedicated 4-step onboarding flow for scalable hiring operations.</p>
                </div>
                <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">Drafts: {onboardingDrafts.length}</div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                {([1, 2, 3, 4] as OnboardingStep[]).map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => setOnboardingStep(step)}
                    className={`rounded-2xl border px-3 py-2 text-left text-sm ${onboardingStep === step ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-700"}`}
                  >
                    <p className="text-xs uppercase tracking-wide opacity-80">Step {step}</p>
                    <p className="mt-1 font-medium">{stepLabels[step]}</p>
                  </button>
                ))}
              </div>

              <div className="mt-5 space-y-4">
                {onboardingStep === 1 && (
                  <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <h3 className="text-sm font-semibold">Personal Information</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <InputField label="Full Name" value={onboardingForm.fullName} onChange={(value) => updateOnboarding({ fullName: value })} />
                      <SelectField
                        label="Staff Type"
                        value={onboardingForm.staffType}
                        onChange={(value) => updateOnboarding({ staffType: value as StaffType })}
                        options={[
                          { label: "Teaching", value: "TEACHING" },
                          { label: "Executive", value: "EXECUTIVE" },
                        ]}
                      />
                      <InputField label="DOB" type="date" value={onboardingForm.dob} onChange={(value) => updateOnboarding({ dob: value })} />
                      <SelectField
                        label="Gender"
                        value={onboardingForm.gender}
                        onChange={(value) => updateOnboarding({ gender: value as "MALE" | "FEMALE" | "OTHER" })}
                        options={[
                          { label: "Male", value: "MALE" },
                          { label: "Female", value: "FEMALE" },
                          { label: "Other", value: "OTHER" },
                        ]}
                      />
                      <InputField label="Mobile" value={onboardingForm.mobile} onChange={(value) => updateOnboarding({ mobile: value })} />
                      <InputField label="Email" type="email" value={onboardingForm.email} onChange={(value) => updateOnboarding({ email: value })} />
                      <InputField label="Emergency Contact" value={onboardingForm.emergencyContact} onChange={(value) => updateOnboarding({ emergencyContact: value })} />
                      <FileField label="Staff Photo Upload" onChange={(file) => updateOnboarding({ photo: file })} file={onboardingForm.photo} />
                    </div>
                  </section>
                )}

                {onboardingStep === 2 && (
                  <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <h3 className="text-sm font-semibold">Address Information</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <InputField label="Current Address" value={onboardingForm.currentAddress} onChange={(value) => updateOnboarding({ currentAddress: value })} className="md:col-span-2" />
                      <InputField label="City" value={onboardingForm.city} onChange={(value) => updateOnboarding({ city: value })} />
                      <InputField label="District" value={onboardingForm.district} onChange={(value) => updateOnboarding({ district: value })} />
                      <InputField label="State" value={onboardingForm.state} onChange={(value) => updateOnboarding({ state: value })} />
                      <InputField label="Pincode" value={onboardingForm.pincode} onChange={(value) => updateOnboarding({ pincode: value.replace(/\D/g, "") })} />
                      <InputField label="Country" value={onboardingForm.country} onChange={(value) => updateOnboarding({ country: value })} />
                    </div>

                    <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={onboardingForm.sameAsCurrentAddress}
                        onChange={(event) => updateOnboarding({ sameAsCurrentAddress: event.target.checked })}
                      />
                      Permanent address same as current
                    </label>

                    {!onboardingForm.sameAsCurrentAddress && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <InputField label="Permanent Address" value={onboardingForm.permanentAddress} onChange={(value) => updateOnboarding({ permanentAddress: value })} className="md:col-span-2" />
                        <InputField label="Permanent City" value={onboardingForm.permanentCity} onChange={(value) => updateOnboarding({ permanentCity: value })} />
                        <InputField label="Permanent District" value={onboardingForm.permanentDistrict} onChange={(value) => updateOnboarding({ permanentDistrict: value })} />
                        <InputField label="Permanent State" value={onboardingForm.permanentState} onChange={(value) => updateOnboarding({ permanentState: value })} />
                        <InputField label="Permanent Pincode" value={onboardingForm.permanentPincode} onChange={(value) => updateOnboarding({ permanentPincode: value.replace(/\D/g, "") })} />
                        <InputField label="Permanent Country" value={onboardingForm.permanentCountry} onChange={(value) => updateOnboarding({ permanentCountry: value })} />
                      </div>
                    )}
                  </section>
                )}

                {onboardingStep === 3 && (
                  <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <h3 className="text-sm font-semibold">Employment Information</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <SelectField
                        label="Institution Assignment"
                        value={onboardingForm.institutionAssignment}
                        onChange={(value) => updateOnboarding({ institutionAssignment: value })}
                        options={colleges.map((college) => ({ label: college.name, value: college.id }))}
                      />
                      <InputField label="Designation" value={onboardingForm.designation} onChange={(value) => updateOnboarding({ designation: value })} />
                      <SelectField
                        label="Employment Type"
                        value={onboardingForm.employmentType}
                        onChange={(value) => updateOnboarding({ employmentType: value as "FULL_TIME" | "PART_TIME" | "CONTRACT" })}
                        options={[
                          { label: "Full Time", value: "FULL_TIME" },
                          { label: "Part Time", value: "PART_TIME" },
                          { label: "Contract", value: "CONTRACT" },
                        ]}
                      />
                      <InputField label="Joining Date" type="date" value={onboardingForm.joiningDate} onChange={(value) => updateOnboarding({ joiningDate: value })} />
                      <SelectField
                        label="Employment Status"
                        value={onboardingForm.employmentStatus}
                        onChange={(value) => updateOnboarding({ employmentStatus: value as EmploymentStatus })}
                        options={[
                          { label: "Active", value: "ACTIVE" },
                          { label: "Probation", value: "PROBATION" },
                          { label: "Inactive", value: "INACTIVE" },
                        ]}
                      />
                      <SelectField
                        label="Custom Role (Optional)"
                        value={onboardingForm.customRoleId}
                        onChange={(value) => updateOnboarding({ customRoleId: value })}
                        options={[
                          { label: "None", value: "" },
                          ...customRoles.map((role) => ({ label: role.name, value: role.id })),
                        ]}
                      />
                    </div>

                    {onboardingForm.staffType === "TEACHING" ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <InputField label="Subject Specialization" value={onboardingForm.subjectSpecialization} onChange={(value) => updateOnboarding({ subjectSpecialization: value })} />
                        <InputField label="Qualification" value={onboardingForm.qualification} onChange={(value) => updateOnboarding({ qualification: value })} />
                        <InputField label="Experience" value={onboardingForm.experience} onChange={(value) => updateOnboarding({ experience: value })} />
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <InputField label="Functional Role" value={onboardingForm.functionalRole} onChange={(value) => updateOnboarding({ functionalRole: value })} />
                        <InputField label="Department" value={onboardingForm.department} onChange={(value) => updateOnboarding({ department: value })} />
                      </div>
                    )}
                  </section>
                )}

                {onboardingStep === 4 && (
                  <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <h3 className="text-sm font-semibold">Payroll + Documents</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <InputField label="Monthly Salary" type="number" value={onboardingForm.monthlySalary} onChange={(value) => updateOnboarding({ monthlySalary: value })} />
                      <InputField label="Bank Account Number" value={onboardingForm.bankAccountNumber} onChange={(value) => updateOnboarding({ bankAccountNumber: value })} />
                      <InputField label="IFSC Code" value={onboardingForm.ifscCode} onChange={(value) => updateOnboarding({ ifscCode: value.toUpperCase() })} />
                      <InputField label="PAN" value={onboardingForm.pan} onChange={(value) => updateOnboarding({ pan: value.toUpperCase() })} />
                      <InputField label="PF/UAN (Optional)" value={onboardingForm.pfUan} onChange={(value) => updateOnboarding({ pfUan: value })} />
                      <SelectField
                        label="Payment Mode"
                        value={onboardingForm.paymentMode}
                        onChange={(value) => updateOnboarding({ paymentMode: value as "BANK_TRANSFER" | "CASH" | "UPI" })}
                        options={[
                          { label: "Bank Transfer", value: "BANK_TRANSFER" },
                          { label: "Cash", value: "CASH" },
                          { label: "UPI", value: "UPI" },
                        ]}
                      />

                      <FileField label="Appointment Letter" file={onboardingForm.appointmentLetter} onChange={(file) => updateOnboarding({ appointmentLetter: file })} />
                      <FileField label="ID Proof" file={onboardingForm.idProof} onChange={(file) => updateOnboarding({ idProof: file })} />
                      <FileField label="Address Proof" file={onboardingForm.addressProof} onChange={(file) => updateOnboarding({ addressProof: file })} />
                      <MultiFileField label="Additional Documents Upload" files={onboardingForm.additionalDocuments} onChange={(files) => updateOnboarding({ additionalDocuments: files })} />
                    </div>
                  </section>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (onboardingStep > 1) {
                      setOnboardingStep((prev) => (prev - 1) as OnboardingStep);
                    }
                  }}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700"
                >
                  Previous
                </button>
                {onboardingStep < 4 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!canProceed(onboardingStep)) {
                        toast.error("Complete this step before continuing");
                        return;
                      }
                      setOnboardingStep((prev) => (prev + 1) as OnboardingStep);
                    }}
                    className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                  >
                    Next
                  </button>
                )}

                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void submitOnboarding("draft")}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                  >
                    Save Draft
                  </button>
                  <button
                    type="button"
                    disabled={onboardingSaving}
                    onClick={() => void submitOnboarding("activate")}
                    className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {onboardingSaving ? "Submitting..." : "Submit & Activate Employee"}
                  </button>
                  <button
                    type="button"
                    disabled={onboardingSaving}
                    onClick={() => void submitOnboarding("addAnother")}
                    className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    Submit & Add Another Staff
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeWorkspace === "payroll" && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <SummaryCard title="Total Active Staff" value={String(payrollKpis.activeStaff)} subtitle="Current scope" icon={UserRound} tone="blue" />
                <SummaryCard title="Monthly Payroll Amount" value={`INR ${(payrollKpis.monthlyAmount / 1000).toFixed(1)}K`} subtitle="Net payout" icon={Wallet} tone="emerald" />
                <SummaryCard title="Processed Staff" value={String(payrollKpis.processed)} subtitle="Batch complete" icon={BadgeCheck} tone="indigo" />
                <SummaryCard title="Pending Staff" value={String(payrollKpis.pending)} subtitle="Awaiting run" icon={CalendarClock} tone="amber" />
                <SummaryCard title="Payroll Exceptions" value={String(payrollKpis.exceptions)} subtitle="Needs fixes" icon={ShieldAlert} tone="rose" />
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.65fr_0.75fr]">
                <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">Process Payroll</h2>
                      <p className="mt-1 text-xs text-slate-500">Monthly batch payroll inside HR → People Operations.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowRunPayrollModal(true)}
                      disabled={!canManageStaff || !canViewPayroll}
                      className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      Review & Process Payroll
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <FieldLabel label="Payroll Month">
                      <select value={payrollMonth} onChange={(event) => setPayrollMonth(Number(event.target.value))} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm">
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                          <option key={month} value={month}>{new Date(2000, month - 1).toLocaleString("en-US", { month: "long" })}</option>
                        ))}
                      </select>
                    </FieldLabel>
                    <FieldLabel label="Payroll Year">
                      <input type="number" value={payrollYear} onChange={(event) => setPayrollYear(Number(event.target.value))} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm" />
                    </FieldLabel>
                    <FieldLabel label="Institution">
                      <select value={payrollInstitution} onChange={(event) => setPayrollInstitution(event.target.value)} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm">
                        <option value="ALL">All Institutions</option>
                        {colleges.map((college) => (
                          <option key={college.id} value={college.id}>{college.name}</option>
                        ))}
                      </select>
                    </FieldLabel>
                    <FieldLabel label="Staff Type">
                      <select value={payrollStaffType} onChange={(event) => setPayrollStaffType(event.target.value as "ALL" | StaffType)} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm">
                        <option value="ALL">All</option>
                        <option value="TEACHING">Teaching</option>
                        <option value="EXECUTIVE">Executive</option>
                      </select>
                    </FieldLabel>
                    <FieldLabel label="Employment Status" className="xl:col-span-2">
                      <select value={payrollEmploymentStatus} onChange={(event) => setPayrollEmploymentStatus(event.target.value as "ALL" | EmploymentStatus)} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm">
                        <option value="ALL">All</option>
                        <option value="ACTIVE">Active</option>
                        <option value="PROBATION">Probation</option>
                        <option value="INACTIVE">Inactive</option>
                      </select>
                    </FieldLabel>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input value={payrollPresetName} onChange={(event) => setPayrollPresetName(event.target.value)} placeholder="Preset name" className="rounded-xl bg-slate-100 px-3 py-2 text-sm" />
                    <button type="button" onClick={savePayrollPreset} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Save Preset</button>
                    <select value={selectedPayrollPresetId} onChange={(event) => applyPayrollPresetById(event.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
                      <option value="">Apply saved preset</option>
                      {savedPayrollPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={deletePayrollPreset} disabled={!selectedPayrollPresetId} className="rounded-xl bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60">Delete</button>
                    <button type="button" onClick={exportPayrollCsv} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">Export CSV</button>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-100 text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2">Staff ID</th>
                          <th className="px-3 py-2">Staff Name</th>
                          <th className="px-3 py-2">Designation</th>
                          <th className="px-3 py-2">Monthly Salary</th>
                          <th className="px-3 py-2">Allowances</th>
                          <th className="px-3 py-2">Deductions</th>
                          <th className="px-3 py-2">Net Pay</th>
                          <th className="px-3 py-2">Payment Status</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payrollRowsComputed.map((row) => (
                          <tr key={row.member.id}>
                            <td className="px-3 py-2 text-xs text-slate-500">{row.member.id}</td>
                            <td className="px-3 py-2 font-medium">{row.member.fullName}</td>
                            <td className="px-3 py-2">{row.member.designation}</td>
                            <td className="px-3 py-2">INR {(row.baseSalary / 1000).toFixed(1)}K</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={row.allowances}
                                onChange={(event) => setAllowancesByStaff((prev) => ({ ...prev, [row.member.id]: Number(event.target.value) }))}
                                className="w-24 rounded-lg bg-slate-100 px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={row.deductions}
                                onChange={(event) => setDeductionsByStaff((prev) => ({ ...prev, [row.member.id]: Number(event.target.value) }))}
                                className="w-24 rounded-lg bg-slate-100 px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2 font-semibold">INR {(row.netPay / 1000).toFixed(1)}K</td>
                            <td className="px-3 py-2">
                              <StatusPill status={row.status} />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex flex-wrap justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setSelectedPayrollStaffId(row.member.id)}
                                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                                >
                                  View Breakdown
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setManualAdjustmentsByStaff((prev) => ({ ...prev, [row.member.id]: (prev[row.member.id] ?? 0) + 100 }))}
                                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                                >
                                  Edit Adjustments
                                </button>
                                <button
                                  type="button"
                                  onClick={() => togglePayrollHold(row.member.id)}
                                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                                >
                                  Hold Payroll
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {selectedPayrollRow && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <h3 className="text-sm font-semibold">Payroll Breakdown · {selectedPayrollRow.member.fullName}</h3>
                      <div className="mt-2 grid gap-2 md:grid-cols-2 text-sm">
                        <DetailRow label="Basic Salary" value={`INR ${selectedPayrollRow.baseSalary.toLocaleString()}`} />
                        <DetailRow label="Allowances" value={`INR ${selectedPayrollRow.allowances.toLocaleString()}`} />
                        <DetailRow label="Deductions" value={`INR ${selectedPayrollRow.deductions.toLocaleString()}`} />
                        <DetailRow label="Manual Adjustments" value={`INR ${selectedPayrollRow.manual.toLocaleString()}`} />
                        <DetailRow label="Net Pay" value={`INR ${selectedPayrollRow.netPay.toLocaleString()}`} />
                        <DetailRow label="Status" value={selectedPayrollRow.status} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => generatePayslip(selectedPayrollRow.member.id)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">Generate Payslip</button>
                        <button type="button" onClick={() => downloadPayslipPdf(selectedPayrollRow.member.id)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">Download Payslip PDF</button>
                        <button type="button" onClick={() => emailPayslip(selectedPayrollRow.member.id)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">Email Payslip</button>
                        <button type="button" onClick={() => void markPayslipPaid(selectedPayrollRow)} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white">Mark as Paid</button>
                      </div>
                    </div>
                  )}
                </section>

                <aside className="xl:sticky xl:top-4 h-fit rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
                  <h3 className="text-base font-semibold">Payroll Summary</h3>
                  <div className="mt-4 space-y-2">
                    <DetailRow label="Total Staff" value={String(payrollSummary.totalStaff)} />
                    <DetailRow label="Total Gross Salary" value={`INR ${(payrollSummary.totalGross / 1000).toFixed(1)}K`} />
                    <DetailRow label="Total Deductions" value={`INR ${(payrollSummary.totalDeductions / 1000).toFixed(1)}K`} />
                    <DetailRow label="Total Net Pay" value={`INR ${(payrollSummary.totalNet / 1000).toFixed(1)}K`} />
                    <DetailRow label="Missing Payroll Data" value={String(payrollSummary.missingPayrollData)} />
                    <DetailRow label="Payroll Exceptions" value={String(payrollSummary.payrollExceptions)} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRunPayrollModal(true)}
                    disabled={!canManageStaff || !canViewPayroll}
                    className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                  >
                    Review & Process Payroll
                  </button>
                </aside>
              </div>
            </div>
          )}

          {activeWorkspace === "attendance" && (
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h2 className="text-lg font-semibold">Attendance</h2>
              <p className="mt-1 text-sm text-slate-500">Mark attendance and monitor daily presence from People Operations.</p>

              <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={(event) => void markAttendance(event)}>
                <FieldLabel label="Staff Member">
                  <select
                    value={attendanceStaffId}
                    onChange={(event) => setAttendanceStaffId(event.target.value)}
                    className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm"
                  >
                    {staff.map((member) => (
                      <option key={member.id} value={member.id}>{member.fullName}</option>
                    ))}
                  </select>
                </FieldLabel>
                <FieldLabel label="Date">
                  <input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm" />
                </FieldLabel>
                <FieldLabel label="Status">
                  <select value={attendanceStatus} onChange={(event) => setAttendanceStatus(event.target.value as "PRESENT" | "ABSENT" | "HALF_DAY")} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm">
                    <option value="PRESENT">Present</option>
                    <option value="ABSENT">Absent</option>
                    <option value="HALF_DAY">Half Day</option>
                  </select>
                </FieldLabel>
                <div className="flex items-end">
                  <button type="submit" disabled={attendanceLoading || !canManageAttendance} className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                    {attendanceLoading ? "Saving..." : "Save Attendance"}
                  </button>
                </div>
              </form>

              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Staff</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {attendanceRows.slice(0, 25).map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2">{row.staff.fullName}</td>
                        <td className="px-3 py-2">{new Date(row.date).toLocaleDateString()}</td>
                        <td className="px-3 py-2">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeWorkspace === "leave" && (
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h2 className="text-lg font-semibold">Leave Management</h2>
              <p className="mt-1 text-sm text-slate-500">Approve or reject leave requests from the queue.</p>

              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Staff</th>
                      <th className="px-3 py-2">From</th>
                      <th className="px-3 py-2">To</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leaveRows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2">{row.staff.fullName}</td>
                        <td className="px-3 py-2">{new Date(row.fromDate).toLocaleDateString()}</td>
                        <td className="px-3 py-2">{new Date(row.toDate).toLocaleDateString()}</td>
                        <td className="px-3 py-2"><StatusPill status={row.status} /></td>
                        <td className="px-3 py-2 text-right">
                          {row.status === "PENDING" ? (
                            <div className="inline-flex gap-2">
                              <button
                                type="button"
                                disabled={!canManageLeave || loading}
                                onClick={() => void onUpdateLeaveStatus(row.id, "APPROVED")}
                                className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 disabled:opacity-60"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={!canManageLeave || loading}
                                onClick={() => void onUpdateLeaveStatus(row.id, "REJECTED")}
                                className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">No action</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
      </main>

      {showRunPayrollModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold">Run Monthly Payroll</h3>
            <p className="mt-1 text-sm text-slate-500">Batch process payroll for filtered staff in People Operations.</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Payroll Month">
                <select value={payrollMonth} onChange={(event) => setPayrollMonth(Number(event.target.value))} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                    <option key={month} value={month}>{new Date(2000, month - 1).toLocaleString("en-US", { month: "long" })}</option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel label="Year">
                <input type="number" value={payrollYear} onChange={(event) => setPayrollYear(Number(event.target.value))} className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm" />
              </FieldLabel>
            </div>

            <div className="mt-4 space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={includeAttendanceDeductions} onChange={(e) => setIncludeAttendanceDeductions(e.target.checked)} />Include Attendance Deductions</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={includeLeaveDeductions} onChange={(e) => setIncludeLeaveDeductions(e.target.checked)} />Include Leave Deductions</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={includeBonuses} onChange={(e) => setIncludeBonuses(e.target.checked)} />Include Bonuses</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={includeManualAdjustments} onChange={(e) => setIncludeManualAdjustments(e.target.checked)} />Include Manual Adjustments</label>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-900 p-4 text-sm text-white">
              <div className="flex items-center justify-between"><span>Total Employees</span><span>{totalEmployeesForRun}</span></div>
              <div className="mt-1 flex items-center justify-between"><span>Estimated Payout</span><span>INR {(estimatedPayout / 1000).toFixed(1)}K</span></div>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setShowRunPayrollModal(false)} className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700">Cancel</button>
              <button
                type="button"
                onClick={() => void runBatchPayroll()}
                disabled={runPayrollLoading || !canManageStaff || !canViewPayroll}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {runPayrollLoading ? "Running..." : "Run Payroll"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkspaceNavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
    >
      {label}
    </button>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  tone: "blue" | "emerald" | "amber" | "rose" | "indigo";
}) {
  const toneClass = {
    blue: "bg-blue-100 text-blue-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    indigo: "bg-indigo-100 text-indigo-700",
  }[tone];

  return (
    <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <FieldLabel label={label} className={className}>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200" />
    </FieldLabel>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <FieldLabel label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </FieldLabel>
  );
}

function FileField({ label, file, onChange }: { label: string; file: File | null; onChange: (file: File | null) => void }) {
  return (
    <FieldLabel label={label}>
      <label className="flex cursor-pointer items-center justify-between rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
        <span className="truncate text-slate-600">{file?.name ?? "Upload file"}</span>
        <span className="rounded-lg bg-slate-900 px-2 py-1 text-xs text-white">Browse</span>
        <input
          type="file"
          hidden
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        />
      </label>
    </FieldLabel>
  );
}

function MultiFileField({ label, files, onChange }: { label: string; files: File[]; onChange: (files: File[]) => void }) {
  return (
    <FieldLabel label={label}>
      <label className="flex cursor-pointer items-center justify-between rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
        <span className="truncate text-slate-600">{files.length ? `${files.length} file(s) selected` : "Upload files"}</span>
        <span className="rounded-lg bg-slate-900 px-2 py-1 text-xs text-white">Browse</span>
        <input
          type="file"
          multiple
          hidden
          onChange={(event) => onChange(Array.from(event.target.files ?? []))}
        />
      </label>
    </FieldLabel>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-100 px-3 py-2 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function DetailSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  if (normalized === "PROCESSED" || normalized === "PAID" || normalized === "ACTIVE" || normalized === "APPROVED") {
    return <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{status}</span>;
  }
  if (normalized === "PENDING" || normalized === "PROBATION") {
    return <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">{status}</span>;
  }
  if (normalized === "HELD" || normalized === "INACTIVE" || normalized === "REJECTED") {
    return <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">{status}</span>;
  }
  return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{status}</span>;
}

function inferStaffType(role?: string): StaffType {
  if (!role) {
    return "EXECUTIVE";
  }
  if (["ADMISSIONS_OPERATOR", "AUDITOR"].includes(role)) {
    return "TEACHING";
  }
  return "EXECUTIVE";
}

function inferDesignation(role?: string) {
  if (!role) {
    return "Staff Member";
  }
  const map: Record<string, string> = {
    COLLEGE_ADMIN: "College Administrator",
    ADMISSIONS_OPERATOR: "Admissions Officer",
    CASHIER: "Cashier",
    HR_OPERATOR: "HR Executive",
    ATTENDANCE_OPERATOR: "Attendance Coordinator",
    AUDITOR: "Compliance Auditor",
  };
  return map[role] ?? "Staff Member";
}

function inferRoleFromDraft(staffType: StaffType, designation: string, fallbackRole?: string) {
  const normalized = designation.trim().toLowerCase();

  if (normalized.includes("admin")) return "COLLEGE_ADMIN";
  if (normalized.includes("cash")) return "CASHIER";
  if (normalized.includes("audit") || normalized.includes("compliance")) return "AUDITOR";
  if (normalized.includes("admission")) return "ADMISSIONS_OPERATOR";
  if (normalized.includes("hr")) return "HR_OPERATOR";
  if (normalized.includes("attendance")) return "ATTENDANCE_OPERATOR";

  if (fallbackRole) {
    return fallbackRole;
  }

  return staffType === "TEACHING" ? "ADMISSIONS_OPERATOR" : "HR_OPERATOR";
}

function guessSalary(role?: string) {
  const map: Record<string, number> = {
    COLLEGE_ADMIN: 72000,
    ADMISSIONS_OPERATOR: 42000,
    CASHIER: 35000,
    HR_OPERATOR: 47000,
    ATTENDANCE_OPERATOR: 32000,
    AUDITOR: 58000,
  };
  return map[role ?? ""] ?? 30000;
}
