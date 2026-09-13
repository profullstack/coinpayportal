-- The deployed payout table predates the fields used by the list endpoint,
-- payout creation and payout.paid webhook. Selecting updated_at returned 42703
-- for every GET, even when there were no payouts. Description inserts failed too.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';

ALTER TABLE public.stripe_payouts
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Preserve the last timestamp we actually know for historical payouts.
UPDATE public.stripe_payouts
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE public.stripe_payouts
  ALTER COLUMN updated_at SET DEFAULT now();

DROP TRIGGER IF EXISTS stripe_payouts_updated_at ON public.stripe_payouts;
CREATE TRIGGER stripe_payouts_updated_at
  BEFORE UPDATE ON public.stripe_payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
COMMIT;
