import type { BranchDay, BranchInfo, Figure, MonthlyComparison, WeeklyComparison } from "@/modules/comparisons/calc";
import { blank, date, int, L, money, name, ratio, weekdayKey, type Cell, type Row, type WorkbookModel } from "../model";
import type { LabelKey } from "../labels";

/**
 * Sales comparison (CMP-01–CMP-08) from the Phase 7 calculation (comparisons/calc.ts), the same
 * result the comparison screen and its CSV show. Weekly: one shared current/prior date pair; the
 * total ratio is summed current ÷ summed prior. Monthly: growth = current ÷ prior − 1, kept separate,
 * with like-for-like period growth. Missing figures stay blank with their reason; coverage is shown.
 */

export type ComparisonInput =
  | { mode: "weekly"; branches: BranchInfo[]; result: WeeklyComparison }
  | { mode: "monthly"; branches: BranchInfo[]; result: MonthlyComparison };

const branchCell = (b: BranchInfo): Cell => name(b.nameAr, b.nameEn);

/** Where a figure came from: the closed day, or a reporting-only entry (historical ones with their reference). */
function sourceCell(figure: Figure | null): Cell {
  if (!figure) return blank;
  if (figure.origin === "entry" && figure.purpose === "historical") return L("cmpSource.historical", { reference: figure.reference || "—" });
  if (figure.origin === "entry") {
    return L("cmpSource.entry", { source: { ar: figure.sourceLabelAr ?? figure.source, en: figure.sourceLabelEn ?? figure.source }, revision: figure.revision });
  }
  return L("cmpSource.closed_day", { revision: figure.revision });
}

const statusCell = (day: BranchDay): Cell => L(`cmpStatus.${day.status}` as LabelKey);

function namesOf(codes: string[], branches: BranchInfo[]) {
  const pick = (code: string) => branches.find((b) => b.code === code);
  return {
    ar: codes.map((c) => pick(c)?.nameAr ?? c).join("، "),
    en: codes.map((c) => pick(c)?.nameEn ?? c).join(", "),
  };
}

function weekly(input: Extract<ComparisonInput, { mode: "weekly" }>): WorkbookModel {
  const { result } = input;
  const rows: Row[] = result.rows.map((r) => ({
    cells: [branchCell(r.branch), date(r.current.businessDate), money(r.current.sales), int(r.current.orders), statusCell(r.current),
      date(r.prior.businessDate), money(r.prior.sales), int(r.prior.orders), statusCell(r.prior),
      money(r.salesDiff), int(r.ordersDiff), ratio(r.ratio), r.ratioReason === "ok" ? blank : L(`cmpReason.${r.ratioReason}` as LabelKey),
      sourceCell(r.current.salesFigure), sourceCell(r.prior.salesFigure)],
    style: r.current.historical || r.prior.historical ? "muted" : undefined,
  }));
  const t = result.total;
  const missing = [...new Set([...t.missingCurrent, ...t.missingPrior])];
  rows.push({
    cells: [L("cmp.totalSelected"), date(result.currentDate), money(t.currentSales), int(t.currentOrders),
      L("cmp.presentOf", { p: t.currentCoverage.present, t: t.currentCoverage.total }),
      date(result.priorDate), money(t.priorSales), int(t.priorOrders), L("cmp.presentOf", { p: t.priorCoverage.present, t: t.priorCoverage.total }),
      money(t.salesDiff), int(t.ordersDiff), ratio(t.ratio), t.ratioReason === "ok" ? blank : L(`cmpReason.${t.ratioReason}` as LabelKey),
      t.incomplete ? L("cmp.incomplete", { branches: namesOf(missing, input.branches) }) : L("cmp.complete"), blank],
    style: "total",
  });
  return {
    family: "sales_comparison", draft: false, fields: ["CMP-05", "CMP-06", "CMP-07", "CMP-08"],
    sheets: [{
      key: "weekly", name: L("cmp.weeklySheet"), landscape: true, widths: [18, 12, 14, 11, 14, 12, 14, 11, 14, 13, 11, 13, 20, 30, 30],
      blocks: [
        { kind: "title", size: "large", cells: [L("cmp.weeklyTitle")] },
        { kind: "title", cells: [L("cmp.weeklyDates", { current: result.currentDate, prior: result.priorDate,
          currentDay: { ref: weekdayKey(result.currentDate) }, priorDay: { ref: weekdayKey(result.priorDate) } })] },
        {
          kind: "table", main: true,
          header: [L("common.branch"), L("cmp.currentDate"), L("cmp.currentSales"), L("cmp.currentOrders"), L("cmp.status"),
            L("cmp.priorDate"), L("cmp.priorSales"), L("cmp.priorOrders"), L("cmp.status"), L("cmp.salesDiff"), L("cmp.ordersDiff"),
            L("cmp.ratio"), L("common.note"), L("common.source"), L("common.source")],
          fields: [null, "CMP-05", "CMP-07", "CMP-07", null, "CMP-05", "CMP-07", "CMP-07", null, null, null, "CMP-06", null, null, null],
          rows,
        },
        { kind: "gap" },
        { kind: "title", cells: [L("cmp.weeklyRule")] },
      ],
    }],
  };
}

function monthly(input: Extract<ComparisonInput, { mode: "monthly" }>): WorkbookModel {
  const { result } = input;
  const sideStatus = (s: MonthlyComparison["rows"][number]["current"]): Cell => L(`cmpStatus.${s.status}` as LabelKey);
  const rows: Row[] = result.rows.map((r) => ({
    cells: [int(r.day), date(r.current.date), r.current.date ? L(weekdayKey(r.current.date)) : blank, money(r.current.sales), int(r.current.orders),
      L("cmp.presentOf", { p: r.current.present, t: r.current.days.length }), sideStatus(r.current),
      date(r.prior.date), r.prior.date ? L(weekdayKey(r.prior.date)) : blank, money(r.prior.sales), int(r.prior.orders),
      L("cmp.presentOf", { p: r.prior.present, t: r.prior.days.length }), sideStatus(r.prior),
      ratio(r.growth), r.growthReason === "ok" ? blank : L(`cmpReason.${r.growthReason}` as LabelKey)],
    style: r.comparable ? undefined : "muted",
  }));
  const p = result.period;
  const periodRows: Row[] = result.branches.map((b) => ({
    cells: [branchCell(b.branch), money(b.currentSales), int(b.currentOrders), L("cmp.coverageDays", { p: b.currentCoverage.present, t: b.currentCoverage.total }),
      money(b.priorSales), int(b.priorOrders), L("cmp.coverageDays", { p: b.priorCoverage.present, t: b.priorCoverage.total }),
      int(b.comparableDays), ratio(b.growth), b.growthReason === "ok" ? blank : L(`cmpReason.${b.growthReason}` as LabelKey)],
  }));
  periodRows.push({
    cells: [L("cmp.totalSelected"), money(p.currentSales), int(p.currentOrders), blank, money(p.priorSales), int(p.priorOrders), blank,
      int(p.comparableDays), ratio(p.growth), p.growthReason === "ok" ? blank : L(`cmpReason.${p.growthReason}` as LabelKey)],
    style: "total",
  });
  return {
    family: "sales_comparison", draft: false, fields: ["CMP-01", "CMP-02", "CMP-03", "CMP-04", "CMP-07", "CMP-08"],
    sheets: [{
      key: "monthly", name: L("cmp.monthlySheet"), landscape: true, widths: [7, 12, 11, 14, 11, 11, 12, 12, 11, 14, 11, 11, 12, 11, 22],
      blocks: [
        { kind: "title", size: "large", cells: [L("cmp.monthlyTitle", { current: result.currentMonth, prior: result.priorMonth })] },
        { kind: "title", cells: [{ t: "name", ar: input.branches.map((b) => b.nameAr).join("، "), en: input.branches.map((b) => b.nameEn).join(", ") }] },
        ...(result.inProgress ? [{ kind: "title" as const, cells: [L("cmp.monthInProgress", { elapsed: result.elapsedDays, days: result.monthDays })] }] : []),
        {
          kind: "table", main: true,
          header: [L("common.day"), L("cmp.currentDate"), L("common.day"), L("cmp.currentSales"), L("cmp.currentOrders"), L("cmp.branchesPresent"),
            L("cmp.status"), L("cmp.priorDate"), L("common.day"), L("cmp.priorSales"), L("cmp.priorOrders"), L("cmp.branchesPresent"), L("cmp.status"),
            L("cmp.growth"), L("common.note")],
          fields: [null, "CMP-01", null, "CMP-02", "CMP-02", "CMP-08", null, "CMP-01", null, "CMP-02", "CMP-02", "CMP-08", null, "CMP-03", null],
          rows,
        },
      ],
    }, {
      key: "period", name: L("cmp.periodSheet"), landscape: true, widths: [22, 15, 12, 14, 15, 12, 14, 13, 12, 24],
      blocks: [
        { kind: "title", size: "large", cells: [L("cmp.monthlyTitle", { current: result.currentMonth, prior: result.priorMonth })] },
        {
          kind: "table", main: true,
          header: [L("common.branch"), L("cmp.currentSales"), L("cmp.currentOrders"), L("cmp.coverage"), L("cmp.priorSales"), L("cmp.priorOrders"),
            L("cmp.coverage"), L("cmp.comparableDays"), L("cmp.growth"), L("common.note")],
          fields: [null, "CMP-02", "CMP-02", null, "CMP-02", "CMP-02", null, "CMP-04", "CMP-04", null],
          rows: periodRows,
        },
        { kind: "gap" },
        { kind: "title", cells: [L("cmp.monthlyRule")] },
      ],
    }],
  };
}

export function buildComparison(input: ComparisonInput): WorkbookModel {
  return input.mode === "weekly" ? weekly(input) : monthly(input);
}
