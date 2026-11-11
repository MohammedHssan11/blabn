# Data and Reports

## Available reference evidence

The legacy archive contains:

- October and November sales comparison workbooks.
- October and November daily-ledger workbooks.
- October and November daily-statement workbooks.
- October and November Daily Sales workbooks.
- October and November inventory workbooks, including Product Mix, stock, and recipes.
- A replenishment-order workbook.
- A photographed Foodics Orders Summary and photographed Product Mix example for 7 November 2026.

These sources are excluded from Git because they are business reference material and may contain sensitive operational data.

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

## Legacy workbook mapping

| Report family | Core inputs/outputs |
|---|---|
| Sales comparison | Same-day prior/current period revenue and order count. |
| Daily ledger | Revenue, card/Visa, expenses, cash count, and remittance-related entries. |
| Daily statement | Revenue, expenses, card/Visa, cash for bank, and reconciliation. |
| Daily Sales | Revenue, orders, average order, cash/bank, expenses, card ratio. |
| Inventory | Product Mix, opening stock, receipts, theoretical consumption, waste, physical count, variance, and recipes. |
| Replenishment order | Items, units, and proposed/order quantities. |

## Data required before production acceptance

1. A complete real-day example containing POS report, expenses, actual counted cash, bank remittance, opening stock, receipts, and physical count.
2. An approved product catalog with product IDs/codes, units, and recipe mappings.
3. Confirmed business rules for returns, transfers, waste, hospitality, and bank remittance.
4. Replenishment inputs: safety stock, pack size, shelf-life constraints if applicable, and supplier lead time.
5. An actual Foodics CSV/Excel export if direct import is desired.

## Report validation rule

Do not mark report export complete until one approved real branch day is entered into the application and its output is reconciled line-by-line with the agreed Excel templates.
