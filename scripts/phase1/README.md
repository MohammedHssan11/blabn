# Phase 1 scripts

All scripts are read-only with respect to source workbooks. They use tools already on the development computer: Python 3 with `openpyxl` (no virtual environment), Node.js 18+, and Microsoft Excel for the optional recalculation check. Run from the repository root.

| Script | What it does |
|---|---|
| `extract_workbooks.py <workspace> <scratch>` | Inventories the 16 workbooks (paths are relative to the workspace folder that contains `blabn/`, `abdo temp/`, `outputs/`). Writes `docs/phase1/source-inventory.json` and a local cell cache to `<scratch>/cells/*.pkl` (outside Git). |
| `cells.py` | Helpers for querying the cell cache. Set `PHASE1_CACHE=<scratch>`. |
| `inventory_checks.py` | Inventory evidence: blank counts, zero openings, text in numbers, recipe component matching, units, Oct/Nov recipe diff, SRC-07 vs LOC-01. |
| `recipe_links.py SRC-06 SRC-07 LOC-01`, `unlinked_sales.py` | Recipe-to-Product-Mix link checks. |
| `recalc_with_excel.ps1 -Root <workspace> -Out <scratch>\recalc` | Recalculates scratch **copies** in Excel (links not refreshed). |
| `compare_recalc.py <scratch> docs/phase1/recalc-comparison.json` | Compares recalculated values with cached values. |
| `build_coverage.py` | Writes `docs/phase1/SOURCE_COVERAGE.md`. |
| `fixes/gen_fixes.py` | Writes `fixes/fix-plan.json`: every correction to the workbook copies (needs `PHASE1_CACHE`). Unproven values are deliberately left out. |
| `fixes/apply_fixes.ps1 -Repo -Scratch [-Only SRC-xx] [-SkipProtected] [-SheetPassword]` | Applies the plan in Excel to copies in `source-material/corrected/`; `-SkipProtected` leaves protected sheets untouched. |
| `fixes/diff_corrected.py` | Cell-by-cell comparison of every corrected copy with its original; writes `docs/phase1/corrected-diff.json` (unexplained changes must be 0). |
| `fixes/boundary_tests.ps1 -Repo -Scratch` | Excel boundary tests (blank vs 0, empty periods); writes `docs/phase1/boundary-tests.json`. |
| `fixes/verify_fixes.py` | Value checks with an independent/construction basis and error counts; writes `docs/phase1/corrected-verification.json`. |
| `fixes/set_status.py` | Records each finding's status, questions for Abdo, what was done and what remains in `docs/phase1/findings.json`. |
| `fixes/build_corrections_md.py` | Writes `docs/phase1/CORRECTIONS.md` and `corrections-log.csv`. |
| `fixes/correct_transcription.py` | Writes the corrected 7 Nov transcription copy (M04 label; Product Mix lines compared with the inventory workbook and their mapping status). |
| `build_field_map.py` | Builds `docs/phase1/field-map.json` and `FIELD_MAP.md`; field status is recomputed from findings and recorded answers. |
| `record_outcome.py` | Records a project-owner deferral or application of the protected ledger corrections, an agreed final rule for a contested finding, and Abdo's confirmation of the final set. `DECISIONS_DIR` overrides the folder for tests. |
| `phase1_status.py` | Writes `docs/phase1/CLOSURE.md`; exits 1 while Phase 1 cannot close. |
| `review/verify_questions.py` | Checks every workbook name, tab and cell cited by the current review questions against the original files; writes `docs/phase1/review-locations-check.json`. |
| `review/decision-rules.mjs` | Shared validation and merge rules for answers (used by the server and the import script; the page carries an identical merge). |
| `review/build.mjs` | Builds Abdo's page `docs/phase1/review/abdo-review.html` (current questions from `docs/phase1/review-questions.json`, checked for plain wording), the trial copy `abdo-review-trial.html`, and the register `docs/phase1/FINDINGS.md` from `findings.json`. |
| `review/review-server.mjs` | Local server (127.0.0.1:4173) that saves answers to `docs/phase1/decisions/abdo-decisions.json`. `DECISIONS_FILE` and `PORT` override for tests. |
| `review/import-decisions.mjs [file] [--trial]` | Imports Abdo's downloaded answers and regenerates the summary and CSV. Refuses trial files unless `--trial` with `DECISIONS_DIR` set to a scratch folder. |

Typical full refresh (Windows, Git Bash):

```bash
python -X utf8 scripts/phase1/extract_workbooks.py "C:/Users/mh978/Downloads/abdo" "$SCRATCH"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/phase1/recalc_with_excel.ps1 -Root "C:\Users\mh978\Downloads\abdo" -Out "$SCRATCH\recalc"
PHASE1_CACHE="$SCRATCH" python -X utf8 scripts/phase1/compare_recalc.py "$SCRATCH" docs/phase1/recalc-comparison.json
python -X utf8 scripts/phase1/build_coverage.py
node scripts/phase1/review/build.mjs
```
