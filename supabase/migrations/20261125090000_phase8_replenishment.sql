-- Phase 8: three-month planning, purchase orders and receiving (report fields ORD-01 and ORD-02).
--
-- * Planning reads the operational history of the branch from its first live business date only
--   (the date Abdo chooses at handover, kept in comparison_branch_settings.live_from since Phase 7).
--   A business date is a COMPLETE observation when its Product Mix is locked and every line is
--   posted. Any other date is MISSING and is left out of the same-weekday average; it never counts
--   as zero. A complete date on which an item was not consumed is a real zero.
-- * The forecast is the plain same-weekday average of the complete observations in the 13 weeks
--   (91 days) up to the order business date. Below the configured minimum number of complete
--   observations (undecided, so it starts empty) the item is in REVIEW: no recommendation, and a
--   manual purchase order stays available.
-- * recommended = forecast demand + safety stock - usable stock at the expected receipt date
--   - eligible confirmed incoming, floored at 0. Usable stock is projected day by day from the book
--   stock of the order business date, adding confirmed incoming expected before the receipt date and
--   subtracting the forecast of each day before delivery when the history supports it. Confirmed
--   incoming inside the coverage window is eligible; incoming after the window, or overdue, is not
--   counted. Every line of incoming is counted at most once.
-- * Pack size, supplier minimum, shelf life and order cut-off are optional settings that start empty;
--   they are applied after the forecast and never invent a value.
-- * A purchase order belongs to one branch. Each line keeps the catalog item, unit, numeric quantity
--   and source (factory or store), the suggestion it came from and the override reason. The default
--   expected receipt is the order business date (Phase 4 rule: 02:00 cutoff, Africa/Casablanca) plus
--   two calendar days. An override keeps the original date and needs a reason.
-- * Stock comes only from saved receipt lines: each receipt line creates exactly one Phase 6
--   `receipt` movement (unique movement_id, and a deferred check that every purchase-order movement
--   has its receipt line). A retried receipt request writes nothing. Receiving more than the
--   outstanding quantity needs an explicit, audited over-receipt reason.
-- * Creating (purchase_order.propose), approving (purchase_order.approve) and receiving
--   (purchase_order.receive, new) are separate permissions, checked by every command per branch and
--   inside the caller's organization. Order and receipt history is append-only; the one change an
--   order allows is its single approve/reject decision.

-- ------------------------------------------------------------------ permission
insert into public.permissions (key, description, scope, branch_kind) values
  ('purchase_order.receive', 'Receive purchase-order lines into stock (Phase 8)', 'branch', 'operational');

insert into public.group_permissions (group_key, permission_key) values
  ('system_admin', 'purchase_order.receive'),
  ('storekeeper', 'purchase_order.receive');

-- ------------------------------------------------------------------ exact comparisons
create function app_private.rat_lt(a app_private.rat, b app_private.rat)
returns boolean language sql immutable set search_path = '' as $$
  select a.n * b.d < b.n * a.d;
$$;

create function app_private.rat_eq(a app_private.rat, b app_private.rat)
returns boolean language sql immutable set search_path = '' as $$
  select a.n * b.d = b.n * a.d;
$$;

create function app_private.rat_max0(a app_private.rat)
returns app_private.rat language sql immutable set search_path = '' as $$
  select case when a.n < 0 then row(0, 1)::app_private.rat else a end;
$$;

-- ------------------------------------------------------------------ settings (all optional; they start empty)
-- No row: the minimum number of observations is undecided (every item stays in review) and an order
-- covers one day (deliveries are daily).
create table public.replenishment_settings (
  branch_id uuid primary key references public.branches (id),
  min_observations integer check (min_observations is null or min_observations between 1 and 13),
  coverage_days integer not null default 1 check (coverage_days between 1 and 14),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid references public.staff_accounts (user_id),
  updated_at timestamptz not null default now()
);

-- Per item, in the item's base unit. A blank setting is "not confirmed" and has no effect; safety
-- stock that is not set counts as 0 and is shown as not set.
create table public.replenishment_item_settings (
  branch_id uuid not null references public.branches (id),
  item_id uuid not null references public.catalog_items (id),
  safety_num numeric,
  safety_den numeric,
  pack_num numeric,
  pack_den numeric,
  min_order_num numeric,
  min_order_den numeric,
  shelf_life_days integer check (shelf_life_days is null or shelf_life_days between 1 and 3650),
  source text check (source is null or source in ('factory', 'store')),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid references public.staff_accounts (user_id),
  updated_at timestamptz not null default now(),
  primary key (branch_id, item_id),
  check ((safety_num is null) = (safety_den is null) and (safety_num is null or (safety_num >= 0 and safety_den > 0))),
  check ((pack_num is null) = (pack_den is null) and (pack_num is null or (pack_num > 0 and pack_den > 0))),
  check ((min_order_num is null) = (min_order_den is null) and (min_order_num is null or (min_order_num > 0 and min_order_den > 0)))
);

-- Per source (factory or store): an exception to the two-day rule and the order cut-off time.
create table public.replenishment_source_settings (
  branch_id uuid not null references public.branches (id),
  source text not null check (source in ('factory', 'store')),
  lead_days integer check (lead_days is null or lead_days between 0 and 14),
  cutoff_local time,
  revision integer not null default 1 check (revision > 0),
  updated_by uuid references public.staff_accounts (user_id),
  updated_at timestamptz not null default now(),
  primary key (branch_id, source)
);

-- ------------------------------------------------------------------ purchase orders
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  order_no integer not null check (order_no > 0),
  -- 'legacy': a historical order mapped from the old order sheet (SRC-01). Never receivable.
  origin text not null check (origin in ('app', 'legacy')),
  -- Operational business date (Phase 4 rule) of the creation instant. Blank on a legacy order whose
  -- source has no creation date.
  business_date date check (business_date is null or isfinite(business_date)),
  -- The actual creation instant and its branch-local text. Blank only on legacy orders.
  created_at timestamptz,
  created_local text,
  created_by uuid not null references public.staff_accounts (user_id),
  created_by_name text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  request_id uuid not null,
  status text not null check (status in ('proposed', 'approved', 'rejected', 'historical')),
  decided_by uuid references public.staff_accounts (user_id),
  decided_by_name text,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 1 and 500),
  note text check (note is null or length(note) <= 500),
  -- Legacy provenance, e.g. 'SRC-01' and 'Sheet1!C6'.
  source_file text check (source_file is null or length(source_file) <= 40),
  source_cell text check (source_cell is null or length(source_cell) <= 40),
  unique (branch_id, order_no),
  unique (branch_id, request_id),
  check (origin = 'legacy' or (created_at is not null and created_local is not null and business_date is not null)),
  check (origin = 'app' or (created_at is null and source_file is not null and source_cell is not null)),
  check ((origin = 'legacy') = (status = 'historical')),
  check ((status in ('approved', 'rejected')) = (decided_at is not null and decided_by is not null and decided_by_name is not null)),
  check (status <> 'rejected' or decision_note is not null)
);
create index purchase_orders_branch_idx on public.purchase_orders (branch_id, status);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders (id),
  line_no integer not null check (line_no between 1 and 200),
  item_id uuid not null references public.catalog_items (id),
  source text not null check (source in ('factory', 'store')),
  -- The final ordered quantity as typed (a number; text such as «،» is refused) and as an exact
  -- fraction in the ordered unit.
  unit text not null references public.catalog_units (code),
  quantity_text text not null check (quantity_text ~ '^[0-9]{1,9}(\.[0-9]{1,3})?$'),
  quantity_num numeric not null check (quantity_num > 0 and quantity_num = trunc(quantity_num)),
  quantity_den numeric not null check (quantity_den > 0 and quantity_den = trunc(quantity_den)),
  -- The same quantity in the item's base unit.
  base_unit text not null references public.catalog_units (code),
  base_num numeric not null check (base_num > 0),
  base_den numeric not null check (base_den > 0),
  -- The suggestion in the base unit and the planning arithmetic it came from. Blank on a manual line.
  suggested_num numeric,
  suggested_den numeric,
  plan jsonb,
  override_reason text check (override_reason is null or length(btrim(override_reason)) between 1 and 500),
  unique (order_id, line_no),
  unique (order_id, item_id, source),
  check ((suggested_num is null) = (suggested_den is null) and (suggested_num is null) = (plan is null)),
  check (suggested_num is null or (suggested_num >= 0 and suggested_den > 0)),
  -- A final quantity that differs from the suggestion needs a reason.
  check (suggested_num is null or suggested_num * base_den = base_num * suggested_den or override_reason is not null)
);
create index purchase_order_lines_item_idx on public.purchase_order_lines (item_id);

-- Expected receipt dates. Revision 1 is the original (the two-day default, or the legacy sheet
-- value); every override is a new revision with its reason. The current date is the last revision.
create table public.purchase_order_expected_dates (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.purchase_orders (id),
  revision integer not null check (revision > 0),
  expected_date date not null check (isfinite(expected_date)),
  kind text not null check (kind in ('default', 'override', 'legacy')),
  rule text check (rule is null or length(rule) <= 120),
  reason text check (reason is null or length(btrim(reason)) between 1 and 500),
  -- Legacy: the original source value exactly as it appears in the sheet.
  source_value text check (source_value is null or length(source_value) <= 100),
  actor_id uuid not null references public.staff_accounts (user_id),
  actor_name text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (order_id, revision),
  check ((revision = 1) = (kind in ('default', 'legacy'))),
  check (kind <> 'override' or reason is not null),
  check ((kind = 'legacy') = (source_value is not null))
);

-- One receiving request. Its business date is the actual receipt date, from the receiving evidence.
create table public.purchase_order_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  order_id uuid not null references public.purchase_orders (id),
  posting_id uuid not null unique references public.stock_postings (id),
  business_date date not null,
  received_local text not null,
  received_at timestamptz not null,
  reference text check (reference is null or length(reference) <= 100),
  note text check (note is null or length(note) <= 500),
  actor_id uuid not null references public.staff_accounts (user_id),
  actor_name text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index purchase_order_receipts_order_idx on public.purchase_order_receipts (order_id);

-- One received quantity of one order line, in the line's unit, and the ONE stock movement it created.
create table public.purchase_order_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_order_receipts (id),
  line_id uuid not null references public.purchase_order_lines (id),
  quantity_text text not null check (quantity_text ~ '^[0-9]{1,9}(\.[0-9]{1,3})?$'),
  quantity_num numeric not null check (quantity_num > 0 and quantity_num = trunc(quantity_num)),
  quantity_den numeric not null check (quantity_den > 0 and quantity_den = trunc(quantity_den)),
  movement_id uuid not null references public.stock_movements (id),
  -- Explicit, audited acceptance of more than the outstanding quantity.
  over_receipt_reason text check (over_receipt_reason is null or length(btrim(over_receipt_reason)) between 1 and 500),
  constraint purchase_order_receipt_lines_one_movement unique (movement_id),
  unique (receipt_id, line_id)
);
create index purchase_order_receipt_lines_line_idx on public.purchase_order_receipt_lines (line_id);

-- Cancellation of the unreceived rest of a line. It closes the line and creates no stock.
create table public.purchase_order_cancellations (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.purchase_order_lines (id),
  quantity_num numeric not null check (quantity_num > 0),
  quantity_den numeric not null check (quantity_den > 0),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  actor_id uuid not null references public.staff_accounts (user_id),
  actor_name text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index purchase_order_cancellations_line_idx on public.purchase_order_cancellations (line_id);

-- Every accepted request: the command, its request identifier and hash (retries), the actor, the
-- operational business date and the result it returned.
create table public.purchase_order_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  order_id uuid references public.purchase_orders (id),
  command text not null,
  request_id uuid not null,
  request_hash bytea not null,
  actor_id uuid not null references public.staff_accounts (user_id),
  actor_name text not null,
  business_date date not null,
  happened_at timestamptz not null,
  reason text,
  result jsonb not null,
  unique (branch_id, request_id)
);
create index purchase_order_events_order_idx on public.purchase_order_events (order_id);

-- ------------------------------------------------------------------ stock movements from receipts
alter table public.stock_movements drop constraint stock_movements_source_check;
alter table public.stock_movements add constraint stock_movements_source_check
  check (source in ('manual', 'product_mix', 'adjustment', 'opening', 'reversal', 'purchase_order'));

-- ------------------------------------------------------------------ append-only history
create function app_private.refuse_purchase_order_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Purchase-order history is append-only (% on %)', tg_op, tg_table_name using errcode = '42501';
end;
$$;

-- An order is decided once (approved or rejected); nothing else about it changes.
create function app_private.purchase_order_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status = 'proposed' and new.status in ('approved', 'rejected')
     and (to_jsonb(new) - 'status' - 'decided_by' - 'decided_by_name' - 'decided_at' - 'decision_note')
       = (to_jsonb(old) - 'status' - 'decided_by' - 'decided_by_name' - 'decided_at' - 'decision_note') then
    return new;
  end if;
  raise exception 'Purchase-order history is append-only (% on %)', tg_op, tg_table_name using errcode = '42501';
end;
$$;

create trigger purchase_orders_guard before update or delete on public.purchase_orders
  for each row execute function app_private.purchase_order_guard();
create trigger purchase_orders_no_truncate before truncate on public.purchase_orders
  for each statement execute function app_private.refuse_purchase_order_change();

do $$
declare t text;
begin
  foreach t in array array['purchase_order_lines', 'purchase_order_expected_dates', 'purchase_order_receipts',
                           'purchase_order_receipt_lines', 'purchase_order_cancellations', 'purchase_order_events'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function app_private.refuse_purchase_order_change()', t || '_no_change', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function app_private.refuse_purchase_order_change()', t || '_no_truncate', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ line quantities
create function app_private.po_line_received(p_line uuid)
returns app_private.rat language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.rat_sum(row(r.quantity_num, r.quantity_den)::app_private.rat), row(0, 1)::app_private.rat)
  from public.purchase_order_receipt_lines r where r.line_id = p_line;
$$;

create function app_private.po_line_cancelled(p_line uuid)
returns app_private.rat language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.rat_sum(row(c.quantity_num, c.quantity_den)::app_private.rat), row(0, 1)::app_private.rat)
  from public.purchase_order_cancellations c where c.line_id = p_line;
$$;

-- Final - received - cancelled, in the line's unit. Negative after an accepted over-receipt.
create function app_private.po_line_outstanding(p_line uuid)
returns app_private.rat language sql stable security definer set search_path = '' as $$
  select app_private.rat_sub(app_private.rat_sub(row(l.quantity_num, l.quantity_den)::app_private.rat,
           app_private.po_line_received(l.id)), app_private.po_line_cancelled(l.id))
  from public.purchase_order_lines l where l.id = p_line;
$$;

-- A quantity in the line's unit, in the item's base unit (the line keeps both of its final quantity).
create function app_private.po_line_to_base(l public.purchase_order_lines, q app_private.rat)
returns app_private.rat language sql immutable set search_path = '' as $$
  select app_private.rat_mul(q, app_private.rat_make(l.base_num * l.quantity_den, l.base_den * l.quantity_num));
$$;

-- ------------------------------------------------------------------ receipt guards
-- Every saved receipt line: an approved order, a positive outstanding quantity unless an explicit
-- over-receipt reason is given, and exactly one matching Phase 6 receipt movement.
create function app_private.purchase_order_receipt_line_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  l public.purchase_order_lines%rowtype;
  o public.purchase_orders%rowtype;
  r public.purchase_order_receipts%rowtype;
  m public.stock_movements%rowtype;
  outstanding app_private.rat;
  base app_private.rat;
begin
  select * into l from public.purchase_order_lines where id = new.line_id;
  select * into o from public.purchase_orders where id = l.order_id;
  select * into r from public.purchase_order_receipts where id = new.receipt_id;
  if o.id is null or r.order_id <> o.id or o.status <> 'approved' then
    raise exception 'Only an approved order can be received' using errcode = 'CT803';
  end if;
  outstanding := app_private.po_line_outstanding(l.id);
  if app_private.rat_lt(outstanding, row(new.quantity_num, new.quantity_den)::app_private.rat)
     and new.over_receipt_reason is null then
    raise exception 'More than the outstanding quantity: confirm an over-receipt with a reason' using errcode = 'CT801';
  end if;
  select * into m from public.stock_movements where id = new.movement_id;
  base := app_private.po_line_to_base(l, row(new.quantity_num, new.quantity_den)::app_private.rat);
  if m.id is null or m.kind <> 'receipt' or m.direction <> 1 or m.source <> 'purchase_order' or m.reverses_id is not null
     or m.item_id <> l.item_id or m.branch_id <> o.branch_id or m.posting_id <> r.posting_id
     or m.business_date <> r.business_date or m.quantity_num * base.d <> base.n * m.quantity_den then
    raise exception 'A receipt line needs its own receipt movement of the same item and quantity' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger purchase_order_receipt_lines_guard before insert on public.purchase_order_receipt_lines
  for each row execute function app_private.purchase_order_receipt_line_guard();

-- A cancellation closes exactly the unreceived rest of a line of an approved order.
create function app_private.purchase_order_cancellation_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  outstanding app_private.rat;
begin
  if (select o.status from public.purchase_order_lines l join public.purchase_orders o on o.id = l.order_id
      where l.id = new.line_id) is distinct from 'approved' then
    raise exception 'Only an approved order can be cancelled' using errcode = 'CT803';
  end if;
  outstanding := app_private.po_line_outstanding(new.line_id);
  if outstanding.n <= 0 or outstanding.n * new.quantity_den <> new.quantity_num * outstanding.d then
    raise exception 'Only the unreceived rest of a line can be cancelled' using errcode = 'CT803';
  end if;
  return new;
end;
$$;
create trigger purchase_order_cancellations_guard before insert on public.purchase_order_cancellations
  for each row execute function app_private.purchase_order_cancellation_guard();

-- Stock never comes from an order alone: a purchase-order movement must have its receipt line by
-- the end of the transaction.
create function app_private.purchase_order_movement_has_receipt()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.purchase_order_receipt_lines r where r.movement_id = new.id) then
    raise exception 'A purchase-order receipt movement needs its saved receipt line' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger stock_movements_purchase_order_receipt after insert on public.stock_movements
  deferrable initially deferred for each row when (new.source = 'purchase_order')
  execute function app_private.purchase_order_movement_has_receipt();

-- ------------------------------------------------------------------ access
create function app_private.purchase_order_reader(p_branch uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.has_permission('inventory.view', p_branch)
      or app_private.has_permission('purchase_order.propose', p_branch)
      or app_private.has_permission('purchase_order.approve', p_branch)
      or app_private.has_permission('purchase_order.receive', p_branch);
$$;

alter table public.replenishment_settings enable row level security;
alter table public.replenishment_item_settings enable row level security;
alter table public.replenishment_source_settings enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_expected_dates enable row level security;
alter table public.purchase_order_receipts enable row level security;
alter table public.purchase_order_receipt_lines enable row level security;
alter table public.purchase_order_cancellations enable row level security;
alter table public.purchase_order_events enable row level security;

revoke all on public.replenishment_settings, public.replenishment_item_settings, public.replenishment_source_settings,
  public.purchase_orders, public.purchase_order_lines, public.purchase_order_expected_dates, public.purchase_order_receipts,
  public.purchase_order_receipt_lines, public.purchase_order_cancellations, public.purchase_order_events
  from public, anon, authenticated, service_role;
grant select on public.replenishment_settings, public.replenishment_item_settings, public.replenishment_source_settings,
  public.purchase_orders, public.purchase_order_lines, public.purchase_order_expected_dates, public.purchase_order_receipts,
  public.purchase_order_receipt_lines, public.purchase_order_cancellations, public.purchase_order_events
  to authenticated;

create policy replenishment_settings_read on public.replenishment_settings for select to authenticated
  using (app_private.purchase_order_reader(branch_id) or app_private.has_permission('admin.config.manage'));
create policy replenishment_item_settings_read on public.replenishment_item_settings for select to authenticated
  using (app_private.purchase_order_reader(branch_id) or app_private.has_permission('admin.config.manage'));
create policy replenishment_source_settings_read on public.replenishment_source_settings for select to authenticated
  using (app_private.purchase_order_reader(branch_id) or app_private.has_permission('admin.config.manage'));
create policy purchase_orders_read on public.purchase_orders for select to authenticated
  using (app_private.purchase_order_reader(branch_id));
create policy purchase_order_lines_read on public.purchase_order_lines for select to authenticated
  using (exists (select 1 from public.purchase_orders o where o.id = order_id and app_private.purchase_order_reader(o.branch_id)));
create policy purchase_order_expected_dates_read on public.purchase_order_expected_dates for select to authenticated
  using (exists (select 1 from public.purchase_orders o where o.id = order_id and app_private.purchase_order_reader(o.branch_id)));
create policy purchase_order_receipts_read on public.purchase_order_receipts for select to authenticated
  using (app_private.purchase_order_reader(branch_id));
create policy purchase_order_receipt_lines_read on public.purchase_order_receipt_lines for select to authenticated
  using (exists (select 1 from public.purchase_order_receipts r where r.id = receipt_id and app_private.purchase_order_reader(r.branch_id)));
create policy purchase_order_cancellations_read on public.purchase_order_cancellations for select to authenticated
  using (exists (select 1 from public.purchase_order_lines l join public.purchase_orders o on o.id = l.order_id
                 where l.id = line_id and app_private.purchase_order_reader(o.branch_id)));
create policy purchase_order_events_read on public.purchase_order_events for select to authenticated
  using (app_private.purchase_order_reader(branch_id));

-- ------------------------------------------------------------------ planning
-- Same-weekday observations of one item in the 13 weeks up to p_d, for weekday p_dow (ISO 1-7).
-- complete: the Product Mix of that date is locked and fully posted; missing: anything else on or
-- after the first live date; before_live: earlier (or no first live date yet). Only complete dates
-- enter the average.
create function app_private.replenishment_observations(p_d date, p_live date, p_complete date[], p_demand jsonb, p_dow integer, p_min integer)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  x date;
  st text;
  dem app_private.rat;
  total app_private.rat := row(0, 1)::app_private.rat;
  n integer := 0;
  missing integer := 0;
  before_live integer := 0;
  dates jsonb := '[]'::jsonb;
  mean app_private.rat;
begin
  for x in select g::date from generate_series(p_d - 90, p_d, interval '1 day') g where extract(isodow from g)::integer = p_dow order by g loop
    if p_live is null or x < p_live then
      st := 'before_live';
      before_live := before_live + 1;
      dates := dates || jsonb_build_object('date', x, 'status', st, 'demand', null);
    elsif x = any(p_complete) then
      st := 'complete';
      dem := case when p_demand ? x::text
                  then row((p_demand -> x::text ->> 'num')::numeric, (p_demand -> x::text ->> 'den')::numeric)::app_private.rat
                  else row(0, 1)::app_private.rat end;
      total := app_private.rat_add(total, dem);
      n := n + 1;
      dates := dates || jsonb_build_object('date', x, 'status', st, 'demand', app_private.rat_json(dem));
    else
      missing := missing + 1;
      dates := dates || jsonb_build_object('date', x, 'status', 'missing', 'demand', null);
    end if;
  end loop;
  mean := case when n > 0 then app_private.rat_make(total.n, total.d * n) end;
  return jsonb_build_object('weekday', p_dow, 'dates', dates, 'complete', n, 'missing', missing, 'before_live', before_live,
    'total', case when n > 0 then app_private.rat_json(total) end,
    'average', case when n > 0 then app_private.rat_json(mean) end,
    'sufficient', p_min is not null and n >= p_min and n > 0,
    'forecast', case when p_min is not null and n >= p_min and n > 0 then app_private.rat_json(mean) end);
end;
$$;

create function app_private.rat_of(j jsonb)
returns app_private.rat language sql immutable set search_path = '' as $$
  select case when j is null or jsonb_typeof(j) = 'null' then null
              else row((j ->> 'num')::numeric, (j ->> 'den')::numeric)::app_private.rat end;
$$;

-- Minutes since the start of the business day (the rollover), for cut-off comparisons.
create function app_private.business_minutes(p_time time, p_rollover time)
returns integer language sql immutable set search_path = '' as $$
  select (((extract(epoch from p_time) - extract(epoch from p_rollover))::integer / 60) % 1440 + 1440) % 1440;
$$;

-- The plan of one item for an order placed at p_now (business date p_d) and received on p_expected
-- (NULL: the default, business date + lead days). No permission check: the callers check.
create function app_private.replenishment_item_plan(
  b public.branches, i public.catalog_items, p_now timestamptz, p_d date, p_expected date, p_cov integer, p_min integer,
  p_live date, p_complete date[], p_detail boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  st public.replenishment_item_settings%rowtype;
  src public.replenishment_source_settings%rowtype;
  lead integer;
  e date;
  demand jsonb;
  book app_private.rat;
  t date;
  k integer;
  o jsonb;
  coverage jsonb := '[]'::jsonb;
  bridge jsonb := '[]'::jsonb;
  incoming jsonb := '[]'::jsonb;
  history jsonb := '[]'::jsonb;
  inc record;
  forecast app_private.rat := row(0, 1)::app_private.rat;
  insufficient boolean := false;
  close_q app_private.rat;
  open_q app_private.rat;
  inc_q app_private.rat;
  f app_private.rat;
  posted_today app_private.rat;
  basis text;
  usable app_private.rat;
  eligible app_private.rat := row(0, 1)::app_private.rat;
  safety app_private.rat;
  raw app_private.rat;
  rec app_private.rat;
  q app_private.rat;
  steps jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  reasons jsonb := '[]'::jsonb;
  packs numeric;
  today_complete boolean := p_d = any(p_complete);
  window_end date;
begin
  select * into st from public.replenishment_item_settings where branch_id = b.id and item_id = i.id;
  select * into src from public.replenishment_source_settings where branch_id = b.id and source = st.source;
  lead := coalesce(src.lead_days, 2);
  e := coalesce(p_expected, p_d + lead);
  window_end := e + p_cov - 1;

  -- Consumption by business date in the window (reversals included), as exact base-unit fractions.
  select coalesce(jsonb_object_agg(x.business_date::text, jsonb_build_object('num', (x.q).n::text, 'den', (x.q).d::text)), '{}'::jsonb)
  into demand
  from (select m.business_date, app_private.rat_sum(row(-m.direction * m.quantity_num, m.quantity_den)::app_private.rat) as q
        from public.stock_movements m
        where m.branch_id = b.id and m.item_id = i.id and m.kind = 'consumption' and m.business_date between p_d - 90 and p_d
        group by m.business_date) x;

  -- Book stock of the order business date: every recorded movement up to it.
  book := (select coalesce(app_private.rat_sum(row(m.direction * m.quantity_num, m.quantity_den)::app_private.rat), row(0, 1)::app_private.rat)
           from public.stock_movements m where m.branch_id = b.id and m.item_id = i.id and m.business_date <= p_d);

  -- Forecast demand of the coverage window.
  for k in 0 .. p_cov - 1 loop
    t := e + k;
    o := app_private.replenishment_observations(p_d, p_live, p_complete, demand, extract(isodow from t)::integer, p_min);
    coverage := coverage || jsonb_build_object('date', t, 'observations', o);
    if (o ->> 'sufficient')::boolean then
      forecast := app_private.rat_add(forecast, app_private.rat_of(o -> 'forecast'));
    else
      insufficient := true;
    end if;
  end loop;

  -- Confirmed incoming: outstanding quantities of approved orders, at their current expected date.
  for inc in
    select o2.id as order_id, o2.order_no, l.id as line_id, l.line_no, l.source,
           (select x.expected_date from public.purchase_order_expected_dates x where x.order_id = o2.id order by x.revision desc limit 1) as expected,
           (select x.expected_date from public.purchase_order_expected_dates x where x.order_id = o2.id and x.revision = 1) as original,
           app_private.po_line_to_base(l, app_private.po_line_outstanding(l.id)) as outstanding
    from public.purchase_order_lines l join public.purchase_orders o2 on o2.id = l.order_id
    where o2.branch_id = b.id and o2.status = 'approved' and l.item_id = i.id
    order by 6, o2.order_no, l.line_no
  loop
    continue when (inc.outstanding).n <= 0;
    incoming := incoming || jsonb_build_object('order', inc.order_id, 'order_no', inc.order_no, 'line', inc.line_id,
      'line_no', inc.line_no, 'source', inc.source, 'expected', inc.expected, 'original_expected', inc.original,
      'overridden', inc.expected is distinct from inc.original, 'outstanding', app_private.rat_json(inc.outstanding),
      'bucket', case when inc.expected < p_d then 'overdue' when inc.expected < e then 'before_receipt'
                     when inc.expected <= window_end then 'window' else 'after_window' end);
    if inc.expected >= e and inc.expected <= window_end then
      eligible := app_private.rat_add(eligible, inc.outstanding);
    end if;
  end loop;

  -- Usable stock at the expected receipt date, day by day from the book stock of the order date.
  -- Incoming expected before the receipt date is added on its day (and counted only there); the
  -- forecast of each day is subtracted when the history supports it; stock never goes below 0.
  close_q := book;
  t := p_d;
  while t < e loop
    inc_q := (select coalesce(app_private.rat_sum(app_private.rat_of(x -> 'outstanding')), row(0, 1)::app_private.rat)
              from jsonb_array_elements(incoming) x where (x ->> 'expected')::date = t);
    open_q := app_private.rat_add(close_q, inc_q);
    o := app_private.replenishment_observations(p_d, p_live, p_complete, demand, extract(isodow from t)::integer, p_min);
    if t = p_d and today_complete then
      basis := 'posted';
      f := row(0, 1)::app_private.rat;
    elsif (o ->> 'sufficient')::boolean then
      f := app_private.rat_of(o -> 'forecast');
      basis := 'forecast';
      if t = p_d then
        -- Today's Product Mix is not (fully) posted: subtract what is still expected today.
        posted_today := coalesce(app_private.rat_of(demand -> p_d::text), row(0, 1)::app_private.rat);
        if posted_today.n <> 0 then basis := 'forecast_remaining'; end if;
        f := app_private.rat_max0(app_private.rat_sub(f, posted_today));
      end if;
    else
      basis := 'unavailable';
      f := null;
    end if;
    close_q := app_private.rat_max0(app_private.rat_sub(open_q, coalesce(f, row(0, 1)::app_private.rat)));
    bridge := bridge || jsonb_build_object('date', t, 'weekday', extract(isodow from t)::integer, 'incoming', app_private.rat_json(inc_q),
      'opening', app_private.rat_json(open_q), 'consumption', app_private.rat_json_or_null(f), 'basis', basis,
      'observations', o, 'closing', app_private.rat_json(close_q));
    if basis = 'unavailable' then
      warnings := warnings || jsonb_build_object('code', 'bridge_unavailable', 'date', t);
    end if;
    t := t + 1;
  end loop;
  usable := close_q;

  if p_detail then
    for k in 1 .. 7 loop
      history := history || app_private.replenishment_observations(p_d, p_live, p_complete, demand, k, p_min);
    end loop;
  end if;

  if p_live is null then reasons := reasons || '"first_live_date_unset"'::jsonb; end if;
  if p_min is null then reasons := reasons || '"minimum_unset"'::jsonb; end if;
  if insufficient and p_live is not null and p_min is not null then reasons := reasons || '"insufficient_history"'::jsonb; end if;

  safety := case when st.safety_num is null then row(0, 1)::app_private.rat else row(st.safety_num, st.safety_den)::app_private.rat end;
  if jsonb_array_length(reasons) = 0 then
    raw := app_private.rat_sub(app_private.rat_sub(app_private.rat_add(forecast, safety), usable), eligible);
    rec := app_private.rat_max0(raw);
    q := rec;
    -- Constraints, after the forecast, only when the branch has confirmed them.
    if q.n > 0 and st.min_order_num is not null
       and app_private.rat_lt(q, row(st.min_order_num, st.min_order_den)::app_private.rat) then
      q := row(st.min_order_num, st.min_order_den)::app_private.rat;
      steps := steps || jsonb_build_object('code', 'supplier_minimum', 'value', app_private.rat_json(q));
    end if;
    if q.n > 0 and st.pack_num is not null then
      packs := div(q.n * st.pack_den + q.d * st.pack_num - 1, q.d * st.pack_num);
      if app_private.rat_make(packs * st.pack_num, st.pack_den) is distinct from q then
        q := app_private.rat_make(packs * st.pack_num, st.pack_den);
        steps := steps || jsonb_build_object('code', 'pack_size', 'pack', app_private.rat_json(row(st.pack_num, st.pack_den)::app_private.rat),
          'packs', packs, 'value', app_private.rat_json(q));
      end if;
    end if;
  end if;
  if st.shelf_life_days is not null and p_cov > st.shelf_life_days then
    warnings := warnings || jsonb_build_object('code', 'coverage_exceeds_shelf_life', 'shelf_life_days', st.shelf_life_days);
  end if;
  if src.cutoff_local is not null and app_private.business_minutes((p_now at time zone b.timezone)::time, b.business_day_rollover)
       > app_private.business_minutes(src.cutoff_local, b.business_day_rollover) then
    warnings := warnings || jsonb_build_object('code', 'after_cutoff', 'cutoff', to_char(src.cutoff_local, 'HH24:MI'));
  end if;

  return jsonb_build_object(
    'item_id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en, 'kind', i.kind, 'base_unit', i.base_unit,
    'status', case when jsonb_array_length(reasons) = 0 then 'recommend' else 'review' end,
    'review_reasons', reasons,
    'source', st.source, 'lead_days', lead, 'lead_rule', case when src.lead_days is null then 'two_day_rule' else 'source_setting' end,
    'order_date', p_d, 'expected', e, 'default_expected', p_d + lead, 'window_end', window_end,
    'today_posted', today_complete,
    'on_hand', app_private.rat_json(book),
    'coverage', coverage,
    'bridge', bridge,
    'usable', app_private.rat_json(usable),
    'incoming', incoming,
    'eligible_incoming', app_private.rat_json(eligible),
    'forecast', case when jsonb_array_length(reasons) = 0 then app_private.rat_json(forecast) end,
    'safety', app_private.rat_json(safety),
    'safety_set', st.safety_num is not null,
    'raw', app_private.rat_json_or_null(raw),
    'recommended', app_private.rat_json_or_null(rec),
    'constraints', steps,
    'suggested', app_private.rat_json_or_null(q),
    'settings', jsonb_build_object(
      'pack', case when st.pack_num is not null then app_private.rat_json(row(st.pack_num, st.pack_den)::app_private.rat) end,
      'min_order', case when st.min_order_num is not null then app_private.rat_json(row(st.min_order_num, st.min_order_den)::app_private.rat) end,
      'shelf_life_days', st.shelf_life_days,
      'cutoff', to_char(src.cutoff_local, 'HH24:MI'),
      'revision', st.revision),
    'warnings', warnings,
    'history', case when p_detail then history end);
end;
$$;

-- Complete observation dates of a branch in the 13 weeks up to p_d, from its first live date.
create function app_private.replenishment_complete_dates(p_branch uuid, p_d date, p_live date)
returns date[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(r.business_date order by r.business_date), '{}'::date[])
  from public.product_mix_reports r
  where r.branch_id = p_branch and r.state = 'locked' and p_live is not null
    and r.business_date between greatest(p_d - 90, p_live) and p_d
    and exists (select 1 from public.product_mix_lines l where l.report_id = r.id)
    and not exists (
      select 1 from public.product_mix_lines l where l.report_id = r.id and not exists (
        select 1 from public.stock_consumption_lines c where c.mix_line_id = l.id
          and not exists (select 1 from public.stock_consumption_reversals x where x.consumption_line_id = c.id)));
$$;

-- The plan of every stock-tracked item (or one), without a permission check.
create function app_private.replenishment_plan_core(b public.branches, p_now timestamptz, p_expected date, p_item uuid, p_detail boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.replenishment_settings%rowtype;
  live date;
  d date := public.business_date_of(p_now, b.timezone, b.business_day_rollover);
  complete date[];
  items jsonb := '[]'::jsonb;
  i public.catalog_items%rowtype;
begin
  if p_expected is not null and (not isfinite(p_expected) or p_expected < d or p_expected > d + 60) then
    raise exception 'The expected receipt date must be on or after the order business date' using errcode = '22023';
  end if;
  select * into s from public.replenishment_settings where branch_id = b.id;
  select c.live_from into live from public.comparison_branch_settings c where c.branch_id = b.id;
  complete := app_private.replenishment_complete_dates(b.id, d, live);
  for i in
    select * from public.catalog_items c
    where c.organization_id = b.organization_id and c.kind <> 'sold' and c.stock_tracked and c.base_unit is not null
      and (p_item is null or c.id = p_item)
      and (p_item is not null or c.status = 'active')
    order by c.kind, c.section_label nulls last, c.name_ar
  loop
    items := items || app_private.replenishment_item_plan(b, i, p_now, d, p_expected, coalesce(s.coverage_days, 1), s.min_observations,
      live, complete, p_detail);
  end loop;
  return jsonb_build_object('branch', b.code, 'order_date', d, 'now_local', to_char(p_now at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI'),
    'rollover', to_char(b.business_day_rollover, 'HH24:MI'), 'timezone', b.timezone,
    'expected', p_expected, 'default_expected', d + 2, 'coverage_days', coalesce(s.coverage_days, 1),
    'min_observations', s.min_observations, 'live_from', live, 'window_from', d - 90, 'window_to', d,
    'complete_dates', to_jsonb(complete), 'items', items);
end;
$$;

create function app_private.replenishment_plan(p_branch text, p_now timestamptz, p_expected date, p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or p_now is null or not app_private.purchase_order_reader(b.id) then
    raise exception 'Replenishment access required' using errcode = '42501';
  end if;
  return app_private.replenishment_plan_core(b, p_now, p_expected, p_item, p_item is not null);
end;
$$;

create function public.app_replenishment_plan(p_branch text, p_expected date default null, p_item uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select app_private.replenishment_plan(p_branch, clock_timestamp(), p_expected, p_item);
$$;

-- ------------------------------------------------------------------ the command
-- p_now is the command's instant. Only the public wrapper (clock time) is open to the API, so a
-- caller can never choose the creation time or the business date.
create function app_private.purchase_order_command(p_branch text, p_command text, p_request uuid, p_payload jsonb, p_now timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
  b public.branches%rowtype;
  o public.purchase_orders%rowtype;
  l public.purchase_order_lines%rowtype;
  i public.catalog_items%rowtype;
  existing public.purchase_order_events%rowtype;
  posting public.stock_postings%rowtype;
  rc public.purchase_order_receipts%rowtype;
  permission text;
  actor text;
  hash bytea;
  d date;
  e date;
  lead integer;
  ln jsonb;
  n integer := 0;
  q app_private.rat;
  base app_private.rat;
  sug app_private.rat;
  plan jsonb;
  s public.replenishment_settings%rowtype;
  live date;
  complete date[];
  reason text := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  out jsonb := '{}'::jsonb;
  cur_expected date;
  cur_rev integer;
  at timestamptz;
  rdate date;
  mv uuid;
  outstanding app_private.rat;
  over_reason text;
  unit text;
  src text;
begin
  if caller is null or p_request is null or p_command is null or p_now is null
     or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 65536 then
    raise exception 'Invalid purchase-order request' using errcode = '22023';
  end if;
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or not app_private.purchase_order_reader(b.id) then
    raise exception 'Purchase-order access required' using errcode = '42501';
  end if;

  -- Each command needs its own permission on this branch.
  permission := case p_command
    when 'create' then 'purchase_order.propose'
    when 'approve' then 'purchase_order.approve'
    when 'reject' then 'purchase_order.approve'
    when 'cancel_rest' then 'purchase_order.approve'
    when 'receive' then 'purchase_order.receive'
    when 'set_expected' then 'set_expected'
    when 'import_legacy' then 'admin.config.manage' end;
  if permission is null then
    raise exception 'Unknown purchase-order command' using errcode = '22023';
  elsif permission = 'set_expected' then
    if not (app_private.has_permission('purchase_order.propose', b.id) or app_private.has_permission('purchase_order.approve', b.id)) then
      raise exception 'Permission purchase_order.propose or purchase_order.approve required' using errcode = '42501';
    end if;
  elsif permission = 'admin.config.manage' then
    if not app_private.has_permission(permission) then
      raise exception 'Permission % required', permission using errcode = '42501';
    end if;
  elsif not app_private.has_permission(permission, b.id) then
    raise exception 'Permission % required', permission using errcode = '42501';
  end if;

  -- One writer per branch at a time (shared with the daily close and stock).
  perform 1 from public.branches where id = b.id for update;
  d := public.business_date_of(p_now, b.timezone, b.business_day_rollover);

  hash := sha256(convert_to(p_command || '|' || p_payload::text, 'UTF8'));
  select * into existing from public.purchase_order_events where branch_id = b.id and request_id = p_request;
  if found then
    if existing.actor_id <> caller or existing.request_hash <> hash then
      raise exception 'Request identifier already used' using errcode = '23505';
    end if;
    -- A retry returns the first result. Nothing new is written.
    return existing.result || jsonb_build_object('replayed', true);
  end if;
  if exists (select 1 from public.stock_postings where branch_id = b.id and request_id = p_request) then
    raise exception 'Request identifier already used' using errcode = '23505';
  end if;

  select e2.full_name into actor from public.staff_accounts s2 join public.employees e2 on e2.id = s2.employee_id where s2.user_id = caller;
  actor := coalesce(actor, 'staff');

  if p_command <> 'create' and p_command <> 'import_legacy' then
    select * into o from public.purchase_orders where branch_id = b.id
      and id::text = lower(coalesce(p_payload ->> 'order', (select l2.order_id::text from public.purchase_order_lines l2
                                                            where l2.id::text = lower(coalesce(p_payload ->> 'line', '')))));
    if o.id is null then
      raise exception 'There is no such purchase order on this branch' using errcode = '22023';
    end if;
    select x.expected_date, x.revision into cur_expected, cur_rev
    from public.purchase_order_expected_dates x where x.order_id = o.id order by x.revision desc limit 1;
  end if;

  -- ---------------------------------------------------------------- create (and legacy import)
  if p_command in ('create', 'import_legacy') then
    if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') not between 1 and 200 then
      raise exception 'An order needs between 1 and 200 lines' using errcode = '22023';
    end if;
    if length(coalesce(p_payload ->> 'note', '')) > 500 then
      raise exception 'Note too long' using errcode = '22023';
    end if;
    if p_command = 'create' then
      -- Default expected receipt: the order business date + two calendar days, unless the branch has
      -- configured another lead time for a source of this order (the longest one applies).
      select coalesce(max(coalesce(ss.lead_days, 2)), 2) into lead
      from jsonb_array_elements(p_payload -> 'lines') x
      left join public.replenishment_source_settings ss on ss.branch_id = b.id and ss.source = x ->> 'source';
      e := d + lead;
      select * into s from public.replenishment_settings where branch_id = b.id;
      select c.live_from into live from public.comparison_branch_settings c where c.branch_id = b.id;
      complete := app_private.replenishment_complete_dates(b.id, d, live);
      insert into public.purchase_orders (organization_id, branch_id, order_no, origin, business_date, created_at, created_local,
        created_by, created_by_name, request_id, status, note)
      values (b.organization_id, b.id, coalesce((select max(order_no) from public.purchase_orders where branch_id = b.id), 0) + 1,
        'app', d, p_now, to_char(p_now at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI'), caller, actor, p_request, 'proposed',
        nullif(btrim(coalesce(p_payload ->> 'note', '')), ''))
      returning * into o;
      insert into public.purchase_order_expected_dates (order_id, revision, expected_date, kind, rule, actor_id, actor_name)
      values (o.id, 1, e, 'default', format('business date %s + %s calendar days', d, lead), caller, actor);
    else
      -- Legacy order sheet (P1-35): SRC-01 Sheet1!C6 is the historical EXPECTED receipt date. The
      -- original cell value is kept as text; the creation date stays blank unless the source has
      -- one; no receipt is ever derived from it.
      if coalesce(p_payload ->> 'expected_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or length(btrim(coalesce(p_payload ->> 'source_value', ''))) not between 1 and 100
         or (nullif(p_payload ->> 'created_date', '') is not null and (p_payload ->> 'created_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
        raise exception 'A legacy order needs its expected date and the original source value' using errcode = '22023';
      end if;
      e := (p_payload ->> 'expected_date')::date;
      insert into public.purchase_orders (organization_id, branch_id, order_no, origin, business_date, created_at, created_local,
        created_by, created_by_name, request_id, status, note, source_file, source_cell)
      values (b.organization_id, b.id, coalesce((select max(order_no) from public.purchase_orders where branch_id = b.id), 0) + 1,
        'legacy', nullif(p_payload ->> 'created_date', '')::date, null, null, caller, actor, p_request, 'historical',
        nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
        coalesce(nullif(p_payload ->> 'source_file', ''), 'SRC-01'), coalesce(nullif(p_payload ->> 'source_cell', ''), 'Sheet1!C6'))
      returning * into o;
      insert into public.purchase_order_expected_dates (order_id, revision, expected_date, kind, rule, source_value, actor_id, actor_name)
      values (o.id, 1, e, 'legacy', 'legacy order sheet date = expected receipt (P1-35)', p_payload ->> 'source_value', caller, actor);
    end if;

    for ln in select x from jsonb_array_elements(p_payload -> 'lines') x loop
      n := n + 1;
      if jsonb_typeof(ln) <> 'object' then raise exception 'Invalid order line' using errcode = '22023'; end if;
      i := app_private.stock_item(b.organization_id, ln ->> 'item');
      -- ORD-02: a numeric quantity above zero. Text such as «،» is refused.
      if coalesce(ln ->> 'quantity', '') !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then
        raise exception 'Line %: enter the quantity as a number', n using errcode = '22023';
      end if;
      q := app_private.parse_rational(ln ->> 'quantity');
      if q is null then raise exception 'Line %: the quantity must be above zero', n using errcode = '22023'; end if;
      src := ln ->> 'source';
      if src is null or src not in ('factory', 'store') then
        raise exception 'Line %: choose the source (factory or store)', n using errcode = '22023';
      end if;
      unit := coalesce(nullif(ln ->> 'unit', ''), i.base_unit);
      base := app_private.stock_to_base(i, q, unit);
      sug := null;
      plan := null;
      if p_command = 'create' and coalesce((ln ->> 'from_plan')::boolean, false) then
        plan := app_private.replenishment_item_plan(b, i, p_now, d, e, coalesce(s.coverage_days, 1), s.min_observations, live, complete, false);
        if plan ->> 'status' = 'recommend' then
          sug := app_private.rat_of(plan -> 'suggested');
          -- The person saw a suggestion when the page was rendered; refuse when it has changed since.
          if nullif(ln ->> 'expected_suggested', '') is not null
             and ln ->> 'expected_suggested' <> (trim_scale(sug.n)::text || '/' || trim_scale(sug.d)::text) then
            raise exception 'Line %: the suggestion has changed; review it again', n using errcode = 'CT802';
          end if;
        else
          -- Review state: no recommendation, the line is a manual line.
          plan := null;
        end if;
      end if;
      if sug is not null and not app_private.rat_eq(sug, base) and nullif(btrim(coalesce(ln ->> 'override_reason', '')), '') is null then
        raise exception 'Line %: the final quantity differs from the suggestion; give a reason', n using errcode = 'CT804';
      end if;
      insert into public.purchase_order_lines (order_id, line_no, item_id, source, unit, quantity_text, quantity_num, quantity_den,
        base_unit, base_num, base_den, suggested_num, suggested_den, plan, override_reason)
      values (o.id, n, i.id, src, unit, ln ->> 'quantity', q.n, q.d, i.base_unit, base.n, base.d, sug.n, sug.d, plan,
        case when sug is not null and not app_private.rat_eq(sug, base) then left(btrim(ln ->> 'override_reason'), 500) end);
    end loop;
    out := jsonb_build_object('order', o.id, 'order_no', o.order_no, 'business_date', o.business_date, 'expected', e, 'lines', n,
      'status', o.status);

  -- ---------------------------------------------------------------- approve / reject
  elsif p_command in ('approve', 'reject') then
    if o.status <> 'proposed' then
      raise exception 'Only a proposed order can be approved or rejected' using errcode = 'CT803';
    end if;
    if p_command = 'reject' and reason is null then
      raise exception 'A rejection needs a reason' using errcode = '22023';
    end if;
    update public.purchase_orders set status = case when p_command = 'approve' then 'approved' else 'rejected' end,
      decided_by = caller, decided_by_name = actor, decided_at = p_now, decision_note = left(reason, 500)
    where id = o.id returning * into o;
    out := jsonb_build_object('order', o.id, 'order_no', o.order_no, 'status', o.status);

  -- ---------------------------------------------------------------- expected receipt date override
  elsif p_command = 'set_expected' then
    if o.status not in ('proposed', 'approved')
       or not exists (select 1 from public.purchase_order_lines l2 where l2.order_id = o.id and (app_private.po_line_outstanding(l2.id)).n > 0) then
      raise exception 'The expected date of a closed, rejected or historical order cannot change' using errcode = 'CT803';
    end if;
    if coalesce(p_payload ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or reason is null then
      raise exception 'A new expected date and a reason are required' using errcode = '22023';
    end if;
    e := (p_payload ->> 'date')::date;
    if e < o.business_date or e > o.business_date + 60 or e = cur_expected then
      raise exception 'Choose a different expected date on or after the order business date' using errcode = '22023';
    end if;
    insert into public.purchase_order_expected_dates (order_id, revision, expected_date, kind, reason, actor_id, actor_name)
    values (o.id, cur_rev + 1, e, 'override', left(reason, 500), caller, actor);
    out := jsonb_build_object('order', o.id, 'order_no', o.order_no, 'expected', e, 'previous', cur_expected, 'revision', cur_rev + 1);

  -- ---------------------------------------------------------------- receiving
  elsif p_command = 'receive' then
    if o.status <> 'approved' then
      raise exception 'Only an approved order can be received' using errcode = 'CT803';
    end if;
    if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') not between 1 and 200
       or length(coalesce(p_payload ->> 'reference', '')) > 100 or length(coalesce(p_payload ->> 'note', '')) > 500 then
      raise exception 'Enter the received quantities' using errcode = '22023';
    end if;
    -- The actual receipt date comes only from this evidence: the local time the goods arrived.
    at := app_private.operating_local_instant(p_payload ->> 'local', b.timezone);
    if at > p_now or at < date_trunc('minute', o.created_at) then
      raise exception 'The receipt time must be after the order and not in the future' using errcode = '22023';
    end if;
    rdate := public.business_date_of(at, b.timezone, b.business_day_rollover);
    insert into public.stock_postings (organization_id, branch_id, business_date, command, request_id, request_hash, actor_id, actor_name, reason)
    values (b.organization_id, b.id, rdate, 'po_receipt', p_request, hash, caller, actor, null)
    returning * into posting;
    insert into public.purchase_order_receipts (organization_id, branch_id, order_id, posting_id, business_date, received_local, received_at,
      reference, note, actor_id, actor_name)
    values (b.organization_id, b.id, o.id, posting.id, rdate, p_payload ->> 'local', at,
      nullif(btrim(coalesce(p_payload ->> 'reference', '')), ''), nullif(btrim(coalesce(p_payload ->> 'note', '')), ''), caller, actor)
    returning * into rc;
    for ln in select x from jsonb_array_elements(p_payload -> 'lines') x loop
      continue when jsonb_typeof(ln) = 'object' and btrim(coalesce(ln ->> 'quantity', '')) = '';
      select * into l from public.purchase_order_lines where order_id = o.id and id::text = lower(coalesce(ln ->> 'line', ''));
      if l.id is null then raise exception 'The line is not on this order' using errcode = '22023'; end if;
      if coalesce(ln ->> 'quantity', '') !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then
        raise exception 'Line %: enter the received quantity as a number', l.line_no using errcode = '22023';
      end if;
      q := app_private.parse_rational(ln ->> 'quantity');
      if q is null then raise exception 'Line %: the received quantity must be above zero', l.line_no using errcode = '22023'; end if;
      select * into i from public.catalog_items where id = l.item_id;
      if exists (select 1 from public.stock_movements m where m.branch_id = b.id and m.item_id = i.id
                 and m.kind = 'opening' and m.business_date > rdate) then
        raise exception 'The opening stock of this item starts later' using errcode = '22023';
      end if;
      over_reason := nullif(btrim(coalesce(ln ->> 'over_receipt_reason', '')), '');
      base := app_private.po_line_to_base(l, q);
      insert into public.stock_movements (organization_id, branch_id, business_date, posting_id, item_id, kind, direction,
        quantity_num, quantity_den, base_unit, entered_quantity, entered_unit, occurred_local, occurred_at, source, reference, note)
      values (b.organization_id, b.id, rdate, posting.id, i.id, 'receipt', 1, base.n, base.d, i.base_unit, ln ->> 'quantity', l.unit,
        p_payload ->> 'local', at, 'purchase_order', left(format('PO-%s/%s', o.order_no, l.line_no) ||
          coalesce(' ' || nullif(btrim(coalesce(p_payload ->> 'reference', '')), ''), ''), 100), left(over_reason, 500))
      returning id into mv;
      insert into public.purchase_order_receipt_lines (receipt_id, line_id, quantity_text, quantity_num, quantity_den, movement_id, over_receipt_reason)
      values (rc.id, l.id, ln ->> 'quantity', q.n, q.d, mv, left(over_reason, 500));
      n := n + 1;
    end loop;
    if n = 0 then raise exception 'Enter at least one received quantity' using errcode = '22023'; end if;
    out := jsonb_build_object('order', o.id, 'order_no', o.order_no, 'receipt', rc.id, 'posting', posting.id,
      'business_date', rdate, 'movements', n);

  -- ---------------------------------------------------------------- cancel the unreceived rest
  elsif p_command = 'cancel_rest' then
    select * into l from public.purchase_order_lines where order_id = o.id and id::text = lower(coalesce(p_payload ->> 'line', ''));
    if l.id is null or reason is null then
      raise exception 'Choose a line and give a reason' using errcode = '22023';
    end if;
    outstanding := app_private.po_line_outstanding(l.id);
    if outstanding.n <= 0 then
      raise exception 'Nothing is outstanding on this line' using errcode = 'CT803';
    end if;
    insert into public.purchase_order_cancellations (line_id, quantity_num, quantity_den, reason, actor_id, actor_name)
    values (l.id, outstanding.n, outstanding.d, left(reason, 500), caller, actor);
    out := jsonb_build_object('order', o.id, 'order_no', o.order_no, 'line', l.id, 'cancelled', app_private.rat_json(outstanding));
  end if;

  out := out || jsonb_build_object('command', p_command, 'replayed', false);
  insert into public.purchase_order_events (organization_id, branch_id, order_id, command, request_id, request_hash, actor_id, actor_name,
    business_date, happened_at, reason, result)
  values (b.organization_id, b.id, o.id, p_command, p_request, hash, caller, actor, d, p_now, reason, out);
  perform app_private.write_audit(b.organization_id, 'operation', 'purchase_order.' || p_command, 'purchase_order', o.id::text,
    'PO-' || o.order_no, b.id, jsonb_build_object('payload', p_payload - 'reason', 'reason', reason, 'business_date', d) || out);
  return out;
end;
$$;

create function public.app_purchase_order_command(p_branch text, p_command text, p_request uuid, p_payload jsonb)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select app_private.purchase_order_command(p_branch, p_command, p_request, p_payload, clock_timestamp());
$$;

-- ------------------------------------------------------------------ reads
create function app_private.purchase_order_json(o public.purchase_orders, p_detail boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'order_no', o.order_no, 'origin', o.origin, 'status', o.status,
    'business_date', o.business_date, 'created_at', o.created_at, 'created_local', o.created_local,
    'created_by', o.created_by_name, 'decided_by', o.decided_by_name, 'decided_at', o.decided_at, 'decided_local', to_char(o.decided_at at time zone (select b.timezone from public.branches b where b.id = o.branch_id), 'YYYY-MM-DD"T"HH24:MI'), 'decision_note', o.decision_note,
    'note', o.note, 'source_file', o.source_file, 'source_cell', o.source_cell,
    'original_expected', (select jsonb_build_object('date', x.expected_date, 'kind', x.kind, 'rule', x.rule, 'source_value', x.source_value)
                          from public.purchase_order_expected_dates x where x.order_id = o.id and x.revision = 1),
    'expected', (select jsonb_build_object('date', x.expected_date, 'kind', x.kind, 'revision', x.revision, 'reason', x.reason)
                 from public.purchase_order_expected_dates x where x.order_id = o.id order by x.revision desc limit 1),
    'receipt_dates', coalesce((select jsonb_agg(distinct r.business_date order by r.business_date)
                               from public.purchase_order_receipts r where r.order_id = o.id), '[]'::jsonb),
    'lines_count', (select count(*) from public.purchase_order_lines l where l.order_id = o.id),
    'open_lines', (select count(*) from public.purchase_order_lines l where l.order_id = o.id and (app_private.po_line_outstanding(l.id)).n > 0),
    'lines', case when p_detail then coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'line_no', l.line_no, 'item_id', l.item_id, 'name_ar', c.name_ar, 'name_en', c.name_en, 'source', l.source,
        'unit', l.unit, 'quantity', l.quantity_text, 'final', app_private.rat_json(row(l.quantity_num, l.quantity_den)::app_private.rat),
        'base_unit', l.base_unit, 'final_base', app_private.rat_json(row(l.base_num, l.base_den)::app_private.rat),
        'suggested', case when l.suggested_num is not null then app_private.rat_json(row(l.suggested_num, l.suggested_den)::app_private.rat) end,
        'override_reason', l.override_reason, 'plan', l.plan,
        'received', app_private.rat_json(app_private.po_line_received(l.id)),
        'cancelled', app_private.rat_json(app_private.po_line_cancelled(l.id)),
        'outstanding', app_private.rat_json(app_private.po_line_outstanding(l.id)),
        'cancellations', coalesce((select jsonb_agg(jsonb_build_object('quantity', app_private.rat_json(row(x.quantity_num, x.quantity_den)::app_private.rat),
            'reason', x.reason, 'actor', x.actor_name, 'at', x.recorded_at, 'local', to_char(x.recorded_at at time zone (select b.timezone from public.branches b where b.id = o.branch_id), 'YYYY-MM-DD"T"HH24:MI')) order by x.recorded_at)
          from public.purchase_order_cancellations x where x.line_id = l.id), '[]'::jsonb)
      ) order by l.line_no) from public.purchase_order_lines l join public.catalog_items c on c.id = l.item_id where l.order_id = o.id), '[]'::jsonb) end,
    'dates', case when p_detail then coalesce((select jsonb_agg(jsonb_build_object('revision', x.revision, 'date', x.expected_date,
        'kind', x.kind, 'rule', x.rule, 'reason', x.reason, 'source_value', x.source_value, 'actor', x.actor_name, 'at', x.recorded_at,
        'local', to_char(x.recorded_at at time zone (select b.timezone from public.branches b where b.id = o.branch_id), 'YYYY-MM-DD"T"HH24:MI'))
        order by x.revision) from public.purchase_order_expected_dates x where x.order_id = o.id), '[]'::jsonb) end,
    'receipts', case when p_detail then coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'business_date', r.business_date,
        'local', r.received_local, 'reference', r.reference, 'note', r.note, 'actor', r.actor_name, 'posting', r.posting_id,
        'lines', (select jsonb_agg(jsonb_build_object('line', rl.line_id, 'quantity', rl.quantity_text, 'movement', rl.movement_id,
                    'over_receipt_reason', rl.over_receipt_reason) order by rl.id)
                  from public.purchase_order_receipt_lines rl where rl.receipt_id = r.id)) order by r.received_at, r.recorded_at)
      from public.purchase_order_receipts r where r.order_id = o.id), '[]'::jsonb) end,
    'events', case when p_detail then coalesce((select jsonb_agg(jsonb_build_object('command', ev.command, 'actor', ev.actor_name,
        'business_date', ev.business_date, 'at', ev.happened_at, 'local', to_char(ev.happened_at at time zone (select b.timezone from public.branches b where b.id = o.branch_id), 'YYYY-MM-DD"T"HH24:MI'), 'reason', ev.reason) order by ev.id)
      from public.purchase_order_events ev where ev.order_id = o.id), '[]'::jsonb) end);
$$;

create function public.app_purchase_orders(p_branch text, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or not app_private.purchase_order_reader(b.id) then
    raise exception 'Purchase-order access required' using errcode = '42501';
  end if;
  return jsonb_build_object('branch', b.code,
    'today', public.business_date_of(clock_timestamp(), b.timezone, b.business_day_rollover),
    'local', to_char(clock_timestamp() at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI'),
    'orders', coalesce((select jsonb_agg(app_private.purchase_order_json(o, false) order by o.order_no desc)
      from public.purchase_orders o where o.id in (select x.id from public.purchase_orders x where x.branch_id = b.id
            order by x.order_no desc limit least(greatest(coalesce(p_limit, 100), 1), 500))), '[]'::jsonb));
end;
$$;

create function public.app_purchase_order(p_branch text, p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
  o public.purchase_orders%rowtype;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or not app_private.purchase_order_reader(b.id) then
    raise exception 'Purchase-order access required' using errcode = '42501';
  end if;
  select * into o from public.purchase_orders where id = p_order and branch_id = b.id;
  if o.id is null then return null; end if;
  return app_private.purchase_order_json(o, true) || jsonb_build_object(
    'today', public.business_date_of(clock_timestamp(), b.timezone, b.business_day_rollover),
    'local', to_char(clock_timestamp() at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI'));
end;
$$;

-- ------------------------------------------------------------------ settings
create function public.app_replenishment_settings(p_branch text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
  s public.replenishment_settings%rowtype;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or not (app_private.purchase_order_reader(b.id) or app_private.has_permission('admin.config.manage')) then
    raise exception 'Replenishment access required' using errcode = '42501';
  end if;
  select * into s from public.replenishment_settings where branch_id = b.id;
  return jsonb_build_object('branch', b.code,
    'min_observations', s.min_observations, 'coverage_days', coalesce(s.coverage_days, 1), 'revision', coalesce(s.revision, 0),
    'live_from', (select c.live_from from public.comparison_branch_settings c where c.branch_id = b.id),
    'sources', (select jsonb_agg(jsonb_build_object('source', v.source, 'lead_days', ss.lead_days, 'cutoff', to_char(ss.cutoff_local, 'HH24:MI'),
                  'revision', coalesce(ss.revision, 0)) order by v.source)
                from (values ('factory'), ('store')) v(source)
                left join public.replenishment_source_settings ss on ss.branch_id = b.id and ss.source = v.source),
    'items', coalesce((select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'name_ar', c.name_ar, 'name_en', c.name_en,
        'base_unit', c.base_unit,
        'safety', case when x.safety_num is not null then app_private.rat_json(row(x.safety_num, x.safety_den)::app_private.rat) end,
        'pack', case when x.pack_num is not null then app_private.rat_json(row(x.pack_num, x.pack_den)::app_private.rat) end,
        'min_order', case when x.min_order_num is not null then app_private.rat_json(row(x.min_order_num, x.min_order_den)::app_private.rat) end,
        'shelf_life_days', x.shelf_life_days, 'source', x.source, 'revision', x.revision) order by c.name_ar)
      from public.replenishment_item_settings x join public.catalog_items c on c.id = x.item_id where x.branch_id = b.id), '[]'::jsonb));
end;
$$;

create function public.app_replenishment_settings_save(p_branch text, p_expected integer, p_min_observations integer, p_coverage_days integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
  s public.replenishment_settings%rowtype;
  v_before jsonb;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or not app_private.has_permission('admin.config.manage') then
    raise exception 'Configuration permission required' using errcode = '42501';
  end if;
  if p_expected is null or p_coverage_days is null or p_coverage_days not between 1 and 14
     or (p_min_observations is not null and p_min_observations not between 1 and 13) then
    raise exception 'Invalid replenishment settings' using errcode = '22023';
  end if;
  perform 1 from public.branches where id = b.id for update;
  select * into s from public.replenishment_settings where branch_id = b.id;
  if coalesce(s.revision, 0) <> p_expected then
    raise exception 'Replenishment settings have changed' using errcode = '40001';
  end if;
  v_before := jsonb_build_object('min_observations', s.min_observations, 'coverage_days', coalesce(s.coverage_days, 1));
  if s.branch_id is null then
    insert into public.replenishment_settings (branch_id, min_observations, coverage_days, updated_by)
    values (b.id, p_min_observations, p_coverage_days, auth.uid()) returning * into s;
  else
    update public.replenishment_settings set min_observations = p_min_observations, coverage_days = p_coverage_days,
      revision = revision + 1, updated_by = auth.uid(), updated_at = now() where branch_id = b.id returning * into s;
  end if;
  perform app_private.write_audit(b.organization_id, 'administration', 'replenishment.settings_changed', 'replenishment_settings',
    b.id::text, b.code, b.id, jsonb_build_object('before', v_before,
      'after', jsonb_build_object('min_observations', s.min_observations, 'coverage_days', s.coverage_days), 'revision', s.revision));
  return jsonb_build_object('revision', s.revision);
end;
$$;

-- Item constraints in the item's base unit. A blank value is "not confirmed"; "0" is accepted for
-- safety stock only.
create function public.app_replenishment_item_settings_save(
  p_branch text, p_item uuid, p_expected integer, p_safety text, p_pack text, p_min_order text, p_shelf_life_days integer, p_source text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
  i public.catalog_items%rowtype;
  s public.replenishment_item_settings%rowtype;
  safety app_private.rat;
  pack app_private.rat;
  minq app_private.rat;
  v_before jsonb;
  v_after jsonb;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or not app_private.has_permission('admin.config.manage') then
    raise exception 'Configuration permission required' using errcode = '42501';
  end if;
  i := app_private.stock_item(b.organization_id, p_item::text);
  safety := case when nullif(btrim(coalesce(p_safety, '')), '') is not null then app_private.parse_count(p_safety) end;
  pack := case when nullif(btrim(coalesce(p_pack, '')), '') is not null then app_private.parse_rational(
            case when p_pack ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then p_pack end) end;
  minq := case when nullif(btrim(coalesce(p_min_order, '')), '') is not null then app_private.parse_rational(
            case when p_min_order ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then p_min_order end) end;
  if p_expected is null
     or (nullif(btrim(coalesce(p_safety, '')), '') is not null and safety is null)
     or (nullif(btrim(coalesce(p_pack, '')), '') is not null and pack is null)
     or (nullif(btrim(coalesce(p_min_order, '')), '') is not null and minq is null)
     or (p_shelf_life_days is not null and p_shelf_life_days not between 1 and 3650)
     or (p_source is not null and p_source not in ('factory', 'store')) then
    raise exception 'Invalid item settings' using errcode = '22023';
  end if;
  perform 1 from public.branches where id = b.id for update;
  select * into s from public.replenishment_item_settings where branch_id = b.id and item_id = i.id;
  if coalesce(s.revision, 0) <> p_expected then
    raise exception 'Item settings have changed' using errcode = '40001';
  end if;
  v_before := case when s.item_id is null then null else jsonb_build_object('safety', s.safety_num || '/' || s.safety_den,
    'pack', s.pack_num || '/' || s.pack_den, 'min_order', s.min_order_num || '/' || s.min_order_den,
    'shelf_life_days', s.shelf_life_days, 'source', s.source) end;
  if s.item_id is null then
    insert into public.replenishment_item_settings (branch_id, item_id, safety_num, safety_den, pack_num, pack_den, min_order_num, min_order_den,
      shelf_life_days, source, updated_by)
    values (b.id, i.id, safety.n, safety.d, pack.n, pack.d, minq.n, minq.d, p_shelf_life_days, p_source, auth.uid()) returning * into s;
  else
    update public.replenishment_item_settings set safety_num = safety.n, safety_den = safety.d, pack_num = pack.n, pack_den = pack.d,
      min_order_num = minq.n, min_order_den = minq.d, shelf_life_days = p_shelf_life_days, source = p_source,
      revision = revision + 1, updated_by = auth.uid(), updated_at = now()
    where branch_id = b.id and item_id = i.id returning * into s;
  end if;
  v_after := jsonb_build_object('safety', s.safety_num || '/' || s.safety_den, 'pack', s.pack_num || '/' || s.pack_den,
    'min_order', s.min_order_num || '/' || s.min_order_den, 'shelf_life_days', s.shelf_life_days, 'source', s.source);
  perform app_private.write_audit(b.organization_id, 'administration', 'replenishment.item_settings_changed', 'catalog_item',
    i.id::text, i.name_ar, b.id, jsonb_build_object('before', v_before, 'after', v_after, 'revision', s.revision));
  return jsonb_build_object('revision', s.revision);
end;
$$;

create function public.app_replenishment_source_settings_save(p_branch text, p_source text, p_expected integer, p_lead_days integer, p_cutoff text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
  s public.replenishment_source_settings%rowtype;
  cutoff time;
  v_before jsonb;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or not app_private.has_permission('admin.config.manage') then
    raise exception 'Configuration permission required' using errcode = '42501';
  end if;
  if p_expected is null or p_source is null or p_source not in ('factory', 'store')
     or (p_lead_days is not null and p_lead_days not between 0 and 14)
     or (nullif(p_cutoff, '') is not null and p_cutoff !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'Invalid source settings' using errcode = '22023';
  end if;
  cutoff := nullif(p_cutoff, '')::time;
  perform 1 from public.branches where id = b.id for update;
  select * into s from public.replenishment_source_settings where branch_id = b.id and source = p_source;
  if coalesce(s.revision, 0) <> p_expected then
    raise exception 'Source settings have changed' using errcode = '40001';
  end if;
  v_before := jsonb_build_object('lead_days', s.lead_days, 'cutoff', to_char(s.cutoff_local, 'HH24:MI'));
  if s.branch_id is null then
    insert into public.replenishment_source_settings (branch_id, source, lead_days, cutoff_local, updated_by)
    values (b.id, p_source, p_lead_days, cutoff, auth.uid()) returning * into s;
  else
    update public.replenishment_source_settings set lead_days = p_lead_days, cutoff_local = cutoff, revision = revision + 1,
      updated_by = auth.uid(), updated_at = now() where branch_id = b.id and source = p_source returning * into s;
  end if;
  perform app_private.write_audit(b.organization_id, 'administration', 'replenishment.source_settings_changed', 'replenishment_source',
    p_source, p_source, b.id, jsonb_build_object('before', v_before,
      'after', jsonb_build_object('lead_days', s.lead_days, 'cutoff', to_char(s.cutoff_local, 'HH24:MI')), 'revision', s.revision));
  return jsonb_build_object('revision', s.revision);
end;
$$;

-- ------------------------------------------------------------------ grants
-- The internal functions take the command instant; only the public wrappers (clock time) are open.
revoke all on function
  app_private.rat_lt(app_private.rat, app_private.rat),
  app_private.rat_eq(app_private.rat, app_private.rat),
  app_private.rat_max0(app_private.rat),
  app_private.rat_of(jsonb),
  app_private.business_minutes(time, time),
  app_private.refuse_purchase_order_change(),
  app_private.purchase_order_guard(),
  app_private.po_line_received(uuid),
  app_private.po_line_cancelled(uuid),
  app_private.po_line_outstanding(uuid),
  app_private.po_line_to_base(public.purchase_order_lines, app_private.rat),
  app_private.purchase_order_receipt_line_guard(),
  app_private.purchase_order_cancellation_guard(),
  app_private.purchase_order_movement_has_receipt(),
  app_private.purchase_order_reader(uuid),
  app_private.replenishment_observations(date, date, date[], jsonb, integer, integer),
  app_private.replenishment_item_plan(public.branches, public.catalog_items, timestamptz, date, date, integer, integer, date, date[], boolean),
  app_private.replenishment_complete_dates(uuid, date, date),
  app_private.replenishment_plan_core(public.branches, timestamptz, date, uuid, boolean),
  app_private.replenishment_plan(text, timestamptz, date, uuid),
  app_private.purchase_order_command(text, text, uuid, jsonb, timestamptz),
  app_private.purchase_order_json(public.purchase_orders, boolean),
  public.app_replenishment_plan(text, date, uuid),
  public.app_purchase_order_command(text, text, uuid, jsonb),
  public.app_purchase_orders(text, integer),
  public.app_purchase_order(text, uuid),
  public.app_replenishment_settings(text),
  public.app_replenishment_settings_save(text, integer, integer, integer),
  public.app_replenishment_item_settings_save(text, uuid, integer, text, text, text, integer, text),
  public.app_replenishment_source_settings_save(text, text, integer, integer, text)
from public, anon, authenticated, service_role;

-- Policies call this one as the signed-in person.
grant execute on function app_private.purchase_order_reader(uuid) to authenticated;

grant execute on function
  public.app_replenishment_plan(text, date, uuid),
  public.app_purchase_order_command(text, text, uuid, jsonb),
  public.app_purchase_orders(text, integer),
  public.app_purchase_order(text, uuid),
  public.app_replenishment_settings(text),
  public.app_replenishment_settings_save(text, integer, integer, integer),
  public.app_replenishment_item_settings_save(text, uuid, integer, text, text, text, integer, text),
  public.app_replenishment_source_settings_save(text, text, integer, integer, text)
to authenticated;
