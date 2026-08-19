-- R3-DIN-03 (2026-08-19 audit): `settle_failed` is written by the code and
-- rejected by the constraint.
--
-- `escrow-monitor.ts` writes `status = 'settle_failed'` when a settlement
-- re-send fails, and `escrows_status_check` does not list that value. Verified
-- against production with a self-rolling-back probe UPDATE: the write is
-- REJECTED. The caller does not check the result, so the escrow is silently
-- left `released` with no flag that settlement failed — exactly the state an
-- operator would need to see.
--
-- Note on the NOT VALID marker: rows with `settle_failed` do exist in
-- production, which looks like the constraint is not enforcing. It is. NOT
-- VALID skips checking rows that already existed when the constraint was added;
-- it does not exempt new INSERTs or UPDATEs. Those rows predate the constraint.
--
-- The replacement is added NOT VALID for the same reason the original was: the
-- table holds historical values (`settle_failed` among them) that should not
-- block the migration. New writes are checked either way, which is the point.

alter table public.escrows
  drop constraint if exists escrows_status_check;

alter table public.escrows
  add constraint escrows_status_check check (
    status = any (array[
      'created',
      'pending',
      'funded',
      'released',
      'settled',
      'settle_failed',
      'disputed',
      'refunded',
      'expired'
    ])
  ) not valid;
