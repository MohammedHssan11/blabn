-- Phases 13-14 acceptance cases for attendance: structure and grants, employee IDs, devices and the
-- kiosk's least privilege, enrollment with signed verifier results, attempts bound to one employee /
-- device / challenge / nonce, replay and cross-employee reuse, expiry, deactivation, the brute-force
-- brake, corrections that keep the original, append-only history, the readers and tenant isolation.
-- Synthetic people only, a test-only signing key, fake ciphertext bytes; everything rolls back.
-- The verifier is simulated by public.att_verdict(), which signs with the same key the database holds.
begin;

create function public.att_act_as(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then reset role; return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
grant execute on function public.att_act_as(uuid) to authenticated;

create function public.att_expect(p_state text, p_sql text, p_message text default null) returns void language plpgsql as $$
declare got text; msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics got = returned_sqlstate, msg = message_text;
    if got <> p_state then raise exception 'expected SQLSTATE % but got % (%) for: %', p_state, got, msg, left(p_sql, 300); end if;
    if p_message is not null and msg <> p_message then
      raise exception 'expected message % but got % for: %', p_message, msg, left(p_sql, 300);
    end if;
    return;
  end;
  raise exception 'expected SQLSTATE % but the statement succeeded: %', p_state, left(p_sql, 300);
end;
$$;
grant execute on function public.att_expect(text, text, text) to authenticated, anon;

-- A test-only signing key (32 bytes of 0x11) and the synthetic engine switch of this disposable run.
insert into app_private.attendance_signing_keys (key_id, secret) values ('att-test-k1', decode(repeat('11', 32), 'hex'));
insert into app_private.attendance_signing_keys (key_id, secret, retired_at) values ('att-test-old', decode(repeat('22', 32), 'hex'), now());

-- Plays the verifier: signs a verdict for an attempt with the test key, from the attempt's own facts.
create function public.att_verdict(p_attempt uuid, p_outcome text, p_reason text default null,
                                   p_engine text default 'opencv-test-engine', p_key text default 'att-test-k1',
                                   p_issued timestamptz default now(), p_capture text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.attendance_attempts;
  ms text := (floor(extract(epoch from p_issued) * 1000))::bigint::text;
  k bytea := (select secret from app_private.attendance_signing_keys where key_id = p_key);
  msg text;
  capture text := coalesce(p_capture, encode(extensions.digest(p_attempt::text, 'sha256'), 'hex'));
begin
  select * into a from public.attendance_attempts where id = p_attempt;
  msg := concat_ws('|', 'balaban-attendance', 'attempt', 'v2', a.id::text, encode(a.nonce, 'hex'), a.employee_id::text,
                   a.reference_id::text, a.action, array_to_string(a.challenge, ','), capture, p_outcome, coalesce(p_reason, ''),
                   p_engine, ms, p_key);
  return jsonb_build_object(
    'result', jsonb_strip_nulls(jsonb_build_object('outcome', p_outcome, 'reason', p_reason, 'engine', p_engine,
                                                   'issued_at_ms', ms, 'key_id', p_key, 'capture_hash', capture,
                                                   'metrics', jsonb_build_object('match_score', 0.71, 'parallax', 0.12,
                                                                                 'embedding', jsonb_build_array(1, 2, 3)))),
    'signature', encode(extensions.hmac(convert_to(msg, 'UTF8'), k, 'sha256'), 'hex'));
end;
$$;
grant execute on function public.att_verdict(uuid, text, text, text, text, timestamptz, text) to authenticated;

-- Plays the verifier for enrollment: fake ciphertext bytes (never a template) and their signature.
create function public.att_enroll(p_employee uuid, p_engine text default 'opencv-test-engine', p_bad boolean default false)
returns jsonb language plpgsql as $$
declare
  s jsonb := public.app_attendance_enrollment_start(p_employee);
  cipher bytea := extensions.gen_random_bytes(64);
  ms text := (floor(extract(epoch from now()) * 1000))::bigint::text;
  msg text;
begin
  msg := concat_ws('|', 'balaban-attendance', 'enroll', 'v1', s->>'enrollment_id', s->>'nonce', p_employee::text,
                   encode(extensions.digest(cipher, 'sha256'), 'hex'), 'success', p_engine, ms, 'att-test-k1');
  return public.app_attendance_enrollment_complete((s->>'enrollment_id')::uuid, encode(cipher, 'base64'),
    jsonb_build_object('outcome', 'success', 'engine', p_engine, 'issued_at_ms', ms, 'key_id', 'att-test-k1',
                       'quality', jsonb_build_object('frames', 24, 'parallax', 0.15)),
    case when p_bad then repeat('0', 64) else public.att_sign(msg) end, 'national_id', true);
end;
$$;
grant execute on function public.att_enroll(uuid, text, boolean) to authenticated;

create function public.att_sign(p_msg text) returns text language sql security definer set search_path = '' as $$
  select encode(extensions.hmac(convert_to(p_msg, 'UTF8'), secret, 'sha256'), 'hex')
  from app_private.attendance_signing_keys where key_id = 'att-test-k1';
$$;
grant execute on function public.att_sign(text) to authenticated;

-- Moves an attempt's expiry into the past (test only: the binding trigger is paused inside this transaction).
create function public.att_expire(p_attempt uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.attendance_attempts disable trigger attendance_attempts_settle_once;
  update public.attendance_attempts set expires_at = now() - interval '1 second', created_at = now() - interval '2 minutes'
  where id = p_attempt;
  alter table public.attendance_attempts enable trigger attendance_attempts_settle_once;
end;
$$;
grant execute on function public.att_expire(uuid) to authenticated;

-- ------------------------------------------------------------------ people
-- admin: System Admin. manager / cashier: their usual groups. kiosk: Attendance Kiosk at Maarif only.
-- kiosk2: Attendance Kiosk + Cashier (over-privileged). other: System Admin of another organization.
insert into public.organizations (id, name) values ('a1300000-0000-4000-8000-0000000000f0', 'Other organization (test)');
insert into public.branches (id, organization_id, code, name_en, name_ar, operates_in_app)
values ('a1300000-0000-4000-8000-0000000000f1', 'a1300000-0000-4000-8000-0000000000f0', 'maarif', 'Other Maarif', 'معاريف أخرى', true);

insert into auth.users (id, email) values
  ('a1300000-0000-4000-8000-000000000001', 'admin@att.test'),
  ('a1300000-0000-4000-8000-000000000002', 'manager@att.test'),
  ('a1300000-0000-4000-8000-000000000003', 'cashier@att.test'),
  ('a1300000-0000-4000-8000-000000000004', 'kiosk@att.test'),
  ('a1300000-0000-4000-8000-000000000005', 'kiosk2@att.test'),
  ('a1300000-0000-4000-8000-000000000006', 'other@att.test'),
  ('a1300000-0000-4000-8000-000000000007', 'kiosk3@att.test');
insert into public.employees (id, organization_id, full_name)
  select u.id, case when u.email = 'other@att.test' then 'a1300000-0000-4000-8000-0000000000f0'::uuid else b.organization_id end,
         'ATT ' || split_part(u.email, '@', 1)
  from auth.users u cross join public.branches b where b.code = 'maarif' and b.id <> 'a1300000-0000-4000-8000-0000000000f1'
    and u.email like '%@att.test';
insert into public.staff_accounts (user_id, employee_id, organization_id, email)
  select u.id, u.id, e.organization_id, u.email from auth.users u join public.employees e on e.id = u.id where u.email like '%@att.test';
insert into public.branch_memberships (staff_id, branch_id)
  select s.user_id, b.id from public.staff_accounts s join public.branches b on b.organization_id = s.organization_id
  where s.email like '%@att.test' and b.code = 'maarif';
insert into public.staff_group_assignments (staff_id, branch_id, group_key)
  select s.user_id, case when v.g = 'system_admin' then null else b.id end, v.g
  from (values ('admin', 'system_admin'), ('manager', 'manager'), ('cashier', 'cashier'), ('kiosk', 'attendance_kiosk'),
               ('kiosk2', 'attendance_kiosk'), ('kiosk2', 'cashier'), ('other', 'system_admin'), ('kiosk3', 'attendance_kiosk')) v(who, g)
  join public.staff_accounts s on s.email = v.who || '@att.test'
  join public.branches b on b.organization_id = s.organization_id and b.code = 'maarif';

-- Counts events as the table owner (the kiosk itself can read none, so its own count would prove nothing).
create function public.att_event_count() returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.attendance_events;
$$;
grant execute on function public.att_event_count() to authenticated;

create temporary table att_ids (k text primary key, v uuid) on commit drop;
grant all on att_ids to authenticated;

-- ------------------------------------------------------------------ 1. structure and grants
do $$
declare t text;
begin
  foreach t in array array['attendance_employees', 'attendance_devices', 'attendance_attempts', 'attendance_events', 'attendance_corrections'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': row-level security';
    assert not has_table_privilege('authenticated', 'public.' || t, 'insert') and not has_table_privilege('authenticated', 'public.' || t, 'update')
       and not has_table_privilege('authenticated', 'public.' || t, 'delete'), t || ': staff cannot write directly';
    assert not has_table_privilege('anon', 'public.' || t, 'select'), t || ': anon reads nothing';
    assert not has_table_privilege('service_role', 'public.' || t, 'insert') and not has_table_privilege('service_role', 'public.' || t, 'update')
       and not has_table_privilege('service_role', 'public.' || t, 'delete'), t || ': not even the service role writes directly';
  end loop;
  foreach t in array array['attendance_signing_keys', 'attendance_config', 'attendance_enrollments', 'attendance_face_references'] loop
    assert not has_table_privilege('authenticated', 'app_private.' || t, 'select'), t || ': private to the API';
    assert not has_table_privilege('service_role', 'app_private.' || t, 'select'), t || ': private to the service role';
  end loop;
  foreach t in array array['attendance_capture_secret', 'attendance_used_captures'] loop
    assert (select relrowsecurity from pg_class where oid = ('app_private.' || t)::regclass), t || ': row-level security';
    assert not has_table_privilege('anon', 'app_private.' || t, 'select,insert,update,delete'), t || ': no anon access';
    assert not has_table_privilege('authenticated', 'app_private.' || t, 'select,insert,update,delete'), t || ': no staff access';
    assert not has_table_privilege('service_role', 'app_private.' || t, 'select,insert,update,delete'), t || ': no service access';
  end loop;
  assert not has_column_privilege('authenticated', 'public.attendance_attempts', 'nonce', 'select'), 'the attempt nonce is not readable';
  assert has_column_privilege('authenticated', 'public.attendance_attempts', 'status', 'select');
  assert not has_function_privilege('anon', 'public.app_attendance_attempt_start(uuid, text, text)', 'execute'), 'anon cannot start';
  assert not has_function_privilege('anon', 'public.app_attendance_today()', 'execute'), 'anon cannot read the attendance date';
  assert not has_function_privilege('service_role', 'public.app_attendance_attempt_complete(uuid, jsonb, text)', 'execute'), 'service role cannot complete';
  assert not has_function_privilege('authenticated', 'app_private.attendance_hmac(text, text)', 'execute'), 'nobody may compute the HMAC';
  assert (select array_agg(permission_key order by permission_key) from public.group_permissions where group_key = 'attendance_kiosk')
         = array['attendance.event.create'], 'the kiosk group grants one permission';
  assert (select count(*) from public.group_permissions where group_key = 'system_admin' and permission_key like 'attendance.%') = 7,
    'Abdo holds the seven attendance permissions';
  assert (select count(*) from public.group_permissions where group_key in ('manager', 'cashier', 'storekeeper', 'comparison_editor')
          and permission_key like 'attendance.%') = 0, 'no other group was given attendance access';
  assert not (select allow_synthetic_engine from app_private.attendance_config), 'synthetic engine refused by default';
end $$;

update app_private.attendance_config set allow_synthetic_engine = false;

-- ------------------------------------------------------------------ 2. employees and stable IDs
do $$
declare
  r jsonb; r2 jsonb; req uuid := gen_random_uuid(); e1 uuid; e2 uuid; c1 bigint;
begin
  perform public.att_act_as('a1300000-0000-4000-8000-000000000002');
  perform public.att_expect('42501', $q$select public.app_attendance_employee_create('maarif', 'Nobody', gen_random_uuid())$q$);
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  assert public.app_attendance_today() = (now() at time zone 'Africa/Casablanca')::date,
    'attendance uses the branch calendar date, including before the business-day rollover';
  r := public.app_attendance_employee_create('maarif', '  Synthetic Employee A  ', req);
  r2 := public.app_attendance_employee_create('maarif', 'Synthetic Employee A', req);
  assert r->>'employee_id' = r2->>'employee_id' and (r2->>'replayed')::boolean, 'a repeated request creates one employee';
  assert r->>'employee_code' ~ '^[1-9][0-9]{2}$' and (r->>'employee_code')::int between 101 and 999, 'a three-digit ID (101-999) is generated';
  c1 := (r->>'employee_code')::bigint;
  e1 := (r->>'employee_id')::uuid;
  r := public.app_attendance_employee_create('maarif', 'Synthetic Employee B', gen_random_uuid());
  assert (r->>'employee_code')::bigint = c1 + 1, 'IDs are unique and sequential';
  e2 := (r->>'employee_id')::uuid;
  insert into att_ids values ('a', e1), ('b', e2);
  r := public.app_attendance_employee_create('maarif', 'Synthetic Employee C', gen_random_uuid());
  insert into att_ids values ('c', (r->>'employee_id')::uuid);
  perform public.att_expect('22023', $q$select public.app_attendance_employee_create('maarif', ' ', gen_random_uuid())$q$);
  perform public.att_expect('42501', $q$select public.app_attendance_employee_create('alquds', 'X', gen_random_uuid())$q$);
  -- Registering the cashier (a staff member without a number) gives the next ID.
  r := public.app_attendance_employee_register('a1300000-0000-4000-8000-000000000003', 'maarif', gen_random_uuid());
  assert (r->>'employee_code')::int = c1 + 3, 'the cashier gets the next ID';
  perform public.att_expect('23505', $q$select public.app_attendance_employee_register('a1300000-0000-4000-8000-000000000003', 'maarif', gen_random_uuid())$q$);
  -- A kiosk account cannot become an attendance employee.
  assert not exists (select 1 from jsonb_array_elements(public.app_attendance_unregistered('maarif')) x
                     where x->>'id' = 'a1300000-0000-4000-8000-000000000004'), 'kiosk accounts are not offered';
  perform public.app_attendance_employee_rename(e2, 'Synthetic Employee Bee');
  perform public.att_expect('22023', $q$select public.app_attendance_employee_rename('a1300000-0000-4000-8000-000000000003', 'Renamed')$q$,
                            'staff_name_managed_elsewhere');
  perform public.att_expect('22023', format('select public.app_attendance_employee_set_active(%L, false, %L)', e2, ''), 'reason_required');
  perform public.att_act_as(null);
  perform public.att_expect('23514', format('update public.employees set employee_number = %L where id = %L', '9999', e1),
                            'employee_number_locked');
  perform public.att_expect('23514', format('update public.employees set employee_number = null where id = %L', e1));
  update public.employees set employee_number = '7777' where id = 'a1300000-0000-4000-8000-000000000002';
  assert exists (select 1 from public.audit_log where action = 'attendance.employee_created' and target_id = e1::text), 'audited';
  -- A staff number of another shape is replaced at registration; a fitting one is kept.
  insert into public.employees (id, organization_id, full_name, employee_number)
    select 'a1300000-0000-4000-8000-0000000000b1'::uuid, organization_id, 'ATT numbered A', '0042' from public.branches where code = 'maarif' and organization_id <> 'a1300000-0000-4000-8000-0000000000f0'
    union all
    select 'a1300000-0000-4000-8000-0000000000b2'::uuid, organization_id, 'ATT numbered B', '150' from public.branches where code = 'maarif' and organization_id <> 'a1300000-0000-4000-8000-0000000000f0';
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  r := public.app_attendance_employee_register('a1300000-0000-4000-8000-0000000000b2', 'maarif', gen_random_uuid());
  assert r->>'employee_code' = '150', 'a fitting staff number is kept';
  r := public.app_attendance_employee_register('a1300000-0000-4000-8000-0000000000b1', 'maarif', gen_random_uuid());
  assert r->>'employee_code' = '151', 'an unfitting number is replaced by the next ID after the highest ever used';
  -- IDs are never reused: deactivating does not free the number.
  perform public.app_attendance_employee_set_active('a1300000-0000-4000-8000-0000000000b1', false, 'Left (test)');
  r := public.app_attendance_employee_create('maarif', 'After a leaver', gen_random_uuid());
  assert r->>'employee_code' = '152', 'the next ID follows, nothing is reused';
  perform public.app_attendance_employee_set_active('a1300000-0000-4000-8000-0000000000b1', true);
  -- When 999 is used, creating is refused clearly.
  perform public.att_act_as(null);
  insert into public.employees (organization_id, full_name, employee_number)
    select organization_id, 'ATT last number', '999' from public.branches where code = 'maarif' and organization_id <> 'a1300000-0000-4000-8000-0000000000f0';
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  perform public.att_expect('22023', $q$select public.app_attendance_employee_create('maarif', 'One too many', gen_random_uuid())$q$, 'employee_ids_exhausted');
  perform public.att_act_as(null);
  delete from public.employees where employee_number = '999';
end $$;

-- ------------------------------------------------------------------ 3. devices and least privilege
do $$
declare d uuid; c jsonb;
begin
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  c := public.app_attendance_device_candidates('maarif');
  assert exists (select 1 from jsonb_array_elements(c) x where x->>'email' = 'kiosk@att.test'), 'a pure kiosk account is a candidate';
  assert not exists (select 1 from jsonb_array_elements(c) x where x->>'email' = 'kiosk2@att.test'), 'an over-privileged account is not';
  perform public.att_expect('22023', $q$select public.app_attendance_device_register('maarif', 'a1300000-0000-4000-8000-000000000005', 'Bad kiosk')$q$,
                            'device_account_not_eligible');
  perform public.att_expect('22023', $q$select public.app_attendance_device_register('maarif', 'a1300000-0000-4000-8000-000000000003', 'Cashier')$q$);
  d := public.app_attendance_device_register('maarif', 'a1300000-0000-4000-8000-000000000004', 'Maarif entrance');
  insert into att_ids values ('device', d);
  perform public.app_attendance_device_register('maarif', 'a1300000-0000-4000-8000-000000000007', 'Spare kiosk');
  perform public.att_act_as('a1300000-0000-4000-8000-000000000002');
  perform public.att_expect('42501', $q$select public.app_attendance_device_candidates('maarif')$q$);
  perform public.att_act_as('a1300000-0000-4000-8000-000000000003');
  assert public.app_attendance_kiosk_context()->>'state' = 'not_a_device', 'a cashier is not a kiosk';
  perform public.att_expect('42501', $q$select public.app_attendance_attempt_start(gen_random_uuid(), '1001', 'check_in')$q$, 'not_a_device');
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  assert public.app_attendance_kiosk_context()->>'state' = 'ready' and public.app_attendance_kiosk_context()->>'branch_code' = 'maarif';
  -- Granting the kiosk anything else stops it at once.
  perform public.att_act_as(null);
  insert into public.staff_group_assignments (staff_id, branch_id, group_key)
    select 'a1300000-0000-4000-8000-000000000004', id, 'manager' from public.branches where code = 'maarif' and organization_id <> 'a1300000-0000-4000-8000-0000000000f0';
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  assert public.app_attendance_kiosk_context()->>'state' = 'device_overprivileged', 'extra rights stop the kiosk';
  perform public.att_expect('42501', $q$select public.app_attendance_attempt_start(gen_random_uuid(), '1001', 'check_in')$q$, 'device_overprivileged');
  perform public.att_act_as(null);
  delete from public.staff_group_assignments where staff_id = 'a1300000-0000-4000-8000-000000000004' and group_key = 'manager';
end $$;

-- ------------------------------------------------------------------ 4. the kiosk cannot read anything else
do $$
begin
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  assert (select count(*) from public.business_days) = 0, 'no daily close';
  assert (select count(*) from public.cash_movements) = 0, 'no cash';
  assert (select count(*) from public.cash_counts) = 0, 'no cash counts';
  assert (select count(*) from public.stock_movements) = 0, 'no stock';
  assert (select count(*) from public.comparison_entries) = 0, 'no comparison figures';
  assert (select count(*) from public.purchase_orders) = 0, 'no purchase orders';
  assert (select count(*) from public.report_exports) = 0, 'no report exports';
  assert (select count(*) from public.audit_log) = 0, 'no audit history';
  assert (select count(*) from public.attendance_events) = 0 and (select count(*) from public.attendance_attempts) = 0
     and (select count(*) from public.attendance_employees) = 0 and (select count(*) from public.attendance_devices) = 0,
    'not even attendance records';
  perform public.att_expect('42501', $q$select public.app_attendance_report('maarif', current_date, current_date)$q$);
  perform public.att_expect('42501', $q$select public.app_attendance_report('maarif', current_date, current_date, 'export')$q$);
  perform public.att_expect('42501', $q$select public.app_attendance_employees('maarif')$q$);
  perform public.att_expect('42501', $q$select public.app_attendance_employee_create('maarif', 'Ghost', gen_random_uuid())$q$);
  perform public.att_expect('42501', $q$select public.app_attendance_correct(gen_random_uuid(), 'add', (select x.v from att_ids x where k = 'a'), null, 'check_in', now()::timestamp, 'reason')$q$);
  perform public.att_expect('42501', $q$select public.app_attendance_enrollment_start((select x.v from att_ids x where k = 'a'))$q$);
  perform public.att_expect('42501', $q$select public.app_attendance_devices('maarif')$q$);
  perform public.att_expect('42501', $q$select public.app_comparison_report('view', array['maarif'], array[current_date])$q$);
  perform public.att_expect('42501', $q$insert into public.attendance_events (organization_id, branch_id, employee_id, kind, occurred_at, source, device_id, attempt_id) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'check_in', now(), 'kiosk', gen_random_uuid(), gen_random_uuid())$q$);
  perform public.att_expect('42501', $q$select * from app_private.attendance_face_references$q$);
  assert public.app_authorize('attendance.event.create', 'maarif') and not public.app_authorize('daily_close.view', 'maarif')
     and not public.app_authorize('attendance.view', 'maarif'), 'one permission, nothing else';
  perform public.att_act_as(null);
end $$;

-- ------------------------------------------------------------------ 5. enrollment
do $$
declare r jsonb; a uuid := (select x.v from att_ids x where k = 'a'); first_ref uuid;
begin
  perform public.att_act_as('a1300000-0000-4000-8000-000000000002');
  perform public.att_expect('42501', format('select public.app_attendance_enrollment_start(%L)', a));
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  r := public.att_enroll(a, p_bad => true);
  assert r->>'status' = 'failed' and r->>'reason' = 'invalid_verifier_signature', 'a forged enrollment is refused';
  perform public.att_expect('22023', format('select public.att_enroll(%L, %L)', a, 'synthetic-test-v1'), 'invalid_verifier_result');
  r := public.att_enroll(a);
  assert r->>'status' = 'completed', 'signed enrollment stored';
  first_ref := (r->>'reference_id')::uuid;
  r := public.att_enroll(a);
  assert (r->>'replaced')::uuid = first_ref, 're-enrollment replaces the reference';
  perform public.att_act_as(null);
  assert (select count(*) from app_private.attendance_face_references where employee_id = a and status = 'active') = 1;
  assert (select ciphertext is null and status = 'replaced' from app_private.attendance_face_references where id = first_ref),
    'the replaced reference is erased';
  assert (select quality::text !~ '\[' from app_private.attendance_face_references where employee_id = a and status = 'active'),
    'quality metadata is flat';
  assert exists (select 1 from public.audit_log where action = 'attendance.face_re_enrolled' and target_id = a::text);
  assert exists (select 1 from public.audit_log where action = 'attendance.verifier_signature_refused');
  -- Employee B enrolled too.
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  perform public.att_enroll((select x.v from att_ids x where k = 'b'));
  perform public.att_enroll((select x.v from att_ids x where k = 'c'));
  perform public.att_act_as(null);
end $$;

-- ------------------------------------------------------------------ 6. attempts, verdicts and events
do $$
declare
  code_a text := (select employee_number from public.employees where id = (select x.v from att_ids x where k = 'a'));
  code_b text := (select employee_number from public.employees where id = (select x.v from att_ids x where k = 'b'));
  code_c text := (select employee_number from public.employees where id = (select x.v from att_ids x where k = 'c'));
  req uuid := gen_random_uuid();
  r jsonb; r2 jsonb; m jsonb; v jsonb; vb jsonb; att uuid; att_b uuid; att2 uuid; n int;
begin
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  r := public.app_attendance_attempt_start(gen_random_uuid(), '000000', 'check_in');
  assert r->>'status' = 'refused' and r->>'reason' = 'unknown_employee', 'an unknown ID is refused and recorded';
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_out');
  assert r->>'reason' = 'not_checked_in', 'a check-out before any check-in is refused';
  r := public.app_attendance_attempt_start(req, code_c, 'check_in');
  assert r->>'status' = 'pending' and jsonb_array_length(r->'challenge') = 2
     and r->'challenge'->>0 <> r->'challenge'->>1, 'two different random movements';
  assert r->>'employee_first_name' is null, 'no name before verification';
  att := (r->>'attempt_id')::uuid;
  r2 := public.app_attendance_attempt_start(req, code_c, 'check_in');
  assert r2->>'attempt_id' = att::text and (r2->>'replayed')::boolean, 'a repeated press is the same attempt';
  m := public.app_attendance_attempt_material(att);
  assert m->>'state' = 'pending' and length(m->>'nonce') = 32 and m->>'ciphertext' is not null, 'material for the verifier';

  -- A second kiosk cannot use this attempt.
  perform public.att_act_as('a1300000-0000-4000-8000-000000000007');
  perform public.att_expect('42501', format('select public.app_attendance_attempt_material(%L)', att), 'attempt_not_found');
  perform public.att_expect('42501', format('select public.app_attendance_attempt_complete(%L, %L::jsonb, %L)', att,
    (public.att_verdict(att, 'success'))->'result', (public.att_verdict(att, 'success'))->>'signature'), 'attempt_not_found');

  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  -- The browser's own claim of success is worthless.
  r := public.app_attendance_attempt_complete(att, '{"outcome":"success","engine":"opencv-test-engine","issued_at_ms":"1","key_id":"att-test-k1","metrics":{"liveness_passed":true}}', 'deadbeef');
  assert r->>'status' = 'failed' and r->>'reason' = 'invalid_verifier_signature', 'an unsigned success is refused';
  assert public.att_event_count() = 0, 'and creates no event';
  r := public.app_attendance_attempt_complete(att, (public.att_verdict(att, 'success'))->'result', (public.att_verdict(att, 'success'))->>'signature');
  assert r->>'status' = 'failed' and (r->>'replayed')::boolean, 'a settled attempt cannot be completed again';

  -- A fresh attempt with a properly signed verdict.
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_c, 'check_in');
  att := (r->>'attempt_id')::uuid;
  -- Meanwhile employee B starts an attempt: A's verdict cannot be used on B's attempt.
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_b, 'check_in');
  att_b := (r->>'attempt_id')::uuid;
  v := public.att_verdict(att, 'success');
  r := public.app_attendance_attempt_complete(att_b, v->'result', v->>'signature');
  assert r->>'reason' = 'invalid_verifier_signature', 'cross-employee reuse refused';
  -- A failure verdict cannot be rewritten as a success.
  vb := public.att_verdict(att, 'failure', 'face_mismatch');
  r := public.app_attendance_attempt_complete(att, jsonb_set(jsonb_set(vb->'result', '{outcome}', '"success"'), '{reason}', 'null'), vb->>'signature');
  assert r->>'reason' = 'invalid_verifier_signature', 'an edited verdict is refused';
  assert public.att_event_count() = 0;

  r := public.app_attendance_attempt_start(gen_random_uuid(), code_c, 'check_in');
  att := (r->>'attempt_id')::uuid;
  -- Retired keys, stale and future verdicts are refused.
  v := public.att_verdict(att, 'success', p_key => 'att-test-old');
  assert (public.app_attendance_attempt_complete(att, v->'result', v->>'signature'))->>'reason' = 'invalid_verifier_signature', 'retired key refused';
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_c, 'check_in');
  att := (r->>'attempt_id')::uuid;
  v := public.att_verdict(att, 'success', p_issued => now() + interval '1 minute');
  assert (public.app_attendance_attempt_complete(att, v->'result', v->>'signature'))->>'reason' = 'invalid_verifier_signature', 'future verdict refused';
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_c, 'check_in');
  att := (r->>'attempt_id')::uuid;
  v := public.att_verdict(att, 'success', p_engine => 'synthetic-test-v1');
  assert (public.app_attendance_attempt_complete(att, v->'result', v->>'signature'))->>'reason' = 'invalid_verifier_signature',
    'the synthetic engine is refused while switched off';

  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_in');
  att := (r->>'attempt_id')::uuid;
  v := public.att_verdict(att, 'success');
  r := public.app_attendance_attempt_complete(att, v->'result', v->>'signature');
  assert r->>'status' = 'succeeded' and r->'event'->>'kind' = 'check_in' and r->>'employee_first_name' = 'Synthetic', 'check-in recorded';
  assert (r->'event'->>'local') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$', 'confirmation shows the local time';
  r2 := public.app_attendance_attempt_complete(att, v->'result', v->>'signature');
  assert (r2->>'replayed')::boolean and r2->'event'->>'occurred_at' = r->'event'->>'occurred_at', 'a retry returns the same event';
  -- A newly signed verdict for a fresh attempt with the same capture is refused.
  r2 := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_out');
  att2 := (r2->>'attempt_id')::uuid;
  vb := public.att_verdict(att2, 'success', p_capture => v->'result'->>'capture_hash');
  r2 := public.app_attendance_attempt_complete(att2, vb->'result', vb->>'signature');
  assert r2->>'status' = 'failed' and r2->>'reason' = 'capture_replayed', 'same capture cannot create a second event';
  assert public.att_event_count() = 1, 'replayed capture creates no event';
  r2 := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_out');
  att2 := (r2->>'attempt_id')::uuid;
  vb := public.att_verdict(att2, 'success');
  r2 := public.app_attendance_attempt_complete(att2, jsonb_set(vb->'result', '{capture_hash}', to_jsonb(repeat('a', 64))), vb->>'signature');
  assert r2->>'reason' = 'invalid_verifier_signature', 'a capture digest cannot be altered after signing';
  -- A verdict for this attempt cannot be replayed on the employee's next attempt.
  assert public.att_event_count() = 1, 'exactly one event';
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_in');
  assert r->>'status' = 'refused' and r->>'reason' = 'already_checked_in' and r->'current_state'->>'kind' = 'check_in',
    'a repeated check-in shows the current state';
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_out');
  att2 := (r->>'attempt_id')::uuid;
  r := public.app_attendance_attempt_complete(att2, v->'result', v->>'signature');
  assert r->>'reason' = 'invalid_verifier_signature', 'an earlier verdict cannot create a later event';
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_out');
  att2 := (r->>'attempt_id')::uuid;
  -- Expired attempts cannot complete, even with a valid verdict.
  perform public.att_expire(att2);
  v := public.att_verdict(att2, 'success', p_issued => now() - interval '90 seconds');
  r := public.app_attendance_attempt_complete(att2, v->'result', v->>'signature');
  assert r->>'status' = 'failed' and r->>'reason' = 'expired', 'expired';
  assert (public.app_attendance_attempt_material(att2))->>'state' = 'failed';
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_out');
  att2 := (r->>'attempt_id')::uuid;
  v := public.att_verdict(att2, 'success');
  r := public.app_attendance_attempt_complete(att2, v->'result', v->>'signature');
  assert r->>'status' = 'succeeded' and r->'event'->>'kind' = 'check_out', 'check-out recorded';

  -- The camera failed before the verifier answered: a reviewable failure, no event.
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_in');
  r := public.app_attendance_attempt_fail((r->>'attempt_id')::uuid, 'camera_stopped');
  assert r->>'status' = 'failed' and r->>'reason' = 'camera_stopped';
  perform public.att_expect('22023', format('select public.app_attendance_attempt_fail(%L, %L)', att2, 'face_matched'));
  -- Signed failures are recorded with their metrics, never with an embedding.
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_b, 'check_in');
  att_b := (r->>'attempt_id')::uuid;
  v := public.att_verdict(att_b, 'failure', 'face_mismatch');
  r := public.app_attendance_attempt_complete(att_b, v->'result', v->>'signature');
  assert r->>'status' = 'failed' and r->>'reason' = 'face_mismatch';
  perform public.att_act_as(null);
  assert (select verification ? 'match_score' and not verification ? 'embedding' from public.attendance_attempts where id = att_b),
    'metrics kept, arrays dropped';
  assert public.att_event_count() = 2, 'two events in total';
  assert (select count(*) from public.attendance_events e join public.attendance_attempts t on t.id = e.attempt_id
          where t.status = 'succeeded' and t.event_id = e.id) = 2, 'each event comes from one succeeded attempt';
  assert (select count(*) from public.audit_log where action in ('attendance.checked_in', 'attendance.checked_out')) = 2;
end $$;

-- ------------------------------------------------------------------ 7. brute-force brake
-- Employee C collected five refused verdicts in section 6; employee B has two failures and goes on.
do $$
declare
  code_b text := (select employee_number from public.employees where id = (select x.v from att_ids x where k = 'b'));
  code_c text := (select employee_number from public.employees where id = (select x.v from att_ids x where k = 'c'));
  r jsonb; v jsonb; i int;
begin
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_c, 'check_in');
  assert r->>'status' = 'refused' and r->>'reason' = 'too_many_failures', 'five failures pause the ID';
  for i in 1..3 loop
    r := public.app_attendance_attempt_start(gen_random_uuid(), code_b, 'check_in');
    assert r->>'status' = 'pending', 'B is not paused yet';
    v := public.att_verdict((r->>'attempt_id')::uuid, 'failure', 'liveness_failed');
    perform public.app_attendance_attempt_complete((r->>'attempt_id')::uuid, v->'result', v->>'signature');
  end loop;
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_b, 'check_in');
  assert r->>'reason' = 'too_many_failures', 'B is paused after its fifth failure';
  -- Failures older than fifteen minutes no longer count.
  perform public.att_act_as(null);
  alter table public.attendance_attempts disable trigger attendance_attempts_settle_once;
  update public.attendance_attempts set created_at = created_at - interval '16 minutes'
  where employee_id = (select x.v from att_ids x where k = 'b') and status = 'failed';
  alter table public.attendance_attempts enable trigger attendance_attempts_settle_once;
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_b, 'check_in');
  assert r->>'status' = 'pending', 'B may try again after the pause';
  perform public.att_act_as(null);
end $$;

-- ------------------------------------------------------------------ 8. deactivation takes effect at once
do $$
declare
  a uuid := (select x.v from att_ids x where k = 'a');
  code_a text := (select employee_number from public.employees where id = a);
  r jsonb; v jsonb; att uuid;
begin
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_in');
  att := (r->>'attempt_id')::uuid;
  v := public.att_verdict(att, 'success');
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  perform public.app_attendance_employee_set_active(a, false, 'Left the company (test)');
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  r := public.app_attendance_attempt_complete(att, v->'result', v->>'signature');
  assert r->>'status' = 'failed' and r->>'reason' = 'employee_inactive', 'a deactivated employee cannot finish an attempt';
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_in');
  assert r->>'reason' = 'employee_inactive', 'nor start one';
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  perform public.app_attendance_employee_set_active(a, true);

  -- Deleting the face reference cancels pending attempts and blocks new ones.
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_in');
  att := (r->>'attempt_id')::uuid;
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  perform public.att_expect('22023', format('select public.app_attendance_reference_delete(%L, %L)', a, ''));
  assert public.app_attendance_reference_delete(a, 'Employee asked for deletion (test)');
  perform public.att_act_as(null);
  assert (select status from public.attendance_attempts where id = att) = 'superseded';
  assert not exists (select 1 from app_private.attendance_face_references where employee_id = a and ciphertext is not null), 'erased';
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  assert (public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_in'))->>'reason' = 'not_enrolled';
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  perform public.att_enroll(a);

  -- A device switched off mid-attempt: the attempt fails and the kiosk is refused.
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  r := public.app_attendance_attempt_start(gen_random_uuid(), code_a, 'check_in');
  att := (r->>'attempt_id')::uuid;
  v := public.att_verdict(att, 'success');
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  perform public.att_expect('22023', format('select public.app_attendance_device_set_active(%L, false, null)', (select x.v from att_ids x where k = 'device')));
  perform public.app_attendance_device_set_active((select x.v from att_ids x where k = 'device'), false, 'Laptop replaced (test)');
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  assert public.app_attendance_kiosk_context()->>'state' = 'device_inactive';
  perform public.att_expect('42501', format('select public.app_attendance_attempt_complete(%L, %L::jsonb, %L)', att, v->'result', v->>'signature'), 'device_inactive');
  perform public.att_expect('42501', $q$select public.app_attendance_attempt_start(gen_random_uuid(), '1', 'check_in')$q$, 'device_inactive');
  perform public.att_act_as(null);
  assert (select status = 'failed' and reason = 'device_inactive' from public.attendance_attempts where id = att);
  -- Disabling the kiosk's staff account also stops it.
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  perform public.app_attendance_device_set_active((select x.v from att_ids x where k = 'device'), true);
  perform public.att_act_as(null);
  update public.staff_accounts set is_active = false, disabled_at = now() where user_id = 'a1300000-0000-4000-8000-000000000004';
  perform public.att_act_as('a1300000-0000-4000-8000-000000000004');
  assert public.app_attendance_kiosk_context()->>'state' = 'account_inactive';
  perform public.att_act_as(null);
  update public.staff_accounts set is_active = true, disabled_at = null where user_id = 'a1300000-0000-4000-8000-000000000004';
end $$;

-- ------------------------------------------------------------------ 9. corrections keep the original
do $$
declare
  a uuid := (select x.v from att_ids x where k = 'a');
  out_event uuid; in_event uuid; c jsonb; c2 jsonb; req uuid := gen_random_uuid(); n int; rep jsonb;
begin
  select id into in_event from public.attendance_events where employee_id = a and kind = 'check_in';
  select id into out_event from public.attendance_events where employee_id = a and kind = 'check_out';
  perform public.att_act_as('a1300000-0000-4000-8000-000000000002');
  perform public.att_expect('42501', format('select public.app_attendance_correct(gen_random_uuid(), %L, null, %L, null, null, %L)', 'void', out_event, 'manager try'));
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  perform public.att_expect('22023', format('select public.app_attendance_correct(gen_random_uuid(), %L, null, %L, null, %L::timestamp, %L)', 'retime', out_event, '2026-11-02 17:10', ' '), 'reason_required');
  perform public.att_expect('22023', format('select public.app_attendance_correct(gen_random_uuid(), %L, null, %L, null, %L::timestamp, %L)', 'retime', out_event, '2099-01-01 17:10', 'future'), 'time_in_future');
  c := public.app_attendance_correct(req, 'retime', null, out_event, null, '2026-11-02 17:10:00', 'Checked out late by mistake (test)');
  c2 := public.app_attendance_correct(req, 'retime', null, out_event, null, '2026-11-02 17:10:00', 'Checked out late by mistake (test)');
  assert c->>'correction_id' = c2->>'correction_id' and (c2->>'replayed')::boolean, 'a repeated correction is one correction';
  perform public.att_expect('23505', format('select public.app_attendance_correct(gen_random_uuid(), %L, null, %L, null, null, %L)', 'void', out_event, 'again'), 'event_already_corrected');
  perform public.att_act_as(null);
  assert exists (select 1 from public.attendance_events where id = out_event), 'the original event stays';
  assert (select occurred_at = ('2026-11-02 17:10:00'::timestamp at time zone 'Africa/Casablanca') and source = 'correction'
          from public.attendance_events where id = (c->>'event_id')::uuid), 'the corrected time is branch-local';
  assert exists (select 1 from public.audit_log where action = 'attendance.event_corrected' and changes->>'reason' = 'Checked out late by mistake (test)'
                 and changes->'original'->>'kind' = 'check_out'), 'audited with the original';
  -- Adding a missing check-out and voiding an event.
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  c := public.app_attendance_correct(gen_random_uuid(), 'add', (select x.v from att_ids x where k = 'b'), null, 'check_in', '2026-11-03 09:00', 'Kiosk was offline (test)');
  c := public.app_attendance_correct(gen_random_uuid(), 'add', (select x.v from att_ids x where k = 'b'), null, 'check_out', '2026-11-03 17:00', 'Kiosk was offline (test)');
  perform public.att_expect('22023', format('select public.app_attendance_correct(gen_random_uuid(), %L, %L, null, %L, null, %L)', 'add', (select x.v from att_ids x where k = 'b'), 'check_in', 'no time'));
  c := public.app_attendance_correct(gen_random_uuid(), 'void', null, in_event, null, null, 'Duplicate (test)');
  rep := public.app_attendance_report('maarif', '2026-11-01', current_date);
  assert (select count(*) from jsonb_array_elements(rep->'events') e where e->>'id' = in_event::text and not (e->>'effective')::boolean
          and e->'replaced_by_correction'->>'kind' = 'void') = 1, 'the voided event is reported, not effective';
  assert (select count(*) from jsonb_array_elements(rep->'events') e where (e->>'source') = 'correction') = 3, 'correction events reported';
  perform public.att_act_as('a1300000-0000-4000-8000-000000000002');
  perform public.att_expect('42501', $q$select public.app_attendance_report('maarif', '2026-11-01', current_date)$q$);
  perform public.att_act_as('a1300000-0000-4000-8000-000000000001');
  perform public.att_expect('22023', $q$select public.app_attendance_report('maarif', current_date, current_date - 1)$q$);
  perform public.att_expect('22023', $q$select public.app_attendance_report('maarif', '2025-01-01', '2026-11-30')$q$);
  n := (select count(*) from public.audit_log where action = 'attendance.report_exported');
  perform public.app_attendance_report('maarif', '2026-11-01', '2026-11-30', 'export', 'ar');
  perform public.att_act_as(null);
  assert (select count(*) from public.audit_log where action = 'attendance.report_exported') = n + 1, 'exports are audited';
end $$;

-- ------------------------------------------------------------------ 10. append-only history
do $$
begin
  perform public.att_expect('42501', $q$update public.attendance_events set occurred_at = now() - interval '1 hour'$q$);
  perform public.att_expect('42501', $q$delete from public.attendance_events$q$);
  perform public.att_expect('42501', $q$update public.attendance_corrections set reason = 'rewritten'$q$);
  perform public.att_expect('42501', $q$delete from public.attendance_corrections$q$);
  perform public.att_expect('42501', $q$delete from public.attendance_attempts$q$);
  perform public.att_expect('42501', $q$update public.attendance_attempts set status = 'succeeded' where status = 'failed'$q$);
  perform public.att_expect('42501', $q$truncate public.attendance_events cascade$q$);
end $$;

-- ------------------------------------------------------------------ 11. tenant isolation
do $$
begin
  perform public.att_act_as('a1300000-0000-4000-8000-000000000006');
  assert (select count(*) from public.attendance_events) = 0 and (select count(*) from public.attendance_employees) = 0
     and (select count(*) from public.attendance_attempts) = 0 and (select count(*) from public.attendance_devices) = 0,
    'another organization sees nothing';
  assert jsonb_array_length(public.app_attendance_employees('maarif')) = 0, 'its own Maarif has no employees';
  perform public.att_expect('42501', format('select public.app_attendance_employee_detail(%L)', (select x.v from att_ids x where k = 'a')));
  perform public.att_expect('42501', format('select public.app_attendance_enrollment_start(%L)', (select x.v from att_ids x where k = 'a')));
  perform public.att_expect('42501', format('select public.app_attendance_employee_set_active(%L, false, %L)', (select x.v from att_ids x where k = 'a'), 'cross-tenant'));
  perform public.att_expect('42501', format('select public.app_attendance_correct(gen_random_uuid(), %L, null, %L, null, null, %L)', 'void',
    (select id from public.attendance_events limit 1), 'cross-tenant'));
  perform public.att_expect('42501', format('select public.app_attendance_device_set_active(%L, false, %L)', (select x.v from att_ids x where k = 'device'), 'cross-tenant'));
  perform public.att_act_as(null);
end $$;

select 'attendance checks passed';
rollback;
