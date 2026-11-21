import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { formatMonth } from "@/i18n/format";
import { first, type SearchParams } from "@/lib/search-params";
import { requireAccess } from "@/modules/access/guard";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { getDailyCloseView, type DailyRowView } from "@/modules/closing/service";
import { traced } from "@/modules/reports/trace";
import { Count, DateText, EventTime, Mad, Ratio, TraceTag } from "@/components/values";
import { KvList } from "@/components/KvList";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("dailyClose.title") : undefined };
}

export default async function DailyClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  // The branch is part of every request: a person needs the permission for THAT branch.
  const branchCode = first(sp.branch) ?? OPERATING_BRANCH_CODE;
  await requireAccess({ locale, path: `/${locale}/daily-close`, require: { permission: "daily_close.view", branch: branchCode } });
  // Only the operating branch has daily-close data.
  if (branchCode !== OPERATING_BRANCH_CODE) notFound();
  const t = createTranslator(locale);
  const view = await getDailyCloseView(first(sp.month), first(sp.date));
  const { totals, selected, branch } = view;
  const branchName = locale === "ar" ? branch.nameAr : branch.nameEn;
  const base = `/${locale}/daily-close`;

  const columns = [
    { key: "date", label: t("dailyClose.columns.date"), field: "DS-01", num: false },
    { key: "sales", label: t("dailyClose.columns.sales"), field: "DS-02", num: true },
    { key: "orders", label: t("dailyClose.columns.orders"), field: "DS-03", num: true },
    { key: "average", label: t("dailyClose.columns.average"), field: "DS-04", num: true },
    { key: "expenses", label: t("dailyClose.columns.expenses"), field: "DS-05", num: true },
    { key: "remittance", label: t("dailyClose.columns.remittance"), field: "DS-06", num: true },
    { key: "remittanceRatio", label: t("dailyClose.columns.remittanceRatio"), field: "DS-07", num: true },
    { key: "card", label: t("dailyClose.columns.card"), field: "DS-08", num: true },
    { key: "cardRatio", label: t("dailyClose.columns.cardRatio"), field: "DS-09", num: true },
  ];

  const rowCells = (row: DailyRowView) => [
    <DateText key="d" v={row.businessDate} locale={locale} style="short" />,
    <Mad key="s" v={row.sales} locale={locale} />,
    <Count key="o" v={row.orders} locale={locale} />,
    <Mad key="a" v={row.average} locale={locale} />,
    <Mad key="e" v={row.expensesInclRemittance} locale={locale} />,
    <Mad key="r" v={row.remittance} locale={locale} />,
    <Ratio key="rr" v={row.remittanceRatio} locale={locale} />,
    <Mad key="c" v={row.card} locale={locale} />,
    <Ratio key="cr" v={row.cardRatio} locale={locale} />,
  ];

  const totalCells = [
    null,
    <Mad key="s" v={traced(totals.sales, { field: "DS-10", record: view.totalsTrace.record })} locale={locale} strong />,
    <Count key="o" v={traced(totals.orders, { field: "DS-10" })} locale={locale} />,
    <Mad key="a" v={traced(totals.average, { field: "DS-10" })} locale={locale} strong />,
    <Mad key="e" v={traced(totals.expensesInclRemittance, { field: "DS-10" })} locale={locale} />,
    <Mad key="r" v={traced(totals.remittance, { field: "DS-10" })} locale={locale} />,
    <Ratio key="rr" v={traced(totals.remittanceRatio, { field: "DS-10" })} locale={locale} />,
    <Mad key="c" v={traced(totals.card, { field: "DS-10" })} locale={locale} />,
    <Ratio key="cr" v={traced(totals.cardRatio, { field: "DS-10" })} locale={locale} />,
  ];

  const monthLabel = formatMonth(view.month, locale);
  const sel = selected;

  return (
    <>
      <h1>{t("dailyClose.title")}</h1>
      <p className="lead">{t("dailyClose.intro")}</p>
      <p className="legend">
        {t("common.blankMeaning")} {t("common.zeroMeaning")} {t("common.traceHint")}{" "}
        {t("common.dataSource", { version: view.dataVersion })} · {t("common.calculatedOnServer")}
      </p>

      <h2 data-title-field="DS-11">
        {t("dailyClose.reportTitle", { branch: branchName, month: monthLabel })}
        <TraceTag trace={view.title.trace} locale={locale} inline />
      </h2>

      <form className="inline" method="get" action={base}>
        <label>
          {t("dailyClose.month")}
          <input type="month" name="month" defaultValue={view.month} />
        </label>
        <button type="submit">{t("common.show")}</button>
      </form>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table data-table="daily-sales">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.num ? "num" : undefined} scope="col">
                  {c.label}
                  <TraceTag trace={{ field: c.field }} locale={locale} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => {
              const date = row.businessDate.value;
              const isSelected = sel?.businessDate === date;
              return (
                <tr
                  key={date}
                  data-date={date}
                  data-closed={row.closed ? "true" : "false"}
                  className={`${row.closed ? "" : "is-blank"}${isSelected ? " is-selected" : ""}`}
                >
                  {rowCells(row).map((cell, i) => (
                    <td key={columns[i]!.key} className={columns[i]!.num ? "num" : undefined}>
                      {i === 0 ? (
                        <Link href={`${base}?month=${view.month}&date=${date}`} aria-label={`${t("dailyClose.viewDay")} ${date}`}>
                          {cell}
                        </Link>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr data-row="totals">
              <th scope="row">
                {t("dailyClose.totals")}
                <TraceTag trace={{ field: "DS-10" }} locale={locale} />
              </th>
              {totalCells.slice(1).map((cell, i) => (
                <td key={columns[i + 1]!.key} className="num">
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="legend">
        {t("dailyClose.totalsNote", { days: totals.closedDays })}
        {totals.closedDaysWithoutOrders > 0 ? ` ${t("dailyClose.ordersMissingNote", { days: totals.closedDaysWithoutOrders })}` : ""}
      </p>

      {sel ? (
        <section aria-labelledby="day-detail" data-section="day-detail">
          <h2 id="day-detail">
            {t("dailyClose.dayDetail")} · <DateText v={sel.figures.businessDate} locale={locale} />
          </h2>
          {!sel.figures.closed ? (
            <p className="notice warn">
              {view.rows.find((r) => r.businessDate.value === sel.businessDate)?.businessDate.trace.record
                ? t("dailyClose.dayNotClosed")
                : t("dailyClose.dayNoRecord")}
            </p>
          ) : (
            <div className="two-col">
              <div className="card">
                <KvList
                  locale={locale}
                  items={[
                    { id: "sales", label: t("dailyClose.columns.sales"), trace: sel.figures.sales.trace, value: <Mad v={sel.figures.sales} locale={locale} /> },
                    { id: "orders", label: t("dailyClose.columns.orders"), trace: sel.figures.orders.trace, value: <Count v={sel.figures.orders} locale={locale} /> },
                    { id: "average", label: t("dailyClose.columns.average"), trace: sel.figures.average.trace, value: <Mad v={sel.figures.average} locale={locale} /> },
                    { id: "card", label: t("dailyClose.columns.card"), trace: sel.figures.card.trace, value: <Mad v={sel.figures.card} locale={locale} /> },
                    { id: "cardRatio", label: t("dailyClose.columns.cardRatio"), trace: sel.figures.cardRatio.trace, value: <Ratio v={sel.figures.cardRatio} locale={locale} /> },
                  ]}
                />
              </div>
              <div className="card">
                <KvList
                  locale={locale}
                  items={[
                    { id: "expenses", label: t("dailyClose.totalExpenses"), trace: sel.expenses.trace, value: <Mad v={sel.expenses} locale={locale} /> },
                    { id: "remittance", label: t("dailyClose.columns.remittance"), trace: sel.figures.remittance.trace, value: <Mad v={sel.figures.remittance} locale={locale} /> },
                    { id: "expensesInclRemittance", label: t("dailyClose.columns.expenses"), trace: sel.figures.expensesInclRemittance.trace, value: <Mad v={sel.figures.expensesInclRemittance} locale={locale} /> },
                    { id: "remittanceRatio", label: t("dailyClose.columns.remittanceRatio"), trace: sel.figures.remittanceRatio.trace, value: <Ratio v={sel.figures.remittanceRatio} locale={locale} /> },
                  ]}
                />
              </div>
            </div>
          )}

          <h2>{t("dailyClose.expenseLines")}</h2>
          {sel.lines.length === 0 ? (
            <p className="notice">{t("dailyClose.noMovements")}</p>
          ) : (
            <div className="table-wrap">
              <table data-table="movements">
                <thead>
                  <tr>
                    <th scope="col">{t("cashCount.movementTime")}</th>
                    <th scope="col">{t("dailyClose.expenseLines")}</th>
                    <th scope="col" className="num">
                      {t("dailyClose.totalExpenses")}
                      <TraceTag trace={{ field: "ST-02" }} locale={locale} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sel.lines.map((line) => (
                    <tr key={line.id} data-kind={line.kind}>
                      <td>
                        <EventTime instant={line.occurredAt} locale={locale} timeZone={branch.timezone} />
                      </td>
                      <td>{t(`dailyClose.kind.${line.kind}`)}</td>
                      <td className="num">
                        <Mad v={line.amount} locale={locale} />
                        <TraceTag trace={line.amount.trace} locale={locale} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="legend">
            {t("common.timezone")}: {branch.timezone}
          </p>
        </section>
      ) : null}
    </>
  );
}
