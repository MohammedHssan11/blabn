import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { formatEventTime, formatMad, formatMadSigned } from "@/i18n/format";
import { first, type SearchParams } from "@/lib/search-params";
import { OperationWorkspace } from "@/modules/closing/operation-workspace";
import { usesDemoFixtures } from "@/modules/closing/operations";
import { requireAccess } from "@/modules/access/guard";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import type { CashCountSnapshot } from "@/modules/closing/calc";
import { getCashCountView } from "@/modules/closing/service";
import { awaitingPhase, requireField } from "@/modules/reports/field-map";
import { traced } from "@/modules/reports/trace";
import { DateText, EventTime, Mad, TraceTag } from "@/components/values";
import { KvList } from "@/components/KvList";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("cashCount.title") : undefined };
}

const STATUS_CLASS: Record<CashCountSnapshot["status"], string> = {
  match: "ok",
  over: "warn",
  short: "bad",
  not_counted: "",
  cannot_reconcile: "warn",
};

export default async function CashCountPage({
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
  const access = await requireAccess({ locale, path: `/${locale}/cash-count`, require: { permission: "daily_close.view", branch: branchCode } });
  // Only the operating branch has daily-close data.
  if (branchCode !== OPERATING_BRANCH_CODE) notFound();
  if (!usesDemoFixtures()) return <OperationWorkspace locale={locale} screen="cash-count" access={access} branch={branchCode} search={sp} />;
  const t = createTranslator(locale);
  const view = await getCashCountView(first(sp.date), first(sp.counted));
  const { branch, saved, preview } = view;
  const base = `/${locale}/cash-count`;
  const tz = branch.timezone;

  return (
    <>
      <h1>{t("cashCount.title")}</h1>
      <p className="lead">{t("cashCount.intro")}</p>
      <p className="legend">
        {t("common.blankMeaning")} {t("common.zeroMeaning")} {t("common.traceHint")}{" "}
        {t("common.dataSource", { version: view.dataVersion })} · {t("common.calculatedOnServer")}
      </p>

      <h2>{t("cashCount.chooseDay")}</h2>
      <ul className="chips" aria-label={t("cashCount.chooseDay")}>
        {view.availableDates.map((date) => (
          <li key={date}>
            <Link href={`${base}?date=${date}`} aria-current={date === view.businessDate ? "true" : undefined}>
              <DateText v={traced(date, {})} locale={locale} style="short" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="legend">
        {t("common.businessDate")}: <DateText v={traced(view.businessDate, {})} locale={locale} /> · {t("common.timezone")}: {tz}
      </p>

      {!view.dayFound ? <p className="notice warn">{t("cashCount.dayNoRecord")}</p> : null}
      {view.dayFound && !view.dayClosed ? <p className="notice warn">{t("cashCount.dayNotClosed")}</p> : null}

      {view.dayClosed ? (
        <>
          <h2>{t("cashCount.dayFigures")}</h2>
          <div className="two-col">
            <div className="card" data-section="day-figures">
              <KvList
                locale={locale}
                items={[
                  { id: "opening", label: t("cashCount.opening"), trace: view.opening.trace, value: <Mad v={view.opening} locale={locale} /> },
                  { id: "systemRevenue", label: t("cashCount.systemRevenue"), trace: view.systemRevenue.trace, value: <Mad v={view.systemRevenue} locale={locale} /> },
                  { id: "card", label: t("cashCount.card"), trace: view.card.trace, value: <Mad v={view.card} locale={locale} /> },
                  { id: "expenses", label: t("dailyClose.totalExpenses"), trace: view.expenses.trace, value: <Mad v={view.expenses} locale={locale} /> },
                ]}
              />
            </div>
            <div className="card" data-section="movements">
              <strong>{t("cashCount.movements")}</strong>
              {view.movements.length === 0 ? (
                <p className="legend">{t("dailyClose.noMovements")}</p>
              ) : (
                <ul className="kv-list">
                  {view.movements.map((m) => (
                    <li className="kv-row" key={m.id} data-kind={m.kind}>
                      <span className="label">
                        {t(`dailyClose.kind.${m.kind}`)} · <EventTime instant={m.occurredAt} locale={locale} timeZone={tz} />
                        <TraceTag trace={m.amount.trace} locale={locale} />
                      </span>
                      <span className="value">
                        <Mad v={m.amount} locale={locale} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <h2>{t("cashCount.savedCount")}</h2>
          {saved ? (
            <div className="two-col" data-section="saved-count">
              <div className="card">
                <KvList
                  locale={locale}
                  items={[
                    { id: "counted", label: t("cashCount.counted"), trace: saved.countedAmount.trace, value: <Mad v={saved.countedAmount} locale={locale} /> },
                    { id: "expected", label: t("cashCount.expected"), trace: saved.expected.trace, value: <Mad v={saved.expected} locale={locale} /> },
                    { id: "variance", label: t("cashCount.variance"), trace: saved.variance.trace, value: <Mad v={saved.variance} locale={locale} signed strong /> },
                    { id: "statementTotal", label: t("cashCount.statementTotal"), trace: saved.statementTotal.trace, value: <Mad v={saved.statementTotal} locale={locale} /> },
                  ]}
                />
                <p className={`notice ${STATUS_CLASS[saved.status]}`} data-status={saved.status} style={{ marginTop: 10 }}>
                  {t(`cashCount.status.${saved.status}`)}
                </p>
              </div>
              <div className="card">
                <KvList
                  locale={locale}
                  items={[
                    { id: "countedAt", label: `${t("cashCount.countedAt")} (${t("common.eventTime")})`, value: <EventTime instant={saved.countedAt} locale={locale} timeZone={tz} /> },
                    {
                      id: "countBusinessDate",
                      label: t("cashCount.businessDateOfCount"),
                      value: <DateText v={traced(saved.derivedBusinessDate, { record: `cash_counts` })} locale={locale} style="short" />,
                    },
                  ]}
                />
                <p className={`notice ${saved.recalculationMatches ? "ok" : "bad"}`} data-recalc={saved.recalculationMatches ? "ok" : "differs"} style={{ marginTop: 10 }}>
                  {saved.recalculationMatches ? t("cashCount.recalcOk") : t("cashCount.recalcDiffers")}
                </p>
              </div>

              <div className="card" data-section="after-count">
                <strong>{t("cashCount.afterCount")}</strong>
                <p className="legend">{t("cashCount.afterCountNote")}</p>
                {saved.later.length === 0 ? (
                  <p className="legend">{t("cashCount.noLater")}</p>
                ) : (
                  <KvList
                    locale={locale}
                    items={[
                      ...saved.later.map((m) => ({
                        id: m.id,
                        label: `${t(`dailyClose.kind.${m.kind}`)} · ${formatEventTime(m.occurredAt, locale, tz)}`,
                        trace: m.amount.trace,
                        value: <Mad v={m.amount} locale={locale} />,
                      })),
                      { id: "drawerAfter", label: t("cashCount.drawerAfter"), trace: saved.drawerAfterLater.trace, value: <Mad v={saved.drawerAfterLater} locale={locale} strong /> },
                      { id: "variance-unchanged", label: t("cashCount.variance"), trace: saved.variance.trace, value: <Mad v={saved.variance} locale={locale} signed strong /> },
                    ]}
                  />
                )}
              </div>
            </div>
          ) : (
            <p className="notice" data-status="not_counted">
              {t("cashCount.noCount")}
            </p>
          )}

          <p className="legend">
            {t("cashCount.expectedAtClose")}: <Mad v={view.expectedAtClose} locale={locale} />
          </p>

          <h2>{t("cashCount.previewTitle")}</h2>
          <div className="card" data-section="preview">
            <p className="legend" style={{ marginTop: 0 }}>
              {t("cashCount.previewHelp", { time: preview.asOf ? formatEventTime(preview.asOf, locale, tz) : "—" })}
            </p>
            <form className="inline" method="get" action={base}>
              <input type="hidden" name="date" value={view.businessDate} />
              <label>
                {t("cashCount.countedInput")}
                <input
                  type="text"
                  name="counted"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={preview.raw}
                  aria-invalid={preview.error ? "true" : undefined}
                  aria-describedby={preview.error ? "counted-error" : undefined}
                />
              </label>
              <button type="submit">{t("common.show")}</button>
            </form>
            {preview.error ? (
              <p id="counted-error" role="alert" className="notice bad" style={{ marginTop: 10 }}>
                {t(preview.error === "invalid_amount" ? "validation.invalidAmount" : "validation.negativeAmount")}
              </p>
            ) : null}
            {preview.snapshot ? (
              <div style={{ marginTop: 10 }} data-section="preview-result">
                <strong>{t("cashCount.previewResult")}</strong> <span className="badge">{t("common.notSaved")}</span>
                <KvList
                  locale={locale}
                  items={[
                    { id: "p-counted", label: t("cashCount.counted"), value: <span className="amount" data-blank={preview.snapshot.countedAmount === null ? "true" : undefined}>{formatMad(preview.snapshot.countedAmount, locale)}</span> },
                    { id: "p-expected", label: t("cashCount.expected"), value: <span className="amount">{formatMad(preview.snapshot.expectedCash, locale)}</span> },
                    { id: "p-variance", label: t("cashCount.variance"), trace: { field: "ST-08" }, value: <span className="amount" data-variance={preview.snapshot.variance ?? "blank"}>{formatMadSigned(preview.snapshot.variance, locale)}</span> },
                  ]}
                />
                <p className={`notice ${STATUS_CLASS[preview.snapshot.status]}`} data-status={preview.snapshot.status}>
                  {t(`cashCount.status.${preview.snapshot.status}`)}
                </p>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {view.pendingFields.length ? <><h2>{t("cashCount.pendingTitle")}</h2>
      <div className="card" data-section="pending">
        <p style={{ marginTop: 0 }}>{t("cashCount.pendingBody")}</p>
        <ul className="kv-list">
          {view.pendingFields.map((id) => {
            const field = requireField(id);
            const phase = awaitingPhase(field);
            return (
              <li className="kv-row" key={id} data-pending-field={id}>
                <span className="label">
                  {locale === "ar" ? field.field_ar : field.field_en}
                  <TraceTag trace={{ field: id }} locale={locale} />
                </span>
                <span className="value">
                  <span className="badge pending">{phase ? t("common.awaitingPhase", { n: phase }) : t("common.pending")}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div></> : null}
    </>
  );
}
