import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { formatBusinessDate } from "@/i18n/format";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { addSourceAction, saveSettingsAction } from "@/modules/comparisons/actions";
import { readSettings } from "@/modules/comparisons/data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("comparison.settings.title") : undefined };
}

/**
 * Per-branch comparison settings (System Admin): the live source designation and the entry owner of
 * Al Quds and Bourgogne, and each branch's first live business date. They start undecided; the
 * live source and entry owner wait for Abdo's answer.
 */
export default async function ComparisonSettingsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/comparison/settings`;
  await requireAccess({ locale, path, require: { permission: "admin.config.manage" } });
  const t = createTranslator(locale);
  const settings = await readSettings();

  return (
    <>
      <h1>{t("comparison.settings.title")}</h1>
      <p className="lead">{t("comparison.settings.intro")}</p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />

      <div className="grid-2">
        {settings.branches.map((b) => {
          const name = locale === "ar" ? b.nameAr : b.nameEn;
          return (
            <form key={b.code} action={saveSettingsAction} className="card stack" data-form={`settings-${b.code}`} aria-label={name}>
              <h2>{name}</h2>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="branch" value={b.code} />
              <input type="hidden" name="revision" value={b.revision} />
              {b.operatesInApp ? (
                <p className="legend">
                  {t("comparison.settings.operatingNote")}{" "}
                  {b.firstClose ? t("comparison.settings.firstClose", { date: formatBusinessDate(b.firstClose, locale, "long") }) : null}
                </p>
              ) : (
                <>
                  <label>
                    {t("comparison.settings.liveSource")}
                    <select name="live_source" defaultValue={b.liveSource ?? ""} data-undecided={b.liveSource === null ? "true" : undefined}>
                      <option value="">{t("comparison.settings.undecided")}</option>
                      {settings.sources.map((s) => <option key={s.key} value={s.key}>{locale === "ar" ? s.labelAr : s.labelEn}</option>)}
                    </select>
                  </label>
                  <label>
                    {t("comparison.settings.entryOwner")}
                    <select name="entry_owner" defaultValue={b.entryOwner ?? ""} data-undecided={b.entryOwner === null ? "true" : undefined}>
                      <option value="">{t("comparison.settings.undecided")}</option>
                      {b.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                </>
              )}
              <label>{t("comparison.settings.liveFrom")} ({t("common.optional")})<input type="date" name="live_from" defaultValue={b.liveFrom ?? ""} /></label>
              <div className="row-actions"><button type="submit">{t("comparison.settings.save")}</button></div>
            </form>
          );
        })}
      </div>

      <section className="stack" data-section="sources">
        <h2>{t("comparison.settings.sources")}</h2>
        <ul className="plain-list">
          {settings.sources.map((s) => (
            <li key={s.key} data-source={s.key}>
              <code dir="ltr">{s.key}</code> · {locale === "ar" ? s.labelAr : s.labelEn}{s.builtIn ? ` · ${t("comparison.settings.builtIn")}` : ""}
            </li>
          ))}
        </ul>
        <form action={addSourceAction} className="card stack" data-form="add-source">
          <h3>{t("comparison.settings.addSource")}</h3>
          <input type="hidden" name="locale" value={locale} />
          <label>{t("comparison.settings.key")}<input name="key" pattern="[a-z][a-z0-9_]{1,39}" required dir="ltr" autoComplete="off" /></label>
          <label>{t("comparison.settings.labelEn")}<input name="label_en" maxLength={80} required dir="ltr" /></label>
          <label>{t("comparison.settings.labelAr")}<input name="label_ar" maxLength={80} required dir="rtl" /></label>
          <div className="row-actions"><button type="submit">{t("comparison.settings.addSource")}</button></div>
        </form>
      </section>
    </>
  );
}
