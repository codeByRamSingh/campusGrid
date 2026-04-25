import { AdmissionWorkflowStatus } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate, getScopedCollegeId, requirePermission } from "../middleware/auth.js";

export const workflowRouter = Router();

workflowRouter.use(authenticate, requirePermission("WORKFLOW_READ"));

workflowRouter.get("/workflow/inbox", async (req, res) => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const collegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (collegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's workflow inbox" });
    return;
  }
  const courseId = req.query.courseId as string | undefined;
  const sessionId = req.query.sessionId as string | undefined;

  const admissionFilter = {
    ...(collegeId ? { collegeId } : {}),
    ...(courseId ? { courseId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };

  const [admissions, staffMembers, payrollRows, duesStudents, pendingLeaves] = await Promise.all([
    prisma.admission.findMany({
      where: {
        ...admissionFilter,
        workflowStatus: {
          in: [
            AdmissionWorkflowStatus.SUBMITTED,
            AdmissionWorkflowStatus.DOCUMENTS_VERIFIED,
            AdmissionWorkflowStatus.FEE_VERIFIED,
            AdmissionWorkflowStatus.PENDING_APPROVAL,
            AdmissionWorkflowStatus.CHANGES_REQUESTED,
          ],
        },
      },
      include: {
        student: {
          select: {
            id: true,
            candidateName: true,
            admissionNumber: true,
            admissionCode: true,
          },
        },
      },
      orderBy: { workflowUpdatedAt: "desc" },
      take: 20,
    }),
    prisma.staff.findMany({
      where: {
        isActive: true,
        ...(collegeId ? { collegeId } : {}),
      },
      select: { id: true, fullName: true },
    }),
    prisma.payroll.findMany({
      where: { month: currentMonth, year: currentYear },
      select: { staffId: true },
    }),
    prisma.student.findMany({
      where: {
        ...(collegeId ? { collegeId } : {}),
        ...(courseId || sessionId
          ? {
              admissions: {
                some: {
                  ...(courseId ? { courseId } : {}),
                  ...(sessionId ? { sessionId } : {}),
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        candidateName: true,
        admissionNumber: true,
        admissionCode: true,
        totalPayable: true,
        payments: {
          select: {
            amount: true,
            paymentType: true,
          },
        },
      },
      take: 200,
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: "PENDING",
        ...(collegeId ? { staff: { collegeId } } : {}),
      },
      include: { staff: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const payrollStaffIds = new Set(payrollRows.map((row) => row.staffId));
  const payrollExceptions = staffMembers.filter((staff) => !payrollStaffIds.has(staff.id));

  const feeDisputes = duesStudents
    .map((student) => {
      const feePaid = student.payments
        .filter((payment) => payment.paymentType === "FEE_COLLECTION")
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
      const fines = student.payments
        .filter((payment) => payment.paymentType === "FINE")
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
      const due = Number(student.totalPayable) - feePaid + fines;

      return {
        id: student.id,
        candidateName: student.candidateName,
        admissionNumber: student.admissionNumber,
        admissionCode: student.admissionCode,
        due,
      };
    })
    .filter((student) => student.due > 0)
    .sort((a, b) => b.due - a.due)
    .slice(0, 10);

  const sections = [
    {
      id: "admissions-awaiting-approval",
      title: "Admissions awaiting approval",
      count: admissions.length,
      nav: "students",
      items: admissions.slice(0, 5).map((admission) => ({
        id: admission.student.id,
        title: admission.student.candidateName,
        subtitle: `Admission ${admission.student.admissionCode ?? `#${admission.student.admissionNumber}`} · ${admission.workflowStatus.replace(/_/g, " ")}`,
      })),
    },
    {
      id: "payroll-exception-requiring-review",
      title: "Payroll exception requiring review",
      count: payrollExceptions.length,
      nav: "hr",
      items: payrollExceptions.slice(0, 5).map((staff) => ({
        id: staff.id,
        title: staff.fullName,
        subtitle: `No payroll generated for ${currentMonth}/${currentYear}`,
      })),
    },
    {
      id: "fee-dispute-pending-action",
      title: "Fee dispute pending action",
      count: feeDisputes.length,
      nav: "finance",
      items: feeDisputes.slice(0, 5).map((student) => ({
        id: student.id,
        title: student.candidateName,
        subtitle: `Admission ${student.admissionCode ?? `#${student.admissionNumber}`} · Due INR ${student.due.toLocaleString()}`,
      })),
    },
    {
      id: "leave-approval-pending",
      title: "Leave approval pending",
      count: pendingLeaves.length,
      nav: "hr",
      items: pendingLeaves.slice(0, 5).map((leave) => ({
        id: leave.id,
        title: leave.staff.fullName,
        subtitle: `${leave.status} · ${leave.reason}`,
      })),
    },
  ];

  const approvalsCount = admissions.length + pendingLeaves.length;
  const exceptionsCount = payrollExceptions.length + feeDisputes.length;
  const tasksCount = pendingLeaves.length;

  res.json({
    sections,
    summary: {
      approvals: approvalsCount,
      exceptions: exceptionsCount,
      tasks: tasksCount,
      total: approvalsCount + exceptionsCount,
    },
  });
});
