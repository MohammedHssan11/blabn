import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { AuditTable } from "@/components/AuditTable";
import { requireAccess } from "@/modules/access/guard";
import { listAudit } from "@/modules/access/directory";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("audit.title") : undefined };
}

const CATEGORIES = ["administration", "operation", "security"] as const;
const LIMIT = 200;

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  await requireAccess({ locale, path: `/${locale}/admin/audit`, require: { permission: "admin.audit.view" } });
  const t = createTranslator(locale);

  const requested = first(sp.category);
  const category = CATEGORIES.find((c) => c === requested);
  const rows = await listAudit({ category, limit: LIMIT });
  const base = `/${locale}/admin/audit`;

  return (
    <>
      <h1>{t("audit.title")}</h1>
      <p className="lead">{t("audit.intro")}</p>
      <ul className="filter-bar" aria-label={t("audit.filterLabel")}>
        <li>
          <Link href={base} aria-current={category ? undefined : "true"}>
            {t("audit.all")}
          </Link>
        </li>
        {CATEGORIES.map((c) => (
          <li key={c}>
            <Link href={`${base}?category=${c}`} aria-current={category === c ? "true" : undefined}>
              {t(`audit.category.${c}` as MessageKey)}
            </Link>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? (
        <p className="notice">{t("audit.empty")}</p>
      ) : (
        <>
          <AuditTable rows={rows} locale={locale} t={t} />
          <p className="legend">{t("audit.showing", { n: rows.length })}</p>
        </>
      )}
    </>
  );
}
