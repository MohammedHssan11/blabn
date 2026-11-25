// Phase 10 browser walk-through in Edge against the PRODUCTION build and a DISPOSABLE local Supabase stack:
// sign-in to report download, in English (desktop) and Arabic (375 px), with a validation message, a
// language switch in the middle of the work, the close, the correction and the downloaded workbook.
//
//   P10_REFERENCE_FILE=<private json> npm run build && node scripts/phase10/browser-check.mjs [--no-setup]
//
// Setup runs scripts/phase10/e2e.mjs --no-scenarios first (it resets the database and enters October and
// November once), then signs in new synthetic people: a cashier, a manager and Abdo's designated account.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { chromium } from "playwright-core";
import { container } from "../phase3/db-check.mjs";
import { createReporter, loadEnv, run, serviceClient, startServer, waitUp } from "../phase3/lib.mjs";

const PORT = process.env.E2E_PORT ?? "3221";
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOT_DIR ?? path.join(os.tmpdir(), "balaban-phase10-shots");
mkdirSync(SHOTS, { recursive: true });
const { check, section, state } = createReporter();
if (!process.argv.includes("--no-setup")) {
  console.log("Preparing the rehearsal data (scripts/phase10/e2e.mjs --no-scenarios)...");
  const setup = run("node", ["scripts/phase10/e2e.mjs", "--no-scenarios"]);
  if (setup.status !== 0) { console.error(`setup failed\n${setup.stdout.slice(-2500)}\n${setup.stderr}`); process.exit(2); }
}
const env = loadEnv();
const server = startServer(PORT, { SITE_URL: BASE });
const service = serviceClient(env);
const problems = [];
const psql = (sql) => {
  const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"], { input: sql });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const watch = (page, label) => {
  page.on("pageerror", (e) => problems.push(`${label}: pageerror ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|status of 40[134]/.test(m.text())) problems.push(`${label}: ${m.text()}`); });
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const arabic = (text) => /[؀-ۿ]/.test(text);

async function person(name, group, designate = false) {
  const email = `p10.browser.${randomBytes(4).toString("hex")}@example.test`;
  const password = `${randomBytes(9).toString("base64url")}-Aa1`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`could not create ${name}`);
  const id = created.data.user.id;
  psql(`begin;
    insert into public.employees(id, organization_id, full_name) select '${id}', organization_id, '${name}' from public.branches where code = 'maarif';
    insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, '${email}' from public.employees where id = '${id}';
    insert into public.branch_memberships(staff_id, branch_id) select '${id}', id from public.branches where code = 'maarif';
    insert into public.staff_group_assignments(staff_id, branch_id, group_key) select '${id}', ${group === "system_admin" ? "null" : "id"}, '${group}' from public.branches where code = 'maarif';
    ${designate ? `update app_private.report_export_owners set staff_id = '${id}';` : ""}
    commit;`);
  return { id, email, password };
}

async function signIn(browser, viewport, locale, who, label) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  watch(page, label);
  await page.goto(`${BASE}/${locale}/sign-in`);
  await page.fill('form[data-form="sign-in"] input[name="email"]', who.email);
  await page.fill('form[data-form="sign-in"] input[name="password"]', who.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/sign-in")), page.click('form[data-form="sign-in"] button[type="submit"]')]);
  return { context, page };
}

async function openForm(page, command, change = "") {
  const form = page.locator(`form[data-command="${command}"]${change ? `[data-change="${change}"]` : ""}`).first();
  await form.evaluate((element) => { let node = element.parentElement; while (node) { if (node instanceof HTMLDetailsElement) node.open = true; node = node.parentElement; } });
  return form;
}
const revision = async (page) => (await page.locator("[data-day-revision]").count()) ? Number(await page.locator("[data-day-revision]").getAttribute("data-day-revision")) : 0;
async function save(page, command, fields = {}, { change = "", expectError = false, skipValidation = false } = {}) {
  const prior = await revision(page);
  const form = await openForm(page, command, change);
  for (const [name, value] of Object.entries(fields)) {
    const control = form.locator(`[name="${name}"]`);
    if ((await control.evaluate((el) => el.tagName)) === "SELECT") await control.selectOption(String(value)); else await control.fill(String(value));
  }
  if (skipValidation) await form.evaluate((f) => { f.noValidate = true; });
  await form.locator('button[type="submit"]').click();
  if (expectError) { await page.locator('p[role="alert"]').first().waitFor({ timeout: 15000 }); return; }
  await page.waitForFunction((r) => Number(document.querySelector("[data-day-revision]")?.dataset.dayRevision) > r || new URL(location.href).searchParams.has("error"), prior);
  await page.getByRole("status").filter({ hasText: /change was saved|تم حفظ التغيير/ }).waitFor({ timeout: 15000 });
}

async function download(page, label, locale, month) {
  await page.goto(`${BASE}/${locale}/reports/exports`);
  const form = page.locator('form[data-form="export-daily_sales-month"]');
  await form.evaluate((element) => { let node = element.parentElement; while (node) { if (node instanceof HTMLDetailsElement) node.open = true; node = node.parentElement; } });
  await form.locator('[name="month"]').fill(month);
  await form.locator('[name="workbook_locale"]').selectOption(locale);
  await Promise.all([page.waitForURL(/\/reports\/exports\/[0-9a-f-]{36}/), form.locator('button[type="submit"]').click()]);
  check(`${label}: the export page opens with a completion notice`, (await page.locator('[data-link="download"]').count()) === 1);
  const [file] = await Promise.all([page.waitForEvent("download"), page.locator('[data-link="download"]').click()]);
  const target = path.join(SHOTS, `${label.replace(/\W+/g, "_")}.xlsx`);
  await file.saveAs(target);
  const bytes = readFileSync(target);
  const zip = await JSZip.loadAsync(bytes);
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  check(`${label}: the browser downloaded a real workbook (${(bytes.length / 1024).toFixed(0)} KB)`, bytes.subarray(0, 2).toString() === "PK" && bytes.length > 4000);
  check(`${label}: ${locale === "ar" ? "right-to-left" : "left-to-right"} sheet, no formulas`, (locale === "ar") === /rightToLeft="1"/.test(sheet) && !/<f[\s>]/.test(sheet));
  return sheet;
}

let browser;
try {
  await waitUp(BASE, server);
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
  const cashier = await person("P10 Browser Cashier", "cashier");
  const manager = await person("P10 Browser Manager", "manager");
  const abdo = await person("P10 Browser Abdo", "system_admin", true);

  for (const [locale, viewport, day, label] of [["en", { width: 1280, height: 900 }, "2026-11-14", "EN desktop"], ["ar", { width: 375, height: 800 }, "2026-11-15", "AR 375 px"]]) {
    section(`${label}: sign-in, daily close, validation, language switch, correction, report download`);
    const c = await signIn(browser, viewport, locale, cashier, `${label} cashier`);
    const m = await signIn(browser, viewport, locale, manager, `${label} manager`);
    const dir = locale === "ar" ? "rtl" : "ltr";
    check(`${label}: signed in and the page direction is ${dir}`, (await c.page.locator("html").getAttribute("dir")) === dir && (await c.page.locator("html").getAttribute("lang")) === locale);
    await c.page.goto(`${BASE}/${locale}/daily-close?date=${day}`);
    check(`${label}: the daily close fits the screen`, await fits(c.page));
    // Validation: text that is not an amount reaches the server and is answered in the page's language.
    await save(c.page, "save", { sales: "abc", posCash: "10", card: "0", orders: "5" }, { expectError: true, skipValidation: true });
    const alertText = await c.page.locator('p[role="alert"]').first().innerText();
    check(`${label}: an invalid amount is refused with a message in ${locale === "ar" ? "Arabic" : "English"}`, arabic(alertText) === (locale === "ar") && alertText.trim().length > 5, alertText);
    check(`${label}: nothing was saved by the invalid attempt`, (await revision(c.page)) === 0);
    await c.page.screenshot({ path: path.join(SHOTS, `${label.replace(/\W+/g, "_")}_validation.png`), fullPage: true });
    // The real day: 14 November (en) / 15 November (ar), same shape as a workbook day.
    await save(c.page, "save", { sales: "100", posCash: "70", card: "30", orders: "10" });
    await save(c.page, "entry", { kind: "cash_expense", amount: "2", local: `${day}T21:00` });
    check(`${label}: cashier saved the day and an expense (revision 2)`, (await revision(c.page)) === 2);
    await save(c.page, "submit");
    check(`${label}: the cashier sent the day for review`, (await c.page.locator("[data-day-state]").getAttribute("data-day-state")) === "awaiting_review");
    // Language switch in the middle of the work: the same day, the same figures, the other direction.
    const other = locale === "ar" ? "en" : "ar";
    await Promise.all([c.page.waitForURL((u) => u.pathname.startsWith(`/${other}/`)), c.page.locator(`[data-switch-to="${other}"]`).first().click()]);
    check(`${label}: switching language keeps the page and the day`, c.page.url().includes("daily-close") && c.page.url().includes(day), c.page.url());
    check(`${label}: after the switch the direction is ${other === "ar" ? "rtl" : "ltr"} and the saved revision is unchanged`,
      (await c.page.locator("html").getAttribute("dir")) === (other === "ar" ? "rtl" : "ltr") && (await revision(c.page)) === 3);
    await c.page.goto(`${BASE}/${locale}/daily-close?date=${day}`);
    // Count, review and close as the manager.
    await m.page.goto(`${BASE}/${locale}/cash-count?date=${day}`);
    await save(m.page, "count", { local: `${day}T23:30`, qty5000: "1", qty1000: "1", qty500: "1", qty200: "1", qty100: "1" });
    await save(m.page, "close");
    check(`${label}: the manager closed the day`, (await m.page.locator("[data-day-state]").getAttribute("data-day-state")) === "closed");
    await save(m.page, "late_remittance", { amount: "68", local: `${day}T23:50`, reference: `P10-BROWSER-${locale}` });
    // Correction: proposed, then approved by the manager (each is a saved revision with its own history entry).
    const before = await revision(m.page);
    await save(m.page, "propose", { kind: "cash_receipt", amount: "5.00", local: `${day}T22:00`, reason: "Phase 10 browser rehearsal" }, { change: "entry" });
    const proposed = await revision(m.page);
    check(`${label}: the correction proposal is saved as its own revision`, proposed > before, `${before} -> ${proposed}`);
    await save(m.page, "approve");
    check(`${label}: approving it adds another revision and the day stays closed`, (await revision(m.page)) > proposed && (await m.page.locator("[data-day-state]").getAttribute("data-day-state")) !== "draft");
    check(`${label}: the cash-count page fits the screen`, await fits(m.page));
    await m.page.screenshot({ path: path.join(SHOTS, `${label.replace(/\W+/g, "_")}_closed.png`), fullPage: true });
    // Abdo's account downloads the month.
    const a = await signIn(browser, viewport, locale, abdo, `${label} Abdo`);
    check(`${label}: the Excel reports page fits the screen`, await (async () => { await a.page.goto(`${BASE}/${locale}/reports/exports`); return fits(a.page); })());
    const sheet = await download(a.page, `${label} Daily Sales 2026-11`, locale, "2026-11");
    check(`${label}: the new day (${day}) is in the downloaded Daily Sales (sales 100.00 and 10 orders)`, sheet.includes("<v>100</v>") && sheet.includes("<v>10</v>"));
    await a.page.screenshot({ path: path.join(SHOTS, `${label.replace(/\W+/g, "_")}_export.png`), fullPage: true });
    await c.context.close(); await m.context.close(); await a.context.close();
  }
  section("Console");
  check("no browser console errors or page errors", problems.length === 0, problems.slice(0, 4).join(" | "));
} catch (error) {
  state.failures += 1;
  console.error(error);
} finally {
  if (browser) await browser.close();
  server.child.kill();
  console.log(`\n${state.checks} checks, ${state.failures} failures${state.names.length ? `: ${state.names.join("; ")}` : ""}\nScreenshots and downloads: ${SHOTS}`);
  process.exit(state.failures === 0 ? 0 : 1);
}
