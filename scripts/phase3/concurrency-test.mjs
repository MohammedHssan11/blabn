// Concurrency regression test for the "at least one active System Admin" rule.
//
//   npm run test:concurrency        (local Supabase running, migrations applied)
//
// Several administrators change each other AT THE SAME TIME in separate PostgreSQL transactions
// that are forced to overlap (the first holds its transaction open while the others start). Every
// session runs as the `authenticated` role with its own JWT subject, calling the same commands the
// application calls. Each scenario runs in its own organization and repeats. After each round the
// test counts the active System Admins of that organization: it must never be zero, and the
// transactions that lost the race must have been refused with permission_denied or last_admin.

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectId = (/project_id\s*=\s*"([^"]+)"/.exec(readFileSync(path.join(root, "supabase", "config.toml"), "utf8")) ?? [])[1];
const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
const ROUNDS = Number(process.env.CONCURRENCY_ROUNDS ?? 3);

function psqlSync(sql) {
  const run = spawnSync("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A"], { input: sql, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`psql failed: ${run.stderr}`);
  return run.stdout.trim();
}

/** One transaction as one person; resolves with what psql printed. */
function session({ uid, statement, delayMs, holdSeconds }) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-t"], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", () => resolve(out));
      child.stdin.write(
        [
          "begin;",
          "set local role authenticated;",
          `select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);`,
          `${statement};`,
          holdSeconds > 0 ? `select pg_sleep(${holdSeconds});` : "",
          "commit;",
          "",
        ].join("\n"),
      );
      child.stdin.end();
    }, delayMs);
  });
}

function seedOrganization(adminCount) {
  const org = randomUUID();
  const admins = Array.from({ length: adminCount }, () => randomUUID());
  const rows = admins
    .map((id, i) => `('${id}', 'concurrency-${org.slice(0, 8)}-${i}@example.test')`)
    .join(",");
  const staff = admins
    .map((id, i) => {
      const emp = randomUUID();
      return `insert into public.employees (id, organization_id, full_name) values ('${emp}', '${org}', 'Admin ${i}');
insert into public.staff_accounts (user_id, employee_id, organization_id, email) values ('${id}', '${emp}', '${org}', 'concurrency-${org.slice(0, 8)}-${i}@example.test');
insert into public.staff_group_assignments (staff_id, group_key) values ('${id}', 'system_admin');`;
    })
    .join("\n");
  psqlSync(`insert into public.organizations (id, name) values ('${org}', 'Concurrency test ${org.slice(0, 8)}');
insert into auth.users (id, email) values ${rows};
${staff}`);
  return { org, admins };
}

const activeAdmins = (org) =>
  Number(
    psqlSync(`select count(*) from public.staff_accounts s join public.employees e on e.id = s.employee_id
join public.staff_group_assignments a on a.staff_id = s.user_id and a.group_key = 'system_admin'
where s.organization_id = '${org}' and s.is_active and e.is_active;`),
  );

const disable = (target) => `select public.admin_set_staff_active('${target}', false, 'concurrency test')`;
const strip = (target) => `select public.admin_set_staff_access('${target}', '{}'::jsonb)`;

const scenarios = [
  {
    name: "two administrators disable each other",
    admins: 2,
    plan: ([a, b]) => [
      { uid: a, statement: disable(b), delayMs: 0, holdSeconds: 2.5 },
      { uid: b, statement: disable(a), delayMs: 600, holdSeconds: 0 },
    ],
  },
  {
    name: "two administrators remove each other's System Admin group",
    admins: 2,
    plan: ([a, b]) => [
      { uid: a, statement: strip(b), delayMs: 0, holdSeconds: 2.5 },
      { uid: b, statement: strip(a), delayMs: 600, holdSeconds: 0 },
    ],
  },
  {
    name: "one disables, the other removes the group",
    admins: 2,
    plan: ([a, b]) => [
      { uid: a, statement: disable(b), delayMs: 0, holdSeconds: 2.5 },
      { uid: b, statement: strip(a), delayMs: 600, holdSeconds: 0 },
    ],
  },
  {
    name: "three administrators in a ring (A disables B, B disables C, C disables A)",
    admins: 3,
    plan: ([a, b, c]) => [
      { uid: a, statement: disable(b), delayMs: 0, holdSeconds: 3 },
      { uid: b, statement: disable(c), delayMs: 500, holdSeconds: 2 },
      { uid: c, statement: disable(a), delayMs: 1000, holdSeconds: 0 },
    ],
  },
];

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` -> ${detail}` : ""}`);
};

console.log("Control: the same change made one after the other is refused by the last-admin rule");
{
  const { org, admins } = seedOrganization(2);
  const first = await session({ uid: admins[0], statement: disable(admins[1]), delayMs: 0, holdSeconds: 0 });
  const second = await session({ uid: admins[1], statement: disable(admins[0]), delayMs: 0, holdSeconds: 0 });
  check("the first change commits", !/ERROR/.test(first), first.trim());
  check("the second is refused (the caller is no longer an administrator)", /permission_denied/.test(second), second.trim());
  check("one active System Admin remains", activeAdmins(org) === 1);
}

for (const scenario of scenarios) {
  console.log(`\n${scenario.name} (${ROUNDS} rounds)`);
  for (let round = 1; round <= ROUNDS; round += 1) {
    const { org, admins } = seedOrganization(scenario.admins);
    const outputs = await Promise.all(scenario.plan(admins).map(session));
    const refused = outputs.filter((o) => /ERROR/.test(o));
    const reasons = refused.map((o) => (/last_admin/.test(o) ? "last_admin" : /permission_denied/.test(o) ? "permission_denied" : o.trim().slice(0, 80)));
    const remaining = activeAdmins(org);
    check(`round ${round}: at least one active System Admin remains (${remaining})`, remaining >= 1, `${remaining} active`);
    check(`round ${round}: a transaction that lost the race was refused (${reasons.join(", ") || "none"})`, refused.length >= 1 && reasons.every((r) => r === "last_admin" || r === "permission_denied"), outputs.map((o) => o.trim().slice(0, 100)).join(" | "));
  }
}

console.log(failures === 0 ? "\nConcurrency checks passed." : `\n${failures} concurrency check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
