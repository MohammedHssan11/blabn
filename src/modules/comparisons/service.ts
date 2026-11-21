import "server-only";
import type { BranchSettings } from "@/modules/access/branches";
import { getRepository } from "@/lib/repository";
import { addDays, isBusinessDate, type BusinessDate } from "@/lib/dates";
import type { Blank, Minor, RatioBp } from "@/lib/money";
import { traced, type Traced } from "@/modules/reports/trace";
import { compareWeekly, type Coverage, type FigureSource, type TotalRatioReason } from "./calc";

export const DEFAULT_CURRENT_DATE = "2026-11-10";
/** The legacy weekly comparison sets the prior date one week before the current date. */
export const WEEK_DAYS = 7;
/** Selectable current dates in the synthetic data (Tuesdays, like the legacy workbook). */
export const SAMPLE_CURRENT_DATES: readonly BusinessDate[] = ["2026-11-10", "2026-11-17"];

export interface BranchColumnView {
  branch: BranchSettings;
  current: Traced<Blank<Minor>>; // CMP-07
  currentSource: FigureSource;
  prior: Traced<Blank<Minor>>; // CMP-07
  priorSource: FigureSource;
  ratio: Traced<Blank<RatioBp>>; // CMP-06
}

export interface ComparisonView {
  repositorySource: string;
  dataVersion: string;
  /** False when the requested date was invalid and the default was used instead. */
  requestedDateValid: boolean;
  currentDate: Traced<BusinessDate>; // CMP-05
  priorDate: Traced<BusinessDate>; // CMP-05
  rows: BranchColumnView[];
  total: {
    current: Traced<Blank<Minor>>; // CMP-08
    prior: Traced<Blank<Minor>>; // CMP-08
    currentCoverage: Coverage;
    priorCoverage: Coverage;
    incomplete: boolean;
    ratio: Traced<Blank<RatioBp>>;
    ratioReason: TotalRatioReason;
  };
}

export async function getComparisonView(currentParam?: string): Promise<ComparisonView> {
  const repo = getRepository();
  const branches = await repo.listBranches();
  const [days, reportingOnly] = await Promise.all([repo.listBusinessDays(), repo.listComparisonFigures()]);

  const requestedDateValid = currentParam === undefined || isBusinessDate(currentParam);
  const currentDate = currentParam !== undefined && isBusinessDate(currentParam) ? currentParam : DEFAULT_CURRENT_DATE;
  const priorDate = addDays(currentDate, -WEEK_DAYS);

  // Maarif first, as in the legacy workbook's reading order for this branch set.
  const ordered = [...branches].sort(
    (a, b) => Number(b.operatesInApp) - Number(a.operatesInApp) || a.code.localeCompare(b.code),
  );
  const result = compareWeekly(
    ordered.map((b) => b.code),
    currentDate,
    priorDate,
    days,
    reportingOnly,
  );

  const rows: BranchColumnView[] = result.rows.map((row) => {
    const branch = ordered.find((b) => b.code === row.branchCode)!;
    return {
      branch,
      current: traced(row.current.sales, { field: "CMP-07", record: row.current.record ?? undefined }),
      currentSource: row.current.source,
      prior: traced(row.prior.sales, { field: "CMP-07", record: row.prior.record ?? undefined }),
      priorSource: row.prior.source,
      ratio: traced(row.ratio, { field: "CMP-06" }),
    };
  });

  return {
    repositorySource: repo.source,
    dataVersion: repo.dataVersion,
    requestedDateValid,
    currentDate: traced(result.currentDate, { field: "CMP-05" }),
    priorDate: traced(result.priorDate, { field: "CMP-05" }),
    rows,
    total: {
      current: traced(result.total.current, { field: "CMP-08" }),
      prior: traced(result.total.prior, { field: "CMP-08" }),
      currentCoverage: result.total.currentCoverage,
      priorCoverage: result.total.priorCoverage,
      incomplete: result.total.incomplete,
      ratio: traced(result.total.ratio, { field: "CMP-06" }),
      ratioReason: result.total.ratioReason,
    },
  };
}
