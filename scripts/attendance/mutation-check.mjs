// Mutation checks for supabase/tests/attendance_checks.sql on a DISPOSABLE stack: each guard is removed
// (committed, then the database is reset) and the acceptance file must FAIL. The unmodified schema must pass.
//
//   node scripts/attendance/mutation-check.mjs
import { container, runSqlFile } from "../phase3/db-check.mjs";
import { loadEnv, run } from "../phase3/lib.mjs";

const env = loadEnv();
if (container === "supabase_db_balaban-dev" || new URL(env.NEXT_PUBLIC_SUPABASE_URL).port === "55321") {
  throw new Error("The mutation check changes and resets its database: use a disposable local stack.");
}
function psql(sql) {
  const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"], { input: sql });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout.trim();
}
/** Replaces `from` with `to` in a function's definition and installs it. */
function mutateFunction(signature, from, to) {
  const def = psql(`select pg_get_functiondef('${signature}'::regprocedure)`);
  if (!def.includes(from)) throw new Error(`mutation anchor not found in ${signature}: ${from}`);
  psql(`${def.replace(from, to)};`);
}
function reset() {
  const r = run("npx", ["supabase", "db", "reset", "--local"]);
  if (r.status !== 0) throw new Error(`db reset failed: ${r.stderr}`);
}

const MUTATIONS = [
  ["accept a verdict without checking its signature", () => mutateFunction("public.app_attendance_attempt_complete(uuid,jsonb,text)",
    "and v_expected is not null and v_expected = lower(coalesce(p_signature, ''))", "and true")],
  ["accept an identical capture twice", () => mutateFunction("public.app_attendance_attempt_complete(uuid,jsonb,text)",
    "if v_inserted is null then", "if false then")],
  ["accept an expired attempt", () => mutateFunction("public.app_attendance_attempt_complete(uuid,jsonb,text)",
    "if now() > a.expires_at then", "if false then")],
  ["let an over-privileged account act as a kiosk", () => mutateFunction("app_private.kiosk_problem(uuid)",
    "return 'device_overprivileged';", "return null;")],
  ["drop the append-only trigger of events", () => psql("drop trigger attendance_events_append_only on public.attendance_events;")],
  ["open the events policy to every signed-in person", () => psql("drop policy attendance_events_read on public.attendance_events; create policy attendance_events_read on public.attendance_events for select to authenticated using (true);")],
  ["forget the state check (allow a second check-in)", () => mutateFunction("public.app_attendance_attempt_start(uuid,text,text)",
    "if p_action = 'check_in' and last.kind = 'check_in' then", "if false then")],
  ["skip the brute-force brake", () => mutateFunction("public.app_attendance_attempt_start(uuid,text,text)",
    "'invalid_verifier_signature', 'capture_replayed', 'poor_quality')) >= 5 then", "'invalid_verifier_signature', 'capture_replayed', 'poor_quality')) >= 500 then")],
  ["keep the replaced face reference", () => mutateFunction("public.app_attendance_enrollment_complete(uuid,text,jsonb,text,text,boolean)",
    "set status = 'replaced', ciphertext = null,", "set status = 'replaced', ciphertext = ciphertext,")],
  ["let corrections change the original event's row", () => psql("drop trigger attendance_corrections_append_only on public.attendance_corrections;")],
];

let failures = 0;
const match = process.argv.includes("--match") ? process.argv[process.argv.indexOf("--match") + 1] : null;
if (process.argv.includes("--match") && !match) throw new Error("--match requires a mutation name fragment");
const selected = match ? MUTATIONS.filter(([name]) => name.includes(match)) : MUTATIONS;
if (selected.length === 0) throw new Error(`No mutation matched: ${match}`);
reset();
try {
  console.log(`  ok   unmodified: ${runSqlFile("attendance_checks.sql")}`);
} catch (error) {
  failures += 1;
  console.log(`  FAIL unmodified schema does not pass:\n${error.message}`);
}
for (const [name, apply] of selected) {
  reset();
  apply();
  try {
    runSqlFile("attendance_checks.sql");
    failures += 1;
    console.log(`  FAIL "${name}" was NOT detected`);
  } catch (error) {
    const reason = (/ERROR:\s+(.*)/.exec(error.message) ?? [])[1] ?? "failed";
    console.log(`  ok   "${name}" detected -> ${reason.slice(0, 140)}`);
  }
}
reset();
console.log(failures === 0 ? "\nMutation checks passed." : `\n${failures} mutation check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
