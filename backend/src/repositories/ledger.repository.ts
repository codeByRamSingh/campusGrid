import type { PrismaClient, FinancialTxnType, FinancialTxnSource } from "@prisma/client";

// Accepts either a regular PrismaClient or an interactive-transaction client.
type Db = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export type CreateLedgerEntryData = {
  collegeId: string;
  voucherNo: string;
  type: FinancialTxnType;
  amount: number;
  mode: string;
  source: FinancialTxnSource;
  studentId?: string | null;
  referenceNo?: string | null;
  remarks?: string | null;
  date?: Date;
  createdBy?: string | null;
};

export class LedgerRepository {
  constructor(private readonly db: Db) {}

  async create(data: CreateLedgerEntryData) {
    return this.db.financialTransaction.create({
      data: {
        collegeId: data.collegeId,
        voucherNo: data.voucherNo,
        type: data.type,
        amount: data.amount,
        mode: data.mode,
        source: data.source,
        studentId: data.studentId ?? null,
        referenceNo: data.referenceNo ?? null,
        remarks: data.remarks ?? null,
        date: data.date ?? new Date(),
        createdBy: data.createdBy ?? null,
      },
    });
  }

  async findById(id: string) {
    return this.db.financialTransaction.findUnique({ where: { id } });
  }

  async markReversed(id: string) {
    return this.db.financialTransaction.update({
      where: { id },
      data: { isReversed: true },
    });
  }

  async list(filters: {
    collegeId: string;
    source?: FinancialTxnSource;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }) {
    return this.db.financialTransaction.findMany({
      where: {
        collegeId: filters.collegeId,
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.startDate || filters.endDate
          ? {
              date: {
                ...(filters.startDate ? { gte: filters.startDate } : {}),
                ...(filters.endDate ? { lte: filters.endDate } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: filters.limit ?? 200,
    });
  }

  /** Compute ledger balance purely from FinancialTransaction records. */
  async getBalance(collegeId: string, asOf?: Date): Promise<number> {
    const dateFilter = asOf ? { lte: asOf } : undefined;

    const [credits, debits] = await Promise.all([
      this.db.financialTransaction.aggregate({
        where: { collegeId, type: "CREDIT", isReversed: false, ...(dateFilter ? { date: dateFilter } : {}) },
        _sum: { amount: true },
      }),
      this.db.financialTransaction.aggregate({
        where: { collegeId, type: "DEBIT", ...(dateFilter ? { date: dateFilter } : {}) },
        _sum: { amount: true },
      }),
    ]);

    return Number(credits._sum.amount ?? 0) - Number(debits._sum.amount ?? 0);
  }

  /** Count how many FinancialTransaction records exist for a given referenceNo + source. */
  async countByReference(referenceNo: string, source: FinancialTxnSource): Promise<number> {
    return this.db.financialTransaction.count({ where: { referenceNo, source } });
  }
}
