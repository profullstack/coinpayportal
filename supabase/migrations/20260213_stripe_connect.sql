-- Stripe Connect Integration Tables
-- Phase 1: Foundation

-- 1. stripe_accounts
CREATE TABLE IF NOT EXISTS stripe_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  stripe_account_id text UNIQUE NOT NULL,
  account_type text NOT NULL DEFAULT 'express',
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  country text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_accounts_merchant_id ON stripe_accounts(merchant_id);
CREATE INDEX idx_stripe_accounts_stripe_account_id ON stripe_accounts(stripe_account_id);

-- 2. stripe_transactions
CREATE TABLE IF NOT EXISTS stripe_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  stripe_payment_intent_id text UNIQUE,
  stripe_charge_id text,
  stripe_balance_txn_id text,
  amount bigint NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  platform_fee_amount bigint NOT NULL DEFAULT 0,
  stripe_fee_amount bigint NOT NULL DEFAULT 0,
  net_to_merchant bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  rail text NOT NULL DEFAULT 'card',
  mode text NOT NULL DEFAULT 'gateway',
  escrow_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_transactions_merchant_id ON stripe_transactions(merchant_id);
CREATE INDEX idx_stripe_transactions_status ON stripe_transactions(status);
CREATE INDEX idx_stripe_transactions_stripe_pi ON stripe_transactions(stripe_payment_intent_id);

-- 3. stripe_disputes
CREATE TABLE IF NOT EXISTS stripe_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  stripe_dispute_id text UNIQUE NOT NULL,
  stripe_charge_id text,
  amount bigint NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'needs_response',
  reason text,
  evidence_due_by timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_disputes_merchant_id ON stripe_disputes(merchant_id);
CREATE INDEX idx_stripe_disputes_status ON stripe_disputes(status);

-- 4. stripe_payouts
CREATE TABLE IF NOT EXISTS stripe_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  stripe_payout_id text UNIQUE NOT NULL,
  amount bigint NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending',
  arrival_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_payouts_merchant_id ON stripe_payouts(merchant_id);

-- 5. stripe_escrows
CREATE TABLE IF NOT EXISTS stripe_escrows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  total_amount bigint NOT NULL,
  platform_fee bigint NOT NULL DEFAULT 0,
  stripe_fee bigint NOT NULL DEFAULT 0,
  releasable_amount bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'held',
  release_after timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_escrows_merchant_id ON stripe_escrows(merchant_id);
CREATE INDEX idx_stripe_escrows_status ON stripe_escrows(status);
CREATE INDEX idx_stripe_escrows_release_after ON stripe_escrows(release_after) WHERE status = 'held';

-- 6. did_reputation_events (card-specific, extends existing reputation system)
CREATE TABLE IF NOT EXISTS did_reputation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  did text NOT NULL,
  event_type text NOT NULL,
  source_rail text NOT NULL DEFAULT 'card',
  related_transaction_id text,
  weight integer NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_did_reputation_events_did ON did_reputation_events(did);
CREATE INDEX idx_did_reputation_events_type ON did_reputation_events(event_type);
CREATE INDEX idx_did_reputation_events_rail ON did_reputation_events(source_rail);

-- Add foreign key from stripe_transactions.escrow_id to stripe_escrows
ALTER TABLE stripe_transactions
  ADD CONSTRAINT fk_stripe_transactions_escrow
  FOREIGN KEY (escrow_id) REFERENCES stripe_escrows(id);

-- RLS Policies
ALTER TABLE stripe_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_escrows ENABLE ROW LEVEL SECURITY;
ALTER TABLE did_reputation_events ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by API routes via service key)
CREATE POLICY stripe_accounts_service ON stripe_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY stripe_transactions_service ON stripe_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY stripe_disputes_service ON stripe_disputes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY stripe_payouts_service ON stripe_payouts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY stripe_escrows_service ON stripe_escrows FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY did_reputation_events_service ON did_reputation_events FOR ALL USING (true) WITH CHECK (true);
