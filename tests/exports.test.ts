import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { LABELS, type LabelKey } from "@/modules/exports/labels";
import { exportFileName, exportRequirements, FAMILIES, familyPermissions, validateRequest } from "@/modules/exports/families";
import { canonicalJson, dataFingerprint, valueCells, type SheetModel, type WorkbookModel } from "@/modules/exports/model";
import { buildDailyLedger, buildDailySales, buildDailyStatement, type DailyInput } from "@/modules/exports/build/daily";
import { buildComparison } from "@/modules/exports/build/comparison";
import { buildInventory, type InventoryInput } from "@/modules/exports/build/inventory";
import { buildAbout } from "@/modules/exports/build/about";
import { fractionDecimal, labelKeysOf, renderWorkbook } from "@/modules/exports/xlsx";
import { numericValues, scanWorkbook } from "@/modules/exports/scan";
import { TEMPLATE_FINGERPRINTS, TEMPLATE_VERSIONS } from "@/modules/exports/versions";
import { figureKey, weeklyComparison, monthlyComparison, type BranchInfo, type ComparisonData, type Figure } from "@/modules/comparisons/calc";
import type { OperatingDay, OperatingReport, OperatingSummary } from "@/modules/closing/operations";
import type { StockItemDay } from "@/modules/inventory/stock";

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = readFileSync(path.join(ROOT, "supabase/migrations/20261126090000_phase9_report_exports.sql"), "utf8");

// ------------------------------------------------------------------ synthetic fixtures (no workbook figure)

const MAARIF = { code: "maarif", nameAr: "المعاريف", nameEn: "Maarif" };

function summary(over: Partial<OperatingSummary> = {}): OperatingSummary {
  return { openingCash: 0, closingCash: 60300, openingCustody: 0, closingCustody: 0, expenses: 10000, receipts: 0, remittances: 0,
    custodyReceipts: 0, custodyExpenses: 0, expected: 60000, variance: 300, statementTotal: 100300, average: 10000, cardRatio: 3000,
    remittanceRatio: 0, ...over };
}

function day(date: string, state: OperatingDay["state"], over: Partial<OperatingDay["data"]> = {}, sum: Partial<OperatingSummary> = {}): OperatingDay {
  return {
    revision: 3, state, closedLocal: null, closedAt: null, history: [], proposal: null, summary: summary(sum),
    data: {
      sales: 100000, morning: 40000, evening: 60000, posCash: 70000, card: 30000, orders: 10, shift: "both", notes: "",
      cashier: { id: "c", name: "Synthetic Cashier", role: "cashier" },
      count: { counter: { id: "m", name: "Synthetic Manager", role: "manager" }, recorder: "m", recorderName: "Synthetic Manager",
        local: `${date}T22:00`, total: 60300, quantities: { "20000": 3, "100": 3, "50": 0 } },
      entries: [
        { id: "e1", kind: "cash_expense", amount: 10000, local: `${date}T12:00`, account: "E01 · Supplies", reference: null, note: "=HYPERLINK(\"http://x.invalid\")" },
        { id: "e2", kind: "remittance", amount: 60300, local: `${date}T23:30`, account: null, reference: "BANK-1", note: "" },
        { id: "e3", kind: "cash_expense", amount: 999, local: `${date}T13:00`, account: null, reference: null, note: "reversed", reversedBy: "x" },
      ],
      cancellations: [{ id: "k1", original: "+212600000000", originalAmount: 2500, originalLocal: `${date}T10:00`, replacement: null,
        replacementAmount: null, local: `${date}T10:05`, note: "@customer request" }],
      ...over,
    },
  };
}

function dailyInput(period: DailyInput["period"], includeDrafts = false): DailyInput {
  const closed = day("2026-11-02", "closed");
  const draft = day("2026-11-03", "draft", { sales: 50000, orders: 4, card: 0 }, { average: 12500, cardRatio: 0 });
  const zero = day("2026-11-04", "closed", { sales: 0, orders: 0, card: 0 }, { average: null, cardRatio: null, expenses: 0 });
  const report: OperatingReport = {
    basis: 41, hasDays: true, day: null,
    branch: { today: "2026-11-05", local: "2026-11-05T10:00", timezone: "Africa/Casablanca", cutoff: "02:00", nameAr: "المعاريف", nameEn: "Maarif" },
    days: [
      { date: "2026-11-02", state: "closed", sales: 100000, orders: 10, card: 30000, summary: summary({ remittances: 60300, remittanceRatio: 6030 }) },
      { date: "2026-11-03", state: "draft", sales: 50000, orders: 4, card: 0, summary: summary({ average: 12500, cardRatio: 0 }) },
      { date: "2026-11-04", state: "closed", sales: 0, orders: 0, card: 0, summary: summary({ average: null, cardRatio: null, expenses: 0 }) },
      { date: "2026-11-05", state: "corrected", sales: 30000, orders: 2, card: 30000, summary: summary({ average: 15000, cardRatio: 10000 }) },
    ],
  };
  return { branch: MAARIF, period, includeDrafts, report,
    details: { "2026-11-02": closed, "2026-11-03": draft, "2026-11-04": zero, "2026-11-05": day("2026-11-05", "corrected") } };
}

function branch(code: string, nameEn: string, nameAr: string, operatesInApp = false): BranchInfo {
  return { code, nameEn, nameAr, operatesInApp, liveFrom: null, liveFromBasis: null, today: "2026-11-30", liveSource: null, liveSourceEn: null, liveSourceAr: null, entryOwner: null };
}

function comparisonData(values: Array<[string, string, number | null, number | null, Figure["purpose"]?]>): ComparisonData {
  const figures = new Map<string, Figure>();
  for (const [b, d, sales, orders, purpose = "live"] of values) {
    const base = { origin: b === "maarif" ? "closed_day" : "entry", source: b === "maarif" ? "daily_close" : "reporting_only", sourceLabelEn: null,
      sourceLabelAr: null, purpose, record: `${b}:${d}`, revision: 1, reference: purpose === "historical" ? "SYN-REF-1" : "", actor: "", recordedAt: null } as const;
    if (sales !== null) figures.set(figureKey(b, d, "net_sales"), { ...base, value: sales });
    if (orders !== null) figures.set(figureKey(b, d, "order_count"), { ...base, value: orders });
  }
  return { branches: [branch("alquds", "Al Quds", "القدس"), branch("maarif", "Maarif", "المعاريف", true), branch("bourgogne", "Bourgogne", "بورجون")], figures };
}

const q = (num: string, den = "1") => ({ num, den, decimal: fractionDecimal(num, den).text, exact: fractionDecimal(num, den).exact });

function stockItem(id: string, over: Partial<StockItemDay> = {}): StockItemDay {
  return { item_id: id, name_ar: `مكون ${id}`, name_en: `Component ${id}`, kind: "ingredient", section: null, base_unit: "kg", schedule: "daily",
    opening: q("10"), movements: { receipt: q("5"), consumption: q("-4") }, expected: q("11"), count: null, expected_at_count: null,
    variance: null, status: "missing", ...over };
}

function inventoryInput(period: InventoryInput["period"]): InventoryInput {
  const items = [
    stockItem("A", { count: { id: "c1", local: "2026-11-02T23:00", quantity: q("10"), entered: "10", unit: "kg" }, expected_at_count: q("11"), variance: q("-1"), status: "counted" }),
    stockItem("B", { opening: q("1", "3"), movements: {}, expected: q("1", "3"), count: { id: "c2", local: "2026-11-02T23:00", quantity: q("0"), entered: "0", unit: "kg" },
      expected_at_count: q("1", "3"), variance: q("-1", "3"), status: "counted" }),
    stockItem("C", { kind: "packaging", schedule: "monthly", movements: {}, expected: q("10"), status: "not_due" }),
  ];
  return {
    period, today: "2026-11-03",
    stock: [{ date: "2026-11-02", month_end: false, items, adjustments: [], today: "2026-11-03", local: "" },
      { date: "2026-11-03", month_end: false, items: items.map((i) => ({ ...i, opening: i.expected, movements: {}, count: null, variance: null, expected_at_count: null, status: i.kind === "packaging" ? "not_due" : "missing" })), adjustments: [], today: "2026-11-03", local: "" }],
    mixes: [{ date: "2026-11-02", report: { id: "r", net_sales: 100000, local: "2026-11-02T23:30", state: "locked", version: 2 },
      reconciliation: { ok: true, problems: [], sections_total: 100000, lines_total: 100000, close_sales: 100000 },
      sections: [{ no: 1, label: "دنيا الرز", total: 100000, lines: [
        { no: 1, id: "l1", label: "Synthetic cake", quantity: "3", amount: 60000, check: null,
          posted: { id: "p", recipe_version: "v", version_no: 1, posting: "x", components: [{ item_id: "A", name_ar: "مكون A", name_en: "Component A", quantity: q("4"), stock_tracked: true }] } },
        { no: 2, id: "l2", label: "Synthetic drink", quantity: "1", amount: 40000, posted: null, check: { status: "blocked", reasons: [{ code: "recipe_not_approved" }], recipe: null } },
      ] }] },
    { date: "2026-11-03", report: { id: "r2", net_sales: 5000, local: "", state: "draft", version: 1 } }],
    orders: [{ id: "o", order_no: 7, origin: "app", status: "approved", business_date: "2026-11-01", created_at: "", created_local: "2026-11-01T21:00",
      created_by: "S", decided_by: "A", decided_at: null, decided_local: null, decision_note: null, note: null, source_file: null, source_cell: null,
      original_expected: { date: "2026-11-03", kind: "default", rule: "plus_2", source_value: null },
      expected: { date: "2026-11-03", kind: "default", revision: 1, reason: null }, receipt_dates: ["2026-11-02"], lines_count: 1, open_lines: 1,
      lines: [{ id: "x", line_no: 1, item_id: "A", name_ar: "مكون A", name_en: "Component A", source: "factory", unit: "kg", quantity: "10",
        final: q("10"), base_unit: "kg", final_base: q("10"), suggested: null, override_reason: null, plan: null, received: q("4"), cancelled: q("0"), outstanding: q("6"), cancellations: [] }] }],
    units: [{ code: "kg", name_ar: "كيلو جرام", name_en: "Kilogram" }],
  };
}

const about = (model: WorkbookModel) => buildAbout(model, { exportId: "00000000-0000-4000-8000-000000000001", branches: [MAARIF], period: "2026-11",
  requester: "=cmd|' /C calc'!A0", requestedLocal: "2026-11-05T10:00", snapshotLocal: "2026-11-05T10:00:01", templateVersion: TEMPLATE_VERSIONS[model.family],
  calcVersion: "test", fingerprint: dataFingerprint(model), sources: [{ label: "about.source.operatingBasis", value: "41" }] });

async function render(model: WorkbookModel, locale: "ar" | "en") {
  return renderWorkbook(model, about(model), { locale, title: "Synthetic & test", created: new Date("2026-11-05T10:00:00Z"), exportId: "00000000-0000-4000-8000-000000000001" });
}

function allModels(): WorkbookModel[] {
  const weekly = weeklyComparison(comparisonData([["alquds", "2026-11-17", 15000, 5, "live"], ["alquds", "2026-11-10", 10000, 4],
    ["maarif", "2026-11-17", 10000, 3], ["maarif", "2026-11-10", 20000, 6], ["bourgogne", "2026-11-10", 5000, 2, "historical"]]), "2026-11-17", "2026-11-10");
  const monthData = comparisonData([["maarif", "2026-11-02", 12000, 3], ["maarif", "2026-10-02", 10000, 3]]);
  monthData.branches.splice(0, 3, monthData.branches[1]!);
  const monthly = monthlyComparison(monthData, "2026-11");
  const branches = comparisonData([]).branches;
  return [
    buildComparison({ mode: "weekly", branches, result: weekly }),
    buildComparison({ mode: "monthly", branches: monthData.branches, result: monthly }),
    buildDailySales(dailyInput({ mode: "month", month: "2026-11" })),
    buildDailyStatement(dailyInput({ mode: "month", month: "2026-11" })),
    buildDailyLedger(dailyInput({ mode: "month", month: "2026-11" })),
    buildInventory(inventoryInput({ mode: "day", date: "2026-11-02" })),
    buildInventory(inventoryInput({ mode: "month", month: "2026-11" })),
  ];
}

function table(model: WorkbookModel, sheetKey: string, index = 0) {
  const sheet = model.sheets.find((s) => s.key === sheetKey)!;
  return sheet.blocks.filter((b) => b.kind === "table")[index] as Extract<SheetModel["blocks"][number], { kind: "table" }>;
}

// ------------------------------------------------------------------ tests

describe("labels", () => {
  it("every label has Arabic and English text with the same placeholders", () => {
    for (const [key, value] of Object.entries(LABELS)) {
      expect(value.ar.trim(), key).not.toBe("");
      expect(value.en.trim(), key).not.toBe("");
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph(value.ar), key).toEqual(ph(value.en));
    }
  });

  it("the templates only use known labels", () => {
    for (const model of allModels()) {
      for (const key of labelKeysOf([...model.sheets, about(model)])) expect(LABELS[key as LabelKey], key).toBeDefined();
    }
  });
});

describe("families, periods and permissions", () => {
  it("the permissions match the database (report_export_requirements)", () => {
    const sql = /create function app_private\.report_export_requirements[\s\S]*?\$\$;/.exec(MIGRATION)![0];
    for (const family of FAMILIES) {
      const line = new RegExp(`when '${family}' then (.*)`).exec(sql)![1]!;
      const listed = [...line.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
      expect(listed, family).toEqual([...familyPermissions(family, true)]);
      expect(familyPermissions(family, false)).toEqual(familyPermissions(family, true).filter((p) => p !== "daily_close.export_draft"));
    }
  });

  it("the comparison needs comparison.export for EVERY selected branch", () => {
    expect(exportRequirements("sales_comparison", ["alquds", "maarif", "bourgogne"], false)).toEqual([
      { permission: "comparison.export", branch: "alquds" }, { permission: "comparison.export", branch: "maarif" },
      { permission: "comparison.export", branch: "bourgogne" }]);
    expect(exportRequirements("daily_ledger", ["maarif"], true).map((r) => r.permission)).toEqual(["reports.export", "daily_close.view", "daily_close.export_draft"]);
  });

  it("validates families, branches and periods like the database", () => {
    const ok = (family: string, branches: string[], period: Parameters<typeof validateRequest>[0]["period"], drafts = false) =>
      validateRequest({ family, branches, period, includeDrafts: drafts, today: "2026-11-24" }).ok;
    expect(ok("sales_comparison", ["bourgogne", "alquds"], { mode: "week", current: "2026-11-17", prior: "2026-11-10" })).toBe(true);
    expect(ok("sales_comparison", ["maarif"], { mode: "week", current: "2026-11-17", prior: "2026-11-11" })).toBe(false); // not the same weekday
    expect(ok("sales_comparison", ["maarif"], { mode: "week", current: "2026-11-10", prior: "2026-11-17" })).toBe(false);
    expect(ok("daily_sales", ["maarif"], { mode: "month", month: "2026-11" })).toBe(true);
    expect(ok("daily_sales", ["maarif"], { mode: "month", month: "2026-12" })).toBe(false); // future
    expect(ok("daily_sales", ["maarif"], { mode: "day", date: "2026-11-02" })).toBe(false); // month only
    expect(ok("daily_sales", ["alquds"], { mode: "month", month: "2026-11" })).toBe(false); // operating branch only
    expect(ok("inventory", ["maarif"], { mode: "month", month: "2026-11" }, true)).toBe(false); // no draft inventory export
    expect(ok("daily_statement", ["maarif"], { mode: "day", date: "2026-11-02" }, true)).toBe(true);
    expect(ok("nope", ["maarif"], { mode: "month", month: "2026-11" })).toBe(false);
    expect(ok("sales_comparison", ["maarif", "maarif"], { mode: "month", month: "2026-11" })).toBe(false);
  });

  it("file names are plain ASCII", () => {
    expect(exportFileName("daily_ledger", ["maarif"], { mode: "day", date: "2026-11-02" }, "ar", true)).toBe("daily-ledger-maarif-2026-11-02-ar-draft.xlsx");
  });
});

describe("calculation rules from saved values", () => {
  it("Daily Sales: blank versus zero, drafts excluded, period average = total sales ÷ total orders, ratios on totals", () => {
    const model = buildDailySales(dailyInput({ mode: "month", month: "2026-11" }));
    const rows = table(model, "daily_sales").rows;
    expect(rows).toHaveLength(31); // 30 days of November and the total
    const [d1, d2, d3, d4, d5] = rows;
    expect(d1!.cells[2]).toEqual({ t: "money", v: null }); // no close: blank, not 0
    expect(d2!.cells[2]).toEqual({ t: "money", v: 100000 });
    expect(d2!.cells[4]).toEqual({ t: "money", v: 10000 }); // 1,000 / 10 = 100.00
    expect(d2!.cells[6]).toEqual({ t: "money", v: 60300 });
    expect(d3!.cells[2]).toEqual({ t: "money", v: null }); // draft not included in a final file
    expect(d3!.cells[10]).toEqual({ t: "label", k: "dayState.excluded_draft" });
    expect(d4!.cells[2]).toEqual({ t: "money", v: 0 }); // a recorded zero stays 0
    expect(d4!.cells[4]).toEqual({ t: "money", v: null }); // zero orders: no average
    expect(d5!.cells[10]).toEqual({ t: "label", k: "dayState.corrected" });
    const total = rows[30]!;
    // 100000 + 0 + 30000 = 130000 over 10 + 0 + 2 = 12 orders: 10833 (not the mean of the daily averages, 12500)
    expect(total.cells[2]).toEqual({ t: "money", v: 130000 });
    expect(total.cells[3]).toEqual({ t: "int", v: 12 });
    expect(total.cells[4]).toEqual({ t: "money", v: 10833 });
    expect(total.cells[9]).toEqual({ t: "ratio", v: 4615 }); // 60000 / 130000
    expect(total.cells[10]).toEqual({ t: "label", k: "common.daysIncluded", p: { n: 3, of: 5 } });
  });

  it("Daily Sales with drafts includes the draft day, marked", () => {
    const rows = table(buildDailySales(dailyInput({ mode: "month", month: "2026-11" }, true)), "daily_sales").rows;
    expect(rows[2]!.cells[2]).toEqual({ t: "money", v: 50000 });
    expect(rows[2]!.style).toBe("draft");
    expect(rows[30]!.cells[3]).toEqual({ t: "int", v: 16 });
  });

  it("Statement shows the saved reconciliation and the later remittance on its own line", () => {
    const model = buildDailyStatement(dailyInput({ mode: "day", date: "2026-11-02" }));
    expect(model.sheets).toHaveLength(1);
    const sheet = model.sheets[0]!;
    const kv = sheet.blocks.filter((b) => b.kind === "kv").at(-1) as Extract<SheetModel["blocks"][number], { kind: "kv" }>;
    const byKey = new Map(kv.rows.map((r) => [(r[0] as { k: string }).k, r[1]]));
    expect(byKey.get("st.countedCash")).toEqual({ t: "money", v: 60300 });
    expect(byKey.get("st.expected")).toEqual({ t: "money", v: 60000 });
    expect(byKey.get("st.variance")).toEqual({ t: "money", v: 300 });
    expect(byKey.get("st.laterRemittance")).toEqual({ t: "money", v: 60300 });
    expect(byKey.get("st.expensesAtCount")).toEqual({ t: "money", v: 10000 }); // 100300 − 60300 − 30000
    const lines = (sheet.blocks.find((b) => b.kind === "table") as Extract<SheetModel["blocks"][number], { kind: "table" }>).rows;
    expect(lines.some((r) => r.cells.some((c) => c.t === "text" && c.v === "reversed"))).toBe(false); // reversed entries are not effective
  });

  it("Yawmeya: cash ledger from opening to closing; cancellations hold no contact field", () => {
    const model = buildDailyLedger(dailyInput({ mode: "day", date: "2026-11-02" }));
    const cash = table(model, "2026-11-02", 0).rows;
    expect(cash[0]!.cells[3]).toEqual({ t: "money", v: 0 });
    expect(cash.at(-1)!.cells[3]).toEqual({ t: "money", v: 60300 });
    const cancellations = table(model, "2026-11-02", 3);
    expect(cancellations.header).toHaveLength(7);
    expect(cancellations.rows[0]!.cells[2]).toEqual({ t: "text", v: "+212600000000", user: true }); // order reference, literal text
  });

  it("Weekly comparison: the total ratio is summed current ÷ summed prior, with coverage", () => {
    const model = allModels()[0]!;
    const rows = table(model, "weekly").rows;
    expect(rows[0]!.cells[11]).toEqual({ t: "ratio", v: 15000 }); // Al Quds 150 %
    expect(rows[1]!.cells[11]).toEqual({ t: "ratio", v: 5000 }); // Maarif 50 %
    // Bourgogne has no current figure: blank, not 0
    expect(rows[2]!.cells[2]).toEqual({ t: "money", v: null });
    const total = rows[3]!;
    expect(total.cells[2]).toEqual({ t: "money", v: 25000 });
    expect(total.cells[11]).toEqual({ t: "ratio", v: null }); // different branches on the two dates: no total ratio
    expect(total.cells[13]).toMatchObject({ t: "label", k: "cmp.incomplete" });
  });

  it("Weekly comparison over the same branches: 250 vs 300 gives 83.33 %, not the mean of 150 % and 50 %", () => {
    const data = comparisonData([["alquds", "2026-11-17", 15000, 5], ["alquds", "2026-11-10", 10000, 4],
      ["maarif", "2026-11-17", 10000, 3], ["maarif", "2026-11-10", 20000, 6]]);
    data.branches.splice(2, 1);
    const model = buildComparison({ mode: "weekly", branches: data.branches, result: weeklyComparison(data, "2026-11-17", "2026-11-10") });
    expect(table(model, "weekly").rows.at(-1)!.cells[11]).toEqual({ t: "ratio", v: 8333 });
  });

  it("Monthly growth is kept separate (current ÷ prior − 1)", () => {
    const rows = table(allModels()[1]!, "monthly").rows;
    expect(rows[1]!.cells[13]).toEqual({ t: "ratio", v: 2000 });
  });

  it("Historical reporting-only figures are labelled with their reference", () => {
    const rows = table(allModels()[0]!, "weekly").rows;
    expect(rows[2]!.cells[14]).toEqual({ t: "label", k: "cmpSource.historical", p: { reference: "SYN-REF-1" } });
  });

  it("Inventory keeps exact quantities, blank versus counted zero, and three order dates", () => {
    const model = buildInventory(inventoryInput({ mode: "day", date: "2026-11-02" }));
    const stock = table(model, "stock").rows;
    expect(stock[0]!.cells.at(-2)).toEqual({ t: "qty", v: { num: "-1", den: "1" } }); // 10 counted − 11 expected
    expect(stock[1]!.cells.at(-3)).toEqual({ t: "qty", v: { num: "0", den: "1" } }); // counted zero
    expect(stock[1]!.cells.at(-2)).toEqual({ t: "qty", v: { num: "-1", den: "3" } });
    expect(stock[2]!.cells.at(-3)).toEqual({ t: "qty", v: null }); // not counted: blank
    expect(stock[0]!.cells[10]).toEqual({ t: "qty", v: { num: "4", den: "1" } }); // consumption shown as a positive quantity
    const orders = table(model, "orders").rows[0]!.cells;
    expect([orders[2], orders[4], orders[7]]).toEqual([{ t: "date", v: "2026-11-01" }, { t: "date", v: "2026-11-03" }, { t: "text", v: "2026-11-02" }]);
    const mix = table(model, "mix").rows;
    expect(mix[0]!.cells[4]).toEqual({ t: "ratio", v: 7500 }); // 3 of 4 sold
    const month = buildInventory(inventoryInput({ mode: "month", month: "2026-11" }));
    const dev = table(month, "deviation").rows.find((r) => r.cells[0]!.t === "name" && (r.cells[0] as { en: string }).en === "Component B")!;
    expect(dev.cells.at(-2)).toEqual({ t: "qty", v: { num: "-1", den: "3" } });
    expect(table(month, "mix").rows[1]!.cells[1]).toEqual({ t: "label", k: "inv.mixLocked" });
    expect(table(month, "mix").rows[2]!.cells[1]).toEqual({ t: "label", k: "inv.mixDraft" }); // an unlocked Product Mix is not included
  });

  it("fractions render exactly or with a note", () => {
    expect(fractionDecimal("1", "3")).toEqual({ value: 0.333333333, text: "0.333333333", exact: false });
    expect(fractionDecimal("-1", "8")).toEqual({ value: -0.125, text: "-0.125", exact: true });
  });
});

describe("workbooks", () => {
  it("Arabic and English contain the same figures and fingerprint; the scan finds values only", async () => {
    for (const model of allModels()) {
      const [ar, en] = await Promise.all([render(model, "ar"), render(model, "en")]);
      const [sa, se] = await Promise.all([scanWorkbook(ar, "ar"), scanWorkbook(en, "en")]);
      expect(sa.problems, model.family).toEqual([]);
      expect(se.problems, model.family).toEqual([]);
      expect(await numericValues(ar)).toEqual(await numericValues(en));
      expect(dataFingerprint(model)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("text a person typed stays literal text, never a formula", async () => {
    const bytes = await render(buildDailyStatement(dailyInput({ mode: "day", date: "2026-11-02" })), "en");
    const zip = await JSZip.loadAsync(bytes);
    const strings = await zip.file("xl/sharedStrings.xml")!.async("string");
    expect(strings).toContain("=HYPERLINK(");
    expect(strings).toContain("=cmd|");
    for (const name of Object.keys(zip.files).filter((n) => n.startsWith("xl/worksheets/sheet"))) {
      expect(await zip.file(name)!.async("string")).not.toMatch(/<f[\s>]/);
    }
    expect(Object.keys(zip.files).some((n) => n.includes("externalLink"))).toBe(false);
  });

  it("the scan refuses a formula, an error value and an external link", async () => {
    const good = await render(allModels()[2]!, "en");
    const zip = await JSZip.loadAsync(good);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    zip.file("xl/worksheets/sheet1.xml", sheet.replace("<v>1000</v>", "<f>SUM(A1)</f><v>1000</v>").replace(/<c r="A40"/, '<c r="A40" t="e"'));
    zip.file("xl/externalLinks/externalLink1.xml", "<externalLink/>");
    const bad = await zip.generateAsync({ type: "nodebuffer" });
    const result = await scanWorkbook(bad, "en");
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/formula/);
    expect(result.problems.join(" ")).toMatch(/external link/);
    expect((await scanWorkbook(good, "ar")).problems.join(" ")).toMatch(/not right-to-left/);
  });

  it("a 600-item month workbook stays small and fast", async () => {
    const input = inventoryInput({ mode: "month", month: "2026-11" });
    const many = Array.from({ length: 600 }, (_, i) => stockItem(`X${i}`));
    input.stock = Array.from({ length: 30 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, month_end: false, items: many, adjustments: [], today: "2026-11-30", local: "" }));
    input.today = "2026-11-30";
    const start = Date.now();
    const bytes = await render(buildInventory(input), "ar");
    expect(Date.now() - start).toBeLessThan(20000);
    expect(bytes.length).toBeLessThan(26214400); // the bucket's limit
    expect((await scanWorkbook(bytes, "ar")).ok).toBe(true);
  }, 60000);
});

describe("templates are versioned", () => {
  /** The layout of a family: sheet names, column labels (both languages), widths, fields and orientation. */
  function layout(family: string): string {
    const models = allModels().filter((m) => m.family === family);
    const spec = models.flatMap((m) => m.sheets.filter((s) => !/^\d{4}-/.test(s.key) || s.key === "2026-11-02").map((s) => ({
      name: s.name, landscape: s.landscape, widths: s.widths,
      tables: s.blocks.filter((b) => b.kind === "table").map((b) => (b as { header: unknown[]; fields?: unknown[] }).header.map((h) => {
        const k = (h as { k?: LabelKey }).k;
        return k ? [k, LABELS[k].ar, LABELS[k].en] : h;
      }).concat([(b as { fields?: unknown[] }).fields ?? []])),
    })));
    return createHash("sha256").update(canonicalJson(spec)).digest("hex").slice(0, 16);
  }

  it.each(FAMILIES)("%s matches its pinned fingerprint (bump TEMPLATE_VERSIONS when the layout changes)", (family) => {
    expect(TEMPLATE_VERSIONS[family]).toMatch(new RegExp(`^${family}@\\d+\\.\\d+\\.\\d+$`));
    expect(layout(family)).toBe(TEMPLATE_FINGERPRINTS[family]);
  });

  it("the model holds no language-specific text, so the fingerprint is the same in both languages", () => {
    for (const model of allModels()) {
      for (const cell of valueCells(model)) if (cell.t === "text" && !cell.user) expect(cell.v === null || /^[\x20-\x7E]*$/.test(cell.v), JSON.stringify(cell)).toBe(true);
    }
  });
});
