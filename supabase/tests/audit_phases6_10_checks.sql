-- Regression checks for the independent audit of Phases 6-10 (migration 20261128090000):
-- the base unit of stock history, nothing before the opening stock on any path, a stated adjustment
-- decision, report-period purchase orders beyond the newest 500, and the database date and times.
-- Synthetic people and items only; every change rolls back.
begin;

create function public.audit_act_as(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then reset role; return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
create function public.audit_expect(p_state text, p_sql text) returns void language plpgsql as $$
declare got text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics got = returned_sqlstate;
    if got <> p_state then raise exception 'expected SQLSTATE % but got % (%) for: %', p_state, got, sqlerrm, left(p_sql, 300); end if;
    return;
  end;
  raise exception 'expected SQLSTATE % but the statement succeeded: %', p_state, left(p_sql, 300);
end;
$$;
create function public.audit_put(k text, v text) returns void language sql as $$ select set_config('audit.' || k, v, true); $$;
create function public.audit_get(k text) returns text language sql as $$ select current_setting('audit.' || k); $$;
-- Save an item again with another base unit, as the catalog form does.
create function public.audit_set_unit(p_item uuid, p_unit text, p_name text) returns uuid language sql as $$
  select public.app_catalog_save_item(p_item, i.kind, coalesce(p_name, i.name_ar), i.name_en, i.code, i.section_label, p_unit,
    null, null, null, false, i.version)
  from public.catalog_items i where i.id = p_item;
$$;
grant execute on function public.audit_act_as(uuid), public.audit_expect(text, text), public.audit_put(text, text), public.audit_get(text),
  public.audit_set_unit(uuid, text, text) to authenticated, anon;

insert into auth.users(id, email) values
  ('ad000000-0000-4000-8000-000000000001', 'admin@audit610.test'),
  ('ad000000-0000-4000-8000-000000000004', 'cashier@audit610.test');
insert into public.employees(id, organization_id, full_name)
  select u.id, b.organization_id, split_part(u.email, '@', 1) from auth.users u cross join public.branches b
  where b.code = 'maarif' and u.email like '%@audit610.test';
insert into public.staff_accounts(user_id, employee_id, organization_id, email)
  select u.id, u.id, e.organization_id, u.email from auth.users u join public.employees e on e.id = u.id where u.email like '%@audit610.test';
insert into public.branch_memberships(staff_id, branch_id)
  select u.id, b.id from auth.users u cross join public.branches b where b.code = 'maarif' and u.email = 'cashier@audit610.test';
insert into public.staff_group_assignments(staff_id, branch_id, group_key)
  select u.id, m.branch_id, 'cashier' from auth.users u join public.branch_memberships m on m.staff_id = u.id where u.email = 'cashier@audit610.test';
insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('ad000000-0000-4000-8000-000000000001', null, 'system_admin');

-- ------------------------------------------------------------------ 1. the database date and times
do $$
declare
  admin constant uuid := 'ad000000-0000-4000-8000-000000000001';
  cashier constant uuid := 'ad000000-0000-4000-8000-000000000004';
  got text[];
begin
  assert not has_function_privilege('anon', 'public.app_business_today()', 'execute')
     and not has_function_privilege('anon', 'public.app_local_times(timestamptz[])', 'execute')
     and not has_function_privilege('anon', 'public.app_purchase_orders_in_period(text,date,date)', 'execute'), 'closed to anonymous callers';
  perform public.audit_act_as(admin);
  assert public.app_business_today() = (select public.business_date_of(now(), timezone, business_day_rollover) from public.branches
    where code = 'maarif'), 'today is the operating branch date by the database clock and rollover';
  got := public.app_local_times(array['2026-11-25T01:30:00Z', '2026-07-01T12:00:00Z', '2026-11-25T01:30:00Z']::timestamptz[]);
  assert got = array(select to_char(t at time zone 'Africa/Casablanca', 'YYYY-MM-DD"T"HH24:MI')
    from unnest(array['2026-11-25T01:30:00Z', '2026-07-01T12:00:00Z', '2026-11-25T01:30:00Z']::timestamptz[]) with ordinality u(t, n)
    order by n), 'branch-local times in the order given';
  assert public.app_local_times('{}') = '{}'::text[];
  perform public.audit_act_as(cashier);
  perform public.audit_expect('42501', $q$select public.app_purchase_orders_in_period('maarif', '2026-11-01', '2026-11-30')$q$);
  perform public.audit_act_as(null);
end $$;

-- ------------------------------------------------------------------ 2. an item with stock history keeps its base unit
do $$
declare
  admin constant uuid := 'ad000000-0000-4000-8000-000000000001';
  free uuid; moved uuid; counted uuid; ordered uuid; planned uuid;
begin
  perform public.audit_act_as(admin);
  free    := public.app_catalog_save_item(null, 'ingredient', 'A610 حر', null, null, null, 'kg', null, null, null, false, null);
  moved   := public.app_catalog_save_item(null, 'ingredient', 'A610 حركة', null, null, null, 'kg', null, null, null, false, null);
  counted := public.app_catalog_save_item(null, 'ingredient', 'A610 جرد', null, null, null, 'kg', null, null, null, false, null);
  ordered := public.app_catalog_save_item(null, 'ingredient', 'A610 طلبية', null, null, null, 'kg', null, null, null, false, null);
  planned := public.app_catalog_save_item(null, 'ingredient', 'A610 إعداد', null, null, null, 'kg', null, null, null, false, null);
  perform public.app_stock_command('maarif', '2026-11-10', 'movement', gen_random_uuid(),
    jsonb_build_object('kind', 'receipt', 'item', moved, 'quantity', '5', 'local', '2026-11-10T09:00'));
  perform public.app_stock_command('maarif', '2026-11-10', 'count', gen_random_uuid(),
    jsonb_build_object('item', counted, 'quantity', '0', 'local', '2026-11-10T22:00'));
  perform public.app_purchase_order_command('maarif', 'create', gen_random_uuid(),
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', ordered, 'quantity', '2', 'source', 'factory'))));
  perform public.app_replenishment_item_settings_save('maarif', planned, 0, null, '5', null, null, null);

  -- Without history the unit may still be corrected.
  perform public.audit_set_unit(free, 'g', null);
  assert (select base_unit = 'g' from public.catalog_items where id = free);
  perform public.audit_expect('22023', format($q$select public.audit_set_unit(%L, 'g', null)$q$, moved));
  perform public.audit_expect('22023', format($q$select public.audit_set_unit(%L, 'g', null)$q$, counted));
  perform public.audit_expect('22023', format($q$select public.audit_set_unit(%L, 'g', null)$q$, ordered));
  perform public.audit_expect('22023', format($q$select public.audit_set_unit(%L, 'pc', null)$q$, planned));
  -- Other corrections of an item with history are unaffected.
  perform public.audit_set_unit(moved, 'kg', 'A610 حركة معدلة');
  assert (select base_unit = 'kg' and name_ar = 'A610 حركة معدلة' from public.catalog_items where id = moved);
  perform public.audit_act_as(null);
  -- Also for the table owner: the rule is on the table.
  perform public.audit_expect('22023', format($q$update public.catalog_items set base_unit = 'g' where id = %L$q$, moved));
end $$;

-- ------------------------------------------------------------------ 3. nothing is recorded before the opening stock
do $$
declare
  admin constant uuid := 'ad000000-0000-4000-8000-000000000001';
  part uuid; cake uuid; v uuid; r jsonb; ver integer; spare uuid; opening jsonb;
begin
  perform public.audit_act_as(admin);
  part  := public.app_catalog_save_item(null, 'ingredient', 'A610 مكون', null, null, null, 'pc', null, null, null, false, null);
  spare := public.app_catalog_save_item(null, 'ingredient', 'A610 مكون ملغى', null, null, null, 'pc', null, null, null, false, null);
  cake  := public.app_catalog_save_item(null, 'sold', 'A610 كيكة', null, null, null, null, null, null, null, false, null);
  perform public.app_catalog_map_name('foodics', 'A610 كيكة', cake, 'approve', 'audit check');
  v := public.app_catalog_create_recipe(cake, 'A610 v1', null, null);
  perform public.app_catalog_save_recipe_line(v, null, part, '2', 'pc', null, 1);
  perform public.app_catalog_approve_recipe(v, '2026-11-01', null, 2);

  perform public.app_stock_command('maarif', '2026-11-10', 'opening', gen_random_uuid(),
    jsonb_build_object('item', part, 'quantity', '10', 'local', '2026-11-10T08:00'));
  -- The day before: a Product Mix may be entered and locked, but its consumption cannot post.
  r := public.app_stock_command('maarif', '2026-11-09', 'mix_save', gen_random_uuid(), '{"net_sales":"100","local":"2026-11-09T23:00"}');
  ver := (r ->> 'version')::integer;
  r := public.app_stock_command('maarif', '2026-11-09', 'mix_section', gen_random_uuid(), jsonb_build_object('label', 'A610', 'total', '100', 'version', ver));
  ver := (r ->> 'version')::integer;
  r := public.app_stock_command('maarif', '2026-11-09', 'mix_line', gen_random_uuid(),
    jsonb_build_object('section_no', 1, 'label', 'A610 كيكة', 'quantity', '3', 'amount', '100', 'version', ver));
  ver := (r ->> 'version')::integer;
  perform public.app_stock_command('maarif', '2026-11-09', 'mix_lock', gen_random_uuid(), jsonb_build_object('version', ver));
  perform public.audit_expect('CT007', $q$select public.app_stock_command('maarif', '2026-11-09', 'post_consumption', gen_random_uuid(), '{}')$q$);
  perform public.audit_expect('CT007', format($q$select public.app_stock_command('maarif', '2026-11-09', 'propose_adjustment', gen_random_uuid(),
    '{"item":"%s","quantity":"1","direction":"-1","local":"2026-11-09T22:00","reason":"audit"}')$q$, part));
  perform public.audit_expect('22023', format($q$select public.app_stock_command('maarif', '2026-11-09', 'movement', gen_random_uuid(),
    '{"kind":"waste","item":"%s","quantity":"1","local":"2026-11-09T22:00"}')$q$, part));
  perform public.audit_act_as(null);
  assert (select count(*) from public.stock_movements where item_id = part) = 1, 'only the opening was written';
  assert not exists (select 1 from public.stock_consumption_lines c where c.business_date = '2026-11-09'
    and c.components @> jsonb_build_array(jsonb_build_object('item_id', part))), 'no consumption line either';
  perform public.audit_act_as(admin);
  assert (public.app_stock_day('maarif', '2026-11-10') -> 'items') @> jsonb_build_array(jsonb_build_object('item_id', part)),
    'the item is on the stock day';
  -- From the opening date on, everything records as before.
  perform public.app_stock_command('maarif', '2026-11-10', 'propose_adjustment', gen_random_uuid(),
    jsonb_build_object('item', part, 'quantity', '1', 'direction', '-1', 'local', '2026-11-10T22:00', 'reason', 'audit'));
  -- A reversed opening no longer blocks earlier entries.
  opening := public.app_stock_command('maarif', '2026-11-10', 'opening', gen_random_uuid(),
    jsonb_build_object('item', spare, 'quantity', '4', 'local', '2026-11-10T08:00'));
  perform public.app_stock_command('maarif', '2026-11-10', 'reverse', gen_random_uuid(),
    jsonb_build_object('posting', opening ->> 'posting', 'reason', 'audit: wrong opening'));
  perform public.app_stock_command('maarif', '2026-11-09', 'propose_adjustment', gen_random_uuid(),
    jsonb_build_object('item', spare, 'quantity', '1', 'direction', '1', 'local', '2026-11-09T22:00', 'reason', 'audit'));
  perform public.audit_put('part', part::text);
  perform public.audit_act_as(null);
end $$;

-- ------------------------------------------------------------------ 4. an adjustment decision must be stated
do $$
declare
  admin constant uuid := 'ad000000-0000-4000-8000-000000000001';
  adj uuid;
begin
  select id into strict adj from public.stock_adjustments where item_id = public.audit_get('part')::uuid and status = 'proposed';
  perform public.audit_act_as(admin);
  perform public.audit_expect('22023', format($q$select public.app_stock_command('maarif', '2026-11-10', 'decide_adjustment', gen_random_uuid(),
    '{"adjustment":"%s"}')$q$, adj));
  perform public.audit_expect('22023', format($q$select public.app_stock_command('maarif', '2026-11-10', 'decide_adjustment', gen_random_uuid(),
    '{"adjustment":"%s","decision":"maybe"}')$q$, adj));
  perform public.audit_act_as(null);
  assert (select status = 'proposed' from public.stock_adjustments where id = adj), 'still waiting for a decision';
  perform public.audit_act_as(admin);
  perform public.app_stock_command('maarif', '2026-11-10', 'decide_adjustment', gen_random_uuid(),
    jsonb_build_object('adjustment', adj, 'decision', 'approve'));
  perform public.audit_act_as(null);
  assert (select status = 'approved' from public.stock_adjustments where id = adj);
end $$;

-- ------------------------------------------------------------------ 5. a report period finds orders beyond the newest 500
do $$
declare
  admin constant uuid := 'ad000000-0000-4000-8000-000000000001';
  line jsonb := jsonb_build_array(jsonb_build_object('item', public.audit_get('part'), 'quantity', '1', 'source', 'factory'));
  old_order uuid;
begin
  perform public.audit_act_as(admin);
  old_order := (public.app_purchase_order_command('maarif', 'import_legacy', gen_random_uuid(),
    jsonb_build_object('expected_date', '2026-01-15', 'source_value', '15/01/2026', 'lines', line)) ->> 'order')::uuid;
  for n in 1 .. 500 loop
    perform public.app_purchase_order_command('maarif', 'import_legacy', gen_random_uuid(),
      jsonb_build_object('expected_date', '2026-06-15', 'source_value', '15/06/2026', 'lines', line));
  end loop;
  assert not (public.app_purchase_orders('maarif', 500) -> 'orders') @> jsonb_build_array(jsonb_build_object('id', old_order)),
    'the list of the newest 500 no longer holds the old order';
  assert public.app_purchase_orders_in_period('maarif', '2026-01-01', '2026-01-31') = jsonb_build_array(old_order),
    'the report period still finds it, and only it';
  assert jsonb_array_length(public.app_purchase_orders_in_period('maarif', '2026-06-01', '2026-06-30')) = 500, 'no limit within a period';
  perform public.audit_expect('22023', $q$select public.app_purchase_orders_in_period('maarif', '2026-01-01', '2026-03-01')$q$);
  perform public.audit_act_as(null);
end $$;

-- ------------------------------------------------------------------ 6. the export claim waits for writes in progress
do $$
begin
  assert pg_get_functiondef('public.app_report_export_claim(uuid)'::regprocedure) ~ 'for share;\s+v_now := clock_timestamp\(\);',
    'the snapshot instant is taken after the branch lock (behaviour: scripts/audit/snapshot-check.mjs)';
end $$;

select 'audit phases 6-10 database checks passed';
rollback;
