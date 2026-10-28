-- Secrets vault: unlock-on-use for merchant secrets CoinPay uses unattended
-- (fleet rule 2026-10-28).
--
-- A vault record holds only ciphertext and KDF parameters: a data key wrapped
-- by a passphrase-derived key (PBKDF2-SHA256 600k + HKDF) and optionally by a
-- recovery key, a key check, and a P-256 key pair whose private half is sealed
-- under the data key. Secrets are sealed to the public half ("cpv1." values).
-- Nothing stored here or in app.env opens them; the owner unlocks by sending
-- the data key, which the server keeps in process memory with a TTL.
--
-- Additive: apply BEFORE deploying the app that writes seal_version.

create table if not exists public.secret_vaults (
  subject_type text not null check (subject_type in ('merchant', 'operator')),
  subject_id text not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (subject_type, subject_id)
);

alter table public.secret_vaults enable row level security;
revoke all on public.secret_vaults from anon, authenticated;

comment on table public.secret_vaults is
  'Passphrase-wrapped vault records (ciphertext only). The server cannot open anything sealed to them without an owner unlock.';

-- seal_version: NULL/1 = legacy (server key), 2 = sealed to the owner's vault.
alter table public.finance_connections add column if not exists seal_version smallint;
alter table public.merchant_crawlproof_connections add column if not exists seal_version smallint;
alter table public.business_payout_wallets add column if not exists seal_version smallint;
alter table public.paypal_accounts add column if not exists seal_version smallint;

update public.finance_connections set seal_version = 1
 where seal_version is null and coalesce(access_url_encrypted, '') <> '';
update public.merchant_crawlproof_connections set seal_version = 1
 where seal_version is null and token_encrypted is not null;
update public.business_payout_wallets set seal_version = 1
 where seal_version is null and encrypted_private_key is not null;
update public.paypal_accounts set seal_version = 1
 where seal_version is null and paypal_client_secret_encrypted is not null;

-- What the LEGACY_KEY_MIGRATION=off cutoff waits on. Service role only.
create or replace view public.admin_unsealed_user_secrets
  with (security_invoker = true) as
select 'swaps.provider_data (boltz keys)'::text as secret, count(*)::bigint as remaining
  from public.swaps
 where provider = 'boltz' and seal_version = 1
union all
select 'merchant_dids.private_key_encrypted', count(*)
  from public.merchant_dids
 where private_key_encrypted is not null
union all
select 'finance_connections.access_url_encrypted', count(*)
  from public.finance_connections
 where coalesce(access_url_encrypted, '') <> '' and access_url_encrypted not like 'cpv1.%'
union all
select 'merchant_crawlproof_connections.token_encrypted', count(*)
  from public.merchant_crawlproof_connections
 where token_encrypted is not null and token_encrypted not like 'cpv1.%'
union all
select 'business_payout_wallets.encrypted_private_key', count(*)
  from public.business_payout_wallets
 where encrypted_private_key is not null and encrypted_private_key not like 'cpv1.%'
union all
select 'paypal_accounts.paypal_client_secret_encrypted', count(*)
  from public.paypal_accounts
 where paypal_client_secret_encrypted is not null and paypal_client_secret_encrypted not like 'cpv1.%';

revoke all on public.admin_unsealed_user_secrets from anon, authenticated;
