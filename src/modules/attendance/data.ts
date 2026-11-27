import "server-only";
import { createUserClient } from "@/lib/supabase/server";
import { parseEvents, type AttendanceEvent } from "./hours";

/**
 * Attendance readers. Every call runs as the signed-in person, and every database function checks the
 * attendance permission for the branch itself, so a page that forgot a check would still get nothing.
 */

export interface AttendanceEmployee {
  id: string;
  name: string;
  code: string;
  employeeActive: boolean;
  attendanceActive: boolean;
  deactivatedLocal: string | null;
  deactivationReason: string | null;
  hasStaffAccount: boolean;
  enrolled: boolean;
  enrolledLocal: string | null;
  lastEvent: { kind: "check_in" | "check_out"; local: string } | null;
}

export interface AttemptRow {
  id: string;
  employeeId: string | null;
  enteredCode: string;
  action: "check_in" | "check_out";
  status: string;
  reason: string | null;
  local: string;
  device: string | null;
  matchScore: number | null;
  livenessScore: number | null;
}

export interface AttendanceReport {
  branch: { code: string; nameEn: string; nameAr: string; timezone: string };
  from: string;
  to: string;
  generatedLocal: string;
  employees: Array<{ id: string; name: string; code: string; active: boolean }>;
  events: AttendanceEvent[];
  attempts: AttemptRow[];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export async function readReport(branch: string, from: string, to: string, purpose: "view" | "export", locale?: string): Promise<AttendanceReport> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_attendance_report", {
    p_branch_code: branch, p_from: from, p_to: to, p_purpose: purpose, p_locale: locale ?? null,
  });
  if (error || !data) throw new Error(`attendance report unavailable (${error?.code ?? "empty"})`);
  const raw = data as Record<string, unknown>;
  const b = raw.branch as Record<string, unknown>;
  return {
    branch: { code: String(b.code), nameEn: String(b.name_en), nameAr: String(b.name_ar), timezone: String(b.timezone) },
    from: String(raw.from),
    to: String(raw.to),
    generatedLocal: String(raw.generated_local),
    employees: (raw.employees as Array<Record<string, unknown>>).map((e) => ({
      id: String(e.id), name: String(e.name), code: String(e.code ?? ""), active: e.active === true,
    })),
    events: parseEvents(raw.events),
    attempts: (raw.attempts as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.id),
      employeeId: str(a.employee_id),
      enteredCode: String(a.entered_code),
      action: a.action === "check_out" ? "check_out" : "check_in",
      status: String(a.status),
      reason: str(a.reason),
      local: String(a.local),
      device: str(a.device),
      matchScore: num(a.match_score),
      livenessScore: num(a.liveness_score),
    })),
  };
}

function mapEmployee(e: Record<string, unknown>): AttendanceEmployee {
  const last = e.last_event as Record<string, unknown> | null;
  return {
    id: String(e.id),
    name: String(e.name),
    code: String(e.code ?? ""),
    employeeActive: e.employee_active === true,
    attendanceActive: e.attendance_active === true,
    deactivatedLocal: str(e.deactivated_local),
    deactivationReason: str(e.deactivation_reason),
    hasStaffAccount: e.has_staff_account === true,
    enrolled: e.enrolled === true,
    enrolledLocal: str(e.enrolled_local),
    lastEvent: last ? { kind: last.kind === "check_out" ? "check_out" : "check_in", local: String(last.local) } : null,
  };
}

export async function listEmployees(branch: string): Promise<AttendanceEmployee[]> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_attendance_employees", { p_branch_code: branch });
  if (error || !Array.isArray(data)) throw new Error(`attendance employees unavailable (${error?.code ?? "empty"})`);
  return (data as Array<Record<string, unknown>>).map(mapEmployee);
}

export async function listUnregistered(branch: string): Promise<Array<{ id: string; name: string; code: string | null }>> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_attendance_unregistered", { p_branch_code: branch });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((e) => ({ id: String(e.id), name: String(e.name), code: str(e.code) }));
}

export interface ReferenceRow {
  id: string;
  status: "active" | "replaced" | "deleted";
  engine: string;
  identityDocument: string;
  enrolledLocal: string;
  enrolledBy: string | null;
  endedLocal: string | null;
  endReason: string | null;
}

export interface EmployeeDetail extends AttendanceEmployee {
  branchCode: string;
  registeredLocal: string;
  references: ReferenceRow[];
  enrollmentsFailed: number;
}

export async function readEmployee(id: string): Promise<EmployeeDetail | null> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_attendance_employee_detail", { p_employee: id });
  if (error || !data) return null;
  const raw = data as Record<string, unknown>;
  return {
    ...mapEmployee({ ...raw, enrolled: (raw.references as Array<Record<string, unknown>>).some((r) => r.status === "active") }),
    enrolledLocal: str((raw.references as Array<Record<string, unknown>>).find((r) => r.status === "active")?.enrolled_local),
    branchCode: String(raw.branch_code),
    registeredLocal: String(raw.registered_local),
    enrollmentsFailed: Number(raw.enrollments_failed ?? 0),
    references: (raw.references as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      status: r.status as ReferenceRow["status"],
      engine: String(r.engine),
      identityDocument: String(r.identity_document),
      enrolledLocal: String(r.enrolled_local),
      enrolledBy: str(r.enrolled_by),
      endedLocal: str(r.ended_local),
      endReason: str(r.end_reason),
    })),
  };
}

export interface DeviceRow {
  id: string;
  label: string;
  active: boolean;
  accountEmail: string;
  accountActive: boolean;
  problem: string | null;
  deactivatedLocal: string | null;
  deactivationReason: string | null;
  registeredLocal: string;
  lastAttemptLocal: string | null;
}

export async function listDevices(branch: string): Promise<DeviceRow[]> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_attendance_devices", { p_branch_code: branch });
  if (error || !Array.isArray(data)) throw new Error(`attendance devices unavailable (${error?.code ?? "empty"})`);
  return (data as Array<Record<string, unknown>>).map((d) => ({
    id: String(d.id),
    label: String(d.label),
    active: d.active === true,
    accountEmail: String(d.account_email),
    accountActive: d.account_active === true,
    problem: str(d.problem),
    deactivatedLocal: str(d.deactivated_local),
    deactivationReason: str(d.deactivation_reason),
    registeredLocal: String(d.registered_local),
    lastAttemptLocal: str(d.last_attempt_local),
  }));
}

export async function listDeviceCandidates(branch: string): Promise<Array<{ userId: string; fullName: string; email: string }>> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_attendance_device_candidates", { p_branch_code: branch });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((c) => ({ userId: String(c.user_id), fullName: String(c.full_name), email: String(c.email) }));
}

export interface KioskContext {
  state: string;
  deviceId?: string;
  label?: string;
  branchCode?: string;
  branchNameEn?: string;
  branchNameAr?: string;
}

export async function readKioskContext(): Promise<KioskContext> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_attendance_kiosk_context");
  if (error || !data) return { state: "unavailable" };
  const raw = data as Record<string, unknown>;
  return {
    state: String(raw.state),
    deviceId: str(raw.device_id) ?? undefined,
    label: str(raw.label) ?? undefined,
    branchCode: str(raw.branch_code) ?? undefined,
    branchNameEn: str(raw.branch_name_en) ?? undefined,
    branchNameAr: str(raw.branch_name_ar) ?? undefined,
  };
}
