import type { PermissionKey } from "@/modules/access/catalog";
import { ALL_BRANCH_CODES, OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { isBusinessDate, isMonth } from "@/lib/dates";
import type { Family } from "./model";

/**
 * The five report families, their periods and the permissions they need. The same rules are in the
 * database (`app_private.report_export_requirements` and `report_export_period`, migration
 * 20261126090000); tests/exports.test.ts reads the migration and checks that both say the same.
 */
export const FAMILIES: readonly Family[] = ["sales_comparison", "daily_sales", "daily_statement", "daily_ledger", "inventory"];

export const isFamily = (value: unknown): value is Family => typeof value === "string" && (FAMILIES as readonly string[]).includes(value);

/** Families whose period may be one business day; every family accepts a month. */
export const DAY_FAMILIES: readonly Family[] = ["daily_statement", "daily_ledger", "inventory"];
/** Families that may include days that are not closed, for a person allowed draft exports. */
export const DRAFT_FAMILIES: readonly Family[] = ["daily_sales", "daily_statement", "daily_ledger"];

export type Period =
  | { mode: "month"; month: string }
  | { mode: "day"; date: string }
  | { mode: "week"; current: string; prior: string };

/** The permissions a family needs, for EVERY branch the export covers. */
export function familyPermissions(family: Family, includeDrafts: boolean): PermissionKey[] {
  switch (family) {
    case "sales_comparison":
      return ["comparison.export"];
    case "inventory":
      return ["reports.export", "inventory.view"];
    case "daily_sales":
    case "daily_statement":
    case "daily_ledger":
      return ["reports.export", "daily_close.view", ...(includeDrafts ? (["daily_close.export_draft"] as const) : [])];
  }
}

export function exportRequirements(family: Family, branches: readonly string[], includeDrafts: boolean) {
  return branches.flatMap((branch) => familyPermissions(family, includeDrafts).map((permission) => ({ permission, branch })));
}

/** Branches in the report order (Al Quds, Maarif, Bourgogne). Only the comparison covers more than Maarif. */
export function orderedBranches(codes: readonly string[]): string[] {
  return ALL_BRANCH_CODES.filter((code) => codes.includes(code));
}

const sameWeekday = (a: string, b: string) => new Date(`${a}T00:00:00Z`).getUTCDay() === new Date(`${b}T00:00:00Z`).getUTCDay();

/** Validates a request before it reaches the database (which validates it again). */
export function validateRequest(input: {
  family: unknown; branches: readonly string[]; period: Period | null; includeDrafts: boolean; today: string;
}): { ok: true; family: Family; branches: string[]; period: Period } | { ok: false } {
  const { family, period, includeDrafts, today } = input;
  if (!isFamily(family) || !period) return { ok: false };
  const branches = orderedBranches(input.branches);
  if (branches.length === 0 || branches.length !== input.branches.length || new Set(input.branches).size !== input.branches.length) return { ok: false };
  if (family !== "sales_comparison" && (branches.length !== 1 || branches[0] !== OPERATING_BRANCH_CODE)) return { ok: false };
  if (includeDrafts && !DRAFT_FAMILIES.includes(family)) return { ok: false };
  if (period.mode === "month") {
    if (!isMonth(period.month) || period.month < "2000-02" || period.month > today.slice(0, 7)) return { ok: false };
  } else if (period.mode === "day") {
    if (!DAY_FAMILIES.includes(family) || !isBusinessDate(period.date) || period.date < "2000-01-01" || period.date > today) return { ok: false };
  } else {
    if (family !== "sales_comparison" || !isBusinessDate(period.current) || !isBusinessDate(period.prior)) return { ok: false };
    if (period.prior >= period.current || !sameWeekday(period.prior, period.current) || period.prior < "2000-01-01" || period.current > today) return { ok: false };
  }
  return { ok: true, family, branches, period };
}

export function periodLabel(period: Period): string {
  return period.mode === "month" ? period.month : period.mode === "day" ? period.date : `${period.current} vs ${period.prior}`;
}

/** File name of an export: ASCII only (the Content-Disposition header and every operating system accept it). */
export function exportFileName(family: Family, branches: readonly string[], period: Period, locale: "ar" | "en", draft: boolean): string {
  const span = period.mode === "week" ? `${period.current}-vs-${period.prior}` : period.mode === "month" ? period.month : period.date;
  return `${family.replaceAll("_", "-")}-${branches.join("-")}-${span}-${locale}${draft ? "-draft" : ""}.xlsx`;
}
