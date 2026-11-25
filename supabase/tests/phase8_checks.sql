-- Phase 8 acceptance cases: three-month same-weekday planning, the recommendation formula, purchase
-- orders with their dates, receiving and cancellation, legacy mapping, append-only history and the
-- separate create / approve / receive permissions. Synthetic people and items only; every change
-- rolls back. Quantities worked out by hand are in the comments.
--
-- Time: the commands take their instant from the clock. To test a Wednesday-evening order and the
-- after-midnight rule, this file grants the internal functions that take an explicit instant to the
-- test role INSIDE this transaction (rolled back); §1 first proves the API cannot call them.
begin;

create function public.phase8_act_as(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then reset role; return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
grant execute on function public.phase8_act_as(uuid) to authenticated;

create function public.phase8_expect(p_state text, p_sql text) returns void language plpgsql as $$
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
grant execute on function public.phase8_expect(text, text) to authenticated, anon;

create function public.phase8_put(k text, v text) returns void language sql as $$ select set_config('phase8.' || k, v, true); $$;
create function public.phase8_get(k text) returns text language sql as $$ select current_setting('phase8.' || k); $$;
grant execute on function public.phase8_put(text, text), public.phase8_get(text) to authenticated;

-- A local Casablanca time as an instant.
create function public.phase8_at(p_local text) returns timestamptz language sql immutable as $$
  select (p_local::timestamp) at time zone 'Africa/Casablanca';
$$;
grant execute on function public.phase8_at(text) to authenticated;

-- "num/den" of a fraction object.
create function public.phase8_q(j jsonb) returns text language sql immutable as $$
  select case when j is null or jsonb_typeof(j) = 'null' then null else (j ->> 'num') || '/' || (j ->> 'den') end;
$$;
grant execute on function public.phase8_q(jsonb) to authenticated;

-- One item of a plan.
create function public.phase8_item(p jsonb, p_item text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(p -> 'items') x where x ->> 'item_id' = p_item;
$$;
grant execute on function public.phase8_item(jsonb, text) to authenticated;

-- A purchase-order command at a chosen local time, as the current person.
create function public.phase8_po(p_command text, p_payload jsonb, p_local text, p_request uuid default null) returns jsonb language sql as $$
  select app_private.purchase_order_command('maarif', p_command, coalesce(p_request, gen_random_uuid()), p_payload, public.phase8_at(p_local));
$$;
grant execute on function public.phase8_po(text, jsonb, text, uuid) to authenticated;

-- The plan of one item at a chosen local time.
create function public.phase8_plan(p_item text, p_local text, p_expected date default null) returns jsonb language sql as $$
  select public.phase8_item(app_private.replenishment_plan('maarif', public.phase8_at(p_local), p_expected, p_item::uuid), p_item);
$$;
grant execute on function public.phase8_plan(text, text, date) to authenticated;

-- A whole Product Mix day: save, one section, the lines, lock and post (Phase 6 commands).
create function public.phase8_mix(p_date date, p_lines jsonb, p_lock boolean default true) returns void language plpgsql as $$
declare
  r jsonb;
  v integer;
  ln jsonb;
  total bigint := 100 * jsonb_array_length(p_lines);
begin
  r := public.app_stock_command('maarif', p_date, 'mix_save', gen_random_uuid(),
         jsonb_build_object('net_sales', total::text, 'local', p_date::text || 'T21:00'));
  v := (r ->> 'version')::integer;
  r := public.app_stock_command('maarif', p_date, 'mix_section', gen_random_uuid(),
         jsonb_build_object('label', 'P8 section', 'total', total::text, 'version', v));
  v := (r ->> 'version')::integer;
  for ln in select x from jsonb_array_elements(p_lines) x loop
    r := public.app_stock_command('maarif', p_date, 'mix_line', gen_random_uuid(),
           jsonb_build_object('section_no', 1, 'label', ln ->> 'label', 'quantity', ln ->> 'qty', 'amount', '100', 'version', v));
    v := (r ->> 'version')::integer;
  end loop;
  if p_lock then
    r := public.app_stock_command('maarif', p_date, 'mix_lock', gen_random_uuid(), jsonb_build_object('version', v));
    r := public.app_stock_command('maarif', p_date, 'post_consumption', gen_random_uuid(), '{}'::jsonb);
  end if;
end;
$$;
grant execute on function public.phase8_mix(date, jsonb, boolean) to authenticated;

-- Book stock of an item up to a business date (as the table owner).
create function public.phase8_book(p_item text, p_date date) returns text language sql as $$
  select coalesce(sum(direction * quantity_num / quantity_den), 0)::numeric(20, 6)::text
  from public.stock_movements where item_id = p_item::uuid and business_date <= p_date;
$$;

-- Test-only groups holding exactly one purchase-order permission, so each is checked alone.
insert into public.permission_groups (key, description, scope) values
  ('peight_creator', 'test only: purchase_order.propose', 'branch'),
  ('peight_approver', 'test only: purchase_order.approve', 'branch'),
  ('peight_receiver', 'test only: purchase_order.receive', 'branch');
insert into public.group_permissions (group_key, permission_key) values
  ('peight_creator', 'purchase_order.propose'), ('peight_approver', 'purchase_order.approve'), ('peight_receiver', 'purchase_order.receive');

insert into auth.users(id, email) values
  ('a8000000-0000-4000-8000-000000000001', 'admin@phase8.test'),
  ('a8000000-0000-4000-8000-000000000002', 'storekeeper@phase8.test'),
  ('a8000000-0000-4000-8000-000000000003', 'manager@phase8.test'),
  ('a8000000-0000-4000-8000-000000000004', 'cashier@phase8.test'),
  ('a8000000-0000-4000-8000-000000000005', 'creator@phase8.test'),
  ('a8000000-0000-4000-8000-000000000006', 'approver@phase8.test'),
  ('a8000000-0000-4000-8000-000000000007', 'receiver@phase8.test'),
  ('a8000000-0000-4000-8000-000000000008', 'outsider@phase8.test'),
  ('a8000000-0000-4000-8000-000000000009', 'otheradmin@phase8.test');
insert into public.employees(id, organization_id, full_name)
  select u.id, b.organization_id, 'P8 ' || split_part(u.email, '@', 1) from auth.users u cross join public.branches b
  where b.code = 'maarif' and u.email like '%@phase8.test' and u.email <> 'otheradmin@phase8.test';
insert into public.staff_accounts(user_id, employee_id, organization_id, email)
  select u.id, u.id, e.organization_id, u.email from auth.users u join public.employees e on e.id = u.id where u.email like '%@phase8.test';
insert into public.branch_memberships(staff_id, branch_id)
  select u.id, b.id from auth.users u cross join public.branches b
  where b.code = 'maarif' and u.email like '%@phase8.test' and u.email not in ('admin@phase8.test', 'otheradmin@phase8.test');
insert into public.staff_group_assignments(staff_id, branch_id, group_key)
  select u.id, m.branch_id, case split_part(u.email, '@', 1)
    when 'creator' then 'peight_creator' when 'approver' then 'peight_approver' when 'receiver' then 'peight_receiver'
    else split_part(u.email, '@', 1) end
  from auth.users u join public.branch_memberships m on m.staff_id = u.id
  where u.email like '%@phase8.test' and u.email <> 'outsider@phase8.test';
insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('a8000000-0000-4000-8000-000000000001', null, 'system_admin');
-- Another organization with its own administrator and a branch of the same code.
insert into public.organizations(id, name) values ('a8000000-0000-4000-8000-0000000000ff', 'P8 other organization');
insert into public.branches(organization_id, code, name_en, name_ar, timezone, business_day_rollover, operates_in_app)
  values ('a8000000-0000-4000-8000-0000000000ff', 'p8other', 'Other', 'أخرى', 'Africa/Casablanca', '02:00', true);
insert into public.employees(id, organization_id, full_name) values ('a8000000-0000-4000-8000-000000000009', 'a8000000-0000-4000-8000-0000000000ff', 'P8 otheradmin');
insert into public.staff_accounts(user_id, employee_id, organization_id, email)
  values ('a8000000-0000-4000-8000-000000000009', 'a8000000-0000-4000-8000-000000000009', 'a8000000-0000-4000-8000-0000000000ff', 'otheradmin@phase8.test');
insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('a8000000-0000-4000-8000-000000000009', null, 'system_admin');

-- ------------------------------------------------------------------ 1. structure, grants and permissions
do $$
declare
  t text;
begin
  foreach t in array array['replenishment_settings', 'replenishment_item_settings', 'replenishment_source_settings', 'purchase_orders',
                           'purchase_order_lines', 'purchase_order_expected_dates', 'purchase_order_receipts',
                           'purchase_order_receipt_lines', 'purchase_order_cancellations', 'purchase_order_events'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ' has row-level security';
    assert not has_table_privilege('authenticated', 'public.' || t, 'insert,update,delete,truncate')
       and not has_table_privilege('anon', 'public.' || t, 'select')
       and not has_table_privilege('service_role', 'public.' || t, 'insert,update,delete'), t || ' is read-only to the API roles';
  end loop;
  -- The API cannot choose the instant of a command or a plan.
  assert not has_function_privilege('authenticated', 'app_private.purchase_order_command(text,text,uuid,jsonb,timestamptz)', 'execute')
     and not has_function_privilege('authenticated', 'app_private.replenishment_plan(text,timestamptz,date,uuid)', 'execute'),
    'the functions that take an instant are closed to the API';
  assert not has_function_privilege('anon', 'public.app_purchase_order_command(text,text,uuid,jsonb)', 'execute')
     and not has_function_privilege('anon', 'public.app_replenishment_plan(text,date,uuid)', 'execute')
     and has_function_privilege('authenticated', 'public.app_purchase_order_command(text,text,uuid,jsonb)', 'execute'),
    'public functions: closed to anonymous callers, open to signed-in people';
  -- One receipt movement per receipt line is a database constraint.
  assert (select contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (movement_id)' from pg_constraint
          where conname = 'purchase_order_receipt_lines_one_movement'), 'unique movement per receipt line';
  assert (select attnotnull from pg_attribute where attrelid = 'public.purchase_order_receipt_lines'::regclass and attname = 'movement_id'),
    'a receipt line always has its movement';
  assert exists (select 1 from pg_trigger where tgname = 'stock_movements_purchase_order_receipt' and tgdeferrable),
    'a purchase-order movement needs its receipt line (deferred check)';
  -- Separate permissions, granted to roles and mirrored in the access catalog.
  assert (select array_agg(group_key order by group_key) from public.group_permissions where permission_key = 'purchase_order.propose')
     = array['peight_creator', 'storekeeper', 'system_admin'], 'create: storekeeper and admin';
  assert (select array_agg(group_key order by group_key) from public.group_permissions where permission_key = 'purchase_order.approve')
     = array['peight_approver', 'system_admin'], 'approve: admin';
  assert (select array_agg(group_key order by group_key) from public.group_permissions where permission_key = 'purchase_order.receive')
     = array['peight_receiver', 'storekeeper', 'system_admin'], 'receive: storekeeper and admin';
  assert not exists (select 1 from public.group_permissions where group_key = 'cashier' and permission_key like 'purchase_order.%');
  -- The open decisions start empty.
  assert not exists (select 1 from public.replenishment_settings) and not exists (select 1 from public.replenishment_item_settings)
     and not exists (select 1 from public.replenishment_source_settings), 'minimum, safety stock and constraints start undecided';
  assert not exists (select 1 from public.purchase_orders), 'no orders in a fresh database';
end $$;

-- Rolled back with everything else: lets the cases below fix the instant of a command.
grant execute on function app_private.purchase_order_command(text, text, uuid, jsonb, timestamptz),
  app_private.replenishment_plan(text, timestamptz, date, uuid) to authenticated;

-- ------------------------------------------------------------------ 2. synthetic catalog and history
-- Items A, B, C, E (pieces). Cakes A, B, C each consume one piece of their item.
do $$
declare
  admin constant uuid := 'a8000000-0000-4000-8000-000000000001';
  k text;
  item uuid; cake uuid; v uuid;
begin
  perform public.phase8_act_as(admin);
  foreach k in array array['a', 'b', 'c'] loop
    item := public.app_catalog_save_item(null, 'ingredient', 'P8 مكون ' || k, null, null, null, 'pc', null, null, null, false, null);
    cake := public.app_catalog_save_item(null, 'sold', 'P8 كيكة ' || k, null, null, null, null, null, null, null, false, null);
    perform public.app_catalog_map_name('foodics', 'P8 كيكة ' || k, cake, 'approve', 'phase 8 check');
    v := public.app_catalog_create_recipe(cake, 'P8 v1 ' || k, null, null);
    perform public.app_catalog_save_recipe_line(v, null, item, '1', 'pc', null, 1);
    perform public.app_catalog_approve_recipe(v, '2026-08-01', null, 2);
    perform public.phase8_put(k, item::text);
  end loop;
  perform public.phase8_put('e', public.app_catalog_save_item(null, 'ingredient', 'P8 مكون e', null, null, null, 'pc', null, null, null, false, null)::text);
  perform public.phase8_put('r', public.app_catalog_save_item(null, 'ingredient', 'P8 مكون استلام', null, null, null, 'kg', null, null, null, false, null)::text);
  perform public.phase8_put('s', public.app_catalog_save_item(null, 'ingredient', 'P8 مكون صلاحيات', null, null, null, 'pc', null, null, null, false, null)::text);
end $$;

-- Planning before the first live date and before the minimum is decided: review, never a number.
do $$
declare
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  p jsonb;
begin
  perform public.phase8_act_as(keeper);
  p := public.phase8_plan(public.phase8_get('b'), '2026-11-18T20:00');
  assert p ->> 'status' = 'review' and p -> 'review_reasons' ? 'first_live_date_unset' and p -> 'review_reasons' ? 'minimum_unset'
     and p -> 'recommended' = 'null'::jsonb and p -> 'forecast' = 'null'::jsonb, 'no live date and no minimum: review state';
end $$;

-- History (Phase 6 Product Mix posted by the storekeeper). First live date: 1 Oct 2026.
--   Thursdays 29 Oct, 5 Nov, 12 Nov:   cake A 150
--   Fridays   30 Oct:  A 100, B 18      (C not sold: a complete day, so C = 0)
--             6 Nov:  A 100, B 22, C 6
--             13 Nov: A 100, B 20, C 6
--   Friday 23 Oct: Product Mix saved but not locked -> MISSING (never zero)
--   Friday 25 Sep: complete, B 1000 -> before the first live date, excluded
--   Wednesday 18 Nov (the order date): A 5, complete
do $$
declare
  admin constant uuid := 'a8000000-0000-4000-8000-000000000001';
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
begin
  perform public.phase8_act_as(admin);
  perform public.app_comparison_settings_save('maarif', 0, null, null, '2026-10-01');
  perform public.phase8_act_as(keeper);
  perform public.phase8_mix('2026-09-25', '[{"label":"P8 كيكة b","qty":"1000"}]');
  perform public.phase8_mix('2026-10-29', '[{"label":"P8 كيكة a","qty":"150"}]');
  perform public.phase8_mix('2026-11-05', '[{"label":"P8 كيكة a","qty":"150"}]');
  perform public.phase8_mix('2026-11-12', '[{"label":"P8 كيكة a","qty":"150"}]');
  perform public.phase8_mix('2026-10-23', '[{"label":"P8 كيكة b","qty":"40"}]', false);
  perform public.phase8_mix('2026-10-30', '[{"label":"P8 كيكة a","qty":"100"},{"label":"P8 كيكة b","qty":"18"}]');
  perform public.phase8_mix('2026-11-06', '[{"label":"P8 كيكة a","qty":"100"},{"label":"P8 كيكة b","qty":"22"},{"label":"P8 كيكة c","qty":"6"}]');
  perform public.phase8_mix('2026-11-13', '[{"label":"P8 كيكة a","qty":"100"},{"label":"P8 كيكة b","qty":"20"},{"label":"P8 كيكة c","qty":"6"}]');
  perform public.phase8_mix('2026-11-18', '[{"label":"P8 كيكة a","qty":"5"}]');
end $$;

-- Book stock on Wednesday 18 Nov through ordinary Phase 6 receipts: A 10, B 7, C 100, E 0.
do $$
declare
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  k text;
  target numeric;
  have numeric;
begin
  foreach k in array array['a', 'b', 'c'] loop
    perform public.phase8_act_as(null);
    have := public.phase8_book(public.phase8_get(k), '2026-11-18')::numeric;
    target := case k when 'a' then 10 when 'b' then 7 else 100 end;
    perform public.phase8_act_as(keeper);
    perform public.app_stock_command('maarif', '2026-11-18', 'movement', gen_random_uuid(),
      jsonb_build_object('kind', 'receipt', 'item', public.phase8_get(k), 'quantity', (target - have)::text, 'local', '2026-11-18T10:00'));
  end loop;
  perform public.phase8_act_as(null);
  assert public.phase8_book(public.phase8_get('a'), '2026-11-18')::numeric = 10 and public.phase8_book(public.phase8_get('b'), '2026-11-18')::numeric = 7
     and public.phase8_book(public.phase8_get('c'), '2026-11-18')::numeric = 100, 'book stock of the order date';
end $$;

-- ------------------------------------------------------------------ 3. dates: the two-day rule and the 02:00 cutoff
do $$
declare
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  r jsonb;
  line jsonb := jsonb_build_array(jsonb_build_object('item', public.phase8_get('e'), 'quantity', '1', 'source', 'factory'));
begin
  assert extract(isodow from date '2026-11-18') = 3 and extract(isodow from date '2026-11-20') = 5, '18 Nov is a Wednesday, 20 Nov a Friday';
  perform public.phase8_act_as(keeper);
  -- Wednesday evening -> Friday.
  r := public.phase8_po('create', jsonb_build_object('lines', line), '2026-11-18T20:00');
  assert r ->> 'business_date' = '2026-11-18' and r ->> 'expected' = '2026-11-20', 'Wednesday 20:00 order: business date Wednesday, expected Friday';
  perform public.phase8_act_as(null);
  assert (select created_at = public.phase8_at('2026-11-18T20:00') and created_local = '2026-11-18T20:00' and status = 'proposed'
          from public.purchase_orders where id = (r ->> 'order')::uuid), 'the actual creation instant is kept apart from the business date';
  assert (select kind = 'default' and revision = 1 and rule like '%+ 2 calendar days' from public.purchase_order_expected_dates
          where order_id = (r ->> 'order')::uuid), 'revision 1 is the default date and names its rule';
  perform public.phase8_act_as(keeper);
  -- Thursday 01:30 is still Wednesday's business day (Phase 4 cutoff 02:00) -> Friday.
  r := public.phase8_po('create', jsonb_build_object('lines', line), '2026-11-19T01:30');
  assert r ->> 'business_date' = '2026-11-18' and r ->> 'expected' = '2026-11-20', 'after midnight, before 02:00: still Wednesday -> Friday';
  -- Thursday 02:00 starts Thursday's business day -> Saturday.
  r := public.phase8_po('create', jsonb_build_object('lines', line), '2026-11-19T02:00');
  assert r ->> 'business_date' = '2026-11-19' and r ->> 'expected' = '2026-11-21', '02:00 belongs to Thursday -> Saturday';
end $$;

-- ------------------------------------------------------------------ 4. ORD-02 lines: numeric quantity, unit, source
do $$
declare
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  e text := public.phase8_get('e');
  q text;
begin
  perform public.phase8_act_as(keeper);
  foreach q in array array['،', 'abc', '0', '', '1/2', '-3', '1,5'] loop
    perform public.phase8_expect('22023', format($q$select public.phase8_po('create', %L::jsonb, '2026-11-18T20:00')$q$,
      jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', e, 'quantity', q, 'source', 'factory')))));
  end loop;
  perform public.phase8_expect('22023', format($q$select public.phase8_po('create', %L::jsonb, '2026-11-18T20:00')$q$,
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', e, 'quantity', '2', 'source', 'supplier')))));
  perform public.phase8_expect('22023', format($q$select public.phase8_po('create', %L::jsonb, '2026-11-18T20:00')$q$,
    jsonb_build_object('lines', '[]'::jsonb)));
  -- A unit that does not convert to the item's base unit is refused.
  perform public.phase8_expect('CT003', format($q$select public.phase8_po('create', %L::jsonb, '2026-11-18T20:00')$q$,
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', e, 'quantity', '2', 'unit', 'kg', 'source', 'store')))));
  perform public.phase8_act_as(null);
  assert (select count(*) from public.purchase_orders) = 3, 'refused orders wrote nothing';
end $$;

-- ------------------------------------------------------------------ 5. separate permissions (database level)
do $$
declare
  creator constant uuid := 'a8000000-0000-4000-8000-000000000005';
  approver constant uuid := 'a8000000-0000-4000-8000-000000000006';
  receiver constant uuid := 'a8000000-0000-4000-8000-000000000007';
  cashier constant uuid := 'a8000000-0000-4000-8000-000000000004';
  outsider constant uuid := 'a8000000-0000-4000-8000-000000000008';
  other constant uuid := 'a8000000-0000-4000-8000-000000000009';
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  manager constant uuid := 'a8000000-0000-4000-8000-000000000003';
  create_pay jsonb := jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', public.phase8_get('s'), 'quantity', '5', 'source', 'store')));
  r jsonb;
  ord text;
  ln text;
  who uuid;
begin
  -- Only the creator can create.
  foreach who in array array[approver, receiver, cashier, outsider, manager] loop
    perform public.phase8_act_as(who);
    perform public.phase8_expect('42501', format($q$select public.app_purchase_order_command('maarif', 'create', gen_random_uuid(), %L::jsonb)$q$, create_pay));
  end loop;
  perform public.phase8_act_as(other);
  perform public.phase8_expect('42501', format($q$select public.app_purchase_order_command('maarif', 'create', gen_random_uuid(), %L::jsonb)$q$, create_pay));
  perform public.phase8_act_as(creator);
  r := public.phase8_po('create', create_pay, '2026-11-18T21:00');
  ord := r ->> 'order';
  perform public.phase8_act_as(null);
  ln := (select id::text from public.purchase_order_lines where order_id = ord::uuid);
  -- Only the approver can approve.
  foreach who in array array[creator, receiver, keeper, cashier, manager, outsider] loop
    perform public.phase8_act_as(who);
    perform public.phase8_expect('42501', format($q$select public.phase8_po('approve', '{"order":"%s"}', '2026-11-18T21:30')$q$, ord));
  end loop;
  -- Nothing can be received before approval.
  perform public.phase8_act_as(receiver);
  perform public.phase8_expect('CT803', format($q$select public.phase8_po('receive', '{"order":"%s","local":"2026-11-20T09:00","lines":[{"line":"%s","quantity":"5"}]}', '2026-11-20T10:00')$q$, ord, ln));
  perform public.phase8_act_as(approver);
  r := public.phase8_po('approve', jsonb_build_object('order', ord), '2026-11-18T21:30');
  assert r ->> 'status' = 'approved';
  perform public.phase8_expect('CT803', format($q$select public.phase8_po('approve', '{"order":"%s"}', '2026-11-18T21:35')$q$, ord));
  -- Only the receiver can receive.
  foreach who in array array[creator, approver, cashier, manager, outsider] loop
    perform public.phase8_act_as(who);
    perform public.phase8_expect('42501', format($q$select public.phase8_po('receive', '{"order":"%s","local":"2026-11-20T09:00","lines":[{"line":"%s","quantity":"2"}]}', '2026-11-20T10:00')$q$, ord, ln));
  end loop;
  perform public.phase8_act_as(receiver);
  r := public.phase8_po('receive', jsonb_build_object('order', ord, 'local', '2026-11-20T09:00',
         'lines', jsonb_build_array(jsonb_build_object('line', ln, 'quantity', '2'))), '2026-11-20T10:00');
  assert (r ->> 'movements')::int = 1 and r ->> 'business_date' = '2026-11-20', 'the receiver receives';
  -- Cancelling needs the approver; changing the expected date needs the creator or the approver.
  perform public.phase8_expect('42501', format($q$select public.phase8_po('cancel_rest', '{"line":"%s","reason":"x"}', '2026-11-20T11:00')$q$, ln));
  perform public.phase8_expect('42501', format($q$select public.phase8_po('set_expected', '{"order":"%s","date":"2026-11-21","reason":"x"}', '2026-11-20T11:00')$q$, ord));
  perform public.phase8_act_as(creator);
  perform public.phase8_expect('42501', format($q$select public.phase8_po('cancel_rest', '{"line":"%s","reason":"x"}', '2026-11-20T11:00')$q$, ln));
  r := public.phase8_po('set_expected', jsonb_build_object('order', ord, 'date', '2026-11-21', 'reason', 'P8 supplier moved it'), '2026-11-20T11:00');
  assert r ->> 'expected' = '2026-11-21';
  perform public.phase8_act_as(approver);
  r := public.phase8_po('cancel_rest', jsonb_build_object('line', ln, 'reason', 'P8 not coming'), '2026-11-20T11:30');
  assert public.phase8_q(r -> 'cancelled') = '3/1', 'the approver cancels the unreceived 3';
  -- Reading: the plan, the order list and the tables follow the same rule.
  foreach who in array array[cashier, outsider] loop
    perform public.phase8_act_as(who);
    perform public.phase8_expect('42501', $q$select public.app_replenishment_plan('maarif')$q$);
    perform public.phase8_expect('42501', $q$select public.app_purchase_orders('maarif')$q$);
    assert (select count(*) from public.purchase_orders) = 0 and (select count(*) from public.purchase_order_lines) = 0
       and (select count(*) from public.purchase_order_receipts) = 0 and (select count(*) from public.purchase_order_events) = 0,
      'orders hidden from the cashier and from a person without a group';
  end loop;
  perform public.phase8_act_as(other);
  perform public.phase8_expect('42501', $q$select public.app_replenishment_plan('maarif')$q$);
  assert (select count(*) from public.purchase_orders) = 0, 'orders hidden from another organization''s administrator';
  foreach who in array array[keeper, manager, creator, approver, receiver] loop
    perform public.phase8_act_as(who);
    assert (select count(*) from public.purchase_orders where id = ord::uuid) = 1
       and (select count(*) from public.purchase_order_lines where order_id = ord::uuid) = 1, 'readers see the branch''s orders';
  end loop;
  -- Settings and the legacy import are administration.
  perform public.phase8_act_as(keeper);
  perform public.phase8_expect('42501', $q$select public.app_replenishment_settings_save('maarif', 0, 3, 1)$q$);
  perform public.phase8_expect('42501', format($q$select public.app_replenishment_item_settings_save('maarif', %L, 0, '5', null, null, null, null)$q$, public.phase8_get('b')));
  perform public.phase8_expect('42501', $q$select public.app_replenishment_source_settings_save('maarif', 'factory', 0, 3, null)$q$);
  perform public.phase8_expect('42501', format($q$select public.phase8_po('import_legacy', %L::jsonb, '2026-11-18T20:00')$q$,
    jsonb_build_object('expected_date', '2026-12-07', 'source_value', '07\12/2026', 'lines', create_pay -> 'lines')));
  perform public.phase8_act_as(null);
  perform public.phase8_expect('42501', $q$set local role anon; select public.app_purchase_orders('maarif')$q$);
end $$;
reset role;

-- ------------------------------------------------------------------ 6. the planning view: history, missing days, review
do $$
declare
  admin constant uuid := 'a8000000-0000-4000-8000-000000000001';
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  p jsonb;
  o jsonb;
begin
  perform public.phase8_act_as(keeper);
  p := public.phase8_plan(public.phase8_get('c'), '2026-11-18T20:00');
  assert p ->> 'status' = 'review' and p -> 'review_reasons' = '["minimum_unset"]', 'minimum not decided: review';
  perform public.phase8_act_as(admin);
  perform public.app_replenishment_settings_save('maarif', 0, 3, 1);
  perform public.phase8_act_as(keeper);
  -- C on Fridays: 23 Oct missing (draft) and 2, 9, 16 Oct missing (nothing saved); 30 Oct complete
  -- with no C sold = 0; 6 Nov 6; 13 Nov 6. Average (0 + 6 + 6) / 3 = 4. Counting the four missing
  -- Fridays as zero would give 12 / 7.
  p := public.phase8_plan(public.phase8_get('c'), '2026-11-18T20:00');
  o := p #> '{coverage,0,observations}';
  assert p ->> 'expected' = '2026-11-20' and (o ->> 'weekday')::int = 5, 'coverage day: Friday 20 Nov';
  assert (o ->> 'complete')::int = 3 and (o ->> 'missing')::int = 4 and public.phase8_q(o -> 'average') = '4/1',
    format('missing days are excluded from the average, not zero: %s', o);
  assert (select count(*) from jsonb_array_elements(o -> 'dates') x where x ->> 'status' = 'missing' and x -> 'demand' = 'null'::jsonb) = 4
     and (select x ->> 'status' from jsonb_array_elements(o -> 'dates') x where x ->> 'date' = '2026-10-23') = 'missing'
     and (select public.phase8_q(x -> 'demand') from jsonb_array_elements(o -> 'dates') x where x ->> 'date' = '2026-10-30') = '0/1',
    'an unposted day is missing with no value; a complete day without consumption is a real 0';
  -- B: 25 Sep (1000) is before the first live date and is not used.
  p := public.phase8_plan(public.phase8_get('b'), '2026-11-18T20:00');
  o := p #> '{coverage,0,observations}';
  assert (select x ->> 'status' from jsonb_array_elements(o -> 'dates') x where x ->> 'date' = '2026-09-25') = 'before_live'
     and public.phase8_q(o -> 'average') = '20/1' and (o ->> 'complete')::int = 3, 'history starts on the first live date';
  -- The whole three-month window is shown per weekday on the item view.
  assert jsonb_array_length(p -> 'history') = 7
     and (select bool_and(jsonb_array_length(x -> 'dates') = 13) from jsonb_array_elements(p -> 'history') x), '7 weekdays x 13 weeks';
  assert (p #>> '{history,3,complete}')::int = 3 and (p #> '{history,3}') ->> 'weekday' = '4', 'three complete Thursdays';
  -- A higher minimum puts the item back in review, and a manual order stays available.
  perform public.phase8_act_as(admin);
  perform public.app_replenishment_settings_save('maarif', 1, 4, 1);
  perform public.phase8_act_as(keeper);
  p := public.phase8_plan(public.phase8_get('b'), '2026-11-18T20:00');
  assert p ->> 'status' = 'review' and p -> 'review_reasons' = '["insufficient_history"]' and p -> 'recommended' = 'null'::jsonb
     and (p #>> '{coverage,0,observations,complete}')::int = 3, 'insufficient history: review, the available history shown';
  o := public.phase8_po('create', jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', public.phase8_get('b'),
         'quantity', '12', 'source', 'factory', 'from_plan', true))), '2026-11-18T20:05');
  perform public.phase8_act_as(null);
  assert (select suggested_num is null and plan is null and override_reason is null and quantity_text = '12'
          from public.purchase_order_lines where order_id = (o ->> 'order')::uuid), 'review state: the order is a manual order';
  perform public.phase8_act_as(admin);
  perform public.app_replenishment_settings_save('maarif', 2, 3, 1);
  perform public.phase8_expect('40001', $q$select public.app_replenishment_settings_save('maarif', 2, 3, 1)$q$);
end $$;

-- ------------------------------------------------------------------ 7. Abdo's example: 10 on hand + 190 incoming = 200; 150 used -> 50
do $$
declare
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  admin constant uuid := 'a8000000-0000-4000-8000-000000000001';
  r jsonb;
  p jsonb;
  t jsonb;
begin
  -- Ordered on Tuesday night for Thursday: 190 of A.
  perform public.phase8_act_as(keeper);
  r := public.phase8_po('create', jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', public.phase8_get('a'),
         'quantity', '190', 'source', 'factory'))), '2026-11-17T20:00');
  assert r ->> 'expected' = '2026-11-19';
  perform public.phase8_act_as(admin);
  perform public.phase8_po('approve', jsonb_build_object('order', r ->> 'order'), '2026-11-17T20:30');
  perform public.phase8_act_as(keeper);
  p := public.phase8_plan(public.phase8_get('a'), '2026-11-18T20:00');
  assert public.phase8_q(p -> 'on_hand') = '10/1' and (p ->> 'today_posted')::boolean, 'Wednesday closes with 10 (posted)';
  t := p #> '{bridge,1}';
  assert t ->> 'date' = '2026-11-19' and public.phase8_q(t -> 'incoming') = '190/1' and public.phase8_q(t -> 'opening') = '200/1'
     and public.phase8_q(t -> 'consumption') = '150/1' and t ->> 'basis' = 'forecast' and public.phase8_q(t -> 'closing') = '50/1',
    format('Thursday: 10 + 190 = 200 projected, forecast 150 leaves 50: %s', t);
  assert public.phase8_q(p -> 'usable') = '50/1' and (p #>> '{bridge,0,basis}') = 'posted', 'usable at the Friday receipt: 50';
  assert (p -> 'incoming' -> 0 ->> 'bucket') = 'before_receipt' and public.phase8_q(p -> 'eligible_incoming') = '0/1',
    'the Thursday delivery is counted once, in usable stock, not again as eligible incoming';
  -- Actual stock stays tied to recorded movements: the order added nothing.
  perform public.phase8_act_as(null);
  assert public.phase8_book(public.phase8_get('a'), '2026-11-19')::numeric = 10
     and not exists (select 1 from public.stock_movements where source = 'purchase_order' and item_id = public.phase8_get('a')::uuid),
    'no stock from an order alone';
end $$;

-- ------------------------------------------------------------------ 8. the formula: 20 + 5 - 7 - 3 = 15, floors and windows
do $$
declare
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  admin constant uuid := 'a8000000-0000-4000-8000-000000000001';
  b text := public.phase8_get('b');
  e text := public.phase8_get('e');
  r jsonb;
  p jsonb;
  o2 text;
  ord text;
begin
  perform public.phase8_act_as(admin);
  -- Safety stock is the branch percentage of the forecast (default 20, owner-approved); a per-item quantity is refused.
  perform public.phase8_expect('22023', format($q$select public.app_replenishment_item_settings_save('maarif', %L, 0, '5', null, null, null, null)$q$, b));
  perform public.app_replenishment_item_settings_save('maarif', b::uuid, 0, null, null, null, null, null);
  perform public.phase8_expect('22023', format($q$select public.app_replenishment_item_settings_save('maarif', %L, 1, null, 'x', null, null, null)$q$, b));
  perform public.phase8_expect('40001', format($q$select public.app_replenishment_item_settings_save('maarif', %L, 0, null, null, null, null, null)$q$, b));
  assert (public.app_replenishment_settings('maarif') ->> 'safety_percent')::numeric = 20, 'the safety percentage starts at the default 20';
  perform public.phase8_expect('22023', format($q$select public.app_replenishment_settings_save('maarif', %s, 3, 1, 100.5)$q$, (public.app_replenishment_settings('maarif') ->> 'revision')::int));
  perform public.phase8_expect('22023', format($q$select public.app_replenishment_settings_save('maarif', %s, 3, 1, -1)$q$, (public.app_replenishment_settings('maarif') ->> 'revision')::int));
  perform public.phase8_expect('22023', format($q$select public.app_replenishment_settings_save('maarif', %s, 3, 1, 12.345)$q$, (public.app_replenishment_settings('maarif') ->> 'revision')::int));
  -- 25 % of a 20 forecast is the 5 of safety stock in the Phase 8 example.
  perform public.app_replenishment_settings_save('maarif', (public.app_replenishment_settings('maarif') ->> 'revision')::int, 3, 1, 25);
  -- 3 of B expected Friday (the receipt date): eligible incoming.
  perform public.phase8_act_as(keeper);
  r := public.phase8_po('create', jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', b, 'quantity', '3', 'source', 'factory'))), '2026-11-18T20:00');
  o2 := r ->> 'order';
  perform public.phase8_put('o2', o2);
  -- A proposed order is not confirmed incoming.
  perform public.phase8_po('create', jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', b, 'quantity', '50', 'source', 'store'))), '2026-11-18T20:00');
  perform public.phase8_act_as(admin);
  perform public.phase8_po('approve', jsonb_build_object('order', o2), '2026-11-18T20:10');
  perform public.phase8_act_as(keeper);
  -- B: forecast Friday (18 + 22 + 20) / 3 = 20; safety 25 % of 20 = 5; usable 7 (Thursday forecast 0); incoming 3.
  p := public.phase8_plan(b, '2026-11-18T20:30');
  assert p ->> 'status' = 'recommend' and public.phase8_q(p -> 'forecast') = '20/1' and public.phase8_q(p -> 'safety') = '5/1'
     and (p ->> 'safety_percent')::numeric = 25
     and public.phase8_q(p -> 'usable') = '7/1' and public.phase8_q(p -> 'eligible_incoming') = '3/1'
     and public.phase8_q(p -> 'raw') = '15/1' and public.phase8_q(p -> 'recommended') = '15/1' and public.phase8_q(p -> 'suggested') = '15/1',
    format('20 + 5 - 7 - 3 = 15: %s', p - 'coverage' - 'history');
  -- C: 4 + 1 (25 %) - 100 - 0 = -95 -> 0.
  p := public.phase8_plan(public.phase8_get('c'), '2026-11-18T20:30');
  assert public.phase8_q(p -> 'raw') = '-95/1' and public.phase8_q(p -> 'recommended') = '0/1' and public.phase8_q(p -> 'safety') = '1/1',
    'a negative result floors at 0; safety stock is 25 % of the forecast of 4';
  -- The default 20 % and an explicit 0 %: B gives 20 + 4 - 7 - 3 = 14 and 20 + 0 - 7 - 3 = 10.
  perform public.phase8_act_as(admin);
  perform public.app_replenishment_settings_save('maarif', (public.app_replenishment_settings('maarif') ->> 'revision')::int, 3, 1, 20);
  perform public.phase8_act_as(keeper);
  p := public.phase8_plan(b, '2026-11-18T20:30');
  assert public.phase8_q(p -> 'safety') = '4/1' and public.phase8_q(p -> 'recommended') = '14/1', '20 percent: 20 + 4 - 7 - 3 = 14';
  perform public.phase8_act_as(admin);
  perform public.app_replenishment_settings_save('maarif', (public.app_replenishment_settings('maarif') ->> 'revision')::int, 3, 1, 0);
  perform public.phase8_act_as(keeper);
  p := public.phase8_plan(b, '2026-11-18T20:30');
  assert public.phase8_q(p -> 'safety') = '0/1' and public.phase8_q(p -> 'recommended') = '10/1', '0 percent: no safety stock, 20 - 7 - 3 = 10';
  perform public.phase8_act_as(admin);
  perform public.app_replenishment_settings_save('maarif', (public.app_replenishment_settings('maarif') ->> 'revision')::int, 3, 1, 25);
  perform public.phase8_act_as(null);
  assert (select (a.changes -> 'after' ->> 'safety_percent')::numeric = 25 and (a.changes -> 'before' ->> 'safety_percent')::numeric = 0
          from public.audit_log a where a.action = 'replenishment.settings_changed' order by a.occurred_at desc, a.id desc limit 1),
    'each percentage change is audited with before and after';
  perform public.phase8_act_as(keeper);

  -- Orders from the plan keep the suggestion, the final quantity and the override reason.
  r := public.phase8_po('create', jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', b, 'quantity', '15', 'source', 'factory',
         'from_plan', true, 'expected_suggested', '15/1'))), '2026-11-18T20:30');
  perform public.phase8_act_as(null);
  assert (select suggested_num = 15 and suggested_den = 1 and override_reason is null and plan ->> 'status' = 'recommend'
          and public.phase8_q(plan -> 'usable') = '7/1' from public.purchase_order_lines where order_id = (r ->> 'order')::uuid),
    'the line keeps the suggestion and the arithmetic it came from';
  perform public.phase8_act_as(keeper);
  perform public.phase8_expect('CT804', format($q$select public.phase8_po('create', %L::jsonb, '2026-11-18T20:30')$q$,
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', b, 'quantity', '20', 'source', 'factory', 'from_plan', true)))));
  perform public.phase8_expect('CT802', format($q$select public.phase8_po('create', %L::jsonb, '2026-11-18T20:30')$q$,
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', b, 'quantity', '15', 'source', 'factory', 'from_plan', true,
      'expected_suggested', '14/1')))));
  r := public.phase8_po('create', jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', b, 'quantity', '20', 'source', 'factory',
         'from_plan', true, 'override_reason', 'P8 weekend event'))), '2026-11-18T20:30');
  perform public.phase8_act_as(null);
  assert (select suggested_num = 15 and quantity_text = '20' and override_reason = 'P8 weekend event'
          from public.purchase_order_lines where order_id = (r ->> 'order')::uuid), 'suggested 15, final 20, reason kept';

  -- E: incoming overdue (Tue 17), before the receipt (Thu 19), in the window (Fri 20), after it (Sat 21).
  perform public.phase8_act_as(keeper);
  foreach ord in array array['2026-11-15T20:00|1', '2026-11-17T20:00|4', '2026-11-18T20:00|3', '2026-11-18T20:01|9'] loop
    r := public.phase8_po('create', jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', e, 'quantity', split_part(ord, '|', 2),
           'source', 'store'))), split_part(ord, '|', 1));
    if split_part(ord, '|', 2) = '9' then
      perform public.phase8_po('set_expected', jsonb_build_object('order', r ->> 'order', 'date', '2026-11-21', 'reason', 'P8 Saturday delivery'), '2026-11-18T20:02');
    end if;
    perform public.phase8_act_as(admin);
    perform public.phase8_po('approve', jsonb_build_object('order', r ->> 'order'), '2026-11-18T20:03');
    perform public.phase8_act_as(keeper);
  end loop;
  perform public.phase8_act_as(admin);
  perform public.app_replenishment_item_settings_save('maarif', e::uuid, 0, null, null, null, null, 'store');
  perform public.phase8_act_as(keeper);
  -- 0 forecast + 0 safety - (0 + 4) usable - 3 eligible = -7. Counting Saturday's 9 would give -16;
  -- counting Thursday's 4 twice would give -11; counting the overdue 1 would give -8.
  p := public.phase8_plan(e, '2026-11-18T20:30');
  assert public.phase8_q(p -> 'usable') = '4/1' and public.phase8_q(p -> 'eligible_incoming') = '3/1' and public.phase8_q(p -> 'raw') = '-7/1'
     and public.phase8_q(p -> 'recommended') = '0/1',
    format('incoming outside the window is excluded and nothing is counted twice: %s', p - 'coverage' - 'history');
  assert (select array_agg(x ->> 'bucket' order by x ->> 'expected') from jsonb_array_elements(p -> 'incoming') x)
     = array['overdue', 'before_receipt', 'window', 'after_window'], 'each incoming line is shown with how it is counted';
  assert (select x ->> 'original_expected' = '2026-11-20' and (x ->> 'overridden')::boolean from jsonb_array_elements(p -> 'incoming') x
          where x ->> 'bucket' = 'after_window'), 'the incoming list shows the original and the overridden date';

  -- Constraints after the forecast and the safety stock, only once confirmed: B 15 -> minimum 16 -> packs of 6 -> 18.
  perform public.phase8_act_as(admin);
  perform public.app_replenishment_item_settings_save('maarif', b::uuid, 1, null, '6', '16', 1, null);
  perform public.app_replenishment_settings_save('maarif', (public.app_replenishment_settings('maarif') ->> 'revision')::int, 3, 2);
  perform public.app_replenishment_source_settings_save('maarif', 'store', 0, null, '18:00');
  perform public.phase8_act_as(keeper);
  p := public.phase8_plan(b, '2026-11-18T20:30');
  -- Two coverage days (Fri, Sat): Saturday has no complete history -> review; constraints wait, no safety stock is invented.
  assert p ->> 'status' = 'review' and p -> 'suggested' = 'null'::jsonb and p -> 'safety' = 'null'::jsonb, 'a coverage day without history: review';
  perform public.phase8_act_as(admin);
  perform public.app_replenishment_settings_save('maarif', (public.app_replenishment_settings('maarif') ->> 'revision')::int, 3, 1);
  perform public.phase8_act_as(keeper);
  p := public.phase8_plan(b, '2026-11-18T20:30');
  assert (p ->> 'safety_percent')::numeric = 25 and public.phase8_q(p -> 'recommended') = '15/1' and public.phase8_q(p -> 'suggested') = '18/1'
     and p #>> '{constraints,0,code}' = 'supplier_minimum' and public.phase8_q(p #> '{constraints,0,value}') = '16/1'
     and p #>> '{constraints,1,code}' = 'pack_size' and (p #>> '{constraints,1,packs}')::int = 3,
    format('the percentage survives other setting saves; minimum then pack size: 15 -> 16 -> 18: %s', p -> 'constraints');
  p := public.phase8_plan(e, '2026-11-18T20:30');  -- E is a store item
  assert p -> 'warnings' @> '[{"code":"after_cutoff","cutoff":"18:00"}]', '20:30 is after the 18:00 cut-off of the store';
  assert not (public.phase8_plan(e, '2026-11-18T17:00') -> 'warnings' @> '[{"code":"after_cutoff"}]'), '17:00 is before it';
  assert public.phase8_plan(e, '2026-11-19T01:30') -> 'warnings' @> '[{"code":"after_cutoff"}]', '01:30 (same business day) is after it';
  perform public.phase8_act_as(admin);
  perform public.app_replenishment_item_settings_save('maarif', b::uuid, 2, null, null, null, null, null);
  perform public.app_replenishment_source_settings_save('maarif', 'store', 1, null, null);
  perform public.phase8_act_as(keeper);
  assert public.phase8_q(public.phase8_plan(b, '2026-11-18T20:30') -> 'suggested') = '15/1', 'cleared constraints have no effect';
end $$;

-- ------------------------------------------------------------------ 9. a changed expected receipt date: original kept, effect on the plan
do $$
declare
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  b text := public.phase8_get('b');
  o2 text := public.phase8_get('o2');
  p jsonb;
  r jsonb;
begin
  perform public.phase8_act_as(keeper);
  perform public.phase8_expect('22023', format($q$select public.phase8_po('set_expected', '{"order":"%s","date":"2026-11-21"}', '2026-11-18T21:00')$q$, o2));
  perform public.phase8_expect('22023', format($q$select public.phase8_po('set_expected', '{"order":"%s","date":"2026-11-17","reason":"x"}', '2026-11-18T21:00')$q$, o2));
  perform public.phase8_expect('22023', format($q$select public.phase8_po('set_expected', '{"order":"%s","date":"2026-11-20","reason":"x"}', '2026-11-18T21:00')$q$, o2));
  r := public.phase8_po('set_expected', jsonb_build_object('order', o2, 'date', '2026-11-21', 'reason', 'P8 factory closed Friday'), '2026-11-18T21:00');
  assert r ->> 'previous' = '2026-11-20' and r ->> 'expected' = '2026-11-21' and (r ->> 'revision')::int = 2;
  perform public.phase8_act_as(null);
  assert (select array_agg(expected_date::text || '|' || kind || '|' || coalesce(reason, '') order by revision)
          from public.purchase_order_expected_dates where order_id = o2::uuid)
     = array['2026-11-20|default|', '2026-11-21|override|P8 factory closed Friday'], 'both dates and the reason are kept';
  assert exists (select 1 from public.audit_log where action = 'purchase_order.set_expected' and target_id = o2
                 and changes ->> 'reason' = 'P8 factory closed Friday' and changes ->> 'previous' = '2026-11-20'), 'the override is audited';
  -- Effect on the plan: the 3 leave the Friday window, so B now needs 18 instead of 15.
  perform public.phase8_act_as(keeper);
  p := public.phase8_plan(b, '2026-11-18T21:05');
  assert public.phase8_q(p -> 'eligible_incoming') = '0/1' and public.phase8_q(p -> 'recommended') = '18/1'
     and (select x ->> 'bucket' from jsonb_array_elements(p -> 'incoming') x where x ->> 'order' = o2) = 'after_window',
    'moving the receipt date out of the window changes the recommendation 15 -> 18';
  -- A what-if receipt on Saturday: Saturday has no history -> review, the 3 are eligible again.
  p := public.phase8_plan(b, '2026-11-18T21:05', '2026-11-21');
  assert p ->> 'expected' = '2026-11-21' and p ->> 'status' = 'review' and public.phase8_q(p -> 'eligible_incoming') = '3/1';
  perform public.phase8_expect('22023', format($q$select public.phase8_plan(%L, '2026-11-18T21:05', '2026-11-17')$q$, b));
end $$;

-- ------------------------------------------------------------------ 10. receiving: 4 then 6 of 10, retries, over-receipt, cancellation
do $$
declare
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  admin constant uuid := 'a8000000-0000-4000-8000-000000000001';
  item text := public.phase8_get('r');
  r jsonb;
  ord text;
  l1 text; l2 text;
  req uuid := gen_random_uuid();
  pay jsonb;
begin
  perform public.phase8_act_as(keeper);
  r := public.phase8_po('create', jsonb_build_object('lines', jsonb_build_array(
         jsonb_build_object('item', item, 'quantity', '10', 'source', 'factory'),
         jsonb_build_object('item', item, 'quantity', '10', 'source', 'store'))), '2026-11-18T22:00');
  ord := r ->> 'order';
  perform public.phase8_act_as(null);
  l1 := (select id::text from public.purchase_order_lines where order_id = ord::uuid and source = 'factory');
  l2 := (select id::text from public.purchase_order_lines where order_id = ord::uuid and source = 'store');
  perform public.phase8_put('ord', ord); perform public.phase8_put('l1', l1); perform public.phase8_put('l2', l2);
  perform public.phase8_act_as(admin);
  perform public.phase8_po('approve', jsonb_build_object('order', ord), '2026-11-18T22:10');
  perform public.phase8_act_as(keeper);
  -- Received on Friday morning: 4.
  pay := jsonb_build_object('order', ord, 'local', '2026-11-20T09:00', 'reference', 'P8 delivery note 1',
           'lines', jsonb_build_array(jsonb_build_object('line', l1, 'quantity', '4')));
  r := public.phase8_po('receive', pay, '2026-11-20T09:30', req);
  assert not (r ->> 'replayed')::boolean and (r ->> 'movements')::int = 1;
  -- The same request again (a resubmitted form): the first result, nothing new.
  r := public.phase8_po('receive', pay, '2026-11-20T09:31', req);
  assert (r ->> 'replayed')::boolean, 'retry is a replay';
  perform public.phase8_expect('23505', format($q$select public.phase8_po('receive', %L::jsonb, '2026-11-20T09:32', %L)$q$,
    jsonb_set(pay, '{lines,0,quantity}', '"5"'), req));
  -- Received in the afternoon: 6.
  r := public.phase8_po('receive', jsonb_build_object('order', ord, 'local', '2026-11-20T15:00',
         'lines', jsonb_build_array(jsonb_build_object('line', l1, 'quantity', '6'))), '2026-11-20T15:10');
  perform public.phase8_act_as(null);
  assert (select count(*) from public.stock_movements m join public.purchase_order_receipt_lines rl on rl.movement_id = m.id
          where rl.line_id = l1::uuid and m.kind = 'receipt' and m.source = 'purchase_order') = 2,
    'two receipts, two movements';
  assert public.phase8_book(item, '2026-11-20')::numeric = 10 and public.phase8_book(item, '2026-11-19')::numeric = 0,
    'receiving 4 then 6 adds 10 in total, on the actual receipt date';
  assert (select count(*) from public.purchase_order_receipts where order_id = ord::uuid) = 2
     and (select count(*) from public.stock_postings p where p.command = 'po_receipt' and p.request_id = req) = 1
     and (select count(*) from public.purchase_order_events where request_id = req) = 1, 'the retry wrote no receipt, posting or event';
  assert (select r2.business_date = '2026-11-20' and r2.received_local = '2026-11-20T09:00' from public.purchase_order_receipts r2
          join public.stock_postings p on p.id = r2.posting_id where p.request_id = req), 'the actual receipt date comes from the evidence';
  perform public.phase8_act_as(keeper);
  assert (public.app_stock_day('maarif', '2026-11-20') -> 'items') @> jsonb_build_array(jsonb_build_object('item_id', item,
           'movements', jsonb_build_object('receipt', jsonb_build_object('num', '10', 'den', '1')))), 'the stock page shows the receipt of 10';
  -- Nothing is outstanding: more is refused, or needs an explicit, audited over-receipt.
  perform public.phase8_expect('CT801', format($q$select public.phase8_po('receive', '{"order":"%s","local":"2026-11-20T16:00","lines":[{"line":"%s","quantity":"1"}]}', '2026-11-20T16:10')$q$, ord, l1));
  perform public.phase8_expect('CT801', format($q$select public.phase8_po('receive', '{"order":"%s","local":"2026-11-20T16:00","lines":[{"line":"%s","quantity":"11"}]}', '2026-11-20T16:10')$q$, ord, l2));
  r := public.phase8_po('receive', jsonb_build_object('order', ord, 'local', '2026-11-20T16:00',
         'lines', jsonb_build_array(jsonb_build_object('line', l1, 'quantity', '1', 'over_receipt_reason', 'P8 one extra delivered'))), '2026-11-20T16:10');
  perform public.phase8_act_as(null);
  assert (select over_receipt_reason from public.purchase_order_receipt_lines rl join public.purchase_order_receipts rc on rc.id = rl.receipt_id
          where rc.id = (r ->> 'receipt')::uuid) = 'P8 one extra delivered'
     and exists (select 1 from public.audit_log where action = 'purchase_order.receive' and target_id = ord
                 and changes::text like '%P8 one extra delivered%'), 'the over-receipt keeps its reason and is audited';
  perform public.phase8_act_as(keeper);
  -- A receipt time in the future or before the order is refused; so is a line of another order.
  perform public.phase8_expect('22023', format($q$select public.phase8_po('receive', '{"order":"%s","local":"2026-11-21T09:00","lines":[{"line":"%s","quantity":"1"}]}', '2026-11-20T16:10')$q$, ord, l2));
  perform public.phase8_expect('22023', format($q$select public.phase8_po('receive', '{"order":"%s","local":"2026-11-18T21:00","lines":[{"line":"%s","quantity":"1"}]}', '2026-11-20T16:10')$q$, ord, l2));
  perform public.phase8_expect('22023', format($q$select public.phase8_po('receive', '{"order":"%s","local":"2026-11-20T16:00","lines":[{"line":"%s","quantity":"1"}]}', '2026-11-20T16:10')$q$, ord, public.phase8_get('o2')));
  perform public.phase8_expect('22023', format($q$select public.phase8_po('receive', '{"order":"%s","local":"2026-11-20T16:00","lines":[{"line":"%s","quantity":"،"}]}', '2026-11-20T16:10')$q$, ord, l2));

  -- Line 2: 4 received, the unreceived 6 cancelled. The line closes; no stock, the history stays.
  perform public.phase8_po('receive', jsonb_build_object('order', ord, 'local', '2026-11-20T17:00',
    'lines', jsonb_build_array(jsonb_build_object('line', l2, 'quantity', '4'))), '2026-11-20T17:05');
  perform public.phase8_act_as(admin);
  perform public.phase8_expect('22023', format($q$select public.phase8_po('cancel_rest', '{"line":"%s"}', '2026-11-20T18:00')$q$, l2));
  r := public.phase8_po('cancel_rest', jsonb_build_object('line', l2, 'reason', 'P8 supplier short'), '2026-11-20T18:00');
  assert public.phase8_q(r -> 'cancelled') = '6/1';
  perform public.phase8_expect('CT803', format($q$select public.phase8_po('cancel_rest', '{"line":"%s","reason":"again"}', '2026-11-20T18:05')$q$, l2));
  perform public.phase8_act_as(null);
  assert public.phase8_book(item, '2026-11-20')::numeric = 15, 'cancelling created no stock (10 + 1 + 4)';
  assert public.phase8_q(app_private.rat_json(app_private.po_line_outstanding(l2::uuid))) = '0/1'
     and (select count(*) from public.purchase_order_receipt_lines where line_id = l2::uuid) = 1
     and exists (select 1 from public.audit_log where action = 'purchase_order.cancel_rest' and changes ->> 'reason' = 'P8 supplier short'),
    'the line is closed; its receipt and the audited cancellation are kept';
  perform public.phase8_act_as(keeper);
  perform public.phase8_expect('CT801', format($q$select public.phase8_po('receive', '{"order":"%s","local":"2026-11-20T19:00","lines":[{"line":"%s","quantity":"1"}]}', '2026-11-20T19:05')$q$, ord, l2));
  -- Both lines closed: the expected date of a closed order cannot change.
  perform public.phase8_expect('CT803', format($q$select public.phase8_po('set_expected', '{"order":"%s","date":"2026-11-22","reason":"x"}', '2026-11-20T19:05')$q$, ord));
  assert (select (x ->> 'open_lines')::int = 0 and x -> 'receipt_dates' = '["2026-11-20"]'::jsonb
          from jsonb_array_elements(public.app_purchase_orders('maarif') -> 'orders') x where x ->> 'id' = ord), 'the order list shows it closed';
  -- A Phase 6 reversal cannot undo a purchase-order receipt behind the order's back.
  perform public.phase8_act_as(admin);
  perform public.phase8_expect('22023', format($q$select public.app_stock_command('maarif', '2026-11-20', 'reverse', gen_random_uuid(), '{"posting":"%s","reason":"x"}')$q$,
    (select r2.posting_id from public.purchase_order_receipts r2 where r2.order_id = ord::uuid order by r2.received_at limit 1)));
end $$;
reset role;

-- ------------------------------------------------------------------ 11. legacy order sheet (P1-35), synthetic values
do $$
declare
  admin constant uuid := 'a8000000-0000-4000-8000-000000000001';
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  e text := public.phase8_get('e');
  r jsonb;
  before_plan jsonb;
begin
  perform public.phase8_act_as(keeper);
  before_plan := public.phase8_plan(e, '2026-11-18T20:30');
  perform public.phase8_act_as(admin);
  perform public.phase8_expect('22023', format($q$select public.phase8_po('import_legacy', %L::jsonb, '2026-11-18T20:00')$q$,
    jsonb_build_object('expected_date', '2026-11-20', 'source_value', '20\11/2026',
      'lines', jsonb_build_array(jsonb_build_object('item', e, 'quantity', '،', 'source', 'factory')))));
  r := public.phase8_po('import_legacy', jsonb_build_object('expected_date', '2026-11-20', 'source_value', '20\11/2026',
         'lines', jsonb_build_array(jsonb_build_object('item', e, 'quantity', '30', 'source', 'factory'))), '2026-11-18T20:00');
  perform public.phase8_act_as(null);
  assert (select origin = 'legacy' and status = 'historical' and business_date is null and created_at is null and created_local is null
          and source_file = 'SRC-01' and source_cell = 'Sheet1!C6' from public.purchase_orders where id = (r ->> 'order')::uuid),
    'a legacy order: no creation date when the source has none';
  assert (select expected_date = '2026-11-20' and kind = 'legacy' and source_value = '20\11/2026' and revision = 1
          from public.purchase_order_expected_dates where order_id = (r ->> 'order')::uuid), 'C6 is the expected receipt date; the original value is kept';
  assert not exists (select 1 from public.purchase_order_receipts where order_id = (r ->> 'order')::uuid), 'no receipt derived from it';
  perform public.phase8_act_as(admin);
  perform public.phase8_expect('CT803', format($q$select public.phase8_po('approve', '{"order":"%s"}', '2026-11-18T20:10')$q$, r ->> 'order'));
  perform public.phase8_expect('CT803', format($q$select public.phase8_po('receive', '{"order":"%s","local":"2026-11-20T09:00","lines":[{"line":"%s","quantity":"1"}]}', '2026-11-20T10:00')$q$,
    r ->> 'order', (select id from public.purchase_order_lines where order_id = (r ->> 'order')::uuid)));
  perform public.phase8_act_as(keeper);
  assert public.phase8_plan(e, '2026-11-18T20:30') -> 'incoming' = before_plan -> 'incoming', 'a historical order is not confirmed incoming';
end $$;

-- ------------------------------------------------------------------ 12. retries and reused request identifiers
do $$
declare
  keeper constant uuid := 'a8000000-0000-4000-8000-000000000002';
  creator constant uuid := 'a8000000-0000-4000-8000-000000000005';
  req uuid := gen_random_uuid();
  pay jsonb := jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', public.phase8_get('e'), 'quantity', '2', 'source', 'store')));
  r1 jsonb; r2 jsonb;
begin
  perform public.phase8_act_as(keeper);
  r1 := public.phase8_po('create', pay, '2026-11-18T23:00', req);
  r2 := public.phase8_po('create', pay, '2026-11-18T23:01', req);
  assert (r2 ->> 'replayed')::boolean and r2 ->> 'order' = r1 ->> 'order', 'a retried create returns the first order';
  perform public.phase8_expect('23505', format($q$select public.phase8_po('create', %L::jsonb, '2026-11-18T23:02', %L)$q$,
    jsonb_set(pay, '{lines,0,quantity}', '"3"'), req));
  perform public.phase8_act_as(creator);
  perform public.phase8_expect('23505', format($q$select public.phase8_po('create', %L::jsonb, '2026-11-18T23:02', %L)$q$, pay, req));
  perform public.phase8_act_as(null);
  assert (select count(*) from public.purchase_orders where request_id = req) = 1
     and (select count(*) from public.audit_log where action = 'purchase_order.create' and target_id = r1 ->> 'order') = 1,
    'one order and one audit row per request';
  assert (select count(*) from public.audit_log where action = 'purchase_order.approve') >= 5
     and exists (select 1 from public.audit_log where action = 'purchase_order.approve' and actor_name = 'P8 admin'), 'approvals are audited';
end $$;

-- ------------------------------------------------------------------ 13. append-only history and the database constraints (table owner)
do $$
declare
  ord uuid := public.phase8_get('ord')::uuid;
  l1 uuid := public.phase8_get('l1')::uuid;
  l2 uuid := public.phase8_get('l2')::uuid;
  item uuid := public.phase8_get('r')::uuid;
  rc public.purchase_order_receipts%rowtype;
  mv public.stock_movements%rowtype;
  posting uuid;
  got text;
begin
  perform public.phase8_expect('42501', format('update public.purchase_order_lines set quantity_text = %L where id = %L', '11', l1));
  perform public.phase8_expect('42501', format('delete from public.purchase_order_lines where id = %L', l1));
  perform public.phase8_expect('42501', format('update public.purchase_order_receipt_lines set quantity_text = %L where line_id = %L', '5', l1));
  perform public.phase8_expect('42501', format('delete from public.purchase_order_receipts where order_id = %L', ord));
  perform public.phase8_expect('42501', format('update public.purchase_order_expected_dates set expected_date = %L where order_id = %L', '2026-12-01', ord));
  perform public.phase8_expect('42501', format('delete from public.purchase_order_cancellations where line_id = %L', l2));
  perform public.phase8_expect('42501', format('update public.purchase_order_events set reason = %L where order_id = %L', 'x', ord));
  perform public.phase8_expect('42501', format('update public.purchase_orders set status = %L where id = %L', 'proposed', ord));
  perform public.phase8_expect('42501', format('update public.purchase_orders set note = %L where id = %L', 'x', ord));
  perform public.phase8_expect('42501', format('delete from public.purchase_orders where id = %L', ord));
  perform public.phase8_expect('42501', 'truncate public.purchase_order_receipt_lines cascade');
  perform public.phase8_expect('42501', 'truncate public.purchase_orders cascade');

  -- The receipt of line 1 (4 units) and its movement.
  select r.* into rc from public.purchase_order_receipts r join public.purchase_order_receipt_lines x on x.receipt_id = r.id
    where x.line_id = l1 order by r.received_at limit 1;
  select m.* into mv from public.stock_movements m join public.purchase_order_receipt_lines x on x.movement_id = m.id
    where x.receipt_id = rc.id;
  -- A second receipt line on the SAME movement (line 2 is the same item, quantity and unit, and an
  -- over-receipt reason is given, so only the one-movement constraint stands in the way).
  perform public.phase8_expect('23505', format($q$insert into public.purchase_order_receipt_lines (receipt_id, line_id, quantity_text, quantity_num,
    quantity_den, movement_id, over_receipt_reason) values (%L, %L, '4', 4, 1, %L, 'P8 test')$q$, rc.id, l2, mv.id));

  -- Over-receipt guard: line 2 is closed; a direct receipt line for 3 more without a reason is refused.
  insert into public.stock_movements (organization_id, branch_id, business_date, posting_id, item_id, kind, direction, quantity_num, quantity_den,
    base_unit, occurred_local, occurred_at, source)
  values (mv.organization_id, mv.branch_id, mv.business_date, rc.posting_id, item, 'receipt', 1, 3, 1, mv.base_unit, mv.occurred_local, mv.occurred_at,
    'purchase_order') returning * into mv;
  perform public.phase8_expect('CT801', format($q$insert into public.purchase_order_receipt_lines (receipt_id, line_id, quantity_text, quantity_num,
    quantity_den, movement_id) values (%L, %L, '3', 3, 1, %L)$q$, rc.id, l2, mv.id));

  -- Stock never comes from an order alone: that movement has no receipt line, so the deferred check refuses it.
  begin
    set constraints stock_movements_purchase_order_receipt immediate;
    raise exception 'the movement without a receipt line was accepted';
  exception when others then
    get stacked diagnostics got = returned_sqlstate;
    assert got = '23514', format('expected 23514 for a purchase-order movement without a receipt line, got %s (%s)', got, sqlerrm);
  end;
end $$;
-- The orphaned movement above is never committed: the whole file rolls back.

-- ------------------------------------------------------------------ 14. every receipt line points at its own receipt movement
do $$
begin
  assert (select count(*) from public.stock_movements m where m.source = 'purchase_order'
          and not exists (select 1 from public.purchase_order_receipt_lines x where x.movement_id = m.id)) <= 1,
    'only the deliberately orphaned test movement lacks a receipt line';
  assert not exists (select 1 from public.purchase_order_receipt_lines x join public.stock_movements m on m.id = x.movement_id
                     where m.kind <> 'receipt' or m.source <> 'purchase_order'), 'receipt lines point at receipt movements only';
end $$;

select 'phase8 database checks passed';
rollback;
