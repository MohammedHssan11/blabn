# Phase 1 — Source review with Abdo

Status: **closed on 21 November 2026**. All six answers are recorded and the workbook checks pass. The owner deferred the protected ledger review to Phase 4 if needed, the legacy order-sheet date to Phase 8, and Abdo's separate confirmation to the Phase 10 walkthrough. See the [closure checklist](CLOSURE.md) and [handover](../HANDOFF.md).

The [Phase 4 decision record](../phase4/ABDO_DECISIONS.md) now answers P1-19. The Phase 1 report map describes the prototype baseline.

## Workbook audit baseline

The table records the workbook audit statuses before the review responses. The [decision summary](decisions/DECISIONS_SUMMARY.md) records Abdo's answers and the [field map](FIELD_MAP.md) applies them to the app and reports.

| Status | Count | Findings | Meaning |
|---|---|---|---|
| Fully verified correction | 15 | P1-01, 02, 05, 06, 07, 09, 11, 14, 15, 16, 24, 25, 26, 34, 37 | Corrected in the copies and checked against independent evidence; nothing left in the workbooks |
| Partial correction | 8 | P1-08, 18, 20, 21, 23, 29, 31, 36 | Part corrected and checked; the rest is pending (protected ledger sheets, an unconfirmed mapping, units, a display choice, an unknown quantity) |
| Applied on an assumption | 0 | — | Unproven dates, units, mappings, recipe dates and definitions were reverted on 20 Nov and are pending, including the 7 Nov Kinder Dubai cake quantity (P1-29), which had been changed on an unconfirmed size mapping |
| Future application rule | 6 | P1-04, 12, 17, 19, 22, 27 | The app implements the rule; ledger copies need the sheet password for the day-sheet part |
| Deferred to a later phase | 3 | P1-28, 30, 33 | Catalog mapping and recipes (Phase 5); opening balances (Phase 11) |
| Pending Abdo's decision | 5 | P1-03, 10, 13, 32, 35 | The team cannot decide these from the evidence |

## Abdo's November workflow

Abdo's 20 November 2026 review export and WhatsApp voice note describe the workflow below. The accompanying screenshot shows the names of nine workbooks in his November folder.

| Workbook or task | What Abdo described | How it carries forward |
|---|---|---|
| Daily Sales Maarief, البيان اليومي, يومية بلبن | Daily Sales records sales, order count, average order value, expenses, bank remittance and Visa. Today he copies values, including Visa and totals, when preparing the close. His review answer sets the average to net sales divided by orders. | One saved close feeds the three reports. Phase 4 records expense and remittance separately and preserves when cash was counted and when it was deposited. Phase 9 maps each report column. |
| Daily cash count | The count happens before the bank remittance. For 2 November, 48,695 sales minus 11,300 card and 453 operating cash expenses gives 36,942 expected. Counted 36,945 gives +3 MAD. | The later deposit of 36,945 posts once to the ledger and leaves the earlier count variance intact. |
| مقارنه يوميه المغرب | He compares the same weekday in the current and prior weeks using sales and order counts per branch. He chose the current/prior sales ratio and confirmed Bourgogne's current reference figures belong to 10 November. | For the reference, use 10 and 3 November across branches. Show the ratio as a ratio and aggregate matching dates only. |
| شيت جرد بلبن | He records deliveries under «الوارد» when received. Product Mix quantities drive recipe deductions. He records hospitality, shortages, charges/transfers and waste in the inventory worksheet. | Phase 6 records actual receipts, recipe consumption and other movements by type. Abdo chose to retain 12 in the Kinder row of the 7 November reference workbook. The Foodics entry of 2 is separate evidence. |
| طلبية فرع المعاريف | Orders are prepared at night for receipt two days later, with deliveries occurring daily. His written example projects 10 on hand plus 190 due in, giving 200 available, then 50 after 150 expected consumption based on the previous matching weekday. | Phase 8 shows on-hand stock, confirmed incoming stock and forecast consumption separately. Actual stock increases when a receipt is recorded. Record the operational order date separately from the actual timestamp for after-midnight entry. |
| تايم شيت and شيت القاعات | Abdo referred to the agreed attendance check-in for the time sheet and asked to set aside the little-used halls sheet. | Keep the time sheet as a reference for the later attendance phases. Leave the halls sheet outside the current app scope. |

**Deferred by the project owner.** Confirm the meaning of the date in the old order template (SRC-01 `Sheet1!C6`, 4 November) with Abdo in Phase 8 before mapping historical order dates. Live orders use explicit creation, expected receipt and actual receipt dates. See the [deferral record](decisions/owner-deferrals.json).

## What is here

| File | Purpose |
|---|---|
| [findings.json](findings.json) | **Source of truth**: 37 findings with `status`, `abdo` (required / later), what was done, what remains, and the question to Abdo. |
| [FINDINGS.md](FINDINGS.md) | Generated register. |
| [CORRECTIONS.md](CORRECTIONS.md), [corrections-log.csv](corrections-log.csv) | Workbook changes: 4,400 operations, 4,082 applied and 318 deferred on protected ledger day sheets, with original values and reasons. |
| [corrected-diff.json](corrected-diff.json) | Cell-by-cell comparison of all 13 corrected copies with their originals: 0 unexplained changes. |
| [corrected-verification.json](corrected-verification.json) | 71 value checks (all pass): 26 against independent evidence, 37 confirming an edit or an intentionally unchanged value, 8 confirming the copies follow Abdo's answers; Excel error counts. |
| [boundary-tests.json](boundary-tests.json) | 26 Excel boundary tests (all pass): blank vs explicit 0, zero or missing prior figure, empty month, uncounted item, average order value with blank or zero orders. |
| [ABDO_FINAL_CONFIRMATION_AR.md](ABDO_FINAL_CONFIRMATION_AR.md) | Short Egyptian Arabic summary of the six agreed points for Abdo's final confirmation (not sent), and how to record his reply. |
| [SOURCE_COVERAGE.md](SOURCE_COVERAGE.md), [source-inventory.json](source-inventory.json), [recalc-comparison.json](recalc-comparison.json) | Coverage of every workbook and sheet; Excel recalculation evidence. |
| [FIELD_MAP.md](FIELD_MAP.md), [field-map.json](field-map.json) | Report field map: 54 fields across the five report families. Six fields wait for later-phase answers. |
| [CLOSURE.md](CLOSURE.md) | Phase 1 closure checklist (generated by `scripts/phase1/phase1_status.py`). |
| [review-questions.json](review-questions.json) | Customer wording of the six required questions (location, what is recorded, why, proposal, the question, the answer options) plus the machine-checkable cell references. Edit this file, not the generated page. |
| [review-locations-check.json](review-locations-check.json) | Result of `verify_questions.py`: every workbook name, tab and cell cited by the current questions checked against the original files (169 of 169; 1 photo reading recorded as manual). |
| [review/abdo-review.html](review/abdo-review.html) | Abdo's page: only the six required questions, numbered. The 37-finding register stays with the team. |
| [review/abdo-review-trial.html](review/abdo-review-trial.html), [TRIAL.md](TRIAL.md) | Trial copy for Abdo's device and how the trial works; how answers are saved and returned. |
| [decisions/](decisions/) | Six imported answers, summary and CSV, plus the owner deferrals and agreed-outcomes record. |
| `../../source-material/corrected/` | 13 corrected workbook copies (the two ledgers only on unprotected sheets) and the corrected transcription. Originals in `source-material/workbooks/` are unchanged. |

## What the checks do not establish

- **Construction checks** (37 of 71) only confirm that an edit landed or that an unproven value stayed as recorded; they do not prove the value.
- **Decision checks** (8 of 71) confirm the copies follow Abdo's answers; they do not test the answers themselves.
- **Ledger day sheets** are password-protected: their corrections (318 operations) are not applied, and their calculations could not be boundary-tested.
- **Recipes, units and product mappings** are still Phase 5 work. The 7 Nov workbook total remains 2,192 under Abdo's keep-as-is decision for the Kinder row. Foodics shows 2,182. The difference of 10 is traceable to that row. Other days have no independent Foodics source.
- **No independent source** exists for September sales, Al Quds/Bourgogne figures, or Maarif on 3/10 Nov.
- Six error cells remain in hidden legacy ledger sheets whose original references are lost.

## How Abdo uses the page

**Trial first.** Send the trial copy and follow [TRIAL.md](TRIAL.md), which also explains how answers are saved and returned.

**Option A — on his own computer (recommended).** Send him `docs/phase1/review/abdo-review.html` privately (nothing is sent automatically). He opens it in Chrome or Edge. The page starts with a three-step guide, then shows six numbered questions. Each says where the issue is (original workbook name, tab, cell), what is recorded now, why it needs attention, the proposed change and one direct question. He chooses «أوافق على المقترح», «أقترح تعديلًا آخر» (text required), «نُبقي الوضع الحالي» or «مش متأكد / محتاج أراجع» (the question stays open), adds text if needed, and presses «حفظ الإجابة». Answers stay in that browser; he presses «تنزيل ملف الردود» and sends back the downloaded `abdo-decisions-….json`. «استرجاع ردود من ملف» restores them on another computer.

**Option B — together on the team's computer.**

```bash
node scripts/phase1/review/review-server.mjs
```

Open http://127.0.0.1:4173/. Each answer is written straight to `docs/phase1/decisions/abdo-decisions.json`. The server listens on this computer only.

## Retrieving answers

```bash
node scripts/phase1/review/import-decisions.mjs path/to/abdo-decisions-YYYY-MM-DD-HHMM.json
```

Validates and merges the file (newest answer per finding wins; earlier answers are kept in history) and regenerates `DECISIONS_SUMMARY.md` and `abdo-decisions.csv`. Each answer records the generic choice (accept / alternative / keep / unsure), the specific option he picked, any extra answers (for example whether the cash is counted daily), and his text. "Not sure" is kept but counts as unanswered. The summary lists answers that still need an agreed final rule. Then:

```bash
python scripts/phase1/build_field_map.py        # field statuses follow the answers
python scripts/phase1/record_outcome.py agree P1-xx --rule "<final rule>" --with Abdo --date <YYYY-MM-DD>   # for each alternative / contested outcome
python scripts/phase1/record_outcome.py defer ledger-protected-sheets --by "<project owner>" --reason "<why>"   # or 'applied' after using the password
python scripts/phase1/record_outcome.py confirm-final --date <YYYY-MM-DD> --how "<how Abdo confirmed>"
python scripts/phase1/phase1_status.py          # CLOSURE.md; exit 0 only when Phase 1 can close
```

## Rebuilding after changes

```bash
PHASE1_CACHE=<scratch> python scripts/phase1/fixes/gen_fixes.py
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/phase1/fixes/apply_fixes.ps1 -Repo <repo> -Scratch <scratch> -SkipProtected
python scripts/phase1/fixes/diff_corrected.py
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/phase1/fixes/boundary_tests.ps1 -Repo <repo> -Scratch <scratch>
python scripts/phase1/fixes/verify_fixes.py
python scripts/phase1/fixes/correct_transcription.py
python scripts/phase1/review/verify_questions.py
python scripts/phase1/fixes/set_status.py
python scripts/phase1/fixes/build_corrections_md.py
node scripts/phase1/review/build.mjs
node scripts/phase1/review/import-decisions.mjs
python scripts/phase1/build_field_map.py
python scripts/phase1/phase1_status.py
```

## Final confirmation message

Use the [final review summary](ABDO_FINAL_CONFIRMATION_AR.md) during the Phase 10 walkthrough with Abdo.

> تسلم يا عبدو، سجلنا إجاباتك الستة وجهزنا ملخص باللي هنعتمده. بص عليه مرة واحدة وقول لنا «تمام» لو مطابق للي اتفقنا عليه.
