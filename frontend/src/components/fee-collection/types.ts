export type StudentDue = {
  cycleKey: string;
  label: string;
  dueDate: string;
  amount: number;
  paid: number;
  balance: number;
  status: string;
};

export type StudentInfo = {
  id: string;
  name: string;
  admissionNo: string;
  college: string;
  course: string;
  session: string;
  status: string;
  totalPayable: number;
  totalPaid: number;
  totalDue: number;
};

export type StudentDuesData = {
  student: StudentInfo;
  dues: StudentDue[];
};

export type PayAllocation = {
  cycleKey: string;
  label: string;
  amount: number;
};

export type CollectResult = {
  receiptNumber: string;
  totalAmount: number;
  paymentMode: string;
  paidAt: string;
  allocations: PayAllocation[];
  student: {
    name: string;
    admissionNo: string;
    college: string;
    course: string | null;
    session: string | null;
  };
};

export type PaymentMode = "CASH" | "UPI" | "BANK";
