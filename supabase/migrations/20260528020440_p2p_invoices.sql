-- P2P invoicing: link CoinPay merchant + business rows to an external
-- platform user (e.g. ugig.net) so invoices can be auto-provisioned
-- without the user ever seeing CoinPay merchant/business setup.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'self'
    CHECK (auth_provider IN ('self', 'platform'));

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS platform              text,
  ADD COLUMN IF NOT EXISTS external_user_did     text,
  ADD COLUMN IF NOT EXISTS auto_provisioned      boolean NOT NULL DEFAULT false;

-- One auto-provisioned business per (platform, external user). The partial
-- index keeps the constraint scoped to platform-owned rows; regular
-- merchant-created businesses are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_platform_external_user
  ON businesses(platform, external_user_did)
  WHERE platform IS NOT NULL AND external_user_did IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_platform
  ON businesses(platform) WHERE platform IS NOT NULL;

-- Mirror the same on clients so we can dedupe payers per business.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS platform              text,
  ADD COLUMN IF NOT EXISTS external_user_did     text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_business_platform_did
  ON clients(business_id, platform, external_user_did)
  WHERE platform IS NOT NULL AND external_user_did IS NOT NULL;
