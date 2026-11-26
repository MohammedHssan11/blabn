import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { createTranslator, type MessageKey, type Translator } from "@/i18n/dictionary";
import { formatBusinessDate, formatMonth } from "@/i18n/format";
import { type SearchParams } from "@/lib/search-params";
import { readBusinessToday } from "@/lib/database-time";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { COMPARISON_BRANCH_CODES } from "@/modules/access/catalog";
import { BRANCH_ORDER, type BranchInfo } from "@/modules/comparisons/calc";
import {
  getComparison,
  parseComparisonQuery,
  queryString,
  SAMPLE_CURRENT_DATES,
  type DayCell,
  type MonthlyView,
  type WeeklyView,
} from "@/modules/comparisons/service";
import { Count, DateText, Mad, Ratio, TraceTag } from "@/components/values";
import { traced, type Traced } from "@/modules/reports/trace";
import type { Blank, RatioBp } from "@/lib/money";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("comparison.title") : undefined };
}

const branchName = (b: { nameEn: string; nameAr: string }, locale: Locale) => (locale === "ar" ? b.nameAr : b.nameEn);

function SourceNote({ cell, t, locale }: { cell: DayCell; t: Translator; locale: Locale }) {
  const s = cell.source;
  if (!s) return null;
  const label = s.origin === "entry"
    ? (locale === "ar" ? s.labelAr : s.labelEn) ?? s.key
    : t(`comparison.source.${s.origin}` as MessageKey);
  return (
    <span className="cell-note" data-source={s.key} data-origin={s.origin}>
      {label} · {t("comparison.revision", { n: s.revision })}
      {s.historical ? <> · <span className="badge pending" data-historical="true">{t("comparison.historical")}</span></> : null}
      {s.reference ? <> · {t("comparison.reference", { reference: s.reference })}</> : null}
    </span>
  );
}

/** A branch figure, or a clear statement of why there is none. Never 0 for a missing value. */
function FigureCell({ cell, t, locale, kind }: { cell: DayCell; t: Translator; locale: Locale; kind: "sales" | "orders" }) {
  if (cell.status === "available") {
    return kind === "sales" ? <Mad v={cell.sales} locale={locale} /> : <Count v={cell.orders} locale={locale} />;
  }
  if (kind === "orders") return <Count v={cell.orders} locale={locale} />;
  const badge = cell.status === "missing" ? "pending" : "";
  return (
    <span className={`badge ${badge}`} data-missing={cell.status === "missing" ? "true" : undefined} data-unavailable={cell.status}>
      {t(`comparison.status.${cell.status}` as MessageKey)}
    </span>
  );
}

/** A percentage, or "Unavailable" with its reason. Never NaN, ∞ or an invented 0 %. */
function Percent({ v, reason, t, locale, reasons }: { v: Traced<Blank<RatioBp>>; reason: string; t: Translator; locale: Locale; reasons: string }) {
  if (v.value !== null) return <Ratio v={v} locale={locale} />;
  return (
    <span className="blank" data-ratio-unavailable={reason} data-field={v.trace.field}>
      {t("comparison.unavailable")}
      {reason !== "ok" ? <span className="cell-note">{t(`${reasons}.${reason}` as MessageKey)}</span> : null}
    </span>
  );
}

function BranchLegend({ branch, t, locale }: { branch: BranchInfo; t: Translator; locale: Locale }) {
  const date = branch.liveFrom ? formatBusinessDate(branch.liveFrom, locale, "short") : null;
  const parts = [
    date === null ? t("comparison.liveFromUnset")
      : branch.liveFromBasis === "first_close" ? t("comparison.liveFromFirstClose", { date }) : t("comparison.liveFrom", { date }),
  ];
  if (!branch.operatesInApp) {
    if (branch.liveSource === null && branch.entryOwner === null) parts.push(t("comparison.undecided"));
    if (branch.liveSource !== null) parts.push(t("comparison.liveSource", { source: (locale === "ar" ? branch.liveSourceAr : branch.liveSourceEn) ?? branch.liveSource }));
    if (branch.entryOwner !== null) parts.push(t("comparison.entryOwner", { name: branch.entryOwner }));
  }
  return (
    <li data-branch-settings={branch.code} data-live-from={branch.liveFrom ?? ""}>
      <strong>{branchName(branch, locale)}</strong>: {parts.join(" · ")}
    </li>
  );
}

function BranchSettings({ branches, t, locale }: { branches: BranchInfo[]; t: Translator; locale: Locale }) {
  return (
    <ul className="plain-list" data-section="branch-settings">
      {branches.map((b) => <BranchLegend key={b.code} branch={b} t={t} locale={locale} />)}
    </ul>
  );
}

function Weekly({ view, t, locale, historyBase }: { view: WeeklyView; t: Translator; locale: Locale; historyBase: string | null }) {
  const { total } = view;
  const names = (codes: string[]) => codes.map((c) => branchName(view.rows.find((r) => r.branch.code === c)!.branch, locale)).join(locale === "ar" ? "، " : ", ");
  const dateCell = (cell: DayCell) => cell.date.value === null ? null : (
    <span className="cell-note">{formatBusinessDate(cell.date.value, locale, "weekday")} {formatBusinessDate(cell.date.value, locale, "short")}</span>
  );
  return (
    <>
      <h2 data-section="dates">
        {t("comparison.currentDate")}: <DateText v={view.currentDate} locale={locale} /> · {t("comparison.priorDate")}:{" "}
        <DateText v={view.priorDate} locale={locale} />
        <TraceTag trace={view.currentDate.trace} locale={locale} inline />
      </h2>

      <section className={`notice ${total.incomplete ? "warn" : "ok"}`} data-section="coverage" data-completeness={total.incomplete ? "incomplete" : "complete"}>
        <strong>{t("comparison.coverageTitle")}</strong>{" "}
        {t("comparison.coverageWeekly", { current: total.currentCoverage.present, prior: total.priorCoverage.present, total: total.currentCoverage.total })}
        {total.missingCurrent.length > 0 ? <> {t("comparison.missingOn", { date: formatBusinessDate(view.currentDate.value, locale, "short"), branches: names(total.missingCurrent) })}</> : null}
        {total.missingPrior.length > 0 ? <> {t("comparison.missingOn", { date: formatBusinessDate(view.priorDate.value, locale, "short"), branches: names(total.missingPrior) })}</> : null}
        {!total.incomplete ? <> {t("comparison.allPresent")}</> : null}
      </section>
      <BranchSettings branches={view.rows.map((r) => r.branch)} t={t} locale={locale} />

      <div className="table-wrap">
        <table data-table="weekly-comparison">
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>{t("comparison.columns.branch")}</th>
              <th scope="colgroup" colSpan={2}>{t("comparison.columns.current")}</th>
              <th scope="colgroup" colSpan={2}>{t("comparison.columns.prior")}</th>
              <th scope="colgroup" colSpan={2}>{t("comparison.columns.difference")}</th>
              <th scope="col" rowSpan={2} className="num">{t("comparison.columns.ratio")}<TraceTag trace={{ field: "CMP-06" }} locale={locale} /></th>
            </tr>
            <tr>
              <th scope="col" className="num">{t("comparison.columns.sales")}<TraceTag trace={{ field: "CMP-07" }} locale={locale} /></th>
              <th scope="col" className="num">{t("comparison.columns.orders")}</th>
              <th scope="col" className="num">{t("comparison.columns.sales")}</th>
              <th scope="col" className="num">{t("comparison.columns.orders")}</th>
              <th scope="col" className="num">{t("comparison.columns.sales")}</th>
              <th scope="col" className="num">{t("comparison.columns.orders")}</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.branch.code} data-branch={row.branch.code}>
                <th scope="row">
                  {branchName(row.branch, locale)}
                  {historyBase && (row.current.source?.origin === "entry" || row.prior.source?.origin === "entry") ? (
                    <span className="cell-note">
                      <Link href={`${historyBase}?branch=${row.branch.code}&date=${row.current.date.value}`}>{t("comparison.history")}</Link>
                    </span>
                  ) : null}
                </th>
                <td className="num" data-col="current-sales" data-status={row.current.status} data-source={row.current.source?.key ?? "missing"}>
                  <FigureCell cell={row.current} t={t} locale={locale} kind="sales" />
                  {dateCell(row.current)}
                  <SourceNote cell={row.current} t={t} locale={locale} />
                </td>
                <td className="num" data-col="current-orders"><FigureCell cell={row.current} t={t} locale={locale} kind="orders" /></td>
                <td className="num" data-col="prior-sales" data-status={row.prior.status} data-source={row.prior.source?.key ?? "missing"}>
                  <FigureCell cell={row.prior} t={t} locale={locale} kind="sales" />
                  {dateCell(row.prior)}
                  <SourceNote cell={row.prior} t={t} locale={locale} />
                </td>
                <td className="num" data-col="prior-orders"><FigureCell cell={row.prior} t={t} locale={locale} kind="orders" /></td>
                <td className="num" data-col="sales-diff"><Mad v={row.salesDiff} locale={locale} signed /></td>
                <td className="num" data-col="orders-diff"><Count v={row.ordersDiff} locale={locale} /></td>
                <td className="num" data-col="ratio">
                  <Percent v={row.ratio} reason={row.ratioReason} t={t} locale={locale} reasons="comparison.ratioReason" />
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
              <td className="num" data-col="current-sales">
                <Mad v={total.currentSales} locale={locale} />
                <span className="cell-note" data-coverage="current">{t("comparison.coverage", { present: total.currentCoverage.present, total: total.currentCoverage.total })}</span>
              </td>
              <td className="num" data-col="current-orders"><Count v={total.currentOrders} locale={locale} /></td>
              <td className="num" data-col="prior-sales">
                <Mad v={total.priorSales} locale={locale} />
                <span className="cell-note" data-coverage="prior">{t("comparison.coverage", { present: total.priorCoverage.present, total: total.priorCoverage.total })}</span>
              </td>
              <td className="num" data-col="prior-orders"><Count v={total.priorOrders} locale={locale} /></td>
              <td className="num" data-col="sales-diff"><Mad v={total.salesDiff} locale={locale} signed /></td>
              <td className="num" data-col="orders-diff"><Count v={total.ordersDiff} locale={locale} /></td>
              <td className="num" data-col="ratio">
                <Percent v={total.ratio} reason={total.ratioReason} t={t} locale={locale} reasons="comparison.ratioReason" />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={`notice ${total.incomplete ? "warn" : "ok"}`} data-total-note>
        {total.incomplete ? t("comparison.incomplete") : t("comparison.complete")}
      </p>
    </>
  );
}

function Monthly({ view, t, locale }: { view: MonthlyView; t: Translator; locale: Locale }) {
  const { result } = view;
  const list = (items: Array<{ date: string; branches: string[] }>) =>
    items.length === 0 ? t("comparison.none") : items.map((d) => formatBusinessDate(d.date, locale, "short")).join(locale === "ar" ? "، " : ", ");
  const sideCell = (side: MonthlyView["rows"][number]["current"]) => {
    if (side.status === "no_such_day" || side.status === "future" || side.status === "missing" || side.status === "before_live") {
      return <span className={`badge ${side.status === "missing" ? "pending" : ""}`} data-missing={side.status === "missing" ? "true" : undefined} data-unavailable={side.status}>
        {t(`comparison.status.${side.status}` as MessageKey)}</span>;
    }
    return <><Mad v={side.sales} locale={locale} />{side.status === "partial" ? <span className="cell-note" data-partial="true">{t("comparison.coverage", { present: side.present, total: side.total })}</span> : null}</>;
  };
  return (
    <>
      <h2 data-section="months">
        {t("comparison.month")}: {formatMonth(view.currentMonth, locale)} · {t("comparison.priorMonth")}: {formatMonth(view.priorMonth, locale)}
        <TraceTag trace={{ field: "CMP-01" }} locale={locale} inline />
      </h2>

      <section className={`notice ${result.missingDays.length > 0 || result.inProgress ? "warn" : "ok"}`} data-section="coverage"
        data-comparable-days={view.period.comparableDays} data-in-progress={result.inProgress ? "true" : "false"}>
        <strong>{t("comparison.coverageTitle")}</strong>{" "}
        {result.inProgress ? <>{t("comparison.inProgress", { elapsed: result.elapsedDays, days: result.monthDays })} </> : null}
        {t("comparison.comparableDays", { n: view.period.comparableDays })}.
        <br />{t("comparison.missingDays")}: <span data-missing-days={result.missingDays.length}>{list(result.missingDays)}</span>
        {result.beforeLiveDays.length > 0 ? <><br />{t("comparison.beforeLiveDays")}: <span data-before-live-days={result.beforeLiveDays.length}>{list(result.beforeLiveDays)}</span></> : null}
      </section>
      <BranchSettings branches={view.branches.map((b) => b.branch)} t={t} locale={locale} />

      <h2>{t("comparison.periodTitle")}<TraceTag trace={{ field: "CMP-04" }} locale={locale} inline /></h2>
      <div className="table-wrap">
        <table data-table="monthly-period">
          <thead>
            <tr>
              <th scope="col">{t("comparison.columns.branch")}</th>
              <th scope="col" className="num">{t("comparison.columns.current")}</th>
              <th scope="col" className="num">{t("comparison.columns.prior")}</th>
              <th scope="col" className="num">{t("comparison.columns.growth")}</th>
            </tr>
          </thead>
          <tbody>
            {view.branches.map((b) => (
              <tr key={b.branch.code} data-branch={b.branch.code}>
                <th scope="row">{branchName(b.branch, locale)}
                  <span className="cell-note">{t("comparison.columns.current")}: {t("comparison.daysCoverage", { ...b.currentCoverage })} · {t("comparison.columns.prior")}: {t("comparison.daysCoverage", { ...b.priorCoverage })}</span>
                </th>
                <td className="num"><Mad v={traced(b.currentSales, { field: "CMP-02" })} locale={locale} /><span className="cell-note">{t("comparison.comparableDays", { n: b.comparableDays })}</span></td>
                <td className="num"><Mad v={traced(b.priorSales, { field: "CMP-02" })} locale={locale} /></td>
                <td className="num" data-col="growth"><Percent v={b.growthTraced} reason={b.growthReason} t={t} locale={locale} reasons="comparison.periodReason" /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-row="total">
              <th scope="row">{t("comparison.total")}<TraceTag trace={{ field: "CMP-08" }} locale={locale} /></th>
              <td className="num"><Mad v={traced(view.period.currentSales, { field: "CMP-04" })} locale={locale} /></td>
              <td className="num"><Mad v={traced(view.period.priorSales, { field: "CMP-04" })} locale={locale} /></td>
              <td className="num" data-col="growth"><Percent v={view.period.growthTraced} reason={view.period.growthReason} t={t} locale={locale} reasons="comparison.periodReason" /></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h2>{t("comparison.total")}</h2>
      <div className="table-wrap">
        <table data-table="monthly-days">
          <thead>
            <tr>
              <th scope="col">{t("comparison.columns.day")}</th>
              <th scope="col" className="num">{t("comparison.columns.current")}<TraceTag trace={{ field: "CMP-02" }} locale={locale} /></th>
              <th scope="col" className="num">{t("comparison.columns.orders")}</th>
              <th scope="col" className="num">{t("comparison.columns.prior")}</th>
              <th scope="col" className="num">{t("comparison.columns.orders")}</th>
              <th scope="col" className="num">{t("comparison.columns.growth")}<TraceTag trace={{ field: "CMP-03" }} locale={locale} /></th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.day} data-day={r.day} data-comparable={r.comparable ? "true" : "false"}>
                <th scope="row">{r.day}</th>
                <td className="num" data-col="current" data-status={r.current.status}>{sideCell(r.current)}</td>
                <td className="num"><Count v={r.current.orders} locale={locale} /></td>
                <td className="num" data-col="prior" data-status={r.prior.status}>{sideCell(r.prior)}</td>
                <td className="num"><Count v={r.prior.orders} locale={locale} /></td>
                <td className="num" data-col="growth"><Percent v={r.growth} reason={r.growthReason} t={t} locale={locale} reasons="comparison.growthReason" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function ComparisonPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const base = `/${locale}/comparison`;
  // Signed in first (the default date is read from the database), then the permission for the branches.
  const asked = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => [v ?? []].flat().map((x): [string, string] => [k, x])));
  await requireAccess({ locale, path: asked.size > 0 ? `${base}?${asked}` : base });
  const query = parseComparisonQuery(sp, await readBusinessToday());
  // Viewing needs comparison.view for EVERY selected branch; the database checks it again.
  const access = await requireAccess({
    locale,
    path: `${base}?${queryString(query)}`,
    require: query.branches.map((branch) => ({ permission: "comparison.view" as const, branch })),
  });
  const t = createTranslator(locale);
  const model = await getComparison(query, "view");
  const canExport = query.branches.every((b) => holds(access, "comparison.export", b));
  const canEnter = COMPARISON_BRANCH_CODES.some((b) => holds(access, "comparison.enter", b));
  const canConfigure = holds(access, "admin.config.manage");
  const errorParam = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const noticeParam = Array.isArray(sp.notice) ? sp.notice[0] : sp.notice;

  return (
    <>
      <h1>{t("comparison.title")}</h1>
      <p className="lead">{t("comparison.intro")}</p>
      <ResultMessages t={t} error={errorParam} notice={noticeParam} />
      {model.source === "synthetic-fixtures" ? (
        <p className="legend">{t("comparison.demoData", { version: model.dataVersion ?? "" })} {t("common.blankMeaning")} {t("common.calculatedOnServer")}</p>
      ) : (
        <p className="legend">{t("common.blankMeaning")} {t("common.traceHint")} {t("common.calculatedOnServer")}</p>
      )}
      {query.invalid ? <p className="notice warn" role="alert">{t("comparison.invalidQuery")}</p> : null}

      <form className="card stack" method="get" action={base} data-form="comparison-query">
        <div className="filter-bar">
          <label>
            {t("comparison.mode")}
            <select name="mode" defaultValue={query.mode}>
              <option value="weekly">{t("comparison.modes.weekly")}</option>
              <option value="monthly">{t("comparison.modes.monthly")}</option>
            </select>
          </label>
          <label>{t("comparison.currentDate")}<input type="date" name="current" defaultValue={query.currentDate} /></label>
          <label>{t("comparison.month")}<input type="month" name="month" defaultValue={query.month} /></label>
        </div>
        <fieldset className="checks">
          <legend>{t("comparison.branches")}</legend>
          {BRANCH_ORDER.map((code) => {
            const b = model.names.find((x) => x.code === code);
            return (
              <label className="check" key={code}>
                <input type="checkbox" name="branches" value={code} defaultChecked={query.branches.includes(code)} />
                <span>{b ? branchName(b, locale) : code}</span>
              </label>
            );
          })}
        </fieldset>
        <div className="row-actions"><button type="submit">{t("comparison.show")}</button></div>
      </form>

      {model.source === "synthetic-fixtures" && query.mode === "weekly" ? (
        <>
          <h2>{t("comparison.sampleDates")}</h2>
          <ul className="chips">
            {SAMPLE_CURRENT_DATES.map((date) => (
              <li key={date}>
                <Link href={`${base}?current=${date}`} aria-current={date === query.currentDate ? "true" : undefined}>
                  <DateText v={traced(date, {})} locale={locale} style="short" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {model.view.mode === "weekly"
        ? <Weekly view={model.view} t={t} locale={locale} historyBase={model.source === "database" ? `${base}/history` : null} />
        : <Monthly view={model.view} t={t} locale={locale} />}

      <p className="legend">{t("comparison.reportingOnlyNote")}</p>
      <ul className="chips" data-section="comparison-links">
        {canExport ? <li><a href={`/api/exports/comparison?${queryString(query)}`} data-link="export">{t("comparison.export")}</a></li> : null}
        {canEnter ? <li><Link href={`${base}/entry`} data-link="entry">{t("comparison.links.entry")}</Link></li> : null}
        {canConfigure ? <li><Link href={`${base}/settings`} data-link="settings">{t("comparison.links.settings")}</Link></li> : null}
      </ul>
    </>
  );
}
