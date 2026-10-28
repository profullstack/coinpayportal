-- Operator keys (SYSTEM_MNEMONIC_*) sealed to the operator secrets vault
-- (fleet rule 2026-10-28, Round 2: the operator is just a user who unlocks).
--
-- The vault record itself lives in public.secret_vaults (subject 'operator',
-- id 'coinpay'). This adds:
--   operator_sealed_secrets  the mnemonic bundle, sealed to the vault public
--                            key ("cpv1." ciphertext); meta holds names only.
--   operator_address_pool    deposit addresses derived ahead while unlocked,
--                            keys sealed to the operator vault, claimed by
--                            checkout while the keys are locked.
--
-- Additive: apply BEFORE deploying the app that reads these tables.

create table if not exists public.operator_sealed_secrets (
  name text primary key,
  sealed text not null check (sealed like 'cpv1.%'),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.operator_sealed_secrets enable row level security;
revoke all on public.operator_sealed_secrets from anon, authenticated;

create table if not exists public.operator_address_pool (
  id uuid primary key default gen_random_uuid(),
  cryptocurrency text not null,
  derivation_index integer not null,
  address text not null unique,
  derivation_path text not null,
  key_generation smallint not null,
  sealed_private_key text not null check (sealed_private_key like 'cpv1.%'),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists operator_address_pool_unclaimed
  on public.operator_address_pool (cryptocurrency, derivation_index)
  where claimed_at is null;
alter table public.operator_address_pool enable row level security;
revoke all on public.operator_address_pool from anon, authenticated;

-- Claim one unclaimed pooled address for a coin; concurrent callers never get
-- the same row.
create or replace function public.claim_operator_pool_address(p_cryptocurrency text)
returns setof public.operator_address_pool
language sql
as $$
  update public.operator_address_pool p
     set claimed_at = now()
   where p.id = (
     select id from public.operator_address_pool
      where cryptocurrency = p_cryptocurrency and claimed_at is null
      order by derivation_index
      limit 1
      for update skip locked
   )
  returning p.*;
$$;
revoke all on function public.claim_operator_pool_address(text) from public, anon, authenticated;
grant execute on function public.claim_operator_pool_address(text) to service_role;

-- Legacy deposit-address keys still under ENCRYPTION_KEY, for the cutoff.
create or replace view public.admin_unsealed_operator_keys
  with (security_invoker = true) as
select 'payment_addresses.encrypted_private_key'::text as secret, count(*)::bigint as remaining
  from public.payment_addresses
 where encrypted_private_key is not null and encrypted_private_key not like 'cpv1.%';
revoke all on public.admin_unsealed_operator_keys from anon, authenticated;
