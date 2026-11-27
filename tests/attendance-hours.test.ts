import { describe, expect, it } from "vitest";
import {
  elapsedSeconds,
  formatDuration,
  grandTotalSeconds,
  pairShifts,
  parseEvents,
  shiftsInPeriod,
  totalsByEmployee,
  type AttendanceEvent,
} from "@/modules/attendance/hours";

let n = 0;
/** Casablanca is UTC+1 in these November examples (the local strings come from PostgreSQL in the app). */
function ev(employeeId: string, kind: "check_in" | "check_out", utc: string, local: string, extra: Partial<AttendanceEvent> = {}): AttendanceEvent {
  n += 1;
  return {
    id: `e${String(n).padStart(4, "0")}`,
    employeeId,
    kind,
    occurredAt: utc,
    local,
    source: "kiosk",
    effective: true,
    inPeriod: true,
    device: "Maarif entrance",
    createdBy: null,
    replacedBy: null,
    ...extra,
  };
}

describe("required examples", () => {
  it("09:05 to 17:10 is 8 hours and 5 minutes", () => {
    const shifts = pairShifts([
      ev("a", "check_in", "2026-11-02T08:05:00+00:00", "2026-11-02T09:05:00"),
      ev("a", "check_out", "2026-11-02T16:10:00+00:00", "2026-11-02T17:10:00"),
    ]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.status).toBe("complete");
    expect(shifts[0]!.seconds).toBe(8 * 3600 + 5 * 60);
    expect(formatDuration(shifts[0]!.seconds)).toBe("8:05:00");
  });

  it("22:00 to 06:00 the next day is 8 hours, reported on the check-in date", () => {
    const shifts = pairShifts([
      ev("a", "check_in", "2026-11-02T21:00:00Z", "2026-11-02T22:00:00"),
      ev("a", "check_out", "2026-11-03T05:00:00Z", "2026-11-03T06:00:00"),
    ]);
    expect(shifts[0]!.seconds).toBe(8 * 3600);
    expect(shifts[0]!.date).toBe("2026-11-02");
    expect(shiftsInPeriod(shifts, "2026-11-03", "2026-11-03")).toHaveLength(0);
    expect(shiftsInPeriod(shifts, "2026-11-02", "2026-11-02")).toHaveLength(1);
  });

  it("uses instants, so a shift across a clock change is exact", () => {
    // Morocco moves its clocks around Ramadan; the instants are what count, not the wall clock.
    const shifts = pairShifts([
      ev("a", "check_in", "2026-02-15T07:00:00Z", "2026-02-15T09:00:00"),
      ev("a", "check_out", "2026-02-15T15:00:00Z", "2026-02-15T16:00:00"),
    ]);
    expect(shifts[0]!.seconds).toBe(8 * 3600);
  });

  it("an incomplete shift is listed for review and never counted", () => {
    const shifts = pairShifts([
      ev("a", "check_in", "2026-11-02T08:00:00Z", "2026-11-02T09:00:00"),
      ev("a", "check_in", "2026-11-03T08:00:00Z", "2026-11-03T09:00:00"),
      ev("a", "check_out", "2026-11-03T16:00:00Z", "2026-11-03T17:00:00"),
      ev("b", "check_in", "2026-11-03T08:00:00Z", "2026-11-03T09:00:00"),
    ]);
    const totals = totalsByEmployee(shifts);
    expect(shifts.map((s) => s.status).sort()).toEqual(["complete", "missing_check_out", "missing_check_out"]);
    expect(totals.get("a")).toMatchObject({ completeShifts: 1, workedSeconds: 8 * 3600, missingCheckOuts: 1 });
    expect(totals.get("b")).toMatchObject({ completeShifts: 0, workedSeconds: 0, missingCheckOuts: 1 });
    expect(grandTotalSeconds(shifts)).toBe(8 * 3600);
  });

  it("an authorized correction changes the result while the original stays visible", () => {
    const original = ev("a", "check_out", "2026-11-02T18:00:00Z", "2026-11-02T19:00:00", {
      effective: false,
      replacedBy: { id: "c1", kind: "retime", reason: "Forgot to check out at 17:10", by: "Abdo", atLocal: "2026-11-03T09:00:00" },
    });
    const replacement = ev("a", "check_out", "2026-11-02T16:10:00Z", "2026-11-02T17:10:00", {
      source: "correction",
      createdBy: { id: "c1", kind: "retime", reason: "Forgot to check out at 17:10", by: "Abdo", atLocal: "2026-11-03T09:00:00" },
    });
    const checkIn = ev("a", "check_in", "2026-11-02T08:05:00Z", "2026-11-02T09:05:00");
    const before = pairShifts([checkIn, { ...original, effective: true, replacedBy: null }]);
    const after = pairShifts([checkIn, original, replacement]);
    expect(before[0]!.seconds).toBe(9 * 3600 + 55 * 60);
    expect(after).toHaveLength(1);
    expect(after[0]!.seconds).toBe(8 * 3600 + 5 * 60);
    expect(after[0]!.corrected).toBe(true);
  });
});

describe("pairing", () => {
  it("a check-out without a check-in is its own review row", () => {
    const shifts = pairShifts([ev("a", "check_out", "2026-11-02T16:00:00Z", "2026-11-02T17:00:00")]);
    expect(shifts[0]).toMatchObject({ status: "check_out_without_check_in", seconds: null, date: "2026-11-02" });
  });

  it("orders by instant, not by arrival", () => {
    const out = ev("a", "check_out", "2026-11-02T16:00:00Z", "2026-11-02T17:00:00");
    const inn = ev("a", "check_in", "2026-11-02T08:00:00Z", "2026-11-02T09:00:00");
    expect(pairShifts([out, inn])[0]!.status).toBe("complete");
  });

  it("keeps employees apart", () => {
    const shifts = pairShifts([
      ev("a", "check_in", "2026-11-02T08:00:00Z", "2026-11-02T09:00:00"),
      ev("b", "check_out", "2026-11-02T09:00:00Z", "2026-11-02T10:00:00"),
      ev("a", "check_out", "2026-11-02T10:00:00Z", "2026-11-02T11:00:00"),
    ]);
    expect(shifts.find((s) => s.employeeId === "a")!.seconds).toBe(2 * 3600);
    expect(shifts.find((s) => s.employeeId === "b")!.status).toBe("check_out_without_check_in");
  });

  it("a shift that started before the period is not counted in it", () => {
    const shifts = pairShifts([
      ev("a", "check_in", "2026-10-31T21:00:00Z", "2026-10-31T22:00:00", { inPeriod: false }),
      ev("a", "check_out", "2026-11-01T05:00:00Z", "2026-11-01T06:00:00"),
    ]);
    expect(shiftsInPeriod(shifts, "2026-11-01", "2026-11-30")).toEqual([]);
  });

  it("exact seconds are summed without rounding", () => {
    const shifts = pairShifts([
      ev("a", "check_in", "2026-11-02T08:05:23Z", "2026-11-02T09:05:23"),
      ev("a", "check_out", "2026-11-02T16:10:41Z", "2026-11-02T17:10:41"),
      ev("a", "check_in", "2026-11-03T08:00:59Z", "2026-11-03T09:00:59"),
      ev("a", "check_out", "2026-11-03T08:01:00Z", "2026-11-03T09:01:00"),
    ]);
    expect(grandTotalSeconds(shifts)).toBe(8 * 3600 + 5 * 60 + 18 + 1);
    expect(formatDuration(grandTotalSeconds(shifts))).toBe("8:05:19");
  });

  it("formats long totals beyond 24 hours and refuses nonsense", () => {
    expect(formatDuration(100 * 3600 + 59)).toBe("100:00:59");
    expect(formatDuration(null)).toBe("—");
    expect(() => formatDuration(1.5)).toThrow();
    expect(() => elapsedSeconds("2026-11-02T10:00:00Z", "2026-11-02T09:00:00Z")).toThrow();
  });
});

describe("parsing the reader output", () => {
  it("accepts PostgreSQL instants and refuses malformed rows", () => {
    const parsed = parseEvents([
      { id: "x", employee_id: "a", kind: "check_in", occurred_at: "2026-11-02T08:05:00+00:00", local: "2026-11-02T09:05:00",
        source: "kiosk", effective: true, in_period: true, device: "K", created_by_correction: null, replaced_by_correction: null },
    ]);
    expect(parsed[0]).toMatchObject({ kind: "check_in", effective: true, device: "K" });
    expect(() => parseEvents([{ id: "x", employee_id: "a", kind: "sleep", occurred_at: "2026-11-02T08:05:00Z", source: "kiosk" }])).toThrow();
    expect(() => parseEvents([{ id: "x", employee_id: "a", kind: "check_in", occurred_at: "yesterday", source: "kiosk" }])).toThrow();
    expect(() => parseEvents(null)).toThrow();
  });
});
