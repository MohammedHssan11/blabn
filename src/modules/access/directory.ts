import "server-only";
import { createUserClient } from "@/lib/supabase/server";
import { isGroupKey, type GroupKey } from "./catalog";

/**
 * Reads of staff, branches and the audit history for the administrator screens. They run as the
 * signed-in person, so row-level security decides what comes back: an administrator reads the
 * whole organization, anybody else would get nothing (the pages also authorize before calling).
 */

export interface BranchInfo {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  operatesInApp: boolean;
}

export interface StaffRow {
  userId: string;
  fullName: string;
  email: string;
  employeeNumber: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  /** Branch codes the person belongs to. */
  branches: string[];
  /** Group assignments; `branch` is null for an organization group. */
  groups: Array<{ group: GroupKey; branch: string | null }>;
}

export interface AuditRow {
  id: number;
  occurredAt: string;
  actorName: string;
  category: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  branch: string | null;
  changes: unknown;
}

async function client() {
  return createUserClient();
}

export async function listBranches(): Promise<BranchInfo[]> {
  const supabase = await client();
  const { data, error } = await supabase.from("branches").select("id, code, name_en, name_ar, operates_in_app").order("code");
  if (error || !data) throw new Error("Branches could not be read");
  const rows = data as Array<{ id: string; code: string; name_en: string; name_ar: string; operates_in_app: boolean }>;
  // Operating branch first, as in the rest of the application.
  return rows
    .map((row) => ({ id: row.id, code: row.code, nameEn: row.name_en, nameAr: row.name_ar, operatesInApp: row.operates_in_app }))
    .sort((a, b) => Number(b.operatesInApp) - Number(a.operatesInApp) || a.code.localeCompare(b.code));
}

export async function listStaff(): Promise<StaffRow[]> {
  const supabase = await client();
  const [accounts, employees, memberships, assignments, branches] = await Promise.all([
    supabase.from("staff_accounts").select("user_id, employee_id, email, is_active, must_change_password, disabled_at, disabled_reason").order("email"),
    supabase.from("employees").select("id, full_name, employee_number"),
    supabase.from("branch_memberships").select("staff_id, branch_id"),
    supabase.from("staff_group_assignments").select("staff_id, group_key, branch_id"),
    supabase.from("branches").select("id, code"),
  ]);
  for (const result of [accounts, employees, memberships, assignments, branches]) {
    if (result.error) throw new Error("Staff could not be read");
  }
  const codeById = new Map((branches.data as Array<{ id: string; code: string }>).map((b) => [b.id, b.code]));
  const employeeById = new Map(
    (employees.data as Array<{ id: string; full_name: string; employee_number: string | null }>).map((e) => [e.id, e]),
  );

  return (accounts.data as Array<Record<string, unknown>>)
    .map((account) => {
      const userId = String(account.user_id);
      const employee = employeeById.get(String(account.employee_id));
      return {
        userId,
        fullName: employee?.full_name ?? String(account.email),
        email: String(account.email),
        employeeNumber: employee?.employee_number ?? null,
        isActive: account.is_active === true,
        mustChangePassword: account.must_change_password === true,
        disabledAt: (account.disabled_at as string | null) ?? null,
        disabledReason: (account.disabled_reason as string | null) ?? null,
        branches: (memberships.data as Array<{ staff_id: string; branch_id: string }>)
          .filter((m) => m.staff_id === userId)
          .map((m) => codeById.get(m.branch_id) ?? "?"),
        groups: (assignments.data as Array<{ staff_id: string; group_key: string; branch_id: string | null }>)
          .filter((a) => a.staff_id === userId && isGroupKey(a.group_key))
          .map((a) => ({ group: a.group_key as GroupKey, branch: a.branch_id ? (codeById.get(a.branch_id) ?? "?") : null })),
      } satisfies StaffRow;
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getStaff(userId: string): Promise<StaffRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;
  return (await listStaff()).find((row) => row.userId === userId) ?? null;
}

export async function listAudit(options: { category?: string; targetId?: string; limit?: number } = {}): Promise<AuditRow[]> {
  const supabase = await client();
  let query = supabase
    .from("audit_log")
    .select("id, occurred_at, actor_name, category, action, target_type, target_id, target_label, branch_id, changes")
    .order("id", { ascending: false })
    .limit(options.limit ?? 200);
  if (options.category) query = query.eq("category", options.category);
  if (options.targetId) query = query.eq("target_id", options.targetId);
  const [audit, branches] = await Promise.all([query, supabase.from("branches").select("id, code")]);
  if (audit.error || !audit.data) throw new Error("The audit history could not be read");
  const codeById = new Map(((branches.data ?? []) as Array<{ id: string; code: string }>).map((b) => [b.id, b.code]));
  return (audit.data as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    occurredAt: String(row.occurred_at),
    actorName: String(row.actor_name),
    category: String(row.category),
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: (row.target_id as string | null) ?? null,
    targetLabel: (row.target_label as string | null) ?? null,
    branch: row.branch_id ? (codeById.get(String(row.branch_id)) ?? null) : null,
    changes: row.changes,
  }));
}
