import "server-only";
import type { BranchSettings } from "@/modules/access/branches";
import { getRepository } from "@/lib/repository";
import {
  businessDateOf,
  daysInMonth,
  isBusinessDate,
  isMonth,
  type BusinessDate,
} from "@/lib/dates";
import { parseMadInput, sumMinor, type Blank, type Minor } from "@/lib/money";
import { recordRef, traced, type Traced } from "@/modules/reports/trace";
import {
  computeDailyFigures,
  computePeriodTotals,
  drawerAfterLaterMovements,
  expectedCashAt,
  movementsAfter,
  reconcileCount,
  snapshotOfSavedCount,
  statementTotalAt,
  type CashCountSnapshot,
  type DailyFigures,
  type PeriodTotals,
} from "./calc";
import type { BusinessDay, CashCount, CashMovement } from "./types";

export const OPERATING_BRANCH = "maarif";
export const DEFAULT_MONTH = "2026-11";
export const DEFAULT_DAY = "2026-11-02";

async function operatingBranch(): Promise<BranchSettings> {
  const branch = await getRepository().getBranch(OPERATING_BRANCH);
  if (!branch) throw new Error(`Branch ${OPERATING_BRANCH} is not configured`);
  return branch;
}

// ------------------------------------------------------------- daily close

export interface DailyRowView {
  businessDate: Traced<BusinessDate>;
  closed: boolean;
  sales: Traced<Blank<Minor>>;
  orders: Traced<Blank<number>>;
  average: Traced<Blank<Minor>>;
  expensesInclRemittance: Traced<Blank<Minor>>;
  remittance: Traced<Blank<Minor>>;
  remittanceRatio: Traced<Blank<number>>;
  card: Traced<Blank<Minor>>;
  cardRatio: Traced<Blank<number>>;
}

export interface MovementLineView {
  id: string;
  kind: CashMovement["kind"];
  amount: Traced<Minor>;
  occurredAt: string;
  note: string;
}

export interface DailyCloseView {
  repositorySource: string;
  dataVersion: string;
  branch: BranchSettings;
  month: string;
  title: Traced<{ branchCode: string; month: string }>;
  rows: DailyRowView[];
  totals: PeriodTotals;
  totalsTrace: { field: string; record: string };
  selected: {
    businessDate: BusinessDate;
    figures: DailyRowView;
    lines: MovementLineView[];
    expenses: Traced<Minor>;
  } | null;
}

function dailyRowView(branch: string, figures: DailyFigures, day: BusinessDay | undefined): DailyRowView {
  const dayRecord = day ? recordRef.businessDay(branch, figures.businessDate) : undefined;
  const moveRecord = recordRef.cashMovements(branch, figures.businessDate);
  const both = [dayRecord, moveRecord].filter(Boolean).join(" + ");
  return {
    businessDate: traced(figures.businessDate, { field: "DS-01", record: dayRecord }),
    closed: figures.closed,
    sales: traced(figures.sales, { field: "DS-02", record: dayRecord }),
    orders: traced(figures.orders, { field: "DS-03", record: dayRecord }),
    average: traced(figures.average, { field: "DS-04", record: dayRecord }),
    expensesInclRemittance: traced(figures.expensesInclRemittance, { field: "DS-05", record: both }),
    remittance: traced(figures.remittance, { field: "DS-06", record: moveRecord }),
    remittanceRatio: traced(figures.remittanceRatio, { field: "DS-07", record: both }),
    card: traced(figures.card, { field: "DS-08", record: dayRecord }),
    cardRatio: traced(figures.cardRatio, { field: "DS-09", record: dayRecord }),
  };
}

export function parseMonth(value: string | undefined): string {
  return isMonth(value) ? value : DEFAULT_MONTH;
}

export function parseDay(value: string | undefined): BusinessDate | null {
  return isBusinessDate(value) ? value : null;
}

export async function getDailyCloseView(monthParam?: string, dayParam?: string): Promise<DailyCloseView> {
  const repo = getRepository();
  const branch = await operatingBranch();
  const month = parseMonth(monthParam);
  const [days, movements] = await Promise.all([
    repo.listBusinessDays(branch.code),
    repo.listCashMovements(branch.code),
  ]);

  const figuresFor = (date: BusinessDate) =>
    computeDailyFigures(
      date,
      days.find((d) => d.businessDate === date),
      movements.filter((m) => m.businessDate === date),
    );
  const dayOf = (date: BusinessDate) => days.find((d) => d.businessDate === date);

  const dates = daysInMonth(month);
  const figures = dates.map(figuresFor);
  const rows = figures.map((f) => dailyRowView(branch.code, f, dayOf(f.businessDate)));
  const totals = computePeriodTotals(figures);

  const selectedDate = parseDay(dayParam) ?? (dates.includes(DEFAULT_DAY) ? DEFAULT_DAY : null);
  let selected: DailyCloseView["selected"] = null;
  if (selectedDate) {
    const dayMovements = movements
      .filter((m) => m.businessDate === selectedDate)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const sel = figuresFor(selectedDate);
    selected = {
      businessDate: selectedDate,
      figures: dailyRowView(branch.code, sel, dayOf(selectedDate)),
      lines: dayMovements.map((m) => ({
        id: m.id,
        kind: m.kind,
        amount: traced(m.amount, { field: "ST-02", record: `cash_movements:${m.id}` }),
        occurredAt: m.occurredAt,
        note: m.note,
      })),
      expenses: traced(sel.expenses ?? 0, {
        field: "ST-03",
        record: recordRef.cashMovements(branch.code, selectedDate),
      }),
    };
  }

  return {
    repositorySource: repo.source,
    dataVersion: repo.dataVersion,
    branch,
    month,
    title: traced({ branchCode: branch.code, month }, { field: "DS-11" }),
    rows,
    totals,
    totalsTrace: { field: "DS-10", record: `${recordRef.businessDay(branch.code, month)} (${totals.closedDays} closed days)` },
    selected,
  };
}

// -------------------------------------------------------------- cash count

export type PreviewError = "invalid_amount" | "negative_amount";

export interface CashCountView {
  repositorySource: string;
  dataVersion: string;
  branch: BranchSettings;
  businessDate: BusinessDate;
  availableDates: BusinessDate[];
  /** False when the requested date has no business day. */
  dayFound: boolean;
  dayClosed: boolean;
  opening: Traced<Blank<Minor>>;
  systemRevenue: Traced<Blank<Minor>>; // ST-07
  card: Traced<Blank<Minor>>; // ST-05
  movements: MovementLineView[];
  expenses: Traced<Minor>; // ST-03
  saved: null | {
    countedAmount: Traced<Minor>; // ST-04
    countedAt: string;
    /** Business date derived from the count's event time and the branch's settings. */
    derivedBusinessDate: BusinessDate;
    expected: Traced<Blank<Minor>>;
    variance: Traced<Blank<Minor>>; // ST-08
    status: CashCountSnapshot["status"];
    statementTotal: Traced<Blank<Minor>>; // ST-06
    /** Recalculating at the count time reproduces the stored result. */
    recalculationMatches: boolean;
    later: MovementLineView[];
    drawerAfterLater: Traced<Minor>;
  };
  expectedAtClose: Traced<Blank<Minor>>;
  preview: {
    raw: string;
    asOf: string | null;
    error: PreviewError | null;
    snapshot: CashCountSnapshot | null;
  };
  /** Fields that wait for a later-phase decision and are therefore not filled in. */
  pendingFields: string[];
}

function movementLines(list: readonly CashMovement[]): MovementLineView[] {
  return [...list]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .map((m) => ({
      id: m.id,
      kind: m.kind,
      amount: traced(m.amount, { field: "ST-02", record: `cash_movements:${m.id}` }),
      occurredAt: m.occurredAt,
      note: m.note,
    }));
}

export async function getCashCountView(dateParam?: string, countedParam?: string): Promise<CashCountView> {
  const repo = getRepository();
  const branch = await operatingBranch();
  const [days, allMovements, allCounts] = await Promise.all([
    repo.listBusinessDays(branch.code),
    repo.listCashMovements(branch.code),
    repo.listCashCounts(branch.code),
  ]);

  const availableDates = days.filter((d) => d.status === "closed").map((d) => d.businessDate).sort();
  const businessDate = parseDay(dateParam) ?? DEFAULT_DAY;
  const day = days.find((d) => d.businessDate === businessDate);
  const movements = allMovements.filter((m) => m.businessDate === businessDate);
  const dayRec = recordRef.businessDay(branch.code, businessDate);
  const moveRec = recordRef.cashMovements(branch.code, businessDate);

  const saved = pickLatestCount(allCounts.filter((c) => c.businessDate === businessDate));
  let savedView: CashCountView["saved"] = null;
  if (saved && day) {
    const snap = snapshotOfSavedCount(saved);
    const recalculated = reconcileCount(day, movements, saved.countedAmount, saved.countedAt);
    const later = movementsAfter(movements, saved.countedAt);
    const countRec = `cash_counts:${saved.id}`;
    savedView = {
      countedAmount: traced(saved.countedAmount, { field: "ST-04", record: countRec }),
      countedAt: saved.countedAt,
      derivedBusinessDate: businessDateOf(saved.countedAt, branch.timezone, branch.businessDayRollover),
      expected: traced(snap.expectedCash, { field: "ST-08", record: `${countRec} + ${dayRec} + ${moveRec}` }),
      variance: traced(snap.variance, { field: "ST-08", record: countRec }),
      status: snap.status,
      statementTotal: traced(
        statementTotalAt(saved.countedAmount, day.cardAmount, movements, saved.countedAt),
        { field: "ST-06", record: `${countRec} + ${dayRec} + ${moveRec}` },
      ),
      recalculationMatches:
        recalculated.expectedCash === snap.expectedCash && recalculated.variance === snap.variance,
      later: movementLines(later),
      drawerAfterLater: traced(drawerAfterLaterMovements(saved.countedAmount, later), {
        field: "LG-06",
        record: `${countRec} + ${moveRec}`,
      }),
    };
  }

  // What-if preview: a counted amount typed by the user, never saved.
  const raw = (countedParam ?? "").trim();
  const asOf = saved?.countedAt ?? day?.closedAt ?? null;
  let error: PreviewError | null = null;
  let snapshot: CashCountSnapshot | null = null;
  if (raw !== "" || countedParam !== undefined) {
    const parsed = parseMadInput(raw);
    if (parsed === undefined) error = "invalid_amount";
    else if (parsed !== null && parsed < 0) error = "negative_amount";
    else if (day && asOf) snapshot = reconcileCount(day, movements, parsed, asOf);
  }

  return {
    repositorySource: repo.source,
    dataVersion: repo.dataVersion,
    branch,
    businessDate,
    availableDates,
    dayFound: Boolean(day),
    dayClosed: day?.status === "closed",
    opening: traced(day?.openingCash ?? null, { field: "LG-06", record: dayRec }),
    systemRevenue: traced(day?.netSales ?? null, { field: "ST-07", record: dayRec }),
    card: traced(day?.cardAmount ?? null, { field: "ST-05", record: dayRec }),
    movements: movementLines(movements),
    expenses: traced(sumMinor(movements.filter((m) => m.kind === "expense").map((m) => m.amount)), {
      field: "ST-03",
      record: moveRec,
    }),
    saved: savedView,
    expectedAtClose: traced(day ? expectedCashAt(day, movements, "9999-12-31T00:00:00Z") : null, {
      field: "LG-06",
      record: `${dayRec} + ${moveRec}`,
    }),
    preview: { raw, asOf, error, snapshot },
    pendingFields: ["ST-09", "LG-08"],
  };
}

function pickLatestCount(counts: readonly CashCount[]): CashCount | undefined {
  return [...counts].sort((a, b) => b.countedAt.localeCompare(a.countedAt))[0];
}
