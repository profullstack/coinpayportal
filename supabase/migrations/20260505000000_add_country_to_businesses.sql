ALTER TABLE businesses ADD COLUMN IF NOT EXISTS country TEXT;

COMMENT ON COLUMN businesses.country IS 'ISO-3166-1 alpha-2 country code (uppercase) selected during Stripe Connect onboarding. Immutable on Stripe side once an account is created.';
