// Phases 13-14 end-to-end checks over HTTP against the PRODUCTION build, the real attendance verifier
// process (with its SYNTHETIC test engine) and a DISPOSABLE local Supabase stack.
//
//   npm run build && node scripts/attendance/e2e.mjs            (--no-reset keeps the database)
//
// Refuses the main development stack. It resets the database, creates synthetic people, a test-only
// signing key and switches the synthetic engine on in that disposable database only. No image of any
// person is used: frames are JSON landmark descriptions (scripts/attendance/synthetic-frames.mjs).
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import ExcelJS from "exceljs";
import { container } from "../phase3/db-check.mjs";
import { createReporter, directSession, loadEnv, makeHttp, plainText, readForm, root, run, serviceClient, startServer, submitForm, waitUp } from "../phase3/lib.mjs";
import { framesFor } from "./synthetic-frames.mjs";

const PORT = process.env.E2E_PORT ?? "3231";
const VERIFIER_PORT = process.env.VERIFIER_PORT ?? "8791";
const BASE = `http://127.0.0.1:${PORT}`;
const noReset = process.argv.includes("--no-reset");
const { check, section, state } = createReporter();
const env = loadEnv();
const apiUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
if (container === "supabase_db_balaban-dev" || apiUrl.port === "55321" || !["127.0.0.1", "localhost"].includes(apiUrl.hostname)) {
  throw new Error("The attendance e2e resets its database: point it at a disposable local stack (not balaban-dev).");
}
console.log(`Disposable stack: ${container}, API ${apiUrl.origin}`);
if (!noReset) {
  console.log("Rebuilding the disposable database (supabase db reset)...");
  const reset = run("npx", ["supabase", "db", "reset", "--local"]);
  if (reset.status !== 0) {
    console.error(`db reset failed\n${reset.stdout}\n${reset.stderr}`);
    process.exit(2);
  }
}

function psql(sql) {
  const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"], { input: sql });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout.trim();
}

// Per-run secrets, generated here and held only in this process and the disposable database.
const resultKey = randomBytes(32);
const templateKey = randomBytes(32);
const verifierToken = randomBytes(32).toString("base64url");
psql(`insert into app_private.attendance_signing_keys (key_id, secret) values ('e2e-k1', decode('${resultKey.toString("hex")}', 'hex'));
update app_private.attendance_config set allow_synthetic_engine = true;`);

const python = process.env.PYTHON ?? "python";
let verifier;
function startVerifier() {
  verifier = spawn(python, ["-I", path.join(root, "services", "attendance-verifier", "run.py"), "--synthetic-test-engine"], {
    env: {
      SYSTEMROOT: process.env.SYSTEMROOT ?? "", PATH: process.env.PATH ?? "",
      ATTENDANCE_VERIFIER_TOKEN: verifierToken,
      ATTENDANCE_TEMPLATE_KEYS: `e2e-t1:${templateKey.toString("base64")}`,
      ATTENDANCE_TEMPLATE_KEY_ID: "e2e-t1",
      ATTENDANCE_RESULT_KEY: resultKey.toString("base64"),
      ATTENDANCE_RESULT_KEY_ID: "e2e-k1",
      ATTENDANCE_VERIFIER_PORT: VERIFIER_PORT,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  verifier.stderr.on("data", (d) => (log += d));
  verifier.log = () => log;
}
async function verifierUp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${VERIFIER_PORT}/v1/health`, { headers: { authorization: `Bearer ${verifierToken}` } });
      if (r.ok) return true;
    } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`verifier did not start:\n${verifier.log()}`);
}
startVerifier();
const server = startServer(PORT, { SITE_URL: BASE, ATTENDANCE_VERIFIER_URL: `http://127.0.0.1:${VERIFIER_PORT}`, ATTENDANCE_VERIFIER_TOKEN: verifierToken });
const http = makeHttp(BASE);
const service = serviceClient(env);

const get = async (jar, pathname) => {
  const response = await http.get(jar, pathname);
  return { status: response.status, location: response.headers.get("location"), html: await response.text() };
};
async function api(jar, method, pathname, body, headers = {}) {
  const response = await fetch(new URL(pathname, BASE), {
    method,
    redirect: "manual",
    headers: { cookie: jar ? jar.header() : "", origin: BASE, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  const text = await response.text();
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, text, headers: response.headers };
}
const where = (location) => (location ? new URL(location, BASE).pathname + new URL(location, BASE).search : "");
const count = (sql) => Number(psql(sql));

async function person(email, name, groups) {
  const password = `${randomBytes(12).toString("base64url")}-Aa1`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const id = data.user.id;
  psql(`insert into public.employees (id, organization_id, full_name) select '${id}', organization_id, '${name}' from public.branches where code = 'maarif';
insert into public.staff_accounts (user_id, employee_id, organization_id, email) select '${id}', '${id}', organization_id, '${email}' from public.branches where code = 'maarif';
insert into public.branch_memberships (staff_id, branch_id) select '${id}', id from public.branches where code = 'maarif';
${groups.map((g) => `insert into public.staff_group_assignments (staff_id, branch_id, group_key) select '${id}', ${g === "system_admin" ? "null" : "id"}, '${g}' from public.branches where code = 'maarif';`).join("\n")}`);
  const { jar } = await directSession(env, email, password);
  return { id, jar, email };
}

async function main() {
  await verifierUp();
  await waitUp(BASE, server);

  section("0. Synthetic people");
  const admin = await person("att.admin@example.test", "ATT Admin", ["system_admin"]);
  const kiosk = await person("att.kiosk@example.test", "Maarif kiosk", ["attendance_kiosk"]);
  const cashier = await person("att.cashier@example.test", "ATT Cashier", ["cashier"]);
  check("three synthetic accounts", Boolean(admin.id && kiosk.id && cashier.id));

  section("1. Employees with stable IDs (form, English)");
  let page = await get(admin.jar, "/en/attendance/employees");
  check("the employees page opens for the administrator", page.status === 200 && Boolean(readForm(page.html, "attendance-create")), String(page.status));
  const createResponse = await submitForm(http, admin.jar, "/en/attendance/employees", page.html, "attendance-create", { full_name: "Synthetic Employee A" });
  const employeePath = where(createResponse.headers.get("location"));
  const employeeA = /\/attendance\/employees\/([0-9a-f-]{36})/.exec(employeePath)?.[1];
  check("creating an employee redirects to the employee page", Boolean(employeeA), employeePath);
  const replay = await submitForm(http, admin.jar, "/en/attendance/employees", page.html, "attendance-create", { full_name: "Synthetic Employee A" });
  check("re-sending the same form creates nobody new", where(replay.headers.get("location")).includes(employeeA) && count("select count(*) from public.attendance_employees") === 1);
  page = await get(admin.jar, "/en/attendance/employees");
  const createB = await submitForm(http, admin.jar, "/en/attendance/employees", page.html, "attendance-create", { full_name: "Synthetic Employee B" });
  const employeeB = /\/attendance\/employees\/([0-9a-f-]{36})/.exec(where(createB.headers.get("location")))?.[1];
  page = await get(admin.jar, "/en/attendance/employees");
  const createC = await submitForm(http, admin.jar, "/en/attendance/employees", page.html, "attendance-create", { full_name: "Synthetic Employee C" });
  const employeeC = /\/attendance\/employees\/([0-9a-f-]{36})/.exec(where(createC.headers.get("location")))?.[1];
  const codeC = psql(`select employee_number from public.employees where id = '${employeeC}'`);
  const codeA = psql(`select employee_number from public.employees where id = '${employeeA}'`);
  const codeB = psql(`select employee_number from public.employees where id = '${employeeB}'`);
  check("generated IDs are three digits from 101 and consecutive", codeA === "101" && codeB === "102", `${codeA} ${codeB}`);
  page = await get(admin.jar, `/ar/attendance/employees/${employeeA}`);
  check("the Arabic employee page shows the ID right-to-left", page.status === 200 && page.html.includes('dir="rtl"') && plainText(page.html).replace(/\s+/g, "").includes(`#${codeA}`));

  section("2. Kiosk device (least privilege)");
  page = await get(admin.jar, "/en/attendance/devices");
  check("the kiosk account is offered as a device", page.html.includes("att.kiosk@example.test") && !page.html.includes("att.cashier@example.test"));
  const reg = await submitForm(http, admin.jar, "/en/attendance/devices", page.html, "attendance-device-register", { account: kiosk.id, label: "Maarif entrance (test)" });
  check("device registered", where(reg.headers.get("location")).includes("notice=attendance_device_registered"), where(reg.headers.get("location")));
  page = await get(kiosk.jar, "/en/kiosk");
  check("the kiosk page opens for the device", page.status === 200 && page.html.includes("kiosk-screen") && page.html.includes("Your employee ID"));
  page = await get(kiosk.jar, "/ar/kiosk");
  check("the Arabic kiosk page opens right-to-left", page.status === 200 && page.html.includes('dir="rtl"') && page.html.includes("رقم الموظف الخاص بك"));
  for (const p of ["/en/attendance", "/en/attendance/employees", "/en/attendance/devices", "/en/daily-close", "/en/inventory", "/en/comparison", "/en/admin/staff", "/en/replenishment"]) {
    const r = await get(kiosk.jar, p);
    check(`kiosk is refused ${p}`, r.status === 403, String(r.status));
  }
  page = await get(kiosk.jar, "/en/reports/exports");
  check("the Excel reports page offers the kiosk nothing", page.status === 200 && !/data-form="export-/.test(page.html) && !/data-export="/.test(page.html));
  let r = await api(kiosk.jar, "GET", "/api/attendance/export?from=2026-11-01&to=2026-11-30");
  check("kiosk cannot download attendance Excel", r.status === 403, String(r.status));
  r = await api(kiosk.jar, "GET", "/api/exports/comparison?branches=maarif&mode=month&month=2026-11");
  check("kiosk cannot download comparison figures", r.status === 403 || r.status === 400, String(r.status));
  r = await api(kiosk.jar, "POST", "/api/attendance/enrollments", { employee: employeeA, identity_document: "national_id", consent: true, frames: framesFor(["left", "right"]) });
  check("kiosk cannot enroll a face", r.status === 403, String(r.status));
  r = await api(cashier.jar, "POST", "/api/attendance/kiosk/attempts", { request: randomUUID(), code: "1001", action: "check_in" });
  check("a cashier is not a kiosk", r.status === 403 && r.json?.error === "not_a_device", r.text);
  r = await api(null, "POST", "/api/attendance/kiosk/attempts", { request: randomUUID(), code: "1001", action: "check_in" });
  check("anonymous requests are refused", r.status === 401, String(r.status));

  section("3. Enrollment through the verifier");
  r = await api(admin.jar, "POST", "/api/attendance/enrollments", { employee: employeeA, identity_document: "national_id", consent: false, frames: framesFor(["left", "right"]) });
  check("consent is required", r.status === 400 && r.json?.error === "consent_required", r.text);
  r = await api(admin.jar, "POST", "/api/attendance/enrollments", { employee: employeeA, identity_document: "national_id", consent: true, frames: framesFor(["left", "right"], { flat: true }) });
  check("a flat photo cannot be enrolled", r.status === 200 && r.json?.status === "failed", r.text);
  r = await api(admin.jar, "POST", "/api/attendance/enrollments", { employee: employeeA, identity_document: "national_id", consent: true, frames: framesFor(["left", "right"]) });
  check("employee A enrolled", r.status === 200 && r.json?.status === "completed" && r.json?.replaced === false, r.text);
  r = await api(admin.jar, "POST", "/api/attendance/enrollments", { employee: employeeA, identity_document: "passport", consent: true, frames: framesFor(["left", "right"]) });
  check("re-enrollment replaces the reference", r.json?.status === "completed" && r.json?.replaced === true, r.text);
  r = await api(admin.jar, "POST", "/api/attendance/enrollments", { employee: employeeB, identity_document: "national_id", consent: true, frames: framesFor(["left", "right"], { identity: "employee-b" }) });
  check("employee B enrolled", r.json?.status === "completed", r.text);
  r = await api(admin.jar, "POST", "/api/attendance/enrollments", { employee: employeeC, identity_document: "residence_permit", consent: true, frames: framesFor(["left", "right"], { identity: "employee-c" }) });
  check("employee C enrolled", r.json?.status === "completed", r.text);
  check("one active reference each, old one erased", count(`select count(*) from app_private.attendance_face_references where status = 'active'`) === 3
    && count(`select count(*) from app_private.attendance_face_references where status <> 'active' and ciphertext is null`) === 1);
  check("nothing biometric is readable through the API", psql(`select count(*) from information_schema.role_table_grants where table_schema = 'app_private' and table_name like 'attendance%' and grantee in ('authenticated','anon','service_role')`) === "0");

  section("4. Check-in at the kiosk");
  const start = (jar, code, action, request = randomUUID(), headers = {}) => api(jar, "POST", "/api/attendance/kiosk/attempts", { request, code, action }, headers);
  const verify = (jar, attempt, frames, headers = {}) => api(jar, "POST", `/api/attendance/kiosk/attempts/${attempt}/verify`, { frames }, headers);
  r = await start(kiosk.jar, "999999", "check_in");
  check("an unknown ID is refused and recorded", r.json?.status === "refused" && r.json?.reason === "unknown_employee", r.text);
  r = await start(kiosk.jar, codeA, "check_in", randomUUID(), { origin: "http://evil.example" });
  check("a cross-site request is refused", r.status === 403, String(r.status));
  const request = randomUUID();
  const [first, second] = await Promise.all([start(kiosk.jar, codeA, "check_in", request), start(kiosk.jar, codeA, "check_in", request)]);
  check("a double press is one attempt", first.json?.attempt_id && first.json.attempt_id === second.json?.attempt_id, `${first.text} ${second.text}`);
  const challenge = first.json?.challenge ?? [];
  check("the challenge is two different movements", challenge.length === 2 && challenge[0] !== challenge[1], JSON.stringify(challenge));
  check("no name is shown before verification", !("employee_first_name" in (first.json ?? {})));
  const attempt = first.json.attempt_id;
  const okFrames = framesFor(challenge);
  const [v1, v2] = await Promise.all([verify(kiosk.jar, attempt, okFrames), verify(kiosk.jar, attempt, okFrames)]);
  const winner = [v1, v2].find((x) => x.json?.status === "succeeded" && !x.json?.replayed);
  check("check-in recorded with the server time", Boolean(winner) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(winner.json.event.local) && winner.json.employee_first_name === "Synthetic",
    `${v1.text} ${v2.text}`);
  check("two concurrent verifications of one attempt create one event", count("select count(*) from public.attendance_events") === 1
    && v1.json?.event?.occurred_at === v2.json?.event?.occurred_at);
  r = await verify(kiosk.jar, attempt, okFrames);
  check("a retry after success returns the same event", r.json?.status === "succeeded" && r.json?.event?.occurred_at === v1.json?.event?.occurred_at
    && count("select count(*) from public.attendance_events") === 1, r.text);
  r = await start(kiosk.jar, codeA, "check_in");
  check("a repeated check-in shows the current state and records nothing", r.json?.status === "refused" && r.json?.reason === "already_checked_in"
    && r.json?.current_state?.kind === "check_in" && count("select count(*) from public.attendance_events") === 1, r.text);
  check("the kiosk never sees the nonce, the reference or a signature", !/nonce|ciphertext|signature|reference_id|match_score/.test(first.text + v1.text + v2.text));

  section("5. Attacks and failures create no event (employee C)");
  const before = count("select count(*) from public.attendance_events");
  async function attemptWith(code, action, framesOf) {
    const s = await start(kiosk.jar, code, action);
    if (s.json?.status !== "pending") return s;
    return verify(kiosk.jar, s.json.attempt_id, framesOf(s.json.challenge));
  }
  const asC = { identity: "employee-c" };
  r = await attemptWith(codeC, "check_in", (c) => framesFor(c, { identity: "employee-b" }));
  check("another person with C's ID: face_mismatch", r.json?.status === "failed" && r.json?.reason === "face_mismatch", r.text);
  r = await attemptWith(codeC, "check_in", (c) => framesFor(c, { ...asC, flat: true }));
  check("a printed photo of C: refused by the liveness checks", r.json?.status === "failed" && ["challenge_failed", "liveness_failed"].includes(r.json?.reason), r.text);
  r = await attemptWith(codeC, "check_in", (c) => framesFor([...c].reverse(), asC));
  check("the movements in the wrong order: challenge_failed", r.json?.status === "failed" && r.json?.reason === "challenge_failed", r.text);
  r = await attemptWith(codeC, "check_in", (c) => framesFor(c, { ...asC, moveIdentity: "employee-b" }));
  check("C's photo, then another live face: face_inconsistent", r.json?.reason === "face_inconsistent", r.text);
  r = await attemptWith(codeC, "check_in", () => ["bm90IGEgZnJhbWU="]);
  check("too few frames: upload_invalid", r.json?.status === "failed" && r.json?.reason === "upload_invalid", r.text);
  let s = await start(kiosk.jar, codeC, "check_in");
  r = await api(kiosk.jar, "POST", `/api/attendance/kiosk/attempts/${s.json.attempt_id}/fail`, { reason: "success" });
  check("the browser cannot report a success", r.status === 400, r.text);
  r = await api(kiosk.jar, "POST", `/api/attendance/kiosk/attempts/${s.json.attempt_id}/fail`, { reason: "camera_stopped" });
  check("a stopped camera is a reviewable failure", r.json?.status === "failed" && r.json?.reason === "camera_stopped", r.text);
  r = await verify(kiosk.jar, s.json.attempt_id, framesFor(s.json.challenge ?? ["left", "right"], asC));
  check("a failed attempt cannot be verified afterwards", r.json?.status === "failed" && r.json?.reason === "camera_stopped", r.text);
  r = await attemptWith(codeC, "check_in", (c) => framesFor(c, { ...asC, extra: true }));
  check("two people in front of the camera: multiple_faces", r.json?.reason === "multiple_faces", r.text);
  r = await start(kiosk.jar, codeC, "check_in");
  check("after five failed verifications the ID is paused", r.json?.status === "refused" && r.json?.reason === "too_many_failures", r.text);
  check("no attack created an event", count("select count(*) from public.attendance_events") === before);

  section("6. Verifier unavailable, synthetic engine refused, deactivation");
  verifier.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  r = await attemptWith(codeB, "check_in", (c) => framesFor(c, { identity: "employee-b" }));
  check("verifier down: verifier_unavailable, nothing recorded", r.json?.reason === "verifier_unavailable" && count("select count(*) from public.attendance_events") === before, r.text);
  startVerifier();
  await verifierUp();
  psql("update app_private.attendance_config set allow_synthetic_engine = false;");
  r = await attemptWith(codeB, "check_in", (c) => framesFor(c, { identity: "employee-b" }));
  check("a database that does not allow the test engine refuses its verdicts", r.json?.reason === "invalid_verifier_signature", r.text);
  psql("update app_private.attendance_config set allow_synthetic_engine = true;");
  page = await get(admin.jar, `/en/attendance/employees/${employeeB}`);
  let res = await submitForm(http, admin.jar, `/en/attendance/employees/${employeeB}`, page.html, "attendance-active", { reason: "Synthetic leave (test)" });
  check("employee B deactivated through the form", where(res.headers.get("location")).includes("notice=attendance_deactivated"), where(res.headers.get("location")));
  r = await start(kiosk.jar, codeB, "check_in");
  check("a deactivated employee is refused at once", r.json?.reason === "employee_inactive", r.text);
  page = await get(admin.jar, `/en/attendance/employees/${employeeB}`);
  await submitForm(http, admin.jar, `/en/attendance/employees/${employeeB}`, page.html, "attendance-active", {});
  r = await start(kiosk.jar, codeB, "check_in");
  check("reactivated: B may start again", r.json?.status === "pending", r.text);
  page = await get(admin.jar, "/en/attendance/devices");
  res = await submitForm(http, admin.jar, "/en/attendance/devices", page.html, "attendance-device-active", { reason: "Laptop replaced (test)" });
  r = await start(kiosk.jar, codeA, "check_out");
  check("a deactivated device is refused", r.status === 403 && r.json?.error === "device_inactive", r.text);
  page = await get(kiosk.jar, "/en/kiosk");
  check("the kiosk page says the device is off", page.html.includes('data-kiosk-state="device_inactive"'));
  page = await get(admin.jar, "/en/attendance/devices");
  await submitForm(http, admin.jar, "/en/attendance/devices", page.html, "attendance-device-active", {});

  section("7. Check-out, worked time, correction, Excel");
  r = await attemptWith(codeA, "check_out", (c) => framesFor(c, { scale: 0.4 }));
  check("turns that are too small: refused with the 'turn more' hint", r.json?.status === "failed" && r.json?.reason === "challenge_failed"
    && r.json?.hint === "turn_more", r.text);
  r = await attemptWith(codeA, "check_out", (c) => framesFor(c));
  check("check-out recorded", r.json?.status === "succeeded" && r.json?.event?.kind === "check_out", r.text);
  // A historical shift and a missing check-out, entered as corrections (the time can only be the past).
  page = await get(admin.jar, `/en/attendance/employees/${employeeB}?from=2026-11-01&to=2026-11-30`);
  for (const [kind, local] of [["check_in", "2026-11-02T22:00"], ["check_out", "2026-11-03T06:00"], ["check_in", "2026-11-04T09:05"]]) {
    res = await submitForm(http, admin.jar, `/en/attendance/employees/${employeeB}`, page.html, "attendance-add", { event_kind: kind, local, reason: "Kiosk not yet installed (test)" });
    check(`added ${kind} ${local}`, where(res.headers.get("location")).includes("notice=attendance_corrected"), where(res.headers.get("location")));
    page = await get(admin.jar, `/en/attendance/employees/${employeeB}?from=2026-11-01&to=2026-11-30`);
  }
  check("the overnight shift is 8:00:00", plainText(page.html).includes("8:00:00"));
  check("the open shift is listed for review", page.html.includes('data-shift-status="missing_check_out"'));
  res = await submitForm(http, admin.jar, `/en/attendance/employees/${employeeB}`, page.html, "attendance-add", { event_kind: "check_out", local: "2026-11-04T17:10", reason: "Forgot to check out (test)" });
  page = await get(admin.jar, `/en/attendance/employees/${employeeB}?from=2026-11-01&to=2026-11-30`);
  check("09:05 to 17:10 is 8:05:00", plainText(page.html).includes("8:05:00"));
  const out1710 = psql(`select id from public.attendance_events where employee_id = '${employeeB}' and kind = 'check_out' and occurred_at = ('2026-11-04 17:10'::timestamp at time zone 'Africa/Casablanca')`);
  const retimeForm = readForm(page.html.slice(page.html.indexOf(`data-event="${out1710}"`)), "attendance-retime");
  check("each effective event has a correction form", Boolean(retimeForm));
  const sliced = page.html.slice(page.html.indexOf(`data-event="${out1710}"`));
  res = await submitForm(http, admin.jar, `/en/attendance/employees/${employeeB}`, sliced, "attendance-retime", { local: "2026-11-04T17:40", reason: "Left at 17:40 (test)" });
  page = await get(admin.jar, `/en/attendance/employees/${employeeB}?from=2026-11-01&to=2026-11-30`);
  check("the correction changes the result (8:35:00)", plainText(page.html).includes("8:35:00") && !plainText(page.html).includes("8:05:00"));
  check("the original event is kept and shown as replaced", count(`select count(*) from public.attendance_events where id = '${out1710}'`) === 1 && page.html.includes(`data-event="${out1710}" data-effective="false"`));
  check("the correction is in the audit history with its reason", count(`select count(*) from public.audit_log where action = 'attendance.event_corrected' and changes->>'reason' = 'Left at 17:40 (test)'`) === 1);

  const overview = await get(admin.jar, "/en/attendance?from=2026-11-01&to=2026-11-30");
  const screenTotal = Number(/data-total="true"[\s\S]*?data-seconds="(\d+)"/.exec(overview.html)?.[1]);
  check("the overview total is 16:35:00 plus today's kiosk shift", Number.isFinite(screenTotal) && screenTotal >= 16 * 3600 + 35 * 60, String(screenTotal));
  for (const lang of ["ar", "en"]) {
    const dl = await fetch(new URL(`/api/attendance/export?branch=maarif&from=2026-11-01&to=2026-11-30&lang=${lang}`, BASE), { headers: { cookie: admin.jar.header() } });
    const bytes = Buffer.from(await dl.arrayBuffer());
    check(`${lang}: Excel downloads, not cached`, dl.status === 200 && dl.headers.get("cache-control") === "no-store" && dl.headers.get("content-type")?.includes("spreadsheetml"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const totals = wb.worksheets[1];
    const cell = totals.getRow(totals.rowCount).getCell(4).value;
    const seconds = cell instanceof Date ? Math.round((cell.getTime() - Date.UTC(1899, 11, 30)) / 1000) : Math.round(Number(cell) * 86400);
    check(`${lang}: the Excel total equals the screen total`, seconds === screenTotal, `${seconds} vs ${screenTotal}`);
    check(`${lang}: direction`, (wb.worksheets[0].views[0]?.rightToLeft ?? false) === (lang === "ar"));
  }
  check("exports are recorded in the audit history", count("select count(*) from public.audit_log where action = 'attendance.report_exported'") === 2);
  r = await api(cashier.jar, "GET", "/api/attendance/export?from=2026-11-01&to=2026-11-30");
  check("a cashier cannot download attendance", r.status === 403, String(r.status));
  page = await get(admin.jar, "/ar/attendance?from=2026-11-01&to=2026-11-30");
  check("the Arabic overview shows the same total", page.status === 200 && page.html.includes('dir="rtl"') && page.html.includes(`data-seconds="${screenTotal}"`));
  check("the attempts list shows the refused and failed attempts", (overview.html.match(/data-attempt-reason=/g) ?? []).length >= 8);

  section("8. Privacy");
  check("no attempt stores an array or image", count("select count(*) from public.attendance_attempts where strpos(verification::text, '[') > 0 or length(verification::text) > 2000") === 0);
  check("the verifier log holds no frame, score list or key", !/[A-Za-z0-9+/]{200,}/.test(verifier.log()) && !verifier.log().includes(resultKey.toString("base64")));
  check("the web server log holds no frame or key", !/[A-Za-z0-9+/]{200,}/.test(server.log()) && !server.log().includes(verifierToken));
}

main()
  .catch((error) => {
    state.failures += 1;
    console.error(error);
  })
  .finally(() => {
    server.child.kill();
    verifier?.kill();
    console.log(`\n${state.checks - state.failures}/${state.checks} attendance checks passed${state.failures ? `; FAILED: ${state.names.join(", ")}` : ""}`);
    process.exit(state.failures ? 1 : 0);
  });
