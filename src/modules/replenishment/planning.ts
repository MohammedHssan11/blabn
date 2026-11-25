/**
 * The Phase 8 planning arithmetic as plain, exact functions (no floating point, no server imports).
 *
 * PostgreSQL (`app_private.replenishment_item_plan`) is the authority: it computes the plan shown on
 * the screens and the suggestion stored on a purchase-order line. This module computes the same
 * result from the same inputs. The unit tests pin the rules, and the planning pages recompute every
 * item with it and flag any difference, so the two implementations check each other.
 *
 *   recommended = max(0, forecast demand + safety stock − usable stock at receipt − eligible incoming)
 *   safety stock = forecast demand for the coverage period × the branch safety percentage (default 20 %, 0 allowed)
 *
 * - Forecast: the plain average of the COMPLETE same-weekday observations in the 13 weeks up to the
 *   order business date. Missing dates are left out (never 0); a complete date without consumption
 *   is a real 0. Below the minimum number of complete observations there is no forecast: review.
 * - Usable stock at receipt: from the book stock of the order date, day by day until the day before
 *   the receipt: + confirmed incoming expected that day, − that day's forecast when the history
 *   supports it (today: only what is not posted yet), never below 0.
 * - Eligible incoming: confirmed incoming expected inside the coverage window. Incoming before the
 *   receipt is already in usable stock; after the window or overdue is not counted. Once each.
 * - Constraints after the forecast, only when confirmed: supplier minimum, then pack size.
 */

export interface Q {
  n: bigint;
  d: bigint;
}

export interface FractionJson {
  num: string;
  den: string;
  decimal?: string;
  exact?: boolean;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function q(n: bigint | number | string, d: bigint | number | string = 1n): Q {
  let num = BigInt(n);
  let den = BigInt(d);
  if (den === 0n) throw new Error("Invalid fraction");
  if (den < 0n) [num, den] = [-num, -den];
  const g = gcd(num, den);
  return g === 0n ? { n: 0n, d: 1n } : { n: num / g, d: den / g };
}

export const ZERO: Q = { n: 0n, d: 1n };
export const add = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const lt = (a: Q, b: Q): boolean => a.n * b.d < b.n * a.d;
export const eq = (a: Q, b: Q): boolean => a.n * b.d === b.n * a.d;
export const max0 = (a: Q): Q => (a.n < 0n ? ZERO : a);
export const mul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
export const sum = (list: Q[]): Q => list.reduce(add, ZERO);

/** "12.5", "3", "1/3" or a {num, den} object from the database. */
export function parseQ(value: string | FractionJson | null | undefined): Q | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return q(value.num, value.den);
  const text = value.trim();
  if (/^-?\d+\/\d+$/.test(text)) {
    const [n = "0", d = "1"] = text.split("/");
    return BigInt(d) === 0n ? null : q(n, d);
  }
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const decimals = m[3] ?? "";
  return q(BigInt(`${m[1]}${m[2]}${decimals}`), 10n ** BigInt(decimals.length));
}

export const fraction = (a: Q): string => `${a.n}/${a.d}`;

/** Days between two ISO dates and date arithmetic, in UTC so no time zone applies. */
export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** ISO weekday: Monday 1 ... Sunday 7. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The default expected receipt: the order business date plus two calendar days (the approved rule). */
export function defaultExpectedDate(orderBusinessDate: string, leadDays = 2): string {
  return addDays(orderBusinessDate, leadDays);
}

// ------------------------------------------------------------------ forecast
export type ObservationStatus = "complete" | "missing" | "before_live";

export interface Observation {
  date: string;
  status: ObservationStatus;
  /** Consumption on a complete date (0 when nothing was consumed); null otherwise. */
  demand: Q | null;
}

/** The 13 same-weekday dates of the window (order date − 90 days .. order date) with their status. */
export function weekdayDates(orderDate: string, weekday: number): string[] {
  const out: string[] = [];
  for (let k = -90; k <= 0; k++) {
    const date = addDays(orderDate, k);
    if (isoWeekday(date) === weekday) out.push(date);
  }
  return out;
}

export interface WeekdayForecast {
  complete: number;
  missing: number;
  beforeLive: number;
  total: Q | null;
  average: Q | null;
  sufficient: boolean;
  forecast: Q | null;
}

export function sameWeekdayForecast(observations: Observation[], minObservations: number | null): WeekdayForecast {
  const complete = observations.filter((o) => o.status === "complete");
  const total = complete.length > 0 ? sum(complete.map((o) => o.demand ?? ZERO)) : null;
  const average = total && complete.length > 0 ? q(total.n, total.d * BigInt(complete.length)) : null;
  const sufficient = minObservations !== null && complete.length > 0 && complete.length >= minObservations;
  return {
    complete: complete.length,
    missing: observations.filter((o) => o.status === "missing").length,
    beforeLive: observations.filter((o) => o.status === "before_live").length,
    total,
    average,
    sufficient,
    forecast: sufficient ? average : null,
  };
}

// ------------------------------------------------------------------ incoming
export type IncomingBucket = "overdue" | "before_receipt" | "window" | "after_window";

export function incomingBucket(expected: string, orderDate: string, receipt: string, windowEnd: string): IncomingBucket {
  if (expected < orderDate) return "overdue";
  if (expected < receipt) return "before_receipt";
  if (expected <= windowEnd) return "window";
  return "after_window";
}

// ------------------------------------------------------------------ the item plan
export interface PlanInput {
  orderDate: string;
  expected: string;
  coverageDays: number;
  minObservations: number | null;
  liveFrom: string | null;
  onHand: Q;
  /** The order date's Product Mix is locked and fully posted. */
  todayPosted: boolean;
  /** Consumption already posted on the order date. */
  todayDemand: Q;
  /** Observations by ISO weekday (only the weekdays the plan needs). */
  observations: (weekday: number) => Observation[];
  incoming: Array<{ expected: string; outstanding: Q }>;
  /** Safety stock as a percentage of the coverage-period forecast (the branch setting; 20 when unset). */
  safetyPercent: Q;
  minOrder: Q | null;
  pack: Q | null;
}

export type BridgeBasis = "posted" | "forecast" | "forecast_remaining" | "unavailable";

export interface BridgeDay {
  date: string;
  incoming: Q;
  opening: Q;
  consumption: Q | null;
  basis: BridgeBasis;
  closing: Q;
}

export type ReviewReason = "first_live_date_unset" | "minimum_unset" | "insufficient_history";

export interface ConstraintStep {
  code: "supplier_minimum" | "pack_size";
  value: Q;
  packs?: bigint;
}

export interface PlanResult {
  status: "recommend" | "review";
  reasons: ReviewReason[];
  windowEnd: string;
  coverage: Array<{ date: string; forecast: WeekdayForecast }>;
  bridge: BridgeDay[];
  usable: Q;
  eligible: Q;
  buckets: IncomingBucket[];
  forecast: Q | null;
  /** forecast × percentage; null in review (there is no forecast to take a percentage of). */
  safety: Q | null;
  raw: Q | null;
  recommended: Q | null;
  constraints: ConstraintStep[];
  suggested: Q | null;
}

/** Supplier minimum, then pack size (rounded up to whole packs). Only for a quantity above 0. */
export function applyConstraints(quantity: Q, minOrder: Q | null, pack: Q | null): { value: Q; steps: ConstraintStep[] } {
  let value = quantity;
  const steps: ConstraintStep[] = [];
  if (value.n > 0n && minOrder && lt(value, minOrder)) {
    value = minOrder;
    steps.push({ code: "supplier_minimum", value });
  }
  if (value.n > 0n && pack) {
    const a = value.n * pack.d;
    const b = value.d * pack.n;
    const packs = (a + b - 1n) / b;
    const rounded = q(packs * pack.n, pack.d);
    if (!eq(rounded, value)) {
      value = rounded;
      steps.push({ code: "pack_size", value, packs });
    }
  }
  return { value, steps };
}

/** Safety stock for the coverage period: forecast × percent / 100 (exact). */
export function safetyStock(forecast: Q, percent: Q): Q {
  return mul(forecast, q(percent.n, percent.d * 100n));
}

/** recommended = max(0, forecast + safety − usable − eligible); the raw value is kept for display. */
export function recommend(forecast: Q, safety: Q, usable: Q, eligible: Q): { raw: Q; recommended: Q } {
  const raw = sub(sub(add(forecast, safety), usable), eligible);
  return { raw, recommended: max0(raw) };
}

export function computePlan(input: PlanInput): PlanResult {
  const windowEnd = addDays(input.expected, input.coverageDays - 1);
  const coverage: PlanResult["coverage"] = [];
  let forecast = ZERO;
  let insufficient = false;
  for (let k = 0; k < input.coverageDays; k++) {
    const date = addDays(input.expected, k);
    const f = sameWeekdayForecast(input.observations(isoWeekday(date)), input.minObservations);
    coverage.push({ date, forecast: f });
    if (f.forecast) forecast = add(forecast, f.forecast);
    else insufficient = true;
  }

  const live = input.incoming.filter((x) => x.outstanding.n > 0n);
  const buckets = live.map((x) => incomingBucket(x.expected, input.orderDate, input.expected, windowEnd));
  const eligible = sum(live.filter((_, i) => buckets[i] === "window").map((x) => x.outstanding));

  const bridge: BridgeDay[] = [];
  let closing = input.onHand;
  for (let date = input.orderDate; date < input.expected; date = addDays(date, 1)) {
    const incoming = sum(live.filter((x) => x.expected === date).map((x) => x.outstanding));
    const opening = add(closing, incoming);
    let consumption: Q | null;
    let basis: BridgeBasis;
    const f = sameWeekdayForecast(input.observations(isoWeekday(date)), input.minObservations);
    if (date === input.orderDate && input.todayPosted) {
      basis = "posted";
      consumption = ZERO;
    } else if (f.forecast) {
      basis = "forecast";
      consumption = f.forecast;
      if (date === input.orderDate) {
        if (input.todayDemand.n !== 0n) basis = "forecast_remaining";
        consumption = max0(sub(f.forecast, input.todayDemand));
      }
    } else {
      basis = "unavailable";
      consumption = null;
    }
    closing = max0(sub(opening, consumption ?? ZERO));
    bridge.push({ date, incoming, opening, consumption, basis, closing });
  }
  const usable = closing;

  const reasons: ReviewReason[] = [];
  if (input.liveFrom === null) reasons.push("first_live_date_unset");
  if (input.minObservations === null) reasons.push("minimum_unset");
  if (insufficient && input.liveFrom !== null && input.minObservations !== null) reasons.push("insufficient_history");

  if (reasons.length > 0) {
    return { status: "review", reasons, windowEnd, coverage, bridge, usable, eligible, buckets, forecast: null, safety: null,
      raw: null, recommended: null, constraints: [], suggested: null };
  }
  const safety = safetyStock(forecast, input.safetyPercent);
  const { raw, recommended } = recommend(forecast, safety, usable, eligible);
  const constrained = applyConstraints(recommended, input.minOrder, input.pack);
  return { status: "recommend", reasons, windowEnd, coverage, bridge, usable, eligible, buckets, forecast, safety, raw,
    recommended, constraints: constrained.steps, suggested: constrained.value };
}

// ------------------------------------------------------------------ legacy order sheet (P1-35)
/**
 * Reads the date typed in the old order sheet (SRC-01 Sheet1!C6) as day / month / year, accepting
 * the separators found in it ("/", "\\", "-", "."). Returns the ISO date, or null when the text is
 * not a real date. The original text is always kept next to the result; the date is the EXPECTED
 * receipt date, never an actual receipt.
 */
export function parseLegacyOrderDate(text: string): string | null {
  const m = /^\s*(\d{1,2})\s*[/\\.-]\s*(\d{1,2})\s*[/\\.-]\s*(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : null;
}
