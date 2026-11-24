import { daysInMonth } from "@/lib/dates";
import { ratioBp } from "@/lib/money";
import type { MovementKind, ProductMix, StockDay, StockItemDay } from "@/modules/inventory/stock";
import type { OrderJson } from "@/modules/replenishment/types";
import { add, parseQ, q, ZERO, type Q } from "@/modules/replenishment/planning";
import {
  blank, date, int, L, local, money, name, pending, qty, ratio, userText,
  type Cell, type Quantity, type Row, type SheetModel, type WorkbookModel,
} from "../model";
import type { LabelKey } from "../labels";

/**
 * Inventory and replenishment (INV-01–INV-13, ORD-01–ORD-02) from the saved Phase 6 and Phase 8
 * records: Product Mix as printed, recipe consumption as posted (with the recipe version), stock
 * movements by type, physical counts (blank = not counted, 0 = counted zero), variance only after a
 * count, and purchase orders with their creation, expected and actual receipt dates kept separate.
 * Stock figures are read "as of" the export's snapshot instant, so the file can be reproduced.
 * Quantities are exact fractions. Product Mix reports that are not locked are not included.
 */

export interface InventoryInput {
  period: { mode: "month"; month: string } | { mode: "day"; date: string };
  today: string;
  stock: StockDay[];
  mixes: ProductMix[];
  orders: OrderJson[];
  units: Array<{ code: string; name_ar: string; name_en: string }>;
}

const IN_KINDS: MovementKind[] = ["opening", "receipt", "return", "purchase", "transfer_in"];
const OUT_KINDS: MovementKind[] = ["consumption", "waste", "hospitality", "deduction", "transfer_out"];
const KIND_LABEL: Record<MovementKind, LabelKey> = {
  opening: "inv.openingMove", receipt: "inv.receipt", return: "inv.return", purchase: "inv.purchase", transfer_in: "inv.transfer_in",
  consumption: "inv.consumption", waste: "inv.waste", hospitality: "inv.hospitality", deduction: "inv.deduction",
  transfer_out: "inv.transfer_out", adjustment: "inv.adjustment",
};
const COLUMN_KINDS: MovementKind[] = [...IN_KINDS, ...OUT_KINDS, "adjustment"];

const toQ = (v: { num: string; den: string } | null | undefined): Q | null => (v ? parseQ({ num: String(v.num), den: String(v.den) }) : null);
const fromQ = (v: Q | null): Quantity | null => (v === null ? null : { num: v.n.toString(), den: v.d.toString() });
const neg = (v: Q): Q => q(-v.n, v.d);

function unitCell(code: string | null | undefined, units: InventoryInput["units"]): Cell {
  if (!code) return blank;
  const unit = units.find((u) => u.code === code);
  return unit ? name(unit.name_ar, unit.name_en) : { t: "text", v: code };
}

/** A movement column: inflows as recorded, outflows shown as positive quantities, adjustments signed. */
function movementCell(item: StockItemDay, kind: MovementKind): Cell {
  const value = toQ(item.movements[kind]);
  if (value === null) return blank;
  return qty(fromQ(OUT_KINDS.includes(kind) ? neg(value) : value));
}

const itemName = (i: { name_ar: string; name_en: string | null }) => name(i.name_ar, i.name_en);

function stockColumns(): Cell[] {
  return [L("common.item"), L("common.unit"), L("inv.kind"), L("inv.schedule"), L("inv.opening"),
    ...COLUMN_KINDS.map((k) => L(KIND_LABEL[k])), L("inv.book"), L("inv.expectedAtCount"), L("inv.count"), L("inv.variance")];
}
const STOCK_FIELDS = ["INV-12", "INV-12", null, null, "INV-04", "INV-05", "INV-05", "INV-05", "INV-05", "INV-05", "INV-06", "INV-07", "INV-07",
  "INV-07", "INV-07", "INV-07", "INV-08", "INV-13", "INV-09", "INV-10"];

function stockCells(item: StockItemDay, units: InventoryInput["units"]): Cell[] {
  return [itemName(item), unitCell(item.base_unit, units), L(`inv.kind.${item.kind}` as LabelKey), L(`inv.schedule.${item.schedule}` as LabelKey),
    qty(item.opening), ...COLUMN_KINDS.map((k) => movementCell(item, k)), qty(item.expected), qty(item.expected_at_count),
    qty(item.count?.quantity ?? null), qty(item.variance)];
}

// ------------------------------------------------------------------ Product Mix and consumption

function reasonsText(reasons: Array<{ code: string }>): string {
  return [...new Set(reasons.map((r) => r.code))].join(", ");
}

function mixDaySheet(mix: ProductMix | undefined, day: string): SheetModel {
  const blocks: SheetModel["blocks"] = [{ kind: "title", size: "large", cells: [L("inv.mixTitle", { date: day })] }];
  if (!mix?.report || mix.report.state !== "locked") {
    blocks.push({ kind: "kv", rows: [[L("inv.mixState"), L(mix?.report ? "inv.mixDraft" : "inv.mixMissing")]] });
    return { key: "mix", name: L("inv.mixSheet"), landscape: true, widths: [22, 40, 10, 14, 10, 10, 34], blocks };
  }
  const recon = mix.reconciliation;
  blocks.push({ kind: "kv", rows: [
    [L("inv.mixState"), L("inv.mixLocked"), { t: "int", v: mix.report.version }],
    [L("inv.netSales"), money(mix.report.net_sales)],
    [L("common.state"), L(recon?.ok ? "inv.reconciled" : "inv.notReconciled")],
  ] });
  const rows: Row[] = [];
  for (const section of mix.sections ?? []) {
    const sectionQty = section.lines.reduce<Q>((t, l) => add(t, parseQ(l.quantity) ?? ZERO), ZERO);
    for (const line of section.lines) {
      const lineQty = parseQ(line.quantity) ?? ZERO;
      // INV-02 shares: blank when the section total is 0.
      const qtyShare = sectionQty.n === 0n ? null : Number((lineQty.n * sectionQty.d * 10000n * 2n + lineQty.d * sectionQty.n) / (lineQty.d * sectionQty.n * 2n));
      rows.push({ cells: [userText(section.label), userText(line.label), qty(fromQ(lineQty)), money(line.amount), ratio(qtyShare),
        ratio(ratioBp(line.amount, section.total || null)),
        line.posted ? L("inv.posted", { version: line.posted.version_no })
          : line.check?.status === "blocked" ? L("inv.blocked", { reasons: reasonsText(line.check.reasons) })
            : L("inv.eligible")] });
    }
    rows.push({ cells: [userText(section.label), L("inv.sectionTotal"), qty(fromQ(sectionQty)), money(section.total), blank, blank, blank], style: "total" });
  }
  blocks.push({ kind: "gap" }, {
    kind: "table", main: true,
    header: [L("inv.section"), L("inv.menuItem"), L("inv.qty"), L("inv.amount"), L("inv.qtyShare"), L("inv.amountShare"), L("inv.posting")],
    fields: ["INV-03", "INV-03", "INV-01", "INV-02", "INV-02", "INV-02", "INV-06"], rows,
  }, { kind: "title", cells: [pending(["P1-28"])] });
  return { key: "mix", name: L("inv.mixSheet"), landscape: true, widths: [22, 40, 10, 14, 10, 10, 34], blocks };
}

function consumptionDayRows(mix: ProductMix | undefined): Row[] {
  const rows: Row[] = [];
  if (!mix?.report || mix.report.state !== "locked") return rows;
  for (const section of mix.sections ?? []) {
    for (const line of section.lines) {
      if (!line.posted) continue;
      for (const c of line.posted.components) {
        rows.push({ cells: [userText(line.label), qty(fromQ(parseQ(line.quantity))), int(line.posted.version_no), itemName(c),
          qty(c.quantity), c.stock_tracked ? L("common.yes") : blank] });
      }
    }
  }
  return rows;
}

// ------------------------------------------------------------------ orders

function ordersSheet(input: InventoryInput, from: string, to: string, periodText: string): SheetModel {
  const inPeriod = (d: string | null | undefined) => !!d && d >= from && d <= to;
  const orders = input.orders.filter((o) => inPeriod(o.business_date) || inPeriod(o.expected?.date) || inPeriod(o.original_expected?.date)
    || o.receipt_dates.some(inPeriod));
  const rows: Row[] = [];
  for (const o of orders) {
    const head: Cell[] = [int(o.order_no), L(`inv.orderStatus.${o.status}` as LabelKey), date(o.business_date), local(o.created_local),
      date(o.original_expected?.date ?? null), date(o.expected?.date ?? null), userText(o.expected?.kind === "override" ? o.expected.reason : null),
      { t: "text", v: o.receipt_dates.length ? o.receipt_dates.join(", ") : null }];
    const lines = o.lines ?? [];
    if (lines.length === 0) rows.push({ cells: [...head, blank, blank, blank, blank, blank, blank, blank, blank, blank] });
    for (const line of lines) {
      rows.push({ cells: [...head, itemName(line), L(`inv.source.${line.source}` as LabelKey), userText(`${line.quantity} ${line.unit}`),
        unitCell(line.base_unit, input.units), qty(line.final_base), qty(line.suggested), qty(line.received), qty(line.cancelled), qty(line.outstanding)] });
    }
  }
  if (rows.length === 0) rows.push({ cells: [L("inv.noOrders")], style: "muted" });
  return {
    key: "orders", name: L("inv.ordersSheet"), landscape: true, widths: [9, 12, 13, 16, 14, 14, 22, 18, 30, 11, 14, 12, 12, 12, 12, 12, 12],
    blocks: [
      { kind: "title", size: "large", cells: [L("inv.ordersTitle", { period: periodText })] },
      {
        kind: "table", main: true,
        header: [L("inv.orderNo"), L("inv.orderStatus"), L("inv.createdDate"), L("inv.createdAt"), L("inv.originalExpected"), L("inv.expected"),
          L("inv.overrideReason"), L("inv.receiptDates"), L("common.item"), L("inv.orderSource"), L("inv.ordered"), L("inv.baseUnit"),
          L("inv.ordered"), L("inv.suggested"), L("inv.received"), L("inv.cancelled"), L("inv.outstanding")],
        fields: ["ORD-02", null, "ORD-01", "ORD-01", "ORD-01", "ORD-01", "ORD-01", "ORD-01", "ORD-02", "ORD-02", "ORD-02", "ORD-02", "ORD-02", null, null, null, null],
        rows,
      },
      { kind: "gap" },
      { kind: "title", cells: [L("inv.ordersRule")] },
    ],
  };
}

// ------------------------------------------------------------------ builders

function dayWorkbook(input: InventoryInput, day: string): WorkbookModel {
  const stock = input.stock.find((s) => s.date === day);
  const mix = input.mixes.find((m) => m.date === day);
  const consumption = consumptionDayRows(mix);
  const stockRows: Row[] = (stock?.items ?? []).map((item) => ({ cells: [...stockCells(item, input.units), L(`inv.status.${item.status}` as LabelKey)],
    style: item.status === "missing" ? "muted" : undefined }));
  return {
    family: "inventory", draft: false,
    fields: ["INV-01", "INV-02", "INV-03", "INV-04", "INV-05", "INV-06", "INV-07", "INV-08", "INV-09", "INV-10", "INV-12", "INV-13", "ORD-01", "ORD-02"],
    sheets: [
      mixDaySheet(mix, day),
      {
        key: "consumption", name: L("inv.consumptionSheet"), landscape: true, widths: [36, 12, 12, 34, 14, 12],
        blocks: [
          { kind: "title", size: "large", cells: [L("inv.consumptionTitle", { period: day })] },
          { kind: "title", cells: [pending(["P1-31", "P1-32"])] },
          { kind: "table", main: true, header: [L("inv.product"), L("inv.soldQty"), L("inv.recipeVersion"), L("inv.component"), L("inv.componentQty"), L("inv.tracked")],
            fields: ["INV-01", "INV-01", "INV-06", "INV-06", "INV-06", null],
            rows: consumption.length ? consumption : [{ cells: [L("common.nothingRecorded")], style: "muted" }] },
        ],
      },
      {
        key: "stock", name: L("inv.stockSheet"), landscape: true, widths: [32, 9, 10, 9, ...Array(16).fill(10), 14],
        blocks: [
          { kind: "title", size: "large", cells: [L("inv.stockTitle", { date: day })] },
          { kind: "table", main: true, header: [...stockColumns(), L("inv.countStatus")], fields: [...STOCK_FIELDS, null], rows: stockRows },
        ],
      },
      ordersSheet(input, day, day, day),
    ],
  };
}

function monthWorkbook(input: InventoryInput, month: string): WorkbookModel {
  const days = daysInMonth(month).filter((d) => d <= input.today);
  // Product Mix by day.
  const mixRows: Row[] = days.map((day) => {
    const mix = input.mixes.find((m) => m.date === day);
    const locked = mix?.report?.state === "locked";
    const lines = locked ? (mix!.sections ?? []).flatMap((s) => s.lines) : [];
    return {
      cells: [date(day), L(!mix?.report ? "inv.mixMissing" : locked ? "inv.mixLocked" : "inv.mixDraft"), money(locked ? mix!.report!.net_sales : null),
        L(locked ? (mix!.reconciliation?.ok ? "inv.reconciled" : "inv.notReconciled") : "common.none"),
        int(locked ? lines.length : null), int(locked ? lines.filter((l) => l.posted).length : null),
        int(locked ? lines.filter((l) => !l.posted && l.check?.status === "blocked").length : null)],
      style: locked ? undefined : "muted",
    };
  });
  // Products sold in the month (locked reports only), by the name as printed.
  const products = new Map<string, { qty: Q; amount: number }>();
  for (const mix of input.mixes) {
    if (mix.report?.state !== "locked") continue;
    for (const line of (mix.sections ?? []).flatMap((s) => s.lines)) {
      const p = products.get(line.label) ?? { qty: ZERO, amount: 0 };
      products.set(line.label, { qty: add(p.qty, parseQ(line.quantity) ?? ZERO), amount: p.amount + line.amount });
    }
  }
  const productRows: Row[] = [...products.entries()].sort(([a], [b]) => a.localeCompare(b, "ar"))
    .map(([label, p]) => ({ cells: [userText(label), qty(fromQ(p.qty)), money(p.amount)] }));

  // Stock by day and the month summary per item.
  const perItem = new Map<string, { item: StockItemDay; opening: Q | null; kinds: Map<MovementKind, Q>; last: Q; counts: number; cumulative: Q | null; lastDay: string }>();
  const stockRows: Row[] = [];
  for (const day of days) {
    const stock = input.stock.find((s) => s.date === day);
    for (const item of stock?.items ?? []) {
      const acc = perItem.get(item.item_id) ?? { item, opening: toQ(item.opening), kinds: new Map(), last: ZERO, counts: 0, cumulative: null, lastDay: day };
      for (const [kind, value] of Object.entries(item.movements) as Array<[MovementKind, { num: string; den: string }]>) {
        acc.kinds.set(kind, add(acc.kinds.get(kind) ?? ZERO, toQ(value) ?? ZERO));
      }
      acc.last = toQ(item.expected) ?? ZERO;
      acc.lastDay = day;
      const variance = toQ(item.variance);
      if (item.count) acc.counts += 1;
      if (variance !== null) acc.cumulative = add(acc.cumulative ?? ZERO, variance);
      perItem.set(item.item_id, acc);
      const active = Object.keys(item.movements).length > 0 || item.count !== null || item.status === "missing";
      if (!active) continue;
      stockRows.push({ cells: [date(day), ...stockCells(item, input.units), qty(fromQ(acc.cumulative)), L(`inv.status.${item.status}` as LabelKey)],
        style: item.status === "missing" ? "muted" : undefined });
    }
  }
  const summaryRows: Row[] = [...perItem.values()].map((acc) => ({
    cells: [itemName(acc.item), unitCell(acc.item.base_unit, input.units), qty(fromQ(acc.opening)),
      ...COLUMN_KINDS.map((k) => {
        const v = acc.kinds.get(k);
        return v === undefined ? blank : qty(fromQ(OUT_KINDS.includes(k) ? neg(v) : v));
      }),
      qty(fromQ(acc.last)), int(acc.counts), qty(fromQ(acc.cumulative)), date(acc.lastDay)],
  }));
  const consumptionRows: Row[] = [...perItem.values()].filter((acc) => acc.kinds.has("consumption"))
    .map((acc) => ({ cells: [itemName(acc.item), unitCell(acc.item.base_unit, input.units), qty(fromQ(neg(acc.kinds.get("consumption")!)))] }));

  return {
    family: "inventory", draft: false,
    fields: ["INV-01", "INV-02", "INV-03", "INV-04", "INV-05", "INV-06", "INV-07", "INV-08", "INV-09", "INV-10", "INV-11", "INV-12", "INV-13", "ORD-01", "ORD-02"],
    sheets: [
      {
        key: "mix", name: L("inv.mixSheet"), landscape: true, widths: [12, 16, 15, 22, 10, 12, 12],
        blocks: [
          { kind: "title", size: "large", cells: [L("inv.mixMonthTitle", { month })] },
          { kind: "table", main: true, header: [L("common.date"), L("inv.mixState"), L("inv.netSales"), L("common.state"), L("inv.lines"),
            L("inv.postedLines"), L("inv.blockedLines")], fields: [null, null, "INV-02", "INV-02", "INV-01", "INV-06", "INV-06"], rows: mixRows },
          { kind: "gap" },
          { kind: "title", cells: [L("inv.productTotals")] },
          { kind: "table", header: [L("inv.menuItem"), L("inv.qty"), L("inv.amount")], fields: ["INV-03", "INV-01", "INV-02"],
            rows: productRows.length ? productRows : [{ cells: [L("common.nothingRecorded")], style: "muted" }] },
          { kind: "title", cells: [pending(["P1-28"])] },
        ],
      },
      {
        key: "consumption", name: L("inv.consumptionSheet"), landscape: false, widths: [36, 12, 16],
        blocks: [
          { kind: "title", size: "large", cells: [L("inv.consumptionTitle", { period: month })] },
          { kind: "title", cells: [pending(["P1-31", "P1-32"])] },
          { kind: "table", main: true, header: [L("inv.component"), L("common.unit"), L("inv.componentQty")], fields: ["INV-06", "INV-12", "INV-06"],
            rows: consumptionRows.length ? consumptionRows : [{ cells: [L("common.nothingRecorded")], style: "muted" }] },
        ],
      },
      {
        key: "stock", name: L("inv.stockMonthSheet"), landscape: true, widths: [12, 30, 9, 10, 9, ...Array(16).fill(10), 11, 14],
        blocks: [
          { kind: "title", size: "large", cells: [L("inv.stockMonthTitle", { month })] },
          { kind: "table", main: true, header: [L("common.date"), ...stockColumns(), L("inv.cumulative"), L("inv.countStatus")],
            fields: [null, ...STOCK_FIELDS, "INV-10", null],
            rows: stockRows.length ? stockRows : [{ cells: [L("common.nothingRecorded")], style: "muted" }] },
          { kind: "gap" },
          { kind: "title", cells: [L("inv.activityRule")] },
        ],
      },
      {
        key: "deviation", name: L("inv.monthSheet"), landscape: true, widths: [30, 9, 12, ...Array(11).fill(10), 12, 9, 12, 12],
        blocks: [
          { kind: "title", size: "large", cells: [L("inv.monthTitle", { month })] },
          { kind: "table", main: true, header: [L("common.item"), L("common.unit"), L("inv.monthOpening"), ...COLUMN_KINDS.map((k) => L(KIND_LABEL[k])),
            L("inv.monthClosing"), L("inv.countsDone"), L("inv.monthDeviation"), L("inv.lastDay")],
            fields: ["INV-12", "INV-12", "INV-04", ...COLUMN_KINDS.map(() => "INV-05"), "INV-08", "INV-09", "INV-11", null],
            rows: summaryRows.length ? summaryRows : [{ cells: [L("common.nothingRecorded")], style: "muted" }] },
        ],
      },
      ordersSheet(input, `${month}-01`, `${month}-31`, month),
    ],
  };
}

export function buildInventory(input: InventoryInput): WorkbookModel {
  return input.period.mode === "day" ? dayWorkbook(input, input.period.date) : monthWorkbook(input, input.period.month);
}
