import "server-only";
import { forbidden, redirect } from "next/navigation";
import { connection, NextResponse } from "next/server";
import { siteUrl } from "@/lib/supabase/config";
import { createUserClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/config";
import type { PermissionKey } from "./catalog";
import { getAccessContext, type ActiveAccess } from "./session";

/**
 * The one authorization path. Pages, server actions, route handlers (exports, downloads, direct
 * requests) all end up in `authorize`, which
 *   1. asks Supabase Auth whether the session is valid,
 *   2. asks the database whether the person is an ACTIVE staff member right now,
 *   3. asks the database (`app_authorize`, the same function the row-level policies use) whether
 *      they hold each required permission for each required branch.
 * Every step reads live data, so a permission removed or an account disabled blocks the very next
 * request even when the session is still open. Any failure to get an answer denies.
 */

export interface Requirement {
  permission: PermissionKey;
  /** Branch code. Omit for organization permissions. */
  branch?: string;
}

export type Denial = "unauthenticated" | "session_ended" | "password_change" | "forbidden" | "unavailable";

export type Decision = { ok: true; access: ActiveAccess } | { ok: false; reason: Denial };

export interface AuthorizeOptions {
  /** The password-change page itself must be reachable while a change is required. */
  allowPasswordChange?: boolean;
}

export async function authorize(
  requirements: Requirement | readonly Requirement[] = [],
  options: AuthorizeOptions = {},
): Promise<Decision> {
  await connection();
  const access = await getAccessContext();
  switch (access.state) {
    case "anonymous":
      return { ok: false, reason: "unauthenticated" };
    case "unregistered":
    case "disabled":
      return { ok: false, reason: "session_ended" };
    case "unavailable":
      return { ok: false, reason: "unavailable" };
    case "active":
      break;
  }
  if (access.mustChangePassword && !options.allowPasswordChange) {
    return { ok: false, reason: "password_change" };
  }

  const list: readonly Requirement[] = Array.isArray(requirements) ? requirements : [requirements as Requirement];
  if (list.length > 0) {
    let supabase;
    try {
      supabase = await createUserClient();
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    for (const requirement of list) {
      const { data, error } = await supabase.rpc("app_authorize", {
        p_permission: requirement.permission,
        p_branch_code: requirement.branch ?? null,
      });
      if (error) return { ok: false, reason: "unavailable" };
      if (data !== true) return { ok: false, reason: "forbidden" };
    }
  }
  return { ok: true, access };
}

// ------------------------------------------------------------------ pages and server actions

export interface PageGuard {
  locale: Locale;
  /** Where to come back to after signing in, e.g. "/en/admin/staff". Must start with "/<locale>/". */
  path: string;
  require?: Requirement | readonly Requirement[];
  allowPasswordChange?: boolean;
}

/**
 * For Server Components and server actions: returns the signed-in person, or ends the request
 * (redirect to sign-in, to the password change, to a session-ended notice, or a 403 page).
 */
export async function requireAccess(guard: PageGuard): Promise<ActiveAccess> {
  const decision = await authorize(guard.require ?? [], { allowPasswordChange: guard.allowPasswordChange });
  if (decision.ok) return decision.access;
  switch (decision.reason) {
    case "unauthenticated":
      redirect(`/${guard.locale}/sign-in?next=${encodeURIComponent(guard.path)}`);
    case "session_ended":
      redirect(`/api/auth/session-ended?locale=${guard.locale}`);
    case "password_change":
      redirect(`/${guard.locale}/account/password`);
    case "forbidden":
      forbidden();
    case "unavailable":
      throw new Error("The authorization service did not answer; the request was denied.");
  }
}

// ------------------------------------------------------------------ route handlers

const STATUS: Record<Denial, number> = {
  unauthenticated: 401,
  session_ended: 401,
  password_change: 403,
  forbidden: 403,
  unavailable: 503,
};

/** For route handlers: the signed-in person, or the JSON error response to return. */
export async function authorizeRequest(
  requirements: Requirement | readonly Requirement[] = [],
): Promise<{ ok: true; access: ActiveAccess } | { ok: false; response: NextResponse }> {
  const decision = await authorize(requirements);
  if (decision.ok) return decision;
  return {
    ok: false,
    response: NextResponse.json({ error: decision.reason }, { status: STATUS[decision.reason], headers: { "Cache-Control": "no-store" } }),
  };
}

/**
 * Browsers always send an Origin header on a cross-site POST; refuse one that is not this site.
 * Requests without Origin (scripts, tests) are not browser-driven and carry their own credentials.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(siteUrl()).origin;
  } catch {
    return false;
  }
}
