# Phase 7: Cross-branch sales comparison

Phase 7 compares Al Quds, Maarif, Bourgogne and their total across matching dates (report fields CMP-01 to CMP-08). Migration `20261124090000_phase7_comparison.sql` holds the schema and rules. The screens are in Arabic and English:

- `/comparison`: weekly and monthly modes, with a branch selection;
- `/comparison/entry`: Al Quds and Bourgogne figures;
- `/comparison/history`: every revision of one branch and date;
- `/comparison/settings`: live source, entry owner and first live date per branch;
- `/api/exports/comparison`: the CSV export.

All data used to build and test it is synthetic. The real reference day (Bourgogne, 10 November: 28,975 MAD and 374 orders; SRC-12 pair 10 vs 3 November) is **not** in any committed test or fixture. Enter it by hand only in a private, team-only environment. See "Reference case" below.

**Open decision (Abdo):** the approved live source and the entry owner for Al Quds and Bourgogne. Both are configurable per branch and start "not decided". The existing `reporting_only` designation keeps working. See "Question for Abdo".

## What is stored

| Record | Meaning |
|---|---|
| `comparison_entries` | One revision of one figure: branch, business date, metric (`net_sales` in centimes, or `order_count`), source designation, purpose (`live` or `historical`), revision number and the revision it replaces, value, source reference, correction reason, request identifier and hash, person, and save time. |
| `comparison_sources` | Source designations. `reporting_only` is built in; an administrator can add one, for example the live source once Abdo names it. |
| `comparison_branch_settings` | Per branch: live source, entry owner, first live business date, and a revision number for concurrent edits. If a branch has no row, nothing is decided for it. |
| `comparison_figures` (view) | The Phase 2 table, now a compatibility view over the active revisions. An insert into it goes through the same checked entry command, so the seed, `phase2_checks.sql`, `phase3_checks.sql` and `test:phase3` work unchanged. Update and delete are refused (`42501`). |
| `branch_daily_figures` (view) | One row per branch and date, with the same precedence as the report. It reads with the caller's row-level security. |

**One active value per branch, business date, metric and source designation** is a database constraint: the partial unique index `comparison_entries_one_active … where active`. It holds for every write path, including the table owner. History is append-only. A trigger refuses UPDATE, DELETE and TRUNCATE, even by the owner. The single exception is retiring the active revision (`active` true → false, nothing else).

Migrated data: every existing `comparison_figures` row became revision 1 of each metric it held. Where a Phase 3 audit row records who entered it, that person stays the actor. Upgrade path G checks that the figures read back identically.

## Rules

- **Branch order and layout (SRC-12).** Al Quds, Maarif and Bourgogne, then the total. Each row shows sales and orders for the current and the prior date, the absolute differences, and the current ÷ prior ratio.
- **Weekly mode, same weekday (CMP-05/06).**
  - One shared current/prior date pair for every branch. The prior date defaults to 7 days earlier, and a prior on another weekday is refused.
  - «نسبة الحالي للسابق» = current sales ÷ prior sales.
  - The ratio is blank and labelled when the prior is 0 or missing, or the current is missing, with the reason. A recorded 0 current is a real 0 %.
- **Monthly mode (CMP-01 to CMP-04), kept separate.**
  - Days are matched by day number. A month without that day shows "no such day".
  - Daily growth = current ÷ prior − 1. A recorded 0 gives −100 %; a blank stays blank; a zero prior is unavailable.
  - Period growth is like for like: only day numbers where every selected branch has a figure in both months. Each branch also has its own like-for-like period.
- **Coverage before percentages.** Every mode first shows, above the table:
  - how many branches have figures on each date;
  - which branches are missing;
  - in monthly mode, the missing days, the days before the first live date, and whether the month is still in progress.

  Days that have not started are "not started", not missing.
- **Totals (CMP-08).** Totals cover the selected branches and dates only. A total with a missing branch is marked incomplete with its coverage. When the two dates cover different branches, the total gives no ratio or difference. A total order count is blank when a branch counted in the sales total has no order count.
- **Maarif comes from saved business days.**
  - The figure is the effective revision of a closed or corrected Phase 4 day (`operating_day_revisions`). Nothing is entered again, and the database refuses comparison entry for Maarif (the `comparison.enter` permission is limited to comparison branches).
  - A closed day wins over any entered figure for the same branch and date.
  - The Phase 2 demonstration rows (`business_days`, local seed only) count only where there is no live day, and are labelled as such.
  - A draft day is not a figure.
- **Precedence among entered figures.**
  1. Before the first live date, a historical figure comes first; from that date on, a live one.
  2. Then the branch's configured live source.
  3. Then `reporting_only`.
  4. Then any other designation, in key order.
  5. A withdrawn value counts as missing.
- **First live business date.** Dates before it show "unavailable: before the first live date". The exception is figures entered as **historical**:
  - they need a source reference and a date before the first live date;
  - they stay marked historical with that reference on the page and in the CSV.

  The date is the configured one if set. For Maarif it otherwise defaults to the first saved business day. A regular figure dated before it is refused.
- **Entry and corrections.**
  - One command, `app_comparison_save(branch, request, payload)`. It checks the person, the organization, `comparison.enter` for the branch, the entry owner when one is configured, the date (not in the future; the live-date rule) and the source designation.
  - It locks the branch and writes the revisions and one audit row (`comparison.entered` or `comparison.corrected`) in one transaction.
  - A *new* figure where one already exists is refused (`23505`). A *correction* needs a reason and adds the next revision; the earlier one stays readable.
  - The form fixes the request identifier when the page is rendered. Retrying the same save returns the first result and writes nothing. The same identifier with other content is refused.
- **Entering does not grant viewing.** The entry page shows no saved figure.

## Permissions

The three Phase 3 permissions are unchanged in the catalog and the group grants:

| Permission | Groups | Enforced by |
|---|---|---|
| `comparison.enter` (comparison branches only) | Comparison Editor, System Admin | `app_comparison_save` and the compatibility-view insert; the entry page and action guard |
| `comparison.view` | Manager (their assigned branches), System Admin | row-level security on `comparison_entries` and the views; `app_comparison_report('view', …)`; the page guard, which checks every selected branch |
| `comparison.export` | System Admin | `app_comparison_report('export', …)`; the export route, which checks every exported branch |
| `admin.config.manage` (settings) | System Admin | `app_comparison_settings_*`, `app_comparison_add_source` |

Each read function checks its own permission for every requested branch, within the caller's organization. So viewing does not grant exporting, exporting does not grant viewing (an exporter reads no row directly), and neither grants entering. The API roles have no write grant on the tables. `anon` and `service_role` have no access.

A Manager is assigned per branch, so the menu links them to the comparison of their own branch (`?branches=maarif`). The three-branch default needs `comparison.view` for all three branches.

## Question for Abdo

Send this in plain Arabic. Do not choose an answer for him.

> «يا عبده، عشان مقارنة الفروع: أرقام فرع القدس وفرع بورجون هناخدها منين كل يوم (من سيستم الكاشير/فودكس ولا من رسالة من مدير الفرع ولا من شيت معيّن)؟ ومين الشخص اللي هيدخّلها في البرنامج لكل فرع؟ ومن أنهي يوم نبدأ نعتبر أرقامهم رسمية؟»

When he answers, the administrator does three things on `/comparison/settings`:

1. Add the source designation he names.
2. Choose it as the branch's live source.
3. Choose the entry owner and the first live date.

## Reference case

SRC-12 compares 10 November with 3 November across the branches. Bourgogne's current figure on 10 November is 28,975 MAD and 374 orders (P1-10). The committed tests use synthetic figures with the same structure:

- 120 vs 100 gives a difference of 20, a ratio of 120 % and monthly growth of 20 %;
- a recorded zero prior;
- a missing branch;
- a partial selection.

To check the real day, use a private local stack restricted to the team:

1. Set Bourgogne's first live date, or leave it unset.
2. Enter 28,975.00 and 374 for 10 November as a Comparison Editor.
3. Check the Bourgogne row against SRC-12.

Never commit those figures or a database dump that holds them.

## Verification

| Command | Covers |
|---|---|
| `npm run db:check:phase7` | `supabase/tests/phase7_checks.sql` (rolls back). It covers:<br>• structure, grants and the constraint<br>• save, retry (one revision), reused request, second active value refused by the command, the compatibility view and the table owner<br>• corrections (revision 2, revision 1 retired and unchanged)<br>• append-only history<br>• a second designation, withdrawal<br>• entering, viewing and exporting each refused to the others, at the table, view and function level, for editor, exporter, cashier, manager, an outsider, anonymous callers and another organization's administrator<br>• Maarif closed through the daily close appears in closing, the month report and the comparison with no entry<br>• the closed day wins over a reporting-only figure; a draft day is no figure<br>• first live date, historical figures with their source, live-source precedence, entry owner, settings permission and stale revision |
| `npm run db:upgrade-test` | Section G: a Phase 6 database (seed plus one figure with sales and orders) upgraded to Phase 7. The figures read back identically as revision 1; settings start undecided; the Phase 2–7 checks pass; schema and grants equal a fresh build |
| `npm run test:phase7` | HTTP against the production build. It covers:<br>• Maarif closed through the daily-close commands shows in the daily close, the Daily Sales export and the comparison<br>• entry, retry, duplicate, correction, future date and forged-branch cases through the real form<br>• refusals at page, export and database level for every role, in both languages<br>• weekly figures and order, coverage before percentages, partial selection, history<br>• monthly growth and the like-for-like period<br>• settings, first live date, historical figure and entry owner |
| `npm run test:phase7:browser` | Edge, English desktop and Arabic at 375 px: direction, no horizontal scroll, one heading, no NaN or ∞. It covers:<br>• order, coverage above the table, 120 %, unavailable percentages with their reasons, the incomplete total<br>• the selection form and monthly +20 %<br>• history<br>• a real entry by a Bourgogne editor (who cannot open the comparison)<br>• a cashier refused everywhere<br>• no console errors |
| `npm test` | `tests/comparisons.test.ts` (calculations), `tests/comparison-forms.test.ts` (entry form), `tests/services.test.ts` (demonstration mode and query parsing) |

## Acceptance

Results of the final run are in [HANDOFF.md](../HANDOFF.md#phase-7-status).

| Acceptance check | Evidence |
|---|---|
| The three branches and their total appear in the order Al Quds, Maarif, Bourgogne, Total | `comparisons.test.ts` "follows SRC-12"; `phase7_checks.sql` §3 (report keeps the order); `test:phase7` §4 (both languages); browser "rows are Al Quds, Maarif, Bourgogne, and the total follows" |
| 120 vs 100: difference 20, weekly ratio 120 %, monthly growth 20 % | `comparisons.test.ts` weekly and monthly cases; `test:phase7` §4 (Maarif +20.00 and 120 % from closed days) and §5 (17 Nov vs 17 Oct +20 %, period 20 %, CSV `20.00`); browser in both languages |
| Missing days and a zero prior display safely: "unavailable", never NaN, ∞ or 0 % | `comparisons.test.ts` (reasons, blank, `—`); `test:phase7` §4 (`current_unavailable`, `prior_zero`, `different_branches`; no NaN or ∞) and §5 (future, no such day, before live); browser reads the reason text in both languages |
| A Maarif day entered once through the daily close appears in closing, reports and comparison | `phase7_checks.sql` §4; `test:phase7` §1 (daily close page, Daily Sales CSV) and §4 (`data-origin="closed_day"`); no Maarif comparison entry exists (§7) |
| A user without comparison access cannot read Al Quds or Bourgogne figures (database, HTTP, browser) | `phase7_checks.sql` §3; `test:phase7` §3 (pages, export, `comparison_entries`, `comparison_figures`, report function); browser cashier section |
| A second active value is refused; retrying the same save creates one revision | `phase7_checks.sql` §2 (command, compatibility view, table owner against the index); `test:phase7` §2 (form `comparison_duplicate`, replay `comparison_replayed`, 2 rows for the request) |
| Entering, viewing and exporting are enforced separately | `phase7_checks.sql` §3 (each role against each path); `test:phase7` §3 (viewer cannot export, exporter cannot view, neither can enter, editor neither) |
| A total over a partial selection is marked incomplete and shows its coverage | `comparisons.test.ts`; `test:phase7` §4 (2 of 3, 3 of 3, no total ratio; complete when the selection is complete); browser total note |

Mutation checks: each change below made `phase7_checks.sql` fail on a fresh database.

- Dropping `comparison_entries_one_active`: first at the structural assertion. With that assertion removed, at the table owner's second active insert.
- Dropping the `comparison_entries_read` policy: "the earlier revision stays readable".
- Opening that policy to every signed-in person: "entries hidden from …".

## Not in Phase 7

- **Phase 4 concurrent save on PostgREST v14.18** (found while rerunning `test:phase4`, independent of Phase 7): see the [handover](../HANDOFF.md#phase-7-status).

- **The live source and entry owner** for Al Quds and Bourgogne: Abdo's answer (above).
- **Historical Maarif figures** before its first live date. `comparison.enter` stays limited to comparison branches (Phase 3). If a Phase 9 report needs them, decide who may enter them then.
- **Report exports** beyond this CSV belong to Phase 9.
