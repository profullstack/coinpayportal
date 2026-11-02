-- Operator vault re-key backup.
--
-- A re-key (/admin/operator-vault "Re-key with a new passphrase") moves every
-- operator secret to a brand-new vault. Before it rewrites anything it copies
-- each old ciphertext here, still sealed to the OLD vault, and keeps the old
-- vault row in secret_vaults renamed to 'coinpay:retired:<time>'. The old
-- passphrase can therefore restore everything until the backup is dropped
-- (POST /api/admin/operator-vault/rekey-backups { drop }). Ciphertext only.

create table if not exists public.operator_rekey_backup (
  id bigserial primary key,
  rekey_id text not null,
  source text not null check (source in ('operator_sealed_secrets', 'payment_addresses', 'operator_address_pool')),
  row_key text not null,
  aad text not null,
  sealed text not null check (sealed like 'cpv1.%'),
  created_at timestamptz not null default now()
);

create index if not exists operator_rekey_backup_rekey_id_idx on public.operator_rekey_backup (rekey_id);

alter table public.operator_rekey_backup enable row level security;
revoke all on public.operator_rekey_backup from anon, authenticated;
grant select, insert, update, delete on public.operator_rekey_backup to service_role;
grant usage, select on sequence public.operator_rekey_backup_id_seq to service_role;

comment on table public.operator_rekey_backup is
  'Old operator ciphertexts from a vault re-key, sealed to the retired vault. Restorable with the old passphrase until dropped.';
