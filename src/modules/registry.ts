/**
 * The application areas from docs/IMPLEMENTATION_PLAN.md ("Proposed code and
 * database structure"). `src/modules/<key>` holds each area's code; the phase is
 * when it is built. Phase 2 provides the structure only, except for the daily
 * close, cash count and comparison prototypes.
 */
export const MODULES = [
  { key: "access", phase: 3 },
  { key: "closing", phase: 4 },
  { key: "ledgers", phase: 4 },
  { key: "catalog", phase: 5 },
  { key: "inventory", phase: 6 },
  { key: "comparisons", phase: 7 },
  { key: "replenishment", phase: 8 },
  { key: "reports", phase: 9 },
  { key: "attendance", phase: 13 },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
