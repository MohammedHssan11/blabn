import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { AccessMatrix } from "@/components/AccessMatrix";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { listBranches } from "@/modules/access/directory";
import { createStaffAction } from "@/modules/access/staff-actions";
import { MIN_PASSWORD_LENGTH } from "@/modules/access/forms";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("staff.newTitle") : undefined };
}

export default async function NewStaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  await requireAccess({ locale, path: `/${locale}/admin/staff/new`, require: { permission: "admin.users.manage" } });
  const t = createTranslator(locale);
  const branches = await listBranches();

  return (
    <>
      <h1>{t("staff.newTitle")}</h1>
      <p className="lead">{t("staff.newIntro")}</p>
      <ResultMessages t={t} error={first(sp.error)} />
      <form action={createStaffAction} className="stack" data-form="create-staff">
        <input type="hidden" name="locale" value={locale} />
        <div className="card stack">
          <h2 style={{ marginTop: 0 }}>{t("staff.detailsTitle")}</h2>
          <label>
            {t("staff.fullName")}
            <input type="text" name="full_name" required autoComplete="off" />
          </label>
          <label>
            {t("common.email")}
            <input type="email" name="email" required autoComplete="off" spellCheck={false} autoCapitalize="none" />
          </label>
          <label>
            {t("staff.employeeNumber")} ({t("common.optional")})
            <input type="text" name="employee_number" autoComplete="off" />
          </label>
          <label>
            {t("staff.temporaryPassword")}
            <input type="password" name="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
            <span className="legend">{t("staff.temporaryPasswordHint")}</span>
          </label>
        </div>
        <div className="card stack">
          <h2 style={{ marginTop: 0 }}>{t("staff.accessTitle")}</h2>
          <p className="legend" style={{ marginTop: 0 }}>
            {t("staff.accessIntro")}
          </p>
          <AccessMatrix locale={locale} t={t} branches={branches} />
        </div>
        <div className="row-actions">
          <button type="submit">{t("staff.create")}</button>
          <Link href={`/${locale}/admin/staff`}>{t("staff.back")}</Link>
        </div>
      </form>
    </>
  );
}
