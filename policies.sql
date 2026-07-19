-- =================================================================
-- Policies & functions — Nurse & Bed Management System
-- Run this AFTER schema.sql, in the Supabase SQL Editor.
-- =================================================================

alter table departments      enable row level security;
alter table users            enable row level security;
alter table rooms            enable row level security;
alter table beds             enable row level security;
alter table patients         enable row level security;
alter table bed_assignments  enable row level security;
alter table audit_log        enable row level security;

-- -----------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read `users` even
-- under the caller's own RLS — avoids recursive-policy problems).
-- -----------------------------------------------------------------
create or replace function current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from users where id = auth.uid();
$$;

create or replace function current_user_department()
returns uuid language sql stable security definer set search_path = public as $$
  select department_id from users where id = auth.uid();
$$;

create or replace function is_head_nurse()
returns boolean language sql stable security definer set search_path = public as $$
  select current_user_role() = 'head_nurse';
$$;

create or replace function is_my_patient(p_patient_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bed_assignments
    where patient_id = p_patient_id and nurse_id = auth.uid() and unassigned_at is null
  );
$$;

-- -----------------------------------------------------------------
-- departments
-- -----------------------------------------------------------------
create policy dept_select on departments for select
  using (id = current_user_department());

create policy dept_update on departments for update
  using (id = current_user_department() and is_head_nurse())
  with check (id = current_user_department() and is_head_nurse());

-- -----------------------------------------------------------------
-- users
-- Everyone in a department can see the staff list. Only the head
-- nurse edits another person's row; a nurse may update their OWN
-- row, but only the `status` column (enforced by trigger below).
-- -----------------------------------------------------------------
create policy users_select on users for select
  using (department_id is not null and department_id = current_user_department());

create policy users_update_head_nurse on users for update
  using (department_id = current_user_department() and is_head_nurse())
  with check (department_id = current_user_department() and is_head_nurse());

create policy users_update_self on users for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Column guard for self-updates. `app.bypass_self_guard` is set by
-- the onboarding RPC functions below (create_department /
-- join_department) so THEY can set department_id/role once, while
-- ordinary client-side updates from a nurse's own session cannot.
create or replace function enforce_self_update_columns()
returns trigger language plpgsql security definer as $$
begin
  if coalesce(current_setting('app.bypass_self_guard', true), '') = 'on' then
    return new;
  end if;
  if old.id = auth.uid() and not is_head_nurse() then
    if new.role <> old.role
       or new.department_id is distinct from old.department_id
       or new.max_patients <> old.max_patients
       or new.full_name <> old.full_name then
      raise exception 'You may only update your own duty status.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_users_self_update
  before update on users
  for each row execute function enforce_self_update_columns();

-- -----------------------------------------------------------------
-- rooms / beds — department-wide read, head-nurse-only write.
-- Admit/discharge/reassign go through the RPC functions further
-- down so bed status + assignment + patient stay in sync.
-- -----------------------------------------------------------------
create policy rooms_select on rooms for select
  using (department_id = current_user_department());

create policy rooms_write on rooms for all
  using (department_id = current_user_department() and is_head_nurse())
  with check (department_id = current_user_department() and is_head_nurse());

create policy beds_select on beds for select
  using (room_id in (select id from rooms where department_id = current_user_department()));

create policy beds_write on beds for all
  using (is_head_nurse() and room_id in (select id from rooms where department_id = current_user_department()))
  with check (is_head_nurse() and room_id in (select id from rooms where department_id = current_user_department()));

-- -----------------------------------------------------------------
-- patients — the core privacy rule: a nurse only sees/edits a
-- patient currently assigned to them; the head nurse sees everyone
-- in the department.
-- -----------------------------------------------------------------
create policy patients_select on patients for select
  using (is_head_nurse() or is_my_patient(id));

create policy patients_update_head_nurse on patients for update
  using (is_head_nurse()) with check (is_head_nurse());

create policy patients_update_own on patients for update
  using (is_my_patient(id)) with check (is_my_patient(id));

-- Column guard: a nurse editing "their" patient may only change
-- `condition` and `notes` — not name, diagnosis, procedure, severity,
-- or isolation type.
create or replace function enforce_patient_update_columns()
returns trigger language plpgsql security definer as $$
begin
  if coalesce(current_setting('app.bypass_self_guard', true), '') = 'on' then
    return new;
  end if;
  if not is_head_nurse() and is_my_patient(old.id) then
    if new.full_name <> old.full_name
       or new.diagnosis <> old.diagnosis
       or coalesce(new.procedure_name,'') <> coalesce(old.procedure_name,'')
       or new.severity <> old.severity
       or coalesce(new.isolation_type,'') <> coalesce(old.isolation_type,'') then
      raise exception 'Nurses may only update condition and notes.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_patients_nurse_update
  before update on patients
  for each row execute function enforce_patient_update_columns();

-- No delete policy on patients — discharge sets discharged_at, it
-- never removes the record.

-- -----------------------------------------------------------------
-- bed_assignments
-- -----------------------------------------------------------------
create policy assignments_select_head_nurse on bed_assignments for select
  using (
    is_head_nurse()
    and bed_id in (
      select b.id from beds b join rooms r on r.id = b.room_id
      where r.department_id = current_user_department()
    )
  );

create policy assignments_select_own on bed_assignments for select
  using (nurse_id = auth.uid());

-- Direct writes are restricted to the head nurse as defense-in-depth;
-- normal flow goes through the RPC functions below, which are the
-- only place a bed changes status AND its assignment AND the patient
-- record together, atomically.
create policy assignments_write on bed_assignments for all
  using (is_head_nurse()) with check (is_head_nurse());

-- -----------------------------------------------------------------
-- audit_log — head nurse reads, nobody writes directly (only the
-- SECURITY DEFINER functions insert rows).
-- -----------------------------------------------------------------
create policy audit_select on audit_log for select
  using (is_head_nurse() and user_id in (select id from users where department_id = current_user_department()));

-- =================================================================
-- Onboarding RPCs
-- =================================================================

-- First-time setup: the caller creates a brand-new department and
-- becomes its head nurse. Only works if they don't already belong
-- to one.
create or replace function create_department(p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_dept_id uuid;
begin
  if (select department_id from users where id = auth.uid()) is not null then
    raise exception 'You already belong to a department.';
  end if;

  insert into departments (name) values (p_name) returning id into v_dept_id;

  perform set_config('app.bypass_self_guard', 'on', true);
  update users set department_id = v_dept_id, role = 'head_nurse', status = 'on'
  where id = auth.uid();

  return v_dept_id;
end;
$$;

-- A nurse enters the join code their head nurse shared with them
-- (shown in the app's Settings tab) to attach their own account to
-- that department.
create or replace function join_department(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_dept_id uuid;
begin
  select id into v_dept_id from departments where join_code = lower(p_code);
  if v_dept_id is null then
    raise exception 'Invalid join code.';
  end if;

  perform set_config('app.bypass_self_guard', 'on', true);
  update users set department_id = v_dept_id where id = auth.uid();

  return v_dept_id;
end;
$$;

-- =================================================================
-- Clinical action RPCs — atomic, audited, head-nurse-only
-- =================================================================

create or replace function admit_patient(
  p_bed_id uuid, p_full_name text, p_diagnosis text, p_procedure_name text,
  p_severity text, p_isolation_type text, p_nurse_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_patient_id uuid;
begin
  if not is_head_nurse() then raise exception 'Only the head nurse can admit patients.'; end if;

  insert into patients (full_name, diagnosis, procedure_name, severity, isolation_type, condition)
  values (p_full_name, p_diagnosis, p_procedure_name, p_severity, p_isolation_type, 'Stable')
  returning id into v_patient_id;

  update beds set status = 'occupied' where id = p_bed_id;

  insert into bed_assignments (bed_id, patient_id, nurse_id, assigned_at)
  values (p_bed_id, v_patient_id, p_nurse_id, now());

  insert into audit_log (user_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'admit_patient', 'patient', v_patient_id,
          jsonb_build_object('bed_id', p_bed_id, 'nurse_id', p_nurse_id));

  return v_patient_id;
end;
$$;

create or replace function discharge_patient(p_bed_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_patient_id uuid;
begin
  if not is_head_nurse() then raise exception 'Only the head nurse can discharge patients.'; end if;

  select patient_id into v_patient_id from bed_assignments
  where bed_id = p_bed_id and unassigned_at is null;

  update bed_assignments set unassigned_at = now()
  where bed_id = p_bed_id and unassigned_at is null;

  update patients set discharged_at = now() where id = v_patient_id;
  update beds set status = 'empty' where id = p_bed_id;

  insert into audit_log (user_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'discharge_patient', 'patient', v_patient_id, jsonb_build_object('bed_id', p_bed_id));
end;
$$;

create or replace function reassign_bed(p_bed_id uuid, p_new_nurse_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_patient_id uuid;
begin
  if not is_head_nurse() then raise exception 'Only the head nurse can reassign patients.'; end if;

  select patient_id into v_patient_id from bed_assignments
  where bed_id = p_bed_id and unassigned_at is null;

  update bed_assignments set unassigned_at = now()
  where bed_id = p_bed_id and unassigned_at is null;

  insert into bed_assignments (bed_id, patient_id, nurse_id, assigned_at)
  values (p_bed_id, v_patient_id, p_new_nurse_id, now());

  insert into audit_log (user_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'reassign_bed', 'bed_assignment', p_bed_id,
          jsonb_build_object('patient_id', v_patient_id, 'new_nurse_id', p_new_nurse_id));
end;
$$;

-- Head nurse removes a nurse from the department. Setting
-- department_id to null would otherwise fail the ordinary
-- users_update_head_nurse WITH CHECK (which requires the row to
-- still belong to the department after the update), so this goes
-- through the same bypass-flag pattern as onboarding.
create or replace function remove_nurse_from_department(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_head_nurse() then raise exception 'Only the head nurse can remove staff.'; end if;
  if exists (
    select 1 from bed_assignments
    where nurse_id = p_user_id and unassigned_at is null
  ) then
    raise exception 'This nurse still has assigned patients — reassign them first.';
  end if;

  perform set_config('app.bypass_self_guard', 'on', true);
  update users set department_id = null, status = 'off'
  where id = p_user_id and department_id = current_user_department();

  insert into audit_log (user_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'remove_nurse', 'user', p_user_id, '{}'::jsonb);
end;
$$;
