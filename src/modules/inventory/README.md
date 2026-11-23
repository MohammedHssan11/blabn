# Inventory

Product Mix, stock movements, physical counts, variance and recipe consumption (Phase 6). Design, rules and checks: [docs/phase6/STOCK_AND_VARIANCE.md](../../../docs/phase6/STOCK_AND_VARIANCE.md).

- `stock.ts` (server-only): reads through `app_stock_day`, `app_product_mix` and `app_stock_item_history`, and the single write path `app_stock_command`.
- `stock-forms.ts`: pure form parsing and the permission each command needs (unit-tested in `tests/stock.test.ts`).
- `stock-actions.ts`: the one server action behind every stock form.
- `stock-ui.tsx`: shared display pieces (signed exact quantities, tabs, the form wrapper with its request identifier).
- `adjustments.ts` / `actions.ts`: the Phase 3 reason-only skeleton behind `/inventory/adjustments`, kept for compatibility.

PostgreSQL calculates expected stock, variance and Product Mix reconciliation, and these modules only display them. A blank count is never treated as zero. Quantities stay exact fractions.
