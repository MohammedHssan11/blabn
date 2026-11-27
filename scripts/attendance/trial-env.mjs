// Real-camera trial environment (Phase 13). LOCAL AND DISPOSABLE ONLY, with an agreed participant.
//
//   npm run build && node scripts/attendance/trial-env.mjs
//
// Starts the REAL verifier (OpenCV YuNet + SFace, pinned hashes; the synthetic engine stays refused),
// the production build, a fresh disposable database with a trial administrator, a kiosk device and one
// employee called "Trial participant" (no real name is stored), and opens a visible Edge window with
// the camera allowed: one window for enrollment, one for the kiosk. Nothing is recorded but the
// attempts' aggregate metrics in the disposable database. Stop with Ctrl+C or by creating the file
// tmp/attendance-trial/STOP; the face reference is then deleted and the database reset.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { container } from "../phase3/db-check.mjs";
import { loadEnv, root, run, serviceClient, startServer, waitUp } from "../phase3/lib.mjs";

const PORT = process.env.TRIAL_PORT ?? "3240";
const VERIFIER_PORT = process.env.VERIFIER_PORT ?? "8793";
const BASE = `http://127.0.0.1:${PORT}`;
const env = loadEnv();
if (container === "supabase_db_balaban-dev" || new URL(env.NEXT_PUBLIC_SUPABASE_URL).port === "55321") {
  throw new Error("The camera trial resets its database: use a disposable local stack.");
}
const dir = path.join(root, "tmp", "attendance-trial");
mkdirSync(dir, { recursive: true });
rmSync(path.join(dir, "STOP"), { force: true });
const reset = run("npx", ["supabase", "db", "reset", "--local"]);
if (reset.status !== 0) throw new Error(`db reset failed: ${reset.stderr}`);
function psql(sql) {
  const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"], { input: sql });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout.trim();
}

const resultKey = randomBytes(32);
const verifierToken = randomBytes(32).toString("base64url");
psql(`insert into app_private.attendance_signing_keys (key_id, secret) values ('trial-k1', decode('${resultKey.toString("hex")}', 'hex'));`);
const verifier = spawn(process.env.PYTHON ?? "python", ["-I", path.join(root, "services", "attendance-verifier", "run.py")], {
  env: {
    SYSTEMROOT: process.env.SYSTEMROOT ?? "", PATH: process.env.PATH ?? "", ATTENDANCE_VERIFIER_TOKEN: verifierToken,
    ATTENDANCE_TEMPLATE_KEYS: `trial-t1:${randomBytes(32).toString("base64")}`, ATTENDANCE_TEMPLATE_KEY_ID: "trial-t1",
    ATTENDANCE_RESULT_KEY: resultKey.toString("base64"), ATTENDANCE_RESULT_KEY_ID: "trial-k1", ATTENDANCE_VERIFIER_PORT: VERIFIER_PORT,
    ATTENDANCE_YUNET_MODEL: process.env.ATTENDANCE_YUNET_MODEL ?? path.join(root, "tmp", "attendance-models", "yunet.onnx"),
    ATTENDANCE_SFACE_MODEL: process.env.ATTENDANCE_SFACE_MODEL ?? path.join(root, "tmp", "attendance-models", "sface.onnx"),
  },
  stdio: ["ignore", "ignore", "inherit"],
});
const server = startServer(PORT, { SITE_URL: BASE, ATTENDANCE_VERIFIER_URL: `http://127.0.0.1:${VERIFIER_PORT}`, ATTENDANCE_VERIFIER_TOKEN: verifierToken });
const service = serviceClient(env);

async function account(email, name, groups) {
  const password = `${randomBytes(12).toString("base64url")}-Aa1`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  const id = data.user.id;
  psql(`insert into public.employees (id, organization_id, full_name) select '${id}', organization_id, '${name}' from public.branches where code = 'maarif';
insert into public.staff_accounts (user_id, employee_id, organization_id, email) select '${id}', '${id}', organization_id, '${email}' from public.branches where code = 'maarif';
insert into public.branch_memberships (staff_id, branch_id) select '${id}', id from public.branches where code = 'maarif';
${groups.map((g) => `insert into public.staff_group_assignments (staff_id, branch_id, group_key) select '${id}', ${g === "system_admin" ? "null" : "id"}, '${g}' from public.branches where code = 'maarif';`).join("\n")}`);
  return { id, email, password };
}

async function signedIn(browser, who, url) {
  const context = await browser.newContext({ viewport: null, permissions: ["camera"] });
  const page = await context.newPage();
  await page.goto(`${BASE}/en/sign-in`);
  await page.fill('input[name="email"]', who.email);
  await page.fill('input[name="password"]', who.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/sign-in")), page.click('form[data-form="sign-in"] button[type="submit"]')]);
  await page.goto(url);
  return { context, page };
}

let stopping = false;
async function stop(browser) {
  if (stopping) return;
  stopping = true;
  try { await browser?.close(); } catch { /* closed */ }
  // Erase the trial face reference before anything else, then reset the disposable database.
  try { psql("update app_private.attendance_face_references set status = 'deleted', ciphertext = null, ended_at = now(), end_reason = 'trial ended' where status = 'active';"); } catch { /* reset follows */ }
  server.child.kill();
  verifier.kill();
  const again = run("npx", ["supabase", "db", "reset", "--local"]);
  console.log(again.status === 0 ? "Trial ended: face reference erased and the disposable database reset." : "Trial ended; RESET FAILED - reset the disposable database by hand.");
  process.exit(0);
}

async function main() {
  await waitUp(BASE, server);
  const admin = await account("trial.admin@example.test", "Trial administrator", ["system_admin"]);
  const kiosk = await account("trial.kiosk@example.test", "Trial kiosk", ["attendance_kiosk"]);
  psql(`insert into public.attendance_devices (organization_id, branch_id, user_id, label) select organization_id, id, '${kiosk.id}', 'HP laptop camera (trial)' from public.branches where code = 'maarif';`);
  const employee = JSON.parse(psql(`select set_config('request.jwt.claims', '{"sub":"${admin.id}","role":"authenticated"}', false); set role authenticated;
select public.app_attendance_employee_create('maarif', 'Trial participant', gen_random_uuid());`).split("\n").pop());
  // Local-only note for the operator (tmp/ is ignored by Git); the passwords are random per run.
  writeFileSync(path.join(dir, "accounts.local.txt"), `Trial participant ID: ${employee.employee_code}\nadmin ${admin.email} ${admin.password}\nkiosk ${kiosk.email} ${kiosk.password}\n`);
  writeFileSync(path.join(dir, "employee.local.json"), JSON.stringify(employee));

  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: false, args: ["--start-maximized"] });
  await signedIn(browser, admin, `${BASE}/en/attendance/employees/${employee.employee_id}/enroll`);
  await signedIn(browser, kiosk, `${BASE}/en/kiosk`);
  console.log(`Trial ready. Participant ID ${employee.employee_code}. Enrollment and kiosk windows are open. Create tmp/attendance-trial/STOP to end.`);
  const timer = setInterval(() => { if (existsSync(path.join(dir, "STOP"))) { clearInterval(timer); void stop(browser); } }, 1000);
  process.on("SIGINT", () => void stop(browser));
}

main().catch((error) => { console.error(error); process.exit(1); });
