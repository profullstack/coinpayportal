-- Optional self-declared age range on a DID. A band, never a birth date.
-- Bands break at 18 and 21 so relying parties can age-gate from the band
-- alone (OAuth scope `age`: age_range, age_over_18, age_over_21,
-- age_verification = 'self_attested'). NULL = the user chose not to say.
ALTER TABLE merchant_dids ADD COLUMN IF NOT EXISTS age_range text;
ALTER TABLE merchant_dids ADD COLUMN IF NOT EXISTS age_range_updated_at timestamptz;

ALTER TABLE merchant_dids DROP CONSTRAINT IF EXISTS merchant_dids_age_range_check;
ALTER TABLE merchant_dids ADD CONSTRAINT merchant_dids_age_range_check
  CHECK (age_range IS NULL OR age_range IN ('under_18', '18_20', '21_30', '31_40', '41_50', '51_60', '61_plus'));
