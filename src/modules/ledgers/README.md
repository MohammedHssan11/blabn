# Ledgers

Cash and purchasing-custody entries, cancellations and adjustments. Carries each ledger's closing balance into the next day's opening balance (LG-06, LG-07).

Built in Phase 4 (see docs/IMPLEMENTATION_PLAN.md). Phase 2 provides only this placeholder so the module boundaries exist.

Rules that apply here: financial, stock and report calculations run in server code; saved values are the same in Arabic and English; a blank (NULL) is never treated as zero.
