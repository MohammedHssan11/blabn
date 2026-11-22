import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { answerDateAction, mapNameAction, resolveReviewAction } from "@/modules/catalog/actions";
import { listBriefItems, listReviewItems, readDateDecisions, readUnits } from "@/modules/catalog/data";
import { REVIEW_KINDS, type ReviewKind } from "@/modules/catalog/forms";
import { CatalogTabs, itemName, reviewKindKey, SourceRefs, unitName } from "@/modules/catalog/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("catalog.review.title") : undefined };
}

const LIMIT = 150;

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  await requireAccess({ locale, path: `/${locale}/catalog/review`, require: { permission: "recipes.manage" } });
  const t = createTranslator(locale);

  const kindParam = first(sp.kind);
  const kind = (REVIEW_KINDS as readonly string[]).includes(kindParam ?? "") ? (kindParam as ReviewKind) : undefined;
  const statusParam = first(sp.status);
  const status = statusParam === "resolved" || statusParam === "dismissed" || statusParam === "all" ? statusParam : "open";
  const base = `/${locale}/catalog/review`;
  const back = `${base}${kind || status !== "open" ? `?${[kind ? `kind=${kind}` : "", status !== "open" ? `status=${status}` : ""].filter(Boolean).join("&")}` : ""}`;

  const [{ items, counts }, sold, units, decisions] = await Promise.all([
    listReviewItems({ kind, status: status === "all" ? undefined : status, limit: LIMIT }),
    listBriefItems("sold"),
    readUnits(),
    readDateDecisions(),
  ]);
  const totalOpen = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const mappingKinds = new Set<ReviewKind>(["unmapped_name", "unconfirmed_mapping"]);

  return (
    <>
      <h1>{t("catalog.review.title")}</h1>
      <p className="lead">{t("catalog.review.intro")}</p>
      <CatalogTabs locale={locale} t={t} active="review" openCount={totalOpen} />
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />

      {decisions.map((decision) => (
        <section key={decision.id} className="card stack" data-section="date-question" data-decision={decision.key} data-answered={decision.answered_date ? "true" : "false"}>
          <h2 style={{ marginTop: 0 }}>{t("catalog.review.dateTitle")}</h2>
          <p lang={locale} data-testid="date-question"><strong>{locale === "en" ? decision.question_en : decision.question_ar}</strong></p>
          {decision.answered_date ? (
            <p className="notice ok" data-testid="date-answer">
              {t("catalog.review.dateAnswered", { date: decision.answered_date })} · {t("catalog.review.dateEvidence", { evidence: decision.evidence ?? "" })}
            </p>
          ) : (
            <>
              <p className="notice warn">{t("catalog.review.dateHold")}</p>
              <form action={answerDateAction} className="mini-form" data-form="date-answer">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="key" value={decision.key} />
                <label>
                  {t("catalog.review.dateAnswer")}
                  <input type="date" name="date" required />
                </label>
                <label>
                  {t("catalog.review.dateWho")}
                  <input type="text" name="evidence" required maxLength={300} />
                </label>
                <button type="submit">{t("catalog.review.dateSave")}</button>
              </form>
            </>
          )}
        </section>
      ))}

      <form method="get" className="catalog-filters" data-form="review-filter">
        <label>
          {t("catalog.review.filter")}
          <select name="kind" defaultValue={kind ?? ""}>
            <option value="">{t("catalog.review.allKinds")}</option>
            {REVIEW_KINDS.map((k) => (
              <option key={k} value={k}>{t(reviewKindKey(k, "name"))}{counts[k] ? ` (${counts[k]})` : ""}</option>
            ))}
          </select>
        </label>
        <label>
          {t("catalog.review.statusFilter")}
          <select name="status" defaultValue={status}>
            <option value="open">{t("catalog.review.open")}</option>
            <option value="resolved">{t("catalog.review.resolved")}</option>
            <option value="dismissed">{t("catalog.review.dismissed")}</option>
            <option value="all">{t("catalog.review.allStatuses")}</option>
          </select>
        </label>
        <button type="submit">{t("catalog.items.filter")}</button>
      </form>

      {items.length === 0 ? (
        <p className="notice">{t("catalog.review.empty")}</p>
      ) : (
        <div className="stack" data-list="review">
          {items.length >= LIMIT ? <p className="legend">{t("catalog.review.limit", { n: LIMIT })}</p> : null}
          {items.map((entry) => (
            <article key={entry.id} className="card stack" data-review={entry.kind} data-status={entry.status} data-subject={entry.subject}>
              <h3 style={{ margin: 0 }}>
                <span className={`badge ${entry.status === "open" ? "pending" : "ok"}`}>{t(reviewKindKey(entry.kind, "name"))}</span>{" "}
                <span lang="ar" dir="auto">{entry.subject}</span>
              </h3>
              <p className="legend" style={{ margin: 0 }}>{t(reviewKindKey(entry.kind, "help"))}</p>
              {entry.detail && "base_unit" in entry.detail ? (
                <p className="legend" style={{ margin: 0 }}>
                  {entry.detail.base_unit ? t("catalog.review.baseUnitIs", { unit: unitName(String(entry.detail.base_unit), units, locale) }) : t("catalog.review.noBaseUnit")}
                </p>
              ) : null}
              <SourceRefs refs={entry.refs} t={t} />
              {entry.status !== "open" ? (
                <p className="notice ok" style={{ margin: 0 }}>{t("catalog.review.resolvedBy", { note: entry.resolution ?? "" })}</p>
              ) : null}

              {entry.status === "open" && mappingKinds.has(entry.kind) ? (
                <form action={mapNameAction} className="mini-form" data-form="map-name">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="source" value="foodics" />
                  <input type="hidden" name="label" value={entry.subject} />
                  <label>
                    {t("catalog.review.mapTo")}
                    <select name="item" className="wide" defaultValue={entry.item_id ?? ""}>
                      <option value="">{t("catalog.review.choose")}</option>
                      {sold.map((p) => (
                        <option key={p.id} value={p.id}>{itemName(p, locale)}{p.section_label ? ` · ${p.section_label}` : ""}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("catalog.review.basis")}
                    <input type="text" name="basis" required maxLength={300} />
                  </label>
                  <button type="submit" name="decision" value="approve">{t("catalog.review.approve")}</button>
                  <button type="submit" name="decision" value="reject" className="secondary">{t("catalog.review.reject")}</button>
                </form>
              ) : null}

              {entry.status === "open" && entry.kind === "recipe_effective_date" ? null : (
                <form action={resolveReviewAction} className="mini-form" data-form="resolve-review">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="id" value={entry.id} />
                  {entry.status === "open" ? (
                    <>
                      <label>
                        {t("catalog.review.note")}
                        <input type="text" name="note" required maxLength={300} />
                      </label>
                      <button type="submit" name="status" value="resolved" className="secondary">{t("catalog.review.resolve")}</button>
                      <button type="submit" name="status" value="dismissed" className="secondary">{t("catalog.review.dismiss")}</button>
                    </>
                  ) : (
                    <button type="submit" name="status" value="open" className="secondary">{t("catalog.review.reopen")}</button>
                  )}
                  {entry.item_id ? (
                    <Link href={`/${locale}/catalog/items/${entry.item_id}`} data-action="open-item">{t("catalog.items.manage")}</Link>
                  ) : null}
                </form>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
