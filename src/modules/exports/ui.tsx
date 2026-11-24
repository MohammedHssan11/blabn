import type { MessageKey, Translator } from "@/i18n/dictionary";
import type { ExportRecord } from "./service";

/** Status of an export (waiting, building, failed, complete). Display only. */
export function ExportStatusBadge({ status, t }: { status: ExportRecord["status"]; t: Translator }) {
  const tone = status === "complete" ? "ok" : status === "failed" ? "bad" : "pending";
  return <span className={`badge ${tone}`} data-status={status}>{t(`exports.status.${status}` as MessageKey)}</span>;
}
