import "server-only";
import { getRepository } from "@/lib/repository";
import { isBusinessDate, isMonth, type BusinessDate } from "@/lib/dates";
import type { Blank, Minor, RatioBp } from "@/lib/money";
import { first, type SearchParams } from "@/lib/search-params";
import { traced, type Traced } from "@/modules/reports/trace";
import { usesDemoFixtures } from "@/modules/closing/operations";
import {
  BRANCH_ORDER,
  figureKey,
  monthlyComparison,
  monthlyDates,
  orderBranches,
  priorWeekDate,
  sameWeekday,
  weeklyComparison,
  type BranchDay,
  type BranchInfo,
  type ComparisonData,
  type Coverage,
  type DayStatus,
  type Figure,
  type GrowthReason,
  type MonthlyComparison,
  type RatioReason,
  type WeeklyComparison,
} from "./calc";
import { readBranchNames, readComparisonData } from "./data";

/** Phase 2 demonstration dates (synthetic fixtures, used by the smoke tests). */
export const DEMO_CURRENT_DATE = "2026-11-10";
export const SAMPLE_CURRENT_DATES: readonly BusinessDate[] = ["2026-11-10", "2026-11-17"];

export type Mode = "weekly" | "monthly";

export interface ComparisonQuery {
  mode: Mode;
  currentDate: BusinessDate;
  priorDate: BusinessDate;
  month: string;
  branches: string[];
  /** Something in the address was not valid and a default was used instead. */
  invalid: boolean;
}

/**
 * Reads ?mode, ?current, ?prior, ?month and ?branches; anything invalid falls back to a default.
 * `today` is the database's business date (`readBusinessToday`), used only for the defaults.
 */
export function parseComparisonQuery(sp: SearchParams, today: BusinessDate): ComparisonQuery {
  let invalid = false;
  const modeParam = first(sp.mode);
  const mode: Mode = modeParam === "monthly" ? "monthly" : "weekly";
  if (modeParam !== undefined && modeParam !== "weekly" && modeParam !== "monthly") invalid = true;

  const fallbackCurrent = usesDemoFixtures() ? DEMO_CURRENT_DATE : today;
  const currentParam = first(sp.current);
  let currentDate = fallbackCurrent;
  if (currentParam !== undefined) {
    if (isBusinessDate(currentParam) && currentParam >= "2000-01-01") currentDate = currentParam;
    else invalid = true;
  }
  const priorParam = first(sp.prior);
  let priorDate = priorWeekDate(currentDate);
  if (priorParam !== undefined && priorParam !== "") {
    if (isBusinessDate(priorParam) && priorParam < currentDate && sameWeekday(priorParam, currentDate) && priorParam >= "2000-01-01") priorDate = priorParam;
    else invalid = true;
  }

  const monthParam = first(sp.month);
  let month = currentDate.slice(0, 7);
  if (monthParam !== undefined) {
    if (isMonth(monthParam) && monthParam >= "2000-02") month = monthParam;
    else invalid = true;
  }

  const raw = sp.branches;
  let branches: string[] = [...BRANCH_ORDER];
  if (raw !== undefined) {
    const codes = (Array.isArray(raw) ? raw : raw.split(",")).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    const known = orderBranches(codes);
    if (known.length === 0 || known.length !== new Set(codes).size) invalid = true;
    if (known.length > 0) branches = known;
  }
  return { mode, currentDate, priorDate, month, branches, invalid };
}

export function datesOf(query: ComparisonQuery): BusinessDate[] {
  return query.mode === "weekly" ? [query.currentDate, query.priorDate] : monthlyDates(query.month);
}

/** Address of a query, for links and the export. */
export function queryString(query: ComparisonQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ mode: query.mode });
  if (query.mode === "weekly") {
    params.set("current", query.currentDate);
    params.set("prior", query.priorDate);
  } else {
    params.set("month", query.month);
  }
  params.set("branches", query.branches.join(","));
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return params.toString();
}

// ------------------------------------------------------------------ data from the Phase 2 fixtures

async function fixtureData(branches: readonly string[]): Promise<ComparisonData> {
  const repo = getRepository();
  const [all, days, entered] = await Promise.all([repo.listBranches(), repo.listBusinessDays(), repo.listComparisonFigures()]);
  const info: BranchInfo[] = branches.flatMap((code) => {
    const b = all.find((x) => x.code === code);
    return b ? [{ code: b.code, nameEn: b.nameEn, nameAr: b.nameAr, operatesInApp: b.operatesInApp, liveFrom: null, liveFromBasis: null,
      today: null, liveSource: null, liveSourceEn: null, liveSourceAr: null, entryOwner: null }] : [];
  });
  const figures = new Map<string, Figure>();
  const put = (branch: string, date: string, metric: "net_sales" | "order_count", value: number | null, base: Omit<Figure, "value">) => {
    if (value !== null && branches.includes(branch)) figures.set(figureKey(branch, date, metric), { ...base, value });
  };
  for (const d of days) {
    if (d.status !== "closed" || d.netSales === null) continue;
    const base = { origin: "closed_day" as const, source: "daily_close", sourceLabelEn: null, sourceLabelAr: null, purpose: "live" as const,
      record: `business_days:${d.branchCode}:${d.businessDate}`, revision: d.revision, reference: "", actor: "", recordedAt: d.closedAt };
    put(d.branchCode, d.businessDate, "net_sales", d.netSales, base);
    put(d.branchCode, d.businessDate, "order_count", d.orderCount, base);
  }
  for (const f of entered) {
    if (figures.has(figureKey(f.branchCode, f.businessDate, "net_sales"))) continue; // a closed day wins
    const base = { origin: "entry" as const, source: f.source, sourceLabelEn: null, sourceLabelAr: null, purpose: "live" as const,
      record: `comparison_figures:${f.branchCode}:${f.businessDate}`, revision: 1, reference: "", actor: "", recordedAt: null };
    put(f.branchCode, f.businessDate, "net_sales", f.netSales, base);
    put(f.branchCode, f.businessDate, "order_count", f.orderCount, base);
  }
  return { branches: info, figures };
}

export async function loadComparisonData(query: ComparisonQuery, access: "view" | "export"): Promise<{ data: ComparisonData; source: "database" | "synthetic-fixtures"; dataVersion: string | null }> {
  if (usesDemoFixtures()) {
    return { data: await fixtureData(query.branches), source: "synthetic-fixtures", dataVersion: getRepository().dataVersion };
  }
  return { data: await readComparisonData(access, query.branches, datesOf(query)), source: "database", dataVersion: null };
}

// ------------------------------------------------------------------ view models (every value traced)

export interface SourceView {
  key: string;
  labelEn: string | null;
  labelAr: string | null;
  origin: Figure["origin"];
  historical: boolean;
  reference: string;
  revision: number;
  actor: string;
}

export interface DayCell {
  status: DayStatus;
  date: Traced<Blank<BusinessDate>>;
  sales: Traced<Blank<Minor>>;
  orders: Traced<Blank<number>>;
  source: SourceView | null;
}

function cell(day: BranchDay, dateField: string, valueField: string): DayCell {
  const figure = day.salesFigure;
  const record = figure?.record;
  return {
    status: day.status,
    date: traced(day.businessDate, { field: dateField }),
    sales: traced(day.sales, { field: valueField, record }),
    orders: traced(day.orders, { field: valueField, record: day.ordersFigure?.record }),
    source: figure
      ? { key: figure.source, labelEn: figure.sourceLabelEn, labelAr: figure.sourceLabelAr, origin: figure.origin,
          historical: figure.purpose === "historical", reference: figure.reference, revision: figure.revision, actor: figure.actor }
      : null,
  };
}

export interface WeeklyRowView {
  branch: BranchInfo;
  current: DayCell;
  prior: DayCell;
  salesDiff: Traced<Blank<Minor>>;
  ordersDiff: Traced<Blank<number>>;
  ratio: Traced<Blank<RatioBp>>;
  ratioReason: RatioReason;
}

export interface WeeklyView {
  mode: "weekly";
  currentDate: Traced<BusinessDate>;
  priorDate: Traced<BusinessDate>;
  rows: WeeklyRowView[];
  total: {
    currentSales: Traced<Blank<Minor>>;
    priorSales: Traced<Blank<Minor>>;
    currentOrders: Traced<Blank<number>>;
    priorOrders: Traced<Blank<number>>;
    salesDiff: Traced<Blank<Minor>>;
    ordersDiff: Traced<Blank<number>>;
    ratio: Traced<Blank<RatioBp>>;
    ratioReason: RatioReason;
    currentCoverage: Coverage;
    priorCoverage: Coverage;
    missingCurrent: string[];
    missingPrior: string[];
    incomplete: boolean;
  };
  result: WeeklyComparison;
}

export function weeklyView(data: ComparisonData, currentDate: BusinessDate, priorDate: BusinessDate): WeeklyView {
  const result = weeklyComparison(data, currentDate, priorDate);
  const t = result.total;
  return {
    mode: "weekly",
    currentDate: traced(currentDate, { field: "CMP-05" }),
    priorDate: traced(priorDate, { field: "CMP-05" }),
    rows: result.rows.map((row) => ({
      branch: row.branch,
      current: cell(row.current, "CMP-05", "CMP-07"),
      prior: cell(row.prior, "CMP-05", "CMP-07"),
      salesDiff: traced(row.salesDiff, {}),
      ordersDiff: traced(row.ordersDiff, {}),
      ratio: traced(row.ratio, { field: "CMP-06" }),
      ratioReason: row.ratioReason,
    })),
    total: {
      currentSales: traced(t.currentSales, { field: "CMP-08" }),
      priorSales: traced(t.priorSales, { field: "CMP-08" }),
      currentOrders: traced(t.currentOrders, { field: "CMP-08" }),
      priorOrders: traced(t.priorOrders, { field: "CMP-08" }),
      salesDiff: traced(t.salesDiff, {}),
      ordersDiff: traced(t.ordersDiff, {}),
      ratio: traced(t.ratio, { field: "CMP-06" }),
      ratioReason: t.ratioReason,
      currentCoverage: t.currentCoverage,
      priorCoverage: t.priorCoverage,
      missingCurrent: t.missingCurrent,
      missingPrior: t.missingPrior,
      incomplete: t.incomplete,
    },
    result,
  };
}

export interface MonthSideView {
  date: Traced<Blank<BusinessDate>>;
  sales: Traced<Blank<Minor>>;
  orders: Traced<Blank<number>>;
  present: number;
  total: number;
  status: MonthlyComparison["rows"][number]["current"]["status"];
}

export interface MonthlyView {
  mode: "monthly";
  currentMonth: string;
  priorMonth: string;
  rows: Array<{ day: number; current: MonthSideView; prior: MonthSideView; comparable: boolean; growth: Traced<Blank<RatioBp>>; growthReason: GrowthReason }>;
  period: MonthlyComparison["period"] & { growthTraced: Traced<Blank<RatioBp>> };
  branches: Array<MonthlyComparison["branches"][number] & { growthTraced: Traced<Blank<RatioBp>> }>;
  result: MonthlyComparison;
}

export function monthlyView(data: ComparisonData, month: string): MonthlyView {
  const result = monthlyComparison(data, month);
  const side = (s: MonthlyComparison["rows"][number]["current"]): MonthSideView => ({
    date: traced(s.date, { field: "CMP-01" }),
    sales: traced(s.sales, { field: "CMP-02" }),
    orders: traced(s.orders, { field: "CMP-02" }),
    present: s.present,
    total: s.days.length,
    status: s.status,
  });
  return {
    mode: "monthly",
    currentMonth: result.currentMonth,
    priorMonth: result.priorMonth,
    rows: result.rows.map((r) => ({
      day: r.day,
      current: side(r.current),
      prior: side(r.prior),
      comparable: r.comparable,
      growth: traced(r.growth, { field: "CMP-03" }),
      growthReason: r.growthReason,
    })),
    period: { ...result.period, growthTraced: traced(result.period.growth, { field: "CMP-04" }) },
    branches: result.branches.map((b) => ({ ...b, growthTraced: traced(b.growth, { field: "CMP-04" }) })),
    result,
  };
}

export interface ComparisonPageModel {
  query: ComparisonQuery;
  source: "database" | "synthetic-fixtures";
  dataVersion: string | null;
  branches: BranchInfo[];
  /** Every branch the person can see, for the selection form (names only, no figures). */
  names: Array<{ code: string; nameEn: string; nameAr: string }>;
  view: WeeklyView | MonthlyView;
}

export async function getComparison(query: ComparisonQuery, access: "view" | "export" = "view"): Promise<ComparisonPageModel> {
  const { data, source, dataVersion } = await loadComparisonData(query, access);
  const view = query.mode === "weekly" ? weeklyView(data, query.currentDate, query.priorDate) : monthlyView(data, query.month);
  const names = source === "database"
    ? await readBranchNames()
    : (await getRepository().listBranches()).map((b) => ({ code: b.code, nameEn: b.nameEn, nameAr: b.nameAr }));
  return { query, source, dataVersion, branches: data.branches, names, view };
}
