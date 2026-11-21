"""Phase 1 inventory checks on the cached cells of SRC-06, SRC-07 and LOC-01.

Prints evidence used by findings F-INV-*. Read-only; run with PHASE1_CACHE set.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict

from cells import load, val, formula, split

INV = ["SRC-06", "SRC-07", "LOC-01"]
DATA_COLS = ["F", "Q", "R", "S", "T", "X", "Y", "Z", "AA", "AC"]
out = {}


def days(sid):
    return [s for s in load(sid) if s.isdigit()]


def inv_rows(sid, sh):
    d = load(sid)[sh]
    return sorted({split(r)[1] for r in d if r.startswith("M") and 8 <= split(r)[1] <= 620 and isinstance(d[r][1], str)})


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


for sid in INV:
    res = {"days_with_mix": [], "days_with_counts": [], "days_with_receipts": []}
    for sh in sorted(days(sid), key=int):
        d = load(sid)[sh]
        mix = sum(1 for r, (f, v, _) in d.items() if r.startswith("F") and 8 <= split(r)[1] <= 600 and not f and num(v))
        cnt = sum(1 for r, (f, v, _) in d.items() if r.startswith("AC") and 8 <= split(r)[1] <= 620 and not f and v is not None)
        rec = sum(1 for r, (f, v, _) in d.items() if r.startswith("Q") and 8 <= split(r)[1] <= 620 and not f and num(v))
        if mix: res["days_with_mix"].append((int(sh), mix))
        if cnt: res["days_with_counts"].append((int(sh), cnt))
        if rec: res["days_with_receipts"].append((int(sh), rec))
    # blank-count deviations and zero openings
    blank_dev = []
    zero_open = []
    for sh in sorted(days(sid), key=int):
        d = load(sid)[sh]
        for r in inv_rows(sid, sh):
            ac = d.get(f"AC{r}", (None, None, None))
            ab = num(val(sid, sh, f"AB{r}"))
            ad = val(sid, sh, f"AD{r}")
            if ac[1] is None and ab not in (None, 0) and num(ad) is not None:
                blank_dev.append((int(sh), r, val(sid, sh, f"M{r}"), ab, ad))
        n = int(sh)
        if n > 1 and str(n - 1) in load(sid):
            prev = load(sid)[str(n - 1)]
            for r in inv_rows(sid, sh):
                if prev.get(f"AC{r}", (None, None))[1] is None and num(val(sid, str(n - 1), f"AB{r}")) not in (None, 0) and formula(sid, sh, f"P{r}"):
                    zero_open.append((n, r, val(sid, sh, f"M{r}"), val(sid, str(n - 1), f"AB{r}"), val(sid, sh, f"P{r}")))
    res["blank_count_deviation_cells"] = len(blank_dev)
    res["blank_count_deviation_by_day"] = Counter(x[0] for x in blank_dev).most_common()
    res["blank_count_examples"] = blank_dev[:6]
    res["zero_opening_after_blank_count"] = len(zero_open)
    res["zero_opening_examples"] = zero_open[:6]
    # text in numeric entry columns
    texts = []
    for sh in days(sid) + ["Total"]:
        d = load(sid)[sh]
        for r, (f, v, _) in d.items():
            col = re.match(r"[A-Z]+", r).group(0)
            row = split(r)[1]
            if col in DATA_COLS + ["U", "V"] and 8 <= row <= 620 and isinstance(v, str) and not f and v.strip() not in ("",):
                if col == "F" and row in (5,):
                    continue
                if col in ("F",) and isinstance(val(sid, sh, f"D{row}"), str) is False and isinstance(val(sid, sh, f"C{row}"), str):
                    continue
                texts.append((sh, r, v))
    res["text_in_number_cells"] = [t for t in texts if not re.match(r"^(Qty|Total|Code)$", str(t[2]))][:30]
    # errors not DIV/0
    errs = []
    for sh in days(sid) + ["Total", "الأنحرافات", "الوارد"]:
        for r, (f, v, _) in load(sid)[sh].items():
            if isinstance(v, str) and v.startswith("#") and v != "#DIV/0!":
                errs.append((sh, r, v, str(f)[:60]))
    res["non_div0_errors"] = errs[:40]
    res["non_div0_error_count"] = len(errs)
    # DIV/0 split: product-mix price share column I vs other
    div = Counter()
    for sh in days(sid) + ["Total"]:
        for r, (f, v, _) in load(sid)[sh].items():
            if v == "#DIV/0!":
                div[re.match(r"[A-Z]+", r).group(0)] += 1
    res["div0_by_column"] = div.most_common(8)
    out[sid] = res

# Recipe components that SUMIF cannot match to the component list (column L)
recipe = {}
for sid in INV:
    d = load(sid)["2"]
    comps = {v for r, (f, v, _) in d.items() if r.startswith("L") and 600 <= split(r)[1] < 649 + 0 and isinstance(v, str)}
    comps |= {v for r, (f, v, _) in d.items() if r.startswith("L") and 600 <= split(r)[1] <= 900 and isinstance(v, str)}
    lines = []
    for r, (f, v, _) in d.items():
        if r.startswith("E") and split(r)[1] >= 649 and isinstance(v, str):
            row = split(r)[1]
            lines.append((row, val(sid, "2", f"D{row}"), v, val(sid, "2", f"F{row}"), val(sid, "2", f"G{row}")))
    norm = lambda s: re.sub(r"\s+", " ", s).strip()
    lnames = {norm(c) for c in comps}
    exact_unmatched = sorted({l[2] for l in lines if l[2] not in comps and l[2].lower() not in {c.lower() for c in comps}})
    ws_only = [n for n in exact_unmatched if norm(n) in lnames]
    truly = [n for n in exact_unmatched if norm(n) not in lnames]
    units = defaultdict(Counter)
    for l in lines:
        units[norm(l[2])][str(l[3])] += 1
    mixed_units = {k: dict(v) for k, v in units.items() if len(v) > 1}
    unit_vocab = Counter(str(l[3]) for l in lines)
    recipe[sid] = {
        "recipe_lines": len(lines), "component_list": len(comps),
        "unmatched_component_names": len(exact_unmatched), "unmatched_due_to_spacing": ws_only[:20],
        "unmatched_not_in_list": truly[:40], "unmatched_not_in_list_count": len(truly),
        "components_with_mixed_units": len(mixed_units), "mixed_unit_examples": dict(list(mixed_units.items())[:12]),
        "unit_vocabulary": unit_vocab.most_common(),
    }
out["recipes"] = recipe

# Oct vs Nov structural diff (item list, units, recipe lines)
def item_map(sid):
    d = load(sid)["2"]
    return {r: (val(sid, "2", f"M{r}"), val(sid, "2", f"N{r}")) for r in inv_rows(sid, "2")}


def recipe_set(sid):
    d = load(sid)["2"]
    s = set()
    for r, (f, v, _) in d.items():
        if r.startswith("E") and split(r)[1] >= 649 and isinstance(v, str):
            row = split(r)[1]
            g = formula(sid, "2", f"G{row}") or val(sid, "2", f"G{row}")
            s.add((val(sid, "2", f"D{row}"), v, str(val(sid, "2", f"F{row}")), str(g)))
    return s


a, b = item_map("SRC-06"), item_map("SRC-07")
names_a = {v[0] for v in a.values()}
names_b = {v[0] for v in b.values()}
moved = sum(1 for r in set(a) & set(b) if a[r][0] != b[r][0])
unit_changed = [(r, a[r], b[r]) for r in set(a) & set(b) if a[r][0] == b[r][0] and a[r][1] != b[r][1]]
ra, rb = recipe_set("SRC-06"), recipe_set("SRC-07")
rc = recipe_set("LOC-01")
out["oct_vs_nov"] = {
    "items_oct": len(a), "items_nov": len(b),
    "only_in_oct": sorted(names_a - names_b)[:30], "only_in_nov": sorted(names_b - names_a)[:30],
    "rows_with_different_item": moved, "unit_changes": unit_changed[:20],
    "recipe_lines_oct": len(ra), "recipe_lines_nov": len(rb),
    "recipe_only_oct": sorted(map(str, ra - rb))[:25], "recipe_only_nov": sorted(map(str, rb - ra))[:25],
    "recipe_only_oct_count": len(ra - rb), "recipe_only_nov_count": len(rb - ra),
    "recipe_nov_vs_loc01_diff": len(rb ^ rc),
}

# SRC-07 vs LOC-01: day 1-2 input differences
diffs = []
for sh in ["1", "2"]:
    A, B = load("SRC-07")[sh], load("LOC-01")[sh]
    for r in set(A) | set(B):
        fa, va, _ = A.get(r, (None, None, None))
        fb, vb, _ = B.get(r, (None, None, None))
        if fa is None and fb is None and va != vb:
            diffs.append((sh, r, va, vb))
out["src07_vs_loc01_input_diffs_days_1_2"] = {"count": len(diffs), "examples": diffs[:25]}
json.dump(out, sys.stdout, ensure_ascii=False, indent=1, default=str)
