import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { isBusinessDate } from "@/lib/dates";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { queueNamesAction } from "@/modules/catalog/actions";
import { openReviewCount, readUnits, runConsumptionCheck, type Consumption } from "@/modules/catalog/data";
import { parseConsumptionLines } from "@/modules/catalog/forms";
import { CatalogTabs, FractionValue, itemName, reasonText } from "@/modules/catalog/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("catalog.consumption.title") : undefined };
}

export default async function ConsumptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const dateParam = first(sp.date) ?? "";
  const raw = first(sp.lines) ?? "";
  const text = raw.slice(0, 20_000);
  const path = `/${locale}/catalog/consumption`;
  await requireAccess({ locale, path, require: { permission: "recipes.manage" } });
  const t = createTranslator(locale);

  const submitted = first(sp.run) !== undefined;
  const dateOk = isBusinessDate(dateParam) && !dateParam.startsWith("0000-");
  const parsed = parseConsumptionLines(text);
  const tooManyLines = raw.length > text.length || parsed.lines.length > 500;
  let result: Consumption | null = null;
  if (submitted && dateOk && !tooManyLines && parsed.lines.length > 0) {
    // Unreadable rows are sent with their typed quantity so the database blocks them with its own reason.
    result = await runConsumptionCheck(dateParam, parsed.lines.map((line, index) => ({ ...line, ref: String(index + 1) })));
  }
  const [units, open] = await Promise.all([readUnits(), openReviewCount()]);
  const unmapped = result ? [...new Set(result.lines.filter((l) => l.reasons.some((r) => r.code === "unmapped_name") && l.label).map((l) => l.label as string))] : [];

  return (
    <>
      <h1>{t("catalog.consumption.title")}</h1>
      <p className="lead">{t("catalog.consumption.intro")}</p>
      <CatalogTabs locale={locale} t={t} active="consumption" openCount={open} />
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />

      <form method="get" className="card stack" data-form="consumption-check">
        <input type="hidden" name="run" value="1" />
        <label>
          {t("catalog.consumption.date")}
          <input type="date" name="date" required defaultValue={dateOk ? dateParam : ""} />
        </label>
        <label>
          {t("catalog.consumption.lines")}
          <textarea name="lines" rows={6} required dir="auto" defaultValue={text} spellCheck={false} />
          <span className="legend">{t("catalog.consumption.linesHint")}</span>
        </label>
        <div className="row-actions"><button type="submit">{t("catalog.consumption.run")}</button></div>
      </form>

      {submitted && !dateOk ? <p className="notice bad" role="alert" data-testid="check-error">{t("catalog.consumption.dateInvalid")}</p> : null}
      {submitted && dateOk && tooManyLines ? <p className="notice bad" role="alert" data-testid="check-error">{t("catalog.consumption.tooManyLines")}</p> : null}
      {submitted && dateOk && !tooManyLines && parsed.lines.length === 0 ? <p className="notice bad" role="alert" data-testid="check-error">{t("catalog.consumption.noLines")}</p> : null}
      {submitted && parsed.unreadable.length > 0 ? (
        <p className="notice warn" data-testid="unreadable">{t("catalog.consumption.unreadable", { rows: parsed.unreadable.join(", ") })}</p>
      ) : null}

      {result ? (
        <section className="stack" data-section="consumption-result" data-eligible={result.eligible} data-blocked={result.blocked}>
          <h2>{t("catalog.consumption.summary", { eligible: result.eligible, blocked: result.blocked })}</h2>
          <div className="table-wrap">
            <table data-table="consumption-lines">
              <thead>
                <tr>
                  <th>{t("catalog.consumption.columns.line")}</th>
                  <th>{t("catalog.consumption.columns.name")}</th>
                  <th className="numeric">{t("catalog.consumption.columns.quantity")}</th>
                  <th>{t("catalog.consumption.columns.result")}</th>
                  <th>{t("catalog.consumption.columns.product")}</th>
                  <th>{t("catalog.consumption.columns.recipe")}</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((line) => (
                  <tr key={line.index} className={line.status === "eligible" ? "result-eligible" : "result-blocked"} data-line-status={line.status} data-line={line.index}>
                    <td>{line.index}</td>
                    <td lang="ar" dir="auto">{line.label ?? "—"}</td>
                    <td className="numeric" dir="ltr">{line.quantity}</td>
                    <td>
                      <span className={`badge ${line.status === "eligible" ? "ok" : "bad"}`}>{t(line.status === "eligible" ? "catalog.consumption.eligible" : "catalog.consumption.blocked")}</span>
                      {line.reasons.map((reason, index) => (
                        <div key={index} data-reason={reason.code}>{reasonText(reason, t, locale, units)}</div>
                      ))}
                      {line.warnings.map((warning, index) => (
                        <div key={index} className="legend" data-warning={warning.code}>{t("catalog.consumption.warning.discontinued_before_date", { date: warning.detail ?? "" })}</div>
                      ))}
                    </td>
                    <td>{line.product ? itemName(line.product, locale) : "—"}</td>
                    <td>{line.recipe ? t("catalog.consumption.recipeVersion", { n: line.recipe.version_no, label: line.recipe.label }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.totals.length > 0 ? (
            <>
              <h2>{t("catalog.consumption.totals")}</h2>
              <div className="table-wrap">
                <table data-table="consumption-totals">
                  <thead>
                    <tr>
                      <th>{t("catalog.consumption.colItem")}</th>
                      <th>{t("catalog.consumption.colKind")}</th>
                      <th className="numeric">{t("catalog.consumption.colQty")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.totals.map((total) => (
                      <tr key={total.item_id} data-total-item={total.name_ar} data-kind={total.kind}>
                        <td>{itemName(total, locale)}</td>
                        <td>{t(`catalog.itemKind.${total.kind}`)}</td>
                        <td className="numeric"><FractionValue value={total.quantity} t={t} /> {units.find((u) => u.code === total.base_unit)?.[locale === "en" ? "name_en" : "name_ar"] ?? total.base_unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2>{t("catalog.consumption.components")}</h2>
              {result.lines.filter((l) => l.components.length > 0).map((line) => (
                <div key={line.index} className="table-wrap" data-components-of={line.index}>
                  <table>
                    <caption>{line.index} · {line.label} × {line.quantity}</caption>
                    <thead>
                      <tr>
                        <th>{t("catalog.consumption.colItem")}</th>
                        <th>{t("catalog.consumption.colKind")}</th>
                        <th className="numeric">{t("catalog.consumption.colQty")}</th>
                        <th>{t("catalog.consumption.colFrom")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {line.components.map((component) => (
                        <tr key={component.line_no} data-component={component.name_ar}>
                          <td>{itemName(component, locale)}</td>
                          <td>{t(`catalog.itemKind.${component.kind}`)}</td>
                          <td className="numeric"><FractionValue value={component.quantity} t={t} /></td>
                          <td dir="ltr" style={{ textAlign: "start" }}>{component.source_ref ?? `#${component.line_no}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          ) : null}

          {unmapped.length > 0 ? (
            <form action={queueNamesAction} className="card" data-form="queue-names">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="back" value={`${path}?run=1&date=${dateParam}&lines=${encodeURIComponent(text)}`} />
              {unmapped.map((name) => (
                <input key={name} type="hidden" name="name" value={name} />
              ))}
              <button type="submit">{t("catalog.consumption.queue")}</button>
            </form>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
