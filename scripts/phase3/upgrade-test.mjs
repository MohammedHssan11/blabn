// Migration tests on the isolated LOCAL Supabase instance (project balaban-dev):
//   A. upgrade   - build the Phase 2 baseline (migrations 1-4 + seed), run the Phase 2 checks and the
//                  preserved deny-all baseline check, then apply the Phase 3 migrations on top and run
//                  the Phase 2 and Phase 3 checks;
//   B. fresh     - rebuild from scratch (all migrations + seed) and run the same checks;
//   C. equality  - the upgraded and the freshly built schemas are identical.
//   D-K. later upgrade paths (migration 08 with a flagged account; Phase 4 -> 5; 5 -> 6; 6 -> 7; 7 -> 8; 8 -> 9;
//        9 -> safety-stock percentage; Phase 10 -> audit fixes).
// Usage: npm run db:upgrade-test   (Docker running, `npx supabase start` done)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { container, runSqlFile } from "./db-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOUNDARY = "20261121000004";
let failures = 0;

function step(name, fn) {
  try {
    const detail = fn();
    console.log(`  ok   ${name}${detail ? ` -> ${detail}` : ""}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}\n${String(error.message).split("\n").map((l) => `       ${l}`).join("\n")}`);
  }
}

function supabase(args) {
  const run = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["supabase", ...args], {
    cwd: process.env.SUPABASE_TEST_WORKDIR ?? root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (run.status !== 0) throw new Error(`supabase ${args.join(" ")} failed\n${run.stdout}\n${run.stderr}`);
  return `${run.stdout}${run.stderr}`;
}

function psql(query) {
  const run = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-c", query],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stdout.trim();
}

function schemaDump() {
  const dump = spawnSync(
    "docker",
    ["exec", container, "pg_dump", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner", "--no-privileges", "--schema=public", "--schema=app_private"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (dump.status !== 0) throw new Error(dump.stderr);
  const tables = psql(
    "select n.nspname||'.'||c.relname||' '||coalesce(c.relacl::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and c.relkind in ('r','v') order by 1",
  );
  const functions = psql(
    "select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') order by 1",
  );
  // pg_dump writes a random \restrict token on its first and last lines; drop it before comparing.
  const body = dump.stdout.split("\n").filter((line) => !/^\\(un)?restrict /.test(line)).join("\n");
  const columns = psql(
    "select c.relname||'.'||a.attname||' '||a.attacl::text from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null order by 1",
  );
  return `${body}\n--- table privileges\n${tables}\n--- column privileges\n${columns}\n--- function privileges\n${functions}`;
}

console.log("A. Upgrade from the Phase 2 baseline");
step(`reset to migration ${BOUNDARY} (Phase 2 baseline, with seed)`, () => {
  supabase(["db", "reset", "--version", BOUNDARY]);
  if (psql("select to_regclass('public.staff_accounts') is not null") !== "f") {
    throw new Error("Phase 3 tables exist at the Phase 2 boundary");
  }
  return psql("select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations");
});
step("seed rows are present at the boundary", () => {
  const rows = psql("select count(*) from public.business_days");
  if (rows !== "10") throw new Error(`expected 10 business days, found ${rows}`);
  return `${rows} business days`;
});
step("Phase 2 checks at the boundary (phase2_checks.sql)", () => runSqlFile("phase2_checks.sql"));
step("Phase 2 deny-all baseline preserved at the boundary (phase2_boundary_checks.sql)", () => runSqlFile("phase2_boundary_checks.sql"));
step("apply the Phase 3 migrations (supabase migration up)", () => {
  supabase(["migration", "up"]);
  return psql("select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations");
});
step("existing Phase 2 data survived the upgrade", () => {
  const counts = psql(
    "select (select count(*) from public.business_days)||'/'||(select count(*) from public.cash_counts)||'/'||(select count(*) from public.comparison_figures)||'/'||(select count(*) from public.branches)",
  );
  if (counts !== "10/2/3/3") throw new Error(`unexpected counts ${counts}`);
  return `business days/cash counts/comparison figures/branches = ${counts}`;
});
step("Phase 2 checks after the upgrade", () => runSqlFile("phase2_checks.sql"));
step("Phase 3 checks after the upgrade (phase3_checks.sql)", () => runSqlFile("phase3_checks.sql"));
let upgraded = "";
step("dump the upgraded schema", () => {
  upgraded = schemaDump();
});

console.log("B. Fresh build from all migrations");
step("db reset (all migrations + seed)", () => {
  supabase(["db", "reset"]);
  return `${psql("select count(*) from supabase_migrations.schema_migrations")} migrations applied`;
});
step("Phase 2 checks on the fresh build", () => runSqlFile("phase2_checks.sql"));
step("Phase 3 checks on the fresh build", () => runSqlFile("phase3_checks.sql"));
let fresh = "";
step("dump the fresh schema", () => {
  fresh = schemaDump();
});

console.log("C. Upgraded and fresh schemas are identical");
step("schema, table privileges and function privileges match", () => {
  if (!upgraded || !fresh) throw new Error("a dump is missing");
  if (upgraded !== fresh) {
    const a = upgraded.split("\n");
    const b = fresh.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    throw new Error(`first difference at line ${at + 1}:\n  upgraded: ${a[at]}\n  fresh:    ${b[at]}`);
  }
  return `${upgraded.split("\n").length} lines compared`;
});

console.log("\nD. Upgrade of a database that already ran the first Phase 3 migrations (05-08) and holds a flagged account");
step("reset to migration 20261121000008 and create a staff account that must still choose a password", () => {
  supabase(["db", "reset", "--version", "20261121000008"]);
  if (psql("select to_regprocedure('app_private.password_fingerprint(uuid)') is not null") !== "f") throw new Error("migration 9 is already applied");
  psql(`insert into auth.users (id, email, encrypted_password) values ('d0000000-0000-4000-8000-000000000001', 'flagged@phase3.test', 'temporary-hash');
insert into public.employees (id, organization_id, full_name) values ('d0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Flagged Person');
insert into public.staff_accounts (user_id, employee_id, organization_id, email, must_change_password) values ('d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'flagged@phase3.test', true);
insert into public.branch_memberships (staff_id, branch_id) values ('d0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011');
insert into public.staff_group_assignments (staff_id, group_key, branch_id) values ('d0000000-0000-4000-8000-000000000001', 'cashier', '00000000-0000-4000-8000-000000000011');`);
});
step("a flagged account could still read business data before the fix (the gap)", () => {
  const rows = psql(`begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true); select count(*) from public.business_days; rollback;`)
    .split("\n").filter((l) => /^\d+$/.test(l.trim())).pop();
  if (rows !== "10") throw new Error(`expected the pre-fix gap (10 visible days), saw ${rows}`);
  return `${rows} days visible to the flagged account before migration 9`;
});
step("prepare a staff email that changed outside the old directory", () => {
  psql("update auth.users set email = 'confirmed@phase3.test' where id = 'd0000000-0000-4000-8000-000000000001'");
});
step("apply the remaining migrations (supabase migration up)", () => {
  supabase(["migration", "up"]);
});
step("the flagged account was fingerprinted and is now refused", () => {
  const fp = psql("select password_fingerprint is not null and must_change_password from public.staff_accounts where user_id = 'd0000000-0000-4000-8000-000000000001'");
  if (fp !== "t") throw new Error(`fingerprint not backfilled (${fp})`);
  const rows = psql(`begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true); select count(*) from public.business_days; rollback;`)
    .split("\n").filter((l) => /^\d+$/.test(l.trim())).pop();
  if (rows !== "0") throw new Error(`the flagged account still sees ${rows} days`);
  return "0 days visible";
});
step("the directory now reflects the confirmed email and records the correction", () => {
  const email = psql("select email from public.staff_accounts where user_id = 'd0000000-0000-4000-8000-000000000001'");
  const audit = psql("select (changes #>> '{before,email}') || ' -> ' || (changes #>> '{after,email}') from public.audit_log where action = 'staff.email_reconciled' and target_id = 'd0000000-0000-4000-8000-000000000001'");
  if (email !== "confirmed@phase3.test" || audit !== "flagged@phase3.test -> confirmed@phase3.test") {
    throw new Error("the email was not reconciled and audited");
  }
});
step("Phase 2 and Phase 3 checks after this second upgrade path", () => {
  psql("delete from public.staff_group_assignments where staff_id = 'd0000000-0000-4000-8000-000000000001'; delete from public.branch_memberships where staff_id = 'd0000000-0000-4000-8000-000000000001'; delete from public.staff_accounts where user_id = 'd0000000-0000-4000-8000-000000000001'; delete from public.employees where id = 'd0000000-0000-4000-8000-000000000002'; delete from auth.users where id = 'd0000000-0000-4000-8000-000000000001'");
  return `${runSqlFile("phase2_checks.sql")}; ${runSqlFile("phase3_checks.sql")}`;
});
step("its schema, table privileges and function privileges equal the fresh build", () => {
  const again = schemaDump();
  if (again !== fresh) {
    const a = again.split("\n");
    const b = fresh.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    throw new Error(`first difference at line ${at + 1}:\n  upgraded: ${a[at]}\n  fresh:    ${b[at]}`);
  }
});
console.log("\nE. Upgrade of a Phase 4 database to Phase 5 (catalog, units and recipes)");
const PHASE4_HEAD = "20261122001556";
step(`reset to migration ${PHASE4_HEAD} (Phase 4 head, with the base seed)`, () => {
  supabase(["db", "reset", "--version", PHASE4_HEAD]);
  if (psql("select to_regclass('public.catalog_items') is not null") !== "f") throw new Error("Phase 5 tables exist at the Phase 4 head");
  return runSqlFile("phase4_checks.sql");
});
step("the Phase 4 reference data exists before the upgrade", () => {
  const accounts = psql("select count(*) from public.operating_accounts");
  if (accounts !== "43") throw new Error(`expected 43 reviewed ledger accounts, found ${accounts}`);
  return `${accounts} ledger accounts, Maarif cutoff ${psql("select business_day_rollover from public.branches where code = 'maarif'")}`;
});
step("apply the Phase 5 migration (supabase migration up)", () => {
  supabase(["migration", "up"]);
  return psql("select max(version) from supabase_migrations.schema_migrations");
});
step("the catalog seed loads on the upgraded database", () => {
  const sql = readFileSync(path.join(root, "supabase", "seed_catalog.sql"), "utf8");
  const load = spawnSync("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A"], { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (load.status !== 0) throw new Error(load.stderr);
  return `${psql("select count(*) from public.catalog_items")} items, ${psql("select count(*) from public.recipe_lines")} recipe lines`;
});
step("the Phase 4 data survived", () => {
  if (psql("select count(*) from public.operating_accounts") !== "43" || psql("select business_day_rollover from public.branches where code = 'maarif'") !== "02:00:00") throw new Error("Phase 4 reference data changed");
  return "ledger accounts and the 02:00 cutoff are intact";
});
step("Phase 2, 3, 4 and 5 checks after the Phase 4 upgrade", () =>
  [runSqlFile("phase2_checks.sql"), runSqlFile("phase3_checks.sql"), runSqlFile("phase4_checks.sql"), runSqlFile("phase5_checks.sql")].join("; "));
step("its schema, table privileges and function privileges equal the fresh build", () => {
  const again = schemaDump();
  if (again !== fresh) {
    const a = again.split("\n");
    const b = fresh.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    throw new Error(`first difference at line ${at + 1}:\n  upgraded: ${a[at]}\n  fresh:    ${b[at]}`);
  }
});
step("a fresh build passes the Phase 4 and Phase 5 checks too", () => {
  supabase(["db", "reset"]);
  return [runSqlFile("phase4_checks.sql"), runSqlFile("phase5_checks.sql")].join("; ");
});

console.log("\nF. Upgrade of a Phase 5 database to Phase 6 (Product Mix, stock movements, counts and variance)");
const PHASE5_HEAD = "20261122120000";
step(`reset to migration ${PHASE5_HEAD} (Phase 5 head, with the base and catalog seeds)`, () => {
  supabase(["db", "reset", "--version", PHASE5_HEAD]);
  if (psql("select to_regclass('public.stock_movements') is not null") !== "f") throw new Error("Phase 6 tables exist at the Phase 5 head");
  return runSqlFile("phase5_checks.sql");
});
step("the Phase 5 catalog exists before the upgrade", () => {
  const counts = psql("select (select count(*) from public.catalog_items)||'/'||(select count(*) from public.recipe_lines)||'/'||(select count(*) from public.recipe_versions where status = 'approved')");
  if (counts !== "556/1721/0") throw new Error(`unexpected catalog counts ${counts}`);
  return `items/recipe lines/approved versions = ${counts}`;
});
step("apply the Phase 6 migration (supabase migration up)", () => {
  supabase(["migration", "up"]);
  return psql("select max(version) from supabase_migrations.schema_migrations");
});
step("the catalog survived and inventory.consume reached the existing groups", () => {
  const counts = psql("select (select count(*) from public.catalog_items)||'/'||(select count(*) from public.recipe_lines)");
  const groups = psql("select string_agg(group_key, ',' order by group_key) from public.group_permissions where permission_key = 'inventory.consume'");
  if (counts !== "556/1721" || groups !== "manager,storekeeper,system_admin") throw new Error(`catalog ${counts}, groups ${groups}`);
  return `catalog ${counts}; inventory.consume -> ${groups}`;
});
step("Phase 2 to 6 checks after the Phase 5 upgrade", () =>
  ["phase2_checks.sql", "phase3_checks.sql", "phase4_checks.sql", "phase5_checks.sql", "phase6_checks.sql"].map(runSqlFile).join("; "));
step("its schema, table privileges and function privileges equal the fresh build", () => {
  const again = schemaDump();
  if (again !== fresh) {
    const a = again.split("\n");
    const b = fresh.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    throw new Error(`first difference at line ${at + 1}:\n  upgraded: ${a[at]}\n  fresh:    ${b[at]}`);
  }
});
step("a fresh build passes the Phase 6 checks too", () => {
  supabase(["db", "reset"]);
  return runSqlFile("phase6_checks.sql");
});

console.log("\nG. Upgrade of a Phase 6 database to Phase 7 (comparison revisions, settings and permissions)");
const PHASE6_HEAD = "20261123120000";
const FIGURES = "select coalesce(json_agg(json_build_array(branch_id, business_date, net_sales, order_count, source) order by branch_id, business_date)::text, '[]') from public.comparison_figures";
let figuresBefore = "";
step(`reset to migration ${PHASE6_HEAD} (Phase 6 head, with the base and catalog seeds)`, () => {
  supabase(["db", "reset", "--version", PHASE6_HEAD]);
  if (psql("select to_regclass('public.comparison_entries') is not null") !== "f") throw new Error("Phase 7 tables exist at the Phase 6 head");
  if (psql("select relkind from pg_class where oid = 'public.comparison_figures'::regclass") !== "r") throw new Error("comparison_figures is not a table at the Phase 6 head");
  return runSqlFile("phase6_checks.sql");
});
step("a Phase 6 figure with both sales and orders exists before the upgrade", () => {
  psql("insert into public.comparison_figures (id, branch_id, business_date, net_sales, order_count, source) values ('00000000-0000-4000-8000-000000000499', '00000000-0000-4000-8000-000000000013', '2026-11-17', 88.50, 12, 'reporting_only')");
  figuresBefore = psql(FIGURES);
  const count = psql("select count(*) from public.comparison_figures");
  if (count !== "4") throw new Error(`expected 4 figures, found ${count}`);
  return `${count} figures`;
});
step("apply the Phase 7 migration (supabase migration up)", () => {
  supabase(["migration", "up"]);
  return psql("select max(version) from supabase_migrations.schema_migrations");
});
step("every Phase 6 figure became revision 1 and reads back unchanged", () => {
  const after = psql(FIGURES);
  if (after !== figuresBefore) throw new Error(`figures changed:\n  before: ${figuresBefore}\n  after:  ${after}`);
  const entries = psql("select count(*)||'/'||count(*) filter (where revision = 1 and active) from public.comparison_entries");
  if (entries !== "5/5") throw new Error(`expected 5 active revision-1 values (4 sales, 1 order count), found ${entries}`);
  const settings = psql("select count(*) from public.comparison_branch_settings");
  if (settings !== "0") throw new Error("settings must start undecided");
  // The history is append-only, so the extra test figure is removed with triggers bypassed (test only):
  // the Phase 2 checks expect exactly the three seeded figures.
  psql("set session_replication_role = replica; delete from public.comparison_entries where request_id = '00000000-0000-4000-8000-000000000499'; set session_replication_role = origin;");
  if (psql("select count(*) from public.comparison_figures") !== "3") throw new Error("the extra test figure was not removed");
  return `entries ${entries}; settings undecided; figures identical`;
});
step("Phase 2 to 7 checks after the Phase 6 upgrade", () =>
  ["phase2_checks.sql", "phase3_checks.sql", "phase4_checks.sql", "phase5_checks.sql", "phase6_checks.sql", "phase7_checks.sql"].map(runSqlFile).join("; "));
step("its schema, table privileges and function privileges equal the fresh build", () => {
  const again = schemaDump();
  if (again !== fresh) {
    const a = again.split("\n");
    const b = fresh.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    throw new Error(`first difference at line ${at + 1}:\n  upgraded: ${a[at]}\n  fresh:    ${b[at]}`);
  }
});
step("a fresh build passes the Phase 7 checks too", () => {
  supabase(["db", "reset"]);
  return runSqlFile("phase7_checks.sql");
});
console.log("\nH. Upgrade of a Phase 7 database to Phase 8 (purchase orders, receipts and planning)");
const PHASE7_HEAD = "20261124090000";
const MOVEMENTS = "select coalesce(json_agg(json_build_array(id, branch_id, business_date, posting_id, item_id, kind, direction, quantity_num, quantity_den, base_unit, entered_quantity, entered_unit, occurred_local, occurred_at, source, reference, note, reverses_id) order by id)::text, '[]') from public.stock_movements";
let movementsBefore = "";
step(`reset to migration ${PHASE7_HEAD} (Phase 7 head, with the base and catalog seeds)`, () => {
  supabase(["db", "reset", "--version", PHASE7_HEAD]);
  if (psql("select to_regclass('public.purchase_orders') is not null") !== "f") throw new Error("Phase 8 tables exist at the Phase 7 head");
  return runSqlFile("phase7_checks.sql");
});
step("Phase 7 stock movements exist before the upgrade (a receipt, a waste entry and a reversal by a synthetic storekeeper)", () => {
  // Committed, unlike the SQL check files: a storekeeper records three movements on a seeded stock item.
  psql(`begin;
    insert into auth.users(id, email) values ('a8a00000-0000-4000-8000-000000000001', 'upgrade.keeper@phase8.test');
    insert into public.employees(id, organization_id, full_name) select 'a8a00000-0000-4000-8000-000000000001', organization_id, 'Upgrade keeper' from public.branches where code = 'maarif';
    insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, 'upgrade.keeper@phase8.test' from public.employees where id = 'a8a00000-0000-4000-8000-000000000001';
    insert into public.branch_memberships(staff_id, branch_id) select 'a8a00000-0000-4000-8000-000000000001', id from public.branches where code = 'maarif';
    insert into public.staff_group_assignments(staff_id, branch_id, group_key) select 'a8a00000-0000-4000-8000-000000000001', id, 'storekeeper' from public.branches where code = 'maarif';
    select set_config('request.jwt.claims', '{"sub":"a8a00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    set local role authenticated;
    select public.app_stock_command('maarif', '2026-11-10', 'movement', 'a8a00000-0000-4000-8000-0000000000a1',
      jsonb_build_object('kind', 'receipt', 'item', (select id from public.catalog_items where stock_tracked and kind <> 'sold' and base_unit = 'pc' order by name_ar limit 1), 'quantity', '12', 'local', '2026-11-10T09:00'));
    select public.app_stock_command('maarif', '2026-11-10', 'movement', 'a8a00000-0000-4000-8000-0000000000a2',
      jsonb_build_object('kind', 'waste', 'item', (select id from public.catalog_items where stock_tracked and kind <> 'sold' and base_unit = 'pc' order by name_ar limit 1), 'quantity', '2', 'local', '2026-11-10T12:00'));
    select public.app_stock_command('maarif', '2026-11-10', 'reverse', 'a8a00000-0000-4000-8000-0000000000a3',
      jsonb_build_object('posting', (select id from public.stock_postings where request_id = 'a8a00000-0000-4000-8000-0000000000a2'), 'reason', 'upgrade test'));
    commit;`);
  movementsBefore = psql(MOVEMENTS);
  const count = psql("select count(*) from public.stock_movements");
  if (count !== "3") throw new Error(`expected 3 movements, found ${count}`);
  return `${count} movements`;
});
step("apply the Phase 8 migration (supabase migration up)", () => {
  supabase(["migration", "up"]);
  return psql("select max(version) from supabase_migrations.schema_migrations");
});
step("existing stock movements are unchanged; receive reached the groups; settings start empty", () => {
  const after = psql(MOVEMENTS);
  if (after !== movementsBefore) throw new Error(`movements changed:\n  before: ${movementsBefore}\n  after:  ${after}`);
  const groups = psql("select string_agg(group_key, ',' order by group_key) from public.group_permissions where permission_key = 'purchase_order.receive'");
  if (groups !== "storekeeper,system_admin") throw new Error(`purchase_order.receive -> ${groups}`);
  const empty = psql("select (select count(*) from public.replenishment_settings)+(select count(*) from public.replenishment_item_settings)+(select count(*) from public.replenishment_source_settings)+(select count(*) from public.purchase_orders)");
  if (empty !== "0") throw new Error(`expected no settings and no orders, found ${empty}`);
  // The movements and their synthetic author are test data: remove them (triggers bypassed, test only) so the
  // earlier check files see the database they expect.
  psql(`set session_replication_role = replica;
    delete from public.stock_movements; delete from public.stock_postings; delete from public.audit_log where actor_id = 'a8a00000-0000-4000-8000-000000000001';
    delete from public.staff_group_assignments where staff_id = 'a8a00000-0000-4000-8000-000000000001'; delete from public.branch_memberships where staff_id = 'a8a00000-0000-4000-8000-000000000001';
    delete from public.staff_accounts where user_id = 'a8a00000-0000-4000-8000-000000000001'; delete from public.employees where id = 'a8a00000-0000-4000-8000-000000000001';
    delete from auth.users where id = 'a8a00000-0000-4000-8000-000000000001';
    set session_replication_role = origin;`);
  return `3 movements identical (all columns); purchase_order.receive -> ${groups}; 0 settings, 0 orders`;
});
step("Phase 2 to 8 checks after the Phase 7 upgrade", () =>
  ["phase2_checks.sql", "phase3_checks.sql", "phase4_checks.sql", "phase5_checks.sql", "phase6_checks.sql", "phase7_checks.sql", "phase8_checks.sql"].map(runSqlFile).join("; "));
step("its schema, table privileges and function privileges equal the fresh build", () => {
  const again = schemaDump();
  if (again !== fresh) {
    const a = again.split("\n");
    const b = fresh.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    throw new Error(`first difference at line ${at + 1}:\n  upgraded: ${a[at]}\n  fresh:    ${b[at]}`);
  }
});
step("a fresh build passes the Phase 8 checks too", () => {
  supabase(["db", "reset"]);
  return runSqlFile("phase8_checks.sql");
});
console.log("\nI. Upgrade of a Phase 8 database to Phase 9 (Excel report exports and their private storage)");
const PHASE8_HEAD = "20261125090000";
const SAVED = `select json_build_array(
  (select coalesce(json_agg(json_build_array(id, revision, state, data, expected_at_count, cash_change, custody_change) order by id), '[]') from public.operating_day_revisions),
  (select coalesce(json_agg(json_build_array(id, item_id, kind, direction, quantity_num, quantity_den) order by id), '[]') from public.stock_movements),
  (select coalesce(json_agg(json_build_array(id, value, active, purpose) order by id), '[]') from public.comparison_entries))::text`;
let savedBefore = "";
step(`reset to migration ${PHASE8_HEAD} (Phase 8 head)`, () => {
  supabase(["db", "reset", "--version", PHASE8_HEAD]);
  if (psql("select to_regclass('public.report_exports') is not null") !== "f") throw new Error("Phase 9 tables exist at the Phase 8 head");
  if (psql("select count(*) from storage.buckets where id = 'report-exports'") !== "0") throw new Error("the export bucket exists at the Phase 8 head");
  // phase8_checks.sql now pins the safety-stock percentage (20261127090000); it runs after the upgrade.
  return runSqlFile("phase7_checks.sql");
});
step("Phase 8 data exists before the upgrade (a closed-day revision and a stock receipt by synthetic staff)", () => {
  psql(`begin;
    insert into auth.users(id, email) values ('a9a00000-0000-4000-8000-000000000001', 'upgrade.admin@phase9.test');
    insert into public.employees(id, organization_id, full_name) select 'a9a00000-0000-4000-8000-000000000001', organization_id, 'Upgrade admin' from public.branches where code = 'maarif';
    insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, 'upgrade.admin@phase9.test' from public.employees where id = 'a9a00000-0000-4000-8000-000000000001';
    insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('a9a00000-0000-4000-8000-000000000001', null, 'system_admin');
    -- Also the branch cashier, so the saved day can name them.
    insert into public.branch_memberships(staff_id, branch_id) select 'a9a00000-0000-4000-8000-000000000001', id from public.branches where code = 'maarif';
    insert into public.staff_group_assignments(staff_id, branch_id, group_key) select 'a9a00000-0000-4000-8000-000000000001', id, 'cashier' from public.branches where code = 'maarif';
    select set_config('request.jwt.claims', '{"sub":"a9a00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    set local role authenticated;
    select public.app_operating_command('maarif', '2026-11-10', 'save', 0, 'a9a00000-0000-4000-8000-0000000000b1',
      '{"sales":10000,"posCash":10000,"card":0,"orders":2,"cashier":"a9a00000-0000-4000-8000-000000000001","openingCash":0,"openingCustody":0}');
    select public.app_stock_command('maarif', '2026-11-10', 'movement', 'a9a00000-0000-4000-8000-0000000000b2',
      jsonb_build_object('kind', 'receipt', 'item', (select id from public.catalog_items where stock_tracked and kind <> 'sold' and base_unit is not null order by name_ar limit 1), 'quantity', '3', 'local', '2026-11-10T09:00'));
    commit;`);
  savedBefore = psql(SAVED);
  return `${psql("select count(*) from public.operating_day_revisions")} revision, ${psql("select count(*) from public.stock_movements")} movement`;
});
step("apply the Phase 9 migration and later ones (supabase migration up)", () => {
  supabase(["migration", "up"]);
  return psql("select max(version) from supabase_migrations.schema_migrations");
});
step("saved data unchanged; private bucket and storage policies created; no export yet", () => {
  const after = psql(SAVED);
  if (!savedBefore || savedBefore.startsWith('[[],')) throw new Error("no Phase 8 data was recorded before the upgrade");
  if (after !== savedBefore) throw new Error("saved Phase 4-8 data changed during the upgrade");
  const bucket = psql("select public::text || ':' || file_size_limit from storage.buckets where id = 'report-exports'");
  if (bucket !== "false:26214400") throw new Error(`bucket ${bucket}`);
  const policies = psql("select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where schemaname = 'storage' and policyname like 'report_exports_%'");
  if (policies !== "report_exports_download:SELECT,report_exports_upload:INSERT") throw new Error(`storage policies ${policies}`);
  const none = psql("select (select count(*) from public.report_exports) + (select count(*) from public.report_export_events)");
  if (none !== "0") throw new Error(`expected no export, found ${none}`);
  psql(`set session_replication_role = replica;
    delete from public.stock_movements; delete from public.stock_postings; delete from public.operating_day_revisions; delete from public.operating_days;
    delete from public.audit_log where actor_id = 'a9a00000-0000-4000-8000-000000000001';
    delete from public.staff_group_assignments where staff_id = 'a9a00000-0000-4000-8000-000000000001';
    delete from public.branch_memberships where staff_id = 'a9a00000-0000-4000-8000-000000000001';
    delete from public.staff_accounts where user_id = 'a9a00000-0000-4000-8000-000000000001'; delete from public.employees where id = 'a9a00000-0000-4000-8000-000000000001';
    delete from auth.users where id = 'a9a00000-0000-4000-8000-000000000001';
    set session_replication_role = origin;`);
  return `data identical; bucket ${bucket}; ${policies}; 0 exports`;
});
step("Phase 2 to 9 checks after the Phase 8 upgrade", () =>
  ["phase2_checks.sql", "phase3_checks.sql", "phase4_checks.sql", "phase5_checks.sql", "phase6_checks.sql", "phase7_checks.sql", "phase8_checks.sql", "phase9_checks.sql"].map(runSqlFile).join("; "));
step("its schema, table privileges and function privileges equal the fresh build", () => {
  const again = schemaDump();
  if (again !== fresh) {
    const a = again.split("\n");
    const b = fresh.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    throw new Error(`first difference at line ${at + 1}:\n  upgraded: ${a[at]}\n  fresh:    ${b[at]}`);
  }
});
console.log("J. Upgrade from the Phase 9 head to the safety-stock percentage (20261127090000)");
const PHASE9_HEAD = "20261126090000";
const SAVED_J = `select json_build_array(
  (select coalesce(json_agg((to_jsonb(s) - 'safety_percent') order by branch_id), '[]') from public.replenishment_settings s),
  (select coalesce(json_agg(to_jsonb(x) order by item_id), '[]') from public.replenishment_item_settings x),
  (select coalesce(json_agg(to_jsonb(o) order by id), '[]') from public.purchase_orders o),
  (select coalesce(json_agg(to_jsonb(l) order by id), '[]') from public.purchase_order_lines l))::text`;
let savedJ = "";
step(`reset to migration ${PHASE9_HEAD} (Phase 9 head)`, () => {
  supabase(["db", "reset", "--version", PHASE9_HEAD]);
  if (psql("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'replenishment_settings' and column_name = 'safety_percent'") !== "0") {
    throw new Error("safety_percent exists at the Phase 9 head");
  }
  return runSqlFile("phase9_checks.sql");
});
step("Phase 8 settings with a per-item safety quantity and a saved purchase order exist before the upgrade", () => {
  psql(`begin;
    insert into auth.users(id, email) values ('a9b00000-0000-4000-8000-000000000001', 'upgrade.admin@safety.test');
    insert into public.employees(id, organization_id, full_name) select 'a9b00000-0000-4000-8000-000000000001', organization_id, 'Upgrade admin' from public.branches where code = 'maarif';
    insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, 'upgrade.admin@safety.test' from public.employees where id = 'a9b00000-0000-4000-8000-000000000001';
    insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('a9b00000-0000-4000-8000-000000000001', null, 'system_admin');
    select set_config('request.jwt.claims', '{"sub":"a9b00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    set local role authenticated;
    select public.app_replenishment_settings_save('maarif', 0, 3, 1);
    select public.app_replenishment_item_settings_save('maarif', (select id from public.catalog_items where stock_tracked and kind <> 'sold' and base_unit is not null order by name_ar limit 1), 0, '5', null, null, null, 'factory');
    select public.app_purchase_order_command('maarif', 'create', 'a9b00000-0000-4000-8000-0000000000c1',
      jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item', (select id from public.catalog_items where stock_tracked and kind <> 'sold' and base_unit is not null order by name_ar limit 1), 'quantity', '7', 'source', 'factory'))));
    commit;`);
  savedJ = psql(SAVED_J);
  return `${psql("select count(*) from public.replenishment_item_settings where safety_num is not null")} item with a safety quantity, ${psql("select count(*) from public.purchase_order_lines")} order line`;
});
step("apply 20261127090000 (supabase migration up)", () => {
  supabase(["migration", "up"]);
  return psql("select max(version) from supabase_migrations.schema_migrations");
});
step("saved settings, orders and lines unchanged; the existing branch row takes the approved 20 %; the legacy quantity is kept, unused", () => {
  if (psql(SAVED_J) !== savedJ) throw new Error("saved replenishment settings or orders changed during the upgrade");
  const pct = psql("select string_agg(safety_percent::text, ',') from public.replenishment_settings");
  if (pct !== "20.00") throw new Error(`safety_percent after upgrade: ${pct}`);
  const legacy = psql("select safety_num || '/' || safety_den from public.replenishment_item_settings");
  if (legacy !== "5/1") throw new Error(`legacy safety quantity: ${legacy}`);
  psql(`set session_replication_role = replica;
    delete from public.purchase_order_events; delete from public.purchase_order_expected_dates; delete from public.purchase_order_lines; delete from public.purchase_orders;
    delete from public.replenishment_item_settings; delete from public.replenishment_settings;
    delete from public.audit_log where actor_id = 'a9b00000-0000-4000-8000-000000000001';
    delete from public.staff_group_assignments where staff_id = 'a9b00000-0000-4000-8000-000000000001';
    delete from public.staff_accounts where user_id = 'a9b00000-0000-4000-8000-000000000001'; delete from public.employees where id = 'a9b00000-0000-4000-8000-000000000001';
    delete from auth.users where id = 'a9b00000-0000-4000-8000-000000000001';
    set session_replication_role = origin;`);
  return `data identical; existing row ${pct} %; legacy item quantity ${legacy} kept`;
});
step("Phase 2 to 9 checks after the safety-stock upgrade", () =>
  ["phase2_checks.sql", "phase3_checks.sql", "phase4_checks.sql", "phase5_checks.sql", "phase6_checks.sql", "phase7_checks.sql", "phase8_checks.sql", "phase9_checks.sql"].map(runSqlFile).join("; "));
step("its schema, table privileges and function privileges equal the fresh build", () => {
  const again = schemaDump();
  if (again !== fresh) {
    const a = again.split("\n");
    const b = fresh.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    throw new Error(`first difference at line ${at + 1}:\n  upgraded: ${a[at]}\n  fresh:    ${b[at]}`);
  }
});
step("a fresh build passes the Phase 9 checks too", () => {
  supabase(["db", "reset"]);
  return runSqlFile("phase9_checks.sql");
});

console.log("K. Upgrade from the Phase 10 head to the audit fixes (20261128090000)");
const PHASE10_HEAD = "20261127090000";
const SAVED_K = `select json_build_array(
  (select coalesce(json_agg(to_jsonb(m) order by id), '[]') from public.stock_movements m),
  (select coalesce(json_agg(to_jsonb(p) order by id), '[]') from public.stock_postings p),
  (select coalesce(json_agg(to_jsonb(i) order by id), '[]') from public.catalog_items i))::text`;
let savedK = "";
step(`reset to migration ${PHASE10_HEAD} (Phase 10 head)`, () => {
  supabase(["db", "reset", "--version", PHASE10_HEAD]);
  if (psql("select to_regprocedure('public.app_business_today()') is null") !== "t") throw new Error("audit functions exist at the Phase 10 head");
  return runSqlFile("phase9_checks.sql");
});
step("stock saved before the upgrade, including an entry dated before an opening that the old rules allowed", () => {
  const item = "(select id from public.catalog_items where stock_tracked and kind <> 'sold' and base_unit is not null order by name_ar limit 1)";
  psql(`begin;
    insert into auth.users(id, email) values ('a9c00000-0000-4000-8000-000000000001', 'upgrade.admin@audit.test');
    insert into public.employees(id, organization_id, full_name) select 'a9c00000-0000-4000-8000-000000000001', organization_id, 'Upgrade admin' from public.branches where code = 'maarif';
    insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, 'upgrade.admin@audit.test' from public.employees where id = 'a9c00000-0000-4000-8000-000000000001';
    insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('a9c00000-0000-4000-8000-000000000001', null, 'system_admin');
    select set_config('request.jwt.claims', '{"sub":"a9c00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    set local role authenticated;
    select public.app_stock_command('maarif', '2026-11-10', 'opening', 'a9c00000-0000-4000-8000-0000000000d1',
      jsonb_build_object('item', ${item}, 'quantity', '10', 'local', '2026-11-10T08:00'));
    select public.app_stock_command('maarif', '2026-11-09', 'propose_adjustment', 'a9c00000-0000-4000-8000-0000000000d2',
      jsonb_build_object('item', ${item}, 'quantity', '1', 'direction', '-1', 'local', '2026-11-09T22:00', 'reason', 'before the opening'));
    commit;`);
  savedK = psql(SAVED_K);
  return `${psql("select count(*) from public.stock_movements")} movement, ${psql("select count(*) from public.stock_adjustments")} earlier adjustment`;
});
step("apply 20261128090000 (supabase migration up)", () => {
  supabase(["migration", "up"]);
  return psql("select max(version) from supabase_migrations.schema_migrations");
});
step("saved stock and catalog rows unchanged; the earlier adjustment can still be rejected", () => {
  if (psql(SAVED_K) !== savedK) throw new Error("saved stock or catalog rows changed during the upgrade");
  const status = psql(`begin;
    select set_config('request.jwt.claims', '{"sub":"a9c00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    set local role authenticated;
    select public.app_stock_command('maarif', '2026-11-09', 'decide_adjustment', 'a9c00000-0000-4000-8000-0000000000d3',
      jsonb_build_object('adjustment', (select id from public.stock_adjustments), 'decision', 'reject'));
    select status from public.stock_adjustments;
    rollback;`).split("\n").pop();
  if (status !== "rejected") throw new Error(`earlier adjustment: ${status}`);
  psql(`set session_replication_role = replica;
    delete from public.stock_adjustments; delete from public.stock_movements; delete from public.stock_postings;
    delete from public.audit_log where actor_id = 'a9c00000-0000-4000-8000-000000000001';
    delete from public.staff_group_assignments where staff_id = 'a9c00000-0000-4000-8000-000000000001';
    delete from public.staff_accounts where user_id = 'a9c00000-0000-4000-8000-000000000001'; delete from public.employees where id = 'a9c00000-0000-4000-8000-000000000001';
    delete from auth.users where id = 'a9c00000-0000-4000-8000-000000000001';
    set session_replication_role = origin;`);
  return "data identical; earlier adjustment rejected";
});
step("Phase 2 to 9 and audit checks after the upgrade", () =>
  ["phase2_checks.sql", "phase3_checks.sql", "phase4_checks.sql", "phase5_checks.sql", "phase6_checks.sql", "phase7_checks.sql", "phase8_checks.sql", "phase9_checks.sql", "audit_phases6_10_checks.sql"].map(runSqlFile).join("; "));
step("its schema, table privileges and function privileges equal the fresh build", () => {
  const again = schemaDump();
  if (again !== fresh) {
    const a = again.split("\n");
    const b = fresh.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    throw new Error(`first difference at line ${at + 1}:\n  upgraded: ${a[at]}\n  fresh:    ${b[at]}`);
  }
});
step("leave a fresh database (db reset)", () => {
  supabase(["db", "reset"]);
});

console.log(failures === 0 ? "\nMigration tests passed." : `\n${failures} migration check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
