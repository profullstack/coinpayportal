-- Mercury-style spend windows for agent wallets.
alter table public.agent_wallets
  add column if not exists network text not null default 'solana',
  add column if not exists hourly_limit_usd numeric(12, 2) check (hourly_limit_usd > 0),
  add column if not exists weekly_limit_usd numeric(12, 2) check (weekly_limit_usd > 0),
  add column if not exists monthly_limit_usd numeric(12, 2) check (monthly_limit_usd > 0),
  add column if not exists quarterly_limit_usd numeric(12, 2) check (quarterly_limit_usd > 0),
  add column if not exists yearly_limit_usd numeric(12, 2) check (yearly_limit_usd > 0);

update public.agent_wallets set network = 'evm' where network = 'solana';
comment on column public.agent_wallets.network is 'Chain label; wallet addresses are opaque because chains use different formats.';
