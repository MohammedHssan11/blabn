import {
  averageMinor,
  ratioBp,
  sumMinor,
  type Blank,
  type Minor,
  type RatioBp,
} from "@/lib/money";
import type { BusinessDate } from "@/lib/dates";
import type { BusinessDay, CashCount, CashMovement } from "./types";

/*
 * Server-side financial calculations for the daily close (DS-*, ST-*, LG-05/06).
 * Pure functions: no I/O, no clock, no locale. They are called only from server
 * code (see service.ts) and never imported by client components.
 */

export const CASH_COUNT_CALC_VERSION = "cash-count-v1";

// ---------------------------------------------------------------- daily row

export interface DailyFigures {
  businessDate: BusinessDate;
  closed: boolean;
  sales: Blank<Minor>; // DS-02
  orders: Blank<number>; // DS-03
  average: Blank<Minor>; // DS-04
  /** Operating cash expenses only (ST-03). */
  expenses: Blank<Minor>;
  /** DS-05: expenses + bank remittance, as the legacy column holds. */
  expensesInclRemittance: Blank<Minor>;
  remittance: Blank<Minor>; // DS-06
  remittanceRatio: Blank<RatioBp>; // DS-07
  card: Blank<Minor>; // DS-08
  cardRatio: Blank<RatioBp>; // DS-09
}

const BLANK_DAY = (businessDate: BusinessDate): DailyFigures => ({
  businessDate,
  closed: false,
  sales: null,
  orders: null,
  average: null,
  expenses: null,
  expensesInclRemittance: null,
  remittance: null,
  remittanceRatio: null,
  card: null,
  cardRatio: null,
});

/**
 * Figures for one business date. A day without a close shows blank figures,
 * never zeros. A closed day with no expense lines has expenses of 0 (ST-03) but
 * a blank remittance (DS-06) because "no remittance recorded" is not "0".
 */
export function computeDailyFigures(
  businessDate: BusinessDate,
  day: BusinessDay | undefined,
  movements: readonly CashMovement[],
): DailyFigures {
  if (!day || day.status !== "closed") return BLANK_DAY(businessDate);

  const expenseLines = movements.filter((m) => m.kind === "expense");
  const remittanceLines = movements.filter((m) => m.kind === "bank_remittance");
  const expenses = sumMinor(expenseLines.map((m) => m.amount));
  const remittance = remittanceLines.length > 0 ? sumMinor(remittanceLines.map((m) => m.amount)) : null;

  return {
    businessDate,
    closed: true,
    sales: day.netSales,
    orders: day.orderCount,
    average: averageMinor(day.netSales, day.orderCount),
    expenses,
    expensesInclRemittance: expenses + (remittance ?? 0),
    remittance,
    remittanceRatio: ratioBp(remittance, day.netSales),
    card: day.cardAmount,
    cardRatio: ratioBp(day.cardAmount, day.netSales),
  };
}

// ------------------------------------------------------------ period totals

export interface PeriodTotals {
  /** Number of closed days included. */
  closedDays: number;
  /** Closed days whose order count is blank, so the average may be understated. */
  closedDaysWithoutOrders: number;
  sales: Blank<Minor>;
  orders: Blank<number>;
  /** Total sales / total orders (not the mean of daily averages). */
  average: Blank<Minor>;
  expensesInclRemittance: Blank<Minor>;
  remittance: Blank<Minor>;
  remittanceRatio: Blank<RatioBp>;
  card: Blank<Minor>;
  cardRatio: Blank<RatioBp>;
}

function totalOrBlank(values: ReadonlyArray<Blank<number>>): Blank<number> {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/** DS-10: sums of the closed days; ratios computed on the totals; blank when no day is closed. */
export function computePeriodTotals(rows: readonly DailyFigures[]): PeriodTotals {
  const closed = rows.filter((r) => r.closed);
  const sales = totalOrBlank(closed.map((r) => r.sales));
  const orders = totalOrBlank(closed.map((r) => r.orders));
  const remittance = totalOrBlank(closed.map((r) => r.remittance));
  const card = totalOrBlank(closed.map((r) => r.card));
  return {
    closedDays: closed.length,
    closedDaysWithoutOrders: closed.filter((r) => r.orders === null).length,
    sales,
    orders,
    average: averageMinor(sales, orders),
    expensesInclRemittance: totalOrBlank(closed.map((r) => r.expensesInclRemittance)),
    remittance,
    remittanceRatio: ratioBp(remittance, sales),
    card,
    cardRatio: ratioBp(card, sales),
  };
}

// --------------------------------------------------------------- cash count

/**
 * Cash expected in the drawer at a moment: opening cash + cash sales (net sales
 * minus card) minus every cash movement up to and including `at`. Movements
 * after the count (for example the evening bank deposit) are NOT included, so
 * the count variance never changes when a later deposit is posted (P1-13).
 *
 * Blank (null) when opening cash, net sales or card are blank: the expected
 * figure cannot be known, and a blank is never treated as 0.
 */
export function expectedCashAt(
  day: Pick<BusinessDay, "openingCash" | "netSales" | "cardAmount">,
  movements: readonly CashMovement[],
  at: string,
): Blank<Minor> {
  if (day.openingCash === null || day.netSales === null || day.cardAmount === null) return null;
  const instant = new Date(at).getTime();
  const out = movements
    .filter((m) => new Date(m.occurredAt).getTime() <= instant)
    .reduce((total, m) => total + m.amount, 0);
  return day.openingCash + (day.netSales - day.cardAmount) - out;
}

export type ReconciliationStatus = "not_counted" | "cannot_reconcile" | "match" | "over" | "short";

export interface CashCountSnapshot {
  countedAmount: Blank<Minor>;
  countedAt: Blank<string>;
  expectedCash: Blank<Minor>;
  /** ST-08: counted minus expected. Blank unless both are known. */
  variance: Blank<Minor>;
  status: ReconciliationStatus;
}

/**
 * The reconciliation recorded at count time. A blank count means "not counted"
 * and is never reported as a match; an explicit count of 0 is a count.
 */
export function reconcileCount(
  day: Pick<BusinessDay, "openingCash" | "netSales" | "cardAmount">,
  movements: readonly CashMovement[],
  countedAmount: Blank<Minor>,
  countedAt: Blank<string>,
): CashCountSnapshot {
  if (countedAmount === null || countedAt === null) {
    return { countedAmount: null, countedAt: null, expectedCash: null, variance: null, status: "not_counted" };
  }
  const expectedCash = expectedCashAt(day, movements, countedAt);
  if (expectedCash === null) {
    return { countedAmount, countedAt, expectedCash: null, variance: null, status: "cannot_reconcile" };
  }
  const variance = countedAmount - expectedCash;
  const status: ReconciliationStatus = variance === 0 ? "match" : variance > 0 ? "over" : "short";
  return { countedAmount, countedAt, expectedCash, variance, status };
}

export function snapshotOfSavedCount(count: CashCount): CashCountSnapshot {
  const variance = count.variance;
  return {
    countedAmount: count.countedAmount,
    countedAt: count.countedAt,
    expectedCash: count.expectedCash,
    variance,
    status:
      variance === null ? "cannot_reconcile" : variance === 0 ? "match" : variance > 0 ? "over" : "short",
  };
}

/** Movements after the count: they change the drawer, never the stored variance. */
export function movementsAfter(movements: readonly CashMovement[], at: string): CashMovement[] {
  const instant = new Date(at).getTime();
  return movements
    .filter((m) => new Date(m.occurredAt).getTime() > instant)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

/** Cash physically in the drawer after later movements: the counted cash minus them. */
export function drawerAfterLaterMovements(
  countedAmount: Minor,
  later: readonly CashMovement[],
): Minor {
  return countedAmount - sumMinor(later.map((m) => m.amount));
}

/** ST-06: counted cash + card + operating cash expenses through the count time. */
export function statementTotalAt(
  countedAmount: Blank<Minor>,
  card: Blank<Minor>,
  movements: readonly CashMovement[],
  at: Blank<string>,
): Blank<Minor> {
  if (countedAmount === null || card === null || at === null) return null;
  const instant = new Date(at).getTime();
  const expensesThroughCount = movements
    .filter((m) => m.kind === "expense" && new Date(m.occurredAt).getTime() <= instant)
    .reduce((total, m) => total + m.amount, 0);
  return countedAmount + card + expensesThroughCount;
}
