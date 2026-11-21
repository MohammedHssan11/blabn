# Trial of the review page on Abdo's device

Before Abdo gives real answers, run a short trial on the device he will use, so the team knows that saving, reopening and sending answers back work there. The trial uses a separate copy of the page; nothing he does in it can enter the decision record.

## What the page shows

A three-step guide («اقرأ مكان المشكلة والشرح والمقترح» / «اختار إجابتك، ولو عندك تعديل اكتبه» / «اضغط «حفظ الإجابة»، وبعد ما تخلص نزّل ملف الردود وابعتُه لنا»), then **six numbered questions**. Each question gives where the issue is (original Arabic workbook name, tab, cell), what is recorded now, why it needs attention, the proposed change, and one direct question with answer choices:

- «أوافق على المقترح», «أقترح تعديلًا آخر» (text required), «نُبقي الوضع الحالي», each with a line saying exactly what it means for that question;
- «مش متأكد / محتاج أراجع» — saved, but the question stays open and does not count as answered;
- for the cash and delivery questions, an optional extra yes/no question (counted every day? daily deliveries?).

The header shows «تم الرد على X من 7», how many are marked «محتاج أراجع», and how many saved answers have not been downloaded yet.

## The two files

| File | Use | Where answers are kept | File he sends back |
|---|---|---|---|
| `docs/phase1/review/abdo-review-trial.html` | Trial only. Orange "نسخة تجربة" banner. | That browser's own storage, under a trial-only key (separate from the real page) | `abdo-TRIAL-decisions-<date-time>.json`, marked `"trial": true` |
| `docs/phase1/review/abdo-review.html` | Real answers, after the trial. | That browser's storage (or the team computer when run with `review-server.mjs`) | `abdo-decisions-<date-time>.json` |

Both pages are single files with no internet access, no external scripts and no tracking. They contain the question texts only (no original workbooks, no cell values beyond those quoted in the questions). Send them only privately (direct message or email to Abdo); do not post them anywhere public.

## How his answers are saved and returned

1. **Saving.** Each time he presses «حفظ الإجابة», the answer is stored in the browser on his device (not on the internet). Reopening the same file in the same browser on the same device shows his answers again. Changing an answer keeps the earlier one under «الإجابات السابقة».
2. **Unsent answers.** The header shows how many saved answers have not been downloaded since his last download. Nothing reaches the team until he sends the file.
3. **Returning.** He presses «تنزيل ملف الردود». The browser saves a `.json` file (on a phone it goes to Downloads or opens the share sheet). He sends that file back privately (WhatsApp, email). He can download and send again at any time; the newest answer per question wins and earlier ones stay in history.
4. **Importing.** The team runs `node scripts/phase1/review/import-decisions.mjs <file>`. The script checks every entry (known question, an option that belongs to its choice, text where required, valid extra answers), merges it into `docs/phase1/decisions/abdo-decisions.json`, and regenerates the summary and CSV. It refuses trial files.
5. **Another device.** «استرجاع ردود من ملف» loads a downloaded answers file (trial files only into the trial page, real files only into the real page).
6. **If the browser cannot save** (private mode, some phone file viewers, blocked storage), the page shows a red banner and asks him to download the answers file after each answer, or to open the page in Chrome or Edge on a computer.
7. **Answers from earlier versions of the page** stay in the browser storage and in the exported file with their history; a saved answer that has no specific option is shown as the first option of the same kind.

The local server option (`review-server.mjs`) is only for a session on the team's computer: answers are written straight into the repository record.

## Trial steps

1. Send Abdo `abdo-review-trial.html` privately with the trial message below.
2. He opens it on the device he will use (a computer with Chrome or Edge is best; a phone works) and answers any two questions, at least one with «أقترح تعديلًا آخر» and a short text, and one with «مش متأكد / محتاج أراجع».
3. He closes the page, opens it again and checks that both answers are still there, and that the «مش متأكد» one shows as «محتاج أراجع».
4. He presses «تنزيل ملف الردود» and sends the `abdo-TRIAL-decisions-….json` file back.
5. The team checks the file without touching the real record:

   ```bash
   DECISIONS_DIR=<scratch folder> node scripts/phase1/review/import-decisions.mjs <abdo-TRIAL-decisions-....json> --trial
   ```

   Expected: both answers imported, the alternative's text present, the «مش متأكد» one counted as unresolved.
6. If any step fails, note the device and browser and use the fallback: the real page on a computer in Chrome/Edge, or a session on the team computer with `review-server.mjs`.
7. When the trial works, send `abdo-review.html` with the message in [README.md](README.md). Trial answers stay in the trial storage on his device and never appear in the real page.

## Trial message to Abdo (not sent; for the project owner to use)

> أهلًا يا عبدو، قبل ما تجاوب بجد عايزين نجرب الصفحة على جهازك. افتح الملف المرفق (نسخة تجربة) على الجهاز اللي هتستخدمه، جاوب على أي سؤالين — واحد منهم اختار فيه «أقترح تعديلًا آخر» واكتب أي جملة، والتاني «مش متأكد / محتاج أراجع» — واضغط «حفظ الإجابة». اقفل الصفحة وافتحها تاني وشوف الإجابات لسه موجودة. بعدين اضغط «تنزيل ملف الردود» وابعتلنا الملف. الإجابات دي للتجربة بس ومش هتتحسب.

## What the trial does not cover

- A browser that blocks storage was not tested on a real device; the page detects it and shows the red banner.
- The team's tests used Chrome-based browsers at desktop and phone widths; Safari on iPhone was not tested.
