"use server";

import { redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/config";
import { requireAccess } from "./guard";
import { checkNewPassword, localeField, looksLikeEmail, safeNextPath, secretField, textField } from "./forms";

/**
 * Sign-in, sign-out, password recovery and the signed-in person's own password change.
 * Forms post here; every outcome is a redirect to a page that explains it (the form keeps
 * working without JavaScript). Messages never reveal whether an email has an account.
 */

function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return query ? `${path}?${query}` : path;
}

export async function signInAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const email = textField(data, "email").toLowerCase();
  const password = secretField(data, "password");
  const next = safeNextPath(locale, textField(data, "next"));
  const back = (error: string) => withQuery(`/${locale}/sign-in`, { error, next });

  if (!email || !password) redirect(back("missing"));

  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const unreachable = error.name === "AuthRetryableFetchError" || (typeof error.status === "number" && error.status >= 500);
    redirect(back(unreachable ? "unavailable" : error.status === 429 ? "rate_limited" : "invalid"));
  }

  // A valid password is not enough: the person must be an active staff member right now.
  const { data: context, error: contextError } = await supabase.rpc("app_access_context");
  if (contextError || !context) {
    await supabase.auth.signOut({ scope: "local" });
    redirect(back("unavailable"));
  }
  const state = (context as { state?: string }).state;
  if (state !== "active") {
    await supabase.auth.signOut({ scope: "local" });
    redirect(back("not_allowed"));
  }
  const mustChange = (context as { must_change_password?: boolean }).must_change_password === true;
  redirect(mustChange ? `/${locale}/account/password` : (next ?? `/${locale}`));
}

export async function signOutAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const supabase = await createUserClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(withQuery(`/${locale}/sign-in`, { notice: "signed_out" }));
}

export async function requestRecoveryAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const email = textField(data, "email").toLowerCase();
  if (!looksLikeEmail(email)) redirect(withQuery(`/${locale}/forgot-password`, { error: "invalid_email" }));

  const supabase = await createUserClient();
  const redirectTo = `${siteUrl()}/api/auth/callback?locale=${locale}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error && error.status === 429) redirect(withQuery(`/${locale}/forgot-password`, { error: "rate_limited" }));
  if (error && (error.name === "AuthRetryableFetchError" || (typeof error.status === "number" && error.status >= 500))) {
    redirect(withQuery(`/${locale}/forgot-password`, { error: "unavailable" }));
  }
  // The same answer whether or not the address has an account.
  redirect(withQuery(`/${locale}/forgot-password`, { sent: "1" }));
}

/** Sets the signed-in person's own password (first sign-in, or after the recovery link). */
export async function changeOwnPasswordAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const here = `/${locale}/account/password`;
  await requireAccess({ locale, path: here, allowPasswordChange: true });

  const password = secretField(data, "password");
  const problem = checkNewPassword(password, secretField(data, "confirm"));
  if (problem === "mismatch") redirect(withQuery(here, { error: "password_mismatch" }));
  if (problem) redirect(withQuery(here, { error: "weak_password" }));

  const supabase = await createUserClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const code = (error as { code?: string }).code;
    redirect(withQuery(here, { error: code === "same_password" ? "same_password" : code === "weak_password" ? "weak_password" : "unexpected" }));
  }
  const { error: flagError } = await supabase.rpc("app_complete_password_change");
  if (flagError) redirect(withQuery(here, { error: "unexpected" }));
  redirect(withQuery(`/${locale}`, { notice: "password_changed" }));
}
