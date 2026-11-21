import raw from "@docs/phase1/field-map.json";

/**
 * The reviewed Phase 1 report field map (docs/phase1/field-map.json) is the
 * single source for field definitions. The application reads it directly so a
 * displayed value can always be traced back to its legacy cell, source record,
 * unit, date basis, rounding rule, blank behaviour and any open decision.
 */
export interface FieldDef {
  id: string;
  report: string;
  field_en: string;
  field_ar: string;
  legacy_location: string;
  meaning: string;
  source_record: string;
  unit: string;
  date_basis: string;
  rounding: string;
  blank_behaviour: string;
  findings: string[];
  pending_on: string[];
  status: string;
  waiting_for_answer: string[];
  contested_without_agreed_rule: string[];
  implemented_in: string;
}

export const FIELD_MAP: readonly FieldDef[] = (raw as unknown as { fields: FieldDef[] }).fields;
export const FIELD_MAP_FINDINGS_VERSION: string = (raw as unknown as { findings_version: string })
  .findings_version;

const byId = new Map(FIELD_MAP.map((field) => [field.id, field]));

export function getField(id: string): FieldDef | undefined {
  return byId.get(id);
}

export function requireField(id: string): FieldDef {
  const field = byId.get(id);
  if (!field) throw new Error(`Unknown report field ${id}`);
  return field;
}

/**
 * Phase in which each still-open question must be answered (HANDOFF.md,
 * "Questions for Abdo"; docs/phase1/CLOSURE.md). Fields that depend on one of
 * these stay marked until that phase.
 */
export const DECISION_PHASE: Readonly<Record<string, number>> = {
  "P1-19": 4,
  "P1-24": 6,
  "P1-28": 5,
  "P1-29": 5,
  "P1-31": 5,
  "P1-32": 5,
  "P1-33": 11,
  "P1-35": 8,
};

/** The phase a pending field is waiting for, or null when the field is settled. */
export function awaitingPhase(field: FieldDef): number | null {
  if (!field.status.startsWith("pending")) return null;
  const phases = field.pending_on
    .map((finding) => DECISION_PHASE[finding])
    .filter((phase): phase is number => typeof phase === "number");
  if (phases.length > 0) return Math.min(...phases);
  const fromPlan = /Phase\s+(\d+)/.exec(field.implemented_in);
  return fromPlan ? Number(fromPlan[1]) : null;
}

export function isPending(field: FieldDef): boolean {
  return field.status.startsWith("pending");
}
