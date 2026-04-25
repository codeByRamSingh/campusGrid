import { PrismaClient, ExceptionStatus, ExceptionModule, ExceptionSeverity } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Get a college ID to use
  const college = await prisma.college.findFirst();
  if (!college) {
    console.log("No colleges found. Skipping seed.");
    return;
  }

  // Get a staff member to assign to
  const staff = await prisma.staff.findFirst({ where: { collegeId: college.id } });

  console.log(`Creating test exceptions for college: ${college.name}`);

  const exceptions = [
    {
      collegeId: college.id,
      module: ExceptionModule.FINANCE,
      category: "OVERPAYMENT_DETECTED",
      severity: ExceptionSeverity.HIGH,
      title: "Overpayment detected in fee collection",
      description: "Student paid more than the required fee amount",
      sourceEntityType: "FeeCollection",
      sourceEntityId: "test-1",
      sourceOperation: "POST /finance/fee-collections",
      metadata: { amount: 50000, dueCycle: "JAN-2026" },
    },
    {
      collegeId: college.id,
      module: ExceptionModule.STUDENT_OPERATIONS,
      category: "INVALID_WORKFLOW_TRANSITION",
      severity: ExceptionSeverity.MEDIUM,
      title: "Invalid student workflow transition",
      description: "Student transitioned to invalid status",
      sourceEntityType: "Student",
      sourceEntityId: "test-student-1",
      sourceOperation: "PATCH /students/:id/workflow",
      metadata: { currentStatus: "SUBMITTED", requestedAction: "REJECT_DOCUMENTS" },
    },
    {
      collegeId: college.id,
      module: ExceptionModule.HR,
      category: "INVALID_LEAVE_STATUS_TRANSITION",
      severity: ExceptionSeverity.MEDIUM,
      title: "Leave request status already processed",
      description: "Attempted to update a leave request that was already processed",
      sourceEntityType: "LeaveRequest",
      sourceEntityId: "test-leave-1",
      sourceOperation: "PATCH /hr/leave-requests/:id/status",
      metadata: { currentStatus: "APPROVED", attemptedStatus: "REJECTED" },
    },
    {
      collegeId: college.id,
      module: ExceptionModule.FINANCE,
      category: "DUPLICATE_PAYMENT",
      severity: ExceptionSeverity.CRITICAL,
      title: "Duplicate payment detected",
      description: "Same payment reference received twice",
      sourceEntityType: "FeeCollection",
      sourceEntityId: "test-2",
      sourceOperation: "POST /finance/fee-collections",
      metadata: { reference: "CHQ-12345", studentId: "std-001", amount: 100000 },
    },
    {
      collegeId: college.id,
      module: ExceptionModule.HR,
      category: "PAYROLL_CALCULATION_ERROR",
      severity: ExceptionSeverity.HIGH,
      title: "Payroll calculation error",
      description: "Net salary calculation resulted in negative amount",
      sourceEntityType: "Payroll",
      sourceEntityId: "test-payroll-1",
      sourceOperation: "POST /hr/payroll",
      metadata: { staffId: staff?.id, baseSalary: 50000, deductions: 60000 },
    },
    {
      collegeId: college.id,
      module: ExceptionModule.STUDENT_FEES,
      category: "FINE_EXCEEDS_POLICY",
      severity: ExceptionSeverity.MEDIUM,
      title: "Fine amount exceeds policy limit",
      description: "Calculated fine exceeds the maximum allowed by policy",
      sourceEntityType: "FeeCollection",
      sourceEntityId: "test-3",
      sourceOperation: "POST /finance/fee-collections",
      metadata: { fine: 50000, policyLimit: 25000 },
    },
  ];

  for (const exc of exceptions) {
    const created = await prisma.exceptionCase.create({
      data: {
        ...exc,
        status: ExceptionStatus.NEW,
        ...(staff && { assigneeStaffId: staff.id }),
        retryCount: 0,
        maxRetries: 3,
        isRetryable: true,
        slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        metadata: exc.metadata as any,
      },
    });

    // Create history entry
    await prisma.exceptionHistory.create({
      data: {
        exceptionCaseId: created.id,
        eventType: "STATUS_CHANGED",
        fromStatus: null,
        toStatus: ExceptionStatus.NEW,
        note: "Exception created",
        actorUserId: null,
        actorStaffId: staff?.id || null,
        metadata: {},
      },
    });

    console.log(`✓ Created exception: ${created.id} - ${created.title}`);
  }

  console.log("✓ Seed completed successfully");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
