import type { Locale } from "@/i18n/config";
import {
  BLANK,
  formatBusinessDate,
  formatCount,
  formatEventTime,
  formatMad,
  formatMadSigned,
  formatRatio,
} from "@/i18n/format";
import type { Blank, Minor, RatioBp } from "@/lib/money";
import type { Trace, Traced } from "@/modules/reports/trace";

/*
 * Presentation helpers. They only format values that the server already
 * calculated; no financial arithmetic happens here.
 */

export function traceAttrs(trace: Trace) {
  return {
    "data-field": trace.field,
    "data-record": trace.record,
  };
}

/** Visible trace: report field ID (linked to the report map) and the saved record. */
export function TraceTag({ trace, locale, inline = false }: { trace: Trace; locale: Locale; inline?: boolean }) {
  if (!trace.field && !trace.record) return null;
  return (
    <span className={inline ? "trace trace-inline" : "trace"}>
      {trace.field ? <a href={`/${locale}/reports#${trace.field}`}>{trace.field}</a> : null}
      {trace.field && trace.record ? " · " : null}
      {trace.record ?? null}
    </span>
  );
}

function ValueSpan({ text, isBlank, trace, strong }: { text: string; isBlank: boolean; trace: Trace; strong?: boolean }) {
  return (
    <span
      className={`amount${isBlank ? " blank" : ""}`}
      data-blank={isBlank ? "true" : undefined}
      style={strong ? { fontWeight: 700 } : undefined}
      {...traceAttrs(trace)}
    >
      {text}
    </span>
  );
}

export function Mad({ v, locale, signed = false, strong }: { v: Traced<Blank<Minor>>; locale: Locale; signed?: boolean; strong?: boolean }) {
  const text = signed ? formatMadSigned(v.value, locale) : formatMad(v.value, locale);
  return <ValueSpan text={text} isBlank={v.value === null} trace={v.trace} strong={strong} />;
}

export function Count({ v, locale }: { v: Traced<Blank<number>>; locale: Locale }) {
  return <ValueSpan text={formatCount(v.value, locale)} isBlank={v.value === null} trace={v.trace} />;
}

export function Ratio({ v, locale }: { v: Traced<Blank<RatioBp>>; locale: Locale }) {
  return <ValueSpan text={formatRatio(v.value, locale)} isBlank={v.value === null} trace={v.trace} />;
}

export function DateText({
  v,
  locale,
  style = "long",
}: {
  v: Traced<Blank<string>>;
  locale: Locale;
  style?: "short" | "long" | "weekday";
}) {
  return <ValueSpan text={formatBusinessDate(v.value, locale, style)} isBlank={v.value === null} trace={v.trace} />;
}

export function EventTime({ instant, locale, timeZone }: { instant: string | null; locale: Locale; timeZone: string }) {
  return (
    <time dateTime={instant ?? undefined} className="amount">
      {instant === null ? BLANK : formatEventTime(instant, locale, timeZone)}
    </time>
  );
}
