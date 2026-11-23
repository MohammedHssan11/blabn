import type { Locale } from "@/i18n/config";
import { isBusinessDate } from "@/lib/dates";
import { parseMadInput } from "@/lib/money";
import { safeNextPath } from "@/modules/access/forms";

/**
 * Form parsing for the comparison entry screen. Pure functions, shared by the server action and the
 * unit tests. The database validates everything again (permission, entry owner, dates, the one
 * active value, the first live date); these only turn a typed form into the command payload.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRequestId = (value: string): boolean => UUID.test(value);

/** An order count typed in Western or Arabic-Indic digits. Blank → null; invalid → undefined. */
export function parseOrderCount(raw: string): number | null | undefined {
  const text = raw.trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s,٬]/g, "");
  if (text === "") return null;
  if (!/^\d{1,10}$/.test(text)) return undefined;
  const value = Number(text);
  return value <= 2147483647 ? value : undefined;
}

/**
 * Builds the app_comparison_save payload, or null when a field is invalid.
 * New: a blank figure is simply not entered. Correction: a blank figure is left unchanged, and the
 * "clear" checkbox withdraws it (a revision with no value). Amounts are sent in centimes as text.
 */
export function buildEntryPayload(field: (name: string) => string, checked: (name: string) => boolean): Record<string, unknown> | null {
  const mode = field("mode") === "correct" ? "correct" : field("mode") === "new" || field("mode") === "" ? "new" : null;
  const purpose = field("purpose") === "historical" ? "historical" : field("purpose") === "live" || field("purpose") === "" ? "live" : null;
  const date = field("date");
  const source = field("source") || "reporting_only";
  const reference = field("reference");
  const reason = field("reason");
  if (!mode || !purpose || !isBusinessDate(date) || !/^[a-z][a-z0-9_]{1,39}$/.test(source) || reference.length > 200 || reason.length > 500) return null;

  const payload: Record<string, unknown> = { date, mode, purpose, source };
  if (reference !== "") payload.reference = reference;
  if (reason !== "") payload.reason = reason;

  const sales = parseMadInput(field("sales"));
  if (sales === undefined || (sales !== null && sales < 0)) return null;
  const orders = parseOrderCount(field("orders"));
  if (orders === undefined) return null;

  if (mode === "correct" && checked("clear_sales")) payload.sales = null;
  else if (sales !== null) payload.sales = String(sales);
  if (mode === "correct" && checked("clear_orders")) payload.orders = null;
  else if (orders !== null) payload.orders = String(orders);

  if (!("sales" in payload) && !("orders" in payload)) return null;
  return payload;
}

/** A "back" path is accepted only for the comparison pages of the same language. */
export function safeComparisonPath(locale: Locale, value: string, fallback: string): string {
  const path = safeNextPath(locale, value);
  return path !== null && path.startsWith(`/${locale}/comparison`) ? path : fallback;
}
