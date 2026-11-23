-- Phase 7: cross-branch sales comparison (report fields CMP-01..CMP-08).
--
-- * Al Quds and Bourgogne figures are entered per branch, business date, metric (net sales or
--   order count) and source designation. Every save is an immutable revision with its source,
--   business date, person and time. A correction adds a revision and retires the earlier one,
--   which stays readable. At most ONE active value may exist per branch, date, metric and source
--   designation: the partial unique index `comparison_entries_one_active` enforces it, whatever
--   path writes the row.
-- * Maarif figures come from its saved business days: the effective revision of a closed (or
--   corrected) Phase 4 day. A closed day wins over any entered figure for the same branch and date.
-- * The approved live source and the entry owner for Al Quds and Bourgogne are still open
--   (a question for Abdo). Both are configurable per branch and start unset. The built-in
--   `reporting_only` designation keeps working.
-- * Dates before a branch's first live business date are unavailable, except figures entered
--   specifically as historical figures for a report, which must name their source.
-- * Entering (comparison.enter), viewing (comparison.view) and exporting (comparison.export) are
--   checked separately by row-level security and by the report function.
--
-- The Phase 2 table `comparison_figures` becomes a compatibility view over the revisions, so the
-- seed and existing direct inserts keep working; such an insert goes through the same checked
-- entry command.

-- The three permissions and their groups are unchanged from Phase 3: comparison.enter (Comparison
-- Editor, System Admin), comparison.view (Manager for the branches they are assigned, System Admin)
-- and comparison.export (System Admin). Phase 7 enforces them on the new objects below.

-- ------------------------------------------------------------------ source designations
create table public.comparison_sources (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- NULL: built in for every organization. Otherwise added by that organization's administrator.
  organization_id uuid references public.organizations (id),
  label_en text not null check (length(btrim(label_en)) between 1 and 80),
  label_ar text not null check (length(btrim(label_ar)) between 1 and 80),
  active boolean not null default true,
  created_by uuid references public.staff_accounts (user_id),
  created_at timestamptz not null default now()
);

insert into public.comparison_sources (key, label_en, label_ar) values
  ('reporting_only', 'Reporting-only entry', 'إدخال للتقارير فقط');

-- ------------------------------------------------------------------ per-branch settings
-- No row means "not decided": no live source, no entry owner, no configured first live date.
create table public.comparison_branch_settings (
  branch_id uuid primary key references public.branches (id),
  live_source text references public.comparison_sources (key),
  entry_owner_id uuid references public.staff_accounts (user_id),
  live_from date check (live_from is null or (isfinite(live_from) and live_from >= date '2000-01-01')),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid references public.staff_accounts (user_id),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ entered values and their revisions
create table public.comparison_entries (
  id bigint generated always as identity primary key,
  branch_id uuid not null references public.branches (id),
  business_date date not null check (isfinite(business_date) and business_date >= date '2000-01-01'),
  metric text not null check (metric in ('net_sales', 'order_count')),
  source text not null references public.comparison_sources (key),
  -- 'historical': a figure from before the first live business date, entered for a report.
  purpose text not null check (purpose in ('live', 'historical')),
  revision integer not null check (revision > 0),
  previous_id bigint unique references public.comparison_entries (id),
  -- Net sales in centimes; orders as a count. NULL only on a correction that withdraws a value.
  value bigint check (value between 0 and 99999999999999),
  source_reference text not null default '' check (length(source_reference) <= 200),
  reason text check (reason is null or length(btrim(reason)) between 1 and 500),
  active boolean not null default true,
  request_id uuid not null,
  request_hash bytea not null,
  actor_id uuid references public.staff_accounts (user_id),
  actor_name text not null,
  entered_at timestamptz not null default clock_timestamp(),
  check ((revision = 1) = (previous_id is null)),
  check (value is not null or revision > 1),
  check (revision = 1 or reason is not null),
  check (metric <> 'order_count' or value <= 2147483647),
  check (purpose <> 'historical' or length(btrim(source_reference)) > 0),
  unique (branch_id, business_date, metric, source, revision),
  unique (branch_id, request_id, metric)
);

-- One active value per branch, business date, metric and source designation.
create unique index comparison_entries_one_active
  on public.comparison_entries (branch_id, business_date, metric, source) where active;
create index comparison_entries_branch_date_idx on public.comparison_entries (branch_id, business_date);

-- History is append-only. The only change allowed is retiring the active revision, nothing else.
create function app_private.comparison_entry_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.active and not new.active
     and (to_jsonb(new) - 'active') = (to_jsonb(old) - 'active') then
    return new;
  end if;
  raise exception 'Comparison history is append-only' using errcode = '42501';
end;
$$;

create trigger comparison_entries_guard before update or delete on public.comparison_entries
  for each row execute function app_private.comparison_entry_guard();
create trigger comparison_entries_no_truncate before truncate on public.comparison_entries
  for each statement execute function app_private.comparison_entry_guard();

-- ------------------------------------------------------------------ existing Phase 2/3 figures become revision 1
drop view public.branch_daily_figures;

insert into public.comparison_entries
  (branch_id, business_date, metric, source, purpose, revision, value, request_id, request_hash, actor_id, actor_name, entered_at)
select f.branch_id, f.business_date, m.metric, f.source, 'live', 1, m.value, f.id,
       sha256(convert_to(f.id::text, 'UTF8')), who.actor_id, coalesce(who.actor_name, 'system'), f.entered_at
from public.comparison_figures f
cross join lateral (values ('net_sales', round(f.net_sales * 100)::bigint), ('order_count', f.order_count::bigint)) m(metric, value)
left join lateral (
  select s.user_id as actor_id, a.actor_name
  from public.audit_log a
  left join public.staff_accounts s on s.user_id = a.actor_id
  where a.target_type = 'comparison_figures' and a.target_id = f.id::text
  order by a.id limit 1
) who on true
where m.value is not null;

drop table public.comparison_figures;

-- ------------------------------------------------------------------ row-level security and grants
alter table public.comparison_sources enable row level security;
alter table public.comparison_branch_settings enable row level security;
alter table public.comparison_entries enable row level security;

revoke all on public.comparison_sources, public.comparison_branch_settings, public.comparison_entries
  from public, anon, authenticated, service_role;
grant select on public.comparison_sources, public.comparison_branch_settings, public.comparison_entries to authenticated;

create policy comparison_sources_read on public.comparison_sources for select to authenticated
  using (app_private.access_cleared() and (organization_id is null or organization_id = app_private.current_org()));

create policy comparison_branch_settings_read on public.comparison_branch_settings for select to authenticated
  using (
    app_private.has_permission('comparison.view', branch_id)
    or app_private.has_permission('comparison.enter', branch_id)
    or app_private.has_permission('comparison.export', branch_id)
    or (app_private.has_permission('admin.config.manage') and app_private.can_see_branch(branch_id))
  );

-- Reading entered figures (and every earlier revision) needs comparison.view for that branch.
-- Entering does not grant it; exporting reads through app_comparison_report instead.
create policy comparison_entries_read on public.comparison_entries for select to authenticated
  using (app_private.has_permission('comparison.view', branch_id));

-- ------------------------------------------------------------------ daily figures of every source
-- One row per branch, business date and metric. Precedence for a branch and date:
--   1. the effective revision of a closed or corrected Phase 4 day (Maarif's daily close);
--   2. a closed Phase 2 demonstration day (`business_days`, local seed data only);
--   3. entered values: per metric, the branch's configured live source, then `reporting_only`,
--      then any other designation by key. A withdrawn value counts as missing.
-- Closed days of the caller's organization. Every closed day is listed, so an entered figure for the
-- same branch and date is never counted instead of it; its sales and orders are returned only where
-- the caller may see them:
--   'read'   (the combined view): daily_close.view or comparison.view for that branch;
--   'view'   (the report):        comparison.view;
--   'export' (the export):        comparison.export.
-- Each mode only returns what the caller's own permission already allows. Without a signed-in
-- person (the database owner, e.g. a SQL check run as postgres) every branch is listed and visible.
create function app_private.comparison_closed_days(p_from date, p_to date, p_access text)
returns table (
  branch_id uuid, business_date date, origin text, visible boolean, sales bigint, orders bigint,
  record text, revision integer, actor_name text, recorded_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with scope as (
    select b.id,
           case when auth.uid() is null then true
                when p_access = 'view' then app_private.has_permission('comparison.view', b.id)
                when p_access = 'export' then app_private.has_permission('comparison.export', b.id)
                else app_private.has_permission('comparison.view', b.id) or app_private.has_permission('daily_close.view', b.id)
           end as visible
    from public.branches b
    where auth.uid() is null or b.organization_id = app_private.current_org()
  ), live as (
    select d.branch_id, d.business_date, v.id as basis, v.revision, v.actor_name,
           coalesce(v.closed_at, v.posted_at) as recorded_at,
           (v.data ->> 'sales')::bigint as sales, (v.data ->> 'orders')::bigint as orders
    from public.operating_days d
    join scope on scope.id = d.branch_id
    cross join lateral (
      select r.id, r.revision, r.actor_name, r.closed_at, r.posted_at, r.state, r.data
      from public.operating_day_revisions r
      where r.day_id = d.id and r.effective
      order by r.id desc limit 1
    ) v
    where d.business_date between p_from and p_to
      and v.state in ('closed', 'corrected') and v.data ->> 'sales' is not null
  ), legacy as (
    select bd.branch_id, bd.business_date, bd.id, bd.revision, bd.closed_at,
           round(bd.net_sales * 100)::bigint as sales, bd.order_count::bigint as orders
    from public.business_days bd
    join scope on scope.id = bd.branch_id
    where bd.status = 'closed' and bd.net_sales is not null
      and bd.business_date between p_from and p_to
      and not exists (select 1 from live l where l.branch_id = bd.branch_id and l.business_date = bd.business_date)
  )
  select l.branch_id, l.business_date, 'closed_day', s.visible,
         case when s.visible then l.sales end, case when s.visible then l.orders end,
         'operating_day_revisions:' || l.basis, l.revision, l.actor_name, l.recorded_at
  from live l join scope s on s.id = l.branch_id
  union all
  select g.branch_id, g.business_date, 'legacy_day', s.visible,
         case when s.visible then g.sales end, case when s.visible then g.orders end,
         'business_days:' || g.id, g.revision, 'system', g.closed_at
  from legacy g join scope s on s.id = g.branch_id;
$$;

-- SECURITY INVOKER: entered figures follow the caller's row-level security (the combined view).
-- The report function calls it with its owner's rights after checking the caller's permission.
create function app_private.comparison_daily_rows(p_from date, p_to date, p_access text default 'read')
returns table (
  branch_id uuid, business_date date, metric text, value bigint, origin text, source text, purpose text,
  record text, revision integer, source_reference text, actor_name text, recorded_at timestamptz
)
language sql stable set search_path = '' as $$
  with closed as (
    select * from app_private.comparison_closed_days(p_from, p_to, p_access)
  ), chosen as (
    select distinct on (e.branch_id, e.business_date, e.metric) e.*
    from public.comparison_entries e
    left join public.comparison_branch_settings s on s.branch_id = e.branch_id
    where e.active and e.value is not null and e.business_date between p_from and p_to
      and not exists (select 1 from closed c where c.branch_id = e.branch_id and c.business_date = e.business_date)
    -- Before the first live date a historical figure comes first, from it a live one; then the
    -- branch's live source, then reporting_only, then any other designation.
    order by e.branch_id, e.business_date, e.metric,
             ((e.purpose = 'historical') = coalesce(e.business_date < s.live_from, false)) desc,
             (e.source is not distinct from s.live_source) desc, (e.source = 'reporting_only') desc, e.source
  )
  select c.branch_id, c.business_date, m.metric, m.value, c.origin, 'daily_close', 'live',
         c.record, c.revision, '', c.actor_name, c.recorded_at
  from closed c cross join lateral (values ('net_sales', c.sales), ('order_count', c.orders)) m(metric, value)
  where c.visible and m.value is not null
  union all
  select c.branch_id, c.business_date, c.metric, c.value, 'entry', c.source, c.purpose,
         'comparison_entries:' || c.id, c.revision, c.source_reference, c.actor_name, c.entered_at
  from chosen c;
$$;

-- One row per branch and date with net sales, as in Phase 2 (a branch without a figure has no row).
create view public.branch_daily_figures
with (security_invoker = true) as
select r.branch_id, r.business_date,
       (max(r.value) filter (where r.metric = 'net_sales') / 100.0)::numeric(14, 2) as net_sales,
       (max(r.value) filter (where r.metric = 'order_count'))::integer as order_count,
       case when bool_or(r.origin = 'entry')
            then (array_agg(r.source order by (r.metric = 'net_sales') desc))[1]
            else 'closed_day' end as source,
       (array_agg(r.origin order by (r.metric = 'net_sales') desc))[1] as origin
from app_private.comparison_daily_rows('-infinity', 'infinity', 'read') r
group by r.branch_id, r.business_date
having max(r.value) filter (where r.metric = 'net_sales') is not null;

-- ------------------------------------------------------------------ entering figures
-- payload: {date, source?, purpose? ('live'|'historical'), mode? ('new'|'correct'),
--           sales? (centimes, digits or null), orders? (digits or null), reference?, reason?}
-- A metric key that is absent is left unchanged. 'new' refuses a value that already exists;
-- 'correct' needs a reason and adds a revision (null withdraws the value). The same request
-- identifier returns the first result and writes nothing more.
create function app_private.comparison_save(p_branch uuid, p_request uuid, p_payload jsonb, p_audit text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  b public.branches%rowtype;
  s public.comparison_branch_settings%rowtype;
  cur public.comparison_entries%rowtype;
  saved public.comparison_entries%rowtype;
  v_date date;
  v_source text;
  v_purpose text;
  v_mode text;
  v_reference text;
  v_reason text;
  v_hash bytea;
  v_today date;
  v_actor text;
  v_metric text;
  v_key text;
  v_new bigint;
  v_has boolean;
  v_changes jsonb := '[]'::jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  if caller is null or p_branch is null or p_request is null or jsonb_typeof(p_payload) is distinct from 'object'
     or pg_column_size(p_payload) > 4096 or (p_audit is not null and p_audit <> 'comparison_figures.created') then
    raise exception 'Invalid comparison request' using errcode = '22023';
  end if;
  select * into b from public.branches where id = p_branch and organization_id = app_private.current_org();
  if not found or not app_private.has_permission('comparison.enter', b.id) then
    raise exception 'Comparison entry permission required' using errcode = '42501';
  end if;
  select * into s from public.comparison_branch_settings where branch_id = b.id;
  if s.entry_owner_id is not null and s.entry_owner_id <> caller then
    raise exception 'Only the configured entry owner enters this branch''s figures' using errcode = '42501';
  end if;

  -- One writer per branch at a time: a correction reads the active revision, then replaces it.
  perform 1 from public.branches where id = b.id for update;

  v_hash := sha256(convert_to(b.id::text || ':' || p_payload::text, 'UTF8'));
  if exists (select 1 from public.comparison_entries e where e.branch_id = b.id and e.request_id = p_request) then
    if exists (select 1 from public.comparison_entries e where e.branch_id = b.id and e.request_id = p_request
               and (e.request_hash <> v_hash or e.actor_id is distinct from caller)) then
      raise exception 'Request identifier already used' using errcode = '23505';
    end if;
    return jsonb_build_object('replayed', true, 'revisions', (
      select jsonb_agg(jsonb_build_object('metric', e.metric, 'revision', e.revision, 'id', e.id) order by e.metric)
      from public.comparison_entries e where e.branch_id = b.id and e.request_id = p_request));
  end if;

  v_mode := coalesce(p_payload ->> 'mode', 'new');
  v_purpose := coalesce(p_payload ->> 'purpose', 'live');
  v_source := coalesce(nullif(p_payload ->> 'source', ''), 'reporting_only');
  v_reference := btrim(coalesce(p_payload ->> 'reference', ''));
  v_reason := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  if coalesce(p_payload ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid business date' using errcode = '22023';
  end if;
  begin
    v_date := (p_payload ->> 'date')::date;
  exception when others then
    raise exception 'Invalid business date' using errcode = '22023';
  end;
  if v_mode not in ('new', 'correct') or v_purpose not in ('live', 'historical')
     or length(v_reference) > 200 or length(v_reason) > 500
     or v_date < date '2000-01-01' or not (p_payload ? 'sales' or p_payload ? 'orders') then
    raise exception 'Invalid comparison request' using errcode = '22023';
  end if;
  if v_mode = 'correct' and v_reason is null then
    raise exception 'A correction needs a reason' using errcode = '22023';
  end if;
  if not exists (select 1 from public.comparison_sources c where c.key = v_source and c.active
                 and (c.organization_id is null or c.organization_id = b.organization_id)) then
    raise exception 'Unknown source designation' using errcode = '22023';
  end if;
  v_today := public.business_date_of(clock_timestamp(), b.timezone, b.business_day_rollover);
  if v_date > v_today then
    raise exception 'Business day has not started' using errcode = '22023';
  end if;
  if v_purpose = 'live' and s.live_from is not null and v_date < s.live_from then
    raise exception 'Before the first live business date: enter it as a historical figure' using errcode = '22023';
  end if;
  if v_purpose = 'historical' and (s.live_from is null or v_date >= s.live_from or v_reference = '') then
    raise exception 'A historical figure needs a first live date, an earlier business date and its source' using errcode = '22023';
  end if;

  select e.full_name into v_actor from public.staff_accounts sa join public.employees e on e.id = sa.employee_id
  where sa.user_id = caller;

  foreach v_metric in array array['net_sales', 'order_count'] loop
    v_key := case v_metric when 'net_sales' then 'sales' else 'orders' end;
    continue when not (p_payload ? v_key);
    if jsonb_typeof(p_payload -> v_key) = 'null' then
      v_new := null;
    elsif (p_payload ->> v_key) ~ '^[0-9]{1,14}$' then
      v_new := (p_payload ->> v_key)::bigint;
    else
      raise exception 'Invalid sales or orders' using errcode = '22023';
    end if;
    if v_metric = 'order_count' and v_new > 2147483647 then
      raise exception 'Invalid sales or orders' using errcode = '22023';
    end if;

    select * into cur from public.comparison_entries
    where branch_id = b.id and business_date = v_date and metric = v_metric and source = v_source and active;
    v_has := found;
    if v_mode = 'new' then
      continue when v_new is null;
      if v_has then
        raise exception 'A value is already recorded for this branch, date, figure and source; submit a correction'
          using errcode = '23505';
      end if;
    else
      continue when v_has and cur.value is not distinct from v_new;
      continue when not v_has and v_new is null;
    end if;

    if v_has then
      update public.comparison_entries set active = false where id = cur.id;
    end if;
    insert into public.comparison_entries (branch_id, business_date, metric, source, purpose, revision, previous_id,
      value, source_reference, reason, request_id, request_hash, actor_id, actor_name)
    values (b.id, v_date, v_metric, v_source, v_purpose, case when v_has then cur.revision + 1 else 1 end,
      case when v_has then cur.id end, v_new,
      -- A correction keeps the earlier revision's source reference unless it names a new one.
      case when v_has and not (p_payload ? 'reference') then cur.source_reference else v_reference end,
      v_reason, p_request, v_hash, caller, coalesce(v_actor, 'unknown'))
    returning * into saved;
    v_out := v_out || jsonb_build_object('metric', v_metric, 'revision', saved.revision, 'id', saved.id);
    v_changes := v_changes || jsonb_build_object('metric', v_metric, 'revision', saved.revision,
      'before', case when v_has then cur.value end, 'after', v_new);
  end loop;

  if jsonb_array_length(v_out) = 0 then
    raise exception 'Nothing to save' using errcode = '22023';
  end if;
  perform app_private.write_audit(b.organization_id, 'operation',
    coalesce(p_audit, case v_mode when 'new' then 'comparison.entered' else 'comparison.corrected' end),
    case when p_audit is null then 'comparison_entry' else 'comparison_figures' end, p_request::text,
    v_date::text || ' ' || v_source, b.id,
    jsonb_build_object('date', v_date, 'source', v_source, 'purpose', v_purpose, 'reference', v_reference,
                       'reason', v_reason, 'figures', v_changes));
  return jsonb_build_object('replayed', false, 'revisions', v_out);
end;
$$;

create function public.app_comparison_save(p_branch text, p_request uuid, p_payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_branch uuid;
begin
  select b.id into v_branch from public.branches b
  where b.code = p_branch and b.organization_id = app_private.current_org();
  if v_branch is null then
    raise exception 'Comparison entry permission required' using errcode = '42501';
  end if;
  return app_private.comparison_save(v_branch, p_request, p_payload);
end;
$$;

-- Trusted path for the local seed (and other database-owner scripts): revision 1, no person.
create function app_private.comparison_seed_insert(
  p_id uuid, p_branch uuid, p_date date, p_sales numeric, p_orders integer, p_source text, p_at timestamptz
)
returns void language sql security definer set search_path = '' as $$
  insert into public.comparison_entries
    (branch_id, business_date, metric, source, purpose, revision, value, request_id, request_hash, actor_id, actor_name, entered_at)
  select p_branch, p_date, m.metric, p_source, 'live', 1, m.value, p_id, sha256(convert_to(p_id::text, 'UTF8')), null, 'system', p_at
  from (values ('net_sales', round(p_sales * 100)::bigint), ('order_count', p_orders::bigint)) m(metric, value)
  where m.value is not null;
$$;

-- ------------------------------------------------------------------ Phase 2 compatibility view
create view public.comparison_figures
with (security_invoker = true) as
select (array_agg(e.request_id order by (e.metric = 'net_sales') desc, e.id))[1] as id,
       e.branch_id, e.business_date,
       (max(e.value) filter (where e.metric = 'net_sales') / 100.0)::numeric(14, 2) as net_sales,
       (max(e.value) filter (where e.metric = 'order_count'))::integer as order_count,
       e.source,
       max(e.entered_at) as entered_at
from public.comparison_entries e
where e.active and e.value is not null
group by e.branch_id, e.business_date, e.source;

-- A signed-in person's insert goes through the checked entry command (permission, entry owner,
-- dates, one active value, audit). The database owner (the local seed) writes revision 1 directly.
create function app_private.comparison_figures_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    perform app_private.comparison_save(new.branch_id, coalesce(new.id, gen_random_uuid()),
      jsonb_strip_nulls(jsonb_build_object(
        'date', new.business_date, 'source', coalesce(new.source, 'reporting_only'), 'mode', 'new', 'purpose', 'live',
        'sales', case when new.net_sales is not null then round(new.net_sales * 100)::bigint::text end,
        'orders', new.order_count::text)),
      'comparison_figures.created');
  elsif current_user in ('postgres', 'supabase_admin') then
    perform app_private.comparison_seed_insert(coalesce(new.id, gen_random_uuid()), new.branch_id, new.business_date,
      new.net_sales, new.order_count, coalesce(new.source, 'reporting_only'), coalesce(new.entered_at, now()));
  else
    raise exception 'Comparison entry permission required' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger comparison_figures_insert instead of insert on public.comparison_figures
  for each row execute function app_private.comparison_figures_insert();
-- Figures are never changed in place: a correction is a new revision through the entry command.
create trigger comparison_figures_no_change instead of update or delete on public.comparison_figures
  for each row execute function app_private.comparison_entry_guard();

-- ------------------------------------------------------------------ reading for the report and the export
-- p_access: 'view' (comparison.view) or 'export' (comparison.export), required for EVERY branch asked
-- for. Branches outside the caller's organization are refused like unauthorized ones. Values
-- before a branch's first live business date are left out unless entered as historical figures.
create function public.app_comparison_report(p_access text, p_branches text[], p_dates date[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_perm text;
  v_code text;
  b public.branches%rowtype;
  s public.comparison_branch_settings%rowtype;
  v_live date;
  v_basis text;
  v_ids uuid[] := '{}';
  v_live_by_branch jsonb := '{}'::jsonb;
  v_branches jsonb := '[]'::jsonb;
  v_figures jsonb;
begin
  if p_access is null or p_access not in ('view', 'export') then
    raise exception 'Invalid comparison request' using errcode = '22023';
  end if;
  v_perm := 'comparison.' || p_access;
  if p_branches is null or cardinality(p_branches) not between 1 and 10 or array_position(p_branches, null) is not null
     or p_dates is null or cardinality(p_dates) not between 1 and 62 or array_position(p_dates, null) is not null
     or exists (select 1 from unnest(p_dates) d where not isfinite(d)) then
    raise exception 'Invalid comparison request' using errcode = '22023';
  end if;

  foreach v_code in array p_branches loop
    select * into b from public.branches
    where organization_id = app_private.current_org() and code = v_code;
    if not found or not app_private.has_permission(v_perm, b.id) then
      raise exception 'Comparison % permission required', p_access using errcode = '42501';
    end if;
    continue when b.id = any(v_ids);
    select * into s from public.comparison_branch_settings where branch_id = b.id;
    v_live := s.live_from;
    v_basis := case when v_live is not null then 'configured' end;
    if v_live is null and b.operates_in_app then
      select min(d.business_date) into v_live from public.operating_days d where d.branch_id = b.id;
      if v_live is not null then v_basis := 'first_close'; end if;
    end if;
    v_ids := v_ids || b.id;
    v_live_by_branch := v_live_by_branch || jsonb_build_object(b.id::text, v_live);
    v_branches := v_branches || jsonb_build_object(
      'code', b.code, 'nameEn', b.name_en, 'nameAr', b.name_ar, 'operatesInApp', b.operates_in_app,
      'liveFrom', v_live, 'liveFromBasis', v_basis,
      'liveSource', s.live_source,
      'liveSourceEn', (select c.label_en from public.comparison_sources c where c.key = s.live_source),
      'liveSourceAr', (select c.label_ar from public.comparison_sources c where c.key = s.live_source),
      'entryOwner', (select e.full_name from public.staff_accounts sa join public.employees e on e.id = sa.employee_id
                     where sa.user_id = s.entry_owner_id),
      'today', public.business_date_of(now(), b.timezone, b.business_day_rollover));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'branch', br.code, 'date', r.business_date, 'metric', r.metric, 'value', r.value, 'origin', r.origin,
      'source', r.source, 'sourceEn', c.label_en, 'sourceAr', c.label_ar, 'purpose', r.purpose,
      'record', r.record, 'revision', r.revision, 'reference', r.source_reference,
      'actor', r.actor_name, 'recordedAt', r.recorded_at)
      order by br.code, r.business_date, r.metric), '[]'::jsonb)
  into v_figures
  from app_private.comparison_daily_rows(
         (select min(d) from unnest(p_dates) d), (select max(d) from unnest(p_dates) d), p_access) r
  join public.branches br on br.id = r.branch_id
  left join public.comparison_sources c on c.key = r.source
  where r.branch_id = any(v_ids) and r.business_date = any(p_dates)
    and (v_live_by_branch ->> r.branch_id::text is null
         or r.business_date >= (v_live_by_branch ->> r.branch_id::text)::date
         or (r.origin = 'entry' and r.purpose = 'historical'));

  return jsonb_build_object('access', p_access, 'branches', v_branches, 'figures', v_figures);
end;
$$;

-- ------------------------------------------------------------------ what the entry screen may show
-- Only the branches where the caller may enter figures, with their settings. No figure is returned:
-- entering does not grant viewing.
create function public.app_comparison_entry_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', b.code, 'nameEn', b.name_en, 'nameAr', b.name_ar, 'liveFrom', s.live_from,
        'liveSource', s.live_source, 'ownerSet', s.entry_owner_id is not null,
        'ownerIsMe', s.entry_owner_id is not distinct from auth.uid() and s.entry_owner_id is not null,
        'today', public.business_date_of(now(), b.timezone, b.business_day_rollover)) order by b.name_en)
      from public.branches b
      left join public.comparison_branch_settings s on s.branch_id = b.id
      where b.organization_id = app_private.current_org() and app_private.has_permission('comparison.enter', b.id)), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('key', c.key, 'labelEn', c.label_en, 'labelAr', c.label_ar) order by c.organization_id nulls first, c.key)
      from public.comparison_sources c
      where c.active and (c.organization_id is null or c.organization_id = app_private.current_org())
        and app_private.current_org() is not null), '[]'::jsonb));
$$;

-- ------------------------------------------------------------------ configuration (System Admin)
create function public.app_comparison_settings_view()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.has_permission('admin.config.manage') then
    raise exception 'Configuration permission required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', b.code, 'nameEn', b.name_en, 'nameAr', b.name_ar, 'operatesInApp', b.operates_in_app,
        'liveSource', s.live_source, 'entryOwner', s.entry_owner_id, 'liveFrom', s.live_from,
        'revision', coalesce(s.revision, 0),
        'firstClose', (select min(d.business_date) from public.operating_days d where d.branch_id = b.id),
        'candidates', coalesce((
          select jsonb_agg(distinct jsonb_build_object('id', sa.user_id, 'name', e.full_name))
          from public.staff_group_assignments a
          join public.group_permissions gp on gp.group_key = a.group_key and gp.permission_key = 'comparison.enter'
          join public.staff_accounts sa on sa.user_id = a.staff_id and sa.is_active
          join public.employees e on e.id = sa.employee_id and e.is_active
          where sa.organization_id = b.organization_id and not b.operates_in_app
            and (a.branch_id = b.id or a.branch_id is null)), '[]'::jsonb))
        order by b.operates_in_app, b.name_en)
      from public.branches b
      left join public.comparison_branch_settings s on s.branch_id = b.id
      where b.organization_id = app_private.current_org()), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('key', c.key, 'labelEn', c.label_en, 'labelAr', c.label_ar,
        'builtIn', c.organization_id is null) order by c.organization_id nulls first, c.key)
      from public.comparison_sources c
      where c.active and (c.organization_id is null or c.organization_id = app_private.current_org())), '[]'::jsonb));
end;
$$;

create function public.app_comparison_settings_save(
  p_branch text, p_expected integer, p_live_source text, p_entry_owner uuid, p_live_from date
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
  s public.comparison_branch_settings%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch;
  if not found or not app_private.has_permission('admin.config.manage') then
    raise exception 'Configuration permission required' using errcode = '42501';
  end if;
  if p_expected is null or p_expected < 0
     or (b.operates_in_app and (p_live_source is not null or p_entry_owner is not null))
     or (p_live_from is not null and (not isfinite(p_live_from) or p_live_from < date '2000-01-01')) then
    raise exception 'Invalid comparison settings' using errcode = '22023';
  end if;
  if p_live_source is not null and not exists (
       select 1 from public.comparison_sources c where c.key = p_live_source and c.active
       and (c.organization_id is null or c.organization_id = b.organization_id)) then
    raise exception 'Unknown source designation' using errcode = '22023';
  end if;
  if p_entry_owner is not null and not exists (
       select 1 from public.staff_group_assignments a
       join public.group_permissions gp on gp.group_key = a.group_key and gp.permission_key = 'comparison.enter'
       join public.staff_accounts sa on sa.user_id = a.staff_id and sa.is_active
       join public.employees e on e.id = sa.employee_id and e.is_active
       where a.staff_id = p_entry_owner and sa.organization_id = b.organization_id
         and (a.branch_id = b.id or a.branch_id is null)) then
    raise exception 'The entry owner must be an active person who may enter this branch''s figures' using errcode = '22023';
  end if;

  perform 1 from public.branches where id = b.id for update;
  select * into s from public.comparison_branch_settings where branch_id = b.id;
  if coalesce(s.revision, 0) <> p_expected then
    raise exception 'Comparison settings have changed' using errcode = '40001';
  end if;
  v_before := jsonb_build_object('live_source', s.live_source, 'entry_owner', s.entry_owner_id, 'live_from', s.live_from);
  if s.branch_id is null then
    insert into public.comparison_branch_settings (branch_id, live_source, entry_owner_id, live_from, revision, updated_by)
    values (b.id, p_live_source, p_entry_owner, p_live_from, 1, auth.uid()) returning * into s;
  else
    update public.comparison_branch_settings
    set live_source = p_live_source, entry_owner_id = p_entry_owner, live_from = p_live_from,
        revision = revision + 1, updated_by = auth.uid(), updated_at = now()
    where branch_id = b.id returning * into s;
  end if;
  v_after := jsonb_build_object('live_source', s.live_source, 'entry_owner', s.entry_owner_id, 'live_from', s.live_from);
  perform app_private.write_audit(b.organization_id, 'administration', 'comparison.settings_changed',
    'comparison_branch_settings', b.id::text, b.code, b.id,
    jsonb_build_object('before', v_before, 'after', v_after, 'revision', s.revision));
  return jsonb_build_object('revision', s.revision);
end;
$$;

create function public.app_comparison_add_source(p_key text, p_label_en text, p_label_ar text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid := app_private.current_org();
begin
  if v_org is null or not app_private.has_permission('admin.config.manage') then
    raise exception 'Configuration permission required' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,39}$'
     or length(btrim(coalesce(p_label_en, ''))) not between 1 and 80
     or length(btrim(coalesce(p_label_ar, ''))) not between 1 and 80 then
    raise exception 'Invalid source designation' using errcode = '22023';
  end if;
  insert into public.comparison_sources (key, organization_id, label_en, label_ar, created_by)
  values (p_key, v_org, btrim(p_label_en), btrim(p_label_ar), auth.uid());
  perform app_private.write_audit(v_org, 'administration', 'comparison.source_added', 'comparison_source', p_key, p_key, null,
    jsonb_build_object('key', p_key, 'label_en', btrim(p_label_en), 'label_ar', btrim(p_label_ar)));
  return jsonb_build_object('key', p_key);
end;
$$;

-- ------------------------------------------------------------------ grants
revoke all on function
  app_private.comparison_entry_guard(),
  app_private.comparison_closed_days(date, date, text),
  app_private.comparison_daily_rows(date, date, text),
  app_private.comparison_save(uuid, uuid, jsonb, text),
  app_private.comparison_seed_insert(uuid, uuid, date, numeric, integer, text, timestamptz),
  app_private.comparison_figures_insert(),
  public.app_comparison_save(text, uuid, jsonb),
  public.app_comparison_report(text, text[], date[]),
  public.app_comparison_entry_context(),
  public.app_comparison_settings_view(),
  public.app_comparison_settings_save(text, integer, text, uuid, date),
  public.app_comparison_add_source(text, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  app_private.comparison_closed_days(date, date, text),
  app_private.comparison_daily_rows(date, date, text),
  app_private.comparison_save(uuid, uuid, jsonb, text),
  app_private.comparison_figures_insert(),
  public.app_comparison_save(text, uuid, jsonb),
  public.app_comparison_report(text, text[], date[]),
  public.app_comparison_entry_context(),
  public.app_comparison_settings_view(),
  public.app_comparison_settings_save(text, integer, text, uuid, date),
  public.app_comparison_add_source(text, text, text)
to authenticated;

revoke all on public.branch_daily_figures, public.comparison_figures from public, anon, authenticated, service_role;
grant select on public.branch_daily_figures to authenticated;
grant select, insert on public.comparison_figures to authenticated;
