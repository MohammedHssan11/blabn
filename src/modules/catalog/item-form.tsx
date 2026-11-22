import type { Locale } from "@/i18n/config";
import type { Translator } from "@/i18n/dictionary";
import { saveItemAction } from "./actions";
import type { CatalogItem, Unit } from "./data";
import { ITEM_KINDS, type ItemKind } from "./forms";
import { unitName } from "./ui";

/** The create / edit form of one catalog item. Units offered depend on the kind: a sold product is always counted in pieces. */
export function ItemForm({
  locale, t, units, item, kind, back,
}: {
  locale: Locale;
  t: Translator;
  units: Unit[];
  item?: CatalogItem;
  kind?: ItemKind;
  back: string;
}) {
  const current = item?.kind ?? kind ?? "ingredient";
  const component = current !== "sold";
  const unitOptions = (allowNone: boolean) => (
    <>
      {allowNone ? <option value="">{t("catalog.items.noUnit")}</option> : null}
      {units.map((u) => (
        <option key={u.code} value={u.code}>{unitName(u.code, units, locale)}</option>
      ))}
    </>
  );
  return (
    <form action={saveItemAction} className="card stack" data-form="item">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={back} />
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      {item ? <input type="hidden" name="version" value={item.version} /> : null}
      <h2 style={{ marginTop: 0 }}>{item ? t("catalog.items.detailsTitle") : t("catalog.items.newTitle")}</h2>
      {item ? (
        <input type="hidden" name="kind" value={item.kind} />
      ) : (
        <label>
          {t("catalog.items.columns.kind")}
          <select name="kind" defaultValue={current}>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>{t(`catalog.itemKind.${k}`)}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        {t("catalog.items.nameAr")}
        <input type="text" name="name_ar" lang="ar" dir="rtl" required maxLength={200} defaultValue={item?.name_ar ?? ""} />
      </label>
      <label>
        {t("catalog.items.nameEn")} ({t("common.optional")})
        <input type="text" name="name_en" lang="en" dir="ltr" maxLength={200} defaultValue={item?.name_en ?? ""} />
      </label>
      <div className="two-col">
        <label>
          {t("catalog.items.code")} ({t("common.optional")})
          <input type="text" name="code" dir="ltr" maxLength={60} defaultValue={item?.code ?? ""} />
        </label>
        <label>
          {t("catalog.items.section")} ({t("common.optional")})
          <input type="text" name="section" maxLength={120} defaultValue={item?.section_label ?? ""} />
        </label>
      </div>
      {component || !item ? (
        <>
          <p className="legend">{t("catalog.items.unitsHint")}</p>
          <div className="two-col">
            <label>
              {t("catalog.items.baseUnit")}
              <select name="base_unit" defaultValue={item?.base_unit ?? ""}>{unitOptions(true)}</select>
            </label>
            <label>
              {t("catalog.items.purchaseUnit")}
              <select name="purchase_unit" defaultValue={item?.purchase_unit ?? ""}>{unitOptions(true)}</select>
            </label>
            <label>
              {t("catalog.items.storageUnit")}
              <select name="storage_unit" defaultValue={item?.storage_unit ?? ""}>{unitOptions(true)}</select>
            </label>
          </div>
        </>
      ) : null}
      {current === "sold" ? (
        <label className="check">
          <input type="checkbox" name="is_add_on" defaultChecked={item?.is_add_on ?? false} />
          <span>{t("catalog.items.isAddOn")}</span>
        </label>
      ) : null}
      <div className="row-actions">
        <button type="submit">{t("catalog.items.save")}</button>
      </div>
    </form>
  );
}
