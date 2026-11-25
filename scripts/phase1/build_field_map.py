"""Build the Phase 1 report field map: docs/phase1/field-map.json and docs/phase1/FIELD_MAP.md.

Each field of the five report families records its legacy location, meaning, source record,
unit, date basis, rounding, blank-value behaviour, the findings that shape it, and its status:
  agreed (Abdo)  - every finding that shapes the field is settled and Abdo accepted the outcome;
  agreed (team)  - settled by the team's verified correction or rule; Abdo has not contested it;
  pending        - waits for the listed findings (an unanswered question, a pending decision,
                   or an alternative that is not fully specified and has no agreed final rule;
                   "not sure" stays unresolved).
Status is recomputed from findings.json, decisions/abdo-decisions.json and
decisions/agreed-outcomes.json every time this script runs, so rerun it after importing answers.
Every one of the 37 findings is either linked to a field or listed with the reason it has none.
Usage (repo root): python scripts/phase1/build_field_map.py [--check]
  --check writes nothing and exits 1 when the committed map differs from the recorded decisions.
"""
from __future__ import annotations

import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
D = os.path.join(REPO, "docs", "phase1")
F = {f["id"]: f for f in json.load(open(os.path.join(D, "findings.json"), encoding="utf-8"))["findings"]}


def load(path, default):
    p = os.path.join(os.environ.get("DECISIONS_DIR") or os.path.join(D, "decisions"), path)  # DECISIONS_DIR: tests
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else default


DEC = load("abdo-decisions.json", {}).get("decisions", {})
QF = json.load(open(os.path.join(REPO, "docs", "phase1", "review-questions.json"), encoding="utf-8"))
QMAP = {q["finding"]: q for q in QF["questions"]}


def answered(d):
    """An answer counts only if it is not 'not sure' (unsure stays unresolved)."""
    return bool(d) and d.get("choice") != "unsure"


def needs_rule(x, d):
    """True when the answer still needs a team-agreed final rule (record_outcome.py agree)."""
    if not answered(d):
        return False
    q = QMAP.get(x)
    if not q:  # finding without a page question: anything but 'accept' contests the team's handling
        return d["choice"] != "accept"
    if d["choice"] != "alternative":
        return False  # accept and keep are complete decisions
    o = next((o for o in q["options"] if o["key"] == d.get("option")), None)
    return not (o and o.get("needs_agreement") is False)  # a fully specified alternative needs no extra rule


AGREED = load("agreed-outcomes.json", {}).get("outcomes", {})

average_confirmed = DEC.get("P1-03", {}).get("option") == "sales_over_orders"
cash_count_confirmed = DEC.get("P1-13", {}).get("option") == "before_remittance"
bourgogne_confirmed = DEC.get("P1-10", {}).get("option") == "bourgogne_10_nov"
weekly_ratio_confirmed = DEC.get("P1-08", {}).get("option") == "keep_ratio"

BD = "Business date of the closed day (not the print or entry date)"
COUNT_DATE = BD + ("; count before bank remittance" if cash_count_confirmed else "; see P1-13 for count timing")
AVG_DISPLAY = "2 decimals for display, as in the Foodics reference" if average_confirmed else "See P1-03"
MAD = "MAD"
NONE = "None; stored as entered"
# id, report, field_en, field_ar, legacy location, meaning, source record, unit, date basis, rounding, blank behaviour, findings, pending_on, later phase
FIELDS = [
    # ---------------------------------------------------------------- Daily Sales Maarief
    ("DS-01", "Daily Sales", "Business date", "التاريخ", "SRC-02/03 Sheet1!A3:A33", "One row per business day of the month", "Daily close: business date", "date", BD, "-", "Day without a close shows its date and blank figures", ["P1-07"], [], "Phase 9"),
    ("DS-02", "Daily Sales", "Sales", "المبيعات", "SRC-02/03 Sheet1!B", "Net sales of the business day (Foodics 'Net Sales')", "Daily close: sales/revenue", MAD, BD, NONE, "Blank, not 0, when the day is not closed", ["P1-07"], [], "Phase 9"),
    ("DS-03", "Daily Sales", "Orders", "عدد الطلبات", "SRC-02/03 Sheet1!C", "Order count of the business day (Foodics orders)", "Daily close: order count", "count", BD, "-", "Blank when not closed", ["P1-07"], [], "Phase 9"),
    ("DS-04", "Daily Sales", "Average order value", "متوسط الطلب", "SRC-02/03 Sheet1!D", "Net sales / order count" if average_confirmed else "See P1-03 for the average-order definition", "Calculated from DS-02 and DS-03", MAD, BD, AVG_DISPLAY, "Blank when orders are blank or 0", ["P1-03"], ["P1-03"], "Phase 9"),
    ("DS-05", "Daily Sales", "Expenses incl. bank remittance", "المصاريف (شاملة توريد البنك)", "SRC-02/03 Sheet1!G", "Operating expenses plus bank remittance, as the legacy column holds", "Daily close: expenses + bank remittance (stored separately)", MAD, BD, NONE, "Blank when not closed", ["P1-04", "P1-05", "P1-06"], [], "Phase 9"),
    ("DS-06", "Daily Sales", "Cash (bank remittance)", "كاش (توريد البنك)", "SRC-02/03 Sheet1!H", "Bank remittance of the day", "Daily close: bank remittance", MAD, BD, NONE, "Blank when no remittance is recorded", ["P1-04", "P1-06"], [], "Phase 9"),
    ("DS-07", "Daily Sales", "Remittance ratio", "نسبة التوريد", "SRC-02/03 Sheet1!I", "Remittance / sales", "Calculated", "ratio", BD, "None; shown as %", "Blank when sales are blank or 0", ["P1-04", "P1-11"], [], "Phase 9"),
    ("DS-08", "Daily Sales", "Card/Visa", "فيزا", "SRC-02/03 Sheet1!J", "Card payments of the day (Foodics card payments)", "Daily close: card/Visa", MAD, BD, NONE, "Blank when not closed", ["P1-07"], [], "Phase 9"),
    ("DS-09", "Daily Sales", "Card ratio", "نسبة الفيزا", "SRC-02/03 Sheet1!K", "Card / sales", "Calculated", "ratio", BD, "None; shown as %", "Blank when sales are blank or 0", ["P1-11"], [], "Phase 9"),
    ("DS-10", "Daily Sales", "Month totals", "الإجمالي", "SRC-02/03 Sheet1!B35:K35", "Sums of the closed days; period average = total sales / total orders; ratios on totals; shows how many days are included", "Calculated from saved days", MAD, "Selected month", AVG_DISPLAY, "Blank ratios for a month with no entries", ["P1-03", "P1-07", "P1-11"], ["P1-03"], "Phase 9"),
    ("DS-11", "Daily Sales", "Title", "العنوان", "SRC-02/03 Sheet1!A1", "Branch and period of the report", "Generated from branch and selected period", "text", "Selected month", "-", "-", ["P1-07", "P1-23"], [], "Phase 9"),
    # ---------------------------------------------------------------- Daily statement
    ("ST-01", "Daily statement", "Date", "التاريخ", "SRC-04/05 day sheet!I3", "Business date of the sheet", "Daily close: business date", "date", BD, "-", "-", ["P1-16"], [], "Phase 9"),
    ("ST-02", "Daily statement", "Expense lines", "المصروفات", "SRC-04/05 day sheet!D6:E26", "Each expense with its description, and the bank remittance as its own line", "Daily close: expenses and bank remittance", MAD, BD, NONE, "Only recorded lines are listed", ["P1-04", "P1-16"], [], "Phase 9"),
    ("ST-03", "Daily statement", "Total expenses", "اجمالي المصروفات", "SRC-04/05 day sheet!D28 → I21", "Legacy expense-line total can include remittance for display. The cash-count calculation uses timed cash movements from the ledger.", "Calculated", MAD, BD, NONE, "0 when no expense line", ["P1-04", "P1-14"], [], "Phase 9"),
    ("ST-04", "Daily statement", "Counted cash by denomination", "الإجمالي النقدي", "SRC-04/05 day sheet!G6:I13, I15", "Physical drawer count, recorded at the time of counting", "Daily close: counted cash (denominations, counter, time)", MAD, COUNT_DATE, NONE, "Blank = not counted (never 0)", ["P1-12", "P1-13"], ["P1-13"], "Phase 4"),
    ("ST-05", "Daily statement", "Card/Visa", "فيزا", "SRC-04/05 day sheet!I20", "Card payments of the day", "Daily close: card/Visa", MAD, BD, NONE, "Blank when not entered", ["P1-14"], [], "Phase 9"),
    ("ST-06", "Daily statement", "Total amount", "اجمالي المبلغ", "SRC-04/05 day sheet!I23", "For the pre-remittance reference close: counted cash + card + operating cash expenses through the count. Show the later bank remittance on its own line.", "Calculated from counted cash, card and timed ledger entries", MAD, BD, NONE, "Uses blank count as not counted", ["P1-13", "P1-14"], ["P1-13"], "Phase 9"),
    ("ST-07", "Daily statement", "System revenue", "اجمالي الايراد (سيستم)", "SRC-04/05 day sheet!I25", "Net sales of the day from Foodics", "Daily close: sales/revenue", MAD, BD, NONE, "A day cannot close without it; blank shows no over/short", ["P1-15"], [], "Phase 4"),
    ("ST-08", "Daily statement", "Over/short", "اوفركاش او عجز", "SRC-04/05 day sheet!I17", "Counted cash minus expected cash at count time. The 2 November reference yields +3 MAD.", "Daily close reconciliation shared with the ledger", MAD, BD, NONE, "Blank when system revenue or the count is missing", ["P1-12", "P1-13", "P1-14", "P1-15"], ["P1-13"], "Phase 4"),
    ("ST-09", "Daily statement", "Counter, cashier, shift", "القائم بالجرد / الكاشير / الشيفت", "SRC-04/05 day sheet!D4:G4", "Who counted the cash and who was cashier; whether they must differ is pending", "Daily close: user, counter and role", "text", BD, "-", "Placeholders rejected", ["P1-19"], ["P1-19"], "Phase 4"),
    # ---------------------------------------------------------------- Daily ledger
    ("LG-01", "Daily ledger", "Business date and branch", "التاريخ والفرع", "SRC-10/11 day sheet!G4, C4", "Date and branch of each daily close", "Daily close: business date, branch", "date/text", BD, "-", "Required", ["P1-19"], [], "Phase 4"),
    ("LG-02", "Daily ledger", "Sales entries and total", "المبيعات صباحي/مسائي", "SRC-10/11 day sheet!rows 17-19, E17", "Morning and evening sales and their total", "Daily close: sales entries", MAD, BD, NONE, "Blank when not entered", [], [], "Phase 4"),
    ("LG-03", "Daily ledger", "Card/Visa and other payments", "الفيزا والمدفوعات", "SRC-10/11 day sheet!row 20 and payment rows; hidden journal Sheet1", "Card and other payment rows of the day", "Daily close: payments", MAD, BD, NONE, "Blank when not entered", ["P1-21"], [], "Phase 4"),
    ("LG-04", "Daily ledger", "Receipts and expenses with account", "المقبوضات والمصروفات", "SRC-10/11 day sheet!rows 21-55 (codes), Ref_ lists", "Each receipt or expense with its account/category from the expense list", "Daily close: ledger entries; expense categories seeded from Ref_", MAD, BD, NONE, "Only recorded rows", ["P1-22"], [], "Phase 4"),
    ("LG-05", "Daily ledger", "Counted cash and reconciliation message", "عد الخزينة ونتيجة المطابقة", "SRC-10/11 day sheet!K10:M20, O14", "Count by denomination and the reconciliation result. Expected cash includes cash movements through the count time.", "Daily close: counted cash", MAD, COUNT_DATE, NONE, "Blank count = 'not counted', never 'match'", ["P1-12", "P1-13"], ["P1-13"], "Phase 4"),
    ("LG-06", "Daily ledger", "Cash ledger opening and closing", "رصيد الخزينة", "SRC-10/11 day sheet!E41:E45", "Opening = previous business day's closing; days chained in date order", "Calculated from saved entries", MAD, BD, NONE, "First live day uses the reviewed opening balance", ["P1-17", "P1-18"], [], "Phase 4"),
    ("LG-07", "Daily ledger", "Purchasing custody opening and closing", "رصيد العهدة", "SRC-10/11 day sheet!E86:E90", "Separate ledger; opening = previous day's closing", "Calculated from saved entries", MAD, BD, NONE, "First live day uses the reviewed opening balance", ["P1-17"], [], "Phase 4"),
    ("LG-08", "Daily ledger", "Cash counter and role, cashier", "القائم بالجرد والكاشير", "SRC-10/11 day sheet!counter and cashier cells", "Employee and role responsible for the count; separation from cashier pending", "Daily close: user, counter and role", "text", BD, "-", "Placeholders rejected", ["P1-19"], ["P1-19"], "Phase 4"),
    ("LG-09", "Daily ledger", "Cancellation register", "الأوردرات الملغية", "SRC-10/11 day sheet!I24:S55", "Branch, date, order start, cancellation time, old/new order id and value, reason, customer (phone masked in tests)", "Cancellation records", "MAD / text", BD, NONE, "Rows only for real cancellations (no placeholder branch/date)", ["P1-19", "P1-20"], [], "Phase 4"),
    ("LG-10", "Daily ledger", "Monthly summary by day", "ملخص اليومية", "SRC-10/11 ملخص!C5:J37", "Per-day receipts, payments and total cancellation value, derived from saved entries", "Calculated from saved entries", MAD, "Selected month", NONE, "Days without entries are blank", ["P1-18", "P1-20", "P1-23"], [], "Phase 9"),
    ("LG-11", "Daily ledger", "Monthly summary by account", "ملخص الحسابات", "SRC-10/11 ملخص (account columns)", "Totals per account/category from saved entries", "Calculated from saved entries", MAD, "Selected month", NONE, "-", ["P1-20", "P1-22"], [], "Phase 9"),
    # ---------------------------------------------------------------- Sales comparison
    ("CMP-01", "Sales comparison", "Monthly comparison days", "التاريخ (الشهر الحالي والسابق)", "SRC-08/09 E/I/L columns", "Same day number in the current and prior month", "Saved business days; pre-live figures as approved reporting-only records", "date", BD, "-", "Day not entered shows blank", ["P1-07", "P1-09"], [], "Phase 7"),
    ("CMP-02", "Sales comparison", "Monthly sales and orders", "المبيعات والطلبات", "SRC-08/09 E,F / I,J", "Daily sales and orders of each month", "Daily close / reporting-only records", MAD, BD, NONE, "Blank, not 0, when not entered", ["P1-07", "P1-09"], [], "Phase 7"),
    ("CMP-03", "Sales comparison", "Monthly growth", "نسبة النمو", "SRC-08/09 D6:D36", "Current / prior − 1", "Calculated", "ratio", BD, "None; shown as %", "Blank when current not entered or prior 0/missing; recorded 0 gives −100%", ["P1-08", "P1-09"], [], "Phase 7"),
    ("CMP-04", "Sales comparison", "Period growth", "نسبة النمو للفترة", "SRC-08/09 D37", "Like-for-like: only days entered in both months", "Calculated", "ratio", "Selected period", "None; shown as %", "Blank when no comparable day", ["P1-09"], [], "Phase 7"),
    ("CMP-05", "Sales comparison", "Weekly comparison dates", "تواريخ المقارنة الأسبوعية", "SRC-12 E6/I6, P6/T6, AA6/AE6, AL6/AP6", "Compare the same weekday using one shared current/prior date pair. Reference: 10 and 3 November." if bourgogne_confirmed else "Use one shared current/prior date pair. See P1-10 for the reference dates.", "Selected dates", "date", BD, "-", "-", ["P1-10"], ["P1-10"], "Phase 7"),
    ("CMP-06", "Sales comparison", "Weekly current/prior ratio", "نسبة الحالي للسابق", "SRC-12 A6, L6, W6, AH6", "Current sales / prior sales" if weekly_ratio_confirmed else "See P1-08 for the weekly measure", "Calculated", "ratio", BD, "None; shown as %", "Blank when prior is 0 or missing", ["P1-08"], ["P1-08"], "Phase 7"),
    ("CMP-07", "Sales comparison", "Branch figures (Al Quds, Maarif, Bourgogne)", "أرقام الفروع", "SRC-12 M:N, X:Y, AI:AJ (current) and prior", "Sales and orders per branch; Al Quds and Bourgogne entered manually with source and date", "Maarif: daily close; others: comparison entries", MAD, BD, NONE, "Missing branch shown as missing, not 0", ["P1-10"], ["P1-10"], "Phase 7"),
    ("CMP-08", "Sales comparison", "Total of branches", "الإجمالي", "SRC-12 B:C, F:G", "Sum of the branches for the same dates only", "Calculated", MAD, BD, NONE, "Marked incomplete when a branch is missing", ["P1-10"], ["P1-10"], "Phase 7"),
    # ---------------------------------------------------------------- Inventory and replenishment order
    ("INV-01", "Inventory and order", "Product Mix quantity", "الكمية المباعة", "SRC-06/13 day sheet!F8:F600", "Quantity sold per product from the Foodics Products Mix", "Product Mix lines (manual in v1)", "count", BD, "-", "Blank product = not sold that day", ["P1-27", "P1-28", "P1-29"], ["P1-29", "P1-28"], "Phase 5"),
    ("INV-02", "Inventory and order", "Product Mix amount and shares", "المبلغ والنسبة", "SRC-06/13 day sheet!G, H, I", "Sales amount per line; must sum to net sales before consumption posts", "Product Mix lines", MAD, BD, NONE, "Shares blank when the section total is 0", ["P1-27"], [], "Phase 5"),
    ("INV-03", "Inventory and order", "Product name and section", "الصنف والقسم", "SRC-06/13 day sheet!C:D", "Foodics name kept as printed, mapped to one approved product", "Catalog mapping", "text", "-", "-", "Unmapped name goes to 'needs mapping'", ["P1-28"], ["P1-28"], "Phase 5"),
    ("INV-04", "Inventory and order", "Opening stock", "اول المدة", "SRC-06/13 day sheet!P", "Previous day's count, or its book balance when the item was not counted", "Calculated; first live day from reviewed opening balances", "item unit", BD, NONE, "Not counted → previous book balance", ["P1-24", "P1-33"], [], "Phase 6"),
    ("INV-05", "Inventory and order", "Receipts, returns, purchases, transfers in", "الوارد / مرتجع / مشتريات / محول من", "SRC-06/13 day sheet!Q:T; الوارد sheet", "Record stock actually received on the day it arrives. A purchase order changes stock only when a receipt is recorded.", "Stock movements; purchase receipts link to their order lines", "item unit", "Actual receipt business date", NONE, "Blank = none received", ["P1-26", "P1-35"], ["P1-35"], "Phase 6"),
    ("INV-06", "Inventory and order", "Recipe consumption", "الأستهلاكات", "SRC-06/13 day sheet!V; recipe list rows 649-3100", "Product Mix × approved recipe per component, using the recipe version valid on the date", "Calculated from Product Mix and recipes", "component unit", BD + "; recipe version date pending (P1-32)", NONE, "-", ["P1-30", "P1-31", "P1-32"], ["P1-31", "P1-32"], "Phase 5"),
    ("INV-07", "Inventory and order", "Waste, hospitality, deductions, transfers out", "الهالك / الضيافة / تحميلات / محول الى", "SRC-06/13 day sheet!X:AA", "Other stock movements of the day", "Stock movements", "item unit", BD, NONE, "Blank = none", [], [], "Phase 6"),
    ("INV-08", "Inventory and order", "Book balance", "الرصيد الدفتري", "SRC-06/13 day sheet!AB", "Opening + receipts − consumption − other movements", "Calculated", "item unit", BD, NONE, "-", ["P1-24"], [], "Phase 6"),
    ("INV-09", "Inventory and order", "Physical count", "الجرد الفعلي", "SRC-06/13 day sheet!AC", "Counted quantity; blank = not counted, 0 = counted zero; numbers only", "Physical counts", "item unit", BD, NONE, "Blank stays blank; symbols rejected", ["P1-24", "P1-26"], [], "Phase 6"),
    ("INV-10", "Inventory and order", "Deviation and cumulative deviation", "الانحراف / التراكمي", "SRC-06/13 day sheet!AD:AE", "Count − book only when counted; cumulative across the month; negative shown with a minus", "Calculated", "item unit", BD, "2 decimals display", "Blank when not counted", ["P1-24", "P1-25", "P1-37"], [], "Phase 6"),
    ("INV-11", "Inventory and order", "Monthly deviation", "انحراف الشهر", "SRC-06/13 Total!AD; الأنحرافات sheet", "Cumulative deviation at month end", "Calculated", "item unit", "Selected month", "2 decimals display", "-", ["P1-23", "P1-25"], [], "Phase 6"),
    ("INV-12", "Inventory and order", "Component unit", "الوحدة", "SRC-06/13 recipe list!F", "One base unit per component with conversion factors", "Catalog", "unit", "-", "-", "-", ["P1-31"], ["P1-31"], "Phase 5"),
    ("INV-13", "Inventory and order", "Review: expected stock and difference", "المتوقع والفرق", "SRC-14 Sheet1!K, M", "Expected = total − consumption; difference only after a count", "Calculated", "item unit", BD, NONE, "Difference blank before a count", ["P1-34"], [], "Phase 6"),
    ("ORD-01", "Inventory and order", "Order date and expected receipt date", "تاريخ الطلبية والاستلام المتوقع", "SRC-01 Sheet1!C6 (legacy date interpretation tracked in the Phase 1 closure checklist)", "Store creation, expected receipt and actual receipt dates separately. Default to the order business date plus two calendar days.", "Purchase orders and receipts", "date", "Order business date / expected receipt date / actual receipt date", "-", "-", ["P1-35", "P1-36"], ["P1-35"], "Phase 8"),
    ("ORD-02", "Inventory and order", "Order lines", "سطور الطلبية", "SRC-01 Sheet1!B:G", "Single-branch order; each line: catalog item, unit, numeric quantity, source (factory or store)", "Purchase order lines", "item unit", "Order created date", NONE, "Non-numeric quantity rejected", ["P1-36"], [], "Phase 8"),
]
NO_FIELD = {
    "P1-01": "Source-material completeness (copies of the newer workbook and template); no report field.",
    "P1-02": "Source transcription verified against the photos; the project owner confirmed M04 as 'دنيا البمبوظه' on 20 Nov 2026. Test evidence only, with no report field definition or pending Abdo decision.",
}

errors = []
linked = set()
out_fields = []
for row in FIELDS:
    fid, rep, en, ar, loc, meaning, src, unit, date, rnd, blank, findings, pending_on, phase = row
    for x in findings + pending_on:
        if x not in F:
            errors.append(f"{fid}: unknown finding {x}")
    for x in pending_on:
        if x not in findings:
            errors.append(f"{fid}: pending_on {x} not in findings")
        if not (F[x].get("abdo") or F[x]["status"] == "decision"):
            errors.append(f"{fid}: pending_on {x} is not an open question or decision")
    linked.update(findings)
    waiting, contested, by_abdo = [], [], []
    for x in findings:
        d = DEC.get(x)
        if x in pending_on and not answered(d) and x not in AGREED:
            waiting.append(x)  # no answer yet, or "not sure", and no rule agreed with Abdo (agreed-outcomes.json)
        elif answered(d) and needs_rule(x, d) and x not in AGREED:
            contested.append(x)
        elif answered(d):
            by_abdo.append(x)
    if waiting or contested:
        status = "pending"
    elif findings and all(x in by_abdo or x in AGREED for x in findings):
        status = "agreed (Abdo)"
    else:
        status = "agreed (team)"
    out_fields.append({"id": fid, "report": rep, "field_en": en, "field_ar": ar, "legacy_location": loc, "meaning": meaning,
                       "source_record": src, "unit": unit, "date_basis": date, "rounding": rnd, "blank_behaviour": blank,
                       "findings": findings, "pending_on": pending_on, "status": status, "waiting_for_answer": waiting,
                       "contested_without_agreed_rule": contested, "implemented_in": phase})
missing = sorted(set(F) - linked - set(NO_FIELD))
if missing:
    errors.append("findings neither linked to a field nor listed in NO_FIELD: " + ", ".join(missing))
if errors:
    sys.exit("field map errors:\n  " + "\n  ".join(errors))

summary = {"fields": len(out_fields), "pending": sum(f["status"] == "pending" for f in out_fields),
           "agreed_team": sum(f["status"] == "agreed (team)" for f in out_fields),
           "agreed_abdo": sum(f["status"] == "agreed (Abdo)" for f in out_fields)}
map_json = json.dumps({"schema": "blabn-phase1-field-map/1", "findings_version": json.load(open(os.path.join(D, "findings.json"), encoding="utf-8"))["version"],
                       "summary": summary, "fields": out_fields, "findings_without_field": NO_FIELD}, ensure_ascii=False, indent=1)

cell = lambda s: str(s).replace("|", "\\|")
L = ["# Phase 1 report field map", "",
     "Generated by `scripts/phase1/build_field_map.py` from [findings.json](findings.json) and Abdo's recorded answers; source data in [field-map.json](field-map.json). Rerun it after importing answers.", "",
     f"**{summary['fields']} fields** in the five report families: **{summary['pending']} pending**, {summary['agreed_team']} agreed by the team (Abdo can still contest), {summary['agreed_abdo']} agreed by Abdo.", "",
     "Status rules: *pending* waits for the listed findings (an unanswered question or decision, or an answer that is not 'accept' without an agreed final rule); *agreed (team)* rests on the team's verified correction or rule; *agreed (Abdo)* has Abdo's acceptance or an agreed rule for every linked finding. Layout and label retention for each template is confirmed when Abdo confirms the final set of decisions.", ""]
for rep in dict.fromkeys(f["report"] for f in out_fields):
    L += [f"## {rep}", "", "| ID | Field | Legacy location | Meaning | Source record | Unit | Date basis | Rounding | Blank values | Findings | Status | Phase |", "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for f in out_fields:
        if f["report"] != rep:
            continue
        st = f["status"] if f["status"] != "pending" else "**pending: " + ", ".join(f["waiting_for_answer"] + [x + " (contested)" for x in f["contested_without_agreed_rule"]]) + "**"
        L.append(f"| {f['id']} | {cell(f['field_en'])} / {cell(f['field_ar'])} | {cell(f['legacy_location'])} | {cell(f['meaning'])} | {cell(f['source_record'])} | {f['unit']} | {cell(f['date_basis'])} | {cell(f['rounding'])} | {cell(f['blank_behaviour'])} | {', '.join(f['findings']) or '—'} | {st} | {f['implemented_in']} |")
    L.append("")
L += ["## Findings with no report field", "", "| Finding | Why |", "|---|---|"] + [f"| {k} | {v} |" for k, v in NO_FIELD.items()] + [""]
pend = {}
for f in out_fields:
    for x in f["waiting_for_answer"] + f["contested_without_agreed_rule"]:
        pend.setdefault(x, []).append(f["id"])
L += ["## Pending fields by finding", "", "| Finding | Needed | Fields |", "|---|---|---|"]
for x in sorted(pend):
    need = "Required for Phase 1" if F[x].get("abdo") == "required" else ("Before " + F[x].get("abdo_by", "a later phase") if F[x].get("abdo") == "later" else "Decision")
    L.append(f"| {x} | {need} | {', '.join(pend[x])} |")
L.append("")
outputs = {"field-map.json": map_json, "FIELD_MAP.md": "\n".join(L)}
if "--check" in sys.argv[1:]:
    # The map is derived from the findings and every decision record (agreed-outcomes.json included).
    # A recorded decision without a regenerated map leaves stale field statuses in the repository.
    def on_disk(name):
        p = os.path.join(D, name)
        return open(p, encoding="utf-8").read().replace("\r\n", "\n") if os.path.exists(p) else None
    stale = [name for name, text in outputs.items() if on_disk(name) != text]
    if stale:
        sys.exit("field map is out of date (" + ", ".join(stale) + "); run python scripts/phase1/build_field_map.py")
    print("field map is up to date", json.dumps(summary))
    sys.exit(0)
for name, text in outputs.items():
    open(os.path.join(D, name), "w", encoding="utf-8").write(text)
print(json.dumps(summary))
