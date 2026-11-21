import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "@/i18n/config";

/**
 * Language routing and persistence.
 *
 * - Every page lives under /ar or /en.
 * - A path without a language is redirected to the visitor's saved language
 *   (cookie), or to Arabic the first time.
 * - Opening a page in a language (a real navigation, not a background prefetch)
 *   saves that language, so the choice survives navigation and later visits.
 */
const COOKIE_OPTIONS = {
  path: "/",
  maxAge: LOCALE_COOKIE_MAX_AGE,
  sameSite: "lax" as const,
  httpOnly: false,
};

function isPrefetch(request: NextRequest): boolean {
  const h = request.headers;
  return h.has("next-router-prefetch") || h.get("purpose") === "prefetch" || h.get("sec-purpose")?.includes("prefetch") === true;
}

function isDocumentNavigation(request: NextRequest): boolean {
  if (isPrefetch(request)) return false;
  const dest = request.headers.get("sec-fetch-dest");
  if (dest) return dest === "document";
  // Clients that do not send Fetch Metadata: treat an HTML request without RSC as a navigation.
  return (request.headers.get("accept") ?? "").includes("text/html") && !request.headers.has("rsc");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split("/")[1];
  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  const preferred: Locale = isLocale(saved) ? saved : defaultLocale;

  if (!isLocale(first)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${preferred}${pathname === "/" ? "" : pathname}`;
    url.search = search;
    const response = NextResponse.redirect(url);
    if (!isLocale(saved)) response.cookies.set(LOCALE_COOKIE, preferred, COOKIE_OPTIONS);
    return response;
  }

  const response = NextResponse.next();
  if (first !== saved && isDocumentNavigation(request)) {
    response.cookies.set(LOCALE_COOKIE, first, COOKIE_OPTIONS);
  }
  return response;
}

export const config = {
  // Skip Next.js internals, API routes and files with an extension.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
