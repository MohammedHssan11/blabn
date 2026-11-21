import raw from "@fixtures/synthetic/phase2.json";
import type { BranchSettings } from "@/modules/access/branches";
import type { BusinessDay, CashCount, CashMovement, ComparisonFigure } from "@/modules/closing/types";
import { toMinor, toMinorOrBlank } from "@/lib/money";

/**
 * Synthetic Phase 2 fixtures (fixtures/synthetic/phase2.json). The same file
 * generates supabase/seed.sql, so the prototypes and the database baseline
 * always describe the same invented records.
 */
export interface FixtureData {
  version: string;
  organization: { id: string; name: string };
  branches: BranchSettings[];
  businessDays: BusinessDay[];
  cashMovements: CashMovement[];
  cashCounts: CashCount[];
  comparisonFigures: ComparisonFigure[];
}

type Raw = typeof raw;

export function loadFixtures(source: Raw = raw): FixtureData {
  return {
    version: source.version,
    organization: source.organization,
    branches: source.branches.map((b) => ({
      id: b.id,
      code: b.code,
      nameEn: b.name_en,
      nameAr: b.name_ar,
      timezone: b.timezone,
      businessDayRollover: b.business_day_rollover,
      operatesInApp: b.operates_in_app,
    })),
    businessDays: source.business_days.map((d) => ({
      id: d.id,
      branchCode: d.branch_code,
      businessDate: d.business_date,
      status: d.status as BusinessDay["status"],
      closedAt: d.closed_at,
      netSales: toMinorOrBlank(d.net_sales),
      orderCount: d.order_count,
      cardAmount: toMinorOrBlank(d.card_amount),
      openingCash: toMinorOrBlank(d.opening_cash),
      revision: d.revision,
    })),
    cashMovements: source.cash_movements.map((m) => ({
      id: m.id,
      branchCode: m.branch_code,
      businessDate: m.business_date,
      kind: m.kind as CashMovement["kind"],
      amount: toMinor(m.amount),
      occurredAt: m.occurred_at,
      note: m.note,
    })),
    cashCounts: source.cash_counts.map((c) => ({
      id: c.id,
      branchCode: c.branch_code,
      businessDate: c.business_date,
      countedAmount: toMinor(c.counted_amount),
      countedAt: c.counted_at,
      expectedCash: toMinorOrBlank(c.expected_cash),
      variance: toMinorOrBlank(c.variance),
      calcVersion: c.calc_version,
    })),
    comparisonFigures: source.comparison_figures.map((f) => ({
      id: f.id,
      branchCode: f.branch_code,
      businessDate: f.business_date,
      netSales: toMinorOrBlank(f.net_sales),
      orderCount: f.order_count,
      source: f.source as ComparisonFigure["source"],
    })),
  };
}
