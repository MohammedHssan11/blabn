"""Verify every workbook, tab, cell and figure cited by the current review questions.

Reads docs/phase1/review-questions.json and checks it against the original workbooks in
source-material/workbooks (unchanged originals), the corrected copies, and the transcription.
Writes docs/phase1/review-locations-check.json. Exit code 1 if any automated check fails.
Checks marked "manual" (reading the Foodics photos) are recorded but not machine-checked.
Usage (repo root): python scripts/phase1/review/verify_questions.py
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
import warnings
from decimal import Decimal

import openpyxl

warnings.filterwarnings("ignore")
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
Q = json.load(open(os.path.join(REPO, "docs", "phase1", "review-questions.json"), encoding="utf-8"))
FILES = {k: v["repo"] for k, v in Q["files"].items()}
FILES["inv_nov_corrected"] = "source-material/corrected/inventory-nov-2026-days-1-13.xlsx"
TR = {
    "transcription": "source-material/images/2026-11-07/report-sample-2026-11-07.json",
    "transcription_corrected": "source-material/corrected/report-sample-2026-11-07.json",
}
_wb, _wbf = {}, {}


def book(key, formulas=False):
    cache = _wbf if formulas else _wb
    if (key, formulas) not in cache:
        cache[(key, formulas)] = openpyxl.load_workbook(os.path.join(REPO, FILES[key]), data_only=not formulas)
    return cache[(key, formulas)]


def norm(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, str):
        return v.strip()
    return v


def eq(got, want):
    got, want = norm(got), norm(want)
    if isinstance(got, (int, float)) and isinstance(want, (int, float)) and not isinstance(got, bool):
        return abs(got - want) < 1e-9
    return got == want


def getpath(obj, path):
    for part in path.split("."):
        obj = obj[part]
    return obj


results = []


def rec(n, label, got, want, ok, kind="auto"):
    results.append({"question": n, "kind": kind, "check": label, "got": got, "want": want, "ok": ok})


def tr(name):
    return json.load(open(os.path.join(REPO, TR[name]), encoding="utf-8"))


for q in Q["questions"]:
    n = q["n"]
    # ---- where: workbook, tab and cell references exist
    for w in q["where"]:
        key = w.get("file")
        if not key:
            continue
        if key not in Q["files"] or w["file_ar"].split(" — ")[0].strip() != Q["files"][key]["name_ar"]:
            rec(n, f"where: file name matches the files table ({w['file_ar'][:40]})", w["file_ar"], Q["files"].get(key, {}).get("name_ar"), False)
            continue
        tab = re.search(r"«(.+?)»", w["tab_ar"])
        if not tab:
            rec(n, "where: tab named in «»", w["tab_ar"], "«tab»", False)
            continue
        names = book(key).sheetnames
        rec(n, f"tab «{tab.group(1)}» exists in {Q['files'][key]['name_ar']}", tab.group(1) in names, True, tab.group(1) in names)
        if tab.group(1) in names:
            ws = book(key)[tab.group(1)]
            for c in w["cells"]:
                for ref in re.findall(r"[A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?", c["ref"]):
                    first = ref.split(":")[0]
                    rec(n, f"where: cell {tab.group(1)}!{first} is not empty", norm(ws[first].value) is not None, True, ws[first].value is not None)
    # ---- checks
    for c in q["checks"]:
        if "file" in c and "sheet" in c:
            key = c["file"]
            ws = book(key, "formula" in c)[c["sheet"]]
            got = ws[c["cell"]].value
            label = f"{key} {c['sheet']}!{c['cell']}"
            if "formula" in c:
                rec(n, label + " formula", got, c["formula"], got == c["formula"])
            elif "contains" in c:
                rec(n, label + " contains", str(got)[:60], c["contains"], c["contains"] in str(got))
            elif "approx" in c:
                rec(n, label, got, c["approx"], isinstance(got, (int, float)) and abs(got - c["approx"]) <= c["tol"])
            else:
                rec(n, label, norm(got), c["equals"], eq(got, c["equals"]))
        elif "json" in c:
            d = tr(c["json"])
            if "section" in c:
                node = next(s for s in d["product_mix"]["sections"] if s["section_id"] == c["section"])
                got = getpath(node, c["path"])
            elif "line_cell" in c:
                node = next(x for x in d["product_mix"]["lines_compared_with_inventory_workbook"] if x["workbook_cell"].endswith("!" + c["line_cell"]))
                got = getpath(node, c["path"])
            else:
                got = getpath(d, c["path"])
            rec(n, f"{c['json']} {c.get('section') or c.get('line_cell') or ''} {c['path']}".replace("  ", " "), got, c["equals"], eq(got, c["equals"]))
        elif "computed" in c:
            k = c["computed"]
            if k == "photo_manual":
                rec(n, "photo read by the team (manual)", c["note"], "read", True, kind="manual")
            elif k == "sections_sum":
                secs = tr("transcription")["product_mix"]["sections"]
                got = {"quantity": sum(s["quantity"] for s in secs), "amount": str(sum(Decimal(s["amount"]) for s in secs))}
                rec(n, "Product Mix sections sum", got, c["equals"], got == c["equals"])
            elif k == "oct_average_pattern":
                ws = book("sales_oct")["Sheet1"]
                cnt = {"div_1_1_exact": 0, "div_1_1_rounded_to_whole": 0, "plain": 0, "neither": 0}
                for r in range(3, 33):
                    B, C, D = (ws[f"{x}{r}"].value for x in "BCD")
                    if abs(round(B / C, 2) - D) <= 0.005:
                        cnt["plain"] += 1
                    elif abs(round(B / C / 1.1, 2) - D) <= 0.005:
                        cnt["div_1_1_exact"] += 1
                    elif float(D).is_integer() and round(B / C / 1.1) == D:
                        cnt["div_1_1_rounded_to_whole"] += 1
                    else:
                        cnt["neither"] += 1
                rec(n, "October average: how each of the 30 typed values was produced", cnt, c["equals"], cnt == c["equals"])
            elif k == "round2":
                got = round(c["num"] / c["den"], 2)
                rec(n, f"{c['num']} / {c['den']}", got, c["equals"], abs(got - c["equals"]) < 1e-9)
            elif k == "round2_div":
                got = round(c["num"] / c["den"] / c["by"], 2)
                rec(n, f"{c['num']} / {c['den']} / {c['by']}", got, c["equals"], abs(got - c["equals"]) < 1e-9)
            elif k == "growth_pct":
                got = round((c["cur"] / c["prev"] - 1) * 100, 2)
                rec(n, f"growth {c['cur']} vs {c['prev']}", got, c["equals"], abs(got - c["equals"]) < 1e-9)
            elif k == "diff":
                got = c["cur"] - c["prev"]
                rec(n, f"{c['cur']} - {c['prev']}", got, c["equals"], got == c["equals"])
            elif k == "sum":
                got = sum(c["values"])
                rec(n, "sum " + "+".join(map(str, c["values"])), got, c["equals"], got == c["equals"])
            elif k == "weekday":
                got = dt.date.fromisoformat(c["date"]).strftime("%A")
                rec(n, f"weekday of {c['date']}", got, c["equals"], got == c["equals"])
            elif k == "expected_cash":
                got = c["sales"] - c["visa"] - c["expenses"]
                rec(n, "expected cash before remittance", got, c["equals"], got == c["equals"])
            elif k == "inv7_items_sum":
                ws = book(c["file"])["7"]
                tot = 0
                for r in range(8, 601):
                    d, f = ws[f"D{r}"].value, ws[f"F{r}"].value
                    if isinstance(f, (int, float)) and not isinstance(f, bool) and isinstance(d, str) and not re.search("اجمال|الأجمال|قسم", d):
                        tot += f
                rec(n, f"{c['file']} tab 7 item quantities (without totals)", tot, c["equals"], tot == c["equals"])
            elif k == "inv_received_min_per_day":
                wb = book(c["file"])
                counts = {}
                for d in range(c["days"][0], c["days"][1] + 1):
                    ws = wb[str(d)]
                    counts[d] = sum(1 for r in range(8, 621) if isinstance(ws.cell(r, 13).value, str) and isinstance(ws.cell(r, 17).value, (int, float)) and ws.cell(r, 17).value > 0)
                m = min(counts.values())
                rec(n, "items received per day (min over days)", counts, f">= {c['at_least']}", m >= c["at_least"])
            else:
                rec(n, "unknown computed check " + k, None, None, False)

# the repository copy of the newer November inventory is byte-identical to the local original (when present)
local = os.path.abspath(os.path.join(REPO, "..", "abdo temp", Q["files"]["inv_nov"]["name_ar"]))
if os.path.exists(local):
    h = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
    same = h(local) == h(os.path.join(REPO, FILES["inv_nov"]))
    rec(0, "repository copy of the November inventory is byte-identical to the local original", same, True, same)
else:
    rec(0, "local original of the November inventory not present; byte comparison skipped", False, "skipped", True, kind="skipped")

ok = [r for r in results if r["ok"]]
summary = {"checks": len(results), "passed": len(ok), "manual": sum(r["kind"] == "manual" for r in results),
           "skipped": sum(r["kind"] == "skipped" for r in results), "per_question": {}}
for q in Q["questions"]:
    rs = [r for r in results if r["question"] == q["n"]]
    summary["per_question"][q["n"]] = {"finding": q["finding"], "checks": len(rs), "passed": sum(r["ok"] for r in rs)}
out = {"generated": dt.datetime.now().isoformat(timespec="seconds"), "questions_version": Q["questions_version"], "summary": summary, "results": results}
json.dump(out, open(os.path.join(REPO, "docs", "phase1", "review-locations-check.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
print(json.dumps(summary, ensure_ascii=False))
for r in results:
    if not r["ok"]:
        print("FAIL", json.dumps(r, ensure_ascii=False, default=str))
sys.exit(0 if len(ok) == len(results) else 1)
