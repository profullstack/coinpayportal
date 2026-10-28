-- Unlock-on-use for user keys (2026-10-28).
--
-- Boltz refund/claim keys in swaps.provider_data were `enc:` blobs under
-- ENCRYPTION_KEY, a key the server holds 24/7. New rows seal them to the
-- owning web wallet's own secp256k1 public key (seal_version 2), which no
-- server key can open. Legacy rows are re-sealed once by the recovery route or
-- scripts/seal-legacy-swap-keys.mts; nothing is deleted.
--
-- merchant_dids.private_key_encrypted held auto-generated DID private keys in
-- plaintext. New claims store NULL and return the key once; legacy rows are
-- handed back once by POST /api/reputation/did/key-export, which NULLs them.

alter table public.swaps add column if not exists seal_version smallint;

comment on column public.swaps.seal_version is
  'NULL/1 = legacy key material (enc: under ENCRYPTION_KEY or plaintext); 2 = sealed to the wallet public key, server cannot open';

-- Mark existing rows that carry key material as legacy, so the remaining
-- count is a plain filter.
update public.swaps
   set seal_version = 1
 where seal_version is null
   and provider = 'boltz'
   and (provider_data ? 'refundPrivateKey' or provider_data ? 'claimPrivateKey');

-- Counts of user secrets a server key (or nothing) still protects. Service
-- role only; this is what the LEGACY_KEY_MIGRATION=off cutoff waits on.
create or replace view public.admin_unsealed_user_secrets
  with (security_invoker = true) as
select 'swaps.provider_data (boltz keys)'::text as secret, count(*)::bigint as remaining
  from public.swaps
 where provider = 'boltz' and seal_version = 1
union all
select 'merchant_dids.private_key_encrypted', count(*)
  from public.merchant_dids
 where private_key_encrypted is not null;

revoke all on public.admin_unsealed_user_secrets from anon, authenticated;
