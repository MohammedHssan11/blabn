"""Compare every corrected copy with its original, cell by cell, to find unintended changes.

Each changed cell is classified as:
  recalculated - same formula text in both files, only the calculated value changed (a dependent cell);
  targeted     - formula or constant changed inside a range named by an operation in fix-plan.json
                 (a replace operation counts only where the original text contained the searched text),
                 or on a sheet the plan created;
  unexplained  - any other change (constant or formula changed without an operation). Must be 0.
Also lists sheets added, removed or renamed. Writes docs/phase1/corrected-diff.json.
Usage (repo root): python scripts/phase1/fixes/diff_corrected.py
"""
from __future__ import annotations

import json
import os
import warnings
from collections import Counter, defaultdict

import openpyxl
from openpyxl.utils import range_boundaries
from openpyxl.worksheet.formula import ArrayFormula

warnings.filterwarnings("ignore")
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
plan = json.load(open(os.path.join(REPO, "scripts", "phase1", "fixes", "fix-plan.json"), encoding="utf-8"))


def cells(path, data_only):
    wb = openpyxl.load_workbook(path, data_only=data_only, read_only=True)
    out = {}
    for ws in wb.worksheets:
        d = {}
        if not hasattr(ws, "iter_rows"):
            continue
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, ArrayFormula):
                    v = "{" + str(v.text) + "}"
                if v is not None and v != "":
                    d[(c.row, c.column)] = v
        out[ws.title] = d
    names = [s.title for s in wb.worksheets]
    wb.close()
    return out, names


def same(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= 1e-9 * max(1, abs(a))
    return a == b


report = {}
for e in plan:
    src, out = os.path.join(REPO, e["source"]), os.path.join(REPO, e["output"])
    if not os.path.exists(out):
        report[e["id"]] = {"output": e["output"], "status": "no corrected copy"}
        continue
    fo, names_o = cells(src, False)
    vo, _ = cells(src, True)
    fc, names_c = cells(out, False)
    vc, _ = cells(out, True)
    rename = {o["rename_sheet"]: o["to"] for o in e["ops"] if o.get("rename_sheet")}
    created = {o["to"] for o in e["ops"] if o.get("copy_sheet")}
    deleted = {o["delete_sheet"] for o in e["ops"] if o.get("delete_sheet")}
    target = defaultdict(list)
    for o in e["ops"]:
        if o.get("sheet") and o.get("range"):
            target[rename.get(o["sheet"], o["sheet"])].append(range_boundaries(o["range"]) + (o.get("replace"),))
    link_sheets = set()
    if any(o.get("break_links") for o in e["ops"]):
        for sh, d in fo.items():
            if any(isinstance(v, str) and v.startswith("=") and "[" in v for v in d.values()):
                link_sheets.add(sh)

    def targeted(sh, r, c, before):
        # a replace operation only targets cells whose original text contained the searched text
        return sh in created or any(a <= c <= cc and b <= r <= dd and (rep is None or (isinstance(before, str) and rep in before))
                                    for a, b, cc, dd, rep in target.get(sh, []))

    cnt, samples, by_sheet = Counter(), defaultdict(list), Counter()
    sheets = {"removed": sorted(set(names_o) - set(rename) - set(names_c)), "renamed": rename, "added": sorted(set(names_c) - set(names_o) - set(rename.values()))}
    sheets["removed_without_op"] = [s for s in sheets["removed"] if s not in deleted]
    sheets["added_without_op"] = [s for s in sheets["added"] if s not in created]
    for sh_o in names_o:
        sh = rename.get(sh_o, sh_o)
        if sh not in fc or sh_o not in fo:
            continue
        a_f, b_f, a_v, b_v = fo[sh_o], fc[sh], vo.get(sh_o, {}), vc.get(sh, {})
        for k in set(a_f) | set(b_f) | set(a_v) | set(b_v):
            ff, fv = a_f.get(k), b_f.get(k)
            va, vb = a_v.get(k), b_v.get(k)
            if same(ff, fv) and same(va, vb):
                continue
            r, c = k
            ref = f"{sh}!{openpyxl.utils.get_column_letter(c)}{r}"
            if isinstance(ff, str) and ff.startswith("=") and same(ff, fv):
                kind = "recalculated"
            elif targeted(sh, r, c, ff):
                kind = "targeted"
            elif sh_o in link_sheets and isinstance(ff, str) and "[" in ff and same(va, vb):
                kind = "targeted"  # external link broken: formula replaced by its cached value
            else:
                kind = "unexplained"
            cnt[kind] += 1
            by_sheet[sh] += 1
            if len(samples[kind]) < 15:
                samples[kind].append([ref, str(ff)[:60] if ff != va else None, str(va)[:40], str(fv)[:60] if fv != vb else None, str(vb)[:40]])
    report[e["id"]] = {"output": e["output"], "changed_cells": dict(cnt), "changed_by_sheet": dict(by_sheet), "sheets": sheets, "samples": samples}
    print(e["id"], dict(cnt), "sheets removed without op:", sheets["removed_without_op"], "added without op:", sheets["added_without_op"])

json.dump(report, open(os.path.join(REPO, "docs", "phase1", "corrected-diff.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
bad = sum(v.get("changed_cells", {}).get("unexplained", 0) + len(v.get("sheets", {}).get("removed_without_op", [])) + len(v.get("sheets", {}).get("added_without_op", [])) for v in report.values())
print("unexplained changes:", bad)
