import { createHash } from "node:crypto";
import type { LabelKey } from "./labels";

/**
 * The report model: what a workbook contains, independent of its language. Figures are saved
 * application values (money in centimes, ratios in basis points, exact quantities as fractions);
 * labels are keys. The renderer (xlsx.ts) turns one model into an Arabic or an English workbook, so
 * the two languages always carry the same figures, and the data fingerprint is the same for both.
 *
 * `null` is a blank (not recorded); 0 is a recorded zero. They are never interchangeable.
 */
export type Cell =
  | { t: "label"; k: LabelKey; p?: Record<string, Param> }
  | { t: "text"; v: string | null; user?: true }
  | { t: "money"; v: number | null }
  | { t: "int"; v: number | null }
  | { t: "ratio"; v: number | null }
  | { t: "date"; v: string | null }
  | { t: "local"; v: string | null }
  | { t: "qty"; v: Quantity | null }
  | { t: "name"; ar: string; en: string | null }
  | { t: "pending"; findings: string[] };

/** A label parameter: plain text, a number, another label, or a name in both languages. */
export type Param = string | number | LabelRef | Bilingual;

export interface Bilingual {
  ar: string;
  en: string | null;
}

/** A label used as a parameter of another label (translated in the same language). */
export interface LabelRef {
  ref: LabelKey;
  p?: Record<string, string | number>;
}

export interface Quantity {
  num: string;
  den: string;
}

export type RowStyle = "total" | "section" | "draft" | "muted";

export interface Row {
  cells: Cell[];
  style?: RowStyle;
}

export type Block =
  | { kind: "title"; cells: Cell[]; size?: "large" | "normal" }
  | { kind: "table"; header: Cell[]; rows: Row[]; fields?: Array<string | null>; main?: boolean }
  | { kind: "kv"; rows: Cell[][] }
  | { kind: "gap" };

export interface SheetModel {
  /** Stable identifier (used for names that are not labels, e.g. a business date). */
  key: string;
  name: Cell;
  widths: number[];
  landscape: boolean;
  blocks: Block[];
}

export interface WorkbookModel {
  family: Family;
  draft: boolean;
  sheets: SheetModel[];
  /** Report field IDs the workbook fills (Phase 1 field map). */
  fields: string[];
}

export type Family = "sales_comparison" | "daily_ledger" | "daily_statement" | "daily_sales" | "inventory";

// ------------------------------------------------------------------ cell helpers

export const L = (k: LabelKey, p?: Record<string, Param>): Cell => ({ t: "label", k, ...(p ? { p } : {}) });
export const text = (v: string | null | undefined): Cell => ({ t: "text", v: v ?? null });
/** Text a person typed (descriptions, references, names): always written as literal text. */
export const userText = (v: string | null | undefined): Cell => ({ t: "text", v: v === undefined || v === null || v === "" ? null : v, user: true });
export const money = (v: number | null | undefined): Cell => ({ t: "money", v: v ?? null });
export const int = (v: number | null | undefined): Cell => ({ t: "int", v: v ?? null });
export const ratio = (v: number | null | undefined): Cell => ({ t: "ratio", v: v ?? null });
export const date = (v: string | null | undefined): Cell => ({ t: "date", v: v ?? null });
export const local = (v: string | null | undefined): Cell => ({ t: "local", v: v ?? null });
export const qty = (v: Quantity | null | undefined): Cell => ({ t: "qty", v: v ? { num: String(v.num), den: String(v.den) } : null });
export const name = (ar: string, en: string | null | undefined): Cell => ({ t: "name", ar, en: en ?? null });
export const pending = (findings: string[]): Cell => ({ t: "pending", findings });
export const blank: Cell = { t: "text", v: null };
export const ref = (k: LabelKey, p?: Record<string, string | number>): LabelRef => ({ ref: k, ...(p ? { p } : {}) });

export const weekdayKey = (isoDate: string): LabelKey => `weekday.${new Date(`${isoDate}T00:00:00Z`).getUTCDay()}` as LabelKey;

// ------------------------------------------------------------------ data fingerprint

/** JSON with sorted object keys, so the same model always serializes to the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** SHA-256 of the report sheets (the About sheet is not part of the data). Language-independent. */
export function dataFingerprint(model: WorkbookModel): string {
  return createHash("sha256").update(canonicalJson({ family: model.family, draft: model.draft, sheets: model.sheets })).digest("hex");
}

/** Every value cell of a model in reading order, for checks that compare languages and reports. */
export function valueCells(model: WorkbookModel): Cell[] {
  const out: Cell[] = [];
  const visit = (cells: Cell[]) => cells.forEach((c) => { if (c.t !== "label" && c.t !== "pending") out.push(c); });
  for (const sheet of model.sheets) {
    for (const block of sheet.blocks) {
      if (block.kind === "title") visit(block.cells);
      else if (block.kind === "kv") block.rows.forEach(visit);
      else if (block.kind === "table") block.rows.forEach((r) => visit(r.cells));
    }
  }
  return out;
}
