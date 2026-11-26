import { computePlan, eq, parseQ, q, ZERO, type Observation, type PlanResult, type Q } from "./planning";
import type { ItemPlanJson, ObservationsJson, PlanJson } from "./types";

/**
 * Recomputes one item of a database plan with the TypeScript rules and lists every figure that
 * differs. The planning pages show the result, so a disagreement between the two implementations
 * is visible on the page (and the end-to-end checks require none).
 */

function toObservations(json: ObservationsJson): Observation[] {
  return json.dates.map((d) => ({ date: d.date, status: d.status, demand: parseQ(d.demand) }));
}

export function planInput(plan: Pick<PlanJson, "coverage_days" | "min_observations" | "live_from">, item: ItemPlanJson) {
  const byWeekday = new Map<number, Observation[]>();
  for (const day of item.coverage) byWeekday.set(day.observations.weekday, toObservations(day.observations));
  for (const day of item.bridge) byWeekday.set(day.observations.weekday, toObservations(day.observations));
  for (const day of item.history ?? []) byWeekday.set(day.weekday, toObservations(day));
  const todayDemand = (() => {
    const today = byWeekday.get(item.bridge[0]?.observations.weekday ?? 0)?.find((o) => o.date === item.order_date);
    return today?.demand ?? null;
  })();
  return {
    orderDate: item.order_date,
    expected: item.expected,
    coverageDays: plan.coverage_days,
    minObservations: plan.min_observations,
    liveFrom: plan.live_from,
    onHand: parseQ(item.on_hand) ?? ZERO,
    todayPosted: item.today_posted,
    // Consumption already posted today is only visible here when today is a complete observation;
    // otherwise it is taken from the database's own figure for the day (opening − closing + forecast).
    todayDemand: todayDemand ?? postedToday(item),
    observations: (weekday: number) => byWeekday.get(weekday) ?? [],
    incoming: item.incoming.map((x) => ({ expected: x.expected, outstanding: parseQ(x.outstanding) ?? ZERO })),
    safetyPercent: parseQ(String(item.safety_percent ?? 20)) ?? q(20),
    minOrder: parseQ(item.settings.min_order),
    pack: parseQ(item.settings.pack),
  };
}

/** Consumption posted on an incomplete order date, recovered from the database's own breakdown. */
function postedToday(item: ItemPlanJson): Q {
  const first = item.bridge[0];
  if (!first || first.basis !== "forecast_remaining") return ZERO;
  const full = parseQ(first.observations.forecast);
  const remaining = parseQ(first.consumption);
  if (!full || !remaining) return ZERO;
  // With a forecast of 0 nothing remains whatever was posted, so the amount cannot be recovered; the
  // database's "forecast_remaining" basis says something was, and any amount above 0 gives its figures.
  if (full.n === 0n) return q(1);
  return { n: full.n * remaining.d - remaining.n * full.d, d: full.d * remaining.d };
}

function same(a: Q | null, b: Q | null): boolean {
  return a === null || b === null ? a === b : eq(a, b);
}

export function verifyItemPlan(plan: Pick<PlanJson, "coverage_days" | "min_observations" | "live_from">, item: ItemPlanJson): { result: PlanResult; mismatches: string[] } {
  const result = computePlan(planInput(plan, item));
  const mismatches: string[] = [];
  const check = (name: string, mine: Q | null, theirs: Q | null) => {
    if (!same(mine, theirs)) mismatches.push(name);
  };
  if (result.status !== item.status) mismatches.push("status");
  check("usable", result.usable, parseQ(item.usable));
  check("eligible_incoming", result.eligible, parseQ(item.eligible_incoming));
  check("forecast", result.forecast, parseQ(item.forecast));
  check("safety", result.safety, parseQ(item.safety));
  check("raw", result.raw, parseQ(item.raw));
  check("recommended", result.recommended, parseQ(item.recommended));
  check("suggested", result.suggested, parseQ(item.suggested));
  result.bridge.forEach((day, i) => {
    const theirs = item.bridge[i];
    if (!theirs || theirs.date !== day.date || theirs.basis !== day.basis) mismatches.push(`bridge.${i}`);
    else check(`bridge.${i}.closing`, day.closing, parseQ(theirs.closing));
  });
  if (result.buckets.join() !== item.incoming.map((x) => x.bucket).join()) mismatches.push("incoming");
  return { result, mismatches };
}
