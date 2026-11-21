import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import "../globals.css";
import { directions, isLocale, locales, otherLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { MainNav } from "@/components/MainNav";

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

  const items = [
    { href: `/${locale}`, label: t("nav.home") },
    { href: `/${locale}/daily-close`, label: t("nav.dailyClose") },
    { href: `/${locale}/cash-count`, label: t("nav.cashCount") },
    { href: `/${locale}/comparison`, label: t("nav.comparison") },
    { href: `/${locale}/reports`, label: t("nav.reportMap") },
  ];

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
            <LanguageSwitch target={other} label={switchLabel} title={t("nav.language")} />
          </div>
        </header>
        <main id="content">{children}</main>
      </body>
    </html>
  );
}
