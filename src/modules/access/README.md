# Access control

Sign-in, staff accounts, branch membership, permission groups and the audit history. Built in Phase 3; the full description is in [docs/phase3/ACCOUNTS_AND_PERMISSIONS.md](../../../docs/phase3/ACCOUNTS_AND_PERMISSIONS.md).

| File | Role |
|---|---|
| `catalog.ts` | Permission and group keys mirrored from the database seed (a test fails if they drift). |
| `session.ts` | `getAccessContext()`: who is asking, read live from Supabase Auth and the database. `holds()` is for menus only. |
| `guard.ts` | `authorize`, `requireAccess` (pages, actions), `authorizeRequest` (downloads, direct requests). The one authorization path. |
| `auth-actions.ts` | Sign-in, sign-out, recovery request, own password change. |
| `staff-actions.ts` | Create, update, change access, disable/reactivate, reset password. The only code that uses the service-role client. |
| `directory.ts` | Reads of staff, branches and the audit history (as the signed-in person, so row-level security applies). |
| `forms.ts`, `ui.ts` | Form parsing and error mapping; whitelisted message codes. |
| `branches.ts` | Branch settings (timezone, business-day rollover) from Phase 2. |

Rule for later phases: read and write business data with `createUserClient()` (`src/lib/supabase/server.ts`) so row-level security applies, and call `requireAccess` / `authorizeRequest` with the permission and branch before doing any work.
