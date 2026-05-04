import { useEffect, useState } from "react";
import { BookOpen, Plus, Search, BookMarked, RotateCcw, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../services/api";
import { hasPermission } from "../../lib/permissions";
import { useAuth } from "../../contexts/AuthContext";
import { useAcademicStructure } from "../../hooks/useAcademicStructure";
import { useStudents } from "../../hooks/useStudents";

type College = { id: string; name: string };
type Student = { id: string; candidateName: string; admissionNumber: number };

export type LibraryBook = {
  id: string;
  collegeId: string;
  title: string;
  author: string;
  isbn?: string;
  publisher?: string;
  edition?: string;
  category?: string;
  totalCopies: number;
  availableCopies: number;
  shelfLocation?: string;
  isActive: boolean;
  _count: { transactions: number };
};

export type LibraryTransaction = {
  id: string;
  bookId: string;
  studentId: string;
  collegeId: string;
  issueDate: string;
  dueDate: string;
  returnDate?: string;
  status: "ISSUED" | "RETURNED" | "OVERDUE" | "LOST";
  fine: number;
  finePaid: boolean;
  book: { id: string; title: string; author: string; isbn?: string };
  student: { id: string; candidateName: string; admissionNumber: number };
};


const STATUS_STYLES: Record<string, string> = {
  ISSUED: "bg-blue-900/40 text-blue-300",
  RETURNED: "bg-emerald-900/40 text-emerald-300",
  OVERDUE: "bg-red-900/40 text-red-300",
  LOST: "bg-slate-700 text-slate-400",
};

export default function LibraryPage() {
  const { permissions } = useAuth();
  const { data: academicStructure = [], isFetching: loading } = useAcademicStructure();
  const colleges: College[] = academicStructure.map((c) => ({ id: c.id, name: c.name }));
  const { data: studentsPayload } = useStudents();
  const students: Student[] = (Array.isArray(studentsPayload) ? studentsPayload : (studentsPayload?.data ?? [])).map((s) => ({ id: s.id, candidateName: s.candidateName, admissionNumber: s.admissionNumber }));
  const canWrite = hasPermission(permissions, "LIBRARY_WRITE");

  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [transactions, setTransactions] = useState<LibraryTransaction[]>([]);
  const [activeTab, setActiveTab] = useState<"catalog" | "transactions">("catalog");
  const [dataLoaded, setDataLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("ALL");

  const [showBookForm, setShowBookForm] = useState(false);
  const [bookForm, setBookForm] = useState({ collegeId: "", title: "", author: "", isbn: "", publisher: "", edition: "", category: "", totalCopies: 1, shelfLocation: "" });
  const [savingBook, setSavingBook] = useState(false);

  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueForm, setIssueForm] = useState({ bookId: "", studentId: "", collegeId: "", dueDate: "" });
  const [savingIssue, setSavingIssue] = useState(false);

  const [returnTxnId, setReturnTxnId] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<string | null>(null);

  useEffect(() => { void loadData(); }, []);

  async function loadData() {
    try {
      const [booksRes, txnsRes] = await Promise.all([
        api.get<LibraryBook[]>("/library/books"),
        api.get<LibraryTransaction[]>("/library/transactions"),
      ]);
      setBooks(booksRes.data);
      setTransactions(txnsRes.data);
      setDataLoaded(true);
    } catch {
      toast.error("Failed to load library data");
    }
  }

  async function saveBook(e: React.FormEvent) {
    e.preventDefault();
    setSavingBook(true);
    try {
      const { data } = await api.post<LibraryBook>("/library/books", bookForm);
      setBooks((prev) => [{ ...data, _count: { transactions: 0 } }, ...prev]);
      toast.success("Book added to catalog");
      setShowBookForm(false);
    } catch {
      toast.error("Failed to add book");
    } finally {
      setSavingBook(false);
    }
  }

  async function saveIssue(e: React.FormEvent) {
    e.preventDefault();
    setSavingIssue(true);
    try {
      const { data } = await api.post<LibraryTransaction>("/library/transactions/issue", { ...issueForm, dueDate: new Date(issueForm.dueDate).toISOString() });
      const book = books.find((b) => b.id === data.bookId);
      const student = students.find((s) => s.id === data.studentId);
      setTransactions((prev) => [{
        ...data,
        book: { id: data.bookId, title: book?.title ?? "", author: book?.author ?? "", isbn: book?.isbn },
        student: { id: data.studentId, candidateName: student?.candidateName ?? "", admissionNumber: student?.admissionNumber ?? 0 },
      }, ...prev]);
      setBooks((prev) => prev.map((b) => b.id === data.bookId ? { ...b, availableCopies: b.availableCopies - 1 } : b));
      toast.success("Book issued");
      setShowIssueForm(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Failed to issue book";
      toast.error(msg);
    } finally {
      setSavingIssue(false);
    }
  }

  async function returnBook(txnId: string) {
    setReturningId(txnId);
    try {
      const { data } = await api.post<{ transaction: LibraryTransaction; overdueDays: number; fine: number }>(`/library/transactions/${txnId}/return`);
      setTransactions((prev) => prev.map((t) => t.id === txnId ? { ...t, ...data.transaction } : t));
      setBooks((prev) => prev.map((b) => b.id === data.transaction.bookId ? { ...b, availableCopies: b.availableCopies + 1 } : b));
      if (data.fine > 0) {
        toast.warning(`Book returned with ₹${data.fine} fine (${data.overdueDays} overdue days)`);
      } else {
        toast.success("Book returned successfully");
      }
      setReturnTxnId(null);
    } catch {
      toast.error("Failed to process return");
    } finally {
      setReturningId(null);
    }
  }

  const categories = Array.from(new Set(books.map((b) => b.category).filter(Boolean)));
  const filteredBooks = books.filter((b) => {
    const q = search.toLowerCase();
    const matchSearch = !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || (b.isbn ?? "").includes(q);
    const matchCat = filterCategory === "ALL" || b.category === filterCategory;
    return matchSearch && matchCat;
  });

  const activeTransactions = transactions.filter((t) => t.status === "ISSUED" || t.status === "OVERDUE");

  if (loading || !dataLoaded) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-teal-400" />
          <h1 className="text-xl font-semibold text-white">Library</h1>
          <span className="text-xs bg-teal-900/40 text-teal-300 px-2 py-0.5 rounded-full">{books.filter((b) => b.availableCopies > 0).length} available</span>
          {activeTransactions.some((t) => t.status === "OVERDUE") && (
            <span className="text-xs bg-red-900/40 text-red-300 px-2 py-0.5 rounded-full flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {activeTransactions.filter((t) => t.status === "OVERDUE").length} overdue
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {canWrite && activeTab === "catalog" && (
            <button onClick={() => { setBookForm({ collegeId: colleges[0]?.id ?? "", title: "", author: "", isbn: "", publisher: "", edition: "", category: "", totalCopies: 1, shelfLocation: "" }); setShowBookForm(true); }} className="flex items-center gap-2 px-3 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition-colors">
              <Plus className="w-4 h-4" /> Add Book
            </button>
          )}
          {canWrite && activeTab === "transactions" && (
            <button onClick={() => { setIssueForm({ bookId: "", studentId: "", collegeId: colleges[0]?.id ?? "", dueDate: "" }); setShowIssueForm(true); }} className="flex items-center gap-2 px-3 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition-colors">
              <BookMarked className="w-4 h-4" /> Issue Book
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-800/60 rounded-lg w-fit">
        {(["catalog", "transactions"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm rounded-md transition-colors capitalize ${activeTab === tab ? "bg-slate-700 text-white font-medium" : "text-slate-400 hover:text-white"}`}>
            {tab === "catalog" ? "Book Catalog" : "Transactions"}
          </button>
        ))}
      </div>

      {/* Catalog */}
      {activeTab === "catalog" && (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, author, ISBN…" className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500" />
            </div>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="bg-slate-800 text-slate-200 text-sm border border-slate-700 rounded-lg px-3 py-2">
              <option value="ALL">All Categories</option>
              {categories.map((c) => <option key={c} value={c!}>{c}</option>)}
            </select>
          </div>
          <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3">Book</th>
                  <th className="px-4 py-3">Author</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">ISBN</th>
                  <th className="px-4 py-3">Copies</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredBooks.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-10 text-slate-400">No books found.</td></tr>
                ) : filteredBooks.map((book) => (
                  <tr key={book.id} className="hover:bg-slate-700/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{book.title}</div>
                      {book.shelfLocation && <div className="text-xs text-slate-500">Shelf: {book.shelfLocation}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{book.author}</td>
                    <td className="px-4 py-3 text-slate-400">{book.category ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{book.isbn ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-medium ${book.availableCopies === 0 ? "text-red-400" : book.availableCopies <= 2 ? "text-amber-400" : "text-emerald-400"}`}>
                        {book.availableCopies}
                      </span>
                      <span className="text-slate-500 text-xs"> / {book.totalCopies}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Transactions */}
      {activeTab === "transactions" && (
        <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Book</th>
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Fine</th>
                {canWrite && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {transactions.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">No transactions yet.</td></tr>
              ) : transactions.map((t) => (
                <tr key={t.id} className="hover:bg-slate-700/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{t.student.candidateName}</div>
                    <div className="text-xs text-slate-400">#{t.student.admissionNumber}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white">{t.book.title}</div>
                    <div className="text-xs text-slate-400">{t.book.author}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{new Date(t.issueDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-slate-400">{new Date(t.dueDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[t.status]}`}>{t.status}</span></td>
                  <td className="px-4 py-3">{t.fine > 0 ? <span className="text-red-400">₹{t.fine}</span> : <span className="text-slate-500">—</span>}</td>
                  {canWrite && (
                    <td className="px-4 py-3">
                      {(t.status === "ISSUED" || t.status === "OVERDUE") && (
                        <button onClick={() => setReturnTxnId(t.id)} className="flex items-center gap-1 text-xs px-2.5 py-1 bg-teal-700/40 hover:bg-teal-600/60 text-teal-300 rounded transition-colors">
                          <RotateCcw className="w-3 h-3" /> Return
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Return Confirm */}
      {returnTxnId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Confirm Return</h2>
            <p className="text-sm text-slate-400">Return &ldquo;{transactions.find((t) => t.id === returnTxnId)?.book.title}&rdquo; from {transactions.find((t) => t.id === returnTxnId)?.student.candidateName}? Late fines will be calculated automatically.</p>
            <div className="flex gap-3">
              <button onClick={() => setReturnTxnId(null)} className="flex-1 px-4 py-2 bg-slate-700 text-white text-sm rounded-lg">Cancel</button>
              <button onClick={() => void returnBook(returnTxnId)} disabled={returningId === returnTxnId} className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {returningId === returnTxnId ? "Processing…" : "Confirm Return"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Book Modal */}
      {showBookForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">Add Book to Catalog</h2>
              <button onClick={() => setShowBookForm(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={(e) => void saveBook(e)} className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">College</label>
                <select value={bookForm.collegeId} onChange={(e) => setBookForm((f) => ({ ...f, collegeId: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Title</label>
                  <input value={bookForm.title} onChange={(e) => setBookForm((f) => ({ ...f, title: e.target.value }))} required placeholder="Book title" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Author</label>
                  <input value={bookForm.author} onChange={(e) => setBookForm((f) => ({ ...f, author: e.target.value }))} required placeholder="Author name" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">ISBN</label>
                  <input value={bookForm.isbn} onChange={(e) => setBookForm((f) => ({ ...f, isbn: e.target.value }))} placeholder="978-…" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Category</label>
                  <input value={bookForm.category} onChange={(e) => setBookForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Science" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Publisher</label>
                  <input value={bookForm.publisher} onChange={(e) => setBookForm((f) => ({ ...f, publisher: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Copies</label>
                  <input type="number" min={1} value={bookForm.totalCopies} onChange={(e) => setBookForm((f) => ({ ...f, totalCopies: Number(e.target.value) }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Shelf Location</label>
                  <input value={bookForm.shelfLocation} onChange={(e) => setBookForm((f) => ({ ...f, shelfLocation: e.target.value }))} placeholder="e.g. A-12-3" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowBookForm(false)} className="flex-1 px-4 py-2 bg-slate-700 text-white text-sm rounded-lg">Cancel</button>
                <button type="submit" disabled={savingBook} className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {savingBook ? "Adding…" : "Add Book"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issue Book Modal */}
      {showIssueForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">Issue Book</h2>
              <button onClick={() => setShowIssueForm(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={(e) => void saveIssue(e)} className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Student</label>
                <select value={issueForm.studentId} onChange={(e) => setIssueForm((f) => ({ ...f, studentId: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select student…</option>
                  {students.map((s) => <option key={s.id} value={s.id}>#{s.admissionNumber} — {s.candidateName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Book</label>
                <select value={issueForm.bookId} onChange={(e) => { const book = books.find((b) => b.id === e.target.value); setIssueForm((f) => ({ ...f, bookId: e.target.value, collegeId: book?.collegeId ?? f.collegeId })); }} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select book…</option>
                  {books.filter((b) => b.availableCopies > 0).map((b) => <option key={b.id} value={b.id}>{b.title} by {b.author} ({b.availableCopies} avail.)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Due Date</label>
                <input type="date" value={issueForm.dueDate} onChange={(e) => setIssueForm((f) => ({ ...f, dueDate: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowIssueForm(false)} className="flex-1 px-4 py-2 bg-slate-700 text-white text-sm rounded-lg">Cancel</button>
                <button type="submit" disabled={savingIssue} className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {savingIssue ? "Issuing…" : "Issue Book"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
