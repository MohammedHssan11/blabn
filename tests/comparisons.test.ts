import { describe, expect, it } from "vitest";
import { compareWeekly, figureFor, monthlyGrowth } from "@/modules/comparisons/calc";
import type { BusinessDay, ComparisonFigure } from "@/modules/closing/types";
import { CONTRACT_EXAMPLES } from "@/modules/reports/contracts";

const closed = (branchCode: string, businessDate: string, netSales: number): BusinessDay => ({
  id: `${branchCode}-${businessDate}`,
  branchCode,
  businessDate,
  status: "closed",
  closedAt: `${businessDate}T21:00:00Z`,
  netSales,
  orderCount: 1,
  cardAmount: 0,
  openingCash: 0,
  revision: 1,
});

const entered = (branchCode: string, businessDate: string, netSales: number | null): ComparisonFigure => ({
  id: `${branchCode}-${businessDate}`,
  branchCode,
  businessDate,
  netSales,
  orderCount: null,
  source: "reporting_only",
});

const CUR = "2026-11-10";
const PRI = "2026-11-03";

describe("weekly comparison (CMP-05..CMP-08)", () => {
  it("contract example: 120 vs 100 MAD is 120 %", () => {
    const days = [closed("maarif", CUR, 12000), closed("maarif", PRI, 10000)];
    const result = compareWeekly(["maarif"], CUR, PRI, days, []);
    expect(result.rows[0]!.ratio).toBe(CONTRACT_EXAMPLES.weeklyRatio.ratioBp);
    expect(result.total.ratio).toBe(12000);
    expect(result.total.incomplete).toBe(false);
  });

  it("uses one shared date pair for every branch", () => {
    const days = [closed("maarif", CUR, 100), closed("maarif", PRI, 100)];
    const only = [entered("alquds", CUR, 200), entered("alquds", PRI, 100)];
    const result = compareWeekly(["maarif", "alquds"], CUR, PRI, days, only);
    expect(result.rows.every((r) => r.current.businessDate === CUR && r.prior.businessDate === PRI)).toBe(true);
  });

  it("marks a missing branch explicitly (never 0) and reports coverage", () => {
    const days = [closed("maarif", CUR, 12000), closed("maarif", PRI, 10000)];
    const only = [entered("alquds", PRI, 8000)];
    const result = compareWeekly(["maarif", "alquds", "bourgogne"], CUR, PRI, days, only);
    const alquds = result.rows.find((r) => r.branchCode === "alquds")!;
    expect(alquds.current.source).toBe("missing");
    expect(alquds.current.sales).toBeNull();
    expect(alquds.ratio).toBeNull();
    expect(result.total.current).toBe(12000);
    expect(result.total.currentCoverage).toEqual({ present: 1, total: 3 });
    expect(result.total.priorCoverage).toEqual({ present: 2, total: 3 });
    expect(result.total.incomplete).toBe(true);
    // Different branches on each date: no misleading total ratio.
    expect(result.total.ratio).toBeNull();
    expect(result.total.ratioReason).toBe("different_branches");
  });

  it("a total over the same incomplete set is flagged incomplete but still has a ratio", () => {
    const days = [closed("maarif", CUR, 12000), closed("maarif", PRI, 10000)];
    const result = compareWeekly(["maarif", "alquds"], CUR, PRI, days, []);
    expect(result.total.incomplete).toBe(true);
    expect(result.total.ratio).toBe(12000);
  });

  it("leaves the ratio blank when the prior figure is missing or zero", () => {
    const missing = compareWeekly(["maarif"], CUR, PRI, [closed("maarif", CUR, 100)], []);
    expect(missing.rows[0]!.ratio).toBeNull();
    const zero = compareWeekly(["maarif"], CUR, PRI, [closed("maarif", CUR, 100), closed("maarif", PRI, 0)], []);
    expect(zero.rows[0]!.ratio).toBeNull();
    expect(zero.total.ratioReason).toBe("prior_missing_or_zero");
  });

  it("a recorded zero current figure is 0 %, not blank", () => {
    const result = compareWeekly(["maarif"], CUR, PRI, [closed("maarif", CUR, 0), closed("maarif", PRI, 100)], []);
    expect(result.rows[0]!.current.sales).toBe(0);
    expect(result.rows[0]!.ratio).toBe(0);
  });

  it("prefers a closed day over a reporting-only figure and ignores open days", () => {
    const open: BusinessDay = { ...closed("maarif", CUR, 0), status: "open", netSales: null };
    const figure = figureFor("maarif", CUR, [open], [entered("maarif", CUR, 5000)]);
    expect(figure.source).toBe("reporting_only");
    const both = figureFor("maarif", CUR, [closed("maarif", CUR, 7000)], [entered("maarif", CUR, 5000)]);
    expect(both.source).toBe("closed_day");
    expect(both.sales).toBe(7000);
  });

  it("monthly growth is current / prior - 1", () => {
    expect(monthlyGrowth(11300, 10000)).toBe(1300);
    expect(monthlyGrowth(0, 10000)).toBe(-10000);
    expect(monthlyGrowth(100, null)).toBeNull();
  });
});
