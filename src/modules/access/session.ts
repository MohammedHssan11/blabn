import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { createUserClient } from "@/lib/supabase/server";
import type { PermissionKey } from "./catalog";

export interface GrantedPermission {
  permission: string;
  /** Branch code, or null for an organization permission. */
  branch: string | null;
}

export interface ActiveAccess {
  state: "active";
  userId: string;
  fullName: string;
  email: string;
  mustChangePassword: boolean;
  /** For menus and display only. Decisions use `authorize` (the database answers). */
  permissions: GrantedPermission[];
}

export type AccessContext =
  | { state: "anonymous" }
  /** Signed in with Supabase Auth, but not a staff member of any organization. */
  | { state: "unregistered" }
  /** A staff account that Abdo disabled. */
  | { state: "disabled" }
  /** Authentication or database service did not answer. Callers must fail closed. */
  | { state: "unavailable" }
  | ActiveAccess;

interface ContextRow {
  state?: string;
  user_id?: string;
  full_name?: string;
  email?: string;
  must_change_password?: boolean;
  permissions?: Array<{ permission: string; branch: string | null }>;
}

/**
 * Who is asking, right now. Reads the session from the cookies, asks Supabase Auth to validate
 * it, then asks the database for the person's current state and permissions. Nothing is read
 * from a token claim, so removing a group or disabling an account shows on the very next request.
 * Cached for the duration of one request.
 */
export const getAccessContext = cache(async (): Promise<AccessContext> => {
  // Per-request data: never prerender. (Must run outside the try block below, which would swallow
  // the signal Next.js uses to switch a page to dynamic rendering.)
  await connection();
  try {
    const supabase = await createUserClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      const unreachable = error && (error.name === "AuthRetryableFetchError" || (typeof error.status === "number" && error.status >= 500));
      return { state: unreachable ? "unavailable" : "anonymous" };
    }
    const { data: row, error: rpcError } = await supabase.rpc("app_access_context");
    if (rpcError || !row) return { state: "unavailable" };
    const context = row as ContextRow;
    switch (context.state) {
      case "active":
        return {
          state: "active",
          userId: String(context.user_id),
          fullName: String(context.full_name),
          email: String(context.email),
          mustChangePassword: context.must_change_password === true,
          permissions: context.permissions ?? [],
        };
      case "unregistered":
        return { state: "unregistered" };
      case "disabled":
        return { state: "disabled" };
      case "anonymous":
        return { state: "anonymous" };
      default:
        return { state: "unavailable" };
    }
  } catch {
    return { state: "unavailable" };
  }
});

/** UI hint only (menus). Never use it to allow an action: call `authorize` instead. */
export function holds(access: ActiveAccess, permission: PermissionKey, branch: string | null = null): boolean {
  return access.permissions.some((p) => p.permission === permission && p.branch === branch);
}
