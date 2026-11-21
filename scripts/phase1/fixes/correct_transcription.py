"""Write the corrected copy of the 7 November Foodics transcription (IMG-04).

The original source-material/images/2026-11-07/report-sample-2026-11-07.json is not changed.
The copy adds what the team read from the photos (IMG-02/03), with the photo as the evidence:
  - the M04 section label printed on the photo (P1-02);
  - the Product Mix lines that were compared with the November inventory workbook (P1-29),
    each with its workbook row and whether that row's identity is confirmed.
P1-02 is closed through source verification and the project owner's visual confirmation.
The separate owner_approved field retains its original provenance.
Usage (repo root): python scripts/phase1/fixes/correct_transcription.py
"""
import json
import os

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
src = os.path.join(REPO, "source-material", "images", "2026-11-07", "report-sample-2026-11-07.json")
out = os.path.join(REPO, "source-material", "corrected", "report-sample-2026-11-07.json")
d = json.load(open(src, encoding="utf-8"))

m04 = next(s for s in d["product_mix"]["sections"] if s["section_id"] == "M04")
m04["readable_label_ar"] = "دنيا البمبوظه"
m04.pop("label_requires_review", None)
m04["label_confirmation"] = {
    "by": "project owner (current conversation)",
    "date": "2026-11-20",
    "method": "Read the source photo and confirmed the exact spelling: دنيا البمبوظه.",
}

# Lines read from the Product Mix photos (name as read; spelling may differ slightly from the print). Every line's
# quantity x unit price equals its printed amount. 'workbook' = SRC-13 sheet 7 cell compared.
LINES = [
    ("الغوريلا", 70, "4200.00", "F239", "الغوريلا", 80, "confirmed", "same name"),
    ("المتكندرة صغير", 137, "7535.00", "F288", "المتكندرة صغير", 147, "confirmed", "same name"),
    ("قشطوطة كراميل", 16, "560.00", "F351", "قشطوطة كراميل", 36, "confirmed", "same name"),
    ("سوبر الملوك", 52, "2600.00", "F360", "سوبر الملوك", 59, "confirmed", "same name"),
    ("قشطوطة أرز ب بلبن مانجا", 49, "1960.00", "F365", "قشطوطة رز ب لبن + مانجا زبده قطع", 59, "confirmed",
     "only mango rice-pudding qashtouta line on either side; no conflicting attribute"),
    ("جيلاتوتي روما- بيكان", 1, "35.00", "F202", "جيلاتيتو روما بيكان (row unnamed; the pecan recipe reads F202)", None, "confirmed",
     "Foodics shows no lotus gelato, so the workbook's lotus 1 (F210) was cleared"),
    ("كيكة الهبة دبي صوص كيندر كبير", 2, "100.00", "F327", "كيكة هبة دبى صوص كيندر صغيرة", 12, "unconfirmed",
     "size differs (Foodics large, workbook small; the workbook has no large row). Workbook value kept at 12 until Abdo confirms the mapping (P1-29)."),
    ("كيكة الهبة دبي شيكولاتة كبير", 109, "5450.00", "F325", "كيكة هبة دبى شيكولاتة صغيرة", 109, "unconfirmed",
     "quantities already equal; same size difference, mapping confirmed in Phase 5 (P1-28)"),
]
d["product_mix"]["lines_compared_with_inventory_workbook"] = [
    {"foodics_name_as_read": n, "quantity": q, "amount": a, "workbook_cell": f"SRC-13 '7'!{c}", "workbook_row": w,
     "workbook_quantity_original": wq, "mapping": m, "note": note}
    for n, q, a, c, w, wq, m, note in LINES]
d["team_verified"] = {
    "by": "development team (Phase 1 findings P1-02, P1-29)",
    "date": "2026-11-20",
    "method": "Every Product Mix line read from the photos; line sums equal each printed section total and qty x unit price equals each printed line amount; cash + visa = net sales; net / orders = 84.90.",
    "note": "P1-02 resolved by source verification. The project owner confirmed the M04 label as 'دنيا البمبوظه' on 2026-11-20. owner_approved retains its original value and is not a prerequisite for source verification.",
}
d["owner_approved"] = False
json.dump(d, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("wrote", out)
