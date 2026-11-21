import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { isBusinessDate } from "@/lib/dates";
import { getComparisonView, SAMPLE_CURRENT_DATES } from "@/modules/comparisons/service";
import { DateText, Mad, Ratio, TraceTag } from "@/components/values";
import { traced } from "@/modules/reports/trace";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("comparison.title") : undefined };
}

export default async function ComparisonPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const t = createTranslator(locale);
  const requested = first(sp.current);
  const view = await getComparisonView(requested);
  const base = `/${locale}/comparison`;
  const { total } = view;

  return (
    <>
      <h1>{t("comparison.title")}</h1>
      <p className="lead">{t("comparison.intro")}</p>
      <p className="legend">
        {t("common.blankMeaning")} {t("common.traceHint")} {t("common.dataSource", { version: view.dataVersion })} ·{" "}
        {t("common.calculatedOnServer")}
      </p>

      {!view.requestedDateValid ? (
        <p className="notice warn" role="alert">
          {t("validation.invalidDate")}
        </p>
      ) : null}

      <h2>{t("comparison.examples")}</h2>
      <ul className="chips">
        {SAMPLE_CURRENT_DATES.map((date) => (
          <li key={date}>
            <Link href={`${base}?current=${date}`} aria-current={date === view.currentDate.value ? "true" : undefined}>
              <DateText v={traced(date, {})} locale={locale} style="short" />
            </Link>
          </li>
        ))}
      </ul>
      <form className="inline" method="get" action={base} style={{ marginTop: 10 }}>
        <label>
          {t("comparison.currentDate")}
          <input
            type="date"
            name="current"
            defaultValue={isBusinessDate(requested) ? requested : view.currentDate.value}
          />
        </label>
        <button type="submit">{t("comparison.showDates")}</button>
      </form>

      <h2 data-section="dates">
        {t("comparison.currentDate")}: <DateText v={view.currentDate} locale={locale} /> · {t("comparison.priorDate")}:{" "}
        <DateText v={view.priorDate} locale={locale} />
        <TraceTag trace={view.currentDate.trace} locale={locale} inline />
      </h2>

      <div className="table-wrap">
        <table data-table="weekly-comparison">
          <thead>
            <tr>
              <th scope="col">{t("comparison.columns.branch")}</th>
              <th scope="col" className="num">
                {t("comparison.columns.current")}
                <TraceTag trace={{ field: "CMP-07" }} locale={locale} />
              </th>
              <th scope="col" className="num">
                {t("comparison.columns.prior")}
                <TraceTag trace={{ field: "CMP-07" }} locale={locale} />
              </th>
              <th scope="col" className="num">
                {t("comparison.columns.ratio")}
                <TraceTag trace={{ field: "CMP-06" }} locale={locale} />
              </th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.branch.code} data-branch={row.branch.code}>
                <th scope="row">{locale === "ar" ? row.branch.nameAr : row.branch.nameEn}</th>
                <td className="num" data-source={row.currentSource}>
                  {row.currentSource === "missing" ? (
                    <span className="badge pending" data-missing="true">
                      {t("comparison.missing")}
                    </span>
                  ) : (
                    <>
                      <Mad v={row.current} locale={locale} />
                      <span className="trace">{t(`comparison.source.${row.currentSource}`)} · {row.current.trace.record}</span>
                    </>
                  )}
                </td>
                <td className="num" data-source={row.priorSource}>
                  {row.priorSource === "missing" ? (
                    <span className="badge pending" data-missing="true">
                      {t("comparison.missing")}
                    </span>
                  ) : (
                    <>
                      <Mad v={row.prior} locale={locale} />
                      <span className="trace">{t(`comparison.source.${row.priorSource}`)} · {row.prior.trace.record}</span>
                    </>
                  )}
                </td>
                <td className="num">
                  <Ratio v={row.ratio} locale={locale} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-row="total" data-incomplete={total.incomplete ? "true" : "false"}>
              <th scope="row">
                {t("comparison.total")}
                <TraceTag trace={{ field: "CMP-08" }} locale={locale} />
              </th>
              <td className="num">
                <Mad v={total.current} locale={locale} />
                <span className="trace">{t("comparison.coverage", { present: total.currentCoverage.present, total: total.currentCoverage.total })}</span>
              </td>
              <td className="num">
                <Mad v={total.prior} locale={locale} />
                <span className="trace">{t("comparison.coverage", { present: total.priorCoverage.present, total: total.priorCoverage.total })}</span>
              </td>
              <td className="num">
                <Ratio v={total.ratio} locale={locale} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={`notice ${total.incomplete ? "warn" : "ok"}`} style={{ marginTop: 12 }} data-completeness={total.incomplete ? "incomplete" : "complete"}>
        {total.incomplete ? t("comparison.incomplete") : t("comparison.complete")}
        {total.ratioReason !== "ok" ? ` — ${t(`comparison.ratioReason.${total.ratioReason}`)}` : ""}
      </p>
      <p className="legend">{t("comparison.reportingOnlyNote")}</p>
    </>
  );
}
