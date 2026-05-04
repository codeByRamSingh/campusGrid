import type { PrismaClient, Prisma } from "@prisma/client";

export type AttendanceFilters = {
  staffId?: string;
  collegeId?: string;
  startDate?: string;
  endDate?: string;
  cursor?: string;
  limit: number;
};

export type LeaveRequestFilters = {
  staffId?: string;
  collegeId?: string;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  startDate?: string;
  endDate?: string;
  cursor?: string;
  limit: number;
};

export type PayrollFilters = {
  staffId?: string;
  collegeId?: string;
};

export type CreateStaffData = {
  collegeId: string;
  fullName: string;
  email: string;
  mobile: string;
  role: string;
  customRoleId: string | null;
  designation?: string | null;
  staffType?: string | null;
  employmentType?: string | null;
  joiningDate?: Date | null;
  dob?: Date | null;
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

export type CreateUserData = {
  email: string;
  passwordHash: string;
  staffId: string;
};

export type ProcessPayrollData = {
  staffId: string;
  grossAmount: number;
  netAmount: number;
  totalDeductions: number;
  month: number;
  year: number;
  deductions: Array<{ type: string; label: string; amount: number }>;
};

export class HrRepository {
  constructor(private readonly db: PrismaClient) {}

  // ─── Staff ───────────────────────────────────────────────────────────────────

  async findStaffByEmail(email: string) {
    return this.db.staff.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
  }

  async findUserByEmail(email: string, excludeUserId?: string) {
    return this.db.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { id: true, staffId: true },
    });
  }

  async findStaffById(staffId: string) {
    return this.db.staff.findUnique({
      where: { id: staffId },
      select: {
        id: true,
        collegeId: true,
        role: true,
        isActive: true,
        email: true,
        user: { select: { id: true } },
      },
    });
  }

  async findStaffWithUser(staffId: string) {
    return this.db.staff.findUnique({
      where: { id: staffId },
      include: { user: { select: { id: true } } },
    });
  }

  async findCustomRole(customRoleId: string) {
    return this.db.customRole.findUnique({
      where: { id: customRoleId },
      select: { collegeId: true, name: true },
    });
  }

  async createStaffWithUser(
    staffData: CreateStaffData,
    userData: CreateUserData,
    setupToken: { tokenHash: string; expiresAt: Date },
  ) {
    return this.db.$transaction(async (tx) => {
      const staff = await tx.staff.create({
        data: {
          ...staffData,
          role: staffData.role as never,
          invitedAt: new Date(),
        },
      });

      const user = await tx.user.create({
        data: {
          email: userData.email,
          passwordHash: userData.passwordHash,
          role: "STAFF",
          staffId: staff.id,
        },
      });

      await tx.passwordSetupToken.create({
        data: {
          userId: user.id,
          tokenHash: setupToken.tokenHash,
          expiresAt: setupToken.expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: undefined,
          action: "STAFF_INVITED",
          entityType: "STAFF",
          entityId: staff.id,
          metadata: {
            email: staff.email,
            collegeId: staff.collegeId,
            inviteExpiresAt: setupToken.expiresAt.toISOString(),
          },
        },
      });

      return { staff, user };
    });
  }

  async listStaff(collegeId?: string) {
    return this.db.staff.findMany({
      where: collegeId ? { collegeId } : {},
      include: { customRole: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateStaff(
    staffId: string,
    staffData: Prisma.StaffUpdateInput,
    userId?: string,
    normalizedEmail?: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.staff.update({
        where: { id: staffId },
        data: staffData,
      });

      if (normalizedEmail && userId) {
        await tx.user.update({
          where: { id: userId },
          data: { email: normalizedEmail },
        });
      }

      return updated;
    });
  }

  async checkStaffDependencies(staffId: string) {
    const [attendanceCount, leaveCount, payrollCount] = await Promise.all([
      this.db.attendance.count({ where: { staffId } }),
      this.db.leaveRequest.count({ where: { staffId } }),
      this.db.payroll.count({ where: { staffId } }),
    ]);
    return { attendanceCount, leaveCount, payrollCount };
  }

  async deleteStaffWithUser(staffId: string, userId?: string) {
    return this.db.$transaction(async (tx) => {
      if (userId) {
        await tx.user.delete({ where: { id: userId } });
      }
      await tx.staff.delete({ where: { id: staffId } });
    });
  }

  async createSetupToken(userId: string, tokenHash: string, expiresAt: Date) {
    return this.db.$transaction(async (tx) => {
      await tx.passwordSetupToken.create({
        data: { userId, tokenHash, expiresAt },
      });
      await tx.staff.update({
        where: { id: userId },
        data: { invitedAt: new Date() },
      });
    });
  }

  async reinviteStaff(staffId: string, userId: string, tokenHash: string, expiresAt: Date) {
    return this.db.$transaction(async (tx) => {
      await tx.passwordSetupToken.create({
        data: { userId, tokenHash, expiresAt },
      });
      await tx.staff.update({
        where: { id: staffId },
        data: { invitedAt: new Date() },
      });
    });
  }

  // ─── Salary Config ────────────────────────────────────────────────────────────

  async getSalaryConfig(staffId: string) {
    return this.db.staffSalaryConfig.findUnique({ where: { staffId } });
  }

  async upsertSalaryConfig(staffId: string, data: Prisma.StaffSalaryConfigUpdateInput) {
    return this.db.staffSalaryConfig.upsert({
      where: { staffId },
      update: data,
      create: { staffId, ...(data as Record<string, unknown>) } as never,
    });
  }

  async listSalaryConfigs(collegeId?: string) {
    return this.db.staffSalaryConfig.findMany({
      where: collegeId ? { staff: { collegeId } } : {},
      include: { staff: { select: { id: true } } },
    });
  }

  // ─── Attendance ───────────────────────────────────────────────────────────────

  async findStaffCollegeId(staffId: string): Promise<string | null> {
    const staff = await this.db.staff.findUnique({
      where: { id: staffId },
      select: { collegeId: true },
    });
    return staff?.collegeId ?? null;
  }

  async listAttendance(filters: AttendanceFilters) {
    const where: Prisma.AttendanceWhereInput = {
      ...(filters.staffId ? { staffId: filters.staffId } : {}),
      ...(filters.collegeId ? { staff: { collegeId: filters.collegeId } } : {}),
      ...(filters.startDate || filters.endDate
        ? {
            date: {
              ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
              ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
            },
          }
        : {}),
    };

    const records = await this.db.attendance.findMany({
      where,
      include: {
        staff: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { date: "desc" },
      take: filters.limit + 1,
      ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
    });

    const hasMore = records.length > filters.limit;
    const data = records.slice(0, filters.limit);
    return { data, hasMore, nextCursor: hasMore ? data.at(-1)?.id : undefined };
  }

  async upsertAttendance(staffId: string, date: Date, status: string, remarks?: string) {
    return this.db.attendance.upsert({
      where: { staffId_date: { staffId, date } },
      update: { status: status as never, remarks },
      create: { staffId, date, status: status as never, remarks },
    });
  }

  // ─── Leave ───────────────────────────────────────────────────────────────────

  async findLeaveRequest(leaveRequestId: string) {
    return this.db.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { staff: { select: { collegeId: true } } },
    });
  }

  async listLeaveRequests(filters: LeaveRequestFilters) {
    const where: Prisma.LeaveRequestWhereInput = {
      ...(filters.staffId ? { staffId: filters.staffId } : {}),
      ...(filters.collegeId ? { staff: { collegeId: filters.collegeId } } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.startDate || filters.endDate
        ? {
            fromDate: {
              ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
              ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
            },
          }
        : {}),
    };

    const records = await this.db.leaveRequest.findMany({
      where,
      include: { staff: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: filters.limit + 1,
      ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
    });

    const hasMore = records.length > filters.limit;
    const data = records.slice(0, filters.limit);
    return { data, hasMore, nextCursor: hasMore ? data.at(-1)?.id : undefined };
  }

  async updateLeaveStatus(leaveRequestId: string, status: "APPROVED" | "REJECTED") {
    return this.db.leaveRequest.update({
      where: { id: leaveRequestId },
      data: { status },
    });
  }

  async upsertLeaveBalance(staffId: string, leaveType: string, year: number, incrementUsedDays?: number) {
    if (incrementUsedDays !== undefined) {
      return this.db.leaveBalance.upsert({
        where: { staffId_leaveType_year: { staffId, leaveType, year } },
        update: { usedDays: { increment: incrementUsedDays } },
        create: { staffId, leaveType, year, totalDays: 0, usedDays: incrementUsedDays },
      });
    }
    return null;
  }

  async getLeaveBalance(staffId: string, year: number) {
    return this.db.leaveBalance.findMany({
      where: { staffId, year },
      orderBy: { leaveType: "asc" },
    });
  }

  async setLeaveBalance(staffId: string, leaveType: string, year: number, totalDays: number) {
    return this.db.leaveBalance.upsert({
      where: { staffId_leaveType_year: { staffId, leaveType, year } },
      update: { totalDays },
      create: { staffId, leaveType, year, totalDays, usedDays: 0 },
    });
  }

  // ─── Payroll ──────────────────────────────────────────────────────────────────

  async findExistingPayroll(staffId: string, month: number, year: number) {
    return this.db.payroll.findFirst({
      where: { staffId, month, year },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
  }

  async createPayroll(data: ProcessPayrollData) {
    return this.db.payroll.create({
      data: {
        staffId: data.staffId,
        amount: data.netAmount,
        grossAmount: data.grossAmount,
        totalDeductions: data.totalDeductions,
        netAmount: data.netAmount,
        month: data.month,
        year: data.year,
        deductions: {
          create: data.deductions.map((d) => ({
            type: d.type as never,
            label: d.label,
            amount: d.amount,
          })),
        },
      },
      include: { deductions: true },
    });
  }

  async updatePayroll(payrollId: string, data: ProcessPayrollData) {
    return this.db.payroll.update({
      where: { id: payrollId },
      data: {
        amount: data.netAmount,
        grossAmount: data.grossAmount,
        totalDeductions: data.totalDeductions,
        netAmount: data.netAmount,
        deductions: {
          deleteMany: {},
          create: data.deductions.map((d) => ({
            type: d.type as never,
            label: d.label,
            amount: d.amount,
          })),
        },
      },
      include: { deductions: true },
    });
  }

  async findPayrollById(payrollId: string) {
    return this.db.payroll.findUnique({
      where: { id: payrollId },
      include: { staff: { select: { collegeId: true } } },
    });
  }

  async updatePayrollStatus(payrollId: string, status: string) {
    return this.db.payroll.update({
      where: { id: payrollId },
      data: {
        status: status as never,
        ...(status === "PAID" ? { paidAt: new Date() } : {}),
      },
    });
  }

  async listPayroll(filters: PayrollFilters) {
    return this.db.payroll.findMany({
      where: {
        ...(filters.staffId ? { staffId: filters.staffId } : {}),
        ...(filters.collegeId ? { staff: { collegeId: filters.collegeId } } : {}),
      },
      include: { staff: { select: { id: true, fullName: true, email: true } } },
      orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
  }

  // ─── Documents ───────────────────────────────────────────────────────────────

  async createStaffDocument(data: {
    staffId: string;
    collegeId: string;
    fileName: string;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
    uploadedBy?: string;
  }) {
    return this.db.document.create({
      data: {
        entityType: "STAFF",
        entityId: data.staffId,
        collegeId: data.collegeId,
        fileName: data.fileName,
        storagePath: data.storagePath,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        uploadedBy: data.uploadedBy,
      },
    });
  }

  async listStaffDocuments(staffId: string) {
    return this.db.document.findMany({
      where: { entityType: "STAFF", entityId: staffId },
      orderBy: { createdAt: "desc" },
    });
  }

  // ─── Onboarding Drafts ────────────────────────────────────────────────────────

  async listOnboardingDrafts(userId: string, collegeId?: string) {
    return this.db.staffOnboardingDraft.findMany({
      where: {
        createdByUserId: userId,
        ...(collegeId ? { collegeId } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async createOnboardingDraft(userId: string, collegeId: string, formDataJson: string, step: number) {
    return this.db.staffOnboardingDraft.create({
      data: { createdByUserId: userId, collegeId, formDataJson, step },
    });
  }

  async findOnboardingDraft(draftId: string) {
    return this.db.staffOnboardingDraft.findUnique({ where: { id: draftId } });
  }

  async updateOnboardingDraft(draftId: string, data: { formDataJson?: string; step?: number }) {
    return this.db.staffOnboardingDraft.update({
      where: { id: draftId },
      data: {
        ...(data.formDataJson !== undefined ? { formDataJson: data.formDataJson } : {}),
        ...(data.step !== undefined ? { step: data.step } : {}),
      },
    });
  }

  async deleteOnboardingDraft(draftId: string) {
    return this.db.staffOnboardingDraft.delete({ where: { id: draftId } });
  }
}
