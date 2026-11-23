import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { MessageKey, Translator } from "@/i18n/dictionary";
import { formatBusinessDate } from "@/i18n/format";
import { Quantity } from "@/modules/catalog/ui";
import { purchaseOrderAction } from "./actions";
import type { PurchaseOrderCommand } from "./forms";
import type { FractionJson } from "./planning";
import type { OrderStatus } from "./types";

/** Server-rendered pieces of the replenishment screens. They format what the database calculated. */

/** An exact quantity; blank (—) when there is none. 0 is shown as 0, never as blank. */
export function Qty({ value, signed = false }: { value: FractionJson | null | undefined; signed?: boolean }) {
  if (!value) return <span className="muted" data-qty="blank">—</span>;
  const negative = value.num.startsWith("-");
  const num = negative ? value.num.slice(1) : value.num;
  const sign = negative ? "−" : signed && num !== "0" ? "+" : "";
  return <span dir="ltr" data-q={`${value.num}/${value.den}`}>{sign}<Quantity num={num} den={value.den} /></span>;
}

export function DateText({ date, locale, style = "long" }: { date: string | null | undefined; locale: Locale; style?: "long" | "short" | "weekday" }) {
  if (!date) return <span className="muted" data-date="blank">—</span>;
  return <time dateTime={date} data-date={date}>{formatBusinessDate(date, locale, style)}</time>;
}

export function ReplenishmentTabs({ locale, t, active, settings }: { locale: Locale; t: Translator; active: "plan" | "orders" | "settings"; settings: boolean }) {
  const base = `/${locale}/replenishment`;
  return (
    <ul className="chips" aria-label={t("replenishment.title")} data-nav="replenishment">
      <li><Link href={base} aria-current={active === "plan" ? "true" : undefined} data-tab="plan">{t("replenishment.tabs.plan")}</Link></li>
      <li><Link href={`${base}/orders`} aria-current={active === "orders" ? "true" : undefined} data-tab="orders">{t("replenishment.tabs.orders")}</Link></li>
      {settings ? (
        <li><Link href={`${base}/settings`} aria-current={active === "settings" ? "true" : undefined} data-tab="settings">{t("replenishment.tabs.settings")}</Link></li>
      ) : null}
    </ul>
  );
}

export function OrderStatusBadge({ status, open, t }: { status: OrderStatus; open?: number; t: Translator }) {
  const closed = status === "approved" && open === 0;
  const tone = status === "rejected" ? "bad" : closed || status === "historical" ? "" : status === "approved" ? "ok" : "pending";
  return (
    <span className={`badge ${tone}`} data-status={closed ? "closed" : status}>
      {t(`replenishment.status.${closed ? "closed" : status}` as MessageKey)}
    </span>
  );
}

/** Every purchase-order form posts to the same checked action with a request identifier fixed at render time. */
export function PoForm({ command, locale, back, children, className = "card stack", label }: {
  command: PurchaseOrderCommand; locale: Locale; back: string; children?: ReactNode; className?: string; label?: string;
}) {
  return (
    <form action={purchaseOrderAction} className={className} data-form={`po-${command}`} aria-label={label}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="command" value={command} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="request" value={crypto.randomUUID()} />
      {children}
    </form>
  );
}

export function sourceLabel(t: Translator, source: string | null): string {
  return source === "factory" || source === "store" ? t(`replenishment.source.${source}` as MessageKey) : t("replenishment.settings.notSet");
}
