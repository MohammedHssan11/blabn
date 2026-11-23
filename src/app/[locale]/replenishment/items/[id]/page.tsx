import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { createTranslator, type MessageKey, type Translator } from "@/i18n/dictionary";
import { formatBusinessDate } from "@/i18n/format";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { isCatalogId } from "@/modules/catalog/forms";
import { readUnits } from "@/modules/catalog/data";
import { itemName, unitName } from "@/modules/catalog/ui";
import { tryReadPlan } from "@/modules/replenishment/data";
import { isPlanDate } from "@/modules/replenishment/forms";
import type { ItemPlanJson } from "@/modules/replenishment/types";
import { DateText, Qty, ReplenishmentTabs, sourceLabel } from "@/modules/replenishment/ui";
import { verifyItemPlan } from "@/modules/replenishment/verify";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("replenishment.item.title") : undefined };
}

/**
 * One item: the full three-month same-weekday history, the day-by-day projection to the receipt
 * date, every confirmed incoming line with its original and current expected date, and the
 * arithmetic of the recommendation. With ?expected= it shows the default and the changed receipt
 * date side by side, so the effect of the change is visible.
 */
export default async function PlanItemPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<SearchParams> }) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !isCatalogId(id)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/replenishment/items/${id}`;
  const access = await requireAccess({ locale, path, require: { permission: "inventory.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const requested = first(sp.expected);
  const base = await tryReadPlan(null, id.toLowerCase());
  if (!base.plan) throw new Error(`The plan could not be read (${base.code}).`);
  const item = base.plan.items[0];
  if (!item) notFound();
  const whatIf = isPlanDate(requested) && requested !== item.expected ? await tryReadPlan(requested, id.toLowerCase()) : null;
  const changed = whatIf?.plan?.items[0] ?? null;
  const units = await readUnits();
  const canCreate = holds(access, "purchase_order.propose", OPERATING_BRANCH_CODE);
  const canConfigure = holds(access, "admin.config.manage");
  const check = verifyItemPlan(base.plan, item);
  const unit = unitName(item.base_unit, units, locale);

  return (
    <>
      <h1>{itemName(item, locale)}</h1>
      <p className="lead">{t("replenishment.item.intro", { unit })}</p>
      <ReplenishmentTabs locale={locale} t={t} active="plan" settings={canConfigure} />
      <ResultMessages t={t} error={whatIf && !whatIf.plan ? "po_expected_invalid" : first(sp.error)} notice={first(sp.notice)} />
      <p data-check={check.mismatches.length ? "mismatch" : "ok"} className={check.mismatches.length ? "notice bad" : "legend"}>
        {check.mismatches.length ? t("replenishment.mismatch", { n: check.mismatches.length }) : t("replenishment.item.checked")}
      </p>

      <form method="get" className="inline" data-form="what-if">
        <label>{t("replenishment.whatIf.label")}
          <input type="date" name="expected" defaultValue={changed?.expected ?? item.expected} min={item.order_date} required />
        </label>
        <button type="submit">{t("common.show")}</button>
        {changed ? <Link href={path} data-link="reset">{t("replenishment.whatIf.reset")}</Link> : null}
      </form>

      <div className="grid-2">
        <Arithmetic item={item} t={t} locale={locale} label={t("replenishment.item.defaultPlan")} section="default" />
        {changed ? <Arithmetic item={changed} t={t} locale={locale} label={t("replenishment.item.changedPlan")} section="changed" /> : null}
      </div>
      {changed ? (
        <p data-section="effect" className="notice">
          {t("replenishment.item.effect", {
            from: formatBusinessDate(item.expected, locale, "long"), to: formatBusinessDate(changed.expected, locale, "long"),
          })}{" "}
          <Qty value={item.suggested} /> → <Qty value={changed.suggested} />
        </p>
      ) : null}

      <section className="stack" data-section="bridge">
        <h2>{t("replenishment.bridge.title")}</h2>
        <p className="legend">{t("replenishment.bridge.intro")}</p>
        <div className="table-wrap">
          <table data-table="bridge">
            <thead>
              <tr>
                <th scope="col">{t("common.date")}</th>
                <th scope="col" className="numeric">{t("replenishment.bridge.opening")}</th>
                <th scope="col" className="numeric">{t("replenishment.bridge.incoming")}</th>
                <th scope="col" className="numeric">{t("replenishment.bridge.consumption")}</th>
                <th scope="col" className="numeric">{t("replenishment.bridge.closing")}</th>
              </tr>
            </thead>
            <tbody>
              <tr data-row="book"><th scope="row">{t("replenishment.bridge.book")}</th><td className="numeric" /><td className="numeric" /><td className="numeric" />
                <td className="numeric" data-col="closing"><Qty value={item.on_hand} /></td></tr>
              {item.bridge.map((d) => (
                <tr key={d.date} data-day={d.date} data-basis={d.basis}>
                  <th scope="row"><DateText date={d.date} locale={locale} /></th>
                  <td className="numeric" data-col="opening"><Qty value={d.opening} /></td>
                  <td className="numeric" data-col="incoming"><Qty value={d.incoming} /></td>
                  <td className="numeric" data-col="consumption"><Qty value={d.consumption} />
                    <div className="legend">{t(`replenishment.basis.${d.basis}` as MessageKey)}</div></td>
                  <td className="numeric" data-col="closing"><Qty value={d.closing} /></td>
                </tr>
              ))}
              <tr data-row="usable"><th scope="row">{t("replenishment.bridge.usable", { date: formatBusinessDate(item.expected, locale, "short") })}</th>
                <td className="numeric" /><td className="numeric" /><td className="numeric" /><td className="numeric" data-col="usable"><Qty value={item.usable} /></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack" data-section="incoming">
        <h2>{t("replenishment.incoming.title")}</h2>
        {item.incoming.length === 0 ? <p className="legend">{t("replenishment.incoming.none")}</p> : (
          <div className="table-wrap">
            <table data-table="incoming">
              <thead>
                <tr>
                  <th scope="col">{t("replenishment.order.number")}</th>
                  <th scope="col">{t("replenishment.col.source")}</th>
                  <th scope="col">{t("replenishment.dates.originalExpected")}</th>
                  <th scope="col">{t("replenishment.dates.currentExpected")}</th>
                  <th scope="col" className="numeric">{t("replenishment.col.outstanding")}</th>
                  <th scope="col">{t("replenishment.incoming.counted")}</th>
                </tr>
              </thead>
              <tbody>
                {item.incoming.map((x) => (
                  <tr key={x.line} data-incoming={x.bucket}>
                    <th scope="row"><Link href={`/${locale}/replenishment/orders/${x.order}`}>PO-{x.order_no}</Link></th>
                    <td>{sourceLabel(t, x.source)}</td>
                    <td><DateText date={x.original_expected} locale={locale} style="short" /></td>
                    <td><DateText date={x.expected} locale={locale} style="short" />{x.overridden ? <span className="badge pending"> {t("replenishment.dates.overridden")}</span> : null}</td>
                    <td className="numeric"><Qty value={x.outstanding} /></td>
                    <td>{t(`replenishment.bucket.${x.bucket}` as MessageKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack" data-section="history">
        <h2>{t("replenishment.history.title")}</h2>
        <p className="legend">{t("replenishment.history.intro")}</p>
        <div className="table-wrap">
          <table data-table="history">
            <thead>
              <tr>
                <th scope="col">{t("replenishment.history.weekday")}</th>
                <th scope="col" className="numeric">{t("replenishment.history.complete")}</th>
                <th scope="col" className="numeric">{t("replenishment.history.average")}</th>
                <th scope="col">{t("replenishment.history.dates")}</th>
              </tr>
            </thead>
            <tbody>
              {(item.history ?? []).map((w) => (
                <tr key={w.weekday} data-weekday={w.weekday} data-complete={w.complete} data-missing={w.missing}>
                  <th scope="row">{formatBusinessDate(w.dates[0]?.date ?? item.order_date, locale, "weekday")}</th>
                  <td className="numeric">{t("replenishment.historyCount", { complete: w.complete, missing: w.missing })}</td>
                  <td className="numeric"><Qty value={w.average} />{w.sufficient ? null : <div className="legend">{t("replenishment.history.notEnough")}</div>}</td>
                  <td>
                    <ul className="chips" data-dates>
                      {w.dates.map((d) => (
                        <li key={d.date} data-obs={d.status} data-obs-date={d.date} className={`obs obs-${d.status}`}>
                          <DateText date={d.date} locale={locale} style="short" />{": "}
                          {d.status === "complete" ? <Qty value={d.demand} /> : <span className="muted">{t(`replenishment.obs.${d.status}` as MessageKey)}</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="row-actions">
        {canCreate ? <Link href={`/${locale}/replenishment/orders/new?item=${item.item_id}`} data-link="order-item">{t("replenishment.orderThis")}</Link> : null}
        {canConfigure ? <Link href={`/${locale}/replenishment/settings?item=${item.item_id}`} data-link="item-settings">{t("replenishment.item.settings")}</Link> : null}
      </div>
    </>
  );
}

function Arithmetic({ item, t, locale, label, section }: { item: ItemPlanJson; t: Translator; locale: Locale; label: string; section: string }) {
  return (
    <section className="card stack" data-section={section} data-status={item.status} aria-label={label}>
      <h2>{label}</h2>
      <p className="legend">
        {t("replenishment.item.receipt")} <DateText date={item.expected} locale={locale} />
        {item.expected !== item.default_expected ? <> · {t("replenishment.dates.defaultExpected")} <DateText date={item.default_expected} locale={locale} style="short" /></> : null}
      </p>
      {item.status === "review" ? (
        <p className="notice warn" data-review>
          {t("replenishment.item.review")}{" "}
          {item.review_reasons.map((r) => t(`replenishment.reason.${r}` as MessageKey)).join(" · ")}
        </p>
      ) : null}
      <ul className="kv-list" data-arithmetic>
        <li className="kv-row" data-term="forecast"><span className="label">{t("replenishment.col.forecast")}
          <span className="legend"> ({item.coverage.map((c) => `${formatBusinessDate(c.date, locale, "weekday")}: ${c.observations.complete}`).join(", ")})</span></span>
          <span className="value"><Qty value={item.forecast} /></span></li>
        <li className="kv-row" data-term="safety"><span className="label">+ {t("replenishment.col.safety")}{item.safety_set ? null : ` (${t("replenishment.settings.notSet")})`}</span>
          <span className="value"><Qty value={item.safety} /></span></li>
        <li className="kv-row" data-term="usable"><span className="label">− {t("replenishment.col.usable")}</span><span className="value"><Qty value={item.usable} /></span></li>
        <li className="kv-row" data-term="incoming"><span className="label">− {t("replenishment.col.incoming")}</span><span className="value"><Qty value={item.eligible_incoming} /></span></li>
        <li className="kv-row" data-term="raw"><span className="label">= {t("replenishment.col.raw")}</span><span className="value"><Qty value={item.raw} signed /></span></li>
        <li className="kv-row" data-term="recommended"><span className="label">{t("replenishment.col.recommended")}</span><span className="value"><Qty value={item.recommended} /></span></li>
        {item.constraints.map((c) => (
          <li key={c.code} className="kv-row" data-term={c.code}><span className="label">{t(`replenishment.constraint.${c.code}` as MessageKey)}</span>
            <span className="value"><Qty value={c.value} /></span></li>
        ))}
        <li className="kv-row" data-term="suggested"><span className="label">{t("replenishment.col.suggested")}</span><span className="value"><Qty value={item.suggested} /></span></li>
      </ul>
      {item.warnings.map((w, i) => <p key={i} className="legend" data-warning={w.code}>{t(`replenishment.warning.${w.code}` as MessageKey, { date: w.date ?? "", cutoff: w.cutoff ?? "", days: w.shelf_life_days ?? "" })}</p>)}
    </section>
  );
}

