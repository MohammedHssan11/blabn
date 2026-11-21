import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { AuthPanel } from "@/components/AuthPanel";
import { ResultMessages } from "@/components/Messages";
import { requestRecoveryAction } from "@/modules/access/auth-actions";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("auth.forgot.title") : undefined };
}

export default async function ForgotPasswordPage({
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
  const sent = first(sp.sent) === "1";

  return (
    <AuthPanel t={t}>
      <h1>{t("auth.forgot.title")}</h1>
      <p className="lead">{t("auth.forgot.intro")}</p>
      <ResultMessages t={t} error={first(sp.error)} />
      {sent ? (
        <p role="status" className="notice ok" data-result="recovery-sent">
          {t("auth.forgot.sent")}
        </p>
      ) : null}
      <form action={requestRecoveryAction} data-form="forgot-password">
        <input type="hidden" name="locale" value={locale} />
        <label>
          {t("auth.forgot.email")}
          <input type="email" name="email" autoComplete="username" required spellCheck={false} autoCapitalize="none" />
        </label>
        <button type="submit">{t("auth.forgot.submit")}</button>
      </form>
      <p className="legend">
        <Link href={`/${locale}/sign-in`}>{t("auth.forgot.back")}</Link>
      </p>
    </AuthPanel>
  );
}
