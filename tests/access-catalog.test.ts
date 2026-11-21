import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator, flattenKeys, getMessages } from "@/i18n/dictionary";
import { locales } from "@/i18n/config";
import {
  ALL_BRANCH_CODES,
  BRANCH_GROUPS,
  GROUPS,
  GROUP_PERMISSIONS,
  ORGANIZATION_GROUPS,
  PERMISSIONS,
  isBranchGroupKey,
} from "@/modules/access/catalog";
import { auditActionKey, errorMessageKey, groupDescriptionKey, groupNameKey, noticeMessageKey, permissionLabelKey, warningMessageKey } from "@/modules/access/ui";

const migrationsDir = path.resolve(__dirname, "../supabase/migrations");
const migration = (file: string) => readFileSync(path.join(migrationsDir, file), "utf8");
const ACCOUNTS = migration("20261121000005_accounts_and_permissions.sql");

describe("permission catalog (application code mirrors the database seed)", () => {
  it("lists exactly the permissions the migration inserts, with scope and branch kind", () => {
    const block = /insert into public\.permissions[\s\S]*?;\n/.exec(ACCOUNTS)?.[0] ?? "";
    const rows = [...block.matchAll(/\('([a-z_.]+)',\s*'[^']*',\s*'(organization|branch)',\s*'(operational|comparison|any)'\)/g)].map((m) => `${m[1]}|${m[2]}|${m[3]}`);
    const code = PERMISSIONS.map((p) => `${p.key}|${p.scope}|${p.branchKind}`);
    expect(rows.length).toBeGreaterThan(20);
    expect([...rows].sort()).toEqual([...code].sort());
  });

  it("lists exactly the groups the migration inserts", () => {
    const block = /insert into public\.permission_groups[\s\S]*?;\n/.exec(ACCOUNTS)?.[0] ?? "";
    const rows = [...block.matchAll(/\('([a-z_]+)',\s*'[^']*',\s*'(organization|branch)'\)/g)].map((m) => `${m[1]}|${m[2]}`);
    const code = GROUPS.map((g) => `${g}|${(ORGANIZATION_GROUPS as readonly string[]).includes(g) ? "organization" : "branch"}`);
    expect([...rows].sort()).toEqual([...code].sort());
  });

  it("grants each group exactly the permissions the migration grants", () => {
    const explicit = /insert into public\.group_permissions \(group_key, permission_key\) values([\s\S]*?);\n/.exec(ACCOUNTS)?.[1] ?? "";
    const fromSql = new Map<string, string[]>();
    for (const [, group, permission] of explicit.matchAll(/\('([a-z_]+)',\s*'([a-z_.]+)'\)/g)) {
      fromSql.set(group as string, [...(fromSql.get(group as string) ?? []), permission as string]);
    }
    fromSql.set("system_admin", PERMISSIONS.map((p) => p.key)); // "select ... from public.permissions"
    expect(ACCOUNTS).toMatch(/select 'system_admin', key from public\.permissions/);
    for (const group of GROUPS) {
      expect([...(fromSql.get(group) ?? [])].sort(), group).toEqual([...GROUP_PERMISSIONS[group]].sort());
    }
  });

  it("keeps comparison entry, viewing and exporting separate", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["comparison.enter", "comparison.view", "comparison.export"]));
    expect(GROUP_PERMISSIONS.comparison_editor).toEqual(["comparison.enter"]);
    const exporters = GROUPS.filter((g) => GROUP_PERMISSIONS[g].includes("comparison.export"));
    expect(exporters).toEqual(["system_admin"]);
    expect(GROUP_PERMISSIONS.attendance_kiosk).toEqual(["attendance.event.create"]);
    expect(GROUP_PERMISSIONS.cashier.some((p) => p.startsWith("inventory."))).toBe(false);
  });

  it("defines the six required groups", () => {
    expect([...GROUPS].sort()).toEqual(["attendance_kiosk", "cashier", "comparison_editor", "manager", "storekeeper", "system_admin"]);
    expect(BRANCH_GROUPS.every(isBranchGroupKey)).toBe(true);
    expect(isBranchGroupKey("system_admin")).toBe(false);
    expect(ALL_BRANCH_CODES).toEqual(["maarif", "alquds", "bourgogne"]);
  });
});

describe("translations of the access screens", () => {
  it("every group, permission and audit action has text in both languages", () => {
    for (const locale of locales) {
      const t = createTranslator(locale);
      for (const group of GROUPS) {
        expect(t(groupNameKey(group)).length, `${locale}:${group}`).toBeGreaterThan(0);
        expect(t(groupDescriptionKey(group)).length).toBeGreaterThan(0);
      }
      for (const permission of PERMISSIONS) {
        expect(t(permissionLabelKey(permission.key)).length, `${locale}:${permission.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("every audit action written by the database has a label", () => {
    const sources = ["20261121000007_account_commands.sql", "20261121000008_policies_and_grants.sql"].map(migration).join("\n");
    const direct = [...sources.matchAll(/write_audit\([^;]*?'(?:administration|security)',\s*(?:case when p_active then '([a-z_.]+)' else '([a-z_.]+)' end|'([a-z_.]+)')/gs)];
    const actions = new Set(direct.flatMap((m) => [m[1], m[2], m[3]]).filter(Boolean) as string[]);
    expect(actions.size).toBeGreaterThanOrEqual(7);
    for (const action of actions) expect(auditActionKey(action), action).not.toBeNull();
    // Operating actions are named after the audited table (see app_private.audit_operation).
    for (const table of ["business_days", "cash_movements", "cash_counts", "comparison_figures", "inventory_adjustments"]) {
      expect(auditActionKey(`${table}.created`), table).not.toBeNull();
    }
    expect(auditActionKey("business_days.updated")).not.toBeNull();
    expect(auditActionKey("something.unknown")).toBeNull();
  });

  it("query-string codes are whitelisted: unknown codes never reach the translator", () => {
    expect(errorMessageKey(undefined)).toBeNull();
    expect(errorMessageKey("")).toBeNull();
    expect(errorMessageKey("invalid")).toBe("errors.invalid");
    expect(errorMessageKey("not_a_code")).toBe("errors.unexpected");
    expect(errorMessageKey("constructor")).toBe("errors.unexpected");
    expect(errorMessageKey("__proto__")).toBe("errors.unexpected");
    expect(noticeMessageKey("created")).toBe("notices.created");
    expect(noticeMessageKey("<script>")).toBeNull();
    expect(warningMessageKey("auth_not_updated")).toBe("warnings.auth_not_updated");
    expect(warningMessageKey("x")).toBeNull();
  });

  it("every error code produced by the command mapper has a message in both languages", async () => {
    const { mapCommandError } = await import("@/modules/access/forms");
    const produced = [
      mapCommandError({ message: "permission_denied" }),
      mapCommandError({ message: "last_admin" }),
      mapCommandError({ message: "self_disable" }),
      mapCommandError({ message: "not_found" }),
      mapCommandError({ message: "invalid_input" }),
      mapCommandError({ code: "23505", message: "duplicate key", details: "Key (organization_id, email)" }),
      mapCommandError({ code: "23505", message: "duplicate key", details: "Key (organization_id, employee_number)" }),
      mapCommandError({ code: "23514", message: "x" }),
      mapCommandError(null),
    ];
    for (const locale of locales) {
      const keys = new Set(flattenKeys(getMessages(locale)));
      for (const code of produced) expect(keys.has(`errors.${code}`), `${locale}:${code}`).toBe(true);
    }
  });
});
