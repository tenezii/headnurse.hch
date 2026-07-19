-- =================================================================
-- Schema — Nurse & Bed Management System
-- Run this FIRST, before policies.sql, in the Supabase SQL Editor.
-- =================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------
-- departments
-- join_code is what a nurse types in to attach their own account to
-- this department after signing up (see policies.sql: join_department).
-- -----------------------------------------------------------------
create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 6),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------
-- users — profile row for every login, one-to-one with auth.users.
-- New rows appear automatically via the trigger below whenever
-- someone signs up through Supabase Auth.
-- -----------------------------------------------------------------
create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  department_id uuid references departments (id),
  full_name text not null default '',
  email text,
  role text not null default 'nurse' check (role in ('head_nurse', 'nurse')),
  status text not null default 'off' check (status in ('on', 'off')),
  max_patients int not null default 4,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a `users` profile row whenever someone signs up.
-- They start with no department — they either create one (becoming
-- head_nurse) or join one with a code (see policies.sql).
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email);
  return new;
end;
$$;

create trigger trg_new_auth_user
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- -----------------------------------------------------------------
-- rooms / beds
-- -----------------------------------------------------------------
create table rooms (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (department_id, name)
);

create table beds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  bed_number int not null,
  status text not null default 'empty' check (status in ('empty', 'occupied', 'reserved')),
  unique (room_id, bed_number)
);

-- -----------------------------------------------------------------
-- patients
-- -----------------------------------------------------------------
create table patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  diagnosis text not null default '',
  procedure_name text,
  severity text not null default 'low' check (severity in ('low', 'moderate', 'high')),
  isolation_type text check (isolation_type in ('Contact', 'Droplet', 'Airborne')),
  condition text not null default 'Stable',
  notes text not null default '',
  admitted_at timestamptz not null default now(),
  discharged_at timestamptz
);

-- -----------------------------------------------------------------
-- bed_assignments — append-only history.
-- The CURRENT assignment for a bed is the row with unassigned_at IS NULL.
-- -----------------------------------------------------------------
create table bed_assignments (
  id uuid primary key default gen_random_uuid(),
  bed_id uuid not null references beds (id) on delete cascade,
  patient_id uuid not null references patients (id) on delete cascade,
  nurse_id uuid references users (id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz
);

create unique index one_active_assignment_per_bed
  on bed_assignments (bed_id)
  where (unassigned_at is null);

-- -----------------------------------------------------------------
-- audit_log
-- -----------------------------------------------------------------
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id),
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
