"""Generate the edit plan for the corrected workbook copies (Phase 1 team fixes).

Reads the local cell cache (PHASE1_CACHE) to decide exactly which cells to
change, and writes scripts/phase1/fixes/fix-plan.json. apply_fixes.ps1 then
applies the plan in Microsoft Excel to COPIES written to
source-material/corrected/. The original workbooks are never modified.

Usage (repo root):  PHASE1_CACHE=<scratch> python scripts/phase1/fixes/gen_fixes.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cells import load, val, formula, split  # noqa: E402

HERE = os.path.dirname(__file__)
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
WB = "source-material/workbooks/"
OUT = "source-material/corrected/"

plan = []


class Book:
    def __init__(self, sid, src, out, cache_id=None):
        self.sid, self.cache = sid, cache_id or sid
        self.entry = {"id": sid, "source": src, "output": out, "ops": []}
        plan.append(self.entry)

    def op(self, finding, **kw):
        sheet, rng = kw.get("sheet"), kw.get("range")
        if sheet and rng and ":" not in rng and "before" not in kw:
            f, v, _ = load(self.cache).get(sheet, {}).get(rng, (None, None, None))
            kw["before"] = f if f else v
        kw["finding"] = finding
        self.entry["ops"].append(kw)


def days(cache):
    return sorted((s for s in load(cache) if s.isdigit() and 1 <= int(s) <= 31), key=int)


def runs(rows):
    """Group sorted row numbers into contiguous (start, end) runs."""
    out = []
    for r in rows:
        if out and r == out[-1][1] + 1:
            out[-1][1] = r
        else:
            out.append([r, r])
    return out


def d(y, m, day):
    return dt.date(y, m, day).isoformat()


# ---------------------------------------------------------------- Daily Sales
for sid, fname, month, ndays in (("SRC-02", "daily-sales-oct-2026.xlsx", 10, 31), ("SRC-03", "daily-sales-nov-2026.xlsx", 11, 30)):
    b = Book(sid, WB + fname, OUT + fname)
    s = "Sheet1"
    if month == 10:
        b.op("P1-07", sheet=s, range="A1", value="تقرير المبيعات فرع المعاريف أكتوبر 2026")
        for i in range(31):
            b.op("P1-07", sheet=s, range=f"A{3+i}", date=d(2026, 10, i + 1))
        # 31 October from the daily statement (sheet 31) and the ledger (sheet 31)
        for c, v in (("B", 101110), ("C", 1166), ("G", 75645), ("H", 74884), ("J", 25465)):
            b.op("P1-07", sheet=s, range=f"{c}33", value=v)
        b.op("P1-05", sheet=s, range="G9", value=36720)
        b.op("P1-06", sheet=s, range="G20", value=73436)
        b.op("P1-06", sheet=s, range="H20", value=73176)
    else:
        for i in range(12, 30):
            b.op("P1-07", sheet=s, range=f"A{3+i}", date=d(2026, 11, i + 1))
        b.op("P1-07", sheet=s, range="A33", clear=True)
    # P1-03: Abdo's decision (review answer saved 2026-11-20): average order value = net sales / orders for every
    # day (Foodics definition), two decimals. Replaces the typed values (October's were sales/orders/1.1).
    b.op("P1-03", sheet=s, range="D3:D33", formula='=IF(N(C3)=0,"",ROUND(B3/C3,2))', note="Abdo's decision 2026-11-20: average = net sales / orders (replaces typed values)")
    b.op("P1-11", sheet=s, range="I3:I34", formula='=IF(N(B3)=0,"",H3/B3)')
    b.op("P1-11", sheet=s, range="K3:K34", formula='=IF(N(B3)=0,"",J3/B3)')
    b.op("P1-11", sheet=s, range="A36:K37", clear=True, note="remove the broken '%' row (#REF!) and 'A / C' row")
    for c, f in (("D", '=IF(N(C35)=0,"",B35/C35)'), ("I", '=IF(N(B35)=0,"",H35/B35)'), ("K", '=IF(N(B35)=0,"",J35/B35)')):
        b.op("P1-11", sheet=s, range=f"{c}35", formula=f, note="total row: blank instead of #DIV/0! for a month with no entries")
    b.op("P1-04", sheet=s, range="G2", value="المصاريف (شاملة توريد البنك)")
    b.op("P1-04", sheet=s, range="H2", value="كاش (توريد البنك)")
    b.op("P1-04", sheet=s, range="I2", value="نسبة التوريد")

# --------------------------------------------------------- Sales comparison
for sid, fname, newname in (("SRC-08", "sales-comparison-oct-2026.xlsx", "سبتمبر-أكتوبر 2026"), ("SRC-09", "sales-comparison-nov-2026.xlsx", "أكتوبر-نوفمبر 2026")):
    b = Book(sid, WB + fname, OUT + fname)
    s = "مبيعات شهر 6"
    b.op("P1-08", sheet=s, range="D6:D36", formula='=IF(OR(NOT(ISNUMBER(J6)),N(F6)=0),"",J6/F6-1)', note="column is titled growth; blank when the current day is not entered or the prior figure is zero/missing; a recorded 0 gives -100%")
    b.op("P1-09", sheet=s, range="D37", formula='=IF(OR(COUNT(J6:J36)=0,SUMIFS(F6:F36,J6:J36,"<>")=0),"",SUMIFS(J6:J36,F6:F36,"<>")/SUMIFS(F6:F36,J6:J36,"<>")-1)', note="like-for-like days only")
    if sid == "SRC-08":
        b.op("P1-07", sheet=s, range="I36", value=1166)
        b.op("P1-07", sheet=s, range="J36", value=101110)
        b.op("P1-07", sheet=s, range="K36", value="السبت")
    b.op("P1-23", rename_sheet=s, to=newname)

# ------------------------------------------------------ Weekly comparison
b = Book("SRC-12", WB + "مقارنه يوميه المغرب (3) (1).xlsx", OUT + "weekly-comparison-nov-2026.xlsx")
s = "مبيعات شهر 8"
# P1-10: Abdo's decision (review answer saved 2026-11-20): the Bourgogne current figure (28,975 / 374 orders) is for
# Tuesday 10 Nov, and one date pair applies to every branch and the total: current 10 Nov, prior 3 Nov.
# Al Quds (P6/T6), Maarif (AA6/AE6) and Bourgogne prior (AP6) already carry these dates; no figure changes.
for cell, day in (("E6", 10), ("I6", 3), ("AL6", 10)):
    b.op("P1-10", sheet=s, range=cell, date=d(2026, 11, day), note="Abdo's decision 2026-11-20: one date pair 10/3 Nov for all branches and the total")
# P1-08: Abdo kept the weekly current/prior ratio ('نسبه %', 113%); the ratio cells and their header stay as recorded.
for cell in ("AZ3", "G7", "C18", "C19"):
    b.op("P1-23", sheet=s, range=cell, clear=True)
b.op("P1-23", rename_sheet=s, to="مقارنة أسبوعية")

# ------------------------------------------------------- Daily statements
LABELS = {"ovr": "اوفركاش", "cash": "الاجمالى النقدى", "visa": "فيزا", "exp": "مصروفات", "tot": "اجمالي المبلغ", "sys": "اجمالي الايراد"}


def stmt_rows(cache, sh):
    rows = {}
    for r in range(1, 31):
        g = val(cache, sh, f"G{r}")
        if not isinstance(g, str):
            continue
        g = g.strip()
        for k, lab in LABELS.items():
            if k not in rows and (g == lab if k in ("visa", "exp") else g.startswith(lab)):
                rows[k] = r
    totals = [r for r in range(1, 31) if isinstance(val(cache, sh, f"E{r}"), str) and "اجمالى المصروفات" in val(cache, sh, f"E{r}")]
    return rows, totals


def standardise(b, cache, sh, day_date=None):
    rows, totals = stmt_rows(cache, sh)
    if len(rows) < 6 or not totals:
        return
    want = {
        # over/short only when the system revenue is entered (P1-15: a blank system figure showed a false overage)
        f"I{rows['ovr']}": f'=IF(ISNUMBER(I{rows["sys"]}),I{rows["tot"]}-I{rows["sys"]},"")',
        f"I{rows['tot']}": f"=I{rows['cash']}+I{rows['visa']}+I{rows['exp']}",
        f"I{rows['exp']}": f"=D{totals[0]}",
    }
    for ref, f in want.items():
        cur = formula(cache, sh, ref)
        if (cur or "").replace("+", "").replace(" ", "") != f.replace("+", ""):
            b.op("P1-14", sheet=sh, range=ref, formula=f)
    for r in totals[1:]:
        b.op("P1-14", sheet=sh, range=f"D{r}:E{r}", clear=True, note="second 'total expenses' line double-counted D")
    if day_date:
        cur = val(cache, sh, "I3")
        if not (isinstance(cur, str) and cur.startswith(day_date)):
            b.op("P1-16", sheet=sh, range="I3", date=day_date)


b = Book("SRC-04", WB + "daily-statement-oct-2026.xlsx", OUT + "daily-statement-oct-2026.xlsx")
for sh in days("SRC-04"):
    standardise(b, "SRC-04", sh, d(2026, 10, int(sh)))
b.op("P1-15", sheet="7", range="I25", value=50060)
b.op("P1-16", sheet="10", range="P3:V32", clear=True, note="leftover July 2025 template with a cashier name")
# 29 October was missing: rebuild it from the ledger (sheet 29) and Daily Sales (row 31)
b.op("P1-16", copy_sheet="28", to="29")
b.op("P1-16", sheet="29", range="D6:E26", clear=True, before="(copy of 28)")
for i, (amt, txt) in enumerate(((130, "انتقالات فريق التصوير"), (100, "انتقالات"), (30, "شراء مياه"), (219, "شراء فواكه"), (35971, "توريد البنك"))):
    b.op("P1-16", sheet="29", range=f"D{6+i}", value=amt, before="")
    b.op("P1-16", sheet="29", range=f"E{6+i}", value=txt, before="")
b.op("P1-16", sheet="29", range="I3", date="2026-10-29", before="")
b.op("P1-16", sheet="29", range="I20", value=14405, before="")
b.op("P1-16", sheet="29", range="I25", value=50855, before="")
for ref, f in (("I17", '=IF(ISNUMBER(I25),I23-I25,"")'), ("I21", "=D28"), ("I23", "=I15+I20+I21")):
    b.op("P1-16", sheet="29", range=ref, formula=f, before="")
for sh in ["1648"] + [f"Feuil{i}" for i in range(1, 9)]:
    if sh in load("SRC-04"):
        b.op("P1-16", delete_sheet=sh)

b = Book("SRC-05", WB + "daily-statement-nov-2026.xlsx", OUT + "daily-statement-nov-2026.xlsx")
for sh in days("SRC-05"):
    n = int(sh)
    if n > 30:
        continue
    if n >= 3:
        # future days still holding values from earlier months: clear typed numbers/texts
        for r in range(6, 27):
            for c in "DE":
                f, v, _ = load("SRC-05")[sh].get(f"{c}{r}", (None, None, None))
                if v not in (None, "") and not f:
                    b.op("P1-16", sheet=sh, range=f"{c}{r}", clear=True)
        for ref in ("I20", "I25", "I21", "I23", "I17"):
            f, v, _ = load("SRC-05")[sh].get(ref, (None, None, None))
            if v not in (None, "", 0) and not f:
                b.op("P1-16", sheet=sh, range=ref, clear=True)
    standardise(b, "SRC-05", sh, d(2026, 11, n))
# 27 November had no sheet: add an empty one from the 26 November layout
b.op("P1-16", copy_sheet="26", to="27")
b.op("P1-16", sheet="27", range="D6:E26", clear=True, before="(copy of 26)")
b.op("P1-16", sheet="27", range="I20", clear=True, before="(copy of 26)")
b.op("P1-16", sheet="27", range="I25", clear=True, before="(copy of 26)")
b.op("P1-16", sheet="27", range="I3", date="2026-11-27", before="")
b.op("P1-16", sheet="10", range="P3:V32", clear=True, note="leftover July 2025 template block with a cashier name; same block cleared in October sheet 10; no formula or name refers to it")
b.op("P1-16", delete_sheet="Chart1", note="hidden empty chart that only plotted the stray sheet 564")
for sh in ["564", "31"] + [f"Feuil{i}" for i in range(1, 9)]:
    if sh in load("SRC-05"):
        b.op("P1-16", delete_sheet=sh, note="stray template / July 2025 sheet in a 30-day month" if sh == "31" else "")

# ----------------------------------------------------------- Daily ledgers
for sid, fname, month in (("SRC-10", "daily-ledger-oct-2026.xlsx", 10), ("SRC-11", "daily-ledger-nov-2026.xlsx", 11)):
    b = Book(sid, WB + fname, OUT + fname)
    b.op("P1-19", sheet="1", range="G4", date=d(2026, month, 1))
    b.op("P1-19", sheet="1", range="C4", value="المعاريف")
    for sh in days(sid):
        n = int(sh)
        # P1-12/P1-13: the cash-count message (O14) is NOT rewritten in the legacy copy. The prepared formula compared the
        # count with the balance after the bank remittance (E45); Abdo confirmed the count happens before the
        # remittance (P1-13), so that formula would repeat the error. The application computes the variance at the
        # time of the count instead; the legacy message stays as recorded (withdrawn 2026-11-21).
        if n == 1:
            continue
        p = f"'{n-1}'!"
        b.op("P1-17", sheet=sh, range="E87", formula=f"={p}{'E89' if n == 2 else 'E90'}")
        b.op("P1-17", sheet=sh, range="E86", formula="=SUM(E56:E85)")
        b.op("P1-19", sheet=sh, range="C6", formula=f"={p}C6+1")
        b.op("P1-19", sheet=sh, range="C53", formula=f"={p}C53+1")
        if n in (22, 23, 24):
            b.op("P1-18", sheet=sh, range="G4", formula=f"={p}G4+1")
            b.op("P1-18", sheet=sh, range="E42", formula=f"={p}E45")
        g90 = "=" + "&".join(f'IF(AND(F{r}<>0,E{r}<>0),ROW(F{r})&" ","")' for r in range(57, 86))
        b.op("P1-21", sheet=sh, range="G90", formula=g90)
    b.op("P1-21", sheet="16", range="A19:A24", clear=True, note="stray formulas in the account-code column (#VALUE!)")
    b.op("P1-18", sheet="ملخص", range="D26", formula="='22'!$E$41")
    b.op("P1-18", sheet="ملخص", range="E26", formula="='22'!$F$41")
    b.op("P1-18", sheet="ملخص", range="D27", formula="='23'!$E$41")
    b.op("P1-18", sheet="ملخص", range="E27", formula="='23'!$F$41")
    for n in range(1, 32):
        b.op("P1-20", sheet="ملخص", range=f"J{4+n}", formula=f"=SUM('{n}'!N25:N55)")
    b.op("P1-20", sheet="ملخص", range="J37", formula="=SUM(J5:J35)")
    b.op("P1-23", sheet="ملخص", range="A1", value="ملخص يومية فرع المعاريف")
    if formula(sid, "Sheet1", "H6") != "=+'1'!F20":  # hidden journal: VISA row (row 6 = day-1 row 20; neighbours read F19/F21)
        b.op("P1-21", sheet="Sheet1", range="H6", formula="=+'1'!F20")
    b.op("P1-21", break_links=True, note="external link to a 2017 file that no longer exists")

# ------------------------------------------------------------- Inventory
for sid, src, out, month, ndays in (
    ("SRC-06", WB + "inventory-oct-2026.xlsx", OUT + "inventory-oct-2026.xlsx", 10, 31),
    ("SRC-13", WB + "inventory-nov-2026-days-1-13.xlsx", OUT + "inventory-nov-2026-days-1-13.xlsx", 11, 30),
):
    cache = "LOC-01" if sid == "SRC-13" else sid
    b = Book(sid, src, out, cache_id=cache)
    for sh in days(cache):
        n = int(sh)
        p = f"'{n-1}'!"
        prows, drows, erows = [], [], []
        for r in range(8, 621):
            if n > 1 and re.fullmatch(rf"=\+?'{n-1}'!AC{r}", str(formula(cache, sh, f"P{r}"))):
                prows.append(r)
            if re.fullmatch(rf"=AC{r}-AB{r}", str(formula(cache, sh, f"AD{r}"))):
                drows.append(r)
            if re.fullmatch(rf"=\+?AD{r}(\+'{n-1}'!AE{r})?", str(formula(cache, sh, f"AE{r}"))):
                erows.append(r)
        for a, z in runs(prows):
            b.op("P1-24", sheet=sh, range=f"P{a}:P{z}", formula=f'=IF({p}AC{a}="",{p}AB{a},{p}AC{a})')
        for a, z in runs(drows):
            b.op("P1-24", sheet=sh, range=f"AD{a}:AD{z}", formula=f'=IF(AC{a}="","",AC{a}-AB{a})')
        for a, z in runs(erows):
            b.op("P1-24", sheet=sh, range=f"AE{a}:AE{z}", formula=(f"=N(AD{a})+{p}AE{a}" if n > 1 else f"=N(AD{a})"))
        b.op("P1-37", sheet=sh, range="AD8:AE620", numfmt="0.00;[Red]-0.00")
        if isinstance(val(cache, sh, "P3"), str) and "Last Updated" in val(cache, sh, "P3"):
            b.op("P1-23", sheet=sh, range="P3", clear=True)
        # mixed-nuts lines recorded in 'عدد' are NOT changed: quantity size alone does not prove the unit.
        b.op("P1-31", sheet=sh, range="F649:F3100", replace="KGM", to="كيلو")
    # Product Mix share columns: blank instead of #DIV/0! when a section has no quantity/amount
    for sh in days(cache) + ["Total"]:
        for col in ("H", "I"):
            groups = {}
            for r in range(8, 621):
                m = re.fullmatch(r"=\+?([FG])(\d+)/\$([FG])\$(\d+)", str(formula(cache, sh, f"{col}{r}")))
                if m and m.group(1) == m.group(3) and int(m.group(2)) == r:
                    groups.setdefault((m.group(1), int(m.group(4))), []).append(r)
            for (src, tot), rows in groups.items():
                for a, z in runs(rows):
                    b.op("P1-27", sheet=sh, range=f"{col}{a}:{col}{z}", formula=f'=IF(N(${src}${tot})=0,"",{src}{a}/${src}${tot})')
    # Total sheet: month deviation = cumulative deviation of the last day
    trows = [r for r in range(8, 621) if re.fullmatch(rf"=AC{r}-AB{r}", str(formula(cache, "Total", f"AD{r}")))]
    for a, z in runs(trows):
        b.op("P1-25", sheet="Total", range=f"AD{a}:AD{z}", formula=f"='31'!AE{a}")
    b.op("P1-37", sheet="Total", range="AD8:AE620", numfmt="0.00;[Red]-0.00")
    if isinstance(val(cache, "Total", "P3"), str):
        b.op("P1-23", sheet="Total", range="P3", clear=True)
    for sh in ("الوارد", "الأنحرافات"):
        for i in range(31):
            col = __import__("openpyxl").utils.get_column_letter(5 + i)
            if i < ndays:
                b.op("P1-23", sheet=sh, range=f"{col}5", date=d(2026, month, i + 1))
            else:
                b.op("P1-23", sheet=sh, range=f"{col}5", clear=True)
    b.op("P1-37", sheet="الأنحرافات", range="E6:AI621", numfmt="#,##0;[Red]-#,##0")
    if sid == "SRC-06":
        b.op("P1-26", sheet="7", range="F97", clear=True, note="'\\' typed instead of a quantity; left as not entered")
    else:
        b.op("P1-26", sheet="3", range="U564", formula="=P564+Q564+S564+T564-R564")
        # F327 (Kinder Dubai cake) is NOT changed: the row says «صغيرة», Foodics says «كبير» 2; the product
        # mapping is unconfirmed (P1-29 question to Abdo), so the workbook keeps 12 until he confirms it.
        for ref, v in (("F351", 16), ("F360", 52), ("F365", 49), ("F239", 70), ("F288", 137)):
            b.op("P1-29", sheet="7", range=ref, value=v, note="7 Nov Product Mix aligned with the Foodics print")
        b.op("P1-29", sheet="7", range="F210", clear=True, note="Foodics shows pecan, not lotus")
        for sh in days(cache) + ["Total"]:
            if val(cache, sh, "D202") in (None, ""):
                b.op("P1-28", sheet=sh, range="D202", value="جيلاتيتو روما بيكان", note="row already used by the pecan recipe")
        b.op("P1-29", sheet="7", range="F202", value=1)

# ------------------------------------------------- Inventory review template
b = Book("SRC-14", WB + "inventory-review-template-nov-2026.xlsx", OUT + "inventory-review-template-nov-2026.xlsx", cache_id="LOC-02")
b.op("P1-34", sheet="Sheet1", range="M7:M168", formula="=N7-O7")
b.op("P1-34", sheet="Sheet1", range="K7:K168", formula='=IF(ISNUMBER(L7),L7-M7,"")')
b.op("P1-34", sheet="Sheet1", range="M5", value="الرصيد المتوقع (الإجمالي − الاستهلاك)")
b.op("P1-34", sheet="Sheet1", range="K5", value="الفرق (المتاح − المتوقع)")

# ------------------------------------------------------------- Order sheet
b = Book("SRC-01", WB + "replenishment-order-nov-2026.xlsx", OUT + "replenishment-order-nov-2026.xlsx")
b.op("P1-36", sheet="Sheet1", range="C6", date="2026-11-04", numfmt="dd/mm/yyyy", note="text '04\\11/2026' stored as a real date (meaning order vs delivery is P1-35)")
# D38 (',') is NOT changed: the intended quantity is unknown.
b.op("P1-36", sheet="Sheet1", range="C25", value="كيلو")
b.op("P1-36", sheet="Sheet1", range="C63", value="كيلو")

json.dump(plan, open(os.path.join(HERE, "fix-plan.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
print({e["id"]: len(e["ops"]) for e in plan})
