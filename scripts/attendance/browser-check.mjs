// Phases 13-14 browser checks (Edge, headless) against the PRODUCTION build, the attendance verifier
// (SYNTHETIC test engine) and a DISPOSABLE local Supabase stack. Arabic and English, laptop layout
// (1366 x 768) for the kiosk, laptop and 375 px for the administration pages.
//
//   npm run build && node scripts/attendance/browser-check.mjs
//
// The browser uses Chromium's fake camera fed with a generated moving colour pattern (no person; Edge's
// built-in fake pattern ends at once in headless mode). The kiosk page captures
// real JPEG frames from it; because a test pattern has no face, the check replaces the uploaded frames
// with synthetic landmark frames (scripts/attendance/synthetic-frames.mjs) on their way to the server,
// so the full page -> server -> verifier -> database path runs. Camera refusal, a missing camera, a camera
// that stops mid-capture and a lost connection are exercised with the real page code.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";
import { container } from "../phase3/db-check.mjs";
import { createReporter, loadEnv, root, run, serviceClient, startServer, waitUp } from "../phase3/lib.mjs";
import { framesFor } from "./synthetic-frames.mjs";

const PORT = process.env.E2E_PORT ?? "3232";
const VERIFIER_PORT = process.env.VERIFIER_PORT ?? "8792";
const BASE = `http://127.0.0.1:${PORT}`;
const { check, section, state } = createReporter();
const env = loadEnv();
const apiUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
if (container === "supabase_db_balaban-dev" || apiUrl.port === "55321" || !["127.0.0.1", "localhost"].includes(apiUrl.hostname)) {
  throw new Error("The attendance browser check resets its database: point it at a disposable local stack (not balaban-dev).");
}
const reset = run("npx", ["supabase", "db", "reset", "--local"]);
if (reset.status !== 0) throw new Error(`db reset failed\n${reset.stderr}`);
function psql(sql) {
  const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"], { input: sql });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout.trim();
}
const resultKey = randomBytes(32);
const verifierToken = randomBytes(32).toString("base64url");
psql(`insert into app_private.attendance_signing_keys (key_id, secret) values ('br-k1', decode('${resultKey.toString("hex")}', 'hex'));
update app_private.attendance_config set allow_synthetic_engine = true;`);
const verifier = spawn(process.env.PYTHON ?? "python", ["-I", path.join(root, "services", "attendance-verifier", "run.py"), "--synthetic-test-engine"], {
  env: { SYSTEMROOT: process.env.SYSTEMROOT ?? "", PATH: process.env.PATH ?? "", ATTENDANCE_VERIFIER_TOKEN: verifierToken,
    ATTENDANCE_TEMPLATE_KEYS: `br-t1:${randomBytes(32).toString("base64")}`, ATTENDANCE_TEMPLATE_KEY_ID: "br-t1",
    ATTENDANCE_RESULT_KEY: resultKey.toString("base64"), ATTENDANCE_RESULT_KEY_ID: "br-k1", ATTENDANCE_VERIFIER_PORT: VERIFIER_PORT },
  stdio: ["ignore", "ignore", "ignore"],
});
const server = startServer(PORT, { SITE_URL: BASE, ATTENDANCE_VERIFIER_URL: `http://127.0.0.1:${VERIFIER_PORT}`, ATTENDANCE_VERIFIER_TOKEN: verifierToken });
const service = serviceClient(env);

/** A 3-second, 640 x 480 moving colour pattern in Y4M (no person), written under the ignored tmp/ folder. */
function patternVideo() {
  const dir = path.join(root, "tmp", "attendance-browser");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "pattern.y4m");
  const w = 640, h = 480, frames = 90;
  const parts = [Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < frames; i += 1) {
    const y = Buffer.alloc(w * h);
    for (let r = 0; r < h; r += 1) for (let c = 0; c < w; c += 1) y[r * w + c] = (r + c + i * 4) % 256;
    parts.push(Buffer.from("FRAME\n"), y, Buffer.alloc((w * h) / 4, 128), Buffer.alloc((w * h) / 4, (i * 3) % 256));
  }
  writeFileSync(file, Buffer.concat(parts));
  return file;
}
const FAKE_CAMERA = ["--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${patternVideo()}`];
const count = (sql) => Number(psql(sql));

const people = {};
async function person(key, email, name, groups) {
  const password = `${randomBytes(12).toString("base64url")}-Aa1`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  const id = data.user.id;
  psql(`insert into public.employees (id, organization_id, full_name) select '${id}', organization_id, '${name}' from public.branches where code = 'maarif';
insert into public.staff_accounts (user_id, employee_id, organization_id, email) select '${id}', '${id}', organization_id, '${email}' from public.branches where code = 'maarif';
insert into public.branch_memberships (staff_id, branch_id) select '${id}', id from public.branches where code = 'maarif';
${groups.map((g) => `insert into public.staff_group_assignments (staff_id, branch_id, group_key) select '${id}', ${g === "system_admin" ? "null" : "id"}, '${g}' from public.branches where code = 'maarif';`).join("\n")}`);
  people[key] = { id, email, password };
}

async function signIn(browser, who, locale, viewport, { contextOptions = {} } = {}) {
  const context = await browser.newContext({ viewport, ...contextOptions });
  const page = await context.newPage();
  const errors = [];
  // The application has no favicon yet (pre-existing, not part of attendance); every other console error counts.
  page.on("console", (m) => { if (m.type() === "error" && !(m.location()?.url ?? "").endsWith("/favicon.ico")) errors.push(`${m.text()} ${m.location()?.url ?? ""}`); });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() === 404) errors.push(`404 ${new URL(r.url()).pathname}`); });
  await page.goto(`${BASE}/${locale}/sign-in`);
  await page.fill('input[name="email"]', who.email);
  await page.fill('input[name="password"]', who.password);
  await Promise.all([page.waitForURL((url) => !url.pathname.endsWith("/sign-in")), page.click('form[data-form="sign-in"] button[type="submit"]')]);
  return { context, page, errors };
}

/** Replaces the frames of the next kiosk verification (or enrollment) with synthetic frames for its challenge. */
async function swapFrames(page, { identity = "employee-a", abortFirst = false, kind = "verify", steps, scale = 1 } = {}) {
  let aborted = false;
  const pattern = kind === "verify" ? "**/api/attendance/kiosk/attempts/*/verify" : "**/api/attendance/enrollments";
  await page.route(pattern, async (route) => {
    if (abortFirst && !aborted) {
      aborted = true;
      return route.abort("failed");
    }
    const body = JSON.parse(route.request().postData() ?? "{}");
    const realFrames = Array.isArray(body.frames) ? body.frames.length : 0;
    swapFrames.lastRealFrames = realFrames;
    const challenge = steps ?? swapFrames.challenge ?? ["left", "right"];
    body.frames = framesFor(challenge, { identity, scale });
    await route.continue({ postData: JSON.stringify(body) });
  });
  // Learn the challenge from the start response.
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/attendance/kiosk/attempts") && response.request().method() === "POST") {
      try { swapFrames.challenge = (await response.json()).challenge; } catch { /* refused attempts carry none */ }
    }
  });
}

/** Waits for a selector; on timeout prints what the page shows and its console errors, then rethrows. */
async function waitFor(page, selector, timeout, errors = []) {
  try {
    await page.waitForSelector(selector, { timeout });
  } catch (error) {
    const phase = await page.evaluate(() => [document.querySelector("[data-kiosk-phase]")?.getAttribute("data-kiosk-phase"),
      document.querySelector("[data-enroll-state]")?.getAttribute("data-enroll-state"), document.querySelector("main")?.innerText.slice(0, 400)]).catch(() => []);
    console.log(`  waited for ${selector}: ${JSON.stringify(phase)} console: ${errors.join(" | ")}`);
    throw error;
  }
}

const SHOTS = path.join(root, "tmp", "attendance-browser", "shots");
mkdirSync(SHOTS, { recursive: true });
/** Layout screenshots for review (fake pattern camera, no person), kept under the ignored tmp/ folder. */
async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function main() {
  await waitUp(BASE, server);
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${VERIFIER_PORT}/v1/health`, { headers: { authorization: `Bearer ${verifierToken}` } })).ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await person("admin", "br.admin@example.test", "BR Admin", ["system_admin"]);
  await person("kiosk", "br.kiosk@example.test", "Maarif kiosk", ["attendance_kiosk"]);
  psql(`insert into public.attendance_devices (organization_id, branch_id, user_id, label) select organization_id, id, '${people.kiosk.id}', 'Entrance laptop' from public.branches where code = 'maarif';`);

  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL ?? "msedge",
    headless: true,
    args: [...FAKE_CAMERA, "--use-fake-ui-for-media-stream"],
  });
  const laptop = { width: 1366, height: 768 };

  section("1. Administration pages (Arabic and English)");
  for (const [locale, viewport] of [["en", laptop], ["ar", { width: 375, height: 800 }]]) {
    const a = await signIn(browser, people.admin, locale, viewport);
    await a.page.goto(`${BASE}/${locale}/attendance/employees`);
    await a.page.fill('form[data-form="attendance-create"] input[name="full_name"]', locale === "en" ? "Synthetic Employee A" : "موظف تجريبي ب");
    await Promise.all([a.page.waitForURL(/\/attendance\/employees\/[0-9a-f-]{36}/), a.page.click('form[data-form="attendance-create"] button')]);
    check(`${locale}: adding an employee goes straight to enrollment with the number shown large`,
      /^\d{3}$/.test((await a.page.getAttribute("[data-employee-code]", "data-employee-code")) ?? ""));
    await shot(a.page, `${locale}-${viewport.width}-enroll-number`);
    for (const p of ["attendance", "attendance/employees", "attendance/devices"]) {
      await a.page.goto(`${BASE}/${locale}/${p}`);
      check(`${locale} ${viewport.width}px: /${p} renders without horizontal page scroll`, await noHorizontalOverflow(a.page));
      await shot(a.page, `${locale}-${viewport.width}-${p.replace("/", "-")}`);
    }
    await a.page.goto(`${BASE}/${locale}/attendance`);
    check(`${locale}: the attendance home shows the four cards`, (await a.page.locator("[data-card]").count()) === 4);
    check(`${locale}: the menu offers Attendance`, (await a.page.locator(`nav a[href="/${locale}/attendance"]`).count()) === 1);
    check(`${locale}: direction`, (await a.page.getAttribute("html", "dir")) === (locale === "ar" ? "rtl" : "ltr"));
    check(`${locale}: no console errors on the administration pages`, a.errors.length === 0, a.errors.join(" | "));
    await a.context.close();
  }
  const timings = [];
  const ids = psql("select string_agg(e.employee_number || ':' || e.id, ',' order by e.employee_number) from public.employees e join public.attendance_employees a on a.employee_id = e.id").split(",");
  const [codeA, employeeA] = ids[0].split(":");
  const [codeB, employeeB] = ids[1].split(":");

  section("2. Enrollment page with the camera");
  {
    const a = await signIn(browser, people.admin, "en", laptop);
    await a.page.goto(`${BASE}/en/attendance/employees/${employeeA}/enroll`);
    await a.page.waitForLoadState("networkidle");
    await swapFrames(a.page, { kind: "enroll", identity: "employee-a", steps: ["left", "right"] });
    await a.page.selectOption('select[name="identity_document"]', "national_id");
    await a.page.check('input[name="consent"]');
    await a.page.click('button[data-action="enroll"]');
    await waitFor(a.page, '[data-enroll-state="done"], [data-enroll-state="failed"]', 30000, a.errors);
    check("enrollment through the camera page succeeds", (await a.page.getAttribute("[data-enroll-state]", "data-enroll-state")) === "done",
      `${await a.page.textContent("[data-enroll-state]")} ${a.errors.join(" | ")}`);
    check("the page captured real camera frames (8-40)", swapFrames.lastRealFrames >= 8 && swapFrames.lastRealFrames <= 40, String(swapFrames.lastRealFrames));
    await a.page.goto(`${BASE}/ar/attendance/employees/${employeeB}/enroll`);
    await a.page.waitForLoadState("networkidle");
    await swapFrames(a.page, { kind: "enroll", identity: "employee-b", steps: ["left", "right"] });
    await a.page.selectOption('select[name="identity_document"]', "passport");
    await a.page.check('input[name="consent"]');
    await a.page.click('button[data-action="enroll"]');
    await waitFor(a.page, '[data-enroll-state="done"], [data-enroll-state="failed"]', 30000, a.errors);
    check("Arabic enrollment page succeeds", (await a.page.getAttribute("[data-enroll-state]", "data-enroll-state")) === "done");
    check("camera switched off after enrollment", await a.page.evaluate(() => !document.querySelector("video")?.srcObject));
    await a.context.close();
  }

  section("3. Kiosk at the laptop (English)");
  {
    const k = await signIn(browser, people.kiosk, "en", laptop);
    await k.page.goto(`${BASE}/en/kiosk`);
    await k.page.waitForLoadState("networkidle");
    check("the kiosk hides the menu and sign-out", !(await k.page.locator(".site-header").isVisible()));
    check("kiosk fits the laptop screen", await noHorizontalOverflow(k.page));
    await swapFrames(k.page, { identity: "employee-a" });
    await k.page.fill('[data-field="employee-code"]', codeA);
    await k.page.click('button[data-action="check_in"]');
    await waitFor(k.page, '[data-kiosk-phase="capture"]', 15000, k.errors);
    await k.page.waitForTimeout(1200);
    await shot(k.page, "en-1366-kiosk-capture");
    const instruction = await k.page.textContent(".kiosk-instruction");
    check("the camera instruction is shown", /Look straight|turn your head|tilt your head/i.test(instruction ?? ""), instruction ?? "");
    check("the live preview is visible during the check", await k.page.locator("video.kiosk-video").isVisible());
    await k.page.waitForSelector('[data-result="ok"], [data-result="bad"]', { timeout: 30000 });
    const text = await k.page.textContent(".kiosk-result");
    check("check-in confirmed with the name and time", /Check-in recorded at \d{2}:\d{2}:\d{2}/.test(text ?? "") && /Welcome, Synthetic/.test(text ?? ""), text ?? "");
    const elapsed = Number(await k.page.getAttribute("[data-result]", "data-elapsed-ms"));
    timings.push(elapsed);
    console.log(`  time from the button to the confirmation: ${elapsed} ms`);
    await shot(k.page, "en-1366-kiosk-confirmed");
    check("camera switched off after the check", await k.page.evaluate(() => !document.querySelector("video")?.srcObject));
    check("one event in the database", count("select count(*) from public.attendance_events") === 1);
    await k.page.click(".kiosk-result button");
    await k.page.fill('[data-field="employee-code"]', codeA);
    await k.page.click('button[data-action="check_in"]');
    await k.page.waitForSelector('[data-result="bad"]', { timeout: 15000 });
    const repeated = await k.page.textContent(".kiosk-result");
    check("a repeated check-in shows the current state", /already checked in/i.test(repeated ?? "") && /checked in since/i.test(repeated ?? ""), repeated ?? "");
    check("the double check-in recorded nothing", count("select count(*) from public.attendance_events") === 1);
    check("no console errors on the kiosk", k.errors.length === 0, k.errors.join(" | "));
    // Turns that are too small: a clear hint, nothing recorded.
    await k.page.click(".kiosk-result button");
    await k.page.unroute("**/api/attendance/kiosk/attempts/*/verify");
    await swapFrames(k.page, { identity: "employee-a", scale: 0.4 });
    await k.page.fill('[data-field="employee-code"]', codeA);
    await k.page.click('button[data-action="check_out"]');
    await waitFor(k.page, '[data-result="bad"]', 30000, k.errors);
    check("small turns show 'turn further'", /Turn your head further/.test((await k.page.textContent("[data-hint]").catch(() => "")) ?? ""));
    await shot(k.page, "en-1366-kiosk-hint");
    await k.page.click(".kiosk-result button");
    await k.page.fill('[data-field="employee-code"]', codeA.slice(0, 2));
    await k.page.waitForTimeout(1500);
    check("typing warms the camera (preview shown before any button)", await k.page.locator("video.kiosk-video").isVisible());
    await shot(k.page, "en-1366-kiosk-typing");
    await k.context.close();
  }

  section("4. Kiosk in Arabic: impostor, lost connection, then success");
  {
    const k = await signIn(browser, people.kiosk, "ar", laptop);
    await k.page.goto(`${BASE}/ar/kiosk`);
    await k.page.waitForLoadState("networkidle");
    check("Arabic kiosk is right-to-left", (await k.page.getAttribute("html", "dir")) === "rtl");
    await swapFrames(k.page, { identity: "employee-a" });
    await k.page.fill('[data-field="employee-code"]', codeB);
    await k.page.click('button[data-action="check_in"]');
    await k.page.waitForSelector('[data-result="bad"]', { timeout: 30000 });
    check("someone else with B's ID is refused (Arabic message)", (await k.page.textContent(".kiosk-result"))?.includes("الوجه لا يطابق") === true);
    await k.page.click(".kiosk-result button");
    await k.page.unroute("**/api/attendance/kiosk/attempts/*/verify");
    await swapFrames(k.page, { identity: "employee-b", abortFirst: true });
    await k.page.fill('[data-field="employee-code"]', codeB);
    await k.page.click('button[data-action="check_in"]');
    await k.page.waitForSelector('[data-result="retry"]', { timeout: 30000 });
    check("a lost connection is shown with nothing confirmed", (await k.page.textContent(".kiosk-result"))?.includes("انقطع الاتصال") === true);
    check("nothing recorded while the connection is lost", count(`select count(*) from public.attendance_events where employee_id = '${employeeB}'`) === 0);
    await k.page.click('button[data-action="retry"]');
    await k.page.waitForSelector('[data-result="ok"], [data-result="bad"]', { timeout: 30000 });
    timings.push(Number(await k.page.getAttribute("[data-result]", "data-elapsed-ms")));
    await shot(k.page, "ar-1366-kiosk-confirmed");
    check("sending again records the check-in once", (await k.page.textContent(".kiosk-result"))?.includes("تم تسجيل الحضور الساعة") === true
      && count(`select count(*) from public.attendance_events where employee_id = '${employeeB}'`) === 1);
    await k.context.close();
  }

  section("5. Camera problems");
  {
    // Camera refused: a browser without the automatic permission and a context that grants none.
    const strict = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true, args: FAKE_CAMERA });
    const k = await signIn(strict, people.kiosk, "en", laptop, { contextOptions: { permissions: [] } });
    await k.page.goto(`${BASE}/en/kiosk`);
    await k.page.waitForLoadState("networkidle");
    await k.page.fill('[data-field="employee-code"]', codeA);
    await k.page.click('button[data-action="check_out"]');
    await k.page.waitForSelector('[data-result="bad"]', { timeout: 30000 });
    const refused = await k.page.textContent(".kiosk-result");
    check("camera permission refused: clear message", /Camera access was refused|camera is not available/i.test(refused ?? ""), refused ?? "");
    check("recorded as a camera failure", count("select count(*) from public.attendance_attempts where reason in ('camera_permission_denied', 'camera_unavailable')") === 1);
    await k.context.close();
    await strict.close();

    const k2 = await signIn(browser, people.kiosk, "en", laptop);
    await k2.page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("no camera", "NotFoundError"); };
    });
    await k2.page.goto(`${BASE}/en/kiosk`);
    await k2.page.waitForLoadState("networkidle");
    await k2.page.fill('[data-field="employee-code"]', codeA);
    await k2.page.click('button[data-action="check_out"]');
    await k2.page.waitForSelector('[data-result="bad"]', { timeout: 30000 });
    check("no camera: 'The camera is not available.'", (await k2.page.textContent(".kiosk-result"))?.includes("The camera is not available.") === true);
    await k2.context.close();

    const k3 = await signIn(browser, people.kiosk, "en", laptop);
    await k3.page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await original(constraints);
        setTimeout(() => stream.getVideoTracks().forEach((t) => { t.stop(); t.dispatchEvent(new Event("ended")); }), 1500);
        return stream;
      };
    });
    await k3.page.goto(`${BASE}/en/kiosk`);
    await k3.page.waitForLoadState("networkidle");
    await k3.page.fill('[data-field="employee-code"]', codeA);
    await k3.page.click('button[data-action="check_out"]');
    await k3.page.waitForSelector('[data-result="bad"]', { timeout: 30000 });
    check("camera stops mid-check: clear message", (await k3.page.textContent(".kiosk-result"))?.includes("The camera stopped during the check.") === true);
    check("recorded as camera_stopped, no event", count("select count(*) from public.attendance_attempts where reason = 'camera_stopped'") === 1
      && count(`select count(*) from public.attendance_events where employee_id = '${employeeA}'`) === 1);
    await k3.context.close();

    // The real fake-camera pictures (a test pattern) reach the verifier unchanged: no face, nothing recorded.
    const k4 = await signIn(browser, people.kiosk, "en", laptop);
    await k4.page.goto(`${BASE}/en/kiosk`);
    await k4.page.waitForLoadState("networkidle");
    await k4.page.fill('[data-field="employee-code"]', codeA);
    await k4.page.click('button[data-action="check_out"]');
    await k4.page.waitForSelector('[data-result="bad"]', { timeout: 30000 });
    check("pictures without a face are refused", /could not be read|No face/i.test((await k4.page.textContent(".kiosk-result")) ?? ""));
    check("still only A's check-in", count(`select count(*) from public.attendance_events where employee_id = '${employeeA}'`) === 1);
    await k4.context.close();
  }

  section("6. Overview after the kiosk events");
  {
    const a = await signIn(browser, people.admin, "ar", { width: 375, height: 800 });
    await a.page.goto(`${BASE}/ar/attendance`);
    check("Arabic overview lists the open shifts for review", (await a.page.locator('[data-shift-status="missing_check_out"]').count()) === 2);
    check("Arabic overview lists the failed attempts", (await a.page.locator("[data-attempt-reason]").count()) >= 4);
    check("375 px: no horizontal page scroll", await noHorizontalOverflow(a.page));
    check("no console errors", a.errors.length === 0, a.errors.join(" | "));
    await a.context.close();
  }
  const fast = timings.filter((t) => t > 0);
  console.log(`  kiosk timings (ms, synthetic verifier; the second includes a manual resend): ${fast.join(", ")}`);
  check("a normal check-in confirms within 6 s (synthetic engine)", fast.length > 0 && fast[0] < 6000, fast.join(","));
  {
    const k = await signIn(browser, people.kiosk, "ar", { width: 375, height: 800 });
    await k.page.goto(`${BASE}/ar/kiosk`);
    await k.page.waitForLoadState("networkidle");
    check("Arabic kiosk at 375 px has no horizontal scroll", await noHorizontalOverflow(k.page));
    await shot(k.page, "ar-375-kiosk");
    await k.context.close();
  }
  await browser.close();
}

main()
  .catch((error) => { state.failures += 1; console.error(error); })
  .finally(() => {
    server.child.kill();
    verifier.kill();
    console.log(`\n${state.checks - state.failures}/${state.checks} attendance browser checks passed${state.failures ? `; FAILED: ${state.names.join(", ")}` : ""}`);
    process.exit(state.failures ? 1 : 0);
  });
