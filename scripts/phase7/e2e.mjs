// Phase 7 end-to-end checks over HTTP against the PRODUCTION build and the LOCAL Supabase instance.
//
//   npm run build && npm run test:phase7
//
// Rebuilds the local database (supabase db reset; --no-reset skips it), starts the built application,
// bootstraps a synthetic System Admin, closes synthetic Maarif days through the daily-close commands,
// enters Al Quds and Bourgogne figures through the real entry form, and checks the comparison page,
// the export and the permissions at the page, request and database levels.
// Synthetic people and figures only; passwords are random and never printed. Two test-only groups
// (comparison.view only, comparison.export only) are added to the local database to check that
// viewing and exporting are enforced separately; run `npx supabase db reset` afterwards.
import { randomBytes } from "node:crypto";
import { container } from "../phase3/db-check.mjs";
import {
  Jar, clientFromJar, createReporter, loadEnv, makeHttp, plainText, readForm, run, serviceClient, startServer, submitForm, waitUp,
} from "../phase3/lib.mjs";

const PORT = process.env.E2E_PORT ?? "3207";
const BASE = `http://127.0.0.1:${PORT}`;
const noReset = process.argv.includes("--no-reset");
const { check, section, state } = createReporter();
const secret = () => `${randomBytes(9).toString("base64url")}-Aa1`;
const CUR = "2026-11-17";
const PRI = "2026-11-10";

if (!noReset) {
  console.log("Rebuilding the local database (supabase db reset)...");
  const reset = run("npx", ["supabase", "db", "reset"]);
  if (reset.status !== 0) {
    console.error(`db reset failed\n${reset.stdout}\n${reset.stderr}`);
    process.exit(2);
  }
}
const env = loadEnv();
const server = startServer(PORT, { SITE_URL: BASE });
const http = makeHttp(BASE);
const service = serviceClient(env);

function psql(sql) {
  const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"], { input: sql });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout.trim();
}
const where = (location) => (location ? new URL(location, BASE).pathname + new URL(location, BASE).search : "");
const get = async (jar, pathname) => {
  const response = await http.get(jar, pathname);
  return { status: response.status, location: response.headers.get("location"), html: await response.text(), type: response.headers.get("content-type") ?? "" };
};
async function post(jar, pathname, html, form, set = {}) {
  const response = await submitForm(http, jar, pathname, html, form, set);
  return { status: response.status, to: where(response.headers.get("location")) };
}
const rowOf = (html, attr, value) => {
  const start = html.indexOf(`${attr}="${value}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</tr>", start));
};
const colOf = (row, col) => {
  const start = row.indexOf(`data-col="${col}"`);
  return start < 0 ? "" : row.slice(start, row.indexOf("</td>", start));
};
const noNonsense = (html) => !/NaN|Infinity|∞/.test(plainText(html));

async function main() {
  await waitUp(BASE, server);

  section("0. Synthetic people");
  const adminEmail = "comparison.admin@example.test";
  const adminTemp = secret();
  const adminPassword = secret();
  const boot = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", adminEmail, "--name", "Comparison Admin"], { env: { ...env, BOOTSTRAP_ADMIN_PASSWORD: adminTemp } });
  check("bootstrap of the synthetic administrator", boot.status === 0, `${boot.stdout}${boot.stderr}`.slice(0, 300));
  const admin = new Jar();
  {
    const page = await get(admin, "/en/sign-in");
    const signedIn = await submitForm(http, admin, "/en/sign-in", page.html, "sign-in", { email: adminEmail, password: adminTemp });
    const changePage = await get(admin, where(signedIn.headers.get("location")));
    const changed = await submitForm(http, admin, "/en/account/password", changePage.html, "change-password", { password: adminPassword, confirm: adminPassword });
    check("the administrator chooses a password", changed.status === 303, String(changed.status));
  }
  psql(`insert into public.permission_groups (key, description, scope) values
      ('pseven_viewer', 'test only: comparison.view', 'branch'), ('pseven_exporter', 'test only: comparison.export', 'branch');
    insert into public.group_permissions (group_key, permission_key) values ('pseven_viewer', 'comparison.view'), ('pseven_exporter', 'comparison.export');`);
  async function makeStaff(name, assignments) {
    const email = `p7.${randomBytes(4).toString("hex")}@example.test`;
    const password = secret();
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`could not create ${name}`);
    const id = created.data.user.id;
    const rows = assignments.map(([branch, group]) => `insert into public.branch_memberships(staff_id, branch_id) select '${id}', id from public.branches where code = '${branch}' on conflict do nothing;
      insert into public.staff_group_assignments(staff_id, branch_id, group_key) select '${id}', id, '${group}' from public.branches where code = '${branch}';`).join("\n");
    psql(`begin;
      insert into public.employees(id, organization_id, full_name) select '${id}', organization_id, '${name}' from public.branches where code = 'maarif';
      insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, '${email}' from public.employees where id = '${id}';
      ${rows}
      commit;`);
    const jar = new Jar();
    const page = await get(jar, "/en/sign-in");
    await submitForm(http, jar, "/en/sign-in", page.html, "sign-in", { email, password });
    return { id, jar, db: clientFromJar(env, jar) };
  }
  const all = (group) => ["alquds", "maarif", "bourgogne"].map((b) => [b, group]);
  const cashier = await makeStaff("P7 Cashier", [["maarif", "cashier"]]);
  const manager = await makeStaff("P7 Manager", [["maarif", "manager"]]);
  const editor = await makeStaff("P7 Editor", [["alquds", "comparison_editor"]]);
  const editor2 = await makeStaff("P7 Second Editor", [["alquds", "comparison_editor"], ["bourgogne", "comparison_editor"]]);
  const viewer = await makeStaff("P7 Viewer", all("pseven_viewer"));
  const exporter = await makeStaff("P7 Exporter", all("pseven_exporter"));
  check("six synthetic staff accounts exist", Number(psql("select count(*) from public.employees where full_name like 'P7 %'")) === 6);

  section("1. Maarif is closed once, through the daily close");
  {
    const days = [["2026-10-17", 10000, 2], [PRI, 10000, 2], [CUR, 12000, 3]];
    let first = true;
    for (const [date, sales, orders] of days) {
      const rpc = async (db, command, expected, payload) => {
        const { error } = await db.rpc("app_operating_command", { p_branch: "maarif", p_date: date, p_command: command, p_expected_revision: expected, p_request: crypto.randomUUID(), p_payload: payload });
        if (error) throw new Error(`${command} ${date}: ${error.code} ${error.message}`);
      };
      await rpc(cashier.db, "save", 0, { sales, posCash: sales, card: 0, cashier: cashier.id, orders, ...(first ? { openingCash: 0, openingCustody: 0 } : {}) });
      await rpc(cashier.db, "count", 1, { counter: manager.id, local: `${date}T22:00`, quantities: { 100: sales / 100 } });
      await rpc(cashier.db, "submit", 2, {});
      await rpc(manager.db, "close", 3, {});
      first = false;
    }
    check("three Maarif days are closed", psql("select count(*) from public.operating_day_revisions where state = 'closed'") === "3");
    const closing = await get(manager.jar, `/en/daily-close?date=${CUR}&month=2026-11`);
    check("closing: the daily close shows 120.00 MAD on 17 November", closing.status === 200 && /120\.00/.test(plainText(closing.html.slice(closing.html.indexOf('data-table="daily-sales"')))));
    const report = await get(cashier.jar, `/api/exports/daily-close-draft?date=${CUR}`);
    check("reports: the Daily Sales export carries the same 120.00", report.status === 200 && /2026-11-17,closed,120\.00,3/.test(report.html), report.html.slice(0, 300));
  }

  section("2. Al Quds and Bourgogne entry through the form");
  const entryPath = "/en/comparison/entry";
  {
    const page = await get(editor.jar, entryPath);
    check("the editor opens the entry page", page.status === 200 && Boolean(readForm(page.html, "entry-alquds")));
    check("only the assigned branch has a form", !readForm(page.html, "entry-bourgogne"));
    check("the entry page shows no saved figure (entering does not grant viewing)", !/96\.00|80\.00/.test(plainText(page.html)));
    check("the live source and entry owner are undecided", /data-owner="unset"/.test(page.html));
    const fields = readForm(page.html, "entry-alquds");
    const request = fields.find(([n]) => n === "request")[1];
    const first = await post(editor.jar, entryPath, page.html, "entry-alquds", { date: "2026-11-15", sales: "50", orders: "2", reference: "P7 synthetic sheet" });
    check("a new Al Quds figure is saved", first.to.includes("notice=comparison_saved"), first.to);
    const again = await post(editor.jar, entryPath, page.html, "entry-alquds", { date: "2026-11-15", sales: "50", orders: "2", reference: "P7 synthetic sheet" });
    check("retrying the same form is a replay", again.to.includes("notice=comparison_replayed"), again.to);
    check("the retry created one revision per figure, no more", psql(`select count(*) from public.comparison_entries where request_id = '${request}'`) === "2");
    const fresh = await get(editor.jar, entryPath);
    const dup = await post(editor.jar, entryPath, fresh.html, "entry-alquds", { date: PRI, sales: "77" });
    check("a second active value for the same branch, date, metric and source is refused", dup.to.includes("error=comparison_duplicate"), dup.to);
    const page2 = await get(editor.jar, entryPath);
    const noReason = await post(editor.jar, entryPath, page2.html, "entry-alquds", { date: PRI, mode: "correct", sales: "80" });
    check("a correction without a reason is refused", noReason.to.includes("error=comparison_reason_required"), noReason.to);
    const page3 = await get(editor.jar, entryPath);
    const corrected = await post(editor.jar, entryPath, page3.html, "entry-alquds", { date: PRI, mode: "correct", sales: "80", reason: "P7 typo" });
    check("a correction with a reason is saved", corrected.to.includes("notice=comparison_saved"), corrected.to);
    check("revision 2 is active and revision 1 is kept, retired", psql(`select string_agg(revision || ':' || value || ':' || active, ',' order by revision) from public.comparison_entries e join public.branches b on b.id = e.branch_id where b.code = 'alquds' and business_date = '${PRI}' and metric = 'net_sales'`) === "1:9600:false,2:8000:true");
    const page4 = await get(editor.jar, entryPath);
    const future = await post(editor.jar, entryPath, page4.html, "entry-alquds", { date: "2026-12-31", sales: "1" });
    check("a date that has not started is refused (or capped by the form)", future.to.includes("error=") || psql("select count(*) from public.comparison_entries where business_date = '2026-12-31'") === "0");
    const forged = await submitForm(http, editor.jar, entryPath, page4.html, "entry-alquds", { branch: "bourgogne", date: "2026-11-15", sales: "1" });
    check("a form forged for an unassigned branch writes nothing", psql("select count(*) from public.comparison_entries e join public.branches b on b.id = e.branch_id where b.code = 'bourgogne' and business_date = '2026-11-15'") === "0", String(forged.status));
    const page5 = await get(editor2.jar, entryPath);
    const bCur = await post(editor2.jar, entryPath, page5.html, "entry-bourgogne", { date: CUR, sales: "150", orders: "5" });
    const page6 = await get(editor2.jar, entryPath);
    const bPri = await post(editor2.jar, entryPath, page6.html, "entry-bourgogne", { date: PRI, sales: "0", orders: "0" });
    check("the second editor enters Bourgogne: 150.00 now and a recorded 0 before", bCur.to.includes("notice=comparison_saved") && bPri.to.includes("notice=comparison_saved"), `${bCur.to} ${bPri.to}`);
    check("the database refuses Maarif as a comparison entry (it comes from the close)", (await editor2.db.rpc("app_comparison_save", { p_branch: "maarif", p_request: crypto.randomUUID(), p_payload: { date: CUR, sales: "1" } })).error?.code === "42501");
    check("every save is audited with the person", Number(psql("select count(*) from public.audit_log where action in ('comparison.entered', 'comparison.corrected') and actor_name like 'P7 %'")) === 4);
  }

  section("3. Who can see, export and enter");
  const pages = (locale) => [`/${locale}/comparison`, `/${locale}/comparison?branches=alquds`, `/${locale}/comparison?mode=monthly&month=2026-11`, `/${locale}/comparison/history?branch=alquds&date=${PRI}`];
  for (const locale of ["en", "ar"]) {
    for (const page of pages(locale)) {
      const anon = await get(new Jar(), page);
      check(`${page}: anonymous visitors are sent to sign in`, anon.status === 307 && where(anon.location).startsWith(`/${locale}/sign-in`), String(anon.status));
      for (const [name, person] of [["cashier", cashier], ["editor", editor], ["exporter", exporter]]) {
        check(`${page}: the ${name} is refused (403)`, (await get(person.jar, page)).status === 403);
      }
      const ok = await get(viewer.jar, page);
      check(`${page}: the viewer reads it (${locale === "ar" ? "rtl" : "ltr"})`, ok.status === 200 && ok.html.includes(`<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">`), String(ok.status));
    }
  }
  check("the manager is refused the three-branch comparison", (await get(manager.jar, "/en/comparison")).status === 403);
  check("but reads Maarif alone (their branch)", (await get(manager.jar, "/en/comparison?branches=maarif")).status === 200);
  check("the manager's menu links to Maarif only", /href="\/en\/comparison\?branches=maarif"/.test((await get(manager.jar, "/en")).html));
  for (const [name, person] of [["cashier", cashier], ["manager", manager], ["viewer", viewer], ["exporter", exporter]]) {
    check(`the ${name} is refused the entry page`, (await get(person.jar, entryPath)).status === 403);
  }
  check("the editor's menu has comparison entry but not the comparison", ((h) => /href="\/en\/comparison\/entry"/.test(h) && !/href="\/en\/comparison[?"]/.test(h))((await get(editor.jar, "/en")).html));
  const exportPath = `/api/exports/comparison?mode=weekly&current=${CUR}&prior=${PRI}`;
  for (const [name, person] of [["cashier", cashier], ["manager", manager], ["editor", editor], ["viewer", viewer]]) {
    check(`the ${name} cannot download the comparison (403)`, (await get(person.jar, exportPath)).status === 403);
  }
  check("an anonymous download is refused (401)", (await get(new Jar(), exportPath)).status === 401);
  check("the viewer sees no export link", !/data-link="export"/.test((await get(viewer.jar, `/en/comparison?current=${CUR}`)).html));
  {
    const csv = await get(exporter.jar, exportPath);
    check("the exporter downloads it (CSV attachment)", csv.status === 200 && /text\/csv/.test(csv.type), String(csv.status));
    const maarif = csv.html.split(/\r\n/).find((l) => l.startsWith("weekly,maarif,")) ?? "";
    check("the export carries Maarif 120.00 vs 100.00, difference 20.00 and 120.00 %", /,2026-11-17,120\.00,3,available,daily_close,operating_day_revisions:\d+,,2026-11-10,100\.00,2,available,daily_close,operating_day_revisions:\d+,,20\.00,1,120\.00,/.test(maarif), maarif);
    const total = csv.html.split(/\r\n/).find((l) => l.startsWith("weekly,total,")) ?? "";
    check("the export's total is marked incomplete with its coverage", /2\/3 current; 3\/3 prior,no$/.test(total), total);
    check("the export has no NaN or Infinity", !/NaN|Infinity/.test(csv.html));
  }
  // The database refuses the same people directly.
  for (const [name, person] of [["cashier", cashier], ["manager", manager], ["editor", editor], ["exporter", exporter]]) {
    const read = await person.db.from("comparison_entries").select("id");
    const figures = await person.db.from("comparison_figures").select("id");
    const report = await person.db.rpc("app_comparison_report", { p_access: "view", p_branches: ["alquds", "bourgogne"], p_dates: [CUR, PRI] });
    check(`database: the ${name} reads no Al Quds or Bourgogne figure`, !read.error && read.data.length === 0 && !figures.error && figures.data.length === 0 && report.error?.code === "42501",
      JSON.stringify([read.error, figures.error, report.error?.code]));
  }
  {
    const read = await viewer.db.from("comparison_entries").select("id");
    const exp = await viewer.db.rpc("app_comparison_report", { p_access: "export", p_branches: ["alquds"], p_dates: [CUR] });
    check("database: the viewer reads entries (and every revision) but cannot export", !read.error && read.data.length >= 7 && exp.error?.code === "42501", JSON.stringify([read.data?.length, exp.error?.code]));
    const exp2 = await exporter.db.rpc("app_comparison_report", { p_access: "export", p_branches: ["alquds"], p_dates: [PRI] });
    check("database: the exporter exports without viewing", !exp2.error && exp2.data.figures.some((f) => f.branch === "alquds" && f.metric === "net_sales" && Number(f.value) === 8000));
    const write = await viewer.db.rpc("app_comparison_save", { p_branch: "alquds", p_request: crypto.randomUUID(), p_payload: { date: "2026-11-14", sales: "1" } });
    const write2 = await exporter.db.rpc("app_comparison_save", { p_branch: "alquds", p_request: crypto.randomUUID(), p_payload: { date: "2026-11-14", sales: "1" } });
    check("database: viewing and exporting do not grant entering", write.error?.code === "42501" && write2.error?.code === "42501");
    const direct = await editor.db.from("comparison_entries").insert({ branch_id: "00000000-0000-4000-8000-000000000012", business_date: "2026-11-14", metric: "net_sales", source: "reporting_only", purpose: "live", revision: 1, value: 1, request_id: crypto.randomUUID(), request_hash: "\\x00", actor_name: "x" });
    check("database: nobody writes the history table directly", direct.error?.code === "42501", JSON.stringify(direct.error));
  }

  section("4. The weekly comparison");
  for (const locale of ["en", "ar"]) {
    const page = await get(viewer.jar, `/${locale}/comparison?current=${CUR}`);
    const html = page.html;
    const order = ["alquds", "maarif", "bourgogne"].map((b) => html.indexOf(`data-branch="${b}"`));
    check(`[${locale}] Al Quds, Maarif, Bourgogne, then the total`, order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])) && html.indexOf('data-row="total"') > order[2], order.join(","));
    check(`[${locale}] coverage comes before any percentage`, html.indexOf('data-section="coverage"') > 0 && html.indexOf('data-section="coverage"') < html.indexOf('data-table="weekly-comparison"'));
    const maarif = rowOf(html, "data-branch", "maarif");
    check(`[${locale}] Maarif 120 vs 100 from the closed days: +20.00 and 120 %`,
      /120\.00/.test(plainText(colOf(maarif, "current-sales"))) && /100\.00/.test(plainText(colOf(maarif, "prior-sales")))
      && /20\.00/.test(plainText(colOf(maarif, "sales-diff"))) && /120[\s‎‏]*[%٪]/.test(plainText(colOf(maarif, "ratio")))
      && /data-origin="closed_day"/.test(colOf(maarif, "current-sales")), plainText(maarif));
    const alquds = rowOf(html, "data-branch", "alquds");
    check(`[${locale}] Al Quds has no current figure: marked missing, percentage unavailable with its reason`,
      /data-missing="true"/.test(colOf(alquds, "current-sales")) && /data-ratio-unavailable="current_unavailable"/.test(colOf(alquds, "ratio")) && /80\.00/.test(plainText(colOf(alquds, "prior-sales"))));
    const bourgogne = rowOf(html, "data-branch", "bourgogne");
    check(`[${locale}] Bourgogne's recorded 0 prior: difference shown, percentage unavailable (not 0 %, not ∞)`,
      /data-ratio-unavailable="prior_zero"/.test(colOf(bourgogne, "ratio")) && /150\.00/.test(plainText(colOf(bourgogne, "sales-diff"))) && /0\.00/.test(plainText(colOf(bourgogne, "prior-sales"))));
    const total = rowOf(html, "data-row", "total");
    check(`[${locale}] the total is incomplete, shows 2 of 3 and 3 of 3, and no total percentage`,
      /data-incomplete="true"/.test(total) && /data-ratio-unavailable="different_branches"/.test(colOf(total, "ratio"))
      && /2[^0-9]+3/.test(plainText(colOf(total, "current-sales"))) && /3[^0-9]+3/.test(plainText(colOf(total, "prior-sales"))));
    check(`[${locale}] no NaN, Infinity or ∞ on the page`, noNonsense(html));
  }
  {
    const page = await get(viewer.jar, `/en/comparison?current=${CUR}&branches=maarif,bourgogne`);
    const total = rowOf(page.html, "data-row", "total");
    check("a selection of two complete branches totals only them: 270.00 vs 100.00, 270 %",
      /270\.00/.test(plainText(colOf(total, "current-sales"))) && /100\.00/.test(plainText(colOf(total, "prior-sales"))) && /270[\s‎‏]*%/.test(plainText(colOf(total, "ratio"))) && /data-incomplete="false"/.test(total), plainText(total));
    check("and leaves Al Quds out entirely", !page.html.includes('data-branch="alquds"'));
  }
  {
    const history = await get(viewer.jar, `/en/comparison/history?branch=alquds&date=${PRI}`);
    check("the history keeps the earlier revision readable, with the reason", /data-revision="1"[^>]*data-active="false"/.test(history.html) && /data-revision="2"[^>]*data-active="true"/.test(history.html) && plainText(history.html).includes("P7 typo"));
  }

  section("5. The monthly comparison");
  {
    const page = await get(viewer.jar, "/en/comparison?mode=monthly&month=2026-11&branches=maarif");
    const day17 = rowOf(page.html, "data-day", "17");
    check("17 November against 17 October: 120 vs 100 is +20 % growth", /20[\s‎‏]*%/.test(plainText(colOf(day17, "growth"))) && /data-comparable="true"/.test(day17), plainText(day17));
    check("coverage comes first and the month is in progress", page.html.indexOf('data-section="coverage"') < page.html.indexOf('data-table="monthly-period"') && /data-in-progress="true"/.test(page.html));
    check("period growth is like for like over the days entered in both months", /data-comparable-days="1"/.test(page.html) && /20[\s‎‏]*%/.test(plainText(colOf(rowOf(page.html, "data-row", "total"), "growth"))));
    check("Maarif before its first saved business day (17 October) is unavailable, not missing", /data-day="3"[^]*?data-col="prior" data-status="before_live"/.test(page.html));
    const day30 = rowOf(page.html, "data-day", "30");
    check("a day not yet started is shown as such, with no percentage", /data-status="future"/.test(day30) && /data-ratio-unavailable="future"/.test(day30));
    const day31 = rowOf(page.html, "data-day", "31");
    check("31 October has no 31 November: no such day", /data-status="no_such_day"/.test(day31));
    check("no NaN, Infinity or ∞", noNonsense(page.html));
    const csv = await get(exporter.jar, "/api/exports/comparison?mode=monthly&month=2026-11&branches=maarif");
    check("the monthly export carries the 20.00 % growth and the period row", csv.status === 200 && /^monthly,day,17,2026-11-17,120\.00,3,1\/1,complete,2026-10-17,100\.00,2,1\/1,complete,20\.00,,\r?$/m.test(csv.html) && /^monthly,period:total,.*,20\.00,,1\r?$/m.test(csv.html), csv.html.slice(0, 200));
  }

  section("6. First live date, historical figures and settings");
  const settingsPath = "/en/comparison/settings";
  {
    for (const [name, person] of [["viewer", viewer], ["editor", editor], ["manager", manager]]) {
      check(`the ${name} cannot open the settings (403)`, (await get(person.jar, settingsPath)).status === 403);
    }
    let page = await get(admin, settingsPath);
    check("the administrator sees the live source and entry owner as not decided", page.status === 200 && (page.html.match(/data-undecided="true"/g) ?? []).length === 4);
    const added = await post(admin, settingsPath, page.html, "add-source", { key: "pseven_sheet", label_en: "P7 archived sheet", label_ar: "P7 شيت قديم" });
    check("a source designation is added", added.to.includes("notice=comparison_source_added"), added.to);
    page = await get(admin, settingsPath);
    const saved = await post(admin, settingsPath, page.html, "settings-alquds", { live_from: "2026-11-05" });
    check("Al Quds's first live business date is set to 5 November", saved.to.includes("notice=comparison_settings_saved"), saved.to);
    const stale = await post(admin, settingsPath, page.html, "settings-alquds", { live_from: "2026-11-06" });
    check("a second save from the same stale page is refused", stale.to.includes("error=comparison_stale"), stale.to);
    const week = await get(viewer.jar, `/en/comparison?current=${PRI}`);
    check("the seeded Al Quds figure for 3 November is now unavailable (before the first live date)", /data-unavailable="before_live"/.test(colOf(rowOf(week.html, "data-branch", "alquds"), "prior-sales")));
    let entry = await get(editor.jar, entryPath);
    const live = await post(editor.jar, entryPath, entry.html, "entry-alquds", { date: "2026-11-03", source: "pseven_sheet", sales: "70" });
    check("a regular figure before that date is refused", live.to.includes("error=comparison_live_date"), live.to);
    entry = await get(editor.jar, entryPath);
    const hist = await post(editor.jar, entryPath, entry.html, "entry-alquds", { date: "2026-11-03", source: "pseven_sheet", sales: "70", purpose: "historical", reference: "P7 archived sheet, row 6" });
    check("a historical figure with its source is accepted", hist.to.includes("notice=comparison_saved"), hist.to);
    const after = colOf(rowOf((await get(viewer.jar, `/en/comparison?current=${PRI}`)).html, "data-branch", "alquds"), "prior-sales");
    check("it is shown, marked historical and traceable to its source", /70\.00/.test(plainText(after)) && /data-historical="true"/.test(after) && plainText(after).includes("P7 archived sheet, row 6"), plainText(after));
    page = await get(admin, settingsPath);
    const owner = await post(admin, settingsPath, page.html, "settings-alquds", { entry_owner: editor2.id });
    check("an entry owner is configured for Al Quds", owner.to.includes("notice=comparison_settings_saved"), owner.to);
    entry = await get(editor.jar, entryPath);
    check("the first editor is told someone else owns Al Quds entry", /data-owner="other"/.test(entry.html));
    const refused = await post(editor.jar, entryPath, entry.html, "entry-alquds", { date: "2026-11-14", sales: "5" });
    check("and their save is refused", refused.to.includes("error=comparison_not_owner"), refused.to);
    const ownerPage = await get(editor2.jar, entryPath);
    check("the owner is told they own it", /data-owner="me"/.test(ownerPage.html));
    const audit = psql("select count(*) from public.audit_log where action in ('comparison.settings_changed', 'comparison.source_added')");
    check("settings changes are audited", audit === "3", audit);
  }

  section("7. Maarif was never entered twice");
  check("no comparison entry exists for Maarif", psql("select count(*) from public.comparison_entries e join public.branches b on b.id = e.branch_id where b.code = 'maarif'") === "0");
}

main()
  .catch((error) => {
    state.failures += 1;
    console.error(error);
  })
  .finally(() => {
    server.child.kill();
    console.log(`\n${state.checks} checks, ${state.failures} failed.`);
    process.exit(state.failures === 0 ? 0 : 1);
  });
