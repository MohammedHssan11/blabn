import "server-only";
import { daysInMonth } from "@/lib/dates";
import { readOperatingReport, type OperatingDay, type OperatingReport } from "@/modules/closing/operations";
import { getComparison, parseComparisonQuery } from "@/modules/comparisons/service";
import type { BranchDay, Figure } from "@/modules/comparisons/calc";
import { readUnits } from "@/modules/catalog/data";
import { readProductMix, readStockDay, type ProductMix, type StockDay } from "@/modules/inventory/stock";
import { readOrder, readOrders } from "@/modules/replenishment/data";
import type { OrderJson } from "@/modules/replenishment/types";
import { buildComparison } from "./build/comparison";
import { buildDailyLedger, buildDailySales, buildDailyStatement, type DailyInput } from "./build/daily";
import { buildInventory } from "./build/inventory";
import type { AboutInfo } from "./build/about";
import type { Period } from "./families";
import type { Family, WorkbookModel } from "./model";

/**
 * Reads the saved data of one export AS THE REQUESTER (their Supabase session; row-level security and
 * the report functions check the branch permissions again) and builds the report model. Every read is
 * pinned so the file can be traced and reproduced:
 *   - daily close: one revision basis for the whole file (`app_operating_report` p_basis);
 *   - stock: the export's snapshot instant (`app_stock_day` p_as_of);
 *   - comparison and Product Mix: the record and revision (or version) of every figure used.
 */

export interface Loaded {
  model: WorkbookModel;
  /** Stored with the export (`report_exports.sources`). */
  sources: Record<string, unknown>;
  /** Shown on the About sheet. */
  aboutSources: AboutInfo["sources"];
}

export class ExportDataError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function figureRecords(days: BranchDay[]): string[] {
  const out = new Set<string>();
  const add = (f: Figure | null) => { if (f) out.add(`${f.record}@r${f.revision}${f.purpose === "historical" ? ":historical" : ""}`); };
  for (const d of days) { add(d.salesFigure); add(d.ordersFigure); }
  return [...out].sort();
}

async function loadComparison(period: Period, branches: string[]): Promise<Loaded> {
  const query = parseComparisonQuery(period.mode === "week"
    ? { mode: "weekly", current: period.current, prior: period.prior, branches }
    : { mode: "monthly", month: period.mode === "month" ? period.month : undefined, branches });
  if (query.invalid) throw new ExportDataError("invalid_period");
  const page = await getComparison(query, "export");
  const view = page.view;
  const model = view.mode === "weekly"
    ? buildComparison({ mode: "weekly", branches: page.branches, result: view.result })
    : buildComparison({ mode: "monthly", branches: page.branches, result: view.result });
  const days = view.mode === "weekly"
    ? view.result.rows.flatMap((r) => [r.current, r.prior])
    : view.result.rows.flatMap((r) => [...r.current.days, ...r.prior.days]);
  const records = figureRecords(days);
  const historical = records.filter((r) => r.endsWith(":historical")).length;
  return {
    model,
    sources: { comparison_records: records, historical_figures: historical, data_source: page.source },
    aboutSources: [{ label: "about.source.comparisonRecords", value: records.length ? records.join("; ") : "—" }],
  };
}

async function loadDaily(family: "daily_sales" | "daily_statement" | "daily_ledger", period: Period, includeDrafts: boolean,
  branch: DailyInput["branch"]): Promise<Loaded> {
  if (period.mode === "week") throw new ExportDataError("invalid_period");
  const month = period.mode === "month" ? period.month : period.date.slice(0, 7);
  const first: OperatingReport = await readOperatingReport(null, month, null);
  const basis = first.basis > 0 ? first.basis : null;
  const details: Record<string, OperatingDay> = {};
  if (family !== "daily_sales") {
    const wanted = period.mode === "day" ? [period.date] : first.days.map((d) => d.date);
    for (const day of wanted) {
      if (basis === null) break;
      const report = await readOperatingReport(day, month, basis);
      if (report.day) details[day] = report.day;
    }
  }
  const input: DailyInput = { branch, period, includeDrafts, report: first, details };
  const model = family === "daily_sales" ? buildDailySales(input) : family === "daily_statement" ? buildDailyStatement(input) : buildDailyLedger(input);
  const revisions = Object.entries(details).map(([day, d]) => `${day}:r${d.revision}:${d.state}`).sort();
  const states = first.days.map((d) => `${d.date}:${d.state}`);
  return {
    model,
    sources: { operating_basis: first.basis, operating_days: states, day_revisions: revisions },
    aboutSources: [
      { label: "about.source.operatingBasis", value: String(first.basis) },
      { label: "about.source.days", value: (revisions.length ? revisions : states).join("; ") || "—" },
    ],
  };
}

async function loadInventory(period: Period, snapshotAt: string): Promise<Loaded> {
  if (period.mode === "week") throw new ExportDataError("invalid_period");
  const firstDate = period.mode === "day" ? period.date : `${period.month}-01`;
  const firstDay: StockDay = await readStockDay(firstDate, snapshotAt);
  const today = firstDay.today;
  const dates = period.mode === "day" ? [period.date] : daysInMonth(period.month).filter((d) => d <= today);
  const stock: StockDay[] = [firstDay];
  for (const day of dates.slice(1)) stock.push(await readStockDay(day, snapshotAt));
  const mixes: ProductMix[] = [];
  for (const day of dates) mixes.push(await readProductMix(day));
  const from = dates[0] ?? firstDate;
  const to = dates[dates.length - 1] ?? firstDate;
  const list = await readOrders(500);
  const touches = (o: OrderJson) => [o.business_date, o.expected?.date, o.original_expected?.date, ...o.receipt_dates]
    .some((d) => !!d && d >= from && d <= to);
  const orders: OrderJson[] = [];
  for (const o of list.orders.filter(touches)) {
    const full = await readOrder(o.id);
    if (full) orders.push(full);
  }
  const units = await readUnits();
  const model = buildInventory({ period, today, stock, mixes, orders, units });
  const mixVersions = mixes.filter((m) => m.report).map((m) => `${m.date}:v${m.report!.version}:${m.report!.state}`);
  const orderRefs = orders.map((o) => `PO-${o.order_no}:${o.status}:events=${o.events?.length ?? 0}:receipts=${o.receipts?.length ?? 0}`);
  return {
    model,
    sources: { stock_as_of: snapshotAt, stock_dates: [from, to], product_mix: mixVersions, orders: orderRefs },
    aboutSources: [
      { label: "about.source.stockAsOf", value: snapshotAt },
      { label: "about.source.productMix", value: mixVersions.join("; ") || "—" },
      { label: "about.source.orders", value: orderRefs.join("; ") || "—" },
    ],
  };
}

export async function loadReport(input: {
  family: Family; branches: string[]; period: Period; includeDrafts: boolean; snapshotAt: string;
  branchNames: Array<{ code: string; nameAr: string; nameEn: string }>;
}): Promise<Loaded> {
  switch (input.family) {
    case "sales_comparison":
      return loadComparison(input.period, input.branches);
    case "inventory":
      return loadInventory(input.period, input.snapshotAt);
    default: {
      const branch = input.branchNames.find((b) => b.code === input.branches[0]);
      if (!branch) throw new ExportDataError("branch_unavailable");
      return loadDaily(input.family, input.period, input.includeDrafts, branch);
    }
  }
}
