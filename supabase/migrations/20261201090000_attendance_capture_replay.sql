-- Exact-capture replay defense; this does NOT establish trusted camera capture or prevent altered video.
-- Store only a database-keyed HMAC of a verifier-signed digest, never frames, images or face embeddings.
-- The key is generated locally on migration; neither the key nor capture fingerprints are exposed to API roles.
create table app_private.attendance_capture_secret (
  singleton boolean primary key default true check (singleton),
  secret bytea not null default extensions.gen_random_bytes(32) check (octet_length(secret) = 32)
);
insert into app_private.attendance_capture_secret (singleton) values (true);
alter table app_private.attendance_capture_secret enable row level security;
revoke all on app_private.attendance_capture_secret from public, anon, authenticated, service_role;

create table app_private.attendance_used_captures (
  organization_id uuid not null references public.organizations(id),
  attempt_id uuid not null unique references public.attendance_attempts(id),
  fingerprint bytea not null check (octet_length(fingerprint) = 32),
  created_at timestamptz not null default now(),
  primary key (organization_id, fingerprint)
);
alter table app_private.attendance_used_captures enable row level security;
revoke all on app_private.attendance_used_captures from public, anon, authenticated, service_role;

-- Attendance reports group by calendar date, not the branch's 02:00 business-day rollover.
create function public.app_attendance_today()
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone b.timezone)::date
  from public.branches b
  where b.organization_id = app_private.current_org() and b.operates_in_app
  order by b.code limit 1;
$$;
revoke all on function public.app_attendance_today() from public, anon, authenticated, service_role;
grant execute on function public.app_attendance_today() to authenticated;

create or replace function public.app_attendance_attempt_start(p_request uuid, p_employee_code text, p_action text)
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
                           'face_inconsistent', 'invalid_verifier_signature', 'capture_replayed', 'poor_quality')) >= 5 then
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

create or replace function public.app_attendance_attempt_complete(p_attempt uuid, p_result jsonb, p_signature text)
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
  v_capture text := p_result->>'capture_hash';
  v_inserted uuid;
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

  v_expected := app_private.attendance_hmac(v_key, concat_ws('|', 'balaban-attendance', 'attempt', 'v2',
    a.id::text, encode(a.nonce, 'hex'), a.employee_id::text, a.reference_id::text, a.action,
    array_to_string(a.challenge, ','), v_capture, v_outcome, coalesce(v_reason, ''), v_engine, p_result->>'issued_at_ms', v_key));
  v_ok := coalesce(v_capture, '') ~ '^[0-9a-f]{64}$'
          and v_expected is not null and v_expected = lower(coalesce(p_signature, ''))
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

  -- Exact-byte replay defense only. The private HMAC is stable across verifier signing-key rotation.
  -- The unique index serializes concurrent completions, including attempts for different employees.
  insert into app_private.attendance_used_captures (organization_id, attempt_id, fingerprint)
  select a.organization_id, a.id, extensions.hmac(decode(v_capture, 'hex'), s.secret, 'sha256')
  from app_private.attendance_capture_secret s where s.singleton
  on conflict (organization_id, fingerprint) do nothing
  returning attempt_id into v_inserted;
  if v_inserted is null then
    update public.attendance_attempts
    set status = 'failed', reason = 'capture_replayed', completed_at = now(), verification = v_metrics
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
