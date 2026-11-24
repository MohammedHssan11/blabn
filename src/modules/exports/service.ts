import "server-only";
import { createHash } from "node:crypto";
import { createUserClient } from "@/lib/supabase/server";
import { readBranchNames } from "@/modules/comparisons/data";
import { FIELD_MAP_FINDINGS_VERSION } from "@/modules/reports/field-map";
import { buildAbout } from "./build/about";
import { ExportDataError, loadReport } from "./data";
import { exportFileName, type Period } from "./families";
import { label } from "./labels";
import { cellText, renderWorkbook } from "./xlsx";
import { dataFingerprint, type Family } from "./model";
import { scanWorkbook } from "./scan";
import { CALC_RULES_VERSION, TEMPLATE_VERSIONS } from "./versions";

/**
 * One export, from request to stored file. Every step runs as the requester:
 *   request   app_report_export_request (permission for every branch; one export per request id)
 *   claim     app_report_export_claim   (starts attempt n; a finished export is never rebuilt)
 *   build     saved data -> model -> workbook -> scan (values only, direction, print setup)
 *   store     Storage upload to <org>/<export>/attempt-<n>.xlsx, never overwriting (private bucket)
 *   complete  app_report_export_complete (the database checks the stored object and its size)
 * Any failure marks the attempt failed; the export can be retried and only one attempt can complete.
 */

export const BUCKET = "report-exports";
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface ExportRecord {
  id: string;
  family: Family;
  branches: string[];
  period: Period;
  period_label: string;
  locale: "ar" | "en";
  include_drafts: boolean;
  requester: string;
  requested_at: string;
  requested_local: string | null;
  status: "pending" | "running" | "failed" | "complete";
  attempt: number;
  snapshot_at: string | null;
  snapshot_local: string | null;
  template_version: string | null;
  calc_version: string | null;
  sources: Record<string, unknown> | null;
  data_sha256: string | null;
  file_path: string | null;
  file_name: string | null;
  file_sha256: string | null;
  file_bytes: number | null;
  completed_at: string | null;
  completed_local: string | null;
  last_error: string | null;
  mine: boolean;
  allowed?: boolean;
  replayed?: boolean;
  claim?: "claimed" | "busy" | "complete";
  upload_path?: string;
  events?: Array<{ attempt: number; event: string; at: string; actor: string; detail: Record<string, unknown> }>;
}

export interface DbError {
  code?: string;
  message?: string;
}

export function mapExportError(error: DbError | null | undefined): string {
  switch (error?.code) {
    case "42501": return "forbidden";
    case "22023": return "export_invalid";
    case "23505": return "export_request_reused";
    case "P0002": return "export_not_found";
    case "40001": return "export_busy";
    default: return "export_failed";
  }
}

export async function requestExport(input: {
  family: Family; branches: string[]; period: Period; locale: "ar" | "en"; includeDrafts: boolean; request: string;
}): Promise<{ data: ExportRecord | null; error: DbError | null }> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_report_export_request", {
    p_family: input.family, p_branches: input.branches, p_period: input.period, p_locale: input.locale,
    p_include_drafts: input.includeDrafts, p_request: input.request,
  });
  return { data: (data as ExportRecord | null) ?? null, error };
}

export async function readExports(limit = 50): Promise<ExportRecord[]> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_report_exports", { p_limit: limit });
  if (error) throw new Error(`Exports could not be read (${error.code ?? "unknown"}).`);
  return (data as ExportRecord[]) ?? [];
}

export async function readExport(id: string): Promise<ExportRecord | null> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_report_export", { p_export: id });
  if (error) throw new Error(`Export could not be read (${error.code ?? "unknown"}).`);
  return (data as ExportRecord | null) ?? null;
}

function failureCode(error: unknown): string {
  if (error instanceof ExportDataError) return error.code;
  if (error instanceof ExportStepError) return error.code;
  const message = error instanceof Error ? error.message : "";
  if (/\(42501\)|permission/i.test(message)) return "forbidden";
  return "build_failed";
}

class ExportStepError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Builds and stores one attempt. Returns the export's state afterwards. */
export async function runExport(id: string): Promise<{ status: ExportRecord["status"] | "busy"; code?: string }> {
  const db = await createUserClient();
  const claimed = await db.rpc("app_report_export_claim", { p_export: id });
  if (claimed.error) return { status: "failed", code: mapExportError(claimed.error) };
  const record = claimed.data as ExportRecord;
  if (record.claim === "complete") return { status: "complete" };
  if (record.claim === "busy") return { status: "busy" };

  try {
    const names = await readBranchNames();
    const branchNames = record.branches.map((code) => {
      const b = names.find((n) => n.code === code);
      return { code, nameAr: b?.nameAr ?? code, nameEn: b?.nameEn ?? code };
    });
    const loaded = await loadReport({ family: record.family, branches: record.branches, period: record.period,
      includeDrafts: record.include_drafts, snapshotAt: record.snapshot_at!, branchNames });
    const fingerprint = dataFingerprint(loaded.model);
    const templateVersion = TEMPLATE_VERSIONS[record.family];
    const about = buildAbout(loaded.model, {
      exportId: record.id, branches: branchNames, period: record.period_label, requester: record.requester,
      requestedLocal: record.requested_local, snapshotLocal: record.snapshot_local, templateVersion, calcVersion: CALC_RULES_VERSION,
      fingerprint, sources: loaded.aboutSources,
    });
    const title = `${label(`family.${record.family}`, record.locale)} — ${cellText({ t: "name", ar: branchNames.map((b) => b.nameAr).join("، "),
      en: branchNames.map((b) => b.nameEn).join(", ") }, record.locale)} — ${record.period_label}`;
    const bytes = await renderWorkbook(loaded.model, about, { locale: record.locale, title, created: new Date(record.snapshot_at!), exportId: record.id });
    const scan = await scanWorkbook(bytes, record.locale);
    if (!scan.ok) throw new ExportStepError("scan_failed");

    const fileName = exportFileName(record.family, record.branches, record.period, record.locale, record.include_drafts);
    const upload = await db.storage.from(BUCKET).upload(record.upload_path!, bytes, { contentType: XLSX_TYPE, upsert: false, cacheControl: "no-store" });
    if (upload.error) throw new ExportStepError("storage_failed");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const done = await db.rpc("app_report_export_complete", {
      p_export: id, p_attempt: record.attempt, p_file_name: fileName, p_file_sha256: sha, p_file_bytes: bytes.length,
      p_template_version: templateVersion, p_calc_version: CALC_RULES_VERSION,
      p_sources: { ...loaded.sources, field_map: FIELD_MAP_FINDINGS_VERSION, scan: { sheets: scan.sheets, cells: scan.cells } },
      p_data_sha256: fingerprint,
    });
    if (done.error) throw new ExportStepError(done.error.code === "42501" ? "forbidden" : "complete_failed");
    return { status: "complete" };
  } catch (error) {
    const code = failureCode(error);
    await db.rpc("app_report_export_fail", { p_export: id, p_attempt: record.attempt, p_error: code });
    return { status: "failed", code };
  }
}

/** Authorizes and records one download, then reads the stored file as the requester (Storage checks again). */
export async function downloadExport(id: string): Promise<{ record: ExportRecord; bytes: Buffer } | { error: string }> {
  const db = await createUserClient();
  const allowed = await db.rpc("app_report_export_download", { p_export: id });
  if (allowed.error) return { error: mapExportError(allowed.error) };
  if ((allowed.data as { refused?: boolean } | null)?.refused) return { error: "forbidden" };
  const record = allowed.data as ExportRecord;
  const file = await db.storage.from(BUCKET).download(record.file_path!);
  if (file.error || !file.data) return { error: "export_not_found" };
  const bytes = Buffer.from(await file.data.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== record.file_sha256) return { error: "export_integrity" };
  return { record, bytes };
}
