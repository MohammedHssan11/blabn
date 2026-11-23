// Phase 6 end-to-end checks over HTTP against the PRODUCTION build and the LOCAL Supabase instance.
//
//   npm run build && npm run test:phase6
//
// Rebuilds the local database (supabase db reset; --no-reset skips it), starts the built application,
// bootstraps a synthetic System Admin and drives the real stock forms the way a browser without
// JavaScript does. Synthetic staff and synthetic catalog items only; passwords are random and never printed.
import { randomBytes } from "node:crypto";
import { container } from "../phase3/db-check.mjs";
import {
  Jar, clientFromJar, createReporter, loadEnv, makeHttp, plainText, readForm, run, serviceClient, startServer, submitForm, waitUp,
} from "../phase3/lib.mjs";

const PORT = process.env.E2E_PORT ?? "3206";
const BASE = `http://127.0.0.1:${PORT}`;
const noReset = process.argv.includes("--no-reset");
const { check, section, state } = createReporter();
const secret = () => `${randomBytes(9).toString("base64url")}-Aa1`;
const DAY = "2026-11-20";

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
/** Submits a form of a page and returns where it redirected. */
async function post(jar, pathname, html, form, set = {}) {
  const response = await submitForm(http, jar, pathname, html, form, set);
  return { status: response.status, to: where(response.headers.get("location")) };
}
/** The table row of one item on the stock page. */
const rowOf = (html, name) => {
  const start = html.indexOf(`data-item="${name}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</tr>", start));
};
const cell = (row, col) => {
  const start = row.indexOf(`data-col="${col}"`);
  return start < 0 ? "" : row.slice(start, row.indexOf("</td>", start));
};

async function main() {
  await waitUp(BASE, server);

  section("0. Synthetic people");
  const adminEmail = "stock.admin@example.test";
  const adminTemp = secret();
  const adminPassword = secret();
  const boot = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", adminEmail, "--name", "Stock Admin"], { env: { ...env, BOOTSTRAP_ADMIN_PASSWORD: adminTemp } });
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
  const cashier = await makeStaff("cashier", "Stock Cashier");
  const keeper = await makeStaff("storekeeper", "Stock Keeper");
  const manager = await makeStaff("manager", "Stock Manager");

  section("1. Synthetic catalog (Phase 5 commands as the administrator)");
  const adminDb = clientFromJar(env, admin);
  const rpc = async (fn, args) => {
    const { data, error } = await adminDb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
    return data;
  };
  const item = (kind, name, unit) => rpc("app_catalog_save_item", { p_id: null, p_kind: kind, p_name_ar: name, p_name_en: null, p_code: null, p_section: null,
    p_base_unit: unit, p_sales_unit: null, p_purchase_unit: null, p_storage_unit: null, p_is_add_on: false, p_expected_version: null });
  const x = await item("ingredient", "E6 مكون عد", "pc");
  const y = await item("ingredient", "E6 مكون وزن", "kg");
  const box = await item("packaging", "E6 علبة", "pc");
  const cake = await item("sold", "E6 كيكة", null);
  await rpc("app_catalog_map_name", { p_source: "foodics", p_label: "E6 كيكة", p_item: cake, p_decision: "approve", p_basis: "e2e" });
  const v1 = await rpc("app_catalog_create_recipe", { p_product: cake, p_label: "E6 v1", p_copy_from: null, p_note: null });
  await rpc("app_catalog_save_recipe_line", { p_version: v1, p_line: null, p_component: x, p_quantity: "2", p_unit: "pc", p_note: null, p_expected_version: 1 });
  await rpc("app_catalog_save_recipe_line", { p_version: v1, p_line: null, p_component: box, p_quantity: "1", p_unit: "pc", p_note: null, p_expected_version: 2 });
  await rpc("app_catalog_approve_recipe", { p_version: v1, p_from: "2026-11-01", p_to: null, p_expected_version: 3 });
  check("synthetic items, mapping and an approved recipe exist", Boolean(x && y && box && cake && v1));

  section("2. Who can open the stock pages");
  const pages = ["/inventory", `/inventory/product-mix?date=${DAY}`, `/inventory/items/${x}?date=${DAY}`];
  for (const locale of ["en", "ar"]) {
    for (const page of pages) {
      const anon = await get(new Jar(), `/${locale}${page}`);
      check(`/${locale}${page}: anonymous visitors are sent to sign in`, anon.status === 307 && where(anon.location).startsWith(`/${locale}/sign-in`), String(anon.status));
      const denied = await get(cashier.jar, `/${locale}${page}`);
      check(`/${locale}${page}: the cashier is refused`, denied.status === 403, String(denied.status));
      for (const [name, person] of [["storekeeper", keeper.jar], ["manager", manager.jar], ["administrator", admin]]) {
        const ok = await get(person, `/${locale}${page}`);
        const dir = locale === "ar" ? "rtl" : "ltr";
        check(`/${locale}${page}: the ${name} reads it (${dir})`, ok.status === 200 && ok.html.includes(`<html lang="${locale}" dir="${dir}">`), String(ok.status));
      }
    }
  }
  check("the storekeeper's menu lists Stock; the cashier's does not",
    /href="\/en\/inventory"/.test((await get(keeper.jar, "/en")).html) && !/href="\/en\/inventory"/.test((await get(cashier.jar, "/en")).html));
  {
    const keeperPage = await get(keeper.jar, `/en/inventory?date=${DAY}`);
    const managerPage = await get(manager.jar, `/en/inventory?date=${DAY}`);
    check("the storekeeper gets count, movement and adjustment forms but no opening stock",
      Boolean(readForm(keeperPage.html, "count") && readForm(keeperPage.html, "movement") && readForm(keeperPage.html, "propose_adjustment")) && !readForm(keeperPage.html, "opening"));
    check("the manager gets the opening-stock form but no count form", Boolean(readForm(managerPage.html, "opening")) && !readForm(managerPage.html, "count"));
  }

  section("3. Opening, receipt and an idempotent retry through the real forms");
  const stockPath = `/en/inventory?date=${DAY}`;
  {
    const page = await get(manager.jar, stockPath);
    const r = await post(manager.jar, stockPath, page.html, "opening", { item: x, unit: "", quantity: "10", local: `${DAY}T08:00` });
    check("the manager records 10 pieces of opening stock", r.status === 303 && r.to.includes("notice=stock_saved"), `${r.status} ${r.to}`);
    const y1 = await post(manager.jar, stockPath, (await get(manager.jar, stockPath)).html, "opening", { item: y, unit: "g", quantity: "1000", local: `${DAY}T08:00` });
    check("and 1000 g of Y, stored as 1 kg", y1.to.includes("notice=stock_saved") && psql(`select quantity_num||'/'||quantity_den from public.stock_movements where item_id = '${y}'`) === "1/1");
  }
  {
    const page = await get(keeper.jar, stockPath);
    const fields = { kind: "receipt", item: x, unit: "", quantity: "5", local: `${DAY}T10:00`, reference: "DN-E6" };
    const first = await post(keeper.jar, stockPath, page.html, "movement", fields);
    const again = await post(keeper.jar, stockPath, page.html, "movement", fields); // the same rendered form, sent twice
    check("the receipt is saved, and sending the same form again is recognised", first.to.includes("notice=stock_saved") && again.to.includes("notice=stock_replayed"), `${first.to} / ${again.to}`);
    check("retrying the same receipt creates one stock movement", psql(`select count(*) from public.stock_movements where item_id = '${x}' and kind = 'receipt'`) === "1");
    const late = await post(keeper.jar, stockPath, (await get(keeper.jar, stockPath)).html, "movement", { ...fields, local: "2026-11-21T09:00" });
    check("a receipt is refused on a business day other than its arrival", late.to.includes("error=invalid_input"), late.to);
    const forged = await post(cashier.jar, stockPath, page.html, "movement", { ...fields, quantity: "50" });
    check("the cashier replaying the storekeeper's form changes nothing", forged.status !== 303 || !forged.to.includes("notice="), `${forged.status} ${forged.to}`);
    check("still exactly one receipt", psql(`select count(*) from public.stock_movements where item_id = '${x}' and kind = 'receipt'`) === "1");
  }

  section("4. Product Mix: reconcile, lock, post through the approved recipe");
  const mixPath = `/en/inventory/product-mix?date=${DAY}`;
  const step = async (form, set) => post(keeper.jar, mixPath, (await get(keeper.jar, mixPath)).html, form, set);
  check("report saved", (await step("mix_save", { net_sales: "35.00", local: `${DAY}T23:00` })).to.includes("notice=stock_saved"));
  check("two sections saved", (await step("mix_section", { label: "E6 الكيك", total: "25.00" })).to.includes("notice=")
    && (await step("mix_section", { label: "E6 أخرى", total: "10.00" })).to.includes("notice="));
  await step("mix_line", { section_no: "1", label: "E6 كيكة", quantity: "2", amount: "20.00" });
  await step("mix_line", { section_no: "1", label: "كيكة الهبة دبي شيكولاتة كبيرة", quantity: "1", amount: "5.00" });
  const dup = await step("mix_line", { section_no: "1", label: "E6 كيكة", quantity: "2", amount: "20.00" });
  check("the same name cannot be entered twice in one section (overlapping photos)", dup.to.includes("error=stock_duplicate"), dup.to);
  {
    const page = await get(keeper.jar, mixPath);
    check("the page shows the reconciliation problem before the second section has lines",
      /data-reconciled="false"/.test(page.html) && /data-problem="section_without_lines"/.test(page.html));
    const lock = await post(keeper.jar, mixPath, page.html, "mix_lock");
    check("locking an unreconciled report is refused", lock.to.includes("error=stock_not_reconciled"), lock.to);
  }
  await step("mix_line", { section_no: "2", label: "E6 اسم غير معروف", quantity: "1", amount: "10.00" });
  {
    const page = await get(keeper.jar, mixPath);
    check("sections and lines reconcile to net sales (35.00)", /data-reconciled="true"/.test(page.html));
    check("locked", (await post(keeper.jar, mixPath, page.html, "mix_lock")).to.includes("notice=stock_saved"));
  }
  {
    const page = await get(keeper.jar, mixPath);
    const posted = await post(keeper.jar, mixPath, page.html, "post_consumption");
    const replay = await post(keeper.jar, mixPath, page.html, "post_consumption");
    check("posting saves; resending the same form is recognised", posted.to.includes("notice=stock_saved") && replay.to.includes("notice=stock_replayed"), `${posted.to} ${replay.to}`);
    check("one consumption movement each for X and the box", psql(`select count(*) from public.stock_movements where kind = 'consumption'`) === "2");
    check("the posting keeps the approved version and exact quantities",
      psql(`select recipe_version_id||' '||quantity_num||'/'||quantity_den||' '||recipe_quantity_num from public.stock_movements where kind = 'consumption' and item_id = '${x}'`) === `${v1} 4/1 2`);
    const after = await get(keeper.jar, mixPath);
    check("the cake line shows the posted recipe version", /data-mix-line="E6 كيكة" data-line-status="posted"/.test(after.html));
    check("the unmapped name stays blocked and says why", /data-mix-line="E6 اسم غير معروف" data-line-status="blocked"/.test(after.html) && /data-reason="unmapped_name"/.test(after.html));
    check("the real Dubai cake stays blocked until Abdo approves its recipe",
      /data-mix-line="كيكة الهبة دبي شيكولاتة كبيرة" data-line-status="blocked"/.test(after.html) && /data-reason="recipe_not_approved"/.test(after.html));
    const ar = await get(keeper.jar, `/ar/inventory/product-mix?date=${DAY}`);
    check("the Arabic page shows the same report right to left", ar.html.includes('dir="rtl"') && /data-reconciled="true"/.test(ar.html) && /اترحّل/.test(plainText(ar.html)));
  }

  section("5. Counts and variance");
  {
    const page = await get(keeper.jar, stockPath);
    const c = await post(keeper.jar, stockPath, page.html, "count", { item: x, unit: "", quantity: "10", local: `${DAY}T23:30` });
    check("the count of 10 is saved", c.to.includes("notice=stock_saved"), c.to);
    const blank = await post(keeper.jar, stockPath, (await get(keeper.jar, stockPath)).html, "count", { item: y, unit: "", quantity: "", local: `${DAY}T23:30` });
    check("a blank count is refused, not stored as zero", blank.to.includes("error=invalid_input") && psql(`select count(*) from public.stock_counts where item_id = '${y}'`) === "0");
    const day = await get(keeper.jar, stockPath);
    const rx = rowOf(day.html, "E6 مكون عد");
    check("X: expected 10 + 5 − 4 = 11", /data-signed="11\/1"/.test(cell(rx, "expected")), cell(rx, "expected").slice(0, 120));
    check("X: count 10, variance −1", /data-signed="10\/1"/.test(cell(rx, "count")) && /data-signed="-1\/1"/.test(cell(rx, "variance")));
    const ry = rowOf(day.html, "E6 مكون وزن");
    check("Y: not counted, so no variance", /data-status="missing"/.test(ry) && /data-qty="blank"/.test(cell(ry, "variance")));
    const rb = rowOf(day.html, "E6 علبة");
    check("packaging is counted monthly and is not due on 20 November", /data-schedule="monthly"/.test(rb) && /data-status="not_due"/.test(rb));
    await post(keeper.jar, stockPath, day.html, "count", { item: y, unit: "", quantity: "0", local: `${DAY}T23:40` });
    const zero = rowOf((await get(keeper.jar, stockPath)).html, "E6 مكون وزن");
    check("an explicit zero count of Y participates: 0 − 1 = −1", /data-signed="-1\/1"/.test(cell(zero, "variance")), cell(zero, "variance").slice(0, 120));
    const ar = await get(keeper.jar, `/ar/inventory?date=${DAY}`);
    check("the Arabic stock page shows the same variance", /data-signed="-1\/1"/.test(cell(rowOf(ar.html, "E6 مكون عد"), "variance")) && /الانحراف/.test(plainText(ar.html)));
  }

  section("6. History of a figure, and a later recipe version");
  {
    const history = await get(keeper.jar, `/en/inventory/items/${x}?date=${DAY}`);
    const textHistory = plainText(history.html);
    check("history lists opening, receipt and consumption with who recorded them",
      /data-movement="opening"/.test(history.html) && /data-movement="receipt"/.test(history.html) && /data-movement="consumption"/.test(history.html)
      && textHistory.includes("Stock Manager") && textHistory.includes("Stock Keeper"));
    check("the consumption row shows the recipe line it came from", /Recipe line/.test(textHistory));
    const v2 = await rpc("app_catalog_create_recipe", { p_product: cake, p_label: "E6 v2", p_copy_from: v1, p_note: null });
    const { error } = await adminDb.rpc("app_catalog_approve_recipe", { p_version: v2, p_from: DAY, p_to: null, p_expected_version: 1 });
    check("a new version starting on a posted day is refused (CT004)", error?.code === "CT004", error?.code);
    const okLater = await adminDb.rpc("app_catalog_approve_recipe", { p_version: v2, p_from: "2026-11-21", p_to: null, p_expected_version: 1 });
    check("starting it the next day is accepted, and the posted day is unchanged", !okLater.error
      && /data-signed="11\/1"/.test(cell(rowOf((await get(keeper.jar, stockPath)).html, "E6 مكون عد"), "expected")));
  }

  section("7. Phone width and audit");
  check("every stock request is in the audit history", Number(psql("select count(*) from public.audit_log where action like 'stock.%'")) === Number(psql("select count(*) from public.stock_postings")));
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
