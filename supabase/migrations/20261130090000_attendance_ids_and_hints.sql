-- Phases 13-14 follow-up (owner decisions of 26 November 2026, after the real-camera trial):
--   * Attendance employee IDs are three digits, 101-999, given in order and never reused: the next ID is
--     one more than the highest three-digit ID the organization has ever used, so the number of a person
--     who left is never given again. When 999 is used, creating an employee is refused clearly.
--   * Registering an existing staff member keeps their number only if it already has that shape.
--   * A failed kiosk attempt can carry one short advice code from the verifier ("turn more", "come closer",
--     "more light", "one person", "follow the arrows"). Advice only; it changes no decision.
-- Forward-only: 20261129090000 is treated as applied.

-- A three-digit attendance ID: 101-999.
create function app_private.attendance_code_fits(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_code ~ '^[1-9][0-9]{2}$' and p_code::int >= 101, false);
$$;

-- Next attendance ID of the organization (caller holds the code lock), or NULL when 999 is used.
create or replace function app_private.attendance_next_code(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(max(e.employee_number::int), 100) >= 999 then null
              else (greatest(100, coalesce(max(e.employee_number::int), 100)) + 1)::text end
  from public.employees e
  where e.organization_id = p_org and e.employee_number ~ '^[1-9][0-9]{2}$';
$$;

create or replace function public.app_attendance_employee_create(p_branch_code text, p_full_name text, p_request uuid)
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
  if v_code is null then raise exception 'employee_ids_exhausted' using errcode = '22023'; end if;
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

create or replace function public.app_attendance_employee_register(p_employee uuid, p_branch_code text, p_request uuid)
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

  -- Keep an existing staff number only when it already has the attendance shape (101-999);
  -- otherwise give the next attendance number (the person is not registered yet, so it may change).
  v_code := e.employee_number;
  if v_code is null or not app_private.attendance_code_fits(v_code) then
    v_code := app_private.attendance_next_code(b.organization_id);
    if v_code is null then raise exception 'employee_ids_exhausted' using errcode = '22023'; end if;
    update public.employees set employee_number = v_code where id = e.id;
  end if;
  insert into public.attendance_employees (employee_id, organization_id, branch_id, created_request, created_by)
  values (e.id, b.organization_id, b.id, p_request, auth.uid());

  perform app_private.write_audit(b.organization_id, 'administration', 'attendance.employee_registered', 'employee',
    e.id::text, e.full_name, b.id, jsonb_build_object('employee_code', v_code, 'previous_number', e.employee_number));
  return jsonb_build_object('employee_id', e.id, 'employee_code', v_code, 'replayed', false);
end;
$$;

create or replace function app_private.attendance_attempt_view(p_attempt public.attendance_attempts)
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
    -- One short advice code for the person at the kiosk (from the verifier's aggregate metrics).
    'hint', case when p_attempt.status = 'failed'
                  and p_attempt.verification->>'hint' in ('turn_more', 'follow_arrows', 'come_closer', 'more_light', 'one_person')
                 then p_attempt.verification->>'hint' end,
    'current_state', case when last_kind is not null then jsonb_build_object(
               'kind', last_kind, 'local', app_private.attendance_local(last_at, tz)) end
  ));
end;
$$;

revoke all on function app_private.attendance_code_fits(text) from public, anon, authenticated, service_role;
