"""Find Product Mix rows that received sales but are not referenced by any
recipe line (so their sales produce no stock consumption). Read-only."""
import json, re, sys
from collections import defaultdict
from cells import load, val, formula, split

out = {}
for sid, days in (("SRC-06", range(1, 32)), ("LOC-01", range(1, 14))):
    d2 = load(sid)["2"]
    linked = set()
    for r, (f, v, _) in d2.items():
        if r.startswith("H") and split(r)[1] >= 649 and f:
            for m in re.finditer(r"\$?F\$?(\d+)", str(f)):
                linked.add(int(m.group(1)))
    sold = defaultdict(float)
    for d in days:
        for r, (f, v, _) in load(sid)[str(d)].items():
            if r.startswith("F") and 8 <= split(r)[1] <= 600 and not f and isinstance(v, (int, float)) and v:
                sold[split(r)[1]] += v
    unlinked = sorted(((r, val(sid, "2", f"D{r}"), q) for r, q in sold.items() if r not in linked and isinstance(val(sid, "2", f"D{r}"), str)), key=lambda x: -x[2])
    out[sid] = {"rows_with_sales": len(sold), "unlinked_rows": len(unlinked), "unlinked_units": sum(x[2] for x in unlinked),
                "total_units": sum(sold.values()), "examples": unlinked[:25]}
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
