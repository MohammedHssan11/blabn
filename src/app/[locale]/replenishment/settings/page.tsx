import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { isCatalogId } from "@/modules/catalog/forms";
import { readUnits } from "@/modules/catalog/data";
import { itemName, unitName } from "@/modules/catalog/ui";
import { readStockOptions } from "@/modules/inventory/stock";
import { saveBranchSettingsAction, saveItemSettingsAction, saveSourceSettingsAction } from "@/modules/replenishment/actions";
import { readSettings } from "@/modules/replenishment/data";
import { DateText, Qty, ReplenishmentTabs, sourceLabel } from "@/modules/replenishment/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("replenishment.settings.title") : undefined };
}

const decimal = (f: { num: string; den: string; decimal?: string } | null) => (f ? f.decimal ?? `${f.num}/${f.den}` : "");

/**
 * The open decisions of Phase 8 (System Admin). Everything starts empty and has no effect until the
 * branch confirms it: the minimum number of complete same-weekday observations, safety stock, pack
 * size, supplier minimum, shelf life, the source of an item, a lead-time exception per source and
 * the order cut-off time.
 */
export default async function ReplenishmentSettingsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/replenishment/settings`;
  await requireAccess({ locale, path, require: { permission: "admin.config.manage" } });
  const t = createTranslator(locale);
  // The questions are for Abdo, so they are shown in plain Arabic in both languages.
  const tAr = createTranslator("ar");
  const [settings, options, units] = await Promise.all([readSettings(), readStockOptions(), readUnits()]);
  const chosenId = first(sp.item);
  const chosen = chosenId && isCatalogId(chosenId) ? options.find((o) => o.id === chosenId.toLowerCase()) ?? null : null;
  const current = chosen ? settings.items.find((i) => i.item_id === chosen.id) ?? null : null;
  const back = chosen ? `${path}?item=${chosen.id}` : path;

  return (
    <>
      <h1>{t("replenishment.settings.title")}</h1>
      <p className="lead">{t("replenishment.settings.intro")}</p>
      <ReplenishmentTabs locale={locale} t={t} active="settings" settings />
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />

      <section className="card stack" data-section="questions">
        <h2>{t("replenishment.settings.questions")}</h2>
        <ul className="plain-list">
          {(["minimum", "constraints", "twoDay"] as const).map((k) => (
            <li key={k} data-question={k}>
              <span lang="ar" dir="rtl">{tAr(`replenishment.questions.${k}` as MessageKey)}</span>
              {locale === "en" ? <div className="legend">{t(`replenishment.questions.${k}` as MessageKey)}</div> : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid-2">
        <form action={saveBranchSettingsAction} className="card stack" data-form="branch-settings" aria-label={t("replenishment.settings.branch")}>
          <h2>{t("replenishment.settings.branch")}</h2>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="revision" value={settings.revision} />
          <label>{t("replenishment.settings.minimum")} ({t("replenishment.settings.blankUndecided")})
            <input name="min_observations" type="number" min={1} max={13} defaultValue={settings.min_observations ?? ""}
              data-undecided={settings.min_observations === null ? "true" : undefined} />
          </label>
          <label>{t("replenishment.settings.coverage")}<input name="coverage_days" type="number" min={1} max={14} defaultValue={settings.coverage_days} required /></label>
          <label>{t("replenishment.settings.safetyPercent")}
            <input name="safety_percent" inputMode="decimal" dir="ltr" defaultValue={String(Number(settings.safety_percent))} required />
          </label>
          <p className="legend" data-legend="safety-percent">{t("replenishment.settings.safetyPercentNote")}</p>
          <p className="legend">
            {t("replenishment.dates.liveFrom")}: {settings.live_from ? <DateText date={settings.live_from} locale={locale} /> : t("replenishment.settings.notSet")}
            {" · "}<Link href={`/${locale}/comparison/settings`}>{t("replenishment.settings.liveFromWhere")}</Link>
          </p>
          <div className="row-actions"><button type="submit">{t("common.save")}</button></div>
        </form>

        {settings.sources.map((s) => (
          <form key={s.source} action={saveSourceSettingsAction} className="card stack" data-form={`source-${s.source}`} aria-label={sourceLabel(t, s.source)}>
            <h2>{sourceLabel(t, s.source)}</h2>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="source" value={s.source} />
            <input type="hidden" name="revision" value={s.revision} />
            <label>{t("replenishment.settings.leadDays")} ({t("replenishment.settings.blankTwoDay")})
              <input name="lead_days" type="number" min={0} max={14} defaultValue={s.lead_days ?? ""} />
            </label>
            <label>{t("replenishment.settings.cutoff")} ({t("replenishment.settings.blankUndecided")})
              <input name="cutoff" type="time" defaultValue={s.cutoff ?? ""} />
            </label>
            <div className="row-actions"><button type="submit">{t("common.save")}</button></div>
          </form>
        ))}
      </div>

      <section className="stack" data-section="item-settings">
        <h2>{t("replenishment.settings.items")}</h2>
        <form method="get" className="inline" data-form="choose-item">
          <label>{t("stock.form.item")}
            <select name="item" defaultValue={chosen?.id ?? ""} required>
              <option value="" disabled>{t("stock.form.chooseItem")}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{itemName(o, locale)}</option>)}
            </select>
          </label>
          <button type="submit">{t("common.show")}</button>
        </form>
        {chosen ? (
          <form action={saveItemSettingsAction} className="card stack" data-form="item-settings" aria-label={itemName(chosen, locale)}>
            <h3>{itemName(chosen, locale)} ({unitName(chosen.base_unit, units, locale)})</h3>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="item" value={chosen.id} />
            <input type="hidden" name="revision" value={current?.revision ?? 0} />
            <p className="legend">{t("replenishment.settings.baseUnitNote")}</p>
            <label>{t("replenishment.settings.pack")}<input name="pack" inputMode="decimal" dir="ltr" defaultValue={decimal(current?.pack ?? null)} /></label>
            <label>{t("replenishment.settings.minOrder")}<input name="min_order" inputMode="decimal" dir="ltr" defaultValue={decimal(current?.min_order ?? null)} /></label>
            <label>{t("replenishment.settings.shelfLife")}<input name="shelf_life_days" type="number" min={1} max={3650} defaultValue={current?.shelf_life_days ?? ""} /></label>
            <label>{t("replenishment.col.source")}
              <select name="source" defaultValue={current?.source ?? ""}>
                <option value="">{t("replenishment.settings.notSet")}</option>
                <option value="factory">{t("replenishment.source.factory")}</option>
                <option value="store">{t("replenishment.source.store")}</option>
              </select>
            </label>
            <div className="row-actions"><button type="submit">{t("common.save")}</button>
              <Link href={`/${locale}/replenishment/items/${chosen.id}`}>{t("replenishment.settings.viewPlan")}</Link></div>
          </form>
        ) : null}
        {settings.items.length === 0 ? <p className="legend" data-empty>{t("replenishment.settings.noneSet")}</p> : (
          <div className="table-wrap">
            <table data-table="item-settings">
              <thead>
                <tr>
                  <th scope="col">{t("replenishment.col.item")}</th>
                  <th scope="col" className="numeric">{t("replenishment.settings.pack")}</th>
                  <th scope="col" className="numeric">{t("replenishment.settings.minOrder")}</th>
                  <th scope="col" className="numeric">{t("replenishment.settings.shelfLife")}</th>
                  <th scope="col">{t("replenishment.col.source")}</th>
                </tr>
              </thead>
              <tbody>
                {settings.items.map((i) => (
                  <tr key={i.item_id} data-item={i.name_ar}>
                    <th scope="row"><Link href={`${path}?item=${i.item_id}`}>{itemName(i, locale)}</Link></th>
                    <td className="numeric"><Qty value={i.pack} /></td>
                    <td className="numeric"><Qty value={i.min_order} /></td>
                    <td className="numeric">{i.shelf_life_days ?? "—"}</td>
                    <td>{sourceLabel(t, i.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
