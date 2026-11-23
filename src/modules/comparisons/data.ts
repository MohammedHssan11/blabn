import "server-only";
import { createUserClient } from "@/lib/supabase/server";
import type { BusinessDate } from "@/lib/dates";
import { figureKey, type BranchInfo, type ComparisonData, type Figure, type Metric, type Origin } from "./calc";

/**
 * Phase 7 reads and writes. Everything runs as the signed-in person: PostgreSQL checks
 * comparison.view / comparison.export / comparison.enter for every branch again, applies the
 * organization filter, the first live business date and the closed-day precedence, and writes
 * each entry as a revision with its audit row in one transaction.
 */

interface ReportBranch {
  code: string;
  nameEn: string;
  nameAr: string;
  operatesInApp: boolean;
  liveFrom: string | null;
  liveFromBasis: "configured" | "first_close" | null;
  liveSource: string | null;
  liveSourceEn: string | null;
  liveSourceAr: string | null;
  entryOwner: string | null;
  today: string | null;
}

interface ReportFigure {
  branch: string;
  date: string;
  metric: Metric;
  value: number | string;
  origin: Origin;
  source: string;
  sourceEn: string | null;
  sourceAr: string | null;
  purpose: "live" | "historical";
  record: string;
  revision: number;
  reference: string | null;
  actor: string | null;
  recordedAt: string | null;
}

export class ComparisonAccessDenied extends Error {}

/** Figures of the given branches and dates. `access` names the permission the caller uses. */
export async function readComparisonData(
  access: "view" | "export",
  branches: readonly string[],
  dates: readonly BusinessDate[],
): Promise<ComparisonData> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_comparison_report", { p_access: access, p_branches: branches, p_dates: dates });
  if (error) {
    if (error.code === "42501") throw new ComparisonAccessDenied(error.message);
    throw new Error(`comparison report failed: ${error.code} ${error.message}`);
  }
  const report = data as { branches: ReportBranch[]; figures: ReportFigure[] };
  const figures = new Map<string, Figure>();
  for (const f of report.figures) {
    const value = Number(f.value);
    if (!Number.isSafeInteger(value)) throw new Error("comparison figure out of range");
    figures.set(figureKey(f.branch, f.date, f.metric), {
      value,
      origin: f.origin,
      source: f.source,
      sourceLabelEn: f.sourceEn,
      sourceLabelAr: f.sourceAr,
      purpose: f.purpose,
      record: f.record,
      revision: f.revision,
      reference: f.reference ?? "",
      actor: f.actor ?? "",
      recordedAt: f.recordedAt,
    });
  }
  const info: BranchInfo[] = report.branches.map((b) => ({ ...b }));
  return { branches: info, figures };
}

export interface EntryBranch {
  code: string;
  nameEn: string;
  nameAr: string;
  liveFrom: string | null;
  liveSource: string | null;
  ownerSet: boolean;
  ownerIsMe: boolean;
  today: string;
}

export interface SourceOption {
  key: string;
  labelEn: string;
  labelAr: string;
  builtIn?: boolean;
}

export async function readEntryContext(): Promise<{ branches: EntryBranch[]; sources: SourceOption[] }> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_comparison_entry_context");
  if (error) throw new Error(`comparison entry context failed: ${error.code} ${error.message}`);
  return data as { branches: EntryBranch[]; sources: SourceOption[] };
}

export interface SettingsBranch {
  code: string;
  nameEn: string;
  nameAr: string;
  operatesInApp: boolean;
  liveSource: string | null;
  entryOwner: string | null;
  liveFrom: string | null;
  revision: number;
  firstClose: string | null;
  candidates: Array<{ id: string; name: string }>;
}

export async function readSettings(): Promise<{ branches: SettingsBranch[]; sources: SourceOption[] }> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_comparison_settings_view");
  if (error) {
    if (error.code === "42501") throw new ComparisonAccessDenied(error.message);
    throw new Error(`comparison settings failed: ${error.code} ${error.message}`);
  }
  return data as { branches: SettingsBranch[]; sources: SourceOption[] };
}

export interface HistoryRow {
  id: number;
  metric: Metric;
  source: string;
  purpose: "live" | "historical";
  revision: number;
  value: number | null;
  active: boolean;
  reference: string;
  reason: string | null;
  actor: string;
  enteredAt: string;
}

/** Every revision of a branch's entered figures for one date. Row-level security needs comparison.view. */
export async function readHistory(branch: string, date: BusinessDate): Promise<{ nameEn: string; nameAr: string; rows: HistoryRow[] }> {
  const db = await createUserClient();
  const { data: rows, error: branchError } = await db.from("branches").select("id, name_en, name_ar").eq("code", branch);
  if (branchError) throw new Error(`branch lookup failed: ${branchError.message}`);
  if (!rows || rows.length === 0) return { nameEn: branch, nameAr: branch, rows: [] };
  const { data, error } = await db
    .from("comparison_entries")
    .select("id, metric, source, purpose, revision, value, active, source_reference, reason, actor_name, entered_at")
    .eq("branch_id", rows[0]!.id)
    .eq("business_date", date)
    .order("metric")
    .order("source")
    .order("revision");
  if (error) throw new Error(`comparison history failed: ${error.message}`);
  return { nameEn: rows[0]!.name_en, nameAr: rows[0]!.name_ar, rows: (data ?? []).map((r) => ({
    id: Number(r.id),
    metric: r.metric as Metric,
    source: r.source,
    purpose: r.purpose,
    revision: r.revision,
    value: r.value === null ? null : Number(r.value),
    active: r.active,
    reference: r.source_reference,
    reason: r.reason,
    actor: r.actor_name,
    enteredAt: r.entered_at,
  })) };
}

export interface CommandError {
  code: string;
  message: string;
}

export async function saveComparison(branch: string, request: string, payload: Record<string, unknown>) {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_comparison_save", { p_branch: branch, p_request: request, p_payload: payload });
  return { data: data as { replayed: boolean; revisions: Array<{ metric: Metric; revision: number }> } | null, error: error as CommandError | null };
}

export async function saveSettings(branch: string, expected: number, liveSource: string | null, entryOwner: string | null, liveFrom: string | null) {
  const db = await createUserClient();
  const { error } = await db.rpc("app_comparison_settings_save", {
    p_branch: branch, p_expected: expected, p_live_source: liveSource, p_entry_owner: entryOwner, p_live_from: liveFrom,
  });
  return { error: error as CommandError | null };
}

export async function addSource(key: string, labelEn: string, labelAr: string) {
  const db = await createUserClient();
  const { error } = await db.rpc("app_comparison_add_source", { p_key: key, p_label_en: labelEn, p_label_ar: labelAr });
  return { error: error as CommandError | null };
}

/** Maps a database refusal to a message code the screens translate. */
export function mapComparisonError(error: CommandError | null): string {
  if (!error) return "unexpected";
  const message = error.message ?? "";
  if (error.code === "42501") return /entry owner/i.test(message) ? "comparison_not_owner" : "forbidden";
  if (error.code === "40001") return "comparison_stale";
  if (error.code === "23505") {
    if (/Request identifier/i.test(message)) return "comparison_request_reused";
    if (/comparison_sources_pkey|duplicate key/i.test(message)) return "comparison_source_exists";
    return "comparison_duplicate";
  }
  if (error.code === "22023") {
    if (/reason/i.test(message)) return "comparison_reason_required";
    if (/not started/i.test(message)) return "comparison_future";
    if (/historical figure needs|first live business date/i.test(message)) return "comparison_live_date";
    if (/Nothing to save/i.test(message)) return "comparison_nothing";
    if (/entry owner must/i.test(message)) return "comparison_owner_invalid";
    return "invalid_input";
  }
  return "unexpected";
}

/** Names of the branches the person can see (row-level security), for the selection form. */
export async function readBranchNames(): Promise<Array<{ code: string; nameEn: string; nameAr: string }>> {
  const db = await createUserClient();
  const { data, error } = await db.from("branches").select("code, name_en, name_ar");
  if (error) throw new Error(`branch names failed: ${error.message}`);
  return (data ?? []).map((b) => ({ code: b.code, nameEn: b.name_en, nameAr: b.name_ar }));
}
