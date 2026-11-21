# Replenishment

Forecast inputs, suggestions, purchase orders and receipts. Order creation, expected receipt and actual receipt are separate dates; the meaning of the legacy order-sheet date is confirmed in Phase 8 (P1-35).

Built in Phase 8 (see docs/IMPLEMENTATION_PLAN.md). Phase 2 provides only this placeholder so the module boundaries exist.

Rules that apply here: financial, stock and report calculations run in server code; saved values are the same in Arabic and English; a blank (NULL) is never treated as zero.
