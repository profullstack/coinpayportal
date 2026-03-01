-- Durable retry queue for business_collection_payments forwarding
BEGIN;

CREATE TABLE IF NOT EXISTS business_collection_forwarding_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL UNIQUE REFERENCES business_collection_payments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'processing', 'dead', 'resolved')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  last_response JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_collection_forwarding_queue_retry
  ON business_collection_forwarding_queue(status, next_retry_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_business_collection_forwarding_queue_payment_id
  ON business_collection_forwarding_queue(payment_id);

ALTER TABLE business_collection_forwarding_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to business_collection_forwarding_queue"
  ON business_collection_forwarding_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
