import { describe, expect, it } from "vitest";
import { getCashCountView, getDailyCloseView } from "@/modules/closing/service";
import { getComparison, parseComparisonQuery, type WeeklyView } from "@/modules/comparisons/service";

// The Phase 2 demonstration mode reads the synthetic fixtures (the live mode reads the database).
process.env.BALABAN_DEMO_FIXTURES = "1";
const getComparisonView = async (current?: string) =>
  (await getComparison(parseComparisonQuery(current === undefined ? {} : { current }, "2026-11-23"))).view as WeeklyView;
import { loadFixtures } from "@/lib/fixtures";
import { collectTraces } from "@/modules/reports/trace";
import { PROTOTYPE_FIELDS, PENDING_IN_PROTOTYPES, CONTRACT_EXAMPLES } from "@/modules/reports/contracts";
import { getField } from "@/modules/reports/field-map";
import { reconcileCount } from "@/modules/closing/calc";

describe("synthetic cash count example", () => {
  it("shows expected 600, counted 603 and +3 MAD, and keeps +3 after the later deposit", async () => {
    const view = await getCashCountView("2026-11-02");
    const saved = view.saved!;
    expect(saved.countedAmount.value).toBe(CONTRACT_EXAMPLES.cashCount.counted);
    expect(saved.expected.value).toBe(CONTRACT_EXAMPLES.cashCount.expected);
    expect(saved.variance.value).toBe(CONTRACT_EXAMPLES.cashCount.variance);
    expect(saved.status).toBe("over");
    expect(saved.recalculationMatches).toBe(true);

    // The 500 MAD bank deposit is recorded after the count (22:30 vs 22:00 local).
    expect(saved.later).toHaveLength(1);
    expect(saved.later[0]!.amount.value).toBe(50000);
    expect(saved.drawerAfterLater.value).toBe(10300);
    expect(saved.variance.value).toBe(300);
    expect(view.expectedAtClose.value).toBe(10000);
  });

  it("every saved fixture count equals a recalculation at its count time", () => {
    const data = loadFixtures();
    for (const count of data.cashCounts) {
      const day = data.businessDays.find((d) => d.businessDate === count.businessDate && d.branchCode === count.branchCode)!;
      const movements = data.cashMovements.filter((m) => m.businessDate === count.businessDate);
      const snap = reconcileCount(day, movements, count.countedAmount, count.countedAt);
      expect(snap.expectedCash).toBe(count.expectedCash);
      expect(snap.variance).toBe(count.variance);
    }
  });

  it("a day without a saved count is not counted and shows no match", async () => {
    const view = await getCashCountView("2026-11-03");
    expect(view.saved).toBeNull();
  });

  it("previews a typed amount: blank -> not counted; 0 -> counted zero; invalid -> validation error", async () => {
    const blank = await getCashCountView("2026-11-02", "");
    expect(blank.preview.snapshot?.status).toBe("not_counted");
    const zero = await getCashCountView("2026-11-02", "0");
    expect(zero.preview.snapshot?.status).toBe("short");
    expect(zero.preview.snapshot?.variance).toBe(-60000);
    const exact = await getCashCountView("2026-11-02", "600");
    expect(exact.preview.snapshot?.status).toBe("match");
    const bad = await getCashCountView("2026-11-02", "abc");
    expect(bad.preview.error).toBe("invalid_amount");
    expect(bad.preview.snapshot).toBeNull();
    const neg = await getCashCountView("2026-11-02", "-5");
    expect(neg.preview.error).toBe("negative_amount");
    const none = await getCashCountView("2026-11-02");
    expect(none.preview.snapshot).toBeNull();
  });

  it("rejects an oversized preview amount with the validation error and never calculates it", async () => {
    const max = await getCashCountView("2026-11-02", "999999999999.99");
    expect(max.preview.error).toBeNull();
    expect(max.preview.snapshot?.status).toBe("over");
    expect(max.preview.snapshot?.variance).toBe(99_999_999_999_999 - 60000);
    for (const typed of ["1000000000000.00", "1000000000000.01", "9".repeat(400), "٩".repeat(400), "-1000000000000"]) {
      const view = await getCashCountView("2026-11-02", typed);
      expect(view.preview.error, typed.slice(0, 20)).toBe("invalid_amount");
      expect(view.preview.snapshot).toBeNull();
    }
  });

  it("treats the counter and cashier fields as settled by Abdo's agreed P1-19 rule, so nothing is shown as pending", async () => {
    const view = await getCashCountView("2026-11-02");
    expect(view.pendingFields).toEqual([]);
    for (const id of ["ST-09", "LG-08"]) expect(getField(id)!.status).toBe("agreed (Abdo)");
  });
});

describe("synthetic daily close", () => {
  it("shows an average of 100.00 MAD for 1,000 MAD over 10 orders and a blank average for missing/zero orders", async () => {
    const view = await getDailyCloseView("2026-11");
    const row = (date: string) => view.rows.find((r) => r.businessDate.value === date)!;
    expect(row("2026-11-02").average.value).toBe(10000);
    expect(row("2026-11-04").average.value).toBe(33333);
    expect(row("2026-11-05").average.value).toBe(0);
    expect(row("2026-11-06").orders.value).toBeNull();
    expect(row("2026-11-06").average.value).toBeNull();
    expect(row("2026-11-07").orders.value).toBe(0);
    expect(row("2026-11-07").average.value).toBeNull();
  });

  it("shows blank figures for open and missing days, and 30 rows for November", async () => {
    const view = await getDailyCloseView("2026-11");
    expect(view.rows).toHaveLength(30);
    for (const date of ["2026-11-08", "2026-11-09"]) {
      const r = view.rows.find((x) => x.businessDate.value === date)!;
      expect(r.closed).toBe(false);
      expect(r.sales.value).toBeNull();
      expect(r.expensesInclRemittance.value).toBeNull();
    }
  });

  it("falls back to the default month for an invalid month parameter", async () => {
    const view = await getDailyCloseView("not-a-month", "garbage");
    expect(view.month).toBe("2026-11");
  });

  it("month totals use total sales / total orders", async () => {
    const view = await getDailyCloseView("2026-11");
    const t = view.totals;
    expect(t.closedDays).toBe(9);
    expect(t.sales).toBe(526050);
    expect(t.orders).toBe(32);
    expect(t.average).toBe(Math.round(526050 / 32));
    expect(t.closedDaysWithoutOrders).toBe(1);
  });
});

describe("synthetic branch comparison", () => {
  it("shows 120 % for 120 vs 100 (Maarif), the branches in SRC-12 order, and marks Bourgogne missing", async () => {
    const view = await getComparisonView();
    expect(view.currentDate.value).toBe("2026-11-10");
    expect(view.priorDate.value).toBe("2026-11-03");
    expect(view.rows.map((r) => r.branch.code)).toEqual(["alquds", "maarif", "bourgogne"]);
    const maarif = view.rows.find((r) => r.branch.code === "maarif")!;
    expect(maarif.current.sales.value).toBe(12000);
    expect(maarif.prior.sales.value).toBe(10000);
    expect(maarif.salesDiff.value).toBe(2000);
    expect(maarif.ratio.value).toBe(12000);
    const bourgogne = view.rows.find((r) => r.branch.code === "bourgogne")!;
    expect(bourgogne.current.status).toBe("missing");
    expect(bourgogne.current.sales.value).toBeNull();
    expect(view.total.incomplete).toBe(true);
    expect(view.total.currentCoverage).toEqual({ present: 2, total: 3 });
    expect(view.total.priorCoverage).toEqual({ present: 3, total: 3 });
  });

  it("falls back to the default date for an invalid date", async () => {
    const query = parseComparisonQuery({ current: "nonsense" }, "2026-11-23");
    expect(query.invalid).toBe(true);
    expect(query.currentDate).toBe("2026-11-10");
    const view = await getComparisonView("nonsense");
    expect(view.currentDate.value).toBe("2026-11-10");
  });

  it("parses the mode, the prior date, the month and the branch selection", () => {
    const q = parseComparisonQuery({ mode: "monthly", month: "2026-11", branches: "bourgogne,alquds" }, "2026-11-23");
    expect(q.mode).toBe("monthly");
    expect(q.month).toBe("2026-11");
    expect(q.branches).toEqual(["alquds", "bourgogne"]);
    expect(q.invalid).toBe(false);
    expect(parseComparisonQuery({ branches: ["maarif", "nowhere"] }, "2026-11-23").invalid).toBe(true);
    expect(parseComparisonQuery({ current: "2026-11-10", prior: "2026-11-04" }, "2026-11-23").invalid).toBe(true);
    expect(parseComparisonQuery({ current: "2026-11-10", prior: "2026-10-27" }, "2026-11-23").priorDate).toBe("2026-10-27");
    expect(parseComparisonQuery({ mode: "yearly" }, "2026-11-23").invalid).toBe(true);
  });
});

describe("traceability", () => {
  it("every traced value names a field that exists in the Phase 1 field map and in its prototype contract", async () => {
    const closeView = await getDailyCloseView("2026-11", "2026-11-02");
    const cashView = await getCashCountView("2026-11-02");
    const cmpView = await getComparisonView();
    const allowed = {
      dailyClose: new Set(PROTOTYPE_FIELDS.dailyClose),
      cashCount: new Set(PROTOTYPE_FIELDS.cashCount),
      comparison: new Set(PROTOTYPE_FIELDS.comparison),
    };
    const check = (view: unknown, set: Set<string>) => {
      const traces = collectTraces(view);
      expect(traces.length).toBeGreaterThan(8);
      for (const trace of traces) {
        if (trace.field === undefined) continue;
        expect(getField(trace.field), `unknown field ${trace.field}`).toBeDefined();
        expect(set.has(trace.field), `${trace.field} is not in the contract`).toBe(true);
      }
    };
    check(closeView, allowed.dailyClose);
    check(cashView, allowed.cashCount);
    check(cmpView, allowed.comparison);
  });

  it("a traced value without a field points to a saved record", async () => {
    const view = await getDailyCloseView("2026-11", "2026-11-02");
    for (const trace of collectTraces(view)) {
      expect(trace.field !== undefined || trace.record !== undefined).toBe(true);
    }
  });

  it("every contract field exists in the field map; pending ones are only named, never filled", () => {
    for (const fields of Object.values(PROTOTYPE_FIELDS)) {
      for (const id of fields) expect(getField(id), id).toBeDefined();
    }
    for (const fields of Object.values(PENDING_IN_PROTOTYPES)) {
      for (const id of fields) expect(getField(id)!.status).toBe("pending");
    }
  });
});
