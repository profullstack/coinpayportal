-- CPTL Phase 2: Add action_category and action_type to reputation_receipts
ALTER TABLE reputation_receipts
  ADD COLUMN IF NOT EXISTS action_category text DEFAULT 'economic.transaction',
  ADD COLUMN IF NOT EXISTS action_type text;

CREATE INDEX IF NOT EXISTS idx_reputation_receipts_action_category ON reputation_receipts(action_category);

-- Backfill existing rows: map outcome to action_category
UPDATE reputation_receipts
  SET action_category = CASE
    WHEN dispute = true THEN 'economic.dispute'
    ELSE 'economic.transaction'
  END
  WHERE action_category IS NULL OR action_category = 'economic.transaction';
