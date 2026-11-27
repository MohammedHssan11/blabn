import type { Locale } from "@/i18n/config";
import type { MessageKey, Translator } from "@/i18n/dictionary";
import { BLANK, formatBusinessDate } from "@/i18n/format";
import type { ShiftStatus } from "./hours";
import { kioskReason } from "./forms";

/** A branch-local wall-clock time from PostgreSQL ("YYYY-MM-DDTHH:MM:SS"), shown as date and time. */
export function formatLocal(local: string | null | undefined, locale: Locale): string {
  if (!local) return BLANK;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/.exec(local);
  if (!m) return BLANK;
  return `${formatBusinessDate(m[1] ?? null, locale, "short")} ${m[2] ?? ""}`;
}

export function localTime(local: string | null | undefined): string {
  return local && /T\d{2}:\d{2}:\d{2}$/.test(local) ? local.slice(11) : BLANK;
}

/** Value for an <input type="datetime-local"> from a local time. */
export function inputLocal(local: string | null | undefined): string {
  return local ? local.slice(0, 16) : "";
}

export function StatusBadge({ status, t }: { status: ShiftStatus; t: Translator }) {
  const tone = status === "complete" ? "ok" : status === "missing_check_out" ? "pending" : "bad";
  return <span className={`badge ${tone}`} data-status={status}>{t(`attendance.status.${status}` as MessageKey)}</span>;
}

export function reasonLabel(reason: string | null | undefined, t: Translator): string {
  if (!reason) return BLANK;
  const code = kioskReason(reason);
  return t(`attendance.reason.${code}` as MessageKey);
}

export function attemptStatusLabel(status: string, t: Translator): string {
  const known = ["refused", "failed", "expired", "superseded", "pending", "succeeded"];
  return t(`attendance.attemptStatus.${known.includes(status) ? status : "failed"}` as MessageKey);
}
