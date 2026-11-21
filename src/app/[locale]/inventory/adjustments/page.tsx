import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { formatBusinessDate } from "@/i18n/format";
import { first, type SearchParams } from "@/lib/search-params";
import { createUserClient } from "@/lib/supabase/server";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { recordAdjustmentAction } from "@/modules/inventory/actions";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("adjustments.title") : undefined };
}

export default async function AdjustmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const branch = first(sp.branch) ?? OPERATING_BRANCH_CODE;
  await requireAccess({ locale, path: `/${locale}/inventory/adjustments`, require: { permission: "inventory.adjust", branch } });
  if (branch !== OPERATING_BRANCH_CODE) notFound();
  const t = createTranslator(locale);

  // Read as the signed-in person: row-level security returns only rows they may view.
  const supabase = await createUserClient();
  const { data } = await supabase
    .from("inventory_adjustments")
    .select("id, business_date, reason, note, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as Array<{ id: string; business_date: string; reason: string; note: string }>;

  return (
    <>
      <h1>{t("adjustments.title")}</h1>
      <p className="lead">{t("adjustments.intro")}</p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <form action={recordAdjustmentAction} className="card stack" data-form="adjustment">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="branch" value={branch} />
        <label>
          {t("adjustments.date")}
          <input type="date" name="business_date" required />
        </label>
        <label>
          {t("adjustments.reason")}
          <input type="text" name="reason" required maxLength={200} autoComplete="off" />
        </label>
        <label>
          {t("adjustments.note")} ({t("common.optional")})
          <textarea name="note" maxLength={2000} />
        </label>
        <div className="row-actions">
          <button type="submit">{t("adjustments.submit")}</button>
        </div>
      </form>

      <h2>{t("adjustments.recent")}</h2>
      {rows.length === 0 ? (
        <p className="notice">{t("adjustments.none")}</p>
      ) : (
        <div className="table-wrap">
          <table data-table="adjustments">
            <thead>
              <tr>
                <th>{t("adjustments.date")}</th>
                <th>{t("adjustments.reason")}</th>
                <th>{t("adjustments.note")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="num">{formatBusinessDate(row.business_date, locale, "short")}</td>
                  <td>{row.reason}</td>
                  <td>{row.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
