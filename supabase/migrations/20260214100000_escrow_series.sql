-- Recurring Escrow Series
CREATE TABLE IF NOT EXISTS escrow_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payment_method text NOT NULL CHECK (payment_method IN ('crypto', 'card')),
  customer_email text,
  description text,
  amount bigint NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  coin text,
  interval text NOT NULL CHECK (interval IN ('weekly', 'biweekly', 'monthly')),
  next_charge_at timestamptz NOT NULL,
  max_periods integer,
  periods_completed integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
  stripe_account_id text,
  beneficiary_address text,
  depositor_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add series_id to escrows
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES escrow_series(id);

-- Add series_id to stripe_escrows
ALTER TABLE stripe_escrows ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES escrow_series(id);

-- RLS
ALTER TABLE escrow_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "escrow_series_merchant_select" ON escrow_series;
CREATE POLICY "escrow_series_merchant_select" ON escrow_series
  FOR SELECT USING (merchant_id IN (
    SELECT id FROM businesses WHERE merchant_id = auth.uid()
  ));

DROP POLICY IF EXISTS "escrow_series_merchant_insert" ON escrow_series;
CREATE POLICY "escrow_series_merchant_insert" ON escrow_series
  FOR INSERT WITH CHECK (merchant_id IN (
    SELECT id FROM businesses WHERE merchant_id = auth.uid()
  ));

DROP POLICY IF EXISTS "escrow_series_merchant_update" ON escrow_series;
CREATE POLICY "escrow_series_merchant_update" ON escrow_series
  FOR UPDATE USING (merchant_id IN (
    SELECT id FROM businesses WHERE merchant_id = auth.uid()
  ));

DROP POLICY IF EXISTS "escrow_series_service_all" ON escrow_series;
CREATE POLICY "escrow_series_service_all" ON escrow_series
  FOR ALL USING (current_setting('role') = 'service_role');
