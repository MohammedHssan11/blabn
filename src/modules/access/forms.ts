import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { BRANCH_GROUPS, ORGANIZATION_GROUPS, isBranchGroupKey } from "./catalog";

/** Plain helpers for the account forms. No server-only imports, so they are unit-tested directly. */

export function textField(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Passwords are used exactly as typed (no trimming). */
export function secretField(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

export function localeField(data: FormData): Locale {
  const value = data.get("locale");
  return isLocale(value) ? value : defaultLocale;
}

/**
 * A "come back to" path is accepted only when it is a page of the same language on this site.
 * Anything else (another host, a protocol-relative URL, another language) is dropped.
 */
export function safeNextPath(locale: Locale, value: string | null | undefined): string | null {
  if (!value || !value.startsWith(`/${locale}/`) || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value, "http://site.invalid");
    if (url.origin !== "http://site.invalid" || !url.pathname.startsWith(`/${locale}/`)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export const MIN_PASSWORD_LENGTH = 10;

export type PasswordProblem = "too_short" | "mismatch" | "missing";

export function checkNewPassword(password: string, confirmation?: string): PasswordProblem | null {
  if (!password) return "missing";
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (confirmation !== undefined && password !== confirmation) return "mismatch";
  return null;
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export interface BranchRef {
  id: string;
  code: string;
}

/** The access document the database commands take (see app_private.desired_access). */
export interface AccessDocument {
  organization_groups: string[];
  branches: Array<{ branch_id: string; groups: string[] }>;
}

/**
 * Reads the access matrix of the staff forms. Field names:
 *   org_group           value "system_admin"                       (organization groups)
 *   branch              value "<branch code>"                       (membership)
 *   group               value "<branch code>:<group key>"           (a group at a branch)
 * Choosing a group at a branch also makes the person a member of that branch.
 * Unknown branches or groups are ignored (the database would refuse them anyway).
 */
export function parseAccessForm(data: FormData, branches: readonly BranchRef[]): AccessDocument {
  const byCode = new Map(branches.map((branch) => [branch.code, branch.id]));
  const members = new Set<string>();
  const groupsByBranch = new Map<string, Set<string>>();

  for (const value of data.getAll("branch")) {
    if (typeof value === "string" && byCode.has(value)) members.add(value);
  }
  for (const value of data.getAll("group")) {
    if (typeof value !== "string") continue;
    const [code, group, ...rest] = value.split(":");
    if (!code || !group || rest.length > 0 || !byCode.has(code) || !isBranchGroupKey(group)) continue;
    members.add(code);
    if (!groupsByBranch.has(code)) groupsByBranch.set(code, new Set());
    groupsByBranch.get(code)?.add(group);
  }

  const organizationGroups = data
    .getAll("org_group")
    .filter((value): value is string => typeof value === "string" && (ORGANIZATION_GROUPS as readonly string[]).includes(value));

  return {
    organization_groups: [...new Set(organizationGroups)],
    branches: [...members].map((code) => ({
      branch_id: byCode.get(code) as string,
      groups: [...(groupsByBranch.get(code) ?? [])].sort((a, b) => BRANCH_GROUPS.indexOf(a as never) - BRANCH_GROUPS.indexOf(b as never)),
    })),
  };
}

/** Error codes shown to the user; each has a translation under `errors.<code>`. */
export type ErrorCode =
  | "forbidden"
  | "invalid_input"
  | "email_in_use"
  | "employee_number_in_use"
  | "weak_password"
  | "password_mismatch"
  | "same_password"
  | "last_admin"
  | "self_disable"
  | "not_found"
  | "invalid_access"
  | "unavailable"
  | "unexpected";

interface DatabaseError {
  code?: string;
  message?: string;
  details?: string | null;
}

/** Maps an error of a database command to the message the user sees. */
export function mapCommandError(error: DatabaseError | null | undefined): ErrorCode {
  const message = error?.message ?? "";
  if (message === "permission_denied" || error?.code === "42501") return "forbidden";
  if (message === "last_admin") return "last_admin";
  if (message === "self_disable") return "self_disable";
  if (message === "not_found") return "not_found";
  if (message === "invalid_input" || error?.code === "22023") return "invalid_input";
  if (error?.code === "23505") {
    const text = `${message} ${error?.details ?? ""}`;
    if (/employee_number/.test(text)) return "employee_number_in_use";
    return "email_in_use";
  }
  if (error?.code === "23514" || error?.code === "23503") return "invalid_access";
  return "unexpected";
}
