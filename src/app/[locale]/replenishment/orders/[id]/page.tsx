import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { KvList } from "@/components/KvList";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { isCatalogId } from "@/modules/catalog/forms";
import { readUnits } from "@/modules/catalog/data";
import { itemName, unitName } from "@/modules/catalog/ui";
import { readOrder } from "@/modules/replenishment/data";
import { DateText, OrderStatusBadge, PoForm, Qty, ReplenishmentTabs, sourceLabel } from "@/modules/replenishment/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("replenishment.order.title") : undefined };
}

/**
 * One purchase order: its dates (business date, creation, original and overridden expected receipt,
 * actual receipts), its lines (suggested, final, override reason, received, cancelled, outstanding)
 * and the forms each person may use: approve, change the expected date, receive, cancel the rest.
 */
export default async function OrderPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<SearchParams> }) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !isCatalogId(id)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/replenishment/orders/${id.toLowerCase()}`;
  const access = await requireAccess({ locale, path, require: { permission: "inventory.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const [order, units] = await Promise.all([readOrder(id.toLowerCase()), readUnits()]);
  if (!order) notFound();
  const can = (permission: Parameters<typeof holds>[1]) => holds(access, permission, OPERATING_BRANCH_CODE);
  const lines = order.lines ?? [];
  const open = lines.filter((l) => !l.outstanding.num.startsWith("-") && l.outstanding.num !== "0");
  const openOrder = (order.status === "proposed" || order.status === "approved") && open.length > 0;
  const nowLocal = order.local ?? "";

  return (
    <>
      <h1>PO-{order.order_no}</h1>
      <p className="lead">{t("replenishment.order.intro")}</p>
      <ReplenishmentTabs locale={locale} t={t} active="orders" settings={holds(access, "admin.config.manage")} />
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />

      <div className="grid-2">
        <section className="card stack" data-section="order-dates">
          <h2>{t("replenishment.dates.title")}</h2>
          <KvList locale={locale} items={[
            { id: "status", label: t("replenishment.col.status"), value: <OrderStatusBadge status={order.status} open={order.open_lines} t={t} /> },
            { id: "business-date", label: t("replenishment.dates.businessDate"), value: <DateText date={order.business_date} locale={locale} /> },
            { id: "created", label: t("replenishment.dates.created"), value: order.created_local ? <span dir="ltr">{order.created_local.replace("T", " ")}</span> : <span className="muted">{t("replenishment.order.noCreation")}</span> },
            { id: "created-by", label: t("replenishment.order.createdBy"), value: order.created_by },
            { id: "original-expected", label: t("replenishment.dates.originalExpected"), value: <DateText date={order.original_expected?.date} locale={locale} /> },
            { id: "expected", label: t("replenishment.dates.currentExpected"), value: <DateText date={order.expected?.date} locale={locale} /> },
            { id: "receipts", label: t("replenishment.dates.actualReceipts"), value: order.receipt_dates.length
              ? <span className="stack-tight">{order.receipt_dates.map((d) => <DateText key={d} date={d} locale={locale} />)}</span>
              : <span className="muted">{t("replenishment.order.noReceipt")}</span> },
            { id: "decided", label: t("replenishment.order.decidedBy"), value: order.decided_by
              ? <span>{order.decided_by} · <span dir="ltr">{order.decided_local?.replace("T", " ")}</span></span> : <span className="muted">—</span> },
          ]} />
          {order.original_expected?.rule ? <p className="legend" data-rule>{order.original_expected.kind === "legacy"
            ? t("replenishment.order.legacyRule", { value: order.original_expected.source_value ?? "", cell: `${order.source_file} ${order.source_cell}` })
            : t("replenishment.order.defaultRule", { days: (order.original_expected.rule.match(/\+ (\d+)/)?.[1]) ?? "2" })}</p> : null}
          {order.decision_note ? <p className="legend">{order.decision_note}</p> : null}
          {order.note ? <p className="legend">{order.note}</p> : null}
        </section>

        <section className="card stack" data-section="expected-history">
          <h2>{t("replenishment.order.expectedHistory")}</h2>
          <ol className="plain-list">
            {(order.dates ?? []).map((d) => (
              <li key={d.revision} data-revision={d.revision} data-kind={d.kind}>
                <DateText date={d.date} locale={locale} /> · {t(`replenishment.dateKind.${d.kind}` as MessageKey)}
                {d.reason ? <> · {d.reason}</> : null}
                {d.source_value ? <> · <span dir="ltr">{d.source_value}</span></> : null}
                {" · "}{d.actor} · <span dir="ltr">{d.local.replace("T", " ")}</span>
              </li>
            ))}
          </ol>
          {openOrder && (can("purchase_order.propose") || can("purchase_order.approve")) ? (
            <PoForm command="set_expected" locale={locale} back={path} className="stack" label={t("replenishment.order.changeExpected")}>
              <input type="hidden" name="order" value={order.id} />
              <label>{t("replenishment.order.newExpected")}<input type="date" name="date" min={order.business_date ?? undefined} required /></label>
              <label>{t("replenishment.order.reason")}<input name="reason" required maxLength={500} /></label>
              <div className="row-actions"><button type="submit">{t("replenishment.order.changeExpected")}</button></div>
            </PoForm>
          ) : null}
        </section>
      </div>

      <section className="stack" data-section="lines">
        <h2>{t("replenishment.order.lines")}</h2>
        <div className="table-wrap">
          <table data-table="lines">
            <thead>
              <tr>
                <th scope="col">{t("replenishment.col.item")}</th>
                <th scope="col">{t("replenishment.col.source")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.suggested")}</th>
                <th scope="col" className="numeric">{t("replenishment.new.final")}</th>
                <th scope="col">{t("replenishment.order.overrideReason")}</th>
                <th scope="col" className="numeric">{t("replenishment.order.received")}</th>
                <th scope="col" className="numeric">{t("replenishment.order.cancelled")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.outstanding")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} data-line={l.name_ar} data-line-no={l.line_no}>
                  <th scope="row"><Link href={`/${locale}/replenishment/items/${l.item_id}`}>{itemName(l, locale)}</Link></th>
                  <td>{sourceLabel(t, l.source)}</td>
                  <td className="numeric" data-col="suggested">{l.suggested ? <><Qty value={l.suggested} /> <span className="legend">{unitName(l.base_unit, units, locale)}</span></>
                    : <span className="muted">{t("replenishment.order.manual")}</span>}</td>
                  <td className="numeric" data-col="final"><Qty value={l.final} /> <span className="legend">{unitName(l.unit, units, locale)}</span></td>
                  <td data-col="override">{l.override_reason ?? <span className="muted">—</span>}</td>
                  <td className="numeric" data-col="received"><Qty value={l.received} /></td>
                  <td className="numeric" data-col="cancelled"><Qty value={l.cancelled} />
                    {l.cancellations.map((c, i) => <div key={i} className="legend">{c.reason}</div>)}</td>
                  <td className="numeric" data-col="outstanding"><Qty value={l.outstanding} signed={l.outstanding.num.startsWith("-")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lines.some((l) => l.plan) ? (
          <details data-section="line-plans">
            <summary>{t("replenishment.order.planSnapshot")}</summary>
            <ul className="plain-list">
              {lines.filter((l) => l.plan).map((l) => (
                <li key={l.id}>{itemName(l, locale)}: <Qty value={l.plan!.forecast} /> + <Qty value={l.plan!.safety} /> − <Qty value={l.plan!.usable} /> − <Qty value={l.plan!.eligible_incoming} />
                  {" = "}<Qty value={l.plan!.raw} signed /> → <Qty value={l.plan!.suggested} /> (<DateText date={l.plan!.expected} locale={locale} style="short" />)</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <div className="grid-2">
        {order.status === "proposed" && can("purchase_order.approve") ? (
          <section className="card stack" data-section="decide">
            <h2>{t("replenishment.order.decide")}</h2>
            <PoForm command="approve" locale={locale} back={path} className="row-actions" label={t("replenishment.order.approve")}>
              <input type="hidden" name="order" value={order.id} />
              <button type="submit">{t("replenishment.order.approve")}</button>
            </PoForm>
            <PoForm command="reject" locale={locale} back={path} className="stack" label={t("replenishment.order.reject")}>
              <input type="hidden" name="order" value={order.id} />
              <label>{t("replenishment.order.reason")}<input name="reason" required maxLength={500} /></label>
              <div className="row-actions"><button type="submit" className="secondary">{t("replenishment.order.reject")}</button></div>
            </PoForm>
          </section>
        ) : null}

        {order.status === "approved" && open.length > 0 && can("purchase_order.receive") ? (
          <PoForm command="receive" locale={locale} back={path} label={t("replenishment.order.receive")}>
            <h2>{t("replenishment.order.receive")}</h2>
            <p className="legend">{t("replenishment.order.receiveHint")}</p>
            <input type="hidden" name="order" value={order.id} />
            <input type="hidden" name="rows" value={lines.length} />
            <label>{t("replenishment.order.receivedAt")}<input type="datetime-local" name="local" defaultValue={nowLocal} max={nowLocal} required /></label>
            {lines.map((l, i) => (
              <fieldset key={l.id} className="stack" data-receive-line={l.name_ar}>
                <legend>{itemName(l, locale)} · {t("replenishment.col.outstanding")}: <Qty value={l.outstanding} /> {unitName(l.unit, units, locale)}</legend>
                <input type="hidden" name={`line.${i}`} value={l.id} />
                <label>{t("replenishment.order.receivedQty")}<input name={`quantity.${i}`} inputMode="decimal" dir="ltr" autoComplete="off" /></label>
                <label>{t("replenishment.order.overReceipt")} ({t("common.optional")})<input name={`over.${i}`} maxLength={500} /></label>
              </fieldset>
            ))}
            <label>{t("stock.form.reference")} ({t("common.optional")})<input name="reference" maxLength={100} /></label>
            <div className="row-actions"><button type="submit">{t("replenishment.order.saveReceipt")}</button></div>
          </PoForm>
        ) : null}

        {order.status === "approved" && open.length > 0 && can("purchase_order.approve") ? (
          <section className="card stack" data-section="cancel">
            <h2>{t("replenishment.order.cancelRest")}</h2>
            <p className="legend">{t("replenishment.order.cancelHint")}</p>
            {open.map((l) => (
              <PoForm key={l.id} command="cancel_rest" locale={locale} back={path} className="stack" label={`${t("replenishment.order.cancelRest")} ${itemName(l, locale)}`}>
                <input type="hidden" name="line" value={l.id} />
                <p>{itemName(l, locale)}: <Qty value={l.outstanding} /> {unitName(l.unit, units, locale)}</p>
                <label>{t("replenishment.order.reason")}<input name="reason" required maxLength={500} /></label>
                <div className="row-actions"><button type="submit" className="secondary">{t("replenishment.order.cancelRest")}</button></div>
              </PoForm>
            ))}
          </section>
        ) : null}
      </div>

      <section className="stack" data-section="receipts">
        <h2>{t("replenishment.order.receipts")}</h2>
        {(order.receipts ?? []).length === 0 ? <p className="legend">{t("replenishment.order.noReceipt")}</p> : (
          <ul className="plain-list">
            {(order.receipts ?? []).map((r) => (
              <li key={r.id} data-receipt={r.business_date}>
                <DateText date={r.business_date} locale={locale} /> · <span dir="ltr">{r.local.replace("T", " ")}</span> · {r.actor}
                {r.reference ? <> · {r.reference}</> : null}
                {" · "}{r.lines.map((x) => {
                  const line = lines.find((l) => l.id === x.line);
                  return <span key={x.movement} data-receipt-line={x.quantity}>{line ? itemName(line, locale) : ""} {x.quantity}{x.over_receipt_reason ? ` (${t("replenishment.order.overReceipt")}: ${x.over_receipt_reason})` : ""} </span>;
                })}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack" data-section="events">
        <h2>{t("replenishment.order.events")}</h2>
        <ul className="plain-list">
          {(order.events ?? []).map((e, i) => (
            <li key={i} data-event={e.command}>
              <span dir="ltr">{e.local.replace("T", " ")}</span> · {t(`replenishment.command.${e.command}` as MessageKey)} · {e.actor}
              {" · "}{t("replenishment.dates.businessDate")} <DateText date={e.business_date} locale={locale} style="short" />
              {e.reason ? <> · {e.reason}</> : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
