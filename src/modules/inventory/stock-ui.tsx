import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { MessageKey, Translator } from "@/i18n/dictionary";
import { Quantity } from "@/modules/catalog/ui";
import type { Fraction } from "@/modules/catalog/data";
import { stockCommandAction } from "./stock-actions";
import type { StockCommand } from "./stock-forms";

/** Server-rendered pieces of the stock screens. They format what the database calculated. */

/** A signed exact quantity; blank (—) when there is none. Zero is shown as 0, never as blank. */
export function SignedQuantity({ value, t, signed = false }: { value: Fraction | null | undefined; t: Translator; signed?: boolean }) {
  if (!value) return <span className="muted" data-qty="blank">—</span>;
  const negative = value.num.startsWith("-");
  const num = negative ? value.num.slice(1) : value.num;
  const sign = negative ? "−" : signed && num !== "0" ? "+" : "";
  return <span dir="ltr" data-signed={value.num + "/" + value.den}>{sign}<Quantity num={num} den={value.den} t={t} /></span>;
}

export function StockTabs({ locale, t, active, date }: { locale: Locale; t: Translator; active: "day" | "mix"; date: string }) {
  const base = `/${locale}/inventory`;
  return (
    <ul className="chips" aria-label={t("stock.title")} data-nav="stock">
      <li><Link href={`${base}?date=${date}`} aria-current={active === "day" ? "true" : undefined} data-tab="day">{t("stock.tabs.day")}</Link></li>
      <li><Link href={`${base}/product-mix?date=${date}`} aria-current={active === "mix" ? "true" : undefined} data-tab="mix">{t("stock.tabs.mix")}</Link></li>
    </ul>
  );
}

/** Every stock form posts to the same checked action with a request identifier fixed at render time. */
export function StockForm({ command, date, locale, back, children, className = "card stack", label }: {
  command: StockCommand; date: string; locale: Locale; back: string; children?: ReactNode; className?: string; label?: string;
}) {
  return (
    <form action={stockCommandAction} className={className} data-form={command} aria-label={label}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="command" value={command} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="request" value={crypto.randomUUID()} />
      {children}
    </form>
  );
}

export function kindLabel(t: Translator, kind: string): string {
  return t(`stock.kind.${kind}` as MessageKey);
}
