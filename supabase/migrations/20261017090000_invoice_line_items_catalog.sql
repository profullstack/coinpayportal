-- Itemised invoices (line items, per-line tax, one discount) plus the two
-- catalogs that feed them: saved tax rates and saved products/services.
--
-- invoices.amount stays the total every payment path reads. For an itemised
-- invoice the app computes it from line_items (src/lib/invoices/line-items.ts);
-- subtotal / discount_total / tax_total are stored so lists, PDFs and reports
-- never re-derive money from JSON.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS line_items jsonb,
  ADD COLUMN IF NOT EXISTS subtotal numeric(20,2),
  ADD COLUMN IF NOT EXISTS discount jsonb,
  ADD COLUMN IF NOT EXISTS discount_total numeric(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total numeric(20,2) NOT NULL DEFAULT 0;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_line_items_array;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_line_items_array
  CHECK (line_items IS NULL OR (jsonb_typeof(line_items) = 'array' AND jsonb_array_length(line_items) BETWEEN 1 AND 100));

CREATE TABLE IF NOT EXISTS public.tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 64),
  rate numeric(6,3) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tax_rates_business ON public.tax_rates(business_id);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 500),
  unit_price numeric(20,2) NOT NULL CHECK (unit_price >= 0),
  unit text CHECK (unit IS NULL OR length(unit) <= 32),
  tax_rate_id uuid REFERENCES public.tax_rates(id) ON DELETE SET NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_business ON public.invoice_items(business_id) WHERE NOT archived;

-- Routes use the service role and authorize in src/lib/auth/authz.ts; nothing
-- else may touch these tables.
ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tax_rates, public.invoice_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_rates, public.invoice_items TO service_role;

-- Keyed creation must carry the itemised columns too.
CREATE OR REPLACE FUNCTION public.create_idempotent_invoice(
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
        crypto_currency, merchant_wallet_address, wallet_id, fee_rate, due_date, notes, metadata,
        line_items, subtotal, discount, discount_total, tax_total
      ) VALUES (
        (p_invoice->>'user_id')::uuid, p_business_id, (p_invoice->>'client_id')::uuid,
        next_number, 'draft', p_invoice->>'currency', (p_invoice->>'amount')::numeric,
        p_invoice->>'crypto_currency', p_invoice->>'merchant_wallet_address',
        (p_invoice->>'wallet_id')::uuid, (p_invoice->>'fee_rate')::numeric,
        (p_invoice->>'due_date')::timestamptz, p_invoice->>'notes',
        coalesce(p_invoice->'metadata', '{}'::jsonb),
        nullif(p_invoice->'line_items', 'null'::jsonb), (p_invoice->>'subtotal')::numeric,
        nullif(p_invoice->'discount', 'null'::jsonb),
        coalesce((p_invoice->>'discount_total')::numeric, 0),
        coalesce((p_invoice->>'tax_total')::numeric, 0)
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

NOTIFY pgrst, 'reload schema';
