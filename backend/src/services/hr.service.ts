import { ExceptionModule, ExceptionSeverity } from "@prisma/client";
import { hashPassword } from "../lib/auth.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import { createExceptionCase } from "../lib/exceptions.js";
import { writeAuditLog } from "../lib/audit.js";
import { buildInviteLink, generateOpaqueToken, hashOpaqueToken } from "../lib/security.js";
import { sendInAppNotification, sendNotification } from "../lib/notify.js";
import { prisma } from "../lib/prisma.js";
import { HrRepository } from "../repositories/hr.repository.js";

const hrRepo = new HrRepository(prisma);

export type CreateStaffInput = {
  collegeId: string;
  fullName: string;
  email: string;
  mobile: string;
  role?: string;
  customRoleId?: string | null;
  designation?: string | null;
  staffType?: string | null;
  employmentType?: string | null;
  joiningDate?: string | null;
  dob?: string | null;
  gender?: string | null;
  nationality?: string | null;
  emergencyContact?: string | null;
  currentAddress?: string | null;
  currentCity?: string | null;
  currentDistrict?: string | null;
  currentState?: string | null;
  currentPincode?: string | null;
  currentCountry?: string | null;
  permanentAddress?: string | null;
  permanentCity?: string | null;
  permanentDistrict?: string | null;
  permanentState?: string | null;
  permanentPincode?: string | null;
  permanentCountry?: string | null;
  department?: string | null;
  functionalRole?: string | null;
  subjectSpecialization?: string | null;
  qualification?: string | null;
  experience?: string | null;
  employmentStatus?: string | null;
};

export type UpdateStaffInput = Partial<CreateStaffInput> & { isActive?: boolean };

export type ProcessPayrollInput = {
  staffId: string;
  amount: number;
  grossAmount?: number;
  month: number;
  year: number;
  deductions?: Array<{ type: string; label: string; amount: number }>;
};

export type MarkAttendanceInput = {
  staffId: string;
  date: string;
  status: string;
  remarks?: string;
};

// ─── Staff ────────────────────────────────────────────────────────────────────

export async function createStaff(input: CreateStaffInput, actorUserId?: string) {
  const normalizedEmail = input.email.trim().toLowerCase();

  const [existingStaff, existingUser] = await Promise.all([
    hrRepo.findStaffByEmail(normalizedEmail),
    hrRepo.findUserByEmail(normalizedEmail),
  ]);

  if (existingStaff) throw new ConflictError("A staff account with this email already exists");
  if (existingUser) throw new ConflictError("A user account with this email already exists");

  const customRoleId =
    typeof input.customRoleId === "string" && input.customRoleId.trim().length > 0
      ? input.customRoleId.trim()
      : null;

  if (customRoleId) {
    const customRole = await hrRepo.findCustomRole(customRoleId);
    if (!customRole || customRole.collegeId !== input.collegeId) {
      throw new BadRequestError("Custom role must belong to the same college");
    }
  }

  const rawSetupToken = generateOpaqueToken(32);
  const setupTokenHash = hashOpaqueToken(rawSetupToken);
  const temporaryPassword = generateOpaqueToken(12);
  const passwordHash = await hashPassword(temporaryPassword);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

  const result = await hrRepo.createStaffWithUser(
    {
      collegeId: input.collegeId,
      customRoleId,
      fullName: input.fullName,
      email: normalizedEmail,
      mobile: input.mobile,
      role: input.role ?? "ATTENDANCE_OPERATOR",
      designation: input.designation ?? null,
      staffType: input.staffType ?? null,
      employmentType: input.employmentType ?? null,
      joiningDate: input.joiningDate ? new Date(input.joiningDate) : null,
      dob: input.dob ? new Date(input.dob) : null,
      gender: input.gender ?? null,
      nationality: input.nationality ?? null,
      emergencyContact: input.emergencyContact ?? null,
      currentAddress: input.currentAddress ?? null,
      currentCity: input.currentCity ?? null,
      currentDistrict: input.currentDistrict ?? null,
      currentState: input.currentState ?? null,
      currentPincode: input.currentPincode ?? null,
      currentCountry: input.currentCountry ?? null,
      permanentAddress: input.permanentAddress ?? null,
      permanentCity: input.permanentCity ?? null,
      permanentDistrict: input.permanentDistrict ?? null,
      permanentState: input.permanentState ?? null,
      permanentPincode: input.permanentPincode ?? null,
      permanentCountry: input.permanentCountry ?? null,
      department: input.department ?? null,
      functionalRole: input.functionalRole ?? null,
      subjectSpecialization: input.subjectSpecialization ?? null,
      qualification: input.qualification ?? null,
      experience: input.experience ?? null,
      employmentStatus: input.employmentStatus ?? null,
    },
    { email: normalizedEmail, passwordHash, staffId: "" },
    { tokenHash: setupTokenHash, expiresAt },
  );

  const inviteLink = buildInviteLink(rawSetupToken);
  await sendNotification({
    collegeId: result.staff.collegeId,
    recipientId: result.user.id,
    recipientEmail: normalizedEmail,
    subject: "Your CampusGrid account invitation",
    body: `Hello ${result.staff.fullName},\n\nYou have been invited to CampusGrid. Use the link below to set up your password (expires in 24 hours):\n\n${inviteLink}\n\nIf you did not expect this invitation, please ignore this email.`,
    metadata: { staffId: result.staff.id, expiresAt: expiresAt.toISOString() },
  });

  await sendInAppNotification({
    collegeId: result.staff.collegeId,
    recipientId: result.user.id,
    subject: "Account invitation sent",
    body: "Your account invitation email has been sent. Please complete password setup from the link in your email.",
    metadata: { nav: "settings", type: "STAFF_INVITE" },
  });

  const roleLabel = customRoleId
    ? (await hrRepo.findCustomRole(customRoleId))?.name ?? result.staff.role
    : result.staff.role;

  return {
    id: result.staff.id,
    email: result.staff.email,
    fullName: result.staff.fullName,
    collegeId: result.staff.collegeId,
    role: roleLabel,
    customRoleId: result.staff.customRoleId,
    invite: { expiresAt: expiresAt.toISOString() },
  };
}

export async function listStaff(collegeId?: string) {
  const staff = await hrRepo.listStaff(collegeId);
  return staff.map((member) => ({
    ...member,
    role: member.customRole?.name ?? member.role,
  }));
}

export async function updateStaff(staffId: string, input: UpdateStaffInput, actorUserId?: string) {
  const existing = await hrRepo.findStaffById(staffId);
  if (!existing) throw new NotFoundError("Staff member not found");

  const customRoleId =
    input.customRoleId === null
      ? null
      : typeof input.customRoleId === "string" && input.customRoleId.trim().length > 0
        ? input.customRoleId.trim()
        : undefined;

  if (customRoleId !== undefined && customRoleId !== null) {
    const customRole = await hrRepo.findCustomRole(customRoleId);
    const targetCollegeId = String(input.collegeId ?? existing.collegeId);
    if (!customRole || customRole.collegeId !== targetCollegeId) {
      throw new BadRequestError("Custom role must belong to the same college");
    }
  }

  const normalizedEmail =
    input.email ? input.email.trim().toLowerCase() : undefined;

  if (normalizedEmail && normalizedEmail !== existing.email.toLowerCase()) {
    const [emailInStaff, emailInUser] = await Promise.all([
      hrRepo.findStaffByEmail(normalizedEmail),
      hrRepo.findUserByEmail(normalizedEmail, existing.user?.id),
    ]);
    if (emailInStaff || emailInUser) {
      throw new ConflictError("Email is already in use by another account");
    }
  }

  const staffData = {
    ...(input.fullName ? { fullName: input.fullName } : {}),
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    ...(input.mobile ? { mobile: input.mobile } : {}),
    ...(input.role ? { role: input.role as never } : {}),
    ...(customRoleId !== undefined ? { customRoleId } : {}),
    ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {}),
    ...(input.collegeId ? { collegeId: input.collegeId } : {}),
    ...(input.designation !== undefined ? { designation: input.designation } : {}),
    ...(input.staffType !== undefined ? { staffType: input.staffType } : {}),
    ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
    ...(input.joiningDate ? { joiningDate: new Date(input.joiningDate) } : {}),
    ...(input.dob !== undefined ? { dob: input.dob ? new Date(input.dob) : null } : {}),
    ...(input.gender !== undefined ? { gender: input.gender ?? null } : {}),
    ...(input.nationality !== undefined ? { nationality: input.nationality ?? null } : {}),
    ...(input.emergencyContact !== undefined ? { emergencyContact: input.emergencyContact ?? null } : {}),
    ...(input.currentAddress !== undefined ? { currentAddress: input.currentAddress ?? null } : {}),
    ...(input.currentCity !== undefined ? { currentCity: input.currentCity ?? null } : {}),
    ...(input.currentDistrict !== undefined ? { currentDistrict: input.currentDistrict ?? null } : {}),
    ...(input.currentState !== undefined ? { currentState: input.currentState ?? null } : {}),
    ...(input.currentPincode !== undefined ? { currentPincode: input.currentPincode ?? null } : {}),
    ...(input.currentCountry !== undefined ? { currentCountry: input.currentCountry ?? null } : {}),
    ...(input.permanentAddress !== undefined ? { permanentAddress: input.permanentAddress ?? null } : {}),
    ...(input.permanentCity !== undefined ? { permanentCity: input.permanentCity ?? null } : {}),
    ...(input.permanentDistrict !== undefined ? { permanentDistrict: input.permanentDistrict ?? null } : {}),
    ...(input.permanentState !== undefined ? { permanentState: input.permanentState ?? null } : {}),
    ...(input.permanentPincode !== undefined ? { permanentPincode: input.permanentPincode ?? null } : {}),
    ...(input.permanentCountry !== undefined ? { permanentCountry: input.permanentCountry ?? null } : {}),
    ...(input.department !== undefined ? { department: input.department ?? null } : {}),
    ...(input.functionalRole !== undefined ? { functionalRole: input.functionalRole ?? null } : {}),
    ...(input.subjectSpecialization !== undefined ? { subjectSpecialization: input.subjectSpecialization ?? null } : {}),
    ...(input.qualification !== undefined ? { qualification: input.qualification ?? null } : {}),
    ...(input.experience !== undefined ? { experience: input.experience ?? null } : {}),
    ...(input.employmentStatus !== undefined ? { employmentStatus: input.employmentStatus ?? null } : {}),
  };

  const updated = await hrRepo.updateStaff(
    staffId,
    staffData,
    existing.user?.id,
    normalizedEmail,
  );

  await writeAuditLog(prisma, {
    actorUserId,
    action: "STAFF_UPDATED",
    entityType: "STAFF",
    entityId: updated.id,
    metadata: { role: updated.role, isActive: updated.isActive, collegeId: updated.collegeId },
  });

  return updated;
}

export async function deleteStaff(staffId: string, actorUserId?: string) {
  const existing = await hrRepo.findStaffWithUser(staffId);
  if (!existing) throw new NotFoundError("Staff member not found");

  const deps = await hrRepo.checkStaffDependencies(staffId);
  if (deps.attendanceCount > 0 || deps.leaveCount > 0 || deps.payrollCount > 0) {
    throw new ConflictError(
      "Cannot delete staff with linked attendance, leave, or payroll records. Mark staff inactive instead.",
    );
  }

  await hrRepo.deleteStaffWithUser(staffId, existing.user?.id);

  await writeAuditLog(prisma, {
    actorUserId,
    action: "STAFF_DELETED",
    entityType: "STAFF",
    entityId: staffId,
    metadata: { fullName: existing.fullName, collegeId: existing.collegeId },
  });
}

export async function reinviteStaff(staffId: string, actorUserId?: string) {
  const existing = await hrRepo.findStaffWithUser(staffId);
  if (!existing || !existing.user) {
    throw new NotFoundError("Staff member or linked user not found");
  }

  const rawSetupToken = generateOpaqueToken(32);
  const setupTokenHash = hashOpaqueToken(rawSetupToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

  await hrRepo.reinviteStaff(staffId, existing.user.id, setupTokenHash, expiresAt);

  await writeAuditLog(prisma, {
    actorUserId,
    action: "STAFF_REINVITED",
    entityType: "STAFF",
    entityId: staffId,
    metadata: { inviteExpiresAt: expiresAt.toISOString() },
  });

  return {
    invite: {
      expiresAt: expiresAt.toISOString(),
      inviteLink: buildInviteLink(rawSetupToken),
    },
  };
}

// ─── Salary Config ─────────────────────────────────────────────────────────────

export async function getSalaryConfig(staffId: string) {
  return hrRepo.getSalaryConfig(staffId);
}

export async function setSalaryConfig(
  staffId: string,
  data: {
    basicSalary?: number;
    hra?: number;
    da?: number;
    otherAllowances?: number;
    bankAccountNumber?: string;
    bankName?: string;
    ifscCode?: string;
    pan?: string;
    pfUan?: string;
    paymentMode?: string;
  },
  actorUserId?: string,
) {
  const updateData = {
    ...(data.basicSalary !== undefined ? { basicSalary: data.basicSalary } : {}),
    ...(data.hra !== undefined ? { hra: data.hra } : {}),
    ...(data.da !== undefined ? { da: data.da } : {}),
    ...(data.otherAllowances !== undefined ? { otherAllowances: data.otherAllowances } : {}),
    ...(data.bankAccountNumber !== undefined ? { bankAccountNumber: data.bankAccountNumber } : {}),
    ...(data.bankName !== undefined ? { bankName: data.bankName } : {}),
    ...(data.ifscCode !== undefined ? { ifscCode: data.ifscCode } : {}),
    ...(data.pan !== undefined ? { pan: data.pan } : {}),
    ...(data.pfUan !== undefined ? { pfUan: data.pfUan } : {}),
    ...(data.paymentMode !== undefined ? { paymentMode: data.paymentMode as never } : {}),
  };

  const config = await hrRepo.upsertSalaryConfig(staffId, updateData);

  await writeAuditLog(prisma, {
    actorUserId,
    action: "SALARY_CONFIG_UPDATED",
    entityType: "STAFF_SALARY_CONFIG",
    entityId: config.id,
    metadata: { staffId },
  });

  return config;
}

export async function listSalaryConfigs(collegeId?: string) {
  const configs = await hrRepo.listSalaryConfigs(collegeId);
  const result: Record<string, (typeof configs)[number]> = {};
  for (const config of configs) {
    result[config.staffId] = config;
  }
  return result;
}

// ─── Attendance ────────────────────────────────────────────────────────────────

export async function markAttendance(input: MarkAttendanceInput, actorUserId?: string) {
  const attendance = await hrRepo.upsertAttendance(
    input.staffId,
    new Date(input.date),
    input.status,
    input.remarks,
  );

  await writeAuditLog(prisma, {
    actorUserId,
    action: "ATTENDANCE_MARKED",
    entityType: "ATTENDANCE",
    entityId: attendance.id,
    metadata: { staffId: attendance.staffId, status: attendance.status, date: attendance.date },
  });

  return attendance;
}

export async function listAttendance(
  filters: {
    staffId?: string;
    startDate?: string;
    endDate?: string;
    cursor?: string;
    limit: number;
  },
  userCollegeId?: string,
) {
  return hrRepo.listAttendance({
    ...filters,
    collegeId: userCollegeId,
  });
}

// ─── Leave ─────────────────────────────────────────────────────────────────────

export async function listLeaveRequests(
  filters: {
    staffId?: string;
    status?: "PENDING" | "APPROVED" | "REJECTED";
    startDate?: string;
    endDate?: string;
    cursor?: string;
    limit: number;
  },
  userCollegeId?: string,
) {
  return hrRepo.listLeaveRequests({
    ...filters,
    collegeId: userCollegeId,
  });
}

export async function updateLeaveStatus(
  leaveRequestId: string,
  status: "APPROVED" | "REJECTED",
  actorUserId?: string,
) {
  const existing = await hrRepo.findLeaveRequest(leaveRequestId);
  if (!existing) throw new NotFoundError("Leave request not found");

  if (existing.status !== "PENDING") {
    await createExceptionCase(prisma, {
      collegeId: existing.staff.collegeId,
      module: ExceptionModule.HR,
      category: "INVALID_LEAVE_STATUS_TRANSITION",
      severity: ExceptionSeverity.MEDIUM,
      title: "Leave review conflict",
      description: `Leave request ${existing.id} is already ${existing.status}`,
      sourceEntityType: "LEAVE_REQUEST",
      sourceEntityId: existing.id,
      sourceOperation: "LEAVE_STATUS_UPDATE",
      dedupeKey: `LEAVE:${existing.id}:STATUS_CONFLICT`,
      isRetryable: false,
      metadata: {
        currentStatus: existing.status,
        requestedStatus: status,
        staffId: existing.staffId,
      },
      createdByUserId: actorUserId,
    });
    throw new ConflictError(`Leave request is already ${existing.status}`);
  }

  if (status === "APPROVED") {
    const fromDate = new Date(existing.fromDate);
    const toDate = new Date(existing.toDate);
    const days =
      Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const year = fromDate.getFullYear();
    const leaveType = (existing as { leaveType?: string | null }).leaveType ?? "GENERAL";
    await hrRepo.upsertLeaveBalance(existing.staffId, leaveType, year, days);
  }

  const updated = await hrRepo.updateLeaveStatus(leaveRequestId, status);

  await writeAuditLog(prisma, {
    actorUserId,
    action: "LEAVE_STATUS_UPDATED",
    entityType: "LEAVE_REQUEST",
    entityId: updated.id,
    metadata: { status: updated.status, staffId: updated.staffId },
  });

  return updated;
}

export async function getLeaveBalance(staffId: string, year: number) {
  return hrRepo.getLeaveBalance(staffId, year);
}

export async function setLeaveBalance(
  staffId: string,
  leaveType: string,
  year: number,
  totalDays: number,
) {
  return hrRepo.setLeaveBalance(staffId, leaveType, year, totalDays);
}

// ─── Payroll ───────────────────────────────────────────────────────────────────

export async function processPayroll(input: ProcessPayrollInput, actorUserId?: string) {
  const deductions = Array.isArray(input.deductions) ? input.deductions : [];
  const grossAmount = Number(input.grossAmount ?? input.amount);
  const totalDeductions = deductions.reduce((sum, d) => sum + Number(d.amount), 0);
  const netAmount = grossAmount - totalDeductions;

  const existing = await hrRepo.findExistingPayroll(input.staffId, input.month, input.year);

  if (existing?.status === "PAID") {
    throw new ConflictError(
      `Payroll for ${input.month}/${input.year} has already been paid and cannot be reprocessed. Use status PATCH to reverse it first.`,
      "PAYROLL_LOCKED",
    );
  }

  const payrollData = {
    staffId: input.staffId,
    grossAmount,
    netAmount,
    totalDeductions,
    month: input.month,
    year: input.year,
    deductions,
  };

  const payroll = existing
    ? await hrRepo.updatePayroll(existing.id, payrollData)
    : await hrRepo.createPayroll(payrollData);

  await writeAuditLog(prisma, {
    actorUserId,
    action: "PAYROLL_PROCESSED",
    entityType: "PAYROLL",
    entityId: payroll.id,
    metadata: {
      staffId: payroll.staffId,
      month: payroll.month,
      year: payroll.year,
      amount: payroll.amount,
    },
  });

  return payroll;
}

export async function updatePayrollStatus(payrollId: string, status: string, actorUserId?: string) {
  const existing = await hrRepo.findPayrollById(payrollId);
  if (!existing) throw new NotFoundError("Payroll record not found");

  const updated = await hrRepo.updatePayrollStatus(payrollId, status);

  await writeAuditLog(prisma, {
    actorUserId,
    action: "PAYROLL_STATUS_UPDATED",
    entityType: "PAYROLL",
    entityId: updated.id,
    metadata: {
      status: updated.status,
      staffId: updated.staffId,
      month: updated.month,
      year: updated.year,
    },
  });

  return updated;
}

export async function listPayroll(filters: { staffId?: string; collegeId?: string }) {
  return hrRepo.listPayroll(filters);
}

// ─── Onboarding Drafts ────────────────────────────────────────────────────────

export async function listOnboardingDrafts(userId: string, collegeId?: string) {
  return hrRepo.listOnboardingDrafts(userId, collegeId);
}

export async function createOnboardingDraft(
  userId: string,
  collegeId: string,
  formDataJson: string,
  step: number,
) {
  return hrRepo.createOnboardingDraft(userId, collegeId, formDataJson, step);
}

export async function updateOnboardingDraft(
  draftId: string,
  userId: string,
  data: { formDataJson?: string; step?: number },
) {
  const existing = await hrRepo.findOnboardingDraft(draftId);
  if (!existing) throw new NotFoundError("Draft not found");
  if (existing.createdByUserId !== userId) throw new ForbiddenError("Cannot edit another user's draft");
  return hrRepo.updateOnboardingDraft(draftId, data);
}

export async function deleteOnboardingDraft(draftId: string, userId: string, isAdmin: boolean) {
  const existing = await hrRepo.findOnboardingDraft(draftId);
  if (!existing) throw new NotFoundError("Draft not found");
  if (existing.createdByUserId !== userId && !isAdmin) {
    throw new ForbiddenError("Cannot delete another user's draft");
  }
  return hrRepo.deleteOnboardingDraft(draftId);
}
