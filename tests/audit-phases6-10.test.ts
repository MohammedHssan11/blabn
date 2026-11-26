/*
 * Regression tests for the independent audit of Phases 6-10 (docs/HANDOFF.md). Synthetic figures only.
 * The database rules are covered by supabase/tests/audit_phases6_10_checks.sql and the web flows by
 * scripts/phase8/e2e.mjs and scripts/phase9/e2e.mjs.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { figureKey, monthlyComparison, weeklyComparison, type BranchInfo, type ComparisonData, type Figure } from "@/modules/comparisons/calc";
import { buildDailyLedger, buildDailySales, effectiveRevision, type DailyInput } from "@/modules/exports/build/daily";
import type { OperatingDay, OperatingSummary } from "@/modules/closing/operations";
import { mapStockError } from "@/modules/inventory/stock";
import { verifyItemPlan } from "@/modules/replenishment/verify";
import { weekdayDates } from "@/modules/replenishment/planning";
import type { ItemPlanJson } from "@/modules/replenishment/types";

const ROOT = path.resolve(__dirname, "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const sources = walk(path.join(ROOT, "src")).filter((f) => /\.tsx?$/.test(f))
  .map((f) => ({ file: path.relative(ROOT, f).replaceAll("\\", "/"), text: readFileSync(f, "utf8") }));
const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).sort()
  .map((f) => readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8")).join("\n");

describe("stock history labels", () => {
  it("every movement source the database allows is translated in both languages", () => {
    const lists = [...migrations.matchAll(/stock_movements_source_check\s*check\s*\(source in \(([^)]*)\)/g)];
    const allowed = [...lists.at(-1)![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(allowed).toContain("purchase_order");
    for (const locale of ["en", "ar"] as const) {
      const t = createTranslator(locale);
      for (const source of allowed) expect(() => t(`stock.source.${source}` as MessageKey), `${locale} ${source}`).not.toThrow();
    }
  });

  it("an entry dated before the opening stock has its own message in both languages", () => {
    expect(mapStockError("CT007")).toBe("stock_before_opening");
    for (const locale of ["en", "ar"] as const) expect(createTranslator(locale)("errors.stock_before_opening")).not.toBe("");
  });
});

describe("dates and times come from the database", () => {
  const FALLBACK = "src/lib/database-time.ts";
  it("no page or module derives today's business date from the Node.js clock", () => {
    for (const { file, text } of sources.filter((s) => s.file !== FALLBACK)) expect(text, file).not.toMatch(/businessDateOf\(\s*new Date\(\)|defaultToday/);
  });
  it("stock and comparison pages do not convert saved instants with Node.js time-zone data", () => {
    for (const { file, text } of sources.filter((s) => /app\/\[locale\]\/(inventory|comparison)\//.test(s.file))) {
      expect(text, file).not.toMatch(/formatEventDateTime\([^)]*"Africa\/Casablanca"/);
    }
  });
  it("a form's default time for today is the database's wall clock, not today's business date glued to the clock time", () => {
    for (const { file, text } of sources) expect(text, file).not.toMatch(/\$\{date\}T\$\{[^}]*\.local\.slice\(11\)/);
  });
});

// ------------------------------------------------------------------ comparison totals

const branch = (code: string): BranchInfo => ({ code, nameEn: code, nameAr: code, operatesInApp: false, liveFrom: null, liveFromBasis: null,
  today: null, liveSource: null, liveSourceEn: null, liveSourceAr: null, entryOwner: null });
const figure = (value: number): Figure => ({ value, origin: "entry", source: "reporting_only", sourceLabelEn: null, sourceLabelAr: null,
  purpose: "live", record: "r", revision: 1, reference: "", actor: "", recordedAt: null });
function comparison(rows: Array<[string, string, number, number | null]>): ComparisonData {
  const figures = new Map<string, Figure>();
  for (const [code, date, sales, orders] of rows) {
    figures.set(figureKey(code, date, "net_sales"), figure(sales));
    if (orders !== null) figures.set(figureKey(code, date, "order_count"), figure(orders));
  }
  return { branches: [branch("alquds"), branch("maarif")], figures };
}

describe("a total order count is blank when a counted branch has no order count", () => {
  it("weekly: only the side with the missing count is blank; sales stay totalled", () => {
    const { total } = weeklyComparison(comparison([["alquds", "2026-11-17", 100, null], ["maarif", "2026-11-17", 100, 4],
      ["alquds", "2026-11-10", 100, 5], ["maarif", "2026-11-10", 100, 0]]), "2026-11-17", "2026-11-10");
    expect(total.currentSales).toBe(200);
    expect(total.currentOrders).toBeNull();
    expect(total.priorOrders).toBe(5); // a recorded 0 is a count
    expect(total.ordersDiff).toBeNull();
  });

  it("monthly: the day total and the period total", () => {
    const result = monthlyComparison(comparison([["alquds", "2026-11-02", 100, null], ["maarif", "2026-11-02", 100, 4],
      ["alquds", "2026-10-02", 100, 5], ["maarif", "2026-10-02", 100, 5]]), "2026-11");
    expect(result.rows[1]!.current.orders).toBeNull();
    expect(result.rows[1]!.prior.orders).toBe(10);
    expect(result.period.comparableDays).toBe(1);
    expect(result.period.currentOrders).toBeNull();
    expect(result.period.currentSales).toBe(200);
    // The branch that has its counts keeps its own total.
    expect(result.branches.find((b) => b.branch.code === "maarif")!.currentOrders).toBe(4);
  });
});

// ------------------------------------------------------------------ daily reports

const summary: OperatingSummary = { openingCash: 0, closingCash: 0, openingCustody: 0, closingCustody: 0, expenses: 0, receipts: 0,
  remittances: 0, custodyReceipts: 0, custodyExpenses: 0, expected: 0, variance: 0, statementTotal: 0, average: null, cardRatio: 0, remittanceRatio: null };
type History = OperatingDay["history"];
const step = (revision: number, command: History[number]["command"]): History[number] =>
  ({ revision, basis: revision, actor: "a", command, reason: null, sourceRevision: null, local: "" });

function daily(history: History, revision: number, orders: number | null, sales = 10000): DailyInput {
  const day: OperatingDay = { revision, state: "closed", closedLocal: null, closedAt: null, history, proposal: null, summary,
    data: { sales, posCash: sales, card: 0, orders: 10, entries: [], cancellations: [] } };
  return { branch: { code: "maarif", nameAr: "المعاريف", nameEn: "Maarif" }, period: { mode: "day", date: "2026-11-02" }, includeDrafts: false,
    report: { basis: 9, hasDays: true, day: null,
      branch: { today: "2026-11-05", local: "", timezone: "Africa/Casablanca", cutoff: "02:00", nameAr: "المعاريف", nameEn: "Maarif" },
      days: [{ date: "2026-11-01", state: "closed", sales: 10000, orders: 1, card: 0, summary },
        { date: "2026-11-02", state: "closed", sales, orders, card: 0, summary }] },
    details: { "2026-11-02": day } };
}

describe("Daily Sales says when included sales have no order count", () => {
  const note = (input: DailyInput) => JSON.stringify(buildDailySales({ ...input, period: { mode: "month", month: "2026-11" } })).includes("ds.ordersMissing");
  it("adds the warning only then", () => {
    expect(note(daily([], 1, null))).toBe(true);
    expect(note(daily([], 1, 3))).toBe(false);
    expect(note(daily([], 1, null, 0))).toBe(false); // no sales: the average is unaffected
  });
});

describe("the exported revision is the one the figures come from", () => {
  it("skips a pending or rejected proposal and keeps an approved correction", () => {
    const closed = step(4, "close");
    expect(effectiveRevision(daily([step(5, "propose"), closed], 5, 1).details["2026-11-02"]!)).toBe(4);
    expect(effectiveRevision(daily([step(6, "reject"), step(5, "propose"), closed], 6, 1).details["2026-11-02"]!)).toBe(4);
    expect(effectiveRevision(daily([step(6, "approve"), step(5, "propose"), closed], 6, 1).details["2026-11-02"]!)).toBe(6);
    const sheet = buildDailyLedger(daily([step(5, "propose"), closed], 5, 1)).sheets[0]!;
    const kv = sheet.blocks.find((b) => b.kind === "kv") as { rows: Array<Array<{ k?: string; v?: unknown }>> };
    expect(kv.rows.find((r) => r[0]!.k === "common.revision")![1]).toEqual({ t: "int", v: 4 });
  });
});

describe("the page cross-check with a zero forecast and consumption already posted today", () => {
  it("does not report a false difference", () => {
    const WED = "2026-11-18";
    const f = (n: number) => ({ num: String(n), den: "1" });
    const observations = (weekday: number) => ({ weekday, complete: 3, missing: 10, before_live: 0, total: f(0), average: f(0), sufficient: true, forecast: f(0),
      dates: weekdayDates(WED, weekday).map((date, i, all) => (i >= all.length - 4 && i < all.length - 1
        ? { date, status: "complete" as const, demand: f(0) } : { date, status: "missing" as const, demand: null })) });
    // As app_private.replenishment_item_plan answers: today is not fully posted, its forecast is 0 and some is
    // already posted, so the day is "forecast_remaining" with nothing remaining.
    const item = { item_id: "x", name_ar: "x", name_en: null, kind: "ingredient", base_unit: "pc", status: "recommend", review_reasons: [], source: null,
      lead_days: 1, lead_rule: "source_setting", order_date: WED, expected: "2026-11-19", default_expected: "2026-11-19", window_end: "2026-11-19",
      today_posted: false, on_hand: f(7), coverage: [{ date: "2026-11-19", observations: observations(4) }],
      bridge: [{ date: WED, weekday: 3, incoming: f(0), opening: f(7), consumption: f(0), basis: "forecast_remaining", observations: observations(3), closing: f(7) }],
      usable: f(7), incoming: [], eligible_incoming: f(0), forecast: f(0), safety: f(0), safety_percent: 20, raw: f(-7), recommended: f(0),
      constraints: [], suggested: f(0), settings: { pack: null, min_order: null, shelf_life_days: null, cutoff: null, revision: 1 }, warnings: [], history: null,
    } as unknown as ItemPlanJson;
    expect(verifyItemPlan({ coverage_days: 1, min_observations: 3, live_from: "2026-08-01" }, item).mismatches).toEqual([]);
  });
});
