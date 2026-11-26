# Handover record

Read this first in every session, then compare it with the actual repository state (`git status`, `git log -3`, `git fetch` and the PR list) before continuing. Update it after each meaningful task and before ending a session.

_Last updated: 24 November 2026. [Abdo's decisions were reviewed against the application](phase10/DECISION_REVIEW.md): the approved 20 % safety-stock rule is now implemented (migration `20261127090000`, local only, not committed). [Phase 10](#phase-10-status) technical rehearsal is complete; **Abdo's acceptance is pending** and the hosted Phase 9 migration is **not applied**. See the [hosted deployment record](#hosted-deployment)._

The bilingual workspace uses the [B.Laban interface refresh](BRAND_DESIGN.md). Phase 4 implements the [confirmed daily close and Yawmeya workflow](phase4/OPERATING_CLOSE.md) on the signed-in person's Supabase session.

## Where things are

| Item | Value |
|---|---|
| Repository | https://github.com/MohammedHssan11/blabn. The repository remained public when the owner approved the Phase 9 push and merge. |
| Phase 3 branch | `codex/phase-3-accounts-permissions`, based on `main` at the Phase 2 merge (`2d21e31`). |
| Audit and Phase 6 | [PR #9](https://github.com/MohammedHssan11/blabn/pull/9) (`audit/phases-1-5`) merged as `b2fdc42`; [PR #10](https://github.com/MohammedHssan11/blabn/pull/10) (`phase-6/stock`) merged as `5994747`. |
| Phase 7 | [PR #12](https://github.com/MohammedHssan11/blabn/pull/12) (`phase-7/comparison`) merged as `a265524`. |
| Phase 8 | [PR #14](https://github.com/MohammedHssan11/blabn/pull/14) (`phase-8/replenishment`) merged as `e1403fb`. |
| Phase 9 | [PR #16](https://github.com/MohammedHssan11/blabn/pull/16) merged into main at `9b25afbb27a96c880ec4b344db81a8693c6808e6`. |
| Development baseline | Verified `origin/main` at `9b25afbb27a96c880ec4b344db81a8693c6808e6`. |
| Phase 9 validation copy | `C:\Users\mh978\Downloads\abdo-p9-validation\` with the running disposable stack `balaban-p9` (API `127.0.0.1:59321`, Postgres `127.0.0.1:59322`). Synthetic desktop Excel samples are in `C:\Users\mh978\Downloads\abdo\outputs\phase9\`. |
| Hosted Supabase | Shared project `xitryskkqgtkpdawddqe`. Hosted migration history matches `main` through `20261125090000` (23 November 2026). Deploy with `npx supabase db push --linked --dry-run` first; never use `--include-seed`, because the seed files are local test data. |
| Local tooling | `npm ci` installs the pinned Supabase CLI 2.122.1. Use `npx supabase …`; an older global CLI cannot read `supabase/config.toml`. |
| Phase 2 pull request | [PR #2](https://github.com/MohammedHssan11/blabn/pull/2), merged. |
| Local-only material | `C:\Users\mh978\Downloads\abdo\abdo temp\`, `...\outputs\`, `...\archive\`, `...\screenshot\` — outside Git; keep them out of commits. |

## Phase 10 status

Full record, with every report difference: [phase10/WEB_VALIDATION.md](phase10/WEB_VALIDATION.md). Walkthrough for Abdo (Arabic and English, not yet run): [phase10/WALKTHROUGH.md](phase10/WALKTHROUGH.md).

| Item | Result |
|---|---|
| Revision | Branch `codex/phase-10-web-validation` from `origin/main` `9b25afbb27a96c880ec4b344db81a8693c6808e6` with the P1-19 fix, Phase 10 scripts and docs, and the Phase 9 handoff record. The rehearsal ran in `C:\Users\mh978\Downloads\abdo-p9-validation\` on the disposable stack `balaban-p9`. |
| Phase 9 handoff | Merge confirmed (`9b25afb`). Hosted migration `20261126090000` **missing**: read-only `migration list --linked` shows hosted equal to `main` through `20261125090000`. Nothing was pushed to hosted. The CLI had to be linked locally (`supabase link`; untracked `.temp` only). |
| Tests run | `npm run check` 291/291 + build; `test:phase9` 124/124; Phase 2 smoke 69/69; `fieldmap:check`; private 2 November reference (`PHASE4_REFERENCE_FILE` with `scripts/phase4/browser-check.mjs`) 25/25; `npm run test:phase10` 78/78; `node scripts/phase10/browser-check.mjs` 35/35 in Edge (English desktop, Arabic 375 px); `scripts/phase10/compare_reports.py` 994 comparisons, 5 differences; sampled workbooks opened and paginated in desktop Excel 16. **Not run:** `db:upgrade-test` and the Phase 3–8 suites (no database change), the hosted project, paper print, Excel for Mac, LibreOffice, a visual render of the print pages. |
| Real data used | All October days and 1–2 November from the Daily Sales workbooks, the 2 November statement and count slip, the 7 November Foodics sample (its count, expenses and float were not observed), and the 10/3 November weekly comparison. Read from `outputs\phase10\workbook-reference.json` (written by `scripts/phase10/extract_reference.py`; local only, never commit). |
| Report differences | Daily Sales matches the workbook in every compared cell. Open: D-1 book-balance carry-forward produces a different variance from the workbook, D-2 purchasing-custody pass-through, D-3 missing cancellations and hospitality columns, D-4 display rounding, D-5 skipped days cannot be back-filled, D-6 inventory values not compared. Details and owners in the record. |
| Fix | P1-19 was settled but still shown as pending (the field-map builder ignored agreed outcomes). Fixed in `build_field_map.py`; map regenerated (4 pending); the statement, Yawmeya and cash-count page no longer say «Pending: P1-19». |
| Abdo's acceptance | **Pending.** He was not available. No walkthrough result or date is recorded. |

**Release review:** Phase 10 remained local after GitHub reported the repository as public. The stricter rehearsal still passed 78/78 and the branch-row comparison found the same five differences. Obtain repository privacy before pushing the Phase 10 branch.

**Open decisions:** D-1 to D-5; the P1-32 November recipe start date; remaining ambiguous catalog pairs and units; the P1-29 Kinder size; remaining replenishment settings (minimum observations, factory constraints, and confirmed delivery exceptions); walkthrough confirmation of the Phase 1 summary.

**Safety stock.** Implemented after the rehearsal: 20 % of the coverage-period forecast by default, editable on `/replenishment/settings`, 0 allowed (migration `20261127090000_safety_stock_percent.sql`). Evidence and the per-decision review: [phase10/DECISION_REVIEW.md](phase10/DECISION_REVIEW.md). Before the hosted push, the dry run must now list `20261126090000` **and** `20261127090000`. OCR and image upload stay for later.

**Readiness for Phase 11.** Technically ready for the daily workflow in both languages, but the live rollout should not start until: (1) the hosted Phase 9 migration is applied (once this branch is merged, the dry run must list exactly `20261126090000_phase9_report_exports.sql` and `20261127090000_safety_stock_percent.sql`, and zero seeds) and Abdo's account is provisioned and designated for Excel; (2) Abdo runs the walkthrough and decides D-1, which changes carried balances and so must be settled before live balances open; (3) the P1-32 date and recipe approvals are recorded if live consumption should post. First live date, opening cash and custody, opening stock and outstanding orders are collected at the Phase 11 handover, not here.

## Phase 9 status

### Release review on 24 November 2026

| Check | Result |
|---|---|
| Revision | Reviewed the original tip `8e1aebb` and release fixes at `96967f294b7b6fed9868368b0deedcb52ebb28e4`. The published commit `585369cb4e5901c959710e79ddf23f7f25d80b73` uses the verified release source and public handoff summary. |
| Abdo-only Excel access | The original grants allowed any System Admin to export. The release adds a private, single-account designation alongside live branch and draft permissions. Signed-in staff start without a designation, including System Admins. The production operator must verify and designate Abdo's provisioned staff account. [Account setup](phase9/EXCEL_REPORTS.md#production-account-setup) |
| Storage and retries | The migration creates a private 25 MiB bucket with the XLSX MIME restriction. Download authorizes against the current designation and every saved branch. Storage only serves authenticated downloads of completed files and refuses signed URLs. Concurrent submissions share one export, stale attempts cannot complete it and a completed file stays byte-identical. |
| Desktop Excel | Opened `daily_sales_ar.xlsx` and `daily_ledger_ar.xlsx` in Microsoft Excel. Both displayed right-to-left with readable Arabic. Daily Sales showed 1,554.50 MAD total, 22 orders and a 70.66 average. The 2 November Yawmeya showed 1,234.50 MAD of sales and a −3.00 MAD cash closing balance. Empty days stayed blank and recorded zeros showed as `0.00`. Excel preview showed the Daily Sales sheet on one A4 landscape page and the 2 November Yawmeya on two A4 landscape pages. |
| `npm run check` | Passed on the `balaban-p9` validation copy. Typecheck and production build passed, with 291/291 unit tests in 16 files. |
| Phase 9 database check | `npx supabase db reset --local` and `npm run db:check:phase9` passed. Tested account designation, branch and draft grants, Storage restrictions, frozen records and revocation. |
| Phase 9 HTTP check | `npm run test:phase9` passed. The repeat with `--no-reset` after the upgrade suite passed all 124 checks. Tested all five families, live revocation at the app and Storage API, signed URL refusal, concurrent submission, retry and stable downloads. |
| Database upgrade | `npm run db:upgrade-test` passed paths A–I. The Phase 8 to Phase 9 path preserved saved data, passed the Phase 2–9 SQL checks and matched the fresh schema and grants. |
| Local security advisors | `npx supabase db advisors --local --type security --level warn --fail-on none` returned four mutable search-path warnings in earlier phases and no findings for Phase 9. |
| GitHub | The owner lifted the original visibility gate. GitHub reported the PR mergeable with no required checks, and merged it at `9b25afbb27a96c880ec4b344db81a8693c6808e6`. The remote main tree matches the reviewed PR tree. [PR #16](https://github.com/MohammedHssan11/blabn/pull/16) |
| Hosted Supabase | The latest request covered GitHub publication and merge. Hosted verification and migration remain pending. The documented project is `xitryskkqgtkpdawddqe`. |
| Validation stack | `balaban-p9` remains running in `C:\Users\mh978\Downloads\abdo-p9-validation\`, with the reviewed Phase 9 migration and fresh disposable seed data. The Phase 9 SQL check passed again after the final reset. An operator can designate a synthetic staff account for an Excel rehearsal using the procedure above. |

**Hosted deployment.** When authorized, use merged `main` at `9b25afbb27a96c880ec4b344db81a8693c6808e6` to verify the linked Supabase project and preflight the Storage bucket and policies, including broad policies that might match `report-exports`. Confirm the hosted Storage schema provides `storage.allow_only_operation(text)`. Run `npx supabase db push --linked --dry-run`. Apply with `npx supabase db push --linked` only when the dry run lists exactly `20261126090000_phase9_report_exports.sql` and zero seeds. Stop and record any unexpected result. Verify the remote migration, private bucket, 25 MiB limit, XLSX restriction and policies, then confirm a second dry run is up to date. If the migration is already recorded, verify its actual configuration. Provision and designate Abdo's account before the live Excel rollout.

**Morning developer.** Use the existing workbooks for the Phase 10 bilingual walkthrough. Under the confirmed P1-19 workflow, Abdo counts the Maarif drawer and the counter, role, time, cashier and recorder remain separate fields. Carry forward the two approved Dubai chocolate cake Foodics spellings (P1-28) and mixed-nut kilogram conversions (P1-31). Review only the unresolved mappings and units, and record the P1-32 November recipe start date on `/catalog/review`. Use the agreed first live business date for Maarif sales. At the Phase 11 handover, collect reviewed opening balances, opening stock and outstanding orders. [Phase 4 decisions](phase4/ABDO_DECISIONS.md), [Phase 5 decisions](phase5/CATALOG_AND_RECIPES.md)

### Separate follow-up after Phase 9 merges

Done locally on 24 November 2026 (not committed): an editable safety-stock default of **20 % of forecast consumption for the coverage period**, added once before subtracting usable stock at receipt and eligible confirmed incoming, floored at 0, then minimum and pack size. See [phase10/DECISION_REVIEW.md](phase10/DECISION_REVIEW.md). Image upload and OCR stay for later.

### Earlier Phase 9 implementation evidence

The original implementation used synthetic data. The earlier results below describe the branch before the account designation and Storage operation restrictions. See the [report implementation](phase9/EXCEL_REPORTS.md).

What was built:
- Migration `20261126090000_phase9_report_exports.sql`:
  - `report_exports` (family, branches, period, language, drafts, requester, status, attempt, snapshot, template and calculation-rule versions, sources, data fingerprint, private file path, file SHA-256 and size) and `report_export_events`, both append-only, with a completed export frozen;
  - the commands `app_report_export_request / _claim / _complete / _fail / _download`, plus `app_report_exports` and `app_report_export`;
  - the private bucket `report-exports` (25 MiB, xlsx only) and Storage insert and select policies that re-check the permission. There is no update or delete policy.
- `src/modules/exports`: language-neutral report model, Arabic and English labels from Abdo's sheet headings, five builders on the Phase 4–8 readers, ExcelJS writer (A4, fit to width, right-to-left Arabic, values only), and a file scan.
- Screens `/reports/exports` and `/reports/exports/<id>` in both languages, and the download `/api/report-exports/<id>`. Menu entry "Excel reports".
- Library: ExcelJS 4.4.0, tested first: a 20,000-row Arabic sheet built in about 1 s and opened and paginated in desktop Excel 16. `uuid` is overridden to 11.1.1 (`npm audit`: 0). `jszip` is a direct dependency.
- No new permission: `comparison.export` per branch for the comparison; `reports.export` + `daily_close.view` (+ `daily_close.export_draft` for drafts) for the three daily families; `reports.export` + `inventory.view` for inventory.

| Acceptance check | Result | Evidence |
|---|---|---|
| Every report family opens and prints clearly in Excel | **Pass** | 14 synthetic workbooks (all five families, both languages, day and month periods) opened in desktop Excel 16.0 and exported to PDF: every sheet right-to-left in Arabic and left-to-right in English, 2–50 printed pages, no formula or error cell. Previews of the Arabic Daily Sales, Yawmeya day, weekly comparison and stock sheets inspected. `outputs\phase9\` (local only) |
| Shared values appear consistently | **Pass** | `test:phase9` §4: 1,234.50 MAD of 2 November is the same in Daily Sales, the statement (month and day) and the Yawmeya. Arabic and English files have identical numeric cells and the same data fingerprint. |
| An earlier export stays reviewable after a correction, with its source revision | **Pass** | §5: after an approved correction the earlier file downloads byte for byte, and its record and page keep the earlier `operating_basis`. A new export shows 1,334.50 with a later basis. |
| Partial months and missing values keep their meaning | **Pass** | Unit tests and §3–4: blank for not closed, 0.00 for a recorded zero, "days included n of m", coverage "n of m", reasons instead of ratios, a blank count versus a counted zero |
| A failed export can be retried without duplicate completed files | **Pass** | `phase9_checks.sql` §4 (stale attempt cannot complete; size must match the stored object). §6: Storage refused → failed, nothing stored. Retry → complete. Re-sending the form returns the same export. History: started 1, failed 1, started 2, completed 2; one row, one object. |
| Download fails after the permission is lost | **Pass** | SQL §5 (download refused and recorded, Storage invisible, record kept). §7: 200 before, 403 after the group is removed, a direct Storage read refused, not downloadable by another administrator (404), the cashier (404) or anonymous visitors (401). |
| No export of a branch without permission | **Pass** | SQL §2. §8: the Al Quds exporter exports Al Quds only; forms forged for Bourgogne or Maarif create nothing; the database answers `42501`; the manager cannot export the Yawmeya. |
| Historical reporting figures appear only where needed and change no live balance | **Pass** | §10: a historical Bourgogne figure appears in the comparison with its reference and is counted in the record. The Maarif carry-forward, the daily-close revisions and stock are unchanged. Daily Sales holds no Bourgogne figure. Maarif historical entry is refused. |
| Drafts only where allowed | **Pass** | §9: the draft day appears only in a draft export by a person with `daily_close.export_draft`. The cashier (draft CSV only) cannot export Excel. |
| User text written literally; no formulas, external links, broken references or error values | **Pass** | Unit tests (the scan refuses an injected formula, error value and external link). Every exported file is scanned before storage and again by `test:phase9`. `=SUM(1)+"…"` and `@…` stay text. |

| Command (final code, disposable stack `balaban-p9`) | Result |
|---|---|
| `npm run check` | `tsc` clean; **291/291** tests in 16 files (260 before; +29 in `tests/exports.test.ts`, +2 architecture cases); build passes (2 new dynamic pages, 1 route) |
| `seed:check`, `seed:catalog:check`, `fieldmap:check` | up to date (54 fields, 6 pending) |
| `db:check`, `db:check:phase3` … `db:check:phase9` | all pass on a fresh database (Phase 2–8 also passed before any change) |
| `npm run db:upgrade-test` | pass, paths A–I. I = Phase 8 → 9: a saved day and a stock movement unchanged; private bucket and policies created; no export; Phase 2–9 checks pass; schema and grants equal a fresh build |
| `npm run test:phase9` | **116/116** HTTP checks (all five families in both languages) |
| Earlier phases | `test:phase3` 372/372; `test:browser` 105/105; `test:phase4` 30/30 (empty database); smoke 69/69; concurrency pass; `test:phase5` 147/147; `test:phase5:browser` 71/71; `test:phase6` 70/70; `test:phase6:browser` 21/21; `test:phase7` 130/130; `test:phase7:browser` 71/71; `test:phase8` 109/109; `test:phase8:browser` 112/112 |
| Main development stack `balaban-dev` | untouched: row counts, audit hash and migration list identical before and after; `.env.local` unchanged |

Found and fixed while building:
- The shared append-only trigger read `status` on the history table (no such column).
- A refused download raised an error, which also rolled back the "refused" history entry. It is now answered and kept.
- Duplicate branches in a request were silently merged; they are now refused.
- Blank daily-sales cells lost their type; they are now typed blanks.
- The comparison source label repeated itself.

Earlier files changed, with reasons:
- `src/modules/closing/operations.ts`: exports the day type.
- `src/app/[locale]/layout.tsx`: menu entry.
- `tests/access-architecture.test.ts`: export actions guarded; download re-checks every branch.
- `scripts/phase3/upgrade-test.mjs`: path I.
- `next.config.ts`: `serverExternalPackages`.
- i18n catalogs.

No earlier SQL check file changed.

Not verified: a printed paper copy; Excel on another machine or Excel for Mac; LibreOffice; the hosted project; the shared Storage service in production (only the local Storage API ran).

Other open implementation items are whether Maarif figures before the first live date are needed, adding an "as of" reader for comparison entries and Product Mix, and cleaning up abandoned attempt objects.

## Phase 8 status

Three-month planning, purchase orders and receiving are implemented and locally accepted. They were merged into `main` through PR #14 (`e1403fb`), and migration `20261125090000_phase8_replenishment.sql` is applied to the hosted project (see [Hosted deployment](#hosted-deployment)). Design, rules, worked example, commands and the full acceptance table: [phase8/REPLENISHMENT.md](phase8/REPLENISHMENT.md). All test data is synthetic; no workbook figure, supplier detail or real order was committed.

What was built:
- Migration `20261125090000_phase8_replenishment.sql`:
  - `purchase_orders`, `purchase_order_lines`, `purchase_order_expected_dates` (revision 1 = original date), `purchase_order_receipts`, `purchase_order_receipt_lines`, `purchase_order_cancellations`, `purchase_order_events`, all append-only (an order's single approve/reject decision is the one allowed change);
  - one Phase 6 `receipt` movement per receipt line (`purchase_order_receipt_lines_one_movement`, `movement_id not null`, a matching-movement trigger, and a deferred check that every `purchase_order` movement has its receipt line); the over-receipt trigger (`CT801` unless a reason is given);
  - the planning functions (complete observations = locked and fully posted Product Mix days; 13-week same-weekday average; day-by-day usable stock; incoming buckets; constraints after the forecast) and `app_purchase_order_command` (create, approve, reject, set_expected, receive, cancel_rest, import_legacy), which takes the database clock;
  - settings that start empty: `replenishment_settings`, `replenishment_item_settings`, `replenishment_source_settings`;
  - the new permission `purchase_order.receive` (Storekeeper, System Admin). `purchase_order.propose` (create) and `purchase_order.approve` are the Phase 3 permissions, now enforced.
- Screens: `/replenishment` (plan, what-if receipt date), `/replenishment/items/<id>`, `/replenishment/orders`, `/replenishment/orders/new`, `/replenishment/orders/<id>`, `/replenishment/settings`. Arabic and English, B.Laban styling, 375 px.
- `src/modules/replenishment/planning.ts`: the same arithmetic in TypeScript; the pages recompute every item and flag a difference (none in the checks).
- P1-35: `import_legacy` maps SRC-01 `Sheet1!C6` to the historical expected receipt date and keeps the original text; tested with invented values only. No real sheet was imported.

| Acceptance check | Result | Evidence |
|---|---|---|
| Wednesday-evening order → Friday; after midnight under the 02:00 rule | **Pass** | `phase8_checks.sql` §3 (20:00 and 01:30 → Friday, 02:00 → Saturday); unit tests; `test:phase8` §4; browser |
| 10 on hand + 190 incoming = 200; forecast 150 leaves 50; stock only from movements | **Pass** | §7; unit test |
| 20 + 5 − 7 − 3 = 15; negative floors at 0 | **Pass** | §8; unit tests; `test:phase8` §4 (en, ar); browser |
| Incoming outside the window excluded; never counted twice | **Pass** | §8 (four buckets → 3); §7 |
| Changed expected date keeps the original and reason; effect on the plan | **Pass** | §9 (15 → 18); `test:phase8` §5; browser |
| Receiving 4 then 6 = 10 as two movements; retry adds nothing; over-receipt refused or audited | **Pass** | §10; `test:phase8` §7; browser |
| Cancelling the rest closes the line, no stock, history kept | **Pass** | §10; `test:phase8` §8 |
| Insufficient history → review; manual order available | **Pass** | §2, §6; `test:phase8` §3, §9 |
| Missing days excluded, not zero | **Pass** | §6 (average 4, not 12/7); `test:phase8` §4 (20, not 15) |
| Create, approve, receive enforced separately (database, HTTP, browser) | **Pass** | §5 (test-only single-permission groups, other roles, other organization); `test:phase8` §2, §4, §7; browser |

Baseline before any change (fresh database): `npm run check` (226/226 tests), `seed:check`, `seed:catalog:check`, `fieldmap:check`, `db:check` and `db:check:phase3` … `db:check:phase7` all passed.

| Command (final code, 23 November 2026) | Result |
|---|---|
| `npm run check` | `tsc` clean; 260/260 tests in 15 files; build passes (6 new dynamic pages) |
| `seed:check`, `seed:catalog:check`, `fieldmap:check` | up to date (54 fields, 6 pending) |
| `npm run db:check`, `db:check:phase3` … `db:check:phase8` | all pass on a fresh database |
| `npm run db:upgrade-test` | pass, paths A–H. H = Phase 7 → 8: committed stock movements identical in every column; `purchase_order.receive` granted; settings and orders empty; Phase 2–8 checks pass; schema and grants equal a fresh build |
| `npm run test:phase8`, `test:phase8:browser` | 109/109 HTTP; 112/112 browser (Edge, English desktop and Arabic at 375 px), no console errors |
| Earlier phases | smoke 69/69; concurrency pass; `test:phase3` 372/372; `test:browser` 105/105; `test:phase5` 147/147; `test:phase5:browser` 71/71; `test:phase6` 70/70; `test:phase6:browser` 21/21; `test:phase7` 130/130; `test:phase7:browser` 71/71 |
| `test:phase4` | 30/30 on a second, disposable local stack (`balaban-p8p4`, ports 59320–59329, PostgREST v16.5; removed afterwards). The v14.18 timeout (Phase 7 open item) was not re-run |

Mutation checks (`node scripts/phase8/mutation-check.mjs`, each guard removed inside the check's own transaction): removing the one-movement constraint, the over-receipt trigger (or only its over-receipt test), the append-only triggers of `purchase_order_lines` and `purchase_order_receipt_lines`, the `purchase_orders_read` policy (or opening it to everyone), and the deferred receipt-line trigger each made `phase8_checks.sql` fail; the unmodified file passes. Details: [REPLENISHMENT.md](phase8/REPLENISHMENT.md#acceptance).

Earlier files changed, with reasons: `scripts/phase3/upgrade-test.mjs` (path H), `tests/access-architecture.test.ts` (new action file and page guards), `src/modules/access/catalog.ts` (new permission). No earlier SQL check file changed.

Found and fixed while building: a receipt in the same minute as the order's creation was refused (now compared to the minute); order-page event times used Node's Casablanca offset (+01:00) next to PostgreSQL's (+00:00), so PostgreSQL now formats them; a composite `select … into` in plpgsql.

Open items:
- **Abdo: the open replenishment decisions.** Each is a setting on `/replenishment/settings` that starts empty. Until the minimum is set, every item stays in review and only manual orders are possible. Questions, in plain Arabic (also shown on that page):
  1. Minimum observations: «يا عبده، عشان البرنامج يقترح كمية لصنف: محتاج كام يوم كامل من نفس يوم الأسبوع (مثلاً كام سبت فات البيع والجرد بتوعهم متسجلين كاملين) قبل ما نثق في المتوسط؟ 3 ولا 4 ولا أكتر؟»
  2. Safety stock: **decided** (20 % of the coverage-period forecast, editable; implemented in `20261127090000`).
  3. Pack size, supplier minimum, shelf life, cut-off: «فيه أصناف بتتطلب بالكرتونة أو بعدد ثابت (حجم العبوة)؟ فيه أقل كمية لازم تتطلب من المصنع أو المخزن؟ الصنف بيفضل صالح كام يوم؟ وآخر ساعة ينفع تبعت فيها الطلبية لكل جهة كام؟»
  4. Exceptions to the two-day rule: «قاعدة إن الطلبية بتوصل بعد يومين من يوم الطلب: فيه استثناءات؟ مثلاً جهة بتوصل في يوم واحد، أو يوم إجازة أو يوم في الأسبوع مفيش فيه توريد؟»
  5. Orders after midnight: **decided**. The business day ends at 02:00 (Phase 4 rule, repeated by Abdo on 24 November); the application already does this.

  **Next action for the administrator.** Enter answers 1, 3 and 4 on `/replenishment/settings` when Abdo gives them. Questions 2 and 5 are no longer shown there.
- **Abdo / administrator: the first live business date.** Planning history starts there (`/comparison/settings`, the Phase 7 per-branch date). Until it is set, every item is in review. **Next action:** set it at handover (Phase 11).
- **Developer (later phase): correcting a saved purchase-order receipt.** A Phase 6 reversal refuses it on purpose; today the fixes are an over-receipt with a reason or a Phase 6 adjustment. **Next action:** design a receipt-correction command that keeps the one-movement rule.
- **Developer (Phase 11): legacy order history.** `import_legacy` exists without a screen. **Next action:** import real SRC-01 history only in a private environment, if the owner wants it.
- Planning needs real complete days: a day counts only when its Product Mix is locked and fully posted, which still waits for Abdo's recipe approvals (Phase 6 open items).

## Phase 7 status

Cross-branch sales comparison is implemented and locally accepted. It was merged into `main` through PR #12 (`a265524`) after an independent light audit, and the migration is applied to the hosted project (see [Hosted deployment](#hosted-deployment)). Design, rules and commands: [phase7/COMPARISON.md](phase7/COMPARISON.md). All test data is synthetic. The real Bourgogne reference day was not entered anywhere.

What was built:
- Migration `20261124090000_phase7_comparison.sql`:
  - `comparison_entries`: per-metric revisions with source, business date, person, reason and request identifier;
  - the one-active-value index `comparison_entries_one_active`;
  - append-only triggers;
  - `comparison_sources` and `comparison_branch_settings`;
  - `comparison_figures` as a Phase 2 compatibility view;
  - `branch_daily_figures` reading the live Phase 4 closes;
  - the checked functions `app_comparison_save`, `app_comparison_report` (view or export), the entry context, and settings.
- Screens: `/comparison` (weekly and monthly, branch selection, coverage first), `/comparison/entry`, `/comparison/history`, `/comparison/settings`, and the export `/api/exports/comparison`. All in Arabic and English.
- Permissions: the three Phase 3 permissions and group grants are unchanged. Each one is now enforced on the new objects separately.

| Acceptance check | Result | Evidence |
|---|---|---|
| Al Quds, Maarif, Bourgogne, then Total | **Pass** | `comparisons.test.ts`; `phase7_checks.sql` §3; `test:phase7` §4 (en, ar); browser in both languages |
| 120 vs 100: difference 20, weekly ratio 120 %, monthly growth 20 % | **Pass** | unit tests; `test:phase7` §4 (Maarif from closed days: +20.00, 120 %) and §5 (17 Nov vs 17 Oct +20 %, period 20 %, CSV `20.00`); browser |
| Missing days and zero prior: "unavailable" with a reason, never NaN, ∞ or 0 % | **Pass** | unit tests; `test:phase7` §4–5 (`current_unavailable`, `prior_zero`, `different_branches`, future, no such day, before live; no NaN or ∞); browser reads the reason in both languages |
| Maarif entered once in the daily close appears in closing, reports and comparison | **Pass** | `phase7_checks.sql` §4; `test:phase7` §1 (daily close page, Daily Sales CSV) and §4 (`closed_day`); no Maarif comparison entry exists |
| No comparison access → no Al Quds or Bourgogne figure (database, HTTP, browser) | **Pass** | `phase7_checks.sql` §3 (table, both views, report function; editor, exporter, cashier, manager, outsider, anonymous, other organization); `test:phase7` §3; browser cashier section |
| Second active value refused; retrying a save creates one revision | **Pass** | `phase7_checks.sql` §2 (command, compatibility view, table owner against the index); `test:phase7` §2 (form duplicate, replay, 2 rows per request) |
| Entering, viewing and exporting enforced separately | **Pass** | `phase7_checks.sql` §3; `test:phase7` §3 |
| Total over a partial selection marked incomplete with coverage | **Pass** | unit tests; `test:phase7` §4 (2 of 3 and 3 of 3, no total ratio; complete when the selection is complete); browser |

Baseline before any change (fresh database): `npm run check` (204/204 tests), `seed:check`, `seed:catalog:check`, `fieldmap:check`, and `db:check` through `db:check:phase6` all passed.

| Command (final code, 23 November 2026) | Result |
|---|---|
| `npm run check` | `tsc` clean; 226/226 tests in 14 files; build passes (3 new dynamic pages) |
| `seed:check`, `seed:catalog:check`, `fieldmap:check` | up to date (54 fields, 6 pending) |
| `npm run db:check`, `db:check:phase3` … `db:check:phase7` | all pass on a fresh database |
| `npm run db:upgrade-test` | pass, paths A–G. G = Phase 6 → 7: figures read back identically as revision 1, settings undecided, Phase 2–7 checks pass, schema and grants equal a fresh build |
| `npm run test:phase7`, `test:phase7:browser` | 130/130 HTTP; 71/71 browser (Edge, English desktop and Arabic at 375 px), no console errors |
| Earlier phases | smoke 69/69; concurrency pass; `test:phase3` 372/372; `test:browser` 105/105; `test:phase5` 147/147; `test:phase5:browser` 71/71; `test:phase6` 70/70; `test:phase6:browser` 21/21 |
| `test:phase4` | The script refuses the main local stack, so it ran on a second, disposable local stack (ports 59320–59329, removed afterwards). With PostgREST v16.5 (the image of the main stack): **30/30**. With PostgREST v14.18 (the version the CLI pins after linking the hosted project): 29/30 in three runs. The concurrent-save check failed because the losing request got a gateway timeout instead of `40001`; exactly one revision was still written. The same result appears with the database at the Phase 6 head, without the Phase 7 migration, so it is not caused by Phase 7. See the open item. |

Mutation checks: each change made `phase7_checks.sql` fail on a fresh database.
- Dropping `comparison_entries_one_active`: first at the structural assertion. With that assertion removed, at the table owner's second active insert.
- Dropping the `comparison_entries_read` policy: "the earlier revision stays readable".
- Opening that policy to everyone: "entries hidden from …".

Test changes, with reasons:
- `tests/comparisons.test.ts` and `tests/services.test.ts` were rewritten for the new calculation API. The Phase 2 cases are kept: 120 %, missing branch, zero prior, the incomplete total.
- `tests/access-architecture.test.ts` now pins "every *selected* branch" for the page guard (all three by default) and covers the three new pages and the export.
- `phase2_checks.sql` and `phase3_checks.sql` are unchanged. The compatibility view keeps their assertions true, including `update comparison_figures` → `42501`.

Found and fixed while building:
- A viewer with comparison access but no daily-close access saw a reporting-only Maarif figure instead of the closed day. The closed-day lookup now always knows which days are closed and suppresses entries for them.
- A historical figure was hidden behind a live-purpose figure on a pre-live date.
- A correction without a new reference dropped the earlier source reference.
- At 375 px the branch notes pushed the figures out of view. They moved to a list above the table.
- I had typed the real reference figure into a draft unit test. It was replaced with synthetic values before any commit.

Open items:
- **Abdo:** the approved live source and the entry owner for Al Quds and Bourgogne, and from which day their figures count. Question, in plain Arabic: «يا عبده، عشان مقارنة الفروع: أرقام فرع القدس وفرع بورجون هناخدها منين كل يوم (من سيستم الكاشير/فودكس ولا من رسالة من مدير الفرع ولا من شيت معيّن)؟ ومين الشخص اللي هيدخّلها في البرنامج لكل فرع؟ ومن أنهي يوم نبدأ نعتبر أرقامهم رسمية؟» **Next action (administrator):** record his answer on `/comparison/settings`: add the source, choose it, choose the owner and the first live date.
- **Team, private environment only:** check the SRC-12 reference day (Bourgogne 10 Nov, 28,975 MAD and 374 orders, against 3 Nov) by hand. See COMPARISON.md, "Reference case".
- **Phase 9:** decide whether historical Maarif figures before its first live date are needed for a report, and who may enter them. `comparison.enter` stays limited to comparison branches.
- **Developer (Phase 4, before hosted use):** on PostgREST v14.18, which `supabase/.temp/rest-version` records for the linked hosted project, the second of two simultaneous daily-close saves ends in a gateway timeout ("The upstream server is timing out") instead of `40001`. The data stays correct (one revision). **Next action:** reproduce against v14.18, find why the waiting request is not answered, and check the hosted behaviour before Abdo uses concurrent saves.

## Phase 6 status

Product Mix, typed stock movements, recipe consumption, physical counts and variance are implemented and locally accepted. They were merged into `main` through PR #10 (`5994747`) after the audit PR #9, and the migration is applied to the hosted project (see [Hosted deployment](#hosted-deployment)). Design, rules and commands: [phase6/STOCK_AND_VARIANCE.md](phase6/STOCK_AND_VARIANCE.md). All test data is synthetic. **Real consumption cannot post yet:** every loaded recipe is a draft, and the November versions also wait for Abdo's start date, so each real Product Mix line stays blocked (`recipe_not_approved`).

| Acceptance check (plan) | Result | Evidence |
|---|---|---|
| 10 opening + 5 received − 4 consumed = 11 expected; a count of 10 gives −1 | **Pass** | `phase6_checks.sql` §3 (consumption posted from a Product Mix through an approved recipe), `test:phase6` §5 through the real forms, `test:phase6:browser` in both languages |
| Retrying the same consumption post or receipt creates one movement | **Pass** | Same request identifier → first result returned, nothing written; a new request for an already-posted Product Mix is refused (`CT006`). SQL §3; HTTP §3–4 send the same rendered form twice |
| Products, add-ons and packaging consume the right components without duplicate usage | **Pass** | SQL §3: cake → 4 X + 2 boxes, add-on → 1/10 kg Y, one movement each; a name appears once per section |
| A blank count is incomplete; an explicit zero participates | **Pass** | SQL §3 and HTTP §5: blank refused and shown as not counted with no variance; 0 gives −9/10 (SQL) and −1 (HTTP); browser: an explicit zero for packaging is a count |
| Product Mix section totals reconcile without inflating the day | **Pass** | Section totals are check figures; locking needs lines = section totals = net sales (and = the daily close when it exists); SQL §3, §5b, HTTP §4 |
| Inventory follows Abdo's decisions (P1-24 schedule, P1-31 units, P1-32 dates) | **Pass** | Packaging counted monthly (not due mid-month); units convert exactly (1000 g → 1 kg); the gated November versions and draft recipes keep real lines blocked |
| Each consumption posting keeps its approved recipe version and exact quantities | **Pass** | Movements store the version, recipe line, recipe quantity and unit, and the exact quantity. A later version leaves the posted day identical. Closing a range over a posted day is refused (`CT004`, new trigger, the Phase 5 hook) |

| Command (23 November 2026, final code) | Result |
|---|---|
| `npm run check` | `tsc` clean; 204/204 tests in 13 files; build passes (3 new dynamic pages) |
| `npm run db:check`, `db:check:phase3` … `db:check:phase6` | all pass on a fresh database |
| `npm run db:upgrade-test` | pass, paths A–F; F = Phase 5 → 6 with the catalog intact, `inventory.consume` granted, schema and grants equal to a fresh build |
| `npm run test:phase6`, `test:phase6:browser` | 70/70 HTTP; 21/21 browser checks (Edge, English desktop and Arabic at 375 px), no console errors |
| Earlier phases | smoke 69/69, concurrency 27/27, `test:phase3` 372/372, `test:browser` 105/105, `test:phase5` 147/147, `test:phase5:browser` 71/71; `seed:check`, `seed:catalog:check` and `fieldmap:check` current |

Mutation checks: each of these made `phase6_checks.sql` fail:
- dropping the recipe-range trigger;
- dropping the movement immutability trigger;
- dropping the Product Mix lock trigger.

Dropping the one-reversal index, or the unique name-per-section constraint, is still caught by a second guard: the unique `reverses_id` on movements, and the command's own duplicate check.

Found and fixed while building:
- A PL/pgSQL variable shadowed a column.
- A JSON `null` was asserted as SQL NULL.
- A Product Mix section caption was clipped at 375 px. Its total is now a wrapping heading.

One `test:phase3` run failed its password-recovery step (the local Auth email limit is 50 per hour, and this session had sent many). Rerun alone it passed 372/372. Phase 6 does not touch authentication.

Open items:
- **Abdo:** the November recipe start date, and the review-queue approvals (Phase 5 list) before real consumption.
- **Abdo:** which day Packaging is counted. The application treats the last day of the month as due.
- **Phase 8:** link receipts to purchase-order lines (one movement per receipt line).
- **Phase 11:** opening stock for the first live date.
- **Developer:** retire the Phase 3 reason-only `/inventory/adjustments` once nobody uses it.

## Hosted deployment

**23 November 2026: migration `20261125090000_phase8_replenishment.sql` was applied to the shared Supabase project `xitryskkqgtkpdawddqe` from `main` at `e1403fb`.**

| Step | Result |
|---|---|
| Before | The hosted migration history matched `main` through `20261124090000` (Phase 7). Only `20261125090000` was missing. |
| Dry run (`npx supabase db push --linked --dry-run`) | Would push only `20261125090000_phase8_replenishment.sql`; seeds `[]`, roles `[]`. |
| Push (`npx supabase db push --linked`, no `--include-seed`) | Applied `20261125090000_phase8_replenishment.sql`; seeds `[]`. |
| Migration history after | `20261124090000` and `20261125090000` are listed remotely. A second dry run reports "Remote database is up to date". |
| Read-only checks on the hosted database (`npx supabase db query --linked`) | The 10 Phase 8 tables exist with row-level security enabled. `purchase_order_receipt_lines_one_movement` is `UNIQUE (movement_id)`; the receipt-line guard, the order decision guard, the append-only triggers and the deferred `stock_movements_purchase_order_receipt` trigger exist. Permissions: `purchase_order.propose` → storekeeper, system_admin; `purchase_order.approve` → system_admin; `purchase_order.receive` → storekeeper, system_admin (the same as a fresh local build). The internal command that takes an instant is closed to `authenticated`, the public command to `anon`. 0 orders, 0 receipts, 0 purchase-order stock movements and 0 replenishment settings, so no local test data was sent and the open decisions are still empty. |

The Supabase CLI login had expired again (`Invalid access token`); the project owner signed in with `npx supabase logout` and `npx supabase login` before the dry run. No credentials are stored in the repository. As for Phases 6 and 7, the SQL acceptance files and the HTTP and browser checks were not run against the hosted project. Until the minimum number of observations and the first live date are set, every item on the hosted planning page is in review; manual orders work.

**Earlier, 23 November 2026: migration `20261124090000_phase7_comparison.sql` was applied to the shared Supabase project `xitryskkqgtkpdawddqe` from `main` at `a265524`.**

| Step | Result |
|---|---|
| Before | The hosted migration history matched `main` through `20261123120000` (Phase 6). Only `20261124090000` was missing. |
| Dry run (`npx supabase db push --linked --dry-run`) | Would push only `20261124090000_phase7_comparison.sql`; seeds `[]`, roles `[]`. |
| Push (`npx supabase db push --linked`, no `--include-seed`) | Applied `20261124090000_phase7_comparison.sql`; seeds `[]`. |
| Migration history after | `20261124090000` is listed both locally and remotely. A second dry run reports "Remote database is up to date". |
| Read-only checks on the hosted database (`npx supabase db query --linked`) | `comparison_entries`, `comparison_sources` and `comparison_branch_settings` exist with row-level security enabled; `comparison_figures` and `branch_daily_figures` are views. The `comparison_entries_one_active` index and both append-only triggers exist. Permissions: `comparison.enter` → comparison_editor, system_admin; `comparison.view` → manager, system_admin; `comparison.export` → system_admin (the same as a fresh local build). 0 comparison entries and 0 branch settings, so no local test data was sent and the live source for Al Quds and Bourgogne is still undecided; 1 source designation (`reporting_only`, from the migration). |

The Supabase CLI login had expired again (`Invalid access token`); the project owner signed in with `npx supabase login` before the dry run. No credentials are stored in the repository. As for Phase 6, the SQL acceptance files and the HTTP and browser checks were not run against the hosted project.

**Earlier, 23 November 2026: migration `20261123120000_phase6_stock.sql` was applied to the shared Supabase project `xitryskkqgtkpdawddqe` from `main` at `5994747`.**

| Step | Result |
|---|---|
| Before | The hosted migration history already held `20261121000001` through `20261122120000`, which matched `main` through Phase 5. Only `20261123120000` was missing. |
| Dry run (`npx supabase db push --linked --dry-run`) | Would push only `20261123120000_phase6_stock.sql`; seeds `[]`, roles `[]`. |
| Push (`npx supabase db push --linked`, no `--include-seed`) | Applied `20261123120000_phase6_stock.sql`; seeds `[]`. |
| Migration history after | `20261123120000` is listed both locally and remotely. A second dry run reports "Remote database is up to date". |
| Read-only checks on the hosted database | All 10 Phase 6 tables exist with row-level security enabled. `inventory.consume` is granted to manager, storekeeper and system_admin. The `recipe_versions_keep_postings` trigger exists. The new tables hold 0 rows, so no local test data was sent. 0 approved recipe versions, so real consumption remains blocked. |

Earlier attempts in the same session failed. The Supabase CLI's stored login returned `Invalid access token` until the project owner signed in again (`npx supabase login`) and linked the project. The project owner entered the credentials; none are stored in the repository.

Not done on the hosted project: the Phase 2–6 SQL acceptance files. They create synthetic staff and roll back, but they are meant for disposable databases and were not run against the shared project. The HTTP or browser checks were not run against a hosted deployment either. The Auth settings, `SITE_URL`, SMTP and Abdo's account remain part of production provisioning (Next steps, item 2).

## Independent audit of Phases 6–10 (26 November 2026)

**Audited commit:** `11af5dd7000323d3bdd13454ea4ddc12489a0dcf` (`origin/main`, Phase 10 merged in [PR #17](https://github.com/MohammedHssan11/blabn/pull/17)), branch `audit/phases-6-10`. [PR #18](https://github.com/MohammedHssan11/blabn/pull/18) (deployment record) was open and was not merged. The audit ran on 25 and 26 November on Windows 11 with Node 22.21 (time-zone data 2025b), Python 3.10 with openpyxl 3.1.5, Supabase CLI 2.122.1, PostgreSQL 17.11, Microsoft Edge and Docker. All database, HTTP and browser checks used a separate copy, `abdo-audit610-validation`, with its own disposable stack `balaban-a610` (ports 60320–60329). `balaban-dev` and the hosted project were not touched: no push, SQL or account change. The Phase 10 rehearsal read the private workbook reference from `outputs\phase10\`.

**Baseline.** Before any change, all 22 requested commands passed on the audited commit. The defects below are not covered by those checks.

### Defects found and fixed

Each was reproduced on the audited code first. Database changes are in the new migration `20261128090000_audit_phases6_10_fixes.sql`; no applied migration was edited.

| # | Phase | Defect (reproduced first) | Fix | Regression coverage |
|---|---|---|---|---|
| B1 | 6, 8 | **The history page of any item received through a purchase order crashed** (HTTP 500, both languages): the movement source `purchase_order` had no label. The page also offered a reversal that the database always refuses. | Both labels added; no reversal offered for those receipts. | Unit test (every source the database allows is translated); `test:phase8` §11 |
| B2 | 6 | **Changing an item's base unit reinterpreted saved stock** (5 kg received became 5 g). The Phase 5 guard looked only at approved recipes and conversions. | The unit is kept once the item has movements, counts, adjustments, order lines or planning quantities. | Audit SQL §2; 4 mutations |
| B3 | 6 | **Recipe consumption and adjustments could be dated before the opening stock** (opening 10, then consumption of 6 posted for the day before: book 4). Only manual movements and order receipts were refused. | Refused on every path (`CT007`, with a message in both languages). A reversed opening no longer blocks. | Audit SQL §3; 3 mutations; upgrade path K |
| B4 | 6 | A direct adjustment decision without `decision` **rejected** the adjustment. The screen always sends one. | The command requires approve or reject. | Audit SQL §4; 1 mutation |
| B5 | 6, 7, 9 | **Between 01:00 and 02:00 Casablanca time, pages opened on the next business date.** Node's time-zone data is an hour ahead of PostgreSQL's. Seen live at 01:38 on 26 November: stock, Product Mix, comparison and export pages showed 26 November while the business date was 25; the default export was refused. | Pages ask the database (`app_business_today`). Rechecked live in the same window. | Unit test; audit SQL §1; `test:phase8` §11; 1 mutation |
| B6 | 6, 7 | Posting times on the item history showed one hour later than the database's times beside them. The comparison history formatted entry times the same way (from the code). | Formatted from the database's local time (`app_local_times`). | Unit test; audit SQL §1; `test:phase8` §11; 1 mutation |
| B7 | 6 | **After midnight, the default time on stock and Product Mix forms was a day early** (today's business date joined to the clock time), so saving the default was refused. Seen live with B5 already fixed. | The database's current local date and time is the default. | Unit test; `test:phase8` §11 |
| B8 | 7 | **Total order counts silently left out a branch that had sales but no order count** (weekly, monthly day and period; screen, CSV and Excel). | The total is blank, as the difference already was. | Unit tests |
| B9 | 9 | The Daily Sales workbook's period average was too high, with no warning, when an included day had sales but no order count. The daily-close page warns. | A warning row. Template `daily_sales@1.0.1`, calculation rules `p9-calc-2026.11.25`. | Unit test |
| B10 | 9 | A pending or rejected correction's revision number was recorded as the source of the **effective** figures (Yawmeya "Revision" and `sources.day_revisions`). | The effective revision is recorded. | Unit test |
| B11 | 8, 9 | **The inventory workbook omitted purchase orders:** any older than the newest 500, and orders of an earlier month expected later in the current month. | `app_purchase_orders_in_period` over the whole period. | Audit SQL §5; `test:phase9` §6b; 1 mutation |
| B12 | 9 | An interrupted build stayed "Building" with **no Retry button**, although the database allows a takeover after 10 minutes. | Retry is offered for every unfinished export. | `test:phase9` §6b |
| B13 | 9 | **An export's data snapshot could precede the commit of a stock write already in progress**, so figures "as of" the snapshot changed during the build (0 movements, then 1). | The claim waits for the branch lock before taking the instant. | `test:audit:snapshot` (two sessions); audit SQL §6; 1 mutation |
| B14 | 8 | A planned line with a suggestion of 0 was pre-filled "0", so **the whole order was refused**. | Left blank; the line is skipped. | `test:phase8` §11 |
| B15 | 8 | With a source lead-time exception, an order made from the plan could be refused as "suggestion changed" **every time**. The exceptions are empty today. | The page uses the expected date creation will use; a refused send returns with the chosen sources. | `test:phase8` §11 |
| B16 | 8 | The plan page reported a false database/application difference when today's forecast was 0 and some consumption was already posted. Reproduced with a plan shaped as the database function returns it. | The cross-check handles a zero forecast. | Unit test |
| B17 | 10 | `test:phase10` without `P10_OUTPUT_DIR` crashed in its scenarios (`TypeError`, 65 checks, 1 failure). | A temporary folder by default. | Run without the variable |

Candidates investigated and **not** defects:

- **Replacing a stored export file.** Through the Storage API, a signed upload link with overwrite was refused; a link without it could be made during a running attempt but was refused once the file existed; direct overwrite and removal were refused. The completed file stayed byte-identical.
- **Idempotency.** Stock, comparison, purchase-order and export requests return the first result for a repeated identifier and refuse reuse with other content (traced in the migrations; covered by the SQL and HTTP suites).
- **Safety stock.** The database and TypeScript use the same rule; `build_safety_migration.py --check` confirms the migration differs from the Phase 8 functions only as generated. The percentage is refused above 100 or with more than two decimals, including `0.000`.

### Results by phase

"Pass" means on the audited commit plus these fixes, in the local environment above.

| Phase | Acceptance item | Result | Traced to |
|---|---|---|---|
| 6 | 10 + 5 − 4 = 11; a count of 10 gives −1 | **Pass** | `stock_day` (exact fractions: opening, day movements, expected at count, variance); `phase6_checks.sql` §3; `test:phase6`, browser |
| 6 | Retrying a consumption post or receipt creates one movement | **Pass** | `stock_postings unique (branch_id, request_id)` with actor and payload hash under the branch lock; `stock_consumption_lines unique (mix_line_id, attempt)`; one reversal per posting and movement; SQL and HTTP resend |
| 6 | Products, add-ons and packaging consume once | **Pass** | `post_consumption` takes only lines without an unreversed consumption line, through `catalog_consumption`; one name per section; SQL §3 |
| 6 | Blank count incomplete; explicit zero counts | **Pass** | `parse_count`, no row for a blank; `status` counted / missing / not_due; `normalizeCountInput`; SQL §3, §5; browser |
| 6 | Section totals reconcile without inflating the day | **Pass** | `mix_reconciliation` (lines = section = net = daily close) required by `mix_lock`; section totals are never movements; lock and detail triggers |
| 6 | Figures follow the Phase 1 outcomes and Abdo's decisions | **Partial** | Count schedule (P1-24), units (P1-31) and the date gate (P1-32) hold. The carried-count rule of INV-04 is not implemented (open item 1) |
| 6 | Permissions and append-only history (work items) | **Pass after B1–B4, B6, B7** | `stock_command` permission per command and per reversed posting; RLS on `inventory.view`, select-only grants; triggers against update, delete and truncate; page and action guards |
| 7 | Al Quds, Maarif, Bourgogne, then Total | **Pass** | `BRANCH_ORDER`, `orderBranches`, export builder; unit, SQL, HTTP, browser |
| 7 | 120 vs 100: 20, 120 %, growth 20 % | **Pass** | `calc.ts` (centimes, basis points); the Excel builder takes the same result; unit, HTTP, browser |
| 7 | Missing days and zero prior are safe | **Pass after B8** | Reasons instead of ratios; totals over different branches give none; sales and orders blank, never 0 |
| 7 | Maarif entered once appears everywhere | **Pass** | `comparison_closed_days` reads the effective closed revision and suppresses entries for that date; `phase7_checks.sql` §4; `test:phase7` |
| 7 | No access, no Al Quds or Bourgogne figure | **Pass** | `comparison_entries_read`; `app_comparison_report` checks view or export per branch; internal functions are outside the exposed schemas; page, export route and database separately |
| 7 | Revisions, one active value, entry / view / export separate | **Pass** | `comparison_entries_one_active`, guard trigger, `app_comparison_save` (owner, dates, request hash, branch lock); SQL §2–3 and mutations recorded in Phase 7 |
| 8 | Wednesday evening → Friday; 02:00 business day | **Pass** | `purchase_order_command` takes only the database clock; `business_date_of`; `phase8_checks.sql` §3 |
| 8 | 10 + 190 − 150 = 50; stock only from receipts | **Pass** | `replenishment_item_plan` bridge; deferred receipt-line trigger; SQL §7; unit |
| 8 | 20 + 5 − 7 − 3 = 15; floor at 0 | **Pass** | Plan function and `planning.ts` agree (the page cross-check, B16); with the default 20 % the same case gives 14 |
| 8 | 20 % safety stock, editable, 0 allowed | **Pass** | `20261127090000`: default 20, 0–100 with two decimals, added once before usable and incoming, then minimum and pack; per-item quantity refused; saved lines keep their plan; upgrade path J |
| 8 | Incoming outside the window excluded, never twice | **Pass** | Buckets overdue / before receipt / window / after window; SQL §8; unit |
| 8 | Changed expected date keeps original and reason, shows effect | **Pass** | Append-only revisions; `set_expected`; SQL §9; HTTP, browser |
| 8 | 4 then 6 = 10 as two movements, no duplicate; over-receipt | **Pass** | `purchase_order_receipt_lines_one_movement`, line guard (`CT801`), request hash; `scripts/phase8/mutation-check.mjs` |
| 8 | Insufficient history → review, manual order possible | **Pass after B14, B15** | Review reasons; no safety stock in review; manual line; HTTP §3, §9, §11 |
| 8 | Create, approve, receive separate | **Pass** | Command permission map and RLS; SQL §5. The date-change form action asks only `inventory.view`; the database then requires propose or approve |
| 9 | Every family opens and prints clearly in Excel | **Pass** (22 workbooks opened and paginated in desktop Excel 16; not printed on paper) | `xlsx.ts`, `scan.ts`; `test:phase9`, `test:phase10` |
| 9 | Shared values consistent | **Pass** | One revision basis per file; `test:phase9` §4 |
| 9 | Earlier export reviewable with its source revision | **Pass after B10, B13** | Completed rows frozen by trigger; no storage update or delete policy; checksum checked at download; §5 |
| 9 | Partial months and missing values keep their meaning | **Pass after B8, B9** | Typed blanks; days included "n of m"; unit tests, §3–4 |
| 9 | Failed export retryable, no duplicate completed file | **Pass after B12** | Attempt claim, path per attempt, stale attempts refused; §6, §6b |
| 9 | Download fails after the permission is lost | **Pass** | Route, `app_report_export_download` and the storage policy each recheck the designated account and every branch; signed links refused; §7 |
| 9 | Historical figures only where needed; no live change | **Pass** | Only `comparison_entries`; §10 |
| 9 | One designated exporter, private bucket, values only, Arabic right to left | **Pass** | `app_private.report_export_owners` (no API grant); private 25 MiB XLSX bucket, insert and authenticated-read policies only; scan; orders complete after B11 |
| 10 | One day entered once produces the five families | **Pass (technical)** | `test:phase10` on the private reference |
| 10 | Results match independent calculations and agreed rules | **Partial** | `compare_reports.py`: 994 comparisons, the same 5 differences as Phase 10 (D-1, D-2); inventory values not compared (D-6) and open item 1 |
| 10 | Each material difference has a documented resolution | **Partial** | D-1 to D-6 are documented with owners and still open |
| 10 | Arabic and English give the same values | **Pass** | One model for both languages, identical numeric cells (`test:phase9`), browser checks |
| 10 | Abdo accepts the workflow | **Not done** | Walkthrough not run |
| 10 | P1-19 field-map fix; safety-percentage validation | **Pass** | Builder honours agreed outcomes (`fieldmap:check`); browser and database refuse more than two decimals |

### Commands and results

All commands ran in the disposable copy. "Baseline" is the unchanged audited commit; "with fixes" is the final code.

| Command | Baseline | With fixes |
|---|---|---|
| `npm ci` | pass | pass, 0 vulnerabilities |
| `npm run check` | `tsc` clean; 297/297; build | `tsc` clean; **307/307** in 17 files; build |
| `npm run seed:check`, `seed:catalog:check`, `fieldmap:check` | pass | pass |
| `extract_catalog.py --check`, `build_safety_migration.py --check` | not run | pass |
| `npm run db:check`, `db:check:phase3` … `db:check:phase9` (fresh database) | pass | pass |
| `npm run db:check:audit` (new) | fails: the new functions do not exist | pass |
| `node scripts/audit/mutation-check.mjs` (new) | — | control passes; all 12 mutations caught |
| `node scripts/phase8/mutation-check.mjs` | not run | every mutation caught |
| `npm run db:upgrade-test` | pass, paths A–J | pass, paths A–K (new path K: Phase 10 head with saved stock → audit fixes) |
| `npm run test:audit:snapshot` (new) | fails: 0 movements when claimed, 1 afterwards | 2/2 |
| `npm run test:smoke`, `test:concurrency` | not run | 69/69; pass |
| `npm run test:phase3`, `test:browser` | not run | 372/372; 105/105 |
| `npm run test:phase4` (after a reset) | not run | 30/30 |
| `npm run test:phase5`, `test:phase5:browser` | not run | 147/147; 71/71 |
| `npm run test:phase6`, `test:phase6:browser` | 70/70; 21/21 | 70/70; 21/21 |
| `npm run test:phase7`, `test:phase7:browser` | 130/130; 71/71 | 130/130; 71/71 |
| `npm run test:phase8` | 112/112 | 124/124 |
| `npm run test:phase8:browser` | 112/112 | 112/112 |
| `npm run test:phase9` | 124/124 | 128/128 |
| `npm run test:phase10` | 78/78 | 78/78, with and without `P10_OUTPUT_DIR` |
| `scripts/phase10/compare_reports.py` | not run | 994 comparisons, 5 differences: D-1 (four cells) and D-2 (one), as recorded in Phase 10 |
| `node scripts/phase10/browser-check.mjs` | 35/35 | 35/35 |
| Desktop Excel 16, opened read-only: the 22 rehearsal workbooks | not run | all open; correct direction; A4 fitted to width; no formula, error cell or external link |

New checks run against the **unchanged** code: all 10 new unit tests failed; the new `test:phase8` section failed 9 checks (123 run); `test:phase9` stopped at the missing Retry button.

The first full run with the fixes had two failures, both rerun above. The new `test:phase8` section left an 8-day lead time configured, so four `test:phase8:browser` checks failed; the section now removes it. One `db:upgrade-test` reset step failed because Windows could not start Docker (`EPERM … uv_spawn 'docker'`).

Live grants on the final database: nothing for anonymous callers; every `public` table has row-level security; the only writes open to signed-in people are the two intended inserts (the Phase 3 `inventory_adjustments` and the checked `comparison_figures` view); every `security definer` function fixes its search path.

### Not verified

- The hosted project. Migration `20261128090000` is **not applied** there.
- A printed paper copy, Excel for Mac, Excel on another machine, LibreOffice, Safari or a physical phone.
- Abdo's walkthrough and acceptance.
- B8, B9, B10 and B16 are shown by unit tests, not on a live page or in a downloaded file. For B6, the item history was checked over HTTP; the comparison history only by the source check and the database function.
- Workbook values were not compared by hand with the source workbooks beyond `compare_reports.py`.

### Open items (owner, next action)

1. **Stock counts and the next day's opening — Abdo, then developer.** The field map (INV-04, agreed by the team; correction P1-24) says the next day opens at the physical count, or at the book balance when not counted. The application's opening is every earlier movement; a count never changes it unless an adjustment is approved (the Phase 6 design). Reproduced: opening 10, count 9, next day with no movement and count 9 gives opening 10 and variance −1 again. The inventory workbook's cumulative and month deviation add the daily variances, so **one unadjusted shortage of 1 is reported as −2 after two counts, and grows with every count** (from the builder's code). Not changed: it decides saved figures, like D-1 for cash. Question: «يا عبده، في الجرد: لو عدّيت صنف وطلع غير الرصيد الدفتري، «أول المدة» لليوم اللي بعده تبقى رقم العد الفعلي (زي ملف الإكسل المصحح)، ولا تفضل على الدفتري لحد ما حد يعتمد تسوية؟» Settle it before the first live inventory month.
2. **Deployment — project owner.** Apply `20261128090000` to the hosted project **before** running this code against it: item and comparison history and the inventory export call its functions. The dry run must list only that migration and no seeds.
3. **Open business decisions — Abdo.** D-1 cash carry-forward, D-2 purchasing custody, D-3 cancellation and hospitality columns, D-5 back-filling skipped days (also D-4 rounding, D-6 inventory values); P1-32 November recipe start date; minimum observations; pack sizes, supplier minimums, shelf life, cut-off times and lead-time exceptions. None was decided or changed.
4. **Developer (later).**
   - The orders page lists the newest 200 orders only; an older open order is reachable only by its link.
   - The audit and staff pages (Phase 3) still convert times with Node's time-zone data.
   - The two export audit actions have no label (the code is shown).
   - Product Mix and purchase orders in an inventory export are read as they are at build time, not as of the snapshot.
   - The export's checksum and sources are supplied by the requester's own session; the database verifies only that the file exists with that size.
   - Product Mix reconciliation with the daily close is checked when locking; a later close correction shows a mismatch but does not reopen the report.
   - After a wrong opening is reversed, a new opening cannot be recorded; the correction is an adjustment.
   - The Phase 4 concurrent-save timeout on PostgREST v14.18 was not re-run.
5. **Repository visibility — project owner.** Still public (Phases 1–5 audit, open item 1).

## Independent audit of Phases 1–5 (23 November 2026)

**Audited commit:** `3145a38` (`origin/main`, Phase 5 merged in PR #8), checked out fresh as branch `audit/phases-1-5`. The previous checkout was still at `1502722`. Its one untracked file (an older `docs/ARCHITECTURE_REVIEW.md`) was kept in a local Git stash and not committed. Every check below was rerun on this commit in a Windows 11 checkout with Git's default `core.autocrlf=true`, Node 24.15, Python 3.10 with openpyxl 3.1.5, desktop Excel 2019 (16.0), and Docker Desktop. The two disposable local Supabase stacks used Supabase CLI 2.122.1 and PostgreSQL image 17.11.0.006. Nothing ran against a hosted project. No real reference day was entered. All accounts and data were synthetic.

### Defects found and fixed

| # | Defect (reproduced first) | Fix | Regression coverage |
|---|---|---|---|
| A1 | **`npm test` failed on a clean Windows checkout:** 3 of 190 tests in `tests/access-catalog.test.ts`. Git for Windows checks the migrations out with CRLF, and the test's statement-end patterns match `\n` only, so it parsed no permissions, groups or grants. | The test normalizes line endings when it reads a migration, as `catalog.test.ts` and `seed.test.ts` already do. | The same three tests now pass on CRLF and LF checkouts: 190/190. |
| A2 | **The local database could not be started from a clean checkout.** The repository does not pin the Supabase CLI, and every script calls `npx supabase`. A global CLI 2.102 refused `supabase/config.toml` (`local_smtp`, `auth.email.enabled`, `db.orioledb_version`), and without a global CLI, `npx` would fetch whatever version is current. | `supabase` 2.122.1 is pinned as an exact dev dependency. The runbook in [phase3/ACCOUNTS_AND_PERMISSIONS.md](phase3/ACCOUNTS_AND_PERMISSIONS.md#verifying) says to run `npm ci` and lists the services the checks do not need. | The whole suite below ran through the pinned CLI. |
| A3 | **The committed report field map was stale.** `agreed-outcomes.json` records Abdo's later answers for P1-19 (Phase 4) and P1-24 (22 November), but `FIELD_MAP.md` and `field-map.json` were not regenerated. LG-01 (business date and branch) and INV-08 (book balance) showed "agreed (team)" instead of "agreed (Abdo)". The summary showed 43/5 instead of 41/7. | The map was regenerated. Only those two statuses and the summary changed. | `npm run fieldmap:check` (`build_field_map.py --check`) fails on the stale map and passes on the current one. Run it after every `record_outcome.py`. |

No defect was found in the application code, migrations, policies or calculations. Two candidate issues were investigated and found to be by design:

- `app_operating_report` looks up a branch by code without an organization filter. It runs with the caller's rights, and the `branches_select` policy (`can_see_branch`) already hides other organizations' branches.
- A later day's stored expected cash is not recomputed after an earlier day is corrected. [OPERATING_CLOSE.md](phase4/OPERATING_CLOSE.md) defines it as an as-counted result, and the opening and carry-forward views do update.

### Results by phase

| Phase | Acceptance item | Result on `3145a38` + fixes | How it was checked |
|---|---|---|---|
| 1 | 37 findings against their sources | **Pass.** 37 unique IDs. Every location resolves to a tracked file or a recorded local source and names its sheet or cell. Statuses: 19 verified, 6 partial, 7 rules, 4 deferred, 1 decision. Each partial finding names what remains. | Independent script over `findings.json`, `source-inventory.json` and `corrections-log.csv` (4,400 operations: 4,082 applied, 318 deferred by the owner) |
| 1 | Corrected copies vs originals | **Pass.** 0 unexplained changes in all 13 copies. The 12 tracked originals match their recorded SHA-256. SRC-13 and SRC-14 match the hashes recorded for the local originals LOC-01 and LOC-02. | `diff_corrected.py` (output byte-identical to the committed file), hash comparison |
| 1 | Value checks | **Pass.** 71/71 (26 independent, 37 construction, 8 decision). Excel error cells: 54,206 → 0 in the 11 non-ledger copies, 89 → 85 in the ledgers. | `verify_fixes.py` (output byte-identical to the committed file) |
| 1 | Excel boundary tests in desktop Excel | **Pass.** 26/26: blank vs zero, empty periods, the four average-order cases, inventory blank vs explicit zero counts, monthly deviation. | `boundary_tests.ps1` in Excel 2019 (only the timestamp in `boundary-tests.json` changed) |
| 1 | Excel recalculation of the originals | **Pass.** 983,305 formulas, 0 differences between cached and recalculated values. The earlier 984,217 also covered 912 formulas in the local-only LOC-03 and LOC-04, which were not available (open item 4). | Full rebuild in Excel 2019 of scratch copies of the 14 tracked workbooks; every formula's cached value compared with the recalculated one |
| 1 | Abdo's six answers traced to corrections and rules | **Pass.** **P1-03** (accept): `D3:D33` = `IF(N(C)=0,"",ROUND(B/C,2))` in both Daily Sales copies; 1 Oct = 50,125 ÷ 632 = 79.31; 2 Nov = 48,695 ÷ 639 = 76.21; originals keep the typed values; the app averages net sales ÷ orders and leaves zero or blank orders blank (SQL and unit tests). **P1-08** (keep): the weekly ratio cells stay `=C6/G6`-style current ÷ prior. **P1-10** (accept): all four current dates are 10 Nov and all four prior dates 3 Nov, all Tuesdays. **P1-13** (accept): the count precedes the remittance (expected cash through the count instant; Phase 4 SQL and browser). **P1-29** (keep): SRC-13 `'7'!F327` = 12 in the copy and the original; the Kinder mapping stays a separate pending review. **P1-35** (keep): two-day rule; the legacy date is confirmed as expected receipt in `agreed-outcomes.json` (22 Nov). | Audit script reading the cells; decision records |
| 1 | Question locations, field map, closure | **Pass.** 169/169 location checks. Field map: 54 fields, 6 pending for later phases (after fix A3). `phase1_status.py`: "Phase 1 can close". | `verify_questions.py`, `build_field_map.py --check`, `phase1_status.py` |
| 2 | Setup from a clean checkout | **Pass after A1 and A2.** `npm ci`, then `npx supabase start` with the pinned CLI applies 12 migrations, the seed and the catalog seed. | Fresh branch from `origin/main` and a fresh local stack |
| 2 | Typecheck, unit tests, build | **Pass.** `tsc` clean; 190/190 tests in 12 files; production build passes (39 pages generated). | `npm run check` |
| 2 | SQL checks, seeds, smoke, Arabic and English | **Pass.** Phase 2 SQL checks; `seed:check` and `seed:catalog:check` up to date; 69/69 smoke checks (language routing and cookie, `lang`/`dir` on every page, the cash-count example in both languages, 54 fields with 6 pending). | `npm run db:check`, `npm run test:smoke` |
| 3 | Sign-in, recovery, roles, branch isolation, audit, upgrade | **Pass.** Phase 3 SQL checks; 27/27 concurrency checks (at least one System Admin remains in every round); 372/372 HTTP checks; 105/105 browser checks in Edge in English and Arabic, with no console errors; upgrade test sections A–D (including the flagged-account and email-reconciliation upgrade); schemas and grants match the fresh build. | `db:check:phase3`, `test:concurrency`, `test:phase3`, `test:browser`, `db:upgrade-test` |
| 4 | Daily close, denominations, blank vs zero, shortage and overage, remittance, Yawmeya, corrections, reproducible reports | **Pass.** Phase 4 SQL checks: Casablanca GMT in November and the 02:00 cutoff boundaries; missing count blank; explicit zero count real (−497.00); match 0, overage +3.00, shortage; duplicate deposit refused; variance unchanged after the late remittance; correction approval updates the current day-2 opening while the earlier basis is preserved; 17 audit rows. Browser check: 30/30 on a second, empty, disposable stack, then removed. Covers the English desktop and Arabic 375 px statement and Yawmeya, one bank movement, a byte-identical earlier CSV basis, and two simultaneous saves giving exactly one revision. | `db:check:phase4`, `test:phase4` |
| 5 | Mappings, units, exact recipe quantities with packaging, effective dates, approvals | **Pass.** Phase 5 SQL checks; 147/147 HTTP checks; 71/71 browser checks; upgrade section E (Phase 4 → 5: 556 items, 1,721 recipe lines, Phase 2–5 checks, schema equal to a fresh build); `catalog:extract -- --check` and `seed:catalog:check` up to date. | `db:check:phase5`, `test:phase5`, `test:phase5:browser`, `db:upgrade-test`, extraction check |
| 5 | Blocked lines stay blocked, valid lines resolve, later versions keep earlier results | **Pass (independent probe, rolled back).** See the details below the table. | Separate SQL probe on synthetic items against the clean seed (not committed; it duplicates `phase5_checks.sql` coverage) |

Phase 5 probe details:

- **Blocked lines.** One request held an unmapped name, a pending Foodics name and a zero quantity. Those three lines were blocked with reasons and consumed nothing. Two valid lines in the same request resolved.
- **Exact totals.** Totals came out exact with a component used twice in one recipe and a carton → piece packaging conversion: flour 69/400 kg, boxes 9/2, spoons 9.
- **Later versions.** Approving version 2 closed version 1 on 4 Nov and left the 15 Oct result identical. 5 Nov uses version 2. 30 Sep reports `no_recipe_for_date`.
- **Refusals.** Same-day and backdated overlaps were refused. So were direct line edits, a change to a conversion an approved recipe uses, and approval by a storekeeper.
- **Seed state.** A gated November version is refused with `CT001`. No loaded recipe is approved.

### Open items (owner, next action)

1. **Repository visibility — project owner (MohammedHssan11).** GitHub shows `MohammedHssan11/blabn` as **public**, but the documents above require a private repository. The public repository holds the original workbooks, the corrected copies, the 7 November report photos, Abdo's decision text and the local folder paths. No credential or customer phone number was found: `git grep` across history; the non-inventory workbooks were scanned for phone-like values. **Next action:** change the visibility to private in the repository settings, then decide whether history needs to be rewritten. The files have been public since at least commit `1502722` (11 November), so treat them as already exposed. This audit added nothing sensitive.
2. **November recipe start date (P1-32) — Abdo.** Record it on `/catalog/review`. Until then the 11 affected November versions stay drafts, and their consumption stays blocked.
3. **Remaining catalog approvals — Abdo or the catalog owner.** Six proposed Foodics names, the Kinder cake (P1-29), 18 unit conflicts, 61 empty Product Mix rows, 9 unlinked recipes and 69 components missing from the inventory list (see the Phase 5 list below). **Next action:** go through the review queue before Phase 6 posts real consumption. All recipes are drafts.
4. **Phase 1 checks that need local-only material — project owner.**
   - The byte comparison against `abdo temp/` (LOC-01) was replaced by the recorded-hash match above.
   - LOC-03 and LOC-04 (`outputs/`) and the cell-cache steps of `extract_workbooks.py` and `compare_recalc.py` were not rerun.
   - The 318 protected-sheet corrections remain deferred by the owner and need the sheet password.
   - **Next action:** only if the owner wants them, rerun those scripts on the machine that holds the local folders.
5. **Voice-note decisions — project owner with Abdo.** The 21 and 22 November decisions are transcribed from private audio that this audit did not have. **Next action:** confirm them at the scheduled Phase 10 walkthrough.
6. **Stale history notes — project owner (low).** `findings.json` (`remaining_en` for P1-24 and P1-35) and `owner-deferrals.json` (`legacy-order-sheet-date`: deferred) predate the 22 November answers. `agreed-outcomes.json`, `CLOSURE.md` and the Phase 1 README carry the current outcome. They were left unchanged as the dated Phase 1 record. Update them only through `record_outcome.py` if the owner wants them aligned.
7. **Environment notes — developer.**
   - The pinned CLI uses PostgreSQL image 17.11.0.006 (earlier sessions recorded 17.12). The Casablanca assertions pass on it. Rerun them on the hosted image before any operational use.
   - `test:phase5` and `test:phase5:browser` leave approved synthetic recipes in the local database. Run `npx supabase db reset` before using it for anything else.
   - Not run in this audit, as before: hosted Supabase, a real SMTP provider, Safari, a physical phone.

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
| `npm run typecheck`, `npm test`, `npm run build` | clean; 190/190 tests in 12 files; build passes (the catalog adds 7 dynamic pages) |
| `npm run db:check`, `db:check:phase3`, `db:check:phase4`, `db:check:phase5` | all pass on a fresh database |
| `npm run db:upgrade-test` | pass (paths A to E, including the new Phase 4 to 5 upgrade) |
| `npm run test:concurrency` | pass |
| `npm run test:phase3` (HTTP), `npm run test:browser` | 372 checks, 0 failed; 105 browser checks, 0 failed |
| `npm run test:smoke` | 69/69 |
| `npm run test:phase5` (HTTP) | 147/147, including exact quantity editing and oversized preview checks |
| `npm run test:phase5:browser` (Edge) | 71/71, no console errors |
| `npm run test:phase4` (Phase 4 browser regression) | 30/30, run on the Phase 5 production build against an isolated local Supabase project (stopped and removed afterwards) |
| `seed:check`, `seed:catalog:check`, `catalog:extract -- --check` | up to date |

Mutation checks on `phase5_checks.sql`: dropping the line-immutability trigger, opening the catalog read policy, counting a draft as approved, skipping the date gate, resolving a pending mapping, converting an incompatible unit, and ignoring recipe ranges each made the file fail.

### Self-audit: found and fixed

1. **Recipe quantities are not decimals.** The workbooks contain `=0.1/3` and an eleven-digit formula; a decimal column would have rounded them. Quantities and conversions are exact numerator/denominator pairs.
2. **A Foodics name cannot be ambiguous by construction.** The approved-label uniqueness index applies to Foodics only; the workbooks repeat product names in different sections, so identity labels do not compete.
3. **A hamza spelling split one ingredient into two** («أيس كريم» in the inventory list, «ايس كريم» in 55 recipe lines). The shared name fold merges them and keeps both spellings, so those recipes deduct from the stocked item (P1-30).
4. **Mobile overflow** found by the browser check on the review and recipe pages (375 px); fixed in CSS and rechecked in both languages.
5. **Test assertions** that matched hidden option text or raced two redirects were corrected; the application was not at fault.
6. **Seed on older resets.** A reset to an older migration failed on the catalog seed; the seed now does nothing when the tables do not exist.
7. **Duplicate background run.** An accidental second regression run collided on the database and was discarded; every result above is from one clean run.

### Independent review before merge

- Copied catalog drafts preserve the source references and the effective-date gate. An unapproved November copy remains blocked.
- Recipe approval serializes against date decisions and component unit or conversion edits. Copying and approving a recipe acquire the product lock before locking versions. Approved lines cannot be moved to a different recipe version.
- PostgREST returns fraction parts as text. A recipe quantity beyond JavaScript's safe integer range round-tripped through the HTTP edit form exactly. The database rounds the display once using integer arithmetic.
- An invalid explicit product ID blocks its own row. Other rows in the same consumption request still resolve. The preview explains requests that exceed its size limit.

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
- **Comparison data**: superseded by Phase 7. Corrections are revisions through `app_comparison_save`, and the page and export check every *selected* branch. See [Phase 7 status](#phase-7-status).
- **Audit scope**: rows are written by the administrator commands, the bootstrap command and the operating-table triggers for signed-in people. Direct service-role writes are not audited by the triggers; a database owner can still disable triggers.
- **Real exports, daily-close writes, stock movements**: the CSV downloads and the adjustment screen are minimal guarded skeletons on synthetic data; the real workflows are Phases 4, 6 and 9. `inventory_adjustments` is a skeleton table that Phase 6 extends.
- **Disabling removes Auth sessions** with a privileged delete that is skipped quietly if the database owner may not touch the `auth` schema on a hosted project; the live checks refuse every request regardless, and the Auth user is banned by the server.
- **Phase 4 carry-over unchanged**: the Casablanca time-zone follow-up and the daily close and cash-ledger work stay in Phase 4.

## Questions for Abdo

The six review answers are in the [decision summary](phase1/decisions/DECISIONS_SUMMARY.md). Save further operational questions for the phase that uses them.

**Phase 4 answers are recorded.** Abdo counts the drawer as branch manager. The normal business-day cutoff is 02:00 local time. An overnight sale at 01:00 and a late close of that business day belong to the prior operating date. Abdo closes, corrects and approves his own corrections, and the branch takes cash and card. See the [implemented workflow](phase4/OPERATING_CLOSE.md).

The [22 November voice-note decisions](ABDO_WORKFLOW_DECISIONS.md) record the approved Dubai cake alias, mixed nuts in kilograms, the source for six spoons in the November large Bazabizo Mango recipe, daily and monthly inventory counts, and the historical order date as expected receipt.

- **Phase 5 (implemented):** the November recipe start date is still open and gates the affected versions. See "Pending decisions and open items" under [Phase 5 status](#phase-5-status).
- **Phase 7 (implemented):** confirm the live source and entry owner for Al Quds and Bourgogne, and from which day their figures count. The question in plain Arabic is under [Phase 7 status](#phase-7-status); record the answer on `/comparison/settings`.
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

0. Project owner: resolve the repository visibility (audit open item 1).
1. Ask Abdo the five Phase 8 questions (see "Phase 8 status") and the Phase 7 question (live source, entry owner and start day for Al Quds and Bourgogne); record the answers on `/replenishment/settings` and `/comparison/settings`.
2. Developer: investigate the Phase 4 concurrent-save gateway timeout on PostgREST v14.18 (Phase 7 open items) before concurrent use on the hosted project.
3. Follow the Phase 9 hosted deployment steps when separately authorized. Use the Phase 10 walkthrough to resolve the remaining recipe date and review-queue items. [Phase 9 status](#phase-9-status)
4. Before production rollout, confirm whether the shared project `xitryskkqgtkpdawddqe` is the production project or a separate one is needed. Then set the Auth options and `SITE_URL`, configure SMTP, and bootstrap Abdo. See the [accounts and permissions runbook](phase3/ACCOUNTS_AND_PERMISSIONS.md).
5. Carry forward Abdo's walkthrough (Phase 10) and the reviewed opening data, first live business date and outstanding orders (Phase 11).
