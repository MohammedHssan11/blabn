# Decisions and Backlog

## Confirmed decisions

| Decision | Rationale |
|---|---|
| Start as a web application/PWA | One build works on Abdo's laptop, tablets, and phones. |
| Use PostgreSQL | Inventory, recipes, and reports require relational and auditable data. |
| Abdo is the initial System Admin | He controls users, operational setup, approvals, and reports inside the deployed client application; this does not make him the repository or GitHub admin. |
| Staff use least-privilege roles | Staff should not see or change unrestricted financial and configuration data. |
| Manual entry first | Foodics import/API availability is not yet verified. |
| Explainable replenishment first | Historical demand plus safety stock is auditable; AI comes only after clean data exists. |
| Two-calendar-day replenishment lead time | An order created Wednesday evening is planned for Friday receipt, not Thursday. The expected receipt date is explicit and auditable. |
| Three-month same-weekday planning view | Demand is reviewed against matching weekdays across prior weeks, which is more useful than comparing unrelated weekdays. |
| Camera attendance later | Operational closing, inventory, and reports are the MVP priority. |
| Keep approved reference material in the private repository | Legacy workbooks and report images used for development are tracked privately. Do not publish them or add unrelated archives, audio, credentials, or biometric data. |

## Open decisions

- Exact field-level mapping for the daily ledger and daily statement.
- Final approved recipe, unit, and yield catalog.
- Whether bank remittance is an expense or a separate cash-flow item in each report template.
- Supplier lead times, safety stock, pack sizes, and order constraints.
- Whether the two-calendar-day receipt rule has supplier-, cutoff-, weekend-, or holiday-specific exceptions.
- Attendance policy: shifts, breaks, late arrival, overtime, correction workflow, and camera device.
- Hosting budget and production domain.

## Initial backlog

1. Create Supabase development project and database migrations.
2. Implement Abdo System Admin login and staff role model.
3. Build business-day closing and cash reconciliation.
4. Build Product Mix and inventory movements.
5. Build recipe/BOM consumption.
6. Export the five reports to Excel.
7. Validate with one real operational day.
8. Add the three-month same-weekday planning view and delivery-date-aware replenishment suggestion.
9. Add camera attendance after the core workflow is stable.

## Collaboration rules

- One feature per branch: `feature/<short-name>`.
- Do not allow two AI assistants to edit the same branch or files simultaneously.
- Create a pull request for each feature and review the diff before merging.
- Write or update a test for every calculation rule and any data-import fix.
- Update the documentation whenever a business rule changes.
