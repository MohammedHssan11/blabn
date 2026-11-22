# Phase 4 daily close and Yawmeya

The normal daily-close and cash-count pages use the signed-in person's Supabase session. The [confirmed Maarif workflow](ABDO_DECISIONS.md) determines the cutoff, payments, physical counter, close and correction approval. The report map links to the corresponding views. Use `BALABAN_DEMO_FIXTURES=1` to run the older demo screen and smoke examples.

## Operating steps

1. A cashier opens the selected business date. The first saved day needs the reviewed opening balances for cash and purchasing custody. The following days calculate both openings from earlier posted days. Enter the POS net sales, POS cash and card, sales by shift when available, order count and the cashier.
2. Record cash and purchasing-custody entries with their times and applicable ledger accounts. An administrator can add, edit or retire codes in the Daily Close page. Posted entries keep the code and label recorded when they were saved. The initial codes come from the reviewed November Yawmeya workbook's `Ref_` sheet. Record cancellations with order references and amounts. Keep customer contact details out of the form and notes.
3. Record cash denominations, the manager who physically counted, and the local count time. The session records who entered the count. Enter a quantity of zero for a denomination to record an empty drawer explicitly. A missing count leaves reconciliation blank.
4. The cashier sends the draft for review. The manager can count, send the day back to draft, or close it when the sales, payments, cashier and count are complete. The actual close time is independent of the selected business date.
5. Record the later bank remittance against that business date and supply the bank reference. This reduces the cash ledger balance. The previously saved expected cash and variance at count time stay as recorded. Requests with the same reference cannot book a second active remittance.
6. Submit a correction or reversal with a reason. An authorized manager can approve their own proposal. The proposal, approval or rejection, actor, linked revision and reason are visible in the revision history. A proposal leaves the effective figures in force until approval.

## Reports and calculations

PostgreSQL is the authority for branch-local time and business dates. Maarif's cutoff is 02:00 in `Africa/Casablanca`. Morocco returned to GMT on 20 September 2026 under decree 2.26.530. The tested PostgreSQL image calculated GMT for November and GMT+1 for a pre-change date. If provisioning a database, run the time-zone assertions against its PostgreSQL image before operational use. [Kingdom of Morocco announcement](https://www.cg.gov.ma/en/node/13036)

All persisted amounts in the new close revisions use integer centimes. Expected cash at count is opening cash plus POS cash and receipts, less cash expenses and remittances through the count instant. Card does not affect drawer cash. The cash ledger closing balance is based on booked movements. A variance is shown separately. Average order value uses net sales divided by orders. Card ratio uses card divided by net sales and rounds to the nearest basis point. The screen shows up to one fractional percentage digit. Zero denominators and missing figures have a blank result.

The daily sales table, daily statement and Yawmeya share the saved close data. Report exports include a branch revision basis. Reusing that basis produces the previous figures even when corrections change the current carry-forward. The saved reconciliation on a later day remains an as-counted result unless that count or its inputs are explicitly corrected. Excel templates and the production cutover remain later phases.

The live workflow uses `operating_days` and immutable `operating_day_revisions`. The previous synthetic database rows are retained for regression checks. The API can no longer directly update the prototype finance records or directly insert or modify live revisions. A per-branch transaction lock, expected revision, idempotency key and append-only audit history govern the live commands.

## Verification commands

- Run `npm run check` for type checking, unit tests and the build.
- Run `npm run db:check:phase4` on a fresh or upgraded isolated local stack before entering any operating days. The SQL acceptance cases roll back.
- Run `npm run test:phase4` with the API URL and keys for a separate empty local Supabase project and its `SUPABASE_DB_CONTAINER`. Build using the same public Supabase values. The browser check creates synthetic users, exercises the English desktop and Arabic mobile-width forms, and posts synthetic entries. Use a disposable validation stack.
- Run the private 2 November reference in the validation environment. Use `PHASE4_REFERENCE_FILE` for the case input when running the browser check and keep that JSON outside Git.
