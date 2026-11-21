import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "@/i18n/config";
import { authCookieOptions, readSupabaseConfig } from "@/lib/supabase/config";

/**
 * Language routing, language persistence and session refresh.
 *
 * - Every page lives under /ar or /en.
 * - A path without a language is redirected to the visitor's saved language
 *   (cookie), or to Arabic the first time.
 * - Opening a page in a language (a real navigation, not a background prefetch)
 *   saves that language, so the choice survives navigation and later visits.
 * - When the visitor carries a Supabase session, it is refreshed here so the page that renders
 *   next sees a valid session. THIS IS NOT AN AUTHORIZATION CHECK: every page, action and download
 *   authorizes itself (src/modules/access/guard.ts) against the database.
 * - The language of the request is passed on as the `x-locale` header so the 403 page can use it.
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

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name));
}

export async function proxy(request: NextRequest) {
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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-locale", first);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const config = readSupabaseConfig();
  if (config && hasSessionCookie(request)) {
    const supabase = createServerClient(config.url, config.publishableKey, {
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    try {
      await supabase.auth.getUser();
    } catch {
      /* the page will find the session unusable and send the person to sign in */
    }
  }

  if (first !== saved && isDocumentNavigation(request)) {
    response.cookies.set(LOCALE_COOKIE, first, COOKIE_OPTIONS);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // Skip Next.js internals, API routes and files with an extension.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
