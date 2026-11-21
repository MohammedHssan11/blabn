import "server-only";
import type { BranchSettings } from "@/modules/access/branches";
import type { BusinessDay, CashCount, CashMovement, ComparisonFigure } from "@/modules/closing/types";
import { loadFixtures } from "./fixtures";

/**
 * Read access to saved records. Phase 2 serves the synthetic fixtures. The
 * Supabase-backed implementation replaces it in Phase 4 behind the same
 * interface, with row-level security from Phase 3, so no screen or calculation
 * changes when the data source does.
 */
export interface OperationsRepository {
  readonly source: "synthetic-fixtures";
  readonly dataVersion: string;
  listBranches(): Promise<BranchSettings[]>;
  getBranch(code: string): Promise<BranchSettings | undefined>;
  listBusinessDays(branchCode?: string): Promise<BusinessDay[]>;
  listCashMovements(branchCode: string, businessDate?: string): Promise<CashMovement[]>;
  listCashCounts(branchCode: string, businessDate?: string): Promise<CashCount[]>;
  listComparisonFigures(): Promise<ComparisonFigure[]>;
}

export function createFixtureRepository(): OperationsRepository {
  const data = loadFixtures();
  return {
    source: "synthetic-fixtures",
    dataVersion: data.version,
    async listBranches() {
      return data.branches;
    },
    async getBranch(code) {
      return data.branches.find((b) => b.code === code);
    },
    async listBusinessDays(branchCode) {
      return data.businessDays.filter((d) => !branchCode || d.branchCode === branchCode);
    },
    async listCashMovements(branchCode, businessDate) {
      return data.cashMovements.filter(
        (m) => m.branchCode === branchCode && (!businessDate || m.businessDate === businessDate),
      );
    },
    async listCashCounts(branchCode, businessDate) {
      return data.cashCounts.filter(
        (c) => c.branchCode === branchCode && (!businessDate || c.businessDate === businessDate),
      );
    },
    async listComparisonFigures() {
      return data.comparisonFigures;
    },
  };
}

let repository: OperationsRepository | undefined;
export function getRepository(): OperationsRepository {
  repository ??= createFixtureRepository();
  return repository;
}
