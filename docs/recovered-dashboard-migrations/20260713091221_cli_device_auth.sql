-- Recovered from supabase_migrations.schema_migrations on prod.
-- Applied 20260713091221 outside the repo (dashboard SQL editor) and never
-- committed, which desynced the CLI's migration history. Restored verbatim.

CREATE TABLE IF NOT EXISTS cli_device_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'completed')),
  user_id UUID,
  client_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cli_device_codes_user_code ON cli_device_codes (user_code);
CREATE INDEX IF NOT EXISTS idx_cli_device_codes_device_code ON cli_device_codes (device_code);

ALTER TABLE cli_device_codes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE cli_device_codes IS
  'Pending CLI headless-login requests: the CLI creates a row, the signed-in merchant approves it, and the CLI polls /api/cli-auth/poll to receive a merchant session JWT.';;
