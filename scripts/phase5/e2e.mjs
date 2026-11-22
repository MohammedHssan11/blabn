// Phase 5 end-to-end checks over HTTP against the PRODUCTION build and the LOCAL Supabase instance.
//
//   npm run build && npm run test:phase5
//
// Rebuilds the local database (supabase db reset; --no-reset skips it), starts the built application,
// bootstraps a synthetic System Admin and drives the real catalog forms the way a browser without JavaScript
// does. Passwords are random per run and never printed. Synthetic staff and a synthetic product are used for
// the lifecycle checks; the confirmed cases (cake alias, mixed nuts, six spoons) are checked on the loaded data.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { container } from "../phase3/db-check.mjs";
import {
  Jar, clientFromJar, createReporter, directSession, loadEnv, makeHttp, plainText, readForm, root, run, serviceClient, startServer, submitForm, waitUp,
} from "../phase3/lib.mjs";

const PORT = process.env.E2E_PORT ?? "3205";
const BASE = `http://127.0.0.1:${PORT}`;
const noReset = process.argv.includes("--no-reset");
const { check, section, state } = createReporter();
const secret = () => `${randomBytes(9).toString("base64url")}-Aa1`;
const fixture = JSON.parse(readFileSync(path.join(root, "fixtures", "catalog", "legacy-catalog.json"), "utf8"));

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

/** Rows as JSON through the database owner: the service role has no catalog grants by design. */
function rows(sql) {
  const out = psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`);
  return JSON.parse(out);
}
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;

const where = (location) => (location ? new URL(location, BASE).pathname + new URL(location, BASE).search : "");
const get = async (jar, pathname) => {
  const response = await http.get(jar, pathname);
  return { status: response.status, location: response.headers.get("location"), html: await response.text() };
};
const text = (html) => plainText(html);
/** The part of a page between a start marker and the next closing tag of the same element. */
const slice = (html, startPattern, endTag = "</article>") => {
  const start = html.search(startPattern);
  if (start < 0) return "";
  return html.slice(start, html.indexOf(endTag, start) + endTag.length);
};
const rational = (value) => {
  const [num, den = "1"] = String(value).split("/");
  return { num: BigInt(num), den: BigInt(den) };
};
const same = (a, b) => a.num * b.den === b.num * a.den;
const add = (a, b) => ({ num: a.num * b.den + b.num * a.den, den: a.den * b.den });
const mul = (a, b) => ({ num: a.num * b.num, den: a.den * b.den });

async function main() {
  await waitUp(BASE, server);

  // ============================================================ 0. people
  section("0. Synthetic people: a System Admin, a cashier, a storekeeper");
  const adminEmail = "catalog.admin@example.test";
  const adminTemp = secret();
  const adminPassword = secret();
  const boot = run("node", ["scripts/phase3/bootstrap-admin.mjs", "--email", adminEmail, "--name", "Catalog Admin"], { env: { ...env, BOOTSTRAP_ADMIN_PASSWORD: adminTemp } });
  check("bootstrap of the synthetic administrator", boot.status === 0, `${boot.stdout}${boot.stderr}`.slice(0, 300));
  const admin = new Jar();
  {
    const page = await get(admin, "/en/sign-in");
    const signedIn = await submitForm(http, admin, "/en/sign-in", page.html, "sign-in", { email: adminEmail, password: adminTemp });
    const changePage = await get(admin, where(signedIn.headers.get("location")));
    const changed = await submitForm(http, admin, "/en/account/password", changePage.html, "change-password", { password: adminPassword, confirm: adminPassword });
    check("the administrator chooses a password and reaches the home page", changed.status === 303 && where(changed.headers.get("location")).startsWith("/en"), `${changed.status} ${changed.headers.get("location")}`);
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
    return { id, email, password, jar };
  }
  const cashier = await makeStaff("cashier", "Test Cashier");
  const keeper = await makeStaff("storekeeper", "Test Storekeeper");
  check("the cashier and the storekeeper are signed in", (await get(cashier.jar, "/en")).status === 200 && (await get(keeper.jar, "/en")).status === 200);

  // ============================================================ 1. access
  section("1. Who can open the catalog");
  const pages = ["/catalog", "/catalog/items/new", "/catalog/review", "/catalog/recipes", "/catalog/consumption"];
  for (const locale of ["en", "ar"]) {
    for (const page of pages) {
      const anon = await get(new Jar(), `/${locale}${page}`);
      check(`/${locale}${page}: anonymous visitors are sent to sign in`, anon.status === 307 && where(anon.location).startsWith(`/${locale}/sign-in?next=`), `${anon.status}`);
      for (const [name, person] of [["cashier", cashier], ["storekeeper", keeper]]) {
        const r = await get(person.jar, `/${locale}${page}`);
        check(`/${locale}${page}: the ${name} is refused`, r.status === 403, String(r.status));
      }
      const ok = await get(admin, `/${locale}${page}`);
      const dir = locale === "ar" ? "rtl" : "ltr";
      check(`/${locale}${page}: the administrator reads it (${dir})`, ok.status === 200 && ok.html.includes(`<html lang="${locale}" dir="${dir}">`), String(ok.status));
    }
  }
  {
    const home = await get(admin, "/en");
    check("the administrator's menu and home page list the catalog", /href="\/en\/catalog"/.test(home.html));
    const cashierHome = await get(cashier.jar, "/en");
    check("the cashier's menu does not", !/href="\/en\/catalog"/.test(cashierHome.html));
    const missing = await get(admin, "/en/catalog/items/00000000-0000-4000-8000-00000000dead");
    check("an unknown item is a 404, not an error page", missing.status === 404, String(missing.status));
    const junk = await get(admin, "/en/catalog/recipes/not-an-id");
    check("a malformed recipe id is a 404", junk.status === 404, String(junk.status));
    const odd = await get(admin, "/en/catalog?kind=%27%3B--&q=%25%2C%28%29&page=-4&status=zz");
    check("hostile filters are ignored safely", odd.status === 200);
  }

  // ============================================================ 2. catalog lists
  section("2. Catalog lists in both languages");
  {
    const all = await get(admin, "/en/catalog");
    check("556 items are loaded, 100 per page", /Showing 1–100 of 556/.test(text(all.html)) && (all.html.match(/data-item="/g) ?? []).length === 100);
    const page2 = await get(admin, "/en/catalog?page=6");
    check("the last page shows the remaining 56", /Showing 501–556 of 556/.test(text(page2.html)) && (page2.html.match(/data-item="/g) ?? []).length === 56);
    const sold = await get(admin, "/en/catalog?kind=sold");
    check("filtering by kind: 265 sold products", /of 265/.test(text(sold.html)));
    const pack = await get(admin, "/en/catalog?kind=packaging");
    check("and 116 packaging items", /of 116/.test(text(pack.html)));
    const nuts = await get(admin, `/en/catalog?q=${encodeURIComponent("مكسرات مشكلة")}`);
    check("searching by the Arabic name finds the mixed nuts, shown in English", /Mixed nuts/.test(nuts.html) && /data-kind="ingredient"/.test(nuts.html));
    const ar = await get(admin, `/ar/catalog?q=${encodeURIComponent("مكسرات مشكلة")}`);
    check("the Arabic list shows the Arabic name and Arabic labels", /مكسرات مشكلة/.test(ar.html) && /الأصناف/.test(ar.html) && /كيلو/.test(ar.html));
    const noEnglish = await get(admin, `/en/catalog?kind=sold&q=${encodeURIComponent("الغوريلا")}`);
    check("a product without an English name shows the Arabic name and says so", /الغوريلا/.test(noEnglish.html) && /English name needed/.test(noEnglish.html));
  }

  // ============================================================ 3. the confirmed cases as loaded
  section("3. What Abdo confirmed, as loaded and as shown");
  const nutsRow = rows(`select id, base_unit, version from public.catalog_items where name_ar = ${lit("مكسرات مشكلة")}`)[0];
  const cakeId = rows(`select item_id from public.catalog_source_labels where source_system = 'foodics' and status = 'approved' and label = ${lit("كيكة الهبة دبي شيكولاتة كبيرة")}`)[0].item_id;
  const bazabizo = rows(`select id from public.catalog_items where kind = 'sold' and name_ar = ${lit("بظابيظو مانجو كبير")}`)[0].id;
  {
    const cake = await get(admin, `/en/catalog/items/${cakeId}`);
    const body = text(cake.html).replace(/«\s+/g, "«").replace(/\s+»/g, "»");
    check("P1-28: the cake item keeps both Foodics labels, the workbook label and the decision-record label",
      body.includes("«كيكة الهبة دبي شيكولاتة كبيرة»") && body.includes("«كيكة الهبة دبي شيكولاتة كبير»") && body.includes("«كيكة هبة دبى شيكولاتة صغيرة»") && body.includes("«كيكة الهبة دبي شيكولاتة صغيرة»"));
    check("P1-28: both Foodics labels are approved, the English name is shown", (cake.html.match(/data-label-status="approved"/g) ?? []).length >= 4 && /Dubai chocolate cake/.test(cake.html));
    const resolved = await get(admin, "/en/catalog/review?status=resolved");
    check("P1-28: the resolved queue entry cites Abdo's decision", /P1-28/.test(text(resolved.html)) && /review="unconfirmed_mapping"/.test(resolved.html));
    const open = await get(admin, "/en/catalog/review?kind=unconfirmed_mapping");
    const kinder = slice(open.html, /<article[^>]*data-subject="كيكة الهبة دبي صوص كيندر كبير"/);
    check("P1-29/P1-28: the Kinder line stays open, naming both source rows", /SRC|Foodics Product Mix/.test(kinder) && kinder.includes("كيكة هبة دبى صوص كيندر صغيرة") && /data-status="open"/.test(kinder), kinder.slice(0, 200));

    const nutsPage = await get(admin, `/en/catalog/items/${nutsRow.id}`);
    check("P1-31: mixed nuts show Kilogram as the base unit", /<select[^>]*name="base_unit"/.test(nutsPage.html) && nutsRow.base_unit === "kg");
    const resolvedUnits = await get(admin, "/en/catalog/review?kind=unit_conflict&status=resolved");
    const nutsEntry = slice(resolvedUnits.html, /<article[^>]*data-subject="مكسرات مشكلة"/);
    check("P1-31: the resolved entry lists the ten rows of both workbooks and cites the decision", (nutsEntry.match(/data-ref-row=/g) ?? []).length === 20 && /P1-31/.test(text(nutsEntry)));
    const openUnits = await get(admin, "/en/catalog/review?kind=unit_conflict");
    check("P1-31: the other conflicting units stay open (18) with exact rows", (openUnits.html.match(/data-review="unit_conflict"/g) ?? []).length === 18 && !/data-subject="مكسرات مشكلة"/.test(openUnits.html));
    const spoonEntry = slice(openUnits.html, /<article[^>]*data-subject="ملاعق بلاستيك للارز - مستورد"/);
    check("the spoon unit conflict names the four «كيلو» rows", (spoonEntry.match(/«كيلو»/g) ?? []).length >= 4, spoonEntry.slice(0, 160));

    const recipes = await get(admin, `/en/catalog/recipes/${bazabizo}`);
    const versions = (recipes.html.match(/data-version="/g) ?? []).length;
    const nov = slice(recipes.html, /<section[^>]*data-version-no="2"/, "</section>");
    check("P1-32: large Bazabizo Mango has two separate draft versions", versions === 2 && (recipes.html.match(/data-status="draft"/g) ?? []).length === 2);
    const spoons = slice(nov, /<tr[^>]*data-line="5"/, "</tr>");
    check("P1-32: the November version has six spoons, cited to SRC-07 sheet 2 D1015:G1015", /data-qty="6\/1"/.test(spoons) && /SRC-07 '2'!D1015:G1015/.test(spoons.replaceAll("&#x27;", "'")));
    const oct = slice(recipes.html, /<section[^>]*data-version-no="1"/, "</section>");
    const octLines = slice(oct, /<table[^>]*data-table="recipe-lines"/, "</table>");
    check("P1-32: the October version has no spoon line", !/data-component="ملاعق/.test(octLines) && (octLines.match(/data-line="/g) ?? []).length === 4);
    check("P1-32: both versions wait for the date", (recipes.html.match(/data-testid="date-gate"/g) ?? []).length === 2);
    const nutsRecipe = { data: rows(`select quantity_num, quantity_den, unit_code, source_unit_label from public.recipe_lines where component_id = '${nutsRow.id}'`) };
    check("P1-31: the ten «عدد» rows are kilograms with their numbers unchanged",
      nutsRecipe.data.filter((l) => l.source_unit_label === "عدد").length === 10 && nutsRecipe.data.filter((l) => l.source_unit_label === "عدد").every((l) => l.unit_code === "kg"));
    const sources = fixture.versions.flatMap((v) => v.lines).filter((l) => l.unit_resolution === "abdo_p1_31");
    const fromDb = nutsRecipe.data.filter((l) => l.source_unit_label === "عدد").map((l) => `${l.quantity_num}/${l.quantity_den}`).sort();
    const fromSource = sources.map((l) => `${l.quantity.num}/${l.quantity.den}`).sort();
    check("P1-31: and they equal the workbook values (SRC-06/07)", JSON.stringify(fromDb) === JSON.stringify(fromSource) && fromDb.length === 10, `${fromDb} vs ${fromSource}`);
  }

  // ============================================================ 4. the date gate through the real forms
  section("4. The November recipes wait for the date; approving needs it");
  {
    let page = await get(admin, `/en/catalog/recipes/${bazabizo}`);
    const novSection = () => slice(page.html, /<section[^>]*data-version-no="2"/, "</section>");
    const octSection = () => slice(page.html, /<section[^>]*data-version-no="1"/, "</section>");
    const approve = (sectionHtml, set) => submitForm(http, admin, `/en/catalog/recipes/${bazabizo}`, sectionHtml, "approve", set);
    let r = await approve(novSection(), { from: "2026-11-05", to: "" });
    check("approving before the date is answered is refused with a clear message", r.status === 303 && where(r.headers.get("location")).includes("error=catalog_date_unconfirmed"), where(r.headers.get("location")));
    const refused = await get(admin, where(r.headers.get("location")));
    check("the message is shown, the version is still a draft", /not confirmed yet/.test(text(refused.html)) && (refused.html.match(/data-status="draft"/g) ?? []).length === 2);

    const review = await get(admin, "/en/catalog/review");
    const question = slice(review.html, /<section[^>]*data-section="date-question"/, "</section>");
    check("the question for Abdo is shown (English)", /On which day did the November recipe set start/.test(text(question)));
    const reviewAr = await get(admin, "/ar/catalog/review");
    check("and in Arabic, word for word", reviewAr.html.includes("نسخة وصفات نوفمبر بدأ العمل بيها من يوم كام؟"));
    const wrongDate = await submitForm(http, admin, "/en/catalog/review", question, "date-answer", { date: "2026-13-45", evidence: "x" });
    check("an impossible date is refused", where(wrongDate.headers.get("location")).includes("error=invalid_input"));
    const noEvidence = await submitForm(http, admin, "/en/catalog/review", question, "date-answer", { date: "2026-11-05", evidence: "" });
    check("a date without who confirmed it is refused", where(noEvidence.headers.get("location")).includes("error=invalid_input"));
    const answered = await submitForm(http, admin, "/en/catalog/review", question, "date-answer", { date: "2026-11-05", evidence: "Synthetic test answer" });
    check("the answer is recorded", where(answered.headers.get("location")).includes("notice=catalog_date_answered"), where(answered.headers.get("location")));
    const again = await get(admin, "/en/catalog/review");
    check("the review page shows the answer and the entry is closed", /Answered: 2026-11-05/.test(text(again.html)) && !/data-review="recipe_effective_date" data-status="open"/.test(again.html));

    page = await get(admin, `/en/catalog/recipes/${bazabizo}`);
    r = await approve(novSection(), { from: "2026-11-04", to: "" });
    check("a start date other than the confirmed one is refused", where(r.headers.get("location")).includes("error=catalog_date_unconfirmed"));
    r = await approve(octSection(), { from: "2026-10-01", to: "2026-11-03" });
    check("an end date other than the day before is refused", where(r.headers.get("location")).includes("error=catalog_date_unconfirmed"));
    r = await approve(novSection(), { from: "2026-11-05", to: "" });
    check("the November version is approved on the confirmed date", where(r.headers.get("location")).includes("notice=catalog_recipe_approved"), where(r.headers.get("location")));
    page = await get(admin, `/en/catalog/recipes/${bazabizo}`);
    r = await approve(octSection(), { from: "2026-10-01", to: "2026-11-04" });
    check("the October version is approved to the day before", where(r.headers.get("location")).includes("notice=catalog_recipe_approved"), where(r.headers.get("location")));
    page = await get(admin, `/en/catalog/recipes/${bazabizo}`);
    check("both versions are shown approved with their ranges", (page.html.match(/data-status="approved"/g) ?? []).length === 2 && /2026-10-01 to 2026-11-04/.test(text(page.html)) && /2026-11-05 to no end date/.test(text(page.html)));
    const locked = await get(admin, `/en/catalog/recipes/${bazabizo}`);
    check("approved versions offer no edit controls", !/data-form="edit-line"/.test(slice(locked.html, /<section[^>]*data-version-no="2"/, "</section>")));
  }

  // ============================================================ 5. consumption check
  section("5. Consumption check: eligibility, reasons and exact quantities");
  const foodicsBazabizo = "بظابيظو مانجو كبير";
  {
    const admin_db = clientFromJar(env, admin);
    const mapped = await admin_db.rpc("app_catalog_map_name", { p_source: "foodics", p_label: foodicsBazabizo, p_item: bazabizo, p_decision: "approve", p_basis: "Synthetic test approval (not a confirmed mapping)" });
    check("an approved mapping is added through the signed-in session", !mapped.error, JSON.stringify(mapped.error));
    const lines = ["بظابيظو مانجو كبير | 3", "اسم غير معروف | 5", "كيكة الهبة دبي صوص كيندر كبير | 2", "كيكة الهبة دبي شيكولاتة كبيرة | 109", "غلط بدون كمية", "بظابيظو مانجو كبير | 2"].join("\n");
    const url = (date, body, locale = "en") => `/${locale}/catalog/consumption?run=1&date=${date}&lines=${encodeURIComponent(body)}`;
    const r = await get(admin, url("2026-11-05", lines));
    const t = text(r.html);
    check("the summary counts what can be consumed and what is blocked", /2 can be consumed, 4 blocked/.test(t), t.match(/\d+ can be consumed, \d+ blocked/)?.[0]);
    const statusOf = (n) => r.html.match(new RegExp(`data-line-status="(\\w+)" data-line="${n}"`))?.[1];
    check("valid lines proceed; unrelated blocked lines do not stop them", statusOf(1) === "eligible" && statusOf(6) === "eligible" && [2, 3, 4, 5].every((n) => statusOf(n) === "blocked"));
    check("each blocked line says why", /data-reason="unmapped_name"/.test(r.html) && (r.html.match(/data-reason="mapping_pending"/g) ?? []).length === 1 && /data-reason="invalid_quantity"/.test(r.html) && /data-reason="(no_recipe|recipe_not_approved)"/.test(r.html));
    check("the unreadable row is reported by its position", /Row 5 could not be read/.test(t));
    check("the unmapped name can be sent to the review queue", /data-form="queue-names"/.test(r.html));
    // Independent calculation: 3 + 2 = 5 large Bazabizo on 5 November (version with six spoons).
    //   gloss gel 5 x 3/25 = 3/5 kg; finished piece 5; mango pieces 5 x 3/5 = 3 kg; cut piece 5; spoons 5 x 6 = 30.
    const totals = (name) => {
      const row = slice(r.html, new RegExp(`<tr[^>]*data-total-item="${name}"`), "</tr>");
      return row.match(/data-qty="([^"]+)"/)?.[1];
    };
    check("totals are exact: gloss gel 3/5 kg, mango 3 kg, spoons 30, finished and cut pieces 5",
      same(rational(totals("جيلى تلميع شفاف")), rational("3/5")) && same(rational(totals("مانجو قطع مصنع")), rational("3/1")) &&
      same(rational(totals("ملاعق بلاستيك للارز - مستورد")), rational("30/1")) && same(rational(totals("مقطع فزعه")), rational("5/1")) && same(rational(totals("بظابيظو مانجو كبير")), rational("5/1")),
      [totals("جيلى تلميع شفاف"), totals("مانجو قطع مصنع"), totals("ملاعق بلاستيك للارز - مستورد")].join(" "));
    const spoonKind = slice(r.html, /<tr[^>]*data-total-item="ملاعق بلاستيك للارز - مستورد"/, "</tr>");
    check("packaging is reported as packaging", /data-kind="packaging"/.test(spoonKind));
    const oct = await get(admin, url("2026-11-04", "بظابيظو مانجو كبير | 3"));
    check("4 November uses the October version: no spoons", /1 can be consumed/.test(text(oct.html)) && !/data-total-item="ملاعق/.test(oct.html) && /version 1/.test(text(oct.html)));
    const before = await get(admin, url("2026-09-30", "بظابيظو مانجو كبير | 3"));
    check("30 September has no approved recipe", /data-reason="no_recipe_for_date"/.test(before.html));
    const ar = await get(admin, url("2026-11-05", lines, "ar"));
    check("the Arabic page gives the reasons in Arabic", /لا يوجد منتج معتمد لهذا الاسم من Foodics/.test(ar.html) && /ينتظر الاعتماد/.test(ar.html) && /dir="rtl"/.test(ar.html));
    const bad = await get(admin, url("2026-02-30", "x | 1"));
    check("an impossible date is explained, nothing is calculated", /Enter a valid business date/.test(bad.html) && !/data-section="consumption-result"/.test(bad.html));

    const tooLong = await get(admin, url("2026-11-05", Array(501).fill("x|1").join("\n")));
    check("the preview explains an oversized batch without partial results",
      tooLong.status === 200 && /Enter up to 500 lines/.test(tooLong.html) && !/data-section="consumption-result"/.test(tooLong.html));

    const queue = await submitForm(http, admin, "/en/catalog/consumption", r.html, "queue-names", {});
    check("sending the unmapped names to the review queue works", where(queue.headers.get("location")).includes("notice=catalog_names_queued"), where(queue.headers.get("location")));
    const queued = await get(admin, "/en/catalog/review?kind=unmapped_name");
    check("the name is in the queue once", (queued.html.match(/data-subject="اسم غير معروف"/g) ?? []).length === 1);
    const repeat = await submitForm(http, admin, "/en/catalog/consumption", r.html, "queue-names", {});
    const queuedAgain = await get(admin, "/en/catalog/review?kind=unmapped_name");
    check("sending it again adds nothing", (queuedAgain.html.match(/data-subject="اسم غير معروف"/g) ?? []).length === 1 && repeat.status === 303);
    // Approve it from the queue with a real form.
    const entry = slice(queuedAgain.html, /<article[^>]*data-subject="اسم غير معروف"/);
    const mapped2 = await submitForm(http, admin, "/en/catalog/review", entry, "map-name", { item: bazabizo, basis: "Synthetic test approval", decision: "approve" });
    check("the review queue form approves a mapping", where(mapped2.headers.get("location")).includes("notice=catalog_mapping_saved"), where(mapped2.headers.get("location")));
    const after = await get(admin, url("2026-11-05", "اسم غير معروف | 1"));
    check("the newly approved name is now eligible", /1 can be consumed, 0 blocked/.test(text(after.html)));
    const stillOpen = await get(admin, "/en/catalog/review?kind=unmapped_name&status=open");
    check("and its queue entry is closed", !/data-subject="اسم غير معروف"/.test(stillOpen.html));
  }

  // ============================================================ 6. independent verification on loaded recipes
  section("6. Loaded recipes: the application result equals an independent calculation");
  {
    const components = new Map(fixture.inventory_components.map((c) => [c.name, c]));
    const candidates = fixture.versions.filter((v) => !v.affected_by_nov_date && v.lines.length >= 3 &&
      v.lines.every((l) => l.component && l.quantity && l.unit_code && components.get(l.component)?.base_unit === l.unit_code) &&
      fixture.products.find((p) => p.key === v.product)?.link === "named");
    const pick = candidates.filter((_, i) => i % Math.ceil(candidates.length / 25) === 0).slice(0, 25);
    check("at least 20 loaded recipes are complete and in base units", pick.length >= 20, String(pick.length));
    const db = clientFromJar(env, admin);
    let compared = 0;
    let mismatches = 0;
    let packagingCompared = 0;
    for (const v of pick) {
      const product = rows(`select id from public.catalog_items where legacy_key = ${lit(v.product)}`)[0];
      const version = rows(`select id, version from public.recipe_versions where product_id = '${product.id}'`)[0];
      const approved = await db.rpc("app_catalog_approve_recipe", { p_version: version.id, p_from: "2026-10-01", p_to: null, p_expected_version: version.version });
      if (approved.error) { mismatches += 1; console.log(`  approve failed ${v.product}: ${approved.error.message}`); continue; }
      const result = await db.rpc("app_catalog_consumption", { p_branch: "maarif", p_date: "2026-11-12", p_lines: [{ product_id: product.id, quantity: "7" }] });
      const expected = new Map();
      for (const l of v.lines) {
        const row = mul({ num: BigInt(l.quantity.num), den: BigInt(l.quantity.den) }, { num: 7n, den: 1n });
        expected.set(l.component, expected.has(l.component) ? add(expected.get(l.component), row) : row);
      }
      const totals = new Map((result.data?.totals ?? []).map((t) => [t.name_ar, t]));
      let ok = result.data?.lines?.[0]?.status === "eligible" && totals.size === expected.size;
      for (const [name, value] of expected) {
        const got = totals.get(name);
        if (!got || !same({ num: BigInt(got.quantity.num), den: BigInt(got.quantity.den) }, value) || got.kind !== components.get(name).kind) ok = false;
        if (components.get(name).kind === "packaging") packagingCompared += 1;
      }
      compared += 1;
      if (!ok) { mismatches += 1; console.log(`  MISMATCH ${v.product}`); }
    }
    check(`${compared} recipes (with ingredient and packaging lines) match the independent calculation exactly`, compared === pick.length && mismatches === 0, `${mismatches} mismatches`);
    check("packaging quantities were among those compared", packagingCompared > 10, String(packagingCompared));
  }

  // ============================================================ 7. a later version never changes an earlier day
  section("7. Versioned recipes through the real forms");
  {
    const item = async (kind, name, set = {}) => {
      const page = await get(admin, `/en/catalog/items/new?kind=${kind}`);
      const r = await submitForm(http, admin, "/en/catalog/items/new", page.html, "item", { kind, name_ar: name, base_unit: kind === "sold" ? "" : "kg", purchase_unit: "", storage_unit: "", ...set });
      return where(r.headers.get("location")).match(/items\/([0-9a-f-]{36})/)?.[1] ?? where(r.headers.get("location"));
    };
    const flour = await item("ingredient", "دقيق اختبار e2e", { name_en: "E2E flour" });
    const box = await item("packaging", "علبة اختبار e2e", { base_unit: "pc" });
    const product = await item("sold", "حلوى اختبار e2e", { name_en: "E2E dessert" });
    check("an ingredient, a packaging item and a sold product were created through the form", [flour, box, product].every((id) => /^[0-9a-f-]{36}$/.test(id)), [flour, box, product].join(" "));
    const dup = await get(admin, "/en/catalog/items/new?kind=ingredient");
    const dupResult = await submitForm(http, admin, "/en/catalog/items/new", dup.html, "item", { kind: "ingredient", name_ar: "دقيق  اختبار e2e", base_unit: "kg", purchase_unit: "", storage_unit: "" });
    check("a duplicate name is refused", where(dupResult.headers.get("location")).includes("error=catalog_duplicate"), where(dupResult.headers.get("location")));
    const conv = await get(admin, `/en/catalog/items/${box}`);
    const convOk = await submitForm(http, admin, `/en/catalog/items/${box}`, conv.html, "conversion", { unit: "carton", quantity: "٢٤", basis: "Test carton of 24" });
    check("a carton conversion is saved (Arabic-Indic digits accepted)", where(convOk.headers.get("location")).includes("notice=catalog_conversion_saved"), where(convOk.headers.get("location")));
    const convBad = await submitForm(http, admin, `/en/catalog/items/${box}`, conv.html, "conversion", { unit: "carton", quantity: "0", basis: "zero" });
    check("a zero conversion is refused", where(convBad.headers.get("location")).includes("error=invalid_input"));

    const recipe = (id) => `/en/catalog/recipes/${id}`;
    let page = await get(admin, recipe(product));
    const created = await submitForm(http, admin, recipe(product), page.html, "create-recipe", { label: "E2E v1", copy_from: "" });
    check("a draft recipe is created", where(created.headers.get("location")).includes("notice=catalog_recipe_created"));
    page = await get(admin, recipe(product));
    const v1Section = () => slice(page.html, /<section[^>]*data-version-no="1"/, "</section>");
    const addLine = async (component, quantity, unit) => {
      const r = await submitForm(http, admin, recipe(product), v1Section(), "add-line", { component, quantity, unit });
      page = await get(admin, recipe(product));
      return where(r.headers.get("location"));
    };
    const exact = "9007199254740993.000000000000001";
    const exactSave = await addLine(flour, exact, "g");
    const exactLine = slice(v1Section(), /<tr[^>]*data-line="1"/, "</tr>");
    check("a quantity beyond JavaScript's safe number range stays exact in the edit form",
      exactSave.includes("notice=catalog_line_saved") && new Map(readForm(exactLine, "edit-line") ?? []).get("quantity") === exact);
    const standardFlour = await submitForm(http, admin, recipe(product), exactLine, "edit-line", { component: flour, quantity: "250", unit: "g" });
    page = await get(admin, recipe(product));
    check("lines are added: 250 g of flour, 1 box, and a boxed quantity with its unit still missing",
      where(standardFlour.headers.get("location")).includes("notice=catalog_line_saved") && (await addLine(box, "1", "pc")).includes("notice=catalog_line_saved") && (await addLine(box, "1/3", "")).includes("notice=catalog_line_saved"));
    const noUnit = await submitForm(http, admin, recipe(product), v1Section(), "approve", { from: "2026-10-01", to: "" });
    check("approving with a line that has no unit is refused", where(noUnit.headers.get("location")).includes("error=catalog_incomplete"), where(noUnit.headers.get("location")));
    const badQty = await addLine(flour, "abc", "kg");
    check("an unreadable quantity is refused", badQty.includes("error=invalid_input"), badQty);
    // fix the third line by giving it a unit
    const thirdLine = slice(v1Section(), /<tr[^>]*data-line="3"/, "</tr>");
    const thirdForm = await submitForm(http, admin, recipe(product), thirdLine, "edit-line", { component: box, quantity: "1/3", unit: "pc" });
    check("the unit of a line is corrected in the draft", where(thirdForm.headers.get("location")).includes("notice=catalog_line_saved"));
    page = await get(admin, recipe(product));
    const approved1 = await submitForm(http, admin, recipe(product), v1Section(), "approve", { from: "2026-10-01", to: "" });
    check("version 1 is approved from 1 October", where(approved1.headers.get("location")).includes("notice=catalog_recipe_approved"), where(approved1.headers.get("location")));

    const mapped = await clientFromJar(env, admin).rpc("app_catalog_map_name", { p_source: "foodics", p_label: "E2E DESSERT", p_item: product, p_decision: "approve", p_basis: "Synthetic" });
    check("the synthetic Foodics name is approved", !mapped.error);
    const run = async (date, locale = "en") => {
      const r = await get(admin, `/${locale}/catalog/consumption?run=1&date=${date}&lines=${encodeURIComponent("E2E DESSERT | 6")}`);
      const q = (name) => slice(r.html, new RegExp(`<tr[^>]*data-total-item="${name}"`), "</tr>").match(/data-qty="([^"]+)"/)?.[1];
      return { html: r.html, flour: q("دقيق اختبار e2e"), box: q("علبة اختبار e2e") };
    };
    //   6 desserts: flour 6 x 250 g = 1.5 kg (3/2); boxes 6 x (1 + 1/3) = 8
    const early = await run("2026-10-31");
    check("1 October version, 6 desserts: flour 3/2 kg, boxes 8", same(rational(early.flour), rational("3/2")) && same(rational(early.box), rational("8/1")), `${early.flour} ${early.box}`);

    page = await get(admin, recipe(product));
    const copied = await submitForm(http, admin, recipe(product), page.html, "create-recipe", { label: "E2E v2 (more flour)", copy_from: (page.html.match(/data-version="([0-9a-f-]{36})"/) ?? [])[1] });
    check("version 2 is created as a copy", where(copied.headers.get("location")).includes("notice=catalog_recipe_created"));
    page = await get(admin, recipe(product));
    const v2Section = () => slice(page.html, /<section[^>]*data-version-no="2"/, "</section>");
    const firstLine = slice(v2Section(), /<tr[^>]*data-line="1"/, "</tr>");
    const edit = await submitForm(http, admin, recipe(product), firstLine, "edit-line", { component: flour, quantity: "300", unit: "g" });
    check("version 2 changes the flour to 300 g", where(edit.headers.get("location")).includes("notice=catalog_line_saved"));
    page = await get(admin, recipe(product));
    const overlap = await submitForm(http, admin, recipe(product), v2Section(), "approve", { from: "2026-10-01", to: "2026-10-15" });
    check("dates inside an approved range are refused", where(overlap.headers.get("location")).includes("error=catalog_overlap"), where(overlap.headers.get("location")));
    page = await get(admin, recipe(product));
    const approved2 = await submitForm(http, admin, recipe(product), v2Section(), "approve", { from: "2026-11-05", to: "" });
    check("version 2 is approved from 5 November", where(approved2.headers.get("location")).includes("notice=catalog_recipe_approved"), where(approved2.headers.get("location")));
    const closed = await get(admin, recipe(product));
    check("version 1 now ends on 4 November", /2026-10-01 to 2026-11-04/.test(text(closed.html)));
    const lateOctober = await run("2026-10-31");
    const lastDay = await run("2026-11-04");
    const firstDay = await run("2026-11-05");
    check("31 October and 4 November still use version 1 (flour 3/2 kg)", same(rational(lateOctober.flour), rational("3/2")) && same(rational(lastDay.flour), rational("3/2")) && /version 1/.test(text(lastDay.html)));
    check("5 November uses version 2 (6 x 300 g = 9/5 kg)", same(rational(firstDay.flour), rational("9/5")) && /version 2/.test(text(firstDay.html)), firstDay.flour);
    check("the boxes did not change", same(rational(firstDay.box), rational("8/1")));
    const ar = await run("2026-11-05", "ar");
    check("the Arabic page shows the same quantities", /data-qty="9\/5"/.test(ar.html) && /النسخة 2/.test(ar.html));
    const discontinued = await get(admin, `/en/catalog/items/${product}`);
    const stop = await submitForm(http, admin, `/en/catalog/items/${product}`, discontinued.html, "item-status", { status: "discontinued", on: "2026-12-15" });
    check("a product can be discontinued", where(stop.headers.get("location")).includes("notice=catalog_item_saved"));
    const oldDay = await run("2026-10-31");
    check("a discontinued product still resolves for past days", same(rational(oldDay.flour), rational("3/2")));
    const lateDay = await get(admin, `/en/catalog/consumption?run=1&date=2026-12-20&lines=${encodeURIComponent("E2E DESSERT | 1")}`);
    check("after the end date it is still consumed, with a warning", /data-warning="discontinued_before_date"/.test(lateDay.html) && /1 can be consumed/.test(text(lateDay.html)));
  }

  // ============================================================ 7b. simultaneous approvals
  section("7b. Two approvals at the same moment leave one recipe for a date");
  {
    const db = clientFromJar(env, admin);
    const save = async (kind, name) => (await db.rpc("app_catalog_save_item", { p_id: null, p_kind: kind, p_name_ar: name, p_name_en: null, p_code: null, p_section: null, p_base_unit: kind === "sold" ? null : "kg", p_sales_unit: null, p_purchase_unit: null, p_storage_unit: null, p_is_add_on: false, p_expected_version: null })).data;
    const flour = await save("ingredient", "دقيق تزامن");
    const product = await save("sold", "منتج تزامن");
    const versions = [];
    for (const label of ["race A", "race B"]) {
      const id = (await db.rpc("app_catalog_create_recipe", { p_product: product, p_label: label, p_copy_from: null, p_note: null })).data;
      const version = rows(`select version from public.recipe_versions where id = '${id}'`)[0].version;
      await db.rpc("app_catalog_save_recipe_line", { p_version: id, p_line: null, p_component: flour, p_quantity: "0.5", p_unit: "kg", p_note: null, p_expected_version: version });
      versions.push({ id, version: rows(`select version from public.recipe_versions where id = '${id}'`)[0].version });
    }
    const results = await Promise.all(versions.map((v) => clientFromJar(env, admin).rpc("app_catalog_approve_recipe", { p_version: v.id, p_from: "2026-03-01", p_to: null, p_expected_version: v.version })));
    const failures = results.filter((r) => r.error);
    check("exactly one of two simultaneous approvals succeeds", failures.length === 1 && failures[0].error.code === "23P01", JSON.stringify(results.map((r) => r.error?.code ?? "ok")));
    check("and the date has one approved recipe", rows(`select count(*) as n from public.recipe_versions where product_id = '${product}' and status = 'approved'`)[0].n === 1);
  }

  // ============================================================ 8. permissions
  section("8. Permissions are live and enforced in the database");
  {
    const cashierDb = clientFromJar(env, cashier.jar);
    const keeperDb = clientFromJar(env, keeper.jar);
    const items = await cashierDb.from("catalog_items").select("id").limit(1);
    check("a cashier reads no catalog rows", !items.error && items.data.length === 0);
    const write = await cashierDb.rpc("app_catalog_save_item", { p_id: null, p_kind: "ingredient", p_name_ar: "x", p_name_en: null, p_code: null, p_section: null, p_base_unit: "kg", p_sales_unit: null, p_purchase_unit: null, p_storage_unit: null, p_is_add_on: false, p_expected_version: null });
    check("a cashier cannot create an item", write.error?.code === "42501", JSON.stringify(write.error));
    const keeperItems = await keeperDb.from("catalog_items").select("id", { count: "exact", head: true });
    check("a storekeeper reads the items (inventory.view) but not the mappings or the queue", !keeperItems.error && keeperItems.count > 500);
    const labels = await keeperDb.from("catalog_source_labels").select("id").limit(1);
    const queue = await keeperDb.from("catalog_review_items").select("id").limit(1);
    check("and sees no mappings or review entries", labels.data.length === 0 && queue.data.length === 0);
    const keeperWrite = await keeperDb.rpc("app_catalog_answer_date_decision", { p_key: "nov-2026-recipe-set", p_date: "2026-11-05", p_evidence: "x" });
    check("a storekeeper cannot answer the date question", keeperWrite.error?.code === "42501");
    const keeperCheck = await keeperDb.rpc("app_catalog_consumption", { p_branch: "maarif", p_date: "2026-11-05", p_lines: [{ label: "بظابيظو مانجو كبير", quantity: "1" }] });
    check("a storekeeper may run the eligibility check", !keeperCheck.error && keeperCheck.data.eligible === 1, JSON.stringify(keeperCheck.error));
    const cashierCheck = await cashierDb.rpc("app_catalog_consumption", { p_branch: "maarif", p_date: "2026-11-05", p_lines: [] });
    check("a cashier may not", cashierCheck.error?.code === "42501");
    const anon = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/catalog_items?select=id&limit=1`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } });
    check("an anonymous request to the table is refused", anon.status === 401 || anon.status === 403 || (await anon.text()) === "[]", String(anon.status));
    const direct = await clientFromJar(env, admin).from("recipe_lines").update({ quantity_num: 99 }).eq("version_id", "00000000-0000-0000-0000-000000000000");
    check("even the administrator cannot write the tables directly", direct.error?.code === "42501", JSON.stringify(direct.error));

    // Removing the permission blocks the next request of the same open session.
    psql(`insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('${keeper.id}', null, 'system_admin');`);
    const granted = await get(keeper.jar, "/en/catalog");
    check("granting recipes.manage opens the page to the open session", granted.status === 200, String(granted.status));
    psql(`delete from public.staff_group_assignments where staff_id = '${keeper.id}' and group_key = 'system_admin';`);
    const revoked = await get(keeper.jar, "/en/catalog");
    const revokedAction = await get(keeper.jar, "/en/catalog/review");
    check("removing it blocks the very next request, page and queue alike", revoked.status === 403 && revokedAction.status === 403, `${revoked.status} ${revokedAction.status}`);
  }

  // ============================================================ 9. audit
  section("9. Every change is in the audit history, in both languages");
  {
    const audit = { data: rows("select action, actor_name from public.audit_log where action like 'catalog.%'") };
    const actions = new Set(audit.data.map((a) => a.action));
    const expected = ["catalog.item_saved", "catalog.conversion_saved", "catalog.mapping_decided", "catalog.names_queued", "catalog.recipe_created", "catalog.recipe_line_saved", "catalog.recipe_approved", "catalog.recipe_range_closed", "catalog.item_status_changed", "catalog.date_decision_answered"];
    check("each kind of catalog change was audited", expected.every((a) => actions.has(a)), [...actions].join(","));
    check("by the administrator, never anonymously", audit.data.every((a) => a.actor_name === "Catalog Admin"));
    const page = await get(admin, "/en/admin/audit");
    check("the English audit screen names them", /Recipe version approved/.test(page.html));
    const ar = await get(admin, "/ar/admin/audit");
    check("and the Arabic one", /تم اعتماد نسخة وصفة/.test(ar.html));
  }
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
console.log(`\n${state.checks - state.failures}/${state.checks} checks passed.`);
if (state.failures || failure) {
  console.log(`Failed: ${state.names.join("; ")}`);
  process.exit(1);
}
