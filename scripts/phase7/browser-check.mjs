// Phase 7 browser checks: the branch comparison, figure entry and history in a real browser, English (LTR)
// desktop and Arabic (RTL) at 375 px, against the PRODUCTION build and the LOCAL Supabase instance.
//
//   npm run build && npm run test:phase7:browser
//
// Runs the HTTP check first (scripts/phase7/e2e.mjs, which rebuilds the database and leaves its synthetic
// closed days, figures and test-only groups), then signs in new synthetic people in Edge: a viewer, a
// Bourgogne comparison editor, and a cashier without comparison access.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { container } from "../phase3/db-check.mjs";
import { createReporter, loadEnv, run, serviceClient, startServer, waitUp } from "../phase3/lib.mjs";

const PORT = process.env.E2E_PORT ?? "3208";
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOT_DIR ?? path.join(os.tmpdir(), "balaban-phase7-shots");
mkdirSync(SHOTS, { recursive: true });
const { check, section, state } = createReporter();
const CUR = "2026-11-17";

if (!process.argv.includes("--no-setup")) {
  console.log("Preparing synthetic comparison data (scripts/phase7/e2e.mjs)...");
  const setup = run("node", ["scripts/phase7/e2e.mjs"]);
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
    if (message.type() === "error" && !/Failed to load resource|status of 40[13]/.test(message.text())) consoleProblems.push(`${label}: ${message.text()}`);
  });
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function person(name, assignments) {
  const email = `p7.browser.${randomBytes(4).toString("hex")}@example.test`;
  const password = `${randomBytes(9).toString("base64url")}-Aa1`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`could not create ${name}`);
  const id = created.data.user.id;
  psql(`begin;
    insert into public.employees(id, organization_id, full_name) select '${id}', organization_id, '${name}' from public.branches where code = 'maarif';
    insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, '${email}' from public.employees where id = '${id}';
    ${assignments.map(([branch, group]) => `insert into public.branch_memberships(staff_id, branch_id) select '${id}', id from public.branches where code = '${branch}' on conflict do nothing;
    insert into public.staff_group_assignments(staff_id, branch_id, group_key) select '${id}', id, '${group}' from public.branches where code = '${branch}';`).join("\n")}
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
  check(`${label}: no NaN, Infinity or ∞ on screen`, !/NaN|Infinity|∞/.test(await page.locator("main, body").first().innerText()));
}

async function main() {
  await waitUp(BASE, server);
  const viewer = await person("P7 Browser Viewer", ["alquds", "maarif", "bourgogne"].map((b) => [b, "pseven_viewer"]));
  const editor = await person("P7 Browser Editor", [["bourgogne", "comparison_editor"]]);
  const cashier = await person("P7 Browser Cashier", [["maarif", "cashier"]]);
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });

  for (const [locale, viewport, entryDate, sales] of [["en", { width: 1280, height: 900 }, "2026-11-14", "61.50"], ["ar", { width: 375, height: 812 }, "2026-11-13", "٤٢"]]) {
    section(`${locale} at ${viewport.width} px: viewer`);
    {
      const { context, page } = await signIn(browser, viewport, locale, viewer, `${locale}-viewer`);
      await page.goto(`${BASE}/${locale}/comparison?current=${CUR}`);
      await layout(page, locale, "weekly comparison");
      const rows = await page.locator('table[data-table="weekly-comparison"] tbody tr').evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-branch")));
      check("rows are Al Quds, Maarif, Bourgogne, and the total follows", JSON.stringify(rows) === JSON.stringify(["alquds", "maarif", "bourgogne"])
        && (await page.locator('table[data-table="weekly-comparison"] tfoot tr[data-row="total"]').count()) === 1, JSON.stringify(rows));
      const coverageTop = (await page.locator('[data-section="coverage"]').boundingBox())?.y ?? Infinity;
      const tableTop = (await page.locator('table[data-table="weekly-comparison"]').boundingBox())?.y ?? -1;
      check("the coverage is on screen above the table and its percentages", coverageTop < tableTop, `${coverageTop} vs ${tableTop}`);
      const maarifRatio = (await page.locator('tr[data-branch="maarif"] td[data-col="ratio"]').innerText()).replace(/\s|‎|‏/g, "");
      check("Maarif 120 vs 100 reads 120 %", /^120[%٪]$/.test(maarifRatio), maarifRatio);
      const alqudsRatio = await page.locator('tr[data-branch="alquds"] td[data-col="ratio"]').innerText();
      check("Al Quds without a current figure reads an understandable unavailable percentage",
        locale === "en" ? /Unavailable/.test(alqudsRatio) && /no current figure/.test(alqudsRatio) : /غير متاحة/.test(alqudsRatio), alqudsRatio);
      const bourgogneRatio = await page.locator('tr[data-branch="bourgogne"] td[data-col="ratio"]').innerText();
      check("Bourgogne's zero prior reads unavailable, not 0 %", !/0\s*[%٪]/.test(bourgogneRatio.replace(/[‎‏]/g, "")) && (locale === "en" ? /prior figure is 0/.test(bourgogneRatio) : /صفر/.test(bourgogneRatio)), bourgogneRatio);
      check("the total says it is incomplete", (await page.locator('tr[data-row="total"]').getAttribute("data-incomplete")) === "true"
        && (await page.locator("[data-total-note]").innerText()).length > 10);
      await page.screenshot({ path: path.join(SHOTS, `${locale}-weekly.png`), fullPage: true });

      // Change the selection through the form: Maarif and Bourgogne only.
      await page.locator('form[data-form="comparison-query"] input[name="branches"][value="alquds"]').uncheck();
      await Promise.all([page.waitForURL((u) => u.search.includes("branches=")), page.locator('form[data-form="comparison-query"] button[type="submit"]').click()]);
      check("the selection form leaves Al Quds out and the total is complete", (await page.locator('tr[data-branch="alquds"]').count()) === 0
        && (await page.locator('tr[data-row="total"]').getAttribute("data-incomplete")) === "false");

      await page.goto(`${BASE}/${locale}/comparison?mode=monthly&month=2026-11&branches=maarif`);
      await layout(page, locale, "monthly comparison");
      const growth = (await page.locator('tr[data-day="17"] td[data-col="growth"]').innerText()).replace(/\s|‎|‏/g, "");
      check("monthly: 17 November against 17 October is +20 % growth", /^20[%٪]$/.test(growth), growth);
      await page.screenshot({ path: path.join(SHOTS, `${locale}-monthly.png`), fullPage: true });

      await page.goto(`${BASE}/${locale}/comparison/history?branch=alquds&date=2026-11-10`);
      await layout(page, locale, "history");
      check("the history shows the retired first revision and the active second one",
        (await page.locator('tr[data-revision="1"][data-active="false"]').count()) === 1 && (await page.locator('tr[data-revision="2"][data-active="true"]').count()) === 1);
      await context.close();
    }

    section(`${locale} at ${viewport.width} px: Bourgogne editor`);
    {
      const { context, page } = await signIn(browser, viewport, locale, editor, `${locale}-editor`);
      await page.goto(`${BASE}/${locale}/comparison/entry`);
      await layout(page, locale, "entry");
      const form = page.locator('form[data-form="entry-bourgogne"]');
      check("only the Bourgogne form is offered", (await form.count()) === 1 && (await page.locator('form[data-form="entry-alquds"]').count()) === 0);
      await form.locator('input[name="date"]').fill(entryDate);
      await form.locator('input[name="sales"]').fill(sales);
      await form.locator('input[name="orders"]').fill("4");
      await Promise.all([page.waitForURL((u) => u.search.includes("notice=") || u.search.includes("error=")), form.locator('button[type="submit"]').click()]);
      check("the figure is saved through the form", page.url().includes("notice=comparison_saved"), page.url());
      const value = psql(`select value from public.comparison_entries e join public.branches b on b.id = e.branch_id where b.code = 'bourgogne' and business_date = '${entryDate}' and metric = 'net_sales' and active`);
      check("the saved sales are exact (centimes)", value === (locale === "en" ? "6150" : "4200"), value);
      const notice = await page.locator('[data-result="notice"]').innerText();
      check("the confirmation is in the page's language", locale === "en" ? /Figures saved/.test(notice) : /تم حفظ الأرقام/.test(notice), notice);
      const denied = await page.goto(`${BASE}/${locale}/comparison?branches=bourgogne`);
      check("the editor cannot open the comparison, even for their branch (403)", denied?.status() === 403);
      await context.close();
    }

    section(`${locale} at ${viewport.width} px: cashier without comparison access`);
    {
      const { context, page } = await signIn(browser, viewport, locale, cashier, `${locale}-cashier`);
      for (const target of ["/comparison", "/comparison?branches=alquds", "/comparison/entry", "/comparison/history?branch=bourgogne&date=2026-11-17"]) {
        const response = await page.goto(`${BASE}/${locale}${target}`);
        const text = await page.locator("body").innerText();
        check(`${target}: refused (403) and shows no Al Quds or Bourgogne figure`, response?.status() === 403 && !/150\.00|80\.00|96\.00/.test(text), String(response?.status()));
      }
      const nav = await page.locator("nav.site-nav").innerText();
      check("the cashier's menu has no comparison link", !(locale === "en" ? /comparison/i.test(nav) : /مقارنة/.test(nav)), nav);
      await context.close();
    }
  }
  await browser.close();
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
