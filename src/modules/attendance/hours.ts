/**
 * Worked time from attendance events. Pure functions: the attendance screen and the Excel export
 * both call them on the same reader output (app_attendance_report), so they always agree.
 *
 * Rules (initial release; nothing else is applied until Abdo confirms it):
 *   - Only effective events count: an event replaced by a correction (void or retime) is shown but
 *     never paired.
 *   - Per employee, in time order: a check-in followed by a check-out is a COMPLETE shift whose
 *     duration is the exact elapsed time between the two recorded instants (whole seconds). A shift
 *     crossing midnight or a clock change is therefore exact.
 *   - A check-in followed by another check-in, or by nothing, is a shift with NO CHECK-OUT RECORDED.
 *     It is listed for review and never counted in worked time.
 *   - A check-out with no open check-in is a CHECK-OUT WITHOUT CHECK-IN, listed for review.
 *   - No breaks, rounding, lateness, overtime or payroll rule is applied.
 *   - Reporting period (PROVISIONAL, pending Abdo's answer): a shift belongs to the local calendar
 *     date of its check-in; a check-out without check-in to the date of the check-out.
 */

export type EventKind = "check_in" | "check_out";

export interface CorrectionNote {
  id: string;
  kind: "add" | "void" | "retime";
  reason: string;
  by: string;
  atLocal: string;
}

export interface AttendanceEvent {
  id: string;
  employeeId: string;
  kind: EventKind;
  /** ISO instant with whole seconds (the database truncates to the second). */
  occurredAt: string;
  /** Branch-local wall-clock time "YYYY-MM-DDTHH:MM:SS", computed by PostgreSQL. */
  local: string;
  source: "kiosk" | "correction";
  effective: boolean;
  inPeriod: boolean;
  device: string | null;
  createdBy: CorrectionNote | null;
  replacedBy: CorrectionNote | null;
}

export type ShiftStatus = "complete" | "missing_check_out" | "check_out_without_check_in";

export interface Shift {
  employeeId: string;
  checkIn: AttendanceEvent | null;
  checkOut: AttendanceEvent | null;
  status: ShiftStatus;
  /** Elapsed whole seconds for a complete shift; null otherwise (never 0 for "unknown"). */
  seconds: number | null;
  /** Local calendar date the shift is reported under. */
  date: string;
  /** True when an event of the shift was created by a correction. */
  corrected: boolean;
}

export interface EmployeeTotals {
  employeeId: string;
  completeShifts: number;
  workedSeconds: number;
  missingCheckOuts: number;
  checkOutsWithoutCheckIn: number;
}

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** Milliseconds since the epoch of an ISO instant; refuses anything that is not a full instant. */
export function instantMs(value: string): number {
  if (!INSTANT.test(value)) throw new RangeError(`Not an instant: ${value}`);
  const ms = Date.parse(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (!Number.isFinite(ms)) throw new RangeError(`Not an instant: ${value}`);
  return ms;
}

/** Exact elapsed whole seconds between two instants (a fraction of a second is never invented). */
export function elapsedSeconds(from: string, to: string): number {
  const diff = instantMs(to) - instantMs(from);
  if (diff < 0) throw new RangeError("check-out before check-in");
  return Math.floor(diff / 1000);
}

function order(a: AttendanceEvent, b: AttendanceEvent): number {
  return instantMs(a.occurredAt) - instantMs(b.occurredAt) || a.id.localeCompare(b.id);
}

/** Pairs each employee's effective events into shifts, in time order. */
export function pairShifts(events: readonly AttendanceEvent[]): Shift[] {
  const byEmployee = new Map<string, AttendanceEvent[]>();
  for (const event of events) {
    if (!event.effective) continue;
    const list = byEmployee.get(event.employeeId) ?? [];
    list.push(event);
    byEmployee.set(event.employeeId, list);
  }
  const shifts: Shift[] = [];
  for (const [employeeId, list] of byEmployee) {
    list.sort(order);
    let open: AttendanceEvent | null = null;
    for (const event of list) {
      if (event.kind === "check_in") {
        if (open) shifts.push(incomplete(employeeId, open));
        open = event;
      } else if (open) {
        shifts.push({
          employeeId,
          checkIn: open,
          checkOut: event,
          status: "complete",
          seconds: elapsedSeconds(open.occurredAt, event.occurredAt),
          date: open.local.slice(0, 10),
          corrected: open.source === "correction" || event.source === "correction",
        });
        open = null;
      } else {
        shifts.push({
          employeeId,
          checkIn: null,
          checkOut: event,
          status: "check_out_without_check_in",
          seconds: null,
          date: event.local.slice(0, 10),
          corrected: event.source === "correction",
        });
      }
    }
    if (open) shifts.push(incomplete(employeeId, open));
  }
  return shifts.sort((a, b) => order((a.checkIn ?? a.checkOut)!, (b.checkIn ?? b.checkOut)!));
}

function incomplete(employeeId: string, checkIn: AttendanceEvent): Shift {
  return {
    employeeId,
    checkIn,
    checkOut: null,
    status: "missing_check_out",
    seconds: null,
    date: checkIn.local.slice(0, 10),
    corrected: checkIn.source === "correction",
  };
}

/** Shifts reported in [from, to] (local calendar dates, inclusive). */
export function shiftsInPeriod(shifts: readonly Shift[], from: string, to: string): Shift[] {
  return shifts.filter((shift) => shift.date >= from && shift.date <= to);
}

export function totalsByEmployee(shifts: readonly Shift[]): Map<string, EmployeeTotals> {
  const totals = new Map<string, EmployeeTotals>();
  for (const shift of shifts) {
    const row = totals.get(shift.employeeId) ?? {
      employeeId: shift.employeeId,
      completeShifts: 0,
      workedSeconds: 0,
      missingCheckOuts: 0,
      checkOutsWithoutCheckIn: 0,
    };
    if (shift.status === "complete") {
      row.completeShifts += 1;
      row.workedSeconds += shift.seconds ?? 0;
    } else if (shift.status === "missing_check_out") row.missingCheckOuts += 1;
    else row.checkOutsWithoutCheckIn += 1;
    totals.set(shift.employeeId, row);
  }
  return totals;
}

export function grandTotalSeconds(shifts: readonly Shift[]): number {
  return shifts.reduce((sum, shift) => sum + (shift.status === "complete" ? shift.seconds ?? 0 : 0), 0);
}

/** "8:05:00" — hours (not capped at 24), minutes, seconds. Exact; nothing is rounded. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (!Number.isInteger(seconds) || seconds < 0) throw new RangeError("duration");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Parses the reader's event JSON; anything malformed is refused rather than guessed. */
export function parseEvents(raw: unknown): AttendanceEvent[] {
  if (!Array.isArray(raw)) throw new TypeError("events");
  return raw.map((item) => {
    const e = item as Record<string, unknown>;
    const note = (value: unknown): CorrectionNote | null => {
      if (!value || typeof value !== "object") return null;
      const n = value as Record<string, unknown>;
      return { id: String(n.id), kind: n.kind as CorrectionNote["kind"], reason: String(n.reason), by: String(n.by), atLocal: String(n.at_local) };
    };
    if ((e.kind !== "check_in" && e.kind !== "check_out") || (e.source !== "kiosk" && e.source !== "correction")) {
      throw new TypeError("event");
    }
    const occurredAt = String(e.occurred_at);
    instantMs(occurredAt);
    return {
      id: String(e.id),
      employeeId: String(e.employee_id),
      kind: e.kind,
      occurredAt,
      local: String(e.local),
      source: e.source,
      effective: e.effective === true,
      inPeriod: e.in_period === true,
      device: typeof e.device === "string" ? e.device : null,
      createdBy: note(e.created_by_correction),
      replacedBy: note(e.replaced_by_correction),
    };
  });
}
