-- Phase 2: business days, cash movements and cash counts (daily-close prototype scope).
-- Report fields: DS-01..DS-10, ST-02..ST-08 (docs/phase1/field-map.json).

create table public.business_days (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  -- Calendar day of trading (field DS-01 / ST-01 / LG-01). Not the entry or print date.
  business_date date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  -- Actual instant the day was closed. Separate from business_date.
  closed_at timestamptz,
  -- Close figures. NULL = blank (not entered); 0 = recorded zero.
  net_sales numeric(14, 2) check (net_sales >= 0),      -- DS-02, ST-07
  order_count integer check (order_count >= 0),         -- DS-03
  card_amount numeric(14, 2) check (card_amount >= 0),  -- DS-08, ST-05
  opening_cash numeric(14, 2) check (opening_cash >= 0), -- LG-06 (carried forward in Phase 4)
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, business_date),
  -- A day cannot close without its system revenue (ST-07).
  constraint closed_day_has_sales_and_time
    check (status <> 'closed' or (net_sales is not null and closed_at is not null)),
  constraint open_day_has_no_close_time
    check (status <> 'open' or closed_at is null)
);

create trigger business_days_updated_at
  before update on public.business_days
  for each row execute function public.set_updated_at();

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  business_day_id uuid not null references public.business_days (id) on delete restrict,
  kind text not null check (kind in ('expense', 'bank_remittance')),
  amount numeric(14, 2) not null check (amount > 0),
  -- Actual instant of the movement. A deposit made after a count is later than the count.
  occurred_at timestamptz not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index cash_movements_day_time_idx on public.cash_movements (business_day_id, occurred_at);

-- One row per saved count; no row means "not counted" (never a zero or a match).
-- expected_cash and variance are the reconciliation stored AT COUNT TIME (P1-13): a deposit
-- recorded later does not change them. They are calculated by the server command that saves the
-- count and are NULL when opening cash, sales or card was blank.
create table public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  business_day_id uuid not null references public.business_days (id) on delete restrict,
  counted_amount numeric(14, 2) not null check (counted_amount >= 0),  -- ST-04 (an explicit 0 is a count)
  counted_at timestamptz not null,
  expected_cash numeric(14, 2),
  variance numeric(14, 2),                                              -- ST-08
  calc_version text not null,
  created_at timestamptz not null default now(),
  constraint variance_matches_expected check (
    (expected_cash is null and variance is null)
    or (expected_cash is not null and variance = counted_amount - expected_cash)
  )
);

create index cash_counts_day_idx on public.cash_counts (business_day_id, counted_at);

-- Who counted the cash and who was the cashier (ST-09, LG-08) is intentionally NOT modelled yet:
-- the role rule is decided in Phase 4 (question P1-19). Placeholder names must never be accepted.

alter table public.business_days enable row level security;
alter table public.cash_movements enable row level security;
alter table public.cash_counts enable row level security;

revoke all on table public.business_days, public.cash_movements, public.cash_counts from anon, authenticated;
