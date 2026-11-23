import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { formatMad } from "@/i18n/format";
import { businessDateOf } from "@/lib/dates";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { readUnits } from "@/modules/catalog/data";
import { FractionValue, itemName, reasonText } from "@/modules/catalog/ui";
import { readProductMix, readStockDay } from "@/modules/inventory/stock";
import { isStockDate } from "@/modules/inventory/stock-forms";
import { StockForm, StockTabs } from "@/modules/inventory/stock-ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("stock.mix.title") : undefined };
}

const mad = (minor: number) => (minor / 100).toFixed(2);

export default async function ProductMixPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const requested = first(sp.date);
  const path = `/${locale}/inventory/product-mix`;
  const access = await requireAccess({ locale, path, require: { permission: "inventory.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const date = isStockDate(requested) ? requested : businessDateOf(new Date(), "Africa/Casablanca", "02:00");
  const [mix, units, day] = await Promise.all([readProductMix(date), readUnits(), readStockDay(date)]);
  const back = `${path}?date=${date}`;
  const canEdit = holds(access, "inventory.consume", OPERATING_BRANCH_CODE);
  const report = mix.report;
  const draft = report?.state === "draft";
  const lines = (mix.sections ?? []).flatMap((s) => s.lines);
  const pending = lines.filter((l) => !l.posted);
  const defaultLocal = `${date}T${date === day.today ? day.local.slice(11) : "23:00"}`;

  return (
    <>
      <h1>{t("stock.mix.title")}</h1>
      <p className="lead">{t("stock.mix.intro")}</p>
      <StockTabs locale={locale} t={t} active="mix" date={date} />
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <form method="get" className="inline" data-form="mix-date">
        <label>{t("common.date")}<input type="date" name="date" defaultValue={date} max={day.today} required /></label>
        <button type="submit">{t("common.show")}</button>
      </form>

      {canEdit && (!report || draft) ? (
        <StockForm command="mix_save" date={date} locale={locale} back={back} label={t("stock.mix.header")}>
          <h2>{t("stock.mix.header")}</h2>
          {report ? <input type="hidden" name="version" value={report.version} /> : null}
          <label>{t("stock.mix.netSales")}<input name="net_sales" inputMode="decimal" required dir="ltr" defaultValue={report ? mad(report.net_sales) : ""} /></label>
          <label>{t("stock.mix.reportTime")}<input type="datetime-local" name="local" required defaultValue={report?.local ?? defaultLocal} /></label>
          <div className="row-actions"><button type="submit">{t("stock.mix.saveHeader")}</button></div>
        </StockForm>
      ) : null}

      {!report ? <p className="notice" data-mix="none">{t("stock.mix.none")}</p> : (
        <section className="stack" data-mix-state={report.state} data-reconciled={String(mix.reconciliation?.ok)}>
          <p>{t("stock.mix.headerSummary", { sales: formatMad(report.net_sales, locale), state: t(`stock.mix.state.${report.state}` as MessageKey) })}</p>
          <div className={`notice ${mix.reconciliation?.ok ? "ok" : "warn"}`} data-section="reconciliation">
            <strong>{t(mix.reconciliation?.ok ? "stock.mix.reconciled" : "stock.mix.notReconciled")}</strong>
            <div>{t("stock.mix.totals", { sections: formatMad(mix.reconciliation?.sections_total ?? 0, locale), lines: formatMad(mix.reconciliation?.lines_total ?? 0, locale), sales: formatMad(report.net_sales, locale) })}</div>
            <ul className="plain-list">
              {(mix.reconciliation?.problems ?? []).map((p, i) => (
                <li key={i} data-problem={p.code}>{t(`stock.mix.problem.${p.code}` as MessageKey, {
                  section: p.section ?? "", total: formatMad(p.total ?? 0, locale), lines: formatMad(p.lines ?? 0, locale),
                  sales: formatMad(p.net_sales ?? 0, locale), sections: formatMad(p.sections ?? 0, locale), close: formatMad(p.close_sales ?? 0, locale),
                })}</li>
              ))}
            </ul>
          </div>

          {(mix.sections ?? []).map((section) => (
            <div key={section.no} className="stack" data-mix-section={section.label}>
              <h3 data-section-total={section.total}>{section.no}. <span dir="auto">{section.label}</span> · {t("stock.mix.sectionTotal")}: {formatMad(section.total, locale)}</h3>
              <div className="table-wrap">
              <table>
                <thead><tr>
                  <th scope="col">{t("stock.mix.col.no")}</th><th scope="col">{t("stock.mix.col.name")}</th>
                  <th scope="col" className="numeric">{t("stock.mix.col.quantity")}</th><th scope="col" className="numeric">{t("stock.mix.col.amount")}</th>
                  <th scope="col">{t("stock.mix.col.status")}</th>{canEdit && draft ? <th scope="col" /> : null}
                </tr></thead>
                <tbody>
                  {section.lines.map((line) => (
                    <tr key={line.id} data-mix-line={line.label} data-line-status={line.posted ? "posted" : line.check?.status ?? "pending"}>
                      <td>{line.no}</td>
                      <td lang="ar" dir="auto">{line.label}</td>
                      <td className="numeric" dir="ltr">{line.quantity}</td>
                      <td className="numeric">{formatMad(line.amount, locale)}</td>
                      <td>
                        {line.posted ? (
                          <>
                            <span className="badge ok">{t("stock.mix.posted", { n: line.posted.version_no })}</span>
                            <ul className="plain-list legend">
                              {line.posted.components.map((c) => (
                                <li key={c.item_id} data-component={c.name_ar}>{itemName(c, locale)}: <FractionValue value={c.quantity} t={t} />
                                  {c.stock_tracked ? null : <> · {t("stock.mix.untracked")}</>}</li>
                              ))}
                            </ul>
                          </>
                        ) : line.check?.status === "eligible" ? (
                          <span className="badge">{t("stock.mix.ready")}</span>
                        ) : (
                          <>
                            <span className="badge bad">{t("stock.mix.blocked")}</span>
                            {(line.check?.reasons ?? []).map((r, i) => <div key={i} data-reason={r.code}>{reasonText(r as never, t, locale, units)}</div>)}
                          </>
                        )}
                      </td>
                      {canEdit && draft ? (
                        <td><StockForm command="mix_remove" date={date} locale={locale} back={back} className="inline">
                          <input type="hidden" name="version" value={report.version} /><input type="hidden" name="line_no" value={line.no} />
                          <button type="submit" className="secondary">{t("stock.mix.remove")}</button>
                        </StockForm></td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ))}

          {canEdit && draft ? (
            <div className="grid-2">
              <StockForm command="mix_section" date={date} locale={locale} back={back} label={t("stock.mix.addSection")}>
                <h2>{t("stock.mix.addSection")}</h2>
                <p className="legend">{t("stock.mix.sectionHint")}</p>
                <input type="hidden" name="version" value={report.version} />
                <label>{t("stock.mix.sectionName")}<input name="label" required maxLength={120} dir="auto" /></label>
                <label>{t("stock.mix.sectionTotal")}<input name="total" required inputMode="decimal" dir="ltr" /></label>
                <div className="row-actions"><button type="submit">{t("stock.mix.saveSection")}</button></div>
              </StockForm>
              {(mix.sections ?? []).length > 0 ? (
                <StockForm command="mix_line" date={date} locale={locale} back={back} label={t("stock.mix.addLine")}>
                  <h2>{t("stock.mix.addLine")}</h2>
                  <p className="legend">{t("stock.mix.lineHint")}</p>
                  <input type="hidden" name="version" value={report.version} />
                  <label>{t("stock.mix.section")}
                    <select name="section_no" required>{(mix.sections ?? []).map((s) => <option key={s.no} value={s.no}>{s.no}. {s.label}</option>)}</select>
                  </label>
                  <label>{t("stock.mix.col.name")}<input name="label" required maxLength={200} dir="auto" /></label>
                  <label>{t("stock.mix.col.quantity")}<input name="quantity" required inputMode="decimal" dir="ltr" /></label>
                  <label>{t("stock.mix.col.amount")}<input name="amount" required inputMode="decimal" dir="ltr" /></label>
                  <div className="row-actions"><button type="submit">{t("stock.mix.saveLine")}</button></div>
                </StockForm>
              ) : null}
            </div>
          ) : null}

          {canEdit ? (
            <div className="row-actions">
              {draft ? (
                <StockForm command="mix_lock" date={date} locale={locale} back={back} className="inline">
                  <input type="hidden" name="version" value={report.version} />
                  <button type="submit" disabled={!mix.reconciliation?.ok}>{t("stock.mix.lock")}</button>
                </StockForm>
              ) : (
                <>
                  {pending.length > 0 ? (
                    <StockForm command="post_consumption" date={date} locale={locale} back={back} className="inline">
                      <button type="submit" disabled={!pending.some((l) => l.check?.status === "eligible")}>{t("stock.mix.post", { n: pending.filter((l) => l.check?.status === "eligible").length })}</button>
                    </StockForm>
                  ) : null}
                  {lines.every((l) => !l.posted) ? (
                    <StockForm command="mix_unlock" date={date} locale={locale} back={back} className="inline">
                      <input type="hidden" name="version" value={report.version} />
                      <button type="submit" className="secondary">{t("stock.mix.unlock")}</button>
                    </StockForm>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {canEdit ? [...new Set(lines.filter((l) => l.posted).map((l) => l.posted!.posting))].map((posting) => (
            <StockForm key={posting} command="reverse" date={date} locale={locale} back={back} className="inline">
              <input type="hidden" name="posting" value={posting} />
              <label>{t("stock.mix.reverseReason")}<input name="reason" required maxLength={500} /></label>
              <button type="submit" className="secondary">{t("stock.mix.reverse", { n: lines.filter((l) => l.posted?.posting === posting).length })}</button>
            </StockForm>
          )) : null}
        </section>
      )}
    </>
  );
}
