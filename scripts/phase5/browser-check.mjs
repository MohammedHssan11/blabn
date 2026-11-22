// Phase 5 browser checks: the catalog, the review queue, recipes and the consumption check in a real
// browser, in English (LTR) and Arabic (RTL), against the PRODUCTION build and the LOCAL Supabase instance.
//
//   npm run build && npm run test:phase5:browser
//
// Uses Microsoft Edge or Chrome that is already installed (playwright-core). Rebuilds the local database
// first (pass --no-reset to skip, which then needs a fresh database), bootstraps a synthetic System Admin and
// drives the real pages. Screenshots go to SHOT_DIR (default: a folder under the system temp directory).
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createReporter, loadEnv, run, startServer, waitUp } from "../phase3/lib.mjs";

const PORT = process.env.E2E_PORT ?? "3206";
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOT_DIR ?? path.join(os.tmpdir(), "balaban-phase5-shots");
mkdirSync(SHOTS, { recursive: true });
const { check, section, state } = createReporter();
const secret = () => `${randomBytes(9).toString("base64url")}-Aa1`;

if (!process.argv.includes("--no-reset")) {
  console.log("Rebuilding the local database (supabase db reset)...");
  const reset = run("npx", ["supabase", "db", "reset"]);
  if (reset.status !== 0) {
    console.error(`db reset failed\n${reset.stdout}\n${reset.stderr}`);
    process.exit(2);
  }
}
const env = loadEnv();
const server = startServer(PORT, { SITE_URL: BASE });
const consoleProblems = [];

function watch(page, label) {
  page.on("pageerror", (error) => consoleProblems.push(`${label}: pageerror ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|status of 40[13]/.test(text)) return;
    consoleProblems.push(`${label}: ${text}`);
  });
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function signIn(page, locale, email, password) {
  await page.goto(`${BASE}/${locale}/sign-in`);
  await page.fill('form[data-form="sign-in"] input[name="email"]', email);
  await page.fill('form[data-form="sign-in"] input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/sign-in") || u.search.includes("error")),
    page.click('form[data-form="sign-in"] button[type="submit"]'),
  ]);
}

const TEXT = {
  en: { saved: /date was recorded/i, approved: /version was approved/i, mapped: /mapping decision was saved/i, queued: /added to the review queue/i,
        title: "Catalog and recipes", checkSummary: /2 can be consumed, 1 blocked/, unmapped: /No product is approved for this Foodics name/ },
  ar: { saved: /تم تسجيل التاريخ/, approved: /تم اعتماد نسخة الوصفة/, mapped: /تم حفظ قرار الربط/, queued: /تمت إضافة الأسماء/,
        title: "الأصناف والوصفات", checkSummary: /2 يمكن استهلاكها، 1 محجوبة/, unmapped: /لا يوجد منتج معتمد لهذا الاسم من Foodics/ },
};

async function main() {
  await waitUp(BASE, server);
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
  const email = "browser.catalog@example.test";
  const temp = secret();
  const password = secret();
  const boot = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", email, "--name", "Browser Catalog Admin"], { env: { ...env, BOOTSTRAP_ADMIN_PASSWORD: temp } });
  if (boot.status !== 0) throw new Error(`bootstrap failed: ${boot.stderr}`);

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  watch(page, "admin");
  await signIn(page, "en", email, temp);
  await page.fill('form[data-form="change-password"] input[name="password"]', password);
  await page.fill('form[data-form="change-password"] input[name="confirm"]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/account/password")), page.click('form[data-form="change-password"] button[type="submit"]')]);

  const bazabizo = await (async () => {
    await page.goto(`${BASE}/en/catalog/recipes?q=${encodeURIComponent("بظابيظو مانجو كبير")}`);
    const href = await page.locator('table[data-table="recipes"] tr[data-product]').first().locator("a").getAttribute("href");
    return href.split("/").pop();
  })();

  for (const locale of ["en", "ar"]) {
    const t = TEXT[locale];
    const dir = locale === "ar" ? "rtl" : "ltr";
    section(`${locale.toUpperCase()}: ${locale === "ar" ? "Arabic, right-to-left" : "English, left-to-right"}`);
    const pages = ["/catalog", "/catalog/items/new", "/catalog/review", "/catalog/recipes", `/catalog/recipes/${bazabizo}`, `/catalog/consumption?run=1&date=2026-11-05&lines=${encodeURIComponent("اسم غير معروف | 3")}`];
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
      await page.setViewportSize(viewport);
      for (const target of pages) {
        await page.goto(`${BASE}/${locale}${target}`);
        const name = target.split("?")[0].replaceAll("/", "-").replace(/[0-9a-f]{8}-.*$/, "id");
        check(`[${locale} ${viewport.width}px] ${target.split("?")[0].replace(bazabizo, ":id")} has lang, dir ${dir} and lays out ${dir}`,
          (await page.getAttribute("html", "lang")) === locale && (await page.getAttribute("html", "dir")) === dir && (await page.evaluate(() => getComputedStyle(document.body).direction)) === dir);
        check(`[${locale} ${viewport.width}px] ${target.split("?")[0].replace(bazabizo, ":id")} has no horizontal scroll`, await noHorizontalScroll(page));
        if (viewport.width === 375 || target === "/catalog/review") await page.screenshot({ path: path.join(SHOTS, `${locale}-${viewport.width}${name}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    check(`[${locale}] the catalog title and tabs are in ${locale}`, (await page.title()).length > 0);
    await page.goto(`${BASE}/${locale}/catalog`);
    check(`[${locale}] the page heading is «${t.title}»`, (await page.locator("h1").innerText()) === t.title);

    if (locale === "en") {
      // ---- the date question, answered in the browser
      await page.goto(`${BASE}/en/catalog/review`);
      check("[en] the question for Abdo is on the page", /On which day did the November recipe set start/.test(await page.locator('[data-testid="date-question"]').innerText()));
      await page.fill('form[data-form="date-answer"] input[name="date"]', "2026-11-05");
      await page.fill('form[data-form="date-answer"] input[name="evidence"]', "Synthetic browser test");
      await Promise.all([page.waitForURL(/notice=catalog_date_answered/), page.click('form[data-form="date-answer"] button[type="submit"]')]);
      check("[en] the answer is recorded and shown", t.saved.test(await page.locator('[data-result="notice"]').innerText()) && /Answered: 2026-11-05/.test(await page.locator('[data-testid="date-answer"]').innerText()));

      // ---- approve both Bazabizo versions by clicking
      await page.goto(`${BASE}/en/catalog/recipes/${bazabizo}`);
      const nov = page.locator('section[data-version-no="2"]');
      check("[en] the November version shows six spoons from SRC-07 sheet 2 D1015:G1015", /6/.test(await nov.locator('tr[data-line="5"] td').nth(2).innerText()) && /D1015:G1015/.test(await nov.locator('tr[data-line="5"]').innerText()));
      check("[en] the confirmed date is prefilled for the November start", (await nov.locator('input[name="from"]').inputValue()) === "2026-11-05");
      await Promise.all([page.waitForURL(/notice=catalog_recipe_approved/), nov.locator('button[data-action="approve-recipe"]').click()]);
      const oct = page.locator('section[data-version-no="1"]');
      check("[en] the October end date is prefilled with the day before", (await oct.locator('input[name="to"]').inputValue()) === "2026-11-04");
      await oct.locator('input[name="from"]').fill("2026-10-01");
      await Promise.all([page.waitForURL(/notice=catalog_recipe_approved/), oct.locator('button[data-action="approve-recipe"]').click()]);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="version-state"]')].every((e) => e.textContent === "Approved"));
      check("[en] both versions are approved", (await page.locator('[data-testid="version-state"]').allInnerTexts()).every((s) => s === "Approved"));
      await page.screenshot({ path: path.join(SHOTS, "en-bazabizo-approved.png"), fullPage: true });

      // ---- the consumption check: unmapped, then queue, then approve in the review queue
      await page.goto(`${BASE}/en/catalog/consumption`);
      await page.fill('form[data-form="consumption-check"] input[name="date"]', "2026-11-05");
      await page.fill('form[data-form="consumption-check"] textarea[name="lines"]', "بظابيظو مانجو كبير | 3\nكيكة الهبة دبي شيكولاتة كبيرة | 109");
      await Promise.all([page.waitForURL(/run=1/), page.click('form[data-form="consumption-check"] button[type="submit"]')]);
      check("[en] both lines are blocked: the name is unmapped, the cake has no recipe", (await page.locator('[data-line-status="blocked"]').count()) === 2 && (await page.locator('[data-reason="unmapped_name"]').count()) === 1);
      await Promise.all([page.waitForURL(/notice=catalog_names_queued/), page.click('form[data-form="queue-names"] button[type="submit"]')]);
      check("[en] the name was queued", t.queued.test(await page.locator('[data-result="notice"]').innerText()));
      await page.goto(`${BASE}/en/catalog/review?kind=unmapped_name`);
      const entry = page.locator('article[data-subject="بظابيظو مانجو كبير"]');
      await entry.locator('select[name="item"]').selectOption(bazabizo);
      await entry.locator('input[name="basis"]').fill("Synthetic browser test");
      await Promise.all([page.waitForURL(/notice=catalog_mapping_saved/), entry.locator('button[value="approve"]').click()]);
      check("[en] the mapping is approved from the queue", t.mapped.test(await page.locator('[data-result="notice"]').innerText()));
      await page.goto(`${BASE}/en/catalog/consumption`);
      await page.fill('form[data-form="consumption-check"] input[name="date"]', "2026-11-05");
      await page.fill('form[data-form="consumption-check"] textarea[name="lines"]', "بظابيظو مانجو كبير | 3\nبظابيظو مانجو كبير | 2\nاسم غير معروف | 1");
      await Promise.all([page.waitForURL(/run=1/), page.click('form[data-form="consumption-check"] button[type="submit"]')]);
      check("[en] two lines can be consumed, one is blocked", t.checkSummary.test(await page.locator("h2").filter({ hasText: /can be consumed/ }).innerText()));
      check("[en] the six spoons per piece give 30 for five pieces", (await page.locator('tr[data-total-item="ملاعق بلاستيك للارز - مستورد"] [data-qty]').getAttribute("data-qty")) === "30/1");
      await page.screenshot({ path: path.join(SHOTS, "en-consumption.png"), fullPage: true });
    } else {
      // ---- the same screens in Arabic with the state the English run created
      await page.goto(`${BASE}/ar/catalog/recipes/${bazabizo}`);
      check("[ar] both versions show «معتمدة» with their ranges", (await page.locator('[data-testid="version-state"]').allInnerTexts()).every((s) => s === "معتمدة") && /2026-10-01 إلى 2026-11-04/.test(await page.locator("body").innerText()));
      await page.goto(`${BASE}/ar/catalog/consumption`);
      await page.fill('form[data-form="consumption-check"] input[name="date"]', "2026-11-05");
      await page.fill('form[data-form="consumption-check"] textarea[name="lines"]', "بظابيظو مانجو كبير | 3\nكيكة الهبة دبي صوص كيندر كبير | 2\nبظابيظو مانجو كبير | 2");
      await Promise.all([page.waitForURL(/run=1/), page.click('form[data-form="consumption-check"] button[type="submit"]')]);
      check("[ar] the summary and the reasons are in Arabic", t.checkSummary.test(await page.locator("h2").filter({ hasText: /يمكن استهلاكها/ }).innerText()) && /ينتظر الاعتماد/.test(await page.locator("body").innerText()));
      check("[ar] quantities keep Western digits and read left-to-right inside the right-to-left page", (await page.locator('tr[data-total-item="ملاعق بلاستيك للارز - مستورد"] [data-qty]').evaluate((el) => getComputedStyle(el).direction)) === "ltr");
      await page.screenshot({ path: path.join(SHOTS, "ar-consumption.png"), fullPage: true });
      await page.goto(`${BASE}/ar/catalog/review`);
      check("[ar] the question for Abdo reads «نسخة وصفات نوفمبر بدأ العمل بيها من يوم كام؟»", (await page.locator('[data-section="date-question"]').first().innerText()).includes("نسخة وصفات نوفمبر بدأ العمل بيها من يوم كام؟"));
      // language switch keeps the page
      await page.goto(`${BASE}/ar/catalog/review?kind=unit_conflict`);
      await Promise.all([page.waitForURL("**/en/catalog/review**"), page.click('a[data-switch-to="en"]')]);
      check("[ar→en] the language switch keeps the page and the filter", new URL(page.url()).search.includes("kind=unit_conflict"));
    }
    // keyboard: the first tab stop is the skip link and the filter form is reachable without a mouse
    await page.goto(`${BASE}/${locale}/catalog`);
    await page.keyboard.press("Tab");
    check(`[${locale}] the first tab stop is the skip link`, await page.evaluate(() => document.activeElement?.classList.contains("skip-link")));
  }
  check("no browser console errors on any page", consoleProblems.length === 0, consoleProblems.slice(0, 3).join(" | "));
  await browser.close();
}

let failure = null;
try {
  await main();
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  server.child.kill();
}
console.log(`\n${state.checks - state.failures}/${state.checks} checks passed. Screenshots: ${SHOTS}`);
if (state.failures || failure) {
  console.log(`Failed: ${state.names.join("; ")}`);
  process.exit(1);
}
