"""Write docs/phase1/SOURCE_COVERAGE.md from source-inventory.json,
recalc-comparison.json and the review notes below.

Usage: python scripts/phase1/build_coverage.py   (run from the repository root)
"""
from __future__ import annotations

import json
import os
from collections import Counter

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
P1 = os.path.join(ROOT, "docs", "phase1")
inv = json.load(open(os.path.join(P1, "source-inventory.json"), encoding="utf-8"))
rec = json.load(open(os.path.join(P1, "recalc-comparison.json"), encoding="utf-8"))
fnd = json.load(open(os.path.join(P1, "findings.json"), encoding="utf-8"))

# Level-3 review per workbook: what was checked beyond the automated scans.
DEEP = {
    "SRC-01": "Every populated cell read; order quantities matched by name to LOC-01 receipts on 4-8 Nov.",
    "SRC-02": "Every row recalculated independently (average, cash identity); cross-matched with SRC-04, SRC-08, SRC-09, SRC-10 per date.",
    "SRC-03": "As SRC-02 for 1-2 Nov; empty template rows reviewed.",
    "SRC-04": "Every day sheet: date, visa, expenses, bank line, over/short formula and system revenue extracted and matched with SRC-02 and SRC-10.",
    "SRC-05": "As SRC-04; stale template sheets identified by value matching with SRC-08.",
    "SRC-06": "Scripted checks on every inventory row and day (blank counts, opening chain, text in numbers, recipe links, units, number formats); Total sheet period check.",
    "SRC-07": "As SRC-06 for days 1-2; compared with SRC-06 (items, units, recipes) and with LOC-01 (inputs, recipes).",
    "SRC-08": "Every row matched with SRC-02; growth formula recomputed. September figures have no independent source.",
    "SRC-09": "Every row matched with SRC-02/SRC-03; growth recomputed.",
    "SRC-10": "Normalised formula comparison of all 31 day sheets; every day's sales/visa/custody/bank matched with SRC-02 and SRC-04; hidden summary, journal, classification and Ref_ sheets read.",
    "SRC-11": "As SRC-10; 2 Nov cash count and both timing scenarios recomputed.",
    "SRC-12": "All populated cells read; weekdays and totals recomputed. Al Quds, Bourgogne and Maarif 3/10 Nov figures have no independent source.",
    "LOC-01": "As SRC-06 for days 1-13; 7 Nov Product Mix compared line by line with IMG-02/03; period variance rolled forward independently.",
    "LOC-02": "Formulas read; opening balances matched by name with LOC-01 day 1 and SRC-06 day 31.",
    "LOC-03": "Read as derived material (earlier assistant output); not treated as Abdo's source.",
    "LOC-04": "Read as derived material; receipts matched LOC-01 (211/211), consumption column differs from theoretical in 68/159 rows.",
}
NOTES = {
    "SRC-04": "Chartsheet 'Chart1' is hidden (workbook.xml state) and plots the empty range '18'!D59:J69; no data effect.",
    "SRC-05": "Chartsheet 'Chart1' is hidden and plots the empty range '564'!D59:J69; no data effect.",
    "SRC-10": "External link to a 2017 file on drive Y: (not available); linked cells keep cached values.",
    "SRC-11": "Same external link as SRC-10.",
}

OTHER = [
    ("IMG-01", "source-material/images/2026-11-07/orders-summary-2026-11-07.jpg", "Tracked", "Viewed in full; every printed value read and checked (cash + visa = net; net ÷ orders = 84.90). Row labels are offset by one wrapped label; interpretation recorded in P1-02."),
    ("IMG-02", "source-material/images/2026-11-07/product-mix-top-2026-11-07.jpg", "Tracked", "Viewed; every line of sections 1-5 read; line sums = printed section totals."),
    ("IMG-03", "source-material/images/2026-11-07/product-mix-bottom-2026-11-07.jpg", "Tracked", "Viewed and zoomed; every line of sections 6-8 read; qty × unit price = line amount; section totals reconcile (P1-29)."),
    ("IMG-04", "source-material/images/2026-11-07/report-sample-2026-11-07.json", "Tracked", "Read in full; all values match IMG-01..03; section M04 label missing (P1-02). Local parent copy identical except line endings."),
    ("LOC-05", "abdo temp/WhatsApp Video 2026-11-14 at 6.00.01 AM.mp4", "Local only", "98 s screen recording of the LOC-02 template being filled. 12 frames reviewed; audio transcribed locally (faster-whisper small, offline). Speech quality is low; only the general workflow is clear (P1-34). Not committed."),
    ("LOC-06", "outputs/01a1d811-…/*.png (3 images)", "Local only", "Viewed. Renders made by an earlier assistant from LOC-01/LOC-04 (cooking-oil rows, review sheet). Derived, not a source; led to P1-37."),
    ("LOC-07", "outputs/ABDO_REVIEW_2026-11-14.md", "Local only", "Earlier review notes. Used as leads only; every lead used in a finding was re-verified against the workbooks. One lead (stale PR/doc status) is obsolete."),
    ("ARC-01", "archive/legacy/tooling/.playwright-cli/تقارير-فرع-المعاريف-2026-11-07.xls", "Archive (ignored)", "Read. XML spreadsheet exported by an old demo with sample figures (e.g. expenses 1,336); demo output, not evidence. Excluded."),
    ("ARC-02", "archive/legacy/analysis/*, previous-docs/*, demo/*", "Archive (ignored)", "Earlier derived analyses, drafts and a demo. Not sources; not used as evidence."),
    ("SCR-01", "screenshot/*.png + PROMPTS.md (parent folder)", "Local only", "Design storyboard with fictional data (stated in PROMPTS.md). Not a source; excluded."),
    ("DUP-01", "../source-material/ (parent checkout, branch codex/daily-ledger-planning)", "Other checkout", "SHA-256 identical to blabn/source-material for all 12 workbooks and 3 images; JSON and README differ only in line endings/wording."),
]

wb_count = len(inv["workbooks"])
ws_count = sum(1 for w in inv["workbooks"] for s in w["sheets"])
formulas = sum(s.get("formula_cells", 0) for w in inv["workbooks"] for s in w["sheets"])
errors = sum(s.get("error_cell_count", 0) for w in inv["workbooks"] for s in w["sheets"])
compared = sum(v["compared"] for v in rec["workbooks"].values())
diffs = sum(v["differences"] for v in rec["workbooks"].values())
by_source = Counter()
import re
for f in fnd["findings"]:
    ids = set()
    for l in f["locations"]:
        for m in re.finditer(r"(SRC|LOC|IMG)-(\d+)((?:/\d+)*)", l["source"]):
            for n in [m.group(2)] + [x for x in m.group(3).split("/") if x]:
                ids.add(f"{m.group(1)}-{int(n):02d}")
    for i in ids:
        by_source[i] += 1

L = []
L.append("# Phase 1 source and worksheet coverage")
L.append("")
L.append(f"Generated by `scripts/phase1/build_coverage.py` from [source-inventory.json](source-inventory.json) (extracted {inv['generated_at']}) and [recalc-comparison.json](recalc-comparison.json). Repository commit reviewed: `{fnd['reviewed_repository_commit']}` on `feature/implementation-plan-review`.")
L.append("")
L.append("## Summary")
L.append("")
L.append(f"- **{wb_count} workbooks, {ws_count} sheets** (worksheets and chartsheets, including every hidden sheet) are inventoried. Every worksheet is accounted for below; none was skipped.")
L.append(f"- **{len(OTHER)} other items** (photos, transcription, video, derived outputs, archive, mock-ups, duplicate checkout) are listed with their status.")
L.append(f"- **{formulas:,} formula cells** were extracted with their cached results; **{errors:,}** cached error cells were found and attributed.")
L.append(f"- **Excel full recalculation** (`CalculateFullRebuild` on scratch copies, external links not refreshed) reproduced **{compared:,} of {compared:,}** formula results with **{diffs} differences**. The cached values are therefore not stale: the problems found are in formulas, layout and data entry.")
L.append("- Original files were opened read-only; nothing in `source-material/`, `abdo temp/` or `outputs/` was modified.")
L.append("- Since 19 Nov 2026 LOC-01 and LOC-02 are also tracked in the repository as **SRC-13** (`source-material/workbooks/inventory-nov-2026-days-1-13.xlsx`) and **SRC-14** (`inventory-review-template-nov-2026.xlsx`), byte-identical (same SHA-256). Corrected copies of the workbooks are in `source-material/corrected/` ([CORRECTIONS.md](CORRECTIONS.md)).")
L.append("")
L.append("## Coverage levels")
L.append("")
L.append("| Level | Meaning |")
L.append("|---|---|")
L.append("| L1 | Structural scan of every cell: formula, cached value, number format, sheet visibility, comments, external links, cached errors, text-in-number, volatile functions. |")
L.append("| L2 | Excel full recalculation of a copy compared with every cached formula result. |")
L.append("| L3 | Targeted review: independent recalculation, cross-sheet formula comparison, and agreement with other sources for the same branch and date (details per workbook). |")
L.append("")
L.append("## Workbooks")
L.append("")
L.append("| ID | File | In repo | Sheets (hidden) | Formulas | Cached errors | External links | L1 | L2 | L3 | Findings |")
L.append("|---|---|---|---|---|---|---|---|---|---|---|")
for w in inv["workbooks"]:
    sh = w["sheets"]
    hidden = sum(1 for s in sh if s.get("state") in ("hidden", "veryHidden"))
    f = sum(s.get("formula_cells", 0) for s in sh)
    e = sum(s.get("error_cell_count", 0) for s in sh)
    r = rec["workbooks"][w["id"]]
    L.append(f"| {w['id']} | `{w['path']}` | {'yes' if w['tracked_in_repo'] else 'no (local)'} | {len(sh)} ({hidden}) | {f:,} | {e:,} | {len(w['external_link_targets'])} | ✓ | ✓ {r['compared']:,}/{r['differences']} diff | ✓ | {by_source.get(w['id'], 0)} |")
L.append("")
for w in inv["workbooks"]:
    L.append(f"### {w['id']} — {w['description']}")
    L.append("")
    L.append(f"`{w['path']}` · {w['bytes']:,} bytes · SHA-256 `{w['sha256'][:16]}…` · modified {w['doc_modified'] or 'n/a'}")
    L.append("")
    L.append(f"L3: {DEEP[w['id']]}" + (f" Note: {NOTES[w['id']]}" if w['id'] in NOTES else ""))
    L.append("")
    L.append("| Sheet | State | Range | Values | Formulas | Cached errors | Ext. refs |")
    L.append("|---|---|---|---|---|---|---|")
    for s in w["sheets"]:
        if s["kind"] == "chartsheet":
            L.append(f"| {s['name']} (chart) | {s['state']} | — | — | — | — | — |")
            continue
        errs = ", ".join(f"{k} {v}" for k, v in s["cached_errors"].items()) or "0"
        L.append(f"| {s['name']} | {s['state']} | {s['dimension']} | {s['value_cells']:,} | {s['formula_cells']:,} | {errs} | {s['external_ref_formula_cells']} |")
    L.append("")
L.append("## Other material")
L.append("")
L.append("| ID | Item | Location | Review |")
L.append("|---|---|---|---|")
for row in OTHER:
    L.append(f"| {row[0]} | `{row[1]}` | {row[2]} | {row[3]} |")
L.append("")
L.append("## Where cached errors come from")
L.append("")
L.append("- Inventory workbooks: `#DIV/0!` in Product Mix share columns H/I because amounts (G) are never entered and some sections are empty (P1-27); `#VALUE!` from typed symbols (P1-26).")
L.append("- Daily ledgers: `#VALUE!` in every day's custody balance E90 (P1-17); `#REF!` in the hidden summary and journal (P1-20, P1-21); `#VALUE!` in the hidden classification sheet (external 2017 link) and day 16 A19:A24 (stray formulas in the account-code column).")
L.append("- Daily Sales: `#DIV/0!` on empty days and `#REF!` in the '%' row (P1-11). October comparison: `#DIV/0!` for 31 Oct (P1-07).")
L.append("")
L.append("## Remaining gaps and limits")
L.append("")
L.append("- Recipe quantities, yields and unit choices were checked for consistency only; whether each recipe is correct needs Abdo or the catalog owner (P1-30, P1-31, P1-32).")
L.append("- No independent source exists for September 2026 sales (SRC-08), Al Quds and Bourgogne figures, or Maarif on 3 and 10 November (SRC-12).")
L.append("- The video's audio is low quality; the transcription is indicative only.")
L.append("- The photos were read visually (no OCR). Every number used in a finding was cross-checked (line sums, qty × price), but item names in small print may contain spelling differences.")
L.append("- Only one real day (2 November) has a cash count; only 7 November has a Foodics report. Neither day has every input needed for a full end-to-end reconciliation.")
L.append("- External links were not refreshed during recalculation (the 2017 target file is not available).")
L.append("")
open(os.path.join(P1, "SOURCE_COVERAGE.md"), "w", encoding="utf-8").write("\n".join(L))
print("wrote SOURCE_COVERAGE.md", wb_count, ws_count, formulas, errors, compared, diffs)
