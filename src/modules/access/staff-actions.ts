"use server";

import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";
import { requireAccess } from "./guard";
import {
  checkNewPassword,
  localeField,
  looksLikeEmail,
  mapCommandError,
  parseAccessForm,
  secretField,
  textField,
  type BranchRef,
  type ErrorCode,
} from "./forms";

/**
 * Staff management for System Admins (Abdo). Each action
 *   1. authorizes the caller (`admin.users.manage`) against the live database,
 *   2. changes Supabase Auth through the service-role client only AFTER that check
 *      (creating the sign-in account, setting a temporary password, banning or unbanning),
 *   3. records the change through a database command that checks the permission again and writes
 *      the audit history in the same transaction.
 * Passwords go only to Supabase Auth. They are never stored by this application, put in the audit
 * history, logged or sent back to the browser.
 */

const REQUIRE = { permission: "admin.users.manage" } as const;
/** Auth "ban" length used for a disabled account (100 years). Removed on reactivation. */
const BANNED = "876000h";

function to(path: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `${path}?${query}`;
}

async function loadBranches(): Promise<BranchRef[]> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.from("branches").select("id, code");
  if (error || !data) throw new Error("Branches could not be read");
  return data as BranchRef[];
}

function isAuthEmailTaken(error: { status?: number; code?: string; message?: string }): boolean {
  return error.code === "email_exists" || error.code === "user_already_exists" || /already (been )?registered|already exists/i.test(error.message ?? "");
}

export async function createStaffAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const list = `/${locale}/admin/staff`;
  const form = `${list}/new`;
  await requireAccess({ locale, path: form, require: REQUIRE });

  const fullName = textField(data, "full_name");
  const email = textField(data, "email").toLowerCase();
  const employeeNumber = textField(data, "employee_number");
  const password = secretField(data, "password");

  if (!fullName || !looksLikeEmail(email)) redirect(to(form, { error: "invalid_input" }));
  const problem = checkNewPassword(password);
  if (problem) redirect(to(form, { error: "weak_password" }));

  const access = parseAccessForm(data, await loadBranches());

  const admin = getSupabaseAdmin();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    const error = created.error;
    redirect(to(form, { error: error && isAuthEmailTaken(error) ? "email_in_use" : error?.code === "weak_password" ? "weak_password" : "unexpected" }));
  }
  const userId = created.data.user.id;

  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_create_staff", {
    p_user_id: userId,
    p_full_name: fullName,
    p_email: email,
    p_employee_number: employeeNumber || null,
    p_access: access,
  });
  if (error) {
    // The sign-in account has no staff record, so it grants nothing; remove it so the email is free again.
    await admin.auth.admin.deleteUser(userId);
    redirect(to(form, { error: mapCommandError(error) }));
  }
  redirect(to(`${list}/${userId}`, { notice: "created" }));
}

export async function updateStaffAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const staffId = textField(data, "staff_id");
  const page = `/${locale}/admin/staff/${staffId}`;
  await requireAccess({ locale, path: page, require: REQUIRE });

  const fullName = textField(data, "full_name");
  const email = textField(data, "email").toLowerCase();
  const employeeNumber = textField(data, "employee_number");
  if (!fullName || !looksLikeEmail(email)) redirect(to(page, { error: "invalid_input" }));

  const supabase = await createUserClient();
  const { data: current, error: readError } = await supabase.from("staff_accounts").select("email").eq("user_id", staffId).maybeSingle();
  if (readError || !current) redirect(to(page, { error: "not_found" }));
  const previousEmail = (current as { email: string }).email;

  const admin = getSupabaseAdmin();
  const emailChanged = previousEmail !== email;
  if (emailChanged) {
    // Check our own records first: the Auth service answers a duplicate with a bare server error.
    const { data: taken } = await supabase.from("staff_accounts").select("user_id").eq("email", email).neq("user_id", staffId).limit(1);
    if (taken && taken.length > 0) redirect(to(page, { error: "email_in_use" }));
    const changed = await admin.auth.admin.updateUserById(staffId, { email, email_confirm: true });
    if (changed.error) {
      // With no staff record behind the address, a duplicate Auth account is the remaining cause of "Error updating user".
      const duplicate = isAuthEmailTaken(changed.error) || changed.error.message === "Error updating user";
      redirect(to(page, { error: duplicate ? "email_in_use" : "unexpected" }));
    }
  }
  const { error } = await supabase.rpc("admin_update_staff", {
    p_staff_id: staffId,
    p_full_name: fullName,
    p_email: email,
    p_employee_number: employeeNumber || null,
  });
  if (error) {
    if (emailChanged) await admin.auth.admin.updateUserById(staffId, { email: previousEmail, email_confirm: true });
    redirect(to(page, { error: mapCommandError(error) }));
  }
  redirect(to(page, { notice: "updated" }));
}

export async function setStaffAccessAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const staffId = textField(data, "staff_id");
  const page = `/${locale}/admin/staff/${staffId}`;
  await requireAccess({ locale, path: page, require: REQUIRE });

  const access = parseAccessForm(data, await loadBranches());
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_set_staff_access", { p_staff_id: staffId, p_access: access });
  if (error) redirect(to(page, { error: mapCommandError(error) }));
  redirect(to(page, { notice: "access_saved" }));
}

export async function setStaffActiveAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const staffId = textField(data, "staff_id");
  const active = textField(data, "active") === "1";
  const page = `/${locale}/admin/staff/${staffId}`;
  await requireAccess({ locale, path: page, require: REQUIRE });

  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_set_staff_active", {
    p_staff_id: staffId,
    p_active: active,
    p_reason: textField(data, "reason") || null,
  });
  if (error) redirect(to(page, { error: mapCommandError(error) }));

  // Auth side: a disabled person cannot start or refresh a session. (The database checks already
  // refuse every request from a session that is still open.) Applied even when the database state
  // did not change, so a failed earlier attempt can be repeated.
  const admin = getSupabaseAdmin();
  const result = await admin.auth.admin.updateUserById(staffId, { ban_duration: active ? "none" : BANNED });
  if (result.error) redirect(to(page, { notice: active ? "reactivated" : "disabled", warning: "auth_not_updated" }));
  redirect(to(page, { notice: active ? "reactivated" : "disabled" }));
}

export async function resetStaffPasswordAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const staffId = textField(data, "staff_id");
  const page = `/${locale}/admin/staff/${staffId}`;
  await requireAccess({ locale, path: page, require: REQUIRE });

  const password = secretField(data, "password");
  if (checkNewPassword(password)) redirect(to(page, { error: "weak_password" }));

  // Confirm the person belongs to this organization before touching their credentials.
  const supabase = await createUserClient();
  const { data: row } = await supabase.from("staff_accounts").select("user_id").eq("user_id", staffId).maybeSingle();
  if (!row) redirect(to(page, { error: "not_found" }));

  const admin = getSupabaseAdmin();
  const updated = await admin.auth.admin.updateUserById(staffId, { password });
  if (updated.error) redirect(to(page, { error: updated.error.code === "weak_password" ? "weak_password" : "unexpected" }));
  const { error } = await supabase.rpc("admin_record_password_reset", { p_staff_id: staffId });
  if (error) redirect(to(page, { error: mapCommandError(error) as ErrorCode }));
  redirect(to(page, { notice: "password_reset" }));
}
