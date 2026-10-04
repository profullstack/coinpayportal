-- Finances: a document library for business reports that CoinPay did not
-- generate itself: a monthly spend report, an accountant's workpapers, a tax
-- notice. Shown with generated reports and emailed packs on /finances/history.
--
-- The bytes live encrypted on the files volume like statements and report
-- artifacts (src/lib/finances/files.ts, kind 'documents'); this row is the
-- index. Owned by the books' owner (merchant_id); `uploaded_by` records who
-- added it when a teammate with finance access did.

create table if not exists public.finance_documents (
  id                 uuid primary key default gen_random_uuid(),
  merchant_id        uuid not null references public.merchants(id) on delete cascade,
  title              text not null check (char_length(title) between 1 and 200),
  category           text not null default 'report'
                       check (category in ('report', 'statement', 'tax', 'invoice', 'other')),
  period_label       text check (period_label is null or char_length(period_label) <= 60),
  notes              text check (notes is null or char_length(notes) <= 2000),
  original_filename  text,
  content_type       text not null,
  bytes              integer not null,
  sha256             text not null,
  object_key         text not null unique,
  source             text not null default 'upload' check (source in ('upload', 'api')),
  uploaded_by        uuid references public.merchants(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists finance_documents_merchant_idx
  on public.finance_documents (merchant_id, created_at desc);

alter table public.finance_documents enable row level security;
revoke all on public.finance_documents from public, anon, authenticated;
grant select, insert, update, delete on public.finance_documents to service_role;
