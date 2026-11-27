// Phases 13-14 concurrency checks with real, simultaneous database sessions on a DISPOSABLE stack.
//
//   node scripts/attendance/concurrency-test.mjs
//
//   1. the same attempt completed by two sessions at the same instant -> one event;
//   2. a completion racing a new attempt for the same employee from another kiosk (20 rounds) -> no
//      deadlock, never two events for one action, never two pending attempts;
//   3. six employees created at the same instant -> six different, consecutive IDs;
//   4. the same correction request sent twice at once -> one correction;
//   5. check-ins of two different employees at once -> both recorded.
// Setup data is committed in the disposable database; the run ends with a db reset.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { container } from "../phase3/db-check.mjs";
import { createReporter, loadEnv, run } from "../phase3/lib.mjs";

const env = loadEnv();
const apiUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
if (container === "supabase_db_balaban-dev" || apiUrl.port === "55321") {
  throw new Error("The attendance concurrency test writes and resets its database: use a disposable local stack.");
}
const { check, section, state } = createReporter();

function psql(sql) {
  const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"], { input: sql });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout.trim();
}
/** Runs one SQL session asynchronously; resolves with its output and errors. */
function session(sql) {
  return new Promise((resolve) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out: out.trim(), err }));
    child.stdin.end(sql);
  });
}
const at = (ms) => new Date(Date.now() + ms).toISOString();
const waitUntil = (iso) => `select pg_sleep(greatest(0, extract(epoch from ('${iso}'::timestamptz - clock_timestamp()))));`;
const as = (user) => `select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', false); set role authenticated;`;

const ADMIN = "c1300000-0000-4000-8000-000000000001";
const KIOSK1 = "c1300000-0000-4000-8000-000000000002";
const KIOSK2 = "c1300000-0000-4000-8000-000000000003";

psql(`
insert into app_private.attendance_signing_keys (key_id, secret) values ('cc-k1', decode(repeat('5a', 32), 'hex')) on conflict do nothing;
insert into auth.users (id, email) values ('${ADMIN}', 'cc.admin@att.test'), ('${KIOSK1}', 'cc.kiosk1@att.test'), ('${KIOSK2}', 'cc.kiosk2@att.test');
insert into public.employees (id, organization_id, full_name) select u.id, b.organization_id, 'CC ' || split_part(u.email, '@', 1)
  from auth.users u cross join public.branches b where b.code = 'maarif' and u.email like 'cc.%@att.test';
insert into public.staff_accounts (user_id, employee_id, organization_id, email) select e.id, e.id, e.organization_id, u.email
  from public.employees e join auth.users u on u.id = e.id where u.email like 'cc.%@att.test';
insert into public.branch_memberships (staff_id, branch_id) select s.user_id, b.id from public.staff_accounts s cross join public.branches b
  where b.code = 'maarif' and s.email like 'cc.%@att.test';
insert into public.staff_group_assignments (staff_id, branch_id, group_key) values ('${ADMIN}', null, 'system_admin');
insert into public.staff_group_assignments (staff_id, branch_id, group_key) select s, b.id, 'attendance_kiosk' from public.branches b,
  unnest(array['${KIOSK1}'::uuid, '${KIOSK2}'::uuid]) s where b.code = 'maarif';
insert into public.attendance_devices (organization_id, branch_id, user_id, label) select b.organization_id, b.id, s, 'Kiosk ' || right(s::text, 1)
  from public.branches b, unnest(array['${KIOSK1}'::uuid, '${KIOSK2}'::uuid]) s where b.code = 'maarif';
create or replace function public.cc_verdict(p_attempt uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.attendance_attempts; ms text := (floor(extract(epoch from now()) * 1000))::bigint::text; msg text;
begin
  select * into a from public.attendance_attempts where id = p_attempt;
  msg := concat_ws('|', 'balaban-attendance', 'attempt', 'v1', a.id::text, encode(a.nonce, 'hex'), a.employee_id::text, a.reference_id::text,
                   a.action, array_to_string(a.challenge, ','), 'success', '', 'opencv-test-engine', ms, 'cc-k1');
  return jsonb_build_object('result', jsonb_build_object('outcome', 'success', 'engine', 'opencv-test-engine', 'issued_at_ms', ms, 'key_id', 'cc-k1'),
    'signature', encode(extensions.hmac(convert_to(msg, 'UTF8'), decode(repeat('5a', 32), 'hex'), 'sha256'), 'hex'));
end $$;
grant execute on function public.cc_verdict(uuid) to authenticated;
create or replace function public.cc_complete(p_attempt uuid) returns text language sql as $$
  select (public.app_attendance_attempt_complete(p_attempt, public.cc_verdict(p_attempt)->'result', public.cc_verdict(p_attempt)->>'signature'))->>'status';
$$;
grant execute on function public.cc_complete(uuid) to authenticated;
`);

// Creates and enrolls an employee directly (the verifier is not part of this test).
function employee(name) {
  return psql(`${as(ADMIN)}
select public.app_attendance_employee_create('maarif', '${name}', gen_random_uuid())->>'employee_id';`).split("\n").pop();
}
function enroll(id) {
  psql(`with s as (insert into app_private.attendance_enrollments (organization_id, branch_id, employee_id, nonce, started_by, expires_at, status, completed_at)
  select organization_id, branch_id, employee_id, extensions.gen_random_bytes(16), '${ADMIN}', now(), 'completed', now() from public.attendance_employees where employee_id = '${id}' returning *)
insert into app_private.attendance_face_references (id, organization_id, employee_id, status, ciphertext, ciphertext_sha256, engine, identity_document, consent_recorded, enrolled_by)
select s.id, s.organization_id, s.employee_id, 'active', extensions.gen_random_bytes(64), extensions.digest('x', 'sha256'), 'opencv-test-engine', 'other', true, '${ADMIN}' from s;`);
}
const code = (id) => psql(`select employee_number from public.employees where id = '${id}'`);
function start(kiosk, employeeCode, action) {
  return JSON.parse(psql(`${as(kiosk)}
select public.app_attendance_attempt_start(gen_random_uuid(), '${employeeCode}', '${action}');`).split("\n").pop());
}

async function main() {
  const a = employee("Concurrent A");
  const b = employee("Concurrent B");
  enroll(a);
  enroll(b);

  section("1. One attempt, two simultaneous completions");
  const x = start(KIOSK1, code(a), "check_in");
  const t1 = at(1500);
  const [s1, s2] = await Promise.all([1, 2].map(() => session(`${as(KIOSK1)}\n${waitUntil(t1)}\nselect public.cc_complete('${x.attempt_id}');`)));
  check("both sessions answered without error", s1.code === 0 && s2.code === 0, `${s1.err}${s2.err}`);
  check("both report success", s1.out.endsWith("succeeded") && s2.out.endsWith("succeeded"), `${s1.out} | ${s2.out}`);
  check("exactly one event", psql(`select count(*) from public.attendance_events where employee_id = '${a}'`) === "1");

  section("2. Completion racing a new attempt for the same employee (20 rounds)");
  let deadlocks = 0;
  let errors = 0;
  for (let round = 0; round < 20; round += 1) {
    const last = psql(`select kind from public.attendance_events e where employee_id = '${a}' and not exists (select 1 from public.attendance_corrections c where c.target_event_id = e.id) order by occurred_at desc, recorded_at desc limit 1`);
    const action = last === "check_in" ? "check_out" : "check_in";
    const y = start(KIOSK1, code(a), action);
    const t = at(700);
    const [complete, competitor] = await Promise.all([
      session(`${as(KIOSK1)}\n${waitUntil(t)}\nselect public.cc_complete('${y.attempt_id}');`),
      session(`${as(KIOSK2)}\n${waitUntil(t)}\nselect public.app_attendance_attempt_start('${randomUUID()}', '${code(a)}', '${action}')->>'status';`),
    ]);
    for (const r of [complete, competitor]) {
      if (/deadlock/i.test(r.err)) deadlocks += 1;
      else if (r.code !== 0) errors += 1;
    }
    // A competitor that won leaves a pending attempt: finish it so the next round starts from a clean state.
    const pending = psql(`select id from public.attendance_attempts where employee_id = '${a}' and status = 'pending'`);
    if (pending) psql(`${as(KIOSK2)}\nselect public.cc_complete('${pending}');`);
  }
  check("no deadlock in 20 rounds", deadlocks === 0, String(deadlocks));
  check("no other error", errors === 0, String(errors));
  check("never two pending attempts for one employee", psql(`select count(*) from public.attendance_attempts where employee_id = '${a}' and status = 'pending'`) === "0");
  const sequence = psql(`select string_agg(kind, ',' order by occurred_at, recorded_at) from public.attendance_events where employee_id = '${a}'`).split(",");
  check("events strictly alternate check-in / check-out", sequence.every((k, i) => k === (i % 2 === 0 ? "check_in" : "check_out")), sequence.join(","));
  check("every event came from exactly one succeeded attempt", psql(`select count(*) from public.attendance_events e where employee_id = '${a}'
    and (select count(*) from public.attendance_attempts t where t.event_id = e.id and t.status = 'succeeded') <> 1`) === "0");

  section("3. Six employees created at once");
  const t3 = at(1500);
  const created = await Promise.all(Array.from({ length: 6 }, (_, i) => session(`${as(ADMIN)}\n${waitUntil(t3)}\nselect public.app_attendance_employee_create('maarif', 'Parallel ${i}', gen_random_uuid())->>'employee_code';`)));
  const codes = created.map((r) => Number(r.out.split("\n").pop())).sort((p, q) => p - q);
  check("all six created", created.every((r) => r.code === 0), created.map((r) => r.err).join(""));
  check("six different, consecutive IDs", new Set(codes).size === 6 && codes[5] - codes[0] === 5, codes.join(","));

  section("4. The same correction request twice at once");
  const target = psql(`select id from public.attendance_events where employee_id = '${a}' order by occurred_at limit 1`);
  const request = randomUUID();
  const t4 = at(1500);
  const corrections = await Promise.all([1, 2].map(() => session(`${as(ADMIN)}\n${waitUntil(t4)}\nselect public.app_attendance_correct('${request}', 'void', null, '${target}', null, null, 'Concurrent duplicate (test)')->>'correction_id';`)));
  check("both answered", corrections.every((r) => r.code === 0), corrections.map((r) => r.err).join(""));
  check("one correction, the same id for both", psql(`select count(*) from public.attendance_corrections where request_key = '${request}'`) === "1"
    && corrections[0].out.split("\n").pop() === corrections[1].out.split("\n").pop());

  section("5. Two employees at once");
  const before = Number(psql("select count(*) from public.attendance_events"));
  const lastB = psql(`select coalesce((select kind from public.attendance_events where employee_id = '${b}' order by occurred_at desc limit 1), 'check_out')`);
  const xb = start(KIOSK2, code(b), lastB === "check_in" ? "check_out" : "check_in");
  const lastA = psql(`select kind from public.attendance_events e where employee_id = '${a}' and not exists (select 1 from public.attendance_corrections c where c.target_event_id = e.id) order by occurred_at desc limit 1`);
  const xa = start(KIOSK1, code(a), lastA === "check_in" ? "check_out" : "check_in");
  const t5 = at(1500);
  const both = await Promise.all([
    session(`${as(KIOSK1)}\n${waitUntil(t5)}\nselect public.cc_complete('${xa.attempt_id}');`),
    session(`${as(KIOSK2)}\n${waitUntil(t5)}\nselect public.cc_complete('${xb.attempt_id}');`),
  ]);
  check("both recorded", both.every((r) => r.out.endsWith("succeeded")) && Number(psql("select count(*) from public.attendance_events")) === before + 2,
    both.map((r) => r.out + r.err).join(" | "));
}

main()
  .catch((error) => { state.failures += 1; console.error(error); })
  .finally(() => {
    const reset = run("npx", ["supabase", "db", "reset", "--local"]);
    if (reset.status !== 0) console.error("db reset after the test failed");
    console.log(`\n${state.checks - state.failures}/${state.checks} attendance concurrency checks passed${state.failures ? `; FAILED: ${state.names.join(", ")}` : ""}`);
    process.exit(state.failures ? 1 : 0);
  });
