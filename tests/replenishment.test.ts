import { describe, expect, it } from "vitest";
import {
  addDays, applyConstraints, computePlan, defaultExpectedDate, fraction, incomingBucket, isoWeekday, parseLegacyOrderDate, parseQ, q,
  recommend, safetyStock, sameWeekdayForecast, weekdayDates, ZERO, type Observation, type PlanInput,
} from "@/modules/replenishment/planning";
import { verifyItemPlan } from "@/modules/replenishment/verify";
import { buildCreatePayload, buildReceivePayload, mapPurchaseOrderError, normalizeOrderQuantity, normalizeSafetyPercent } from "@/modules/replenishment/forms";
import type { ItemPlanJson } from "@/modules/replenishment/types";

/** Synthetic numbers only. 18 Nov 2026 is a Wednesday. */
const WED = "2026-11-18";
const THU = "2026-11-19";
const FRI = "2026-11-20";
const SAT = "2026-11-21";

/** Complete observations for one weekday with the given demand values; null = a missing date. */
function history(orderDate: string, weekday: number, values: Array<number | null>, liveFrom = "2026-08-01"): Observation[] {
  const dates = weekdayDates(orderDate, weekday);
  const recent = dates.slice(dates.length - values.length);
  return dates.map((date) => {
    if (date < liveFrom) return { date, status: "before_live" as const, demand: null };
    const i = recent.indexOf(date);
    if (i < 0 || values[i] === null) return { date, status: "missing" as const, demand: null };
    return { date, status: "complete" as const, demand: q(values[i] as number) };
  });
}

function base(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    orderDate: WED,
    expected: FRI,
    coverageDays: 1,
    minObservations: 3,
    liveFrom: "2026-08-01",
    onHand: ZERO,
    todayPosted: true,
    todayDemand: ZERO,
    observations: (weekday) => history(WED, weekday, [0, 0, 0]),
    incoming: [],
    // 0 % isolates the other rules; the default 20 % and explicit values are tested below.
    safetyPercent: q(0),
    minOrder: null,
    pack: null,
    ...overrides,
  };
}

describe("dates", () => {
  it("a Wednesday-evening order is expected on Friday (business date + 2 calendar days)", () => {
    expect(isoWeekday(WED)).toBe(3);
    expect(defaultExpectedDate(WED)).toBe(FRI);
    expect(isoWeekday(defaultExpectedDate(WED))).toBe(5);
    // The business date itself comes from PostgreSQL (02:00 cutoff): an order at 01:30 on Thursday
    // has business date Wednesday and is also expected Friday; at 02:00 it is Thursday -> Saturday.
    expect(defaultExpectedDate(THU)).toBe(SAT);
    expect(addDays("2026-12-31", 2)).toBe("2027-01-02");
  });

  it("the three-month window has 13 dates of each weekday", () => {
    for (let weekday = 1; weekday <= 7; weekday++) {
      const dates = weekdayDates(WED, weekday);
      expect(dates).toHaveLength(13);
      expect(dates.every((d) => isoWeekday(d) === weekday && d >= addDays(WED, -90) && d <= WED)).toBe(true);
    }
  });
});

describe("same-weekday forecast", () => {
  it("excludes missing days instead of counting them as zero; a complete day with no consumption is 0", () => {
    // First live date 1 Oct: Fridays 2, 9, 16, 23 Oct missing; 30 Oct complete with nothing sold; 6 and 13 Nov: 6.
    const obs = history(WED, 5, [null, null, null, null, 0, 6, 6], "2026-10-01");
    const f = sameWeekdayForecast(obs, 3);
    expect(f.beforeLive).toBe(6);
    expect(f.complete).toBe(3);
    expect(f.missing).toBe(4);
    expect(fraction(f.average!)).toBe("4/1"); // (0 + 6 + 6) / 3, not 12 / 7
    expect(fraction(f.forecast!)).toBe("4/1");
  });

  it("dates before the first live date are not used", () => {
    // 25 Sep was a busy complete Friday (1000), but the branch went live on 1 Oct.
    const withEarly = (liveFrom: string): Observation[] => history(WED, 5, [18, 22, 20], liveFrom).map((o) =>
      o.date === "2026-09-25" && o.status !== "before_live" ? { ...o, status: "complete", demand: q(1000) } : o);
    const live = withEarly("2026-10-01");
    expect(live.find((o) => o.date === "2026-09-25")?.status).toBe("before_live");
    expect(fraction(sameWeekdayForecast(live, 3).average!)).toBe("20/1");
    expect(fraction(sameWeekdayForecast(withEarly("2026-08-01"), 3).average!)).toBe("265/1"); // (1000 + 60) / 4
  });

  it("insufficient or undecided minimum gives no forecast", () => {
    const obs = history(WED, 5, [18, 22, 20]);
    expect(sameWeekdayForecast(obs, 4).forecast).toBeNull();
    expect(sameWeekdayForecast(obs, 4).sufficient).toBe(false);
    expect(sameWeekdayForecast(obs, null).forecast).toBeNull();
    expect(sameWeekdayForecast(history(WED, 5, []), 1).forecast).toBeNull();
    expect(fraction(sameWeekdayForecast(obs, 3).forecast!)).toBe("20/1");
  });

  it("averages stay exact", () => {
    expect(fraction(sameWeekdayForecast(history(WED, 5, [1, 1, 2]), 3).forecast!)).toBe("4/3");
  });
});

describe("the recommendation formula", () => {
  it("20 forecast + 5 safety − 7 usable − 3 eligible incoming = 15", () => {
    const r = recommend(q(20), q(5), q(7), q(3));
    expect(fraction(r.raw)).toBe("15/1");
    expect(fraction(r.recommended)).toBe("15/1");
  });

  it("a negative result floors at 0", () => {
    const r = recommend(q(4), ZERO, q(100), ZERO);
    expect(fraction(r.raw)).toBe("-96/1");
    expect(fraction(r.recommended)).toBe("0/1");
  });

  it("the same case through the whole plan (25 % of a 20 forecast is the 5 of safety stock)", () => {
    const p = computePlan(base({
      onHand: q(7),
      safetyPercent: q(25),
      observations: (weekday) => history(WED, weekday, weekday === 5 ? [18, 22, 20] : [0, 0, 0]),
      incoming: [{ expected: FRI, outstanding: q(3) }],
    }));
    expect(p.status).toBe("recommend");
    expect(fraction(p.forecast!)).toBe("20/1");
    expect(fraction(p.safety!)).toBe("5/1");
    expect(fraction(p.usable)).toBe("7/1");
    expect(fraction(p.eligible)).toBe("3/1");
    expect(fraction(p.recommended!)).toBe("15/1");
    expect(fraction(p.suggested!)).toBe("15/1");
  });
});

describe("usable stock at the expected receipt time", () => {
  it("Abdo's example: 10 on hand + 190 incoming = 200 projected; a forecast of 150 leaves 50", () => {
    const p = computePlan(base({
      onHand: q(10),
      observations: (weekday) => history(WED, weekday, weekday === 4 ? [150, 150, 150] : [100, 100, 100]),
      incoming: [{ expected: THU, outstanding: q(190) }],
    }));
    expect(p.bridge.map((d) => [d.date, d.basis])).toEqual([[WED, "posted"], [THU, "forecast"]]);
    expect(fraction(p.bridge[1]!.opening)).toBe("200/1");
    expect(fraction(p.bridge[1]!.consumption!)).toBe("150/1");
    expect(fraction(p.bridge[1]!.closing)).toBe("50/1");
    expect(fraction(p.usable)).toBe("50/1");
    // The Thursday delivery is counted in usable stock only, not again as eligible incoming.
    expect(fraction(p.eligible)).toBe("0/1");
  });

  it("subtracts today's forecast when today's Product Mix is not posted, and only the rest when part is", () => {
    const obs = (weekday: number) => history(WED, weekday, [30, 30, 30]);
    expect(fraction(computePlan(base({ onHand: q(100), todayPosted: false, observations: obs })).usable)).toBe("40/1");
    const partial = computePlan(base({ onHand: q(100), todayPosted: false, todayDemand: q(10), observations: obs }));
    expect(partial.bridge[0]!.basis).toBe("forecast_remaining");
    expect(fraction(partial.usable)).toBe("50/1");
  });

  it("does not subtract a day without enough history, and never goes below 0", () => {
    const p = computePlan(base({ onHand: q(5), observations: (weekday) => history(WED, weekday, weekday === 4 ? [1] : [9, 9, 9]) }));
    expect(p.bridge[1]!.basis).toBe("unavailable");
    expect(fraction(p.usable)).toBe("5/1");
    const out = computePlan(base({ onHand: q(5), observations: (weekday) => history(WED, weekday, [9, 9, 9]) }));
    expect(fraction(out.usable)).toBe("0/1");
  });
});

describe("confirmed incoming stock", () => {
  it("counts incoming inside the window, once; excludes it after the window and when overdue", () => {
    const p = computePlan(base({
      incoming: [
        { expected: "2026-11-17", outstanding: q(1) }, // overdue
        { expected: THU, outstanding: q(4) }, // before the receipt: usable stock
        { expected: FRI, outstanding: q(3) }, // in the window
        { expected: SAT, outstanding: q(9) }, // after the window
      ],
    }));
    expect(p.buckets).toEqual(["overdue", "before_receipt", "window", "after_window"]);
    expect(fraction(p.usable)).toBe("4/1");
    expect(fraction(p.eligible)).toBe("3/1");
    // 0 forecast (+ 0 safety) − 4 usable − 3 eligible = −7. Counting Saturday's 9, Thursday's 4 twice or the overdue 1 would change −7.
    expect(fraction(p.raw!)).toBe("-7/1");
    expect(fraction(p.recommended!)).toBe("0/1");
  });

  it("changing the expected receipt date of an order changes the plan", () => {
    const input = base({ onHand: q(7), safetyPercent: q(25), observations: (weekday) => history(WED, weekday, weekday === 5 ? [18, 22, 20] : [0, 0, 0]) });
    const before = computePlan({ ...input, incoming: [{ expected: FRI, outstanding: q(3) }] });
    const after = computePlan({ ...input, incoming: [{ expected: SAT, outstanding: q(3) }] });
    expect(fraction(before.recommended!)).toBe("15/1");
    expect(fraction(after.recommended!)).toBe("18/1");
    expect(after.buckets).toEqual(["after_window"]);
  });

  it("a wider window counts more days of demand and of incoming", () => {
    expect(incomingBucket(SAT, WED, FRI, SAT)).toBe("window");
    expect(incomingBucket(SAT, WED, FRI, FRI)).toBe("after_window");
    const p = computePlan(base({ coverageDays: 2, observations: (weekday) => history(WED, weekday, [2, 2, 2]) }));
    expect(p.windowEnd).toBe(SAT);
    expect(fraction(p.forecast!)).toBe("4/1");
  });
});

describe("safety stock as a percentage of the forecast (owner-approved, 24 November 2026)", () => {
  it("validates percentages including explicit zero and rejects excess precision", () => {
    for (const input of ["0", "0.00", "٠٫٠٠٪"]) expect(normalizeSafetyPercent(input)).toBe("0");
    expect(normalizeSafetyPercent("١٢٫٥٪")).toBe("12.5");
    expect(normalizeSafetyPercent("100.00")).toBe("100.00");
    for (const input of ["", "-1", "100.01", "0.000", "٠٫٠٠٠", "1.001", "1/2"]) expect(normalizeSafetyPercent(input), input).toBeNull();
  });
  // 10 kg forecast for the covered Friday, 10 kg usable at receipt, no eligible incoming.
  const tenAndTen = (overrides: Partial<PlanInput> = {}) => computePlan(base({
    onHand: q(10),
    observations: (weekday) => history(WED, weekday, weekday === 5 ? [10, 10, 10] : [0, 0, 0]),
    ...overrides,
  }));

  it("the owner's example: 10 forecast, 10 available, no incoming -> 2 at 20 % and 0 at 0 %", () => {
    const at20 = tenAndTen({ safetyPercent: q(20) });
    expect([fraction(at20.forecast!), fraction(at20.usable), fraction(at20.eligible)]).toEqual(["10/1", "10/1", "0/1"]);
    expect(fraction(at20.safety!)).toBe("2/1");
    expect(fraction(at20.recommended!)).toBe("2/1");
    const at0 = tenAndTen({ safetyPercent: q(0) });
    expect(fraction(at0.safety!)).toBe("0/1");
    expect(fraction(at0.recommended!)).toBe("0/1");
  });

  it("is taken from the forecast of every covered day, exactly", () => {
    expect(fraction(safetyStock(q(8), q(25, 2)))).toBe("1/1"); // 12.5 % of 8
    const two = computePlan(base({ coverageDays: 2, safetyPercent: q(20), observations: (weekday) => history(WED, weekday, [5, 5, 5]) }));
    expect(fraction(two.forecast!)).toBe("10/1");
    expect(fraction(two.safety!)).toBe("2/1");
  });

  it("pack size and supplier minimum apply after the safety stock", () => {
    const packed = tenAndTen({ safetyPercent: q(20), pack: q(5) });
    expect(fraction(packed.recommended!)).toBe("2/1");
    expect(fraction(packed.suggested!)).toBe("5/1");
    const minimum = tenAndTen({ safetyPercent: q(20), minOrder: q(3) });
    expect(fraction(minimum.suggested!)).toBe("3/1");
    expect(fraction(tenAndTen({ safetyPercent: q(0), pack: q(5), minOrder: q(3) }).suggested!)).toBe("0/1");
  });

  it("is subtracted against usable and incoming stock once, and the result floors at 0", () => {
    const p = tenAndTen({ safetyPercent: q(20), incoming: [{ expected: FRI, outstanding: q(5) }] });
    expect(fraction(p.raw!)).toBe("-3/1"); // 10 + 2 − 10 − 5
    expect(fraction(p.recommended!)).toBe("0/1");
  });

  it("there is no safety stock without a forecast (review)", () => {
    expect(tenAndTen({ minObservations: null, safetyPercent: q(20) }).safety).toBeNull();
  });
});

describe("review state", () => {
  it("insufficient history: no recommendation", () => {
    const p = computePlan(base({ minObservations: 4, observations: (weekday) => history(WED, weekday, [18, 22, 20]) }));
    expect(p.status).toBe("review");
    expect(p.reasons).toEqual(["insufficient_history"]);
    expect(p.recommended).toBeNull();
    expect(p.coverage[0]!.forecast.complete).toBe(3);
  });

  it("an undecided minimum or first live date: review", () => {
    expect(computePlan(base({ minObservations: null })).reasons).toEqual(["minimum_unset"]);
    expect(computePlan(base({ liveFrom: null, minObservations: null })).reasons).toEqual(["first_live_date_unset", "minimum_unset"]);
  });
});

describe("constraints after the forecast", () => {
  it("are off until set", () => {
    expect(fraction(applyConstraints(q(3), null, null).value)).toBe("3/1");
  });
  it("supplier minimum, then whole packs", () => {
    const r = applyConstraints(q(3), q(5), q(6));
    expect(fraction(r.value)).toBe("6/1");
    expect(r.steps.map((s) => s.code)).toEqual(["supplier_minimum", "pack_size"]);
    expect(fraction(applyConstraints(q(13), null, q(6)).value)).toBe("18/1");
    expect(applyConstraints(q(12), null, q(6)).steps).toEqual([]);
    expect(fraction(applyConstraints(q(1, 3), null, q(1, 2)).value)).toBe("1/2");
  });
  it("never turn a zero recommendation into an order", () => {
    expect(fraction(applyConstraints(ZERO, q(5), q(6)).value)).toBe("0/1");
  });
});

describe("legacy order sheet date (P1-35)", () => {
  it("reads day / month / year with the sheet's separators and refuses non-dates", () => {
    expect(parseLegacyOrderDate("07\\12/2026")).toBe("2026-12-07");
    expect(parseLegacyOrderDate("7/12/2026")).toBe("2026-12-07");
    expect(parseLegacyOrderDate("31/02/2026")).toBeNull();
    expect(parseLegacyOrderDate("،")).toBeNull();
    expect(parseLegacyOrderDate("")).toBeNull();
  });
});

describe("exact quantities", () => {
  it("parses decimals and fractions without floating point", () => {
    expect(fraction(parseQ("0.1")!)).toBe("1/10");
    expect(fraction(parseQ({ num: "-96", den: "1" })!)).toBe("-96/1");
    expect(parseQ("x")).toBeNull();
  });
});

describe("order forms", () => {
  it("quantities are numbers above zero; text such as «،» is refused", () => {
    expect(normalizeOrderQuantity("12")).toBe("12");
    expect(normalizeOrderQuantity("١٢٫٥")).toBe("12.5");
    expect(normalizeOrderQuantity("،")).toBeNull();
    expect(normalizeOrderQuantity("0")).toBeNull();
    expect(normalizeOrderQuantity("abc")).toBeNull();
    expect(normalizeOrderQuantity("1/2")).toBeNull();
  });

  it("builds a create payload from the rows that have a quantity", () => {
    const id = "a8000000-0000-4000-8000-000000000001";
    const fields: Record<string, string> = {
      "item.0": id, "quantity.0": "15", "source.0": "factory", "unit.0": "", "from_plan.0": "1", "suggested.0": "15/1",
      "item.1": "", "quantity.1": "", "source.1": "store",
      note: "x",
    };
    const payload = buildCreatePayload((name) => fields[name] ?? "", 2);
    expect(payload).toEqual({ note: "x", lines: [{ item: id, quantity: "15", source: "factory", unit: null, from_plan: true,
      expected_suggested: "15/1", override_reason: "" }] });
    expect(buildCreatePayload((name) => ({ ...fields, "quantity.0": "،" })[name] ?? "", 2)).toBeNull();
    expect(buildCreatePayload((name) => ({ ...fields, "source.0": "supplier" })[name] ?? "", 2)).toBeNull();
    expect(buildCreatePayload(() => "", 2)).toBeNull();
  });

  it("builds a receive payload; blank lines are skipped", () => {
    const order = "a8000000-0000-4000-8000-000000000001";
    const line = "a8000000-0000-4000-8000-000000000002";
    const fields: Record<string, string> = { order, local: "2026-11-20T09:00", "line.0": line, "quantity.0": "4", "line.1": order, "quantity.1": "" };
    expect(buildReceivePayload((name) => fields[name] ?? "", 2)).toEqual({ order, local: "2026-11-20T09:00", reference: "", note: "",
      lines: [{ line, quantity: "4", over_receipt_reason: "" }] });
    expect(buildReceivePayload((name) => ({ ...fields, "quantity.0": "" })[name] ?? "", 2)).toBeNull();
  });

  it("maps database errors to messages", () => {
    expect(mapPurchaseOrderError("42501")).toBe("forbidden");
    expect(mapPurchaseOrderError("CT801")).toBe("po_over_receipt");
    expect(mapPurchaseOrderError("CT802")).toBe("po_plan_changed");
    expect(mapPurchaseOrderError("CT803")).toBe("po_state");
    expect(mapPurchaseOrderError("CT804")).toBe("po_override_reason");
    expect(mapPurchaseOrderError("23505")).toBe("po_request_reused");
    expect(mapPurchaseOrderError("40001")).toBe("po_stale");
    expect(mapPurchaseOrderError("22023")).toBe("invalid_input");
    expect(mapPurchaseOrderError(undefined)).toBe("unavailable");
  });
});

describe("the page cross-check", () => {
  it("agrees with a plan shaped like the database result and reports a difference", () => {
    const obs = (weekday: number, values: number[]) => ({
      weekday, complete: values.length, missing: 13 - values.length, before_live: 0, total: null, average: null, sufficient: true, forecast: null,
      dates: weekdayDates(WED, weekday).map((date, i, all) => {
        const k = i - (all.length - values.length);
        return k >= 0 ? { date, status: "complete" as const, demand: { num: String(values[k]), den: "1" } } : { date, status: "missing" as const, demand: null };
      }),
    });
    const f = (n: number) => ({ num: String(n), den: "1" });
    const item = {
      item_id: "x", name_ar: "x", name_en: null, kind: "ingredient", base_unit: "pc", status: "recommend", review_reasons: [], source: null,
      lead_days: 2, lead_rule: "two_day_rule", order_date: WED, expected: FRI, default_expected: FRI, window_end: FRI, today_posted: true,
      on_hand: f(7), coverage: [{ date: FRI, observations: obs(5, [18, 22, 20]) }],
      bridge: [
        { date: WED, weekday: 3, incoming: f(0), opening: f(7), consumption: f(0), basis: "posted", observations: obs(3, [0, 0, 0]), closing: f(7) },
        { date: THU, weekday: 4, incoming: f(0), opening: f(7), consumption: f(0), basis: "forecast", observations: obs(4, [0, 0, 0]), closing: f(7) },
      ],
      usable: f(7), incoming: [{ order: "o", order_no: 1, line: "l", line_no: 1, source: "factory", expected: FRI, original_expected: FRI, overridden: false,
        outstanding: f(3), bucket: "window" }],
      eligible_incoming: f(3), forecast: f(20), safety: f(5), safety_percent: 25, raw: f(15), recommended: f(15), constraints: [], suggested: f(15),
      settings: { pack: null, min_order: null, shelf_life_days: null, cutoff: null, revision: 1 }, warnings: [], history: null,
    } as unknown as ItemPlanJson;
    const settings = { coverage_days: 1, min_observations: 3, live_from: "2026-08-01" };
    expect(verifyItemPlan(settings, item).mismatches).toEqual([]);
    expect(verifyItemPlan(settings, { ...item, recommended: f(16) }).mismatches).toEqual(["recommended"]);
    expect(verifyItemPlan(settings, { ...item, safety_percent: 20 }).mismatches).toEqual(["safety", "raw", "recommended", "suggested"]);
  });
});
