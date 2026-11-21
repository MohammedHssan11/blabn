// Migration tests on the isolated LOCAL Supabase instance (project balaban-dev):
//   A. upgrade   - build the Phase 2 baseline (migrations 1-4 + seed), run the Phase 2 checks and the
//                  preserved deny-all baseline check, then apply the Phase 3 migrations on top and run
//                  the Phase 2 and Phase 3 checks;
//   B. fresh     - rebuild from scratch (all migrations + seed) and run the same checks;
//   C. equality  - the upgraded and the freshly built schemas are identical.
// Usage: npm run db:upgrade-test   (Docker running, `npx supabase start` done)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
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
    cwd: root,
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
step("leave a fresh database (db reset)", () => {
  supabase(["db", "reset"]);
});

console.log(failures === 0 ? "\nMigration tests passed." : `\n${failures} migration check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
