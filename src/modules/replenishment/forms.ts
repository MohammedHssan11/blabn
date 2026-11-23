import { isCatalogId, normalizeQuantityInput } from "@/modules/catalog/forms";
import type { PermissionKey } from "@/modules/access/catalog";

/**
 * Form parsing for the purchase-order screens. Pure functions, shared by the server actions and the
 * tests. The database validates everything again; these only turn a submitted form into a command
 * payload so a mistyped field is reported before anything is sent.
 */

export const PO_COMMANDS = ["create", "approve", "reject", "set_expected", "receive", "cancel_rest"] as const;
export type PurchaseOrderCommand = (typeof PO_COMMANDS)[number];
export const SOURCES = ["factory", "store"] as const;
export type OrderSource = (typeof SOURCES)[number];
export const MAX_FORM_ROWS = 40;

export function isPurchaseOrderCommand(value: string): value is PurchaseOrderCommand {
  return (PO_COMMANDS as readonly string[]).includes(value);
}

/** The permission a command needs, mirrored from app_private.purchase_order_command (the database decides). */
export function purchaseOrderPermission(command: PurchaseOrderCommand): PermissionKey {
  switch (command) {
    case "create": return "purchase_order.propose";
    case "receive": return "purchase_order.receive";
    case "set_expected": return "inventory.view"; // creator or approver: checked by the database
    default: return "purchase_order.approve";
  }
}

/** A numeric quantity above zero with at most three decimals (ORD-02). «،» and other text: null. */
export function normalizeOrderQuantity(raw: string): string | null {
  const text = normalizeQuantityInput(raw);
  return text !== null && /^\d{1,9}(\.\d{1,3})?$/.test(text) ? text : null;
}

const isFraction = (value: string) => /^-?\d{1,30}\/\d{1,30}$/.test(value);
const isLocalTime = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const rowCount = (raw: string, fallback: number) => {
  const n = /^\d{1,3}$/.test(raw) ? Number(raw) : fallback;
  return Math.min(Math.max(n, 0), MAX_FORM_ROWS);
};

/**
 * Rows "item.N", "quantity.N", "unit.N", "source.N", optionally "from_plan.N" (the line follows the
 * plan), "suggested.N" (the suggestion the page showed) and "reason.N" (override reason). Rows
 * without an item and a quantity are skipped; a row with a bad quantity or source refuses the form.
 */
export function buildCreatePayload(get: (name: string) => string, rows = rowCount(get("rows"), 0)): Record<string, unknown> | null {
  const lines: Array<Record<string, unknown>> = [];
  for (let i = 0; i < Math.min(rows, MAX_FORM_ROWS); i++) {
    const item = get(`item.${i}`);
    const raw = get(`quantity.${i}`);
    if (item === "" && raw.trim() === "") continue;
    if (raw.trim() === "") continue;
    const quantity = normalizeOrderQuantity(raw);
    const source = get(`source.${i}`);
    if (!isCatalogId(item) || quantity === null || !(SOURCES as readonly string[]).includes(source)) return null;
    const suggested = get(`suggested.${i}`);
    lines.push({
      item: item.toLowerCase(),
      quantity,
      source,
      unit: get(`unit.${i}`) || null,
      from_plan: get(`from_plan.${i}`) === "1",
      expected_suggested: isFraction(suggested) ? suggested : null,
      override_reason: get(`reason.${i}`).slice(0, 500),
    });
  }
  if (lines.length === 0) return null;
  return { note: get("note").slice(0, 500), lines };
}

/** "line.N", "quantity.N", "over.N" (over-receipt reason); blank quantities are skipped. */
export function buildReceivePayload(get: (name: string) => string, rows = rowCount(get("rows"), 0)): Record<string, unknown> | null {
  const order = get("order");
  const local = get("local");
  if (!isCatalogId(order) || !isLocalTime(local)) return null;
  const lines: Array<Record<string, unknown>> = [];
  for (let i = 0; i < Math.min(rows, MAX_FORM_ROWS); i++) {
    const raw = get(`quantity.${i}`);
    if (raw.trim() === "") continue;
    const quantity = normalizeOrderQuantity(raw);
    const line = get(`line.${i}`);
    if (!isCatalogId(line) || quantity === null) return null;
    lines.push({ line: line.toLowerCase(), quantity, over_receipt_reason: get(`over.${i}`).slice(0, 500) });
  }
  if (lines.length === 0) return null;
  return { order: order.toLowerCase(), local, reference: get("reference").slice(0, 100), note: get("note").slice(0, 500), lines };
}

export function buildCommandPayload(command: PurchaseOrderCommand, get: (name: string) => string): Record<string, unknown> | null {
  const reason = get("reason").slice(0, 500).trim();
  const order = get("order");
  switch (command) {
    case "create":
      return buildCreatePayload(get);
    case "receive":
      return buildReceivePayload(get);
    case "approve":
      return isCatalogId(order) ? { order: order.toLowerCase(), reason } : null;
    case "reject":
      return isCatalogId(order) && reason ? { order: order.toLowerCase(), reason } : null;
    case "set_expected":
      return isCatalogId(order) && isDate(get("date")) && reason ? { order: order.toLowerCase(), date: get("date"), reason } : null;
    case "cancel_rest":
      return isCatalogId(get("line")) && reason ? { line: get("line").toLowerCase(), reason } : null;
  }
}

export type PurchaseOrderErrorCode =
  | "forbidden" | "invalid_input" | "unavailable" | "stock_unit" | "po_over_receipt" | "po_plan_changed" | "po_state" | "po_override_reason"
  | "po_request_reused" | "po_stale";

export function mapPurchaseOrderError(code: string | undefined): PurchaseOrderErrorCode {
  switch (code) {
    case "42501": return "forbidden";
    case "CT801": return "po_over_receipt";
    case "CT802": return "po_plan_changed";
    case "CT803": return "po_state";
    case "CT804": return "po_override_reason";
    case "CT003": return "stock_unit";
    case "23505": return "po_request_reused";
    case "40001": return "po_stale";
    default: return code && (code.startsWith("22") || code.startsWith("23")) ? "invalid_input" : "unavailable";
  }
}

/** Only replenishment pages of the same language are valid return addresses. */
export function safeReplenishmentPath(locale: string, value: string | null | undefined, fallback: string): string {
  if (!value || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://site.invalid");
    const base = `/${locale}/replenishment`;
    if (url.origin !== "http://site.invalid" || (url.pathname !== base && !url.pathname.startsWith(`${base}/`))) return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

export function isPlanDate(value: string | undefined): value is string {
  return typeof value === "string" && isDate(value) && !value.startsWith("0000-");
}
