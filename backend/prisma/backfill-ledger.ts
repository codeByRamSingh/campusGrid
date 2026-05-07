/**
 * backfill-ledger.ts — Phase 5: Ledger Backfill Migration
 *
 * Scans all historical financial records that pre-date the Phase 2 enforcement
 * layer and creates matching FinancialTransaction entries for each one so that
 * the unified ledger becomes the single source of truth even for old data.
 *
 * Safe to re-run: every INSERT is guarded by a NOT-EXISTS check so existing
 * ledger entries are never duplicated.
 *
 * Run via:
 *   npx ts-node --esm prisma/backfill-ledger.ts
 * or inside the container:
 *   docker exec campusgrid-backend npx ts-node --esm prisma/backfill-ledger.ts
 *
 * Anomaly detection:
 *   After backfill, the script prints a reconciliation report showing total
 *   credits, debits, and any drift between the ledger balance and the
 *   module-aggregate balance.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).slice(0, 8).toUpperCase();
}

async function backfillFeeCollections() {
  // Payment rows with paymentType = FEE_COLLECTION that have no matching
  // FinancialTransaction (voucherNo match on receipt number).
  const payments = await prisma.payment.findMany({
    where: {
      paymentType: { in: ["FEE_COLLECTION", "MISC_CREDIT"] },
      reversal: null,
    },
    select: {
      id: true, collegeId: true, amount: true, receiptNumber: true,
      paymentMode: true, paymentType: true, description: true,
      paidAt: true, studentId: true,
    },
  });

  let inserted = 0;
  let skipped = 0;

  for (const p of payments) {
    const existing = await prisma.financialTransaction.findFirst({
      where: { voucherNo: p.receiptNumber, collegeId: p.collegeId, source: p.paymentType === "MISC_CREDIT" ? "MISC" : "FEES" },
    });
    if (existing) { skipped++; continue; }

    await prisma.financialTransaction.create({
      data: {
        collegeId: p.collegeId,
        voucherNo: p.receiptNumber,
        type: "CREDIT",
        amount: Number(p.amount),
        mode: p.paymentMode ?? "CASH",
        source: p.paymentType === "MISC_CREDIT" ? "MISC" : "FEES",
        studentId: p.studentId,
        referenceNo: p.id,
        remarks: p.description,
        date: p.paidAt,
        createdBy: null,
      },
    });
    inserted++;
  }

  console.log(`[Fee/Misc Collections]  inserted=${inserted}  skipped=${skipped}`);
  return { inserted, skipped };
}

async function backfillFines() {
  const fines = await prisma.payment.findMany({
    where: { paymentType: "FINE", reversal: null },
    select: {
      id: true, collegeId: true, amount: true, receiptNumber: true,
      paymentMode: true, description: true, paidAt: true, studentId: true,
    },
  });

  let inserted = 0;
  let skipped = 0;

  for (const f of fines) {
    const existing = await prisma.financialTransaction.findFirst({
      where: { referenceNo: f.id, source: "FEES" },
    });
    if (existing) { skipped++; continue; }

    await prisma.financialTransaction.create({
      data: {
        collegeId: f.collegeId,
        voucherNo: f.receiptNumber,
        type: "CREDIT",
        amount: Number(f.amount),
        mode: f.paymentMode ?? "CASH",
        source: "FEES",
        studentId: f.studentId,
        referenceNo: f.id,
        remarks: `Fine — ${f.description}`,
        date: f.paidAt,
        createdBy: null,
      },
    });
    inserted++;
  }

  console.log(`[Fines]                 inserted=${inserted}  skipped=${skipped}`);
  return { inserted, skipped };
}

async function backfillMiscCredits() {
  // Legacy Credit table rows (pre-FinancialTransaction era)
  const credits = await prisma.credit.findMany({
    select: { id: true, collegeId: true, amount: true, source: true, notes: true, createdAt: true },
  });

  let inserted = 0;
  let skipped = 0;

  for (const c of credits) {
    const voucherNo = `MISC-LEGACY-${pad(c.id)}`;
    const existing = await prisma.financialTransaction.findFirst({
      where: { voucherNo, collegeId: c.collegeId },
    });
    if (existing) { skipped++; continue; }

    await prisma.financialTransaction.create({
      data: {
        collegeId: c.collegeId,
        voucherNo,
        type: "CREDIT",
        amount: Number(c.amount),
        mode: "BANK",
        source: "MISC",
        referenceNo: c.id,
        remarks: c.notes ?? c.source,
        date: c.createdAt,
        createdBy: null,
      },
    });
    inserted++;
  }

  console.log(`[Legacy Credits]        inserted=${inserted}  skipped=${skipped}`);
  return { inserted, skipped };
}

async function backfillApprovedExpenses() {
  const expenses = await prisma.expense.findMany({
    where: { approvalStatus: "APPROVED" },
    select: {
      id: true, collegeId: true, amount: true, category: true, subcategory: true,
      paymentSource: true, spentOn: true, approvedAt: true, approvedByUserId: true,
    },
  });

  let inserted = 0;
  let skipped = 0;

  for (const e of expenses) {
    const existing = await prisma.financialTransaction.findFirst({
      where: { referenceNo: e.id, source: "EXPENSE" },
    });
    if (existing) { skipped++; continue; }

    await prisma.financialTransaction.create({
      data: {
        collegeId: e.collegeId,
        voucherNo: `EXP-${pad(e.id)}`,
        type: "DEBIT",
        amount: Number(e.amount),
        mode: e.paymentSource ?? "BANK",
        source: "EXPENSE",
        referenceNo: e.id,
        remarks: `${e.category}${e.subcategory ? ": " + e.subcategory : ""}`,
        date: e.spentOn,
        createdBy: e.approvedByUserId ?? null,
      },
    });
    inserted++;
  }

  console.log(`[Approved Expenses]     inserted=${inserted}  skipped=${skipped}`);
  return { inserted, skipped };
}

async function backfillPaidPayroll() {
  const payrolls = await prisma.payroll.findMany({
    where: { status: "PAID" },
    include: { staff: { select: { collegeId: true } } },
  });

  let inserted = 0;
  let skipped = 0;

  for (const py of payrolls) {
    const existing = await prisma.financialTransaction.findFirst({
      where: { referenceNo: py.id, source: "SALARY" },
    });
    if (existing) { skipped++; continue; }

    await prisma.financialTransaction.create({
      data: {
        collegeId: py.staff.collegeId,
        voucherNo: `SAL-${pad(py.id)}`,
        type: "DEBIT",
        amount: Number(py.netAmount),
        mode: "BANK_TRANSFER",
        source: "SALARY",
        referenceNo: py.id,
        remarks: `Salary ${py.month}/${py.year}`,
        date: py.paidAt ?? new Date(py.year, py.month - 1, 28),
        createdBy: null,
      },
    });
    inserted++;
  }

  console.log(`[Paid Payroll]          inserted=${inserted}  skipped=${skipped}`);
  return { inserted, skipped };
}

async function backfillPaymentReversals() {
  const reversals = await prisma.paymentReversal.findMany({
    include: { payment: { select: { id: true, collegeId: true, amount: true, paymentMode: true, receiptNumber: true, paidAt: true } } },
  });

  let inserted = 0;
  let skipped = 0;

  for (const r of reversals) {
    const existing = await prisma.financialTransaction.findFirst({
      where: { referenceNo: r.payment.id, source: "REVERSAL" },
    });
    if (existing) { skipped++; continue; }

    await prisma.financialTransaction.create({
      data: {
        collegeId: r.payment.collegeId,
        voucherNo: `REV-${r.payment.receiptNumber}`,
        type: "DEBIT",
        amount: Number(r.payment.amount),
        mode: r.payment.paymentMode ?? "CASH",
        source: "REVERSAL",
        referenceNo: r.payment.id,
        remarks: r.reason,
        date: r.reversedAt,
        createdBy: r.reversedBy ?? null,
      },
    });
    inserted++;
  }

  console.log(`[Payment Reversals]     inserted=${inserted}  skipped=${skipped}`);
  return { inserted, skipped };
}

// ─── Reconciliation Report ────────────────────────────────────────────────────

async function reconciliationReport() {
  const colleges = await prisma.college.findMany({ select: { id: true, name: true } });

  console.log("\n──────────────────────────────────────────────────");
  console.log("RECONCILIATION REPORT (per college)");
  console.log("──────────────────────────────────────────────────");

  let totalDrift = 0;

  for (const college of colleges) {
    const cid = college.id;

    const [ftCredits, ftDebits, modFeeCredits, modExpenseDebits, modPayrollDebits] = await Promise.all([
      prisma.financialTransaction.aggregate({
        where: { collegeId: cid, type: "CREDIT", isReversed: false },
        _sum: { amount: true },
      }),
      prisma.financialTransaction.aggregate({
        where: { collegeId: cid, type: "DEBIT" },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { collegeId: cid, paymentType: { in: ["FEE_COLLECTION", "MISC_CREDIT", "FINE"] }, reversal: null },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { collegeId: cid, approvalStatus: "APPROVED" },
        _sum: { amount: true },
      }),
      prisma.payroll.aggregate({
        where: { status: "PAID", staff: { collegeId: cid } },
        _sum: { netAmount: true },
      }),
    ]);

    const ledgerBalance = Number(ftCredits._sum.amount ?? 0) - Number(ftDebits._sum.amount ?? 0);
    const moduleBalance =
      Number(modFeeCredits._sum.amount ?? 0) -
      Number(modExpenseDebits._sum.amount ?? 0) -
      Number(modPayrollDebits._sum.netAmount ?? 0);
    const drift = Math.abs(ledgerBalance - moduleBalance);
    totalDrift += drift;

    const status = drift < 0.01 ? "✅ CLEAN" : "⚠️  DRIFT";
    console.log(`  ${status} ${college.name.padEnd(35)} ledger=${ledgerBalance.toFixed(2).padStart(12)} module=${moduleBalance.toFixed(2).padStart(12)} drift=${drift.toFixed(2).padStart(10)}`);

    if (drift >= 0.01) {
      // Find anomalies
      const missingFTExpenses = await prisma.expense.count({
        where: {
          collegeId: cid, approvalStatus: "APPROVED",
          NOT: {
            id: {
              in: (await prisma.financialTransaction.findMany({ where: { collegeId: cid, source: "EXPENSE" }, select: { referenceNo: true } }))
                .map(r => r.referenceNo).filter((r): r is string => r !== null),
            },
          },
        },
      });
      if (missingFTExpenses > 0) {
        console.log(`       ↳ ${missingFTExpenses} approved expense(s) missing ledger entry`);
      }
    }
  }

  console.log("──────────────────────────────────────────────────");
  console.log(`Total system-wide drift: ${totalDrift.toFixed(2)}`);
  console.log(totalDrift < 0.01 ? "✅ Ledger is CLEAN — zero drift detected." : "⚠️  Drift detected — investigate before marking migration complete.");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("CampusGrid — Phase 5 Ledger Backfill Migration");
  console.log(`Started: ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  await backfillFeeCollections();
  await backfillFines();
  await backfillMiscCredits();
  await backfillApprovedExpenses();
  await backfillPaidPayroll();
  await backfillPaymentReversals();

  console.log("\nBackfill complete. Running reconciliation...\n");
  await reconciliationReport();

  console.log(`\nFinished: ${new Date().toISOString()}`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
