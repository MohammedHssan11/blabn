/**
 * Plain helpers for the catalog screens. No server-only imports, so they are unit-tested directly.
 * Quantities are exact fractions end to end: the browser sends text, the database parses it into a
 * numerator and a denominator, and nothing here ever turns a recipe quantity into a floating point number.
 */

const ARABIC_INDIC = /[٠-٩]/g;
const EASTERN_ARABIC_INDIC = /[۰-۹]/g;

export function isCatalogId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Western digits, one decimal point, no spaces. Returns null when the text is not a positive quantity. */
export function normalizeQuantityInput(raw: string): string | null {
  const text = raw
    .trim()
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EASTERN_ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".")
    .replace(/[⁄∕]/g, "/")
    .replace(/\s+/g, "");
  if (/^\d{1,18}\/\d{1,18}$/.test(text)) {
    const [numerator = "0", denominator = "0"] = text.split("/");
    return BigInt(numerator) > 0n && BigInt(denominator) > 0n ? text : null;
  }
  if (/^\d{1,18}(\.\d{1,18})?$/.test(text)) return /[1-9]/.test(text) ? text : null;
  return null;
}

export interface RequestedLine {
  label: string;
  quantity: string;
}

const SEPARATORS = ["\t", "|", ";"] as const;

/**
 * One sold line per row of text: «name | quantity» (also a tab or a semicolon; as a last resort the
 * final word when it is a number). Rows that cannot be read are reported by their 1-based position.
 */
export function parseConsumptionLines(text: string): { lines: RequestedLine[]; unreadable: number[] } {
  const lines: RequestedLine[] = [];
  const unreadable: number[] = [];
  text.split(/\r?\n/).forEach((row, index) => {
    const value = row.trim();
    if (value === "") return;
    let label: string | null = null;
    let amount: string | null = null;
    for (const separator of SEPARATORS) {
      const at = value.lastIndexOf(separator);
      if (at > 0) {
        label = value.slice(0, at).trim();
        amount = value.slice(at + 1).trim();
        break;
      }
    }
    if (label === null) {
      const match = /^(.*\S)\s+([0-9٠-٩۰-۹.,٫/]+)$/.exec(value);
      if (match) {
        label = match[1] ?? null;
        amount = match[2] ?? null;
      }
    }
    const quantity = amount === null ? null : normalizeQuantityInput(amount);
    if (!label || quantity === null) {
      unreadable.push(index + 1);
      // A line the person typed is still shown, blocked, with its own reason, instead of silently dropped.
      lines.push({ label: label ?? value, quantity: amount ?? "" });
      return;
    }
    lines.push({ label, quantity });
  });
  return { lines, unreadable };
}

/** Decimal text of num/den rounded half-up to nine places, as the database prints it. */
export function fractionToDecimal(num: string | number, den: string | number): { text: string; exact: boolean } {
  const n = BigInt(String(num));
  const d = BigInt(String(den));
  if (d <= 0n) throw new Error("A fraction needs a positive denominator.");
  const scale = 10n ** 9n;
  const scaled = (n * scale * 2n + d) / (d * 2n); // half-up
  const exact = (n * scale) % d === 0n;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(9, "0").replace(/0+$/, "");
  return { text: fraction ? `${whole}.${fraction}` : `${whole}`, exact };
}

/** Keep an exact finite decimal when it fits the input format, otherwise keep the fraction. */
export function fractionToInput(num: string, den: string): string {
  const text = fractionToDecimal(num, den);
  if (text.exact) return text.text;
  const numerator = BigInt(num);
  const denominator = BigInt(den);
  const scale = 10n ** 18n;
  const scaled = numerator * scale;
  if (scaled % denominator !== 0n) return `${num}/${den}`;
  const value = scaled / denominator;
  const fractional = (value % scale).toString().padStart(18, "0").replace(/0+$/, "");
  return `${value / scale}.${fractional}`;
}

/** Whether two fractions are the same number, without ever dividing. */
export function sameFraction(a: { num: string | number; den: string | number }, b: { num: string | number; den: string | number }): boolean {
  return BigInt(String(a.num)) * BigInt(String(b.den)) === BigInt(String(b.num)) * BigInt(String(a.den));
}

/** The only places a screen may send a person back to after saving: another catalog page in the same language. */
export function safeCatalogPath(locale: string, value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith(`/${locale}/catalog`) || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) {
    return fallback;
  }
  try {
    const url = new URL(value, "http://site.invalid");
    const path = `/${locale}/catalog`;
    if (url.origin !== "http://site.invalid" || (url.pathname !== path && !url.pathname.startsWith(`${path}/`))) return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

export const ITEM_KINDS = ["sold", "ingredient", "packaging"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const REVIEW_KINDS = [
  "unmapped_name", "unconfirmed_mapping", "ambiguous_addon", "missing_unit", "unit_conflict", "missing_quantity",
  "missing_component", "untracked_component", "empty_sales_row", "unlinked_recipe", "recipe_effective_date",
] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
/** Reason codes the eligibility check can return (see app_private.catalog_consumption). */
export const REASON_CODES = [
  "invalid_quantity", "unknown_product", "unmapped_name", "mapping_pending", "mapping_rejected", "no_recipe",
  "recipe_not_approved", "no_recipe_for_date", "recipe_empty", "recipe_line_incomplete", "unit_missing", "base_unit_missing",
  "unit_incompatible",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export const WARNING_CODES = ["discontinued_before_date"] as const;

export type CatalogErrorCode =
  | "forbidden" | "invalid_input" | "unavailable" | "catalog_stale" | "catalog_duplicate" | "catalog_overlap"
  | "catalog_date_unconfirmed" | "catalog_incomplete" | "catalog_unit";

/** SQLSTATE of a refused catalog command -> the message code shown to the person. */
export function mapCatalogError(code: string | undefined): CatalogErrorCode {
  switch (code) {
    case "42501": return "forbidden";
    case "40001": return "catalog_stale";
    case "23505": return "catalog_duplicate";
    case "23P01": return "catalog_overlap";
    case "CT001": return "catalog_date_unconfirmed";
    case "CT002": return "catalog_incomplete";
    case "CT003": return "catalog_unit";
    default: return code && (code.startsWith("22") || code.startsWith("23")) ? "invalid_input" : "unavailable";
  }
}
