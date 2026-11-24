# Phase 10 web validation record

Date: 24 November 2026. Branch `codex/phase-10-web-validation`, cut from `origin/main` at `9b25afbb27a96c880ec4b344db81a8693c6808e6` (the merged Phase 9, PR #16). The rehearsal included local documentation updates and the changes listed under [Fixes](#fixes).

Everything ran in a **private, disposable validation environment**: the copy `C:\Users\mh978\Downloads\abdo-p9-validation\` with the local Supabase stack `balaban-p9`. Real workbook and Foodics figures were entered by script from a private JSON under `outputs\phase10\` (outside Git). No hosted project, production account or real person was involved. Synthetic people only.

## Phase 9 handoff verified

| Item | Result |
|---|---|
| Merge | `origin/main` is `9b25afb` (PR #16). Its tree equals the reviewed Phase 9 tree; only two local documentation receipts differed. |
| Hosted migration | **Not applied.** `npx supabase migration list --linked` (read-only) shows the hosted history equal to `main` through `20261125090000`; only `20261126090000_phase9_report_exports.sql` is missing. The private `report-exports` bucket, its policies and Abdo's designated Excel account therefore do not exist in production. **Release blocker for the live Excel rollout (Phase 11), not for this rehearsal.** Nothing was pushed to the hosted project. |
| Link | This checkout was not linked to the hosted project; `npx supabase link --project-ref xitryskkqgtkpdawddqe` was run to read the history (local `supabase/.temp` only). |

## What was entered, once

| Source | Entered |
|---|---|
| Daily Sales workbooks | All 31 October days and 1–2 November: sales, orders, card, bank cash, expenses including the bank remittance. Cash receipts = sales − card; other expenses = expenses − bank cash; the drawer counted at the bank-cash figure and remitted. |
| 2 November reference | The six expense lines and the workbook's own count slip (denominations), full counted cash remitted after midnight. Also run through the real Arabic and English forms: `PHASE4_REFERENCE_FILE` check **25/25**, the recorded variance stayed the same before and after remittance. |
| 7 November Foodics sample | Net sales, orders, cash, card, a recorded void, and the Product Mix sections (reconciled to net sales), the two Dubai cake spellings (P1-28). The count, expenses and float were **not observed** in the sample; the day was closed with counted = book cash and says so in its note. |
| Weekly comparison workbook | 3 and 10 November for Maarif (closed days with the whole amount as cash, since that workbook has no payment split), and Al Quds and Bourgogne as reporting-only entries. |
| Stock and orders | Opening 10, receipt 5, waste 0.25, count 14.5 for one catalog item; a manual order of 10, approval, a partial receipt of 4. |

## Results

| Check | Result |
|---|---|
| `npm run check` | `tsc` clean; **291/291** tests in 16 files; build passes |
| `npm run test:phase10` (`scripts/phase10/e2e.mjs`) | **78 checks, 0 failures**: 33 days entered, per-day reconciliation, 7 November, Product Mix, stock, three-branch weekly comparison, order → approval → partial receipt, 20 workbooks (10 reports × Arabic and English), and the scenarios below |
| `node scripts/phase10/browser-check.mjs` | **35 checks, 0 failures** (Edge; English desktop and Arabic at 375 px): sign-in, validation message, save, submit, language switch mid-flow, count, close, bank remittance, correction proposal and approval, download of Daily Sales through the browser, no console errors |
| `compare_reports.py` | **994 field comparisons, 5 differences** (two causes, below) |
| `npm run test:phase9` (merged code plus this branch) | **124/124** |
| Phase 2 smoke | **69/69** (after updating one expectation, see Fixes) |
| `fieldmap:check` | up to date: 54 fields, 4 pending, 9 agreed (Abdo) |
| Desktop Excel 16.0 | All 14 sampled workbooks opened; every sheet right-to-left in Arabic and left-to-right in English; Daily Sales, statement, comparison and Product Mix sheets print on one page; the Yawmeya day on two A4 landscape pages; no formula or error cell |

Not run: `db:upgrade-test` and the Phase 3–8 suites (no database change in this phase); anything on the hosted project; a printed paper copy; Excel on another machine, Excel for Mac or LibreOffice; a visual render of the PDF pages (no PDF rasteriser here, so print layout was judged from Excel's page count, orientation and direction, not from the page image).

The release review reran the rehearsal on the disposable stack after strengthening the skipped-day and retry checks. All 78 checks still passed. Weekly export comparison now checks the named branch row and the exact measure column. The fresh exports still showed five differences in 994 comparisons. The technical rehearsal and the walkthrough acceptance are recorded separately.

### Scenarios (all passed)

- **Next day and month boundary:** 1 November opens with the cash 31 October closed with; the October file holds no November day and the reverse; 11 November opens with 10 November's closing.
- **Missing dates:** 4–6 and 8–9 November export as `Not entered` with blank cells (never zero); the total says `Days included: n of m`; days after today say `Not started`. Back-filling a skipped day after later days are posted is refused (`22023`, see D-5).
- **Interrupted save:** the same request sent twice makes one revision; a save from an outdated page is refused with `40001`; the first figure stays.
- **Competing edits:** two simultaneous saves on one revision: one accepted, the other `40001`; one revision stored.
- **Earlier correction and export during a correction:** an export taken while a correction is only proposed shows the effective figures; after approval a new export shows the corrected day with a later revision basis; the earlier file is byte-for-byte unchanged; the later day's saved as-counted variance does not change.

## Report differences

Material differences only. Daily Sales matched the workbook in every compared cell: each of the 33 days (sales, orders, average, expenses, bank cash, ratios, card, card ratio), the October totals, and blank-versus-zero for days without a figure. Arabic and English files carry identical numbers.

| # | Field / cell | Expected (workbook) | Actual (application) | Cause | Fix or decision needed | Owner |
|---|---|---|---|---|---|---|
| D-1 | Statement `B39` over/short; Yawmeya `D17` opening, `D27` closing, `B43` over cash (2 November) | Zero opening and closing balances, with a recorded variance | Carried opening and closing balances and a different variance | The application carries the cash ledger's book balance into the next day's opening. When the counted cash is remitted in full, each day's small over or short stays on the book and adds to every later day. The difference affected multiple days because the reference workbook starts each day at zero. An earlier correction can also change a later book opening even when the physical drawer is empty. | **Decision:** should the next day open with the physical cash left after the remittance (counted − remitted, normally 0), or keep the book balance? Not changed: it is a documented Phase 4 rule and changes saved results. | Abdo, project owner |
| D-2 | Yawmeya `D32` purchasing custody received (2 November) | A custody receipt | No custody receipt | The workbook passes the day's cash to a purchasing-custody sheet and pays the expenses and bank deposit from there. The application records them on the cash ledger (the cash outflow equals the reference amount) and leaves custody at zero. | **Decision:** does Abdo want that pass-through shown (custody receipt then custody expenses), or is the cash-ledger view enough? The old sheet's `#VALUE!` in `E90` is not reproduced. | Abdo |
| D-3 | Daily Sales columns «الالغاءات» and «الضيافات» (workbook `E`,`F`) | blank in October and November; totals 0 | no such columns | Left out of the template by the Phase 9 field map. A void recorded on 7 November appears in the daily close and Yawmeya, not in Daily Sales. | **Decision:** add the two columns or keep them out. | Abdo |
| D-4 | Daily Sales totals row: average and ratios | Additional decimals | Rounded display | Display rounding (2 decimals; ratios to 4) of values computed from totals. Within 0.005 and 0.00006. | Confirm the presentation at the walkthrough. | Abdo |
| D-5 | Entering a skipped day (4 November) after 7 and 10 November were posted | n/a | Refused: «Cannot insert a day before an already posted day» | Days are posted in date order so carry-forward stays well defined. | **Decision:** keep (a missed day needs the later days to be corrected first) or allow back-filling with recomputed carry-forward. Depends on D-1. | Abdo, developer |
| D-6 | Inventory and Product Mix report values | the item-level inventory workbook | not compared | Value-for-value comparison needs the reviewed opening stock (Phase 11) and approved recipes. Real consumption cannot post: all loaded recipes are drafts and posting answers `stock_nothing_eligible`; the Dubai cake lines stay blocked (`recipe_not_approved`). Structure, units, blank-versus-zero, one stock movement per entry and the 14.75 book / 14.5 count / −0.25 deviation were verified with synthetic stock. | Compare at the first real inventory month after Abdo approves recipes (P1-32 date). | Abdo |

Retained on purpose, not differences: legacy Arabic spellings such as «الأستهلاكات» and «الأنحرافات» in sheet names; only counted denominations listed on the count slip.

## Fixes

| Issue (reproduced first) | Fix | Check |
|---|---|---|
| **Confirmed P1-19 still shown as pending.** Abdo's agreed rule (he counts the drawer; counter, role, cashier and recorder separate) is in `agreed-outcomes.json`, but `build_field_map.py` ignored agreed outcomes when deciding whether a field was still waiting. ST-09 and LG-08 stayed «pending», so every statement and Yawmeya printed «Pending: P1-19» beside the counter and listed it under «Rules still pending». | The builder now treats an agreed outcome as an answer. Map regenerated (4 pending, 9 agreed by Abdo; only ST-09 and LG-08 changed). `cash-count` page, the prototype contract and the export cell read the field map instead of a fixed list. Fields still waiting on P1-28, P1-29, P1-31 and P1-32 keep their markers. | `fieldmap:check`; unit test and smoke expectation updated to «not pending»; the regenerated 2 November statement has no pending cell |

## Walkthrough, acceptance and Phase 11 readiness

- Walkthrough prepared: [WALKTHROUGH.md](WALKTHROUGH.md), Arabic and English. **Abdo was not reachable in this session. It has not been run; his acceptance is pending.** Result and date: to be recorded at the walkthrough.
- Confirmed parts of P1-19, P1-28 and P1-31 are carried forward, not re-asked. Still unresolved: the P1-32 effective date of the November recipe set, the other ambiguous catalog pairs, the P1-29 Kinder size, remaining unit conflicts, D-1 to D-5, and the replenishment settings (minimum observations, pack sizes, cut-off, exceptions, after-midnight rule).
- The editable 20 % safety-stock rule has **not** landed (nothing on `main` references it). It stays the separate follow-up described in the handover. OCR stays for later.
- First live date, opening cash and custody balances, opening stock and outstanding orders belong to the Phase 11 handover.
