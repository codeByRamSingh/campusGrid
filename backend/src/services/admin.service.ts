import { ConflictError, NotFoundError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";
import { normalizePermissions } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";

// ─── Colleges ────────────────────────────────────────────────────────────────

export type CreateCollegeInput = {
  name: string;
  code: string;
  university: string;
  registrationYear?: number;
  address?: string;
  startingRollNumber?: number;
  startingAdmissionNumber?: number;
  admissionNumberPrefix?: string;
};

export type UpdateCollegeInput = {
  name: string;
  code: string;
  registrationYear: number;
  address: string;
  university: string;
  startingRollNumber: number;
  startingAdmissionNumber: number;
  admissionNumberPrefix: string;
};

export async function createCollege(input: CreateCollegeInput, actorUserId?: string) {
  const trust = await prisma.trust.findFirst();
  if (!trust) throw new NotFoundError("Trust not initialized");

  const college = await prisma.college.create({
    data: {
      trustId: trust.id,
      name: input.name,
      code: input.code,
      registrationYear: Number(input.registrationYear ?? new Date().getFullYear()),
      address: input.address ?? "Not specified",
      university: input.university,
      startingRollNumber: Number(input.startingRollNumber ?? 1),
      startingAdmissionNumber: Number(input.startingAdmissionNumber ?? 1),
      admissionNumberPrefix: String(input.admissionNumberPrefix ?? `MTET/AD${new Date().getFullYear()}`),
    },
  });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "COLLEGE_CREATED",
    entityType: "COLLEGE",
    entityId: college.id,
    metadata: { code: college.code, university: college.university },
  });

  return college;
}

export async function updateCollege(collegeId: string, input: UpdateCollegeInput, actorUserId?: string) {
  const updated = await prisma.college.update({
    where: { id: collegeId },
    data: {
      name: input.name,
      code: input.code,
      registrationYear: Number(input.registrationYear),
      address: input.address,
      university: input.university,
      startingRollNumber: Number(input.startingRollNumber),
      startingAdmissionNumber: Number(input.startingAdmissionNumber),
      admissionNumberPrefix: input.admissionNumberPrefix,
    },
  });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "COLLEGE_UPDATED",
    entityType: "COLLEGE",
    entityId: updated.id,
    metadata: { code: updated.code, university: updated.university },
  });

  return updated;
}

export async function deleteCollege(collegeId: string, actorUserId?: string) {
  const [coursesCount, studentsCount, staffCount, admissionsCount, paymentsCount, creditsCount, expensesCount] =
    await Promise.all([
      prisma.course.count({ where: { collegeId } }),
      prisma.student.count({ where: { collegeId } }),
      prisma.staff.count({ where: { collegeId } }),
      prisma.admission.count({ where: { collegeId } }),
      prisma.payment.count({ where: { collegeId } }),
      prisma.credit.count({ where: { collegeId } }),
      prisma.expense.count({ where: { collegeId } }),
    ]);

  const hasDependencies =
    coursesCount > 0 ||
    studentsCount > 0 ||
    staffCount > 0 ||
    admissionsCount > 0 ||
    paymentsCount > 0 ||
    creditsCount > 0 ||
    expensesCount > 0;

  if (hasDependencies) {
    throw new ConflictError(
      "Cannot delete college with linked data. Remove linked courses/students/staff/finance/admissions first.",
    );
  }

  await prisma.college.delete({ where: { id: collegeId } });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "COLLEGE_DELETED",
    entityType: "COLLEGE",
    entityId: collegeId,
  });
}

export async function listColleges(collegeId?: string) {
  return prisma.college.findMany({
    where: collegeId ? { id: collegeId } : {},
    include: { courses: true },
  });
}

export async function getAcademicStructure(collegeId?: string) {
  return prisma.college.findMany({
    where: collegeId ? { id: collegeId } : {},
    include: {
      courses: {
        include: { sessions: true, subjects: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

// ─── Courses ──────────────────────────────────────────────────────────────────

export type CreateCourseInput = {
  collegeId: string;
  name: string;
  courseCode: string;
  courseFee?: number;
};

export async function createCourse(input: CreateCourseInput, actorUserId?: string) {
  const course = await prisma.course.create({
    data: {
      collegeId: input.collegeId,
      name: input.name,
      courseCode: input.courseCode,
      courseFee: input.courseFee ?? 0,
    },
  });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "COURSE_CREATED",
    entityType: "COURSE",
    entityId: course.id,
    metadata: { collegeId: course.collegeId, courseCode: course.courseCode },
  });

  return course;
}

export async function updateCourse(
  courseId: string,
  input: { name: string; courseCode: string; courseFee?: number; startYear?: number | null; endYear?: number | null },
  actorUserId?: string,
) {
  const updated = await prisma.course.update({
    where: { id: courseId },
    data: {
      name: input.name,
      courseCode: input.courseCode,
      ...(input.courseFee !== undefined ? { courseFee: input.courseFee } : {}),
      ...(input.startYear !== undefined ? { startYear: input.startYear } : {}),
      ...(input.endYear !== undefined ? { endYear: input.endYear } : {}),
    },
  });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "COURSE_UPDATED",
    entityType: "COURSE",
    entityId: updated.id,
    metadata: { courseCode: updated.courseCode },
  });

  return updated;
}

export async function deleteCourse(courseId: string, actorUserId?: string) {
  const studentCount = await prisma.student.count({
    where: { admissions: { some: { courseId } } },
  });

  if (studentCount > 0) {
    throw new ConflictError("Cannot delete a course with enrolled students");
  }

  await prisma.course.delete({ where: { id: courseId } });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "COURSE_DELETED",
    entityType: "COURSE",
    entityId: courseId,
  });
}

// ─── Custom Roles ─────────────────────────────────────────────────────────────

export async function listCustomRoles(collegeId?: string) {
  const roles = await prisma.customRole.findMany({
    where: collegeId ? { collegeId } : {},
    include: { _count: { select: { staff: true } } },
    orderBy: [{ collegeId: "asc" }, { name: "asc" }],
  });
  return roles.map((role) => ({ ...role, permissions: normalizePermissions(role.permissions) }));
}

export async function createCustomRole(
  collegeId: string,
  name: string,
  permissions: string[],
  actorUserId?: string,
) {
  const normalizedPerms = normalizePermissions(permissions);
  const created = await prisma.customRole.create({
    data: { collegeId, name: name.trim(), permissions: normalizedPerms },
  });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "CUSTOM_ROLE_CREATED",
    entityType: "CUSTOM_ROLE",
    entityId: created.id,
    metadata: { collegeId, permissions: normalizedPerms },
  });

  return { ...created, permissions: normalizedPerms };
}

export async function updateCustomRole(
  roleId: string,
  input: { name?: string; permissions?: string[] },
  actorUserId?: string,
) {
  const existing = await prisma.customRole.findUnique({ where: { id: roleId } });
  if (!existing) throw new NotFoundError("Custom role not found");

  const permissions = input.permissions !== undefined ? normalizePermissions(input.permissions) : undefined;
  const updated = await prisma.customRole.update({
    where: { id: roleId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(permissions !== undefined ? { permissions } : {}),
    },
  });

  await writeAuditLog(prisma, {
    actorUserId,
    action: "CUSTOM_ROLE_UPDATED",
    entityType: "CUSTOM_ROLE",
    entityId: updated.id,
    metadata: {
      collegeId: updated.collegeId,
      permissions: permissions ?? normalizePermissions(updated.permissions),
    },
  });

  return { ...updated, permissions: normalizePermissions(updated.permissions) };
}

export async function deleteCustomRole(roleId: string, actorUserId?: string) {
  const existing = await prisma.customRole.findUnique({
    where: { id: roleId },
    include: { _count: { select: { staff: true } } },
  });
  if (!existing) throw new NotFoundError("Custom role not found");

  if (existing._count.staff > 0) {
    throw new ConflictError("Cannot delete a custom role that is assigned to staff members");
  }

  await prisma.customRole.delete({ where: { id: roleId } });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "CUSTOM_ROLE_DELETED",
    entityType: "CUSTOM_ROLE",
    entityId: roleId,
    metadata: { collegeId: existing.collegeId, name: existing.name },
  });
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function listCourseSessions(courseId: string) {
  return prisma.session.findMany({
    where: { courseId },
    orderBy: { startYear: "asc" },
  });
}
