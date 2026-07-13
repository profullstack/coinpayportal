-- Migration: CLI device auth (headless login)
-- Description: cli_device_codes table for the "show URL, approve on desktop, CLI
--   polls" headless login flow (RFC 8628-style device flow). The CLI creates a
--   row, the signed-in merchant approves it in the browser, and the CLI polls
--   until it receives a merchant session token (the same credential a password
--   login yields), which it stores and uses for all API calls.
-- Date: 2026-07-13

CREATE TABLE IF NOT EXISTS cli_device_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code TEXT NOT NULL UNIQUE,      -- CLI's polling secret (unguessable)
  user_code TEXT NOT NULL UNIQUE,        -- short human-typed code shown in the terminal
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'completed')),
  user_id UUID,                          -- merchants.id of the approving merchant
  client_name TEXT,                      -- requesting machine hostname, for display
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cli_device_codes_user_code ON cli_device_codes (user_code);
CREATE INDEX IF NOT EXISTS idx_cli_device_codes_device_code ON cli_device_codes (device_code);

-- Server-side (service-role) access only; RLS on with no policies denies direct
-- anon/authenticated access.
ALTER TABLE cli_device_codes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE cli_device_codes IS
  'Pending CLI headless-login requests: the CLI creates a row, the signed-in merchant approves it, and the CLI polls /api/cli-auth/poll to receive a merchant session JWT.';
