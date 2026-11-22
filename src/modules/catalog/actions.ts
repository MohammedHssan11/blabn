"use server";

import { redirect } from "next/navigation";
import { isBusinessDate } from "@/lib/dates";
import { createUserClient } from "@/lib/supabase/server";
import { localeField, textField } from "@/modules/access/forms";
import { requireAccess } from "@/modules/access/guard";
import { isCatalogId, mapCatalogError, normalizeQuantityInput, safeCatalogPath } from "./forms";

/**
 * Every catalog change goes through a database command that checks `recipes.manage` itself and writes
 * the audit entry in the same transaction. These actions authorize first (so a person without the
 * permission is turned away before anything is sent), then forward the form.
 */

const REQUIRE = { permission: "recipes.manage" } as const;

interface Context {
  locale: ReturnType<typeof localeField>;
  back: string;
  data: FormData;
}

async function begin(data: FormData, fallback: string): Promise<Context> {
  const locale = localeField(data);
  const base = `/${locale}/catalog${fallback}`;
  const back = safeCatalogPath(locale, textField(data, "back"), base);
  await requireAccess({ locale, path: back, require: REQUIRE });
  return { locale, back, data };
}

function withParam(path: string, name: string, value: string): string {
  const [rest = "", hash] = path.split("#");
  const url = new URL(rest, "http://site.invalid");
  url.searchParams.delete("error");
  url.searchParams.delete("notice");
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}${hash ? `#${hash}` : ""}`;
}

function finish(context: Context, result: { error: { code?: string } | null }, notice: string, to?: string): never {
  if (result.error) redirect(withParam(context.back, "error", mapCatalogError(result.error.code)));
  redirect(withParam(to ?? context.back, "notice", notice));
}

const text = (context: Context, name: string) => textField(context.data, name);
const optional = (context: Context, name: string) => textField(context.data, name) || null;
const uuid = (context: Context, name: string): string | null => {
  const value = text(context, name);
  return isCatalogId(value) ? value : null;
};
const counter = (context: Context, name: string): number | null => {
  const value = Number(text(context, name));
  return Number.isInteger(value) && value >= 0 ? value : null;
};
function invalid(context: Context): never {
  redirect(withParam(context.back, "error", "invalid_input"));
}

export async function saveItemAction(data: FormData): Promise<void> {
  const c = await begin(data, "");
  const id = text(c, "id") === "" ? null : uuid(c, "id");
  if (text(c, "id") !== "" && id === null) invalid(c);
  const kind = text(c, "kind");
  if (!["sold", "ingredient", "packaging"].includes(kind) || text(c, "name_ar") === "") invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_save_item", {
    p_id: id, p_kind: kind, p_name_ar: text(c, "name_ar"), p_name_en: optional(c, "name_en"), p_code: optional(c, "code"),
    p_section: optional(c, "section"), p_base_unit: optional(c, "base_unit"), p_sales_unit: optional(c, "sales_unit"),
    p_purchase_unit: optional(c, "purchase_unit"), p_storage_unit: optional(c, "storage_unit"),
    p_is_add_on: c.data.has("is_add_on"), p_expected_version: id ? counter(c, "version") : null,
  });
  if (result.error) finish(c, result, "");
  const saved = result.data as string;
  finish(c, result, "catalog_item_saved", `/${c.locale}/catalog/items/${saved}`);
}

export async function setItemStatusAction(data: FormData): Promise<void> {
  const c = await begin(data, "");
  const id = uuid(c, "id");
  const status = text(c, "status");
  const on = text(c, "on");
  if (!id || !["active", "discontinued"].includes(status) || (status === "discontinued" && !isBusinessDate(on))) invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_set_item_status", {
    p_id: id, p_status: status, p_on: status === "discontinued" ? on : null, p_expected_version: counter(c, "version"),
  });
  finish(c, result, "catalog_item_saved");
}

export async function saveConversionAction(data: FormData): Promise<void> {
  const c = await begin(data, "");
  const item = uuid(c, "item");
  const quantity = normalizeQuantityInput(text(c, "quantity"));
  if (!item || quantity === null || text(c, "unit") === "" || text(c, "basis") === "") invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_save_conversion", { p_item: item, p_unit: text(c, "unit"), p_quantity: quantity, p_basis: text(c, "basis") });
  finish(c, result, "catalog_conversion_saved");
}

export async function mapNameAction(data: FormData): Promise<void> {
  const c = await begin(data, "/review");
  const decision = text(c, "decision");
  const item = text(c, "item") === "" ? null : uuid(c, "item");
  if (!["approve", "reject", "propose"].includes(decision) || text(c, "label") === "" || (text(c, "item") !== "" && item === null)) invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_map_name", {
    p_source: optional(c, "source") ?? "foodics", p_label: text(c, "label"), p_item: item, p_decision: decision, p_basis: text(c, "basis"),
  });
  finish(c, result, "catalog_mapping_saved");
}

export async function resolveReviewAction(data: FormData): Promise<void> {
  const c = await begin(data, "/review");
  const id = uuid(c, "id");
  const status = text(c, "status");
  if (!id || !["open", "resolved", "dismissed"].includes(status)) invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_resolve_review", { p_id: id, p_status: status, p_note: text(c, "note") });
  finish(c, result, "catalog_review_saved");
}

export async function answerDateAction(data: FormData): Promise<void> {
  const c = await begin(data, "/review");
  const date = text(c, "date");
  if (!isBusinessDate(date) || text(c, "key") === "" || text(c, "evidence") === "") invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_answer_date_decision", { p_key: text(c, "key"), p_date: date, p_evidence: text(c, "evidence") });
  finish(c, result, "catalog_date_answered");
}

export async function createRecipeAction(data: FormData): Promise<void> {
  const c = await begin(data, "/recipes");
  const product = uuid(c, "product");
  const copy = text(c, "copy_from") === "" ? null : uuid(c, "copy_from");
  if (!product || text(c, "label") === "" || (text(c, "copy_from") !== "" && copy === null)) invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_create_recipe", { p_product: product, p_label: text(c, "label"), p_copy_from: copy, p_note: optional(c, "note") });
  finish(c, result, "catalog_recipe_created");
}

export async function saveLineAction(data: FormData): Promise<void> {
  const c = await begin(data, "/recipes");
  const version = uuid(c, "version");
  const line = text(c, "line") === "" ? null : uuid(c, "line");
  const component = uuid(c, "component");
  const quantity = normalizeQuantityInput(text(c, "quantity"));
  if (!version || !component || quantity === null || (text(c, "line") !== "" && line === null)) invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_save_recipe_line", {
    p_version: version, p_line: line, p_component: component, p_quantity: quantity, p_unit: optional(c, "unit"),
    p_note: optional(c, "note"), p_expected_version: counter(c, "rv"),
  });
  finish(c, result, "catalog_line_saved");
}

export async function removeLineAction(data: FormData): Promise<void> {
  const c = await begin(data, "/recipes");
  const line = uuid(c, "line");
  if (!line) invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_remove_recipe_line", { p_line: line, p_expected_version: counter(c, "rv") });
  finish(c, result, "catalog_line_removed");
}

export async function recipeDetailsAction(data: FormData): Promise<void> {
  const c = await begin(data, "/recipes");
  const version = uuid(c, "version");
  const rawYield = text(c, "yield");
  const parsedYield = rawYield === "" ? "" : normalizeQuantityInput(rawYield);
  if (!version || text(c, "label") === "" || parsedYield === null) invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_set_recipe_meta", {
    p_version: version, p_label: text(c, "label"), p_yield: parsedYield, p_note: optional(c, "note"), p_expected_version: counter(c, "rv"),
  });
  finish(c, result, "catalog_recipe_saved");
}

export async function approveRecipeAction(data: FormData): Promise<void> {
  const c = await begin(data, "/recipes");
  const version = uuid(c, "version");
  const from = text(c, "from");
  const to = text(c, "to");
  if (!version || !isBusinessDate(from) || (to !== "" && !isBusinessDate(to))) invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_approve_recipe", { p_version: version, p_from: from, p_to: to === "" ? null : to, p_expected_version: counter(c, "rv") });
  finish(c, result, "catalog_recipe_approved");
}

export async function withdrawRecipeAction(data: FormData): Promise<void> {
  const c = await begin(data, "/recipes");
  const version = uuid(c, "version");
  if (!version || text(c, "note") === "") invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_withdraw_recipe", { p_version: version, p_note: text(c, "note") });
  finish(c, result, "catalog_recipe_withdrawn");
}

export async function queueNamesAction(data: FormData): Promise<void> {
  const c = await begin(data, "/consumption");
  const names = c.data.getAll("name").filter((n): n is string => typeof n === "string").map((n) => n.trim()).filter(Boolean).slice(0, 200);
  if (names.length === 0) invalid(c);
  const client = await createUserClient();
  const result = await client.rpc("app_catalog_queue_names", { p_labels: names });
  finish(c, result, "catalog_names_queued");
}
