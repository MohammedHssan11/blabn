# Phase 8: Three-month planning, purchase orders and receiving

Phase 8 lets Abdo see how much history each stock item has, understand a suggested order quantity input by input, create and approve purchase orders, move an expected receipt date with a reason, and record partial receipts. It covers report fields ORD-01 (order, expected and actual receipt dates) and ORD-02 (order lines). Merged in PR #14 (`e1403fb`) and applied to the shared hosted Supabase project on 23 November 2026 (see the [handover](../HANDOFF.md#hosted-deployment)). Migration `20261125090000_phase8_replenishment.sql` holds the schema and rules. The screens are in Arabic and English:

- `/replenishment`: the planning view of every stock item, with a what-if expected receipt date;
- `/replenishment/items/<id>`: one item: the 13-week same-weekday history, the day-by-day projection to the receipt, the confirmed incoming lines and the arithmetic, with the default and a changed receipt date side by side;
- `/replenishment/orders`, `/replenishment/orders/new`, `/replenishment/orders/<id>`: purchase orders, creation, approval, expected-date changes, receiving and cancellation;
- `/replenishment/settings`: the open decisions (System Admin), with the questions for Abdo.

All data used to build and test it is synthetic. No workbook figure, supplier detail or real order was committed. The legacy import (P1-35) is tested with invented values only.

**Open decisions (Abdo):** the minimum number of complete observations, safety stock, pack sizes, supplier minimums, shelf life, order cut-off times, exceptions to the two-day rule, and the business day of an order created after midnight. Each is a setting that starts empty and changes nothing until it is confirmed. See "Questions for Abdo".

## What is stored

| Record | Meaning |
|---|---|
| `purchase_orders` | One order of one branch: number, origin (`app`, or `legacy` from the old sheet), **operational business date**, **actual creation instant** and its branch-local text, creator, status (`proposed`, `approved`, `rejected`, `historical`), the one approve/reject decision (who, when, note), and for legacy orders the source file and cell. |
| `purchase_order_lines` | Catalog item, source (`factory` or `store`), unit, the final quantity **as typed** (digits only: `«،»` is refused) and as an exact fraction, the same quantity in the item's base unit, the **suggested** quantity (base unit) with the plan it came from, and the **override reason** (required when final ≠ suggested; a database check). |
| `purchase_order_expected_dates` | Revision 1 is the **original** expected receipt date (the two-day default, or the legacy sheet value with the original text). Each change adds a revision with its **reason**. The current date is the last revision. |
| `purchase_order_receipts` | One receiving request: the order, its Phase 6 `stock_postings` row (one per request), the **actual receipt date** (the business date of the arrival time entered), reference and note. |
| `purchase_order_receipt_lines` | One received quantity of one line and the **one** stock movement it created (`movement_id` is `not null` and unique), with an over-receipt reason when more than the outstanding quantity was accepted. |
| `purchase_order_cancellations` | The unreceived rest of a line, cancelled with a reason. It creates no stock. |
| `purchase_order_events` | Every accepted request: command, request identifier and hash, actor, business date, time and the result returned. A retry returns that result and writes nothing. |
| `replenishment_settings`, `replenishment_item_settings`, `replenishment_source_settings` | The open decisions: minimum observations and days covered by one delivery (branch); safety stock, pack size, supplier minimum, shelf life and default source (item); a lead-time exception and the order cut-off (source). All blank at the start. Changes keep a revision number and are audited before/after. |

Every order and receipt table is append-only: triggers refuse UPDATE, DELETE and TRUNCATE, even by the table owner. The one exception is the single decision of an order (`proposed` → `approved` or `rejected`, nothing else). Phase 6's `stock_movements.source` gains the value `purchase_order`; no existing row changes (upgrade path H compares every column).

## Rules

### History and forecast

- **History starts on the first live business date.** The branch's first live date is the per-branch setting introduced in Phase 7 (`comparison_branch_settings.live_from`, set on `/comparison/settings`). Without it, every item is in review.
- **A complete observation** is a business date whose Product Mix is locked and every line is posted (Phase 6). Anything else on or after the first live date is **missing** and is left out of the average; it is never counted as 0. On a complete date an item with no consumption has a real 0.
- **Three-month window:** the 91 days up to the order business date, so 13 dates of each weekday. The item page shows all 7 weekdays × 13 dates with their status and value.
- **Forecast:** the plain average of the complete same-weekday observations, as an exact fraction. With fewer complete observations than the configured minimum, or with no minimum decided, the item is in **review**: the page shows the history it has, no recommendation, and a manual order stays available (the order line is stored without a suggestion).

### The recommendation

```text
recommended = max(0, forecast demand + safety stock − usable stock at the expected receipt − eligible confirmed incoming)
```

- **Forecast demand** is the sum of the same-weekday forecasts of the coverage window: the expected receipt date and the following days (`coverage_days`, 1 by default because deliveries are daily).
- **Usable stock at the expected receipt** is projected day by day from the order business date:
  - start from the **book stock** of the order business date (every recorded movement up to it; Phase 6);
  - each day before the receipt: add confirmed incoming expected that day, subtract that day's forecast **where the history supports it** (enough complete observations). On the order date itself nothing is subtracted when its Product Mix is fully posted; if part is posted, only the rest of the forecast is subtracted. A day without enough history is not subtracted and is flagged;
  - stock never goes below 0 (a shortfall is not carried forward).
- **Confirmed incoming** is the outstanding quantity of **approved** orders, at their **current** expected date. Each line falls in one bucket and is counted at most once:
  - before the receipt date → added on its day in the projection (usable stock);
  - inside the coverage window → **eligible incoming**;
  - after the window → not counted;
  - before the order date (overdue) → not counted and flagged, so someone updates its date.

  Proposed, rejected and historical orders are not confirmed incoming.
- **Constraints after the forecast**, only once set: the supplier minimum raises a positive quantity to the minimum, then the pack size rounds it up to whole packs. Shelf life and cut-off do not change the number: they add a warning (coverage longer than the shelf life; the order is after the source's cut-off, counted from the 02:00 business-day start).
- Safety stock that is not set counts as 0 and is shown as "not set".

### Worked example (the plan's acceptance case)

Order on Wednesday evening, business date 18 November. Default receipt Friday 20 November, one day of coverage.

| Input | Value | Where it comes from |
|---|---|---|
| Forecast demand (Friday) | 20 | complete Fridays 30 Oct, 6 Nov, 13 Nov: 18, 22, 20 → 60 / 3. Friday 23 Oct is missing (Product Mix not locked) and is left out |
| Safety stock | 5 | item setting |
| Usable at receipt | 7 | book stock 7 on Wednesday (Product Mix posted); Thursday's forecast is 0 (three complete Thursdays without consumption) |
| Eligible incoming | 3 | an approved order of 3 expected Friday |
| Result | **15** | 20 + 5 − 7 − 3 |

Abdo's own example (P1-35 voice note): closing with 10, with 190 ordered for tomorrow, gives 200 projected for tomorrow; tomorrow's usual consumption of 150 leaves 50 at the next delivery. In the projection: Wednesday book 10 (posted) → Thursday 10 + 190 = 200, − 150 = **50** usable on Friday. The 190 is counted there only, not again as eligible incoming. Book stock stays 10 until the 190 is received.

### Dates

- **Business date** of an order = the Phase 4 business date of its creation instant (PostgreSQL, `Africa/Casablanca`, 02:00 cutoff). The **actual creation instant** is stored next to it. The caller cannot choose either: the API only exposes the command that takes the database clock.
- **Default expected receipt** = business date + 2 calendar days (`rule` text on revision 1). A Wednesday-evening order (20:00) is expected Friday. Thursday 01:30 is still Wednesday's business day → Friday; Thursday 02:00 is Thursday → Saturday. This is the existing Phase 4 rule; **no new after-midnight rule was automated** (open item).
- A per-source lead-time exception can be configured (blank = the two-day rule). With several sources on one order, the longest applies. Weekends and holidays are **not** automated: the requirements forbid turning the rule into "next business day" without an approved calendar. Change the date with a reason instead.
- **Changing the expected date** needs a reason; the date must be on or after the order business date (at most 60 days later) and differ from the current one. Both dates are kept (revisions) and audited. A closed, rejected or historical order cannot change.
- **The actual receipt date** comes only from receiving: the business date of the arrival time entered (not in the future, not before the order was created, to the minute).
- Event times on the order pages (creation, decision, revisions, history) are formatted by PostgreSQL in branch time, so they agree with the business date. (Node's time-zone data still differs for Casablanca in November; see the Phase 2 caveat in the handover.)

### Purchase orders and receiving

- One branch per order. Each line: catalog item (stock-tracked), unit (must convert to the base unit), numeric quantity above 0 with at most 3 decimals, source factory or store. A line from the plan carries the suggestion computed by the database **at creation** (the page's figure is checked: if the plan changed since the page was shown, the order is refused with `CT802`). A final quantity different from the suggestion needs a reason (`CT804`).
- **Approval:** a proposed order is approved or rejected once (rejection needs a reason). Only approved orders can be received or cancelled.
- **Receiving:** quantities in the line's unit. Each saved receipt line inserts exactly one Phase 6 `receipt` movement (`source = purchase_order`, reference `PO-<n>/<line>`), on the business date of the arrival. Database guarantees:
  - `purchase_order_receipt_lines.movement_id` is `not null` and **unique** (`purchase_order_receipt_lines_one_movement`);
  - a trigger checks that the movement is a receipt of the same item, branch, posting, date and quantity;
  - a deferred constraint trigger refuses any `purchase_order` movement that has no receipt line at commit: stock never comes from an order alone.
- **Retries:** the forms carry a request identifier fixed when the page is rendered. The same request returns the first result and writes nothing; the same identifier with different content, or by another person, is refused (`23505`).
- **Over-receipt:** receiving more than the outstanding quantity is refused (`CT801`) by a trigger, unless an over-receipt reason is entered; the reason is stored on the receipt line and in the audit row. The line then shows a negative outstanding quantity.
- **Cancelling the rest** of a line (with a reason) closes it for exactly the unreceived quantity; it creates no stock, and the line's receipts and the cancellation stay in the history.
- A Phase 6 reversal cannot undo a purchase-order receipt (`22023`): the receipt posting is not one of the reversible commands. Correcting a receipt is an open item.

### Legacy order sheet (P1-35)

The database command `import_legacy` (System Admin, `admin.config.manage`) maps SRC-01 `Sheet1!C6` to the **historical expected receipt date**: revision 1 of kind `legacy`, with the original cell text kept verbatim (`source_value`). The order is `historical`, never receivable or approvable, never confirmed incoming, and its creation date stays blank unless the source has one. No actual receipt is derived from it. `parseLegacyOrderDate` (unit-tested) reads the sheet's day/month/year text with its `\`, `/`, `-` or `.` separators. **No real sheet was imported**; there is no screen for it yet, and the import should run only in a private environment once the owner wants the history.

### Permissions

| Action | Permission | Groups |
|---|---|---|
| Create (propose) an order | `purchase_order.propose` (Phase 3) | Storekeeper, System Admin |
| Approve, reject, cancel the rest | `purchase_order.approve` (Phase 3) | System Admin |
| Receive | `purchase_order.receive` (**new**) | Storekeeper, System Admin |
| Change the expected date | `purchase_order.propose` or `purchase_order.approve` | Storekeeper, System Admin |
| Read plans and orders | any of `inventory.view`, `purchase_order.*` on the branch | Storekeeper, Manager, System Admin |
| Settings, legacy import | `admin.config.manage` | System Admin |

Every command checks its permission on the branch, inside the caller's organization, in a `security definer` function with `set search_path = ''`; the pages and server actions check first as well. The tables are read-only to the API roles; row-level security limits rows to the branch's readers. `src/modules/access/catalog.ts` mirrors the new permission and grant (checked by `tests/access-catalog.test.ts`).

## Verification

| Command | Covers |
|---|---|
| `npm run db:check:phase8` | `supabase/tests/phase8_checks.sql` (rolls back): structure, grants and the constraint; the API cannot choose a command's instant; Wednesday 20:00 → Friday, Thursday 01:30 → Friday, Thursday 02:00 → Saturday; non-numeric quantities; create/approve/receive refused to each other's holders (test-only groups) and to the cashier, manager, an outsider, anonymous callers and another organization; review states; missing days vs a real zero; first live date; Abdo's 10 + 190 − 150 = 50; 20 + 5 − 7 − 3 = 15; the floor at 0; incoming buckets; constraints and cut-off; the expected-date change and its effect (15 → 18); receiving 4 + 6, retries, over-receipt, cancellation; legacy mapping; append-only tables and the three database guards by direct inserts as the table owner |
| `npm test` | `tests/replenishment.test.ts`: the planning arithmetic, dates, forms and the page cross-check |
| `npm run test:phase8` | HTTP through the real forms in both languages (see the acceptance table) |
| `npm run test:phase8:browser` | Edge, English desktop and Arabic at 375 px |
| `npm run db:upgrade-test` | Path H: a Phase 7 database with committed stock movements upgraded to Phase 8 |

The planning pages recompute every item with `src/modules/replenishment/planning.ts` from the inputs the database returned and mark any difference (`data-check="mismatch"`). The HTTP and browser checks require none.

## Acceptance

All results below are from branch `phase-8/replenishment` on 23 November 2026, each suite on a freshly reset local database (Supabase CLI 2.122.1, PostgreSQL 17.11.0.006, Edge headless).

| Acceptance check | Result | Evidence |
|---|---|---|
| A Wednesday-evening order gets Friday; the after-midnight case follows the existing 02:00 rule | **Pass** | `phase8_checks.sql` §3: 18 Nov 20:00 → business date 18, expected 20 (Fri); 19 Nov 01:30 → 18 → 20; 19 Nov 02:00 → 19 → 21. Unit test "dates". `test:phase8` §4: business date and expected date of a real order = DB business date + 2. Browser: dates panel and order page in both languages |
| 10 on hand + 190 incoming = 200 projected; a forecast of 150 leaves 50; actual stock stays tied to movements | **Pass** | §7 (Thursday row: incoming 190, opening 200, consumption 150, closing 50; usable 50; book stock still 10 on Thursday; no `purchase_order` movement); unit test "Abdo's example" |
| 20 + 5 − 7 − 3 = 15; a negative result floors at 0 | **Pass** | §8 (B: forecast 20, safety 5, usable 7, incoming 3 → 15; C: −96 → 0); unit tests; `test:phase8` §4 (X: 20 + 5 − 7 − 3 = 15 through the real pages, en and ar); browser |
| Incoming outside the coverage window is excluded; incoming is never counted twice | **Pass** | §8 (E: overdue 1, before-receipt 4, window 3, after-window 9 → usable 4, eligible 3, recommended 3; any double count or inclusion gives a different result); unit tests; §7 (the 190 counted only in usable) |
| Changing the expected receipt date keeps the original and the reason and shows the effect | **Pass** | §9 (revisions `20 default` and `21 override + reason`, audited; B 15 → 18; what-if date); `test:phase8` §5 (order page shows both dates and the reason; plan 15 → 18 → back to 15; item page what-if side by side); browser (admin changes the date; both dates shown) |
| Receiving 4 then 6 of 10 adds 10 as two movements; a retry adds nothing; over-receipt refused or explicit and audited | **Pass** | §10 (2 movements, book +10 on the arrival date; same request = replay, no posting/receipt/event; reused id with other content `23505`; 1 more → `CT801`; with a reason accepted, stored and audited); `test:phase8` §7 (same rendered form twice → `po_replayed`); browser (4 then 6 through the form, order closed) |
| Cancelling the unreceived rest closes the line, creates no stock, keeps the history | **Pass** | §10 (line 2: 4 received, 6 cancelled with reason, outstanding 0, stock unchanged, receipt and audit row kept; a later receipt needs an over-receipt reason); `test:phase8` §8 |
| Insufficient history gives a review state; a manual order stays available | **Pass** | §2 and §6 (no live date / no minimum / minimum 4 with 3 observations → review, no number; a `from_plan` line becomes a manual line); unit tests; `test:phase8` §3 and §9 |
| Missing days are excluded from the average, not counted as zero | **Pass** | §6 (C: 3 complete, 4 missing → average 4, not 12/7; a complete day without consumption is a real 0; before-live dates excluded); unit tests; `test:phase8` §4 (X: an unlocked Product Mix day is missing: 20, not 15) |
| Create, approve and receive are enforced separately (database, HTTP, browser) | **Pass** | §5 (test-only groups holding one permission each; cashier, manager, outsider, anonymous and another organization refused; table rows hidden); `test:phase8` §2, §4, §7 (forged approval and receiving posts by the wrong role refused and nothing written; manager cannot open the new-order page); browser (storekeeper sees no approval form, manager has no forms, cashier 403) |

| Command | Result |
|---|---|
| `npm run check` | `tsc` clean; **260/260** tests in 15 files (226 before; +27 in `tests/replenishment.test.ts`, +7 architecture cases); build passes (6 new dynamic pages) |
| `seed:check`, `seed:catalog:check`, `fieldmap:check` | up to date (54 fields, 6 pending) |
| `db:check`, `db:check:phase3` … `db:check:phase8` | all pass on a fresh database |
| `db:upgrade-test` | pass, paths A–H. H = Phase 7 → 8: 3 committed movements identical in every column after the upgrade; `purchase_order.receive` → storekeeper, system_admin; no settings and no orders; Phase 2–8 checks pass; schema and grants equal to a fresh build |
| `test:phase8` | **109/109** HTTP checks |
| `test:phase8:browser` | **112/112** (Edge, English desktop and Arabic at 375 px), no console errors |
| Earlier phases | smoke 69/69; concurrency pass; `test:phase3` 372/372; `test:browser` 105/105; `test:phase5` 147/147; `test:phase5:browser` 71/71; `test:phase6` 70/70; `test:phase6:browser` 21/21; `test:phase7` 130/130; `test:phase7:browser` 71/71 |
| `test:phase4` | **30/30** on a second, disposable local stack (`balaban-p8p4`, ports 59320–59329, PostgREST v16.5; stopped and its volumes removed). The open PostgREST v14.18 concurrent-save timeout was not re-run here (that stack ran v16.5) |

**Mutation checks** (`node scripts/phase8/mutation-check.mjs`): each guard is removed inside the check's own transaction, and `phase8_checks.sql` must then fail. The unmodified file passes.

| Removed | `phase8_checks.sql` fails at |
|---|---|
| the one-movement-per-receipt-line constraint | the structural assertion "unique movement per receipt line"; with that assertion also removed, at the table owner's second receipt line on the same movement (`expected 23505 but the statement succeeded`) |
| the over-receipt guard (the receipt-line trigger) | "expected CT801 but the statement succeeded" (receiving 1 more than outstanding) |
| only the over-receipt test inside that trigger | the same assertion |
| the append-only trigger of `purchase_order_lines` / of `purchase_order_receipt_lines` | "expected 42501 but the statement succeeded" (update by the table owner) |
| the order decision guard | the status rollback is caught by a check constraint instead of `42501` |
| the order RLS policy | "readers see the branch's orders" |
| that policy opened to every signed-in person | "orders hidden from the cashier and from a person without a group" |
| the deferred has-a-receipt-line trigger | its structural assertion |

Changes to earlier files, with reasons: `scripts/phase3/upgrade-test.mjs` gains path H; `tests/access-architecture.test.ts` adds the new action file to the guarded list and pins the page guards; `src/modules/access/catalog.ts` mirrors the new permission. No earlier SQL check file changed.

Found and fixed while building:
- A receipt timed in the same minute as the order's creation was refused (the form has minute precision, the creation instant has seconds). The comparison is now to the minute.
- Event times on the order page were formatted with Node's time-zone data, which disagrees with PostgreSQL for Casablanca in November (the Phase 2 caveat): "created 20:10" next to "approved 21:10". PostgreSQL now returns the branch-local text.
- plpgsql `select … into` a composite variable splits the columns; fractions are now assigned with `:=`.

## Questions for Abdo

Shown on `/replenishment/settings` in plain Arabic; the answers go into the settings on the same page.

1. **Minimum observations.** «يا عبده، عشان البرنامج يقترح كمية لصنف: محتاج كام يوم كامل من نفس يوم الأسبوع (مثلاً كام سبت فات البيع والجرد بتوعهم متسجلين كاملين) قبل ما نثق في المتوسط؟ 3 ولا 4 ولا أكتر؟»
2. **Safety stock.** «لكل صنف، عايز نسيب كام زيادة احتياطي فوق الاستهلاك المتوقع (مخزون الأمان)؟ ولو صنف مش محتاج احتياطي نكتبله صفر.»
3. **Pack size, supplier minimum, shelf life, cut-off.** «فيه أصناف بتتطلب بالكرتونة أو بعدد ثابت (حجم العبوة)؟ فيه أقل كمية لازم تتطلب من المصنع أو المخزن؟ الصنف بيفضل صالح كام يوم؟ وآخر ساعة ينفع تبعت فيها الطلبية لكل جهة كام؟»
4. **Exceptions to the two-day rule.** «قاعدة إن الطلبية بتوصل بعد يومين من يوم الطلب: فيه استثناءات؟ مثلاً جهة بتوصل في يوم واحد، أو يوم إجازة أو يوم في الأسبوع مفيش فيه توريد؟»
5. **Orders after midnight.** «لو الطلبية اتعملت بعد نص الليل (مثلاً الساعة 1 أو 2 الفجر)، نحسبها على أنهي يوم؟ البرنامج دلوقتي بيحسب أي حاجة قبل الساعة 2 الفجر على اليوم اللي فات. ده صح ولا نغيّر الساعة؟»

## Not in Phase 8

- Correcting or reversing a saved purchase-order receipt (today: an over-receipt with a reason, or a Phase 6 adjustment).
- A screen for the legacy import, and importing real history (Phase 11, private environment only).
- A holiday or weekend calendar for expected dates (needs the branch's approval of such a policy).
- Prices and supplier records: none are stored.
