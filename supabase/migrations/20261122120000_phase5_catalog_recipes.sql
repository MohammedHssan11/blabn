-- Phase 5. Catalog, Foodics mappings, units and effective-dated recipes.
--
-- Everything here is organization-wide configuration. Writes go only through the checked commands
-- below (permission recipes.manage, one audit row each); the API roles can read, never write.
-- Quantities and conversions are exact fractions (numerator/denominator), never binary floats.
-- Posting stock movements is Phase 6: this phase answers "may this sold line be consumed, and what
-- would it consume", and reports a clear reason when it may not.

create extension if not exists btree_gist with schema extensions;

-- ------------------------------------------------------------------ exact arithmetic helpers
create type app_private.rat as (n numeric, d numeric);

create function app_private.rat_make(p_n numeric, p_d numeric)
returns app_private.rat language plpgsql immutable set search_path = '' as $$
declare g numeric;
begin
  if p_d is null or p_n is null or p_d = 0 then
    raise exception 'Invalid fraction' using errcode = '22012';
  end if;
  if p_d < 0 then p_n := -p_n; p_d := -p_d; end if;
  g := gcd(p_n, p_d);
  if g = 0 then return row(0, 1)::app_private.rat; end if;
  return row(div(p_n, g), div(p_d, g))::app_private.rat;
end;
$$;

create function app_private.rat_mul(a app_private.rat, b app_private.rat)
returns app_private.rat language sql immutable set search_path = '' as $$
  select app_private.rat_make(a.n * b.n, a.d * b.d);
$$;

create function app_private.rat_add(a app_private.rat, b app_private.rat)
returns app_private.rat language sql immutable set search_path = '' as $$
  select app_private.rat_make(a.n * b.d + b.n * a.d, a.d * b.d);
$$;

-- Decimal text rounded half-up to nine places, and whether that text is the exact value.
create function app_private.rat_text(a app_private.rat)
returns text language sql immutable set search_path = '' as $$
  -- Scale and round once using integer division, even just below a halfway point.
  select trim_scale(sign(a.n) * div(abs(a.n) * 2000000000 + a.d, 2 * a.d) * 0.000000001)::text;
$$;

create function app_private.rat_exact(a app_private.rat)
returns boolean language sql immutable set search_path = '' as $$
  select mod(a.n * 1000000000, a.d) = 0;
$$;

create function app_private.rat_json(a app_private.rat)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('num', trim_scale(a.n)::text, 'den', trim_scale(a.d)::text,
    'decimal', app_private.rat_text(a), 'exact', app_private.rat_exact(a));
$$;

-- Accepts "0.025", "1/30" and whole numbers. Returns NULL for anything else or a non-positive value.
create function app_private.parse_rational(p_text text)
returns app_private.rat language plpgsql immutable set search_path = '' as $$
declare
  t text := btrim(coalesce(p_text, ''));
  parts text[];
  scale integer;
begin
  if t ~ '^[0-9]{1,18}/[0-9]{1,18}$' then
    parts := string_to_array(t, '/');
    if parts[1]::numeric = 0 or parts[2]::numeric = 0 then return null; end if;
    return app_private.rat_make(parts[1]::numeric, parts[2]::numeric);
  elsif t ~ '^[0-9]{1,18}(\.[0-9]{1,18})?$' then
    if t::numeric = 0 then return null; end if;
    scale := coalesce(length(split_part(t, '.', 2)), 0);
    return app_private.rat_make(replace(t, '.', '')::numeric, (10::numeric) ^ scale);
  end if;
  return null;
end;
$$;

-- Arabic spelling variants and Arabic-Indic digits are folded together for matching only. The
-- original label is always stored beside it.
create function app_private.catalog_label_key(p_text text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select lower(btrim(regexp_replace(
    translate(regexp_replace(coalesce(p_text, ''), '[ً-ٰٟـ]', '', 'g'),
              'أإآٱىة٠١٢٣٤٥٦٧٨٩', 'اااايه0123456789'),
    '\s+', ' ', 'g')));
$$;

-- ------------------------------------------------------------------ units
create table public.catalog_units (
  code text primary key check (code ~ '^[a-z_]{1,16}$'),
  dimension text not null check (dimension in ('mass', 'volume', 'count', 'pack')),
  name_ar text not null,
  name_en text not null,
  -- Size of one unit in the dimension's reference unit (gram, millilitre, piece). Pack units have none:
  -- what a carton or sack contains is item-specific and must be approved per item.
  to_ref_num bigint,
  to_ref_den bigint,
  check ((dimension = 'pack') = (to_ref_num is null and to_ref_den is null)),
  check (to_ref_num is null or (to_ref_num > 0 and to_ref_den > 0))
);

insert into public.catalog_units (code, dimension, name_ar, name_en, to_ref_num, to_ref_den) values
  ('g',      'mass',   'جرام',    'Gram',       1,    1),
  ('kg',     'mass',   'كيلو',    'Kilogram',   1000, 1),
  ('ml',     'volume', 'مللي',    'Millilitre', 1,    1),
  ('l',      'volume', 'لتر',     'Litre',      1000, 1),
  ('pc',     'count',  'عدد',     'Piece',      1,    1),
  ('carton', 'pack',   'كرتونة',  'Carton',     null, null),
  ('crate',  'pack',   'فياسكة',  'Crate',      null, null),
  ('sack',   'pack',   'ساك',     'Sack',       null, null);

-- ------------------------------------------------------------------ items
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  kind text not null check (kind in ('sold', 'ingredient', 'packaging')),
  is_add_on boolean not null default false check (not is_add_on or kind = 'sold'),
  code text check (code is null or length(btrim(code)) between 1 and 60),
  name_ar text not null check (length(btrim(name_ar)) between 1 and 200),
  name_en text check (name_en is null or length(btrim(name_en)) between 1 and 200),
  name_key text generated always as (app_private.catalog_label_key(name_ar)) stored,
  section_label text,
  -- Where the record came from in the legacy workbooks; unique so a reload cannot duplicate it.
  legacy_key text,
  base_unit text references public.catalog_units (code),
  sales_unit text references public.catalog_units (code),
  purchase_unit text references public.catalog_units (code),
  storage_unit text references public.catalog_units (code),
  stock_tracked boolean not null default true,
  status text not null default 'active' check (status in ('active', 'discontinued')),
  discontinued_on date,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'discontinued') = (discontinued_on is not null)),
  check (kind <> 'sold' or (base_unit is not distinct from 'pc' and sales_unit is not distinct from 'pc'
    and purchase_unit is null and storage_unit is null and not stock_tracked)),
  check (kind = 'sold' or sales_unit is null)
);
create unique index catalog_items_code_idx on public.catalog_items (organization_id, code) where code is not null;
create unique index catalog_items_legacy_idx on public.catalog_items (organization_id, legacy_key) where legacy_key is not null;
create unique index catalog_items_component_name_idx on public.catalog_items (organization_id, kind, name_key) where kind <> 'sold';
create index catalog_items_kind_idx on public.catalog_items (organization_id, kind, status);

-- Item-specific conversion of one unit into the item's base unit (a carton of 24, a sack of 25 kg, one lemon
-- is 0.06 kg). Same-dimension units (kg to g) never need one.
create table public.catalog_item_conversions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  item_id uuid not null references public.catalog_items (id),
  unit_code text not null references public.catalog_units (code),
  to_base_num numeric not null check (to_base_num > 0 and to_base_num = trunc(to_base_num)),
  to_base_den numeric not null check (to_base_den > 0 and to_base_den = trunc(to_base_den)),
  check (gcd(to_base_num, to_base_den) = 1),
  basis text not null check (length(btrim(basis)) > 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (item_id, unit_code)
);

-- ------------------------------------------------------------------ names and Foodics mappings
-- One row per original label. A Foodics label becomes usable only when it is approved for exactly one item.
create table public.catalog_source_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  source_system text not null check (source_system in ('foodics', 'inventory_workbook', 'recipe_workbook', 'decision_record', 'manual')),
  label text not null check (length(btrim(label)) > 0),
  label_key text generated always as (app_private.catalog_label_key(label)) stored,
  item_id uuid references public.catalog_items (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  source_code text,
  source_ref text,
  basis text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'approved' or (item_id is not null and basis is not null and decided_at is not null))
);
-- Unambiguous by construction: a Foodics name has at most one approved meaning. Workbook labels only record
-- what a source called an item; the workbooks themselves repeat some names in different sections.
create unique index catalog_source_labels_approved_idx
  on public.catalog_source_labels (organization_id, label_key) where status = 'approved' and source_system = 'foodics';
create unique index catalog_source_labels_row_idx
  on public.catalog_source_labels (organization_id, source_system, label, coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index catalog_source_labels_item_idx on public.catalog_source_labels (item_id);

create table public.catalog_review_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  kind text not null check (kind in ('unmapped_name', 'unconfirmed_mapping', 'ambiguous_addon', 'missing_unit', 'unit_conflict',
    'missing_quantity', 'missing_component', 'untracked_component', 'empty_sales_row', 'unlinked_recipe', 'recipe_effective_date')),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  subject text not null check (length(btrim(subject)) > 0),
  item_id uuid references public.catalog_items (id),
  -- Exact source rows that conflict, e.g. {"source":"SRC-07","sheet":"2","row":1015,"unit_label":"عدد"}.
  refs jsonb not null default '[]' check (jsonb_typeof(refs) = 'array'),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution text,
  check ((status = 'open') = (resolved_at is null)),
  unique (organization_id, dedupe_key)
);
create index catalog_review_items_open_idx on public.catalog_review_items (organization_id, kind) where status = 'open';

-- ------------------------------------------------------------------ recipes
-- A question that only Abdo can answer and that gates the versions it names (the November recipe start date).
create table public.catalog_date_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  key text not null check (key ~ '^[a-z0-9-]{3,60}$'),
  question_ar text not null,
  question_en text not null,
  answered_date date,
  evidence text,
  decided_by uuid,
  decided_at timestamptz,
  check ((answered_date is null) = (decided_at is null)),
  check (answered_date is null or length(btrim(coalesce(evidence, ''))) > 0),
  unique (organization_id, key)
);

create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  product_id uuid not null references public.catalog_items (id),
  version_no integer not null check (version_no > 0),
  label text not null check (length(btrim(label)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'approved', 'withdrawn')),
  effective_from date,
  effective_to date,
  -- Inclusive on both ends; an open end has no upper bound.
  effective_range daterange generated always as (daterange(effective_from, effective_to, '[]')) stored,
  -- Lines are written per sold unit; a different batch yield is recorded here once it is confirmed.
  yield_num numeric not null default 1 check (yield_num > 0 and yield_num = trunc(yield_num)),
  yield_den numeric not null default 1 check (yield_den > 0 and yield_den = trunc(yield_den)),
  yield_basis text,
  date_decision_id uuid references public.catalog_date_decisions (id),
  decision_role text check (decision_role in ('starts_on', 'ends_before')),
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array'),
  note text,
  version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  unique (product_id, version_no),
  check ((date_decision_id is null) = (decision_role is null)),
  check (effective_to is null or effective_from is not null and effective_to >= effective_from),
  check (status <> 'approved' or (effective_from is not null and approved_at is not null)),
  check (status = 'approved' or (effective_from is null and effective_to is null)),
  -- Recipe selection for a product and business date is unambiguous: approved ranges never overlap.
  exclude using gist (product_id with =, effective_range with &&) where (status = 'approved')
);
create index recipe_versions_product_idx on public.recipe_versions (product_id, status);

create table public.recipe_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  version_id uuid not null references public.recipe_versions (id),
  line_no integer not null check (line_no > 0),
  component_id uuid references public.catalog_items (id),
  quantity_num numeric,
  quantity_den numeric,
  unit_code text references public.catalog_units (code),
  -- What the source workbook wrote, kept even when the approved unit differs.
  source_unit_label text,
  unit_resolution text,
  source_label text,
  source_ref text,
  note text,
  check ((quantity_num is null) = (quantity_den is null)),
  check (quantity_num is null or (quantity_num > 0 and quantity_den > 0 and quantity_num = trunc(quantity_num)
    and quantity_den = trunc(quantity_den) and gcd(quantity_num, quantity_den) = 1)),
  unique (version_id, line_no)
);
create index recipe_lines_component_idx on public.recipe_lines (component_id);

-- ------------------------------------------------------------------ integrity triggers
create function app_private.catalog_check_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.kind <> old.kind then
    raise exception 'An item keeps its kind' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger catalog_items_check before insert or update on public.catalog_items
  for each row execute function app_private.catalog_check_item();

create function app_private.catalog_check_version()
returns trigger language plpgsql set search_path = '' as $$
declare
  p public.catalog_items%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' then raise exception 'An approved recipe version is kept' using errcode = '42501'; end if;
    return old;
  end if;
  select * into p from public.catalog_items where id = new.product_id;
  if p.id is null or p.kind <> 'sold' or p.organization_id <> new.organization_id then
    raise exception 'A recipe belongs to a sold item of the same organization' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then
    -- The recipe basis of an earlier date can never move. The only allowed change is ending an open range.
    if new.status <> 'approved'
       or (to_jsonb(new) - 'effective_to' - 'effective_range' - 'version')
          is distinct from (to_jsonb(old) - 'effective_to' - 'effective_range' - 'version') then
      raise exception 'An approved recipe version cannot be changed' using errcode = '42501';
    end if;
    if new.effective_to is distinct from old.effective_to
       and (old.effective_to is not null or new.effective_to is null or new.effective_to < old.effective_from) then
      raise exception 'An approved recipe range can only be closed once' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'withdrawn' then
    raise exception 'A withdrawn recipe version is kept as it is' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger recipe_versions_check before insert or update or delete on public.recipe_versions
  for each row execute function app_private.catalog_check_version();

create function app_private.catalog_check_line()
returns trigger language plpgsql set search_path = '' as $$
declare
  v public.recipe_versions%rowtype;
  c public.catalog_items%rowtype;
begin
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'A recipe line cannot move to another version' using errcode = '42501';
  end if;
  select * into v from public.recipe_versions
  where id = case when tg_op = 'DELETE' then old.version_id else new.version_id end for share;
  if v.status <> 'draft' then
    raise exception 'Only a draft recipe can change its lines' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if v.organization_id <> new.organization_id then
    raise exception 'Line and recipe belong to different organizations' using errcode = '23514';
  end if;
  if new.component_id is not null then
    select * into c from public.catalog_items where id = new.component_id;
    if c.id is null or c.kind = 'sold' or c.organization_id <> new.organization_id then
      raise exception 'A component is an ingredient or packaging item' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger recipe_lines_check before insert or update or delete on public.recipe_lines
  for each row execute function app_private.catalog_check_line();

create function app_private.catalog_check_label()
returns trigger language plpgsql set search_path = '' as $$
declare
  i public.catalog_items%rowtype;
begin
  if new.item_id is not null then
    select * into i from public.catalog_items where id = new.item_id;
    if i.organization_id <> new.organization_id then
      raise exception 'Label and item belong to different organizations' using errcode = '23514';
    end if;
    if new.source_system = 'foodics' and i.kind <> 'sold' then
      raise exception 'A Foodics name maps to a sold item' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger catalog_source_labels_check before insert or update on public.catalog_source_labels
  for each row execute function app_private.catalog_check_label();

-- ------------------------------------------------------------------ access
create function app_private.can_read_catalog()
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.has_permission('recipes.manage') or exists (
    select 1 from app_private.effective_permissions() e where e.permission_key = 'inventory.view');
$$;

alter table public.catalog_units enable row level security;
alter table public.catalog_items enable row level security;
alter table public.catalog_item_conversions enable row level security;
alter table public.catalog_source_labels enable row level security;
alter table public.catalog_review_items enable row level security;
alter table public.catalog_date_decisions enable row level security;
alter table public.recipe_versions enable row level security;
alter table public.recipe_lines enable row level security;

revoke all on public.catalog_units, public.catalog_items, public.catalog_item_conversions, public.catalog_source_labels,
  public.catalog_review_items, public.catalog_date_decisions, public.recipe_versions, public.recipe_lines
  from public, anon, authenticated, service_role;
grant select on public.catalog_units, public.catalog_items, public.catalog_item_conversions, public.catalog_source_labels,
  public.catalog_review_items, public.catalog_date_decisions, public.recipe_versions, public.recipe_lines to authenticated;

create policy catalog_units_read on public.catalog_units for select to authenticated
  using (app_private.current_staff_id() is not null);
create policy catalog_items_read on public.catalog_items for select to authenticated
  using (organization_id = app_private.current_org() and app_private.can_read_catalog());
create policy catalog_item_conversions_read on public.catalog_item_conversions for select to authenticated
  using (organization_id = app_private.current_org() and app_private.can_read_catalog());
create policy recipe_versions_read on public.recipe_versions for select to authenticated
  using (organization_id = app_private.current_org() and app_private.can_read_catalog());
create policy recipe_lines_read on public.recipe_lines for select to authenticated
  using (organization_id = app_private.current_org() and app_private.can_read_catalog());
create policy catalog_source_labels_read on public.catalog_source_labels for select to authenticated
  using (organization_id = app_private.current_org() and app_private.has_permission('recipes.manage'));
create policy catalog_review_items_read on public.catalog_review_items for select to authenticated
  using (organization_id = app_private.current_org() and app_private.has_permission('recipes.manage'));
create policy catalog_date_decisions_read on public.catalog_date_decisions for select to authenticated
  using (organization_id = app_private.current_org() and app_private.has_permission('recipes.manage'));

-- ------------------------------------------------------------------ command helpers
create function app_private.catalog_manager()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare org uuid := app_private.current_org();
begin
  if auth.uid() is null or org is null or not app_private.has_permission('recipes.manage') then
    raise exception 'Catalog management permission required' using errcode = '42501';
  end if;
  return org;
end;
$$;

-- Factor that turns a quantity in p_from into the item's base unit, as {"num","den"} or {"error": code}.
create function app_private.catalog_unit_factor(p_item uuid, p_from text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  i public.catalog_items%rowtype;
  fu public.catalog_units%rowtype;
  tu public.catalog_units%rowtype;
  c public.catalog_item_conversions%rowtype;
  f app_private.rat;
begin
  select * into i from public.catalog_items where id = p_item;
  if p_from is null then return jsonb_build_object('error', 'unit_missing'); end if;
  if i.base_unit is null then return jsonb_build_object('error', 'base_unit_missing'); end if;
  if p_from = i.base_unit then return jsonb_build_object('num', '1', 'den', '1'); end if;
  select * into c from public.catalog_item_conversions where item_id = p_item and unit_code = p_from;
  if found then return jsonb_build_object('num', trim_scale(c.to_base_num)::text, 'den', trim_scale(c.to_base_den)::text); end if;
  select * into fu from public.catalog_units where code = p_from;
  select * into tu from public.catalog_units where code = i.base_unit;
  if fu.code is null then return jsonb_build_object('error', 'unit_missing'); end if;
  if fu.dimension = tu.dimension and fu.dimension <> 'pack' then
    f := app_private.rat_make(fu.to_ref_num::numeric * tu.to_ref_den, fu.to_ref_den::numeric * tu.to_ref_num);
    return jsonb_build_object('num', trim_scale(f.n)::text, 'den', trim_scale(f.d)::text);
  end if;
  return jsonb_build_object('error', 'unit_incompatible');
end;
$$;

create function app_private.catalog_item_json(i public.catalog_items)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('kind', i.kind, 'code', i.code, 'name_ar', i.name_ar, 'name_en', i.name_en,
    'section', i.section_label, 'base_unit', i.base_unit, 'sales_unit', i.sales_unit, 'purchase_unit', i.purchase_unit,
    'storage_unit', i.storage_unit, 'is_add_on', i.is_add_on, 'status', i.status, 'discontinued_on', i.discontinued_on);
$$;

-- ------------------------------------------------------------------ commands: items and units
create function app_private.catalog_save_item(
  p_id uuid, p_kind text, p_name_ar text, p_name_en text, p_code text, p_section text, p_base_unit text,
  p_sales_unit text, p_purchase_unit text, p_storage_unit text, p_is_add_on boolean, p_expected_version integer
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  old_item public.catalog_items%rowtype;
  saved public.catalog_items%rowtype;
  unit text;
begin
  if p_kind is null or p_kind not in ('sold', 'ingredient', 'packaging') then
    raise exception 'Unknown item kind' using errcode = '22023';
  end if;
  if p_kind = 'sold' and coalesce(nullif(p_sales_unit, ''), 'pc') <> 'pc' then
    raise exception 'Sold products are counted in pieces' using errcode = 'CT003';
  end if;
  if p_id is null then
    insert into public.catalog_items (organization_id, kind, is_add_on, code, name_ar, name_en, section_label, base_unit,
      sales_unit, purchase_unit, storage_unit, stock_tracked)
    values (org, p_kind, coalesce(p_is_add_on, false) and p_kind = 'sold', nullif(btrim(p_code), ''), btrim(p_name_ar),
      nullif(btrim(p_name_en), ''), nullif(btrim(p_section), ''),
      case when p_kind = 'sold' then 'pc' else nullif(p_base_unit, '') end,
      case when p_kind = 'sold' then coalesce(nullif(p_sales_unit, ''), 'pc') end,
      case when p_kind <> 'sold' then nullif(p_purchase_unit, '') end,
      case when p_kind <> 'sold' then nullif(p_storage_unit, '') end, p_kind <> 'sold')
    returning * into saved;
  else
    select * into old_item from public.catalog_items where id = p_id and organization_id = org for update;
    if not found then raise exception 'Item does not exist' using errcode = '22023'; end if;
    if old_item.version <> coalesce(p_expected_version, -1) then
      raise exception 'The item was changed by someone else' using errcode = '40001';
    end if;
    if old_item.kind <> p_kind then raise exception 'An item keeps its kind' using errcode = '22023'; end if;
    if old_item.kind <> 'sold' and old_item.base_unit is distinct from nullif(p_base_unit, '')
       and old_item.base_unit is not null and (
         exists (select 1 from public.recipe_lines l join public.recipe_versions v on v.id = l.version_id
                 where l.component_id = p_id and v.status = 'approved')
         or exists (select 1 from public.catalog_item_conversions where item_id = p_id)) then
      raise exception 'The base unit of an item in an approved recipe or with conversions is kept' using errcode = '22023';
    end if;
    update public.catalog_items set
      is_add_on = coalesce(p_is_add_on, false) and kind = 'sold', code = nullif(btrim(p_code), ''), name_ar = btrim(p_name_ar),
      name_en = nullif(btrim(p_name_en), ''), section_label = nullif(btrim(p_section), ''),
      base_unit = case when kind = 'sold' then 'pc' else nullif(p_base_unit, '') end,
      sales_unit = case when kind = 'sold' then coalesce(nullif(p_sales_unit, ''), 'pc') end,
      purchase_unit = case when kind <> 'sold' then nullif(p_purchase_unit, '') end,
      storage_unit = case when kind <> 'sold' then nullif(p_storage_unit, '') end,
      version = version + 1, updated_at = now()
    where id = p_id returning * into saved;
  end if;
  -- Every unit the item is bought, stored or sold in must convert to its base unit.
  foreach unit in array array[saved.sales_unit, saved.purchase_unit, saved.storage_unit] loop
    if unit is not null and saved.kind <> 'sold' and (app_private.catalog_unit_factor(saved.id, unit)) ? 'error' then
      raise exception 'Unit % does not convert to the base unit of this item', unit using errcode = 'CT003';
    end if;
  end loop;
  perform app_private.write_audit(org, 'administration', 'catalog.item_saved', 'catalog_item', saved.id::text, saved.name_ar, null,
    jsonb_build_object('before', case when old_item.id is null then null else app_private.catalog_item_json(old_item) end,
                       'after', app_private.catalog_item_json(saved)));
  return saved.id;
exception when unique_violation then
  raise exception 'An item with this code or name already exists' using errcode = '23505';
end;
$$;

create function app_private.catalog_set_item_status(p_id uuid, p_status text, p_on date, p_expected_version integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  old_item public.catalog_items%rowtype;
  saved public.catalog_items%rowtype;
begin
  if p_status not in ('active', 'discontinued') or (p_status = 'discontinued' and p_on is null) then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  select * into old_item from public.catalog_items where id = p_id and organization_id = org for update;
  if not found then raise exception 'Item does not exist' using errcode = '22023'; end if;
  if old_item.version <> coalesce(p_expected_version, -1) then
    raise exception 'The item was changed by someone else' using errcode = '40001';
  end if;
  -- The record, its recipes and its mappings stay: history keeps resolving to it.
  update public.catalog_items set status = p_status,
    discontinued_on = case when p_status = 'discontinued' then p_on end, version = version + 1, updated_at = now()
  where id = p_id returning * into saved;
  perform app_private.write_audit(org, 'administration', 'catalog.item_status_changed', 'catalog_item', saved.id::text, saved.name_ar, null,
    jsonb_build_object('before', jsonb_build_object('status', old_item.status, 'discontinued_on', old_item.discontinued_on),
                       'after', jsonb_build_object('status', saved.status, 'discontinued_on', saved.discontinued_on)));
end;
$$;

create function app_private.catalog_save_conversion(p_item uuid, p_unit text, p_quantity text, p_basis text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  i public.catalog_items%rowtype;
  u public.catalog_units%rowtype;
  b public.catalog_units%rowtype;
  q app_private.rat := app_private.parse_rational(p_quantity);
  old_row public.catalog_item_conversions%rowtype;
  saved public.catalog_item_conversions%rowtype;
begin
  select * into i from public.catalog_items where id = p_item and organization_id = org for update;
  if not found or i.kind = 'sold' or i.base_unit is null then
    raise exception 'Conversions belong to an ingredient or packaging item with a base unit' using errcode = '22023';
  end if;
  select * into u from public.catalog_units where code = p_unit;
  select * into b from public.catalog_units where code = i.base_unit;
  if u.code is null or q is null or length(btrim(coalesce(p_basis, ''))) = 0 then
    raise exception 'Invalid conversion' using errcode = '22023';
  end if;
  if p_unit = i.base_unit then raise exception 'The base unit needs no conversion' using errcode = '22023'; end if;
  if u.dimension = b.dimension and u.dimension <> 'pack' then
    raise exception 'Units of the same kind convert automatically' using errcode = '22023';
  end if;
  select * into old_row from public.catalog_item_conversions where item_id = p_item and unit_code = p_unit for update;
  if found and exists (select 1 from public.recipe_lines l join public.recipe_versions v on v.id = l.version_id
                       where l.component_id = p_item and l.unit_code = p_unit and v.status = 'approved') then
    raise exception 'A conversion used by an approved recipe is kept' using errcode = '22023';
  end if;
  insert into public.catalog_item_conversions (organization_id, item_id, unit_code, to_base_num, to_base_den, basis, created_by)
  values (org, p_item, p_unit, q.n, q.d, btrim(p_basis), auth.uid())
  on conflict (item_id, unit_code) do update
    set to_base_num = excluded.to_base_num, to_base_den = excluded.to_base_den, basis = excluded.basis, created_by = excluded.created_by
  returning * into saved;
  perform app_private.write_audit(org, 'administration', 'catalog.conversion_saved', 'catalog_item', p_item::text, i.name_ar, null,
    jsonb_build_object('unit', p_unit, 'base_unit', i.base_unit, 'basis', saved.basis,
      'before', case when old_row.id is null then null else jsonb_build_object('num', old_row.to_base_num, 'den', old_row.to_base_den) end,
      'after', jsonb_build_object('num', saved.to_base_num, 'den', saved.to_base_den)));
  return saved.id;
end;
$$;

-- ------------------------------------------------------------------ commands: names and the review queue
create function app_private.catalog_close_reviews(p_org uuid, p_key text, p_note text)
returns void language sql volatile security definer set search_path = '' as $$
  update public.catalog_review_items set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution = p_note
  where organization_id = p_org and dedupe_key = p_key and status = 'open';
$$;

-- Approve, reject or propose the meaning of one original label.
create function app_private.catalog_map_name(p_source text, p_label text, p_item uuid, p_decision text, p_basis text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  key text := app_private.catalog_label_key(p_label);
  existing public.catalog_source_labels%rowtype;
  saved public.catalog_source_labels%rowtype;
  i public.catalog_items%rowtype;
begin
  if p_source not in ('foodics', 'inventory_workbook', 'recipe_workbook', 'decision_record', 'manual')
     or key = '' or p_decision not in ('approve', 'reject', 'propose') then
    raise exception 'Invalid mapping' using errcode = '22023';
  end if;
  if p_decision <> 'propose' and length(btrim(coalesce(p_basis, ''))) = 0 then
    raise exception 'A decision needs its basis' using errcode = '22023';
  end if;
  if p_item is not null then
    select * into i from public.catalog_items where id = p_item and organization_id = org;
    if not found then raise exception 'Item does not exist' using errcode = '22023'; end if;
  end if;
  if p_decision = 'approve' and p_item is null then
    raise exception 'Approval needs an item' using errcode = '22023';
  end if;
  -- The row for this label and item; a queued label has no item yet and is completed in place.
  select * into existing from public.catalog_source_labels
  where organization_id = org and source_system = p_source and label_key = key
    and (item_id is not distinct from p_item or item_id is null)
  order by (item_id is not distinct from p_item) desc, created_at limit 1 for update;
  if found then
    if existing.status = 'approved' and p_decision = 'approve' and existing.item_id is distinct from p_item then
      raise exception 'This name is already approved for another item' using errcode = '23505';
    end if;
    update public.catalog_source_labels set
      item_id = coalesce(p_item, item_id),
      status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'pending' end,
      basis = coalesce(nullif(btrim(p_basis), ''), basis),
      decided_by = case when p_decision = 'propose' then null else auth.uid() end,
      decided_at = case when p_decision = 'propose' then null else now() end
    where id = existing.id returning * into saved;
  else
    insert into public.catalog_source_labels (organization_id, source_system, label, item_id, status, basis, decided_by, decided_at)
    values (org, p_source, btrim(p_label), p_item,
      case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'pending' end,
      nullif(btrim(p_basis), ''), case when p_decision = 'propose' then null else auth.uid() end,
      case when p_decision = 'propose' then null else now() end)
    returning * into saved;
  end if;
  if p_decision <> 'propose' then
    perform app_private.catalog_close_reviews(org, 'name:' || p_source || ':' || key,
      case p_decision when 'approve' then 'Approved: ' else 'Rejected: ' end || btrim(p_basis));
  end if;
  perform app_private.write_audit(org, 'administration', 'catalog.mapping_decided', 'catalog_label', saved.id::text, saved.label, null,
    jsonb_build_object('source', p_source, 'decision', p_decision, 'item', p_item, 'basis', p_basis,
      'before', case when existing.id is null then null else jsonb_build_object('status', existing.status, 'item', existing.item_id) end));
  return saved.id;
exception when unique_violation then
  raise exception 'This name is already approved for another item' using errcode = '23505';
end;
$$;

-- Names the people met but nobody has approved yet join the review queue once.
create function app_private.catalog_queue_names(p_labels jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  name text;
  key text;
  created integer := 0;
  n integer;
begin
  if jsonb_typeof(p_labels) is distinct from 'array' or jsonb_array_length(p_labels) > 200 then
    raise exception 'Invalid names' using errcode = '22023';
  end if;
  for name in select jsonb_array_elements_text(p_labels) loop
    key := app_private.catalog_label_key(name);
    if key = '' or length(name) > 200 then continue; end if;
    if exists (select 1 from public.catalog_source_labels where organization_id = org and source_system = 'foodics'
               and label_key = key and status = 'approved') then continue; end if;
    insert into public.catalog_source_labels (organization_id, source_system, label, status, basis)
    select org, 'foodics', btrim(name), 'pending', 'Seen in a Product Mix check'
    where not exists (select 1 from public.catalog_source_labels where organization_id = org and source_system = 'foodics' and label_key = key);
    insert into public.catalog_review_items (organization_id, kind, subject, refs, dedupe_key)
    values (org, 'unmapped_name', btrim(name), '[{"source":"Foodics Product Mix"}]', 'name:foodics:' || key)
    on conflict (organization_id, dedupe_key) do nothing;
    get diagnostics n = row_count;
    created := created + n;
  end loop;
  if created > 0 then
    perform app_private.write_audit(org, 'administration', 'catalog.names_queued', 'catalog_review', null, null, null,
      jsonb_build_object('count', created));
  end if;
  return created;
end;
$$;

create function app_private.catalog_resolve_review(p_id uuid, p_status text, p_note text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  r public.catalog_review_items%rowtype;
begin
  if p_status not in ('open', 'resolved', 'dismissed') or (p_status <> 'open' and length(btrim(coalesce(p_note, ''))) = 0) then
    raise exception 'A closed review item needs a note' using errcode = '22023';
  end if;
  select * into r from public.catalog_review_items where id = p_id and organization_id = org for update;
  if not found then raise exception 'Review item does not exist' using errcode = '22023'; end if;
  if r.kind = 'recipe_effective_date' and p_status <> 'open' and not exists (
       select 1 from public.catalog_date_decisions d where d.organization_id = org and d.key = r.dedupe_key and d.answered_date is not null) then
    raise exception 'Answer the date question instead' using errcode = '22023';
  end if;
  update public.catalog_review_items set status = p_status,
    resolved_by = case when p_status = 'open' then null else auth.uid() end,
    resolved_at = case when p_status = 'open' then null else now() end,
    resolution = case when p_status = 'open' then null else btrim(p_note) end
  where id = p_id;
  perform app_private.write_audit(org, 'administration', 'catalog.review_resolved', 'catalog_review', p_id::text, r.subject, null,
    jsonb_build_object('kind', r.kind, 'from', r.status, 'to', p_status, 'note', p_note));
end;
$$;

-- ------------------------------------------------------------------ commands: recipes
create function app_private.catalog_create_recipe(p_product uuid, p_label text, p_copy_from uuid, p_note text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  p public.catalog_items%rowtype;
  src public.recipe_versions%rowtype;
  v public.recipe_versions%rowtype;
begin
  select * into p from public.catalog_items where id = p_product and organization_id = org and kind = 'sold' for update;
  if not found or length(btrim(coalesce(p_label, ''))) = 0 then
    raise exception 'A recipe needs a sold item and a label' using errcode = '22023';
  end if;
  if p_copy_from is not null then
    select * into src from public.recipe_versions
    where id = p_copy_from and product_id = p_product and organization_id = org for share;
    if not found then raise exception 'Source recipe is not for this item' using errcode = '22023'; end if;
  end if;
  insert into public.recipe_versions (organization_id, product_id, version_no, label, note, created_by,
    yield_num, yield_den, yield_basis, date_decision_id, decision_role, sources)
  values (org, p_product, coalesce((select max(version_no) from public.recipe_versions where product_id = p_product), 0) + 1,
    btrim(p_label), nullif(btrim(p_note), ''), auth.uid(), coalesce(src.yield_num, 1), coalesce(src.yield_den, 1), src.yield_basis,
    case when src.status <> 'approved' then src.date_decision_id end,
    case when src.status <> 'approved' then src.decision_role end, coalesce(src.sources, '[]'::jsonb))
  returning * into v;
  if src.id is not null then
    insert into public.recipe_lines (organization_id, version_id, line_no, component_id, quantity_num, quantity_den, unit_code,
      source_unit_label, unit_resolution, source_label, source_ref, note)
    select org, v.id, l.line_no, l.component_id, l.quantity_num, l.quantity_den, l.unit_code, l.source_unit_label,
           l.unit_resolution, l.source_label, l.source_ref, l.note
    from public.recipe_lines l where l.version_id = src.id;
  end if;
  perform app_private.write_audit(org, 'administration', 'catalog.recipe_created', 'recipe_version', v.id::text, p.name_ar, null,
    jsonb_build_object('version_no', v.version_no, 'label', v.label, 'copied_from', p_copy_from));
  return v.id;
end;
$$;

create function app_private.catalog_save_recipe_line(
  p_version uuid, p_line uuid, p_component uuid, p_quantity text, p_unit text, p_note text, p_expected_version integer
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  v public.recipe_versions%rowtype;
  q app_private.rat := app_private.parse_rational(p_quantity);
  old_line public.recipe_lines%rowtype;
  saved public.recipe_lines%rowtype;
begin
  select * into v from public.recipe_versions where id = p_version and organization_id = org for update;
  if not found or v.status <> 'draft' then
    raise exception 'Only a draft recipe can change its lines' using errcode = '22023';
  end if;
  if v.version <> coalesce(p_expected_version, -1) then
    raise exception 'The recipe was changed by someone else' using errcode = '40001';
  end if;
  if p_component is null or q is null or (p_unit is not null and not exists (select 1 from public.catalog_units where code = p_unit)) then
    raise exception 'A line needs a component and a positive quantity' using errcode = '22023';
  end if;
  if p_line is null then
    insert into public.recipe_lines (organization_id, version_id, line_no, component_id, quantity_num, quantity_den, unit_code, note)
    values (org, p_version, coalesce((select max(line_no) from public.recipe_lines where version_id = p_version), 0) + 1,
      p_component, q.n, q.d, nullif(p_unit, ''), nullif(btrim(p_note), ''))
    returning * into saved;
  else
    select * into old_line from public.recipe_lines where id = p_line and version_id = p_version for update;
    if not found then raise exception 'Line does not exist' using errcode = '22023'; end if;
    update public.recipe_lines set component_id = p_component, quantity_num = q.n, quantity_den = q.d,
      unit_code = nullif(p_unit, ''), note = nullif(btrim(p_note), ''),
      -- a unit chosen by a person replaces what an earlier decision recorded
      unit_resolution = case when unit_code is distinct from nullif(p_unit, '') then null else unit_resolution end
    where id = p_line returning * into saved;
  end if;
  update public.recipe_versions set version = version + 1 where id = p_version;
  perform app_private.write_audit(org, 'administration', 'catalog.recipe_line_saved', 'recipe_version', p_version::text, null, null,
    jsonb_build_object('line_no', saved.line_no, 'component', p_component, 'unit', saved.unit_code,
      'quantity', app_private.rat_json(row(saved.quantity_num, saved.quantity_den)::app_private.rat),
      'before', case when old_line.id is null then null else jsonb_build_object('component', old_line.component_id, 'unit', old_line.unit_code,
        'quantity', app_private.rat_json(row(old_line.quantity_num, old_line.quantity_den)::app_private.rat)) end));
  return saved.id;
end;
$$;

create function app_private.catalog_remove_recipe_line(p_line uuid, p_expected_version integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  l public.recipe_lines%rowtype;
  v public.recipe_versions%rowtype;
begin
  select * into l from public.recipe_lines where id = p_line and organization_id = org;
  if not found then raise exception 'Line does not exist' using errcode = '22023'; end if;
  select * into v from public.recipe_versions where id = l.version_id for update;
  if v.status <> 'draft' then raise exception 'Only a draft recipe can change its lines' using errcode = '22023'; end if;
  if v.version <> coalesce(p_expected_version, -1) then
    raise exception 'The recipe was changed by someone else' using errcode = '40001';
  end if;
  delete from public.recipe_lines where id = p_line;
  update public.recipe_versions set version = version + 1 where id = v.id;
  perform app_private.write_audit(org, 'administration', 'catalog.recipe_line_removed', 'recipe_version', v.id::text, null, null,
    jsonb_build_object('line_no', l.line_no, 'component', l.component_id, 'unit', l.unit_code));
end;
$$;

create function app_private.catalog_set_recipe_meta(p_version uuid, p_label text, p_yield text, p_note text, p_expected_version integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  v public.recipe_versions%rowtype;
  y app_private.rat := case when nullif(btrim(coalesce(p_yield, '')), '') is null then row(1, 1)::app_private.rat
                            else app_private.parse_rational(p_yield) end;
begin
  select * into v from public.recipe_versions where id = p_version and organization_id = org for update;
  if not found or v.status <> 'draft' or y is null or length(btrim(coalesce(p_label, ''))) = 0 then
    raise exception 'Invalid recipe details' using errcode = '22023';
  end if;
  if v.version <> coalesce(p_expected_version, -1) then
    raise exception 'The recipe was changed by someone else' using errcode = '40001';
  end if;
  update public.recipe_versions set label = btrim(p_label), yield_num = y.n, yield_den = y.d,
    yield_basis = case when nullif(btrim(coalesce(p_yield, '')), '') is null then null else 'Confirmed by the recipe owner' end,
    note = nullif(btrim(p_note), ''), version = version + 1
  where id = p_version;
  perform app_private.write_audit(org, 'administration', 'catalog.recipe_details_saved', 'recipe_version', p_version::text, p_label, null,
    jsonb_build_object('label', p_label, 'yield', p_yield));
end;
$$;

create function app_private.catalog_approve_recipe(p_version uuid, p_from date, p_to date, p_expected_version integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  v public.recipe_versions%rowtype;
  p public.catalog_items%rowtype;
  d public.catalog_date_decisions%rowtype;
  l record;
  factor jsonb;
  c public.catalog_items%rowtype;
  closed integer := 0;
  prev record;
  line_count integer := 0;
begin
  -- Use the same product-before-version lock order as creation and copying.
  select i.* into p from public.recipe_versions r join public.catalog_items i on i.id = r.product_id
    where r.id = p_version and r.organization_id = org for update of i;
  select * into v from public.recipe_versions where id = p_version and organization_id = org for update;
  if p.id is null or not found or v.status <> 'draft' then
    raise exception 'Only a draft recipe can be approved' using errcode = '22023';
  end if;
  if v.version <> coalesce(p_expected_version, -1) then
    raise exception 'The recipe was changed by someone else' using errcode = '40001';
  end if;
  if p_from is null or not isfinite(p_from) or (p_to is not null and (not isfinite(p_to) or p_to < p_from)) then
    raise exception 'A recipe needs a valid effective date range' using errcode = '22023';
  end if;
  if v.date_decision_id is not null then
    select * into d from public.catalog_date_decisions
    where id = v.date_decision_id and organization_id = org for share;
    if d.answered_date is null then
      raise exception 'The effective date of this recipe set has not been confirmed' using errcode = 'CT001';
    end if;
    if (v.decision_role = 'starts_on' and p_from is distinct from d.answered_date)
       or (v.decision_role = 'ends_before' and p_to is distinct from d.answered_date - 1) then
      raise exception 'The dates must follow the confirmed effective date' using errcode = 'CT001';
    end if;
  end if;
  -- Hold each component stable while checking factors and publishing the approved state.
  perform i.id from public.catalog_items i
    where i.id in (select component_id from public.recipe_lines where version_id = p_version)
    order by i.id for share;

  for l in select * from public.recipe_lines where version_id = p_version order by line_no loop
    line_count := line_count + 1;
    if l.component_id is null or l.quantity_num is null or l.unit_code is null then
      raise exception 'Line % is incomplete', l.line_no using errcode = 'CT002';
    end if;
    factor := app_private.catalog_unit_factor(l.component_id, l.unit_code);
    if factor ? 'error' then
      raise exception 'Line %: %', l.line_no, factor ->> 'error' using errcode = 'CT003';
    end if;
  end loop;
  if line_count = 0 then raise exception 'A recipe needs at least one line' using errcode = 'CT002'; end if;
  -- An approved open-ended predecessor ends the day before the new version starts.
  for prev in select * from public.recipe_versions
              where product_id = v.product_id and status = 'approved' and id <> v.id
                and effective_range && daterange(p_from, p_to, '[]') for update loop
    if prev.effective_to is null and prev.effective_from < p_from then
      update public.recipe_versions set effective_to = p_from - 1, version = version + 1 where id = prev.id;
      closed := closed + 1;
      perform app_private.write_audit(org, 'administration', 'catalog.recipe_range_closed', 'recipe_version', prev.id::text, p.name_ar, null,
        jsonb_build_object('effective_to', p_from - 1, 'because_of', v.id));
    else
      raise exception 'The dates overlap an approved recipe version' using errcode = '23P01';
    end if;
  end loop;
  update public.recipe_versions set status = 'approved', effective_from = p_from, effective_to = p_to,
    approved_by = auth.uid(), approved_at = now(), version = version + 1
  where id = p_version;
  perform app_private.write_audit(org, 'administration', 'catalog.recipe_approved', 'recipe_version', p_version::text, p.name_ar, null,
    jsonb_build_object('version_no', v.version_no, 'label', v.label, 'effective_from', p_from, 'effective_to', p_to, 'lines', line_count));
  return jsonb_build_object('closed_previous', closed, 'lines', line_count);
exception when exclusion_violation then
  raise exception 'The dates overlap an approved recipe version' using errcode = '23P01';
end;
$$;

create function app_private.catalog_withdraw_recipe(p_version uuid, p_note text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  v public.recipe_versions%rowtype;
begin
  select * into v from public.recipe_versions where id = p_version and organization_id = org for update;
  if not found or v.status <> 'draft' or length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Only a draft recipe can be withdrawn, with a reason' using errcode = '22023';
  end if;
  update public.recipe_versions set status = 'withdrawn', note = btrim(p_note), version = version + 1 where id = p_version;
  perform app_private.write_audit(org, 'administration', 'catalog.recipe_withdrawn', 'recipe_version', p_version::text, v.label, null,
    jsonb_build_object('note', p_note));
end;
$$;

create function app_private.catalog_answer_date_decision(p_key text, p_date date, p_evidence text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  org uuid := app_private.catalog_manager();
  d public.catalog_date_decisions%rowtype;
begin
  select * into d from public.catalog_date_decisions where organization_id = org and key = p_key for update;
  if not found or p_date is null or not isfinite(p_date) or length(btrim(coalesce(p_evidence, ''))) = 0 then
    raise exception 'A date answer needs the date and who confirmed it' using errcode = '22023';
  end if;
  if exists (select 1 from public.recipe_versions where date_decision_id = d.id and status = 'approved') then
    raise exception 'Versions already approved on this answer keep it' using errcode = '22023';
  end if;
  update public.catalog_date_decisions set answered_date = p_date, evidence = btrim(p_evidence), decided_by = auth.uid(), decided_at = now()
  where id = d.id;
  update public.catalog_review_items set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
    resolution = 'Answered: ' || p_date::text || ' (' || btrim(p_evidence) || ')'
  where organization_id = org and kind = 'recipe_effective_date' and dedupe_key = p_key and status = 'open';
  perform app_private.write_audit(org, 'administration', 'catalog.date_decision_answered', 'catalog_date_decision', d.id::text, p_key, null,
    jsonb_build_object('before', d.answered_date, 'after', p_date, 'evidence', p_evidence));
end;
$$;

-- ------------------------------------------------------------------ consumption eligibility
-- One entry per sold line. Valid lines come back eligible with the exact component quantities;
-- every blocked line says why and names the offending component or source row. Nothing is written.
-- Phase 6 stores an eligible result as the stock posting; the recipe version and line ids in the
-- result are the basis it must keep.
create function app_private.catalog_consumption(p_branch text, p_date date, p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  org uuid := app_private.current_org();
  entry jsonb;
  ordinal integer := 0;
  results jsonb := '[]'::jsonb;
  totals jsonb := '{}'::jsonb;
  reasons jsonb;
  warnings jsonb;
  comps jsonb;
  label text;
  key text;
  qty app_private.rat;
  item public.catalog_items%rowtype;
  alias_row public.catalog_source_labels%rowtype;
  v public.recipe_versions%rowtype;
  l record;
  c public.catalog_items%rowtype;
  factor jsonb;
  consumed app_private.rat;
  per_unit app_private.rat;
  total app_private.rat;
  ok_lines integer := 0;
  blocked_lines integer := 0;
  mapping_id uuid;
  b public.branches%rowtype;
begin
  if auth.uid() is null or org is null or p_date is null or not isfinite(p_date)
     or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 500 then
    raise exception 'Invalid consumption request' using errcode = '22023';
  end if;
  select * into b from public.branches where organization_id = org and code = p_branch and operates_in_app;
  if b.id is null or not (app_private.has_permission('recipes.manage') or app_private.has_permission('inventory.view', b.id)) then
    raise exception 'Consumption check access required' using errcode = '42501';
  end if;

  for entry in select * from jsonb_array_elements(p_lines) loop
    ordinal := ordinal + 1;
    reasons := '[]'::jsonb; warnings := '[]'::jsonb; comps := '[]'::jsonb;
    item := null; v := null; alias_row := null; mapping_id := null;
    label := nullif(btrim(coalesce(entry ->> 'label', '')), '');
    key := app_private.catalog_label_key(label);
    qty := case when (entry ->> 'quantity') ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then app_private.parse_rational(entry ->> 'quantity') end;

    if qty is null then
      reasons := reasons || jsonb_build_array(jsonb_build_object('code', 'invalid_quantity', 'detail', entry ->> 'quantity'));
    end if;

    -- 1. Which sold item is it? Foodics name -> approved mapping, or the item itself.
    if entry ? 'product_id' then
      if (entry ->> 'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select * into item from public.catalog_items where id = (entry ->> 'product_id')::uuid and organization_id = org and kind = 'sold';
      end if;
      if item.id is null then reasons := reasons || jsonb_build_array(jsonb_build_object('code', 'unknown_product')); end if;
    elsif label is null then
      reasons := reasons || jsonb_build_array(jsonb_build_object('code', 'unmapped_name'));
    else
      select * into alias_row from public.catalog_source_labels
      where organization_id = org and source_system = 'foodics' and label_key = key and status = 'approved';
      if alias_row.id is not null then
        mapping_id := alias_row.id;
        select * into item from public.catalog_items where id = alias_row.item_id;
      else
        select * into alias_row from public.catalog_source_labels
        where organization_id = org and source_system = 'foodics' and label_key = key
        order by (status = 'pending') desc limit 1;
        if alias_row.id is null then
          reasons := reasons || jsonb_build_array(jsonb_build_object('code', 'unmapped_name', 'detail', label));
        elsif alias_row.status = 'rejected' then
          reasons := reasons || jsonb_build_array(jsonb_build_object('code', 'mapping_rejected', 'detail', label));
        else
          reasons := reasons || jsonb_build_array(jsonb_build_object('code', 'mapping_pending', 'detail', label));
        end if;
      end if;
    end if;

    -- 2. Which recipe applies on this business date?
    if item.id is not null then
      if item.status = 'discontinued' and p_date > item.discontinued_on then
        warnings := warnings || jsonb_build_array(jsonb_build_object('code', 'discontinued_before_date', 'detail', item.discontinued_on));
      end if;
      select * into v from public.recipe_versions
      where product_id = item.id and status = 'approved' and effective_range @> p_date;
      if v.id is null then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code',
          case when exists (select 1 from public.recipe_versions where product_id = item.id and status = 'approved') then 'no_recipe_for_date'
               when exists (select 1 from public.recipe_versions where product_id = item.id and status = 'draft') then 'recipe_not_approved'
               else 'no_recipe' end));
      else
        -- 3. Every recipe line must convert exactly into its component's base unit.
        for l in select * from public.recipe_lines where version_id = v.id order by line_no loop
          select * into c from public.catalog_items where id = l.component_id;
          if l.component_id is null or l.quantity_num is null then
            reasons := reasons || jsonb_build_array(jsonb_build_object('code', 'recipe_line_incomplete', 'line_no', l.line_no, 'source_ref', l.source_ref));
            continue;
          end if;
          factor := app_private.catalog_unit_factor(l.component_id, l.unit_code);
          if factor ? 'error' then
            reasons := reasons || jsonb_build_array(jsonb_build_object('code', factor ->> 'error', 'line_no', l.line_no,
              'component_id', c.id, 'component_ar', c.name_ar, 'component_en', c.name_en, 'unit', l.unit_code,
              'base_unit', c.base_unit, 'source_ref', l.source_ref));
            continue;
          end if;
          if qty is not null then
            per_unit := app_private.rat_mul(app_private.rat_mul(row(l.quantity_num, l.quantity_den)::app_private.rat,
              row((factor ->> 'num')::numeric, (factor ->> 'den')::numeric)::app_private.rat),
              row(v.yield_den, v.yield_num)::app_private.rat);
            consumed := app_private.rat_mul(per_unit, qty);
            comps := comps || jsonb_build_array(jsonb_build_object(
              'line_id', l.id, 'line_no', l.line_no, 'item_id', c.id, 'kind', c.kind, 'name_ar', c.name_ar, 'name_en', c.name_en,
              'base_unit', c.base_unit, 'quantity', app_private.rat_json(consumed),
              'recipe_quantity', app_private.rat_json(row(l.quantity_num, l.quantity_den)::app_private.rat), 'recipe_unit', l.unit_code,
              'source_ref', l.source_ref));
          end if;
        end loop;
        if not exists (select 1 from public.recipe_lines where version_id = v.id) then
          reasons := reasons || jsonb_build_array(jsonb_build_object('code', 'recipe_empty'));
        end if;
      end if;
    end if;

    if jsonb_array_length(reasons) = 0 then
      ok_lines := ok_lines + 1;
      for l in select (e ->> 'item_id')::uuid as item_id, e as c from jsonb_array_elements(comps) e loop
        if totals ? (l.item_id::text) then
          total := row((totals -> (l.item_id::text) -> 'sum' ->> 'num')::numeric,
                       (totals -> (l.item_id::text) -> 'sum' ->> 'den')::numeric)::app_private.rat;
        else
          total := row(0, 1)::app_private.rat;
        end if;
        total := app_private.rat_add(total, row((l.c -> 'quantity' ->> 'num')::numeric, (l.c -> 'quantity' ->> 'den')::numeric)::app_private.rat);
        totals := jsonb_set(totals, array[l.item_id::text], jsonb_build_object(
          'item_id', l.item_id, 'name_ar', l.c ->> 'name_ar', 'name_en', l.c ->> 'name_en', 'kind', l.c ->> 'kind',
          'base_unit', l.c ->> 'base_unit', 'sum', jsonb_build_object('num', trim_scale(total.n)::text, 'den', trim_scale(total.d)::text),
          'quantity', app_private.rat_json(total)));
      end loop;
    else
      blocked_lines := blocked_lines + 1;
      comps := '[]'::jsonb;
    end if;

    results := results || jsonb_build_array(jsonb_build_object(
      'index', ordinal, 'ref', entry ->> 'ref', 'label', label, 'quantity', entry ->> 'quantity',
      'status', case when jsonb_array_length(reasons) = 0 then 'eligible' else 'blocked' end,
      'reasons', reasons, 'warnings', warnings,
      'product', case when item.id is null then null else jsonb_build_object('id', item.id, 'name_ar', item.name_ar, 'name_en', item.name_en) end,
      'mapping_id', mapping_id,
      'recipe', case when v.id is null then null else jsonb_build_object('id', v.id, 'version_no', v.version_no, 'label', v.label,
        'effective_from', v.effective_from, 'effective_to', v.effective_to) end,
      'components', comps));
  end loop;

  return jsonb_build_object('date', p_date, 'branch', p_branch, 'eligible', ok_lines, 'blocked', blocked_lines, 'lines', results,
    'totals', (select coalesce(jsonb_agg(t - 'sum' order by t ->> 'name_ar'), '[]'::jsonb) from jsonb_each(totals) e(k, t)));
end;
$$;

-- ------------------------------------------------------------------ API wrappers
-- Each public function only forwards to the checked private command with the caller's own session.
create function public.app_catalog_save_item(p_id uuid, p_kind text, p_name_ar text, p_name_en text, p_code text, p_section text,
  p_base_unit text, p_sales_unit text, p_purchase_unit text, p_storage_unit text, p_is_add_on boolean, p_expected_version integer)
returns uuid language sql set search_path = '' as $$
  select app_private.catalog_save_item(p_id, p_kind, p_name_ar, p_name_en, p_code, p_section, p_base_unit, p_sales_unit,
    p_purchase_unit, p_storage_unit, p_is_add_on, p_expected_version);
$$;
create function public.app_catalog_set_item_status(p_id uuid, p_status text, p_on date, p_expected_version integer)
returns void language sql set search_path = '' as $$
  select app_private.catalog_set_item_status(p_id, p_status, p_on, p_expected_version);
$$;
create function public.app_catalog_save_conversion(p_item uuid, p_unit text, p_quantity text, p_basis text)
returns uuid language sql set search_path = '' as $$
  select app_private.catalog_save_conversion(p_item, p_unit, p_quantity, p_basis);
$$;
create function public.app_catalog_map_name(p_source text, p_label text, p_item uuid, p_decision text, p_basis text)
returns uuid language sql set search_path = '' as $$
  select app_private.catalog_map_name(p_source, p_label, p_item, p_decision, p_basis);
$$;
create function public.app_catalog_queue_names(p_labels jsonb)
returns integer language sql set search_path = '' as $$
  select app_private.catalog_queue_names(p_labels);
$$;
create function public.app_catalog_resolve_review(p_id uuid, p_status text, p_note text)
returns void language sql set search_path = '' as $$
  select app_private.catalog_resolve_review(p_id, p_status, p_note);
$$;
create function public.app_catalog_create_recipe(p_product uuid, p_label text, p_copy_from uuid, p_note text)
returns uuid language sql set search_path = '' as $$
  select app_private.catalog_create_recipe(p_product, p_label, p_copy_from, p_note);
$$;
create function public.app_catalog_save_recipe_line(p_version uuid, p_line uuid, p_component uuid, p_quantity text, p_unit text,
  p_note text, p_expected_version integer)
returns uuid language sql set search_path = '' as $$
  select app_private.catalog_save_recipe_line(p_version, p_line, p_component, p_quantity, p_unit, p_note, p_expected_version);
$$;
create function public.app_catalog_remove_recipe_line(p_line uuid, p_expected_version integer)
returns void language sql set search_path = '' as $$
  select app_private.catalog_remove_recipe_line(p_line, p_expected_version);
$$;
create function public.app_catalog_set_recipe_meta(p_version uuid, p_label text, p_yield text, p_note text, p_expected_version integer)
returns void language sql set search_path = '' as $$
  select app_private.catalog_set_recipe_meta(p_version, p_label, p_yield, p_note, p_expected_version);
$$;
create function public.app_catalog_approve_recipe(p_version uuid, p_from date, p_to date, p_expected_version integer)
returns jsonb language sql set search_path = '' as $$
  select app_private.catalog_approve_recipe(p_version, p_from, p_to, p_expected_version);
$$;
create function public.app_catalog_withdraw_recipe(p_version uuid, p_note text)
returns void language sql set search_path = '' as $$
  select app_private.catalog_withdraw_recipe(p_version, p_note);
$$;
create function public.app_catalog_answer_date_decision(p_key text, p_date date, p_evidence text)
returns void language sql set search_path = '' as $$
  select app_private.catalog_answer_date_decision(p_key, p_date, p_evidence);
$$;
create function public.app_catalog_consumption(p_branch text, p_date date, p_lines jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select app_private.catalog_consumption(p_branch, p_date, p_lines);
$$;

-- Internal helpers stay private; commands are executable by signed-in people and check permission inside.
revoke all on function
  app_private.rat_make(numeric, numeric), app_private.rat_mul(app_private.rat, app_private.rat),
  app_private.rat_add(app_private.rat, app_private.rat), app_private.rat_text(app_private.rat),
  app_private.rat_exact(app_private.rat), app_private.rat_json(app_private.rat), app_private.parse_rational(text),
  app_private.catalog_label_key(text), app_private.catalog_manager(), app_private.catalog_unit_factor(uuid, text),
  app_private.catalog_item_json(public.catalog_items), app_private.catalog_close_reviews(uuid, text, text),
  app_private.can_read_catalog()
  from public, anon, authenticated, service_role;
grant execute on function app_private.can_read_catalog() to authenticated;

revoke all on function
  app_private.catalog_save_item(uuid, text, text, text, text, text, text, text, text, text, boolean, integer),
  app_private.catalog_set_item_status(uuid, text, date, integer),
  app_private.catalog_save_conversion(uuid, text, text, text),
  app_private.catalog_map_name(text, text, uuid, text, text),
  app_private.catalog_queue_names(jsonb),
  app_private.catalog_resolve_review(uuid, text, text),
  app_private.catalog_create_recipe(uuid, text, uuid, text),
  app_private.catalog_save_recipe_line(uuid, uuid, uuid, text, text, text, integer),
  app_private.catalog_remove_recipe_line(uuid, integer),
  app_private.catalog_set_recipe_meta(uuid, text, text, text, integer),
  app_private.catalog_approve_recipe(uuid, date, date, integer),
  app_private.catalog_withdraw_recipe(uuid, text),
  app_private.catalog_answer_date_decision(text, date, text),
  app_private.catalog_consumption(text, date, jsonb),
  public.app_catalog_save_item(uuid, text, text, text, text, text, text, text, text, text, boolean, integer),
  public.app_catalog_set_item_status(uuid, text, date, integer),
  public.app_catalog_save_conversion(uuid, text, text, text),
  public.app_catalog_map_name(text, text, uuid, text, text),
  public.app_catalog_queue_names(jsonb),
  public.app_catalog_resolve_review(uuid, text, text),
  public.app_catalog_create_recipe(uuid, text, uuid, text),
  public.app_catalog_save_recipe_line(uuid, uuid, uuid, text, text, text, integer),
  public.app_catalog_remove_recipe_line(uuid, integer),
  public.app_catalog_set_recipe_meta(uuid, text, text, text, integer),
  public.app_catalog_approve_recipe(uuid, date, date, integer),
  public.app_catalog_withdraw_recipe(uuid, text),
  public.app_catalog_answer_date_decision(text, date, text),
  public.app_catalog_consumption(text, date, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  app_private.catalog_save_item(uuid, text, text, text, text, text, text, text, text, text, boolean, integer),
  app_private.catalog_set_item_status(uuid, text, date, integer),
  app_private.catalog_save_conversion(uuid, text, text, text),
  app_private.catalog_map_name(text, text, uuid, text, text),
  app_private.catalog_queue_names(jsonb),
  app_private.catalog_resolve_review(uuid, text, text),
  app_private.catalog_create_recipe(uuid, text, uuid, text),
  app_private.catalog_save_recipe_line(uuid, uuid, uuid, text, text, text, integer),
  app_private.catalog_remove_recipe_line(uuid, integer),
  app_private.catalog_set_recipe_meta(uuid, text, text, text, integer),
  app_private.catalog_approve_recipe(uuid, date, date, integer),
  app_private.catalog_withdraw_recipe(uuid, text),
  app_private.catalog_answer_date_decision(text, date, text),
  app_private.catalog_consumption(text, date, jsonb),
  public.app_catalog_save_item(uuid, text, text, text, text, text, text, text, text, text, boolean, integer),
  public.app_catalog_set_item_status(uuid, text, date, integer),
  public.app_catalog_save_conversion(uuid, text, text, text),
  public.app_catalog_map_name(text, text, uuid, text, text),
  public.app_catalog_queue_names(jsonb),
  public.app_catalog_resolve_review(uuid, text, text),
  public.app_catalog_create_recipe(uuid, text, uuid, text),
  public.app_catalog_save_recipe_line(uuid, uuid, uuid, text, text, text, integer),
  public.app_catalog_remove_recipe_line(uuid, integer),
  public.app_catalog_set_recipe_meta(uuid, text, text, text, integer),
  public.app_catalog_approve_recipe(uuid, date, date, integer),
  public.app_catalog_withdraw_recipe(uuid, text),
  public.app_catalog_answer_date_decision(text, date, text),
  public.app_catalog_consumption(text, date, jsonb)
  to authenticated;
