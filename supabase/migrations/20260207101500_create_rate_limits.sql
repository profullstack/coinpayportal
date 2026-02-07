-- Rate limit storage for distributed rate limiting across multiple server instances
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,           -- e.g., "merchant_login:192.168.1.1"
  count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- Auto-cleanup old entries (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- RLS: Only service role can access (server-side only)
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON rate_limits
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE rate_limits IS 'Distributed rate limiting storage for multi-instance deployments';
