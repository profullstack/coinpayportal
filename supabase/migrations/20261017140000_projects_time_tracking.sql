-- Projects and time tracking, billed onto itemised invoices.

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  hourly_rate numeric(20,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  budget_hours numeric(10,2) CHECK (budget_hours IS NULL OR budget_hours > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_business ON public.projects(business_id);

CREATE TABLE IF NOT EXISTS public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  started_at timestamptz NOT NULL DEFAULT now(),
  -- A running timer has no minutes yet; a stopped or manual entry has them.
  ended_at timestamptz,
  minutes integer CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 100000),
  billable boolean NOT NULL DEFAULT true,
  hourly_rate numeric(20,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  -- Set when billed. Deleting a draft invoice frees its entries again.
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minutes IS NOT NULL OR ended_at IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_time_entries_project ON public.time_entries(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_entries_unbilled ON public.time_entries(project_id)
  WHERE invoice_id IS NULL AND billable;
-- One running timer per person.
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_running ON public.time_entries(merchant_id)
  WHERE minutes IS NULL;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projects, public.time_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects, public.time_entries TO service_role;

NOTIFY pgrst, 'reload schema';
