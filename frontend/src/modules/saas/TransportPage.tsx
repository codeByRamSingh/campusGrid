import { useEffect, useState } from "react";
import { Bus, Plus, MapPin, Users, Pencil, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../services/api";
import { hasPermission } from "../../lib/permissions";
import { useAuth } from "../../contexts/AuthContext";
import { useAcademicStructure } from "../../hooks/useAcademicStructure";
import { useStudents } from "../../hooks/useStudents";

type College = { id: string; name: string };
type Student = { id: string; candidateName: string; admissionNumber: number };

export type TransportRoute = {
  id: string;
  collegeId: string;
  routeCode: string;
  routeName: string;
  stops: string[];
  vehicleNumber: string;
  driverName: string;
  driverPhone: string;
  conductorName?: string;
  departureTime: string;
  returnTime?: string;
  feePerTerm: number;
  isActive: boolean;
  _count: { allocations: number };
};

export type TransportAllocation = {
  id: string;
  routeId: string;
  studentId: string;
  collegeId: string;
  pickupStop: string;
  fromDate: string;
  toDate?: string;
  status: "ACTIVE" | "INACTIVE";
  route: { id: string; routeCode: string; routeName: string };
  student: { id: string; candidateName: string; admissionNumber: number };
};


const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-900/40 text-emerald-300",
  INACTIVE: "bg-slate-700/60 text-slate-400",
};

export default function TransportPage() {
  const { permissions } = useAuth();
  const { data: academicStructure = [], isFetching: loading } = useAcademicStructure();
  const colleges: College[] = academicStructure.map((c) => ({ id: c.id, name: c.name }));
  const { data: studentsPayload } = useStudents();
  const students: Student[] = (Array.isArray(studentsPayload) ? studentsPayload : (studentsPayload?.data ?? [])).map((s) => ({ id: s.id, candidateName: s.candidateName, admissionNumber: s.admissionNumber }));
  const canWrite = hasPermission(permissions, "TRANSPORT_WRITE");

  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [allocations, setAllocations] = useState<TransportAllocation[]>([]);
  const [activeTab, setActiveTab] = useState<"routes" | "allocations">("routes");
  const [dataLoaded, setDataLoaded] = useState(false);

  const [showRouteForm, setShowRouteForm] = useState(false);
  const [editRoute, setEditRoute] = useState<TransportRoute | null>(null);
  const [routeForm, setRouteForm] = useState({
    collegeId: "",
    routeCode: "",
    routeName: "",
    stopsInput: "", // comma-separated
    vehicleNumber: "",
    driverName: "",
    driverPhone: "",
    conductorName: "",
    departureTime: "",
    returnTime: "",
    feePerTerm: 0,
  });
  const [savingRoute, setSavingRoute] = useState(false);

  const [showAllocForm, setShowAllocForm] = useState(false);
  const [allocForm, setAllocForm] = useState({ routeId: "", studentId: "", collegeId: "", pickupStop: "", fromDate: "" });
  const [savingAlloc, setSavingAlloc] = useState(false);

  useEffect(() => { void loadData(); }, []);

  async function loadData() {
    try {
      const [routesRes, allocRes] = await Promise.all([
        api.get<TransportRoute[]>("/transport/routes"),
        api.get<TransportAllocation[]>("/transport/allocations"),
      ]);
      setRoutes(routesRes.data);
      setAllocations(allocRes.data);
      setDataLoaded(true);
    } catch {
      toast.error("Failed to load transport data");
    }
  }

  function openCreateRoute() {
    setEditRoute(null);
    setRouteForm({ collegeId: colleges[0]?.id ?? "", routeCode: "", routeName: "", stopsInput: "", vehicleNumber: "", driverName: "", driverPhone: "", conductorName: "", departureTime: "", returnTime: "", feePerTerm: 0 });
    setShowRouteForm(true);
  }

  function openEditRoute(r: TransportRoute) {
    setEditRoute(r);
    setRouteForm({ collegeId: r.collegeId, routeCode: r.routeCode, routeName: r.routeName, stopsInput: r.stops.join(", "), vehicleNumber: r.vehicleNumber, driverName: r.driverName, driverPhone: r.driverPhone, conductorName: r.conductorName ?? "", departureTime: r.departureTime, returnTime: r.returnTime ?? "", feePerTerm: r.feePerTerm });
    setShowRouteForm(true);
  }

  async function saveRoute(e: React.FormEvent) {
    e.preventDefault();
    setSavingRoute(true);
    const payload = { ...routeForm, stops: routeForm.stopsInput.split(",").map((s) => s.trim()).filter(Boolean) };
    try {
      if (editRoute) {
        const { data } = await api.patch<TransportRoute>(`/transport/routes/${editRoute.id}`, payload);
        setRoutes((prev) => prev.map((r) => r.id === data.id ? { ...r, ...data } : r));
        toast.success("Route updated");
      } else {
        const { data } = await api.post<TransportRoute>("/transport/routes", payload);
        setRoutes((prev) => [{ ...data, _count: { allocations: 0 } }, ...prev]);
        toast.success("Route created");
      }
      setShowRouteForm(false);
    } catch {
      toast.error("Failed to save route");
    } finally {
      setSavingRoute(false);
    }
  }

  async function saveAlloc(e: React.FormEvent) {
    e.preventDefault();
    setSavingAlloc(true);
    try {
      const { data } = await api.post<TransportAllocation>("/transport/allocations", { ...allocForm, fromDate: new Date(allocForm.fromDate).toISOString() });
      const route = routes.find((r) => r.id === data.routeId);
      const student = students.find((s) => s.id === data.studentId);
      setAllocations((prev) => [{
        ...data,
        route: { id: data.routeId, routeCode: route?.routeCode ?? "", routeName: route?.routeName ?? "" },
        student: { id: data.studentId, candidateName: student?.candidateName ?? "", admissionNumber: student?.admissionNumber ?? 0 },
      }, ...prev]);
      toast.success("Transport allocated");
      setShowAllocForm(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Failed to allocate transport";
      toast.error(msg);
    } finally {
      setSavingAlloc(false);
    }
  }

  async function deactivateAlloc(id: string) {
    if (!confirm("Deactivate this transport allocation?")) return;
    try {
      await api.patch(`/transport/allocations/${id}`, { status: "INACTIVE", toDate: new Date().toISOString() });
      setAllocations((prev) => prev.map((a) => a.id === id ? { ...a, status: "INACTIVE" } : a));
      toast.success("Allocation deactivated");
    } catch {
      toast.error("Failed to update allocation");
    }
  }

  const activeAllocations = allocations.filter((a) => a.status === "ACTIVE");
  const selectedRoute = routes.find((r) => r.id === allocForm.routeId);

  if (loading || !dataLoaded) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Bus className="w-5 h-5 text-cyan-400" />
          <h1 className="text-xl font-semibold text-white">Transport</h1>
          <span className="text-xs bg-cyan-900/40 text-cyan-300 px-2 py-0.5 rounded-full">{activeAllocations.length} Active Passengers</span>
        </div>
        <div className="flex gap-2">
          {canWrite && activeTab === "routes" && (
            <button onClick={openCreateRoute} className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors">
              <Plus className="w-4 h-4" /> Add Route
            </button>
          )}
          {canWrite && activeTab === "allocations" && (
            <button onClick={() => { setAllocForm({ routeId: "", studentId: "", collegeId: colleges[0]?.id ?? "", pickupStop: "", fromDate: new Date().toISOString().split("T")[0] }); setShowAllocForm(true); }} className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors">
              <UserCheck className="w-4 h-4" /> Assign Route
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-800/60 rounded-lg w-fit">
        {(["routes", "allocations"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm rounded-md transition-colors capitalize ${activeTab === tab ? "bg-slate-700 text-white font-medium" : "text-slate-400 hover:text-white"}`}>
            {tab === "routes" ? "Routes" : "Allocations"}
          </button>
        ))}
      </div>

      {/* Routes */}
      {activeTab === "routes" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {routes.length === 0 ? (
            <div className="col-span-2 text-center py-12 text-slate-400 bg-slate-800/40 rounded-xl border border-slate-700">
              <Bus className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No routes configured yet.</p>
            </div>
          ) : routes.map((r) => (
            <div key={r.id} className="bg-slate-800/60 rounded-xl border border-slate-700 p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-cyan-900/40 text-cyan-300 px-2 py-0.5 rounded">{r.routeCode}</span>
                    <span className="font-medium text-white">{r.routeName}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
                    <Users className="w-3.5 h-3.5" /> {r._count.allocations} passengers · {r.departureTime}
                    {r.returnTime && ` → ${r.returnTime}`}
                  </div>
                </div>
                {canWrite && (
                  <button onClick={() => openEditRoute(r)} className="p-1.5 rounded hover:bg-slate-600 text-slate-400 hover:text-white transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-sm">
                <div className="text-slate-400 text-xs mb-1">Vehicle: <span className="text-slate-300 font-mono">{r.vehicleNumber}</span></div>
                <div className="text-slate-400 text-xs">Driver: <span className="text-slate-300">{r.driverName}</span> · {r.driverPhone}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {r.stops.map((stop, i) => (
                  <span key={i} className="flex items-center gap-0.5 text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                    <MapPin className="w-2.5 h-2.5 text-slate-500" /> {stop}
                  </span>
                ))}
              </div>
              <div className="text-xs text-slate-400">Fee/term: <span className="text-cyan-400 font-medium">₹{r.feePerTerm.toLocaleString()}</span></div>
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
              <p>No transport allocations yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Route</th>
                  <th className="px-4 py-3">Pickup Stop</th>
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
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-cyan-400">{a.route.routeCode}</span>
                      <div className="text-xs text-slate-400">{a.route.routeName}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{a.pickupStop}</td>
                    <td className="px-4 py-3 text-slate-400">{new Date(a.fromDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[a.status]}`}>{a.status}</span></td>
                    {canWrite && (
                      <td className="px-4 py-3">
                        {a.status === "ACTIVE" && (
                          <button onClick={() => void deactivateAlloc(a.id)} className="text-xs px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors">Deactivate</button>
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

      {/* Route Form Modal */}
      {showRouteForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">{editRoute ? "Edit Route" : "Create Route"}</h2>
              <button onClick={() => setShowRouteForm(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={(e) => void saveRoute(e)} className="p-5 space-y-4">
              {!editRoute && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">College</label>
                  <select value={routeForm.collegeId} onChange={(e) => setRouteForm((f) => ({ ...f, collegeId: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                    {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Route Code</label>
                  <input value={routeForm.routeCode} onChange={(e) => setRouteForm((f) => ({ ...f, routeCode: e.target.value }))} required placeholder="RT-01" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Route Name</label>
                  <input value={routeForm.routeName} onChange={(e) => setRouteForm((f) => ({ ...f, routeName: e.target.value }))} required placeholder="North Campus Route" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Stops (comma-separated)</label>
                <input value={routeForm.stopsInput} onChange={(e) => setRouteForm((f) => ({ ...f, stopsInput: e.target.value }))} placeholder="City Center, Park Gate, College Main Gate" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Vehicle Number</label>
                  <input value={routeForm.vehicleNumber} onChange={(e) => setRouteForm((f) => ({ ...f, vehicleNumber: e.target.value }))} required placeholder="MH-12 AB 1234" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Driver Name</label>
                  <input value={routeForm.driverName} onChange={(e) => setRouteForm((f) => ({ ...f, driverName: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Driver Phone</label>
                  <input value={routeForm.driverPhone} onChange={(e) => setRouteForm((f) => ({ ...f, driverPhone: e.target.value }))} required placeholder="9876543210" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Conductor Name</label>
                  <input value={routeForm.conductorName} onChange={(e) => setRouteForm((f) => ({ ...f, conductorName: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Departure Time</label>
                  <input type="time" value={routeForm.departureTime} onChange={(e) => setRouteForm((f) => ({ ...f, departureTime: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Return Time</label>
                  <input type="time" value={routeForm.returnTime} onChange={(e) => setRouteForm((f) => ({ ...f, returnTime: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Fee Per Term (₹)</label>
                  <input type="number" min={0} value={routeForm.feePerTerm} onChange={(e) => setRouteForm((f) => ({ ...f, feePerTerm: Number(e.target.value) }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowRouteForm(false)} className="flex-1 px-4 py-2 bg-slate-700 text-white text-sm rounded-lg">Cancel</button>
                <button type="submit" disabled={savingRoute} className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {savingRoute ? "Saving…" : editRoute ? "Update Route" : "Create Route"}
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
              <h2 className="text-lg font-semibold text-white">Assign Transport Route</h2>
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
                <label className="block text-xs text-slate-400 mb-1">Route</label>
                <select value={allocForm.routeId} onChange={(e) => { const r = routes.find((rt) => rt.id === e.target.value); setAllocForm((f) => ({ ...f, routeId: e.target.value, collegeId: r?.collegeId ?? f.collegeId, pickupStop: "" })); }} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select route…</option>
                  {routes.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.routeCode} — {r.routeName}</option>)}
                </select>
              </div>
              {allocForm.routeId && selectedRoute && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Pickup Stop</label>
                  <select value={allocForm.pickupStop} onChange={(e) => setAllocForm((f) => ({ ...f, pickupStop: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="">Select stop…</option>
                    {selectedRoute.stops.map((stop, i) => <option key={i} value={stop}>{stop}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1">From Date</label>
                <input type="date" value={allocForm.fromDate} onChange={(e) => setAllocForm((f) => ({ ...f, fromDate: e.target.value }))} required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAllocForm(false)} className="flex-1 px-4 py-2 bg-slate-700 text-white text-sm rounded-lg">Cancel</button>
                <button type="submit" disabled={savingAlloc} className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {savingAlloc ? "Assigning…" : "Assign Route"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
