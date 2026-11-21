import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import "../globals.css";
import { directions, isLocale, locales, otherLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { MainNav } from "@/components/MainNav";
import { getAccessContext, holds } from "@/modules/access/session";
import { ALL_BRANCH_CODES, OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { signOutAction } from "@/modules/access/auth-actions";

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: { default: `${t("app.name")} · ${t("app.tagline")}`, template: `%s · ${t("app.name")}` },
    robots: { index: false, follow: false },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  const other = otherLocale(locale);
  // The label is the name of the other language, written in that language.
  const switchLabel = t("nav.switchTo");

  // Menu entries are a convenience: they only list what the person holds. Every page checks again.
  const access = await getAccessContext();
  const items =
    access.state === "active"
      ? [
          { href: `/${locale}`, label: t("nav.home") },
          ...(holds(access, "daily_close.view", OPERATING_BRANCH_CODE)
            ? [
                { href: `/${locale}/daily-close`, label: t("nav.dailyClose") },
                { href: `/${locale}/cash-count`, label: t("nav.cashCount") },
              ]
            : []),
          ...(ALL_BRANCH_CODES.every((code) => holds(access, "comparison.view", code))
            ? [{ href: `/${locale}/comparison`, label: t("nav.comparison") }]
            : []),
          ...(holds(access, "reports.view", OPERATING_BRANCH_CODE) ? [{ href: `/${locale}/reports`, label: t("nav.reportMap") }] : []),
          ...(holds(access, "inventory.adjust", OPERATING_BRANCH_CODE)
            ? [{ href: `/${locale}/inventory/adjustments`, label: t("nav.inventoryAdjustments") }]
            : []),
          ...(holds(access, "admin.users.manage") ? [{ href: `/${locale}/admin/staff`, label: t("nav.staff") }] : []),
          ...(holds(access, "admin.audit.view") ? [{ href: `/${locale}/admin/audit`, label: t("nav.audit") }] : []),
        ]
      : [];

  return (
    <html lang={locale} dir={directions[locale]}>
      <body>
        <a className="skip-link" href="#content">
          {t("app.skipToContent")}
        </a>
        <div className="banner" role="note">
          {t("app.prototypeBanner")}
        </div>
        <header className="site-header">
          <div className="header-inner">
            <a className="brand" href={`/${locale}`}>
              {t("app.name")}
              <small>{t("app.tagline")}</small>
            </a>
            <MainNav items={items} label={t("nav.label")} />
            {access.state === "active" ? (
              <form className="account" action={signOutAction} data-form="sign-out">
                <input type="hidden" name="locale" value={locale} />
                <span className="who" data-testid="signed-in-as">
                  {t("auth.signedInAs", { name: access.fullName })}
                </span>
                <button type="submit" className="link">
                  {t("auth.signOut")}
                </button>
              </form>
            ) : null}
            <LanguageSwitch target={other} label={switchLabel} title={t("nav.language")} />
          </div>
        </header>
        <main id="content">{children}</main>
      </body>
    </html>
  );
}
