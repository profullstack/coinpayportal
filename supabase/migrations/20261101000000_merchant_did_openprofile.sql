ALTER TABLE merchant_dids
  ADD COLUMN IF NOT EXISTS openprofile_url text;

ALTER TABLE merchant_dids
  DROP CONSTRAINT IF EXISTS merchant_dids_openprofile_url_https;

ALTER TABLE merchant_dids
  ADD CONSTRAINT merchant_dids_openprofile_url_https
  CHECK (
    openprofile_url IS NULL OR (
      length(openprofile_url) <= 2048 AND
      openprofile_url ~ '^https://[^[:space:]]+$'
    )
  );
