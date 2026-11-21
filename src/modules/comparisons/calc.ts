import { growthBp, ratioBp, type Blank, type Minor, type RatioBp } from "@/lib/money";
import type { BusinessDate } from "@/lib/dates";
import type { BusinessDay, ComparisonFigure } from "@/modules/closing/types";

/*
 * Cross-branch comparison (CMP-*). One date pair is shared by every branch. A
 * branch with no figure for a date is MISSING (explicit), never 0.
 */

export type FigureSource = "closed_day" | "reporting_only" | "missing";

export interface BranchFigure {
  branchCode: string;
  businessDate: BusinessDate;
  sales: Blank<Minor>;
  source: FigureSource;
  /** Saved record the figure came from; absent when missing. */
  record: string | null;
}

/**
 * The figure of one branch for one date. A closed business day wins; otherwise
 * a separately recorded reporting-only figure (Al Quds, Bourgogne, or Maarif
 * before it went live); otherwise the branch is missing for that date.
 */
export function figureFor(
  branchCode: string,
  businessDate: BusinessDate,
  days: readonly BusinessDay[],
  reportingOnly: readonly ComparisonFigure[],
): BranchFigure {
  const day = days.find(
    (d) => d.branchCode === branchCode && d.businessDate === businessDate && d.status === "closed" && d.netSales !== null,
  );
  if (day) {
    return {
      branchCode,
      businessDate,
      sales: day.netSales,
      source: "closed_day",
      record: `business_days:${branchCode}:${businessDate}`,
    };
  }
  const entry = reportingOnly.find(
    (f) => f.branchCode === branchCode && f.businessDate === businessDate && f.netSales !== null,
  );
  if (entry) {
    return {
      branchCode,
      businessDate,
      sales: entry.netSales,
      source: "reporting_only",
      record: `comparison_figures:${branchCode}:${businessDate}`,
    };
  }
  return { branchCode, businessDate, sales: null, source: "missing", record: null };
}

export interface Coverage {
  present: number;
  total: number;
}

export interface ComparisonRow {
  branchCode: string;
  current: BranchFigure;
  prior: BranchFigure;
  /** CMP-06: current / prior; blank when either figure is missing or prior is 0. */
  ratio: Blank<RatioBp>;
}

export type TotalRatioReason = "ok" | "prior_missing_or_zero" | "different_branches";

export interface ComparisonTotal {
  /** CMP-08: sum of the figures that exist; incomplete when a branch is missing. */
  current: Blank<Minor>;
  prior: Blank<Minor>;
  currentCoverage: Coverage;
  priorCoverage: Coverage;
  incomplete: boolean;
  ratio: Blank<RatioBp>;
  ratioReason: TotalRatioReason;
}

export interface WeeklyComparison {
  currentDate: BusinessDate;
  priorDate: BusinessDate;
  rows: ComparisonRow[];
  total: ComparisonTotal;
}

function coverageOf(figures: readonly BranchFigure[]): Coverage {
  return { present: figures.filter((f) => f.sales !== null).length, total: figures.length };
}

function sumOrBlank(figures: readonly BranchFigure[]): Blank<Minor> {
  const present = figures.filter((f): f is BranchFigure & { sales: Minor } => f.sales !== null);
  return present.length === 0 ? null : present.reduce((total, f) => total + f.sales, 0);
}

/**
 * Weekly comparison of several branches over ONE shared date pair.
 *
 * The total's ratio is only calculated when the same branches are present on
 * both dates; otherwise comparing totals would compare different sets of
 * branches. Phase 7 confirms this rule with Abdo.
 */
export function compareWeekly(
  branchCodes: readonly string[],
  currentDate: BusinessDate,
  priorDate: BusinessDate,
  days: readonly BusinessDay[],
  reportingOnly: readonly ComparisonFigure[],
): WeeklyComparison {
  const rows: ComparisonRow[] = branchCodes.map((code) => {
    const current = figureFor(code, currentDate, days, reportingOnly);
    const prior = figureFor(code, priorDate, days, reportingOnly);
    return { branchCode: code, current, prior, ratio: ratioBp(current.sales, prior.sales) };
  });

  const currentFigures = rows.map((r) => r.current);
  const priorFigures = rows.map((r) => r.prior);
  const currentCoverage = coverageOf(currentFigures);
  const priorCoverage = coverageOf(priorFigures);
  const sameBranches = rows.every((r) => (r.current.sales === null) === (r.prior.sales === null));
  const current = sumOrBlank(currentFigures);
  const prior = sumOrBlank(priorFigures);

  let ratio: Blank<RatioBp> = null;
  let ratioReason: TotalRatioReason = "ok";
  if (!sameBranches) {
    ratioReason = "different_branches";
  } else {
    ratio = ratioBp(current, prior);
    if (ratio === null) ratioReason = "prior_missing_or_zero";
  }

  return {
    currentDate,
    priorDate,
    rows,
    total: {
      current,
      prior,
      currentCoverage,
      priorCoverage,
      incomplete: currentCoverage.present < currentCoverage.total || priorCoverage.present < priorCoverage.total,
      ratio,
      ratioReason,
    },
  };
}

/** CMP-03: monthly growth = current / prior - 1. A recorded 0 gives -100%; blank prior or 0 gives blank. */
export function monthlyGrowth(current: Blank<Minor>, prior: Blank<Minor>): Blank<RatioBp> {
  return growthBp(current, prior);
}
