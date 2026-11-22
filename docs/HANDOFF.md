# Handover record

Read this first in every session, then compare it with the actual repository state (`git status`, `git log -3`, `git fetch` and the PR list) before continuing. Update it after each meaningful task and before ending a session.

_Last updated: 22 November 2026. Phases 1 through 5 are complete for local development, pending one answer from Abdo (the November recipe start date). Phase 6 is the next implementation milestone. Production provisioning of his account is pending._

The bilingual workspace uses the [B.Laban interface refresh](BRAND_DESIGN.md). Phase 4 implements the [confirmed daily close and Yawmeya workflow](phase4/OPERATING_CLOSE.md) on the signed-in person's Supabase session.

## Where things are

| Item | Value |
|---|---|
| Repository | https://github.com/MohammedHssan11/blabn (private) |
| Phase 3 branch | `codex/phase-3-accounts-permissions`, based on `main` at the Phase 2 merge (`2d21e31`). |
| Development baseline | Fetch `origin/main` before starting Phase 6. Phase 5 is on branch `codex/phase-5-catalog` (based on `main` at the Phase 4 merge, PR #7). |
| Phase 2 pull request | [PR #2](https://github.com/MohammedHssan11/blabn/pull/2), merged. |
| Local-only material | `C:\Users\mh978\Downloads\abdo\abdo temp\`, `...\outputs\`, `...\archive\`, `...\screenshot\` — outside Git; keep them out of commits. |

## Phase 4 status

- Delivered daily-close drafts and review, cash denomination counts, cash and purchasing-custody entries, cancellations, ledger account configuration, bank remittance, posted revisions, corrections and approval.
- Daily Sales Maarif, the daily statement and Yawmeya draw from the same revisions. The CSV identifies its report basis. Earlier exports can be reproduced after current carry-forward updates.
- PostgreSQL alone determines the live business date and branch-local event times. The tested Casablanca data uses GMT in November 2026 and GMT+1 before the September change. This resolves the Phase 2 timing caveat. The rollover tests cover midnight, 01:00, and both sides of the 02:00 cutoff.
- Phase 4 SQL acceptance passed on fresh and upgraded Supabase. Checks cover separate carry-forward, missing and explicit zero counts, match, shortage, overage, duplicate deposit, unchanged variance after remittance, rejection of a failed partial write, original export basis and branch permissions.
- Phase 4 browser acceptance passed 30/30 with the production build in English desktop and Arabic at 375 px. A real concurrent save produced one accepted revision and one conflict.
- Earlier-phase regressions passed with 162 unit tests, a clean type check and production build, 69 smoke checks, 27 permission-concurrency checks, 372 HTTP checks and 105 browser checks.
- The additional private 2 November reference passed 25/25. The daily statement and Yawmeya showed +3 MAD before and after the one recorded remittance. The reference inputs stayed in the isolated local test stack and outside Git.
- The reviewed account codes came from the workbook's accessible reference sheet. Validation used the already available 2 November evidence, so the deferred protected-sheet operations were unnecessary. Hosted Supabase deployment and production opening balances are scheduled separately.

## Phase 5 status

Catalog, Foodics mappings, units and effective-dated recipes are implemented and locally accepted, with one input still owed by Abdo (below). Design, rules, loaded data and commands: [phase5/CATALOG_AND_RECIPES.md](phase5/CATALOG_AND_RECIPES.md). Phase 5 stops at eligibility: nothing posts stock (Phase 6).

### Acceptance checks

| Check | Result | Evidence |
|---|---|---|
| A known product and recipe give an independently verified consumption result, packaging included | **Pass** | `phase5_checks.sql` §4: 7 test cakes worked by hand (flour 21/10 kg, butter 7/10, jelly 7/30, 7 boxes, 14 spoons) and the real large Bazabizo Mango (3 pieces: 9/25 kg gel, 9/5 kg mango, 18 spoons). `test:phase5` §6 compares 24 loaded recipes with a BigInt calculation taken from the workbook fixture, ingredient and packaging lines, all exact. |
| A later recipe version leaves earlier days untouched | **Pass** | SQL §5 and HTTP §7: the recipe basis (version and quantities) of 31 October and 4 November is identical before and after version 2 (and 3) is approved; 5 November uses version 2; 30 September has no recipe. Approved versions and their lines cannot be updated or deleted, even by the table owner. |
| Effective-date boundary and overlap | **Pass** | The last day of version 1 and the first day of version 2 resolve to different versions; overlapping approvals are refused (SQL and HTTP); two simultaneous approvals leave exactly one (HTTP §7b). |
| Missing or ambiguous mapping, missing or incompatible conversion, unapproved recipe each block only the affected line, with a reason | **Pass** | SQL §4 and §6, HTTP §5: unmapped, pending, rejected, no recipe, draft recipe, no recipe for the date, invalid quantity, missing and incompatible unit, missing base unit; valid lines in the same request stay eligible; reasons name the component and recipe line. |
| Loaded data matches Abdo's decisions | **Pass** | Cake alias, ten mixed-nut rows as kilograms, six spoons in the November version only (cited to SRC-07 sheet `2` D1015:G1015), separate October and November versions, nothing approved by the load except the cake alias. |
| Fresh install and Phase 4 upgrade | **Pass** | `npm run db:upgrade-test` section E: Phase 4 head, seed, upgrade, catalog seed, Phase 2 to 5 SQL checks, schema and grants equal to a fresh build. |
| Permissions | **Pass** | Cashier and Storekeeper get 403 on every catalog page in both languages; the Storekeeper reads items and may run the eligibility check but sees no mappings, queue or date question; no API role writes a table; removing the group blocks the next request of an open session. |
| Arabic and English workflows | **Pass** | Edge, desktop and 375 px, both languages: direction, no horizontal scroll, and the real date-answer, approval, queue and mapping workflows. |

### Results (22 November 2026, after the final code change)

| Command | Result |
|---|---|
| `npm run typecheck`, `npm test`, `npm run build` | clean; 188/188 tests in 12 files; build passes (the catalog adds 7 dynamic pages) |
| `npm run db:check`, `db:check:phase3`, `db:check:phase4`, `db:check:phase5` | all pass on a fresh database |
| `npm run db:upgrade-test` | pass (paths A to E, including the new Phase 4 to 5 upgrade) |
| `npm run test:concurrency` | pass |
| `npm run test:phase3` (HTTP), `npm run test:browser` | 372 checks, 0 failed; 105 browser checks, 0 failed |
| `npm run test:smoke` | 69/69 |
| `npm run test:phase5` (HTTP) | 145/145 |
| `npm run test:phase5:browser` (Edge) | 71/71, no console errors |
| `npm run test:phase4` (Phase 4 browser regression) | 30/30, run on the Phase 5 production build against an isolated local Supabase project (stopped and removed afterwards) |
| `seed:check`, `seed:catalog:check`, `catalog:extract -- --check` | up to date |

Mutation checks on `phase5_checks.sql`: dropping the line-immutability trigger, opening the catalog read policy, counting a draft as approved, skipping the date gate, resolving a pending mapping, converting an incompatible unit, and ignoring recipe ranges each made the file fail. `db:upgrade-test` was last run before the final documentation edits only; no migration changed afterwards.

### Self-audit: found and fixed

1. **Recipe quantities are not decimals.** The workbooks contain `=0.1/3` and an eleven-digit formula; a decimal column would have rounded them. Quantities and conversions are exact numerator/denominator pairs.
2. **A Foodics name cannot be ambiguous by construction.** The approved-label uniqueness index applies to Foodics only; the workbooks repeat product names in different sections, so identity labels do not compete.
3. **A hamza spelling split one ingredient into two** («أيس كريم» in the inventory list, «ايس كريم» in 55 recipe lines). The shared name fold merges them and keeps both spellings, so those recipes deduct from the stocked item (P1-30).
4. **Mobile overflow** found by the browser check on the review and recipe pages (375 px); fixed in CSS and rechecked in both languages.
5. **Test assertions** that matched hidden option text or raced two redirects were corrected; the application was not at fault.
6. **Seed on older resets.** A reset to an older migration failed on the catalog seed; the seed now does nothing when the tables do not exist.
7. **Duplicate background run.** An accidental second regression run collided on the database and was discarded; every result above is from one clean run.

### Pending decisions and open items

- **Abdo: «نسخة وصفات نوفمبر بدأ العمل بيها من يوم كام؟»** Until he answers, the 11 affected versions stay drafts (the database refuses their approval). Record the answer on `/catalog/review`. The 5 November date used in tests exists only inside rolled-back or throwaway databases.
- **Other Foodics names:** six lines from the 7 November report are proposals (same-name matches checked in Phase 1); the Kinder cake is separate and needs its own answer (P1-29; the workbook quantity 12 is unchanged). Approve each in the review queue.
- **Unit conflicts (18 components) and missing quantities or units** are listed with exact rows. Examples: «ملاعق بلاستيك للارز» written «كيلو» in four lines; «موز فريش» with no unit (row 954 of both workbooks); «صوص نوتيلا مجهز» and «شيكولاتة بنى اقراص(شيبس)» mixing kilograms and pieces. No recipe containing one can be approved.
- **61 recipes read an empty Product Mix row, 9 link to none, 69 components are missing from the inventory list.** They need the Foodics name or an inventory row from Abdo.
- **Every recipe is a draft.** Abdo approves them, with dates, before Phase 6 consumes anything; none was approved on his behalf. English names exist for four items only.
- **Phase 6 hooks:** store the recipe version, line ids and exact quantities with each posting; make closing an open recipe range refuse dates that already have posted consumption.
- Not run: hosted Supabase, a physical phone or Safari. The Arabic wording has not been read by a native reviewer other than the project owner.

## Current phase and status

**Phase 1 closed on 21 November 2026. Phase 2 is complete (21 November 2026); Phase 3 is implemented and locally accepted (see "Phase 3 status").** All six answers are recorded and the [closure checklist](phase1/CLOSURE.md) passes. Phase 2 delivers the [report contracts](phase2/REPORT_CONTRACTS.md), a bilingual Next.js application with three prototypes on synthetic data, and Supabase migrations checked on a local database (see "Phase 2 status" below).

| Part | Status |
|---|---|
| Source and worksheet inventory | **Complete** — 16 workbooks / 264 sheets (12 hidden) + 11 other items ([coverage](phase1/SOURCE_COVERAGE.md)). |
| Evidence-backed findings | **Complete** — 37 findings ([register](phase1/FINDINGS.md); source of truth [findings.json](phase1/findings.json), version `2026-11-21.1`). |
| Finding statuses (after Abdo's answers, `findings.json` `2026-11-21.1`) | 19 fully verified corrections, 6 partial (protected ledger sheets, units, an unknown order quantity), 0 applied on an assumption, 7 application rules, 4 deferred, 1 pending a later-phase decision (P1-32). |
| Corrected workbook copies | 13 copies; 4,082 of 4,400 operations applied. **318 deferred** on password-protected ledger day sheets. Revisit during Phase 4 only if a reference case needs them. See [owner deferrals](phase1/decisions/owner-deferrals.json). |
| Checks (21 Nov) | 0 unexplained changes (cell-by-cell diff of all 13 copies); 71/71 value checks (26 independent, 37 construction, 8 against Abdo's answers); 26/26 Excel boundary tests; 169/169 question-location checks; Excel errors in the 11 non-ledger copies 54,206 → 0, ledgers 89 → 85. |
| Report field map | 54 fields: 43 agreed by the team, 5 agreed by Abdo, 6 waiting only for later-phase questions (none blocks Phase 1). See [FIELD_MAP.md](phase1/FIELD_MAP.md). |
| Review page for Abdo | All six exported answers received. The delivered questions and their location checks are retained with the [review material](phase1/README.md). |
| Abdo's decisions | 6 of 6 imported, 0 marked «not sure». See the [decision summary](phase1/decisions/DECISIONS_SUMMARY.md) and the [November workflow notes](phase1/README.md#abdos-november-workflow). |

The owner moved the final confirmation of the six recorded answers to the Phase 10 walkthrough with Abdo. He has since confirmed the old order date means expected receipt. See the [Phase 8 decision](ABDO_WORKFLOW_DECISIONS.md#phase-8--legacy-order-date).

## Phase 2 status (21 November 2026)

| Acceptance item | Status |
|---|---|
| Next.js / React / TypeScript, Arabic RTL and English LTR, shared translation files, persistent language switch, MAD and dates | **Done and checked** (build, 55 HTTP checks, browser checks at 375 px and desktop width). |
| A developer can create the database from migrations and run the application | **Done and checked.** `npx supabase start` and `npx supabase db reset` both built the local database from the three migrations and the seed; `npm run db:check` passes; the production build serves the application. |
| Prototypes: daily close, cash count, branch comparison on synthetic data | **Done and checked.** Server-side calculations; every value carries its field ID and saved record; blank and zero kept apart; business date separate from event timestamps; pending fields marked. |
| Typecheck, tests, production build | **Pass** (see "Phase 2 checks"). |
| Report map links every field to its source and decision | **Done:** 54 fields; 6 stay marked with the later phase that needs them. |
| Credentials outside source control; originals private | **Done:** `.env*` ignored except `.env.example` (empty values); `source-material/workbooks/` untouched. |
| Local Supabase instance running the migrations and `npm run db:check` | **Done.** Local instance only; no hosted Supabase project was created or used. |

**How the database check went.** The first `npx supabase start` filled the C: drive while pulling images, and Docker's engine then stopped answering. With the project owner's approval Docker Desktop and its WSL distro were restarted (the owner's other containers came back on their own; nothing was deleted). The rerun applied the three migrations and the seed. The first `db:check` failed on one assertion of mine (below), which was corrected; the check then passed, again after `db reset`.

**Time-zone caveat for Phase 4 (found by the database check).** This local PostgreSQL 17.12 gives `Africa/Casablanca` an offset of +00:00 on 3 Nov 2026, while Node (tzdata 2025b) gives +01:00 (the earlier legal offset outside Ramadan). The Phase 4 investigation above verified that the November PostgreSQL result is correct. The two server-side layers can therefore disagree about the business date of an instant near midnight. The synthetic data is far from midnight, so Phase 2 results are unaffected, and the rollover assertion in `phase2_checks.sql` now builds its instant from local time so it tests the logic only. Before Phase 4 stores real event times, compute the business date in one place only (preferably the database, with its time-zone data updated and verified against a known Moroccan date) and add a test around midnight.

## Phase 3 status (21 November 2026): accounts, permissions and audit history

**Local Phase 3 acceptance: complete after the two independent audit findings were fixed (see "Second independent audit"). All required checks passed on the final code.** Not established: anything on a hosted Supabase project, a real SMTP provider, Safari or a physical phone (see "Remaining limitations"). Design, permission matrix, bootstrap runbook and verification commands: [phase3/ACCOUNTS_AND_PERMISSIONS.md](phase3/ACCOUNTS_AND_PERMISSIONS.md).

**Where the work was done.** Branch `codex/phase-3-accounts-permissions`, created from `origin/main` at the Phase 2 merge commit `2d21e31`, in `C:\Users\mh978\Downloads\abdo` (the checkout that was open). The worktree held only the four local-only folders (`abdo temp/`, `blabn/`, `outputs/`, `screenshot/`), which are untracked and must stay out of commits. The first `git fetch` of the merge commit failed on leftover partial pack files; removing them and fetching `main` alone worked. Nothing was pushed.

**What was built.** Migrations `20261121000005`-`08` (employees, staff accounts, branch memberships, group assignments, catalog; audit history; administrator commands and the `app_authorize` / `app_access_context` questions; RLS policies, explicit grants, default-deny for later objects, operating-action audit triggers, a permission-checked `inventory_adjustments` skeleton); Supabase Auth sign-in, sign-out, password recovery, forced password change after a temporary password; staff screens (create, update, groups per branch, disable, reactivate, temporary password reset, per-person history) and the audit screen, in Arabic RTL and English LTR; the shared guard for pages, actions, downloads and direct requests; the first-administrator bootstrap script.

### Acceptance criteria

| Criterion (plan, Phase 3 and the task) | Result | Evidence (command, then what it shows) |
|---|---|---|
| Abdo (the synthetic admin) can create, change, disable and reactivate staff, assign several groups to one person, and see it in the audit history | **Pass** | `npm run test:phase3` section 4 and 10 (real forms and actions): six accounts created, one holds three groups across two branches, name changed, groups changed (Storekeeper and Al Quds removed, Manager added), disabled with reason (Auth user banned), reactivated (ban lifted); `staff.created/updated/access_changed/disabled/reactivated` listed with actor and before/after in `/admin/audit` and on the person's page. `npm run test:browser` repeats it in Edge in both languages (105 checks after the second audit). `supabase/tests/phase3_checks.sql` section 6 covers the commands, the last-admin and self-disable guards. |
| A cashier uses assigned workflows and is denied inventory adjustments and unassigned branches: page, direct request, protected download, database policy | **Pass** | `npm run test:phase3` section 6: daily close, cash count and the draft download work; 403 for the adjustments page, staff pages, audit, comparison, reports and `?branch=alquds|bourgogne|nowhere` in English and Arabic; `POST /api/inventory/adjustments` 403 (own and other branch); `/api/exports/daily-close-draft?branch=alquds` and `/api/exports/comparison` 403; as the cashier's own session against the database: reads Maarif days only, inventory insert `42501`, no comparison or audit rows, cannot grant themselves System Admin (no write grant), `admin_*` and bootstrap commands refused; replaying the create-staff and set-access server actions as the cashier changes nothing. `phase3_checks.sql` section 8 repeats the policy checks in SQL. |
| Removing a permission, or disabling an account, blocks the next protected request of an open session | **Pass** | `npm run test:phase3` sections 8 and 8b with one cookie jar kept open: after the group is removed the same session gets 403 on the page and the download and reads no row; restoring it restores access on the next request; after disabling, the same session is sent to sign in (page), 401 (download, direct request) and reads nothing; with the account switched off in the database only (Auth session still valid) the page ends the session, API calls are 401 and the policy returns no rows. `npm run test:browser` shows the 403 page and the redirect in two real browser sessions. `phase3_checks.sql` section 12 does the same in SQL with the same JWT claims. |
| Comparison entry does not grant viewing or exporting | **Pass** | Editor: page 403, export 403, can insert a figure for the assigned branch only (not Bourgogne, not Maarif), reads zero rows including their own figure and through `branch_daily_figures` (`test:phase3` section 7, `phase3_checks.sql` section 11); `GROUP_PERMISSIONS` and the migration give `comparison.export` to System Admin only. |
| Staff cannot alter the audit history | **Pass** | `test:phase3` section 10: cashier, storekeeper, editor, manager and kiosk read zero audit rows and cannot update; the administrator cannot update, delete or forge; the service role cannot update, delete or insert; the record stays unchanged. `phase3_checks.sql` section 14: the table owner is also refused (trigger) for UPDATE, DELETE and TRUNCATE; credential-like field names are refused; no credential or password appears in any audit record or page. |
| Cross-branch denial through page, direct request, report download, database policy | **Pass** | As in the cashier row. The report download is the minimal synthetic CSV export on the shared guard (real exports belong to Phase 9). |
| Bootstrap of Abdo, verified with a synthetic account; no real credentials in source control; production pending | **Pass (local)** | `scripts/phase3/bootstrap-admin.mjs` created `synthetic.admin@example.test` (random password, never printed); a second run is refused and leaves no Auth account; refuses a non-local URL without `--confirm-remote`; the account is forced to choose its own password. `.env.local` is ignored by Git; `.env.example` holds no values (unit test). **Production provisioning: pending.** |
| Kiosk permissions defined now, workflow later | **Pass** | `attendance_kiosk` holds only `attendance.event.create`; denied on every page, download and table in `test:phase3` section 7 and `phase3_checks.sql` section 10. |
| Maarif operational, Al Quds and Bourgogne comparison-only; existing records reused | **Pass** | No new organization or branch records; `operates_in_app` is asserted in `phase3_checks.sql` and `test:phase3` section 0; operational permissions are refused on Al Quds (even for System Admin). |
| Migration upgrade from Phase 2, fresh build, Phase 2 regression | **Pass** | `npm run db:upgrade-test`: reset to `20261121000004` + seed, Phase 2 checks and the preserved deny-all baseline check (`supabase/tests/phase2_boundary_checks.sql`, the original assertion kept at the boundary), `migration up`, seed data intact (10/2/3/3), Phase 2 and Phase 3 checks; then `db reset` and both again; the upgraded and fresh schemas, table grants and function grants are identical (1949 lines compared). `npm run db:check` (Phase 2 checks, which no longer assert the deny-all baseline) and `npm run db:check:phase3` also passed on the final fresh build. |
| Typecheck, unit tests, production build, HTTP smoke | **Pass** | `npm run typecheck` clean; `npm test` 162/162 in 11 files (76 earlier + 86 new); `npm run build` passes (all application pages are now dynamic); `npm run test:smoke` 69/69 (now signs in as a synthetic admin it creates and removes). |
| Sign-in, recovery and staff management in both languages | **Pass** | `npm run test:browser` (Edge via playwright-core, 91 checks, 0 console errors): sign-in errors, language switch, temporary password then forced change, create/update/access/disable/reactivate, audit, recovery with the real email from the local mail catcher (link, one-time code, new password, old password dead, link single-use), sign-out; `lang`/`dir`/computed direction; no horizontal scroll at 375 px on the sign-in, staff list, staff detail, new-staff and audit pages. `test:phase3` section 9 repeats recovery over HTTP and checks Arabic messages. Screenshots were written to a temporary folder and not kept in Git. |

Exact commands (local Supabase running, `.env.local` from `node scripts/phase3/write-local-env.mjs`): `npm run typecheck`, `npm test`, `npm run build`, `npm run db:upgrade-test`, `npm run db:check`, `npm run db:check:phase3`, `npm run test:concurrency` (27 checks), `npm run test:phase3` (369 checks), `npm run test:browser` (105 checks), `npm run test:smoke` (69 checks). `test:phase3` and `test:browser` rebuild the local database first (`--no-reset` skips it, but the bootstrap then needs a fresh database).

### Self-audit: what was found and fixed

Each was found while building or by the separate audit pass, fixed in Phase 3 scope, given a regression check and rerun.

1. **Per-request pages were being prerendered.** The access check's `try/catch` swallowed Next.js's dynamic-rendering signal, so the build prerendered pages as "authorization unavailable". Fixed with `connection()` before the `try`; the build now lists every page as dynamic.
2. **Recovery link opened the wrong host in a real browser.** The callback redirected using the request URL (`localhost`) while the session cookie belongs to `127.0.0.1`; the person landed on sign-in. Found by the browser run, fixed by building redirects from `SITE_URL`; browser recovery now passes in both languages.
3. **Duplicate email on update returned a generic error.** Supabase Auth answers a duplicate with a bare 500. Fixed by checking staff records first and mapping the bare error; `test:phase3` section 10b now checks the refusal and that both records keep the old email.
4. **Audit history showed a time of day without a date.** Fixed with a date-and-time formatter for the audit screens.
5. **Seed test failed on a CRLF checkout.** `core.autocrlf=true` writes `seed.sql` with CRLF, so the Phase 2 seed test (and `seed:check`) failed on the untouched baseline too. Both now compare content with line endings normalized.
6. **Local stack left half-stopped by an interrupted run** (environment, not code): `supabase stop`/`start` restored it, then the whole suite was rerun from clean; the results above are from that rerun.
7. **The two guard tests have teeth.** Mutations of the SQL (open the select policy, drop the audit trigger, open comparison insert, `has_permission` always true, grant update on audit) each failed `phase3_checks.sql`; mutations of the application guard (skip the database permission check, ignore the forced password change) each failed `tests/guard.test.ts`. The mutated code was reverted.
8. **Added after the review of my own coverage:** password reset by the administrator, email change keeping Auth and the staff record in step, sign-in "return to" address (another site, protocol-relative, other language ignored), a server action posted from another site (refused by Next.js), and a valid Auth account with no staff record (cannot sign in, holds no session).

### Second independent audit (21 November 2026): two findings, fixed

Both were real defects in the first Phase 3 delivery. Each is fixed by the forward migration `20261121000009_password_gate_and_admin_serialization.sql` (migrations 05-08 are unchanged) and the application code, with regression coverage at the database, HTTP and browser levels.

**Finding 1: the temporary-password requirement was enforced only in Next.js.** A new, bootstrapped or administrator-reset account is flagged `must_change_password`, but PostgreSQL still authorized it: a valid JWT used directly against the Data API passed every policy and command (reproduced first: on a database at migration 08 a flagged cashier read all 10 business days). Also, `app_complete_password_change()` cleared the flag on request, so a flagged person could release themselves without changing the password.

| Part | Fix | Evidence |
|---|---|---|
| Deny at both layers | `effective_permissions()` and `can_see_branch()` return nothing for a flagged account; the catalog policies need `access_cleared()`. Every policy, `admin_*` command and `app_authorize` therefore refuses it. It keeps `app_access_context()`, `app_complete_password_change()`, its own account rows and the password page; the Next.js guard still sends it to `/account/password`. | `phase3_checks.sql` sections 5b and 6b (flagged administrator and cashier: no permission, no rows, no write, commands refused, own row readable); `test:phase3` `flaggedChecks` on first sign-in of the administrator and of all six staff, on an administrator-issued temporary password, on a recovery session, and on a flag set while a session is open (page redirect, download 403, database reads empty, write 42501, `app_authorize` false, `admin_*` refused). |
| Release only after a confirmed change | The flag stores a SHA-256 fingerprint of the Auth password hash taken when it was set (never the hash; not readable through the API: column-level grant). The completion command clears the flag and writes the `account.password_changed` audit record only when Auth now holds a different hash; otherwise `password_not_changed`. | SQL: release refused without a change; a changed hash alone audits nothing until the person confirms; completion audited once; asking again audits nothing. HTTP: right after a real sign-in the release is refused (so Auth does not re-hash on sign-in); after the real change through the form the flag and fingerprint are cleared and exactly one completion is audited. |
| First sign-in, admin reset, recovery | All three verified end to end. | `test:phase3` sections 2, 5, 10b: the temporary password signs in and is held at the password page; an administrator reset ends the person's open sessions (Auth revokes them), the new temporary password is held at the password page, the previous password stops working; recovery of a flagged account (real email, link, one-time code) releases it only after the new password, the temporary password then fails, one more completion is audited. `test:browser` repeats first sign-in, administrator reset (session ended, sign-in with the temporary password, every page held at the password page until a password is chosen) and recovery in both languages. |
| Upgrade path | Accounts flagged when the migration runs are fingerprinted. | `db:upgrade-test` section D: reset to migration 08, a flagged account, the gap reproduced (10 days visible), `migration up`, the account fingerprinted and refused (0 days), SQL checks pass, schema, table, column and function privileges equal the fresh build. |

**Finding 2: two administrators could disable or demote each other at the same time and leave none.** Each command checked "another active System Admin remains" inside its own transaction, so two overlapping transactions each saw the other still active and both committed (reproduced: 0 active administrators in every round).

| Part | Fix | Evidence |
|---|---|---|
| Serialize | `require_admin()`, called first by every `admin_*` command, takes a transaction-scoped advisory lock per organization (`pg_advisory_xact_lock`). The bootstrap takes the same lock. | `npm run test:concurrency` (27 checks): real overlapping `authenticated` transactions, each held open while the others start. Two administrators disabling each other, removing each other's group, one disabling while the other removes the group, and a three-administrator ring, 3 rounds each in separate organizations: at least one active System Admin remains every time and the loser is refused. A sequential control is refused by the last-admin rule. |
| Re-check the caller inside the lock | After the lock the caller's `admin.users.manage` is checked again (the caller may have been demoted or disabled while waiting), then the last-active-admin rule runs in the same transaction. | The losing transaction is refused with `permission_denied` (the caller is no longer an administrator) in every round. |
| The test has teeth | `node scripts/phase3/concurrency-test.mjs --prove-failure-without-lock` puts the pre-fix `require_admin()` back and the test fails in every round with 0 active administrators; `npx supabase db reset` restores the migrations. | Run and recorded; the suite below was run afterwards on the restored database. |

**Self-audit after the two fixes** (a separate pass over the new code and tests):
- *Found and fixed:* `staff_accounts` was readable through the API, so `password_fingerprint` (a digest of the hash) was visible to the person and to the administrator. Column-level grant added; checked in SQL (`has_column_privilege`), over HTTP for the cashier and the administrator, and in the schema comparison (column privileges are now compared).
- *My own test expectations corrected, not product changes:* an administrator password reset through the Auth admin API also ends the person's open sessions (stricter than first assumed); a made-up fingerprint is not a valid way to flag an account in a test (the administrator command is used instead).
- *Mutation checks:* making `effective_permissions()` ignore the flag fails `phase3_checks.sql`; making the completion skip the fingerprint test fails it; the static tests in `tests/access-architecture.test.ts` pin the lock, the re-check, the fingerprint wherever the flag is set, and the release order.
- *Follow-up audit fix:* staff sign-in email changes go through the audited administrator workflow. A forward migration blocks self-service Auth email changes for staff and prevents the directory from storing an address that differs from Auth. The same migration reconciles and audits older directory records whose confirmed Auth address already changed.
- *Follow-up request check:* the inventory JSON endpoint compares the full browser origin with the configured `SITE_URL`, including the scheme. The regression check covers a mismatched origin even when the forwarded host matches it.

### Final verification after the follow-up audit

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 162/162 in 11 files |
| `npm run build` | passes |
| `npm run db:upgrade-test` | Pass. Phase 2 boundary and upgrade, 10-migration fresh build, matching schema and grants, and migration 08 upgrade with a flagged account and a reconciled and audited email. |
| `npm run db:check` (Phase 2 regression) and `npm run db:check:phase3` | pass |
| `npm run test:concurrency` | 27/27 |
| `npm run test:phase3` (HTTP) | 372/372, including the audited administrator email change and denial of staff self-service email changes. |
| `npm run test:browser` (Edge, Arabic and English) | 105/105, no console errors |
| `npm run test:smoke` | 69/69 |
| `npm run seed:check` | Pass. |

The follow-up audit reran the suite on a disposable local Supabase project with synthetic accounts. The four existing Docker workloads continued running.

### Remaining limitations and decisions

- **Production**: no hosted Supabase project, SMTP provider or real Abdo account was used or created. Provisioning, the Auth settings in `supabase/config.toml` (sign-ups off, 10-character minimum, redirect URLs) and `SITE_URL` must be set on the hosted project; recovery emails were checked only through the local mail catcher.
- **403 pages**: the status is a real 403, but Next.js sends its error shell and the browser renders the "access denied" content from the response payload (the root layout is the dynamic `[locale]` segment). The HTTP checks assert the status and the message text in the payload; the browser checks assert what is shown. Requires `experimental.authInterrupts` in `next.config.ts`.
- **Verified in Edge only**; layout checked at 375 px in the browser pane engine, not on a physical phone or Safari. Arabic wording of the new screens has not been read by a native reviewer other than the project owner.
- **Comparison data**: entry is insert-only (an update would need the row to be readable, which the editor must not be able to do); corrections and revision history arrive with Phase 7. The comparison page and export need `comparison.view` / `comparison.export` for every branch; per-branch columns are Phase 7.
- **Audit scope**: rows are written by the administrator commands, the bootstrap command and the operating-table triggers for signed-in people. Direct service-role writes are not audited by the triggers; a database owner can still disable triggers.
- **Real exports, daily-close writes, stock movements**: the CSV downloads and the adjustment screen are minimal guarded skeletons on synthetic data; the real workflows are Phases 4, 6 and 9. `inventory_adjustments` is a skeleton table that Phase 6 extends.
- **Disabling removes Auth sessions** with a privileged delete that is skipped quietly if the database owner may not touch the `auth` schema on a hosted project; the live checks refuse every request regardless, and the Auth user is banned by the server.
- **Phase 4 carry-over unchanged**: the Casablanca time-zone follow-up and the daily close and cash-ledger work stay in Phase 4.

## Questions for Abdo

The six review answers are in the [decision summary](phase1/decisions/DECISIONS_SUMMARY.md). Save further operational questions for the phase that uses them.

**Phase 4 answers are recorded.** Abdo counts the drawer as branch manager. The normal business-day cutoff is 02:00 local time. An overnight sale at 01:00 and a late close of that business day belong to the prior operating date. Abdo closes, corrects and approves his own corrections, and the branch takes cash and card. See the [implemented workflow](phase4/OPERATING_CLOSE.md).

The [22 November voice-note decisions](ABDO_WORKFLOW_DECISIONS.md) record the approved Dubai cake alias, mixed nuts in kilograms, the source for six spoons in the November large Bazabizo Mango recipe, daily and monthly inventory counts, and the historical order date as expected receipt.

- **Phase 5 (implemented):** the November recipe start date is still open and gates the affected versions. See "Pending decisions and open items" under [Phase 5 status](#phase-5-status).
- **Phase 7:** confirm the live source and entry owner for Al Quds and Bourgogne.
- **Phase 10:** run the walkthrough with Abdo and record his acceptance.
- **Phase 11:** Abdo can supply the current sheets at handover. Confirm the first live date and approved opening data then.

## Work completed

Session 1 (19 Nov, audit): extracted and recalculated every workbook (984,217 formulas, 0 differences); reviewed photos, transcription, video, outputs, archive, mock-ups; wrote 37 findings; built the review page, local save server and import script.

Session 2 (19 Nov, triage): classified findings, added SRC-13/14, applied corrections to copies, rebuilt the page for 2 questions. Its "35 of 37 resolved" and "54,212" figures were later found to be overstated / a hand-addition error.

Session 3 (20 Nov, read-only recheck): found partial fixes, unproven changes and no way for Abdo to object.

Session 4 (20 Nov): reverted unproven changes (P1-03, P1-08 weekly, P1-10, P1-31 nuts, P1-36 D38); applied evidence-backed residual fixes and the ledger corrections on unprotected sheets; added the cell-by-cell diff, boundary tests and independent/construction check basis; reclassified all findings; made every finding answerable on the page.

Session 5 (20 Nov):

1. **Reverted the P1-29 Kinder Dubai cake quantity** (SRC-13 `'7'!F327` back to 12): the workbook row says «صغيرة» while Foodics says «كبير», so the mapping is unconfirmed. The statement "no correction is applied on an assumption" was not true until this revert; it is now. P1-29 became a required question with the exact figures; the 7 Nov workbook total is 2,192 against Foodics 2,182 (difference = this line).
2. **Kept the Foodics quantity as evidence**: the corrected transcription now lists the 8 Product Mix lines compared with the workbook (name as read, quantity, amount, workbook cell, original workbook quantity, mapping confirmed/unconfirmed). It is generated by `correct_transcription.py` from the unchanged original.
3. Reapplied the November inventory copy; reran the diff (0 unexplained), boundary tests (22/22) and value checks (65/65; the 7 Nov check now expects Foodics 2,182 + the unconfirmed 10).
4. **Built the report field map** (`build_field_map.py` → `field-map.json`, `FIELD_MAP.md`): 54 fields of the five report families with legacy location, meaning, source record, unit, date basis, rounding, blank behaviour, linked findings, status and phase; status is recomputed from recorded answers. Every finding is linked to a field or listed with its reason (P1-01, P1-02).
5. **Owner deferral and closure records**: `decisions/owner-deferrals.json` (protected ledger corrections: pending), `decisions/agreed-outcomes.json` (final rules for contested findings; Abdo's final-set confirmation), `record_outcome.py` to write them, `phase1_status.py` → `CLOSURE.md`. The whole flow (answers → contested finding → agreed rule → deferral → confirmation → "can close") was tested on a scratch copy; the repository records are unchanged.
6. **Trial page for Abdo's device**: `abdo-review-trial.html` (orange trial banner, its own browser storage, no server, answers file `abdo-TRIAL-decisions-….json` marked `trial`); the import script refuses trial files except `--trial` into a scratch folder. Both pages now show how many saved answers have not been downloaded yet, and warn when the browser cannot save. Trial steps and the explanation of how answers are saved and returned: [TRIAL.md](phase1/TRIAL.md).
7. Updated the plan, decisions, README files and this record.

Session 6 (20 Nov, this session): rebuilt Abdo's review page so he can understand and answer only the seven required questions.

1. **Content file**: `docs/phase1/review-questions.json` holds the customer wording of the seven questions (numbered 1-7; internal finding IDs stay in the data only). Each has: where it is (original Arabic workbook name, actual tab, cells), what is recorded now, why it needs attention, the proposal (short numbered steps, with a before/after example or a small table where it helps), one direct question, and its answer options. `build.mjs` rejects finding IDs, source IDs, code, JSON or formula chains in that text, requires exactly the seven `required` findings, and requires every question to offer the four standard answers (one of them «مش متأكد / محتاج أراجع») and an alternative that requires text.
2. **Original Arabic workbook names**: SRC-12 and LOC-01 keep their names in the repository/inventory. For the other workbooks the original names were found in the local legacy index (`archive/legacy/analysis/analysis/workbook_index.json`, not in Git) and matched to the repository files by sheet names and cell contents (12 of 12 heading cells; SRC-05 by month and sheet count). The two Daily Sales workbooks have English original names («Daily Sales Maarief oct.xlsx», «Daily Sales Maarief  NOV(1).xlsx», two spaces as recorded). The order workbook's recorded name starts with the number: «11 طلبية فرع المعاريف شهر (1).xlsx». Tab names are shown as they are («Sheet1», «مبيعات شهر 6», «مبيعات شهر 8», «2», «4», «7»). The inventory day sheets and the ledger sheet «2» carry no date of their own: «7» is identified as 7 Nov because its figures match the Foodics print; «4» as 4 Nov by the numbering of the month's sheets; ledger «2» as 2 Nov because the statement sheet «2» of the same day carries that date. The page says so.
3. **Location check**: `scripts/phase1/review/verify_questions.py` re-reads every cited tab, cell and figure in the original workbooks, the corrected copies and the transcription, plus the arithmetic the questions quote (sums, growth rates, weekdays, and the 24 + 2 + 3 + 1 pattern of the October averages). 182 of 182 pass; the two photo readings (Foodics lines) are recorded as manual checks; the repository copy of the November inventory is byte-identical to the local original. It corrected one wrong earlier claim: the finding text said received items per day ranged 28-42; the full count for 1-13 Nov is 28-44, and the page only says "28 items at least".
4. **New answer model**: each answer is `{choice, option, extras, comment, saved_at, history}`. `choice` is accept / alternative / keep / **unsure**; `option` is the specific answer on that question (for example `before_remittance`, `bourgogne_3_nov`, `delivery_day`); `extras` holds the optional yes/no answers (counted every day? daily deliveries?). «مش متأكد / محتاج أراجع» is saved but counts as unanswered everywhere (page progress, import summary, field map, closure). A fully specified alternative (for example "Bourgogne figure is for 3 Nov") needs no extra agreed rule; free-text alternatives do (`needs_agreement`). Alternatives that name a specific answer or free-text options require text where marked.
5. **Shared rules**: `scripts/phase1/review/decision-rules.mjs` validates and merges answers for both the local server and the import script (the page carries an identical merge). Answers for any of the 37 finding IDs are still accepted and kept, and answers saved by the earlier page (no `option`) keep their history and show as the first option of the same kind; nothing saved earlier is lost. Browser storage keys are unchanged.
6. **Field map and closure follow the new answers**: `build_field_map.py` and `phase1_status.py` read the option metadata; unsure = waiting; a complete answer (accept, keep, a specified alternative) settles the field; a free-text alternative stays contested until `record_outcome.py agree`.
7. **Page**: three-step usage guide (the exact wording requested) with an accurate note on where answers are saved and how they reach the team; numbered list of seven questions with status; per-question sections (مكانها / المسجل حاليًا / الفروق / ليه محتاجة انتباه / المقترح / سؤالنا ليك); answer controls with a concrete line under each standard answer; text field whose label becomes «مطلوب» when the chosen answer needs text; «حفظ الإجابة»; progress «تم الرد على X من 7» with «محتاج أراجع: N» and the unsent count; «تنزيل ملف الردود». On phones the header is not sticky and the question list opens from a button.
8. **Docs**: plan, decisions, READMEs, TRIAL.md and the register text now say the page shows only the seven questions.

Session 7 (20 Nov, project-owner confirmation of the source photo):

1. The project owner read the 7 November photo and confirmed the exact fourth-section spelling «دنيا البمبوظه». P1-02 is now a verified source-transcription correction. The corrected transcription records who confirmed the label and when.
2. Removed the general transcription-approval question from Abdo's page and renumbered the remaining six questions. Existing saved answers remain valid through retired-question metadata.
3. Rebuilt the real and trial pages, findings register, field map, decision summary, and closure checklist. The full register still contains 37 findings, with 15 verified corrections and five pending-decision findings. Six questions remain required because two partial findings also need Abdo's answer.
4. The confirmation belongs to the project owner. The original owner-approval field retains its provenance, and Abdo's answer record remains empty.
5. Verified all 169 source-location checks for the six current questions, parsed both generated pages, and checked their embedded question order. Existing P1-02 option responses still validate. The original transcription hash remains `409F0A285C78701338B3E15331A776BBB1150F64E2D335143CE3A27774AB6585`. Browser behavior on Abdo's device remains part of the device trial.

Session 8 (21 Nov, applying Abdo's answers):

1. **P1-10 weekly dates** (Abdo: Bourgogne's figure is for 10 Nov; one date pair). Verified the cells in the original and the copy first: total current `E6` 9 Nov, total prior `I6` 2 Nov, Bourgogne current `AL6` 3 Nov; Al Quds `P6/T6`, Maarif `AA6/AE6` and Bourgogne prior `AP6` already 10/3 Nov. Set `E6` = 10 Nov, `I6` = 3 Nov, `AL6` = 10 Nov in `source-material/corrected/weekly-comparison-nov-2026.xlsx`. All four date pairs are Tuesdays, matching their «الثلاثاء» labels. No sales, order or ratio figure changed.
2. **P1-08 weekly ratio kept** (Abdo kept the current/prior ratio): ratio cells `A6/L6/W6/AH6` and header «نسبه %» unchanged. Monthly comparisons keep the growth correction (their column is titled growth).
3. **P1-03 average order value** (Abdo accepted net sales ÷ orders): Daily Sales Oct/Nov copies `D3:D33` = `IF(N(C)=0,"",ROUND(B/C,2))`, replacing the typed values (October's were ÷ 1.1). Examples: 1 Oct 72.10 → 79.31; 2 Nov 76 → 76.21; 31 Oct now 86.72. The original workbooks keep the typed values.
4. **P1-13 cash count before remittance**: recorded as an application rule (expected cash = movements before the count; the 2 Nov reference gives +3 MAD, which the statement copy already shows). No copy change. The prepared ledger message rewrite (`O14` on every day sheet, 62 protected-sheet operations under P1-12) compared the count with the balance after the remittance, which this answer rules out, so it was **withdrawn** from the plan. The protected-sheet set is now 318 operations, not 380; `owner-deferrals.json` keeps a dated note of the change and its status is still `pending`.
5. **P1-29 Kinder quantity kept at 12** (Abdo's answer). The Foodics figure 2 stays as evidence in the corrected transcription; the 7 Nov workbook total stays 2,192 against Foodics 2,182. Size mapping remains Phase 5 catalog work (P1-28).
6. **P1-35** was deferred during the original review. Abdo subsequently confirmed the legacy expected receipt date in the [22 November voice-note decisions](ABDO_WORKFLOW_DECISIONS.md#phase-8--legacy-order-date). His workflow (night orders, delivery two days later, daily deliveries) is recorded as the application rule.
7. **Records**: `set_status.py` (findings `2026-11-21.1`: P1-03, P1-08, P1-10, P1-29 verified; P1-12, P1-13 rules; P1-35 deferred), `gen_fixes.py`, `fix-plan.json`, `CORRECTIONS.md` and `corrections-log.csv` (4,400 operations: 4,082 applied, 318 pending), `FINDINGS.md`, `field-map.json`/`FIELD_MAP.md`, `DECISIONS_SUMMARY.md` (retired P1-02 now labelled "retired" instead of "undefined"), `CLOSURE.md`, `docs/DECISIONS.md`, `docs/phase1/README.md`.
8. **Checks**: `verify_fixes.py` gained a third basis, *decision*, for values that follow Abdo's recorded answers (and stops with an error if those answers change). `boundary_tests.ps1` gained four average-order tests (blank orders, zero orders, 1,000 ÷ 3 = 333.33, zero sales with orders = 0).
9. **Final confirmation**: [ABDO_FINAL_CONFIRMATION_AR.md](phase1/ABDO_FINAL_CONFIRMATION_AR.md) holds a short Egyptian Arabic summary of the six points for Abdo, with the command to record his reply. Not sent; nothing recorded.

### Phase 2 session (21 Nov): what works

1. **Foundation.** Next.js 16 (App Router), React 19, TypeScript (strict), Vitest. Pages under `/ar` and `/en`; `html lang` and `dir` follow the locale; an unknown locale is a 404. Translations in `src/i18n/messages/{ar,en}.json` with identical keys (a test enforces it). The language is saved in the cookie `balaban-locale` (one year) when a page is opened, not on background prefetches; `/` and unprefixed links go to the saved language (default Arabic); the switch is a plain link that keeps path and query. MAD and dates are formatted in one place (`src/i18n/format.ts`) with Western digits in both languages.
2. **Structure.** `src/modules/` holds access, closing, comparisons, reports (working) and ledgers, catalog, inventory, replenishment, attendance (README placeholders naming the phase that fills them). Calculations are server-only (`server-only` import, tested). Screens read synthetic fixtures through a repository interface (`src/lib/repository.ts`); a Supabase-backed repository is a Phase 4 task. Money is integer centimes; blank is `null`, never 0; ratios are basis points.
3. **Prototypes** (synthetic data, a banner says so): `/daily-close` (month table DS-01..DS-10, day detail, movements), `/cash-count` (saved count, movements after the count, a preview form, ST-09/LG-08 marked pending Phase 4), `/comparison` (weekly, missing figures marked, coverage shown on incomplete totals), `/reports` (the 54-field map, pending fields marked). Each value carries `data-field` (field ID) and `data-record` (saved record).
4. **Database** (checked on local Supabase). `supabase/migrations/20261121000001..3` (organizations, branches with timezone check, business days, cash movements, cash counts with variance check, comparison figures, view `branch_daily_figures`); row-level security on, API roles have no grants until Phase 3 policies. `supabase/seed.sql` is generated from the same fixture (`npm run seed:build`; a test fails if it drifts). `supabase/tests/phase2_checks.sql` asserts RLS, row counts, blank vs zero, the 600/603/+3 recalculation, business-date agreement, the weekly 120%, constraint rejections and anon denial. Passes on the local database.
5. **Synthetic examples.** Cash count: expected 600.00, counted 603.00, variance +3.00 on 2 Nov, still +3.00 after the later 500.00 deposit (the screen shows the stored variance and the drawer after later movements, 103.00). Weekly comparison: Maarif 120 vs 100 shows 120%; Bourgogne's missing current figure is marked, not 0, and the total shows 2 of 3 branches.
6. **Not touched:** the originals, the Phase 1 records, and Abdo (no contact; Phase 1 not reopened). Phase 3 has not started.

## Files created or changed

| Path | Purpose |
|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.mts`, `.gitignore` | Phase 2 toolchain and scripts (`dev`, `build`, `typecheck`, `test`, `test:smoke`, `seed:build`, `seed:check`, `db:check`, `check`). |
| `src/app/`, `src/components/`, `src/i18n/`, `src/proxy.ts` | Localized pages, shared components, translations and formatting, language routing and persistence. |
| `src/lib/`, `src/modules/` | Money and date helpers, repository, server-side calculations, report contracts and tracing, module placeholders. |
| `fixtures/synthetic/phase2.json` | Synthetic test data (3 branches, 10 days, movements, counts, comparison figures). |
| `supabase/config.toml`, `migrations/` (four, the last is the audit fix), `seed.sql`, `tests/phase2_checks.sql` | Local development database baseline (ports 55xxx, project `balaban-dev`). |
| `scripts/phase2/*`, `tests/*` | Seed generation, database check runner, HTTP smoke test of the production build, 76 unit tests (see "Phase 2 audit fixes"). |
| `docs/phase2/REPORT_CONTRACTS.md` | Report contracts (earlier Phase 2 work). |
| Phase 3 migrations (05–09 and the staff email integrity migration), `supabase/tests/phase3_checks.sql`, `phase2_boundary_checks.sql` | Phase 3 schema, policies, grants, audit; SQL checks and the preserved Phase 2 deny-all baseline check. |
| `src/modules/access/*`, `src/app/[locale]/{sign-in,forgot-password,account,admin,inventory}`, `src/app/api/*`, `src/lib/supabase/{config,server}.ts`, `src/proxy.ts` | Sign-in, staff screens, audit screen, shared guard, protected downloads and routes, session refresh. |
| `scripts/phase3/*`, `tests/{guard,access-*}.test.ts`, `docs/phase3/ACCOUNTS_AND_PERMISSIONS.md` | Bootstrap, migration, HTTP and browser checks; unit and architecture tests; Phase 3 runbook. |
| `docs/HANDOFF.md` | This record. |
| `docs/phase1/README.md`, `TRIAL.md`, `CLOSURE.md`, `ABDO_FINAL_CONFIRMATION_AR.md` | Phase 1 guide, device trial and save/return explanation, closure checklist (generated), final-confirmation message for Abdo (not sent). |
| `docs/phase1/findings.json`, `FINDINGS.md` | Findings with status, questions, done and remaining (version `2026-11-21.1`). |
| `docs/phase1/FIELD_MAP.md`, `field-map.json` | Report field map (generated). |
| `docs/phase1/CORRECTIONS.md`, `corrections-log.csv` | Changes with previous values and status; what was left unchanged on purpose. |
| `docs/phase1/corrected-diff.json`, `corrected-verification.json`, `boundary-tests.json` | Diff, value checks and boundary tests. |
| `docs/phase1/SOURCE_COVERAGE.md`, `source-inventory.json`, `recalc-comparison.json` | Coverage and recalculation evidence. |
| `docs/phase1/review-questions.json`, `review-locations-check.json` | Customer wording of the six current questions, retired-question metadata for validating existing answers, and the result of checking cited locations (generated by `verify_questions.py`). |
| `docs/phase1/review/abdo-review.html`, `abdo-review-trial.html` | Abdo's page (six questions) and its trial copy (generated). |
| `docs/phase1/decisions/*` | Abdo's six answers, summary, CSV, owner deferrals (ledger edits: pending; legacy order date: deferred to Phase 8), agreed outcomes (none needed). |
| `source-material/workbooks/inventory-nov-2026-days-1-13.xlsx` (SRC-13), `inventory-review-template-nov-2026.xlsx` (SRC-14) | New tracked sources (byte-identical copies of LOC-01/LOC-02). |
| `source-material/corrected/*` | 13 corrected workbook copies + corrected transcription (about 27 MB; SRC-13 adds 12.5 MB). |
| `scripts/phase1/*` | Extraction, checks, recalculation, coverage, field map, outcome recording, closure checklist; `fixes/` (plan, apply, diff, boundary tests, verify, status, transcription, corrections record); `review/` (page template and build, `decision-rules.mjs`, server, import, `verify_questions.py`). |
| `docs/IMPLEMENTATION_PLAN.md`, `docs/SOURCE_MATERIAL.md`, `docs/DECISIONS.md`, `README.md`, `.gitignore` | Phase 1 method, status rules, acceptance checks, source IDs, status. |

## Assumptions and limits

- No correction in the copies rests on an assumption. The P1-03 averages and P1-10 dates now follow Abdo's recorded answers; values his answers do not establish stay as recorded (P1-31 units, P1-32 recipe date, P1-36 D38, the P1-29 Kinder line by his choice).
- P1-29: the 7 Nov Foodics print is the source for that day's sales quantities (lines and sections reconcile to net sales). Five lines were applied where the names match or the line is the only one of its kind on both sides; the pecan line where the workbook's own recipe identifies row 202.
- P1-16: the 29 Oct statement sheet is a reconstruction from the ledger and Daily Sales, not an original document.
- Ledger day sheets are password-protected. The 318 operations and their workbook-specific boundary tests are deferred. Six error cells remain in hidden legacy ledger sheets whose original references are lost.
- The field map describes source records in requirement terms; table and column design is Phase 2. Template layout and labels are retained as confirmed when Abdo confirms the final set.
- Recipes, Foodics-name mapping and units are Phase 5 catalog work. No independent source exists for September sales, Al Quds/Bourgogne figures, or Maarif on 3/10 Nov; only 7 Nov has a Foodics print.
- The Phase 1 review page contains the six questions imported at closure. P1-19 was answered later and is tracked in the Phase 4 decision record. Add still-open questions to the review page or record their answer directly when the relevant phase needs them.
- The Arabic wording is in the colloquial register of the earlier pages and has not been read by a native reviewer other than the project owner; Abdo's feedback in the trial is the check.
- The original Arabic workbook names come from a local legacy index and a content match, not from the repository (which renamed the files to English). If Abdo's own file names differ, correct `files` in `review-questions.json`, rerun `verify_questions.py` and `build.mjs`.
- Phase 2 fixture assumptions: the fixtures treat non-card sales as cash and use a 00:00 rollover. For live Phase 4 work use the [confirmed cash/card workflow and 02:00 rollover](phase4/ABDO_DECISIONS.md). The weekly total ratio is left blank when the branches present on the two dates differ (Phase 7); synthetic Al Quds and Bourgogne figures are reporting-only and invented.
- Phase 2 limits: screens read fixtures, not the database; no sign-in or permissions (Phase 3); the Arabic wording of the prototypes has not been read by a native reviewer; layout checked at 375 px and a desktop pane (about 800 px wide), not on a physical phone; the language-persistence check in a real browser covered Arabic ↔ English and `/` redirect.
- Open plan decision (Decisions needed before Phase 1, Abdo and project owner): whether a finding may be deferred with an interim rule, owner and deadline. The statuses and the closure checklist assume it may for later-phase questions.

## Checks performed

| Check | Result | Not established |
|---|---|---|
| Excel recalculation of originals vs cached values | 984,217 / 984,217 equal | — |
| Cell-by-cell diff of 13 corrected copies vs originals | 0 unexplained cell or sheet changes | Whether each intended edit is right |
| Value checks (`verify_fixes.py`, 21 Nov) | 71/71 pass: 26 independent, 37 construction, 8 decision | Construction checks do not prove the chosen values; decision checks prove agreement with Abdo's answers, not the answers |
| Excel boundary tests (`boundary_tests.ps1`, 21 Nov) | 26/26 pass, including the average order value with blank and zero orders | Ledger calculations (protected); weekly comparison (only dates changed) |
| Cell-by-cell diff after applying the answers (21 Nov) | 0 unexplained; SRC-12 shows exactly the three date cells plus the earlier stray-cell clears; SRC-02/03 the average column | — |
| Excel error cells | 11 copies 54,206 → 0; ledgers 89 → 85 | — |
| Originals untouched | `git diff` shows no change under `source-material/workbooks/` (only the two new SRC-13/14 files); the original transcription is unchanged | — |
| Field map builder | Every finding linked or explained; pending fields follow recorded answers and agreed rules | Phase 2 report contracts |
| Closure flow on a scratch copy | Open with no answers; still open with a contested answer; "can close" after the agreed rule, ledger deferral and final confirmation | — |
| Real page via local server and browser (session 4) | Any finding saves; alternative needs text; unknown id rejected; history kept; reload keeps answers | — |
| Trial page served as a static file at 375 px (no server, like Abdo's device) | Trial banner; required question shows the Kinder figures; answer saves; "1 رد لسه ما اتبعتش" shown and cleared after download; downloaded file named `abdo-TRIAL-…`, marked `trial`, with the answer; real page unaffected by trial answers; no horizontal scroll | Safari/iPhone; a browser that blocks storage (banner path not run on a device) |
| Import guard | Trial file refused for the real record; `--trial` needs a scratch `DECISIONS_DIR`; imported there correctly | — |
| Seven-question page (session 6) | Exactly 7 numbered questions in the list and navigation; every question shows location, current figures, reason, proposal, one direct question and its options; guide shows the three requested steps | Abdo's own reading of the Arabic |
| Verified locations (`verify_questions.py`) | 169/169 for the six current questions; each workbook, tab, cell and quoted figure matches the original files; 1 photo reading manual | Photos are not machine-read |
| Answers in the page (served by the local server and as a static file) | An alternative without text is refused; options that need text are refused without it; «مش متأكد» saves, stays «محتاج أراجع» and is not counted; extras save; answers and extras survive reload; history keeps replaced answers; legacy answers from the earlier page keep their history and appear in the export | — |
| Export / import | The downloaded file equals the server record; importing it into a scratch folder reproduces every answer, option, extra, text and history entry; invalid entries are rejected (option of another choice, missing text, unknown extra value, unknown option, unknown finding); the page's own import rejects the same | — |
| Trial separation (static file at 375 px) | Trial answers sit under their own key, the downloaded file is `abdo-TRIAL-…` marked trial, the real page does not show them and refuses a trial file, and the trial page refuses a real file | Safari/iPhone |
| Phone layout (375 px) | No horizontal scroll on the introduction or any question; the table scrolls inside its own box; list opens from a button; 16 px text | A real phone |

Trial answers went only to scratch files and cleared browser storage.

### Phase 2 checks (21 Nov, in `blabn`)

| Check | Result | Not established |
|---|---|---|
| `npx tsc --noEmit` | Pass, no errors | — |
| `npx vitest run` | 74/74 pass in 7 files: money and dates, closing calculations (600/603/+3 and later deposit), comparisons (120 vs 100 = 120%), services, translations (same keys in both languages), architecture (client code imports no modules, server-only markers, language routing), seed equals generator output | — |
| `npx next build` | Pass; 12 static pages generated | — |
| `node scripts/phase2/smoke.mjs` (production build over HTTP) | 55/55 pass: language routing and cookie, `lang`/`dir` on 10 pages, switch keeps path and query, labels, cash-count example in both languages, daily-close and comparison examples, 54 fields with 6 pending | — |
| Browser pane, 375 px, 8 page/language combinations | No horizontal scroll on any; `dir` correct (`rtl`/`ltr`); Arabic and English cash-count screens read correctly; tables scroll inside their own box | A physical phone |
| Browser pane, desktop width | English comparison screen shows 120.00 / 100.00 and the Missing badge for Bourgogne | — |
| Language persistence in the browser | Switching to Arabic then opening `/` lands on `/ar`; switching back to English then `/` lands on `/en` | Safari/iPhone; blocked cookies |
| `npx supabase start`, then `npx supabase db reset`, then `npm run db:check` (local PostgreSQL 17.12) | Migrations and seed apply on a fresh database and again after a reset; `phase2 database checks passed` both times (RLS on every table, API roles without access, row counts 3/10/5/2/3, blank vs zero, 600/603/+3 and the later deposit, business-date agreement, weekly 120%, constraint rejections, anon denied) | Policies (Phase 3); a hosted Supabase project; real-world time-zone data (caveat above) |
| Final rerun after the database fix (21 Nov) | tsc clean; 74/74 tests; production build passes; 55/55 smoke checks; `source-material/workbooks/` unchanged apart from the two Phase 1 files already recorded | — |

### Phase 2 audit fixes (21 Nov): cash-count variance pair and amount range

Two audit findings on the cash-count prototype were fixed after Phase 2 was first marked complete. Phase 2 stays complete; these results supersede the counts above (tests 74 → 76, smoke checks 55 → 69, migrations 3 → 4).

1. **Database: expected cash and variance are a pair.** Migration 2 allowed `expected_cash` with a NULL `variance`, because a CHECK that evaluates to NULL passes. The new forward migration `supabase/migrations/20261121000004_cash_count_reconciliation_pair.sql` replaces the constraint `variance_matches_expected`: both columns NULL (unreconciled count), or both present with `variance = counted_amount - expected_cash`. Migration 2 itself is unchanged so databases that already ran it receive the fix by migrating forward. Adding the constraint validates existing rows, so it fails loudly on a database holding an inconsistent count (the seed and fixtures are consistent).
2. **Cash-count preview: amount range.** `parseMadInput` in `src/lib/money.ts` now rejects any amount whose magnitude is above 999,999,999,999.99 (`MAX_MINOR`, 99,999,999,999,999 centimes, the `numeric(14,2)` limit) with `undefined`, which the preview already shows as the localized "Enter a valid amount in MAD" message. The digits are checked before any number conversion, so a 400-digit input is rejected without overflowing a JavaScript number; leading zeros do not count as digits. Blank stays blank, an explicit `0` (and `-0`, now normalized to 0) stays a real zero, and the English and Arabic formats (Western or Arabic-Indic digits, `.` `,` `٫` and spaces) still work. A negative amount inside the range still shows the existing negative-amount message; a negative one beyond the range shows the invalid-amount message.

| Check (21 Nov, after the fixes) | Result |
|---|---|
| Old gap reproduced first | On the existing local database (migrations 1–3 applied, restored from the earlier run), inserting `expected_cash = 600`, `variance = NULL` was accepted (rolled back afterwards). |
| `npx supabase migration up` on that existing database | Applied only `20261121000004_cash_count_reconciliation_pair.sql`; `npm run db:check` then passed (`phase2 database checks passed`). This is the upgrade path for existing local databases. |
| `npx supabase db reset`, then `npm run db:check` | All four migrations and the seed apply on a fresh database; `phase2 database checks passed`. |
| New SQL checks in `supabase/tests/phase2_checks.sql` | Rejected: expected 600 with NULL variance; variance without expected cash; wrong-sign variance (603 vs 600 with -3); wrong variance (603 vs 600 with 5, existing check). Accepted: valid zero variance (600 vs 600, 0, stored as 0 not NULL); valid unreconciled count (both NULL). Also: 999,999,999,999.99 accepted and 1,000,000,000,000.00 rejected by `numeric(14,2)`. All pass. |
| `npm run check` (typecheck, tests, production build) | Pass: tsc clean; 76/76 tests in 7 files; build compiled and generated 12 pages. New regression tests: maximum valid amount (999,999,999,999.99 in plain, spaced, comma and Arabic-Indic forms, with leading zeros), one cent above (1,000,000,000,000.00 and .01), a 400-digit input that overflows `Number` (Western and Arabic digits, positive and negative), and the service-level preview (maximum amount is calculated as "over"; oversized inputs give `invalid_amount` and no calculation). |
| `npm run test:smoke` | 69/69 pass (14 new): in English and Arabic, 1,000,000,000,000.00, the Arabic-digit equivalent and a 400-digit input each return 200 with the localized validation message and no calculated result; 999999999999.99 is still calculated. |
| Browser pane, oversized input through the cash-count preview | English: `counted=1000000000000.00` shows "Enter a valid amount in MAD, for example 603 or 603.50." and no result block. Arabic: the same URL shows "أدخل مبلغًا صحيحًا بالدرهم، مثل 603 أو 603.50." in a right-to-left page; submitting 400 Arabic-Indic nines through the form also shows it and no result. Screenshots taken in both languages. |
| Not run | The 400-digit input was not typed through the English form in the browser (covered by the HTTP smoke check in English). No hosted Supabase project was used. |

Environment: the checks ran on this project's own local Supabase instance (`balaban-dev`, ports 55320–55329), stopped afterwards. The four other Docker containers that were running (not part of this project) were not touched. The Casablanca time-zone follow-up stays in Phase 4 as documented above; Phase 3 was not started.

## Next steps (in order)

1. Start Phase 6 from updated `origin/main` after the Phase 5 pull request merges. Post theoretical consumption through the approved recipe version using the [Phase 5 handover notes](phase5/CATALOG_AND_RECIPES.md#handover-to-phase-6). Ask Abdo for the November recipe start date first.
2. Before production rollout, provision an authorized hosted Supabase project, set the Auth options and `SITE_URL`, configure SMTP, and bootstrap Abdo. See the [accounts and permissions runbook](phase3/ACCOUNTS_AND_PERMISSIONS.md).
3. Carry forward the weekly total-ratio rule and live comparison source and entry owner (Phase 7), the confirmed expected receipt mapping (Phase 8), Abdo's walkthrough (Phase 10) and reviewed opening data (Phase 11).
