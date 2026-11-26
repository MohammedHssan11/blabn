// Phase 9 end-to-end checks over HTTP against the PRODUCTION build and a DISPOSABLE local Supabase stack.
//
//   npm run build && npm run test:phase9            (P9_OUTPUT_DIR=<folder> keeps the downloaded workbooks)
//
// Refuses the main development stack (supabase_db_balaban-dev / port 55321): it resets the database,
// creates synthetic people, closes synthetic Maarif days through the daily-close commands, enters
// reporting-only Al Quds and Bourgogne figures, posts stock, and then exports all five report families
// through the real forms in Arabic and English. It checks:
//   - every family builds, is stored privately, downloads with its recorded SHA-256 and holds values only
//     (no formula, external link or error value), right-to-left in Arabic;
//   - Arabic and English files of the same data carry the same figures; shared values agree across reports;
//   - an earlier export is unchanged after a source correction, and a new export reflects it;
//   - a failed export (storage refused) is retryable and ends with exactly one completed file;
//   - downloads fail after the permission is removed, and for another person;
//   - a person cannot export a branch they hold no export permission for;
//   - drafts appear only in a draft export by a person allowed to export drafts;
//   - historical reporting-only figures appear in the comparison only and change no live balance or stock.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { container } from "../phase3/db-check.mjs";
import { Jar, clientFromJar, createReporter, loadEnv, makeHttp, plainText, readForm, run, serviceClient, startServer, submitForm, waitUp } from "../phase3/lib.mjs";

const PORT = process.env.E2E_PORT ?? "3219";
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.P9_OUTPUT_DIR ?? null;
const noReset = process.argv.includes("--no-reset");
const { check, section, state } = createReporter();
const secret = () => `${randomBytes(9).toString("base64url")}-Aa1`;
const env = loadEnv();
const apiUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
if (container === "supabase_db_balaban-dev" || apiUrl.port === "55321" || !["127.0.0.1", "localhost"].includes(apiUrl.hostname)) {
  throw new Error("test:phase9 resets its database: point it at a disposable local stack (not balaban-dev).");
}
console.log(`Disposable stack: ${container}, API ${apiUrl.origin}`);

if (!noReset) {
  console.log("Rebuilding the disposable database (supabase db reset)...");
  const reset = run("npx", ["supabase", "db", "reset"]);
  if (reset.status !== 0) {
    console.error(`db reset failed\n${reset.stdout}\n${reset.stderr}`);
    process.exit(2);
  }
}
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
  return { status: response.status, location: response.headers.get("location"), html: await response.text() };
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(jar, id) {
  const response = await fetch(new URL(`/api/report-exports/${id}`, BASE), { headers: { cookie: jar.header() }, redirect: "manual" });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes, type: response.headers.get("content-type") ?? "", sha: response.headers.get("x-export-sha256"),
    disposition: response.headers.get("content-disposition") ?? "", cache: response.headers.get("cache-control") };
}

/** Values-only scan of a workbook and its numeric cells per sheet (the same rules as src/modules/exports/scan.ts). */
async function inspect(bytes, locale) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const problems = [];
  if (names.some((n) => n.includes("externalLink"))) problems.push("external link");
  const sheets = names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml/.exec(a)[1]) - Number(/(\d+)\.xml/.exec(b)[1]));
  const numbers = [];
  for (const name of sheets) {
    const xml = await zip.file(name).async("string");
    if (/<f[\s>]/.test(xml)) problems.push(`formula in ${name}`);
    if (/<c\b[^>]*\bt="e"/.test(xml)) problems.push(`error value in ${name}`);
    const rtl = /<sheetView\b[^>]*rightToLeft="1"/.test(xml);
    if ((locale === "ar") !== rtl) problems.push(`direction of ${name}`);
    if (!/<pageSetup\b[^>]*paperSize="9"/.test(xml)) problems.push(`page setup of ${name}`);
    numbers.push([...xml.matchAll(/<c\b([^>]*)><v>([^<]*)<\/v><\/c>/g)].filter((m) => !/\bt="/.test(m[1])).map((m) => m[2]));
  }
  const strings = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const workbook = await zip.file("xl/workbook.xml").async("string");
  const sheetNames = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
  return { problems, numbers, strings, sheetNames };
}

/** Requests an export through the real form of a family; returns the export id and where the action went. */
async function requestExport(jar, form, set) {
  const page = await get(jar, "/en/reports/exports");
  if (!readForm(page.html, form)) return { status: page.status, to: "", id: null, noForm: true };
  const response = await submitForm(http, jar, "/en/reports/exports", page.html, form, set);
  const to = where(response.headers.get("location"));
  const id = /\/reports\/exports\/([0-9a-f-]{36})/.exec(to)?.[1] ?? null;
  return { status: response.status, to, id, html: page.html };
}

async function main() {
  await waitUp(BASE, server);
  if (OUT) mkdirSync(OUT, { recursive: true });
  const saved = {};
  const keep = (name, bytes) => { if (OUT) { writeFileSync(path.join(OUT, name), bytes); saved[name] = path.join(OUT, name); } };

  section("0. Synthetic people");
  const adminEmail = "phase9.admin@example.test";
  const adminTemp = secret();
  const adminPassword = secret();
  const boot = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", adminEmail, "--name", "P9 Admin"], { env: { ...env, BOOTSTRAP_ADMIN_PASSWORD: adminTemp } });
  check("bootstrap of the synthetic administrator", boot.status === 0, `${boot.stdout}${boot.stderr}`.slice(0, 300));
  const admin = new Jar();
  {
    const page = await get(admin, "/en/sign-in");
    const signedIn = await submitForm(http, admin, "/en/sign-in", page.html, "sign-in", { email: adminEmail, password: adminTemp });
    const changePage = await get(admin, where(signedIn.headers.get("location")));
    const changed = await submitForm(http, admin, "/en/account/password", changePage.html, "change-password", { password: adminPassword, confirm: adminPassword });
    check("the administrator chooses a password", changed.status === 303, String(changed.status));
  }
  const adminDb = clientFromJar(env, admin);
  const adminId = psql("select user_id from public.staff_accounts where email = 'phase9.admin@example.test'");
  const beforeDesignation = await get(admin, "/en/reports/exports");
  check("a System Admin has no Excel forms before designation", beforeDesignation.html.includes('data-empty="families"'));
  psql(`insert into app_private.report_export_owners (organization_id, staff_id)
    select organization_id, user_id from public.staff_accounts where user_id = '${adminId}'`);
  psql(`insert into public.permission_groups (key, description, scope) values ('pnine_cmp', 'test only: comparison.export', 'branch');
    insert into public.group_permissions (group_key, permission_key) values ('pnine_cmp', 'comparison.export');`);
  async function makeStaff(name, assignments) {
    const email = `p9.${randomBytes(4).toString("hex")}@example.test`;
    const password = secret();
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`could not create ${name}`);
    const id = created.data.user.id;
    const rows = assignments.map(([branch, group]) => branch === null
      ? `insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('${id}', null, '${group}');`
      : `insert into public.branch_memberships(staff_id, branch_id) select '${id}', id from public.branches where code = '${branch}' on conflict do nothing;
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
  const cashier = await makeStaff("P9 Cashier", [["maarif", "cashier"]]);
  const manager = await makeStaff("P9 Manager", [["maarif", "manager"]]);
  const editor = await makeStaff("P9 Editor", [["alquds", "comparison_editor"], ["bourgogne", "comparison_editor"]]);
  const quds = await makeStaff("P9 Al Quds Exporter", [["alquds", "pnine_cmp"]]);
  const admin2 = await makeStaff("P9 Second Admin", [[null, "system_admin"]]);
  check("six synthetic people exist (administrator and five staff)", Number(psql("select count(*) from public.employees where full_name like 'P9 %'")) === 6);

  section("1. Synthetic saved data (daily close, comparison entries, stock)");
  const op = async (db, date, command, expected, payload) => {
    const { data, error } = await db.rpc("app_operating_command", { p_branch: "maarif", p_date: date, p_command: command, p_expected_revision: expected, p_request: crypto.randomUUID(), p_payload: payload });
    if (error) throw new Error(`${command} ${date}: ${error.code} ${error.message}`);
    return data;
  };
  // 2 November: 1,234.50 MAD, 15 orders, card 300.00, a cash expense with formula-like text, a cancellation,
  // a count of 887.50 (expected 884.50: +3.00) and a bank remittance after the count.
  await op(cashier.db, "2026-11-02", "save", 0, { sales: 123450, posCash: 93450, card: 30000, cashier: cashier.id, orders: 15, morning: 50000, evening: 73450, shift: "both", openingCash: 0, openingCustody: 0 });
  await op(cashier.db, "2026-11-02", "entry", 1, { kind: "cash_expense", amount: 5000, local: "2026-11-02T12:00", note: "=SUM(1)+\"P9 fruit\"" });
  await op(cashier.db, "2026-11-02", "cancel_order", 2, { original: "SYN-901", originalAmount: 2500, originalLocal: "2026-11-02T10:00", local: "2026-11-02T10:05", replacement: "SYN-902", replacementAmount: 2100, note: "@P9 wrong size" });
  await op(cashier.db, "2026-11-02", "count", 3, { counter: manager.id, local: "2026-11-02T22:00", quantities: { 20000: 4, 5000: 1, 2000: 1, 1000: 1, 100: 7, 50: 1, 500: 0 } });
  await op(cashier.db, "2026-11-02", "submit", 4, {});
  await op(manager.db, "2026-11-02", "close", 5, {});
  await op(manager.db, "2026-11-02", "late_remittance", 6, { amount: 88750, local: "2026-11-02T23:30", reference: "BANK-P9-1" });
  // Days are entered in date order; 18 November stays a draft (closing goes in date order).
  for (const [date, sales, orders, draft] of [["2026-11-03", 10000, 2], ["2026-11-10", 10000, 2], ["2026-11-17", 12000, 3], ["2026-11-18", 7777, 1, true]]) {
    await op(cashier.db, date, "save", 0, { sales, posCash: sales, card: 0, cashier: cashier.id, orders });
    if (draft) continue;
    await op(cashier.db, date, "count", 1, { counter: manager.id, local: `${date}T22:00`, quantities: { 100: sales / 100 } });
    await op(cashier.db, date, "submit", 2, {});
    await op(manager.db, date, "close", 3, {});
  }
  check("five Maarif days: four closed, one draft", psql("select count(*) from public.operating_days") === "5");
  const cmpSave = async (branch, payload) => {
    const { error } = await editor.db.rpc("app_comparison_save", { p_branch: branch, p_request: crypto.randomUUID(), p_payload: payload });
    if (error) throw new Error(`comparison ${branch}: ${error.code} ${error.message}`);
  };
  // Amounts in centimes, as the entry form sends them. The local seed already holds Al Quds 10 Nov (96.00).
  await cmpSave("alquds", { date: "2026-11-17", sales: "15000", orders: "5" });
  await cmpSave("bourgogne", { date: "2026-11-17", sales: "20000", orders: "6" });
  await cmpSave("bourgogne", { date: "2026-11-10", sales: "0", orders: "0" });
  const item = psql("select id from public.catalog_items where kind = 'ingredient' and stock_tracked and status = 'active' and base_unit is not null order by (base_unit = 'kg') desc, name_ar limit 1");
  const stock = async (date, command, payload) => {
    const { error } = await adminDb.rpc("app_stock_command", { p_branch: "maarif", p_date: date, p_command: command, p_request: crypto.randomUUID(), p_payload: payload });
    if (error) throw new Error(`stock ${command}: ${error.code} ${error.message}`);
  };
  await stock("2026-11-01", "opening", { item, quantity: "10", local: "2026-11-01T09:00" });
  await stock("2026-11-02", "movement", { kind: "receipt", item, quantity: "5", local: "2026-11-02T09:00" });
  await stock("2026-11-02", "movement", { kind: "waste", item, quantity: "0.25", local: "2026-11-02T15:00" });
  await stock("2026-11-02", "count", { item, quantity: "14.5", local: "2026-11-02T23:00" });
  check("stock posted: 10 + 5 − 0.25 = 14.75, counted 14.5",
    psql(`select sum(direction * quantity_num::numeric / quantity_den) = 14.75 from public.stock_movements where item_id = '${item}'`) === "t");

  section("2. The export page and who sees which report");
  for (const locale of ["en", "ar"]) {
    const anon = await get(new Jar(), `/${locale}/reports/exports`);
    check(`/${locale}/reports/exports: anonymous visitors are sent to sign in`, anon.status === 307 && where(anon.location).startsWith(`/${locale}/sign-in`), String(anon.status));
    const page = await get(admin, `/${locale}/reports/exports`);
    check(`/${locale}: the administrator sees all five report families`, page.status === 200 && ["sales_comparison", "daily_sales", "daily_statement", "daily_ledger", "inventory"].every((f) => page.html.includes(`data-family="${f}"`)));
    check(`/${locale}: the page direction follows the language`, page.html.includes(`dir="${locale === "ar" ? "rtl" : "ltr"}"`));
  }
  const cashierPage = await get(cashier.jar, "/en/reports/exports");
  check("the cashier is offered no report family", cashierPage.status === 200 && cashierPage.html.includes('data-empty="families"'));
  const qudsPage = await get(quds.jar, "/en/reports/exports");
  check("the branch export grant alone gives no Excel forms", qudsPage.status === 200 && qudsPage.html.includes('data-empty="families"'));
  const nav = await get(admin, "/ar");
  check("the menu links to the Excel reports", nav.html.includes('href="/ar/reports/exports"'));

  section("3. Every family builds, stores privately, downloads and holds values only");
  const exports = {};
  const cases = [
    ["sales_weekly_ar", "export-sales_comparison-week", { current: "2026-11-17", prior: "2026-11-10", workbook_locale: "ar" }],
    ["sales_weekly_en", "export-sales_comparison-week", { current: "2026-11-17", prior: "2026-11-10", workbook_locale: "en" }],
    ["sales_monthly_ar", "export-sales_comparison-month", { month: "2026-11", workbook_locale: "ar" }],
    ["daily_sales_ar", "export-daily_sales-month", { month: "2026-11", workbook_locale: "ar" }],
    ["daily_sales_en", "export-daily_sales-month", { month: "2026-11", workbook_locale: "en" }],
    ["daily_statement_ar", "export-daily_statement-month", { month: "2026-11", workbook_locale: "ar" }],
    ["daily_statement_day_en", "export-daily_statement-day", { date: "2026-11-02", workbook_locale: "en" }],
    ["daily_ledger_ar", "export-daily_ledger-month", { month: "2026-11", workbook_locale: "ar" }],
    ["daily_ledger_en", "export-daily_ledger-month", { month: "2026-11", workbook_locale: "en" }],
    ["inventory_day_ar", "export-inventory-day", { date: "2026-11-02", workbook_locale: "ar" }],
    ["inventory_month_en", "export-inventory-month", { month: "2026-11", workbook_locale: "en" }],
  ];
  for (const [key, form, set] of cases) {
    const r = await requestExport(admin, form, set);
    check(`${key}: requested and complete`, r.status === 303 && r.to.includes("notice=export_complete") && r.id, `${r.status} ${r.to}`);
    if (!r.id) continue;
    const file = await download(admin, r.id);
    const locale = set.workbook_locale;
    const info = await inspect(file.bytes, locale);
    exports[key] = { id: r.id, bytes: file.bytes, info };
    keep(`${key}.xlsx`, file.bytes);
    check(`${key}: downloads as xlsx, not cached, with its recorded SHA-256`, file.status === 200 && file.type.startsWith("application/vnd.openxmlformats") && file.cache === "no-store"
      && file.sha === sha(file.bytes) && /attachment; filename="[a-z0-9-]+\.xlsx"/.test(file.disposition), `${file.status} ${file.type}`);
    check(`${key}: values only, ${locale === "ar" ? "right-to-left" : "left-to-right"}, A4`, info.problems.length === 0, info.problems.join("; "));
    const record = psql(`select status || '|' || template_version || '|' || calc_version || '|' || (sources is not null) || '|' || file_sha256 from public.report_exports where id = '${r.id}'`);
    check(`${key}: the record holds the template, rule versions, sources and file hash`, record.startsWith("complete|") && record.endsWith(`|true|${sha(file.bytes)}`), record);
  }
  check("files are private: the bucket is not public and holds one object per completed export",
    psql("select (select public from storage.buckets where id = 'report-exports')::text || ':' || (select count(*) from storage.objects where bucket_id = 'report-exports') || ':' || (select count(*) from public.report_exports where status = 'complete')") === `false:${cases.length}:${cases.length}`);
  {
    const anon = await fetch(new URL(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/report-exports/x`));
    check("no public URL serves export files", anon.status >= 400, String(anon.status));
  }

  section("4. Same figures in Arabic and English; shared values agree");
  for (const family of ["sales_weekly", "daily_sales", "daily_ledger"]) {
    const ar = exports[`${family}_ar`]?.info;
    const en = exports[`${family}_en`]?.info;
    check(`${family}: Arabic and English carry identical numbers in every sheet`, !!ar && !!en && JSON.stringify(ar.numbers) === JSON.stringify(en.numbers));
    check(`${family}: same data fingerprint in both languages`, psql(`select count(distinct data_sha256) from public.report_exports where id in ('${exports[`${family}_ar`]?.id}', '${exports[`${family}_en`]?.id}')`) === "1");
  }
  const has = (key, value) => (exports[key]?.info.numbers ?? []).some((sheet) => sheet.includes(value));
  check("1,234.50 MAD of 2 November is the same in Daily Sales, the statement and the Yawmeya", ["daily_sales_ar", "daily_statement_ar", "daily_statement_day_en", "daily_ledger_ar"].every((k) => has(k, "1234.5")));
  check("Daily Sales: average order value 82.30 (1,234.50 ÷ 15)", has("daily_sales_ar", "82.3"));
  check("statement: the saved over/short +3.00 and the later remittance 887.50", has("daily_statement_day_en", "3") && has("daily_statement_day_en", "887.5"));
  check("Maarif 120.00 vs 100.00 in the weekly comparison", has("sales_weekly_ar", "120") && has("sales_weekly_ar", "100"));
  check("weekly total ratio = summed current ÷ summed prior: 470 ÷ 196 = 239.80 %", has("sales_weekly_ar", "2.398"));
  check("the draft day (77.77) is not in a final Daily Sales file", !has("daily_sales_ar", "77.77"));
  check("formula-like text is kept as text", (exports.daily_statement_day_en?.info.strings ?? "").includes("=SUM(1)+&quot;P9 fruit&quot;"));
  check("the cancellation's references are literal text", (exports.daily_ledger_en?.info.strings ?? "").includes("@P9 wrong size"));
  check("Arabic sheet names in the Arabic file", (exports.daily_ledger_ar?.info.sheetNames ?? []).includes("ملخص") && (exports.daily_ledger_ar?.info.sheetNames ?? []).includes("حول التقرير"));
  check("inventory: exact book balance 14.75, count 14.5, deviation −0.25", has("inventory_day_ar", "14.75") && has("inventory_day_ar", "14.5") && has("inventory_day_ar", "-0.25"));

  section("5. An earlier export stays unchanged after a correction; a new export reflects it");
  {
    const before = exports.daily_sales_ar;
    const basisBefore = psql(`select sources ->> 'operating_basis' from public.report_exports where id = '${before.id}'`);
    await op(manager.db, "2026-11-02", "propose", 7, { change: "save", reason: "P9 synthetic correction", sales: 133450, posCash: 103450, card: 30000, cashier: cashier.id, orders: 15, morning: 50000, evening: 83450, shift: "both" });
    await op(manager.db, "2026-11-02", "approve", 8, {});
    const again = await download(admin, before.id);
    check("the earlier file downloads byte-for-byte as before", again.status === 200 && sha(again.bytes) === sha(before.bytes));
    check("its record still names the earlier revision basis", psql(`select sources ->> 'operating_basis' from public.report_exports where id = '${before.id}'`) === basisBefore);
    const page = await get(admin, `/en/reports/exports/${before.id}`);
    check("its provenance stays reviewable on its page", page.status === 200 && page.html.includes(`&quot;operating_basis&quot;: ${basisBefore}`) && page.html.includes("daily_sales@1.0.1"));
    const after = await requestExport(admin, "export-daily_sales-month", { month: "2026-11", workbook_locale: "ar" });
    const file = await download(admin, after.id);
    const info = await inspect(file.bytes, "ar");
    keep("daily_sales_after_correction_ar.xlsx", file.bytes);
    check("the new export reflects the correction (1,334.50)", info.numbers.some((s) => s.includes("1334.5")) && !info.numbers.some((s) => s.includes("1234.5")));
    check("the new export records a later revision basis", Number(psql(`select sources ->> 'operating_basis' from public.report_exports where id = '${after.id}'`)) > Number(basisBefore));
  }

  section("6. A failed export is retryable and ends with one completed file");
  {
    psql("update storage.buckets set allowed_mime_types = array['text/plain'] where id = 'report-exports';");
    const page = await get(admin, "/en/reports/exports");
    const form = "export-daily_ledger-day";
    const first = await submitForm(http, admin, "/en/reports/exports", page.html, form, { date: "2026-11-02", workbook_locale: "en" });
    const to = where(first.headers.get("location"));
    const id = /\/reports\/exports\/([0-9a-f-]{36})/.exec(to)?.[1];
    check("storage refused: the export is failed, not complete", to.includes("error=export_failed") && psql(`select status || ':' || coalesce(last_error, '') || ':' || (file_path is null) from public.report_exports where id = '${id}'`) === "failed:storage_failed:true", to);
    check("nothing was stored for it", psql(`select count(*) from storage.objects where name like '%${id}%'`) === "0");
    check("the failed export cannot be downloaded", (await download(admin, id)).status === 404);
    psql("update storage.buckets set allowed_mime_types = array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] where id = 'report-exports';");
    const detail = await get(admin, `/en/reports/exports/${id}`);
    const retried = await submitForm(http, admin, `/en/reports/exports/${id}`, detail.html, "retry");
    check("retry completes it", where(retried.headers.get("location")).includes("notice=export_complete"));
    const replay = await submitForm(http, admin, "/en/reports/exports", page.html, form, { date: "2026-11-02", workbook_locale: "en" });
    check("re-sending the original form returns the same export, not a second one", where(replay.headers.get("location")).includes(`/reports/exports/${id}?notice=export_replayed`), where(replay.headers.get("location")));
    const again = await submitForm(http, admin, `/en/reports/exports/${id}`, detail.html, "retry");
    check("retrying a completed export builds nothing new", where(again.headers.get("location")).includes("notice=export_complete"));
    check("exactly one completed file and one stored object", psql(`select count(*) from public.report_exports where id = '${id}' and status = 'complete'`) === "1"
      && psql(`select count(*) from storage.objects where name like '%${id}%'`) === "1");
    check("history: started 1, failed 1, started 2, completed 2", psql(`select string_agg(event || ':' || attempt, ',' order by id) from public.report_export_events where export_id = '${id}' and event in ('started', 'failed', 'completed')`) === "started:1,failed:1,started:2,completed:2");
    const payload = { p_family: "daily_sales", p_branches: ["maarif"], p_period: { mode: "month", month: "2026-11" },
      p_locale: "ar", p_include_drafts: false, p_request: crypto.randomUUID() };
    const requests = await Promise.all(Array.from({ length: 4 }, () => adminDb.rpc("app_report_export_request", payload)));
    check("concurrent submissions return one export with one original request", requests.every((r) => !r.error && r.data.id === requests[0].data?.id)
      && requests.filter((r) => r.data?.replayed === false).length === 1, requests.map((r) => r.error?.code ?? r.data?.replayed).join(", "));
  }

  section("6b. An interrupted build can be retried; the inventory file holds the whole period's orders");
  {
    const { data: record, error } = await adminDb.rpc("app_report_export_request", { p_family: "daily_sales", p_branches: ["maarif"],
      p_period: { mode: "month", month: "2026-11" }, p_locale: "en", p_include_drafts: false, p_request: crypto.randomUUID() });
    if (error) throw new Error(`request: ${error.code} ${error.message}`);
    await adminDb.rpc("app_report_export_claim", { p_export: record.id });
    const path = `/en/reports/exports/${record.id}`;
    const fresh = await get(admin, path);
    const busy = await submitForm(http, admin, path, fresh.html, "retry");
    check("a build claimed just now answers busy to a retry", where(busy.headers.get("location")).includes("error=export_busy"), where(busy.headers.get("location")));
    psql(`update public.report_exports set claimed_at = now() - interval '11 minutes' where id = '${record.id}'`);
    const stale = await get(admin, path);
    const list = await get(admin, "/en/reports/exports");
    const listRow = list.html.slice(list.html.indexOf(`data-export="${record.id}"`)).split("</tr>")[0];
    check("an interrupted build still shown as building offers a retry, on its page and in the list",
      /data-status="running"/.test(stale.html) && readForm(stale.html, "retry") !== null && /data-form="retry"/.test(listRow));
    const retried = await submitForm(http, admin, path, stale.html, "retry");
    check("the retry takes it over and completes it as attempt 2", where(retried.headers.get("location")).includes("notice=export_complete")
      && psql(`select status || ':' || attempt from public.report_exports where id = '${record.id}'`) === "complete:2", where(retried.headers.get("location")));

    // An order of an earlier month whose delivery is expected later in the current month, after today.
    const [today, monthEnd, earlier] = psql(`select d || '|' || (date_trunc('month', d) + interval '1 month - 1 day')::date || '|' || (date_trunc('month', d) - interval '20 days')::date
      from (select public.business_date_of(now(), timezone, business_day_rollover) as d from public.branches where code = 'maarif') x`).split("|");
    if (today < monthEnd) {
      const item = psql("select id from public.catalog_items where kind = 'ingredient' and stock_tracked and status = 'active' and base_unit is not null order by name_ar limit 1");
      const { data: order, error: orderError } = await adminDb.rpc("app_purchase_order_command", { p_branch: "maarif", p_command: "import_legacy", p_request: crypto.randomUUID(),
        p_payload: { expected_date: monthEnd, source_value: "synthetic", created_date: earlier, lines: [{ item, quantity: "2", source: "factory" }] } });
      if (orderError) throw new Error(`legacy order: ${orderError.code} ${orderError.message}`);
      const result = await requestExport(admin, "export-inventory-month", { month: today.slice(0, 7), workbook_locale: "en" });
      check("the month's inventory file includes an earlier order expected later this month", psql(`select exists (select 1 from jsonb_array_elements_text(sources -> 'orders') o
        where o like 'PO-${order.order_no}:%') from public.report_exports where id = '${result.id}'`) === "t", result.to);
    } else {
      console.log("  (today is the last day of the month: the later-this-month order case does not apply)");
    }
  }

  section("7. Abdo only, live revocation, and no signed download URLs");
  {
    const id = exports.daily_sales_ar.id;
    const filePath = psql(`select file_path from public.report_exports where id = '${id}'`);
    const storage = adminDb.storage.from("report-exports");
    const other = await requestExport(admin2.jar, "export-daily_statement-day", { date: "2026-11-02" });
    check("another System Admin is offered no Excel forms", other.noForm);
    const { error: otherError } = await admin2.db.rpc("app_report_export_request", { p_family: "daily_statement", p_branches: ["maarif"],
      p_period: { mode: "day", date: "2026-11-02" }, p_locale: "ar", p_include_drafts: true, p_request: crypto.randomUUID() });
    check("another System Admin cannot request a draft through the database", otherError?.code === "42501");
    check("the designated requester can download it", (await download(admin, id)).status === 200);
    check("another System Admin cannot download it", (await download(admin2.jar, id)).status === 404);
    check("the cashier cannot download it", (await download(cashier.jar, id)).status === 404);
    check("an anonymous visitor cannot download it", (await download(new Jar(), id)).status === 401);
    const publicRead = await fetch(new URL(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/report-exports/${filePath}`));
    check("the actual stored file has no public download", !publicRead.ok, String(publicRead.status));
    const signed = await storage.createSignedUrl(filePath, 60);
    check("even the designated account cannot sign a bearer URL", !!signed.error && !signed.data);
    psql(`delete from app_private.report_export_owners where staff_id = '${adminId}'`);
    const refused = await download(admin, id);
    check("after the designation is removed the download fails (403)", refused.status === 403, String(refused.status));
    const direct = await storage.download(filePath);
    check("Storage refuses direct authenticated access too", !!direct.error && !direct.data);
    const page = await get(admin, `/en/reports/exports/${id}`);
    check("the record stays visible to them with a not-allowed notice", page.status === 200 && page.html.includes('data-result="not-allowed"'));
    psql(`insert into app_private.report_export_owners (organization_id, staff_id)
      select organization_id, user_id from public.staff_accounts where user_id = '${adminId}'`);
    psql(`delete from public.staff_group_assignments where staff_id = '${adminId}' and group_key = 'system_admin'`);
    check("the designation alone gives no download after role revocation", (await download(admin, id)).status === 403);
    check("Storage also denies the requester after role revocation", !!(await storage.download(filePath)).error);
    psql(`insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('${adminId}', null, 'system_admin')`);
  }

  section("8. No export of a branch without its permission");
  {
    psql(`update app_private.report_export_owners set staff_id = '${quds.id}' where staff_id = '${adminId}'`);
    const limitedPage = await get(quds.jar, "/en/reports/exports");
    const limitedForm = readForm(limitedPage.html, "export-sales_comparison-week") ?? [];
    check("the designated branch-limited account sees only the Al Quds comparison",
      limitedForm.some(([name, value]) => name === "branches" && value === "alquds")
      && !limitedForm.some(([name, value]) => name === "branches" && value !== "alquds")
      && !limitedPage.html.includes('data-family="daily_sales"'));
    const ok = await requestExport(quds.jar, "export-sales_comparison-week", { current: "2026-11-17", prior: "2026-11-10", workbook_locale: "en" });
    check("the Al Quds exporter exports Al Quds", ok.to.includes("notice=export_complete") && psql(`select branch_codes::text from public.report_exports where id = '${ok.id}'`) === "{alquds}", ok.to);
    const count = psql("select count(*) from public.report_exports");
    const page = await get(quds.jar, "/en/reports/exports");
    const forged = await submitForm(http, quds.jar, "/en/reports/exports", page.html, "export-sales_comparison-week", { branches: ["alquds", "bourgogne"], workbook_locale: "en" });
    check("a form forged for Bourgogne too is refused and nothing is created", !where(forged.headers.get("location")).includes("notice=export_complete")
      && psql("select count(*) from public.report_exports") === count, `${forged.status} ${where(forged.headers.get("location"))}`);
    const forged2 = await submitForm(http, quds.jar, "/en/reports/exports", page.html, "export-sales_comparison-week", { branches: "maarif", workbook_locale: "en" });
    check("a form forged for Maarif is refused", !where(forged2.headers.get("location")).includes("notice=export_complete") && psql("select count(*) from public.report_exports") === count, String(forged2.status));
    const { error } = await quds.db.rpc("app_report_export_request", { p_family: "sales_comparison", p_branches: ["bourgogne"], p_period: { mode: "month", month: "2026-11" }, p_locale: "en", p_include_drafts: false, p_request: crypto.randomUUID() });
    check("the database refuses it as well (42501)", error?.code === "42501");
    const { error: e2 } = await manager.db.rpc("app_report_export_request", { p_family: "daily_ledger", p_branches: ["maarif"], p_period: { mode: "month", month: "2026-11" }, p_locale: "en", p_include_drafts: false, p_request: crypto.randomUUID() });
    check("the manager (no reports.export) cannot export the Yawmeya", e2?.code === "42501");
    psql(`update app_private.report_export_owners set staff_id = '${adminId}' where staff_id = '${quds.id}'`);
  }

  section("9. Draft exports only where allowed");
  {
    const r = await requestExport(admin, "export-daily_sales-month", { month: "2026-11", workbook_locale: "en", drafts: "1" });
    const file = await download(admin, r.id);
    const info = await inspect(file.bytes, "en");
    keep("daily_sales_draft_en.xlsx", file.bytes);
    check("a draft export includes the draft day (77.77) and is marked draft", info.numbers.some((s) => s.includes("77.77")) && psql(`select include_drafts from public.report_exports where id = '${r.id}'`) === "t");
    const { error } = await cashier.db.rpc("app_report_export_request", { p_family: "daily_sales", p_branches: ["maarif"], p_period: { mode: "month", month: "2026-11" }, p_locale: "en", p_include_drafts: true, p_request: crypto.randomUUID() });
    check("the cashier (draft export but no reports.export) cannot export Excel", error?.code === "42501");
  }

  section("10. Historical reporting-only figures change no live balance");
  {
    const before = psql("select (app_private.operating_openings(b.id, '2026-11-30', (select max(id) from public.operating_day_revisions))).cash from public.branches b where code = 'maarif'");
    const stockBefore = psql(`select sum(direction * quantity_num::numeric / quantity_den) from public.stock_movements where item_id = '${item}'`);
    const revisionsBefore = psql("select count(*) from public.operating_day_revisions");
    const { error: se } = await adminDb.rpc("app_comparison_settings_save", { p_branch: "bourgogne", p_expected: 0, p_live_source: null, p_entry_owner: null, p_live_from: "2026-11-05" });
    check("Bourgogne's first live date is 5 November", !se, se?.message);
    const { error: ae } = await adminDb.rpc("app_comparison_add_source", { p_key: "pnine_sheet", p_label_en: "P9 archived sheet", p_label_ar: "P9 شيت قديم" });
    check("a source designation for the archived figures is added", !ae, ae?.message);
    await cmpSave("bourgogne", { date: "2026-11-03", source: "pnine_sheet", sales: "7000", orders: "2", purpose: "historical", reference: "P9 archived sheet, synthetic row 6" });
    const { error: me } = await editor.db.rpc("app_comparison_save", { p_branch: "maarif", p_request: crypto.randomUUID(), p_payload: { date: "2026-10-20", sales: "1", purpose: "historical", reference: "x" } });
    check("no reporting-only figure can be entered for Maarif (its figures come from the close)", me?.code === "42501");
    const r = await requestExport(admin, "export-sales_comparison-week", { current: "2026-11-10", prior: "2026-11-03", workbook_locale: "en" });
    const file = await download(admin, r.id);
    const info = await inspect(file.bytes, "en");
    keep("sales_weekly_historical_en.xlsx", file.bytes);
    check("the historical figure appears in the comparison, marked with its reference", info.numbers.some((s) => s.includes("70")) && info.strings.includes("P9 archived sheet, synthetic row 6") && info.strings.includes("Historical, reporting only"));
    check("the export records it as historical", Number(psql(`select sources ->> 'historical_figures' from public.report_exports where id = '${r.id}'`)) >= 1);
    check("the Maarif cash carry-forward is unchanged", psql("select (app_private.operating_openings(b.id, '2026-11-30', (select max(id) from public.operating_day_revisions))).cash from public.branches b where code = 'maarif'") === before);
    check("no daily-close revision was written", psql("select count(*) from public.operating_day_revisions") === revisionsBefore);
    check("stock is unchanged", psql(`select sum(direction * quantity_num::numeric / quantity_den) from public.stock_movements where item_id = '${item}'`) === stockBefore);
    const ds = await requestExport(admin, "export-daily_sales-month", { month: "2026-11", workbook_locale: "en" });
    const dsInfo = await inspect((await download(admin, ds.id)).bytes, "en");
    check("Daily Sales (Maarif) holds no Bourgogne figure", !dsInfo.strings.includes("P9 archived sheet") && !dsInfo.numbers.some((s) => s.includes("70")));
  }

  section("11. Audit and history");
  check("every request and completion is audited", Number(psql("select count(*) from public.audit_log where target_type = 'report_export'")) >= 2 * cases.length);
  check("downloads are recorded", Number(psql("select count(*) from public.report_export_events where event = 'downloaded'")) >= cases.length);
  check("the refused download after designation revocation is recorded", psql(`select count(*) from public.report_export_events
    where export_id = '${exports.daily_sales_ar.id}' and event = 'refused'`) === "1");
  if (OUT) console.log(`\nWorkbooks saved in ${OUT}:\n${Object.keys(saved).map((k) => `  ${k}`).join("\n")}`);
}

main()
  .catch((error) => {
    state.failures += 1;
    console.error(error);
  })
  .finally(() => {
    server.child.kill();
    console.log(`\n${state.checks} checks, ${state.failures} failures${state.names.length ? `: ${state.names.join("; ")}` : ""}`);
    process.exit(state.failures === 0 ? 0 : 1);
  });

void plainText;
