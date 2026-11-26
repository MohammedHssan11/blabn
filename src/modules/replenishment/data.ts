import "server-only";
import { createUserClient } from "@/lib/supabase/server";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import type { OrderJson, PlanJson, SettingsJson } from "./types";

/**
 * Phase 8 reads and writes. Everything runs as the signed-in person: the database checks the branch,
 * the permission of each command and the request identifier again, takes the instant from its own
 * clock (so the business date and the creation time cannot be chosen by the caller), and writes the
 * order, receipt or override with its audit entry in one transaction. The plan is calculated by
 * PostgreSQL; the pages display it (and recompute it with planning.ts as a cross-check).
 */

function failed(what: string, error: { code?: string }): never {
  throw new Error(`${what} could not be read (${error.code ?? "unknown"}).`);
}

export async function readPlan(expected: string | null, item: string | null = null): Promise<PlanJson> {
  const client = await createUserClient();
  const { data, error } = await client.rpc("app_replenishment_plan", { p_branch: OPERATING_BRANCH_CODE, p_expected: expected, p_item: item });
  if (error) failed("The plan", error);
  return data as PlanJson;
}

/** Like readPlan, but an invalid what-if date is reported instead of failing the page. */
export async function tryReadPlan(expected: string | null, item: string | null = null): Promise<{ plan: PlanJson | null; code: string | null }> {
  const client = await createUserClient();
  const { data, error } = await client.rpc("app_replenishment_plan", { p_branch: OPERATING_BRANCH_CODE, p_expected: expected, p_item: item });
  if (error) return { plan: null, code: error.code ?? "unknown" };
  return { plan: data as PlanJson, code: null };
}

export async function readOrders(limit = 200): Promise<{ today: string; local: string; orders: OrderJson[] }> {
  const client = await createUserClient();
  const { data, error } = await client.rpc("app_purchase_orders", { p_branch: OPERATING_BRANCH_CODE, p_limit: limit });
  if (error) failed("Purchase orders", error);
  return data as { today: string; local: string; orders: OrderJson[] };
}

/** Every order that touches the period (created, expected or received in it), newest first, without a list limit. */
export async function readOrderIds(from: string, to: string): Promise<string[]> {
  const client = await createUserClient();
  const { data, error } = await client.rpc("app_purchase_orders_in_period", { p_branch: OPERATING_BRANCH_CODE, p_from: from, p_to: to });
  if (error) failed("Purchase orders", error);
  return data as string[];
}

export async function readOrder(id: string): Promise<OrderJson | null> {
  const client = await createUserClient();
  const { data, error } = await client.rpc("app_purchase_order", { p_branch: OPERATING_BRANCH_CODE, p_order: id });
  if (error) failed("The purchase order", error);
  return (data as OrderJson | null) ?? null;
}

export async function readSettings(): Promise<SettingsJson> {
  const client = await createUserClient();
  const { data, error } = await client.rpc("app_replenishment_settings", { p_branch: OPERATING_BRANCH_CODE });
  if (error) failed("Replenishment settings", error);
  return data as SettingsJson;
}

export async function runPurchaseOrderCommand(command: string, request: string, payload: Record<string, unknown>) {
  const client = await createUserClient();
  return client.rpc("app_purchase_order_command", { p_branch: OPERATING_BRANCH_CODE, p_command: command, p_request: request, p_payload: payload });
}

export async function saveBranchSettings(expected: number, minObservations: number | null, coverageDays: number, safetyPercent: string) {
  const client = await createUserClient();
  return client.rpc("app_replenishment_settings_save", { p_branch: OPERATING_BRANCH_CODE, p_expected: expected,
    p_min_observations: minObservations, p_coverage_days: coverageDays, p_safety_percent: safetyPercent });
}

export async function saveItemSettings(item: string, expected: number, values: { pack: string | null; minOrder: string | null;
  shelfLife: number | null; source: string | null }) {
  const client = await createUserClient();
  return client.rpc("app_replenishment_item_settings_save", { p_branch: OPERATING_BRANCH_CODE, p_item: item, p_expected: expected,
    p_safety: null, p_pack: values.pack, p_min_order: values.minOrder, p_shelf_life_days: values.shelfLife, p_source: values.source });
}

export async function saveSourceSettings(source: string, expected: number, leadDays: number | null, cutoff: string | null) {
  const client = await createUserClient();
  return client.rpc("app_replenishment_source_settings_save", { p_branch: OPERATING_BRANCH_CODE, p_source: source, p_expected: expected,
    p_lead_days: leadDays, p_cutoff: cutoff });
}
