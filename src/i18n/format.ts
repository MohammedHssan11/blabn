import type { Locale } from "./config";
import type { Blank, Minor, RatioBp } from "@/lib/money";
import type { BusinessDate } from "@/lib/dates";

/**
 * One place decides how numbers and dates look. Saved values are identical in
 * both languages; only this view layer differs. Western digits (0-9) are used
 * in Arabic too, as in the branch's own workbooks and receipts.
 */
const INTL_TAG: Record<Locale, string> = { ar: "ar-u-nu-latn", en: "en-US" };

/** Shown for a blank (not entered) value. Never "0". */
export const BLANK = "—";

function currencyOptions(locale: Locale): Intl.NumberFormatOptions {
  return {
    style: "currency",
    currency: "MAD",
    currencyDisplay: locale === "ar" ? "symbol" : "code",
  };
}

export function formatMad(minor: Blank<Minor>, locale: Locale): string {
  if (minor === null) return BLANK;
  return new Intl.NumberFormat(INTL_TAG[locale], currencyOptions(locale)).format(minor / 100);
}

/** Signed amount, e.g. +3.00 MAD for a cash variance. A zero stays unsigned. */
export function formatMadSigned(minor: Blank<Minor>, locale: Locale): string {
  if (minor === null) return BLANK;
  return new Intl.NumberFormat(INTL_TAG[locale], {
    ...currencyOptions(locale),
    signDisplay: "exceptZero",
  }).format(minor / 100);
}

export function formatCount(value: Blank<number>, locale: Locale): string {
  if (value === null) return BLANK;
  return new Intl.NumberFormat(INTL_TAG[locale]).format(value);
}

export function formatRatio(bp: Blank<RatioBp>, locale: Locale): string {
  if (bp === null) return BLANK;
  return new Intl.NumberFormat(INTL_TAG[locale], {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(bp / 10000);
}

type DateStyle = "short" | "long" | "weekday";

/** Business dates are calendar days: format at UTC so the day never shifts. */
export function formatBusinessDate(
  date: Blank<BusinessDate>,
  locale: Locale,
  style: DateStyle = "long",
): string {
  if (date === null) return BLANK;
  const instant = new Date(`${date}T00:00:00Z`);
  const options: Intl.DateTimeFormatOptions =
    style === "short"
      ? { day: "numeric", month: "short", timeZone: "UTC" }
      : style === "weekday"
        ? { weekday: "short", timeZone: "UTC" }
        : { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat(INTL_TAG[locale], options).format(instant);
}

/** "November 2026" for a YYYY-MM month. */
export function formatMonth(month: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
}

/** Event times are real instants: format in the branch's timezone. */
export function formatEventTime(instant: Blank<string>, locale: Locale, timeZone: string): string {
  if (instant === null) return BLANK;
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

/** Date and time of an event (audit history, account changes), in the given timezone. */
export function formatEventDateTime(instant: Blank<string>, locale: Locale, timeZone: string): string {
  if (instant === null) return BLANK;
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}
