-- Make x402 settlement able to complete at all.
--
-- `/api/x402/settle` claims a payment before touching the chain:
--
--   .update({ status: 'settling', updated_at: ... })
--   .eq('id', ...).eq('status', 'verified')
--
-- `x402_payments` has no `updated_at`. PostgREST rejects the whole statement
-- with 42703 (undefined_column), the route discards the error and reads only
-- `data`, so the claim comes back empty and every settle call — on every
-- network — returns 409 "Payment is already being settled". Settlement has
-- never succeeded, and the failure looks like a concurrency problem rather
-- than a schema one.
--
-- The column is added rather than dropped from the route because the claim
-- genuinely wants it: `settled_at` only marks terminal success, so without
-- `updated_at` there is no timestamp on a row parked in `settling` and no way
-- to find claims stranded by a crash between the claim and the settle.

ALTER TABLE x402_payments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Keep it true even for writers that forget it. The routes set it explicitly;
-- this makes any other path honest by default.
CREATE OR REPLACE FUNCTION set_x402_payments_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS x402_payments_set_updated_at ON x402_payments;
CREATE TRIGGER x402_payments_set_updated_at
  BEFORE UPDATE ON x402_payments
  FOR EACH ROW
  EXECUTE FUNCTION set_x402_payments_updated_at();

-- Find claims stranded in `settling` by a crash between claim and settle.
CREATE INDEX IF NOT EXISTS x402_payments_settling_updated_at_idx
  ON x402_payments (updated_at)
  WHERE status = 'settling';
