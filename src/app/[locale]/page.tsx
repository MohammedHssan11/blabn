import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { MODULES } from "@/modules/registry";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);

  const prototypes = [
    { href: `/${locale}/daily-close`, title: t("nav.dailyClose"), body: t("home.prototypes.dailyClose") },
    { href: `/${locale}/cash-count`, title: t("nav.cashCount"), body: t("home.prototypes.cashCount") },
    { href: `/${locale}/comparison`, title: t("nav.comparison"), body: t("home.prototypes.comparison") },
  ];

  return (
    <>
      <h1>{t("home.title")}</h1>
      <p className="lead">{t("home.intro")}</p>

      <h2>{t("home.prototypesTitle")}</h2>
      <div className="grid">
        {prototypes.map((item) => (
          <article className="card" key={item.href}>
            <h3>
              <Link href={item.href}>{item.title}</Link>
            </h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>

      <h2>{t("home.modulesTitle")}</h2>
      <p className="lead">{t("home.modulesIntro")}</p>
      <div className="grid">
        {MODULES.map((module) => (
          <article className="card" key={module.key} data-module={module.key}>
            <h3>{t(`home.modules.${module.key}.name` as MessageKey)}</h3>
            <p>{t(`home.modules.${module.key}.description` as MessageKey)}</p>
            <span className="badge">{t("common.phase", { n: module.phase })}</span>
          </article>
        ))}
      </div>
    </>
  );
}
