-- Phase 2: cross-branch comparison figures (branch-comparison prototype scope).
-- Report fields: CMP-05..CMP-08.
--
-- Maarif figures come from its closed business days. Al Quds, Bourgogne (and Maarif before it
-- went live) have separately recorded reporting-only figures. A branch with no figure for a date
-- simply has no row: it is MISSING, not 0.

create table public.comparison_figures (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  net_sales numeric(14, 2) check (net_sales >= 0),
  order_count integer check (order_count >= 0),
  source text not null default 'reporting_only' check (source in ('reporting_only')),
  -- Actual instant the figure was entered.
  entered_at timestamptz not null default now(),
  unique (branch_id, business_date)
);

-- One figure per branch and date: a closed business day wins over a reporting-only figure.
create view public.branch_daily_figures
with (security_invoker = true) as
select d.branch_id, d.business_date, d.net_sales, d.order_count, 'closed_day'::text as source
from public.business_days d
where d.status = 'closed' and d.net_sales is not null
union all
select f.branch_id, f.business_date, f.net_sales, f.order_count, f.source
from public.comparison_figures f
where f.net_sales is not null
  and not exists (
    select 1
    from public.business_days d
    where d.branch_id = f.branch_id
      and d.business_date = f.business_date
      and d.status = 'closed'
      and d.net_sales is not null
  );

alter table public.comparison_figures enable row level security;

revoke all on table public.comparison_figures, public.branch_daily_figures from anon, authenticated;
