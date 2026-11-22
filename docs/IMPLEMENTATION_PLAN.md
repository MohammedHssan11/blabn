# Implementation Plan — Abdo Branch Operations System

**Plan date:** 17 November 2026

**Planning baseline:** repository revision `92bdccc`

**Revised:** 18 November 2026, after the plan review of commit `8db1c39`

The first release is a web application in Arabic and English. It covers daily closing, inventory, replenishment, reports, and cross-branch sales comparison. The web release is installed, tested end to end, and verified in live branch use before development starts on the separate desktop application. Camera attendance follows the desktop release.

The web application is built with Next.js, React, and TypeScript and can be installed as a PWA. Supabase provides PostgreSQL, authentication, authorization, storage, and migrations. Foodics figures are entered manually in the first release. The web and desktop applications use the same accounts, data, and server-side calculations.

Phase 1 closed on 21 November 2026. Development uses Abdo's six recorded answers and the verified source copies. The project owner scheduled the protected legacy ledger review for Phase 4 if needed, the historical order date for Phase 8, and the final confirmation for the Phase 10 walkthrough. Phase 2 begins with the [report contracts](phase2/REPORT_CONTRACTS.md). See the [closure checklist](phase1/CLOSURE.md).

## Delivery sequence

| Phase | Outcome | Starts after |
|---|---|---|
| 1 | Review every Excel sheet and available source, then record Abdo's decisions | Start |
| 2 | Arabic and English web foundation and report-source mapping | 1 |
| 3 | Abdo account, staff accounts, and permissions | 2 |
| 4 | Daily close, cash reconciliation, and daily ledger | 3 |
| 5 | Products, units, and recipes | 4 |
| 6 | Product Mix, stock movements, counts, and variance | 5 |
| 7 | Sales comparison for Al Quds, Maarif, Bourgogne, and total | 6 |
| 8 | Three-month planning, purchase orders, and receiving | 7 |
| 9 | Five Excel report families | 8 |
| 10 | End-to-end web validation in Arabic and English | 9 |
| 11 | Web installation, production rollout, and stability verification | 10 |
| 12 | Separate desktop application, installation testing, and rollout | 11 |
| 13 | Employee IDs, camera trial, and face enrollment | 12 |
| 14 | Camera attendance, hours calculation, and Excel export | 13 |
| 15 | Attendance rollout and final handover | 14 |

## When a phase is complete

Work through the phases in numbered order. At the end of each phase, run its acceptance checks, rerun any affected checks from earlier phases, and record the results. Fix any issue that causes an acceptance check to fail and rerun the check. Start the next phase only after every acceptance check for the current phase passes. For phases that add or change a user-facing workflow, run that workflow in both Arabic and English.

Phase 1 closes when source coverage is recorded, its checks are complete, and every issue has a final outcome: Abdo's decision for the questions that need his knowledge, and the team's documented and verified resolution for the rest, which Abdo can also accept or contest. Questions that a later phase needs are recorded with that phase as their deadline. The web foundation starts in Phase 2. Questions about the source material are Phase 1 findings. Later phases apply the recorded decisions and do not reopen them.

Phase 11 closes only after the full web workflow works in both languages on the branch's devices, the PWA has been installed and tested, and the results from live branch use meet the live-verification criteria in Phase 11's acceptance checks. Desktop work starts in Phase 12.

## Working scope

- Maarif is the first branch for daily operations, stock, recipes, replenishment, and reporting.
- At handover, Abdo chooses the first live business date. The application shows that date when he signs in and starts live daily records from that date.
- Sales comparison includes Al Quds, Maarif, Bourgogne, and their selected total. This is reporting data only and is not an operational rollout to Al Quds or Bourgogne.
- Maarif comparison figures come from saved business-day data. Authorized users enter Al Quds and Bourgogne figures until an approved source is available. If a later report needs sales from before the first live business date, add only the figures needed for that report and record their source and date (see Phase 9).
- The supplied workbooks are references for report layouts and calculations. Automated tests use anonymized fixtures derived from them. Real reference days, such as the 2 November reference day in the November workbooks (SRC-11, SRC-03, and SRC-05; Phase 1 records the exact sheets), may be entered by hand only in a private test environment restricted to the project team. Never commit them as fixtures or store original files in application storage. Omit or mask customer contact details from cancellation records. The production setup starts with the reviewed opening balances for the first live business date.
- The 7 November Foodics sample validates the sales and payment flow with 100,605 MAD net sales, 1,185 orders, 55,105 MAD cash, 45,500 MAD card, and 84.90 MAD average order value.
- Purchase orders default to an expected receipt date two calendar days after local order creation. A Wednesday-evening order is expected Friday.
- Attendance is a later release. One kiosk camera verifies the person who enters an employee ID, shows the confirmed check-in or check-out time, and lets Abdo export hours to Excel.

[Requirements](REQUIREMENTS.md) · [Data and report evidence](DATA_AND_REPORTS.md) · [Source-material inventory](SOURCE_MATERIAL.md) · [Architecture review](ARCHITECTURE_REVIEW.md)

## Phase 1 — Excel and source-data review with Abdo

### Goal

Review every available workbook, worksheet, and supporting data source. Give Abdo a private review page, in plain Arabic, that presents one issue at a time, explains what it affects, and records how he wants it handled. A downloadable spreadsheet (CSV) copy of the same findings and decisions is available from the page.

### Work

- Inventory all available workbooks, worksheets, and supporting source files, including hidden worksheets, report photos, and transcriptions. Record what each source covers and flag any missing, unreadable, or conflicting material. Confirm the source scope with Abdo at the start of Phase 1 (see [Decisions needed before Phase 1](#decisions-needed-before-phase-1)), and add any confirmed material to the [source-material inventory](SOURCE_MATERIAL.md).
- Include as findings the source questions already known from planning: the timing of the 36,945 cash entry relative to bank remittance, the duplicated Bourgogne date and aggregate example in SRC-12, differences between the October and November inventory workbooks (SRC-06 and SRC-07), the stale month labels in the monthly comparison tabs, and verification of the 7 November transcription (IMG-04), closed through source checks and the project owner's visual confirmation of «دنيا البمبوظه» on 20 November 2026.
- Check dates, branch labels, units, duplicates, blanks and explicit zeros, formulas and external links, totals and carry-forward, and matching figures across sources. Use independent calculations where possible and distinguish confirmed errors, conflicting evidence, and business rules that need clarification.
- Record each separate finding with its exact source location. Reference related occurrences of the same issue so Abdo can see the full impact without answering the same question repeatedly. Preserve the original workbooks and evidence.
- Publish the source-coverage inventory for the team and build Abdo's review page from the findings register. The page shows only the questions that need his knowledge to close Phase 1, numbered and one at a time, with a list showing each question's status (awaiting an answer, answered, or not sure) and progress. For each question it gives, in everyday Arabic, where the issue is (the original workbook name, tab and cell), what is recorded now, why it needs attention, the proposed change and the question to answer. The team keeps the complete findings register and the technical trace to rules and fields internally.
- Save each answer as soon as Abdo confirms it, keep it after the page is closed and reopened, and keep earlier answers as history when he changes a response. Abdo returns his answers as a downloaded file (or they are saved directly when the team runs the page locally with him); the team imports them into the decision record in the repository.
- The team corrects, in copies of the workbooks (originals unchanged), only errors that independent evidence supports, and leaves unproven dates, units, product mappings, recipe dates and definitions as recorded until Abdo decides. Each finding records its status: fully verified correction, partial correction, applied on an assumption, future application rule, deferred to a later phase, or pending Abdo's decision. Check every corrected copy cell by cell against its original for unintended changes and test blanks, explicit zeros and empty periods.
- For each required question Abdo can approve the proposed change, propose a different change and describe it, keep the existing behavior, or answer "not sure / needs review", which keeps the question unresolved. Questions that cannot be answered by one of these (a date, a before/after) also carry the specific answer he must give. Questions needed only before a later phase are added to the page when that phase approaches; a team correction he wants to contest outside the page is raised with the team, which records the answer in the same decision record. Record the agreed outcome and the date of his decision. When he proposes an alternative that is not fully specified, record the final rule once agreed.
- Build the report field map from the decisions, including what the system should do when a legacy report is kept as-is. Carry the approved calculation, data-handling, and layout decisions into the later phases and their acceptance checks.

| Field in each finding | What it captures |
|---|---|
| Finding ID, category, and severity | A stable reference and a way to prioritize review |
| Source and location | File, sheet and cell range, or an equivalent location in a supporting source |
| What is there now | The observed value, formula, layout, or behavior |
| Problem and evidence | What is wrong or unclear, how it was verified, and any conflicting source |
| Impact | The report, calculation, or daily operation affected |
| Proposed change and reason | The specific fix, how it would work, and why it addresses the issue |
| Expected result and check | What should happen after the change and how the team will verify it |
| Abdo's decision | Pending, Accept proposed change, Propose alternative, or Keep as-is |
| Abdo's comments and final outcome | The alternative or reason, the agreed rule, and the decision date |

### Acceptance checks

- The source inventory accounts for every available file and worksheet and records review coverage.
- Every finding points to its evidence and explains the issue, impact, proposed change, reason, and verification in terms Abdo can follow.
- Every finding has a recorded status and final outcome. Questions marked as required for Phase 1 have Abdo's decision; questions for later phases name the phase and owner. Proposed alternatives and contested team corrections have an agreed outcome, and keep-as-is decisions describe the behavior to retain. Every other finding has the team's documented resolution: a verified correction in a copy of the workbook (with what remains for a partial one), a rule for the application, or a deferral to the later phase that owns it.
- Corrected copies show no unexplained change against the originals, the value checks distinguish independent evidence from checks of the team's own edits, and boundary tests cover blanks, explicit zeros and empty periods. Corrections that cannot be applied (for example on password-protected sheets) are listed as pending.
- The team can trace decisions affecting scope, calculations, or reports into the field map and the relevant later phase.
- Abdo receives the review page privately and records his decisions. Record any project-owner deferral of the final confirmation and review the decisions with Abdo at the scheduled acceptance session.
- The six recorded answers in `docs/phase1/decisions/abdo-decisions.json` are the development baseline. Preserve their history when later results change a decision.

## Phase 2 — Development foundation and report-source mapping

### Goal

Create a working development baseline and document where each important report value comes from.

### Work

- Initialize Next.js, React, and TypeScript with Arabic right-to-left and English left-to-right layouts, MAD formatting, and clear date display.
- Set up a language switcher and shared translation files for navigation, form labels, validation messages, and status messages. Keep the user's language choice when they navigate or return.
- Create the application structure for access control, daily closing, ledgers, catalog, inventory, comparisons, replenishment, reports, and future attendance.
- Create a Supabase development project, database migrations, and anonymized test fixtures.
- Configure type checks, production build checks, and automated test execution.
- Keep financial, stock, replenishment, and report calculations on server-side code.
- Use the Phase 1 field map to define report contracts. Each field identifies its source record, meaning, unit, date basis, rounding rule, blank-value behavior, and any decision that affects it.
- Build early screen prototypes for daily close, cash count, and branch comparison using test data.
- Configure branch timezone and business-day settings. Store business date separately from actual event timestamps.

### Acceptance checks

- A developer can create the database from migrations and run the application.
- Type checks and the production build succeed.
- A user can switch between Arabic and English. Navigation, forms, and messages render in the correct direction and remain readable on laptop and mobile layouts.
- The report map links every field to its source record and any decision that affects it. Later-phase fields with open source questions stay marked with the phase in which they need confirmation.
- Credentials remain outside source control, and original source workbooks and images remain private reference material.

## Phase 3 — Abdo, staff accounts, and permissions

### Goal

Abdo can manage accounts and roles. Each employee can access only the work assigned to them.

### Work

- Implement sign-in, sign-out, password recovery, user activation, and user deactivation.
- Create organization, branch, employee, authenticated user, branch membership, and permission records.
- Seed Abdo as the initial System Admin in the deployed application.
- Create Cashier, Storekeeper, Manager, Comparison Editor, and future Attendance Kiosk permission groups.
- Allow Abdo to assign more than one permission group to an employee when required.
- Configure Maarif as the operational branch and Al Quds and Bourgogne as comparison branches.
- Separate permission to enter comparison data from permission to view or export it.
- Apply Row Level Security and explicit database grants. Every page, server action, database command, report export, and file download checks branch membership and permission.
- Create an append-only audit history for administrative and operating actions.

| Role | Main permissions |
|---|---|
| System Admin | User management, configuration, recipes, approvals, reports, and audit review |
| Cashier | Daily-close drafts, sales, payments, expenses, cash counts, and permitted draft exports |
| Storekeeper | Receipts, stock counts, waste, hospitality, and purchase-order proposals |
| Manager | Business-day closing and adjustment approval when granted by Abdo |
| Comparison Editor | Enter assigned branch-comparison data |
| Attendance Kiosk | Create attendance events for its own branch only |

### Acceptance checks

- Abdo can create, disable, and change a staff account.
- A cashier cannot access inventory adjustments or data from another branch without a specific permission.
- Removing a permission blocks the next protected action even if the user remains signed in.
- Cross-branch denial works through the page, direct application request, report download, and database policy.
- Administrative changes appear in the audit history.

## Phase 4 — Daily close, cash reconciliation, and Yawmeya

### Goal

The cashier enters the operating day once. The system calculates expected cash, counted cash, and difference while maintaining cash and purchasing-custody ledgers.

Use [Abdo's Phase 4 decisions](phase4/ABDO_DECISIONS.md) for the confirmed Maarif workflow. The branch manager counts and closes, and can approve his own recorded correction. The normal cutoff is 02:00 local time. A later close retains the business date it closes. The branch accepts cash and card.

### Work

- Open one business-day record per branch and local business date.
- Record the cashier, cash counter, and their role at the time of entry.
- Enter morning and evening sales, total sales, order count, POS cash, card payments, and approved payment types.
- Enter expenses, receipts, bank remittances, notes, and their relevant times.
- Enter cash denominations and quantities, then calculate the counted-cash total.
- Use the saved close to feed Daily Sales Maarief, the daily statement and Yawmeya. Abdo currently copies values including Visa and totals between his sheets when closing.
- Maintain separate cash and purchasing-custody ledgers with opening balance, entries, closing balance, and next-day carry-forward.
- Record cancellation details, including original and replacement order information, times, values, reason, and permitted customer contact information.
- Calculate average order value, card ratio, expected cash, and shortage or overage.
- Show Draft, Awaiting Review, Closed, and Corrected states.
- Make financial posting immutable. A correction creates a linked adjustment or reversal with a reason and approver.
- Recalculate current carry-forward views when an earlier correction affects later dates while preserving the source revision of an earlier report export.
- Use idempotency keys and expected revisions so a retry cannot create duplicate entries.

### Calculation rules

- Expected cash starts with opening cash, adds cash received, and subtracts cash paid out through the time of counting.
- Abdo counts the drawer before the bank remittance. For the 2 November reference day, expected cash is 48,695 − 11,300 − 453 = 36,942 MAD. The counted 36,945 MAD gives a variance of +3 MAD.
- Bank remittance is recorded once. Its presentation in each report comes from the report field map.
- Cash variance equals counted cash minus expected cash.
- A missing count remains incomplete. An explicit zero is a real count.
- Daily average order value equals net sales divided by the number of orders. An absent or zero order count leaves the average blank.
- Period average order value equals period total sales divided by period total orders.
- Card-ratio denominator and rounding are documented and applied consistently.

### Acceptance checks

- Two consecutive test days carry each ledger's closing balance into that ledger's next opening balance.
- Exact match, shortage, overage, missing count, and explicit zero produce the correct result.
- Simultaneous updates or stale edits produce one saved result or a clear conflict.
- A failed transaction leaves no partial financial record or partial audit entry.
- Correcting day one updates the current day-two view while retaining the original export basis.
- Enter the 2 November reference in the private test environment and reproduce +3 MAD across the daily statement and Yawmeya. Record the later 36,945 MAD remittance once and verify that the count variance stays +3 MAD. Both timing scenarios also pass with known synthetic inputs.
- Revisit the 318 deferred protected-sheet operations only if validating the daily close requires those legacy worksheets. Use the reviewed cash and ledger rules and the available reference evidence for the app.

Phase 4 local acceptance is recorded in the [handover](HANDOFF.md#phase-4-status). Use the [operating workflow](phase4/OPERATING_CLOSE.md) to run the daily close and verification checks.

## Phase 5 — Products, units, and recipes

### Goal

Each sold product can be converted into the ingredient and packaging quantities it consumes.

### Work

- Create product, ingredient, packaging, and sold-item records with source labels and available codes.
- Map Foodics Product Mix names to the approved application catalog.
- Create a review queue for unmapped names, ambiguous add-ons, and missing units.
- Define sales, purchase, storage, and base units with approved conversions.
- Create versioned recipes and recipe lines with effective dates.
- Capture yields and other confirmed recipe parameters where they exist.
- Preserve discontinued items and old recipe versions referenced by history.
- Require an approved product mapping, conversion, and recipe before affected consumption can post.

### Acceptance checks

- A known product and recipe produce an independently verified component-consumption result.
- Replacing a recipe later does not alter consumption already posted for an earlier day.
- Missing mapping or unit information appears clearly and blocks only the affected consumption.
- The catalog, unit, and recipe data loaded for testing match Abdo's Phase 1 decisions.

## Phase 6 — Product Mix, inventory movements, counts, and variance

### Goal

The Storekeeper can see what arrived, what was consumed, expected stock, physical stock, and variance.

### Work

- Enter Product Mix lines manually with a sold-item name or code, quantity, and reported sales-line amount.
- Reconcile Product Mix totals before posting. Prevent overlapping photo portions, detail rows, and section totals from being counted twice.
- Post theoretical ingredient and packaging consumption through the approved recipe version.
- Record opening stock, receipts, purchases, transfers, returns, waste, hospitality, deductions, adjustments, and notes as typed stock movements.
- Record «الوارد» on the actual receipt day, as Abdo does in the inventory sheet. Keep shortages traceable to the stock count and any separately approved adjustment.
- Link each purchase receipt to its purchase-order line and create one stock movement.
- Enter a physical count with count time and compare it to expected stock at the same point.
- Preserve physical-count observations and create a separate approved adjustment where necessary.
- Show source, unit, actor, and revision history for each stock figure.

### Acceptance checks

- A test of 10 opening units plus 5 received units minus 4 consumed units produces 11 expected units. A physical count of 10 produces variance of minus 1.
- Retrying the same consumption post or receipt creates one stock movement.
- Products, add-ons, and packaging consume correct components without duplicate usage.
- A blank count is incomplete. An explicit zero participates in variance calculation.
- Product Mix section totals reconcile without inflating the day's total.
- Inventory figures follow the Phase 1 outcomes and Abdo's decisions on differences between the October and November inventory workbooks (SRC-06 and SRC-07), including the recipe effective date (P1-32) and units (P1-31).

## Phase 7 — Cross-branch sales comparison

### Goal

Abdo can compare Al Quds, Maarif, Bourgogne, and the total across current and prior weeks or selected monthly periods.

### Work

- Use SRC-12 as the reference for branch order and current-versus-prior-week layout.
- Show sales and order counts for each branch on the current and previous matching weekday. Show dates, comparison coverage and absolute differences. Label the weekly sales ratio «نسبة الحالي للسابق» and compute it as current sales divided by prior sales. Monthly growth remains a separate measure.
- Show totals for selected branches and dates only.
- Pull Maarif figures from saved business-day data.
- Allow authorized users to enter Al Quds and Bourgogne figures with source, date, user, and revision history.
- Enforce one active value per branch, date, metric, and source designation to prevent a day being counted twice.
- Support monthly comparison and same-weekday comparison as separate modes.
- Show missing days and partial-period coverage before showing a percentage.
- Show dates before the first live business date as unavailable unless a report uses specifically selected historical sales figures. Keep those figures traceable to their source and scoped to reporting.
- Use 10 November for the current Bourgogne reference figure of 28,975 MAD and 374 orders. The SRC-12 reference comparison uses 10 and 3 November across branches and in the aggregate.
- Apply separate permissions for entering, viewing, and exporting comparison data.

### Acceptance checks

- The three branches and their total appear in the expected order.
- A current value of 120 and prior value of 100 produces a difference of 20, a weekly ratio of 120%, and monthly growth of 20% in monthly mode.
- Missing days and zero prior values display safely with an understandable unavailable percentage.
- Maarif data entered once appears in closing, reports, and comparison without re-entry.
- A user without comparison access cannot read Al Quds or Bourgogne figures.

## Phase 8 — Three-month planning, purchase orders, and receiving

### Goal

Abdo can understand a replenishment suggestion, its dates and assumptions, approve a final quantity, and record partial receipts.

### Work

- Show a three-month window per item, grouped by matching weekday, using the operational history available since the first live business date. Show how much history is available as the branch builds up records. Until an item has the agreed minimum number of complete same-weekday observations, show the available history and offer a manual purchase order instead of a recommendation.
- Show business date, order creation date, original expected receipt date, overridden expected receipt date, final ordered quantity, and actual receipt dates.
- Start demand forecasting with a transparent same-weekday historical average, showing used dates and number of complete observations.
- Exclude missing observations and flag insufficient history.
- Calculate recommended quantity as forecast demand plus safety stock minus usable stock minus eligible confirmed incoming stock.
- Calculate usable stock at expected receipt time, including expected consumption before delivery where data supports it.
- Include confirmed incoming stock once, on the date and in the coverage window where it applies.
- Floor a recommendation at zero. Apply pack size, supplier minimum, shelf-life, and cut-off rules after the branch confirms them.
- Create purchase orders with suggested quantity, final quantity, override reason, creator, and approver.
- Default expected receipt to the order business date plus two calendar days. Abdo schedules orders at night and receives deliveries daily. Keep the actual creation timestamp and operational business date separately. Confirm the business-day cutoff before automating the after-midnight assignment.
- Before mapping historical order dates, confirm whether the date in SRC-01 `Sheet1!C6` means creation or receipt. Keep the original source value for reference until that Phase 8 check.
- Require a reason for an expected-date override and preserve both dates.
- Support partial receipts, outstanding quantities, and cancellation of unreceived quantities.
- Create stock only from saved receipt records tied to order lines.

### Acceptance checks

- A Wednesday-evening order receives Friday as the default expected receipt date.
- For Abdo's planning example, 10 on hand plus 190 confirmed incoming gives 200 projected units available. A forecast of 150 leaves 50 projected units. Actual stock remains tied to recorded receipts and movements.
- A test case of 20 forecast demand plus 5 safety stock minus 7 usable stock minus 3 eligible incoming stock produces 15.
- Incoming stock outside the coverage window is excluded.
- Changing receipt date preserves the original date and reason and shows the effect on planning.
- Receiving 4 and then 6 units from a 10-unit order adds 10 total units to stock with no duplicate receipt.
- Insufficient history produces a review state while a manual purchase order remains available.

## Phase 9 — The five Excel report families

### Goal

Abdo can select a day or period and download consistent reports from saved application data.

| Report family | Content |
|---|---|
| Sales comparison | Current and previous periods, branch comparison, growth, and selected totals |
| Daily ledger / Yawmeya | Cash and purchasing custody, sales periods, payments, expenses, remittances, cash count, cancellations, carry-forward, and monthly summary |
| Daily statement / panel | Sales, expenses, card, cash, bank remittance, and reconciliation according to the approved mapping |
| Daily Sales Maarief | Sales, orders, average order value, cash, expenses, card, and ratios |
| Inventory and replenishment order | Product Mix, inventory movements, recipe consumption, counts, variance, purchase-order lines, units, and delivery dates |

### Work

- Build a server-side Excel export adapter. Select the library after testing Arabic layout, printing, and workbook size.
- Build clean versioned templates from agreed layouts.
- Make report selection, export status, and download available in both languages. Use the agreed workbook labels and layout for each template.
- Produce every value from application calculations and apply the Phase 1 outcomes and Abdo's decisions. Where he kept existing behavior, reproduce the agreed behavior from saved data. Never copy legacy formulas, external links, or cached errors into generated files.
- If an approved report needs sales from before the first live business date, Abdo approves the specific figures. An authorized user enters them as reporting-only records with source and date. They never enter ledgers, stock, or carry-forward.
- Record branch, period, template version, calculation-rule version, source revisions, requester, status, and file location.
- Permit draft exports only where the user's role allows them.
- Mark files complete only after generation and secure storage succeed. Failed export requests remain retryable.
- Keep report files private and check authorization at download.
- Write user-entered descriptions and identifiers as text during export.
- Scan generated files for broken references, external links, formula errors, Arabic rendering issues, and unexpected values.

### Acceptance checks

- Every report family opens and prints clearly in Excel.
- Shared values appear consistently in every report that uses them.
- An earlier export remains reviewable after a later correction, with its source revision recorded.
- Partial months and missing values keep their actual meaning.
- A failed export can be retried without producing duplicate completed files.
- Download fails after the requester loses the relevant permission.
- Historical reporting figures appear only in the reports that need them and do not change any live balance.

## Phase 10 — End-to-end web validation in Arabic and English

### Goal

Validate the full web workflow with Abdo in Arabic and English before the web rollout.

### Work

- Enter the available 2 November evidence in the private test environment and confirm the cash and bank-remittance results match the timing rule Abdo approved in Phase 1.
- Use the 7 November Foodics sample to validate sales and payment normalization.
- Test the next business day, month boundary, missing day, and correction of an earlier date.
- Test all three branches in the comparison screen.
- Test planning, purchase-order approval, partial delivery, and stock receipt.
- Reconcile every report field against approved Excel templates. Record differences with source field or cell, reason, owner, and resolution.
- Simulate network loss during save, competing edits to one day, and report export while source data is being corrected.
- Run the web workflows from sign-in through report download in both languages on the supported browser and device layouts. Check translations, display direction, validation messages, and language switching during normal use.
- Observe staff and Abdo completing the intended workflow, then remove confusing labels or unnecessary steps.
- Run a final rehearsal with a current branch day before replacing the daily Excel workflow.

### Acceptance checks

- One operating day is entered once and produces the five report families without retyping shared values.
- Financial, stock, replenishment, and comparison results match independent calculations and agreed rules.
- Each material report difference has a documented resolution.
- Arabic and English produce the same saved values, calculations, and report figures for the same inputs.
- Abdo accepts the real workflow and report presentation for branch use. Confirm the Phase 1 summary during the same walkthrough and record the result and date.

## Phase 11 — Web installation, rollout, and stability verification

### Goal

The Maarif branch uses the bilingual web release daily. The team verifies that it is ready to serve as the baseline for the desktop application.

### Work

- Configure production hosting, domain, HTTPS, production Supabase, and Abdo's production account.
- Apply tested migrations and production security settings.
- Let Abdo choose the first live business date at handover, including a future date if the branch will start later. Show it when he signs in and use it as the earliest date for live daily records. Before the first live day opens, Abdo can change the date, and the change is recorded in the audit history.
- Record the branch's reviewed opening cash, purchasing-custody balances, stock, and outstanding purchase orders as of that date. Keep the example days in the test environment and use the original workbooks as report references.
- Load reviewed catalog and recipe data into production.
- Install the PWA on branch devices and test save confirmation, reconnect behavior, and sign-out.
- Keep the first release online-first. When connectivity drops, show clear state so users can verify the last successful save before retrying.
- Monitor failed saves, exports, and application errors without logging customer contacts or other sensitive operating data.
- Agree recovery targets and test database restoration plus report-file recovery or regeneration in a separate environment.
- Prepare release rollback steps and ensure migrations remain compatible during rollout.
- Give Abdo a short illustrated guide for daily use, account recovery, corrections, and support.
- Support the first live operating days. Track save failures, report differences, and issues in either language. Rerun affected workflows after fixes.

### Acceptance checks

- Abdo and assigned staff complete a live operating cycle, including closing, inventory, comparisons, replenishment (manual or recommended orders, receipts, and the insufficient-history state), and the five Excel report families.
- The branch runs the web release for the agreed number of consecutive business days, including one month-end close, with no unresolved defect that blocks daily use or changes a balance or report total. Every live day reconciles with its exported reports.
- The catalog, unit, and recipe data loaded into production match Abdo's Phase 1 decisions before live inventory consumption starts.
- The installed PWA and browser access pass checks on the branch's devices in Arabic and English. Staff can sign in, save, reconnect, and export reports.
- Live results, fixes, and retests are recorded. All web acceptance checks pass before the desktop phase starts.
- Production permissions and opening balances are correct.
- If Abdo chooses a date after handover, the application shows the upcoming first live business date. The first live business day opens with its reviewed balances, and earlier reference days stay out of the live daily records.
- Recovery testing meets agreed targets.
- A responsible owner and support route are known for the live application.

## Phase 12 — Desktop application, testing, and rollout

### Goal

Deliver a separately installable desktop application for the branch, using the tested Arabic and English web release as the baseline for the operational workflows.

### Work

- Confirm the branch's target operating systems and devices, then select the desktop packaging approach.
- Reuse the web interface and workflows where practical. Connect the desktop application to the same authenticated backend, permissions, business records, and report calculations.
- Build the installer and test first launch, sign-in, language switching, reconnect behavior, updates, and saving exported Excel files to disk.
- Run the operational workflow and compare the results with the web application. Trial the installer on the devices the branch will actually use.

### Acceptance checks

- The desktop application installs, launches, updates, and runs on each agreed operating system.
- The full operational workflow works in Arabic and English, from opening a business day through closing, inventory, comparison, replenishment, and report export.
- Saving a change in either application makes it available in the other. Both show the same permissions, balances, and figures for the same report.
- Excel exports save locally and open correctly. Connection loss and retries produce clear status and a single saved result.
- The branch uses the desktop application for the agreed number of business days on the agreed devices, with results matching the web release.
- All desktop acceptance checks pass before the camera attendance phase starts.

## Phase 13 — Employee IDs, kiosk trial, and face enrollment

### Goal

Each employee has a stable ID, and the selected branch device can verify that the person entering the ID is that employee.

### Work

- Add employee setup with the basic personnel information needed for attendance and generate a unique stable employee ID.
- Review employee identity with Abdo before initial enrollment.
- Set up one fixed kiosk at the entrance and test camera placement, height, lighting, distance, network connection, and privacy positioning.
- Capture approved enrollment material from required angles.
- Require liveness-aware face verification for the person presenting an employee ID.
- Evaluate verification using the actual device, branch lighting, and expected employee behavior. Select the final approach after measuring speed and failure behavior.
- Give the device a revocable branch-bound identity with permission to create attendance events only.
- Define who can enroll or re-enroll an employee, storage location, retention, and deletion process for biometric templates.
- Use synthetic data while developing. Keep production biometric material outside Git.
- Set operational acceptance thresholds after trial, including verification time and false-rejection rate.

### Acceptance checks

- An enrolled employee succeeds under intended lighting and distance conditions.
- The trial includes a person entering another employee's ID, a printed photo, a phone photo, and a replayed video.
- The trial covers changed angles, glasses where relevant, camera failure, and connection loss.
- Failed verification gives a clear message and creates a reviewable attempt record.
- The selected device, verification approach, and success thresholds are documented.
- Abdo can deactivate an employee or kiosk, and the kiosk cannot access financial or inventory data.

## Phase 14 — Camera attendance, hours, and Excel export

### Goal

An employee enters their ID at the kiosk, completes camera verification, sees their confirmed check-in or check-out time, and Abdo can export attendance and hours to Excel.

### Employee journey

1. The employee enters their ID at the branch kiosk.
2. The kiosk offers the appropriate check-in or check-out action.
3. The camera verifies the employee and liveness.
4. The server saves the attendance event.
5. The screen confirms the time, such as “Check-in recorded at 09:05” or “Check-out recorded at 17:10.”

### Work

- Save employee, branch, device, actual event timestamp, verification result, and exception reason.
- Bind verification to a short-lived single attendance attempt so it cannot be reused for another employee ID or later event.
- Prevent duplicate events caused by repeated tapping or request retries.
- Pair check-ins with check-outs and calculate completed work duration.
- Support shifts crossing midnight and retain actual timestamps. Apply the agreed rule for daily reporting of cross-midnight hours.
- Flag missing check-outs and duplicate attempts.
- Create Abdo's attendance screen with employee history, daily and selected-period totals, missing events, and manager corrections.
- Require a reason for correction, preserve the original event, and record the correcting user and time.
- Add break, rounding, lateness, overtime, and payroll rules only after Abdo confirms them. The initial release shows actual elapsed time.
- Create a dedicated attendance Excel export with a separate permission from financial reports.

| Attendance Excel column | Meaning |
|---|---|
| Employee ID and name | Stable identity used for grouping and review |
| Check-in date and time | Actual recorded event |
| Check-out date and time | Actual recorded event, possibly on the next date |
| Worked duration | Difference for a completed interval |
| Total for selected period | Sum of completed durations |
| Attendance status | Complete, missing check-out, duplicate attempt, or needs review |
| Correction note | Reason, actor, and time for an authorized correction |

### Acceptance checks

- A 09:05 check-in and 17:10 check-out produces 8 hours and 5 minutes before break policy.
- A 22:00 check-in and 06:00 next-day check-out produces 8 hours.
- A retry creates one attendance event. A repeated check-in displays the employee's current state.
- A person using a colleague's ID or a previously issued verification result cannot create an event.
- A missing check-out is visible in Abdo's screen and Excel export and excluded from completed-duration totals.
- An authorized correction updates the current report while retaining the original event and reason.
- Excel totals match the attendance screen.
- The kiosk cannot retrieve financial, stock, comparison, or report data.

## Phase 15 — Attendance rollout and final handover

### Goal

Daily operations, reports, and camera attendance run in production with clear support and recovery procedures.

### Work

- Start attendance with an agreed employee pilot group and observe verification failures, lighting issues, and repeated attempts on the actual device.
- Review a complete attendance period with Abdo and compare the report with saved events.
- Train employees on kiosk use and confirmation messages.
- Train Abdo on missing check-outs, corrections, attendance Excel export, employee activation, and device management.
- Test device deactivation, replacement, and revocation of the old device.
- Test the agreed deactivation or deletion path for employee biometric data and operational records.
- Deliver operating, support, recovery, device-management, and account-management documentation.
- Resolve defects that block daily use or materially change calculations before final handover.

### Acceptance checks

- Daily operations, purchase orders, and the five report families run in production in the web and desktop applications.
- Three-branch comparison is available to authorized users.
- Employees check in and out through the kiosk, receive correct time confirmation, and appear correctly in attendance Excel exports.
- Accounts, devices, permissions, corrections, and audit history work as designed.
- Abdo has operating guidance, account ownership, and a clear support route.

## Proposed code and database structure

| Area | Proposed location | Core records |
|---|---|---|
| Access control | \`src/modules/access\` | Organizations, branches, users, employees, memberships, permissions |
| Daily closing | \`src/modules/closing\` | Business days, close revisions, payments, expenses, remittances, cash counts |
| Ledgers | \`src/modules/ledgers\` | Cash and purchasing-custody entries, cancellations, adjustments |
| Catalog and recipes | \`src/modules/catalog\` | Products, ingredients, units, conversions, recipes, recipe versions |
| Inventory | \`src/modules/inventory\` | Product Mix, stock movements, counts, variance, consumption |
| Comparisons | \`src/modules/comparisons\` | Branch comparison values, sources, dates, revisions |
| Replenishment | \`src/modules/replenishment\` | Forecast inputs, suggestions, purchase orders, lines, receipts |
| Reports | \`src/modules/reports\` | Template versions, field maps, export requests, source revisions |
| Attendance | \`src/modules/attendance\` | Employee IDs, kiosk devices, verification attempts, events, corrections |
| Shared application code | \`src/app\` and \`src/lib\` | Pages, server routes, validation, shared access checks |
| Database and tests | \`supabase/migrations\` and \`tests\` | Schema, RLS, constraints, unit tests, browser tests |

Financial and inventory changes use defined server commands. Each command checks user, branch, expected revision, and permission, then saves the result and audit entry in one database transaction. Reports derive from operational records. Retried commands use idempotency keys to prevent duplicates.

## Testing throughout delivery

- Calculation tests verify cash, inventory, planning, and hours against independent results.
- Database tests verify permissions, branch boundaries, retry behavior, concurrency, and transaction rollback.
- Browser tests cover journeys from sign-in through save, approval, and export in Arabic and English.
- Desktop tests cover installation, update, data shared with the web release, and Excel exports on the agreed operating systems.
- Excel tests verify values, field maps, Arabic layout, printing, and generated-file integrity.
- Camera tests run on the actual kiosk device and include valid employee use, attempted misuse, presentation attacks, device failure, and reconnect behavior.

Every phase produces a reviewable usable result. Any change affecting balances or report totals includes tests for correcting an older record and regenerating current views.

## Confirmations needed during delivery

Phase 1 can begin with the material already available once the [decisions needed before Phase 1](#decisions-needed-before-phase-1) are made. Source issues and questions go into the Phase 1 findings register and Abdo's review page. The table records when the corresponding production rules will be needed. The confirmed cutoff, close, correction, and payment rules are in [Abdo's Phase 4 decisions](phase4/ABDO_DECISIONS.md).

| Confirmation | Owner | Needed by | Work that can proceed first |
|---|---|---|---|
| Is the date in the old order sheet SRC-01 `Sheet1!C6` the order date or the delivery date? | Abdo | Phase 8, before mapping historical order dates | New orders use separate business, expected receipt and actual receipt dates |
| What is the approved live source for Al Quds and Bourgogne values, and who enters them? | Abdo | Before live branch comparison | Comparison screen and source tracking |
| Which product mappings, units, conversions, and recipes are approved? | Abdo or catalog owner | Before live inventory consumption | Catalog and review queue |
| What safety stock, coverage period, pack size, supplier minimum, cut-off, and calendar exceptions apply? | Abdo or purchasing owner | Before live replenishment recommendations | Transparent calculation and editable draft orders |
| Which report fields and layouts should be retained? | Abdo | Phase 1 decision, verified in Phases 9–10 | Inventory and map the supplied templates |
| What hosting budget, domain, recovery targets, and production owner apply? | Project owner | Before Phase 11 | Development and test environments |
| How many consecutive live business days verify the web release, and how long is the desktop trial? | Abdo and project owner | Before Phase 11 | Web delivery through Phase 10 |
| How many complete same-weekday observations does an item need before the system recommends an order? | Abdo or purchasing owner | Before Phase 8 closes | Manual purchase orders and the history view |
| Which business date should start live operations, may it be earlier than handover, and what are the reviewed opening balances and outstanding orders on that date? | Abdo | At handover in Phase 11 | Web development and testing with reference data |
| Which operating systems and branch devices should the desktop release support? | Abdo and project owner | At the start of Phase 12 | Web delivery and verification |
| Which kiosk device, enrollment procedure, break rules, and cross-midnight reporting rule apply? | Abdo and project owner | During Phases 13–14 | Attendance model and kiosk trial |

After Phase 1 closes, development can use the reviewed source material. The 2 November material is a test case. Live operating records begin on the first live business date Abdo chooses at handover.

## Decisions needed before Phase 1

| Decision | Owner | Effect on the plan |
|---|---|---|
| Must every finding have a final decision before Phase 2, or may a finding be deferred with an interim rule, an owner, and the phase by which it must be confirmed? | Abdo and project owner | Phase 1 acceptance checks and the Phase 2 start gate |
| Does "every available source" cover only `source-material/`, or also local archive files and material Abdo has not yet supplied? | Abdo and project owner | Phase 1 source inventory |
| Where is the signed-off decision record stored, and who controls its versions? (Proposed: `docs/phase1/decisions/` in the private repository, versioned in Git.) | Project owner | Phase 1 acceptance checks |
| May real reference days be entered by hand in a private test environment, with automated fixtures kept anonymized? | Abdo and project owner | Working scope, Phases 2, 4, and 10 |
| Does planning history start at the first live business date, or should selected historical consumption seed the three-month view? | Abdo | Phase 8 and the Phase 11 live cycle |

## Related document updates

This plan replaces the earlier build order in the [README](../README.md) and the initial backlog in [Decisions](DECISIONS.md). On 18 November 2026 the following documents were updated to match it:

- [Requirements](REQUIREMENTS.md): Arabic and English, the Comparison Editor role, cross-branch sales comparison as reporting-only data, planning history from the first live business date, reporting-only historical figures, the attendance Excel export, the delivery order, and narrower out-of-scope items.
- [Architecture](ARCHITECTURE.md): web first and desktop later on the same backend, and localization in the technology choices.
- [Decisions](DECISIONS.md): the confirmed delivery decisions, and the delivery sequence in place of the initial backlog.
- [Source-material inventory](SOURCE_MATERIAL.md): the private-test-environment rule for real reference days.
- [README](../README.md): the product scope, this plan and the architecture review under Active documentation, and the implementation order.
- [Architecture review](ARCHITECTURE_REVIEW.md): a note pointing to the later delivery decisions.

## Optional later improvement — Foodics import

After receiving and verifying an actual Foodics Excel or CSV export, add an import flow with preview, validation, product mapping, date checks, duplicate-file prevention, duplicate-record prevention, and changed-upload review. Test a new file, identical re-upload, partial file, and modified version. Manual entry remains available.

Direct Foodics integration and a full operational rollout for the other branches require separate scope and discovery after the core system operates successfully.

## Final delivery checklist

- [ ] Every source has been reviewed, and Abdo's decisions are recorded in the Phase 1 decision record and reflected in the report field map.
- [ ] Abdo manages users and permissions in the application.
- [ ] Abdo can see the first live business date at handover, and live operating records begin on that date with reviewed opening balances.
- [ ] One saved operating day supplies cash, inventory, replenishment, and reporting workflows.
- [ ] Cash and purchasing-custody ledgers carry forward correctly and corrections are auditable.
- [ ] Product Mix posts recipe-based consumption and inventory shows expected stock, physical stock, and variance.
- [ ] Al Quds, Maarif, Bourgogne, and selected totals compare using explicit dates and sources.
- [ ] Three-month planning explains each recommendation and purchase orders support expected and actual receipt dates.
- [ ] The five Excel report families open correctly and reconcile with the system.
- [ ] The web application has passed end-to-end and live checks in Arabic and English and works as a PWA on the branch's devices.
- [ ] The desktop application installs on the agreed devices and shares operational data and reports with the web release.
- [ ] Acceptance and regression results are recorded for each phase before the next one starts.
- [ ] Production recovery and update procedures have been tested.
- [ ] Employees have stable IDs, and the kiosk verifies the person who presents an ID.
- [ ] Check-in and check-out times are shown to employees, and Abdo can review exceptions.
- [ ] Attendance Excel totals match saved attendance events.
- [ ] Operating, recovery, access-management, and device-management guides are complete.

Set the web release dates after the source review and web foundation are complete. Schedule desktop delivery after Phase 11 closes and the attendance rollout after the camera trial confirms the device works reliably at the branch.
