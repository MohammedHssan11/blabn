import { describe, expect, it } from "vitest";
import {
  BRANCH_ORDER,
  branchDay,
  figureKey,
  monthlyComparison,
  monthlyDates,
  monthlyGrowth,
  orderBranches,
  priorMonth,
  priorWeekDate,
  sameWeekday,
  weeklyComparison,
  type BranchInfo,
  type ComparisonData,
  type Figure,
} from "@/modules/comparisons/calc";
import { CONTRACT_EXAMPLES } from "@/modules/reports/contracts";
import { formatRatio } from "@/i18n/format";

/*
 * Phase 7 calculations (CMP-01..CMP-08) on synthetic figures. Amounts are centimes: 12000 = 120.00 MAD.
 */

const CUR = "2026-11-17";
const PRI = "2026-11-10";

const branch = (code: string, extra: Partial<BranchInfo> = {}): BranchInfo => ({
  code, nameEn: code, nameAr: code, operatesInApp: code === "maarif", liveFrom: null, liveFromBasis: null, today: null,
  liveSource: null, liveSourceEn: null, liveSourceAr: null, entryOwner: null, ...extra,
});

const fig = (value: number, extra: Partial<Figure> = {}): Figure => ({
  value, origin: "entry", source: "reporting_only", sourceLabelEn: null, sourceLabelAr: null, purpose: "live",
  record: "comparison_entries:1", revision: 1, reference: "", actor: "", recordedAt: null, ...extra,
});

type Rows = Array<[branch: string, date: string, sales: number | null, orders?: number | null, extra?: Partial<Figure>]>;
function data(branches: BranchInfo[], rows: Rows): ComparisonData {
  const figures = new Map<string, Figure>();
  for (const [code, date, sales, orders = null, extra = {}] of rows) {
    if (sales !== null) figures.set(figureKey(code, date, "net_sales"), fig(sales, extra));
    if (orders !== null) figures.set(figureKey(code, date, "order_count"), fig(orders, extra));
  }
  return { branches, figures };
}

const three = () => BRANCH_ORDER.map((c) => branch(c));

describe("branch order and inputs", () => {
  it("follows SRC-12: Al Quds, Maarif, Bourgogne (the total comes after them)", () => {
    expect(BRANCH_ORDER).toEqual(["alquds", "maarif", "bourgogne"]);
    expect(orderBranches(["bourgogne", "maarif", "alquds", "maarif", "nowhere"])).toEqual(["alquds", "maarif", "bourgogne"]);
    const result = weeklyComparison(data(three(), []), CUR, PRI);
    expect(result.rows.map((r) => r.branch.code)).toEqual(["alquds", "maarif", "bourgogne"]);
  });

  it("the prior date is the same weekday one week earlier", () => {
    expect(priorWeekDate("2026-11-10")).toBe("2026-11-03");
    expect(sameWeekday("2026-11-10", "2026-11-03")).toBe(true);
    expect(sameWeekday("2026-11-10", "2026-11-04")).toBe(false);
    expect(priorWeekDate("2026-03-03")).toBe("2026-02-24");
  });

  it("a monthly comparison reads both months, and January follows December", () => {
    expect(priorMonth("2026-11")).toBe("2026-10");
    expect(priorMonth("2027-01")).toBe("2026-12");
    expect(monthlyDates("2026-11")).toHaveLength(31 + 30);
    expect(monthlyDates("2026-03")[0]).toBe("2026-02-01");
  });
});

describe("weekly mode (CMP-05..CMP-08)", () => {
  it("120 vs 100 gives a difference of 20 and a ratio of 120 %", () => {
    const result = weeklyComparison(data([branch("maarif")], [["maarif", CUR, 12000, 3], ["maarif", PRI, 10000, 2]]), CUR, PRI);
    const row = result.rows[0]!;
    expect(row.salesDiff).toBe(2000);
    expect(row.ordersDiff).toBe(1);
    expect(row.ratio).toBe(12000);
    expect(row.ratio).toBe(CONTRACT_EXAMPLES.weeklyRatio.ratioBp);
    expect(formatRatio(row.ratio, "en")).toBe("120%");
    expect(row.ratioReason).toBe("ok");
    expect(result.total.ratio).toBe(12000);
    expect(result.total.salesDiff).toBe(2000);
    expect(result.total.incomplete).toBe(false);
  });

  it("uses one shared date pair for every branch", () => {
    const result = weeklyComparison(data(three(), [["alquds", CUR, 200], ["maarif", PRI, 100]]), CUR, PRI);
    expect(result.rows.every((r) => r.current.businessDate === CUR && r.prior.businessDate === PRI)).toBe(true);
  });

  it("a zero or missing prior leaves the ratio unavailable with its reason (never NaN, ∞ or 0 %)", () => {
    const zero = weeklyComparison(data([branch("maarif")], [["maarif", CUR, 12000], ["maarif", PRI, 0]]), CUR, PRI).rows[0]!;
    expect(zero.ratio).toBeNull();
    expect(zero.ratioReason).toBe("prior_zero");
    expect(zero.salesDiff).toBe(12000);
    const missing = weeklyComparison(data([branch("maarif")], [["maarif", CUR, 12000]]), CUR, PRI).rows[0]!;
    expect(missing.ratio).toBeNull();
    expect(missing.ratioReason).toBe("prior_unavailable");
    expect(missing.salesDiff).toBeNull();
    expect(missing.prior.status).toBe("missing");
    expect(missing.prior.sales).toBeNull();
    const noCurrent = weeklyComparison(data([branch("maarif")], [["maarif", PRI, 100]]), CUR, PRI).rows[0]!;
    expect(noCurrent.ratioReason).toBe("current_unavailable");
    for (const r of [zero, missing, noCurrent]) expect(formatRatio(r.ratio, "en")).toBe("—");
  });

  it("a recorded zero current figure is a real 0 %, not blank", () => {
    const row = weeklyComparison(data([branch("maarif")], [["maarif", CUR, 0], ["maarif", PRI, 100]]), CUR, PRI).rows[0]!;
    expect(row.current.sales).toBe(0);
    expect(row.current.status).toBe("available");
    expect(row.ratio).toBe(0);
  });

  it("a total over a partial selection is marked incomplete, shows its coverage and names the missing branches", () => {
    const result = weeklyComparison(data(three(), [["maarif", CUR, 12000, 3], ["maarif", PRI, 10000, 2], ["alquds", PRI, 8000, 1]]), CUR, PRI);
    const alquds = result.rows.find((r) => r.branch.code === "alquds")!;
    expect(alquds.current.status).toBe("missing");
    expect(alquds.current.sales).toBeNull();
    expect(result.total.currentSales).toBe(12000);
    expect(result.total.priorSales).toBe(18000);
    expect(result.total.currentCoverage).toEqual({ present: 1, total: 3 });
    expect(result.total.priorCoverage).toEqual({ present: 2, total: 3 });
    expect(result.total.missingCurrent).toEqual(["alquds", "bourgogne"]);
    expect(result.total.missingPrior).toEqual(["bourgogne"]);
    expect(result.total.incomplete).toBe(true);
    // Different branches on each date: no misleading total ratio or difference.
    expect(result.total.ratio).toBeNull();
    expect(result.total.salesDiff).toBeNull();
    expect(result.total.ratioReason).toBe("different_branches");
  });

  it("a total over the same incomplete set is flagged incomplete but still compares like with like", () => {
    const result = weeklyComparison(data(three(), [["maarif", CUR, 12000], ["maarif", PRI, 10000]]), CUR, PRI);
    expect(result.total.incomplete).toBe(true);
    expect(result.total.ratio).toBe(12000);
  });

  it("totals only the selected branches", () => {
    const rows: Rows = [["alquds", CUR, 5000], ["alquds", PRI, 4000], ["maarif", CUR, 12000], ["maarif", PRI, 10000], ["bourgogne", CUR, 9999], ["bourgogne", PRI, 1]];
    const result = weeklyComparison(data([branch("alquds"), branch("maarif")], rows), CUR, PRI);
    expect(result.total.currentSales).toBe(17000);
    expect(result.total.priorSales).toBe(14000);
    expect(result.total.ratio).toBe(roundBp(17000, 14000));
    expect(result.total.incomplete).toBe(false);
  });

  it("no figure at all leaves the totals blank, not 0", () => {
    const result = weeklyComparison(data(three(), []), CUR, PRI);
    expect(result.total.currentSales).toBeNull();
    expect(result.total.ratioReason).toBe("no_figures");
  });
});

function roundBp(a: number, b: number) {
  return Math.round((a * 10000) / b);
}

describe("availability of a branch on a date", () => {
  it("before the first live business date a value is unavailable, unless it is a historical figure", () => {
    const b = branch("alquds", { liveFrom: "2026-11-05" });
    const plain = data([b], []);
    expect(branchDay(plain, b, "2026-11-03").status).toBe("before_live");
    expect(branchDay(plain, b, "2026-11-05").status).toBe("missing");
    const historical = data([b], [["alquds", "2026-11-03", 7000, null, { purpose: "historical", reference: "sheet row 6" }]]);
    const day = branchDay(historical, b, "2026-11-03");
    expect(day.status).toBe("available");
    expect(day.historical).toBe(true);
    expect(day.salesFigure?.reference).toBe("sheet row 6");
  });

  it("a date after the branch's current business date has not started", () => {
    const b = branch("maarif", { today: "2026-11-23" });
    expect(branchDay(data([b], []), b, "2026-11-24").status).toBe("future");
    expect(branchDay(data([b], []), b, "2026-11-23").status).toBe("missing");
  });

  it("an order count without sales is shown but does not make the day count", () => {
    const b = branch("alquds");
    const day = branchDay(data([b], [["alquds", CUR, null, 5]]), b, CUR);
    expect(day.status).toBe("missing");
    expect(day.orders).toBe(5);
    expect(day.sales).toBeNull();
  });
});

describe("monthly mode (CMP-01..CMP-04), separate from weekly", () => {
  it("120 vs 100 on the same day number gives growth of 20 %", () => {
    const result = monthlyComparison(data([branch("maarif")], [["maarif", "2026-11-03", 12000], ["maarif", "2026-10-03", 10000]]), "2026-11");
    const day3 = result.rows[2]!;
    expect(day3.day).toBe(3);
    expect(day3.current.date).toBe("2026-11-03");
    expect(day3.prior.date).toBe("2026-10-03");
    expect(day3.growth).toBe(2000);
    expect(formatRatio(day3.growth, "en")).toBe("20%");
    expect(monthlyGrowth(12000, 10000)).toBe(2000);
  });

  it("a recorded 0 gives −100 %; a blank stays blank; a zero prior is unavailable", () => {
    expect(monthlyGrowth(0, 10000)).toBe(-10000);
    expect(monthlyGrowth(null, 10000)).toBeNull();
    expect(monthlyGrowth(100, null)).toBeNull();
    expect(monthlyGrowth(100, 0)).toBeNull();
    const result = monthlyComparison(data([branch("maarif")], [
      ["maarif", "2026-11-01", 0], ["maarif", "2026-10-01", 5000],
      ["maarif", "2026-10-02", 5000],
      ["maarif", "2026-11-04", 300], ["maarif", "2026-10-04", 0],
    ]), "2026-11");
    expect(result.rows[0]!.growth).toBe(-10000);
    expect(result.rows[1]!.growth).toBeNull();
    expect(result.rows[1]!.growthReason).toBe("current_unavailable");
    expect(result.rows[3]!.growth).toBeNull();
    expect(result.rows[3]!.growthReason).toBe("prior_zero");
  });

  it("period growth is like for like: only days entered in both months", () => {
    const rows: Rows = [
      ["maarif", "2026-11-01", 1000], ["maarif", "2026-10-01", 800],
      ["maarif", "2026-11-02", 1000], ["maarif", "2026-10-02", 1200],
      ["maarif", "2026-11-03", 5000], // no 3 October: not comparable
      ["maarif", "2026-10-31", 9000], // no 31 November: not comparable
    ];
    const result = monthlyComparison(data([branch("maarif", { today: "2026-11-30" })], rows), "2026-11");
    expect(result.period.comparableDays).toBe(2);
    expect(result.period.currentSales).toBe(2000);
    expect(result.period.priorSales).toBe(2000);
    expect(result.period.growth).toBe(0);
    expect(result.rows[30]!.current.status).toBe("no_such_day");
    expect(result.rows[30]!.growthReason).toBe("no_such_day");
    expect(result.branches[0]!.currentCoverage).toEqual({ present: 3, total: 30 });
    expect(result.branches[0]!.priorCoverage).toEqual({ present: 3, total: 31 });
  });

  it("with no comparable day the period growth is unavailable, not 0 %", () => {
    const result = monthlyComparison(data([branch("maarif")], [["maarif", "2026-11-01", 1000]]), "2026-11");
    expect(result.period.comparableDays).toBe(0);
    expect(result.period.growth).toBeNull();
    expect(result.period.growthReason).toBe("no_comparable_day");
  });

  it("a day with a selected branch missing is partial, not comparable, and listed", () => {
    const rows: Rows = [
      ["maarif", "2026-11-01", 1000], ["alquds", "2026-11-01", 500],
      ["maarif", "2026-10-01", 900], // Al Quds missing on 1 October
      ["maarif", "2026-11-02", 1000], ["alquds", "2026-11-02", 500], ["maarif", "2026-10-02", 800], ["alquds", "2026-10-02", 400],
    ];
    const result = monthlyComparison(data([branch("alquds"), branch("maarif")], rows), "2026-11");
    const day1 = result.rows[0]!;
    expect(day1.prior.status).toBe("partial");
    expect(day1.prior.present).toBe(1);
    expect(day1.comparable).toBe(false);
    expect(day1.growth).toBeNull();
    expect(day1.growthReason).toBe("incomplete");
    expect(result.period.comparableDays).toBe(1);
    expect(result.period.growth).toBe(roundBp(1500, 1200) - 10000);
    expect(result.missingDays.find((d) => d.date === "2026-10-01")?.branches).toEqual(["alquds"]);
    // Per branch, Maarif's own like-for-like period includes both days.
    expect(result.branches.find((b) => b.branch.code === "maarif")!.comparableDays).toBe(2);
  });

  it("the current month in progress shows how many days have started; later days are not missing", () => {
    const result = monthlyComparison(data([branch("maarif", { today: "2026-11-23" })], []), "2026-11");
    expect(result.inProgress).toBe(true);
    expect(result.elapsedDays).toBe(23);
    expect(result.monthDays).toBe(30);
    expect(result.rows[25]!.current.status).toBe("future");
    expect(result.missingDays.some((d) => d.date === "2026-11-26")).toBe(false);
    expect(result.missingDays.some((d) => d.date === "2026-11-23")).toBe(true);
  });

  it("days before the first live date are listed separately from missing days", () => {
    const result = monthlyComparison(data([branch("alquds", { liveFrom: "2026-11-05", today: "2026-11-30" })], []), "2026-11");
    expect(result.beforeLiveDays.map((d) => d.date)).toContain("2026-10-15");
    expect(result.beforeLiveDays.map((d) => d.date)).toContain("2026-11-04");
    expect(result.missingDays.map((d) => d.date)).toContain("2026-11-05");
    expect(result.rows[0]!.current.status).toBe("before_live");
    expect(result.rows[0]!.growthReason).toBe("before_live");
    expect(result.rows[0]!.growth).toBeNull();
  });
});
