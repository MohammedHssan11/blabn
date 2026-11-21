/**
 * Supabase and site settings read from the environment. Safe to import from the proxy
 * (no server-only marker); it holds no secret: the public URL, the publishable key and the
 * site address. The service-role key is read only in src/lib/supabase/admin.ts.
 */
export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

export function readSupabaseConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function requireSupabaseConfig(): SupabasePublicConfig {
  const config = readSupabaseConfig();
  if (!config) {
    throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local");
  }
  return config;
}

/** Public address of the application, used in password-recovery links. No trailing slash. */
export function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
}

/** Session cookies are marked Secure whenever the site is served over HTTPS. */
export function authCookieOptions() {
  return {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure: siteUrl().startsWith("https://"),
  };
}
