import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { MODULES } from "@/modules/registry";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { ALL_BRANCH_CODES, OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  // Any active staff member may open the home page; the cards below list only what they hold.
  const access = await requireAccess({ locale, path: `/${locale}` });
  const t = createTranslator(locale);

  const prototypes = [
    ...(holds(access, "daily_close.view", OPERATING_BRANCH_CODE)
      ? [
          { href: `/${locale}/daily-close`, title: t("nav.dailyClose"), body: t("home.prototypes.dailyClose") },
          { href: `/${locale}/cash-count`, title: t("nav.cashCount"), body: t("home.prototypes.cashCount") },
        ]
      : []),
    ...(ALL_BRANCH_CODES.every((code) => holds(access, "comparison.view", code))
      ? [{ href: `/${locale}/comparison`, title: t("nav.comparison"), body: t("home.prototypes.comparison") }]
      : []),
  ];

  return (
    <>
      <h1>{t("home.title")}</h1>
      <p className="lead">{t("home.welcome", { name: access.fullName })}</p>
      <ResultMessages t={t} notice={first(sp.notice)} />
      <p className="lead">{t("home.intro")}</p>
      {access.permissions.length === 0 ? <p className="notice warn">{t("home.noAccess")}</p> : null}

      {prototypes.length > 0 ? (
        <>
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
        </>
      ) : null}

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
