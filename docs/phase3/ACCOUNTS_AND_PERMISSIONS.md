# Phase 3 — Accounts, permissions and audit history

How sign-in, staff accounts, branch access and the audit history work, how to bootstrap Abdo, and where each rule is enforced. Results of the acceptance checks are in the [handover record](../HANDOFF.md).

## The model

| Record | Purpose |
|---|---|
| `employees` | A person known to the organization (name, optional employee number for the later attendance kiosk, active flag). |
| `staff_accounts` | Links one employee to one Supabase Auth user (`user_id`). Holds the email copy, the active flag, the disable time and reason, and whether the person must choose a new password. The password itself lives only in Supabase Auth. |
| `permission_groups`, `permissions`, `group_permissions` | The catalog (reference data inserted by migration `20261121000005`). |
| `branch_memberships` | The branches a person belongs to. |
| `staff_group_assignments` | A group given to a person: an **organization group** (System Admin) once for the whole organization, or a **branch group** for one branch the person belongs to. One person can hold several groups. |
| `audit_log` | Append-only history (migration `20261121000006`). |

The existing organization and branch records are reused. Maarif is the operating branch (`operates_in_app = true`); Al Quds and Bourgogne are comparison-only. Each permission names the kind of branch it works on (`operational`, `comparison` or `any`), so a Cashier assignment can never operate a comparison-only branch, and comparison figures cannot be entered for Maarif (its figures come from saved days).

## Groups and permissions

| Group | Scope | Grants |
|---|---|---|
| System Admin | organization | Every permission: user management, audit review, configuration, recipes, approvals, reports, comparison entry, viewing and export. |
| Cashier | branch | `daily_close.view`, `daily_close.draft`, `cash_count.enter`, `daily_close.export_draft` |
| Storekeeper | branch | `inventory.view`, `.receive`, `.count`, `.waste`, `.hospitality`, `.adjust`, `purchase_order.propose` |
| Manager | branch | `daily_close.view`, `daily_close.close`, `inventory.view`, `inventory.adjust_approve`, `comparison.view` |
| Comparison Editor | branch | `comparison.enter` only: cannot view or export what was entered |
| Attendance Kiosk (future) | branch | `attendance.event.create` only; the attendance workflow is built in Phase 13 |

Comparison **entry**, **viewing** and **export** are three permissions (`comparison.enter`, `comparison.view`, `comparison.export`). Only System Admin exports. The comparison page and export cover all three branches and the total, so they require the permission for every branch.

## Enforcement: every layer asks the database

Nothing is cached in a token. Each request reads the live tables, so removing a group or disabling an account blocks the next request even from an open session.

### Temporary password gate (database and application)

An account created by an administrator, bootstrapped, or given a temporary password by an administrator is flagged `must_change_password`. **PostgreSQL itself refuses a flagged account**: `effective_permissions()` and `can_see_branch()` return nothing for it, so every policy, every `admin_*` command and `app_authorize` deny it, whatever client or JWT is used. The Next.js guard sends the person to `/<locale>/account/password`. What a flagged person keeps: `app_access_context()` (to learn the state), `app_complete_password_change()`, their own staff/employee/assignment rows, and the password page.

The flag is **not** cleared on request. When it is set, the database stores a SHA-256 fingerprint of the account's Auth password hash (never the hash). `app_complete_password_change()` clears the flag and writes the `account.password_changed` audit record only when Supabase Auth now holds a *different* hash, i.e. after the person really changed the password through the authentication flow (`auth.updateUser` in a signed-in session, or after a recovery link). Calling it without a change is refused (`password_not_changed`). Flows: first sign-in and administrator reset (the server sets the temporary password in Auth, then the command flags and fingerprints it; the Auth update also ends the person's open sessions), and recovery (link, one-time code, new password).

### Serialized administrator changes

Every `admin_*` command starts with `require_admin()`: it checks the caller's permission, takes a transaction-scoped advisory lock for the organization (`pg_advisory_xact_lock`), then checks the caller's permission again, because the caller may have been demoted or disabled while waiting. The last-active-System-Admin rule is evaluated afterwards, inside the same serialized transaction. The bootstrap command takes the same lock. `npm run test:concurrency` overlaps real transactions (mutual disables, mutual group removal, a three-way ring) and requires at least one active System Admin each time.

1. **Database policies (RLS) and grants.** Every table has RLS. `anon` has no access. `authenticated` has only the grants listed in migration `20261121000008`, and each row must also pass a policy that calls `app_private.has_permission()`. Identity, catalog and audit tables are read-only to the API roles. Tables, functions and sequences created later start with no API access.
2. **Commands.** Staff management runs through `admin_*` database commands that check `admin.users.manage` as the caller and write the audit row in the same transaction. The service role is used only to create or update Supabase Auth accounts, after the caller has been authorized.
3. **Application.** `src/modules/access/guard.ts` is the one path: `requireAccess` for pages and server actions, `authorizeRequest` for downloads and direct requests. It validates the session with Supabase Auth, asks the database for the person's state (`app_access_context`) and asks `app_authorize` for each permission and branch. Any failure to get an answer denies. The proxy only refreshes sessions; it is not an authorization decision.

A signed-in person whose account is disabled is sent to `/api/auth/session-ended`, which clears their cookies. Disabling also removes their Auth sessions and bans the Auth user; reactivation lifts the ban.

Protected today: every application page, `/api/exports/daily-close-draft` and `/api/exports/comparison` (minimal CSV exports of the synthetic prototype data that exercise the shared path until the Phase 9 report exports), `POST /api/inventory/adjustments`, and the inventory-adjustment skeleton (`inventory_adjustments`, a permission-checked table that Phase 6 extends with products, units and quantities).

### Staff sign-in email

Use the administrator's staff form to change a staff member's sign-in email. It updates Supabase Auth and the staff directory, and records the administrator and both addresses in the audit history. The database blocks self-service Auth email changes for staff and refuses a directory email that disagrees with Auth. Password recovery still uses the current sign-in address.

## Audit history

Written by the administrator commands, the bootstrap command and row triggers on the operating tables (`business_days`, `cash_movements`, `cash_counts`, `comparison_figures`, `inventory_adjustments`) for statements made by a signed-in person. Each row records the actor (id and name at the time), category, action, target, branch, timestamp and the changed fields. The table refuses UPDATE, DELETE and TRUNCATE for every role (grants and triggers), no API role can insert, and a constraint refuses credential-like field names. Reading needs `admin.audit.view` (`/<locale>/admin/audit`, and the history on each staff page).

Limit: a database owner can still disable triggers. Protect the database owner credentials accordingly.

## Bootstrapping Abdo as the first System Admin

```powershell
# 1. Supabase must be running and the service-role key available to THIS machine only
#    (environment or .env.local, never committed).
$env:BOOTSTRAP_ADMIN_PASSWORD = '<a temporary password of at least 10 characters>'
node scripts/phase3/bootstrap-admin.mjs --email <abdo's email> --name "<full name>"
Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD
```

It picks the organization (`--organization <uuid>`, or the only one; `--create-organization "<name>"` creates the organization with Maarif, Al Quds and Bourgogne when none exists), creates the Auth user with the temporary password, then calls `app_bootstrap_system_admin`, which creates the employee, staff account, the System Admin assignment and the audit record. It refuses when the organization already has an active System Admin, and refuses a non-local Supabase URL without `--confirm-remote`. Leaving the password variable unset prompts for it with hidden input. The password is never printed, stored or sent on the command line. Abdo is made to choose his own password at the first sign-in.

**Production provisioning is pending.** It needs a hosted Supabase project, its Auth settings (below) and a decision on who runs this command. Do not run it against a real project until then.

Auth settings to apply on the hosted project (they are in `supabase/config.toml` for local use): sign-ups disabled, minimum password length 10, the application's recovery address in the allowed redirect URLs, a real SMTP provider for recovery emails. `SITE_URL` must equal the address people open the application at; recovery links and the session cookie depend on it.

## Verifying

Use a disposable local Supabase project with synthetic accounts. The upgrade, HTTP and browser checks reset its database, and the concurrency check adds sample organizations.

`npm ci` installs the Supabase CLI pinned in `package.json` (2.122.1), so `npx supabase` resolves to that version rather than a global install. An older global CLI (for example 2.102) refuses `supabase/config.toml` (`local_smtp`, `auth.email.enabled`). Storage, Realtime, Studio and the analytics services are not used by the application or the checks; `-x` skips them and saves several gigabytes of images.

```powershell
npm ci
npx supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,studio,postgres-meta
node scripts/phase3/write-local-env.mjs      # writes the git-ignored .env.local for the local instance
npm run check                                # typecheck, unit tests, production build
npm run db:upgrade-test                      # Phase 2 baseline -> upgrade -> fresh build -> equal schemas;
                                             # also an upgrade of a database that ran migrations 05-08 and holds a flagged account
npm run db:check                             # Phase 2 SQL checks (run right after a reset)
npm run db:check:phase3                      # Phase 3 SQL checks
npm run test:concurrency                     # overlapping administrator transactions (run after db:check: it adds organizations)
npm run test:phase3                          # HTTP end-to-end (rebuilds the local database)
npm run test:browser                         # Edge/Chrome, English and Arabic
npm run test:smoke                           # Phase 2 smoke checks, signed in as a synthetic admin
```

## Not in Phase 3

Real report exports (Phase 9), the daily-close write workflow and the Casablanca business-date follow-up (Phase 4), stock movements (Phase 6), per-branch comparison columns and comparison revision history (Phase 7), the attendance kiosk workflow (Phase 13), production provisioning.
