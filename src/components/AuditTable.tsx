import type { Locale } from "@/i18n/config";
import type { Translator } from "@/i18n/dictionary";
import { formatEventDateTime } from "@/i18n/format";
import type { AuditRow } from "@/modules/access/directory";
import { auditActionKey } from "@/modules/access/ui";

const AUDIT_TIMEZONE = "Africa/Casablanca";

/** Read-only list of audit records. Field values are shown as recorded; credentials are never stored. */
export function AuditTable({ rows, locale, t }: { rows: readonly AuditRow[]; locale: Locale; t: Translator }) {
  return (
    <div className="table-wrap">
      <table data-table="audit">
        <thead>
          <tr>
            <th>{t("audit.columns.time")}</th>
            <th>{t("audit.columns.actor")}</th>
            <th>{t("audit.columns.action")}</th>
            <th>{t("audit.columns.target")}</th>
            <th>{t("audit.columns.details")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = auditActionKey(row.action);
            return (
              <tr key={row.id} data-audit-action={row.action} data-audit-id={row.id}>
                <td className="num">{formatEventDateTime(row.occurredAt, locale, AUDIT_TIMEZONE)}</td>
                <td>{row.actorName === "system" ? t("audit.system") : row.actorName}</td>
                <td>
                  {key ? t(key) : row.action}
                  <div className="legend" dir="ltr" style={{ textAlign: "start", margin: 0 }}>
                    {row.action}
                  </div>
                </td>
                <td>
                  {row.targetLabel ?? row.targetId ?? "—"}
                  {row.branch ? <div className="legend" style={{ margin: 0 }}>{row.branch}</div> : null}
                </td>
                <td>
                  <details>
                    <summary>{t("audit.details")}</summary>
                    <pre className="changes">{JSON.stringify(row.changes, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
