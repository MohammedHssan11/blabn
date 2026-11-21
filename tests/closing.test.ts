import { describe, expect, it } from "vitest";
import {
  computeDailyFigures,
  computePeriodTotals,
  drawerAfterLaterMovements,
  expectedCashAt,
  movementsAfter,
  reconcileCount,
  statementTotalAt,
} from "@/modules/closing/calc";
import type { BusinessDay, CashMovement } from "@/modules/closing/types";
import { CONTRACT_EXAMPLES } from "@/modules/reports/contracts";

const day = (over: Partial<BusinessDay> = {}): BusinessDay => ({
  id: "d",
  branchCode: "maarif",
  businessDate: "2026-11-02",
  status: "closed",
  closedAt: "2026-11-02T21:45:00Z",
  netSales: 100000,
  orderCount: 10,
  cardAmount: 30000,
  openingCash: 0,
  revision: 1,
  ...over,
});

const move = (kind: CashMovement["kind"], amount: number, occurredAt: string): CashMovement => ({
  id: `${kind}-${occurredAt}`,
  branchCode: "maarif",
  businessDate: "2026-11-02",
  kind,
  amount,
  occurredAt,
  note: "",
});

const expense = move("expense", 10000, "2026-11-02T13:30:00Z");
const COUNT_AT = "2026-11-02T21:00:00Z";
const deposit = move("bank_remittance", 50000, "2026-11-02T21:30:00Z");

describe("daily close figures (DS-02..DS-09)", () => {
  it("contract example: 1,000 MAD / 10 orders gives an average of 100.00 MAD", () => {
    const f = computeDailyFigures("2026-11-02", day(), [expense, deposit]);
    expect(f.average).toBe(CONTRACT_EXAMPLES.averageOrder.average);
    expect(f.cardRatio).toBe(3000);
    expect(f.remittance).toBe(50000);
    expect(f.remittanceRatio).toBe(5000);
    expect(f.expenses).toBe(10000);
    expect(f.expensesInclRemittance).toBe(60000);
  });

  it("leaves the average blank when orders are missing or zero", () => {
    expect(computeDailyFigures("d", day({ orderCount: null }), []).average).toBeNull();
    expect(computeDailyFigures("d", day({ orderCount: 0 }), []).average).toBeNull();
  });

  it("zero sales with orders is a real 0.00 average, not blank", () => {
    expect(computeDailyFigures("d", day({ netSales: 0, orderCount: 3, cardAmount: 0 }), []).average).toBe(0);
  });

  it("rounds the average to 2 decimals: 1,000 / 3 = 333.33", () => {
    expect(computeDailyFigures("d", day({ netSales: 100000, orderCount: 3 }), []).average).toBe(33333);
  });

  it("shows blank (not zero) for a day that is not closed or has no record", () => {
    for (const d of [day({ status: "open", netSales: null }), undefined]) {
      const f = computeDailyFigures("2026-11-08", d, []);
      expect(f.closed).toBe(false);
      expect(f.sales).toBeNull();
      expect(f.expensesInclRemittance).toBeNull();
      expect(f.remittance).toBeNull();
    }
  });

  it("keeps no remittance (blank) apart from a recorded one, and no expense lines as 0", () => {
    const f = computeDailyFigures("d", day(), []);
    expect(f.expenses).toBe(0);
    expect(f.remittance).toBeNull();
    expect(f.remittanceRatio).toBeNull();
    expect(f.expensesInclRemittance).toBe(0);
  });

  it("leaves the card ratio blank when sales are 0", () => {
    expect(computeDailyFigures("d", day({ netSales: 0, cardAmount: 0 }), []).cardRatio).toBeNull();
  });

  it("recorded zero card stays 0, not blank", () => {
    const f = computeDailyFigures("d", day({ cardAmount: 0 }), []);
    expect(f.card).toBe(0);
    expect(f.cardRatio).toBe(0);
  });
});

describe("period totals (DS-10)", () => {
  it("period average = total sales / total orders, ratios on totals", () => {
    const rows = [
      computeDailyFigures("a", day({ netSales: 100000, orderCount: 10, cardAmount: 30000 }), []),
      computeDailyFigures("b", day({ netSales: 20000, orderCount: 2, cardAmount: 0 }), []),
      computeDailyFigures("c", undefined, []),
    ];
    const totals = computePeriodTotals(rows);
    expect(totals.closedDays).toBe(2);
    expect(totals.sales).toBe(120000);
    expect(totals.orders).toBe(12);
    expect(totals.average).toBe(10000);
    expect(totals.cardRatio).toBe(2500);
  });

  it("is blank for a month with no closed day", () => {
    const totals = computePeriodTotals([computeDailyFigures("a", undefined, [])]);
    expect(totals.closedDays).toBe(0);
    expect(totals.sales).toBeNull();
    expect(totals.average).toBeNull();
    expect(totals.cardRatio).toBeNull();
  });

  it("reports closed days whose order count is missing", () => {
    const totals = computePeriodTotals([
      computeDailyFigures("a", day({ orderCount: null }), []),
      computeDailyFigures("b", day(), []),
    ]);
    expect(totals.closedDaysWithoutOrders).toBe(1);
  });
});

describe("cash count (ST-04, ST-06, ST-08, P1-13)", () => {
  it("contract example: count 603 vs expected 600 gives +3 MAD", () => {
    const snap = reconcileCount(day(), [expense], CONTRACT_EXAMPLES.cashCount.counted, COUNT_AT);
    expect(snap.expectedCash).toBe(CONTRACT_EXAMPLES.cashCount.expected);
    expect(snap.variance).toBe(CONTRACT_EXAMPLES.cashCount.variance);
    expect(snap.status).toBe("over");
  });

  it("the variance stays +3 MAD after a later deposit", () => {
    const movements = [expense, deposit];
    const atCount = reconcileCount(day(), movements, 60300, COUNT_AT);
    expect(atCount.variance).toBe(300);
    expect(atCount.expectedCash).toBe(60000);
    // The deposit is after the count: it does not enter the expected cash.
    expect(movementsAfter(movements, COUNT_AT)).toEqual([deposit]);
    expect(drawerAfterLaterMovements(60300, [deposit])).toBe(10300);
    // Expected cash after everything is a different, later figure and does not rewrite the count result.
    expect(expectedCashAt(day(), movements, "2026-11-03T00:00:00Z")).toBe(10000);
  });

  it("a deposit before the count does reduce the expected cash", () => {
    const early = move("bank_remittance", 20000, "2026-11-02T18:00:00Z");
    expect(expectedCashAt(day(), [expense, early], COUNT_AT)).toBe(40000);
  });

  it("a blank count is 'not counted', never a match", () => {
    const snap = reconcileCount(day(), [expense], null, null);
    expect(snap.status).toBe("not_counted");
    expect(snap.variance).toBeNull();
    expect(snap.expectedCash).toBeNull();
  });

  it("an explicit count of 0 is a count", () => {
    const snap = reconcileCount(day(), [expense], 0, COUNT_AT);
    expect(snap.status).toBe("short");
    expect(snap.variance).toBe(-60000);
  });

  it("a count equal to the expected cash is a match with a real 0 variance", () => {
    const snap = reconcileCount(day(), [expense], 60000, COUNT_AT);
    expect(snap.status).toBe("match");
    expect(snap.variance).toBe(0);
  });

  it("cannot reconcile when opening cash, sales or card is blank", () => {
    for (const over of [{ openingCash: null }, { netSales: null }, { cardAmount: null }]) {
      const snap = reconcileCount(day(over), [expense], 60300, COUNT_AT);
      expect(snap.status).toBe("cannot_reconcile");
      expect(snap.variance).toBeNull();
    }
  });

  it("statement total = counted + card + cash expenses through the count (ST-06)", () => {
    expect(statementTotalAt(60300, 30000, [expense, deposit], COUNT_AT)).toBe(100300);
    expect(statementTotalAt(null, 30000, [expense], COUNT_AT)).toBeNull();
  });
});
