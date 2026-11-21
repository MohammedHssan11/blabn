-- Phase 2 audit fix: a saved cash count stores its reconciliation AT COUNT TIME as a pair.
-- Migration 20261121000002 let a row keep expected_cash while variance was NULL, because a CHECK
-- that evaluates to NULL passes. Rule from now on (field ST-08):
--   * both expected_cash and variance are NULL (opening cash, sales or card was blank, so the count
--     cannot be reconciled and is shown as unreconciled, never as a match), or
--   * both are present and variance = counted_amount - expected_cash.
-- This is a forward migration so databases that already ran 20261121000002 receive the fix.
-- Adding the constraint validates existing rows; the Phase 2 seed and fixtures already satisfy it.

alter table public.cash_counts
  drop constraint if exists variance_matches_expected;

alter table public.cash_counts
  add constraint variance_matches_expected check (
    (expected_cash is null and variance is null)
    or (
      expected_cash is not null
      and variance is not null
      and variance = counted_amount - expected_cash
    )
  );
