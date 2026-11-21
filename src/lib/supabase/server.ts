import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { authCookieOptions, requireSupabaseConfig } from "./config";

/**
 * Supabase client that acts AS THE SIGNED-IN PERSON: it carries their session from the cookies, so
 * database commands and queries run with their identity and row-level security applies. Use this
 * for every read and write on behalf of a user. The service-role client (admin.ts) is only for
 * creating Auth accounts, after the caller was authorized.
 *
 * In a Server Component the cookies cannot be written; the proxy refreshes the session before the
 * page renders, so a failed write there is ignored. Server actions and route handlers write them.
 */
export async function createUserClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = requireSupabaseConfig();
  const store = await cookies();
  return createServerClient(url, publishableKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* called from a Server Component: the proxy keeps the session fresh */
        }
      },
    },
  });
}
