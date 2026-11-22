import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { saveConversionAction, setItemStatusAction } from "@/modules/catalog/actions";
import { readItem, readItemDetails, readUnits } from "@/modules/catalog/data";
import { ItemForm } from "@/modules/catalog/item-form";
import { itemName, Quantity, StatusBadge, unitName } from "@/modules/catalog/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("catalog.title") : undefined };
}

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/catalog/items/${id}`;
  await requireAccess({ locale, path, require: { permission: "recipes.manage" } });
  const t = createTranslator(locale);
  const item = await readItem(id);
  if (!item) notFound();
  const [units, details] = await Promise.all([readUnits(), readItemDetails(id)]);
  const component = item.kind !== "sold";
  const packUnits = units.filter((u) => u.code !== item.base_unit);

  return (
    <>
      <h1>{itemName(item, locale)}</h1>
      <p>
        <span className="badge">{t(`catalog.itemKind.${item.kind}`)}</span> <StatusBadge status={item.status} t={t} />
        {item.discontinued_on ? <span className="legend"> {item.discontinued_on}</span> : null}
        {item.kind === "sold" ? null : <span className="legend"> · {t("catalog.items.usedIn", { n: details.recipeLines })}</span>}
      </p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <ItemForm locale={locale} t={t} units={units} item={item} back={path} />

      <section className="card stack" data-section="status">
        <h2 style={{ marginTop: 0 }}>{t("catalog.items.statusTitle")}</h2>
        <p className="legend">{t("catalog.items.statusHint")}</p>
        <form action={setItemStatusAction} className="mini-form" data-form="item-status">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="back" value={path} />
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="version" value={item.version} />
          {item.status === "active" ? (
            <>
              <input type="hidden" name="status" value="discontinued" />
              <label>
                {t("catalog.items.discontinuedFrom")}
                <input type="date" name="on" required />
              </label>
              <button type="submit" className="secondary">{t("catalog.items.discontinue")}</button>
            </>
          ) : (
            <>
              <input type="hidden" name="status" value="active" />
              <button type="submit" className="secondary">{t("catalog.items.reactivate")}</button>
            </>
          )}
        </form>
      </section>

      {component ? (
        <section className="card stack" data-section="conversions">
          <h2 style={{ marginTop: 0 }}>{t("catalog.conversions.title")}</h2>
          <p className="legend">{t("catalog.conversions.intro", { unit: unitName(item.base_unit, units, locale) })}</p>
          {details.conversions.length === 0 ? (
            <p className="muted">{t("catalog.conversions.none")}</p>
          ) : (
            <ul className="plain-list" data-list="conversions">
              {details.conversions.map((c) => (
                <li key={c.id} data-conversion={c.unit_code}>
                  {t("catalog.conversions.factor", { from: unitName(c.unit_code, units, locale) })}{" "}
                  <Quantity num={c.to_base_num} den={c.to_base_den} t={t} /> {unitName(item.base_unit, units, locale)}{" "}
                  <span className="muted">· {c.basis}</span>
                </li>
              ))}
            </ul>
          )}
          {item.base_unit ? (
            <form action={saveConversionAction} className="mini-form" data-form="conversion">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="back" value={path} />
              <input type="hidden" name="item" value={item.id} />
              <label>
                {t("catalog.conversions.unit")}
                <select name="unit" required>
                  {packUnits.map((u) => (
                    <option key={u.code} value={u.code}>{unitName(u.code, units, locale)}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("catalog.conversions.perUnit", { unit: unitName(item.base_unit, units, locale) })}
                <input type="text" name="quantity" inputMode="decimal" required placeholder="25" />
              </label>
              <label>
                {t("catalog.conversions.basis")}
                <input type="text" name="basis" required maxLength={300} />
              </label>
              <button type="submit">{t("catalog.conversions.add")}</button>
            </form>
          ) : null}
        </section>
      ) : (
        <p><Link href={`/${locale}/catalog/recipes/${item.id}`} data-action="open-recipes">{t("catalog.items.recipeLink")}</Link></p>
      )}

      <section className="card stack" data-section="labels">
        <h2 style={{ marginTop: 0 }}>{t("catalog.labels.title")}</h2>
        {details.labels.length === 0 ? (
          <p className="muted">{t("catalog.labels.empty")}</p>
        ) : (
          <div className="table-wrap">
            <table data-table="item-labels">
              <tbody>
                {details.labels.map((label) => (
                  <tr key={label.id} data-label-status={label.status}>
                    <td>{t(`catalog.labels.system.${label.source_system as "foodics"}`)}</td>
                    <td lang="ar" dir="rtl">«{label.label}»</td>
                    <td><span className={`badge ${label.status === "approved" ? "ok" : label.status === "rejected" ? "bad" : "pending"}`}>{t(`catalog.labels.status.${label.status}`)}</span></td>
                    <td className="muted" dir="ltr" style={{ textAlign: "start" }}>{label.source_ref ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p><Link href={`/${locale}/catalog`}>{t("catalog.items.back")}</Link></p>
    </>
  );
}
