import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { listItems, openReviewCount, PAGE_SIZE, readUnits } from "@/modules/catalog/data";
import { ITEM_KINDS, type ItemKind } from "@/modules/catalog/forms";
import { CatalogTabs, itemName, StatusBadge, unitName } from "@/modules/catalog/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("catalog.title") : undefined };
}

export default async function CatalogItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  await requireAccess({ locale, path: `/${locale}/catalog`, require: { permission: "recipes.manage" } });
  const t = createTranslator(locale);

  const kindParam = first(sp.kind);
  const kind = (ITEM_KINDS as readonly string[]).includes(kindParam ?? "") ? (kindParam as ItemKind) : undefined;
  const status = first(sp.status) === "discontinued" ? "discontinued" : first(sp.status) === "active" ? "active" : undefined;
  const q = (first(sp.q) ?? "").slice(0, 80);
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1);

  const [{ items, total }, units, open] = await Promise.all([listItems({ kind, status, q, page }), readUnits(), openReviewCount()]);
  const base = `/${locale}/catalog`;
  const query = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { kind, status, q: q || undefined, page: String(page), ...overrides };
    const text = Object.entries(merged).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
    return text ? `${base}?${text}` : base;
  };
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <h1>{t("catalog.title")}</h1>
      <p className="lead">{t("catalog.intro")}</p>
      <CatalogTabs locale={locale} t={t} active="items" openCount={open} />
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />

      <form method="get" className="catalog-filters" data-form="item-filter">
        <label>
          {t("catalog.items.searchLabel")}
          <input type="search" name="q" defaultValue={q} maxLength={80} />
        </label>
        <label>
          {t("catalog.items.columns.kind")}
          <select name="kind" defaultValue={kind ?? ""}>
            <option value="">{t("catalog.itemKind.all")}</option>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>{t(`catalog.itemKind.${k}`)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("catalog.items.columns.status")}
          <select name="status" defaultValue={status ?? ""}>
            <option value="">{t("catalog.status.all")}</option>
            <option value="active">{t("catalog.status.active")}</option>
            <option value="discontinued">{t("catalog.status.discontinued")}</option>
          </select>
        </label>
        <button type="submit">{t("catalog.items.filter")}</button>
      </form>
      <p className="row-actions">
        <Link className="primary-link" href={`${base}/items/new`} data-action="add-item">{t("catalog.items.add")}</Link>
        <span className="legend" data-testid="item-count">{t("catalog.items.showing", { from, to, total })}</span>
      </p>

      {items.length === 0 ? (
        <p className="notice">{t("catalog.items.empty")}</p>
      ) : (
        <div className="table-wrap">
          <table data-table="catalog-items">
            <thead>
              <tr>
                <th>{t("catalog.items.columns.name")}</th>
                <th>{t("catalog.items.columns.kind")}</th>
                <th>{t("catalog.items.columns.code")}</th>
                <th>{t("catalog.items.columns.unit")}</th>
                <th>{t("catalog.items.columns.status")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} data-item={item.id} data-kind={item.kind}>
                  <td>
                    <strong>{itemName(item, locale)}</strong>
                    {item.name_en === null ? <> <span className="badge pending">{t("catalog.items.englishMissing")}</span></> : null}
                    {item.is_add_on ? <> <span className="badge">{t("catalog.items.addOn")}</span></> : null}
                    {item.section_label ? <div className="muted">{item.section_label}</div> : null}
                  </td>
                  <td>{t(`catalog.itemKind.${item.kind}`)}</td>
                  <td dir="ltr" style={{ textAlign: "start" }}>{item.code ?? "—"}</td>
                  <td>{unitName(item.base_unit, units, locale)}</td>
                  <td><StatusBadge status={item.status} t={t} /></td>
                  <td><Link href={`${base}/items/${item.id}`}>{t("catalog.items.manage")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE_SIZE ? (
        <div className="pager">
          {page > 1 ? <Link href={query({ page: String(page - 1) })}>{t("catalog.items.previous")}</Link> : null}
          {to < total ? <Link href={query({ page: String(page + 1) })}>{t("catalog.items.next")}</Link> : null}
        </div>
      ) : null}
    </>
  );
}
