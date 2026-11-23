// Mutation checks for supabase/tests/phase8_checks.sql: each guard is removed INSIDE the check's own
// transaction (so nothing persists) and the file must then FAIL. The unmodified file must pass.
//
//   node scripts/phase8/mutation-check.mjs
//
// A structural assertion in §1 already notices some removals; the "behaviour" variants also delete
// that assertion, to show the behavioural cases catch the removal on their own.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { container } from "../phase3/db-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const original = readFileSync(path.join(root, "supabase", "tests", "phase8_checks.sql"), "utf8").replace(/\r\n/g, "\n");
const STRUCTURAL = /  -- One receipt movement per receipt line is a database constraint\.\n[\s\S]*?'unique movement per receipt line';\n/;
if (!STRUCTURAL.test(original) || !original.startsWith("-- Phase 8")) throw new Error("check file layout changed");

/** The migration's receipt-line guard with only its over-receipt test removed (movement checks kept). */
function guardWithoutOverReceipt() {
  const migration = readFileSync(path.join(root, "supabase", "migrations", "20261125090000_phase8_replenishment.sql"), "utf8").replace(/\r\n/g, "\n");
  const start = migration.indexOf("create function app_private.purchase_order_receipt_line_guard()");
  const fn = migration.slice(start, migration.indexOf("\n$$;", start) + 4);
  const test = /  if app_private\.rat_lt\(outstanding[\s\S]*?\n  end if;\n/;
  if (start < 0 || !test.test(fn)) throw new Error("guard layout changed");
  return fn.replace("create function", "create or replace function").replace(test, "");
}

const MUTATIONS = [
  ["none (control: the file passes)", "", false],
  ["drop the one-movement-per-receipt-line constraint",
    "alter table public.purchase_order_receipt_lines drop constraint purchase_order_receipt_lines_one_movement;", false],
  ["drop it (behaviour only: structural assertion removed)",
    "alter table public.purchase_order_receipt_lines drop constraint purchase_order_receipt_lines_one_movement;", true],
  ["drop the over-receipt guard (the receipt-line trigger)",
    "drop trigger purchase_order_receipt_lines_guard on public.purchase_order_receipt_lines;", false],
  ["keep the trigger but remove only its over-receipt test", guardWithoutOverReceipt(), false],
  ["drop the append-only trigger of purchase_order_lines",
    "drop trigger purchase_order_lines_no_change on public.purchase_order_lines;", false],
  ["drop the append-only trigger of purchase_order_receipt_lines",
    "drop trigger purchase_order_receipt_lines_no_change on public.purchase_order_receipt_lines;", false],
  ["drop the order decision guard (purchase_orders_guard)",
    "drop trigger purchase_orders_guard on public.purchase_orders;", false],
  ["drop the order RLS policy",
    "drop policy purchase_orders_read on public.purchase_orders;", false],
  ["open the order RLS policy to every signed-in person",
    "drop policy purchase_orders_read on public.purchase_orders; create policy purchase_orders_read on public.purchase_orders for select to authenticated using (true);", false],
  ["drop the deferred has-a-receipt-line trigger",
    "drop trigger stock_movements_purchase_order_receipt on public.stock_movements;", false],
];

let bad = 0;
for (const [name, mutation, dropStructural] of MUTATIONS) {
  // A function replacer: the mutation text contains "$$", which a replacement string would collapse.
  let sql = original.replace(/^begin;\n/m, () => `begin;\n${mutation}\n`);
  if (dropStructural) sql = sql.replace(STRUCTURAL, "");
  const run = spawnSync("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A"],
    { input: sql, encoding: "utf8" });
  const failed = run.status !== 0;
  const reason = (run.stderr.match(/ERROR:\s+(.*)/) ?? [])[1] ?? "";
  const expectFail = mutation !== "";
  const ok = failed === expectFail;
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "BAD "} ${name}: ${failed ? `phase8_checks.sql FAILED — ${reason.slice(0, 220)}` : "phase8_checks.sql passed"}`);
}
console.log(bad === 0 ? "\nEvery mutation was caught." : `\n${bad} mutation(s) NOT caught.`);
process.exit(bad === 0 ? 0 : 1);
