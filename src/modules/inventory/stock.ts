import "server-only";
import { createUserClient } from "@/lib/supabase/server";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import type { Fraction } from "@/modules/catalog/data";

/**
 * Phase 6 reads and the one write path. Everything runs as the signed-in person: the database
 * checks the branch, the permission and the request identifier again, serializes the branch and
 * writes the movement, count or Product Mix change with its audit entry in one transaction.
 * Expected stock, variance and Product Mix reconciliation are calculated by PostgreSQL; the pages
 * only display them.
 */

export type MovementKind =
  | "opening" | "receipt" | "purchase" | "transfer_in" | "return" | "consumption"
  | "waste" | "hospitality" | "deduction" | "transfer_out" | "adjustment";

export interface StockItemDay {
  item_id: string;
  name_ar: string;
  name_en: string | null;
  kind: "ingredient" | "packaging";
  section: string | null;
  base_unit: string;
  schedule: "daily" | "monthly";
  opening: Fraction;
  movements: Partial<Record<MovementKind, Fraction>>;
  expected: Fraction;
  count: { id: string; local: string; quantity: Fraction; entered: string; unit: string } | null;
  expected_at_count: Fraction | null;
  variance: Fraction | null;
  status: "counted" | "missing" | "not_due";
}

export interface StockAdjustment {
  id: string;
  item_id: string;
  direction: 1 | -1;
  quantity: Fraction;
  status: "proposed" | "approved" | "rejected";
  reason: string;
  count_id: string | null;
  local: string;
}

export interface StockDay {
  date: string;
  month_end: boolean;
  items: StockItemDay[];
  adjustments: StockAdjustment[];
  today: string;
  local: string;
}

export interface MixReason {
  code: string;
  detail?: string;
  line_no?: number;
  component_ar?: string;
  component_en?: string | null;
}

export interface MixLine {
  no: number;
  id: string;
  label: string;
  quantity: string;
  amount: number;
  posted: { id: string; recipe_version: string; version_no: number; posting: string; components: Array<{ item_id: string; name_ar: string; name_en: string | null; quantity: Fraction; stock_tracked: boolean }> } | null;
  check: { status: "eligible" | "blocked"; reasons: MixReason[]; recipe: { version_no: number; label: string } | null } | null;
}

export interface ProductMix {
  date: string;
  report: { id: string; net_sales: number; local: string; state: "draft" | "locked"; version: number } | null;
  reconciliation?: { ok: boolean; problems: Array<{ code: string; section?: string; total?: number; lines?: number; net_sales?: number; sections?: number; close_sales?: number }>; sections_total: number; lines_total: number; close_sales: number | null };
  sections?: Array<{ no: number; label: string; total: number; lines: MixLine[] }>;
}

export interface ItemHistory {
  item: { id: string; name_ar: string; name_en: string | null; kind: string; base_unit: string } | null;
  movements: Array<{
    id: string; date: string; kind: MovementKind; quantity: Fraction; entered: string | null; unit: string | null; local: string;
    source: string; reference: string | null; note: string | null; actor: string; posted_at: string; posting: string;
    reverses: string | null; reversed: boolean; recipe_version: string | null; recipe_quantity: Fraction | null; recipe_unit: string | null;
  }>;
  counts: Array<{ id: string; date: string; local: string; quantity: Fraction; entered: string; unit: string; actor: string; posted_at: string; replaces: string | null; voided: string | null }>;
}

export interface StockOption {
  id: string;
  name_ar: string;
  name_en: string | null;
  kind: "ingredient" | "packaging";
  base_unit: string;
}

function failed(what: string, error: { code?: string }): never {
  throw new Error(`${what} could not be read (${error.code ?? "unknown"}).`);
}

export async function readStockDay(date: string, asOf: string | null = null): Promise<StockDay> {
  const client = await createUserClient();
  const { data, error } = await client.rpc("app_stock_day", { p_branch: OPERATING_BRANCH_CODE, p_date: date, p_as_of: asOf });
  if (error) failed("Stock", error);
  return data as StockDay;
}

export async function readProductMix(date: string): Promise<ProductMix> {
  const client = await createUserClient();
  const { data, error } = await client.rpc("app_product_mix", { p_branch: OPERATING_BRANCH_CODE, p_date: date });
  if (error) failed("Product Mix", error);
  return data as ProductMix;
}

export async function readItemHistory(item: string, from: string, to: string): Promise<ItemHistory> {
  const client = await createUserClient();
  const { data, error } = await client.rpc("app_stock_item_history", { p_branch: OPERATING_BRANCH_CODE, p_item: item, p_from: from, p_to: to });
  if (error) failed("Stock history", error);
  return data as ItemHistory;
}

/** Stock-tracked ingredients and packaging, for the entry forms. */
export async function readStockOptions(): Promise<StockOption[]> {
  const client = await createUserClient();
  const { data, error } = await client
    .from("catalog_items")
    .select("id, name_ar, name_en, kind, base_unit")
    .neq("kind", "sold")
    .eq("stock_tracked", true)
    .eq("status", "active")
    .not("base_unit", "is", null)
    .order("kind")
    .order("name_ar")
    .limit(1000);
  if (error) failed("Stock items", error);
  return data as StockOption[];
}

export type StockErrorCode =
  | "forbidden" | "invalid_input" | "unavailable" | "stock_stale" | "stock_duplicate" | "stock_unit"
  | "stock_not_reconciled" | "stock_nothing_eligible" | "stock_recipe_posted";

export function mapStockError(code: string | undefined): StockErrorCode {
  switch (code) {
    case "42501": return "forbidden";
    case "40001": return "stock_stale";
    case "23505": return "stock_duplicate";
    case "CT003": return "stock_unit";
    case "CT005": return "stock_not_reconciled";
    case "CT006": return "stock_nothing_eligible";
    case "CT004": return "stock_recipe_posted";
    default: return code && (code.startsWith("22") || code.startsWith("23")) ? "invalid_input" : "unavailable";
  }
}

export async function runStockCommand(date: string, command: string, request: string, payload: Record<string, unknown>) {
  const client = await createUserClient();
  return client.rpc("app_stock_command", { p_branch: OPERATING_BRANCH_CODE, p_date: date, p_command: command, p_request: request, p_payload: payload });
}
