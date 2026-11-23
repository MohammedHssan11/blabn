"use server";

import { redirect } from "next/navigation";
import { COMPARISON_BRANCH_CODES, ALL_BRANCH_CODES } from "@/modules/access/catalog";
import { localeField, textField } from "@/modules/access/forms";
import { requireAccess } from "@/modules/access/guard";
import { addSource, mapComparisonError, saveComparison, saveSettings } from "./data";
import { buildEntryPayload, isRequestId, safeComparisonPath } from "./forms";

function withParam(path: string, name: string, value: string): string {
  const url = new URL(path, "http://site.invalid");
  url.searchParams.delete("error");
  url.searchParams.delete("notice");
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}`;
}

/**
 * Saves Al Quds or Bourgogne figures. Authorizes first (comparison.enter for that branch), then sends
 * one command as the signed-in person. The request identifier is written into the form when the page
 * is rendered, so a resubmitted or retried form is the same request: the database returns its first
 * result and adds no second revision.
 */
export async function saveComparisonAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const back = safeComparisonPath(locale, textField(data, "back"), `/${locale}/comparison/entry`);
  const branch = textField(data, "branch");
  if (!(COMPARISON_BRANCH_CODES as readonly string[]).includes(branch)) redirect(withParam(back, "error", "invalid_input"));
  await requireAccess({ locale, path: back, require: { permission: "comparison.enter", branch } });
  const request = textField(data, "request");
  const payload = buildEntryPayload((name) => textField(data, name), (name) => data.get(name) !== null);
  if (!isRequestId(request) || !payload) redirect(withParam(back, "error", "invalid_input"));

  const result = await saveComparison(branch, request.toLowerCase(), payload);
  if (result.error) redirect(withParam(back, "error", mapComparisonError(result.error)));
  redirect(withParam(back, "notice", result.data?.replayed ? "comparison_replayed" : "comparison_saved"));
}

/** Live source, entry owner and first live business date of one branch (System Admin). */
export async function saveSettingsAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const back = `/${locale}/comparison/settings`;
  await requireAccess({ locale, path: back, require: { permission: "admin.config.manage" } });
  const branch = textField(data, "branch");
  const expected = Number(textField(data, "revision"));
  const liveSource = textField(data, "live_source") || null;
  const owner = textField(data, "entry_owner") || null;
  const liveFrom = textField(data, "live_from") || null;
  if (!(ALL_BRANCH_CODES as readonly string[]).includes(branch) || !Number.isSafeInteger(expected) || expected < 0
    || (owner !== null && !isRequestId(owner)) || (liveFrom !== null && !/^\d{4}-\d{2}-\d{2}$/.test(liveFrom))
    || (liveSource !== null && !/^[a-z][a-z0-9_]{1,39}$/.test(liveSource))) {
    redirect(withParam(back, "error", "invalid_input"));
  }
  const { error } = await saveSettings(branch, expected, liveSource, owner, liveFrom);
  if (error) redirect(withParam(back, "error", mapComparisonError(error)));
  redirect(withParam(back, "notice", "comparison_settings_saved"));
}

/** Adds a source designation, e.g. the approved live source once Abdo names it (System Admin). */
export async function addSourceAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const back = `/${locale}/comparison/settings`;
  await requireAccess({ locale, path: back, require: { permission: "admin.config.manage" } });
  const key = textField(data, "key");
  const labelEn = textField(data, "label_en");
  const labelAr = textField(data, "label_ar");
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(key) || labelEn.length < 1 || labelEn.length > 80 || labelAr.length < 1 || labelAr.length > 80) {
    redirect(withParam(back, "error", "invalid_input"));
  }
  const { error } = await addSource(key, labelEn, labelAr);
  if (error) redirect(withParam(back, "error", mapComparisonError(error)));
  redirect(withParam(back, "notice", "comparison_source_added"));
}
