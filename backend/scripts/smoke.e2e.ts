type JsonObject = Record<string, unknown>;

const API_BASE = process.env.API_BASE_URL || "http://localhost:4000/api";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || "super_admin@campusgrid.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || "Admin@123";

async function request<T>(
  path: string,
  options: { method?: string; token?: string; body?: JsonObject } = {}
): Promise<T> {
  let response: Response | null = null;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 15) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  if (!response) {
    throw new Error(`No response for ${path}. Last error: ${String(lastError)}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed ${response.status} ${response.statusText} for ${path}: ${text}`);
  }

  return (await response.json()) as T;
}

async function requestExpectStatus(
  path: string,
  expectedStatus: number,
  options: { method?: string; token?: string; body?: JsonObject } = {}
): Promise<{ status: number; bodyText: string }> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const bodyText = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected ${expectedStatus} for ${path} but got ${response.status}. Body: ${bodyText}`
    );
  }

  return { status: response.status, bodyText };
}

type LoginResponse = {
  token: string;
};

type College = {
  id: string;
  name: string;
  code: string;
  courses: Array<{
    id: string;
    name: string;
    courseCode: string;
    sessions: Array<{ id: string; label: string }>;
  }>;
};

async function main() {
  const suffix = Date.now();

  const login = await request<LoginResponse>("/auth/login", {
    method: "POST",
    body: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    },
  });

  const token = login.token;
  if (!token) {
    throw new Error("Login succeeded but token is missing.");
  }

  const structure = await request<College[]>("/admin/academic-structure", { token });
  const targetCollege = structure[0];
  if (!targetCollege) {
    throw new Error("No college found in academic structure. Seed/setup is incomplete.");
  }

  let targetCourse = targetCollege.courses[0];
  if (!targetCourse) {
    targetCourse = await request<College["courses"][number]>("/admin/courses", {
      method: "POST",
      token,
      body: {
        collegeId: targetCollege.id,
        name: `Smoke Course ${suffix}`,
        courseCode: `SC${suffix}`,
        courseFee: 12000,
      },
    });
  }

  let targetSession = targetCourse.sessions[0];
  if (!targetSession) {
    const year = new Date().getFullYear();
    targetSession = await request<{ id: string; label: string }>("/admin/sessions", {
      method: "POST",
      token,
      body: {
        courseId: targetCourse.id,
        label: `${year}-${year + 1}`,
        startYear: year,
        endYear: year + 1,
        startingRollNumber: 1,
        rollNumberPrefix: `SMK/R${year}`,
        seatCount: 50,
        sessionFee: 15000,
      },
    });
  }

  const admission = await request<{ student: { id: string } }>("/students/admissions", {
    method: "POST",
    token,
    body: {
      collegeId: targetCollege.id,
      courseId: targetCourse.id,
      sessionId: targetSession.id,
      candidateName: `SMOKE STUDENT ${suffix}`,
      fatherName: "SMOKE FATHER",
      motherName: "SMOKE MOTHER",
      dob: "2004-01-10",
      gender: "MALE",
      nationality: "Indian",
      mobile: `99999${String(suffix).slice(-5)}`,
      fatherMobile: `88888${String(suffix).slice(-5)}`,
      email: `smoke.student.${suffix}@example.com`,
      permanentAddress: "Smoke Permanent Address",
      mailingAddress: "Smoke Mailing Address",
      discountAmount: 0,
      scholarshipAmount: 0,
    },
  });

  const studentId = admission.student.id;

  await request(`/students/${studentId}/workflow`, {
    method: "PATCH",
    token,
    body: { action: "VERIFY_DOCUMENTS" },
  });

  await request(`/students/${studentId}/workflow`, {
    method: "PATCH",
    token,
    body: { action: "VERIFY_FEES" },
  });

  await request(`/students/${studentId}/workflow`, {
    method: "PATCH",
    token,
    body: { action: "APPROVE" },
  });

  const workflow = await request<{ workflow: { status: string } }>(`/students/${studentId}/workflow`, { token });
  if (workflow.workflow.status !== "APPROVED") {
    throw new Error(`Workflow status assertion failed. Expected APPROVED, got ${workflow.workflow.status}`);
  }

  await requestExpectStatus(`/students/${studentId}/workflow`, 409, {
    method: "PATCH",
    token,
    body: { action: "REJECT", notes: "Smoke reject validation" },
  });

  await request("/finance/fee-collections", {
    method: "POST",
    token,
    body: {
      studentId,
      amount: 1000,
      description: "Smoke fee collection",
    },
  });

  const dashboardSummary = await request<{
    kpis: { totalFeeCollected: number; outstandingFees: number };
    admissionsPipeline: Array<{ stage: string; value: number }>;
  }>("/reports/dashboard-summary", { token });
  if (!dashboardSummary.kpis || dashboardSummary.admissionsPipeline.length === 0) {
    throw new Error("Dashboard summary did not return live KPI data.");
  }

  const monthlyLedger = await request<{ period: string; totalFeeDeposit: number }>("/finance/ledger?period=monthly", { token });
  if (monthlyLedger.period !== "monthly") {
    throw new Error(`Ledger period assertion failed. Expected monthly, got ${monthlyLedger.period}`);
  }

  const staffResponse = await request<{ staff: { id: string } }>("/hr/staff", {
    method: "POST",
    token,
    body: {
      collegeId: targetCollege.id,
      fullName: `Smoke Staff ${suffix}`,
      email: `smoke.staff.${suffix}@example.com`,
      mobile: `77777${String(suffix).slice(-5)}`,
      role: "HR_OPERATOR",
    },
  });
  const staffId = staffResponse.staff.id;

  await requestExpectStatus("/hr/staff", 409, {
    method: "POST",
    token,
    body: {
      collegeId: targetCollege.id,
      fullName: `Smoke Duplicate ${suffix}`,
      email: `smoke.staff.${suffix}@example.com`,
      mobile: `76666${String(suffix).slice(-5)}`,
      role: "HR_OPERATOR",
    },
  });

  const updatedEmail = `smoke.staff.updated.${suffix}@example.com`;
  const updatedStaff = await request<{ id: string; email: string; fullName: string; mobile: string; isActive: boolean }>(`/hr/staff/${staffId}`, {
    method: "PATCH",
    token,
    body: {
      fullName: `Smoke Staff Updated ${suffix}`,
      email: updatedEmail,
      mobile: `75555${String(suffix).slice(-5)}`,
      isActive: true,
      role: "HR_OPERATOR",
    },
  });

  if (updatedStaff.email !== updatedEmail) {
    throw new Error(`Staff update assertion failed. Expected updated email ${updatedEmail}, got ${updatedStaff.email}`);
  }

  const now = new Date();
  await request<{ id: string }>("/hr/payroll", {
    method: "POST",
    token,
    body: {
      staffId,
      amount: 25000,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    },
  });

  await request("/hr/payroll", {
    method: "POST",
    token,
    body: {
      staffId,
      amount: 26000,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    },
  });

  const payrollRows = await request<Array<{ id: string; amount: number; month: number; year: number; staff: { id: string } }>>(
    `/hr/payroll?staffId=${staffId}`,
    { token }
  );
  const payrollRowsForMonth = payrollRows.filter(
    (row) => row.staff.id === staffId && row.month === now.getMonth() + 1 && row.year === now.getFullYear()
  );
  if (payrollRowsForMonth.length !== 1) {
    throw new Error(
      `Payroll idempotency assertion failed. Expected 1 row for staff ${staffId} in ${now.getMonth() + 1}/${now.getFullYear()}, got ${payrollRowsForMonth.length}`
    );
  }
  if (Number(payrollRowsForMonth[0].amount) !== 26000) {
    throw new Error(
      `Payroll update assertion failed. Expected amount 26000, got ${payrollRowsForMonth[0].amount}`
    );
  }

  console.log("Smoke E2E passed: login, workflow, finance, HR invite conflict, staff update, and idempotent payroll.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
