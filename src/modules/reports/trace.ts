/**
 * Every value shown in a prototype carries a trace: the report field ID from the
 * Phase 1 field map and/or the saved record it came from. The view renders the
 * trace beside the value (and as data attributes) so a reviewer can follow any
 * figure back to its definition.
 */
export interface Trace {
  /** Field ID in docs/phase1/field-map.json, e.g. "DS-04". */
  field?: string;
  /** Saved record(s) the value was read from or calculated from. */
  record?: string;
}

export interface Traced<T> {
  value: T;
  trace: Trace;
}

export function traced<T>(value: T, trace: Trace): Traced<T> {
  return { value, trace };
}

export const recordRef = {
  businessDay: (branch: string, date: string) => `business_days:${branch}:${date}`,
  cashMovements: (branch: string, date: string) => `cash_movements:${branch}:${date}`,
  cashCount: (branch: string, date: string) => `cash_counts:${branch}:${date}`,
  comparisonFigure: (branch: string, date: string) => `comparison_figures:${branch}:${date}`,
};

/** Collect every trace in a (possibly nested) view model, for tests and audits. */
export function collectTraces(node: unknown, found: Trace[] = []): Trace[] {
  if (Array.isArray(node)) {
    node.forEach((item) => collectTraces(item, found));
  } else if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if ("value" in record && "trace" in record && typeof record.trace === "object") {
      found.push(record.trace as Trace);
    }
    Object.values(record).forEach((child) => collectTraces(child, found));
  }
  return found;
}
