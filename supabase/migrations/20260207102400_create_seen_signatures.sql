-- Signature replay prevention for distributed deployments
-- Stores recently used signature hashes to prevent replay attacks

CREATE TABLE IF NOT EXISTS seen_signatures (
  hash TEXT PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_seen_signatures_seen_at ON seen_signatures(seen_at);

-- RLS: Only service role can access (server-side only)
ALTER TABLE seen_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON seen_signatures
  FOR ALL USING (auth.role() = 'service_role');

-- Auto-cleanup function (remove signatures older than 5 minutes)
CREATE OR REPLACE FUNCTION cleanup_seen_signatures()
RETURNS void AS $$
BEGIN
  DELETE FROM seen_signatures WHERE seen_at < NOW() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE seen_signatures IS 'Replay prevention - tracks used signatures within 5-minute window';
