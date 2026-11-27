import { isBusinessDate, type BusinessDate } from "@/lib/dates";

/**
 * Plain helpers for the attendance forms and routes. No server-only imports, so they are unit-tested
 * directly (tests/attendance-forms.test.ts). The database validates everything again.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export const EVENT_KINDS = ["check_in", "check_out"] as const;
export type AttendanceAction = (typeof EVENT_KINDS)[number];

export function isAction(value: unknown): value is AttendanceAction {
  return value === "check_in" || value === "check_out";
}

export const CORRECTION_KINDS = ["add", "void", "retime"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const IDENTITY_DOCUMENTS = ["national_id", "passport", "residence_permit", "other"] as const;
export type IdentityDocument = (typeof IDENTITY_DOCUMENTS)[number];

export function isIdentityDocument(value: unknown): value is IdentityDocument {
  return typeof value === "string" && (IDENTITY_DOCUMENTS as readonly string[]).includes(value);
}

/** Employee ID typed at the kiosk: 1-40 visible characters. */
export function normaliseEmployeeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim();
  return code.length >= 1 && code.length <= 40 && !/[\u0000-\u001f]/.test(code) ? code : null;
}

export const MAX_PERIOD_DAYS = 366;

export interface Period {
  from: BusinessDate;
  to: BusinessDate;
}

/** A reporting period from the query string; defaults to the month of `today` up to today. */
export function parsePeriod(from: string | undefined, to: string | undefined, today: BusinessDate): Period | null {
  const start = from ?? `${today.slice(0, 7)}-01`;
  const end = to ?? today;
  if (!isBusinessDate(start) || !isBusinessDate(end) || end < start) return null;
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  return days <= MAX_PERIOD_DAYS ? { from: start, to: end } : null;
}

/** Branch-local wall-clock time typed in a correction form ("YYYY-MM-DDTHH:MM"). */
export function parseLocalDateTime(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m || !isBusinessDate(m[1])) return null;
  const [h, min, s] = [Number(m[2]), Number(m[3]), Number(m[4] ?? "0")];
  if (h > 23 || min > 59 || s > 59) return null;
  return `${m[1]} ${m[2]}:${m[3]}:${String(s).padStart(2, "0")}`;
}

export interface CorrectionInput {
  kind: CorrectionKind;
  employee: string | null;
  target: string | null;
  eventKind: AttendanceAction | null;
  local: string | null;
  reason: string;
}

export type CorrectionProblem = "invalid_correction" | "reason_required" | "time_required";

export function parseCorrection(fields: {
  kind: string;
  employee: string;
  target: string;
  eventKind: string;
  local: string;
  reason: string;
}): { ok: true; value: CorrectionInput } | { ok: false; problem: CorrectionProblem } {
  const kind = fields.kind as CorrectionKind;
  if (!(CORRECTION_KINDS as readonly string[]).includes(kind)) return { ok: false, problem: "invalid_correction" };
  const reason = fields.reason.trim();
  if (reason.length < 3 || reason.length > 500) return { ok: false, problem: "reason_required" };
  const target = isUuid(fields.target) ? fields.target.toLowerCase() : null;
  const employee = isUuid(fields.employee) ? fields.employee.toLowerCase() : null;
  if (kind === "add") {
    if (!employee || !isAction(fields.eventKind)) return { ok: false, problem: "invalid_correction" };
    const local = parseLocalDateTime(fields.local);
    if (!local) return { ok: false, problem: "time_required" };
    return { ok: true, value: { kind, employee, target: null, eventKind: fields.eventKind, local, reason } };
  }
  if (!target) return { ok: false, problem: "invalid_correction" };
  if (kind === "retime") {
    const local = parseLocalDateTime(fields.local);
    if (!local) return { ok: false, problem: "time_required" };
    return { ok: true, value: { kind, employee, target, eventKind: null, local, reason } };
  }
  return { ok: true, value: { kind, employee, target, eventKind: null, local: null, reason } };
}

/** Kiosk failure codes the browser may report before the verifier decides (mirrors app_attendance_attempt_fail). */
export const CLIENT_FAILURES = [
  "camera_unavailable",
  "camera_permission_denied",
  "camera_stopped",
  "connection_lost",
  "cancelled",
  "timeout",
] as const;
export type ClientFailure = (typeof CLIENT_FAILURES)[number];

export function isClientFailure(value: unknown): value is ClientFailure {
  return typeof value === "string" && (CLIENT_FAILURES as readonly string[]).includes(value);
}

/** Every reason code the kiosk can show; anything else is shown as the generic failure. */
export const KIOSK_REASONS = [
  "unknown_employee", "employee_inactive", "not_enrolled", "too_many_failures", "already_checked_in", "not_checked_in",
  "face_mismatch", "liveness_failed", "challenge_failed", "no_face", "multiple_faces", "face_inconsistent", "poor_quality",
  "upload_invalid", "reference_unavailable", "invalid_verifier_signature", "expired", "state_changed", "device_inactive",
  "camera_unavailable", "camera_permission_denied", "camera_stopped", "connection_lost", "verifier_unavailable",
  "models_unavailable", "cancelled", "timeout", "new_attempt", "reference_replaced", "reference_deleted",
] as const;
export type KioskReason = (typeof KIOSK_REASONS)[number];

/** Advice codes the verifier may attach to a failure (mirrors app_private.attendance_attempt_view). */
export const KIOSK_HINTS = ["turn_more", "follow_arrows", "come_closer", "more_light", "one_person"] as const;

export function kioskReason(value: unknown): KioskReason | "failed" {
  return typeof value === "string" && (KIOSK_REASONS as readonly string[]).includes(value) ? (value as KioskReason) : "failed";
}

/** Database error messages that map to a page error code. */
export const ATTENDANCE_ERRORS: Record<string, string> = {
  permission_denied: "forbidden",
  invalid_name: "attendance_invalid_name",
  already_registered: "attendance_already_registered",
  employee_not_found: "attendance_not_found",
  employee_inactive: "attendance_employee_inactive",
  staff_name_managed_elsewhere: "attendance_staff_name",
  reason_required: "attendance_reason_required",
  device_account_not_eligible: "attendance_device_not_eligible",
  invalid_label: "attendance_invalid_label",
  device_not_found: "attendance_not_found",
  event_not_found: "attendance_not_found",
  event_already_corrected: "attendance_already_corrected",
  time_in_future: "attendance_time_in_future",
  invalid_correction: "attendance_invalid_correction",
  identity_document_required: "attendance_identity_required",
  consent_required: "attendance_consent_required",
  device_account: "attendance_device_not_eligible",
  employee_number_locked: "attendance_number_locked",
  employee_ids_exhausted: "attendance_ids_exhausted",
};

export function attendanceErrorCode(message: string | undefined | null): string {
  if (!message) return "unexpected";
  return ATTENDANCE_ERRORS[message] ?? "unexpected";
}
