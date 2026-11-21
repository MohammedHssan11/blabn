/**
 * Report contracts for Phase 2 (docs/phase2/REPORT_CONTRACTS.md), as data.
 * Each prototype lists the report fields it shows; tests check that every value
 * a page produces is traced to one of these fields and that each field exists
 * in the reviewed Phase 1 field map.
 */
export type PrototypeId = "dailyClose" | "cashCount" | "comparison";

export const PROTOTYPE_FIELDS: Readonly<Record<PrototypeId, readonly string[]>> = {
  dailyClose: [
    "DS-01", "DS-02", "DS-03", "DS-04", "DS-05", "DS-06", "DS-07", "DS-08", "DS-09", "DS-10", "DS-11",
    "ST-02", "ST-03",
  ],
  cashCount: ["ST-02", "ST-03", "ST-04", "ST-05", "ST-06", "ST-07", "ST-08", "LG-06"],
  comparison: ["CMP-05", "CMP-06", "CMP-07", "CMP-08"],
};

/** Fields the prototypes name but deliberately do not fill in: they wait for a later-phase decision. */
export const PENDING_IN_PROTOTYPES: Readonly<Record<PrototypeId, readonly string[]>> = {
  dailyClose: [],
  cashCount: ["ST-09", "LG-08"],
  comparison: [],
};

export function prototypesUsing(fieldId: string): PrototypeId[] {
  return (Object.keys(PROTOTYPE_FIELDS) as PrototypeId[]).filter(
    (id) => PROTOTYPE_FIELDS[id].includes(fieldId) || PENDING_IN_PROTOTYPES[id].includes(fieldId),
  );
}

/** Reference examples fixed by the report contracts, asserted in tests. */
export const CONTRACT_EXAMPLES = {
  cashCount: { netSales: 100000, orders: 10, card: 30000, cashExpenses: 10000, counted: 60300, expected: 60000, variance: 300 },
  averageOrder: { sales: 100000, orders: 10, average: 10000 },
  weeklyRatio: { current: 12000, prior: 10000, ratioBp: 12000 },
} as const;
