-- Phase 7 acceptance cases: cross-branch comparison entry, revisions, the one-active-value rule,
-- Maarif from the daily close, first live date, and separate entry / view / export permissions.
-- Synthetic people and figures only; every change rolls back.
begin;

create function public.phase7_act_as(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then reset role; return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
grant execute on function public.phase7_act_as(uuid) to authenticated;

create function public.phase7_expect(p_state text, p_sql text) returns void language plpgsql as $$
declare got text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics got = returned_sqlstate;
    if got <> p_state then raise exception 'expected SQLSTATE % but got % (%) for: %', p_state, got, sqlerrm, left(p_sql, 200); end if;
    return;
  end;
  raise exception 'expected SQLSTATE % but the statement succeeded: %', p_state, left(p_sql, 200);
end;
$$;
grant execute on function public.phase7_expect(text, text) to authenticated, anon;

create function public.phase7_count(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) x', p_sql) into n;
  return n;
end;
$$;
grant execute on function public.phase7_count(text) to authenticated;

-- One figure of a report result, or NULL when the report has none.
create function public.phase7_fig(r jsonb, p_branch text, p_date date, p_metric text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(r -> 'figures') x
  where x ->> 'branch' = p_branch and (x ->> 'date')::date = p_date and x ->> 'metric' = p_metric;
$$;
grant execute on function public.phase7_fig(jsonb, text, date, text) to authenticated;

-- Two groups that exist only inside this test, so "view only" and "export only" can be checked.
insert into public.permission_groups (key, description, scope) values
  ('pseven_viewer', 'test only: comparison.view', 'branch'),
  ('pseven_exporter', 'test only: comparison.export', 'branch');
insert into public.group_permissions (group_key, permission_key) values
  ('pseven_viewer', 'comparison.view'), ('pseven_exporter', 'comparison.export');

insert into auth.users(id, email) values
  ('a7000000-0000-4000-8000-000000000001', 'admin@phase7.test'),
  ('a7000000-0000-4000-8000-000000000002', 'editor@phase7.test'),
  ('a7000000-0000-4000-8000-000000000003', 'editor2@phase7.test'),
  ('a7000000-0000-4000-8000-000000000004', 'viewer@phase7.test'),
  ('a7000000-0000-4000-8000-000000000005', 'exporter@phase7.test'),
  ('a7000000-0000-4000-8000-000000000006', 'cashier@phase7.test'),
  ('a7000000-0000-4000-8000-000000000007', 'manager@phase7.test'),
  ('a7000000-0000-4000-8000-000000000008', 'outsider@phase7.test');
insert into public.employees(id, organization_id, full_name)
  select u.id, b.organization_id, 'P7 ' || split_part(u.email, '@', 1) from auth.users u cross join public.branches b
  where b.code = 'maarif' and u.email like '%@phase7.test';
insert into public.staff_accounts(user_id, employee_id, organization_id, email)
  select u.id, u.id, e.organization_id, u.email from auth.users u join public.employees e on e.id = u.id where u.email like '%@phase7.test';
insert into public.branch_memberships(staff_id, branch_id)
  select u.id, b.id from auth.users u join public.branches b on
    (u.email = 'editor@phase7.test' and b.code = 'alquds')
    or (u.email = 'editor2@phase7.test' and b.code in ('alquds', 'bourgogne'))
    or (u.email in ('viewer@phase7.test', 'exporter@phase7.test'))
    or (u.email in ('cashier@phase7.test', 'manager@phase7.test', 'outsider@phase7.test') and b.code = 'maarif');
insert into public.staff_group_assignments(staff_id, branch_id, group_key)
  select m.staff_id, m.branch_id, case u.email
    when 'editor@phase7.test' then 'comparison_editor' when 'editor2@phase7.test' then 'comparison_editor'
    when 'viewer@phase7.test' then 'pseven_viewer' when 'exporter@phase7.test' then 'pseven_exporter'
    when 'cashier@phase7.test' then 'cashier' when 'manager@phase7.test' then 'manager' end
  from public.branch_memberships m join auth.users u on u.id = m.staff_id
  where u.email like '%@phase7.test' and u.email not in ('outsider@phase7.test', 'admin@phase7.test');
insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('a7000000-0000-4000-8000-000000000001', null, 'system_admin');

-- ------------------------------------------------------------------ 1. structure, grants and permissions
do $$
declare
  t text;
begin
  foreach t in array array['comparison_entries', 'comparison_branch_settings', 'comparison_sources'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ' has row-level security';
    assert not has_table_privilege('authenticated', 'public.' || t, 'insert,update,delete,truncate')
       and not has_table_privilege('anon', 'public.' || t, 'select')
       and not has_table_privilege('service_role', 'public.' || t, 'insert,update,delete'), t || ' is read-only to the API roles';
  end loop;
  assert (select indisunique and pg_get_expr(indpred, indrelid) = 'active'
          from pg_index where indexrelid = 'public.comparison_entries_one_active'::regclass)
     and (select array_agg(a.attname order by k.ord) from pg_index i
          cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
          where i.indexrelid = 'public.comparison_entries_one_active'::regclass)
        = array['branch_id', 'business_date', 'metric', 'source']::name[],
    'one active value per branch, business date, metric and source designation is a database constraint';
  assert (select relkind from pg_class where oid = 'public.comparison_figures'::regclass) = 'v', 'comparison_figures is a compatibility view';
  assert not has_table_privilege('anon', 'public.comparison_figures', 'select,insert')
     and not has_table_privilege('authenticated', 'public.comparison_figures', 'update,delete'), 'the compatibility view grants';
  assert not has_function_privilege('anon', 'public.app_comparison_report(text,text[],date[])', 'execute')
     and not has_function_privilege('anon', 'public.app_comparison_save(text,uuid,jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'app_private.comparison_seed_insert(uuid,uuid,date,numeric,integer,text,timestamptz)', 'execute'),
    'functions closed to anonymous callers; the seed path is closed to the API';
  -- Phase 3 grants are unchanged: entering, viewing and exporting stay with different groups.
  assert (select array_agg(permission_key order by permission_key) from public.group_permissions where group_key = 'comparison_editor') = array['comparison.enter'];
  assert not exists (select 1 from public.group_permissions where group_key not in ('system_admin', 'pseven_exporter') and permission_key = 'comparison.export');
  assert (select array_agg(group_key order by group_key) from public.group_permissions where permission_key = 'comparison.view')
     = array['manager', 'pseven_viewer', 'system_admin'];
  assert exists (select 1 from public.comparison_sources where key = 'reporting_only' and organization_id is null and active),
    'the reporting_only designation exists';
  assert not exists (select 1 from public.comparison_branch_settings), 'live source, entry owner and first live date start undecided';
end $$;

-- ------------------------------------------------------------------ 2. entering, retrying, the one active value, corrections
do $$
declare
  editor constant uuid := 'a7000000-0000-4000-8000-000000000002';
  admin constant uuid := 'a7000000-0000-4000-8000-000000000001';
  req uuid := gen_random_uuid();
  req2 uuid := gen_random_uuid();
  r jsonb;
  first_id bigint;
  pay jsonb := '{"date":"2026-11-17","sales":"12000","orders":"3","reference":"P7 synthetic sheet"}';
begin
  perform public.phase7_act_as(editor);
  r := public.app_comparison_save('alquds', req, pay);
  assert not (r ->> 'replayed')::boolean and jsonb_array_length(r -> 'revisions') = 2, 'first save: two values, revision 1 each';
  -- Retrying the same save returns the first result and writes nothing.
  r := public.app_comparison_save('alquds', req, pay);
  assert (r ->> 'replayed')::boolean, 'retry is a replay';
  perform public.phase7_act_as(null);
  assert (select count(*) from public.comparison_entries where request_id = req) = 2, 'retry created no second revision';
  assert (select count(*) from public.audit_log where action = 'comparison.entered' and target_id = req::text) = 1, 'one audit row for the save';
  assert (select actor_name from public.comparison_entries where request_id = req and metric = 'net_sales') = 'P7 editor'
     and (select source from public.comparison_entries where request_id = req and metric = 'net_sales') = 'reporting_only'
     and (select purpose from public.comparison_entries where request_id = req and metric = 'net_sales') = 'live',
    'source designation, purpose and person are recorded';

  perform public.phase7_act_as(editor);
  -- The same request identifier with another payload is refused.
  perform public.phase7_expect('23505', format($q$select public.app_comparison_save('alquds', %L, '{"date":"2026-11-17","sales":"1"}')$q$, req));
  -- A second "new" value for the same branch, date, metric and source is refused.
  perform public.phase7_expect('23505', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-17","sales":"5000"}')$q$);
  -- So is a second figure through the Phase 2 compatibility view (seed already holds Al Quds 10 Nov).
  perform public.phase7_expect('23505', $q$insert into public.comparison_figures (branch_id, business_date, net_sales) values ('00000000-0000-4000-8000-000000000012', '2026-11-10', 7)$q$);
  -- Validation.
  perform public.phase7_expect('22023', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2099-01-01","sales":"1"}')$q$);
  perform public.phase7_expect('22023', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-16","sales":"-5"}')$q$);
  perform public.phase7_expect('22023', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-16","sales":"1","source":"nope"}')$q$);
  perform public.phase7_expect('22023', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-16","mode":"correct","sales":"1"}')$q$);
  perform public.phase7_expect('22023', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-31","sales":"1"}')$q$);
  -- Not for an unassigned branch, not for the operating branch.
  perform public.phase7_expect('42501', $q$select public.app_comparison_save('bourgogne', gen_random_uuid(), '{"date":"2026-11-17","sales":"1"}')$q$);
  perform public.phase7_expect('42501', $q$select public.app_comparison_save('maarif', gen_random_uuid(), '{"date":"2026-11-17","sales":"1"}')$q$);
  perform public.phase7_expect('42501', $q$insert into public.comparison_figures (branch_id, business_date, net_sales) values ('00000000-0000-4000-8000-000000000011', '2026-11-16', 7)$q$);
  -- The table cannot be written directly through the API.
  perform public.phase7_expect('42501', $q$insert into public.comparison_entries (branch_id, business_date, metric, source, purpose, revision, value, request_id, request_hash, actor_name) values ('00000000-0000-4000-8000-000000000012', '2026-11-16', 'net_sales', 'reporting_only', 'live', 1, 1, gen_random_uuid(), '\x00', 'x')$q$);
  perform public.phase7_expect('42501', $q$update public.comparison_entries set value = 1$q$);
  perform public.phase7_expect('42501', $q$update public.comparison_figures set net_sales = 1$q$);

  -- A correction creates revision 2; revision 1 stays, retired.
  perform public.phase7_expect('22023', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-17","mode":"correct","sales":"12000"}')$q$);
  r := public.app_comparison_save('alquds', req2, '{"date":"2026-11-17","mode":"correct","sales":"12500","reason":"P7 typo in the sheet"}');
  assert jsonb_array_length(r -> 'revisions') = 1 and (r #>> '{revisions,0,revision}')::int = 2, 'only the changed metric gets a revision';
  assert public.app_comparison_save('alquds', req2, '{"date":"2026-11-17","mode":"correct","sales":"12500","reason":"P7 typo in the sheet"}') ->> 'replayed' = 'true',
    'retrying the correction creates nothing';
  perform public.phase7_act_as(null);
  select id into first_id from public.comparison_entries where request_id = req and metric = 'net_sales';
  assert (select count(*) from public.comparison_entries where branch_id = '00000000-0000-4000-8000-000000000012'
          and business_date = '2026-11-17' and metric = 'net_sales') = 2, 'two revisions of the sales figure';
  assert not (select active from public.comparison_entries where id = first_id)
     and (select value from public.comparison_entries where id = first_id) = 12000, 'revision 1 is retired but unchanged';
  assert (select value from public.comparison_entries where previous_id = first_id and active) = 12500
     and (select reason from public.comparison_entries where previous_id = first_id) = 'P7 typo in the sheet', 'revision 2 is the active value';
  assert (select count(*) from public.audit_log where action = 'comparison.corrected' and target_id = req2::text) = 1, 'the correction is audited';

  -- The constraint itself: even the table owner cannot hold two active values for one key.
  perform public.phase7_expect('23505', format($q$insert into public.comparison_entries (branch_id, business_date, metric, source, purpose, revision, previous_id, value, reason, request_id, request_hash, actor_name)
    values ('00000000-0000-4000-8000-000000000012', '2026-11-17', 'net_sales', 'reporting_only', 'live', 9, %s, 1, 'x', gen_random_uuid(), '\x00', 'owner')$q$,
    (select id from public.comparison_entries where previous_id = first_id)));
  -- History is append-only, for the owner too; retiring the active revision is the only change.
  perform public.phase7_expect('42501', format('update public.comparison_entries set value = 1 where id = %s', first_id));
  perform public.phase7_expect('42501', format('update public.comparison_entries set active = true where id = %s', first_id));
  perform public.phase7_expect('42501', format('delete from public.comparison_entries where id = %s', first_id));
  perform public.phase7_expect('42501', 'truncate public.comparison_entries');

  -- A second source designation may hold its own value for the same day (one active value per source).
  perform public.phase7_act_as(admin);
  perform public.app_comparison_add_source('p7_pos', 'P7 POS export', 'P7 تصدير نقاط البيع');
  perform public.phase7_expect('23505', $q$select public.app_comparison_add_source('p7_pos', 'again', 'again')$q$);
  perform public.phase7_act_as(editor);
  perform public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-17","source":"p7_pos","sales":"13000"}');
  -- Withdrawing a value is a correction to blank; the day then counts as missing for that source.
  perform public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-17","source":"p7_pos","mode":"correct","sales":null,"reason":"P7 wrong day"}');
  perform public.phase7_act_as(null);
  assert (select value from public.comparison_entries where source = 'p7_pos' and active and metric = 'net_sales') is null, 'withdrawn value is blank';

  -- The editor enters through the Phase 2 view too; it is audited under its Phase 2 action.
  perform public.phase7_act_as(editor);
  insert into public.comparison_figures (branch_id, business_date, net_sales, order_count) values ('00000000-0000-4000-8000-000000000012', '2026-11-16', 77, 4);
  perform public.phase7_act_as(null);
  assert (select count(*) from public.comparison_entries where business_date = '2026-11-16' and actor_name = 'P7 editor') = 2;
  assert (select count(*) from public.audit_log where action = 'comparison_figures.created' and actor_name = 'P7 editor') = 1;
end $$;

-- ------------------------------------------------------------------ 3. entering, viewing and exporting are separate
do $$
declare
  editor constant uuid := 'a7000000-0000-4000-8000-000000000002';
  viewer constant uuid := 'a7000000-0000-4000-8000-000000000004';
  exporter constant uuid := 'a7000000-0000-4000-8000-000000000005';
  cashier constant uuid := 'a7000000-0000-4000-8000-000000000006';
  manager constant uuid := 'a7000000-0000-4000-8000-000000000007';
  outsider constant uuid := 'a7000000-0000-4000-8000-000000000008';
  r jsonb;
  who uuid;
begin
  -- Without comparison.view, no Al Quds or Bourgogne figure can be read, in any form.
  foreach who in array array[editor, exporter, cashier, manager, outsider] loop
    perform public.phase7_act_as(who);
    assert public.phase7_count('select 1 from public.comparison_entries') = 0, 'entries hidden from ' || who;
    assert public.phase7_count('select 1 from public.comparison_figures') = 0, 'compatibility view hidden from ' || who;
    assert public.phase7_count($q$select 1 from public.branch_daily_figures f join public.branches b on b.id = f.branch_id where b.code in ('alquds', 'bourgogne')$q$) = 0,
      'combined view shows no Al Quds or Bourgogne figure to ' || who;
    perform public.phase7_expect('42501', $q$select public.app_comparison_report('view', array['alquds'], array['2026-11-17'::date])$q$);
    perform public.phase7_expect('42501', $q$select public.app_comparison_report('view', array['bourgogne'], array['2026-11-03'::date])$q$);
  end loop;
  -- Entering and viewing do not grant exporting; exporting does not grant viewing.
  foreach who in array array[editor, viewer, cashier, manager, outsider] loop
    perform public.phase7_act_as(who);
    perform public.phase7_expect('42501', $q$select public.app_comparison_report('export', array['alquds'], array['2026-11-17'::date])$q$);
  end loop;
  foreach who in array array[viewer, exporter, cashier, manager, outsider] loop
    perform public.phase7_act_as(who);
    perform public.phase7_expect('42501', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-15","sales":"1"}')$q$);
  end loop;

  -- The viewer reads the active value and every earlier revision.
  perform public.phase7_act_as(viewer);
  assert public.phase7_count($q$select 1 from public.comparison_entries e join public.branches b on b.id = e.branch_id where b.code = 'alquds' and e.business_date = '2026-11-17' and e.metric = 'net_sales' and e.source = 'reporting_only'$q$) = 2,
    'the earlier revision stays readable';
  assert public.phase7_count('select 1 from public.comparison_figures') >= 4, 'the viewer reads the figures';
  r := public.app_comparison_report('view', array['alquds', 'maarif', 'bourgogne'], array['2026-11-17'::date, '2026-11-10'::date, '2026-11-03'::date]);
  assert (select array_agg(x ->> 'code') from jsonb_array_elements(r -> 'branches') x) = array['alquds', 'maarif', 'bourgogne'], 'branches in the requested order';
  assert (public.phase7_fig(r, 'alquds', '2026-11-17', 'net_sales') ->> 'value')::bigint = 12500
     and public.phase7_fig(r, 'alquds', '2026-11-17', 'net_sales') ->> 'revision' = '2'
     and public.phase7_fig(r, 'alquds', '2026-11-17', 'net_sales') ->> 'source' = 'reporting_only'
     and public.phase7_fig(r, 'alquds', '2026-11-17', 'net_sales') ->> 'reference' = 'P7 synthetic sheet'
     and (public.phase7_fig(r, 'alquds', '2026-11-17', 'order_count') ->> 'value')::int = 3, 'the active revision is reported with its source';
  assert public.phase7_fig(r, 'bourgogne', '2026-11-17', 'net_sales') is null, 'a missing branch has no figure (never 0)';

  -- The exporter gets the same figures through the export path only.
  perform public.phase7_act_as(exporter);
  r := public.app_comparison_report('export', array['alquds'], array['2026-11-17'::date]);
  assert (public.phase7_fig(r, 'alquds', '2026-11-17', 'net_sales') ->> 'value')::bigint = 12500, 'export returns the figure';

  -- A manager views only the branches they are assigned (Maarif here).
  perform public.phase7_act_as(manager);
  r := public.app_comparison_report('view', array['maarif'], array['2026-11-10'::date]);
  assert jsonb_array_length(r -> 'branches') = 1;
  perform public.phase7_expect('42501', $q$select public.app_comparison_report('view', array['maarif', 'alquds'], array['2026-11-10'::date])$q$);
  perform public.phase7_expect('22023', $q$select public.app_comparison_report('look', array['maarif'], array['2026-11-10'::date])$q$);
  perform public.phase7_expect('22023', $q$select public.app_comparison_report('view', array['maarif'], array['infinity'::date])$q$);

  -- Anonymous callers and other organizations get nothing.
  perform public.phase7_act_as(null);
  set local role anon;
  perform public.phase7_expect('42501', $q$select public.app_comparison_report('view', array['alquds'], array['2026-11-17'::date])$q$);
  reset role;
end $$;

-- An administrator of another organization cannot reach these branches by code.
do $$
begin
  insert into public.organizations (id, name) values ('a7000000-0000-4000-8000-0000000000f0', 'P7 other organization');
  insert into auth.users(id, email) values ('a7000000-0000-4000-8000-0000000000f1', 'other@phase7.test');
  insert into public.employees(id, organization_id, full_name) values ('a7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-0000000000f0', 'P7 other admin');
  insert into public.staff_accounts(user_id, employee_id, organization_id, email) values ('a7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-0000000000f0', 'other@phase7.test');
  insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('a7000000-0000-4000-8000-0000000000f1', null, 'system_admin');
  perform public.phase7_act_as('a7000000-0000-4000-8000-0000000000f1');
  perform public.phase7_expect('42501', $q$select public.app_comparison_report('view', array['alquds'], array['2026-11-17'::date])$q$);
  perform public.phase7_expect('42501', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-15","sales":"1"}')$q$);
  assert public.phase7_count('select 1 from public.comparison_entries') = 0 and public.phase7_count('select 1 from public.comparison_sources where key = ''p7_pos''') = 0,
    'nothing of the first organization is visible';
  perform public.phase7_act_as(null);
end $$;

-- ------------------------------------------------------------------ 4. Maarif comes from the daily close, entered once
do $$
declare
  cashier constant uuid := 'a7000000-0000-4000-8000-000000000006';
  manager constant uuid := 'a7000000-0000-4000-8000-000000000007';
  viewer constant uuid := 'a7000000-0000-4000-8000-000000000004';
  d date;
  sales bigint;
  r jsonb;
  report jsonb;
begin
  -- Two Tuesdays closed through the Phase 4 daily close: 100.00 MAD / 2 orders, then 120.00 MAD / 3 orders.
  foreach d in array array['2026-11-10'::date, '2026-11-17'::date] loop
    sales := case d when '2026-11-10' then 10000 else 12000 end;
    perform public.phase7_act_as(cashier);
    perform public.app_operating_command('maarif', d, 'save', 0, gen_random_uuid(),
      jsonb_build_object('sales', sales, 'posCash', sales, 'card', 0, 'cashier', cashier, 'orders', case d when '2026-11-10' then 2 else 3 end)
      || case d when '2026-11-10' then '{"openingCash":0,"openingCustody":0}'::jsonb else '{}'::jsonb end);
    perform public.app_operating_command('maarif', d, 'count', 1, gen_random_uuid(),
      jsonb_build_object('counter', manager, 'local', to_char(d, 'YYYY-MM-DD') || 'T22:00', 'quantities', jsonb_build_object('100', sales / 100)));
    perform public.app_operating_command('maarif', d, 'submit', 2, gen_random_uuid(), '{}');
    perform public.phase7_act_as(manager);
    perform public.app_operating_command('maarif', d, 'close', 3, gen_random_uuid(), '{}');
  end loop;

  -- Closing and the Daily Sales report show it ...
  perform public.phase7_act_as(manager);
  report := public.app_operating_report('maarif', '2026-11-17', '2026-11-01');
  assert report #>> '{day,state}' = 'closed' and (report #>> '{day,data,sales}')::bigint = 12000, 'closing shows the day';
  assert (select (x ->> 'sales')::bigint from jsonb_array_elements(report -> 'days') x where x ->> 'date' = '2026-11-17') = 12000, 'the month report shows the day';
  -- ... and so does the comparison, from the same saved revision, with no comparison entry.
  perform public.phase7_act_as(viewer);
  r := public.app_comparison_report('view', array['maarif'], array['2026-11-17'::date, '2026-11-10'::date, '2026-11-03'::date]);
  assert (public.phase7_fig(r, 'maarif', '2026-11-17', 'net_sales') ->> 'value')::bigint = 12000
     and public.phase7_fig(r, 'maarif', '2026-11-17', 'net_sales') ->> 'origin' = 'closed_day'
     and public.phase7_fig(r, 'maarif', '2026-11-17', 'net_sales') ->> 'record' like 'operating_day_revisions:%'
     and (public.phase7_fig(r, 'maarif', '2026-11-17', 'order_count') ->> 'value')::int = 3
     and (public.phase7_fig(r, 'maarif', '2026-11-10', 'net_sales') ->> 'value')::bigint = 10000,
    'Maarif comes from the closed day (the 90.00 MAD demonstration row for 17 Nov is not used)';
  -- The first live business date of Maarif is its first saved business day; 3 Nov is before it.
  assert r #>> '{branches,0,liveFrom}' = '2026-11-10' and r #>> '{branches,0,liveFromBasis}' = 'first_close';
  assert public.phase7_fig(r, 'maarif', '2026-11-03', 'net_sales') is null, 'the demonstration day before the first live date is unavailable';
  perform public.phase7_act_as(null);
  assert not exists (select 1 from public.comparison_entries e join public.branches b on b.id = e.branch_id where b.code = 'maarif'),
    'Maarif was never re-entered as a comparison figure';

  -- A closed day wins over a reporting-only figure for the same branch and date.
  perform app_private.comparison_seed_insert(gen_random_uuid(), '00000000-0000-4000-8000-000000000011', '2026-11-17', 999.00, 9, 'reporting_only', now());
  perform public.phase7_act_as(viewer);
  r := public.app_comparison_report('view', array['maarif'], array['2026-11-17'::date]);
  assert (public.phase7_fig(r, 'maarif', '2026-11-17', 'net_sales') ->> 'value')::bigint = 12000, 'the closed day wins';
  assert (select net_sales from public.branch_daily_figures f join public.branches b on b.id = f.branch_id
          where b.code = 'maarif' and f.business_date = '2026-11-17') = 120.00, 'also in the combined view';
  -- A day that is only a draft is not a comparison figure.
  perform public.phase7_act_as(cashier);
  perform public.app_operating_command('maarif', '2026-11-18', 'save', 0, gen_random_uuid(), '{"sales":5000,"posCash":5000,"card":0}');
  perform public.phase7_act_as(viewer);
  r := public.app_comparison_report('view', array['maarif'], array['2026-11-18'::date]);
  assert public.phase7_fig(r, 'maarif', '2026-11-18', 'net_sales') is null, 'a draft day is missing, not a figure';
  perform public.phase7_act_as(null);
end $$;

-- ------------------------------------------------------------------ 5. first live date, historical figures, settings
do $$
declare
  admin constant uuid := 'a7000000-0000-4000-8000-000000000001';
  editor constant uuid := 'a7000000-0000-4000-8000-000000000002';
  editor2 constant uuid := 'a7000000-0000-4000-8000-000000000003';
  viewer constant uuid := 'a7000000-0000-4000-8000-000000000004';
  cashier constant uuid := 'a7000000-0000-4000-8000-000000000006';
  r jsonb;
begin
  -- Only an administrator configures; the operating branch takes no live source or entry owner.
  perform public.phase7_act_as(editor);
  perform public.phase7_expect('42501', $q$select public.app_comparison_settings_save('alquds', 0, null, null, '2026-11-05')$q$);
  perform public.phase7_expect('42501', 'select public.app_comparison_settings_view()');
  perform public.phase7_act_as(admin);
  perform public.phase7_expect('22023', $q$select public.app_comparison_settings_save('maarif', 0, 'reporting_only', null, null)$q$);
  perform public.phase7_expect('22023', format($q$select public.app_comparison_settings_save('alquds', 0, null, %L, null)$q$, cashier));
  perform public.phase7_expect('22023', $q$select public.app_comparison_settings_save('alquds', 0, 'nope', null, null)$q$);
  r := public.app_comparison_settings_save('alquds', 0, null, null, '2026-11-05');
  assert (r ->> 'revision')::int = 1;
  perform public.phase7_expect('40001', $q$select public.app_comparison_settings_save('alquds', 0, null, null, '2026-11-06')$q$);
  assert jsonb_array_length(public.app_comparison_settings_view() -> 'branches') = 3;

  -- Before Al Quds's first live date (5 Nov) the seed's live 3 Nov figure is unavailable.
  perform public.phase7_act_as(viewer);
  r := public.app_comparison_report('view', array['alquds'], array['2026-11-03'::date, '2026-11-10'::date]);
  assert r #>> '{branches,0,liveFrom}' = '2026-11-05' and r #>> '{branches,0,liveFromBasis}' = 'configured';
  assert public.phase7_fig(r, 'alquds', '2026-11-03', 'net_sales') is null, 'pre-live figure unavailable';
  assert (public.phase7_fig(r, 'alquds', '2026-11-10', 'net_sales') ->> 'value')::bigint = 9600, 'live figure shown';

  -- A live entry before that date is refused; a historical one must name its source and stays marked.
  perform public.phase7_act_as(editor);
  perform public.phase7_expect('22023', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-04","sales":"100"}')$q$);
  perform public.phase7_expect('22023', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-04","sales":"100","purpose":"historical"}')$q$);
  perform public.phase7_expect('22023', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-06","sales":"100","purpose":"historical","reference":"x"}')$q$);
  perform public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-03","source":"p7_pos","sales":"7000","purpose":"historical","reference":"P7 archived sheet, row 6"}');
  perform public.phase7_act_as(viewer);
  r := public.app_comparison_report('view', array['alquds'], array['2026-11-03'::date]);
  assert (public.phase7_fig(r, 'alquds', '2026-11-03', 'net_sales') ->> 'value')::bigint = 7000
     and public.phase7_fig(r, 'alquds', '2026-11-03', 'net_sales') ->> 'purpose' = 'historical'
     and public.phase7_fig(r, 'alquds', '2026-11-03', 'net_sales') ->> 'reference' = 'P7 archived sheet, row 6',
    'a historical figure selected for the report is shown with its source';

  -- The configured live source is preferred over reporting_only for the same day.
  perform public.phase7_act_as(editor);
  perform public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-10","source":"p7_pos","sales":"9700"}');
  perform public.phase7_act_as(viewer);
  assert (public.phase7_fig(public.app_comparison_report('view', array['alquds'], array['2026-11-10'::date]), 'alquds', '2026-11-10', 'net_sales') ->> 'value')::bigint = 9600,
    'without a live source, reporting_only comes first';
  perform public.phase7_act_as(admin);
  perform public.app_comparison_settings_save('alquds', 1, 'p7_pos', null, '2026-11-05');
  perform public.phase7_act_as(viewer);
  r := public.app_comparison_report('view', array['alquds'], array['2026-11-10'::date]);
  assert (public.phase7_fig(r, 'alquds', '2026-11-10', 'net_sales') ->> 'value')::bigint = 9700
     and public.phase7_fig(r, 'alquds', '2026-11-10', 'net_sales') ->> 'source' = 'p7_pos', 'the live source wins';

  -- An entry owner, once configured, is the only person who enters that branch's figures.
  perform public.phase7_act_as(admin);
  perform public.app_comparison_settings_save('alquds', 2, 'p7_pos', editor2, '2026-11-05');
  perform public.phase7_act_as(editor);
  perform public.phase7_expect('42501', $q$select public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-15","sales":"100"}')$q$);
  assert (public.app_comparison_entry_context() #>> '{branches,0,ownerSet}')::boolean
     and not (public.app_comparison_entry_context() #>> '{branches,0,ownerIsMe}')::boolean, 'the editor is told someone else owns entry';
  perform public.phase7_act_as(editor2);
  perform public.app_comparison_save('alquds', gen_random_uuid(), '{"date":"2026-11-15","sales":"100"}');
  -- Bourgogne has no settings: its entry stays open to its editors.
  perform public.app_comparison_save('bourgogne', gen_random_uuid(), '{"date":"2026-11-15","sales":"100"}');
  perform public.phase7_act_as(null);
  assert (select count(*) from public.audit_log where action = 'comparison.settings_changed') = 3;
  assert (select count(*) from public.audit_log where action = 'comparison.source_added') = 1;
end $$;

rollback;
select 'phase7 database checks passed';
