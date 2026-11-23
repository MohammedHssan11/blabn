# Phase 6: Product Mix, stock movements, counts and variance

Phase 6 records what arrived, what was consumed through the approved recipes, what was physically counted, and the difference. Migration `20261123120000_phase6_stock.sql` holds the schema and rules. The screens are `/inventory` (stock of the day), `/inventory/product-mix` and `/inventory/items/<id>` (history of one item), in Arabic and English.

All data used to build and test it is synthetic. **No real consumption can post yet:** every loaded recipe is still a draft. The November versions also wait for Abdo's start date (P1-32), so each real Product Mix line stays blocked with `recipe_not_approved` until he approves its recipe.

## What is stored

| Record | Meaning |
|---|---|
| `stock_postings` | One accepted request: branch, business date, command, request identifier and hash, actor, posting time, reason. `unique (branch_id, request_id)` makes every command idempotent. `reverses_posting_id` is unique, so a posting can be reversed only once. |
| `stock_movements` | Typed movements in the item's base unit as exact fractions: opening, receipt, purchase, transfer in, return, consumption, waste, hospitality, deduction, transfer out, approved adjustment. Each keeps the quantity and unit as entered, its actual local time and source, and either the recipe basis (consumption) or the adjustment it came from. |
| `product_mix_reports`, `_sections`, `_lines` | The Foodics report as printed: net sales, report time, each section with its printed total, and each line (name, quantity, amount). |
| `stock_consumption_lines` | One posted Product Mix line: product, approved mapping, recipe version and number, sold quantity, and the eligibility result as posted, including components that are not stock-tracked. |
| `stock_counts`, `stock_count_voids` | Physical counts with count time. A blank count has no row. A withdrawn or replaced count stays, with its reason. |
| `stock_adjustments` | Proposed, approved or rejected adjustments, separate from counts. Only approval creates a movement. |

Every table is append-only, except two rules. A Product Mix may be edited while it is a draft. An adjustment's status changes once. Triggers refuse updates, deletes and truncation even by the table owner. The API roles can only read, through row-level security on `inventory.view` for the branch.

## Rules

- **One write path.** `app_stock_command(branch, date, command, request, payload)` checks the person, branch and permission. It locks the branch (the same lock as the daily close), refuses future business dates, and writes the rows and one audit entry in one transaction.
- **Retries.** A retried request with the same identifier and content returns the first result and writes nothing. The same identifier with different content is refused (`23505`). The forms fix the identifier when the page is rendered, so a resubmitted form is the same request. Posting the same Product Mix again only considers lines that are not posted yet.
- **Receipts are recorded on the day they arrive** («الوارد»): a receipt's time must fall on its business date. Other movements and counts may be timed up to the end of the next calendar day, the same window as the daily close.
- **Product Mix reconciliation before posting.** Section totals are check figures and never count as sales lines. The report locks only when all of these hold:
  - each section's lines add up to its printed total;
  - the section totals add up to net sales;
  - every section has lines;
  - when the branch's daily close for that date has net sales, they are equal.

  A name can appear once per section, so an overlapping photo portion cannot be counted twice. The same name may appear in different sections (for example delivery and take-away), because those are separate sales.
- **Consumption through the approved recipe only.** Posting calls the Phase 5 eligibility check (`catalog_consumption`) for every line not yet consumed:
  - Eligible lines post. Each movement keeps the recipe version, the recipe line, the recipe quantity and unit, and the exact consumed quantity. Nothing is recomputed later.
  - Blocked lines stay pending with their reason: unmapped or pending name, no approved recipe for the date, missing unit. They post later, once the catalog owner resolves them.
  - Components that are not stock-tracked are kept in the posted snapshot but create no movement.
- **Recipe history is protected.** A trigger refuses to close an approved recipe range before a date that has consumption posted through it (`CT004`). That date's basis can never change. A later version starting the next day is accepted.
- **Expected stock and variance.** For an item on a business date:
  - The opening is all movements of earlier business dates.
  - Expected (book) stock is the opening plus that day's movements.
  - Expected at count is the opening plus that day's movements timed up to the count.
  - Variance is the count minus expected at count, and is computed only when a count exists.
  - **A blank count is incomplete; an explicit 0 is a count.** The status is `counted`, `missing`, or `not_due` (packaging outside month-end).
- **Count schedule (P1-24).** Ingredients (everything above Packaging in Abdo's workbook) are counted daily. Packaging items are counted monthly, so they show as due only on the last day of the month.
- **Counts and adjustments are separate.** A count is an observation. Replacing or withdrawing one needs a reason and keeps the original. An adjustment needs a reason and approval (`inventory.adjust_approve`). Once approved, it moves the book while the count and its variance stay as observed.
- **Corrections are reversals.** Reversing a posting writes opposite movements with the original business date and time, and needs a reason. If the posting was a consumption posting, its lines return to pending and can be posted again as attempt 2.
- **Reproducible figures.** `app_stock_day(branch, date, as_of)` returns the figures from what had been posted by an earlier instant.

## Permissions

The new permission is `inventory.consume` ("Enter the Product Mix and post recipe consumption"). It goes to Storekeeper, Manager and System Admin.

| Command | Permission |
|---|---|
| Receipt, purchase, transfer in, return | `inventory.receive` |
| Waste / hospitality | `inventory.waste` / `inventory.hospitality` |
| Deduction, transfer out, propose an adjustment | `inventory.adjust` |
| Opening stock, decide an adjustment | `inventory.adjust_approve` |
| Count, withdraw a count | `inventory.count` |
| Product Mix entry, lock, post | `inventory.consume` |
| Reverse | the permission that created the posting |

The cashier holds no inventory permission and sees no stock page or row.

## Verification

| Command | Covers |
|---|---|
| `npm run db:check:phase6` | `supabase/tests/phase6_checks.sql` (rolls back). It covers:<br>• grants and row-level security<br>• the plan case: 10 opening + 5 received − 4 consumed = 11, a count of 10 gives −1<br>• receipt and post retries create one movement<br>• cake, add-on and packaging each consume once<br>• a blank count stays incomplete; an explicit zero gives −9/10<br>• monthly packaging is not due<br>• overlapping lines and stale edits are refused, and locking waits for reconciliation<br>• blocked lines (unmapped name, the real Dubai cake on a draft recipe) post later<br>• the posting keeps version 1's line and quantity after version 2, and closing over a posted day is refused<br>• a Product Mix that disagrees with the daily close's net sales does not reconcile<br>• count replacement and withdrawal; adjustment separate from the count<br>• reversals, including double reversal and consumption re-posting; figures as of an earlier instant<br>• append-only tables, one audit row per request, no loaded recipe approved |
| `npm run db:upgrade-test` | Section F: a Phase 5 database (556 items, 1,721 recipe lines) upgraded to Phase 6, `inventory.consume` granted to the existing groups, Phase 2–6 checks, schema and grants equal to a fresh build |
| `npm run test:phase6` | HTTP through the real forms in both languages:<br>• access for anonymous, cashier, storekeeper, manager and admin<br>• the same rendered form sent twice is recognised<br>• a cashier replaying a storekeeper form changes nothing<br>• Product Mix reconcile, lock and post<br>• count and variance; item history<br>• the recipe-range guard |
| `npm run test:phase6:browser` | Edge, English desktop and Arabic at 375 px: direction, no horizontal scroll, one page heading, a real count with an explicit zero, the blocked Dubai cake line, no console errors |

## Not in Phase 6

- **Purchase-order receipts** (Phase 8). A receipt is a typed movement with an optional delivery reference. Phase 8 links each receipt to its order line and must keep one movement per receipt line.
- **Opening balances for the first live date** (Phase 11). The opening-stock command exists, once per item, before the item's other movements.
- **Packaging count day.** Abdo said Packaging is counted monthly, but not on which day. The application treats the last day of the month as due. Confirm the day with Abdo.
- **The Phase 3 skeleton `/inventory/adjustments`** (reason only) is still there for compatibility. Stock adjustments with quantities are on `/inventory`. Retire the skeleton once no one uses it.
- **Real consumption.** It needs Abdo's November start date and the review-queue approvals listed in the [Phase 5 record](../phase5/CATALOG_AND_RECIPES.md).
