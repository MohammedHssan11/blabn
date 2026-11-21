"""Record the checked completion status of every Phase 1 finding in docs/phase1/findings.json.

Rechecked on 20 Nov 2026 against the corrected copies, the originals and the photos
(see docs/phase1/CORRECTIONS.md, corrected-verification.json, corrected-diff.json,
boundary-tests.json). Status values:
  verified   - corrected in the copies and checked against independent evidence; nothing left in the workbooks
  partial    - part corrected and checked; the rest is pending (named in remaining_*)
  assumption - applied on a premise that is not proven (none at present: unproven changes were reverted)
  rule       - handled as a rule the application must implement; workbook copies at most relabelled
  deferred   - belongs to a later phase that already owns it
  decision   - needs Abdo's decision before the team can act
abdo: "required" = a question only Abdo can answer, needed to close Phase 1;
      "later"    = a question for Abdo (or the catalog owner) needed before the named later phase.
Every finding can be answered on the review page (accept / different correction / keep as is).
Usage (repo root): python scripts/phase1/fixes/set_status.py
"""
import json
import os
from collections import Counter

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
p = os.path.join(REPO, "docs", "phase1", "findings.json")
d = json.load(open(p, encoding="utf-8"))
PW = "ledger day sheets are password-protected; their changes are prepared in fix-plan.json and not applied"
PW_AR = "أوراق الأيام في ملف اليومية محمية بكلمة سر، فتصحيحها جاهز لكنه ما اتطبقش."

# id: (status, abdo, resolution_ar, resolution_en, remaining_ar, remaining_en)
S = {
    "P1-01": ("verified", None,
              "أضفنا نسخة جرد نوفمبر الأحدث (1-13 نوفمبر) وقالب مراجعة الجرد لملفات المشروع الخاصة كنسخ مطابقة تمامًا للأصل.",
              "LOC-01/LOC-02 copied to source-material/workbooks/ as SRC-13 and SRC-14 (byte-identical, SHA-256 checked).",
              "", "None. The video stays local (not a workbook)."),
    "P1-02": ("verified", None,
              "راجعنا الأرقام والإجماليات على الصور، وصاحب المشروع قرأ الصورة وأكد يوم 20 نوفمبر 2026 إن اسم القسم الرابع «دنيا البمبوظه». اكتملت مراجعة التفريغ، واتشال سؤال الموافقة العام من صفحة عبدو.",
              "Source transcription verified against the photos and aggregate arithmetic. The project owner visually confirmed the exact M04 spelling 'دنيا البمبوظه' on 2026-11-20. The corrected copy records that confirmation. Resolved as source verification; no Abdo approval was recorded.",
              "", "None."),
    "P1-03": ("verified", "required",
              "حسب ردك: متوسط الطلب = المبيعات ÷ عدد الطلبات (بمنزلتين عشريتين) في كل الأيام، زي Foodics. طبقناها في نسخ Daily Sales المصححة؛ مثلًا 1 أكتوبر بقى 79.31 بدل 72.10.",
              "Abdo's decision (review answer 2026-11-20): average order value = net sales / orders, two decimals, every day; period average = total sales / total orders. Applied to the SRC-02/03 copies: D3:D33 = IF(N(C)=0,\"\",ROUND(B/C,2)), replacing the typed values (October's were sales/orders/1.1; the reason for 1.1 was not given and is not used).",
              "", "None in the workbooks. Implement the same rule in Phases 4 and 9."),
    "P1-04": ("rule", None,
              "البرنامج هيسجل التوريد للبنك كحركة منفصلة عن المصروفات. في نسخ Daily Sales وضحنا أسماء الأعمدة فقط: «المصاريف (شاملة توريد البنك)» و«كاش (توريد البنك)» و«نسبة التوريد».",
              "App rule: remittance is its own movement. Copies: headers G2/H2/I2 of SRC-02/03 relabelled to what the columns hold (checked on 28 of 30 October days and on 1 Nov against the statement). Data layout unchanged.",
              "", "Implement in Phases 4 and 9."),
    "P1-05": ("verified", None, "صححنا مصروفات 7 أكتوبر في Daily Sales إلى 36,720.",
              "SRC-02 G9: 36,214 -> 36,720. Independent: statement sheet 7 D28 = 36,720 and ledger sheet 7 F86 = 36,720; 50,060 - 13,340 - 36,214 = 506 = the other expenses.", "", "None."),
    "P1-06": ("verified", None, "رجعنا رقمي 18 أكتوبر (المصاريف والكاش) لمكانهم الصحيح.",
              "SRC-02 G20/H20 swapped back to 73,436 / 73,176. Independent: statement sheet 18 (bank 73,176; total 73,436) and ledger sheet 18 F86 = 73,436.", "", "None."),
    "P1-07": ("verified", None, "صححنا عنوان وتواريخ Daily Sales أكتوبر، وأضفنا يوم 31 أكتوبر (101,110) فبقى إجمالي الشهر 2,055,675، وأضفنا 31 أكتوبر في مقارنة أكتوبر.",
              "SRC-02 A1 title, A3:A33 dates; row 33 = 31 Oct (101,110 / 1,166 / 75,645 / 74,884 / 25,465) from statement sheet 31 and ledger sheet 31; SRC-08 I36:K36; SRC-03 A15:A32 dates. Independent: 1,954,565 + 101,110 = 2,055,675; days 1-30 equal in three files.", "", "None."),
    "P1-08": ("verified", "required",
              "في مقارنتي أكتوبر ونوفمبر صححنا «نسبة النمو» = (الحالي ÷ السابق) − 1 لأن ده اسم العمود. في المقارنة الأسبوعية، حسب ردك، فضلت «نسبة الحالي للسابق» (113%) زي ما هي.",
              "Monthly comparisons (column titled growth) corrected in the SRC-08/09 copies: D6:D36 = IF(OR(NOT(ISNUMBER(J)),N(F)=0),\"\",J/F-1), D37 like-for-like; October was inverted. Weekly report: Abdo kept the current/prior ratio (decision 2026-11-20); the SRC-12 ratio cells and their header are unchanged.",
              "", "Phase 7: label the weekly figure as a current/prior ratio («نسبة الحالي للسابق»), not growth."),
    "P1-09": ("verified", None, "في مقارنة نوفمبر: الأيام اللي لسه ما اتدخلتش بقت فاضية بدل 0%، والإجمالي بيقارن نفس الأيام بس.",
              "SRC-08/09 D (blank when the current day is not entered) and D37 = SUMIFS like-for-like. Independent: 1 Nov 86,470 / 50,125 - 1 = +72.51%; boundary tests for blank and zero.", "", "None."),
    "P1-10": ("verified", "required",
              "حسب ردك: رقم بورجون ليوم 10 نوفمبر، وكل الفروع والإجمالي بتاريخين بس: الحالي 10 نوفمبر والسابق 3 نوفمبر. صححنا تواريخ الإجمالي وبورجون في نسخة المقارنة الأسبوعية المصححة، والأرقام نفسها ما اتغيرتش.",
              "Abdo's decision (review answer 2026-11-20): Bourgogne's current figure (28,975 / 374 orders) is for Tuesday 10 Nov; one date pair applies to every branch and the total. SRC-12 copy: E6 9 -> 10 Nov, I6 2 -> 3 Nov, AL6 3 -> 10 Nov (AP6 already 3 Nov). All four date pairs are now Tuesdays, matching their labels; no sales, order or ratio figure changed.",
              "", "None in the workbooks. Phase 7 uses one date pair per comparison."),
    "P1-11": ("verified", None, "شلنا أخطاء #DIV/0! و#REF! من Daily Sales (النِسَب وسطر الإجمالي بقوا فاضيين لو مفيش مبيعات)، وشلنا السطرين المكسورين تحت الإجمالي.",
              "SRC-02/03 I3:I34, K3:K34 and total row D35/I35/K35 IF-wrapped; broken rows 36-37 (#REF!) cleared. Boundary tests: blank, zero and an empty month.", "", "None."),
    "P1-12": ("rule", None, "البرنامج: لو الخزينة ما اتعدتش تظهر «لم يتم العد» مش «مطابقة»، والعد بصفر يتكتب صراحة، والفرق بيتحسب وقت العد (قبل التوريد، حسب ردك في سؤال الخزينة). رسالة الخزينة في ملف اليومية القديم فضلت زي ما هي.",
              "App rule: blank count = 'not counted', explicit zero is a count, and the variance uses the cash expected at the time of the count (P1-13). The legacy ledger O14 message is left as recorded: the prepared rewrite compared the count with the balance after the bank remittance (E45), which P1-13 rules out, so it was withdrawn on 2026-11-21 (62 protected-sheet operations).",
              "", "Implement in Phase 4."),
    "P1-13": ("rule", "required",
              "حسب ردك: الخزينة بتتعد قبل التوريد للبنك. البرنامج هيسجل وقت العد ووقت التوريد، والكاش المتوقع = المبيعات − الفيزا − المصروفات النقدية اللي حصلت قبل العد. يوم 2 نوفمبر: متوقع 36,942، معدود 36,945، زيادة 3 دراهم، ودي نفس الزيادة المكتوبة في البيان.",
              "Abdo's decision (review answer 2026-11-20): the drawer is counted before the bank remittance. App rule: record the count time and the remittance time; expected cash includes only movements before the count; the later remittance posts once and does not change the count variance. 2 Nov reference: expected 36,942 (48,695 - 11,300 - 453), counted 36,945, +3 MAD, equal to the statement over/short (SRC-05 sheet 2 I17 = 3, unchanged). No workbook copy change: the ledger message 'زيادة قيمتها 36945' is on a protected sheet and its prepared rewrite was withdrawn (P1-12).",
              "", "Implement in Phase 4; the 2 Nov reference test expects +3 MAD."),
    "P1-14": ("verified", None, "وحدنا معادلات البيان اليومي في كل الأيام، وشلنا خانة الإجمالي المكررة.",
              "SRC-04/05 every day sheet: I23 = I15+I20+I21, I21 = D28, over/short I17 = IF(ISNUMBER(I25),I23-I25,\"\"); second 'total expenses' line removed. Check: over/short equals the originals' values on every day with system revenue (Oct 8 = +1, 2 Nov = +3).", "", "None."),
    "P1-15": ("verified", None, "كتبنا مبيعات السيستم ليوم 7 أكتوبر (50,060)، وبقى العجز/الزيادة يظهر فاضي لو مبيعات السيستم مش مكتوبة بدل زيادة وهمية.",
              "SRC-04 sheet 7 I25 = 50,060 (Daily Sales B9 and ledger sheet 7 E17 are both 50,060). Over/short blank when I25 is not a number (boundary-tested).", "", "None."),
    "P1-16": ("verified", None, "صححنا تواريخ أوراق البيان، وأضفنا ورقة 29 أكتوبر من أرقام اليومية، وورقة فاضية لـ27 نوفمبر، وشلنا الأرقام القديمة والأوراق الزايدة، وبقايا نموذج يوليو 2025 من ورقة 10 نوفمبر.",
              "SRC-04/05 I3 dates; 29 Oct rebuilt from ledger sheet 29 and Daily Sales row 31 (a reconstruction, not an original statement); empty 27 Nov; stale Nov values cleared; stray sheets 1648/564/31/FeuilN/Chart1 deleted; SRC-05 sheet 10 P3:V32 leftover block cleared (no references). Hidden 'Sheet1' kept: a blank day template with standard formulas that nothing refers to.", "", "None."),
    "P1-17": ("rule", None, "البرنامج بينقل رصيد كل دفتر لليوم التالي. " + PW_AR,
              "App rule: opening = previous day's closing. Ledger E86/E87 carry-forward prepared: " + PW + ".", "تطبيق تصحيح اليومية لما كلمة السر تتوفر.", "Ledger copy needs the sheet password (project owner)."),
    "P1-18": ("partial", None, "صححنا ترتيب يومي 22 و23 في ورقة الملخص (مش محمية). ربط الأيام 22-24 في أوراق الأيام نفسها محمي بكلمة سر.",
              "Summary D26:E27 now read sheets 22/23 for the rows labelled 22/23 (applied; the summary is unprotected). Day-sheet chaining G4/E42 on sheets 22-24: " + PW + ". App derives chronological order.",
              "تطبيق ربط الأيام لما كلمة السر تتوفر.", "Day-sheet chaining needs the sheet password (project owner)."),
    "P1-19": ("rule", "later", "البرنامج بيسجل التاريخ والفرع والمستخدم ومين عد الخزينة. " + PW_AR,
              "App rule: date, branch, user, counter and role recorded; placeholders rejected. Ledger G4/C4/C6/C53 prepared: " + PW + ".",
              "سؤالك عن مين بيعد الخزينة (قبل مرحلة التقفيل اليومي)، وتطبيق تصحيح اليومية لما كلمة السر تتوفر.", "Abdo: who counts and whether it must differ from the cashier (before Phase 4). Ledger copy needs the password."),
    "P1-20": ("partial", None, "عمود الأوردرات الملغية في الملخص بقى = مجموع قيم الإلغاءات لكل يوم (وشلنا #REF!). قائمة تفاصيل القيود القديمة في الملخص ما اتصلحتش.",
              "Summary J5:J35 = SUM('n'!N25:N55) (cancellation table rows 25-55), J37 total; #REF! on day 4 removed (applied). The legacy detail list (summary M:Q, rows 17-38 only) is not corrected; the app derives summaries from saved entries.",
              "", "Legacy detail list left as is; app rule in Phase 4."),
    "P1-21": ("partial", None, "فصلنا الربط بالملف الخارجي القديم (2017) وصححنا سطر الفيزا في دفتر القيود المخفي لنوفمبر. خانة كشف الأخطاء في أوراق الأيام محمية بكلمة سر.",
              "External 2017 link broken (3 cells in 'دليل التصنيف' keep their cached values); SRC-11 hidden journal Sheet1!H6 = '1'!F20 (row 6 = day-1 VISA row; neighbours read F19/F21; October already did) -> journal difference 0 instead of -64,195. Day-sheet G90 and sheet 16 A19:A24: " + PW + ".",
              "تطبيق باقي التصحيح لما كلمة السر تتوفر.", "Remaining ledger cells need the password. Hidden sheets are not carried into the app."),
    "P1-22": ("rule", None, "هنبدأ بقائمة المصروفات الموجودة في الملف، وتقدر تعدلها من البرنامج بعد كده.", "App seeds expense categories from Ref_; Abdo edits them as admin.", "", "Implement in Phase 4."),
    "P1-23": ("partial", None, "صححنا أسماء الأوراق و«آخر تحديث» وتواريخ أعمدة الأيام في ملفات الجرد، وعنوان ملخص اليومية. رسالة الخزينة بالـ«ريال» في أوراق الأيام محمية، وتواريخ 2017 في القائمة القديمة المخفية فضلت.",
              "Sheet names (SRC-08/09/12), P3 'Last Updated' (SRC-06/13), الوارد/الأنحرافات E5:AI5 dates (each column reads day sheet 1-31), stray cells in SRC-12, ledger summary A1 (applied). Ledger O14 'ريال' message on day sheets: " + PW + ". 2017 dates in the hidden summary list L4:L498 left as is (legacy, not used by the app).",
              "تطبيق رسالة الخزينة لما كلمة السر تتوفر.", "Ledger day-sheet labels need the password."),
    "P1-24": ("verified", "later", "الصنف اللي ما اتعدش بيكمل برصيده الدفتري بدل الصفر، والانحراف يظهر بس بعد العد. الدليل: 51 مرة صنف ما اتعدش وفي اليوم اللي بعده اتصرف منه من غير أي وارد، يعني كان موجود فعلًا.",
              "SRC-06/13: P = IF(prev AC=\"\",prev AB,prev AC); AD = IF(AC=\"\",\"\",AC-AB); AE = N(AD)+prev AE. Independent: 51 cases (Oct 33, Nov 18) where an uncounted item with positive book stock was consumed the next day with no receipt, so a blank count is not zero stock. Boundary-tested (blank vs explicit 0).",
              "سؤالك عن الأصناف اللي بتتعد يوميًا أو أسبوعيًا (قبل مرحلة المخزون).", "Abdo: count cadence per item (before Phase 6)."),
    "P1-25": ("verified", None, "الانحراف الشهري في ورقة Total بقى = الانحراف التراكمي الفعلي.",
              "SRC-06/13 Total!AD = '31'!AE (cumulative; days without a count carry). Boundary-tested.", "", "None."),
    "P1-26": ("verified", None, "شلنا الرمز من خانة الكمية وأرجعنا المعادلة الناقصة.",
              "SRC-06 7!F97 '\\' cleared; SRC-13 3!U564 formula restored to the column pattern.", "", "None."),
    "P1-27": ("rule", None, "البرنامج هياخد المبلغ لكل صنف من تقرير Foodics ويطابقه مع صافي المبيعات. في نسخ الجرد بس خلينا خانات النسبة فاضية بدل #DIV/0! (المبالغ نفسها مش موجودة في الملفات).",
              "App rule: record qty and amount, reconcile to net sales. Copies: Product Mix share columns H/I blank instead of #DIV/0! (display only; amounts were never entered).", "", "Implement in Phase 5."),
    "P1-28": ("deferred", "later", "ربط أسماء Foodics بالأصناف هيتراجع في مرحلة الأصناف. أضفنا اسم «جيلاتيتو روما بيكان» لسطر 202 لأن وصفة البيكان في الملف نفسه بتقرأ السطر ده. أقسام وأسماء تانية مختلفة بين Foodics والجرد (مثلًا «كيكة الهبة دبي شيكولاتة»: «كبير» في Foodics و«صغيرة» في الجرد، والكمية 109 في الاتنين).",
              "Deferred to Phase 5 catalog mapping. SRC-13 D202 named 'جيلاتيتو روما بيكان' (the workbook's own pecan recipe rows read $F$202). Other section and name differences remain, e.g. the chocolate Dubai cake: Foodics 'كبير' vs workbook 'صغيرة' (109 in both; the workbook has no large rows). The Kinder line of the same cake is asked now in P1-29.",
              "سؤالك عن أسماء وأحجام الأصناف (قبل مرحلة الأصناف).", "Abdo or the catalog owner confirms mappings before Phase 5 closes."),
    "P1-29": ("verified", "required",
              "صححنا 5 أصناف في نسخة جرد 7 نوفمبر لأرقام Foodics (نفس الاسم أو الصنف الوحيد بنفس النكهة)، وسجلنا البيكان بدل اللوتس. سطر «كيكة هبة دبى صوص كيندر صغيرة» فضل 12 حسب ردك. مجموع الجرد 2,192 وFoodics 2,182، والفرق 10 هو السطر ده، ورقم Foodics محفوظ عندنا كدليل منفصل.",
              "SRC-13 day 7: F239 70, F288 137, F351 16, F360 52 (same names on the photo), F365 49 (the only mango rice-pudding qashtouta line on either side); F202 1 / F210 cleared (Foodics: pecan 1, no lotus; F202 is the pecan recipe row). F327 Kinder Dubai cake kept at 12 by Abdo's decision (review answer 2026-11-20). Item total 2,249 -> 2,192 vs Foodics 2,182; the 10-unit difference is that line. The Foodics quantity (2) is kept as separate evidence in the corrected transcription.",
              "", "Phase 5 maps Foodics item names and sizes to catalog items (P1-28); the Kinder row's size is part of that mapping."),
    "P1-30": ("deferred", None, "الخامات والوصفات اللي مش مربوطة هتتراجع مع قائمة الوصفات في مرحلة الأصناف.", "Deferred to Phase 5 catalog/recipe review; the app links components by catalog ID.", "", "Phase 5."),
    "P1-31": ("partial", "later", "وحدنا «KGM» إلى «كيلو» (ده رمز الكيلوجرام). ما غيرناش أي وحدة تانية: 17 خامة لسه مكتوبة بأكتر من وحدة، منهم «مكسرات مشكلة» بـ«عدد» في 10 وصفات — حجم الكمية لوحده ما يثبتش الوحدة.",
              "SRC-06/13 recipe column F: 'KGM' -> 'كيلو' (KGM is the UN/ECE code for kilogram). Mixed-nuts 'عدد' -> 'كيلو' reverted: quantity size does not prove a unit. 17 components still carry more than one unit.",
              "سؤالك عن وحدات الخامات (قبل مرحلة الأصناف).", "Abdo or the catalog owner approves one unit per component before Phase 5 closes."),
    "P1-32": ("decision", "later", "ما حددناش تاريخ بداية وصفات نوفمبر: الملفات بتوضح إن وصفات نوفمبر مستخدمة من يوم 1 نوفمبر، لكن ما بتثبتش إن التغيير حصل في اليوم ده بالظبط.",
              "No workbook change. The November recipe set is used from 1 Nov in SRC-13; the actual effective date is not proven. The app keeps versioned recipes; the date and the 6-spoon line need confirmation.",
              "سؤالك: تاريخ بداية الوصفات الجديدة، و6 معالق بظابيظو مانجو كبير.", "Abdo confirms the effective date and the 6-spoon line before Phase 5 closes."),
    "P1-33": ("deferred", "later", "أرصدة أول نوفمبر مختلفة بين الملفات. ما غيرناش حاجة: أرصدة يوم بداية التشغيل الفعلي هتتسجل وتتعتمد منك وقت التسليم.",
              "No change. Opening balances for 5 items differ between SRC-13, the template and the 31 Oct count; tests use the SRC-13 chain. Live opening balances are entered and approved at handover (Phase 11).",
              "سؤالك عن الرصيد الصحيح للأصناف الخمسة (قبل التسليم).", "Abdo: correct opening balances by Phase 11."),
    "P1-34": ("verified", None, "في قالب مراجعة الجرد: المتوقع = الإجمالي − الاستهلاك، والفرق بيظهر بعد العد بس.",
              "SRC-14 M7:M168 = N-O, K7:K168 = IF(ISNUMBER(L),L-M,\"\"), headers K5/M5. Boundary-tested (blank vs 0 count).", "", "None."),
    "P1-35": ("deferred", "required",
              "حسب ردك: الطلبية بتتعمل بالليل وبتوصل بعد يومين، وفيه بضاعة بتوصل كل يوم، وقاعدة «بعد يومين» تفضل لكل الطلبيات. معنى التاريخ المكتوب على الطلبية القديمة (4 نوفمبر) اتأجل لمرحلة الطلبيات بقرار صاحب المشروع.",
              "Abdo (review answer 2026-11-20): orders are prepared at night for delivery two days later, deliveries arrive daily (his example: an order sent on the 20th after 2 pm arrives on the 22nd at noon), and the two-day default applies to every order. The meaning of the legacy date in SRC-01 Sheet1!C6 stays unconfirmed: the project owner deferred it to Phase 8 on 2026-11-21 (decisions/owner-deferrals.json). No workbook change.",
              "", "Phase 8: confirm the legacy C6 date before mapping historical orders. Live records keep creation, expected receipt and actual receipt dates."),
    "P1-36": ("partial", None, "حولنا تاريخ الطلبية لتاريخ حقيقي (4 نوفمبر) وصححنا كتابة «كيلو» في سطرين. كمية «خليط كنافة دبي» مكتوبة «،» وسبناها زي ما هي لأن الكمية المقصودة مش معروفة.",
              "SRC-01 C6 text '04\\11/2026' stored as a date; C25 'كليو' and C63 ';\\كيلو' -> 'كيلو'. D38 ',' left as is (intended quantity unknown; clearing reverted). App orders are single-branch with numeric quantities.",
              "", "None needed for the app; D38 stays unresolved in the historical file."),
    "P1-37": ("verified", None, "العجز بقى يظهر بعلامة «−» وباللون الأحمر.", "SRC-06/13 AD8:AE620 number format 0.00;[Red]-0.00.", "", "None."),
}
Q = {
    "P1-03": "متوسط الطلب في أكتوبر مكتوب = المبيعات ÷ الطلبات ÷ 1.1 (يعني من غير 10%؟)، وفي نوفمبر = المبيعات ÷ الطلبات (زي Foodics). عايز التقرير يحسبه إزاي؟",
    "P1-08": "في المقارنة الأسبوعية: تحب تشوف «نسبة الحالي للسابق» (مثلًا 113%) ولا «نسبة النمو» (13%)؟",
    "P1-10": "رقم بورجون 28,975 (374 طلب) ليوم كام؟ وإيه رقم وتاريخ الأسبوع السابق الصحيح؟ وتاريخ الإجمالي (مكتوب 9 و2 نوفمبر يوم اثنين) المقصود بيه الثلاثاء 10 و3 نوفمبر؟",
    "P1-19": "مين عادةً بيعد الخزينة؟ وهل لازم يكون شخص غير الكاشير؟",
    "P1-24": "إيه الأصناف اللي بتتعد كل يوم، وإيه اللي بتتعد أسبوعيًا أو شهريًا؟",
    "P1-28": "في Foodics «كيكة الهبة دبي شيكولاتة» مكتوبة «كبير» وفي ملف الجرد «صغيرة» (109 في الاتنين، ومفيش سطر «كبير» في الملف) — هل هما نفس المنتج؟ وباقي الأسماء المختلفة هنراجعها معاك في مرحلة الأصناف.",
    "P1-29": "يوم 7 نوفمبر، Foodics فيه «كيكة الهبة دبي صوص كيندر كبير» 2 قطعة (100 درهم)، وملف الجرد فيه «كيكة هبة دبى صوص كيندر صغيرة» 12 قطعة، ومفيش سطر «كبير» في الملف. هل السطر ده في الجرد هو نفس صنف Foodics؟ لو أيوه نصحح الـ12 إلى 2. ولو لأ، إيه الصنف الصح؟",
    "P1-31": "«مكسرات مشكلة» مكتوبة بوحدة «عدد» في 10 وصفات بكمية 0.04 إلى 0.07 — هل دي كيلو؟ (وباقي الخامات اللي ليها أكتر من وحدة هنراجعها معاك في مرحلة الأصناف.)",
    "P1-32": "وصفات نوفمبر بدأت تتطبق من 1 نوفمبر ولا من يوم تاني؟ وبظابيظو مانجو كبير فعلًا بياخد 6 معالق؟",
}
PHASE = {"P1-19": "Phase 4", "P1-24": "Phase 6", "P1-28": "Phase 5", "P1-31": "Phase 5", "P1-32": "Phase 5", "P1-33": "Phase 11"}
for f in d["findings"]:
    st, ab, rar, ren, mar, men = S[f["id"]]
    f.pop("disposition", None)
    f["status"] = st
    f["abdo"] = ab
    if f["id"] == "P1-02":
        f.update({
            "title_ar": "مراجعة تفريغ تقرير Foodics ليوم 7 نوفمبر وتأكيد اسم القسم الرابع",
            "title_en": "Verify the 7 November Foodics transcription and confirm the fourth section label",
            "now_ar": "اسم القسم الرابع كان ناقصًا في التفريغ الأصلي. النسخة المصححة تسجله «دنيا البمبوظه»، وصاحب المشروع أكد قراءة الاسم من الصورة يوم 20 نوفمبر 2026.",
            "problem_ar": "اسم القسم الرابع كان ناقصًا عند نقل التقرير من الصورة. تسجيل التفريغ كغير معتمد من المالك كان حالة متابعة، وليس دليلًا على اختلاف أرقامه عن الصورة.",
            "evidence_ar": "إجماليات الأقسام الثمانية تساوي 100,605 درهم و2,182 قطعة. 55,105 كاش + 45,500 فيزا = 100,605، ومتوسط الطلب 84.90. القسم الرابع 1 + 14 + 2 = 17 قطعة و40 + 560 + 80 = 680 درهم. صاحب المشروع أكد بصريًا اسم «دنيا البمبوظه» وتاريخ اليوم 7 نوفمبر.",
            "proposal_ar": "نسجل مراجعة الأرقام وتأكيد صاحب المشروع للاسم في النسخة المصححة، ونقفل ملاحظة التفريغ بالدليل.",
            "why_ar": "التفريغ يمكن التحقق منه من الصور الموجودة وقراءتها، وقد تأكد الاسم من صاحب المشروع.",
            "example_ar": {"before": "اسم القسم الرابع ناقص في التفريغ الأصلي.", "after": "«دنيا البمبوظه»، 17 قطعة، 680 درهم، مع تسجيل مصدر التحقق."},
            "verify_ar": "نطابق اسم القسم مع التأكيد المسجل، ونراجع إجماليات الأقسام والمدفوعات ومتوسط الطلب على الصورة.",
            "keep_means_ar": "الصور والتفريغ الأصلي يظلان مرجعًا، والنسخة المصححة تحمل نتيجة مراجعة المصدر.",
            "verification_en": "Aggregate section quantities and amounts, payment totals and average checked against the photos. Project owner confirmed M04 exact spelling and the 7 November business date in the conversation on 2026-11-20.",
        })
    if ab == "later":
        f["abdo_by"] = PHASE[f["id"]]
    else:
        f.pop("abdo_by", None)
    if f["id"] in Q:
        f["question_ar"] = Q[f["id"]]
    if not ab:
        f.pop("question_ar", None)
    for k, v in (("resolution_ar", rar), ("resolution_en", ren), ("remaining_ar", mar), ("remaining_en", men)):
        if v:
            f[k] = v
        else:
            f.pop(k, None)
    assert not ab or f.get("question_ar"), f["id"]
d.pop("dispositions", None)
d.pop("triage_note", None)
d["statuses"] = {
    "verified": {"ar": "صححناه وتأكدنا منه", "en": "Fully verified correction"},
    "partial": {"ar": "تصحيح جزئي", "en": "Partial correction"},
    "assumption": {"ar": "مطبق على افتراض", "en": "Applied on an assumption"},
    "rule": {"ar": "قاعدة للبرنامج", "en": "Future application rule"},
    "deferred": {"ar": "مؤجل لمرحلة لاحقة", "en": "Deferred to a later phase"},
    "decision": {"ar": "في انتظار قرارك", "en": "Pending Abdo's decision"},
}
d["abdo_levels"] = {
    "required": {"ar": "محتاج معرفتك — لازم قبل قفل المرحلة الأولى", "en": "Needs Abdo's knowledge: required to close Phase 1"},
    "later": {"ar": "محتاج رأيك قبل مرحلة لاحقة", "en": "Needs Abdo before a later phase"},
}
d["status_note"] = ("Rechecked 2026-11-20: unproven dates, units, product mappings and recipe dates were reverted in the copies and are pending; "
                    "no correction is applied on an assumption (the P1-29 Kinder Dubai cake quantity, applied on an unconfirmed size mapping until 20 Nov, was reverted). Abdo's review page shows only the required questions; the full register stays with the team. "
                    "Abdo's six review answers (2026-11-20) were applied on 2026-11-21: P1-03 average formula and P1-10 dates in the copies; P1-08 ratio and P1-29 quantity kept; P1-13 and P1-35 recorded as rules/deferral.")
d["version"] = "2026-11-21.1"
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(Counter(f["status"] for f in d["findings"]), Counter(f["abdo"] for f in d["findings"]))
