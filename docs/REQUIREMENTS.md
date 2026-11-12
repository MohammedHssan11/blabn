# Requirements

## 1. Authentication and authorization

### Initial roles

| Role | Initial user | Responsibilities |
|---|---|---|
| System Admin | Abdo | User management, branch setup, master data, recipes, approvals, reports, and audit review inside the deployed client application. |
| Staff | Branch employees | Limited operational access granted by Abdo. |

### Staff permission groups

- **Cashier:** daily closing, expenses, payment totals, draft exports.
- **Storekeeper:** stock receipts, counts, waste, hospitality, and proposed purchase orders.
- **Manager:** can approve adjustments and close a business day if Abdo grants the permission.
- **Attendance kiosk:** can create attendance events only; it must not access financial or inventory screens.

The first production setup has one System Admin account for Abdo. The system is designed to add more application admins later without changing the database model. This role does not control the source repository or GitHub.

## 2. Daily closing

The application must accept:

- Business date.
- Sales/revenue.
- Order count.
- POS cash.
- Card/Visa payments.
- Operating expenses.
- Bank remittance.
- Counted cash.

The application must calculate:

- Average order value.
- Card/Visa ratio.
- Expected cash after expenses and remittance.
- Cash shortage or overage.

## 3. Product Mix and inventory

- Record sold products, codes where available, quantities, and sales-line amounts.
- Record opening stock, receipts, transfers, purchases, returns, waste, hospitality, deductions, physical counts, and notes.
- Convert Product Mix into theoretical ingredient/packaging consumption through approved recipes (BOMs).
- Show book stock, physical stock, and variance without treating blank source values as zero.

## 4. Replenishment

The first version uses an explainable calculation:

```text
recommended quantity = forecast demand + safety stock - current usable stock - confirmed incoming stock
```

The forecast can start from same-weekday historical sales/consumption. Abdo or an authorized staff member can edit the suggested order before approval.

### Three-month planning view

- Show a rolling three-month planning view for each inventory item.
- Compare demand and consumption on the same weekday across prior weeks. A Wednesday should be comparable with prior Wednesdays, not automatically with Tuesday or Thursday.
- Show the business date, the order-created date, the expected receipt date, the suggested quantity, the final ordered quantity, and the actual receipt date when known.
- Default the expected receipt date to two calendar days after the order is created. Example: an order made Wednesday evening has an expected receipt date of Friday.
- Allow an authorized user to change the expected receipt date and require a reason for the override. The system must retain both the original calculated date and the override in the audit log.
- Do not convert the two-day rule into “next business day” unless the branch later supplies a holiday/weekend calendar and explicitly approves that policy.

## 5. Reports

The system must create the five report families from the same saved business-day data. It must not require the user to copy values from one report into another.

## 6. Import and export

- Manual entry is required in version one.
- Excel/CSV import is added only after the actual export shape from Foodics is verified.
- Excel export must be validated against a real approved branch day and the current report templates.

## 7. Daily ledger details from the monthly workbook

The daily-ledger workflow must retain the information found in the added monthly workbook:

- A business date, branch, cashier, and stock-counting employee/role for each daily close.
- Morning and evening sales entries, a sales total, card/Visa and other payment rows, receipts, expenses, and narrative notes.
- A counted-cash breakdown by denomination, plus a reconciliation result that identifies a match, shortage, or overage.
- Separate cash and purchasing-custody ledgers. Each ledger carries its closing balance forward to the next day.
- Cancellation records with branch, date, original order start/time and identifier, cancellation time, old and replacement order values/identifiers, cancellation reason, customer name, and customer phone when supplied.
- Monthly summaries by day and account/category. The web application must calculate these from saved entries rather than copying a monthly total into daily rows.

## 8. Attendance — later phase

- One branch kiosk device with a camera.
- Employee check-in/check-out.
- Face verification with liveness detection; code alone is not sufficient.
- Missing punches, duplicate punches, and manager corrections must be visible in an audit trail.
- No employee face images, templates, or biometric secrets may be committed to Git.

## 9. Out of scope for the MVP

- A direct Foodics API integration.
- A machine-learning demand model.
- A standalone desktop application.
- Multi-branch rollout.
