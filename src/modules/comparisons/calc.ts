import { growthBp, ratioBp, type Blank, type Minor, type RatioBp } from "@/lib/money";
import { addDays, daysInMonth, type BusinessDate } from "@/lib/dates";

/*
 * Cross-branch comparison (CMP-01..CMP-08). Pure calculations over saved figures.
 *
 * - A branch with no figure for a date is MISSING (explicit), never 0. A recorded 0 is a figure.
 * - Dates after a branch's current business date are FUTURE; dates before its first live business
 *   date are BEFORE_LIVE (unavailable) unless a historical figure was entered for the report.
 * - Weekly mode: one shared current/prior date pair. «نسبة الحالي للسابق» = current ÷ prior (CMP-06).
 * - Monthly mode, kept separate: days matched by day number (CMP-01/02), daily growth = current ÷
 *   prior − 1 (CMP-03), period growth like for like over days present in both months (CMP-04).
 * - Totals cover the selected branches and dates only (CMP-08) and say how complete they are.
 * Ratios and growth are basis points (12000 = 120 %); blank (null) whenever they cannot be calculated,
 * so a page never shows NaN, ∞ or an invented 0 %.
 */

/** SRC-12 reading order of the branches; the total follows them. */
export const BRANCH_ORDER = ["alquds", "maarif", "bourgogne"] as const;

export type Metric = "net_sales" | "order_count";
export type Origin = "closed_day" | "legacy_day" | "entry";

/** A saved figure and where it came from. */
export interface Figure {
  value: number;
  origin: Origin;
  /** Source designation key ("daily_close", "reporting_only", ...). */
  source: string;
  sourceLabelEn: string | null;
  sourceLabelAr: string | null;
  purpose: "live" | "historical";
  /** Saved record, e.g. "operating_day_revisions:41" or "comparison_entries:7". */
  record: string;
  revision: number;
  reference: string;
  actor: string;
  recordedAt: string | null;
}

export interface BranchInfo {
  code: string;
  nameEn: string;
  nameAr: string;
  operatesInApp: boolean;
  /** First live business date; null when not set (no date is treated as before it). */
  liveFrom: BusinessDate | null;
  liveFromBasis: "configured" | "first_close" | null;
  /** The branch's current business date; later dates are in the future. Null: no limit. */
  today: BusinessDate | null;
  liveSource: string | null;
  liveSourceEn: string | null;
  liveSourceAr: string | null;
  entryOwner: string | null;
}

export interface ComparisonData {
  branches: BranchInfo[];
  /** Keyed by figureKey(branch, date, metric). */
  figures: ReadonlyMap<string, Figure>;
}

export const figureKey = (branch: string, date: BusinessDate, metric: Metric) => `${branch}|${date}|${metric}`;

export type DayStatus = "available" | "missing" | "before_live" | "future" | "no_such_day";

/** One branch on one business date. */
export interface BranchDay {
  branchCode: string;
  /** Null in monthly mode when the month has no such day number (e.g. 31 September). */
  businessDate: BusinessDate | null;
  status: DayStatus;
  sales: Blank<Minor>;
  orders: Blank<number>;
  salesFigure: Figure | null;
  ordersFigure: Figure | null;
  historical: boolean;
}

export function branchDay(data: ComparisonData, branch: BranchInfo, date: BusinessDate | null): BranchDay {
  if (date === null) {
    return { branchCode: branch.code, businessDate: null, status: "no_such_day", sales: null, orders: null, salesFigure: null, ordersFigure: null, historical: false };
  }
  const salesFigure = data.figures.get(figureKey(branch.code, date, "net_sales")) ?? null;
  const ordersFigure = data.figures.get(figureKey(branch.code, date, "order_count")) ?? null;
  const historical = salesFigure?.purpose === "historical" || ordersFigure?.purpose === "historical";
  let status: DayStatus;
  if (branch.today !== null && date > branch.today) status = "future";
  else if (salesFigure !== null) status = "available";
  else if (branch.liveFrom !== null && date < branch.liveFrom) status = "before_live";
  else status = "missing";
  const usable = status === "available";
  return {
    branchCode: branch.code,
    businessDate: date,
    status,
    sales: usable ? salesFigure!.value : null,
    orders: usable || (status === "missing" && ordersFigure !== null) ? (ordersFigure?.value ?? null) : null,
    salesFigure: usable ? salesFigure : null,
    ordersFigure: status === "future" || status === "before_live" ? null : ordersFigure,
    historical: usable && historical,
  };
}

export interface Coverage {
  present: number;
  total: number;
}

function difference(current: Blank<number>, prior: Blank<number>): Blank<number> {
  return current === null || prior === null ? null : current - prior;
}

// ------------------------------------------------------------------ weekly mode

export type RatioReason = "ok" | "current_unavailable" | "prior_unavailable" | "prior_zero" | "different_branches" | "no_figures";

function ratioWithReason(current: Blank<Minor>, prior: Blank<Minor>): { ratio: Blank<RatioBp>; reason: RatioReason } {
  if (current === null) return { ratio: null, reason: "current_unavailable" };
  if (prior === null) return { ratio: null, reason: "prior_unavailable" };
  if (prior === 0) return { ratio: null, reason: "prior_zero" };
  return { ratio: ratioBp(current, prior), reason: "ok" };
}

export interface WeeklyRow {
  branch: BranchInfo;
  current: BranchDay;
  prior: BranchDay;
  salesDiff: Blank<Minor>;
  ordersDiff: Blank<number>;
  /** CMP-06 «نسبة الحالي للسابق»: current sales ÷ prior sales. */
  ratio: Blank<RatioBp>;
  ratioReason: RatioReason;
}

export interface WeeklyTotal {
  currentSales: Blank<Minor>;
  priorSales: Blank<Minor>;
  currentOrders: Blank<number>;
  priorOrders: Blank<number>;
  currentCoverage: Coverage;
  priorCoverage: Coverage;
  /** Branches without a usable figure on each date. */
  missingCurrent: string[];
  missingPrior: string[];
  incomplete: boolean;
  salesDiff: Blank<Minor>;
  ordersDiff: Blank<number>;
  ratio: Blank<RatioBp>;
  ratioReason: RatioReason;
}

export interface WeeklyComparison {
  currentDate: BusinessDate;
  priorDate: BusinessDate;
  rows: WeeklyRow[];
  total: WeeklyTotal;
}

function sumPresent(values: ReadonlyArray<Blank<number>>): Blank<number> {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/** Weekly comparison of the selected branches over ONE shared current/prior date pair. */
export function weeklyComparison(data: ComparisonData, currentDate: BusinessDate, priorDate: BusinessDate): WeeklyComparison {
  const rows: WeeklyRow[] = data.branches.map((branch) => {
    const current = branchDay(data, branch, currentDate);
    const prior = branchDay(data, branch, priorDate);
    const { ratio, reason } = ratioWithReason(current.sales, prior.sales);
    return {
      branch,
      current,
      prior,
      salesDiff: difference(current.sales, prior.sales),
      ordersDiff: difference(current.orders, prior.orders),
      ratio,
      ratioReason: reason,
    };
  });

  const missingCurrent = rows.filter((r) => r.current.sales === null).map((r) => r.branch.code);
  const missingPrior = rows.filter((r) => r.prior.sales === null).map((r) => r.branch.code);
  const currentSales = sumPresent(rows.map((r) => r.current.sales));
  const priorSales = sumPresent(rows.map((r) => r.prior.sales));
  // Orders are totalled over the branches whose sales count, so both totals describe the same set.
  const currentOrders = sumPresent(rows.filter((r) => r.current.sales !== null).map((r) => r.current.orders));
  const priorOrders = sumPresent(rows.filter((r) => r.prior.sales !== null).map((r) => r.prior.orders));
  const sameBranches = rows.every((r) => (r.current.sales === null) === (r.prior.sales === null));
  const ordersComparable = rows.every((r) => (r.current.sales === null) === (r.prior.sales === null)
    && (r.current.sales === null || (r.current.orders !== null && r.prior.orders !== null)));

  let ratio: Blank<RatioBp> = null;
  let ratioReason: RatioReason;
  if (currentSales === null && priorSales === null) ratioReason = "no_figures";
  else if (!sameBranches) ratioReason = "different_branches";
  else ({ ratio, reason: ratioReason } = ratioWithReason(currentSales, priorSales));

  return {
    currentDate,
    priorDate,
    rows,
    total: {
      currentSales,
      priorSales,
      currentOrders,
      priorOrders,
      currentCoverage: { present: rows.length - missingCurrent.length, total: rows.length },
      priorCoverage: { present: rows.length - missingPrior.length, total: rows.length },
      missingCurrent,
      missingPrior,
      incomplete: missingCurrent.length > 0 || missingPrior.length > 0,
      salesDiff: sameBranches ? difference(currentSales, priorSales) : null,
      ordersDiff: ordersComparable ? difference(currentOrders, priorOrders) : null,
      ratio,
      ratioReason,
    },
  };
}

// ------------------------------------------------------------------ monthly mode

export type GrowthReason = "ok" | "current_unavailable" | "prior_unavailable" | "before_live" | "prior_zero" | "incomplete" | "future" | "no_such_day";

/** CMP-03: current ÷ prior − 1. A recorded 0 gives −100 %; a blank or zero prior gives blank. */
export function monthlyGrowth(current: Blank<Minor>, prior: Blank<Minor>): Blank<RatioBp> {
  return growthBp(current, prior);
}

/** The selected branches on one date of one month. */
export interface MonthSide {
  date: BusinessDate | null;
  days: BranchDay[];
  /** Sum of the branches with a figure; complete only when every selected branch has one. */
  sales: Blank<Minor>;
  orders: Blank<number>;
  present: number;
  complete: boolean;
  status: "complete" | "partial" | "missing" | "before_live" | "future" | "no_such_day";
}

export interface MonthlyDayRow {
  day: number;
  current: MonthSide;
  prior: MonthSide;
  /** True when every selected branch has a figure on both dates (CMP-04 like for like). */
  comparable: boolean;
  growth: Blank<RatioBp>;
  growthReason: GrowthReason;
}

export interface PeriodSummary {
  /** Day numbers with every selected branch present in both months. */
  comparableDays: number;
  currentSales: Blank<Minor>;
  priorSales: Blank<Minor>;
  currentOrders: Blank<number>;
  priorOrders: Blank<number>;
  growth: Blank<RatioBp>;
  growthReason: "ok" | "no_comparable_day" | "prior_zero";
}

export interface BranchPeriod extends PeriodSummary {
  branch: BranchInfo;
  /** Days of each month with a figure for this branch, out of the days that have started. */
  currentCoverage: Coverage;
  priorCoverage: Coverage;
}

export interface MonthlyComparison {
  currentMonth: string;
  priorMonth: string;
  rows: MonthlyDayRow[];
  /** CMP-04 for the selected branches together. */
  period: PeriodSummary;
  branches: BranchPeriod[];
  /** Dates (of either month) where a selected branch is missing, with the branch codes. */
  missingDays: Array<{ date: BusinessDate; branches: string[] }>;
  beforeLiveDays: Array<{ date: BusinessDate; branches: string[] }>;
  /** Day numbers that have started in the current month, and how many the month has. */
  elapsedDays: number;
  monthDays: number;
  inProgress: boolean;
}

export function priorMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, "0")}`;
}

/** Every date a monthly comparison reads: both months in full. */
export function monthlyDates(month: string): BusinessDate[] {
  return [...daysInMonth(priorMonth(month)), ...daysInMonth(month)];
}

function monthSide(data: ComparisonData, date: BusinessDate | null): MonthSide {
  const days = data.branches.map((b) => branchDay(data, b, date));
  const present = days.filter((d) => d.status === "available").length;
  const complete = present === days.length && days.length > 0;
  let status: MonthSide["status"];
  if (date === null) status = "no_such_day";
  else if (days.some((d) => d.status === "future")) status = "future";
  else if (complete) status = "complete";
  else if (present > 0) status = "partial";
  else if (days.every((d) => d.status === "before_live")) status = "before_live";
  else status = "missing";
  return {
    date,
    days,
    sales: sumPresent(days.map((d) => d.sales)),
    orders: sumPresent(days.filter((d) => d.sales !== null).map((d) => d.orders)),
    present,
    complete,
    status,
  };
}

function periodOf(pairs: ReadonlyArray<{ current: { sales: Blank<Minor>; orders: Blank<number> }; prior: { sales: Blank<Minor>; orders: Blank<number> } }>): PeriodSummary {
  const comparableDays = pairs.length;
  const currentSales = comparableDays === 0 ? null : pairs.reduce((s, p) => s + (p.current.sales ?? 0), 0);
  const priorSales = comparableDays === 0 ? null : pairs.reduce((s, p) => s + (p.prior.sales ?? 0), 0);
  const ordersKnown = pairs.every((p) => p.current.orders !== null && p.prior.orders !== null);
  const currentOrders = comparableDays === 0 || !ordersKnown ? null : pairs.reduce((s, p) => s + (p.current.orders ?? 0), 0);
  const priorOrders = comparableDays === 0 || !ordersKnown ? null : pairs.reduce((s, p) => s + (p.prior.orders ?? 0), 0);
  const growth = monthlyGrowth(currentSales, priorSales);
  return {
    comparableDays,
    currentSales,
    priorSales,
    currentOrders,
    priorOrders,
    growth,
    growthReason: comparableDays === 0 ? "no_comparable_day" : growth === null ? "prior_zero" : "ok",
  };
}

/** Monthly comparison of the selected branches: `month` against the month before it. */
export function monthlyComparison(data: ComparisonData, month: string): MonthlyComparison {
  const previous = priorMonth(month);
  const currentDays = daysInMonth(month);
  const priorDays = daysInMonth(previous);
  const length = Math.max(currentDays.length, priorDays.length);
  const rows: MonthlyDayRow[] = [];
  for (let day = 1; day <= length; day += 1) {
    const current = monthSide(data, currentDays[day - 1] ?? null);
    const prior = monthSide(data, priorDays[day - 1] ?? null);
    const comparable = current.complete && prior.complete;
    let growth: Blank<RatioBp> = null;
    let growthReason: GrowthReason;
    if (current.status === "no_such_day" || prior.status === "no_such_day") growthReason = "no_such_day";
    else if (current.status === "future") growthReason = "future";
    else if (current.status === "before_live" || prior.status === "before_live") growthReason = "before_live";
    else if (current.present === 0) growthReason = "current_unavailable";
    else if (prior.present === 0) growthReason = "prior_unavailable";
    else if (!comparable) growthReason = "incomplete";
    else {
      growth = monthlyGrowth(current.sales, prior.sales);
      growthReason = growth === null ? "prior_zero" : "ok";
    }
    rows.push({ day, current, prior, comparable, growth, growthReason });
  }

  const comparableRows = rows.filter((r) => r.comparable);
  const period = periodOf(comparableRows);

  const branches: BranchPeriod[] = data.branches.map((branch, index) => {
    const pairs = rows
      .map((r) => ({ current: r.current.days[index]!, prior: r.prior.days[index]! }))
      .filter((p) => p.current.status === "available" && p.prior.status === "available");
    const started = (days: BranchDay[]) => days.filter((d) => d.status !== "future" && d.status !== "no_such_day");
    const currentStarted = started(rows.map((r) => r.current.days[index]!));
    const priorStarted = started(rows.map((r) => r.prior.days[index]!));
    return {
      branch,
      ...periodOf(pairs),
      currentCoverage: { present: currentStarted.filter((d) => d.status === "available").length, total: currentStarted.length },
      priorCoverage: { present: priorStarted.filter((d) => d.status === "available").length, total: priorStarted.length },
    };
  });

  const listBy = (status: DayStatus) => {
    const out: Array<{ date: BusinessDate; branches: string[] }> = [];
    for (const date of [...priorDays, ...currentDays]) {
      const codes = data.branches.map((b) => branchDay(data, b, date)).filter((d) => d.status === status).map((d) => d.branchCode);
      if (codes.length > 0) out.push({ date, branches: codes });
    }
    return out;
  };

  const elapsedDays = rows.filter((r) => r.current.status !== "future" && r.current.status !== "no_such_day").length;
  return {
    currentMonth: month,
    priorMonth: previous,
    rows,
    period,
    branches,
    missingDays: listBy("missing"),
    beforeLiveDays: listBy("before_live"),
    elapsedDays,
    monthDays: currentDays.length,
    inProgress: elapsedDays < currentDays.length,
  };
}

// ------------------------------------------------------------------ inputs

/** The same weekday one week earlier (the SRC-12 rule). */
export function priorWeekDate(current: BusinessDate): BusinessDate {
  return addDays(current, -7);
}

/** True when both dates fall on the same weekday. */
export function sameWeekday(a: BusinessDate, b: BusinessDate): boolean {
  const day = (d: BusinessDate) => new Date(`${d}T00:00:00Z`).getUTCDay();
  return day(a) === day(b);
}

/** Branch codes in SRC-12 order, unknown codes and duplicates dropped. */
export function orderBranches(codes: readonly string[]): string[] {
  return BRANCH_ORDER.filter((code) => codes.includes(code));
}
