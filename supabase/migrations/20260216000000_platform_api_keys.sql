-- Add api_key column to reputation_issuers for platform authentication
ALTER TABLE reputation_issuers ADD COLUMN IF NOT EXISTS api_key text UNIQUE;

-- Register ugig.net as a platform issuer
INSERT INTO reputation_issuers (did, name, domain, active, api_key)
VALUES ('did:web:ugig.net', 'ugig.net', 'ugig.net', true, 'cprt_ugig_' || encode(gen_random_bytes(24), 'hex'))
ON CONFLICT (did) DO UPDATE SET active = true, name = 'ugig.net';

-- Also make sure signatures column accepts platform_sig (no schema change needed, it's jsonb)
