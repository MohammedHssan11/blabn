import { getMessages, type MessageKey } from "@/i18n/dictionary";
import type { GroupKey, PermissionKey } from "./catalog";

/**
 * Query-string codes (?error=…, ?notice=…) come from the browser, so they are only turned into a
 * message when they are on the whitelist read from the English catalog. Anything else is ignored
 * or shown as the generic error; an unknown code can never reach the translator.
 */
const catalog = getMessages("en");

function whitelisted<T extends Record<string, string>>(section: T) {
  const keys = new Set(Object.keys(section));
  return (code: string | undefined): code is Extract<keyof T, string> => typeof code === "string" && keys.has(code);
}

const isErrorCode = whitelisted(catalog.errors);
const isNoticeCode = whitelisted(catalog.notices);
const isWarningCode = whitelisted(catalog.warnings);
const isAuthNotice = whitelisted(catalog.auth.notices);

export function errorMessageKey(code: string | undefined): MessageKey | null {
  if (code === undefined || code === "") return null;
  return isErrorCode(code) ? (`errors.${code}` as MessageKey) : "errors.unexpected";
}

export function noticeMessageKey(code: string | undefined): MessageKey | null {
  return isNoticeCode(code) ? (`notices.${code}` as MessageKey) : null;
}

export function warningMessageKey(code: string | undefined): MessageKey | null {
  return isWarningCode(code) ? (`warnings.${code}` as MessageKey) : null;
}

export function authNoticeKey(code: string | undefined): MessageKey | null {
  return isAuthNotice(code) ? (`auth.notices.${code}` as MessageKey) : null;
}

export const groupNameKey = (group: GroupKey) => `access.groups.${group}.name` as MessageKey;
export const groupDescriptionKey = (group: GroupKey) => `access.groups.${group}.description` as MessageKey;
export const permissionLabelKey = (permission: PermissionKey) => `access.permission.${permission.replaceAll(".", "_")}` as MessageKey;

/** Audit actions without a translation are shown as their code. */
export function auditActionKey(action: string): MessageKey | null {
  const flat = action.replaceAll(".", "_");
  return flat in catalog.audit.action ? (`audit.action.${flat}` as MessageKey) : null;
}
