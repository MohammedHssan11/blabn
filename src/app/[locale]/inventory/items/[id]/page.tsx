import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { formatBusinessDate, formatEventDateTime } from "@/i18n/format";
import { addDays, businessDateOf } from "@/lib/dates";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { isCatalogId } from "@/modules/catalog/forms";
import { readUnits } from "@/modules/catalog/data";
import { FractionValue, itemName, unitName } from "@/modules/catalog/ui";
import { readItemHistory } from "@/modules/inventory/stock";
import { isStockDate } from "@/modules/inventory/stock-forms";
import { kindLabel, SignedQuantity, StockForm } from "@/modules/inventory/stock-ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("stock.history.title") : undefined };
}

export default async function StockItemPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<SearchParams> }) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !isCatalogId(id)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/inventory/items/${id}`;
  const access = await requireAccess({ locale, path, require: { permission: "inventory.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const to = isStockDate(first(sp.date)) ? (first(sp.date) as string) : businessDateOf(new Date(), "Africa/Casablanca", "02:00");
  const from = addDays(to, -30);
  const [history, units] = await Promise.all([readItemHistory(id, from, to), readUnits()]);
  if (!history.item) notFound();
  const back = `${path}?date=${to}`;
  const canReverseManual = (kind: string) =>
    holds(access, kind === "waste" ? "inventory.waste" : kind === "hospitality" ? "inventory.hospitality"
      : ["receipt", "purchase", "transfer_in", "return"].includes(kind) ? "inventory.receive"
      : kind === "opening" || kind === "adjustment" ? "inventory.adjust_approve" : kind === "consumption" ? "inventory.consume" : "inventory.adjust",
      OPERATING_BRANCH_CODE);
  const canCount = holds(access, "inventory.count", OPERATING_BRANCH_CODE);

  return (
    <>
      <p><Link href={`/${locale}/inventory?date=${to}`}>← {t("stock.title")}</Link></p>
      <h1>{itemName(history.item, locale)}</h1>
      <p className="lead">{t("stock.history.intro", { from: formatBusinessDate(from, locale, "short"), to: formatBusinessDate(to, locale, "short"), unit: unitName(history.item.base_unit, units, locale) })}</p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />

      <h2>{t("stock.history.movements")}</h2>
      {history.movements.length === 0 ? <p className="notice">{t("stock.history.none")}</p> : (
        <div className="table-wrap">
          <table data-table="stock-movements">
            <thead><tr>
              <th scope="col">{t("common.date")}</th><th scope="col">{t("stock.form.kind")}</th>
              <th scope="col" className="numeric">{t("stock.form.quantity")}</th><th scope="col">{t("stock.history.entered")}</th>
              <th scope="col">{t("stock.history.source")}</th><th scope="col">{t("stock.history.actor")}</th><th scope="col" />
            </tr></thead>
            <tbody>
              {history.movements.map((m) => (
                <tr key={m.id} data-movement={m.kind} data-source={m.source} data-reversed={m.reversed}>
                  <td>{formatBusinessDate(m.date, locale, "short")}<div className="legend" dir="ltr">{m.local.replace("T", " ")}</div></td>
                  <td>{kindLabel(t, m.kind)}{m.reverses ? <span className="badge">{t("stock.history.reversal")}</span> : null}
                    {m.reversed ? <span className="badge bad">{t("stock.history.reversed")}</span> : null}</td>
                  <td className="numeric"><SignedQuantity value={m.quantity} t={t} signed /></td>
                  <td dir="auto">{m.entered ? `${m.entered} ${unitName(m.unit, units, locale)}` : "—"}
                    {m.recipe_quantity ? <div className="legend">{t("stock.history.recipeLine")}: <FractionValue value={m.recipe_quantity} t={t} /> {unitName(m.recipe_unit, units, locale)}</div> : null}</td>
                  <td>{t(`stock.source.${m.source}` as MessageKey)}{m.reference ? ` · ${m.reference}` : ""}{m.note ? <div className="legend">{m.note}</div> : null}</td>
                  <td>{m.actor}<div className="legend">{formatEventDateTime(m.posted_at, locale, "Africa/Casablanca")}</div></td>
                  <td>{!m.reversed && !m.reverses && m.kind !== "consumption" && canReverseManual(m.kind) ? (
                    <StockForm command="reverse" date={m.date} locale={locale} back={back} className="inline">
                      <input type="hidden" name="posting" value={m.posting} />
                      <label>{t("stock.form.reason")}<input name="reason" required maxLength={500} /></label>
                      <button type="submit" className="secondary">{t("stock.history.reverse")}</button>
                    </StockForm>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>{t("stock.history.counts")}</h2>
      {history.counts.length === 0 ? <p className="notice">{t("stock.history.noCounts")}</p> : (
        <div className="table-wrap">
          <table data-table="stock-counts">
            <thead><tr>
              <th scope="col">{t("common.date")}</th><th scope="col" className="numeric">{t("stock.form.counted")}</th>
              <th scope="col">{t("stock.history.entered")}</th><th scope="col">{t("stock.history.actor")}</th><th scope="col" />
            </tr></thead>
            <tbody>
              {history.counts.map((c) => (
                <tr key={c.id} data-count={c.voided ? "voided" : "active"}>
                  <td>{formatBusinessDate(c.date, locale, "short")}<div className="legend" dir="ltr">{c.local.replace("T", " ")}</div></td>
                  <td className="numeric"><SignedQuantity value={c.quantity} t={t} /></td>
                  <td dir="auto">{c.entered} {unitName(c.unit, units, locale)}{c.replaces ? <div className="legend">{t("stock.history.replaces")}</div> : null}</td>
                  <td>{c.actor}<div className="legend">{formatEventDateTime(c.posted_at, locale, "Africa/Casablanca")}</div></td>
                  <td>{c.voided ? <span className="badge bad" title={c.voided}>{t("stock.history.voided")}: {c.voided}</span> : canCount ? (
                    <StockForm command="void_count" date={c.date} locale={locale} back={back} className="inline">
                      <input type="hidden" name="count" value={c.id} />
                      <label>{t("stock.form.reason")}<input name="reason" required maxLength={500} /></label>
                      <button type="submit" className="secondary">{t("stock.history.void")}</button>
                    </StockForm>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
