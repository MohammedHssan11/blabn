"""Verify the corrected workbook copies (values recalculated and saved by Excel).

Every check has a basis:
  independent  - the expected value comes from another source or from arithmetic the correction
                 script does not produce (another workbook, a photo, a sum across files);
  construction - the check only confirms that an edit chosen by the correction script landed
                 (a label, a date, a formula result, or that an unproven value was left unchanged);
  decision     - the expected value comes from Abdo's recorded answer (docs/phase1/decisions/abdo-decisions.json),
                 and the check confirms the corrected copy follows it.
Unintended changes are checked separately by diff_corrected.py (docs/phase1/corrected-diff.json)
and calculation boundaries by boundary_tests.ps1 (docs/phase1/boundary-tests.json).

Writes docs/phase1/corrected-verification.json.
Usage (repo root): python scripts/phase1/fixes/verify_fixes.py
"""
from __future__ import annotations

import json
import os
import re
import warnings
import zipfile
from collections import Counter

import openpyxl

warnings.filterwarnings("ignore")
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
C = os.path.join(REPO, "source-material", "corrected")
O = os.path.join(REPO, "source-material", "workbooks")
ERR = re.compile(r"^#(REF!|VALUE!|DIV/0!|N/A|NAME\?|NUM!|NULL!)")
report = {"checks": [], "errors": {}}


def wb(name, folder=C, formulas=False):
    return openpyxl.load_workbook(os.path.join(folder, name), data_only=not formulas)


def check(label, got, want, basis, finding, tol=0.005):
    if isinstance(want, float) and isinstance(got, (int, float)):
        ok = abs(got - want) <= tol
    else:
        ok = got == want
    report["checks"].append({"finding": finding, "basis": basis, "check": label,
                             "got": got.isoformat() if hasattr(got, "isoformat") else got, "want": want, "ok": ok})


def errors(name, folder=C):
    w = openpyxl.load_workbook(os.path.join(folder, name), data_only=True, read_only=True)
    c = Counter()
    for ws in w.worksheets:
        if not hasattr(ws, "iter_rows"):
            continue
        for row in ws.iter_rows(values_only=True):
            for v in row:
                if isinstance(v, str) and ERR.match(v):
                    c[v] += 1
    return dict(c)


def day(v):
    return v.date().isoformat() if hasattr(v, "date") else v


ORIG = {"daily-sales-oct-2026.xlsx": "daily-sales-oct-2026.xlsx", "daily-sales-nov-2026.xlsx": "daily-sales-nov-2026.xlsx",
        "daily-statement-oct-2026.xlsx": "daily-statement-oct-2026.xlsx", "daily-statement-nov-2026.xlsx": "daily-statement-nov-2026.xlsx",
        "daily-ledger-oct-2026.xlsx": "daily-ledger-oct-2026.xlsx", "daily-ledger-nov-2026.xlsx": "daily-ledger-nov-2026.xlsx",
        "inventory-oct-2026.xlsx": "inventory-oct-2026.xlsx", "inventory-nov-2026-days-1-13.xlsx": "inventory-nov-2026-days-1-13.xlsx",
        "sales-comparison-oct-2026.xlsx": "sales-comparison-oct-2026.xlsx", "sales-comparison-nov-2026.xlsx": "sales-comparison-nov-2026.xlsx",
        "weekly-comparison-nov-2026.xlsx": "مقارنه يوميه المغرب (3) (1).xlsx", "inventory-review-template-nov-2026.xlsx": "inventory-review-template-nov-2026.xlsx",
        "replenishment-order-nov-2026.xlsx": "replenishment-order-nov-2026.xlsx"}
for f in sorted(x for x in os.listdir(C) if x.endswith(".xlsx")):
    report["errors"][f] = {"original": errors(ORIG[f], O), "corrected": errors(f)}

I, K, A = "independent", "construction", "decision"
DEC = json.load(open(os.path.join(REPO, "docs", "phase1", "decisions", "abdo-decisions.json"), encoding="utf-8"))["decisions"]
# ---------------------------------------------------------------- Daily Sales
o = wb("daily-sales-oct-2026.xlsx", O)["Sheet1"]
w = wb("daily-sales-oct-2026.xlsx")["Sheet1"]
st31 = wb("daily-statement-oct-2026.xlsx", O)["31"]
check("SRC-02 title names October 2026", w["A1"].value, "تقرير المبيعات فرع المعاريف أكتوبر 2026", K, "P1-07")
check("SRC-02 A3 date", day(w["A3"].value), "2026-10-01", K, "P1-07")
check("SRC-02 A8 date (was 1900)", day(w["A8"].value), "2026-10-06", K, "P1-07")
check("SRC-02 31 Oct sales = statement sheet 31 system revenue", w["B33"].value, st31["I23"].value, I, "P1-07")
check("SRC-02 31 Oct visa = statement sheet 31 visa", w["J33"].value, st31["I25"].value, I, "P1-07")
check("SRC-02 October total = original 1-30 Oct total + 31 Oct", w["B35"].value, o["B35"].value + st31["I23"].value, I, "P1-07")
check("SRC-02 7 Oct expenses = statement sheet 7 total expenses", w["G9"].value, wb("daily-statement-oct-2026.xlsx", O)["7"]["D28"].value, I, "P1-05")
st18 = wb("daily-statement-oct-2026.xlsx", O)["18"]
check("SRC-02 18 Oct G/H = statement sheet 18 (total, bank)", (w["G20"].value, w["H20"].value), (st18["D28"].value, 73176), I, "P1-06")
cash_ok = all(abs((w[f"B{r}"].value or 0) - (w[f"J{r}"].value or 0) - (w[f"G{r}"].value or 0)) <= 5 for r in range(3, 34) if w[f"B{r}"].value)
check("SRC-02 sales − visa − (expenses incl. remittance) within 5 MAD on every day", cash_ok, True, I, "P1-04")
assert DEC["P1-03"]["option"] == "sales_over_orders", "P1-03 answer changed: review the average-order checks"
check("SRC-02 1 Oct average = 50,125 / 632 (Abdo: net sales / orders)", w["D3"].value, round(50125 / 632, 2), A, "P1-03", 1e-9)
check("SRC-02 every October average = round(sales / orders, 2)", [r for r in range(3, 34) if w[f"C{r}"].value and abs(w[f"D{r}"].value - round(w[f"B{r}"].value / w[f"C{r}"].value, 2)) > 1e-9], [], A, "P1-03")
check("SRC-02 31 Oct average = 101,110 / 1,166", w["D33"].value, round(101110 / 1166, 2), A, "P1-03", 1e-9)
w = wb("daily-sales-nov-2026.xlsx")["Sheet1"]
check("SRC-03 2 Nov average = 48,695 / 639 (Abdo: net sales / orders)", w["D4"].value, round(48695 / 639, 2), A, "P1-03", 1e-9)
check("SRC-03 days without orders keep a blank average", w["D5"].value, None, K, "P1-03")
check("SRC-03 A32 date", day(w["A32"].value), "2026-11-30", K, "P1-07")
check("SRC-03 I5 blank on an empty day", w["I5"].value, None, K, "P1-11")

# ---------------------------------------------------------------- Comparisons
s = wb("sales-comparison-oct-2026.xlsx").worksheets[0]
check("SRC-08 sheet name", s.title, "سبتمبر-أكتوبر 2026", K, "P1-23")
check("SRC-08 1 Oct growth = 50,125 / 84,980 − 1", s["D6"].value, round(50125 / 84980 - 1, 4), I, "P1-08", 0.0001)
check("SRC-08 31 Oct sales = Daily Sales 31 Oct", s["J36"].value, 101110, I, "P1-07")
check("SRC-08 period growth over the 30 matching days", s["D37"].value, round(1954565 / 2573430 - 1, 4), K, "P1-09", 0.0001)
s = wb("sales-comparison-nov-2026.xlsx").worksheets[0]
check("SRC-09 1 Nov growth = 86,470 / 50,125 − 1", s["D6"].value, round(86470 / 50125 - 1, 4), I, "P1-09", 0.0001)
check("SRC-09 3 Nov (not entered) blank", s["D8"].value, None, K, "P1-09")
s = wb("weekly-comparison-nov-2026.xlsx").worksheets[0]
so = wb("مقارنه يوميه المغرب (3) (1).xlsx", O).worksheets[0]
assert DEC["P1-10"]["option"] == "bourgogne_10_nov" and DEC["P1-08"]["option"] == "keep_ratio", "P1-08/P1-10 answers changed: review the weekly checks"
check("SRC-12 one date pair for every branch and the total: current 10 Nov, prior 3 Nov (Abdo)",
      [day(s[c].value) for c in ("E6", "P6", "AA6", "AL6", "I6", "T6", "AE6", "AP6")], ["2026-11-10"] * 4 + ["2026-11-03"] * 4, A, "P1-10")
check("SRC-12 every date is a Tuesday, matching the 'الثلاثاء' labels", [(s[c].value.weekday(), s[l].value) for c, l in (("E6", "D6"), ("I6", "H6"), ("AL6", "AK6"), ("AP6", "AO6"))], [(1, "الثلاثاء")] * 4, I, "P1-10")
check("SRC-12 branch and total figures unchanged by the date fix", [s[c].value for c in ("B6", "C6", "F6", "G6", "AI6", "AJ6", "AM6", "AN6")], [so[c].value for c in ("B6", "C6", "F6", "G6", "AI6", "AJ6", "AM6", "AN6")], K, "P1-10")
check("SRC-12 weekly current/prior ratio kept as recorded (Abdo)", [s[c].value for c in ("A6", "L6", "W6", "AH6")], [so[c].value for c in ("A6", "L6", "W6", "AH6")], A, "P1-08")
check("SRC-12 ratio header kept", s["A5"].value, so["A5"].value, A, "P1-08")
check("SRC-12 branch sales and orders add up to the total (both weeks)",
      [s["N6"].value + s["Y6"].value + s["AJ6"].value, s["R6"].value + s["AC6"].value + s["AN6"].value, s["M6"].value + s["X6"].value + s["AI6"].value, s["Q6"].value + s["AB6"].value + s["AM6"].value],
      [s["C6"].value, s["G6"].value, s["B6"].value, s["F6"].value], I, "P1-10")

# ---------------------------------------------------------------- Daily statements
w = wb("daily-statement-oct-2026.xlsx")
names = [x.title for x in w.worksheets]
check("SRC-04 has sheet 29", "29" in names, True, K, "P1-16")
check("SRC-04 stray sheets removed", [n for n in names if n == "1648" or n.startswith("Feuil")], [], K, "P1-16")
ovr = {}
for n in names:
    if n.isdigit():
        ws = w[n]
        lab = {ws[f"G{r}"].value.strip(): r for r in range(1, 31) if isinstance(ws[f"G{r}"].value, str)}
        r = next((v for k, v in lab.items() if k.startswith("اوفركاش")), None)
        ovr[n] = ws[f"I{r}"].value if r else None
check("SRC-04 over/short per day (Oct 8 = +1, others 0)", {k: v for k, v in ovr.items() if v}, {"8": 1}, I, "P1-14")
check("SRC-04 7 Oct system revenue = Daily Sales 7 Oct", w["7"]["I25"].value, wb("daily-sales-oct-2026.xlsx", O)["Sheet1"]["B9"].value, I, "P1-15")
check("SRC-04 29 Oct total expenses = ledger-based rebuild (130+100+30+219+35,971)", w["29"]["D28"].value, 36450, I, "P1-16")
check("SRC-04 29 Oct total expenses = Daily Sales 29 Oct expenses", w["29"]["D28"].value, wb("daily-sales-oct-2026.xlsx", O)["Sheet1"]["G31"].value, I, "P1-16")
check("SRC-04 dates", [day(w[str(n)]["I3"].value) for n in (10, 23, 29)], ["2026-10-10", "2026-10-23", "2026-10-29"], K, "P1-16")
w = wb("daily-statement-nov-2026.xlsx")
names = [x.title for x in w.worksheets]
check("SRC-05 day sheets 1-30 present, 31/564 removed", sorted(int(n) for n in names if n.isdigit()), list(range(1, 31)), K, "P1-16")
check("SRC-05 29 Nov stale total cleared", w["29"]["I23"].value, 0, K, "P1-16")
check("SRC-05 2 Nov over/short = +3 (as in the original)", w["2"]["I17"].value, wb("daily-statement-nov-2026.xlsx", O)["2"]["I17"].value, I, "P1-14")
check("SRC-05 sheet 10 leftover July 2025 block cleared", [c.value for row in w["10"]["P3:V32"] for c in row if c.value not in (None, "")], [], K, "P1-16")
check("SRC-05 dates", [day(w[str(n)]["I3"].value) for n in (3, 15, 30)], ["2026-11-03", "2026-11-15", "2026-11-30"], K, "P1-16")

# ---------------------------------------------------------------- Daily ledgers (unprotected sheets only)
for name, sid in (("daily-ledger-oct-2026.xlsx", "SRC-10"), ("daily-ledger-nov-2026.xlsx", "SRC-11")):
    wv, wf, ov = wb(name), wb(name, formulas=True), wb(name, O)
    s = wf["ملخص"]
    check(f"{sid} summary rows 22/23 read sheets 22/23", [s["D26"].value, s["D27"].value], ["='22'!$E$41", "='23'!$E$41"], K, "P1-18")
    check(f"{sid} summary day-22 value = sheet 22 E41", wv["ملخص"]["D26"].value, ov["22"]["E41"].value, I, "P1-18")
    check(f"{sid} cancellations column has no #REF!", [wv["ملخص"][f"J{r}"].value for r in range(5, 36) if isinstance(wv["ملخص"][f"J{r}"].value, str)], [], K, "P1-20")
    total_cancel = sum(v for n in range(1, 32) if str(n) in ov.sheetnames for r in range(25, 56)
                       for v in [ov[str(n)][f"N{r}"].value] if isinstance(v, (int, float)))
    check(f"{sid} cancellations total = sum of day cancellation tables", wv["ملخص"]["J37"].value or 0, total_cancel, I, "P1-20")
    check(f"{sid} no external link left", [x for x in zipfile.ZipFile(os.path.join(C, name)).namelist() if "externalLink" in x], [], K, "P1-21")
    check(f"{sid} day sheets still protected (password not used)", all(wf[str(n)].protection.sheet for n in range(1, 32) if str(n) in wf.sheetnames), True, K, "P1-17")
    if sid == "SRC-11":
        check("SRC-11 hidden journal difference after the VISA-row fix = 0", wv["Sheet1"]["S2"].value, 0, K, "P1-21")
diff = json.load(open(os.path.join(REPO, "docs", "phase1", "corrected-diff.json"), encoding="utf-8"))
for sid in ("SRC-10", "SRC-11"):
    changed = set(diff[sid]["changed_by_sheet"])
    check(f"{sid} changed cells only on unprotected sheets", sorted(changed - {"ملخص", "دليل التصنيف", "Sheet1"}), [], I, "P1-18")

# ---------------------------------------------------------------- Inventory
w = wb("inventory-nov-2026-days-1-13.xlsx")
o = wb("inventory-nov-2026-days-1-13.xlsx", O)
check("SRC-13 day 2 opening for uncounted item keeps book balance (row 40)", w["2"]["P40"].value, w["1"]["AB40"].value, K, "P1-24")
check("SRC-13 day 1 deviation blank when not counted (row 40)", w["1"]["AD40"].value, None, K, "P1-24")
mix = sum(v for r in range(8, 601) for v in [w["7"][f"F{r}"].value]
          if isinstance(v, (int, float)) and w["7"][f"D{r}"].value is not None and not (isinstance(w["7"][f"D{r}"].value, str) and "جمال" in w["7"][f"D{r}"].value))
tr = json.load(open(os.path.join(C, "report-sample-2026-11-07.json"), encoding="utf-8"))
foodics_total = tr["product_mix"]["derived_total_quantity"]
kinder = next(x for x in tr["product_mix"]["lines_compared_with_inventory_workbook"] if x["workbook_cell"].endswith("F327"))
check("SRC-13 7 Nov Product Mix item units = Foodics total 2,182 + the unconfirmed Kinder line difference (12 - 2)",
      mix, foodics_total + (w["7"]["F327"].value - kinder["quantity"]), I, "P1-29")
assert DEC["P1-29"]["option"] == "keep", "P1-29 answer changed: review the Kinder check"
check("SRC-13 Kinder Dubai cake row kept at 12 (Abdo)", w["7"]["F327"].value, 12, A, "P1-29")
foodics = {x["workbook_cell"].split("!")[1]: x["quantity"] for x in tr["product_mix"]["lines_compared_with_inventory_workbook"] if x["mapping"] == "confirmed"}
foodics.update({"F199": 1, "F200": 1, "F201": 3})
check("SRC-13 7 Nov lines with a confirmed mapping = Foodics photo lines (Gorilla, Mtkandra, caramel, super kings, mango rice, gelato x4)",
      {k: w["7"][k].value for k in foodics}, foodics, I, "P1-29")
check("SRC-13 pecan row 202 is the row the pecan recipe reads", w["7"]["D202"].value, "جيلاتيتو روما بيكان", I, "P1-28")
check("SRC-13 deviation format shows minus", w["3"]["AD111"].number_format.replace("\\", ""), "0.00;[Red]-0.00", K, "P1-37")
units = Counter(w["1"][f"F{r}"].value for r in range(649, 3101) if w["1"][f"E{r}"].value == "مكسرات مشكلة")
check("SRC-13 mixed-nuts units left as recorded (P1-31 pending)", units.get("عدد", 0), 10, K, "P1-31")
check("SRC-13 no 'KGM' unit left", sum(1 for r in range(649, 3101) if w["1"][f"F{r}"].value == "KGM"), 0, K, "P1-31")
for sid, name in (("SRC-06", "inventory-oct-2026.xlsx"), ("SRC-13", "inventory-nov-2026-days-1-13.xlsx")):
    x = wb(name)
    check(f"{sid} monthly deviation (ice cream row 89) = cumulative deviation of day 31", round(x["Total"]["AD89"].value, 6), round(x["31"]["AE89"].value, 6), K, "P1-25")
w = wb("inventory-review-template-nov-2026.xlsx")["Sheet1"]
check("SRC-14 difference blank before count", w["K7"].value, None, K, "P1-34")
check("SRC-14 expected = total − consumption", w["M7"].value, (w["N7"].value or 0) - (w["O7"].value or 0), K, "P1-34")
w = wb("replenishment-order-nov-2026.xlsx")["Sheet1"]
check("SRC-01 order date stored as a date (same day as the text)", day(w["C6"].value), "2026-11-04", K, "P1-36")
check("SRC-01 unknown quantity D38 left as recorded", w["D38"].value, ",", K, "P1-36")

# ---------------------------------------------------------------- unintended changes
check("No unexplained cell or sheet change in any corrected copy (diff_corrected.py)",
      sum(v.get("changed_cells", {}).get("unexplained", 0) + len(v.get("sheets", {}).get("removed_without_op", [])) + len(v.get("sheets", {}).get("added_without_op", [])) for v in diff.values()), 0, I, "all")

report["summary"] = {
    "checks": len(report["checks"]), "passed": sum(c["ok"] for c in report["checks"]),
    "independent": sum(c["basis"] == I for c in report["checks"]), "construction": sum(c["basis"] == K for c in report["checks"]),
    "decision": sum(c["basis"] == A for c in report["checks"]),
    "errors_original": sum(sum(e["original"].values()) for e in report["errors"].values()),
    "errors_corrected": sum(sum(e["corrected"].values()) for e in report["errors"].values()),
    "errors_original_without_ledgers": sum(sum(e["original"].values()) for f, e in report["errors"].items() if "ledger" not in f),
}
json.dump(report, open(os.path.join(REPO, "docs", "phase1", "corrected-verification.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
bad = [c for c in report["checks"] if not c["ok"]]
print(json.dumps(report["summary"]))
for c in bad:
    print("FAIL", json.dumps(c, ensure_ascii=False, default=str))
for f, e in report["errors"].items():
    print(f, e)
