-- Medium/low audit findings — database layer.
--
-- Every claim below was checked against production before being written, by
-- assuming the `anon` role and reading. That mattered: most of these findings
-- are LATENT rather than live, because this application authenticates with its
-- own JWT and talks to Postgres as service_role, so `auth.uid()` is never set
-- and the RLS policies that reference it deny everyone. The exception is
-- reputation_receipts, which really is world-readable today.
--
-- Idempotent; safe to re-run.

-- =====================================================
-- CORRECTION to migration 20260815000000 (P-013, P-014)
--
-- That migration used column-level REVOKE:
--
--   REVOKE SELECT (release_token, beneficiary_token) ON escrows FROM authenticated;
--   REVOKE SELECT (api_key) ON reputation_issuers FROM authenticated;
--
-- Those were NO-OPS. Supabase grants table-level SELECT to anon and
-- authenticated, and a table-level grant already permits every column —
-- revoking a column subset does not subtract from it. Verified after the fact:
-- has_column_privilege('authenticated','escrows','release_token','SELECT')
-- still returned true.
--
-- Neither table has any legitimate anon/authenticated access — the API layer
-- reaches them as service_role, and their RLS policies deny everyone else — so
-- the honest fix is to remove the table-level grant outright rather than try to
-- carve columns out of it.
-- =====================================================
REVOKE ALL ON TABLE public.escrows FROM anon, authenticated;
REVOKE ALL ON TABLE public.reputation_issuers FROM anon, authenticated;

-- =====================================================
-- V-018 — legacy API keys in clear (businesses.api_key)
-- P-016 — Stripe webhook secret in clear
--
-- Same shape, same fix: no anon/authenticated caller has business here.
-- businesses.api_key is the deprecated pre-scoped-keys credential;
-- stripe_webhook_secrets.secret verifies Stripe signatures.
-- =====================================================
REVOKE ALL ON TABLE public.businesses FROM anon, authenticated;
REVOKE ALL ON TABLE public.stripe_webhook_secrets FROM anon, authenticated;

-- Payments and invoices are likewise service_role-only in this application.
-- Their RLS policies already deny anon/authenticated; this removes the grant
-- as well, so a future policy change cannot silently open them.
REVOKE ALL ON TABLE public.payments FROM anon, authenticated;
REVOKE ALL ON TABLE public.invoices FROM anon, authenticated;

-- =====================================================
-- P-029 — public receipts with amounts  (THE LIVE ONE)
--
-- reputation_receipts is readable by anon with USING (true), and production
-- holds 13,711 rows carrying `amount` (up to 999,999) and `escrow_tx`. Anyone
-- with the publishable anon key could enumerate every transaction value and its
-- on-chain link.
--
-- Public verifiability is the point of a reputation receipt, so the row stays
-- readable — but the financial columns do not. Because a table-level grant
-- cannot be narrowed by a column-level revoke (see the correction above), the
-- table grant is dropped and the permitted columns are granted back explicitly.
--
-- NOTE FOR CONSUMERS: a bare `SELECT *` as anon now fails. Name the columns,
-- e.g. PostgREST `?select=receipt_id,agent_did,outcome,artifact_hash`.
-- =====================================================
REVOKE ALL ON TABLE public.reputation_receipts FROM anon, authenticated;
GRANT SELECT (
  id, receipt_id, task_id, agent_did, buyer_did, platform_did,
  currency, category, sla, outcome, dispute, artifact_hash, signatures,
  created_at, finalized_at, action_category, action_type
) ON public.reputation_receipts TO anon, authenticated;

COMMENT ON COLUMN public.reputation_receipts.amount IS
  'Transaction value. NOT granted to anon/authenticated — publishing it made every '
  'receipt amount bulk-readable by anyone holding the publishable key. Read it via '
  'service_role in an API route that applies its own authorization.';
COMMENT ON COLUMN public.reputation_receipts.escrow_tx IS
  'On-chain settlement reference. Not granted to anon/authenticated: together with '
  'amount it deanonymizes counterparties against the public chain.';

-- =====================================================
-- P-002 — did_reputation_events public for anon
--
-- SELECT was granted to anon/authenticated with USING (true). The table is
-- empty today, and the /api/reputation/* routes read it as service_role, so
-- nothing depends on the public grant.
-- =====================================================
DROP POLICY IF EXISTS "Anyone can view DID reputation events" ON public.did_reputation_events;
REVOKE ALL ON TABLE public.did_reputation_events FROM anon, authenticated;

-- =====================================================
-- P-026 — cross-tenant INSERT on invoices
--
-- The INSERT policy checked only `user_id = auth.uid()`. invoices also carries
-- business_id, which was unconstrained — so a user could file an invoice into
-- someone else's business while keeping their own user_id on the row.
-- =====================================================
DROP POLICY IF EXISTS "Users can insert their own invoices" ON public.invoices;
CREATE POLICY "Users can insert their own invoices"
  ON public.invoices FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      business_id IS NULL
      OR business_id IN (SELECT id FROM public.businesses WHERE merchant_id = auth.uid())
    )
  );

-- =====================================================
-- P-027 — payments INSERT policy accepts an arbitrary status
--
-- The policy constrained business_id but not status, so a merchant could insert
-- a row already marked 'confirmed' or 'forwarded' — inventing settled volume
-- without any payment, and polluting reconciliation. A payment may only ever be
-- created pending; every later transition goes through the service layer.
-- =====================================================
DROP POLICY IF EXISTS "Merchants can create payments" ON public.payments;
CREATE POLICY "Merchants can create payments"
  ON public.payments FOR INSERT
  WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE merchant_id = auth.uid())
    AND status = 'pending'
  );

-- =====================================================
-- N-021 — orphan 'cancelled' state on payments
--
-- 'cancelled' is permitted by the CHECK constraint but nothing writes it and
-- nothing handles it; production holds zero such rows. An allowed state with no
-- transition into it is a hole in the state machine — it widens what the INSERT
-- policy above can accept for no benefit.
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payments WHERE status = 'cancelled') THEN
    ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_status_check
      CHECK (status IN ('pending','confirmed','forwarding','forwarded','forwarding_failed','expired'));
  ELSE
    RAISE NOTICE 'payments.status=cancelled rows exist; leaving the constraint alone';
  END IF;
END $$;

-- =====================================================
-- P-028 — calendar_events.user_id has no foreign key
--
-- Orphan rows survive a merchant deletion, and nothing stops a bogus uuid.
-- Added NOT VALID so pre-existing rows do not block the migration.
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_user_id_fkey'
  ) THEN
    ALTER TABLE public.calendar_events
      ADD CONSTRAINT calendar_events_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.merchants(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

-- =====================================================
-- P-025 — escrow_series.merchant_id is mislabeled
--
-- The column is named merchant_id but references businesses(id). Renaming it
-- would break live code for a naming problem, so it is documented instead:
-- the misleading part is the name, and the risk is a future query joining it to
-- merchants and silently matching nothing.
-- =====================================================
COMMENT ON COLUMN public.escrow_series.merchant_id IS
  'MISNAMED: this references businesses(id), NOT merchants(id). Join it to businesses. '
  'Kept under the old name because live code reads it; treat it as business_id.';

-- =====================================================
-- P-023 — RPC functions callable by anon/authenticated
--
-- 21 functions were EXECUTE-able by anon. None are SECURITY DEFINER, so they
-- run as the caller and RLS still applies — calling cleanup_seen_signatures()
-- as anon succeeds but deletes zero rows. That makes this a defense-in-depth
-- gap rather than a live hole, and it is one policy edit away from becoming
-- real. Only the service role needs any of them.
--
-- The trigger functions (update_*_updated_at) are deliberately included: they
-- are only ever invoked by triggers, which run regardless of EXECUTE grants.
-- =====================================================
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'can_create_transaction','cleanup_expired_challenges','cleanup_rate_limits',
        'cleanup_seen_signatures','expire_old_payments','expire_pending_payments',
        'generate_invoice_number','get_current_month_usage','get_pending_payments_for_monitoring',
        'get_wallet_balance_summary','has_feature','increment_transaction_count',
        'initialize_merchant_settings','update_calendar_events_updated_at',
        'update_escrows_updated_at','update_ln_offer_aggregates',
        'update_payment_addresses_updated_at','update_swaps_updated_at',
        'update_system_wallet_indexes_updated_at','update_updated_at_column',
        'update_wallet_last_active'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;

-- =====================================================
-- V-010 — INV-### collision
--
-- Invoice numbers are allocated with a read-then-write MAX+1, both in the API
-- route and in generate_invoice_number(). Neither takes a lock, so two invoices
-- created at the same moment claim the same number and both are stored. There
-- is no way to make that atomic from the application, so the guarantee goes
-- here: a collision becomes an error the route retries, instead of a silent
-- duplicate. Verified zero existing duplicates before adding it, so it is VALID
-- rather than NOT VALID.
-- =====================================================
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

-- =====================================================
-- N-015 — a failed escrow fee forward left no trace
--
-- The settle route caught the failure, logged it, and marked the escrow settled
-- with fee_tx_hash NULL. Nothing recorded that the platform was still owed, so
-- the loss was invisible. It now writes an escrow_events row, which needs the
-- event type to be permitted.
-- =====================================================
ALTER TABLE public.escrow_events DROP CONSTRAINT IF EXISTS escrow_events_event_type_check;
ALTER TABLE public.escrow_events
  ADD CONSTRAINT escrow_events_event_type_check
  CHECK (event_type IN (
    'created','pending','funded','released','settled','disputed','dispute_resolved',
    'refunded','expired','metadata_updated','multisig_created','proposal_created',
    'signature_added','tx_broadcast','fee_forward_failed'
  )) NOT VALID;

-- =====================================================
-- N-014 — no idempotency in payment creation
--
-- Creating a payment allocates an HD address, spends a unit of monthly quota
-- and quotes a price, so a client retrying after a timeout used to get a second
-- payment for the same order every time. The route now honours an
-- Idempotency-Key, and this index is what makes that safe under concurrency:
-- the pre-insert lookup is a read-then-write, so two retries arriving together
-- would both find nothing and both insert.
--
-- Partial, so payments without a key pay no cost.
-- =====================================================
CREATE UNIQUE INDEX IF NOT EXISTS payments_business_idempotency_key_uidx
  ON public.payments (business_id, ((metadata ->> 'idempotency_key')))
  WHERE metadata ->> 'idempotency_key' IS NOT NULL;

COMMENT ON INDEX public.payments_business_idempotency_key_uidx IS
  'Enforces one payment per (business, Idempotency-Key).';
