import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client with the service role. It bypasses row-level security, so it is used
 * only for what a user session cannot do, and only AFTER the caller was authorized against the
 * database:
 *   - creating, re-emailing, banning or unbanning Supabase Auth accounts, and setting temporary
 *     passwords (src/modules/access/staff-actions.ts);
 *   - the one-time first-administrator bootstrap (scripts/phase3/bootstrap-admin.mjs, which has
 *     its own client).
 * Reads and writes of business data must use the signed-in person's client (server.ts) so the
 * row-level policies apply. tests/architecture.test.ts lists the files allowed to import this one.
 * Never import it from a client component; the key has no NEXT_PUBLIC_ prefix on purpose.
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
