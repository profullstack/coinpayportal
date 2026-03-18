-- Fix webauthn_credentials foreign key: references merchants, not auth.users
-- The app uses custom merchants table with its own JWT, not Supabase Auth

-- Drop and recreate table with correct FK
DROP TABLE IF EXISTS webauthn_credentials;

CREATE TABLE webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  credential_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type TEXT, -- 'platform' or 'cross-platform'
  transports TEXT[], -- 'usb', 'ble', 'nfc', 'internal'
  name TEXT NOT NULL DEFAULT 'My Passkey',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_webauthn_user ON webauthn_credentials(user_id);
CREATE INDEX idx_webauthn_credential ON webauthn_credentials(credential_id);
