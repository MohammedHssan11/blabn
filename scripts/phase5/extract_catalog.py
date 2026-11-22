"""Extract the legacy catalog, recipes and unit evidence for Phase 5.

Reads the two inventory workbooks (originals, never the corrected copies) and writes
fixtures/catalog/legacy-catalog.json. Nothing here approves anything: every extracted
recipe is a draft and every uncertain case becomes a review item that names the exact
source rows. Only the cases Abdo confirmed on 22 November 2026 are marked as decided.

Run:  python -I -X utf8 scripts/phase5/extract_catalog.py [--check]
"""
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fixtures" / "catalog" / "legacy-catalog.json"
SOURCES = {
    "oct": {"id": "SRC-06", "file": "source-material/workbooks/inventory-oct-2026.xlsx"},
    "nov": {"id": "SRC-07", "file": "source-material/workbooks/inventory-nov-2026.xlsx"},
}
SHEET = "2"
PM_FIRST, PM_LAST = 8, 600          # Product Mix rows (sold items), column D
INV_FIRST, INV_LAST = 8, 626        # inventory item rows, columns M (name) and N (unit)
REC_FIRST = 649                     # recipe lines, columns D..H
UNIT_CODE = {"كيلو": "kg", "KGM": "kg", "عدد": "pc", "لتر": "l"}
INV_SECTIONS = {"الخامات الأساسية": "ingredient", "اللف والحزم": "packaging", "الفوارغ": "packaging"}

# Abdo, 22 November 2026 (docs/ABDO_WORKFLOW_DECISIONS.md).
NUTS = "مكسرات مشكلة"
SPOON = "ملاعق بلاستيك للارز - مستورد"
BAZABIZO_LARGE = "بظابيظو مانجو كبير"


def norm(value):
    """Whitespace-normalised text. Original spelling is kept apart from this."""
    return None if value is None else re.sub(r"\s+", " ", str(value)).strip()


def label_key(value):
    """Mirror of public.catalog_label_key() in the Phase 5 migration."""
    text = norm(value) or ""
    text = re.sub("[ً-ٰٟـ]", "", text)
    text = text.translate(str.maketrans("أإآٱىة٠١٢٣٤٥٦٧٨٩", "اااايه0123456789"))
    return re.sub(r"\s+", " ", text).strip().lower()


def exact_quantity(value, where):
    """A recipe quantity as an exact fraction. Binary floating point is never used for the result."""
    if value is None:
        return None
    if isinstance(value, str):
        formula = value.lstrip("=").lstrip("+")
        if not re.fullmatch(r"[0-9.+\-*/() ]+", formula):
            raise ValueError(f"{where}: unsupported quantity formula {value!r}")
        fraction = eval_fraction(formula, where)
    else:
        # Cached floats carry binary noise (0.04000000000000001); the typed value has at most 12 decimals.
        fraction = Fraction(str(Decimal(repr(float(value))).quantize(Decimal("1e-12")).normalize()))
    if fraction <= 0:
        return {"num": 0, "den": 1, "text": "0"}
    return {"num": fraction.numerator, "den": fraction.denominator,
            "text": format(Decimal(fraction.numerator) / Decimal(fraction.denominator), ".9f").rstrip("0").rstrip(".")}


def eval_fraction(formula, where):
    tokens = re.findall(r"\d+\.\d+|\d+|[-+*/()]", formula)
    position = 0

    def peek():
        return tokens[position] if position < len(tokens) else None

    def take():
        nonlocal position
        position += 1
        return tokens[position - 1]

    def atom():
        token = take()
        if token == "(":
            inner = expr()
            take()
            return inner
        if token == "-":
            return -atom()
        if token == "+":
            return atom()
        return Fraction(token)

    def term():
        value = atom()
        while peek() in ("*", "/"):
            op = take()
            right = atom()
            value = value * right if op == "*" else value / right
        return value

    def expr():
        value = term()
        while peek() in ("+", "-"):
            op = take()
            right = term()
            value = value + right if op == "+" else value - right
        return value

    result = expr()
    if position != len(tokens):
        raise ValueError(f"{where}: cannot read formula {formula!r}")
    return result


def read_sheet(month):
    info = SOURCES[month]
    path = ROOT / info["file"]
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=False)
    cells = defaultdict(dict)
    for row in workbook[SHEET].iter_rows(min_row=1, max_row=3200):
        for cell in row:
            if cell.value is not None and cell.column_letter in "CDEFGHLMN":
                cells[cell.row][cell.column_letter] = cell.value
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return cells, digest


def read_product_mix(cells):
    """Named Product Mix rows with their section; blank rows are kept so links can be explained."""
    section = None
    rows = {}
    for r in range(PM_FIRST - 1, PM_LAST + 1):
        row = cells.get(r, {})
        header = str(row.get("C", ""))
        if header.startswith("قسم"):
            section = norm(header.split(":", 1)[1]) if ":" in header else norm(header)
            continue
        name = norm(row.get("D"))
        if r >= PM_FIRST:
            rows[r] = {"section": section, "name": name}
    return rows


def read_inventory(cells):
    section = None
    items = {}
    for r in range(7, INV_LAST + 1):
        row = cells.get(r, {})
        name = norm(row.get("M"))
        if name is None or name.startswith("="):
            continue
        if row.get("N") is None:
            if name in INV_SECTIONS:
                section = name
            continue
        if section is None:
            continue
        items[name] = {"row": r, "unit_label": row["N"], "section": section}
    return items


def resolve_link(cells, row_number, seen=None):
    """Follow the H-column formula to the Product Mix quantity cell it reads (column F)."""
    seen = seen or set()
    if row_number in seen:
        return None
    seen.add(row_number)
    formula = cells.get(row_number, {}).get("H")
    if not isinstance(formula, str):
        return None
    match = re.fullmatch(r"=\+?\$?([FH])\$?(\d+)", formula.strip())
    if not match:
        return None
    column, target = match.group(1), int(match.group(2))
    return target if column == "F" else resolve_link(cells, target, seen)


def read_recipe_lines(cells, month):
    lines = []
    for r in sorted(k for k in cells if k >= REC_FIRST):
        row = cells[r]
        if "D" not in row:
            continue
        where = f"{month} row {r}"
        unit_label = row.get("F")
        lines.append({
            "month": month,
            "row": r,
            "recipe_label": norm(row["D"]),
            "component": norm(row.get("E")),
            "unit_label": unit_label,
            "unit_code": UNIT_CODE.get(unit_label),
            "quantity": None if (exact_quantity(row.get("G"), where) or {"num": 1})["num"] == 0 else exact_quantity(row.get("G"), where),
            "written_zero": row.get("G") is not None and (exact_quantity(row.get("G"), where) or {"num": 1})["num"] == 0,
            "quantity_is_formula": isinstance(row.get("G"), str),
            "link_row": resolve_link(cells, r),
        })
    return lines


def main():
    check = "--check" in sys.argv
    sheets, digests = {}, {}
    for month in SOURCES:
        sheets[month], digests[month] = read_sheet(month)

    inventory = {m: read_inventory(sheets[m]) for m in SOURCES}
    if inventory["oct"] != inventory["nov"]:
        raise SystemExit("The October and November inventory lists differ; review before loading.")
    inventory_items = inventory["nov"]

    product_mix = {m: read_product_mix(sheets[m]) for m in SOURCES}
    lines = {m: read_recipe_lines(sheets[m], m) for m in SOURCES}

    # Two spellings that differ only by hamza, ta marbuta or spacing are one component (the same fold the
    # database uses for matching). The inventory list's spelling is the canonical name; every other spelling
    # is kept as an alias so nothing the workbooks wrote is lost.
    canonical = {label_key(name): name for name in inventory_items}
    aliases = defaultdict(set)
    for month in SOURCES:
        for line in lines[month]:
            line["component_source"] = line["component"]
            if line["component"]:
                name = canonical.setdefault(label_key(line["component"]), line["component"])
                if name != line["component"]:
                    aliases[name].add(line["component"])
                line["component"] = name

    # Sold items are the named Product Mix rows. A recipe that reads an unnamed row becomes a sold
    # item of its own recipe label and is queued, because Foodics has no name to match.
    sold = {}
    for month in SOURCES:
        for r, row in product_mix[month].items():
            if row["name"] and not re.match(r"^(الاجمالي|الأجمالى|الاقسام)$", row["name"]):
                key = (row["section"], row["name"])
                entry = sold.setdefault(key, {"section": row["section"], "name": row["name"], "rows": {}})
                entry["rows"][month] = r
    unnamed = {}
    for month in SOURCES:
        for line in lines[month]:
            r = line["link_row"]
            if r is None:
                continue
            if product_mix[month].get(r, {}).get("name") is None:
                unnamed.setdefault((month, r), set()).add(line["recipe_label"])

    def product_of(month, line):
        r = line["link_row"]
        if r is None:
            return ("unlinked", None, line["recipe_label"])
        row = product_mix[month].get(r)
        if row and row["name"] and not re.match(r"^(الاجمالي|الأجمالى|الاقسام)$", row["name"]):
            return ("named", row["section"], row["name"])
        return ("unnamed", r, None)  # identity is the empty Product Mix row, not a spelling of its recipe

    # Group lines by product and month.
    grouped = defaultdict(lambda: {"oct": [], "nov": []})
    labels_of = defaultdict(Counter)
    for month in SOURCES:
        for line in lines[month]:
            if not line["component"] and not line["quantity"] and not line["unit_label"]:
                continue  # a label row with nothing under it
            key = product_of(month, line)
            grouped[key][month].append(line)
            labels_of[key][line["recipe_label"]] += 1
    for key in sold:  # sold items nobody has written a recipe for still belong in the catalog
        grouped[("named",) + key]

    def signature(group):
        return sorted((x["component"] or "", x["unit_label"] or "", (x["quantity"] or {}).get("num", -1), (x["quantity"] or {}).get("den", 1)) for x in group)

    def label_sorted(key):
        return tuple(str(p) for p in key)

    products, versions = [], []
    for key in sorted(grouped, key=label_sorted):
        by_month = grouped[key]
        kind = key[0]
        if kind == "named":
            section, name = key[1], key[2]
            rows = dict(sold[(section, name)]["rows"])
            identity = f"named:{section}:{name}"
        elif kind == "unnamed":
            name = max(sorted(labels_of[key]), key=lambda label: labels_of[key][label])
            section, rows = None, {m: key[1] for m in SOURCES if by_month[m]}
            identity = f"unnamed:{key[1]}"
        else:
            name, section, rows = key[2], None, {}
            identity = f"unlinked:{name}"
        product = {"key": identity, "name": name, "section": section, "link": kind, "rows": rows,
                   "recipe_labels": sorted(labels_of[key]) if kind != "named" else [],
                   "is_add_on": bool(section and "الأضافات" in section)}
        products.append(product)
        if not by_month["oct"] and not by_month["nov"]:
            continue
        if signature(by_month["oct"]) == signature(by_month["nov"]):
            versions.append({"product": identity, "label": "Oct and Nov workbooks (identical)", "months": ["oct", "nov"],
                             "lines": by_month["nov"], "affected_by_nov_date": False})
            continue
        for month, label in (("oct", "October workbook"), ("nov", "November workbook")):
            if by_month[month]:
                versions.append({"product": identity, "label": label, "months": [month],
                                 "lines": by_month[month], "affected_by_nov_date": True})

    # Components: inventory items first, then any extra names the recipes use.
    components = {}
    for name, item in inventory_items.items():
        components[name] = {"name": name, "section": item["section"], "kind": INV_SECTIONS[item["section"]],
                            "inventory_unit_label": item["unit_label"], "inventory_row": item["row"], "stock_tracked": True, "aliases": sorted(aliases.get(name, []))}
    for month in SOURCES:
        for line in lines[month]:
            name = line["component"]
            if name and name not in components:
                components[name] = {"name": name, "section": None, "kind": "ingredient", "inventory_unit_label": None,
                                    "inventory_row": None, "stock_tracked": False, "aliases": sorted(aliases.get(name, []))}
    # An untracked component gets a base unit only when every recipe line agrees.
    unit_use = defaultdict(Counter)
    for month in SOURCES:
        for line in lines[month]:
            if line["component"]:
                unit_use[line["component"]][UNIT_CODE.get(line["unit_label"])] += 1
    for name, item in components.items():
        if item["stock_tracked"]:
            item["base_unit"] = UNIT_CODE[item["inventory_unit_label"]]
        else:
            used = {u for u in unit_use[name] if u}
            item["base_unit"] = used.pop() if len(used) == 1 else None

    # ------------------------------------------------------------------ decisions and review items
    for month in SOURCES:
        for line in lines[month]:
            line["unit_resolution"] = None
            if line["component"] == NUTS and line["unit_label"] == "عدد":
                # P1-31: Abdo confirmed mixed nuts are measured in kilograms. The number stays as entered and the
                # original label «عدد» is kept in unit_label.
                line["unit_code"], line["unit_resolution"] = "kg", "abdo_p1_31"
            if (month == "nov" and line["row"] == 1015 and line["recipe_label"] == BAZABIZO_LARGE
                    and line["component"] == SPOON and line["quantity"]["num"] == 6 and line["quantity"]["den"] == 1):
                line["unit_resolution"] = "abdo_p1_32_spoons"  # the six-spoon line, confirmed from the recipe sheet
    decisions = {
        "P1-31": {"component": NUTS, "from_label": "عدد", "to_unit": "kg",
                  "source": "Abdo, 22 Nov 2026 02:38:27 (docs/ABDO_WORKFLOW_DECISIONS.md)"},
        "P1-32": {"component": SPOON, "product": BAZABIZO_LARGE, "quantity": {"num": 6, "den": 1, "text": "6"}, "unit": "pc",
                  "source_ref": "SRC-07 sheet 2 D1015:G1015", "source": "Abdo, 22 Nov 2026 02:38:41"},
    }
    review_items = []

    # Unit evidence per component (Oct and Nov rows), and the exact conflicting rows.
    conflicts = {}
    for name, item in components.items():
        rows = [(m, ln) for m in SOURCES for ln in lines[m] if ln["component"] == name]
        base = item["base_unit"]
        bad = []
        for month, ln in rows:
            unit = ln["unit_code"]
            if ln["unit_resolution"] == "abdo_p1_31":
                continue  # resolved by Abdo (P1-31)
            if unit is None or (base is not None and unit != base) or base is None:
                bad.append({"source": SOURCES[month]["id"], "sheet": SHEET, "row": ln["row"],
                            "recipe": ln["recipe_label"], "unit_label": ln["unit_label"], "quantity": (ln["quantity"] or {}).get("text")})
        if bad:
            conflicts[name] = bad
    for name, bad in sorted(conflicts.items()):
        kinds = {"missing" if b["unit_label"] is None else "conflict" for b in bad}
        review_items.append({"kind": "missing_unit" if kinds == {"missing"} else "unit_conflict", "subject": name,
                             "component": name, "base_unit": components[name]["base_unit"], "refs": bad})

    for name, item in sorted(components.items()):
        if not item["stock_tracked"]:
            review_items.append({"kind": "untracked_component", "subject": name, "component": name,
                                 "refs": [{"source": SOURCES[m]["id"], "sheet": SHEET, "row": ln["row"], "recipe": ln["recipe_label"]}
                                          for m in SOURCES for ln in lines[m] if ln["component"] == name][:6]})

    missing_quantity = defaultdict(list)
    for m in SOURCES:
        for line in lines[m]:
            ref = {"source": SOURCES[m]["id"], "sheet": SHEET, "row": line["row"], "recipe": line["recipe_label"]}
            if line["written_zero"]:
                ref["written"] = "0"  # a zero is a placeholder, not a quantity a recipe can consume
            if line["component"] and line["quantity"] is None:
                missing_quantity[line["component"]].append(ref)
            if not line["component"] and (line["quantity"] or line["unit_label"]):
                review_items.append({"kind": "missing_component", "subject": line["recipe_label"], "refs": [ref]})
    for name, refs in sorted(missing_quantity.items()):
        review_items.append({"kind": "missing_quantity", "subject": name, "component": name, "refs": refs})

    for product in products:
        if product["link"] == "unnamed":
            r = next(iter(product["rows"].values()))
            review_items.append({"kind": "empty_sales_row", "subject": product["name"], "product": product["key"], "refs": [
                {"source": SOURCES[m]["id"], "sheet": SHEET, "row": r, "cell": f"F{r}", "recipe": label}
                for m in SOURCES if m in product["rows"] for label in product["recipe_labels"]]})
        elif product["link"] == "unlinked":
            refs = [{"source": SOURCES[m]["id"], "sheet": SHEET, "row": ln["row"], "recipe": ln["recipe_label"]}
                    for m in SOURCES for ln in lines[m] if ln["link_row"] is None and ln["recipe_label"] == product["name"]]
            review_items.append({"kind": "unlinked_recipe", "subject": product["name"], "product": product["key"], "refs": refs})

    # Add-ons whose recipes are labelled differently from the sold row, or read by several labels.
    for product in products:
        if not product["is_add_on"] or product["link"] != "named":
            continue
        labels = sorted({ln["recipe_label"] for m in SOURCES for key in [("named", product["section"], product["name"])]
                         for ln in grouped[key][m]})
        if len(labels) > 1 or (labels and label_key(labels[0]) != label_key(product["name"])):
            review_items.append({"kind": "ambiguous_addon", "subject": product["name"], "product": product["key"], "refs": [
                {"source": "SRC-07", "sheet": SHEET, "row": product["rows"]["nov"] or product["rows"]["oct"], "recipe": label}
                for label in labels]})

    # Foodics lines from the 7 November report (corrected transcription), in the form they were read.
    sample = json.loads((ROOT / "source-material/corrected/report-sample-2026-11-07.json").read_text(encoding="utf-8"))
    foodics = []
    for line in sample["product_mix"]["lines_compared_with_inventory_workbook"]:
        foodics.append({"label": line["foodics_name_as_read"], "quantity": line["quantity"], "amount": line["amount"],
                        "workbook_cell": line["workbook_cell"], "workbook_label": line["workbook_row"],
                        "phase1_mapping": line["mapping"], "note": line["note"]})

    resolved_refs = defaultdict(list)
    for month in SOURCES:
        for line in lines[month]:
            if line["unit_resolution"]:
                resolved_refs[line["unit_resolution"]].append({
                    "source": SOURCES[month]["id"], "sheet": SHEET, "row": line["row"], "recipe": line["recipe_label"],
                    "component": line["component"], "unit_label": line["unit_label"], "quantity": line["quantity"]["text"]})

    result = {
        "version": "phase5-legacy-2026-11-22.1",
        "resolved_refs": dict(resolved_refs),
        "sources": {m: {**SOURCES[m], "sheet": SHEET, "sha256": digests[m]} for m in SOURCES},
        "decisions": decisions,
        "inventory_components": sorted(components.values(), key=lambda c: (c["inventory_row"] or 10**6, c["name"])),
        "products": products,
        "versions": [{**v, "lines": [{k: x[k] for k in ("month", "row", "recipe_label", "component", "component_source", "unit_label", "unit_code", "unit_resolution", "quantity", "quantity_is_formula")} for x in v["lines"]]} for v in versions],
        "foodics_lines": foodics,
        "review_items": review_items,
        "stats": {
            "inventory_items": len(inventory_items), "components": len(components), "products": len(products),
            "versions": len(versions), "lines": sum(len(v["lines"]) for v in versions),
            "affected_versions": sum(1 for v in versions if v["affected_by_nov_date"]),
            "review_items": Counter(r["kind"] for r in review_items),
        },
    }
    result["stats"]["review_items"] = dict(sorted(result["stats"]["review_items"].items()))
    text = json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    if check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            raise SystemExit("fixtures/catalog/legacy-catalog.json is out of date; rerun the extractor.")
        print("legacy catalog fixture is current")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(json.dumps(result["stats"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
