-- Phase 6 acceptance cases: Product Mix reconciliation, typed movements, consumption through approved
-- recipes, physical counts and variance. Synthetic items only; every change rolls back.
-- Expected quantities are worked out by hand in the comments.
begin;

create function public.phase6_act_as(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then reset role; return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
grant execute on function public.phase6_act_as(uuid) to authenticated;

create function public.phase6_expect(p_state text, p_sql text) returns void language plpgsql as $$
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
grant execute on function public.phase6_expect(text, text) to authenticated;

create function public.phase6_put(k text, v text) returns void language sql as $$ select set_config('phase6.' || k, v, true); $$;
create function public.phase6_get(k text) returns text language sql as $$ select current_setting('phase6.' || k); $$;
grant execute on function public.phase6_put(text, text), public.phase6_get(text) to authenticated;

-- Item figure from a stock_day result, as "num/den".
create function public.phase6_fig(day jsonb, item text, field text) returns text language sql immutable as $$
  select (x -> field ->> 'num') || '/' || (x -> field ->> 'den') from jsonb_array_elements(day -> 'items') x where x ->> 'item_id' = item;
$$;
create function public.phase6_row(day jsonb, item text) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(day -> 'items') x where x ->> 'item_id' = item;
$$;
grant execute on function public.phase6_fig(jsonb, text, text), public.phase6_row(jsonb, text) to authenticated;

insert into auth.users(id, email) values
  ('a6000000-0000-4000-8000-000000000001', 'admin@phase6.test'),
  ('a6000000-0000-4000-8000-000000000002', 'storekeeper@phase6.test'),
  ('a6000000-0000-4000-8000-000000000003', 'manager@phase6.test'),
  ('a6000000-0000-4000-8000-000000000004', 'cashier@phase6.test');
insert into public.employees(id, organization_id, full_name)
  select u.id, b.organization_id, split_part(u.email, '@', 1) from auth.users u cross join public.branches b
  where b.code = 'maarif' and u.email like '%@phase6.test';
insert into public.staff_accounts(user_id, employee_id, organization_id, email)
  select u.id, u.id, e.organization_id, u.email from auth.users u join public.employees e on e.id = u.id where u.email like '%@phase6.test';
insert into public.branch_memberships(staff_id, branch_id)
  select u.id, b.id from auth.users u cross join public.branches b
  where b.code = 'maarif' and u.email in ('storekeeper@phase6.test', 'manager@phase6.test', 'cashier@phase6.test');
insert into public.staff_group_assignments(staff_id, branch_id, group_key)
  select u.id, m.branch_id, split_part(u.email, '@', 1) from auth.users u join public.branch_memberships m on m.staff_id = u.id
  where u.email like '%@phase6.test';
insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('a6000000-0000-4000-8000-000000000001', null, 'system_admin');

-- ------------------------------------------------------------------ 1. structure, grants and permissions
do $$
declare
  t text;
begin
  foreach t in array array['stock_postings', 'stock_movements', 'stock_consumption_lines', 'stock_consumption_reversals', 'stock_counts',
                           'stock_count_voids', 'stock_adjustments', 'product_mix_reports', 'product_mix_sections', 'product_mix_lines'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ' has row-level security';
    assert not has_table_privilege('authenticated', 'public.' || t, 'insert,update,delete,truncate')
       and not has_table_privilege('anon', 'public.' || t, 'select')
       and not has_table_privilege('service_role', 'public.' || t, 'insert,update,delete'), t || ' is read-only to the API roles';
  end loop;
  assert not has_function_privilege('anon', 'public.app_stock_command(text,date,text,uuid,jsonb)', 'execute');
  assert exists (select 1 from public.group_permissions where group_key = 'storekeeper' and permission_key = 'inventory.consume')
     and exists (select 1 from public.group_permissions where group_key = 'manager' and permission_key = 'inventory.consume')
     and exists (select 1 from public.group_permissions where group_key = 'system_admin' and permission_key = 'inventory.consume')
     and not exists (select 1 from public.group_permissions where group_key = 'cashier' and permission_key like 'inventory.%'),
    'inventory.consume is held by storekeeper, manager and admin only';
end $$;

-- ------------------------------------------------------------------ 2. synthetic catalog (admin, through Phase 5 commands)
do $$
declare
  admin constant uuid := 'a6000000-0000-4000-8000-000000000001';
  x uuid; y uuid; box uuid; s1 uuid; a1 uuid; v1 uuid; va uuid;
begin
  perform public.phase6_act_as(admin);
  x   := public.app_catalog_save_item(null, 'ingredient', 'P6 مكون عد', null, null, null, 'pc', null, null, null, false, null);
  y   := public.app_catalog_save_item(null, 'ingredient', 'P6 مكون وزن', null, null, null, 'kg', null, null, null, false, null);
  box := public.app_catalog_save_item(null, 'packaging',  'P6 علبة', null, null, null, 'pc', null, null, null, false, null);
  s1  := public.app_catalog_save_item(null, 'sold', 'P6 كيكة', null, null, null, null, null, null, null, false, null);
  a1  := public.app_catalog_save_item(null, 'sold', 'P6 إضافة صوص', null, null, null, null, null, null, null, true, null);
  perform public.app_catalog_map_name('foodics', 'P6 كيكة', s1, 'approve', 'phase 6 check');
  perform public.app_catalog_map_name('foodics', 'P6 إضافة صوص', a1, 'approve', 'phase 6 check');
  v1 := public.app_catalog_create_recipe(s1, 'P6 v1', null, null);
  perform public.app_catalog_save_recipe_line(v1, null, x, '2', 'pc', null, 1);      -- 2 pieces of X per cake
  perform public.app_catalog_save_recipe_line(v1, null, box, '1', 'pc', null, 2);    -- one box per cake
  perform public.app_catalog_approve_recipe(v1, '2026-11-01', null, 3);
  va := public.app_catalog_create_recipe(a1, 'P6 add-on v1', null, null);
  perform public.app_catalog_save_recipe_line(va, null, y, '1/20', 'kg', null, 1);  -- 50 g of Y per add-on
  perform public.app_catalog_approve_recipe(va, '2026-11-01', null, 2);
  perform public.phase6_put('x', x::text); perform public.phase6_put('y', y::text); perform public.phase6_put('box', box::text);
  perform public.phase6_put('s1', s1::text); perform public.phase6_put('a1', a1::text); perform public.phase6_put('v1', v1::text);
end $$;

-- ------------------------------------------------------------------ 3. opening, receipts, Product Mix, consumption, count
do $$
declare
  keeper constant uuid := 'a6000000-0000-4000-8000-000000000002';
  manager constant uuid := 'a6000000-0000-4000-8000-000000000003';
  cashier constant uuid := 'a6000000-0000-4000-8000-000000000004';
  d1 constant date := '2026-11-10';
  x text := public.phase6_get('x'); y text := public.phase6_get('y'); box text := public.phase6_get('box');
  receipt_req uuid := gen_random_uuid();
  post_req uuid := gen_random_uuid();
  r jsonb; r2 jsonb; day jsonb; v int;
begin
  -- Permissions: the cashier sees and writes nothing; the storekeeper cannot set opening stock.
  perform public.phase6_act_as(cashier);
  perform public.phase6_expect('42501', format($q$select public.app_stock_day('maarif', %L)$q$, d1));
  perform public.phase6_expect('42501', format($q$select public.app_stock_command('maarif', %L, 'movement', gen_random_uuid(),
    '{"kind":"waste","item":"%s","quantity":"1","local":"2026-11-10T09:00"}')$q$, d1, x));
  perform public.phase6_act_as(keeper);
  perform public.phase6_expect('42501', format($q$select public.app_stock_command('maarif', %L, 'opening', gen_random_uuid(),
    '{"item":"%s","quantity":"10","local":"2026-11-10T08:00"}')$q$, d1, x));

  -- Opening stock (manager): 10 pieces of X; 1 kg of Y entered as 1000 g.
  perform public.phase6_act_as(manager);
  perform public.app_stock_command('maarif', d1, 'opening', gen_random_uuid(), jsonb_build_object('item', x, 'quantity', '10', 'local', '2026-11-10T08:00'));
  perform public.app_stock_command('maarif', d1, 'opening', gen_random_uuid(), jsonb_build_object('item', y, 'quantity', '1000', 'unit', 'g', 'local', '2026-11-10T08:00'));
  perform public.phase6_expect('22023', format($q$select public.app_stock_command('maarif', %L, 'opening', gen_random_uuid(),
    '{"item":"%s","quantity":"3","local":"2026-11-10T08:05"}')$q$, d1, x));

  -- Receipt of 5 on the actual receipt day; a retry of the same request adds nothing.
  perform public.phase6_act_as(keeper);
  r := public.app_stock_command('maarif', d1, 'movement', receipt_req, jsonb_build_object('kind', 'receipt', 'item', x, 'quantity', '5', 'local', '2026-11-10T10:00', 'reference', 'DN-1'));
  r2 := public.app_stock_command('maarif', d1, 'movement', receipt_req, jsonb_build_object('kind', 'receipt', 'item', x, 'quantity', '5', 'local', '2026-11-10T10:00', 'reference', 'DN-1'));
  assert r2 ->> 'posting' = r ->> 'posting' and (r2 ->> 'replayed')::boolean, 'a retried receipt returns the first posting';
  assert (select count(*) from public.stock_movements where kind = 'receipt' and item_id = x::uuid) = 1, 'retrying the receipt creates one movement';
  perform public.phase6_expect('23505', format($q$select public.app_stock_command('maarif', %L, 'movement', %L,
    '{"kind":"receipt","item":"%s","quantity":"6","local":"2026-11-10T10:00"}')$q$, d1, receipt_req, x));
  -- A receipt is recorded on the day it arrives: the next morning belongs to the next business day.
  perform public.phase6_expect('22023', format($q$select public.app_stock_command('maarif', %L, 'movement', gen_random_uuid(),
    '{"kind":"receipt","item":"%s","quantity":"1","local":"2026-11-11T09:00"}')$q$, d1, x));
  perform public.phase6_expect('22023', format($q$select public.app_stock_command('maarif', %L, 'movement', gen_random_uuid(),
    '{"kind":"receipt","item":"%s","quantity":"0","local":"2026-11-10T10:00"}')$q$, d1, x));

  -- Product Mix: two sections, the same day's net sales 35.00 MAD.
  --   Section 1 «P6 الكيك», total 25.00: P6 كيكة × 2 = 20.00; the real Dubai cake (draft recipe) × 1 = 5.00
  --   Section 2 «P6 الإضافات», total 10.00: P6 إضافة صوص × 2 = 6.00; an unmapped name × 1 = 4.00
  r := public.app_stock_command('maarif', d1, 'mix_save', gen_random_uuid(), '{"net_sales":"3500","local":"2026-11-10T23:00"}');
  v := (r ->> 'version')::int;
  r := public.app_stock_command('maarif', d1, 'mix_section', gen_random_uuid(), jsonb_build_object('label', 'P6 الكيك', 'total', '2500', 'version', v)); v := (r ->> 'version')::int;
  r := public.app_stock_command('maarif', d1, 'mix_section', gen_random_uuid(), jsonb_build_object('label', 'P6 الإضافات', 'total', '1000', 'version', v)); v := (r ->> 'version')::int;
  r := public.app_stock_command('maarif', d1, 'mix_line', gen_random_uuid(), jsonb_build_object('section_no', 1, 'label', 'P6 كيكة', 'quantity', '2', 'amount', '2000', 'version', v)); v := (r ->> 'version')::int;
  -- An overlapping photo portion cannot add the same name to the section twice.
  perform public.phase6_expect('23505', format($q$select public.app_stock_command('maarif', %L, 'mix_line', gen_random_uuid(),
    '{"section_no":1,"label":"P6  كيكة","quantity":"2","amount":"2000","version":%s}')$q$, d1, v));
  r := public.app_stock_command('maarif', d1, 'mix_line', gen_random_uuid(), jsonb_build_object('section_no', 1, 'label', 'كيكة الهبة دبي شيكولاتة كبيرة', 'quantity', '1', 'amount', '500', 'version', v)); v := (r ->> 'version')::int;
  r := public.app_stock_command('maarif', d1, 'mix_line', gen_random_uuid(), jsonb_build_object('section_no', 2, 'label', 'P6 إضافة صوص', 'quantity', '2', 'amount', '600', 'version', v)); v := (r ->> 'version')::int;
  -- Stale edits are refused.
  perform public.phase6_expect('40001', format($q$select public.app_stock_command('maarif', %L, 'mix_line', gen_random_uuid(),
    '{"section_no":2,"label":"x","quantity":"1","amount":"1","version":%s}')$q$, d1, v - 1));
  -- Not reconciled yet: section 2 lines add up to 6.00, its printed total is 10.00.
  perform public.phase6_expect('CT005', format($q$select public.app_stock_command('maarif', %L, 'mix_lock', gen_random_uuid(), '{"version":%s}')$q$, d1, v));
  perform public.phase6_expect('22023', format($q$select public.app_stock_command('maarif', %L, 'post_consumption', gen_random_uuid(), '{}')$q$, d1));
  r := public.app_stock_command('maarif', d1, 'mix_line', gen_random_uuid(), jsonb_build_object('section_no', 2, 'label', 'P6 اسم غير معروف', 'quantity', '1', 'amount', '400', 'version', v)); v := (r ->> 'version')::int;
  r := public.app_product_mix('maarif', d1);
  assert (r #>> '{reconciliation,ok}')::boolean and (r #>> '{reconciliation,sections_total}')::bigint = 3500
     and (r #>> '{reconciliation,lines_total}')::bigint = 3500, 'section totals reconcile to net sales without counting a total as a line';
  r := public.app_stock_command('maarif', d1, 'mix_lock', gen_random_uuid(), jsonb_build_object('version', v)); v := (r ->> 'version')::int;
  perform public.phase6_expect('22023', format($q$select public.app_stock_command('maarif', %L, 'mix_line', gen_random_uuid(),
    '{"section_no":2,"label":"y","quantity":"1","amount":"1","version":%s}')$q$, d1, v));

  -- Post: the cake and the add-on post; the unmapped name and the draft-recipe Dubai cake stay blocked.
  r := public.app_stock_command('maarif', d1, 'post_consumption', post_req, '{}');
  assert (r ->> 'posted_lines')::int = 2 and (r ->> 'blocked_lines')::int = 2, 'posted/blocked ' || (r ->> 'posted_lines') || '/' || (r ->> 'blocked_lines');
  assert (r ->> 'movements')::int = 3, 'X, box and Y each move once';
  r2 := public.app_stock_command('maarif', d1, 'post_consumption', post_req, '{}');
  assert (r2 ->> 'replayed')::boolean and r2 ->> 'posting' = r ->> 'posting' and (r2 ->> 'movements')::int = 3, 'retried post returns the first posting';
  perform public.phase6_expect('CT006', format($q$select public.app_stock_command('maarif', %L, 'post_consumption', gen_random_uuid(), '{}')$q$, d1));
  assert (select count(*) from public.stock_movements where kind = 'consumption') = 3, 'no duplicate consumption after the retry and the second request';
  r := public.app_product_mix('maarif', d1);
  assert (select count(*) from jsonb_array_elements(r -> 'sections') s, jsonb_array_elements(s -> 'lines') l where l -> 'posted' <> 'null'::jsonb) = 2;
  assert (select l #>> '{check,reasons,0,code}' from jsonb_array_elements(r -> 'sections') s, jsonb_array_elements(s -> 'lines') l
          where l ->> 'label' = 'P6 اسم غير معروف') = 'unmapped_name', 'the unmapped line says why it is blocked';
  assert (select l #>> '{check,reasons,0,code}' from jsonb_array_elements(r -> 'sections') s, jsonb_array_elements(s -> 'lines') l
          where l ->> 'label' = 'كيكة الهبة دبي شيكولاتة كبيرة') = 'recipe_not_approved', 'real consumption stays blocked until Abdo approves its recipe';

  -- The posting keeps the approved recipe version, each recipe line and the exact quantities.
  assert (select bool_and(m.recipe_version_id = public.phase6_get('v1')::uuid and m.recipe_line_id is not null)
          from public.stock_movements m join public.catalog_items i on i.id = m.item_id where m.kind = 'consumption' and i.name_ar in ('P6 مكون عد', 'P6 علبة'));
  assert (select m.quantity_num || '/' || m.quantity_den || ' ' || m.recipe_quantity_num || '/' || m.recipe_quantity_den
          from public.stock_movements m where m.kind = 'consumption' and m.item_id = x::uuid) = '4/1 2/1', 'X: 2 cakes × 2 = 4';
  assert (select m.quantity_num || '/' || m.quantity_den from public.stock_movements m where m.kind = 'consumption' and m.item_id = y::uuid) = '1/10',
    'Y: 2 add-ons × 1/20 kg = 1/10 kg';
  assert (select m.quantity_num || '/' || m.quantity_den from public.stock_movements m where m.kind = 'consumption' and m.item_id = box::uuid) = '2/1',
    'packaging: 2 boxes';

  -- Count X: 10 at 23:30. Expected 10 + 5 - 4 = 11; variance 10 - 11 = -1.
  r := public.app_stock_command('maarif', d1, 'count', gen_random_uuid(), jsonb_build_object('item', x, 'quantity', '10', 'local', '2026-11-10T23:30'));
  perform public.phase6_put('count_x', r ->> 'count');
  day := public.app_stock_day('maarif', d1);
  assert public.phase6_fig(day, x, 'opening') = '0/1' and public.phase6_fig(day, x, 'expected') = '11/1', 'expected 11';
  assert public.phase6_fig(day, x, 'expected_at_count') = '11/1' and public.phase6_fig(day, x, 'variance') = '-1/1', 'variance -1';
  assert public.phase6_row(day, x) ->> 'status' = 'counted' and public.phase6_row(day, x) ->> 'schedule' = 'daily';
  -- Y has no count: incomplete, no variance. Expected 1 - 1/10 = 9/10 kg.
  assert public.phase6_fig(day, y, 'expected') = '9/10' and public.phase6_row(day, y) -> 'variance' = 'null'::jsonb
     and public.phase6_row(day, y) ->> 'status' = 'missing', 'a blank count is incomplete';
  -- Packaging is counted monthly: not due on 10 November.
  assert public.phase6_row(day, box) ->> 'schedule' = 'monthly' and public.phase6_row(day, box) ->> 'status' = 'not_due';
  assert public.phase6_fig(day, box, 'expected') = '-2/1';
  -- An explicit zero count of Y participates: 0 - 9/10 = -9/10.
  perform public.app_stock_command('maarif', d1, 'count', gen_random_uuid(), jsonb_build_object('item', y, 'quantity', '0', 'local', '2026-11-10T23:35'));
  day := public.app_stock_day('maarif', d1);
  assert public.phase6_fig(day, y, 'variance') = '-9/10' and public.phase6_row(day, y) #>> '{count,quantity,num}' = '0', 'explicit zero is compared';
  -- A blank count is refused rather than stored as zero.
  perform public.phase6_expect('22023', format($q$select public.app_stock_command('maarif', %L, 'count', gen_random_uuid(),
    '{"item":"%s","quantity":"","local":"2026-11-10T23:40"}')$q$, d1, box));
  perform public.phase6_put('post1', (select id::text from public.stock_postings where request_id = post_req));
end $$;

-- ------------------------------------------------------------------ 4. a later recipe version keeps the posted day
do $$
declare
  admin constant uuid := 'a6000000-0000-4000-8000-000000000001';
  keeper constant uuid := 'a6000000-0000-4000-8000-000000000002';
  x text := public.phase6_get('x'); v1 uuid := public.phase6_get('v1')::uuid; s1 uuid := public.phase6_get('s1')::uuid;
  v2 uuid; l uuid; before jsonb; after jsonb; st text;
begin
  perform public.phase6_act_as(keeper);
  before := public.app_stock_day('maarif', '2026-11-10');
  perform public.phase6_act_as(admin);
  v2 := public.app_catalog_create_recipe(s1, 'P6 v2', v1, null);
  select id into l from public.recipe_lines where version_id = v2 and line_no = 1;
  perform public.app_catalog_save_recipe_line(v2, l, x::uuid, '3', 'pc', null, 1);
  -- Starting v2 on the posted day would end v1 before 10 November: refused.
  begin
    perform public.app_catalog_approve_recipe(v2, '2026-11-10', null, 2);
    raise exception 'a recipe range closed over posted consumption';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    assert st = 'CT004', 'expected CT004, got ' || st;
  end;
  perform public.app_catalog_approve_recipe(v2, '2026-11-11', null, 2);
  assert (select effective_to from public.recipe_versions where id = v1) = date '2026-11-10';
  perform public.phase6_act_as(keeper);
  after := public.app_stock_day('maarif', '2026-11-10');
  assert before -> 'items' = after -> 'items', 'the posted day is unchanged by the later version';
  assert (select recipe_quantity_num from public.stock_movements where kind = 'consumption' and item_id = x::uuid) = 2,
    'the posting keeps the quantity of the version it used';
  perform public.phase6_put('v2', v2::text);
end $$;

-- ------------------------------------------------------------------ 5. blocked lines post later; counts, adjustments, reversals
do $$
declare
  admin constant uuid := 'a6000000-0000-4000-8000-000000000001';
  keeper constant uuid := 'a6000000-0000-4000-8000-000000000002';
  manager constant uuid := 'a6000000-0000-4000-8000-000000000003';
  d1 constant date := '2026-11-10'; d2 constant date := '2026-11-11';
  x text := public.phase6_get('x'); y text := public.phase6_get('y');
  r jsonb; day jsonb; adj uuid; rec uuid; as_of timestamptz; post2 uuid; c uuid;
begin
  -- Once the name is approved, a new post consumes only that line: 1 × 1/20 kg of Y.
  perform public.phase6_act_as(admin);
  perform public.app_catalog_map_name('foodics', 'P6 اسم غير معروف', public.phase6_get('a1')::uuid, 'approve', 'phase 6 check');
  perform public.phase6_act_as(keeper);
  r := public.app_stock_command('maarif', d1, 'post_consumption', gen_random_uuid(), '{}');
  assert (r ->> 'posted_lines')::int = 1 and (r ->> 'blocked_lines')::int = 1, 'only the newly mapped line posts';
  post2 := (r ->> 'posting')::uuid;
  day := public.app_stock_day('maarif', d1);
  assert public.phase6_fig(day, y, 'expected') = '17/20', 'Y: 1 - 1/10 - 1/20 = 17/20';
  assert (select count(*) from public.stock_consumption_lines) = 3;

  -- Replacing a count needs a reason and keeps the first observation.
  perform public.phase6_expect('22023', format($q$select public.app_stock_command('maarif', %L, 'count', gen_random_uuid(),
    '{"item":"%s","quantity":"9","local":"2026-11-10T23:45","replaces":"%s"}')$q$, d1, x, public.phase6_get('count_x')));
  r := public.app_stock_command('maarif', d1, 'count', gen_random_uuid(), jsonb_build_object('item', x, 'quantity', '9', 'local', '2026-11-10T23:45',
    'replaces', public.phase6_get('count_x'), 'reason', 'typing error'));
  c := (r ->> 'count')::uuid;
  day := public.app_stock_day('maarif', d1);
  assert public.phase6_fig(day, x, 'variance') = '-2/1', 'replaced count: 9 - 11 = -2';
  assert (select count(*) from public.stock_counts where item_id = x::uuid) = 2, 'both observations are kept';
  -- Voiding the active count makes the day incomplete again.
  r := public.app_stock_command('maarif', d1, 'void_count', gen_random_uuid(), jsonb_build_object('count', c, 'reason', 'counted the wrong shelf'));
  day := public.app_stock_day('maarif', d1);
  assert public.phase6_row(day, x) ->> 'status' = 'missing' and public.phase6_row(day, x) -> 'variance' = 'null'::jsonb;
  r := public.app_stock_command('maarif', d1, 'count', gen_random_uuid(), jsonb_build_object('item', x, 'quantity', '10', 'local', '2026-11-10T23:50'));
  c := (r ->> 'count')::uuid;

  -- An adjustment is separate from the count: proposing changes nothing; approving books -1 after the count.
  r := public.app_stock_command('maarif', d1, 'propose_adjustment', gen_random_uuid(), jsonb_build_object('item', x, 'quantity', '1', 'direction', '-1',
    'local', '2026-11-10T23:55', 'count', c, 'reason', 'missing piece found at count'));
  adj := (r ->> 'adjustment')::uuid;
  perform public.phase6_expect('42501', format($q$select public.app_stock_command('maarif', %L, 'decide_adjustment', gen_random_uuid(),
    '{"adjustment":"%s","decision":"approve"}')$q$, d1, adj));
  day := public.app_stock_day('maarif', d1);
  assert public.phase6_fig(day, x, 'expected') = '11/1', 'a proposed adjustment does not move stock';
  perform public.phase6_act_as(manager);
  perform public.app_stock_command('maarif', d1, 'decide_adjustment', gen_random_uuid(), jsonb_build_object('adjustment', adj, 'decision', 'approve', 'reason', 'agreed'));
  perform public.phase6_expect('22023', format($q$select public.app_stock_command('maarif', %L, 'decide_adjustment', gen_random_uuid(),
    '{"adjustment":"%s","decision":"reject"}')$q$, d1, adj));
  day := public.app_stock_day('maarif', d1);
  assert public.phase6_fig(day, x, 'expected') = '10/1' and public.phase6_fig(day, x, 'variance') = '-1/1'
     and public.phase6_fig(day, x, 'expected_at_count') = '11/1', 'the count observation and its variance are preserved; the book is adjusted';

  -- Day 2 opens at the adjusted book. A receipt and its reversal; a second reversal is refused.
  perform public.phase6_act_as(keeper);
  r := public.app_stock_command('maarif', d2, 'movement', gen_random_uuid(), jsonb_build_object('kind', 'receipt', 'item', x, 'quantity', '3', 'local', '2026-11-11T09:00'));
  rec := (r ->> 'posting')::uuid;
  as_of := clock_timestamp();
  perform public.phase6_expect('22023', format($q$select public.app_stock_command('maarif', %L, 'reverse', gen_random_uuid(),
    '{"posting":"%s"}')$q$, d2, rec));
  r := public.app_stock_command('maarif', d2, 'reverse', gen_random_uuid(), jsonb_build_object('posting', rec, 'reason', 'delivery returned unopened'));
  perform public.phase6_expect('23505', format($q$select public.app_stock_command('maarif', %L, 'reverse', gen_random_uuid(),
    '{"posting":"%s","reason":"again"}')$q$, d2, rec));
  day := public.app_stock_day('maarif', d2);
  assert public.phase6_fig(day, x, 'opening') = '10/1' and public.phase6_fig(day, x, 'expected') = '10/1', 'reversed receipt';
  day := public.app_stock_day('maarif', d2, as_of);
  assert public.phase6_fig(day, x, 'expected') = '13/1', 'figures as of an earlier instant are reproducible';

  -- Reversing a consumption posting returns its lines to pending; posting again is attempt 2 through the same version.
  r := public.app_stock_command('maarif', d1, 'reverse', gen_random_uuid(), jsonb_build_object('posting', post2, 'reason', 'wrong quantity'));
  day := public.app_stock_day('maarif', d1);
  assert public.phase6_fig(day, y, 'expected') = '9/10';
  r := public.app_stock_command('maarif', d1, 'post_consumption', gen_random_uuid(), '{}');
  assert (r ->> 'posted_lines')::int = 1 and (select max(attempt) from public.stock_consumption_lines) = 2;
  day := public.app_stock_day('maarif', d1);
  assert public.phase6_fig(day, y, 'expected') = '17/20';
  -- Unlocking is refused once anything was posted from the Product Mix.
  perform public.phase6_expect('42501', format($q$select public.app_stock_command('maarif', %L, 'mix_unlock', gen_random_uuid(), '{"version":%s}')$q$,
    d1, (select version from public.product_mix_reports)));

  -- History of a figure: type, source, unit, actor, reversal.
  r := public.app_stock_item_history('maarif', x::uuid, d1, d2);
  assert jsonb_array_length(r -> 'movements') = 6 and jsonb_array_length(r -> 'counts') = 3, 'movements/counts ' || jsonb_array_length(r -> 'movements') || '/' || jsonb_array_length(r -> 'counts');
  assert (select count(*) from jsonb_array_elements(r -> 'movements') m where (m ->> 'reversed')::boolean) = 1
     and (select count(*) from jsonb_array_elements(r -> 'movements') m where m ->> 'actor' is null) = 0;
end $$;

-- ------------------------------------------------------------------ 5b. the Product Mix agrees with the daily close
do $$
declare
  keeper constant uuid := 'a6000000-0000-4000-8000-000000000002';
  cashier constant uuid := 'a6000000-0000-4000-8000-000000000004';
  d3 constant date := '2026-11-12';
  r jsonb; v int;
begin
  -- The cashier's draft close for 12 November says net sales 50.00 MAD.
  perform public.phase6_act_as(cashier);
  perform public.app_operating_command('maarif', d3, 'save', 0, gen_random_uuid(),
    '{"sales":5000,"posCash":5000,"card":0,"openingCash":0,"openingCustody":0}');
  -- The Product Mix entered for the same day adds up to 30.00 MAD only.
  perform public.phase6_act_as(keeper);
  r := public.app_stock_command('maarif', d3, 'mix_save', gen_random_uuid(), '{"net_sales":"3000","local":"2026-11-12T23:00"}'); v := (r ->> 'version')::int;
  r := public.app_stock_command('maarif', d3, 'mix_section', gen_random_uuid(), jsonb_build_object('label', 'P6 الكيك', 'total', '3000', 'version', v)); v := (r ->> 'version')::int;
  r := public.app_stock_command('maarif', d3, 'mix_line', gen_random_uuid(), jsonb_build_object('section_no', 1, 'label', 'P6 كيكة', 'quantity', '3', 'amount', '3000', 'version', v)); v := (r ->> 'version')::int;
  r := public.app_product_mix('maarif', d3);
  assert not (r #>> '{reconciliation,ok}')::boolean
     and r #>> '{reconciliation,problems,0,code}' = 'close_sales_mismatch' and (r #>> '{reconciliation,close_sales}')::int = 5000,
    'a Product Mix that disagrees with the daily close does not reconcile';
  perform public.phase6_expect('CT005', format($q$select public.app_stock_command('maarif', %L, 'mix_lock', gen_random_uuid(), '{"version":%s}')$q$, d3, v));
end $$;

-- ------------------------------------------------------------------ 6. append-only, audit, Phase 5 still holds
do $$
begin
  perform public.phase6_act_as(null);
  perform public.phase6_expect('42501', 'update public.stock_movements set quantity_num = 7');
  perform public.phase6_expect('42501', 'delete from public.stock_counts');
  perform public.phase6_expect('42501', 'delete from public.stock_postings');
  perform public.phase6_expect('42501', 'update public.product_mix_lines set amount = 1');
  assert (select count(*) from public.audit_log where action like 'stock.%') = (select count(*) from public.stock_postings),
    'one audit row per accepted stock request';
  assert (select count(*) from public.recipe_versions where status = 'approved' and label not like 'P6%') = 0,
    'no loaded recipe was approved';
end $$;

rollback;
select 'phase6 database checks passed';

