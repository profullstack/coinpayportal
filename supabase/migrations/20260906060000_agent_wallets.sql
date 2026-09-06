-- Agent wallets: a bot's identity, and what it is allowed to spend.
--
-- The crawler paywall works because a machine can pay for what it fetches. The
-- thing standing between that and a market is trust in the other direction:
-- nobody funds a wallet an autonomous program can drain. Today our own crawler
-- is one private key shared across six services with no ceiling on it, which is
-- fine for a wallet we watch and useless as a product.
--
-- So an agent gets an identity, an address, and limits. The limits are the
-- point. Everything else here exists to make them enforceable.
--
-- WHERE THIS IS ENFORCED, AND WHERE IT IS NOT.
--
-- On the x402 v2 rail the payer signs an EIP-3009 authorization and broadcasts
-- nothing; settling *is* the broadcast, and our relayer does it. That makes the
-- moment before the broadcast the one place a spend can still be refused, with
-- the money not yet moved. That is where the check goes.
--
-- It follows that these limits bind an agent that pays through us, which is the
-- whole point of paying through us: the relayer covers the gas. An agent that
-- holds its own key can always sign and broadcast a transfer directly and no
-- row in this table can stop it. Saying so plainly is better than implying a
-- custody we do not have and do not want -- on this rail the buyer pays the
-- merchant directly and no house wallet is in the path.

create table if not exists public.agent_wallets (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references businesses(id) on delete cascade,

  -- Operator-facing name, e.g. "rssamplifier crawler".
  name                   text not null check (length(btrim(name)) > 0),

  -- The payer address, lowercased. EVM addresses are case-insensitive and
  -- arrive in mixed checksum case, so anything that compares them must agree on
  -- one spelling; storing the fold is what lets the settle path look an agent
  -- up with an equality test instead of a scan.
  address                text not null check (address = lower(address)),

  -- paused stops spending while keeping the row and its history; revoked is
  -- final. Neither deletes the ledger, because the ledger is the audit trail.
  status                 text not null default 'active'
                           check (status in ('active', 'paused', 'revoked')),

  -- Null means no limit of that kind. All three are USD.
  per_payment_limit_usd  numeric(12, 2) check (per_payment_limit_usd > 0),
  daily_limit_usd        numeric(12, 2) check (daily_limit_usd > 0),
  total_limit_usd        numeric(12, 2) check (total_limit_usd > 0),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.agent_wallets is
  'A bot''s wallet and its spending limits. Enforced at x402 v2 settle, which '
  'is the last moment before our relayer broadcasts the transfer.';

comment on column public.agent_wallets.address is
  'Payer address, lowercased. The settle path looks an agent up by this alone.';

comment on column public.agent_wallets.status is
  'active, paused (reversible stop) or revoked (final). Neither stop deletes '
  'the spend ledger.';

-- One address belongs to one agent, across every business. The settle path
-- knows only the payer address, so two businesses claiming the same address
-- would make that lookup ambiguous and the limits meaningless.
create unique index if not exists agent_wallets_address_key
  on public.agent_wallets (address);

create index if not exists agent_wallets_business_idx
  on public.agent_wallets (business_id);


-- Every spend we let through, which is what the daily and lifetime limits are
-- computed from. Written only after the broadcast succeeds: a refused or failed
-- settle must not consume an agent's allowance.
create table if not exists public.agent_spends (
  id               uuid primary key default gen_random_uuid(),
  agent_wallet_id  uuid not null references public.agent_wallets(id) on delete cascade,

  amount_usd       numeric(12, 2) not null check (amount_usd >= 0),
  network          text not null,

  -- The EIP-3009 authorization nonce. It is single-use on the token itself, so
  -- it is also the natural idempotency key here: a retried settle for a payment
  -- already broadcast must not be counted against the allowance twice.
  nonce            text,
  tx_hash          text,

  created_at       timestamptz not null default now()
);

comment on table public.agent_spends is
  'Ledger of spends allowed through for an agent. The source of truth for the '
  'daily and lifetime limits.';

comment on column public.agent_spends.nonce is
  'EIP-3009 authorization nonce. Single-use on chain, so it doubles as the '
  'idempotency key that stops a retry double-counting against the limit.';

create unique index if not exists agent_spends_nonce_key
  on public.agent_spends (agent_wallet_id, nonce)
  where nonce is not null;

-- The daily limit is a sum over one agent's recent rows, which is the only
-- read on this table in the hot path.
create index if not exists agent_spends_wallet_time_idx
  on public.agent_spends (agent_wallet_id, created_at desc);


-- Neither table is ever read by a browser: the settle path runs server-side
-- with the service role, and the management routes authenticate a scoped API
-- key before they touch it. RLS plus explicit revokes, because Supabase grants
-- anon and authenticated access to new tables by default and RLS is then the
-- only thing between those grants and an agent's spending limits.
alter table public.agent_wallets enable row level security;
alter table public.agent_spends  enable row level security;

revoke all on public.agent_wallets from public, anon, authenticated;
revoke all on public.agent_spends  from public, anon, authenticated;

grant select, insert, update, delete on public.agent_wallets to service_role;
grant select, insert, update, delete on public.agent_spends  to service_role;
