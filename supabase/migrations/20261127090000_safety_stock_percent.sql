-- Safety stock as an editable percentage of the forecast (approved by the project owner, 24 November 2026).
--
--   safety stock = forecast consumption for the coverage period x safety_percent / 100
--   recommended  = max(0, forecast + safety stock - usable stock at receipt - eligible confirmed incoming)
--
-- * The percentage is a branch setting on /replenishment/settings (System Admin: Abdo's account). It
--   defaults to 20 when no setting row exists; 0 is an explicit "no safety stock". 0-100, two decimals.
-- * Pack size and supplier minimum still apply afterwards, unchanged.
-- * A plan in review has no forecast and therefore no safety stock (null), never an invented one.
-- * The Phase 8 per-item safety quantity is no longer used. Existing values are kept untouched as history
--   (never converted to a percentage); the item settings command now refuses a new one.
-- * Saved purchase-order lines keep the plan they were created from (purchase_order_lines.plan), so the
--   basis of every earlier suggestion is unchanged.
-- Only the safety-stock lines differ from the Phase 8 functions (scripts/phase10/build_safety_migration.py).

alter table public.replenishment_settings
  add column safety_percent numeric(5, 2) not null default 20 check (safety_percent between 0 and 100);

comment on column public.replenishment_settings.safety_percent is
  'Safety stock as a percentage of forecast consumption for the coverage period. Default 20 (owner-approved, editable); 0 = none.';
comment on column public.replenishment_item_settings.safety_num is
  'Phase 8 per-item safety quantity (history only). Since 20261127090000 the plan uses replenishment_settings.safety_percent.';

create or replace function app_private.replenishment_item_plan(
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
  pct numeric;
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
  -- Safety stock: a percentage of the forecast for the coverage period (default 20 %, explicit 0 allowed).
  select rs.safety_percent into pct from public.replenishment_settings rs where rs.branch_id = b.id;
  pct := coalesce(pct, 20);
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

  if jsonb_array_length(reasons) = 0 then
    safety := app_private.rat_mul(forecast, app_private.rat_make(round(pct * 100), 10000));
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
    'safety', app_private.rat_json_or_null(safety),
    'safety_percent', pct,
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

create or replace function public.app_replenishment_settings(p_branch text)
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
    'safety_percent', coalesce(s.safety_percent, 20),
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

create or replace function public.app_replenishment_item_settings_save(
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
  if nullif(btrim(coalesce(p_safety, '')), '') is not null then
    raise exception 'Safety stock is the branch percentage of the forecast; it is not set per item' using errcode = '22023';
  end if;
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
  v_before := case when s.item_id is null then null else jsonb_build_object(
    'pack', s.pack_num || '/' || s.pack_den, 'min_order', s.min_order_num || '/' || s.min_order_den,
    'shelf_life_days', s.shelf_life_days, 'source', s.source) end;
  if s.item_id is null then
    insert into public.replenishment_item_settings (branch_id, item_id, safety_num, safety_den, pack_num, pack_den, min_order_num, min_order_den,
      shelf_life_days, source, updated_by)
    values (b.id, i.id, safety.n, safety.d, pack.n, pack.d, minq.n, minq.d, p_shelf_life_days, p_source, auth.uid()) returning * into s;
  else
    update public.replenishment_item_settings set pack_num = pack.n, pack_den = pack.d,
      min_order_num = minq.n, min_order_den = minq.d, shelf_life_days = p_shelf_life_days, source = p_source,
      revision = revision + 1, updated_by = auth.uid(), updated_at = now()
    where branch_id = b.id and item_id = i.id returning * into s;
  end if;
  v_after := jsonb_build_object('pack', s.pack_num || '/' || s.pack_den,
    'min_order', s.min_order_num || '/' || s.min_order_den, 'shelf_life_days', s.shelf_life_days, 'source', s.source);
  perform app_private.write_audit(b.organization_id, 'administration', 'replenishment.item_settings_changed', 'catalog_item',
    i.id::text, i.name_ar, b.id, jsonb_build_object('before', v_before, 'after', v_after, 'revision', s.revision));
  return jsonb_build_object('revision', s.revision);
end;
$$;

drop function public.app_replenishment_settings_save(text, integer, integer, integer);

create function public.app_replenishment_settings_save(p_branch text, p_expected integer, p_min_observations integer, p_coverage_days integer,
  p_safety_percent numeric default null)
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
     or (p_min_observations is not null and p_min_observations not between 1 and 13)
     or (p_safety_percent is not null and (p_safety_percent < 0 or p_safety_percent > 100 or p_safety_percent <> round(p_safety_percent, 2))) then
    raise exception 'Invalid replenishment settings' using errcode = '22023';
  end if;
  perform 1 from public.branches where id = b.id for update;
  select * into s from public.replenishment_settings where branch_id = b.id;
  if coalesce(s.revision, 0) <> p_expected then
    raise exception 'Replenishment settings have changed' using errcode = '40001';
  end if;
  v_before := jsonb_build_object('min_observations', s.min_observations, 'coverage_days', coalesce(s.coverage_days, 1),
    'safety_percent', coalesce(s.safety_percent, 20));
  if s.branch_id is null then
    insert into public.replenishment_settings (branch_id, min_observations, coverage_days, safety_percent, updated_by)
    values (b.id, p_min_observations, p_coverage_days, coalesce(p_safety_percent, 20), auth.uid()) returning * into s;
  else
    update public.replenishment_settings set min_observations = p_min_observations, coverage_days = p_coverage_days,
      safety_percent = coalesce(p_safety_percent, safety_percent),
      revision = revision + 1, updated_by = auth.uid(), updated_at = now() where branch_id = b.id returning * into s;
  end if;
  perform app_private.write_audit(b.organization_id, 'administration', 'replenishment.settings_changed', 'replenishment_settings',
    b.id::text, b.code, b.id, jsonb_build_object('before', v_before,
      'after', jsonb_build_object('min_observations', s.min_observations, 'coverage_days', s.coverage_days,
        'safety_percent', s.safety_percent), 'revision', s.revision));
  return jsonb_build_object('revision', s.revision);
end;
$$;

revoke all on function public.app_replenishment_settings_save(text, integer, integer, integer, numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.app_replenishment_settings_save(text, integer, integer, integer, numeric) to authenticated;
