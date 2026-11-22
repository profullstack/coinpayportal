-- PayPal client secrets: a second copy sealed under the server key
-- PAYPAL_SECRETS_KEY (AES-256-GCM, `ps1:` prefix, src/lib/paypal/platform-seal.ts).
--
-- The vault-sealed copy in paypal_client_secret_encrypted opens only while the
-- business owner has unlocked their secrets vault, and every deploy/restart drops
-- that unlock, which stopped PayPal checkout until a human unlocked again. This
-- copy lets receive-side PayPal API calls work with no human step. PayPal API
-- credentials only: wallet keys stay unlock-on-use.
--
-- Additive: the vault-sealed column is kept as is.

BEGIN;

ALTER TABLE paypal_accounts
    ADD COLUMN IF NOT EXISTS paypal_client_secret_platform TEXT;

COMMENT ON COLUMN paypal_accounts.paypal_client_secret_platform IS
    'PayPal client secret sealed under PAYPAL_SECRETS_KEY (ps1:), opens without the owner vault unlock';

COMMIT;

NOTIFY pgrst, 'reload schema';
