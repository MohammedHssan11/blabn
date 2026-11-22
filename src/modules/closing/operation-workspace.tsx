import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { createTranslator, type Translator } from "@/i18n/dictionary";
import { formatBusinessDate, formatCount, formatMonth, formatMad, formatMadSigned, formatRatio } from "@/i18n/format";
import { isBusinessDate, isMonth } from "@/lib/dates";
import { averageMinor, ratioBp } from "@/lib/money";
import { first, type SearchParams } from "@/lib/search-params";
import { holds, type ActiveAccess } from "@/modules/access/session";
import {
  readOperatingAccounts, readOperatingPeople, readOperatingReport, ReportBasisNotFound, type Command, type OperatingData, type OperatingReport, type OperatingSummary,
} from "./operations";
import { AccountFields, CancellationFields, CountFields, DayFields, EntryFields, OperatingForm, type FormContext, type OperatingScreen } from "./operation-forms";

const posted = (state: string) => state === "closed" || state === "corrected";

function LocalTime({ value }: { value: string | null | undefined }) {
  return value ? <time dir="ltr">{value.replace("T", " ")}</time> : <>—</>;
}

function Panel({ title, children, initiallyOpen = false }: { title: string; children: ReactNode; initiallyOpen?: boolean }) {
  return <details className="card ops-panel" open={initiallyOpen || undefined}>
    <summary>{title}</summary>
    {children}
  </details>;
}

function DayReports({ data, summary, locale, detailed = true }: {
  data: OperatingData; summary: OperatingSummary; locale: Locale; detailed?: boolean;
}) {
  const t = createTranslator(locale);
  const money = (value?: number | null) => formatMad(value ?? null, locale);
  const count = data.count;
  return <div className="ops-reports">
    <section className="card" data-report="daily-statement">
      <h2>{t("operations.statement")}</h2>
      <dl className="ops-values">
        <div data-field="ST-07"><dt>{t("operations.sales")}</dt><dd>{money(data.sales)}</dd></div>
        <div data-field="ST-05"><dt>{t("operations.card")}</dt><dd>{money(data.card)}</dd></div>
        <div data-field="ST-03"><dt>{t("operations.statementExpenses")}</dt><dd>{money(summary.expenses + summary.remittances)}</dd></div>
        <div><dt>{t("operations.expected")}</dt><dd>{money(summary.expected)}</dd></div>
        <div data-field="ST-04"><dt>{t("operations.counted")}</dt><dd>{money(count?.total)}</dd></div>
        <div data-field="ST-08"><dt>{t("operations.variance")}</dt><dd data-variance={summary.variance ?? "blank"}>{formatMadSigned(summary.variance, locale)}</dd></div>
        <div data-field="ST-06"><dt>{t("operations.statementTotal")}</dt><dd>{money(summary.statementTotal)}</dd></div>
        <div data-field="ST-09"><dt>{t("operations.counter")}</dt>
          <dd>{count ? `${count.counter.name} · ${t("operations.manager")}` : "—"}</dd></div>
        <div><dt>{t("operations.countRecorder")}</dt><dd>{count?.recorderName ?? "—"}</dd></div>
        <div><dt>{t("operations.countedAt")}</dt><dd><LocalTime value={count?.local} /></dd></div>
      </dl>
      <p className="legend">{!count ? t("operations.noCount") : summary.expected == null
        ? t("operations.incomplete") : summary.variance === 0 ? t("operations.match")
        : summary.variance! > 0 ? t("operations.over") : t("operations.short")}</p>
      {detailed && data.entries.some((entry) => entry.kind === "cash_expense" || entry.kind === "remittance") ? <ul data-field="ST-02">
        {data.entries.filter((entry) => !entry.reversedBy && (entry.kind === "cash_expense" || entry.kind === "remittance"))
          .map((entry) => <li key={entry.id}>{t(`operations.kind.${entry.kind}`)} · {money(entry.amount)} · <LocalTime value={entry.local} /></li>)}
      </ul> : null}
      {count && detailed ? <details>
        <summary>{t("operations.denominations")}</summary>
        <ul>{Object.entries(count.quantities).sort(([a], [b]) => Number(b) - Number(a)).map(([denomination, qty]) =>
          <li key={denomination}>{money(Number(denomination))} × {formatCount(qty, locale)}</li>)}</ul>
      </details> : null}
    </section>

    <section className="card" data-report="yawmeya">
      <h2>{t("operations.yawmeya")}</h2>
      <dl className="ops-values">
        <div data-field="LG-02"><dt>{t("operations.morning")}</dt><dd>{money(data.morning)}</dd></div>
        <div data-field="LG-02"><dt>{t("operations.evening")}</dt><dd>{money(data.evening)}</dd></div>
        <div><dt>{t("operations.posCash")}</dt><dd>{money(data.posCash)}</dd></div>
        <div data-field="LG-03"><dt>{t("operations.card")}</dt><dd>{money(data.card)}</dd></div>
        <div data-field="LG-06"><dt>{t("operations.openingCash")}</dt><dd>{money(summary.openingCash)}</dd></div>
        <div><dt>{t("operations.cashReceipts")}</dt><dd>{money(summary.receipts)}</dd></div>
        <div><dt>{t("operations.cashExpenses")}</dt><dd>{money(summary.expenses)}</dd></div>
        <div data-field="DS-06"><dt>{t("operations.remittances")}</dt><dd>{money(summary.remittances)}</dd></div>
        <div data-field="LG-06"><dt>{t("operations.closingCash")}</dt><dd>{money(summary.closingCash)}</dd></div>
        <div data-field="LG-07"><dt>{t("operations.openingCustody")}</dt><dd>{money(summary.openingCustody)}</dd></div>
        <div><dt>{t("operations.custodyReceipts")}</dt><dd>{money(summary.custodyReceipts)}</dd></div>
        <div><dt>{t("operations.custodyExpenses")}</dt><dd>{money(summary.custodyExpenses)}</dd></div>
        <div data-field="LG-07"><dt>{t("operations.closingCustody")}</dt><dd>{money(summary.closingCustody)}</dd></div>
        <div data-field="LG-05"><dt>{t("operations.variance")}</dt><dd data-variance={summary.variance ?? "blank"}>{formatMadSigned(summary.variance, locale)}</dd></div>
        <div data-field="LG-08"><dt>{t("operations.cashier")}</dt><dd>{data.cashier?.name ?? "—"}</dd></div>
        <div data-field="LG-08"><dt>{t("operations.counter")}</dt><dd>{count?.counter.name ?? "—"}</dd></div>
        <div><dt>{t("operations.shift")}</dt><dd>{data.shift ? t(`operations.shifts.${data.shift}`) : "—"}</dd></div>
      </dl>
      {detailed && data.notes ? <p>{data.notes}</p> : null}
    </section>
  </div>;
}

function Ledgers({ data, context, canReverse, draft }: { data: OperatingData; context: FormContext; canReverse: boolean; draft?: boolean }) {
  const { locale } = context;
  const t = createTranslator(locale);
  return <>
    <h2>{t("operations.entries")}</h2>
    {data.entries.length === 0 ? <p className="legend">{t("operations.noEntries")}</p> : (
      <div className="table-wrap"><table data-table="cash-and-custody">
        <thead><tr>{(["entryAt", "entryKind", "amount", "account", "bankReference", "notes"] as const).map((key) =>
          <th key={key} scope="col">{t(`operations.${key}`)}</th>)}
          {canReverse ? <th scope="col">{t("operations.correction")}</th> : null}</tr></thead>
        <tbody>{data.entries.map((entry) => <tr key={entry.id} data-entry={entry.kind} data-reversed={!!entry.reversedBy}>
          <td><LocalTime value={entry.local} /></td><td>{t(`operations.kind.${entry.kind}`)}</td>
          <td>{formatMad(entry.amount, locale)}</td><td>{entry.account ?? "—"}</td><td>{entry.reference ?? "—"}</td><td>{entry.note || "—"}
            {entry.reversedBy ? <span className="badge">{t("operations.reversed")}</span> : null}</td>
          {canReverse ? <td>{entry.reversedBy ? null : <details><summary>{t("operations.reverse")}</summary>
            <OperatingForm context={context} command={draft ? "reverse_entry" : "propose"} change={draft ? null : "reverse_entry"} target={entry.id} />
          </details>}</td> : null}
        </tr>)}</tbody>
      </table></div>
    )}
    <h2>{t("operations.cancellations")}</h2>
    {data.cancellations.length === 0 ? <p className="legend">{t("operations.noEntries")}</p> :
      <div className="table-wrap"><table data-table="cancellations">
        <thead><tr><th scope="col">{t("operations.original")}</th><th scope="col">{t("operations.originalAt")}</th>
          <th scope="col">{t("operations.cancelledAt")}</th><th scope="col">{t("operations.replacement")}</th>
          <th scope="col">{t("operations.cancellationReason")}</th>
          {canReverse ? <th scope="col">{t("operations.correction")}</th> : null}</tr></thead>
        <tbody>{data.cancellations.map((entry) => <tr key={entry.id} data-reversed={!!entry.reversedBy}>
          <td>{entry.original} · {formatMad(entry.originalAmount, locale)}</td>
          <td><LocalTime value={entry.originalLocal} /></td><td><LocalTime value={entry.local} /></td>
          <td>{entry.replacement ?? "—"} · {formatMad(entry.replacementAmount, locale)}</td><td>{entry.note}
            {entry.reversedBy ? <span className="badge">{t("operations.reversed")}</span> : null}</td>
          {canReverse ? <td>{entry.reversedBy ? null : <details><summary>{t("operations.reverse")}</summary>
            <OperatingForm context={context} command={draft ? "reverse_cancellation" : "propose"} change={draft ? null : "reverse_cancellation"} target={entry.id} />
          </details>}</td> : null}
        </tr>)}</tbody>
      </table></div>}
  </>;
}

function SalesMonth({ report, month, date, locale }: { report: OperatingReport; month: string; date: string; locale: Locale }) {
  const t = createTranslator(locale);
  const totals = { sales: 0, orders: 0, card: 0, expenses: 0, remittances: 0, days: 0, orderCoverage: true };
  for (const row of report.days.filter((row) => posted(row.state))) {
    totals.sales += row.sales ?? 0;
    totals.orders += row.orders ?? 0;
    totals.card += row.card ?? 0;
    totals.expenses += row.summary.expenses + row.summary.remittances;
    totals.remittances += row.summary.remittances;
    totals.days += 1;
    if (row.orders === null) totals.orderCoverage = false;
  }
  const money = (value: number | null) => formatMad(value, locale);
  return (
    <section>
      <h2 data-title-field="DS-11">{t("dailyClose.reportTitle", {
        branch: locale === "ar" ? report.branch.nameAr : report.branch.nameEn,
        month: formatMonth(month, locale),
      })}</h2>
      <form className="inline" method="get">
        <label>{t("dailyClose.month")}<input type="month" name="month" defaultValue={month} required /></label>
        <button type="submit">{t("common.show")}</button>
      </form>
      <div className="table-wrap">
        <table data-table="daily-sales">
          <thead><tr>{(["date", "sales", "orders", "average", "expenses", "remittance", "remittanceRatio", "card", "cardRatio"] as const).map((key) =>
            <th key={key} scope="col">{t(`dailyClose.columns.${key}`)}</th>)}</tr></thead>
          <tbody>{report.days.map((row) => <tr key={row.date} data-state={row.state}>
            <th scope="row" data-field="DS-01"><Link href={`/${locale}/daily-close?date=${row.date}`} aria-current={row.date === date ? "date" : undefined}>
              {formatBusinessDate(row.date, locale, "short")}</Link>
              {!posted(row.state) ? <span className="badge">{t(`operations.state.${row.state}`)}</span> : null}</th>
            <td data-field="DS-02">{money(row.sales)}</td><td data-field="DS-03">{formatCount(row.orders, locale)}</td>
            <td data-field="DS-04">{money(row.summary.average)}</td>
            <td data-field="DS-05">{money(row.summary.expenses + row.summary.remittances)}</td>
            <td data-field="DS-06">{money(row.summary.remittances)}</td><td data-field="DS-07">{formatRatio(row.summary.remittanceRatio, locale)}</td>
            <td data-field="DS-08">{money(row.card)}</td><td data-field="DS-09">{formatRatio(row.summary.cardRatio, locale)}</td>
          </tr>)}</tbody>
          {totals.days ? <tfoot><tr data-field="DS-10">
            <th scope="row">{t("operations.postedTotals")}</th><td>{money(totals.sales)}</td>
            <td>{formatCount(totals.orderCoverage ? totals.orders : null, locale)}</td>
            <td>{money(totals.orderCoverage ? averageMinor(totals.sales, totals.orders) : null)}</td>
            <td>{money(totals.expenses)}</td><td>{money(totals.remittances)}</td>
            <td>{formatRatio(ratioBp(totals.remittances, totals.sales), locale)}</td><td>{money(totals.card)}</td>
            <td>{formatRatio(ratioBp(totals.card, totals.sales), locale)}</td>
          </tr></tfoot> : null}
        </table>
      </div>
    </section>
  );
}

const errorKeys = ["invalid", "conflict", "duplicate", "denied", "unavailable"] as const;

function Notice({ t, search }: { t: Translator; search: SearchParams }) {
  const error = errorKeys.find((key) => key === first(search.error));
  if (error) return <p role="alert" className="notice bad">{t(`operations.error.${error}`)}</p>;
  return first(search.saved) ? <p role="status" className="notice ok">{t("operations.saved")}</p> : null;
}

export async function OperationWorkspace({ locale, screen, access, branch, search }: {
  locale: Locale; screen: OperatingScreen; access: ActiveAccess; branch: string; search: SearchParams;
}) {
  const t = createTranslator(locale);
  const candidate = first(search.date)?.replace(/^0000-/, "");
  const selectedMonth = first(search.month)?.replace(/^0000-/, "");
  const requestedBasis = Number(first(search.basis));
  const basis = Number.isSafeInteger(requestedBasis) && requestedBasis > 0 ? requestedBasis : null;
  const report = await readOperatingReport(isBusinessDate(candidate) ? candidate : null,
    isMonth(selectedMonth) ? selectedMonth : isBusinessDate(candidate) ? candidate.slice(0, 7) : null, basis).catch((error: unknown) => {
      if (error instanceof ReportBasisNotFound) notFound();
      throw error;
    });
  const date = isBusinessDate(candidate) ? candidate : isMonth(selectedMonth) ? `${selectedMonth}-01` : report.branch.today;
  const month = date.slice(0, 7);
  const view = isBusinessDate(candidate) && (!isMonth(selectedMonth) || selectedMonth === month)
    ? report : await readOperatingReport(date, month, basis);
  const { day } = view;
  const canDraft = !basis && date <= view.branch.today && holds(access, "daily_close.draft", branch);
  const canManage = !basis && holds(access, "daily_close.close", branch);
  const canCount = !basis && (canManage || holds(access, "cash_count.enter", branch));
  const canConfigure = !basis && screen === "daily-close" && holds(access, "admin.config.manage");
  const [people, accounts] = await Promise.all([
    canDraft || canCount ? readOperatingPeople() : [],
    canDraft || canManage || canConfigure ? readOperatingAccounts() : [],
  ]);
  const base = `/${locale}/${screen}`;
  const isPosted = day && posted(day.state);
  const readOnly = !!basis;
  const pending = day?.proposal;
  const context: FormContext = {
    locale, screen, date, people, accounts, revision: day?.revision ?? 0, firstDay: !view.hasDays,
    data: day?.data, actor: access.userId,
    local: date === view.branch.today ? view.branch.local : `${date}T23:00`,
  };
  const reviewCommands: Command[] = pending && canManage ? ["approve", "reject"]
    : day?.state === "awaiting_review" && canManage ? ["close", "return"]
    : day?.state === "draft" && canDraft ? ["submit"] : [];

  return <>
    <h1>{t(screen === "cash-count" ? "cashCount.title" : "dailyClose.title")}</h1>
    <form className="inline" action={base} method="get">
      <label>{t("common.businessDate")}<input type="date" name="date" defaultValue={date} required /></label>
      <button type="submit">{t("common.show")}</button>
    </form>
    <p className="legend">{view.branch.timezone} · {t("operations.cutoff", { time: view.branch.cutoff })}</p>
    <Notice t={t} search={search} />
    {readOnly ? <p className="notice">{t("operations.historical", { basis })} <Link href={`${base}?date=${date}`}>{t("operations.current")}</Link></p> : null}
    {screen === "daily-close" ? <SalesMonth report={view} date={date} month={month} locale={locale} /> : null}
    <div className="ops-day-heading">
      <h2>{formatBusinessDate(date, locale)}</h2>
      {day ? <span className="badge" data-day-state={day.state} data-day-revision={day.revision}>{t(`operations.state.${day.state}`)}</span> : null}
      {day?.closedLocal ? <span className="legend">{t("operations.closedAt")} <LocalTime value={day.closedLocal} /></span> : null}
    </div>
    <p><Link href={`/${locale}/${screen === "daily-close" ? "cash-count" : "daily-close"}?date=${date}${basis ? `&basis=${basis}` : ""}`}>
      {t(screen === "daily-close" ? "nav.cashCount" : "nav.dailyClose")}
    </Link></p>
    {!day ? <p className="notice">{t("operations.noDay")}</p> : null}
    {canDraft && (!day || day.state === "draft") && screen === "daily-close" ? (
      <Panel title={t("operations.editDay")} initiallyOpen={!day}>
        <OperatingForm context={context} command="save"><DayFields context={context} /></OperatingForm>
      </Panel>
    ) : null}
    {day && canCount && !isPosted ? (
      <Panel title={t("operations.enterCount")} initiallyOpen={screen === "cash-count"}>
        <OperatingForm context={context} command="count"><CountFields context={context} /></OperatingForm>
      </Panel>
    ) : null}
    {day?.state === "draft" && canDraft && screen === "daily-close" ? <>
      <Panel title={t("operations.enterEntry")}>
        <OperatingForm context={context} command="entry"><EntryFields context={context} /></OperatingForm>
      </Panel>
      <Panel title={t("operations.enterCancellation")}>
        <OperatingForm context={context} command="cancel_order"><CancellationFields context={context} /></OperatingForm>
      </Panel>
    </> : null}
    {day ? <>
      <div className="ops-buttons">{reviewCommands.map((command) =>
        <OperatingForm key={command} context={context} command={command} danger={command === "return" || command === "reject"} />)}</div>
      {pending ? <section className="notice warn">
        <h3>{t("operations.pendingCorrection")}</h3><p>{pending.reason}</p>
        <DayReports data={pending.data} summary={pending.summary} locale={locale} detailed={false} />
        {screen === "daily-close" && (pending.change === "entry" || pending.change === "reverse_entry"
          || pending.change === "cancel_order" || pending.change === "reverse_cancellation")
          ? <Ledgers data={pending.data} context={context} canReverse={false} /> : null}
      </section> : null}
      <DayReports data={day.data} summary={day.summary} locale={locale} />
      {screen === "daily-close" ? <Ledgers data={day.data} context={context} draft={day.state === "draft"} canReverse={(day.state === "draft" && canDraft) || (!!isPosted && canManage && !pending)} /> : null}
      {isPosted && canManage && !pending ? <>
        <Panel title={t("operations.command.late_remittance")}>
          <OperatingForm context={context} command="late_remittance"><EntryFields context={context} remittance /></OperatingForm>
        </Panel>
        <Panel title={t("operations.correction")}>
          <Panel title={t("operations.editDay")}><OperatingForm context={context} command="propose" change="save">
            <DayFields context={context} />
          </OperatingForm></Panel>
          <Panel title={t("operations.enterCount")}><OperatingForm context={context} command="propose" change="count">
            <CountFields context={context} />
          </OperatingForm></Panel>
          <Panel title={t("operations.enterEntry")}><OperatingForm context={context} command="propose" change="entry">
            <EntryFields context={context} />
          </OperatingForm></Panel>
          <Panel title={t("operations.enterCancellation")}><OperatingForm context={context} command="propose" change="cancel_order">
            <CancellationFields context={context} />
          </OperatingForm></Panel>
        </Panel>
      </> : null}
      <Panel title={t("operations.history")}>
        <ol className="ops-history">{day.history.map((event) => <li key={event.revision}>
          <Link href={`${base}?date=${date}&basis=${event.basis}`}>#{event.revision}</Link>
          {" · "}{t(`operations.command.${event.command}`)}{" · "}{event.actor}{" · "}<LocalTime value={event.local} />
          {event.sourceRevision ? ` · #${event.sourceRevision}` : ""}{event.reason ? ` · ${event.reason}` : ""}
        </li>)}</ol>
      </Panel>
      {holds(access, "daily_close.export_draft", branch) && view.basis ? <p>
        <a href={`/api/exports/daily-close-draft?date=${date}&basis=${view.basis}`}>{t("operations.download")}</a>
      </p> : null}
    </> : null}
    {canConfigure ? <section id="ledger-accounts">
      <Panel title={t("operations.accountSettings")}>
        <Panel title={t("operations.newAccount")}><AccountFields context={context} /></Panel>
        {accounts.map((account) => <Panel key={account.id} title={`${account.code} · ${account.label}`}>
          <AccountFields context={context} account={account} />
        </Panel>)}
      </Panel>
    </section> : null}
  </>;
}
