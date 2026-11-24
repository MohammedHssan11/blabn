import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Static guard rails for Phase 3: every entry point checks permission through the shared path,
 * the service-role client stays in one place, and every table the migrations create is protected.
 * They read the source files; the behaviour is tested by guard.test.ts, the SQL checks and the
 * end-to-end script.
 */

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const rel = (file: string) => path.relative(ROOT, file).replaceAll("\\", "/");
const sourceFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));

describe("every page checks access", () => {
  // Public pages: they exist to let a person sign in or recover a password.
  const PUBLIC = new Set(["src/app/[locale]/sign-in/page.tsx", "src/app/[locale]/forgot-password/page.tsx"]);
  const pages = sourceFiles.filter((f) => /[\\/]app[\\/]\[locale\][\\/](.*[\\/])?page\.tsx$/.test(f)).map(rel);

  it("finds the application pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(12);
  });

  it.each(pages.filter((p) => !PUBLIC.has(p)))("%s calls requireAccess", (page) => {
    expect(read(page)).toMatch(/await requireAccess\(/);
  });

  it("the public pages are only the sign-in and recovery pages", () => {
    for (const page of PUBLIC) expect(pages).toContain(page);
  });

  it("administrator pages ask for the administrator permissions", () => {
    for (const page of pages.filter((p) => p.includes("/admin/staff"))) expect(read(page)).toMatch(/admin\.users\.manage/);
    expect(read("src/app/[locale]/admin/audit/page.tsx")).toMatch(/admin\.audit\.view/);
  });

  it("branch pages name the branch they authorize", () => {
    for (const page of ["daily-close", "cash-count"]) {
      expect(read(`src/app/[locale]/${page}/page.tsx`)).toMatch(/permission: "daily_close\.view", branch: branchCode/);
    }
    // Phase 7: the comparison authorizes every SELECTED branch (all three by default).
    expect(read("src/app/[locale]/comparison/page.tsx")).toMatch(/query\.branches\.map\(\(branch\) => \(\{ permission: "comparison\.view" as const, branch \}\)\)/);
    expect(read("src/app/[locale]/comparison/history/page.tsx")).toMatch(/permission: "comparison\.view", branch/);
    expect(read("src/app/[locale]/comparison/entry/page.tsx")).toMatch(/holds\(access, "comparison\.enter", branch\)/);
    expect(read("src/app/[locale]/comparison/settings/page.tsx")).toMatch(/permission: "admin\.config\.manage"/);
    expect(read("src/app/api/exports/[kind]/route.ts")).toMatch(/query\.branches\.map\(\(branch\) => \(\{ permission: "comparison\.export", branch \}\)\)/);
    expect(read("src/app/[locale]/inventory/adjustments/page.tsx")).toMatch(/permission: "inventory\.adjust", branch/);
    // Phase 8: planning and orders are read with inventory.view; creating needs purchase_order.propose;
    // each command re-checks its own permission (create / approve / receive) in the action and the database.
    for (const page of ["replenishment", "replenishment/items/[id]", "replenishment/orders", "replenishment/orders/[id]"]) {
      expect(read(`src/app/[locale]/${page}/page.tsx`), page).toMatch(/permission: "inventory\.view", branch: OPERATING_BRANCH_CODE/);
    }
    expect(read("src/app/[locale]/replenishment/orders/new/page.tsx")).toMatch(/permission: "purchase_order\.propose", branch: OPERATING_BRANCH_CODE/);
    expect(read("src/app/[locale]/replenishment/settings/page.tsx")).toMatch(/permission: "admin\.config\.manage"/);
    expect(read("src/modules/replenishment/actions.ts")).toMatch(/require: \{ permission: purchaseOrderPermission\(command\), branch: OPERATING_BRANCH_CODE \}/);
  });
});

describe("every route handler checks access", () => {
  const routes = sourceFiles.filter((f) => /[\\/]app[\\/]api[\\/](.*[\\/])?route\.ts$/.test(f)).map(rel);
  // These two only act on the caller's own session (finish a recovery link, end a session).
  const SELF_SERVICE = new Set(["src/app/api/auth/callback/route.ts", "src/app/api/auth/session-ended/route.ts"]);

  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it.each(routes.filter((r) => !SELF_SERVICE.has(r)))("%s calls authorizeRequest before doing any work", (route) => {
    const source = read(route);
    expect(source).toMatch(/authorizeRequest\(/);
    // The first line of work in each handler is the check.
    expect(source.indexOf("authorizeRequest(")).toBeLessThan(source.search(/getRepository\(|recordAdjustment\(|createUserClient\(/ ) === -1 ? Infinity : source.search(/getRepository\(|recordAdjustment\(|createUserClient\(/));
  });

  it("state-changing routes refuse cross-site requests", () => {
    expect(read("src/app/api/inventory/adjustments/route.ts")).toMatch(/isSameOrigin\(request\)/);
  });

  it("downloads are never cached", () => {
    expect(read("src/app/api/exports/[kind]/route.ts")).toMatch(/"Cache-Control": "no-store"/);
    expect(read("src/app/api/report-exports/[id]/route.ts")).toMatch(/"Cache-Control": "no-store"/);
  });

  it("Phase 9: an Excel download re-checks the family's permission for every branch of the export", () => {
    const route = read("src/app/api/report-exports/[id]/route.ts");
    expect(route).toMatch(/authorizeRequest\(exportRequirements\(record\.family, record\.branches, record\.include_drafts\)\)/);
    expect(route.indexOf("authorizeRequest(exportRequirements")).toBeLessThan(route.indexOf("downloadExport("));
    const actions = read("src/modules/exports/actions.ts");
    expect(actions).toMatch(/require: exportRequirements\(checked\.family, checked\.branches, includeDrafts\)/);
    expect(actions).toMatch(/require: exportRequirements\(record\.family, record\.branches, record\.include_drafts\)/);
  });
});

describe("server actions authorize before they act", () => {
  /** Splits a "use server" file into its exported functions. */
  function actions(file: string): Array<{ name: string; body: string }> {
    const source = read(file);
    const parts = source.split(/^export async function /m).slice(1);
    return parts.map((part) => ({ name: part.slice(0, part.indexOf("(")), body: part }));
  }

  const GUARDED_FILES = ["src/modules/access/staff-actions.ts", "src/modules/inventory/actions.ts", "src/modules/replenishment/actions.ts",
    "src/modules/exports/actions.ts"];
  for (const file of GUARDED_FILES) {
    it(`${file}: every action calls requireAccess before anything that reads or writes`, () => {
      const list = actions(file);
      expect(list.length).toBeGreaterThan(0);
      for (const action of list) {
        const guardAt = action.body.indexOf("requireAccess(");
        expect(guardAt, `${action.name} has no requireAccess`).toBeGreaterThan(-1);
        for (const marker of ["getSupabaseAdmin(", ".rpc(", ".from(", "recordAdjustment(", "createUserClient("]) {
          const at = action.body.indexOf(marker);
          if (at !== -1) expect(guardAt, `${action.name}: ${marker} comes before the check`).toBeLessThan(at);
        }
      }
    });
  }

  it("the password change action requires a signed-in person; the other auth actions are pre-sign-in by nature", () => {
    const list = actions("src/modules/access/auth-actions.ts");
    const byName = Object.fromEntries(list.map((a) => [a.name, a.body]));
    expect(byName.changeOwnPasswordAction).toMatch(/requireAccess\(/);
    expect(Object.keys(byName).sort()).toEqual(["changeOwnPasswordAction", "requestRecoveryAction", "signInAction", "signOutAction"]);
  });

  it("action files only export async functions", () => {
    for (const file of [...GUARDED_FILES, "src/modules/access/auth-actions.ts"]) {
      const source = read(file);
      expect(source.startsWith('"use server";')).toBe(true);
      const exports = [...source.matchAll(/^export (?!async function)(.*)$/gm)].map((m) => m[0]);
      expect(exports, file).toEqual([]);
    }
  });
});

describe("the service-role client stays in one place", () => {
  it("only the staff actions import it", () => {
    const importers = sourceFiles.filter((f) => /@\/lib\/supabase\/admin/.test(readFileSync(f, "utf8"))).map(rel);
    expect(importers).toEqual(["src/modules/access/staff-actions.ts"]);
  });

  it("administrator database commands are called only from the staff actions", () => {
    const callers = sourceFiles.filter((f) => /\.rpc\(\s*["']admin_/.test(readFileSync(f, "utf8"))).map(rel);
    expect(callers).toEqual(["src/modules/access/staff-actions.ts"]);
  });

  it("the bootstrap command is not callable from the application", () => {
    for (const file of sourceFiles) expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/app_bootstrap_system_admin/);
  });

  it("no source file prints a password or key", () => {
    for (const file of sourceFiles) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/console\.\w+\([^)]*(password|secret|service_role|SERVICE_ROLE)/i);
    }
  });

  it("credentials stay out of Git: .env files are ignored and the example holds no values", () => {
    const ignore = read(".gitignore");
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
    for (const line of read(".env.example").split(/\r?\n/)) {
      if (/^[A-Z_]+=/.test(line)) expect(line, line).toMatch(/^[A-Z_]+=$/);
    }
  });

  it("the proxy refreshes sessions but is not an authorization decision", () => {
    const proxy = read("src/proxy.ts");
    expect(proxy).toMatch(/NOT AN AUTHORIZATION CHECK/);
    expect(proxy).not.toMatch(/app_authorize|requireAccess|authorize\(/);
  });
});

describe("migrations protect every table", () => {
  const migrationFiles = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const all = migrationFiles.map((f) => read(`supabase/migrations/${f}`)).join("\n");

  it("every table has row-level security enabled", () => {
    const tables = [...all.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThanOrEqual(15);
    for (const table of tables) expect(all, table).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
  });

  it("nothing is ever granted to anon", () => {
    for (const statement of all.match(/^grant\b[\s\S]*?;/gim) ?? []) expect(statement, statement).not.toMatch(/\banon\b/i);
  });

  it("the identity, catalog and audit tables are never writable through the API roles", () => {
    const protectedTables = ["employees", "staff_accounts", "permissions", "permission_groups", "group_permissions", "branch_memberships", "staff_group_assignments", "audit_log"];
    for (const statement of all.match(/^grant\s+(insert|update|delete|all)\b[\s\S]*?;/gim) ?? []) {
      for (const table of protectedTables) expect(statement, `${table}: ${statement}`).not.toMatch(new RegExp(`public\\.${table}\\b`));
    }
  });

  it("SECURITY DEFINER functions fix their search_path", () => {
    const functions = all.match(/create (or replace )?function[\s\S]*?(\$\$|as '[^']*')/gi) ?? [];
    const definers = functions.filter((f) => /security definer/i.test(f));
    expect(definers.length).toBeGreaterThan(10);
    for (const definition of definers) expect(definition, definition.slice(0, 120)).toMatch(/set search_path = ''/);
  });

  it("the audit table is closed to updates", () => {
    expect(all).toMatch(/before update or delete on public\.audit_log/);
    expect(all).toMatch(/before truncate on public\.audit_log/);
    expect(all).toMatch(/revoke insert, update, delete, truncate on public\.audit_log from service_role/);
  });
});

describe("audit fixes: password gate and serialized administrator changes (migration 9)", () => {
  const nine = read("supabase/migrations/20261121000009_password_gate_and_admin_serialization.sql");
  const body = (name: string) => {
    const start = nine.indexOf(`create or replace function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return nine.slice(start, nine.indexOf("\n$$;", start));
  };

  it("the permission functions refuse an account that must change its password", () => {
    expect(body("app_private.effective_permissions")).toMatch(/not s\.must_change_password/);
    expect(body("app_private.can_see_branch")).toMatch(/not s\.must_change_password/);
    expect(nine).toMatch(/create policy permissions_select[\s\S]*access_cleared\(\)/);
  });

  it("the flag is released only when Auth stores a different password hash, and the audit row follows", () => {
    const complete = body("public.app_complete_password_change");
    expect(complete).toMatch(/password_fingerprint\(auth\.uid\(\)\) is not distinct from v_snapshot/);
    expect(complete.indexOf("password_not_changed")).toBeLessThan(complete.indexOf("write_audit"));
    expect(complete.indexOf("password_not_changed")).toBeLessThan(complete.indexOf("must_change_password = false"));
    expect(nine).toMatch(/check \(not must_change_password or password_fingerprint is not null\)/);
    // The fingerprint is a digest, never the stored hash.
    expect(nine).toMatch(/encode\(sha256\(/);
  });

  it("every place that sets the flag stores the fingerprint", () => {
    for (const name of ["public.admin_create_staff", "public.admin_record_password_reset", "public.app_bootstrap_system_admin"]) {
      expect(body(name), name).toMatch(/password_fingerprint/);
    }
  });

  it("administrator commands take the organization lock and re-check the caller after it", () => {
    const admin = body("app_private.require_admin");
    const lockAt = admin.indexOf("pg_advisory_xact_lock");
    expect(lockAt).toBeGreaterThan(-1);
    expect(admin.slice(lockAt)).toMatch(/has_permission\('admin\.users\.manage'\)/);
    expect(body("public.app_bootstrap_system_admin")).toMatch(/pg_advisory_xact_lock/);
    // Every admin_* command gets its organization (and so the lock) from require_admin.
    const sevens = read("supabase/migrations/20261121000007_account_commands.sql");
    for (const fn of sevens.match(/create function public\.admin_[a-z_]+[\s\S]*?\n\$\$;/g) ?? []) {
      expect(fn, fn.slice(0, 60)).toMatch(/app_private\.require_admin\(\)/);
    }
  });
});
