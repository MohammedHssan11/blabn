import { isBusinessDate } from "@/lib/dates";
import { parseMadInput } from "@/lib/money";
import type { PermissionKey } from "@/modules/access/catalog";
import { isCatalogId, normalizeQuantityInput } from "@/modules/catalog/forms";

/**
 * Form parsing for the stock screens. Pure functions, shared by the server actions and the tests.
 * The database validates everything again; these only turn a typed form into the command payload,
 * so a mistyped field is reported before anything is sent.
 */

export const STOCK_COMMANDS = [
  "movement", "opening", "count", "void_count", "propose_adjustment", "decide_adjustment",
  "mix_save", "mix_section", "mix_line", "mix_remove", "mix_lock", "mix_unlock", "post_consumption", "reverse",
] as const;
export type StockCommand = (typeof STOCK_COMMANDS)[number];

export const MANUAL_KINDS = ["receipt", "purchase", "transfer_in", "return", "waste", "hospitality", "deduction", "transfer_out"] as const;
export type ManualKind = (typeof MANUAL_KINDS)[number];

export function isStockCommand(value: string): value is StockCommand {
  return (STOCK_COMMANDS as readonly string[]).includes(value);
}

export function isManualKind(value: string): value is ManualKind {
  return (MANUAL_KINDS as readonly string[]).includes(value);
}

/** The permission a command needs, mirrored from app_private.stock_command (the database decides). */
export function stockPermission(command: StockCommand, kind?: string): PermissionKey | null {
  switch (command) {
    case "movement":
      if (kind === "receipt" || kind === "purchase" || kind === "transfer_in" || kind === "return") return "inventory.receive";
      if (kind === "waste") return "inventory.waste";
      if (kind === "hospitality") return "inventory.hospitality";
      if (kind === "deduction" || kind === "transfer_out") return "inventory.adjust";
      return null;
    case "opening":
    case "decide_adjustment":
      return "inventory.adjust_approve";
    case "count":
    case "void_count":
      return "inventory.count";
    case "propose_adjustment":
      return "inventory.adjust";
    case "reverse":
      return "inventory.view"; // the database requires the permission that created the posting
    default:
      return "inventory.consume";
  }
}

/** A count may be an explicit zero. A blank count is not an observation and returns null. */
export function normalizeCountInput(raw: string): string | null {
  const text = raw.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".").replace(/\s+/g, "");
  if (text === "") return null;
  if (/^0+(\.0+)?$/.test(text)) return "0";
  return /^\d{1,12}(\.\d{1,6})?$/.test(text) ? text : null;
}

/** Positive decimal quantity (no fractions: the database accepts decimals for stock entries). */
export function normalizeStockQuantity(raw: string): string | null {
  const text = normalizeQuantityInput(raw);
  return text !== null && /^\d{1,12}(\.\d{1,6})?$/.test(text) ? text : null;
}

/** "YYYY-MM-DDTHH:MM" as a datetime-local field sends it. */
export function isLocalTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
}

function mad(raw: string): string | null {
  const minor = parseMadInput(raw);
  return minor === null || minor === undefined || minor < 0 ? null : String(minor);
}

const version = (raw: string): number | null => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);

/**
 * Builds the database payload from the submitted fields. Returns null when a required field is
 * missing or malformed, so the person gets "check the fields" without a request being sent.
 */
export function buildStockPayload(command: StockCommand, get: (name: string) => string): Record<string, unknown> | null {
  const id = (name: string) => (isCatalogId(get(name)) ? get(name).toLowerCase() : null);
  const reason = get("reason").slice(0, 500);
  const note = get("note").slice(0, 500);
  const local = get("local");
  switch (command) {
    case "movement":
    case "opening": {
      const quantity = normalizeStockQuantity(get("quantity"));
      const kind = get("kind");
      if (!id("item") || !quantity || !isLocalTime(local) || (command === "movement" && !isManualKind(kind))) return null;
      return { ...(command === "movement" ? { kind } : {}), item: id("item"), quantity, unit: get("unit") || null, local,
        reference: get("reference").slice(0, 100), note };
    }
    case "count": {
      const quantity = normalizeCountInput(get("quantity"));
      if (!id("item") || quantity === null || !isLocalTime(local)) return null;
      return { item: id("item"), quantity, unit: get("unit") || null, local, note, ...(id("replaces") ? { replaces: id("replaces"), reason } : {}) };
    }
    case "void_count":
      return id("count") && reason ? { count: id("count"), reason } : null;
    case "propose_adjustment": {
      const quantity = normalizeStockQuantity(get("quantity"));
      const direction = get("direction");
      if (!id("item") || !quantity || !isLocalTime(local) || (direction !== "1" && direction !== "-1") || !reason) return null;
      return { item: id("item"), quantity, unit: get("unit") || null, direction, local, reason, ...(id("count") ? { count: id("count") } : {}) };
    }
    case "decide_adjustment": {
      const decision = get("decision");
      return id("adjustment") && (decision === "approve" || decision === "reject") ? { adjustment: id("adjustment"), decision, reason } : null;
    }
    case "mix_save": {
      const net = mad(get("net_sales"));
      if (net === null || !isLocalTime(local)) return null;
      return { net_sales: net, local, ...(version(get("version")) !== null ? { version: version(get("version")) } : {}) };
    }
    case "mix_section": {
      const total = mad(get("total"));
      return total !== null && get("label") && version(get("version")) !== null ? { label: get("label").slice(0, 120), total, version: version(get("version")) } : null;
    }
    case "mix_line": {
      const amount = mad(get("amount"));
      const quantity = normalizeQuantityInput(get("quantity"));
      const section = version(get("section_no"));
      if (amount === null || !quantity || !/^\d{1,9}(\.\d{1,3})?$/.test(quantity) || !get("label") || section === null || version(get("version")) === null) return null;
      return { section_no: section, label: get("label").slice(0, 200), quantity, amount, version: version(get("version")) };
    }
    case "mix_remove": {
      const line = version(get("line_no"));
      const section = version(get("section_no"));
      if ((line === null && section === null) || version(get("version")) === null) return null;
      return { ...(line !== null ? { line_no: line } : { section_no: section }), version: version(get("version")) };
    }
    case "mix_lock":
    case "mix_unlock":
      return version(get("version")) !== null ? { version: version(get("version")) } : null;
    case "post_consumption":
      return {};
    case "reverse":
      return id("posting") && reason ? { posting: id("posting"), reason } : null;
  }
}

/** Only stock pages of the same language are valid return addresses. */
export function safeInventoryPath(locale: string, value: string | null | undefined, fallback: string): string {
  if (!value || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://site.invalid");
    const base = `/${locale}/inventory`;
    if (url.origin !== "http://site.invalid" || (url.pathname !== base && !url.pathname.startsWith(`${base}/`))) return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

export function isStockDate(value: string | undefined): value is string {
  return typeof value === "string" && isBusinessDate(value) && !value.startsWith("0000-");
}
