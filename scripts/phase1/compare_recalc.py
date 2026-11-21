"""Compare cached formula results in the original workbooks with the values
Excel produced after a full recalculation of scratch copies
(see recalc_with_excel.ps1). Writes docs/phase1/recalc-comparison.json.

Usage: python compare_recalc.py <scratch_dir> <output_json>
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys

import openpyxl

from cells import load

scratch, dest = sys.argv[1], sys.argv[2]
ids = [f"SRC-{i:02d}" for i in range(1, 13)] + ["LOC-01", "LOC-02", "LOC-03", "LOC-04"]


def same(a, b):
    if isinstance(a, (dt.datetime, dt.date, dt.time)):
        a = a.isoformat()
    if isinstance(b, (dt.datetime, dt.date, dt.time)):
        b = b.isoformat()
    if a in (None, "") and b in (None, ""):
        return True
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= 1e-6 * max(1, abs(a), abs(b))
    return a == b


result = {"method": "Excel CalculateFullRebuild on copies; external links not refreshed", "workbooks": {}}
for sid in ids:
    path = os.path.join(scratch, "recalc", f"{sid}-recalc.xlsx")
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    orig = load(sid)
    checked = 0
    diffs = []
    for ws in wb.worksheets:
        cells = orig.get(ws.title, {})
        formula_refs = {r for r, (f, v, _) in cells.items() if f}
        if not formula_refs:
            continue
        for row in ws.iter_rows():
            for c in row:
                ref = getattr(c, "coordinate", None)
                if ref in formula_refs:
                    checked += 1
                    old = cells[ref][1]
                    if not same(old, c.value):
                        diffs.append({"sheet": ws.title, "cell": ref, "cached": str(old)[:60], "recalculated": str(c.value)[:60], "formula": str(cells[ref][0])[:80]})
    total = sum(1 for s in orig.values() for f, v, _ in s.values() if f)
    result["workbooks"][sid] = {"formula_cells": total, "compared": checked, "differences": len(diffs), "examples": diffs[:15]}
    print(sid, total, checked, len(diffs), flush=True)
with open(dest, "w", encoding="utf-8") as fh:
    json.dump(result, fh, ensure_ascii=False, indent=1)
