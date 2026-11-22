# Decisions and Backlog

## Confirmed decisions

The [22 November voice-note decisions](ABDO_WORKFLOW_DECISIONS.md) cover the catalog, count schedule, historical order date and handover.

| Decision | Rationale |
|---|---|
| Start as a web application/PWA | One build works on Abdo's laptop, tablets, and phones. |
| Use PostgreSQL | Inventory, recipes, and reports require relational and auditable data. |
| Abdo is the initial System Admin | He controls users, operational setup, approvals, and reports inside the deployed client application; this does not make him the repository or GitHub admin. |
| Staff use least-privilege roles | Staff should not see or change unrestricted financial and configuration data. |
| Manual entry first | Foodics import/API availability is not yet verified. |
| Explainable replenishment first | Historical demand plus safety stock is auditable; AI comes only after clean data exists. |
| Two-calendar-day replenishment lead time | Abdo prepares orders at night for receipt two days after the order business date, and deliveries occur daily. Record when the order was created, when it is expected, and when it arrived. |
| Three-month same-weekday planning view | Demand is reviewed against matching weekdays across prior weeks, which is more useful than comparing unrelated weekdays. |
| Camera attendance later | Operational closing, inventory, and reports are the MVP priority. |
| Web first, then desktop, then camera attendance | The Arabic and English web release is installed, tested end to end, and verified in live use before desktop work starts. Camera attendance follows the desktop release. |
| Arabic and English interface | Abdo and the staff work in both languages. Both languages produce the same saved values and report figures. |
| Three-branch sales comparison as reporting data | Al Quds, Maarif, Bourgogne, and their total are compared. Al Quds and Bourgogne figures are entered by authorized users; this is not an operational rollout to those branches. |
| Phase 1 source review before development | Review every available source, record required decisions, and assign deferrals to the phase that needs them before starting the web foundation. |
| Abdo selects the first live business date at handover | Old workbooks are references and test inputs. Selected historical sales figures are added later only when a report needs them. |
| Keep approved reference material in the private repository | Legacy workbooks and report images used for development are tracked privately. Do not publish them or add unrelated archives, audio, credentials, or biometric data. |
| Phase 1 decisions are collected through a private Arabic review page | Abdo returned his exported JSON with six answers. The team's [decision record](phase1/decisions/DECISIONS_SUMMARY.md) preserves his choices and comments. |
| Cash drawer count before bank remittance | Use the cash movements through the time of the count for both the daily statement and Yawmeya. The 2 November reference reconciles to +3 MAD. |
| Average order value and weekly comparison | Net sales divided by orders is the daily average. The weekly comparison retains current divided by prior as a ratio and pairs the same weekday across branches. Abdo confirmed the Bourgogne reference figure for 10 November. |
| Corrected workbook copies follow Abdo's answers | On 21 November the Daily Sales copies were set to net sales ÷ orders for every day, and the weekly comparison copy to one date pair (10 and 3 November) for every branch and the total. The weekly ratio and the 7 November Kinder quantity of 12 stay as recorded, as Abdo chose. The legacy ledger cash message is not rewritten; the application computes the variance at the time of the count. |
| Defer interpretation of the historical order-sheet date to Phase 8 | The project owner deferred the question about SRC-01 `Sheet1!C6` on 21 November. Confirm it before mapping historical order dates. The two-day lead time and the daily receipt workflow are recorded now. |
| Close Phase 1 with the six recorded answers | The owner deferred the 318 legacy ledger edits until Phase 4 if needed, and moved Abdo's final confirmation to the Phase 10 walkthrough. Use the reviewed rules as the Phase 2 development baseline. |

## Open decisions

- Exact field-level mapping for the daily ledger and daily statement.
- Final approved recipe, unit, and yield catalog.
- Whether bank remittance is an expense or a separate cash-flow item in each report template.
- Supplier lead times, safety stock, pack sizes, and order constraints.
- Whether the two-calendar-day receipt rule has supplier-, cutoff-, weekend-, or holiday-specific exceptions.
- Attendance policy: shifts, breaks, late arrival, overtime, correction workflow, and camera device.
- Hosting budget and production domain.
- Decisions needed before Phase 1 and confirmations needed during delivery, listed in the [Implementation Plan](IMPLEMENTATION_PLAN.md#decisions-needed-before-phase-1).

## Delivery sequence

Delivery follows the 15 phases in the [Implementation Plan](IMPLEMENTATION_PLAN.md). Each phase closes, after its acceptance checks pass, before the next phase starts.

## Collaboration rules

- One feature per branch: `feature/<short-name>`.
- Do not allow two AI assistants to edit the same branch or files simultaneously.
- Create a pull request for each feature and review the diff before merging.
- Write or update a test for every calculation rule and any data-import fix.
- Update the documentation whenever a business rule changes.
