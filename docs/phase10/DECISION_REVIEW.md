# Abdo's decisions against the application

Review of 24 November 2026 on `codex/phase-10-web-validation` (from `3c8ce4d`). Each decision was traced to the database rules, the calculation, the screens and the reports. Documentation alone was not taken as evidence. Abdo's voice notes, their transcripts and the owner's conflict audit are private and stay outside Git, and only the decisions are summarised here. Automated transcription that is unclear, or a number Abdo gave as an example, does not change a rule unless a clear decision backs it.

## Already implemented as decided

| Decision | Source | Where the application does it |
|---|---|---|
| The Maarif business day ends at 02:00 Africa/Casablanca. A late close keeps the intended day. | Phase 4 decision of 21 November ([ABDO_DECISIONS.md](../phase4/ABDO_DECISIONS.md)); Abdo repeated it on 24 November | `branches.business_day_rollover = '02:00'` for Maarif (migration `20261122001556`, verified in the database), `public.business_date_of`, and the operating and order commands. `phase4_checks.sql`, `phase8_checks.sql` §3 (01:30 → previous day, 02:00 → next). |
| A new order is expected two calendar days after its business date. Actual receipt comes from receiving. | P1-35 written answer; Phase 8 rule | `replenishment_item_plan`: `lead := coalesce(src.lead_days, 2)`; `default_expected = d + 2`; receipt lines are the only stock source. A per-source exception stays empty until confirmed. |
| Abdo counts the drawer. The counter, role, time, cashier and recorder are separate, with no universal "different person" rule. | P1-19, 21 November | `app_operating_command` `count` stores `counter` (person and role), `recorder` (the session user) and `local`; no constraint compares counter and cashier. The P1-19 "pending" label in exports was removed in `3c8ce4d`. |
| Both Foodics spellings of the large Dubai chocolate cake and the workbook's small name are one product. Other look-alike names are not covered. | P1-28, 22 November | Catalog seed: `foodics` «كيكة الهبة دبي شيكولاتة كبيرة» and «… كبير», and `decision_record` «… صغيرة», all `approved` to the same item (checked in the database). Every other Foodics label stays `pending`. |
| Mixed nuts are measured in kilograms. | P1-31, 22 November | Item «مكسرات مشكلة» has base unit `kg`; its 10 recipe lines written «عدد» are `unit_code = kg` with `unit_resolution = abdo_p1_31` (25 more are already kilo). Other unit conflicts remain in review. |
| Cash and card only at the Maarif close. | 21 November | The daily-close form and command take POS cash and card only. |
| Daily count of products, oil and sauces; Packaging monthly; no weekly count. | P1-24, 22 November | Phase 6 count schedule. |
| The legacy order sheet date is the expected receipt date. | P1-35, 22 November | `import_legacy` maps it to the historical expected date. |

## Changed in this review

**Safety stock: 20 % of the coverage-period forecast by default, editable by Abdo.** The project owner approved the rule on 24 November 2026. The application did not follow it. Safety stock was an optional fixed quantity per item, counted as 0 when blank.

- Migration `20261127090000_safety_stock_percent.sql` adds `replenishment_settings.safety_percent` (default 20, range 0–100 with two decimals, 0 allowed). The planning function computes `safety = forecast for the coverage period × percent / 100` and adds it once, before subtracting usable stock at receipt and eligible confirmed incoming. The result floors at 0, then the supplier minimum and pack size apply as before. The function bodies are the Phase 8 bodies with only those lines changed (`scripts/phase10/build_safety_migration.py --check`).
- A plan in review has no forecast and therefore shows no safety stock.
- Abdo's System Admin account edits the percentage on `/replenishment/settings`; the change is audited with the before and after values. The per-item safety field is gone from the item form. The item command refuses a new per-item quantity, and existing values are kept untouched as history and never converted.
- Saved purchase-order lines keep the plan they were made from. Upgrade path J confirms that saved settings, orders and lines are unchanged; an existing branch row takes 20, and a legacy per-item quantity of 5 is kept.
- The TypeScript cross-check uses the same rule, and the planning page flags any difference from the database.
- The open-question list on `/replenishment/settings` no longer asks about safety stock or the after-midnight business day. Both are decided.

Evidence for the owner's example (10 forecast, 10 usable at receipt, no eligible incoming): the result is **2 at 20 %** and **0 at 0 %** before the pack and minimum rules. A pack of 5 then gives 5, and a minimum of 3 gives 3 (`tests/replenishment.test.ts`). In the database (`phase8_checks.sql` §8), the same item gives 20 + 4 − 7 − 3 = **14** at the default 20 %, **10** at 0 % and **15** at 25 %. A minimum of 16 and packs of 6 then give 18. Invalid percentages (−1, 100.5, 12.345) and a per-item quantity are refused.

## Still open

| Item | What the evidence says | What the application does now |
|---|---|---|
| Minimum complete same-weekday days before trusting the average | Abdo describes comparing with the previous week and gave example Saturdays, but gave no number. | Empty: every item stays in review, and manual orders work. |
| Previous week compared with the 13-week average | Describes his current sheet, not an instruction to replace the average. | 13-week average unchanged. Show both side by side at the walkthrough. |
| Pack size, minimum, shelf life, factory cut-off | He orders from the company factory; no sizes or limits were given. | Empty settings; the factory can be chosen as an item's source. |
| One-day delivery example | An unclear example; the written P1-35 answer gives two days. | Two-day default, no exception. |
| Al Quds and Bourgogne figures | Each branch sends Abdo its figures when its system closes at 02:00. The original report or system and the person who enters them are not named. | `reporting_only` source only; no live source, owner or first live date on `/comparison/settings`. Entries are dated by business date. The two branches keep a 00:00 rollover, which only limits future dates and does not change the date a figure is entered for. Not changed. |
| Morning/evening split | Unclear in the transcript. | Optional fields; the total is required. Ask at the walkthrough. |
| Look-alike items (Lazy Cake) | Only one of two similar products is counted in inventory; the names are not given. | The catalog holds two «ليزي كات» items (the crispy mix and the finished half-kilo box). No Foodics label is approved for either (only the Dubai cake alias is approved). Confirm which product he means, then map it on `/catalog/review`. |
| November recipe start date (P1-32) | No date given. | November recipe versions stay drafts, and real consumption cannot post. |
| First live date, opening balances, stock and orders | Agreed at handover (Phase 11). | Not set. |
| Cash carry-forward (D-1) and purchasing custody (D-2) | Phase 10 findings, not yet put to Abdo. | Unchanged. See [WEB_VALIDATION.md](WEB_VALIDATION.md). |
| Photo upload / OCR of sheets | Deferred by the owner. | Manual entry only. |

## Checks run (local, disposable stack `balaban-p9`)

| Check | Result |
|---|---|
| `npm run check` (typecheck, unit tests, production build) | pass; 296/296 tests (5 new safety-stock cases) |
| `db:check` and `db:check:phase3` … `db:check:phase9` on a fresh database with the new migration | all pass |
| `npm run test:phase8` (HTTP, real settings forms) | 112/112: default 20 shown, 120 refused, 25 saved, no per-item field, 20 + 5 − 7 − 3 = 15 on the plan page |
| `npm run test:phase8:browser` (Edge, English desktop and Arabic 375 px) | 112/112, no console errors |
| `npm run db:upgrade-test` | paths A–J pass; J = Phase 9 head → `20261127090000` with saved settings, a legacy per-item quantity and an order; schema and grants equal a fresh build |
| `npm run test:phase10` (rehearsal) | 78/78 |
| `build_safety_migration.py --check`, `fieldmap:check` | up to date |

Nothing was committed, pushed or applied to the hosted project.
