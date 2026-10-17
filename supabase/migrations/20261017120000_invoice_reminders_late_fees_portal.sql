-- Per-business invoice settings (reminder schedule, late fee, branding), a log
-- that makes each reminder and late fee happen exactly once, client portal
-- links, and the pointer from a late-fee invoice to the invoice it is for.

CREATE TABLE IF NOT EXISTS public.invoice_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  reminders_enabled boolean NOT NULL DEFAULT true,
  -- Days relative to the due date: -3 = three days before, 0 = on the day, 7 = a week late.
  reminder_days integer[] NOT NULL DEFAULT '{0}'
    CHECK (cardinality(reminder_days) <= 10 AND -60 <= ALL(reminder_days) AND 365 >= ALL(reminder_days)),
  late_fee_type text NOT NULL DEFAULT 'none' CHECK (late_fee_type IN ('none', 'percent', 'fixed')),
  late_fee_value numeric(20,2) CHECK (late_fee_value IS NULL OR late_fee_value > 0),
  late_fee_after_days integer NOT NULL DEFAULT 0 CHECK (late_fee_after_days BETWEEN 0 AND 365),
  brand_color text CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url text CHECK (logo_url IS NULL OR (logo_url ~ '^https://' AND length(logo_url) <= 500)),
  invoice_footer text CHECK (invoice_footer IS NULL OR length(invoice_footer) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (late_fee_type = 'none' OR late_fee_value IS NOT NULL),
  CHECK (late_fee_type <> 'percent' OR late_fee_value <= 100)
);

-- Insert-first: a row is claimed before the email or fee invoice goes out, so
-- two monitor processes can never both act on the same step.
CREATE TABLE IF NOT EXISTS public.invoice_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reminder', 'late_fee')),
  offset_days integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  error text,
  related_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, kind, offset_days)
);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice ON public.invoice_reminders(invoice_id);

-- The old monitor already emailed every invoice that is overdue now; record
-- that so the new schedule does not send the on-due reminder a second time.
INSERT INTO public.invoice_reminders (invoice_id, kind, offset_days, status)
  SELECT id, 'reminder', 0, 'sent' FROM public.invoices WHERE status = 'overdue'
  ON CONFLICT (invoice_id, kind, offset_days) DO NOTHING;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS late_fee_for_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_late_fee_for ON public.invoices(late_fee_for_invoice_id)
  WHERE late_fee_for_invoice_id IS NOT NULL;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS portal_token text,
  ADD COLUMN IF NOT EXISTS portal_token_created_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_portal_token ON public.clients(portal_token)
  WHERE portal_token IS NOT NULL;

ALTER TABLE public.invoice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_settings, public.invoice_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_settings, public.invoice_reminders TO service_role;

NOTIFY pgrst, 'reload schema';
