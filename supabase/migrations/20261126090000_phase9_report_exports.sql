-- Phase 9: the five Excel report families.
--
-- An export is a request for one report family, its branches and its period. The application reads
-- the saved data as the requester, builds the workbook, stores it in the private `report-exports`
-- bucket and only then marks the export complete. This migration holds the record of each export and
-- the rules around it:
--
--   * one export per (requester, request identifier): a resubmitted form is the same export;
--   * status pending -> running -> complete, or running -> failed -> running (retry);
--     each run is an attempt; only the attempt that holds the claim may complete or fail it;
--   * an export is complete only when its file exists in Storage at the attempt's path with the
--     stated size; a complete export is frozen (no column may change afterwards);
--   * the permission of the report family is checked for EVERY branch of the export when it is
--     requested, claimed, completed, uploaded and downloaded, against live data;
--   * files are private: no public bucket, no update or delete, and the Storage row-level policies
--     use the same permission check, so a revoked person cannot read the file through any client;
--   * every request, attempt, failure, completion and download is kept in an append-only history.
--
-- Report figures are not stored here. They come from the saved Phase 4-8 records; `sources` keeps the
-- revision identifiers and snapshot instants the file was built from, so the file can be traced back.

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  family text not null check (family in ('sales_comparison', 'daily_ledger', 'daily_statement', 'daily_sales', 'inventory')),
  branch_ids uuid[] not null check (cardinality(branch_ids) between 1 and 3 and array_position(branch_ids, null) is null),
  branch_codes text[] not null check (cardinality(branch_codes) = cardinality(branch_ids)),
  period jsonb not null check (jsonb_typeof(period) = 'object'),
  period_label text not null check (length(period_label) between 7 and 40),
  locale text not null check (locale in ('ar', 'en')),
  include_drafts boolean not null default false,
  requested_by uuid not null references public.staff_accounts (user_id),
  requester_name text not null check (length(btrim(requester_name)) > 0),
  requested_at timestamptz not null default clock_timestamp(),
  request_id uuid not null,
  request_hash bytea not null,
  unique (requested_by, request_id),
  status text not null default 'pending' check (status in ('pending', 'running', 'failed', 'complete')),
  attempt integer not null default 0 check (attempt >= 0),
  claimed_at timestamptz,
  -- Database instant fixed when the attempt started; stock figures are read "as of" this instant.
  snapshot_at timestamptz,
  template_version text check (template_version ~ '^[a-z_]+@[0-9]+\.[0-9]+\.[0-9]+$'),
  calc_version text check (length(calc_version) between 3 and 60),
  sources jsonb check (sources is null or jsonb_typeof(sources) = 'object'),
  data_sha256 text check (data_sha256 ~ '^[0-9a-f]{64}$'),
  file_path text unique,
  file_name text check (file_name ~ '^[A-Za-z0-9._-]{5,120}\.xlsx$'),
  file_sha256 text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_bytes bigint check (file_bytes > 0),
  completed_at timestamptz,
  last_error text check (length(last_error) <= 200),
  check ((status = 'complete') = (completed_at is not null)),
  check (status <> 'complete' or (file_path is not null and file_name is not null and file_sha256 is not null
    and file_bytes is not null and template_version is not null and calc_version is not null and sources is not null
    and data_sha256 is not null and snapshot_at is not null)),
  check (status = 'pending' or attempt > 0),
  check (include_drafts = false or family in ('daily_ledger', 'daily_statement', 'daily_sales'))
);

create index report_exports_requester_idx on public.report_exports (requested_by, requested_at desc);
create index report_exports_org_idx on public.report_exports (organization_id, requested_at desc);

create table public.report_export_events (
  id bigint generated always as identity primary key,
  export_id uuid not null references public.report_exports (id),
  attempt integer not null check (attempt >= 0),
  event text not null check (event in ('requested', 'started', 'failed', 'completed', 'downloaded', 'refused')),
  happened_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  actor_name text not null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);
create index report_export_events_export_idx on public.report_export_events (export_id, id);

alter table public.report_exports enable row level security;
alter table public.report_export_events enable row level security;
revoke all on public.report_exports, public.report_export_events from public, anon, authenticated, service_role;
grant select on public.report_exports, public.report_export_events to authenticated;

-- History is append-only. The export row changes only through the commands below, never after it is complete.
create function app_private.refuse_report_export_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Nested: the history table has no status column, so the export columns are read only for exports.
  if tg_op = 'UPDATE' and tg_table_name = 'report_exports' then
    if old.status <> 'complete'
       and old.id = new.id and old.organization_id = new.organization_id and old.family = new.family
       and old.branch_ids = new.branch_ids and old.branch_codes = new.branch_codes and old.period = new.period
       and old.period_label = new.period_label and old.locale = new.locale and old.include_drafts = new.include_drafts
       and old.requested_by = new.requested_by and old.requester_name = new.requester_name
       and old.requested_at = new.requested_at and old.request_id = new.request_id and old.request_hash = new.request_hash
       and new.attempt >= old.attempt then
      return new;
    end if;
  end if;
  raise exception 'Report exports are append-only (% refused)', tg_op using errcode = '42501';
end;
$$;

create trigger report_exports_guard before update or delete on public.report_exports
  for each row execute function app_private.refuse_report_export_change();
create trigger report_exports_no_truncate before truncate on public.report_exports
  for each statement execute function app_private.refuse_report_export_change();
create trigger report_export_events_no_change before update or delete on public.report_export_events
  for each row execute function app_private.refuse_report_export_change();
create trigger report_export_events_no_truncate before truncate on public.report_export_events
  for each statement execute function app_private.refuse_report_export_change();

-- ------------------------------------------------------------------ permissions of a report family
-- The same requirements are mirrored in src/modules/exports/families.ts (a unit test compares them).
--   sales_comparison                       comparison.export on every branch
--   daily_sales, daily_statement, ledger   reports.export + daily_close.view (+ daily_close.export_draft with drafts)
--   inventory                              reports.export + inventory.view
create function app_private.report_export_requirements(p_family text, p_drafts boolean)
returns text[] language sql immutable set search_path = '' as $$
  select case p_family
    when 'sales_comparison' then array['comparison.export']
    when 'inventory' then array['reports.export', 'inventory.view']
    when 'daily_sales' then array['reports.export', 'daily_close.view'] || case when p_drafts then array['daily_close.export_draft'] else array[]::text[] end
    when 'daily_statement' then array['reports.export', 'daily_close.view'] || case when p_drafts then array['daily_close.export_draft'] else array[]::text[] end
    when 'daily_ledger' then array['reports.export', 'daily_close.view'] || case when p_drafts then array['daily_close.export_draft'] else array[]::text[] end
  end;
$$;

-- The deployment operator designates Abdo's verified staff account. A role assignment alone cannot
-- grant this access. New and upgraded organizations start without a designation.
create table app_private.report_export_owners (
  organization_id uuid primary key references public.organizations (id),
  staff_id uuid not null references public.staff_accounts (user_id)
);
alter table app_private.report_export_owners enable row level security;
revoke all on app_private.report_export_owners from public, anon, authenticated, service_role;

create function public.app_is_report_export_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app_private.report_export_owners o
    where o.organization_id = app_private.current_org()
      and o.staff_id = auth.uid());
$$;

-- The requester must still be the designated staff account and hold each branch permission.
create function app_private.report_export_allowed(p_export uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_is_report_export_owner() and exists (
    select 1 from public.report_exports e
    where e.id = p_export
      and e.requested_by = auth.uid()
      and e.organization_id = app_private.current_org()
      and not exists (
        select 1 from unnest(e.branch_ids) as br(id)
        cross join unnest(app_private.report_export_requirements(e.family, e.include_drafts)) as req(permission)
        where not app_private.has_permission(req.permission, br.id)));
$$;

create policy report_exports_read on public.report_exports for select to authenticated
  using (organization_id = app_private.current_org()
    and (requested_by = auth.uid() or app_private.has_permission('admin.audit.view')));
create policy report_export_events_read on public.report_export_events for select to authenticated
  using (exists (select 1 from public.report_exports e where e.id = export_id
    and e.organization_id = app_private.current_org()
    and (e.requested_by = auth.uid() or app_private.has_permission('admin.audit.view'))));

create function app_private.report_export_event(p_export uuid, p_attempt integer, p_event text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  select e.full_name into v_name from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = auth.uid();
  insert into public.report_export_events (export_id, attempt, event, actor_id, actor_name, detail)
  values (p_export, p_attempt, p_event, auth.uid(), coalesce(v_name, 'unknown'), coalesce(p_detail, '{}'::jsonb));
end;
$$;

create function app_private.report_export_json(e public.report_exports)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'family', e.family, 'branches', to_jsonb(e.branch_codes), 'period', e.period,
    'period_label', e.period_label, 'locale', e.locale, 'include_drafts', e.include_drafts, 'requester', e.requester_name,
    'requested_at', e.requested_at, 'status', e.status, 'attempt', e.attempt, 'snapshot_at', e.snapshot_at,
    'template_version', e.template_version, 'calc_version', e.calc_version, 'sources', e.sources,
    'data_sha256', e.data_sha256, 'file_path', e.file_path, 'file_name', e.file_name, 'file_sha256', e.file_sha256,
    'file_bytes', e.file_bytes, 'completed_at', e.completed_at, 'last_error', e.last_error, 'request_id', e.request_id,
    'mine', e.requested_by = auth.uid(),
    -- Branch-local times are formatted by PostgreSQL, the time-zone authority (Phase 4).
    'requested_local', to_char(e.requested_at at time zone z.timezone, 'YYYY-MM-DD"T"HH24:MI'),
    'snapshot_local', to_char(e.snapshot_at at time zone z.timezone, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'completed_local', to_char(e.completed_at at time zone z.timezone, 'YYYY-MM-DD"T"HH24:MI'))
  from (select coalesce((select b.timezone from public.branches b where b.id = e.branch_ids[1]), 'Africa/Casablanca') as timezone) z;
$$;

-- Validates the period of a family and returns its label (YYYY-MM, YYYY-MM-DD or "current vs prior").
create function app_private.report_export_period(p_family text, p_period jsonb, p_today date)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_mode text := p_period ->> 'mode';
  v_month date;
  v_date date;
  v_prior date;
  v_keys text[];
begin
  select array_agg(k order by k) into v_keys from jsonb_object_keys(p_period) k;
  if v_mode = 'month' and v_keys = array['mode', 'month'] and p_period ->> 'month' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    v_month := (p_period ->> 'month' || '-01')::date;
    if v_month < date '2000-02-01' or v_month > p_today then
      raise exception 'Invalid report period' using errcode = '22023';
    end if;
    if p_family not in ('sales_comparison', 'daily_ledger', 'daily_statement', 'daily_sales', 'inventory') then
      raise exception 'Invalid report period' using errcode = '22023';
    end if;
    return p_period ->> 'month';
  elsif v_mode = 'day' and v_keys = array['date', 'mode'] and p_family in ('daily_statement', 'daily_ledger', 'inventory')
        and p_period ->> 'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_date := (p_period ->> 'date')::date;
    if v_date < date '2000-01-01' or v_date > p_today then
      raise exception 'Invalid report period' using errcode = '22023';
    end if;
    return p_period ->> 'date';
  elsif v_mode = 'week' and v_keys = array['current', 'mode', 'prior'] and p_family = 'sales_comparison'
        and p_period ->> 'current' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and p_period ->> 'prior' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_date := (p_period ->> 'current')::date;
    v_prior := (p_period ->> 'prior')::date;
    if v_prior >= v_date or extract(isodow from v_prior) <> extract(isodow from v_date)
       or v_prior < date '2000-01-01' or v_date > p_today then
      raise exception 'Invalid report period' using errcode = '22023';
    end if;
    return (p_period ->> 'current') || ' vs ' || (p_period ->> 'prior');
  end if;
  raise exception 'Invalid report period' using errcode = '22023';
end;
$$;

-- ------------------------------------------------------------------ commands
create function public.app_report_export_request(
  p_family text, p_branches text[], p_period jsonb, p_locale text, p_include_drafts boolean, p_request uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid := app_private.current_org();
  v_ids uuid[];
  v_codes text[];
  v_today date;
  v_label text;
  v_hash bytea;
  v_name text;
  v_row public.report_exports%rowtype;
  v_permission text;
  v_branch uuid;
begin
  if auth.uid() is null or v_org is null or p_request is null or p_family is null or p_branches is null
     or p_locale is null or p_locale not in ('ar', 'en') or p_include_drafts is null
     or jsonb_typeof(p_period) is distinct from 'object' or pg_column_size(p_period) > 512
     or cardinality(p_branches) not between 1 and 3 or array_position(p_branches, null) is not null
     or (select count(distinct x) from unnest(p_branches) x) <> cardinality(p_branches) then
    raise exception 'Invalid export request' using errcode = '22023';
  end if;
  if p_family not in ('sales_comparison', 'daily_ledger', 'daily_statement', 'daily_sales', 'inventory') then
    raise exception 'Invalid export request' using errcode = '22023';
  end if;
  if p_include_drafts and p_family not in ('daily_ledger', 'daily_statement', 'daily_sales') then
    raise exception 'Drafts are not exported for this report' using errcode = '22023';
  end if;
  if not public.app_is_report_export_owner() then
    raise exception 'Export permission required' using errcode = '42501';
  end if;

  -- Branches in the fixed report order (Al Quds, Maarif, Bourgogne); unknown or foreign codes are refused.
  select array_agg(b.id order by array_position(array['alquds', 'maarif', 'bourgogne'], b.code), b.code),
         array_agg(b.code order by array_position(array['alquds', 'maarif', 'bourgogne'], b.code), b.code),
         min(public.business_date_of(clock_timestamp(), b.timezone, b.business_day_rollover))
    into v_ids, v_codes, v_today
  from public.branches b where b.organization_id = v_org and b.code = any (p_branches);
  if coalesce(cardinality(v_ids), 0) <> cardinality(p_branches) then
    raise exception 'Invalid export request' using errcode = '22023';
  end if;
  if p_family <> 'sales_comparison' and (cardinality(v_ids) <> 1 or not exists (
       select 1 from public.branches b where b.id = v_ids[1] and b.operates_in_app)) then
    raise exception 'This report covers the operating branch only' using errcode = '22023';
  end if;

  foreach v_branch in array v_ids loop
    foreach v_permission in array app_private.report_export_requirements(p_family, p_include_drafts) loop
      if not app_private.has_permission(v_permission, v_branch) then
        raise exception 'Export permission required' using errcode = '42501';
      end if;
    end loop;
  end loop;

  v_label := app_private.report_export_period(p_family, p_period, v_today);
  v_hash := sha256(convert_to(jsonb_build_object('family', p_family, 'branches', to_jsonb(v_codes), 'period', p_period,
    'locale', p_locale, 'drafts', p_include_drafts)::text, 'UTF8'));

  select e.full_name into v_name from public.staff_accounts s join public.employees e on e.id = s.employee_id where s.user_id = auth.uid();
  insert into public.report_exports (organization_id, family, branch_ids, branch_codes, period, period_label, locale, include_drafts,
    requested_by, requester_name, request_id, request_hash)
  values (v_org, p_family, v_ids, v_codes, p_period, v_label, p_locale, p_include_drafts, auth.uid(), v_name, p_request, v_hash)
  on conflict (requested_by, request_id) do nothing
  returning * into v_row;
  if not found then
    select * into strict v_row from public.report_exports where requested_by = auth.uid() and request_id = p_request;
    if v_row.request_hash <> v_hash then
      raise exception 'Request identifier already used' using errcode = '23505';
    end if;
    return app_private.report_export_json(v_row) || jsonb_build_object('replayed', true);
  end if;
  perform app_private.report_export_event(v_row.id, 0, 'requested', jsonb_build_object('family', p_family, 'period', v_label));
  perform app_private.write_audit(v_org, 'operation', 'report_export.request', 'report_export', v_row.id::text,
    p_family || ' ' || v_label, case when cardinality(v_ids) = 1 then v_ids[1] end,
    jsonb_build_object('family', p_family, 'branches', to_jsonb(v_codes), 'period', v_label, 'locale', p_locale, 'drafts', p_include_drafts));
  return app_private.report_export_json(v_row) || jsonb_build_object('replayed', false);
end;
$$;

-- Starts an attempt. A finished export answers "complete" and nothing changes; a run in progress
-- answers "busy" unless its claim is older than ten minutes (an abandoned run), which a retry takes over.
create function public.app_report_export_claim(p_export uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row public.report_exports%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_row from public.report_exports where id = p_export for update;
  if not found or v_row.requested_by is distinct from auth.uid() then
    raise exception 'Export not found' using errcode = 'P0002';
  end if;
  if not app_private.report_export_allowed(p_export) then
    raise exception 'Export permission required' using errcode = '42501';
  end if;
  if v_row.status = 'complete' then
    return app_private.report_export_json(v_row) || jsonb_build_object('claim', 'complete');
  end if;
  if v_row.status = 'running' and v_row.claimed_at > v_now - interval '10 minutes' then
    return app_private.report_export_json(v_row) || jsonb_build_object('claim', 'busy');
  end if;
  update public.report_exports set status = 'running', attempt = attempt + 1, claimed_at = v_now, snapshot_at = v_now,
    last_error = null
  where id = p_export returning * into v_row;
  perform app_private.report_export_event(p_export, v_row.attempt, 'started', '{}'::jsonb);
  return app_private.report_export_json(v_row) || jsonb_build_object('claim', 'claimed',
    'upload_path', v_row.organization_id::text || '/' || v_row.id::text || '/attempt-' || v_row.attempt || '.xlsx');
end;
$$;

create function public.app_report_export_complete(
  p_export uuid, p_attempt integer, p_file_name text, p_file_sha256 text, p_file_bytes bigint,
  p_template_version text, p_calc_version text, p_sources jsonb, p_data_sha256 text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row public.report_exports%rowtype;
  v_path text;
  v_size bigint;
begin
  select * into v_row from public.report_exports where id = p_export for update;
  if not found or v_row.requested_by is distinct from auth.uid() then
    raise exception 'Export not found' using errcode = 'P0002';
  end if;
  if not app_private.report_export_allowed(p_export) then
    raise exception 'Export permission required' using errcode = '42501';
  end if;
  if v_row.status <> 'running' or v_row.attempt is distinct from p_attempt then
    raise exception 'This attempt no longer holds the export' using errcode = '40001';
  end if;
  if jsonb_typeof(p_sources) is distinct from 'object' or pg_column_size(p_sources) > 65536 then
    raise exception 'Invalid export provenance' using errcode = '22023';
  end if;
  v_path := v_row.organization_id::text || '/' || v_row.id::text || '/attempt-' || v_row.attempt || '.xlsx';
  -- The file must be stored before the export is complete: the object exists with the stated size.
  select (o.metadata ->> 'size')::bigint into v_size from storage.objects o
  where o.bucket_id = 'report-exports' and o.name = v_path;
  if v_size is null or v_size <> p_file_bytes then
    raise exception 'The export file is not stored' using errcode = 'P0002';
  end if;
  update public.report_exports set status = 'complete', completed_at = clock_timestamp(), file_path = v_path,
    file_name = p_file_name, file_sha256 = p_file_sha256, file_bytes = p_file_bytes, template_version = p_template_version,
    calc_version = p_calc_version, sources = p_sources, data_sha256 = p_data_sha256, last_error = null
  where id = p_export returning * into v_row;
  perform app_private.report_export_event(p_export, v_row.attempt, 'completed',
    jsonb_build_object('file_sha256', p_file_sha256, 'bytes', p_file_bytes, 'template', p_template_version));
  perform app_private.write_audit(v_row.organization_id, 'operation', 'report_export.complete', 'report_export', v_row.id::text,
    v_row.family || ' ' || v_row.period_label, case when cardinality(v_row.branch_ids) = 1 then v_row.branch_ids[1] end,
    jsonb_build_object('attempt', v_row.attempt, 'file_sha256', p_file_sha256, 'template', p_template_version, 'calc', p_calc_version));
  return app_private.report_export_json(v_row);
end;
$$;

create function public.app_report_export_fail(p_export uuid, p_attempt integer, p_error text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row public.report_exports%rowtype;
  v_error text := left(coalesce(nullif(regexp_replace(p_error, '[^a-z0-9_.:-]', '', 'g'), ''), 'unexpected'), 60);
begin
  select * into v_row from public.report_exports where id = p_export for update;
  if not found or v_row.requested_by is distinct from auth.uid() then
    raise exception 'Export not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'running' or v_row.attempt is distinct from p_attempt then
    return app_private.report_export_json(v_row);
  end if;
  update public.report_exports set status = 'failed', last_error = v_error where id = p_export returning * into v_row;
  perform app_private.report_export_event(p_export, v_row.attempt, 'failed', jsonb_build_object('error', v_error));
  return app_private.report_export_json(v_row);
end;
$$;

-- Authorizes one download of a complete export and records it (or records the refusal and answers
-- {"refused": true}). Storage applies the same check again.
create function public.app_report_export_download(p_export uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row public.report_exports%rowtype;
begin
  select * into v_row from public.report_exports where id = p_export;
  if not found or v_row.requested_by is distinct from auth.uid() or v_row.status <> 'complete' then
    raise exception 'Export not found' using errcode = 'P0002';
  end if;
  -- A refusal is answered (not raised) so that the refused attempt stays in the history.
  if not app_private.report_export_allowed(p_export) then
    perform app_private.report_export_event(p_export, v_row.attempt, 'refused', jsonb_build_object('step', 'download'));
    return jsonb_build_object('refused', true, 'id', v_row.id);
  end if;
  perform app_private.report_export_event(p_export, v_row.attempt, 'downloaded', '{}'::jsonb);
  return app_private.report_export_json(v_row);
end;
$$;

create function public.app_report_exports(p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(app_private.report_export_json(e) || jsonb_build_object(
    'allowed', app_private.report_export_allowed(e.id)) order by e.requested_at desc), '[]'::jsonb)
  from (select * from public.report_exports e
        where e.requested_by = auth.uid() and e.organization_id = app_private.current_org()
        order by e.requested_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) e;
$$;

create function public.app_report_export(p_export uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select app_private.report_export_json(e) || jsonb_build_object(
    'allowed', app_private.report_export_allowed(e.id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('attempt', v.attempt, 'event', v.event, 'at', v.happened_at,
      'actor', v.actor_name, 'detail', v.detail) order by v.id) from public.report_export_events v where v.export_id = e.id), '[]'::jsonb))
  from public.report_exports e
  where e.id = p_export and e.organization_id = app_private.current_org()
    and (e.requested_by = auth.uid() or app_private.has_permission('admin.audit.view'));
$$;

revoke all on function app_private.refuse_report_export_change(), app_private.report_export_requirements(text, boolean),
  app_private.report_export_allowed(uuid), app_private.report_export_event(uuid, integer, text, jsonb),
  app_private.report_export_json(public.report_exports), app_private.report_export_period(text, jsonb, date),
  public.app_report_export_request(text, text[], jsonb, text, boolean, uuid), public.app_report_export_claim(uuid),
  public.app_report_export_complete(uuid, integer, text, text, bigint, text, text, jsonb, text),
  public.app_report_export_fail(uuid, integer, text), public.app_report_export_download(uuid),
  public.app_report_exports(integer), public.app_report_export(uuid), public.app_is_report_export_owner()
from public, anon, authenticated, service_role;
grant execute on function app_private.report_export_requirements(text, boolean), app_private.report_export_allowed(uuid),
  public.app_report_export_request(text, text[], jsonb, text, boolean, uuid), public.app_report_export_claim(uuid),
  public.app_report_export_complete(uuid, integer, text, text, bigint, text, text, jsonb, text),
  public.app_report_export_fail(uuid, integer, text), public.app_report_export_download(uuid),
  public.app_report_exports(integer), public.app_report_export(uuid), public.app_is_report_export_owner()
to authenticated;

-- ------------------------------------------------------------------ private file storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-exports', 'report-exports', false, 26214400,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

-- An object name is "<organization>/<export>/attempt-<n>.xlsx".
create function app_private.report_export_of_path(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/attempt-[0-9]{1,6}\.xlsx$'
    then split_part(p_name, '/', 2)::uuid end;
$$;

-- Upload: only the requester, only into the path of the attempt that holds the claim, with permission.
create function app_private.report_export_may_upload(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.report_exports e
    where e.id = app_private.report_export_of_path(p_name) and e.status = 'running'
      and p_name = e.organization_id::text || '/' || e.id::text || '/attempt-' || e.attempt || '.xlsx'
      and app_private.report_export_allowed(e.id));
$$;

-- Read: the requester's complete file, with permission checked live.
create function app_private.report_export_may_read(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.report_exports e
    where e.id = app_private.report_export_of_path(p_name) and e.status = 'complete' and e.file_path = p_name
      and app_private.report_export_allowed(e.id));
$$;

revoke all on function app_private.report_export_of_path(text), app_private.report_export_may_upload(text),
  app_private.report_export_may_read(text) from public, anon, authenticated, service_role;
grant execute on function app_private.report_export_of_path(text), app_private.report_export_may_upload(text),
  app_private.report_export_may_read(text) to authenticated;

create policy report_exports_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'report-exports' and app_private.report_export_may_upload(name));
create policy report_exports_download on storage.objects for select to authenticated
  using (bucket_id = 'report-exports' and storage.allow_only_operation('object.get_authenticated')
    and app_private.report_export_may_read(name));
-- Signed links are excluded so each download must pass the current permission check.
-- No update or delete policy: a stored export file cannot be replaced or removed through the API.
