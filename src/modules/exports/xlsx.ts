import ExcelJS from "exceljs";
import { label, LABELS, type LabelKey, type WorkbookLocale } from "./labels";
import type { Cell, Param, Row, RowStyle, SheetModel, WorkbookModel } from "./model";

/**
 * Renders a report model as an .xlsx workbook (ExcelJS, chosen in Phase 9 after testing Arabic
 * right-to-left layout, print settings and a 20,000-row workbook in desktop Excel 16).
 *
 * - Values only: no formulas, links, macros or external references. Totals are the application's.
 * - Money is written as MAD with two decimals, ratios as percentages with the stored basis-point
 *   precision, business dates as dates, quantities exactly (a note holds the fraction when it has no
 *   finite decimal), and text a person typed as literal text ("@" format).
 * - A blank value is an empty cell; a recorded zero is 0.
 * - Every sheet: A4, fit to one page wide, header with the report title, page numbers in the footer,
 *   right-to-left for Arabic.
 */

export interface RenderOptions {
  locale: WorkbookLocale;
  title: string;
  /** Instant written as the workbook's created/modified date (the export's data snapshot). */
  created: Date;
  exportId: string;
}

const FONT = "Arial";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F4" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5FB" } };
const DRAFT_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4D6" } };
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFB7C4D8" } }, bottom: { style: "thin", color: { argb: "FFB7C4D8" } },
  left: { style: "thin", color: { argb: "FFB7C4D8" } }, right: { style: "thin", color: { argb: "FFB7C4D8" } },
};

export const FORMATS = { money: "#,##0.00;-#,##0.00;0.00", int: "#,##0", ratio: "0.00%", date: "yyyy-mm-dd", text: "@", qty: "General" } as const;

/** Decimal of num/den, rounded half-up to nine places, and whether it is exact. */
export function fractionDecimal(num: string, den: string): { value: number; text: string; exact: boolean } {
  const n = BigInt(num);
  const d = BigInt(den);
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const scale = 10n ** 9n;
  const scaled = (an * scale * 2n + ad) / (ad * 2n);
  const exact = (an * scale) % ad === 0n;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(9, "0").replace(/0+$/, "");
  const text = `${negative && scaled !== 0n ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
  return { value: Number(text), text, exact };
}

function resolveParams(params: Record<string, Param> | undefined, locale: WorkbookLocale) {
  if (!params) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "object") out[key] = value;
    else if ("ref" in value) out[key] = label(value.ref, locale, value.p);
    else out[key] = locale === "en" ? value.en ?? value.ar : value.ar;
  }
  return out;
}

/** The display text of a label or name cell (used for sheet names, titles and tests). */
export function cellText(cell: Cell, locale: WorkbookLocale): string {
  switch (cell.t) {
    case "label": return label(cell.k, locale, resolveParams(cell.p, locale));
    case "name": return locale === "en" ? cell.en ?? cell.ar : cell.ar;
    case "pending": return label("common.pending", locale, { findings: cell.findings.join(", ") });
    case "text": return cell.v ?? "";
    case "date": case "local": return cell.v ?? "";
    default: return "";
  }
}

function writeCell(target: ExcelJS.Cell, cell: Cell, locale: WorkbookLocale) {
  switch (cell.t) {
    case "label": case "name": case "pending":
      target.value = cellText(cell, locale);
      break;
    case "text":
      if (cell.v !== null) {
        target.value = cell.v;
        if (cell.user) target.numFmt = FORMATS.text;
      }
      break;
    case "money":
      if (cell.v !== null) { target.value = cell.v / 100; target.numFmt = FORMATS.money; }
      break;
    case "int":
      if (cell.v !== null) { target.value = cell.v; target.numFmt = FORMATS.int; }
      break;
    case "ratio":
      if (cell.v !== null) { target.value = cell.v / 10000; target.numFmt = FORMATS.ratio; }
      break;
    case "date":
      if (cell.v !== null) {
        const [y, m, d] = cell.v.split("-").map(Number) as [number, number, number];
        target.value = new Date(Date.UTC(y, m - 1, d));
        target.numFmt = FORMATS.date;
      }
      break;
    case "local":
      if (cell.v !== null) target.value = cell.v.replace("T", " ");
      break;
    case "qty":
      if (cell.v !== null) {
        const dec = fractionDecimal(cell.v.num, cell.v.den);
        target.value = dec.value;
        target.numFmt = FORMATS.qty;
        if (!dec.exact) target.note = `${cell.v.num}/${cell.v.den}`;
      }
      break;
  }
}

const FILL: Partial<Record<RowStyle, ExcelJS.Fill>> = { total: TOTAL_FILL, section: TOTAL_FILL, draft: DRAFT_FILL };

function styleRow(row: ExcelJS.Row, columns: number, style: RowStyle | "header" | undefined) {
  for (let c = 1; c <= columns; c += 1) {
    const cell = row.getCell(c);
    cell.border = THIN;
    cell.font = { name: FONT, size: 10, bold: style === "header" || style === "total" || style === "section",
      italic: style === "muted", color: style === "muted" ? { argb: "FF5A6B85" } : undefined };
    cell.alignment = { vertical: "middle", wrapText: style === "header", horizontal: style === "header" ? "center" : undefined };
    if (style === "header") cell.fill = HEADER_FILL;
    else if (style && FILL[style]) cell.fill = FILL[style]!;
  }
}

/** Excel sheet names: at most 31 characters, none of []:*?/\ and unique in the workbook. */
export function safeSheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i += 1) name = `${base.slice(0, 27)} (${i})`;
  used.add(name.toLowerCase());
  return name;
}

const escapeHeader = (value: string) => value.replaceAll("&", "&&");

function renderSheet(wb: ExcelJS.Workbook, sheet: SheetModel, options: RenderOptions, used: Set<string>, draft: boolean) {
  const { locale } = options;
  const ws = wb.addWorksheet(safeSheetName(cellText(sheet.name, locale), used), {
    views: [{ rightToLeft: locale === "ar", showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: sheet.landscape ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.7, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: {
      oddHeader: `&C&"${FONT},Bold"${escapeHeader(options.title)}${draft ? `&R${escapeHeader(label("common.draftBanner", locale))}` : ""}`,
      oddFooter: `&L${label("common.page", locale)}&R${escapeHeader(options.exportId.slice(0, 8))}`,
    },
  });
  ws.columns = sheet.widths.map((width) => ({ width }));
  const columns = sheet.widths.length;
  let r = 1;
  for (const block of sheet.blocks) {
    if (block.kind === "gap") { r += 1; continue; }
    if (block.kind === "title") {
      const row = ws.getRow(r);
      block.cells.forEach((cell, i) => writeCell(row.getCell(i + 1), cell, locale));
      if (block.cells.length === 1 && columns > 1) ws.mergeCells(r, 1, r, columns);
      row.getCell(1).font = { name: FONT, bold: true, size: block.size === "large" ? 13 : 11 };
      row.getCell(1).alignment = { horizontal: block.size === "large" ? "center" : undefined, vertical: "middle", wrapText: true };
      if (block.size === "large") row.height = 22;
      r += 1;
      continue;
    }
    if (block.kind === "kv") {
      for (const cells of block.rows) {
        const row = ws.getRow(r);
        cells.forEach((cell, i) => writeCell(row.getCell(i + 1), cell, locale));
        for (let c = 1; c <= Math.max(cells.length, 2); c += 1) {
          const target = row.getCell(c);
          target.border = THIN;
          target.font = { name: FONT, size: 10, bold: c === 1 };
          target.alignment = { vertical: "middle", wrapText: c === 1 };
          if (c === 1) target.fill = TOTAL_FILL;
        }
        r += 1;
      }
      continue;
    }
    const header = ws.getRow(r);
    block.header.forEach((cell, i) => writeCell(header.getCell(i + 1), cell, locale));
    styleRow(header, block.header.length, "header");
    if (block.main) ws.pageSetup.printTitlesRow = `${r}:${r}`;
    r += 1;
    block.rows.forEach((model: Row) => {
      const row = ws.getRow(r);
      model.cells.forEach((cell, i) => writeCell(row.getCell(i + 1), cell, locale));
      styleRow(row, block.header.length, model.style);
      r += 1;
    });
  }
}

/** The workbook as bytes. The About sheet comes last, after the report sheets. */
export async function renderWorkbook(model: WorkbookModel, about: SheetModel, options: RenderOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "B.Laban branch operations";
  wb.lastModifiedBy = "B.Laban branch operations";
  wb.title = options.title;
  wb.created = options.created;
  wb.modified = options.created;
  const used = new Set<string>();
  for (const sheet of model.sheets) renderSheet(wb, sheet, options, used, model.draft);
  renderSheet(wb, about, options, used, model.draft);
  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

/** Every label key a model uses (tests check that each exists in both languages). */
export function labelKeysOf(sheets: SheetModel[]): LabelKey[] {
  const keys = new Set<LabelKey>();
  const visit = (cell: Cell) => {
    if (cell.t === "label") {
      keys.add(cell.k);
      for (const value of Object.values(cell.p ?? {})) if (typeof value === "object" && "ref" in value) keys.add(value.ref);
    }
  };
  for (const sheet of sheets) {
    visit(sheet.name);
    for (const block of sheet.blocks) {
      if (block.kind === "title") block.cells.forEach(visit);
      else if (block.kind === "kv") block.rows.forEach((row) => row.forEach(visit));
      else if (block.kind === "table") { block.header.forEach(visit); block.rows.forEach((row) => row.cells.forEach(visit)); }
    }
  }
  return [...keys].filter((key) => key in LABELS);
}
