/**
 * Business date vs. event time.
 *
 * A business date is a calendar day of a branch's trading ("2026-11-02") and is
 * stored as a plain `date`. An event time is a real instant (`timestamptz`).
 * They are stored separately; the business date of an event is derived from the
 * branch's timezone and day-rollover time, never from the server's clock zone.
 */
export type BusinessDate = string; // YYYY-MM-DD

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isBusinessDate(value: unknown): value is BusinessDate {
  if (typeof value !== "string") return false;
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function daysInMonth(month: string): BusinessDate[] {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Local calendar date and clock time of an instant in an IANA timezone. */
export function localParts(instant: Date | string, timeZone: string) {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}` as BusinessDate,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function rolloverMinutes(rollover: string): number {
  const match = /^(\d{2}):(\d{2})/.exec(rollover);
  if (!match) throw new RangeError(`Invalid rollover time: ${rollover}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Business date of an event: the local date in the branch timezone, moved back
 * one day when the local time is before the branch's rollover time (e.g. a
 * branch trading past midnight with a 04:00 rollover).
 */
export function businessDateOf(
  instant: Date | string,
  timeZone: string,
  rollover = "00:00",
): BusinessDate {
  const { date, minutes } = localParts(instant, timeZone);
  return minutes < rolloverMinutes(rollover) ? addDays(date, -1) : date;
}
