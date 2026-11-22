-- Synthetic acceptance cases. All changes roll back, including the test staff and audit rows.
begin;

create function public.phase4_act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
grant execute on function public.phase4_act_as(uuid) to authenticated;

insert into auth.users(id, email) values
  ('a4000000-0000-4000-8000-000000000001', 'cashier@phase4.test'),
  ('a4000000-0000-4000-8000-000000000002', 'manager@phase4.test'),
  ('a4000000-0000-4000-8000-000000000003', 'outsider@phase4.test');

insert into public.employees(id, organization_id, full_name)
select u.id, b.organization_id, split_part(u.email, '@', 1)
from auth.users u cross join public.branches b
where b.code = 'maarif' and u.email like '%@phase4.test';

insert into public.staff_accounts(user_id, employee_id, organization_id, email)
select u.id, u.id, e.organization_id, u.email from auth.users u join public.employees e on e.id = u.id
where u.email like '%@phase4.test';

insert into public.branch_memberships(staff_id, branch_id)
select u.id, b.id from auth.users u cross join public.branches b
where b.code = 'maarif' and u.email in ('cashier@phase4.test', 'manager@phase4.test');

insert into public.staff_group_assignments(staff_id, branch_id, group_key)
select u.id, b.branch_id, split_part(u.email, '@', 1)
from auth.users u join public.branch_memberships b on b.staff_id = u.id where u.email like '%@phase4.test';

do $$
declare
  cashier constant uuid := 'a4000000-0000-4000-8000-000000000001';
  manager constant uuid := 'a4000000-0000-4000-8000-000000000002';
  outsider constant uuid := 'a4000000-0000-4000-8000-000000000003';
  d1 constant date := '2026-10-01';
  d2 constant date := '2026-10-02';
  month constant date := '2026-10-01';
  r jsonb;
  report jsonb;
  request uuid := gen_random_uuid();
  remit uuid := gen_random_uuid();
  snapshot bigint;
  payload jsonb := jsonb_build_object('sales', 100000, 'posCash', 70000, 'card', 30000,
    'morning', 40000, 'evening', 60000, 'cashier', cashier, 'shift', 'both', 'orders', 10,
    'openingCash', 0, 'openingCustody', 5000);
begin
  assert (timestamp '2026-11-03 02:00' at time zone 'Africa/Casablanca') = timestamptz '2026-11-03 02:00Z',
    'Morocco legal time in November 2026 is GMT';
  assert public.business_date_of('2026-07-01 00:30Z', 'Africa/Casablanca', '02:00') = date '2026-06-30'
    and ('2026-07-01 00:30Z'::timestamptz at time zone 'Africa/Casablanca')::time = time '01:30',
    'Before the September change Casablanca was GMT+1';
  assert public.business_date_of('2026-11-03 00:00Z', 'Africa/Casablanca', '02:00') = date '2026-11-02'
    and public.business_date_of('2026-11-03 01:00Z', 'Africa/Casablanca', '02:00') = date '2026-11-02'
    and public.business_date_of('2026-11-03 01:59:59Z', 'Africa/Casablanca', '02:00') = date '2026-11-02'
    and public.business_date_of('2026-11-03 02:00Z', 'Africa/Casablanca', '02:00') = date '2026-11-03',
    'midnight, 01:00 and cutoff boundaries';
  assert (select business_day_rollover from public.branches where code = 'maarif') = time '02:00';
  assert not has_table_privilege('authenticated', 'public.business_days', 'insert,update')
    and not has_table_privilege('authenticated', 'public.cash_counts', 'insert')
    and not has_table_privilege('authenticated', 'public.cash_movements', 'insert');
  assert (select count(*) from public.operating_accounts a join public.branches b on b.id = a.branch_id
    where b.code = 'maarif') = 43, 'Reviewed November account codes were seeded';

  perform public.phase4_act_as(outsider);
  begin
    perform public.app_operating_report('maarif', d1, month);
    raise exception 'Unassigned staff read financial records';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.app_operating_command('maarif', d1, 'save', 0, request, payload);
    raise exception 'Unassigned staff saved a draft';
  exception when insufficient_privilege then null;
  end;

  perform public.phase4_act_as(cashier);
  begin
    perform public.app_operating_command('maarif', d1, 'save', 0, request, payload || '{"sales":22}');
    raise exception 'Inconsistent totals were accepted';
  exception when invalid_parameter_value then null;
  end;
  assert not exists (select 1 from public.operating_days), 'invalid first save left no financial row';
  r := public.app_operating_command('maarif', d1, 'save', 0, request, payload);
  assert (r->>'revision')::int = 1;
  assert public.app_operating_command('maarif', d1, 'save', 0, request, payload) = r;
  begin
    perform public.app_operating_command('maarif', d1, 'save', 0, gen_random_uuid(), payload);
    raise exception 'Stale edit was accepted';
  exception when serialization_failure then null;
  end;
  begin
    update public.operating_day_revisions set state = 'closed';
    raise exception 'Direct mutation was accepted';
  exception when insufficient_privilege then null;
  end;

  report := public.app_operating_report('maarif', d1, month);
  assert report #>> '{day,summary,variance}' is null and report #>> '{day,data,count,total}' is null;
  assert (report #>> '{day,summary,average}')::int = 10000
    and (report #>> '{day,summary,cardRatio}')::int = 3000;
  perform public.app_operating_command('maarif', d1, 'entry', 1, gen_random_uuid(),
    '{"kind":"cash_expense","amount":10000,"local":"2026-10-01T21:00"}');
  perform public.app_operating_command('maarif', d1, 'entry', 2, gen_random_uuid(),
    '{"kind":"custody_receipt","amount":1500,"local":"2026-10-01T21:00"}');
  perform public.app_operating_command('maarif', d1, 'entry', 3, gen_random_uuid(),
    '{"kind":"custody_expense","amount":700,"local":"2026-10-01T21:15"}');
  perform public.app_operating_command('maarif', d1, 'cancel_order', 4, gen_random_uuid(),
    '{"original":"SYN-1","originalAmount":2500,"originalLocal":"2026-10-02T01:00","local":"2026-10-02T01:01","replacement":"SYN-2","replacementAmount":2100,"note":"Test correction"}');
  perform public.app_operating_command('maarif', d1, 'count', 5, gen_random_uuid(),
    jsonb_build_object('counter', manager, 'local', '2026-10-02T02:45', 'quantities', '{"20000":3,"100":3}'::jsonb));
  report := public.app_operating_report('maarif', d1, month);
  assert report #>> '{day,data,count,counter,id}' = manager::text and report #>> '{day,data,count,recorder}' = cashier::text;
  assert (report #>> '{day,summary,expected}')::int = 60000 and (report #>> '{day,summary,variance}')::int = 300;
  perform public.app_operating_command('maarif', d1, 'submit', 6, gen_random_uuid(), '{}');
  begin
    perform public.app_operating_command('maarif', d1, 'close', 7, gen_random_uuid(), '{}');
    raise exception 'Cashier closed a day';
  exception when insufficient_privilege then null;
  end;

  perform public.phase4_act_as(manager);
  perform public.app_operating_command('maarif', d1, 'close', 7, gen_random_uuid(), '{}');
  r := public.app_operating_command('maarif', d1, 'late_remittance', 8, remit,
    '{"amount":60300,"local":"2026-10-02T02:55","reference":"SYN-DEPOSIT-01"}');
  assert public.app_operating_command('maarif', d1, 'late_remittance', 8, remit,
    '{"amount":60300,"local":"2026-10-02T02:55","reference":"SYN-DEPOSIT-01"}') = r;
  begin
    perform public.app_operating_command('maarif', d1, 'late_remittance', 9, gen_random_uuid(),
      '{"amount":60300,"local":"2026-10-02T02:55","reference":"syn-deposit-01"}');
    raise exception 'Duplicate bank deposit was accepted';
  exception when unique_violation then null;
  end;
  report := public.app_operating_report('maarif', d1, month);
  assert report #>> '{day,state}' = 'closed' and report #>> '{days,0,date}' = d1::text
    and report #>> '{day,closedAt}' is not null;
  assert (report #>> '{day,summary,variance}')::int = 300 and (report #>> '{day,summary,remittances}')::int = 60300;
  assert (report #>> '{day,summary,closingCash}')::int = -300 and (report #>> '{day,summary,closingCustody}')::int = 5800;

  perform public.phase4_act_as(cashier);
  perform public.app_operating_command('maarif', d2, 'save', 0, gen_random_uuid(),
    jsonb_build_object('sales', 50000, 'posCash', 50000, 'card', 0, 'cashier', cashier, 'orders', 0));
  perform public.app_operating_command('maarif', d2, 'count', 1, gen_random_uuid(),
    jsonb_build_object('counter', manager, 'local', '2026-10-02T22:00', 'quantities', '{"20000":0}'::jsonb));
  report := public.app_operating_report('maarif', d2, month);
  assert (report #>> '{day,summary,openingCash}')::int = -300 and (report #>> '{day,summary,openingCustody}')::int = 5800;
  assert (report #>> '{day,data,count,total}')::int = 0 and (report #>> '{day,summary,variance}')::int = -49700
    and report #>> '{day,summary,average}' is null;
  perform public.app_operating_command('maarif', d2, 'entry', 2, gen_random_uuid(),
    '{"kind":"remittance","amount":200,"local":"2026-10-02T21:00","reference":"SYN-BEFORE-COUNT"}');
  report := public.app_operating_report('maarif', d2, month);
  assert (report #>> '{day,summary,expected}')::int = 49500 and (report #>> '{day,summary,variance}')::int = -49500;
  perform public.app_operating_command('maarif', d2, 'count', 3, gen_random_uuid(),
    jsonb_build_object('counter', manager, 'local', '2026-10-02T22:00',
      'quantities', '{"20000":2,"5000":1,"2000":2,"500":1}'::jsonb));
  report := public.app_operating_report('maarif', d2, month);
  assert (report #>> '{day,summary,variance}')::int = 0;
  perform public.app_operating_command('maarif', d2, 'submit', 4, gen_random_uuid(), '{}');

  perform public.phase4_act_as(manager);
  r := public.app_operating_command('maarif', d2, 'close', 5, gen_random_uuid(), '{}');
  snapshot := (r ->> 'basis')::bigint;
  perform public.app_operating_command('maarif', d1, 'propose', 9, gen_random_uuid(),
    '{"change":"entry","kind":"cash_receipt","amount":1200,"local":"2026-10-01T21:45","reason":"Test approved adjustment"}');
  report := public.app_operating_report('maarif', d2, month);
  assert (report #>> '{day,summary,openingCash}')::int = -300, 'pending correction is excluded';
  perform public.app_operating_command('maarif', d1, 'approve', 10, gen_random_uuid(), '{}');
  report := public.app_operating_report('maarif', d2, month);
  assert (report #>> '{day,summary,openingCash}')::int = 900 and (report #>> '{day,summary,variance}')::int = 0,
    'current carry forward updates and saved count remains as observed';
  report := public.app_operating_report('maarif', d2, month, snapshot);
  assert (report #>> '{day,summary,openingCash}')::int = -300, 'prior report basis is preserved';
  report := public.app_operating_report('maarif', d1, month);
  assert report #>> '{day,state}' = 'corrected' and (report #>> '{day,summary,variance}')::int = -900;
  reset role;
  assert (select count(*) from public.audit_log where target_type = 'operating_day' and actor_id in (cashier, manager)) = 17,
    'audit contains one row per committed revision, including proposal and approval';
end;
$$;

rollback;
select 'phase4 database checks passed';
