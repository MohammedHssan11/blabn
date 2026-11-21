-- Phase 2 database checks. Run against a local database built from the migrations and seed.sql:
--   npm run db:check
-- Everything runs in one transaction that is rolled back; any failed check raises an exception.

begin;

-- 1. Every public table has row-level security on, and the API roles have no direct table access.
do $$
declare
  t record;
begin
  for t in
    select c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    if not t.relrowsecurity then
      raise exception 'RLS is off for public.%', t.relname;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.business_days', 'select')
     or has_table_privilege('authenticated', 'public.cash_counts', 'select')
     or has_table_privilege('anon', 'public.branch_daily_figures', 'select') then
    raise exception 'API roles must not have direct access before Phase 3 policies exist';
  end if;
end $$;

-- 2. The seed matches the fixture (row counts) and is synthetic.
do $$
begin
  assert (select count(*) from public.branches) = 3, 'branches';
  assert (select count(*) from public.business_days) = 10, 'business_days';
  assert (select count(*) from public.cash_movements) = 5, 'cash_movements';
  assert (select count(*) from public.cash_counts) = 2, 'cash_counts';
  assert (select count(*) from public.comparison_figures) = 3, 'comparison_figures';
  assert (select name from public.organizations) like 'Synthetic%', 'organization must be synthetic';
end $$;

-- 3. Blank and zero stay different.
do $$
begin
  assert (select card_amount from public.business_days where business_date = '2026-11-03') = 0, 'recorded zero card';
  assert (select card_amount from public.business_days where business_date = '2026-11-07') is null, 'blank card';
  assert (select order_count from public.business_days where business_date = '2026-11-06') is null, 'blank orders';
  assert (select order_count from public.business_days where business_date = '2026-11-07') = 0, 'zero orders';
  assert (select net_sales from public.business_days where business_date = '2026-11-08') is null, 'open day has blank sales';
end $$;

-- 4. Cash count example: expected 600, counted 603, variance +3, still +3 after the later deposit.
do $$
declare
  c record;
  recalculated numeric;
begin
  select * into c
  from public.cash_counts cc
  join public.business_days d on d.id = cc.business_day_id
  where d.business_date = '2026-11-02';

  assert c.counted_amount = 603.00, 'counted 603';
  assert c.expected_cash = 600.00, 'expected 600';
  assert c.variance = 3.00, 'variance +3';

  assert (
    select count(*) from public.cash_movements m
    where m.business_day_id = c.business_day_id and m.kind = 'bank_remittance' and m.occurred_at > c.counted_at
  ) = 1, 'a bank deposit exists after the count';

  -- Recalculating at the count time ignores the later deposit and reproduces the stored result.
  select d.opening_cash + (d.net_sales - d.card_amount)
         - coalesce((select sum(m.amount) from public.cash_movements m
                     where m.business_day_id = d.id and m.occurred_at <= c.counted_at), 0)
  into recalculated
  from public.business_days d where d.id = c.business_day_id;
  assert recalculated = c.expected_cash, 'recalculation equals stored expected cash';
end $$;

-- Every saved count equals its recalculation at count time.
do $$
declare
  bad integer;
begin
  select count(*) into bad
  from public.cash_counts cc
  join public.business_days d on d.id = cc.business_day_id
  where d.opening_cash is not null and d.net_sales is not null and d.card_amount is not null
    and (d.opening_cash + (d.net_sales - d.card_amount)
         - coalesce((select sum(m.amount) from public.cash_movements m
                     where m.business_day_id = d.id and m.occurred_at <= cc.counted_at), 0)) is distinct from cc.expected_cash;
  assert bad = 0, 'saved counts must equal recalculation at count time';
end $$;

-- 5. Business date is stored separately from event times and agrees with the branch settings.
do $$
declare
  bad integer;
begin
  select count(*) into bad
  from public.cash_counts cc
  join public.business_days d on d.id = cc.business_day_id
  join public.branches b on b.id = d.branch_id
  where public.business_date_of(cc.counted_at, b.timezone, b.business_day_rollover) <> d.business_date;
  assert bad = 0, 'count event time agrees with its business date';

  select count(*) into bad
  from public.cash_movements m
  join public.business_days d on d.id = m.business_day_id
  join public.branches b on b.id = d.branch_id
  where public.business_date_of(m.occurred_at, b.timezone, b.business_day_rollover) <> d.business_date;
  assert bad = 0, 'movement event time agrees with its business date';

  -- 00:20 local on 3 Nov is still 2 Nov with a 04:00 rollover, and 3 Nov with a 00:00 rollover.
  -- The instant is built from the LOCAL time so the check tests the rollover logic and does not
  -- depend on which UTC offset this server's time-zone data gives Casablanca (see HANDOFF.md).
  assert public.business_date_of(timestamp '2026-11-03 00:20:00' at time zone 'Africa/Casablanca', 'Africa/Casablanca', time '04:00') = date '2026-11-02',
    '00:20 local with a 04:00 rollover belongs to the previous day';
  assert public.business_date_of(timestamp '2026-11-03 00:20:00' at time zone 'Africa/Casablanca', 'Africa/Casablanca', time '00:00') = date '2026-11-03',
    '00:20 local with a 00:00 rollover belongs to the same day';
end $$;

-- 6. Weekly comparison example: Maarif 120 vs 100 = 120 %; Bourgogne has no current figure (missing).
do $$
declare
  cur numeric;
  pri numeric;
begin
  select net_sales into cur from public.branch_daily_figures f join public.branches b on b.id = f.branch_id
    where b.code = 'maarif' and f.business_date = '2026-11-10';
  select net_sales into pri from public.branch_daily_figures f join public.branches b on b.id = f.branch_id
    where b.code = 'maarif' and f.business_date = '2026-11-03';
  assert cur = 120.00 and pri = 100.00, 'maarif figures';
  assert round(cur * 100 / pri, 2) = 120.00, 'ratio 120 %';
  assert not exists (
    select 1 from public.branch_daily_figures f join public.branches b on b.id = f.branch_id
    where b.code = 'bourgogne' and f.business_date = '2026-11-10'
  ), 'a missing branch has no row (never 0)';
end $$;

-- 7. Constraints reject bad data.
do $$
declare
  org uuid := (select id from public.organizations limit 1);
  branch uuid := (select id from public.branches where code = 'maarif');
  day uuid := (select id from public.business_days where business_date = '2026-11-02');
  rejected boolean;
begin
  -- a closed day needs its system revenue
  rejected := false;
  begin
    insert into public.business_days (branch_id, business_date, status, closed_at) values (branch, '2026-12-01', 'closed', now());
  exception when check_violation then rejected := true; end;
  assert rejected, 'closed day without sales must be rejected';

  -- one business day per branch and date
  rejected := false;
  begin
    insert into public.business_days (branch_id, business_date) values (branch, '2026-11-02');
  exception when unique_violation then rejected := true; end;
  assert rejected, 'duplicate business day must be rejected';

  -- negative amounts
  rejected := false;
  begin
    insert into public.cash_movements (business_day_id, kind, amount, occurred_at) values (day, 'expense', -1, now());
  exception when check_violation then rejected := true; end;
  assert rejected, 'negative movement must be rejected';

  -- a count cannot be blank
  rejected := false;
  begin
    insert into public.cash_counts (business_day_id, counted_amount, counted_at, calc_version) values (day, null, now(), 'x');
  exception when not_null_violation then rejected := true; end;
  assert rejected, 'blank count must be rejected';

  -- an explicit zero count is allowed
  insert into public.cash_counts (business_day_id, counted_amount, counted_at, expected_cash, variance, calc_version)
  values (day, 0, now(), 600, -600, 'cash-count-v1');

  -- variance must agree with counted - expected
  rejected := false;
  begin
    insert into public.cash_counts (business_day_id, counted_amount, counted_at, expected_cash, variance, calc_version)
    values (day, 603, now(), 600, 5, 'cash-count-v1');
  exception when check_violation then rejected := true; end;
  assert rejected, 'inconsistent variance must be rejected';

  -- expected cash and variance are a pair (migration 20261121000004)
  -- a missing variance next to an expected amount
  rejected := false;
  begin
    insert into public.cash_counts (business_day_id, counted_amount, counted_at, expected_cash, variance, calc_version)
    values (day, 603, now(), 600, null, 'cash-count-v1');
  exception when check_violation then rejected := true; end;
  assert rejected, 'expected cash with a NULL variance must be rejected';

  -- a variance without an expected amount
  rejected := false;
  begin
    insert into public.cash_counts (business_day_id, counted_amount, counted_at, expected_cash, variance, calc_version)
    values (day, 603, now(), null, 3, 'cash-count-v1');
  exception when check_violation then rejected := true; end;
  assert rejected, 'a variance without expected cash must be rejected';

  -- an incorrect variance, over and under
  rejected := false;
  begin
    insert into public.cash_counts (business_day_id, counted_amount, counted_at, expected_cash, variance, calc_version)
    values (day, 603, now(), 600, -3, 'cash-count-v1');
  exception when check_violation then rejected := true; end;
  assert rejected, 'a variance with the wrong sign must be rejected';

  -- a valid zero variance (counted equals expected) is a match, not a blank
  insert into public.cash_counts (business_day_id, counted_amount, counted_at, expected_cash, variance, calc_version)
  values (day, 600, now(), 600, 0, 'cash-count-v1');
  assert (select variance from public.cash_counts where business_day_id = day and counted_amount = 600 and expected_cash = 600) = 0,
    'a zero variance is stored as 0, not NULL';

  -- a valid unreconciled count: no expected amount and no variance
  insert into public.cash_counts (business_day_id, counted_amount, counted_at, expected_cash, variance, calc_version)
  values (day, 777, now(), null, null, 'cash-count-v1');
  assert (select count(*) from public.cash_counts where business_day_id = day and counted_amount = 777
          and expected_cash is null and variance is null) = 1, 'an unreconciled count is stored with both NULL';

  -- amounts follow numeric(14,2): the maximum fits, one cent above does not
  insert into public.cash_counts (business_day_id, counted_amount, counted_at, expected_cash, variance, calc_version)
  values (day, 999999999999.99, now(), null, null, 'cash-count-v1');
  rejected := false;
  begin
    insert into public.cash_counts (business_day_id, counted_amount, counted_at, expected_cash, variance, calc_version)
    values (day, 1000000000000.00, now(), null, null, 'cash-count-v1');
  exception when numeric_value_out_of_range then rejected := true; end;
  assert rejected, 'an amount above 999,999,999,999.99 must be rejected';

  -- unknown timezone
  rejected := false;
  begin
    insert into public.branches (organization_id, code, name_en, name_ar, timezone) values (org, 'tz_test', 'x', 'x', 'Mars/Olympus');
  exception when others then rejected := true; end;
  assert rejected, 'invalid timezone must be rejected';
end $$;

-- 8. The API roles cannot read the tables before Phase 3 policies exist.
set local role anon;
do $$
declare
  denied boolean := false;
begin
  begin
    perform 1 from public.business_days limit 1;
  exception when insufficient_privilege then denied := true; end;
  assert denied, 'anon must not read business_days';
end $$;
reset role;

rollback;

select 'phase2 database checks passed' as result;
