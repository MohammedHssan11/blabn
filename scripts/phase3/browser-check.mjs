// Phase 3 browser checks: sign-in, password recovery and staff management in a real browser, in
// English (LTR) and Arabic (RTL), against the PRODUCTION build and the LOCAL Supabase instance.
//
//   npm run build && npm run test:browser
//
// Uses Microsoft Edge or Chrome that is already installed (playwright-core, no browser download).
// It rebuilds the local database first (pass --no-reset to skip), creates a synthetic System Admin
// with the bootstrap command, and drives the real pages. Screenshots go to SHOT_DIR (default: a
// folder under the system temp directory). Passwords are random per run and never printed.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createReporter, loadEnv, mailFor, run, serviceClient, startServer, waitUp } from "./lib.mjs";

const PORT = process.env.E2E_PORT ?? "3199";
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOT_DIR ?? path.join(os.tmpdir(), "balaban-phase3-shots");
mkdirSync(SHOTS, { recursive: true });
const { check, section, state } = createReporter();
const secret = () => `${randomBytes(9).toString("base64url")}-Aa1`;
const passwords = [];

if (!process.argv.includes("--no-reset")) {
  console.log("Rebuilding the local database (supabase db reset)...");
  const reset = run("npx", ["supabase", "db", "reset"]);
  if (reset.status !== 0) {
    console.error(`db reset failed\n${reset.stdout}\n${reset.stderr}`);
    process.exit(2);
  }
}
const env = loadEnv();
const service = serviceClient(env);
const server = startServer(PORT, { SITE_URL: BASE });

const TEXT = {
  en: {
    created: /The account was created/,
    accessSaved: /The access was saved/,
    updated: /The details were saved/,
    disabled: /The account is disabled/,
    reactivated: /The account is active again/,
    signedOut: /You are signed out/,
    forbidden: /You do not have permission to open this page/,
    recoverySent: /If that email belongs to an account/,
    passwordChanged: /Your password was changed/,
    staffTitle: "Staff accounts",
    auditTitle: "Audit history",
  },
  ar: {
    created: /تم إنشاء الحساب/,
    accessSaved: /تم حفظ الصلاحيات/,
    updated: /تم حفظ البيانات/,
    disabled: /تم تعطيل الحساب/,
    reactivated: /أُعيد تفعيل الحساب/,
    signedOut: /تم تسجيل خروجك/,
    forbidden: /ليست لديك صلاحية لفتح هذه الصفحة/,
    recoverySent: /إذا كان هذا البريد مرتبطًا بحساب/,
    passwordChanged: /تم تغيير كلمة المرور/,
    staffTitle: "حسابات الموظفين",
    auditTitle: "سجل التدقيق",
  },
};

const consoleProblems = [];
function watch(page, label) {
  page.on("pageerror", (error) => consoleProblems.push(`${label}: pageerror ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // The browser logs every refused request (401/403); those are expected in the denial checks.
    if (/Failed to load resource|status of 40[13]/.test(text)) return;
    consoleProblems.push(`${label}: ${text}`);
  });
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function signIn(page, locale, email, password) {
  await page.goto(`${BASE}/${locale}/sign-in`);
  await page.fill('form[data-form="sign-in"] input[name="email"]', email);
  await page.fill('form[data-form="sign-in"] input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/sign-in") || u.search.includes("error")),
    page.click('form[data-form="sign-in"] button[type="submit"]'),
  ]);
}

async function choosePassword(page, locale, password) {
  await page.waitForURL((u) => u.pathname === `/${locale}/account/password`);
  await page.fill('form[data-form="change-password"] input[name="password"]', password);
  await page.fill('form[data-form="change-password"] input[name="confirm"]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/account/password")), page.click('form[data-form="change-password"] button[type="submit"]')]);
}

const staffIds = {};

async function main() {
  await waitUp(BASE, server);
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
  const adminEmail = "browser.admin@example.test";
  const adminTemp = secret();
  const adminPassword = secret();
  passwords.push(adminTemp, adminPassword);
  const boot = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", adminEmail, "--name", "Browser Admin"], { env: { ...env, BOOTSTRAP_ADMIN_PASSWORD: adminTemp } });
  if (boot.status !== 0) throw new Error(`bootstrap failed: ${boot.stderr}`);

  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  watch(admin, "admin");

  for (const locale of ["en", "ar"]) {
    const t = TEXT[locale];
    const dir = locale === "ar" ? "rtl" : "ltr";
    const other = locale === "ar" ? "en" : "ar";
    section(`${locale.toUpperCase()}: ${locale === "ar" ? "Arabic, right-to-left" : "English, left-to-right"}`);

    // ---------------------------------------------------------------- anonymous
    const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const visitor = await visitorContext.newPage();
    watch(visitor, `visitor-${locale}`);
    await visitor.goto(`${BASE}/${locale}/admin/staff`);
    check(`[${locale}] a protected page sends a visitor to sign-in and remembers the page`, new URL(visitor.url()).pathname === `/${locale}/sign-in` && new URL(visitor.url()).searchParams.get("next") === `/${locale}/admin/staff`, visitor.url());
    check(`[${locale}] <html> has lang="${locale}" and dir="${dir}"`, (await visitor.getAttribute("html", "lang")) === locale && (await visitor.getAttribute("html", "dir")) === dir);
    check(`[${locale}] the page really lays out ${dir} (computed direction)`, (await visitor.evaluate(() => getComputedStyle(document.body).direction)) === dir);
    await visitor.screenshot({ path: path.join(SHOTS, `${locale}-sign-in.png`) });

    // a wrong password
    await visitor.fill('form[data-form="sign-in"] input[name="email"]', adminEmail);
    await visitor.fill('form[data-form="sign-in"] input[name="password"]', "definitely-wrong-password");
    await Promise.all([visitor.waitForURL((u) => u.search.includes("error=invalid")), visitor.click('form[data-form="sign-in"] button[type="submit"]')]);
    check(`[${locale}] wrong password shows an error in ${locale}`, await visitor.locator('[data-result="error"]').isVisible() && (locale === "ar" ? /غير صحيحة/ : /not correct/).test(await visitor.locator('[data-result="error"]').innerText()));
    await visitor.screenshot({ path: path.join(SHOTS, `${locale}-sign-in-error.png`) });

    // language switch keeps the page
    await visitor.click(`a[data-switch-to="${other}"]`);
    await visitor.waitForURL(`**/${other}/sign-in**`);
    check(`[${locale}] the language switch keeps the page (${other})`, (await visitor.getAttribute("html", "lang")) === other);
    await visitor.goto(`${BASE}/${locale}/sign-in`);

    // ---------------------------------------------------------------- phone layout
    await visitor.setViewportSize({ width: 375, height: 812 });
    check(`[${locale}] sign-in has no horizontal scroll at 375 px`, await noHorizontalScroll(visitor));
    await visitor.screenshot({ path: path.join(SHOTS, `${locale}-sign-in-375.png`) });
    await visitor.setViewportSize({ width: 1280, height: 900 });

    // ---------------------------------------------------------------- administrator signs in
    if (locale === "en") {
      await signIn(admin, locale, adminEmail, adminTemp);
      check("[en] the temporary password leads to the password change", new URL(admin.url()).pathname === "/en/account/password", admin.url());
      check("[en] the page explains why", await admin.getByText(/set by an administrator/).isVisible());
      await choosePassword(admin, locale, adminPassword);
      check("[en] after choosing a password the home page shows the welcome and the notice", (await admin.getByText(/Welcome, Browser Admin/).isVisible()) && (await admin.getByText(t.passwordChanged).isVisible()));
    } else {
      await admin.goto(`${BASE}/ar`);
      check("[ar] the administrator's session is still open and the home page is Arabic", (await admin.getAttribute("html", "dir")) === "rtl" && (await admin.getByText(/أهلًا Browser Admin/).isVisible()));
    }
    check(`[${locale}] the menu shows the administrator's entries`, (await admin.locator('nav a[href$="/admin/staff"]').count()) === 1 && (await admin.locator('nav a[href$="/admin/audit"]').count()) === 1);

    // ---------------------------------------------------------------- create staff
    await admin.goto(`${BASE}/${locale}/admin/staff/new`);
    const name = locale === "ar" ? "أمين الصندوق التجريبي" : "Synthetic Cashier";
    const email = `cashier.${locale}@example.test`;
    const temp = secret();
    const ownPassword = secret();
    passwords.push(temp, ownPassword);
    const form = 'form[data-form="create-staff"]';
    await admin.fill(`${form} input[name="full_name"]`, name);
    await admin.fill(`${form} input[name="email"]`, email);
    await admin.fill(`${form} input[name="employee_number"]`, `E-${locale}`);
    await admin.fill(`${form} input[name="password"]`, temp);
    await admin.check(`${form} input[name="group"][value="maarif:cashier"]`);
    await admin.check(`${form} input[name="group"][value="maarif:storekeeper"]`);
    await admin.check(`${form} input[name="group"][value="alquds:comparison_editor"]`);
    await admin.screenshot({ path: path.join(SHOTS, `${locale}-staff-new.png`), fullPage: true });
    check(`[${locale}] the create form is right-to-left only in Arabic`, (await admin.evaluate(() => getComputedStyle(document.querySelector('form[data-form="create-staff"]')).direction)) === dir);
    await Promise.all([admin.waitForURL(/\/admin\/staff\/[0-9a-f-]{36}/), admin.click(`${form} button[type="submit"]`)]);
    const id = /\/admin\/staff\/([0-9a-f-]{36})/.exec(admin.url())[1];
    staffIds[locale] = id;
    check(`[${locale}] the account is created and its page shows the confirmation`, await admin.getByText(t.created).isVisible());
    check(`[${locale}] three groups are checked on the new account (several groups, two branches)`, (await admin.locator('form[data-form="set-access"] input[name="group"]:checked').count()) === 3);
    await admin.screenshot({ path: path.join(SHOTS, `${locale}-staff-detail.png`), fullPage: true });

    // ---------------------------------------------------------------- change details and access
    await admin.fill('form[data-form="update-staff"] input[name="full_name"]', `${name} 2`);
    await Promise.all([admin.waitForURL((u) => u.search.includes("notice=updated")), admin.click('form[data-form="update-staff"] button[type="submit"]')]);
    check(`[${locale}] details are changed (name)`, (await admin.getByText(t.updated).isVisible()) && (await admin.locator("h1").innerText()) === `${name} 2`);

    const access = 'form[data-form="set-access"]';
    await admin.uncheck(`${access} input[name="group"][value="maarif:storekeeper"]`);
    await admin.check(`${access} input[name="group"][value="maarif:manager"]`);
    await Promise.all([admin.waitForURL((u) => u.search.includes("notice=access_saved")), admin.click(`${access} button[type="submit"]`)]);
    check(`[${locale}] groups are changed and confirmed`, await admin.getByText(t.accessSaved).isVisible());
    const checked = await admin.locator(`${access} input[name="group"]:checked`).evaluateAll((els) => els.map((e) => e.value).sort());
    check(`[${locale}] the saved groups are cashier + manager at Maarif and comparison editor at Al Quds`, JSON.stringify(checked) === JSON.stringify(["alquds:comparison_editor", "maarif:cashier", "maarif:manager"]), JSON.stringify(checked));

    // ---------------------------------------------------------------- disable and reactivate
    await admin.fill('form[data-form="disable-staff"] input[name="reason"]', locale === "ar" ? "اختبار" : "test");
    await Promise.all([admin.waitForURL((u) => u.search.includes("notice=disabled")), admin.click('form[data-form="disable-staff"] button[type="submit"]')]);
    check(`[${locale}] the account is disabled`, (await admin.getByText(t.disabled).first().isVisible()) && (await admin.locator('[data-status="disabled"]').isVisible()));
    await admin.screenshot({ path: path.join(SHOTS, `${locale}-staff-disabled.png`), fullPage: true });
    await Promise.all([admin.waitForURL((u) => u.search.includes("notice=reactivated")), admin.click('form[data-form="reactivate-staff"] button[type="submit"]')]);
    check(`[${locale}] the account is reactivated`, (await admin.getByText(t.reactivated).isVisible()) && (await admin.locator('[data-status="active"]').isVisible()));

    // ---------------------------------------------------------------- the staff list and audit history
    await admin.goto(`${BASE}/${locale}/admin/staff`);
    check(`[${locale}] the list shows the new person with their groups`, await admin.locator(`tr[data-staff="${email}"]`).isVisible());
    await admin.screenshot({ path: path.join(SHOTS, `${locale}-staff-list.png`), fullPage: true });
    await admin.goto(`${BASE}/${locale}/admin/audit`);
    const actions = await admin.locator("tr[data-audit-action]").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-audit-action")));
    for (const action of ["staff.created", "staff.updated", "staff.access_changed", "staff.disabled", "staff.reactivated"]) {
      check(`[${locale}] the audit history shows ${action}`, actions.includes(action));
    }
    await admin.locator("tr[data-audit-action='staff.access_changed'] summary").first().click();
    check(`[${locale}] an audit entry opens to show what changed (groups added and removed)`, /groups_added/.test(await admin.locator("tr[data-audit-action='staff.access_changed'] pre").first().innerText()));
    await admin.screenshot({ path: path.join(SHOTS, `${locale}-audit.png`), fullPage: true });
    check(`[${locale}] the audit page is titled in ${locale}`, (await admin.locator("h1").innerText()) === t.auditTitle);

    // phone layout of the administrator screens
    await admin.setViewportSize({ width: 375, height: 812 });
    for (const page of ["/admin/staff", `/admin/staff/${id}`, "/admin/staff/new", "/admin/audit"]) {
      await admin.goto(`${BASE}/${locale}${page}`);
      check(`[${locale}] ${page.replace(id, ":id")} has no horizontal scroll at 375 px`, await noHorizontalScroll(admin));
    }
    await admin.screenshot({ path: path.join(SHOTS, `${locale}-audit-375.png`) });
    await admin.setViewportSize({ width: 1280, height: 900 });

    // ---------------------------------------------------------------- the new staff member signs in
    const staffContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const staff = await staffContext.newPage();
    watch(staff, `staff-${locale}`);
    await signIn(staff, locale, email, temp);
    check(`[${locale}] the staff member is sent to choose their own password`, new URL(staff.url()).pathname === `/${locale}/account/password`);
    await staff.screenshot({ path: path.join(SHOTS, `${locale}-password-change.png`) });
    await choosePassword(staff, locale, ownPassword);
    check(`[${locale}] they reach the home page, which lists only their work`, (await staff.locator('nav a[href$="/daily-close"]').count()) === 1 && (await staff.locator('nav a[href$="/admin/staff"]').count()) === 0);
    await staff.goto(`${BASE}/${locale}/daily-close`);
    check(`[${locale}] the cashier opens the daily close`, (await staff.locator("h1").count()) > 0 && !(await staff.locator('[data-page="forbidden"]').count()));

    // ---------------------------------------------------------------- an open session loses a permission
    await admin.goto(`${BASE}/${locale}/admin/staff/${id}`);
    await admin.uncheck(`${access} input[name="group"][value="maarif:cashier"]`);
    await admin.uncheck(`${access} input[name="group"][value="maarif:manager"]`);
    await Promise.all([admin.waitForURL((u) => u.search.includes("notice=access_saved")), admin.click(`${access} button[type="submit"]`)]);
    const response = await staff.goto(`${BASE}/${locale}/daily-close`);
    check(`[${locale}] the open session is refused the very next page request (HTTP 403)`, response.status() === 403, String(response.status()));
    await staff.waitForSelector('[data-page="forbidden"]', { timeout: 10000 }).catch(() => null);
    check(`[${locale}] the browser shows the "access denied" message in ${locale}`, await staff.getByText(t.forbidden).isVisible());
    check(`[${locale}] and the page direction is ${dir}`, (await staff.getAttribute("html", "dir")) === dir);
    await staff.screenshot({ path: path.join(SHOTS, `${locale}-forbidden.png`) });
    const other403 = await staff.goto(`${BASE}/${locale}/daily-close?branch=alquds`);
    check(`[${locale}] another branch is refused too (403)`, other403.status() === 403);

    // restore, then disable while signed in
    await admin.goto(`${BASE}/${locale}/admin/staff/${id}`);
    await admin.check(`${access} input[name="group"][value="maarif:cashier"]`);
    await Promise.all([admin.waitForURL((u) => u.search.includes("notice=access_saved")), admin.click(`${access} button[type="submit"]`)]);
    const back = await staff.goto(`${BASE}/${locale}/daily-close`);
    check(`[${locale}] restoring the group restores access on the next request`, back.status() === 200);
    await Promise.all([admin.waitForURL((u) => u.search.includes("notice=disabled")), (async () => {
      await admin.fill('form[data-form="disable-staff"] input[name="reason"]', "x");
      await admin.click('form[data-form="disable-staff"] button[type="submit"]');
    })()]);
    await staff.goto(`${BASE}/${locale}/daily-close`);
    check(`[${locale}] after the account is disabled the open session is sent to sign in`, new URL(staff.url()).pathname === `/${locale}/sign-in`, staff.url());
    await admin.click('form[data-form="reactivate-staff"] button[type="submit"]');
    await admin.waitForURL((u) => u.search.includes("notice=reactivated"));
    await staffContext.close();

    // ---------------------------------------------------------------- password recovery (real email, local mail catcher)
    const recoveryContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const recovery = await recoveryContext.newPage();
    watch(recovery, `recovery-${locale}`);
    await recovery.goto(`${BASE}/${locale}/sign-in`);
    await recovery.click(`a[href="/${locale}/forgot-password"]`);
    await recovery.waitForURL(`**/${locale}/forgot-password`);
    const startedAt = Date.now() - 1000;
    await recovery.fill('form[data-form="forgot-password"] input[name="email"]', email);
    await Promise.all([recovery.waitForURL((u) => u.search.includes("sent=1")), recovery.click('form[data-form="forgot-password"] button[type="submit"]')]);
    check(`[${locale}] the recovery request is confirmed without revealing the account`, await recovery.getByText(t.recoverySent).isVisible());
    await recovery.screenshot({ path: path.join(SHOTS, `${locale}-forgot-sent.png`) });
    const mail = await mailFor(email, { after: startedAt });
    const link = /https?:\/\/[^\s"<>)]*verify[^\s"<>)]*/.exec(mail.Text ?? mail.HTML ?? "")?.[0]?.replace(/&amp;/g, "&");
    check(`[${locale}] a recovery email arrived`, Boolean(link));
    const newPassword = secret();
    passwords.push(newPassword);
    await recovery.goto(link);
    await recovery.waitForURL(`**/${locale}/account/password**`);
    check(`[${locale}] the link opens the new-password page in ${locale}`, (await recovery.getAttribute("html", "lang")) === locale);
    await recovery.screenshot({ path: path.join(SHOTS, `${locale}-recovery-password.png`) });
    await choosePassword(recovery, locale, newPassword);
    check(`[${locale}] the new password is saved and the person is signed in`, await recovery.getByText(t.passwordChanged).isVisible());
    await recovery.click('form[data-form="sign-out"] button[type="submit"]');
    await recovery.waitForURL((u) => u.search.includes("notice=signed_out"));
    check(`[${locale}] sign-out returns to sign-in with a message`, await recovery.getByText(t.signedOut).isVisible());
    await signIn(recovery, locale, email, newPassword);
    check(`[${locale}] the person signs in with the recovered password`, new URL(recovery.url()).pathname === `/${locale}`);
    // ---------------------------------------------------------------- administrator issues a temporary password
    // The person is signed in and working; the reset holds the open session at the password page.
    const temp2 = secret();
    const ownAgain = secret();
    passwords.push(temp2, ownAgain);
    await admin.goto(`${BASE}/${locale}/admin/staff/${id}`);
    await admin.fill('form[data-form="reset-password"] input[name="password"]', temp2);
    await Promise.all([admin.waitForURL((u) => u.search.includes("notice=password_reset")), admin.click('form[data-form="reset-password"] button[type="submit"]')]);
    check(`[${locale}] the administrator's temporary password is confirmed`, await admin.getByText(locale === "ar" ? /تم تعيين كلمة المرور المؤقتة/ : /The temporary password was set/).isVisible());
    await recovery.goto(`${BASE}/${locale}/daily-close`);
    check(`[${locale}] the session open before the reset is ended: the person is sent to sign in`, new URL(recovery.url()).pathname === `/${locale}/sign-in`, recovery.url());
    await signIn(recovery, locale, email, temp2);
    check(`[${locale}] signing in with the administrator's temporary password leads to the password page`, new URL(recovery.url()).pathname === `/${locale}/account/password`, recovery.url());
    await recovery.goto(`${BASE}/${locale}/daily-close`);
    check(`[${locale}] and every other page is held at the password page until a password is chosen`, new URL(recovery.url()).pathname === `/${locale}/account/password`, recovery.url());
    check(`[${locale}] which explains that an administrator set the password`, await recovery.getByText(locale === "ar" ? /وضعها المسؤول/ : /set by an administrator/).isVisible());
    await recovery.screenshot({ path: path.join(SHOTS, `${locale}-password-after-reset.png`) });
    await choosePassword(recovery, locale, ownAgain);
    await recovery.goto(`${BASE}/${locale}/daily-close`);
    check(`[${locale}] after choosing a password the daily close opens again`, new URL(recovery.url()).pathname === `/${locale}/daily-close`);
    const flagState = await service.from("staff_accounts").select("must_change_password").eq("user_id", id);
    check(`[${locale}] the stored requirement is lifted`, flagState.data[0].must_change_password === false);
    await recoveryContext.close();
    await visitorContext.close();
  }

  const stored = await service.from("audit_log").select("action");
  check("the audit history holds the actions made in both languages", ["staff.created", "staff.access_changed", "staff.disabled", "staff.reactivated"].every((a) => stored.data.some((r) => r.action === a)));
  check("no password appears in any audit record", !(await service.from("audit_log").select("changes")).data.some((r) => passwords.some((p) => JSON.stringify(r.changes).includes(p))));
  check("the browsers reported no script or console errors", consoleProblems.length === 0, consoleProblems.slice(0, 5).join(" | "));
  await browser.close();
}

try {
  await main();
} catch (error) {
  state.failures += 1;
  console.log(`  FAIL unexpected error: ${error?.stack ?? error}`);
} finally {
  server.child.kill();
}
console.log(`\n${state.checks} browser checks, ${state.failures} failed. Screenshots: ${SHOTS}`);
if (state.failures > 0) console.log(`Failed: ${state.names.join(" | ")}`);
process.exit(state.failures > 0 ? 1 : 0);
