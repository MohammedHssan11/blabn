// Phase 6 browser checks: the stock day, Product Mix and item history in a real browser, English (LTR)
// desktop and Arabic (RTL) at 375 px, against the PRODUCTION build and the LOCAL Supabase instance.
//
//   npm run build && npm run test:phase6:browser
//
// Runs the HTTP check first (scripts/phase6/e2e.mjs, which rebuilds the database and leaves its synthetic
// stock data), then signs in a new synthetic storekeeper in Edge and uses the real forms.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { container } from "../phase3/db-check.mjs";
import { createReporter, loadEnv, run, serviceClient, startServer, waitUp } from "../phase3/lib.mjs";

const PORT = process.env.E2E_PORT ?? "3207";
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOT_DIR ?? path.join(os.tmpdir(), "balaban-phase6-shots");
mkdirSync(SHOTS, { recursive: true });
const { check, section, state } = createReporter();
const DAY = "2026-11-20";

if (!process.argv.includes("--no-setup")) {
  console.log("Preparing synthetic stock data (scripts/phase6/e2e.mjs)...");
  const setup = run("node", ["scripts/phase6/e2e.mjs"]);
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

async function main() {
  await waitUp(BASE, server);
  const email = `browser.keeper.${randomBytes(4).toString("hex")}@example.test`;
  const password = `${randomBytes(9).toString("base64url")}-Aa1`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error("could not create the storekeeper");
  const id = created.data.user.id;
  psql(`begin;
    insert into public.employees(id, organization_id, full_name) select '${id}', organization_id, 'Browser Keeper' from public.branches where code = 'maarif';
    insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, '${email}' from public.employees where id = '${id}';
    insert into public.branch_memberships(staff_id, branch_id) select '${id}', id from public.branches where code = 'maarif';
    insert into public.staff_group_assignments(staff_id, branch_id, group_key) select '${id}', id, 'storekeeper' from public.branches where code = 'maarif';
    commit;`);
  const box = psql("select id from public.catalog_items where name_ar = 'E6 علبة'");
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });

  for (const [locale, viewport] of [["en", { width: 1280, height: 900 }], ["ar", { width: 375, height: 812 }]]) {
    section(`${locale} at ${viewport.width} px`);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    watch(page, locale);
    await page.goto(`${BASE}/${locale}/sign-in`);
    await page.fill('form[data-form="sign-in"] input[name="email"]', email);
    await page.fill('form[data-form="sign-in"] input[name="password"]', password);
    await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/sign-in")), page.click('form[data-form="sign-in"] button[type="submit"]')]);

    for (const target of [`/inventory?date=${DAY}`, `/inventory/product-mix?date=${DAY}`]) {
      await page.goto(`${BASE}/${locale}${target}`);
      const dir = await page.evaluate(() => getComputedStyle(document.documentElement).direction);
      check(`${target}: direction ${locale === "ar" ? "rtl" : "ltr"}`, dir === (locale === "ar" ? "rtl" : "ltr"), dir);
      check(`${target}: no horizontal page scroll`, await noHorizontalScroll(page));
      check(`${target}: one page heading`, (await page.locator("h1").count()) === 1, String(await page.locator("h1").count()));
      await page.screenshot({ path: path.join(SHOTS, `${locale}-${target.split("?")[0].replaceAll("/", "_")}.png`), fullPage: true });
    }

    // The variance of the synthetic count from the HTTP check, as the person sees it.
    await page.goto(`${BASE}/${locale}/inventory?date=${DAY}`);
    const variance = await page.locator('tr[data-item="E6 مكون عد"] td[data-col="variance"]').innerText();
    check("X shows variance −1", variance.replace(/\s/g, "").includes("−1"), variance);
    const mixStatus = await page.goto(`${BASE}/${locale}/inventory/product-mix?date=${DAY}`).then(() =>
      page.locator('tr[data-mix-line="كيكة الهبة دبي شيكولاتة كبيرة"]').getAttribute("data-line-status"));
    check("the real Dubai cake line is still blocked", mixStatus === "blocked", String(mixStatus));

    if (locale === "en") {
      // Count the packaging item through the real form; an explicit zero is a count.
      await page.goto(`${BASE}/en/inventory?date=${DAY}`);
      const form = page.locator('form[data-form="count"]');
      await form.locator('select[name="item"]').selectOption(box);
      await form.locator('input[name="quantity"]').fill("0");
      await form.locator('input[name="local"]').fill(`${DAY}T23:55`);
      await Promise.all([page.waitForURL((u) => u.search.includes("notice=") || u.search.includes("error=")), form.locator('button[type="submit"]').click()]);
      check("the count form saves", page.url().includes("notice=stock_saved"), page.url());
      const row = page.locator('tr[data-item="E6 علبة"]');
      check("the packaging row is counted with an explicit zero", (await row.getAttribute("data-status")) === "counted"
        && (await row.locator('td[data-col="count"]').innerText()).trim() === "0", await row.innerText());
    } else {
      await page.goto(`${BASE}/ar/inventory?date=${DAY}`);
      check("Arabic labels are shown", (await page.locator("h1").innerText()).includes("المخزون"));
      const history = await page.goto(`${BASE}/ar/inventory/items/${psql("select id from public.catalog_items where name_ar = 'E6 مكون عد'")}?date=${DAY}`);
      check("the Arabic item history opens and fits the phone width", history?.status() === 200 && (await noHorizontalScroll(page)));
    }
    await context.close();
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
