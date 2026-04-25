import { Router } from "express";
import { body, param } from "express-validator";
import { AdmissionWorkflowStatus, ExceptionModule, ExceptionSeverity, StudentStatus } from "@prisma/client";
import { createExceptionCase } from "../lib/exceptions.js";
import { prisma } from "../lib/prisma.js";
import { authenticate, canAccessCollege, getScopedCollegeId, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { handleValidation } from "../middleware/validate.js";
import { nextSequenceValue } from "../lib/sequence.js";
import { writeAuditLog } from "../lib/audit.js";

export const studentRouter = Router();

function formatRunningCode(prefix: string, value: number): string {
  const normalizedPrefix = (prefix || "").trim().replace(/\/?$/, "/");
  return `${normalizedPrefix}${String(value).padStart(2, "0")}`;
}

function serializeAdmissionWorkflow(admission: {
  id: string;
  workflowStatus: AdmissionWorkflowStatus;
  workflowNotes: string | null;
  workflowUpdatedAt: Date;
  documentsVerifiedAt: Date | null;
  feeVerifiedAt: Date | null;
}) {
  const hasDocuments = Boolean(admission.documentsVerifiedAt);
  const hasFeeVerification = Boolean(admission.feeVerifiedAt);
  const approvalStatuses: AdmissionWorkflowStatus[] = [
    AdmissionWorkflowStatus.PENDING_APPROVAL,
    AdmissionWorkflowStatus.APPROVED,
    AdmissionWorkflowStatus.REJECTED,
    AdmissionWorkflowStatus.CHANGES_REQUESTED,
  ];

  return {
    admissionId: admission.id,
    status: admission.workflowStatus,
    notes: admission.workflowNotes,
    workflowUpdatedAt: admission.workflowUpdatedAt,
    steps: [
      { key: "SUBMITTED", label: "Submitted", complete: true },
      { key: "DOCUMENTS_VERIFIED", label: "Documents Verified", complete: hasDocuments },
      { key: "FEE_VERIFIED", label: "Fee Verified", complete: hasFeeVerification },
      { key: "PENDING_APPROVAL", label: "Pending Approval", complete: approvalStatuses.includes(admission.workflowStatus) },
      { key: "APPROVED", label: "Approved", complete: admission.workflowStatus === AdmissionWorkflowStatus.APPROVED },
    ],
  };
}

const WORKFLOW_ACTION_RULES: Record<string, AdmissionWorkflowStatus[]> = {
  VERIFY_DOCUMENTS: [AdmissionWorkflowStatus.SUBMITTED, AdmissionWorkflowStatus.CHANGES_REQUESTED],
  VERIFY_FEES: [AdmissionWorkflowStatus.SUBMITTED, AdmissionWorkflowStatus.DOCUMENTS_VERIFIED, AdmissionWorkflowStatus.CHANGES_REQUESTED],
  SEND_FOR_APPROVAL: [AdmissionWorkflowStatus.DOCUMENTS_VERIFIED, AdmissionWorkflowStatus.FEE_VERIFIED, AdmissionWorkflowStatus.CHANGES_REQUESTED],
  APPROVE: [AdmissionWorkflowStatus.PENDING_APPROVAL],
  REJECT: [AdmissionWorkflowStatus.PENDING_APPROVAL],
  REQUEST_CHANGES: [AdmissionWorkflowStatus.PENDING_APPROVAL],
};

studentRouter.use(authenticate);

studentRouter.get("/students", requirePermission("STUDENTS_READ"), async (req, res) => {
  const collegeId = getScopedCollegeId(req, req.query.collegeId as string | undefined);
  if (collegeId === "__FORBIDDEN__") {
    res.status(403).json({ message: "Cannot access another college's students" });
    return;
  }

  const students = await prisma.student.findMany({
    where: collegeId ? { collegeId } : {},
    include: { admissions: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  res.json(students);
});

studentRouter.post(
  "/students/admissions",
  requirePermission("STUDENTS_WRITE"),
  [
    body("collegeId").notEmpty(),
    body("courseId").notEmpty(),
    body("sessionId").notEmpty(),
    body("candidateName").notEmpty(),
    body("fatherName").notEmpty(),
    body("motherName").notEmpty(),
    body("dob").isISO8601(),
    body("gender").notEmpty(),
    body("nationality").notEmpty(),
    body("mobile").notEmpty(),
    body("fatherMobile").notEmpty(),
    body("email").isEmail(),
    body("permanentAddress").notEmpty(),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    if (!canAccessCollege(req, req.body.collegeId as string)) {
      res.status(403).json({ message: "Cannot create admissions for another college" });
      return;
    }

    const college = await prisma.college.findUnique({ where: { id: req.body.collegeId } });
    const course = await prisma.course.findUnique({ where: { id: req.body.courseId } });
    const session = await prisma.session.findUnique({ where: { id: req.body.sessionId } });

    if (!college || !course || !session) {
      res.status(404).json({ message: "College, course or session not found" });
      return;
    }

    if (session.courseId !== course.id) {
      res.status(400).json({ message: "Selected session does not belong to the selected course" });
      return;
    }
    if (course.collegeId !== college.id) {
      res.status(400).json({ message: "Selected course does not belong to the selected college" });
      return;
    }

    const admissionCounterKey = `college:${req.body.collegeId}`;
    const discountAmount = Number(req.body.discountAmount || 0);
    const scholarshipAmount = Number(req.body.scholarshipAmount || 0);
    const totalPayable = Number(session.sessionFee) - (discountAmount + scholarshipAmount);
    if (discountAmount < 0 || scholarshipAmount < 0) {
      res.status(400).json({ message: "Discount and scholarship cannot be negative" });
      return;
    }
    if (totalPayable < 0) {
      res.status(400).json({ message: "Discount and scholarship cannot exceed the session fee" });
      return;
    }

    const { student, admission } = await prisma.$transaction(async (tx) => {
      const nextOffset = await nextSequenceValue(tx, "ADMISSION_NUMBER", admissionCounterKey, 0);
      const admissionNumber = college.startingAdmissionNumber + nextOffset;
      const admissionCode = formatRunningCode(college.admissionNumberPrefix, admissionNumber);

      const rollCounterKey = `session:${req.body.sessionId}`;
      const nextRollOffset = await nextSequenceValue(tx, "ROLL_NUMBER", rollCounterKey, 0);
      const rollNumber = session.startingRollNumber + nextRollOffset;
      const rollCode = formatRunningCode(session.rollNumberPrefix, rollNumber);

      const createdStudent = await tx.student.create({
        data: {
          collegeId: req.body.collegeId,
          admissionNumber,
          admissionCode,
          rollNumber,
          rollCode,
          candidateName: req.body.candidateName,
          fatherName: req.body.fatherName,
          motherName: req.body.motherName,
          dob: new Date(req.body.dob),
          gender: req.body.gender,
          nationality: req.body.nationality,
          maritalStatus: req.body.maritalStatus,
          bloodGroup: req.body.bloodGroup,
          background: req.body.background,
          category: req.body.category,
          religion: req.body.religion,
          identificationMark: req.body.identificationMark,
          mobile: req.body.mobile,
          fatherMobile: req.body.fatherMobile,
          email: req.body.email,
          permanentAddress: req.body.permanentAddress,
          mailingAddress: req.body.mailingAddress || req.body.permanentAddress,
          previousQualificationJson: req.body.previousQualificationJson,
          discountAmount,
          scholarshipAmount,
          totalPayable,
          photoUrl: req.body.photoUrl,
        },
      });

      const createdAdmission = await tx.admission.create({
        data: {
          studentId: createdStudent.id,
          collegeId: req.body.collegeId,
          courseId: req.body.courseId,
          sessionId: req.body.sessionId,
          declarationText:
            "I hereby declare that all details submitted in the admission form are true and verifiable.",
        },
      });

      await tx.studentTimeline.createMany({
        data: [
          {
            studentId: createdStudent.id,
            title: "Admission Created",
            details: "New admission recorded and declaration generated",
          },
          {
            studentId: createdStudent.id,
            title: "Admission Declaration",
            details: `Declaration stored at ${createdAdmission.declarationDate.toISOString()}`,
          },
        ],
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user?.id,
          action: "STUDENT_ADMISSION_CREATED",
          entityType: "STUDENT",
          entityId: createdStudent.id,
          metadata: {
            collegeId: req.body.collegeId,
            admissionNumber,
            admissionCode,
            rollNumber,
            rollCode,
            candidateName: req.body.candidateName,
          },
        },
      });

      return { student: createdStudent, admission: createdAdmission };
    });

    res.status(201).json({ student, admission });
  }
);

studentRouter.post(
  "/students/bulk-status",
  requirePermission("STUDENTS_WRITE"),
  [body("studentIds").isArray({ min: 1 }), body("status").isIn(["ACTIVE", "PASSED_OUT", "DROP_OUT", "SOFT_DELETED"])],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const { studentIds, status } = req.body as { studentIds: string[]; status: StudentStatus };
    if (req.user?.role !== "SUPER_ADMIN") {
      const allowedStudentCount = await prisma.student.count({
        where: {
          id: { in: studentIds },
          collegeId: req.user?.collegeId,
        },
      });
      if (allowedStudentCount !== studentIds.length) {
        res.status(403).json({ message: "Bulk update includes students outside your college" });
        return;
      }
    }

    const update = await prisma.student.updateMany({
      where: {
        id: { in: studentIds },
        ...(req.user?.role !== "SUPER_ADMIN" ? { collegeId: req.user?.collegeId } : {}),
      },
      data: {
        status,
        isSoftDeleted: status === "SOFT_DELETED",
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "STUDENT_BULK_STATUS_UPDATED",
      entityType: "STUDENT",
      metadata: {
        updatedCount: update.count,
        status,
      },
    });

    res.json({ updatedCount: update.count });
  }
);

studentRouter.patch(
  "/students/:studentId",
  requirePermission("STUDENTS_WRITE"),
  [
    param("studentId").notEmpty(),
    body("candidateName").optional().isString().trim().isLength({ min: 1 }),
    body("fatherName").optional().isString().trim().isLength({ min: 1 }),
    body("motherName").optional().isString().trim().isLength({ min: 1 }),
    body("mobile").optional().isString().trim().isLength({ min: 5 }),
    body("fatherMobile").optional().isString().trim().isLength({ min: 5 }),
    body("email").optional().isEmail(),
    body("permanentAddress").optional().isString().trim().isLength({ min: 1 }),
    body("mailingAddress").optional().isString().trim().isLength({ min: 1 }),
    body("universityEnrollmentNumber").optional().isString(),
    body("universityRegistrationNumber").optional().isString(),
    body("status").optional().isIn(["ACTIVE", "PASSED_OUT", "DROP_OUT", "SOFT_DELETED"]),
  ],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const existing = await prisma.student.findUnique({
      where: { id: req.params.studentId },
      select: { collegeId: true },
    });
    if (!existing) {
      res.status(404).json({ message: "Student not found" });
      return;
    }
    if (!canAccessCollege(req, existing.collegeId)) {
      res.status(403).json({ message: "Cannot update another college's student" });
      return;
    }

    const student = await prisma.student.update({
      where: { id: req.params.studentId },
      data: {
        candidateName: req.body.candidateName,
        fatherName: req.body.fatherName,
        motherName: req.body.motherName,
        mobile: req.body.mobile,
        fatherMobile: req.body.fatherMobile,
        email: req.body.email,
        permanentAddress: req.body.permanentAddress,
        mailingAddress: req.body.mailingAddress,
        universityEnrollmentNumber: req.body.universityEnrollmentNumber,
        universityRegistrationNumber: req.body.universityRegistrationNumber,
        status: req.body.status,
        isSoftDeleted: req.body.status === "SOFT_DELETED",
      },
    });

    await prisma.studentTimeline.create({
      data: {
        studentId: student.id,
        title: "Student Profile Updated",
        details: "Core profile or university registration information changed",
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: req.user?.id,
      action: "STUDENT_PROFILE_UPDATED",
      entityType: "STUDENT",
      entityId: student.id,
      metadata: {
        status: student.status,
      },
    });

    res.json(student);
  }
);

studentRouter.get("/students/:studentId/timeline", requirePermission("STUDENTS_READ"), async (req, res) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.studentId },
    select: { collegeId: true },
  });
  if (!student) {
    res.status(404).json({ message: "Student not found" });
    return;
  }
  if (!canAccessCollege(req, student.collegeId)) {
    res.status(403).json({ message: "Cannot access another college's timeline" });
    return;
  }

  const timeline = await prisma.studentTimeline.findMany({
    where: { studentId: req.params.studentId },
    orderBy: { createdAt: "desc" },
  });

  res.json(timeline);
});

studentRouter.get("/students/:studentId/workflow", requirePermission("STUDENTS_READ", "WORKFLOW_READ"), async (req, res) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.studentId },
    include: {
      admissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!student || student.admissions.length === 0) {
    res.status(404).json({ message: "Student admission workflow not found" });
    return;
  }
  if (!canAccessCollege(req, student.collegeId)) {
    res.status(403).json({ message: "Cannot access another college's workflow" });
    return;
  }

  res.json({
    student: {
      id: student.id,
      candidateName: student.candidateName,
      admissionNumber: student.admissionNumber,
      admissionCode: student.admissionCode,
      status: student.status,
      totalPayable: student.totalPayable,
    },
    workflow: serializeAdmissionWorkflow(student.admissions[0]),
  });
});

studentRouter.patch(
  "/students/:studentId/workflow",
  requirePermission("ADMISSIONS_APPROVE"),
  [param("studentId").notEmpty(), body("action").isIn(["VERIFY_DOCUMENTS", "VERIFY_FEES", "SEND_FOR_APPROVAL", "APPROVE", "REJECT", "REQUEST_CHANGES"])],
  handleValidation,
  async (req: AuthenticatedRequest, res) => {
    const action = req.body.action as "VERIFY_DOCUMENTS" | "VERIFY_FEES" | "SEND_FOR_APPROVAL" | "APPROVE" | "REJECT" | "REQUEST_CHANGES";
    const notes = req.body.notes as string | undefined;

    const student = await prisma.student.findUnique({
      where: { id: req.params.studentId },
      include: {
        admissions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!student || student.admissions.length === 0) {
      res.status(404).json({ message: "Student admission workflow not found" });
      return;
    }
    if (!canAccessCollege(req, student.collegeId)) {
      res.status(403).json({ message: "Cannot update another college's workflow" });
      return;
    }

    const currentAdmission = student.admissions[0];
    const allowedStatuses = WORKFLOW_ACTION_RULES[action] ?? [];
    if (!allowedStatuses.includes(currentAdmission.workflowStatus)) {
      await createExceptionCase(prisma, {
        collegeId: student.collegeId,
        module: ExceptionModule.ADMISSIONS,
        category: "INVALID_WORKFLOW_TRANSITION",
        severity: ExceptionSeverity.HIGH,
        title: "Admission workflow transition blocked",
        description: `Action ${action} cannot be performed from ${currentAdmission.workflowStatus}`,
        sourceEntityType: "ADMISSION",
        sourceEntityId: currentAdmission.id,
        sourceOperation: action,
        dedupeKey: `ADMISSION:${currentAdmission.id}:${action}:${currentAdmission.workflowStatus}`,
        isRetryable: true,
        maxRetries: 2,
        metadata: {
          studentId: student.id,
          currentStatus: currentAdmission.workflowStatus,
          requestedAction: action,
        },
        createdByUserId: req.user?.id,
      });

      res.status(409).json({
        code: "INVALID_WORKFLOW_TRANSITION",
        message: `Action ${action} is not allowed from ${currentAdmission.workflowStatus}`,
      });
      return;
    }

    const now = new Date();
    const updateData: {
      workflowStatus?: AdmissionWorkflowStatus;
      workflowNotes?: string;
      workflowUpdatedAt: Date;
      documentsVerifiedAt?: Date;
      feeVerifiedAt?: Date;
    } = {
      workflowUpdatedAt: now,
    };

    if (notes) {
      updateData.workflowNotes = notes;
    }

    if (action === "VERIFY_DOCUMENTS") {
      updateData.documentsVerifiedAt = now;
      updateData.workflowStatus = currentAdmission.feeVerifiedAt ? AdmissionWorkflowStatus.PENDING_APPROVAL : AdmissionWorkflowStatus.DOCUMENTS_VERIFIED;
    }

    if (action === "VERIFY_FEES") {
      updateData.feeVerifiedAt = now;
      updateData.workflowStatus = currentAdmission.documentsVerifiedAt ? AdmissionWorkflowStatus.PENDING_APPROVAL : AdmissionWorkflowStatus.FEE_VERIFIED;
    }

    if (action === "SEND_FOR_APPROVAL") {
      updateData.workflowStatus = AdmissionWorkflowStatus.PENDING_APPROVAL;
    }

    if (action === "APPROVE") {
      updateData.workflowStatus = AdmissionWorkflowStatus.APPROVED;
    }

    if (action === "REJECT") {
      updateData.workflowStatus = AdmissionWorkflowStatus.REJECTED;
    }

    if (action === "REQUEST_CHANGES") {
      updateData.workflowStatus = AdmissionWorkflowStatus.CHANGES_REQUESTED;
    }

    const updatedAdmission = await prisma.$transaction(async (tx) => {
      const admission = await tx.admission.update({
        where: { id: currentAdmission.id },
        data: updateData,
      });

      await tx.studentTimeline.create({
        data: {
          studentId: student.id,
          title: `Workflow ${action.replace(/_/g, " ")}`,
          details: notes || `Admission workflow moved to ${admission.workflowStatus.replace(/_/g, " ")}`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user?.id,
          action: `ADMISSION_${action}`,
          entityType: "ADMISSION",
          entityId: admission.id,
          metadata: {
            studentId: student.id,
            status: admission.workflowStatus,
            notes,
          },
        },
      });

      return admission;
    });

    res.json({ workflow: serializeAdmissionWorkflow(updatedAdmission) });
  }
);

studentRouter.get("/students/:studentId/history", requirePermission("STUDENTS_READ"), async (req, res) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.studentId },
    include: {
      admissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!student) {
    res.status(404).json({ message: "Student not found" });
    return;
  }
  if (!canAccessCollege(req, student.collegeId)) {
    res.status(403).json({ message: "Cannot access another college's student history" });
    return;
  }

  const latestAdmission = student.admissions[0];

  const [timeline, audit, receipts] = await Promise.all([
    prisma.studentTimeline.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: "STUDENT", entityId: student.id },
          ...(latestAdmission ? [{ entityType: "ADMISSION", entityId: latestAdmission.id }] : []),
        ],
      },
      include: {
        actor: {
          select: {
            id: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.feeReceipt.findMany({
      where: { studentId: student.id },
      orderBy: { collectedAt: "desc" },
      take: 20,
      select: {
        id: true,
        receiptNumber: true,
        cycleKey: true,
        cycleLabel: true,
        amount: true,
        lateFine: true,
        totalReceived: true,
        paymentMode: true,
        referenceNumber: true,
        collectedBy: true,
        collectedAt: true,
      },
    }),
  ]);

  res.json({
    timeline,
    audit,
    receipts: receipts.map((receipt) => ({
      ...receipt,
      amount: Number(receipt.amount),
      lateFine: Number(receipt.lateFine),
      totalReceived: Number(receipt.totalReceived),
    })),
    workflow: latestAdmission ? serializeAdmissionWorkflow(latestAdmission) : null,
  });
});

studentRouter.get("/students/:studentId/printables", requirePermission("STUDENTS_READ"), async (req, res) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.studentId },
    include: {
      admissions: {
        include: { course: true, session: true },
      },
    },
  });

  if (!student) {
    res.status(404).json({ message: "Student not found" });
    return;
  }
  if (!canAccessCollege(req, student.collegeId)) {
    res.status(403).json({ message: "Cannot access another college's printables" });
    return;
  }

  res.json({
    student,
    availableDocuments: [
      "Fee Receipt",
      "Fee Invoice (Quotation)",
      "Admit Card",
      "ID Card",
      "Bonafide Certificate",
      "Blank Admission Form",
    ],
    storedReceipts: await prisma.feeReceipt.findMany({
      where: { studentId: student.id },
      orderBy: { collectedAt: "desc" },
      take: 20,
      select: {
        id: true,
        receiptNumber: true,
        cycleLabel: true,
        collectedAt: true,
        totalReceived: true,
      },
    }).then((receipts) =>
      receipts.map((receipt) => ({
        ...receipt,
        totalReceived: Number(receipt.totalReceived),
      }))
    ),
  });
});
