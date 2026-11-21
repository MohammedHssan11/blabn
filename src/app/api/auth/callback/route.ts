import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale } from "@/i18n/config";
import { siteUrl } from "@/lib/supabase/config";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Landing point of the password-recovery email. Supabase redirects here with a one-time `code`;
 * it is exchanged for a session (stored in the secure cookies) and the person is sent to choose a
 * new password. A bad or used code goes back to the recovery page with a message.
 *
 * Redirects are built from SITE_URL, the address people open the application at, never from the
 * request URL (which a proxy may rewrite): the session cookie only applies to that address.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const requested = searchParams.get("locale");
  const locale = isLocale(requested) ? requested : defaultLocale;
  const code = searchParams.get("code");

  const failure = new URL(`/${locale}/forgot-password?error=link_invalid`, siteUrl());
  if (!code) return NextResponse.redirect(failure);

  const supabase = await createUserClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(failure);

  return NextResponse.redirect(new URL(`/${locale}/account/password?recovery=1`, siteUrl()));
}
