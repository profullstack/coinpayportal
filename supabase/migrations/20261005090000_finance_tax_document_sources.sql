-- Finances: tax document sources (California FTB, IRS).
--
-- Tax agencies hold notices, letters and transcripts, not bank statements:
-- there is no account and no statement cycle, so what the fetcher downloads
-- from them is filed into the document library (finance_documents, category
-- 'tax') rather than the statement library.
--
-- 1. finance_documents learns where a document came from: `source` gains
--    'fetch' (the coinpay CLI on the merchant's machine) and 'cloud' (a CoinPay
--    cloud fetch job), plus the source's key, the tax year and the kind of
--    document when the fetcher could read them.
-- 2. One copy per file per books owner: a unique (merchant_id, sha256). If a
--    deployment already holds duplicate uploads, the index is limited to the
--    fetched rows so this migration never fails on existing data (the app
--    dedupes by sha256 before inserting either way).
-- 3. finance_site_attempts: the attempt ledger for sites that lock accounts.
--    Every cloud sign-in or fetch against a tax source is recorded BEFORE it is
--    made, and any lockout page seen is recorded with its end; the app allows
--    at most 2 attempts per 30 minutes and 4 per day per source, and none
--    during a lockout. Counts only: no URL, cookie or page content.

-- 1. Where a document came from
alter table public.finance_documents drop constraint if exists finance_documents_source_check;
alter table public.finance_documents
  add constraint finance_documents_source_check
  check (source in ('upload', 'api', 'fetch', 'cloud'));

alter table public.finance_documents
  add column if not exists institution_key text
    check (institution_key is null or institution_key ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  add column if not exists tax_year integer
    check (tax_year is null or tax_year between 1990 and 2100),
  add column if not exists doc_type text
    check (doc_type is null or doc_type in ('notice', 'letter', 'transcript', 'form', 'return', 'other'));

create index if not exists finance_documents_tax_idx
  on public.finance_documents (merchant_id, category, tax_year);

-- 2. One copy per file
do $$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'finance_documents_merchant_sha256_key'
  ) then
    return;
  end if;
  if exists (
    select 1 from public.finance_documents
    group by merchant_id, sha256 having count(*) > 1
  ) then
    raise notice 'finance_documents has duplicate (merchant_id, sha256) uploads; unique index limited to fetched rows';
    create unique index finance_documents_merchant_sha256_key
      on public.finance_documents (merchant_id, sha256)
      where source in ('fetch', 'cloud');
  else
    create unique index finance_documents_merchant_sha256_key
      on public.finance_documents (merchant_id, sha256);
  end if;
end $$;

-- 3. The attempt ledger
create table if not exists public.finance_site_attempts (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      uuid not null references public.merchants(id) on delete cascade,
  institution_key  text not null check (institution_key ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  -- connect: a cloud sign-in window opened; fetch: a fetch job visited the
  -- site; lockout: the site showed a locked-account page.
  kind             text not null check (kind in ('connect', 'fetch', 'lockout')),
  locked_until     timestamptz,
  note             text check (note is null or char_length(note) <= 200),
  created_at       timestamptz not null default now(),
  check (kind <> 'lockout' or locked_until is not null)
);

create index if not exists finance_site_attempts_lookup_idx
  on public.finance_site_attempts (merchant_id, institution_key, created_at desc);

alter table public.finance_site_attempts enable row level security;
revoke all on public.finance_site_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.finance_site_attempts to service_role;
