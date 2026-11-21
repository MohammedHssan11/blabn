# Phase 1 findings register

Generated from [findings.json](findings.json) (version `2026-11-21.1`) by `scripts/phase1/review/build.mjs`. Do not edit by hand.

Abdo's [review page](review/abdo-review.html) shows only the 6 findings marked **Required** (customer wording in [review-questions.json](review-questions.json)); each can be accepted, changed, kept as is, or marked «not sure» (unresolved). **Before Phase N** questions are added to the page before that phase. The rest of this register stays with the team. Workbook changes are listed in [CORRECTIONS.md](CORRECTIONS.md). Recorded answers live in [decisions/abdo-decisions.json](decisions/abdo-decisions.json); see [decisions/DECISIONS_SUMMARY.md](decisions/DECISIONS_SUMMARY.md).

**37 findings.** Status: Fully verified correction 19, Partial correction 6, Applied on an assumption 0, Future application rule 7, Deferred to a later phase 4, Pending Abdo's decision 1. Questions for Abdo: 6 required to close Phase 1, 6 before later phases. Rechecked 2026-11-20: unproven dates, units, product mappings and recipe dates were reverted in the copies and are pending; no correction is applied on an assumption (the P1-29 Kinder Dubai cake quantity, applied on an unconfirmed size mapping until 20 Nov, was reverted). Abdo's review page shows only the required questions; the full register stays with the team. Abdo's six review answers (2026-11-20) were applied on 2026-11-21: P1-03 average formula and P1-10 dates in the copies; P1-08 ratio and P1-29 quantity kept; P1-13 and P1-35 recorded as rules/deferral.

By kind: Business rule 16, Confirmed error 18, Conflicting evidence 3. By severity: Medium 21, High 12, Low 4.

| ID | Status | Needs Abdo | Area | Kind | Severity | Finding | Sources | Phases |
|---|---|---|---|---|---|---|---|---|
| [P1-01](#p1-01) | Fully verified correction |  | Sources | Business rule | Medium | Newer November inventory copy and inventory-review template are outside the repository | LOC-01, LOC-02, SRC-07 | 1, 6 |
| [P1-02](#p1-02) | Fully verified correction |  | Sources | Business rule | Medium | Verify the 7 November Foodics transcription and confirm the fourth section label | IMG-01..03, IMG-04 | 1, 4, 6, 10 |
| [P1-03](#p1-03) | Fully verified correction | **Required** | Sales and KPIs | Business rule | High | Average order value in October is (sales ÷ orders) ÷ 1.1 on most days | SRC-02, SRC-03 | 4, 9 |
| [P1-04](#p1-04) | Future application rule |  | Cash and daily close | Business rule | High | Bank remittance is mixed into expenses and the 'Cash' column holds the remittance | SRC-02/03, SRC-04/05, SRC-10/11 | 4, 9 |
| [P1-05](#p1-05) | Fully verified correction |  | Sales and KPIs | Confirmed error | Medium | 7 October expenses in Daily Sales omit 506 MAD | SRC-02, SRC-04, SRC-10 | 10 |
| [P1-06](#p1-06) | Fully verified correction |  | Sales and KPIs | Confirmed error | Medium | 18 October expenses and cash are swapped in Daily Sales | SRC-02, SRC-04 | 10 |
| [P1-07](#p1-07) | Fully verified correction |  | Sales and KPIs | Confirmed error | High | October Daily Sales: September title, 2025/1900 dates, and 31 October missing | SRC-02, SRC-09, SRC-08 | 4, 7, 9 |
| [P1-08](#p1-08) | Fully verified correction | **Required** | Sales comparison | Confirmed error | High | 'Growth' cells compute a ratio, and October's is inverted | SRC-08, SRC-09, SRC-12 | 7, 9 |
| [P1-09](#p1-09) | Fully verified correction |  | Sales comparison | Confirmed error | Medium | November comparison shows 0% for unentered days and compares two days with a full month | SRC-09 | 7, 9 |
| [P1-10](#p1-10) | Fully verified correction | **Required** | Sales comparison | Conflicting evidence | High | Weekly comparison: Bourgogne date duplicated and the total's dates differ from the branches | SRC-12 | 7 |
| [P1-11](#p1-11) | Fully verified correction |  | Sales and KPIs | Confirmed error | Low | Visible errors on empty days and a broken '%' row in Daily Sales | SRC-02, SRC-03 | 9 |
| [P1-12](#p1-12) | Future application rule |  | Cash and daily close | Business rule | High | The drawer count is never entered, yet the ledger says 'cash matches' | SRC-04/05, SRC-10/11 | 4 |
| [P1-13](#p1-13) | Future application rule | **Required** | Cash and daily close | Business rule | High | 2 November cash count of 36,945: before or after the bank remittance? | SRC-11, SRC-05 | 4, 10 |
| [P1-14](#p1-14) | Fully verified correction |  | Cash and daily close | Confirmed error | Medium | Daily statement over/short formula varies by day; some days are typed values | SRC-04, SRC-05 | 4, 9 |
| [P1-15](#p1-15) | Fully verified correction |  | Cash and daily close | Confirmed error | Medium | 7 October statement: system revenue blank, showing a 50,060 overage | SRC-04 | 4, 10 |
| [P1-16](#p1-16) | Fully verified correction |  | Cash and daily close | Confirmed error | Medium | Daily statement sheets: wrong dates, a missing day, and leftover figures from earlier months | SRC-04, SRC-05 | 9, 10 |
| [P1-17](#p1-17) | Future application rule |  | Daily ledger and custody | Confirmed error | High | Purchasing-custody balance is not carried forward day to day | SRC-10, SRC-11 | 4 |
| [P1-18](#p1-18) | Partial correction |  | Daily ledger and custody | Confirmed error | Medium | Ledger days 22-24 are chained out of order; the summary swaps days 22 and 23 | SRC-10, SRC-11 | 4, 9 |
| [P1-19](#p1-19) | Future application rule | Before Phase 4 | Daily ledger and custody | Business rule | Medium | The ledger records no business date, branch, cashier or cash counter | SRC-10/11 | 3, 4 |
| [P1-20](#p1-20) | Partial correction |  | Daily ledger and custody | Confirmed error | Medium | Ledger summary: cancellations column reads the wrong cells and detail rows are skipped | SRC-10/11 | 4, 9 |
| [P1-21](#p1-21) | Partial correction |  | Daily ledger and custody | Confirmed error | Low | Hidden legacy sheets in the ledger contain errors and a 2017 external link | SRC-10/11 | 4, 9 |
| [P1-22](#p1-22) | Future application rule |  | Daily ledger and custody | Business rule | Medium | Expense/account code lists exist but are not used | SRC-10/11 | 4, 5 |
| [P1-23](#p1-23) | Partial correction |  | Sources | Confirmed error | Low | Stale template labels and dates across the workbooks | SRC-08/09, SRC-12, SRC-06/07, LOC-01, SRC-10/11 | 9 |
| [P1-24](#p1-24) | Fully verified correction | Before Phase 6 | Inventory | Business rule | High | An item not counted on a day opens the next day at zero and shows a false deviation | SRC-06, SRC-07 / LOC-01 | 6 |
| [P1-25](#p1-25) | Fully verified correction |  | Inventory | Confirmed error | High | The monthly Total sheet compares the month's balance with the day-31 count even when blank | SRC-06/07, LOC-01 | 6, 9 |
| [P1-26](#p1-26) | Fully verified correction |  | Inventory | Confirmed error | Low | Symbols typed into quantity cells ('\', '?') cause error chains | SRC-06, LOC-01 | 6 |
| [P1-27](#p1-27) | Future application rule |  | Inventory | Business rule | Medium | Product Mix amounts are never entered, so sold items cannot be reconciled to sales | SRC-06/07, LOC-01 | 6 |
| [P1-28](#p1-28) | Deferred to a later phase | Before Phase 5 | Products, recipes and units | Business rule | Medium | Product sections and names in the inventory workbook differ from Foodics | LOC-01, IMG-02/03 | 5, 6 |
| [P1-29](#p1-29) | Fully verified correction | **Required** | Inventory | Conflicting evidence | High | 7 November Product Mix in the inventory workbook exceeds Foodics by 67 units | LOC-01, IMG-03 | 6, 10 |
| [P1-30](#p1-30) | Deferred to a later phase |  | Products, recipes and units | Confirmed error | Medium | Some recipe components never reach stock; some recipes read empty Product Mix rows | SRC-06/07, LOC-01 | 5 |
| [P1-31](#p1-31) | Partial correction | Before Phase 5 | Products, recipes and units | Business rule | Medium | The same component appears with different units across recipes | SRC-06/07, LOC-01 | 5 |
| [P1-32](#p1-32) | Pending Abdo's decision | Before Phase 5 | Products, recipes and units | Business rule | Medium | Recipe differences between the October and November inventory workbooks | SRC-06, SRC-07 / LOC-01 | 5, 6 |
| [P1-33](#p1-33) | Deferred to a later phase | Before Phase 11 | Inventory | Conflicting evidence | Medium | 1 November opening balances differ between the inventory workbook, the review template and the 31 October count | SRC-06, SRC-07 / LOC-01, LOC-02 | 6, 11 |
| [P1-34](#p1-34) | Fully verified correction |  | Inventory | Business rule | Medium | The inventory-review template adds consumption instead of subtracting it, and shows a difference before counting | LOC-02 | 6 |
| [P1-35](#p1-35) | Deferred to a later phase | **Required** | Replenishment and receiving | Business rule | High | The 4 November (Wednesday) order matches receipts recorded on the same day, not Friday | SRC-01, LOC-01 | 8 |
| [P1-36](#p1-36) | Partial correction |  | Replenishment and receiving | Business rule | Medium | The order workbook mixes another branch's shortages, a blank duplicate block and non-numeric quantities | SRC-01 | 8, 9 |
| [P1-37](#p1-37) | Fully verified correction |  | Inventory | Confirmed error | Medium | Negative stock deviations are displayed without a minus sign | SRC-06/07, LOC-01 | 6, 9 |

## P1-01

**Newer November inventory copy and inventory-review template are outside the repository** — نسخة جرد نوفمبر الأحدث وقالب مراجعة الجرد غير محفوظين مع ملفات المشروع

- Status: **Fully verified correction**
- Done: LOC-01/LOC-02 copied to source-material/workbooks/ as SRC-13 and SRC-14 (byte-identical, SHA-256 checked).
- Remaining: None. The video stays local (not a workbook).
- Kind / severity: Business rule / Medium
- Locations: LOC-01 `abdo temp/شيت جرد بلبن فرع المعاريف نوفمبر 2026 (2).xlsx` — الملف كله (أيام 1 إلى 13 نوفمبر); LOC-02 `abdo temp/مراجعه الجرد.xlsx` — Sheet1; SRC-07 `source-material/workbooks/inventory-nov-2026.xlsx` — الأيام 1 و2 فقط فيها بيانات
- Verification: Cell-by-cell comparison of input cells in sheets 1-2 (SRC-07 vs LOC-01): 0 differences; recipe lines identical. SHA-256 recorded in source-inventory.json.
- Affects phases: 1, 6; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** ملف جرد نوفمبر المحفوظ مع المشروع فيه بيانات يومين فقط (1 و2 نوفمبر). عندنا على الجهاز نسخة أحدث من نفس الملف فيها بيانات من 1 إلى 13 نوفمبر، وقالب «مراجعة جرد فرع المعاريف»، وفيديو قصير يشرح القالب. الثلاثة غير محفوظين مع ملفات المشروع.

**المشكلة:** النسخة الأحدث هي أكمل مصدر لحركة المخزون في نوفمبر، وعدد من الملاحظات في هذه المراجعة مبني عليها. لو بقيت خارج ملفات المشروع ممكن تضيع أو يشتغل الفريق على النسخة القديمة.

**الدليل:** قارنّا اليومين 1 و2 في النسختين خانة بخانة: كل المدخلات متطابقة، والنسخة الأحدث فيها 11 يومًا إضافيًا (3 إلى 13 نوفمبر). الوصفات في النسختين متطابقة أيضًا.

**التأثير:** تحديد أي نسخة نعتمدها كمرجع لاختبار الجرد والوصفات في المراحل القادمة.

**المقترح:** نضيف النسخة الأحدث وقالب المراجعة إلى ملفات المشروع الخاصة (المستودع الخاص) كمصدرين جديدين، ونترك النسخة القديمة كما هي للمقارنة. الفيديو يبقى على الجهاز فقط لأنه تسجيل شخصي، ونكتفي بوصفه.

**السبب:** كده يبقى كل فرد في الفريق شايف نفس الملفات اللي اتراجعت، وما نحتاجش نسألك تبعت الملفات مرة ثانية.

**مثال:** قبل: ملف نوفمبر في المشروع: يومين فقط. — بعد: ملف نوفمبر الأحدث (13 يومًا) محفوظ بجانب القديم باسم واضح وتاريخ.

**التحقق:** نتأكد إن الملفين ظهروا في قائمة المصادر بنفس البصمة الرقمية للنسخة اللي راجعناها.

**مرتبط:** الملاحظات P1-24 وP1-25 وP1-29 وP1-33 وP1-34 مبنية على النسخة الأحدث.

**لو اختار «نُبقي الوضع الحالي»:** نستخدم النسخة الأحدث في الاختبار من على الجهاز فقط، من غير ما نحفظها مع ملفات المشروع.

</div>

## P1-02

**Verify the 7 November Foodics transcription and confirm the fourth section label** — مراجعة تفريغ تقرير Foodics ليوم 7 نوفمبر وتأكيد اسم القسم الرابع

- Status: **Fully verified correction**
- Done: Source transcription verified against the photos and aggregate arithmetic. The project owner visually confirmed the exact M04 spelling 'دنيا البمبوظه' on 2026-11-20. The corrected copy records that confirmation. Resolved as source verification; no Abdo approval was recorded.
- Remaining: None.
- Kind / severity: Business rule / Medium
- Locations: IMG-01..03 `source-material/images/2026-11-07/*.jpg` — صور Orders Summary و Product Mix; IMG-04 `source-material/images/2026-11-07/report-sample-2026-11-07.json` — product_mix.sections M04 و owner_approved
- Verification: Aggregate section quantities and amounts, payment totals and average checked against the photos. Project owner confirmed M04 exact spelling and the 7 November business date in the conversation on 2026-11-20.
- Affects phases: 1, 4, 6, 10; reports: Daily Sales، الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** اسم القسم الرابع كان ناقصًا في التفريغ الأصلي. النسخة المصححة تسجله «دنيا البمبوظه»، وصاحب المشروع أكد قراءة الاسم من الصورة يوم 20 نوفمبر 2026.

**المشكلة:** اسم القسم الرابع كان ناقصًا عند نقل التقرير من الصورة. تسجيل التفريغ كغير معتمد من المالك كان حالة متابعة، وليس دليلًا على اختلاف أرقامه عن الصورة.

**الدليل:** إجماليات الأقسام الثمانية تساوي 100,605 درهم و2,182 قطعة. 55,105 كاش + 45,500 فيزا = 100,605، ومتوسط الطلب 84.90. القسم الرابع 1 + 14 + 2 = 17 قطعة و40 + 560 + 80 = 680 درهم. صاحب المشروع أكد بصريًا اسم «دنيا البمبوظه» وتاريخ اليوم 7 نوفمبر.

**التأثير:** اختبار إدخال المبيعات وطرق الدفع وProduct Mix في البرنامج.

**المقترح:** نسجل مراجعة الأرقام وتأكيد صاحب المشروع للاسم في النسخة المصححة، ونقفل ملاحظة التفريغ بالدليل.

**السبب:** التفريغ يمكن التحقق منه من الصور الموجودة وقراءتها، وقد تأكد الاسم من صاحب المشروع.

**مثال:** قبل: اسم القسم الرابع ناقص في التفريغ الأصلي. — بعد: «دنيا البمبوظه»، 17 قطعة، 680 درهم، مع تسجيل مصدر التحقق.

**التحقق:** نطابق اسم القسم مع التأكيد المسجل، ونراجع إجماليات الأقسام والمدفوعات ومتوسط الطلب على الصورة.

**مرتبط:** الملاحظة P1-29: أرقام نفس اليوم في ملف الجرد مختلفة عن الصورة في 6 أسطر.

**لو اختار «نُبقي الوضع الحالي»:** الصور والتفريغ الأصلي يظلان مرجعًا، والنسخة المصححة تحمل نتيجة مراجعة المصدر.

</div>

## P1-03

**Average order value in October is (sales ÷ orders) ÷ 1.1 on most days** — متوسط الطلب في أكتوبر مقسوم على 1.1 في أغلب الأيام

- Status: **Fully verified correction** — needs Abdo (required for Phase 1)
- Done: Abdo's decision (review answer 2026-11-20): average order value = net sales / orders, two decimals, every day; period average = total sales / total orders. Applied to the SRC-02/03 copies: D3:D33 = IF(N(C)=0,"",ROUND(B/C,2)), replacing the typed values (October's were sales/orders/1.1; the reason for 1.1 was not given and is not used).
- Remaining: None in the workbooks. Implement the same rule in Phases 4 and 9.
- Kind / severity: Business rule / High
- Locations: SRC-02 `daily-sales-oct-2026.xlsx` — Sheet1!D3:D28 (1 إلى 26 أكتوبر)، D29، D35; SRC-03 `daily-sales-nov-2026.xlsx` — Sheet1!D4 (2 نوفمبر)
- Verification: Independent recalculation of B/C per row vs typed D (2-dp). Excel full recalculation of the workbook reproduces all cached values. Intent of the ÷1.1 is not documented.
- Affects phases: 4, 9; reports: Daily Sales

<div dir="rtl">

**الموجود حاليًا:** في تقرير Daily Sales لشهر أكتوبر، خانة «متوسط الطلب» مكتوبة باليد. يوم 1 أكتوبر مكتوب 72.10 درهم.

**المشكلة:** المبيعات ÷ الطلبات ليوم 1 أكتوبر = 50,125 ÷ 632 = 79.31. الرقم المكتوب 72.10 = 79.31 ÷ 1.1. نفس الشيء في كل الأيام من 1 إلى 26 أكتوبر. يوم 27 مكتوب 73.50 والصحيح 76.08 (لا يطابق أي طريقة). من 28 إلى 30 أكتوبر الرقم صحيح بدون قسمة. سطر الإجمالي يحسب بدون قسمة (83.60). في نوفمبر يوم 2 مكتوب 76.00 والحساب 76.21.

**الدليل:** حسبنا المتوسط لكل يوم من المبيعات والطلبات المكتوبة في نفس الملف: 27 يومًا من 30 لا تطابق، و26 منها تطابق تمامًا لو قسمنا على 1.1. تقرير Foodics ليوم 7 نوفمبر يحسب المتوسط = صافي المبيعات ÷ الطلبات (100,605 ÷ 1,185 = 84.90) والضريبة فيه صفر.

**التأثير:** متوسط الطلب في Daily Sales وأي مقارنة بين الشهور. لو البرنامج نسخ الطريقة القديمة، متوسط أكتوبر هيظهر أقل بحوالي 10%.

**المقترح:** البرنامج يحسب متوسط الطلب دائمًا = صافي المبيعات ÷ عدد الطلبات لنفس اليوم، بمنزلتين عشريتين، ومتوسط الفترة = مجموع المبيعات ÷ مجموع الطلبات. ولو كنت عايز رقم «بدون ضريبة 10%» نعرضه كمؤشر منفصل باسم واضح.

**السبب:** ده نفس تعريف Foodics، ويخلي الرقم ثابتًا كل يوم ومفهومًا بدون كتابة يدوية.

**مثال:** قبل: 1 أكتوبر: 72.10 درهم (مكتوب باليد). — بعد: 1 أكتوبر: 79.31 درهم (50,125 ÷ 632).

**التحقق:** اختبار: مبيعات 50,125 وطلبات 632 تعطي 79.31؛ ومبيعات 100,605 وطلبات 1,185 تعطي 84.90.

**مرتبط:** SRC-02 D29 (27 أكتوبر): 73.50 بدل 76.08. · SRC-03 D4 (2 نوفمبر): 76.00 بدل 76.21.

**لو اختار «نُبقي الوضع الحالي»:** البرنامج يقسم المتوسط على 1.1 زي ملف أكتوبر (لازم تقول لنا إمتى يتقسم وإمتى لا).

**سؤال لعبدو:** متوسط الطلب في أكتوبر مكتوب = المبيعات ÷ الطلبات ÷ 1.1 (يعني من غير 10%؟)، وفي نوفمبر = المبيعات ÷ الطلبات (زي Foodics). عايز التقرير يحسبه إزاي؟

</div>

## P1-04

**Bank remittance is mixed into expenses and the 'Cash' column holds the remittance** — توريد البنك مكتوب مع المصروفات، وعمود «كاش» فيه مبلغ التوريد

- Status: **Future application rule**
- Done: App rule: remittance is its own movement. Copies: headers G2/H2/I2 of SRC-02/03 relabelled to what the columns hold (checked on 28 of 30 October days and on 1 Nov against the statement). Data layout unchanged.
- Remaining: Implement in Phases 4 and 9.
- Kind / severity: Business rule / High
- Locations: SRC-02/03 `daily-sales-*.xlsx` — Sheet1 الأعمدة G «المصاريف» وH «كاش» وI «نسبه الكاش» (وتعليق على G3: «توريد بنك»); SRC-04/05 `daily-statement-*.xlsx` — كل ورقة يوم: D6:D26 و D28 «اجمالى المصروفات» و I21; SRC-10/11 `daily-ledger-*.xlsx` — كل ورقة يوم: عهدة المشتريات D56:F85
- Verification: Cross-report reconciliation SRC-02/03 vs SRC-04/05 vs SRC-10/11 per date; comment on SRC-02/03 G3 reads 'توريد بنك'.
- Affects phases: 4, 9; reports: Daily Sales، البيان اليومي، اليومية

<div dir="rtl">

**الموجود حاليًا:** في Daily Sales: عمود «المصاريف» = المصروفات + توريد البنك، وعمود «كاش» = مبلغ توريد البنك، و«نسبة الكاش» = التوريد ÷ المبيعات. في البيان اليومي واليومية: توريد البنك سطر داخل قائمة المصروفات.

**المشكلة:** الاسم لا يوصف الرقم. «كاش» هنا ليس الكاش اللي اتحصل من العملاء (Foodics يوم 7 نوفمبر: كاش 55,105)، بل اللي اتورد للبنك. ولو البرنامج سجل «المصاريف» و«التوريد» كحركتين منفصلتين من نفس الأعمدة، التوريد هيتخصم مرتين.

**الدليل:** 1 نوفمبر: Daily Sales G3=64,196 و H3=63,720. في البيان D10 «توريد البنك» = 63,720 وباقي المصروفات = 476، والمجموع 64,196. وفي 28 يومًا من 30 في أكتوبر: المبيعات − الفيزا − «كاش» = «المصاريف» − «كاش» (يعني الفرق هو المصروفات الأخرى).

**التأثير:** Daily Sales والبيان اليومي واليومية، وحساب الكاش المتوقع في الخزينة.

**المقترح:** البرنامج يسجل كل رقم مرة واحدة باسمه: كاش Foodics، فيزا، كل مصروف لوحده، وتوريد البنك كحركة مستقلة (ليست مصروفًا). وكل تقرير يعرضها بالشكل اللي تختاره (مثلًا «المصاريف شاملة التوريد» في Daily Sales لو حابب تحتفظ بالشكل القديم).

**السبب:** يمنع تكرار خصم التوريد، ويخلي «نسبة الكاش» و«الكاش المتوقع» مفهومين.

**مثال:** قبل: 1 نوفمبر: المصاريف 64,196، كاش 63,720، نسبة الكاش 73.7%. — بعد: 1 نوفمبر: مصروفات 476، توريد بنك 63,720، كاش Foodics (يُدخل من التقرير)، والتقرير يعرض «المصاريف شاملة التوريد = 64,196» لو اخترت ذلك.

**التحقق:** اختبار يوم 1 نوفمبر: مجموع المصروفات + التوريد = 64,196، والتوريد لا يظهر إلا مرة في حساب الخزينة.

**مرتبط:** قرار مفتوح سابق في المشروع: هل توريد البنك مصروف أم حركة نقدية منفصلة؟

**لو اختار «نُبقي الوضع الحالي»:** نحتفظ بنفس التسمية القديمة في التقارير («كاش» = التوريد)، والبرنامج داخليًا يسجلهم منفصلين.

</div>

## P1-05

**7 October expenses in Daily Sales omit 506 MAD** — مصروفات 7 أكتوبر في Daily Sales ناقصة 506 درهم

- Status: **Fully verified correction**
- Done: SRC-02 G9: 36,214 -> 36,720. Independent: statement sheet 7 D28 = 36,720 and ledger sheet 7 F86 = 36,720; 50,060 - 13,340 - 36,214 = 506 = the other expenses.
- Remaining: None.
- Kind / severity: Confirmed error / Medium
- Locations: SRC-02 `daily-sales-oct-2026.xlsx` — Sheet1!G9; SRC-04 `daily-statement-oct-2026.xlsx` — ورقة 7: D6:D10 و D28; SRC-10 `daily-ledger-oct-2026.xlsx` — ورقة 7: F86
- Verification: Independent arithmetic B-J-H vs G-H per row; three-source agreement (statement sheet 7 D28=36,720, ledger sheet 7 F86=36,720).
- Affects phases: 10; reports: Daily Sales

<div dir="rtl">

**الموجود حاليًا:** Daily Sales يوم 7 أكتوبر: المصاريف 36,214 درهم، وهو نفس مبلغ التوريد.

**المشكلة:** البيان واليومية لنفس اليوم فيهم مصروفات أخرى 506 درهم (انتقالات فريق التصوير 100، انتقالات 130، مياه 30، فواكه 246) + التوريد 36,214 = 36,720.

**الدليل:** المبيعات 50,060 − الفيزا 13,340 − التوريد 36,214 = 506، وده نفس مجموع المصروفات الأخرى في البيان.

**التأثير:** مجموع مصروفات أكتوبر في Daily Sales أقل بـ506 درهم.

**المقترح:** نعتبر الرقم الصحيح ليوم 7 أكتوبر 36,720 (مصروفات 506 + توريد 36,214) عند إدخال الأيام المرجعية للاختبار. الملف الأصلي لا يتعدل.

**السبب:** مصدرين مستقلين (البيان واليومية) متفقين، ومعادلة الخزينة تقفل بالضبط.

**مثال:** قبل: 7 أكتوبر: المصاريف 36,214. — بعد: 7 أكتوبر: المصاريف 506 + توريد 36,214 = 36,720.

**التحقق:** عند إدخال 7 أكتوبر في بيئة الاختبار: المبيعات − الفيزا − المصروفات − التوريد = صفر.

**مرتبط:** الملاحظة P1-06 (18 أكتوبر).

**لو اختار «نُبقي الوضع الحالي»:** نستخدم 36,214 كما هو في الملف عند الاختبار.

</div>

## P1-06

**18 October expenses and cash are swapped in Daily Sales** — رقمي المصاريف والكاش ليوم 18 أكتوبر متبادلين في Daily Sales

- Status: **Fully verified correction**
- Done: SRC-02 G20/H20 swapped back to 73,436 / 73,176. Independent: statement sheet 18 (bank 73,176; total 73,436) and ledger sheet 18 F86 = 73,436.
- Remaining: None.
- Kind / severity: Confirmed error / Medium
- Locations: SRC-02 `daily-sales-oct-2026.xlsx` — Sheet1!G20 و H20; SRC-04 `daily-statement-oct-2026.xlsx` — ورقة 18: D9 و I21
- Verification: Row arithmetic and statement sheet 18 (D9 bank 73,176; D28 73,436); ledger sheet 18 F86 = 73,436.
- Affects phases: 10; reports: Daily Sales

<div dir="rtl">

**الموجود حاليًا:** Daily Sales يوم 18 أكتوبر: المصاريف 73,176 والكاش 73,436.

**المشكلة:** في البيان: التوريد 73,176 والمصروفات كلها 73,436. يعني الرقمين اتكتبوا في عكس الخانات، فـ«الكاش» طلع أكبر من «المصاريف» وده مستحيل حسب طريقة الملف.

**الدليل:** المبيعات 91,130 − الفيزا 17,694 − 73,176 = 260، وده مجموع المصروفات الأخرى في البيان (100 + 130 + 30).

**التأثير:** نسبة الكاش ليوم 18 أكتوبر ومجموع الشهر في عمودي المصاريف والكاش.

**المقترح:** عند الاختبار نستخدم: مصروفات 260، توريد 73,176، المجموع 73,436.

**السبب:** البيان واليومية متفقين، والمعادلة تقفل بالضبط.

**مثال:** قبل: المصاريف 73,176 / الكاش 73,436. — بعد: المصاريف شاملة التوريد 73,436 / التوريد 73,176.

**التحقق:** إدخال اليوم في بيئة الاختبار يعطي فرق خزينة صفر.

**مرتبط:** الملاحظة P1-05.

**لو اختار «نُبقي الوضع الحالي»:** نستخدم الرقمين كما هما في الملف.

</div>

## P1-07

**October Daily Sales: September title, 2025/1900 dates, and 31 October missing** — Daily Sales أكتوبر: عنوان سبتمبر، تواريخ سنة 2025 و1900، ويوم 31 أكتوبر ناقص

- Status: **Fully verified correction**
- Done: SRC-02 A1 title, A3:A33 dates; row 33 = 31 Oct (101,110 / 1,166 / 75,645 / 74,884 / 25,465) from statement sheet 31 and ledger sheet 31; SRC-08 I36:K36; SRC-03 A15:A32 dates. Independent: 1,954,565 + 101,110 = 2,055,675; days 1-30 equal in three files.
- Remaining: None.
- Kind / severity: Confirmed error / High
- Locations: SRC-02 `daily-sales-oct-2026.xlsx` — Sheet1!A1، A3:A32 (A8:A9 سنة 1900)، الصف 33 فارغ، B35; SRC-09 `sales-comparison-nov-2026.xlsx` — F36 و F37; SRC-08 `sales-comparison-oct-2026.xlsx` — L36 و D36 و J37
- Verification: Row-by-row comparison of SRC-02 B/C with SRC-08 J/I and SRC-09 F/E for 1-30 Oct (0 mismatches); 31 Oct from SRC-04 sheet 31, SRC-10 sheet 31, SRC-09 row 36.
- Affects phases: 4, 7, 9; reports: Daily Sales، مقارنة المبيعات

<div dir="rtl">

**الموجود حاليًا:** العنوان «تقرير المبيعات فرع المعاريف سبتمبر» مع إن الأرقام لأكتوبر. التواريخ مكتوبة 2025-10-01 … ويومين (6 و7) سنة 1900. يوم 31 أكتوبر غير موجود، وإجمالي الشهر 1,954,565 درهم.

**المشكلة:** يوم 31 أكتوبر (101,110 درهم، 1,166 طلب) موجود في البيان واليومية وملف مقارنة نوفمبر، لكنه غير موجود في Daily Sales ولا في ملف مقارنة أكتوبر. لذلك إجمالي أكتوبر 1,954,565 في ملف وفي ملف آخر 2,055,675.

**الدليل:** الفرق بين الإجماليين = 101,110 بالضبط = مبيعات 31 أكتوبر. الأيام من 1 إلى 30 متطابقة رقمًا برقم بين Daily Sales وملفي المقارنة (مبيعات وطلبات).

**التأثير:** إجمالي أكتوبر ومتوسطه في Daily Sales، ومقارنة سبتمبر بأكتوبر، ومقارنة أكتوبر بنوفمبر.

**المقترح:** البرنامج يكتب التاريخ والشهر تلقائيًا من يوم العمل، ويعرض بجانب كل إجمالي عدد الأيام المحسوبة (مثلًا «30 من 31 يومًا»). وفي بيانات الاختبار نعتبر أكتوبر 31 يومًا ومجموعه 2,055,675.

**السبب:** الخطأ في التاريخ والعنوان سببه الكتابة اليدوية، والنقص في يوم 31 يظهر فقط لو التقرير بيبين عدد الأيام.

**مثال:** قبل: Daily Sales أكتوبر: 1,954,565 (30 يومًا، بدون إشارة). — بعد: أكتوبر: 2,055,675 (31 من 31 يومًا).

**التحقق:** اختبار شهر ناقص يوم: التقرير يعرض «30 من 31 يومًا» ولا يقارن نسبة نمو قبل اكتمال التغطية أو بدون تنبيه.

**مرتبط:** SRC-08 يقارن سبتمبر (30 يومًا) بأكتوبر (30 يومًا) ويعرض 31 أكتوبر فارغًا مع #DIV/0!. · SRC-03 نوفمبر: التواريخ A15:A33 كلها 1 نوفمبر (قالب).

**لو اختار «نُبقي الوضع الحالي»:** نترك أكتوبر 30 يومًا (1,954,565) في بيانات الاختبار كما في Daily Sales.

</div>

## P1-08

**'Growth' cells compute a ratio, and October's is inverted** — خانة «نسبة النمو» لا تحسب النمو، وفي أكتوبر محسوبة بالعكس

- Status: **Fully verified correction** — needs Abdo (required for Phase 1)
- Done: Monthly comparisons (column titled growth) corrected in the SRC-08/09 copies: D6:D36 = IF(OR(NOT(ISNUMBER(J)),N(F)=0),"",J/F-1), D37 like-for-like; October was inverted. Weekly report: Abdo kept the current/prior ratio (decision 2026-11-20); the SRC-12 ratio cells and their header are unchanged.
- Remaining: Phase 7: label the weekly figure as a current/prior ratio («نسبة الحالي للسابق»), not growth.
- Kind / severity: Confirmed error / High
- Locations: SRC-08 `sales-comparison-oct-2026.xlsx` — D6:D37 (=F/J); SRC-09 `sales-comparison-nov-2026.xlsx` — D6:D37 (=J/F); SRC-12 `مقارنه يوميه المغرب (3) (1).xlsx` — A6 و L6 و W6 و AH6
- Verification: Formula inspection plus independent recomputation; Excel recalculation reproduces cached ratios.
- Affects phases: 7, 9; reports: مقارنة المبيعات

<div dir="rtl">

**الموجود حاليًا:** مقارنة أكتوبر يوم 1: «نسبة النمو» 170% (سبتمبر 84,980 ÷ أكتوبر 50,125). مقارنة نوفمبر يوم 1: 173% (نوفمبر ÷ أكتوبر). المقارنة الأسبوعية: «نسبة %» 113% للإجمالي و117% للمعاريف.

**المشكلة:** النمو = (الحالي − السابق) ÷ السابق. الملفات تعرض الحالي ÷ السابق (من غير طرح 1)، وفي أكتوبر السابق ÷ الحالي (مقلوبة). فيوم نزلت فيه المبيعات 41% بيظهر كأنه 170%.

**الدليل:** 1 أكتوبر: 50,125 ÷ 84,980 − 1 = −41.02%. 1 نوفمبر: 86,470 ÷ 50,125 − 1 = +72.51%. الأسبوعي: 136,170 ÷ 120,420 − 1 = +13.08%، والمعاريف 54,510 ÷ 46,485 − 1 = +17.26%.

**التأثير:** كل تقارير المقارنة، والقرارات المبنية على نمو أو تراجع المبيعات.

**المقترح:** البرنامج يعرض عمودين واضحين: «الفرق» = الحالي − السابق، و«النمو %» = الفرق ÷ السابق. ولو السابق صفر أو ناقص يكتب «غير متاح».

**السبب:** ده التعريف المعروف للنمو، ويطابق اختبار الخطة (120 مقابل 100 = نمو 20%).

**مثال:** قبل: 1 أكتوبر مقابل 1 سبتمبر: 170%. — بعد: الفرق −34,855 درهم، النمو −41.02%.

**التحقق:** اختبار: حالي 120 وسابق 100 → فرق 20 ونمو 20%؛ حالي 50,125 وسابق 84,980 → −41.02%.

**مرتبط:** SRC-12: نفس المشكلة في نسبة الإجمالي والقدس والمعاريف وبورجون.

**لو اختار «نُبقي الوضع الحالي»:** نعرض «نسبة الحالي إلى السابق» (مثل 117%) بدل النمو، مع تغيير الاسم ليكون واضحًا.

**سؤال لعبدو:** في المقارنة الأسبوعية: تحب تشوف «نسبة الحالي للسابق» (مثلًا 113%) ولا «نسبة النمو» (13%)؟

</div>

## P1-09

**November comparison shows 0% for unentered days and compares two days with a full month** — مقارنة نوفمبر تعرض نموًا صفرًا لأيام لم تُدخل، وتقارن يومين بشهر كامل

- Status: **Fully verified correction**
- Done: SRC-08/09 D (blank when the current day is not entered) and D37 = SUMIFS like-for-like. Independent: 1 Nov 86,470 / 50,125 - 1 = +72.51%; boundary tests for blank and zero.
- Remaining: None.
- Kind / severity: Confirmed error / Medium
- Locations: SRC-09 `sales-comparison-nov-2026.xlsx` — D8:D36 و D37
- Verification: Independent recomputation from SRC-09 E/F/I/J.
- Affects phases: 7, 9; reports: مقارنة المبيعات

<div dir="rtl">

**الموجود حاليًا:** من 3 إلى 30 نوفمبر الخانة تعرض 0% لأن أرقام نوفمبر لسه ما اتكتبتش. والإجمالي يعرض 7% تقريبًا (يومين نوفمبر 135,165 ÷ أكتوبر كله 2,055,675).

**المشكلة:** يوم غير مُدخل ليس مبيعات صفر. والإجمالي يقارن فترتين غير متساويتين.

**الدليل:** مقارنة نفس الأيام (1 و2 من كل شهر): 135,165 ÷ (50,125 + 65,045) − 1 = +17.36%.

**التأثير:** قراءة أداء الشهر الجاري أثناء الشهر.

**المقترح:** اليوم الناقص يظهر «غير مُدخل» وليس صفرًا. الإجمالي يقارن نفس عدد الأيام من الشهرين (من 1 إلى آخر يوم مُدخل)، ويكتب عدد الأيام المقارنة.

**السبب:** يمنع قراءة غلط للأداء في نص الشهر.

**مثال:** قبل: إجمالي نوفمبر/أكتوبر: 7%. — بعد: 1–2 نوفمبر مقابل 1–2 أكتوبر: +17.36% (يومين من 30).

**التحقق:** اختبار شهر جزئي ويوم ناقص وقيمة سابقة صفر.

**مرتبط:** الملاحظة P1-07 (يوم 31 أكتوبر الناقص).

**لو اختار «نُبقي الوضع الحالي»:** نعرض الأيام غير المدخلة 0% والإجمالي على الشهر كله كما في الملف.

</div>

## P1-10

**Weekly comparison: Bourgogne date duplicated and the total's dates differ from the branches** — المقارنة الأسبوعية: تاريخ بورجون مكرر، وتواريخ الإجمالي لا تطابق الفروع

- Status: **Fully verified correction** — needs Abdo (required for Phase 1)
- Done: Abdo's decision (review answer 2026-11-20): Bourgogne's current figure (28,975 / 374 orders) is for Tuesday 10 Nov; one date pair applies to every branch and the total. SRC-12 copy: E6 9 -> 10 Nov, I6 2 -> 3 Nov, AL6 3 -> 10 Nov (AP6 already 3 Nov). All four date pairs are now Tuesdays, matching their labels; no sales, order or ratio figure changed.
- Remaining: None in the workbooks. Phase 7 uses one date pair per comparison.
- Kind / severity: Conflicting evidence / High
- Locations: SRC-12 `مقارنه يوميه المغرب (3) (1).xlsx` — مبيعات شهر 8!E6 و I6 (الإجمالي)، AL6 و AP6 (بورجون)، P6/T6 و AA6/AE6
- Verification: Weekday computation for 2026 dates; arithmetic of B6/C6/F6/G6. No independent source for Al Quds/Bourgogne figures.
- Affects phases: 7; reports: مقارنة المبيعات

<div dir="rtl">

**الموجود حاليًا:** القدس والمعاريف: الأسبوع الحالي 10 نوفمبر والسابق 3 نوفمبر (ثلاثاء). بورجون: الحالي 3 نوفمبر والسابق 3 نوفمبر. الإجمالي: 9 نوفمبر و2 نوفمبر ومكتوب جنبهم «الثلاثاء» مع إنهم يوم اثنين.

**المشكلة:** إجمالي الأسبوع الحالي 136,170 = القدس 52,685 + المعاريف 54,510 + بورجون 28,975. لو رقم بورجون فعلًا ليوم 3 نوفمبر، يبقى الإجمالي بيجمع أيام مختلفة. ولو هو ليوم 10 نوفمبر، يبقى التاريخ بس هو الغلط. والإجمالي نفسه مكتوب عليه تاريخ مختلف عن الفروع الثلاثة.

**الدليل:** حسبنا أيام الأسبوع: 2 و9 نوفمبر 2026 يوم اثنين، 3 و10 نوفمبر يوم ثلاثاء. أرقام المعاريف ليوم 3 و10 نوفمبر غير موجودة في أي ملف آخر عندنا لنطابقها.

**التأثير:** إجمالي الفروع ونسبته، وشكل شاشة المقارنة في البرنامج.

**المقترح:** البرنامج ياخد تاريخ واحد للفترة الحالية وتاريخ واحد للسابقة، ويطبقهم على كل الفروع، ويحسب الإجمالي من نفس التواريخ فقط. لو فرع ناقص في يوم، الإجمالي يوضح إنه ناقص.

**السبب:** يمنع جمع أيام مختلفة في إجمالي واحد.

**مثال:** قبل: بورجون: الحالي 3/11 والسابق 3/11؛ الإجمالي 9/11 مقابل 2/11. — بعد: كل الفروع والإجمالي: الحالي 10/11 مقابل السابق 3/11 (بعد ما تأكد لنا رقم بورجون الصحيح).

**التحقق:** اختبار: تغيير تاريخ فرع واحد يمنع حساب الإجمالي أو يوضح النقص.

**مرتبط:** قرار مفتوح في الخطة: مصدر أرقام القدس وبورجون ومين يدخلها.

**لو اختار «نُبقي الوضع الحالي»:** نحتفظ بالمثال كما هو كمرجع شكل فقط، من غير ما نستخدم أرقامه في الاختبار.

**سؤال لعبدو:** رقم بورجون 28,975 (374 طلب) ليوم كام؟ وإيه رقم وتاريخ الأسبوع السابق الصحيح؟ وتاريخ الإجمالي (مكتوب 9 و2 نوفمبر يوم اثنين) المقصود بيه الثلاثاء 10 و3 نوفمبر؟

</div>

## P1-11

**Visible errors on empty days and a broken '%' row in Daily Sales** — أخطاء ظاهرة في الأيام الفارغة وصف نسب مكسور في Daily Sales

- Status: **Fully verified correction**
- Done: SRC-02/03 I3:I34, K3:K34 and total row D35/I35/K35 IF-wrapped; broken rows 36-37 (#REF!) cleared. Boundary tests: blank, zero and an empty month.
- Remaining: None.
- Kind / severity: Confirmed error / Low
- Locations: SRC-02 `daily-sales-oct-2026.xlsx` — I33:K34 و B36:K36 و D37:E37; SRC-03 `daily-sales-nov-2026.xlsx` — I5:K34 (62 خلية) و B36:K36
- Verification: Cached error scan + Excel full recalculation (identical results).
- Affects phases: 9; reports: Daily Sales

<div dir="rtl">

**الموجود حاليًا:** الأيام اللي لسه ما اتكتبتش بتظهر فيها #DIV/0! في نسبة الكاش ونسبة الفيزا. صف «%» كله #REF! (مرجع محذوف)، وصف «A / C» فيه قسمة على خانة فاضية.

**المشكلة:** الأخطاء دي تشتت القارئ، وصف «%» لا يمكن معرفة المقصود منه لأن المرجع اتحذف.

**الدليل:** في ملف أكتوبر 16 خلية خطأ، وفي نوفمبر 72 خلية. أعدنا حساب الملفين في Excel وطلعت نفس النتائج.

**التأثير:** شكل التقرير فقط؛ لا يغير أرقام الأيام المكتوبة.

**المقترح:** البرنامج يكتب «غير مُدخل» لليوم الفارغ، ولا ينقل صف «%» ولا صف «A / C» لأن معناهم غير معروف.

**السبب:** تقرير نظيف بدون أخطاء، وما ننقلش معادلة مكسورة.

**مثال:** قبل: 3 نوفمبر: نسبة الكاش #DIV/0!. — بعد: 3 نوفمبر: غير مُدخل.

**التحقق:** فحص ملف Excel الناتج من البرنامج: لا توجد أي خلية خطأ.

**لو اختار «نُبقي الوضع الحالي»:** نحاول نعيد إنتاج صف «%» — ولازم تقول لنا كان بيقسم على إيه.

</div>

## P1-12

**The drawer count is never entered, yet the ledger says 'cash matches'** — الخزينة لا تُعد في الملفات، ومع ذلك مكتوب «الخزينة مطابقة»

- Status: **Future application rule**
- Done: App rule: blank count = 'not counted', explicit zero is a count, and the variance uses the cash expected at the time of the count (P1-13). The legacy ledger O14 message is left as recorded: the prepared rewrite compared the count with the balance after the bank remittance (E45), which P1-13 rules out, so it was withdrawn on 2026-11-21 (62 protected-sheet operations).
- Remaining: Implement in Phase 4.
- Kind / severity: Business rule / High
- Locations: SRC-04/05 `daily-statement-*.xlsx` — كل ورقة يوم: H6:H13 (العدد) و I15 «الاجمالى النقدى» و I17 «اوفركاش او عجز»; SRC-10/11 `daily-ledger-*.xlsx` — كل ورقة يوم: K10:K19 (العد) و M20 و O14
- Verification: All 61 statement day sheets: I15 = 0 (no denomination counts). Ledger: M20 = 0 on all Oct days and 1 Nov; O14 formula returns 'match' when M20 = E45 = 0.
- Affects phases: 4; reports: البيان اليومي، اليومية

<div dir="rtl">

**الموجود حاليًا:** في البيان اليومي خانات عد الفئات فاضية كل الأيام، و«الإجمالي النقدي» = صفر. «أوفر كاش أو عجز» = (صفر + الفيزا + المصروفات شاملة التوريد) − مبيعات السيستم. وفي اليومية العد فاضي في كل أيام أكتوبر ويوم 1 نوفمبر، والخانة بتكتب «الخزينة مطابقة». وأيام 3 إلى 31 نوفمبر فاضية تمامًا ومكتوب برضه «الخزينة مطابقة».

**المشكلة:** النتيجة «مطابقة» أو «أوفر 1» مبنية على افتراض إن كل الكاش اتورد للبنك، مش على عد فعلي. عد غير موجود اتعامل كأنه صفر وصحيح.

**الدليل:** البيان 1 نوفمبر: صفر + 22,275 + 64,196 − 86,470 = +1. في اليومية يوم 2 نوفمبر فقط فيه عد فعلي (36,945)، وكل الأيام الباقية العد = صفر.

**التأثير:** تسوية الخزينة اليومية، وأي تقرير عجز/زيادة.

**المقترح:** في البرنامج: لو العد غير مُدخل، الحالة «لم يتم العد» وليس «مطابقة». العد بصفر لازم يتكتب صراحة. الفرق = المعدود − المتوقع، والمتوقع = رصيد الافتتاح + الكاش المحصل − المصروفات النقدية − التوريد المنفذ قبل وقت العد.

**السبب:** عشان «مطابقة» يبقى معناها إن حد عد فعلًا والرقم طلع صح.

**مثال:** قبل: 1 أكتوبر: لا يوجد عد → «الخزينة مطابقة». — بعد: 1 أكتوبر: «لم يتم العد» (لا يمكن إغلاق اليوم بدون عد أو موافقتك).

**التحقق:** اختبارات: عد مطابق، عجز، زيادة، عد غير مُدخل، وعد بصفر صريح — كل حالة تعطي نتيجة مختلفة وصحيحة.

**مرتبط:** الملاحظة P1-13 (توقيت عد 2 نوفمبر). · الملاحظة P1-04 (التوريد داخل المصروفات).

**لو اختار «نُبقي الوضع الحالي»:** البرنامج يفترض إن كل الكاش بيتورد ويحسب الفرق من غير عد (زي الملفات الحالية).

</div>

## P1-13

**2 November cash count of 36,945: before or after the bank remittance?** — الخزينة بتتعد إمتى: قبل التوريد للبنك ولا بعده؟

- Status: **Future application rule** — needs Abdo (required for Phase 1)
- Done: Abdo's decision (review answer 2026-11-20): the drawer is counted before the bank remittance. App rule: record the count time and the remittance time; expected cash includes only movements before the count; the later remittance posts once and does not change the count variance. 2 Nov reference: expected 36,942 (48,695 - 11,300 - 453), counted 36,945, +3 MAD, equal to the statement over/short (SRC-05 sheet 2 I17 = 3, unchanged). No workbook copy change: the ledger message 'زيادة قيمتها 36945' is on a protected sheet and its prepared rewrite was withdrawn (P1-12).
- Remaining: Implement in Phase 4; the 2 Nov reference test expects +3 MAD.
- Kind / severity: Business rule / High
- Locations: SRC-11 `daily-ledger-nov-2026.xlsx` — ورقة 2: K11:M20 و O14 و E21 و F63; SRC-05 `daily-statement-nov-2026.xlsx` — ورقة 2: D12 و I17
- Verification: Denomination arithmetic re-checked; independent expected-cash calculation under both timings; statement sheet 2 I17 = +3 and ledger sheet 2 E21 = 3.
- Affects phases: 4, 10; reports: اليومية، البيان اليومي

<div dir="rtl">

**الموجود حاليًا:** اليومية يوم 2 نوفمبر: العد 36,945 (200 × 100 + 100 × 169 + 20 × 2 + 5 × 1)، والرسالة «زيادة قيمتها 36945 ريالً». في نفس اليوم التوريد للبنك 36,945، و«أوفر كاش» 3 دراهم مكتوبة في اليومية والبيان.

**المشكلة:** اليومية خصمت التوريد قبل المقارنة، فالمتوقع في الخزينة صفر، والعد 36,945 ظهر كزيادة. لكن العد واضح إنه نفس مبلغ التوريد، يعني غالبًا العد حصل قبل التوريد.

**الدليل:** لو العد قبل التوريد: المتوقع = 48,695 مبيعات − 11,300 فيزا − 453 مصروفات = 36,942 → الفرق +3، وده بالظبط «الأوفر كاش» المكتوب في البيان واليومية. لو العد بعد التوريد: الفرق +36,945، وده غير منطقي.

**التأثير:** طريقة حساب الكاش المتوقع في البرنامج، واختبار يوم 2 نوفمبر.

**المقترح:** نسجل وقت العد ووقت التوريد. المتوقع يشمل فقط الحركات اللي حصلت قبل وقت العد. ونعتبر 2 نوفمبر: العد قبل التوريد، والنتيجة +3.

**السبب:** الحسابين المستقلين (البيان واليومية) طلعوا +3 بالافتراض ده.

**مثال:** قبل: «زيادة قيمتها 36945». — بعد: متوقع 36,942، معدود 36,945، زيادة 3 دراهم.

**التحقق:** اختبار السيناريوهين بأرقام 2 نوفمبر: قبل التوريد → +3، بعد التوريد (لو كان فيه كاش متبقي) → حسب الرصيد الفعلي.

**مرتبط:** الملاحظة P1-12. · عبارة «ريالً» في رسالة الخزينة (العملة درهم) — انظر P1-23.

**لو اختار «نُبقي الوضع الحالي»:** نحسب المتوقع بعد خصم التوريد دائمًا، حتى لو العد حصل قبله (النتيجة هتطلع زيادة 36,945).

**سؤال لعبدو:** الخزينة بتتعد كل يوم؟ وبتتعد قبل التوريد للبنك ولا بعده؟ (مثال 2 نوفمبر: لو قبل التوريد تبقى الزيادة 3 دراهم بس؛ لو بعده تبقى 36,945.)

</div>

## P1-14

**Daily statement over/short formula varies by day; some days are typed values** — معادلة العجز/الزيادة في البيان اليومي مختلفة من يوم ليوم، وبعض الأيام أرقامها مكتوبة باليد

- Status: **Fully verified correction**
- Done: SRC-04/05 every day sheet: I23 = I15+I20+I21, I21 = D28, over/short I17 = IF(ISNUMBER(I25),I23-I25,""); second 'total expenses' line removed. Check: over/short equals the originals' values on every day with system revenue (Oct 8 = +1, 2 Nov = +3).
- Remaining: None.
- Kind / severity: Confirmed error / Medium
- Locations: SRC-04 `daily-statement-oct-2026.xlsx` — I17 في أوراق 3، 4، 6، 9، 10، 11، 25؛ I21/I23 مكتوبة باليد في 10، 13، 28، 30؛ I23 يطرح D15/D16/D17 في 1، 2، 5، 12؛ D30 في كل الأوراق; SRC-05 `daily-statement-nov-2026.xlsx` — نفس الخانات في نفس الأوراق (نفس القالب)
- Verification: Formula pattern comparison across all day sheets; Excel full recalculation identical.
- Affects phases: 4, 9; reports: البيان اليومي

<div dir="rtl">

**الموجود حاليًا:** في أغلب الأيام: العجز/الزيادة = الإجمالي − السيستم. في 7 أيام المعادلة بتطرح كمان خانات من قائمة المصروفات (مثل D15 وD17). في 4 أيام الأرقام مكتوبة باليد بدل المعادلة (مثلًا 13 أكتوبر). وخانة «اجمالى المصروفات» الثانية (D30) = ضعف المصروفات.

**المشكلة:** النتيجة صحيحة حاليًا فقط لأن الخانات المطروحة فاضية. لو اتكتب مصروف في السطر ده، العجز هيتخصم مرتين. والأرقام المكتوبة باليد مش بتتحدث لو اتعدل رقم.

**الدليل:** مثال 3 أكتوبر: I17 = I23 − I25 − D17 − D15 − D16. مثال 1 نوفمبر: D30 = 128,392 = 2 × 64,196. أعدنا حساب الملف في Excel وطلعت نفس النتائج.

**التأثير:** صحة العجز/الزيادة في البيان اليومي.

**المقترح:** البرنامج يستخدم حسابًا واحدًا لكل الأيام من البيانات المحفوظة، ولا ينقل الخانة المكررة D30.

**السبب:** نفس القاعدة كل يوم، ولا يوجد رقم مكتوب باليد في مكان الحساب.

**مثال:** قبل: 13 أكتوبر: العجز/الزيادة = 0 مكتوب باليد. — بعد: 13 أكتوبر: محسوب من المبيعات والفيزا والمصروفات والعد.

**التحقق:** اختبار: إضافة مصروف في أي سطر يغير النتيجة مرة واحدة فقط.

**مرتبط:** الملاحظة P1-12.

**لو اختار «نُبقي الوضع الحالي»:** لا يوجد سلوك قديم واضح نحتفظ به؛ لازم تقول لنا لو الطرح الإضافي كان مقصودًا.

</div>

## P1-15

**7 October statement: system revenue blank, showing a 50,060 overage** — بيان 7 أكتوبر: مبيعات السيستم فاضية فظهرت زيادة 50,060

- Status: **Fully verified correction**
- Done: SRC-04 sheet 7 I25 = 50,060 (Daily Sales B9 and ledger sheet 7 E17 are both 50,060). Over/short blank when I25 is not a number (boundary-tested).
- Remaining: None.
- Kind / severity: Confirmed error / Medium
- Locations: SRC-04 `daily-statement-oct-2026.xlsx` — ورقة 7: I25 و I17
- Verification: SRC-02 B9 and SRC-10 sheet 7 E17 both 50,060.
- Affects phases: 4, 10; reports: البيان اليومي

<div dir="rtl">

**الموجود حاليًا:** خانة «اجمالي الايراد (سيستم)» فاضية، فخانة «اوفركاش او عجز» = 50,060.

**المشكلة:** المبيعات في Daily Sales واليومية لنفس اليوم = 50,060. يعني الزيادة الظاهرة سببها خانة ناقصة، والفرق الحقيقي صفر.

**الدليل:** 13,340 فيزا + 36,720 مصروفات (شاملة التوريد) = 50,060 = مبيعات اليوم.

**التأثير:** بيان 7 أكتوبر، وأي مجموع شهري للعجز/الزيادة.

**المقترح:** في البرنامج لا يتم إغلاق اليوم إلا لو مبيعات السيستم مكتوبة. وفي بيانات الاختبار نستخدم 50,060.

**السبب:** مصدرين مستقلين بنفس الرقم.

**مثال:** قبل: زيادة 50,060. — بعد: فرق صفر (قبل إدخال العد).

**التحقق:** محاولة إغلاق يوم بدون مبيعات السيستم ترجع رسالة «ناقص».

**لو اختار «نُبقي الوضع الحالي»:** نستخدم البيان كما هو (زيادة 50,060).

</div>

## P1-16

**Daily statement sheets: wrong dates, a missing day, and leftover figures from earlier months** — أوراق البيان اليومي: تواريخ غلط، يوم ناقص، وأرقام قديمة من شهور سابقة

- Status: **Fully verified correction**
- Done: SRC-04/05 I3 dates; 29 Oct rebuilt from ledger sheet 29 and Daily Sales row 31 (a reconstruction, not an original statement); empty 27 Nov; stale Nov values cleared; stray sheets 1648/564/31/FeuilN/Chart1 deleted; SRC-05 sheet 10 P3:V32 leftover block cleared (no references). Hidden 'Sheet1' kept: a blank day template with standard formulas that nothing refers to.
- Remaining: None.
- Kind / severity: Confirmed error / Medium
- Locations: SRC-04 `daily-statement-oct-2026.xlsx` — ورقة 10 (I3=10 سبتمبر)، ورقة 23 (I3=24 أكتوبر)، ورقة 26 (I3=27 أكتوبر)، لا توجد ورقة 29، أوراق 1648 و Feuil1-8، وSheet1 مخفية; SRC-05 `daily-statement-nov-2026.xlsx` — أوراق 3-30 (I3=1 سبتمبر)، أرقام في 10 و13 و29 و30، ورقة 31 (يوليو وفرع ليبيا)، ورقة 564
- Verification: Per-sheet I3 date and values cross-matched with SRC-02/03 and SRC-10/11 by amount.
- Affects phases: 9, 10; reports: البيان اليومي

<div dir="rtl">

**الموجود حاليًا:** أكتوبر: ورقة يوم 10 تاريخها 10 سبتمبر، ورقة 23 تاريخها 24 أكتوبر (وأرقامها لـ23)، ورقة 26 تاريخها 27 (وأرقامها لـ26)، وورقة يوم 29 غير موجودة. نوفمبر: الأوراق 3 إلى 30 تاريخها 1 سبتمبر، وفيها أرقام قديمة (مثلًا ورقة 29: 102,380 = مبيعات 29 سبتمبر). ورقة 31 في نوفمبر نموذج قديم ليوليو ولفرع آخر، وتعرض عجزًا −72,835.

**المشكلة:** التاريخ المكتوب على الورقة لا يطابق اليوم، وفيه أرقام من شهر سابق ممكن تتقري كأنها أرقام نوفمبر.

**الدليل:** طابقنا أرقام كل ورقة مع Daily Sales واليومية لنفس اليوم: ورقة 23 = 71,335 (مبيعات 23 أكتوبر) وورقة 26 = 42,205 (26 أكتوبر). مبيعات 29 أكتوبر (50,855) موجودة في Daily Sales واليومية فقط.

**التأثير:** أي تجميع شهري من البيان، والأيام المرجعية للاختبار.

**المقترح:** في البرنامج كل يوم له سجل واحد بتاريخه، والتقرير يتولد منه، فلا يوجد أوراق نسخ. وبيانات الاختبار تعتمد التاريخ حسب الأرقام (ورقة 23 = 23 أكتوبر، 26 = 26 أكتوبر).

**السبب:** التاريخ يجي من يوم العمل نفسه مش من نسخ ورقة.

**مثال:** قبل: ورقة «29» في نوفمبر: 102,380 بتاريخ 1 سبتمبر. — بعد: 29 نوفمبر: فارغ لحد ما يتسجل اليوم فعلًا.

**التحقق:** تقرير شهر يعرض كل يوم مرة واحدة بالتاريخ الصحيح، ويظهر الأيام غير المسجلة.

**مرتبط:** الملاحظة P1-23 (عناوين وتواريخ قديمة في باقي الملفات).

**لو اختار «نُبقي الوضع الحالي»:** نترك التواريخ كما هي في بيانات الاختبار.

</div>

## P1-17

**Purchasing-custody balance is not carried forward day to day** — رصيد عهدة المشتريات لا ينتقل من يوم لليوم اللي بعده

- Status: **Future application rule**
- Done: App rule: opening = previous day's closing. Ledger E86/E87 carry-forward prepared: ledger day sheets are password-protected; their changes are prepared in fix-plan.json and not applied.
- Remaining: Ledger copy needs the sheet password (project owner).
- Kind / severity: Confirmed error / High
- Locations: SRC-10 `daily-ledger-oct-2026.xlsx` — أوراق 2-31: E87 (رصيد أمس) و E90 (رصيد اليوم) و C52 و E86; SRC-11 `daily-ledger-nov-2026.xlsx` — نفس الخانات
- Verification: Normalised formula comparison across day sheets (E87 always references sheet '1'); 30 cached #VALUE! per workbook in E90; Excel recalculation identical.
- Affects phases: 4; reports: اليومية

<div dir="rtl">

**الموجود حاليًا:** في كل يوم من 2 إلى 31: «رصيد أمس» للعهدة بيقرأ دايمًا رصيد يوم 1، مش اليوم اللي قبله. و«رصيد اليوم» بيطلع خطأ #VALUE! في 30 ورقة في كل ملف.

**المشكلة:** لو بقي فلوس في العهدة في أي يوم بعد يوم 1، مش هتظهر في اليوم التالي. والخطأ #VALUE! سببه إن خانات أسماء القائم بالجرد والكاشير في جزء العهدة فاضية، فالمجموع بيتحول لنص فاضي.

**الدليل:** E87 في ورقة 3 = '1'!E89، وفي ورقة 31 = '1'!E89 برضه. وفي الأوراق 2-31 الصف 89 هو «المنصرف» والرصيد في الصف 90. أعدنا حساب الملفين في Excel: نفس النتيجة.

**التأثير:** رصيد عهدة المشتريات اليومي والشهري.

**المقترح:** البرنامج يحسب رصيد افتتاح كل دفتر (الخزينة والعهدة) = رصيد إغلاق نفس الدفتر في اليوم السابق، والرصيد يظهر رقمًا حتى لو لسه ما اتسجلش اسم الموظف (مع تنبيه).

**السبب:** ده المطلوب في الخطة: كل دفتر ينقل رصيده لليوم التالي.

**مثال:** قبل: يوم 5: رصيد أمس = رصيد يوم 1؛ رصيد اليوم = #VALUE!. — بعد: يوم 5: رصيد أمس = رصيد إغلاق يوم 4؛ رصيد اليوم رقم.

**التحقق:** اختبار يومين متتاليين: رصيد إغلاق اليوم الأول = افتتاح الثاني لكل دفتر.

**مرتبط:** الملاحظة P1-18 (أيام 22-24). · الملاحظة P1-19 (أسماء الموظفين).

**لو اختار «نُبقي الوضع الحالي»:** لا يوجد سلوك صحيح نحتفظ به هنا؛ الاختيار ده معناه نقل نفس الخطأ.

</div>

## P1-18

**Ledger days 22-24 are chained out of order; the summary swaps days 22 and 23** — اليومية: أيام 22 و23 و24 مربوطة بترتيب غلط، والملخص عاكس يومي 22 و23

- Status: **Partial correction**
- Done: Summary D26:E27 now read sheets 22/23 for the rows labelled 22/23 (applied; the summary is unprotected). Day-sheet chaining G4/E42 on sheets 22-24: ledger day sheets are password-protected; their changes are prepared in fix-plan.json and not applied. App derives chronological order.
- Remaining: Day-sheet chaining needs the sheet password (project owner).
- Kind / severity: Confirmed error / Medium
- Locations: SRC-10 `daily-ledger-oct-2026.xlsx` — أوراق 22 و23 و24: G4 و E42؛ ملخص!D26:E27; SRC-11 `daily-ledger-nov-2026.xlsx` — نفس الخانات
- Verification: Normalised formula comparison (G4/E42 offsets +1/-2/-2) and summary D26/D27 sheet references; values matched against SRC-02.
- Affects phases: 4, 9; reports: اليومية

<div dir="rtl">

**الموجود حاليًا:** ورقة 22 بتاخد التاريخ ورصيد أمس من ورقة 23، وورقة 23 من ورقة 21، وورقة 24 من ورقة 22. في الملخص، سطر يوم 22 بيقرأ ورقة 23 وسطر يوم 23 بيقرأ ورقة 22.

**المشكلة:** الرصيد بيتنقل 21 ← 23 ← 22 ← 24، وتاريخ ورقة 22 بيطلع بعد ورقة 23. والملخص بيعرض مبيعات 22 أكتوبر في سطر 23 والعكس.

**الدليل:** ملخص أكتوبر: سطر 22 = 71,335 وسطر 23 = 78,000، بينما Daily Sales: 22 أكتوبر = 78,000 و23 أكتوبر = 71,335. الأرقام نفسها في الأوراق الصحيحة؛ الخطأ في الربط فقط.

**التأثير:** ترحيل الرصيد وتاريخ الأيام 22-24، وملخص الشهر.

**المقترح:** البرنامج يرتب الأيام بالتاريخ ويربط كل يوم باليوم السابق له في التقويم تلقائيًا.

**السبب:** مفيش ربط يدوي بين أوراق، فالخطأ ده ما يتكررش.

**مثال:** قبل: ملخص أكتوبر سطر 22: 71,335. — بعد: سطر 22: 78,000؛ سطر 23: 71,335.

**التحقق:** اختبار ترحيل على 3 أيام متتالية يطابق ترتيب التقويم.

**مرتبط:** الملاحظة P1-17.

**لو اختار «نُبقي الوضع الحالي»:** لا ينطبق؛ هذا خطأ ربط.

</div>

## P1-19

**The ledger records no business date, branch, cashier or cash counter** — اليومية لا تسجل التاريخ ولا الفرع ولا اسم الكاشير ومن عد الخزينة

- Status: **Future application rule** — needs Abdo (before Phase 4)
- Done: App rule: date, branch, user, counter and role recorded; placeholders rejected. Ledger G4/C4/C6/C53 prepared: ledger day sheets are password-protected; their changes are prepared in fix-plan.json and not applied.
- Remaining: Abdo: who counts and whether it must differ from the cashier (before Phase 4). Ledger copy needs the password.
- Kind / severity: Business rule / Medium
- Locations: SRC-10/11 `daily-ledger-*.xlsx` — ورقة 1: G4 (التاريخ) و C4 (الفرع) فاضيين؛ كل الأوراق: L8 و N8 و Q8 (أسماء نموذجية)، C6 و C53 (رقم القيد)، I25:J55
- Verification: Full read of ledger day sheets; G4 chain from blank '1'!G4; C5/C52 checks satisfied by placeholder text.
- Affects phases: 3, 4; reports: اليومية

<div dir="rtl">

**الموجود حاليًا:** تاريخ يوم 1 فاضي، فكل التواريخ بتطلع سنة 1900. الفرع فاضي فبيظهر «فرع/ 0». خانات «القائم بالجرد» و«الكاشير» فيها الكلام النموذجي «اسم القائم بالجرد» و«اسم الكاشير»، ووظيفته «مساعد مدير». رقم القيد في كل الأيام = 2. وجدول الإلغاءات مكتوب فيه فرع 0 وتاريخ في كل سطر حتى لو مفيش إلغاء.

**المشكلة:** الملف لا يثبت مين عد ومين استلم، ولا لأي يوم. وفحص «أدخل بيانات القائم بالجرد والكاشير» بيعدي لأن الكلام النموذجي مش فاضي.

**الدليل:** قرأنا كل الأوراق: لا يوجد اسم شخص حقيقي في خانات الكاشير أو القائم بالجرد في الملفين.

**التأثير:** المسؤولية والمراجعة في التقفيل اليومي.

**المقترح:** البرنامج يسجل تلقائيًا: التاريخ، الفرع، المستخدم اللي أدخل التقفيل، ومين عد الخزينة ووظيفته وقت العد. ولا يقبل الكلام النموذجي كاسم.

**السبب:** ده مطلوب في متطلبات اليومية، وبيخلي أي فرق قابل للمراجعة.

**مثال:** قبل: «فرع/ 0» — 1900-01-01 — «اسم الكاشير». — بعد: المعاريف — 2 نوفمبر 2026 — الكاشير: (المستخدم) — العد: (الموظف ووظيفته).

**التحقق:** محاولة حفظ تقفيل بدون اسم من عد الخزينة ترجع رسالة.

**مرتبط:** الملاحظة P1-17 (خطأ #VALUE! بسبب نفس الخانات في جزء العهدة).

**لو اختار «نُبقي الوضع الحالي»:** البرنامج يسمح بالتقفيل بدون اسم من عد الخزينة.

**سؤال لعبدو:** مين عادةً بيعد الخزينة؟ وهل لازم يكون شخص غير الكاشير؟

</div>

## P1-20

**Ledger summary: cancellations column reads the wrong cells and detail rows are skipped** — ملخص اليومية: عمود الإلغاءات بيقرأ خانات غلط، والتفاصيل ناقصة سطور

- Status: **Partial correction**
- Done: Summary J5:J35 = SUM('n'!N25:N55) (cancellation table rows 25-55), J37 total; #REF! on day 4 removed (applied). The legacy detail list (summary M:Q, rows 17-38 only) is not corrected; the app derives summaries from saved entries.
- Remaining: Legacy detail list left as is; app rule in Phase 4.
- Kind / severity: Confirmed error / Medium
- Locations: SRC-10/11 `daily-ledger-*.xlsx` — ملخص (مخفية): J5:J37، J8، L4:P498
- Verification: Formula inspection of hidden 'ملخص' sheet; cached #REF! at J8/J37 in both workbooks.
- Affects phases: 4, 9; reports: اليومية

<div dir="rtl">

**الموجود حاليًا:** عمود «قيمة الأوردرات اللاغية» في الملخص بيقرأ خانة واحدة من كل يوم (L47 أو L49) وهي خانة «وقت الإلغاء» لسطر معين، مش مجموع قيم الإلغاءات. سطر يوم 4 = #REF!، فالإجمالي #REF!. وقائمة تفاصيل القيود بتاخد من كل يوم سطور 17-29 و34 و35 و38 فقط.

**المشكلة:** إجمالي الإلغاءات في الملخص لا يمكن يكون صحيح. وأي قيد مكتوب في سطور 30-33 أو 36 أو 37 أو 39 أو 40 مش هيظهر في الملخص.

**الدليل:** جدول الإلغاءات في ورقة اليوم: الأعمدة I إلى S (القيمة في العمود N). الملخص بيقرأ العمود L. ويوم 1 بياخد سطور 17-32 بينما باقي الأيام بتاخد مجموعة مختلفة.

**التأثير:** ملخص الشهر وإجمالي الإلغاءات.

**المقترح:** البرنامج يحسب الملخص من كل القيود والإلغاءات المحفوظة (مجموع قيم الإلغاءات، عددها، وتفاصيل كل قيد) بدل ما ينقل خانات.

**السبب:** الملخص لازم يتحسب من القيود نفسها حسب الخطة، مش من خانات منسوخة.

**مثال:** قبل: إجمالي الإلغاءات: #REF!. — بعد: إجمالي الإلغاءات: مجموع قيمة الأوردرات الملغاة المسجلة في الشهر (وعددها).

**التحقق:** اختبار: إلغاءين بقيمة 50 و30 → الملخص 80 وعدد 2؛ قيد في أي سطر يظهر في التفاصيل.

**لو اختار «نُبقي الوضع الحالي»:** لا ينطبق؛ هذا خطأ مرجع.

</div>

## P1-21

**Hidden legacy sheets in the ledger contain errors and a 2017 external link** — أوراق مخفية قديمة في اليومية فيها أخطاء وربط بملف خارجي من 2017

- Status: **Partial correction**
- Done: External 2017 link broken (3 cells in 'دليل التصنيف' keep their cached values); SRC-11 hidden journal Sheet1!H6 = '1'!F20 (row 6 = day-1 VISA row; neighbours read F19/F21; October already did) -> journal difference 0 instead of -64,195. Day-sheet G90 and sheet 16 A19:A24: ledger day sheets are password-protected; their changes are prepared in fix-plan.json and not applied.
- Remaining: Remaining ledger cells need the password. Hidden sheets are not carried into the app.
- Kind / severity: Confirmed error / Low
- Locations: SRC-10/11 `daily-ledger-*.xlsx` — Sheet1 (مخفية): H6 و Q2:S2 و F679:G680 و F1000:F1003؛ دليل التصنيف (مخفية): I3 و E5 و G53 و G56؛ G90 في أوراق الأيام
- Verification: Formula inspection; external link target recorded in source-inventory.json; links not refreshed during recalculation.
- Affects phases: 4, 9; reports: اليومية

<div dir="rtl">

**الموجود حاليًا:** ورقة قيود مخفية (Sheet1) بتجمع كل القيود: سطر الفيزا ليوم 1 بيقرأ مبيعات الصباح 86,470 بدل الفيزا 22,275، والرصيد الدفتري −64,195 مقابل فعلي صفر، وفيها #REF!. ورقة «دليل التصنيف» المخفية مربوطة بملف خارجي على جهاز قديم (يوميات فروع 2017 — بيتزا)، وفيها #VALUE!. وخانة كشف أخطاء الإدخال (G90) فيها خطأ كتابة بيعلّم سطر 63 كخطأ في أيام سليمة.

**المشكلة:** الأوراق دي غير ظاهرة لكن أرقامها غلط، والملف الخارجي مش متاح.

**الدليل:** Sheet1!H6 = '1'!E9 (مبيعات الصباح). G90 فيها شرط AND(F63<>0,F63<>0) بيقارن الخانة بنفسها، فعلّم سطر 63 في 9 و14 و31 أكتوبر و2 نوفمبر.

**التأثير:** لا يوجد أثر على الأرقام الظاهرة، لكن ممكن حد يعتمد على الأوراق المخفية.

**المقترح:** لا ننقل الأوراق المخفية للبرنامج. سجل القيود والتصنيف يتحسبوا من القيود المحفوظة.

**السبب:** الأوراق دي من قالب قديم لفرع آخر، وأرقامها غير صحيحة.

**مثال:** قبل: سطر الفيزا في دفتر القيود المخفي: 86,470. — بعد: سجل القيود في البرنامج: الفيزا 22,275 (من القيد نفسه).

**التحقق:** تقرير القيود في البرنامج يطابق مجموع الوارد والمنصرف في الأيام.

**مرتبط:** الملاحظة P1-22 (أكواد الحسابات في ورقة Ref_).

**لو اختار «نُبقي الوضع الحالي»:** نعيد إنتاج دفتر القيود المخفي في التقارير (بعد تصحيح أخطائه).

</div>

## P1-22

**Expense/account code lists exist but are not used** — قائمة أكواد المصروفات موجودة لكن غير مستخدمة

- Status: **Future application rule**
- Done: App seeds expense categories from Ref_; Abdo edits them as admin.
- Remaining: Implement in Phase 4.
- Kind / severity: Business rule / Medium
- Locations: SRC-10/11 `daily-ledger-*.xlsx` — Ref_ (مخفية): D5:E41 (أكواد المشتريات) و D50:E67 (أكواد الخزينة)؛ عمود B «كود الحساب» في أوراق الأيام
- Verification: Defined names Cash_codes/Purch_codes inspected; column B in day sheets contains only lookup formulas returning blank.
- Affects phases: 4, 5; reports: اليومية، البيان اليومي

<div dir="rtl">

**الموجود حاليًا:** في الملف قائمة أكواد للمصروفات (مثل «أدوات مكتبية وتصوير ورق»، «إكراميات») وقائمة خيارات للخزينة (مثل «عجز كاشير»). لكن في الأيام، القيود مكتوبة بالوصف فقط («انتقالات»، «شراء مياه») من غير كود.

**المشكلة:** من غير تصنيف ثابت لا يمكن عمل ملخص موثوق للمصروفات حسب النوع.

**الدليل:** عمود «كود الحساب» فارغ في كل القيود في الملفين.

**التأثير:** ملخص المصروفات الشهري حسب النوع.

**المقترح:** نستخدم القائمتين كبداية لتصنيفات المصروفات في البرنامج، وتراجعها أنت قبل التشغيل (تحذف وتضيف). كل مصروف يتسجل باختيار تصنيف + وصف حر.

**السبب:** التصنيف من قائمة يمنع اختلاف الكتابة («انتقالات» و«انتقال») ويسهل الملخص.

**مثال:** قبل: «انتقالات فريق التصوير» — 100 (بدون كود). — بعد: تصنيف: انتقالات — وصف: فريق التصوير — 100.

**التحقق:** ملخص الشهر حسب التصنيف = مجموع المصروفات.

**لو اختار «نُبقي الوضع الحالي»:** المصروفات تتسجل بالوصف الحر فقط بدون تصنيف.

</div>

## P1-23

**Stale template labels and dates across the workbooks** — عناوين وتواريخ قديمة متبقية من قوالب سابقة في أغلب الملفات

- Status: **Partial correction**
- Done: Sheet names (SRC-08/09/12), P3 'Last Updated' (SRC-06/13), الوارد/الأنحرافات E5:AI5 dates (each column reads day sheet 1-31), stray cells in SRC-12, ledger summary A1 (applied). Ledger O14 'ريال' message on day sheets: ledger day sheets are password-protected; their changes are prepared in fix-plan.json and not applied. 2017 dates in the hidden summary list L4:L498 left as is (legacy, not used by the app).
- Remaining: Ledger day-sheet labels need the password.
- Kind / severity: Confirmed error / Low
- Locations: SRC-08/09 `sales-comparison-*.xlsx` — اسم الورقة «مبيعات شهر 6»; SRC-12 `مقارنه يوميه المغرب (3) (1).xlsx` — اسم الورقة «مبيعات شهر 8»، C18:C19 و AZ3; SRC-06/07, LOC-01 `inventory-*.xlsx` — P3 «Last Updated 1/11/ 2025»؛ الوارد!E5:AI5 و الأنحرافات!E5:AI5 (يناير 2026); SRC-10/11 `daily-ledger-*.xlsx` — ملخص!A1 «يومية رقم 7» و L4:L498 (يونيو 2017)؛ O14 «ريالً»
- Verification: Manual read of header cells and sheet names in every workbook.
- Affects phases: 9; reports: كل التقارير

<div dir="rtl">

**الموجود حاليًا:** أسماء أوراق بشهور غلط (يونيو وأغسطس)، «آخر تحديث» 2025 في ملفات الجرد، تواريخ يناير 2026 فوق أعمدة أيام شهر الجرد، تواريخ 2017 في ملخص اليومية، والعملة «ريال» في رسالة الخزينة مع إن العملة درهم.

**المشكلة:** العناوين دي ممكن تلخبط أي حد بيقرأ التقرير، ومش بتوصف البيانات.

**الدليل:** قرأنا العناوين والتواريخ في كل الأوراق وقارناها بالأرقام اللي تحتها.

**التأثير:** شكل التقارير فقط.

**المقترح:** البرنامج يولد العناوين والتواريخ والعملة (درهم) تلقائيًا من الفترة المختارة.

**السبب:** مفيش كتابة يدوية للعناوين، فمفيش عناوين قديمة.

**مثال:** قبل: ورقة «مبيعات شهر 6» لمقارنة سبتمبر/أكتوبر. — بعد: «مقارنة مبيعات المعاريف — أكتوبر 2026 مقابل سبتمبر 2026».

**التحقق:** مراجعة عناوين كل تقرير ناتج مع الفترة المختارة.

**مرتبط:** الملاحظة P1-07 (عنوان سبتمبر في Daily Sales أكتوبر). · الملاحظة P1-16.

**لو اختار «نُبقي الوضع الحالي»:** نحتفظ بنفس أسماء الأوراق والعناوين القديمة في ملفات Excel الناتجة.

</div>

## P1-24

**An item not counted on a day opens the next day at zero and shows a false deviation** — الصنف اللي ما اتعدش في يوم بيبدأ اليوم التالي من صفر، ويظهر له انحراف وهمي

- Status: **Fully verified correction** — needs Abdo (before Phase 6)
- Done: SRC-06/13: P = IF(prev AC="",prev AB,prev AC); AD = IF(AC="","",AC-AB); AE = N(AD)+prev AE. Independent: 51 cases (Oct 33, Nov 18) where an uncounted item with positive book stock was consumed the next day with no receipt, so a blank count is not zero stock. Boundary-tested (blank vs explicit 0).
- Remaining: Abdo: count cadence per item (before Phase 6).
- Kind / severity: Business rule / High
- Locations: SRC-06 `inventory-oct-2026.xlsx` — أوراق الأيام: P (أول المدة = الجرد الفعلي لليوم السابق) و AC و AD و AE; SRC-07 / LOC-01 `inventory-nov-2026*.xlsx` — نفس الأعمدة
- Verification: Scripted scan of every inventory row/day (scripts/phase1/inventory_checks.py): AC blank & AB≠0 ⇒ AD = −AB; next day's P formula reads blank AC ⇒ 0.
- Affects phases: 6; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** «أول المدة» لكل صنف = «الجرد الفعلي» لليوم السابق. في اليوم الواحد بيتعد حوالي 28 إلى 45 صنف فقط من 224. الصنف اللي ما اتعدش: «الانحراف» = سالب الرصيد الدفتري، وفي اليوم التالي «أول المدة» = صفر.

**المشكلة:** الصنف ما اختفاش من الفرع لأنه ما اتعدش. الطريقة دي بتعمل انحرافات غير حقيقية وبتصفّر الرصيد.

**الدليل:** أكتوبر: 1,097 مرة صنف بدأ يومه من صفر بعد يوم بدون عد، و1,137 خانة انحراف وهمي. نوفمبر (النسخة الأحدث، 1-14): 536 و539. مثال 1 نوفمبر: «ايس كريم فستق جيلاتوتي بالفياسكة» رصيده الدفتري 4 وما اتعدش → انحراف −4، ويوم 2 يبدأ من 0.

**التأثير:** كل أرصدة المخزون والانحرافات وأي طلبية مبنية على الرصيد.

**المقترح:** في البرنامج: الصنف اللي ما اتعدش يكمل برصيده الدفتري، ويظهر «آخر عد: تاريخ كذا»، والانحراف يتحسب فقط لما يحصل عد. العد بصفر يتكتب صراحة.

**السبب:** كده الرصيد يفضل صحيح بين أيام العد، والانحراف يبقى حقيقي.

**مثال:** قبل: 1/11: دفتري 4، بدون عد → انحراف −4؛ 2/11 أول المدة 0. — بعد: 1/11: دفتري 4، «لم يُعد» بدون انحراف؛ 2/11 أول المدة 4.

**التحقق:** اختبار الخطة: 10 افتتاح + 5 وارد − 4 استهلاك = 11 متوقع؛ عد 10 → انحراف −1. ويوم بدون عد يكمل بـ11.

**مرتبط:** الملاحظة P1-25 (ورقة Total). · الملاحظة P1-33 (أرصدة أول نوفمبر).

**لو اختار «نُبقي الوضع الحالي»:** البرنامج يعمل زي الملف: بدون عد = صفر وانحراف.

**سؤال لعبدو:** إيه الأصناف اللي بتتعد كل يوم، وإيه اللي بتتعد أسبوعيًا أو شهريًا؟

</div>

## P1-25

**The monthly Total sheet compares the month's balance with the day-31 count even when blank** — ورقة الإجمالي الشهري للجرد بتقارن رصيد الشهر بجرد يوم 31 حتى لو فاضي

- Status: **Fully verified correction**
- Done: SRC-06/13 Total!AD = '31'!AE (cumulative; days without a count carry). Boundary-tested.
- Remaining: None.
- Kind / severity: Confirmed error / High
- Locations: SRC-06/07, LOC-01 `inventory-*.xlsx` — Total!AC (= '31'!AC) و AD و W و I
- Verification: Independent period roll-forward from LOC-01 days 1-13 (P, Q, V, X, Y, Z, AA, R) vs count on day 13; matches the day-13 cumulative AE; Total!AD differs.
- Affects phases: 6, 9; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** في ورقة Total: «الجرد الفعلي» = جرد يوم 31. في نسخة نوفمبر الأحدث (لحد 13 نوفمبر) جرد يوم 31 فاضي، فالانحراف الشهري = سالب الرصيد كله. وعمود «نسبة الفاقد» بيجمع النسب اليومية.

**المشكلة:** الانحراف الشهري بيطلع غلط طول ما الشهر ما خلصش، أو لو يوم 31 ما اتعدش. وجمع النسب اليومية لا يعطي نسبة الشهر.

**الدليل:** أيس كريم (1-13 نوفمبر): أول المدة 45 + وارد 116.4 − استهلاك 71.02 = 90.38 كجم، والعد يوم 13 = 67 → الانحراف −23.38 كجم (نفس رقم «الانحراف التراكمي» يوم 13). ورقة Total تعرض −90.38. سانكوريتا صغير: Total تعرض −6 والصحيح +3. وفي أكتوبر Total تعرض للأيس كريم انحراف +107.34 كجم بسبب مشكلة P1-24.

**التأثير:** تقرير الانحراف الشهري للجرد.

**المقترح:** البرنامج يحسب الانحراف للفترة اللي تختارها، بين آخر عد قبلها وآخر عد داخلها، ويكتب تاريخ العد المستخدم. نسبة الفاقد = إجمالي الفاقد ÷ إجمالي الاستهلاك للفترة.

**السبب:** الانحراف لازم يقارن عد حقيقي برصيد في نفس اللحظة.

**مثال:** قبل: أيس كريم، الشهر: −90.38 كجم. — بعد: أيس كريم، 1-13 نوفمبر: −23.38 كجم (عد 13 نوفمبر).

**التحقق:** اختبار فترة جزئية: الانحراف = آخر عد − الرصيد الدفتري في نفس اليوم.

**مرتبط:** الملاحظة P1-24. · Total!I8: #DIV/0! لأن مبالغ Product Mix فاضية (P1-27).

**لو اختار «نُبقي الوضع الحالي»:** نحسب الانحراف الشهري من جرد آخر يوم في الشهر فقط.

</div>

## P1-26

**Symbols typed into quantity cells ('\', '?') cause error chains** — رموز مكتوبة مكان الكميات («\» و«؟») ونتج عنها أخطاء متسلسلة

- Status: **Fully verified correction**
- Done: SRC-06 7!F97 '\' cleared; SRC-13 3!U564 formula restored to the column pattern.
- Remaining: None.
- Kind / severity: Confirmed error / Low
- Locations: SRC-06 `inventory-oct-2026.xlsx` — ورقة 7: F97 (توفي كراميل) → H97 و H99 و I701 و M676; LOC-01 `شيت جرد ... نوفمبر 2026 (2).xlsx` — ورقة 3: U564 → AE564 في أوراق 3-31، والأنحرافات!G564 و AJ564
- Verification: Text-in-number scan of entry columns; non-#DIV/0! error chains traced to F97 and U564.
- Affects phases: 6; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** في جرد 7 أكتوبر مكتوب «\» بدل كمية «توفي كراميل»، فطلع #VALUE! في نسبة القسم وفي حساب الوصفة. وفي نسخة نوفمبر الأحدث يوم 3 مكتوب «؟» في خانة «الرصيد المتاح» لسطر فاضي، فالخطأ انتقل لكل الأيام لحد 31 ولورقة الانحرافات.

**المشكلة:** Excel بيقبل أي نص مكان الرقم، والخطأ بينتشر في خانات تانية.

**الدليل:** 4 خلايا خطأ في أكتوبر و33 في نسخة نوفمبر الأحدث، كلها راجعة للخانتين دول.

**التأثير:** بسيط في الأرقام (منتج واحد في يوم واحد، وسطر فاضي)، لكنه بيبين إن الإدخال لازم يتحقق منه.

**المقترح:** البرنامج يقبل أرقام فقط في الكميات، ويرفض الرموز برسالة واضحة. لو الكمية مش معروفة تتساب «غير مُدخل».

**السبب:** يمنع انتشار الخطأ من خانة لخانة.

**مثال:** قبل: كمية: «\» → #VALUE!. — بعد: كمية: رسالة «اكتب رقمًا أو اتركها غير مُدخلة».

**التحقق:** اختبار إدخال «؟» في كمية يرجع رسالة ولا يحفظ.

**لو اختار «نُبقي الوضع الحالي»:** لا ينطبق.

</div>

## P1-27

**Product Mix amounts are never entered, so sold items cannot be reconciled to sales** — مبالغ Product Mix غير مُدخلة، فلا يمكن مطابقة الأصناف المباعة مع المبيعات

- Status: **Future application rule**
- Done: App rule: record qty and amount, reconcile to net sales. Copies: Product Mix share columns H/I blank instead of #DIV/0! (display only; amounts were never entered).
- Remaining: Implement in Phase 5.
- Kind / severity: Business rule / Medium
- Locations: SRC-06/07, LOC-01 `inventory-*.xlsx` — أوراق الأيام: G (Total) فاضي و I (T.Price %) = #DIV/0!
- Verification: Count of numeric entries in column G (rows 8-600) across all day sheets = 0; #DIV/0! distribution by column.
- Affects phases: 6; reports: الجرد والطلبية، Daily Sales

<div dir="rtl">

**الموجود حاليًا:** في ملفات الجرد بيتكتب عدد كل صنف مباع فقط (عمود Qty). عمود المبلغ فاضي في كل الأيام، فنسبة القيمة بتطلع #DIV/0! في 18,912 خلية في كل ملف.

**المشكلة:** تقرير Foodics فيه المبلغ لكل سطر. من غير المبلغ مش هنعرف نتأكد إن الأصناف المكتوبة مجموعها = صافي مبيعات اليوم.

**الدليل:** صفر خانات مبلغ مكتوبة في أكتوبر و1-13 نوفمبر. ويوم 7 نوفمبر لو كانت المبالغ مكتوبة كان فرق الـ67 قطعة (P1-29) هيظهر فورًا.

**التأثير:** مطابقة Product Mix مع المبيعات قبل حساب الاستهلاك.

**المقترح:** البرنامج ياخد الكمية والمبلغ لكل سطر (زي تقرير Foodics)، ويطابق مجموع المبالغ مع صافي المبيعات قبل ترحيل الاستهلاك، ويعرض الفرق لو موجود.

**السبب:** مطابقة بسيطة تكشف أخطاء الإدخال قبل ما تأثر على المخزون.

**مثال:** قبل: 7 نوفمبر: 2,249 قطعة، بدون مبالغ، بدون مطابقة. — بعد: 7 نوفمبر: مجموع المبالغ 100,605 = صافي المبيعات ✓ (أو تنبيه بالفرق).

**التحقق:** اختبار: Product Mix ناقص سطر → تنبيه بالفرق في المبلغ.

**مرتبط:** الملاحظة P1-29. · ملاحظة الخطة: لا تجمع إجمالي القسم مع سطوره.

**لو اختار «نُبقي الوضع الحالي»:** نسجل الكمية فقط بدون مبلغ ولا مطابقة.

</div>

## P1-28

**Product sections and names in the inventory workbook differ from Foodics** — أقسام وأسماء الأصناف في ملف الجرد مختلفة عن Foodics

- Status: **Deferred to a later phase** — needs Abdo (before Phase 5)
- Done: Deferred to Phase 5 catalog mapping. SRC-13 D202 named 'جيلاتيتو روما بيكان' (the workbook's own pecan recipe rows read $F$202). Other section and name differences remain, e.g. the chocolate Dubai cake: Foodics 'كبير' vs workbook 'صغيرة' (109 in both; the workbook has no large rows). The Kinder line of the same cake is asked now in P1-29.
- Remaining: Abdo or the catalog owner confirms mappings before Phase 5 closes.
- Kind / severity: Business rule / Medium
- Locations: LOC-01 `شيت جرد ... نوفمبر 2026 (2).xlsx` — ورقة 7: أقسام Product Mix (الصفوف 7-601) والأسماء في العمود D; IMG-02/03 `product-mix-*-2026-11-07.jpg` — أقسام Foodics الثمانية
- Verification: Section and line comparison between LOC-01 sheet 7 and zoomed IMG-02/03.
- Affects phases: 5, 6; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** Foodics فيه 8 أقسام. ملف الجرد مقسم بشكل مختلف: مثلًا «المؤدبه نفر حلو سبيشيال» (47) في Foodics تحت «دنيا الأرز» وفي الملف تحت «لهاليبو»، و«طبق السعادة» و«شوكلاليتا قشطوطة رز» تحت القشطوطة. بعض الأسماء مختلفة: «كيكة الهبة دبي شيكولاتة كبيرة» في Foodics و«… صغيرة» في الملف، و«جيلاتوتي روما بيكان» غير موجود في الملف.

**المشكلة:** لما الأقسام والأسماء مختلفة، مطابقة التقرير بتبقى صعبة، وممكن صنف يتكتب في سطر صنف تاني.

**الدليل:** قسم الأرز في الملف 53 وفي Foodics 119؛ الفرق 66 = المؤدبه 47 + طبق السعادة 9 + شوكلاليتا قشطوطة رز 10. يوم 7 نوفمبر Foodics فيه «بيكان 1» والملف فيه «لوتس 1»، ووصفة «جيلاتيتو روما بيكان» مربوطة بسطر فاضي في الملف.

**التأثير:** ربط أسماء Foodics بأصناف البرنامج والوصفات.

**المقترح:** البرنامج يحفظ اسم Foodics كما هو لكل صنف، ويربطه بصنف واحد معتمد وله وصفة. الأقسام في التقارير تمشي على Foodics. أي اسم جديد من Foodics يدخل قائمة «يحتاج ربط» لحد ما توافق عليه.

**السبب:** اسم Foodics هو اللي بيوصل كل يوم، فالربط به يقلل الأخطاء.

**مثال:** قبل: «جيلاتوتي روما بيكان 1» اتكتب في سطر «لوتس». — بعد: «جيلاتوتي روما بيكان» صنف مربوط بوصفته، يتسجل كما هو.

**التحقق:** إدخال Product Mix يوم 7 نوفمبر كما في الصورة: كل الأسطر مربوطة، ومجموع كل قسم = Foodics.

**مرتبط:** الملاحظة P1-29. · الملاحظة P1-30 (وصفات مربوطة بسطور فاضية).

**لو اختار «نُبقي الوضع الحالي»:** نحتفظ بأقسام وأسماء ملف الجرد، ونترجم Foodics لها يدويًا.

**سؤال لعبدو:** في Foodics «كيكة الهبة دبي شيكولاتة» مكتوبة «كبير» وفي ملف الجرد «صغيرة» (109 في الاتنين، ومفيش سطر «كبير» في الملف) — هل هما نفس المنتج؟ وباقي الأسماء المختلفة هنراجعها معاك في مرحلة الأصناف.

</div>

## P1-29

**7 November Product Mix in the inventory workbook exceeds Foodics by 67 units** — Product Mix يوم 7 نوفمبر في ملف الجرد أكبر من Foodics بـ67 قطعة

- Status: **Fully verified correction** — needs Abdo (required for Phase 1)
- Done: SRC-13 day 7: F239 70, F288 137, F351 16, F360 52 (same names on the photo), F365 49 (the only mango rice-pudding qashtouta line on either side); F202 1 / F210 cleared (Foodics: pecan 1, no lotus; F202 is the pecan recipe row). F327 Kinder Dubai cake kept at 12 by Abdo's decision (review answer 2026-11-20). Item total 2,249 -> 2,192 vs Foodics 2,182; the 10-unit difference is that line. The Foodics quantity (2) is kept as separate evidence in the corrected transcription.
- Remaining: Phase 5 maps Foodics item names and sizes to catalog items (P1-28); the Kinder row's size is part of that mapping.
- Kind / severity: Conflicting evidence / High
- Locations: LOC-01 `شيت جرد ... نوفمبر 2026 (2).xlsx` — ورقة 7: F351 و F360 و F365 و F239 و F288 و F327; IMG-03 `product-mix-bottom-2026-11-07.jpg` — قسما القشطوطة والكيك
- Verification: Line-level comparison; Foodics lines validated by qty × unit price = amount and section sums; neighbouring days 6 and 8 checked and do not match.
- Affects phases: 6, 10; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** مجموع الأصناف في ملف الجرد يوم 7 نوفمبر = 2,249 قطعة. Foodics = 2,182.

**المشكلة:** 6 أسطر مختلفة: قشطوطة كراميل 36 (Foodics 16)، سوبر الملوك 59 (52)، قشطوطة رز ب لبن + مانجا 59 (49)، الغوريلا 80 (70)، المتكندرة صغير 147 (137)، هبة دبي صوص كيندر 12 (2). باقي الأسطر متطابقة.

**الدليل:** قرأنا الصورة مكبرة، وكل رقم في Foodics متأكد منه لأن الكمية × السعر = المبلغ المطبوع (مثلًا كراميل 16 × 35 = 560، الغوريلا 70 × 60 = 4,200)، ومجموع كل قسم = إجمالي القسم المطبوع. الفروق كلها زيادة (+20، +7، +10، +10، +10، +10). أيام 6 و8 في الملف مختلفة تمامًا عن الصورة، يعني ورقة 7 هي فعلًا يوم 7.

**التأثير:** استهلاك الخامات المحسوب ليوم 7 نوفمبر أكبر من الحقيقي، وده بيأثر على الانحراف والطلبية.

**المقترح:** نعتمد أرقام Foodics في بيانات الاختبار ليوم 7 نوفمبر، ونطابق دائمًا مجموع Product Mix مع Foodics قبل حساب الاستهلاك (P1-27).

**السبب:** تقرير Foodics مطبوع من السيستم ومتسق داخليًا، والفروق كلها في اتجاه واحد وأرقام مدوّرة (غالبًا خطأ كتابة أو إدخال مكرر).

**مثال:** قبل: قشطوطة كراميل: 36. — بعد: قشطوطة كراميل: 16 (حسب Foodics).

**التحقق:** بعد الإدخال: مجموع القشطوطة 464 والكيك 902 والإجمالي 2,182.

**مرتبط:** الملاحظة P1-02 (اعتماد التفريغ). · الملاحظة P1-28 (الأقسام والأسماء).

**لو اختار «نُبقي الوضع الحالي»:** نستخدم أرقام ملف الجرد (2,249) في الاختبار.

**سؤال لعبدو:** يوم 7 نوفمبر، Foodics فيه «كيكة الهبة دبي صوص كيندر كبير» 2 قطعة (100 درهم)، وملف الجرد فيه «كيكة هبة دبى صوص كيندر صغيرة» 12 قطعة، ومفيش سطر «كبير» في الملف. هل السطر ده في الجرد هو نفس صنف Foodics؟ لو أيوه نصحح الـ12 إلى 2. ولو لأ، إيه الصنف الصح؟

</div>

## P1-30

**Some recipe components never reach stock; some recipes read empty Product Mix rows** — خامات في الوصفات لا تصل للمخزون، ووصفات مربوطة بسطور مبيعات فاضية

- Status: **Deferred to a later phase**
- Done: Deferred to Phase 5 catalog/recipe review; the app links components by catalog ID.
- Remaining: Phase 5.
- Kind / severity: Confirmed error / Medium
- Locations: SRC-06/07, LOC-01 `inventory-*.xlsx` — قائمة الوصفات (الصفوف 649-3084): E (المكوّن) و H (ربط الكمية المباعة)؛ قائمة المكونات L600:L900
- Verification: scripts/phase1/inventory_checks.py (unmatched SUMIF names) and recipe_links.py/unlinked_sales.py (H-link targets).
- Affects phases: 5; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** الاستهلاك بينتقل من الوصفة للمخزون بمطابقة اسم المكوّن حرفيًا. 10 أسماء مكونات في الوصفات غير موجودة في قائمة المخزون (مثل «صوص فستق»، «نوتيلا»، «صوص لوتس»، «ايس كريم فستق»، «بوبا مانجو»، «حزام بوبا»). وكمان حوالي 20 وصفة مربوطة بسطر Product Mix فاضي، منها «جيلاتيتو روما بيكان»، و«بوبا»، و«هبه ميني»، وجزء من وصفة «كوب ايس كريم 1 بوله».

**المشكلة:** لو الأصناف دي اتباعت، استهلاكها مش هيتخصم من المخزون. مثال واضح: يوم 7 نوفمبر اتباع كوبين ايس كريم 1 بولة؛ جزء الوصفة اللي فيه العلبة والغطاء والمعلقة مربوط بسطر فاضي، فما اتخصمش.

**الدليل:** في أكتوبر و1-13 نوفمبر استهلاك المكونات العشرة = صفر لأن أصنافها ما اتباعتش أو اتسجلت في سطور تانية. كل سطر مبيعات فيه كمية مربوط بوصفة واحدة على الأقل (فحصنا 81 سطرًا في أكتوبر و75 في نوفمبر).

**التأثير:** استهلاك الخامات والتغليف لبعض الأصناف.

**المقترح:** في البرنامج كل مكوّن في الوصفة يتختار من قائمة المخزون (مش يتكتب اسمه)، وكل وصفة مربوطة بصنف بيع واحد. ونراجع معك الأسماء العشرة والوصفات العشرين قبل التشغيل.

**السبب:** الاختيار من قائمة يمنع اختلاف الأسماء، والربط المباشر يمنع السطور الفاضية.

**مثال:** قبل: كوب ايس 1 بولة × 2: يتخصم ايس كريم فقط. — بعد: كوب ايس 1 بولة × 2: ايس كريم + 2 علبة + 2 غطاء + 2 معلقة.

**التحقق:** اختبار: بيع صنف من كل وصفة يخصم كل مكوناتها.

**مرتبط:** الملاحظة P1-28. · الملاحظة P1-31 (الوحدات).

**لو اختار «نُبقي الوضع الحالي»:** ننقل الوصفات كما هي (المكونات دي هتفضل ما بتتخصمش).

</div>

## P1-31

**The same component appears with different units across recipes** — نفس الخامة مكتوبة بوحدات مختلفة في الوصفات

- Status: **Partial correction** — needs Abdo (before Phase 5)
- Done: SRC-06/13 recipe column F: 'KGM' -> 'كيلو' (KGM is the UN/ECE code for kilogram). Mixed-nuts 'عدد' -> 'كيلو' reverted: quantity size does not prove a unit. 17 components still carry more than one unit.
- Remaining: Abdo or the catalog owner approves one unit per component before Phase 5 closes.
- Kind / severity: Business rule / Medium
- Locations: SRC-06/07, LOC-01 `inventory-*.xlsx` — قائمة الوصفات: العمود F (الوحدة)
- Verification: Unit vocabulary and per-component unit counts from recipe lines (inventory_checks.py).
- Affects phases: 5; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** 22 خامة مكتوبة بأكثر من وحدة. مثال: «مكسرات مشكلة» في 22 وصفة بـ«كيلو» وفي 10 وصفات بـ«عدد» بكمية 0.06. «صوص نوتيلا مجهز» بـ«كيلو» و«KGM» و«عدد». و«زجاجة مياه» وحدتها «كيلو».

**المشكلة:** الاستهلاك بيتجمع كرقم بغض النظر عن الوحدة. لو «عدد» فعلًا عدد، يبقى بنجمع قطع مع كيلو. الأرقام (0.06) بتقول إنها كيلو والوحدة مكتوبة غلط، لكن ده محتاج تأكيد.

**الدليل:** قائمة الوحدات المستخدمة: كيلو، KGM، عدد، ووحدات فاضية. عدّينا كل خامة ووحداتها في 1,679 سطر وصفة.

**التأثير:** صحة الاستهلاك المحسوب وكميات الطلبية.

**المقترح:** كل خامة في البرنامج لها وحدة أساسية واحدة (كيلو أو عدد أو لتر)، وأي وحدة شراء (كرتونة، فياسكة، صاك) لها معامل تحويل واضح. ونعتبر «KGM» = كيلو، و«عدد» بكميات كسرية للمكسرات = كيلو، بعد موافقتك.

**السبب:** وحدة واحدة لكل خامة تمنع جمع أشياء مختلفة.

**مثال:** قبل: مكسرات مشكلة: 0.06 «عدد». — بعد: مكسرات مشكلة: 0.06 كيلو.

**التحقق:** اختبار: وصفة بكيلو وأخرى بعدد لنفس الخامة لا يمكن حفظها بدون تحويل.

**مرتبط:** SRC-01: وحدات الطلبية (كرتونة، فياسكة، صاك، «كليو»).

**لو اختار «نُبقي الوضع الحالي»:** ننقل الوحدات كما هي.

**سؤال لعبدو:** «مكسرات مشكلة» مكتوبة بوحدة «عدد» في 10 وصفات بكمية 0.04 إلى 0.07 — هل دي كيلو؟ (وباقي الخامات اللي ليها أكتر من وحدة هنراجعها معاك في مرحلة الأصناف.)

</div>

## P1-32

**Recipe differences between the October and November inventory workbooks** — الفرق بين وصفات أكتوبر ونوفمبر

- Status: **Pending Abdo's decision** — needs Abdo (before Phase 5)
- Done: No workbook change. The November recipe set is used from 1 Nov in SRC-13; the actual effective date is not proven. The app keeps versioned recipes; the date and the 6-spoon line need confirmation.
- Remaining: Abdo confirms the effective date and the 6-spoon line before Phase 5 closes.
- Kind / severity: Business rule / Medium
- Locations: SRC-06 `inventory-oct-2026.xlsx` — قائمة الوصفات; SRC-07 / LOC-01 `inventory-nov-2026*.xlsx` — قائمة الوصفات
- Verification: Set difference of (product, component, unit, qty-or-formula) tuples between SRC-06 and SRC-07 sheet 2; SRC-07 and LOC-01 recipe sets identical.
- Affects phases: 5, 6; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** قائمة أصناف المخزون (224 صنفًا) والوحدات متطابقة في الشهرين. الوصفات فيها 9 أسطر في أكتوبر فقط و10 في نوفمبر فقط.

**المشكلة:** التغييرات: (1) «المؤدبه سبيشيال / سوبر اسبيشيال / نفر حلو»: أكتوبر «ارز مؤدبه» 1 قطعة → نوفمبر «ارز قنبله» 0.3 كيلو، والعلبة كميتها كانت فاضية وبقت 1. (2) مكونات «الغوريلا» (برطمان، ستيكر، صوص كينج كونج 0.15) اتنقلت لصنف «صوص كينج كونج». (3) «بظابيظو مانجو كبير» اتضافله 6 معالق. لازم نعرف إيه المعتمد ومن إمتى.

**الدليل:** مقارنة كاملة لكل أسطر الوصفات (الصنف، المكوّن، الوحدة، الكمية) بين الملفين.

**التأثير:** استهلاك المؤدبه والغوريلا وصوص كينج كونج وبظابيظو مانجو.

**المقترح:** نعتمد وصفات نوفمبر كنسخة حالية بتاريخ بداية 1 نوفمبر 2026، ونحتفظ بوصفات أكتوبر كنسخة قديمة. ونأكد معك 6 معالق لبظابيظو مانجو كبير.

**السبب:** البرنامج بيحتفظ بنسخ الوصفات بتواريخ، فالتغيير ما يأثرش على الأيام القديمة.

**مثال:** قبل: المؤدبه سبيشيال: ارز مؤدبه 1 قطعة (أكتوبر). — بعد: من 1 نوفمبر: ارز قنبله 0.3 كيلو + علبة 1.

**التحقق:** اختبار: بيع في 31 أكتوبر يستخدم وصفة أكتوبر، و1 نوفمبر يستخدم وصفة نوفمبر.

**مرتبط:** الملاحظة P1-30. · سؤال الخطة: الفروق بين ملفي جرد أكتوبر ونوفمبر.

**لو اختار «نُبقي الوضع الحالي»:** نستخدم وصفات أكتوبر كما هي.

**سؤال لعبدو:** وصفات نوفمبر بدأت تتطبق من 1 نوفمبر ولا من يوم تاني؟ وبظابيظو مانجو كبير فعلًا بياخد 6 معالق؟

</div>

## P1-33

**1 November opening balances differ between the inventory workbook, the review template and the 31 October count** — أرصدة أول نوفمبر مختلفة بين ملف الجرد وقالب المراجعة وجرد آخر أكتوبر

- Status: **Deferred to a later phase** — needs Abdo (before Phase 11)
- Done: No change. Opening balances for 5 items differ between SRC-13, the template and the 31 Oct count; tests use the SRC-13 chain. Live opening balances are entered and approved at handover (Phase 11).
- Remaining: Abdo: correct opening balances by Phase 11.
- Kind / severity: Conflicting evidence / Medium
- Locations: SRC-06 `inventory-oct-2026.xlsx` — ورقة 31: AC; SRC-07 / LOC-01 `inventory-nov-2026*.xlsx` — ورقة 1: P; LOC-02 `مراجعه الجرد.xlsx` — AC «بداية الشهر»
- Verification: Name-normalised match of LOC-02 AF/AC against LOC-01 sheet 1 P and SRC-06 sheet 31 AC/AB.
- Affects phases: 6, 11; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** رصيد أول نوفمبر في ملف الجرد = جرد 31 أكتوبر لكل الأصناف ما عدا «صوص فستق»: 50 مقابل 74. وفي قالب المراجعة 4 أصناف مختلفة: صوص لوتس بلبن 52 (الجرد 64)، صوص فستق 37 (50)، نوتيلا 28 (38)، شيكولاتة بنى أقراص ميلك 31 (38). والقالب فيه أرصدة لـ33 صنف تغليف ومستلزمات (مثل ملاعق أرز 36,000، أكياس بلبن صغير 6,500) غير موجودة في ملف الجرد.

**المشكلة:** لازم يكون فيه رصيد افتتاح واحد معتمد لكل صنف.

**الدليل:** طابقنا 52 صنفًا في القالب بالاسم مع ملف الجرد وجرد 31 أكتوبر.

**التأثير:** الأرصدة الافتتاحية للاختبار، ونفس المشكلة هتتكرر يوم التشغيل الفعلي.

**المقترح:** في البرنامج: رصيد افتتاح أول يوم تشغيل يُدخل مرة واحدة ويعتمد منك، وبعدها كل شهر يبدأ من رصيد آخر يوم في الشهر السابق تلقائيًا. للاختبار نستخدم أرقام ملف الجرد بعد ما تقول لنا الصح في الأصناف الخمسة.

**السبب:** رصيد واحد معتمد يمنع الاختلاف بين الملفات.

**مثال:** قبل: صوص فستق أول نوفمبر: 74 أو 50 أو 37. — بعد: صوص فستق أول نوفمبر: (الرقم اللي تعتمده) — بتاريخ اعتمادك.

**التحقق:** تقرير أول يوم يطابق الأرصدة المعتمدة صنفًا صنفًا.

**مرتبط:** الملاحظة P1-24. · الملاحظة P1-34.

**لو اختار «نُبقي الوضع الحالي»:** نستخدم أرصدة ملف الجرد كما هي ونتجاهل القالب.

**سؤال لعبدو:** إيه الرصيد الصحيح أول نوفمبر لصوص الفستق وصوص لوتس بلبن والنوتيلا والشيكولاتة البني؟ وهل أصناف التغليف لازم تتجرد في البرنامج؟

</div>

## P1-34

**The inventory-review template adds consumption instead of subtracting it, and shows a difference before counting** — قالب «مراجعة الجرد» بيجمع الاستهلاك بدل ما يطرحه، ويعرض فرق قبل العد

- Status: **Fully verified correction**
- Done: SRC-14 M7:M168 = N-O, K7:K168 = IF(ISNUMBER(L),L-M,""), headers K5/M5. Boundary-tested (blank vs 0 count).
- Remaining: None.
- Kind / severity: Business rule / Medium
- Locations: LOC-02 `abdo temp/مراجعه الجرد.xlsx` — Sheet1: K7:K168 و M7:M168 و N7:N168
- Verification: Formula inspection of LOC-02; video LOC-05 audio transcribed locally (faster-whisper small, low confidence) — describes entering opening, receipts and consumption but does not settle the sign; LOC-03/LOC-04 recorded as agent-derived.
- Affects phases: 6; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** القالب: «اجمالي» = بداية الشهر + الوارد يوميًا. «اجمالي + الاستهلاك» = الإجمالي + الاستهلاك. والفرق = «المتاح في الفرع» − «اجمالي + الاستهلاك». خانة «المتاح في الفرع» فاضية، فالفرق بيظهر مثلًا −45 للأيس كريم و−70 للمكسرات.

**المشكلة:** المتوقع في الفرع عادةً = بداية المدة + الوارد − الاستهلاك. جمع الاستهلاك بيخلي المتوقع أكبر من الحقيقي. وظهور فرق قبل العد معناه إن الخانة الفاضية اتحسبت صفر.

**الدليل:** أيس كريم 1-13 نوفمبر: 45 + 116.4 − 71.02 = 90.38 كجم متوقع، والعد 67، الفرق −23.38. لو جمعنا الاستهلاك: 45 + 116.4 + 71.02 = 232.42، والفرق −165.42. الفيديو المرفق بيشرح القالب، لكن الصوت مش واضح بما يكفي لنعرف قاعدة الجمع أو الطرح.

**التأثير:** مراجعة الجرد الدورية وطريقة عرضها في البرنامج.

**المقترح:** في البرنامج: المتوقع = بداية المدة + الوارد − الاستهلاك − الهالك − الضيافة − التحويلات. الفرق = العد − المتوقع، ويظهر فقط بعد إدخال العد.

**السبب:** ده نفس منطق ملف الجرد الأساسي (الرصيد الدفتري)، ويطابق اختبار الخطة.

**مثال:** قبل: أيس كريم قبل العد: الفرق −45. — بعد: أيس كريم قبل العد: «لم يُعد»؛ بعد عد 67: الفرق −23.38.

**التحقق:** اختبار الخطة: 10 + 5 − 4 = 11 متوقع؛ عد 10 → −1.

**مرتبط:** الملاحظة P1-24. · نسختين من القالب في outputs/ عملهم مساعد سابق: واحدة صححت عرض الفرق قبل العد، والثانية فيها عمود استهلاك مختلف عن الاستهلاك النظري في 68 من 159 صنفًا — دول مش مصادر منك.

**لو اختار «نُبقي الوضع الحالي»:** البرنامج يحسب «الإجمالي + الاستهلاك» زي القالب.

</div>

## P1-35

**The 4 November (Wednesday) order matches receipts recorded on the same day, not Friday** — طلبية 4 نوفمبر (أربعاء) كمياتها اتسجلت كوارد في نفس اليوم، مش يوم الجمعة

- Status: **Deferred to a later phase** — needs Abdo (required for Phase 1)
- Done: Abdo (review answer 2026-11-20): orders are prepared at night for delivery two days later, deliveries arrive daily (his example: an order sent on the 20th after 2 pm arrives on the 22nd at noon), and the two-day default applies to every order. The meaning of the legacy date in SRC-01 Sheet1!C6 stays unconfirmed: the project owner deferred it to Phase 8 on 2026-11-21 (decisions/owner-deferrals.json). No workbook change.
- Remaining: Phase 8: confirm the legacy C6 date before mapping historical orders. Live records keep creation, expected receipt and actual receipt dates.
- Kind / severity: Business rule / High
- Locations: SRC-01 `replenishment-order-nov-2026.xlsx` — Sheet1!C6 (04\11/2026) والكميات B10:G64; LOC-01 `شيت جرد ... نوفمبر 2026 (2).xlsx` — أوراق 4 إلى 8: العمود Q (الوارد)
- Verification: Name-normalised matching of SRC-01 B/D and E/G quantities against LOC-01 Q on days 4-8.
- Affects phases: 8; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** ملف الطلبية تاريخه 4 نوفمبر (أربعاء). كمياته تطابق «الوارد» المسجل في الجرد يوم 4 نوفمبر نفسه: سلانكاتيه 80، قشطوطه ارز 220، قشطوطه كراميل 20، الغوريلا 50، سانكوريتا صغير 100، الكشخة 65، تشيز بومب 90، مكسرات 20، فويل 3. وفي الجرد في وارد تقريبًا كل يوم.

**المشكلة:** الخطة بتقول: الطلبية اللي تتعمل الأربعاء بالليل تتسلم الجمعة. الملفات بتقول إن فيه استلام يومي، وإن طلبية مكتوب عليها 4 نوفمبر اتسجلت كوارد يوم 4. ممكن التاريخ في الطلبية هو تاريخ الاستلام، أو فيه نوعين طلبيات (يومية من المطبخ وأسبوعية من المخزن).

**الدليل:** طابقنا 16 صنفًا بالاسم: 9 منهم الكمية مطابقة بالضبط لوارد يوم 4، وبعضهم مختلف (بودر لوتس 40 طلب و42 وارد، مانجو قطع 120 طلب و60 وارد). الأصناف بتستلم 28 إلى 42 صنفًا يوميًا من 1 إلى 13 نوفمبر.

**التأثير:** قاعدة تاريخ الاستلام المتوقع وحساب الطلبية المقترحة.

**المقترح:** البرنامج يسجل لكل طلبية: تاريخ إنشائها، تاريخ الاستلام المتوقع، ونوعها (يومية أو غيرها). القاعدة الافتراضية لكل نوع تتحدد حسب ردك، ويمكن تعديل التاريخ مع سبب. الاستلام الفعلي يتسجل منفصلًا ومربوط بالطلبية.

**السبب:** عشان قاعدة «بعد يومين» ما تتطبقش على طلبيات بتوصل في نفس اليوم.

**مثال:** قبل: طلبية 4/11 → متوقع 6/11 (حسب الخطة) بينما الوارد اتسجل 4/11. — بعد: طلبية يومية 4/11 → متوقع 4/11؛ طلبية المخزن الأربعاء بالليل → متوقع الجمعة.

**التحقق:** اختبار القاعدتين، ومطابقة الوارد مع سطور الطلبية بدون تكرار.

**مرتبط:** الملاحظة P1-36. · قاعدة الخطة: الطلبية الأربعاء بالليل تتسلم الجمعة.

**لو اختار «نُبقي الوضع الحالي»:** نطبق قاعدة «بعد يومين» على كل الطلبيات.

**سؤال لعبدو:** التاريخ المكتوب على الطلبية (4 نوفمبر) هو يوم الطلب ولا يوم الاستلام؟ وهل فيه بضاعة بتوصل كل يوم غير طلبية الأربعاء اللي بتوصل الجمعة؟

</div>

## P1-36

**The order workbook mixes another branch's shortages, a blank duplicate block and non-numeric quantities** — ملف الطلبية فيه أقسام لفرع آخر وجدول مكرر فاضي وكميات غير رقمية

- Status: **Partial correction**
- Done: SRC-01 C6 text '04\11/2026' stored as a date; C25 'كليو' and C63 ';\كيلو' -> 'كيلو'. D38 ',' left as is (intended quantity unknown; clearing reverted). App orders are single-branch with numeric quantities.
- Remaining: None needed for the app; D38 stays unresolved in the historical file.
- Kind / severity: Business rule / Medium
- Locations: SRC-01 `replenishment-order-nov-2026.xlsx` — Sheet1: B9:D252 (المصنع)، E9:G (المخزن)، K6:M13 (بسكويت/كعك)، P8:T17 «نواقص الطلبيه (فرع البرشا)»، U144:Z252 (نسخة فاضية)، D38 و C25 و C63
- Verification: Full read of SRC-01 (no formulas; Sheet2 empty).
- Affects phases: 8, 9; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** الورقة فيها عدة جداول: طلبية من المصنع، طلبية من المخزن، كعك وبسكويت بالكرتونة، جدول «نواقص الطلبية (فرع البرشا)»، ونسخة ثانية فاضية من الطلبية تحت. فيه كمية مكتوبة «،» ووحدات مكتوبة «كليو» و«;\كيلو». ومفيش أي معادلات ولا تاريخ استلام.

**المشكلة:** مش واضح إيه اللي يخص المعاريف بالظبط، ولو جمعنا كل الجداول هنحسب نواقص فرع آخر على المعاريف.

**الدليل:** قرأنا الورقة كاملة (869 خانة) والورقة الثانية فاضية.

**التأثير:** شكل الطلبية في البرنامج، وأي استيراد للطلبيات القديمة.

**المقترح:** طلبية البرنامج تخص فرعًا واحدًا، ولها مصدر (مصنع أو مخزن)، وكل سطر: صنف من القائمة، وحدة، كمية رقمية. نواقص الفروع الأخرى مش جزء من طلبية المعاريف.

**السبب:** يمنع خلط الفروع والكميات النصية.

**مثال:** قبل: جدول «نواقص الطلبية (فرع البرشا)» داخل طلبية المعاريف. — بعد: طلبية المعاريف فقط؛ نواقص فرع آخر خارجها.

**التحقق:** اختبار حفظ طلبية بكمية «،» يرجع رسالة.

**مرتبط:** الملاحظة P1-35. · الملاحظة P1-31 (الوحدات).

**لو اختار «نُبقي الوضع الحالي»:** نعيد إنتاج نفس شكل الورقة بكل الجداول.

</div>

## P1-37

**Negative stock deviations are displayed without a minus sign** — الانحراف السالب (العجز) بيظهر من غير علامة سالب في ملفات الجرد

- Status: **Fully verified correction**
- Done: SRC-06/13 AD8:AE620 number format 0.00;[Red]-0.00.
- Remaining: None.
- Kind / severity: Confirmed error / Medium
- Locations: SRC-06/07, LOC-01 `inventory-*.xlsx` — أوراق الأيام: AD و AE (تنسيق 0.00;[Red]0.00)؛ الأنحرافات: E:AI (تنسيق #,##0;[Red]#,##0)
- Verification: Number-format scan of cells with negative values whose negative section has no '-' (SRC-06: 2,795; SRC-07: 1,516; LOC-01: 2,548).
- Affects phases: 6, 9; reports: الجرد والطلبية

<div dir="rtl">

**الموجود حاليًا:** خانات «الانحراف» و«الانحراف التراكمي» منسقة بحيث الرقم السالب يظهر باللون الأحمر فقط من غير علامة «−». مثال: زيت طعام يوم 3 نوفمبر: الرصيد الدفتري 47.74 لتر والجرد 40، الانحراف الحقيقي −7.74 لكنه ظاهر «7.74» بالأحمر.

**المشكلة:** لو التقرير اتطبع أبيض وأسود أو اتقرأ بسرعة، العجز يبان كأنه زيادة.

**الدليل:** قرأنا تنسيق الخانات: 2,795 انحراف سالب في أكتوبر و2,548 في نسخة نوفمبر الأحدث بيظهروا من غير علامة سالب. القيمة المحفوظة نفسها سالبة وصحيحة.

**التأثير:** قراءة تقرير الانحرافات وطباعته.

**المقترح:** البرنامج يعرض العجز دائمًا بعلامة «−» وكلمة «عجز»، والزيادة بعلامة «+» وكلمة «زيادة»، مع اللون كإضافة فقط.

**السبب:** المعنى يوصل حتى من غير ألوان.

**مثال:** قبل: زيت طعام: 7.74 (أحمر). — بعد: زيت طعام: −7.74 لتر (عجز).

**التحقق:** طباعة تقرير الانحرافات أبيض وأسود: العجز والزيادة مميزين بالعلامة والكلمة.

**مرتبط:** الملاحظة P1-24 (انحرافات وهمية للأصناف اللي ما اتعدتش).

**لو اختار «نُبقي الوضع الحالي»:** نستخدم نفس التنسيق: الأحمر فقط بدون علامة.

</div>
