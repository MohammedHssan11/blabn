// Run the production build against an empty, isolated local Supabase project.
// A private reference case can be verified by passing its JSON path in PHASE4_REFERENCE_FILE.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createReporter, directSession, loadEnv, run, serviceClient, startServer, waitUp } from "../phase3/lib.mjs";

const { state, check } = createReporter();
const env = loadEnv();
const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
const container = process.env.SUPABASE_DB_CONTAINER;
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !container?.startsWith("supabase_db_") ||
    container === "supabase_db_balaban-dev") {
  throw new Error("Point the browser check at an isolated local Supabase project using SUPABASE_DB_CONTAINER and the local API settings.");
}
const port = process.env.E2E_PORT ?? 3144;
const base = `http://127.0.0.1:${port}`;
const service = serviceClient(env);
const reference = process.env.PHASE4_REFERENCE_FILE ? JSON.parse(readFileSync(process.env.PHASE4_REFERENCE_FILE, "utf8")) : null;
const test = reference ?? {
  day: "2026-11-12", next: "2026-11-13", cash: "700", card: "300", sales: "1000",
  expense: "100", count: { 20000: "3", 100: "3" }, remittance: "603", variance: 300,
  expected: 60000, counted: 60300,
};

function psql(sql) {
  const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"], { input: sql });
  if (result.status !== 0) throw new Error("Could not prepare isolated Phase 4 test staff.");
  return result.stdout.trim();
}
assert.equal(psql("select count(*) from public.operating_days;"), "0", "Start with an empty operating ledger.");

function makeTestPassphrase() {
  return [randomBytes(16).toString("base64url"), "Aa1"].join("-");
}

async function staff(role) {
  const email = `${role}-${randomBytes(5).toString("hex")}@example.test`;
  const password = makeTestPassphrase();
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`Could not create local ${role}`);
  const { id } = created.data.user;
  assert.match(id, /^[\da-f-]{36}$/);
  psql(`
    begin;
    insert into public.employees(id, organization_id, full_name)
    select '${id}', organization_id, 'Test ${role}' from public.branches where code = 'maarif';
    insert into public.staff_accounts(user_id, employee_id, organization_id, email)
    select id, id, organization_id, '${email}' from public.employees where id = '${id}';
    insert into public.branch_memberships(staff_id, branch_id)
    select '${id}', id from public.branches where code = 'maarif';
    insert into public.staff_group_assignments(staff_id, branch_id, group_key)
    select '${id}', case when '${role}' = 'system_admin' then null else id end, '${role}'
    from public.branches where code = 'maarif';
    commit;
  `);
  return { id, email, password };
}

async function signIn(browser, locale, person, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${base}/${locale}/sign-in`);
  await page.locator('input[name="email"]').fill(person.email);
  await page.locator('input[name="password"]').fill(person.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/${locale}`),
    page.locator('form[data-form="sign-in"] button[type="submit"]').click(),
  ]);
  return page;
}

async function openForm(page, command, change = "") {
  const form = page.locator(`form[data-command="${command}"]${change ? `[data-change="${change}"]` : ""}`).first();
  await form.evaluate((element) => {
    let node = element.parentElement;
    while (node) {
      if (node instanceof HTMLDetailsElement) node.open = true;
      node = node.parentElement;
    }
  });
  return form;
}

async function save(page, command, fields = {}, change = "") {
  const prior = await page.locator("[data-day-revision]").count()
    ? Number(await page.locator("[data-day-revision]").getAttribute("data-day-revision")) : 0;
  const form = await openForm(page, command, change);
  for (const [name, value] of Object.entries(fields)) {
    const control = form.locator(`[name="${name}"]`);
    if ((await control.evaluate((el) => el.tagName)) === "SELECT") await control.selectOption(String(value));
    else await control.fill(String(value));
  }
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().startsWith(base));
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  if (command === "account") {
    await page.locator("#ledger-accounts summary").filter({ hasText: String(fields.label) }).first().waitFor({ state: "attached" });
  } else {
    await page.waitForFunction((revision) =>
      Number(document.querySelector("[data-day-revision]")?.dataset.dayRevision) > revision ||
      new URL(location.href).searchParams.has("error"), prior);
  }
  await page.getByRole("status").filter({ hasText: /change was saved|تم حفظ التغيير/ }).waitFor({ timeout: 15000 })
    .catch(async () => {
      const error = page.getByRole("alert");
      throw new Error(`Command ${command} failed with HTTP ${response.status()} (${await error.count() ? await error.first().textContent() : "no form feedback"})`);
    });
}

async function report(client, date, basis = null) {
  const { data, error } = await client.rpc("app_operating_report", {
    p_branch: "maarif", p_date: date, p_month: date.slice(0, 7) + "-01", p_basis: basis,
  });
  if (error) throw new Error(`Report request failed: ${error.code}`);
  return data;
}

async function readVariance(page, locale, date, value) {
  await page.goto(`${base}/${locale}/cash-count?date=${date}`);
  for (const name of ["daily-statement", "yawmeya"]) {
    const cell = page.locator(`[data-report="${name}"] [data-variance]`);
    check(`${locale} ${name} shows the saved count variance`, (await cell.getAttribute("data-variance")) === String(value));
  }
  check(`${locale} layout direction`, await page.locator("html").getAttribute("dir") === (locale === "ar" ? "rtl" : "ltr"));
  check(`${locale} page fits viewport`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}

const server = startServer(port, { SITE_URL: base, BALABAN_DEMO_FIXTURES: "0" });
let browser;
try {
  await waitUp(base, server);
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
  const cashier = await staff("cashier");
  const manager = await staff("manager");
  const en = await signIn(browser, "en", cashier, { width: 1280, height: 900 });
  const ar = await signIn(browser, "ar", manager, { width: 375, height: 800 });
  const { client } = await directSession(env, manager.email, manager.password);
  const cashierSession = await directSession(env, cashier.email, cashier.password);

  await en.goto(`${base}/en/daily-close?date=${test.day}`);
  await save(en, "save", { openingCash: 0, openingCustody: 0, sales: test.sales, posCash: test.cash, card: test.card, orders: 10 });
  check("cashier opened the business day", await en.locator("[data-day-state]").getAttribute("data-day-state") === "draft");
  const account = await openForm(en, "entry");
  const accountId = await account.locator('select[name="account"] optgroup').first().locator("option").first().getAttribute("value");
  await save(en, "entry", { kind: "cash_expense", amount: test.expense, account: accountId, local: test.day + "T21:00" });
  check("seeded account label appears on the saved entry", /\d{3,}/.test(await en.locator('[data-entry="cash_expense"] td').nth(3).textContent()));
  await save(en, "submit");
  check("cashier submitted the day for review", await en.locator("[data-day-state]").getAttribute("data-day-state") === "awaiting_review");

  await ar.goto(`${base}/ar/cash-count?date=${test.day}`);
  await save(ar, "count", { local: test.next + "T02:30",
    ...Object.fromEntries(Object.entries(test.count).map(([denomination, qty]) => [`qty${denomination}`, qty])) });
  check("physical counter and recorder were saved separately", (await report(client, test.day)).day.data.count.recorder === manager.id);
  await save(ar, "close");
  check("manager closed the intended day", await ar.locator("[data-day-state]").getAttribute("data-day-state") === "closed");
  const atClose = await report(client, test.day);
  check("after-cutoff count retains the selected business date", atClose.day.data.count.local === test.next + "T02:30" &&
    atClose.days[0].date === test.day && atClose.day.closedAt);
  check("expected and counted amounts before remittance", atClose.day.summary.expected === test.expected &&
    atClose.day.data.count.total === test.counted);
  await readVariance(en, "en", test.day, test.variance);
  await readVariance(ar, "ar", test.day, test.variance);

  await save(ar, "late_remittance", { amount: test.remittance, local: test.next + "T03:10", reference: "LOCAL-CHECK-1" });
  const afterRemit = await report(client, test.day);
  check("only one bank movement and unchanged count variance", afterRemit.day.data.entries.filter((entry) => entry.kind === "remittance").length === 1 &&
    afterRemit.day.summary.variance === test.variance);
  await readVariance(en, "en", test.day, test.variance);
  await readVariance(ar, "ar", test.day, test.variance);

  const originalCsv = await en.request.get(`${base}/api/exports/daily-close-draft?date=${test.day}&basis=${afterRemit.basis}`);
  check("saved CSV includes the revision used", originalCsv.ok() && (await originalCsv.text()).includes(String(afterRemit.basis)));

  if (!reference) {
    await save(ar, "propose", { kind: "cash_receipt", amount: "12.00", local: test.day + "T22:00", reason: "Synthetic test correction" }, "entry");
    check("proposal needs approval", !!(await report(client, test.day)).day.proposal);
    await save(ar, "approve");
    check("same manager approved the correction with revision history", (await report(client, test.day)).day.history[0].command === "approve");
    const historicalCsv = await en.request.get(`${base}/api/exports/daily-close-draft?date=${test.day}&basis=${afterRemit.basis}`);
    check("the previously exported basis remains byte-identical", (await originalCsv.text()) === (await historicalCsv.text()));

    const rpc = (request) => cashierSession.client.rpc("app_operating_command", {
      p_branch: "maarif", p_date: test.next, p_command: "save", p_expected_revision: 0, p_request: request,
      p_payload: { sales: 0, posCash: 0, card: 0, cashier: cashier.id },
    });
    const parallel = await Promise.all([rpc(randomUUID()), rpc(randomUUID())]);
    check("two simultaneous saves accept exactly one revision", parallel.filter((r) => !r.error).length === 1 &&
      parallel.find((r) => r.error)?.error.code === "40001");

    const admin = await staff("system_admin");
    const adminPage = await signIn(browser, "en", admin, { width: 1200, height: 850 });
    await adminPage.goto(`${base}/en/daily-close?date=${test.next}`);
    await save(adminPage, "account", { ledger: "custody", code: "999999", label: "Synthetic test account" });
    check("configuration admin can add a ledger category", await adminPage.locator("#ledger-accounts").textContent().then((text) => text.includes("Synthetic test account")));
  }
} finally {
  if (browser) await browser.close();
  server.child.kill();
}
console.log(`Phase 4 ${reference ? "private reference" : "browser"} checks: ${state.checks - state.failures}/${state.checks}`);
if (state.failures) process.exitCode = 1;
