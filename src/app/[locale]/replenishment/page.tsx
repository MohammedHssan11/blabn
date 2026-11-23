import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { KvList } from "@/components/KvList";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { readUnits } from "@/modules/catalog/data";
import { itemName, unitName } from "@/modules/catalog/ui";
import { tryReadPlan } from "@/modules/replenishment/data";
import { isPlanDate } from "@/modules/replenishment/forms";
import { DateText, Qty, ReplenishmentTabs } from "@/modules/replenishment/ui";
import { verifyItemPlan } from "@/modules/replenishment/verify";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("replenishment.title") : undefined };
}

/**
 * Three-month planning view. For every stock item: how much same-weekday history exists, the
 * forecast (or the review state), and each input of the recommendation next to the result. A
 * different expected receipt date (what-if) recomputes the plan with the same rules.
 */
export default async function PlanningPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/replenishment`;
  const access = await requireAccess({ locale, path, require: { permission: "inventory.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const requested = first(sp.expected);
  const whatIf = isPlanDate(requested) ? requested : null;
  let { plan, code } = await tryReadPlan(whatIf);
  const invalidWhatIf = plan === null && whatIf !== null;
  if (plan === null) ({ plan, code } = await tryReadPlan(null));
  if (plan === null) throw new Error(`The plan could not be read (${code}).`);
  const units = await readUnits();
  const canCreate = holds(access, "purchase_order.propose", OPERATING_BRANCH_CODE);
  const canConfigure = holds(access, "admin.config.manage");
  const rows = plan.items.map((item) => ({ item, check: verifyItemPlan(plan, item) }));
  const recommendCount = plan.items.filter((i) => i.status === "recommend").length;
  const mismatches = rows.filter((r) => r.check.mismatches.length > 0).length;

  return (
    <>
      <h1>{t("replenishment.title")}</h1>
      <p className="lead">{t("replenishment.intro")}</p>
      <ReplenishmentTabs locale={locale} t={t} active="plan" settings={canConfigure} />
      <ResultMessages t={t} error={invalidWhatIf ? "po_expected_invalid" : first(sp.error)} notice={first(sp.notice)} />

      <div className="grid-2">
        <section className="card stack" data-section="dates" aria-label={t("replenishment.dates.title")}>
          <h2>{t("replenishment.dates.title")}</h2>
          <KvList locale={locale} items={[
            { id: "order-date", label: t("replenishment.dates.orderDate"), value: <DateText date={plan.order_date} locale={locale} /> },
            { id: "now", label: t("replenishment.dates.now"), value: <span dir="ltr">{plan.now_local.replace("T", " ")}</span> },
            { id: "cutoff", label: t("replenishment.dates.cutoff"), value: <span dir="ltr">{`${plan.rollover} · ${plan.timezone}`}</span> },
            { id: "default-expected", label: t("replenishment.dates.defaultExpected"), value: <DateText date={plan.default_expected} locale={locale} /> },
            { id: "expected", label: t("replenishment.dates.planExpected"), value: <DateText date={plan.expected ?? plan.default_expected} locale={locale} /> },
            { id: "coverage", label: t("replenishment.dates.coverage"), value: t("replenishment.dates.days", { n: plan.coverage_days }) },
            { id: "live-from", label: t("replenishment.dates.liveFrom"), value: plan.live_from ? <DateText date={plan.live_from} locale={locale} /> : <span className="badge pending" data-undecided="live_from">{t("replenishment.settings.notSet")}</span> },
            { id: "window", label: t("replenishment.dates.window"), value: <span><DateText date={plan.window_from} locale={locale} style="short" /> – <DateText date={plan.window_to} locale={locale} style="short" /></span> },
            { id: "complete-days", label: t("replenishment.dates.completeDays"), value: <span data-complete-days={plan.complete_dates.length}>{plan.complete_dates.length}</span> },
            { id: "minimum", label: t("replenishment.dates.minimum"), value: plan.min_observations ?? <span className="badge pending" data-undecided="min_observations">{t("replenishment.settings.notSet")}</span> },
          ]} />
          <p className="legend">{t("replenishment.dates.ruleNote")}</p>
        </section>

        <section className="card stack" data-section="formula">
          <h2>{t("replenishment.formula.title")}</h2>
          <p dir="auto" data-formula>{t("replenishment.formula.text")}</p>
          <p className="legend">{t("replenishment.formula.usable")}</p>
          <p className="legend">{t("replenishment.formula.incoming")}</p>
          <p className="legend">{t("replenishment.formula.history")}</p>
          <form method="get" className="inline" data-form="what-if">
            <label>{t("replenishment.whatIf.label")}
              <input type="date" name="expected" defaultValue={plan.expected ?? plan.default_expected} min={plan.order_date} required />
            </label>
            <button type="submit">{t("common.show")}</button>
            {plan.expected ? <Link href={path} data-link="reset">{t("replenishment.whatIf.reset")}</Link> : null}
          </form>
        </section>
      </div>

      <p data-summary data-recommend={recommendCount} data-review={plan.items.length - recommendCount} data-mismatches={mismatches}>
        {t("replenishment.summary", { recommend: recommendCount, review: plan.items.length - recommendCount })}
      </p>
      {mismatches > 0 ? <p role="alert" className="notice bad" data-result="mismatch">{t("replenishment.mismatch", { n: mismatches })}</p> : null}

      <form method="get" action={`/${locale}/replenishment/orders/new`} data-form="plan-select">
        <div className="table-wrap">
          <table data-table="plan">
            <thead>
              <tr>
                {canCreate ? <th scope="col"><span className="visually-hidden">{t("replenishment.col.select")}</span></th> : null}
                <th scope="col">{t("replenishment.col.item")}</th>
                <th scope="col">{t("replenishment.col.status")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.history")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.forecast")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.safety")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.onHand")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.usable")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.incoming")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.raw")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.recommended")}</th>
                <th scope="col" className="numeric">{t("replenishment.col.suggested")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, check }) => {
                const cov = item.coverage[0]?.observations;
                return (
                  <tr key={item.item_id} data-item={item.name_ar} data-status={item.status} data-check={check.mismatches.length ? "mismatch" : "ok"}>
                    {canCreate ? <td><input type="checkbox" name="item" value={item.item_id} aria-label={itemName(item, locale)} /></td> : null}
                    <th scope="row">
                      <Link href={`${path}/items/${item.item_id}${plan.expected ? `?expected=${plan.expected}` : ""}`}>{itemName(item, locale)}</Link>
                      <div className="legend">{unitName(item.base_unit, units, locale)} · <DateText date={item.expected} locale={locale} style="short" /></div>
                    </th>
                    <td>
                      <span className={`badge ${item.status === "recommend" ? "ok" : "pending"}`}>{t(`replenishment.planStatus.${item.status}` as MessageKey)}</span>
                      {item.review_reasons.map((r) => <div key={r} className="legend" data-reason={r}>{t(`replenishment.reason.${r}` as MessageKey)}</div>)}
                      {item.warnings.map((w, i) => <div key={i} className="legend" data-warning={w.code}>{t(`replenishment.warning.${w.code}` as MessageKey, { date: w.date ?? "", cutoff: w.cutoff ?? "", days: w.shelf_life_days ?? "" })}</div>)}
                    </td>
                    <td className="numeric" data-col="history">{cov ? t("replenishment.historyCount", { complete: cov.complete, missing: cov.missing }) : "—"}</td>
                    <td className="numeric" data-col="forecast"><Qty value={item.forecast} /></td>
                    <td className="numeric" data-col="safety"><Qty value={item.safety} />{item.safety_set ? null : <div className="legend">{t("replenishment.settings.notSet")}</div>}</td>
                    <td className="numeric" data-col="on-hand"><Qty value={item.on_hand} /></td>
                    <td className="numeric" data-col="usable"><Qty value={item.usable} /></td>
                    <td className="numeric" data-col="incoming"><Qty value={item.eligible_incoming} /></td>
                    <td className="numeric" data-col="raw"><Qty value={item.raw} signed /></td>
                    <td className="numeric" data-col="recommended"><Qty value={item.recommended} /></td>
                    <td className="numeric" data-col="suggested"><Qty value={item.suggested} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canCreate ? (
          <div className="row-actions">
            <button type="submit">{t("replenishment.createSelected")}</button>
            <Link href={`/${locale}/replenishment/orders/new`} data-link="manual-order">{t("replenishment.manualOrder")}</Link>
          </div>
        ) : null}
      </form>
    </>
  );
}
