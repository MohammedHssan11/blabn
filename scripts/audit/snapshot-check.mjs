// Two database sessions on a DISPOSABLE local stack: an Excel export is claimed while a stock write on the
// same branch is still open. The export reads stock "as of" its snapshot instant, so the figures at that
// instant must not change when the open write commits afterwards.
//
//   npm run test:audit:snapshot        (commits synthetic rows; reset the database afterwards)
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { container } from "../phase3/db-check.mjs";
import { createReporter, run } from "../phase3/lib.mjs";

if (container === "supabase_db_balaban-dev") throw new Error("test:audit:snapshot writes rows: point it at a disposable local stack.");
const { check, state } = createReporter();
const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"];

function psql(sql) {
  const result = run("docker", args, { input: sql });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}
const session = (sql) => new Promise((resolve, reject) => {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("close", (code) => (code === 0 ? resolve(out.split("\n").map((l) => l.trim()).filter(Boolean)) : reject(new Error(err))));
  child.stdin.end(sql);
});

const user = randomUUID();
const actAs = `select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); set local role authenticated;`;
psql(`begin;
  insert into auth.users(id, email) values ('${user}', 'snapshot.${user}@audit.test');
  insert into public.employees(id, organization_id, full_name) select '${user}', organization_id, 'Snapshot check' from public.branches where code = 'maarif';
  insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, 'snapshot.${user}@audit.test' from public.employees where id = '${user}';
  insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('${user}', null, 'system_admin');
  insert into app_private.report_export_owners (organization_id, staff_id) select organization_id, user_id from public.staff_accounts where user_id = '${user}'
    on conflict (organization_id) do update set staff_id = excluded.staff_id;
  commit;`);
const [today, local] = psql(`select public.business_date_of(now(), timezone, business_day_rollover)::text || '|' ||
  to_char(now() at time zone timezone, 'YYYY-MM-DD"T"HH24:MI') from public.branches where code = 'maarif';`)[0].split("|");
const item = psql(`begin; ${actAs}
  select public.app_catalog_save_item(null, 'ingredient', 'Snapshot ${user.slice(0, 8)}', null, null, null, 'pc', null, null, null, false, null);
  commit;`).at(-1);
const exportId = psql(`begin; ${actAs}
  select public.app_report_export_request('inventory', array['maarif'], '{"mode":"day","date":"${today}"}', 'en', false, gen_random_uuid()) ->> 'id';
  commit;`).at(-1);

// The writer stamps its movement inside the branch lock, then holds the transaction open.
const writer = session(`begin; ${actAs}
  select public.app_stock_command('maarif', '${today}', 'movement', gen_random_uuid(),
    '{"kind":"receipt","item":"${item}","quantity":"5","local":"${local}"}');
  select pg_sleep(5);
  commit;`);
await new Promise((resolve) => setTimeout(resolve, 2000));
const count = `select count(*) from public.stock_movements m join public.stock_postings p on p.id = m.posting_id
  where m.item_id = '${item}' and p.posted_at <= (select snapshot_at from public.report_exports where id = '${exportId}')`;
const reader = await session(`begin; ${actAs} select public.app_report_export_claim('${exportId}') ->> 'claim'; commit;
  begin; ${actAs} ${count}; commit;`);
const during = reader.at(-1);
await writer;
const after = psql(`${count};`).at(-1);
check("the export was claimed", reader.includes("claimed"), reader.join(" | "));
check("stock as of the snapshot is the same while reading and after the open write commits", during === after,
  `movements as of the snapshot: ${during} when claimed, ${after} afterwards`);
console.log(`\n${state.checks} checks, ${state.failures} failed.`);
process.exit(state.failures === 0 ? 0 : 1);
