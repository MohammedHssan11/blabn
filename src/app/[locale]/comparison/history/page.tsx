import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { formatBusinessDate, formatCount, formatEventDateTime, formatMad } from "@/i18n/format";
import { isBusinessDate } from "@/lib/dates";
import { first, type SearchParams } from "@/lib/search-params";
import { ALL_BRANCH_CODES } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { readHistory } from "@/modules/comparisons/data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("comparison.historyPage.title") : undefined };
}

/** Every revision of the figures entered for one branch and date (needs comparison.view for that branch). */
export default async function ComparisonHistoryPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const branch = first(sp.branch) ?? "";
  const date = first(sp.date) ?? "";
  if (!(ALL_BRANCH_CODES as readonly string[]).includes(branch) || !isBusinessDate(date)) notFound();
  const path = `/${locale}/comparison/history?branch=${branch}&date=${date}`;
  await requireAccess({ locale, path, require: { permission: "comparison.view", branch } });
  const t = createTranslator(locale);
  const history = await readHistory(branch, date);
  const rows = history.rows;

  return (
    <>
      <h1>{t("comparison.historyPage.title")}</h1>
      <p className="lead">{t("comparison.historyPage.intro")}</p>
      <h2 data-section="target" data-branch={branch}>{locale === "ar" ? history.nameAr : history.nameEn} · {formatBusinessDate(date, locale, "long")}</h2>
      {rows.length === 0 ? <p className="notice">{t("comparison.historyPage.none")}</p> : (
        <div className="table-wrap">
          <table data-table="comparison-history">
            <thead>
              <tr>
                <th scope="col">{t("comparison.columns.source")}</th>
                <th scope="col" className="num">{t("comparison.revision", { n: "" }).trim()}</th>
                <th scope="col" className="num">{t("comparison.columns.sales")} / {t("comparison.columns.orders")}</th>
                <th scope="col">{t("comparison.historyPage.purpose")}</th>
                <th scope="col">{t("common.status")}</th>
                <th scope="col">{t("comparison.historyPage.reason")}</th>
                <th scope="col">{t("comparison.historyPage.enteredBy")}</th>
                <th scope="col">{t("comparison.historyPage.enteredAt")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-revision={r.revision} data-metric={r.metric} data-active={r.active ? "true" : "false"}>
                  <td>{t(`comparison.historyPage.metric.${r.metric}` as MessageKey)} · <code dir="ltr">{r.source}</code></td>
                  <td className="num">{r.revision}</td>
                  <td className="num" data-value={r.value ?? ""}>
                    {r.value === null ? t("comparison.historyPage.withdrawn") : r.metric === "net_sales" ? formatMad(r.value, locale) : formatCount(r.value, locale)}
                  </td>
                  <td>{t(`comparison.entry.purposes.${r.purpose}` as MessageKey)}{r.reference ? ` · ${r.reference}` : ""}</td>
                  <td><span className={`badge ${r.active ? "ok" : ""}`}>{r.active ? t("comparison.historyPage.active") : t("comparison.historyPage.retired")}</span></td>
                  <td>{r.reason ?? ""}</td>
                  <td>{r.actor}</td>
                  <td>{formatEventDateTime(r.enteredAt, locale, "Africa/Casablanca")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p><Link href={`/${locale}/comparison`}>{t("comparison.historyPage.back")}</Link></p>
    </>
  );
}
