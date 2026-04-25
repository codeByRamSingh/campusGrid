import {
	ExceptionModule,
	ExceptionSeverity,
	ExceptionStatus,
	Prisma,
	type ExceptionCase,
	type PrismaClient,
	StaffRole,
} from "@prisma/client";

const OPEN_EXCEPTION_STATUSES: ExceptionStatus[] = [
	ExceptionStatus.NEW,
	ExceptionStatus.TRIAGED,
	ExceptionStatus.ASSIGNED,
	ExceptionStatus.IN_PROGRESS,
	ExceptionStatus.REOPENED,
];

const ALLOWED_TRANSITIONS: Record<ExceptionStatus, ExceptionStatus[]> = {
	[ExceptionStatus.NEW]: [ExceptionStatus.TRIAGED, ExceptionStatus.ASSIGNED, ExceptionStatus.CLOSED],
	[ExceptionStatus.TRIAGED]: [ExceptionStatus.ASSIGNED, ExceptionStatus.IN_PROGRESS, ExceptionStatus.RESOLVED, ExceptionStatus.CLOSED],
	[ExceptionStatus.ASSIGNED]: [ExceptionStatus.IN_PROGRESS, ExceptionStatus.TRIAGED, ExceptionStatus.RESOLVED],
	[ExceptionStatus.IN_PROGRESS]: [ExceptionStatus.RESOLVED, ExceptionStatus.ASSIGNED, ExceptionStatus.TRIAGED],
	[ExceptionStatus.RESOLVED]: [ExceptionStatus.CLOSED, ExceptionStatus.REOPENED],
	[ExceptionStatus.CLOSED]: [ExceptionStatus.REOPENED],
	[ExceptionStatus.REOPENED]: [ExceptionStatus.TRIAGED, ExceptionStatus.ASSIGNED, ExceptionStatus.IN_PROGRESS],
};

function getSlaHours(severity: ExceptionSeverity): number {
	if (severity === ExceptionSeverity.CRITICAL) return 4;
	if (severity === ExceptionSeverity.HIGH) return 8;
	if (severity === ExceptionSeverity.MEDIUM) return 24;
	return 72;
}

function defaultAssigneeRoles(module: ExceptionModule): StaffRole[] {
	if (module === ExceptionModule.FINANCE || module === ExceptionModule.STUDENT_FEES || module === ExceptionModule.PROCUREMENT) {
		return [StaffRole.CASHIER, StaffRole.COLLEGE_ADMIN];
	}
	if (module === ExceptionModule.PAYROLL || module === ExceptionModule.HR) {
		return [StaffRole.HR_OPERATOR, StaffRole.COLLEGE_ADMIN];
	}
	if (module === ExceptionModule.ADMISSIONS || module === ExceptionModule.STUDENT_OPERATIONS) {
		return [StaffRole.ADMISSIONS_OPERATOR, StaffRole.COLLEGE_ADMIN];
	}
	return [StaffRole.COLLEGE_ADMIN];
}

function toPrismaJson(value: Prisma.JsonValue | undefined) {
	if (value === undefined) return undefined;
	if (value === null) return Prisma.JsonNull;
	return value as Prisma.InputJsonValue;
}

export type CreateExceptionCaseInput = {
	collegeId: string;
	module: ExceptionModule;
	category: string;
	severity?: ExceptionSeverity;
	title: string;
	description: string;
	sourceEntityType?: string | null;
	sourceEntityId?: string | null;
	sourceOperation?: string | null;
	dedupeKey?: string | null;
	idempotencyKey?: string | null;
	isRetryable?: boolean;
	maxRetries?: number;
	metadata?: Prisma.JsonValue;
	createdByUserId?: string;
	assignmentRule?: string | null;
};

export type CreateExceptionCaseResult = {
	exceptionCase: ExceptionCase;
	created: boolean;
	duplicateOfId?: string;
};

async function findAutoAssignee(
	prisma: PrismaClient | Prisma.TransactionClient,
	collegeId: string,
	module: ExceptionModule
) {
	const roles = defaultAssigneeRoles(module);
	const staff = await prisma.staff.findFirst({
		where: {
			collegeId,
			isActive: true,
			role: { in: roles },
		},
		orderBy: { createdAt: "asc" },
		select: { id: true },
	});

	if (!staff) {
		return {
			assigneeStaffId: null,
			assigneeUserId: null,
			assignmentRule: `AUTO_ROLE:${roles.join("|")}:NONE`,
		};
	}

	const user = await prisma.user.findUnique({
		where: { staffId: staff.id },
		select: { id: true },
	});

	return {
		assigneeStaffId: staff.id,
		assigneeUserId: user?.id ?? null,
		assignmentRule: `AUTO_ROLE:${roles.join("|")}`,
	};
}

export async function createExceptionCase(
	prisma: PrismaClient,
	input: CreateExceptionCaseInput
): Promise<CreateExceptionCaseResult> {
	if (input.idempotencyKey) {
		const existingByIdempotency = await prisma.exceptionCase.findUnique({
			where: { idempotencyKey: input.idempotencyKey },
		});
		if (existingByIdempotency) {
			return { exceptionCase: existingByIdempotency, created: false, duplicateOfId: existingByIdempotency.id };
		}
	}

	if (input.dedupeKey) {
		const existingOpen = await prisma.exceptionCase.findFirst({
			where: {
				collegeId: input.collegeId,
				dedupeKey: input.dedupeKey,
				status: { in: OPEN_EXCEPTION_STATUSES },
			},
			orderBy: { createdAt: "desc" },
		});

		if (existingOpen) {
			return { exceptionCase: existingOpen, created: false, duplicateOfId: existingOpen.id };
		}
	}

	const severity = input.severity ?? ExceptionSeverity.MEDIUM;
	const slaDueAt = new Date(Date.now() + getSlaHours(severity) * 60 * 60 * 1000);

	const result = await prisma.$transaction(async (tx) => {
		const autoAssignment = await findAutoAssignee(tx, input.collegeId, input.module);
		const createdCase = await tx.exceptionCase.create({
			data: {
				collegeId: input.collegeId,
				module: input.module,
				category: input.category,
				severity,
				title: input.title,
				description: input.description,
				sourceEntityType: input.sourceEntityType ?? null,
				sourceEntityId: input.sourceEntityId ?? null,
				sourceOperation: input.sourceOperation ?? null,
				dedupeKey: input.dedupeKey ?? null,
				idempotencyKey: input.idempotencyKey ?? null,
				isRetryable: Boolean(input.isRetryable),
				maxRetries: input.maxRetries ?? 3,
				assignmentRule: input.assignmentRule ?? autoAssignment.assignmentRule,
				assigneeStaffId: autoAssignment.assigneeStaffId,
				assigneeUserId: autoAssignment.assigneeUserId,
				assignedAt: autoAssignment.assigneeStaffId ? new Date() : null,
				status: autoAssignment.assigneeStaffId ? ExceptionStatus.ASSIGNED : ExceptionStatus.NEW,
				slaDueAt,
				metadata: toPrismaJson(input.metadata),
				createdByUserId: input.createdByUserId,
			},
		});

		await tx.exceptionHistory.create({
			data: {
				exceptionCaseId: createdCase.id,
				eventType: "EXCEPTION_CREATED",
				toStatus: createdCase.status,
				actorUserId: input.createdByUserId,
				metadata: {
					sourceEntityType: createdCase.sourceEntityType,
					sourceEntityId: createdCase.sourceEntityId,
					sourceOperation: createdCase.sourceOperation,
				},
			},
		});

		await tx.auditLog.create({
			data: {
				actorUserId: input.createdByUserId,
				action: "EXCEPTION_CREATED",
				entityType: "EXCEPTION_CASE",
				entityId: createdCase.id,
				metadata: {
					collegeId: createdCase.collegeId,
					module: createdCase.module,
					category: createdCase.category,
					severity: createdCase.severity,
					status: createdCase.status,
				},
			},
		});

		return createdCase;
	});

	return { exceptionCase: result, created: true };
}

export type TransitionExceptionInput = {
	exceptionCaseId: string;
	toStatus: ExceptionStatus;
	actorUserId?: string;
	actorStaffId?: string;
	note?: string;
	metadata?: Prisma.JsonValue;
};

export async function transitionExceptionCase(
	prisma: PrismaClient,
	input: TransitionExceptionInput
): Promise<ExceptionCase> {
	const current = await prisma.exceptionCase.findUnique({ where: { id: input.exceptionCaseId } });
	if (!current) {
		throw new Error("EXCEPTION_CASE_NOT_FOUND");
	}

	const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
	if (!allowed.includes(input.toStatus)) {
		throw new Error(`INVALID_EXCEPTION_TRANSITION:${current.status}:${input.toStatus}`);
	}

	const now = new Date();
	const patch: Prisma.ExceptionCaseUpdateInput = {
		status: input.toStatus,
	};

	if (input.toStatus === ExceptionStatus.TRIAGED) patch.triagedAt = now;
	if (input.toStatus === ExceptionStatus.ASSIGNED) patch.assignedAt = now;
	if (input.toStatus === ExceptionStatus.IN_PROGRESS) patch.inProgressAt = now;
	if (input.toStatus === ExceptionStatus.RESOLVED) patch.resolvedAt = now;
	if (input.toStatus === ExceptionStatus.CLOSED) patch.closedAt = now;
	if (input.toStatus === ExceptionStatus.REOPENED) {
		patch.reopenedAt = now;
		patch.closedAt = null;
	}

	return prisma.$transaction(async (tx) => {
		const updated = await tx.exceptionCase.update({
			where: { id: current.id },
			data: patch,
		});

		await tx.exceptionHistory.create({
			data: {
				exceptionCaseId: updated.id,
				eventType: "STATUS_TRANSITION",
				fromStatus: current.status,
				toStatus: input.toStatus,
				note: input.note,
				actorUserId: input.actorUserId,
				actorStaffId: input.actorStaffId,
				metadata: toPrismaJson(input.metadata),
			},
		});

		await tx.auditLog.create({
			data: {
				actorUserId: input.actorUserId,
				action: "EXCEPTION_STATUS_CHANGED",
				entityType: "EXCEPTION_CASE",
				entityId: updated.id,
				metadata: {
					from: current.status,
					to: input.toStatus,
					note: input.note,
				},
			},
		});

		return updated;
	});
}

export async function runExceptionAutomation(prisma: PrismaClient, actorUserId?: string, collegeId?: string) {
	const now = new Date();
	const openCases = await prisma.exceptionCase.findMany({
		where: {
			status: { in: OPEN_EXCEPTION_STATUSES },
			...(collegeId ? { collegeId } : {}),
		},
		orderBy: { createdAt: "asc" },
	});

	let autoAssigned = 0;
	let escalated = 0;

	for (const item of openCases) {
		if (!item.assigneeStaffId) {
			const assignment = await findAutoAssignee(prisma, item.collegeId, item.module);
			if (assignment.assigneeStaffId) {
				await prisma.exceptionCase.update({
					where: { id: item.id },
					data: {
						assigneeStaffId: assignment.assigneeStaffId,
						assigneeUserId: assignment.assigneeUserId,
						assignmentRule: assignment.assignmentRule,
						assignedAt: now,
						status: item.status === ExceptionStatus.NEW ? ExceptionStatus.ASSIGNED : item.status,
					},
				});
				await prisma.exceptionHistory.create({
					data: {
						exceptionCaseId: item.id,
						eventType: "AUTO_ASSIGNED",
						fromStatus: item.status,
						toStatus: item.status === ExceptionStatus.NEW ? ExceptionStatus.ASSIGNED : item.status,
						actorUserId,
						metadata: { assignmentRule: assignment.assignmentRule },
					},
				});
				autoAssigned += 1;
			}
		}

		if (!item.escalatedAt && item.slaDueAt && item.slaDueAt < now) {
			await prisma.exceptionCase.update({
				where: { id: item.id },
				data: {
					escalatedAt: now,
					severity: item.severity === ExceptionSeverity.CRITICAL ? ExceptionSeverity.CRITICAL : ExceptionSeverity.HIGH,
				},
			});
			await prisma.exceptionHistory.create({
				data: {
					exceptionCaseId: item.id,
					eventType: "SLA_ESCALATED",
					actorUserId,
					metadata: { slaDueAt: item.slaDueAt.toISOString() },
				},
			});
			escalated += 1;
		}
	}

	return { processed: openCases.length, autoAssigned, escalated };
}
