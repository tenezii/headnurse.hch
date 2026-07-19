import { supabase } from "./supabaseClient";

/* ---------------------------------------------------------------
   Auth
--------------------------------------------------------------- */
export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/* ---------------------------------------------------------------
   My profile (role, department, etc.)
--------------------------------------------------------------- */
export async function getMyProfile() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from("users").select("*").eq("id", auth.user.id).single();
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------------------
   Onboarding
--------------------------------------------------------------- */
export async function createDepartment(name) {
  const { data, error } = await supabase.rpc("create_department", { p_name: name });
  if (error) throw error;
  return data;
}

export async function joinDepartment(code) {
  const { data, error } = await supabase.rpc("join_department", { p_code: code.toLowerCase() });
  if (error) throw error;
  return data;
}

export async function getDepartment(departmentId) {
  const { data, error } = await supabase.from("departments").select("*").eq("id", departmentId).single();
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------------------
   Fetch + reshape everything into the {beds, nurses} view model
   the existing UI components already expect — this is what lets
   BedMap / WorkloadView / AssignBoard / etc. stay unchanged.
--------------------------------------------------------------- */
export async function fetchAll(departmentId) {
  const [{ data: nurseRows, error: e1 }, { data: roomRows, error: e2 }] = await Promise.all([
    supabase.from("users").select("*").eq("department_id", departmentId),
    supabase.from("rooms").select("id, name").eq("department_id", departmentId),
  ]);
  if (e1) throw e1; if (e2) throw e2;

  const roomIds = roomRows.map((r) => r.id);
  const roomNameById = Object.fromEntries(roomRows.map((r) => [r.id, r.name]));

  const { data: bedRows, error: e3 } = await supabase
    .from("beds").select("id, room_id, bed_number, status").in("room_id", roomIds.length ? roomIds : ["00000000-0000-0000-0000-000000000000"]);
  if (e3) throw e3;

  const bedIds = bedRows.map((b) => b.id);
  const { data: assignRows, error: e4 } = await supabase
    .from("bed_assignments").select("bed_id, patient_id, nurse_id")
    .in("bed_id", bedIds.length ? bedIds : ["00000000-0000-0000-0000-000000000000"])
    .is("unassigned_at", null);
  if (e4) throw e4;

  const patientIds = assignRows.map((a) => a.patient_id);
  let patientById = {};
  if (patientIds.length) {
    const { data: patientRows, error: e5 } = await supabase
      .from("patients").select("*").in("id", patientIds);
    if (e5) throw e5;
    patientById = Object.fromEntries(patientRows.map((p) => [p.id, p]));
  }
  const nurseIdForBed = Object.fromEntries(assignRows.map((a) => [a.bed_id, a.nurse_id]));
  const patientIdForBed = Object.fromEntries(assignRows.map((a) => [a.bed_id, a.patient_id]));

  const nurses = nurseRows.map((n) => ({
    id: n.id, name: n.full_name, status: n.status, maxPatients: n.max_patients,
  }));

  const beds = bedRows.map((b) => {
    const patient = patientIdForBed[b.id] ? patientById[patientIdForBed[b.id]] : null;
    return {
      id: b.id, room: roomNameById[b.room_id], bed: b.bed_number, status: b.status,
      patient: patient
        ? {
            id: patient.id, name: patient.full_name, diagnosis: patient.diagnosis,
            procedure: patient.procedure_name, severity: patient.severity,
            isolation: patient.isolation_type, condition: patient.condition, note: patient.notes,
            nurseId: nurseIdForBed[b.id] || null,
          }
        : null,
    };
  });

  return { beds, nurses };
}

/* ---------------------------------------------------------------
   Rooms
--------------------------------------------------------------- */
export async function addRoom(departmentId, name, capacity) {
  const { data: room, error } = await supabase
    .from("rooms").insert({ department_id: departmentId, name }).select().single();
  if (error) throw error;
  const bedsToInsert = Array.from({ length: capacity }, (_, i) => ({ room_id: room.id, bed_number: i + 1 }));
  const { error: e2 } = await supabase.from("beds").insert(bedsToInsert);
  if (e2) throw e2;
}

export async function removeRoom(roomId) {
  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) throw error;
}

export async function setBedStatus(bedId, status) {
  const { error } = await supabase.from("beds").update({ status }).eq("id", bedId);
  if (error) throw error;
}

/* ---------------------------------------------------------------
   Nurses
--------------------------------------------------------------- */
export async function toggleNurseStatus(userId, currentStatus) {
  const { error } = await supabase.from("users").update({ status: currentStatus === "on" ? "off" : "on" }).eq("id", userId);
  if (error) throw error;
}

export async function updateMaxPatients(userId, value) {
  const { error } = await supabase.from("users").update({ max_patients: value }).eq("id", userId);
  if (error) throw error;
}

export async function removeNurseFromDepartment(userId) {
  const { error } = await supabase.rpc("remove_nurse_from_department", { p_user_id: userId });
  if (error) throw error;
}

/* ---------------------------------------------------------------
   Patients / assignments
--------------------------------------------------------------- */
export async function admitPatient(bedId, { name, diagnosis, procedure, severity, isolation, nurseId }) {
  const { data, error } = await supabase.rpc("admit_patient", {
    p_bed_id: bedId, p_full_name: name, p_diagnosis: diagnosis, p_procedure_name: procedure,
    p_severity: severity, p_isolation_type: isolation, p_nurse_id: nurseId,
  });
  if (error) throw error;
  return data;
}

export async function dischargePatient(bedId) {
  const { error } = await supabase.rpc("discharge_patient", { p_bed_id: bedId });
  if (error) throw error;
}

export async function reassignBed(bedId, nurseId) {
  const { error } = await supabase.rpc("reassign_bed", { p_bed_id: bedId, p_new_nurse_id: nurseId });
  if (error) throw error;
}

export async function updatePatientField(patientId, field, value) {
  const column = field === "note" ? "notes" : field;
  const { error } = await supabase.from("patients").update({ [column]: value }).eq("id", patientId);
  if (error) throw error;
}

/* ---------------------------------------------------------------
   Realtime — call `onChange` whenever anything relevant changes,
   so every open browser stays live without manual refreshing.
--------------------------------------------------------------- */
export function subscribeToDepartment(departmentId, onChange) {
  const channel = supabase
    .channel(`department-${departmentId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "beds" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "patients" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "bed_assignments" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "users", filter: `department_id=eq.${departmentId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `department_id=eq.${departmentId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
