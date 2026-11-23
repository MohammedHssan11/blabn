import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { readOrders } from "@/modules/replenishment/data";
import { DateText, OrderStatusBadge, ReplenishmentTabs } from "@/modules/replenishment/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("replenishment.orders.title") : undefined };
}

/** Purchase orders with every date kept apart: business date, creation, original and current expected receipt, actual receipts. */
export default async function OrdersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/replenishment/orders`;
  const access = await requireAccess({ locale, path, require: { permission: "inventory.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const { orders } = await readOrders();
  const canCreate = holds(access, "purchase_order.propose", OPERATING_BRANCH_CODE);

  return (
    <>
      <h1>{t("replenishment.orders.title")}</h1>
      <p className="lead">{t("replenishment.orders.intro")}</p>
      <ReplenishmentTabs locale={locale} t={t} active="orders" settings={holds(access, "admin.config.manage")} />
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      {canCreate ? <p><Link href={`${path}/new`} data-link="new-order">{t("replenishment.manualOrder")}</Link></p> : null}
      {orders.length === 0 ? <p className="legend" data-empty>{t("replenishment.orders.none")}</p> : (
        <div className="table-wrap">
          <table data-table="orders">
            <thead>
              <tr>
                <th scope="col">{t("replenishment.order.number")}</th>
                <th scope="col">{t("replenishment.col.status")}</th>
                <th scope="col">{t("replenishment.dates.businessDate")}</th>
                <th scope="col">{t("replenishment.dates.created")}</th>
                <th scope="col">{t("replenishment.dates.originalExpected")}</th>
                <th scope="col">{t("replenishment.dates.currentExpected")}</th>
                <th scope="col">{t("replenishment.dates.actualReceipts")}</th>
                <th scope="col" className="numeric">{t("replenishment.orders.openLines")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} data-order={o.order_no} data-origin={o.origin}>
                  <th scope="row"><Link href={`${path}/${o.id}`}>PO-{o.order_no}</Link>
                    {o.origin === "legacy" ? <div className="legend">{t("replenishment.order.legacy", { cell: `${o.source_file} ${o.source_cell}` })}</div> : null}</th>
                  <td><OrderStatusBadge status={o.status} open={o.open_lines} t={t} /></td>
                  <td data-col="business-date"><DateText date={o.business_date} locale={locale} style="short" /></td>
                  <td data-col="created"><span dir="ltr">{o.created_local?.replace("T", " ") ?? "—"}</span></td>
                  <td data-col="original-expected"><DateText date={o.original_expected?.date} locale={locale} style="short" />
                    {o.original_expected?.source_value ? <div className="legend" dir="ltr">{o.original_expected.source_value}</div> : null}</td>
                  <td data-col="expected"><DateText date={o.expected?.date} locale={locale} style="short" />
                    {o.expected?.kind === "override" ? <span className="badge pending"> {t("replenishment.dates.overridden")}</span> : null}</td>
                  <td data-col="receipts">{o.receipt_dates.length === 0 ? <span className="muted">—</span>
                    : o.receipt_dates.map((d) => <div key={d}><DateText date={d} locale={locale} style="short" /></div>)}</td>
                  <td className="numeric">{o.open_lines} / {o.lines_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
