-- NEW-19 (2026-08-19 audit): /api/partners publishes every merchant's webhook
-- host, with no opt-in.
--
-- The route selected every active business with a non-null `webhook_url` and
-- published its name, description and the HOST of its webhook endpoint. Nobody
-- consented to that. A merchant whose webhook points at a subdomain they did
-- not intend to advertise — or at infrastructure whose existence is itself a
-- hint — had it listed publicly by virtue of having configured a webhook at
-- all.
--
-- At the time of writing, 28 businesses met the publish criteria.
--
-- The column defaults to FALSE, which means the partners page is EMPTY until
-- merchants opt in. That is deliberate: consent cannot be assumed retroactively
-- for a directory nobody was asked to join. If consent already exists out of
-- band for some or all of them, backfill it explicitly, e.g.
--
--   update businesses set public_directory_opt_in = true where id in (...);
--
-- which is a decision for a human, not a migration.

alter table public.businesses
  add column if not exists public_directory_opt_in boolean not null default false;

comment on column public.businesses.public_directory_opt_in is
  'Merchant has explicitly agreed to appear in the public /api/partners directory. Defaults false: the directory previously published every business with a webhook_url without asking.';

create index if not exists idx_businesses_public_directory
  on public.businesses(public_directory_opt_in)
  where public_directory_opt_in;
