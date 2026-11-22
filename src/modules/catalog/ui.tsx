import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { MessageKey, Translator } from "@/i18n/dictionary";
import type { CatalogItem, ConsumptionLine, Fraction, SourceRef, Unit } from "./data";
import { fractionToDecimal, type ReviewKind } from "./forms";

/** Server-rendered pieces shared by the catalog screens. They only format; the database decides. */

export function itemName(item: { name_ar: string; name_en: string | null }, locale: Locale): string {
  return locale === "en" ? (item.name_en ?? item.name_ar) : item.name_ar;
}

export function unitName(code: string | null | undefined, units: Unit[], locale: Locale): string {
  if (!code) return "—";
  const unit = units.find((u) => u.code === code);
  return unit ? (locale === "en" ? unit.name_en : unit.name_ar) : code;
}

export function CatalogTabs({ locale, t, active, openCount }: { locale: Locale; t: Translator; active: "items" | "review" | "recipes" | "consumption"; openCount?: number }) {
  const base = `/${locale}/catalog`;
  const tabs = [
    { key: "items", href: base, label: t("catalog.tabs.items") },
    { key: "review", href: `${base}/review`, label: t("catalog.tabs.review") },
    { key: "recipes", href: `${base}/recipes`, label: t("catalog.tabs.recipes") },
    { key: "consumption", href: `${base}/consumption`, label: t("catalog.tabs.consumption") },
  ] as const;
  return (
    <ul className="chips" aria-label={t("catalog.title")} data-nav="catalog">
      {tabs.map((tab) => (
        <li key={tab.key}>
          <Link href={tab.href} aria-current={tab.key === active ? "true" : undefined} data-tab={tab.key}>
            {tab.label}
            {tab.key === "review" && openCount ? <span className="badge pending" data-open-count={openCount}> {openCount}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A quantity as the decimal it equals, with the exact fraction when the decimal is a rounding. */
export function Quantity({ num, den, t }: { num: string | number; den: string | number; t?: Translator }) {
  const { text, exact } = fractionToDecimal(num, den);
  const fraction = `${num}/${den}`;
  return (
    <span dir="ltr" className="amount" data-qty={fraction} title={exact ? undefined : t ? t("catalog.consumption.inexact", { num: String(num), den: String(den) }) : fraction}>
      {text}
      {exact ? null : <span className="muted"> ≈</span>}
    </span>
  );
}

export function FractionValue({ value, t }: { value: Fraction; t?: Translator }) {
  return <Quantity num={value.num} den={value.den} t={t} />;
}

export function StatusBadge({ status, t }: { status: "active" | "discontinued"; t: Translator }) {
  return <span className={`badge ${status === "active" ? "ok" : "bad"}`}>{t(`catalog.status.${status}` as MessageKey)}</span>;
}

/** The exact workbook rows or report lines an entry is about. */
export function SourceRefs({ refs, t }: { refs: SourceRef[]; t: Translator }) {
  if (!refs || refs.length === 0) return null;
  return (
    <ul className="plain-list" data-refs>
      {refs.map((ref, index) => {
        const parts: string[] = [];
        if (ref.source) parts.push(ref.source);
        if (ref.sheet) parts.push(t("catalog.review.sheet", { name: ref.sheet }));
        if (ref.row !== undefined) parts.push(t("catalog.review.row", { n: ref.row }));
        if (ref.cell) parts.push(ref.cell);
        return (
          <li key={index} data-ref-row={ref.row}>
            <span dir="ltr">{parts.join(" · ")}</span>
            {ref.recipe ? <span> «{ref.recipe}»</span> : null}
            {ref.label ? <span> «{ref.label}»</span> : null}
            {ref.unit_label !== undefined ? <span> {ref.unit_label === null ? "—" : `«${ref.unit_label}»`}</span> : null}
            {ref.quantity !== undefined && ref.quantity !== null ? <span dir="ltr"> × {ref.quantity}</span> : null}
            {ref.amount ? <span dir="ltr"> ({ref.amount})</span> : null}
            {ref.written ? <span dir="ltr"> [{ref.written}]</span> : null}
            {ref.note ? <span className="muted"> {ref.note}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function reviewKindKey(kind: ReviewKind, field: "name" | "help"): MessageKey {
  return `catalog.review.kinds.${kind}.${field}` as MessageKey;
}

export function reasonText(reason: ConsumptionLine["reasons"][number], t: Translator, locale: Locale, units: Unit[]): string {
  const known = new Set([
    "invalid_quantity", "unknown_product", "unmapped_name", "mapping_pending", "mapping_rejected", "no_recipe", "recipe_not_approved",
    "no_recipe_for_date", "recipe_empty", "recipe_line_incomplete", "unit_missing", "base_unit_missing", "unit_incompatible",
  ]);
  if (!known.has(reason.code)) return t("catalog.consumption.reason.unknown", { code: reason.code });
  const component = locale === "en" ? (reason.component_en ?? reason.component_ar ?? "—") : (reason.component_ar ?? "—");
  return t(`catalog.consumption.reason.${reason.code}` as MessageKey, {
    line: reason.line_no ?? "—",
    component,
    unit: unitName(reason.unit, units, locale),
    base: unitName(reason.base_unit, units, locale),
  });
}

export function itemLabel(item: Pick<CatalogItem, "name_ar" | "name_en">, locale: Locale): string {
  return itemName(item, locale);
}
