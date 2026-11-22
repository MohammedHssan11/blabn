import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { createTranslator, type Translator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import {
  approveRecipeAction, createRecipeAction, recipeDetailsAction, removeLineAction, saveLineAction, withdrawRecipeAction,
} from "@/modules/catalog/actions";
import { listBriefItems, readProductRecipes, readUnits, type DateDecision, type RecipeLine, type RecipeVersion, type Unit } from "@/modules/catalog/data";
import { fractionToInput } from "@/modules/catalog/forms";
import { itemName, Quantity, unitName } from "@/modules/catalog/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("catalog.recipes.title") : undefined };
}

type Component = Awaited<ReturnType<typeof listBriefItems>>[number];

function LineFields({ locale, t, units, components, line }: { locale: Locale; t: Translator; units: Unit[]; components: Component[]; line?: RecipeLine }) {
  const value = line?.quantity_num != null && line.quantity_den != null ? fractionToInput(line.quantity_num, line.quantity_den) : "";
  return (
    <>
      <label>
        {t("catalog.recipes.lines.component")}
        <select name="component" className="wide" required defaultValue={line?.component_id ?? ""}>
          <option value="">{t("catalog.recipes.lines.choose")}</option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {itemName(c, locale)} · {t(c.kind === "packaging" ? "catalog.recipes.lines.kindPackaging" : "catalog.recipes.lines.kindIngredient")}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("catalog.recipes.lines.quantity")}
        <input type="text" name="quantity" inputMode="decimal" required defaultValue={value} placeholder="0.025" dir="ltr" />
      </label>
      <label>
        {t("catalog.recipes.lines.unit")}
        <select name="unit" defaultValue={line?.unit_code ?? ""}>
          <option value="">{t("catalog.items.noUnit")}</option>
          {units.map((u) => (
            <option key={u.code} value={u.code}>{unitName(u.code, units, locale)}</option>
          ))}
        </select>
      </label>
    </>
  );
}

function VersionCard({
  locale, t, units, components, version, decisions, back,
}: {
  locale: Locale; t: Translator; units: Unit[]; components: Component[]; version: RecipeVersion; decisions: DateDecision[]; back: string;
}) {
  const draft = version.status === "draft";
  const decision = decisions.find((d) => d.id === version.date_decision_id) ?? null;
  const hidden = (extra: Record<string, string | number>) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={back} />
      {Object.entries(extra).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
  const range = version.effective_from
    ? t("catalog.recipes.effective", { from: version.effective_from, to: version.effective_to ?? t("catalog.recipes.openEnd") })
    : null;
  return (
    <section className={`card stack recipe-version ${version.status}`} data-version={version.id} data-status={version.status} data-version-no={version.version_no} id={`v${version.version_no}`}>
      <h2 style={{ marginTop: 0 }}>
        {t("catalog.recipes.versionHeading", { n: version.version_no, label: version.label })}{" "}
        <span className={`badge ${version.status === "approved" ? "ok" : version.status === "draft" ? "pending" : "bad"}`} data-testid="version-state">
          {t(`catalog.recipes.state.${version.status}`)}
        </span>
      </h2>
      {range ? <p data-testid="version-range" style={{ margin: 0 }}>{range}</p> : null}
      {version.sources.length > 0 ? (
        <p className="legend" style={{ margin: 0 }}>
          {t("catalog.recipes.sources")}: {version.sources.map((s) => `${s.source} · ${t("catalog.review.sheet", { name: s.sheet })}`).join(" + ")}
        </p>
      ) : null}
      {version.note ? <p className="legend" style={{ margin: 0 }}>{version.note}</p> : null}
      {decision && draft ? (
        decision.answered_date ? (
          <p className="notice ok" data-testid="date-gate">
            {version.decision_role === "starts_on"
              ? t("catalog.recipes.approve.startsOn", { date: decision.answered_date })
              : t("catalog.recipes.approve.endsBefore", { date: decision.answered_date })}
          </p>
        ) : (
          <p className="notice warn" data-testid="date-gate">
            {t("catalog.recipes.approve.gatedNote")} <Link href={`/${locale}/catalog/review`}>{t("catalog.tabs.review")}</Link>
          </p>
        )
      ) : null}

      {version.recipe_lines.length === 0 ? (
        <p className="muted">{t("catalog.recipes.lines.none")}</p>
      ) : (
        <div className="table-wrap">
          <table data-table="recipe-lines">
            <thead>
              <tr>
                <th>#</th>
                <th>{t("catalog.recipes.lines.component")}</th>
                <th className="numeric">{t("catalog.recipes.lines.quantity")}</th>
                <th>{t("catalog.recipes.lines.unit")}</th>
                <th>{t("catalog.recipes.lines.source")}</th>
                {draft ? <th>{t("common.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {version.recipe_lines.map((line) => (
                <tr key={line.id} data-line={line.line_no} data-component={line.component?.name_ar}>
                  <td>{line.line_no}</td>
                  <td>
                    {line.component ? (
                      <>
                        {itemName(line.component, locale)}{" "}
                        <span className="badge">{t(line.component.kind === "packaging" ? "catalog.recipes.lines.kindPackaging" : "catalog.recipes.lines.kindIngredient")}</span>
                      </>
                    ) : (
                      <span className="badge pending">{t("catalog.recipes.lines.noComponent")}</span>
                    )}
                  </td>
                  <td className="numeric">
                    {line.quantity_num != null && line.quantity_den != null ? (
                      <Quantity num={line.quantity_num} den={line.quantity_den} t={t} />
                    ) : (
                      <span className="badge pending">{t("catalog.recipes.lines.noQuantity")}</span>
                    )}
                  </td>
                  <td>
                    {line.unit_code ? unitName(line.unit_code, units, locale) : <span className="badge pending">{t("catalog.recipes.lines.noUnit")}</span>}
                    {line.source_unit_label && line.unit_resolution ? (
                      <div className="legend" style={{ margin: 0 }} data-unit-resolution={line.unit_resolution}>
                        {t("catalog.recipes.lines.written", { label: `«${line.source_unit_label}»` })} · {t("catalog.recipes.lines.unitResolved")}
                      </div>
                    ) : null}
                  </td>
                  <td dir="ltr" style={{ textAlign: "start" }}>
                    {line.source_ref ?? "—"}
                    {line.source_label ? <div className="legend" style={{ margin: 0 }} lang="ar" dir="rtl">«{line.source_label}»</div> : null}
                  </td>
                  {draft ? (
                    <td>
                      <details>
                        <summary>{t("catalog.recipes.lines.save")}</summary>
                        <form action={saveLineAction} className="mini-form" data-form="edit-line">
                          {hidden({ version: version.id, line: line.id, rv: version.version })}
                          <LineFields locale={locale} t={t} units={units} components={components} line={line} />
                          <button type="submit">{t("catalog.recipes.lines.save")}</button>
                        </form>
                        <form action={removeLineAction} className="mini-form">
                          {hidden({ line: line.id, rv: version.version })}
                          <button type="submit" className="secondary">{t("catalog.recipes.lines.remove")}</button>
                        </form>
                      </details>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft ? (
        <>
          <form action={saveLineAction} className="mini-form" data-form="add-line">
            {hidden({ version: version.id, rv: version.version })}
            <LineFields locale={locale} t={t} units={units} components={components} />
            <button type="submit">{t("catalog.recipes.lines.add")}</button>
          </form>
          <form action={recipeDetailsAction} className="mini-form" data-form="recipe-details">
            {hidden({ version: version.id, rv: version.version })}
            <label>
              {t("catalog.recipes.details.label")}
              <input type="text" name="label" required maxLength={120} defaultValue={version.label} />
            </label>
            <label>
              {t("catalog.recipes.yield")}
              <input
                type="text" name="yield" inputMode="decimal" dir="ltr" placeholder="1"
                defaultValue={version.yield_num === "1" && version.yield_den === "1" ? "" : fractionToInput(version.yield_num, version.yield_den)}
              />
            </label>
            <label>
              {t("catalog.recipes.note")}
              <input type="text" name="note" maxLength={300} defaultValue={version.note ?? ""} />
            </label>
            <button type="submit" className="secondary">{t("catalog.recipes.details.save")}</button>
          </form>
          <form action={approveRecipeAction} className="mini-form" data-form="approve">
            {hidden({ version: version.id, rv: version.version })}
            <label>
              {t("catalog.recipes.approve.from")}
              <input type="date" name="from" required defaultValue={decision?.answered_date && version.decision_role === "starts_on" ? decision.answered_date : ""} />
            </label>
            <label>
              {t("catalog.recipes.approve.to")}
              <input
                type="date" name="to"
                defaultValue={decision?.answered_date && version.decision_role === "ends_before" ? new Date(Date.parse(`${decision.answered_date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : ""}
              />
            </label>
            <button type="submit" data-action="approve-recipe">{t("catalog.recipes.approve.button")}</button>
          </form>
          <p className="legend" style={{ margin: 0 }}>{t("catalog.recipes.approve.hint")}</p>
          <form action={withdrawRecipeAction} className="mini-form" data-form="withdraw">
            {hidden({ version: version.id })}
            <label>
              {t("catalog.recipes.withdraw.note")}
              <input type="text" name="note" required maxLength={300} />
            </label>
            <button type="submit" className="secondary danger">{t("catalog.recipes.withdraw.button")}</button>
          </form>
        </>
      ) : null}
    </section>
  );
}

export default async function ProductRecipesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/catalog/recipes/${id}`;
  await requireAccess({ locale, path, require: { permission: "recipes.manage" } });
  const t = createTranslator(locale);
  const [data, units, components] = await Promise.all([readProductRecipes(id), readUnits(), listBriefItems("component")]);
  if (!data) notFound();
  const { product, versions, decisions } = data;

  return (
    <>
      <h1>{t("catalog.recipes.productTitle", { name: itemName(product, locale) })}</h1>
      <p>
        <Link href={`/${locale}/catalog/recipes`}>{t("catalog.recipes.back")}</Link> · <Link href={`/${locale}/catalog/items/${product.id}`}>{t("catalog.items.manage")}</Link>
      </p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      {versions.length === 0 ? <p className="notice" data-testid="no-versions">{t("catalog.recipes.noVersions")}</p> : null}
      {versions.map((version) => (
        <VersionCard key={version.id} locale={locale} t={t} units={units} components={components} version={version} decisions={decisions} back={path} />
      ))}
      <section className="card stack" data-section="new-version">
        <h2 style={{ marginTop: 0 }}>{t("catalog.recipes.create.title")}</h2>
        <form action={createRecipeAction} className="mini-form" data-form="create-recipe">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="back" value={path} />
          <input type="hidden" name="product" value={product.id} />
          <label>
            {t("catalog.recipes.create.label")}
            <input type="text" name="label" required maxLength={120} />
          </label>
          <label>
            {t("catalog.recipes.create.copy")}
            <select name="copy_from" defaultValue="">
              <option value="">{t("catalog.recipes.create.blank")}</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>{t("catalog.recipes.versionHeading", { n: v.version_no, label: v.label })}</option>
              ))}
            </select>
          </label>
          <button type="submit">{t("catalog.recipes.create.button")}</button>
        </form>
      </section>
    </>
  );
}
