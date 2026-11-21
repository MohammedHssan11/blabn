import type { BusinessDate } from "@/lib/dates";
import type { Blank, Minor } from "@/lib/money";

/** A branch trading day. Figures are blank (null) until entered; 0 is a recorded zero. */
export interface BusinessDay {
  id: string;
  branchCode: string;
  businessDate: BusinessDate;
  status: "open" | "closed";
  /** Actual instant the day was closed (event time, separate from the business date). */
  closedAt: Blank<string>;
  netSales: Blank<Minor>;
  orderCount: Blank<number>;
  cardAmount: Blank<Minor>;
  openingCash: Blank<Minor>;
  revision: number;
}

export type CashMovementKind = "expense" | "bank_remittance";

export interface CashMovement {
  id: string;
  branchCode: string;
  businessDate: BusinessDate;
  kind: CashMovementKind;
  amount: Minor;
  /** Actual instant of the movement. */
  occurredAt: string;
  note: string;
}

/** A saved cash count with the reconciliation result stored at count time. */
export interface CashCount {
  id: string;
  branchCode: string;
  businessDate: BusinessDate;
  countedAmount: Minor;
  countedAt: string;
  expectedCash: Blank<Minor>;
  variance: Blank<Minor>;
  calcVersion: string;
}

export interface ComparisonFigure {
  id: string;
  branchCode: string;
  businessDate: BusinessDate;
  netSales: Blank<Minor>;
  orderCount: Blank<number>;
  source: "reporting_only";
}
