import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { formatBusinessDate } from "@/i18n/format";
import { first, type SearchParams } from "@/lib/search-params";
import { isBusinessDate } from "@/lib/dates";
import { ResultMessages } from "@/components/Messages";
import { COMPARISON_BRANCH_CODES } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { saveComparisonAction } from "@/modules/comparisons/actions";
import { readEntryContext } from "@/modules/comparisons/data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("comparison.entry.title") : undefined };
}

/**
 * Entry of Al Quds and Bourgogne figures. Needs comparison.enter for at least one of them; the form
 * of each branch is shown only where the person holds it. No saved figure is shown here: entering
 * does not grant viewing.
 */
export default async function ComparisonEntryPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/comparison/entry`;
  // Signed in, then comparison.enter for at least one comparison branch (the live permission list
  // of this request). The database checks the branch and the entry owner again on every save.
  const access = await requireAccess({ locale, path });
  if (!COMPARISON_BRANCH_CODES.some((branch) => holds(access, "comparison.enter", branch))) forbidden();
  const t = createTranslator(locale);
  const context = await readEntryContext();
  const requestedDate = first(sp.date);

  return (
    <>
      <h1>{t("comparison.entry.title")}</h1>
      <p className="lead">{t("comparison.entry.intro")}</p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <p className="legend">{t("comparison.entry.rules")} {t("common.blankMeaning")}</p>
      {context.branches.length === 0 ? <p className="notice warn">{t("comparison.entry.noBranches")}</p> : null}

      <div className="grid-2">
        {context.branches.map((b) => {
          const name = locale === "ar" ? b.nameAr : b.nameEn;
          const date = isBusinessDate(requestedDate) && requestedDate <= b.today ? requestedDate : b.today;
          return (
            <form key={b.code} action={saveComparisonAction} className="card stack" data-form={`entry-${b.code}`} aria-label={name}>
              <h2>{name}</h2>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="branch" value={b.code} />
              <input type="hidden" name="back" value={path} />
              <input type="hidden" name="request" value={crypto.randomUUID()} />
              <p className="legend" data-owner={b.ownerIsMe ? "me" : b.ownerSet ? "other" : "unset"}>
                {b.ownerIsMe ? t("comparison.entry.ownerMe", { branch: name })
                  : b.ownerSet ? t("comparison.entry.ownerOther", { branch: name })
                    : t("comparison.entry.ownerUnset", { branch: name })}{" "}
                {b.liveFrom ? t("comparison.entry.liveFrom", { branch: name, date: formatBusinessDate(b.liveFrom, locale, "long") })
                  : t("comparison.entry.liveFromUnset", { branch: name })}
              </p>
              <label>{t("comparison.entry.date")}<input type="date" name="date" defaultValue={date} max={b.today} required /></label>
              <fieldset className="checks">
                <legend>{t("comparison.entry.mode")}</legend>
                <label className="check"><input type="radio" name="mode" value="new" defaultChecked /><span>{t("comparison.entry.modes.new")}</span></label>
                <label className="check"><input type="radio" name="mode" value="correct" /><span>{t("comparison.entry.modes.correct")}</span></label>
              </fieldset>
              <label>
                {t("comparison.entry.source")}
                <select name="source" defaultValue={b.liveSource ?? "reporting_only"}>
                  {context.sources.map((s) => <option key={s.key} value={s.key}>{locale === "ar" ? s.labelAr : s.labelEn}</option>)}
                </select>
              </label>
              <label>{t("comparison.entry.sales")}<input name="sales" inputMode="decimal" dir="ltr" autoComplete="off" /></label>
              <label>{t("comparison.entry.orders")}<input name="orders" inputMode="numeric" dir="ltr" autoComplete="off" /></label>
              <label>
                {t("comparison.entry.reference")} ({t("common.optional")})
                <input name="reference" maxLength={200} />
                <span className="legend">{t("comparison.entry.referenceHint")}</span>
              </label>
              <fieldset className="checks">
                <legend>{t("comparison.entry.purpose")}</legend>
                <label className="check"><input type="radio" name="purpose" value="live" defaultChecked /><span>{t("comparison.entry.purposes.live")}</span></label>
                <label className="check"><input type="radio" name="purpose" value="historical" /><span>{t("comparison.entry.purposes.historical")}</span></label>
              </fieldset>
              <label>{t("comparison.entry.reason")} ({t("common.optional")})<input name="reason" maxLength={500} /></label>
              <fieldset className="checks">
                <label className="check"><input type="checkbox" name="clear_sales" value="1" /><span>{t("comparison.entry.clearSales")}</span></label>
                <label className="check"><input type="checkbox" name="clear_orders" value="1" /><span>{t("comparison.entry.clearOrders")}</span></label>
              </fieldset>
              <div className="row-actions"><button type="submit">{t("comparison.entry.save")}</button></div>
            </form>
          );
        })}
      </div>
    </>
  );
}
