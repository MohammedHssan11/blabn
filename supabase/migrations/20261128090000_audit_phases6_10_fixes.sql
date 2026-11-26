-- Fixes from the independent audit of Phases 6-10 (docs/HANDOFF.md). No saved row changes.
--
--  1. An item with stock history keeps its base unit: every saved quantity is in that unit.
--  2. Nothing is recorded for an item before the date of its opening stock, on any path (recipe
--     consumption and adjustments included, not only manual movements and purchase-order receipts).
--  3. An adjustment decision must say approve or reject; a missing decision no longer rejects.
--  4. An Excel export takes its data snapshot only after writes in progress on its branches finish.
--  5. The inventory export finds every purchase order that touches its period, however old.
--  6. Pages ask the database for today's business date and for branch-local times.

-- ------------------------------------------------------------------ 1. the base unit of stock history
create function app_private.catalog_item_keeps_stock_unit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.stock_movements m where m.item_id = old.id)
     or exists (select 1 from public.stock_counts c where c.item_id = old.id)
     or exists (select 1 from public.stock_adjustments a where a.item_id = old.id)
     or exists (select 1 from public.purchase_order_lines l where l.item_id = old.id)
     or exists (select 1 from public.replenishment_item_settings s where s.item_id = old.id
                and (s.safety_num is not null or s.pack_num is not null or s.min_order_num is not null)) then
    raise exception 'The base unit of an item with stock, order or planning quantities is kept' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger catalog_items_keep_stock_unit before update of base_unit on public.catalog_items
  for each row when (old.base_unit is distinct from new.base_unit)
  execute function app_private.catalog_item_keeps_stock_unit();

-- ------------------------------------------------------------------ 2. nothing before the opening stock
-- A reversed opening no longer counts. Reversals keep their original date and are always allowed.
create function app_private.stock_not_before_opening()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.stock_movements o
             where o.branch_id = new.branch_id and o.item_id = new.item_id and o.kind = 'opening' and o.reverses_id is null
               and o.business_date > new.business_date
               and not exists (select 1 from public.stock_movements r where r.reverses_id = o.id)) then
    raise exception 'The opening stock of this item starts later' using errcode = 'CT007';
  end if;
  return new;
end;
$$;
create trigger stock_movements_not_before_opening before insert on public.stock_movements
  for each row when (new.kind <> 'opening' and new.reverses_id is null)
  execute function app_private.stock_not_before_opening();
create trigger stock_adjustments_not_before_opening before insert on public.stock_adjustments
  for each row execute function app_private.stock_not_before_opening();

-- ------------------------------------------------------------------ 3. a stated adjustment decision
create or replace function public.app_stock_command(p_branch text, p_date date, p_command text, p_request uuid, p_payload jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
begin
  if p_command = 'decide_adjustment' and coalesce(p_payload ->> 'decision', '') not in ('approve', 'reject') then
    raise exception 'Approve or reject the adjustment' using errcode = '22023';
  end if;
  return app_private.stock_command(p_branch, p_date, p_command, p_request, p_payload);
end;
$$;

-- ------------------------------------------------------------------ 4. the export snapshot
-- The Phase 9 function; only the branch lock and the instant taken after it are new. Every stock and
-- order command locks its branch row and stamps its rows inside that lock, so waiting for the lock
-- means no write stamped before the snapshot can still commit while the file is being read.
create or replace function public.app_report_export_claim(p_export uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row public.report_exports%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_row from public.report_exports where id = p_export for update;
  if not found or v_row.requested_by is distinct from auth.uid() then
    raise exception 'Export not found' using errcode = 'P0002';
  end if;
  if not app_private.report_export_allowed(p_export) then
    raise exception 'Export permission required' using errcode = '42501';
  end if;
  if v_row.status = 'complete' then
    return app_private.report_export_json(v_row) || jsonb_build_object('claim', 'complete');
  end if;
  if v_row.status = 'running' and v_row.claimed_at > v_now - interval '10 minutes' then
    return app_private.report_export_json(v_row) || jsonb_build_object('claim', 'busy');
  end if;
  perform 1 from public.branches b where b.id = any (v_row.branch_ids) order by b.id for share;
  v_now := clock_timestamp();
  update public.report_exports set status = 'running', attempt = attempt + 1, claimed_at = v_now, snapshot_at = v_now,
    last_error = null
  where id = p_export returning * into v_row;
  perform app_private.report_export_event(p_export, v_row.attempt, 'started', '{}'::jsonb);
  return app_private.report_export_json(v_row) || jsonb_build_object('claim', 'claimed',
    'upload_path', v_row.organization_id::text || '/' || v_row.id::text || '/attempt-' || v_row.attempt || '.xlsx');
end;
$$;

-- ------------------------------------------------------------------ 5. every order of a report period
-- Identifiers of the orders whose business date, original or current expected date, or an actual
-- receipt falls in the period. app_purchase_orders lists only the newest 500.
create function public.app_purchase_orders_in_period(p_branch text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
begin
  select * into b from public.branches where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if b.id is null or not app_private.purchase_order_reader(b.id) then
    raise exception 'Purchase-order access required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to < p_from or p_to - p_from > 31 then
    raise exception 'A period of at most one month is required' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(o.id order by o.order_no desc) from public.purchase_orders o
    where o.branch_id = b.id and (
      o.business_date between p_from and p_to
      or exists (select 1 from public.purchase_order_expected_dates x where x.order_id = o.id and x.expected_date between p_from and p_to
                 and (x.revision = 1 or x.revision = (select max(y.revision) from public.purchase_order_expected_dates y where y.order_id = o.id)))
      or exists (select 1 from public.purchase_order_receipts r where r.order_id = o.id and r.business_date between p_from and p_to))),
    '[]'::jsonb);
end;
$$;

-- ------------------------------------------------------------------ 6. the database's clock and time zone
create function public.app_business_today()
returns date language sql stable security definer set search_path = '' as $$
  select public.business_date_of(now(), b.timezone, b.business_day_rollover)
  from public.branches b
  where b.organization_id = app_private.current_org() and b.operates_in_app
  order by b.code limit 1;
$$;

-- Branch-local "YYYY-MM-DDTHH:MI" of each instant, in the order given. Reads no table.
create function public.app_local_times(p_instants timestamptz[])
returns text[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(to_char(u.t at time zone 'Africa/Casablanca', 'YYYY-MM-DD"T"HH24:MI') order by u.n), '{}')
  from unnest(p_instants) with ordinality u(t, n);
$$;

-- ------------------------------------------------------------------ grants
revoke all on function app_private.catalog_item_keeps_stock_unit(), app_private.stock_not_before_opening(),
  public.app_purchase_orders_in_period(text, date, date), public.app_business_today(), public.app_local_times(timestamptz[])
  from public, anon, authenticated, service_role;
grant execute on function public.app_purchase_orders_in_period(text, date, date), public.app_business_today(),
  public.app_local_times(timestamptz[])
  to authenticated;
