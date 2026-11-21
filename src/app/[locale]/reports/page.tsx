import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { requireAccess } from "@/modules/access/guard";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { PROTOTYPE_FIELDS, prototypesUsing, type PrototypeId } from "@/modules/reports/contracts";
import { awaitingPhase, FIELD_MAP, FIELD_MAP_FINDINGS_VERSION, isPending, type FieldDef } from "@/modules/reports/field-map";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("reportMap.title") : undefined };
}

const PROTOTYPE_PATH: Record<PrototypeId, { path: string; label: MessageKey }> = {
  dailyClose: { path: "daily-close", label: "nav.dailyClose" },
  cashCount: { path: "cash-count", label: "nav.cashCount" },
  comparison: { path: "comparison", label: "nav.comparison" },
};

export default async function ReportMapPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireAccess({ locale, path: `/${locale}/reports`, require: { permission: "reports.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);

  const reports = [...new Set(FIELD_MAP.map((f) => f.report))];
  const pendingCount = FIELD_MAP.filter(isPending).length;
  const shownCount = new Set(Object.values(PROTOTYPE_FIELDS).flat()).size;

  // Content of the Phase 1 field map is written in English; mark it so Arabic pages read it correctly.
  const en = { lang: "en", dir: "ltr" } as const;

  return (
    <>
      <h1>{t("reportMap.title")}</h1>
      <p className="lead">{t("reportMap.intro")}</p>
      <p className="legend">
        {t("reportMap.summary", { total: FIELD_MAP.length, settled: FIELD_MAP.length - pendingCount, pending: pendingCount })}{" "}
        <span lang="en" dir="ltr">
          field-map {FIELD_MAP_FINDINGS_VERSION} · {shownCount}
        </span>
      </p>

      {reports.map((report) => {
        const fields = FIELD_MAP.filter((f) => f.report === report);
        return (
          <section key={report} aria-labelledby={`report-${report}`} data-report={report}>
            <h2 id={`report-${report}`}>{t(`reportMap.reports.${report}` as MessageKey)}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t("reportMap.columns.id")}</th>
                    <th scope="col">{t("reportMap.columns.field")}</th>
                    <th scope="col">{t("reportMap.columns.legacy")}</th>
                    <th scope="col">{t("reportMap.columns.meaning")}</th>
                    <th scope="col">{t("reportMap.columns.source")}</th>
                    <th scope="col">{t("reportMap.columns.unit")}</th>
                    <th scope="col">{t("reportMap.columns.dateBasis")}</th>
                    <th scope="col">{t("reportMap.columns.rounding")}</th>
                    <th scope="col">{t("reportMap.columns.blank")}</th>
                    <th scope="col">{t("reportMap.columns.status")}</th>
                    <th scope="col">{t("reportMap.columns.decision")}</th>
                    <th scope="col">{t("reportMap.columns.phase")}</th>
                    <th scope="col">{t("reportMap.usedBy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field: FieldDef) => {
                    const phase = awaitingPhase(field);
                    const used = prototypesUsing(field.id);
                    return (
                      <tr key={field.id} id={field.id} data-field-row={field.id} data-pending={isPending(field) ? "true" : "false"}>
                        <th scope="row" style={{ fontFamily: "var(--font-mono)" }}>
                          {field.id}
                        </th>
                        <td>{locale === "ar" ? field.field_ar : field.field_en}</td>
                        <td {...en}>{field.legacy_location}</td>
                        <td {...en}>{field.meaning}</td>
                        <td {...en}>{field.source_record}</td>
                        <td {...en}>{field.unit}</td>
                        <td {...en}>{field.date_basis}</td>
                        <td {...en}>{field.rounding}</td>
                        <td {...en}>{field.blank_behaviour}</td>
                        <td>
                          {isPending(field) ? (
                            <span className="badge pending">{t("common.pending")}</span>
                          ) : (
                            <span className="badge ok">{t("common.settled")}</span>
                          )}
                        </td>
                        <td {...en}>
                          {field.findings.join(", ") || "—"}
                          {isPending(field) && phase ? (
                            <span className="trace" style={{ fontFamily: "inherit" }}>
                              {t("common.awaitingPhase", { n: phase })}
                            </span>
                          ) : null}
                        </td>
                        <td>{field.implemented_in}</td>
                        <td>
                          {used.length === 0 ? (
                            <span className="blank">{t("reportMap.notShown")}</span>
                          ) : (
                            used.map((id) => (
                              <Link key={id} href={`/${locale}/${PROTOTYPE_PATH[id].path}`} style={{ display: "block" }}>
                                {t(PROTOTYPE_PATH[id].label)}
                              </Link>
                            ))
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
