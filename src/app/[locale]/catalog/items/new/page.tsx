import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { readUnits } from "@/modules/catalog/data";
import { ITEM_KINDS, type ItemKind } from "@/modules/catalog/forms";
import { ItemForm } from "@/modules/catalog/item-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("catalog.items.newTitle") : undefined };
}

export default async function NewItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const path = `/${locale}/catalog/items/new`;
  await requireAccess({ locale, path, require: { permission: "recipes.manage" } });
  const t = createTranslator(locale);
  const kindParam = first(sp.kind);
  const kind = (ITEM_KINDS as readonly string[]).includes(kindParam ?? "") ? (kindParam as ItemKind) : undefined;
  const units = await readUnits();
  return (
    <>
      <h1>{t("catalog.items.newTitle")}</h1>
      <ResultMessages t={t} error={first(sp.error)} />
      <ItemForm locale={locale} t={t} units={units} kind={kind} back={path} />
      <p><Link href={`/${locale}/catalog`}>{t("catalog.items.back")}</Link></p>
    </>
  );
}
