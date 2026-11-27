"use server";

import { redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { localeField, textField } from "@/modules/access/forms";
import { requireAccess } from "@/modules/access/guard";
import { attendanceErrorCode, isUuid, parseCorrection } from "./forms";

/**
 * Attendance administration. Every action checks its own permission first (the shared guard, then the
 * database command again), and every database command writes the audit history in the same
 * transaction. Request identifiers are written into the form when the page renders, so a resubmitted
 * form is the same change.
 */

function back(locale: string, path: string, query: string): never {
  redirect(`/${locale}${path}${path.includes("?") ? "&" : "?"}${query}`);
}

export async function createEmployeeAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const path = "/attendance/employees";
  await requireAccess({ locale, path: `/${locale}${path}`, require: { permission: "attendance.employees.manage", branch: OPERATING_BRANCH_CODE } });
  const request = textField(data, "request");
  if (!isUuid(request)) back(locale, path, "error=attendance_invalid_name");
  const db = await createUserClient();
  const { data: row, error } = await db.rpc("app_attendance_employee_create", {
    p_branch_code: OPERATING_BRANCH_CODE, p_full_name: textField(data, "full_name"), p_request: request,
  });
  if (error || !row) back(locale, path, `error=${attendanceErrorCode(error?.message)}`);
  // Straight on to face enrollment, with the new number shown large, while the employee is present.
  redirect(`/${locale}/attendance/employees/${(row as { employee_id: string }).employee_id}/enroll`);
}

export async function registerEmployeeAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const path = "/attendance/employees";
  await requireAccess({ locale, path: `/${locale}${path}`, require: { permission: "attendance.employees.manage", branch: OPERATING_BRANCH_CODE } });
  const request = textField(data, "request");
  const employee = textField(data, "employee");
  if (!isUuid(request) || !isUuid(employee)) back(locale, path, "error=attendance_not_found");
  const db = await createUserClient();
  const { data: row, error } = await db.rpc("app_attendance_employee_register", {
    p_employee: employee, p_branch_code: OPERATING_BRANCH_CODE, p_request: request,
  });
  if (error || !row) back(locale, path, `error=${attendanceErrorCode(error?.message)}`);
  redirect(`/${locale}/attendance/employees/${(row as { employee_id: string }).employee_id}/enroll`);
}

export async function renameEmployeeAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const employee = textField(data, "employee");
  const path = `/attendance/employees/${isUuid(employee) ? employee : ""}`;
  await requireAccess({ locale, path: `/${locale}${path}`, require: { permission: "attendance.employees.manage", branch: OPERATING_BRANCH_CODE } });
  if (!isUuid(employee)) back(locale, "/attendance/employees", "error=attendance_not_found");
  const db = await createUserClient();
  const { error } = await db.rpc("app_attendance_employee_rename", { p_employee: employee, p_full_name: textField(data, "full_name") });
  back(locale, path, error ? `error=${attendanceErrorCode(error.message)}` : "notice=attendance_saved");
}

export async function setEmployeeActiveAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const employee = textField(data, "employee");
  const path = `/attendance/employees/${isUuid(employee) ? employee : ""}`;
  await requireAccess({ locale, path: `/${locale}${path}`, require: { permission: "attendance.employees.manage", branch: OPERATING_BRANCH_CODE } });
  if (!isUuid(employee)) back(locale, "/attendance/employees", "error=attendance_not_found");
  const active = textField(data, "active") === "true";
  const db = await createUserClient();
  const { error } = await db.rpc("app_attendance_employee_set_active", {
    p_employee: employee, p_active: active, p_reason: active ? null : textField(data, "reason"),
  });
  back(locale, path, error ? `error=${attendanceErrorCode(error.message)}` : `notice=${active ? "attendance_activated" : "attendance_deactivated"}`);
}

export async function deleteReferenceAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const employee = textField(data, "employee");
  const path = `/attendance/employees/${isUuid(employee) ? employee : ""}`;
  await requireAccess({ locale, path: `/${locale}${path}`, require: { permission: "attendance.enroll", branch: OPERATING_BRANCH_CODE } });
  if (!isUuid(employee)) back(locale, "/attendance/employees", "error=attendance_not_found");
  const db = await createUserClient();
  const { error } = await db.rpc("app_attendance_reference_delete", { p_employee: employee, p_reason: textField(data, "reason") });
  back(locale, path, error ? `error=${attendanceErrorCode(error.message)}` : "notice=attendance_reference_deleted");
}

export async function registerDeviceAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const path = "/attendance/devices";
  await requireAccess({ locale, path: `/${locale}${path}`, require: { permission: "attendance.devices.manage", branch: OPERATING_BRANCH_CODE } });
  const account = textField(data, "account");
  if (!isUuid(account)) back(locale, path, "error=attendance_device_not_eligible");
  const db = await createUserClient();
  const { error } = await db.rpc("app_attendance_device_register", {
    p_branch_code: OPERATING_BRANCH_CODE, p_user: account, p_label: textField(data, "label"),
  });
  back(locale, path, error ? `error=${attendanceErrorCode(error.message)}` : "notice=attendance_device_registered");
}

export async function setDeviceActiveAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const path = "/attendance/devices";
  await requireAccess({ locale, path: `/${locale}${path}`, require: { permission: "attendance.devices.manage", branch: OPERATING_BRANCH_CODE } });
  const device = textField(data, "device");
  if (!isUuid(device)) back(locale, path, "error=attendance_not_found");
  const active = textField(data, "active") === "true";
  const db = await createUserClient();
  const { error } = await db.rpc("app_attendance_device_set_active", {
    p_device: device, p_active: active, p_reason: active ? null : textField(data, "reason"),
  });
  back(locale, path, error ? `error=${attendanceErrorCode(error.message)}` : `notice=${active ? "attendance_activated" : "attendance_deactivated"}`);
}

export async function correctEventAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const employee = textField(data, "employee");
  const returnTo = textField(data, "return_to");
  const path = /^\/attendance(\/employees\/[0-9a-f-]{36})?(\?[a-z0-9=&_-]*)?$/.test(returnTo) ? returnTo : "/attendance";
  await requireAccess({ locale, path: `/${locale}${path}`, require: { permission: "attendance.correct", branch: OPERATING_BRANCH_CODE } });
  const request = textField(data, "request");
  const parsed = parseCorrection({
    kind: textField(data, "kind"), employee, target: textField(data, "target"), eventKind: textField(data, "event_kind"),
    local: textField(data, "local"), reason: textField(data, "reason"),
  });
  if (!isUuid(request)) back(locale, path, "error=attendance_invalid_correction");
  if (!parsed.ok) back(locale, path, `error=attendance_${parsed.problem === "invalid_correction" ? "invalid_correction" : parsed.problem}`);
  const c = parsed.value;
  const db = await createUserClient();
  const { error } = await db.rpc("app_attendance_correct", {
    p_request: request, p_kind: c.kind, p_employee: c.employee, p_target_event: c.target, p_event_kind: c.eventKind,
    p_occurred_local: c.local, p_reason: c.reason,
  });
  back(locale, path, error ? `error=${attendanceErrorCode(error.message)}` : "notice=attendance_corrected");
}
