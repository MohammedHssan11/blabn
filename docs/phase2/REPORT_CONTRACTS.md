# Phase 2 report contracts

Started 21 November 2026. Use the [Phase 1 field map](../phase1/FIELD_MAP.md) for each field's legacy cell, unit, date basis, display precision and blank behavior. Use [field-map.json](../phase1/field-map.json) for the same definitions in machine-readable form.

| Report | Field IDs | Saved records and derived values |
|---|---|---|
| Daily Sales Maarief | DS-01–DS-11 | Closed day, sales, orders, card, expenses and bank remittance. Daily average uses sales divided by orders. The period average uses total sales divided by total orders. |
| Daily statement | ST-01–ST-09 | Daily close, timed expense and remittance entries, card payments and physical cash count. Show the stored reconciliation result at count time. |
| Yawmeya | LG-01–LG-11 | Daily close, cash and purchasing-custody entries, cash count and cancellations. Carry each ledger's closing balance into the next day's opening balance. |
| Sales comparison | CMP-01–CMP-08 | Maarif closed days and separately recorded reporting-only figures for other branches. Aggregate matching dates. Use current divided by prior for the weekly ratio and current divided by prior minus one for monthly growth. |
| Inventory and replenishment | INV-01–INV-13, ORD-01–ORD-02 | Product Mix, recipe versions, stock movements and physical counts. Order creation, expected receipt and actual receipt use separate dates. Only recorded receipts add stock. |

## Prototype inputs

- **Daily close and cash count.** Use synthetic net sales of 1,000 MAD, 10 orders, 300 MAD card and 100 MAD cash expenses, with zero opening cash and no other movement before count. A physical count of 603 MAD gives expected cash of 600 MAD and a variance of +3 MAD. A later deposit leaves the count variance at +3 MAD. Show 100.00 MAD as the average and leave the average blank when order count is missing or zero.
- **Weekly comparison.** Use one shared date pair for all branches. Current sales of 120 MAD versus 100 MAD gives a weekly ratio of 120%. Mark a missing branch explicitly and show coverage for any incomplete total. Leave the ratio blank when the prior figure is missing or zero.

Use identical saved values in Arabic and English. Format the labels, digits, amounts and dates in the view. Persist the branch business date separately from actual event times and use server-side calculations in the application.

## Scheduled dependencies

Fields ST-09 and LG-08 are pending implementation. Use the [confirmed Phase 4 count-role rule](../phase4/ABDO_DECISIONS.md) when implementing them. Keep INV-01, INV-03, INV-06 and INV-12 marked with their Phase 5 catalog, unit and recipe dependencies. Use creation, expected receipt and actual receipt for new orders. Confirm what the historical order-sheet date means in Phase 8 before mapping it.
