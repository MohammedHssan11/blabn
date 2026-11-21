import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale } from "@/i18n/config";
import { siteUrl } from "@/lib/supabase/config";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Where a request lands when its session is valid for Supabase Auth but the database no longer
 * lets the person in (the account was disabled, or has no staff record). It clears this browser's
 * session cookies and explains why on the sign-in page. It only ever ends the caller's own session.
 */
export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("locale");
  const locale = isLocale(requested) ? requested : defaultLocale;
  try {
    const supabase = await createUserClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* nothing to clear */
  }
  const response = NextResponse.redirect(new URL(`/${locale}/sign-in?notice=session_ended`, siteUrl()));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
