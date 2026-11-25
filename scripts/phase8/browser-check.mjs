// Phase 8 browser checks: planning, purchase orders, approval, expected-date changes and receiving in a
// real browser, English (LTR) desktop and Arabic (RTL) at 375 px, against the PRODUCTION build and the
// LOCAL Supabase instance.
//
//   npm run build && npm run test:phase8:browser
//
// Runs the HTTP check first (scripts/phase8/e2e.mjs, which rebuilds the database and leaves its
// synthetic history, items and orders), then signs in new synthetic people in Edge: an administrator,
// a storekeeper, a manager (view only) and a cashier (no access).
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { container } from "../phase3/db-check.mjs";
import { createReporter, loadEnv, run, serviceClient, startServer, waitUp } from "../phase3/lib.mjs";

const PORT = process.env.E2E_PORT ?? "3209";
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOT_DIR ?? path.join(os.tmpdir(), "balaban-phase8-shots");
mkdirSync(SHOTS, { recursive: true });
const { check, section, state } = createReporter();

if (!process.argv.includes("--no-setup")) {
  console.log("Preparing synthetic planning data (scripts/phase8/e2e.mjs)...");
  const setup = run("node", ["scripts/phase8/e2e.mjs"]);
  if (setup.status !== 0) {
    console.error(`setup failed\n${setup.stdout.slice(-2000)}\n${setup.stderr}`);
    process.exit(2);
  }
}
const env = loadEnv();
const server = startServer(PORT, { SITE_URL: BASE });
const service = serviceClient(env);
const consoleProblems = [];
const psql = (sql) => {
  const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"], { input: sql });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
function watch(page, label) {
  page.on("pageerror", (error) => consoleProblems.push(`${label}: pageerror ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource|status of 40[134]/.test(message.text())) consoleProblems.push(`${label}: ${message.text()}`);
  });
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function person(name, group) {
  const email = `p8.browser.${randomBytes(4).toString("hex")}@example.test`;
  const password = `${randomBytes(9).toString("base64url")}-Aa1`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`could not create ${name}`);
  const id = created.data.user.id;
  psql(`begin;
    insert into public.employees(id, organization_id, full_name) select '${id}', organization_id, '${name}' from public.branches where code = 'maarif';
    insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, '${email}' from public.employees where id = '${id}';
    insert into public.branch_memberships(staff_id, branch_id) select '${id}', id from public.branches where code = 'maarif';
    insert into public.staff_group_assignments(staff_id, branch_id, group_key)
      select '${id}', ${group === "system_admin" ? "null" : "id"}, '${group}' from public.branches where code = 'maarif';
    commit;`);
  return { email, password };
}

async function signIn(browser, viewport, locale, who, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  watch(page, label);
  await page.goto(`${BASE}/${locale}/sign-in`);
  await page.fill('form[data-form="sign-in"] input[name="email"]', who.email);
  await page.fill('form[data-form="sign-in"] input[name="password"]', who.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/sign-in")), page.click('form[data-form="sign-in"] button[type="submit"]')]);
  return { context, page };
}

async function layout(page, locale, label) {
  const dir = await page.evaluate(() => getComputedStyle(document.documentElement).direction);
  check(`${label}: direction ${locale === "ar" ? "rtl" : "ltr"}`, dir === (locale === "ar" ? "rtl" : "ltr"), dir);
  check(`${label}: no horizontal page scroll`, await noHorizontalScroll(page));
  check(`${label}: one page heading`, (await page.locator("h1").count()) === 1);
  check(`${label}: no NaN, Infinity or ∞ on screen`, !/NaN|Infinity|∞/.test(await page.locator("main").innerText()));
}

const submit = async (page, form, pattern = /notice=|error=/) => {
  await Promise.all([page.waitForURL((u) => pattern.test(u.search)), form.locator('button[type="submit"]').first().click()]);
  return page.url();
};

async function main() {
  await waitUp(BASE, server);
  const [D] = psql(`select public.business_date_of(now(), timezone, business_day_rollover)::text from public.branches where code = 'maarif'`).split("|");
  const addDays = (date, n) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
  // The HTTP check ended with a minimum of 4 (review). Back to 3 so the plan shows a suggestion.
  psql("update public.replenishment_settings set min_observations = 3, revision = revision + 1");
  const X = psql("select id from public.catalog_items where name_ar = 'E8 مكون'");
  const Z = psql("select id from public.catalog_items where name_ar = 'E8 مكون استلام'");
  const admin = await person("P8 Browser Admin", "system_admin");
  const keeper = await person("P8 Browser Keeper", "storekeeper");
  const manager = await person("P8 Browser Manager", "manager");
  const cashier = await person("P8 Browser Cashier", "cashier");
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });

  for (const [locale, viewport] of [["en", { width: 1280, height: 900 }], ["ar", { width: 375, height: 812 }]]) {
    section(`${locale} at ${viewport.width} px: storekeeper plans and orders`);
    let orderUrl;
    {
      const { context, page } = await signIn(browser, viewport, locale, keeper, `${locale}-keeper`);
      await page.goto(`${BASE}/${locale}/replenishment`);
      await layout(page, locale, "planning");
      const summary = page.locator("[data-summary]");
      check("every item's page recalculation agrees with the database", (await summary.getAttribute("data-mismatches")) === "0");
      const row = page.locator('tr[data-item="E8 مكون"]');
      check("X has a suggestion with every input shown", (await row.getAttribute("data-status")) === "recommend"
        && (await row.locator('td[data-col="forecast"] [data-q]').getAttribute("data-q")) === "20/1"
        && (await row.locator('td[data-col="safety"] [data-q]').getAttribute("data-q")) === "5/1"
        && (await row.locator('td[data-col="usable"] [data-q]').count()) === 1 && (await row.locator('td[data-col="incoming"] [data-q]').count()) === 1);
      check("the dates panel shows the business date and the default receipt two days later",
        (await page.locator('[data-kv="order-date"] time').getAttribute("datetime")) === D
        && (await page.locator('[data-kv="default-expected"] time').getAttribute("datetime")) === addDays(D, 2));
      await page.screenshot({ path: path.join(SHOTS, `${locale}-planning.png`), fullPage: true });

      await page.goto(`${BASE}/${locale}/replenishment/items/${X}`);
      await layout(page, locale, "item plan");
      check("the item page shows the three-month weekday history", (await page.locator("[data-obs-date]").count()) === 91
        && (await page.locator('[data-obs="missing"]').count()) > 0 && (await page.locator('[data-obs="complete"]').count()) >= 7);
      const whatIf = page.locator('form[data-form="what-if"]');
      await whatIf.locator('input[name="expected"]').fill(addDays(D, 3));
      await Promise.all([page.waitForURL((u) => u.search.includes("expected=")), whatIf.locator('button[type="submit"]').click()]);
      check("a changed receipt date shows both plans and the effect", (await page.locator('[data-section="changed"]').count()) === 1
        && (await page.locator('[data-section="effect"]').count()) === 1);
      await page.screenshot({ path: path.join(SHOTS, `${locale}-item.png`), fullPage: true });

      // A manual order of 10 for the receiving item, through the form.
      await page.goto(`${BASE}/${locale}/replenishment/orders/new`);
      await layout(page, locale, "new order");
      const form = page.locator('form[data-form="po-create"]');
      const row0 = form.locator('[data-manual-row="0"]');
      await row0.locator('select[name="item.0"]').selectOption(Z);
      await row0.locator('select[name="source.0"]').selectOption("store");
      await row0.locator('input[name="quantity.0"]').fill(locale === "ar" ? "١٠" : "10");
      const url = await submit(page, form);
      check("the order is created (Arabic digits accepted)", url.includes("notice=po_create"), url);
      orderUrl = url.split("?")[0];
      await layout(page, locale, "order");
      check("the order shows business date, creation time and the original expected date",
        (await page.locator('[data-kv="business-date"] time').getAttribute("datetime")) === D
        && (await page.locator('[data-kv="original-expected"] time').getAttribute("datetime")) === addDays(D, 2)
        && /\d{2}:\d{2}/.test(await page.locator('[data-kv="created"]').innerText()));
      check("the storekeeper has no approval form", (await page.locator('form[data-form="po-approve"]').count()) === 0);
      await context.close();
    }

    section(`${locale} at ${viewport.width} px: administrator approves and moves the date`);
    {
      const { context, page } = await signIn(browser, viewport, locale, admin, `${locale}-admin`);
      await page.goto(orderUrl);
      const url = await submit(page, page.locator('form[data-form="po-approve"]'));
      check("approved", url.includes("notice=po_approve"), url);
      await page.goto(orderUrl);
      const change = page.locator('form[data-form="po-set_expected"]');
      await change.locator('input[name="date"]').fill(addDays(D, 3));
      await change.locator('input[name="reason"]').fill(locale === "ar" ? "المورد أجّل التوريد" : "Supplier moved it");
      const moved = await submit(page, change);
      check("the expected date is changed with a reason", moved.includes("notice=po_set_expected"), moved);
      check("both dates are shown", (await page.locator('[data-kv="original-expected"] time').getAttribute("datetime")) === addDays(D, 2)
        && (await page.locator('[data-kv="expected"] time').getAttribute("datetime")) === addDays(D, 3)
        && (await page.locator('[data-revision="2"][data-kind="override"]').count()) === 1);
      await layout(page, locale, "approved order");
      await page.goto(`${BASE}/${locale}/replenishment/settings`);
      await layout(page, locale, "settings");
      check("the three open questions for Abdo are shown in Arabic", (await page.locator("[data-question] [lang=ar]").count()) === 3);
      await context.close();
    }

    section(`${locale} at ${viewport.width} px: storekeeper receives 4 then 6`);
    {
      const { context, page } = await signIn(browser, viewport, locale, keeper, `${locale}-keeper-receive`);
      await page.goto(orderUrl);
      let form = page.locator('form[data-form="po-receive"]');
      await form.locator('input[name="quantity.0"]').fill("4");
      check("4 received", (await submit(page, form)).includes("notice=po_receive"));
      await page.goto(orderUrl);
      form = page.locator('form[data-form="po-receive"]');
      await form.locator('input[name="quantity.0"]').fill("6");
      check("6 received", (await submit(page, form)).includes("notice=po_receive"));
      await layout(page, locale, "received order");
      const line = page.locator("tr[data-line-no='1']");
      check("received 10, nothing outstanding, the order is closed", (await line.locator('td[data-col="received"] [data-q]').getAttribute("data-q")) === "10/1"
        && (await line.locator('td[data-col="outstanding"] [data-q]').getAttribute("data-q")) === "0/1"
        && (await page.locator('[data-status="closed"]').count()) >= 1 && (await page.locator('form[data-form="po-receive"]').count()) === 0);
      check("two receipts with the actual receipt date", (await page.locator("[data-receipt]").count()) === 2
        && (await page.locator('[data-kv="receipts"] time').first().getAttribute("datetime")) === D);
      await page.screenshot({ path: path.join(SHOTS, `${locale}-order.png`), fullPage: true });
      await page.goto(`${BASE}/${locale}/replenishment/orders`);
      await layout(page, locale, "order list");
      await context.close();
    }

    section(`${locale} at ${viewport.width} px: manager (view only) and cashier (no access)`);
    {
      const { context, page } = await signIn(browser, viewport, locale, manager, `${locale}-manager`);
      await page.goto(`${BASE}/${locale}/replenishment`);
      check("the manager reads the plan but cannot select or create", (await page.locator('input[name="item"][type="checkbox"]').count()) === 0
        && (await page.locator('[data-link="manual-order"]').count()) === 0);
      await page.goto(orderUrl);
      check("the manager's order page has no forms", (await page.locator('form[data-form^="po-"]').count()) === 0);
      const denied = await page.goto(`${BASE}/${locale}/replenishment/orders/new`);
      check("the manager cannot open the new-order page (403)", denied?.status() === 403);
      await context.close();
    }
    {
      const { context, page } = await signIn(browser, viewport, locale, cashier, `${locale}-cashier`);
      for (const target of ["/replenishment", "/replenishment/orders", orderUrl.replace(BASE, "").replace(`/${locale}`, "")]) {
        const response = await page.goto(`${BASE}/${locale}${target}`);
        check(`${target}: the cashier is refused (403)`, response?.status() === 403, String(response?.status()));
      }
      const nav = await page.locator("nav.site-nav").innerText();
      check("the cashier's menu has no replenishment link", !(locale === "en" ? /Replenishment/.test(nav) : /الطلبيات/.test(nav)), nav);
      await context.close();
    }
  }
  await browser.close();
  check("two browser orders, each received as two movements of 4 and 6",
    psql(`select count(*) from public.stock_movements m join public.purchase_order_receipt_lines rl on rl.movement_id = m.id
          join public.purchase_order_receipts r on r.id = rl.receipt_id join public.purchase_orders o on o.id = r.order_id
          where o.created_by_name = 'P8 Browser Keeper'`) === "4");
  check("no browser console errors", consoleProblems.length === 0, consoleProblems.join("\n"));
}

main()
  .catch((error) => {
    state.failures += 1;
    console.error(error);
  })
  .finally(() => {
    server.child.kill();
    console.log(`\n${state.checks} browser checks, ${state.failures} failed. Screenshots: ${SHOTS}`);
    process.exit(state.failures === 0 ? 0 : 1);
  });
