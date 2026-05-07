import { api } from "./api";

export type ExpenseRow = { id: string; amount: number; category: string; spentOn: string; notes?: string; approvalStatus?: string };
export type PaginatedResponse<T> = { data: T[]; nextCursor?: string; hasMore: boolean };
export type Ledger = {
  totalCollected: number;
  totalExpenses: number;
  netBalance: number;
  collections: Array<{ date: string; amount: number; paymentMode: string }>;
  period?: string;
};

export type CashLedgerTransaction = {
  id: string;
  date: string;
  voucher_no: string;
  particulars: string;
  party: string | null;
  receipt_no: string | null;
  debit: number;
  credit: number;
  mode: string;
  running_balance: number;
  remarks: string | null;
  source_module: string;
  is_reversed: boolean;
};

export type CashLedgerResponse = {
  opening_balance: number;
  transactions: CashLedgerTransaction[];
  closing_balance: number;
  total_credit: number;
  total_debit: number;
};

export type FinancialTxnType = "CREDIT" | "DEBIT";
export type FinancialTxnSource = "FEES" | "MISC" | "EXPENSE" | "PETTY_CASH" | "SALARY" | "ADJUSTMENT" | "REVERSAL";

export type FinancialTransaction = {
  id: string;
  collegeId: string;
  date: string;
  voucherNo: string;
  type: FinancialTxnType;
  amount: number;
  mode: string;
  source: FinancialTxnSource;
  studentId: string | null;
  referenceNo: string | null;
  remarks: string | null;
  isReversed: boolean;
  reversalOf: string | null;
  createdAt: string;
  createdBy: string | null;
};

export const financeApi = {
  // ─── Fee Collection ──────────────────────────────────────────────────────────
  collectFee: (data: Record<string, unknown>) =>
    api.post("/finance/fee-collections", data).then((r) => r.data),

  saveFeeDraft: (data: Record<string, unknown>) =>
    api.post("/finance/fee-collections/drafts", data).then((r) => r.data),

  confirmFeeDraft: (draftId: string) =>
    api.post(`/finance/fee-collections/from-draft/${draftId}`).then((r) => r.data),

  raiseFeeException: (data: Record<string, unknown>) =>
    api.post("/finance/fee-collections/exceptions", data).then((r) => r.data),

  getFeeExceptions: (params?: { studentId?: string; collegeId?: string }) =>
    api.get("/finance/fee-collections/exceptions", { params }).then((r) => r.data),

  reviewFeeException: (exceptionId: string, data: { status: string; reviewNote?: string }) =>
    api.patch(`/finance/fee-collections/exceptions/${exceptionId}/review`, data).then((r) => r.data),

  // ─── Expenses ────────────────────────────────────────────────────────────────
  getExpenses: (params?: { cursor?: string; limit?: number; status?: string }) =>
    api.get<PaginatedResponse<ExpenseRow>>("/finance/expenses", { params }).then((r) => r.data),

  createExpense: (data: Record<string, unknown>) =>
    api.post("/finance/expenses", data).then((r) => r.data),

  updateExpense: (expenseId: string, data: Record<string, unknown>) =>
    api.patch(`/finance/expenses/${expenseId}`, data).then((r) => r.data),

  approveExpense: (expenseId: string, data: { status: string; rejectionNote?: string }) =>
    api.patch(`/finance/expenses/${expenseId}/approval`, data).then((r) => r.data),

  getExpenseAttachmentToken: (expenseId: string) =>
    api.get<{ token: string }>(`/finance/expenses/${expenseId}/attachment-token`).then((r) => r.data),

  // ─── Vendors ─────────────────────────────────────────────────────────────────
  getVendors: (collegeId?: string) =>
    api.get("/finance/vendors", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  createVendor: (data: Record<string, unknown>) =>
    api.post("/finance/vendors", data).then((r) => r.data),

  updateVendor: (vendorId: string, data: Record<string, unknown>) =>
    api.patch(`/finance/vendors/${vendorId}`, data).then((r) => r.data),

  // ─── Credits ─────────────────────────────────────────────────────────────────
  addMiscCredit: (data: Record<string, unknown>) =>
    api.post("/finance/misc-credits", data).then((r) => r.data),

  getCredits: (collegeId?: string) =>
    api.get("/finance/misc-credits", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  // ─── Financial Transactions (unified ledger) ──────────────────────────────────
  getTransactions: (params: {
    collegeId?: string;
    source?: FinancialTxnSource;
    start_date?: string;
    end_date?: string;
    limit?: number;
  }) =>
    api.get<FinancialTransaction[]>("/finance/transactions", { params }).then((r) => r.data),

  reverseTransaction: (id: string, reason?: string) =>
    api.post<FinancialTransaction>(`/finance/transactions/${id}/reverse`, { reason }).then((r) => r.data),

  // ─── Budgets ─────────────────────────────────────────────────────────────────
  getBudgets: (collegeId?: string) =>
    api.get("/finance/budgets", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  upsertBudget: (data: Record<string, unknown>) =>
    api.post("/finance/budgets", data).then((r) => r.data),

  // ─── Petty Cash ──────────────────────────────────────────────────────────────
  getPettyCash: (collegeId?: string) =>
    api.get("/finance/petty-cash", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  addPettyCash: (data: Record<string, unknown>) =>
    api.post("/finance/petty-cash", data).then((r) => r.data),

  // ─── Fine Policy ─────────────────────────────────────────────────────────────
  getFinePolicy: (collegeId: string) =>
    api.get(`/finance/fine-policy`, { params: { collegeId } }).then((r) => r.data),

  upsertFinePolicy: (data: Record<string, unknown>) =>
    api.post("/finance/fine-policy", data).then((r) => r.data),

  // ─── Demand Cycles ───────────────────────────────────────────────────────────
  getFeeDemandCycles: (collegeId?: string) =>
    api.get("/finance/fee-demand-cycles", { params: collegeId ? { collegeId } : {} }).then((r) => r.data),

  // ─── Vendor Payments ─────────────────────────────────────────────────────────
  recordVendorPayment: (vendorId: string, data: Record<string, unknown>) =>
    api.post(`/finance/vendors/${vendorId}/payments`, data).then((r) => r.data),

  getVendorPayments: (vendorId?: string) =>
    api.get("/finance/vendor-payments", { params: vendorId ? { vendorId } : {} }).then((r) => r.data),

  // ─── Ledger ──────────────────────────────────────────────────────────────────
  getLedger: (params?: { collegeId?: string; period?: string }) =>
    api.get<Ledger>("/finance/ledger", { params }).then((r) => r.data),

  // ─── Ledger Balance (authoritative, from FinancialTransaction) ───────────────
  getLedgerBalance: (collegeId: string) =>
    api.get<{ collegeId: string; balance: number; source: string }>(
      "/finance/ledger-balance", { params: { collegeId } }
    ).then((r) => r.data),

  // ─── Consistency Check ───────────────────────────────────────────────────────
  getConsistencyCheck: (collegeId: string) =>
    api.get<{
      collegeId: string;
      status: "CLEAN" | "DRIFT_DETECTED";
      missingExpenseLedger: number;
      missingPayrollLedger: number;
      missingFeeCollectionLedger: number;
      missingPaymentReversalLedger: number;
      ledgerBalance: number;
      moduleBalance: number;
      drift: number;
      recommendation: string;
    }>("/finance/consistency-check", { params: { collegeId } }).then((r) => r.data),

  // ─── Cash Ledger ─────────────────────────────────────────────────────────────
  getCashLedger: (params: { college_id: string; start_date?: string; end_date?: string }) =>
    api.get<CashLedgerResponse>("/finance/cash-ledger", { params }).then((r) => r.data),

  // ─── Student Ledger ──────────────────────────────────────────────────────────
  getStudentLedger: (studentId: string) =>
    api.get(`/finance/students/${studentId}/ledger`).then((r) => r.data),

  // ─── Receipts ────────────────────────────────────────────────────────────────
  getReceipt: (receiptNumber: string) =>
    api.get(`/finance/receipts/${receiptNumber}`).then((r) => r.data),

  // ─── Student Dues (cashier simplified view) ──────────────────────────────────
  getStudentDues: (studentId: string) =>
    api.get(`/finance/students/${studentId}/dues`).then((r) => r.data),

  // ─── Allocated Fee Collection ────────────────────────────────────────────────
  collectFeeAllocated: (data: {
    studentId: string;
    paymentMode: string;
    paymentDate?: string;
    notes?: string;
    reference?: string;
    allocations: Array<{ cycleKey: string; amount: number }>;
  }) => api.post("/finance/fee-collections/allocate", data).then((r) => r.data),
};
