import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { AuthPanel } from "@/components/AuthPanel";
import { ResultMessages } from "@/components/Messages";
import { changeOwnPasswordAction } from "@/modules/access/auth-actions";
import { MIN_PASSWORD_LENGTH } from "@/modules/access/forms";
import { requireAccess } from "@/modules/access/guard";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("auth.password.title") : undefined };
}

/**
 * Where a person sets their own password: right after an administrator created the account or
 * issued a temporary password (required before anything else), after the recovery link, or
 * whenever they choose to change it. Needs a valid session of an active staff member.
 */
export default async function PasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const t = createTranslator(locale);
  const access = await requireAccess({ locale, path: `/${locale}/account/password`, allowPasswordChange: true });
  const intro = access.mustChangePassword
    ? t("auth.password.introRequired")
    : first(sp.recovery) === "1"
      ? t("auth.password.introRecovery")
      : t("auth.password.intro");

  return (
    <AuthPanel t={t}>
      <h1>{t("auth.password.title")}</h1>
      <p className="lead">{intro}</p>
      <ResultMessages t={t} error={first(sp.error)} />
      <form action={changeOwnPasswordAction} data-form="change-password">
        <input type="hidden" name="locale" value={locale} />
        <label>
          {t("auth.password.newPassword")}
          <input type="password" name="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} />
        </label>
        <label>
          {t("auth.password.confirm")}
          <input type="password" name="confirm" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} />
        </label>
        <p className="legend">{t("auth.password.hint", { min: MIN_PASSWORD_LENGTH })}</p>
        <button type="submit">{t("auth.password.submit")}</button>
      </form>
    </AuthPanel>
  );
}
