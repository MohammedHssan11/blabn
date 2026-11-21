import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client with the service role. It bypasses row-level
 * security, so it may only be used inside server commands that have already
 * checked the user, branch and permission (Phase 3 onward). Never import this
 * from a client component; the key has no NEXT_PUBLIC_ prefix on purpose.
 *
 * Phase 2 screens read the synthetic fixtures (src/lib/repository.ts) instead,
 * so nothing calls this yet.
 */
let client: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
