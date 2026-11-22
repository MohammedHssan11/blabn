import { usesDemoFixtures } from "@/modules/closing/operations";
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

  const shortcuts = [
    ...(holds(access, "daily_close.view", OPERATING_BRANCH_CODE)
      ? [
          { href: `/${locale}/daily-close`, title: t("nav.dailyClose"), body: t(usesDemoFixtures() ? "home.prototypes.dailyClose" : "operations.closeHome") },
          { href: `/${locale}/cash-count`, title: t("nav.cashCount"), body: t(usesDemoFixtures() ? "home.prototypes.cashCount" : "operations.countHome") },
        ]
      : []),
    ...(ALL_BRANCH_CODES.every((code) => holds(access, "comparison.view", code))
      ? [{ href: `/${locale}/comparison`, title: t("nav.comparison"), body: t("home.prototypes.comparison") }]
      : []),
    ...(holds(access, "reports.view", OPERATING_BRANCH_CODE)
      ? [{ href: `/${locale}/reports`, title: t("nav.reportMap"), body: t("home.shortcuts.reports") }]
      : []),
    ...(holds(access, "inventory.adjust", OPERATING_BRANCH_CODE)
      ? [{ href: `/${locale}/inventory/adjustments`, title: t("nav.inventoryAdjustments"), body: t("home.shortcuts.inventory") }]
      : []),
    ...(holds(access, "admin.users.manage")
      ? [{ href: `/${locale}/admin/staff`, title: t("nav.staff"), body: t("home.shortcuts.staff") }]
      : []),
    ...(holds(access, "admin.audit.view")
      ? [{ href: `/${locale}/admin/audit`, title: t("nav.audit"), body: t("home.shortcuts.audit") }]
      : []),
  ];

  return (
    <>
      <header className="workspace-intro">
        <h1>{t("home.title")}</h1>
        <p>{t("home.welcome", { name: access.fullName })}</p>
      </header>
      <ResultMessages t={t} notice={first(sp.notice)} />

      {shortcuts.length > 0 ? (
        <section className="workspace-section" aria-labelledby="shortcuts-title">
          <h2 id="shortcuts-title">{t("home.shortcuts.title")}</h2>
          <div className="grid workspace-grid">
            {shortcuts.map((item) => (
              <Link className="card workspace-link" href={item.href} key={item.href}>
                <span>
                  <strong>{item.title}</strong>
                  <span className="workspace-link-description">{item.body}</span>
                </span>
                <span className="workspace-arrow" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </section>
      ) : <p className="notice">{t("home.noAccess")}</p>}

      <details className="workspace-modules">
        <summary>{t("home.modulesTitle")}</summary>
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
      </details>
    </>
  );
}
