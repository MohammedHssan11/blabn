import Link from "next/link";
import { headers } from "next/headers";
import { defaultLocale, isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";

/**
 * Shown, with HTTP status 403, when a signed-in person opens a page they have no permission for
 * (`forbidden()` in src/modules/access/guard.ts). It renders inside the language layout, so the
 * page keeps its header and direction. The language comes from the `x-locale` header the proxy
 * sets (this file receives no props).
 *
 * Next.js sends the 403 status first and then streams this UI to the browser; the response body
 * of a refused page is therefore the framework's error shell plus this component's payload.
 */
export default async function Forbidden() {
  const requested = (await headers()).get("x-locale");
  const locale = isLocale(requested) ? requested : defaultLocale;
  const t = createTranslator(locale);
  return (
    <div className="card auth-card" data-page="forbidden">
      <h1>{t("forbidden.title")}</h1>
      <p className="notice bad" role="alert">
        {t("forbidden.body")}
      </p>
      <p>
        <Link href={`/${locale}`}>{t("forbidden.home")}</Link>
      </p>
    </div>
  );
}
