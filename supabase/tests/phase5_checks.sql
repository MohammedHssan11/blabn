-- Phase 5 acceptance cases for the catalog, units, Foodics mappings and recipes. All changes roll back,
-- including the synthetic staff, the audit rows and every catalog record the cases create.
-- Expected quantities are worked out by hand in the comments, independently of the functions under test.
begin;

create function public.phase5_act_as(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then
    reset role;
    return;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
grant execute on function public.phase5_act_as(uuid) to authenticated, anon;

-- Runs one statement as the current role and requires it to fail with exactly this SQLSTATE.
create function public.phase5_expect(p_state text, p_sql text) returns void language plpgsql as $$
declare
  got text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics got = returned_sqlstate;
    if got <> p_state then
      raise exception 'expected SQLSTATE % but got % (%) for: %', p_state, got, sqlerrm, left(p_sql, 220);
    end if;
    return;
  end;
  raise exception 'expected SQLSTATE % but the statement succeeded: %', p_state, left(p_sql, 220);
end;
$$;
grant execute on function public.phase5_expect(text, text) to authenticated, anon;

create function public.phase5_put(p_key text, p_id uuid) returns uuid language sql as $$
  select p_id from (select set_config('phase5.' || p_key, p_id::text, true)) s;
$$;
create function public.phase5_get(p_key text) returns uuid language sql as $$
  select current_setting('phase5.' || p_key)::uuid;
$$;
grant execute on function public.phase5_put(text, uuid), public.phase5_get(text) to authenticated;

create function public.phase5_factor(p_item uuid, p_unit text) returns jsonb language sql security definer set search_path = '' as $$
  select app_private.catalog_unit_factor(p_item, p_unit);
$$;
grant execute on function public.phase5_factor(uuid, text) to authenticated;

-- The same result with the recipe range removed: closing an open range later is the only allowed change to an approved version.
create function public.phase5_basis(p jsonb) returns jsonb language sql immutable as $$
  select jsonb_set(p, '{lines,0,recipe}', (p #> '{lines,0,recipe}') - 'effective_to');
$$;
grant execute on function public.phase5_basis(jsonb) to authenticated;

insert into auth.users(id, email) values
  ('a5000000-0000-4000-8000-000000000001', 'admin@phase5.test'),
  ('a5000000-0000-4000-8000-000000000002', 'storekeeper@phase5.test'),
  ('a5000000-0000-4000-8000-000000000003', 'cashier@phase5.test'),
  ('a5000000-0000-4000-8000-000000000004', 'outsider@phase5.test');

insert into public.employees(id, organization_id, full_name)
select u.id, b.organization_id, split_part(u.email, '@', 1)
from auth.users u cross join public.branches b
where b.code = 'maarif' and u.email like '%@phase5.test';

insert into public.staff_accounts(user_id, employee_id, organization_id, email)
select u.id, u.id, e.organization_id, u.email from auth.users u join public.employees e on e.id = u.id
where u.email like '%@phase5.test';

insert into public.branch_memberships(staff_id, branch_id)
select u.id, b.id from auth.users u cross join public.branches b
where b.code = 'maarif' and u.email in ('storekeeper@phase5.test', 'cashier@phase5.test');

insert into public.staff_group_assignments(staff_id, branch_id, group_key)
select u.id, b.branch_id, split_part(u.email, '@', 1)
from auth.users u join public.branch_memberships b on b.staff_id = u.id where u.email like '%@phase5.test';
insert into public.staff_group_assignments(staff_id, branch_id, group_key)
values ('a5000000-0000-4000-8000-000000000001', null, 'system_admin');

-- ------------------------------------------------------------------ 1. structure, grants and read access
do $$
declare
  admin constant uuid := 'a5000000-0000-4000-8000-000000000001';
  keeper constant uuid := 'a5000000-0000-4000-8000-000000000002';
  cashier constant uuid := 'a5000000-0000-4000-8000-000000000003';
  outsider constant uuid := 'a5000000-0000-4000-8000-000000000004';
  t text;
  items_total bigint := (select count(*) from public.catalog_items);
  versions_total bigint := (select count(*) from public.recipe_versions);
begin
  assert items_total = 556, 'the load holds 556 catalog items, found ' || items_total;
  foreach t in array array['catalog_units', 'catalog_items', 'catalog_item_conversions', 'catalog_source_labels',
    'catalog_review_items', 'catalog_date_decisions', 'recipe_versions', 'recipe_lines'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ' has row-level security';
    assert not has_table_privilege('authenticated', 'public.' || t, 'insert,update,delete,truncate')
       and not has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete')
       and not has_table_privilege('service_role', 'public.' || t, 'insert,update,delete'), t || ' is read-only to the API roles';
  end loop;
  assert not has_function_privilege('anon', 'public.app_catalog_save_item(uuid,text,text,text,text,text,text,text,text,text,boolean,integer)', 'execute')
     and not has_function_privilege('anon', 'public.app_catalog_consumption(text,date,jsonb)', 'execute'),
    'anonymous callers cannot run catalog commands';

  perform public.phase5_act_as(admin);
  assert (select count(*) from public.catalog_items) = items_total, 'the administrator reads the catalog';
  assert (select count(*) from public.catalog_review_items) > 150, 'the administrator reads the review queue';
  assert (select count(*) from public.catalog_date_decisions) = 1;

  perform public.phase5_act_as(keeper);
  assert (select count(*) from public.catalog_items) = items_total, 'a storekeeper holds inventory.view and reads items';
  assert (select count(*) from public.recipe_versions) = versions_total;
  assert (select count(*) from public.catalog_source_labels) = 0 and (select count(*) from public.catalog_review_items) = 0
     and (select count(*) from public.catalog_date_decisions) = 0, 'mappings, review queue and date question need recipes.manage';
  perform public.phase5_expect('42501', $q$select public.app_catalog_save_item(null, 'ingredient', 'x', null, null, null, 'kg', null, null, null, false, null)$q$);
  perform public.phase5_expect('42501', $q$insert into public.catalog_items(organization_id, kind, name_ar) select organization_id, 'ingredient', 'x' from public.branches limit 1$q$);
  perform public.phase5_expect('42501', $q$update public.recipe_versions set label = 'x'$q$);
  perform public.phase5_expect('42501', $q$select public.app_catalog_queue_names('["x"]')$q$);
  assert jsonb_typeof(public.app_catalog_consumption('maarif', '2026-11-02', '[]')) = 'object', 'a storekeeper may run the eligibility check';

  perform public.phase5_act_as(cashier);
  assert (select count(*) from public.catalog_items) = 0 and (select count(*) from public.recipe_lines) = 0
     and (select count(*) from public.catalog_units) = 8, 'a cashier reads no catalog data (units are reference data)';
  perform public.phase5_expect('42501', $q$select public.app_catalog_consumption('maarif', date '2026-11-02', '[]')$q$);
  perform public.phase5_expect('42501', $q$select public.app_catalog_approve_recipe(gen_random_uuid(), date '2026-11-01', null, 1)$q$);

  perform public.phase5_act_as(outsider);
  assert (select count(*) from public.catalog_items) = 0;
  perform public.phase5_expect('42501', $q$select public.app_catalog_consumption('maarif', date '2026-11-02', '[]')$q$);
  perform public.phase5_expect('42501', $q$select public.app_catalog_save_conversion(gen_random_uuid(), 'carton', '2', 'x')$q$);

  perform public.phase5_act_as(null);
end;
$$;

-- ------------------------------------------------------------------ 2. what Abdo confirmed, as loaded
do $$
declare
  cake uuid;
  kinder uuid;
  kinder_item uuid;
  bz uuid;
  v_oct uuid;
  v_nov uuid;
  n bigint;
begin
  -- P1-28: the Foodics large and the workbook small Dubai chocolate cake are one product; both labels are kept.
  select item_id into cake from public.catalog_source_labels
  where source_system = 'foodics' and status = 'approved' and label = 'كيكة الهبة دبي شيكولاتة كبيرة';
  assert cake is not null, 'the Foodics label of the confirmed cake alias is approved';
  assert (select item_id from public.catalog_source_labels where source_system = 'foodics' and status = 'approved'
          and label = 'كيكة الهبة دبي شيكولاتة كبير') = cake, 'the label as read from the 7 November photo maps to the same item';
  assert (select count(*) from public.catalog_source_labels where item_id = cake and source_system = 'inventory_workbook'
          and label = 'كيكة هبة دبى شيكولاتة صغيرة' and source_ref like '%D325') = 1, 'the workbook label is kept on the same item';
  assert (select count(*) from public.catalog_source_labels where item_id = cake and source_system = 'decision_record'
          and label = 'كيكة الهبة دبي شيكولاتة صغيرة') = 1;
  assert (select basis from public.catalog_source_labels where item_id = cake and label = 'كيكة الهبة دبي شيكولاتة كبيرة') like '%P1-28%';
  assert (select count(*) from public.catalog_source_labels where source_system = 'foodics' and status = 'approved') = 2,
    'only the confirmed cake alias is approved; every other Foodics name waits for review';
  select id, item_id into strict kinder, kinder_item from public.catalog_source_labels
  where source_system = 'foodics' and label = 'كيكة الهبة دبي صوص كيندر كبير';
  assert (select status from public.catalog_source_labels where id = kinder) = 'pending', 'the Kinder cake line stays unconfirmed';
  assert kinder_item is not null and kinder_item <> cake, 'the Kinder cake is not the chocolate cake';
  assert (select count(*) from public.catalog_review_items where kind = 'unconfirmed_mapping' and status = 'open'
          and refs::text like '%كيندر%') = 1, 'the Kinder mapping waits in the review queue with both source rows';
  assert (select count(*) from public.catalog_review_items where kind = 'unconfirmed_mapping' and status = 'resolved'
          and resolution like '%P1-28%') = 1;

  -- P1-31: mixed nuts «عدد» rows are kilograms; the numbers are unchanged and the original label is kept.
  select count(*) into n from public.recipe_lines l join public.catalog_items c on c.id = l.component_id
  where c.name_ar = 'مكسرات مشكلة' and l.source_unit_label = 'عدد';
  assert n = 10, 'ten mixed-nut rows were written «عدد», found ' || n;
  assert not exists (select 1 from public.recipe_lines l join public.catalog_items c on c.id = l.component_id
    where c.name_ar = 'مكسرات مشكلة' and l.source_unit_label = 'عدد' and (l.unit_code <> 'kg' or l.unit_resolution <> 'abdo_p1_31'));
  assert (select base_unit from public.catalog_items where name_ar = 'مكسرات مشكلة') = 'kg';
  assert (select count(*) from public.recipe_lines l join public.catalog_items c on c.id = l.component_id
          where c.name_ar = 'مكسرات مشكلة' and l.source_unit_label = 'عدد' and l.source_label = 'طبق السعادة'
            and (l.quantity_num, l.quantity_den) = (3, 50)) = 1, 'طبق السعادة keeps 0.06 (3/50) as entered';
  assert (select count(*) from public.recipe_lines l join public.catalog_items c on c.id = l.component_id
          where c.name_ar = 'مكسرات مشكلة' and l.source_unit_label = 'عدد'
            and (app_private.catalog_unit_factor(l.component_id, l.unit_code)) = '{"num":"1","den":"1"}'::jsonb) = 10,
    'the ten rows convert as kilograms';
  assert not exists (select 1 from public.catalog_review_items where kind = 'unit_conflict' and status = 'open'
          and subject = 'مكسرات مشكلة'), 'no open mixed-nut unit conflict remains';
  assert (select count(*) from public.catalog_review_items where kind = 'unit_conflict' and status = 'resolved'
          and subject = 'مكسرات مشكلة' and jsonb_array_length(refs) = 20 and resolution like '%P1-31%') = 1,
    'the ten rows of each workbook travel with the resolution';
  -- the other conflicting units stay in review, with the exact rows
  assert (select count(*) from public.catalog_review_items where kind = 'unit_conflict' and status = 'open') = 18;
  assert exists (select 1 from public.catalog_review_items where kind = 'unit_conflict' and status = 'open'
    and subject = 'ملاعق بلاستيك للارز - مستورد' and refs @> '[{"unit_label":"كيلو"}]'), 'the spoon unit conflict names its rows';
  -- every line whose unit cannot be converted belongs to a component that is in the review queue
  assert not exists (
    select 1 from public.recipe_lines l
    where l.component_id is not null and (app_private.catalog_unit_factor(l.component_id, l.unit_code)) ? 'error'
      and not exists (select 1 from public.catalog_review_items r where r.status = 'open' and r.item_id = l.component_id
                      and r.kind in ('unit_conflict', 'missing_unit', 'missing_quantity'))),
    'no unit defect is silent';

  -- P1-32: six spoons in the November large Bazabizo Mango; October keeps its own version.
  select id into strict bz from public.catalog_items where kind = 'sold' and name_ar = 'بظابيظو مانجو كبير';
  select id into strict v_oct from public.recipe_versions where product_id = bz and label = 'October workbook';
  select id into strict v_nov from public.recipe_versions where product_id = bz and label = 'November workbook';
  assert (select count(*) from public.recipe_versions where id in (v_oct, v_nov) and status = 'draft') = 2, 'both versions are drafts';
  assert (select (l.quantity_num, l.quantity_den, l.unit_code, l.source_unit_label) = (6, 1, 'pc', 'عدد')
          from public.recipe_lines l join public.catalog_items c on c.id = l.component_id
          where l.version_id = v_nov and c.name_ar = 'ملاعق بلاستيك للارز - مستورد'
            and l.source_ref = 'SRC-07 ''2''!D1015:G1015'), 'six spoons, cited to SRC-07 sheet 2 D1015:G1015';
  assert not exists (select 1 from public.recipe_lines l join public.catalog_items c on c.id = l.component_id
          where l.version_id = v_oct and c.name_ar like 'ملاعق%'), 'the October recipe has no spoon line';
  assert (select count(*) from public.recipe_lines where version_id = v_oct) = 4 and (select count(*) from public.recipe_lines where version_id = v_nov) = 5;
  assert (select decision_role from public.recipe_versions where id = v_nov) = 'starts_on'
     and (select decision_role from public.recipe_versions where id = v_oct) = 'ends_before';
  assert (select count(*) from public.recipe_versions where date_decision_id is not null) = 11,
    'the 11 versions that differ between the workbooks wait for the date';
  assert (select answered_date from public.catalog_date_decisions) is null, 'the November date is unanswered';
  assert (select count(*) from public.recipe_versions where status <> 'draft') = 0, 'nothing is approved by the load';
  assert (select count(*) from public.catalog_review_items where kind = 'recipe_effective_date' and status = 'open'
          and subject = 'نسخة وصفات نوفمبر بدأ العمل بيها من يوم كام؟') = 1;
  assert (select count(*) from public.catalog_items where name_en is null and kind = 'sold') > 250, 'English names are not invented';
end;
$$;

-- ------------------------------------------------------------------ 3. exact numbers
do $$
declare
  r app_private.rat;
begin
  assert app_private.rat_text(app_private.parse_rational('1/30')) = '0.033333333';
  assert not app_private.rat_exact(app_private.parse_rational('1/30')) and app_private.rat_exact(app_private.parse_rational('0.025'));
  r := app_private.parse_rational('0.025');
  assert (r.n, r.d) = (1, 40), 'a decimal is kept as an exact fraction';
  r := app_private.rat_add(app_private.parse_rational('0.1'), app_private.parse_rational('0.2'));
  assert (r.n, r.d) = (3, 10), '0.1 + 0.2 is exactly 0.3';
  assert app_private.parse_rational('0') is null and app_private.parse_rational('-1') is null
     and app_private.parse_rational('abc') is null and app_private.parse_rational('1/0') is null and app_private.parse_rational('') is null;
  assert app_private.catalog_label_key('كَيكة  الهبة ١') = 'كيكه الهبه 1'
     and app_private.catalog_label_key('أيس كريم') = app_private.catalog_label_key('ايس كريم');
end;
$$;

-- ------------------------------------------------------------------ 4. the known product: units, mapping, recipe, quantities
do $$
declare
  admin constant uuid := 'a5000000-0000-4000-8000-000000000001';
  keeper constant uuid := 'a5000000-0000-4000-8000-000000000002';
  flour uuid; butter uuid; jelly uuid; box uuid; spoons uuid; product uuid; product2 uuid;
  v1 uuid; l1 uuid;
  r jsonb;
begin
  perform public.phase5_act_as(admin);
  flour := public.phase5_put('flour', public.app_catalog_save_item(null, 'ingredient', 'اختبار دقيق', 'Test flour', 'T-FLOUR', 'اختبار', 'kg', null, null, null, false, null));
  butter := public.phase5_put('butter', public.app_catalog_save_item(null, 'ingredient', 'اختبار زبدة', null, null, 'اختبار', 'kg', null, null, null, false, null));
  jelly := public.phase5_put('jelly', public.app_catalog_save_item(null, 'ingredient', 'اختبار جيلى', null, null, 'اختبار', 'kg', null, null, null, false, null));
  box := public.phase5_put('box', public.app_catalog_save_item(null, 'packaging', 'اختبار علبة', 'Test box', null, 'اختبار', 'pc', null, null, null, false, null));
  spoons := public.phase5_put('spoons', public.app_catalog_save_item(null, 'packaging', 'اختبار معلقة', null, null, 'اختبار', 'pc', null, null, null, false, null));
  product := public.phase5_put('product', public.app_catalog_save_item(null, 'sold', 'اختبار كعكة', 'Test cake', null, 'اختبار', null, null, null, null, false, null));
  product2 := public.phase5_put('product2', public.app_catalog_save_item(null, 'sold', 'اختبار كعكة ثانية', null, null, 'اختبار', null, null, null, null, false, null));
  assert (select base_unit from public.catalog_items where id = product) = 'pc' and (select stock_tracked from public.catalog_items where id = product) = false;

  -- A purchase unit needs its conversion first; same-kind units convert without one.
  perform public.phase5_expect('CT003', format($q$select public.app_catalog_save_item(%L, 'packaging', 'اختبار معلقة', null, null, 'اختبار', 'pc', null, 'carton', null, false, 1)$q$, spoons));
  assert (select purchase_unit from public.catalog_items where id = spoons) is null, 'a purchase unit without a conversion is refused';
  perform public.phase5_expect('22023', format($q$select public.app_catalog_save_conversion(%L, 'g', '1/1000', 'same kind')$q$, flour));
  perform public.phase5_expect('22023', format($q$select public.app_catalog_save_conversion(%L, 'carton', '0', 'zero')$q$, spoons));
  perform public.phase5_expect('22023', format($q$select public.app_catalog_save_conversion(%L, 'carton', '100', '')$q$, spoons));
  perform public.app_catalog_save_conversion(spoons, 'carton', '100', 'Carton of 100 spoons (test)');
  perform public.app_catalog_save_item(spoons, 'packaging', 'اختبار معلقة', null, null, 'اختبار', 'pc', null, 'carton', 'carton', false, 1);
  assert (select purchase_unit from public.catalog_items where id = spoons) = 'carton';
  assert public.phase5_factor(spoons, 'carton') = '{"num":"100","den":"1"}'::jsonb;
  assert public.phase5_factor(flour, 'g') = '{"num":"1","den":"1000"}'::jsonb, '1 g is 1/1000 kg';
  assert public.phase5_factor(flour, 'pc') = '{"error":"unit_incompatible"}'::jsonb, 'a count cannot become a mass without a conversion';
  assert public.phase5_factor(flour, null) = '{"error":"unit_missing"}'::jsonb;
  assert public.phase5_factor(flour, 'l') = '{"error":"unit_incompatible"}'::jsonb, 'volume is not mass';
  assert public.phase5_factor(flour, 'carton') = '{"error":"unit_incompatible"}'::jsonb, 'a pack needs its item conversion';
  perform public.phase5_expect('22023', format($q$select public.app_catalog_save_item(%L, 'packaging', 'اختبار معلقة', null, null, 'اختبار', 'kg', null, null, null, false, 2)$q$, spoons));
  perform public.phase5_expect('40001', format($q$select public.app_catalog_save_item(%L, 'ingredient', 'اختبار دقيق', null, null, null, 'kg', null, null, null, false, 99)$q$, flour));
  perform public.phase5_expect('23505', $q$select public.app_catalog_save_item(null, 'ingredient', 'اختبار  دقيق', null, null, null, 'kg', null, null, null, false, null)$q$);
  perform public.phase5_expect('23505', $q$select public.app_catalog_save_item(null, 'ingredient', 'اختبار ثاني', null, 'T-FLOUR', null, 'kg', null, null, null, false, null)$q$);

  -- Version 1 (draft). Per cake: 250 g and 0.05 kg flour, 0.1 kg butter, 1/30 kg jelly, 1 box, 2 spoons.
  v1 := public.phase5_put('v1', public.app_catalog_create_recipe(product, 'Test v1', null, 'known product'));
  perform public.app_catalog_save_recipe_line(v1, null, flour, '250', 'g', null, (select version from public.recipe_versions where id = v1));
  perform public.app_catalog_save_recipe_line(v1, null, flour, '0.05', 'kg', null, (select version from public.recipe_versions where id = v1));
  perform public.app_catalog_save_recipe_line(v1, null, butter, '0.1', 'kg', null, (select version from public.recipe_versions where id = v1));
  perform public.app_catalog_save_recipe_line(v1, null, jelly, '1/30', 'kg', null, (select version from public.recipe_versions where id = v1));
  perform public.app_catalog_save_recipe_line(v1, null, box, '1', 'pc', null, (select version from public.recipe_versions where id = v1));
  l1 := public.app_catalog_save_recipe_line(v1, null, spoons, '2', null, null, (select version from public.recipe_versions where id = v1));
  perform public.phase5_expect('40001', format($q$select public.app_catalog_save_recipe_line(%L, null, %L, '1', 'kg', null, 1)$q$, v1, butter));
  perform public.phase5_expect('22023', format($q$select public.app_catalog_save_recipe_line(%L, null, %L, '0', 'kg', null, %s)$q$, v1, butter, (select version from public.recipe_versions where id = v1)));
  perform public.phase5_expect('22023', format($q$select public.app_catalog_save_recipe_line(%L, null, %L, '1', 'furlong', null, %s)$q$, v1, butter, (select version from public.recipe_versions where id = v1)));
  assert (select count(*) from public.recipe_lines where version_id = v1) = 6;

  -- Mapping: unknown, queued (pending), approved. Only the approved name resolves.
  r := public.app_catalog_consumption('maarif', '2026-10-31', '[{"label":"TEST CAKE","quantity":"7"}]');
  assert r #>> '{lines,0,reasons,0,code}' = 'unmapped_name' and r #>> '{lines,0,status}' = 'blocked' and (r ->> 'blocked')::int = 1;
  assert public.app_catalog_queue_names('["TEST CAKE", " test  cake ", "Other name"]') = 2, 'a name is queued once, whatever its spacing or case';
  assert public.app_catalog_queue_names('["TEST CAKE"]') = 0, 'queueing again adds nothing';
  assert (select count(*) from public.catalog_review_items where kind = 'unmapped_name' and subject in ('TEST CAKE', 'Other name') and status = 'open') = 2;
  r := public.app_catalog_consumption('maarif', '2026-10-31', '[{"label":"TEST CAKE","quantity":"7"}]');
  assert r #>> '{lines,0,reasons,0,code}' = 'mapping_pending';
  perform public.app_catalog_map_name('foodics', 'TEST CAKE', product, 'approve', 'Test approval by the system administrator');
  assert (select status from public.catalog_review_items where dedupe_key = 'name:foodics:test cake') = 'resolved', 'approving closes the queue entry';
  perform public.phase5_expect('23505', format($q$select public.app_catalog_map_name('foodics', 'test  CAKE', %L, 'approve', 'second')$q$, product2));
  perform public.phase5_expect('23514', format($q$select public.app_catalog_map_name('foodics', 'Flour name', %L, 'approve', 'a Foodics name maps to a sold item')$q$, flour));
  perform public.phase5_expect('22023', format($q$select public.app_catalog_map_name('foodics', 'No basis', %L, 'approve', '')$q$, product));
  perform public.app_catalog_map_name('foodics', 'Other name', null, 'reject', 'Not a sold item');
  r := public.app_catalog_consumption('maarif', '2026-10-31', '[{"label":"Other name","quantity":1}]');
  assert r #>> '{lines,0,reasons,0,code}' = 'mapping_rejected';
  r := public.app_catalog_consumption('maarif', '2026-10-31', '[{"label":"TEST CAKE","quantity":7}]');
  assert r #>> '{lines,0,reasons,0,code}' = 'recipe_not_approved', 'a draft recipe never counts';

  -- Approval is refused for a line without a unit, and for a stale view of the recipe.
  perform public.phase5_expect('CT002', format($q$select public.app_catalog_approve_recipe(%L, date '2026-10-01', null, %s)$q$, v1, (select version from public.recipe_versions where id = v1)));
  perform public.app_catalog_save_recipe_line(v1, l1, spoons, '2', 'pc', null, (select version from public.recipe_versions where id = v1));
  perform public.phase5_expect('40001', format($q$select public.app_catalog_approve_recipe(%L, date '2026-10-01', null, 1)$q$, v1));
  assert (select status from public.recipe_versions where id = v1) = 'draft', 'a refused approval leaves the draft untouched';
  r := public.app_catalog_approve_recipe(v1, '2026-10-01', null, (select version from public.recipe_versions where id = v1));
  assert (r ->> 'lines')::int = 6 and (r ->> 'closed_previous')::int = 0 and (select status from public.recipe_versions where id = v1) = 'approved';

  -- Independent calculation for 7 cakes on 2026-10-31 (worked by hand):
  --   flour  7 x 0.25 kg + 7 x 0.05 kg = 1.75 + 0.35 = 2.1 kg  (21/10)
  --   butter 7 x 0.1 kg = 0.7 kg                                (7/10)
  --   jelly  7 x 1/30 kg = 7/30 kg = 0.233333333 (not exact)
  --   box    7 x 1 = 7 pc;  spoons 7 x 2 = 14 pc
  perform public.phase5_act_as(keeper);
  r := public.app_catalog_consumption('maarif', '2026-10-31', '[{"label":" TEST  cake","quantity":"7","ref":"row-1"}]');
  perform public.phase5_act_as(admin);
  assert r #>> '{lines,0,status}' = 'eligible' and (r ->> 'eligible')::int = 1 and (r ->> 'blocked')::int = 0, r::text;
  assert r #>> '{lines,0,ref}' = 'row-1' and r #>> '{lines,0,product,name_en}' = 'Test cake' and r #>> '{lines,0,recipe,version_no}' = '1';
  assert jsonb_array_length(r #> '{lines,0,components}') = 6 and jsonb_array_length(r -> 'totals') = 5;
  assert (select t #>> '{quantity,num}' || '/' || (t #>> '{quantity,den}') from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = flour::text) = '21/10';
  assert (select t #>> '{quantity,num}' || '/' || (t #>> '{quantity,den}') from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = butter::text) = '7/10';
  assert (select t -> 'quantity' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = jelly::text)
         = '{"num":"7","den":"30","decimal":"0.233333333","exact":false}'::jsonb, 'one thirtieth is never rounded to a stored value';
  assert (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = box::text) = '7'
     and (select t ->> 'kind' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = box::text) = 'packaging';
  assert (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = spoons::text) = '14';
  assert (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = flour::text) = '2.1'
     and (select (t #>> '{quantity,exact}')::boolean from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = flour::text);
  assert r #>> '{lines,0,components,0,recipe_unit}' = 'g' and r #>> '{lines,0,components,0,base_unit}' = 'kg',
    'the line keeps the unit it was written in and reports the base quantity';
  perform public.phase5_act_as(null);
end;
$$;

-- ------------------------------------------------------------------ 5. versions, dates and history
do $$
declare
  admin constant uuid := 'a5000000-0000-4000-8000-000000000001';
  product uuid := public.phase5_get('product');
  flour uuid := public.phase5_get('flour');
  v1 uuid := public.phase5_get('v1');
  v2 uuid; v3 uuid; v4 uuid;
  before_oct jsonb; before_nov4 jsonb; after_oct jsonb; after_nov4 jsonb; at_nov5 jsonb; r jsonb;
  req constant jsonb := '[{"label":"TEST CAKE","quantity":7}]';
  audit_before bigint;
begin
  perform public.phase5_act_as(admin);
  before_oct := public.app_catalog_consumption('maarif', '2026-10-31', req);
  before_nov4 := public.app_catalog_consumption('maarif', '2026-11-04', req);

  -- Version 2 raises the flour from 250 g to 300 g and starts on 2026-11-05.
  v2 := public.phase5_put('v2', public.app_catalog_create_recipe(product, 'Test v2', v1, 'more flour'));
  assert (select count(*) from public.recipe_lines where version_id = v2) = 6 and (select version_no from public.recipe_versions where id = v2) = 2;
  perform public.app_catalog_save_recipe_line(v2, (select id from public.recipe_lines where version_id = v2 and line_no = 1), flour, '300', 'g', null,
    (select version from public.recipe_versions where id = v2));
  audit_before := (select count(*) from public.audit_log where action = 'catalog.recipe_approved');
  r := public.app_catalog_approve_recipe(v2, '2026-11-05', null, (select version from public.recipe_versions where id = v2));
  assert (r ->> 'closed_previous')::int = 1, 'approving the later version ends the open earlier one';
  assert (select effective_to from public.recipe_versions where id = v1) = date '2026-11-04' and (select effective_to from public.recipe_versions where id = v2) is null;
  assert (select count(*) from public.audit_log where action = 'catalog.recipe_range_closed' and target_id = v1::text) = 1;
  assert (select count(*) from public.audit_log where action = 'catalog.recipe_approved') = audit_before + 1;

  -- The earlier date keeps its recipe basis and quantities exactly; the boundary day belongs to the new version.
  after_oct := public.app_catalog_consumption('maarif', '2026-10-31', req);
  after_nov4 := public.app_catalog_consumption('maarif', '2026-11-04', req);
  at_nov5 := public.app_catalog_consumption('maarif', '2026-11-05', req);
  assert public.phase5_basis(after_oct) = public.phase5_basis(before_oct) and public.phase5_basis(after_nov4) = public.phase5_basis(before_nov4),
    'a later recipe version leaves an earlier date untouched';
  assert after_oct #>> '{lines,0,recipe,id}' = v1::text and after_nov4 #>> '{lines,0,recipe,id}' = v1::text, 'the last day of version 1';
  assert at_nov5 #>> '{lines,0,recipe,id}' = v2::text, 'the first day of version 2';
  --   2026-11-05, 7 cakes: flour 7 x (0.30 + 0.05) = 2.45 kg (49/20); the others are unchanged.
  assert (select t #>> '{quantity,decimal}' from jsonb_array_elements(at_nov5 -> 'totals') t where t ->> 'item_id' = flour::text) = '2.45';
  assert (select t #>> '{quantity,decimal}' from jsonb_array_elements(after_oct -> 'totals') t where t ->> 'item_id' = flour::text) = '2.1';
  r := public.app_catalog_consumption('maarif', '2026-09-30', req);
  assert r #>> '{lines,0,reasons,0,code}' = 'no_recipe_for_date', 'the day before the first version has no recipe';

  -- Approved history cannot be altered, whoever tries.
  perform public.phase5_expect('42501', format($q$update public.recipe_lines set quantity_num = 1 where version_id = %L$q$, v1));
  perform public.phase5_act_as(null);
  perform public.phase5_expect('42501', format($q$update public.recipe_lines set quantity_num = 1, quantity_den = 1 where version_id = %L$q$, v1));
  perform public.phase5_expect('42501', format($q$delete from public.recipe_lines where version_id = %L$q$, v1));
  perform public.phase5_expect('42501', format($q$insert into public.recipe_lines(organization_id, version_id, line_no, component_id, quantity_num, quantity_den, unit_code)
    select organization_id, %L, 99, %L, 1, 1, 'kg' from public.recipe_versions where id = %L$q$, v1, flour, v1));
  perform public.phase5_expect('42501', format($q$update public.recipe_versions set label = 'changed' where id = %L$q$, v1));
  perform public.phase5_expect('42501', format($q$update public.recipe_versions set effective_to = date '2026-11-01' where id = %L$q$, v1));
  perform public.phase5_expect('42501', format($q$update public.recipe_versions set effective_from = date '2026-09-01' where id = %L$q$, v1));
  perform public.phase5_expect('42501', format($q$delete from public.recipe_versions where id = %L$q$, v1));
  perform public.phase5_act_as(admin);

  -- Overlaps are refused whatever their shape; no draft recipe may sit on a taken date.
  v3 := public.app_catalog_create_recipe(product, 'Test v3 overlap', v2, null);
  perform public.phase5_expect('23P01', format($q$select public.app_catalog_approve_recipe(%L, date '2026-10-15', date '2026-10-20', %s)$q$, v3, (select version from public.recipe_versions where id = v3)));
  perform public.phase5_expect('23P01', format($q$select public.app_catalog_approve_recipe(%L, date '2026-10-15', null, %s)$q$, v3, (select version from public.recipe_versions where id = v3)));
  perform public.phase5_expect('22023', format($q$select public.app_catalog_approve_recipe(%L, date '2026-12-01', date '2026-11-01', %s)$q$, v3, (select version from public.recipe_versions where id = v3)));
  assert (select status from public.recipe_versions where id = v3) = 'draft' and (select effective_to from public.recipe_versions where id = v2) is null,
    'a refused approval changes nothing, including the earlier version';

  -- Version 3 starts 2026-12-01, batch yield 2 (the lines describe two cakes): half per cake.
  perform public.app_catalog_set_recipe_meta(v3, 'Test v3', '2', 'yield confirmed', (select version from public.recipe_versions where id = v3));
  perform public.phase5_expect('22023', format($q$select public.app_catalog_set_recipe_meta(%L, 'x', 'abc', null, %s)$q$, v3, (select version from public.recipe_versions where id = v3)));
  perform public.app_catalog_approve_recipe(v3, '2026-12-01', null, (select version from public.recipe_versions where id = v3));
  assert (select effective_to from public.recipe_versions where id = v2) = date '2026-11-30';
  r := public.app_catalog_consumption('maarif', '2026-12-01', '[{"label":"TEST CAKE","quantity":4}]');
  --   4 cakes, yield 2: flour 4 x 0.35 / 2 = 0.7 kg; butter 4 x 0.1 / 2 = 0.2 kg; jelly 4/60 = 1/15 kg; box 2; spoons 4
  assert (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = flour::text) = '0.7'
     and (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = public.phase5_get('butter')::text) = '0.2'
     and (select t #>> '{quantity,num}' || '/' || (t #>> '{quantity,den}') from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = public.phase5_get('jelly')::text) = '1/15'
     and (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = public.phase5_get('box')::text) = '2'
     and (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = public.phase5_get('spoons')::text) = '4', r::text;
  assert public.phase5_basis(public.app_catalog_consumption('maarif', '2026-11-05', req)) = public.phase5_basis(at_nov5), 'adding version 3 left version 2 days untouched';
  assert public.phase5_basis(public.app_catalog_consumption('maarif', '2026-10-31', req)) = public.phase5_basis(before_oct), 'and version 1 days';
  perform public.phase5_expect('22023', format($q$select public.app_catalog_withdraw_recipe(%L, 'an approved version is kept')$q$, v3));
  perform public.phase5_act_as(null);
end;
$$;

-- ------------------------------------------------------------------ 6. one blocked line never stops the others
do $$
declare
  admin constant uuid := 'a5000000-0000-4000-8000-000000000001';
  flour uuid := public.phase5_get('flour');
  butter uuid := public.phase5_get('butter');
  box uuid := public.phase5_get('box');
  product uuid := public.phase5_get('product');
  product2 uuid := public.phase5_get('product2');
  product3 uuid; product4 uuid; v uuid; v4 uuid;
  r jsonb;
  lines jsonb;
  d constant date := '2026-11-10';
begin
  perform public.phase5_act_as(admin);
  product3 := public.app_catalog_save_item(null, 'sold', 'اختبار مسودة', null, null, 'اختبار', null, null, null, null, false, null);
  product4 := public.app_catalog_save_item(null, 'sold', 'اختبار بسيط', null, null, 'اختبار', null, null, null, null, false, null);
  perform public.app_catalog_map_name('foodics', 'NO RECIPE', product2, 'approve', 'test');
  perform public.app_catalog_map_name('foodics', 'DRAFT ONLY', product3, 'approve', 'test');
  perform public.app_catalog_map_name('foodics', 'SIMPLE', product4, 'approve', 'test');
  v := public.app_catalog_create_recipe(product3, 'Draft only', null, null);
  perform public.app_catalog_save_recipe_line(v, null, box, '1', 'pc', null, (select version from public.recipe_versions where id = v));

  -- A recipe whose unit needs a conversion that does not exist yet cannot be approved; once it exists it can.
  v4 := public.app_catalog_create_recipe(product4, 'Simple', null, null);
  perform public.app_catalog_save_recipe_line(v4, null, butter, '2', 'carton', null, (select version from public.recipe_versions where id = v4));
  perform public.app_catalog_save_recipe_line(v4, null, box, '1', 'pc', null, (select version from public.recipe_versions where id = v4));
  perform public.phase5_expect('CT003', format($q$select public.app_catalog_approve_recipe(%L, date '2026-01-01', null, %s)$q$, v4, (select version from public.recipe_versions where id = v4)));
  perform public.app_catalog_save_conversion(butter, 'carton', '5', 'Test carton holds 5 kg');
  perform public.app_catalog_approve_recipe(v4, '2026-01-01', null, (select version from public.recipe_versions where id = v4));
  perform public.phase5_expect('22023', format($q$select public.app_catalog_save_conversion(%L, 'carton', '6', 'changed after use')$q$, butter));
  perform public.phase5_expect('22023', format($q$select public.app_catalog_save_item(%L, 'ingredient', 'اختبار زبدة', null, null, 'اختبار', 'g', null, null, null, false, %s)$q$, butter, (select version from public.catalog_items where id = butter)));

  lines := jsonb_build_array(
    jsonb_build_object('ref', 'a', 'label', 'TEST CAKE', 'quantity', 3),
    jsonb_build_object('ref', 'b', 'label', 'UNKNOWN NAME', 'quantity', 5),
    jsonb_build_object('ref', 'c', 'label', 'NO RECIPE', 'quantity', 1),
    jsonb_build_object('ref', 'd', 'label', 'DRAFT ONLY', 'quantity', 1),
    jsonb_build_object('ref', 'e', 'label', 'TEST CAKE', 'quantity', 'abc'),
    jsonb_build_object('ref', 'f', 'label', 'test cake', 'quantity', 2),
    jsonb_build_object('ref', 'g', 'label', 'TEST CAKE', 'quantity', 0),
    jsonb_build_object('ref', 'h', 'product_id', product, 'quantity', '1'),
    jsonb_build_object('ref', 'i', 'label', 'SIMPLE', 'quantity', 3));
  r := public.app_catalog_consumption('maarif', d, lines);
  assert (r ->> 'eligible')::int = 4 and (r ->> 'blocked')::int = 5, r::text;
  assert (select array_agg(l ->> 'ref' order by (l ->> 'index')::int) from jsonb_array_elements(r -> 'lines') l) = array['a','b','c','d','e','f','g','h','i'], 'order is kept';
  assert (select array_agg(l ->> 'status' order by (l ->> 'index')::int) from jsonb_array_elements(r -> 'lines') l)
       = array['eligible','blocked','blocked','blocked','blocked','eligible','blocked','eligible','eligible'];
  assert (select array_agg(coalesce(l #>> '{reasons,0,code}', '-') order by (l ->> 'index')::int) from jsonb_array_elements(r -> 'lines') l)
       = array['-','unmapped_name','no_recipe','recipe_not_approved','invalid_quantity','-','invalid_quantity','-','-'], 'each blocked line names its reason';
  --   eligible cakes 3 + 2 + 1 = 6 at 0.35 kg flour each (version 2) = 2.1 kg; SIMPLE 3 x 2 cartons x 5 kg = 30 kg butter and 3 boxes
  assert (select t #>> '{quantity,num}' || '/' || (t #>> '{quantity,den}') from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = flour::text) = '21/10';
  assert (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = butter::text) = '30.6',
    'butter: 6 cakes x 0.1 kg + 30 kg through the carton conversion';
  assert (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'item_id' = box::text) = '9';
  assert not exists (select 1 from jsonb_array_elements(r -> 'lines') l where l ->> 'status' = 'blocked' and jsonb_array_length(l -> 'components') > 0),
    'a blocked line consumes nothing';

  r := public.app_catalog_consumption('maarif', d, jsonb_build_array(
    jsonb_build_object('product_id', repeat('-', 36), 'label', 'TEST CAKE', 'quantity', 2),
    jsonb_build_object('product_id', upper(product::text), 'quantity', 1)));
  assert r #>> '{lines,0,reasons,0,code}' = 'unknown_product'
     and r #>> '{lines,1,status}' = 'eligible', 'a malformed explicit ID blocks its own row without discarding valid rows';

  -- A unit that no longer converts blocks only the products that use it.
  perform public.phase5_act_as(null);
  update public.catalog_items set base_unit = 'l' where id = flour;
  update public.catalog_items set base_unit = null where id = butter;
  perform public.phase5_act_as(admin);
  r := public.app_catalog_consumption('maarif', d, lines);
  assert (select array_agg(l ->> 'status' order by (l ->> 'index')::int) from jsonb_array_elements(r -> 'lines') l)
       = array['blocked','blocked','blocked','blocked','blocked','blocked','blocked','blocked','blocked'], 'every product here reads a damaged unit';
  assert (select count(*) from jsonb_array_elements(r #> '{lines,0,reasons}') x where x ->> 'code' = 'unit_incompatible' and x ->> 'component_ar' = 'اختبار دقيق') = 2
     and (select count(*) from jsonb_array_elements(r #> '{lines,0,reasons}') x where x ->> 'code' = 'base_unit_missing' and x ->> 'component_ar' = 'اختبار زبدة') = 1
     and (r #>> '{lines,0,reasons,0,line_no}') = '1', 'the reasons name the component and the recipe line';
  perform public.phase5_act_as(null);
  update public.catalog_items set base_unit = 'kg' where id in (flour, butter);
  perform public.phase5_act_as(admin);
  assert (public.app_catalog_consumption('maarif', d, lines) ->> 'eligible')::int = 4, 'the units are readable again';
  perform public.phase5_act_as(null);
end;
$$;

-- ------------------------------------------------------------------ 7. discontinued records stay usable; stale edits are refused
do $$
declare
  admin constant uuid := 'a5000000-0000-4000-8000-000000000001';
  product uuid := public.phase5_get('product');
  butter uuid := public.phase5_get('butter');
  r jsonb;
begin
  perform public.phase5_act_as(admin);
  perform public.phase5_expect('40001', format($q$select public.app_catalog_set_item_status(%L, 'discontinued', date '2026-12-15', 99)$q$, product));
  perform public.phase5_expect('22023', format($q$select public.app_catalog_set_item_status(%L, 'discontinued', null, %s)$q$, product, (select version from public.catalog_items where id = product)));
  perform public.app_catalog_set_item_status(product, 'discontinued', '2026-12-15', (select version from public.catalog_items where id = product));
  perform public.app_catalog_set_item_status(butter, 'discontinued', '2026-11-01', (select version from public.catalog_items where id = butter));
  r := public.app_catalog_consumption('maarif', '2026-12-10', '[{"label":"TEST CAKE","quantity":1}]');
  assert r #>> '{lines,0,status}' = 'eligible' and jsonb_array_length(r #> '{lines,0,warnings}') = 0, 'before the end date: no warning';
  r := public.app_catalog_consumption('maarif', '2026-12-20', '[{"label":"TEST CAKE","quantity":1}]');
  assert r #>> '{lines,0,status}' = 'eligible' and r #>> '{lines,0,warnings,0,code}' = 'discontinued_before_date',
    'a sale after the end date is still consumed, with a warning';
  r := public.app_catalog_consumption('maarif', '2026-10-31', '[{"label":"TEST CAKE","quantity":1}]');
  assert r #>> '{lines,0,status}' = 'eligible' and (r #>> '{lines,0,product,id}') = product::text, 'history still resolves a discontinued item';
  assert (select status from public.catalog_items where id = butter) = 'discontinued';
  perform public.app_catalog_set_item_status(product, 'active', null, (select version from public.catalog_items where id = product));
  assert (select discontinued_on from public.catalog_items where id = product) is null;
  perform public.phase5_act_as(null);
end;
$$;

-- ------------------------------------------------------------------ 8. the confirmed cases against the real recipes, the date gate and the review queue
do $$
declare
  admin constant uuid := 'a5000000-0000-4000-8000-000000000001';
  keeper constant uuid := 'a5000000-0000-4000-8000-000000000002';
  bz uuid; v_oct uuid; v_nov uuid; cake uuid; bad uuid; blank uuid; review uuid;
  r jsonb;
  approved_before bigint;
begin
  perform public.phase5_act_as(admin);
  select id into strict bz from public.catalog_items where kind = 'sold' and name_ar = 'بظابيظو مانجو كبير';
  select id into strict v_oct from public.recipe_versions where product_id = bz and label = 'October workbook';
  select id into strict v_nov from public.recipe_versions where product_id = bz and label = 'November workbook';
  perform public.app_catalog_map_name('foodics', 'بظابيظو مانجو كبير', bz, 'approve', 'Test approval of a name that is not part of the confirmed set');

  -- Copies of unapproved workbook versions keep their evidence and the effective-date gate.
  declare
    copy_id uuid;
  begin
    copy_id := public.app_catalog_create_recipe(bz, 'Copy of unconfirmed November draft', v_nov, null);
    assert (select date_decision_id is not null and decision_role = 'starts_on' and sources <> '[]'::jsonb
            from public.recipe_versions where id = copy_id);
    perform public.phase5_expect('CT001',
      format($q$select public.app_catalog_approve_recipe(%L, date '2026-11-01', null, 1)$q$, copy_id));
  end;

  -- The effective date has not been confirmed: the affected versions stay drafts.
  perform public.phase5_expect('CT001', format($q$select public.app_catalog_approve_recipe(%L, date '2026-11-01', null, %s)$q$, v_nov, (select version from public.recipe_versions where id = v_nov)));
  perform public.phase5_expect('CT001', format($q$select public.app_catalog_approve_recipe(%L, date '2026-10-01', date '2026-10-31', %s)$q$, v_oct, (select version from public.recipe_versions where id = v_oct)));
  assert (select count(*) from public.recipe_versions where id in (v_oct, v_nov) and status = 'draft') = 2;
  select id into strict review from public.catalog_review_items where kind = 'recipe_effective_date';
  perform public.phase5_expect('22023', format($q$select public.app_catalog_resolve_review(%L, 'resolved', 'closing it by hand')$q$, review));
  perform public.phase5_act_as(keeper);
  perform public.phase5_expect('42501', $q$select public.app_catalog_answer_date_decision('nov-2026-recipe-set', date '2026-11-05', 'storekeeper')$q$);
  perform public.phase5_act_as(admin);
  perform public.phase5_expect('22023', $q$select public.app_catalog_answer_date_decision('nov-2026-recipe-set', date '2026-11-05', '')$q$);
  perform public.phase5_expect('22023', $q$select public.app_catalog_answer_date_decision('unknown-key', date '2026-11-05', 'x')$q$);

  -- A date that is chosen for the test only; the real answer is still Abdo's.
  perform public.app_catalog_answer_date_decision('nov-2026-recipe-set', '2026-11-05', 'Synthetic test answer');
  assert (select status from public.catalog_review_items where id = review) = 'resolved';
  perform public.phase5_expect('CT001', format($q$select public.app_catalog_approve_recipe(%L, date '2026-11-04', null, %s)$q$, v_nov, (select version from public.recipe_versions where id = v_nov)));
  perform public.phase5_expect('CT001', format($q$select public.app_catalog_approve_recipe(%L, date '2026-10-01', date '2026-11-03', %s)$q$, v_oct, (select version from public.recipe_versions where id = v_oct)));
  perform public.app_catalog_approve_recipe(v_oct, '2026-10-01', '2026-11-04', (select version from public.recipe_versions where id = v_oct));
  perform public.app_catalog_approve_recipe(v_nov, '2026-11-05', null, (select version from public.recipe_versions where id = v_nov));
  perform public.phase5_expect('22023', $q$select public.app_catalog_answer_date_decision('nov-2026-recipe-set', date '2026-11-06', 'changed after approval')$q$);

  -- Independent calculation for 3 large Bazabizo Mango, worked from the workbook lines (SRC-07 sheet 2 rows 1011-1015):
  --   gloss gel 0.25/1.25 x 0.6 = 0.12 kg each -> 0.36 kg (9/25); the finished piece 1 -> 3; mango pieces 0.6 kg -> 1.8 kg (9/5);
  --   the cut piece 1 -> 3; plastic spoons 6 -> 18.  October has no spoon line, so the same 3 on 4 November need 4 components.
  r := public.app_catalog_consumption('maarif', '2026-11-05', '[{"label":"بظابيظو مانجو كبير","quantity":3}]');
  assert r #>> '{lines,0,status}' = 'eligible' and jsonb_array_length(r -> 'totals') = 5, r::text;
  assert (select t #>> '{quantity,num}' || '/' || (t #>> '{quantity,den}') from jsonb_array_elements(r -> 'totals') t where t ->> 'name_ar' = 'جيلى تلميع شفاف') = '9/25';
  assert (select t #>> '{quantity,num}' || '/' || (t #>> '{quantity,den}') from jsonb_array_elements(r -> 'totals') t where t ->> 'name_ar' = 'مانجو قطع مصنع') = '9/5';
  assert (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'name_ar' = 'ملاعق بلاستيك للارز - مستورد') = '18'
     and (select t ->> 'kind' from jsonb_array_elements(r -> 'totals') t where t ->> 'name_ar' = 'ملاعق بلاستيك للارز - مستورد') = 'packaging';
  assert (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'name_ar' = 'مقطع فزعه') = '3'
     and (select t #>> '{quantity,decimal}' from jsonb_array_elements(r -> 'totals') t where t ->> 'name_ar' = 'بظابيظو مانجو كبير') = '3';
  assert r #>> '{lines,0,recipe,id}' = v_nov::text;
  r := public.app_catalog_consumption('maarif', '2026-11-04', '[{"label":"بظابيظو مانجو كبير","quantity":3}]');
  assert r #>> '{lines,0,recipe,id}' = v_oct::text and jsonb_array_length(r -> 'totals') = 4
     and not exists (select 1 from jsonb_array_elements(r -> 'totals') t where t ->> 'name_ar' like 'ملاعق%'), 'October keeps its own version';
  r := public.app_catalog_consumption('maarif', '2026-09-30', '[{"label":"بظابيظو مانجو كبير","quantity":3}]');
  assert r #>> '{lines,0,reasons,0,code}' = 'no_recipe_for_date';

  -- The cake alias: both Foodics spellings reach the same product; the Kinder line and unreviewed names still wait.
  select item_id into strict cake from public.catalog_source_labels where source_system = 'foodics' and label = 'كيكة الهبة دبي شيكولاتة كبيرة';
  r := public.app_catalog_consumption('maarif', '2026-11-07', '[{"label":"كيكة الهبة دبي شيكولاتة كبيرة","quantity":109},
    {"label":"كيكة الهبة دبي شيكولاتة كبير","quantity":109},{"label":"كيكة الهبة دبي صوص كيندر كبير","quantity":2},{"label":"الغوريلا","quantity":70}]');
  assert r #>> '{lines,0,product,id}' = cake::text and r #>> '{lines,1,product,id}' = cake::text, 'both spellings are the same product';
  assert r #>> '{lines,0,reasons,0,code}' in ('no_recipe', 'recipe_not_approved') and r #>> '{lines,0,status}' = 'blocked',
    'the alias does not invent a recipe';
  assert r #>> '{lines,2,reasons,0,code}' = 'mapping_pending' and r #>> '{lines,3,reasons,0,code}' = 'mapping_pending';

  -- Real recipes with unit or quantity defects cannot be approved, and a refused approval leaves no trace.
  perform public.phase5_act_as(null);
  select v.id into bad from public.recipe_versions v
  where v.status = 'draft' and not exists (select 1 from public.recipe_lines x where x.version_id = v.id
      and (x.component_id is null or x.quantity_num is null or x.unit_code is null))
    and exists (select 1 from public.recipe_lines y where y.version_id = v.id and (app_private.catalog_unit_factor(y.component_id, y.unit_code)) ? 'error')
    and not exists (select 1 from public.recipe_versions z where z.product_id = v.product_id and z.status = 'approved')
    and v.date_decision_id is null limit 1;
  assert bad is not null, 'the load contains a complete recipe with a unit conflict';
  select v.id into blank from public.recipe_versions v
  where v.status = 'draft' and exists (select 1 from public.recipe_lines x where x.version_id = v.id and x.quantity_num is null)
    and not exists (select 1 from public.recipe_versions z where z.product_id = v.product_id and z.status = 'approved')
    and v.date_decision_id is null limit 1;
  assert blank is not null;
  perform public.phase5_act_as(admin);
  approved_before := (select count(*) from public.audit_log where action = 'catalog.recipe_approved');
  perform public.phase5_expect('CT003', format($q$select public.app_catalog_approve_recipe(%L, date '2026-01-01', null, %s)$q$, bad, (select version from public.recipe_versions where id = bad)));
  perform public.phase5_expect('CT002', format($q$select public.app_catalog_approve_recipe(%L, date '2026-01-01', null, %s)$q$, blank, (select version from public.recipe_versions where id = blank)));
  assert (select count(*) from public.recipe_versions where id in (bad, blank) and status = 'draft') = 2
     and (select count(*) from public.audit_log where action = 'catalog.recipe_approved') = approved_before, 'no partial approval or audit entry';

  -- Review items: a note is required to close, the closer is recorded, and a person without the permission cannot.
  select id into review from public.catalog_review_items where kind = 'untracked_component' and status = 'open' limit 1;
  perform public.phase5_expect('22023', format($q$select public.app_catalog_resolve_review(%L, 'dismissed', '')$q$, review));
  perform public.app_catalog_resolve_review(review, 'dismissed', 'Not a stock item');
  assert (select resolved_by from public.catalog_review_items where id = review) = admin;
  perform public.app_catalog_resolve_review(review, 'open', null);
  assert (select resolved_at from public.catalog_review_items where id = review) is null;
  perform public.phase5_act_as(keeper);
  perform public.phase5_expect('42501', format($q$select public.app_catalog_resolve_review(%L, 'dismissed', 'no')$q$, review));
  perform public.phase5_act_as(null);
end;
$$;

-- ------------------------------------------------------------------ 9. audit history
do $$
declare
  act text;
begin
  foreach act in array array['catalog.item_saved', 'catalog.item_status_changed', 'catalog.conversion_saved', 'catalog.mapping_decided',
    'catalog.names_queued', 'catalog.review_resolved', 'catalog.recipe_created', 'catalog.recipe_line_saved', 'catalog.recipe_approved',
    'catalog.recipe_range_closed', 'catalog.recipe_details_saved', 'catalog.date_decision_answered'] loop
    assert exists (select 1 from public.audit_log a where a.action = act and a.actor_name = 'admin'
                   and a.actor_id = 'a5000000-0000-4000-8000-000000000001'), act || ' is recorded with its actor';
  end loop;
  assert not exists (select 1 from public.audit_log where action like 'catalog.%' and actor_name <> 'admin'), 'only the administrator changed the catalog here';
  assert exists (select 1 from public.audit_log where action = 'catalog.recipe_line_saved' and changes #>> '{quantity,num}' = '1'
                 and changes #>> '{quantity,den}' = '30'), 'the audit keeps the exact quantity';
  assert exists (select 1 from public.audit_log where action = 'catalog.recipe_approved' and changes ->> 'effective_from' = '2026-11-05'
                 and changes ->> 'label' = 'November workbook');
  assert exists (select 1 from public.audit_log where action = 'catalog.date_decision_answered' and changes ->> 'after' = '2026-11-05');
  perform public.phase5_expect('42501', $q$update public.audit_log set actor_name = 'x' where action like 'catalog.%'$q$);
end;
$$;

rollback;

select 'phase5 database checks passed';
