// Phase 10 operating-day rehearsal over HTTP against the PRODUCTION build and a DISPOSABLE local Supabase stack.
//
//   P10_REFERENCE_FILE=<outputs/phase10/workbook-reference.json> P10_OUTPUT_DIR=<folder> npm run test:phase10
//
// The private reference JSON (real figures from Abdo's workbooks and the 7 November Foodics sample) is written by
// scripts/phase10/extract_reference.py and stays outside Git. The script resets the disposable database, enters
// each figure ONCE through the daily-close, stock, comparison and replenishment commands the pages use, then
// exports the five report families in Arabic and English and keeps the files for the comparison step.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { container } from "../phase3/db-check.mjs";
import { Jar, clientFromJar, createReporter, makeHttp, readForm, run, startServer, submitForm, waitUp } from "../phase3/lib.mjs";
import { addDays, cents, context, denominations, readJson, secret } from "./lib.mjs";

const PORT = process.env.E2E_PORT ?? "3220";
const BASE = `http://127.0.0.1:${PORT}`;
// The scenarios read the downloaded files back, so there is always a folder (a temporary one by default).
const OUT = process.env.P10_OUTPUT_DIR ?? mkdtempSync(path.join(os.tmpdir(), "balaban-phase10-"));
const REFERENCE = process.env.P10_REFERENCE_FILE;
const noReset = process.argv.includes("--no-reset");
if (!REFERENCE) throw new Error("Set P10_REFERENCE_FILE to the private workbook-reference.json (see scripts/phase10/extract_reference.py).");
const reference = readJson(REFERENCE);
const { check, section, state } = createReporter();
const http = makeHttp(BASE);
const ctx = context({ http, base: BASE, container });
const { env, where, psql, get, makeStaff, op } = ctx;
const apiUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
if (container === "supabase_db_balaban-dev" || apiUrl.port === "55321" || !["127.0.0.1", "localhost"].includes(apiUrl.hostname)) {
  throw new Error("test:phase10 resets its database: point it at a disposable local stack (not balaban-dev).");
}
console.log(`Disposable stack: ${container}, API ${apiUrl.origin}`);
if (!noReset) {
  console.log("Rebuilding the disposable database (supabase db reset)...");
  const reset = run("npx", ["supabase", "db", "reset"]);
  if (reset.status !== 0) { console.error(`db reset failed\n${reset.stdout}\n${reset.stderr}`); process.exit(2); }
}
const server = startServer(PORT, { SITE_URL: BASE });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(jar, id) {
  const response = await fetch(new URL(`/api/report-exports/${id}`, BASE), { headers: { cookie: jar.header() }, redirect: "manual" });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes, sha: response.headers.get("x-export-sha256"), type: response.headers.get("content-type") ?? "" };
}
async function requestExport(jar, form, set, locale = "en") {
  const page = await get(jar, `/${locale}/reports/exports`);
  if (!readForm(page.html, form)) return { status: page.status, to: "", id: null, noForm: true };
  const response = await submitForm(http, jar, `/${locale}/reports/exports`, page.html, form, set);
  const to = where(response.headers.get("location"));
  return { status: response.status, to, id: /\/reports\/exports\/([0-9a-f-]{36})/.exec(to)?.[1] ?? null };
}
async function sheetXml(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  return Promise.all(Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort().map((n) => zip.file(n).async("string")));
}

const sales = reference.daily_sales;
const stmt = reference.statement_2026_11_02;

async function main() {
  await waitUp(BASE, server);
  if (OUT) mkdirSync(OUT, { recursive: true });
  const keep = (name, bytes) => { if (OUT) writeFileSync(path.join(OUT, name), bytes); };

  section("0. People: Abdo's account (designated for Excel), cashier, manager, storekeeper, comparison editor");
  const adminEmail = "phase10.abdo@example.test";
  const adminTemp = secret();
  const adminPassword = secret();
  const boot = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", adminEmail, "--name", "P10 Abdo"], { env: { ...env, BOOTSTRAP_ADMIN_PASSWORD: adminTemp } });
  check("bootstrap of the synthetic administrator", boot.status === 0, `${boot.stdout}${boot.stderr}`.slice(0, 300));
  const admin = new Jar();
  {
    const page = await get(admin, "/en/sign-in");
    const signedIn = await submitForm(http, admin, "/en/sign-in", page.html, "sign-in", { email: adminEmail, password: adminTemp });
    const changePage = await get(admin, where(signedIn.headers.get("location")));
    const changed = await submitForm(http, admin, "/en/account/password", changePage.html, "change-password", { password: adminPassword, confirm: adminPassword });
    check("first sign-in forces a new password, then the account is signed in", changed.status === 303, String(changed.status));
  }
  const adminDb = clientFromJar(env, admin);
  const adminId = psql("select user_id from public.staff_accounts where email = 'phase10.abdo@example.test'");
  psql(`insert into app_private.report_export_owners (organization_id, staff_id) select organization_id, user_id from public.staff_accounts where user_id = '${adminId}'`);
  psql(`insert into public.permission_groups (key, description, scope) values ('ptenth_cmp', 'test only: comparison.export', 'branch');
    insert into public.group_permissions (group_key, permission_key) values ('ptenth_cmp', 'comparison.export');`);
  const cashier = await makeStaff("P10 Cashier", [["maarif", "cashier"]]);
  const manager = await makeStaff("P10 Manager", [["maarif", "manager"]]);
  const keeper = await makeStaff("P10 Storekeeper", [["maarif", "storekeeper"]]);
  const editor = await makeStaff("P10 Comparison editor", [["alquds", "comparison_editor"], ["bourgogne", "comparison_editor"]]);
  check("the four staff signed in", [cashier, manager, keeper, editor].every((p) => p.status === 303));

  section("1. October and 1–2 November from the existing workbooks, entered once");
  // Every figure below comes from the owner's Daily Sales workbooks. Per day: card V, bank cash H (the later
  // remittance), expenses including the bank deposit G. Cash receipts = sales − V; other expenses = G − H;
  // the drawer is counted at H. This reproduces the +3 of 2 November and the +1 of 1 November.
  const days = [];
  for (const month of ["2026-10", "2026-11"]) for (const [date, f] of Object.entries(sales[month].days)) days.push([date, f]);
  days.sort(([a], [b]) => a.localeCompare(b));
  let first = true;
  // 2 November is counted with the denominations on the workbook's own count slip (key = face value in centimes).
  const realCount = Object.fromEntries(Object.entries(reference.ledger_2026_11_02.denominations).map(([face, v]) => [String(cents(face)), v.count]));
  const t0 = Date.now();
  for (const [date, f] of days) {
    const posCash = cents(f.sales) - cents(f.card);
    const other = cents(f.expenses_incl_bank) - cents(f.bank_cash);
    const evening = date === "2026-11-02";
    let rev = 0;
    const step = async (db, command, payload) => { await op(db, date, command, rev, payload); rev += 1; };
    await step(cashier.db, "save", { sales: cents(f.sales), posCash, card: cents(f.card), cashier: cashier.id, orders: f.orders, shift: "both",
      ...(first ? { openingCash: 0, openingCustody: 0 } : {}), notes: "Phase 10 rehearsal: figures from the existing Daily Sales workbook" });
    first = false;
    if (evening) {
      for (const line of stmt.expenses.filter((e) => e.label !== "توريد بنك")) await step(cashier.db, "entry", { kind: "cash_expense", amount: cents(line.amount), local: `${date}T21:00`, note: line.label });
    } else if (other > 0) {
      await step(cashier.db, "entry", { kind: "cash_expense", amount: other, local: `${date}T21:00`, note: "expenses (workbook total less bank deposit)" });
    }
    const countLocal = evening ? `${addDays(date, 1)}T01:30` : `${date}T23:30`;
    await step(cashier.db, "count", { counter: manager.id, local: countLocal, quantities: evening ? realCount : denominations(f.bank_cash) });
    await step(cashier.db, "submit", {});
    await step(manager.db, "close", {});
    await step(manager.db, "late_remittance", { amount: cents(f.bank_cash), local: evening ? `${addDays(date, 1)}T03:10` : `${date}T23:50`, reference: `P10-${date}` });
  }
  console.log(`  (${days.length} days entered in ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const closedDays = psql("select count(*) from public.operating_days");
  check(`${days.length} operating days were saved`, Number(closedDays) === days.length, closedDays);

  const report = async (db, date, basis = null) => {
    const { data, error } = await db.rpc("app_operating_report", { p_branch: "maarif", p_date: date, p_month: `${date.slice(0, 7)}-01`, p_basis: basis });
    if (error) throw new Error(`report ${date}: ${error.code} ${error.message}`);
    return data;
  };
  {
    section("1b. Independent reconciliation of every entered day (workbook figures against the saved close)");
    // Independent expectation per day: variance = counted − expected where expected = opening + sales − card − other expenses.
    // The workbook has no opening carry-forward; the application does. Both are reported, never silently merged.
    let carried = 0;
    let mismatch = [];
    let openingDiffs = 0;
    for (const month of ["2026-10", "2026-11"]) {
      const r = await report(manager.db, `${month}-01`);
      for (const day of r.days) {
        const f = sales[month].days[day.date];
        if (!f) continue;
        const workbookVariance = cents(f.expenses_incl_bank) + cents(f.card) - cents(f.sales);
        const s2 = day.summary;
        if (s2.openingCash !== 0) openingDiffs += 1;
        const expectedWithoutOpening = cents(f.sales) - cents(f.card) - (cents(f.expenses_incl_bank) - cents(f.bank_cash));
        if (day.sales !== cents(f.sales) || day.orders !== f.orders || day.card !== cents(f.card) || s2.expected - s2.openingCash !== expectedWithoutOpening
          || s2.variance !== workbookVariance - s2.openingCash) mismatch.push(`${day.date}: expected ${s2.expected} opening ${s2.openingCash} variance ${s2.variance} (workbook ${workbookVariance})`);
        carried += s2.openingCash ? 1 : 0;
      }
    }
    check("every day: sales, orders and card equal the workbook; expected cash and variance follow from them plus the opening", mismatch.length === 0, mismatch.slice(0, 3).join(" | "));
    console.log(`  (${openingDiffs} of ${days.length} days open with a non-zero cash balance carried forward)`);
    const r2 = await report(manager.db, "2026-11-02");
    const d2 = r2.day;
    console.log(`  2 Nov: opening ${d2.summary.openingCash}, expected ${d2.summary.expected}, counted ${d2.data.count.total}, variance ${d2.summary.variance}, closing cash ${d2.summary.closingCash}`);
    check("2 November counted cash matches the Yawmeya", d2.data.count.total === cents(reference.ledger_2026_11_02.counted_total));
    check("2 November variance matches the statement after accounting for the opening balance", d2.summary.variance === cents(stmt.over_short) - d2.summary.openingCash, String(d2.summary.variance));
  }

  section("2. 3, 7 and 10 November: comparison-workbook days and the Foodics sample, entered once");
  const weekly = reference.weekly_comparison_2026_11_10;
  const foodics = reference.foodics_2026_11_07;
  const os = foodics.orders_summary;
  const mad = (v) => cents(v);
  /** Enters a day once. Count = book cash (opening + cash receipts - expenses) because these days' counts were not observed; the whole count is remitted, as on every workbook day. */
  async function closeDay(date, f, notes) {
    let rev = 0;
    const step = async (db, command, payload) => { await op(db, date, command, rev, payload); rev += 1; };
    await step(cashier.db, "save", { sales: mad(f.sales), posCash: mad(f.posCash), card: mad(f.card), cashier: cashier.id, orders: f.orders, shift: "both", notes });
    if (f.void) await step(cashier.db, "cancel_order", { original: "FOODICS-VOID-1", originalAmount: mad(f.void), originalLocal: `${date}T15:00`, local: `${date}T15:05`, note: "Foodics Orders Summary: 1 void" });
    const opening = (await report(manager.db, date)).day.summary.openingCash;
    const counted = opening + mad(f.posCash);
    await step(cashier.db, "count", { counter: manager.id, local: `${date}T23:30`, quantities: denominations(counted / 100) });
    await step(cashier.db, "submit", {});
    await step(manager.db, "close", {});
    await step(manager.db, "late_remittance", { amount: counted, local: `${date}T23:50`, reference: `P10-${date}` });
    return { opening, counted };
  }
  const w = weekly;
  await closeDay("2026-11-03", { sales: w.maarif.prior_sales, posCash: w.maarif.prior_sales, card: 0, orders: w.maarif.prior_orders }, "Phase 10 rehearsal: weekly-comparison workbook figure; cash/card split not in that workbook");
  const day7 = await closeDay("2026-11-07", { sales: os.net_sales, posCash: os.cash_sales_receipts, card: os.visa_sales_receipts, orders: os.orders_count_from_report, void: os.void_amount },
    "Phase 10 rehearsal: 7 November Foodics Orders Summary sample (count, expenses and opening float were not observed; counted = expected)");
  await closeDay("2026-11-10", { sales: w.maarif.sales, posCash: w.maarif.sales, card: 0, orders: w.maarif.orders }, "Phase 10 rehearsal: weekly-comparison workbook figure; cash/card split not in that workbook");
  {
    const r = await report(manager.db, "2026-11-07");
    const d = r.days.find((x) => x.date === "2026-11-07");
    check("7 November: net sales, orders, cash and card match Foodics", d.sales === cents(os.net_sales)
      && d.orders === os.orders_count_from_report && d.card === cents(os.visa_sales_receipts)
      && r.day.data.posCash === cents(os.cash_sales_receipts));
    check("7 November: average order value and card share match Foodics inputs",
      r.day.summary.average === Math.round(cents(os.net_sales) / os.orders_count_from_report)
      && r.day.summary.cardRatio === Math.round(cents(os.visa_sales_receipts) * 10000 / cents(os.net_sales)));
    console.log(`  7 Nov: average ${r.day.summary.average}, card ratio ${r.day.summary.cardRatio}, opening ${r.day.summary.openingCash}, counted ${day7.counted}`);
    check("7 November: one void recorded at the amount reported by Foodics", r.day.data.cancellations.length === 1
      && r.day.data.cancellations[0].originalAmount === cents(os.void_amount));
    check("the missing days 4–6 and 8–9 November are not days (blank, not zero)", !r.days.some((x) => ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-08", "2026-11-09"].includes(x.date)));
  }

  const post = async (person, pathname, html, form, set) => {
    const response = await submitForm(http, person, pathname, html, form, set);
    return { status: response.status, to: where(response.headers.get("location")) };
  };
  const mixSections = foodics.product_mix.sections;
  section("3. Product Mix of 7 November (Foodics sample) and stock: reconcile, lock, post");
  {
    const date = "2026-11-07";
    const cmd = (db, command, payload) => db.rpc("app_stock_command", { p_branch: "maarif", p_date: date, p_command: command, p_request: crypto.randomUUID(), p_payload: payload })
      .then(({ data, error }) => { if (error) throw new Error(`stock ${command}: ${error.code} ${error.message}`); return data; });
    let r = await cmd(keeper.db, "mix_save", { net_sales: String(mad(os.net_sales)), local: `${date}T23:00` });
    for (const sec of mixSections) r = await cmd(keeper.db, "mix_section", { label: sec.readable_label_ar, total: String(mad(sec.amount)), version: r.version });
    for (const [i, sec] of mixSections.entries()) {
      let qty = sec.quantity;
      let amount = Number(sec.amount);
      if (sec.section_id === "M08") {
        for (const [label, q, a] of [["كيكة الهبة دبي شيكولاتة كبير", 109, 5450], ["كيكة الهبة دبي صوص كيندر كبير", 2, 100]]) {
          r = await cmd(keeper.db, "mix_line", { section_no: i + 1, label, quantity: String(q), amount: String(mad(a)), version: r.version });
          qty -= q; amount -= a;
        }
      }
      r = await cmd(keeper.db, "mix_line", { section_no: i + 1, label: `(${sec.section_id} remainder, not itemised in the sample)`, quantity: String(qty), amount: String(mad(amount)), version: r.version });
    }
    const mixPath = `/en/inventory/product-mix?date=${date}`;
    const page = await get(keeper.jar, mixPath);
    check("the Product Mix sections and their lines reconcile to net sales", /data-reconciled="true"/.test(page.html));
    const lock = await post(keeper.jar, mixPath, page.html, "mix_lock");
    check("the Product Mix locks", lock.to.includes("notice=stock_saved"), lock.to);
    const posted = await post(keeper.jar, mixPath, (await get(keeper.jar, mixPath)).html, "post_consumption");
    const after = await get(keeper.jar, mixPath);
    const blocked = (after.html.match(/data-line-status="blocked"/g) ?? []).length;
    const postedLines = (after.html.match(/data-line-status="posted"/g) ?? []).length;
    console.log(`  post_consumption -> ${posted.to || posted.status}; lines blocked ${blocked}, posted ${postedLines}`);
    check("the Dubai cake lines stay blocked until Abdo approves their recipes (recipe_not_approved); nothing real is consumed",
      /data-mix-line="كيكة الهبة دبي شيكولاتة كبير" data-line-status="blocked"/.test(after.html) && postedLines === 0);
    check("the same Product Mix reads in Arabic, right to left", (await get(keeper.jar, `/ar/inventory/product-mix?date=${date}`)).html.includes('dir="rtl"'));
  }
  const item = psql("select id from public.catalog_items where kind = 'ingredient' and stock_tracked and status = 'active' and base_unit is not null order by (base_unit = 'kg') desc, name_ar limit 1");
  {
    const stock = async (db, date, command, payload) => {
      const { error } = await db.rpc("app_stock_command", { p_branch: "maarif", p_date: date, p_command: command, p_request: crypto.randomUUID(), p_payload: payload });
      if (error) throw new Error(`stock ${command}: ${error.code} ${error.message}`);
    };
    await stock(adminDb, "2026-11-06", "opening", { item, quantity: "10", local: "2026-11-06T09:00" });
    await stock(keeper.db, "2026-11-07", "movement", { kind: "receipt", item, quantity: "5", local: "2026-11-07T09:00" });
    await stock(keeper.db, "2026-11-07", "movement", { kind: "waste", item, quantity: "0.25", local: "2026-11-07T15:00" });
    await stock(keeper.db, "2026-11-07", "count", { item, quantity: "14.5", local: "2026-11-07T23:00" });
    check("stock: 10 + 5 - 0.25 = 14.75 book, then a count of 14.5",
      psql(`select sum(direction * quantity_num::numeric / quantity_den) = 14.75 from public.stock_movements where item_id = '${item}' and kind <> 'count'`) === "t");
  }

  section("4. Three branches: the weekly comparison of 10 November against 3 November");
  {
    const cmpSave = async (branch, payload) => {
      let { error } = await editor.db.rpc("app_comparison_save", { p_branch: branch, p_request: crypto.randomUUID(), p_payload: payload });
      // The local seed already holds synthetic figures for some days; the workbook figure then enters as a correction with a reason.
      if (error?.code === "23505") ({ error } = await editor.db.rpc("app_comparison_save", { p_branch: branch, p_request: crypto.randomUUID(), p_payload: { ...payload, mode: "correct", reason: "Phase 10: workbook figure replaces the seed figure" } }));
      if (error) throw new Error(`comparison ${branch}: ${error.code} ${error.message}`);
    };
    for (const branch of ["alquds", "bourgogne"]) {
      const b = weekly[branch];
      await cmpSave(branch, { date: "2026-11-03", sales: String(mad(b.prior_sales)), orders: String(b.prior_orders), reference: "Phase 10 rehearsal: weekly-comparison workbook" });
      await cmpSave(branch, { date: "2026-11-10", sales: String(mad(b.sales)), orders: String(b.orders), reference: "Phase 10 rehearsal: weekly-comparison workbook" });
    }
    const page = await get(admin, "/en/comparison?current=2026-11-10&prior=2026-11-03");
    check("the comparison page opens for the administrator", page.status === 200, String(page.status));
  }

  section("5. Order planning, approval and a partial receipt");
  {
    const plan = await get(keeper.jar, "/en/replenishment");
    check("planning is in the insufficient-history review state (no minimum decided, no first live date)", /data-status="review"/.test(plan.html));
    const newPage = await get(keeper.jar, "/en/replenishment/orders/new");
    const created = await post(keeper.jar, "/en/replenishment/orders/new", newPage.html, "po-create", { "item.0": item, "quantity.0": "10", "source.0": "factory", "unit.0": "" });
    const orderId = created.to.split("/orders/")[1]?.split("?")[0];
    check("the storekeeper creates a manual order of 10", created.to.includes("notice=po_create") && !!orderId, created.to);
    const orderPath = `/en/replenishment/orders/${orderId}`;
    check("nothing can be received before approval", !readForm((await get(keeper.jar, orderPath)).html, "po-receive"));
    const approved = await post(admin, orderPath, (await get(admin, orderPath)).html, "po-approve");
    check("the administrator account approves it", approved.to.includes("notice=po_approve"), approved.to);
    const firstReceipt = await post(keeper.jar, orderPath, (await get(keeper.jar, orderPath)).html, "po-receive", { "quantity.0": "4", reference: "Phase 10 delivery note" });
    check("a partial receipt of 4 of 10 is saved", firstReceipt.to.includes("notice=po_receive"), firstReceipt.to);
    check("one stock movement was created and a receiving form is still offered for the 6 outstanding",
      psql(`select count(*) from public.purchase_order_receipt_lines rl join public.purchase_order_receipts r on r.id = rl.receipt_id where r.order_id = '${orderId}'`) === "1"
      && readForm((await get(keeper.jar, orderPath)).html, "po-receive") !== null);
    const ar = await get(keeper.jar, `/ar${orderPath.slice(3)}`);
    check("the Arabic order page shows the same order right to left", ar.status === 200 && ar.html.includes('dir="rtl"'));
  }

  section("6. All five report families, in Arabic and English, from the same saved data");
  const exports = {};
  {
    const cases = [
      ["sales_comparison_week", "export-sales_comparison-week", { current: "2026-11-10", prior: "2026-11-03" }],
      ["sales_comparison_month", "export-sales_comparison-month", { month: "2026-11" }],
      ["daily_sales_2026-10", "export-daily_sales-month", { month: "2026-10" }],
      ["daily_sales_2026-11", "export-daily_sales-month", { month: "2026-11" }],
      ["daily_statement_2026-11-02", "export-daily_statement-day", { date: "2026-11-02" }],
      ["daily_statement_2026-11", "export-daily_statement-month", { month: "2026-11" }],
      ["daily_ledger_2026-11-02", "export-daily_ledger-day", { date: "2026-11-02" }],
      ["daily_ledger_2026-11", "export-daily_ledger-month", { month: "2026-11" }],
      ["inventory_2026-11-07", "export-inventory-day", { date: "2026-11-07" }],
      ["inventory_2026-11", "export-inventory-month", { month: "2026-11" }],
    ];
    for (const locale of ["ar", "en"]) {
      for (const [key, form, set] of cases) {
        const result = await requestExport(admin, form, { ...set, workbook_locale: locale }, locale);
        check(`${key} (${locale}): requested and complete`, result.status === 303 && result.to.includes("notice=export_complete") && !!result.id, `${result.status} ${result.to}`);
        if (!result.id) continue;
        const file = await download(admin, result.id);
        exports[`${key}_${locale}`] = { id: result.id, sha: sha(file.bytes) };
        keep(`${key}_${locale}.xlsx`, file.bytes);
        const xml = (await sheetXml(file.bytes)).join("\n");
        check(`${key} (${locale}): xlsx with its recorded SHA-256, values only, ${locale === "ar" ? "right-to-left" : "left-to-right"}`,
          file.status === 200 && file.sha === sha(file.bytes) && !/<f[\s>]/.test(xml) && !/\bt="e"/.test(xml) && (locale === "ar") === /rightToLeft="1"/.test(xml));
      }
    }
  }

  if (!process.argv.includes("--no-scenarios")) {
    section("7. Next day, month boundary, missing dates, an earlier correction, interrupted and competing saves, export during a correction");
    // Month boundary: 1 November opens with exactly what 31 October closed with (both are real workbook days).
    const oct31 = (await report(manager.db, "2026-10-31")).days.find((d) => d.date === "2026-10-31");
    const nov1 = (await report(manager.db, "2026-11-01")).days.find((d) => d.date === "2026-11-01");
    check("month boundary: 1 November opens with the cash 31 October closed with", nov1.summary.openingCash === oct31.summary.closingCash, `${nov1.summary.openingCash} vs ${oct31.summary.closingCash}`);
    const octXml = (await sheetXml(readFileSync(path.join(OUT, "daily_sales_2026-10_en.xlsx")))).join("");
    const novXml = (await sheetXml(readFileSync(path.join(OUT, "daily_sales_2026-11_en.xlsx")))).join("");
    const octSalesCell = `<v>${sales["2026-10"].days["2026-10-31"].sales}</v>`;
    const novSalesCell = `<v>${sales["2026-11"].days["2026-11-01"].sales}</v>`;
    check("month boundary: the October and November files contain their own boundary sales", octXml.includes(octSalesCell)
      && !octXml.includes(novSalesCell) && novXml.includes(novSalesCell) && !novXml.includes(octSalesCell));
    // Next business day after a gap: 11 November opens with what 10 November closed with.
    const nov10 = (await report(manager.db, "2026-11-10")).days.find((d) => d.date === "2026-11-10");
    await op(cashier.db, "2026-11-11", "save", 0, { sales: 100000, posCash: 70000, card: 30000, cashier: cashier.id, orders: 10, shift: "both" });
    const nov11 = (await report(manager.db, "2026-11-11")).days.find((d) => d.date === "2026-11-11");
    check("the next day opens with the previous closing cash", nov11.summary.openingCash === nov10.summary.closingCash, `${nov11.summary.openingCash} vs ${nov10.summary.closingCash}`);
    // The current carry-forward rule requires posting in date order.
    let late = null;
    try { await op(cashier.db, "2026-11-04", "save", 0, { sales: 100000, posCash: 100000, card: 0, cashier: cashier.id, orders: 10, shift: "both" }); } catch (error) { late = error; }
    console.log(`  entering the skipped 4 November after 7 and 10 November were closed: ${late ? `refused ${late.code} ${late.message.slice(0, 120)}` : "accepted"}`);
    check("back-filling a skipped day is refused by the current posting rule", late?.code === "22023"
      && late.message.includes("Cannot insert a day before an already posted day")
      && !(await report(manager.db, "2026-11-04")).days.some((day) => day.date === "2026-11-04"));

    // Interrupted save: the browser lost the answer and sends the same request again.
    const request = crypto.randomUUID();
    const first = await op(cashier.db, "2026-11-12", "save", 0, { sales: 5000, posCash: 5000, card: 0, cashier: cashier.id, orders: 1, shift: "both" }, request);
    const again = await op(cashier.db, "2026-11-12", "save", 0, { sales: 5000, posCash: 5000, card: 0, cashier: cashier.id, orders: 1, shift: "both" }, request);
    check("an interrupted save returns the original revision and basis on retry", psql("select count(*) from public.operating_day_revisions r join public.operating_days d on d.id = r.day_id where d.business_date = '2026-11-12'") === "1"
      && first?.basis != null && first.revision === again?.revision && first.basis === again?.basis);
    // A save built on an outdated page is refused, not merged.
    let stale = null;
    try { await op(cashier.db, "2026-11-12", "save", 0, { sales: 9999, posCash: 9999, card: 0, cashier: cashier.id, orders: 1, shift: "both" }); } catch (error) { stale = error; }
    check("a save made from an outdated page is refused with the revision conflict code", stale?.code === "40001", String(stale?.code));
    check("and the saved figure is still the first one (50.00)", (await report(manager.db, "2026-11-12")).day.data.sales === 5000);

    // Competing edits to one day: two people press Save at the same time on revision 0.
    const racers = await Promise.allSettled([
      op(cashier.db, "2026-11-13", "save", 0, { sales: 1111, posCash: 1111, card: 0, cashier: cashier.id, orders: 1, shift: "both" }),
      op(cashier.db, "2026-11-13", "save", 0, { sales: 2222, posCash: 2222, card: 0, cashier: cashier.id, orders: 1, shift: "both" }),
    ]);
    const won = racers.filter((r) => r.status === "fulfilled").length;
    const lostCodes = racers.filter((r) => r.status === "rejected").map((r) => r.reason.code ?? r.reason.message.slice(0, 80));
    console.log(`  competing saves: ${won} accepted, other outcome(s): ${lostCodes.join(", ") || "none"}`);
    check("two simultaneous saves on the same revision accept exactly one", won === 1);
    check("the loser is told it conflicted (40001) rather than overwriting", lostCodes.length === 1 && lostCodes[0] === "40001", lostCodes.join(","));
    check("one revision exists for the day", psql("select count(*) from public.operating_day_revisions r join public.operating_days d on d.id = r.day_id where d.business_date = '2026-11-13'") === "1");

    // An earlier correction (1 November, already carried into 2 November) and an export taken while it is pending.
    const before = await requestExport(admin, "export-daily_sales-month", { month: "2026-11", workbook_locale: "en" });
    const beforeBytes = (await download(admin, before.id)).bytes;
    keep("daily_sales_2026-11_before_correction_en.xlsx", beforeBytes);
    const day1 = (await report(manager.db, "2026-11-01")).day;
    const varianceBeforeCorrection = (await report(manager.db, "2026-11-02")).day.summary.variance;
    const proposal = { change: "save", reason: "Phase 10 rehearsal: earlier day corrected", sales: day1.data.sales + 10000, posCash: day1.data.posCash + 10000, card: day1.data.card, cashier: cashier.id, orders: day1.data.orders, shift: "both" };
    const correctedSalesCell = `<v>${proposal.sales / 100}</v>`;
    await op(manager.db, "2026-11-01", "propose", day1.revision, proposal);
    const during = await requestExport(admin, "export-daily_sales-month", { month: "2026-11", workbook_locale: "en" });
    const duringBytes = (await download(admin, during.id)).bytes;
    const duringXml = (await sheetXml(duringBytes)).join("");
    check("an export taken while a correction is only proposed shows the effective (uncorrected) figures",
      duringXml.includes(novSalesCell) && !duringXml.includes(correctedSalesCell));
    await op(manager.db, "2026-11-01", "approve", day1.revision + 1, {});
    const afterOne = await requestExport(admin, "export-daily_sales-month", { month: "2026-11", workbook_locale: "en" });
    const afterBytes = (await download(admin, afterOne.id)).bytes;
    keep("daily_sales_2026-11_after_correction_en.xlsx", afterBytes);
    check("the earlier file is byte-for-byte what it was before the correction", sha((await download(admin, before.id)).bytes) === sha(beforeBytes));
    check("the new export reflects the corrected 1 November and records a later revision basis",
      (await sheetXml(afterBytes)).join("").includes(correctedSalesCell)
      && Number(psql(`select sources ->> 'operating_basis' from public.report_exports where id = '${afterOne.id}'`)) > Number(psql(`select sources ->> 'operating_basis' from public.report_exports where id = '${before.id}'`)));
    const nov2 = (await report(manager.db, "2026-11-02")).day;
    console.log(`  after the 1 Nov correction: 2 Nov opening ${nov2.summary.openingCash}, stored variance ${nov2.summary.variance}, closing cash ${nov2.summary.closingCash}`);
    check("an earlier correction does not rewrite 2 November's saved count variance", nov2.summary.variance === varianceBeforeCorrection, String(nov2.summary.variance));
  }

  if (OUT) writeFileSync(path.join(OUT, "ENTERED_DAYS.json"), JSON.stringify(days.map(([d]) => d)));
}

main()
  .catch((error) => { state.failures += 1; console.error(error); })
  .finally(() => {
    server.child.kill();
    console.log(`\n${state.checks} checks, ${state.failures} failures${state.names.length ? `: ${state.names.join("; ")}` : ""}`);
    process.exit(state.failures === 0 ? 0 : 1);
  });

void sha;
