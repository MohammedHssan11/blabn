// Mutation checks for supabase/tests/audit_phases6_10_checks.sql: each guard of migration 20261128090000 is
// removed or weakened INSIDE the check's own transaction (so nothing persists) and the file must then FAIL.
// The unmodified file must pass.
//
//   node scripts/audit/mutation-check.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { container } from "../phase3/db-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const text = (...parts) => readFileSync(path.join(root, ...parts), "utf8").replace(/\r\n/g, "\n");
const original = text("supabase", "tests", "audit_phases6_10_checks.sql");
const migration = text("supabase", "migrations", "20261128090000_audit_phases6_10_fixes.sql");
if (!original.startsWith("-- Regression checks")) throw new Error("check file layout changed");

/** A function of the migration with one piece of its body replaced. */
function weakened(header, find, replacement) {
  const start = migration.indexOf(header);
  const fn = migration.slice(start, migration.indexOf("\n$$;", start) + 4);
  if (start < 0 || !fn.includes(find)) throw new Error(`migration layout changed: ${header}`);
  return fn.replace("create function", "create or replace function").replace(find, () => replacement);
}

const MUTATIONS = [
  ["none (control: the file passes)", ""],
  ["drop the base-unit trigger", "drop trigger catalog_items_keep_stock_unit on public.catalog_items;"],
  ["the base-unit guard ignores counts", weakened("create function app_private.catalog_item_keeps_stock_unit()",
    "     or exists (select 1 from public.stock_counts c where c.item_id = old.id)\n", "")],
  ["the base-unit guard ignores order lines", weakened("create function app_private.catalog_item_keeps_stock_unit()",
    "     or exists (select 1 from public.purchase_order_lines l where l.item_id = old.id)\n", "")],
  ["the base-unit guard ignores planning quantities", weakened("create function app_private.catalog_item_keeps_stock_unit()",
    "s.safety_num is not null or s.pack_num is not null or s.min_order_num is not null", "false")],
  ["drop the opening guard on movements", "drop trigger stock_movements_not_before_opening on public.stock_movements;"],
  ["drop the opening guard on adjustments", "drop trigger stock_adjustments_not_before_opening on public.stock_adjustments;"],
  ["a reversed opening still blocks", weakened("create function app_private.stock_not_before_opening()",
    "\n               and not exists (select 1 from public.stock_movements r where r.reverses_id = o.id)", "")],
  ["the decision is not checked", `create or replace function public.app_stock_command(p_branch text, p_date date, p_command text, p_request uuid, p_payload jsonb)
    returns jsonb language sql volatile set search_path = '' as $$ select app_private.stock_command(p_branch, p_date, p_command, p_request, p_payload); $$;`],
  ["the export claim does not wait for writers", weakened("create or replace function public.app_report_export_claim(",
    "  perform 1 from public.branches b where b.id = any (v_row.branch_ids) order by b.id for share;\n", "")],
  ["the period orders are limited to the newest 500", weakened("create function public.app_purchase_orders_in_period(",
    "where o.branch_id = b.id and (", "where o.branch_id = b.id and o.order_no > (select max(order_no) - 500 from public.purchase_orders) and (")],
  ["today ignores the branch rollover", weakened("create function public.app_business_today()",
    "public.business_date_of(now(), b.timezone, b.business_day_rollover)", "(now() at time zone b.timezone)::date + 1")],
  ["local times ignore the order given", weakened("create function public.app_local_times(", "order by u.n", "order by u.t")],
];

let bad = 0;
for (const [name, mutation] of MUTATIONS) {
  // A function replacer: the mutation text contains "$$", which a replacement string would collapse.
  const sql = original.replace(/^begin;\n/m, () => `begin;\n${mutation}\n`);
  const run = spawnSync("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A"],
    { input: sql, encoding: "utf8" });
  const failed = run.status !== 0;
  const reason = (run.stderr.match(/ERROR:\s+(.*)/) ?? [])[1] ?? "";
  const ok = failed === (mutation !== "");
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "BAD "} ${name}: ${failed ? `FAILED — ${reason.slice(0, 200)}` : "passed"}`);
}
console.log(bad === 0 ? "\nEvery mutation was caught." : `\n${bad} mutation(s) NOT caught.`);
process.exit(bad === 0 ? 0 : 1);
