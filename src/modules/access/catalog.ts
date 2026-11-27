/**
 * The permission catalog: which permissions exist and which groups hold them.
 *
 * The database is the authority (migration 20261121000005 seeds, and later migrations such as
 * 20261123120000_phase6_stock, 20261125090000_phase8_replenishment and 20261129090000_attendance add to, `permissions`, `permission_groups`
 * and `group_permissions`; every decision is made there). This file mirrors it for the screens:
 * it names the keys the code asks about and lists what a group grants so the staff screen can
 * show it. tests/access-catalog.test.ts fails if this file and the migration differ, and
 * scripts/phase3/e2e.mjs compares it with the running database.
 */

export const PERMISSIONS = [
  { key: "admin.users.manage", scope: "organization", branchKind: "any" },
  { key: "admin.audit.view", scope: "organization", branchKind: "any" },
  { key: "admin.config.manage", scope: "organization", branchKind: "any" },
  { key: "recipes.manage", scope: "organization", branchKind: "any" },
  { key: "daily_close.view", scope: "branch", branchKind: "operational" },
  { key: "daily_close.draft", scope: "branch", branchKind: "operational" },
  { key: "daily_close.close", scope: "branch", branchKind: "operational" },
  { key: "daily_close.export_draft", scope: "branch", branchKind: "operational" },
  { key: "cash_count.enter", scope: "branch", branchKind: "operational" },
  { key: "inventory.view", scope: "branch", branchKind: "operational" },
  { key: "inventory.receive", scope: "branch", branchKind: "operational" },
  { key: "inventory.count", scope: "branch", branchKind: "operational" },
  { key: "inventory.waste", scope: "branch", branchKind: "operational" },
  { key: "inventory.hospitality", scope: "branch", branchKind: "operational" },
  { key: "inventory.adjust", scope: "branch", branchKind: "operational" },
  { key: "inventory.adjust_approve", scope: "branch", branchKind: "operational" },
  { key: "inventory.consume", scope: "branch", branchKind: "operational" },
  { key: "purchase_order.propose", scope: "branch", branchKind: "operational" },
  { key: "purchase_order.approve", scope: "branch", branchKind: "operational" },
  { key: "purchase_order.receive", scope: "branch", branchKind: "operational" },
  { key: "reports.view", scope: "branch", branchKind: "operational" },
  { key: "reports.export", scope: "branch", branchKind: "operational" },
  { key: "comparison.enter", scope: "branch", branchKind: "comparison" },
  { key: "comparison.view", scope: "branch", branchKind: "any" },
  { key: "comparison.export", scope: "branch", branchKind: "any" },
  { key: "attendance.event.create", scope: "branch", branchKind: "operational" },
  // Phases 13-14 (migration 20261129090000_attendance): Abdo's attendance administration.
  { key: "attendance.view", scope: "branch", branchKind: "operational" },
  { key: "attendance.employees.manage", scope: "branch", branchKind: "operational" },
  { key: "attendance.enroll", scope: "branch", branchKind: "operational" },
  { key: "attendance.devices.manage", scope: "branch", branchKind: "operational" },
  { key: "attendance.correct", scope: "branch", branchKind: "operational" },
  { key: "attendance.export", scope: "branch", branchKind: "operational" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const ORGANIZATION_GROUPS = ["system_admin"] as const;
export const BRANCH_GROUPS = ["cashier", "storekeeper", "manager", "comparison_editor", "attendance_kiosk"] as const;
export const GROUPS = [...ORGANIZATION_GROUPS, ...BRANCH_GROUPS] as const;
export type GroupKey = (typeof GROUPS)[number];
export type BranchGroupKey = (typeof BRANCH_GROUPS)[number];

const ALL_KEYS = PERMISSIONS.map((p) => p.key) as PermissionKey[];

/** What each group grants. System Admin holds every permission. */
export const GROUP_PERMISSIONS: Record<GroupKey, readonly PermissionKey[]> = {
  system_admin: ALL_KEYS,
  cashier: ["daily_close.view", "daily_close.draft", "cash_count.enter", "daily_close.export_draft"],
  storekeeper: [
    "inventory.view",
    "inventory.receive",
    "inventory.count",
    "inventory.waste",
    "inventory.hospitality",
    "inventory.adjust",
    "inventory.consume",
    "purchase_order.propose",
    "purchase_order.receive",
  ],
  manager: ["daily_close.view", "daily_close.close", "inventory.view", "inventory.adjust_approve", "inventory.consume", "comparison.view"],
  comparison_editor: ["comparison.enter"],
  attendance_kiosk: ["attendance.event.create"],
};

export function isGroupKey(value: unknown): value is GroupKey {
  return typeof value === "string" && (GROUPS as readonly string[]).includes(value);
}

export function isBranchGroupKey(value: unknown): value is BranchGroupKey {
  return typeof value === "string" && (BRANCH_GROUPS as readonly string[]).includes(value);
}

/** Branches by role in the business: Maarif operates in the application; the others are comparison-only. */
export const OPERATING_BRANCH_CODE = "maarif";
export const COMPARISON_BRANCH_CODES = ["alquds", "bourgogne"] as const;
export const ALL_BRANCH_CODES = [OPERATING_BRANCH_CODE, ...COMPARISON_BRANCH_CODES] as const;
