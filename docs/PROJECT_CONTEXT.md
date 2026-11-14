# Project Context

## Purpose

The Maarif branch currently copies the same daily figures from Foodics/POS closing reports into multiple Excel workbooks. This project creates one internal web application that stores the daily record once, calculates the required operational values, and exports the existing report families.

## Primary user

**Abdo** is the initial system administrator inside the deployed client application and the branch owner/operator. He creates staff accounts, assigns permissions, controls master data, approves stock and attendance adjustments, and owns report exports. This is unrelated to repository ownership or GitHub administration, which remain with the development team.

## Daily operating flow

1. Collect the POS/Foodics closing report.
2. Enter or import the daily sales, order count, payment split, expenses, remittance, and counted cash.
3. Add Product Mix quantities and received stock.
4. Let the system calculate cash reconciliation, theoretical inventory consumption, stock variance, and a replenishment suggestion.
5. Review the three-month planning view. It compares the same weekday across prior weeks and separates the business date from the expected delivery date.
6. Review and export the five Excel report families.

## Confirmed report families

1. Sales comparison.
2. Daily ledger (`Yawmeya`).
3. Daily statement / daily panel.
4. Daily Sales Maarief.
5. Inventory and replenishment order.

## Attendance direction

Attendance is not part of the first core delivery. The intended later flow is a single fixed camera device at the branch entrance: employee identifier, liveness-aware face verification, check-in/check-out event, and manager-reviewed corrections. A staff code alone is not accepted as sufficient identity proof.

## Current source material

The approved historical Excel workbooks and report photographs are tracked in the private repository under `source-material/` so the development team can inspect and validate them. The files are reference evidence, not application seed data. Legacy analysis outputs and unrelated drafts remain local in ignored `archive/`.

## Known constraints

- Foodics direct integration is not confirmed; version one must support manual entry.
- The old workbooks contain inconsistent layouts, stale values, blanks, and date inconsistencies.
- A blank cell is not automatically zero.
- A receipt print time is not automatically a shift closing time.
- Product Mix amount is a sales-line amount, not an ingredient cost.

## Definition of success for the MVP

For one real business day, the branch can enter all required data once, reconcile cash, calculate inventory consumption and variance, review an order against its expected receipt date, and export the five reports without retyping the same figures.

## Replenishment timing rule

The order date and expected receipt date are separate fields. The initial operational rule is a two-calendar-day lead time: an order prepared on Wednesday evening is expected on Friday, not Thursday. The planned receipt date must be visible in the order and in the planning view; it must not be inferred as “tomorrow”.

The planning view covers three months and makes same-weekday history easy to compare. For example, a Wednesday view can show earlier Wednesdays, the current Wednesday's demand, and the expected receipt date for a new order. This is a decision aid; it does not replace the recorded demand, stock, or order data.
