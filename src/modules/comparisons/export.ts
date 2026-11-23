import { toDecimalString, type Blank } from "@/lib/money";
import type { ComparisonPageModel, DayCell } from "./service";

/**
 * The comparison CSV: the same calculated model as the page, so the file and the screen agree.
 * Blank stays blank (never 0); unavailable percentages are blank with their reason.
 */
type Cell = string | number | null;

const mad = (v: Blank<number>): Cell => (v === null ? null : toDecimalString(v));
const pct = (bp: Blank<number>): Cell => (bp === null ? null : toDecimalString(bp));

function dayCells(cell: DayCell): Cell[] {
  return [cell.date.value, mad(cell.sales.value), cell.orders.value, cell.status, cell.source?.key ?? null, cell.sales.trace.record ?? null,
    cell.source?.historical ? cell.source.reference : null];
}

export function comparisonCsv(model: ComparisonPageModel): { name: string; header: string[]; rows: Cell[][] } {
  const view = model.view;
  if (view.mode === "weekly") {
    const header = ["mode", "branch", "current_date", "current_sales_mad", "current_orders", "current_status", "current_source", "current_record", "current_historical_source",
      "prior_date", "prior_sales_mad", "prior_orders", "prior_status", "prior_source", "prior_record", "prior_historical_source",
      "sales_difference_mad", "orders_difference", "current_to_prior_pct", "ratio_note", "coverage", "complete"];
    const rows: Cell[][] = view.rows.map((r) => ["weekly", r.branch.code, ...dayCells(r.current), ...dayCells(r.prior),
      mad(r.salesDiff.value), r.ordersDiff.value, pct(r.ratio.value), r.ratioReason === "ok" ? null : r.ratioReason, null, null]);
    const t = view.total;
    rows.push(["weekly", "total", view.currentDate.value, mad(t.currentSales.value), t.currentOrders.value, null, null, null, null,
      view.priorDate.value, mad(t.priorSales.value), t.priorOrders.value, null, null, null, null,
      mad(t.salesDiff.value), t.ordersDiff.value, pct(t.ratio.value), t.ratioReason === "ok" ? null : t.ratioReason,
      `${t.currentCoverage.present}/${t.currentCoverage.total} current; ${t.priorCoverage.present}/${t.priorCoverage.total} prior`, t.incomplete ? "no" : "yes"]);
    return { name: `comparison-weekly-${view.currentDate.value}-vs-${view.priorDate.value}.csv`, header, rows };
  }

  const header = ["mode", "row", "day", "current_date", "current_sales_mad", "current_orders", "current_branches_present", "current_status",
    "prior_date", "prior_sales_mad", "prior_orders", "prior_branches_present", "prior_status", "growth_pct", "growth_note", "comparable_days"];
  const rows: Cell[][] = view.rows.map((r) => ["monthly", "day", r.day, r.current.date.value, mad(r.current.sales.value), r.current.orders.value,
    `${r.current.present}/${r.current.total}`, r.current.status, r.prior.date.value, mad(r.prior.sales.value), r.prior.orders.value,
    `${r.prior.present}/${r.prior.total}`, r.prior.status, pct(r.growth.value), r.growthReason === "ok" ? null : r.growthReason, null]);
  for (const b of view.branches) {
    rows.push(["monthly", `period:${b.branch.code}`, null, view.currentMonth, mad(b.currentSales), b.currentOrders,
      `${b.currentCoverage.present}/${b.currentCoverage.total} days`, null, view.priorMonth, mad(b.priorSales), b.priorOrders,
      `${b.priorCoverage.present}/${b.priorCoverage.total} days`, null, pct(b.growth), b.growthReason === "ok" ? null : b.growthReason, b.comparableDays]);
  }
  const p = view.period;
  rows.push(["monthly", "period:total", null, view.currentMonth, mad(p.currentSales), p.currentOrders, null, null, view.priorMonth,
    mad(p.priorSales), p.priorOrders, null, null, pct(p.growth), p.growthReason === "ok" ? null : p.growthReason, p.comparableDays]);
  return { name: `comparison-monthly-${view.currentMonth}-vs-${view.priorMonth}.csv`, header, rows };
}
