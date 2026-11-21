"""Check that each recipe line's sold-quantity link (column H) points at the
Product Mix row whose menu-item name matches the recipe's product (column D).
Read-only; prints a JSON summary."""
import json, re, sys
from cells import load, val, formula, split

def norm(s):
    s = re.sub(r"[ًٌٍَُِّْـ]", "", str(s))
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", s).strip()

out = {}
for sid in sys.argv[1:]:
    sh = "2"
    d = load(sid)[sh]
    groups = {}
    cur = None
    rows = sorted({split(r)[1] for r in d if split(r)[1] >= 649})
    for r in rows:
        name = val(sid, sh, f"D{r}")
        if isinstance(name, str) and name.strip():
            cur = name
        f = formula(sid, sh, f"H{r}")
        if not f or cur is None:
            continue
        m = re.fullmatch(r"=\+?\$?F\$?(\d+)", str(f).replace(" ", ""))
        if not m:
            continue
        tgt = int(m.group(1))
        groups.setdefault(cur, set()).add(tgt)
    mism = []
    for prod, tgts in groups.items():
        for t in tgts:
            pm = val(sid, sh, f"D{t}")
            if norm(pm) != norm(prod):
                mism.append({"recipe_product": prod, "linked_row": t, "product_mix_name_at_row": pm})
    out[sid] = {"recipe_products": len(groups), "links_to_different_name": len(mism), "examples": mism[:60]}
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
