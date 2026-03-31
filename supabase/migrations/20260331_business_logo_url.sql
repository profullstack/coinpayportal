-- Add logo_url column to businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Populate existing business logos
UPDATE businesses SET logo_url = 'https://bittorrented.com/logo.svg' WHERE name = 'bitorrented.com' AND logo_url IS NULL;
UPDATE businesses SET logo_url = 'https://ugig.net/logo.svg' WHERE name = 'ugig.net' AND logo_url IS NULL;
UPDATE businesses SET logo_url = 'https://postammo.com/logo.svg' WHERE name = 'postammo.com' AND logo_url IS NULL;
UPDATE businesses SET logo_url = 'https://icemap.app/logo.svg' WHERE name = 'icemap.app' AND logo_url IS NULL;
