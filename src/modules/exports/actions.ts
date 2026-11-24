"use server";

import { redirect } from "next/navigation";
import { localeField, textField } from "@/modules/access/forms";
import { requireAccess } from "@/modules/access/guard";
import { isCatalogId } from "@/modules/catalog/forms";
import { defaultToday } from "@/modules/comparisons/service";
import { exportRequirements, validateRequest, type Period } from "./families";
import { mapExportError, readExport, requestExport, runExport } from "./service";

/**
 * Requesting and retrying an Excel export. Both authorize first: the family's permission for every
 * branch of the export (and the draft-export permission when drafts are included). The request
 * identifier is written into the form when the page is rendered, so a resubmitted form is the same
 * export; the database returns it instead of creating a second one, and a finished export is never
 * rebuilt.
 */

function periodFrom(data: FormData): Period | null {
  const mode = textField(data, "mode");
  if (mode === "month") return { mode, month: textField(data, "month") };
  if (mode === "day") return { mode, date: textField(data, "date") };
  if (mode === "week") return { mode, current: textField(data, "current"), prior: textField(data, "prior") };
  return null;
}

export async function requestExportAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const back = `/${locale}/reports/exports`;
  const family = textField(data, "family");
  const branches = data.getAll("branches").map(String).filter(Boolean);
  const includeDrafts = textField(data, "drafts") === "1";
  const checked = validateRequest({ family, branches, period: periodFrom(data), includeDrafts, today: defaultToday() });
  if (!checked.ok) {
    await requireAccess({ locale, path: back });
    redirect(`${back}?error=export_invalid`);
  }
  await requireAccess({ locale, path: back, require: exportRequirements(checked.family, checked.branches, includeDrafts) });
  const request = textField(data, "request");
  const workbookLocale = textField(data, "workbook_locale") === "en" ? "en" : "ar";
  if (!isCatalogId(request)) redirect(`${back}?error=export_invalid`);

  const { data: record, error } = await requestExport({ family: checked.family, branches: checked.branches, period: checked.period,
    locale: workbookLocale, includeDrafts, request: request.toLowerCase() });
  if (error || !record) redirect(`${back}?error=${mapExportError(error)}`);
  const result = record.status === "complete" ? { status: "complete" as const } : await runExport(record.id);
  const notice = result.status === "complete" ? (record.replayed ? "export_replayed" : "export_complete") : null;
  const error2 = result.status === "busy" ? "export_busy" : result.status === "failed" ? "export_failed" : null;
  redirect(`/${locale}/reports/exports/${record.id}${notice ? `?notice=${notice}` : `?error=${error2}`}`);
}

export async function retryExportAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const id = textField(data, "export");
  const back = `/${locale}/reports/exports`;
  await requireAccess({ locale, path: back });
  if (!isCatalogId(id)) redirect(`${back}?error=export_invalid`);
  const record = await readExport(id.toLowerCase());
  if (!record || !record.mine) redirect(`${back}?error=export_not_found`);
  await requireAccess({ locale, path: `${back}/${record.id}`, require: exportRequirements(record.family, record.branches, record.include_drafts) });
  const result = await runExport(record.id);
  const query = result.status === "complete" ? "notice=export_complete" : result.status === "busy" ? "error=export_busy" : "error=export_failed";
  redirect(`${back}/${record.id}?${query}`);
}
