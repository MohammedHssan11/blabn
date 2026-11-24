import type { Family } from "./model";

/**
 * Versions recorded with every export.
 *
 * TEMPLATE_VERSIONS: the layout of each family (sheets, columns, labels, number formats). A change to
 * a template changes its fingerprint (tests/exports.test.ts recomputes it from the template spec and
 * the labels it uses) and must come with a new version here, so an earlier file's layout stays
 * identifiable from its record.
 *
 * CALC_RULES_VERSION: the calculation rules the workbook applies on top of the saved values
 * (docs/phase9/EXCEL_REPORTS.md, "Calculation rules"). Change it with any rule.
 */
export const TEMPLATE_VERSIONS: Readonly<Record<Family, string>> = {
  sales_comparison: "sales_comparison@1.0.0",
  daily_sales: "daily_sales@1.0.0",
  daily_statement: "daily_statement@1.0.0",
  daily_ledger: "daily_ledger@1.0.0",
  inventory: "inventory@1.0.0",
};

/** Pinned fingerprints of the template specs (see tests/exports.test.ts, "templates are versioned"). */
export const TEMPLATE_FINGERPRINTS: Readonly<Record<Family, string>> = {
  sales_comparison: "c533827f4b114c5b",
  daily_sales: "c7d72a3df701aa66",
  daily_statement: "ad10f5157dd175bd",
  daily_ledger: "f27610f32906a655",
  inventory: "403a37dcca648b93",
};

export const CALC_RULES_VERSION = "p9-calc-2026.11.24";
