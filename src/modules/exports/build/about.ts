import { FIELD_MAP_FINDINGS_VERSION, getField, isPending } from "@/modules/reports/field-map";
import { blank, L, local, name, text, userText, type Cell, type Row, type SheetModel, type WorkbookModel } from "../model";
import type { LabelKey } from "../labels";

/**
 * The About sheet: what the file is and where its figures come from. It names the report, branches,
 * period, requester, the data snapshot, draft or final, the template and calculation-rule versions,
 * the saved revisions and snapshot instants the figures were read from, the data fingerprint, the
 * report fields with their status, and every rule that is still pending.
 */

export interface AboutInfo {
  exportId: string;
  branches: Array<{ code: string; nameAr: string; nameEn: string }>;
  period: string;
  requester: string;
  requestedLocal: string | null;
  snapshotLocal: string | null;
  templateVersion: string;
  calcVersion: string;
  fingerprint: string;
  /** Saved sources as label + value, e.g. the daily-close basis or the stock "as of" instant. */
  sources: Array<{ label: LabelKey; value: string }>;
}

const PENDING_TEXT: Record<string, LabelKey> = {
  "P1-19": "pending.P1-19", "P1-28": "pending.P1-28", "P1-31": "pending.P1-31", "P1-32": "pending.P1-32",
};

export function buildAbout(model: WorkbookModel, info: AboutInfo): SheetModel {
  const fieldRows: Row[] = model.fields.map((id) => {
    const field = getField(id);
    const open = field ? isPending(field) : false;
    return {
      cells: [text(id), field ? name(field.field_ar, field.field_en) : blank, L(open ? "about.fieldPending" : "about.fieldAgreed"),
        text(open && field ? field.pending_on.join(", ") : null)],
      style: open ? "draft" : undefined,
    };
  });
  const findings = [...new Set(model.fields.flatMap((id) => {
    const field = getField(id);
    return field && isPending(field) ? field.pending_on : [];
  }))].sort();
  // Fields marked pending in a template cell (P1-19 counter/cashier rule) are listed even when the field is settled for display.
  for (const sheet of model.sheets) {
    for (const block of sheet.blocks) {
      const cells: Cell[] = block.kind === "title" ? block.cells : block.kind === "kv" ? block.rows.flat() : [];
      for (const cell of cells) if (cell.t === "pending") for (const f of cell.findings) if (!findings.includes(f)) findings.push(f);
    }
  }
  findings.sort();
  const pendingRows: Cell[][] = findings.length
    ? findings.map((f) => [text(f), PENDING_TEXT[f] ? L(PENDING_TEXT[f]!) : text(f)])
    : [[L("about.pendingNone")]];

  return {
    key: "about", name: L("about.sheet"), landscape: false, widths: [34, 60, 14, 14],
    blocks: [
      { kind: "title", size: "large", cells: [L("about.title")] },
      {
        kind: "kv", rows: [
          [L("about.report"), L(`family.${model.family}` as LabelKey)],
          [L("about.branches"), { t: "name", ar: info.branches.map((b) => b.nameAr).join("، "), en: info.branches.map((b) => b.nameEn).join(", ") }],
          [L("about.period"), text(info.period)],
          [L("about.language"), L("about.languageValue")],
          [L("about.requester"), userText(info.requester)],
          [L("about.requestedAt"), local(info.requestedLocal)],
          [L("about.snapshot"), local(info.snapshotLocal)],
          [L("about.kind"), L(model.draft ? "about.draft" : "about.final")],
          [L("about.template"), text(info.templateVersion)],
          [L("about.calc"), text(info.calcVersion)],
          [L("about.fieldMap"), text(FIELD_MAP_FINDINGS_VERSION)],
          [L("about.exportId"), text(info.exportId)],
          [L("about.fingerprint"), text(info.fingerprint)],
        ],
      },
      { kind: "gap" },
      { kind: "title", cells: [L("about.sources")] },
      { kind: "kv", rows: info.sources.map((s) => [L(s.label), text(s.value)]) },
      { kind: "gap" },
      { kind: "title", cells: [L("about.pending")] },
      { kind: "kv", rows: pendingRows },
      { kind: "gap" },
      { kind: "title", cells: [L("about.notes")] },
      { kind: "kv", rows: [[L("about.note.blank")], [L("about.note.values")], [L("about.note.dates")],
        ...(model.family === "sales_comparison" ? [[L("about.note.historical")]] : []),
        ...(model.family === "inventory" ? [[L("about.note.qty")]] : [])] },
      { kind: "gap" },
      { kind: "title", cells: [L("about.fields")] },
      { kind: "table", header: [L("about.fieldId"), L("about.fieldName"), L("about.fieldStatus"), L("about.pending")], rows: fieldRows },
    ],
  };
}
