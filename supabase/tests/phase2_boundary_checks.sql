-- Phase 2 BASELINE assertions that stop being true once Phase 3 adds policies and grants.
-- Run only at the Phase 2 migration boundary (migrations 20261121000001..4 applied, nothing later):
--   node scripts/phase3/upgrade-test.mjs
-- It preserves the original Phase 2 deny-all check exactly as it was written: before Phase 3 the
-- API roles have no direct access to any application table. After Phase 3 the same roles have
-- exactly the grants and policies tested in phase3_checks.sql.

begin;

do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'staff_accounts') then
    raise exception 'this check is only valid at the Phase 2 boundary; Phase 3 tables already exist';
  end if;
  if has_table_privilege('anon', 'public.business_days', 'select')
     or has_table_privilege('authenticated', 'public.cash_counts', 'select')
     or has_table_privilege('anon', 'public.branch_daily_figures', 'select') then
    raise exception 'API roles must not have direct access before Phase 3 policies exist';
  end if;
  if has_table_privilege('authenticated', 'public.business_days', 'select')
     or has_table_privilege('authenticated', 'public.comparison_figures', 'select')
     or has_table_privilege('authenticated', 'public.branches', 'select') then
    raise exception 'authenticated must not read application tables before Phase 3';
  end if;
end $$;

-- A signed-in role is denied too (no grant, no policy).
set local role authenticated;
do $$
declare
  denied boolean := false;
begin
  begin
    perform 1 from public.business_days limit 1;
  exception when insufficient_privilege then denied := true; end;
  assert denied, 'authenticated must not read business_days at the Phase 2 boundary';
end $$;
reset role;

rollback;

select 'phase2 boundary (deny-all baseline) checks passed' as result;
