import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { signInAction } from "@/modules/access/auth-actions";
import { safeNextPath } from "@/modules/access/forms";
import { getAccessContext } from "@/modules/access/session";
import { authNoticeKey, errorMessageKey } from "@/modules/access/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("auth.signIn.title") : undefined };
}

export default async function SignInPage({
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

  const next = safeNextPath(locale, first(sp.next));
  const access = await getAccessContext();
  if (access.state === "active" && !first(sp.error)) redirect(next ?? `/${locale}`);

  const noticeKey = authNoticeKey(first(sp.notice));
  const errorCode = first(sp.error);

  return (
    <div className="card auth-card">
      <h1>{t("auth.signIn.title")}</h1>
      <p className="lead">{t("auth.signIn.intro")}</p>
      {noticeKey ? (
        <p role="status" className="notice ok" data-result="notice" data-code={first(sp.notice)}>
          {t(noticeKey)}
        </p>
      ) : null}
      {errorMessageKey(errorCode) ? <ResultMessages t={t} error={errorCode} /> : null}
      <form action={signInAction} data-form="sign-in">
        <input type="hidden" name="locale" value={locale} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <label>
          {t("auth.signIn.email")}
          <input type="email" name="email" autoComplete="username" required spellCheck={false} autoCapitalize="none" />
        </label>
        <label>
          {t("auth.signIn.password")}
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        <button type="submit">{t("auth.signIn.submit")}</button>
      </form>
      <p className="legend">
        <Link href={`/${locale}/forgot-password`}>{t("auth.signIn.forgot")}</Link>
      </p>
    </div>
  );
}
