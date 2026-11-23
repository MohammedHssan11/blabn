import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { isCatalogId } from "@/modules/catalog/forms";
import { readUnits } from "@/modules/catalog/data";
import { itemName, unitName } from "@/modules/catalog/ui";
import { readStockOptions } from "@/modules/inventory/stock";
import { readPlan } from "@/modules/replenishment/data";
import type { ItemPlanJson } from "@/modules/replenishment/types";
import { DateText, PoForm, Qty, ReplenishmentTabs } from "@/modules/replenishment/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("replenishment.new.title") : undefined };
}

const MANUAL_ROWS = 5;

/** A decimal the quantity field accepts, when the suggestion has one; otherwise blank. */
function decimalInput(value: { num: string; den: string } | null): string {
  if (!value) return "";
  let den = BigInt(value.den);
  let twos = 0, fives = 0;
  while (den % 2n === 0n) { den /= 2n; twos++; }
  while (den % 5n === 0n) { den /= 5n; fives++; }
  const places = Math.max(twos, fives);
  if (den !== 1n || places > 3) return "";
  const scaled = (BigInt(value.num) * 10n ** BigInt(places)) / BigInt(value.den);
  const text = scaled.toString().padStart(places + 1, "0");
  return places === 0 ? text : `${text.slice(0, -places)}.${text.slice(-places)}`.replace(/\.?0+$/, "");
}

/**
 * Create a purchase order. Lines chosen from the plan carry the suggestion: a different final
 * quantity needs a reason. Items in review, and the blank rows below, are manual lines. The
 * database sets the business date, the creation time and the default expected receipt date.
 */
export default async function NewOrderPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/replenishment/orders/new`;
  const access = await requireAccess({ locale, path, require: { permission: "purchase_order.propose", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const chosen = [...new Set((Array.isArray(sp.item) ? sp.item : sp.item ? [sp.item] : []).filter(isCatalogId).map((x) => x.toLowerCase()))].slice(0, 30);
  const [plan, options, units] = await Promise.all([readPlan(null), readStockOptions(), readUnits()]);
  const planned: ItemPlanJson[] = chosen.map((id) => plan.items.find((i) => i.item_id === id)).filter((i): i is ItemPlanJson => Boolean(i));
  const back = `${path}${chosen.length ? `?${chosen.map((id) => `item=${id}`).join("&")}` : ""}`;
  const rows = planned.length + MANUAL_ROWS;

  return (
    <>
      <h1>{t("replenishment.new.title")}</h1>
      <p className="lead">{t("replenishment.new.intro")}</p>
      <ReplenishmentTabs locale={locale} t={t} active="orders" settings={holds(access, "admin.config.manage")} />
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <p data-section="new-dates">
        {t("replenishment.new.dates")}{" "}
        <DateText date={plan.order_date} locale={locale} /> → <strong data-default-expected={plan.default_expected}><DateText date={plan.default_expected} locale={locale} /></strong>
      </p>

      <PoForm command="create" locale={locale} back={back} label={t("replenishment.new.title")}>
        <input type="hidden" name="rows" value={rows} />
        {planned.length > 0 ? <h2>{t("replenishment.new.fromPlan")}</h2> : null}
        {planned.map((item, i) => (
          <fieldset key={item.item_id} className="stack" data-line={item.name_ar} data-status={item.status}>
            <legend>{itemName(item, locale)} ({unitName(item.base_unit, units, locale)})</legend>
            <input type="hidden" name={`item.${i}`} value={item.item_id} />
            <input type="hidden" name={`from_plan.${i}`} value="1" />
            {item.suggested ? <input type="hidden" name={`suggested.${i}`} value={`${item.suggested.num}/${item.suggested.den}`} /> : null}
            <p className="legend">
              {item.status === "recommend"
                ? <>{t("replenishment.col.suggested")}: <Qty value={item.suggested} /></>
                : t("replenishment.new.reviewLine")}
            </p>
            <label>{t("replenishment.col.source")}
              <select name={`source.${i}`} defaultValue={item.source ?? "factory"} required>
                <option value="factory">{t("replenishment.source.factory")}</option>
                <option value="store">{t("replenishment.source.store")}</option>
              </select>
            </label>
            <label>{t("replenishment.new.unit")}
              <select name={`unit.${i}`} defaultValue="">
                <option value="">{t("stock.form.baseUnit")}</option>
                {units.map((u) => <option key={u.code} value={u.code}>{locale === "en" ? u.name_en : u.name_ar}</option>)}
              </select>
            </label>
            <label>{t("replenishment.new.final")}
              <input name={`quantity.${i}`} inputMode="decimal" dir="ltr" autoComplete="off" defaultValue={decimalInput(item.suggested)} />
            </label>
            {item.status === "recommend" ? (
              <label>{t("replenishment.new.reason")} ({t("replenishment.new.reasonHint")})<input name={`reason.${i}`} maxLength={500} /></label>
            ) : null}
          </fieldset>
        ))}

        <h2>{t("replenishment.new.manual")}</h2>
        <p className="legend">{t("replenishment.new.manualHint")}</p>
        {Array.from({ length: MANUAL_ROWS }, (_, k) => planned.length + k).map((i) => (
          <fieldset key={i} className="stack" data-manual-row={i}>
            <legend>{t("replenishment.new.line", { n: i + 1 })}</legend>
            <label>{t("stock.form.item")}
              <select name={`item.${i}`} defaultValue="">
                <option value="">{t("stock.form.chooseItem")}</option>
                {options.map((o) => <option key={o.id} value={o.id}>{itemName(o, locale)} ({unitName(o.base_unit, units, locale)})</option>)}
              </select>
            </label>
            <label>{t("replenishment.col.source")}
              <select name={`source.${i}`} defaultValue="factory">
                <option value="factory">{t("replenishment.source.factory")}</option>
                <option value="store">{t("replenishment.source.store")}</option>
              </select>
            </label>
            <label>{t("replenishment.new.unit")}
              <select name={`unit.${i}`} defaultValue="">
                <option value="">{t("stock.form.baseUnit")}</option>
                {units.map((u) => <option key={u.code} value={u.code}>{locale === "en" ? u.name_en : u.name_ar}</option>)}
              </select>
            </label>
            <label>{t("replenishment.new.final")}<input name={`quantity.${i}`} inputMode="decimal" dir="ltr" autoComplete="off" /></label>
          </fieldset>
        ))}
        <label>{t("stock.form.note")} ({t("common.optional")})<input name="note" maxLength={500} /></label>
        <div className="row-actions"><button type="submit">{t("replenishment.new.submit")}</button></div>
      </PoForm>
    </>
  );
}
