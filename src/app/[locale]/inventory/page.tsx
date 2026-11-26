import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { createTranslator, type MessageKey, type Translator } from "@/i18n/dictionary";
import { formatBusinessDate } from "@/i18n/format";
import { readBusinessToday } from "@/lib/database-time";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { readUnits, type Unit } from "@/modules/catalog/data";
import { itemName, unitName } from "@/modules/catalog/ui";
import { readStockDay, readStockOptions, type StockOption } from "@/modules/inventory/stock";
import { isStockDate, MANUAL_KINDS, stockPermission } from "@/modules/inventory/stock-forms";
import { kindLabel, SignedQuantity, StockForm, StockTabs } from "@/modules/inventory/stock-ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("stock.title") : undefined };
}

const IN_KINDS = ["opening", "receipt", "purchase", "transfer_in", "return"] as const;
const OUT_KINDS = ["consumption", "waste", "hospitality", "deduction", "transfer_out", "adjustment"] as const;

export default async function StockPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const requested = first(sp.date);
  const path = `/${locale}/inventory`;
  const access = await requireAccess({ locale, path, require: { permission: "inventory.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  // Default view only, from the database's clock; it also decides the business date of every write.
  const date = isStockDate(requested) ? requested : await readBusinessToday();
  const [day, options, units] = await Promise.all([readStockDay(date), readStockOptions(), readUnits()]);
  const back = `${path}?date=${date}`;
  const can = (permission: Parameters<typeof holds>[1]) => holds(access, permission, OPERATING_BRANCH_CODE);
  const manualKinds = MANUAL_KINDS.filter((kind) => {
    const permission = stockPermission("movement", kind);
    return permission !== null && can(permission);
  });
  // For today, now as it is: after midnight the clock is already on the next calendar day of this business date.
  const defaultLocal = date === day.today ? day.local : `${date}T20:00`;
  const counted = day.items.filter((i) => i.status === "counted").length;
  const missing = day.items.filter((i) => i.status === "missing").length;

  return (
    <>
      <h1>{t("stock.title")}</h1>
      <p className="lead">{t("stock.intro")}</p>
      <StockTabs locale={locale} t={t} active="day" date={date} />
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />

      <form method="get" className="inline" data-form="stock-date">
        <label>{t("common.date")}<input type="date" name="date" defaultValue={date} max={day.today} required /></label>
        <button type="submit">{t("common.show")}</button>
      </form>
      <p data-summary data-counted={counted} data-missing={missing}>
        {t("stock.summary", { date: formatBusinessDate(date, locale, "long"), counted, missing })}
      </p>
      <p className="legend">{t("stock.legend")}</p>

      <div className="table-wrap">
        <table data-table="stock-day">
          <thead>
            <tr>
              <th scope="col">{t("stock.col.item")}</th>
              <th scope="col">{t("stock.col.unit")}</th>
              <th scope="col" className="numeric">{t("stock.col.opening")}</th>
              <th scope="col" className="numeric">{t("stock.col.in")}</th>
              <th scope="col" className="numeric">{t("stock.col.consumed")}</th>
              <th scope="col" className="numeric">{t("stock.col.other")}</th>
              <th scope="col" className="numeric">{t("stock.col.expected")}</th>
              <th scope="col" className="numeric">{t("stock.col.count")}</th>
              <th scope="col" className="numeric">{t("stock.col.atCount")}</th>
              <th scope="col" className="numeric">{t("stock.col.variance")}</th>
              <th scope="col">{t("stock.col.status")}</th>
            </tr>
          </thead>
          <tbody>
            {day.items.map((item) => (
              <tr key={item.item_id} data-item={item.name_ar} data-status={item.status} data-schedule={item.schedule}>
                <th scope="row"><Link href={`${path}/items/${item.item_id}?date=${date}`}>{itemName(item, locale)}</Link>
                  <div className="legend">{t(`stock.schedule.${item.schedule}` as MessageKey)}</div></th>
                <td>{unitName(item.base_unit, units, locale)}</td>
                <td className="numeric" data-col="opening"><SignedQuantity value={item.opening} t={t} /></td>
                <td className="numeric" data-col="in">{sumList(item, IN_KINDS, t)}</td>
                <td className="numeric" data-col="consumed"><SignedQuantity value={item.movements.consumption ?? null} t={t} /></td>
                <td className="numeric" data-col="other">{sumList(item, OUT_KINDS.filter((k) => k !== "consumption"), t)}</td>
                <td className="numeric" data-col="expected"><SignedQuantity value={item.expected} t={t} /></td>
                <td className="numeric" data-col="count"><SignedQuantity value={item.count?.quantity ?? null} t={t} /></td>
                <td className="numeric" data-col="at-count"><SignedQuantity value={item.expected_at_count} t={t} /></td>
                <td className="numeric" data-col="variance"><SignedQuantity value={item.variance} t={t} signed /></td>
                <td><span className={`badge ${item.status === "counted" ? "ok" : item.status === "missing" ? "bad" : ""}`}>
                  {t(`stock.status.${item.status}` as MessageKey)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {day.adjustments.length > 0 ? (
        <section className="stack" data-section="adjustments">
          <h2>{t("stock.adjustments.title")}</h2>
          <ul className="plain-list">
            {day.adjustments.map((a) => {
              const item = day.items.find((i) => i.item_id === a.item_id);
              return (
                <li key={a.id} data-adjustment={a.status}>
                  {item ? itemName(item, locale) : a.item_id} · <SignedQuantity value={{ ...a.quantity, num: a.direction < 0 ? `-${a.quantity.num}` : a.quantity.num }} t={t} signed />
                  {" · "}{a.reason} · <span className="badge">{t(`stock.adjustments.${a.status}` as MessageKey)}</span>
                  {a.status === "proposed" && can("inventory.adjust_approve") ? (
                    <StockForm command="decide_adjustment" date={date} locale={locale} back={back} className="inline">
                      <input type="hidden" name="adjustment" value={a.id} />
                      <label>{t("stock.form.reason")}<input name="reason" maxLength={500} /></label>
                      <button type="submit" name="decision" value="approve">{t("stock.adjustments.approve")}</button>
                      <button type="submit" name="decision" value="reject" className="secondary">{t("stock.adjustments.reject")}</button>
                    </StockForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid-2">
        {can("inventory.count") ? (
          <StockForm command="count" date={date} locale={locale} back={back} label={t("stock.form.countTitle")}>
            <h2>{t("stock.form.countTitle")}</h2>
            <p className="legend">{t("stock.form.countHint")}</p>
            <ItemFields t={t} locale={locale} options={options} units={units} />
            <label>{t("stock.form.counted")}<input name="quantity" inputMode="decimal" required dir="ltr" autoComplete="off" /></label>
            <label>{t("stock.form.time")}<input type="datetime-local" name="local" defaultValue={defaultLocal} required /></label>
            <label>{t("stock.form.note")} ({t("common.optional")})<input name="note" maxLength={500} /></label>
            <div className="row-actions"><button type="submit">{t("stock.form.saveCount")}</button></div>
          </StockForm>
        ) : null}

        {manualKinds.length > 0 ? (
          <StockForm command="movement" date={date} locale={locale} back={back} label={t("stock.form.movementTitle")}>
            <h2>{t("stock.form.movementTitle")}</h2>
            <p className="legend">{t("stock.form.movementHint")}</p>
            <label>{t("stock.form.kind")}
              <select name="kind" required>{manualKinds.map((kind) => <option key={kind} value={kind}>{kindLabel(t, kind)}</option>)}</select>
            </label>
            <ItemFields t={t} locale={locale} options={options} units={units} />
            <label>{t("stock.form.quantity")}<input name="quantity" inputMode="decimal" required dir="ltr" autoComplete="off" /></label>
            <label>{t("stock.form.time")}<input type="datetime-local" name="local" defaultValue={defaultLocal} required /></label>
            <label>{t("stock.form.reference")} ({t("common.optional")})<input name="reference" maxLength={100} /></label>
            <label>{t("stock.form.note")} ({t("common.optional")})<input name="note" maxLength={500} /></label>
            <div className="row-actions"><button type="submit">{t("stock.form.saveMovement")}</button></div>
          </StockForm>
        ) : null}

        {can("inventory.adjust") ? (
          <StockForm command="propose_adjustment" date={date} locale={locale} back={back} label={t("stock.form.adjustTitle")}>
            <h2>{t("stock.form.adjustTitle")}</h2>
            <p className="legend">{t("stock.form.adjustHint")}</p>
            <ItemFields t={t} locale={locale} options={options} units={units} />
            <label>{t("stock.form.direction")}
              <select name="direction" required><option value="-1">{t("stock.form.decrease")}</option><option value="1">{t("stock.form.increase")}</option></select>
            </label>
            <label>{t("stock.form.quantity")}<input name="quantity" inputMode="decimal" required dir="ltr" autoComplete="off" /></label>
            <label>{t("stock.form.time")}<input type="datetime-local" name="local" defaultValue={defaultLocal} required /></label>
            <label>{t("stock.form.reason")}<input name="reason" required maxLength={500} /></label>
            <div className="row-actions"><button type="submit">{t("stock.form.proposeAdjustment")}</button></div>
          </StockForm>
        ) : null}

        {can("inventory.adjust_approve") ? (
          <StockForm command="opening" date={date} locale={locale} back={back} label={t("stock.form.openingTitle")}>
            <h2>{t("stock.form.openingTitle")}</h2>
            <p className="legend">{t("stock.form.openingHint")}</p>
            <ItemFields t={t} locale={locale} options={options} units={units} />
            <label>{t("stock.form.quantity")}<input name="quantity" inputMode="decimal" required dir="ltr" autoComplete="off" /></label>
            <label>{t("stock.form.time")}<input type="datetime-local" name="local" defaultValue={defaultLocal} required /></label>
            <div className="row-actions"><button type="submit">{t("stock.form.saveOpening")}</button></div>
          </StockForm>
        ) : null}
      </div>
    </>
  );
}

function sumList(item: { movements: Partial<Record<string, { num: string; den: string; decimal: string; exact: boolean }>> }, kinds: readonly string[], t: Translator) {
  const present = kinds.filter((k) => item.movements[k]);
  if (present.length === 0) return <SignedQuantity value={null} t={t} />;
  return (
    <span className="stack-tight">
      {present.map((k) => (
        <span key={k} data-kind={k} title={kindLabel(t, k)}>{kindLabel(t, k)}: <SignedQuantity value={item.movements[k]} t={t} signed /></span>
      ))}
    </span>
  );
}

function ItemFields({ t, locale, options, units }: { t: Translator; locale: Locale; options: StockOption[]; units: Unit[] }) {
  return (
    <>
      <label>{t("stock.form.item")}
        <select name="item" required defaultValue="">
          <option value="" disabled>{t("stock.form.chooseItem")}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{itemName(o, locale)} ({unitName(o.base_unit, units, locale)})</option>)}
        </select>
      </label>
      <label>{t("stock.form.unit")}
        <select name="unit" defaultValue="">
          <option value="">{t("stock.form.baseUnit")}</option>
          {units.map((u) => <option key={u.code} value={u.code}>{locale === "en" ? u.name_en : u.name_ar}</option>)}
        </select>
      </label>
    </>
  );
}
