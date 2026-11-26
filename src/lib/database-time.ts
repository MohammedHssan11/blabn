import "server-only";
import { cache } from "react";
import { createUserClient } from "@/lib/supabase/server";
import { businessDateOf, isBusinessDate, type BusinessDate } from "@/lib/dates";

/**
 * Today's business date and branch-local times, asked of PostgreSQL. The database is the time-zone
 * authority (Phase 4): the server's Node.js build can carry older Casablanca rules, and then its
 * "today" turns over at a different hour from the one every write is checked against.
 */

/** The operating branch's business date now, by its own rollover rule (02:00 for Maarif). */
export const readBusinessToday = cache(async (): Promise<BusinessDate> => {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_business_today");
  if (!error && isBusinessDate(data)) return data;
  // Only a request without a usable session lands here; it is redirected or refused before this value
  // is shown or written, and every write is checked against the database date again.
  return businessDateOf(new Date(), "Africa/Casablanca", "02:00");
});

/**
 * Each instant as the operating branch's wall-clock time, "YYYY-MM-DDTHH:MM", in the order given.
 * Format the result with the UTC time zone to print exactly that wall-clock time.
 */
export async function readLocalTimes(instants: readonly string[]): Promise<string[]> {
  if (instants.length === 0) return [];
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_local_times", { p_instants: instants });
  if (error || !Array.isArray(data) || data.length !== instants.length) {
    throw new Error(`Local times could not be read (${error?.code ?? "unknown"}).`);
  }
  return data as string[];
}
