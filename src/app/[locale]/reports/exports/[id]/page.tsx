import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { isCatalogId } from "@/modules/catalog/forms";
import { retryExportAction } from "@/modules/exports/actions";
import { readExport } from "@/modules/exports/service";
import { ExportStatusBadge } from "@/modules/exports/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("exports.detailTitle") : undefined };
}

/**
 * One export: its status, the provenance recorded with the file (template and calculation-rule
 * versions, snapshot, saved revisions, fingerprints) and its history. The record stays reviewable after
 * later corrections; downloading still needs the report's permission for every branch.
 */
export default async function ExportPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<SearchParams> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  await requireAccess({ locale, path: `/${locale}/reports/exports/${id}` });
  if (!isCatalogId(id)) notFound();
  const t = createTranslator(locale);
  const e = await readExport(id.toLowerCase());
  if (!e) notFound();
  const ltr = { dir: "ltr" } as const;

  return (
    <>
      <h1>{t("exports.detailTitle")}</h1>
      <p><Link href={`/${locale}/reports/exports`}>{t("common.back")}</Link></p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <section className="card stack" data-export={e.id} data-status={e.status}>
        <h2>{t(`exports.family.${e.family}` as MessageKey)} <ExportStatusBadge status={e.status} t={t} /></h2>
        <dl className="kv">
          <dt>{t("exports.columns.period")}</dt><dd {...ltr}>{e.period_label}</dd>
          <dt>{t("exports.columns.branches")}</dt><dd {...ltr}>{e.branches.join(", ")}</dd>
          <dt>{t("exports.columns.language")}</dt><dd>{t(e.locale === "ar" ? "exports.arabic" : "exports.english")}{e.include_drafts ? ` · ${t("exports.draftTag")}` : ""}</dd>
          <dt>{t("exports.columns.requested")}</dt><dd {...ltr}>{e.requested_local?.replace("T", " ")} · {e.requester}</dd>
          <dt>{t("exports.attempt")}</dt><dd {...ltr}>{e.attempt}</dd>
          {e.last_error ? <><dt>{t("exports.lastError")}</dt><dd {...ltr} data-error={e.last_error}>{e.last_error}</dd></> : null}
        </dl>
        {e.status === "complete" ? (
          e.allowed ? <p><a href={`/api/report-exports/${e.id}`} data-link="download">{t("exports.download")}</a> <span dir="ltr">({e.file_name})</span></p>
            : <p className="notice warn" data-result="not-allowed">{t("exports.notAllowed")}</p>
        ) : null}
        {e.allowed && (e.status === "failed" || e.status === "pending") ? (
          <form action={retryExportAction} data-form="retry">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="export" value={e.id} />
            <button type="submit">{t("exports.retry")}</button>
          </form>
        ) : null}
        {e.status === "complete" ? <p className="legend">{t("exports.immutable")}</p> : null}
      </section>

      <section className="card stack" data-section="provenance" style={{ marginTop: 12 }}>
        <h2>{t("exports.provenance")}</h2>
        <dl className="kv" {...ltr}>
          <dt>{t("exports.template")}</dt><dd data-template={e.template_version ?? ""}>{e.template_version ?? "—"}</dd>
          <dt>{t("exports.calc")}</dt><dd>{e.calc_version ?? "—"}</dd>
          <dt>{t("exports.snapshot")}</dt><dd>{e.snapshot_local?.replace("T", " ") ?? "—"}</dd>
          <dt>{t("exports.fingerprint")}</dt><dd style={{ wordBreak: "break-all" }} data-fingerprint={e.data_sha256 ?? ""}>{e.data_sha256 ?? "—"}</dd>
          <dt>{t("exports.fileSha")}</dt><dd style={{ wordBreak: "break-all" }}>{e.file_sha256 ?? "—"}</dd>
          <dt>{t("exports.bytes")}</dt><dd>{e.file_bytes ?? "—"}</dd>
        </dl>
        <h3>{t("exports.sources")}</h3>
        <pre dir="ltr" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }} data-sources>{e.sources ? JSON.stringify(e.sources, null, 2) : "—"}</pre>
      </section>

      <section className="card stack" data-section="history" style={{ marginTop: 12 }}>
        <h2>{t("exports.history")}</h2>
        <div className="table-wrap">
          <table data-table="export-events">
            <thead><tr><th scope="col">{t("common.time")}</th><th scope="col">{t("exports.attempt")}</th><th scope="col">{t("exports.event")}</th><th scope="col">{t("exports.actor")}</th></tr></thead>
            <tbody>
              {(e.events ?? []).map((ev, i) => (
                <tr key={i} data-event={ev.event}>
                  <td dir="ltr">{ev.at.slice(0, 19).replace("T", " ")} UTC</td>
                  <td>{ev.attempt}</td>
                  <td>{t(`exports.events.${ev.event}` as MessageKey)}</td>
                  <td>{ev.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
