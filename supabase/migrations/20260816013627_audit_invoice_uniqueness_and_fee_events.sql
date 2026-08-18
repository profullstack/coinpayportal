-- V-010: invoice numbers are allocated with an unlocked read-then-write MAX+1,
-- so concurrent creates claim the same number. The application cannot make that
-- atomic, so the guarantee lives here: a collision becomes an error the route
-- retries instead of a silent duplicate. Verified zero existing duplicates, so
-- this is added VALID.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_business_id_invoice_number_key'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_business_id_invoice_number_key
      UNIQUE (business_id, invoice_number);
  END IF;
END $$;

-- N-015: a failed escrow fee forward was caught, logged, and forgotten — the
-- escrow was marked settled with fee_tx_hash NULL and nothing recorded that the
-- platform was still owed. The settle route now writes an escrow_events row,
-- which needs the event type permitted.
ALTER TABLE public.escrow_events DROP CONSTRAINT IF EXISTS escrow_events_event_type_check;
ALTER TABLE public.escrow_events
  ADD CONSTRAINT escrow_events_event_type_check
  CHECK (event_type IN (
    'created','pending','funded','released','settled','disputed','dispute_resolved',
    'refunded','expired','metadata_updated','multisig_created','proposal_created',
    'signature_added','tx_broadcast','fee_forward_failed'
  )) NOT VALID;
