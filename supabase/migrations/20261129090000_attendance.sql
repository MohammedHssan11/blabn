-- Phases 13 and 14: camera attendance.
--   * attendance employees with a stable, generated employee ID;
--   * kiosk devices (an Attendance Kiosk staff account registered for one branch);
--   * face-enrollment sessions and encrypted face references (private schema);
--   * verification attempts, append-only attendance events and append-only corrections;
--   * the readers behind the attendance screens and the attendance Excel export.
--
-- Trust model (full description: docs/phase13_14/ATTENDANCE.md)
--   * The kiosk browser is untrusted. It never tells this database that a face matched or that the
--     live challenge was performed.
--   * The isolated attendance verifier (services/attendance-verifier) decides and signs its verdict
--     with HMAC-SHA256 over the facts this database issued for the attempt: attempt id, random nonce,
--     employee, face reference, action, random challenge, outcome, engine, time and key id. The same
--     key is stored in app_private.attendance_signing_keys (written by the operator, never by a
--     migration). A success whose signature does not verify is refused, so neither the kiosk session
--     nor the web server can create an attendance event on its own.
--   * Each attempt is bound to one employee, branch, device, action, challenge and nonce, expires
--     after 90 seconds and completes once. Completion locks the attempt row and the employee, so a
--     repeated or concurrent request returns the first result and never creates a second event.
--   * Face references are encrypted by the verifier (AES-256-GCM; the key is held only by the
--     verifier) and stored in app_private, which the Data API does not expose. The only API path to a
--     reference is the kiosk command that returns the ciphertext of its own pending attempt's
--     reference, which the web server forwards to the verifier.
--   * Every command reads the live device, employee, branch and permission state. A deactivated
--     device or employee is refused on the very next request.
--   * Times are the database's now(). Durations are computed from instants, so a shift crossing
--     midnight or a clock change is exact.
--
-- Nothing here holds a secret, an image, a template or real personal data.

-- ------------------------------------------------------------------ permissions
-- Abdo (System Admin) holds them all. No other group receives them until the owner decides.

insert into public.permissions (key, description, scope, branch_kind) values
  ('attendance.view',             'View attendance records, worked time, exceptions and verification attempts of a branch (Phase 14)', 'branch', 'operational'),
  ('attendance.employees.manage', 'Register attendance employees, generate their employee ID and activate or deactivate them (Phase 13)', 'branch', 'operational'),
  ('attendance.enroll',           'Enroll, re-enroll and delete the face reference of an employee (Phase 13)', 'branch', 'operational'),
  ('attendance.devices.manage',   'Register, activate and deactivate attendance kiosk devices (Phase 13)', 'branch', 'operational'),
  ('attendance.correct',          'Correct attendance events with a reason (Phase 14)', 'branch', 'operational'),
  ('attendance.export',           'Download the attendance Excel report; separate from financial report exports (Phase 14)', 'branch', 'operational');

insert into public.group_permissions (group_key, permission_key) values
  ('system_admin', 'attendance.view'),
  ('system_admin', 'attendance.employees.manage'),
  ('system_admin', 'attendance.enroll'),
  ('system_admin', 'attendance.devices.manage'),
  ('system_admin', 'attendance.correct'),
  ('system_admin', 'attendance.export');

update public.permission_groups
set description = 'Attendance Kiosk: a branch device that records verified check-ins and check-outs for its own branch only'
where key = 'attendance_kiosk';

-- ------------------------------------------------------------------ private configuration

-- HMAC keys shared with the attendance verifier. Inserted by the operator with psql; never by a
-- migration, a seed or the application. No API role can read or write this table.
create table app_private.attendance_signing_keys (
  key_id text primary key check (key_id ~ '^[A-Za-z0-9_.-]{1,64}$'),
  secret bytea not null check (octet_length(secret) >= 32),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
alter table app_private.attendance_signing_keys enable row level security;

-- One row. The synthetic test engine of the verifier is refused unless a disposable test database
-- switches this on. Production keeps the default (false).
create table app_private.attendance_config (
  singleton boolean primary key default true check (singleton),
  allow_synthetic_engine boolean not null default false
);
insert into app_private.attendance_config (singleton) values (true);
alter table app_private.attendance_config enable row level security;

-- ------------------------------------------------------------------ attendance employees

create table public.attendance_employees (
  employee_id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  is_active boolean not null default true,
  deactivated_at timestamptz,
  deactivation_reason text,
  created_request uuid not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (employee_id, organization_id) references public.employees (id, organization_id),
  unique (organization_id, created_request),
  constraint attendance_employee_inactive_has_time check (is_active or deactivated_at is not null),
  constraint attendance_employee_active_has_no_time check (not is_active or (deactivated_at is null and deactivation_reason is null))
);

create index attendance_employees_branch_idx on public.attendance_employees (branch_id);

create trigger attendance_employees_updated_at
  before update on public.attendance_employees
  for each row execute function public.set_updated_at();

create function app_private.check_attendance_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
begin
  select organization_id, operates_in_app into b from public.branches where id = new.branch_id;
  if b.organization_id is distinct from new.organization_id then
    raise exception 'branch belongs to another organization' using errcode = '23514';
  end if;
  if not coalesce(b.operates_in_app, false) then
    raise exception 'attendance runs only at an operating branch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger attendance_employees_branch_check
  before insert or update of branch_id, organization_id on public.attendance_employees
  for each row execute function app_private.check_attendance_branch();

-- The employee ID is stable: once a person is registered for attendance, nobody can change or
-- clear their number (the kiosk, the history and the Excel report all group by it).
create function app_private.keep_attendance_employee_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.employee_number is distinct from old.employee_number
     and exists (select 1 from public.attendance_employees a where a.employee_id = old.id) then
    raise exception 'employee_number_locked' using errcode = '23514',
      detail = 'The employee ID of a person registered for attendance cannot change.';
  end if;
  return new;
end;
$$;

create trigger employees_keep_attendance_number
  before update of employee_number on public.employees
  for each row execute function app_private.keep_attendance_employee_number();

-- ------------------------------------------------------------------ devices

create table public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  -- The kiosk's sign-in: a staff account that holds only the Attendance Kiosk group at this branch.
  user_id uuid not null unique references public.staff_accounts (user_id),
  label text not null check (length(btrim(label)) between 1 and 80),
  is_active boolean not null default true,
  deactivated_at timestamptz,
  deactivation_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_device_inactive_has_time check (is_active or deactivated_at is not null),
  constraint attendance_device_active_has_no_time check (not is_active or (deactivated_at is null and deactivation_reason is null))
);

create trigger attendance_devices_updated_at
  before update on public.attendance_devices
  for each row execute function public.set_updated_at();

create trigger attendance_devices_branch_check
  before insert or update of branch_id, organization_id on public.attendance_devices
  for each row execute function app_private.check_attendance_branch();

-- ------------------------------------------------------------------ face references (private)

create table app_private.attendance_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  employee_id uuid not null references public.employees (id),
  nonce bytea not null check (octet_length(nonce) = 16),
  started_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  reason text check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  completed_at timestamptz,
  constraint enrollment_closed_has_time check ((status = 'pending') = (completed_at is null))
);
alter table app_private.attendance_enrollments enable row level security;

create table app_private.attendance_face_references (
  -- The id of the enrollment session that produced the reference. It is also bound into the
  -- verifier's encryption (associated data), so a ciphertext moved to another row cannot decrypt.
  id uuid primary key references app_private.attendance_enrollments (id),
  organization_id uuid not null references public.organizations (id),
  employee_id uuid not null references public.employees (id),
  status text not null check (status in ('active', 'replaced', 'deleted')),
  -- AES-256-GCM ciphertext made by the verifier. Cleared when the reference is replaced or deleted.
  ciphertext bytea check (ciphertext is null or octet_length(ciphertext) between 32 and 65536),
  ciphertext_sha256 bytea not null check (octet_length(ciphertext_sha256) = 32),
  engine text not null check (engine ~ '^[a-z0-9_.:-]{1,80}$'),
  -- Aggregate capture quality (numbers only). Never an embedding, image or landmark list.
  quality jsonb not null default '{}'::jsonb,
  identity_document text not null check (identity_document in ('national_id', 'passport', 'residence_permit', 'other')),
  consent_recorded boolean not null check (consent_recorded),
  enrolled_by uuid not null,
  enrolled_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid,
  end_reason text,
  constraint reference_active_has_ciphertext check ((status = 'active') = (ciphertext is not null)),
  constraint reference_ended_has_time check ((status = 'active') = (ended_at is null)),
  constraint reference_quality_is_flat check (
    jsonb_typeof(quality) = 'object' and length(quality::text) <= 2000 and quality::text !~ '\['
  )
);
alter table app_private.attendance_face_references enable row level security;

create unique index attendance_face_references_one_active
  on app_private.attendance_face_references (employee_id) where status = 'active';

-- ------------------------------------------------------------------ attempts, events, corrections

create table public.attendance_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  device_id uuid not null references public.attendance_devices (id),
  -- Written by the kiosk page when the employee presses the button: a retry is the same attempt.
  request_key uuid not null,
  entered_code text not null check (length(entered_code) between 1 and 40),
  employee_id uuid references public.employees (id),
  action text not null check (action in ('check_in', 'check_out')),
  challenge text[] check (challenge is null or (cardinality(challenge) between 1 and 4
    and challenge <@ array['left', 'right', 'up']::text[])),
  nonce bytea check (nonce is null or octet_length(nonce) = 16),
  reference_id uuid,
  status text not null check (status in ('pending', 'succeeded', 'failed', 'refused', 'superseded')),
  reason text check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  completed_at timestamptz,
  -- Aggregate verification metrics (scores, counts, timings, engine). Never images or embeddings.
  verification jsonb not null default '{}'::jsonb check (
    jsonb_typeof(verification) = 'object' and length(verification::text) <= 4000
  ),
  event_id uuid unique,
  unique (device_id, request_key),
  constraint attempt_pending_is_bound check (
    status <> 'pending' or (employee_id is not null and challenge is not null and nonce is not null
                            and reference_id is not null and expires_at is not null)),
  constraint attempt_success_has_event check ((status = 'succeeded') = (event_id is not null))
);

create index attendance_attempts_branch_time_idx on public.attendance_attempts (branch_id, created_at);
create index attendance_attempts_employee_time_idx on public.attendance_attempts (employee_id, created_at);

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  employee_id uuid not null references public.employees (id),
  request_key uuid not null,
  kind text not null check (kind in ('add', 'void', 'retime')),
  -- The event a void or retime replaces (one correction per event; the original row stays).
  target_event_id uuid,
  -- For add and retime: the corrected event's kind and instant.
  event_kind text check (event_kind is null or event_kind in ('check_in', 'check_out')),
  occurred_at timestamptz,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  corrected_by uuid not null,
  corrected_by_name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, request_key),
  constraint correction_shape check (
       (kind = 'add'    and target_event_id is null     and event_kind is not null and occurred_at is not null)
    or (kind = 'void'   and target_event_id is not null and event_kind is null     and occurred_at is null)
    or (kind = 'retime' and target_event_id is not null and event_kind is not null and occurred_at is not null))
);

create unique index attendance_corrections_one_per_target
  on public.attendance_corrections (target_event_id) where target_event_id is not null;
create index attendance_corrections_employee_idx on public.attendance_corrections (employee_id, created_at);

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  employee_id uuid not null references public.employees (id),
  kind text not null check (kind in ('check_in', 'check_out')),
  -- The actual instant: the database clock when the kiosk event was recorded, or the corrected time.
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source text not null check (source in ('kiosk', 'correction')),
  device_id uuid references public.attendance_devices (id),
  attempt_id uuid unique references public.attendance_attempts (id),
  correction_id uuid unique references public.attendance_corrections (id),
  constraint event_source_shape check (
       (source = 'kiosk' and attempt_id is not null and device_id is not null and correction_id is null)
    or (source = 'correction' and correction_id is not null and attempt_id is null and device_id is null)),
  constraint event_not_in_future check (occurred_at <= recorded_at)
);

create index attendance_events_employee_time_idx on public.attendance_events (employee_id, occurred_at);
create index attendance_events_branch_time_idx on public.attendance_events (branch_id, occurred_at);

alter table public.attendance_corrections
  add constraint attendance_corrections_target_fk foreign key (target_event_id) references public.attendance_events (id);
alter table public.attendance_attempts
  add constraint attendance_attempts_event_fk foreign key (event_id) references public.attendance_events (id);

-- Events and corrections are append-only for every role. An attempt changes once: from pending to
-- its outcome. Nothing is ever deleted.
create function app_private.refuse_attendance_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'attendance history is append-only (% on % refused)', tg_op, tg_table_name
    using errcode = '42501';
end;
$$;

create trigger attendance_events_append_only before update or delete on public.attendance_events
  for each row execute function app_private.refuse_attendance_change();
create trigger attendance_events_no_truncate before truncate on public.attendance_events
  for each statement execute function app_private.refuse_attendance_change();
create trigger attendance_corrections_append_only before update or delete on public.attendance_corrections
  for each row execute function app_private.refuse_attendance_change();
create trigger attendance_corrections_no_truncate before truncate on public.attendance_corrections
  for each statement execute function app_private.refuse_attendance_change();
create trigger attendance_attempts_no_delete before delete on public.attendance_attempts
  for each row execute function app_private.refuse_attendance_change();
create trigger attendance_attempts_no_truncate before truncate on public.attendance_attempts
  for each statement execute function app_private.refuse_attendance_change();

create function app_private.attendance_attempt_settles_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception 'attendance attempt % is already settled (%)', old.id, old.status using errcode = '42501';
  end if;
  if new.id <> old.id or new.organization_id <> old.organization_id or new.branch_id <> old.branch_id
     or new.device_id <> old.device_id or new.request_key <> old.request_key
     or new.employee_id is distinct from old.employee_id or new.action <> old.action
     or new.challenge is distinct from old.challenge or new.nonce is distinct from old.nonce
     or new.reference_id is distinct from old.reference_id or new.created_at <> old.created_at
     or new.expires_at is distinct from old.expires_at or new.entered_code <> old.entered_code then
    raise exception 'the binding of an attendance attempt cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger attendance_attempts_settle_once before update on public.attendance_attempts
  for each row execute function app_private.attendance_attempt_settles_once();

-- ------------------------------------------------------------------ helpers

create function app_private.attendance_lock_employee(p_employee uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('balaban.attendance.employee.' || p_employee::text, 0));
$$;

create function app_private.attendance_local(p_instant timestamptz, p_tz text)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_instant at time zone p_tz, 'YYYY-MM-DD"T"HH24:MI:SS');
$$;

-- The employee's latest event that no correction replaced.
create function app_private.attendance_last_event(p_employee uuid)
returns table (event_id uuid, kind text, occurred_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.kind, e.occurred_at
  from public.attendance_events e
  where e.employee_id = p_employee
    and not exists (select 1 from public.attendance_corrections c where c.target_event_id = e.id)
  order by e.occurred_at desc, e.recorded_at desc
  limit 1;
$$;

create function app_private.attendance_branch(p_code text)
returns public.branches
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.branches;
begin
  select * into b from public.branches
  where code = p_code and organization_id = app_private.current_org();
  if not found then
    raise exception 'branch_not_found' using errcode = '42501';
  end if;
  return b;
end;
$$;

create function app_private.attendance_require(p_permission text, p_branch uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_branch is null or not app_private.has_permission(p_permission, p_branch) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
end;
$$;

-- Why the signed-in account cannot act as a kiosk right now, or NULL when it can.
create function app_private.kiosk_problem(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.attendance_devices;
begin
  if p_user is null then return 'not_signed_in'; end if;
  select * into d from public.attendance_devices where user_id = p_user;
  if not found then return 'not_a_device'; end if;
  if not d.is_active then return 'device_inactive'; end if;
  if app_private.current_staff_id() is distinct from p_user then return 'account_inactive'; end if;
  if not app_private.has_permission('attendance.event.create', d.branch_id) then return 'not_authorized'; end if;
  -- Least privilege: a kiosk account that holds anything else is refused until it is fixed.
  if exists (select 1 from app_private.effective_permissions() e where e.permission_key <> 'attendance.event.create')
     or exists (select 1 from app_private.effective_permissions() e where e.branch_id is distinct from d.branch_id) then
    return 'device_overprivileged';
  end if;
  return null;
end;
$$;

create function app_private.kiosk_device()
returns public.attendance_devices
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  problem text := app_private.kiosk_problem(auth.uid());
  d public.attendance_devices;
begin
  if problem is not null then
    raise exception '%', problem using errcode = '42501';
  end if;
  select * into d from public.attendance_devices where user_id = auth.uid();
  return d;
end;
$$;

-- HMAC-SHA256 (hex) of a canonical string with an active signing key, or NULL without one.
create function app_private.attendance_hmac(p_key_id text, p_message text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.hmac(convert_to(p_message, 'UTF8'), k.secret, 'sha256'), 'hex')
  from app_private.attendance_signing_keys k
  where k.key_id = p_key_id and k.retired_at is null;
$$;

create function app_private.attendance_engine_allowed(p_engine text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_engine ~ '^[a-z0-9_.:-]{1,80}$'
     and (p_engine not like 'synthetic%' or (select allow_synthetic_engine from app_private.attendance_config));
$$;

-- Issue time of a verifier verdict, from epoch milliseconds; NULL when unreadable.
create function app_private.attendance_issued_at(p_result jsonb)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(p_result->>'issued_at_ms', '') !~ '^\d{10,16}$' then return null; end if;
  return to_timestamp((p_result->>'issued_at_ms')::numeric / 1000);
end;
$$;

-- Keeps only flat numeric/boolean/short-text metrics from the verifier: no arrays, nothing nested.
create function app_private.attendance_metrics(p_metrics jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(m.key, m.value), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p_metrics) = 'object' then p_metrics else '{}'::jsonb end) m
  where m.key ~ '^[a-z0-9_]{1,40}$'
    and (jsonb_typeof(m.value) in ('number', 'boolean')
         or (jsonb_typeof(m.value) = 'string' and length(m.value #>> '{}') <= 80));
$$;

-- Next free numeric employee ID of the organization (from 1001). Caller holds the code lock.
create function app_private.attendance_next_code(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select (greatest(1000, coalesce(max(e.employee_number::bigint), 0)) + 1)::text
  from public.employees e
  where e.organization_id = p_org and e.employee_number ~ '^\d{1,12}$';
$$;

-- ------------------------------------------------------------------ employees: commands

create function public.app_attendance_employee_create(p_branch_code text, p_full_name text, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.branches := app_private.attendance_branch(p_branch_code);
  v_name text := btrim(coalesce(p_full_name, ''));
  v_existing public.attendance_employees;
  v_employee uuid;
  v_code text;
begin
  perform app_private.attendance_require('attendance.employees.manage', b.id);
  if p_request is null then raise exception 'request_required' using errcode = '22023'; end if;
  if length(v_name) not between 2 and 120 then raise exception 'invalid_name' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('balaban.attendance.codes.' || b.organization_id::text, 0));

  select * into v_existing from public.attendance_employees
  where organization_id = b.organization_id and created_request = p_request;
  if found then
    select employee_number into v_code from public.employees where id = v_existing.employee_id;
    return jsonb_build_object('employee_id', v_existing.employee_id, 'employee_code', v_code, 'replayed', true);
  end if;

  v_code := app_private.attendance_next_code(b.organization_id);
  insert into public.employees (organization_id, full_name, employee_number)
  values (b.organization_id, v_name, v_code)
  returning id into v_employee;
  insert into public.attendance_employees (employee_id, organization_id, branch_id, created_request, created_by)
  values (v_employee, b.organization_id, b.id, p_request, auth.uid());

  perform app_private.write_audit(b.organization_id, 'administration', 'attendance.employee_created', 'employee',
    v_employee::text, v_name, b.id, jsonb_build_object('employee_code', v_code, 'full_name', v_name));
  return jsonb_build_object('employee_id', v_employee, 'employee_code', v_code, 'replayed', false);
end;
$$;

-- Registers a person who already exists (for example a staff member). Keeps an existing number.
create function public.app_attendance_employee_register(p_employee uuid, p_branch_code text, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.branches := app_private.attendance_branch(p_branch_code);
  e public.employees;
  v_existing public.attendance_employees;
  v_code text;
begin
  perform app_private.attendance_require('attendance.employees.manage', b.id);
  if p_request is null then raise exception 'request_required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('balaban.attendance.codes.' || b.organization_id::text, 0));

  select * into v_existing from public.attendance_employees
  where organization_id = b.organization_id and (created_request = p_request or employee_id = p_employee);
  if found then
    if v_existing.created_request = p_request then
      select employee_number into v_code from public.employees where id = v_existing.employee_id;
      return jsonb_build_object('employee_id', v_existing.employee_id, 'employee_code', v_code, 'replayed', true);
    end if;
    raise exception 'already_registered' using errcode = '23505';
  end if;

  select * into e from public.employees where id = p_employee and organization_id = b.organization_id for update;
  if not found then raise exception 'employee_not_found' using errcode = '42501'; end if;
  if not e.is_active then raise exception 'employee_inactive' using errcode = '22023'; end if;
  if exists (select 1 from public.attendance_devices d where d.user_id in
             (select s.user_id from public.staff_accounts s where s.employee_id = e.id)) then
    raise exception 'device_account' using errcode = '22023';
  end if;

  v_code := e.employee_number;
  if v_code is null then
    v_code := app_private.attendance_next_code(b.organization_id);
    update public.employees set employee_number = v_code where id = e.id;
  end if;
  insert into public.attendance_employees (employee_id, organization_id, branch_id, created_request, created_by)
  values (e.id, b.organization_id, b.id, p_request, auth.uid());

  perform app_private.write_audit(b.organization_id, 'administration', 'attendance.employee_registered', 'employee',
    e.id::text, e.full_name, b.id, jsonb_build_object('employee_code', v_code));
  return jsonb_build_object('employee_id', e.id, 'employee_code', v_code, 'replayed', false);
end;
$$;

-- Renames an attendance-only person. A staff member's name is changed on the staff page.
create function public.app_attendance_employee_rename(p_employee uuid, p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.attendance_employees;
  v_old text;
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  select * into a from public.attendance_employees where employee_id = p_employee;
  if not found then raise exception 'employee_not_found' using errcode = '42501'; end if;
  perform app_private.attendance_require('attendance.employees.manage', a.branch_id);
  if length(v_name) not between 2 and 120 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if exists (select 1 from public.staff_accounts s where s.employee_id = p_employee) then
    raise exception 'staff_name_managed_elsewhere' using errcode = '22023';
  end if;
  select full_name into v_old from public.employees where id = p_employee for update;
  if v_old = v_name then return; end if;
  update public.employees set full_name = v_name where id = p_employee;
  perform app_private.write_audit(a.organization_id, 'administration', 'attendance.employee_renamed', 'employee',
    p_employee::text, v_name, a.branch_id, jsonb_build_object('before', jsonb_build_object('full_name', v_old),
      'after', jsonb_build_object('full_name', v_name)));
end;
$$;

create function public.app_attendance_employee_set_active(p_employee uuid, p_active boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.attendance_employees;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into a from public.attendance_employees where employee_id = p_employee for update;
  if not found then raise exception 'employee_not_found' using errcode = '42501'; end if;
  perform app_private.attendance_require('attendance.employees.manage', a.branch_id);
  if p_active is null then raise exception 'invalid_state' using errcode = '22023'; end if;
  if not p_active and (v_reason is null or length(v_reason) < 3) then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if a.is_active = p_active then return; end if;
  update public.attendance_employees
  set is_active = p_active,
      deactivated_at = case when p_active then null else now() end,
      deactivation_reason = case when p_active then null else v_reason end
  where employee_id = p_employee;
  perform app_private.write_audit(a.organization_id, 'administration',
    case when p_active then 'attendance.employee_activated' else 'attendance.employee_deactivated' end,
    'employee', p_employee::text, (select full_name from public.employees where id = p_employee), a.branch_id,
    jsonb_build_object('reason', v_reason));
end;
$$;

-- ------------------------------------------------------------------ devices: commands

-- Staff accounts that may become a kiosk of the branch: active, holding exactly one group
-- assignment (Attendance Kiosk at this branch), not yet a device and not an attendance employee.
create function public.app_attendance_device_candidates(p_branch_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.branches := app_private.attendance_branch(p_branch_code);
begin
  perform app_private.attendance_require('attendance.devices.manage', b.id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'full_name', e.full_name, 'email', s.email)
                              order by e.full_name), '[]'::jsonb)
    from public.staff_accounts s
    join public.employees e on e.id = s.employee_id
    where s.organization_id = b.organization_id and s.is_active and e.is_active
      and not exists (select 1 from public.attendance_devices d where d.user_id = s.user_id)
      and not exists (select 1 from public.attendance_employees a where a.employee_id = e.id)
      and exists (select 1 from public.staff_group_assignments g
                  where g.staff_id = s.user_id and g.group_key = 'attendance_kiosk' and g.branch_id = b.id)
      and not exists (select 1 from public.staff_group_assignments g
                      where g.staff_id = s.user_id and (g.group_key <> 'attendance_kiosk' or g.branch_id is distinct from b.id))
  );
end;
$$;

create function public.app_attendance_device_register(p_branch_code text, p_user uuid, p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.branches := app_private.attendance_branch(p_branch_code);
  v_label text := btrim(coalesce(p_label, ''));
  v_id uuid;
begin
  perform app_private.attendance_require('attendance.devices.manage', b.id);
  if length(v_label) not between 1 and 80 then raise exception 'invalid_label' using errcode = '22023'; end if;
  if not exists (select 1 from jsonb_array_elements(public.app_attendance_device_candidates(p_branch_code)) c
                 where (c->>'user_id')::uuid = p_user) then
    raise exception 'device_account_not_eligible' using errcode = '22023';
  end if;
  insert into public.attendance_devices (organization_id, branch_id, user_id, label, created_by)
  values (b.organization_id, b.id, p_user, v_label, auth.uid())
  returning id into v_id;
  perform app_private.write_audit(b.organization_id, 'administration', 'attendance.device_registered', 'attendance_device',
    v_id::text, v_label, b.id, jsonb_build_object('label', v_label, 'account', p_user));
  return v_id;
end;
$$;

create function public.app_attendance_device_set_active(p_device uuid, p_active boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.attendance_devices;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into d from public.attendance_devices where id = p_device for update;
  if not found then raise exception 'device_not_found' using errcode = '42501'; end if;
  perform app_private.attendance_require('attendance.devices.manage', d.branch_id);
  if p_active is null then raise exception 'invalid_state' using errcode = '22023'; end if;
  if not p_active and (v_reason is null or length(v_reason) < 3) then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if d.is_active = p_active then return; end if;
  update public.attendance_devices
  set is_active = p_active,
      deactivated_at = case when p_active then null else now() end,
      deactivation_reason = case when p_active then null else v_reason end
  where id = p_device;
  -- A device switched off mid-attempt cannot finish it.
  if not p_active then
    update public.attendance_attempts set status = 'failed', reason = 'device_inactive', completed_at = now()
    where device_id = p_device and status = 'pending';
  end if;
  perform app_private.write_audit(d.organization_id, 'administration',
    case when p_active then 'attendance.device_activated' else 'attendance.device_deactivated' end,
    'attendance_device', p_device::text, d.label, d.branch_id, jsonb_build_object('reason', v_reason));
end;
$$;

-- ------------------------------------------------------------------ enrollment

create function public.app_attendance_enrollment_start(p_employee uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.attendance_employees;
  v_id uuid;
  v_nonce bytea := extensions.gen_random_bytes(16);
  v_expires timestamptz := now() + interval '10 minutes';
begin
  select * into a from public.attendance_employees where employee_id = p_employee;
  if not found then raise exception 'employee_not_found' using errcode = '42501'; end if;
  perform app_private.attendance_require('attendance.enroll', a.branch_id);
  if not a.is_active or not (select is_active from public.employees where id = p_employee) then
    raise exception 'employee_inactive' using errcode = '22023';
  end if;
  insert into app_private.attendance_enrollments (organization_id, branch_id, employee_id, nonce, started_by, expires_at)
  values (a.organization_id, a.branch_id, p_employee, v_nonce, auth.uid(), v_expires)
  returning id into v_id;
  return jsonb_build_object('enrollment_id', v_id, 'employee_id', p_employee, 'nonce', encode(v_nonce, 'hex'),
                            'expires_at', v_expires);
end;
$$;

create function public.app_attendance_enrollment_complete(
  p_enrollment uuid,
  p_ciphertext text,
  p_result jsonb,
  p_signature text,
  p_identity_document text,
  p_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s app_private.attendance_enrollments;
  v_cipher bytea;
  v_sha bytea;
  v_engine text := p_result->>'engine';
  v_key text := p_result->>'key_id';
  v_issued timestamptz := app_private.attendance_issued_at(p_result);
  v_expected text;
  v_previous uuid;
  v_name text;
begin
  select * into s from app_private.attendance_enrollments where id = p_enrollment for update;
  if not found then raise exception 'enrollment_not_found' using errcode = '42501'; end if;
  perform app_private.attendance_require('attendance.enroll', s.branch_id);
  if s.started_by <> auth.uid() then raise exception 'enrollment_not_found' using errcode = '42501'; end if;
  if s.status <> 'pending' then raise exception 'enrollment_closed' using errcode = '22023'; end if;
  if now() > s.expires_at then
    update app_private.attendance_enrollments set status = 'failed', reason = 'expired', completed_at = now() where id = s.id;
    return jsonb_build_object('status', 'failed', 'reason', 'expired');
  end if;
  if p_identity_document is null or p_identity_document not in ('national_id', 'passport', 'residence_permit', 'other') then
    raise exception 'identity_document_required' using errcode = '22023';
  end if;
  if p_consent is not true then raise exception 'consent_required' using errcode = '22023'; end if;
  if not (select a.is_active from public.attendance_employees a where a.employee_id = s.employee_id)
     or not (select e.is_active from public.employees e where e.id = s.employee_id) then
    raise exception 'employee_inactive' using errcode = '22023';
  end if;
  begin
    v_cipher := decode(coalesce(p_ciphertext, ''), 'base64');
  exception when others then
    raise exception 'invalid_reference' using errcode = '22023';
  end;
  if octet_length(v_cipher) not between 32 and 65536 then raise exception 'invalid_reference' using errcode = '22023'; end if;
  v_sha := extensions.digest(v_cipher, 'sha256');

  if coalesce(p_result->>'outcome', '') <> 'success' or v_issued is null
     or v_issued < s.created_at - interval '5 seconds' or v_issued > now() + interval '5 seconds'
     or not app_private.attendance_engine_allowed(coalesce(v_engine, '')) then
    raise exception 'invalid_verifier_result' using errcode = '22023';
  end if;
  v_expected := app_private.attendance_hmac(v_key, concat_ws('|', 'balaban-attendance', 'enroll', 'v1',
    s.id::text, encode(s.nonce, 'hex'), s.employee_id::text, encode(v_sha, 'hex'), 'success', v_engine,
    p_result->>'issued_at_ms', v_key));
  if v_expected is null or v_expected <> lower(coalesce(p_signature, '')) then
    update app_private.attendance_enrollments set status = 'failed', reason = 'invalid_verifier_signature', completed_at = now()
    where id = s.id;
    perform app_private.write_audit(s.organization_id, 'security', 'attendance.verifier_signature_refused', 'employee',
      s.employee_id::text, null, s.branch_id, jsonb_build_object('enrollment', s.id));
    return jsonb_build_object('status', 'failed', 'reason', 'invalid_verifier_signature');
  end if;

  perform app_private.attendance_lock_employee(s.employee_id);
  update app_private.attendance_face_references
  set status = 'replaced', ciphertext = null, ended_at = now(), ended_by = auth.uid(), end_reason = 're_enrolled'
  where employee_id = s.employee_id and status = 'active'
  returning id into v_previous;
  insert into app_private.attendance_face_references
    (id, organization_id, employee_id, status, ciphertext, ciphertext_sha256, engine, quality, identity_document,
     consent_recorded, enrolled_by)
  values (s.id, s.organization_id, s.employee_id, 'active', v_cipher, v_sha, v_engine,
          app_private.attendance_metrics(p_result->'quality'), p_identity_document, true, auth.uid());
  update app_private.attendance_enrollments set status = 'completed', completed_at = now() where id = s.id;
  -- Attempts that were bound to the replaced reference can no longer succeed.
  update public.attendance_attempts set status = 'superseded', reason = 'reference_replaced', completed_at = now()
  where employee_id = s.employee_id and status = 'pending';

  select full_name into v_name from public.employees where id = s.employee_id;
  perform app_private.write_audit(s.organization_id, 'security',
    case when v_previous is null then 'attendance.face_enrolled' else 'attendance.face_re_enrolled' end,
    'employee', s.employee_id::text, v_name, s.branch_id,
    jsonb_build_object('reference', s.id, 'replaced', v_previous, 'engine', v_engine,
                       'identity_document', p_identity_document, 'consent_recorded', true));
  return jsonb_build_object('status', 'completed', 'reference_id', s.id, 'replaced', v_previous);
end;
$$;

create function public.app_attendance_enrollment_fail(p_enrollment uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s app_private.attendance_enrollments;
begin
  select * into s from app_private.attendance_enrollments where id = p_enrollment for update;
  if not found then raise exception 'enrollment_not_found' using errcode = '42501'; end if;
  perform app_private.attendance_require('attendance.enroll', s.branch_id);
  if s.started_by <> auth.uid() then raise exception 'enrollment_not_found' using errcode = '42501'; end if;
  if s.status <> 'pending' then return; end if;
  update app_private.attendance_enrollments
  set status = 'failed', completed_at = now(),
      reason = case when coalesce(p_reason, '') ~ '^[a-z_]{1,40}$' then p_reason else 'failed' end
  where id = s.id;
end;
$$;

create function public.app_attendance_reference_delete(p_employee uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.attendance_employees;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ref uuid;
begin
  select * into a from public.attendance_employees where employee_id = p_employee;
  if not found then raise exception 'employee_not_found' using errcode = '42501'; end if;
  perform app_private.attendance_require('attendance.enroll', a.branch_id);
  if v_reason is null or length(v_reason) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  perform app_private.attendance_lock_employee(p_employee);
  update app_private.attendance_face_references
  set status = 'deleted', ciphertext = null, ended_at = now(), ended_by = auth.uid(), end_reason = v_reason
  where employee_id = p_employee and status = 'active'
  returning id into v_ref;
  if v_ref is null then return false; end if;
  update public.attendance_attempts set status = 'superseded', reason = 'reference_deleted', completed_at = now()
  where employee_id = p_employee and status = 'pending';
  perform app_private.write_audit(a.organization_id, 'security', 'attendance.face_reference_deleted', 'employee',
    p_employee::text, (select full_name from public.employees where id = p_employee), a.branch_id,
    jsonb_build_object('reference', v_ref, 'reason', v_reason));
  return true;
end;
$$;

-- ------------------------------------------------------------------ kiosk commands

create function public.app_attendance_kiosk_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  problem text := app_private.kiosk_problem(auth.uid());
  d public.attendance_devices;
  b public.branches;
begin
  if problem is not null then
    return jsonb_build_object('state', problem);
  end if;
  select * into d from public.attendance_devices where user_id = auth.uid();
  select * into b from public.branches where id = d.branch_id;
  return jsonb_build_object('state', 'ready', 'device_id', d.id, 'label', d.label, 'branch_code', b.code,
                            'branch_name_en', b.name_en, 'branch_name_ar', b.name_ar, 'timezone', b.timezone);
end;
$$;

-- Public view of an attempt for the kiosk (no nonce, no reference, no metrics).
create function app_private.attendance_attempt_view(p_attempt public.attendance_attempts)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.attendance_events;
  tz text := (select timezone from public.branches where id = p_attempt.branch_id);
  last_kind text;
  last_at timestamptz;
  v_status text := p_attempt.status;
begin
  if v_status = 'pending' and now() > p_attempt.expires_at then v_status := 'expired'; end if;
  if p_attempt.event_id is not null then
    select * into ev from public.attendance_events where id = p_attempt.event_id;
  end if;
  if p_attempt.employee_id is not null and p_attempt.reason in ('already_checked_in', 'not_checked_in', 'state_changed') then
    select l.kind, l.occurred_at into last_kind, last_at from app_private.attendance_last_event(p_attempt.employee_id) l;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'attempt_id', p_attempt.id,
    'status', v_status,
    'reason', p_attempt.reason,
    'action', p_attempt.action,
    'challenge', to_jsonb(case when v_status = 'pending' then p_attempt.challenge end),
    'expires_in_ms', case when v_status = 'pending'
                          then greatest(0, (extract(epoch from (p_attempt.expires_at - now())) * 1000)::bigint) end,
    'employee_first_name', case when v_status = 'succeeded'
                                then split_part((select full_name from public.employees where id = p_attempt.employee_id), ' ', 1) end,
    'event', case when ev.id is not null then jsonb_build_object(
               'kind', ev.kind, 'occurred_at', ev.occurred_at, 'local', app_private.attendance_local(ev.occurred_at, tz)) end,
    'current_state', case when last_kind is not null then jsonb_build_object(
               'kind', last_kind, 'local', app_private.attendance_local(last_at, tz)) end
  ));
end;
$$;

create function public.app_attendance_attempt_start(p_request uuid, p_employee_code text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.attendance_devices := app_private.kiosk_device();
  v_code text := btrim(coalesce(p_employee_code, ''));
  a public.attendance_attempts;
  emp record;
  last record;
  v_ref uuid;
  v_reason text;
  v_steps text[];
begin
  if p_request is null then raise exception 'request_required' using errcode = '22023'; end if;
  if p_action is null or p_action not in ('check_in', 'check_out') then raise exception 'invalid_action' using errcode = '22023'; end if;
  if length(v_code) not between 1 and 40 then raise exception 'invalid_code' using errcode = '22023'; end if;

  -- The same button press sent twice is the same attempt.
  perform pg_advisory_xact_lock(hashtextextended('balaban.attendance.request.' || d.id::text || p_request::text, 0));
  select * into a from public.attendance_attempts where device_id = d.id and request_key = p_request;
  if found then
    return app_private.attendance_attempt_view(a) || jsonb_build_object('replayed', true);
  end if;

  select e.id, e.is_active as employee_active, ae.is_active as profile_active, ae.branch_id
  into emp
  from public.employees e
  join public.attendance_employees ae on ae.employee_id = e.id
  where e.organization_id = d.organization_id and e.employee_number = v_code;

  if emp.id is null or emp.branch_id <> d.branch_id then
    v_reason := 'unknown_employee';
  elsif not emp.employee_active or not emp.profile_active then
    v_reason := 'employee_inactive';
  end if;

  if v_reason is null then
    perform app_private.attendance_lock_employee(emp.id);
    -- Brute-force brake: 5 failed verifications within 15 minutes pause the ID.
    if (select count(*) from public.attendance_attempts t
        where t.employee_id = emp.id and t.status = 'failed' and t.created_at > now() - interval '15 minutes'
          and t.reason in ('face_mismatch', 'liveness_failed', 'challenge_failed', 'no_face', 'multiple_faces',
                           'face_inconsistent', 'invalid_verifier_signature', 'poor_quality')) >= 5 then
      v_reason := 'too_many_failures';
    end if;
  end if;

  if v_reason is null then
    select * into last from app_private.attendance_last_event(emp.id);
    if p_action = 'check_in' and last.kind = 'check_in' then
      v_reason := 'already_checked_in';
    elsif p_action = 'check_out' and coalesce(last.kind, 'check_out') = 'check_out' then
      v_reason := 'not_checked_in';
    end if;
  end if;

  if v_reason is null then
    select r.id into v_ref from app_private.attendance_face_references r
    where r.employee_id = emp.id and r.status = 'active';
    if v_ref is null then v_reason := 'not_enrolled'; end if;
  end if;

  if v_reason is not null then
    insert into public.attendance_attempts (organization_id, branch_id, device_id, request_key, entered_code, employee_id,
                                            action, status, reason, completed_at)
    values (d.organization_id, d.branch_id, d.id, p_request, v_code,
            case when v_reason = 'unknown_employee' then null else emp.id end,
            p_action, 'refused', v_reason, now())
    returning * into a;
    return app_private.attendance_attempt_view(a);
  end if;

  update public.attendance_attempts set status = 'superseded', reason = 'new_attempt', completed_at = now()
  where employee_id = emp.id and status = 'pending';

  -- Turn left and right, in an order drawn from a cryptographic random source. "Look up" is supported by
  -- the verifier but not issued: in the real-camera trial (26 November 2026) the five-landmark pitch
  -- reading for a deliberate upward tilt (0.03-0.08) did not separate from the noise of plain turns
  -- (up to 0.07). See docs/phase13_14/ATTENDANCE.md.
  v_steps := case when get_byte(extensions.gen_random_bytes(1), 0) % 2 = 0
                  then array['left', 'right'] else array['right', 'left'] end;

  insert into public.attendance_attempts (organization_id, branch_id, device_id, request_key, entered_code, employee_id,
                                          action, challenge, nonce, reference_id, status, expires_at)
  values (d.organization_id, d.branch_id, d.id, p_request, v_code, emp.id, p_action, v_steps,
          extensions.gen_random_bytes(16), v_ref, 'pending', now() + interval '90 seconds')
  returning * into a;
  return app_private.attendance_attempt_view(a);
end;
$$;

-- What the web server forwards to the verifier for the kiosk's own pending attempt.
create function public.app_attendance_attempt_material(p_attempt uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.attendance_devices := app_private.kiosk_device();
  a public.attendance_attempts;
  r app_private.attendance_face_references;
begin
  select * into a from public.attendance_attempts where id = p_attempt and device_id = d.id;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if a.status <> 'pending' or now() > a.expires_at then
    return jsonb_build_object('state', case when a.status = 'pending' then 'expired' else a.status end);
  end if;
  select * into r from app_private.attendance_face_references where id = a.reference_id and status = 'active';
  if not found then return jsonb_build_object('state', 'reference_unavailable'); end if;
  return jsonb_build_object(
    'state', 'pending',
    'attempt_id', a.id,
    'nonce', encode(a.nonce, 'hex'),
    'employee_id', a.employee_id,
    'reference_id', r.id,
    'action', a.action,
    'challenge', to_jsonb(a.challenge),
    -- PostgreSQL wraps base64 at 76 characters; the verifier accepts strict base64 only.
    'ciphertext', replace(encode(r.ciphertext, 'base64'), E'
', ''),
    'expires_at', a.expires_at);
end;
$$;

create function public.app_attendance_attempt_complete(p_attempt uuid, p_result jsonb, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.attendance_devices := app_private.kiosk_device();
  a public.attendance_attempts;
  v_outcome text := p_result->>'outcome';
  v_reason text := nullif(p_result->>'reason', '');
  v_engine text := p_result->>'engine';
  v_key text := p_result->>'key_id';
  v_issued timestamptz := app_private.attendance_issued_at(p_result);
  v_metrics jsonb := app_private.attendance_metrics(p_result->'metrics');
  v_expected text;
  last record;
  v_event uuid;
  v_ok boolean;
  v_employee uuid;
begin
  -- Lock order everywhere: the employee first, then the attempt row (start and re-enrollment take the
  -- employee lock before they touch pending attempts), so concurrent requests cannot deadlock.
  select t.employee_id into v_employee from public.attendance_attempts t where t.id = p_attempt and t.device_id = d.id;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if v_employee is not null then perform app_private.attendance_lock_employee(v_employee); end if;
  select * into a from public.attendance_attempts where id = p_attempt and device_id = d.id for update;
  -- Repeated or concurrent completion: the first result stands, nothing new is written.
  if a.status <> 'pending' then
    return app_private.attendance_attempt_view(a) || jsonb_build_object('replayed', true);
  end if;
  if now() > a.expires_at then
    update public.attendance_attempts set status = 'failed', reason = 'expired', completed_at = now() where id = a.id
    returning * into a;
    return app_private.attendance_attempt_view(a);
  end if;
  if v_outcome is null or v_outcome not in ('success', 'failure')
     or (v_outcome = 'failure' and coalesce(v_reason, '') !~ '^[a-z_]{1,40}$')
     or (v_outcome = 'success' and v_reason is not null) then
    raise exception 'invalid_verifier_result' using errcode = '22023';
  end if;

  v_expected := app_private.attendance_hmac(v_key, concat_ws('|', 'balaban-attendance', 'attempt', 'v1',
    a.id::text, encode(a.nonce, 'hex'), a.employee_id::text, a.reference_id::text, a.action,
    array_to_string(a.challenge, ','), v_outcome, coalesce(v_reason, ''), v_engine, p_result->>'issued_at_ms', v_key));
  v_ok := v_expected is not null and v_expected = lower(coalesce(p_signature, ''))
          and v_issued is not null and v_issued >= a.created_at - interval '5 seconds'
          and v_issued <= now() + interval '5 seconds'
          and app_private.attendance_engine_allowed(coalesce(v_engine, ''));
  if not v_ok then
    update public.attendance_attempts
    set status = 'failed', reason = 'invalid_verifier_signature', completed_at = now(), verification = v_metrics
    where id = a.id returning * into a;
    perform app_private.write_audit(a.organization_id, 'security', 'attendance.verifier_signature_refused',
      'attendance_attempt', a.id::text, null, a.branch_id, jsonb_build_object('device', d.id));
    return app_private.attendance_attempt_view(a);
  end if;

  v_metrics := v_metrics || jsonb_build_object('engine', v_engine, 'key_id', v_key);
  if v_outcome = 'failure' then
    update public.attendance_attempts
    set status = 'failed', reason = v_reason, completed_at = now(), verification = v_metrics
    where id = a.id returning * into a;
    return app_private.attendance_attempt_view(a);
  end if;

  -- Success: re-check everything the attempt depended on, under the employee lock taken above.
  if not exists (select 1 from public.employees e join public.attendance_employees ae on ae.employee_id = e.id
                 where e.id = a.employee_id and e.is_active and ae.is_active and ae.branch_id = a.branch_id) then
    v_reason := 'employee_inactive';
  elsif not exists (select 1 from app_private.attendance_face_references r
                    where r.id = a.reference_id and r.status = 'active') then
    v_reason := 'reference_unavailable';
  else
    select * into last from app_private.attendance_last_event(a.employee_id);
    if (a.action = 'check_in' and last.kind = 'check_in')
       or (a.action = 'check_out' and coalesce(last.kind, 'check_out') = 'check_out') then
      v_reason := 'state_changed';
    end if;
  end if;
  if v_reason is not null then
    update public.attendance_attempts
    set status = 'failed', reason = v_reason, completed_at = now(), verification = v_metrics
    where id = a.id returning * into a;
    return app_private.attendance_attempt_view(a);
  end if;

  insert into public.attendance_events (organization_id, branch_id, employee_id, kind, occurred_at, source, device_id, attempt_id)
  values (a.organization_id, a.branch_id, a.employee_id, a.action, date_trunc('second', now()), 'kiosk', d.id, a.id)
  returning id into v_event;
  update public.attendance_attempts
  set status = 'succeeded', event_id = v_event, completed_at = now(), verification = v_metrics
  where id = a.id returning * into a;
  perform app_private.write_audit(a.organization_id, 'operation',
    case when a.action = 'check_in' then 'attendance.checked_in' else 'attendance.checked_out' end,
    'employee', a.employee_id::text, (select full_name from public.employees where id = a.employee_id), a.branch_id,
    jsonb_build_object('event', v_event, 'attempt', a.id, 'device', d.id));
  return app_private.attendance_attempt_view(a);
end;
$$;

-- The kiosk's own attempt as it stands (an expired pending attempt is closed as expired).
create function public.app_attendance_attempt_status(p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.attendance_devices := app_private.kiosk_device();
  a public.attendance_attempts;
begin
  select * into a from public.attendance_attempts where id = p_attempt and device_id = d.id for update;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if a.status = 'pending' and now() > a.expires_at then
    update public.attendance_attempts set status = 'failed', reason = 'expired', completed_at = now() where id = a.id
    returning * into a;
  end if;
  return app_private.attendance_attempt_view(a);
end;
$$;

-- A failure that happened before the verifier could decide (camera, connection, timeout, cancel).
create function public.app_attendance_attempt_fail(p_attempt uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.attendance_devices := app_private.kiosk_device();
  a public.attendance_attempts;
begin
  if p_reason is null or p_reason not in ('camera_unavailable', 'camera_permission_denied', 'camera_stopped',
      'connection_lost', 'verifier_unavailable', 'models_unavailable', 'upload_invalid', 'cancelled', 'timeout',
      'reference_unavailable') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select * into a from public.attendance_attempts where id = p_attempt and device_id = d.id for update;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if a.status = 'pending' then
    update public.attendance_attempts set status = 'failed', reason = p_reason, completed_at = now()
    where id = a.id returning * into a;
  end if;
  return app_private.attendance_attempt_view(a);
end;
$$;

-- ------------------------------------------------------------------ corrections

create function public.app_attendance_correct(
  p_request uuid,
  p_kind text,
  p_employee uuid,
  p_target_event uuid,
  p_event_kind text,
  p_occurred_local timestamp,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ae public.attendance_employees;
  t public.attendance_events;
  c public.attendance_corrections;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text;
  v_event uuid;
  v_kind text := p_event_kind;
  v_employee uuid := p_employee;
  v_tz text;
  p_occurred_at timestamptz;
begin
  if p_request is null then raise exception 'request_required' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('add', 'void', 'retime') then raise exception 'invalid_correction' using errcode = '22023'; end if;
  if p_target_event is not null then
    select * into t from public.attendance_events where id = p_target_event;
    if not found then raise exception 'event_not_found' using errcode = '42501'; end if;
    v_employee := t.employee_id;
  end if;
  select * into ae from public.attendance_employees where employee_id = v_employee;
  if not found then raise exception 'employee_not_found' using errcode = '42501'; end if;
  perform app_private.attendance_require('attendance.correct', coalesce(t.branch_id, ae.branch_id));
  -- The corrected time is typed as branch-local wall-clock time; PostgreSQL converts it.
  select timezone into v_tz from public.branches where id = coalesce(t.branch_id, ae.branch_id);
  p_occurred_at := p_occurred_local at time zone v_tz;

  select * into c from public.attendance_corrections where organization_id = ae.organization_id and request_key = p_request;
  if found then
    return jsonb_build_object('correction_id', c.id, 'replayed', true);
  end if;

  if length(v_reason) not between 3 and 500 then raise exception 'reason_required' using errcode = '22023'; end if;
  if p_kind = 'add' and p_target_event is not null then raise exception 'invalid_correction' using errcode = '22023'; end if;
  if p_kind in ('void', 'retime') and p_target_event is null then raise exception 'invalid_correction' using errcode = '22023'; end if;
  if p_kind = 'retime' then v_kind := t.kind; end if;
  if p_kind in ('add', 'retime') then
    if v_kind is null or v_kind not in ('check_in', 'check_out') or p_occurred_at is null then
      raise exception 'invalid_correction' using errcode = '22023';
    end if;
    if p_occurred_at > now() then raise exception 'time_in_future' using errcode = '22023'; end if;
  end if;
  if p_kind = 'void' then v_kind := null; end if;

  perform app_private.attendance_lock_employee(v_employee);
  -- The same request may have been saved by a concurrent call while this one waited for the lock.
  select * into c from public.attendance_corrections where organization_id = ae.organization_id and request_key = p_request;
  if found then
    return jsonb_build_object('correction_id', c.id, 'replayed', true);
  end if;
  if p_target_event is not null and exists (select 1 from public.attendance_corrections x where x.target_event_id = p_target_event) then
    raise exception 'event_already_corrected' using errcode = '23505';
  end if;

  select e.full_name into v_name from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = auth.uid();
  insert into public.attendance_corrections (organization_id, branch_id, employee_id, request_key, kind, target_event_id,
                                             event_kind, occurred_at, reason, corrected_by, corrected_by_name)
  values (ae.organization_id, coalesce(t.branch_id, ae.branch_id), v_employee, p_request, p_kind, p_target_event,
          v_kind, case when p_kind = 'void' then null else date_trunc('second', p_occurred_at) end, v_reason, auth.uid(), coalesce(v_name, 'unknown'))
  returning * into c;
  if p_kind in ('add', 'retime') then
    insert into public.attendance_events (organization_id, branch_id, employee_id, kind, occurred_at, source, correction_id)
    values (ae.organization_id, coalesce(t.branch_id, ae.branch_id), v_employee, v_kind, date_trunc('second', p_occurred_at), 'correction', c.id)
    returning id into v_event;
  end if;

  perform app_private.write_audit(ae.organization_id, 'operation', 'attendance.event_corrected', 'employee',
    v_employee::text, (select full_name from public.employees where id = v_employee), c.branch_id,
    jsonb_build_object('correction', c.id, 'kind', p_kind, 'target_event', p_target_event,
      'original', case when t.id is not null then jsonb_build_object('kind', t.kind, 'occurred_at', t.occurred_at, 'source', t.source) end,
      'new_event', v_event, 'event_kind', v_kind, 'occurred_at', case when p_kind = 'void' then null else p_occurred_at end,
      'reason', v_reason));
  return jsonb_build_object('correction_id', c.id, 'event_id', v_event, 'replayed', false);
end;
$$;

-- ------------------------------------------------------------------ readers

-- Events, attempts and corrections for the attendance screen and the Excel export.
-- Period: local calendar dates [p_from, p_to] in the branch timezone. The reader also returns, for
-- every employee, the last event before the period and the first event after it, so a shift that
-- crosses a period boundary pairs exactly. The application pairs check-ins with check-outs
-- (src/modules/attendance/hours.ts) and assigns each shift to the date of its check-in.
-- p_purpose 'view' needs attendance.view; 'export' needs attendance.export and records the export.
create function public.app_attendance_report(p_branch_code text, p_from date, p_to date, p_purpose text default 'view',
                                             p_locale text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.branches := app_private.attendance_branch(p_branch_code);
  v_start timestamptz;
  v_end timestamptz;
  result jsonb;
begin
  if p_purpose is null or p_purpose not in ('view', 'export') then raise exception 'invalid_purpose' using errcode = '22023'; end if;
  perform app_private.attendance_require(case when p_purpose = 'export' then 'attendance.export' else 'attendance.view' end, b.id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  v_start := p_from::timestamp at time zone b.timezone;
  v_end := (p_to + 1)::timestamp at time zone b.timezone;

  with emp as (
    select e.id, e.full_name, e.employee_number, e.is_active and ae.is_active as active
    from public.attendance_employees ae join public.employees e on e.id = ae.employee_id
    where ae.branch_id = b.id
  ), ev as (
    select x.*, not exists (select 1 from public.attendance_corrections c where c.target_event_id = x.id) as effective
    from public.attendance_events x
    where x.branch_id = b.id
  ), boundary as (
    select id from (
      select ev.id, row_number() over (partition by ev.employee_id order by ev.occurred_at desc, ev.recorded_at desc) as n
      from ev where ev.effective and ev.occurred_at < v_start) p where p.n = 1
    union all
    select id from (
      select ev.id, row_number() over (partition by ev.employee_id order by ev.occurred_at, ev.recorded_at) as n
      from ev where ev.effective and ev.occurred_at >= v_end) p where p.n = 1
  ), chosen as (
    select ev.* from ev
    where (ev.occurred_at >= v_start and ev.occurred_at < v_end) or ev.id in (select id from boundary)
  )
  select jsonb_build_object(
    'branch', jsonb_build_object('code', b.code, 'name_en', b.name_en, 'name_ar', b.name_ar, 'timezone', b.timezone),
    'from', p_from, 'to', p_to, 'generated_at', now(),
    'generated_local', app_private.attendance_local(now(), b.timezone),
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', emp.id, 'name', emp.full_name,
                                     'code', emp.employee_number, 'active', emp.active) order by emp.employee_number) from emp), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'employee_id', c.employee_id, 'kind', c.kind, 'occurred_at', c.occurred_at,
        'local', app_private.attendance_local(c.occurred_at, b.timezone), 'source', c.source, 'effective', c.effective,
        'in_period', c.occurred_at >= v_start and c.occurred_at < v_end,
        'device', (select dv.label from public.attendance_devices dv where dv.id = c.device_id),
        'created_by_correction', (select jsonb_build_object('id', k.id, 'kind', k.kind, 'reason', k.reason, 'by', k.corrected_by_name,
                                         'at_local', app_private.attendance_local(k.created_at, b.timezone))
                                  from public.attendance_corrections k where k.id = c.correction_id),
        'replaced_by_correction', (select jsonb_build_object('id', k.id, 'kind', k.kind, 'reason', k.reason, 'by', k.corrected_by_name,
                                         'at_local', app_private.attendance_local(k.created_at, b.timezone))
                                   from public.attendance_corrections k where k.target_event_id = c.id))
        order by c.employee_id, c.occurred_at, c.recorded_at) from chosen c), '[]'::jsonb),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'employee_id', t.employee_id, 'entered_code', t.entered_code, 'action', t.action,
        'status', case when t.status = 'pending' and t.expires_at < now() then 'expired' else t.status end,
        'reason', t.reason, 'local', app_private.attendance_local(t.created_at, b.timezone),
        'device', (select dv.label from public.attendance_devices dv where dv.id = t.device_id),
        'match_score', t.verification->'match_score', 'liveness_score', t.verification->'liveness_score')
        order by t.created_at) from public.attendance_attempts t
        where t.branch_id = b.id and t.created_at >= v_start and t.created_at < v_end and t.status <> 'succeeded'), '[]'::jsonb)
  ) into result;

  if p_purpose = 'export' then
    perform app_private.write_audit(b.organization_id, 'operation', 'attendance.report_exported', 'branch', b.id::text,
      b.code, b.id, jsonb_build_object('from', p_from, 'to', p_to, 'locale', p_locale));
  end if;
  return result;
end;
$$;

create function public.app_attendance_employees(p_branch_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.branches := app_private.attendance_branch(p_branch_code);
begin
  if not (app_private.has_permission('attendance.view', b.id) or app_private.has_permission('attendance.employees.manage', b.id)
          or app_private.has_permission('attendance.enroll', b.id)) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'name', e.full_name, 'code', e.employee_number,
      'employee_active', e.is_active, 'attendance_active', ae.is_active,
      'deactivated_local', app_private.attendance_local(ae.deactivated_at, b.timezone), 'deactivation_reason', ae.deactivation_reason,
      'has_staff_account', exists (select 1 from public.staff_accounts s where s.employee_id = e.id),
      'enrolled', r.id is not null,
      'enrolled_local', app_private.attendance_local(r.enrolled_at, b.timezone),
      'last_event', (select jsonb_build_object('kind', l.kind, 'local', app_private.attendance_local(l.occurred_at, b.timezone))
                     from app_private.attendance_last_event(e.id) l)
    ) order by e.employee_number), '[]'::jsonb)
    from public.attendance_employees ae
    join public.employees e on e.id = ae.employee_id
    left join app_private.attendance_face_references r on r.employee_id = e.id and r.status = 'active'
    where ae.branch_id = b.id
  );
end;
$$;

-- People of the organization who are not yet registered for attendance (to register a staff member).
create function public.app_attendance_unregistered(p_branch_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.branches := app_private.attendance_branch(p_branch_code);
begin
  perform app_private.attendance_require('attendance.employees.manage', b.id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name, 'code', e.employee_number)
                              order by e.full_name), '[]'::jsonb)
    from public.employees e
    where e.organization_id = b.organization_id and e.is_active
      and not exists (select 1 from public.attendance_employees a where a.employee_id = e.id)
      and not exists (select 1 from public.staff_accounts s join public.attendance_devices d on d.user_id = s.user_id
                      where s.employee_id = e.id)
      and not exists (select 1 from public.staff_accounts s join public.staff_group_assignments g on g.staff_id = s.user_id
                      where s.employee_id = e.id and g.group_key = 'attendance_kiosk')
  );
end;
$$;

create function public.app_attendance_employee_detail(p_employee uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ae public.attendance_employees;
  b public.branches;
begin
  select * into ae from public.attendance_employees where employee_id = p_employee;
  if not found then raise exception 'employee_not_found' using errcode = '42501'; end if;
  if not (app_private.has_permission('attendance.view', ae.branch_id)
          or app_private.has_permission('attendance.employees.manage', ae.branch_id)
          or app_private.has_permission('attendance.enroll', ae.branch_id)) then
    raise exception 'employee_not_found' using errcode = '42501';
  end if;
  select * into b from public.branches where id = ae.branch_id;
  return (
    select jsonb_build_object(
      'id', e.id, 'name', e.full_name, 'code', e.employee_number, 'branch_code', b.code,
      'employee_active', e.is_active, 'attendance_active', ae.is_active,
      'deactivated_local', app_private.attendance_local(ae.deactivated_at, b.timezone), 'deactivation_reason', ae.deactivation_reason,
      'registered_local', app_private.attendance_local(ae.created_at, b.timezone),
      'has_staff_account', exists (select 1 from public.staff_accounts s where s.employee_id = e.id),
      'references', coalesce((select jsonb_agg(jsonb_build_object(
          'id', r.id, 'status', r.status, 'engine', r.engine, 'identity_document', r.identity_document,
          'enrolled_local', app_private.attendance_local(r.enrolled_at, b.timezone),
          'enrolled_by', (select x.full_name from public.staff_accounts s join public.employees x on x.id = s.employee_id where s.user_id = r.enrolled_by),
          'ended_local', app_private.attendance_local(r.ended_at, b.timezone), 'end_reason', r.end_reason)
          order by r.enrolled_at desc)
        from app_private.attendance_face_references r where r.employee_id = e.id), '[]'::jsonb),
      'enrollments_failed', (select count(*) from app_private.attendance_enrollments s
                             where s.employee_id = e.id and s.status = 'failed'),
      'last_event', (select jsonb_build_object('kind', l.kind, 'local', app_private.attendance_local(l.occurred_at, b.timezone))
                     from app_private.attendance_last_event(e.id) l)
    )
    from public.employees e where e.id = p_employee
  );
end;
$$;

create function public.app_attendance_devices(p_branch_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.branches := app_private.attendance_branch(p_branch_code);
begin
  perform app_private.attendance_require('attendance.devices.manage', b.id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'label', d.label, 'active', d.is_active, 'account_email', s.email,
      'account_active', s.is_active and e.is_active,
      'problem', case when not d.is_active then 'device_inactive'
                      when not (s.is_active and e.is_active) then 'account_inactive'
                      when exists (select 1 from public.staff_group_assignments g where g.staff_id = s.user_id
                                   and (g.group_key <> 'attendance_kiosk' or g.branch_id is distinct from d.branch_id))
                        then 'device_overprivileged'
                      when not exists (select 1 from public.staff_group_assignments g where g.staff_id = s.user_id
                                       and g.group_key = 'attendance_kiosk' and g.branch_id = d.branch_id)
                        then 'not_authorized' end,
      'deactivated_local', app_private.attendance_local(d.deactivated_at, b.timezone), 'deactivation_reason', d.deactivation_reason,
      'registered_local', app_private.attendance_local(d.created_at, b.timezone),
      'last_attempt_local', (select app_private.attendance_local(max(t.created_at), b.timezone)
                             from public.attendance_attempts t where t.device_id = d.id)
    ) order by d.label), '[]'::jsonb)
    from public.attendance_devices d
    join public.staff_accounts s on s.user_id = d.user_id
    join public.employees e on e.id = s.employee_id
    where d.branch_id = b.id
  );
end;
$$;

-- ------------------------------------------------------------------ row-level security and grants

alter table public.attendance_employees enable row level security;
alter table public.attendance_devices enable row level security;
alter table public.attendance_attempts enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_corrections enable row level security;

create policy attendance_employees_read on public.attendance_employees
  for select to authenticated using (app_private.has_permission('attendance.view', branch_id));
create policy attendance_devices_read on public.attendance_devices
  for select to authenticated using (app_private.has_permission('attendance.devices.manage', branch_id));
create policy attendance_attempts_read on public.attendance_attempts
  for select to authenticated using (app_private.has_permission('attendance.view', branch_id));
create policy attendance_events_read on public.attendance_events
  for select to authenticated using (app_private.has_permission('attendance.view', branch_id));
create policy attendance_corrections_read on public.attendance_corrections
  for select to authenticated using (app_private.has_permission('attendance.view', branch_id));

revoke all on public.attendance_employees, public.attendance_devices, public.attendance_attempts,
  public.attendance_events, public.attendance_corrections from anon, authenticated;
-- Even the service role cannot write attendance history directly; only the checked commands can.
revoke insert, update, delete, truncate on public.attendance_employees, public.attendance_devices,
  public.attendance_attempts, public.attendance_events, public.attendance_corrections from service_role;
revoke all on app_private.attendance_signing_keys, app_private.attendance_config, app_private.attendance_enrollments,
  app_private.attendance_face_references from public, anon, authenticated, service_role;

grant select on public.attendance_employees, public.attendance_devices, public.attendance_events,
  public.attendance_corrections to authenticated;
-- The nonce stays out of reach; the metrics hold no biometric data.
grant select (id, organization_id, branch_id, device_id, request_key, entered_code, employee_id, action, challenge,
              reference_id, status, reason, created_at, expires_at, completed_at, verification, event_id)
  on public.attendance_attempts to authenticated;

revoke all on function
  app_private.check_attendance_branch(), app_private.keep_attendance_employee_number(),
  app_private.refuse_attendance_change(), app_private.attendance_attempt_settles_once(),
  app_private.attendance_lock_employee(uuid), app_private.attendance_local(timestamptz, text),
  app_private.attendance_last_event(uuid), app_private.attendance_branch(text), app_private.attendance_require(text, uuid),
  app_private.kiosk_problem(uuid), app_private.kiosk_device(), app_private.attendance_hmac(text, text),
  app_private.attendance_engine_allowed(text), app_private.attendance_issued_at(jsonb), app_private.attendance_metrics(jsonb),
  app_private.attendance_next_code(uuid), app_private.attendance_attempt_view(public.attendance_attempts)
  from public, anon, authenticated, service_role;

revoke all on function
  public.app_attendance_employee_create(text, text, uuid),
  public.app_attendance_employee_register(uuid, text, uuid),
  public.app_attendance_employee_rename(uuid, text),
  public.app_attendance_employee_set_active(uuid, boolean, text),
  public.app_attendance_device_candidates(text),
  public.app_attendance_device_register(text, uuid, text),
  public.app_attendance_device_set_active(uuid, boolean, text),
  public.app_attendance_enrollment_start(uuid),
  public.app_attendance_enrollment_complete(uuid, text, jsonb, text, text, boolean),
  public.app_attendance_enrollment_fail(uuid, text),
  public.app_attendance_reference_delete(uuid, text),
  public.app_attendance_kiosk_context(),
  public.app_attendance_attempt_start(uuid, text, text),
  public.app_attendance_attempt_material(uuid),
  public.app_attendance_attempt_complete(uuid, jsonb, text),
  public.app_attendance_attempt_status(uuid),
  public.app_attendance_attempt_fail(uuid, text),
  public.app_attendance_correct(uuid, text, uuid, uuid, text, timestamp, text),
  public.app_attendance_report(text, date, date, text, text),
  public.app_attendance_employees(text),
  public.app_attendance_unregistered(text),
  public.app_attendance_employee_detail(uuid),
  public.app_attendance_devices(text)
  from public, anon, authenticated, service_role;

grant execute on function
  public.app_attendance_employee_create(text, text, uuid),
  public.app_attendance_employee_register(uuid, text, uuid),
  public.app_attendance_employee_rename(uuid, text),
  public.app_attendance_employee_set_active(uuid, boolean, text),
  public.app_attendance_device_candidates(text),
  public.app_attendance_device_register(text, uuid, text),
  public.app_attendance_device_set_active(uuid, boolean, text),
  public.app_attendance_enrollment_start(uuid),
  public.app_attendance_enrollment_complete(uuid, text, jsonb, text, text, boolean),
  public.app_attendance_enrollment_fail(uuid, text),
  public.app_attendance_reference_delete(uuid, text),
  public.app_attendance_kiosk_context(),
  public.app_attendance_attempt_start(uuid, text, text),
  public.app_attendance_attempt_material(uuid),
  public.app_attendance_attempt_complete(uuid, jsonb, text),
  public.app_attendance_attempt_status(uuid),
  public.app_attendance_attempt_fail(uuid, text),
  public.app_attendance_correct(uuid, text, uuid, uuid, text, timestamp, text),
  public.app_attendance_report(text, date, date, text, text),
  public.app_attendance_employees(text),
  public.app_attendance_unregistered(text),
  public.app_attendance_employee_detail(uuid),
  public.app_attendance_devices(text)
  to authenticated;
