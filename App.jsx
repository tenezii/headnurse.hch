import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Bed, Users, Activity, AlertTriangle, LayoutGrid, ArrowLeftRight, Users2,
  BellRing, FileBarChart2, Settings, Plus, X, ShieldAlert, UserCheck, UserX,
  CheckCircle2, LogOut, Stethoscope, Lock, KeyRound, Trash2, FileDown, Printer,
  DoorOpen, Loader2, Copy, Mail
} from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import * as api from "./lib/api";

/* ---------------------------------------------------------------
   Constants
--------------------------------------------------------------- */
const SEVERITY = {
  low: { label: "Low", color: "var(--success)" },
  moderate: { label: "Moderate", color: "var(--warning)" },
  high: { label: "High", color: "var(--danger)" },
};
const ISOLATION_TYPES = ["None", "Contact", "Droplet", "Airborne"];

function calcWorkload(nurse, beds) {
  const list = beds.filter((b) => b.status === "occupied" && b.patient?.nurseId === nurse.id);
  const patients = list.length;
  const high = list.filter((b) => b.patient.severity === "high").length;
  const iso = list.filter((b) => b.patient.isolation).length;
  const score = Math.min(100, Math.round((patients / (nurse.maxPatients || 1)) * 50 + high * 15 + iso * 10));
  return { patients, high, iso, score, list };
}
function timeNow() {
  return new Date().toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}
function roomsFromBeds(beds) {
  const map = {};
  beds.forEach((b) => { map[b.room] = (map[b.room] || []).concat(b); });
  return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}

/* ---------------------------------------------------------------
   Root — figures out: logged out / needs onboarding / ready
--------------------------------------------------------------- */
export default function App() {
  const [phase, setPhase] = useState("loading"); // loading | signedOut | onboarding | ready
  const [profile, setProfile] = useState(null);
  const [department, setDepartment] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); }, []);

  const loadProfile = useCallback(async () => {
    try {
      const p = await api.getMyProfile();
      if (!p) { setPhase("signedOut"); return; }
      setProfile(p);
      if (!p.department_id) { setPhase("onboarding"); return; }
      const dept = await api.getDepartment(p.department_id);
      setDepartment(dept);
      setPhase("ready");
    } catch (e) {
      setPhase("signedOut");
    }
  }, []);

  useEffect(() => {
    loadProfile();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { setProfile(null); setDepartment(null); setPhase("signedOut"); }
      if (event === "SIGNED_IN") loadProfile();
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  if (phase === "loading") {
    return <div className="app-root loading-screen"><style>{CSS}</style><Loader2 className="spin" size={26} /> <span>Loading…</span></div>;
  }
  if (phase === "signedOut") return <AuthScreen onReady={loadProfile} />;
  if (phase === "onboarding") return <OnboardingScreen onReady={loadProfile} flash={flash} />;
  return <Dashboard profile={profile} department={department} onProfileChange={loadProfile} flash={flash} toast={toast} />;
}

/* ---------------------------------------------------------------
   Auth screen — real email/password via Supabase Auth
--------------------------------------------------------------- */
function AuthScreen({ onReady }) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState(""); const [err, setErr] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signup") {
        if (!fullName.trim()) throw new Error("Please enter your full name.");
        if (password.length < 6) throw new Error("Password must be at least 6 characters.");
        await api.signUp(email.trim(), password, fullName.trim());
        setNotice("Account created. If email confirmation is enabled on your Supabase project, check your inbox before signing in.");
        setMode("signin");
      } else {
        await api.signIn(email.trim(), password);
        onReady();
      }
    } catch (e) {
      setErr(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-root login-root">
      <style>{CSS}</style>
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark"><Stethoscope size={22} /></div>
          <div><div className="brand-title">Nurse &amp; Bed Management</div><div className="brand-sub">Head Nurse Dashboard</div></div>
        </div>

        <div className="role-switch">
          <button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Sign in</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create account</button>
        </div>

        <div className="login-form">
          {mode === "signup" && (
            <label className="field"><span>Full name</span><input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus /></label>
          )}
          <label className="field"><span>Email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span>Password</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {err && <div className="login-err">{err}</div>}
          {notice && <div className="login-notice"><Mail size={13} /> {notice}</div>}
          <button type="button" className="btn primary" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="spin" size={14} /> : mode === "signup" ? <Plus size={14} /> : <Lock size={14} />}
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </div>

        <p className="security-note"><ShieldAlert size={13} /> Real authentication via Supabase. After your first sign-in you'll create a new department or join one with a code from your Head Nurse.</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Onboarding — create a department (becomes head nurse) or join
   one with a code (stays a nurse until assigned duties).
--------------------------------------------------------------- */
function OnboardingScreen({ onReady, flash }) {
  const [mode, setMode] = useState("choose");
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return setErr("Enter a department name.");
    setBusy(true); setErr("");
    try { await api.createDepartment(name.trim()); flash("Department created"); onReady(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const join = async () => {
    if (!code.trim()) return setErr("Enter your department's join code.");
    setBusy(true); setErr("");
    try { await api.joinDepartment(code.trim()); flash("Joined department"); onReady(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="app-root login-root">
      <style>{CSS}</style>
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark"><Stethoscope size={22} /></div>
          <div><div className="brand-title">One more step</div><div className="brand-sub">Set up or join a department</div></div>
        </div>
        {mode === "choose" && (
          <div className="login-choices">
            <button className="login-choice" onClick={() => setMode("create")}>
              <ShieldAlert size={18} /><div><div>I'm the Head Nurse</div><small>Set up a new department</small></div>
            </button>
            <button className="login-choice" onClick={() => setMode("join")}>
              <Users size={18} /><div><div>I'm a Nurse</div><small>Join with a code from my Head Nurse</small></div>
            </button>
          </div>
        )}
        {mode === "create" && (
          <div className="login-form">
            <label className="field"><span>Department name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. General Medicine Ward" /></label>
            {err && <div className="login-err">{err}</div>}
            <div className="modal-actions"><button className="btn" onClick={() => setMode("choose")}>Back</button><button className="btn primary" disabled={busy} onClick={create}>Create department</button></div>
          </div>
        )}
        {mode === "join" && (
          <div className="login-form">
            <label className="field"><span>Join code</span><input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="e.g. a1b2c3" /></label>
            {err && <div className="login-err">{err}</div>}
            <div className="modal-actions"><button className="btn" onClick={() => setMode("choose")}>Back</button><button className="btn primary" disabled={busy} onClick={join}>Join</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Main authenticated dashboard
--------------------------------------------------------------- */
const TAB_TITLES = {
  dashboard: "Dashboard", beds: "Bed Map", workload: "Workload",
  assign: "Patient Assignment", staff: "Staff & Rooms", alerts: "Alerts",
  reports: "Reports", settings: "Settings",
};

function Dashboard({ profile, department, onProfileChange, flash, toast }) {
  const [tab, setTab] = useState("dashboard");
  const [beds, setBeds] = useState([]);
  const [nurses, setNurses] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalBed, setModalBed] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const role = profile.role === "head_nurse" ? "head" : "nurse";
  const currentNurse = nurses.find((n) => n.id === profile.id);

  const refresh = useCallback(async () => {
    try {
      const { beds, nurses } = await api.fetchAll(department.id);
      setBeds(beds); setNurses(nurses);
    } catch (e) {
      flash("Could not load department data");
    } finally {
      setLoadingData(false);
    }
  }, [department.id, flash]);

  useEffect(() => {
    refresh();
    const unsubscribe = api.subscribeToDepartment(department.id, () => refresh());
    return unsubscribe;
  }, [refresh, department.id]);

  const totalBeds = beds.length;
  const occupied = beds.filter((b) => b.status === "occupied").length;
  const reserved = beds.filter((b) => b.status === "reserved").length;
  const empty = beds.filter((b) => b.status === "empty").length;
  const occupancyPct = totalBeds ? Math.round((occupied / totalBeds) * 100) : 0;
  const nursesOnDuty = nurses.filter((n) => n.status === "on").length;

  const workloads = useMemo(() => {
    const m = {}; nurses.forEach((n) => (m[n.id] = calcWorkload(n, beds))); return m;
  }, [nurses, beds]);
  const unassigned = beds.filter((b) => b.status === "occupied" && !b.patient?.nurseId);

  const alerts = useMemo(() => {
    const list = [];
    nurses.forEach((n) => {
      const w = workloads[n.id];
      if (n.status === "on" && w.patients > n.maxPatients) list.push({ level: "high", text: `${n.name} exceeds their max patient load (${w.patients}/${n.maxPatients})` });
    });
    const onDutyScores = nurses.filter((n) => n.status === "on").map((n) => workloads[n.id].score);
    if (onDutyScores.length > 1) {
      const diff = Math.max(...onDutyScores) - Math.min(...onDutyScores);
      if (diff > 35) list.push({ level: "moderate", text: "Noticeable workload imbalance between on-duty nurses" });
    }
    roomsFromBeds(beds).forEach(([room, roomBeds]) => { if (roomBeds.every((b) => b.status === "occupied")) list.push({ level: "low", text: `Room ${room} is fully occupied` }); });
    if (empty > 0) list.push({ level: "low", text: `${empty} bed${empty > 1 ? "s" : ""} available for admission` });
    if (unassigned.length > 0) list.push({ level: "high", text: `${unassigned.length} patient${unassigned.length > 1 ? "s are" : " is"} not assigned to any nurse` });
    return list;
  }, [nurses, workloads, beds, empty, unassigned.length]);

  /* ---- actions — every one calls Supabase; realtime refresh does the rest ---- */
  const guard = (fn) => async (...args) => {
    try { await fn(...args); } catch (e) { flash(e.message || "Action failed"); }
  };
  const assignBedToNurse = guard(async (bedId, nurseId) => { await api.reassignBed(bedId, nurseId); flash("Patient reassigned"); });
  const openAssignModal = (bed) => role === "head" && bed.status !== "occupied" && setModalBed(bed);
  const submitNewPatient = guard(async (payload) => {
    await api.admitPatient(modalBed.id, payload); setModalBed(null); flash("Patient admitted and assigned");
  });
  const discharge = guard(async (bedId) => { await api.dischargePatient(bedId); flash("Patient discharged"); });
  const updatePatientField = guard(async (bedId, field, value) => {
    const bed = beds.find((b) => b.id === bedId);
    if (bed?.patient) await api.updatePatientField(bed.patient.id, field, value);
  });
  const toggleNurseStatus = guard(async (id) => {
    const n = nurses.find((x) => x.id === id); await api.toggleNurseStatus(id, n.status);
  });
  const updateMax = guard(async (id, val) => { await api.updateMaxPatients(id, Math.max(1, val)); });
  const removeNurse = guard(async (id) => { await api.removeNurseFromDepartment(id); });
  const addRoom = guard(async (name, cap) => { await api.addRoom(department.id, name, cap); });
  const removeRoom = guard(async (name) => {
    const roomBeds = beds.filter((b) => b.room === name);
    if (roomBeds.some((b) => b.status !== "empty")) return flash("Cannot remove: room has occupied/reserved beds");
    const { data } = await supabase.from("rooms").select("id").eq("department_id", department.id).eq("name", name).single();
    await api.removeRoom(data.id);
  });
  const setBedStatus = guard(async (bedId, status) => { await api.setBedStatus(bedId, status); });

  return (
    <div className="app-root">
      <style>{CSS}</style>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Stethoscope size={20} /></div>
          <div><div className="brand-title">{department.name}</div><div className="brand-sub">{role === "head" ? "Head Nurse" : profile.full_name}</div></div>
        </div>
        <nav className="nav">
          <NavItem icon={<LayoutGrid size={17} />} label="Dashboard" active={tab === "dashboard"} onClick={() => setTab("dashboard")} />
          <NavItem icon={<Bed size={17} />} label="Bed Map" active={tab === "beds"} onClick={() => setTab("beds")} />
          <NavItem icon={<Activity size={17} />} label="Workload" active={tab === "workload"} onClick={() => setTab("workload")} />
          <NavItem icon={<ArrowLeftRight size={17} />} label="Assignment" active={tab === "assign"} onClick={() => setTab("assign")} />
          <NavItem icon={<Users2 size={17} />} label="Staff & Rooms" active={tab === "staff"} onClick={() => setTab("staff")} disabled={role !== "head"} />
          <NavItem icon={<BellRing size={17} />} label="Alerts" active={tab === "alerts"} onClick={() => setTab("alerts")} badge={alerts.length} />
          <NavItem icon={<FileBarChart2 size={17} />} label="Reports" active={tab === "reports"} onClick={() => setTab("reports")} disabled={role !== "head"} />
          <NavItem icon={<Settings size={17} />} label="Settings" active={tab === "settings"} onClick={() => setTab("settings")} />
        </nav>
        <button className="btn logout-btn" onClick={() => api.signOut()}><LogOut size={14} /> Sign out</button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><h1>{TAB_TITLES[tab]}</h1><p className="topbar-sub">{timeNow()}</p></div>
          <div className="pill"><span className="dot" /> {nursesOnDuty} nurse{nursesOnDuty !== 1 ? "s" : ""} on duty</div>
        </header>

        <div className="content">
          {loadingData ? (
            <p className="empty-note"><Loader2 className="spin" size={16} /> Loading department data…</p>
          ) : beds.length === 0 && nurses.length <= 1 && tab !== "settings" && tab !== "staff" ? (
            <EmptyOnboarding role={role} goSetup={() => setTab("staff")} />
          ) : (
            <>
              {tab === "dashboard" && (
                <DashboardTab totalBeds={totalBeds} occupied={occupied} empty={empty} reserved={reserved}
                  occupancyPct={occupancyPct} patientsCount={occupied} nursesOnDuty={nursesOnDuty}
                  beds={beds} alerts={alerts} nurses={nurses} workloads={workloads} />
              )}
              {tab === "beds" && <BedMap beds={beds} role={role} onBedClick={openAssignModal} onDischarge={discharge} nurses={nurses} />}
              {tab === "workload" && <WorkloadView nurses={nurses} workloads={workloads} />}
              {tab === "assign" && (
                role === "head" ? (
                  <AssignBoard beds={beds} nurses={nurses} unassigned={unassigned} onDrop={assignBedToNurse} dragOverCol={dragOverCol} setDragOverCol={setDragOverCol} />
                ) : currentNurse ? (
                  <NurseSelfView nurse={currentNurse} beds={beds} onUpdate={updatePatientField} />
                ) : (
                  <div className="panel onboarding">
                    <AlertTriangle size={30} />
                    <h2>You're not active in this department yet</h2>
                    <p>Ask your Head Nurse to check your name in Staff &amp; Rooms.</p>
                  </div>
                )
              )}
              {tab === "staff" && (
                <StaffAndRooms role={role} nurses={nurses} beds={beds} workloads={workloads} department={department}
                  onToggle={toggleNurseStatus} onMax={updateMax} onRemoveNurse={removeNurse}
                  onAddRoom={addRoom} onRemoveRoom={removeRoom} onSetBedStatus={setBedStatus} />
              )}
              {tab === "alerts" && <AlertsView alerts={alerts} />}
              {tab === "reports" && role === "head" && (
                <ReportsView totalBeds={totalBeds} occupied={occupied} empty={empty} reserved={reserved}
                  occupancyPct={occupancyPct} nurses={nurses} workloads={workloads} beds={beds} />
              )}
              {tab === "settings" && <SettingsView profile={profile} department={department} role={role} />}
            </>
          )}
        </div>
      </main>

      {modalBed && <AssignModal bed={modalBed} nurses={nurses.filter((n) => n.status === "on")} onClose={() => setModalBed(null)} onSubmit={submitNewPatient} />}
      {toast && <div className="toast"><CheckCircle2 size={16} /> {toast}</div>}
    </div>
  );
}

function EmptyOnboarding({ role, goSetup }) {
  return (
    <div className="panel onboarding">
      <DoorOpen size={30} />
      <h2>No rooms or staff configured yet</h2>
      <p>{role === "head" ? "Head over to Staff & Rooms to add your rooms and beds, share your join code with your nurses, then start admitting patients." : "Ask your Head Nurse to set up rooms first."}</p>
      {role === "head" && <button className="btn primary" onClick={goSetup}><Plus size={14} /> Go to Staff &amp; Rooms</button>}
    </div>
  );
}
function NavItem({ icon, label, active, onClick, disabled, badge }) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick} disabled={disabled} title={disabled ? "Head Nurse only" : ""}>
      {icon}<span>{label}</span>{!!badge && <span className="nav-badge">{badge}</span>}
    </button>
  );
}
function SeverityBadge({ level }) { const s = SEVERITY[level]; return <span className="badge" style={{ "--c": s.color }}>{s.label}</span>; }
function IsolationBadge({ type }) { if (!type) return null; return <span className="badge iso"><ShieldAlert size={12} /> {type}</span>; }
function barColor(score) { if (score >= 80) return "var(--danger)"; if (score >= 50) return "var(--warning)"; return "var(--success)"; }

/* ---------------------------------------------------------------
   Dashboard tab
--------------------------------------------------------------- */
function DashboardTab({ totalBeds, occupied, empty, reserved, occupancyPct, patientsCount, nursesOnDuty, beds, alerts, nurses, workloads }) {
  const r = 54, c = 2 * Math.PI * r, offset = c * (1 - occupancyPct / 100);
  return (
    <div className="grid-dash">
      <section className="hero-card">
        <div className="ring-wrap">
          <svg viewBox="0 0 130 130" className="ring-svg">
            <circle cx="65" cy="65" r={r} className="ring-bg" />
            <circle cx="65" cy="65" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={offset} />
            <text x="65" y="60" textAnchor="middle" className="ring-num">{occupancyPct}%</text>
            <text x="65" y="78" textAnchor="middle" className="ring-label">Occupancy</text>
          </svg>
        </div>
        <div className="hero-stats">
          <div><span>{occupied}</span><small>Occupied</small></div>
          <div><span>{empty}</span><small>Empty</small></div>
          <div><span>{reserved}</span><small>Reserved</small></div>
          <div><span>{totalBeds}</span><small>Total beds</small></div>
        </div>
      </section>
      <div className="stat-cards">
        <StatCard icon={<Users size={18} />} label="Current patients" value={patientsCount} />
        <StatCard icon={<Stethoscope size={18} />} label="Nurses on shift" value={nursesOnDuty} />
        <StatCard icon={<AlertTriangle size={18} />} label="Active alerts" value={alerts.length} warn={alerts.length > 0} />
      </div>
      <section className="panel">
        <div className="panel-head"><Bed size={16} /> Bed map preview</div>
        <div className="mini-bed-grid">{beds.map((b) => <div key={b.id} className={`mini-bed ${b.status}`} title={`Room ${b.room} — Bed ${b.bed}`} />)}</div>
        <div className="legend"><span><i className="dot green" /> Empty</span><span><i className="dot red" /> Occupied</span><span><i className="dot yellow" /> Reserved</span></div>
      </section>
      <section className="panel">
        <div className="panel-head"><Activity size={16} /> Workload by nurse</div>
        <div className="mini-workload-list">
          {nurses.map((n) => { const w = workloads[n.id]; return (
            <div key={n.id} className="mini-workload-row">
              <span className="mw-name">{n.name}</span>
              <div className="mw-bar"><div className="mw-fill" style={{ width: `${w.score}%`, "--c": barColor(w.score) }} /></div>
              <span className="mw-pct">{w.score}%</span>
            </div>
          ); })}
          {nurses.length === 0 && <p className="empty-note small">No nurses yet</p>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><BellRing size={16} /> Top alerts</div>
        {alerts.length === 0 ? <p className="empty-note">No alerts right now — things look stable.</p> : (
          <ul className="alert-mini-list">{alerts.slice(0, 4).map((a, i) => <li key={i} className={`al-${a.level}`}>{a.text}</li>)}</ul>
        )}
      </section>
    </div>
  );
}
function StatCard({ icon, label, value, warn }) {
  return (
    <div className={`stat-card ${warn ? "warn" : ""}`}>
      <div className="stat-icon">{icon}</div>
      <div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Bed Map
--------------------------------------------------------------- */
function BedMap({ beds, role, onBedClick, onDischarge, nurses }) {
  const rooms = roomsFromBeds(beds);
  if (rooms.length === 0) return <p className="empty-note">No rooms configured yet.</p>;
  return (
    <div>
      <div className="legend big"><span><i className="dot green" /> Empty</span><span><i className="dot red" /> Occupied</span><span><i className="dot yellow" /> Reserved</span></div>
      <div className="rooms-grid">
        {rooms.map(([room, roomBeds]) => (
          <div key={room} className="room-card">
            <div className="room-title">Room {room}</div>
            <div className="room-beds">
              {roomBeds.map((b) => (
                <div key={b.id} className={`bed-cell ${b.status}`} onClick={() => (b.status !== "occupied" ? onBedClick(b) : null)}>
                  <div className="bed-cell-top"><span>Bed {b.bed}</span><span>{b.status === "occupied" ? "🔴" : b.status === "reserved" ? "🟡" : "🟢"}</span></div>
                  {b.status === "occupied" && b.patient && (
                    <div className="bed-patient">
                      <div className="bp-name">{b.patient.name}</div>
                      <div className="bp-diagnosis">{b.patient.diagnosis}</div>
                      {b.patient.procedure && <div className="bp-procedure">Procedure: {b.patient.procedure}</div>}
                      <div className="bp-badges"><SeverityBadge level={b.patient.severity} /><IsolationBadge type={b.patient.isolation} /></div>
                      <div className="bp-nurse">{nurses.find((n) => n.id === b.patient.nurseId)?.name || "Unassigned"}</div>
                      {role === "head" && <button className="btn tiny danger" onClick={(e) => { e.stopPropagation(); onDischarge(b.id); }}><LogOut size={12} /> Discharge</button>}
                    </div>
                  )}
                  {b.status !== "occupied" && role === "head" && <div className="bed-cta"><Plus size={14} /> Admit patient</div>}
                  {b.status !== "occupied" && role !== "head" && <div className="bed-cta muted">{b.status === "reserved" ? "Reserved" : "Empty"}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Workload
--------------------------------------------------------------- */
function WorkloadView({ nurses, workloads }) {
  if (nurses.length === 0) return <p className="empty-note">No nurses in this department yet.</p>;
  return (
    <div className="nurse-cards-grid">
      {nurses.map((n) => {
        const w = workloads[n.id];
        return (
          <div key={n.id} className="nurse-card">
            <div className="nurse-card-head">
              <div className={`avatar ${n.status}`}>{n.name.slice(0, 1)}</div>
              <div><div className="nurse-name">{n.name}</div><div className={`status-tag ${n.status}`}>{n.status === "on" ? "On duty" : "Off duty"}</div></div>
            </div>
            <div className="nurse-stats">
              <div><span>{w.patients}</span><small>Patients</small></div>
              <div><span>{w.high}</span><small>Critical</small></div>
              <div><span>{w.iso}</span><small>Isolation</small></div>
            </div>
            <div className="workload-bar-wrap">
              <div className="workload-bar"><div style={{ width: `${w.score}%`, "--c": barColor(w.score) }} /></div>
              <span className="workload-pct">Workload: {w.score}%</span>
            </div>
            {w.patients > n.maxPatients && <div className="overload-flag"><AlertTriangle size={13} /> Over max ({n.maxPatients})</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------
   Assignment board
--------------------------------------------------------------- */
function PatientDragCard({ bed }) {
  return (
    <div className="patient-card" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", bed.id)}>
      <div className="pc-top"><span className="pc-name">{bed.patient.name}</span><span className="pc-loc">R{bed.room}/B{bed.bed}</span></div>
      <div className="pc-diagnosis">{bed.patient.diagnosis}</div>
      <div className="pc-badges"><SeverityBadge level={bed.patient.severity} /><IsolationBadge type={bed.patient.isolation} /></div>
    </div>
  );
}
function AssignBoard({ beds, nurses, unassigned, onDrop, dragOverCol, setDragOverCol }) {
  const handleDrop = (e, nurseId) => { e.preventDefault(); const bedId = e.dataTransfer.getData("text/plain"); if (bedId) onDrop(bedId, nurseId); setDragOverCol(null); };
  if (nurses.length === 0) {
    return <div className="panel onboarding"><ArrowLeftRight size={30} /><h2>No nurses added yet</h2><p>Share your department's join code (Settings tab) with your nurses so they can join, then come back here.</p></div>;
  }
  if (beds.filter((b) => b.status === "occupied").length === 0) {
    return <div className="panel onboarding"><Bed size={30} /><h2>No patients admitted yet</h2><p>Go to Bed Map, click an empty or reserved bed, and admit a patient — they'll show up here.</p></div>;
  }
  return (
    <div>
      <p className="hint-text">Drag a patient card and drop it onto a nurse's column to reassign.</p>
      <div className="board">
        <div className={`board-col unassigned ${dragOverCol === "none" ? "drag-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOverCol("none"); }} onDragLeave={() => setDragOverCol(null)} onDrop={(e) => handleDrop(e, null)}>
          <div className="board-col-head"><span>Unassigned</span><span className="count-pill">{unassigned.length}</span></div>
          <div className="board-col-body">
            {unassigned.length === 0 && <p className="empty-note small">No unassigned patients</p>}
            {unassigned.map((b) => <PatientDragCard key={b.id} bed={b} />)}
          </div>
        </div>
        {nurses.map((n) => {
          const list = beds.filter((b) => b.status === "occupied" && b.patient.nurseId === n.id);
          return (
            <div key={n.id} className={`board-col ${n.status === "off" ? "off" : ""} ${dragOverCol === n.id ? "drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(n.id); }} onDragLeave={() => setDragOverCol(null)} onDrop={(e) => handleDrop(e, n.id)}>
              <div className="board-col-head"><span>{n.name}</span><span className="count-pill">{list.length}/{n.maxPatients}</span></div>
              <div className="board-col-body">
                {n.status === "off" && <p className="empty-note small">Off duty</p>}
                {list.length === 0 && n.status === "on" && <p className="empty-note small">No patients</p>}
                {list.map((b) => <PatientDragCard key={b.id} bed={b} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Nurse self view
--------------------------------------------------------------- */
function NurseSelfView({ nurse, beds, onUpdate }) {
  const mine = beds.filter((b) => b.status === "occupied" && b.patient.nurseId === nurse.id);
  return (
    <div>
      <p className="hint-text">Welcome {nurse.name} — here are your current patients. You can update condition and notes only.</p>
      <div className="self-list">
        {mine.length === 0 && <p className="empty-note">No patients currently assigned to you.</p>}
        {mine.map((b) => (
          <div key={b.id} className="self-card">
            <div className="self-top">
              <div><div className="pc-name">{b.patient.name}</div><div className="pc-loc">Room {b.room} · Bed {b.bed}</div><div className="pc-diagnosis">{b.patient.diagnosis}{b.patient.procedure ? ` · ${b.patient.procedure}` : ""}</div></div>
              <div className="pc-badges"><SeverityBadge level={b.patient.severity} /><IsolationBadge type={b.patient.isolation} /></div>
            </div>
            <label className="field"><span>Patient condition</span>
              <select className="input" value={b.patient.condition} onChange={(e) => onUpdate(b.id, "condition", e.target.value)}>
                <option>Stable</option><option>Needs attention</option><option>Critical</option>
              </select>
            </label>
            <label className="field"><span>Nursing notes</span>
              <textarea className="input" rows={2} value={b.patient.note} placeholder="Write a note…" onChange={(e) => onUpdate(b.id, "note", e.target.value)} />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Staff & Rooms
--------------------------------------------------------------- */
function StaffAndRooms({ role, nurses, beds, workloads, department, onToggle, onMax, onRemoveNurse, onAddRoom, onRemoveRoom, onSetBedStatus }) {
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const rooms = roomsFromBeds(beds);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(department.join_code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (e) {}
  };

  return (
    <div>
      {role === "head" && (
        <section className="panel join-code-panel">
          <div className="panel-head"><Users2 size={16} /> Invite nurses</div>
          <p className="empty-note" style={{ textAlign: "left" }}>Share this code — nurses enter it on their own "Join a department" screen after creating their account.</p>
          <div className="join-code-row">
            <span className="join-code">{department.join_code}</span>
            <button className="btn tiny" onClick={copyCode}><Copy size={12} /> {copied ? "Copied" : "Copy"}</button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head-row"><div className="panel-head"><Users2 size={16} /> Nurses</div></div>
        {nurses.length === 0 ? <p className="empty-note">No nurses have joined yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Status</th><th>Patients</th><th>Max</th><th>Workload</th>{role === "head" && <th></th>}</tr></thead>
              <tbody>
                {nurses.map((n) => {
                  const w = workloads[n.id];
                  return (
                    <tr key={n.id}>
                      <td>{n.name}</td>
                      <td><span className={`status-tag ${n.status}`}>{n.status === "on" ? "On duty" : "Off duty"}</span></td>
                      <td>{w.patients}</td>
                      <td>{role === "head" ? <input className="input num" type="number" min={1} value={n.maxPatients} onChange={(e) => onMax(n.id, parseInt(e.target.value || "1", 10))} /> : n.maxPatients}</td>
                      <td>{w.score}%</td>
                      {role === "head" && (
                        <td className="row-actions">
                          <button className="btn tiny" onClick={() => onToggle(n.id)}>{n.status === "on" ? <UserX size={13} /> : <UserCheck size={13} />} {n.status === "on" ? "End shift" : "Start shift"}</button>
                          <button className="btn tiny danger" onClick={() => onRemoveNurse(n.id)}><Trash2 size={12} /></button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head-row">
          <div className="panel-head"><DoorOpen size={16} /> Rooms &amp; Beds</div>
          {role === "head" && <button className="btn primary" onClick={() => setShowRoomModal(true)}><Plus size={14} /> Add room</button>}
        </div>
        {rooms.length === 0 ? <p className="empty-note">No rooms configured yet.</p> : (
          <div className="rooms-grid">
            {rooms.map(([room, roomBeds]) => (
              <div key={room} className="room-card">
                <div className="room-title-row">
                  <span className="room-title">Room {room}</span>
                  {role === "head" && <button className="icon-btn" onClick={() => onRemoveRoom(room)} title="Remove room"><Trash2 size={13} /></button>}
                </div>
                <div className="room-beds">
                  {roomBeds.map((b) => (
                    <div key={b.id} className="bed-row">
                      <span>Bed {b.bed}</span>
                      <span className={`bed-dot ${b.status}`} />
                      {role === "head" ? (
                        <select className="input tiny-select" value={b.status} disabled={b.status === "occupied"} onChange={(e) => onSetBedStatus(b.id, e.target.value)}>
                          <option value="empty">Empty</option><option value="reserved">Reserved</option><option value="occupied" disabled>Occupied</option>
                        </select>
                      ) : <span className="tiny-select-readonly">{b.status}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showRoomModal && <AddRoomModal onClose={() => setShowRoomModal(false)} onSubmit={(name, cap) => { onAddRoom(name, cap); setShowRoomModal(false); }} />}
    </div>
  );
}

function AddRoomModal({ onClose, onSubmit }) {
  const [name, setName] = useState(""); const [cap, setCap] = useState(2);
  const submit = () => { if (!name.trim()) return; onSubmit(name.trim(), Math.min(6, Math.max(1, cap))); };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Add Room</h3><button type="button" className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <label className="field"><span>Room number / name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. 109" /></label>
        <label className="field"><span>Number of beds (1–6)</span><input className="input num" type="number" min={1} max={6} value={cap} onChange={(e) => setCap(parseInt(e.target.value || "1", 10))} /></label>
        <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" onClick={submit} className="btn primary">Add room</button></div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Alerts
--------------------------------------------------------------- */
function AlertsView({ alerts }) {
  if (alerts.length === 0) return <div className="panel"><p className="empty-note">No alerts right now. Everything looks within normal limits.</p></div>;
  return <div className="alerts-list">{alerts.map((a, i) => <div key={i} className={`alert-item al-${a.level}`}><AlertTriangle size={17} /><span>{a.text}</span></div>)}</div>;
}

/* ---------------------------------------------------------------
   Reports
--------------------------------------------------------------- */
function ReportsView({ totalBeds, occupied, empty, reserved, occupancyPct, nurses, workloads, beds }) {
  const exportCSV = () => {
    const rows = [
      ["Report", "Daily Report — Nurse & Bed Management System"], ["Generated", timeNow()], [],
      ["Total beds", totalBeds], ["Occupied beds", occupied], ["Reserved beds", reserved], ["Empty beds", empty], ["Occupancy %", occupancyPct], [],
      ["Nurse", "Status", "Patients", "Max", "Critical", "Isolation", "Workload %"],
      ...nurses.map((n) => { const w = workloads[n.id]; return [n.name, n.status === "on" ? "On duty" : "Off duty", w.patients, n.maxPatients, w.high, w.iso, w.score]; }),
      [], ["Room", "Bed", "Status", "Patient", "Diagnosis", "Procedure", "Severity", "Isolation", "Assigned nurse"],
      ...beds.map((b) => [b.room, b.bed, b.status, b.patient?.name || "-", b.patient?.diagnosis || "-", b.patient?.procedure || "-", b.patient ? SEVERITY[b.patient.severity].label : "-", b.patient?.isolation || "-", nurses.find((n) => n.id === b.patient?.nurseId)?.name || "-"]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    try {
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `daily-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) {}
  };
  return (
    <div>
      <div className="panel-head-row no-print">
        <div className="panel-head"><FileBarChart2 size={16} /> Daily report summary</div>
        <div className="report-actions"><button className="btn" onClick={() => window.print()}><Printer size={14} /> Print / PDF</button><button className="btn primary" onClick={exportCSV}><FileDown size={14} /> Export Excel</button></div>
      </div>
      <div className="report-grid">
        <div className="report-stat"><span>{totalBeds}</span><small>Total beds</small></div>
        <div className="report-stat"><span>{occupied}</span><small>Occupied</small></div>
        <div className="report-stat"><span>{empty}</span><small>Empty</small></div>
        <div className="report-stat"><span>{reserved}</span><small>Reserved</small></div>
        <div className="report-stat"><span>{occupancyPct}%</span><small>Occupancy</small></div>
      </div>
      <div className="panel">
        <div className="panel-head">Workload by nurse</div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nurse</th><th>Status</th><th>Patients</th><th>Critical</th><th>Isolation</th><th>Workload</th></tr></thead>
            <tbody>{nurses.map((n) => { const w = workloads[n.id]; return (<tr key={n.id}><td>{n.name}</td><td>{n.status === "on" ? "On duty" : "Off duty"}</td><td>{w.patients}</td><td>{w.high}</td><td>{w.iso}</td><td>{w.score}%</td></tr>); })}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Settings
--------------------------------------------------------------- */
function SettingsView({ profile, department, role }) {
  const [copied, setCopied] = useState(false);
  const copyCode = async () => { try { await navigator.clipboard.writeText(department.join_code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (e) {} };
  return (
    <div>
      <section className="panel">
        <div className="panel-head">Account</div>
        <p className="empty-note" style={{ textAlign: "left" }}>{profile.full_name} · {profile.email} · {role === "head" ? "Head Nurse" : "Nurse"} · {department.name}</p>
      </section>
      {role === "head" && (
        <section className="panel join-code-panel">
          <div className="panel-head">Department join code</div>
          <p className="empty-note" style={{ textAlign: "left" }}>Share this with nurses so they can join {department.name}.</p>
          <div className="join-code-row"><span className="join-code">{department.join_code}</span><button className="btn tiny" onClick={copyCode}><Copy size={12} /> {copied ? "Copied" : "Copy"}</button></div>
        </section>
      )}
      <section className="panel security-panel">
        <div className="panel-head"><ShieldAlert size={16} /> About security</div>
        <ul className="security-list">
          <li>Authentication is handled by Supabase Auth — real passwords, hashed and verified server-side, never by this app's own code.</li>
          <li>Role and department access are enforced by PostgreSQL Row-Level Security: a nurse's queries are restricted to their own assigned patients at the database level, not just hidden in the UI.</li>
          <li>For real patient data in production, also confirm your Supabase project's hosting region and backup policy against your hospital's data-residency and retention requirements (e.g. Saudi PDPL / MOH).</li>
        </ul>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------
   Admit-patient modal
--------------------------------------------------------------- */
function AssignModal({ bed, nurses, onClose, onSubmit }) {
  const [name, setName] = useState(""); const [diagnosis, setDiagnosis] = useState(""); const [procedure, setProcedure] = useState("");
  const [severity, setSeverity] = useState("low"); const [isolation, setIsolation] = useState("None"); const [nurseId, setNurseId] = useState(nurses[0]?.id || "");
  const submit = () => {
    if (!name.trim() || !diagnosis.trim()) return;
    onSubmit({ name: name.trim(), diagnosis: diagnosis.trim(), procedure: procedure.trim() || null, severity, isolation: isolation === "None" ? null : isolation, nurseId: nurseId || null });
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Assign Patient — Room {bed.room} / Bed {bed.bed}</h3><button type="button" className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <label className="field"><span>Patient name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Patient name" /></label>
        <label className="field"><span>Diagnosis</span><input className="input" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="e.g. Community-acquired pneumonia" /></label>
        <label className="field"><span>Procedure <span className="field-optional">(optional)</span></span><input className="input" value={procedure} onChange={(e) => setProcedure(e.target.value)} placeholder="e.g. Chest tube insertion" /></label>
        <label className="field"><span>Severity</span>
          <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select>
        </label>
        <label className="field"><span>Isolation type</span>
          <select className="input" value={isolation} onChange={(e) => setIsolation(e.target.value)}>{ISOLATION_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <label className="field"><span>Assign to nurse</span>
          <select className="input" value={nurseId} onChange={(e) => setNurseId(e.target.value)}>
            <option value="">Unassigned for now</option>
            {nurses.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </label>
        <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" onClick={submit} className="btn primary">Admit patient</button></div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   CSS
--------------------------------------------------------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&display=swap');
:root{ --bg:#F3F6F8; --surface:#FFFFFF; --surface-alt:#EAF0F3; --ink:#152A32; --ink-soft:#5C7079; --primary:#0E5C63; --primary-dark:#0A4448; --success:#2E9E5B; --warning:#DB9A2C; --danger:#D64550; --isolation:#7A4FB5; --border:#DCE5E9; font-variant-numeric: tabular-nums; }
*{box-sizing:border-box;}
.app-root{ font-family:'Manrope','Segoe UI',Arial,sans-serif; background:var(--bg); color:var(--ink); display:flex; min-height:640px; width:100%; overflow:hidden; border-radius:14px; }
button{font-family:inherit; cursor:pointer;}
:focus-visible{outline:2px solid var(--primary); outline-offset:2px;}
.loading-screen{align-items:center; justify-content:center; gap:10px; font-size:14px; color:var(--ink-soft);}
.spin{animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.login-root{align-items:center; justify-content:center; padding:24px;}
.login-card{background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:26px; width:380px; max-width:100%; display:flex; flex-direction:column; gap:16px;}
.login-brand{display:flex; align-items:center; gap:10px;}
.login-choices{display:flex; flex-direction:column; gap:10px;}
.login-choice{display:flex; align-items:center; gap:12px; padding:14px; border:1px solid var(--border); border-radius:12px; background:var(--surface-alt); text-align:left;}
.login-choice div div{font-weight:800; font-size:13.5px;}
.login-choice small{color:var(--ink-soft); font-size:11px;}
.login-form{display:flex; flex-direction:column; gap:10px;}
.login-err{background:#FDECEC; color:var(--danger); border-radius:8px; padding:7px 10px; font-size:12px; font-weight:600;}
.login-notice{background:#EAF7EE; color:var(--success); border-radius:8px; padding:7px 10px; font-size:12px; font-weight:600; display:flex; gap:6px; align-items:center;}
.security-note{font-size:11px; color:var(--ink-soft); display:flex; gap:6px; align-items:flex-start; margin:0;}
.sidebar{ width:230px; flex-shrink:0; background:linear-gradient(180deg,var(--primary-dark),var(--primary)); color:#fff; display:flex; flex-direction:column; padding:18px 14px; gap:18px; }
.brand{display:flex; align-items:center; gap:10px;}
.brand-mark{width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center; flex-shrink:0;}
.brand-title{font-weight:800; font-size:14px;}
.brand-sub{font-size:11px; opacity:.75;}
.nav{display:flex; flex-direction:column; gap:4px; flex:1;}
.nav-item{ display:flex; align-items:center; gap:9px; padding:9px 10px; border-radius:9px; background:transparent; border:none; color:rgba(255,255,255,.85); font-size:13px; text-align:left; }
.nav-item span{flex:1; text-align:left;}
.nav-item:hover:not(:disabled){background:rgba(255,255,255,.1);}
.nav-item.active{background:rgba(255,255,255,.18); color:#fff; font-weight:700;}
.nav-item:disabled{opacity:.35; cursor:not-allowed;}
.nav-badge{background:var(--danger); color:#fff; font-size:10px; border-radius:99px; padding:1px 6px;}
.logout-btn{background:rgba(255,255,255,.12); color:#fff; border:none; justify-content:center;}
.main{flex:1; display:flex; flex-direction:column; min-width:0; background:var(--bg);}
.topbar{display:flex; align-items:center; justify-content:space-between; padding:16px 22px; border-bottom:1px solid var(--border); background:var(--surface);}
.topbar h1{font-size:18px; font-weight:800; margin:0;}
.topbar-sub{font-size:12px; color:var(--ink-soft); margin:2px 0 0;}
.pill{display:flex; align-items:center; gap:6px; background:var(--surface-alt); padding:6px 12px; border-radius:99px; font-size:12px; font-weight:600;}
.pill .dot{width:8px;height:8px;border-radius:50%;background:var(--success);}
.content{flex:1; overflow-y:auto; padding:20px 22px;}
.onboarding{display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px; padding:40px 20px; color:var(--ink-soft);}
.onboarding h2{font-size:15px; color:var(--ink); margin:6px 0 0;}
.grid-dash{display:grid; grid-template-columns:1fr 1fr; gap:16px;}
.hero-card{grid-column:1/-1; background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:20px 24px; display:flex; align-items:center; gap:32px; flex-wrap:wrap;}
.ring-svg{width:150px; height:150px; transform:rotate(-90deg);}
.ring-bg{fill:none; stroke:var(--surface-alt); stroke-width:11;}
.ring-fg{fill:none; stroke:var(--primary); stroke-width:11; stroke-linecap:round; transition:stroke-dashoffset .6s ease;}
.ring-num{font-size:22px; font-weight:800; fill:var(--ink); transform:rotate(90deg); transform-origin:65px 65px;}
.ring-label{font-size:9px; fill:var(--ink-soft); transform:rotate(90deg); transform-origin:65px 65px;}
.hero-stats{display:flex; gap:28px; flex-wrap:wrap;}
.hero-stats > div{text-align:center;}
.hero-stats span{display:block; font-size:24px; font-weight:800; color:var(--primary-dark);}
.hero-stats small{font-size:11px; color:var(--ink-soft);}
.stat-cards{grid-column:1/-1; display:grid; grid-template-columns:repeat(3,1fr); gap:14px;}
.stat-card{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:14px 16px; display:flex; align-items:center; gap:12px;}
.stat-card.warn{border-color:var(--danger); background:#FDF1F1;}
.stat-icon{width:38px; height:38px; border-radius:10px; background:var(--surface-alt); display:flex; align-items:center; justify-content:center; color:var(--primary); flex-shrink:0;}
.stat-value{font-size:20px; font-weight:800;}
.stat-label{font-size:11.5px; color:var(--ink-soft);}
.panel{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:14px;}
.panel-head{font-weight:800; font-size:13.5px; display:flex; align-items:center; gap:7px; margin-bottom:12px;}
.panel-head-row{display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap; gap:8px;}
.mini-bed-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(20px,1fr)); gap:6px; margin-bottom:10px;}
.mini-bed{aspect-ratio:1; border-radius:5px;}
.mini-bed.occupied{background:var(--danger);} .mini-bed.empty{background:var(--success);} .mini-bed.reserved{background:var(--warning);}
.legend{display:flex; gap:14px; font-size:11.5px; color:var(--ink-soft);}
.legend.big{margin-bottom:14px; font-size:13px;}
.legend span{display:flex; align-items:center; gap:5px;}
.dot{width:9px; height:9px; border-radius:50%; display:inline-block;}
.dot.green{background:var(--success);} .dot.red{background:var(--danger);} .dot.yellow{background:var(--warning);}
.mini-workload-list{display:flex; flex-direction:column; gap:9px;}
.mini-workload-row{display:flex; align-items:center; gap:10px; font-size:12.5px;}
.mw-name{width:110px; flex-shrink:0;}
.mw-bar{flex:1; height:8px; background:var(--surface-alt); border-radius:99px; overflow:hidden;}
.mw-fill{height:100%; background:var(--c); border-radius:99px; transition:width .5s ease;}
.mw-pct{width:34px; text-align:right; font-weight:700;}
.alert-mini-list{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px;}
.alert-mini-list li{padding:8px 10px; border-radius:9px; font-size:12.5px; border-left:3px solid var(--ink-soft); background:var(--surface-alt);}
.al-high{border-color:var(--danger) !important;} .al-moderate{border-color:var(--warning) !important;} .al-low{border-color:var(--success) !important;}
.empty-note{color:var(--ink-soft); font-size:13px; text-align:center; padding:14px 0; display:flex; align-items:center; justify-content:center; gap:6px;}
.empty-note.small{font-size:11.5px; padding:8px 0;}
.rooms-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:14px;}
.room-card{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:12px;}
.room-title-row{display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;}
.room-title{font-weight:800; font-size:13px; color:var(--primary-dark);}
.room-beds{display:flex; flex-direction:column; gap:8px;}
.bed-cell{border-radius:10px; padding:9px 10px; cursor:pointer; border:1px solid var(--border); background:var(--surface-alt);}
.bed-cell.occupied{background:#FDECEC; border-color:#F3C6C9;}
.bed-cell.empty{background:#EAF7EE; border-color:#C7E9CE;}
.bed-cell.reserved{background:#FCF3DF; border-color:#F2DDA6;}
.bed-cell-top{display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:4px;}
.bed-patient{display:flex; flex-direction:column; gap:4px;}
.bp-name{font-size:13px; font-weight:700;}
.bp-diagnosis{font-size:11.5px; color:var(--ink-soft);}
.bp-procedure{font-size:11px; color:var(--ink-soft); font-style:italic;}
.pc-diagnosis{font-size:11px; color:var(--ink-soft); margin-bottom:5px;}
.field-optional{font-weight:400; color:var(--ink-soft); font-size:11px;}
.bp-badges{display:flex; gap:5px; flex-wrap:wrap;}
.bp-nurse{font-size:11px; color:var(--ink-soft);}
.bed-cta{font-size:11.5px; color:var(--primary); display:flex; align-items:center; gap:4px; margin-top:2px;}
.bed-cta.muted{color:var(--ink-soft);}
.bed-row{display:flex; align-items:center; gap:8px; font-size:12px;}
.bed-dot{width:9px; height:9px; border-radius:50%; flex-shrink:0;}
.bed-dot.occupied{background:var(--danger);} .bed-dot.empty{background:var(--success);} .bed-dot.reserved{background:var(--warning);}
.tiny-select{padding:3px 6px; font-size:11px;}
.tiny-select-readonly{font-size:11px; color:var(--ink-soft);}
.badge{display:inline-flex; align-items:center; gap:3px; font-size:10.5px; padding:2px 7px; border-radius:99px; background:color-mix(in srgb, var(--c) 16%, white); color:var(--c); border:1px solid color-mix(in srgb, var(--c) 40%, white); font-weight:700;}
.badge.iso{--c:var(--isolation); color:var(--isolation); border-color:color-mix(in srgb, var(--isolation) 40%, white); background:color-mix(in srgb, var(--isolation) 14%, white);}
.nurse-cards-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:14px;}
.nurse-card{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:14px;}
.nurse-card-head{display:flex; align-items:center; gap:10px; margin-bottom:12px;}
.avatar{width:40px;height:40px;border-radius:50%;background:var(--surface-alt); display:flex; align-items:center; justify-content:center; font-weight:800; color:var(--primary-dark); flex-shrink:0;}
.avatar.off{opacity:.4;}
.nurse-name{font-weight:800; font-size:13.5px;}
.status-tag{font-size:10.5px; padding:1px 7px; border-radius:99px; display:inline-block; margin-top:2px;}
.status-tag.on{background:#E6F4EA; color:var(--success);}
.status-tag.off{background:#F1F1F1; color:var(--ink-soft);}
.nurse-stats{display:flex; justify-content:space-between; margin-bottom:12px;}
.nurse-stats div{text-align:center;}
.nurse-stats span{display:block; font-weight:800; font-size:16px;}
.nurse-stats small{font-size:10.5px; color:var(--ink-soft);}
.workload-bar-wrap{display:flex; align-items:center; gap:8px;}
.workload-bar{flex:1; height:9px; background:var(--surface-alt); border-radius:99px; overflow:hidden;}
.workload-bar div{height:100%; background:var(--c); border-radius:99px;}
.workload-pct{font-size:11px; font-weight:700; white-space:nowrap;}
.overload-flag{margin-top:10px; font-size:11.5px; color:var(--danger); display:flex; align-items:center; gap:5px; font-weight:700;}
.hint-text{font-size:12.5px; color:var(--ink-soft); margin-bottom:12px;}
.board{display:flex; gap:12px; overflow-x:auto; padding-bottom:8px;}
.board-col{background:var(--surface); border:1.5px dashed var(--border); border-radius:14px; padding:10px; width:220px; flex-shrink:0; min-height:300px;}
.board-col.unassigned{border-color:var(--warning);}
.board-col.off{opacity:.55;}
.board-col.drag-over{border-color:var(--primary); background:var(--surface-alt);}
.board-col-head{display:flex; justify-content:space-between; align-items:center; font-weight:800; font-size:12.5px; margin-bottom:10px;}
.count-pill{background:var(--surface-alt); font-size:10.5px; padding:1px 8px; border-radius:99px;}
.board-col-body{display:flex; flex-direction:column; gap:8px;}
.patient-card{background:var(--surface-alt); border-radius:10px; padding:8px 9px; cursor:grab; border:1px solid var(--border);}
.patient-card:active{cursor:grabbing;}
.pc-top{display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:5px;}
.pc-loc{color:var(--ink-soft); font-weight:500;}
.pc-badges{display:flex; gap:5px; flex-wrap:wrap;}
.self-list{display:flex; flex-direction:column; gap:12px;}
.self-card{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:14px;}
.self-top{display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;}
.field{display:flex; flex-direction:column; gap:4px; font-size:12px; margin-bottom:8px; font-weight:600;}
.input{border:1px solid var(--border); border-radius:8px; padding:7px 9px; font-family:inherit; font-size:12.5px; background:#fff; color:var(--ink); width:100%;}
.input.num{width:70px;}
.btn{border:1px solid var(--border); background:#fff; padding:7px 13px; border-radius:9px; font-size:12.5px; font-weight:700; display:inline-flex; align-items:center; gap:6px; color:var(--ink);}
.btn.primary{background:var(--primary); color:#fff; border-color:var(--primary);}
.btn.danger{background:#fff; color:var(--danger); border-color:var(--danger);}
.btn.tiny{padding:4px 9px; font-size:11px;}
.btn:disabled{opacity:.6; cursor:not-allowed;}
.icon-btn{border:none; background:var(--surface-alt); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center;}
.row-actions{display:flex; gap:6px;}
.table-wrap{overflow-x:auto;}
.table{width:100%; border-collapse:collapse; font-size:12.5px;}
.table th{background:var(--surface-alt); padding:8px 10px; text-align:left; font-weight:800;}
.table td{padding:8px 10px; border-bottom:1px solid var(--border);}
.alerts-list{display:flex; flex-direction:column; gap:10px;}
.alert-item{background:var(--surface); border:1px solid var(--border); border-left:4px solid var(--ink-soft); border-radius:12px; padding:12px 14px; display:flex; align-items:center; gap:10px; font-size:13px;}
.alert-item.al-high{border-left-color:var(--danger); color:var(--danger);}
.alert-item.al-moderate{border-left-color:var(--warning); color:#8a6717;}
.alert-item.al-low{border-left-color:var(--success); color:var(--success);}
.report-grid{display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px;}
.report-stat{background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; text-align:center;}
.report-stat span{display:block; font-size:20px; font-weight:800; color:var(--primary-dark);}
.report-stat small{font-size:11px; color:var(--ink-soft);}
.report-actions{display:flex; gap:8px; flex-wrap:wrap; align-items:center;}
.security-panel .security-list{margin:0; padding-left:18px; display:flex; flex-direction:column; gap:8px; font-size:12.5px; color:var(--ink-soft);}
.join-code-panel .join-code-row{display:flex; align-items:center; gap:10px;}
.join-code{font-family:monospace; font-size:18px; font-weight:800; letter-spacing:2px; background:var(--surface-alt); padding:8px 14px; border-radius:8px;}
.modal-overlay{position:fixed; inset:0; background:rgba(10,20,25,.45); display:flex; align-items:center; justify-content:center; z-index:50; padding:16px;}
.modal{background:#fff; border-radius:16px; padding:20px; width:380px; max-width:100%; display:flex; flex-direction:column; gap:10px; max-height:90vh; overflow-y:auto;}
.modal-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;}
.modal-head h3{font-size:14.5px; margin:0;}
.modal-actions{display:flex; justify-content:flex-end; gap:8px; margin-top:6px;}
.toast{position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; padding:9px 18px; border-radius:99px; font-size:12.5px; display:flex; align-items:center; gap:7px; z-index:60;}
@media (max-width:880px){ .app-root{flex-direction:column;} .sidebar{width:100%; flex-direction:row; align-items:center; overflow-x:auto;} .nav{flex-direction:row;} .grid-dash{grid-template-columns:1fr;} .stat-cards{grid-template-columns:1fr;} .report-grid{grid-template-columns:repeat(2,1fr);} }
@media print{ .sidebar, .topbar, .no-print{display:none !important;} .app-root{display:block; height:auto;} .content{padding:0;} }
`;
