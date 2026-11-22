import "server-only";
import { createUserClient } from "@/lib/supabase/server";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { isCatalogId, type ItemKind, type ReviewKind } from "./forms";

/** Reads for the catalog screens. Everything goes through the signed-in person's own Supabase session. */

export interface Unit {
  code: string;
  dimension: "mass" | "volume" | "count" | "pack";
  name_ar: string;
  name_en: string;
}

export interface CatalogItem {
  id: string;
  kind: ItemKind;
  is_add_on: boolean;
  code: string | null;
  name_ar: string;
  name_en: string | null;
  section_label: string | null;
  base_unit: string | null;
  sales_unit: string | null;
  purchase_unit: string | null;
  storage_unit: string | null;
  stock_tracked: boolean;
  status: "active" | "discontinued";
  discontinued_on: string | null;
  version: number;
}

export interface SourceLabel {
  id: string;
  source_system: string;
  label: string;
  item_id: string | null;
  status: "pending" | "approved" | "rejected";
  source_ref: string | null;
  basis: string | null;
}

export interface Conversion {
  id: string;
  unit_code: string;
  to_base_num: string;
  to_base_den: string;
  basis: string;
}

export interface SourceRef {
  source?: string;
  sheet?: string;
  row?: number;
  cell?: string;
  recipe?: string;
  label?: string;
  unit_label?: string | null;
  quantity?: string | number | null;
  amount?: string;
  written?: string;
  note?: string;
}

export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  status: "open" | "resolved" | "dismissed";
  subject: string;
  item_id: string | null;
  refs: SourceRef[];
  detail: Record<string, unknown>;
  dedupe_key: string;
  resolution: string | null;
  resolved_at: string | null;
}

export interface DateDecision {
  id: string;
  key: string;
  question_ar: string;
  question_en: string;
  answered_date: string | null;
  evidence: string | null;
  decided_at: string | null;
}

export interface RecipeLine {
  id: string;
  line_no: number;
  component_id: string | null;
  quantity_num: string | null;
  quantity_den: string | null;
  unit_code: string | null;
  source_unit_label: string | null;
  unit_resolution: string | null;
  source_label: string | null;
  source_ref: string | null;
  note: string | null;
  component: { name_ar: string; name_en: string | null; kind: ItemKind; base_unit: string | null } | null;
}

export interface RecipeVersion {
  id: string;
  product_id: string;
  version_no: number;
  label: string;
  status: "draft" | "approved" | "withdrawn";
  effective_from: string | null;
  effective_to: string | null;
  yield_num: string;
  yield_den: string;
  date_decision_id: string | null;
  decision_role: "starts_on" | "ends_before" | null;
  sources: Array<{ source: string; sheet: string; file?: string }>;
  note: string | null;
  version: number;
  recipe_lines: RecipeLine[];
}

export interface Consumption {
  date: string;
  eligible: number;
  blocked: number;
  lines: ConsumptionLine[];
  totals: Array<{ item_id: string; name_ar: string; name_en: string | null; kind: ItemKind; base_unit: string; quantity: Fraction }>;
}

export interface Fraction {
  num: string;
  den: string;
  decimal: string;
  exact: boolean;
}

export interface ConsumptionLine {
  index: number;
  ref: string | null;
  label: string | null;
  quantity: string | null;
  status: "eligible" | "blocked";
  reasons: Array<{ code: string; detail?: string; line_no?: number; component_ar?: string; component_en?: string | null; unit?: string; base_unit?: string; source_ref?: string }>;
  warnings: Array<{ code: string; detail?: string }>;
  product: { id: string; name_ar: string; name_en: string | null } | null;
  mapping_id: string | null;
  recipe: { id: string; version_no: number; label: string; effective_from: string; effective_to: string | null } | null;
  components: Array<{ line_no: number; item_id: string; kind: ItemKind; name_ar: string; name_en: string | null; base_unit: string; quantity: Fraction; recipe_quantity: Fraction; recipe_unit: string; source_ref: string | null }>;
}

const ITEM_COLUMNS =
  "id, kind, is_add_on, code, name_ar, name_en, section_label, base_unit, sales_unit, purchase_unit, storage_unit, stock_tracked, status, discontinued_on, version";
export const PAGE_SIZE = 100;

function failed(what: string, error: { code?: string }): never {
  throw new Error(`${what} could not be read (${error.code ?? "unknown"}).`);
}

/** Characters that would change a PostgREST filter are removed; a name never needs them. */
function plainSearch(value: string): string {
  return value.replace(/[%,()*\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function readUnits(): Promise<Unit[]> {
  const client = await createUserClient();
  const { data, error } = await client.from("catalog_units").select("code, dimension, name_ar, name_en").order("dimension").order("code");
  if (error) failed("Units", error);
  return data as Unit[];
}

export async function listItems(filter: { kind?: ItemKind; status?: string; q?: string; page?: number }): Promise<{ items: CatalogItem[]; total: number }> {
  const client = await createUserClient();
  const page = Math.max(1, filter.page ?? 1);
  let query = client.from("catalog_items").select(ITEM_COLUMNS, { count: "exact" }).order("kind").order("name_ar").order("id");
  if (filter.kind) query = query.eq("kind", filter.kind);
  if (filter.status === "active" || filter.status === "discontinued") query = query.eq("status", filter.status);
  const search = plainSearch(filter.q ?? "");
  if (search) query = query.or(`name_ar.ilike.*${search}*,name_en.ilike.*${search}*,code.ilike.*${search}*`);
  const { data, error, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) failed("Catalog items", error);
  return { items: data as CatalogItem[], total: count ?? 0 };
}

export async function readItem(id: string): Promise<CatalogItem | null> {
  if (!isCatalogId(id)) return null;
  const client = await createUserClient();
  const { data, error } = await client.from("catalog_items").select(ITEM_COLUMNS).eq("id", id).maybeSingle();
  if (error) failed("Catalog item", error);
  return (data as CatalogItem | null) ?? null;
}

export async function readItemDetails(id: string) {
  const client = await createUserClient();
  const [conversions, labels, usage] = await Promise.all([
    client.from("catalog_item_conversions").select("id, unit_code, to_base_num::text, to_base_den::text, basis").eq("item_id", id).order("unit_code"),
    client.from("catalog_source_labels").select("id, source_system, label, item_id, status, source_ref, basis").eq("item_id", id).order("source_system").order("label"),
    client.from("recipe_lines").select("id", { count: "exact", head: true }).eq("component_id", id),
  ]);
  if (conversions.error) failed("Conversions", conversions.error);
  if (labels.error) failed("Source labels", labels.error);
  return {
    conversions: conversions.data as Conversion[],
    labels: labels.data as SourceLabel[],
    recipeLines: usage.count ?? 0,
  };
}

export async function listBriefItems(kind: "sold" | "component"): Promise<Array<Pick<CatalogItem, "id" | "kind" | "name_ar" | "name_en" | "base_unit" | "section_label" | "status">>> {
  const client = await createUserClient();
  let query = client.from("catalog_items").select("id, kind, name_ar, name_en, base_unit, section_label, status").order("name_ar").order("id").limit(2000);
  query = kind === "sold" ? query.eq("kind", "sold") : query.in("kind", ["ingredient", "packaging"]);
  const { data, error } = await query;
  if (error) failed("Catalog items", error);
  return data as Array<Pick<CatalogItem, "id" | "kind" | "name_ar" | "name_en" | "base_unit" | "section_label" | "status">>;
}

export async function listReviewItems(filter: { kind?: ReviewKind; status?: string; limit?: number }): Promise<{ items: ReviewItem[]; counts: Record<string, number> }> {
  const client = await createUserClient();
  let query = client.from("catalog_review_items")
    .select("id, kind, status, subject, item_id, refs, detail, dedupe_key, resolution, resolved_at")
    .order("kind").order("subject").order("id").limit(filter.limit ?? 150);
  if (filter.kind) query = query.eq("kind", filter.kind);
  if (filter.status === "open" || filter.status === "resolved" || filter.status === "dismissed") query = query.eq("status", filter.status);
  const [rows, open] = await Promise.all([query, client.from("catalog_review_items").select("kind").eq("status", "open").limit(5000)]);
  if (rows.error) failed("Review queue", rows.error);
  if (open.error) failed("Review queue", open.error);
  const counts: Record<string, number> = {};
  for (const row of open.data as Array<{ kind: string }>) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
  return { items: rows.data as ReviewItem[], counts };
}

export async function openReviewCount(): Promise<number> {
  const client = await createUserClient();
  const { count, error } = await client.from("catalog_review_items").select("id", { count: "exact", head: true }).eq("status", "open");
  if (error) failed("Review queue", error);
  return count ?? 0;
}

export async function readDateDecisions(): Promise<DateDecision[]> {
  const client = await createUserClient();
  const { data, error } = await client.from("catalog_date_decisions").select("id, key, question_ar, question_en, answered_date, evidence, decided_at").order("key");
  if (error) failed("Date questions", error);
  return data as DateDecision[];
}

export async function listFoodicsLabels(status?: "pending" | "approved" | "rejected"): Promise<SourceLabel[]> {
  const client = await createUserClient();
  let query = client.from("catalog_source_labels").select("id, source_system, label, item_id, status, source_ref, basis").eq("source_system", "foodics").order("label");
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) failed("Foodics names", error);
  return data as SourceLabel[];
}

export interface RecipeSummary {
  product: Pick<CatalogItem, "id" | "name_ar" | "name_en" | "section_label" | "is_add_on" | "status">;
  drafts: number;
  approved: number;
  current: { label: string; effective_from: string; effective_to: string | null } | null;
  gated: boolean;
}

export async function listRecipeSummaries(filter: { q?: string; show?: string }): Promise<RecipeSummary[]> {
  const client = await createUserClient();
  let products = client.from("catalog_items").select("id, name_ar, name_en, section_label, is_add_on, status").eq("kind", "sold").order("section_label").order("name_ar").limit(2000);
  const search = plainSearch(filter.q ?? "");
  if (search) products = products.or(`name_ar.ilike.*${search}*,name_en.ilike.*${search}*`);
  const [soldItems, versions] = await Promise.all([
    products,
    client.from("recipe_versions").select("product_id, status, label, effective_from, effective_to, date_decision_id").limit(5000),
  ]);
  if (soldItems.error) failed("Sold items", soldItems.error);
  if (versions.error) failed("Recipes", versions.error);
  const byProduct = new Map<string, Array<{ status: string; label: string; effective_from: string | null; effective_to: string | null; date_decision_id: string | null }>>();
  for (const v of versions.data as Array<{ product_id: string; status: string; label: string; effective_from: string | null; effective_to: string | null; date_decision_id: string | null }>) {
    byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]);
  }
  const rows = (soldItems.data as RecipeSummary["product"][]).map((product): RecipeSummary => {
    const own = byProduct.get(product.id) ?? [];
    const approved = own.filter((v) => v.status === "approved").sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)));
    return {
      product,
      drafts: own.filter((v) => v.status === "draft").length,
      approved: approved.length,
      current: approved[0] ? { label: approved[0].label, effective_from: approved[0].effective_from as string, effective_to: approved[0].effective_to } : null,
      gated: own.some((v) => v.status === "draft" && v.date_decision_id !== null),
    };
  });
  switch (filter.show) {
    case "approved": return rows.filter((r) => r.approved > 0);
    case "draft": return rows.filter((r) => r.approved === 0 && r.drafts > 0);
    case "none": return rows.filter((r) => r.approved === 0 && r.drafts === 0);
    case "gated": return rows.filter((r) => r.gated);
    default: return rows;
  }
}

export async function readProductRecipes(productId: string): Promise<{ product: CatalogItem; versions: RecipeVersion[]; decisions: DateDecision[] } | null> {
  const product = await readItem(productId);
  if (!product || product.kind !== "sold") return null;
  const client = await createUserClient();
  const [versions, decisions] = await Promise.all([
    client.from("recipe_versions")
      .select("id, product_id, version_no, label, status, effective_from, effective_to, yield_num::text, yield_den::text, date_decision_id, decision_role, sources, note, version, recipe_lines(id, line_no, component_id, quantity_num::text, quantity_den::text, unit_code, source_unit_label, unit_resolution, source_label, source_ref, note, component:catalog_items!component_id(name_ar, name_en, kind, base_unit))")
      .eq("product_id", productId).order("version_no").order("line_no", { referencedTable: "recipe_lines" }),
    readDateDecisions(),
  ]);
  if (versions.error) failed("Recipes", versions.error);
  return { product, versions: versions.data as unknown as RecipeVersion[], decisions };
}

export async function runConsumptionCheck(date: string, lines: Array<{ label: string; quantity: string; ref?: string }>): Promise<Consumption> {
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_consumption", { p_branch: OPERATING_BRANCH_CODE, p_date: date, p_lines: lines });
  if (result.error) throw new Error(`Consumption check failed (${result.error.code ?? "unknown"}).`);
  return result.data as Consumption;
}
