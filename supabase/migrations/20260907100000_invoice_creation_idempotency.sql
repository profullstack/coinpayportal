-- Keep creation identities after draft deletion, so a delayed GitHub retry cannot
-- recreate an invoice the merchant deliberately removed.
CREATE TABLE public.invoice_creation_requests (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  source_repository text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, idempotency_key)
);
CREATE INDEX invoice_creation_requests_source_window
  ON public.invoice_creation_requests (business_id, source_repository, created_at)
  WHERE source_repository IS NOT NULL;
ALTER TABLE public.invoice_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_creation_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_creation_requests TO service_role;

CREATE FUNCTION public.create_idempotent_invoice(
  p_business_id uuid, p_key text, p_request_hash text,
  p_invoice jsonb, p_schedule jsonb DEFAULT NULL, p_repository_hourly_limit integer DEFAULT NULL
) RETURNS TABLE (invoice_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  previous public.invoice_creation_requests%ROWTYPE;
  new_id uuid;
  next_number text;
  collision text;
  attempt integer;
  source_repo text;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[!-~]{1,255}$'
     OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$'
     OR p_invoice IS NULL OR jsonb_typeof(p_invoice) <> 'object'
     OR (p_invoice->>'business_id')::uuid IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'Invalid invoice creation identity' USING ERRCODE = '22023';
  END IF;

  -- Serialize keyed creation per business. Invoice and optional schedule commit
  -- together with the key; a failed transaction leaves none of them behind.
  -- NO KEY UPDATE still serializes these requests, but allows the FK KEY SHARE
  -- locks acquired by legacy invoice inserts for the same business.
  PERFORM 1 FROM public.businesses WHERE id = p_business_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO previous FROM public.invoice_creation_requests r
    WHERE r.business_id = p_business_id AND r.idempotency_key = p_key;
  IF FOUND THEN
    IF previous.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Idempotency key reused with different terms' USING ERRCODE = 'PT409';
    END IF;
    IF previous.invoice_id IS NULL THEN
      RAISE EXCEPTION 'Original invoice was deleted' USING ERRCODE = 'PT410';
    END IF;
    RETURN QUERY SELECT previous.invoice_id, true;
    RETURN;
  END IF;

  -- Count after acquiring the lock; concurrent new keys cannot bypass the cap.
  -- Replays above do not consume capacity, even after the cap is reached.
  source_repo := lower(p_invoice #>> '{metadata,source_reference,repository}');
  IF source_repo IS NOT NULL THEN
    IF p_repository_hourly_limit IS NULL OR p_repository_hourly_limit NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'Invalid source rate limit' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.invoice_creation_requests r
        WHERE r.business_id = p_business_id AND r.source_repository = source_repo
          AND r.created_at >= now() - interval '1 hour') >= p_repository_hourly_limit THEN
      RAISE EXCEPTION 'Repository invoice rate limit reached' USING ERRCODE = 'PT429';
    END IF;
  END IF;

  FOR attempt IN 1..5 LOOP
    SELECT (coalesce(max(substring(i.invoice_number FROM '^INV-([0-9]+)$')::numeric), 0) + 1)::text
      INTO next_number FROM public.invoices i WHERE i.business_id = p_business_id;
    next_number := 'INV-' || lpad(next_number, greatest(3, length(next_number)), '0');
    BEGIN
      INSERT INTO public.invoices (
        user_id, business_id, client_id, invoice_number, status, currency, amount,
        crypto_currency, merchant_wallet_address, wallet_id, fee_rate, due_date, notes, metadata
      ) VALUES (
        (p_invoice->>'user_id')::uuid, p_business_id, (p_invoice->>'client_id')::uuid,
        next_number, 'draft', p_invoice->>'currency', (p_invoice->>'amount')::numeric,
        p_invoice->>'crypto_currency', p_invoice->>'merchant_wallet_address',
        (p_invoice->>'wallet_id')::uuid, (p_invoice->>'fee_rate')::numeric,
        (p_invoice->>'due_date')::timestamptz, p_invoice->>'notes',
        coalesce(p_invoice->'metadata', '{}'::jsonb)
      ) RETURNING id INTO new_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS collision = CONSTRAINT_NAME;
      IF collision NOT IN ('idx_invoices_business_invoice_number',
                           'invoices_business_id_invoice_number_key') OR attempt = 5 THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  IF p_schedule IS NOT NULL AND p_schedule <> 'null'::jsonb THEN
    INSERT INTO public.invoice_schedules (
      invoice_id, recurrence, custom_interval_days, next_due_date, end_date, max_occurrences
    ) VALUES (
      new_id, p_schedule->>'recurrence', (p_schedule->>'custom_interval_days')::integer,
      coalesce((p_invoice->>'due_date')::timestamptz, now()),
      (p_schedule->>'end_date')::timestamptz, (p_schedule->>'max_occurrences')::integer
    );
  END IF;
  INSERT INTO public.invoice_creation_requests (business_id, idempotency_key, request_hash, invoice_id, source_repository)
    VALUES (p_business_id, p_key, p_request_hash, new_id, source_repo);
  RETURN QUERY SELECT new_id, false;
END;
$$;
REVOKE ALL ON FUNCTION public.create_idempotent_invoice(uuid, text, text, jsonb, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_idempotent_invoice(uuid, text, text, jsonb, jsonb, integer)
  TO service_role;
