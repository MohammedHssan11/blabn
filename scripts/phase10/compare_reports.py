"""Compares the exported Phase 10 workbooks with the owner's existing workbooks (private reference JSON).

    python -I -X utf8 scripts/phase10/compare_reports.py [reference.json] [exports-folder] [output.json]

Reports every field that matches and every difference with its cell, expected value, actual value and class.
The reference holds real figures: keep the reference and the output under outputs/ (never commit them).
"""
import json
import sys
from pathlib import Path

import openpyxl

root = Path(__file__).resolve().parents[2]
ref_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "outputs" / "phase10" / "workbook-reference.json"
files = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "outputs" / "phase10" / "files"
out_path = Path(sys.argv[3]) if len(sys.argv) > 3 else root / "outputs" / "phase10" / "comparison.json"
ref = json.loads(ref_path.read_text(encoding="utf-8"))

compared, differences = 0, []


def check(report, where, field, expected, actual, tol=0.0, note=""):
    """Record one comparison. expected/actual may be None (blank)."""
    global compared
    compared += 1
    same = (expected is None and actual is None) or (
        expected is not None and actual is not None and abs(float(expected) - float(actual)) <= tol + 1e-9)
    if not same:
        differences.append({"report": report, "cell": where, "field": field, "expected": expected, "actual": actual, "note": note})


def sheet(path, name=None):
    wb = openpyxl.load_workbook(path, data_only=True)
    return wb[name] if name else wb.worksheets[0]


# -- 1. Daily Sales, October and November (both languages) -------------------------------------------------
COLS = {"C": ("sales", 0), "D": ("orders", 0), "E": ("average", 0.005), "F": ("expenses_incl_bank", 0),
        "G": ("bank_cash", 0), "H": ("bank_ratio", 0.00006), "I": ("card", 0), "J": ("card_ratio", 0.00006)}
EXTRA_DAYS = {"2026-11-03", "2026-11-07", "2026-11-10"}  # entered for the comparison/Foodics checks, not in the Daily Sales workbook
for month in ("2026-10", "2026-11"):
    book = ref["daily_sales"][month]
    for lang in ("en", "ar"):
        ws = sheet(files / f"daily_sales_{month}_{lang}.xlsx")
        rows = {}
        for row in range(3, ws.max_row + 1):
            d = ws[f"A{row}"].value
            if hasattr(d, "date"):
                rows[str(d.date())] = row
            elif isinstance(d, str) and d[:2] == "20":
                rows[d[:10]] = row
        report = f"Daily Sales {month} ({lang})"
        for date, values in book["days"].items():
            row = rows.get(date)
            for col, (key, tol) in COLS.items():
                check(report, f"{col}{row}" if row else date, f"{date} {key}", values[key], ws[f"{col}{row}"].value if row else None, tol)
        for date, row in rows.items():
            if date not in book["days"] and date not in EXTRA_DAYS:
                for col, (key, _) in COLS.items():
                    check(report, f"{col}{row}", f"{date} {key} (a day with no figure: blank, never zero)", None, ws[f"{col}{row}"].value)
        if month == "2026-10":
            total_row = max(rows.values()) + 1
            for col, (key, tol) in COLS.items():
                check(report, f"{col}{total_row}", f"total {key}", book["total"][key], ws[f"{col}{total_row}"].value, max(tol, 0.005) if key == "average" else (0.00006 if "ratio" in key else 0))

# -- 2. Daily statement of 2 November -------------------------------------------------------------------------
stmt = ref["statement_2026_11_02"]
ws = sheet(files / "daily_statement_2026-11-02_en.xlsx")
labels = {ws[f"A{r}"].value: r for r in range(1, ws.max_row + 1) if ws[f"A{r}"].value}
lines = [(ws[f"A{r}"].value, ws[f"D{r}"].value) for r in range(14, 20)]
for i, e in enumerate(e for e in stmt["expenses"] if e["label"] != "توريد بنك"):
    check("Statement 2 Nov", f"A{14 + i}:D{14 + i}", f"expense line {i + 1} amount ({e['label'][:20]})", e["amount"], lines[i][1] if i < len(lines) else None)
    compared += 1
    if i < len(lines) and (lines[i][0] or "").strip() != e["label"]:
        differences.append({"report": "Statement 2 Nov", "cell": f"A{14 + i}", "field": "expense description", "expected": e["label"], "actual": lines[i][0], "note": ""})
remittance = next(e["amount"] for e in stmt["expenses"] if e["label"] == "توريد بنك")
check("Statement 2 Nov", "D20", "bank remittance", remittance, ws["D20"].value)
check("Statement 2 Nov", "D22", "total expenses including bank remittance", stmt["expenses_total"], ws["D22"].value)
row_of = lambda text: next((r for r in range(1, ws.max_row + 1) if ws[f"A{r}"].value == text), None)
for text, col, field, expected, note in (
        ("Card/Visa", "B", "card/Visa", stmt["card"], ""),
        ("Total amount", "B", "total amount", stmt["grand_total"], ""),
        ("System revenue", "B", "system revenue", stmt["system_revenue"], ""),
        ("Over/short", "B", "over/short at the count", stmt["over_short"],
         "The application adds the previous days' book balance to the expected cash; the workbook starts every day at zero.")):
    r = row_of(text)
    check("Statement 2 Nov", f"{col}{r}", field, expected, ws[f"{col}{r}"].value if r else None, note=note)
for face, v in ref["ledger_2026_11_02"]["denominations"].items():
    r = next((r for r in range(24, 45) if isinstance(ws[f"A{r}"].value, (int, float)) and float(ws[f"A{r}"].value) == float(face)), None)
    check("Statement 2 Nov", f"B{r}", f"count of {face} MAD notes", v["count"], ws[f"B{r}"].value if r else None)
r_total = next(r for r in range(24, 50) if ws[f"A{r}"].value == "Total")
check("Statement 2 Nov", f"C{r_total}", "counted cash total", ref["ledger_2026_11_02"]["counted_total"], ws[f"C{r_total}"].value)

# -- 3. Yawmeya of 2 November ---------------------------------------------------------------------------------
led = ref["ledger_2026_11_02"]
ws = sheet(files / "daily_ledger_2026-11-02_en.xlsx")
find = lambda text, col="A": next((r for r in range(1, ws.max_row + 1) if ws[f"{col}{r}"].value == text), None)
check("Yawmeya 2 Nov", f"B{find('Total sales')}", "total sales", led["total_sales"], ws[f"B{find('Total sales')}"].value)
check("Yawmeya 2 Nov", f"B{find('Card/Visa')}", "card/Visa", led["card"], ws[f"B{find('Card/Visa')}"].value)
r_closing = next(r for r in range(1, ws.max_row + 1) if ws[f"C{r}"].value == "Closing balance")
r_open = next(r for r in range(1, ws.max_row + 1) if ws[f"C{r}"].value == "Opening balance")
check("Yawmeya 2 Nov", f"D{r_open}", "cash ledger opening balance (رصيد أمس)", led["opening"], ws[f"D{r_open}"].value,
      note="Book balance carried from earlier days; the workbook shows zero.")
check("Yawmeya 2 Nov", f"D{r_closing}", "cash ledger closing balance (رصيد اليوم)", led["closing"], ws[f"D{r_closing}"].value,
      note="Book balance after the remittance of the counted cash; the workbook shows zero.")
r_tot = next(r for r in range(1, ws.max_row + 1) if ws[f"C{r}"].value == "Movement totals")
check("Yawmeya 2 Nov", f"E{r_tot}", "cash out (expenses + bank remittance = عهدة مشتريات)", led["purchasing_custody"], ws[f"E{r_tot}"].value)
check("Yawmeya 2 Nov", f"B{find('Over/short')}", "over cash (اوفر كاش)", led["over_cash"], ws[f"B{find('Over/short')}"].value,
      note="Same cause as the statement: the carried balance.")
r_cust_tot = [r for r in range(1, ws.max_row + 1) if ws[f"C{r}"].value == "Movement totals"][1]
check("Yawmeya 2 Nov", f"D{r_cust_tot}", "purchasing custody received (عهدة مشتريات)", led["purchasing_custody"], ws[f"D{r_cust_tot}"].value,
      note="The workbook passes the day's cash through the purchasing-custody sheet; the application books the expenses and the bank remittance on the cash ledger.")

# -- 4. Weekly comparison of 10 November against 3 November ----------------------------------------------------
week = ref["weekly_comparison_2026_11_10"]
ws = sheet(files / "sales_comparison_week_en.xlsx")
for key, label in (("total", "Total of selected branches"), ("alquds", "Al Quds"), ("maarif", "Maarif"), ("bourgogne", "Bourgogne")):
    w = week[key]
    matching = [cell.row for cell in ws["A"] if cell.value == label]
    row = matching[0] if len(matching) == 1 else None
    for col, field, tol in (("C", "sales", 0), ("D", "orders", 0), ("G", "prior_sales", 0),
                            ("H", "prior_orders", 0), ("L", "ratio", 0.00006)):
        where = f"{col}{row}" if row else label
        check("Weekly comparison", where, f"{label} {field}", w[field], ws[where].value if row else None,
              tol, note="Expected one matching branch row" if row is None else "")

out_path.write_text(json.dumps({"compared": compared, "differences": differences}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{compared} comparisons, {len(differences)} differences -> {out_path}")
for d in differences:
    print(f"  {d['report']} {d['cell']} {d['field']}: expected {d['expected']!r}, actual {d['actual']!r}  {d['note']}")
