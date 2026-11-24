import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { isLocale, type Locale } from "@/i18n/config";
import { createTranslator, type MessageKey, type Translator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { addDays } from "@/lib/dates";
import { ResultMessages } from "@/components/Messages";
import { ALL_BRANCH_CODES, OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds, type ActiveAccess } from "@/modules/access/session";
import { defaultToday } from "@/modules/comparisons/service";
import { requestExportAction, retryExportAction } from "@/modules/exports/actions";
import { isReportExportOwner } from "@/modules/exports/access";
import { DAY_FAMILIES, DRAFT_FAMILIES, FAMILIES, familyPermissions } from "@/modules/exports/families";
import type { Family } from "@/modules/exports/model";
import { readExports } from "@/modules/exports/service";
import { ExportStatusBadge } from "@/modules/exports/ui";
import { readBranchNames } from "@/modules/comparisons/data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("exports.title") : undefined };
}

/** The branches of a family the person may export (Maarif only, except the comparison). */
function exportableBranches(access: ActiveAccess, family: Family): string[] {
  const candidates = family === "sales_comparison" ? [...ALL_BRANCH_CODES] : [OPERATING_BRANCH_CODE];
  return candidates.filter((branch) => familyPermissions(family, false).every((p) => holds(access, p, branch)));
}

function FamilyForm({ family, locale, t, branches, names, drafts, today }: {
  family: Family; locale: Locale; t: Translator; branches: string[]; names: Array<{ code: string; nameEn: string; nameAr: string }>;
  drafts: boolean; today: string;
}) {
  const month = today.slice(0, 7);
  const modes: Array<"month" | "day" | "week"> = family === "sales_comparison" ? ["week", "month"] : DAY_FAMILIES.includes(family) ? ["day", "month"] : ["month"];
  return (
    <details className="card stack" data-family={family} open={family === "sales_comparison"}>
      <summary><strong>{t(`exports.family.${family}` as MessageKey)}</strong></summary>
      <p className="legend">{t(`exports.familyHint.${family}` as MessageKey)}</p>
      {modes.map((mode) => (
        <form key={mode} action={requestExportAction} data-form={`export-${family}-${mode}`} className="stack">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="family" value={family} />
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="request" value={randomUUID()} />
          <fieldset>
            <legend>{t("exports.mode")}: {t(mode === "month" ? "exports.modeMonth" : mode === "day" ? "exports.modeDay" : "exports.modeWeek")}</legend>
            {mode === "month" ? <label>{t("exports.month")} <input type="month" name="month" defaultValue={month} max={month} required /></label> : null}
            {mode === "day" ? <label>{t("exports.date")} <input type="date" name="date" defaultValue={today} max={today} required /></label> : null}
            {mode === "week" ? (
              <>
                <label>{t("exports.current")} <input type="date" name="current" defaultValue={today} max={today} required /></label>{" "}
                <label>{t("exports.prior")} <input type="date" name="prior" defaultValue={addDays(today, -7)} max={today} required /></label>
              </>
            ) : null}
          </fieldset>
          {family === "sales_comparison" ? (
            <fieldset>
              <legend>{t("exports.branches")}</legend>
              {branches.map((code) => {
                const b = names.find((n) => n.code === code);
                return <label key={code} style={{ marginInlineEnd: 12 }}><input type="checkbox" name="branches" value={code} defaultChecked /> {b ? (locale === "ar" ? b.nameAr : b.nameEn) : code}</label>;
              })}
            </fieldset>
          ) : <input type="hidden" name="branches" value={OPERATING_BRANCH_CODE} />}
          <label>{t("exports.workbookLanguage")}{" "}
            <select name="workbook_locale" defaultValue={locale}>
              <option value="ar">{t("exports.arabic")}</option>
              <option value="en">{t("exports.english")}</option>
            </select>
          </label>
          {drafts ? <label><input type="checkbox" name="drafts" value="1" /> {t("exports.drafts")}</label> : null}
          <p><button type="submit">{t("exports.submit")}</button></p>
        </form>
      ))}
    </details>
  );
}

export default async function ExportsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/reports/exports`;
  // Signed in is enough to open the page; each family is offered only with its permission for its branches,
  // and the action, the database and the download check that permission again.
  const access = await requireAccess({ locale, path });
  const t = createTranslator(locale);
  const today = defaultToday();
  const [isOwner, exports, names] = await Promise.all([isReportExportOwner(), readExports(50), readBranchNames()]);
  const offered = isOwner
    ? FAMILIES.map((family) => ({ family, branches: exportableBranches(access, family) })).filter((f) => f.branches.length > 0)
    : [];

  return (
    <>
      <h1>{t("exports.title")}</h1>
      <p className="lead">{t("exports.intro")}</p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <section aria-labelledby="new-export">
        <h2 id="new-export">{t("exports.newTitle")}</h2>
        {offered.length === 0 ? <p className="legend" data-empty="families">{t("exports.none")}</p> : offered.map(({ family, branches }) => (
          <FamilyForm key={family} family={family} locale={locale} t={t} branches={branches} names={names} today={today}
            drafts={DRAFT_FAMILIES.includes(family) && holds(access, "daily_close.export_draft", OPERATING_BRANCH_CODE)} />
        ))}
      </section>
      <section aria-labelledby="my-exports">
        <h2 id="my-exports">{t("exports.mine")}</h2>
        {exports.length === 0 ? <p className="legend" data-empty="exports">{t("exports.noExports")}</p> : (
          <div className="table-wrap">
            <table data-table="exports">
              <thead>
                <tr>
                  {(["requested", "report", "branches", "period", "language", "status", "file"] as const).map((c) => <th key={c} scope="col">{t(`exports.columns.${c}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {exports.map((e) => (
                  <tr key={e.id} data-export={e.id} data-status={e.status}>
                    <td dir="ltr">{e.requested_local?.replace("T", " ")}</td>
                    <td>{t(`exports.family.${e.family}` as MessageKey)}{e.include_drafts ? <> <span className="badge pending">{t("exports.draftTag")}</span></> : null}</td>
                    <td>{e.branches.map((code) => { const b = names.find((n) => n.code === code); return b ? (locale === "ar" ? b.nameAr : b.nameEn) : code; }).join(locale === "ar" ? "، " : ", ")}</td>
                    <td dir="ltr">{e.period_label}</td>
                    <td>{t(e.locale === "ar" ? "exports.arabic" : "exports.english")}</td>
                    <td><ExportStatusBadge status={e.status} t={t} /></td>
                    <td>
                      {e.allowed && e.status === "complete" ? <a href={`/api/report-exports/${e.id}`} data-link="download">{t("exports.download")}</a> : null}
                      {e.allowed && (e.status === "failed" || e.status === "pending") ? (
                        <form action={retryExportAction} data-form="retry" style={{ display: "inline" }}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="export" value={e.id} />
                          <button type="submit" className="link">{t("exports.retry")}</button>
                        </form>
                      ) : null}{" "}
                      <Link href={`${path}/${e.id}`} data-link="details">{t("exports.details")}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
