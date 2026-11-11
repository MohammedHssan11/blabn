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
5. Review and export the five Excel report families.

## Confirmed report families

1. Sales comparison.
2. Daily ledger (`Yawmeya`).
3. Daily statement / daily panel.
4. Daily Sales Maarief.
5. Inventory and replenishment order.

## Attendance direction

Attendance is not part of the first core delivery. The intended later flow is a single fixed camera device at the branch entrance: employee identifier, liveness-aware face verification, check-in/check-out event, and manager-reviewed corrections. A staff code alone is not accepted as sufficient identity proof.

## Current source material

Historical Excel workbooks, report photographs, and voice-note transcription are preserved locally in `archive/` and excluded from Git. They are reference evidence, not application data or seed data.

## Known constraints

- Foodics direct integration is not confirmed; version one must support manual entry.
- The old workbooks contain inconsistent layouts, stale values, blanks, and date inconsistencies.
- A blank cell is not automatically zero.
- A receipt print time is not automatically a shift closing time.
- Product Mix amount is a sales-line amount, not an ingredient cost.

## Definition of success for the MVP

For one real business day, the branch can enter all required data once, reconcile cash, calculate inventory consumption and variance, review the next-day order, and export the five reports without retyping the same figures.
