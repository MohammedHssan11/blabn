# Phase 9: the five Excel report families

Phase 9 builds downloadable `.xlsx` workbooks for the five report families from saved application data. Each file is built as the person who asks for it, checked, stored privately and recorded with the revisions it came from. A completed file never changes. A correction appears in a new export, and the earlier file and its provenance stay reviewable.

Phase 9 was verified locally using synthetic data. See the [handover](../HANDOFF.md#phase-9-status) for the hosted deployment status.

## What a person does

`/<locale>/reports/exports` ("Excel reports" in the menu). The page offers only the families the person may export, each with its periods:

| Family | Periods | Branches |
|---|---|---|
| Sales comparison | weekly (one current date and the same weekday before it) or a month against the previous month | Al Quds, Maarif, Bourgogne, any selection the person may export |
| Daily Sales Maarief | month | Maarif |
| Daily statement | one business day, or a month (one sheet per closed day plus an index) | Maarif |
| Yawmeya | one business day, or a month (summary, accounts, one sheet per day) | Maarif |
| Inventory and replenishment | one business day, or a month | Maarif |

The person chooses the workbook language (Arabic or English, independent of the page language) and, for the three daily-close families, whether to include days that are not closed (only with the draft-export permission). "Build workbook" builds and stores the file in the same request and opens the export page. That page shows the status, a Download link, Retry for a failed export, the provenance and the history. The list shows the person's exports.

## Design

| Part | File |
|---|---|
| Records, commands, private bucket, Storage policies | `supabase/migrations/20261126090000_phase9_report_exports.sql` |
| Families, periods, permissions (mirrors the SQL) | `src/modules/exports/families.ts` |
| Language-neutral report model, data fingerprint | `src/modules/exports/model.ts` |
| Arabic and English workbook labels | `src/modules/exports/labels.ts` |
| Builders (saved data → model) | `src/modules/exports/build/{comparison,daily,inventory,about}.ts` |
| Reads as the requester, pinned to one basis / snapshot | `src/modules/exports/data.ts` |
| Workbook writer (ExcelJS 4.4.0) | `src/modules/exports/xlsx.ts` |
| File scan (values only, direction, print setup) | `src/modules/exports/scan.ts` |
| Request → claim → build → scan → store → complete / fail | `src/modules/exports/service.ts` |
| Form actions, pages, download | `src/modules/exports/actions.ts`, `src/app/[locale]/reports/exports/**`, `src/app/api/report-exports/[id]/route.ts` |
| Versions | `src/modules/exports/versions.ts` |

**One model, two languages.** A builder turns saved data into a model that holds values (centimes, basis points, exact fractions, business dates) and label keys, never translated text. The writer renders the same model in Arabic or English. The figures are identical by construction, and the data fingerprint (SHA-256 of the model's report sheets) is the same for both languages. Tests and the HTTP check compare the numeric cells of the Arabic and English files.

**Values only.** Every figure is written as a value calculated by the application: no formulas, no external links, no macros, no hyperlinks. Totals are the application's totals. Text a person typed (descriptions, references, names, order numbers) is written as literal text with the `@` format. Text such as `=SUM(1)` or `@reason` stays text. The scan refuses any formula, cached error value, external link or relationship, hyperlink, macro, unexpected defined name, `NaN`/`Infinity`, and any sheet with the wrong direction or without A4 fit-to-width print setup. An export that fails the scan is not stored.

**Library.** ExcelJS 4.4.0 was chosen after a test before any code was written: a 20,000-row Arabic sheet with merged title, print titles, header and footer built in about 1 s (630 KB, 330 MB RSS). Desktop Excel 16.0 opened it right-to-left and paginated it (589 pages fit to width). Its `uuid` dependency had an advisory (GHSA-w5hq-g745-h8pq, buffer API not used by ExcelJS); `package.json` overrides it to `uuid@11.1.1`, and `npm audit` reports 0 vulnerabilities. `jszip` (already an ExcelJS dependency) is a direct dependency for the scan. Both are in `serverExternalPackages`.

**Print layout.** Every sheet: A4, fitted to one page wide, landscape for wide tables, repeated header row on the main table, the report title in the page header ("DRAFT" on the right of draft files), "Page n of m" and the export's short identifier in the footer, right-to-left in Arabic.

## Source mappings

Every figure comes from the Phase 4–8 readers and calculations, which run as the requester (row-level security and the report functions check the branch permission again).

| Family | Fields | Saved source and pinning | Rules applied by the workbook |
|---|---|---|---|
| Sales comparison | CMP-01–CMP-08 | `app_comparison_report` (export access) through the Phase 7 calculation (`comparisons/calc.ts`): Maarif from closed days, Al Quds and Bourgogne from comparison entries. Each figure's record and revision is stored in `sources.comparison_records`, historical ones marked. | Weekly: one shared date pair; total ratio = summed current ÷ summed prior of the same branches, blank with its reason when the branches differ or prior is 0; coverage "n of m". Monthly: growth = current ÷ prior − 1 per day, like-for-like period growth per branch and total, comparable days, month in progress. Missing stays blank with its status; historical figures carry "Historical, reporting only — reference: …". |
| Daily Sales Maarief | DS-01–DS-11 | `app_operating_report(month)` at one revision basis (`sources.operating_basis`). | One row per calendar day. Days not closed are blank with their state. Average = sales ÷ orders as saved. DS-05 = cash expenses + bank remittance. DS-06 blank when no remittance. Totals: sums of included days, period average = total sales ÷ total orders, ratios on the totals, "days included n of m". |
| Daily statement | ST-01–ST-09 | The same basis, then `app_operating_report(date, basis)` for each day (`sources.day_revisions`). | Effective (not reversed) cash expenses with description, account and time. The remittance is on its own line. Total expenses with and without remittance. Denomination count (an explicit 0 is a counted 0). The reconciliation as saved at count time: expected, over/short, total amount (ST-06), and cash expenses through the count derived from the saved ST-06. The remittance after the count is shown separately. Counter, role, cashier, shift, recorder, count time. |
| Yawmeya | LG-01–LG-11 | As the statement. | Sales morning/evening/total; payments; cash ledger from "رصيد أمس" through POS cash, receipts, expenses and remittances to "رصيد اليوم"; custody ledger likewise; count and result (match / over / short / not counted); cancellations (no customer contact field exists); month summary per day (LG-10) and totals by account and ledger (LG-11). |
| Inventory and replenishment | INV-01–INV-13, ORD-01–ORD-02 | `app_stock_day(date, as_of = snapshot)` for every day (`sources.stock_as_of`); `app_product_mix` (version and state in `sources.product_mix`); `app_purchase_orders` / `app_purchase_order` (`sources.orders`); units from the catalog. | Only locked Product Mix reports are included. Shares blank when the section total is 0. Consumption as posted with its recipe version. Stock columns by movement type (outflows shown as positive), book balance, expected at count, count (blank = not counted, 0 = counted zero), deviation only after a count, cumulative and month deviation. Quantities exact (a cell note holds the fraction when it has no finite decimal). Orders: order business date, creation time, original and current expected receipt with the override reason, actual receipt dates, lines in base units with suggested, received, cancelled and outstanding. |

The About sheet of every file names the report, branches, period, language, requester, request time and data snapshot (branch time, formatted by PostgreSQL), final or draft, template and calculation-rule versions, field-map version, export ID, data fingerprint, the saved sources above, every pending rule, reading notes, and the field IDs used with their status.

## Record, storage and retries

`report_exports` keeps one row per (requester, request identifier): family, branches, period, workbook language, drafts, requester, status, attempt, snapshot instant, template version, calculation-rule version, sources, data fingerprint, file path, file name, file SHA-256 and size. `report_export_events` keeps the history: requested, started, failed, completed, downloaded, refused. Both are append-only. A trigger refuses any change to a completed export, any change to the request columns, and any delete or truncate, even by the table owner. Request and completion are also written to the audit history.

- **Request.** `app_report_export_request` validates the family, branches and period. It checks the account designation and the family's permissions for every branch. Repeat and concurrent submissions with the same request identifier and content return the same export. Different content with the same identifier is refused (`23505`).
- **Claim** (`app_report_export_claim`): starts attempt n and fixes the snapshot instant. A finished export answers "complete" and is never rebuilt. A run in progress answers "busy" unless its claim is over 10 minutes old.
- **Store**: the server uploads the file as the requester to `report-exports/<organization>/<export>/attempt-<n>.xlsx`. The bucket is private (25 MiB, xlsx only). The Storage insert policy accepts only the running attempt's path for its requester with the permission. There is no update or delete policy, so a stored file cannot be replaced or removed through the API.
- **Complete** (`app_report_export_complete`): only the attempt that holds the claim. The database checks that the object exists with the stated size before it marks the export complete.
- **Fail**: any error marks the attempt failed with a short code (`storage_failed`, `scan_failed`, `build_failed`, `forbidden`, …). Retry starts the next attempt. A late answer from an abandoned attempt can neither complete nor fail the export, so one export ends with exactly one completed file.
- **Download.** At `/api/report-exports/<id>`, the signed-in requester must still hold every branch permission and the account designation. The route checks branch access, then the download command and authenticated Storage download enforce both requirements. Storage refuses signed URLs so downloads always use live permissions. The server compares the file's SHA-256 with the record before sending it (`no-store`).

## Permissions

Abdo alone may export, retry and download Excel workbooks, including the supported draft reports. The migration keeps one designated staff account per organization in `app_private.report_export_owners`. Only a privileged database operator can set it. The existing report permissions also apply to every branch when requesting, building, storing, completing and downloading.

| Family | Needs, for every branch |
|---|---|
| Sales comparison | `comparison.export` |
| Daily Sales, Daily statement, Yawmeya | `reports.export` + `daily_close.view`; with drafts also `daily_close.export_draft` |
| Inventory and replenishment | `reports.export` + `inventory.view` |

With the Phase 3 grants, Abdo's designated System Admin account can export every family. Another System Admin, manager, cashier, storekeeper or comparison editor cannot export Excel. The existing CSV permissions still apply. A holder of `admin.audit.view` can review export records and provenance. Only the designated requester with live permissions can download their completed files. Drafts are marked in the header, the rows and the About sheet. The comparison uses closed days and inventory includes locked Product Mix only.

### Production account setup

The Phase 9 migration starts with no designated account. After it is applied, use the [Phase 3 account runbook](../phase3/ACCOUNTS_AND_PERMISSIONS.md#bootstrapping-abdo-as-the-first-system-admin) as needed to provision Abdo, then verify his staff user ID and organization through the trusted deployment channel. Run the following as the database owner, supplying those verified IDs. Expect one inserted row. If a designation already exists, inspect it before changing it.

```sql
insert into app_private.report_export_owners (organization_id, staff_id)
select s.organization_id, s.user_id
from public.staff_accounts s
where s.user_id = '<verified Abdo staff user UUID>'::uuid
  and s.organization_id = '<verified organization UUID>'::uuid
  and s.is_active
  and exists (
    select 1 from public.staff_group_assignments a
    where a.staff_id = s.user_id and a.group_key = 'system_admin' and a.branch_id is null
  );
```

Verify that Abdo's signed-in session can open the Excel reports page and has the intended branch and draft access. A second System Admin should see no export forms. To revoke the designation, the operator removes its row. Existing files and their provenance remain available for audit, subject to record permissions.

## Versions

| Template | Version | Layout fingerprint |
|---|---|---|
| Sales comparison | `sales_comparison@1.0.0` | `c533827f4b114c5b` |
| Daily Sales Maarief | `daily_sales@1.0.0` | `c7d72a3df701aa66` |
| Daily statement | `daily_statement@1.0.0` | `ad10f5157dd175bd` |
| Yawmeya | `daily_ledger@1.0.0` | `f27610f32906a655` |
| Inventory and replenishment | `inventory@1.0.0` | `403a37dcca648b93` |

The layout fingerprint covers sheet names, column labels in both languages, widths, orientation and field IDs. `tests/exports.test.ts` recomputes it. A layout change fails the test until the version and fingerprint in `versions.ts` are updated together. The calculation-rule version is `p9-calc-2026.11.24` (the rules in the source-mapping table). The field-map version is the Phase 1 findings version written by the field-map build.

## Historical reporting-only figures

Only the Phase 7 path exists: an authorized comparison editor enters a historical figure for Al Quds or Bourgogne before its first live date, with a source designation and a reference. Such figures live only in `comparison_entries`. They appear only in the sales comparison, marked with their reference, and are counted in `sources.historical_figures`. They never enter the daily close, the ledgers, the carry-forward or stock. The HTTP check verifies that the Maarif carry-forward, the daily-close revisions and stock are unchanged after one is entered, and that the Daily Sales file holds none. Maarif's figures before its first live date cannot be entered (see open decisions).

## How to reproduce the checks

Use a disposable local stack; several checks reset the database. Never point them at the development stack you want to keep.

1. Copy the project to a separate folder (outside this checkout), with its own `supabase/config.toml`: a different `project_id` (here `balaban-p9`) and ports (here 59320–59329). Run `npm ci` there (or copy `node_modules`).
2. In that folder: `npx supabase start -x realtime,imgproxy,studio,postgres-meta,logflare,vector,supavisor,edge-runtime` (Storage must run), then `node scripts/phase3/write-local-env.mjs`.
3. Then, in that folder:

| Command | Covers |
|---|---|
| `npm run check` | types, unit tests (`tests/exports.test.ts`: labels in both languages, permissions equal to the SQL, period rules, Daily Sales blank/zero/drafts/period average, statement reconciliation, Yawmeya ledgers, weekly summed ratio, monthly growth, historical labels, exact stock quantities and order dates, identical numbers in Arabic and English, literal text, the scan refusing a formula/error/external link, a 600-item month workbook, pinned template layouts), build |
| `npm run db:check:phase9` | `supabase/tests/phase9_checks.sql` (rolls back) |
| `npm run db:upgrade-test` | paths A–I; I = a Phase 8 database with saved data upgraded to Phase 9 |
| `npm run build && npm run test:phase9` | HTTP end-to-end on the built app; set `P9_OUTPUT_DIR` to keep the downloaded workbooks. It refuses `balaban-dev` and port 55321. |

## Acceptance

See the current release review and the earlier implementation results in the [handover](../HANDOFF.md#phase-9-status).

## Open business decisions

- **Historical Maarif figures (Phase 7 open item).** No approved report needs Maarif sales before its first live date yet. `comparison.enter` stays limited to Al Quds and Bourgogne, and the database refuses Maarif. If Abdo wants them, decide who enters them and add an approval step. Question for Abdo: «يا عبده، هل محتاج في تقرير المقارنة أرقام مبيعات المعاريف قبل أول يوم تشغيل على البرنامج؟ لو آه: أنهي أيام بالظبط، ومين اللي يدخّلها، ومين يوافق عليها؟»
- **Walkthrough decisions.** Carry forward the confirmed P1-19 Maarif cash-count workflow, the two approved P1-28 Dubai chocolate cake spellings and the P1-31 mixed-nut kilogram conversion. The workbook annotations are generic. Review only the remaining Foodics mappings, component units and the P1-32 November recipe start date. See the [cash-count decisions](../phase4/ABDO_DECISIONS.md) and [catalog decisions](../phase5/CATALOG_AND_RECIPES.md).
- **Layout confirmation (Phase 10).** The templates follow the legacy headings and field map; Abdo confirms the presentation during the walkthrough. Columns the legacy Daily Sales sheet had outside the field map (cancellations, hospitality) are not in the template.

## Not in Phase 9

- A background queue: the file is built in the request (seconds for a month). Builds that are interrupted show as "Building" until a retry takes over after 10 minutes.
- Cleaning up objects of abandoned attempts (they stay private and unreferenced).
- A screen for reproducing a file from its sources. The daily-close families and stock can be rebuilt from `operating_basis` / `stock_as_of`; comparison and Product Mix record their revisions but the Phase 7 and 6 readers have no "as of" parameter.
- Hosted deployment of the migration. Follow the separate deployment procedure in the [handover](../HANDOFF.md#phase-9-status).
