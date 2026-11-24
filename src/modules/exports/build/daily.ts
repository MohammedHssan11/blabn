import { averageMinor, ratioBp, type Blank } from "@/lib/money";
import { daysInMonth } from "@/lib/dates";
import type { CashEntry, OperatingDay, OperatingReport, DayState } from "@/modules/closing/operations";
import {
  blank, date, int, L, local, money, name, pending, ratio, userText, weekdayKey,
  type Cell, type Row, type SheetModel, type WorkbookModel,
} from "../model";
import type { LabelKey } from "../labels";
import { isPending, requireField } from "@/modules/reports/field-map";

/**
 * Daily Sales Maarief (DS-01–DS-11), Daily statement (ST-01–ST-09) and Yawmeya (LG-01–LG-11).
 * All three read the same saved daily-close revisions (Phase 4), pinned to one report basis, so a
 * figure shared by the three reports is the same number in each. Days that are not closed are left
 * blank unless the export includes drafts (and the person may export drafts).
 */

export interface DailyInput {
  branch: { code: string; nameAr: string; nameEn: string };
  period: { mode: "month"; month: string } | { mode: "day"; date: string };
  includeDrafts: boolean;
  /** The month report (`app_operating_report`) at one basis. */
  report: OperatingReport;
  /** Full day records at the same basis, for the statement and the Yawmeya. */
  details: Record<string, OperatingDay>;
}

type DayRow = OperatingReport["days"][number];

const CLOSED: readonly DayState[] = ["closed", "corrected"];
export const isIncluded = (state: DayState, drafts: boolean) => CLOSED.includes(state) || drafts;

const branchName = (input: DailyInput) => name(input.branch.nameAr, input.branch.nameEn);
const monthOf = (input: DailyInput) => (input.period.mode === "month" ? input.period.month : input.period.date.slice(0, 7));

function sumPresent(values: Array<Blank<number>>): Blank<number> {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/** Status of a business date: its saved state, not started, or not entered. */
function stateKey(row: DayRow | undefined, day: string, today: string, drafts: boolean): LabelKey {
  if (!row) return day > today ? "dayState.future" : "dayState.not_entered";
  if (!isIncluded(row.state, drafts)) return "dayState.excluded_draft";
  return `dayState.${row.state}` as LabelKey;
}

const draftStyle = (state: DayState): Row["style"] => (CLOSED.includes(state) ? undefined : "draft");

// ------------------------------------------------------------------ Daily Sales (DS)

export function buildDailySales(input: DailyInput): WorkbookModel {
  const month = monthOf(input);
  const today = input.report.branch.today;
  const byDate = new Map(input.report.days.map((d) => [d.date, d]));
  const included: DayRow[] = [];
  const rows: Row[] = daysInMonth(month).map((day) => {
    const row = byDate.get(day);
    const state = L(stateKey(row, day, today, input.includeDrafts));
    if (!row || !isIncluded(row.state, input.includeDrafts)) {
      return { cells: [date(day), L(weekdayKey(day)), money(null), int(null), money(null), money(null), money(null), ratio(null), money(null), ratio(null), state],
        style: "muted" };
    }
    included.push(row);
    const s = row.summary;
    // DS-06 is blank when no remittance is recorded (a recorded remittance is always above 0).
    const remittance = s.remittances > 0 ? s.remittances : null;
    return {
      cells: [date(day), L(weekdayKey(day)), money(row.sales), int(row.orders), money(s.average), money(s.expenses + s.remittances),
        money(remittance), ratio(remittance === null ? null : s.remittanceRatio), money(row.card), ratio(s.cardRatio), state],
      style: draftStyle(row.state),
    };
  });

  // DS-10: sums of the included days; period average = total sales ÷ total orders; ratios on the totals.
  const sales = sumPresent(included.map((d) => d.sales));
  const orders = sumPresent(included.map((d) => d.orders));
  const card = sumPresent(included.map((d) => d.card));
  const expenses = included.length ? included.reduce((t, d) => t + d.summary.expenses + d.summary.remittances, 0) : null;
  const remitted = included.reduce((t, d) => t + d.summary.remittances, 0);
  const remittance = remitted > 0 ? remitted : null;
  const started = daysInMonth(month).filter((d) => d <= today).length;
  rows.push({
    cells: [L("ds.totalRow"), blank, money(sales), int(orders), money(averageMinor(sales, orders)), money(expenses),
      money(remittance), ratio(remittance === null ? null : ratioBp(remittance, sales)), money(card), ratio(ratioBp(card, sales)),
      L("common.daysIncluded", { n: included.length, of: started })],
    style: "total",
  });

  const sheet: SheetModel = {
    key: "daily_sales", name: L("ds.sheet"), landscape: true, widths: [12, 11, 15, 12, 13, 17, 15, 11, 14, 11, 22],
    blocks: [
      { kind: "title", size: "large", cells: [titleCell("ds.title", input, { month })] },
      {
        kind: "table", main: true,
        header: [L("ds.date"), L("common.day"), L("ds.sales"), L("ds.orders"), L("ds.average"), L("ds.expenses"), L("ds.cash"),
          L("ds.cashRatio"), L("ds.card"), L("ds.cardRatio"), L("common.state")],
        fields: ["DS-01", null, "DS-02", "DS-03", "DS-04", "DS-05", "DS-06", "DS-07", "DS-08", "DS-09", null],
        rows,
      },
      { kind: "gap" },
      { kind: "title", cells: [L("ds.periodAverageRule")] },
    ],
  };
  return { family: "daily_sales", draft: input.includeDrafts, sheets: [sheet], fields: ["DS-01", "DS-02", "DS-03", "DS-04", "DS-05", "DS-06", "DS-07", "DS-08", "DS-09", "DS-10", "DS-11"] };
}

/** A title with the branch name in the workbook's language. */
function titleCell(key: LabelKey, input: DailyInput, params: Record<string, string> = {}): Cell {
  return { t: "label", k: key, p: { ...params, branch: { ar: input.branch.nameAr, en: input.branch.nameEn } } };
}

// ------------------------------------------------------------------ shared day pieces

const DENOMINATION_ORDER = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1];

function denominationRows(day: OperatingDay): Row[] {
  const count = day.data.count;
  if (!count) return [{ cells: [L("common.notCounted"), blank, blank], style: "muted" }];
  const rows: Row[] = DENOMINATION_ORDER.filter((d) => count.quantities[String(d)] !== undefined).map((d) => {
    const quantity = Number(count.quantities[String(d)]);
    return { cells: [money(d), int(quantity), money(d * quantity)] };
  });
  rows.push({ cells: [L("common.total"), blank, money(count.total)], style: "total" });
  return rows;
}

const activeEntries = (day: OperatingDay): CashEntry[] => day.data.entries.filter((e) => !e.reversedBy);

function peopleRows(day: OperatingDay): Cell[][] {
  const count = day.data.count;
  return [
    [L("st.counter"), count ? userText(count.counter.name) : blank, ...(isPending(requireField("ST-09")) ? [pending(["P1-19"])] : [])],
    [L("st.counterRole"), count ? L(`role.${count.counter.role}` as LabelKey) : blank],
    [L("st.cashier"), day.data.cashier ? userText(day.data.cashier.name) : blank],
    [L("st.shift"), day.data.shift ? L(`shift.${day.data.shift}` as LabelKey) : blank],
    [L("st.recorder"), count ? userText(count.recorderName) : blank],
    [L("st.countTime"), count ? local(count.local) : blank],
  ];
}

// ------------------------------------------------------------------ Daily statement (ST)

function statementSheet(input: DailyInput, day: string, record: OperatingDay | undefined, row: DayRow | undefined): SheetModel {
  const today = input.report.branch.today;
  const blocks: SheetModel["blocks"] = [
    { kind: "title", size: "large", cells: [titleCell("st.title", input)] },
    { kind: "title", cells: [branchName(input)] },
    { kind: "kv", rows: [[L("st.date"), date(day), L(weekdayKey(day))], [L("common.state"), L(stateKey(row, day, today, input.includeDrafts))]] },
  ];
  if (!record || !row || !isIncluded(row.state, input.includeDrafts)) {
    blocks.push({ kind: "gap" }, { kind: "title", cells: [L("st.notIncluded")] });
    return { key: day, name: { t: "text", v: day }, landscape: false, widths: [34, 22, 18, 16], blocks };
  }
  const entries = activeEntries(record);
  const expenses = entries.filter((e) => e.kind === "cash_expense");
  const remittances = entries.filter((e) => e.kind === "remittance");
  const s = record.summary;
  const count = record.data.count;
  const lines: Row[] = [
    ...expenses.map((e) => ({ cells: [userText(e.note), userText(e.account), local(e.local), money(e.amount)] })),
    ...remittances.map((e) => ({ cells: [L("st.remittanceLine"), userText(e.reference), local(e.local), money(e.amount)] })),
  ];
  if (lines.length === 0) lines.push({ cells: [L("common.nothingRecorded"), blank, blank, blank], style: "muted" });
  lines.push({ cells: [L("st.totalExpenses"), blank, blank, money(s.expenses)], style: "total" });
  lines.push({ cells: [L("st.totalWithRemittance"), blank, blank, money(s.expenses + s.remittances)], style: "total" });

  const laterRemittance = count ? remittances.filter((e) => e.local > count.local).reduce((t, e) => t + e.amount, 0) : null;
  // ST-06 = counted cash + card + cash expenses through the count, as saved; the expense part is derived from it.
  const expensesAtCount = count && s.statementTotal !== null && record.data.card != null ? s.statementTotal - count.total - record.data.card : null;
  blocks.push(
    { kind: "kv", rows: peopleRows(record) },
    { kind: "gap" },
    { kind: "title", cells: [L("st.expenses")] },
    { kind: "table", header: [L("st.description"), L("st.account"), L("common.time"), L("st.amount")], fields: ["ST-02", "ST-02", null, "ST-02"], rows: lines },
    { kind: "gap" },
    { kind: "title", cells: [L("st.denominations")] },
    { kind: "table", header: [L("st.denomination"), L("st.quantity"), L("st.value")], fields: ["ST-04", "ST-04", "ST-04"], rows: denominationRows(record) },
    { kind: "gap" },
    { kind: "title", cells: [L("st.reconciliation")] },
    {
      kind: "kv", rows: [
        [L("st.countedCash"), money(count?.total ?? null)],
        [L("st.card"), money(record.data.card ?? null)],
        [L("st.expensesAtCount"), money(expensesAtCount)],
        [L("st.statementTotal"), money(s.statementTotal)],
        [L("st.systemRevenue"), money(record.data.sales ?? null)],
        [L("st.expected"), money(s.expected)],
        [L("st.variance"), money(s.variance)],
        [L("st.laterRemittance"), money(laterRemittance === 0 ? null : laterRemittance)],
      ],
    },
  );
  return { key: day, name: { t: "text", v: day }, landscape: false, widths: [34, 22, 18, 16], blocks };
}

function selectedDays(input: DailyInput): string[] {
  if (input.period.mode === "day") return [input.period.date];
  return input.report.days.filter((d) => isIncluded(d.state, input.includeDrafts)).map((d) => d.date);
}

export function buildDailyStatement(input: DailyInput): WorkbookModel {
  const byDate = new Map(input.report.days.map((d) => [d.date, d]));
  const sheets: SheetModel[] = [];
  if (input.period.mode === "month") {
    const today = input.report.branch.today;
    const rows: Row[] = daysInMonth(input.period.month).map((day) => {
      const row = byDate.get(day);
      const shown = row && isIncluded(row.state, input.includeDrafts);
      return {
        cells: [date(day), L(weekdayKey(day)), L(stateKey(row, day, today, input.includeDrafts)), money(shown ? row.sales : null),
          money(shown ? row.card : null), money(shown ? row.summary.expenses : null), money(shown ? row.summary.statementTotal : null),
          money(shown ? row.summary.variance : null)],
        style: shown ? draftStyle(row.state) : "muted",
      };
    });
    sheets.push({
      key: "index", name: L("st.index"), landscape: true, widths: [12, 11, 20, 15, 14, 14, 15, 14],
      blocks: [
        { kind: "title", size: "large", cells: [titleCell("st.title", input)] },
        { kind: "title", cells: [branchName(input)] },
        { kind: "table", main: true, header: [L("st.date"), L("common.day"), L("common.state"), L("st.systemRevenue"), L("st.card"),
          L("st.totalExpenses"), L("st.statementTotal"), L("st.variance")], fields: ["ST-01", null, null, "ST-07", "ST-05", "ST-03", "ST-06", "ST-08"], rows },
      ],
    });
  }
  for (const day of selectedDays(input)) sheets.push(statementSheet(input, day, input.details[day], byDate.get(day)));
  return { family: "daily_statement", draft: input.includeDrafts, sheets,
    fields: ["ST-01", "ST-02", "ST-03", "ST-04", "ST-05", "ST-06", "ST-07", "ST-08", "ST-09"] };
}

// ------------------------------------------------------------------ Yawmeya (LG)

function ledgerRows(record: OperatingDay, ledger: "cash" | "custody"): Row[] {
  const s = record.summary;
  const entries = activeEntries(record).filter((e) => (ledger === "cash"
    ? ["cash_receipt", "cash_expense", "remittance"] : ["custody_receipt", "custody_expense"]).includes(e.kind));
  const inbound = (e: CashEntry) => e.kind === "cash_receipt" || e.kind === "custody_receipt";
  const rows: Row[] = [{ cells: [blank, blank, L("lg.opening"), money(ledger === "cash" ? s.openingCash : s.openingCustody), blank, blank], style: "section" }];
  let totalIn = 0;
  let totalOut = 0;
  if (ledger === "cash" && record.data.posCash != null) {
    rows.push({ cells: [blank, blank, L("lg.posCashLine"), money(record.data.posCash), blank, blank] });
    totalIn += record.data.posCash;
  }
  for (const e of entries) {
    const isIn = inbound(e);
    if (isIn) totalIn += e.amount; else totalOut += e.amount;
    rows.push({ cells: [local(e.local), userText(e.account), e.kind === "remittance" ? L("lg.remittance") : userText(e.note),
      money(isIn ? e.amount : null), money(isIn ? null : e.amount), userText(e.reference)] });
  }
  rows.push({ cells: [blank, blank, L("lg.totals"), money(totalIn), money(totalOut), blank], style: "total" });
  rows.push({ cells: [blank, blank, L("lg.closing"), money(ledger === "cash" ? s.closingCash : s.closingCustody), blank, blank], style: "section" });
  return rows;
}

function resultCell(record: OperatingDay): Cell {
  const v = record.summary.variance;
  if (!record.data.count || v === null) return L("common.notCounted");
  if (v === 0) return L("lg.match");
  const amount = (Math.abs(v) / 100).toFixed(2);
  return L(v > 0 ? "lg.over" : "lg.short", { amount });
}

function ledgerSheet(input: DailyInput, day: string, record: OperatingDay | undefined, row: DayRow | undefined): SheetModel {
  const today = input.report.branch.today;
  const widths = [17, 24, 30, 14, 14, 18, 16];
  const blocks: SheetModel["blocks"] = [
    { kind: "title", size: "large", cells: [titleCell("lg.title", input)] },
    { kind: "kv", rows: [[L("common.branch"), branchName(input)], [L("common.date"), date(day), L(weekdayKey(day))],
      [L("common.state"), L(stateKey(row, day, today, input.includeDrafts))], ...(record ? [[L("common.revision"), int(record.revision)]] : [])] },
  ];
  if (!record || !row || !isIncluded(row.state, input.includeDrafts)) {
    blocks.push({ kind: "gap" }, { kind: "title", cells: [L("st.notIncluded")] });
    return { key: day, name: { t: "text", v: day }, landscape: true, widths, blocks };
  }
  const d = record.data;
  const cancellations = d.cancellations.filter((c) => !c.reversedBy);
  blocks.push(
    { kind: "gap" },
    { kind: "title", cells: [L("lg.sales")] },
    { kind: "kv", rows: [[L("lg.morning"), money(d.morning ?? null)], [L("lg.evening"), money(d.evening ?? null)], [L("lg.salesTotal"), money(d.sales ?? null)]] },
    { kind: "title", cells: [L("lg.payments")] },
    { kind: "kv", rows: [[L("lg.posCash"), money(d.posCash ?? null)], [L("lg.card"), money(d.card ?? null)]] },
    { kind: "gap" },
    { kind: "title", cells: [L("lg.cashLedger")] },
    { kind: "table", header: [L("common.time"), L("lg.account"), L("lg.description"), L("lg.in"), L("lg.out"), L("st.reference")],
      fields: [null, "LG-04", "LG-04", "LG-04", "LG-04", null], rows: ledgerRows(record, "cash") },
    { kind: "gap" },
    { kind: "title", cells: [L("lg.custodyLedger")] },
    { kind: "table", header: [L("common.time"), L("lg.account"), L("lg.description"), L("lg.in"), L("lg.out"), L("st.reference")],
      fields: [null, "LG-04", "LG-04", "LG-04", "LG-04", null], rows: ledgerRows(record, "custody") },
    { kind: "gap" },
    { kind: "title", cells: [L("lg.count")] },
    { kind: "table", header: [L("st.denomination"), L("st.quantity"), L("st.value")], fields: ["LG-05", "LG-05", "LG-05"], rows: denominationRows(record) },
    { kind: "kv", rows: [[L("st.expected"), money(record.summary.expected)], [L("st.variance"), money(record.summary.variance)], [L("lg.result"), resultCell(record)], ...peopleRows(record)] },
    { kind: "gap" },
    { kind: "title", cells: [L("lg.cancellations")] },
    {
      kind: "table",
      header: [L("lg.orderStart"), L("lg.cancelTime"), L("lg.oldOrder"), L("lg.oldValue"), L("lg.newOrder"), L("lg.newValue"), L("lg.reason")],
      fields: ["LG-09", "LG-09", "LG-09", "LG-09", "LG-09", "LG-09", "LG-09"],
      rows: cancellations.length === 0
        ? [{ cells: [L("common.none"), blank, blank, blank, blank, blank, blank], style: "muted" }]
        : cancellations.map((c) => ({ cells: [local(c.originalLocal), local(c.local), userText(c.original), money(c.originalAmount),
          userText(c.replacement), money(c.replacementAmount), userText(c.note)] })),
    },
  );
  return { key: day, name: { t: "text", v: day }, landscape: true, widths, blocks };
}

export function buildDailyLedger(input: DailyInput): WorkbookModel {
  const byDate = new Map(input.report.days.map((d) => [d.date, d]));
  const sheets: SheetModel[] = [];
  const days = selectedDays(input);
  if (input.period.mode === "month") {
    const month = input.period.month;
    const today = input.report.branch.today;
    // LG-10: one row per day of the month from the saved entries.
    const summaryRows: Row[] = daysInMonth(month).map((day) => {
      const row = byDate.get(day);
      const record = input.details[day];
      if (!row || !record || !isIncluded(row.state, input.includeDrafts)) {
        return { cells: [date(day), L(stateKey(row, day, today, input.includeDrafts)), blank, blank, blank, blank, blank, blank, blank, blank], style: "muted" };
      }
      const s = record.summary;
      const cancelled = record.data.cancellations.filter((c) => !c.reversedBy).reduce((t, c) => t + c.originalAmount, 0);
      return {
        cells: [date(day), L(`dayState.${row.state}` as LabelKey), money(s.openingCash), money((record.data.posCash ?? 0) + s.receipts),
          money(s.expenses + s.remittances), money(s.closingCash), money(s.custodyReceipts), money(s.custodyExpenses), money(s.closingCustody),
          money(cancelled)],
        style: draftStyle(row.state),
      };
    });
    // LG-11: totals by account (as recorded on each entry) and ledger.
    const accounts = new Map<string, { ledger: "cash" | "custody"; account: string | null; n: number; inbound: number; outbound: number }>();
    for (const day of days) {
      const record = input.details[day];
      if (!record) continue;
      for (const e of activeEntries(record)) {
        const ledger = e.kind.startsWith("custody") ? "custody" : "cash";
        const key = `${ledger}|${e.account ?? ""}|${e.kind === "remittance" ? "remittance" : ""}`;
        const item = accounts.get(key) ?? { ledger, account: e.kind === "remittance" && !e.account ? null : e.account, n: 0, inbound: 0, outbound: 0 };
        item.n += 1;
        if (e.kind === "cash_receipt" || e.kind === "custody_receipt") item.inbound += e.amount; else item.outbound += e.amount;
        accounts.set(key, item);
      }
    }
    const accountRows: Row[] = [...accounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, a]) => ({
      cells: [L(a.ledger === "cash" ? "lg.ledgerCash" : "lg.ledgerCustody"),
        a.account ? userText(a.account) : key.endsWith("|remittance") ? L("lg.remittance") : L("lg.noAccount"),
        int(a.n), money(a.inbound || null), money(a.outbound || null)],
    }));
    if (accountRows.length === 0) accountRows.push({ cells: [L("common.nothingRecorded"), blank, blank, blank, blank], style: "muted" });
    sheets.push({
      key: "summary", name: L("lg.summarySheet"), landscape: true, widths: [12, 18, 15, 14, 14, 15, 14, 14, 15, 15],
      blocks: [
        { kind: "title", size: "large", cells: [L("lg.summaryTitle", { month })] },
        { kind: "title", cells: [branchName(input)] },
        { kind: "table", main: true, header: [L("common.date"), L("common.state"), L("lg.openingCash"), L("lg.cashIn"), L("lg.cashOut"),
          L("lg.closingCash"), L("lg.custodyIn"), L("lg.custodyOut"), L("lg.closingCustody"), L("lg.cancelledValue")],
          fields: ["LG-10", null, "LG-06", "LG-10", "LG-10", "LG-06", "LG-07", "LG-07", "LG-07", "LG-10"], rows: summaryRows },
        { kind: "gap" },
        { kind: "title", cells: [L("lg.carryRule")] },
      ],
    }, {
      key: "accounts", name: L("lg.accountsSheet"), landscape: false, widths: [14, 34, 12, 15, 15],
      blocks: [
        { kind: "title", size: "large", cells: [L("lg.accountsTitle", { month })] },
        { kind: "table", main: true, header: [L("lg.ledger"), L("lg.account"), L("lg.entries"), L("lg.in"), L("lg.out")],
          fields: [null, "LG-11", "LG-11", "LG-11", "LG-11"], rows: accountRows },
      ],
    });
  }
  for (const day of days) sheets.push(ledgerSheet(input, day, input.details[day], byDate.get(day)));
  return { family: "daily_ledger", draft: input.includeDrafts, sheets,
    fields: ["LG-01", "LG-02", "LG-03", "LG-04", "LG-05", "LG-06", "LG-07", "LG-08", "LG-09", ...(input.period.mode === "month" ? ["LG-10", "LG-11"] : [])] };
}
