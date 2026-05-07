import { useEffect, useState } from "react";
import { Building2, Plus, Users, Bed, Pencil, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../services/api";
import { hasPermission } from "../../lib/permissions";
import { useAuth } from "../../contexts/AuthContext";
import { useAcademicStructure } from "../../hooks/useAcademicStructure";
import { useStudents } from "../../hooks/useStudents";

type College = { id: string; name: string };

export type HostelBlock = {
  id: string;
  collegeId: string;
  name: string;
  gender: string;
  floors: number;
  isActive: boolean;
  rooms: Array<{
    id: string;
    roomNumber: string;
    floor: number;
    roomType: "SINGLE" | "DOUBLE" | "TRIPLE" | "DORMITORY";
    capacity: number;
    feePerTerm: number;
    isActive: boolean;
    _count: { allocations: number };
  }>;
};

export type HostelAllocation = {
  id: string;
  roomId: string;
  studentId: string;
  collegeId: string;
  fromDate: string;
  toDate?: string;
  status: "ACTIVE" | "VACATED" | "RESERVED";
  notes?: string;
  room: { id: string; roomNumber: string; block: { name: string; gender: string } };
  student: { id: string; candidateName: string; admissionNumber: number };
};

type Student = { id: string; candidateName: string; admissionNumber: number };


const ROOM_TYPE_LABELS = { SINGLE: "Single", DOUBLE: "Double", TRIPLE: "Triple", DORMITORY: "Dormitory" };
const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-900/40 text-emerald-300",
  VACATED: "bg-slate-700/60 text-slate-400",
  RESERVED: "bg-amber-900/40 text-amber-300",
};

export default function HostelPage() {
  const { permissions } = useAuth();
  const { data: academicStructure = [], isFetching: loading } = useAcademicStructure();
  const colleges: College[] = academicStructure.map((c) => ({ id: c.id, name: c.name }));
  const { data: studentsPayload } = useStudents();
  const students: Student[] = (Array.isArray(studentsPayload) ? studentsPayload : (studentsPayload?.data ?? [])).map((s) => ({ id: s.id, candidateName: s.candidateName, admissionNumber: s.admissionNumber }));
  const canWrite = hasPermission(permissions, "HOSTEL_WRITE");

  const [blocks, setBlocks] = useState<HostelBlock[]>([]);
  const [allocations, setAllocations] = useState<HostelAllocation[]>([]);
  const [activeTab, setActiveTab] = useState<"blocks" | "allocations">("blocks");
  const [dataLoaded, setDataLoaded] = useState(false);

  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockForm, setBlockForm] = useState({ collegeId: "", name: "", gender: "ANY", floors: 1 });
  const [savingBlock, setSavingBlock] = useState(false);

  const [showRoomForm, setShowRoomForm] = useState<string | null>(null); // blockId
  const [roomForm, setRoomForm] = useState({ roomNumber: "", floor: 1, roomType: "SINGLE", capacity: 1, feePerTerm: 0 });
  const [savingRoom, setSavingRoom] = useState(false);

  const [showAllocForm, setShowAllocForm] = useState(false);
  const [allocForm, setAllocForm] = useState({ roomId: "", studentId: "", collegeId: "", fromDate: "", notes: "" });
  const [savingAlloc, setSavingAlloc] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      const [blocksRes, allocRes] = await Promise.all([
        api.get<HostelBlock[]>("/hostel/blocks"),
        api.get<HostelAllocation[]>("/hostel/allocations"),
      ]);
      setBlocks(blocksRes.data);
      setAllocations(allocRes.data);
      setDataLoaded(true);
    } catch {
      toast.error("Failed to load hostel data");
    }
  }

  async function saveBlock(e: React.FormEvent) {
    e.preventDefault();
    setSavingBlock(true);
    try {
      const { data } = await api.post<HostelBlock>("/hostel/blocks", blockForm);
      setBlocks((prev) => [...prev, { ...data, rooms: [] }]);
      toast.success("Block created");
      setShowBlockForm(false);
    } catch {
      toast.error("Failed to create block");
    } finally {
      setSavingBlock(false);
    }
  }

  async function saveRoom(e: React.FormEvent, blockId: string) {
    e.preventDefault();
    setSavingRoom(true);
    try {
      const block = blocks.find((b) => b.id === blockId);
      const { data } = await api.post("/hostel/rooms", { ...roomForm, blockId, collegeId: block?.collegeId });
      setBlocks((prev) => prev.map((b) => b.id === blockId ? { ...b, rooms: [...b.rooms, { ...data, _count: { allocations: 0 } }] } : b));
      toast.success("Room added");
      setShowRoomForm(null);
    } catch {
      toast.error("Failed to add room");
    } finally {
      setSavingRoom(false);
    }
  }

  async function saveAlloc(e: React.FormEvent) {
    e.preventDefault();
    setSavingAlloc(true);
    try {
      const { data } = await api.post<HostelAllocation>("/hostel/allocations", { ...allocForm, fromDate: new Date(allocForm.fromDate).toISOString() });
      const room = blocks.flatMap((b) => b.rooms).find((r) => r.id === data.roomId);
      const student = students.find((s) => s.id === data.studentId);
      setAllocations((prev) => [{
        ...data,
        room: { id: data.roomId, roomNumber: room?.roomNumber ?? "", block: { name: blocks.find((b) => b.rooms.some((r) => r.id === data.roomId))?.name ?? "", gender: "" } },
        student: { id: data.studentId, candidateName: student?.candidateName ?? "", admissionNumber: student?.admissionNumber ?? 0 },
      }, ...prev]);
      toast.success("Hostel allocated");
      setShowAllocForm(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Failed to allocate hostel";
      toast.error(msg);
    } finally {
      setSavingAlloc(false);
    }
  }

  async function vacate(id: string) {
    if (!confirm("Mark this allocation as vacated?")) return;
    try {
      await api.patch(`/hostel/allocations/${id}`, { status: "VACATED", toDate: new Date().toISOString() });
      setAllocations((prev) => prev.map((a) => a.id === id ? { ...a, status: "VACATED" } : a));
      toast.success("Allocation vacated");
    } catch {
      toast.error("Failed to update allocation");
    }
  }

  if (loading || !dataLoaded) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading…</div>;
  }

  const allRooms = blocks.flatMap((b) => b.rooms.map((r) => ({ ...r, blockName: b.name, collegeId: b.collegeId })));
  const activeAllocations = allocations.filter((a) => a.status === "ACTIVE");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-orange-400" />
          <h1 className="text-xl font-semibold text-white">Hostel Management</h1>
          <span className="text-xs bg-orange-900/40 text-orange-300 px-2 py-0.5 rounded-full">{activeAllocations.length} Active</span>
        </div>
        <div className="flex gap-2">
          {canWrite && activeTab === "blocks" && (
            <button onClick={() => { setBlockForm({ collegeId: colleges[0]?.id ?? "", name: "", gender: "ANY", floors: 1 }); setShowBlockForm(true); }} className="flex items-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg transition-colors">
              <Plus className="w-4 h-4" /> Add Block
            </button>
          )}
          {canWrite && activeTab === "allocations" && (
            <button onClick={() => { setAllocForm({ roomId: "", studentId: "", collegeId: colleges[0]?.id ?? "", fromDate: new Date().toISOString().split("T")[0], notes: "" }); setShowAllocForm(true); }} className="flex items-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg transition-colors">
              <UserCheck className="w-4 h-4" /> Allocate Room
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-800/60 rounded-lg w-fit">
        {(["blocks", "allocations"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm rounded-md transition-colors capitalize ${activeTab === tab ? "bg-slate-700 text-white font-medium" : "text-slate-400 hover:text-white"}`}>
            {tab === "blocks" ? "Blocks & Rooms" : "Allocations"}
          </button>
        ))}
      </div>

      {/* Blocks & Rooms */}
      {activeTab === "blocks" && (
        <div className="space-y-4">
          {blocks.length === 0 ? (
            <div className="text-center py-12 text-slate-400 bg-slate-800/40 rounded-xl border border-slate-700">
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No hostel blocks added yet.</p>
            </div>
          ) : blocks.map((block) => (
            <div key={block.id} className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-slate-900/40 border-b border-slate-700">
                <div className="flex items-center gap-3">
                  <Building2 className="w-4 h-4 text-orange-400" />
                  <span className="font-medium text-white">{block.name}</span>
                  <span className="text-xs text-slate-400">{block.gender} · {block.floors} floor{block.floors !== 1 ? "s" : ""}</span>
                </div>
                {canWrite && (
                  <button onClick={() => { setShowRoomForm(block.id); setRoomForm({ roomNumber: "", floor: 1, roomType: "SINGLE", capacity: 1, feePerTerm: 0 }); }} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Room
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
                {block.rooms.map((room) => {
                  const occupied = room._count.allocations;
                  const pct = room.capacity > 0 ? occupied / room.capacity : 0;
                  return (
                    <div key={room.id} className={`rounded-lg p-3 border ${pct >= 1 ? "border-red-700 bg-red-900/20" : pct > 0.7 ? "border-amber-700 bg-amber-900/20" : "border-slate-700 bg-slate-800/40"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm text-white">Room {room.roomNumber}</span>
                        <span className="text-xs text-slate-400">F{room.floor}</span>
                      </div>
                      <div className="text-xs text-slate-400">{ROOM_TYPE_LABELS[room.roomType]}</div>
                      <div className="flex items-center gap-1 mt-2">
                        <Bed className="w-3 h-3 text-slate-400" />
                        <span className={`text-xs ${pct >= 1 ? "text-red-400" : pct > 0.7 ? "text-amber-400" : "text-emerald-400"}`}>{occupied}/{room.capacity}</span>
                      </div>
                    </div>
                  );
                })}
                {block.rooms.length === 0 && <p className="col-span-4 text-sm text-slate-500 py-2">No rooms added. Use the button above to add rooms.</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Allocations */}
      {activeTab === "allocations" && (
        <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-hidden">
          {allocations.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No allocations yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Block / Room</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3">Status</th>
                  {canWrite && <th className="px-4 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {allocations.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-700/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{a.student.candidateName}</div>
                      <div className="text-xs text-slate-400">#{a.student.admissionNumber}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{a.room.block.name} / Room {a.room.roomNumber}</td>
                    <td className="px-4 py-3 text-slate-400">{new Date(a.fromDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[a.status]}`}>{a.status}</span></td>
                    {canWrite && (
                      <td className="px-4 py-3">
                        {a.status === "ACTIVE" && (
                          <button onClick={() => void vacate(a.id)} className="flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors">
                            <Pencil className="w-3 h-3" /> Vacate
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Block Form Modal */}
      {showBlockForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">Add Hostel Block</h2>
              <button onClick={() => setShowBlockForm(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={(e) => void saveBlock(e)} className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">College</label>
                <select value={blockForm.collegeId} onChange={(e) => setBlockForm((f) => ({ ...f, collegeId: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Block Name</label>
                <input value={blockForm.name} onChange={(e) => setBlockForm((f) => ({ ...f, name: e.target.value }))} required placeholder="e.g. Block A, Boys Hostel" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Gender</label>
                  <select value={blockForm.gender} onChange={(e) => setBlockForm((f) => ({ ...f, gender: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="ANY">Any</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Floors</label>
                  <input type="number" min={1} value={blockForm.floors} onChange={(e) => setBlockForm((f) => ({ ...f, floors: Number(e.target.value) }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowBlockForm(false)} className="flex-1 px-4 py-2 bg-slate-700 text-white text-sm rounded-lg">Cancel</button>
                <button type="submit" disabled={savingBlock} className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {savingBlock ? "Saving…" : "Add Block"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Room Form Modal */}
      {showRoomForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">Add Room to {blocks.find((b) => b.id === showRoomForm)?.name}</h2>
              <button onClick={() => setShowRoomForm(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={(e) => void saveRoom(e, showRoomForm)} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Room Number</label>
                  <input value={roomForm.roomNumber} onChange={(e) => setRoomForm((f) => ({ ...f, roomNumber: e.target.value }))} required placeholder="101" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Floor</label>
                  <input type="number" min={1} value={roomForm.floor} onChange={(e) => setRoomForm((f) => ({ ...f, floor: Number(e.target.value) }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Room Type</label>
                  <select value={roomForm.roomType} onChange={(e) => setRoomForm((f) => ({ ...f, roomType: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                    {Object.entries(ROOM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Capacity</label>
                  <input type="number" min={1} value={roomForm.capacity} onChange={(e) => setRoomForm((f) => ({ ...f, capacity: Number(e.target.value) }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Fee Per Term (₹)</label>
                  <input type="number" min={0} value={roomForm.feePerTerm} onChange={(e) => setRoomForm((f) => ({ ...f, feePerTerm: Number(e.target.value) }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowRoomForm(null)} className="flex-1 px-4 py-2 bg-slate-700 text-white text-sm rounded-lg">Cancel</button>
                <button type="submit" disabled={savingRoom} className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {savingRoom ? "Saving…" : "Add Room"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Allocation Form Modal */}
      {showAllocForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">Allocate Room</h2>
              <button onClick={() => setShowAllocForm(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={(e) => void saveAlloc(e)} className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Student</label>
                <select value={allocForm.studentId} onChange={(e) => setAllocForm((f) => ({ ...f, studentId: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select student…</option>
                  {students.map((s) => <option key={s.id} value={s.id}>#{s.admissionNumber} — {s.candidateName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Room</label>
                <select value={allocForm.roomId} onChange={(e) => { const room = allRooms.find((r) => r.id === e.target.value); setAllocForm((f) => ({ ...f, roomId: e.target.value, collegeId: room?.collegeId ?? f.collegeId })); }} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select room…</option>
                  {allRooms.filter((r) => r.isActive && r._count.allocations < r.capacity).map((r) => (
                    <option key={r.id} value={r.id}>{r.blockName} / Room {r.roomNumber} ({r._count.allocations}/{r.capacity})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">From Date</label>
                <input type="date" value={allocForm.fromDate} onChange={(e) => setAllocForm((f) => ({ ...f, fromDate: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAllocForm(false)} className="flex-1 px-4 py-2 bg-slate-700 text-white text-sm rounded-lg">Cancel</button>
                <button type="submit" disabled={savingAlloc} className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {savingAlloc ? "Allocating…" : "Allocate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
