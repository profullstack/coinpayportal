-- Business categorization and risk classification.
--
-- Merchants pick a `category` and add free-form keyword `tags` when creating a
-- business. `risk_level`, `risk_flags` and `review_status` are derived by
-- src/lib/business/taxonomy.ts — never set directly by the merchant.
--
-- `category` intentionally has no check constraint: the taxonomy lives in code
-- and changes more often than the schema should.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS risk_level text,
  ADD COLUMN IF NOT EXISTS risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS classified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_risk_level_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_risk_level_check
      CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'prohibited'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_review_status_check'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_review_status_check
      CHECK (review_status IN ('not_required', 'pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses (category);
CREATE INDEX IF NOT EXISTS idx_businesses_tags ON businesses USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_businesses_review_queue
  ON businesses (created_at DESC)
  WHERE review_status = 'pending';

COMMENT ON COLUMN businesses.category IS 'Taxonomy slug from src/lib/business/taxonomy.ts';
COMMENT ON COLUMN businesses.tags IS 'Merchant-entered keywords, normalized lowercase';
COMMENT ON COLUMN businesses.risk_level IS 'Derived: low | medium | high | prohibited. NULL = never classified';
COMMENT ON COLUMN businesses.risk_flags IS 'Derived: [{code,label,severity,matched,source}] evidence for risk_level';
COMMENT ON COLUMN businesses.review_status IS 'not_required | pending | approved | rejected';
