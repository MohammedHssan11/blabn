# Data and Reports

## Available reference evidence

The private repository contains these approved reference sources:

- October and November sales comparison workbooks.
- A weekly sales comparison workbook with sections for Maarif and two other branches.
- October and November daily-ledger workbooks.
- October and November daily-statement workbooks.
- October and November Daily Sales workbooks.
- October and November inventory workbooks, including Product Mix, stock, and recipes.
- A replenishment-order workbook.
- A photographed Foodics Orders Summary and photographed Product Mix example for 7 November 2026.

These sources are tracked only in this private repository because the development team needs them for implementation and validation. They may contain sensitive operational data and must not be published or copied to a public repository.

## Verified sample facts

The 7 November 2026 Foodics sample shows:

- Net sales: 100,605 MAD.
- Orders: 1,185.
- Average per order: 84.90 MAD.
- Cash: 55,105 MAD.
- Visa/Card: 45,500 MAD.
- Product Mix section totals sum to the same 100,605 MAD total.

## Important interpretation rules

- Product Mix quantity is not the order count; an order can contain multiple products and add-ons.
- Product Mix amount is a sales-line amount, not a unit price or ingredient cost.
- POS cash is not the same as the counted cash in the drawer after expenses and bank remittance.
- A receipt's print time is not proof of staff check-out or closing time.
- A blank source cell is not automatically a zero value.
- Never sum section totals together with the detail rows that generated them.
- A purchase order's creation date is not its receipt date. The initial planning rule sets the expected receipt date two calendar days after creation; an order made Wednesday evening is due Friday.

## Legacy workbook mapping

| Report family | Core inputs/outputs |
|---|---|
| Sales comparison | Revenue and order counts by day. The monthly and weekly references use different comparison periods. |
| Daily ledger | Revenue, card/Visa, expenses, remittances, cash counts, purchasing custody, cancellations, and monthly summaries. |
| Daily statement | Revenue, expenses, card/Visa, cash for bank, and reconciliation. |
| Daily Sales | Revenue, orders, average order, cash/bank, expenses, card ratio. |
| Inventory and replenishment order | Product Mix, stock movements, recipe consumption, physical counts, variances, and order lines with items, units, and quantities. |

## Monthly daily-ledger layout

The October and November daily-ledger workbooks (SRC-10 and SRC-11) have daily sheets numbered 1–31, a monthly summary, and classification and reference sheets. Use these files as layout references.

Each daily sheet combines:

- The cash ledger: morning and evening sales, payment/receipt/expense rows, totals, a carried-forward prior-day balance, and the current-day closing balance.
- A counted-cash section: counts by denomination, the calculated counted total, and a comparison with the expected cash balance.
- A cancellation register with the cancelled order and replacement-order data.
- A separate purchasing-custody ledger, including its own opening balance, receipts, expenses, and closing balance.

The summary sheet rolls daily ledger values into monthly daily totals and account/category totals. In the application, all summaries must be query-derived from immutable daily entries and adjustments; they must never be manually maintained as an independent source of truth.

## Replenishment planning dates

The replenishment view must distinguish:

| Field | Meaning |
|---|---|
| Business date | The operating day whose demand/stock is being reviewed. |
| Order-created date | When the proposed order was prepared or submitted. |
| Expected receipt date | The planned arrival date. Initially this is order-created date + 2 calendar days. |
| Actual receipt date | When the inventory receipt is recorded. |

The three-month view should place same-weekday demand/consumption together for comparison and show the expected receipt date next to the proposed order. It must not label a Wednesday-evening order as a Thursday delivery.

## Data required before production acceptance

1. A complete real-day example containing POS report, expenses, actual counted cash, bank remittance, opening stock, receipts, and physical count.
2. An approved product catalog with product IDs/codes, units, and recipe mappings.
3. Confirmed business rules for returns, transfers, waste, hospitality, and bank remittance.
4. Replenishment inputs: safety stock, pack size, shelf-life constraints if applicable, supplier lead time, order cut-off time, and any weekend/holiday exceptions to the initial two-calendar-day rule.
5. An actual Foodics CSV/Excel export if direct import is desired.

## Report validation rule

Do not mark report export complete until one approved real branch day is entered into the application and its output is reconciled line-by-line with the agreed Excel templates.
