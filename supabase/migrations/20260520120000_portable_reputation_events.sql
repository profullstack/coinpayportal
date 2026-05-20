-- Portable reputation events: turn did_reputation_events into a signed,
-- cross-app event log that any platform (CoinPayPortal, uGig, c0mpute,
-- d0rz, CrawlProof, …) can write to and any consumer can verify.
--
-- source_did identifies the platform that emitted the event — the
-- connective tissue that lets one DID accrue reputation across every app
-- in the ecosystem. signature + event_id make events verifiable and
-- idempotent so writes from external services can be trusted on read.
--
-- This also adds the columns the Stripe webhook already writes
-- (source_rail, related_transaction_id, weight, metadata), which were
-- missing from the prior consolidated schema.

ALTER TABLE did_reputation_events
  ADD COLUMN IF NOT EXISTS source_did             text,
  ADD COLUMN IF NOT EXISTS source_rail            text,
  ADD COLUMN IF NOT EXISTS category               text,
  ADD COLUMN IF NOT EXISTS weight                 integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS related_transaction_id text,
  ADD COLUMN IF NOT EXISTS metadata               jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS signature              text,
  ADD COLUMN IF NOT EXISTS event_id               uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_did_rep_events_event_id
  ON did_reputation_events(event_id) WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_did_rep_events_did      ON did_reputation_events(did);
CREATE INDEX IF NOT EXISTS idx_did_rep_events_source   ON did_reputation_events(source_did)  WHERE source_did IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_did_rep_events_type     ON did_reputation_events(event_type);
CREATE INDEX IF NOT EXISTS idx_did_rep_events_created  ON did_reputation_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_did_rep_events_category ON did_reputation_events(category)    WHERE category IS NOT NULL;

-- Service role needs to insert; SELECT policy already exists from the
-- consolidate migration.
DO $$BEGIN
  CREATE POLICY "service_role_insert_did_events"
    ON did_reputation_events FOR INSERT
    TO service_role
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END$$;
