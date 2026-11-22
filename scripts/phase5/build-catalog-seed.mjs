// Regenerates supabase/seed_catalog.sql from fixtures/catalog/legacy-catalog.json.
// Usage: node scripts/phase5/build-catalog-seed.mjs [--check]
//   --check  fail (exit 1) when supabase/seed_catalog.sql is not up to date
//
// The fixture comes from the two inventory workbooks (scripts/phase5/extract_catalog.py). Everything it
// loads is a DRAFT or a pending proposal, except the cases Abdo confirmed on 22 November 2026:
//   P1-28  the Dubai chocolate cake aliases (approved mapping, both original labels kept)
//   P1-31  mixed nuts «عدد» rows read as kilograms (unit approved, original label kept)
//   P1-32  the six plastic spoons in the November large Bazabizo Mango recipe (a line of the draft)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ORG = "00000000-0000-4000-8000-000000000001";
const NAMESPACE = "6f1b8e0a-5d7e-4f10-9c55-2b7a3f6d9a11";
export const DATE_DECISION_KEY = "nov-2026-recipe-set";
const DECISION_BASIS = "Abdo, 22 November 2026 (docs/ABDO_WORKFLOW_DECISIONS.md)";

const ENGLISH = new Map([
  ["مكسرات مشكلة", "Mixed nuts"],
  ["ملاعق بلاستيك للارز - مستورد", "Plastic rice spoons (imported)"],
  ["بظابيظو مانجو كبير", "Bazabizo Mango (large)"],
  ["كيكة هبة دبى شيكولاتة صغيرة", "Dubai chocolate cake"],
]);

function uuid5(name) {
  const bytes = createHash("sha1").update(Buffer.from(NAMESPACE.replaceAll("-", ""), "hex")).update(name, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Mirror of app_private.catalog_label_key(); tests/catalog-seed.test.ts compares it with the database result.
export function labelKey(value) {
  return String(value ?? "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, " ").trim().toLowerCase();
}

const q = (value) => (value === null || value === undefined ? "null" : `'${String(value).replaceAll("'", "''")}'`);
const json = (value) => `${q(JSON.stringify(value))}::jsonb`;
const bool = (value) => (value ? "true" : "false");

function insert(table, columns, rows) {
  if (rows.length === 0) return "";
  const out = [];
  for (let i = 0; i < rows.length; i += 200) {
    out.push(`insert into public.${table} (${columns.join(", ")}) values\n  ${rows.slice(i, i + 200).map((r) => `(${r.join(", ")})`).join(",\n  ")};\n`);
  }
  return out.join("\n");
}

export function buildCatalogSeed(fixture) {
  const sources = fixture.sources;
  const sourceId = (month) => sources[month].id;
  const rowRef = (month, row) => `${sourceId(month)} '${sources[month].sheet}'!D${row}:G${row}`;
  const itemId = (legacyKey) => uuid5(`item:${legacyKey}`);
  const sections = [];
  const seen = new Set();

  // ------------------------------------------------------------------ items
  const items = [];
  const productByKey = new Map(fixture.products.map((p) => [p.key, p]));
  for (const c of [...fixture.inventory_components].sort((a, b) => (a.inventory_row ?? 1e9) - (b.inventory_row ?? 1e9) || a.name.localeCompare(b.name))) {
    items.push([
      q(itemId(`component:${c.name}`)), q(ORG), q(c.kind), "false", q(c.name), q(ENGLISH.get(c.name) ?? null), q(c.section),
      q(`component:${c.name}`), q(c.base_unit), "null", bool(c.stock_tracked),
    ]);
  }
  const soldRows = [];
  for (const p of [...fixture.products].sort((a, b) => a.key.localeCompare(b.key))) {
    soldRows.push([
      q(itemId(p.key)), q(ORG), "'sold'", bool(p.is_add_on), q(p.name), q(ENGLISH.get(p.name) ?? null), q(p.section),
      q(p.key), "'pc'", "'pc'", "false",
    ]);
  }
  const itemColumns = ["id", "organization_id", "kind", "is_add_on", "name_ar", "name_en", "section_label", "legacy_key", "base_unit", "sales_unit", "stock_tracked"];
  sections.push(insert("catalog_items", itemColumns, items));
  sections.push(insert("catalog_items", itemColumns, soldRows));

  // ------------------------------------------------------------------ labels (what each source called things)
  const labelRows = [];
  const addLabel = (source, label, key, status, sourceRef, basis) => {
    const id = uuid5(`label:${source}:${label}:${key ?? ""}`);
    if (seen.has(id)) return;
    seen.add(id);
    labelRows.push([q(id), q(ORG), q(source), q(label), key ? q(itemId(key)) : "null", q(status), q(sourceRef), q(basis), status === "pending" ? "null" : "now()"]);
  };
  for (const c of fixture.inventory_components) {
    if (c.stock_tracked) addLabel("inventory_workbook", c.name, `component:${c.name}`, "approved", `${sourceId("nov")} '2'!M${c.inventory_row}`, "Name of this item in the inventory list");
    for (const alias of c.aliases) addLabel("recipe_workbook", alias, `component:${c.name}`, "approved", "recipe lines, column E", "Spelling variant that folds to the same name");
  }
  for (const p of fixture.products) {
    if (p.link === "named") {
      const month = p.rows.nov ? "nov" : "oct";
      addLabel("inventory_workbook", p.name, p.key, "approved", `${sourceId(month)} '2'!D${p.rows[month]}`, "Name of this item in the Product Mix section");
    } else {
      for (const label of p.recipe_labels) addLabel("recipe_workbook", label, p.key, "approved", "recipe lines, column D", "Recipe label of an item with no Product Mix name");
    }
  }

  // Abdo's confirmed P1-28 alias. Both Foodics spellings and both workbook-side spellings are kept.
  const cakeKey = "named:الهبة:كيكة هبة دبى شيكولاتة صغيرة";
  if (!productByKey.has(cakeKey)) throw new Error("The Dubai chocolate cake row is missing from the fixture.");
  const cakeBasis = `${DECISION_BASIS} P1-28, 02:38:27: the Foodics large and the workbook small Dubai chocolate cake are one product`;
  addLabel("foodics", "كيكة الهبة دبي شيكولاتة كبيرة", cakeKey, "approved", "docs/ABDO_WORKFLOW_DECISIONS.md, P1-28", cakeBasis);
  addLabel("foodics", "كيكة الهبة دبي شيكولاتة كبير", cakeKey, "approved", "Foodics Product Mix 2026-11-07, as read from the photo (quantity 109, 5,450.00)", cakeBasis);
  addLabel("decision_record", "كيكة الهبة دبي شيكولاتة صغيرة", cakeKey, "approved", "docs/ABDO_WORKFLOW_DECISIONS.md, P1-28", cakeBasis);

  // The other Foodics lines compared in Phase 1 stay proposals: only the cake was confirmed by Abdo.
  const productByLabel = new Map();
  for (const p of fixture.products) if (p.link === "named") productByLabel.set(labelKey(p.name), p);
  const foodicsReview = [];
  for (const line of fixture.foodics_lines) {
    const key = labelKey(line.label);
    if (labelKey(line.label.replace(/كبير$/, "كبيرة")) === labelKey("كيكة الهبة دبي شيكولاتة كبيرة")) continue; // the confirmed cake
    let target = productByLabel.get(labelKey(line.workbook_label.replace(/\s*\(.*$/, "")));
    if (!target && line.label.startsWith("جيلاتوتي روما")) target = productByKey.get("unnamed:202") ?? null;
    const kinder = line.label.includes("كيندر");
    const kind = kinder ? "unconfirmed_mapping" : "unmapped_name";
    const basis = kinder
      ? "Phase 1 P1-29: size differs (Foodics large, workbook small); the workbook quantity 12 is kept as Abdo decided"
      : "Phase 1 team check: same name on both sides; waiting for approval";
    addLabel("foodics", line.label, target?.key ?? null, "pending", "Foodics Product Mix 2026-11-07", basis);
    foodicsReview.push({
      kind, subject: line.label, product: target?.key ?? null, dedupe: `name:foodics:${key}`,
      refs: [
        { source: "Foodics Product Mix 2026-11-07", label: line.label, quantity: line.quantity, amount: line.amount },
        { source: line.workbook_cell, label: line.workbook_label },
      ],
      detail: { phase1_mapping: line.phase1_mapping, note: line.note },
    });
  }
  sections.push(insert("catalog_source_labels",
    ["id", "organization_id", "source_system", "label", "item_id", "status", "source_ref", "basis", "decided_at"], labelRows));

  // ------------------------------------------------------------------ the one question that gates the November set
  const decisionId = uuid5(`decision:${DATE_DECISION_KEY}`);
  sections.push(insert("catalog_date_decisions", ["id", "organization_id", "key", "question_ar", "question_en"], [[
    q(decisionId), q(ORG), q(DATE_DECISION_KEY), q("نسخة وصفات نوفمبر بدأ العمل بيها من يوم كام؟"),
    q("On which day did the November recipe set start to be used?"),
  ]]));

  // ------------------------------------------------------------------ recipes (drafts)
  const versionRows = [];
  const lineRows = [];
  const versionNumbers = new Map();
  for (const v of fixture.versions) {
    const productKey = v.product;
    const number = (versionNumbers.get(productKey) ?? 0) + 1;
    versionNumbers.set(productKey, number);
    const id = uuid5(`version:${productKey}:${number}`);
    const month = v.months.length === 1 ? v.months[0] : null;
    const role = !v.affected_by_nov_date ? null : month === "nov" ? "starts_on" : "ends_before";
    const versionSources = v.months.map((m) => ({ source: sourceId(m), sheet: sources[m].sheet, file: sources[m].file, sha256: sources[m].sha256 }));
    versionRows.push([
      q(id), q(ORG), q(itemId(productKey)), String(number), q(v.label), "'draft'",
      role ? q(decisionId) : "null", q(role), json(versionSources),
      q(v.affected_by_nov_date ? "Differs between the October and November workbooks; its effective date waits for Abdo's answer." : null),
    ]);
    v.lines.forEach((line, index) => {
      const lineMonth = line.month;
      lineRows.push([
        q(uuid5(`line:${id}:${index + 1}`)), q(ORG), q(id), String(index + 1),
        line.component ? q(itemId(`component:${line.component}`)) : "null",
        line.quantity ? String(line.quantity.num) : "null", line.quantity ? String(line.quantity.den) : "null",
        q(line.unit_code), q(line.unit_label), q(line.unit_resolution), q(line.recipe_label),
        q(rowRef(lineMonth, line.row) + (line.component_source && line.component_source !== line.component ? ` (written «${line.component_source}»)` : "")),
      ]);
    });
  }
  sections.push(insert("recipe_versions",
    ["id", "organization_id", "product_id", "version_no", "label", "status", "date_decision_id", "decision_role", "sources", "note"], versionRows));
  sections.push(insert("recipe_lines",
    ["id", "organization_id", "version_id", "line_no", "component_id", "quantity_num", "quantity_den", "unit_code", "source_unit_label",
      "unit_resolution", "source_label", "source_ref"], lineRows));

  // ------------------------------------------------------------------ review queue
  const reviewRows = [];
  const usedKeys = new Set();
  const addReview = (r) => {
    let dedupe = r.dedupe;
    for (let n = 2; usedKeys.has(dedupe); n += 1) dedupe = `${r.dedupe}#${n}`;
    usedKeys.add(dedupe);
    const item = r.component ? itemId(`component:${r.component}`) : r.product ? itemId(r.product) : null;
    reviewRows.push([
      q(uuid5(`review:${dedupe}`)), q(ORG), q(r.kind), q(r.status ?? "open"), q(r.subject), q(item), json(r.refs ?? []), json(r.detail ?? {}), q(dedupe),
      r.resolution ? "now()" : "null", q(r.resolution ?? null),
    ]);
  };
  for (const r of fixture.review_items) {
    addReview({ ...r, dedupe: `${r.kind}:${r.component ?? r.product ?? r.subject}:${r.refs?.[0]?.source ?? ""}:${r.refs?.[0]?.row ?? ""}`,
      detail: r.base_unit !== undefined ? { base_unit: r.base_unit } : {} });
  }
  for (const r of foodicsReview) addReview(r);
  addReview({
    kind: "recipe_effective_date", subject: "نسخة وصفات نوفمبر بدأ العمل بيها من يوم كام؟", dedupe: DATE_DECISION_KEY,
    refs: [{ source: "SRC-06 / SRC-07", sheet: "2", note: "Versions that differ between the October and November recipe lists" }],
    detail: { question_en: "On which day did the November recipe set start to be used?", finding: "P1-32" },
  });
  // Cases Abdo already confirmed stay in the queue as resolved, so the evidence travels with them.
  addReview({
    kind: "unconfirmed_mapping", status: "resolved", subject: "كيكة الهبة دبي شيكولاتة", product: cakeKey, dedupe: "resolved:p1-28-dubai-chocolate-cake",
    refs: [
      { source: "Foodics Product Mix 2026-11-07", label: "كيكة الهبة دبي شيكولاتة كبير", quantity: 109, amount: "5450.00" },
      { source: `${sourceId("nov")} '2'!D${productByKey.get(cakeKey).rows.nov}`, label: "كيكة هبة دبى شيكولاتة صغيرة" },
    ],
    resolution: `${DECISION_BASIS} P1-28: same product. The separate Kinder cake line is not covered.`,
  });
  addReview({
    kind: "unit_conflict", status: "resolved", subject: "مكسرات مشكلة", component: "مكسرات مشكلة", dedupe: "resolved:p1-31-mixed-nuts",
    refs: fixture.resolved_refs.abdo_p1_31, detail: { approved_unit: "kg", original_label: "عدد" },
    resolution: `${DECISION_BASIS} P1-31, 02:38:27: mixed nuts are measured in kilograms; quantities unchanged, original label kept`,
  });
  sections.push(insert("catalog_review_items",
    ["id", "organization_id", "kind", "status", "subject", "item_id", "refs", "detail", "dedupe_key", "resolved_at", "resolution"], reviewRows));

  return `-- GENERATED by scripts/phase5/build-catalog-seed.mjs from fixtures/catalog/legacy-catalog.json (${fixture.version}).
-- Do not edit by hand. Run \`npm run seed:catalog\` after changing the fixture.
-- Legacy catalog and recipes read from the October and November inventory workbooks (SRC-06, SRC-07).
-- Every recipe is a DRAFT and every Foodics mapping except the cake alias confirmed by Abdo (P1-28) is pending.
-- Applied by \`supabase db reset\` after supabase/seed.sql, on a LOCAL development database. A reset to an older
-- migration (the upgrade tests) has no catalog tables yet, so the block does nothing there.

do $catalog_seed$
begin
  if to_regclass('public.catalog_items') is null then
    return;
  end if;

${sections.filter(Boolean).join("\n")}
end;
$catalog_seed$;
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = JSON.parse(readFileSync(path.join(root, "fixtures", "catalog", "legacy-catalog.json"), "utf8"));
  const seedPath = path.join(root, "supabase", "seed_catalog.sql");
  const sql = buildCatalogSeed(fixture);
  if (process.argv.includes("--check")) {
    const current = existsSync(seedPath) ? readFileSync(seedPath, "utf8").split("\r\n").join("\n") : "";
    if (current !== sql) {
      console.error("supabase/seed_catalog.sql is out of date. Run: npm run seed:catalog");
      process.exit(1);
    }
    console.log("supabase/seed_catalog.sql is up to date.");
  } else {
    writeFileSync(seedPath, sql, "utf8");
    console.log(`Wrote ${path.relative(root, seedPath)} (${sql.split("\n").length} lines).`);
  }
}
