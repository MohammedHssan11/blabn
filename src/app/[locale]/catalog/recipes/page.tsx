import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { listRecipeSummaries, openReviewCount } from "@/modules/catalog/data";
import { CatalogTabs, itemName } from "@/modules/catalog/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("catalog.recipes.title") : undefined };
}

const SHOW = ["all", "approved", "draft", "none", "gated"] as const;

export default async function RecipesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  await requireAccess({ locale, path: `/${locale}/catalog/recipes`, require: { permission: "recipes.manage" } });
  const t = createTranslator(locale);
  const showParam = first(sp.show);
  const show = (SHOW as readonly string[]).includes(showParam ?? "") ? (showParam as (typeof SHOW)[number]) : "all";
  const q = (first(sp.q) ?? "").slice(0, 80);
  const [rows, open] = await Promise.all([listRecipeSummaries({ q, show }), openReviewCount()]);
  const base = `/${locale}/catalog/recipes`;

  return (
    <>
      <h1>{t("catalog.recipes.title")}</h1>
      <p className="lead">{t("catalog.recipes.intro")}</p>
      <CatalogTabs locale={locale} t={t} active="recipes" openCount={open} />
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <form method="get" className="catalog-filters" data-form="recipe-filter">
        <label>
          {t("catalog.recipes.searchLabel")}
          <input type="search" name="q" defaultValue={q} maxLength={80} />
        </label>
        <label>
          {t("catalog.recipes.show")}
          <select name="show" defaultValue={show}>
            {SHOW.map((s) => (
              <option key={s} value={s}>{t(`catalog.recipes.${s}`)}</option>
            ))}
          </select>
        </label>
        <button type="submit">{t("catalog.items.filter")}</button>
      </form>
      <p className="legend" data-testid="recipe-count">{rows.length}</p>
      {rows.length === 0 ? (
        <p className="notice">{t("catalog.recipes.empty")}</p>
      ) : (
        <div className="table-wrap">
          <table data-table="recipes">
            <thead>
              <tr>
                <th>{t("catalog.recipes.columns.product")}</th>
                <th>{t("catalog.recipes.columns.section")}</th>
                <th>{t("catalog.recipes.columns.versions")}</th>
                <th>{t("catalog.recipes.columns.current")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product.id} data-product={row.product.id} data-approved={row.approved} data-drafts={row.drafts}>
                  <td>
                    <strong>{itemName(row.product, locale)}</strong>
                    {row.product.is_add_on ? <> <span className="badge">{t("catalog.items.addOn")}</span></> : null}
                  </td>
                  <td>{row.product.section_label ?? "—"}</td>
                  <td>
                    {row.approved > 0 ? <span className="badge ok">{t("catalog.recipes.approvedCount", { n: row.approved })}</span> : null}{" "}
                    {row.drafts > 0 ? <span className="badge pending">{t("catalog.recipes.draftCount", { n: row.drafts })}</span> : null}
                    {row.approved === 0 && row.drafts === 0 ? <span className="muted">{t("catalog.recipes.noneYet")}</span> : null}
                    {row.gated ? <> <span className="badge bad">{t("catalog.recipes.gate")}</span></> : null}
                  </td>
                  <td dir="ltr" style={{ textAlign: "start" }}>
                    {row.current
                      ? row.current.effective_to
                        ? t("catalog.recipes.range", { from: row.current.effective_from, to: row.current.effective_to })
                        : t("catalog.recipes.from", { date: row.current.effective_from })
                      : "—"}
                  </td>
                  <td><Link href={`${base}/${row.product.id}`}>{t("catalog.recipes.open")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
