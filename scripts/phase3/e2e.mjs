// Phase 3 end-to-end checks over HTTP against the PRODUCTION build and the LOCAL Supabase instance.
//
//   npm run build && npm run test:phase3
//
// It rebuilds the local database (supabase db reset; pass --no-reset to skip), starts the built
// application, creates a synthetic System Admin with the documented bootstrap command, and then
// drives the real forms and server actions of the application the way a browser without
// JavaScript does. Passwords are random per run and never printed. No hosted service is used.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  Jar,
  clientFromJar,
  createReporter,
  directSession,
  loadEnv,
  makeHttp,
  mailFor,
  plainText,
  readForm,
  root,
  run,
  serviceClient,
  startServer,
  submitForm,
  waitUp,
} from "./lib.mjs";

const PORT = process.env.E2E_PORT ?? "3199";
const BASE = `http://127.0.0.1:${PORT}`;
const noReset = process.argv.includes("--no-reset");
const { check, section, state } = createReporter();
const secret = () => `${randomBytes(9).toString("base64url")}-Aa1`;

if (!noReset) {
  console.log("Rebuilding the local database (supabase db reset)...");
  const reset = run("npx", ["supabase", "db", "reset"]);
  if (reset.status !== 0) {
    console.error(`db reset failed\n${reset.stdout}\n${reset.stderr}`);
    process.exit(2);
  }
}

const env = loadEnv();
const server = startServer(PORT, { SITE_URL: BASE, BALABAN_DEMO_FIXTURES: "1" });
const http = makeHttp(BASE);
const service = serviceClient(env);
const passwords = [];

async function main() {
  await waitUp(BASE, server);
  const text = async (jar, pathname) => {
    const response = await http.get(jar, pathname);
    return { status: response.status, location: response.headers.get("location"), html: await response.text(), response };
  };
  const followed = async (jar, pathname) => {
    const first = await http.get(jar, pathname);
    return http.follow(jar, first, []);
  };
  const where = (location) => (location ? new URL(location, BASE).pathname + new URL(location, BASE).search : "");

  // ============================================================ 0. catalog
  section("0. Permission catalog: application code and database agree");
  {
    const catalog = await import("../../src/modules/access/catalog.ts");
    const [permissions, groups, mapping] = await Promise.all([
      service.from("permissions").select("key, scope, branch_kind"),
      service.from("permission_groups").select("key, scope"),
      service.from("group_permissions").select("group_key, permission_key"),
    ]);
    const dbPermissions = new Map(permissions.data.map((p) => [p.key, `${p.scope}/${p.branch_kind}`]));
    check("same permission keys, scopes and branch kinds", dbPermissions.size === catalog.PERMISSIONS.length && catalog.PERMISSIONS.every((p) => dbPermissions.get(p.key) === `${p.scope}/${p.branchKind}`));
    check("same groups and group scopes", groups.data.length === catalog.GROUPS.length && groups.data.every((g) => catalog.GROUPS.includes(g.key) && (g.scope === "organization") === catalog.ORGANIZATION_GROUPS.includes(g.key)));
    const dbMap = new Map();
    for (const row of mapping.data) dbMap.set(row.group_key, [...(dbMap.get(row.group_key) ?? []), row.permission_key]);
    check(
      "same permissions in every group",
      catalog.GROUPS.every((g) => JSON.stringify([...(dbMap.get(g) ?? [])].sort()) === JSON.stringify([...catalog.GROUP_PERMISSIONS[g]].sort())),
    );
    const branches = await service.from("branches").select("code, operates_in_app");
    check(
      "Maarif is the operating branch; Al Quds and Bourgogne are comparison-only",
      branches.data.length === 3 && branches.data.every((b) => b.operates_in_app === (b.code === "maarif")),
    );
  }

  // ============================================================ 1. anonymous visitors
  section("1. Anonymous visitors");
  const anon = new Jar();
  for (const locale of ["en", "ar"]) {
    for (const page of ["", "/daily-close", "/cash-count", "/comparison", "/reports", "/inventory/adjustments", "/admin/staff", "/admin/staff/new", "/admin/audit", "/account/password"]) {
      const r = await text(anon, `/${locale}${page}`);
      check(`/${locale}${page} redirects to sign-in`, r.status === 307 && where(r.location).startsWith(`/${locale}/sign-in?next=`), `${r.status} ${r.location}`);
    }
    const signIn = await text(anon, `/${locale}/sign-in`);
    const dir = locale === "ar" ? "rtl" : "ltr";
    check(`/${locale}/sign-in renders (lang, dir ${dir}, email and password fields)`, signIn.status === 200 && signIn.html.includes(`<html lang="${locale}" dir="${dir}">`) && /name="email"/.test(signIn.html) && /name="password"/.test(signIn.html));
    check(`/${locale}/sign-in text is in ${locale === "ar" ? "Arabic" : "English"}`, locale === "ar" ? /تسجيل الدخول/.test(signIn.html) : /Sign in/.test(signIn.html));
    const forgot = await text(anon, `/${locale}/forgot-password`);
    check(`/${locale}/forgot-password renders`, forgot.status === 200 && Boolean(readForm(forgot.html, "forgot-password")));
  }
  for (const target of ["/api/exports/daily-close-draft", "/api/exports/comparison", "/api/exports/unknown"]) {
    const r = await text(anon, target);
    check(`${target} is refused with 401`, r.status === 401, String(r.status));
  }
  {
    const r = await http.request(anon, "POST", "/api/inventory/adjustments", { json: { branch: "maarif", businessDate: "2026-11-02", reason: "x" } });
    check("POST /api/inventory/adjustments is refused with 401", r.status === 401, String(r.status));
    const cross = await http.request(anon, "POST", "/api/inventory/adjustments", { json: { branch: "maarif" }, headers: { origin: "http://evil.example" } });
    check("a cross-site POST is refused", cross.status === 403, String(cross.status));
  }

  // ============================================================ 2. bootstrap and the first sign-in
  section("2. Bootstrap of the synthetic System Admin and first sign-in");
  const adminEmail = "synthetic.admin@example.test";
  const adminTemp = secret();
  let adminPassword = secret();
  passwords.push(adminTemp, adminPassword);
  {
    const boot = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", adminEmail, "--name", "Synthetic Admin"], { env: { ...env, BOOTSTRAP_ADMIN_PASSWORD: adminTemp } });
    check("bootstrap command succeeds", boot.status === 0, `${boot.stdout}${boot.stderr}`.slice(0, 300));
    check("bootstrap output never contains the password", !`${boot.stdout}${boot.stderr}`.includes(adminTemp));
    const again = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", "another.admin@example.test", "--name", "Another"], { env: { ...env, BOOTSTRAP_ADMIN_PASSWORD: secret() } });
    check("a second bootstrap is refused", again.status !== 0 && /already has an active System Admin/.test(again.stderr));
    const users = await service.auth.admin.listUsers({ perPage: 200 });
    check("the refused bootstrap left no sign-in account behind", !users.data.users.some((u) => u.email === "another.admin@example.test"));
    const remote = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", "x@example.test", "--name", "X"], { env: { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", BOOTSTRAP_ADMIN_PASSWORD: secret() } });
    check("bootstrap refuses a non-local Supabase URL without --confirm-remote", remote.status !== 0 && /not a local Supabase instance/.test(remote.stderr));
  }

  const adminJar = new Jar();
  {
    const page = await text(adminJar, "/en/sign-in");
    const wrong = await submitForm(http, adminJar, "/en/sign-in", page.html, "sign-in", { email: adminEmail, password: "wrong-password-123" });
    check("a wrong password goes back to sign-in with a message", wrong.status === 303 && where(wrong.headers.get("location")).includes("error=invalid"), `${wrong.status} ${wrong.headers.get("location")}`);
    const bad = await text(new Jar(), where(wrong.headers.get("location")));
    check("the message is the same for a wrong password and an unknown email (no account hint)", /The email or password is not correct/.test(bad.html));
    const unknown = await submitForm(http, adminJar, "/en/sign-in", page.html, "sign-in", { email: "nobody@example.test", password: "whatever-123456" });
    check("an unknown email gets the same answer", unknown.headers.get("location") === wrong.headers.get("location"));

    const res = await submitForm(http, adminJar, "/en/sign-in", page.html, "sign-in", { email: adminEmail, password: adminTemp });
    check("the temporary password signs in and leads to the password change", res.status === 303 && where(res.headers.get("location")) === "/en/account/password", `${res.status} ${res.headers.get("location")}`);
    await flaggedChecks("first sign-in administrator", adminJar);
    const cookie = adminJar.raw.find((c) => /^sb-.*-auth-token/.test(c)) ?? "";
    check("the session cookie is HttpOnly and SameSite=Lax", /httponly/i.test(cookie) && /samesite=lax/i.test(cookie), cookie.replace(/=[^;]+/, "=…"));
  }
  {
    const staff = await text(adminJar, "/en/admin/staff");
    check("until the password is changed, protected pages lead to the password change", staff.status === 307 && where(staff.location) === "/en/account/password");
    const exp = await text(adminJar, "/api/exports/comparison");
    check("and downloads are refused", exp.status === 403, String(exp.status));
    const page = await text(adminJar, "/en/account/password");
    check("the password page explains why (English)", page.status === 200 && /set by an administrator/.test(page.html));
    const mismatch = await submitForm(http, adminJar, "/en/account/password", page.html, "change-password", { password: adminPassword, confirm: `${adminPassword}x` });
    check("different passwords are refused", where(mismatch.headers.get("location")).includes("error=password_mismatch"));
    const weak = await submitForm(http, adminJar, "/en/account/password", page.html, "change-password", { password: "short", confirm: "short" });
    check("a short password is refused", where(weak.headers.get("location")).includes("error=weak_password"));
    const ok = await submitForm(http, adminJar, "/en/account/password", page.html, "change-password", { password: adminPassword, confirm: adminPassword });
    check("the new password is accepted", ok.status === 303 && where(ok.headers.get("location")).startsWith("/en?notice=password_changed"), `${ok.status} ${ok.headers.get("location")}`);
  }

  // ============================================================ 3. administrator pages
  section("3. The administrator reaches every page, in both languages");
  for (const locale of ["en", "ar"]) {
    const dir = locale === "ar" ? "rtl" : "ltr";
    for (const page of ["", "/daily-close", "/cash-count", "/comparison", "/reports", "/inventory/adjustments", "/admin/staff", "/admin/staff/new", "/admin/audit"]) {
      const r = await text(adminJar, `/${locale}${page}`);
      check(`/${locale}${page} -> 200 (${dir})`, r.status === 200 && r.html.includes(`<html lang="${locale}" dir="${dir}">`), String(r.status));
    }
  }
  {
    const r = await text(adminJar, "/en/admin/staff");
    check("the staff list shows the administrator", /Synthetic Admin/.test(r.html) && /System Admin/.test(r.html));
    const ar = await text(adminJar, "/ar/admin/staff");
    check("the Arabic staff list uses Arabic labels", /حسابات الموظفين/.test(ar.html) && /مدير النظام/.test(ar.html));
    const csv = await text(adminJar, "/api/exports/comparison");
    check("the administrator downloads the comparison export (CSV, attachment)", csv.status === 200 && /text\/csv/.test(csv.response.headers.get("content-type")) && /attachment/.test(csv.response.headers.get("content-disposition")) && /alquds/.test(csv.html));
    const draft = await text(adminJar, "/api/exports/daily-close-draft");
    check("and the daily-close draft export", draft.status === 200 && /2026-11-02/.test(draft.html));
  }

  // ============================================================ 4. Administrator manages staff (real forms)
  section("4. Create, change, disable and reactivate staff; several groups on one person");
  const staffIds = {};
  const tempPasswords = {};
  async function createStaff({ key, name, email, number = "", access }) {
    const page = await text(adminJar, "/en/admin/staff/new");
    const temp = secret();
    passwords.push(temp);
    tempPasswords[key] = temp;
    const res = await submitForm(http, adminJar, "/en/admin/staff/new", page.html, "create-staff", {
      full_name: name,
      email,
      employee_number: number,
      password: temp,
      org_group: access.org ?? [],
      branch: access.branch ?? [],
      group: access.group ?? [],
    });
    const location = where(res.headers.get("location"));
    const id = /\/admin\/staff\/([0-9a-f-]{36})\?notice=created/.exec(location)?.[1];
    if (id) staffIds[key] = id;
    return { res, id, location };
  }
  const people = [
    { key: "cashier", name: "Synthetic Cashier", email: "cashier@example.test", number: "C-001", access: { group: ["maarif:cashier"] } },
    { key: "store", name: "Synthetic Storekeeper", email: "storekeeper@example.test", access: { group: ["maarif:storekeeper"] } },
    { key: "editor", name: "Synthetic Comparison Editor", email: "editor@example.test", access: { group: ["alquds:comparison_editor"] } },
    { key: "manager", name: "Synthetic Manager", email: "manager@example.test", access: { group: ["maarif:manager"] } },
    { key: "kiosk", name: "Synthetic Kiosk", email: "kiosk@example.test", access: { group: ["maarif:attendance_kiosk"] } },
    { key: "multi", name: "Synthetic Multi", email: "multi@example.test", number: "M-007", access: { group: ["maarif:cashier", "maarif:storekeeper", "alquds:comparison_editor"] } },
  ];
  for (const person of people) {
    const { id, location } = await createStaff(person);
    check(`staff created through the form: ${person.name}`, Boolean(id), location);
  }
  {
    const dup = await createStaff({ key: "dup", name: "Duplicate", email: "cashier@example.test", access: { group: [] } });
    check("a second account with the same email is refused", where(dup.res.headers.get("location")).includes("error=email_in_use"), dup.location);
    const dupNumber = await createStaff({ key: "dup2", name: "Duplicate Number", email: "dupnumber@example.test", number: "C-001", access: { group: [] } });
    check("the same employee number is refused and leaves no sign-in account", where(dupNumber.res.headers.get("location")).includes("error=employee_number_in_use"));
    const users = await service.auth.admin.listUsers({ perPage: 200 });
    check("the refused creations left no orphan sign-in account", !users.data.users.some((u) => ["dupnumber@example.test"].includes(u.email)));
    const page = await text(adminJar, "/en/admin/staff/new");
    const weakRes = await submitForm(http, adminJar, "/en/admin/staff/new", page.html, "create-staff", { full_name: "Weak Two", email: "weak2@example.test", password: "short", group: [] });
    check("a short temporary password is refused", where(weakRes.headers.get("location")).includes("error=weak_password"));
  }
  {
    const detail = await text(adminJar, `/en/admin/staff/${staffIds.multi}`);
    const rows = await service.from("staff_group_assignments").select("group_key, branch_id").eq("staff_id", staffIds.multi);
    check("one person holds three groups across two branches", rows.data.length === 3 && new Set(rows.data.map((r) => r.group_key)).size === 3);
    check("the detail page shows them as checked", JSON.stringify((readForm(detail.html, "set-access") ?? []).filter(([n]) => n === "group").map(([, v]) => v).sort()) === JSON.stringify(["alquds:comparison_editor", "maarif:cashier", "maarif:storekeeper"]));
    check("every created account must choose its own password", (await service.from("staff_accounts").select("must_change_password").in("user_id", Object.values(staffIds))).data.every((r) => r.must_change_password === true));
  }

  // Change details and access, disable, reactivate: the audit history must show each.
  {
    const id = staffIds.multi;
    let page = await text(adminJar, `/en/admin/staff/${id}`);
    let res = await submitForm(http, adminJar, `/en/admin/staff/${id}`, page.html, "update-staff", { full_name: "Synthetic Multi Renamed", employee_number: "M-008" });
    check("staff details are changed", where(res.headers.get("location")).includes("notice=updated"));
    check("the change is stored", (await service.from("employees").select("full_name, employee_number").eq("employee_number", "M-008")).data?.[0]?.full_name === "Synthetic Multi Renamed");

    page = await text(adminJar, `/en/admin/staff/${id}`);
    res = await submitForm(http, adminJar, `/en/admin/staff/${id}`, page.html, "set-access", { group: ["maarif:cashier", "maarif:manager"], branch: ["maarif"], org_group: [] });
    check("groups are changed (Storekeeper and Al Quds removed, Manager added)", where(res.headers.get("location")).includes("notice=access_saved"));
    const rows = await service.from("staff_group_assignments").select("group_key").eq("staff_id", id);
    check("the stored groups are now cashier + manager", JSON.stringify(rows.data.map((r) => r.group_key).sort()) === JSON.stringify(["cashier", "manager"]));

    page = await text(adminJar, `/en/admin/staff/${id}`);
    res = await submitForm(http, adminJar, `/en/admin/staff/${id}`, page.html, "disable-staff", { reason: "left the shift" });
    check("the account is disabled", where(res.headers.get("location")).includes("notice=disabled"));
    check("the stored account is disabled with the reason", (await service.from("staff_accounts").select("is_active, disabled_reason").eq("user_id", id)).data[0].is_active === false);
    const authUser = await service.auth.admin.getUserById(id);
    check("the sign-in account is banned", Boolean(authUser.data.user.banned_until));
    page = await text(adminJar, `/en/admin/staff/${id}`);
    check("the page shows the disabled state and the reactivation form", /This account is disabled/.test(page.html) && Boolean(readForm(page.html, "reactivate-staff")));
    res = await submitForm(http, adminJar, `/en/admin/staff/${id}`, page.html, "reactivate-staff", {});
    check("the account is reactivated", where(res.headers.get("location")).includes("notice=reactivated"));
    check("the stored account is active and the ban is lifted", (await service.from("staff_accounts").select("is_active").eq("user_id", id)).data[0].is_active === true && !(await service.auth.admin.getUserById(id)).data.user.banned_until);

    const adminId = (await service.from("staff_accounts").select("user_id").eq("email", adminEmail)).data[0].user_id;
    const own = await text(adminJar, `/en/admin/staff/${adminId}`);
    res = await submitForm(http, adminJar, `/en/admin/staff/${adminId}`, own.html, "disable-staff", {});
    check("an administrator cannot disable their own account", where(res.headers.get("location")).includes("error=self_disable"));
    res = await submitForm(http, adminJar, `/en/admin/staff/${adminId}`, own.html, "set-access", { org_group: [], group: [], branch: [] });
    check("the last System Admin cannot be demoted", where(res.headers.get("location")).includes("error=last_admin"));
  }

  // ============================================================ 5. onboarding of staff (first sign-in)
  section("5. Staff sign in with the temporary password and choose their own");
  const jars = {};
  const secrets = {};
  /**
   * A signed-in person who still has a temporary password: the VALID session is useless against the
   * database (policies, commands, authorization question) and cannot release itself.
   */
  async function flaggedChecks(label, jar, { page = true } = {}) {
    const maarifId = (await service.from("branches").select("id").eq("code", "maarif")).data[0].id;
    const db = clientFromJar(env, jar);
    const days = await db.from("business_days").select("id");
    check(`${label}: with a temporary password the database returns no business day`, !days.error && days.data.length === 0, JSON.stringify(days.error ?? days.data.length));
    const branches = await db.from("branches").select("id");
    const audit = await db.from("audit_log").select("id");
    check(`${label}: nor branches or audit records`, !branches.error && branches.data.length === 0 && !audit.error && audit.data.length === 0);
    const write = await db.from("inventory_adjustments").insert({ id: crypto.randomUUID(), branch_id: maarifId, business_date: "2026-11-02", reason: "x" });
    check(`${label}: the database refuses a write`, write.error?.code === "42501", JSON.stringify(write.error));
    const asked = await db.rpc("app_authorize", { p_permission: "daily_close.view", p_branch_code: "maarif" });
    check(`${label}: the authorization question answers no`, asked.data === false, JSON.stringify(asked));
    const command = await db.rpc("admin_set_staff_access", { p_staff_id: "00000000-0000-4000-8000-000000000000", p_access: {} });
    check(`${label}: administrator commands are refused`, command.error?.message === "permission_denied", JSON.stringify(command.error));
    const release = await db.rpc("app_complete_password_change");
    check(`${label}: the person cannot release themselves without changing the password`, release.error?.message === "password_not_changed", JSON.stringify(release.error));
    const context = await db.rpc("app_access_context");
    check(`${label}: the state stays readable (flagged, no permission)`, context.data?.state === "active" && context.data?.must_change_password === true && context.data?.permissions.length === 0, JSON.stringify(context.data));
    if (page) {
      const protectedPage = await text(jar, "/en/daily-close");
      check(`${label}: the application page leads to the password change`, protectedPage.status === 307 && where(protectedPage.location) === "/en/account/password");
      const download = await text(jar, "/api/exports/daily-close-draft");
      check(`${label}: and a download is refused (403)`, download.status === 403, String(download.status));
    }
  }
  async function onboard(key, email) {
    const jar = new Jar();
    const page = await text(jar, "/en/sign-in");
    const signIn = await submitForm(http, jar, "/en/sign-in", page.html, "sign-in", { email, password: tempPasswords[key] });
    const goesToPassword = where(signIn.headers.get("location")) === "/en/account/password";
    await flaggedChecks(`first sign-in ${key}`, jar);
    const pw = secret();
    passwords.push(pw);
    secrets[key] = pw;
    const form = await text(jar, "/en/account/password");
    const done = await submitForm(http, jar, "/en/account/password", form.html, "change-password", { password: pw, confirm: pw });
    jars[key] = jar;
    return goesToPassword && where(done.headers.get("location")).startsWith("/en?notice=password_changed");
  }
  for (const person of people) {
    check(`${person.name} signs in with the temporary password and sets their own`, await onboard(person.key, person.email));
  }
  {
    const old = new Jar();
    const page = await text(old, "/en/sign-in");
    const res = await submitForm(http, old, "/en/sign-in", page.html, "sign-in", { email: "cashier@example.test", password: tempPasswords.cashier });
    check("the temporary password no longer works", where(res.headers.get("location")).includes("error=invalid"));
  }

  // ============================================================ 6. cashier
  section("6. Cashier: assigned workflows work; inventory adjustments and other branches are denied");
  {
    const jar = jars.cashier;
    for (const locale of ["en", "ar"]) {
      for (const page of ["", "/daily-close", "/cash-count"]) {
        const r = await text(jar, `/${locale}${page}`);
        check(`/${locale}${page} -> 200`, r.status === 200, String(r.status));
      }
    }
    const home = await text(jar, "/en");
    const links = (html) => [...html.matchAll(/<a[^>]*href="(\/en\/[a-z/-]*)"/g)].map((m) => m[1]);
    check(
      "the cashier's menu lists only their pages",
      links(home.html).includes("/en/daily-close") &&
        links(home.html).includes("/en/cash-count") &&
        !links(home.html).some((l) => ["/en/admin/staff", "/en/admin/audit", "/en/inventory/adjustments", "/en/comparison", "/en/reports"].includes(l)),
      links(home.html).join(","),
    );
    const csv = await text(jar, "/api/exports/daily-close-draft");
    check("the cashier downloads the daily-close draft", csv.status === 200 && /2026-11-02/.test(csv.html));

    // Page requests
    for (const [pathname, why] of [
      ["/en/inventory/adjustments", "inventory adjustments page"],
      ["/en/admin/staff", "staff accounts"],
      ["/en/admin/staff/new", "new staff"],
      ["/en/admin/audit", "audit history"],
      ["/en/comparison", "branch comparison"],
      ["/en/reports", "report map"],
      ["/en/daily-close?branch=alquds", "another branch (daily close)"],
      ["/en/cash-count?branch=alquds", "another branch (cash count)"],
      ["/en/daily-close?branch=bourgogne", "a third branch"],
      ["/ar/inventory/adjustments", "inventory adjustments page (Arabic)"],
      ["/ar/daily-close?branch=alquds", "another branch (Arabic)"],
    ]) {
      const r = await text(jar, pathname);
      check(`page denied with 403: ${why}`, r.status === 403 && (pathname.startsWith("/ar") ? /ليست لديك صلاحية لفتح هذه الصفحة/ : /You do not have permission to open this page/).test(r.html), `${r.status} ${plainText(r.html).slice(-200)}`);
    }
    const ar403 = await text(jar, "/ar/admin/staff");
    check("the Arabic denial page is in Arabic (direction is checked in the browser run)", ar403.status === 403 && /غير مسموح بالدخول/.test(ar403.html) && /ليست لديك صلاحية/.test(ar403.html));
    const unknownBranch = await text(jar, "/en/daily-close?branch=nowhere");
    check("an unknown branch is denied, not revealed", unknownBranch.status === 403);

    // Direct application requests and downloads
    const direct = await http.request(jar, "POST", "/api/inventory/adjustments", { json: { branch: "maarif", businessDate: "2026-11-02", reason: "recount" } });
    check("direct request: inventory adjustment refused (403)", direct.status === 403, `${direct.status} ${await direct.text()}`);
    const directOther = await http.request(jar, "POST", "/api/inventory/adjustments", { json: { branch: "alquds", businessDate: "2026-11-02", reason: "x" } });
    check("direct request: adjustment at another branch refused (403)", directOther.status === 403);
    const dl = await text(jar, "/api/exports/daily-close-draft?branch=alquds");
    check("download of another branch refused (403)", dl.status === 403);
    const dl2 = await text(jar, "/api/exports/comparison");
    check("download of the comparison export refused (403)", dl2.status === 403);
    const dl3 = await text(jar, "/api/exports/daily-close-draft?branch=nowhere");
    check("download for an unknown branch refused (403)", dl3.status === 403);

    // Database policy, reached as the cashier with their own session
    const db = clientFromJar(env, jar);
    const days = await db.from("business_days").select("branch_id, branches(code)");
    check("database: the cashier reads Maarif days only", !days.error && days.data.length >= 10 && days.data.every((d) => d.branches?.code === "maarif"), JSON.stringify(days.error));
    const adj = await db.from("inventory_adjustments").insert({ id: crypto.randomUUID(), branch_id: (await service.from("branches").select("id").eq("code", "maarif")).data[0].id, business_date: "2026-11-02", reason: "x" });
    check("database policy: the cashier cannot insert an inventory adjustment", adj.error?.code === "42501", JSON.stringify(adj.error));
    const comparison = await db.from("comparison_figures").select("id");
    check("database policy: the cashier reads no comparison figure", !comparison.error && comparison.data.length === 0);
    const audit = await db.from("audit_log").select("id");
    check("database policy: the cashier reads no audit record", !audit.error && audit.data.length === 0);
    const fingerprint = await db.from("staff_accounts").select("password_fingerprint");
    check("database: the password fingerprint is not readable through the API", fingerprint.error?.code === "42501", JSON.stringify(fingerprint.error));
    const others = await db.from("staff_accounts").select("email");
    check("database policy: the cashier reads only their own account", !others.error && others.data.length === 1 && others.data[0].email === "cashier@example.test");
    const forge = await db.from("staff_group_assignments").insert({ staff_id: staffIds.cashier, group_key: "system_admin" });
    check("database: the cashier cannot grant themselves System Admin (no write grant)", forge.error?.code === "42501", JSON.stringify(forge.error));
    const rpc = await db.rpc("admin_set_staff_access", { p_staff_id: staffIds.cashier, p_access: { organization_groups: ["system_admin"] } });
    check("database command: admin_set_staff_access refused for the cashier", rpc.error?.message === "permission_denied", JSON.stringify(rpc.error));
    const boot = await db.rpc("app_bootstrap_system_admin", { p_user_id: staffIds.cashier, p_organization_id: "00000000-0000-4000-8000-000000000001", p_full_name: "x", p_email: "cashier@example.test" });
    check("database command: the bootstrap command is not callable by staff", boot.error?.code === "42501" || /permission denied|could not find/i.test(boot.error?.message ?? ""), JSON.stringify(boot.error));
    const anonDb = clientFromJar(env, new Jar());
    const anonRead = await anonDb.from("business_days").select("id");
    check("database: an anonymous client cannot read business days", Boolean(anonRead.error) && (anonRead.data ?? []).length === 0, JSON.stringify(anonRead.error));
  }

  // Replaying another person's form (server action) as the cashier.
  {
    const adminNew = await text(adminJar, "/en/admin/staff/new");
    const createFields = Object.fromEntries(readForm(adminNew.html, "create-staff") ?? []);
    const actionName = Object.keys(createFields).find((k) => k.startsWith("$ACTION_ID_"));
    check("the form carries a server-action id (replay test is meaningful)", Boolean(actionName));
    const body = new FormData();
    body.append(actionName, "");
    body.append("locale", "en");
    body.append("full_name", "Injected Person");
    body.append("email", "injected@example.test");
    body.append("password", secret());
    body.append("org_group", "system_admin");
    const res = await http.request(jars.cashier, "POST", "/en/admin/staff/new", { body });
    const after = await service.auth.admin.listUsers({ perPage: 200 });
    check("replaying the create-staff action as a cashier is refused", res.status === 403 || (res.status >= 300 && !where(res.headers.get("location")).includes("notice=created")), String(res.status));
    check("and nothing was created", !after.data.users.some((u) => u.email === "injected@example.test") && (await service.from("employees").select("id").eq("full_name", "Injected Person")).data.length === 0);

    const accessForm = await text(adminJar, `/en/admin/staff/${staffIds.cashier}`);
    const accessFields = Object.fromEntries(readForm(accessForm.html, "set-access") ?? []);
    const accessAction = Object.keys(accessFields).find((k) => k.startsWith("$ACTION_ID_"));
    const escalate = new FormData();
    escalate.append(accessAction, "");
    escalate.append("locale", "en");
    escalate.append("staff_id", staffIds.cashier);
    escalate.append("org_group", "system_admin");
    const esc = await http.request(jars.cashier, "POST", `/en/admin/staff/${staffIds.cashier}`, { body: escalate });
    const groups = await service.from("staff_group_assignments").select("group_key").eq("staff_id", staffIds.cashier);
    check("replaying the set-access action to become System Admin is refused", groups.data.every((g) => g.group_key === "cashier"), `${esc.status} ${JSON.stringify(groups.data)}`);
  }

  // ============================================================ 7. storekeeper and others
  section("7. Storekeeper, manager, comparison editor and kiosk");
  {
    const jar = jars.store;
    const page = await text(jar, "/en/inventory/adjustments");
    check("the storekeeper opens the adjustments page", page.status === 200 && Boolean(readForm(page.html, "adjustment")));
    const res = await submitForm(http, jar, "/en/inventory/adjustments", page.html, "adjustment", { business_date: "2026-11-02", reason: "Recount after delivery", note: "synthetic" });
    check("the storekeeper records an adjustment through the form", where(res.headers.get("location")).includes("notice=adjustment_saved"), `${res.status} ${res.headers.get("location")}`);
    const api = await http.request(jar, "POST", "/api/inventory/adjustments", { json: { branch: "maarif", businessDate: "2026-11-03", reason: "Waste correction" } });
    check("and through a direct request (201)", api.status === 201, `${api.status}`);
    const bad = await http.request(jar, "POST", "/api/inventory/adjustments", { json: { branch: "maarif", businessDate: "not-a-date", reason: "" } });
    check("an invalid direct request is rejected (400)", bad.status === 400);
    const other = await http.request(jar, "POST", "/api/inventory/adjustments", { json: { branch: "alquds", businessDate: "2026-11-03", reason: "x" } });
    check("an adjustment at another branch is refused (403)", other.status === 403);
    const rows = await service.from("inventory_adjustments").select("reason, created_by");
    check("exactly the two permitted adjustments exist, made by the storekeeper", rows.data.length === 2 && rows.data.every((r) => r.created_by === staffIds.store));
    const denied = await text(jar, "/en/daily-close");
    check("the storekeeper has no daily-close access", denied.status === 403);
    const audit = await service.from("audit_log").select("action, actor_name, branch_id").eq("action", "inventory_adjustments.created");
    check("operating actions are audited with the actor", audit.data.length === 2 && audit.data.every((a) => a.actor_name === "Synthetic Storekeeper" && a.branch_id));
  }
  {
    const jar = jars.manager;
    check("the manager reads the daily close", (await text(jar, "/en/daily-close")).status === 200);
    check("but not the branch comparison (needs every branch)", (await text(jar, "/en/comparison")).status === 403);
    check("nor the comparison export", (await text(jar, "/api/exports/comparison")).status === 403);
    check("and cannot record adjustments", (await text(jar, "/en/inventory/adjustments")).status === 403);
    const db = clientFromJar(env, jar);
    const day = await service.from("business_days").select("id").eq("business_date", "2026-11-08").eq("status", "open");
    const opened = await db.from("business_days").update({ net_sales: 5, status: "closed", closed_at: new Date().toISOString() }).eq("id", day.data[0].id).select("id");
    check("legacy daily close tables reject direct financial updates", opened.error?.code === "42501", JSON.stringify(opened.error));
  }
  {
    const jar = jars.editor;
    check("the comparison editor cannot view the comparison page", (await text(jar, "/en/comparison")).status === 403);
    check("cannot download comparison figures", (await text(jar, "/api/exports/comparison")).status === 403);
    check("and has no other page", (await text(jar, "/en/daily-close")).status === 403 && (await text(jar, "/en/reports")).status === 403);
    const db = clientFromJar(env, jar);
    const alquds = (await service.from("branches").select("id").eq("code", "alquds")).data[0].id;
    const bourgogne = (await service.from("branches").select("id").eq("code", "bourgogne")).data[0].id;
    const maarif = (await service.from("branches").select("id").eq("code", "maarif")).data[0].id;
    const ok = await db.from("comparison_figures").insert({ branch_id: alquds, business_date: "2026-11-17", net_sales: 88 });
    check("database: the editor enters a figure for the assigned branch", !ok.error, JSON.stringify(ok.error));
    const other = await db.from("comparison_figures").insert({ branch_id: bourgogne, business_date: "2026-11-17", net_sales: 99 });
    check("database policy: not for an unassigned branch", other.error?.code === "42501", JSON.stringify(other.error));
    const operating = await db.from("comparison_figures").insert({ branch_id: maarif, business_date: "2026-11-17", net_sales: 99 });
    check("database policy: not for the operating branch", operating.error?.code === "42501", JSON.stringify(operating.error));
    const read = await db.from("comparison_figures").select("id");
    check("database policy: entry does not grant viewing, even of their own figure", !read.error && read.data.length === 0);
    const view = await db.from("branch_daily_figures").select("branch_id");
    check("database policy: nor through the combined view", !view.error && view.data.length === 0);
    const audit = await service.from("audit_log").select("actor_name").eq("action", "comparison_figures.created");
    check("the figure entry is audited", audit.data.length === 1 && audit.data[0].actor_name === "Synthetic Comparison Editor");
  }
  {
    const jar = jars.kiosk;
    for (const page of ["/en/daily-close", "/en/cash-count", "/en/comparison", "/en/reports", "/en/inventory/adjustments", "/en/admin/staff"]) {
      check(`the attendance kiosk is denied ${page}`, (await text(jar, page)).status === 403);
    }
    check("and every download", (await text(jar, "/api/exports/daily-close-draft")).status === 403 && (await text(jar, "/api/exports/comparison")).status === 403);
    const home = await text(jar, "/en");
    const nav = [...home.html.matchAll(/<a[^>]*href="(\/en\/[a-z/-]+)"/g)].map((m) => m[1]);
    // Phases 13-14: the kiosk's only screen is the kiosk itself (its page then checks the device registration).
    check("its menu has no work screens, only the attendance kiosk", home.status === 200 && nav.join(",") === "/en/kiosk", nav.join(","));
  }

  // ============================================================ 8. permissions change under an open session
  section("8. A removed permission or a disabled account blocks the next request of a signed-in person");
  {
    const jar = jars.cashier;
    const before = await text(jar, "/en/daily-close");
    const csvBefore = await text(jar, "/api/exports/daily-close-draft");
    check("before: the open session works (page and download)", before.status === 200 && csvBefore.status === 200);

    let page = await text(adminJar, `/en/admin/staff/${staffIds.cashier}`);
    let res = await submitForm(http, adminJar, `/en/admin/staff/${staffIds.cashier}`, page.html, "set-access", { group: [], branch: ["maarif"], org_group: [] });
    check("the administrator removes the Cashier group", where(res.headers.get("location")).includes("notice=access_saved"));
    const pageAfter = await text(jar, "/en/daily-close");
    check("after: the SAME session is denied the page (403)", pageAfter.status === 403, String(pageAfter.status));
    const csvAfter = await text(jar, "/api/exports/daily-close-draft");
    check("after: the SAME session is denied the download (403)", csvAfter.status === 403, String(csvAfter.status));
    const db = clientFromJar(env, jar);
    const days = await db.from("business_days").select("id");
    check("after: the SAME session reads no row from the database", !days.error && days.data.length === 0, JSON.stringify(days.error));
    const home = await text(jar, "/en");
    check("after: the person is still signed in but sees no menu entries", home.status === 200 && /no permissions yet/.test(home.html) && !/Daily close/.test(home.html));

    page = await text(adminJar, `/en/admin/staff/${staffIds.cashier}`);
    await submitForm(http, adminJar, `/en/admin/staff/${staffIds.cashier}`, page.html, "set-access", { group: ["maarif:cashier"], branch: ["maarif"], org_group: [] });
    check("restoring the group restores access immediately", (await text(jar, "/en/daily-close")).status === 200);

    // Disable: keep a copy of the open session to prove the old credentials are useless.
    const stale = jar.clone();
    page = await text(adminJar, `/en/admin/staff/${staffIds.cashier}`);
    res = await submitForm(http, adminJar, `/en/admin/staff/${staffIds.cashier}`, page.html, "disable-staff", { reason: "end of contract" });
    check("the administrator disables the account", where(res.headers.get("location")).includes("notice=disabled"));

    const pageResult = await text(jar, "/en/daily-close");
    check("after disabling: the SAME session's next page request is sent to sign in again", pageResult.status === 307 && /^\/(en\/sign-in|api\/auth\/session-ended)/.test(where(pageResult.location)), `${pageResult.status} ${pageResult.location}`);
    const staleApi = await text(stale, "/api/exports/daily-close-draft");
    check("after disabling: a download with the same session is refused (401)", staleApi.status === 401, String(staleApi.status));
    const staleJson = await http.request(stale, "POST", "/api/inventory/adjustments", { json: { branch: "maarif", businessDate: "2026-11-02", reason: "x" } });
    check("after disabling: a direct request with the same session is refused (401)", staleJson.status === 401, String(staleJson.status));
    const staleDb = clientFromJar(env, stale);
    const staleRows = await staleDb.from("business_days").select("id");
    check("after disabling: the old credentials read nothing from the database (permission denied or no rows)", staleRows.error?.code === "42501" || (!staleRows.error && staleRows.data.length === 0), JSON.stringify(staleRows.error));
    const ctx = await staleDb.rpc("app_access_context");
    check("after disabling: the old credentials are not accepted by the database commands either", ctx.error?.code === "42501" || ctx.data?.state === "disabled", JSON.stringify(ctx.error ?? ctx.data));

    const fresh = new Jar();
    const signIn = await text(fresh, "/en/sign-in");
    const attempt = await submitForm(http, fresh, "/en/sign-in", signIn.html, "sign-in", { email: "cashier@example.test", password: secrets.cashier });
    check("a disabled person cannot sign in", /error=(invalid|not_allowed)/.test(where(attempt.headers.get("location"))), String(attempt.headers.get("location")));

    page = await text(adminJar, `/en/admin/staff/${staffIds.cashier}`);
    await submitForm(http, adminJar, `/en/admin/staff/${staffIds.cashier}`, page.html, "reactivate-staff", {});
    const back = new Jar();
    const signInAgain = await text(back, "/en/sign-in");
    const ok = await submitForm(http, back, "/en/sign-in", signInAgain.html, "sign-in", { email: "cashier@example.test", password: secrets.cashier });
    check("after reactivation the person signs in again with their own password", where(ok.headers.get("location")) === "/en");
    jars.cashier = back;
    check("and reaches their pages", (await text(back, "/en/daily-close")).status === 200);
  }

  // The database refuses on its own even when the sign-in service still accepts the session:
  // here the account is switched off in the database ONLY (as if ending the Auth sessions had failed).
  section("8b. Disabled in the database while the Auth session is still valid");
  {
    const jar = jars.cashier;
    const copy = jar.clone();
    check("before: the session works", (await text(jar, "/en/daily-close")).status === 200);
    await service.from("staff_accounts").update({ is_active: false, disabled_at: new Date().toISOString() }).eq("user_id", staffIds.cashier);
    const page = await text(jar, "/en/daily-close");
    check("the next page request is sent to end the session", page.status === 307 && where(page.location).startsWith("/api/auth/session-ended"), `${page.status} ${page.location}`);
    const api = await text(copy, "/api/exports/daily-close-draft");
    check("the next download is refused (401)", api.status === 401, String(api.status));
    const direct = await http.request(copy, "POST", "/api/inventory/adjustments", { json: { branch: "maarif", businessDate: "2026-11-02", reason: "x" } });
    check("the next direct request is refused (401)", direct.status === 401, String(direct.status));
    const rows = await clientFromJar(env, copy).from("business_days").select("id");
    check("the database policy returns nothing to the still-valid token", !rows.error && rows.data.length === 0, JSON.stringify(rows.error));
    const ended = await http.follow(jar, page.response, []);
    check("the session-ended route returns to sign-in with the explanation", ended.chain.some((c) => c.startsWith("/en/sign-in?notice=session_ended")) && /session ended because your account is not active/.test(ended.text), ended.chain.join(" > "));
    check("and clears the session cookies", !jar.list().some((c) => /^sb-.*-auth-token/.test(c.name)));
    await service.from("staff_accounts").update({ is_active: true, disabled_at: null }).eq("user_id", staffIds.cashier);
    const again = new Jar();
    const signIn = await text(again, "/en/sign-in");
    const ok = await submitForm(http, again, "/en/sign-in", signIn.html, "sign-in", { email: "cashier@example.test", password: secrets.cashier });
    check("switched back on, the person signs in again", where(ok.headers.get("location")) === "/en");
    jars.cashier = again;
  }

  // ============================================================ 9. password recovery
  section("9. Password recovery");
  {
    const jar = new Jar();
    const startedAt = Date.now() - 1000;
    const page = await text(jar, "/en/forgot-password");
    const invalid = await submitForm(http, jar, "/en/forgot-password", page.html, "forgot-password", { email: "not-an-email" });
    check("an invalid address is refused", where(invalid.headers.get("location")).includes("error=invalid_email"));
    const unknown = await submitForm(http, jar, "/en/forgot-password", page.html, "forgot-password", { email: "nobody@example.test" });
    check("an unknown address gets the same confirmation (no account hint)", where(unknown.headers.get("location")) === "/en/forgot-password?sent=1");
    const res = await submitForm(http, jar, "/en/forgot-password", page.html, "forgot-password", { email: "cashier@example.test" });
    check("the request is acknowledged", where(res.headers.get("location")) === "/en/forgot-password?sent=1");
    const sent = await text(jar, "/en/forgot-password?sent=1");
    check("the confirmation does not say whether the address has an account", /If that email belongs to an account/.test(sent.html));
    const mail = await mailFor("cashier@example.test", { after: startedAt });
    const link = /https?:\/\/[^\s"<>)]*verify[^\s"<>)]*/.exec(mail.Text ?? mail.HTML ?? "")?.[0]?.replace(/&amp;/g, "&");
    check("a recovery email with a link was sent", Boolean(link));
    const verify = await fetch(link, { redirect: "manual" });
    const callbackUrl = verify.headers.get("location");
    check("the link leads back to this application's callback with a one-time code", Boolean(callbackUrl) && callbackUrl.startsWith(`${BASE}/api/auth/callback`) && /code=/.test(callbackUrl), String(callbackUrl));
    const callback = await http.request(jar, "GET", new URL(callbackUrl).pathname + new URL(callbackUrl).search);
    check("the callback starts a session and opens the password page", callback.status === 307 && where(callback.headers.get("location")) === "/en/account/password?recovery=1", `${callback.status} ${callback.headers.get("location")}`);
    const form = await text(jar, "/en/account/password?recovery=1");
    check("the recovery page asks for a new password", form.status === 200 && /Choose a new password for your account/.test(form.html));
    const newPassword = secret();
    passwords.push(newPassword);
    const done = await submitForm(http, jar, "/en/account/password?recovery=1", form.html, "change-password", { password: newPassword, confirm: newPassword });
    check("the new password is saved", where(done.headers.get("location")).startsWith("/en?notice=password_changed"), String(done.headers.get("location")));
    const reuse = await fetch(link, { redirect: "manual" });
    const reuseLocation = reuse.headers.get("location") ?? "";
    check("the link cannot be used twice", !/code=/.test(reuseLocation) || /error/.test(reuseLocation), reuseLocation.slice(0, 120));
    const oldJar = new Jar();
    const signIn = await text(oldJar, "/en/sign-in");
    const old = await submitForm(http, oldJar, "/en/sign-in", signIn.html, "sign-in", { email: "cashier@example.test", password: secrets.cashier });
    check("the previous password stops working", where(old.headers.get("location")).includes("error=invalid"));
    const newJar = new Jar();
    const ok = await submitForm(http, newJar, "/en/sign-in", signIn.html, "sign-in", { email: "cashier@example.test", password: newPassword });
    check("the new password signs in", where(ok.headers.get("location")) === "/en");
    const badLink = await http.request(new Jar(), "GET", "/api/auth/callback?locale=en&code=not-a-real-code");
    check("an invalid recovery code returns to the recovery page with a message", badLink.status === 307 && where(badLink.headers.get("location")) === "/en/forgot-password?error=link_invalid");

    // Arabic: the same pages, in Arabic.
    const arPage = await text(new Jar(), "/ar/forgot-password?sent=1");
    check("Arabic recovery page and confirmation render right-to-left", arPage.html.includes('dir="rtl"') && /استعادة كلمة المرور/.test(arPage.html) && /إذا كان هذا البريد مرتبطًا بحساب/.test(arPage.html));
    const arSign = await text(new Jar(), "/ar/sign-in?error=invalid");
    check("Arabic sign-in error message", /البريد الإلكتروني أو كلمة المرور غير صحيحة/.test(arSign.html));
  }

  // ============================================================ 10. audit history
  section("10. Audit history");
  {
    const page = await text(adminJar, "/en/admin/audit");
    const actions = ["bootstrap.system_admin", "staff.created", "staff.updated", "staff.access_changed", "staff.disabled", "staff.reactivated", "account.password_changed", "inventory_adjustments.created", "comparison_figures.created"];
    for (const action of actions) check(`the audit page lists ${action}`, page.html.includes(`data-audit-action="${action}"`));
    check("the audit page shows who acted", /Synthetic Admin/.test(page.html) && /Synthetic Storekeeper/.test(page.html));
    check("no password appears anywhere in the audit page", !passwords.some((p) => page.html.includes(p)));
    const ar = await text(adminJar, "/ar/admin/audit");
    check("the Arabic audit page is Arabic and right-to-left", ar.html.includes('dir="rtl"') && /سجل التدقيق/.test(ar.html) && /إنشاء حساب موظف/.test(ar.html));
    const filtered = await text(adminJar, "/en/admin/audit?category=operation");
    check("the category filter works", /data-audit-action="inventory_adjustments.created"/.test(filtered.html) && !/data-audit-action="staff.created"/.test(filtered.html));
    const history = await text(adminJar, `/en/admin/staff/${staffIds.multi}`);
    check("a staff member's page shows their own history (created, updated, access, disabled, reactivated)", ["staff.created", "staff.updated", "staff.access_changed", "staff.disabled", "staff.reactivated"].every((a) => history.html.includes(`data-audit-action="${a}"`)));

    const changes = await service.from("audit_log").select("changes, actor_name, action, occurred_at, target_id").eq("action", "staff.access_changed").eq("target_id", staffIds.multi);
    const diff = changes.data[0]?.changes;
    check("the access change records groups added and removed", Boolean(diff) && diff.groups_removed.some((g) => g.group === "storekeeper") && diff.groups_added.some((g) => g.group === "manager"), JSON.stringify(diff));
    const all = await service.from("audit_log").select("changes");
    check("no credential-like field in any audit record", all.data.every((r) => !/"[a-z_ -]*(password|secret|token|api_?key)[a-z_ -]*"\s*:/i.test(JSON.stringify(r.changes))));
    check("no password value in any audit record", all.data.every((r) => !passwords.some((p) => JSON.stringify(r.changes).includes(p))));

    // Staff cannot alter the history; neither can the service role or the administrator.
    const adminDb = clientFromJar(env, adminJar);
    const adminFingerprint = await adminDb.from("staff_accounts").select("password_fingerprint");
    check("not even the administrator can read the password fingerprint", adminFingerprint.error?.code === "42501", JSON.stringify(adminFingerprint.error));
    const read = await adminDb.from("audit_log").select("id").limit(1);
    const id = read.data[0].id;
    const upd = await adminDb.from("audit_log").update({ actor_name: "Tampered" }).eq("id", id).select();
    check("the administrator cannot update an audit record", Boolean(upd.error) || upd.data.length === 0, JSON.stringify(upd));
    const del = await adminDb.from("audit_log").delete().eq("id", id).select();
    check("the administrator cannot delete an audit record", Boolean(del.error) || del.data.length === 0, JSON.stringify(del));
    const ins = await adminDb.from("audit_log").insert({ actor_name: "Forged", category: "administration", action: "staff.created", target_type: "x" });
    check("the administrator cannot forge an audit record", Boolean(ins.error), JSON.stringify(ins));
    const svcUpd = await service.from("audit_log").update({ actor_name: "Tampered" }).eq("id", id).select();
    check("the service role cannot update an audit record", Boolean(svcUpd.error), JSON.stringify(svcUpd));
    const svcDel = await service.from("audit_log").delete().eq("id", id).select();
    check("the service role cannot delete an audit record", Boolean(svcDel.error), JSON.stringify(svcDel));
    const still = await service.from("audit_log").select("actor_name").eq("id", id);
    check("the record is unchanged", still.data[0].actor_name !== "Tampered" && still.data[0].actor_name !== "Forged");
    for (const key of ["cashier", "store", "editor", "manager", "kiosk"]) {
      const jar = key === "cashier" ? jars.cashier : jars[key];
      const rows = await clientFromJar(env, jar).from("audit_log").select("id");
      check(`${key} reads no audit record`, !rows.error && rows.data.length === 0);
      const tamper = await clientFromJar(env, jar).from("audit_log").update({ actor_name: "x" }).eq("id", id).select();
      check(`${key} cannot alter the audit history`, Boolean(tamper.error) || tamper.data.length === 0);
    }
  }

  // ============================================================ 10b. further administrator actions and request hygiene
  section("10b. Password reset, email change, sign-in redirect, cross-site POST, accounts without a staff record");
  {
    // Administrator issues a new temporary password.
    const id = staffIds.editor;
    let page = await text(adminJar, `/en/admin/staff/${id}`);
    const temp = secret();
    passwords.push(temp);
    let res = await submitForm(http, adminJar, `/en/admin/staff/${id}`, page.html, "reset-password", { password: temp });
    check("the administrator sets a temporary password", where(res.headers.get("location")).includes("notice=password_reset"), String(res.headers.get("location")));
    // The editor's session, open since onboarding: setting a password through the Auth admin API ends it.
    const open = jars.editor;
    const openPage = await text(open, "/en/comparison");
    check("the session open before an administrator reset is ended (sent to sign in)", openPage.status === 307 && where(openPage.location).startsWith("/en/sign-in"), `${openPage.status} ${openPage.location}`);
    const openRows = await clientFromJar(env, open).from("branches").select("id");
    check("and its old credentials read nothing from the database", openRows.error?.code === "42501" || (!openRows.error && openRows.data.length === 0), JSON.stringify(openRows.error));
    // Independently of Auth: the flag set while a valid session is open blocks it at once (page and database).
    const flagging = await clientFromJar(env, adminJar).rpc("admin_record_password_reset", { p_staff_id: staffIds.kiosk });
    check("the administrator command flags the account without touching the password", !flagging.error, JSON.stringify(flagging.error));
    await flaggedChecks("flag set while the session is open", jars.kiosk);
    await service.from("staff_accounts").update({ must_change_password: false, password_fingerprint: null }).eq("user_id", staffIds.kiosk);
    check("and releasing the flag restores the open session", (await text(jars.kiosk, "/en")).status === 200);
    const old = new Jar();
    const form = await text(old, "/en/sign-in");
    res = await submitForm(http, old, "/en/sign-in", form.html, "sign-in", { email: "editor@example.test", password: secrets.editor });
    check("the previous password no longer works", where(res.headers.get("location")).includes("error=invalid"));
    const fresh = new Jar();
    res = await submitForm(http, fresh, "/en/sign-in", form.html, "sign-in", { email: "editor@example.test", password: temp });
    check("the temporary password works and forces a new password", where(res.headers.get("location")) === "/en/account/password");
    await flaggedChecks("administrator-issued temporary password", fresh);
    const flagged = await service.from("staff_accounts").select("must_change_password").eq("user_id", id);
    check("the account is flagged to change its password", flagged.data[0].must_change_password === true);

    // Recovery of a flagged account: the recovery link, then a new password, releases it.
    {
      const before = (await service.from("audit_log").select("id").eq("action", "account.password_changed").eq("target_id", id)).data.length;
      const rjar = new Jar();
      const startedAt = Date.now() - 1000;
      const fpage = await text(rjar, "/en/forgot-password");
      await submitForm(http, rjar, "/en/forgot-password", fpage.html, "forgot-password", { email: "editor@example.test" });
      const mail = await mailFor("editor@example.test", { after: startedAt });
      const link = /https?:\/\/[^\s"<>)]*verify[^\s"<>)]*/.exec(mail.Text ?? mail.HTML ?? "")?.[0]?.replace(/&amp;/g, "&");
      const verify = await fetch(link, { redirect: "manual" });
      const callback = new URL(verify.headers.get("location"));
      await http.request(rjar, "GET", callback.pathname + callback.search);
      await flaggedChecks("recovery session of a flagged account (before the new password)", rjar, { page: false });
      const ppage = await text(rjar, "/en/account/password?recovery=1");
      const recovered = secret();
      passwords.push(recovered);
      const done = await submitForm(http, rjar, "/en/account/password?recovery=1", ppage.html, "change-password", { password: recovered, confirm: recovered });
      check("recovery: the new password is accepted", where(done.headers.get("location")).startsWith("/en?notice=password_changed"), String(done.headers.get("location")));
      const after = await service.from("staff_accounts").select("must_change_password, password_fingerprint").eq("user_id", id);
      check("recovery: the requirement is lifted and the fingerprint cleared", after.data[0].must_change_password === false && after.data[0].password_fingerprint === null);
      const completion = await service.from("audit_log").select("actor_name").eq("action", "account.password_changed").eq("target_id", id);
      check("recovery: one more completion is audited, after the confirmed change", completion.data.length === before + 1, `${before} -> ${completion.data.length}`);
      const rdb = clientFromJar(env, rjar);
      const adj = await rdb.from("branches").select("code");
      check("recovery: the database now answers for this person (their branches are visible again)", !adj.error && adj.data.length >= 1);
      const stillOld = new Jar();
      const sp = await text(stillOld, "/en/sign-in");
      const oldTemp = await submitForm(http, stillOld, "/en/sign-in", sp.html, "sign-in", { email: "editor@example.test", password: temp });
      check("recovery: the temporary password no longer works", where(oldTemp.headers.get("location")).includes("error=invalid"));
    }
    const audit = await service.from("audit_log").select("changes").eq("action", "staff.password_reset_issued").eq("target_id", id);
    check("the reset is audited without any password", audit.data.length === 1 && !JSON.stringify(audit.data[0].changes).includes(temp));
    const weak = await submitForm(http, adminJar, `/en/admin/staff/${id}`, page.html, "reset-password", { password: "short" });
    check("a short temporary password is refused", where(weak.headers.get("location")).includes("error=weak_password"));

    // Email change keeps Auth and the staff record in step.
    const managerId = staffIds.manager;
    page = await text(adminJar, `/en/admin/staff/${managerId}`);
    res = await submitForm(http, adminJar, `/en/admin/staff/${managerId}`, page.html, "update-staff", { email: "manager.new@example.test" });
    check("the administrator changes an email address", where(res.headers.get("location")).includes("notice=updated"), String(res.headers.get("location")));
    const authUser = await service.auth.admin.getUserById(managerId);
    const stored = await service.from("staff_accounts").select("email").eq("user_id", managerId);
    check("the sign-in account and the staff record carry the new email", authUser.data.user.email === "manager.new@example.test" && stored.data[0].email === "manager.new@example.test");
    const { data: administrator } = await service.from("staff_accounts").select("user_id").eq("email", adminEmail).single();
    const emailAudit = await service.from("audit_log").select("actor_id, changes").eq("action", "staff.updated").eq("target_id", managerId);
    const emailChange = emailAudit.data?.find((entry) => entry.changes.after?.email === "manager.new@example.test");
    check("the email change records its administrator and both addresses",
      Boolean(emailChange && administrator && emailChange.actor_id === administrator.user_id) && emailChange.changes.before.email === "manager@example.test");
    const j1 = new Jar();
    res = await submitForm(http, j1, "/en/sign-in", form.html, "sign-in", { email: "manager.new@example.test", password: secrets.manager });
    check("the person signs in with the new email", where(res.headers.get("location")) === "/en");
    const selfEmail = await clientFromJar(env, j1).auth.updateUser({ email: "self-change@example.test" });
    check("staff cannot initiate a self-service sign-in email change", Boolean(selfEmail.error));
    const selfState = await service.auth.admin.getUserById(managerId);
    check("the refused request leaves no pending email and keeps the administrator's address",
      selfState.data.user?.email === "manager.new@example.test" && !selfState.data.user?.new_email);
    const j2 = new Jar();
    res = await submitForm(http, j2, "/en/sign-in", form.html, "sign-in", { email: "manager@example.test", password: secrets.manager });
    check("and no longer with the old one", where(res.headers.get("location")).includes("error=invalid"));
    page = await text(adminJar, `/en/admin/staff/${managerId}`);
    res = await submitForm(http, adminJar, `/en/admin/staff/${managerId}`, page.html, "update-staff", { email: "cashier@example.test" });
    check("an email already used by another account is refused", where(res.headers.get("location")).includes("error=email_in_use"), String(res.headers.get("location")));
    check("and both records keep the previous email", (await service.auth.admin.getUserById(managerId)).data.user.email === "manager.new@example.test" && (await service.from("staff_accounts").select("email").eq("user_id", managerId)).data[0].email === "manager.new@example.test");

    // The page to return to after sign-in.
    const jar = new Jar();
    const goes = async (next) => {
      const j = new Jar();
      const signIn = await text(j, `/en/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
      const r = await submitForm(http, j, "/en/sign-in", signIn.html, "sign-in", { email: "storekeeper@example.test", password: secrets.store });
      return where(r.headers.get("location"));
    };
    void jar;
    check("sign-in returns to the page that was asked for", (await goes("/en/inventory/adjustments")) === "/en/inventory/adjustments");
    check("sign-in ignores an address on another site", (await goes("https://evil.example/en/x")) === "/en");
    check("sign-in ignores a protocol-relative address", (await goes("//evil.example/en/x")) === "/en");
    check("sign-in ignores a page of the other language", (await goes("/ar/inventory/adjustments")) === "/en");

    // A server action posted from another site.
    const adminNew = await text(adminJar, "/en/admin/staff/new");
    const actionName = Object.keys(Object.fromEntries(readForm(adminNew.html, "create-staff") ?? [])).find((k) => k.startsWith("$ACTION_ID_"));
    const body = new FormData();
    body.append(actionName, "");
    body.append("locale", "en");
    body.append("full_name", "Cross Site");
    body.append("email", "crosssite@example.test");
    body.append("password", secret());
    const cross = await http.request(adminJar, "POST", "/en/admin/staff/new", { body, headers: { origin: "http://evil.example" } });
    const users = await service.auth.admin.listUsers({ perPage: 200 });
    check("a create-staff action posted from another site is refused even with the administrator's cookies", !users.data.users.some((u) => u.email === "crosssite@example.test") && !where(cross.headers.get("location")).includes("notice=created"), `${cross.status}`);

    // A sign-in account that is not a staff member.
    const strangerPassword = secret();
    passwords.push(strangerPassword);
    await service.auth.admin.createUser({ email: "stranger@example.test", password: strangerPassword, email_confirm: true });
    const sj = new Jar();
    const sp = await text(sj, "/en/sign-in");
    res = await submitForm(http, sj, "/en/sign-in", sp.html, "sign-in", { email: "stranger@example.test", password: strangerPassword });
    check("a valid Auth account without a staff record cannot sign in", where(res.headers.get("location")).includes("error=not_allowed"), String(res.headers.get("location")));
    check("and holds no session afterwards", !sj.list().some((c) => /^sb-.*-auth-token/.test(c.name)));
  }

  // ============================================================ 11. sign-out
  section("11. Sign-out");
  {
    const jar = jars.store;
    const page = await text(jar, "/en");
    check("the page shows the person's name and offers sign-out", /Signed in as Synthetic Storekeeper/.test(page.html) && Boolean(readForm(page.html, "sign-out")));
    const copy = jar.clone();
    const res = await submitForm(http, jar, "/en", page.html, "sign-out", {});
    check("sign-out returns to sign-in with a message", res.status === 303 && where(res.headers.get("location")) === "/en/sign-in?notice=signed_out", `${res.status} ${res.headers.get("location")}`);
    check("the session cookies are cleared", !jar.list().some((c) => /^sb-.*-auth-token/.test(c.name)));
    const after = await text(jar, "/en/inventory/adjustments");
    check("protected pages then require sign-in", after.status === 307 && where(after.location).startsWith("/en/sign-in"));
    const stale = await text(copy, "/api/exports/daily-close-draft");
    check("the old session cookie no longer works", stale.status === 401, String(stale.status));
  }
}

try {
  await main();
} catch (error) {
  state.failures += 1;
  console.log(`  FAIL unexpected error: ${error?.stack ?? error}`);
} finally {
  server.child.kill();
}

console.log(`\n${state.checks} checks, ${state.failures} failed.`);
if (state.failures > 0) {
  console.log(`Failed: ${state.names.join(" | ")}`);
  console.log(`--- server log tail ---\n${server.log().split("\n").slice(-25).join("\n")}`);
}
process.exit(state.failures > 0 ? 1 : 0);
void fileURLToPath;
void path;
