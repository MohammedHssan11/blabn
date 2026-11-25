"""One-off generator for supabase/migrations/20261127090000_safety_stock_percent.sql.

It copies the Phase 8 function bodies verbatim and changes only the safety-stock lines, so the rest
of the planning arithmetic stays byte-for-byte the reviewed Phase 8 code. Run once; the migration is
the committed artifact (re-running with --check verifies it is still what this script produces).
"""
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
src = (root / "supabase/migrations/20261125090000_phase8_replenishment.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
out = root / "supabase/migrations/20261127090000_safety_stock_percent.sql"


def function(name):
    start = src.index(f"create function {name}(")
    end = src.index("\n$$;\n", start) + len("\n$$;\n")
    return src[start:end]


def sub(text, old, new):
    assert text.count(old) == 1, old[:80]
    return text.replace(old, new)


plan = function("app_private.replenishment_item_plan").replace("create function", "create or replace function", 1)
plan = sub(plan, "  safety app_private.rat;\n", "  safety app_private.rat;\n  pct numeric;\n")
plan = sub(plan, "  select * into src from public.replenishment_source_settings where branch_id = b.id and source = st.source;\n",
           "  select * into src from public.replenishment_source_settings where branch_id = b.id and source = st.source;\n"
           "  -- Safety stock: a percentage of the forecast for the coverage period (default 20 %, explicit 0 allowed).\n"
           "  select rs.safety_percent into pct from public.replenishment_settings rs where rs.branch_id = b.id;\n"
           "  pct := coalesce(pct, 20);\n")
plan = sub(plan,
           "  safety := case when st.safety_num is null then row(0, 1)::app_private.rat else row(st.safety_num, st.safety_den)::app_private.rat end;\n"
           "  if jsonb_array_length(reasons) = 0 then\n",
           "  if jsonb_array_length(reasons) = 0 then\n"
           "    safety := app_private.rat_mul(forecast, app_private.rat_make(round(pct * 100), 10000));\n")
plan = sub(plan, "    'safety', app_private.rat_json(safety),\n    'safety_set', st.safety_num is not null,\n",
           "    'safety', app_private.rat_json_or_null(safety),\n    'safety_percent', pct,\n")

settings = function("public.app_replenishment_settings").replace("create function", "create or replace function", 1)
settings = sub(settings, "'min_observations', s.min_observations, 'coverage_days', coalesce(s.coverage_days, 1), 'revision', coalesce(s.revision, 0),",
               "'min_observations', s.min_observations, 'coverage_days', coalesce(s.coverage_days, 1), 'revision', coalesce(s.revision, 0),\n"
               "    'safety_percent', coalesce(s.safety_percent, 20),")

save = function("public.app_replenishment_settings_save")
save = sub(save, "p_min_observations integer, p_coverage_days integer)", "p_min_observations integer, p_coverage_days integer,\n  p_safety_percent numeric default null)")
save = sub(save, "     or (p_min_observations is not null and p_min_observations not between 1 and 13) then",
           "     or (p_min_observations is not null and p_min_observations not between 1 and 13)\n"
           "     or (p_safety_percent is not null and (p_safety_percent < 0 or p_safety_percent > 100 or p_safety_percent <> round(p_safety_percent, 2))) then")
save = sub(save, "v_before := jsonb_build_object('min_observations', s.min_observations, 'coverage_days', coalesce(s.coverage_days, 1));",
           "v_before := jsonb_build_object('min_observations', s.min_observations, 'coverage_days', coalesce(s.coverage_days, 1),\n"
           "    'safety_percent', coalesce(s.safety_percent, 20));")
save = sub(save, "    insert into public.replenishment_settings (branch_id, min_observations, coverage_days, updated_by)\n"
                 "    values (b.id, p_min_observations, p_coverage_days, auth.uid()) returning * into s;",
           "    insert into public.replenishment_settings (branch_id, min_observations, coverage_days, safety_percent, updated_by)\n"
           "    values (b.id, p_min_observations, p_coverage_days, coalesce(p_safety_percent, 20), auth.uid()) returning * into s;")
save = sub(save, "set min_observations = p_min_observations, coverage_days = p_coverage_days,",
           "set min_observations = p_min_observations, coverage_days = p_coverage_days,\n"
           "      safety_percent = coalesce(p_safety_percent, safety_percent),")
save = sub(save, "'after', jsonb_build_object('min_observations', s.min_observations, 'coverage_days', s.coverage_days), 'revision', s.revision));",
           "'after', jsonb_build_object('min_observations', s.min_observations, 'coverage_days', s.coverage_days,\n"
           "        'safety_percent', s.safety_percent), 'revision', s.revision));")

item = function("public.app_replenishment_item_settings_save").replace("create function", "create or replace function", 1)
item = sub(item, "  i := app_private.stock_item(b.organization_id, p_item::text);\n",
           "  i := app_private.stock_item(b.organization_id, p_item::text);\n"
           "  if nullif(btrim(coalesce(p_safety, '')), '') is not null then\n"
           "    raise exception 'Safety stock is the branch percentage of the forecast; it is not set per item' using errcode = '22023';\n"
           "  end if;\n")
item = sub(item, "v_before := case when s.item_id is null then null else jsonb_build_object('safety', s.safety_num || '/' || s.safety_den,\n    'pack',",
           "v_before := case when s.item_id is null then null else jsonb_build_object(\n    'pack',")
item = sub(item, "    update public.replenishment_item_settings set safety_num = safety.n, safety_den = safety.d, pack_num = pack.n, pack_den = pack.d,",
           "    update public.replenishment_item_settings set pack_num = pack.n, pack_den = pack.d,")
item = sub(item, "  v_after := jsonb_build_object('safety', s.safety_num || '/' || s.safety_den, 'pack',", "  v_after := jsonb_build_object('pack',")

header = """-- Safety stock as an editable percentage of the forecast (approved by the project owner, 24 November 2026).
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

"""
grants = """
drop function public.app_replenishment_settings_save(text, integer, integer, integer);

""" + save + """
revoke all on function public.app_replenishment_settings_save(text, integer, integer, integer, numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.app_replenishment_settings_save(text, integer, integer, integer, numeric) to authenticated;
"""
text = header + plan + "\n" + settings + "\n" + item + grants
if "--check" in sys.argv:
    sys.exit(0 if out.exists() and out.read_text(encoding="utf-8") == text else "migration differs from the generator")
out.write_text(text, encoding="utf-8", newline="\n")
print(f"wrote {out}")
