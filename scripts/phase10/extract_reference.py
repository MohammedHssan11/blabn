"""Reads the owner's existing Excel workbooks (local-only, outside Git) and writes the private
Phase 10 reference JSON used to enter real days into the private validation stack and to compare
the exported reports with them. The output holds real figures: keep it under outputs/ (never commit).

    python -I -X utf8 scripts/phase10/extract_reference.py [source-folder] [output-file]
"""
import json
import sys
from pathlib import Path

import openpyxl

root = Path(__file__).resolve().parents[2]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "source-material" / "corrected"
output = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "outputs" / "phase10" / "workbook-reference.json"

COLUMNS = {"B": "sales", "C": "orders", "D": "average", "E": "cancellations", "F": "hospitality",
           "G": "expenses_incl_bank", "H": "bank_cash", "I": "bank_ratio", "J": "card", "K": "card_ratio"}


def daily_sales(name):
    sheet = openpyxl.load_workbook(source / name, data_only=True).active
    days, total = {}, {}
    for row in range(3, 40):
        label = sheet[f"A{row}"].value
        values = {key: sheet[f"{col}{row}"].value for col, key in COLUMNS.items()}
        if hasattr(label, "date"):
            if any(v is not None for v in values.values()):
                days[str(label.date())] = values
        elif str(label or "").strip().upper() == "TOTAL":
            total = values
    return {"days": days, "total": total}


def statement_day(name, sheet_name):
    sheet = openpyxl.load_workbook(source / name, data_only=True)[sheet_name]
    expenses = []
    for row in range(6, 14):
        amount, label = sheet[f"D{row}"].value, sheet[f"E{row}"].value
        if amount not in (None, "") and label:
            expenses.append({"label": str(label).strip(), "amount": amount})
    return {
        "date": str(sheet["I3"].value),
        "expenses": expenses,
        "over_short": sheet["I17"].value,
        "card": sheet["I20"].value,
        "expenses_total": sheet["I21"].value,
        "grand_total": sheet["I23"].value,
        "system_revenue": sheet["I25"].value,
        "expenses_footer": sheet["D28"].value,
    }


def ledger_day(name, sheet_name):
    sheet = openpyxl.load_workbook(source / name, data_only=True)[sheet_name]
    denominations = {}
    for row in range(10, 20):
        face, value = sheet[f"L{row}"].value, sheet[f"M{row}"].value
        count = sheet[f"K{row}"].value
        if face is not None and count not in (None, ""):
            denominations[str(face)] = {"count": count, "value": value}
    return {
        "evening_sales": sheet["E16"].value,
        "total_sales": sheet["E17"].value,
        "purchasing_custody": sheet["F19"].value,
        "card": sheet["F20"].value,
        "over_cash": sheet["E21"].value,
        "counted_total": sheet["M20"].value,
        "denominations": denominations,
        "totals": {"in": sheet["E41"].value, "out": sheet["F41"].value},
        "opening": sheet["E42"].value,
        "closing": sheet["E45"].value,
    }


def weekly_comparison(name):
    sheet = openpyxl.load_workbook(source / name, data_only=True).active
    blocks = {"total": "A", "alquds": "L", "maarif": "W", "bourgogne": "AH"}
    result = {}
    for key, ratio_col in blocks.items():
        idx = openpyxl.utils.column_index_from_string(ratio_col)
        cell = lambda offset, row=6: sheet.cell(row=row, column=idx + offset).value
        result[key] = {
            "ratio": cell(0), "orders": cell(1), "sales": cell(2), "date": str(cell(4)),
            "prior_orders": cell(5), "prior_sales": cell(6), "prior_date": str(cell(8)),
        }
    return result


data = {
    "note": "Private: real workbook figures. Never commit.",
    "daily_sales": {
        "2026-10": daily_sales("daily-sales-oct-2026.xlsx"),
        "2026-11": daily_sales("daily-sales-nov-2026.xlsx"),
    },
    "statement_2026_11_02": statement_day("daily-statement-nov-2026.xlsx", "2"),
    "ledger_2026_11_02": ledger_day("daily-ledger-nov-2026.xlsx", "2"),
    "weekly_comparison_2026_11_10": weekly_comparison("weekly-comparison-nov-2026.xlsx"),
    "foodics_2026_11_07": json.loads((source / "report-sample-2026-11-07.json").read_text(encoding="utf-8")),
}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{output}: {len(data['daily_sales']['2026-10']['days'])} October days, {len(data['daily_sales']['2026-11']['days'])} November days")
