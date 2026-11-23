-- Phase 6. Product Mix, typed stock movements, recipe consumption, physical counts and variance.
--
-- Every write goes through app_private.stock_command: one transaction checks the person, branch,
-- permission and request identifier, serializes on the branch, writes append-only rows and the audit
-- entry. A retried request returns its first result and never adds a second movement.
-- Quantities are exact fractions in the item's base unit (Phase 5 arithmetic); nothing is a float.
-- Consumption posts only through an approved recipe version that is valid on the business date; the
-- posting keeps that version, each recipe line and the exact quantity, and is never recomputed.

-- ------------------------------------------------------------------ permission
insert into public.permissions (key, description, scope, branch_kind) values
  ('inventory.consume', 'Enter the Product Mix and post recipe consumption (Phase 6)', 'branch', 'operational');

insert into public.group_permissions (group_key, permission_key) values
  ('system_admin', 'inventory.consume'),
  ('storekeeper', 'inventory.consume'),
  ('manager', 'inventory.consume');

-- ------------------------------------------------------------------ exact sums
create function app_private.rat_sum_step(state app_private.rat, value app_private.rat)
returns app_private.rat language sql immutable set search_path = '' as $$
  select case when value is null then state when state is null then value else app_private.rat_add(state, value) end;
$$;
create aggregate app_private.rat_sum(app_private.rat) (sfunc = app_private.rat_sum_step, stype = app_private.rat);

create function app_private.rat_sub(a app_private.rat, b app_private.rat)
returns app_private.rat language sql immutable set search_path = '' as $$
  select app_private.rat_make(a.n * b.d - b.n * a.d, a.d * b.d);
$$;

-- Signed fraction as {"num","den","decimal","exact"}; NULL stays NULL.
create function app_private.rat_json_or_null(a app_private.rat)
returns jsonb language sql immutable set search_path = '' as $$
  select case when a is null or a.n is null then null else app_private.rat_json(a) end;
$$;

-- "0", "0.0" and positive amounts typed by a person (counts may be an explicit zero).
create function app_private.parse_count(p_text text)
returns app_private.rat language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(p_text, '')) ~ '^0+(\.0+)?$' then row(0, 1)::app_private.rat
              when btrim(coalesce(p_text, '')) ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then app_private.parse_rational(p_text) end;
$$;

-- ------------------------------------------------------------------ postings (one per accepted request)
create table public.stock_postings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  command text not null,
  request_id uuid not null,
  request_hash bytea not null,
  actor_id uuid not null references public.staff_accounts (user_id),
  actor_name text not null,
  reason text,
  reverses_posting_id uuid references public.stock_postings (id),
  posted_at timestamptz not null default clock_timestamp(),
  unique (branch_id, request_id)
);
create unique index stock_postings_one_reversal_idx on public.stock_postings (reverses_posting_id) where reverses_posting_id is not null;
create index stock_postings_branch_date_idx on public.stock_postings (branch_id, business_date);

-- ------------------------------------------------------------------ Product Mix
create table public.product_mix_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  -- Net sales printed on the Foodics report, in centimes. Every line amount must add up to it.
  net_sales bigint not null check (net_sales >= 0 and net_sales <= 99999999999999),
  -- Time printed on the report; the consumption it posts happens at this instant.
  reported_local text not null,
  reported_at timestamptz not null,
  state text not null default 'draft' check (state in ('draft', 'locked')),
  version integer not null default 1,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (branch_id, business_date),
  unique (id, branch_id)
);

-- A section total from the report. It is a check figure, never a sold line.
create table public.product_mix_sections (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.product_mix_reports (id),
  section_no integer not null check (section_no > 0),
  label text not null check (length(btrim(label)) between 1 and 120),
  label_key text generated always as (app_private.catalog_label_key(label)) stored,
  total_amount bigint not null check (total_amount >= 0 and total_amount <= 99999999999999),
  unique (report_id, section_no),
  unique (report_id, label_key)
);

create table public.product_mix_lines (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.product_mix_reports (id),
  section_id uuid not null references public.product_mix_sections (id),
  line_no integer not null check (line_no > 0),
  label text not null check (length(btrim(label)) between 1 and 200),
  label_key text generated always as (app_private.catalog_label_key(label)) stored,
  quantity_text text not null check (quantity_text ~ '^[0-9]{1,9}(\.[0-9]{1,3})?$'),
  quantity_num numeric not null check (quantity_num > 0),
  quantity_den numeric not null check (quantity_den > 0),
  amount bigint not null check (amount >= 0 and amount <= 99999999999999),
  -- A name appears once per section: an overlapping photo portion cannot add the same line twice.
  unique (section_id, label_key),
  unique (report_id, line_no)
);

-- ------------------------------------------------------------------ consumption, movements, counts, adjustments
create table public.stock_consumption_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  posting_id uuid not null references public.stock_postings (id),
  mix_line_id uuid not null references public.product_mix_lines (id),
  attempt integer not null check (attempt > 0),
  product_id uuid not null references public.catalog_items (id),
  mapping_id uuid references public.catalog_source_labels (id),
  recipe_version_id uuid not null references public.recipe_versions (id),
  recipe_version_no integer not null,
  sold_quantity_num numeric not null,
  sold_quantity_den numeric not null,
  -- The eligibility result as posted, components that are not stock-tracked included.
  components jsonb not null check (jsonb_typeof(components) = 'array'),
  unique (mix_line_id, attempt)
);
create index stock_consumption_lines_version_idx on public.stock_consumption_lines (recipe_version_id, business_date);

create table public.stock_consumption_reversals (
  consumption_line_id uuid primary key references public.stock_consumption_lines (id),
  posting_id uuid not null references public.stock_postings (id)
);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  posting_id uuid not null references public.stock_postings (id),
  item_id uuid not null references public.catalog_items (id),
  counted_local text not null,
  counted_at timestamptz not null,
  -- An explicit zero is a count (0/1). A blank count is the absence of a row.
  quantity_num numeric not null check (quantity_num >= 0),
  quantity_den numeric not null check (quantity_den > 0),
  base_unit text not null references public.catalog_units (code),
  entered_quantity text not null,
  entered_unit text not null references public.catalog_units (code),
  note text,
  replaces_id uuid references public.stock_counts (id)
);
create index stock_counts_item_idx on public.stock_counts (branch_id, item_id, business_date);

create table public.stock_count_voids (
  count_id uuid primary key references public.stock_counts (id),
  posting_id uuid not null references public.stock_postings (id),
  reason text not null check (length(btrim(reason)) between 1 and 500)
);

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  item_id uuid not null references public.catalog_items (id),
  direction smallint not null check (direction in (-1, 1)),
  quantity_num numeric not null check (quantity_num > 0),
  quantity_den numeric not null check (quantity_den > 0),
  occurred_local text not null,
  occurred_at timestamptz not null,
  count_id uuid references public.stock_counts (id),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  proposed_posting_id uuid not null references public.stock_postings (id),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  decided_posting_id uuid references public.stock_postings (id),
  decision_note text,
  check ((status = 'proposed') = (decided_posting_id is null))
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  posting_id uuid not null references public.stock_postings (id),
  item_id uuid not null references public.catalog_items (id),
  kind text not null check (kind in ('opening', 'receipt', 'purchase', 'transfer_in', 'return', 'consumption',
    'waste', 'hospitality', 'deduction', 'transfer_out', 'adjustment')),
  direction smallint not null check (direction in (-1, 1)),
  -- Magnitude in the item's base unit; the sign is the direction.
  quantity_num numeric not null check (quantity_num > 0 and quantity_num = trunc(quantity_num)),
  quantity_den numeric not null check (quantity_den > 0 and quantity_den = trunc(quantity_den)),
  check (gcd(quantity_num, quantity_den) = 1),
  base_unit text not null references public.catalog_units (code),
  entered_quantity text,
  entered_unit text references public.catalog_units (code),
  occurred_local text not null,
  occurred_at timestamptz not null,
  source text not null check (source in ('manual', 'product_mix', 'adjustment', 'opening', 'reversal')),
  reference text check (reference is null or length(reference) <= 100),
  note text check (note is null or length(note) <= 500),
  consumption_line_id uuid references public.stock_consumption_lines (id),
  recipe_version_id uuid references public.recipe_versions (id),
  recipe_line_id uuid references public.recipe_lines (id),
  recipe_quantity_num numeric,
  recipe_quantity_den numeric,
  recipe_unit text,
  adjustment_id uuid references public.stock_adjustments (id),
  reverses_id uuid unique references public.stock_movements (id),
  check (reverses_id is not null
    or (kind in ('opening', 'receipt', 'purchase', 'transfer_in', 'return') and direction = 1)
    or (kind in ('consumption', 'waste', 'hospitality', 'deduction', 'transfer_out') and direction = -1)
    or kind = 'adjustment'),
  check (reverses_id is not null or (kind = 'consumption') = (recipe_line_id is not null and consumption_line_id is not null)),
  check (reverses_id is not null or (kind = 'adjustment') = (adjustment_id is not null))
);
create index stock_movements_item_idx on public.stock_movements (branch_id, item_id, business_date);
create index stock_movements_posting_idx on public.stock_movements (posting_id);

-- ------------------------------------------------------------------ immutability
create function app_private.refuse_stock_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Stock history is append-only (% on %)', tg_op, tg_table_name using errcode = '42501';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['stock_postings', 'stock_movements', 'stock_consumption_lines', 'stock_consumption_reversals',
                           'stock_counts', 'stock_count_voids'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function app_private.refuse_stock_change()', t || '_no_change', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function app_private.refuse_stock_change()', t || '_no_truncate', t);
  end loop;
end $$;

-- An adjustment is decided once; nothing else about it changes.
create function app_private.check_stock_adjustment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.status <> 'proposed' or new.status = 'proposed'
     or (to_jsonb(new) - 'status' - 'decided_posting_id' - 'decision_note')
        is distinct from (to_jsonb(old) - 'status' - 'decided_posting_id' - 'decision_note') then
    raise exception 'A stock adjustment is decided once' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger stock_adjustments_check before update or delete on public.stock_adjustments
  for each row execute function app_private.check_stock_adjustment();
create trigger stock_adjustments_no_truncate before truncate on public.stock_adjustments
  for each statement execute function app_private.refuse_stock_change();

-- A locked Product Mix keeps its lines and totals. It reopens only while nothing is posted from it.
create function app_private.check_product_mix_report()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A Product Mix report is kept' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'state' - 'version' - 'net_sales' - 'reported_local' - 'reported_at')
     is distinct from (to_jsonb(old) - 'state' - 'version' - 'net_sales' - 'reported_local' - 'reported_at') then
    raise exception 'A Product Mix report keeps its branch and date' using errcode = '42501';
  end if;
  if old.state = 'locked' and (new.net_sales, new.reported_at) is distinct from (old.net_sales, old.reported_at) then
    raise exception 'A locked Product Mix cannot change' using errcode = '42501';
  end if;
  if old.state = 'locked' and new.state = 'draft' and exists (
       select 1 from public.stock_consumption_lines c join public.product_mix_lines l on l.id = c.mix_line_id
       where l.report_id = old.id) then
    raise exception 'Consumption has been posted from this Product Mix' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger product_mix_reports_check before update or delete on public.product_mix_reports
  for each row execute function app_private.check_product_mix_report();

create function app_private.check_product_mix_detail()
returns trigger language plpgsql set search_path = '' as $$
declare
  rid uuid := case when tg_op = 'DELETE' then old.report_id else new.report_id end;
begin
  if tg_op = 'UPDATE' and new.report_id <> old.report_id then
    raise exception 'A Product Mix row keeps its report' using errcode = '42501';
  end if;
  if (select state from public.product_mix_reports where id = rid) <> 'draft' then
    raise exception 'A locked Product Mix cannot change' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger product_mix_sections_check before insert or update or delete on public.product_mix_sections
  for each row execute function app_private.check_product_mix_detail();
create trigger product_mix_lines_check before insert or update or delete on public.product_mix_lines
  for each row execute function app_private.check_product_mix_detail();
do $$
declare t text;
begin
  foreach t in array array['product_mix_reports', 'product_mix_sections', 'product_mix_lines'] loop
    execute format('create trigger %I before truncate on public.%I for each statement execute function app_private.refuse_stock_change()', t || '_no_truncate', t);
  end loop;
end $$;

-- Phase 5 hook: an approved recipe range can no longer be closed before a date that has consumption
-- posted through it. The posted basis stays the basis of that day.
create function app_private.recipe_range_keeps_postings()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.effective_to is distinct from old.effective_to and exists (
       select 1 from public.stock_consumption_lines c
       where c.recipe_version_id = old.id and c.business_date > new.effective_to
         and not exists (select 1 from public.stock_consumption_reversals r where r.consumption_line_id = c.id)) then
    raise exception 'Consumption is already posted through this recipe after %', new.effective_to using errcode = 'CT004';
  end if;
  return new;
end;
$$;
create trigger recipe_versions_keep_postings before update of effective_to on public.recipe_versions
  for each row execute function app_private.recipe_range_keeps_postings();

-- ------------------------------------------------------------------ access
alter table public.stock_postings enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_consumption_lines enable row level security;
alter table public.stock_consumption_reversals enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_voids enable row level security;
alter table public.stock_adjustments enable row level security;
alter table public.product_mix_reports enable row level security;
alter table public.product_mix_sections enable row level security;
alter table public.product_mix_lines enable row level security;

revoke all on public.stock_postings, public.stock_movements, public.stock_consumption_lines, public.stock_consumption_reversals,
  public.stock_counts, public.stock_count_voids, public.stock_adjustments, public.product_mix_reports,
  public.product_mix_sections, public.product_mix_lines
  from public, anon, authenticated, service_role;
grant select on public.stock_postings, public.stock_movements, public.stock_consumption_lines, public.stock_consumption_reversals,
  public.stock_counts, public.stock_count_voids, public.stock_adjustments, public.product_mix_reports,
  public.product_mix_sections, public.product_mix_lines
  to authenticated;

create policy stock_postings_read on public.stock_postings for select to authenticated
  using (app_private.has_permission('inventory.view', branch_id));
create policy stock_movements_read on public.stock_movements for select to authenticated
  using (app_private.has_permission('inventory.view', branch_id));
create policy stock_consumption_lines_read on public.stock_consumption_lines for select to authenticated
  using (app_private.has_permission('inventory.view', branch_id));
create policy stock_consumption_reversals_read on public.stock_consumption_reversals for select to authenticated
  using (exists (select 1 from public.stock_consumption_lines c where c.id = consumption_line_id
                 and app_private.has_permission('inventory.view', c.branch_id)));
create policy stock_counts_read on public.stock_counts for select to authenticated
  using (app_private.has_permission('inventory.view', branch_id));
create policy stock_count_voids_read on public.stock_count_voids for select to authenticated
  using (exists (select 1 from public.stock_counts c where c.id = count_id and app_private.has_permission('inventory.view', c.branch_id)));
create policy stock_adjustments_read on public.stock_adjustments for select to authenticated
  using (app_private.has_permission('inventory.view', branch_id));
create policy product_mix_reports_read on public.product_mix_reports for select to authenticated
  using (app_private.has_permission('inventory.view', branch_id));
create policy product_mix_sections_read on public.product_mix_sections for select to authenticated
  using (exists (select 1 from public.product_mix_reports r where r.id = report_id and app_private.has_permission('inventory.view', r.branch_id)));
create policy product_mix_lines_read on public.product_mix_lines for select to authenticated
  using (exists (select 1 from public.product_mix_reports r where r.id = report_id and app_private.has_permission('inventory.view', r.branch_id)));

-- ------------------------------------------------------------------ helpers
-- Local time "YYYY-MM-DDTHH:MI" inside the business day's window: from the day's cutoff to the end
-- of the next calendar day, and not in the future. Receipts must fall on the business date itself.
create function app_private.stock_instant(p_local text, b public.branches, p_date date, p_now timestamptz, p_strict boolean)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  t timestamptz := app_private.operating_local_instant(p_local, b.timezone);
begin
  if t > p_now or (t at time zone b.timezone)::date not between p_date and p_date + 1
     or (t at time zone b.timezone) < p_date + b.business_day_rollover
     or (p_strict and public.business_date_of(t, b.timezone, b.business_day_rollover) <> p_date) then
    raise exception 'The time is outside this business day' using errcode = '22023';
  end if;
  return t;
end;
$$;

-- A stock-tracked ingredient or packaging item of the organization, with its base unit.
create function app_private.stock_item(p_org uuid, p_item text)
returns public.catalog_items language plpgsql stable set search_path = '' as $$
declare
  i public.catalog_items%rowtype;
begin
  if p_item is null or p_item !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Select a stock item' using errcode = '22023';
  end if;
  select * into i from public.catalog_items where id = p_item::uuid and organization_id = p_org;
  if i.id is null or i.kind = 'sold' or not i.stock_tracked or i.base_unit is null then
    raise exception 'Select a stock item' using errcode = '22023';
  end if;
  return i;
end;
$$;

-- Quantity typed in any unit that converts to the item's base unit, as an exact base-unit fraction.
create function app_private.stock_to_base(i public.catalog_items, p_quantity app_private.rat, p_unit text)
returns app_private.rat language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := app_private.catalog_unit_factor(i.id, coalesce(nullif(p_unit, ''), i.base_unit));
begin
  if f ? 'error' then
    raise exception 'The unit does not convert to the base unit of this item (%)', f ->> 'error' using errcode = 'CT003';
  end if;
  if p_quantity.n = 0 then return row(0, 1)::app_private.rat; end if;
  return app_private.rat_mul(p_quantity, row((f ->> 'num')::numeric, (f ->> 'den')::numeric)::app_private.rat);
end;
$$;

create function app_private.mix_reconciliation(p_report uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with r as (select * from public.product_mix_reports where id = p_report),
  s as (
    select s.id, s.section_no, s.label, s.total_amount, coalesce(sum(l.amount), 0)::bigint as lines_amount, count(l.id) as lines
    from public.product_mix_sections s left join public.product_mix_lines l on l.section_id = s.id
    where s.report_id = p_report group by s.id
  ),
  close_sales as (
    select (v.data ->> 'sales')::bigint as sales
    from r join public.operating_days d on d.branch_id = r.branch_id and d.business_date = r.business_date
    cross join lateral (select x.data from public.operating_day_revisions x where x.day_id = d.id and x.effective
                        order by x.id desc limit 1) v
  ),
  problems as (
    select jsonb_build_object('code', 'section_total_mismatch', 'section', s.label, 'section_no', s.section_no,
                              'total', s.total_amount, 'lines', s.lines_amount) as p
    from s where s.lines_amount <> s.total_amount
    union all
    select jsonb_build_object('code', 'section_without_lines', 'section', s.label, 'section_no', s.section_no) from s where s.lines = 0
    union all
    select jsonb_build_object('code', 'net_sales_mismatch', 'net_sales', r.net_sales,
                              'sections', (select coalesce(sum(total_amount), 0) from s))
    from r where r.net_sales <> (select coalesce(sum(total_amount), 0) from s)
    union all
    select jsonb_build_object('code', 'no_lines') where not exists (select 1 from public.product_mix_lines where report_id = p_report)
    union all
    select jsonb_build_object('code', 'close_sales_mismatch', 'net_sales', r.net_sales, 'close_sales', c.sales)
    from r, close_sales c where c.sales is not null and c.sales <> r.net_sales
  )
  select jsonb_build_object(
    'ok', not exists (select 1 from problems),
    'problems', coalesce((select jsonb_agg(p) from problems), '[]'::jsonb),
    'sections_total', (select coalesce(sum(total_amount), 0) from s),
    'lines_total', (select coalesce(sum(lines_amount), 0) from s),
    'close_sales', (select sales from close_sales));
$$;

-- ------------------------------------------------------------------ the command
create function app_private.stock_command(p_branch text, p_date date, p_command text, p_request uuid, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
  b public.branches%rowtype;
  i public.catalog_items%rowtype;
  existing public.stock_postings%rowtype;
  posting public.stock_postings%rowtype;
  report public.product_mix_reports%rowtype;
  sec public.product_mix_sections%rowtype;
  cnt public.stock_counts%rowtype;
  adj public.stock_adjustments%rowtype;
  target public.stock_postings%rowtype;
  mv record;
  ln record;
  comp jsonb;
  res jsonb;
  out jsonb := '{}'::jsonb;
  actor text;
  hash bytea;
  now_at timestamptz := clock_timestamp();
  today date;
  kind text;
  permission text;
  q app_private.rat;
  base app_private.rat;
  at timestamptz;
  dir smallint;
  n integer;
  posted integer := 0;
  blocked integer := 0;
  moves integer := 0;
  mix_input jsonb;
  line_ids uuid[];
  cl_id uuid;
begin
  if caller is null or p_request is null or p_date is null or not isfinite(p_date) or p_command is null
     or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 32768 then
    raise exception 'Invalid stock request' using errcode = '22023';
  end if;
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or not app_private.has_permission('inventory.view', b.id) then
    raise exception 'Inventory access required' using errcode = '42501';
  end if;

  -- Which permission this command needs.
  kind := p_payload ->> 'kind';
  permission := case p_command
    when 'movement' then case
      when kind in ('receipt', 'purchase', 'transfer_in', 'return') then 'inventory.receive'
      when kind = 'waste' then 'inventory.waste'
      when kind = 'hospitality' then 'inventory.hospitality'
      when kind in ('deduction', 'transfer_out') then 'inventory.adjust' end
    when 'opening' then 'inventory.adjust_approve'
    when 'count' then 'inventory.count'
    when 'void_count' then 'inventory.count'
    when 'propose_adjustment' then 'inventory.adjust'
    when 'decide_adjustment' then 'inventory.adjust_approve'
    when 'mix_save' then 'inventory.consume'
    when 'mix_section' then 'inventory.consume'
    when 'mix_line' then 'inventory.consume'
    when 'mix_remove' then 'inventory.consume'
    when 'mix_lock' then 'inventory.consume'
    when 'mix_unlock' then 'inventory.consume'
    when 'post_consumption' then 'inventory.consume'
    when 'reverse' then 'reverse' end;
  if permission is null then
    raise exception 'Unknown stock command' using errcode = '22023';
  end if;
  if permission <> 'reverse' and not app_private.has_permission(permission, b.id) then
    raise exception 'Permission % required', permission using errcode = '42501';
  end if;

  -- One writer per branch at a time (shared with the daily close).
  perform 1 from public.branches where id = b.id for update;
  today := public.business_date_of(now_at, b.timezone, b.business_day_rollover);
  if p_date > today then
    raise exception 'Business day has not started' using errcode = '22023';
  end if;

  hash := sha256(convert_to(p_command || '|' || p_date::text || '|' || p_payload::text, 'UTF8'));
  select * into existing from public.stock_postings where branch_id = b.id and request_id = p_request;
  if found then
    if existing.actor_id <> caller or existing.request_hash <> hash then
      raise exception 'Request identifier already used' using errcode = '23505';
    end if;
    -- A retry returns the first result. Nothing new is written.
    return jsonb_build_object('posting', existing.id, 'replayed', true,
      'movements', (select count(*) from public.stock_movements where posting_id = existing.id),
      'consumed_lines', (select count(*) from public.stock_consumption_lines where posting_id = existing.id));
  end if;

  select e.full_name into actor from public.staff_accounts s join public.employees e on e.id = s.employee_id where s.user_id = caller;
  if p_command = 'reverse' then
    select * into target from public.stock_postings t
    where t.branch_id = b.id and t.id::text = lower(coalesce(p_payload ->> 'posting', ''));
  end if;
  -- The unique index on reverses_posting_id allows exactly one reversal per posting, even concurrently.
  insert into public.stock_postings (organization_id, branch_id, business_date, command, request_id, request_hash, actor_id, actor_name,
    reason, reverses_posting_id)
  values (b.organization_id, b.id, p_date, p_command, p_request, hash, caller, coalesce(actor, 'staff'),
          nullif(btrim(coalesce(p_payload ->> 'reason', '')), ''), target.id)
  returning * into posting;

  -- ---------------------------------------------------------------- typed movements and opening stock
  if p_command in ('movement', 'opening') then
    i := app_private.stock_item(b.organization_id, p_payload ->> 'item');
    q := app_private.parse_rational(case when (p_payload ->> 'quantity') ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then p_payload ->> 'quantity' end);
    if q is null then raise exception 'Enter a quantity above zero' using errcode = '22023'; end if;
    base := app_private.stock_to_base(i, q, p_payload ->> 'unit');
    kind := case when p_command = 'opening' then 'opening' else kind end;
    at := app_private.stock_instant(p_payload ->> 'local', b, p_date, now_at, kind in ('receipt', 'purchase', 'transfer_in', 'return'));
    if length(coalesce(p_payload ->> 'note', '')) > 500 or length(coalesce(p_payload ->> 'reference', '')) > 100 then
      raise exception 'Note or reference too long' using errcode = '22023';
    end if;
    if kind = 'opening' and exists (select 1 from public.stock_movements where branch_id = b.id and item_id = i.id) then
      raise exception 'This item already has stock history; record an adjustment instead' using errcode = '22023';
    end if;
    if kind <> 'opening' and exists (select 1 from public.stock_movements where branch_id = b.id and item_id = i.id
                                     and kind = 'opening' and business_date > p_date) then
      raise exception 'The opening stock of this item starts later' using errcode = '22023';
    end if;
    insert into public.stock_movements (organization_id, branch_id, business_date, posting_id, item_id, kind, direction,
      quantity_num, quantity_den, base_unit, entered_quantity, entered_unit, occurred_local, occurred_at, source, reference, note)
    values (b.organization_id, b.id, p_date, posting.id, i.id, kind,
      case when kind in ('opening', 'receipt', 'purchase', 'transfer_in', 'return') then 1 else -1 end,
      base.n, base.d, i.base_unit, p_payload ->> 'quantity', coalesce(nullif(p_payload ->> 'unit', ''), i.base_unit),
      p_payload ->> 'local', at, case when kind = 'opening' then 'opening' else 'manual' end,
      nullif(btrim(coalesce(p_payload ->> 'reference', '')), ''), nullif(btrim(coalesce(p_payload ->> 'note', '')), ''));
    moves := 1;

  -- ---------------------------------------------------------------- physical counts
  elsif p_command = 'count' then
    i := app_private.stock_item(b.organization_id, p_payload ->> 'item');
    q := app_private.parse_count(p_payload ->> 'quantity');
    if q is null then
      -- A blank or unreadable count is not an observation; nothing is stored.
      raise exception 'Enter the counted quantity (0 is a count; leave the item out when it was not counted)' using errcode = '22023';
    end if;
    base := app_private.stock_to_base(i, q, p_payload ->> 'unit');
    at := app_private.stock_instant(p_payload ->> 'local', b, p_date, now_at, false);
    if nullif(p_payload ->> 'replaces', '') is not null then
      select * into cnt from public.stock_counts c where c.id = (p_payload ->> 'replaces')::uuid and c.branch_id = b.id
        and c.item_id = i.id and c.business_date = p_date;
      if cnt.id is null or exists (select 1 from public.stock_count_voids v where v.count_id = cnt.id) then
        raise exception 'The count to replace is not active' using errcode = '22023';
      end if;
      if posting.reason is null then raise exception 'A replaced count needs a reason' using errcode = '22023'; end if;
      insert into public.stock_count_voids (count_id, posting_id, reason) values (cnt.id, posting.id, posting.reason);
    end if;
    insert into public.stock_counts (organization_id, branch_id, business_date, posting_id, item_id, counted_local, counted_at,
      quantity_num, quantity_den, base_unit, entered_quantity, entered_unit, note, replaces_id)
    values (b.organization_id, b.id, p_date, posting.id, i.id, p_payload ->> 'local', at, base.n, base.d, i.base_unit,
      btrim(p_payload ->> 'quantity'), coalesce(nullif(p_payload ->> 'unit', ''), i.base_unit),
      nullif(btrim(coalesce(p_payload ->> 'note', '')), ''), cnt.id)
    returning * into cnt;
    out := jsonb_build_object('count', cnt.id);

  elsif p_command = 'void_count' then
    select * into cnt from public.stock_counts c where c.id = nullif(p_payload ->> 'count', '')::uuid and c.branch_id = b.id and c.business_date = p_date;
    if cnt.id is null or exists (select 1 from public.stock_count_voids v where v.count_id = cnt.id) or posting.reason is null then
      raise exception 'An active count and a reason are required' using errcode = '22023';
    end if;
    insert into public.stock_count_voids (count_id, posting_id, reason) values (cnt.id, posting.id, posting.reason);

  -- ---------------------------------------------------------------- adjustments (separate from counts)
  elsif p_command = 'propose_adjustment' then
    i := app_private.stock_item(b.organization_id, p_payload ->> 'item');
    q := app_private.parse_rational(case when (p_payload ->> 'quantity') ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then p_payload ->> 'quantity' end);
    if q is null or p_payload ->> 'direction' not in ('1', '-1') or posting.reason is null then
      raise exception 'An adjustment needs a quantity, a direction and a reason' using errcode = '22023';
    end if;
    base := app_private.stock_to_base(i, q, p_payload ->> 'unit');
    at := app_private.stock_instant(p_payload ->> 'local', b, p_date, now_at, false);
    if nullif(p_payload ->> 'count', '') is not null and not exists (
         select 1 from public.stock_counts c where c.id = (p_payload ->> 'count')::uuid and c.branch_id = b.id and c.item_id = i.id) then
      raise exception 'The linked count is for another item' using errcode = '22023';
    end if;
    insert into public.stock_adjustments (organization_id, branch_id, business_date, item_id, direction, quantity_num, quantity_den,
      occurred_local, occurred_at, count_id, reason, proposed_posting_id)
    values (b.organization_id, b.id, p_date, i.id, (p_payload ->> 'direction')::smallint, base.n, base.d,
      p_payload ->> 'local', at, nullif(p_payload ->> 'count', '')::uuid, posting.reason, posting.id)
    returning * into adj;
    out := jsonb_build_object('adjustment', adj.id);

  elsif p_command = 'decide_adjustment' then
    select * into adj from public.stock_adjustments a where a.id = nullif(p_payload ->> 'adjustment', '')::uuid
      and a.branch_id = b.id and a.business_date = p_date for update;
    if adj.id is null or adj.status <> 'proposed' or p_payload ->> 'decision' not in ('approve', 'reject') then
      raise exception 'There is no proposed adjustment to decide' using errcode = '22023';
    end if;
    update public.stock_adjustments set status = case when p_payload ->> 'decision' = 'approve' then 'approved' else 'rejected' end,
      decided_posting_id = posting.id, decision_note = posting.reason where id = adj.id;
    if p_payload ->> 'decision' = 'approve' then
      select * into i from public.catalog_items where id = adj.item_id;
      insert into public.stock_movements (organization_id, branch_id, business_date, posting_id, item_id, kind, direction,
        quantity_num, quantity_den, base_unit, occurred_local, occurred_at, source, note, adjustment_id)
      values (b.organization_id, b.id, adj.business_date, posting.id, adj.item_id, 'adjustment', adj.direction,
        adj.quantity_num, adj.quantity_den, i.base_unit, adj.occurred_local, adj.occurred_at, 'adjustment', adj.reason, adj.id);
      moves := 1;
    end if;

  -- ---------------------------------------------------------------- Product Mix entry
  elsif p_command = 'mix_save' then
    select * into report from public.product_mix_reports where branch_id = b.id and business_date = p_date for update;
    at := app_private.stock_instant(p_payload ->> 'local', b, p_date, now_at, false);
    if coalesce(p_payload ->> 'net_sales', '') !~ '^[0-9]{1,14}$' then
      raise exception 'Enter the net sales of the report in centimes' using errcode = '22023';
    end if;
    if report.id is null then
      insert into public.product_mix_reports (organization_id, branch_id, business_date, net_sales, reported_local, reported_at, created_by)
      values (b.organization_id, b.id, p_date, (p_payload ->> 'net_sales')::bigint, p_payload ->> 'local', at, caller)
      returning * into report;
    else
      if report.version <> coalesce((p_payload ->> 'version')::integer, -1) then
        raise exception 'The Product Mix was changed by someone else' using errcode = '40001';
      end if;
      if report.state <> 'draft' then raise exception 'Unlock the Product Mix to change it' using errcode = '22023'; end if;
      update public.product_mix_reports set net_sales = (p_payload ->> 'net_sales')::bigint, reported_local = p_payload ->> 'local',
        reported_at = at, version = version + 1 where id = report.id returning * into report;
    end if;
    out := jsonb_build_object('report', report.id, 'version', report.version);

  elsif p_command in ('mix_section', 'mix_line', 'mix_remove', 'mix_lock', 'mix_unlock') then
    select * into report from public.product_mix_reports where branch_id = b.id and business_date = p_date for update;
    if report.id is null then raise exception 'Save the Product Mix report first' using errcode = '22023'; end if;
    if report.version <> coalesce((p_payload ->> 'version')::integer, -1) then
      raise exception 'The Product Mix was changed by someone else' using errcode = '40001';
    end if;
    if p_command = 'mix_unlock' then
      if report.state <> 'locked' then raise exception 'The Product Mix is not locked' using errcode = '22023'; end if;
      update public.product_mix_reports set state = 'draft', version = version + 1 where id = report.id;
    elsif report.state <> 'draft' then
      raise exception 'Unlock the Product Mix to change it' using errcode = '22023';
    elsif p_command = 'mix_section' then
      if coalesce(p_payload ->> 'total', '') !~ '^[0-9]{1,14}$' or length(btrim(coalesce(p_payload ->> 'label', ''))) not between 1 and 120 then
        raise exception 'A section needs its name and printed total' using errcode = '22023';
      end if;
      select * into sec from public.product_mix_sections where report_id = report.id
        and label_key = app_private.catalog_label_key(p_payload ->> 'label');
      if sec.id is null then
        insert into public.product_mix_sections (report_id, section_no, label, total_amount)
        values (report.id, coalesce((select max(section_no) from public.product_mix_sections where report_id = report.id), 0) + 1,
                btrim(p_payload ->> 'label'), (p_payload ->> 'total')::bigint);
      else
        update public.product_mix_sections set total_amount = (p_payload ->> 'total')::bigint where id = sec.id;
      end if;
    elsif p_command = 'mix_line' then
      select * into sec from public.product_mix_sections where report_id = report.id
        and section_no = coalesce((p_payload ->> 'section_no')::integer, -1);
      if sec.id is null or coalesce(p_payload ->> 'quantity', '') !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$'
         or coalesce(p_payload ->> 'amount', '') !~ '^[0-9]{1,14}$'
         or length(btrim(coalesce(p_payload ->> 'label', ''))) not between 1 and 200 then
        raise exception 'A line needs its section, name, quantity and amount' using errcode = '22023';
      end if;
      q := app_private.parse_rational(p_payload ->> 'quantity');
      if q is null then raise exception 'A sold quantity is above zero' using errcode = '22023'; end if;
      if (select count(*) from public.product_mix_lines where report_id = report.id) >= 500 then
        raise exception 'A Product Mix holds at most 500 lines' using errcode = '22023';
      end if;
      if exists (select 1 from public.product_mix_lines where section_id = sec.id and label_key = app_private.catalog_label_key(p_payload ->> 'label')) then
        raise exception 'This name is already entered in this section' using errcode = '23505';
      end if;
      insert into public.product_mix_lines (report_id, section_id, line_no, label, quantity_text, quantity_num, quantity_den, amount)
      values (report.id, sec.id, coalesce((select max(line_no) from public.product_mix_lines where report_id = report.id), 0) + 1,
              btrim(p_payload ->> 'label'), p_payload ->> 'quantity', q.n, q.d, (p_payload ->> 'amount')::bigint);
    elsif p_command = 'mix_remove' then
      delete from public.product_mix_lines where report_id = report.id and line_no = coalesce((p_payload ->> 'line_no')::integer, -1);
      get diagnostics n = row_count;
      if n = 0 then
        delete from public.product_mix_sections s where s.report_id = report.id and s.section_no = coalesce((p_payload ->> 'section_no')::integer, -1)
          and not exists (select 1 from public.product_mix_lines l where l.section_id = s.id);
        get diagnostics n = row_count;
      end if;
      if n = 0 then raise exception 'Nothing to remove' using errcode = '22023'; end if;
    elsif p_command = 'mix_lock' then
      res := app_private.mix_reconciliation(report.id);
      if not (res ->> 'ok')::boolean then
        raise exception 'The Product Mix does not reconcile: %', res -> 'problems' using errcode = 'CT005';
      end if;
      update public.product_mix_reports set state = 'locked' where id = report.id;
    end if;
    update public.product_mix_reports set version = version + 1 where id = report.id and p_command <> 'mix_unlock' returning * into report;
    if p_command = 'mix_unlock' then select * into report from public.product_mix_reports where id = report.id; end if;
    out := jsonb_build_object('report', report.id, 'version', report.version, 'state', report.state);

  -- ---------------------------------------------------------------- consumption through approved recipes
  elsif p_command = 'post_consumption' then
    select * into report from public.product_mix_reports where branch_id = b.id and business_date = p_date for update;
    if report.id is null or report.state <> 'locked' then
      raise exception 'Lock a reconciled Product Mix before posting' using errcode = '22023';
    end if;
    -- Lines not yet consumed (never posted, or posted and then reversed).
    select coalesce(jsonb_agg(jsonb_build_object('ref', l.id, 'label', l.label, 'quantity', l.quantity_text) order by l.line_no), '[]'::jsonb),
           coalesce(array_agg(l.id order by l.line_no), '{}')
      into mix_input, line_ids
    from public.product_mix_lines l
    where l.report_id = report.id and not exists (
      select 1 from public.stock_consumption_lines c where c.mix_line_id = l.id
        and not exists (select 1 from public.stock_consumption_reversals r where r.consumption_line_id = c.id));
    if jsonb_array_length(mix_input) = 0 then
      raise exception 'Every line of this Product Mix is already posted' using errcode = '22023';
    end if;
    res := app_private.catalog_consumption(p_branch, p_date, mix_input);
    for ln in select x as r from jsonb_array_elements(res -> 'lines') x loop
      if ln.r ->> 'status' <> 'eligible' then
        blocked := blocked + 1;
        continue;
      end if;
      insert into public.stock_consumption_lines (organization_id, branch_id, business_date, posting_id, mix_line_id, attempt,
        product_id, mapping_id, recipe_version_id, recipe_version_no, sold_quantity_num, sold_quantity_den, components)
      select b.organization_id, b.id, p_date, posting.id, l.id,
        coalesce((select max(attempt) from public.stock_consumption_lines where mix_line_id = l.id), 0) + 1,
        (ln.r #>> '{product,id}')::uuid, nullif(ln.r ->> 'mapping_id', '')::uuid, (ln.r #>> '{recipe,id}')::uuid,
        (ln.r #>> '{recipe,version_no}')::integer, l.quantity_num, l.quantity_den,
        (select coalesce(jsonb_agg(c || jsonb_build_object('stock_tracked', ci.stock_tracked)), '[]'::jsonb)
           from jsonb_array_elements(ln.r -> 'components') c join public.catalog_items ci on ci.id = (c ->> 'item_id')::uuid)
      from public.product_mix_lines l where l.id = (ln.r ->> 'ref')::uuid
      returning id into cl_id;
      for comp in select c from jsonb_array_elements(ln.r -> 'components') c loop
        select * into i from public.catalog_items where id = (comp ->> 'item_id')::uuid;
        continue when not i.stock_tracked;
        insert into public.stock_movements (organization_id, branch_id, business_date, posting_id, item_id, kind, direction,
          quantity_num, quantity_den, base_unit, occurred_local, occurred_at, source, consumption_line_id,
          recipe_version_id, recipe_line_id, recipe_quantity_num, recipe_quantity_den, recipe_unit)
        select b.organization_id, b.id, p_date, posting.id, i.id, 'consumption', -1,
          (comp #>> '{quantity,num}')::numeric, (comp #>> '{quantity,den}')::numeric, i.base_unit,
          report.reported_local, report.reported_at, 'product_mix', cl_id, (ln.r #>> '{recipe,id}')::uuid,
          (comp ->> 'line_id')::uuid, (comp #>> '{recipe_quantity,num}')::numeric, (comp #>> '{recipe_quantity,den}')::numeric,
          comp ->> 'recipe_unit';
        moves := moves + 1;
      end loop;
      posted := posted + 1;
    end loop;
    if posted = 0 then
      raise exception 'No line of this Product Mix is eligible yet' using errcode = 'CT006';
    end if;
    out := jsonb_build_object('posted_lines', posted, 'blocked_lines', blocked, 'result', res);

  -- ---------------------------------------------------------------- corrections by reversal
  elsif p_command = 'reverse' then
    if target.id is null or target.business_date <> p_date or posting.reason is null
       or target.command not in ('movement', 'opening', 'decide_adjustment', 'post_consumption')
       or not exists (select 1 from public.stock_movements m where m.posting_id = target.id) then
      raise exception 'A posted movement of this day and a reason are required' using errcode = '22023';
    end if;
    -- The reversal needs the permission that created the posting.
    select m.kind into kind from public.stock_movements m where m.posting_id = target.id limit 1;
    permission := case
      when target.command = 'post_consumption' then 'inventory.consume'
      when target.command in ('opening', 'decide_adjustment') then 'inventory.adjust_approve'
      when kind in ('receipt', 'purchase', 'transfer_in', 'return') then 'inventory.receive'
      when kind = 'waste' then 'inventory.waste'
      when kind = 'hospitality' then 'inventory.hospitality'
      else 'inventory.adjust' end;
    if not app_private.has_permission(permission, b.id) then
      raise exception 'Permission % required', permission using errcode = '42501';
    end if;
    if target.command = 'opening' and exists (select 1 from public.stock_movements m join public.stock_movements o on o.item_id = m.item_id
         where o.posting_id = target.id and m.branch_id = b.id and m.posting_id <> target.id) then
      raise exception 'Opening stock with later history is corrected by an adjustment' using errcode = '22023';
    end if;
    for mv in select * from public.stock_movements m where m.posting_id = target.id loop
      insert into public.stock_movements (organization_id, branch_id, business_date, posting_id, item_id, kind, direction,
        quantity_num, quantity_den, base_unit, entered_quantity, entered_unit, occurred_local, occurred_at, source, note, reverses_id)
      values (b.organization_id, b.id, mv.business_date, posting.id, mv.item_id, mv.kind, -mv.direction,
        mv.quantity_num, mv.quantity_den, mv.base_unit, mv.entered_quantity, mv.entered_unit, mv.occurred_local, mv.occurred_at,
        'reversal', posting.reason, mv.id);
      moves := moves + 1;
    end loop;
    insert into public.stock_consumption_reversals (consumption_line_id, posting_id)
    select c.id, posting.id from public.stock_consumption_lines c where c.posting_id = target.id;
    out := jsonb_build_object('reversed', target.id);
  end if;

  perform app_private.write_audit(b.organization_id, 'operation', 'stock.' || p_command, 'stock_posting', posting.id::text,
    p_date::text, b.id, jsonb_build_object('payload', p_payload - 'reason', 'reason', posting.reason, 'movements', moves) || out - 'result');
  return jsonb_build_object('posting', posting.id, 'replayed', false, 'movements', moves) || out;
end;
$$;

create function public.app_stock_command(p_branch text, p_date date, p_command text, p_request uuid, p_payload jsonb)
returns jsonb language sql volatile set search_path = '' as $$
  select app_private.stock_command(p_branch, p_date, p_command, p_request, p_payload);
$$;

-- ------------------------------------------------------------------ reads
-- Stock of every tracked item on a business date: opening (book at the start of the day), the day's
-- movements by type, the book (expected) balance, the day's active count, the expected stock at the
-- count instant and the variance. A missing count stays blank; an explicit zero is compared.
-- p_as_of reproduces the figures from what had been posted by that instant.
create function app_private.stock_day(p_branch text, p_date date, p_as_of timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
  as_of timestamptz := coalesce(p_as_of, 'infinity'::timestamptz);
  items jsonb;
  month_end boolean := (p_date + 1) = date_trunc('month', p_date + 1)::date;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or p_date is null or not isfinite(p_date) or not app_private.has_permission('inventory.view', b.id) then
    raise exception 'Inventory access required' using errcode = '42501';
  end if;
  with mv as (
    select m.*, row(m.direction * m.quantity_num, m.quantity_den)::app_private.rat as q
    from public.stock_movements m join public.stock_postings p on p.id = m.posting_id
    where m.branch_id = b.id and m.business_date <= p_date and p.posted_at <= as_of
  ),
  cnt as (
    select distinct on (c.item_id) c.*
    from public.stock_counts c join public.stock_postings p on p.id = c.posting_id
    where c.branch_id = b.id and c.business_date = p_date and p.posted_at <= as_of
      and not exists (select 1 from public.stock_count_voids v join public.stock_postings vp on vp.id = v.posting_id
                      where v.count_id = c.id and vp.posted_at <= as_of)
    order by c.item_id, c.counted_at desc, p.posted_at desc
  ),
  per_item as (
    select i.id, i.name_ar, i.name_en, i.kind, i.section_label, i.base_unit, i.status,
      (select app_private.rat_sum(q) from mv where mv.item_id = i.id and mv.business_date < p_date) as opening,
      (select app_private.rat_sum(q) from mv where mv.item_id = i.id and mv.business_date = p_date) as day_change,
      (select jsonb_object_agg(k.kind, app_private.rat_json(k.s)) from (
         select mv.kind, app_private.rat_sum(row(mv.direction * mv.quantity_num, mv.quantity_den)::app_private.rat) as s
         from mv where mv.item_id = i.id and mv.business_date = p_date group by mv.kind) k) as by_kind,
      c.id as count_id, c.counted_local, c.counted_at, c.entered_quantity, c.entered_unit,
      case when c.id is null then null else row(c.quantity_num, c.quantity_den)::app_private.rat end as counted,
      case when c.id is null then null else
        (select app_private.rat_sum(q) from mv where mv.item_id = i.id
           and (mv.business_date < p_date or (mv.business_date = p_date and mv.occurred_at <= c.counted_at))) end as at_count
    from public.catalog_items i left join cnt c on c.item_id = i.id
    where i.organization_id = b.organization_id and i.kind <> 'sold' and i.stock_tracked
      and (i.status = 'active' or exists (select 1 from mv where mv.item_id = i.id))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', id, 'name_ar', name_ar, 'name_en', name_en, 'kind', kind, 'section', section_label, 'base_unit', base_unit,
      'schedule', case when kind = 'packaging' then 'monthly' else 'daily' end,
      'opening', app_private.rat_json(coalesce(opening, row(0, 1)::app_private.rat)),
      'movements', coalesce(by_kind, '{}'::jsonb),
      'expected', app_private.rat_json(app_private.rat_add(coalesce(opening, row(0, 1)::app_private.rat), coalesce(day_change, row(0, 1)::app_private.rat))),
      'count', case when count_id is null then null else jsonb_build_object('id', count_id, 'local', counted_local,
                 'quantity', app_private.rat_json(counted), 'entered', entered_quantity, 'unit', entered_unit) end,
      'expected_at_count', app_private.rat_json_or_null(coalesce(at_count, case when count_id is not null then row(0, 1)::app_private.rat end)),
      'variance', case when count_id is null then null
                  else app_private.rat_json(app_private.rat_sub(counted, coalesce(at_count, row(0, 1)::app_private.rat))) end,
      'status', case when count_id is not null then 'counted'
                     when kind = 'packaging' and not month_end then 'not_due' else 'missing' end
    ) order by kind, section_label nulls last, name_ar), '[]'::jsonb)
  into items from per_item;
  return jsonb_build_object('branch', p_branch, 'date', p_date, 'as_of', p_as_of, 'month_end', month_end, 'items', items,
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'item_id', a.item_id, 'direction', a.direction,
        'quantity', app_private.rat_json(row(a.quantity_num, a.quantity_den)::app_private.rat), 'status', a.status,
        'reason', a.reason, 'count_id', a.count_id, 'local', a.occurred_local) order by a.occurred_at)
      from public.stock_adjustments a where a.branch_id = b.id and a.business_date = p_date), '[]'::jsonb),
    'today', public.business_date_of(now(), b.timezone, b.business_day_rollover),
    'local', to_char(now() at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI'));
end;
$$;

-- Every figure behind one item: movements with type, source, unit as entered, actor, posting time and
-- reversals; counts with voids and replacements; consumption with the recipe version and line.
create function app_private.stock_item_history(p_branch text, p_item uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92
     or not app_private.has_permission('inventory.view', b.id) then
    raise exception 'Inventory access required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'item', (select jsonb_build_object('id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en, 'kind', i.kind, 'base_unit', i.base_unit)
             from public.catalog_items i where i.id = p_item and i.organization_id = b.organization_id),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'date', m.business_date, 'kind', m.kind,
        'quantity', app_private.rat_json(row(m.direction * m.quantity_num, m.quantity_den)::app_private.rat),
        'entered', m.entered_quantity, 'unit', m.entered_unit, 'local', m.occurred_local, 'source', m.source,
        'reference', m.reference, 'note', m.note, 'actor', p.actor_name, 'posted_at', p.posted_at, 'posting', p.id,
        'reverses', m.reverses_id, 'reversed', exists (select 1 from public.stock_movements r where r.reverses_id = m.id),
        'recipe_version', m.recipe_version_id, 'recipe_line', m.recipe_line_id,
        'recipe_quantity', case when m.recipe_quantity_num is null then null
          else app_private.rat_json(row(m.recipe_quantity_num, m.recipe_quantity_den)::app_private.rat) end,
        'recipe_unit', m.recipe_unit, 'adjustment', m.adjustment_id) order by m.business_date, m.occurred_at, p.posted_at)
      from public.stock_movements m join public.stock_postings p on p.id = m.posting_id
      where m.branch_id = b.id and m.item_id = p_item and m.business_date between p_from and p_to), '[]'::jsonb),
    'counts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'date', c.business_date, 'local', c.counted_local,
        'quantity', app_private.rat_json(row(c.quantity_num, c.quantity_den)::app_private.rat), 'entered', c.entered_quantity,
        'unit', c.entered_unit, 'actor', p.actor_name, 'posted_at', p.posted_at, 'replaces', c.replaces_id,
        'voided', v.reason) order by c.business_date, c.counted_at)
      from public.stock_counts c join public.stock_postings p on p.id = c.posting_id
      left join public.stock_count_voids v on v.count_id = c.id
      where c.branch_id = b.id and c.item_id = p_item and c.business_date between p_from and p_to), '[]'::jsonb));
end;
$$;

-- The Product Mix of a day with its reconciliation and, for each line, the posted basis or the reason
-- it is still blocked.
create function app_private.product_mix(p_branch text, p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
  r public.product_mix_reports%rowtype;
  pending jsonb;
  check_result jsonb;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or p_date is null or not isfinite(p_date) or not app_private.has_permission('inventory.view', b.id) then
    raise exception 'Inventory access required' using errcode = '42501';
  end if;
  select * into r from public.product_mix_reports where branch_id = b.id and business_date = p_date;
  if r.id is null then
    return jsonb_build_object('report', null, 'branch', p_branch, 'date', p_date);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('ref', l.id, 'label', l.label, 'quantity', l.quantity_text) order by l.line_no), '[]'::jsonb)
  into pending from public.product_mix_lines l
  where l.report_id = r.id and not exists (select 1 from public.stock_consumption_lines c where c.mix_line_id = l.id
    and not exists (select 1 from public.stock_consumption_reversals x where x.consumption_line_id = c.id));
  check_result := case when jsonb_array_length(pending) > 0 then app_private.catalog_consumption(p_branch, p_date, pending) end;
  return jsonb_build_object('branch', p_branch, 'date', p_date,
    'report', jsonb_build_object('id', r.id, 'net_sales', r.net_sales, 'local', r.reported_local, 'state', r.state, 'version', r.version),
    'reconciliation', app_private.mix_reconciliation(r.id),
    'sections', coalesce((select jsonb_agg(jsonb_build_object('no', s.section_no, 'label', s.label, 'total', s.total_amount,
        'lines', coalesce((select jsonb_agg(jsonb_build_object('no', l.line_no, 'id', l.id, 'label', l.label, 'quantity', l.quantity_text,
          'amount', l.amount,
          'posted', (select jsonb_build_object('id', c.id, 'recipe_version', c.recipe_version_id, 'version_no', c.recipe_version_no,
                       'components', c.components, 'posting', c.posting_id)
                     from public.stock_consumption_lines c where c.mix_line_id = l.id
                       and not exists (select 1 from public.stock_consumption_reversals x where x.consumption_line_id = c.id)),
          'check', (select x from jsonb_array_elements(check_result -> 'lines') x where x ->> 'ref' = l.id::text)
        ) order by l.line_no) from public.product_mix_lines l where l.section_id = s.id), '[]'::jsonb)
      ) order by s.section_no) from public.product_mix_sections s where s.report_id = r.id), '[]'::jsonb));
end;
$$;

create function public.app_stock_day(p_branch text, p_date date, p_as_of timestamptz default null)
returns jsonb language sql stable set search_path = '' as $$ select app_private.stock_day(p_branch, p_date, p_as_of); $$;
create function public.app_stock_item_history(p_branch text, p_item uuid, p_from date, p_to date)
returns jsonb language sql stable set search_path = '' as $$ select app_private.stock_item_history(p_branch, p_item, p_from, p_to); $$;
create function public.app_product_mix(p_branch text, p_date date)
returns jsonb language sql stable set search_path = '' as $$ select app_private.product_mix(p_branch, p_date); $$;

revoke all on function app_private.stock_command(text, date, text, uuid, jsonb), public.app_stock_command(text, date, text, uuid, jsonb),
  app_private.stock_day(text, date, timestamptz), public.app_stock_day(text, date, timestamptz),
  app_private.stock_item_history(text, uuid, date, date), public.app_stock_item_history(text, uuid, date, date),
  app_private.product_mix(text, date), public.app_product_mix(text, date),
  app_private.mix_reconciliation(uuid), app_private.stock_to_base(public.catalog_items, app_private.rat, text),
  app_private.stock_item(uuid, text), app_private.stock_instant(text, public.branches, date, timestamptz, boolean)
from public, anon, authenticated, service_role;
grant execute on function app_private.stock_command(text, date, text, uuid, jsonb), public.app_stock_command(text, date, text, uuid, jsonb),
  app_private.stock_day(text, date, timestamptz), public.app_stock_day(text, date, timestamptz),
  app_private.stock_item_history(text, uuid, date, date), public.app_stock_item_history(text, uuid, date, date),
  app_private.product_mix(text, date), public.app_product_mix(text, date)
to authenticated;
