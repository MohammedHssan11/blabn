// Phase 8 end-to-end checks over HTTP against the PRODUCTION build and the LOCAL Supabase instance.
//
//   npm run build && npm run test:phase8
//
// Rebuilds the local database (supabase db reset; --no-reset skips it), starts the built application,
// bootstraps a synthetic System Admin and drives the real planning, purchase-order and receiving
// forms the way a browser without JavaScript does. Dates are relative to the database's own business
// date, so the checks hold on any day. Synthetic staff and items only; passwords are random and never printed.
import { randomBytes } from "node:crypto";
import { container } from "../phase3/db-check.mjs";
import {
  Jar, clientFromJar, createReporter, loadEnv, makeHttp, plainText, readForm, run, serviceClient, startServer, submitForm, waitUp,
} from "../phase3/lib.mjs";

const PORT = process.env.E2E_PORT ?? "3208";
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
async function post(jar, pathname, html, form, set = {}) {
  const response = await submitForm(http, jar, pathname, html, form, set);
  return { status: response.status, to: where(response.headers.get("location")) };
}
const addDays = (date, n) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
/** The table row (by data-item / data-line) and a cell of it (by data-col). */
const rowOf = (html, name, attr = "data-item") => {
  const start = html.indexOf(`${attr}="${name}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</tr>", start));
};
const cell = (row, col) => {
  const start = row.indexOf(`data-col="${col}"`);
  return start < 0 ? "" : row.slice(start, row.indexOf("</td>", start));
};
const q = (html, value) => html.includes(`data-q="${value}"`);
/** The same page with a new request identifier in every form (a new request from an old page). */
const fresh = (html) => html.replace(/name="request" value="[^"]+"/g, () => `name="request" value="${crypto.randomUUID()}"`);
/** A forged server-action POST is refused: Next answers 403 or its 404 interrupt page, never a success redirect. */
const refused = (r) => (r.status === 403 || r.status === 404) && !r.to.includes("notice=");

async function main() {
  await waitUp(BASE, server);
  // The business date and branch-local time come from PostgreSQL (Phase 4 rule: 02:00, Africa/Casablanca).
  const [D, NOW] = psql(`select public.business_date_of(now(), timezone, business_day_rollover)::text || '|' ||
    to_char(now() at time zone timezone, 'YYYY-MM-DD"T"HH24:MI') from public.branches where code = 'maarif'`).split("|");
  const E = addDays(D, 2);
  // A local time on the business date D that is not in the future.
  const LOCAL_D = NOW.slice(0, 10) === D ? NOW : `${D}T23:00`;
  console.log(`Business date ${D}, now ${NOW}, default expected receipt ${E}.`);

  section("0. Synthetic people");
  const adminEmail = "po.admin@example.test";
  const adminTemp = secret();
  const adminPassword = secret();
  const boot = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", adminEmail, "--name", "PO Admin"], { env: { ...env, BOOTSTRAP_ADMIN_PASSWORD: adminTemp } });
  check("bootstrap of the synthetic administrator", boot.status === 0, `${boot.stdout}${boot.stderr}`.slice(0, 300));
  const admin = new Jar();
  {
    const page = await get(admin, "/en/sign-in");
    const signedIn = await submitForm(http, admin, "/en/sign-in", page.html, "sign-in", { email: adminEmail, password: adminTemp });
    const changePage = await get(admin, where(signedIn.headers.get("location")));
    const changed = await submitForm(http, admin, "/en/account/password", changePage.html, "change-password", { password: adminPassword, confirm: adminPassword });
    check("the administrator chooses a password", changed.status === 303, String(changed.status));
  }
  async function makeStaff(role, name) {
    const email = `${role}.${randomBytes(4).toString("hex")}@example.test`;
    const password = secret();
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`could not create ${role}`);
    const id = created.data.user.id;
    psql(`begin;
      insert into public.employees(id, organization_id, full_name) select '${id}', organization_id, '${name}' from public.branches where code = 'maarif';
      insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, '${email}' from public.employees where id = '${id}';
      insert into public.branch_memberships(staff_id, branch_id) select '${id}', id from public.branches where code = 'maarif';
      insert into public.staff_group_assignments(staff_id, branch_id, group_key) select '${id}', id, '${role}' from public.branches where code = 'maarif';
      commit;`);
    const jar = new Jar();
    const page = await get(jar, "/en/sign-in");
    await submitForm(http, jar, "/en/sign-in", page.html, "sign-in", { email, password });
    return { id, email, jar };
  }
  const cashier = await makeStaff("cashier", "PO Cashier");
  const keeper = await makeStaff("storekeeper", "PO Keeper");
  const manager = await makeStaff("manager", "PO Manager");

  section("1. Synthetic catalog and three weeks of posted Product Mix");
  const adminDb = clientFromJar(env, admin);
  const keeperDb = clientFromJar(env, keeper.jar);
  const call = (db) => async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
    return data;
  };
  const rpc = call(adminDb);
  const krpc = call(keeperDb);
  const item = (kind, name, unit) => rpc("app_catalog_save_item", { p_id: null, p_kind: kind, p_name_ar: name, p_name_en: null, p_code: null, p_section: null,
    p_base_unit: unit, p_sales_unit: null, p_purchase_unit: null, p_storage_unit: null, p_is_add_on: false, p_expected_version: null });
  const X = await item("ingredient", "E8 مكون", "pc");
  const Z = await item("ingredient", "E8 مكون استلام", "pc");
  const other = await item("ingredient", "E8 مكون آخر", "pc");
  for (const [cakeName, component] of [["E8 كيكة", X], ["E8 كيكة أخرى", other]]) {
    const cake = await item("sold", cakeName, null);
    await rpc("app_catalog_map_name", { p_source: "foodics", p_label: cakeName, p_item: cake, p_decision: "approve", p_basis: "e2e" });
    const v = await rpc("app_catalog_create_recipe", { p_product: cake, p_label: `${cakeName} v1`, p_copy_from: null, p_note: null });
    await rpc("app_catalog_save_recipe_line", { p_version: v, p_line: null, p_component: component, p_quantity: "1", p_unit: "pc", p_note: null, p_expected_version: 1 });
    await rpc("app_catalog_approve_recipe", { p_version: v, p_from: addDays(D, -60), p_to: null, p_expected_version: 2 });
  }
  // First live date 30 days ago (the Phase 7 per-branch setting).
  await rpc("app_comparison_settings_save", { p_branch: "maarif", p_expected: 0, p_live_source: null, p_entry_owner: null, p_live_from: addDays(D, -30) });
  async function mixDay(date, lines, lock = true) {
    const local = date === D ? LOCAL_D : `${date}T21:00`;
    const cmd = (command, payload) => krpc("app_stock_command", { p_branch: "maarif", p_date: date, p_command: command, p_request: crypto.randomUUID(), p_payload: payload });
    let r = await cmd("mix_save", { net_sales: String(100 * lines.length), local });
    r = await cmd("mix_section", { label: "E8", total: String(100 * lines.length), version: r.version });
    for (const [label, qty] of lines) r = await cmd("mix_line", { section_no: 1, label, quantity: qty, amount: "100", version: r.version });
    if (lock) {
      await cmd("mix_lock", { version: r.version });
      await cmd("post_consumption", {});
    }
  }
  // Same weekday as the receipt (D+2): D-5, D-12, D-19 with 20, 18, 22 cakes -> forecast 20. D-26 is saved
  // but not locked: missing, so it is left out (counting it as 0 would give 15).
  await mixDay(addDays(D, -19), [["E8 كيكة", "22"]]);
  await mixDay(addDays(D, -12), [["E8 كيكة", "18"]]);
  await mixDay(addDays(D, -5), [["E8 كيكة", "20"]]);
  await mixDay(addDays(D, -26), [["E8 كيكة", "40"]], false);
  // Same weekday as tomorrow (D+1): complete days without X sold -> X forecast 0 for tomorrow.
  for (const k of [-20, -13, -6]) await mixDay(addDays(D, k), [["E8 كيكة أخرى", "1"]]);
  // Today is posted too.
  await mixDay(D, [["E8 كيكة أخرى", "1"]]);
  // Book stock of X today: 7 (an ordinary Phase 6 receipt of 60 + 7).
  await krpc("app_stock_command", { p_branch: "maarif", p_date: D, p_command: "movement", p_request: crypto.randomUUID(),
    p_payload: { kind: "receipt", item: X, quantity: "67", local: LOCAL_D } });
  check("history posted and X has 7 in stock today",
    psql(`select sum(direction * quantity_num / quantity_den)::int from public.stock_movements where item_id = '${X}'`) === "7");

  section("2. Who can open the replenishment pages");
  const pages = ["/replenishment", `/replenishment/items/${X}`, "/replenishment/orders"];
  for (const locale of ["en", "ar"]) {
    for (const page of [...pages, "/replenishment/orders/new", "/replenishment/settings"]) {
      const anon = await get(new Jar(), `/${locale}${page}`);
      check(`/${locale}${page}: anonymous visitors are sent to sign in`, anon.status === 307 && where(anon.location).startsWith(`/${locale}/sign-in`), String(anon.status));
      const denied = await get(cashier.jar, `/${locale}${page}`);
      check(`/${locale}${page}: the cashier is refused`, denied.status === 403, String(denied.status));
    }
    for (const page of pages) {
      for (const [name, person] of [["storekeeper", keeper.jar], ["manager", manager.jar], ["administrator", admin]]) {
        const ok = await get(person, `/${locale}${page}`);
        const dir = locale === "ar" ? "rtl" : "ltr";
        check(`/${locale}${page}: the ${name} reads it (${dir})`, ok.status === 200 && ok.html.includes(`<html lang="${locale}" dir="${dir}">`), String(ok.status));
      }
    }
    check(`/${locale}: creating needs purchase_order.propose (manager refused, storekeeper allowed)`,
      (await get(manager.jar, `/${locale}/replenishment/orders/new`)).status === 403 && (await get(keeper.jar, `/${locale}/replenishment/orders/new`)).status === 200);
    check(`/${locale}: settings are for the administrator only`,
      (await get(keeper.jar, `/${locale}/replenishment/settings`)).status === 403 && (await get(admin, `/${locale}/replenishment/settings`)).status === 200);
  }
  check("the storekeeper's menu lists Replenishment; the cashier's does not",
    /href="\/en\/replenishment"/.test((await get(keeper.jar, "/en")).html) && !/href="\/en\/replenishment"/.test((await get(cashier.jar, "/en")).html));

  section("3. Settings start undecided: review state, and a manual order stays possible");
  {
    const plan = await get(keeper.jar, "/en/replenishment");
    const row = rowOf(plan.html, "E8 مكون");
    check("the minimum is not decided: X is in review with no recommendation",
      /data-status="review"/.test(row) && /data-reason="minimum_unset"/.test(row) && /data-qty="blank"/.test(cell(row, "recommended")), row.slice(0, 300));
    check("the dates panel shows today's business date, the 02:00 cutoff and the default receipt (business date + 2)",
      plan.html.includes(`data-date="${D}"`) && plan.html.includes(`data-date="${E}"`) && plainText(plan.html).includes("02:00 · Africa/Casablanca"));
    check("the planning page links to a manual order", /data-link="manual-order"/.test(plan.html));
    const settings = await get(admin, "/en/replenishment/settings");
    check("settings show the three questions still open for Abdo (safety stock and the 02:00 boundary are decided), in plain Arabic in both languages",
      (settings.html.match(/data-question=/g) ?? []).length === 3 && /يا عبده/.test(settings.html) && /يا عبده/.test((await get(admin, "/ar/replenishment/settings")).html));
    check("the safety-stock percentage starts at the approved default of 20", /name="safety_percent"[^>]*value="20"/.test(settings.html));
    const badPercent = await post(admin, "/en/replenishment/settings", settings.html, "branch-settings", { min_observations: "3", coverage_days: "1", safety_percent: "120" });
    check("a percentage above 100 is refused", badPercent.to.includes("error=invalid_input"), badPercent.to);
    const saved = await post(admin, "/en/replenishment/settings", settings.html, "branch-settings", { min_observations: "3", coverage_days: "1", safety_percent: "25" });
    check("the administrator sets the minimum to 3 and safety stock to 25 % (test values; Abdo decides the real ones)", saved.to.includes("notice=po_settings_saved"), saved.to);
    const itemPage = await get(admin, `/en/replenishment/settings?item=${X}`);
    check("the item settings form no longer asks for a per-item safety quantity", !/name="safety"/.test(itemPage.html));
    const s2 = await post(admin, "/en/replenishment/settings", itemPage.html, "item-settings", { pack: "", min_order: "", shelf_life_days: "", source: "factory" });
    check("and the factory as X's source", s2.to.includes("notice=po_settings_saved"), s2.to);
    const stale = await post(admin, "/en/replenishment/settings", settings.html, "branch-settings", { min_observations: "4", coverage_days: "1", safety_percent: "25" });
    check("a stale settings form is refused", stale.to.includes("error=po_stale"), stale.to);
  }

  section("4. A manual order: Wednesday-style dates, approval, and the formula 20 + 5 − 7 − 3 = 15");
  let incomingOrder;
  {
    const page = await get(keeper.jar, "/en/replenishment/orders/new");
    check("the new-order page shows the business date and the default expected receipt", page.html.includes(`data-default-expected="${E}"`));
    const bad = await post(keeper.jar, "/en/replenishment/orders/new", page.html, "po-create", { "item.0": X, "quantity.0": "،", "source.0": "factory", "unit.0": "" });
    check("a non-numeric quantity («،») is refused", bad.to.includes("error=invalid_input"), bad.to);
    const r = await post(keeper.jar, "/en/replenishment/orders/new", page.html, "po-create", { "item.0": X, "quantity.0": "3", "source.0": "factory", "unit.0": "" });
    check("the storekeeper creates an order of 3", r.to.includes("notice=po_create"), r.to);
    incomingOrder = r.to.split("/orders/")[1]?.split("?")[0];
    const order = await get(keeper.jar, `/en/replenishment/orders/${incomingOrder}`);
    check("business date today, original and current expected receipt = business date + 2, no receipt yet",
      /data-kv="business-date"[\s\S]*?data-date="/.test(order.html) && order.html.includes(`data-date="${D}"`)
      && psql(`select business_date || '|' || (select expected_date from public.purchase_order_expected_dates where order_id = o.id and revision = 1)
               from public.purchase_orders o where id = '${incomingOrder}'`) === `${D}|${E}`, order.html.slice(0, 0));
    const createdLocal = psql(`select replace(created_local, 'T', ' ') from public.purchase_orders where id = '${incomingOrder}'`);
    const events = order.html.slice(order.html.indexOf('data-section="events"'));
    check("event times use the branch-local clock of PostgreSQL (the creation event shows the creation time)", events.includes(createdLocal), createdLocal);
    check("the creation instant is kept separately from the business date",
      psql(`select created_at is not null and created_local is not null from public.purchase_orders where id = '${incomingOrder}'`) === "t");
    check("the storekeeper sees no approval form", !readForm(order.html, "po-approve"));
    const adminOrder = await get(admin, `/en/replenishment/orders/${incomingOrder}`);
    const forged = await post(keeper.jar, `/en/replenishment/orders/${incomingOrder}`, adminOrder.html, "po-approve");
    check("the storekeeper replaying the administrator's approval form is refused", refused(forged), `${forged.status} ${forged.to}`);
    const forgedManager = await post(manager.jar, `/en/replenishment/orders/${incomingOrder}`, adminOrder.html, "po-approve");
    check("so is the manager", refused(forgedManager), `${forgedManager.status}`);
    check("still waiting for approval", psql(`select status from public.purchase_orders where id = '${incomingOrder}'`) === "proposed");
    const approved = await post(admin, `/en/replenishment/orders/${incomingOrder}`, adminOrder.html, "po-approve");
    check("the administrator approves it", approved.to.includes("notice=po_approve"), approved.to);
  }
  {
    const plan = await get(keeper.jar, "/en/replenishment");
    const row = rowOf(plan.html, "E8 مكون");
    check("X: forecast 20 (missing day left out), safety 25 % of 20 = 5, usable 7, eligible incoming 3",
      q(cell(row, "forecast"), "20/1") && q(cell(row, "safety"), "5/1") && q(cell(row, "usable"), "7/1") && q(cell(row, "incoming"), "3/1"), row.slice(0, 600));
    check("X: 20 + 5 − 7 − 3 = 15", q(cell(row, "raw"), "15/1") && q(cell(row, "recommended"), "15/1") && q(cell(row, "suggested"), "15/1"));
    check("the history column shows 3 complete and 1 missing same-weekday days", /3 complete, 1 missing/.test(plainText(cell(row, "history"))));
    check("every item's page recalculation agrees with the database", /data-mismatches="0"/.test(plan.html) && !/data-check="mismatch"/.test(plan.html));
    const ar = await get(keeper.jar, "/ar/replenishment");
    check("the Arabic planning page shows the same numbers right to left",
      ar.html.includes('dir="rtl"') && q(cell(rowOf(ar.html, "E8 مكون"), "recommended"), "15/1") && /المتاح وقت الاستلام/.test(plainText(ar.html)) && /data-mismatches="0"/.test(ar.html));
    const detail = await get(keeper.jar, `/en/replenishment/items/${X}`);
    check("the item page shows 13 dates for each weekday, complete and missing days marked",
      (detail.html.match(/data-obs-date=/g) ?? []).length === 91 && detail.html.includes(`data-obs-date="${addDays(D, -26)}"`)
      && new RegExp(`data-obs="missing" data-obs-date="${addDays(D, -26)}"`).test(detail.html));
    check("the item page shows the day-by-day projection and the arithmetic", /data-basis="posted"/.test(detail.html) && /data-term="usable"/.test(detail.html) && /data-check="ok"/.test(detail.html));
  }

  section("5. Changing the expected receipt date keeps the original and shows the effect on the plan");
  {
    const order = await get(keeper.jar, `/en/replenishment/orders/${incomingOrder}`);
    const noReason = await post(keeper.jar, `/en/replenishment/orders/${incomingOrder}`, order.html, "po-set_expected", { date: addDays(D, 3), reason: "" });
    check("a change without a reason is refused", noReason.to.includes("error=invalid_input"), noReason.to);
    const changed = await post(keeper.jar, `/en/replenishment/orders/${incomingOrder}`, order.html, "po-set_expected", { date: addDays(D, 3), reason: "E8 supplier moved the delivery" });
    check("the storekeeper moves it one day later with a reason", changed.to.includes("notice=po_set_expected"), changed.to);
    const after = await get(keeper.jar, `/en/replenishment/orders/${incomingOrder}`);
    check("the order shows the original date, the new date and the reason",
      /data-kv="original-expected"/.test(after.html) && after.html.includes(`data-date="${E}"`) && after.html.includes(`data-date="${addDays(D, 3)}"`)
      && /data-revision="2" data-kind="override"/.test(after.html) && plainText(after.html).includes("E8 supplier moved the delivery"));
    const plan = await get(keeper.jar, "/en/replenishment");
    const row = rowOf(plan.html, "E8 مكون");
    check("effect on the plan: the 3 leave the window, so X now needs 18", q(cell(row, "incoming"), "0/1") && q(cell(row, "recommended"), "18/1"), row.slice(0, 400));
    const item = await get(keeper.jar, `/en/replenishment/items/${X}`);
    check("the item page lists the order as after the window, with both dates", /data-incoming="after_window"/.test(item.html));
    const whatIf = await get(keeper.jar, `/en/replenishment/items/${X}?expected=${addDays(D, 3)}`);
    check("a what-if receipt date shows the default and the changed plan side by side",
      /data-section="default"/.test(whatIf.html) && /data-section="changed"/.test(whatIf.html) && /data-section="effect"/.test(whatIf.html));
    const back = await post(keeper.jar, `/en/replenishment/orders/${incomingOrder}`, after.html, "po-set_expected", { date: E, reason: "E8 back to the usual day" });
    check("moving it back restores 15", back.to.includes("notice=") && q(cell(rowOf((await get(keeper.jar, "/en/replenishment")).html, "E8 مكون"), "recommended"), "15/1"));
    check("the three revisions and their audit rows are kept",
      psql(`select count(*) from public.purchase_order_expected_dates where order_id = '${incomingOrder}'`) === "3"
      && psql(`select count(*) from public.audit_log where action = 'purchase_order.set_expected' and target_id = '${incomingOrder}'`) === "2");
  }

  section("6. An order from the plan: suggestion, final quantity and override reason");
  let planOrder;
  {
    const page = await get(keeper.jar, `/en/replenishment/orders/new?item=${X}`);
    const line = rowOf(page.html, "E8 مكون", "data-line");
    check("the line carries the suggestion 15", /name="suggested.0" value="15\/1"/.test(page.html) && /name="quantity.0"[^>]*value="15"/.test(page.html), line.slice(0, 200));
    const noReason = await post(keeper.jar, `/en/replenishment/orders/new?item=${X}`, page.html, "po-create", { "quantity.0": "20", "source.0": "factory", "unit.0": "" });
    check("a different final quantity without a reason is refused", noReason.to.includes("error=po_override_reason"), noReason.to);
    const r = await post(keeper.jar, `/en/replenishment/orders/new?item=${X}`, (await get(keeper.jar, `/en/replenishment/orders/new?item=${X}`)).html, "po-create",
      { "quantity.0": "20", "source.0": "factory", "unit.0": "", "reason.0": "E8 weekend event" });
    check("with a reason it is saved", r.to.includes("notice=po_create"), r.to);
    planOrder = r.to.split("/orders/")[1]?.split("?")[0];
    const order = await get(keeper.jar, `/en/replenishment/orders/${planOrder}`);
    const row = rowOf(order.html, "E8 مكون", "data-line");
    check("the order line shows suggested 15, final 20 and the reason",
      q(cell(row, "suggested"), "15/1") && q(cell(row, "final"), "20/1") && plainText(cell(row, "override")).includes("E8 weekend event"));
    check("the suggestion keeps its arithmetic", psql(`select plan ->> 'status' || ' ' || (plan -> 'usable' ->> 'num') from public.purchase_order_lines where order_id = '${planOrder}'`) === "recommend 7");
    await post(admin, `/en/replenishment/orders/${planOrder}`, (await get(admin, `/en/replenishment/orders/${planOrder}`)).html, "po-approve");
  }

  section("7. Receiving 4 then 6 of 10, retries and over-receipt");
  let receiveOrder;
  {
    const page = await get(keeper.jar, "/en/replenishment/orders/new");
    const r = await post(keeper.jar, "/en/replenishment/orders/new", page.html, "po-create", { "item.0": Z, "quantity.0": "10", "source.0": "store", "unit.0": "" });
    receiveOrder = r.to.split("/orders/")[1]?.split("?")[0];
    const orderPath = `/en/replenishment/orders/${receiveOrder}`;
    const proposed = await get(keeper.jar, orderPath);
    check("nothing can be received before approval (no form)", !readForm(proposed.html, "po-receive"));
    await post(admin, orderPath, (await get(admin, orderPath)).html, "po-approve");
    const form = await get(keeper.jar, orderPath);
    const first = await post(keeper.jar, orderPath, form.html, "po-receive", { "quantity.0": "4", reference: "E8 delivery note" });
    const again = await post(keeper.jar, orderPath, form.html, "po-receive", { "quantity.0": "4", reference: "E8 delivery note" });
    check("4 received; sending the same form again is recognised", first.to.includes("notice=po_receive") && again.to.includes("notice=po_replayed"), `${first.to} ${again.to}`);
    const forged = await post(manager.jar, orderPath, form.html, "po-receive", { "quantity.0": "6" });
    check("the manager replaying the storekeeper's receiving form is refused", refused(forged), String(forged.status));
    const cashierForged = await post(cashier.jar, orderPath, form.html, "po-receive", { "quantity.0": "6" });
    check("so is the cashier", refused(cashierForged), String(cashierForged.status));
    check("and neither wrote a receipt", psql(`select count(*) from public.purchase_order_receipts where order_id = '${receiveOrder}'`) === "1");
    const second = await post(keeper.jar, orderPath, (await get(keeper.jar, orderPath)).html, "po-receive", { "quantity.0": "6" });
    check("6 received", second.to.includes("notice=po_receive"), second.to);
    check("two receipt movements adding 10 in total",
      psql(`select count(*) || '|' || sum(m.quantity_num / m.quantity_den)::int from public.stock_movements m
            join public.purchase_order_receipt_lines rl on rl.movement_id = m.id where m.item_id = '${Z}'`) === "2|10");
    const stock = await get(keeper.jar, `/en/inventory?date=${D}`);
    check("the stock page shows the receipt of 10 on the day it arrived", /data-kind="receipt"[^]*?data-signed="10\/1"/.test(cell(rowOf(stock.html, "E8 مكون استلام"), "in")));
    const more = await get(keeper.jar, orderPath);
    check("the line is closed: no receiving form is offered", !readForm(more.html, "po-receive"));
    const over = await post(keeper.jar, orderPath, fresh(form.html),
      "po-receive", { "quantity.0": "1" });
    check("receiving more than outstanding is refused", over.to.includes("error=po_over_receipt"), over.to);
    const accepted = await post(keeper.jar, orderPath, fresh(form.html),
      "po-receive", { "quantity.0": "1", "over.0": "E8 one extra in the box" });
    check("unless an over-receipt reason is given; it is kept and audited", accepted.to.includes("notice=po_receive")
      && psql(`select count(*) from public.purchase_order_receipt_lines where over_receipt_reason = 'E8 one extra in the box'`) === "1"
      && psql(`select count(*) from public.audit_log where action = 'purchase_order.receive' and changes::text like '%E8 one extra in the box%'`) === "1", accepted.to);
    const list = await get(keeper.jar, "/en/replenishment/orders");
    const row = rowOf(list.html, String(psql(`select order_no from public.purchase_orders where id = '${receiveOrder}'`)), "data-order");
    check("the order list shows the actual receipt date from the receipts", cell(row, "receipts").includes(`data-date="${D}"`), row.slice(0, 200));
  }

  section("8. Cancelling the unreceived rest");
  {
    const orderPath = `/en/replenishment/orders/${planOrder}`;
    await post(keeper.jar, orderPath, (await get(keeper.jar, orderPath)).html, "po-receive", { "quantity.0": "5" });
    const page = await get(admin, orderPath);
    check("the storekeeper has no cancel form; the administrator does", !readForm((await get(keeper.jar, orderPath)).html, "po-cancel_rest") && Boolean(readForm(page.html, "po-cancel_rest")));
    const noReason = await post(admin, orderPath, page.html, "po-cancel_rest", { reason: "" });
    check("cancelling needs a reason", noReason.to.includes("error=invalid_input"), noReason.to);
    const done = await post(admin, orderPath, page.html, "po-cancel_rest", { reason: "E8 supplier short" });
    check("the administrator cancels the remaining 15", done.to.includes("notice=po_cancel_rest"), done.to);
    const after = await get(admin, orderPath);
    const row = rowOf(after.html, "E8 مكون", "data-line");
    check("received 5, cancelled 15, outstanding 0; the order is closed",
      q(cell(row, "received"), "5/1") && q(cell(row, "cancelled"), "15/1") && q(cell(row, "outstanding"), "0/1") && /data-status="closed"/.test(after.html), row.slice(0, 400));
    check("cancelling created no stock: X has 7 + 5 = 12",
      psql(`select sum(direction * quantity_num / quantity_den)::int from public.stock_movements where item_id = '${X}'`) === "12");
    check("the receipt and the cancellation stay in the history", /data-receipt=/.test(after.html) && /data-event="cancel_rest"/.test(after.html));
  }

  section("9. Insufficient history: review state, manual order available");
  {
    const settings = await get(admin, "/en/replenishment/settings");
    await post(admin, "/en/replenishment/settings", settings.html, "branch-settings", { min_observations: "4", coverage_days: "1" });
    const plan = await get(keeper.jar, "/en/replenishment");
    const row = rowOf(plan.html, "E8 مكون");
    check("with a minimum of 4, X (3 complete days) is in review", /data-status="review"/.test(row) && /data-reason="insufficient_history"/.test(row));
    const page = await get(keeper.jar, `/en/replenishment/orders/new?item=${X}`);
    check("the order page offers it as a manual line", /data-status="review"/.test(page.html) && !/name="suggested.0"/.test(page.html));
    const r = await post(keeper.jar, `/en/replenishment/orders/new?item=${X}`, page.html, "po-create", { "quantity.0": "9", "source.0": "factory", "unit.0": "" });
    check("and the manual order is created without a reason", r.to.includes("notice=po_create"), r.to);
    check("its line has no suggestion", psql(`select count(*) from public.purchase_order_lines where item_id = '${X}' and quantity_text = '9' and suggested_num is null and plan is null`) === "1");
  }

  section("10. Audit and append-only history");
  check("approvals, receipts, overrides and cancellations are in the audit history",
    ["create", "approve", "set_expected", "receive", "cancel_rest"].every((a) => Number(psql(`select count(*) from public.audit_log where action = 'purchase_order.${a}'`)) > 0));
  check("one event per accepted request", psql("select count(*) from public.purchase_order_events") === psql("select count(*) from public.audit_log where action like 'purchase_order.%'"));
  const { error } = await adminDb.from("purchase_orders").update({ note: "x" }).eq("id", incomingOrder);
  check("the API cannot change an order directly", Boolean(error) || psql(`select coalesce(note, '') from public.purchase_orders where id = '${incomingOrder}'`) === "");
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
